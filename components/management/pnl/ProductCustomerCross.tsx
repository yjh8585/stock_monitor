'use client';

import DimensionSection from './DimensionSection';
import type { PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

interface Props {
  annualEntries: PnlEntry[];
  annualByBasis: EntriesByBasis;
}

/** 5. 제품·고객 cross 실적 */
export default function ProductCustomerCross({ annualEntries, annualByBasis }: Props) {
  return (
    <DimensionSection
      title="5. 제품·고객 실적"
      dimensions={[
        { key: 'product', label: '제품' },
        { key: 'customer', label: '고객' },
      ]}
      annualEntries={annualEntries}
      annualByBasis={annualByBasis}
    />
  );
}
