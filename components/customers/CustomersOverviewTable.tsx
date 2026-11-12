// 서버 컴포넌트 — 'use client' 면 화면에 안 쓰는 사외비 칸(share.topProducts)까지 RSC payload 로 브라우저에 실린다.
import Link from 'next/link';
import { cn } from '@/lib/utils';
import HighlightRow from './HighlightRow';
// 타입만 쓰므로 import type — 값 import 가 아니라 조회 모듈('use cache' 함수)을 끌어오지 않는다.
import type { CustomerOverviewIr, CustomerOverviewTableRow } from '@/lib/customers/source';
// 지시어 없는 lib — 서버 컴포넌트가 값으로 불러도 된다('use client' 파일의 함수는 안 된다).
import { nextEarnings } from '@/lib/customers/ir';
import {
  docTypeLabel,
  guidanceChangeText,
  pctClass,
  pctText,
  periodText,
} from '@/lib/customers/format';
import { krwText } from '@/lib/customers/krw';
import { SIGNAL_LABEL, type SignalColor } from '@/lib/customers/signals';

const TD = 'px-3 py-2 whitespace-nowrap';
const NUM = `${TD} text-right tabular-nums`;

interface Props {
  rows: CustomerOverviewTableRow[];
  windowLabel: string;
  /** 서울 날짜 YYYY-MM-DD(todaySeoul) — 「다음 실적」 고르기 기준. */
  today: string;
}

/**
 * 「최근 가이던스 변경」 칸 — 「인도 대수 전망 하향: 이전 → 새 값 (날짜 문서종류)」(2026-11-11 사용자 지시 · 한국어로 읽히게).
 * 상향 ▲ 초록 · 하향 ▼ 빨강 · 그 FY 가 이후 철회됐으면 「철회됨」. 회사 원문 지표 이름은 툴팁에.
 */
/** 화살표 색 = 그 카드의 신호등 색(모양 ▲▼ 은 방향) — 상세 카드 CustomerGuidanceCards 의 SIGNAL 과 같은 색 계열. */
const SIGNAL_TEXT: Record<SignalColor, string> = {
  red: 'text-rose-600',
  yellow: 'text-amber-500',
  green: 'text-emerald-600',
  gray: 'text-muted-foreground',
};

function GuidanceChangeCell({ ir }: { ir: CustomerOverviewIr }) {
  const c = ir.guidanceChange;
  if (!c) return <span className="text-muted-foreground">—</span>;
  const up = c.direction === 'raised';
  const sig = ir.guidanceSignal ?? 'gray';
  return (
    <span
      className="block min-w-[260px] max-w-[380px] whitespace-normal"
      title={`${c.period} · 원문 지표: ${c.metric_label}`}
    >
      {c.withdrawn_at ? (
        <span className="text-muted-foreground">철회됨 · </span>
      ) : (
        <span className={SIGNAL_TEXT[sig]} title={`카드 신호: ${SIGNAL_LABEL[sig]}`}>
          {up ? '▲' : '▼'}{' '}
        </span>
      )}
      {c.period.replace(/^FY/, '')}년 {guidanceChangeText(c)}{' '}
      <span className="text-xs text-muted-foreground">
        ({c.published_at}
        {c.doc_type ? ` ${docTypeLabel(c.doc_type)}` : ''})
      </span>
    </span>
  );
}

/** 「최근 중요 문서」 칸 — 요약 중요도 상 · 30일 안 · 상세 문서 요약 카드(#doc-<id>)로 가는 링크. 이유는 툴팁. */
function RecentDocCell({ ir, slug }: { ir: CustomerOverviewIr; slug: string }) {
  const d = ir.recentDoc;
  if (!d) return <span className="text-muted-foreground">—</span>;
  const title = d.title.length > 30 ? `${d.title.slice(0, 30)}…` : d.title;
  return (
    <span className="block min-w-[200px] max-w-[320px] whitespace-normal">
      <Link
        href={`/customers/${slug}#doc-${d.docId}`}
        className="text-blue-600 hover:underline dark:text-blue-400"
        title={
          d.reason
            ? `${d.title}
중요: ${d.reason}`
            : d.title
        }
      >
        {docTypeLabel(d.docType)} · {title}
      </Link>{' '}
      <span className="text-xs text-muted-foreground">{d.publishedAt}</span>
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
            <th className={`${TD} text-right`}>
              분기 매출
              <span className="block font-normal">원화 · 분기 평균 환율</span>
            </th>
            <th className={`${TD} text-right`}>매출 YoY</th>
            <th className={`${TD} text-right`}>영업이익률</th>
            <th className={`${TD} text-left`}>최근 가이던스 변경</th>
            <th className={`${TD} text-left`}>최근 중요 문서</th>
            <th className={`${TD} text-left`}>다음 실적</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const q = r.latestQuarter;
            const next = nextEarnings(r.ir.earningsDates, today);
            return (
              <HighlightRow
                key={r.company_id}
                label={r.name_kr}
                className="border-t border-border hover:bg-muted/30"
              >
                <td className={TD}>
                  <Link
                    href={`/customers/${r.slug}`}
                    className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                  >
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
                <td className={NUM}>{krwText(r.revenueKrw)}</td>
                <td className={cn(NUM, pctClass(q?.revenue_yoy_pct ?? null))}>
                  {pctText(q?.revenue_yoy_pct ?? null)}
                </td>
                <td className={cn(NUM, pctClass(q?.operating_margin_pct ?? null))}>
                  {pctText(q?.operating_margin_pct ?? null, false)}
                  {q?.origin?.operating_income.source === 'company_adjusted' && (
                    // 상세와 같은 규칙 — 법정 영업이익이 없어 회사 조정 영업이익으로 계산한 칸(결정 R6).
                    <span
                      className="ml-1 rounded bg-muted px-1 text-[11px] text-muted-foreground"
                      title={`회사 발표 조정 영업이익 기준${q.origin.operating_income.metric_name ? ` (${q.origin.operating_income.metric_name})` : ''}`}
                    >
                      조정
                    </span>
                  )}
                </td>
                <td className={TD}>
                  <GuidanceChangeCell ir={r.ir} />
                </td>
                <td className={TD}>
                  <RecentDocCell ir={r.ir} slug={r.slug} />
                </td>
                <td className={cn(TD, 'tabular-nums', next?.estimated && 'text-muted-foreground')}>
                  {next ? (
                    <span title={next.estimated ? '추정 — 작년 같은 분기 발표일 + 1년' : undefined}>
                      {next.date} <span className="text-xs">{periodText(next.period)}</span>
                      {next.estimated && <span className="ml-1 text-xs">(추정)</span>}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </HighlightRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
