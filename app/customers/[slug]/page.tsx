import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import HyundaiQuarterlyEarningsChart from '@/components/oem-companies/hyundai/HyundaiQuarterlyEarningsChart';
import PopupNewsSection from '@/components/stock-popup/PopupNewsSection';
import CustomerEarningsTable from '@/components/customers/CustomerEarningsTable';
import CustomerGuidanceCards from '@/components/customers/CustomerGuidanceCards';
import CustomerDocumentList from '@/components/customers/CustomerDocumentList';
import CustomerDocSummaries from '@/components/customers/CustomerDocSummaries';
import CustomerNewsWeekly from '@/components/customers/CustomerNewsWeekly';
import CustomerVolumeCompare from '@/components/customers/CustomerVolumeCompare';
import CustomerEarningsSchedule from '@/components/customers/CustomerEarningsSchedule';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canAccess } from '@/lib/auth/permissions';
import { todaySeoul } from '@/lib/currentYear';
import { getCustomerDetail, getCustomerIr, pickCustomerEarnings } from '@/lib/customers/source';
import { latestChinaJv, nextEarnings } from '@/lib/customers/ir';
import type { CustomerEarnings } from '@/lib/customers/types';
import {
  earningsFootnotes,
  pctClass,
  pctText,
  reportedAmountText,
  reportedPeriodLabel,
} from '@/lib/customers/format';

/** Cache Components 는 dynamic route 에 generateStaticParams 결과를 최소 1개 요구한다(app/stock-popup/[id] 와 같은 방식). */
export async function generateStaticParams() {
  return [{ slug: '_' }];
}

/**
 * 분기·연간 중 영업이익률이 음수인 점이 하나라도 있는가.
 * 있을 때만 차트의 음수 갈래(축을 위·아래 띠로 나눔)를 켠다 — 흑자 회사는 기존 0 기준 축(2026-11-09 사용자 결정).
 */
function hasNegativeMargin(earnings: CustomerEarnings): boolean {
  return [...earnings.quarterly, ...earnings.annual].some(
    (p) => p.operating_margin_pct != null && p.operating_margin_pct < 0
  );
}

/** 점들에 실린 회사 발표 조정 영업이익 이름(중복 없이, 처음 나온 순). */
function adjustedColumns(earnings: CustomerEarnings): { metric: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const p of [...earnings.quarterly, ...earnings.annual])
    for (const a of p.adjusted ?? []) if (!seen.has(a.metric)) seen.set(a.metric, a.name);
  return [...seen].map(([metric, name]) => ({ metric, name }));
}

/** 고객사 개별 페이지 — 실적(차트·표) · 가이던스 · 물량 비교 · 자료실 · 최근 뉴스. */
export default async function CustomerPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user || !canAccess('/customers', user.role)) redirect('/');
  const { slug } = await params;
  const [d, ir] = await Promise.all([getCustomerDetail(slug), getCustomerIr(slug)]);
  if (!d) notFound();
  const { row, volume } = d;
  // 해외는 칸마다 회사 공시 → 시장 데이터 순으로 고른 결과만 그린다(공시 원본 행은 화면에 뿌리지 않는다). 국내는 1단계 그대로.
  const companyFirst = ir?.earningsRule === 'company_first';
  const earnings =
    ir && companyFirst ? pickCustomerEarnings(row.company_id, d.earnings, ir.reported) : d.earnings;
  const footnotes = companyFirst
    ? {
        quarter: earningsFootnotes(earnings.quarterly, earnings.currency),
        annual: earningsFootnotes(earnings.annual, earnings.currency),
      }
    : undefined;
  const next = ir ? nextEarnings(ir.earningsDates, todaySeoul()) : null;
  const chinaJv = ir ? latestChinaJv(ir.reported) : null;
  const shareText = row.share.sharePct == null ? '해당 없음' : `${row.share.sharePct.toFixed(1)}%`;
  const shareScope = d.windowLabel
    ? ` (${d.windowLabel} · 연결${row.share_group ? ` · ${[row.name_kr, ...row.share_group_peers].join('·')} 합산` : ''})`
    : '';
  return (
    <div className="h-full flex flex-col">
      {/* 「← 고객사」 링크는 layout 의 탭이 대신한다(2026-11-11 사용자 지시). 페이지 h1 은 layout 의 「고객사」. */}
      <div className="px-6 py-3 border-b border-border shrink-0">
        <h2 className="text-lg font-semibold">
          {row.name_kr}{' '}
          {row.ticker && <span className="text-sm text-muted-foreground">{row.ticker}</span>}
        </h2>
        <p className="text-sm tabular-nums mt-0.5">
          {row.price.lastClose == null ? (
            '주가 —'
          ) : (
            <>
              {row.price.lastClose.toLocaleString('en-US', { maximumFractionDigits: 2 })}{' '}
              {row.currency} · 1개월{' '}
              <span className={pctClass(row.price.return1mPct)}>
                {pctText(row.price.return1mPct)}
              </span>{' '}
              · 연초 대비{' '}
              <span className={pctClass(row.price.returnYtdPct)}>
                {pctText(row.price.returnYtdPct)}
              </span>{' '}
              ({row.price.lastDate})
            </>
          )}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          우리 매출 비중 {shareText}
          {shareScope}
          {row.share.topProducts.length > 0 && ` · 공급 품목 ${row.share.topProducts.join(', ')}`}
        </p>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-6">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">실적</h2>
            <CustomerEarningsSchedule next={next} />
          </div>
          {earnings.currency && (
            <HyundaiQuarterlyEarningsChart
              data={earnings.quarterly}
              annual={earnings.annual}
              revenueKey="revenue_bn"
              currency={earnings.currency}
              allowNegativeMargin={hasNegativeMargin(earnings)}
              showMarginLabels
              titleLabel="실적"
              sourceNote={
                companyFirst
                  ? '회사 공시 우선 · 없는 칸은 시장 데이터(yfinance) · 현지 통화'
                  : 'financials(yfinance·DART) · 현지 통화'
              }
              annualNote={`연간 = 회사 발표 연간 실적 · 매출 단위: ${
                earnings.currency === 'KRW' ? '조원' : `${earnings.currency} bn`
              }, 영업이익률(%)`}
            />
          )}
          <CustomerEarningsTable
            earnings={earnings}
            adjustedRows={adjustedColumns(earnings)}
            footnotes={footnotes}
          />
          {chinaJv && (
            // 결정 E10 — 연결 실적에 안 들어가는 중국 지분법 합작사 몫(회사 발표 각주)
            <p className="text-sm tabular-nums">
              중국 합작사 영업이익 몫{' '}
              <span className="text-xs text-muted-foreground">
                (지분법 · 연결 실적 밖 · 회사 발표)
              </span>
              : {reportedPeriodLabel(chinaJv.latest.period)} {reportedAmountText(chinaJv.latest)}
              {chinaJv.prior && (
                <span className="text-muted-foreground">
                  {' '}
                  · 전년 같은 기간 {reportedAmountText(chinaJv.prior)}
                </span>
              )}
            </p>
          )}
        </section>
        {ir && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold">가이던스</h2>
            <CustomerGuidanceCards
              cards={ir.guidance}
              notes={ir.guidanceNotes}
              reported={ir.reported}
              annual={earnings.annual}
              earningsCurrency={earnings.currency}
            />
          </section>
        )}
        <section className="space-y-3">
          <h2 className="text-base font-semibold">물량 (MarkLines 판매 · 회사 발표)</h2>
          <CustomerVolumeCompare volume={volume} series={ir?.volume ?? []} />
          {d.oemTabPath && (
            <Link href={d.oemTabPath} className="text-sm text-primary hover:underline">
              회사 발표 판매·출하 상세 → OEM 탭
            </Link>
          )}
        </section>
        {ir && <CustomerDocSummaries summaries={ir.docSummaries} />}
        {ir && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold">자료실</h2>
            <CustomerDocumentList documents={ir.documents} collectStatus={ir.collectStatus} />
          </section>
        )}
        {ir && <CustomerNewsWeekly weeks={ir.newsWeeks} />}
        {/* 제목은 PopupNewsSection 안의 「최신 뉴스」가 맡는다 — 여기 h2 를 두면 제목이 두 번 나온다. */}
        <section>
          <PopupNewsSection
            companyId={row.company_id}
            companyName={row.name_kr}
            ticker={row.ticker ?? ''}
            country={d.country}
          />
        </section>
      </div>
    </div>
  );
}
