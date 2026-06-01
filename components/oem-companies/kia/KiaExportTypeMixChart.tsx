'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { partialYearNote } from '@/lib/oem-companies/kia/aggregate';
import type { KiaExportTypeMixPoint } from '@/lib/types';

interface Props {
  monthly: KiaExportTypeMixPoint[];
  annual: KiaExportTypeMixPoint[];
  title?: string;
  footer?: React.ReactNode;
}

const ChartFallback = () => (
  <div className="h-[240px] md:h-[320px] bg-muted/20 animate-pulse rounded" />
);

const Inner = dynamic(() => import('./KiaExportTypeMixChartInner'), {
  ssr: false,
  loading: ChartFallback,
});

/** Kia 수출 차종 type mix — 6 카테고리(승용/RV/상용/특장/CKD 일반/CKD 특장) 100% stacked. */
export default function KiaExportTypeMixChart({
  monthly,
  annual,
  title = '수출 차종 Type Mix',
  footer,
}: Props) {
  const note = partialYearNote(annual);
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <CardTitle>{title}</CardTitle>
          {note && (
            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-500">
              {note}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Inner monthly={monthly} annual={annual} />
        {footer && <div className="mt-2 px-1 text-[11px] text-muted-foreground">{footer}</div>}
      </CardContent>
    </Card>
  );
}
