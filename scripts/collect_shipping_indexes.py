#!/usr/bin/env python3
"""
운임 지수(KCCI, KUWI) 시계열 수집기.

- KCCI / KUWI: 한국해양진흥공사(KOMSA) Timeseries 그리드 페이지에서 (sDay, eDay) 폼
  POST → HTML 테이블 파싱으로 5년치 히스토리 한번에 백필 가능.

(SCFI는 무료 공개 5년 백필 소스 부재로 제거됨.)

성공 시 `market_series_daily` 에 upsert 하고 `market_series.source`를 placeholder →
KOMSA 로 갱신해 UI hasData 판정을 통과시킨다.
"""
import sys
import time
from datetime import date, timedelta
from pathlib import Path

from bs4 import BeautifulSoup
from dotenv import load_dotenv
from loguru import logger
from playwright.sync_api import APIRequestContext, sync_playwright

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows
from lib.shipping_sources import (
  KCCI_COLUMN_MAP,
  KCCI_POST_URL,
  KCCI_REFERER,
  KCCI_SOURCE,
  REQUEST_SLEEP_SEC,
  USER_AGENT,
)

# 5년치 백필 기간 (KCCI 그리드 POST 시 사용)
BACKFILL_YEARS = 5


def _normalizeNumber(raw: str) -> float | None:
  """천 단위 구분기호(,)를 제거하고 float 변환. 실패 시 None."""
  if raw is None:
    return None
  s = str(raw).strip().replace(',', '')
  if not s or s in ('-', 'N/A', '.', 'nan'):
    return None
  try:
    return float(s)
  except (TypeError, ValueError):
    return None


def fetchKcciHistory(request_ctx: APIRequestContext, years: int) -> list[dict]:
  """KOMSA Timeseries 그리드에서 KCCI/KUWI N년치 히스토리를 반환."""
  end_dt = date.today()
  start_dt = end_dt - timedelta(days=years * 365)

  try:
    # 1) 세션 쿠키 확보 (GET)
    request_ctx.get(KCCI_REFERER, headers={'Referer': KCCI_REFERER}, timeout=30000)
    time.sleep(REQUEST_SLEEP_SEC)
    # 2) 검색 POST
    resp = request_ctx.post(
      KCCI_POST_URL,
      form={'sDay': start_dt.isoformat(), 'eDay': end_dt.isoformat()},
      headers={'Referer': KCCI_REFERER},
      timeout=60000,
    )
    if not resp.ok:
      logger.warning(f"KCCI: HTTP {resp.status}")
      return []
    html = resp.text()
  except Exception as e:
    logger.error(f"KCCI: 그리드 POST 실패 — {e}")
    return []

  return _parseKcciGrid(html)


def _resolveDataHeaders(thead) -> list[str]:
  """thead의 colspan/rowspan을 펼쳐 데이터 컬럼명 1차원 리스트로 변환."""
  if not thead:
    return []
  rows = thead.find_all('tr')
  if not rows:
    return []
  # 2단 헤더 가정: 첫 행에 rowspan=2인 데이터 헤더(Date/KCCI 등)와 colspan 그룹,
  # 두번째 행에 그룹 하위 데이터 헤더가 옴.
  expanded: list[str | None] = []
  second_iter = iter(rows[1].find_all(['th', 'td'])) if len(rows) > 1 else iter([])
  for th in rows[0].find_all(['th', 'td']):
    name = th.get_text(strip=True)
    colspan = int(th.get('colspan', '1'))
    rowspan = int(th.get('rowspan', '1'))
    if rowspan >= 2 or colspan == 1:
      # rowspan>=2이면 단일 데이터 헤더로 그대로 사용 (colspan=1 케이스 포함)
      expanded.extend([name] * colspan)
    else:
      # 그룹 헤더 → 다음 행에서 colspan개 만큼 하위 헤더 채움
      for _ in range(colspan):
        try:
          sub = next(second_iter)
          expanded.append(sub.get_text(strip=True))
        except StopIteration:
          expanded.append(None)
  return [h for h in expanded if h is not None]


def _parseKcciGrid(html: str) -> list[dict]:
  """KCCI Timeseries 그리드 HTML에서 (date, KCCI, KUWI) 행을 추출한다."""
  soup = BeautifulSoup(html, 'html.parser')
  table = soup.find('table')
  if not table:
    logger.warning("KCCI: 그리드 테이블을 찾지 못함")
    return []

  data_headers = _resolveDataHeaders(table.find('thead'))
  if 'Date' not in data_headers:
    logger.warning(f"KCCI: 헤더에 Date 없음 — {data_headers}")
    return []

  date_idx = data_headers.index('Date')
  idx_map: dict[str, int] = {}
  for header_name, series_code in KCCI_COLUMN_MAP.items():
    if header_name in data_headers:
      idx_map[series_code] = data_headers.index(header_name)
    else:
      logger.warning(f"KCCI: 컬럼 {header_name} 누락")

  body = table.find('tbody')
  trs = body.find_all('tr') if body else []
  rows: list[dict] = []
  for tr in trs:
    cells = [td.get_text(strip=True) for td in tr.find_all('td')]
    if len(cells) < len(data_headers):
      continue
    trade_date = cells[date_idx]
    for series_code, idx in idx_map.items():
      val = _normalizeNumber(cells[idx])
      if val is None:
        continue
      rows.append({
        'series_code': series_code,
        'trade_date': trade_date,
        'close': val,
      })
  logger.info(f"KCCI: {len(rows)}행 파싱 (KCCI+KUWI 합산, {len(trs)}주차)")
  return rows


def _updateSourceMeta(series_codes_sources: dict[str, str]) -> None:
  """수집 성공한 series_code의 market_series.source를 placeholder → 실제 출처로 갱신."""
  client = get_client()
  for code, source in series_codes_sources.items():
    try:
      client.table('market_series') \
        .update({'source': source}) \
        .eq('series_code', code) \
        .execute()
      logger.debug(f"market_series.source 갱신: {code} → {source}")
    except Exception as e:
      logger.warning(f"market_series source 갱신 실패 ({code}): {e}")


def collectShippingIndexes() -> None:
  """KCCI/KUWI를 KOMSA Timeseries 그리드에서 한 번에 수집해 market_series_daily upsert."""
  total_rows: list[dict] = []
  updated_sources: dict[str, str] = {}

  with sync_playwright() as p:
    request_ctx = p.request.new_context(
      user_agent=USER_AGENT,
      extra_http_headers={'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8'},
    )

    # KCCI + KUWI
    logger.info("KCCI/KUWI 수집 시작 (5년 백필)")
    kcci_rows = fetchKcciHistory(request_ctx, BACKFILL_YEARS)
    if kcci_rows:
      total_rows.extend(kcci_rows)
      for code in ('KCCI', 'KUWI'):
        if any(r['series_code'] == code for r in kcci_rows):
          updated_sources[code] = KCCI_SOURCE

    request_ctx.dispose()

  if not total_rows:
    logger.error("수집된 행 없음 — DB 갱신 생략")
    sys.exit(1)

  upsert_rows('market_series_daily', total_rows, 'series_code,trade_date')
  _updateSourceMeta(updated_sources)

  # 카운트 요약
  counts: dict[str, int] = {}
  for r in total_rows:
    counts[r['series_code']] = counts.get(r['series_code'], 0) + 1
  for code, n in sorted(counts.items()):
    logger.info(f"  - {code}: {n}행 upsert")
  logger.info(f"shipping indexes 수집 완료 — 총 {len(total_rows)}행")


if __name__ == '__main__':
  try:
    collectShippingIndexes()
  except Exception as e:
    logger.error(f"shipping indexes 수집 실패: {e}")
    sys.exit(1)
