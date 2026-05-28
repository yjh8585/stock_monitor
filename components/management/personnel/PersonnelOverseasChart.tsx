'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartHeight } from '@/lib/useChartHeight';
import type { OverseasPoint } from '@/lib/personnel/types';

/** 숫자 포맷 (ko-KR). */
function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

const BAR_COLOR = '#2563eb';

interface Props {
  points: OverseasPoint[];
}

/**
 * 차트 3 — 해외/자회사 단일 막대.
 * 부모에서 region 토글(미국/중국/우즈벡/이인텔리전스)을 받아 points를 변환해 전달.
 */
export default function PersonnelOverseasChart({ points }: Props) {
  const h = useChartHeight(360, 440, 520);
  if (points.length === 0) {
    return (
      <div className="py-12 text-center text-base text-muted-foreground">데이터가 없습니다.</div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={h}>
      <ComposedChart data={points} margin={{ top: 32, right: 24, bottom: 10, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
        <XAxis dataKey="periodLabel" tick={{ fontSize: 13 }} />
        <YAxis tickFormatter={(v: number) => fmt(v, 0)} tick={{ fontSize: 13 }} width={70} />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            fontSize: '16px',
          }}
          formatter={(value: unknown): [string, string] => [
            typeof value === 'number' ? `${fmt(value, 0)} 명` : '—',
            '인원',
          ]}
        />
        <Bar dataKey="headcount" name="인원" fill={BAR_COLOR} radius={[2, 2, 0, 0]}>
          <LabelList
            dataKey="headcount"
            position="top"
            formatter={(v: unknown) => (typeof v === 'number' ? fmt(v, 0) : '')}
            style={{ fontSize: 16, fill: 'var(--foreground)', fontWeight: 600 }}
          />
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}
