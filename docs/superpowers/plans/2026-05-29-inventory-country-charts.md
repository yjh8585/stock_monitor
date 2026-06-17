# 재고 페이지 국가 분류 차트 추가 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/management/inventory`에 국가 분류(국내/미국/우즈벡) 데이터를 더해 차트를 3종 → 6종으로 확장한다.

**Architecture:** 데이터는 이미 엑셀 '재고' 시트에 존재하고 제네릭 sync가 자동 적재한다(파싱 변경 없음). pure 집계 빌더 3종을 TDD로 추가하고, 국가 현황 차트 1종을 신규 컴포넌트로, 나머지 신규 차트 2종은 기존 `InventoryAchievementChart`를 재사용한다. 차트 2엔 "영업+국내보상(=전체−국가합)" 차액층을 기본 숨김으로 둔다.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Recharts / Vitest. 사외비 테이블 `inventory_entries`(confidentialDb 경유).

> **커밋 정책:** 사용자 지시에 따라 **커밋은 사용자 승인 시에만**. 각 Task의 commit 스텝은 `git add`까지 수행하고, 실제 `git commit`은 check-all 통과 후 사용자에게 확인받아 일괄 진행한다.

---

## File Structure

| 파일                                                              | 책임                   | 변경                     |
| ----------------------------------------------------------------- | ---------------------- | ------------------------ |
| `lib/inventory/types.ts`                                          | 도메인 타입            | 타입 3개 추가            |
| `lib/inventory/aggregate.ts`                                      | pure 변환 함수         | 빌더 3개 + 매핑 2개 추가 |
| `lib/inventory/__tests__/aggregate.test.ts`                       | 단위 테스트            | describe 3개 추가        |
| `components/management/inventory/InventoryCountryStatusChart.tsx` | 차트 2 (국가 현황)     | **신규**                 |
| `components/management/inventory/InventoryStatusChart.tsx`        | 차트 1 (종류 현황)     | 제목 문자열만            |
| `components/management/inventory/InventoryDashboard.tsx`          | 6차트 배치 + 토글 상태 | 전면 재작성              |
| `components/management/inventory/InventoryAchievementChart.tsx`   | 차트 3·4·5·6 공통      | **변경 없음**(재사용)    |
| `scripts/sync_inventory.py`                                       | 엑셀 → DB 적재         | **변경 없음**            |
| `AGENTS.md`                                                       | 작업 지침              | inventory 설명 갱신      |

---

## Task 1: 도메인 타입 추가

**Files:**

- Modify: `lib/inventory/types.ts`

- [ ] **Step 1: 타입 3개 추가**

`lib/inventory/types.ts` 끝(파일 마지막 `TransportItem` 정의 뒤)에 추가:

```ts
/** 차트 2 (재고 현황 국가) 월별 누적막대. 단위 = 억원. 회전율 없음. */
export interface CountryStatusPoint {
  monthLabel: string;
  year: number;
  month: number;
  /** 국내 = 구동 + 제동조향 + 전장 (억원) */
  domestic: number | null;
  /** 미국 (백만USD → 환산) */
  us: number | null;
  /** 우즈벡 (백만USD → 환산) */
  uz: number | null;
  /** 영업+국내보상 = total − (domestic+us+uz). 기본 숨김 시리즈. 음수면 0. */
  residual: number | null;
  /** 전체재고 actual (residual 계산·툴팁용) */
  total: number | null;
}

/** 차트 4 (계획대비 실적 국내) 토글 옵션. */
export type DomesticItem = 'drive' | 'brake' | 'electronics';

/** 차트 5 (계획대비 실적 해외) 토글 옵션. 운송용 TransportItem과 별개(국가값). */
export type OverseasItem = 'us' | 'uz';
```

- [ ] **Step 2: 타입체크**

Run: `npm run typecheck`
Expected: PASS (신규 타입은 아직 미사용이라 에러 없음)

- [ ] **Step 3: 스테이징**

```bash
git add lib/inventory/types.ts
```

---

## Task 2: `buildCountryStatusPoints` (TDD)

**Files:**

- Test: `lib/inventory/__tests__/aggregate.test.ts`
- Modify: `lib/inventory/aggregate.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/inventory/__tests__/aggregate.test.ts` 상단 import에 `buildCountryStatusPoints` 추가:

```ts
import {
  convertToKrwEok,
  buildStatusPoints,
  buildCountryStatusPoints,
  buildAchievementPoints,
  buildDomesticAchievementPoints,
  buildOverseasAchievementPoints,
  buildTransportPoints,
  buildKpis,
} from '../aggregate';
```

> (Task 3에서 추가할 `buildDomesticAchievementPoints`·`buildOverseasAchievementPoints`도 미리 import — 한 번에 정리)

파일 끝에 describe 블록 추가:

```ts
describe('buildCountryStatusPoints', () => {
  it('국가별 누적 + residual = 전체 − 국가합', () => {
    const rows: InventoryRow[] = [
      row({
        category: '국내',
        item: '구동',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        value: 30,
      }),
      row({
        category: '국내',
        item: '제동조향',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        value: 20,
      }),
      row({
        category: '국내',
        item: '전장',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        value: 10,
      }),
      row({
        category: '미국',
        item: '미국',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        unit: '백만USD',
        value: 10,
        fx_rate: 1400,
      }),
      row({
        category: '전체',
        item: '전체 재고',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        value: 250,
      }),
    ];
    const pts = buildCountryStatusPoints(rows);
    expect(pts).toHaveLength(1);
    expect(pts[0].domestic).toBe(60);
    expect(pts[0].us).toBe(140);
    expect(pts[0].uz).toBeNull();
    expect(pts[0].total).toBe(250);
    expect(pts[0].residual).toBe(50); // 250 − (60+140+0)
  });

  it('계획 행 무시 (차트 2는 실적만)', () => {
    const rows: InventoryRow[] = [
      row({
        category: '국내',
        item: '구동',
        kind: 'plan',
        period_year: 2025,
        period_month: 1,
        value: 999,
      }),
    ];
    expect(buildCountryStatusPoints(rows)).toHaveLength(0);
  });

  it('전체재고 null → residual null', () => {
    const rows: InventoryRow[] = [
      row({
        category: '국내',
        item: '구동',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        value: 30,
      }),
    ];
    const pts = buildCountryStatusPoints(rows);
    expect(pts[0].total).toBeNull();
    expect(pts[0].residual).toBeNull();
  });

  it('residual 음수 방어 → 0', () => {
    const rows: InventoryRow[] = [
      row({
        category: '국내',
        item: '구동',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        value: 300,
      }),
      row({
        category: '전체',
        item: '전체 재고',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        value: 250,
      }),
    ];
    expect(buildCountryStatusPoints(rows)[0].residual).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- aggregate`
Expected: FAIL — `buildCountryStatusPoints`, `buildDomesticAchievementPoints`, `buildOverseasAchievementPoints` is not exported / not a function

- [ ] **Step 3: 최소 구현**

`lib/inventory/aggregate.ts` import에 `CountryStatusPoint` 추가:

```ts
import type {
  InventoryRow,
  StatusMonthPoint,
  CountryStatusPoint,
  AchievementMonthPoint,
  InventoryKpis,
  AchievementCategory,
  DomesticItem,
  OverseasItem,
  TransportItem,
} from './types';
```

`buildStatusPoints` 함수 정의 바로 뒤에 추가:

```ts
/**
 * 차트 2 (재고 현황 국가) 월별 포인트 빌더 — 실적만.
 *
 * - domestic: 국내 3개 항목(구동+제동조향+전장) 합 (억원)
 * - us/uz: 미국/우즈벡 단일 항목 (백만USD → 환산)
 * - total: 전체/전체 재고 actual
 * - residual: total − (domestic+us+uz). "영업+국내보상". 음수면 0, total null이면 null.
 */
export function buildCountryStatusPoints(rows: readonly InventoryRow[]): CountryStatusPoint[] {
  const byKey = new Map<string, CountryStatusPoint>();
  for (const r of rows) {
    if (r.kind !== 'actual') continue;
    const key = `${r.period_year}-${r.period_month}`;
    let p = byKey.get(key);
    if (!p) {
      p = {
        monthLabel: fmtMonth(r.period_year, r.period_month),
        year: r.period_year,
        month: r.period_month,
        domestic: null,
        us: null,
        uz: null,
        residual: null,
        total: null,
      };
      byKey.set(key, p);
    }
    if (r.category === '국내') {
      const v = convertToKrwEok(r);
      if (v !== null) p.domestic = round((p.domestic ?? 0) + v);
    } else if (r.category === '미국' && r.item === '미국') {
      p.us = convertToKrwEok(r);
    } else if (r.category === '우즈벡' && r.item === '우즈벡') {
      p.uz = convertToKrwEok(r);
    } else if (r.category === '전체' && r.item === '전체 재고') {
      p.total = convertToKrwEok(r);
    }
  }
  for (const p of byKey.values()) {
    if (p.total === null) {
      p.residual = null;
    } else {
      const sum = (p.domestic ?? 0) + (p.us ?? 0) + (p.uz ?? 0);
      const res = round(p.total - sum);
      p.residual = res < 0 ? 0 : res;
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.year - b.year || a.month - b.month);
}
```

> 이 단계에서 `DomesticItem`·`OverseasItem` import는 추가했지만 Task 3에서 사용. 미사용 import 경고가 lint에서 날 수 있으니 Task 3을 곧바로 이어서 진행한다(같은 커밋 단위).

- [ ] **Step 4: 테스트 통과 확인 (이 빌더만)**

Run: `npm test -- aggregate`
Expected: `buildCountryStatusPoints` 4 케이스 PASS. (Task 3 빌더 미구현이라 그 describe는 여전히 FAIL — 정상)

---

## Task 3: `buildDomesticAchievementPoints` + `buildOverseasAchievementPoints` (TDD)

**Files:**

- Test: `lib/inventory/__tests__/aggregate.test.ts`
- Modify: `lib/inventory/aggregate.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`aggregate.test.ts` 끝에 describe 2개 추가(import는 Task 2에서 이미 추가됨):

```ts
describe('buildDomesticAchievementPoints', () => {
  it('drive → 국내/구동, 다른 항목 무시', () => {
    const rows: InventoryRow[] = [
      row({
        category: '국내',
        item: '구동',
        kind: 'plan',
        period_year: 2025,
        period_month: 1,
        value: 30,
      }),
      row({
        category: '국내',
        item: '구동',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        value: 27,
      }),
      row({
        category: '국내',
        item: '전장',
        kind: 'plan',
        period_year: 2025,
        period_month: 1,
        value: 99,
      }),
    ];
    const pts = buildDomesticAchievementPoints(rows, 'drive');
    expect(pts).toHaveLength(1);
    expect(pts[0].plan).toBe(30);
    expect(pts[0].actual).toBe(27);
    expect(pts[0].rate).toBe(90);
  });

  it('brake → 제동조향, electronics → 전장', () => {
    const rows: InventoryRow[] = [
      row({
        category: '국내',
        item: '제동조향',
        kind: 'plan',
        period_year: 2026,
        period_month: 2,
        value: 20,
      }),
      row({
        category: '국내',
        item: '전장',
        kind: 'plan',
        period_year: 2026,
        period_month: 2,
        value: 10,
      }),
    ];
    expect(buildDomesticAchievementPoints(rows, 'brake')[0].plan).toBe(20);
    expect(buildDomesticAchievementPoints(rows, 'electronics')[0].plan).toBe(10);
  });
});

describe('buildOverseasAchievementPoints', () => {
  it('us → 미국/미국 (백만USD 환산)', () => {
    const rows: InventoryRow[] = [
      row({
        category: '미국',
        item: '미국',
        kind: 'plan',
        period_year: 2025,
        period_month: 1,
        unit: '백만USD',
        value: 10,
        fx_rate: 1400,
      }),
      row({
        category: '미국',
        item: '미국',
        kind: 'actual',
        period_year: 2025,
        period_month: 1,
        unit: '백만USD',
        value: 9,
        fx_rate: 1400,
      }),
    ];
    const pts = buildOverseasAchievementPoints(rows, 'us');
    expect(pts[0].plan).toBe(140);
    expect(pts[0].actual).toBe(126);
  });

  it('uz → 우즈벡/우즈벡', () => {
    const rows: InventoryRow[] = [
      row({
        category: '우즈벡',
        item: '우즈벡',
        kind: 'plan',
        period_year: 2026,
        period_month: 4,
        unit: '백만USD',
        value: 5,
        fx_rate: 1400,
      }),
    ];
    const pts = buildOverseasAchievementPoints(rows, 'uz');
    expect(pts).toHaveLength(1);
    expect(pts[0].plan).toBe(70);
  });

  it('미국 토글은 운송/미국 운송과 무관 (국가값만)', () => {
    const rows: InventoryRow[] = [
      row({
        category: '미국',
        item: '미국',
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
        kind: 'plan',
        period_year: 2025,
        period_month: 1,
        unit: '백만USD',
        value: 99,
        fx_rate: 1400,
      }),
    ];
    expect(buildOverseasAchievementPoints(rows, 'us')[0].plan).toBe(140);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- aggregate`
Expected: FAIL — `buildDomesticAchievementPoints` / `buildOverseasAchievementPoints` is not a function

- [ ] **Step 3: 최소 구현**

`lib/inventory/aggregate.ts`의 `buildTransportPoints` 함수 정의 **앞**(또는 뒤)에 추가:

```ts
const DOMESTIC_ITEM_MAP: Record<DomesticItem, string> = {
  drive: '구동',
  brake: '제동조향',
  electronics: '전장',
};

/**
 * 차트 4 (계획대비 실적 국내) — 국내 분류 단일 항목 토글.
 */
export function buildDomesticAchievementPoints(
  rows: readonly InventoryRow[],
  item: DomesticItem
): AchievementMonthPoint[] {
  const targetItem = DOMESTIC_ITEM_MAP[item];
  return aggregateAchievement(rows.filter((r) => r.category === '국내' && r.item === targetItem));
}

const OVERSEAS_MAP: Record<OverseasItem, { category: string; item: string }> = {
  us: { category: '미국', item: '미국' },
  uz: { category: '우즈벡', item: '우즈벡' },
};

/**
 * 차트 5 (계획대비 실적 해외) — 미국/우즈벡 국가값 토글. 운송 항목과 별개.
 */
export function buildOverseasAchievementPoints(
  rows: readonly InventoryRow[],
  item: OverseasItem
): AchievementMonthPoint[] {
  const t = OVERSEAS_MAP[item];
  return aggregateAchievement(rows.filter((r) => r.category === t.category && r.item === t.item));
}
```

- [ ] **Step 4: 전체 테스트 통과 확인**

Run: `npm test -- aggregate`
Expected: PASS — 기존 16 + 신규 약 9 = 전부 통과

- [ ] **Step 5: lint + 스테이징**

Run: `npm run lint`
Expected: PASS (미사용 import 없음)

```bash
git add lib/inventory/aggregate.ts lib/inventory/__tests__/aggregate.test.ts
```

---

## Task 4: 신규 컴포넌트 `InventoryCountryStatusChart.tsx`

**Files:**

- Create: `components/management/inventory/InventoryCountryStatusChart.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`components/management/inventory/InventoryCountryStatusChart.tsx` 신규 생성:

```tsx
'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartHeight } from '@/lib/useChartHeight';
import { ChartSection } from '@/components/management/plan/_selectors';
import { LegendRow } from '@/components/management/plan/PlanAchievementChart';
import { sumVisibleStack, TOTAL_LABEL_ANCHOR } from '@/components/management/chart-utils';
import type { CountryStatusPoint } from '@/lib/inventory/types';

function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function pctOf(part: number | null | undefined, total: number | null | undefined): string {
  if (part === null || part === undefined || total === null || total === undefined || total === 0)
    return '—';
  return `${((part / total) * 100).toFixed(1)}%`;
}

const COLORS = {
  domestic: '#2563eb',
  us: '#16a34a',
  uz: '#ea580c',
  residual: '#94a3b8',
};

const STACK_KEYS = ['domestic', 'us', 'uz', 'residual'] as const;

interface Props {
  points: CountryStatusPoint[];
}

/**
 * 차트 2 — 재고 현황 (국가, 실적만).
 * - 누적막대 4개 층 (국내/미국/우즈벡 + 영업+국내보상)
 * - "영업+국내보상" = 전체재고 − 국가합. 기본 숨김 → 켜면 총액이 차트 1(전체재고)과 일치.
 * - 회전율 없음. 범례 클릭으로 시리즈 토글. 호버 툴팁에 분류별 비중(%).
 */
export default function InventoryCountryStatusChart({ points }: Props) {
  const h = useChartHeight(380, 460, 540);
  // 영업+국내보상(residual)은 기본 숨김 상태로 시작.
  const [hidden, setHidden] = useState<Set<string>>(new Set(['residual']));
  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const chartData = useMemo(
    () =>
      points.map((p) => ({
        ...p,
        __anchor: TOTAL_LABEL_ANCHOR,
        __labelTotal: sumVisibleStack(p, STACK_KEYS, hidden),
      })),
    [points, hidden]
  );
  if (points.length === 0) {
    return (
      <ChartSection title="2. 재고 현황 (국가)" unit="억원">
        <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
      </ChartSection>
    );
  }
  return (
    <ChartSection title="2. 재고 현황 (국가)" unit="억원">
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={chartData} margin={{ top: 32, right: 24, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis
            dataKey="monthLabel"
            tick={{ fontSize: 12 }}
            interval={0}
            angle={-30}
            textAnchor="end"
            height={56}
          />
          <YAxis tickFormatter={(v: number) => fmt(v, 0)} tick={{ fontSize: 13 }} width={70} />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              fontSize: '16px',
            }}
            content={<CountryTooltip />}
          />
          <Legend
            verticalAlign="top"
            wrapperStyle={{ paddingBottom: 4 }}
            content={() => (
              <LegendRow
                items={[
                  { key: 'domestic', label: '국내', shape: 'rect', color: COLORS.domestic },
                  { key: 'us', label: '미국', shape: 'rect', color: COLORS.us },
                  { key: 'uz', label: '우즈벡', shape: 'rect', color: COLORS.uz },
                  {
                    key: 'residual',
                    label: '영업+국내보상',
                    shape: 'rect',
                    color: COLORS.residual,
                  },
                ]}
                hidden={hidden}
                onToggle={toggle}
              />
            )}
          />
          <Bar
            dataKey="domestic"
            name="국내"
            stackId="inv"
            fill={COLORS.domestic}
            hide={hidden.has('domestic')}
          />
          <Bar dataKey="us" name="미국" stackId="inv" fill={COLORS.us} hide={hidden.has('us')} />
          <Bar dataKey="uz" name="우즈벡" stackId="inv" fill={COLORS.uz} hide={hidden.has('uz')} />
          <Bar
            dataKey="residual"
            name="영업+국내보상"
            stackId="inv"
            fill={COLORS.residual}
            hide={hidden.has('residual')}
          />
          <Bar
            dataKey="__anchor"
            stackId="inv"
            fill="transparent"
            isAnimationActive={false}
            legendType="none"
            tooltipType="none"
          >
            <LabelList
              dataKey="__labelTotal"
              position="top"
              formatter={(v: unknown) => (typeof v === 'number' ? fmt(v, 0) : '')}
              style={{ fontSize: 16, fill: 'var(--foreground)', fontWeight: 600 }}
            />
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </ChartSection>
  );
}

function CountryTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: CountryStatusPoint }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div
      className="rounded-md p-2 text-base"
      style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="font-semibold mb-1">{label}</div>
      <div>
        국내: {fmt(p.domestic, 0)} 억원{' '}
        <span className="text-muted-foreground">({pctOf(p.domestic, p.total)})</span>
      </div>
      <div>
        미국: {fmt(p.us, 0)} 억원{' '}
        <span className="text-muted-foreground">({pctOf(p.us, p.total)})</span>
      </div>
      <div>
        우즈벡: {fmt(p.uz, 0)} 억원{' '}
        <span className="text-muted-foreground">({pctOf(p.uz, p.total)})</span>
      </div>
      <div>
        영업+국내보상: {fmt(p.residual, 0)} 억원{' '}
        <span className="text-muted-foreground">({pctOf(p.residual, p.total)})</span>
      </div>
      <div className="font-semibold pt-1 mt-1 border-t border-border">
        전체: {fmt(p.total, 0)} 억원
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: 스테이징**

```bash
git add components/management/inventory/InventoryCountryStatusChart.tsx
```

---

## Task 5: 차트 1 제목 변경 + 대시보드 6차트 재배치

**Files:**

- Modify: `components/management/inventory/InventoryStatusChart.tsx` (제목 2곳)
- Modify: `components/management/inventory/InventoryDashboard.tsx` (전면 재작성)

- [ ] **Step 1: 차트 1 제목 변경**

`InventoryStatusChart.tsx`에서 `title="1. 재고 현황 (실적)"` 2곳을 모두 `title="1. 재고 현황 (종류)"` 로 변경:

```tsx
// (빈 데이터 분기)
<ChartSection title="1. 재고 현황 (종류)" unit="억원 / 회">
// (메인 렌더)
<ChartSection title="1. 재고 현황 (종류)" unit="억원 / 회">
```

- [ ] **Step 2: 대시보드 전면 재작성**

`InventoryDashboard.tsx` 전체를 아래로 교체:

```tsx
'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import LazyMount from '@/components/common/LazyMount';
import { ChartSection, ToggleGroup } from '@/components/management/plan/_selectors';
import InventoryKpiCards from './InventoryKpiCards';
import {
  buildAchievementPoints,
  buildCountryStatusPoints,
  buildDomesticAchievementPoints,
  buildKpis,
  buildOverseasAchievementPoints,
  buildStatusPoints,
  buildTransportPoints,
} from '@/lib/inventory/aggregate';
import type {
  AchievementCategory,
  DomesticItem,
  InventoryRow,
  OverseasItem,
  TransportItem,
} from '@/lib/inventory/types';

const InventoryStatusChart = dynamic(() => import('./InventoryStatusChart'), { ssr: false });
const InventoryCountryStatusChart = dynamic(() => import('./InventoryCountryStatusChart'), {
  ssr: false,
});
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

const DOMESTIC_OPTIONS: { value: DomesticItem; label: string }[] = [
  { value: 'drive', label: '구동' },
  { value: 'brake', label: '제동조향' },
  { value: 'electronics', label: '전장' },
];

const OVERSEAS_OPTIONS: { value: OverseasItem; label: string }[] = [
  { value: 'us', label: '미국' },
  { value: 'uz', label: '우즈벡' },
];

const TRANSPORT_OPTIONS: { value: TransportItem; label: string }[] = [
  { value: 'us', label: '미국' },
  { value: 'uz', label: '우즈벡' },
  { value: 'sales', label: '영업재고' },
];

export default function InventoryDashboard({ rows }: Props) {
  const [achCat, setAchCat] = useState<AchievementCategory>('total');
  const [domItem, setDomItem] = useState<DomesticItem>('drive');
  const [ovsItem, setOvsItem] = useState<OverseasItem>('us');
  const [tranItem, setTranItem] = useState<TransportItem>('us');

  const kpis = useMemo(() => buildKpis(rows), [rows]);
  const statusPts = useMemo(() => buildStatusPoints(rows), [rows]);
  const countryPts = useMemo(() => buildCountryStatusPoints(rows), [rows]);
  const achPts = useMemo(() => buildAchievementPoints(rows, achCat), [rows, achCat]);
  const domPts = useMemo(() => buildDomesticAchievementPoints(rows, domItem), [rows, domItem]);
  const ovsPts = useMemo(() => buildOverseasAchievementPoints(rows, ovsItem), [rows, ovsItem]);
  const tranPts = useMemo(() => buildTransportPoints(rows, tranItem), [rows, tranItem]);

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-4 space-y-4">
      <InventoryKpiCards kpis={kpis} />

      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <InventoryStatusChart points={statusPts} />
      </LazyMount>

      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <InventoryCountryStatusChart points={countryPts} />
      </LazyMount>

      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <ChartSection
          title="3. 계획 대비 실적 (전사)"
          unit="억원"
          controls={<ToggleGroup options={ACH_OPTIONS} value={achCat} onChange={setAchCat} />}
        >
          <InventoryAchievementChart points={achPts} unitLabel="억원" />
        </ChartSection>
      </LazyMount>

      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <ChartSection
          title="4. 계획 대비 실적 (국내)"
          unit="억원"
          controls={
            <ToggleGroup options={DOMESTIC_OPTIONS} value={domItem} onChange={setDomItem} />
          }
        >
          <InventoryAchievementChart points={domPts} unitLabel="억원" />
        </ChartSection>
      </LazyMount>

      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <ChartSection
          title="5. 계획 대비 실적 (해외)"
          unit="억원"
          controls={
            <ToggleGroup options={OVERSEAS_OPTIONS} value={ovsItem} onChange={setOvsItem} />
          }
        >
          <InventoryAchievementChart points={ovsPts} unitLabel="억원" />
        </ChartSection>
      </LazyMount>

      <LazyMount className="min-h-[420px] md:min-h-[500px]">
        <ChartSection
          title="6. 계획 대비 실적 (운송)"
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

- [ ] **Step 3: 타입체크 + lint**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run lint`
Expected: PASS

- [ ] **Step 4: 스테이징**

```bash
git add components/management/inventory/InventoryStatusChart.tsx components/management/inventory/InventoryDashboard.tsx
```

---

## Task 6: AGENTS.md 갱신 + 최종 검증 + 정리

**Files:**

- Modify: `AGENTS.md` (2곳)
- Delete: `scripts/_inspect_inventory_sheet.py`, `scripts/_inspect_inventory_integrity.py` (임시 진단)

- [ ] **Step 1: AGENTS.md inventory 페이지 설명 갱신**

`/management` 라우트 표의 `inventory(...)` 설명에서 `차트 3종`을 `차트 6종`으로 바꾸고 내용 갱신. 현재:

```
inventory(재고 KPI 5개 + 차트 3종: 1=재고 현황 콤보(운영+관리+보상+운송 누적막대 + 회전율 꺾은선, 실적만) / 2=계획대비 실적 토글[전체·운영·관리·보상·운송] / 3=계획대비 운송 토글[미국·우즈벡·영업재고]. 차트 2·3은 최근연도 12월 계획값을 빨간 점선 ReferenceLine. `inventory_entries` 사외비. USD→원화는 `value × fx_rate / 100` 환산, fx=1400)
```

→ 교체:

```
inventory(재고 KPI 5개 + 차트 6종: 1=재고 현황(종류) 콤보(운영+관리+보상+운송 누적막대 + 회전율 꺾은선, 실적만) / 2=재고 현황(국가) 누적막대[국내(구동+제동조향+전장)·미국·우즈벡 + 영업+국내보상(=전체−국가합, 기본 숨김, 켜면 총액=차트1)] / 3=계획대비 실적(전사) 토글[전체·운영·관리·보상·운송] / 4=계획대비 실적(국내) 토글[구동·제동조향·전장] / 5=계획대비 실적(해외) 토글[미국·우즈벡 국가값] / 6=계획대비 실적(운송) 토글[미국·우즈벡·영업재고]. 차트 3~6은 최근연도 12월 계획값을 빨간 점선 ReferenceLine. 국가합(국내+미국+우즈벡)은 전체의 ~88%(나머지=영업+보상 국내분). `inventory_entries` 사외비. USD→원화는 `value × fx_rate / 100` 환산, fx=1400)
```

- [ ] **Step 2: AGENTS.md lib/inventory 설명 갱신**

현재:

```
`lib/inventory/`(사외비 — `inventory_entries` + `aggregate.ts` pure 빌더 5종 vitest 16 tests, USD→억원 환산 `value × fx_rate / 100`)
```

→ 교체:

```
`lib/inventory/`(사외비 — `inventory_entries` + `aggregate.ts` pure 빌더 8종 vitest 25 tests, USD→억원 환산 `value × fx_rate / 100`)
```

> 실제 테스트 수는 Step 4의 `npm test` 출력으로 확정해 숫자 보정(16 + 신규 9 = 25 예상).

- [ ] **Step 3: 임시 진단 스크립트 삭제**

```bash
git rm -f --ignore-unmatch scripts/_inspect_inventory_sheet.py scripts/_inspect_inventory_integrity.py
```

(untracked라면 `rm scripts/_inspect_inventory_sheet.py scripts/_inspect_inventory_integrity.py`)

- [ ] **Step 4: 전체 검증**

Run: `npm run check-all`
Expected: lint + format:check + typecheck + vitest 전부 PASS. vitest 테스트 총수 확인 → Step 2 숫자 보정.

- [ ] **Step 5: 스테이징**

```bash
git add AGENTS.md
```

- [ ] **Step 6: (사용자) 데이터 적재 + UI 확인**

> 사외비 정책상 적재는 사용자가 직접 실행한다.

```powershell
& "scripts\venv\Scripts\python.exe" scripts\sync_inventory.py --dry-run   # 행수·null·검증만 확인
& "scripts\venv\Scripts\python.exe" scripts\sync_inventory.py             # 본 적재 (WriteSession 자동 revalidate)
npm run dev   # /management/inventory 6차트 확인
```

확인 포인트:

- 차트 1 제목 "1. 재고 현황 (종류)"
- 차트 2 "2. 재고 현황 (국가)" — 국내/미국/우즈벡 3층, "영업+국내보상" 범례 비활성(흐림). 클릭 시 4층 + 상단 합계가 전체재고(차트 1 합계)와 일치
- 차트 4 토글 구동/제동조향/전장, 차트 5 토글 미국/우즈벡, 제목 3·6 변경
- 콘솔/네트워크 에러 없음

- [ ] **Step 7: (사용자 승인 후) 커밋**

```bash
git commit -m "feat(inventory): 국가 분류 차트 추가 — 재고 현황(국가)·계획대비 국내/해외 차트 + 차트 3종 리네임"
```

---

## Self-Review

**Spec coverage:**

- 국가 데이터(국내 3항목·미국·우즈벡) → Task 2·3 빌더 ✓
- 정합성(전체=국내+미국+우즈벡 미성립) → 차트 2 residual층 + sync 검증 미변경(spec §6) ✓
- 차트 1 리네임 (실적→종류) → Task 5 Step 1 ✓
- 신규 차트 2 (국가, 회전율 제외) → Task 4 ✓
- 신규 차트 4 (국내 토글) → Task 3 + Task 5 ✓
- 신규 차트 5 (해외 토글) → Task 3 + Task 5 ✓
- 차트 2→3(전사), 3→6(운송) 리네임 → Task 5 ✓
- 영업+국내보상 차액 기본 숨김 → Task 4 `new Set(['residual'])` ✓

**Placeholder scan:** 모든 step에 실제 코드/명령 포함. TBD/TODO 없음 ✓

**Type consistency:** `CountryStatusPoint`(domestic/us/uz/residual/total), `DomesticItem`(drive/brake/electronics), `OverseasItem`(us/uz) — Task 1 정의가 Task 2~5 사용처와 일치 ✓. 빌더명 `buildCountryStatusPoints`·`buildDomesticAchievementPoints`·`buildOverseasAchievementPoints` 전 Task 동일 ✓
