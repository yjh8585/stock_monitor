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
import { MGMT_BAR_COLORS } from '@/components/charts/palette';
import { GRID_STROKE_OPACITY } from '@/components/oem-companies/common/chartStyle';
import { useChartHeight } from '@/lib/useChartHeight';
import { LegendRow } from '@/components/charts/ChartLegend';
import { ChartSection } from '@/components/management/plan/_selectors';
import { buildInterestRateSeries } from '@/lib/finance/aggregate';
import type { FinanceRow, InterestRatePoint } from '@/lib/finance/types';

const DEBT_COLOR = MGMT_BAR_COLORS[1]; // 차입금 막대 (기본 파랑)
const RATE_COLOR = '#dc2626'; // 평균이자율 라인 (비율선 컨벤션, 빨강)

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
 * 2. 차입금·평균이자율 콤보 차트 (전체·연결 고정).
 * - 세로막대: 차입금 (좌 amount 축)
 * - 표식 꺾은선: 평균이자율(= 이자비용/차입금 ×100, 우 rate 축)
 * - 이중축 영역 분리(chart-guide §4-F): amount [0, max×2.5] → 막대 하단,
 *   rate [-rMax×1.5, rMax×1.1] → 선 상단. 두 영역이 겹치지 않는다.
 */
export default function FinanceInterestRateChart({ rows }: Props) {
  const data = useMemo(() => buildInterestRateSeries(rows, '전체'), [rows]);
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

  const amountMax = Math.max(1, ...data.map((p) => p.debt ?? 0));
  const rateMax = Math.max(1, ...data.map((p) => Math.abs(p.interestRate ?? 0)));

  return (
    <ChartSection title="2. 차입금·평균이자율" unit="억원 / %">
      {data.length === 0 ? (
        <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
      ) : (
        <ResponsiveContainer width="100%" height={h}>
          <ComposedChart data={data} margin={{ top: 32, right: 20, bottom: 8, left: 12 }}>
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
              yAxisId="rate"
              orientation="right"
              tickFormatter={(v: number) => `${fmt(v, 1)}%`}
              tick={{ fontSize: 13 }}
              width={56}
              // 0%를 하단(~58%)에 두어 양수 이자율선이 상단에 그려지게 (음수 영역 확장)
              domain={[-rateMax * 1.5, rateMax * 1.1]}
            />
            <Tooltip
              cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              content={<InterestRateTooltip />}
            />
            <Legend
              verticalAlign="top"
              wrapperStyle={{ paddingBottom: 4 }}
              content={() => (
                <LegendRow
                  items={[
                    { key: 'debt', label: '차입금', shape: 'rect', color: DEBT_COLOR },
                    { key: 'interestRate', label: '평균이자율', shape: 'line', color: RATE_COLOR },
                  ]}
                  hidden={hidden}
                  onToggle={toggle}
                />
              )}
            />
            <Bar
              yAxisId="amount"
              dataKey="debt"
              name="차입금"
              fill={DEBT_COLOR}
              radius={[3, 3, 0, 0]}
              hide={hidden.has('debt')}
            >
              <LabelList
                dataKey="debt"
                position="top"
                formatter={(v: unknown) => (typeof v === 'number' ? fmt(v, 0) : '')}
                style={{ fontSize: 16, fill: 'var(--foreground)', fontWeight: 600 }}
              />
            </Bar>
            <Line
              yAxisId="rate"
              type="monotone"
              dataKey="interestRate"
              name="평균이자율"
              stroke={RATE_COLOR}
              strokeWidth={2.5}
              dot={{ r: 4, fill: RATE_COLOR }}
              activeDot={{ r: 6 }}
              connectNulls
              hide={hidden.has('interestRate')}
            >
              <LabelList
                dataKey="interestRate"
                position="top"
                formatter={(v: unknown) => (typeof v === 'number' ? `${fmt(v, 2)}%` : '')}
                style={{ fontSize: 16, fill: RATE_COLOR, fontWeight: 600 }}
                offset={12}
              />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        평균이자율 = 연율화 이자비용 ÷ 차입금 × 100 · 전체/연결 · 진행연도(YTD)는 이자비용을
        연율화(×12/경과월)해 연간과 동일 기준으로 비교
      </p>
    </ChartSection>
  );
}

function InterestRateTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: InterestRatePoint }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div
      className="rounded-md p-2 text-base"
      style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="mb-1 font-semibold">
        {label}
        {p.isYtd ? <span className="ml-1 text-sm text-muted-foreground">(YTD)</span> : null}
      </div>
      <div className="text-blue-600">차입금: {fmt(p.debt, 0)} 억원</div>
      <div className="text-foreground">이자비용: {fmt(p.interest, 0)} 억원</div>
      <div className="text-red-600">
        평균이자율: {p.interestRate === null ? '—' : `${fmt(p.interestRate, 2)}%`}
      </div>
    </div>
  );
}
