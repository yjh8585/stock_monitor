#!/usr/bin/env python3
"""
국내 철강 대용 시계열(STEEL_KR) 수집기.

- KOMIS(한국자원정보서비스)는 국내 열연강판/철근 공개 데이터를 제공하지 않으므로,
  자동차 산업 원가에 가장 직접적인 광물인 **철광석(Iron Ore Fines 62%, CFR China,
  Australian)** 일별 시세를 STEEL_KR로 적재한다.
- 소스: KOMIS `ajax/getChartData` (광종=철 MNRL1011, 가격기준=Iron Ore Fines)
- 단위: USD/MT, 일별 ~5년 백필 (영업일 기준 약 1100건)
- 적재 후 market_series.label / unit / source 모두 실제 값으로 갱신.
"""
import sys
import time
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger
from playwright.sync_api import APIRequestContext, sync_playwright

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows
from lib.series_sources import (
  BACKFILL_YEARS,
  KOMIS_CHART_API,
  KOMIS_IRON_MNRL_CODE,
  KOMIS_IRON_PRICE_CODE,
  KOMIS_PAGE_URL,
  STEEL_KR_LABEL,
  STEEL_KR_SOURCE,
  STEEL_KR_UNIT,
  USER_AGENT,
)

# KOMIS가 GHA IP에 간헐 지연/빈응답 → 지수 백오프 재시도
MAX_FETCH_ATTEMPTS = 3
RETRY_BACKOFF_SEC = 10


def _normalizeNumber(raw: str) -> float | None:
  """쉼표 제거 후 float 변환. 실패 시 None."""
  if raw is None:
    return None
  s = str(raw).strip().replace(',', '')
  if not s or s in ('-', 'N/A', '.', 'nan'):
    return None
  try:
    return float(s)
  except (TypeError, ValueError):
    return None


def fetchKomisIronOre(request_ctx: APIRequestContext, years: int) -> list[dict]:
  """KOMIS ajax 엔드포인트에서 철광석 일별 USD/MT 시계열을 받는다."""
  end_year = date.today().year
  start_year = end_year - years

  # 1) GET 으로 세션 쿠키 확보
  try:
    request_ctx.get(KOMIS_PAGE_URL, headers={'Referer': KOMIS_PAGE_URL}, timeout=60000)
  except Exception as e:
    logger.error(f"KOMIS: 페이지 GET 실패 — {e}")
    return []

  # 2) 차트 데이터 POST (form-urlencoded)
  form = {
    'mnrkndUnqRadioCd': KOMIS_IRON_MNRL_CODE,
    'srchMnrkndUnqCd': KOMIS_IRON_MNRL_CODE,
    'srchPrcCrtr': KOMIS_IRON_PRICE_CODE,
    'srchAvgOpt': 'DAY',
    'srchField': 'year',
    'srchStartDate': str(start_year),
    'srchEndDate': str(end_year),
    'srchCompareMnrkndUnqCd': '',
    'srchComparePrcCrtr': '[선택]',
    'lmeInvt': 'Y',
    'HP000': 'HP003',
  }
  try:
    resp = request_ctx.post(
      KOMIS_CHART_API,
      form=form,
      headers={
        'Referer': KOMIS_PAGE_URL,
        'X-Requested-With': 'XMLHttpRequest',
      },
      timeout=60000,
    )
    if not resp.ok:
      logger.warning(f"KOMIS: HTTP {resp.status}")
      return []
    body = resp.json()
  except Exception as e:
    logger.error(f"KOMIS: 차트 API 실패 — {e}")
    return []

  return _parseKomisPayload(body)


def _parseKomisPayload(body: dict) -> list[dict]:
  """KOMIS getChartData 응답을 (series_code='STEEL_KR', trade_date, close) 행으로 변환."""
  data = body.get('data') or {}
  xaxis = data.get('xaxis') or []
  series = data.get('series') or []
  if not xaxis or not series:
    logger.warning(f"KOMIS: 빈 응답 (xaxis={len(xaxis)}, series={len(series)})")
    return []

  values = series[0].get('data') or []
  if len(values) != len(xaxis):
    logger.warning(f"KOMIS: xaxis/values 길이 불일치 ({len(xaxis)} vs {len(values)})")
    return []

  rows: list[dict] = []
  for raw_date, raw_val in zip(xaxis, values):
    # KOMIS는 'YYYY.MM.DD' 포맷
    try:
      y, m, d = raw_date.split('.')
      trade_date = f"{y}-{m}-{d}"
    except (ValueError, AttributeError):
      continue
    val = _normalizeNumber(raw_val)
    if val is None:
      continue
    rows.append({
      'series_code': 'STEEL_KR',
      'trade_date': trade_date,
      'close': val,
    })
  return rows


def _updateSeriesMeta() -> None:
  """STEEL_KR 메타(label/unit/source) 갱신."""
  client = get_client()
  try:
    client.table('market_series') \
      .update({
        'label': STEEL_KR_LABEL,
        'unit': STEEL_KR_UNIT,
        'source': STEEL_KR_SOURCE,
      }) \
      .eq('series_code', 'STEEL_KR') \
      .execute()
    logger.info(
      f"market_series.STEEL_KR 메타 갱신 "
      f"(label='{STEEL_KR_LABEL}', unit={STEEL_KR_UNIT}, source={STEEL_KR_SOURCE})"
    )
  except Exception as e:
    logger.warning(f"STEEL_KR 메타 갱신 실패: {e}")


def collectSteelKr() -> None:
  """KOMIS 철광석 일별 5년 백필 → market_series_daily upsert."""
  with sync_playwright() as p:
    request_ctx = p.request.new_context(
      user_agent=USER_AGENT,
      extra_http_headers={'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'},
    )
    logger.info(f"STEEL_KR(KOMIS Iron Ore) 수집 시작 (백필 {BACKFILL_YEARS}년)")
    rows: list[dict] = []
    for attempt in range(1, MAX_FETCH_ATTEMPTS + 1):
      rows = fetchKomisIronOre(request_ctx, BACKFILL_YEARS)
      if rows:
        break
      if attempt < MAX_FETCH_ATTEMPTS:
        wait = RETRY_BACKOFF_SEC * attempt
        logger.warning(
          f"KOMIS: 응답 없음 — {wait}s 후 재시도 ({attempt}/{MAX_FETCH_ATTEMPTS})"
        )
        time.sleep(wait)
    request_ctx.dispose()

  if not rows:
    logger.error("STEEL_KR: 적재할 데이터 없음")
    sys.exit(1)

  upsert_rows('market_series_daily', rows, 'series_code,trade_date')
  _updateSeriesMeta()
  logger.info(f"STEEL_KR 수집 완료 — {len(rows)}행 upsert")


if __name__ == '__main__':
  try:
    collectSteelKr()
  except Exception as e:
    logger.error(f"STEEL_KR 수집 실패: {e}")
    sys.exit(1)
