'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { HyundaiRetailWholesaleData, HyundaiRetailWholesaleRegionCard } from '@/lib/types';

interface Props {
  /** 기본 데이터 (최근 완료 연도, fallback). */
  data: HyundaiRetailWholesaleData;
  /** 연도별 사전 가공 (#9 드롭다운용). */
  byYear: {
    us: Record<string, HyundaiRetailWholesaleRegionCard>;
    eu: Record<string, HyundaiRetailWholesaleRegionCard>;
  };
  /** US/EU 각 region의 사용 가능 연도 (오름차순). */
  usYears: string[];
  euYears: string[];
}

/** 부호 포함 YoY % 문자열. null=—. */
function formatYoy(v: number | null): string {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

function yoyColor(v: number | null): string {
  if (v == null) return 'text-muted-foreground';
  if (v > 0) return 'text-emerald-600';
  if (v < 0) return 'text-rose-600';
  return 'text-muted-foreground';
}

function formatUnits(v: number): string {
  return `${v.toLocaleString('ko-KR')}대`;
}

function formatPct(v: number | null): string {
  if (v == null) return '—';
  return `${v.toFixed(1)}%`;
}

/** US 또는 EU 한 지역 카드 — 연도 드롭다운 포함 (#9).
 *  page.tsx에서 단독으로 사용할 수 있도록 export (미국/유럽 row 분리 배치 #C8). */
export function HyundaiRetailWholesaleRegionCard({
  region,
  label,
  defaultCard,
  byYear,
  years,
}: {
  region: 'US' | 'EU';
  label: string;
  defaultCard: HyundaiRetailWholesaleRegionCard | null;
  byYear: Record<string, HyundaiRetailWholesaleRegionCard>;
  years: string[];
}) {
  // 기본 선택: 데이터가 있는 가장 최근 연도 (years 마지막)
  const defaultYear = years.length > 0 ? years[years.length - 1] : defaultCard?.latestYear ?? '';
  const [selectedYear, setSelectedYear] = useState<string>(defaultYear);
  const card = useMemo(() => byYear[selectedYear] ?? defaultCard, [byYear, selectedYear, defaultCard]);

  if (!card) {
    return (
      <Card size="sm" className="gap-3">
        <CardHeader className="border-b">
          <CardTitle>{label} — Retail vs Wholesale</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">데이터 없음 (retail 또는 wholesale 결측)</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{label} — Retail vs Wholesale</CardTitle>
          {years.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-xs text-muted-foreground">연도</span>
              <Select value={selectedYear} onValueChange={(v) => v != null && setSelectedYear(v)}>
                <SelectTrigger className="h-8 w-[110px]" aria-label={`${region} 연도 선택`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...years].reverse().map((y) => (
                    <SelectItem key={y} value={y}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label={`${card.latestYear} Retail`} value={formatUnits(card.retailUnits)} />
          <Kpi
            label={`${card.latestYear} Wholesale (IR)`}
            value={formatUnits(card.wholesaleUnits)}
          />
          <Kpi label="Retail / Wholesale" value={formatPct(card.retailOverWholesalePct)} />
          <Kpi
            label={`Retail YoY (vs ${card.prevYear})`}
            value={formatYoy(card.retailYoyPct)}
            valueClassName={yoyColor(card.retailYoyPct)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Kpi({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-lg font-semibold tabular-nums', valueClassName)}>{value}</div>
    </div>
  );
}

/** US/EU retail vs wholesale 비교 — Phase 2C + 연도 드롭다운(#9). 2026 YTD KPI 자동 포함. */
export default function HyundaiRetailWholesaleCard({ data, byYear, usYears, euYears }: Props) {
  // 데이터 없으면 표시 안 함
  if (!data.us && !data.eu && Object.keys(byYear.us).length === 0 && Object.keys(byYear.eu).length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <HyundaiRetailWholesaleRegionCard
        region="US"
        label="미국 (HMA)"
        defaultCard={data.us}
        byYear={byYear.us}
        years={usYears}
      />
      <HyundaiRetailWholesaleRegionCard
        region="EU"
        label="유럽 (HME)"
        defaultCard={data.eu}
        byYear={byYear.eu}
        years={euYears}
      />
    </div>
  );
}
