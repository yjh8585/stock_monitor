import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import HyundaiQuarterlyEarningsChart from '@/components/oem-companies/hyundai/HyundaiQuarterlyEarningsChart';
import CompanyKpiCards from '@/components/oem-companies/common/CompanyKpiCards';
import CompanyTimeSeriesChart from '@/components/oem-companies/common/CompanyTimeSeriesChart';
import PopupNewsSection from '@/components/stock-popup/PopupNewsSection';
import CustomerEarningsTable from '@/components/customers/CustomerEarningsTable';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canAccess } from '@/lib/auth/permissions';
import { getCustomerDetail } from '@/lib/customers/source';
import type { CustomerEarnings } from '@/lib/customers/types';

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

/** 고객사 개별 페이지 — 실적(차트·표) · MarkLines 그룹 판매 · 최근 뉴스. */
export default async function CustomerPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user || !canAccess('/customers', user.role)) redirect('/');
  const { slug } = await params;
  const d = await getCustomerDetail(slug);
  if (!d) notFound();
  const { row, earnings, volume } = d;
  const shareText = row.share.sharePct == null ? '해당 없음' : `${row.share.sharePct.toFixed(1)}%`;
  const shareScope = d.windowLabel
    ? ` (${d.windowLabel} · 연결${row.share_group ? ` · ${[row.name_kr, ...row.share_group_peers].join('·')} 합산` : ''})`
    : '';
  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <Link href="/customers" className="text-xs text-muted-foreground hover:underline">
          ← 고객사
        </Link>
        <h1 className="text-lg font-semibold">
          {row.name_kr}{' '}
          {row.ticker && <span className="text-sm text-muted-foreground">{row.ticker}</span>}
        </h1>
        <p className="text-sm tabular-nums mt-0.5">
          {row.price.lastClose == null
            ? '주가 —'
            : `${row.price.lastClose.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${row.currency} · 1개월 ${
                row.price.return1mPct == null ? '—' : `${row.price.return1mPct.toFixed(1)}%`
              } · 연초 대비 ${row.price.returnYtdPct == null ? '—' : `${row.price.returnYtdPct.toFixed(1)}%`} (${row.price.lastDate})`}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          우리 매출 비중 {shareText}
          {shareScope}
          {row.share.topProducts.length > 0 && ` · 공급 품목 ${row.share.topProducts.join(', ')}`}
        </p>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-6">
        <section className="space-y-3">
          <h2 className="text-base font-semibold">실적</h2>
          {earnings.currency && (
            <HyundaiQuarterlyEarningsChart
              data={earnings.quarterly}
              annual={earnings.annual}
              revenueKey="revenue_bn"
              currency={earnings.currency}
              allowNegativeMargin={hasNegativeMargin(earnings)}
              titleLabel="실적"
              sourceNote="financials(yfinance·DART) · 현지 통화"
            />
          )}
          <CustomerEarningsTable earnings={earnings} />
        </section>
        <section className="space-y-3">
          <h2 className="text-base font-semibold">물량 (MarkLines 판매)</h2>
          {volume.group && volume.kpi ? (
            <>
              <p className="text-xs text-muted-foreground">
                MarkLines 그룹 「{volume.group}」 전체 판매 — 그룹 단위라 계열 브랜드가 함께 잡힌다.
              </p>
              <CompanyKpiCards kpi={volume.kpi} />
              <CompanyTimeSeriesChart
                monthly={volume.monthly}
                annual={volume.annual}
                title="MarkLines 그룹 판매"
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">MarkLines 에 이 회사 단독 그룹이 없다.</p>
          )}
          {d.oemTabPath && (
            <Link href={d.oemTabPath} className="text-sm text-primary hover:underline">
              회사 발표 판매·출하 상세 → OEM 탭
            </Link>
          )}
        </section>
        <section className="space-y-3">
          <h2 className="text-base font-semibold">최근 뉴스</h2>
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
