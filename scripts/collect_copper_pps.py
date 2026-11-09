#!/usr/bin/env python3
"""
한국 구리 가격(COPPER_KR) 수집기 — 조달청 비축물자 「원자재 판매가격」 게시판의 구리(99.99%이상) 원/톤.

- 게시판은 영업일마다 글 1건(제목 「원자재 판매가격 (YYYYMMDD)」)을 올리고, 상세 표에
  품목·판매가격(부가세 포함)·기준일자가 있다. 표 형식은 2014년 글부터 같다(2026-11-09 실측).
- 시장 거래가가 아니라 조달청이 비축 물량을 파는 가격(LME 연동 + 비용)이다. DB 에는 공시값
  그대로(부가세 포함) 저장하고, 부가세 제외·달러 환산은 화면(lib/commodityUnits.ts)에서 한다.
- 기본 실행은 목록 1쪽(최근 10영업일)만 본다. `--backfill-years N` 은 N년 전까지 목록을 넘기며
  DB 에 없는 날짜만 상세를 연다(로컬 1회용 · 약 1.5초 간격).
"""
import argparse
import re
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import requests
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import upsert_rows
from lib.market_series import existing_trade_dates
from lib.retry import with_retry
from lib.series_sources import (
  PPS_COPPER_ITEM,
  PPS_LIST_URL,
  PPS_PRICE_BOARD_KEY,
  PPS_VIEW_URL,
  REQUEST_SLEEP_SEC,
  USER_AGENT,
)

SERIES_CODE = 'COPPER_KR'
# 목록 행: goView('2611090003', '0001') … 원자재 판매가격 (20261109)
# 두 번째 인자 '0001' 만 공개글이다('E' 비밀글 · '0002' 비밀번호 글).
# 사이 구간에 다른 goView 가 끼면 안 된다 — 가격 글이 아닌 공개글(공지 등)의 번호가 다음 글 날짜와 짝지어진다.
LIST_ROW_RE = re.compile(
  r"goView\('(\d+)',\s*'0001'\)(?:(?!goView)[\s\S]){0,400}?원자재 판매가격\s*\((\d{8})\)"
)
# 상세 표 행: <td>구리(99.99%이상)</td><td …>지역</td><td>21,220,000원/톤</td><td>40톤/주</td><td>2026.11.09</td>
COPPER_ROW_RE = re.compile(
  r'<td>\s*' + re.escape(PPS_COPPER_ITEM) + r'\s*</td>\s*'
  r'<td[^>]*>[^<]*</td>\s*'
  r'<td>\s*([\d,]+)\s*원/톤\s*</td>\s*'
  r'<td>[^<]*</td>\s*'
  r'<td>\s*(\d{4})\.(\d{2})\.(\d{2})\s*</td>'
)

# 🔴 파서 자가 시험 — 형식이 바뀌면 「글은 있는데 0건」이 조용히 난다. 실제 행을 그대로 박아 둔다.
_MUST_HIT = (
  '<tr> <td>구리(99.99%이상)</td> <td class="txt_left">부산,인천,대구,대전, 전북</td> '
  '<td>21,220,000원/톤</td> <td>40톤/주 </td> <td>2026.11.09</td> <td>0.0</td> </tr>',
  ('2026-11-09', 21220000.0),
)
_MUST_MISS = (
  '<tr> <td>납(99.99%이상)</td> <td class="txt_left">부산,인천,대구,전북</td> '
  '<td>3,020,000원/톤</td> <td>40톤/주 </td> <td>2026.11.09</td> </tr>'
)
# 목록 정규식 — 공지(가격 글 아님) 바로 아래 가격 글이 있어도 가격 글 번호만 짝지어야 한다.
_LIST_SAMPLE = (
  '<td><a href="#" onclick="goView(\'2611100001\', \'0001\');">비축물자 안내</a></td></tr>'
  '<tr><td><a href="#" onclick="goView(\'2611090003\', \'0001\');">원자재 판매가격 (20261109)\r\n\t\t</a></td></tr>'
  '<tr><td><a href="#" onclick="goView(\'2611090009\', \'E\');">원자재 판매가격 (20261109)</a></td></tr>',
  [('2611090003', '2026-11-09')],
)


def parseCopperPrice(html: str) -> tuple[str, float] | None:
  """상세 글 HTML 에서 (기준일자 'YYYY-MM-DD', 원/톤) 을 뽑는다. 없으면 None."""
  m = COPPER_ROW_RE.search(html)
  if not m:
    return None
  price, y, mo, d = m.groups()
  return f"{y}-{mo}-{d}", float(price.replace(',', ''))


def _selfTest() -> None:
  html, expected = _MUST_HIT
  got_date, got_krw = parseCopperPrice(html) or (None, None)
  if (got_date, got_krw) != expected:
    logger.error(f"COPPER_KR 파서 자가 시험 실패 — 기대 {expected}, 실제 ({got_date}, {got_krw})")
    sys.exit(2)
  if parseCopperPrice(_MUST_MISS) is not None:
    logger.error("COPPER_KR 파서 자가 시험 실패 — 납 행을 구리로 읽었다")
    sys.exit(2)
  list_html, list_expected = _LIST_SAMPLE
  list_got = parseListRows(list_html)
  if list_got != list_expected:
    logger.error(f"COPPER_KR 목록 파서 자가 시험 실패 — 기대 {list_expected}, 실제 {list_got}")
    sys.exit(2)


def parseListRows(html: str) -> list[tuple[str, str]]:
  """목록 HTML 에서 (글 번호, 제목 날짜 'YYYY-MM-DD'). 최신 글이 앞."""
  return [(sn, f"{d[:4]}-{d[4:6]}-{d[6:]}") for sn, d in LIST_ROW_RE.findall(html)]


def _get(url: str, params: dict) -> str:
  resp = requests.get(url, params=params, headers={'User-Agent': USER_AGENT}, timeout=30)
  resp.raise_for_status()
  # 응답 헤더는 UTF-8 이지만 requests 추정에 기대지 않고 직접 디코딩한다
  return resp.content.decode('utf-8', errors='replace')


def listPosts(page: int) -> list[tuple[str, str]]:
  """목록 page 쪽의 (글 번호, 제목 날짜 'YYYY-MM-DD') 목록. 최신 글이 앞."""
  html = with_retry(
    _get, PPS_LIST_URL, {'key': PPS_PRICE_BOARD_KEY, 'pageIndex': page}, _label=f'조달청 목록 {page}쪽'
  )
  return parseListRows(html)


def fetchCopper(bbs_sn: str) -> tuple[str, float] | None:
  html = with_retry(
    _get, PPS_VIEW_URL, {'key': PPS_PRICE_BOARD_KEY, 'bbsSn': bbs_sn}, _label=f'조달청 글 {bbs_sn}'
  )
  return parseCopperPrice(html)


def collect(backfill_years: int) -> None:
  _selfTest()
  cutoff = (date.today() - timedelta(days=365 * backfill_years)).isoformat() if backfill_years else None
  skip = existing_trade_dates(SERIES_CODE) if backfill_years else set()
  logger.info(
    f"COPPER_KR(조달청) 수집 시작 — "
    + (f"백필 {backfill_years}년(~{cutoff}), 기존 {len(skip)}일 건너뜀" if cutoff else "목록 1쪽")
  )

  by_date: dict[str, float] = {}
  flushed: set[str] = set()
  opened = parse_fail = errors = 0

  def flush() -> None:
    """백필은 수십 분 걸려 끝에 한 번만 쓰면 도중 실패에 전부 잃는다 — 쪽마다 새 날짜만 적재."""
    pending = sorted(d for d in by_date if d not in flushed)
    if not pending:
      return
    upsert_rows(
      'market_series_daily',
      [{'series_code': SERIES_CODE, 'trade_date': d, 'close': by_date[d]} for d in pending],
      'series_code,trade_date',
    )
    flushed.update(pending)

  page = 1
  reached_cutoff = False
  while not reached_cutoff:
    posts = listPosts(page)
    if not posts:
      if page == 1:
        # 영업일마다 글이 오르는 게시판이라 1쪽 0건은 정상일 수 없다 — 목록 형식 변경·차단 안내 페이지
        logger.error("COPPER_KR: 목록 1쪽에서 가격 글 0건 — 게시판 형식 변경·접속 차단 의심")
        sys.exit(1)
      break
    for bbs_sn, title_date in posts:
      if cutoff and title_date < cutoff:
        reached_cutoff = True
        break
      if title_date in skip or title_date in by_date:
        continue
      time.sleep(REQUEST_SLEEP_SEC)
      opened += 1
      try:
        parsed = fetchCopper(bbs_sn)
      except Exception as e:
        # 글 하나의 오류로 이미 읽은 값을 버리지 않는다 — 끝에서 실패로 드러낸다
        errors += 1
        logger.warning(f"COPPER_KR: 글 {bbs_sn}({title_date}) 조회 실패 — {e}")
        continue
      if parsed is None:
        parse_fail += 1
        logger.warning(f"COPPER_KR: 글 {bbs_sn}({title_date})에서 구리 행을 못 찾음")
        continue
      trade_date, krw = parsed
      # 같은 날 글이 둘이면 최신 글(목록 앞쪽)을 쓴다
      by_date.setdefault(trade_date, krw)
    if not cutoff:
      break  # 기본 실행은 1쪽만
    page += 1
    if page % 10 == 0:
      flush()
      logger.info(f"COPPER_KR: 목록 {page}쪽 · 누적 {len(by_date)}일 적재")
    time.sleep(REQUEST_SLEEP_SEC)

  flush()
  logger.info(
    f"COPPER_KR: 상세 {opened}건 열람 · 조회 실패 {errors}건 · 파싱 실패 {parse_fail}건 · 신규 {len(by_date)}일 적재"
  )
  # 받은 것은 저장한 «뒤에» 실패를 드러낸다 — 최신 글 하나의 형식 변경을 옛 글의 성공이 가리지 않게
  # (2026-11-09 Codex·오퍼스 검토). 빠진 날은 --backfill-years 로 메운다.
  if errors or parse_fail:
    logger.error(f"COPPER_KR: 조회 실패 {errors}건 · 구리 행 없음 {parse_fail}건")
    sys.exit(1)
  if by_date:
    dates = sorted(by_date)
    logger.info(f"COPPER_KR 수집 완료 — {len(dates)}행 upsert ({dates[0]} ~ {dates[-1]})")
  else:
    logger.info("COPPER_KR: 새로 적재할 날짜 없음")


if __name__ == '__main__':
  parser = argparse.ArgumentParser(description='조달청 구리 판매가 수집')
  parser.add_argument('--backfill-years', type=int, default=0, help='N년 전까지 목록을 넘기며 백필(기본 0 = 1쪽만)')
  args = parser.parse_args()
  try:
    collect(args.backfill_years)
  except SystemExit:
    raise
  except Exception as e:
    logger.error(f"COPPER_KR 수집 실패: {e}")
    sys.exit(1)
