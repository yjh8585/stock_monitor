import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { ProductTab } from '@/lib/sourcing/source';
import { REGIONS, type Region } from '@/lib/sourcing/types';

/** 지금 화면의 거르기 상태 — 탭 링크는 이 중 한 칸만 바꾼다. */
export interface SupplierFilterState {
  product: string;
  region: Region | null;
  group: number | null;
}

interface Props {
  state: SupplierFilterState;
  products: ProductTab[];
  groups: { id: number; name_ko: string }[];
  /** 품목군으로 거른 뒤의 지역별 건수(합 = 전체). */
  regionCounts: Record<Region, number>;
  total: number;
}

function hrefOf(s: SupplierFilterState): string {
  const q = new URLSearchParams({ product: s.product });
  if (s.region) q.set('region', s.region);
  if (s.group != null) q.set('group', String(s.group));
  return `/oem/suppliers?${q.toString()}`;
}

/** 탭 한 줄 — OemTabs·CustomersTabs 와 같은 모양. */
function TabRow({
  label,
  items,
}: {
  label: string;
  items: { key: string; label: string; href: string; active: boolean }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-xs text-muted-foreground">{label}</span>
      <nav className="flex flex-wrap items-center gap-1" aria-label={label}>
        {items.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.active ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap',
              t.active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** 제품 · 지역(건수) · 품목군 탭 — 링크만 바꾸므로 server 컴포넌트. */
export default function SupplierFilters({ state, products, groups, regionCounts, total }: Props) {
  return (
    <div className="space-y-1.5">
      <TabRow
        label="제품"
        // 품목군 id 는 제품마다 다르다 — 제품을 바꾸면 group 을 지운다.
        items={products.map((p) => ({
          key: p.slug,
          label: p.name_ko,
          href: hrefOf({ ...state, product: p.slug, group: null }),
          active: p.slug === state.product,
        }))}
      />
      <TabRow
        label="지역"
        items={[
          {
            key: '전체',
            label: `전체 ${total.toLocaleString('ko-KR')}`,
            href: hrefOf({ ...state, region: null }),
            active: state.region === null,
          },
          ...REGIONS.map((r) => ({
            key: r,
            label: `${r} ${regionCounts[r].toLocaleString('ko-KR')}`,
            href: hrefOf({ ...state, region: r }),
            active: state.region === r,
          })),
        ]}
      />
      {groups.length > 0 && (
        <TabRow
          label="품목군"
          items={[
            {
              key: '전체',
              label: '전체',
              href: hrefOf({ ...state, group: null }),
              active: state.group === null,
            },
            ...groups.map((g) => ({
              key: String(g.id),
              label: g.name_ko,
              href: hrefOf({ ...state, group: g.id }),
              active: state.group === g.id,
            })),
          ]}
        />
      )}
    </div>
  );
}
