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
  type FinancialRow,
  type MetricDefinition,
  formatMetricTick,
  formatMetricValue,
} from '@/lib/compareMetrics';

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

/** 지표 1개의 연도별 묶은 세로 막대 차트 카드. 범례 클릭으로 시리즈 토글. */
export default function MetricCard({ metric, companies }: Props) {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

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
      <div className="text-sm font-semibold">{metric.label}</div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 24, right: 12, bottom: 5, left: 5 }}>
          <XAxis dataKey="year" tick={{ fontSize: 11 }} />
          <YAxis
            tickFormatter={(v) => formatMetricTick(v, metric.unit)}
            tick={{ fontSize: 11 }}
            width={55}
          />
          <Tooltip
            formatter={(v) =>
              formatMetricValue(typeof v === 'number' ? v : null, metric.unit)
            }
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              fontSize: 12,
            }}
            cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
          />
          <Legend
            verticalAlign="top"
            wrapperStyle={{ fontSize: 11, paddingBottom: 4, cursor: 'pointer' }}
            onClick={(payload) => {
              if (typeof payload.dataKey === 'string') toggleHidden(payload.dataKey);
            }}
            formatter={(value, entry) => {
              const id = typeof entry?.dataKey === 'string' ? entry.dataKey : '';
              const hidden = hiddenIds.has(id);
              return (
                <span style={{ opacity: hidden ? 0.4 : 1, textDecoration: hidden ? 'line-through' : 'none' }}>
                  {value}
                </span>
              );
            }}
          />
          {companies.map((c) => (
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
                  formatMetricValue(typeof v === 'number' ? v : null, metric.unit)
                }
                style={{ fontSize: 12, fontWeight: 600, fill: 'var(--foreground)' }}
              />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
