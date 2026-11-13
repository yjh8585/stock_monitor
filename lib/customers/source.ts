/**
 * 고객사 페이지 조회 계층 — 명단(customer_accounts)·손익 매출이 사외비라 confidentialDb 로 읽는다.
 * 손익 raw 는 이 모듈 밖으로 나가지 않는다(비중·상위 품목만 반환).
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { currentYear, todaySeoul } from '@/lib/currentYear';
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
import {
  groupMonthToSaleRows,
  modelMonthsToGroupMonth,
  modelQuarterTable,
  type ModelMonthRow,
  type ModelQuarterTable,
} from './volume';
import { buildBreakdown, type BreakdownRow, type BreakdownTab } from './breakdown';
import { revenueKrw, type RateRow } from './krw';
import { guidanceSignal, type SignalColor } from './signals';
import {
  byRecent,
  pickRecentImportant,
  toDocSummary,
  toNewsWeek,
  type DocSummary,
  type NewsWeek,
  type RecentDoc,
} from './summaries';
import {
  buildVolumeSeries,
  droppedCurrencies,
  guidanceStatusNotes,
  latestGuidance,
  latestGuidanceChangeWithCard,
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
  /** 그 변경이 속한 카드의 신호등 색(상세 카드와 같은 판정). 변경이 없으면 null. */
  guidanceSignal: SignalColor | null;
  earningsDates: EarningsDateRow[];
  /** 「최근 중요 문서」 — 요약 ok · 중요도 상 · 게시일 30일 안 중 가장 최근(pickRecentImportant). 없으면 null. */
  recentDoc: RecentDoc | null;
}

export interface CustomersOverview {
  windowLabel: string;
  rows: CustomerOverviewTableRow[];
}

/** 요약 표 한 줄 — latestQuarter 는 상세와 같은 칸 고르기(해외 = 회사 공시 우선) 결과. */
export type CustomerOverviewTableRow = CustomerOverviewRow & {
  ir: CustomerOverviewIr;
  /** 최근 분기 매출의 원화(그 분기 평균 환율). 환율·매출이 없으면 null. */
  revenueKrw: number | null;
};

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
  /** (metric, 통화) 별 카드 — 대표 FY = 올해 이상 가장 가까운 FY(없으면 가장 늦은 FY) · 그보다 먼 FY 는 longer_term · 철회 플래그(withdrawn_at) 포함. */
  guidance: GuidanceCard[];
  /** 상태 행(철회·「가이던스 확인」) — 날짜순. */
  guidanceNotes: GuidanceRowTs[];
  volume: VolumeSeries[];
  /** 분기·누계·연간 전부(pickEarnings 가 누계 차이·각주 재료로 쓴다). 별도 기준 행도 들어 있다 — 칸 고르기에서 pickEarnings 가 거른다. */
  reported: ReportedRow[];
  earningsDates: EarningsDateRow[];
  collectStatus: CollectStatusItem[];
  /** 공식 문서 요약 — status ok · 최신순 · 최대 30. */
  docSummaries: DocSummary[];
  /** 주간 뉴스 요약 — status ok · 최근 4주(최신순). */
  newsWeeks: NewsWeek[];
  /** 「지역·차종·점유율」 탭 — verified 만 · 값 없는 탭은 빠진다(결정 C4·C8). */
  breakdown: BreakdownTab[];
}

export interface CustomerDetail {
  row: CustomerOverviewRow;
  country: string;
  windowLabel: string;
  earnings: CustomerEarnings;
  volume: {
    group: string | null;
    /** 차종 모드 — 그룹 전체가 아니라 이 차종들의 합(`customer_accounts.marklines_models`). 그룹 모드면 null. */
    models: string[] | null;
    /** 차종 모드에서 판매·생산 어느 표에도 없는 차종명(철자 불일치 의심) — 그룹 모드면 빈 배열. */
    missingModels: string[];
    monthly: CompanyTimeSeriesPoint[];
    annual: CompanyTimeSeriesPoint[];
    kpi: CompanyKpiSummary | null;
    /** 차종 모드의 차종별 분기 생산·판매 표(MarkLines 추정). 그룹 모드면 null. */
    modelTable: ModelQuarterTable | null;
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
  marklines_models: string[] | null;
  oem_tab_path: string | null;
}

async function fetchAccounts(): Promise<AccountRow[]> {
  const { data, error } = await confidentialDb
    .from('customer_accounts')
    .select(
      'company_id,slug,display_order,pnl_customers,share_group,marklines_group,marklines_models,oem_tab_path'
    )
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

/**
 * 우리 매출 비중 — 손익 전체를 읽는 가장 무거운 계산이라 따로 캐시해 요약·상세 11개가 한 번만 계산한다.
 * 분모(전체 매출)가 명단 전체에 걸려 있어 한 회사만 계산할 수 없다. 반환값(상위 품목 포함)은 서버 밖으로 나가지 않는다.
 */
async function getShareResult() {
  'use cache';
  cacheLife('days');
  cacheTag('customer_accounts');
  cacheTag('pnl_entries');
  return computeShareResult(await fetchAccounts());
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
  /** DART 회사(국내) — 실적은 financials 그대로 · 해외는 회사 공시 우선(pickCustomerEarnings). getCustomerIr 의 earningsRule 과 같은 판정. */
  domestic: boolean;
  country: string;
  earnings: CustomerEarnings;
  row: CustomerOverviewRow;
}

/** 매출이 있는 가장 늦은 분기. */
function latestQuarterOf(earnings: CustomerEarnings): CustomerEarningsPoint | null {
  return [...earnings.quarterly].reverse().find((p) => p.revenue_bn != null) ?? null;
}

/**
 * 명단 전체의 행 — `onlyCompanyId` 를 주면 실적·주가는 그 회사만 읽는다(상세 화면 속도 · 2026-11-11).
 * 회사 이름(합산 동료 이름에 쓴다)과 비중은 그래도 전체가 필요해 전체로 둔다 — 나머지 회사의 실적·주가 칸은 비어 있다.
 */
async function buildRows(
  accounts: AccountRow[],
  onlyCompanyId?: string
): Promise<{ rows: BuiltRow[]; windowLabel: string }> {
  const ids = accounts.map((a) => a.company_id);
  const dataIds = onlyCompanyId ? [onlyCompanyId] : ids;
  const [companies, financials, prices, shares] = await Promise.all([
    fetchCompanies(ids),
    fetchFinancials(dataIds),
    fetchPrices(dataIds),
    getShareResult(),
  ]);
  const rows: BuiltRow[] = [];
  for (const a of accounts) {
    const c = companies.get(a.company_id);
    if (!c) continue; // hidden·병합된 회사는 명단에 남아도 화면에서 뺀다
    const earnings = buildEarnings(financials.get(a.company_id) ?? []);
    rows.push({
      account: a,
      domestic: c.dart_corp_code != null,
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
        latestQuarter: latestQuarterOf(earnings),
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

export interface CustomerTab {
  slug: string;
  name_kr: string;
}

/** 상단 탭 명단 — 요약 표 순서(display_order) · 이름·slug 만(비중 등 다른 사외비 칸은 싣지 않는다). */
export async function getCustomerTabs(): Promise<CustomerTab[]> {
  'use cache';
  cacheLife('days');
  cacheTag('customer_accounts');
  // companies 태그는 일부러 안 단다 — 실시간 주가 수집(collect_prices_live · 평일 매시간)이 companies 의 현재가 칸을 고칠 때마다
  // 이 캐시가 통째로 버려진다. 여기서 읽는 칸(이름·티커·통화·나라·상태)은 거의 안 바뀌어 cacheLife('days') 로 충분하다(2026-11-13).
  const accounts = await fetchAccounts();
  const companies = await fetchCompanies(accounts.map((a) => a.company_id));
  return accounts.flatMap((a) => {
    const c = companies.get(a.company_id);
    // hidden·병합된 회사는 요약 표처럼 뺀다(buildRows 와 같은 판정).
    return c ? [{ slug: a.slug, name_kr: c.name_kr ?? c.name }] : [];
  });
}

export async function getCustomersOverview(): Promise<CustomersOverview> {
  'use cache';
  cacheLife('days');
  cacheTag('customer_accounts');
  cacheTag('pnl_entries');
  cacheTag('financials');
  cacheTag('stock_prices');
  // companies 태그는 일부러 안 단다 — 실시간 주가 수집(collect_prices_live · 평일 매시간)이 companies 의 현재가 칸을 고칠 때마다
  // 이 캐시가 통째로 버려진다. 여기서 읽는 칸(이름·티커·통화·나라·상태)은 거의 안 바뀌어 cacheLife('days') 로 충분하다(2026-11-13).
  cacheTag('customer_documents');
  cacheTag('customer_guidance');
  cacheTag('customer_volume_ir');
  cacheTag('customer_reported_results');
  cacheTag('customer_earnings_dates');
  cacheTag('customer_collect_status');
  cacheTag('customer_doc_summaries');
  // exchange_rates 태그는 일부러 안 단다 — 환율 수집이 매시간 돌아 태그를 달면 이 무거운 캐시가 매시간 버려진다
  // (docs/isr-write-optimization.md ⑤ 와 같은 꼴). 원화 칸은 끝난 분기의 평균 환율이라 cacheLife('days') 로 충분하다.
  const accounts = await fetchAccounts();
  const ids = accounts.map((a) => a.company_id);
  const [{ rows, windowLabel }, guidance, dates, reported, importantDocs] = await Promise.all([
    buildRows(accounts),
    fetchGuidance(ids),
    fetchEarningsDates(ids),
    fetchReportedMany(ids),
    fetchImportantDocSummaries(ids),
  ]);
  // SHORTCUT: 「30일 안」 판정이 캐시 시점의 오늘이라 cacheLife('days') 동안 하루쯤 늦게 빠질 수 있다
  //   → 정확히 하려면 후보 목록을 넘기고 화면이 todaySeoul() 로 고른다(「다음 실적」 nextEarnings 꼴).
  const today = todaySeoul();
  // 실적 칸은 상세와 같은 규칙(결정 R6) — 해외는 회사 공시 우선, 국내는 financials 그대로.
  const picked = rows.map((x) => {
    const id = x.row.company_id;
    const earnings = x.domestic
      ? x.earnings
      : pickCustomerEarnings(id, x.earnings, reported.get(id) ?? []);
    return { x, earnings, q: latestQuarterOf(earnings) };
  });
  const currencies = [
    ...new Set(
      picked.flatMap((p) =>
        p.earnings.currency && p.earnings.currency !== 'KRW' ? [p.earnings.currency] : []
      )
    ),
  ];
  const rates = await fetchRates(currencies);
  return {
    windowLabel,
    rows: picked.map(({ x, earnings, q }) => ({
      ...x.row,
      latestQuarter: q,
      earningsCurrency: earnings.currency,
      // 결정 R5 — 그 분기 일별 환율 평균으로 원화 환산.
      revenueKrw:
        q && q.fiscal_quarter != null
          ? revenueKrw(
              q.revenue_bn,
              earnings.currency,
              rates.get(earnings.currency ?? '') ?? [],
              q.fiscal_year,
              q.fiscal_quarter
            )
          : null,
      ir: overviewIr(
        // 통화 null 전망 = 회사 보고 통화 — 상세 카드(getCustomerIr)와 같은 판정이라야 「십억」 뒤에 통화 이름이 붙고 카드 묶음도 같다.
        latestGuidanceChangeWithCard(
          guidance.get(x.row.company_id) ?? [],
          currentYear(),
          reportCurrencyOf(reported.get(x.row.company_id) ?? [])
        ),
        earnings,
        dates.get(x.row.company_id) ?? [],
        recentDocOf(pickRecentImportant(importantDocs.get(x.row.company_id) ?? [], today))
      ),
    })),
  };
}

/**
 * 요약 표 공식 문서 열 — 최근 변경 + 그 카드의 신호등 색(상세 카드와 같은 판정 · 전년 실적 = 상세와 같은 고른 실적).
 * 화살표 색은 방향이 아니라 이 색을 쓴다(2026-11-11 사용자 선택 — 연초보다 낮은데 「상향 ▲ 초록」으로 보이지 않게).
 */
function overviewIr(
  hit: ReturnType<typeof latestGuidanceChangeWithCard>,
  earnings: CustomerEarnings,
  earningsDates: EarningsDateRow[],
  recentDoc: RecentDoc | null
): CustomerOverviewIr {
  if (!hit) return { guidanceChange: null, guidanceSignal: null, earningsDates, recentDoc };
  const fy = Number(hit.card.period.replace(/^FY/, ''));
  const prior = earnings.annual.find((p) => p.fiscal_year === fy - 1) ?? null;
  return {
    guidanceChange: hit.change,
    guidanceSignal: guidanceSignal(hit.card, prior, earnings.currency).color,
    earningsDates,
    recentDoc,
  };
}

function recentDocOf(d: DocSummary | null): RecentDoc | null {
  return d
    ? {
        docId: d.docId,
        docType: d.docType,
        title: d.title,
        publishedAt: d.publishedAt,
        reason: d.importanceReason,
      }
    : null;
}

/** 통화별 원화 일별 환율(전전년 1월부터 — 최근 분기 환산에 충분). 정렬 = PK(base, quote, rate_date) — quote 는 KRW 하나. */
async function fetchRates(currencies: string[]): Promise<Map<string, RateRow[]>> {
  if (currencies.length === 0) return new Map();
  const sb = createSupabaseAnonClient();
  const rows = await fetchAllPages('exchange_rates', (from, to) =>
    sb
      .from('exchange_rates')
      .select('base,rate_date,rate')
      .in('base', currencies)
      .eq('quote', 'KRW')
      .gte('rate_date', `${currentYear() - 2}-01-01`)
      .order('base', { ascending: true })
      .order('rate_date', { ascending: true })
      .range(from, to)
  );
  const out = new Map<string, RateRow[]>();
  for (const r of rows)
    out.set(r.base, [...(out.get(r.base) ?? []), { rate_date: r.rate_date, rate: Number(r.rate) }]);
  return out;
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

// 끝의 customer_documents(doc_type) = document_id 외래키로 문서 종류를 함께 읽는다(요약 표 「(날짜 문서종류)」).
const GUIDANCE_COLS =
  'id,company_id,metric,metric_label,period,low,high,value_text,unit,basis,currency,stated,direction,extractor,quote,published_at,verified,customer_documents(doc_type)';

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
    doc_type: r.customer_documents?.doc_type ?? null,
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

/** 지역·차종·점유율 — verified 만 · 문서 제목·URL 은 document_id 외래키로. 정렬 = PK(id). */
async function fetchBreakdown(companyId: string): Promise<BreakdownRow[]> {
  const rows = await fetchAllPages('customer_breakdown_ir', (from, to) =>
    confidentialDb
      .from('customer_breakdown_ir')
      .select(
        'document_id,page,kind,metric,label_raw,label_ko,period_grain,period,value,unit,definition,published_at,customer_documents(title,url)'
      )
      .eq('company_id', companyId)
      .eq('verified', true)
      .order('id', { ascending: true })
      .range(from, to)
  );
  return rows.map((r) => ({
    document_id: r.document_id,
    page: r.page,
    kind: r.kind as BreakdownRow['kind'],
    metric: r.metric,
    label_raw: r.label_raw,
    label_ko: r.label_ko,
    period_grain: r.period_grain as BreakdownRow['period_grain'],
    period: r.period,
    value: Number(r.value),
    unit: r.unit as BreakdownRow['unit'],
    definition: r.definition,
    published_at: r.published_at,
    doc_title: r.customer_documents?.title ?? null,
    doc_url: r.customer_documents?.url ?? null,
  }));
}

/** 검증된 회사 공시 실적 행 — 회사별. 정렬 = PK 전체(company_id, period_grain, period, metric). */
async function fetchReportedMany(ids: string[]): Promise<Map<string, ReportedRow[]>> {
  const rows = await fetchAllPages('customer_reported_results', (from, to) =>
    confidentialDb
      .from('customer_reported_results')
      .select('company_id,period_grain,period,metric,metric_name,basis,value,unit,currency')
      .in('company_id', ids)
      .eq('verified', true)
      .order('company_id', { ascending: true })
      .order('period_grain', { ascending: true })
      .order('period', { ascending: true })
      .order('metric', { ascending: true })
      .range(from, to)
  );
  return groupBy(rows, (r) => ({
    period_grain: r.period_grain as ReportedRow['period_grain'],
    period: r.period,
    metric: r.metric,
    metric_name: r.metric_name,
    basis: r.basis as ReportedRow['basis'],
    value: Number(r.value),
    unit: r.unit as ReportedRow['unit'],
    currency: r.currency,
  }));
}

async function fetchReported(companyId: string): Promise<ReportedRow[]> {
  return (await fetchReportedMany([companyId])).get(companyId) ?? [];
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

const DOC_SUMMARY_COLS =
  'doc_id,company_id,importance,importance_reason,lines,pages,customer_documents(doc_type,title,url,published_at)';

/** 공식 문서 요약 — status ok 만(check_failed 는 화면에 안 낸다 · 틀린 요약보다 빈칸). 정렬 = PK(doc_id). */
async function fetchDocSummaryRows(companyIds: string[], importance?: 'high') {
  return fetchAllPages('customer_doc_summaries', (from, to) => {
    let q = confidentialDb
      .from('customer_doc_summaries')
      .select(DOC_SUMMARY_COLS)
      .in('company_id', companyIds)
      .eq('status', 'ok');
    if (importance) q = q.eq('importance', importance);
    return q.order('doc_id', { ascending: true }).range(from, to);
  });
}

async function fetchDocSummaries(companyId: string): Promise<DocSummary[]> {
  const rows = await fetchDocSummaryRows([companyId]);
  return rows
    .flatMap((r) => {
      const d = toDocSummary(r);
      return d ? [d] : [];
    })
    .sort(byRecent)
    .slice(0, 30);
}

/** 요약 표용 — 회사별 중요도 상 요약(「최근 중요 문서」 후보). */
async function fetchImportantDocSummaries(
  companyIds: string[]
): Promise<Map<string, DocSummary[]>> {
  const out = new Map<string, DocSummary[]>();
  if (companyIds.length === 0) return out;
  for (const r of await fetchDocSummaryRows(companyIds, 'high')) {
    const d = toDocSummary(r);
    if (d) out.set(r.company_id, [...(out.get(r.company_id) ?? []), d]);
  }
  return out;
}

async function fetchNewsWeeks(companyId: string): Promise<NewsWeek[]> {
  const { data, error } = await confidentialDb
    .from('customer_news_weekly')
    .select('week_start,lines,links')
    .eq('company_id', companyId)
    .eq('status', 'ok')
    .order('week_start', { ascending: false })
    .limit(4);
  if (error) throw new Error(`customer_news_weekly 조회 실패: ${error.message}`);
  return (data ?? []).flatMap((r) => {
    const w = toNewsWeek(r);
    return w ? [w] : [];
  });
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
  // companies 태그는 일부러 안 단다 — 실시간 주가 수집(collect_prices_live · 평일 매시간)이 companies 의 현재가 칸을 고칠 때마다
  // 이 캐시가 통째로 버려진다. 여기서 읽는 칸(이름·티커·통화·나라·상태)은 거의 안 바뀌어 cacheLife('days') 로 충분하다(2026-11-13).
  cacheTag('customer_documents');
  cacheTag('customer_guidance');
  cacheTag('customer_volume_ir');
  cacheTag('customer_reported_results');
  cacheTag('customer_earnings_dates');
  cacheTag('customer_collect_status');
  cacheTag('customer_doc_summaries');
  cacheTag('customer_news_weekly');
  cacheTag('customer_breakdown_ir');
  const account = (await fetchAccounts()).find((a) => a.slug === slug);
  if (!account) return null;
  const id = account.company_id;
  const [
    companies,
    documents,
    guidance,
    volume,
    reported,
    dates,
    collectStatus,
    docSummaries,
    newsWeeks,
    breakdownRows,
  ] = await Promise.all([
    fetchCompanies([id]),
    fetchDocuments(id),
    fetchGuidance([id]),
    fetchVolume(id),
    fetchReported(id),
    fetchEarningsDates([id]),
    fetchCollectStatus(id),
    fetchDocSummaries(id),
    fetchNewsWeeks(id),
    fetchBreakdown(id),
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
    docSummaries,
    newsWeeks,
    breakdown: buildBreakdown(breakdownRows),
  };
}

/**
 * 차종 모드의 월 행(나라별) — 판매 = 판매 시장별 · 생산 = 공장 국가별(합만 쓰니 의미 차이는 상관없다 · docs/oem-collection.md).
 * 🔴 차종명이 MarkLines 표기와 한 글자라도 다르면 에러 없이 0행이다 — 값을 넣을 때 차종마다 행 수를 확인한다.
 */
async function fetchModelMonths(
  kind: 'sales' | 'production',
  group: string,
  models: string[]
): Promise<ModelMonthRow[]> {
  const sb = createSupabaseAnonClient();
  const out: ModelMonthRow[] = [];
  for (let from = 0; ; from += PAGE) {
    // .range() 는 PK 전체로 정렬해야 페이지 경계에서 행이 빠지지 않는다(AGENTS 「.range() 다중 페이지」).
    const q =
      kind === 'sales'
        ? sb.from('oem_sales_model_country_month').select('model,country,year_month,value:sales')
        : sb
            .from('oem_production_model_country_month')
            .select('model,country,year_month,value:production');
    const { data, error } = await q
      .eq('oem_group', group)
      .in('model', models)
      .order('model', { ascending: true })
      .order('country', { ascending: true })
      .order('year_month', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`MarkLines 차종 ${kind} 조회 실패: ${error.message}`);
    out.push(
      ...(data ?? []).map((r) => ({
        model: r.model,
        year_month: r.year_month,
        value: Number(r.value),
      }))
    );
    if (!data || data.length < PAGE) break;
  }
  return out;
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
  // companies 태그는 일부러 안 단다 — 실시간 주가 수집(collect_prices_live · 평일 매시간)이 companies 의 현재가 칸을 고칠 때마다
  // 이 캐시가 통째로 버려진다. 여기서 읽는 칸(이름·티커·통화·나라·상태)은 거의 안 바뀌어 cacheLife('days') 로 충분하다(2026-11-13).
  cacheTag('oem_sales_group_month');
  cacheTag('oem_sales_model_country_month');
  cacheTag('oem_production_model_country_month');
  const accounts = await fetchAccounts();
  const target = accounts.find((a) => a.slug === slug);
  if (!target) return null;
  // 비중 분모·합산 동료 이름은 전체 명단에 걸려 있어 전체로 · 실적·주가는 이 회사만 읽는다.
  const { rows, windowLabel } = await buildRows(accounts, target.company_id);
  const hit = rows.find((x) => x.row.slug === slug);
  if (!hit) return null;

  const group = hit.account.marklines_group;
  // 차종 모드 — 묶음 그룹(단독 그룹 없음) 안의 회사는 그룹 전체가 아니라 그 회사 차종 합(마이그레이션 20261112000002).
  const models =
    group && hit.account.marklines_models?.length ? hit.account.marklines_models : null;
  let volume: CustomerDetail['volume'] = {
    group,
    models,
    missingModels: [],
    monthly: [],
    annual: [],
    kpi: null,
    modelTable: null,
  };
  if (group) {
    const [modelSales, modelProduction] = models
      ? await Promise.all([
          fetchModelMonths('sales', group, models),
          fetchModelMonths('production', group, models),
        ])
      : [[], []];
    const saleRows = groupMonthToSaleRows(
      models ? modelMonthsToGroupMonth(modelSales, group) : await fetchGroupMonth(group),
      group
    );
    // 차종명은 철자가 어긋나면 조용히 0행 — 판매·생산 어느 쪽에도 없는 이름은 화면에 알린다(Codex 2026-11-12).
    const found = new Set([...modelSales, ...modelProduction].map((r) => r.model));
    volume = {
      ...volume,
      missingModels: models ? models.filter((m) => !found.has(m)) : [],
      // 판매가 0행이어도 생산 표는 그린다(함수는 갈래를 따로 본다).
      modelTable: models ? modelQuarterTable(modelProduction, modelSales) : null,
    };
    // 그룹은 있는데 판매 행이 0개면 「0대」 KPI 대신 kpi null — 화면이 「자료가 아직 없다」를 띄운다.
    if (saleRows.length > 0) {
      volume = {
        ...volume,
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
