/**
 * 챗봇 도구 화이트리스트.
 *
 * 원칙:
 *   1) 각 도구는 화이트리스트된 정형 인자만 받는다 (LLM 임의 SQL 금지).
 *   2) 실행은 anon Supabase 클라이언트로만 (RLS로 이미 보호된 공개 테이블).
 *   3) LIMIT 강제 (max 50).
 *   4) mobility 역할은 hansae 관련 데이터 차단.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import type { UserRole } from './types';

const MAX_LIMIT = 50;
const HANSAE_TICKERS = ['016450', '105630', '069640', '053280'];

function isMobilityRestricted(role: UserRole, ticker?: string | null): boolean {
  return role === 'mobility' && !!ticker && HANSAE_TICKERS.includes(ticker);
}

// ── Anthropic Tool 정의 (LLM에 노출) ──────────────────────────────────────

export const CHAT_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'query_companies',
    description:
      '회사 정보 검색. name/name_kr/ticker로 부분 일치 검색, 그룹·국가 필터 가능. ' +
      '최신 주가·시가총액·사업 요약·홈페이지 URL 반환.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '회사명·티커 부분 일치 (예: "현대모비스", "012330")',
        },
        group: { type: 'string', description: '그룹명 정확 일치 (예: "현대차", "서한")' },
        country: { type: 'string', description: '국가 코드 (KR/US/JP 등)' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: 10 },
      },
    },
  },
  {
    name: 'query_financials',
    description:
      '회사의 재무 (매출·영업이익·순이익·총자산·부채·자본·ROE/ROA/PER/PBR 등). ' +
      'period_type=annual은 fiscal_year 기준, quarterly는 fiscal_year+fiscal_quarter 기준.',
    input_schema: {
      type: 'object',
      properties: {
        company_ticker: { type: 'string', description: '6자리 ticker 또는 비상장사 명칭 ticker' },
        period_type: { type: 'string', enum: ['annual', 'quarterly'] },
        from_year: { type: 'integer', description: '시작 fiscal_year (포함). 미지정 시 최근 5년' },
        to_year: { type: 'integer', description: '종료 fiscal_year (포함)' },
      },
      required: ['company_ticker', 'period_type'],
    },
  },
  {
    name: 'query_stock_prices',
    description: '회사 일봉 주가 (OHLCV) 조회. 기간을 좁히면 응답 행 수가 줄어 토큰 절약.',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: '6자리 ticker' },
        from: { type: 'string', description: '시작일 YYYY-MM-DD' },
        to: { type: 'string', description: '종료일 YYYY-MM-DD' },
      },
      required: ['ticker', 'from', 'to'],
    },
  },
  {
    name: 'query_news',
    description: '뉴스 검색. ticker로 회사 한정 또는 keyword로 전체 검색. published_at 내림차순.',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string' },
        keyword: { type: 'string', description: '제목/요약 부분 일치' },
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: 10 },
      },
    },
  },
  {
    name: 'query_oem_sales',
    description:
      'OEM 자동차 판매량 조회. scope별로 다른 테이블 매핑:\n' +
      '- group: 그룹사 전체 월별 판매량 (oem_sales_group_month)\n' +
      '- group_country: 그룹×국가 (oem_sales_group_country_month)\n' +
      '- model_country: 모델×국가 (oem_sales_model_country_month)\n' +
      '- group_pt: 그룹×파워트레인 (oem_sales_group_pt_month)\n' +
      'year_month는 YYYYMM 정수 (예: 202504 = 2025년 4월).',
    input_schema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['group', 'group_country', 'model_country', 'group_pt'] },
        oem_group: { type: 'string', description: '예: "현대차", "기아", "도요타"' },
        country: { type: 'string', description: '예: "한국", "미국"' },
        model: { type: 'string' },
        powertrain: { type: 'string', description: '예: "BEV", "HEV", "ICE"' },
        from_ym: { type: 'integer', description: 'YYYYMM 정수 시작 (예: 202401)' },
        to_ym: { type: 'integer', description: 'YYYYMM 정수 종료 (예: 202512)' },
        top: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: 10 },
      },
      required: ['scope'],
    },
  },
  {
    name: 'query_macro_series',
    description:
      '매크로 시계열 (해운지수·철강가격·원자재 등) 조회. ' +
      'series_code는 market_series 테이블의 코드.',
    input_schema: {
      type: 'object',
      properties: {
        series_code: { type: 'string', description: '예: "BDI", "HRC_CHINA", "DUBAI_OIL"' },
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: 30 },
      },
      required: ['series_code'],
    },
  },
  {
    name: 'query_pnl',
    description:
      '**한세모빌리티 손익(PnL) 조회 — /management 페이지의 데이터 소스**. ' +
      '고객사·제품·사업부·공장·기간별 매출(revenue), 영업이익(op_income), ' +
      '재료비(material_cost), 노무비(labor_cost), 경비(expense), 판관비(sga), ' +
      'R&D 비용을 단위 mwon(백만원)으로 반환. ' +
      'basis=consolidated가 그룹 연결 기준 (default), standalone은 별도 기준. ' +
      '고객사 예: VW NA, VW EU, Stellantis NA, Stellantis EU, GMK, GM 직수출, ' +
      'UZ Auto, RIVIAN, Vinfast, POLARIS, HKMC, KG모빌리티, Porsche, 군수사업. ' +
      'include_plan=true면 계획(plan) 값까지 포함, default false는 실적만.',
    input_schema: {
      type: 'object',
      properties: {
        basis: {
          type: 'string',
          enum: ['standalone', 'consolidated'],
          description: '별도(standalone) 또는 연결(consolidated). default consolidated',
        },
        customers: {
          type: 'array',
          items: { type: 'string' },
          description: '고객사 정확 일치 필터 (예: ["VW NA", "VW EU"])',
        },
        products: { type: 'array', items: { type: 'string' } },
        divisions: { type: 'array', items: { type: 'string' } },
        factories: { type: 'array', items: { type: 'string' } },
        from_year: { type: 'integer', minimum: 2020, maximum: 2100 },
        from_month: { type: 'integer', minimum: 1, maximum: 12 },
        to_year: { type: 'integer', minimum: 2020, maximum: 2100 },
        to_month: { type: 'integer', minimum: 1, maximum: 12 },
        include_plan: {
          type: 'boolean',
          description: 'false(default)=실적만, true=계획·예상까지 포함',
        },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
      },
    },
  },
];

// ── Zod 입력 스키마 (런타임 재검증) ────────────────────────────────────────

const QueryCompaniesInput = z.object({
  query: z.string().trim().min(1).max(100).optional(),
  group: z.string().trim().max(50).optional(),
  country: z.string().trim().max(10).optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(10),
});

const QueryFinancialsInput = z.object({
  company_ticker: z.string().trim().min(1).max(50),
  period_type: z.enum(['annual', 'quarterly']),
  from_year: z.number().int().min(1990).max(2100).optional(),
  to_year: z.number().int().min(1990).max(2100).optional(),
});

const QueryStockPricesInput = z.object({
  ticker: z.string().trim().min(1).max(20),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const QueryNewsInput = z.object({
  ticker: z.string().trim().max(20).optional(),
  keyword: z.string().trim().max(100).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(10),
});

const QueryOemSalesInput = z.object({
  scope: z.enum(['group', 'group_country', 'model_country', 'group_pt']),
  oem_group: z.string().trim().max(50).optional(),
  country: z.string().trim().max(50).optional(),
  model: z.string().trim().max(100).optional(),
  powertrain: z.string().trim().max(20).optional(),
  from_ym: z.number().int().min(199001).max(210012).optional(),
  to_ym: z.number().int().min(199001).max(210012).optional(),
  top: z.number().int().min(1).max(MAX_LIMIT).default(10),
});

const QueryMacroSeriesInput = z.object({
  series_code: z.string().trim().min(1).max(50),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(30),
});

const QueryPnlInput = z.object({
  basis: z.enum(['standalone', 'consolidated']).default('consolidated'),
  customers: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  products: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  divisions: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  factories: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  from_year: z.number().int().min(2020).max(2100).optional(),
  from_month: z.number().int().min(1).max(12).optional(),
  to_year: z.number().int().min(2020).max(2100).optional(),
  to_month: z.number().int().min(1).max(12).optional(),
  include_plan: z.boolean().default(false),
  limit: z.number().int().min(1).max(200).default(100),
});

// ── 실행기 ────────────────────────────────────────────────────────────────

async function runQueryCompanies(input: unknown): Promise<unknown> {
  const args = QueryCompaniesInput.parse(input);
  const sb = createSupabaseAnonClient();
  let q = sb
    .from('companies')
    .select(
      'id,ticker,name,name_kr,country,market,group_name,homepage_url,business_summary,last_price,last_change_pct,last_updated_at'
    )
    .eq('status', 'active')
    .limit(args.limit);
  if (args.query) {
    const term = `%${args.query}%`;
    q = q.or(`name.ilike.${term},name_kr.ilike.${term},ticker.ilike.${term}`);
  }
  if (args.group) q = q.eq('group_name', args.group);
  if (args.country) q = q.eq('country', args.country.toUpperCase());
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return { rows: data ?? [], count: data?.length ?? 0 };
}

async function runQueryFinancials(input: unknown, role: UserRole): Promise<unknown> {
  const args = QueryFinancialsInput.parse(input);
  if (isMobilityRestricted(role, args.company_ticker)) {
    return { error: 'mobility 역할은 한세 그룹 재무 조회 권한 없음' };
  }
  const sb = createSupabaseAnonClient();
  const { data: c, error: cErr } = await sb
    .from('companies')
    .select('id,name_kr,ticker,currency')
    .eq('ticker', args.company_ticker)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!c) return { error: `ticker '${args.company_ticker}' 회사 없음` };

  const fromY = args.from_year ?? new Date().getFullYear() - 4;
  const toY = args.to_year ?? new Date().getFullYear();
  const q = sb
    .from('financials')
    .select(
      'period_type,fiscal_year,fiscal_quarter,period_end_date,currency,revenue,operating_income,net_income,total_assets,total_liabilities,total_equity,roe,roa,per,pbr'
    )
    .eq('company_id', c.id)
    .eq('period_type', args.period_type)
    .gte('fiscal_year', fromY)
    .lte('fiscal_year', toY)
    .order('fiscal_year', { ascending: false })
    .order('fiscal_quarter', { ascending: false })
    .limit(MAX_LIMIT);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return { company: c, rows: data ?? [] };
}

async function runQueryStockPrices(input: unknown, role: UserRole): Promise<unknown> {
  const args = QueryStockPricesInput.parse(input);
  if (isMobilityRestricted(role, args.ticker)) {
    return { error: 'mobility 역할은 한세 그룹 주가 조회 권한 없음' };
  }
  const sb = createSupabaseAnonClient();
  const { data: c } = await sb
    .from('companies')
    .select('id,name_kr,ticker')
    .eq('ticker', args.ticker)
    .maybeSingle();
  if (!c) return { error: `ticker '${args.ticker}' 회사 없음` };
  const { data, error } = await sb
    .from('stock_prices')
    .select('trade_date,open,high,low,close,volume')
    .eq('company_id', c.id)
    .gte('trade_date', args.from)
    .lte('trade_date', args.to)
    .order('trade_date', { ascending: true })
    .limit(MAX_LIMIT);
  if (error) throw new Error(error.message);
  return { company: c, rows: data ?? [] };
}

async function runQueryNews(input: unknown, role: UserRole): Promise<unknown> {
  const args = QueryNewsInput.parse(input);
  const sb = createSupabaseAnonClient();
  let companyId: string | null = null;
  if (args.ticker) {
    if (isMobilityRestricted(role, args.ticker)) {
      return { error: 'mobility 역할은 한세 그룹 뉴스 조회 권한 없음' };
    }
    const { data: c } = await sb
      .from('companies')
      .select('id')
      .eq('ticker', args.ticker)
      .maybeSingle();
    if (!c) return { error: `ticker '${args.ticker}' 회사 없음` };
    companyId = c.id;
  }
  let q = sb
    .from('news')
    .select('title,url,source,summary,published_at,company_id')
    .order('published_at', { ascending: false })
    .limit(args.limit);
  if (companyId) q = q.eq('company_id', companyId);
  if (args.keyword) {
    const term = `%${args.keyword}%`;
    q = q.or(`title.ilike.${term},summary.ilike.${term}`);
  }
  if (args.from) q = q.gte('published_at', args.from);
  if (args.to) q = q.lte('published_at', args.to + 'T23:59:59Z');
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return { rows: data ?? [] };
}

const SCOPE_TABLE = {
  group: 'oem_sales_group_month',
  group_country: 'oem_sales_group_country_month',
  model_country: 'oem_sales_model_country_month',
  group_pt: 'oem_sales_group_pt_month',
} as const;

async function runQueryOemSales(input: unknown): Promise<unknown> {
  const args = QueryOemSalesInput.parse(input);
  const sb = createSupabaseAnonClient();
  const table = SCOPE_TABLE[args.scope];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = sb.from(table).select('*').order('year_month', { ascending: false }).limit(args.top);
  if (args.oem_group) q = q.eq('oem_group', args.oem_group);
  if (args.country && (args.scope === 'group_country' || args.scope === 'model_country')) {
    q = q.eq('country', args.country);
  }
  if (args.model && args.scope === 'model_country') q = q.eq('model', args.model);
  if (args.powertrain && args.scope === 'group_pt') q = q.eq('powertrain', args.powertrain);
  if (args.from_ym) q = q.gte('year_month', args.from_ym);
  if (args.to_ym) q = q.lte('year_month', args.to_ym);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return { scope: args.scope, table, rows: data ?? [] };
}

async function runQueryPnl(input: unknown): Promise<unknown> {
  const args = QueryPnlInput.parse(input);
  const sb = createSupabaseAnonClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = sb
    .from('pnl_entries')
    .select(
      'basis,period_year,period_month,sil,division,factory,product,customer,revenue,material_cost,labor_cost,expense,sga,rnd,op_income,is_plan,is_estimate',
    )
    .eq('basis', args.basis)
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false })
    .limit(args.limit);

  if (!args.include_plan) {
    q = q.eq('is_plan', false);
  }
  if (args.customers && args.customers.length > 0) q = q.in('customer', args.customers);
  if (args.products && args.products.length > 0) q = q.in('product', args.products);
  if (args.divisions && args.divisions.length > 0) q = q.in('division', args.divisions);
  if (args.factories && args.factories.length > 0) q = q.in('factory', args.factories);

  // 기간 필터: (period_year, period_month) ≥ (from_y, from_m) AND ≤ (to_y, to_m)
  // PostgREST는 복합 조건 어려워서 단순화: year 범위 + month는 LLM이 결과로 필터링
  if (args.from_year) q = q.gte('period_year', args.from_year);
  if (args.to_year) q = q.lte('period_year', args.to_year);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  // 클라이언트에서 month 정확히 컷
  let rows = (data ?? []) as Array<{
    period_year: number;
    period_month: number;
    [k: string]: unknown;
  }>;
  if (args.from_year && args.from_month) {
    rows = rows.filter(
      (r) =>
        r.period_year > args.from_year! ||
        (r.period_year === args.from_year && r.period_month >= args.from_month!),
    );
  }
  if (args.to_year && args.to_month) {
    rows = rows.filter(
      (r) =>
        r.period_year < args.to_year! ||
        (r.period_year === args.to_year && r.period_month <= args.to_month!),
    );
  }

  return {
    basis: args.basis,
    unit: 'mwon (백만원)',
    note: '한세모빌리티 손익 (pnl_entries 테이블, /management 페이지). revenue·op_income·material_cost 등 모두 백만원 단위.',
    rows,
    count: rows.length,
  };
}

async function runQueryMacroSeries(input: unknown): Promise<unknown> {
  const args = QueryMacroSeriesInput.parse(input);
  const sb = createSupabaseAnonClient();
  let q = sb
    .from('market_series_daily')
    .select('series_code,trade_date,close')
    .eq('series_code', args.series_code)
    .order('trade_date', { ascending: false })
    .limit(args.limit);
  if (args.from) q = q.gte('trade_date', args.from);
  if (args.to) q = q.lte('trade_date', args.to);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return { rows: data ?? [] };
}

// ── 디스패처 ─────────────────────────────────────────────────────────────

export async function runTool(name: string, input: unknown, role: UserRole): Promise<unknown> {
  switch (name) {
    case 'query_companies':
      return runQueryCompanies(input);
    case 'query_financials':
      return runQueryFinancials(input, role);
    case 'query_stock_prices':
      return runQueryStockPrices(input, role);
    case 'query_news':
      return runQueryNews(input, role);
    case 'query_oem_sales':
      return runQueryOemSales(input);
    case 'query_macro_series':
      return runQueryMacroSeries(input);
    case 'query_pnl':
      return runQueryPnl(input);
    default:
      return { error: `unknown tool: ${name}` };
  }
}
