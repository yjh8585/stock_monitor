'use client';

import DimensionSection from './DimensionSection';
import type { PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

interface Props {
  annualEntries: PnlEntry[];
  annualByBasis: EntriesByBasis;
}

/** 4. 부문 실적 — 디폴트: 구동 */
export default function DivisionPerformance({ annualEntries, annualByBasis }: Props) {
  return (
    <DimensionSection
      title="4. 부문 실적"
      dimensions={[{ key: 'division', label: '부문' }]}
      annualEntries={annualEntries}
      annualByBasis={annualByBasis}
      defaultSelections={{ division: ['구동'] }}
    />
  );
}
