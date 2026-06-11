'use client';

import { useCallback, useMemo, useState } from 'react';
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
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { GRID_STROKE_OPACITY } from '@/components/oem-companies/common/chartStyle';
import { useChartHeight } from '@/lib/useChartHeight';
import { LegendRow } from '@/components/charts/ChartLegend';
import { ChartSection, ToggleGroup } from '@/components/management/plan/_selectors';
import { buildLeverageSeries, listSubsidiaries } from '@/lib/finance/aggregate';
import type { FinanceRow, LeveragePoint } from '@/lib/finance/types';

const ASSET_COLOR = '#2563eb'; // 자산 (파랑)
const LIABILITY_COLOR = '#f59e0b'; // 부채 (amber)
const RATIO_COLOR = '#dc2626'; // 부채비율 라인 (비율선 컨벤션, 빨강)

function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

interface Props {
  rows: FinanceRow[];
}

/**
 * 1. 재무 레버리지 콤보 차트.
 * - 묶은 세로막대: 자산 · 부채 (좌 amount 축)
 * - 표식 꺾은선: 부채비율(= 부채/자본 ×100, 우 ratio 축)
 * - 이중축 영역 분리(chart-guide §4-F): amount [0, max×2.5] → 막대 하단,
 *   ratio [-rMax×1.5, rMax×1.1] → 선 상단. 두 영역이 겹치지 않는다.
 * - 자회사 필터(전체/미국/…)는 데이터 기반 자동 생성 — 이 차트 전용.
 */
export default function FinanceLeverageChart({ rows }: Props) {
  const subs = useMemo(() => listSubsidiaries(rows), [rows]);
  const [sub, setSub] = useState<string>('전체');
  const activeSub = subs.includes(sub) ? sub : (subs[0] ?? '전체');
  const data = useMemo(() => buildLeverageSeries(rows, activeSub), [rows, activeSub]);
  const h = useChartHeight(320, 400, 460);

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const amountMax = Math.max(1, ...data.map((p) => Math.max(p.assets ?? 0, p.liabilities ?? 0)));
  const ratioMax = Math.max(50, ...data.map((p) => Math.abs(p.debtRatio ?? 0)));

  const controls =
    subs.length > 0 ? (
      <ToggleGroup
        options={subs.map((s) => ({ value: s, label: s }))}
        value={activeSub}
        onChange={setSub}
      />
    ) : null;

  return (
    <ChartSection title="1. 재무 레버리지 (자산·부채·부채비율)" unit="억원 / %" controls={controls}>
      {data.length === 0 ? (
        <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
      ) : (
        <ResponsiveContainer width="100%" height={h}>
          <ComposedChart
            data={data}
            margin={{ top: 32, right: 20, bottom: 8, left: 12 }}
            barGap={4}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-border"
              strokeOpacity={GRID_STROKE_OPACITY}
              vertical={false}
            />
            <XAxis dataKey="periodLabel" tick={{ fontSize: 13 }} />
            <YAxis
              yAxisId="amount"
              tickFormatter={(v: number) => fmt(v, 0)}
              tick={{ fontSize: 13 }}
              width={68}
              // 막대를 하단 ~40%로 압축 → 상단 꺾은선과 분리
              domain={[0, () => Math.round(amountMax * 2.5)]}
            />
            <YAxis
              yAxisId="ratio"
              orientation="right"
              tickFormatter={(v: number) => `${Math.round(v)}%`}
              tick={{ fontSize: 13 }}
              width={52}
              // 0%를 하단(~58%)에 두어 양수 부채비율선이 상단에 그려지게 (음수 영역 확장)
              domain={[-ratioMax * 1.5, ratioMax * 1.1]}
            />
            <Tooltip
              cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              content={<LeverageTooltip />}
            />
            <Legend
              verticalAlign="top"
              wrapperStyle={{ paddingBottom: 4 }}
              content={() => (
                <LegendRow
                  items={[
                    { key: 'assets', label: '자산', shape: 'rect', color: ASSET_COLOR },
                    { key: 'liabilities', label: '부채', shape: 'rect', color: LIABILITY_COLOR },
                    { key: 'debtRatio', label: '부채비율', shape: 'line', color: RATIO_COLOR },
                  ]}
                  hidden={hidden}
                  onToggle={toggle}
                />
              )}
            />
            <Bar
              yAxisId="amount"
              dataKey="assets"
              name="자산"
              fill={ASSET_COLOR}
              radius={[3, 3, 0, 0]}
              hide={hidden.has('assets')}
            >
              <LabelList
                dataKey="assets"
                position="top"
                formatter={(v: unknown) => (typeof v === 'number' ? fmt(v, 0) : '')}
                style={{ fontSize: 16, fill: 'var(--foreground)', fontWeight: 600 }}
              />
            </Bar>
            <Bar
              yAxisId="amount"
              dataKey="liabilities"
              name="부채"
              fill={LIABILITY_COLOR}
              radius={[3, 3, 0, 0]}
              hide={hidden.has('liabilities')}
            >
              <LabelList
                dataKey="liabilities"
                position="top"
                formatter={(v: unknown) => (typeof v === 'number' ? fmt(v, 0) : '')}
                style={{ fontSize: 16, fill: 'var(--foreground)', fontWeight: 600 }}
              />
            </Bar>
            <Line
              yAxisId="ratio"
              type="monotone"
              dataKey="debtRatio"
              name="부채비율"
              stroke={RATIO_COLOR}
              strokeWidth={2.5}
              dot={{ r: 4, fill: RATIO_COLOR }}
              activeDot={{ r: 6 }}
              connectNulls
              hide={hidden.has('debtRatio')}
            >
              <LabelList
                dataKey="debtRatio"
                position="top"
                formatter={(v: unknown) => (typeof v === 'number' ? `${fmt(v, 1)}%` : '')}
                style={{ fontSize: 16, fill: RATIO_COLOR, fontWeight: 600 }}
                offset={12}
              />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartSection>
  );
}

function LeverageTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: LeveragePoint }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div
      className="rounded-md p-2 text-base"
      style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="font-semibold mb-1">
        {label}
        {p.isYtd ? <span className="ml-1 text-sm text-muted-foreground">(YTD)</span> : null}
      </div>
      <div className="text-blue-600">자산: {fmt(p.assets, 0)} 억원</div>
      <div className="text-amber-600">부채: {fmt(p.liabilities, 0)} 억원</div>
      <div className="text-red-600">
        부채비율: {p.debtRatio === null ? '—' : `${fmt(p.debtRatio, 1)}%`}
      </div>
    </div>
  );
}
