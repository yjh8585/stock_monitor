'use client';

import { useState } from 'react';
import { CustomerItem } from '@/lib/types';
import { CUSTOMER_LOGOS } from '@/lib/customerLogos';

interface CustomerLogoProps {
  customer: CustomerItem;
}

/** 단일 고객사 로고: SimpleIcons CDN SVG → 실패 시 컬러 배지 폴백 */
function CustomerLogo({ customer }: CustomerLogoProps) {
  const [failed, setFailed] = useState(false);
  const config = CUSTOMER_LOGOS[customer.name];

  const showIcon = config?.iconUrl && !failed;

  if (showIcon) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={config.iconUrl!}
        alt={customer.name}
        width={22}
        height={22}
        className="object-contain shrink-0"
        title={customer.name}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap leading-tight text-white"
      style={{ backgroundColor: config?.color ?? '#666' }}
      title={customer.name}
    >
      {config?.abbr ?? customer.name}
    </span>
  );
}

interface CustomerBadgesProps {
  customers: CustomerItem[];
}

/** 고객사 로고 목록 (부품사 행에서만 표시) */
export default function CustomerBadges({ customers }: CustomerBadgesProps) {
  if (!customers || customers.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {customers.map((c) => (
        <CustomerLogo key={c.name} customer={c} />
      ))}
    </div>
  );
}
