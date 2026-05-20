#!/usr/bin/env python3
"""
한세 4종목(016450/105630/069640/053280)의 외국인/기관/개인 순매수를
KIS OpenAPI로 받아 stock_supply_demand 및 stock_supply_demand_intraday에 적재한다.

수집 모드 (--mode):
- intraday    : HHPTJ04160200 (종목투자자별 매매추정) — 장중 잠정 누적값.
                output2[0] = 가장 최신 갱신 슬롯.
                응답은 외국인·기관·합계만 → 개인은 -(외국인+기관) 도출
                (한국 시장 제로섬: foreign + institution + individual ≈ 0).
- incremental : FHKST01010900 (주식현재가 투자자) — 일별 확정 시계열.
                당일 행은 장중 빈값 — 어제 이전 30영업일 행 보강용.

응답 정수 파싱: "+000000000123" / "-000000000045" 형태 → int(s.lstrip('+'))로 처리.
"""
import argparse
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows
from lib.kis_client import KisClient

HANSAE_TICKERS = ['016450', '105630', '069640', '053280']
KST = timezone(timedelta(hours=9))


def _load_hansae_companies() -> list[dict[str, Any]]:
  client = get_client()
  res = (
    client.table('companies')
    .select('id,ticker,name_kr')
    .in_('ticker', HANSAE_TICKERS)
    .execute()
  )
  return res.data


def _parse_kis_int(v: Any) -> int | None:
  """KIS 응답 정수 필드 파싱. 부호+18자리 zero-pad 또는 빈 문자열."""
  if v is None or v == '':
    return None
  try:
    return int(str(v).strip().lstrip('+'))
  except (TypeError, ValueError):
    return None


def _parse_kis_float(v: Any) -> float | None:
  if v is None or v == '':
    return None
  try:
    return float(str(v).strip().lstrip('+'))
  except (TypeError, ValueError):
    return None


def collectKisSupplyIntraday() -> None:
  """장중 잠정 누적 (HHPTJ04160200) — 5분 cron용."""
  kis = KisClient.from_env()
  today = datetime.now(KST).date()
  snapshot_ts = datetime.now(KST).replace(second=0, microsecond=0).isoformat()
  companies = _load_hansae_companies()
  logger.info(f'KIS 수급 intraday 수집: 종목 {len(companies)}개, snapshot_ts={snapshot_ts}')

  supply_rows: list[dict[str, Any]] = []
  snapshot_rows: list[dict[str, Any]] = []

  for ci, company in enumerate(companies):
    ticker = company['ticker']
    if ci > 0:
      time.sleep(0.4)  # KIS 분당 한도 여유
    try:
      data = kis.get_investor_estimate(ticker)
    except RuntimeError as e:
      if 'EGW00201' in str(e):
        logger.warning(f'{ticker}: KIS 초당 한도 — 1.2s 대기 후 재시도')
        time.sleep(1.2)
        try:
          data = kis.get_investor_estimate(ticker)
        except Exception as e2:
          logger.error(f'{ticker} 재시도 실패: {e2}')
          continue
      else:
        logger.error(f'{ticker} HHPTJ04160200 호출 실패: {e}')
        continue
    except Exception as e:
      logger.error(f'{ticker} HHPTJ04160200 호출 실패: {e}')
      continue
    rows = data.get('output2') or []
    if not isinstance(rows, list) or not rows:
      logger.warning(f'{ticker}: 응답 비어있음 (장 외 시간일 수 있음)')
      continue

    latest = rows[0]
    foreign = _parse_kis_int(latest.get('frgn_fake_ntby_qty'))
    institution = _parse_kis_int(latest.get('orgn_fake_ntby_qty'))
    if foreign is None and institution is None:
      logger.warning(f'{ticker}: 잠정값 모두 빈값 — skip')
      continue

    f = foreign or 0
    o = institution or 0
    individual = -(f + o)  # 한국 시장 제로섬

    today_iso = today.isoformat()
    supply_rows.append({
      'company_id': company['id'],
      'trade_date': today_iso,
      'foreign_net': f,
      'institution_net': o,
      'individual_net': individual,
      'program_net': None,
    })
    snapshot_rows.append({
      'company_id': company['id'],
      'snapshot_ts': snapshot_ts,
      'trade_date': today_iso,
      'foreign_net': f,
      'institution_net': o,
      'individual_net': individual,
    })
    logger.info(
      f"{ticker} ({company['name_kr']}): 외국인={f:>+8} 기관={o:>+8} 개인={individual:>+8} "
      f"(slot={latest.get('bsop_hour_gb')})"
    )

  if supply_rows:
    upsert_rows('stock_supply_demand', supply_rows, 'company_id,trade_date')
  if snapshot_rows:
    upsert_rows('stock_supply_demand_intraday', snapshot_rows, 'company_id,snapshot_ts')
  logger.info(f'KIS 수급 intraday 완료 — supply {len(supply_rows)}행, snapshot {len(snapshot_rows)}행')


def collectKisSupplyIncremental() -> None:
  """일별 확정값 보강 (FHKST01010900) — 장 마감 후 cron용."""
  kis = KisClient.from_env()
  companies = _load_hansae_companies()
  logger.info(f'KIS 수급 incremental 수집: 종목 {len(companies)}개')
  total = 0
  for ci, company in enumerate(companies):
    ticker = company['ticker']
    if ci > 0:
      time.sleep(0.4)
    try:
      data = kis.get_investor_trend(ticker)
    except RuntimeError as e:
      if 'EGW00201' in str(e):
        logger.warning(f'{ticker}: KIS 초당 한도 — 1.2s 대기 후 재시도')
        time.sleep(1.2)
        try:
          data = kis.get_investor_trend(ticker)
        except Exception as e2:
          logger.error(f'{ticker} 재시도 실패: {e2}')
          continue
      else:
        logger.error(f'{ticker} FHKST01010900 호출 실패: {e}')
        continue
    except Exception as e:
      logger.error(f'{ticker} FHKST01010900 호출 실패: {e}')
      continue
    rows = data.get('output') or []
    if not isinstance(rows, list):
      continue

    normalized: list[dict[str, Any]] = []
    for r in rows:
      bsop_date = r.get('stck_bsop_date')
      if not bsop_date or len(str(bsop_date)) != 8:
        continue
      try:
        td = datetime.strptime(str(bsop_date), '%Y%m%d').date().isoformat()
      except ValueError:
        continue
      foreign = _parse_kis_int(r.get('frgn_ntby_qty'))
      institution = _parse_kis_int(r.get('orgn_ntby_qty'))
      individual = _parse_kis_int(r.get('prsn_ntby_qty'))
      if foreign is None and institution is None and individual is None:
        continue
      normalized.append({
        'company_id': company['id'],
        'trade_date': td,
        'foreign_net': foreign,
        'institution_net': institution,
        'individual_net': individual,
        'program_net': None,
        'close_price': _parse_kis_float(r.get('stck_clpr')),
        'change_pct': None,
      })

    if normalized:
      upsert_rows('stock_supply_demand', normalized, 'company_id,trade_date')
      total += len(normalized)
      logger.info(f"{ticker} ({company['name_kr']}): {len(normalized)}행 upsert")

  logger.info(f'KIS 수급 incremental 완료 — 총 {total}행')


if __name__ == '__main__':
  parser = argparse.ArgumentParser(description='한세 4종목 KIS 수급 수집')
  parser.add_argument(
    '--mode',
    choices=['intraday', 'incremental'],
    default='intraday',
    help='intraday: 장중 잠정 누적(HHPTJ04160200), incremental: 일별 확정값(FHKST01010900)',
  )
  args = parser.parse_args()
  try:
    if args.mode == 'intraday':
      collectKisSupplyIntraday()
    else:
      collectKisSupplyIncremental()
  except Exception as e:
    import traceback
    logger.error(f'KIS 수급 수집 실패: {e}\n{traceback.format_exc()}')
    sys.exit(1)
