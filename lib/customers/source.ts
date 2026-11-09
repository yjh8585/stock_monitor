/**
 * 고객사 페이지 조회 계층 — 명단(customer_accounts)·손익 매출이 사외비라 confidentialDb 로 읽는다.
 * 손익 raw 는 이 모듈 밖으로 나가지 않는다(비중·상위 품목만 반환).
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { currentYear } from '@/lib/currentYear';
import { confidentialDb } from '@/lib/supabase/confidential';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import { fetchPnlEntries } from '@/lib/pnl/source';
import {
  aggregateAnnualSeries,
  aggregateKpi,
  aggregateMonthlySeries,
} from '@/lib/oem-companies/kg-mobility/aggregate';
import type { CompanyKpiSummary, CompanyTimeSeriesPoint, OemSalesGroupMonth } from '@/lib/types';
import { computeShares } from './share';
import { buildEarnings } from './earnings';
import { priceReturns } from './prices';
import { groupMonthToSaleRows } from './volume';
import {
  buildVolumeSeries,
  droppedCurrencies,
  guidanceStatusNotes,
  latestGuidance,
  latestGuidanceChange,
  pickEarnings,
  type EarningsDateRow,
  type GuidanceCard,
  type GuidanceChange,
  type GuidanceRowTs,
  type ReportedRow,
  type VolumeRow,
  type VolumeSeries,
} from './ir';
import type {
  CustomerEarnings,
  CustomerEarningsPoint,
  CustomerShare,
  FinancialPeriodRow,
  PricePoint,
  PriceReturns,
} from './types';

const PAGE = 1000;

export interface CustomerOverviewRow {
  company_id: string;
  slug: string;
  name_kr: string;
  ticker: string | null;
  currency: string;
  share: CustomerShare;
  share_group: string | null;
  share_group_peers: string[];
  price: PriceReturns;
  latestQuarter: CustomerEarningsPoint | null;
  earningsCurrency: string | null;
}

/** 요약 표의 공식 문서 열 재료 — 「다음 실적」은 화면이 nextEarnings(earningsDates, todaySeoul()) 로 고른다. */
export interface CustomerOverviewIr {
  guidanceChange: GuidanceChange | null;
  earningsDates: EarningsDateRow[];
}

export interface CustomersOverview {
  windowLabel: string;
  rows: (CustomerOverviewRow & { ir: CustomerOverviewIr })[];
}

export interface CustomerDocumentItem {
  id: number;
  source: string; // edgar · dart · ir
  doc_type: string;
  form: string | null;
  title: string;
  url: string;
  published_at: string;
}

export interface CollectStatusItem {
  collector: string;
  status: string; // ok · no_new · blocked · parse_failed · error
  reason: string | null;
  checked_at: string;
}

/** 개별 화면의 공식 문서 절 재료 — 사외비 표(confidentialDb)에서 verified 행만. */
export interface CustomerIr {
  /** 'financials' = 국내(DART 회사) — 실적 표는 1단계 그대로 · 'company_first' = 해외 — 화면이 pickCustomerEarnings 를 부른다. */
  earningsRule: 'company_first' | 'financials';
  /** 회사 보고 통화(실적 공시 행에서 가장 많은 통화). 가이던스 currency null 이 가리키는 통화. 공시 행이 없으면 null. */
  reportCurrency: string | null;
  /** 최근 40건(공시일 내림차순). */
  documents: CustomerDocumentItem[];
  /** (metric, 통화) 별 최신 FY 카드 — 철회 플래그(withdrawn_at) 포함. */
  guidance: GuidanceCard[];
  /** 상태 행(철회·「가이던스 확인」) — 날짜순. */
  guidanceNotes: GuidanceRowTs[];
  volume: VolumeSeries[];
  /** 분기·누계·연간 전부(pickEarnings 가 누계 차이·각주 재료로 쓴다). 별도 기준 행도 들어 있다 — 칸 고르기에서 pickEarnings 가 거른다. */
  reported: ReportedRow[];
  earningsDates: EarningsDateRow[];
  collectStatus: CollectStatusItem[];
}

export interface CustomerDetail {
  row: CustomerOverviewRow;
  country: string;
  windowLabel: string;
  earnings: CustomerEarnings;
  volume: {
    group: string | null;
    monthly: CompanyTimeSeriesPoint[];
    annual: CompanyTimeSeriesPoint[];
    kpi: CompanyKpiSummary | null;
  };
  oemTabPath: string | null;
}

interface AccountRow {
  company_id: string;
  slug: string;
  display_order: number;
  pnl_customers: string[];
  share_group: string | null;
  marklines_group: string | null;
  oem_tab_path: string | null;
}

async function fetchAccounts(): Promise<AccountRow[]> {
  const { data, error } = await confidentialDb
    .from('customer_accounts')
    .select('company_id,slug,display_order,pnl_customers,share_group,marklines_group,oem_tab_path')
    .order('display_order', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'customer_accounts 조회 실패');
    throw new Error(`customer_accounts 조회 실패: ${error.message}`);
  }
  return data ?? [];
}

async function fetchCompanies(ids: string[]) {
  const sb = createSupabaseAnonClient();
  const { data, error } = await sb
    .from('companies')
    .select('id,name_kr,name,ticker,currency,country,dart_corp_code')
    .in('id', ids)
    .eq('status', 'active');
  if (error) throw new Error(`companies 조회 실패: ${error.message}`);
  return new Map((data ?? []).map((c) => [c.id, c]));
}

async function fetchFinancials(ids: string[]): Promise<Map<string, FinancialPeriodRow[]>> {
  const sb = createSupabaseAnonClient();
  const out = new Map<string, FinancialPeriodRow[]>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('financials')
      .select(
        'id,company_id,fiscal_year,fiscal_quarter,period_type,period_end_date,currency,revenue,operating_income,operating_margin,net_income'
      )
      .in('company_id', ids)
      .gte('fiscal_year', currentYear() - 3)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`financials 조회 실패: ${error.message}`);
    for (const r of data ?? []) {
      const list = out.get(r.company_id) ?? [];
      list.push(r);
      out.set(r.company_id, list);
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function fetchPrices(ids: string[]): Promise<Map<string, PricePoint[]>> {
  const sb = createSupabaseAnonClient();
  // 전년 12월부터면 YTD 기준(전년 마지막 거래일)·1M 기준이 모두 들어온다.
  const since = `${currentYear() - 1}-12-01`;
  const out = new Map<string, PricePoint[]>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('stock_prices')
      .select('company_id,trade_date,close')
      .in('company_id', ids)
      .gte('trade_date', since)
      .order('company_id', { ascending: true })
      .order('trade_date', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`stock_prices 조회 실패: ${error.message}`);
    for (const r of data ?? []) {
      const list = out.get(r.company_id) ?? [];
      list.push({ trade_date: r.trade_date, close: Number(r.close) });
      out.set(r.company_id, list);
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function computeShareResult(accounts: AccountRow[]) {
  const pnl = await fetchPnlEntries();
  const rows = pnl
    .filter(
      // 실적만(사용자 결정) — 계획 (P)·추정 (E) 행은 뺀다.
      (r) =>
        r.basis === 'consolidated' &&
        !r.is_plan &&
        !r.is_estimate &&
        r.period_month >= 1 &&
        r.period_month <= 12
    )
    .map((r) => ({
      customer: r.customer,
      product: r.product,
      period_year: r.period_year,
      period_month: r.period_month,
      revenue: r.revenue,
    }));
  return computeShares(rows, accounts);
}

interface BuiltRow {
  account: AccountRow;
  country: string;
  earnings: CustomerEarnings;
  row: CustomerOverviewRow;
}

async function buildRows(
  accounts: AccountRow[]
): Promise<{ rows: BuiltRow[]; windowLabel: string }> {
  const ids = accounts.map((a) => a.company_id);
  const [companies, financials, prices, shares] = await Promise.all([
    fetchCompanies(ids),
    fetchFinancials(ids),
    fetchPrices(ids),
    computeShareResult(accounts),
  ]);
  const rows: BuiltRow[] = [];
  for (const a of accounts) {
    const c = companies.get(a.company_id);
    if (!c) continue; // hidden·병합된 회사는 명단에 남아도 화면에서 뺀다
    const earnings = buildEarnings(financials.get(a.company_id) ?? []);
    const latestQuarter =
      [...earnings.quarterly].reverse().find((p) => p.revenue_bn != null) ?? null;
    rows.push({
      account: a,
      country: c.country ?? '',
      earnings,
      row: {
        company_id: a.company_id,
        slug: a.slug,
        name_kr: c.name_kr ?? c.name,
        ticker: c.ticker,
        currency: c.currency,
        share: shares.byCompany[a.company_id] ?? { sharePct: null, topProducts: [] },
        share_group: a.share_group,
        share_group_peers: [],
        price: priceReturns(prices.get(a.company_id) ?? []),
        latestQuarter,
        earningsCurrency: earnings.currency,
      },
    });
  }
  // 합산 그룹 동료 이름 — 명단은 DB 에서만 온다(코드에 고객명 없음).
  for (const x of rows) {
    if (!x.row.share_group) continue;
    x.row.share_group_peers = rows
      .filter((y) => y !== x && y.row.share_group === x.row.share_group)
      .map((y) => y.row.name_kr);
  }
  return { rows, windowLabel: shares.windowLabel };
}

export async function getCustomersOverview(): Promise<CustomersOverview> {
  'use cache';
  cacheLife('days');
  cacheTag('customer_accounts');
  cacheTag('pnl_entries');
  cacheTag('financials');
  cacheTag('stock_prices');
  cacheTag('companies');
  cacheTag('customer_documents');
  cacheTag('customer_guidance');
  cacheTag('customer_volume_ir');
  cacheTag('customer_reported_results');
  cacheTag('customer_earnings_dates');
  cacheTag('customer_collect_status');
  const accounts = await fetchAccounts();
  const ids = accounts.map((a) => a.company_id);
  const [{ rows, windowLabel }, guidance, dates] = await Promise.all([
    buildRows(accounts),
    fetchGuidance(ids),
    fetchEarningsDates(ids),
  ]);
  return {
    windowLabel,
    rows: rows.map((x) => ({
      ...x.row,
      ir: {
        guidanceChange: latestGuidanceChange(guidance.get(x.row.company_id) ?? [], currentYear()),
        earningsDates: dates.get(x.row.company_id) ?? [],
      },
    })),
  };
}

// ---------------------------------------------------------------- 공식 문서(공시·IR) — 전부 사외비 표
/** `.range()` 페이지 반복 — 호출부가 PK 전체로 `.order()` 를 건다(AGENTS.md: 조건은 「유일하다」). */
async function fetchAllPages<T>(
  label: string,
  page: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) {
      logger.error({ err: error }, `${label} 조회 실패`);
      throw new Error(`${label} 조회 실패: ${error.message}`);
    }
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function groupBy<T extends { company_id: string }, U>(rows: T[], map: (r: T) => U) {
  const out = new Map<string, U[]>();
  for (const r of rows) out.set(r.company_id, [...(out.get(r.company_id) ?? []), map(r)]);
  return out;
}

const GUIDANCE_COLS =
  'id,company_id,metric,metric_label,period,low,high,value_text,unit,basis,currency,stated,direction,extractor,quote,published_at,verified';

/** 검증된 가이던스 행 — 회사별. numeric 칸은 Number 로(문자열 직렬화 방지). */
async function fetchGuidance(ids: string[]): Promise<Map<string, GuidanceRowTs[]>> {
  const rows = await fetchAllPages('customer_guidance', (from, to) =>
    confidentialDb
      .from('customer_guidance')
      .select(GUIDANCE_COLS)
      .in('company_id', ids)
      .eq('verified', true)
      .order('id', { ascending: true })
      .range(from, to)
  );
  return groupBy(rows, (r) => ({
    metric: r.metric,
    metric_label: r.metric_label,
    period: r.period,
    low: r.low == null ? null : Number(r.low),
    high: r.high == null ? null : Number(r.high),
    value_text: r.value_text,
    unit: r.unit,
    basis: r.basis as GuidanceRowTs['basis'],
    currency: r.currency,
    stated: r.stated,
    direction: r.direction,
    extractor: r.extractor as GuidanceRowTs['extractor'],
    quote: r.quote,
    published_at: r.published_at,
    verified: r.verified,
  }));
}

async function fetchEarningsDates(ids: string[]): Promise<Map<string, EarningsDateRow[]>> {
  const rows = await fetchAllPages('customer_earnings_dates', (from, to) =>
    confidentialDb
      .from('customer_earnings_dates')
      .select('company_id,period,event_date,source,url')
      .in('company_id', ids)
      .order('company_id', { ascending: true })
      .order('period', { ascending: true })
      .range(from, to)
  );
  return groupBy(rows, (r) => ({
    period: r.period,
    event_date: r.event_date,
    source: r.source,
    url: r.url,
  }));
}

async function fetchVolume(companyId: string): Promise<VolumeRow[]> {
  const rows = await fetchAllPages('customer_volume_ir', (from, to) =>
    confidentialDb
      .from('customer_volume_ir')
      .select('metric,region,period_grain,period,value,definition,published_at')
      .eq('company_id', companyId)
      .eq('verified', true)
      .order('metric', { ascending: true })
      .order('region', { ascending: true })
      .order('period_grain', { ascending: true })
      .order('period', { ascending: true })
      .range(from, to)
  );
  return rows.map((r) => ({
    ...r,
    period_grain: r.period_grain as VolumeRow['period_grain'],
    value: Number(r.value),
  }));
}

async function fetchReported(companyId: string): Promise<ReportedRow[]> {
  const rows = await fetchAllPages('customer_reported_results', (from, to) =>
    confidentialDb
      .from('customer_reported_results')
      .select('period_grain,period,metric,metric_name,basis,value,unit,currency')
      .eq('company_id', companyId)
      .eq('verified', true)
      .order('period_grain', { ascending: true })
      .order('period', { ascending: true })
      .order('metric', { ascending: true })
      .range(from, to)
  );
  return rows.map((r) => ({
    ...r,
    period_grain: r.period_grain as ReportedRow['period_grain'],
    basis: r.basis as ReportedRow['basis'],
    unit: r.unit as ReportedRow['unit'],
    value: Number(r.value),
  }));
}

async function fetchDocuments(companyId: string): Promise<CustomerDocumentItem[]> {
  const { data, error } = await confidentialDb
    .from('customer_documents')
    .select('id,source,doc_type,form,title,url,published_at')
    .eq('company_id', companyId)
    .order('published_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(40);
  if (error) throw new Error(`customer_documents 조회 실패: ${error.message}`);
  return data ?? [];
}

async function fetchCollectStatus(companyId: string): Promise<CollectStatusItem[]> {
  const { data, error } = await confidentialDb
    .from('customer_collect_status')
    .select('collector,status,reason,checked_at')
    .eq('company_id', companyId)
    .order('collector', { ascending: true });
  if (error) throw new Error(`customer_collect_status 조회 실패: ${error.message}`);
  return data ?? [];
}

/**
 * 해외 회사 실적 칸 고르기(pickEarnings)의 서버 래퍼 — 화면은 이것을 부른다.
 * 실적 통화와 달라 버린 회사 행이 있으면 경고 한 줄(회사 id·통화만 — 금액 없음). 버리면 그 칸이 조용히 시장 값으로 돌아간다.
 */
export function pickCustomerEarnings(
  companyId: string,
  earnings: CustomerEarnings,
  reported: ReportedRow[]
): CustomerEarnings {
  const dropped = droppedCurrencies(earnings, reported);
  if (dropped.length > 0)
    logger.warn(
      { companyId, earningsCurrency: earnings.currency, dropped },
      '고객사 공시 실적 행의 통화가 실적 통화와 달라 칸 고르기에서 뺐다'
    );
  return pickEarnings(earnings, reported);
}

/** 실적 공시 행에서 가장 많은 통화(주당 값 제외). */
function reportCurrencyOf(rows: ReportedRow[]): string | null {
  const count = new Map<string, number>();
  for (const r of rows)
    if (r.unit !== 'per_share') count.set(r.currency, (count.get(r.currency) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export async function getCustomerIr(slug: string): Promise<CustomerIr | null> {
  'use cache';
  cacheLife('days');
  cacheTag('customer_accounts');
  cacheTag('companies');
  cacheTag('customer_documents');
  cacheTag('customer_guidance');
  cacheTag('customer_volume_ir');
  cacheTag('customer_reported_results');
  cacheTag('customer_earnings_dates');
  cacheTag('customer_collect_status');
  const account = (await fetchAccounts()).find((a) => a.slug === slug);
  if (!account) return null;
  const id = account.company_id;
  const [companies, documents, guidance, volume, reported, dates, collectStatus] =
    await Promise.all([
      fetchCompanies([id]),
      fetchDocuments(id),
      fetchGuidance([id]),
      fetchVolume(id),
      fetchReported(id),
      fetchEarningsDates([id]),
      fetchCollectStatus(id),
    ]);
  const company = companies.get(id);
  if (!company) return null; // hidden·병합된 회사 — getCustomerDetail 과 같은 판정
  const guidanceRows = guidance.get(id) ?? [];
  const reportCurrency = reportCurrencyOf(reported);
  return {
    earningsRule: company.dart_corp_code ? 'financials' : 'company_first',
    reportCurrency,
    documents,
    guidance: latestGuidance(guidanceRows, currentYear(), reportCurrency),
    guidanceNotes: guidanceStatusNotes(guidanceRows),
    volume: buildVolumeSeries(volume),
    reported,
    earningsDates: dates.get(id) ?? [],
    collectStatus,
  };
}

async function fetchGroupMonth(group: string): Promise<OemSalesGroupMonth[]> {
  const sb = createSupabaseAnonClient();
  const out: OemSalesGroupMonth[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('oem_sales_group_month')
      .select('oem_group,year_month,sales')
      .eq('oem_group', group)
      .order('oem_group', { ascending: true })
      .order('year_month', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`oem_sales_group_month 조회 실패: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function getCustomerDetail(slug: string): Promise<CustomerDetail | null> {
  'use cache';
  cacheLife('days');
  cacheTag('customer_accounts');
  cacheTag('pnl_entries');
  cacheTag('financials');
  cacheTag('stock_prices');
  cacheTag('companies');
  cacheTag('oem_sales_group_month');
  const accounts = await fetchAccounts();
  if (!accounts.some((a) => a.slug === slug)) return null;
  // 비중 분모·합산 동료 이름이 전체 명단에 걸려 있어 전체로 계산하고 하나를 고른다.
  const { rows, windowLabel } = await buildRows(accounts);
  const hit = rows.find((x) => x.row.slug === slug);
  if (!hit) return null;

  const group = hit.account.marklines_group;
  let volume: CustomerDetail['volume'] = { group, monthly: [], annual: [], kpi: null };
  if (group) {
    const saleRows = groupMonthToSaleRows(await fetchGroupMonth(group), group);
    // 그룹은 있는데 판매 행이 0개면 「0대」 KPI 대신 kpi null — 화면이 「자료가 아직 없다」를 띄운다.
    if (saleRows.length > 0) {
      volume = {
        group,
        monthly: aggregateMonthlySeries(saleRows),
        annual: aggregateAnnualSeries(saleRows),
        // 그룹 월 표엔 PT 가 없어 EV 비중을 계산하지 않는다(카드에 「—」).
        kpi: { ...aggregateKpi(saleRows), evRatio: null },
      };
    }
  }
  return {
    row: hit.row,
    country: hit.country,
    windowLabel,
    earnings: hit.earnings,
    volume,
    oemTabPath: hit.account.oem_tab_path,
  };
}
