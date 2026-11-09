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

export interface CustomersOverview {
  windowLabel: string;
  rows: CustomerOverviewRow[];
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
    .select('id,name_kr,name,ticker,currency,country')
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
      (r) => r.basis === 'consolidated' && !r.is_plan && r.period_month >= 1 && r.period_month <= 12
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
  const { rows, windowLabel } = await buildRows(await fetchAccounts());
  return { windowLabel, rows: rows.map((x) => x.row) };
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
    volume = {
      group,
      monthly: aggregateMonthlySeries(saleRows),
      annual: aggregateAnnualSeries(saleRows),
      // 그룹 월 표엔 PT 가 없어 EV 비중을 계산하지 않는다(카드에 「—」).
      kpi: { ...aggregateKpi(saleRows), evRatio: null },
    };
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
