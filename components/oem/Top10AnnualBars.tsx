'use client';

import { useMemo, useState } from 'react';
import { useChartHeight } from '@/lib/useChartHeight';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { OemSalesGroupMonth } from '@/lib/types';
import ClickableLegend from './ClickableLegend';
import {
  annualByGroup,
  findLatestYm,
  fmtFull,
  fmtUnits,
  shortenOemName,
  sumByGroup,
  OEM_COLORS,
} from './helpers';

interface Props {
  groupMonth: OemSalesGroupMonth[];
}

const TOP_N = 10;
const YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];

/** TOP10 OEM 연간 판매량 그룹 막대 차트 (X=연도, Series=OEM)
 *  - 범례: 판매량 큰 순 왼쪽부터 (Recharts 기본 자동 정렬 무시 위해 명시적 payload 사용)
 *  - 범례 클릭 시 해당 막대 hide 토글
 */
export default function Top10AnnualBars({ groupMonth }: Props) {
  const { chartData, oems, latestMonth2026 } = useMemo(() => {
    const cur = sumByGroup(groupMonth, 202501, 202512);
    const top10 = [...cur.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([g]) => g);

    const annual = annualByGroup(groupMonth);
    const labels = top10.map((g) => shortenOemName(g));
    const data = YEARS.map((yr) => {
      const row: Record<string, number | string> = { year: String(yr) };
      top10.forEach((g, i) => {
        row[labels[i]] = annual.get(g)?.get(yr) ?? 0;
      });
      return row;
    });
    const latest2026 = findLatestYm(groupMonth, 2026);
    return {
      chartData: data,
      oems: labels,
      latestMonth2026: latest2026 ? latest2026 % 100 : null,
    };
  }, [groupMonth]);

  const h = useChartHeight(260, 360, 440);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggleHidden = (key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div>
      <div className="text-sm text-muted-foreground mb-2">
        2025년 TOP10 기준 ·{' '}
        {latestMonth2026
          ? `2026년은 1~${latestMonth2026}월 누적 (연간 환산 아님)`
          : '2026년 데이터 없음'}{' '}
        · 범례 클릭으로 항목 제외 가능
      </div>
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="year" className="text-sm" />
          <YAxis tickFormatter={(v) => fmtUnits(v)} className="text-sm" width={60} />
          <Tooltip
            formatter={(v, name) => [fmtFull(Number(v)) + ' 대', String(name)]}
            itemSorter={(item) => -(item.value as number)}
            cursor={{ fill: 'var(--muted)' }}
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              fontSize: '16px',
            }}
          />
          <Legend
            verticalAlign="top"
            align="center"
            wrapperStyle={{ paddingBottom: 8 }}
            content={() => <ClickableLegend items={oems} hidden={hidden} onToggle={toggleHidden} />}
          />
          {oems.map((g, i) => (
            <Bar
              key={g}
              dataKey={g}
              fill={OEM_COLORS[i % OEM_COLORS.length]}
              radius={[2, 2, 0, 0]}
              hide={hidden.has(g)}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
