'use client';

import DimensionSection from './DimensionSection';
import type { PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

interface Props {
  annualEntries: PnlEntry[];
  annualByBasis: EntriesByBasis;
}

/** 3. 고객별 실적 */
export default function CustomerPerformance({ annualEntries, annualByBasis }: Props) {
  return (
    <DimensionSection
      title="3. 고객별 실적"
      dimensions={[{ key: 'customer', label: '고객' }]}
      annualEntries={annualEntries}
      annualByBasis={annualByBasis}
    />
  );
}
