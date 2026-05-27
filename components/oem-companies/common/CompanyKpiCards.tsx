'use client';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CompanyKpiSummary } from '@/lib/types';

interface Props {
  kpi: CompanyKpiSummary;
}

/** YoY % → 색상 클래스 (양수=녹색, 음수=빨강, null=중립). */
function yoyColorClass(value: number | null): string {
  if (value == null) return 'text-muted-foreground';
  if (value > 0) return 'text-emerald-600';
  if (value < 0) return 'text-rose-600';
  return 'text-muted-foreground';
}

/** 부호 포함 YoY % 문자열. null이면 "—". */
function formatYoy(value: number | null): string {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

/** EV 비중 (% 표기). null이면 "—". */
function formatRatio(value: number | null): string {
  if (value == null) return '—';
  return `${value.toFixed(1)}%`;
}

/** 천 단위 콤마 정수 + "대" 단위. */
function formatUnits(value: number | null): string {
  if (value == null) return '—';
  return `${value.toLocaleString('ko-KR')}대`;
}

/**
 * 회사별 KPI 4장:
 *  A. 최근 완료 연도 실적 (전년 대비 YoY)
 *  B. 진행 중 YTD 실적 (전년 동기 대비 YoY)
 *  C. EV 비중 (최근 완료 연도)
 *  D. 최신 데이터 기간
 */
export default function CompanyKpiCards({ kpi }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <KpiCard
        label={kpi.latestYearLabel || '최근 연도 실적'}
        value={formatUnits(kpi.latestYearSales)}
        sub={
          <span>
            <span className="text-muted-foreground">vs {kpi.prevYearLabel || '직전 연도'}: </span>
            <span className={cn('tabular-nums', yoyColorClass(kpi.yoyPct))}>
              {formatYoy(kpi.yoyPct)}
            </span>
          </span>
        }
      />
      <KpiCard
        label={kpi.ytdLabel || 'YTD'}
        value={formatUnits(kpi.ytdCurrent)}
        sub={
          <span>
            <span className="text-muted-foreground">vs {kpi.ytdPrevLabel || '전년 동기'}: </span>
            <span className={cn('tabular-nums', yoyColorClass(kpi.ytdYoyPct))}>
              {formatYoy(kpi.ytdYoyPct)}
            </span>
          </span>
        }
      />
      <KpiCard
        label="EV 비중 (최근 연도)"
        value={formatRatio(kpi.evRatio)}
        sub="EV + PHEV + FCEV / 전체"
      />
      <KpiCard
        label="최신 데이터"
        value={kpi.latestPeriod || '—'}
        valueClassName="text-base font-medium"
        sub="최신 적재 기간"
      />
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  valueClassName?: string;
  sub: React.ReactNode;
}

/** 단일 KPI 카드 — shadcn Card 기반. */
function KpiCard({ label, value, valueClassName, sub }: KpiCardProps) {
  return (
    <Card size="sm" className="gap-2">
      <CardContent className="flex flex-col gap-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn('text-xl font-semibold tabular-nums', valueClassName)}>{value}</div>
        <div className="text-[11px]">{sub}</div>
      </CardContent>
    </Card>
  );
}
