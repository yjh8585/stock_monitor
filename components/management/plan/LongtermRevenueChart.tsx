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
import { ChartSection } from './_selectors';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MGMT_BAR_COLORS } from '@/components/charts/palette';
import { LegendRow } from '@/components/charts/ChartLegend';
import { TOOLTIP_CONTENT_STYLE } from '@/components/charts/chartTheme';
import {
  GRID_STROKE_OPACITY,
  MGMT_DATA_LABEL_STYLE,
  Y_AXIS_PADDED_DOMAIN,
} from '@/components/oem-companies/common/chartStyle';
import { useHiddenSeries } from '@/components/oem-companies/common/useHiddenSeries';
import { useChartHeight } from '@/lib/useChartHeight';
import { useIsMobile } from '@/lib/useIsMobile';
import {
  activeSeries,
  buildLongtermPoints,
  fxNote,
  listBases,
  LONGTERM_SERIES,
  type LongtermRow,
} from '@/lib/plan/longterm';

const TITLE = '1. 중장기 매출 전망';

/** 처음 화면에 켜둘 계열. 나머지는 범례 클릭으로 켠다. */
const DEFAULT_VISIBLE = '한세 전망';
const INITIAL_HIDDEN = LONGTERM_SERIES.filter((s) => s !== DEFAULT_VISIBLE);

/** 억원 정수 + 천단위 콤마. (PlanAchievementChart의 fmt와 동일 표기 규칙) */
function fmt(n: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
}

/**
 * 차트 1 — 중장기 매출 전망 (2027~2031, 억원).
 *
 * DB(`value_mwon`)는 엑셀 원본인 백만원이고, 억원 환산은 buildLongtermPoints()가 한다.
 *
 * 데이터 기준(2026.1Q/2026.2Q)을 드롭다운으로 전환한다. 값이 전부 없는 계열은
 * activeSeries()에서 탈락하므로 2026.1Q에서는 '고객 EDI 100%' 막대·범례가 나타나지 않는다.
 */
export default function LongtermRevenueChart({ rows }: { rows: LongtermRow[] }) {
  const bases = useMemo(() => listBases(rows), [rows]);
  const [basis, setBasis] = useState<string>(() => bases[0]?.key ?? '');
  const points = useMemo(() => buildLongtermPoints(rows, basis), [rows, basis]);
  const series = useMemo(() => activeSeries(rows, basis), [rows, basis]);
  const note = useMemo(() => fxNote(rows, basis), [rows, basis]);
  const { isHidden, toggle, hidden } = useHiddenSeries(INITIAL_HIDDEN);
  const h = useChartHeight(300, 360, 420);
  const isMobile = useIsMobile();

  if (bases.length === 0) {
    return (
      <ChartSection title={TITLE} unit="억원">
        <p className="py-12 text-center text-sm text-muted-foreground">데이터가 없습니다.</p>
      </ChartSection>
    );
  }

  return (
    <ChartSection
      title={TITLE}
      unit="억원"
      controls={
        <Select value={basis} onValueChange={(v) => v != null && setBasis(String(v))}>
          <SelectTrigger className="h-8 w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {bases.map((b) => (
              <SelectItem key={b.key} value={b.key}>
                {b.key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {note ? <p className="mb-2 text-sm text-muted-foreground">{note}</p> : null}
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={points} margin={{ top: 28, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            className="stroke-border"
            strokeOpacity={GRID_STROKE_OPACITY}
            vertical={false}
          />
          <XAxis dataKey="year" tick={{ fontSize: 14 }} />
          <YAxis
            tickFormatter={(v: number) => fmt(v)}
            tick={{ fontSize: 14 }}
            width={70}
            domain={Y_AXIS_PADDED_DOMAIN}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)' }}
            contentStyle={TOOLTIP_CONTENT_STYLE}
            formatter={(value: unknown) => (typeof value === 'number' ? fmt(value) : '—')}
          />
          {/* LegendRow로 순서·토글을 직접 통제한다 — recharts 기본 범례는 데이터 키 순서
              (= source.ts의 series 가나다 정렬)를 따라가 막대 왼→오와 어긋난다(chart-guide §4-F). */}
          <Legend
            verticalAlign="top"
            wrapperStyle={{ paddingBottom: 8 }}
            content={() => (
              <LegendRow
                items={series.map((s, i) => ({
                  key: s,
                  label: s,
                  shape: 'rect' as const,
                  color: MGMT_BAR_COLORS[i],
                }))}
                hidden={hidden}
                onToggle={toggle}
              />
            )}
          />
          {series.map((s, i) => (
            <Bar
              key={s}
              dataKey={s}
              name={s}
              fill={MGMT_BAR_COLORS[i]}
              radius={[3, 3, 0, 0]}
              hide={isHidden(s)}
            >
              {!isMobile && (
                <LabelList
                  dataKey={s}
                  position="top"
                  formatter={(value: unknown) => (typeof value === 'number' ? fmt(value) : '')}
                  style={MGMT_DATA_LABEL_STYLE}
                />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartSection>
  );
}
