'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { FactoryModelMixPoint } from '@/lib/types';

interface Props {
  /** 연도별 사전 가공된 데이터 — key는 'YYYY'. UI에서 연도 선택 시 lookup. */
  dataByYear: Record<string, FactoryModelMixPoint[]>;
  /** 가용 연도 목록 (오름차순). 드롭다운 옵션. */
  availableYears: string[];
  /** 최근 완료 연도 라벨 (예: '2025년') — 카드 제목 기본 표시용. */
  latestYearLabel?: string;
}

const ChartFallback = () => (
  <div className="h-[280px] md:h-[320px] lg:h-[360px] bg-muted/20 animate-pulse rounded" />
);

const InnerChart = dynamic(() => import('./HyundaiFactoryModelMixChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

/** 해외 공장별 차종 mix stacked bar (모든 공장 + 연도 드롭다운, #9). */
export default function HyundaiFactoryModelMixChart({
  dataByYear,
  availableYears,
  latestYearLabel,
}: Props) {
  if (availableYears.length === 0) return null;
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>
          공장별 차종 mix
          {latestYearLabel && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              (기본 {latestYearLabel.replace(/\s*실적\s*$/, '')})
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <InnerChart dataByYear={dataByYear} availableYears={availableYears} />
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
          출처: hyundai.com IR &middot; 해외 공장별 판매 엑셀 &middot; 모든 해외 공장 + 연도 선택
          가능. 데이터 없는 공장·CKD는 자동 제외. 막대 위 합계는 공장 전체 판매량.
        </p>
      </CardContent>
    </Card>
  );
}
