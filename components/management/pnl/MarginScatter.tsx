'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  LabelList,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import BasisToggle from './BasisToggle';
import YearSelect from './YearSelect';
import { useChartHeight } from '@/lib/useChartHeight';
import { aggregateBy, opMarginOf, prepareYoYView } from '@/lib/pnl/aggregate';
import type { Basis, DimensionKey, PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

interface Props {
  annualEntries: PnlEntry[];
  annualByBasis: EntriesByBasis;
  /** basis별 월별 원본 — 진행 중 연도 YTD 비교용 */
  monthlyByBasis: EntriesByBasis;
}

type DimChoice = 'customer' | 'product' | 'division';

const DIM_OPTIONS: { value: DimChoice; label: string; key: DimensionKey }[] = [
  { value: 'customer', label: '고객', key: 'customer' },
  { value: 'product', label: '제품', key: 'product' },
  { value: 'division', label: '부문', key: 'division' },
];

interface BubblePoint {
  name: string;
  /** X: 매출 YoY (%) */
  yoy: number;
  /** Y: 영업이익률 (%) */
  margin: number;
  /** Z: 매출(기준 연도, 백만원). 버블 크기 */
  revenue: number;
  baseRevenue: number;
  compareRevenue: number;
  opIncome: number;
  /** dim='customer'일 때 해당 고객이 속한 부문 목록 (호버 툴팁 첫 줄용) */
  divisions?: string[];
}

/** 라벨 배치 후보 위치 (버블 중심으로부터의 픽셀 offset과 textAnchor) */
interface LabelPos {
  dx: number;
  dy: number;
  anchor: 'start' | 'middle' | 'end';
}
const LABEL_POSITIONS: readonly LabelPos[] = [
  { dx: 0, dy: -14, anchor: 'middle' }, // above (기본)
  { dx: 0, dy: 20, anchor: 'middle' }, // below
  { dx: 12, dy: 4, anchor: 'start' }, // right
  { dx: -12, dy: 4, anchor: 'end' }, // left
  { dx: 10, dy: -10, anchor: 'start' }, // top-right
  { dx: -10, dy: -10, anchor: 'end' }, // top-left
  { dx: 10, dy: 16, anchor: 'start' }, // bottom-right
  { dx: -10, dy: 16, anchor: 'end' }, // bottom-left
];

/**
 * 라벨 충돌 회피 — 매출 desc 순서로 점을 돌며, 가장 점수 낮은 후보 위치를 선택.
 *
 * 점수 = (다른 라벨과 겹침) + (다른 버블 위에 라벨이 떨어짐) + (차트 경계 밖으로 벗어남 × 큰 가중치)
 *
 *  - 라벨 겹침       : 두 라벨 box 사이 거리가 labelW/labelH 안이면 +1
 *  - 버블 겹침       : 라벨이 다른 점의 버블 영역 근처에 있으면 +0.5
 *  - 경계 밖 벗어남  : 데이터 도메인 밖으로 새는 양에 ×100 페널티 → 항상 안쪽 우선
 *
 * 큰 버블이 'above'(기본) 우선권을 갖도록 매출 desc 정렬된 입력 순서를 유지한다.
 */
function assignLabelPositions(
  points: readonly BubblePoint[],
  xDomain: readonly [number, number],
  yDomain: readonly [number, number]
): LabelPos[] {
  const xRange = xDomain[1] - xDomain[0] || 1;
  const yRange = yDomain[1] - yDomain[0] || 1;
  // 화면상 라벨이 차지하는 영역(추정): 너비 약 8%, 높이 약 7%
  const labelW = xRange * 0.08;
  const labelH = yRange * 0.07;
  // 후보 위치별 라벨 중심까지의 데이터 단위 offset (LABEL_POSITIONS 픽셀 방향과 동일)
  const candDataOffsets = LABEL_POSITIONS.map((p) => ({
    dataDx: Math.sign(p.dx) * labelW * 0.6,
    dataDy: -Math.sign(p.dy) * labelH * 0.6, // dy 픽셀은 ↓+ ↑- 이므로 데이터 좌표(↑+)는 부호 반전
  }));
  const placed: { p: BubblePoint; posIdx: number }[] = [];
  const result: LabelPos[] = [];
  for (const p of points) {
    let bestIdx = 0;
    let bestScore = Infinity;
    for (let i = 0; i < LABEL_POSITIONS.length; i += 1) {
      const c = candDataOffsets[i];
      const labelCx = p.yoy + c.dataDx;
      const labelCy = p.margin + c.dataDy;
      // 1) 도메인 경계 검사
      const left = labelCx - labelW / 2;
      const right = labelCx + labelW / 2;
      const bottom = labelCy - labelH / 2;
      const top = labelCy + labelH / 2;
      let outX = 0;
      let outY = 0;
      if (left < xDomain[0]) outX = (xDomain[0] - left) / xRange;
      else if (right > xDomain[1]) outX = (right - xDomain[1]) / xRange;
      if (bottom < yDomain[0]) outY = (yDomain[0] - bottom) / yRange;
      else if (top > yDomain[1]) outY = (top - yDomain[1]) / yRange;
      const outOfBounds = outX + outY;
      // 2) 다른 라벨 / 다른 버블과의 겹침
      let conflict = 0;
      for (const e of placed) {
        const eC = candDataOffsets[e.posIdx];
        const eLabelCx = e.p.yoy + eC.dataDx;
        const eLabelCy = e.p.margin + eC.dataDy;
        // 두 라벨 사각형이 겹치는지(중심 거리 < 라벨 크기)
        if (Math.abs(labelCx - eLabelCx) < labelW && Math.abs(labelCy - eLabelCy) < labelH) {
          conflict += 1;
        }
        // 라벨이 다른 점의 버블 영역에 닿는지(버블 크기는 모르므로 인접 임계로 근사)
        if (
          Math.abs(labelCx - e.p.yoy) < labelW * 0.7 &&
          Math.abs(labelCy - e.p.margin) < labelH * 0.7
        ) {
          conflict += 0.5;
        }
      }
      const score = conflict + outOfBounds * 100;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
        if (score === 0) break;
      }
    }
    placed.push({ p, posIdx: bestIdx });
    result.push(LABEL_POSITIONS[bestIdx]);
  }
  return result;
}

/**
 * D3 스타일 nice step — raw step을 1·2·5×10ⁿ 의 배수로 반올림해
 * 10%, 20%, 25% 같은 깔끔한 간격을 만든다.
 */
function niceStep(range: number, targetCount: number): number {
  if (range <= 0) return 1;
  const raw = range / targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let factor: number;
  if (norm < 1.5) factor = 1;
  else if (norm < 3) factor = 2;
  else if (norm < 7) factor = 5;
  else factor = 10;
  return factor * mag;
}

/**
 * 데이터의 raw min/max → nice domain(step 단위로 floor/ceil) + 균일 간격 nice ticks.
 *
 * 결과 ticks는 양 끝이 도메인과 정확히 일치하고 step 간격이 균일.
 * 사용 측에서 외곽(첫·마지막)과 0(십자축이 표시)을 걸러내 격자 좌표로 사용.
 */
function niceDomainAndTicks(
  rawLo: number,
  rawHi: number,
  targetCount = 7
): { domain: [number, number]; ticks: number[] } {
  if (rawHi - rawLo <= 0) return { domain: [-1, 1], ticks: [] };
  const step = niceStep(rawHi - rawLo, targetCount);
  const lo = Math.floor(rawLo / step) * step;
  const hi = Math.ceil(rawHi / step) * step;
  const ticks: number[] = [];
  const count = Math.round((hi - lo) / step);
  for (let i = 0; i <= count; i += 1) {
    // 부동소수 누적 오차 정리
    ticks.push(Math.round((lo + step * i) / step) * step);
  }
  return { domain: [lo, hi], ticks };
}

function fmtMillion(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  if (n === 0) return '0';
  return Math.round(n).toLocaleString('ko-KR');
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v) || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

/** 백분위(0~1) 값을 보간으로 계산. 빈 배열이면 0. */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - pos) + sorted[hi] * (pos - lo);
}

/** 매출 비중이 이 값 미만인 경우에만 이상치 후보. 영향력 있는 점은 항상 차트에 표시한다. */
const OUTLIER_SHARE_MAX = 0.02;

/**
 * YoY와 영업이익률 두 축에 대해 IQR 1.5배 규칙으로 이상치 분리.
 *
 * 추가 보호: 매출 비중이 OUTLIER_SHARE_MAX(2%) 이상인 점은 IQR 밖이어도 regular 유지.
 * → 부문(5개)에서 매출 4%인 조향이 yoy 극단이라 빠지는 일을 막고, '기타'(0.6%)만 분리.
 *
 * 이상치는 차트 축 도메인을 과도하게 늘려 다른 점들을 식별하기 어렵게 만드므로
 * 차트에서 제외하고 footer에 따로 표기한다.
 */
function classifyOutliers(pts: readonly BubblePoint[]): {
  regular: BubblePoint[];
  outliers: BubblePoint[];
} {
  if (pts.length < 5) return { regular: [...pts], outliers: [] };
  const totalRev = pts.reduce((s, p) => s + p.revenue, 0);
  const yoySorted = pts.map((p) => p.yoy).sort((a, b) => a - b);
  const marginSorted = pts.map((p) => p.margin).sort((a, b) => a - b);
  const yQ1 = quantile(yoySorted, 0.25);
  const yQ3 = quantile(yoySorted, 0.75);
  const yLo = yQ1 - 1.5 * (yQ3 - yQ1);
  const yHi = yQ3 + 1.5 * (yQ3 - yQ1);
  const mQ1 = quantile(marginSorted, 0.25);
  const mQ3 = quantile(marginSorted, 0.75);
  const mLo = mQ1 - 1.5 * (mQ3 - mQ1);
  const mHi = mQ3 + 1.5 * (mQ3 - mQ1);
  const regular: BubblePoint[] = [];
  const outliers: BubblePoint[] = [];
  for (const p of pts) {
    const share = totalRev > 0 ? p.revenue / totalRev : 0;
    const outOfRange = p.yoy < yLo || p.yoy > yHi || p.margin < mLo || p.margin > mHi;
    if (share < OUTLIER_SHARE_MAX && outOfRange) outliers.push(p);
    else regular.push(p);
  }
  return { regular, outliers };
}

/**
 * 9. 매출 YoY × 영업이익률 버블 차트.
 *
 * - X = 매출 YoY (%) — 기준 연도 매출 / 비교 연도 매출 - 1
 * - Y = 영업이익률 (%) — 기준 연도 영업이익 / 기준 연도 매출
 * - 버블 크기 = 기준 연도 매출 (Z축)
 * - 차원 선택: 고객 / 제품 / 부문 중 1개
 *
 * 성능: basis 토글 시 `annualByBasis[basis]` 작은 배열만 사용.
 */
export default function MarginScatter({ annualByBasis, monthlyByBasis }: Props) {
  const [basis, setBasis] = useState<Basis>('consolidated');
  const [dim, setDim] = useState<DimChoice>('customer');
  const [showOutliers, setShowOutliers] = useState<boolean>(false);

  const basisEntries = annualByBasis[basis];
  const basisMonthly = monthlyByBasis[basis];

  // YoY 비교 준비 (1~5단계 통합) — yearLabels '2023 제외', effBase/effCompare, ytdMonths,
  // baseEntries/compareEntries를 한 번에 계산. YoyProductCustomer와 동일 패턴.
  const [baseYear, setBaseYear] = useState<string>('');
  const view = useMemo(
    () => prepareYoYView(basisEntries, basisMonthly, basis, baseYear),
    [basisEntries, basisMonthly, basis, baseYear]
  );
  const { yearLabels, effBase, effCompare, ytdMonths, baseEntries, compareEntries } = view;

  const dimConfig = DIM_OPTIONS.find((d) => d.value === dim) ?? DIM_OPTIONS[0];

  const points: BubblePoint[] = useMemo(() => {
    if (!effBase) return [];
    const baseAgg = aggregateBy(baseEntries, [dimConfig.key]);
    const compareAgg = aggregateBy(compareEntries, [dimConfig.key]);
    const compareMap = new Map<string, number>();
    for (const r of compareAgg) {
      compareMap.set(r.dims[dimConfig.key] || '(미분류)', r.revenue);
    }
    // dim='customer'일 때 고객→부문 매핑 (호버 툴팁 첫 줄용)
    const divsByCustomer = new Map<string, Set<string>>();
    if (dimConfig.key === 'customer') {
      for (const e of baseEntries) {
        const cust = e.customer;
        if (!cust) continue;
        const div = e.division || '(미분류)';
        let s = divsByCustomer.get(cust);
        if (!s) {
          s = new Set<string>();
          divsByCustomer.set(cust, s);
        }
        s.add(div);
      }
    }
    return baseAgg
      .filter((r) => r.revenue > 0)
      .map((r) => {
        const name = r.dims[dimConfig.key] || '(미분류)';
        const cmp = compareMap.get(name) ?? 0;
        const yoy = cmp !== 0 ? ((r.revenue - cmp) / Math.abs(cmp)) * 100 : 0;
        const divisions =
          dimConfig.key === 'customer'
            ? Array.from(divsByCustomer.get(name) ?? []).sort((a, b) => a.localeCompare(b, 'ko'))
            : undefined;
        return {
          name,
          yoy,
          margin: opMarginOf(r) ?? 0,
          revenue: r.revenue,
          baseRevenue: r.revenue,
          compareRevenue: cmp,
          opIncome: r.op_income,
          divisions,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [baseEntries, compareEntries, effBase, dimConfig.key]);

  /** 이상치 분리. showOutliers=false면 차트는 regular만, true면 outlier 포함. */
  const { regular: regularPoints, outliers } = useMemo(() => classifyOutliers(points), [points]);

  /** 차트에 실제로 들어갈 점 — 토글 상태에 따라 outlier 포함 여부 결정 */
  const chartPoints = useMemo(
    () => (showOutliers ? [...regularPoints, ...outliers] : regularPoints),
    [showOutliers, regularPoints, outliers]
  );

  const maxRev = useMemo(
    () => chartPoints.reduce((m, p) => Math.max(m, p.revenue), 0),
    [chartPoints]
  );

  /**
   * Nice domain + 균일 간격 ticks 계산.
   *
   * - 0이 항상 포함되도록 raw min/max를 [min(0, dataMin), max(0, dataMax)]로 보정한 뒤
   *   D3 스타일 niceDomainAndTicks로 도메인을 step 단위로 round.
   * - 결과 ticks는 step 간격이 균일 (예: -20, -10, 0, 10, 20).
   */
  const xMeta = useMemo(() => {
    if (chartPoints.length === 0) {
      return { domain: [-10, 10] as [number, number], ticks: [] as number[] };
    }
    let lo = 0;
    let hi = 0;
    for (const p of chartPoints) {
      if (p.yoy < lo) lo = p.yoy;
      if (p.yoy > hi) hi = p.yoy;
    }
    return niceDomainAndTicks(lo, hi);
  }, [chartPoints]);

  const yMeta = useMemo(() => {
    if (chartPoints.length === 0) {
      return { domain: [-10, 10] as [number, number], ticks: [] as number[] };
    }
    let lo = 0;
    let hi = 0;
    for (const p of chartPoints) {
      if (p.margin < lo) lo = p.margin;
      if (p.margin > hi) hi = p.margin;
    }
    return niceDomainAndTicks(lo, hi);
  }, [chartPoints]);

  const xDomain = xMeta.domain;
  const yDomain = yMeta.domain;

  /** 라벨 충돌 회피 위치 사전 계산 — index 순으로 LABEL_POSITIONS 배열 */
  const labelPositions = useMemo(
    () => assignLabelPositions(chartPoints, xDomain, yDomain),
    [chartPoints, xDomain, yDomain]
  );

  /**
   * 격자/tick 좌표 = nice ticks에서 양 끝(도메인 경계 = 외곽 테두리)과 0(십자축이 별도 강조)을 제외.
   * → 균일 간격 + 깔끔한 1·2·5 배수 값 + 네모 테두리 없음.
   */
  const gridX = useMemo(
    () => xMeta.ticks.filter((v, i, arr) => i > 0 && i < arr.length - 1 && v !== 0),
    [xMeta]
  );
  const gridY = useMemo(
    () => yMeta.ticks.filter((v, i, arr) => i > 0 && i < arr.length - 1 && v !== 0),
    [yMeta]
  );

  const h = useChartHeight(280, 380, 460);

  const renderBubbleLabel = useCallback(
    (p: unknown) => {
      const props = p as {
        x?: number;
        y?: number;
        index?: number;
        value?: string | number;
      };
      const pos = labelPositions[props.index ?? 0] ?? LABEL_POSITIONS[0];
      return <BubbleLabel {...props} pos={pos} />;
    },
    [labelPositions]
  );

  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <header className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-lg font-semibold">9. 매출 YoY × 영업이익률 (버블=매출)</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <BasisToggle value={basis} onChange={setBasis} />
          <YearSelect label="연도" options={yearLabels} value={effBase} onChange={setBaseYear} />
          <DimRadio value={dim} onChange={setDim} />
          <OutlierToggle
            value={showOutliers}
            onChange={setShowOutliers}
            disabled={outliers.length === 0}
          />
        </div>
      </header>
      {points.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          선택한 조건에 해당하는 데이터가 없습니다.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={h}>
          <ScatterChart margin={{ top: 16, right: 24, bottom: 24, left: 24 }}>
            {/*
              - X/Y축은 axisLine·tickLine 없이 tick 숫자만 표시
              - 안쪽 격자는 ReferenceLine을 도메인 등분으로 직접 그려 외곽 테두리가 생기지 않게 함
              - 3사분면(YoY<0 & 영업이익률<0)은 연한 붉은색 음영으로 강조
              - 십자축은 ReferenceLine x=0 / y=0
            */}
            {/* 3사분면 (YoY<0 & 영업이익률<0) — 연한 빨강 */}
            <ReferenceArea
              x1={xDomain[0]}
              x2={0}
              y1={yDomain[0]}
              y2={0}
              fill="#ef4444"
              fillOpacity={0.08}
              stroke="none"
              ifOverflow="visible"
            />
            {/* 1사분면 (YoY>0 & 영업이익률>0) — 연한 파랑 */}
            <ReferenceArea
              x1={0}
              x2={xDomain[1]}
              y1={0}
              y2={yDomain[1]}
              fill="#3b82f6"
              fillOpacity={0.08}
              stroke="none"
              ifOverflow="visible"
            />
            {gridX.map((v) => (
              <ReferenceLine
                key={`gx-${v}`}
                x={v}
                stroke="var(--border)"
                strokeDasharray="3 3"
                strokeOpacity={0.6}
              />
            ))}
            {gridY.map((v) => (
              <ReferenceLine
                key={`gy-${v}`}
                y={v}
                stroke="var(--border)"
                strokeDasharray="3 3"
                strokeOpacity={0.6}
              />
            ))}
            <XAxis
              type="number"
              dataKey="yoy"
              domain={xDomain}
              ticks={gridX}
              interval={0}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              tick={{ fontSize: 14 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="number"
              dataKey="margin"
              domain={yDomain}
              ticks={gridY}
              interval={0}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              tick={{ fontSize: 14 }}
              axisLine={false}
              tickLine={false}
              width={50}
            />
            <ZAxis
              type="number"
              dataKey="revenue"
              range={[80, 800]}
              domain={[0, Math.max(maxRev, 1)]}
              name="매출"
            />
            <ReferenceLine
              y={0}
              stroke="var(--foreground)"
              strokeWidth={1.5}
              ifOverflow="extendDomain"
              label={{
                value:
                  ytdMonths >= 1 && ytdMonths <= 11
                    ? `매출 YoY (${effBase} 1~${ytdMonths}월 vs ${effCompare} 1~${ytdMonths}월, %)`
                    : `매출 YoY (${effBase} vs ${effCompare}, %)`,
                position: 'insideTopRight',
                fontSize: 14,
                fill: 'var(--muted-foreground)',
              }}
            />
            <ReferenceLine
              x={0}
              stroke="var(--foreground)"
              strokeWidth={1.5}
              ifOverflow="extendDomain"
              label={{
                value: '영업이익률 (%)',
                position: 'insideTopLeft',
                fontSize: 14,
                fill: 'var(--muted-foreground)',
              }}
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              contentStyle={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                fontSize: '16px',
              }}
              content={<BubbleTooltip baseYear={effBase} compareYear={effCompare} />}
            />
            <Scatter name={dimConfig.label} data={chartPoints} fill="#000000" shape="circle">
              <LabelList dataKey="name" content={renderBubbleLabel} />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      )}
      {outliers.length > 0 && !showOutliers && (
        <div className="mt-3 rounded-md border border-dashed border-border bg-muted/20 p-3 text-sm">
          <div className="font-semibold text-foreground mb-1.5">
            이상치 {outliers.length}건 — 차트 가독성을 위해 제외 (토글로 반영 가능)
          </div>
          <ul className="space-y-1 text-muted-foreground">
            {outliers.map((o) => (
              <li key={o.name} className="tabular-nums">
                <span className="text-foreground font-medium">{o.name}</span> · 매출{' '}
                {fmtMillion(o.baseRevenue)} 백만원 · YoY{' '}
                <span className={o.yoy < 0 ? 'text-red-500 font-bold' : ''}>{fmtPct(o.yoy)}</span>
                {' · '}영업이익률{' '}
                <span className={o.margin < 0 ? 'text-red-500 font-bold' : ''}>
                  {fmtPct(o.margin)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * 데이터 레이블 — 사전 계산된 LabelPos를 사용해 겹치지 않게 배치 (기본 above).
 */
function BubbleLabel(props: { x?: number; y?: number; value?: string | number; pos?: LabelPos }) {
  const { x = 0, y = 0, value, pos } = props;
  if (value == null) return null;
  const p = pos ?? LABEL_POSITIONS[0];
  return (
    <text
      x={x + p.dx}
      y={y + p.dy}
      textAnchor={p.anchor}
      fontSize={14}
      fontWeight={500}
      fill="var(--foreground)"
      pointerEvents="none"
    >
      {String(value)}
    </text>
  );
}

/** 음수면 빨강 볼드, 아니면 일반 medium */
function neg(v: number): string {
  return v < 0 ? 'text-red-500 font-bold' : 'font-medium';
}

function BubbleTooltip({
  active,
  payload,
  baseYear,
  compareYear,
}: {
  active?: boolean;
  payload?: Array<{ payload: BubblePoint }>;
  baseYear: string;
  compareYear: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div
      className="rounded-md p-2 text-base"
      style={{
        backgroundColor: 'var(--card)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="font-semibold mb-1">{p.name}</div>
      {p.divisions && p.divisions.length > 0 && (
        <div className="text-muted-foreground mb-1">{p.divisions.join(' / ')}</div>
      )}
      <div>
        매출 {baseYear}: <span className={neg(p.baseRevenue)}>{fmtMillion(p.baseRevenue)}</span>{' '}
        백만원
      </div>
      <div>
        매출 {compareYear}:{' '}
        <span className={neg(p.compareRevenue)}>{fmtMillion(p.compareRevenue)}</span> 백만원
      </div>
      <div>
        매출 YoY: <span className={neg(p.yoy)}>{fmtPct(p.yoy)}</span>
      </div>
      <div>
        영업이익률: <span className={neg(p.margin)}>{fmtPct(p.margin)}</span>
      </div>
      <div>
        영업이익: <span className={neg(p.opIncome)}>{fmtMillion(p.opIncome)}</span> 백만원
      </div>
    </div>
  );
}

/** 이상치 제외/반영 토글 — 매출 비중 < 2% & IQR 밖인 점을 차트에 포함할지 결정. */
function OutlierToggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const opts: { v: boolean; label: string }[] = [
    { v: false, label: '이상치 제외' },
    { v: true, label: '이상치 반영' },
  ];
  return (
    <div
      className={`inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5 ${
        disabled ? 'opacity-40 pointer-events-none' : ''
      }`}
    >
      {opts.map(({ v, label }) => {
        const active = v === value;
        return (
          <button
            key={String(v)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(v)}
            className={`text-sm px-2.5 py-1 rounded-sm transition-colors ${
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function DimRadio({ value, onChange }: { value: DimChoice; onChange: (v: DimChoice) => void }) {
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5">
      {DIM_OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`text-sm px-2.5 py-1 rounded-sm transition-colors ${
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
