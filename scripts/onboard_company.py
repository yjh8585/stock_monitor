"""신규 회사 onboarding 통합 스크립트.

회사 1건을 식별 → 재무·메타(설명/제품/고객사/홈페이지)·뉴스를 일괄 수집 → 캐시 무효화.

사용:
  python scripts/onboard_company.py --ticker 005380
  python scripts/onboard_company.py --name "현대모비스"
  python scripts/onboard_company.py --company-id <uuid>

전제:
  companies 테이블에 회사 row가 이미 존재해야 함 (ticker/name/id 중 하나로 조회).
  본 스크립트는 INSERT를 하지 않는다 — 회사 추가는 별도 (SQL/관리 UI).

수집 항목:
  1) financials  (재무) — data_source 라우팅: yfinance / fnguide / DART / web_search
  2) meta        (사업 요약/제품/고객사/홈페이지 URL) — Claude web_search
  3) news        (뉴스) — collect_news (네이버·구글)
  4) 캐시 무효화 — /api/revalidate 호출 (related_stocks_view, domestic_stocks_view, parts_top100_stocks_view)

주가는 매시간 collect_prices_live cron이 모든 active 회사를 fetch하므로
신규 회사도 다음 사이클에서 자동 수집된다.
"""
import argparse
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

sys.path.insert(0, str(Path(__file__).parent))
from lib.db import WriteSession, get_client  # noqa: E402


def _resolve_company(client, ticker: str | None, name: str | None, company_id: str | None) -> dict | None:
  """ticker/name/id 중 하나로 companies row 조회. 우선순위: id > ticker > name."""
  q = client.table('companies').select(
    'id,ticker,name,name_kr,country,market,data_source,status,'
    'business_summary,homepage_url,products,customers'
  )
  if company_id:
    rows = q.eq('id', company_id).execute().data or []
  elif ticker:
    rows = q.eq('ticker', ticker).execute().data or []
  elif name:
    rows = q.or_(f'name.eq.{name},name_kr.eq.{name}').execute().data or []
  else:
    return None
  if not rows:
    return None
  return rows[0]


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument('--ticker', help='회사 ticker (예: 005380 또는 비상장 회사명)')
  parser.add_argument('--name', help='회사 name 또는 name_kr (정확 일치)')
  parser.add_argument('--company-id', dest='company_id', help='UUID')
  parser.add_argument('--skip-news', action='store_true', help='뉴스 수집 skip')
  parser.add_argument('--skip-revalidate', action='store_true', help='캐시 무효화 skip')
  parser.add_argument(
    '--fiscal-year-end-month', dest='fye_month', type=int,
    help='회계 결산월 (1~12). 비-12월 결산 회사일 때만 지정 (예: 도요타=3). '
         '미지정 시 companies 테이블의 기존값(또는 default 12) 유지.',
  )
  args = parser.parse_args()

  if not (args.ticker or args.name or args.company_id):
    parser.error('--ticker, --name, --company-id 중 하나는 필수')
  if args.fye_month is not None and not (1 <= args.fye_month <= 12):
    parser.error('--fiscal-year-end-month는 1~12 사이여야 합니다.')

  with WriteSession() as w:
    company = _resolve_company(w, args.ticker, args.name, args.company_id)
    if not company:
      logger.error(f'회사 찾을 수 없음: ticker={args.ticker}, name={args.name}, id={args.company_id}')
      logger.error('먼저 companies 테이블에 회사를 INSERT 한 뒤 본 스크립트를 실행하세요.')
      sys.exit(1)

    if company.get('status') != 'active':
      logger.warning(f"회사 상태가 active가 아님: {company.get('status')}. 그대로 진행.")

    # 결산월 명시적 지정 시 companies에 SET (재무 수집 전에 반영되어야 한국식 -1 보정이 적용됨)
    if args.fye_month is not None:
      w.table('companies').update(
        {'fiscal_year_end_month': args.fye_month}
      ).eq('id', company['id']).execute()
      logger.info(f"결산월 SET: {company['name_kr'] or company['name']} → {args.fye_month}월")

    logger.info(
      f"onboarding 시작: {company['name_kr']} ({company.get('ticker','?')}) "
      f"country={company.get('country','?')}, market={company.get('market') or '비상장'}, "
      f"data_source={company.get('data_source') or '미지정'}"
    )

  # enrich_company가 TARGET_TICKERS 환경변수로 단일 회사 필터링.
  # enrich_company 자체가 WriteSession을 사용하므로 onboard의 with 블록 밖에서 호출한다
  # (한 세션을 너무 오래 점유하지 않도록 + enrich가 자체 revalidate 처리).
  ticker_for_filter = company.get('ticker') or company['name_kr']
  os.environ['TARGET_TICKERS'] = ticker_for_filter

  original_argv = sys.argv[:]
  try:
    enrich_argv = ['enrich_company.py']
    if args.skip_news:
      enrich_argv.append('--skip-news')
    sys.argv = enrich_argv
    logger.info('=== enrich_company 실행 (재무 + 메타 + 뉴스) ===')
    from enrich_company import main as enrich_main  # noqa: E402
    enrich_main()
  except SystemExit as e:
    # argparse가 종료시키지 않도록
    if e.code not in (None, 0):
      logger.error(f'enrich_company 종료 코드 {e.code}')
      raise
  finally:
    sys.argv = original_argv

  # 결과 안내 (read-only) — 캐시 무효화는 enrich_company의 WriteSession이 이미 처리.
  logger.info('=== 결과 검증 ===')
  fresh = (
    get_client().table('companies').select(
      'business_summary,homepage_url,products,customers'
    ).eq('id', company['id']).execute().data or [{}]
  )[0]
  logger.info(f"  business_summary: {'✓' if fresh.get('business_summary') else '✗'}")
  logger.info(f"  homepage_url:     {'✓ ' + fresh['homepage_url'] if fresh.get('homepage_url') else '✗'}")
  logger.info(f"  products:         {'✓' if fresh.get('products') else '✗'} ({len(fresh.get('products') or [])}개)")
  logger.info(f"  customers:        {'✓' if fresh.get('customers') else '✗'} ({len(fresh.get('customers') or [])}개)")

  logger.info('')
  logger.info('다음 단계:')
  logger.info(f"  • 주가는 다음 collect_prices_live cron 사이클에서 자동 수집 (5분~1시간 내)")
  logger.info(f"  • 회사를 특정 페이지에 노출하려면 company_pages 테이블에 INSERT")
  logger.info(f"  • KR 상장사는 fnguide Snapshot 추가 정보 위해 다음 일정에 collect-kr-snapshot 워크플로 자동 실행")


if __name__ == '__main__':
  main()
