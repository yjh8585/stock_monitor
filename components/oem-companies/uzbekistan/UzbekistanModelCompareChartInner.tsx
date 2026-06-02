'use client';

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
import { useChartHeight } from '@/lib/useChartHeight';
import { GRID_STROKE_OPACITY } from '../common/chartStyle';

interface Props {
  models: { model: string; current: number; prev: number | null }[];
  /** 당해 시리즈 라벨 (예: '2026 (1~3월)' 또는 '2025'). */
  curLabel: string;
  /** 전년 동기 시리즈 라벨 (예: '2025 (1~3월)' 또는 '2024'). */
  prevLabel: string;
  /** 전년 동기 막대 표시 여부(가장 이른 연도는 false). */
  showPrev: boolean;
}

// 경영관리 PlanAchievementChart와 동일 컨벤션: 당해=진한 파랑, 전년=연한 파랑(같은 hue).
const PREV_COLOR = 'rgba(37, 99, 235, 0.35)'; // blue-600 35% (전년 동기)
const CUR_COLOR = '#2563eb'; // blue-600 (당해)

function fmtUnitsTick(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

export default function UzbekistanModelCompareChartInner({
  models,
  curLabel,
  prevLabel,
  showPrev,
}: Props) {
  const height = useChartHeight(280, 320, 360);
  const chartData = models.map((m) => ({
    model: m.model,
    [prevLabel]: m.prev ?? 0,
    [curLabel]: m.current,
    __prev: m.prev,
    __cur: m.current,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ top: 16, right: 20, bottom: 4, left: 10 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-border"
          strokeOpacity={GRID_STROKE_OPACITY}
          vertical={false}
        />
        <XAxis
          dataKey="model"
          className="text-sm"
          tick={{ fontSize: 12 }}
          interval={0}
          angle={-20}
          textAnchor="end"
          height={76}
        />
        <YAxis tickFormatter={fmtUnitsTick} className="text-sm" width={60} />
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            fontSize: '14px',
          }}
          content={({ active, payload, label }) => {
            if (!active || !payload || payload.length === 0) return null;
            const row = payload[0].payload as { __prev: number | null; __cur: number };
            const prev = row.__prev;
            const cur = row.__cur;
            const yoy = prev != null && prev > 0 ? ((cur - prev) / prev) * 100 : null;
            return (
              <div
                className="rounded-md p-2 text-sm"
                style={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }}
              >
                <div className="font-semibold mb-1">{String(label)}</div>
                {showPrev && (
                  <div style={{ color: PREV_COLOR }}>
                    {prevLabel}: {(prev ?? 0).toLocaleString('ko-KR')}대
                  </div>
                )}
                <div style={{ color: CUR_COLOR }}>
                  {curLabel}: {cur.toLocaleString('ko-KR')}대
                </div>
                {showPrev && yoy != null && (
                  <div className={yoy >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                    YoY {yoy > 0 ? '+' : ''}
                    {yoy.toFixed(1)}%
                  </div>
                )}
              </div>
            );
          }}
        />
        <Legend
          layout="horizontal"
          verticalAlign="top"
          align="center"
          wrapperStyle={{ fontSize: '14px', paddingBottom: 12 }}
          itemSorter={null}
        />
        {/* 전년(회색) → 당해(파랑) 순으로 시간순 배치. */}
        {showPrev && (
          <Bar
            dataKey={prevLabel}
            name={prevLabel}
            fill={PREV_COLOR}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
        )}
        <Bar
          dataKey={curLabel}
          name={curLabel}
          fill={CUR_COLOR}
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
