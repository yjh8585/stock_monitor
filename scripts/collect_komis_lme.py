#!/usr/bin/env python3
"""
국제 비철 가격(LME 현물) 수집기 — KOMIS 비철금속 「LME CASH」 일별 USD/MT.

- 대상: 구리 `COPPER_LME`(동 MNRL0008) · 알루미늄 `ALU_LME`(MNRL0009). 광종 그룹은 HP001.
  요청·재시도는 lib/komis.py 공용(철광석 수집기와 같다).
- 원자재 화면 상단 지역 비교 차트의 국제 선. 알루미늄은 미국 선(LME + 중서부 프리미엄)의 바탕이기도 하다.
- 매 실행 5년치를 통째로 받아 upsert 한다(누락분 자동 백필).
- 한 금속이 실패해도 나머지는 받고, 끝에 exit 1 로 드러낸다.
- 2026-11-09 `collect_copper_lme.py` 에서 이름을 바꿨다(알루미늄 추가 · 사용자 선택).
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
  KOMIS_ALU_MNRL_CODE,
  KOMIS_BASE_METALS_HP_GROUP,
  KOMIS_BASE_METALS_URL,
  KOMIS_COPPER_MNRL_CODE,
  KOMIS_LME_PRICE_NAME,
)

TARGETS = [
  KomisTarget(
    series_code=code,
    page_url=KOMIS_BASE_METALS_URL,
    hp_group=KOMIS_BASE_METALS_HP_GROUP,
    mnrl_code=mnrl,
    price_name=KOMIS_LME_PRICE_NAME,
  )
  for code, mnrl in [('COPPER_LME', KOMIS_COPPER_MNRL_CODE), ('ALU_LME', KOMIS_ALU_MNRL_CODE)]
]


def collectKomisLme() -> None:
  """KOMIS LME 현물 일별 5년(금속별) → market_series_daily upsert."""
  failed: list[str] = []
  for target in TARGETS:
    code = target.series_code
    logger.info(f"{code}(KOMIS LME CASH) 수집 시작 (백필 {BACKFILL_YEARS}년)")
    # 조회·적재 모두 금속별로 감싼다 — 구리 적재 예외가 알루미늄 조회까지 막지 않게(2026-11-09 검토)
    try:
      rows = fetchWithRetry(target, BACKFILL_YEARS)
      if not rows:
        logger.error(f"{code}: 적재할 데이터 없음")
        failed.append(code)
        continue
      upsert_rows('market_series_daily', rows, 'series_code,trade_date')
    except Exception as e:
      logger.error(f"{code}: 조회·적재 실패 — {e}")
      failed.append(code)
      continue
    logger.info(f"{code} 수집 완료 — {len(rows)}행 upsert ({rows[0]['trade_date']} ~ {rows[-1]['trade_date']})")
  if failed:
    logger.error(f"KOMIS LME 실패: {', '.join(failed)}")
    sys.exit(1)


if __name__ == '__main__':
  try:
    collectKomisLme()
  except SystemExit:
    raise
  except Exception as e:
    logger.error(f"KOMIS LME 수집 실패: {e}")
    sys.exit(1)
