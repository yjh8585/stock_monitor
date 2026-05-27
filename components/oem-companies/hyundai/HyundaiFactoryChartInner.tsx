'use client';

import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { OEM_COLORS } from '@/components/oem/helpers';
import { useChartHeight } from '@/lib/useChartHeight';
import type { FactoryMixPoint } from '@/lib/types';
import { DATA_LABEL_STYLE, GRID_STROKE_OPACITY, Y_AXIS_PADDED_DOMAIN } from '../common/chartStyle';
import { useHiddenSeries } from '../common/useHiddenSeries';

interface Props {
  monthly: FactoryMixPoint[];
  annual: FactoryMixPoint[];
  /** 월간 모드에서는 합계 라벨 hide (가독성). */
  hideLabelsOnMonth?: boolean;
}

type ViewMode = 'year' | 'month';

/** 판매량 단위(만/M) 자동 변환. */
function fmtUnitsTick(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

/** 막대 위 합계 라벨 — 큰 수는 만/M (#6 13px bold). */
function fmtTotalLabel(value: unknown): string {
  if (value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return n.toLocaleString('ko-KR');
}

/** 현대차 해외 공장 코드 → 위치(국가/도시) 매핑. 차트 footnote 표시용.
 *  출처: 현대차 IR 공시 + 공식 사이트 (2026-05 기준). 코드는 약어, 위치 변경 시 갱신. */
const FACTORY_LOCATIONS: Record<string, string> = {
  HMI: '인도 첸나이',
  HMMA: '미국 앨라배마',
  HMGMA: '미국 조지아 (Metaplant)',
  BHMC: '중국 베이징',
  HMMC: '체코 노쇼비체',
  HMB: '브라질 피라시카바',
  HMMR: '러시아 상트페테르부르크',
  HMMI: '인도네시아 카라왕',
  HAOS: '터키 이즈미트',
  HTBC: '중국 쓰촨 (상용차)',
  KMX: '멕시코',
  Vietnam: '베트남 (Thanh Cong)',
  Russia: '러시아',
  Singapore: '싱가포르 (HMGICS)',
  Others: '기타',
  CKD: 'CKD (현지 조립)',
};

/** factory 키들을 전체 기간 합계 큰 순으로 정렬 — 색상·stack 순서 안정화. */
function sortFactoriesByTotal(data: FactoryMixPoint[]): string[] {
  const totals = new Map<string, number>();
  for (const p of data) {
    for (const [name, v] of Object.entries(p.factories)) {
      totals.set(name, (totals.get(name) ?? 0) + v);
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

/** 해외 공장별 stacked bar — 합계 line 없음. Tooltip에 비중(%) 표시.
 *  Legend 클릭으로 시리즈 hide/show 토글 (#1). */
export default function HyundaiFactoryChartInner({
  monthly,
  annual,
  hideLabelsOnMonth = true,
}: Props) {
  const [mode, setMode] = useState<ViewMode>('year');
  const height = useChartHeight(240, 280, 320);
  const { isHidden, legendProps } = useHiddenSeries();
  const showLabels = !(hideLabelsOnMonth && mode === 'month');

  const data = mode === 'year' ? annual : monthly;

  /** factory 키(판매량 큰 순) + recharts 친화 row({period_label, total, [factory]: v, _marker: 0}).
   *  - 모든 row에 모든 factory key 0 초기화
   *  - 추가로 `_marker`=0 컬럼 (invisible Bar가 사용) — stack 맨 위 LabelList 보장
   *    (마지막 stack의 Bar가 일부 row에서 0이면 Bar 자체가 렌더되지 않아 LabelList 누락되는 문제 근본 해결). */
  const { factories, chartData } = useMemo(() => {
    const names = sortFactoriesByTotal(data);
    const rows = data.map((d) => {
      const row: Record<string, string | number | boolean> = {
        period_label: d.period_label,
        total: d.total,
        _marker: 1,
      };
      for (const f of names) {
        row[f] = d.factories[f] ?? 0;
      }
      return row;
    });
    return { factories: names, chartData: rows };
  }, [data]);

  return (
    <div>
      <div
        role="tablist"
        aria-label="기간 단위 선택"
        className="flex items-center gap-2 mb-3 text-sm"
      >
        <button
          role="tab"
          type="button"
          aria-selected={mode === 'year'}
          onClick={() => setMode('year')}
          className={`px-3 py-1 rounded-md border transition-colors ${
            mode === 'year'
              ? 'border-foreground bg-foreground text-background'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          연간
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={mode === 'month'}
          onClick={() => setMode('month')}
          className={`px-3 py-1 rounded-md border transition-colors ${
            mode === 'month'
              ? 'border-foreground bg-foreground text-background'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          월간
        </button>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={{ top: 32, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            className="stroke-border"
            strokeOpacity={GRID_STROKE_OPACITY}
            vertical={mode === 'month'}
          />
          <XAxis
            dataKey="period_label"
            className="text-sm"
            tick={{ fontSize: 14 }}
            interval="preserveStartEnd"
            minTickGap={20}
          />
          <YAxis
            tickFormatter={fmtUnitsTick}
            className="text-sm"
            width={60}
            domain={Y_AXIS_PADDED_DOMAIN}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)' }}
            contentStyle={{
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              fontSize: '16px',
            }}
            formatter={(value, name, item) => {
              const v = Number(value ?? 0);
              const total = Number((item?.payload as { total?: number } | undefined)?.total ?? 0);
              const pct = total > 0 ? (v / total) * 100 : 0;
              return [`${v.toLocaleString('ko-KR')}대 (${pct.toFixed(1)}%)`, String(name)];
            }}
            itemSorter={(item) => -(item.value as number)}
          />
          <Legend
            layout="horizontal"
            verticalAlign="top"
            align="center"
            wrapperStyle={{ fontSize: '16px', paddingBottom: 8 }}
            itemSorter={null}
            {...legendProps}
          />
          {factories.map((f, i) => {
            const isLast = i === factories.length - 1;
            return (
              <Bar
                key={f}
                dataKey={f}
                name={f}
                stackId="factory"
                fill={OEM_COLORS[i % OEM_COLORS.length]}
                isAnimationActive={false}
                radius={isLast ? [3, 3, 0, 0] : undefined}
                hide={isHidden(f)}
              />
            );
          })}
          {/* invisible marker Bar — height 0이지만 stack 맨 위에 항상 렌더 → LabelList 보장.
              월간 모드에서는 hide. */}
          {showLabels && (
            <Bar
              dataKey="_marker"
              stackId="factory"
              fill="transparent"
              isAnimationActive={false}
              legendType="none"
            >
              <LabelList
                dataKey="total"
                position="top"
                formatter={fmtTotalLabel}
                style={DATA_LABEL_STYLE}
              />
            </Bar>
          )}
        </BarChart>
      </ResponsiveContainer>

      {/* 공장 코드 → 위치 주석 (legend 약자가 어느 나라/지역인지 표시) */}
      <div className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-medium">공장 위치:</span>{' '}
        {factories
          .map((f) => {
            const loc = FACTORY_LOCATIONS[f] ?? '미상';
            return (
              <span key={f}>
                <span className="font-medium text-foreground">{f}</span>={loc}
              </span>
            );
          })
          .reduce<React.ReactNode[]>((acc, node, i) => {
            if (i > 0) acc.push(<span key={`sep-${i}`}> · </span>);
            acc.push(node);
            return acc;
          }, [])}
      </div>
    </div>
  );
}
