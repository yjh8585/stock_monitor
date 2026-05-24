#!/usr/bin/env python3
"""
companies.json을 읽어 Supabase에 동기화하는 시드 스크립트.

처리 흐름:
1. companies 테이블 upsert (ticker 기준, ignore_duplicates=True)
2. company_pages 다대다 매핑 동기화 (pages 배열 → 테이블 row)

기존 companies 행은 보존(ignore_duplicates). 신규 회사만 INSERT.
company_pages는 매번 UPSERT — 페이지 노출 매핑은 항상 최신 상태로.
"""
import json
import sys
from pathlib import Path
from dotenv import load_dotenv
from loguru import logger
from lib.db import get_client
from lib.companies import DEFAULT_PAGES

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

COMPANIES_JSON = Path(__file__).parent / 'lib' / 'companies.json'

# companies 테이블에 직접 매핑되는 컬럼 (그 외는 별도 처리)
COMPANY_COLUMNS = {
  'ticker', 'name', 'name_kr', 'market', 'country', 'currency',
  'data_source', 'status', 'is_seed',
  'last_price', 'last_change_pct', 'last_volume',
  'company_type', 'region', 'products', 'customers',
  'market_cap', 'business_summary',
  'group_name', 'homepage_url',
}


def seedCompanies() -> None:
  """companies.json 데이터를 DB에 삽입한다."""
  companies = json.loads(COMPANIES_JSON.read_text(encoding='utf-8'))
  client = get_client()

  # 1. companies 테이블 upsert (DB 컬럼만 추려서)
  comp_rows = [
    {k: v for k, v in c.items() if k in COMPANY_COLUMNS}
    for c in companies
  ]
  client.table('companies').upsert(
    comp_rows, on_conflict='ticker', ignore_duplicates=True,
  ).execute()
  logger.info(f"companies upsert 완료: {len(comp_rows)}건")

  # 2. ticker → id 매핑
  rows = client.table('companies').select('id,ticker').execute().data
  ticker_to_id = {r['ticker']: r['id'] for r in rows}

  # 3. company_pages 동기화
  page_rows = []
  for c in companies:
    cid = ticker_to_id.get(c['ticker'])
    if not cid:
      continue
    pages = c.get('pages') or DEFAULT_PAGES
    for p in pages:
      page_rows.append({'company_id': cid, 'page': p})

  if page_rows:
    client.table('company_pages').upsert(
      page_rows, on_conflict='company_id,page', ignore_duplicates=True,
    ).execute()
    logger.info(f"company_pages upsert 완료: {len(page_rows)}건")


if __name__ == '__main__':
  try:
    seedCompanies()
  except Exception as e:
    logger.error(f"시드 실패: {e}")
    sys.exit(1)
