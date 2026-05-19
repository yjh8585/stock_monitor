'use client';

import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  FIXED_PRIMARY_NAME,
  type FinancialRow,
  type MetricDefinition,
  type MetricUnit,
  formatMetricTick,
  formatMetricValue,
} from '@/lib/compareMetrics';
import { useChartHeight } from '@/lib/useChartHeight';

export interface CompanyLine {
  id: string;
  name: string;
  color: string;
  rows: readonly FinancialRow[];
  highlighted: boolean;
}

interface Props {
  metric: MetricDefinition;
  companies: readonly CompanyLine[];
}

const UNIT_LABEL: Record<MetricUnit, string> = {
  percent: '%',
  times: '회',
  million: '억원',
};

/** 단위 없이 숫자만 표시 (데이터 레이블 전용). digits 미지정 시 unit 기본값. */
function formatRaw(v: number | null, unit: MetricUnit, digits?: number): string {
  if (v == null || Number.isNaN(v)) return '—';
  const defaultD = unit === 'percent' ? 1 : unit === 'times' ? 2 : 0;
  const d = digits ?? defaultD;
  switch (unit) {
    case 'percent':
      return `${(v * 100).toFixed(d)}`;
    case 'times':
      return `${v.toFixed(d)}`;
    case 'million':
      // 억원 단위로 환산, "억" 텍스트 없이 숫자만
      return `${Math.round(v / 100)}`;
  }
}

/** 지표 1개의 연도별 묶은 세로 막대 차트 카드. 범례 클릭으로 시리즈 토글. */
export default function MetricCard({ metric, companies }: Props) {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const h = useChartHeight(180, 220, 260);

  const chartData = useMemo(() => {
    const years = Array.from(
      new Set(companies.flatMap((c) => c.rows.map((r) => r.fiscal_year)))
    ).sort();
    return years.map((year) => {
      const point: Record<string, number | string | null> = { year: String(year) };
      for (const c of companies) {
        const row = c.rows.find((r) => r.fiscal_year === year);
        point[c.id] = row ? metric.compute(row) : null;
      }
      return point;
    });
  }, [companies, metric]);

  // 한세모빌리티를 항상 첫 번째(범례 최상단)로 정렬
  const sortedCompanies = useMemo(
    () =>
      [...companies].sort((a, b) => {
        if (a.name === FIXED_PRIMARY_NAME) return -1;
        if (b.name === FIXED_PRIMARY_NAME) return 1;
        return 0;
      }),
    [companies]
  );

  const toggleHidden = (id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
      <div className="flex items-baseline gap-1">
        <span className="text-base font-semibold">{metric.label}</span>
        <span className="text-sm text-muted-foreground">({UNIT_LABEL[metric.unit]})</span>
      </div>
      <ResponsiveContainer width="100%" height={h}>
        {/* margin.top 을 LabelList(14px) 가 잘리지 않게 24px 로 확장 + YAxis domain 에 15% 헤드룸 */}
        <BarChart data={chartData} margin={{ top: 28, right: 12, bottom: 5, left: 5 }}>
          <XAxis dataKey="year" tick={{ fontSize: 14 }} />
          <YAxis
            tickFormatter={(v) =>
              metric.unit === 'million'
                ? `${Math.round(v / 100)}`
                : formatMetricTick(v, metric.unit, metric.digits)
            }
            tick={{ fontSize: 14 }}
            width={55}
            domain={[
              (min: number) => (min < 0 ? min * 1.15 : 0),
              (max: number) => (max > 0 ? max * 1.15 : 0),
            ]}
          />
          <Tooltip
            formatter={(v) =>
              formatMetricValue(typeof v === 'number' ? v : null, metric.unit, metric.digits)
            }
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              fontSize: 16,
            }}
            cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
          />
          <Legend
            verticalAlign="top"
            wrapperStyle={{ paddingBottom: 4 }}
            content={() => (
              <ul
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  gap: '6px 10px',
                  fontSize: 14,
                  listStyle: 'none',
                  margin: 0,
                  padding: '0 0 4px 0',
                  cursor: 'pointer',
                }}
              >
                {sortedCompanies.map((c) => {
                  const hidden = hiddenIds.has(c.id);
                  return (
                    <li
                      key={c.id}
                      onClick={() => toggleHidden(c.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <svg width="10" height="10" style={{ flexShrink: 0 }}>
                        <rect width="10" height="10" rx="2" fill={hidden ? '#aaa' : c.color} />
                      </svg>
                      <span
                        style={{
                          opacity: hidden ? 0.4 : 1,
                          textDecoration: hidden ? 'line-through' : 'none',
                        }}
                      >
                        {c.name}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          />
          {sortedCompanies.map((c) => {
            const isPrimary = c.name === FIXED_PRIMARY_NAME;
            return (
              <Bar
                key={c.id}
                dataKey={c.id}
                name={c.name}
                fill={c.color}
                hide={hiddenIds.has(c.id)}
                radius={[3, 3, 0, 0]}
                maxBarSize={48}
              >
                <LabelList
                  dataKey={c.id}
                  position="top"
                  formatter={(v: unknown) =>
                    formatRaw(typeof v === 'number' ? v : null, metric.unit, metric.digits)
                  }
                  style={{
                    fontSize: 14,
                    fontWeight: isPrimary ? 700 : 400,
                    fill: isPrimary ? 'var(--foreground)' : 'var(--muted-foreground)',
                  }}
                />
              </Bar>
            );
          })}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
