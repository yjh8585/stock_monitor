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
import type { ModelMonthlySeries } from '@/lib/types';
import { useChartHeight } from '@/lib/useChartHeight';
import { fmtFull, fmtUnits } from './helpers';

interface Props {
  series: ModelMonthlySeries[];
}

/** 북미 핵심 차종 5종 — 월별 판매량(막대) + YoY %(선) 콤보 차트 5개 그리드 */
export default function ModelNorthAmericaCharts({ series }: Props) {
  if (series.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-12 text-center">
        북미 차종 데이터 없음. <code>oem_sales_model_country_month</code> 적재가 필요합니다.
      </div>
    );
  }

  return (
    <div>
      <div className="text-[11px] text-muted-foreground mb-3">
        대상: 미국(USA) 시장 · Stellantis(Grand Cherokee·Pacifica·Ram P/U) / Rivian(R1T+R1S) /
        Volkswagen(Atlas)
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {series.map((s) => (
          <ModelChart key={s.key} series={s} />
        ))}
      </div>
    </div>
  );
}

function ModelChart({ series }: { series: ModelMonthlySeries }) {
  const data = series.data;
  const h = useChartHeight(220, 280, 320);
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-sm font-medium mb-1">{series.label}</div>
      <div className="text-[10px] text-muted-foreground mb-2">{series.oemGroup}</div>
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="ymLabel" tick={{ fontSize: 9 }} interval={11} />
          <YAxis
            yAxisId="left"
            tickFormatter={(v) => fmtUnits(v)}
            tick={{ fontSize: 9 }}
            width={45}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tickFormatter={(v) => `${v.toFixed(0)}%`}
            tick={{ fontSize: 9 }}
            width={35}
          />
          <Tooltip
            formatter={(v, name) => {
              if (name === 'YoY') {
                if (v == null) return ['—', 'YoY'];
                return [`${Number(v).toFixed(1)}%`, 'YoY'];
              }
              return [`${fmtFull(Number(v))} 대`, '판매량'];
            }}
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              fontSize: '11px',
            }}
          />
          <Bar
            yAxisId="left"
            dataKey="sales"
            name="판매량"
            fill="#2563eb"
            radius={[2, 2, 0, 0]}
            barSize={6}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="yoy"
            name="YoY"
            stroke="#dc2626"
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
          <Legend verticalAlign="top" wrapperStyle={{ fontSize: '10px', paddingBottom: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
