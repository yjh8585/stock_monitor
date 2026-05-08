"""DART unmatched 회사 재매칭 — corp_codes 정확/부분 매칭.

흐름:
  1. dart_unmatched.json 로드 (245개)
  2. DART corp_codes 전체 받아서 정규화 룩업 사전 구성
  3. 회사별 매칭 시도 (정확 → 부분일치)
  4. stock_code 있으면 상장사로 변환 (ticker 교체 + data_source='fnguide')
  5. stock_code 없으면 비상장 corp_code 매핑만 (manual_dart_mapping.json 추가)
  6. companies UPDATE: status='active', name_kr=정확한 corp_name, ticker=교체
  7. 결과 보고 + 여전히 매칭 불가능한 회사 명단

주의: 같은 정규화 이름의 corp가 여럿이면(예: 다스/명신산업) stock_code 있는 것 우선,
     그 다음 가장 짧은 corp_name(가장 단순한 회사명) 우선.
"""
import json
import re
import sys
from pathlib import Path
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
load_dotenv(ROOT.parent / '.env.local')

from lib.db import get_client
from collect_dart_audit import _get_dart

UNMATCHED_PATH = ROOT.parent / '참고' / 'domestic_sources' / 'dart_unmatched.json'
MANUAL_PATH = ROOT / 'lib' / 'manual_dart_mapping.json'
REMATCH_RESULT = ROOT.parent / '참고' / 'domestic_sources' / 'dart_rematch_result.json'


def normalize(s: str) -> str:
  if not s:
    return ''
  s = re.sub(r'주식회사|㈜|\(주\)|\(유\)|\(株\)|\s+|\(\)|\.', '', s)
  return s.strip().lower()


def main() -> None:
  client = get_client()
  odr = _get_dart()
  if not odr:
    sys.exit(1)

  unmatched_data = json.loads(UNMATCHED_PATH.read_text(encoding='utf-8'))
  companies = unmatched_data.get('companies', [])
  print(f'unmatched 회사: {len(companies)}개')

  # corp_codes 사전 구성
  df = odr.corp_codes
  if df is None:
    print('corp_codes 로드 실패')
    return
  print(f'DART 등록 회사: {len(df)}개')

  # 정규화 이름 → 후보 리스트
  by_norm: dict[str, list[dict]] = {}
  for _, row in df.iterrows():
    n = normalize(str(row['corp_name']))
    if not n:
      continue
    stock = str(row.get('stock_code', '')).strip()
    by_norm.setdefault(n, []).append({
      'corp_code': str(row['corp_code']),
      'corp_name': str(row['corp_name']),
      'stock_code': stock if stock and stock != 'nan' else None,
    })

  # 기존 companies의 ticker → id 매핑 (충돌 검출용)
  existing = client.table('companies').select('id,ticker').execute().data
  existing_tickers = {r['ticker']: r['id'] for r in existing}

  results: list[dict] = []
  manual_add: dict[str, str] = {}

  for c in companies:
    name = c['name_kr']
    ticker = c['ticker']
    n = normalize(name)
    if not n:
      results.append({**c, 'matched': False, 'reason': 'empty_norm'})
      continue

    # 정확 매칭만
    cands = by_norm.get(n, [])
    if not cands:
      results.append({**c, 'matched': False, 'reason': 'no_exact_match'})
      continue

    cands.sort(key=lambda x: (x['stock_code'] is None, len(x['corp_name'])))
    best = cands[0]

    new_name = re.sub(r'주식회사|㈜|\(주\)|\(유\)', '', best['corp_name']).strip()
    new_stock = best['stock_code']

    record = {
      **c,
      'matched': True,
      'corp_code': best['corp_code'],
      'corp_name': best['corp_name'],
      'stock_code': new_stock,
    }

    if new_stock:
      # 상장사 ticker 교체 시도. 충돌이면 삭제 후 기존 row에 page 매핑만 추가
      if new_stock in existing_tickers and existing_tickers[new_stock] != existing_tickers.get(ticker):
        old_id = existing_tickers.get(ticker)
        target_id = existing_tickers[new_stock]
        if old_id:
          # company_pages 'domestic' 매핑을 target으로 옮김 (이미 있으면 추가 안 함)
          client.table('company_pages').upsert(
            {'company_id': target_id, 'page': 'domestic'},
            on_conflict='company_id,page', ignore_duplicates=True,
          ).execute()
          # 기존 unmatched row 삭제 (cascade: company_pages 자동 삭제)
          client.table('companies').delete().eq('id', old_id).execute()
          record['action'] = 'merged_to_existing'
      else:
        client.table('companies').update({
          'ticker': new_stock,
          'name_kr': new_name,
          'name': new_name,
          'market': 'KOSPI',
          'data_source': 'fnguide',
          'currency': 'KRW',
          'status': 'active',
        }).eq('ticker', ticker).execute()
        record['action'] = 'ticker_updated_to_listed'
    else:
      manual_add[ticker] = best['corp_code']
      client.table('companies').update({
        'status': 'active',
        'name_kr': new_name,
      }).eq('ticker', ticker).execute()
      record['action'] = 'unlisted_corp_mapped'

    results.append(record)

  # manual_dart_mapping.json 갱신
  manual = json.loads(MANUAL_PATH.read_text(encoding='utf-8'))
  for k, v in manual_add.items():
    if not k.startswith('_'):
      manual[k] = v
  MANUAL_PATH.write_text(json.dumps(manual, ensure_ascii=False, indent=2), encoding='utf-8')

  # 결과 저장
  matched_ok = [r for r in results if r['matched']]
  still_unmatched = [r for r in results if not r['matched']]
  listed_count = sum(1 for r in matched_ok if r.get('stock_code'))
  unlisted_count = len(matched_ok) - listed_count

  REMATCH_RESULT.write_text(
    json.dumps({
      'matched_total': len(matched_ok),
      'still_unmatched': len(still_unmatched),
      'newly_listed': listed_count,
      'newly_unlisted_mapping': unlisted_count,
      'matched': matched_ok,
      'still_unmatched_companies': still_unmatched,
    }, ensure_ascii=False, indent=2),
    encoding='utf-8',
  )

  print(f'\n=== 재매칭 결과 ===')
  print(f'  총 매칭: {len(matched_ok)}개')
  print(f'    - 상장사 변경: {listed_count}개')
  print(f'    - 비상장 매핑: {unlisted_count}개')
  print(f'  여전히 미매칭: {len(still_unmatched)}개')
  print(f'  결과 파일: {REMATCH_RESULT}')


if __name__ == '__main__':
  main()
