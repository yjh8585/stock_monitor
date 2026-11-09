#!/usr/bin/env python3
"""
국내 철강 대용 시계열(STEEL_KR) 수집기.

- KOMIS(한국자원정보서비스)는 국내 열연강판/철근 공개 데이터를 제공하지 않으므로,
  자동차 산업 원가에 가장 직접적인 광물인 **철광석(Iron Ore Fines 62%, CFR China,
  Australian)** 일별 시세를 STEEL_KR로 적재한다.
- 소스: KOMIS `ajax/getChartData` (광종=철 MNRL1011, 가격기준=Iron Ore Fines) — 요청은 lib/komis.py
- 단위: USD/MT, 일별 ~5년 백필 (영업일 기준 약 1100건)
- 적재 후 market_series.label / unit / source 모두 실제 값으로 갱신.
"""
import sys
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows
from lib.komis import KomisTarget, fetchWithRetry
from lib.series_sources import (
  BACKFILL_YEARS,
  KOMIS_IRON_HP_GROUP,
  KOMIS_IRON_MNRL_CODE,
  KOMIS_IRON_PRICE_NAME,
  KOMIS_PAGE_URL,
  STEEL_KR_LABEL,
  STEEL_KR_SOURCE,
  STEEL_KR_UNIT,
)

TARGET = KomisTarget(
  series_code='STEEL_KR',
  page_url=KOMIS_PAGE_URL,
  hp_group=KOMIS_IRON_HP_GROUP,
  mnrl_code=KOMIS_IRON_MNRL_CODE,
  price_name=KOMIS_IRON_PRICE_NAME,
)


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
  logger.info(f"STEEL_KR(KOMIS Iron Ore) 수집 시작 (백필 {BACKFILL_YEARS}년)")
  rows = fetchWithRetry(TARGET, BACKFILL_YEARS)
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
