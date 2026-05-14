'use client';

import { useState } from 'react';
import { useChartHeight } from '@/lib/useChartHeight';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import ClickableLegend from './ClickableLegend';
import { fmtFull, fmtUnits, OEM_COLORS } from './helpers';

export interface UsaOemTimeSeriesData {
  brands: string[];
  data: Array<Record<string, number | string>>;
}

interface Props {
  series: UsaOemTimeSeriesData;
}

/** 미국 시장 TOP10 OEM 월별 판매 추이 — 범례 클릭으로 라인 ON/OFF */
export default function UsaOemTrendChart({ series }: Props) {
  const { brands, data } = series;
  const h = useChartHeight(260, 320, 380);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const toggleHidden = (key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (data.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-12 text-center">
        미국 시장 데이터 없음.
      </div>
    );
  }

  return (
    <div>
      <div className="text-xs text-muted-foreground mb-2">
        전체 기간 USA 판매 합계 기준 TOP10 · 범례 클릭으로 항목 제외 가능
      </div>
      <ResponsiveContainer width="100%" height={h}>
        <LineChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="ymLabel" className="text-xs" tick={{ fontSize: 10 }} interval={5} />
          <YAxis tickFormatter={(v) => fmtUnits(v)} className="text-xs" width={60} />
          <Tooltip
            formatter={(v, name, entry) => {
              const total = (entry.payload as Record<string, number>).usaTotal ?? 0;
              const share = total > 0 ? ((Number(v) / total) * 100).toFixed(1) : '—';
              return [`${fmtFull(Number(v))} 대 (${share}%)`, String(name)];
            }}
            itemSorter={(item) => -(item.value as number)}
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              fontSize: '11px',
            }}
          />
          <Legend
            verticalAlign="top"
            align="center"
            wrapperStyle={{ paddingBottom: 8 }}
            content={() => (
              <ClickableLegend items={brands} hidden={hidden} onToggle={toggleHidden} />
            )}
          />
          {brands.map((brand, i) => (
            <Line
              key={brand}
              type="monotone"
              dataKey={brand}
              stroke={OEM_COLORS[i % OEM_COLORS.length]}
              strokeWidth={1.5}
              dot={false}
              hide={hidden.has(brand)}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
