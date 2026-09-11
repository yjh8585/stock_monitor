#!/usr/bin/env python3
"""연간 재무 데이터의 «말이 안 되는 값» 을 기계로 잡는다. **exit 0 이 정상이다.**

왜 있나 (2026-09-11 신설):
  fnguide·DART 수집이 남긴 오류는 전부 **그럴듯한 값**이었다 — 화면에서도 안 보이고
  lint·타입·테스트 어디에도 안 걸린다. 사람이 눈으로 세어 찾는 데 하루가 걸렸다.
  같은 것을 다시 세지 않으려고 여기 못 박는다(토큰 0 · 매번 공짜로 돈다).

무엇을 보나:
  1. **영업이익 > 매출** — 산술적으로 불가능하다. 단위 오인·계정 오적재의 지문.
  2. **매출 3배 급변** — 이상 «신호» 이지 오류가 아니다. 그래서 확인한 것은 아래
     `VERIFIED_JUMPS` 에 «근거 한 줄과 함께» 적어 두고, 새로 생긴 것만 보고한다.
  3. **1,000배 이웃** — 단위 오인의 전형(진영산업 FY2023: 1,488억 → 148.8조).
  4. **`source` 빈 행** — 값이 틀렸을 때 어느 수집기를 고칠지 특정할 수 없다.
     ⚠️ 이것만 **기준선 방식**이다. 규칙(`financial_sources.py`)이 생기기 전의 seed 행이
     11개 남아 있고, 그 출처를 **지어내는 것이 비워 두는 것보다 나쁘다**. 그래서 «지금
     개수» 를 상수로 박아 두고 **늘어날 때만** 실패시킨다 — 새로 생긴 것은 수집기 회귀다.

🔴 **급변이 허용목록에 있다고 「맞는 값」이라는 뜻이 아니다** — 「사람이 DART 원문과
   대조했고 원문이 그렇더라」는 뜻이다. 값이 바뀌면 비율이 달라져 다시 걸린다.

사용:
  python scripts/verify_financials_sanity.py          # 위반만 출력 · exit 1
  python scripts/verify_financials_sanity.py --list   # 급변 전수 출력(허용분 포함)
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lib.bootstrap import init_script  # noqa: E402

init_script(__file__)

from lib.db import get_client  # noqa: E402

JUMP_RATIO = 3.0

# `source` 가 빈 legacy seed 행의 수 (2026-09-11 실측). 늘어나면 수집기 회귀다.
# 🔴 줄었다면 누군가 채운 것이니 **이 값을 낮춰** 다시 못 늘게 한다.
SOURCELESS_BASELINE = 11

# 2026-09-11 전수 대조로 «DART 원문과 일치» 를 확인한 급변. 키 = (회사명, 시작연도).
# 값 = 왜 그런가. 🔴 근거 없이 여기 추가하지 말 것 — 그러면 이 검사기가 무력해진다.
VERIFIED_JUMPS: dict[tuple[str, int], str] = {
  ('삼기에너지솔루션즈', 2020): '설립 초기 부분기간 — DART 원문 일치',
  ('디에이치오토넥스', 2021): '종속회사 이탈로 FY2022 가 계속영업 기준 재작성 — 두 보고서 모두 원문',
  ('디엔오토모티브', 2021): '2022년 두산공작기계 인수 — 실제 성장',
  ('디와이에이', 2021): '중단사업 재분류 — FY2023 보고서의 전기가 재작성된 값',
  ('에스케이온', 2021): '2021-10 물적분할 설립 — FY2021 은 3개월 부분기간',
  ('에코프로비엠', 2021): '양극재 증설 — 실제 성장(1.49조 → 5.36조)',
  ('케이피엑스헌츠만폴리우레탄오토모티브', 2021): '설립 초기 부분기간 — DART 원문 일치',
  ('우즈오토코리아', 2022): 'DART 원문 일치',
  ('폴라리스오피스', 2022): 'DART 원문 일치',
  ('대성정공', 2023): 'DART 원문 일치',
  ('명신', 2023): 'DART 원문 일치(감소)',
  ('한화로보틱스', 2023): '2023-10 분할 설립 — FY2023 은 부분기간',
  ('다산디엠씨', 2024): 'DART 원문 일치',
  ('에스케이온', 2024): 'DART 원문 일치 — 합병으로 매출 구성이 바뀌었다',
  ('유니트리 로보틱스', 2024): 'yfinance — 실제 급성장',
}


def _fetch_annual(client) -> tuple[dict, dict]:
  companies = (
    client.table('companies').select('id,name_kr,status').eq('status', 'active')
    .execute().data or []
  )
  meta = {c['id']: (c.get('name_kr') or '?') for c in companies}

  rows: list[dict] = []
  start = 0
  while True:
    # 🔴 `.range()` 다중 페이지는 `.order()` 필수 — 빠뜨리면 행이 조용히 누락된다.
    batch = (
      client.table('financials')
      .select('company_id,fiscal_year,revenue,operating_income,source,consolidation')
      .eq('period_type', 'annual')
      .order('company_id').order('fiscal_year')
      .range(start, start + 999).execute().data or []
    )
    rows.extend(batch)
    if len(batch) < 1000:
      break
    start += 1000

  by_company: dict[str, dict[int, dict]] = {}
  for r in rows:
    if r['company_id'] in meta:
      by_company.setdefault(r['company_id'], {})[r['fiscal_year']] = r
  return meta, by_company


def main() -> None:
  ap = argparse.ArgumentParser()
  ap.add_argument('--list', action='store_true', help='허용된 급변까지 전부 출력')
  args = ap.parse_args()

  meta, by_company = _fetch_annual(get_client())
  violations: list[str] = []
  allowed: list[str] = []
  sourceless: list[str] = []

  for cid, years in sorted(by_company.items(), key=lambda kv: meta[kv[0]]):
    name = meta[cid]
    for fy in sorted(years):
      row = years[fy]
      rev = float(row['revenue']) if row.get('revenue') else 0.0
      op = float(row['operating_income']) if row.get('operating_income') else 0.0

      # 1. 영업이익 > 매출
      if rev > 0 and op > rev:
        violations.append(f'[영업이익>매출] {name} FY{fy}: 매출 {rev:,.0f} < 영업이익 {op:,.0f}')

      # 4. source 빈 행 — 기준선 방식(위 docstring 참조)
      if rev > 0 and not row.get('source'):
        sourceless.append(f'{name} FY{fy}')

      nxt = years.get(fy + 1)
      nxt_rev = float(nxt['revenue']) if nxt and nxt.get('revenue') else 0.0
      if rev <= 0 or nxt_rev <= 0:
        continue
      ratio = nxt_rev / rev

      # 3. 1,000배 이웃 = 단위 오인
      if ratio >= 500 or ratio <= 1 / 500:
        violations.append(
          f'[단위 의심] {name} FY{fy}→{fy + 1}: {rev:,.0f} → {nxt_rev:,.0f} ({ratio:,.0f}배)'
        )
        continue

      # 2. 3배 급변
      if ratio > JUMP_RATIO or ratio < 1 / JUMP_RATIO:
        line = f'{name} FY{fy}→{fy + 1}: {rev:,.0f} → {nxt_rev:,.0f} ({ratio:.1f}x)'
        why = VERIFIED_JUMPS.get((name, fy))
        if why:
          allowed.append(f'  (확인됨) {line} — {why}')
        else:
          violations.append(f'[미확인 급변] {line} — DART 원문과 대조할 것')

  if args.list:
    print(f'확인된 급변 {len(allowed)}건')
    for line in allowed:
      print(line)
    print()

  if len(sourceless) > SOURCELESS_BASELINE:
    violations.append(
      f'[source 없음] {len(sourceless)}건 — 기준선 {SOURCELESS_BASELINE} 초과: '
      + ', '.join(sourceless)
    )
  elif sourceless:
    print(
      f'경고: source 가 빈 legacy seed 행 {len(sourceless)}건 '
      f'(기준선 {SOURCELESS_BASELINE} 이하 — 실패시키지 않는다): {", ".join(sourceless)}'
    )

  if violations:
    print(f'위반 {len(violations)}건')
    for v in violations:
      print(f'  {v}')
    sys.exit(1)

  print(f'위반 0건 (확인된 급변 {len(allowed)}건은 허용목록)')


if __name__ == '__main__':
  main()
