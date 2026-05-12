'use client';

import { memo, useState } from 'react';
import { CustomerItem } from '@/lib/types';
import { CUSTOMER_LOGOS } from '@/lib/customerLogos';

/** string 또는 {name} 객체 둘 다 처리 — DB normalize 후 string array */
const customerName = (c: CustomerItem | string): string => (typeof c === 'string' ? c : c.name);

interface CustomerLogoProps {
  customer: CustomerItem | string;
}

/** 단일 고객사 로고: SimpleIcons CDN SVG → 실패 시 컬러 배지 폴백 */
function CustomerLogo({ customer }: CustomerLogoProps) {
  const [failed, setFailed] = useState(false);
  const name = customerName(customer);
  const config = CUSTOMER_LOGOS[name];

  const showIcon = config?.iconUrl && !failed;

  if (showIcon) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={config.iconUrl!}
        alt={name}
        width={22}
        height={22}
        className="object-contain shrink-0"
        title={name}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap leading-tight text-white"
      style={{ backgroundColor: config?.color ?? '#666' }}
      title={name}
    >
      {config?.abbr ?? name}
    </span>
  );
}

interface CustomerBadgesProps {
  customers: (CustomerItem | string)[];
}

/** 고객사 로고 목록 (부품사 행에서만 표시) */
const CustomerBadges = memo(function CustomerBadges({ customers }: CustomerBadgesProps) {
  if (!customers || customers.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex items-center gap-1.5 flex-nowrap overflow-hidden min-w-0">
      {customers.map((c, i) => (
        <CustomerLogo key={`${customerName(c)}-${i}`} customer={c} />
      ))}
    </div>
  );
});

export default CustomerBadges;
