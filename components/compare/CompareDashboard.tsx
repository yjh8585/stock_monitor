'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import CompareCompanySelector from './CompareCompanySelector';
import type { CompanyLine } from './MetricCard';
import {
  COMPARE_METRICS,
  FIXED_PRIMARY_NAME,
  type CompareCompany,
  type FinancialRow,
} from '@/lib/compareMetrics';

// MetricCard는 recharts 의존 — 차트 단위로 청크 분리. 10개 카드가 같은 청크를 공유.
const MetricCard = dynamic(() => import('./MetricCard'), { ssr: false });

interface Props {
  companies: readonly CompareCompany[];
  rowsByCompanyId: Record<string, FinancialRow[]>;
}

const PRIMARY_COLOR = '#ef4444';
const COMPARE_COLORS = ['#3b82f6', '#10b981'];

/** 한세모빌리티(기준, 고정) + 최대 2개 비교사. 10개 지표 카드 그리드. */
export default function CompareDashboard({ companies, rowsByCompanyId }: Props) {
  const primary = companies.find((c) => c.name_kr === FIXED_PRIMARY_NAME);
  const candidates = companies.filter((c) => c.name_kr !== FIXED_PRIMARY_NAME);

  const [compareIds, setCompareIds] = useState<string[]>(() =>
    candidates.slice(0, 2).map((c) => c.id)
  );

  const lineCompanies = useMemo<CompanyLine[]>(() => {
    if (!primary) return [];
    const list: CompanyLine[] = [
      {
        id: primary.id,
        name: primary.name_kr,
        color: PRIMARY_COLOR,
        rows: rowsByCompanyId[primary.id] ?? [],
        highlighted: true,
      },
    ];
    compareIds.forEach((cid, i) => {
      const c = candidates.find((x) => x.id === cid);
      if (!c) return;
      list.push({
        id: c.id,
        name: c.name_kr,
        color: COMPARE_COLORS[i] ?? '#6b7280',
        rows: rowsByCompanyId[c.id] ?? [],
        highlighted: false,
      });
    });
    return list;
  }, [primary, candidates, compareIds, rowsByCompanyId]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {primary && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-sm ring-1 ring-foreground/10">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ background: PRIMARY_COLOR }}
            />
            {primary.name_kr} <span className="text-muted-foreground">(기준)</span>
          </span>
        )}
        <CompareCompanySelector
          candidates={candidates}
          selectedIds={compareIds}
          onChange={setCompareIds}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {COMPARE_METRICS.map((m) => (
          <MetricCard key={m.id} metric={m} companies={lineCompanies} />
        ))}
      </div>
    </div>
  );
}
