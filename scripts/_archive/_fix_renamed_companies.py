"""사명변경된 회사 dart_corp_code 매핑 + companies.name_kr 동기화.

사용자 제공 정보(2026-05-21):
  - 우창정기 → 우창정기 (사명 동일, 동명 회사 중 자동차 부품사 식별 필요)
  - 세정 → 에스제이지세정 (SJG SEJUNG)
  - 동남정밀 → 디엔케이모빌리티 (DNK MOBILITY)
  - 덕양산업 → 디와이덕양 (상장사, ticker=024900)
  - 플라스틱옴니엄 → 오피모빌리티씨파워코리아 (Plastic Omnium 한국법인)
  - HSL일렉트로닉스 → status='hidden' (DART 미등록 + 폐업/통합)

매핑 결과:
  1) DART corp_codes에서 새 이름으로 검색 → corp_code 식별
  2) companies.dart_corp_code 업데이트
  3) companies.name_kr/name 새 이름으로 업데이트 (변경 이력 보존하려면 이전 이름은
     description 등에 기록 권장 — 여기선 단순 rename)
  4) HSL일렉트로닉스는 status='hidden'
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

sys.path.insert(0, str(Path(__file__).parent))
from lib.db import get_client


# (옛 이름, 새 이름, 새 영문명, ticker)
RENAMES = [
    ('세정', '에스제이지세정', 'SJG SEJUNG', None),
    ('동남정밀', '디엔케이모빌리티', 'DNK MOBILITY', None),
    ('덕양산업', '디와이덕양', None, '024900'),
    ('플라스틱옴니엄', '오피모빌리티씨파워코리아', 'Plastic Omnium', None),
]
# 우창정기: 사명 동일. 영문명 "MOBASE PRECISION"으로 자동차 부품사(MOBASE 그룹) 확정.
UCHANG = ('우창정기', 'MOBASE PRECISION')
# 삭제 처리
DELISTED = ['HSL일렉트로닉스']


def main():
    client = get_client()
    try:
        from opendartreader import OpenDartReader as ODR
    except ImportError:
        import OpenDartReader as ODR
    key = os.environ['DART_API_KEY']
    dart = ODR(key)
    codes = dart.corp_codes
    print(f'corp_codes 로드: {len(codes)}개')

    updates_log = []

    # --- 1) 사명변경 5개 ---
    for old_name, new_name, eng_keyword, ticker in RENAMES:
        # 새 이름으로 corp_codes 검색
        candidates = codes[codes['corp_name'].fillna('').str.replace(' ', '') == new_name.replace(' ', '')]
        if candidates.empty:
            # 영문명으로 부분 검색
            if eng_keyword:
                candidates = codes[codes['corp_eng_name'].fillna('').str.contains(eng_keyword, case=False, na=False)]
        if candidates.empty:
            print(f'  ❌ {old_name} → {new_name}: corp_codes 검색 결과 없음')
            continue
        if len(candidates) > 1:
            # ticker가 있으면 stock_code로 좁히기
            if ticker:
                exact_ticker = candidates[candidates['stock_code'].fillna('').astype(str).str.strip() == ticker]
                if not exact_ticker.empty:
                    candidates = exact_ticker
            # 그래도 여러 개면 표시
            if len(candidates) > 1:
                print(f'  ⚠️  {old_name} → {new_name}: 후보 {len(candidates)}개')
                for _, row in candidates.iterrows():
                    print(f'      {row["corp_code"]} {row["corp_name"]} stock_code={row["stock_code"]}')
                continue

        row = candidates.iloc[0]
        corp_code = row['corp_code']

        # DB에서 옛 이름으로 회사 찾기
        co = client.table('companies').select('id,name,name_kr,dart_corp_code,ticker').eq('name_kr', old_name).execute().data
        if not co:
            print(f'  ❌ {old_name}: companies에 없음')
            continue
        c = co[0]
        # UPDATE
        patch = {'dart_corp_code': corp_code, 'name_kr': new_name}
        if ticker and not c.get('ticker'):
            patch['ticker'] = ticker
        client.table('companies').update(patch).eq('id', c['id']).execute()
        updates_log.append({'old': old_name, 'new': new_name, 'corp_code': corp_code,
                            'corp_name': row['corp_name'], 'id': c['id']})
        print(f'  ✓ {old_name} → {new_name} (corp_code={corp_code}, dart명={row["corp_name"]})')

    # --- 2) 우창정기 — 영문명 MOBASE PRECISION 매칭 ---
    old_name, eng = UCHANG
    cands = codes[codes['corp_eng_name'].fillna('').str.contains(eng, case=False, na=False)]
    if cands.empty:
        # 영문명 매칭 실패 → 두 후보 중 자동차 induty 확인 위해 dart.company 호출
        cands = codes[codes['corp_name'].fillna('').str.replace(' ','') == '우창정기']
    if not cands.empty:
        # MOBASE PRECISION 영문명이 있는 것 우선
        with_mobase = cands[cands['corp_eng_name'].fillna('').str.contains('MOBASE', case=False, na=False)]
        if not with_mobase.empty:
            cands = with_mobase
        if len(cands) == 1:
            row = cands.iloc[0]
            corp_code = row['corp_code']
            co = client.table('companies').select('id,name_kr').eq('name_kr', old_name).execute().data
            if co:
                c = co[0]
                client.table('companies').update({'dart_corp_code': corp_code}).eq('id', c['id']).execute()
                updates_log.append({'old': old_name, 'new': old_name, 'corp_code': corp_code,
                                    'corp_name': row['corp_name'], 'id': c['id']})
                print(f'  ✓ {old_name} (MOBASE PRECISION) → corp_code={corp_code}')
        else:
            print(f'  ⚠️  {old_name}: MOBASE 매칭 후에도 후보 {len(cands)}개')
            for _, row in cands.iterrows():
                print(f'      {row["corp_code"]} {row["corp_name"]} eng={row["corp_eng_name"]}')

    # --- 3) HSL일렉트로닉스 → status='hidden' ---
    for name in DELISTED:
        co = client.table('companies').select('id,name_kr,status').eq('name_kr', name).execute().data
        if not co:
            print(f'  ❌ {name}: companies에 없음')
            continue
        client.table('companies').update({'status': 'hidden'}).eq('id', co[0]['id']).execute()
        print(f'  ✓ {name}: status → hidden')

    print(f'\n총 {len(updates_log)}개 매핑 완료')


if __name__ == '__main__':
    main()
