'use client';

import DimensionSection from './DimensionSection';
import type { PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

interface Props {
  annualEntries: PnlEntry[];
  annualByBasis: EntriesByBasis;
}

/** 6. 제품별 실적 — 디폴트: HALFSHAFT */
export default function ProductPerformance({ annualEntries, annualByBasis }: Props) {
  return (
    <DimensionSection
      title="6. 제품별 실적"
      dimensions={[{ key: 'product', label: '제품' }]}
      annualEntries={annualEntries}
      annualByBasis={annualByBasis}
      defaultSelections={{ product: ['HALFSHAFT'] }}
    />
  );
}
