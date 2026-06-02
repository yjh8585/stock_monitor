'use client';

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
import { useChartHeight } from '@/lib/useChartHeight';
import type { UzbekistanBrandSeriesPoint } from '@/lib/oem-companies/uzbekistan/source';
import { DATA_LABEL_STYLE, GRID_STROKE_OPACITY } from '../common/chartStyle';

interface Props {
  data: UzbekistanBrandSeriesPoint[];
  color?: string;
  unitLabel?: string;
}

function fmtUnitsTick(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

function fmtBarLabel(value: unknown): string {
  if (value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

function fmtYoy(v: unknown): string {
  if (v == null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

/** 라인 데이터 레이블용 — null/비유한값은 빈 문자열(레이블 미표시). */
function fmtYoyLabel(v: unknown): string {
  if (v == null || !Number.isFinite(Number(v))) return '';
  return fmtYoy(v);
}

export default function UzbekistanBrandSeriesChartInner({
  data,
  color = '#2563eb',
  unitLabel = '대',
}: Props) {
  const height = useChartHeight(280, 320, 360);

  // 막대(좌축)는 하단, YoY 라인(우축)은 상단으로 분리해 데이터 레이블 겹침 방지.
  // - 좌축 domain을 max×1.9로 키워 막대를 plot 하단 ~52% 영역에 고정.
  // - 우축 domain 하단에 큰 패딩을 줘 라인을 상단 ~45% 영역으로 밀어올림(YoY 음수 대응).
  const unitsMax = Math.max(1, ...data.map((d) => d.units));
  const yoys = data.map((d) => d.yoy_pct).filter((v): v is number => v != null);
  const yoyMax = yoys.length ? Math.max(...yoys) : 0;
  const yoyMin = yoys.length ? Math.min(...yoys) : 0;
  const yoySpan = Math.max(yoyMax - yoyMin, 10);
  const leftDomain: [number, number] = [0, Math.ceil(unitsMax * 1.9)];
  const rightDomain: [number, number] = [
    Math.floor(yoyMin - yoySpan * 1.4),
    Math.ceil(yoyMax + yoySpan * 0.3),
  ];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 28, right: 60, bottom: 10, left: 10 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-border"
          strokeOpacity={GRID_STROKE_OPACITY}
        />
        <XAxis dataKey="period_label" className="text-sm" tick={{ fontSize: 14 }} />
        <YAxis
          yAxisId="left"
          tickFormatter={fmtUnitsTick}
          className="text-sm"
          width={60}
          domain={leftDomain}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={(v) => `${v}%`}
          className="text-sm"
          width={50}
          domain={rightDomain}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          contentStyle={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            fontSize: '14px',
          }}
          formatter={(value, name) => {
            if (name === 'YoY') return [fmtYoy(value), 'YoY'];
            return [`${Number(value ?? 0).toLocaleString('ko-KR')} ${unitLabel}`, '생산'];
          }}
        />
        <Legend
          layout="horizontal"
          verticalAlign="top"
          align="center"
          wrapperStyle={{ fontSize: '14px', paddingBottom: 16 }}
          itemSorter={null}
        />
        <Bar
          yAxisId="left"
          dataKey="units"
          name="생산"
          fill={color}
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
        >
          <LabelList
            dataKey="units"
            position="top"
            formatter={fmtBarLabel}
            style={DATA_LABEL_STYLE}
          />
        </Bar>
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="yoy_pct"
          name="YoY"
          stroke="#dc2626"
          strokeWidth={2}
          dot={{ r: 3, fill: '#dc2626' }}
          isAnimationActive={false}
        >
          <LabelList
            dataKey="yoy_pct"
            position="top"
            offset={10}
            formatter={fmtYoyLabel}
            style={{ fill: '#dc2626', fontSize: 12, fontWeight: 700 }}
          />
        </Line>
      </ComposedChart>
    </ResponsiveContainer>
  );
}
