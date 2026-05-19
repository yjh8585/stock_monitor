'use client';

import DimensionSection from './DimensionSection';
import type { PnlEntry } from '@/lib/pnl/types';
import type { EntriesByBasis } from './PnlDashboard';

interface Props {
  annualEntries: PnlEntry[];
  annualByBasis: EntriesByBasis;
}

/** 6. 고객·제품 cross 실적 — 디폴트: (Stellantis NA, VW NA) × HALFSHAFT */
export default function ProductCustomerCross({ annualEntries, annualByBasis }: Props) {
  return (
    <DimensionSection
      title="6. 고객·제품 실적"
      dimensions={[
        { key: 'customer', label: '고객' },
        { key: 'product', label: '제품' },
      ]}
      annualEntries={annualEntries}
      annualByBasis={annualByBasis}
      defaultSelections={{
        customer: ['Stellantis NA', 'VW NA'],
        product: ['HALFSHAFT'],
      }}
    />
  );
}
