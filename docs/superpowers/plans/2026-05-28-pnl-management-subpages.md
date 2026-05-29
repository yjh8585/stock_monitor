# 손익관리 하부 페이지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 경영관리 페이지에 4월 데이터 반영 + 신규 이익기여도 차트 + 시사점 분리, 그리고 계획 페이지에 계획 대비 실적·달성율 콤보 차트 8종을 신규 구현한다.

**Architecture:** 신규 사외비 테이블 `pnl_plan`(계획 시트 long-format)을 추가하고, `lib/plan/`(source+aggregate pure)과 `components/management/plan/`(공통 `PlanAchievementChart` + 8 래퍼)을 만든다. 경영관리 페이지는 `pnl_entries`를 재적재하고 신규 `ProfitContribution`(10번)을 삽입, `Insights`를 14·15 독립 섹션으로 분리한다.

**Tech Stack:** Next.js 16(App Router, `'use cache'`), React 19, TypeScript, Recharts(ComposedChart), Supabase(`confidentialDb` service_role), Python(openpyxl + postgrest-py + WriteSession), Vitest.

> **데이터 보안(필수):** 모든 입력은 사외비. 금액 숫자 값을 Claude 컨텍스트/stdout에 노출 금지. 적재 스크립트는 블라인드 작성 + **사용자가 직접 실행**. 검증 출력은 집계/플래그만. 스펙 §0 참고.

---

## 파일 구조

**생성:**

- `supabase/migrations/20260528000001_create_pnl_plan.sql` — pnl_plan 테이블 + RLS deny
- `scripts/sync_pnl_plan.py` — 계획 시트 → pnl_plan 적재 (블라인드)
- `lib/plan/types.ts` — 계획 도메인 타입
- `lib/plan/aggregate.ts` — 차트 시리즈 빌더 (pure)
- `lib/plan/__tests__/aggregate.test.ts` — 단위 테스트
- `lib/plan/source.ts` — fetch + 'use cache'
- `components/management/plan/PlanAchievementChart.tsx` — 공통 콤보 차트
- `components/management/plan/PlanDashboard.tsx` — 8 차트 컨테이너
- `components/management/plan/{Order,Revenue,OpIncome,Us,Sangsuk,Jilin,Improvement,Factory}TargetChart.tsx` — 8 래퍼
- `components/management/pnl/ProfitContribution.tsx` — 경영관리 10번 신규
- `scripts/sync_pnl_excel.py` — `_archive`에서 복원·수정

**수정:**

- `lib/database.types.ts` — pnl_plan 타입 (Supabase 생성)
- `lib/supabase/confidential.ts` — CONFIDENTIAL_TABLES에 pnl_plan
- `app/management/plan/page.tsx` — placeholder → PlanDashboard
- `components/management/pnl/PnlDashboard.tsx` — ProfitContribution 삽입 + Insights 분리
- `components/management/pnl/WaterfallProfitability.tsx` — section 승격 + h2 "14."
- `components/management/pnl/CustomerParetoChart.tsx` — section 승격 + h2 "15."
- `components/management/pnl/YoyMonthlyCompare.tsx` — h2 "10." → "11."
- `components/management/pnl/YoyMonthlyFiltered.tsx` — h2 "11." → "12."
- `components/management/pnl/YoyProductCustomer.tsx` — h2 "12." → "13."
- `AGENTS.md` — 라우트/도메인/스크립트/마이그레이션 갱신

**삭제:**

- `components/management/pnl/Insights.tsx` — 분리로 미사용

---

## Task 1: pnl_plan 마이그레이션

**Files:**

- Create: `supabase/migrations/20260528000001_create_pnl_plan.sql`

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- 손익 계획 대비 실적 — 계획 시트(long-format) 적재.
-- 한 행 = (분류,항목,기준,계획/실적,연도,연간/월) 단위의 단일 지표값.
-- 사외비: RLS enable + 정책 없음(default deny). service_role(admin)만 접근.

CREATE TABLE pnl_plan (
  category     text NOT NULL,                  -- 수주|손익|미국|상숙|지린|손익개선|공장
  item         text NOT NULL,                  -- 수주액|수주액(취소 제외)|매출|영업이익|Design VE|MCIP|단가인상|구동 매출|제동 매출|조향 매출|전장 매출
  basis        text NOT NULL CHECK (basis IN ('consolidated','standalone')),
  kind         text NOT NULL CHECK (kind IN ('plan','actual')),
  period_year  int  NOT NULL,
  period_type  text NOT NULL CHECK (period_type IN ('annual','month')),
  period_month int  NOT NULL DEFAULT 0,        -- 0=연간, 1~12=월별
  unit         text NOT NULL,                  -- 억원|USD 백만|백만원
  value        numeric(18,4),
  PRIMARY KEY (category, item, basis, kind, period_year, period_type, period_month)
);

CREATE INDEX idx_pnl_plan_lookup ON pnl_plan(category, item, basis, kind, period_year);

ALTER TABLE pnl_plan ENABLE ROW LEVEL SECURITY;
-- 정책 생성하지 않음 → anon/authenticated default deny. service_role은 RLS 우회.

COMMENT ON TABLE pnl_plan IS '한세모빌리티 계획 대비 실적 — 사외비. 서버 컴포넌트의 admin client(service_role)로만 접근.';
```

- [ ] **Step 2: 마이그레이션 적용 (사용자 또는 MCP)**

Supabase MCP `apply_migration`(name=`create_pnl_plan`) 또는 사용자가 Supabase 대시보드에서 실행.
Expected: 테이블 생성, advisor에 "RLS enabled no policy" 경고(의도된 사외비).

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/20260528000001_create_pnl_plan.sql
git commit -m "feat(plan): pnl_plan 사외비 테이블 마이그레이션"
```

---

## Task 2: database.types + confidential 등록

**Files:**

- Modify: `lib/database.types.ts` (Supabase 생성)
- Modify: `lib/supabase/confidential.ts`

- [ ] **Step 1: 타입 재생성**

Supabase MCP `generate_typescript_types` 호출 → 결과를 `lib/database.types.ts`에 반영(pnl_plan Row/Insert/Update 추가).

- [ ] **Step 2: CONFIDENTIAL_TABLES에 추가**

`lib/supabase/confidential.ts`의 `CONFIDENTIAL_TABLES` 배열을 읽고 `'pnl_plan'`을 추가한다. 예 (실제 배열 형식에 맞춰):

```ts
const CONFIDENTIAL_TABLES = [
  'pnl_entries',
  'pnl_cost_structure',
  'chat_audit_log',
  'pnl_plan',
] as const;
```

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: PASS (pnl_plan이 confidentialDb union에 포함).

- [ ] **Step 4: 커밋**

```bash
git add lib/database.types.ts lib/supabase/confidential.ts
git commit -m "feat(plan): pnl_plan 타입 + confidentialDb 등록"
```

---

## Task 3: sync_pnl_excel.py 복원·수정 (4월 데이터 재적재)

**Files:**

- Create: `scripts/sync_pnl_excel.py` (`scripts/_archive/sync_pnl_excel.py` 복원 후 수정)

원본은 `scripts/_archive/sync_pnl_excel.py`. 아래 2가지만 수정한다.

- [ ] **Step 1: 원본 복사 + EXCEL_PATH를 최신 glob으로**

`_archive` 원본을 `scripts/sync_pnl_excel.py`로 복사. 상단 `EXCEL_PATH` 정의를 교체:

```python
import glob as _glob

def _latest_excel() -> Path:
    base = Path(__file__).resolve().parents[1] / '참고' / '손익'
    cands = sorted(base.glob('자료정리_월별손익*.xlsx'))
    if not cands:
        raise FileNotFoundError(f'손익 엑셀 없음: {base}/자료정리_월별손익*.xlsx')
    # 날짜 suffix가 사전순 정렬되므로 마지막이 최신. '자료정리_월별손익.xlsx'(suffix 없음)는 가장 앞.
    return cands[-1]

EXCEL_PATH = _latest_excel()
```

- [ ] **Step 2: summarize()에서 revenue_sum 제거 (금액 비노출)**

`summarize()` 함수의 `revenue_sum` 누적·출력을 삭제하고 rows/months만 출력하도록 변경:

```python
def summarize(entries: Iterable[dict[str, Any]]) -> None:
    """dry-run 요약 출력 (기준×연도×월수). 금액 비노출 — 행수·월수만."""
    from collections import defaultdict
    agg: dict[tuple[str, int], dict[str, Any]] = defaultdict(
        lambda: {'rows': 0, 'months': set()}
    )
    for e in entries:
        key = (e['basis'], e['period_year'])
        agg[key]['rows'] += 1
        agg[key]['months'].add(e['period_month'])
    logger.info('--- dry-run 요약 (basis × period_year) — 금액 비노출 ---')
    for key in sorted(agg.keys()):
        v = agg[key]
        months = sorted(v['months'])
        logger.info(f'  {key[0]:<13} {key[1]} | rows={v["rows"]:>5} | months={months}')
```

- [ ] **Step 3: 사용자 직접 실행 (dry-run → 적재)**

사용자에게 안내:

```
! scripts/venv/Scripts/python.exe scripts/sync_pnl_excel.py --dry-run
! scripts/venv/Scripts/python.exe scripts/sync_pnl_excel.py
```

Expected(dry-run): 헤더 검증 통과, 2026 months가 `[1,2,3,4]` 포함(연결\_월/월). 금액 미출력.

- [ ] **Step 4: 커밋**

```bash
git add scripts/sync_pnl_excel.py
git commit -m "feat(plan): sync_pnl_excel 최신 엑셀 glob + 금액 비노출 요약"
```

---

## Task 4: sync_pnl_plan.py (계획 시트 적재, 블라인드)

**Files:**

- Create: `scripts/sync_pnl_plan.py`

계획 시트 컬럼: `1연도 2연간/월 3계획/실적 4연결/별도 5분류 6항목 7단위 8밸류`. 헤더 row 1, 데이터 row 2~.

- [ ] **Step 1: 스크립트 작성**

```python
#!/usr/bin/env python3
"""손익 계획 시트(자료정리_월별손익*.xlsx '계획') → Supabase pnl_plan 적재.

금액 비노출: 요약은 (분류·항목·kind)별 행수·연도 커버리지·null 카운트만 출력.
사용자가 직접 실행한다. WriteSession으로 자동 revalidate('pnl_plan').
"""
import argparse
import sys
from pathlib import Path
from typing import Any

import openpyxl
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')
sys.path.insert(0, str(Path(__file__).parent))
from lib.db import WriteSession  # noqa: E402

SHEET = '계획'
TABLE = 'pnl_plan'
CONFLICT = 'category,item,basis,kind,period_year,period_type,period_month'
HEADER_ROW = 1
DATA_START = 2
# 1-indexed 컬럼
COL = {'year': 1, 'pm': 2, 'kind': 3, 'basis': 4, 'category': 5, 'item': 6, 'unit': 7, 'value': 8}
EXPECTED_HEADERS = {1: '연도', 2: '연간/월', 3: '계획/실적', 4: '연결/별도', 5: '분류', 6: '항목', 7: '단위', 8: '밸류'}
BASIS_MAP = {'연결': 'consolidated', '별도': 'standalone'}
KIND_MAP = {'계획': 'plan', '실적': 'actual'}


def _latest_excel() -> Path:
    base = Path(__file__).resolve().parents[1] / '참고' / '손익'
    cands = sorted(base.glob('자료정리_월별손익*.xlsx'))
    if not cands:
        raise FileNotFoundError(f'손익 엑셀 없음: {base}')
    return cands[-1]


def _num(v: Any) -> float | None:
    if v is None or v == '' or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    return None


def _txt(v: Any) -> str:
    return '' if v is None else str(v).strip()


def validate_headers(ws) -> list[str]:
    errs = []
    for c, expected in EXPECTED_HEADERS.items():
        actual = _txt(ws.cell(HEADER_ROW, c).value)
        if actual != expected:
            errs.append(f'  컬럼 {c}: 기대 "{expected}" 실제 "{actual}"')
    return errs


def row_to_entry(ws, r: int) -> dict[str, Any] | None:
    year = ws.cell(r, COL['year']).value
    if not isinstance(year, (int, float)):
        return None
    category = _txt(ws.cell(r, COL['category']).value)
    item = _txt(ws.cell(r, COL['item']).value)
    if not category or not item:
        return None
    basis = BASIS_MAP.get(_txt(ws.cell(r, COL['basis']).value))
    kind = KIND_MAP.get(_txt(ws.cell(r, COL['kind']).value))
    if basis is None or kind is None:
        return None
    pm_raw = ws.cell(r, COL['pm']).value
    if isinstance(pm_raw, (int, float)) and 1 <= int(pm_raw) <= 12:
        period_type, period_month = 'month', int(pm_raw)
    elif _txt(pm_raw) == '연간':
        period_type, period_month = 'annual', 0
    else:
        return None
    return {
        'category': category, 'item': item, 'basis': basis, 'kind': kind,
        'period_year': int(year), 'period_type': period_type, 'period_month': period_month,
        'unit': _txt(ws.cell(r, COL['unit']).value), 'value': _num(ws.cell(r, COL['value']).value),
    }


def summarize(entries: list[dict[str, Any]]) -> None:
    from collections import defaultdict
    agg = defaultdict(lambda: {'rows': 0, 'years': set(), 'nulls': 0})
    for e in entries:
        k = (e['category'], e['item'], e['kind'])
        agg[k]['rows'] += 1
        agg[k]['years'].add(e['period_year'])
        if e['value'] is None:
            agg[k]['nulls'] += 1
    logger.info('--- 계획 요약 (분류·항목·kind) — 금액 비노출 ---')
    for k in sorted(agg.keys()):
        v = agg[k]
        logger.info(f'  {k} | rows={v["rows"]} | years={sorted(v["years"])} | nulls={v["nulls"]}')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    path = _latest_excel()
    logger.info(f'엑셀 로드: {path}')
    wb = openpyxl.load_workbook(path, data_only=True)
    try:
        ws = wb[SHEET]
        errs = validate_headers(ws)
        if errs:
            logger.error('헤더 불일치:\n' + '\n'.join(errs))
            return 2
        entries = []
        for r in range(DATA_START, ws.max_row + 1):
            e = row_to_entry(ws, r)
            if e is not None:
                entries.append(e)
    finally:
        wb.close()

    logger.info(f'적재 대상 {len(entries)}행')
    summarize(entries)
    if args.dry_run:
        logger.success('dry-run 완료')
        return 0
    if not entries:
        logger.warning('적재할 행 없음')
        return 0
    with WriteSession() as w:
        for i in range(0, len(entries), 500):
            chunk = entries[i:i + 500]
            w.table(TABLE).upsert(chunk, on_conflict=CONFLICT).execute()
    logger.success(f'pnl_plan upsert 완료: {len(entries)}행')
    return 0


if __name__ == '__main__':
    sys.exit(main())
```

> WriteSession의 `w.table(...).upsert(...).execute()` 시그니처는 `scripts/lib/db.py`를 읽어 실제 API에 맞춘다. `on_conflict` 인자명·체이닝이 다르면 조정. (postgrest-py 패턴.)

- [ ] **Step 2: db.py의 WriteSession API 확인**

Run: `scripts/lib/db.py` 읽기. `WriteSession` / `upsert` 시그니처 확인 후 Step 1 코드 정합.
Expected: `with WriteSession() as w: w.table('x').upsert(rows, on_conflict=...).execute()` 형태 확인.

- [ ] **Step 3: 사용자 직접 실행**

안내:

```
! scripts/venv/Scripts/python.exe scripts/sync_pnl_plan.py --dry-run
! scripts/venv/Scripts/python.exe scripts/sync_pnl_plan.py
```

Expected(dry-run): 헤더 통과. 예시 — `('공장','구동 매출','actual')`은 years에 2026 포함하되 nulls≥1(2026 공백). `('수주','수주액(취소 제외)','actual')` years=[2018,2019,2020,2021,2022,2024].

- [ ] **Step 4: 커밋**

```bash
git add scripts/sync_pnl_plan.py
git commit -m "feat(plan): sync_pnl_plan 계획 시트 적재 스크립트"
```

---

## Task 5: lib/plan/types.ts

**Files:**

- Create: `lib/plan/types.ts`

- [ ] **Step 1: 타입 정의**

```ts
/** 손익 계획(pnl_plan) 도메인 타입. */
import type { Basis } from '@/lib/pnl/types';

export type PlanKind = 'plan' | 'actual';
export type PeriodType = 'annual' | 'month';

/** pnl_plan 테이블 row */
export interface PlanRow {
  category: string;
  item: string;
  basis: Basis;
  kind: PlanKind;
  period_year: number;
  period_type: PeriodType;
  period_month: number;
  unit: string;
  value: number | null;
}

/** 콤보 차트 1개 연도 포인트 */
export interface AchievementPoint {
  /** 표시 라벨 ('2025' | '2026 YTD') */
  yearLabel: string;
  year: number;
  /** YTD(진행 연도)면 true */
  ytd: boolean;
  plan: number | null;
  actual: number | null;
  /** 달성율 % = actual/plan*100. plan 0/null이면 null */
  rate: number | null;
}
```

- [ ] **Step 2: 커밋**

```bash
git add lib/plan/types.ts
git commit -m "feat(plan): 계획 도메인 타입"
```

---

## Task 6: lib/plan/aggregate.ts + 테스트 (TDD)

**Files:**

- Create: `lib/plan/aggregate.ts`
- Create: `lib/plan/__tests__/aggregate.test.ts`

핵심 순수 함수 — 단위 정규화·YTD 합산·달성율·취소제외 fill.

- [ ] **Step 1: 실패 테스트 작성**

`lib/plan/__tests__/aggregate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeUnit, buildAchievement, fillCancelExcluded } from '../aggregate';
import type { PlanRow } from '../types';

function row(p: Partial<PlanRow>): PlanRow {
  return {
    category: '수주',
    item: '수주액',
    basis: 'consolidated',
    kind: 'plan',
    period_year: 2025,
    period_type: 'annual',
    period_month: 0,
    unit: '억원',
    value: 0,
    ...p,
  };
}

describe('normalizeUnit', () => {
  it('백만원 → 억원 (÷100)', () => {
    expect(normalizeUnit(500, '백만원', '억원')).toBe(5);
  });
  it('같은 단위는 그대로', () => {
    expect(normalizeUnit(10, '억원', '억원')).toBe(10);
  });
  it('null은 null', () => {
    expect(normalizeUnit(null, '백만원', '억원')).toBeNull();
  });
});

describe('buildAchievement', () => {
  it('연간 계획+실적 → 달성율', () => {
    const rows: PlanRow[] = [
      row({ kind: 'plan', period_year: 2024, value: 100 }),
      row({ kind: 'actual', period_year: 2024, value: 80 }),
    ];
    const pts = buildAchievement(rows, { unit: '억원' });
    expect(pts).toEqual([
      { yearLabel: '2024', year: 2024, ytd: false, plan: 100, actual: 80, rate: 80 },
    ]);
  });

  it('2026 월별 실적은 YTD 합산, 계획은 연간 그대로, 라벨 YTD', () => {
    const rows: PlanRow[] = [
      row({ kind: 'plan', period_year: 2026, period_type: 'annual', value: 120 }),
      row({ kind: 'actual', period_year: 2026, period_type: 'month', period_month: 1, value: 10 }),
      row({ kind: 'actual', period_year: 2026, period_type: 'month', period_month: 2, value: 20 }),
    ];
    const pts = buildAchievement(rows, { unit: '억원' });
    expect(pts).toEqual([
      { yearLabel: '2026 YTD', year: 2026, ytd: true, plan: 120, actual: 30, rate: 25 },
    ]);
  });

  it('계획 없으면 rate null', () => {
    const rows: PlanRow[] = [row({ kind: 'actual', period_year: 2023, value: 50 })];
    const pts = buildAchievement(rows, { unit: '억원' });
    expect(pts[0].plan).toBeNull();
    expect(pts[0].rate).toBeNull();
  });

  it('백만원 실적을 억원으로 환산', () => {
    const rows: PlanRow[] = [
      row({ kind: 'plan', period_year: 2026, period_type: 'annual', unit: '억원', value: 5 }),
      row({
        kind: 'actual',
        period_year: 2026,
        period_type: 'month',
        period_month: 1,
        unit: '백만원',
        value: 200,
      }),
    ];
    const pts = buildAchievement(rows, { unit: '억원' });
    expect(pts[0].actual).toBe(2); // 200백만원 = 2억원
    expect(pts[0].rate).toBe(40);
  });
});

describe('fillCancelExcluded', () => {
  it('취소제외 결측 연도는 수주액 실적으로 채운다', () => {
    const base = [
      { yearLabel: '2024', year: 2024, ytd: false, plan: 100, actual: 90, rate: 90 },
      {
        yearLabel: '2025',
        year: 2025,
        ytd: false,
        plan: 110,
        actual: 100,
        rate: (100 / 110) * 100,
      },
    ];
    const cancel = [
      { yearLabel: '2024', year: 2024, ytd: false, plan: 100, actual: 85, rate: 85 },
      // 2025 없음
    ];
    const filled = fillCancelExcluded(base, cancel);
    expect(filled.find((p) => p.year === 2024)!.actual).toBe(85);
    expect(filled.find((p) => p.year === 2025)!.actual).toBe(100); // base로 채움
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- lib/plan/__tests__/aggregate.test.ts`
Expected: FAIL (모듈/함수 없음).

- [ ] **Step 3: aggregate.ts 구현**

```ts
/** 손익 계획 차트 시리즈 빌더 (순수 함수). */
import type { AchievementPoint, PlanRow } from './types';

/** 단위 환산. 지원: 억원↔백만원(1억원=100백만원). USD/동일단위는 그대로. */
export function normalizeUnit(value: number | null, from: string, to: string): number | null {
  if (value === null) return null;
  if (from === to) return value;
  if (from === '백만원' && to === '억원') return value / 100;
  if (from === '억원' && to === '백만원') return value * 100;
  // 그 외(USD 등)는 환산표 없음 — 호출자가 동일 단위만 전달한다고 가정.
  return value;
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

interface BuildOpts {
  /** 차트 표시 단위. 모든 plan/actual을 이 단위로 환산. */
  unit: string;
}

/**
 * PlanRow[] → 연도별 (계획·실적·달성율) 포인트.
 *
 * 규칙:
 * - 계획(plan)은 annual 값만 사용 (월별 계획 없음).
 * - 실적(actual): annual이 있으면 그 값. annual 없고 month가 있으면 1~12 합산(YTD) + ytd=true.
 * - 단위는 opts.unit으로 환산.
 * - rate = actual/plan*100. plan null/0이면 null.
 * - 연도 오름차순.
 */
export function buildAchievement(rows: readonly PlanRow[], opts: BuildOpts): AchievementPoint[] {
  const years = new Set<number>();
  for (const r of rows) years.add(r.period_year);

  const points: AchievementPoint[] = [];
  for (const year of Array.from(years).sort((a, b) => a - b)) {
    // 계획 — annual
    const planRow = rows.find(
      (r) => r.period_year === year && r.kind === 'plan' && r.period_type === 'annual'
    );
    const plan =
      planRow && planRow.value !== null
        ? normalizeUnit(planRow.value, planRow.unit, opts.unit)
        : null;

    // 실적 — annual 우선, 없으면 month 합산
    const actualAnnual = rows.find(
      (r) => r.period_year === year && r.kind === 'actual' && r.period_type === 'annual'
    );
    let actual: number | null = null;
    let ytd = false;
    if (actualAnnual && actualAnnual.value !== null) {
      actual = normalizeUnit(actualAnnual.value, actualAnnual.unit, opts.unit);
    } else {
      const months = rows.filter(
        (r) => r.period_year === year && r.kind === 'actual' && r.period_type === 'month'
      );
      if (months.length > 0) {
        ytd = true;
        let sum = 0;
        let hasVal = false;
        for (const m of months) {
          if (m.value !== null) {
            sum += normalizeUnit(m.value, m.unit, opts.unit) ?? 0;
            hasVal = true;
          }
        }
        actual = hasVal ? round(sum) : null;
      }
    }

    const rate = plan && plan !== 0 && actual !== null ? round((actual / plan) * 100) : null;
    points.push({
      yearLabel: ytd ? `${year} YTD` : String(year),
      year,
      ytd,
      plan: plan === null ? null : round(plan),
      actual,
      rate,
    });
  }
  // plan/actual 모두 없는 연도 제거
  return points.filter((p) => p.plan !== null || p.actual !== null);
}

/**
 * 수주 취소제외 series fill — cancel에 없는 연도는 base(수주액) actual로 채운다.
 * 계획은 base(수주액 계획)를 그대로 쓰므로 plan/rate를 base 기준으로 재계산.
 */
export function fillCancelExcluded(
  base: readonly AchievementPoint[],
  cancel: readonly AchievementPoint[]
): AchievementPoint[] {
  const cancelByYear = new Map(cancel.map((p) => [p.year, p]));
  return base.map((b) => {
    const c = cancelByYear.get(b.year);
    const actual = c && c.actual !== null ? c.actual : b.actual;
    const rate = b.plan && b.plan !== 0 && actual !== null ? round((actual / b.plan) * 100) : null;
    return { ...b, actual, rate };
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- lib/plan/__tests__/aggregate.test.ts`
Expected: PASS (8 케이스).

- [ ] **Step 5: 커밋**

```bash
git add lib/plan/aggregate.ts lib/plan/__tests__/aggregate.test.ts
git commit -m "feat(plan): aggregate 시리즈 빌더 + 테스트"
```

---

## Task 7: lib/plan/source.ts

**Files:**

- Create: `lib/plan/source.ts`

- [ ] **Step 1: source 작성**

```ts
/**
 * 손익 계획(/management/plan) 도메인 데이터 입구 — fetch + 'use cache'.
 *
 * - pnl_plan: 사외비 → confidentialDb(service_role).
 * - 전사 매출/영업이익 실적(차트 2·3)은 pnl_entries 기반 getPreparedPnl() 재사용.
 * - 미국 차트 원화 환산용 현재 USD/KRW는 exchange_rates_live(공개)에서.
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { confidentialDb } from '@/lib/supabase/confidential';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import { getPreparedPnl } from '@/lib/pnl/source';
import type { PreparedPnlData } from '@/lib/pnl/aggregate';
import type { Basis } from '@/lib/pnl/types';
import type { PlanRow } from './types';

async function fetchPlanRows(): Promise<PlanRow[]> {
  const { data, error } = await confidentialDb
    .from('pnl_plan')
    .select('*')
    .order('category', { ascending: true })
    .order('item', { ascending: true })
    .order('period_year', { ascending: true })
    .order('period_month', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'pnl_plan 조회 실패');
    throw new Error(`Supabase pnl_plan 조회 실패: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    ...r,
    basis: r.basis as Basis,
    kind: r.kind as PlanRow['kind'],
    period_type: r.period_type as PlanRow['period_type'],
  }));
}

export interface PlanData {
  plan: PlanRow[];
  /** 전사 매출/영업이익 실적용 (차트 2·3) */
  prepared: PreparedPnlData;
  /** 현재 USD→KRW (원/USD). 없으면 null */
  usdKrw: number | null;
}

export async function getPlanData(): Promise<PlanData> {
  'use cache';
  cacheLife('hours');
  cacheTag('pnl_plan');
  cacheTag('pnl_entries');
  cacheTag('exchange_rates_live');

  const supabase = createSupabaseAnonClient();
  const [plan, prepared, fx] = await Promise.all([
    fetchPlanRows(),
    getPreparedPnl(),
    supabase.from('exchange_rates_live').select('base,rate').eq('base', 'USD').maybeSingle(),
  ]);
  const usdKrw = fx.data?.rate ?? null;
  return { plan, prepared, usdKrw };
}
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: 커밋**

```bash
git add lib/plan/source.ts
git commit -m "feat(plan): source.ts (pnl_plan + 실적 + FX)"
```

---

## Task 8: PlanAchievementChart 공통 컴포넌트

**Files:**

- Create: `components/management/plan/PlanAchievementChart.tsx`

콤보: 계획 막대(연한색)+실적 막대(진한색)+달성율 라인(우측 Y축, 표식). 색은 `OEM_COLORS`.

- [ ] **Step 1: 컴포넌트 작성**

```tsx
'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartHeight } from '@/lib/useChartHeight';
import { OEM_COLORS } from '@/components/oem/helpers';
import type { AchievementPoint } from '@/lib/plan/types';

/** hex → rgba (계획 막대 연한색). */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function fmt(n: number | null, digits = 0): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', { maximumFractionDigits: digits });
}

interface Props {
  points: AchievementPoint[];
  /** 막대 단위 라벨 (예: '억원', 'USD 백만', '백만원') */
  unitLabel: string;
}

const BASE = OEM_COLORS[0]; // 실적(진한색)
const PLAN_COLOR = hexToRgba(BASE, 0.4); // 계획(연한색)
const RATE_COLOR = '#dc2626'; // 달성율 라인

export default function PlanAchievementChart({ points, unitLabel }: Props) {
  const h = useChartHeight(300, 380, 460);
  if (points.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">데이터가 없습니다.</div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={h}>
      <ComposedChart data={points} margin={{ top: 10, right: 20, bottom: 10, left: 10 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="yearLabel" tick={{ fontSize: 14 }} />
        <YAxis
          yAxisId="amount"
          tickFormatter={(v: number) => fmt(v)}
          tick={{ fontSize: 14 }}
          width={80}
          label={{
            value: unitLabel,
            position: 'insideTopLeft',
            fontSize: 12,
            fill: 'var(--muted-foreground)',
          }}
        />
        <YAxis
          yAxisId="rate"
          orientation="right"
          tickFormatter={(v: number) => `${v}%`}
          tick={{ fontSize: 14 }}
          width={56}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            fontSize: '15px',
          }}
          content={<AchievementTooltip unitLabel={unitLabel} />}
        />
        <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 4, fontSize: 13 }} />
        <Bar yAxisId="amount" dataKey="plan" name="계획" fill={PLAN_COLOR} radius={[2, 2, 0, 0]} />
        <Bar yAxisId="amount" dataKey="actual" name="실적" fill={BASE} radius={[2, 2, 0, 0]} />
        <Line
          yAxisId="rate"
          type="monotone"
          dataKey="rate"
          name="달성율"
          stroke={RATE_COLOR}
          strokeWidth={2}
          dot={{ r: 4, fill: RATE_COLOR }}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function AchievementTooltip({
  active,
  payload,
  label,
  unitLabel,
}: {
  active?: boolean;
  payload?: Array<{ payload: AchievementPoint }>;
  label?: string;
  unitLabel: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div
      className="rounded-md p-2 text-sm"
      style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="font-semibold mb-1">{label}</div>
      <div>
        계획: {fmt(p.plan)} {unitLabel}
      </div>
      <div>
        실적: {fmt(p.actual)} {unitLabel}
      </div>
      <div className={p.rate != null && p.rate < 100 ? 'text-red-500' : 'text-emerald-600'}>
        달성율: {p.rate == null ? '—' : `${fmt(p.rate, 1)}%`}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: typecheck + 커밋**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add components/management/plan/PlanAchievementChart.tsx
git commit -m "feat(plan): PlanAchievementChart 공통 콤보 차트"
```

---

## Task 9: 8개 차트 래퍼 + selector 헬퍼

**Files:**

- Create: `components/management/plan/_selectors.tsx` (공통 토글 버튼)
- Create: 8개 `*TargetChart.tsx`

각 래퍼는 `lib/plan` 데이터를 받아 해당 (category,item,basis)로 PlanRow를 필터 → `buildAchievement` → `PlanAchievementChart`. selector 상태만 다르다.

- [ ] **Step 1: 공통 selector 작성** (`_selectors.tsx`)

```tsx
'use client';

/** 작은 토글 버튼 그룹 (단일 선택). 다른 차트의 BasisToggle 스타일과 통일. */
export function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 text-sm transition-colors ${
            value === o.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-background hover:bg-muted'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 차트 섹션 래퍼 (번호 h2 + 우측 컨트롤 슬롯). */
export function ChartSection({
  title,
  controls,
  children,
}: {
  title: string;
  controls?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {controls ? <div className="flex items-center gap-2 flex-wrap">{controls}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** (category,item,basis,kind) 필터 헬퍼 — 래퍼에서 재사용. */
import type { PlanRow } from '@/lib/plan/types';
export function pick(
  rows: readonly PlanRow[],
  category: string,
  item: string,
  basis: PlanRow['basis']
): PlanRow[] {
  return rows.filter((r) => r.category === category && r.item === item && r.basis === basis);
}
```

- [ ] **Step 2: 1번 수주 `OrderTargetChart.tsx`**

수주액↔취소제외 토글. 계획은 수주액 계획 공통, 취소제외는 fillCancelExcluded.

```tsx
'use client';

import { useMemo, useState } from 'react';
import PlanAchievementChart from './PlanAchievementChart';
import { ChartSection, ToggleGroup, pick } from './_selectors';
import { buildAchievement, fillCancelExcluded } from '@/lib/plan/aggregate';
import type { PlanRow } from '@/lib/plan/types';

type Mode = 'gross' | 'net';

export default function OrderTargetChart({ rows }: { rows: PlanRow[] }) {
  const [mode, setMode] = useState<Mode>('gross');
  const points = useMemo(() => {
    const gross = buildAchievement(pick(rows, '수주', '수주액', 'consolidated'), { unit: '억원' });
    if (mode === 'gross') return gross;
    const cancel = buildAchievement(pick(rows, '수주', '수주액(취소 제외)', 'consolidated'), {
      unit: '억원',
    });
    return fillCancelExcluded(gross, cancel);
  }, [rows, mode]);
  return (
    <ChartSection
      title="1. 전사 수주목표 달성"
      controls={
        <ToggleGroup
          options={[
            { value: 'gross', label: '수주액' },
            { value: 'net', label: '수주액(취소 제외)' },
          ]}
          value={mode}
          onChange={setMode}
        />
      }
    >
      <PlanAchievementChart points={points} unitLabel="억원" />
    </ChartSection>
  );
}
```

- [ ] **Step 3: 2번 매출 `RevenueTargetChart.tsx`** (실적은 pnl_entries)

계획은 pnl_plan(손익/매출), 실적은 prepared(전사 매출). 연결/별도 토글.

```tsx
'use client';

import { useMemo, useState } from 'react';
import PlanAchievementChart from './PlanAchievementChart';
import { ChartSection, ToggleGroup, pick } from './_selectors';
import { buildAchievement } from '@/lib/plan/aggregate';
import { aggregateBy, entriesForYear, getDisplayYearLabels } from '@/lib/pnl/aggregate';
import type { PreparedPnlData } from '@/lib/pnl/aggregate';
import type { Basis } from '@/lib/pnl/types';
import type { AchievementPoint, PlanRow } from '@/lib/plan/types';

/** 전사 손익 매출/영업이익 차트 공통 빌더 (계획=pnl_plan, 실적=pnl_entries). */
export function buildCorpAchievement(
  rows: PlanRow[],
  prepared: PreparedPnlData,
  basis: Basis,
  item: '매출' | '영업이익',
  metric: 'revenue' | 'op_income'
): AchievementPoint[] {
  const planRows = pick(rows, '손익', item, basis); // 계획만 존재
  const planPts = buildAchievement(planRows, { unit: '억원' });
  // 실적: pnl_entries 연간(+2026 YTD) 전사 합계 → 백만원이므로 ÷100 = 억원
  const annual = prepared.annualByBasis[basis];
  const labels = getDisplayYearLabels(annual, basis);
  const actualByYear = new Map<number, { value: number; ytd: boolean }>();
  for (const lbl of labels) {
    const yr = parseInt(lbl.slice(0, 4), 10);
    const agg = aggregateBy(entriesForYear(annual, basis, lbl), []);
    if (agg.length > 0) {
      actualByYear.set(yr, { value: agg[0][metric] / 100, ytd: lbl === '2026' });
    }
  }
  // 계획 연도 ∪ 실적 연도
  const years = new Set<number>([...planPts.map((p) => p.year), ...actualByYear.keys()]);
  const out: AchievementPoint[] = [];
  for (const year of Array.from(years).sort((a, b) => a - b)) {
    const plan = planPts.find((p) => p.year === year)?.plan ?? null;
    const a = actualByYear.get(year);
    const actual = a ? Math.round(a.value * 10000) / 10000 : null;
    const ytd = a?.ytd ?? false;
    const rate =
      plan && plan !== 0 && actual !== null ? Math.round((actual / plan) * 1000000) / 10000 : null;
    if (plan === null && actual === null) continue;
    out.push({ yearLabel: ytd ? `${year} YTD` : String(year), year, ytd, plan, actual, rate });
  }
  return out;
}

export default function RevenueTargetChart({
  rows,
  prepared,
}: {
  rows: PlanRow[];
  prepared: PreparedPnlData;
}) {
  const [basis, setBasis] = useState<Basis>('consolidated');
  const points = useMemo(
    () => buildCorpAchievement(rows, prepared, basis, '매출', 'revenue'),
    [rows, prepared, basis]
  );
  return (
    <ChartSection
      title="2. 전사 매출목표 달성"
      controls={
        <ToggleGroup
          options={[
            { value: 'consolidated', label: '연결' },
            { value: 'standalone', label: '별도' },
          ]}
          value={basis}
          onChange={setBasis}
        />
      }
    >
      <PlanAchievementChart points={points} unitLabel="억원" />
    </ChartSection>
  );
}
```

- [ ] **Step 4: 3번 영업이익 `OpIncomeTargetChart.tsx`**

```tsx
'use client';

import { useMemo, useState } from 'react';
import PlanAchievementChart from './PlanAchievementChart';
import { ChartSection, ToggleGroup } from './_selectors';
import { buildCorpAchievement } from './RevenueTargetChart';
import type { PreparedPnlData } from '@/lib/pnl/aggregate';
import type { Basis } from '@/lib/pnl/types';
import type { PlanRow } from '@/lib/plan/types';

export default function OpIncomeTargetChart({
  rows,
  prepared,
}: {
  rows: PlanRow[];
  prepared: PreparedPnlData;
}) {
  const [basis, setBasis] = useState<Basis>('consolidated');
  const points = useMemo(
    () => buildCorpAchievement(rows, prepared, basis, '영업이익', 'op_income'),
    [rows, prepared, basis]
  );
  return (
    <ChartSection
      title="3. 전사 영업이익 목표 달성"
      controls={
        <ToggleGroup
          options={[
            { value: 'consolidated', label: '연결' },
            { value: 'standalone', label: '별도' },
          ]}
          value={basis}
          onChange={setBasis}
        />
      }
    >
      <PlanAchievementChart points={points} unitLabel="억원" />
    </ChartSection>
  );
}
```

- [ ] **Step 5: 4번 미국 `UsTargetChart.tsx`** (매출/영업이익 + USD/원화)

```tsx
'use client';

import { useMemo, useState } from 'react';
import PlanAchievementChart from './PlanAchievementChart';
import { ChartSection, ToggleGroup, pick } from './_selectors';
import { buildAchievement } from '@/lib/plan/aggregate';
import type { AchievementPoint, PlanRow } from '@/lib/plan/types';

type Item = '매출' | '영업이익';
type Cur = 'usd' | 'krw';

export default function UsTargetChart({
  rows,
  usdKrw,
}: {
  rows: PlanRow[];
  usdKrw: number | null;
}) {
  const [item, setItem] = useState<Item>('매출');
  const [cur, setCur] = useState<Cur>('usd');
  const points = useMemo<AchievementPoint[]>(() => {
    // pnl_plan 단위 'USD 백만'. USD 모드는 그대로. KRW 모드는 억원 환산:
    //   USD백만 × usdKrw(원/USD) = 백만원 ... ÷100 = 억원. → 곱 factor = usdKrw/100.
    const base = buildAchievement(pick(rows, '미국', item, 'consolidated'), { unit: 'USD 백만' });
    if (cur === 'usd' || !usdKrw) return base;
    const f = usdKrw / 100;
    return base.map((p) => ({
      ...p,
      plan: p.plan == null ? null : Math.round(p.plan * f * 10000) / 10000,
      actual: p.actual == null ? null : Math.round(p.actual * f * 10000) / 10000,
      // rate는 비율이라 환산 불변
    }));
  }, [rows, item, cur, usdKrw]);
  const unitLabel = cur === 'usd' ? 'USD 백만' : '억원';
  return (
    <ChartSection
      title="4. 미국법인 목표 달성"
      controls={
        <>
          <ToggleGroup
            options={[
              { value: '매출', label: '매출' },
              { value: '영업이익', label: '영업이익' },
            ]}
            value={item}
            onChange={setItem}
          />
          <ToggleGroup
            options={[
              { value: 'usd', label: 'USD' },
              { value: 'krw', label: '원화' },
            ]}
            value={cur}
            onChange={setCur}
          />
        </>
      }
    >
      <PlanAchievementChart points={points} unitLabel={unitLabel} />
    </ChartSection>
  );
}
```

- [ ] **Step 6: 5번 상숙 `SangsukTargetChart.tsx`**

```tsx
'use client';

import { useMemo, useState } from 'react';
import PlanAchievementChart from './PlanAchievementChart';
import { ChartSection, ToggleGroup, pick } from './_selectors';
import { buildAchievement } from '@/lib/plan/aggregate';
import type { PlanRow } from '@/lib/plan/types';

type Item = '매출' | '영업이익';

export default function SangsukTargetChart({ rows }: { rows: PlanRow[] }) {
  const [item, setItem] = useState<Item>('매출');
  const points = useMemo(
    () => buildAchievement(pick(rows, '상숙', item, 'consolidated'), { unit: '억원' }),
    [rows, item]
  );
  return (
    <ChartSection
      title="5. 상숙법인 목표 달성"
      controls={
        <ToggleGroup
          options={[
            { value: '매출', label: '매출' },
            { value: '영업이익', label: '영업이익' },
          ]}
          value={item}
          onChange={setItem}
        />
      }
    >
      <PlanAchievementChart points={points} unitLabel="억원" />
    </ChartSection>
  );
}
```

- [ ] **Step 7: 6번 지린 `JilinTargetChart.tsx`** (상숙과 동일 구조, category='지린', title='6. 지린법인 목표 달성')

```tsx
'use client';

import { useMemo, useState } from 'react';
import PlanAchievementChart from './PlanAchievementChart';
import { ChartSection, ToggleGroup, pick } from './_selectors';
import { buildAchievement } from '@/lib/plan/aggregate';
import type { PlanRow } from '@/lib/plan/types';

type Item = '매출' | '영업이익';

export default function JilinTargetChart({ rows }: { rows: PlanRow[] }) {
  const [item, setItem] = useState<Item>('매출');
  const points = useMemo(
    () => buildAchievement(pick(rows, '지린', item, 'consolidated'), { unit: '억원' }),
    [rows, item]
  );
  return (
    <ChartSection
      title="6. 지린법인 목표 달성"
      controls={
        <ToggleGroup
          options={[
            { value: '매출', label: '매출' },
            { value: '영업이익', label: '영업이익' },
          ]}
          value={item}
          onChange={setItem}
        />
      }
    >
      <PlanAchievementChart points={points} unitLabel="억원" />
    </ChartSection>
  );
}
```

- [ ] **Step 8: 7번 손익개선 `ImprovementTargetChart.tsx`** (Design VE/MCIP/단가인상, 백만원)

```tsx
'use client';

import { useMemo, useState } from 'react';
import PlanAchievementChart from './PlanAchievementChart';
import { ChartSection, ToggleGroup, pick } from './_selectors';
import { buildAchievement } from '@/lib/plan/aggregate';
import type { PlanRow } from '@/lib/plan/types';

type Item = 'Design VE' | 'MCIP' | '단가인상';

export default function ImprovementTargetChart({ rows }: { rows: PlanRow[] }) {
  const [item, setItem] = useState<Item>('Design VE');
  const points = useMemo(
    () => buildAchievement(pick(rows, '손익개선', item, 'consolidated'), { unit: '백만원' }),
    [rows, item]
  );
  return (
    <ChartSection
      title="7. 손익개선 목표 달성"
      controls={
        <ToggleGroup
          options={[
            { value: 'Design VE', label: 'Design VE' },
            { value: 'MCIP', label: 'MCIP' },
            { value: '단가인상', label: '단가인상' },
          ]}
          value={item}
          onChange={setItem}
        />
      }
    >
      <PlanAchievementChart points={points} unitLabel="백만원" />
    </ChartSection>
  );
}
```

- [ ] **Step 9: 8번 공장 `FactoryTargetChart.tsx`** (구동/제동/조향/전장, 별도, 억원)

item은 '구동 매출' 등. 토글 라벨은 '구동'/'제동'/'조향'/'전장'. basis='standalone'.

```tsx
'use client';

import { useMemo, useState } from 'react';
import PlanAchievementChart from './PlanAchievementChart';
import { ChartSection, ToggleGroup, pick } from './_selectors';
import { buildAchievement } from '@/lib/plan/aggregate';
import type { PlanRow } from '@/lib/plan/types';

type Div = '구동' | '제동' | '조향' | '전장';

export default function FactoryTargetChart({ rows }: { rows: PlanRow[] }) {
  const [div, setDiv] = useState<Div>('구동');
  const points = useMemo(
    () => buildAchievement(pick(rows, '공장', `${div} 매출`, 'standalone'), { unit: '억원' }),
    [rows, div]
  );
  return (
    <ChartSection
      title="8. 공장 매출 목표 달성"
      controls={
        <ToggleGroup
          options={[
            { value: '구동', label: '구동' },
            { value: '제동', label: '제동' },
            { value: '조향', label: '조향' },
            { value: '전장', label: '전장' },
          ]}
          value={div}
          onChange={setDiv}
        />
      }
    >
      <PlanAchievementChart points={points} unitLabel="억원" />
    </ChartSection>
  );
}
```

- [ ] **Step 10: typecheck + 커밋**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add components/management/plan/
git commit -m "feat(plan): 8개 목표 달성 콤보 차트 + selector"
```

---

## Task 10: PlanDashboard + 페이지 연결

**Files:**

- Create: `components/management/plan/PlanDashboard.tsx`
- Modify: `app/management/plan/page.tsx`

- [ ] **Step 1: PlanDashboard 작성**

```tsx
'use client';

import dynamic from 'next/dynamic';
import LazyMount from '@/components/common/LazyMount';
import type { PreparedPnlData } from '@/lib/pnl/aggregate';
import type { PlanRow } from '@/lib/plan/types';

const OrderTargetChart = dynamic(() => import('./OrderTargetChart'), { ssr: false });
const RevenueTargetChart = dynamic(() => import('./RevenueTargetChart'), { ssr: false });
const OpIncomeTargetChart = dynamic(() => import('./OpIncomeTargetChart'), { ssr: false });
const UsTargetChart = dynamic(() => import('./UsTargetChart'), { ssr: false });
const SangsukTargetChart = dynamic(() => import('./SangsukTargetChart'), { ssr: false });
const JilinTargetChart = dynamic(() => import('./JilinTargetChart'), { ssr: false });
const ImprovementTargetChart = dynamic(() => import('./ImprovementTargetChart'), { ssr: false });
const FactoryTargetChart = dynamic(() => import('./FactoryTargetChart'), { ssr: false });

interface Props {
  rows: PlanRow[];
  prepared: PreparedPnlData;
  usdKrw: number | null;
}

export default function PlanDashboard({ rows, prepared, usdKrw }: Props) {
  return (
    <div className="max-w-[1600px] mx-auto px-6 py-4 space-y-6">
      <LazyMount className="min-h-[420px]">
        <OrderTargetChart rows={rows} />
      </LazyMount>
      <LazyMount className="min-h-[420px]">
        <RevenueTargetChart rows={rows} prepared={prepared} />
      </LazyMount>
      <LazyMount className="min-h-[420px]">
        <OpIncomeTargetChart rows={rows} prepared={prepared} />
      </LazyMount>
      <LazyMount className="min-h-[420px]">
        <UsTargetChart rows={rows} usdKrw={usdKrw} />
      </LazyMount>
      <LazyMount className="min-h-[420px]">
        <SangsukTargetChart rows={rows} />
      </LazyMount>
      <LazyMount className="min-h-[420px]">
        <JilinTargetChart rows={rows} />
      </LazyMount>
      <LazyMount className="min-h-[420px]">
        <ImprovementTargetChart rows={rows} />
      </LazyMount>
      <LazyMount className="min-h-[420px]">
        <FactoryTargetChart rows={rows} />
      </LazyMount>
    </div>
  );
}
```

- [ ] **Step 2: page.tsx 교체**

`app/management/pnl/page.tsx` 패턴(서버 컴포넌트 → source 호출 → 클라이언트 dashboard)을 먼저 읽고 동일 구조로:

```tsx
import { getPlanData } from '@/lib/plan/source';
import PlanDashboard from '@/components/management/plan/PlanDashboard';

export default async function PlanPage() {
  const { plan, prepared, usdKrw } = await getPlanData();
  return <PlanDashboard rows={plan} prepared={prepared} usdKrw={usdKrw} />;
}
```

> `app/management/pnl/page.tsx`를 읽어 RSC payload 최소화 패턴(prepared 전달 방식)·loading.tsx 유무를 맞춘다.

- [ ] **Step 3: typecheck + dev 확인**

Run: `npm run typecheck`
Expected: PASS.
dev 서버에서 로그인 후 `/management/plan` 8개 차트 렌더 + 콘솔 에러 없음 확인 (Task 13에서 일괄).

- [ ] **Step 4: 커밋**

```bash
git add components/management/plan/PlanDashboard.tsx app/management/plan/page.tsx
git commit -m "feat(plan): PlanDashboard + 계획 페이지 연결"
```

---

## Task 11: 경영관리 신규 10번 ProfitContribution

**Files:**

- Create: `components/management/pnl/ProfitContribution.tsx`

연결/별도 토글 + 연도 드롭다운. top7/worst7(고객-제품, 영업이익 기준) 표 + 전사 합계 + top7 제외 나머지.

- [ ] **Step 1: 컴포넌트 작성**

```tsx
'use client';

import { useMemo, useState } from 'react';
import BasisToggle from './BasisToggle';
import YearSelect from './YearSelect';
import { aggregateBy, entriesForYear, getDisplayYearLabels, opMarginOf } from '@/lib/pnl/aggregate';
import type { AggregatedRow, Basis, PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

interface Props {
  annualEntries: PnlEntry[];
  annualByBasis: EntriesByBasis;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}
function fmtPct(n: number | null): string {
  return n == null ? '—' : `${n.toFixed(1)}%`;
}

/** 영업이익률 음수 빨강 */
function marginCls(n: number | null): string {
  return n != null && n < 0 ? 'text-red-500 font-medium' : '';
}

export default function ProfitContribution({ annualByBasis }: Props) {
  const [basis, setBasis] = useState<Basis>('consolidated');
  const basisEntries = annualByBasis[basis];
  const yearLabels = useMemo(
    () => getDisplayYearLabels(basisEntries, basis),
    [basisEntries, basis]
  );
  const [yearLabel, setYearLabel] = useState<string>('');
  const effYear = useMemo(
    () =>
      yearLabel && yearLabels.includes(yearLabel)
        ? yearLabel
        : (yearLabels[yearLabels.length - 1] ?? ''),
    [yearLabel, yearLabels]
  );

  const { top, worst, corp, restOfTop } = useMemo(() => {
    const entries = entriesForYear(basisEntries, basis, effYear);
    const cross = aggregateBy(entries, ['customer', 'product']).filter(
      (r) => r.revenue !== 0 || r.op_income !== 0
    );
    const sorted = [...cross].sort((a, b) => b.op_income - a.op_income);
    const top7 = sorted.slice(0, 7);
    const worst7 = sorted.slice(-7).reverse(); // 최하위가 위로
    const corpAgg = aggregateBy(entries, []);
    const corpRow: AggregatedRow | null = corpAgg[0] ?? null;
    // top7 제외 나머지 합산
    const topKeys = new Set(top7.map((r) => r.key));
    const rest = cross.filter((r) => !topKeys.has(r.key));
    const restRev = rest.reduce((s, r) => s + r.revenue, 0);
    const restOp = rest.reduce((s, r) => s + r.op_income, 0);
    return {
      top: top7,
      worst: worst7,
      corp: corpRow,
      restOfTop: { revenue: restRev, op_income: restOp },
    };
  }, [basisEntries, basis, effYear]);

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-lg font-semibold">10. 이익기여도 TOP7 / WORST7 (고객·제품)</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <BasisToggle value={basis} onChange={setBasis} />
          <YearSelect label="연도" options={yearLabels} value={effYear} onChange={setYearLabel} />
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ContribTable title="이익기여 TOP 7" rows={top} />
        <ContribTable title="이익기여 WORST 7" rows={worst} />
      </div>

      {corp ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-1.5 px-2">구분</th>
                <th className="text-right py-1.5 px-2">매출(백만)</th>
                <th className="text-right py-1.5 px-2">영업이익(백만)</th>
                <th className="text-right py-1.5 px-2">영업이익률</th>
              </tr>
            </thead>
            <tbody>
              <SummaryRow label="전사 합계" revenue={corp.revenue} op={corp.op_income} />
              <SummaryRow
                label="TOP7 제외 나머지"
                revenue={restOfTop.revenue}
                op={restOfTop.op_income}
              />
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function SummaryRow({ label, revenue, op }: { label: string; revenue: number; op: number }) {
  const margin = revenue ? (op / revenue) * 100 : null;
  return (
    <tr className="border-b border-border/50">
      <td className="py-1.5 px-2 font-medium">{label}</td>
      <td className="text-right py-1.5 px-2">{fmt(revenue)}</td>
      <td className={`text-right py-1.5 px-2 ${op < 0 ? 'text-red-500' : ''}`}>{fmt(op)}</td>
      <td className={`text-right py-1.5 px-2 ${marginCls(margin)}`}>{fmtPct(margin)}</td>
    </tr>
  );
}

function ContribTable({ title, rows }: { title: string; rows: AggregatedRow[] }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="font-semibold mb-2">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-1.5 px-2">고객</th>
              <th className="text-left py-1.5 px-2">제품</th>
              <th className="text-right py-1.5 px-2">매출</th>
              <th className="text-right py-1.5 px-2">영업이익</th>
              <th className="text-right py-1.5 px-2">이익률</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const margin = opMarginOf(r);
              return (
                <tr key={r.key} className="border-b border-border/50">
                  <td className="py-1.5 px-2">{r.dims.customer || '—'}</td>
                  <td className="py-1.5 px-2">{r.dims.product || '—'}</td>
                  <td className="text-right py-1.5 px-2">{fmt(r.revenue)}</td>
                  <td className={`text-right py-1.5 px-2 ${r.op_income < 0 ? 'text-red-500' : ''}`}>
                    {fmt(r.op_income)}
                  </td>
                  <td className={`text-right py-1.5 px-2 ${marginCls(margin)}`}>
                    {fmtPct(margin)}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted-foreground">
                  데이터 없음
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: typecheck + 커밋**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add components/management/pnl/ProfitContribution.tsx
git commit -m "feat(pnl): 10번 이익기여도 TOP7/WORST7 차트"
```

---

## Task 12: PnlDashboard 재배치 + Insights 분리 + 재번호

**Files:**

- Modify: `components/management/pnl/PnlDashboard.tsx`
- Modify: `components/management/pnl/WaterfallProfitability.tsx`
- Modify: `components/management/pnl/CustomerParetoChart.tsx`
- Modify: `components/management/pnl/YoyMonthlyCompare.tsx` (h2 10→11)
- Modify: `components/management/pnl/YoyMonthlyFiltered.tsx` (h2 11→12)
- Modify: `components/management/pnl/YoyProductCustomer.tsx` (h2 12→13)
- Delete: `components/management/pnl/Insights.tsx`

- [ ] **Step 1: WaterfallProfitability를 top-level 섹션으로 승격 + 14번**

현재 최상위 `<div className="rounded-md border border-border bg-card p-3">`를 `<section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">`로 바꾸고, 내부 `<div className="text-lg font-semibold">수익성 워터폴</div>`를 `<h2 className="text-lg font-semibold">14. 수익성 워터폴</h2>`로 변경. (헤더 행 구조는 유지.)

- [ ] **Step 2: CustomerParetoChart도 동일 승격 + 15번**

`CustomerParetoChart.tsx`를 읽고, 최상위 카드 래퍼를 `<section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">`로, 제목을 `<h2 className="text-lg font-semibold">15. 고객 매출 집중도 (파레토)</h2>`로 변경.

- [ ] **Step 3: 10·11·12 → 11·12·13 h2 텍스트 변경**

- `YoyMonthlyCompare.tsx:163` `10. 전년 대비 월별 비교` → `11. 전년 대비 월별 비교`
- `YoyMonthlyFiltered.tsx:158` `11. 전년 대비 월별 비교 (고객·제품 선택)` → `12. 전년 대비 월별 비교 (고객·제품 선택)`
- `YoyProductCustomer.tsx:204` `12. 제품·고객 YoY 매트릭스` → `13. 제품·고객 YoY 매트릭스`

- [ ] **Step 4: PnlDashboard 재구성**

`import Insights` 제거. `import ProfitContribution from './ProfitContribution';` 추가. dynamic import에 Waterfall/Pareto 추가:

```tsx
const ProfitContribution = dynamic(() => import('./ProfitContribution'), { ssr: false });
const WaterfallProfitability = dynamic(() => import('./WaterfallProfitability'), { ssr: false });
const CustomerParetoChart = dynamic(() => import('./CustomerParetoChart'), { ssr: false });
```

`Insights` dynamic import 줄 삭제. JSX에서 MarginScatter LazyMount 뒤에 ProfitContribution 삽입, Insights LazyMount를 Waterfall+Pareto 2개로 교체:

```tsx
      <LazyMount className="min-h-[420px] md:min-h-[520px]">
        <MarginScatter
          annualEntries={annualEntries}
          annualByBasis={annualByBasis}
          monthlyByBasis={monthlyByBasis}
        />
      </LazyMount>
      <LazyMount className="min-h-[480px]">
        <ProfitContribution annualEntries={annualEntries} annualByBasis={annualByBasis} />
      </LazyMount>
      <LazyMount className="min-h-[420px] md:min-h-[540px]">
        <YoyMonthlyCompare monthlyByBasis={monthlyByBasis} />
      </LazyMount>
      <LazyMount className="min-h-[420px] md:min-h-[540px]">
        <YoyMonthlyFiltered monthlyByBasis={monthlyByBasis} />
      </LazyMount>
      <LazyMount className="min-h-[440px] md:min-h-[560px]">
        <YoyProductCustomer
          annualEntries={annualEntries}
          annualByBasis={annualByBasis}
          monthlyByBasis={monthlyByBasis}
        />
      </LazyMount>
      <LazyMount className="min-h-[420px]">
        <WaterfallProfitability annualEntries={annualEntries} annualByBasis={annualByBasis} />
      </LazyMount>
      <LazyMount className="min-h-[420px]">
        <CustomerParetoChart annualEntries={annualEntries} annualByBasis={annualByBasis} />
      </LazyMount>
```

> Waterfall/Pareto props가 `{ annualEntries, annualByBasis }` 인지 각 컴포넌트 시그니처로 확인(Waterfall은 `annualByBasis`만 구조분해하지만 Props 타입은 둘 다 받음).

- [ ] **Step 5: Insights.tsx 삭제**

```bash
git rm components/management/pnl/Insights.tsx
```

- [ ] **Step 6: typecheck**

Run: `npm run typecheck`
Expected: PASS (Insights 참조 없음).

- [ ] **Step 7: 커밋**

```bash
git add components/management/pnl/
git commit -m "feat(pnl): 10번 차트 삽입 + 시사점 14·15 분리 + 재번호"
```

---

## Task 13: 검증 + AGENTS.md + 정리

**Files:**

- Modify: `AGENTS.md`
- Delete: `scripts/_inspect_plan_structure.py`, `scripts/_inspect_plan_years.py`, `scripts/_plan_*.txt`, `참고/손익/_sheets_info.json` (임시 산출물)

- [ ] **Step 1: check-all**

Run: `npm run check-all`
Expected: lint+format+typecheck+test 모두 PASS. 실패 시 `npm run lint:fix` / `npm run format` 후 재실행.

- [ ] **Step 2: dev 서버 골든 패스 (로그인 필요)**

`npm run dev` → 로그인 → 검증:

- `/management/pnl`: 섹션 번호 1~15 순서 정상. 10번 ProfitContribution TOP7/WORST7 표 + 전사/나머지 합계. 14 워터폴 · 15 파레토 독립 섹션. 4월 데이터 반영(월별 차트 2026 4월까지).
- `/management/plan`: 8개 차트 렌더. 각 토글(수주액/취소제외, 연결/별도, 매출/영업이익, USD/원화, Design VE 등, 구동/제동/조향/전장) 동작. 달성율 라인 표시. 공장 2026 막대 공란 확인.
- 콘솔/네트워크 에러 없음.

- [ ] **Step 3: AGENTS.md 갱신**

- `/management` 라우트 행: plan 탭 설명에 "계획 대비 실적·달성율 콤보 차트 8종, `pnl_plan` 사외비 테이블" 추가.
- 사외비 테이블 목록에 `pnl_plan` 추가 (RLS deny + confidentialDb).
- `lib/` 도메인 폴더에 `lib/plan/` 추가.
- `scripts/` 목록에 `sync_pnl_plan.py`, `sync_pnl_excel.py`(복원) 반영.
- 마이그레이션 `20260528000001_create_pnl_plan` 언급.

- [ ] **Step 4: 임시 산출물 정리**

```bash
git rm -f --ignore-unmatch scripts/_inspect_plan_structure.py scripts/_inspect_plan_years.py
rm -f scripts/_plan_structure_dump.txt scripts/_plan_years_dump.txt scripts/_plan_dims_dump.txt 참고/손익/_sheets_info.json
```

(이미 git에 없으면 파일시스템만 정리.)

- [ ] **Step 5: 최종 커밋**

```bash
git add AGENTS.md
git commit -m "docs(plan): AGENTS.md 계획 페이지·pnl_plan 반영 + 임시 산출물 정리"
```

---

## Self-Review 메모

- **스펙 커버리지**: Part1(4월 재적재 T3, 10번 T11, 시사점 분리 T12, 재번호 T12) / Part2(pnl_plan T1·T4, lib/plan T5·6·7, 8차트 T8·9, 페이지 T10). 결정 4건 모두 반영(공장 공란=buildAchievement가 null 처리, 취소제외 fill=T6, 10번 basis 토글=T11, 전체연도=buildAchievement 기본).
- **단위**: 상숙/지린 백만원→억원=normalizeUnit, 미국 USD↔원화=UsTargetChart, 손익개선 백만원, 전사 실적 pnl_entries 백만원→억원(÷100, buildCorpAchievement).
- **사외비**: pnl_plan confidentialDb, 적재 사용자 직접 실행, 검증 집계만.
