# 경영관리 — 재고 페이지(/management/inventory) 구현 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/management/inventory`에 사외비 재고 데이터(2025.01~2026.12 월별 계획·실적)를 적재하고 KPI 카드 4개 + 콤보/계획대비/운송 차트 3개를 렌더한다.

**Architecture:**

- DB: 새 사외비 테이블 `inventory_entries` (RLS enable + 정책 없음 → service_role 전용).
- 수집: `scripts/sync_inventory.py`가 `참고/손익/자료정리_월별손익_*.xlsx`의 `재고` 시트 → `WriteSession` upsert + 자동 `revalidateTag('inventory_entries')`.
- 도메인: `lib/inventory/` (`source.ts` = `'use cache'` + `confidentialDb` fetch, `aggregate.ts` = pure 변환·환산·KPI 빌더, `__tests__/aggregate.test.ts` = vitest).
- UI: `components/management/inventory/` — `InventoryDashboard`(client 루트, LazyMount+dynamic), `InventoryKpiCards`, `InventoryStatusChart`(콤보), `InventoryAchievementChart`(차트 2·3 공통).
- 환산: 모든 화면 표시값 = **억원**. `백만USD × fx_rate / 100`. `fx_rate=1400.0` 고정(DB 컬럼에 저장).
- 권한: 기존 `app/management/layout.tsx` 인증 가드 자동 적용 — 별도 작업 없음.

**Tech Stack:** Next.js 16 (cacheComponents) · React 19 · Recharts (lightweight-charts 미사용 차트 영역) · Tailwind 4 · Supabase service_role · Python 3 + openpyxl + postgrest-py.

**핵심 결정사항 (grill-me 결과):**

- Q1: 별도 `inventory_entries` 테이블 (pnl_plan과 분리)
- Q2: 원본 단위 DB 저장 + 페이지에서 환산
- Q3: `fx_rate` numeric(10,4) (`"1,400원/$"` 파싱)
- Q4: 단일 페이지 세로 스택
- Q5: 차트 1 운송은 1개 층 합산
- Q6: 차트 1 = 실적만
- Q7: 차트 1 X축 = 실적 끝까지, 차트 2/3 = 계획 끝까지
- Q8: 회전율 표시 = "X.X회"
- Q9: 차트 2 "전체" = DB의 `전체-전체재고` 행 (4분류합과 일치 확인됨)
- Q10: 차트 2 "운송" 토글 = 영업+미국환산+우즈벡환산 합산
- Q11: 차트 2/3 데이터 레이블 없음, 호버 툴팁만
- Q12: 추가 차트 KPI 카드 + 회전기간(차트 1에 통합)
- Q13: KPI 4개 = 전체재고(MoM%) / 회전율(+회전기간 보조) / 최신 달성율 / 운송 비중

---

## File Structure (생성·수정 파일 매트릭스)

### 신규 파일

| 경로                                                              | 책임                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `supabase/migrations/20260528000002_create_inventory_entries.sql` | 사외비 inventory_entries 테이블 + RLS + Index                                  |
| `scripts/sync_inventory.py`                                       | 엑셀 `재고` 시트 → `inventory_entries` upsert (WriteSession + 자동 revalidate) |
| `lib/inventory/types.ts`                                          | InventoryRow DB 행 타입 + 차트 포인트 타입                                     |
| `lib/inventory/aggregate.ts`                                      | pure 함수 — USD 환산, 월별 포인트 빌더, KPI 계산                               |
| `lib/inventory/__tests__/aggregate.test.ts`                       | aggregate.ts 단위 테스트                                                       |
| `lib/inventory/source.ts`                                         | `'use cache'` + `cacheTag` + `confidentialDb` fetch                            |
| `components/management/inventory/InventoryDashboard.tsx`          | client 루트 (LazyMount + dynamic)                                              |
| `components/management/inventory/InventoryKpiCards.tsx`           | KPI 카드 4개                                                                   |
| `components/management/inventory/InventoryStatusChart.tsx`        | 차트 1 (콤보: 누적막대 + 회전율)                                               |
| `components/management/inventory/InventoryAchievementChart.tsx`   | 차트 2/3 공통 (월별 X축, 토글)                                                 |

### 수정 파일

| 경로                                | 변경 내용                                                        |
| ----------------------------------- | ---------------------------------------------------------------- |
| `lib/database.types.ts`             | Supabase MCP로 재생성 — `inventory_entries` 타입 추가            |
| `lib/supabase/confidential.ts`      | `CONFIDENTIAL_TABLES`에 `'inventory_entries'` 한 줄 추가         |
| `app/management/inventory/page.tsx` | placeholder → 실제 dashboard                                     |
| `AGENTS.md`                         | `/management/inventory` 라우트 책임 표 + 사외비 테이블 명단 갱신 |

---

## Task 1: DB 마이그레이션 — inventory_entries 테이블

**Files:**

- Create: `supabase/migrations/20260528000002_create_inventory_entries.sql`

- [ ] **Step 1.1: 최신 마이그레이션 번호 확인**

Run (PowerShell):

```powershell
Get-ChildItem supabase/migrations -Filter "20260528*.sql" | Select-Object Name
```

Expected: `20260528000001_create_pnl_plan.sql` 존재. 새 파일은 `20260528000002_*`.

- [ ] **Step 1.2: 마이그레이션 SQL 작성**

Create `supabase/migrations/20260528000002_create_inventory_entries.sql`:

```sql
-- 재고 추이 — 재고 시트(long-format) 적재.
-- 한 행 = (분류,항목,계획/실적,연도,월) 단위의 단일 지표값.
-- 사외비: RLS enable + 정책 없음(default deny). service_role(admin)만 접근.

CREATE TABLE inventory_entries (
  category     text NOT NULL,                  -- 전체|운영|관리|보상|운송
  item         text NOT NULL,                  -- 전체 재고|운영 재고|관리 재고|보상 재고|영업 재고|미국 운송|우즈벡 운송|회전율
  kind         text NOT NULL CHECK (kind IN ('plan','actual')),
  period_year  int  NOT NULL,
  period_month int  NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  unit         text,                            -- 억원|백만USD|NULL(회전율)
  fx_rate      numeric(10,4),                   -- 적용환율 (1400.0). USD 환산용.
  value        numeric(18,4),
  PRIMARY KEY (category, item, kind, period_year, period_month)
);

CREATE INDEX idx_inventory_entries_lookup
  ON inventory_entries(category, item, kind, period_year, period_month);

ALTER TABLE inventory_entries ENABLE ROW LEVEL SECURITY;
-- 정책 생성하지 않음 → anon/authenticated default deny. service_role은 RLS 우회.

COMMENT ON TABLE inventory_entries IS '한세모빌리티 재고 계획·실적 추이 — 사외비. 서버 컴포넌트의 admin client(service_role)로만 접근.';
```

- [ ] **Step 1.3: 마이그레이션 푸시 (사용자 직접 실행 권장)**

Supabase MCP 또는 사용자가 Studio에서 SQL 실행. 검증:

```powershell
# 적용 후 columns 확인 — Supabase Studio SQL Editor에서:
# SELECT column_name, data_type FROM information_schema.columns WHERE table_name='inventory_entries';
```

Expected: 8개 컬럼 (category, item, kind, period_year, period_month, unit, fx_rate, value).

- [ ] **Step 1.4: 커밋**

```powershell
git add supabase/migrations/20260528000002_create_inventory_entries.sql
git commit -m "feat(db): add inventory_entries (사외비 재고 계획·실적)"
```

---

## Task 2: TypeScript 타입 재생성

**Files:**

- Modify: `lib/database.types.ts` (전체 재생성)

- [ ] **Step 2.1: Supabase MCP로 타입 재생성**

Supabase MCP의 `generate_typescript_types` 호출 또는:

```powershell
npx supabase gen types typescript --project-id <PROJECT_ID> --schema public > lib/database.types.ts
```

- [ ] **Step 2.2: inventory_entries 타입 존재 확인**

```powershell
Select-String -Path lib/database.types.ts -Pattern "inventory_entries" | Select-Object -First 3
```

Expected: `Row`, `Insert`, `Update` 3개 타입 정의 라인 매치.

- [ ] **Step 2.3: typecheck**

```powershell
npm run typecheck
```

Expected: 신규 에러 없음 (기존 타입과 호환).

- [ ] **Step 2.4: 커밋**

```powershell
git add lib/database.types.ts
git commit -m "chore(types): regenerate database.types with inventory_entries"
```

---

## Task 3: confidentialDb facade에 inventory_entries 등록

**Files:**

- Modify: `lib/supabase/confidential.ts:34-39`

- [ ] **Step 3.1: CONFIDENTIAL_TABLES 배열에 한 줄 추가**

Edit `lib/supabase/confidential.ts`:

Replace:

```ts
const CONFIDENTIAL_TABLES = [
  'pnl_entries',
  'pnl_cost_structure',
  'chat_audit_log',
  'pnl_plan',
] as const;
```

With:

```ts
const CONFIDENTIAL_TABLES = [
  'pnl_entries',
  'pnl_cost_structure',
  'chat_audit_log',
  'pnl_plan',
  'inventory_entries',
] as const;
```

또한 상단 주석(33-39 라인)에 한 줄 추가:

```ts
 * - inventory_entries: 재고 계획·실적 추이 (migration 20260528000002)
```

- [ ] **Step 3.2: typecheck로 union 컴파일 확인**

```powershell
npm run typecheck
```

Expected: 에러 없음. `keyof Database['public']['Tables']`와 교집합이 자동으로 `inventory_entries`를 받아들임.

- [ ] **Step 3.3: 커밋**

```powershell
git add lib/supabase/confidential.ts
git commit -m "feat(confidential): allow inventory_entries via confidentialDb"
```

---

## Task 4: sync_inventory.py 스크립트 작성

**Files:**

- Create: `scripts/sync_inventory.py`

- [ ] **Step 4.1: 스크립트 골격 작성 (헤더, import, 상수)**

Create `scripts/sync_inventory.py`:

```python
#!/usr/bin/env python3
"""재고 시트(자료정리_월별손익*.xlsx '재고') → Supabase inventory_entries 적재.

금액 비노출: 요약은 (분류·항목·kind)별 행수·연도 커버리지·null 카운트만 출력.
검증: 4분류 합(운영+관리+보상+영업+미국환산+우즈벡환산) vs 전체재고 mismatch 행수만 보고.
사용자가 직접 실행한다. WriteSession으로 자동 revalidate('inventory_entries').

사용법
-----
  python scripts/sync_inventory.py --dry-run
  python scripts/sync_inventory.py

종료 코드
--------
0 정상
2 헤더 검증 실패
"""
import argparse
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

SHEET = '재고'
TABLE = 'inventory_entries'
CONFLICT = 'category,item,kind,period_year,period_month'
HEADER_ROW = 1
DATA_START = 2

# 1-indexed 컬럼 매핑
COL = {'year': 1, 'pm': 2, 'kind': 3, 'fx': 4, 'category': 5, 'item': 6, 'unit': 7, 'value': 8}
EXPECTED_HEADERS = {
  1: '연도', 2: '월', 3: '계획/실적', 4: '적용환율',
  5: '분류', 6: '항목', 7: '단위', 8: '밸류',
}
KIND_MAP = {'계획': 'plan', '실적': 'actual'}
BATCH_SIZE = 500
TOLERANCE_PCT = 0.5  # 4분류합 vs 전체재고 mismatch 임계
```

- [ ] **Step 4.2: 파서 헬퍼 함수**

Append:

```python
def _num(v: Any) -> float | None:
  """숫자 셀을 float로 정규화."""
  if v is None or v == '' or isinstance(v, bool):
    return None
  if isinstance(v, (int, float)):
    return float(v)
  return None


def _txt(v: Any) -> str:
  return '' if v is None else str(v).strip()


def parse_fx(v: Any) -> float | None:
  """`"1,400원/$"` → 1400.0. 비숫자/null이면 None."""
  s = _txt(v)
  if not s:
    return None
  m = re.search(r'([\d,]+(?:\.\d+)?)', s)
  if not m:
    return None
  return float(m.group(1).replace(',', ''))


def validate_headers(ws) -> list[str]:
  errs = []
  for c, exp in EXPECTED_HEADERS.items():
    actual = _txt(ws.cell(HEADER_ROW, c).value)
    if actual != exp:
      errs.append(f'  컬럼 {c}: 기대 "{exp}" 실제 "{actual}"')
  return errs
```

- [ ] **Step 4.3: 행 파서**

Append:

```python
def row_to_entry(ws, r: int) -> dict[str, Any] | None:
  year = ws.cell(r, COL['year']).value
  if not isinstance(year, (int, float)):
    return None
  month = ws.cell(r, COL['pm']).value
  if not isinstance(month, (int, float)) or not (1 <= int(month) <= 12):
    return None
  category = _txt(ws.cell(r, COL['category']).value)
  item = _txt(ws.cell(r, COL['item']).value)
  if not category or not item:
    return None
  kind = KIND_MAP.get(_txt(ws.cell(r, COL['kind']).value))
  if kind is None:
    return None
  unit_raw = _txt(ws.cell(r, COL['unit']).value)
  return {
    'category': category,
    'item': item,
    'kind': kind,
    'period_year': int(year),
    'period_month': int(month),
    'unit': unit_raw or None,
    'fx_rate': parse_fx(ws.cell(r, COL['fx']).value),
    'value': _num(ws.cell(r, COL['value']).value),
  }
```

- [ ] **Step 4.4: summarize + 검증 함수 (금액 비노출)**

Append:

```python
def summarize(entries: list[dict[str, Any]]) -> None:
  """(분류·항목·kind) 행수·연도 커버리지·null 카운트. 금액 비노출."""
  agg = defaultdict(lambda: {'rows': 0, 'years': set(), 'nulls': 0})
  for e in entries:
    k = (e['category'], e['item'], e['kind'])
    agg[k]['rows'] += 1
    agg[k]['years'].add(e['period_year'])
    if e['value'] is None:
      agg[k]['nulls'] += 1
  logger.info('--- 재고 요약 (분류·항목·kind) — 금액 비노출 ---')
  for k in sorted(agg.keys()):
    v = agg[k]
    logger.info(f'  {k} | rows={v["rows"]} | years={sorted(v["years"])} | nulls={v["nulls"]}')


def validate_total(entries: list[dict[str, Any]]) -> None:
  """4분류 합 vs 전체재고 mismatch 행수만 보고 (금액 비노출, 경고만)."""
  data: dict[tuple, dict[str, float]] = defaultdict(dict)
  for e in entries:
    if e['value'] is None:
      continue
    key = (e['period_year'], e['period_month'], e['kind'])
    cat, item = e['category'], e['item']
    if cat == '전체' and item == '전체 재고':
      data[key]['전체'] = e['value']
    elif cat == '운영' and item == '운영 재고':
      data[key]['운영'] = e['value']
    elif cat == '관리' and item == '관리 재고':
      data[key]['관리'] = e['value']
    elif cat == '보상' and item == '보상 재고':
      data[key]['보상'] = e['value']
    elif cat == '운송' and item == '영업 재고':
      data[key]['영업'] = e['value']
    elif cat == '운송' and item == '미국 운송':
      data[key]['미국USD'] = e['value']
      data[key].setdefault('_fx', e['fx_rate'] or 1400.0)
    elif cat == '운송' and item == '우즈벡 운송':
      data[key]['우즈벡USD'] = e['value']
      data[key].setdefault('_fx', e['fx_rate'] or 1400.0)
  mismatches = 0
  for key, d in data.items():
    total = d.get('전체')
    if total is None:
      continue
    fx = d.get('_fx', 1400.0)
    calc = (
      d.get('운영', 0)
      + d.get('관리', 0)
      + d.get('보상', 0)
      + d.get('영업', 0)
      + d.get('미국USD', 0) * fx / 100
      + d.get('우즈벡USD', 0) * fx / 100
    )
    if total == 0:
      continue
    diff_pct = abs(total - calc) / abs(total) * 100
    if diff_pct > TOLERANCE_PCT:
      mismatches += 1
  if mismatches:
    logger.warning(f'4분류합 vs 전체재고 mismatch: {mismatches}행 (tol={TOLERANCE_PCT}%)')
  else:
    logger.info(f'검증 OK: 4분류합 == 전체재고 (tol={TOLERANCE_PCT}%)')
```

- [ ] **Step 4.5: main() + 입력 파일 헬퍼**

Append:

```python
def _latest_excel() -> Path:
  base = Path(__file__).resolve().parents[1] / '참고' / '손익'
  cands = sorted(base.glob('자료정리_월별손익*.xlsx'))
  if not cands:
    raise FileNotFoundError(f'손익 엑셀 없음: {base}')
  return cands[-1]


def main() -> int:
  ap = argparse.ArgumentParser(description='재고 시트 → Supabase inventory_entries 적재')
  ap.add_argument('--dry-run', action='store_true', help='실제 upsert 없이 파싱·검증만')
  args = ap.parse_args()

  path = _latest_excel()
  logger.info(f'엑셀 로드: {path}')
  wb = openpyxl.load_workbook(path, data_only=True)
  try:
    ws = wb[SHEET]
    errs = validate_headers(ws)
    if errs:
      logger.error(f'[{SHEET}] 헤더 불일치:\n' + '\n'.join(errs))
      return 2
    entries: list[dict[str, Any]] = []
    for r in range(DATA_START, ws.max_row + 1):
      e = row_to_entry(ws, r)
      if e is not None:
        entries.append(e)
    logger.info(f'[{SHEET}] {len(entries)}행 파싱 완료')
  finally:
    wb.close()

  summarize(entries)
  validate_total(entries)

  if args.dry_run:
    logger.success('dry-run 완료')
    return 0
  if not entries:
    logger.warning('적재할 행 없음')
    return 0

  with WriteSession() as w:
    for i in range(0, len(entries), BATCH_SIZE):
      chunk = entries[i:i + BATCH_SIZE]
      w.table(TABLE).upsert(chunk, on_conflict=CONFLICT).execute()
  logger.success(f'inventory_entries upsert 완료: {len(entries)}행')
  return 0


if __name__ == '__main__':
  sys.exit(main())
```

- [ ] **Step 4.6: dry-run 실행 (사용자 직접)**

```powershell
python scripts/sync_inventory.py --dry-run
```

Expected:

- 8개 (분류·항목·kind) 그룹 출력
- "검증 OK: 4분류합 == 전체재고" 또는 mismatch=0
- "dry-run 완료"

- [ ] **Step 4.7: 커밋**

```powershell
git add scripts/sync_inventory.py
git commit -m "feat(scripts): add sync_inventory.py (사외비 재고 시트 → DB)"
```

---

## Task 5: 데이터 적재 (사용자 직접 실행)

- [ ] **Step 5.1: 실제 upsert**

```powershell
python scripts/sync_inventory.py
```

Expected:

- summarize + validate_total 출력
- "inventory_entries upsert 완료: 336행" 부근
- WriteSession 종료 시 자동 `revalidateTag('inventory_entries')`

- [ ] **Step 5.2: DB 적재 검증 (Supabase Studio)**

Studio SQL Editor:

```sql
SELECT category, item, COUNT(*) as rows,
       MIN(period_year * 100 + period_month) as min_period,
       MAX(period_year * 100 + period_month) as max_period
FROM inventory_entries
GROUP BY category, item
ORDER BY category, item;
```

Expected: 8개 (category, item) 그룹. 2025.01 ~ 2026.12.

---

## Task 6: lib/inventory/types.ts

**Files:**

- Create: `lib/inventory/types.ts`

- [ ] **Step 6.1: 타입 정의 작성**

Create `lib/inventory/types.ts`:

```ts
/** 재고(/management/inventory) 도메인 타입. */

export type InventoryKind = 'plan' | 'actual';

/** inventory_entries 테이블 row */
export interface InventoryRow {
  category: string;
  item: string;
  kind: InventoryKind;
  period_year: number;
  period_month: number;
  unit: string | null;
  fx_rate: number | null;
  value: number | null;
}

/** 차트 1 (재고 현황) 월별 누적막대 + 회전율 포인트. 단위 = 억원. */
export interface StatusMonthPoint {
  /** 표시 라벨 ('2025.01', '2025.02', ...) */
  monthLabel: string;
  year: number;
  month: number;
  /** 4개 분류 (원화 환산 완료, 억원) */
  operating: number | null; // 운영
  management: number | null; // 관리
  compensation: number | null; // 보상
  transport: number | null; // 운송 (영업 + 미국환산 + 우즈벡환산)
  /** 합계 (data label용) */
  total: number | null;
  /** 회전율 (회) — 실적만 존재 */
  turnover: number | null;
}

/** 차트 2/3 (계획대비 실적) 월별 포인트. */
export interface AchievementMonthPoint {
  monthLabel: string;
  year: number;
  month: number;
  plan: number | null;
  actual: number | null;
  /** 달성율 % = actual/plan*100. plan 0/null이면 null */
  rate: number | null;
}

/** KPI 카드 데이터 (최신 실적 월 기준). */
export interface InventoryKpis {
  /** 최신 실적 월 라벨 (예: '2026.04') */
  latestLabel: string;
  /** 1. 전체 재고 (억원) + MoM % */
  totalEok: number | null;
  totalMomPct: number | null;
  /** 2. 회전율 (회) + 회전기간(일) */
  turnover: number | null;
  turnoverDays: number | null;
  /** 3. 최신 월 달성율 (실적/계획 × 100, %) — 전체 기준 */
  achievementPct: number | null;
  /** 4. 운송 비중 (운송/전체 × 100, %) */
  transportSharePct: number | null;
}

/** 차트 2 토글 옵션. */
export type AchievementCategory =
  | 'total'
  | 'operating'
  | 'management'
  | 'compensation'
  | 'transport';

/** 차트 3 토글 옵션. */
export type TransportItem = 'us' | 'uz' | 'sales';
```

- [ ] **Step 6.2: typecheck**

```powershell
npm run typecheck
```

Expected: 에러 없음.

- [ ] **Step 6.3: 커밋**

```powershell
git add lib/inventory/types.ts
git commit -m "feat(inventory): add inventory domain types"
```

---

## Task 7: lib/inventory/aggregate.ts — pure 함수 + TDD

**Files:**

- Create: `lib/inventory/aggregate.ts`
- Test: `lib/inventory/__tests__/aggregate.test.ts`

### Task 7.1: convertToKrwEok (USD 환산)

- [ ] **Step 7.1.1: 테스트 먼저 작성**

Create `lib/inventory/__tests__/aggregate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { convertToKrwEok } from '../aggregate';
import type { InventoryRow } from '../types';

function row(partial: Partial<InventoryRow>): InventoryRow {
  return {
    category: '운영',
    item: '운영 재고',
    kind: 'actual',
    period_year: 2025,
    period_month: 1,
    unit: '억원',
    fx_rate: 1400,
    value: 100,
    ...partial,
  };
}

describe('convertToKrwEok', () => {
  it('억원 단위는 그대로 반환', () => {
    expect(convertToKrwEok(row({ unit: '억원', value: 123.45 }))).toBe(123.45);
  });
  it('백만USD × fx_rate / 100 = 억원', () => {
    // 10 백만USD × 1400 원/USD = 14,000 백만원 = 140 억원
    expect(convertToKrwEok(row({ unit: '백만USD', value: 10, fx_rate: 1400 }))).toBe(140);
  });
  it('value null → null', () => {
    expect(convertToKrwEok(row({ value: null }))).toBeNull();
  });
  it('unit null (회전율) → null', () => {
    expect(convertToKrwEok(row({ unit: null, value: 4.1 }))).toBeNull();
  });
  it('fx_rate null + 백만USD → null (안전 fallback)', () => {
    expect(convertToKrwEok(row({ unit: '백만USD', fx_rate: null, value: 10 }))).toBeNull();
  });
});
```

- [ ] **Step 7.1.2: 테스트 실행 — fail 확인**

```powershell
npm test -- aggregate.test.ts
```

Expected: FAIL "Cannot find module '../aggregate'".

- [ ] **Step 7.1.3: aggregate.ts 최소 구현**

Create `lib/inventory/aggregate.ts`:

```ts
/** 재고(/management/inventory) 도메인 — pure 변환 함수. */
import type {
  InventoryRow,
  StatusMonthPoint,
  AchievementMonthPoint,
  InventoryKpis,
  AchievementCategory,
  TransportItem,
} from './types';

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * 단일 row를 원화(억원)로 환산.
 * - '억원' → 그대로
 * - '백만USD' → value × fx_rate / 100 (백만USD × 원/USD ÷ 100 = 억원)
 * - unit null (회전율) → null
 * - value null 또는 (백만USD 인데 fx_rate null) → null
 */
export function convertToKrwEok(row: InventoryRow): number | null {
  if (row.value === null) return null;
  if (row.unit === '억원') return round(row.value);
  if (row.unit === '백만USD') {
    if (row.fx_rate === null) return null;
    return round((row.value * row.fx_rate) / 100);
  }
  return null;
}
```

- [ ] **Step 7.1.4: 테스트 통과 확인**

```powershell
npm test -- aggregate.test.ts
```

Expected: PASS (5 passed).

### Task 7.2: buildStatusPoints (차트 1)

- [ ] **Step 7.2.1: 테스트 추가**

Append to `lib/inventory/__tests__/aggregate.test.ts`:

```ts
import { buildStatusPoints } from '../aggregate';

describe('buildStatusPoints', () => {
  it('실적 행만 모아 누적막대 + 회전율 데이터 생성', () => {
    const rows: InventoryRow[] = [
      row({
        category: '운영',
        item: '운영 재고',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        value: 100,
      }),
      row({
        category: '관리',
        item: '관리 재고',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        value: 50,
      }),
      row({
        category: '보상',
        item: '보상 재고',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        value: 30,
      }),
      row({
        category: '운송',
        item: '영업 재고',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        value: 20,
      }),
      row({
        category: '운송',
        item: '미국 운송',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        unit: '백만USD',
        value: 10,
        fx_rate: 1400,
      }),
      row({
        category: '전체',
        item: '회전율',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        unit: null,
        fx_rate: null,
        value: 4.1,
      }),
    ];
    const pts = buildStatusPoints(rows);
    expect(pts).toHaveLength(1);
    expect(pts[0].monthLabel).toBe('2025.01');
    expect(pts[0].operating).toBe(100);
    expect(pts[0].management).toBe(50);
    expect(pts[0].compensation).toBe(30);
    // 운송 = 20(영업) + 10×1400/100(미국) = 20 + 140 = 160
    expect(pts[0].transport).toBe(160);
    expect(pts[0].total).toBe(340);
    expect(pts[0].turnover).toBe(4.1);
  });

  it('계획 행은 무시 (차트 1은 실적만)', () => {
    const rows: InventoryRow[] = [
      row({
        category: '운영',
        item: '운영 재고',
        kind: 'plan',
        period_year: 2025,
        period_month: 1,
        value: 999,
      }),
    ];
    expect(buildStatusPoints(rows)).toHaveLength(0);
  });

  it('월 오름차순 정렬', () => {
    const rows: InventoryRow[] = [
      row({
        category: '운영',
        item: '운영 재고',
        kind: 'actual',
        period_year: 2026,
        period_month: 3,
        value: 1,
      }),
      row({
        category: '운영',
        item: '운영 재고',
        kind: 'actual',
        period_year: 2025,
        period_month: 12,
        value: 1,
      }),
      row({
        category: '운영',
        item: '운영 재고',
        kind: 'actual',
        period_year: 2026,
        period_month: 1,
        value: 1,
      }),
    ];
    const labels = buildStatusPoints(rows).map((p) => p.monthLabel);
    expect(labels).toEqual(['2025.12', '2026.01', '2026.03']);
  });
});
```

- [ ] **Step 7.2.2: 테스트 fail 확인**

```powershell
npm test -- aggregate.test.ts
```

Expected: FAIL "buildStatusPoints is not defined".

- [ ] **Step 7.2.3: buildStatusPoints 구현**

Append to `lib/inventory/aggregate.ts`:

```ts
function fmtMonth(year: number, month: number): string {
  return `${year}.${String(month).padStart(2, '0')}`;
}

/**
 * 차트 1 (재고 현황) 월별 포인트 빌더 — **실적만**.
 *
 * - operating: 운영 재고 (억원)
 * - management: 관리 재고 (억원)
 * - compensation: 보상 재고 (억원)
 * - transport: 영업 재고 + 미국 운송(환산) + 우즈벡 운송(환산) 합
 * - total: 4개 합 (data label)
 * - turnover: 전체 분류의 '회전율' 행
 *
 * 실적 행만 사용. (year, month) 키로 그룹핑 후 오름차순 정렬.
 */
export function buildStatusPoints(rows: readonly InventoryRow[]): StatusMonthPoint[] {
  const byKey = new Map<string, StatusMonthPoint>();
  for (const r of rows) {
    if (r.kind !== 'actual') continue;
    const key = `${r.period_year}-${r.period_month}`;
    let p = byKey.get(key);
    if (!p) {
      p = {
        monthLabel: fmtMonth(r.period_year, r.period_month),
        year: r.period_year,
        month: r.period_month,
        operating: null,
        management: null,
        compensation: null,
        transport: null,
        total: null,
        turnover: null,
      };
      byKey.set(key, p);
    }
    if (r.category === '운영' && r.item === '운영 재고') {
      p.operating = convertToKrwEok(r);
    } else if (r.category === '관리' && r.item === '관리 재고') {
      p.management = convertToKrwEok(r);
    } else if (r.category === '보상' && r.item === '보상 재고') {
      p.compensation = convertToKrwEok(r);
    } else if (r.category === '운송') {
      const v = convertToKrwEok(r);
      if (v !== null) p.transport = round((p.transport ?? 0) + v);
    } else if (r.category === '전체' && r.item === '회전율') {
      p.turnover = r.value === null ? null : round(r.value);
    }
  }
  // total 계산
  for (const p of byKey.values()) {
    const parts = [p.operating, p.management, p.compensation, p.transport];
    if (parts.every((v) => v === null)) {
      p.total = null;
    } else {
      p.total = round(parts.reduce<number>((s, v) => s + (v ?? 0), 0));
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.year - b.year || a.month - b.month);
}
```

- [ ] **Step 7.2.4: 테스트 통과 확인**

```powershell
npm test -- aggregate.test.ts
```

Expected: PASS (8 passed).

### Task 7.3: buildAchievementPoints (차트 2)

- [ ] **Step 7.3.1: 테스트 추가**

Append:

```ts
import { buildAchievementPoints } from '../aggregate';

describe('buildAchievementPoints', () => {
  it('total 카테고리: 전체-전체재고 행 사용', () => {
    const rows: InventoryRow[] = [
      row({
        category: '전체',
        item: '전체 재고',
        kind: 'plan',
        period_year: 2025,
        period_month: 1,
        value: 100,
      }),
      row({
        category: '전체',
        item: '전체 재고',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        value: 95,
      }),
    ];
    const pts = buildAchievementPoints(rows, 'total');
    expect(pts).toHaveLength(1);
    expect(pts[0].plan).toBe(100);
    expect(pts[0].actual).toBe(95);
    expect(pts[0].rate).toBe(95);
  });

  it('transport 카테고리: 영업 + 미국환산 + 우즈벡환산 합산', () => {
    const rows: InventoryRow[] = [
      row({
        category: '운송',
        item: '영업 재고',
        kind: 'plan',
        period_year: 2026,
        period_month: 3,
        value: 20,
      }),
      row({
        category: '운송',
        item: '미국 운송',
        kind: 'plan',
        period_year: 2026,
        period_month: 3,
        unit: '백만USD',
        value: 10,
        fx_rate: 1400,
      }),
      row({
        category: '운송',
        item: '우즈벡 운송',
        kind: 'plan',
        period_year: 2026,
        period_month: 3,
        unit: '백만USD',
        value: 5,
        fx_rate: 1400,
      }),
      row({
        category: '운송',
        item: '영업 재고',
        kind: 'actual',
        period_year: 2026,
        period_month: 3,
        value: 18,
      }),
      row({
        category: '운송',
        item: '미국 운송',
        kind: 'actual',
        period_year: 2026,
        period_month: 3,
        unit: '백만USD',
        value: 8,
        fx_rate: 1400,
      }),
    ];
    const pts = buildAchievementPoints(rows, 'transport');
    expect(pts).toHaveLength(1);
    // plan = 20 + 10*14 + 5*14 = 20 + 140 + 70 = 230
    expect(pts[0].plan).toBe(230);
    // actual = 18 + 8*14 = 18 + 112 = 130
    expect(pts[0].actual).toBe(130);
    expect(pts[0].rate).toBeCloseTo(56.52, 1);
  });

  it('plan만 있고 actual null → rate null', () => {
    const rows: InventoryRow[] = [
      row({
        category: '운영',
        item: '운영 재고',
        kind: 'plan',
        period_year: 2026,
        period_month: 12,
        value: 100,
      }),
    ];
    const pts = buildAchievementPoints(rows, 'operating');
    expect(pts).toHaveLength(1);
    expect(pts[0].plan).toBe(100);
    expect(pts[0].actual).toBeNull();
    expect(pts[0].rate).toBeNull();
  });
});
```

- [ ] **Step 7.3.2: 테스트 fail 확인**

```powershell
npm test -- aggregate.test.ts
```

Expected: FAIL.

- [ ] **Step 7.3.3: buildAchievementPoints 구현**

Append to `lib/inventory/aggregate.ts`:

```ts
const CATEGORY_FILTER: Record<AchievementCategory, (r: InventoryRow) => boolean> = {
  total: (r) => r.category === '전체' && r.item === '전체 재고',
  operating: (r) => r.category === '운영' && r.item === '운영 재고',
  management: (r) => r.category === '관리' && r.item === '관리 재고',
  compensation: (r) => r.category === '보상' && r.item === '보상 재고',
  // 운송: 3개 항목 모두 (영업 + 미국 + 우즈벡)
  transport: (r) =>
    r.category === '운송' &&
    (r.item === '영업 재고' || r.item === '미국 운송' || r.item === '우즈벡 운송'),
};

/**
 * 차트 2 (계획대비 실적) — 카테고리별 월별 포인트.
 *
 * 운송은 3개 항목 합산. 그 외는 단일 항목.
 * 단위는 모두 억원 (convertToKrwEok로 환산).
 * X축: plan이 존재하는 월 전체 (실적 없는 미래도 표시).
 */
export function buildAchievementPoints(
  rows: readonly InventoryRow[],
  category: AchievementCategory
): AchievementMonthPoint[] {
  const filter = CATEGORY_FILTER[category];
  const filtered = rows.filter(filter);
  const byKey = new Map<
    string,
    {
      plan: number;
      planHasVal: boolean;
      actual: number;
      actualHasVal: boolean;
      year: number;
      month: number;
    }
  >();
  for (const r of filtered) {
    const key = `${r.period_year}-${r.period_month}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = {
        plan: 0,
        planHasVal: false,
        actual: 0,
        actualHasVal: false,
        year: r.period_year,
        month: r.period_month,
      };
      byKey.set(key, agg);
    }
    const v = convertToKrwEok(r);
    if (v === null) continue;
    if (r.kind === 'plan') {
      agg.plan += v;
      agg.planHasVal = true;
    } else {
      agg.actual += v;
      agg.actualHasVal = true;
    }
  }
  const pts: AchievementMonthPoint[] = [];
  for (const [, agg] of byKey) {
    const plan = agg.planHasVal ? round(agg.plan) : null;
    const actual = agg.actualHasVal ? round(agg.actual) : null;
    const rate = plan && plan !== 0 && actual !== null ? round((actual / plan) * 100) : null;
    pts.push({
      monthLabel: fmtMonth(agg.year, agg.month),
      year: agg.year,
      month: agg.month,
      plan,
      actual,
      rate,
    });
  }
  return pts.sort((a, b) => a.year - b.year || a.month - b.month);
}
```

- [ ] **Step 7.3.4: 테스트 통과 확인**

```powershell
npm test -- aggregate.test.ts
```

Expected: PASS (11 passed).

### Task 7.4: buildTransportPoints (차트 3)

- [ ] **Step 7.4.1: 테스트 추가**

Append:

```ts
import { buildTransportPoints } from '../aggregate';

describe('buildTransportPoints', () => {
  it('us → 미국 운송 (환산)', () => {
    const rows: InventoryRow[] = [
      row({
        category: '운송',
        item: '미국 운송',
        kind: 'plan',
        period_year: 2025,
        period_month: 1,
        unit: '백만USD',
        value: 10,
        fx_rate: 1400,
      }),
      row({
        category: '운송',
        item: '미국 운송',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        unit: '백만USD',
        value: 9,
        fx_rate: 1400,
      }),
    ];
    const pts = buildTransportPoints(rows, 'us');
    expect(pts[0].plan).toBe(140);
    expect(pts[0].actual).toBe(126);
  });
  it('uz → 우즈벡 운송', () => {
    const rows: InventoryRow[] = [
      row({
        category: '운송',
        item: '우즈벡 운송',
        kind: 'plan',
        period_year: 2026,
        period_month: 4,
        unit: '백만USD',
        value: 5,
        fx_rate: 1400,
      }),
    ];
    const pts = buildTransportPoints(rows, 'uz');
    expect(pts).toHaveLength(1);
    expect(pts[0].plan).toBe(70);
  });
  it('sales → 영업 재고', () => {
    const rows: InventoryRow[] = [
      row({
        category: '운송',
        item: '영업 재고',
        kind: 'plan',
        period_year: 2025,
        period_month: 6,
        value: 50,
      }),
    ];
    const pts = buildTransportPoints(rows, 'sales');
    expect(pts[0].plan).toBe(50);
  });
});
```

- [ ] **Step 7.4.2: fail 확인**

```powershell
npm test -- aggregate.test.ts
```

Expected: FAIL.

- [ ] **Step 7.4.3: buildTransportPoints 구현**

Append to `lib/inventory/aggregate.ts`:

```ts
const TRANSPORT_ITEM_MAP: Record<TransportItem, string> = {
  us: '미국 운송',
  uz: '우즈벡 운송',
  sales: '영업 재고',
};

/**
 * 차트 3 (계획대비 운송) — 운송 분류 단일 항목 토글.
 *
 * us=미국 운송, uz=우즈벡 운송, sales=영업 재고.
 * 단위는 모두 억원 (convertToKrwEok).
 */
export function buildTransportPoints(
  rows: readonly InventoryRow[],
  item: TransportItem
): AchievementMonthPoint[] {
  const targetItem = TRANSPORT_ITEM_MAP[item];
  const filtered = rows.filter((r) => r.category === '운송' && r.item === targetItem);
  const byKey = new Map<
    string,
    {
      plan: number;
      planHasVal: boolean;
      actual: number;
      actualHasVal: boolean;
      year: number;
      month: number;
    }
  >();
  for (const r of filtered) {
    const key = `${r.period_year}-${r.period_month}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = {
        plan: 0,
        planHasVal: false,
        actual: 0,
        actualHasVal: false,
        year: r.period_year,
        month: r.period_month,
      };
      byKey.set(key, agg);
    }
    const v = convertToKrwEok(r);
    if (v === null) continue;
    if (r.kind === 'plan') {
      agg.plan += v;
      agg.planHasVal = true;
    } else {
      agg.actual += v;
      agg.actualHasVal = true;
    }
  }
  const pts: AchievementMonthPoint[] = [];
  for (const [, agg] of byKey) {
    const plan = agg.planHasVal ? round(agg.plan) : null;
    const actual = agg.actualHasVal ? round(agg.actual) : null;
    const rate = plan && plan !== 0 && actual !== null ? round((actual / plan) * 100) : null;
    pts.push({
      monthLabel: fmtMonth(agg.year, agg.month),
      year: agg.year,
      month: agg.month,
      plan,
      actual,
      rate,
    });
  }
  return pts.sort((a, b) => a.year - b.year || a.month - b.month);
}
```

- [ ] **Step 7.4.4: PASS 확인**

```powershell
npm test -- aggregate.test.ts
```

Expected: PASS (14 passed).

### Task 7.5: buildKpis

- [ ] **Step 7.5.1: 테스트 추가**

Append:

```ts
import { buildKpis } from '../aggregate';

describe('buildKpis', () => {
  it('최신 실적 월 기준 KPI 4종 계산', () => {
    const rows: InventoryRow[] = [
      // 2025.12 실적
      row({
        category: '전체',
        item: '전체 재고',
        kind: 'actual',
        period_year: 2025,
        period_month: 12,
        value: 1000,
      }),
      row({
        category: '운송',
        item: '영업 재고',
        kind: 'actual',
        period_year: 2025,
        period_month: 12,
        value: 100,
      }),
      row({
        category: '운송',
        item: '미국 운송',
        kind: 'actual',
        period_year: 2025,
        period_month: 12,
        unit: '백만USD',
        value: 10,
        fx_rate: 1400,
      }),
      row({
        category: '전체',
        item: '회전율',
        kind: 'actual',
        period_year: 2025,
        period_month: 12,
        unit: null,
        fx_rate: null,
        value: 4.0,
      }),
      // 2026.01 실적
      row({
        category: '전체',
        item: '전체 재고',
        kind: 'actual',
        period_year: 2026,
        period_month: 1,
        value: 1100,
      }),
      row({
        category: '운송',
        item: '영업 재고',
        kind: 'actual',
        period_year: 2026,
        period_month: 1,
        value: 110,
      }),
      row({
        category: '운송',
        item: '미국 운송',
        kind: 'actual',
        period_year: 2026,
        period_month: 1,
        unit: '백만USD',
        value: 12,
        fx_rate: 1400,
      }),
      row({
        category: '전체',
        item: '회전율',
        kind: 'actual',
        period_year: 2026,
        period_month: 1,
        unit: null,
        fx_rate: null,
        value: 5.0,
      }),
      // 2026.01 계획
      row({
        category: '전체',
        item: '전체 재고',
        kind: 'plan',
        period_year: 2026,
        period_month: 1,
        value: 1200,
      }),
    ];
    const kpis = buildKpis(rows);
    expect(kpis.latestLabel).toBe('2026.01');
    expect(kpis.totalEok).toBe(1100);
    // MoM = (1100 - 1000) / 1000 × 100 = 10%
    expect(kpis.totalMomPct).toBeCloseTo(10, 1);
    expect(kpis.turnover).toBe(5.0);
    // 회전기간 = 365 / 5 = 73 일
    expect(kpis.turnoverDays).toBe(73);
    // 달성율 = 1100 / 1200 × 100 = 91.67%
    expect(kpis.achievementPct).toBeCloseTo(91.67, 1);
    // 운송 = 110 + 12*14 = 110 + 168 = 278 / 1100 = 25.27%
    expect(kpis.transportSharePct).toBeCloseTo(25.27, 1);
  });

  it('실적 없으면 모두 null', () => {
    const rows: InventoryRow[] = [
      row({
        category: '전체',
        item: '전체 재고',
        kind: 'plan',
        period_year: 2026,
        period_month: 1,
        value: 100,
      }),
    ];
    const kpis = buildKpis(rows);
    expect(kpis.totalEok).toBeNull();
    expect(kpis.turnover).toBeNull();
    expect(kpis.achievementPct).toBeNull();
    expect(kpis.transportSharePct).toBeNull();
  });
});
```

- [ ] **Step 7.5.2: fail 확인**

```powershell
npm test -- aggregate.test.ts
```

- [ ] **Step 7.5.3: buildKpis 구현**

Append to `lib/inventory/aggregate.ts`:

```ts
/**
 * KPI 카드 — 최신 실적 월(전체 재고 actual 존재) 기준.
 *
 * - totalEok: 최신 월 전체 재고 (억원)
 * - totalMomPct: 전월 대비 변화율 (%)
 * - turnover: 회전율 (회)
 * - turnoverDays: 365 / 회전율 (일)
 * - achievementPct: 실적/계획 × 100 (전체 기준)
 * - transportSharePct: 운송/전체 × 100
 */
export function buildKpis(rows: readonly InventoryRow[]): InventoryKpis {
  // 1. 최신 실적 월 = max(year, month) where category='전체' & item='전체 재고' & kind='actual' & value not null
  const totalActuals = rows.filter(
    (r) =>
      r.category === '전체' && r.item === '전체 재고' && r.kind === 'actual' && r.value !== null
  );
  if (totalActuals.length === 0) {
    return {
      latestLabel: '—',
      totalEok: null,
      totalMomPct: null,
      turnover: null,
      turnoverDays: null,
      achievementPct: null,
      transportSharePct: null,
    };
  }
  totalActuals.sort((a, b) => b.period_year - a.period_year || b.period_month - a.period_month);
  const latest = totalActuals[0];
  const prev = totalActuals[1] ?? null;
  const latestLabel = fmtMonth(latest.period_year, latest.period_month);
  const totalEok = convertToKrwEok(latest);

  // 2. MoM
  const totalMomPct =
    totalEok !== null && prev !== null && prev.value !== null && prev.value !== 0
      ? round(((totalEok - (convertToKrwEok(prev) ?? 0)) / (convertToKrwEok(prev) ?? 1)) * 100)
      : null;

  // 3. 회전율
  const turnoverRow = rows.find(
    (r) =>
      r.category === '전체' &&
      r.item === '회전율' &&
      r.kind === 'actual' &&
      r.period_year === latest.period_year &&
      r.period_month === latest.period_month
  );
  const turnover = turnoverRow?.value ?? null;
  const turnoverDays = turnover && turnover !== 0 ? Math.round(365 / turnover) : null;

  // 4. 달성율 (최신 월 계획 row)
  const planRow = rows.find(
    (r) =>
      r.category === '전체' &&
      r.item === '전체 재고' &&
      r.kind === 'plan' &&
      r.period_year === latest.period_year &&
      r.period_month === latest.period_month
  );
  const planVal = planRow ? convertToKrwEok(planRow) : null;
  const achievementPct =
    totalEok !== null && planVal !== null && planVal !== 0
      ? round((totalEok / planVal) * 100)
      : null;

  // 5. 운송 비중 — 최신 월 운송 분류 actual 합산 / totalEok
  const transportRows = rows.filter(
    (r) =>
      r.category === '운송' &&
      r.kind === 'actual' &&
      r.period_year === latest.period_year &&
      r.period_month === latest.period_month
  );
  let transportSum = 0;
  let transportHas = false;
  for (const r of transportRows) {
    const v = convertToKrwEok(r);
    if (v !== null) {
      transportSum += v;
      transportHas = true;
    }
  }
  const transportSharePct =
    transportHas && totalEok !== null && totalEok !== 0
      ? round((transportSum / totalEok) * 100)
      : null;

  return {
    latestLabel,
    totalEok,
    totalMomPct,
    turnover,
    turnoverDays,
    achievementPct,
    transportSharePct,
  };
}
```

- [ ] **Step 7.5.4: PASS 확인**

```powershell
npm test -- aggregate.test.ts
```

Expected: PASS (16 passed).

- [ ] **Step 7.6: 커밋 (Task 7 전체)**

```powershell
git add lib/inventory/aggregate.ts lib/inventory/__tests__/aggregate.test.ts
git commit -m "feat(inventory): aggregate.ts pure builders (status/achievement/transport/kpi) with vitest"
```

---

## Task 8: lib/inventory/source.ts (server fetch + 'use cache')

**Files:**

- Create: `lib/inventory/source.ts`

- [ ] **Step 8.1: source.ts 작성**

Create `lib/inventory/source.ts`:

```ts
/**
 * 재고(/management/inventory) 도메인 데이터 입구 — fetch + 'use cache'.
 *
 * - inventory_entries: 사외비 → confidentialDb(service_role).
 * - 환산은 lib/inventory/aggregate.ts에서 수행 (DB는 원본 단위 보존).
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { confidentialDb } from '@/lib/supabase/confidential';
import type { InventoryRow } from './types';

async function fetchInventoryRows(): Promise<InventoryRow[]> {
  const { data, error } = await confidentialDb
    .from('inventory_entries')
    .select('*')
    .order('category', { ascending: true })
    .order('item', { ascending: true })
    .order('period_year', { ascending: true })
    .order('period_month', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'inventory_entries 조회 실패');
    throw new Error(`Supabase inventory_entries 조회 실패: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    ...r,
    kind: r.kind as InventoryRow['kind'],
  }));
}

export interface InventoryData {
  rows: InventoryRow[];
}

export async function getInventoryData(): Promise<InventoryData> {
  'use cache';
  cacheLife('hours');
  cacheTag('inventory_entries');

  const rows = await fetchInventoryRows();
  return { rows };
}
```

- [ ] **Step 8.2: typecheck**

```powershell
npm run typecheck
```

Expected: 에러 없음.

- [ ] **Step 8.3: 커밋**

```powershell
git add lib/inventory/source.ts
git commit -m "feat(inventory): source.ts ('use cache' + confidentialDb)"
```

---

## Task 9: InventoryKpiCards 컴포넌트

**Files:**

- Create: `components/management/inventory/InventoryKpiCards.tsx`

- [ ] **Step 9.1: KPI 카드 작성**

Create `components/management/inventory/InventoryKpiCards.tsx`:

```tsx
'use client';

import type { InventoryKpis } from '@/lib/inventory/types';

function fmt(n: number | null, digits = 0, suffix = ''): string {
  if (n === null || Number.isNaN(n)) return '—';
  return (
    n.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits }) +
    suffix
  );
}

function ArrowPct({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const up = value >= 0;
  return (
    <span className={up ? 'text-blue-600' : 'text-red-600'}>
      {up ? '▲' : '▼'} {fmt(Math.abs(value), 1, '%')}
    </span>
  );
}

function AchievementBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const good = value >= 100;
  return <span className={good ? 'text-emerald-600' : 'text-red-600'}>{fmt(value, 1, '%')}</span>;
}

interface Props {
  kpis: InventoryKpis;
}

export default function InventoryKpiCards({ kpis }: Props) {
  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <Card title="전체 재고" sub={`기준 ${kpis.latestLabel}`}>
        <div className="text-2xl font-semibold">{fmt(kpis.totalEok, 0, ' 억원')}</div>
        <div className="text-sm mt-1">
          전월비 <ArrowPct value={kpis.totalMomPct} />
        </div>
      </Card>
      <Card title="재고 회전율" sub={`기준 ${kpis.latestLabel}`}>
        <div className="text-2xl font-semibold">{fmt(kpis.turnover, 1, ' 회')}</div>
        <div className="text-sm text-muted-foreground mt-1">
          ≈ {kpis.turnoverDays === null ? '—' : `${kpis.turnoverDays}일치`}
        </div>
      </Card>
      <Card title="계획 달성율" sub={`기준 ${kpis.latestLabel}, 전체`}>
        <div className="text-2xl font-semibold">
          <AchievementBadge value={kpis.achievementPct} />
        </div>
        <div className="text-sm text-muted-foreground mt-1">실적 ÷ 계획 × 100</div>
      </Card>
      <Card title="운송 비중" sub={`기준 ${kpis.latestLabel}`}>
        <div className="text-2xl font-semibold">{fmt(kpis.transportSharePct, 1, '%')}</div>
        <div className="text-sm text-muted-foreground mt-1">운송 ÷ 전체 × 100</div>
      </Card>
    </section>
  );
}

function Card({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-sm font-medium text-muted-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 9.2: typecheck**

```powershell
npm run typecheck
```

- [ ] **Step 9.3: 커밋**

```powershell
git add components/management/inventory/InventoryKpiCards.tsx
git commit -m "feat(inventory): KPI cards (totalEok/turnover/achievement/transport-share)"
```

---

## Task 10: InventoryStatusChart (차트 1 — 콤보)

**Files:**

- Create: `components/management/inventory/InventoryStatusChart.tsx`

- [ ] **Step 10.1: 차트 1 작성**

Create `components/management/inventory/InventoryStatusChart.tsx`:

```tsx
'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartHeight } from '@/lib/useChartHeight';
import { ChartSection } from '@/components/management/plan/_selectors';
import { LegendRow } from '@/components/management/plan/PlanAchievementChart';
import type { StatusMonthPoint } from '@/lib/inventory/types';

function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

// 운영/관리/보상/운송 색상 (구분되는 4색)
const COLORS = {
  operating: '#2563eb', // blue-600
  management: '#16a34a', // green-600
  compensation: '#ea580c', // orange-600
  transport: '#7c3aed', // violet-600
  turnover: '#dc2626', // red-600
};

interface Props {
  points: StatusMonthPoint[];
}

/**
 * 차트 1 — 재고 현황 (실적만).
 *
 * - 누적막대: 운영 + 관리 + 보상 + 운송 (4개 층, 모두 억원)
 * - 합계 데이터 레이블: 막대 top 외곽
 * - 우축 꺾은선: 회전율 (회) + 표식
 */
export default function InventoryStatusChart({ points }: Props) {
  const h = useChartHeight(380, 460, 540);
  if (points.length === 0) {
    return (
      <ChartSection title="1. 재고 현황 (실적)" unit="억원 / 회">
        <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
      </ChartSection>
    );
  }
  const turnoverMax = Math.max(1, ...points.map((p) => p.turnover ?? 0));
  return (
    <ChartSection title="1. 재고 현황 (실적)" unit="억원 / 회">
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={points} margin={{ top: 32, right: 24, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis
            dataKey="monthLabel"
            tick={{ fontSize: 12 }}
            interval={0}
            angle={-30}
            textAnchor="end"
            height={56}
          />
          <YAxis
            yAxisId="amount"
            tickFormatter={(v: number) => fmt(v, 0)}
            tick={{ fontSize: 13 }}
            width={70}
            label={{
              value: '억원',
              position: 'top',
              offset: 16,
              style: { fontSize: 12, fill: 'var(--muted-foreground)' },
            }}
          />
          <YAxis
            yAxisId="turnover"
            orientation="right"
            tickFormatter={(v: number) => `${v.toFixed(1)}회`}
            tick={{ fontSize: 13 }}
            width={56}
            domain={[0, turnoverMax * 1.3]}
            label={{
              value: '회전율',
              position: 'top',
              offset: 16,
              style: { fontSize: 12, fill: 'var(--muted-foreground)' },
            }}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              fontSize: '14px',
            }}
            content={<StatusTooltip />}
          />
          <Legend
            verticalAlign="top"
            wrapperStyle={{ paddingBottom: 4 }}
            content={() => (
              <LegendRow
                items={[
                  { key: 'operating', label: '운영', shape: 'rect', color: COLORS.operating },
                  { key: 'management', label: '관리', shape: 'rect', color: COLORS.management },
                  { key: 'compensation', label: '보상', shape: 'rect', color: COLORS.compensation },
                  { key: 'transport', label: '운송', shape: 'rect', color: COLORS.transport },
                  { key: 'turnover', label: '회전율', shape: 'line', color: COLORS.turnover },
                ]}
              />
            )}
          />
          <Bar
            yAxisId="amount"
            dataKey="operating"
            name="운영"
            stackId="inv"
            fill={COLORS.operating}
          />
          <Bar
            yAxisId="amount"
            dataKey="management"
            name="관리"
            stackId="inv"
            fill={COLORS.management}
          />
          <Bar
            yAxisId="amount"
            dataKey="compensation"
            name="보상"
            stackId="inv"
            fill={COLORS.compensation}
          />
          <Bar
            yAxisId="amount"
            dataKey="transport"
            name="운송"
            stackId="inv"
            fill={COLORS.transport}
          >
            <LabelList
              dataKey="total"
              position="top"
              formatter={(v: unknown) => (typeof v === 'number' ? fmt(v, 0) : '')}
              style={{ fontSize: 12, fill: 'var(--foreground)', fontWeight: 600 }}
            />
          </Bar>
          <Line
            yAxisId="turnover"
            type="monotone"
            dataKey="turnover"
            name="회전율"
            stroke={COLORS.turnover}
            strokeWidth={2.5}
            dot={{ r: 4, fill: COLORS.turnover }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartSection>
  );
}

function StatusTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: StatusMonthPoint }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div
      className="rounded-md p-2 text-sm"
      style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="font-semibold mb-1">{label}</div>
      <div>운영: {fmt(p.operating, 0)} 억원</div>
      <div>관리: {fmt(p.management, 0)} 억원</div>
      <div>보상: {fmt(p.compensation, 0)} 억원</div>
      <div>운송: {fmt(p.transport, 0)} 억원</div>
      <div className="font-semibold pt-1 mt-1 border-t border-border">
        합계: {fmt(p.total, 0)} 억원
      </div>
      <div className="text-red-600">회전율: {fmt(p.turnover, 1)} 회</div>
    </div>
  );
}
```

- [ ] **Step 10.2: typecheck**

```powershell
npm run typecheck
```

- [ ] **Step 10.3: 커밋**

```powershell
git add components/management/inventory/InventoryStatusChart.tsx
git commit -m "feat(inventory): chart 1 (status combo — stacked bar + turnover line)"
```

---

## Task 11: InventoryAchievementChart (차트 2/3 공통)

**Files:**

- Create: `components/management/inventory/InventoryAchievementChart.tsx`

- [ ] **Step 11.1: 차트 2/3 공통 컴포넌트 작성**

Create `components/management/inventory/InventoryAchievementChart.tsx`:

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
import { LegendRow } from '@/components/management/plan/PlanAchievementChart';
import type { AchievementMonthPoint } from '@/lib/inventory/types';

function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const BASE = OEM_COLORS[0];
const PLAN_COLOR = hexToRgba(BASE, 0.4);
const RATE_COLOR = '#dc2626';

interface Props {
  points: AchievementMonthPoint[];
  unitLabel?: string;
}

/**
 * 차트 2/3 공통 — 월별 계획 vs 실적 + 달성율 콤보.
 *
 * - X축: 월 (24 포인트), 회전 라벨 (-30°).
 * - 좌축: 금액 (억원). 데이터 레이블 없음 (호버 툴팁만).
 * - 우축: 달성율 %.
 * - 범례 클릭으로 시리즈 토글.
 */
export default function InventoryAchievementChart({ points, unitLabel = '억원' }: Props) {
  const h = useChartHeight(360, 440, 520);
  if (points.length === 0) {
    return (
      <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
    );
  }
  const rateMax = Math.max(100, ...points.map((p) => (p.rate === null ? 0 : Math.abs(p.rate))));
  return (
    <ResponsiveContainer width="100%" height={h}>
      <ComposedChart data={points} margin={{ top: 32, right: 24, bottom: 10, left: 10 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
        <XAxis
          dataKey="monthLabel"
          tick={{ fontSize: 12 }}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={56}
        />
        <YAxis
          yAxisId="amount"
          tickFormatter={(v: number) => fmt(v, 0)}
          tick={{ fontSize: 13 }}
          width={70}
          domain={[0, (max: number) => Math.max(max * 1.2, 1)]}
        />
        <YAxis
          yAxisId="rate"
          orientation="right"
          tickFormatter={(v: number) => `${Math.round(v)}%`}
          tick={{ fontSize: 13 }}
          width={56}
          domain={[0, Math.max(rateMax * 1.2, 110)]}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            fontSize: '14px',
          }}
          content={<Tip unitLabel={unitLabel} />}
        />
        <Legend
          verticalAlign="top"
          wrapperStyle={{ paddingBottom: 4 }}
          content={() => (
            <LegendRow
              items={[
                { key: 'plan', label: '계획', shape: 'rect', color: PLAN_COLOR },
                { key: 'actual', label: '실적', shape: 'rect', color: BASE },
                { key: 'rate', label: '달성율', shape: 'line', color: RATE_COLOR },
              ]}
            />
          )}
        />
        <Bar yAxisId="amount" dataKey="plan" name="계획" fill={PLAN_COLOR} radius={[2, 2, 0, 0]} />
        <Bar yAxisId="amount" dataKey="actual" name="실적" fill={BASE} radius={[2, 2, 0, 0]} />
        <Line
          yAxisId="rate"
          type="monotone"
          dataKey="rate"
          name="달성율"
          stroke={RATE_COLOR}
          strokeWidth={2.5}
          dot={{ r: 4, fill: RATE_COLOR }}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function Tip({
  active,
  payload,
  label,
  unitLabel,
}: {
  active?: boolean;
  payload?: Array<{ payload: AchievementMonthPoint }>;
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
        계획: {fmt(p.plan, 0)} {unitLabel}
      </div>
      <div>
        실적: {fmt(p.actual, 0)} {unitLabel}
      </div>
      <div className={p.rate !== null && p.rate < 100 ? 'text-red-500' : 'text-emerald-600'}>
        달성율: {p.rate === null ? '—' : `${fmt(p.rate, 1)}%`}
      </div>
    </div>
  );
}
```

- [ ] **Step 11.2: typecheck**

```powershell
npm run typecheck
```

- [ ] **Step 11.3: 커밋**

```powershell
git add components/management/inventory/InventoryAchievementChart.tsx
git commit -m "feat(inventory): achievement chart 2/3 shared component (monthly X-axis)"
```

---

## Task 12: InventoryDashboard 조립

**Files:**

- Create: `components/management/inventory/InventoryDashboard.tsx`

- [ ] **Step 12.1: Dashboard 작성**

Create `components/management/inventory/InventoryDashboard.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import LazyMount from '@/components/common/LazyMount';
import { ChartSection, ToggleGroup } from '@/components/management/plan/_selectors';
import InventoryKpiCards from './InventoryKpiCards';
import {
  buildAchievementPoints,
  buildKpis,
  buildStatusPoints,
  buildTransportPoints,
} from '@/lib/inventory/aggregate';
import type { AchievementCategory, InventoryRow, TransportItem } from '@/lib/inventory/types';

const InventoryStatusChart = dynamic(() => import('./InventoryStatusChart'), { ssr: false });
const InventoryAchievementChart = dynamic(() => import('./InventoryAchievementChart'), {
  ssr: false,
});

interface Props {
  rows: InventoryRow[];
}

const ACH_OPTIONS: { value: AchievementCategory; label: string }[] = [
  { value: 'total', label: '전체' },
  { value: 'operating', label: '운영' },
  { value: 'management', label: '관리' },
  { value: 'compensation', label: '보상' },
  { value: 'transport', label: '운송' },
];

const TRANSPORT_OPTIONS: { value: TransportItem; label: string }[] = [
  { value: 'us', label: '미국' },
  { value: 'uz', label: '우즈벡' },
  { value: 'sales', label: '영업재고' },
];

export default function InventoryDashboard({ rows }: Props) {
  const [achCat, setAchCat] = useState<AchievementCategory>('total');
  const [tranItem, setTranItem] = useState<TransportItem>('us');

  const kpis = useMemo(() => buildKpis(rows), [rows]);
  const statusPts = useMemo(() => buildStatusPoints(rows), [rows]);
  const achPts = useMemo(() => buildAchievementPoints(rows, achCat), [rows, achCat]);
  const tranPts = useMemo(() => buildTransportPoints(rows, tranItem), [rows, tranItem]);

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-4 space-y-4">
      <InventoryKpiCards kpis={kpis} />

      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <InventoryStatusChart points={statusPts} />
      </LazyMount>

      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <ChartSection
          title="2. 계획 대비 실적"
          unit="억원"
          controls={<ToggleGroup options={ACH_OPTIONS} value={achCat} onChange={setAchCat} />}
        >
          <InventoryAchievementChart points={achPts} unitLabel="억원" />
        </ChartSection>
      </LazyMount>

      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <ChartSection
          title="3. 계획 대비 운송"
          unit="억원"
          controls={
            <ToggleGroup options={TRANSPORT_OPTIONS} value={tranItem} onChange={setTranItem} />
          }
        >
          <InventoryAchievementChart points={tranPts} unitLabel="억원" />
        </ChartSection>
      </LazyMount>
    </div>
  );
}
```

- [ ] **Step 12.2: typecheck**

```powershell
npm run typecheck
```

- [ ] **Step 12.3: 커밋**

```powershell
git add components/management/inventory/InventoryDashboard.tsx
git commit -m "feat(inventory): dashboard assembly (KPI + 3 charts with toggles)"
```

---

## Task 13: page.tsx 교체

**Files:**

- Modify: `app/management/inventory/page.tsx` (전체 교체)

- [ ] **Step 13.1: 기존 placeholder → 실제 dashboard**

Replace `app/management/inventory/page.tsx`:

```tsx
import InventoryDashboard from '@/components/management/inventory/InventoryDashboard';
import { getInventoryData } from '@/lib/inventory/source';

/** 재고 페이지 (server) — inventory_entries fetch 후 클라이언트에 전달. */
export default async function InventoryPage() {
  const { rows } = await getInventoryData();
  return <InventoryDashboard rows={rows} />;
}
```

- [ ] **Step 13.2: typecheck**

```powershell
npm run typecheck
```

- [ ] **Step 13.3: 커밋**

```powershell
git add app/management/inventory/page.tsx
git commit -m "feat(inventory): mount dashboard on /management/inventory"
```

---

## Task 14: 전체 검증 + UI 직접 확인

- [ ] **Step 14.1: 통합 검사**

```powershell
npm run check-all
```

Expected: lint + format + typecheck + vitest 모두 PASS. 실패 시 해당 step에서 원인 fix 후 재실행.

- [ ] **Step 14.2: 단위 테스트 회귀 확인**

```powershell
npm test
```

Expected: aggregate.test.ts 16건 PASS + 기존 테스트 PASS.

- [ ] **Step 14.3: dev 서버 실행 + 골든 패스 확인**

```powershell
npm run dev
```

브라우저 → `http://localhost:3000/login` → 로그인 → `/management/inventory` 진입.

확인 항목:

1. KPI 카드 4개 표시 (전체 재고 / 회전율 / 달성율 / 운송 비중)
2. 차트 1 — 누적막대 4색(운영·관리·보상·운송) + 합계 데이터 레이블 + 회전율 빨간 꺾은선
3. 차트 2 — 토글 [전체|운영|관리|보상|운송] 클릭 시 데이터 교체
4. 차트 3 — 토글 [미국|우즈벡|영업재고] 클릭 시 데이터 교체
5. 모바일 viewport (375px) reflow — KPI 1열, 차트 height 축소
6. 콘솔 에러 없음 (NetworkPanel 401/500 없음)

문제 발견 시 해당 컴포넌트 task로 돌아가 fix → 재실행.

- [ ] **Step 14.4: AGENTS.md 갱신**

Edit `AGENTS.md`:

- "관리 라우트 책임 표"에서 `/management`의 `pnl`/`plan`/`inventory`/`production`/`companies` 설명 줄 수정 — `inventory` 항목에 새 차트 4개 요약 한 줄 추가.
- "사외비 테이블 격리" 섹션의 테이블 명단에 `inventory_entries` 추가.
- "데이터·DB 규칙" 끝에 "재고 USD 환산" 한 줄 (단위 통일, fx_rate DB 보존).

- [ ] **Step 14.5: 최종 커밋**

```powershell
git add AGENTS.md
git commit -m "docs(agents): inventory page + inventory_entries 사외비 테이블 명단"
```

---

## 작업 후 셀프 체크리스트

- [ ] `npm run check-all` 통과
- [ ] `/management/inventory` 브라우저 직접 확인 (KPI + 차트 3개 + 토글 동작)
- [ ] DB `inventory_entries` 336행 적재 확인
- [ ] sync_inventory.py dry-run 검증 OK 출력
- [ ] 사외비 정책 — 금액 stdout/log 비노출 (summarize·validate_total)
- [ ] 모든 차트가 `LazyMount + dynamic`로 lazy load
- [ ] AGENTS.md 라우트 표 + 사외비 명단 갱신 (pre-commit hook 통과)
