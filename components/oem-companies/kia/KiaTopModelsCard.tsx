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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { CompanyTopModelsResult } from '@/lib/types';

type Dataset = 'wholesale' | 'retail';

interface Props {
  /** wholesale TOP10 — plant 키: 'all'/'domestic'/'U.S. Plant'/.../'India Plant' */
  wholesaleByFactory: Record<string, CompanyTopModelsResult>;
  /** retail TOP10 — plant 키: 'all'/'Korea Plants'/'U.S. Plant'/.../'India Plant'/'CKD'/'Special Vehicle'/... */
  retailByPlant: Record<string, CompanyTopModelsResult>;
  /** wholesale dropdown 옵션 (factory 키). default ['all','domestic',5 plants] */
  factoryOptions: string[];
  /** retail dropdown 옵션 (plant 키). default listRetailPlants() */
  retailPlants: string[];
  /** 컬럼 헤더 라벨 — KPI에서 가져옴. */
  latestPeriodLabel?: string;
  prevPeriodLabel?: string;
  ytdPeriodLabel?: string;
  /** 직전연도 부분집계 안내 (예: '2024.10'). undefined면 표시 안 함. */
  prevPeriodPartialNote?: string;
}

/** Plant key 라벨 매핑 (드롭다운 표기 단순화). */
function plantLabel(k: string): string {
  if (k === 'all') return '전체';
  if (k === 'domestic') return '국내 (한국 공장)';
  if (k === 'Korea Plants') return '국내 (한국 공장)';
  return k;
}

function yoyColorClass(v: number | null): string {
  if (v == null) return 'text-muted-foreground';
  if (v > 0) return 'text-emerald-600';
  if (v < 0) return 'text-rose-600';
  return 'text-muted-foreground';
}

function formatYoy(v: number | null): string {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

function formatUnits(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('ko-KR');
}

/** 기아 TOP10 통합 카드 — 출하량(wholesale) ↔ 판매량(retail) 토글 + plant 드롭다운.
 *  컬럼: 순위 / 차종 / 2026 YTD / YoY (YTD) / 2025 / 2024 / YoY (2025).
 *  retail에 wholesale plant 매핑이 없는 경우 ('CKD' 등) 자동 제외. */
export default function KiaTopModelsCard({
  wholesaleByFactory,
  retailByPlant,
  factoryOptions,
  retailPlants,
  latestPeriodLabel = '최근 연도',
  prevPeriodLabel = '직전 연도',
  ytdPeriodLabel,
  prevPeriodPartialNote,
}: Props) {
  const [dataset, setDataset] = useState<Dataset>('wholesale');
  const [plant, setPlant] = useState<string>('all');

  // 데이터셋 전환 시 plant 키 호환 매핑.
  const currentPlants = useMemo<string[]>(() => {
    if (dataset === 'wholesale') return factoryOptions;
    // retail: 'all' + retailPlants. 사용자 명시 — '전체 / 국내 / 해외 5'에 맞춰
    // 'Korea Plants'를 'domestic' 위치에 두려면 정렬 (CKD/Special Vehicle/HMGICs는 마지막).
    const primary = [
      'all',
      'Korea Plants',
      'U.S. Plant',
      'China Plants',
      'Slovakia Plant',
      'Mexico Plant',
      'India Plant',
    ];
    const present = primary.filter((p) => p === 'all' || retailPlants.includes(p));
    const extras = retailPlants.filter((p) => !primary.includes(p));
    return [...present, ...extras];
  }, [dataset, factoryOptions, retailPlants]);

  // 데이터셋 전환 시 plant 매핑 (domestic ↔ Korea Plants).
  const effectivePlant = useMemo(() => {
    if (dataset === 'wholesale') return plant;
    // retail에선 'domestic'을 'Korea Plants'로 매핑.
    if (plant === 'domestic') return 'Korea Plants';
    return plant;
  }, [dataset, plant]);

  const sourceMap = dataset === 'wholesale' ? wholesaleByFactory : retailByPlant;
  const current: CompanyTopModelsResult = sourceMap[effectivePlant] ??
    sourceMap.all ?? { rows: [], totals: { latestPeriod: 0, prevPeriod: 0, ytd: 0 } };
  const data = current.rows;
  const totals = current.totals;
  const showYtd = !!ytdPeriodLabel && data.some((r) => r.ytdSales > 0);
  const showYtdYoy = showYtd && data.some((r) => r.ytdYoyPct != null);

  const sumLatest = data.reduce((a, r) => a + r.salesLatestPeriod, 0);
  const sumPrev = data.reduce((a, r) => a + r.salesPrevPeriod, 0);
  const sumYtd = data.reduce((a, r) => a + r.ytdSales, 0);
  const sumYtdPrev = data.reduce((a, r) => a + (r.ytdPrevSales ?? 0), 0);
  const pctLatest = totals.latestPeriod > 0 ? (sumLatest / totals.latestPeriod) * 100 : null;
  const pctPrev = totals.prevPeriod > 0 ? (sumPrev / totals.prevPeriod) * 100 : null;
  const pctYtd = totals.ytd > 0 ? (sumYtd / totals.ytd) * 100 : null;
  const topYoy = sumPrev > 0 ? ((sumLatest - sumPrev) / sumPrev) * 100 : null;
  const topYtdYoy = sumYtdPrev > 0 ? ((sumYtd - sumYtdPrev) / sumYtdPrev) * 100 : null;

  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            차종 TOP10 ({dataset === 'wholesale' ? '도매 출하 wholesale' : '소매 판매 retail'})
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <div
              role="tablist"
              aria-label="데이터셋 토글"
              className="inline-flex items-center gap-1 rounded-md border p-0.5"
            >
              {(['wholesale', 'retail'] as const).map((d) => (
                <button
                  key={d}
                  role="tab"
                  type="button"
                  aria-selected={dataset === d}
                  onClick={() => setDataset(d)}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs transition-colors',
                    dataset === d
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  {d === 'wholesale' ? '출하량' : '판매량'}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">분류</span>
            <Select value={plant} onValueChange={(v) => v != null && setPlant(v)}>
              <SelectTrigger className="h-8 w-[180px]">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                {currentPlants.map((p) => (
                  <SelectItem key={p} value={p}>
                    {plantLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {prevPeriodPartialNote && (
          <div className="mt-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-500">
            {prevPeriodPartialNote}
          </div>
        )}
      </CardHeader>
      <CardContent className="px-0 md:px-4">
        {data.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            데이터가 없습니다.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px] text-muted-foreground">순위</TableHead>
                <TableHead>차종</TableHead>
                {showYtd && (
                  <TableHead className="hidden text-right md:table-cell">
                    {ytdPeriodLabel}
                  </TableHead>
                )}
                {showYtdYoy && (
                  <TableHead className="hidden text-right md:table-cell">YoY (YTD)</TableHead>
                )}
                <TableHead className="text-right">{latestPeriodLabel}</TableHead>
                <TableHead className="hidden text-right md:table-cell">{prevPeriodLabel}</TableHead>
                <TableHead className="text-right">YoY</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row, idx) => (
                <TableRow key={row.model}>
                  <TableCell className="text-muted-foreground tabular-nums">{idx + 1}</TableCell>
                  <TableCell className="font-medium">{row.model}</TableCell>
                  {showYtd && (
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {row.ytdSales > 0 ? formatUnits(row.ytdSales) : '—'}
                    </TableCell>
                  )}
                  {showYtdYoy && (
                    <TableCell
                      className={cn(
                        'hidden text-right tabular-nums md:table-cell',
                        yoyColorClass(row.ytdYoyPct ?? null)
                      )}
                    >
                      {formatYoy(row.ytdYoyPct ?? null)}
                    </TableCell>
                  )}
                  <TableCell className="text-right tabular-nums">
                    {formatUnits(row.salesLatestPeriod)}
                  </TableCell>
                  <TableCell className="hidden text-right text-muted-foreground tabular-nums md:table-cell">
                    {formatUnits(row.salesPrevPeriod)}
                  </TableCell>
                  <TableCell className={cn('text-right tabular-nums', yoyColorClass(row.yoyPct))}>
                    {formatYoy(row.yoyPct)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 bg-muted/40 font-semibold">
                <TableCell className="text-muted-foreground">—</TableCell>
                <TableCell>TOP{data.length} 합계</TableCell>
                {showYtd && (
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {formatUnits(sumYtd)}
                    {pctYtd != null && (
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                        ({pctYtd.toFixed(0)}%)
                      </span>
                    )}
                  </TableCell>
                )}
                {showYtdYoy && (
                  <TableCell
                    className={cn(
                      'hidden text-right tabular-nums md:table-cell',
                      yoyColorClass(topYtdYoy)
                    )}
                  >
                    {formatYoy(topYtdYoy)}
                  </TableCell>
                )}
                <TableCell className="text-right tabular-nums">
                  {formatUnits(sumLatest)}
                  {pctLatest != null && (
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      ({pctLatest.toFixed(0)}%)
                    </span>
                  )}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  {formatUnits(sumPrev)}
                  {pctPrev != null && (
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      ({pctPrev.toFixed(0)}%)
                    </span>
                  )}
                </TableCell>
                <TableCell className={cn('text-right tabular-nums', yoyColorClass(topYoy))}>
                  {formatYoy(topYoy)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
