'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
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
import type { CompanyTopModelRow, CompanyTopModelsResult } from '@/lib/types';

/** 2단계 region 옵션 — `dataKoreaShip` 안에서 추가 분류. value='all'은 그대로 dataKoreaShip 사용. */
export interface KoreaShipRegion {
  value: string;
  label: string;
  result: CompanyTopModelsResult;
}

/** 해외 공장 옵션 — 단순 result(전체 region) 또는 region 분기 가능.
 *  - 단순 형태: `factoryOptions['HMI'] = result` (모든 region 합)
 *  - 확장 형태: `factoryOptions['HMI'] = { result, regions: [{value:'내수', ...}, {value:'수출', ...}] }`
 */
export type FactoryOption =
  | CompanyTopModelsResult
  | { result: CompanyTopModelsResult; regions?: KoreaShipRegion[] };

interface Props {
  /** region별 사전 가공된 TOP10 (rows + 회사 전체 합계 totals)
   *  - dataAll: 전체 (한국+해외 공장)
   *  - dataKoreaShip(옵션): 한국 공장 출하 통합 (예: 내수+수출+CKD). 1단계 '국내' 선택 시 2단계 = 전체.
   *  - koreaShipRegions(옵션): '국내' 선택 시 2단계 region 옵션 (내수/수출/CKD 등). 데이터 존재하는 것만.
   *  - allRegions(옵션): 1단계 '전체' 선택 시 2단계 region 옵션 (전체/내수/수출). */
  dataAll: CompanyTopModelsResult;
  dataKoreaShip?: CompanyTopModelsResult;
  koreaShipRegions?: KoreaShipRegion[];
  /** 1단계 '전체' 선택 시 2단계 region 옵션 (사용자 요청 #7). */
  allRegions?: KoreaShipRegion[];
  /**
   *  flatRegions(옵션): 해외 공장 없는 회사용 — 1단계에 region을 직접 추가 (예: KG 모빌리티 전체/내수/수출).
   */
  flatRegions?: KoreaShipRegion[];
  /** 해외 공장 옵션 (값=factory 코드 → 사전 가공된 결과 또는 {result, regions}). 빈 객체면 드롭다운에 표시 안 함. */
  factoryOptions?: Record<string, FactoryOption>;
  title?: string;
  /** 컬럼 헤더 라벨 (예: '2025년'). 미지정 시 기본값. */
  latestPeriodLabel?: string;
  prevPeriodLabel?: string;
  /** 진행 연도 YTD 라벨 (예: '2026 YTD (1~4월)'). 미지정 시 YTD 컬럼 숨김. */
  ytdPeriodLabel?: string;
  /** 분류 드롭다운 hide (retail TopCard 등 단일 그룹 표시용). */
  hideGroupSelect?: boolean;
  /** PT 컬럼 hide (정보 없거나 정규화로 다 통일된 경우). */
  hidePtColumn?: boolean;
  /** 정규화 안내 문구 hide (현대만 적용되므로 다른 회사는 hide). */
  hideUnifiedNote?: boolean;
}

interface GroupEntry {
  value: string;
  label: string;
  /** 기본 result (region '전체' 의 결과) — 2단계 옵션 없을 때 그대로 사용. */
  result: CompanyTopModelsResult;
  /** 2단계 region 옵션이 있을 때 — '국내'/'전체'/공장별 등에서 사용. */
  regions?: KoreaShipRegion[];
}

/** FactoryOption (단순 CompanyTopModelsResult 또는 확장 형태) 정규화 */
function normalizeFactoryOption(opt: FactoryOption): {
  result: CompanyTopModelsResult;
  regions?: KoreaShipRegion[];
} {
  if ('rows' in opt) return { result: opt };
  return { result: opt.result, regions: opt.regions };
}

function yoyColorClass(value: number | null): string {
  if (value == null) return 'text-muted-foreground';
  if (value > 0) return 'text-emerald-600';
  if (value < 0) return 'text-rose-600';
  return 'text-muted-foreground';
}

function formatYoy(value: number | null): string {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function formatUnits(value: number | null | undefined): string {
  if (value == null) return '—';
  return value.toLocaleString('ko-KR');
}

/** TOP N 차종 표 — 2단계 드롭다운(분류 / region).
 *  - 분류: 전체 / 국내(한국 공장) / 해외 공장 코드
 *  - region: 분류='국내'일 때만 표시. (전체/내수/수출/CKD 등 데이터 존재하는 것만) */
export default function CompanyTopModelsTable({
  dataAll,
  dataKoreaShip,
  koreaShipRegions,
  allRegions,
  flatRegions,
  factoryOptions,
  title = '차종 TOP10',
  latestPeriodLabel = '최근 연도',
  prevPeriodLabel = '직전 연도',
  ytdPeriodLabel,
  hideGroupSelect = false,
  hidePtColumn = false,
  hideUnifiedNote = false,
}: Props) {
  const groups = useMemo<GroupEntry[]>(() => {
    const list: GroupEntry[] = [
      {
        value: 'all',
        label: '전체',
        result: dataAll,
        regions: allRegions && allRegions.length > 0 ? allRegions : undefined,
      },
    ];
    // flatRegions: 1단계에 region/brand 옵션을 직접 추가 (해외 공장 없는 회사용 — KG/Stellantis).
    // value는 prefix 없이 그대로 사용 (SelectValue가 value를 표시하는 환경 대응 — Stellantis "region:Jeep" → "Jeep").
    if (flatRegions) {
      for (const r of flatRegions) {
        list.push({ value: r.value, label: r.label, result: r.result });
      }
    }
    if (dataKoreaShip) {
      list.push({
        value: 'koreaShip',
        label: '국내 (한국 공장)',
        result: dataKoreaShip,
        regions: koreaShipRegions && koreaShipRegions.length > 0 ? koreaShipRegions : undefined,
      });
    }
    if (factoryOptions) {
      // 공장 옵션은 가용 데이터 합계 큰 순으로 정렬
      const normalized = Object.entries(factoryOptions).map(([code, opt]) => {
        const { result, regions } = normalizeFactoryOption(opt);
        return { code, result, regions };
      });
      normalized.sort((a, b) => b.result.totals.latestPeriod - a.result.totals.latestPeriod);
      for (const { code, result, regions } of normalized) {
        list.push({
          value: `factory:${code}`,
          label: code,
          result,
          regions: regions && regions.length > 0 ? regions : undefined,
        });
      }
    }
    return list;
  }, [dataAll, dataKoreaShip, koreaShipRegions, allRegions, flatRegions, factoryOptions]);

  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [selectedRegion, setSelectedRegion] = useState<string>('all');

  const currentGroup = groups.find((g) => g.value === selectedGroup) ?? groups[0];
  const regionOptions = currentGroup.regions;
  const hasRegionStage = !!regionOptions && regionOptions.length > 0;

  // 2단계 데이터 = 선택된 region 결과, 없으면 그룹 기본 result
  const current: CompanyTopModelsResult = useMemo(() => {
    if (!hasRegionStage) return currentGroup.result;
    if (selectedRegion === 'all') return currentGroup.result;
    return regionOptions!.find((r) => r.value === selectedRegion)?.result ?? currentGroup.result;
  }, [currentGroup, hasRegionStage, regionOptions, selectedRegion]);

  const data = current.rows;
  const totals = current.totals;
  const showYtd = !!ytdPeriodLabel && data.some((r) => r.ytdSales > 0);

  // TOP10 합계 + 전체 비중
  const sumTopLatest = data.reduce((a, r) => a + r.salesLatestPeriod, 0);
  const sumTopPrev = data.reduce((a, r) => a + r.salesPrevPeriod, 0);
  const sumTopYtd = data.reduce((a, r) => a + r.ytdSales, 0);
  const sumTopYtdPrev = data.reduce((a, r) => a + (r.ytdPrevSales ?? 0), 0);
  const pctLatest = totals.latestPeriod > 0 ? (sumTopLatest / totals.latestPeriod) * 100 : null;
  const pctPrev = totals.prevPeriod > 0 ? (sumTopPrev / totals.prevPeriod) * 100 : null;
  const pctYtd = totals.ytd > 0 ? (sumTopYtd / totals.ytd) * 100 : null;
  const topYoy = sumTopPrev > 0 ? ((sumTopLatest - sumTopPrev) / sumTopPrev) * 100 : null;
  const topYtdYoy = sumTopYtdPrev > 0 ? ((sumTopYtd - sumTopYtdPrev) / sumTopYtdPrev) * 100 : null;
  // 데이터에 YTD YoY 정보가 있으면 컬럼 표시
  const showYtdYoy = showYtd && data.some((r) => r.ytdYoyPct != null);
  // brand 컬럼 모드: 모든 row에 brand 있으면 PT 대신 brand 표시 (Stellantis)
  const showBrandInsteadOfPt = data.length > 0 && data.every((r) => !!r.brand);
  const ptColLabel = showBrandInsteadOfPt ? 'Brand' : 'PT';
  // 자동 hide: brand도 PT도 없으면 컬럼 의미 없음 (정규화로 PT null인 모드)
  const allEmpty = data.length > 0 && data.every((r) => r.resolvedPt == null && !r.brand);
  const showPtCol = !hidePtColumn && !allEmpty;

  // '전체' 모드에서만 차종 통일 안내 (사용자 명시: ALL만 정규화 — domestic/koreaShip 제외).
  const isUnified = currentGroup.value === 'all';

  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{title}</CardTitle>
          {!hideGroupSelect && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs text-muted-foreground">분류</span>
              <Select
                value={selectedGroup}
                onValueChange={(v) => {
                  if (v == null) return;
                  setSelectedGroup(v);
                  setSelectedRegion('all');
                }}
              >
                <SelectTrigger className="h-8 w-[200px]">
                  <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.value} value={g.value}>
                      {g.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasRegionStage && (
                <>
                  <span className="text-xs text-muted-foreground">region</span>
                  <Select
                    value={selectedRegion}
                    onValueChange={(v) => v != null && setSelectedRegion(v)}
                  >
                    <SelectTrigger className="h-8 w-[140px]">
                      <SelectValue placeholder="region" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체</SelectItem>
                      {regionOptions!.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
          )}
        </div>
        {isUnified && !hideUnifiedNote && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            전체 모드에서만 프로그램 코드 기준으로 통일(예: CN7/CN7c/CN7 HEV → CN7). 국내·공장별
            모드는 IR 엑셀 원본 표기 그대로.
          </p>
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
                {showPtCol && <TableHead className="hidden md:table-cell">{ptColLabel}</TableHead>}
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
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span>{row.model}</span>
                      <span className="md:hidden">
                        {showBrandInsteadOfPt && row.brand ? (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                            {row.brand}
                          </span>
                        ) : (
                          <PtBadge pt={row.resolvedPt} />
                        )}
                      </span>
                    </div>
                  </TableCell>
                  {showPtCol && (
                    <TableCell className="hidden md:table-cell">
                      {showBrandInsteadOfPt && row.brand ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                          {row.brand}
                        </span>
                      ) : (
                        <PtBadge pt={row.resolvedPt} />
                      )}
                    </TableCell>
                  )}
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
              {/* TOP10 합계 + 전체 대비 비중 (% 작은 글씨로 inline) */}
              <TableRow className="border-t-2 bg-muted/40 font-semibold">
                <TableCell className="text-muted-foreground">—</TableCell>
                <TableCell>TOP{data.length} 합계</TableCell>
                {showPtCol && <TableCell className="hidden md:table-cell">—</TableCell>}
                {showYtd && (
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {sumTopYtd > 0 ? (
                      <>
                        {formatUnits(sumTopYtd)}
                        {pctYtd != null && (
                          <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                            ({pctYtd.toFixed(1)}%)
                          </span>
                        )}
                      </>
                    ) : (
                      '—'
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
                  {formatUnits(sumTopLatest)}
                  {pctLatest != null && (
                    <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                      ({pctLatest.toFixed(1)}%)
                    </span>
                  )}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">
                  {formatUnits(sumTopPrev)}
                  {pctPrev != null && (
                    <span className="ml-1 text-[11px] font-normal">({pctPrev.toFixed(1)}%)</span>
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

function PtBadge({ pt }: { pt: CompanyTopModelRow['resolvedPt'] }) {
  if (pt == null) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        ?
      </Badge>
    );
  }
  return <Badge variant="secondary">{pt}</Badge>;
}
