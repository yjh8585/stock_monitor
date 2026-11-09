// 서버 컴포넌트 — 'use client' 면 화면에 안 쓰는 사외비 칸(share.topProducts)까지 RSC payload 로 브라우저에 실린다.
import Link from 'next/link';
import { cn } from '@/lib/utils';
// 타입만 쓰므로 import type — 값 import 가 아니라 조회 모듈('use cache' 함수)을 끌어오지 않는다.
import type { CustomerOverviewIr, CustomerOverviewRow } from '@/lib/customers/source';
// 지시어 없는 lib — 서버 컴포넌트가 값으로 불러도 된다('use client' 파일의 함수는 안 된다).
import { nextEarnings } from '@/lib/customers/ir';
import { pctClass, pctText } from '@/lib/customers/format';

const TD = 'px-3 py-2 whitespace-nowrap';
const NUM = `${TD} text-right tabular-nums`;

interface Props {
  rows: (CustomerOverviewRow & { ir: CustomerOverviewIr })[];
  windowLabel: string;
  /** 서울 날짜 YYYY-MM-DD(todaySeoul) — 「다음 실적」 고르기 기준. */
  today: string;
}

/** 「최근 가이던스 변경」 칸 — 상향 ▲ 초록 · 하향 ▼ 빨강 · 그 FY 가 이후 철회됐으면 「철회됨」. */
function GuidanceChangeCell({ c }: { c: CustomerOverviewIr['guidanceChange'] }) {
  if (!c) return <span className="text-muted-foreground">—</span>;
  const up = c.direction === 'raised';
  return (
    <span title={`${c.period} · ${c.published_at}`}>
      {c.withdrawn_at ? (
        <span className="text-muted-foreground">철회됨</span>
      ) : (
        <span className={up ? 'text-emerald-600' : 'text-rose-600'}>{up ? '▲' : '▼'}</span>
      )}{' '}
      {c.metric_label} <span className="text-xs text-muted-foreground">{c.published_at}</span>
    </span>
  );
}

/** 고객사 요약 표 — 우리 매출 비중·주가 수익률·최근 분기 실적(현지 통화)·가이던스 변경·다음 실적. 행 클릭 없이 회사명 링크만. */
export default function CustomersOverviewTable({ rows, windowLabel, today }: Props) {
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
            <th className={`${TD} text-left`}>최근 가이던스 변경</th>
            <th className={`${TD} text-left`}>다음 실적</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const q = r.latestQuarter;
            const next = nextEarnings(r.ir.earningsDates, today);
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
                <td className={TD}>
                  <GuidanceChangeCell c={r.ir.guidanceChange} />
                </td>
                <td className={cn(TD, 'tabular-nums', next?.estimated && 'text-muted-foreground')}>
                  {next ? (
                    <span title={next.estimated ? '추정 — 작년 같은 분기 발표일 + 1년' : undefined}>
                      {next.date} <span className="text-xs">{next.period}</span>
                      {next.estimated && <span className="ml-1 text-xs">(추정)</span>}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
