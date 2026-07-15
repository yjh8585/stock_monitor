# 차트 가이드 (재사용 레퍼런스)

> 이 프로젝트의 모든 차트를 한곳에 정리한 문서. **신규 차트를 만들 때 여기 레시피를 복사**하고, **스타일을 바꿀 때는 여기 표준을 기준**으로 한다.
> 차트 컴포넌트는 약 60개(`recharts` + `lightweight-charts`). 페이지 책임 매핑은 [`AGENTS.md`], 경영관리 탭 구조는 [`Architecture.md §5-A`] 참고.

---

## 1. 라이브러리 선택 기준

| 용도                                                                        | 라이브러리                         | 대표 컴포넌트                                       |
| --------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------- |
| **시계열 가격/지수/환율/매크로** (기간 토글 1D~5Y, 일자 X축, 줌/크로스헤어) | `lightweight-charts` (TradingView) | `SeriesChart`, `MultiSeriesChart`, `Intraday*Chart` |
| **집계/비교/구성비** (막대·영역·스택·콤보·산점·파레토)                      | `recharts`                         | OEM·경영관리·OEM 회사별 차트 전부                   |
| **히트맵 등 커스텀 격자**                                                   | 직접 구현(div grid)                | `OemCountryHeatmap`                                 |

원칙:

- **연속 시계열 + 기간 토글이 필요하면 lightweight-charts**, 그 외 카테고리 축(연도·월·회사·제품)은 recharts.
- recharts는 SSR 비용이 크므로 **`dynamic(() => import('./XxxInner'), { ssr: false })`** 래퍼 패턴을 권장(아래 §6-lazy).

---

## 2. 공통 모듈 인벤토리 (이미 존재 — 먼저 재사용할 것)

| 모듈                         | 위치                                                  | 제공                                                                                                                                    | 사용처              |
| ---------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `useChartHeight(sm, md, lg)` | `lib/useChartHeight.ts`                               | 화면폭(640/1024 분기)에 따라 높이 반환. resize 리스너 **단일 공유 store**                                                               | recharts 차트 전반  |
| `chartStyle.ts`              | `components/oem-companies/common/chartStyle.ts`       | `GRID_STROKE_OPACITY`(0.3), `DATA_LABEL_STYLE`(15px/700), `Y_AXIS_PADDED_DOMAIN`, `sumVisibleStack`, `sumVisible`, `TOTAL_LABEL_ANCHOR` | **38개 파일**       |
| `chartTheme.ts`              | `components/charts/chartTheme.ts`                     | `TOOLTIP_CONTENT_STYLE`(16px) · `TOOLTIP_CONTENT_STYLE_SM`(14px) — Tooltip 표준 (2026-06-02 신설)                                       | **55개 파일**       |
| `chart-utils.ts`             | `components/management/chart-utils.ts`                | `sumVisibleStack`, `TOTAL_LABEL_ANCHOR` — **re-export 셰임**(SSOT=chartStyle.ts, 2026-06-02 중복 제거)                                  | 경영관리 누적막대   |
| `useHiddenSeries()`          | `components/oem-companies/common/useHiddenSeries.tsx` | recharts `<Legend>` 클릭으로 시리즈 hide 토글 + line-through 스타일                                                                     | 누적막대 다수       |
| `LegendRow`                  | `components/charts/ChartLegend.tsx`                   | 커스텀 가로 범례(rect/line 칩, 클릭 토글)                                                                                               | 경영관리 8곳        |
| `ClickableLegend`            | `components/charts/ClickableLegend.tsx`               | 색 팔레트 가로 범례(큰 순 강제, 클릭 hide)                                                                                              | OEM 3곳             |
| `OEM_COLORS` (10색)          | `components/charts/palette.ts`                        | 다중 시리즈 기본 팔레트(도메인 중립). `oem/helpers`가 re-export                                                                         | OEM·경영관리        |
| `PT_COLORS` / `PT_ORDER`     | `components/charts/palette.ts`                        | 파워트레인(ICE/HV/PHEV/EV/FCV) 전동화 그라데이션 색                                                                                     | OEM PowerTrain 차트 |
| `RangeToggle`                | `components/charts/RangeToggle.tsx`                   | 1D/1M/3M/YTD/1Y/5Y 토글(lightweight-charts 전용)                                                                                        | `SeriesChart` 류    |
| `PlaceholderChart`           | `components/charts/PlaceholderChart.tsx`              | "데이터 수집 준비 중" 자리 카드                                                                                                         | 미구현 시리즈       |

---

## 3. 페이지별 차트 카탈로그

### `/related-stocks`, `/compare`, `/domestic`, `/etc` — 시계열 위주

- `SeriesChart` — 단일 라인 + 기간 토글 + 최근값/등락 헤더 + 단위/출처 footer
- `MultiSeriesChart` — 다중 라인(동일 단위), `secondaryFor`로 좌측 보조축(가격대 다른 2종목)
- `compare/MetricCard` — 비교 지표 카드 내 미니 차트

### `/oem` (전체 탭) — `components/oem/`

| 컴포넌트                                                  | 유형                                                                                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MarketTrendChart`                                        | 막대(연간)/영역(월간) 토글                                                                                                                         |
| `Top10AnnualBars`                                         | 그룹 막대                                                                                                                                          |
| `Top10MonthlyLines`                                       | 다중 라인                                                                                                                                          |
| `Top30YtdChart`                                           | 가로 막대                                                                                                                                          |
| `CountryTop15`                                            | 가로 막대                                                                                                                                          |
| `OemCountryHeatmap`                                       | 커스텀 히트맵                                                                                                                                      |
| `PowertrainMix`                                           | 100% 스택 영역(`stackOffset="expand"`)                                                                                                             |
| `PowertrainTopOems`, `EvLeadersChart`, `TypeSegmentChart` | 막대/스택                                                                                                                                          |
| `UsaOemTrendChart`, `ModelNorthAmericaCharts`             | 라인/막대(콤보: 막대=판매량 + 선=YoY). `ModelNorthAmericaCharts`는 북미 핵심 차종(USA)·기타 핵심 차종(글로벌 합산) 2섹션을 `caption` prop으로 공유 |
| `YoyWinnersLosers`                                        | 양방향 막대                                                                                                                                        |

> ⚠️ 콤보 차트 `XAxis interval={11}`은 **월이 12개씩 연속**임을 가정. 시리즈에 결측월/중간 출시가 있으면 연도 틱 라벨이 어긋남(집계는 결측월 zero-fill 안 함 — 존재 월만 정렬). 다중 페이지 fetch로 행이 누락돼도 같은 증상 → `lib/oem/source.ts` 정렬 규칙 참고.

### `/oem/<slug>` — `components/oem-companies/`

- **공통**(`common/`): `CompanyTimeSeriesChart`(연 막대/월 영역 토글), `CompanyPowertrainMixChart`, `ShipmentStackedHBarChart`(내수·수출·해외 가로 스택)
- **회사별**: `hyundai/`, `kia/`, `kg-mobility/`, `stellantis-na/`, `uzbekistan/` — 각각 `Xxx.tsx`(래퍼 Card) + `XxxInner.tsx`(recharts, lazy)

### `/management` — `components/management/`

| 탭        | 차트                                                                                                                       | 유형                                                                                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pnl       | `MarginScatter`                                                                                                            | 산점/버블(YoY×영업이익률, 사분면 음영, 라벨 충돌회피)                                                                                                                                  |
| pnl       | `CustomerParetoChart`                                                                                                      | 파레토(막대+누적%)                                                                                                                                                                     |
| pnl       | `FixedVariableBep`                                                                                                         | 콤보(토글: 손익분기점·매출[억원] / 공헌이익률·고정비율[%] 묶은 막대 + 영업이익률 표식 꺾은선, 이중축 영역 분리)                                                                        |
| pnl       | `YoyMonthlyCompare`, `YoyMonthlyFiltered`, `YoyProductCustomer`                                                            | 막대/콤보                                                                                                                                                                              |
| plan      | `LongtermRevenueChart`                                                                                                     | 세로 그룹 막대 3계열(억원) + 기준 드롭다운. 값 전무 계열 자동 제외, 범례 `LegendRow`+`useHiddenSeries` 토글(기본 '한세 전망'만 ON), 색 `MGMT_BAR_COLORS`, 라벨 `MGMT_DATA_LABEL_STYLE` |
| plan      | `PlanAchievementChart`                                                                                                     | 콤보(계획·실적 막대 + 달성율 라인, 이중 Y축)                                                                                                                                           |
| plan      | `OrderFunnelChart`                                                                                                         | 퍼널                                                                                                                                                                                   |
| inventory | `InventoryStatusChart`, `InventoryCountryStatusChart`, `InventoryAchievementChart`                                         | 스택 막대/콤보                                                                                                                                                                         |
| personnel | `PersonnelOverallChart`, `PersonnelMixChart`, `PersonnelFieldMixChart`, `PersonnelDomesticChart`, `PersonnelOverseasChart` | 스택 막대(막대 내부 라벨 2줄)                                                                                                                                                          |

### `/hansae` — `components/hansae/`

- `IntradayCombinedChart` — lightweight-charts v5 **2-pane**(가격 60% / 외국인·기관·개인 수급 40%, 시간축 공유) + 코멘터리
- `IntradayMiniChart`, `IntradaySupplyChart` — 미니 분봉/수급

### `/stock-popup`, `/stock-prices` — `components/stock-prices/`

- `DualStockCard`, `CrossMarketCard`, `StockPricesDashboard` — 주가 페어 비교

---

## 4. 차트 유형별 표준 레시피 (복사용)

> 아래 스니펫은 **현재 코드베이스의 사실상 표준**을 추출한 것. 색·폰트·툴팁은 §5 표준 토큰을 따른다.

### 4-A. 단일 시계열 라인 (lightweight-charts)

신규로 만들 필요 거의 없음 — **`<SeriesChart>` 그대로 사용**:

```tsx
<SeriesChart title="원/달러" unit="원" source="한국은행" data={points} initialRange="1y" />
```

다중 시리즈는 `<MultiSeriesChart series={[{label,color,data}, ...]} secondaryFor={[1]} />`.

### 4-B. 세로 막대 (recharts)

```tsx
const h = useChartHeight(200, 240, 280);
<ResponsiveContainer width="100%" height={h}>
  <BarChart data={data} margin={{ top: 28, right: 20, bottom: 10, left: 10 }}>
    <CartesianGrid
      strokeDasharray="3 3"
      className="stroke-border"
      strokeOpacity={GRID_STROKE_OPACITY}
      vertical={false}
    />
    <XAxis dataKey="year" tick={{ fontSize: 13 }} />
    <YAxis
      tickFormatter={fmtUnits}
      tick={{ fontSize: 13 }}
      width={60}
      domain={Y_AXIS_PADDED_DOMAIN}
    />
    <Tooltip cursor={{ fill: 'var(--muted)' }} contentStyle={TOOLTIP_CONTENT_STYLE} />
    <Bar dataKey="sales" fill={OEM_COLORS[0]} radius={[3, 3, 0, 0]}>
      <LabelList dataKey="sales" position="top" formatter={fmtUnits} style={DATA_LABEL_STYLE} />
    </Bar>
  </BarChart>
</ResponsiveContainer>;
```

포인트: `vertical={false}`(세로 그리드선 제거), `radius={[3,3,0,0]}`(상단 라운드), `Y_AXIS_PADDED_DOMAIN`(상단 라벨 잘림 방지).

### 4-C. 영역 차트 / 100% 스택 영역

```tsx
<AreaChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 10 }} stackOffset="expand">
  {/* 100% 비중일 때만 */}
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={OEM_COLORS[0]} stopOpacity={0.4} />
      <stop offset="100%" stopColor={OEM_COLORS[0]} stopOpacity={0.05} />
    </linearGradient>
  </defs>
  <CartesianGrid
    strokeDasharray="3 3"
    className="stroke-border"
    strokeOpacity={GRID_STROKE_OPACITY}
  />
  <XAxis dataKey="label" tick={{ fontSize: 13 }} interval={5} />
  <YAxis tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} width={50} />
  <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} itemSorter={(i) => -(i.value as number)} />
  <Legend verticalAlign="top" align="center" wrapperStyle={{ fontSize: 14, paddingBottom: 8 }} />
  <Area
    type="monotone"
    dataKey="EV"
    stackId="1"
    stroke={PT_COLORS.EV}
    fill={PT_COLORS.EV}
    fillOpacity={0.85}
  />
</AreaChart>
```

### 4-D. 누적 막대 + "보이는 시리즈 합계" 라벨 + 범례 토글

가장 많이 쓰이는 경영관리/OEM 패턴. 핵심은 **무한소 앵커 막대**로 토글 연동 합계를 그리는 것:

```tsx
const { hidden, isHidden, legendProps } = useHiddenSeries();
const enriched = data.map((p) => ({ ...p, __anchor: TOTAL_LABEL_ANCHOR,
  __total: sumVisibleStack(p, ['office', 'production'], hidden) }));
// ...
<Bar dataKey="office" stackId="m" fill={OFFICE_COLOR} hide={isHidden('office')} />
<Bar dataKey="production" stackId="m" fill={PRODUCTION_COLOR} hide={isHidden('production')} />
<Bar dataKey="__anchor" stackId="m" fill="transparent" legendType="none" tooltipType="none"
  isAnimationActive={false}>
  <LabelList dataKey="__total" position="top"
    formatter={(v) => (typeof v === 'number' ? fmt(v) : '')} style={DATA_LABEL_STYLE} />
</Bar>
```

막대 **내부** 라벨은 `<LabelList content={renderInsideLabel} />` 커스텀 렌더러로 흰색 글씨, 막대 높이 < 40px면 생략(`PersonnelMixChart` 참고).

### 4-E. 가로 누적 막대

`layout="vertical"` + `<XAxis type="number" />` + `<YAxis type="category" />`. 내부 라벨 `position="center"`, 합계 라벨 `position="right"`. `ShipmentStackedHBarChartInner` 참고.

### 4-F. 콤보(막대 + 라인, 이중 Y축) — ⚠️ 막대·꺾은선 영역 분리 필수

**규칙(MUST)**: 막대와 꺾은선을 한 차트에 그릴 때는 **반드시 이중 Y축의 0을 서로 어긋나게** 잡아,
막대는 plot **하단 밴드**, 꺾은선은 **상단 밴드**에 오도록 영역을 분리한다. 두 그래프가 같은 높이대에
겹치면 데이터 라벨·표식이 충돌해 판독성이 떨어진다. **신규 콤보 차트는 예외 없이** 아래 표준 도메인을 적용한다.

표준 레시피(복사용):

```tsx
// 막대(왼쪽 축): 도메인 상한을 max×2.5로 늘려 막대를 plot 하단 ~40%로 압축
<YAxis yAxisId="amount" domain={[0, (max) => Math.max(max * 2.5, 1)]} ... />
// 꺾은선(오른쪽 축): 0%를 하단(~58%)에 두도록 음수 하한을 줘 양수 선을 상단에 그린다
<YAxis yAxisId="rate" orientation="right" domain={[-rateMax * 1.5, rateMax * 1.1]} ... />
```

- 비율·달성율 등 **0 이상 단일 부호 선**: `[-max×1.5, max×1.1]`로 음수 하한을 줘 선을 상단으로 민다.
- 압축 배수(2.5)·상한 여유(1.1)는 라벨 높이에 맞춰 미세조정 가능하나, **두 밴드가 겹치지 않는다**는 원칙은 고정.
- 막대가 누적(스택)이면 `domain` 상한 기준 max는 **스택 합계**의 최댓값으로 잡는다(개별 시리즈 X).
- 범례는 `LegendRow`(클릭 토글). 데이터 라벨은 막대 top / 선 marker 위(offset).
- 적용 차트: `PlanAchievementChart`(달성율), `FixedVariableBep`(BEP·고정비율), `InventoryStatusChart`(회전율), `FinanceLeverageChart`(부채비율).

### 4-G. 산점/버블

`ScatterChart` + `ZAxis`(버블 크기). 축은 `axisLine/tickLine={false}`로 숨기고 `ReferenceLine`으로 십자축·격자 직접 그림, `ReferenceArea`로 사분면 음영. 라벨 충돌 회피 알고리즘은 `MarginScatter`의 `assignLabelPositions` 참고.

---

## 5. 스타일 컨벤션 — 현재(as-is) 표준 토큰

> **이 값들이 사실상 합의된 표준이다.** 아래 표대로 쓰면 일관성이 유지된다. (§6에 상수화 제안)

### 5-A. 색상 팔레트

| 토큰                    | 값                                                                                                                          | 용도                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `OEM_COLORS[0..9]`      | blue/red/green/amber/purple/cyan/orange/lime/pink/slate -600                                                                | 다중 시리즈 기본 (OEM·기타 페이지)                                              |
| `MGMT_BAR_COLORS[0..5]` | blue-900 `#1e3a8a` / blue-600 `#2563eb` / blue-400 `#60a5fa` / blue-200 `#bfdbfe` / cyan-700 `#0e7490` / cyan-300 `#67e8f9` | **경영관리 막대 전용 — 파란 계열 음영**(사용자 지시 2026-07-15). 아래 규칙 참고 |
| `PT_COLORS`             | ICE `#94a3b8` · HV `#fbbf24` · PHEV `#fb923c` · EV `#22c55e` · FCV `#06b6d4`                                                | 파워트레인                                                                      |
| 강조 양수/1사분면       | `#3b82f6` (fillOpacity 0.08)                                                                                                | 산점                                                                            |
| 강조 음수/3사분면       | `#ef4444` (fillOpacity 0.08)                                                                                                | 산점                                                                            |
| 달성율 라인             | `#dc2626`                                                                                                                   | 콤보                                                                            |
| 막대 내부 글씨          | `#fff` (어두운 막대) / `var(--foreground)`                                                                                  | 라벨                                                                            |
| 사무/생산               | `#0891b2` / `#f59e0b`                                                                                                       | 인원                                                                            |
| 내수/수출/해외          | `#1e3a5f` / `#22c55e` / `#bbf7d0`                                                                                           | 출하                                                                            |

다크모드는 hex 고정색 + `var(--card)/--border/--foreground/--muted` 토큰 혼용으로 대응.

**⚠️ 경영관리(`/management`) 색 규칙 — 신규/수정 차트는 반드시 준수**

- **막대는 `MGMT_BAR_COLORS`만 쓴다.** 시리즈 수만큼 `[0]`부터 순서대로. 초록·주황·보라·분홍·황색을
  임의로 쓰지 말 것(2026-07-15 이전엔 섞여 있어 페이지에서 몇몇 차트만 튀었고, 일괄 교체함).
  2계열이면 `[0]`+`[2]`처럼 벌려 쓰면 대비가 좋다.
- **비율/달성율 꺾은선은 `#dc2626`(빨강)** — 파란 막대와 대비되어야 하므로 이 컨벤션은 유지한다.
- **중립·잔여 항목**(연기∙중단∙취소, residual 등)은 회색(`#9ca3af`) 허용.
- 6계열을 넘기면 색으로 구분하지 말고 **차트를 쪼갤지 먼저 검토**한다.
- 계획·실적 대비(`PlanAchievementChart` 등)는 같은 파랑의 **투명도 변형**(계획 40%)을 쓴다 — 이미 적용됨.

### 5-B. 글자 크기

| 요소                | 크기                                                               | 비고                                                   |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| 축 tick             | **13~14px** (`tick={{ fontSize: 13 }}` 또는 `className="text-sm"`) | ⚠️ 13/14 혼용                                          |
| 막대 위 데이터 라벨 | **15px / 700** (`DATA_LABEL_STYLE`)                                | 2026-05-27 가독성 위해 13→15 상향                      |
| 막대 내부 라벨      | 13~16px / 600                                                      | 차트별 상이                                            |
| 콤보·인원 라벨      | 16px                                                               | 경영관리 — 상수 `MGMT_DATA_LABEL_STYLE`(chartStyle.ts) |
| 범례                | **14~16px**                                                        | `LegendRow`=16, recharts Legend=14                     |
| 툴팁 본문           | **16px** (`contentStyle.fontSize`)                                 |                                                        |
| footer(단위/출처)   | 10px                                                               | lightweight 카드                                       |

### 5-C. 범례 위치

- **표준: 상단 중앙** — `verticalAlign="top"`, `align="center"`, `wrapperStyle={{ paddingBottom: 4~8 }}`.
- 클릭 토글이 필요하면 `useHiddenSeries().legendProps` 또는 커스텀 `LegendRow`/`ClickableLegend`.
- lightweight-charts는 범례가 없어 **헤더에 색 점(dot) + 라벨 + 최근값**으로 대체(`MultiSeriesChart`).

### 5-D. 툴팁 (가장 많이 복붙된 값 — 63회 / 42파일)

```ts
contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', fontSize: '16px' }}
cursor={{ fill: 'var(--muted)', opacity: 0.3 }}   // 막대
cursor={{ strokeDasharray: '3 3' }}                // 산점/라인
```

다항목은 `itemSorter={(i) => -(i.value as number)}`로 큰 값 우선 정렬.

### 5-E. 그리드

```ts
<CartesianGrid strokeDasharray="3 3" className="stroke-border" strokeOpacity={GRID_STROKE_OPACITY} />
```

세로 막대는 `vertical={false}`, 가로 막대는 `horizontal={false}`로 데이터 축 방향 선만 남긴다.

### 5-F. margin / 높이

| 항목                   | 표준                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------- |
| margin                 | `{ top, right: 20~24, bottom: 10, left: 10 }`. **데이터 라벨 있으면 top 28~48**로 확대 |
| 높이 — 소형(추이)      | `useChartHeight(200, 240, 280)`                                                        |
| 높이 — 중형(스택/가로) | `useChartHeight(280, 360, 440)`                                                        |
| 높이 — 대형(콤보/인원) | `useChartHeight(360, 440, 520)`                                                        |
| lightweight 기본       | `height = 240` (intraday 360)                                                          |

### 5-G. 컨테이너(카드)

- lightweight 카드: `rounded-xl bg-card p-3 ring-1 ring-foreground/10` + 제목/최근값 헤더 + 단위/출처 footer.
- recharts 섹션: `rounded-xl bg-card p-4 ring-1 ring-foreground/10` (`MarginScatter`) 또는 shadcn `<Card size="sm">`(OEM 회사별).
- 빈 데이터: `<div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>`

---

## 6. 통일(to-be) 제안

현재 **값은 거의 일관**되나 **리터럴이 60개 파일에 복붙**돼 있어, 한 곳을 바꾸려면 전부 손대야 한다. 아래는 **값 변경 없이 상수만 추출**하는 저위험 제안(가독성 위해 올린 15/16px는 유지).

### 제안 1 — 공유 테마 모듈 신설 `components/charts/chartTheme.ts` ✅ 툴팁 적용(2026-06-02)

지금 흩어진 토큰을 한 파일로 모으고 기존 `chartStyle.ts`는 여기서 재-export(점진 마이그레이션).

```ts
export const TOOLTIP_CONTENT_STYLE = {
  backgroundColor: 'var(--card)',
  border: '1px solid var(--border)',
  fontSize: 16,
} as const;
export const TOOLTIP_CURSOR_BAR = { fill: 'var(--muted)', opacity: 0.3 } as const;
export const TOOLTIP_CURSOR_LINE = { strokeDasharray: '3 3' } as const;
export const AXIS_TICK = { fontSize: 13 } as const; // 13/14 혼용 → 13으로 통일
export const GRID_PROPS = {
  strokeDasharray: '3 3',
  className: 'stroke-border',
  strokeOpacity: 0.3,
} as const;
// DATA_LABEL_STYLE, Y_AXIS_PADDED_DOMAIN, GRID_STROKE_OPACITY 는 chartStyle.ts에서 이동
export const CHART_HEIGHT = {
  // useChartHeight 3-tier 표준화
  sm: [200, 240, 280],
  md: [280, 360, 440],
  lg: [360, 440, 520],
} as const;
```

효과: 툴팁 스타일 1곳에서 관리(63회 복붙 제거), 축 tick 13/14 혼용 해소.

> **적용 현황(2026-06-02)**: `TOOLTIP_CONTENT_STYLE`(16px) + `TOOLTIP_CONTENT_STYLE_SM`(14px)를 만들어 **55개 파일 이관 완료**(렌더 결과 동일). 비표준이던 uzbekistan 2개 파일의 15px 툴팁도 16px로 정규화해 흡수. 이제 코드베이스에 툴팁 `contentStyle` 인라인 리터럴은 **없음**. 나머지 토큰(`TOOLTIP_CURSOR_*`·`AXIS_TICK`·`GRID_PROPS`·`CHART_HEIGHT`)은 **미적용 — 후속**.

### 제안 2 — 중복 유틸 통합 ✅ 적용(2026-06-02)

`components/management/chart-utils.ts`(`sumVisibleStack`, `TOTAL_LABEL_ANCHOR`)가 `chartStyle.ts`와 **기능 동일**이라 합쳤다. 제네릭 버전을 `chartStyle.ts`에 두고(`sumVisibleStack<T>`) `chart-utils.ts`는 re-export만 유지 → SSOT 1개. 호출부 코드는 무변경.

### 제안 3 — 범례 컴포넌트 일원화 ✅ 적용(2026-06-02)

차트 파일·OEM 폴더에 흩어져 있던 범례 컴포넌트를 `components/charts/`로 모았다.

- `LegendRow` → `components/charts/ChartLegend.tsx` 이동(차트 파일에서 UI 컴포넌트 export 해소). 사용 8곳 repoint.
- `ClickableLegend` → `components/charts/ClickableLegend.tsx` 이동(사용 3곳 repoint). API가 `LegendRow`와 달라(문자열 목록 + 색 자동 인덱싱) 강제 흡수 대신 **co-location**으로 일원화 — 호출부 부담 최소화.
- `useHiddenSeries`는 recharts `<Legend>` 래퍼로 역할이 달라 그대로 유지.

### 제안 4 — 색 팔레트 위치 이동 ✅ 적용(2026-06-02)

`OEM_COLORS`/`PT_COLORS`/`PT_ORDER`를 `components/charts/palette.ts`로 이동(도메인 중립). `oem/helpers.ts`는 하위호환 re-export만 유지하고, 경영관리 4곳은 `palette`를 직접 import → OEM 종속 제거.

### 제안 5 — recharts 차트 lazy 래퍼 패턴 표준화 ✅ 이미 적용(검증 2026-06-02)

> **정정**: 초안의 "부분 적용" 진단은 부정확했다. 실제로는 OEM 전체(`OemDashboard`)·경영관리(`PnlDashboard`/`PlanDashboard`/`InventoryDashboard`/`PersonnelDashboard`)·OEM 회사별이 모두 차트를 `dynamic(() => import('./Xxx'), { ssr: false })`로 코드 스플릿하고 있고, viewport 진입 시 1회 마운트하는 `components/common/LazyMount`(IntersectionObserver)까지 갖춰져 있다. **추가 조치 불필요.**

> **현황(2026-06-02)**: 제안 1~4 적용 완료, 제안 5는 이미 적용 상태. 모두 **렌더 결과 동일**(리팩터링)이라 `npm run check-all` 통과로 검증.

---

## 7. 신규 차트 만들 때 체크리스트

1. **시계열+기간토글?** → `SeriesChart`/`MultiSeriesChart` 재사용(거의 새로 안 만듦).
2. **카테고리 축?** → §4 레시피 복사 + §5 토큰 사용.
3. 높이는 `useChartHeight` 3-tier 중 선택(직접 px 금지).
4. 색은 `OEM_COLORS`/`PT_COLORS` 우선, 부족하면 -600 계열 추가. **경영관리(`/management`) 막대는 예외 — `MGMT_BAR_COLORS`(파란 계열)만 사용**(§5-A 규칙).
5. 툴팁은 `chartTheme`(`TOOLTIP_CONTENT_STYLE`), 그리드·데이터 라벨은 `chartStyle` 상수 사용(§5-D/E, 리터럴 복붙 금지).
6. 범례 상단 중앙. **경영관리 막대 차트는 범례 클릭 토글을 기본 제공**(`useHiddenSeries` + `LegendRow`) — "필요 시"가 아니다. 초기 OFF 계열이 필요하면 `useHiddenSeries(['키1','키2'])`.
7. recharts 기본 `<Legend>`는 payload를 **데이터 키 순서**(= `source.ts`의 `.order()` 정렬)로 만들어 막대 왼→오와 어긋난다 → **색과 라벨이 불일치하는 조용한 버그**. 순서가 중요하면 `<Legend content={() => <LegendRow ... />}>`로 직접 통제(v3 타입은 `payload` prop을 막는다). 검증은 범례 색 vs 첫 그룹 막대 색 대조.
8. 무거우면 `XxxInner` + `dynamic ssr:false` 래퍼.
9. 빈 데이터/로딩 상태 처리(§5-G).
10. 다크모드 — hex 고정색 외엔 `var(--card/--border/--foreground/--muted)` 사용.
11. `npm run check-all` + dev 서버에서 sm/md/lg 폭 모두 확인.
