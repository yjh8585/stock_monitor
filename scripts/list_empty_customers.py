"""빈 customers 회사 list 추출 (Claude Code WebSearch 협업용).

흐름:
  1. 본 스크립트 실행 → 빈 customers 회사 list를 markdown/json으로 출력
  2. Claude Code (대화 어시스턴트) 가 list 받아 WebSearch tool로 회사별 검색
  3. 검색 결과 분석 후 SQL UPDATE (Anthropic API credit 소비 없음)

용법:
  python scripts/list_empty_customers.py            # 콘솔 markdown 표
  python scripts/list_empty_customers.py --json     # JSON 출력
  python scripts/list_empty_customers.py --pages parts-top100,domestic   # 특정 페이지만
"""
import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client  # noqa: E402


def main():
  ap = argparse.ArgumentParser()
  ap.add_argument('--pages', default='parts-top100,domestic',
                  help='쉼표 분리 page list')
  ap.add_argument('--json', action='store_true', help='JSON 출력')
  args = ap.parse_args()

  pages = [p.strip() for p in args.pages.split(',') if p.strip()]
  client = get_client()

  cp = client.table('company_pages').select('company_id,page').in_('page', pages).execute().data
  cids = list({p['company_id'] for p in cp})
  rows = (
    client.table('companies')
    .select('id,ticker,name,name_kr,country,homepage_url,customers,company_type')
    .in_('id', cids).eq('status', 'active').execute().data
  )
  empty = [
    r for r in rows
    if not r.get('customers') or len(r.get('customers') or []) == 0
  ]
  empty.sort(key=lambda r: (r.get('country') or 'ZZ', r.get('name_kr') or ''))

  if args.json:
    out = [
      {'ticker': r['ticker'], 'name': r['name'], 'name_kr': r['name_kr'],
       'country': r.get('country'), 'homepage_url': r.get('homepage_url'),
       'company_type': r.get('company_type')}
      for r in empty
    ]
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return

  print(f'# 빈 customers 회사 list ({len(empty)}개 / 전체 {len(rows)}개)\n')
  print('| ticker | 회사명 | country | type | homepage |')
  print('|---|---|---|---|---|')
  for r in empty:
    hp = (r.get('homepage_url') or '')[:60]
    print(f'| {r["ticker"]} | {r["name_kr"]} ({r["name"][:30]}) | {r.get("country","")} | {r.get("company_type","")} | {hp} |')

  print('\n## 사용 안내')
  print('이 list를 Claude Code 어시스턴트에게 보여주고 "이 회사들 customers WebSearch로 보강해줘"라고 지시하세요.')
  print('Claude Code 가 회사별 WebSearch + 결과 분석 + SQL UPDATE를 단계적으로 처리합니다.')
  print('Anthropic API credit 소비 없이 Claude Code 구독에 포함된 검색 인프라를 사용합니다.')


if __name__ == '__main__':
  main()
