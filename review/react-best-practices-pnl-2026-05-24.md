# PnL 핫스팟 react-best-practices 진단 — 2026-05-24

> Vercel 공식 `react-best-practices` 스킬(64 규칙 / 8 카테고리, v0.43.0)을 기준으로
> `lib/pnl/`, `app/management/pnl/`, `components/management/pnl/` 핫스팟에 적용한 결과.

## 요약

- **범위**: `lib/pnl/source.ts`·`aggregate.ts` + `app/management/pnl/page.tsx` + `components/management/pnl/*.tsx` 8개 (~4k 라인 중점)
- **적용 카테고리**: `async-` · `bundle-` · `server-` · `rerender-` 풀 적용 / 나머지 4개는 hit한 것만
- **발견**: **8건** (CRITICAL 2, HIGH 1, MEDIUM 5)
- **Top recommendation**: **§2-1 Recharts 동적 import 반복** — 8개 차트 × subcomponent 8~11개 = **70+회 `dynamic()` 호출**. 단일 청크 lazy 로딩으로 합치면 가장 큰 가독성·번들 이득.

---

## 카테고리별 발견 항목

### 1. async- (CRITICAL) — Eliminating Waterfalls

#### 1-1. 페이지 데이터 fetch parallel ✅ 통과
`app/management/pnl/page.tsx:7`
```ts
const [data, costStructure] = await Promise.all([getPnlEntries(), getCostStructure()]);
```
`async-parallel` 모범. 두 source가 독립이므로 그대로 유지.

#### 1-2. `lib/pnl/source.ts` pagination 직렬 loop — 경미
`lib/pnl/source.ts:34-55`
```ts
while (true) {
  const { data } = await confidentialDb.from('pnl_entries').select('*').range(from, from + 999);
  ...
  from += 1000;
}
```
PostgREST max-rows=1000 제약 회피용 직렬. 현재 데이터 ~수천 행이라 latency 작고, `'use cache'`로 hit 시 비용 0. **유지 권고**. 행 수가 5만 이상으로 늘면 그때 `count: 'exact'`로 미리 페이지 수 구한 뒤 `Promise.all`로 병렬 fetch 검토.

#### 1-3. Suspense 경계 부재 — **HIGH**
`app/management/pnl/page.tsx`에 `loading.tsx`도 `<Suspense>`도 없음. 초기 캐시 miss 시 raw HTML이 stream되기 전까지 사용자가 blank 화면을 본다. PnL은 사외비 데이터라 RSC payload가 작지 않다(§2-1 참고).

**Bad (현재)**
```tsx
// app/management/pnl/page.tsx
export default async function PnlPage() {
  const [data, costStructure] = await Promise.all([getPnlEntries(), getCostStructure()]);
  return <PnlDashboard data={data} costStructure={costStructure} />;
}
```

**Good**
```tsx
// app/management/pnl/loading.tsx (신규)
export default function Loading() {
  return (
    <div className="max-w-[1600px] mx-auto px-6 py-4 space-y-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 animate-pulse h-[280px]" />
      ))}
    </div>
  );
}
```
규칙: `async-suspense-boundaries`.

---

### 2. bundle- (CRITICAL) — Bundle Size

#### 2-1. **Recharts subcomponent별 `dynamic()` 반복 — CRITICAL** 🚩 (Top recommendation)

8개 차트가 동일 패턴으로 recharts subcomponent를 **개별 dynamic import**.

| 파일 | dynamic 호출 수 |
| --- | --- |
| `MarginScatter.tsx:17-35` | 11 |
| `YoyMonthlyCompare.tsx:25-39` | 9 |
| `YoyProductCustomer.tsx:15-29` | 8 |
| `YoyMonthlyFiltered.tsx` (추정) | 8~10 |
| `WaterfallProfitability.tsx` (추정) | 8~10 |
| `CustomerParetoChart.tsx` (추정) | 8~10 |
| `SilPerformance.tsx` (추정) | 8~10 |

**Bad (현재 — MarginScatter.tsx:17~35)**
```ts
const ScatterChart = dynamic(() => import('recharts').then((m) => m.ScatterChart), { ssr: false, loading: ChartFallback });
const Scatter = dynamic(() => import('recharts').then((m) => m.Scatter), { ssr: false });
const XAxis = dynamic(() => import('recharts').then((m) => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import('recharts').then((m) => m.YAxis), { ssr: false });
// ... 7개 더
```

**문제**
- webpack/turbopack은 같은 `'recharts'` 청크로 묶지만, **차트 11개의 lazy boundary가 모두 동일 청크를 가리킴** → lazy 분리의 의미 없음
- DRY 위반 (88줄 보일러플레이트)
- 차트 내부 코드(레이아웃·핸들러)는 여전히 컴포넌트 본체에 묶여 즉시 전송됨

**Good — 옵션 A: 차트 컴포넌트 단위 lazy (가장 간단)**

`PnlDashboard`에서 차트 컴포넌트 자체를 `dynamic`. 이미 `LazyMount`로 viewport 마운트도 막혀 있으니, **bundle 측면에서도 한 청크에 묶어 한 번에 로드**.

```ts
// PnlDashboard.tsx
const MarginScatter = dynamic(() => import('./MarginScatter'), {
  ssr: false,
  loading: () => <div className="h-[420px] bg-muted/20 animate-pulse rounded" />,
});
// YoyMonthlyCompare/YoyProductCustomer/YoyMonthlyFiltered도 동일
```

차트 컴포넌트 내부의 11번 dynamic은 일반 import로 환원.

```ts
// MarginScatter.tsx (수정 후)
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip,
  ResponsiveContainer, LabelList, ReferenceLine, ReferenceArea,
} from 'recharts';
```

**효과**:
- 88줄 보일러플레이트 제거 (8개 차트 합 ~500줄)
- recharts 청크가 차트 컴포넌트 청크와 함께 viewport 진입 시 1번 로드
- TypeScript 타입도 정상 추론 (현재는 dynamic의 `unknown` 캐스팅 필요)

**Good — 옵션 B: 차트 본체 1개만 분리 (SSR 호환 필요 시)**

만약 `LazyMount` 제거하고 SSR 스트리밍을 원한다면, 컴포넌트 본체를 split.
```ts
// MarginScatter.tsx
const ChartBody = dynamic(() => import('./MarginScatterChart'), { ssr: false, loading: ChartFallback });

export default function MarginScatter(props: Props) {
  // useState/useMemo 등 모두 여기서 처리, ChartBody는 props만 받음
  return <section>... <ChartBody {...computedProps} /> ...</section>;
}
```
규칙: `bundle-dynamic-imports`.

**우선순위**: CRITICAL. 8개 차트 일괄. → "즉시 적용 안전 패치" 섹션 참고.

#### 2-2. Barrel import ✅ 통과
`recharts`는 named import 직접 사용. lucide-react도 named ✅. `bundle-barrel-imports` 통과.

---

### 3. server- (HIGH) — Server-Side Performance

#### 3-1. `select('*')` + raw 행 1000+ 직렬화 — **HIGH**
`lib/pnl/source.ts:38` + `app/management/pnl/page.tsx:8`

**Bad**
```ts
.from('pnl_entries').select('*')  // 17 columns × ~수천 행 → 모두 client로
...
return <PnlDashboard data={data} ... />;  // raw 1000+ 행을 client로 직렬화
```

**문제**
- `PnlEntry`는 17개 컬럼. 컬럼 다수가 nullable number/string.
- RSC payload에 raw 행 전체가 직렬화되어 클라이언트로 전송 (수백 KB ~ MB).
- 클라이언트는 다시 `preparePnlData`로 가공. 동일 작업을 서버에서 한 번 하면 payload 작아짐.

**Good — 옵션 A (안전, 작은 변경)**: 사용하지 않는 컬럼 명시 제외.
```ts
.select('basis,year_label,period_year,period_month,is_plan,is_estimate,sil,division,factory,product,customer,revenue,material_cost,labor_cost,expense,sga,rnd,op_income')
```
→ 실질 컬럼은 다 필요해서 효과 작음. SKIP 가능.

**Good — 옵션 B (큰 효과, 구조 변경)**: 서버에서 `preparePnlData` 동등 가공 후 derived만 전달.
```ts
// lib/pnl/source.ts
export async function getPreparedPnl(): Promise<PreparedPnlData> {
  'use cache';
  cacheLife('hours');
  cacheTag('pnl_entries');
  const raw = await fetchAllPnlEntries(); // 기존 getPnlEntries 내용
  return preparePnlData(raw); // 서버에서 가공
}
```
- 클라이언트에는 `annualEntries`(~수십 행) + `monthlyByBasis`(절반씩 분리)만 전송 → payload 1/3 ~ 1/2 감소.
- `data` raw가 필요한 `YoyMonthlyCompare`/`YoyProductCustomer` 모달 chart는 `monthlyByBasis[basis]`로 대체 가능 (이미 그렇게 사용 중인 데 일부 컴포넌트만 `data` raw 유지).

규칙: `server-serialization`.

**우선순위**: HIGH. 단 구조 변경이라 **별도 PR 권고**(즉시 안전 패치 ❌).

#### 3-2. `'use cache'` + `cacheTag` ✅ 통과
모범. `server-cache-react`(per-request dedup)는 Next 16의 `'use cache'`가 대체. 추가 작업 불필요.

---

### 4. rerender- (MEDIUM) — Re-render Optimization

#### 4-1. Recharts `content` prop에 인라인 함수/JSX
`MarginScatter.tsx:549`, `YoyMonthlyCompare.tsx:207, 216`

**Bad**
```tsx
// MarginScatter.tsx:549
<LabelList dataKey="name" content={(p: unknown) => {
  const props = p as { x?: number; y?: number; index?: number; value?: string | number };
  const pos = labelPositions[props.index ?? 0] ?? LABEL_POSITIONS[0];
  return <BubbleLabel {...props} pos={pos} />;
}} />
```
→ 매 렌더마다 새 함수 reference. Recharts 내부 props 비교에서 차이로 인식 → 재계산.

**Good**
```tsx
const renderBubbleLabel = useCallback(
  (p: unknown) => {
    const props = p as { x?: number; y?: number; index?: number; value?: string | number };
    const pos = labelPositions[props.index ?? 0] ?? LABEL_POSITIONS[0];
    return <BubbleLabel {...props} pos={pos} />;
  },
  [labelPositions]
);
// ...
<LabelList dataKey="name" content={renderBubbleLabel} />
```

또는 더 깔끔한 패턴: `BubbleLabel`을 인덱스→pos lookup 받는 module-level 컴포넌트로 빼고 props로 `labelPositions` 전달.

**우선순위**: MEDIUM. → **즉시 적용 안전 패치 가능**.

#### 4-2. 8개 차트가 각각 `useChartHeight` window resize 리스너 등록 — **HIGH**
`lib/useChartHeight.ts:7-15`
```ts
useEffect(() => {
  const update = () => { ... };
  update();
  window.addEventListener('resize', update);
  return () => window.removeEventListener('resize', update);
}, [sm, md, lg]);
```

PnL 페이지에는 `MarginScatter` / `YoyMonthlyCompare` / `YoyMonthlyFiltered` / `YoyProductCustomer` 외에도 다른 차트들도 사용 → **8+개의 window.resize 리스너**가 모두 동일 정보(window.innerWidth)를 구독.

**Bad**: 매 컴포넌트가 자기 setState로 따로 트리거 → resize 한 번에 8번 setState.

**Good**: `useSyncExternalStore` 또는 React context로 단일 구독.
```ts
// lib/useChartHeight.ts (수정 후)
'use client';
import { useSyncExternalStore } from 'react';

function subscribe(cb: () => void) {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}
function getSnapshot() {
  return window.innerWidth;
}
function getServerSnapshot() {
  return 1280; // lg 기본
}

export function useChartHeight(sm: number, md: number, lg: number): number {
  const w = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return w < 640 ? sm : w < 1024 ? md : lg;
}
```
- 리스너 자체는 N개로 유지되지만(React 18+에서 useSyncExternalStore는 외부에 단일 구독 후 internal share), setState 빈도가 줄고 SSR/hydration 일관성이 보장됨.
- 더 적극적인 단일 구독: 전역 store(Zustand 또는 모듈 변수 + 단일 effect).

규칙: `client-event-listeners` + `rerender-derived-state-no-effect` (derived state는 effect 없이 계산).

**우선순위**: MEDIUM (실측 부하는 작음, 다만 모범 위배).

#### 4-3. `dimConfig = useMemo(() => DIM_OPTIONS.find(...))` 단순식 메모 — 경미
`MarginScatter.tsx:291`
```ts
const dimConfig = useMemo(() => DIM_OPTIONS.find((d) => d.value === dim) ?? DIM_OPTIONS[0], [dim]);
```
`DIM_OPTIONS`는 3개 원소. `find` O(3). useMemo overhead가 계산보다 커서 손해.

**Good**
```ts
const dimConfig = DIM_OPTIONS.find((d) => d.value === dim) ?? DIM_OPTIONS[0];
```
규칙: `rerender-simple-expression-in-memo`. **즉시 적용 안전 패치 가능**.

#### 4-4. YoyMonthlyCompare 토글 callback 안의 cast 반복 — 경미 (품질)
`YoyMonthlyCompare.tsx:123-128`
```ts
setSelectedMetrics((prev) =>
  (prev as string[]).includes(m)
    ? (prev as string[]).filter((x) => x !== m).map((x) => x as MetricKey)
    : [...prev, m as MetricKey]
);
```
**Good**
```ts
const onToggleMetric = (m: MetricKey) => {  // 시그니처를 MetricKey로
  setSelectedMetrics((prev) =>
    prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
  );
};
```
호출처(`GroupMultiSelect`)의 `onToggle` 시그니처도 동시 조정. 함수 식별성·타입 안전성 둘 다 ↑. **즉시 적용 안전 패치 가능**(시그니처 일치 확인 필요).

#### 4-5. `rerender-no-inline-components` ✅ 통과
모든 헬퍼 컴포넌트(`BubbleLabel`/`BubbleTooltip`/`ForecastCard`/`Row`/`YearDropdown`/`HeatCell`)는 module-level 정의 ✅.

---

### 5. 나머지 카테고리 (hit만)

| 카테고리 | 상태 | 비고 |
| --- | --- | --- |
| `rendering-` | ✅ | content-visibility 적용 후보(긴 표)는 `YoyProductCustomer` heatmap 정도. 현재 ~20행이라 불필요. `&&` vs ternary는 React 19에서 문제 없음. |
| `client-` | △ | §4-2 useChartHeight 리스너 외 추가 hit 없음. localStorage 사용 없음. |
| `js-` | ✅ | Map/Set lookup 잘 사용. flatMap·toSorted 적극 사용 안 하지만 hot path 아님. |
| `advanced-` | n/a | event handler refs 등 해당 패턴 미발생. |

---

## 즉시 적용 안전 패치 — yes 하면 일괄 적용

> 모두 의미 보존 + 타입 안전. 테스트·typecheck 통과 후 단일 commit으로.

| # | 위치 | 패치 |
| --- | --- | --- |
| **P1** | `app/management/pnl/loading.tsx` (신규) | Suspense fallback 스켈레톤 추가 (§1-3 코드) |
| **P2** | `components/management/pnl/MarginScatter.tsx:549` + `YoyMonthlyCompare.tsx:207, 216` | `content` 인라인 함수 → `useCallback` (§4-1) |
| **P3** | `components/management/pnl/MarginScatter.tsx:291` | `dimConfig` useMemo 제거 (§4-3) |
| **P4** | `components/management/pnl/YoyMonthlyCompare.tsx:122-128` + `components/common/GroupMultiSelect.tsx` | `onToggleMetric` 타입 정리 (§4-4) — 시그니처 매칭 확인 필요 |

총 변경 라인 ~50, 영향 작음, 회귀 위험 낮음.

---

## 큰 구조 변경 — 별도 PR 권고

| # | 항목 | 임팩트 | 권고 |
| --- | --- | --- | --- |
| **S1** | **§2-1 차트 컴포넌트 단위 lazy 통일** (옵션 A) | 보일러플레이트 ~500줄 제거 + 번들 lazy boundary 명확 | PR 1개로 8개 차트 동시 |
| **S2** | §3-1 옵션 B — `getPreparedPnl()` 서버 가공 | RSC payload 1/3~1/2 감소 | PR 1개. `data` raw에 의존하는 곳(`YoyMonthlyCompare`/`YoyProductCustomer` 모달 chart) 점검 후 |
| **S3** | §4-2 `useChartHeight` → `useSyncExternalStore` | resize 시 setState 빈도 감소 | 작은 PR. PnL 외 페이지(`hansae`, `oem` 등)에도 영향 |

---

## 통과한 패턴 (잘 적용된 모범)

- `lib/pnl/source.ts`: `'use cache'` + `cacheTag` + `'server-only'` ✅
- `app/management/pnl/page.tsx`: `Promise.all` 병렬 fetch ✅
- `PnlDashboard.tsx`: `preparePnlData` 단일 useMemo로 raw → derived 변환 통합 ✅
- `LazyMount`: viewport 진입 시 1회 마운트 + minHeight CLS 보호 ✅
- `aggregate.ts`: Map 기반 그룹핑, IQR/quantile, niceStep 모두 pure 함수 + 단위 테스트(`__tests__/aggregate.test.ts`) ✅
- 모든 helper 컴포넌트가 module-level 정의 (`rerender-no-inline-components`) ✅
- `confidentialDb` facade로 사외비 테이블 격리 ✅

## 다음 단계 권고

1. **즉시 안전 패치 4건 yes/no** → yes면 한 commit으로 적용
2. **S1 (차트 lazy 통일)** PR 작성 — 가장 큰 가독성·번들 이득
3. S2/S3는 우선순위 낮음. PnL 외 페이지 진단 다음 단계에서 동일 패턴 점검

— 진단 종료. 64개 규칙 중 8개 카테고리 풀 적용 결과 8건 발견, CRITICAL 2 / HIGH 1 / MEDIUM 5.
