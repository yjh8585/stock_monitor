'use client';

import { memo } from 'react';
import type { SupplyRecord } from '@/lib/types';
import { SUPPLY_FIELD_LABELS, summarizeSupply } from '@/lib/motor/supply';

const MAX_VISIBLE = 3;

const FIELD_STYLE: Record<SupplyRecord['field'], string> = {
  auto: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  robot: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  industrial: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

function chipTitle(r: SupplyRecord): string {
  const parts = [r.customer, r.product, r.as_of].filter(Boolean);
  return `${parts.join(' · ')}${r.source_url ? ' — 원문 열기' : ''}`;
}

/**
 * 모터 탭 「공급 이력」 셀 — 고객명 + 분야 칩. 근거 원문이 있으면 링크.
 * 화면에는 「확인」 등급만 온다(뷰·매퍼가 두 번 거른다).
 */
const SupplyHistoryBadges = memo(function SupplyHistoryBadges({
  records,
}: {
  records: SupplyRecord[];
}) {
  if (!records || records.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const { visible, hidden } = summarizeSupply(records, MAX_VISIBLE);
  const hiddenNames = records
    .slice(MAX_VISIBLE)
    .map((r) => r.customer)
    .join(', ');

  return (
    <div className="flex items-center gap-1 flex-wrap min-w-0">
      {visible.map((r, i) => {
        const chip = (
          <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] leading-tight whitespace-nowrap">
            <span
              className={`rounded px-1 text-[10px] font-medium ${FIELD_STYLE[r.field]}`}
              aria-label={`분야 ${SUPPLY_FIELD_LABELS[r.field]}`}
            >
              {SUPPLY_FIELD_LABELS[r.field]}
            </span>
            {r.customer}
          </span>
        );
        return r.source_url ? (
          <a
            key={`${r.customer}-${i}`}
            href={r.source_url}
            target="_blank"
            rel="noopener noreferrer"
            title={chipTitle(r)}
            className="hover:opacity-80"
          >
            {chip}
          </a>
        ) : (
          <span key={`${r.customer}-${i}`} title={chipTitle(r)}>
            {chip}
          </span>
        );
      })}
      {hidden > 0 && (
        <span className="text-[11px] text-muted-foreground tabular-nums" title={hiddenNames}>
          +{hidden}
        </span>
      )}
    </div>
  );
});

export default SupplyHistoryBadges;
