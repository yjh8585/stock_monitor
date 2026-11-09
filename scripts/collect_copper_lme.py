#!/usr/bin/env python3
"""
국제 구리 가격(COPPER_LME) 수집기 — KOMIS 비철금속 「동 LME CASH」 일별 USD/MT.

- 소스: KOMIS `ajax/getChartData` (광종 그룹 HP001 · 동 MNRL0008 · 가격기준 이름 'LME CASH')
  요청·재시도는 lib/komis.py 공용(철광석 수집기와 같다).
- 원자재 화면 상단 「구리 — 미국·국제·한국」 합친 차트의 국제 선(2026-11-09 사용자 지시).
- 매 실행 5년치를 통째로 받아 upsert 한다(누락분 자동 백필).
"""
import sys
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import upsert_rows
from lib.komis import KomisTarget, fetchWithRetry
from lib.series_sources import (
  BACKFILL_YEARS,
  KOMIS_BASE_METALS_HP_GROUP,
  KOMIS_BASE_METALS_URL,
  KOMIS_COPPER_MNRL_CODE,
  KOMIS_COPPER_PRICE_NAME,
)

TARGET = KomisTarget(
  series_code='COPPER_LME',
  page_url=KOMIS_BASE_METALS_URL,
  hp_group=KOMIS_BASE_METALS_HP_GROUP,
  mnrl_code=KOMIS_COPPER_MNRL_CODE,
  price_name=KOMIS_COPPER_PRICE_NAME,
)


def collectCopperLme() -> None:
  """KOMIS LME 구리 현물 일별 5년 → market_series_daily upsert."""
  logger.info(f"COPPER_LME(KOMIS LME CASH) 수집 시작 (백필 {BACKFILL_YEARS}년)")
  rows = fetchWithRetry(TARGET, BACKFILL_YEARS)
  if not rows:
    logger.error("COPPER_LME: 적재할 데이터 없음")
    sys.exit(1)

  upsert_rows('market_series_daily', rows, 'series_code,trade_date')
  logger.info(f"COPPER_LME 수집 완료 — {len(rows)}행 upsert ({rows[0]['trade_date']} ~ {rows[-1]['trade_date']})")


if __name__ == '__main__':
  try:
    collectCopperLme()
  except Exception as e:
    logger.error(f"COPPER_LME 수집 실패: {e}")
    sys.exit(1)
