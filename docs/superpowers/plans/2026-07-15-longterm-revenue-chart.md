# 중장기 매출 전망 차트 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/management/plan` 최상단에 영업본부 중장기(2027~2031) 매출 전망을 3계열 세로 그룹 막대로 보여주는 차트를 추가하고, 데이터 기준(2026.1Q/2026.2Q)을 드롭다운으로 전환한다.

**Architecture:** 신규 사외비 테이블 `longterm_revenue_plan`(RLS default deny) ← `sync_longterm_revenue.py`(엑셀 요약 시트 파싱, 금액 비노출) → `lib/plan/source.ts` 단일 입구가 `'use cache'`로 fetch → 순수 빌더 `lib/plan/longterm.ts`(Vitest) → 클라이언트 차트 `LongtermRevenueChart.tsx`. 기존 9개 차트는 제목 번호만 2~10으로 재정렬.

**Tech Stack:** Next.js 16(`cacheComponents`/`use cache`) · Supabase(PostgREST, service_role) · Recharts · shadcn Select(base-ui) · Vitest · Python 3 + openpyxl + postgrest-py

**설계 문서:** `docs/superpowers/specs/2026-07-15-longterm-revenue-chart-design.md`

**사외비 준수(전 태스크 공통):** 금액 값을 stdout/로그/커밋/컨텍스트에 출력하지 않는다. 검증은 행수·null 카운트·불리언·구조만. 테스트 픽스처는 **가짜 숫자**를 쓴다.

---

### Task 1: DB 테이블 + 타입 + 사외비 명단

**Files:**

- Create: `supabase/migrations/20260715000001_create_longterm_revenue_plan.sql`
- Modify: `lib/database.types.ts` (`loan_entries` 블록 뒤, `management_uploads` 블록 앞 — 알파벳 순)
- Modify: `lib/supabase/confidential.ts` (주석 목록 + `CONFIDENTIAL_TABLES`)

- [ ] **Step 1: 마이그레이션 파일 생성**

`supabase/migrations/20260715000001_create_longterm_revenue_plan.sql`:

```sql
-- 영업본부 중장기 매출 전망 (사외비). 단위: 백만원.
-- 소스: '(260624) 영업본부 중장기 매출 계획.xlsx' 시트 '연도별 Booked 매출' 요약표(B2:H11).
-- 기준(basis_year/basis_quarter)별 × 계열(series) 3종 × 전망 연도(period_year) 5개 = 30행 규모.
-- 엑셀 'N/A'(예: 2026.1Q의 '고객 EDI 100%')는 value_mwon = null.
-- fx_note는 시트 B2 원문 1줄 — 시트에 하나뿐이라 전 행 동일값 중복 저장(30행 규모, 조인 회피).
-- RLS enable + 정책 없음(default deny) → anon 직접 접근 불가, 서버는 confidentialDb(service_role) 전용.
create table public.longterm_revenue_plan (
  basis_year    integer not null,
  basis_quarter integer not null check (basis_quarter between 1 and 4),
  series        text    not null check (series in ('수주 Volume', '고객 EDI 100%', '한세 전망')),
  period_year   integer not null,
  value_mwon    numeric,
  fx_note       text,
  primary key (basis_year, basis_quarter, series, period_year)
);

alter table public.longterm_revenue_plan enable row level security;

comment on table public.longterm_revenue_plan is
  '영업본부 중장기 매출 전망(백만원). 사외비 — RLS default deny, confidentialDb 전용.';
```

- [ ] **Step 2: 마이그레이션 적용**

Supabase MCP `mcp__supabase__apply_migration` 사용:

- `name`: `create_longterm_revenue_plan`
- `query`: Step 1의 SQL 본문 그대로

Expected: 성공. 실패 시 SQL 문법/중복 테이블명 확인.

- [ ] **Step 3: 적용 확인 (구조만)**

`mcp__supabase__execute_sql`:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'longterm_revenue_plan'
order by ordinal_position;
```

Expected: 6개 컬럼(`basis_year`, `basis_quarter`, `series`, `period_year`, `value_mwon`, `fx_note`).

- [ ] **Step 4: `lib/database.types.ts`에 타입 블록 수동 삽입**

`loan_entries` 블록이 끝나는 `};` 다음 줄, `management_uploads: {` 앞에 삽입한다.
(**generate_typescript_types 전량 재생성 금지** — 파일 끝의 수동 ViewRow/TableRow 헬퍼가 사라지고 prettier churn 발생.)

```typescript
      longterm_revenue_plan: {
        Row: {
          basis_quarter: number;
          basis_year: number;
          fx_note: string | null;
          period_year: number;
          series: string;
          value_mwon: number | null;
        };
        Insert: {
          basis_quarter: number;
          basis_year: number;
          fx_note?: string | null;
          period_year: number;
          series: string;
          value_mwon?: number | null;
        };
        Update: {
          basis_quarter?: number;
          basis_year?: number;
          fx_note?: string | null;
          period_year?: number;
          series?: string;
          value_mwon?: number | null;
        };
        Relationships: [];
      };
```

- [ ] **Step 5: `lib/supabase/confidential.ts` 명단 추가**

주석 블록 마지막 항목(`org_charts` 줄) 뒤에 추가:

```typescript
 * - longterm_revenue_plan: 영업본부 중장기 매출 전망 (migration 20260715000001)
```

`CONFIDENTIAL_TABLES` 배열의 `'org_charts',` 뒤에 추가:

```typescript
  'longterm_revenue_plan',
```

- [ ] **Step 6: 타입 검사**

Run: `npm run typecheck`
Expected: 에러 0. (`ConfidentialTable`이 `keyof Database['public']['Tables']`와 교차하므로, Step 4를 빠뜨렸으면 여기서 컴파일 에러가 난다.)

- [ ] **Step 7: 커밋**

```bash
git add supabase/migrations/20260715000001_create_longterm_revenue_plan.sql lib/database.types.ts lib/supabase/confidential.ts
git commit -m "feat(db): 중장기 매출 전망 사외비 테이블 longterm_revenue_plan 추가"
```

---

### Task 2: 캐시 무효화 태그 등록

**Files:**

- Modify: `scripts/lib/revalidate.py` (`COLUMN_TO_TAGS`)
- Modify: `app/api/revalidate/route.ts` (`ALL_TAGS`)

> 이 태스크를 빠뜨리면 적재는 성공해도 페이지가 `'use cache'` 결과를 붙들고 있어 화면이 갱신되지 않는다(조용한 실패).

- [ ] **Step 1: `scripts/lib/revalidate.py` 매핑 추가**

`'loan_entries': ['loan_entries'],` 줄 바로 뒤에 추가:

```python
    'longterm_revenue_plan': ['longterm_revenue_plan'],
```

- [ ] **Step 2: `app/api/revalidate/route.ts` ALL_TAGS 추가**

`'loan_entries',` 줄 바로 뒤에 추가:

```typescript
  'longterm_revenue_plan',
```

- [ ] **Step 3: 정합성 확인**

Run: `grep -n "longterm_revenue_plan" scripts/lib/revalidate.py app/api/revalidate/route.ts`
Expected: 두 파일 각각 1줄씩, 총 2줄 출력.

- [ ] **Step 4: 커밋**

```bash
git add scripts/lib/revalidate.py app/api/revalidate/route.ts
git commit -m "feat(cache): longterm_revenue_plan 무효화 태그 등록"
```

---

### Task 3: 순수 빌더 + 단위 테스트 (TDD)

**Files:**

- Create: `lib/plan/longterm.ts`
- Test: `lib/plan/__tests__/longterm.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/plan/__tests__/longterm.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  activeSeries,
  basisKey,
  buildLongtermPoints,
  fxNote,
  listBases,
  type LongtermRow,
} from '../longterm';

const FX = 'Booked 기준 (FX 1,300원/USD, 1,400원/EUR)';

/** 픽스처 — 실제 데이터 아님(가짜 숫자). 2026.1Q의 '고객 EDI 100%'는 전부 null(엑셀 N/A 재현). */
function row(
  quarter: number,
  series: LongtermRow['series'],
  year: number,
  value: number | null
): LongtermRow {
  return {
    basis_year: 2026,
    basis_quarter: quarter,
    series,
    period_year: year,
    value_mwon: value,
    fx_note: FX,
  };
}

const ROWS: LongtermRow[] = [
  // 2026.2Q — 3계열 모두 값 있음
  row(2, '수주 Volume', 2027, 100),
  row(2, '수주 Volume', 2028, 110),
  row(2, '고객 EDI 100%', 2027, 90),
  row(2, '고객 EDI 100%', 2028, 95),
  row(2, '한세 전망', 2027, 80),
  row(2, '한세 전망', 2028, 85),
  // 2026.1Q — 고객 EDI 100%는 전부 null
  row(1, '수주 Volume', 2027, 70),
  row(1, '고객 EDI 100%', 2027, null),
  row(1, '한세 전망', 2027, 60),
];

describe('basisKey', () => {
  it('연도.분기Q 형식으로 만든다', () => {
    expect(basisKey(2026, 1)).toBe('2026.1Q');
    expect(basisKey(2026, 2)).toBe('2026.2Q');
  });
});

describe('listBases', () => {
  it('중복 없이 최신 기준 우선으로 정렬한다', () => {
    expect(listBases(ROWS)).toEqual([
      { key: '2026.2Q', year: 2026, quarter: 2 },
      { key: '2026.1Q', year: 2026, quarter: 1 },
    ]);
  });

  it('빈 입력이면 빈 배열', () => {
    expect(listBases([])).toEqual([]);
  });
});

describe('activeSeries', () => {
  it('값이 있는 계열만 고정 순서로 반환한다', () => {
    expect(activeSeries(ROWS, '2026.2Q')).toEqual(['수주 Volume', '고객 EDI 100%', '한세 전망']);
  });

  it('전부 null인 계열은 제외한다 (2026.1Q 고객 EDI 100%)', () => {
    expect(activeSeries(ROWS, '2026.1Q')).toEqual(['수주 Volume', '한세 전망']);
  });

  it('없는 기준이면 빈 배열', () => {
    expect(activeSeries(ROWS, '2099.9Q')).toEqual([]);
  });
});

describe('buildLongtermPoints', () => {
  it('연도 오름차순으로 계열 값을 모은다', () => {
    expect(buildLongtermPoints(ROWS, '2026.2Q')).toEqual([
      { year: 2027, '수주 Volume': 100, '고객 EDI 100%': 90, '한세 전망': 80 },
      { year: 2028, '수주 Volume': 110, '고객 EDI 100%': 95, '한세 전망': 85 },
    ]);
  });

  it('null 값은 null로 유지한다', () => {
    expect(buildLongtermPoints(ROWS, '2026.1Q')).toEqual([
      { year: 2027, '수주 Volume': 70, '고객 EDI 100%': null, '한세 전망': 60 },
    ]);
  });

  it('없는 기준이면 빈 배열', () => {
    expect(buildLongtermPoints(ROWS, '2099.9Q')).toEqual([]);
  });
});

describe('fxNote', () => {
  it('선택 기준의 환율 문구를 반환한다', () => {
    expect(fxNote(ROWS, '2026.2Q')).toBe(FX);
  });

  it('없는 기준이면 null', () => {
    expect(fxNote(ROWS, '2099.9Q')).toBeNull();
  });

  it('fx_note가 비어 있으면 null', () => {
    const rows: LongtermRow[] = [{ ...row(2, '한세 전망', 2027, 10), fx_note: null }];
    expect(fxNote(rows, '2026.2Q')).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run lib/plan/__tests__/longterm.test.ts`
Expected: FAIL — `Failed to resolve import "../longterm"` (파일 없음).

- [ ] **Step 3: 최소 구현 작성**

`lib/plan/longterm.ts`:

```typescript
/**
 * 중장기 매출 전망(longterm_revenue_plan) 타입 + 순수 빌더.
 *
 * 계획 페이지 차트 1번 전용. fetch/캐시는 lib/plan/source.ts가 담당하고
 * 여기는 순수 계산만 둔다(단위 테스트 대상).
 *
 * 단위: 백만원. 엑셀 'N/A'는 value_mwon = null로 적재되며, 전부 null인 계열은
 * activeSeries()에서 탈락해 막대·범례에 나타나지 않는다(0으로 그리면 '전망 0원'이라는
 * 거짓 사실을 표시하게 되므로).
 */

/** 계열 3종 — DB CHECK ↔ sync 적재값 ↔ UI 라벨을 한글 그대로 일치시킨다. 표시 순서이기도 하다. */
export const LONGTERM_SERIES = ['수주 Volume', '고객 EDI 100%', '한세 전망'] as const;
export type LongtermSeries = (typeof LONGTERM_SERIES)[number];

/** longterm_revenue_plan 테이블 row */
export interface LongtermRow {
  basis_year: number;
  basis_quarter: number;
  series: LongtermSeries;
  period_year: number;
  value_mwon: number | null;
  fx_note: string | null;
}

/** 드롭다운 옵션 */
export interface LongtermBasis {
  /** 드롭다운 value 겸 표시 라벨 ('2026.2Q') */
  key: string;
  year: number;
  quarter: number;
}

/** 막대 그룹 1개(= 전망 연도 1개). 계열명이 그대로 recharts dataKey가 된다. */
export type LongtermPoint = { year: number } & Partial<Record<LongtermSeries, number | null>>;

/** (연도, 분기) → 드롭다운 키. */
export function basisKey(year: number, quarter: number): string {
  return `${year}.${quarter}Q`;
}

/** 드롭다운 목록 — 중복 제거 + 최신 기준 우선(연도 desc, 분기 desc). */
export function listBases(rows: readonly LongtermRow[]): LongtermBasis[] {
  const seen = new Map<string, LongtermBasis>();
  for (const r of rows) {
    const key = basisKey(r.basis_year, r.basis_quarter);
    if (!seen.has(key)) seen.set(key, { key, year: r.basis_year, quarter: r.basis_quarter });
  }
  return [...seen.values()].sort((a, b) => b.year - a.year || b.quarter - a.quarter);
}

/** 해당 기준에서 값이 하나라도 있는 계열만 LONGTERM_SERIES 순서로. */
export function activeSeries(rows: readonly LongtermRow[], basis: string): LongtermSeries[] {
  const has = new Set<LongtermSeries>();
  for (const r of rows) {
    if (basisKey(r.basis_year, r.basis_quarter) !== basis) continue;
    if (r.value_mwon != null) has.add(r.series);
  }
  return LONGTERM_SERIES.filter((s) => has.has(s));
}

/** 해당 기준의 연도별 포인트 — 연도 오름차순. 값 없는 계열은 null 유지. */
export function buildLongtermPoints(rows: readonly LongtermRow[], basis: string): LongtermPoint[] {
  const byYear = new Map<number, LongtermPoint>();
  for (const r of rows) {
    if (basisKey(r.basis_year, r.basis_quarter) !== basis) continue;
    let p = byYear.get(r.period_year);
    if (!p) {
      p = { year: r.period_year };
      byYear.set(r.period_year, p);
    }
    p[r.series] = r.value_mwon;
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

/** 해당 기준의 환율 기준 문구(엑셀 원문). 없으면 null. */
export function fxNote(rows: readonly LongtermRow[], basis: string): string | null {
  for (const r of rows) {
    if (basisKey(r.basis_year, r.basis_quarter) !== basis) continue;
    if (r.fx_note) return r.fx_note;
  }
  return null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run lib/plan/__tests__/longterm.test.ts`
Expected: PASS — 12 tests passed.

- [ ] **Step 5: 커밋**

```bash
git add lib/plan/longterm.ts lib/plan/__tests__/longterm.test.ts
git commit -m "feat(plan): 중장기 매출 전망 순수 빌더 + 단위 테스트"
```

---

### Task 4: `source.ts` 확장 (단일 입구 유지)

**Files:**

- Modify: `lib/plan/source.ts`

- [ ] **Step 1: import + fetch 함수 추가**

`import type { PlanRow } from './types';` 아래에 추가:

```typescript
import type { LongtermRow, LongtermSeries } from './longterm';
```

`fetchPlanRows()` 함수 정의 **뒤에** 추가:

```typescript
async function fetchLongtermRows(): Promise<LongtermRow[]> {
  const { data, error } = await confidentialDb
    .from('longterm_revenue_plan')
    .select('*')
    .order('basis_year', { ascending: true })
    .order('basis_quarter', { ascending: true })
    .order('series', { ascending: true })
    .order('period_year', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'longterm_revenue_plan 조회 실패');
    throw new Error(`Supabase longterm_revenue_plan 조회 실패: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    ...r,
    series: r.series as LongtermSeries,
  }));
}
```

- [ ] **Step 2: `PlanData` 인터페이스에 필드 추가**

`usdKrw: number | null;` 줄 뒤에 추가:

```typescript
  /** 중장기 매출 전망 (차트 1) */
  longterm: LongtermRow[];
```

- [ ] **Step 3: `getPlanData()`에 태그 + fetch 추가**

`cacheTag('exchange_rates_live');` 줄 뒤에 추가:

```typescript
  cacheTag('longterm_revenue_plan');
```

`Promise.all` 블록과 return 문을 아래로 교체:

```typescript
  const supabase = createSupabaseAnonClient();
  const [plan, prepared, fx, longterm] = await Promise.all([
    fetchPlanRows(),
    getPreparedPnl(),
    supabase.from('exchange_rates_live').select('base,rate').eq('base', 'USD').maybeSingle(),
    fetchLongtermRows(),
  ]);
  const usdKrw = fx.data?.rate ?? null;
  return { plan, prepared, usdKrw, longterm };
```

- [ ] **Step 4: 타입 검사**

Run: `npm run typecheck`
Expected: 에러 0.

- [ ] **Step 5: 커밋**

```bash
git add lib/plan/source.ts
git commit -m "feat(plan): getPlanData에 중장기 매출 전망 fetch 추가"
```

---

### Task 5: 적재 스크립트

**Files:**

- Create: `scripts/sync_longterm_revenue.py`
- Create(로컬만, git 제외): `참고/영업계획/` 폴더 + 엑셀 파일 복사

- [ ] **Step 1: 엑셀을 프로젝트 자료 폴더로 복사**

```bash
mkdir -p "참고/영업계획"
cp "/c/Users/junghwan.yoon/Downloads/(260624) 영업본부 중장기 매출 계획.xlsx" "참고/영업계획/"
ls "참고/영업계획/"
```

Expected: `(260624) 영업본부 중장기 매출 계획.xlsx` 1개. (`참고/`는 `.gitignore` 대상 — 커밋되지 않는다.)

- [ ] **Step 2: 스크립트 작성**

`scripts/sync_longterm_revenue.py`:

```python
#!/usr/bin/env python3
"""영업본부 중장기 매출 계획 엑셀 → Supabase longterm_revenue_plan 적재.

시트 '연도별 Booked 매출'의 요약표(B2:H11)만 읽는다. 보조 시트(중장기 DATA_*, 864행 원장)와
비율 행(13~14행: EDI/수주, 전망/수주)은 범위 밖.

레이아웃 (1-indexed):
  B2       환율 기준 문구 1줄 ('Booked 기준 (FX n,nnn원/USD, n,nnn원/EUR)')
  B3       '중장기 계획' / D3 '연도별 매출액 (백만원)'
  D4:H4    전망 연도 5개 — 문자열('2027년')
  B5       기준 1 라벨('26. 1Q', 병합 B5:B7) / 5~7행 계열 3종 / D:H 값
  B9       기준 2 라벨('26. 2Q', 병합 B9:B11) / 9~11행 계열 3종 / D:H 값

'N/A'·공란은 null(2026.1Q의 '고객 EDI 100%'가 전부 N/A).

금액 비노출: 요약은 (기준·계열)별 행수·연도 커버리지·null 카운트만 출력. 금액·합계 출력 금지.
사용자가 직접 실행한다. WriteSession으로 자동 revalidate('longterm_revenue_plan').

사용법
-----
  python scripts/sync_longterm_revenue.py --dry-run
  python scripts/sync_longterm_revenue.py
  python scripts/sync_longterm_revenue.py --revalidate-prod

종료 코드
--------
0 정상
2 헤더/레이아웃 검증 실패
3 엑셀 파일 없음
"""
import argparse
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import openpyxl
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')
sys.path.insert(0, str(Path(__file__).parent))
from lib.db import WriteSession  # noqa: E402
from lib.revalidate import revalidate_prod_for_tables  # noqa: E402

SHEET = '연도별 Booked 매출'
TABLE = 'longterm_revenue_plan'
CONFLICT = 'basis_year,basis_quarter,series,period_year'

FX_CELL = (2, 2)          # B2
TITLE_CELL = (3, 2)       # B3
UNIT_CELL = (3, 4)        # D3
YEAR_ROW = 4
COL_SERIES = 3            # C열 — 계열 라벨
COL_FIRST, COL_LAST = 4, 8  # D~H

EXPECTED_TITLE = '중장기 계획'
EXPECTED_UNIT = '연도별 매출액 (백만원)'
SERIES_ORDER = ('수주 Volume', '고객 EDI 100%', '한세 전망')
# 기준 블록: (라벨 셀 행, 계열 시작 행)
BASIS_BLOCKS = ((5, 5), (9, 9))
BASIS_RE = re.compile(r'^(\d{2})\.\s*(\d)Q$')


def _txt(v: Any) -> str:
  return '' if v is None else str(v).strip()


def _num(v: Any) -> float | None:
  """숫자 셀만 값으로. 'N/A'·공란·문자열은 None."""
  if v is None or isinstance(v, bool):
    return None
  if isinstance(v, (int, float)):
    return float(v)
  return None


def resolve_excel() -> Path:
  """LONGTERM_EXCEL_PATH env 우선, 없으면 참고/영업계획/*.xlsx 최신."""
  env = os.environ.get('LONGTERM_EXCEL_PATH', '').strip()
  if env:
    p = Path(env)
    if not p.exists():
      raise FileNotFoundError(f'LONGTERM_EXCEL_PATH 파일 없음: {p}')
    return p
  base = Path(__file__).resolve().parent.parent / '참고' / '영업계획'
  cands = sorted(base.glob('*.xlsx'), key=lambda p: p.stat().st_mtime, reverse=True)
  cands = [p for p in cands if not p.name.startswith('~$')]  # 엑셀 임시 잠금 파일 제외
  if not cands:
    raise FileNotFoundError(f'엑셀 없음: {base}/*.xlsx')
  return cands[0]


def parse_basis(label: str) -> tuple[int, int] | None:
  """'26. 1Q' → (2026, 1). 형식 불일치면 None."""
  m = BASIS_RE.match(label)
  if not m:
    return None
  yy, q = int(m.group(1)), int(m.group(2))
  if not (1 <= q <= 4):
    return None
  return 2000 + yy, q


def parse_year(v: Any) -> int | None:
  """'2027년' → 2027. 숫자 셀도 허용."""
  if isinstance(v, (int, float)) and not isinstance(v, bool):
    return int(v)
  m = re.search(r'(\d{4})', _txt(v))
  return int(m.group(1)) if m else None


def validate_layout(ws) -> list[str]:
  errs = []
  title = _txt(ws.cell(*TITLE_CELL).value)
  if title != EXPECTED_TITLE:
    errs.append(f'  B3: 기대 "{EXPECTED_TITLE}" 실제 "{title}"')
  unit = _txt(ws.cell(*UNIT_CELL).value)
  if unit != EXPECTED_UNIT:
    errs.append(f'  D3: 기대 "{EXPECTED_UNIT}" 실제 "{unit}"')
  for _, start in BASIS_BLOCKS:
    for i, exp in enumerate(SERIES_ORDER):
      actual = _txt(ws.cell(start + i, COL_SERIES).value)
      if actual != exp:
        errs.append(f'  C{start + i}: 기대 "{exp}" 실제 "{actual}"')
  for label_row, _ in BASIS_BLOCKS:
    label = _txt(ws.cell(label_row, 2).value)
    if parse_basis(label) is None:
      errs.append(f'  B{label_row}: 기준 라벨 형식 불일치 (기대 "NN. NQ") 실제 "{label}"')
  return errs


def parse_years(ws) -> tuple[list[tuple[int, int]], list[str]]:
  """[(엑셀 열, 연도)], 오류 목록."""
  out, errs = [], []
  for c in range(COL_FIRST, COL_LAST + 1):
    y = parse_year(ws.cell(YEAR_ROW, c).value)
    if y is None:
      errs.append(f'  {YEAR_ROW}행 {c}열: 연도 파싱 실패 "{_txt(ws.cell(YEAR_ROW, c).value)}"')
    else:
      out.append((c, y))
  return out, errs


def build_entries(ws) -> list[dict[str, Any]]:
  fx = _txt(ws.cell(*FX_CELL).value) or None
  years, errs = parse_years(ws)
  if errs:
    raise ValueError('\n'.join(errs))
  entries: list[dict[str, Any]] = []
  for label_row, start in BASIS_BLOCKS:
    parsed = parse_basis(_txt(ws.cell(label_row, 2).value))
    if parsed is None:
      continue
    by, bq = parsed
    for i, series in enumerate(SERIES_ORDER):
      for col, year in years:
        entries.append({
          'basis_year': by,
          'basis_quarter': bq,
          'series': series,
          'period_year': year,
          'value_mwon': _num(ws.cell(start + i, col).value),
          'fx_note': fx,
        })
  return entries


def summarize(entries: list[dict[str, Any]]) -> None:
  """(기준·계열)별 행수·연도 커버리지·null 카운트. 금액 비노출."""
  agg = defaultdict(lambda: {'rows': 0, 'years': set(), 'nulls': 0})
  for e in entries:
    k = (f"{e['basis_year']}.{e['basis_quarter']}Q", e['series'])
    agg[k]['rows'] += 1
    agg[k]['years'].add(e['period_year'])
    if e['value_mwon'] is None:
      agg[k]['nulls'] += 1
  logger.info('--- 중장기 매출 전망 요약 (기준·계열) — 금액 비노출 ---')
  for k in sorted(agg.keys()):
    v = agg[k]
    logger.info(f'  {k} | rows={v["rows"]} | years={sorted(v["years"])} | nulls={v["nulls"]}')


def main() -> int:
  ap = argparse.ArgumentParser(description='중장기 매출 계획 엑셀 → Supabase longterm_revenue_plan')
  ap.add_argument('--dry-run', action='store_true', help='실제 upsert 없이 파싱·검증만')
  ap.add_argument('--revalidate-prod', action='store_true',
                  help='적재 후 프로덕션 캐시도 추가 무효화 (NEXT_REVALIDATE_PROD_URL)')
  args = ap.parse_args()

  try:
    path = resolve_excel()
  except FileNotFoundError as e:
    logger.error(str(e))
    return 3
  logger.info(f'엑셀 로드: {path.name}')

  wb = openpyxl.load_workbook(path, data_only=True)
  try:
    if SHEET not in wb.sheetnames:
      logger.error(f'시트 없음: "{SHEET}" (보유: {wb.sheetnames})')
      return 2
    ws = wb[SHEET]
    errs = validate_layout(ws)
    if errs:
      logger.error(f'[{SHEET}] 레이아웃 불일치:\n' + '\n'.join(errs))
      return 2
    try:
      entries = build_entries(ws)
    except ValueError as e:
      logger.error(f'[{SHEET}] 연도 헤더 오류:\n{e}')
      return 2
  finally:
    wb.close()

  logger.info(f'[{SHEET}] {len(entries)}행 파싱 완료')
  summarize(entries)

  if args.dry_run:
    logger.success('dry-run 완료')
    return 0
  if not entries:
    logger.warning('적재할 행 없음')
    return 0

  with WriteSession() as w:
    w.table(TABLE).upsert(entries, on_conflict=CONFLICT).execute()
  logger.success(f'{TABLE} upsert 완료: {len(entries)}행')
  if args.revalidate_prod:
    revalidate_prod_for_tables([TABLE])
  return 0


if __name__ == '__main__':
  sys.exit(main())
```

- [ ] **Step 3: 문법 검사**

Run: `scripts/venv/Scripts/python.exe -m py_compile scripts/sync_longterm_revenue.py`
Expected: 출력 없음(성공).

- [ ] **Step 4: dry-run 실행**

Run: `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe scripts/sync_longterm_revenue.py --dry-run`

Expected 출력(금액 없음):

```
엑셀 로드: (260624) 영업본부 중장기 매출 계획.xlsx
[연도별 Booked 매출] 30행 파싱 완료
--- 중장기 매출 전망 요약 (기준·계열) — 금액 비노출 ---
  ('2026.1Q', '고객 EDI 100%') | rows=5 | years=[2027, 2028, 2029, 2030, 2031] | nulls=5
  ('2026.1Q', '수주 Volume') | rows=5 | years=[2027, ...] | nulls=0
  ('2026.1Q', '한세 전망') | rows=5 | years=[2027, ...] | nulls=0
  ('2026.2Q', ...) 3줄 | rows=5 | nulls=0
dry-run 완료
```

**필수 확인:** 총 30행 · `2026.1Q`/`고객 EDI 100%`의 `nulls=5` · 나머지 5쌍 `nulls=0` · 연도 5개.
불일치 시 진행하지 말고 레이아웃 상수를 재확인한다.

- [ ] **Step 5: 커밋**

```bash
git add scripts/sync_longterm_revenue.py
git commit -m "feat(scripts): 중장기 매출 계획 엑셀 → longterm_revenue_plan 적재 스크립트"
```

---

### Task 6: 본 적재 + DB 검증

**Files:** 없음(실행만)

- [ ] **Step 1: 본 적재**

Run: `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe scripts/sync_longterm_revenue.py --revalidate-prod`
Expected: `longterm_revenue_plan upsert 완료: 30행` + revalidate 성공 로그.

- [ ] **Step 2: DB 검증 (구조·카운트만, 금액 미조회)**

`mcp__supabase__execute_sql`:

```sql
select basis_year, basis_quarter, series,
       count(*) as rows,
       count(value_mwon) as non_null,
       min(period_year) as y_min, max(period_year) as y_max
from longterm_revenue_plan
group by basis_year, basis_quarter, series
order by basis_year, basis_quarter, series;
```

Expected: 6행. 각 `rows=5`, `y_min=2027`, `y_max=2031`.
`(2026, 1, '고객 EDI 100%')`만 `non_null=0`, 나머지 5행은 `non_null=5`.

- [ ] **Step 3: RLS 차단 확인**

`mcp__supabase__get_advisors` (`type: "security"`) 실행.
Expected: `longterm_revenue_plan` 관련 RLS 미설정 경고 없음(RLS enabled + 정책 없음이 의도).

---

### Task 7: 차트 컴포넌트

**Files:**

- Modify: `components/oem-companies/common/chartStyle.ts` (경영관리 라벨 상수 추가)
- Create: `components/management/plan/LongtermRevenueChart.tsx`
- Modify: `components/management/plan/PlanDashboard.tsx`

- [ ] **Step 1: 경영관리 데이터 라벨 상수 추가**

`components/oem-companies/common/chartStyle.ts`의 `Y_AXIS_PADDED_DOMAIN` 정의 **앞에** 추가:

```typescript
/**
 * 경영관리 차트 막대 위 데이터 라벨 (16px / 500).
 * OEM 차트(DATA_LABEL_STYLE, 15px/700)와 크기가 다르다 — docs/chart-guide.md §5-B
 * "콤보·인원 라벨 16px(경영관리)" 규칙. 기존 PlanAchievementChart는 동일 값을 리터럴로
 * 갖고 있으나 이번 변경 범위 밖이라 손대지 않는다(신규 차트만 이 상수를 쓴다).
 */
export const MGMT_DATA_LABEL_STYLE = {
  fill: 'var(--foreground)',
  fontSize: 16,
  fontWeight: 500,
} as const;
```

- [ ] **Step 2: 차트 컴포넌트 작성**

`components/management/plan/LongtermRevenueChart.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartSection } from './_selectors';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { OEM_COLORS } from '@/components/charts/palette';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import {
  GRID_STROKE_OPACITY,
  MGMT_DATA_LABEL_STYLE,
  Y_AXIS_PADDED_DOMAIN,
} from '@/components/oem-companies/common/chartStyle';
import { useChartHeight } from '@/lib/useChartHeight';
import { useIsMobile } from '@/lib/useIsMobile';
import {
  activeSeries,
  buildLongtermPoints,
  fxNote,
  listBases,
  type LongtermRow,
} from '@/lib/plan/longterm';

const TITLE = '1. 중장기 매출 전망';

/** 백만원 정수 + 천단위 콤마. (PlanAchievementChart의 fmt와 동일 표기 규칙) */
function fmt(n: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
}

/**
 * 차트 1 — 중장기 매출 전망 (2027~2031, 백만원).
 *
 * 데이터 기준(2026.1Q/2026.2Q)을 드롭다운으로 전환한다. 값이 전부 없는 계열은
 * activeSeries()에서 탈락하므로 2026.1Q에서는 '고객 EDI 100%' 막대·범례가 나타나지 않는다.
 */
export default function LongtermRevenueChart({ rows }: { rows: LongtermRow[] }) {
  const bases = useMemo(() => listBases(rows), [rows]);
  const [basis, setBasis] = useState<string>(() => bases[0]?.key ?? '');
  const points = useMemo(() => buildLongtermPoints(rows, basis), [rows, basis]);
  const series = useMemo(() => activeSeries(rows, basis), [rows, basis]);
  const note = useMemo(() => fxNote(rows, basis), [rows, basis]);
  const h = useChartHeight(300, 360, 420);
  const isMobile = useIsMobile();

  if (bases.length === 0) {
    return (
      <ChartSection title={TITLE} unit="백만원">
        <p className="py-12 text-center text-sm text-muted-foreground">데이터가 없습니다.</p>
      </ChartSection>
    );
  }

  return (
    <ChartSection
      title={TITLE}
      unit="백만원"
      controls={
        <Select value={basis} onValueChange={(v) => v != null && setBasis(String(v))}>
          <SelectTrigger className="h-8 w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {bases.map((b) => (
              <SelectItem key={b.key} value={b.key}>
                {b.key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {note ? <p className="mb-2 text-sm text-muted-foreground">{note}</p> : null}
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={points} margin={{ top: 28, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            className="stroke-border"
            strokeOpacity={GRID_STROKE_OPACITY}
            vertical={false}
          />
          <XAxis dataKey="year" tick={{ fontSize: 14 }} tickFormatter={(v: number) => `${v}년`} />
          <YAxis
            tickFormatter={(v: number) => fmt(v)}
            tick={{ fontSize: 14 }}
            width={70}
            domain={Y_AXIS_PADDED_DOMAIN}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)' }}
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelFormatter={(v: unknown) => `${v}년`}
            formatter={(value: unknown) => (typeof value === 'number' ? fmt(value) : '—')}
          />
          <Legend
            verticalAlign="top"
            align="center"
            wrapperStyle={{ paddingBottom: 8, fontSize: 14 }}
          />
          {series.map((s, i) => (
            <Bar key={s} dataKey={s} name={s} fill={OEM_COLORS[i]} radius={[3, 3, 0, 0]}>
              {!isMobile && (
                <LabelList
                  dataKey={s}
                  position="top"
                  formatter={(value: unknown) => (typeof value === 'number' ? fmt(value) : '')}
                  style={MGMT_DATA_LABEL_STYLE}
                />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartSection>
  );
}
```

> **라벨 겹침 판단 기준(Task 9에서 확인):** 5연도 × 3계열 = 최대 15개 라벨이다. md(768px) 미만은
> `useIsMobile`로 이미 라벨을 끈다. md~lg에서 라벨이 서로 겹치면 `MGMT_DATA_LABEL_STYLE` 대신
> `{ ...MGMT_DATA_LABEL_STYLE, fontSize: 13 }`로 낮추지 말고 **`!isMobile` 조건을
> `useChartHeight(0, 0, 1) === 1`(lg 전용)로 좁힌다** — 경영관리 라벨 16px 규칙(chart-guide §5-B)을
> 깨지 않기 위해서다.

- [ ] **Step 3: `PlanDashboard.tsx`에 등록**

`import type { PlanRow } from '@/lib/plan/types';` 뒤에 추가:

```typescript
import type { LongtermRow } from '@/lib/plan/longterm';
```

dynamic import 목록 **맨 위**(`const OrderTargetChart = ...` 앞)에 추가:

```typescript
const LongtermRevenueChart = dynamic(() => import('./LongtermRevenueChart'), { ssr: false });
```

`Props` 인터페이스에 추가:

```typescript
  /** 중장기 매출 전망 (차트 1) */
  longterm: LongtermRow[];
```

함수 시그니처를 교체:

```typescript
export default function PlanDashboard({ rows, prepared, usdKrw, longterm }: Props) {
```

JSDoc의 `8개 차트에 전달` → `10개 차트에 전달`로 수정하고, 첫 `<LazyMount>` **앞에** 추가:

```tsx
      <LazyMount className="min-h-[480px] md:min-h-[560px]">
        <LongtermRevenueChart rows={longterm} />
      </LazyMount>
```

- [ ] **Step 4: `app/management/plan/page.tsx` 전달**

전체를 아래로 교체:

```tsx
import PlanDashboard from '@/components/management/plan/PlanDashboard';
import { getPlanData } from '@/lib/plan/source';

/** 계획 페이지 (server) — getPlanData()로 사외비 pnl_plan + 중장기 전망 + 실적 + 환율 fetch 후 클라이언트 전달. */
export default async function PlanPage() {
  const { plan, prepared, usdKrw, longterm } = await getPlanData();
  return <PlanDashboard rows={plan} prepared={prepared} usdKrw={usdKrw} longterm={longterm} />;
}
```

- [ ] **Step 5: 타입 검사**

Run: `npm run typecheck`
Expected: 에러 0.

- [ ] **Step 6: 커밋**

```bash
git add components/oem-companies/common/chartStyle.ts components/management/plan/LongtermRevenueChart.tsx components/management/plan/PlanDashboard.tsx app/management/plan/page.tsx
git commit -m "feat(plan): 중장기 매출 전망 차트(1번) 추가 — 기준 드롭다운 + 3계열 그룹 막대"
```

---

### Task 8: 기존 차트 번호 재정렬 (2~10)

**Files:** (제목 문자열만 변경, 로직 무변경)

- Modify: `components/management/plan/FactoryTargetChart.tsx:19`
- Modify: `components/management/plan/ImprovementTargetChart.tsx:19`
- Modify: `components/management/plan/JilinTargetChart.tsx:21`
- Modify: `components/management/plan/OpIncomeTargetChart.tsx:26`
- Modify: `components/management/plan/OrderFunnelChart.tsx:130`
- Modify: `components/management/plan/OrderTargetChart.tsx:23`
- Modify: `components/management/plan/RevenueTargetChart.tsx:25`
- Modify: `components/management/plan/SangsukTargetChart.tsx:21`
- Modify: `components/management/plan/UsTargetChart.tsx:45`

- [ ] **Step 1: 큰 번호부터 역순으로 치환**

번호 충돌을 피하려면 **9 → 10부터** 내려온다.

```
FactoryTargetChart.tsx      title="9. 공장 매출 목표 달성"    → title="10. 공장 매출 목표 달성"
ImprovementTargetChart.tsx  title="8. 손익개선 목표 달성"     → title="9. 손익개선 목표 달성"
JilinTargetChart.tsx        title="7. 지린법인 목표 달성"     → title="8. 지린법인 목표 달성"
SangsukTargetChart.tsx      title="6. 상숙법인 목표 달성"     → title="7. 상숙법인 목표 달성"
UsTargetChart.tsx           title="5. 미국법인 목표 달성"     → title="6. 미국법인 목표 달성"
OpIncomeTargetChart.tsx     title="4. 전사 영업이익 목표 달성" → title="5. 전사 영업이익 목표 달성"
RevenueTargetChart.tsx      title="3. 전사 매출목표 달성"     → title="4. 전사 매출목표 달성"
OrderFunnelChart.tsx        title="2. 입찰 성공율"           → title="3. 입찰 성공율"
OrderTargetChart.tsx        title="1. 전사 수주목표 달성"     → title="2. 전사 수주목표 달성"
```

- [ ] **Step 2: 번호 1~10이 각 1회씩 존재하는지 확인**

Run: `grep -rhn 'title="[0-9]' components/management/plan/ | grep -o 'title="[0-9]*\.' | sort -V`

Expected: `title="1.` ~ `title="10.` 각 1줄씩, 총 10줄. 중복·누락 없음.

- [ ] **Step 3: 커밋**

```bash
git add components/management/plan/
git commit -m "refactor(plan): 중장기 매출 전망 삽입에 따른 차트 번호 2~10 재정렬"
```

---

### Task 9: 전체 검증 (정적 + UI)

**Files:** 없음(실행만)

- [ ] **Step 1: 통합 검사**

Run: `npm run check-all`
Expected: lint 0 · format:check 통과 · typecheck 0 · vitest 전건 PASS(longterm 12건 포함).
실패 시 `npm run format` / `npm run lint:fix` 후 재실행.

- [ ] **Step 2: dev 서버 fresh 기동**

`'use cache'` 결과가 dev에서 stale할 수 있으므로 재시작한다.

```bash
# 기존 dev 서버 종료 후
rm -rf .next
npm run dev
```

Expected: `Ready` 로그. 포트는 3000이 사용 중이면 3001(정상).

- [ ] **Step 3: UI 검증 (사외비 — 구조 불리언만)**

Playwright로 로그인(`.env.local`의 `MOBILITY_ID`/`MOBILITY_PW`, dotenv 로드 — 자격증명 stdout 금지)
→ `/management/plan` 진입(`wait_for_url`은 **최종 경로**까지 대기, `/login` 미포함 조건만으로는 중간 `/`에서 조기 종료).
차트는 `LazyMount`(IntersectionObserver)라 `mouse.wheel`로 스크롤해야 마운트된다.

확인 항목(**금액 셀 미접근** — `evaluate`로 아래 불리언/개수만 추출):

1. 첫 번째 `<section>`의 `h2` 텍스트가 `1. 중장기 매출 전망`으로 시작하고 `· 단위 백만원` 포함
2. 환율 문구가 `FX` 및 `원/USD` 부분 문자열을 포함(값 자체는 출력하지 말고 `includes` 불리언만)
3. 드롭다운 기본값 텍스트 = `2026.2Q`
4. 범례 항목 수 = **3** (2026.2Q)
5. 드롭다운 → `2026.1Q` 전환 후 범례 항목 수 = **2**, 범례 텍스트에 `고객 EDI` 미포함(불리언)
6. 막대(`.recharts-bar-rectangle`) 개수: 2Q=15, 1Q=10
7. 마지막 `<section>`의 `h2`가 `10.`으로 시작
8. 콘솔 에러 0 · 네트워크 4xx/5xx 0

> headless recharts는 축 틱 `<text>`가 페인트되지 않으므로 **틱 라벨 문자열 검증은 하지 않는다**
> (연도 라벨 정확성은 Task 3의 Vitest가 담보).

- [ ] **Step 4: 반응형 + 라벨 겹침 확인**

viewport 375 / 768 / 1440에서 스크린샷.
Expected: 가로 스크롤 없음. 1440에서 데이터 라벨이 서로 겹치지 않음. 375(모바일)에서는 라벨 미표시(`useIsMobile`).
768~1440에서 겹치면 Task 7 Step 2의 주석 기준대로 lg 전용으로 좁힌다.

---

### Task 10: 문서 갱신

**Files:**

- Modify: `AGENTS.md`
- Modify: `Architecture.md`
- Modify: `docs/chart-guide.md`

- [ ] **Step 1: `AGENTS.md` — 사외비 테이블 격리 목록**

"사외비 테이블 격리" 문단의 마이그레이션 나열에 `20260715000001` 추가하고, 테이블 명단에
`longterm_revenue_plan` 추가. `lib/supabase/` 항목의 `confidentialDb.from(...)` union 나열에도 추가.

- [ ] **Step 2: `AGENTS.md` — scripts 유지 목록 + 적재 정책**

`scripts/` 섹션의 "정기 재실행이라 유지" 괄호 목록에 `sync_longterm_revenue.py` 추가.
"사외비 적재 정책" 문단에 한 줄 추가:

```markdown
`sync_longterm_revenue.py`는 **다른 엑셀**(`참고/영업계획/*.xlsx`, `LONGTERM_EXCEL_PATH` env 우선)을 읽으므로 `sync_management_excel.py` 오케스트레이터에 **등록하지 않는다**(등록 시 dry-run이 통째 실패). 분기 1회 로컬 수동 실행 + `--revalidate-prod`.
```

- [ ] **Step 3: `AGENTS.md` — 라우트 표**

`/management` 행의 탭 설명에 계획 탭 차트 1번이 중장기 매출 전망임을 한 구절 추가
(사외비 테이블 나열에 `longterm_revenue_plan` 포함).

- [ ] **Step 4: `Architecture.md`**

- §5-A 경영관리 탭 구조: plan 탭 차트 목록을 1~10으로 갱신(1번 = 중장기 매출 전망, 기존 항목 2~10).
- §7 데이터 모델: `longterm_revenue_plan` 테이블 정의 추가(컬럼·PK·RLS·단위·소스 엑셀).

- [ ] **Step 5: `docs/chart-guide.md`**

§3 `/management` 카탈로그에 한 줄 추가:

```markdown
- `plan/LongtermRevenueChart` — 세로 그룹 막대(3계열) + 기준 드롭다운. 값 전무 계열 자동 제외. 라벨 `MGMT_DATA_LABEL_STYLE`(16px)
```

§5-B 글자 크기 표의 "콤보·인원 라벨 16px" 행 비고에 `MGMT_DATA_LABEL_STYLE` 상수명 병기.

- [ ] **Step 6: 커밋**

```bash
git add AGENTS.md Architecture.md docs/chart-guide.md
git commit -m "docs: 중장기 매출 전망 차트 + longterm_revenue_plan 반영"
```

---

## 완료 기준

- [ ] `npm run check-all` 통과 (vitest longterm 12건 포함)
- [ ] dry-run 30행 / 2026.1Q 고객 EDI nulls=5 확인
- [ ] DB 6그룹 × 5행, `y_min=2027` `y_max=2031`
- [ ] `/management/plan` 1번 = 중장기 매출 전망, 마지막 = 10번
- [ ] 드롭다운 2026.2Q → 범례 3 / 2026.1Q → 범례 2
- [ ] 콘솔·네트워크 에러 0, 375/768/1440 가로 스크롤 없음
- [ ] 금액 값이 stdout·로그·커밋에 노출되지 않음
