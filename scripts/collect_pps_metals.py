#!/usr/bin/env python3
"""
한국 비철 가격 수집기 — 조달청 비축물자 「원자재 판매가격」 게시판의 품목별 원/톤.

- 대상: 구리 `COPPER_KR`(구리(99.99%이상)) · 알루미늄 `ALU_KR`(알루미늄(서구산)). 같은 글을 한 번 열어 둘 다 읽는다.
- 게시판은 영업일마다 글 1건(제목 「원자재 판매가격 (YYYYMMDD)」)을 올리고, 상세 표에
  품목·판매가격(부가세 포함)·기준일자가 있다. 표 형식은 2014년 글부터 같다(2026-11-09 실측).
- 시장 거래가가 아니라 조달청이 비축 물량을 파는 가격(LME 연동 + 비용)이다. DB 에는 공시값
  그대로(부가세 포함) 저장하고, 부가세 제외·달러 환산은 화면(lib/commodityUnits.ts)에서 한다.
- 기본 실행은 목록 1쪽(최근 10영업일)만 본다. `--backfill-years N` 은 N년 전까지 목록을 넘기며
  어느 한 품목이라도 DB 에 없는 날짜만 상세를 연다(로컬 1회용 · 약 1.5초 간격).
- 2026-11-09 `collect_copper_pps.py` 에서 이름을 바꿨다(알루미늄 추가 · 사용자 선택).
"""
import argparse
import re
import sys
import time
from dataclasses import dataclass
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
  PPS_ALU_ITEM,
  PPS_ALU_NON_WESTERN_ITEM,
  PPS_COPPER_ITEM,
  PPS_LIST_URL,
  PPS_PRICE_BOARD_KEY,
  PPS_VIEW_URL,
  REQUEST_SLEEP_SEC,
  USER_AGENT,
)


@dataclass(frozen=True)
class PpsItem:
  series_code: str
  item_name: str  # 상세 표 첫 칸 그대로
  # 이 글자가 글에 아예 없으면 「그날 판매 안 함」이다(구리 「구리」 · 알루미늄 「알루미늄」).
  presence_keyword: str
  # 이 글자가 든 품목 칸이 «전부» 여기 적힌 다른 품목이면 그것도 판매 안 함이다(비서구산만 판 날).
  # 품목 이름 전체를 열쇠말로 쓰면 「알루미늄 (서구산)」 같은 표기 변경이 판매 안 함으로 묻힌다(2026-11-09 검토).
  sibling_items: tuple[str, ...] = ()

  @property
  def row_re(self) -> re.Pattern:
    # 상세 표 행: <td>품목</td><td …>지역</td><td>21,220,000원/톤</td><td>한도</td><td>2026.11.09</td>
    return re.compile(
      r'<td>\s*' + re.escape(self.item_name) + r'\s*</td>\s*'
      r'<td[^>]*>[^<]*</td>\s*'
      r'<td>\s*(\d[\d,]*)\s*원/톤\s*</td>\s*'  # 숫자로 시작해야 한다(「,원/톤」을 잡아 float('') 로 죽지 않게)
      r'<td>[^<]*</td>\s*'
      r'<td>\s*(\d{4})\.(\d{2})\.(\d{2})\s*</td>'
    )


ITEMS = [
  PpsItem('COPPER_KR', PPS_COPPER_ITEM, '구리'),
  PpsItem('ALU_KR', PPS_ALU_ITEM, '알루미늄', (PPS_ALU_NON_WESTERN_ITEM,)),
]
COPPER, ALU = ITEMS

# 목록 행: goView('2611090003', '0001') … 원자재 판매가격 (20261109)
# 두 번째 인자 '0001' 만 공개글이다('E' 비밀글 · '0002' 비밀번호 글).
# 사이 구간에 다른 goView 가 끼면 안 된다 — 가격 글이 아닌 공개글(공지 등)의 번호가 다음 글 날짜와 짝지어진다.
LIST_ROW_RE = re.compile(
  r"goView\('(\d+)',\s*'0001'\)(?:(?!goView)[\s\S]){0,400}?원자재 판매가격\s*\((\d{8})\)"
)

# 🔴 파서 자가 시험 — 형식이 바뀌면 「글은 있는데 0건」이 조용히 난다. 실제 행을 그대로 박아 둔다(2026-11-09 글).
_COPPER_ROW = (
  '<tr> <td>구리(99.99%이상)</td> <td class="txt_left">부산,인천,대구,대전, 전북</td> '
  '<td>21,220,000원/톤</td> <td>40톤/주 </td> <td>2026.11.09</td> <td>0.0</td> </tr>'
)
_ALU_ROW = (
  '<tr> <td>알루미늄(서구산)</td> <td class="txt_left">부산,인천,대구,대전, 전북</td> '
  '<td>5,120,000원/톤</td> <td>통합40톤/주 </td> <td>2026.11.09</td> <td>0.0</td> </tr>'
)
_ALU_NON_WESTERN_ROW = (
  '<tr> <td>알루미늄(비서구산)</td> <td class="txt_left">부산,인천,대구,전북</td> '
  '<td>5,090,000원/톤</td> <td>통합40톤/주 </td> <td>2026.11.09</td> <td>0.0</td> </tr>'
)
_LEAD_ROW = (
  '<tr> <td>납(99.99%이상)</td> <td class="txt_left">부산,인천,대구,전북</td> '
  '<td>3,020,000원/톤</td> <td>40톤/주 </td> <td>2026.11.09</td> </tr>'
)
_TABLE_HEADER = '<th>판매가격 (부가세 포함)</th><th>기준일자</th>'
# 목록 정규식 — 공지(가격 글 아님) 바로 아래 가격 글이 있어도 가격 글 번호만 짝지어야 한다.
_LIST_SAMPLE = (
  '<td><a href="#" onclick="goView(\'2611100001\', \'0001\');">비축물자 안내</a></td></tr>'
  '<tr><td><a href="#" onclick="goView(\'2611090003\', \'0001\');">원자재 판매가격 (20261109)\r\n\t\t</a></td></tr>'
  '<tr><td><a href="#" onclick="goView(\'2611090009\', \'E\');">원자재 판매가격 (20261109)</a></td></tr>',
  [('2611090003', '2026-11-09')],
)


def parseItemPrice(html: str, item: PpsItem) -> tuple[str, float] | None:
  """상세 글 HTML 에서 그 품목의 (기준일자 'YYYY-MM-DD', 원/톤) 을 뽑는다. 없으면 None."""
  m = item.row_re.search(html)
  if not m:
    return None
  price, y, mo, d = m.groups()
  return f"{y}-{mo}-{d}", float(price.replace(',', ''))


def isNoSale(html: str, item: PpsItem) -> bool:
  """가격표는 있는데 그 품목이 아예 없는 글 = 그날 팔지 않았다(형식 변경이 아니다).

  2021-11~2026-11 구리 백필에서 17일(2023-05·2023-11~2024-01·2026-02 묶음)이 이랬다 — 알루미늄·요소 등만 있었다.
  이것까지 실패로 치면 판매 중단 기간마다 GHA 실패 메일이 간다. 품목 글자가 있는데 행을 못 읽으면 형식 변경이다.
  알루미늄 서구산은 5년 중 28일 — 서구산·비서구산 행이 모두 없었다. 비서구산만 있는 날도 판매 안 함이다.
  """
  if not ('판매가격' in html and '기준일자' in html):
    return False
  if item.presence_keyword not in html:
    return True
  if not item.sibling_items:
    return False
  # 열쇠말이 든 칸이 전부 «아는 형제 품목»일 때만 — 낯선 표기(「알루미늄 (서구산)」)가 하나라도 있으면 형식 변경
  cells = [c.strip() for c in re.findall(r'<td[^>]*>([^<]*)</td>', html) if item.presence_keyword in c]
  return bool(cells) and all(c in item.sibling_items for c in cells)


def parseListRows(html: str) -> list[tuple[str, str]]:
  """목록 HTML 에서 (글 번호, 제목 날짜 'YYYY-MM-DD'). 최신 글이 앞."""
  return [(sn, f"{d[:4]}-{d[4:6]}-{d[6:]}") for sn, d in LIST_ROW_RE.findall(html)]


def _selfTest() -> None:
  checks = [
    ('구리 행', parseItemPrice(_COPPER_ROW, COPPER) == ('2026-11-09', 21220000.0)),
    ('알루미늄 서구산 행', parseItemPrice(_ALU_ROW, ALU) == ('2026-11-09', 5120000.0)),
    ('납 행을 구리로 읽지 않음', parseItemPrice(_LEAD_ROW, COPPER) is None),
    ('비서구산을 서구산으로 읽지 않음', parseItemPrice(_ALU_NON_WESTERN_ROW, ALU) is None),
    ('목록 행', parseListRows(_LIST_SAMPLE[0]) == _LIST_SAMPLE[1]),
    # 판매 안 함 판정 — 그 품목이 없는 가격표만 참, 품목이 있거나 표 자체가 없으면 거짓
    ('구리 없는 표 = 판매 안 함', isNoSale(_TABLE_HEADER + _LEAD_ROW, COPPER)),
    ('구리 있는 표 ≠ 판매 안 함', not isNoSale(_TABLE_HEADER + _COPPER_ROW, COPPER)),
    ('비서구산만 있는 표 = 서구산 판매 안 함', isNoSale(_TABLE_HEADER + _ALU_NON_WESTERN_ROW, ALU)),
    ('서구산 있는 표 ≠ 판매 안 함', not isNoSale(_TABLE_HEADER + _ALU_ROW, ALU)),
    ('표 없는 글 ≠ 판매 안 함', not isNoSale('점검 중', COPPER)),
    ('알루미늄이 아예 없는 표 = 판매 안 함', isNoSale(_TABLE_HEADER + _COPPER_ROW, ALU)),
    # 표기 변경은 판매 안 함으로 묻히면 안 된다 — 행을 못 읽고(None) 판매 안 함도 아니어야 실패로 잡힌다
    *[
      (f'표기 변경 {name} ≠ 판매 안 함', parseItemPrice(row, ALU) is None and not isNoSale(_TABLE_HEADER + row, ALU))
      for name, row in [
        ('괄호 앞 공백', _ALU_ROW.replace('알루미늄(서구산)', '알루미늄 (서구산)')),
        ('규격 덧붙임', _ALU_ROW.replace('알루미늄(서구산)', '알루미늄(서구산, 99.7%)')),
        ('가격 칸 깨짐', _ALU_ROW.replace('5,120,000원/톤', ',원/톤')),
      ]
    ],
  ]
  failed = [name for name, ok in checks if not ok]
  if failed:
    logger.error(f"조달청 파서 자가 시험 실패 — {failed}")
    sys.exit(2)


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


def fetchPost(bbs_sn: str) -> str:
  return with_retry(
    _get, PPS_VIEW_URL, {'key': PPS_PRICE_BOARD_KEY, 'bbsSn': bbs_sn}, _label=f'조달청 글 {bbs_sn}'
  )


def collect(backfill_years: int) -> None:
  _selfTest()
  cutoff = (date.today() - timedelta(days=365 * backfill_years)).isoformat() if backfill_years else None
  existing = {it.series_code: existing_trade_dates(it.series_code) if backfill_years else set() for it in ITEMS}
  logger.info(
    "조달청(구리·알루미늄) 수집 시작 — "
    + (f"백필 {backfill_years}년(~{cutoff})" if cutoff else "목록 1쪽")
  )

  by_date: dict[str, dict[str, float]] = {it.series_code: {} for it in ITEMS}
  flushed: set[tuple[str, str]] = set()
  opened = errors = 0
  parse_fail = {it.series_code: 0 for it in ITEMS}
  no_sale = {it.series_code: 0 for it in ITEMS}

  def flush() -> None:
    """백필은 수십 분 걸려 끝에 한 번만 쓰면 도중 실패에 전부 잃는다 — 쪽마다 새 날짜만 적재."""
    pending = [
      {'series_code': code, 'trade_date': d, 'close': price}
      for code, prices in by_date.items()
      for d, price in sorted(prices.items())
      if (code, d) not in flushed
    ]
    if not pending:
      return
    upsert_rows('market_series_daily', pending, 'series_code,trade_date')
    flushed.update((r['series_code'], r['trade_date']) for r in pending)

  page = 1
  reached_cutoff = False
  while not reached_cutoff:
    posts = listPosts(page)
    if not posts:
      if page == 1:
        # 영업일마다 글이 오르는 게시판이라 1쪽 0건은 정상일 수 없다 — 목록 형식 변경·차단 안내 페이지
        logger.error("조달청: 목록 1쪽에서 가격 글 0건 — 게시판 형식 변경·접속 차단 의심")
        sys.exit(1)
      break
    for bbs_sn, title_date in posts:
      if cutoff and title_date < cutoff:
        reached_cutoff = True
        break
      # 모든 품목이 이미 있는 날만 건너뛴다(같은 날 글이 둘이면 앞 글 = 최신 글이 이미 채웠다)
      if all(title_date in existing[c] or title_date in by_date[c] for c in by_date):
        continue
      time.sleep(REQUEST_SLEEP_SEC)
      opened += 1
      try:
        html = fetchPost(bbs_sn)
      except Exception as e:
        # 글 하나의 오류로 이미 읽은 값을 버리지 않는다 — 끝에서 실패로 드러낸다
        errors += 1
        logger.warning(f"조달청: 글 {bbs_sn}({title_date}) 조회 실패 — {e}")
        continue
      for item in ITEMS:
        code = item.series_code
        parsed = parseItemPrice(html, item)
        if parsed is None and isNoSale(html, item):
          no_sale[code] += 1
          logger.info(f"{code}: 글 {bbs_sn}({title_date})에 품목 없음 — 그날 판매 안 함")
          continue
        if parsed is None:
          parse_fail[code] += 1
          logger.warning(f"{code}: 글 {bbs_sn}({title_date})에서 「{item.item_name}」 행을 못 읽음")
          continue
        trade_date, krw = parsed
        # 백필 — 다른 품목 때문에 연 글이면 이미 있는 이 품목 값은 다시 쓰지 않는다(「신규」 일수도 부풀지 않게)
        if trade_date in existing[code]:
          continue
        # 같은 날 글이 둘이면 최신 글(목록 앞쪽)을 쓴다
        by_date[code].setdefault(trade_date, krw)
    if not cutoff:
      break  # 기본 실행은 1쪽만
    page += 1
    if page % 10 == 0:
      flush()
      logger.info(f"조달청: 목록 {page}쪽 · 누적 " + ' · '.join(f"{c} {len(v)}일" for c, v in by_date.items()))
    time.sleep(REQUEST_SLEEP_SEC)

  flush()
  logger.info(f"조달청: 상세 {opened}건 열람 · 조회 실패 {errors}건")
  for item in ITEMS:
    code = item.series_code
    dates = sorted(by_date[code])
    span = f" ({dates[0]} ~ {dates[-1]})" if dates else ''
    logger.info(
      f"{code}: 신규 {len(dates)}일 적재{span} · 파싱 실패 {parse_fail[code]}건 · 판매 안 함 {no_sale[code]}건"
    )
  # 받은 것은 저장한 «뒤에» 실패를 드러낸다 — 최신 글 하나의 형식 변경을 옛 글의 성공이 가리지 않게
  # (2026-11-09 Codex·오퍼스 검토). 빠진 날은 --backfill-years 로 메운다.
  if errors or any(parse_fail.values()):
    logger.error(f"조달청: 조회 실패 {errors}건 · 행 못 읽음 {parse_fail}")
    sys.exit(1)


if __name__ == '__main__':
  parser = argparse.ArgumentParser(description='조달청 비축 비철(구리·알루미늄) 판매가 수집')
  parser.add_argument('--backfill-years', type=int, default=0, help='N년 전까지 목록을 넘기며 백필(기본 0 = 1쪽만)')
  args = parser.parse_args()
  try:
    collect(args.backfill_years)
  except SystemExit:
    raise
  except Exception as e:
    logger.error(f"조달청 수집 실패: {e}")
    sys.exit(1)
