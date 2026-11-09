'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
// server-only 모듈이라 타입만 가져온다(값 import 면 클라이언트 번들로 새어 빌드가 깨진다).
import type { CustomerOverviewRow } from '@/lib/customers/source';
import { pctClass, pctText } from '@/lib/customers/format';

const TD = 'px-3 py-2 whitespace-nowrap';
const NUM = `${TD} text-right tabular-nums`;

interface Props {
  rows: CustomerOverviewRow[];
  windowLabel: string;
}

/** 고객사 요약 표 — 우리 매출 비중·주가 수익률·최근 분기 실적(현지 통화). 행 클릭 없이 회사명 링크만. */
export default function CustomersOverviewTable({ rows, windowLabel }: Props) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className={`${TD} text-left`}>고객사</th>
            <th className={`${TD} text-right`}>
              우리 매출 비중
              {windowLabel && <span className="block font-normal">{windowLabel} · 연결</span>}
            </th>
            <th className={`${TD} text-right`}>종가</th>
            <th className={`${TD} text-right`}>1개월</th>
            <th className={`${TD} text-right`}>연초 대비</th>
            <th className={`${TD} text-right`}>최근 분기</th>
            <th className={`${TD} text-right`}>매출 YoY</th>
            <th className={`${TD} text-right`}>영업이익률</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const q = r.latestQuarter;
            return (
              <tr key={r.company_id} className="border-t border-border hover:bg-muted/30">
                <td className={TD}>
                  <Link href={`/customers/${r.slug}`} className="font-medium hover:underline">
                    {r.name_kr}
                  </Link>
                  {r.ticker && (
                    <span className="ml-2 text-xs text-muted-foreground">{r.ticker}</span>
                  )}
                </td>
                <td className={NUM}>
                  {r.share.sharePct == null ? (
                    <span className="text-muted-foreground">해당 없음</span>
                  ) : (
                    <span
                      title={
                        r.share_group
                          ? `합산: ${[r.name_kr, ...r.share_group_peers].join('·')}`
                          : undefined
                      }
                    >
                      {r.share.sharePct.toFixed(1)}%
                      {r.share_group && (
                        <span className="ml-1 rounded bg-muted px-1 text-[11px] text-muted-foreground">
                          합산
                        </span>
                      )}
                    </span>
                  )}
                </td>
                <td className={NUM}>
                  {r.price.lastClose == null
                    ? '—'
                    : `${r.price.lastClose.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${r.currency}`}
                </td>
                <td className={cn(NUM, pctClass(r.price.return1mPct))}>
                  {pctText(r.price.return1mPct)}
                </td>
                <td className={cn(NUM, pctClass(r.price.returnYtdPct))}>
                  {pctText(r.price.returnYtdPct)}
                </td>
                <td className={NUM}>{q?.period_label ?? '—'}</td>
                <td className={cn(NUM, pctClass(q?.revenue_yoy_pct ?? null))}>
                  {pctText(q?.revenue_yoy_pct ?? null)}
                </td>
                <td className={cn(NUM, pctClass(q?.operating_margin_pct ?? null))}>
                  {pctText(q?.operating_margin_pct ?? null, false)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
