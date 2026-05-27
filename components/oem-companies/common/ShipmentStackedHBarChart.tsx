'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const ChartFallback = () => (
  <div className="flex h-[320px] w-full items-center justify-center text-xs text-muted-foreground">
    <div className="animate-pulse">차트 로딩 중...</div>
  </div>
);

const Inner = dynamic(() => import('./ShipmentStackedHBarChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

export interface ShipmentStackedRow {
  /** 연도 라벨 ('2024' / '2024.10' 등). */
  period_label: string;
  domestic: number;
  export: number;
  overseas: number;
}

interface Props {
  data: ShipmentStackedRow[];
  title?: string;
  footer?: React.ReactNode;
}

/** 출하량 누적 가로 막대 (내수 / 수출 / 해외) — 사용자 명시 이미지 패턴.
 *  stack 내부에 숫자 + 우측 합계, hover 시 비중 표시. */
export default function ShipmentStackedHBarChart({
  data,
  title = '출하량 추이 (내수/수출/해외)',
  footer,
}: Props) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Inner data={data} />
        {footer && <div className="mt-2 px-1 text-[11px] text-muted-foreground">{footer}</div>}
      </CardContent>
    </Card>
  );
}
