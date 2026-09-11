'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import { useChartHeight } from '@/lib/useChartHeight';
import { DATA_LABEL_STYLE } from '@/components/oem-companies/common/chartStyle';
import { fmtFull, fmtUnits, OEM_COLORS } from './helpers';

export interface CountryTop15Row {
  name: string;
  sales: number;
}

interface Props {
  rows: CountryTop15Row[];
}

/**
 * 국가별 판매량 TOP15 (서버에서 사전 가공된 결과 받기). Tooltip에 수치+비중 표시.
 *
 * ⚠️ 중국 값은 「중국에서 팔린 대수」가 아니라 중국 업체의 글로벌 출하(내수+수출)다
 * (2025년 34.35백만 = CAAM 총 판매 34.40백만과 일치, 그중 수출 7.098백만).
 * 그래서 캡션으로 경고한다 → docs/gotchas-data-collection.md
 */
export default function CountryTop15({ rows }: Props) {
  const rowHeight = useChartHeight(18, 22, 26); // sm:18px, md:22px, lg:26px
  const minH = useChartHeight(200, 280, 360); // sm:200, md:280, lg:360

  const { data, total } = useMemo(() => {
    const t = rows.reduce((s, r) => s + r.sales, 0);
    const d = rows.map((r, i) => ({ ...r, color: OEM_COLORS[i % OEM_COLORS.length] }));
    return { data: d, total: t };
  }, [rows]);

  return (
    <>
      <p className="text-[11px] text-muted-foreground mb-3">
        ⚠️ 중국은 <strong>내수 + 수출</strong> 합계다(MarkLines가 중국 업체의 글로벌 출하를 China로
        계상 — CAAM 총 판매 기준). 2025년 34.4백만 대 중 수출이 7.1백만 대이고, 중국 내수만 보면 약
        27.3백만 대다. 수출분은 도착 국가에도 잡히므로{' '}
        <strong>국가별 값의 단순 합계는 시장 규모가 아니다.</strong>
      </p>
      <ResponsiveContainer width="100%" height={Math.max(minH, rows.length * rowHeight)}>
        <BarChart data={data} layout="vertical" margin={{ left: 60, right: 40 }}>
          <XAxis type="number" tickFormatter={(v) => fmtUnits(v)} className="text-sm" />
          <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 14 }} interval={0} />
          <Tooltip
            formatter={(v) => {
              const n = Number(v);
              const pct = total > 0 ? ((n / total) * 100).toFixed(1) : '0.0';
              return [`${fmtFull(n)} 대 (${pct}%)`, '판매량'];
            }}
            cursor={{ fill: 'var(--muted)' }}
            contentStyle={TOOLTIP_CONTENT_STYLE}
          />
          <Bar dataKey="sales" radius={[0, 4, 4, 0]}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
            <LabelList
              dataKey="sales"
              position="right"
              formatter={(v: unknown) => (v == null ? '' : fmtUnits(Number(v)))}
              style={DATA_LABEL_STYLE}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}
