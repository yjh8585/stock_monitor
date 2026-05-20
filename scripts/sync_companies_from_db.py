"""DB → companies.json 일관성 동기화. 추가로 delisted 명단 별도 파일로 export.

흐름:
  1. DB의 companies + company_pages 를 읽어 companies.json 재작성
     (회사명/그룹명/status 등 DB 가 진실원천)
  2. /domestic 노출 + status=delisted 회사 명단 → 참고/domestic_sources/dart_unmatched.json
"""
import json
import sys
from pathlib import Path
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
load_dotenv(ROOT.parent / '.env.local')

from lib.db import get_client

COMPANIES_JSON = ROOT / 'lib' / 'companies.json'
UNMATCHED_JSON = ROOT.parent / '참고' / 'domestic_sources' / 'dart_unmatched.json'

DB_COLS = (
  'ticker', 'name', 'name_kr', 'market', 'country', 'currency',
  'data_source', 'status', 'is_seed', 'group_name', 'homepage_url',
)


def main() -> None:
  client = get_client()

  rows = (
    client.table('companies')
    .select(','.join(DB_COLS) + ',id')
    .order('ticker')
    .execute()
    .data
  )
  pages_rows = client.table('company_pages').select('company_id,page').execute().data
  pages_by_id: dict[str, list[str]] = {}
  for p in pages_rows:
    pages_by_id.setdefault(p['company_id'], []).append(p['page'])

  # companies.json 재작성
  out = []
  for r in rows:
    item = {k: r.get(k) for k in DB_COLS}
    item['pages'] = sorted(pages_by_id.get(r['id'], ['related-stocks']))
    out.append(item)

  # ticker 정렬: 6자리 숫자 → 비상장(한글)
  def sort_key(item):
    tk = item['ticker'] or ''
    return (0 if tk.isdigit() else 1, tk)
  out.sort(key=sort_key)

  COMPANIES_JSON.write_text(
    json.dumps(out, ensure_ascii=False, indent=2),
    encoding='utf-8',
  )
  print(f'companies.json 재작성: {len(out)}건')

  # domestic 노출 + delisted 회사 export
  unmatched = []
  for r in rows:
    pages = pages_by_id.get(r['id'], [])
    if 'domestic' in pages and r.get('status') == 'hidden':
      unmatched.append({
        'ticker': r['ticker'],
        'name_kr': r['name_kr'],
        'data_source': r.get('data_source'),
        'group_name': r.get('group_name'),
      })

  unmatched.sort(key=lambda x: x['name_kr'] or '')
  UNMATCHED_JSON.parent.mkdir(parents=True, exist_ok=True)
  UNMATCHED_JSON.write_text(
    json.dumps(
      {
        '_comment': 'DART 자동 매칭 실패 또는 결산감사보고서 없는 회사. 수동 검토 후 manual_dart_mapping.json에 corp_code 추가하면 다음 collect_dart_domestic 실행 시 재수집 가능.',
        '_count': len(unmatched),
        'companies': unmatched,
      },
      ensure_ascii=False,
      indent=2,
    ),
    encoding='utf-8',
  )
  print(f'dart_unmatched.json 작성: {len(unmatched)}건')


if __name__ == '__main__':
  main()
