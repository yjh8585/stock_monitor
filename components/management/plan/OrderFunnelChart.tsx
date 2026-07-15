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
import { ChartSection } from './_selectors';
import { LegendRow } from '@/components/charts/ChartLegend';
import { useChartHeight } from '@/lib/useChartHeight';
import { sumVisibleStack, TOTAL_LABEL_ANCHOR } from '@/components/management/chart-utils';
import type { PlanRow } from '@/lib/plan/types';

const COLOR_SUCCESS = MGMT_BAR_COLORS[0]; // 진한 남색 (성공)
const COLOR_FAIL = MGMT_BAR_COLORS[2]; // 밝은 파랑 (실패)
const COLOR_CANCEL = '#9ca3af'; // gray-400
const COLOR_RATE = '#dc2626'; // 성공율 라인 — 비율선 컨벤션(빨강), 막대와 대비

function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

interface FunnelPoint {
  year: number;
  yearLabel: string;
  success: number | null;
  fail: number | null;
  cancel: number | null;
  /** 입찰총액 = success + fail + cancel (검증용, 시트의 입찰총액 값과 비교) */
  total: number | null;
  /** 시트의 입찰총액 raw 값 (참고용) */
  totalSheet: number | null;
  /** 입찰성공율 = success / total × 100 */
  successRate: number | null;
}

/**
 * 2. 입찰 성공율 차트.
 *
 * - 수주성공·수주실패·연기∙중단∙취소 = 누적 막대 (3색)
 * - 입찰성공율 = 수주성공 / 입찰총액 × 100 — 표식 있는 꺾은선 (보조축)
 *
 * 가독성 설계: 막대 amount 축 domain [0, max×2.0]으로 압축해 하단 50%에 막대,
 * 라인 rate 축 domain [-max, max×1.1]로 상단 영역에 라인 — 시각 겹침 최소화.
 */
export default function OrderFunnelChart({ rows }: { rows: PlanRow[] }) {
  const points: FunnelPoint[] = useMemo(() => {
    const byYear = new Map<number, FunnelPoint>();
    const ensure = (year: number): FunnelPoint => {
      let p = byYear.get(year);
      if (!p) {
        p = {
          year,
          yearLabel: String(year),
          success: null,
          fail: null,
          cancel: null,
          total: null,
          totalSheet: null,
          successRate: null,
        };
        byYear.set(year, p);
      }
      return p;
    };
    for (const r of rows) {
      if (r.category !== '수주' || r.kind !== 'actual' || r.basis !== 'consolidated') continue;
      if (r.period_type !== 'annual') continue;
      const p = ensure(r.period_year);
      if (r.item === '수주성공') p.success = r.value;
      else if (r.item === '수주실패') p.fail = r.value;
      else if (r.item === '연기∙중단∙취소') p.cancel = r.value;
      else if (r.item === '입찰총액') p.totalSheet = r.value;
    }
    // 입찰총액 = success + fail + cancel (3개 모두 있을 때만)
    // 성공율 = success / total × 100
    const out: FunnelPoint[] = [];
    for (const p of Array.from(byYear.values()).sort((a, b) => a.year - b.year)) {
      if (p.success === null && p.fail === null && p.cancel === null) continue;
      const sum = (p.success ?? 0) + (p.fail ?? 0) + (p.cancel ?? 0);
      p.total = sum > 0 ? sum : null;
      p.successRate = p.total && p.success != null ? (p.success / p.total) * 100 : null;
      out.push(p);
    }
    return out;
  }, [rows]);

  const rateMax = Math.max(
    100,
    ...points.map((p) => (p.successRate == null ? 0 : Math.abs(p.successRate)))
  );

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // 합계(입찰총액) 레이블은 범례로 숨기지 않은 막대 시리즈만 동적 합산(성공율 라인 제외).
  const chartData = useMemo(
    () =>
      points.map((p) => ({
        ...p,
        __anchor: TOTAL_LABEL_ANCHOR,
        __labelTotal: sumVisibleStack(p, ['success', 'fail', 'cancel'], hidden),
      })),
    [points, hidden]
  );

  const h = useChartHeight(360, 440, 520);

  return (
    <ChartSection title="3. 입찰 성공율" unit="억원">
      {points.length === 0 ? (
        <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
      ) : (
        <ResponsiveContainer width="100%" height={h}>
          <ComposedChart
            data={chartData}
            margin={{ top: 48, right: 24, bottom: 10, left: 10 }}
            barCategoryGap="25%"
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis dataKey="yearLabel" tick={{ fontSize: 14 }} />
            <YAxis
              yAxisId="amount"
              tickFormatter={(v: number) => fmt(v)}
              tick={{ fontSize: 14 }}
              width={80}
              domain={[0, (max: number) => Math.max(max * 2.5, 1)]}
            />
            <YAxis
              yAxisId="rate"
              orientation="right"
              tickFormatter={(v: number) => `${Math.round(v)}%`}
              tick={{ fontSize: 14 }}
              width={56}
              domain={[-rateMax * 1.5, rateMax * 1.1]}
            />
            <Tooltip
              cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              content={<FunnelTooltip />}
            />
            <Legend
              verticalAlign="top"
              wrapperStyle={{ paddingBottom: 4 }}
              content={() => (
                <LegendRow
                  items={[
                    { key: 'success', label: '수주성공', shape: 'rect', color: COLOR_SUCCESS },
                    { key: 'fail', label: '수주실패', shape: 'rect', color: COLOR_FAIL },
                    { key: 'cancel', label: '연기∙중단∙취소', shape: 'rect', color: COLOR_CANCEL },
                    { key: 'rate', label: '입찰 성공율', shape: 'line', color: COLOR_RATE },
                  ]}
                  hidden={hidden}
                  onToggle={toggle}
                />
              )}
            />
            <Bar
              yAxisId="amount"
              dataKey="success"
              name="수주성공"
              stackId="funnel"
              fill={COLOR_SUCCESS}
              hide={hidden.has('success')}
            />
            <Bar
              yAxisId="amount"
              dataKey="fail"
              name="수주실패"
              stackId="funnel"
              fill={COLOR_FAIL}
              hide={hidden.has('fail')}
            />
            <Bar
              yAxisId="amount"
              dataKey="cancel"
              name="연기∙중단∙취소"
              stackId="funnel"
              fill={COLOR_CANCEL}
              radius={[2, 2, 0, 0]}
              hide={hidden.has('cancel')}
            />
            {/* 스택 최상단에 항상 존재하는 투명 앵커 막대 — 보이는 시리즈만의 동적 합계(입찰총액)를
                막대 바깥쪽(top)에 표시. 막대 시리즈를 토글로 꺼도 레이블이 사라지지 않는다. */}
            <Bar
              yAxisId="amount"
              dataKey="__anchor"
              stackId="funnel"
              fill="transparent"
              isAnimationActive={false}
              legendType="none"
              tooltipType="none"
            >
              <LabelList
                dataKey="__labelTotal"
                position="top"
                formatter={(value: unknown) => (typeof value === 'number' ? fmt(value) : '')}
                style={{ fontSize: 16, fill: 'var(--foreground)', fontWeight: 500 }}
              />
            </Bar>
            <Line
              yAxisId="rate"
              type="monotone"
              dataKey="successRate"
              name="입찰 성공율"
              stroke={COLOR_RATE}
              strokeWidth={2.5}
              dot={{ r: 5, fill: COLOR_RATE }}
              connectNulls
              hide={hidden.has('rate')}
            >
              <LabelList
                dataKey="successRate"
                position="top"
                formatter={(value: unknown) =>
                  typeof value === 'number' ? `${fmt(value, 1)}%` : ''
                }
                style={{ fontSize: 16, fill: COLOR_RATE, fontWeight: 600 }}
                offset={16}
              />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartSection>
  );
}

function FunnelTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: FunnelPoint }>;
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
      <div>수주성공: {fmt(p.success)} 억원</div>
      <div>수주실패: {fmt(p.fail)} 억원</div>
      <div>연기∙중단∙취소: {fmt(p.cancel)} 억원</div>
      <div className="mt-1 border-t border-border/40 pt-1 font-medium">
        입찰총액: {fmt(p.total)} 억원
      </div>
      <div className="text-blue-600 font-medium">
        입찰 성공율: {p.successRate == null ? '—' : `${fmt(p.successRate, 1)}%`}
      </div>
    </div>
  );
}
