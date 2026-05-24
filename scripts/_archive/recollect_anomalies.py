#!/usr/bin/env python3
"""
/domestic 페이지 잔여 이상치 재수집 스크립트.

처리 대상:
1) 시총/주가 NULL 상장사 — pykrx로 최신 시총·주가·등락률 재수집
   - 삼보오토 (070080), 세원이앤씨 (091090)

2) 매출 NULL 비상장사 — DART finstate_all 재시도
   - 우수정기, 한국엔에스케이, 희성촉매
   감사보고서만 제출하는 외감법인은 finstate_all 미지원이므로,
   해당 케이스는 별도 collect_dart_audit 스크립트로 처리해야 함을 안내.

사용법:
  python scripts/recollect_anomalies.py             # 전체 실행
  python scripts/recollect_anomalies.py --listed    # 시총/주가 NULL 상장사만
  python scripts/recollect_anomalies.py --revenue   # 매출 NULL 비상장사만
"""
import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
load_dotenv(ROOT.parent / '.env.local')

from lib.db import get_client, upsert_rows


def _load_manual_dart_mapping() -> dict[str, str]:
  """manual_dart_mapping.json 로드 — 자동 검색 실패 시 fallback 매핑."""
  path = ROOT / 'lib' / 'manual_dart_mapping.json'
  if not path.exists():
    return {}
  try:
    with path.open('r', encoding='utf-8') as f:
      raw = json.load(f)
    return {k: v for k, v in raw.items() if not k.startswith('_')}
  except Exception as e:
    logger.warning(f'manual_dart_mapping 로드 실패: {e}')
    return {}


MANUAL_DART_MAP = _load_manual_dart_mapping()


def _resolve_corp_code(dart, ticker: str, name: str) -> str | None:
  """ticker → manual_mapping → name → find_corp_code 순으로 corp_code 해결."""
  if ticker in MANUAL_DART_MAP:
    return MANUAL_DART_MAP[ticker]
  if name in MANUAL_DART_MAP:
    return MANUAL_DART_MAP[name]
  try:
    return dart.find_corp_code(name)
  except Exception:
    return None

DART_KEY = os.environ.get('DART_API_KEY', '')
MILLION = 1_000_000

LISTED_TARGETS: list[str] = ['070080', '091090']
PRIVATE_REVENUE_TARGETS: list[str] = [
  '우수정기', '한국엔에스케이', '희성촉매',
  '신원자동차', '디에이치글로벌', '디에이치정공',
]

DART_TO_DB: dict[str, str] = {
  '매출액': 'revenue',
  '영업이익': 'operating_income',
  '영업이익(손실)': 'operating_income',
  '당기순이익': 'net_income',
  '당기순이익(손실)': 'net_income',
  '자산총계': 'total_assets',
  '부채총계': 'total_liabilities',
  '자본총계': 'total_equity',
  '재고자산': 'inventory',
}
GENERATED_COLS = frozenset({'operating_margin', 'gross_margin', 'net_margin', 'debt_ratio'})


def _recollect_listed_snapshots() -> int:
  """pykrx로 상장사 시총/주가/등락률 재수집 후 companies UPDATE."""
  try:
    from pykrx import stock as pykrx_stock
  except ImportError:
    logger.error('pykrx 미설치 — pip install pykrx')
    return 0

  client = get_client()
  rows = (
    client.table('companies')
      .select('id,ticker,name_kr,market')
      .in_('ticker', LISTED_TARGETS)
      .execute()
      .data
  )
  if not rows:
    logger.warning('대상 상장사 없음')
    return 0

  # pykrx는 영업일 기준이라 최근 7일치 조회 후 마지막 행을 사용
  end_dt = date.today()
  start_dt = end_dt - timedelta(days=10)
  end_s = end_dt.strftime('%Y%m%d')
  start_s = start_dt.strftime('%Y%m%d')

  applied = 0
  for r in rows:
    ticker = r['ticker']
    try:
      ohlcv = pykrx_stock.get_market_ohlcv(start_s, end_s, ticker)
      if ohlcv.empty:
        logger.warning(f'{ticker}({r["name_kr"]}): pykrx OHLCV 없음')
        continue
      latest = ohlcv.iloc[-1]
      last_close = float(latest.get('종가', 0)) or None
      change_pct = float(latest.get('등락률', 0))

      cap_df = pykrx_stock.get_market_cap(end_s, end_s, ticker)
      market_cap_t: float | None = None
      if not cap_df.empty:
        # pykrx 시가총액은 원 단위 → 조원으로 환산
        market_cap_won = float(cap_df.iloc[-1].get('시가총액', 0))
        market_cap_t = round(market_cap_won / 1_000_000_000_000, 4)

      update_payload = {
        'last_price': last_close,
        'last_change_pct': change_pct,
        'last_updated_at': datetime.utcnow().isoformat(),
      }
      if market_cap_t is not None:
        update_payload['market_cap'] = market_cap_t

      client.table('companies').update(update_payload).eq('id', r['id']).execute()
      logger.info(
        f'✓ {ticker}({r["name_kr"]}): price={last_close}, change={change_pct}%, cap={market_cap_t}조'
      )
      applied += 1
    except Exception as e:
      logger.error(f'{ticker} 재수집 실패: {e}')
  return applied


def _recollect_private_revenue() -> int:
  """DART finstate_all → 실패시 결산감사보고서 파싱으로 비상장사 재무 재수집."""
  if not DART_KEY:
    logger.error('DART_API_KEY 없음 — scripts/.env에 설정 필요')
    return 0
  try:
    import OpenDartReader as ODR
  except ImportError:
    logger.error('OpenDartReader 미설치 — pip install opendartreader')
    return 0

  # collect_dart_audit의 함수 재사용 — 감사보고서 파싱 fallback
  from collect_dart_audit import _collect_company as _audit_collect_company

  dart = ODR(DART_KEY)
  client = get_client()
  rows = (
    client.table('companies')
      .select('id,ticker,name_kr')
      .in_('ticker', PRIVATE_REVENUE_TARGETS)
      .execute()
      .data
  )

  this_year = datetime.now().year
  finstate_years = list(range(this_year - 5, this_year))
  audit_years = list(range(this_year - 1, this_year - 1 - 4, -1))

  all_rows: list[dict] = []
  audit_fallback: list[tuple[str, str, str]] = []

  for company in rows:
    name = company['name_kr']
    ticker = company['ticker']
    cid = company['id']
    corp_code = _resolve_corp_code(dart, ticker, name)
    if not corp_code:
      logger.warning(f'{name}: corp_code 해결 실패(자동검색+매뉴얼매핑) — 스킵')
      continue
    logger.info(f'{name}({ticker}): corp_code={corp_code}')

    found_any = False
    for year in finstate_years:
      try:
        df = None
        for fs_div in ['CFS', 'OFS']:
          result = dart.finstate_all(corp_code, year, fs_div=fs_div)
          if result is not None and not result.empty:
            df = result
            break
        if df is None:
          continue

        row: dict = {
          'company_id': cid,
          'period_type': 'annual',
          'fiscal_year': year,
          'fiscal_quarter': None,
          'period_end_date': f'{year}-12-31',
          'currency': 'KRW',
        }
        for _, rec in df.iterrows():
          acct = str(rec.get('account_nm', '')).strip()
          db_col = DART_TO_DB.get(acct)
          if db_col is None or db_col in GENERATED_COLS:
            continue
          raw = str(rec.get('thstrm_amount', '')).replace(',', '').strip()
          if not raw or raw in ('-', '', 'None'):
            continue
          try:
            val = float(raw) / MILLION
            if db_col not in row:
              row[db_col] = round(val, 4)
          except (ValueError, TypeError):
            continue

        if len(row) > 8:
          all_rows.append(row)
          logger.info(f'✓ {name} {year}: finstate_all 수집 ({len(row)-8}개 항목)')
          found_any = True
      except Exception as e:
        logger.error(f'{name} {year} finstate 실패: {e}')

    if not found_any:
      audit_fallback.append((cid, corp_code, name))

  # finstate_all 실패 → 감사보고서 파싱 fallback
  for cid, corp_code, name in audit_fallback:
    logger.info(f'━ {name}({corp_code}): 감사보고서 파싱 fallback')
    audit_rows = _audit_collect_company(dart, cid, corp_code, audit_years)
    if audit_rows:
      all_rows.extend(audit_rows)
      logger.info(f'✓ {name}: 감사보고서에서 {len(audit_rows)}년치 수집')
    else:
      logger.warning(f'✗ {name}: 감사보고서에서도 수집 실패 — 수동 입력 필요')

  if all_rows:
    # 중복 제거 (같은 company_id + fiscal_year는 첫 행 우선)
    deduped: dict[tuple, dict] = {}
    for r in all_rows:
      key = (r['company_id'], r['fiscal_year'])
      if key not in deduped:
        deduped[key] = r
    final = list(deduped.values())
    upsert_rows('financials', final, 'company_id,period_type,fiscal_year,fiscal_quarter')
    return len(final)
  return 0


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument('--listed', action='store_true', help='시총/주가 NULL 상장사만')
  parser.add_argument('--revenue', action='store_true', help='매출 NULL 비상장사만')
  args = parser.parse_args()

  run_listed = args.listed or not (args.listed or args.revenue)
  run_revenue = args.revenue or not (args.listed or args.revenue)

  total = 0
  if run_listed:
    logger.info('━━━ 1단계: 상장사 시총/주가 재수집 ━━━')
    total += _recollect_listed_snapshots()
  if run_revenue:
    logger.info('━━━ 2단계: 비상장사 매출 재수집 (DART) ━━━')
    total += _recollect_private_revenue()

  logger.info(f'재수집 완료 — 총 {total}건')


if __name__ == '__main__':
  try:
    main()
  except Exception as e:
    logger.error(f'재수집 실패: {e}')
    sys.exit(1)
