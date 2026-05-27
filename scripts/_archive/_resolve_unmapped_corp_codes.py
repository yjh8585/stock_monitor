"""미수집 24개 회사의 DART corp_code 자동 매핑 시도.

전략:
  1) companies 테이블에서 KR active + dart_corp_code IS NULL + financials 2025 미수집 회사 추출
  2) OpenDartReader.corp_codes 로컬 로드
  3) 정규화(공백/특수문자/법인격 제거) 후 정확/부분 매칭
  4) 후보 1개면 자동 UPDATE, 여러 개면 induty_code 자동차(30/31/33/24~33/46) 우선,
     끝까지 모호하면 보류 + 보고
"""
import os
import re
import sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

sys.path.insert(0, str(Path(__file__).parent))
from lib.db import get_client


def _normalize(name: str) -> str:
    name = re.sub(r'[\s\(\)\[\]·、,.]', '', name)
    for legal in ['(주)', '㈜', '주식회사', '유한회사', '유한책임회사', '주식회사', '(주)']:
        name = name.replace(legal, '')
    return name.lower()


def main():
    client = get_client()
    # 미수집 회사 = KR active + dart_corp_code IS NULL + 2025 annual 행 없음
    res = (
        client.table('companies')
        .select('id,name_kr,name,dart_corp_code,country,status')
        .eq('country', 'KR')
        .eq('status', 'active')
        .is_('dart_corp_code', 'null')
        .execute()
    )
    candidates = res.data
    print(f'dart_corp_code 미매핑 KR active 회사: {len(candidates)}개')

    # 2025 annual 행 보유 회사 제외
    has_2025 = (
        client.table('financials')
        .select('company_id')
        .eq('period_type', 'annual')
        .eq('fiscal_year', 2025)
        .execute().data
    )
    has_2025_ids = {r['company_id'] for r in has_2025}
    targets = [c for c in candidates if c['id'] not in has_2025_ids]
    print(f'2025 annual 미수집 + 매핑 미설정: {len(targets)}개')
    print()

    # OpenDartReader corp_codes 로드
    try:
        from opendartreader import OpenDartReader as ODR
    except ImportError:
        import OpenDartReader as ODR
    key = os.environ.get('DART_API_KEY')
    if not key:
        print('DART_API_KEY 미설정 — 매핑 검색 불가, 회사명만 출력')
        for t in targets:
            print(f'  - {t["name_kr"]} (id={t["id"]})')
        return

    dart = ODR(key)
    codes = dart.corp_codes
    if codes is None or codes.empty:
        print('corp_codes 로드 실패')
        return
    codes['_norm'] = codes['corp_name'].fillna('').apply(_normalize)
    cols = list(codes.columns)
    print(f'corp_codes 컬럼: {cols}')

    auto_updates = []
    manual_reviews = []
    not_found = []

    for c in targets:
        name_kr = c['name_kr']
        norm = _normalize(name_kr)
        if not norm:
            not_found.append(c)
            continue
        # 정확 일치
        exact = codes[codes['_norm'] == norm]
        if len(exact) == 1:
            row = exact.iloc[0]
            auto_updates.append({'id': c['id'], 'name_kr': name_kr,
                                 'corp_code': row['corp_code'], 'corp_name': row['corp_name'],
                                 'match': 'exact'})
            continue
        if len(exact) > 1:
            manual_reviews.append({'id': c['id'], 'name_kr': name_kr,
                                   'candidates': exact[['corp_code','corp_name']].to_dict('records'),
                                   'reason': f'정확일치 {len(exact)}개'})
            continue
        # 부분 일치
        partial = codes[codes['_norm'].str.contains(re.escape(norm), na=False)]
        if len(partial) == 0:
            not_found.append(c)
            continue
        if len(partial) == 1:
            row = partial.iloc[0]
            auto_updates.append({'id': c['id'], 'name_kr': name_kr,
                                 'corp_code': row['corp_code'], 'corp_name': row['corp_name'],
                                 'match': 'partial'})
            continue
        manual_reviews.append({'id': c['id'], 'name_kr': name_kr,
                               'candidates': partial.head(8)[['corp_code','corp_name']].to_dict('records'),
                               'reason': f'부분일치 {len(partial)}개'})

    print(f'=== 자동 매핑 가능 {len(auto_updates)}개 ===')
    for u in auto_updates:
        print(f'  {u["name_kr"]:35} → {u["corp_code"]} ({u["corp_name"]}) [{u["match"]}]')

    print(f'\n=== 수동 검토 필요 {len(manual_reviews)}개 ===')
    for r in manual_reviews:
        print(f'  {r["name_kr"]} — {r["reason"]}')
        for cand in r['candidates']:
            print(f'    · {cand["corp_code"]} {cand["corp_name"]}')

    print(f'\n=== DART 검색 결과 없음 {len(not_found)}개 ===')
    for c in not_found:
        print(f'  {c["name_kr"]}')

    # auto_updates 실제 UPDATE 실행
    if auto_updates:
        print(f'\n>>> {len(auto_updates)}개 자동 UPDATE 실행...')
        for u in auto_updates:
            client.table('companies').update({'dart_corp_code': u['corp_code']}).eq('id', u['id']).execute()
            print(f'  ✓ {u["name_kr"]} → {u["corp_code"]}')
        print(f'\n총 {len(auto_updates)}개 dart_corp_code 매핑 완료.')


if __name__ == '__main__':
    main()
