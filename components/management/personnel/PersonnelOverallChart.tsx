'use client';

import { useCallback, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartHeight } from '@/lib/useChartHeight';
import { LegendRow } from '@/components/management/plan/PlanAchievementChart';
import type { OverallStackPoint } from '@/lib/personnel/types';

/** 숫자 포맷 (ko-KR, 천 단위 구분). null/NaN은 em-dash. */
function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

/** part / total 비중을 % 문자열로 반환. */
function pctOf(part: number | null | undefined, total: number | null | undefined): string {
  if (part === null || part === undefined || total === null || total === undefined || total === 0)
    return '—';
  return `${((part / total) * 100).toFixed(1)}%`;
}

const COLORS = {
  domestic: '#2563eb', // blue-600
  us: '#16a34a', // green-600
  cn: '#ea580c', // orange-600
  uz: '#7c3aed', // violet-600
  intel: '#db2777', // pink-600
};

interface Props {
  points: OverallStackPoint[];
}

/**
 * 차트 1 — 전체 인원 현황 (5층 누적막대).
 * 국내(외주 포함) / 미국 / 중국 / 우즈벡 / 이인텔리전스.
 * 막대 위에 합계 데이터 레이블, 호버 시 시리즈별 비중.
 */
export default function PersonnelOverallChart({ points }: Props) {
  const h = useChartHeight(380, 460, 540);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
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
          content={<OverallTooltip />}
        />
        <Legend
          verticalAlign="top"
          wrapperStyle={{ paddingBottom: 4 }}
          content={() => (
            <LegendRow
              items={[
                {
                  key: 'domestic',
                  label: '국내(외주 포함)',
                  shape: 'rect',
                  color: COLORS.domestic,
                },
                { key: 'us', label: '미국', shape: 'rect', color: COLORS.us },
                { key: 'cn', label: '중국', shape: 'rect', color: COLORS.cn },
                { key: 'uz', label: '우즈벡', shape: 'rect', color: COLORS.uz },
                { key: 'intel', label: '이인텔리전스', shape: 'rect', color: COLORS.intel },
              ]}
              hidden={hidden}
              onToggle={toggle}
            />
          )}
        />
        <Bar
          dataKey="domestic"
          name="국내(외주 포함)"
          stackId="p"
          fill={COLORS.domestic}
          hide={hidden.has('domestic')}
        />
        <Bar dataKey="us" name="미국" stackId="p" fill={COLORS.us} hide={hidden.has('us')} />
        <Bar dataKey="cn" name="중국" stackId="p" fill={COLORS.cn} hide={hidden.has('cn')} />
        <Bar dataKey="uz" name="우즈벡" stackId="p" fill={COLORS.uz} hide={hidden.has('uz')} />
        <Bar
          dataKey="intel"
          name="이인텔리전스"
          stackId="p"
          fill={COLORS.intel}
          hide={hidden.has('intel')}
        >
          <LabelList
            dataKey="total"
            position="top"
            formatter={(v: unknown) => (typeof v === 'number' ? fmt(v, 0) : '')}
            style={{ fontSize: 16, fill: 'var(--foreground)', fontWeight: 600 }}
          />
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** 호버 툴팁 — 시리즈별 인원수 + 비중. */
function OverallTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: OverallStackPoint }>;
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
      <div>
        국내(외주 포함): {fmt(p.domestic, 0)}{' '}
        <span className="text-muted-foreground">({pctOf(p.domestic, p.total)})</span>
      </div>
      <div>
        미국: {fmt(p.us, 0)} <span className="text-muted-foreground">({pctOf(p.us, p.total)})</span>
      </div>
      <div>
        중국: {fmt(p.cn, 0)} <span className="text-muted-foreground">({pctOf(p.cn, p.total)})</span>
      </div>
      <div>
        우즈벡: {fmt(p.uz, 0)}{' '}
        <span className="text-muted-foreground">({pctOf(p.uz, p.total)})</span>
      </div>
      <div>
        이인텔리전스: {fmt(p.intel, 0)}{' '}
        <span className="text-muted-foreground">({pctOf(p.intel, p.total)})</span>
      </div>
      <div className="font-semibold pt-1 mt-1 border-t border-border">합계: {fmt(p.total, 0)}</div>
    </div>
  );
}
