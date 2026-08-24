/** 주가 페이지(/etc/stock-prices) 셀렉터 후보 회사 메타 — client-safe */
export interface StockCompany {
  id: string;
  ticker: string | null;
  name: string;
  name_kr: string;
  country: string;
}

/**
 * 연간 재무 데이터 (financials 테이블 annual 행).
 *
 * 뷰의 `financials_by_year` jsonb 는 이보다 많은 필드(eps·total_liabilities·
 * total_equity)를 담고 있지만 화면이 읽지 않는다. mapper 의 trimFinancialYears()
 * 가 잘라내므로 여기엔 실제로 쓰는 것만 선언한다 — ISR write 는 payload 크기
 * 기준 과금이라 안 쓰는 바이트가 그대로 비용이 된다(docs/isr-write-optimization.md).
 */
export interface FinancialYear {
  revenue: number | null;
  operating_income: number | null;
  operating_margin: number | null;
  debt_ratio: number | null;
  inventory: number | null;
  per: number | null;
  pbr: number | null;
  ev_ebitda: number | null;
}

export interface ProductItem {
  name: string;
  category?: string;
  share_pct?: number;
}

export interface CustomerItem {
  name: string;
  logo_url?: string;
}

/** 가장 최근 분기 실적 (전년 동기 비교용 prev_* 포함) */
export interface LatestQuarter {
  fiscal_year: number;
  fiscal_quarter: number;
  revenue: number | null;
  operating_income: number | null;
  operating_margin: number | null;
  /** 전년 동기 매출 (YOY 계산용) */
  prev_revenue: number | null;
  /** 전년 동기 영업이익 (YOY 계산용) */
  prev_operating_income: number | null;
  /** 전년 동기 영업이익률 (pp 차이 계산용) */
  prev_operating_margin: number | null;
}

/** related_stocks_view 한 행 */
export interface RelatedStockRow {
  id: string;
  ticker: string | null;
  name: string;
  name_kr: string;
  market: string | null;
  country: string;
  currency: string;
  status: string;
  company_type: 'OEM' | '부품사' | null;
  region: string | null;
  products: ProductItem[];
  customers: CustomerItem[];
  last_price: number | null;
  last_change_pct: number | null;
  last_updated_at: string | null;
  market_cap: number | null;
  /**
   * ⚠️ business_summary·summary_updated_at 는 여기 두지 않는다.
   * 펼침 행에서만 쓰는데 전 행에 실으면 ISR payload 가 커진다(3뷰 합 283KB).
   * 펼칠 때 useCompanySummary 훅이 받아온다 → docs/isr-write-optimization.md
   */
  homepage_url: string | null;
  /** 주가/시총 환산용 — companies.currency 기준 (1단위 → KRW) */
  fx_to_krw: number | null;
  /** 재무제표 환산용 — financials.currency 기준 (VFS처럼 주가/재무 통화가 다를 때) */
  fx_fin_to_krw: number | null;
  financials_by_year: Record<string, FinancialYear> | null;
  latest_quarter: LatestQuarter | null;
}

/** 정렬 키 — rev_YYYY / op_YYYY 는 동적 연도를 지원하는 template literal */
export type SortKey =
  | 'company_type'
  | 'name_kr'
  | 'region'
  | `rev_${string}`
  | 'cagr'
  | `op_${string}`
  | 'debt_ratio'
  | 'inv_turnover'
  | 'last_price'
  | 'market_cap_t'
  | 'per'
  | 'pbr'
  | 'ev_ebitda';

/** /domestic 페이지 행: company_type/region 대신 group_name + sales_rank */
export interface DomesticStockRow {
  id: string;
  ticker: string | null;
  name: string;
  name_kr: string;
  market: string | null;
  country: string;
  currency: string;
  status: string;
  group_name: string | null;
  company_type: string | null;
  products: ProductItem[];
  customers: CustomerItem[];
  last_price: number | null;
  last_change_pct: number | null;
  last_updated_at: string | null;
  market_cap: number | null;
  /**
   * ⚠️ business_summary·summary_updated_at 는 여기 두지 않는다.
   * 펼침 행에서만 쓰는데 전 행에 실으면 ISR payload 가 커진다(3뷰 합 283KB).
   * 펼칠 때 useCompanySummary 훅이 받아온다 → docs/isr-write-optimization.md
   */
  homepage_url: string | null;
  fx_to_krw: number | null;
  fx_fin_to_krw: number | null;
  financials_by_year: Record<string, FinancialYear> | null;
  latest_quarter: LatestQuarter | null;
  /** 최근 연도 매출 KRW환산 (정렬용 내부 키) */
  latest_revenue_krw: number | null;
  /** ROW_NUMBER OVER (ORDER BY 매출 DESC) — 1=매출 1위 */
  sales_rank: number | null;
  /**
   * 로봇 역할 태그 — /humanoid 전용. 자동차 뷰(domestic·parts-top100)에는 없어 undefined.
   * 표(DomesticTable)가 variant='humanoid'일 때만 읽는다.
   */
  robot_roles?: RobotRole[];
  /** 비상장사 기업가치(USD) — /humanoid 전용. 상장사·자동차 뷰는 undefined/null */
  valuation_usd?: number | null;
  /** 비상장사 누적 조달액(USD) — /humanoid 전용 */
  funding_total_usd?: number | null;
  /** 위 두 값의 기준일 — /humanoid 전용 */
  valuation_asof?: string | null;
}

/** /domestic 정렬 키 (구분/지역 제거 + 그룹/매출순위 추가) */
export type DomesticSortKey =
  | 'group_name'
  | 'sales_rank'
  | 'name_kr'
  | `rev_${string}`
  | 'cagr'
  | `op_${string}`
  | 'debt_ratio'
  | 'inv_turnover'
  | 'last_price'
  | 'market_cap_t'
  | 'per'
  | 'pbr'
  | 'ev_ebitda';

export type SortDir = 'asc' | 'desc';

/** 통화 환율 (1단위 → KRW) */
export interface ExchangeRates {
  USD: number | null;
  EUR: number | null;
  CNY: number | null;
}

/** 뉴스 항목 (news 테이블 한 행) */
export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string | null;
  published_at: string;
}

// ============================================================
// view Row → DTO mapping 헬퍼
// generated `Database['public']['Views'][...]['Row']` 의 모든 컬럼이 nullable로
// 와서 페이지에서 직접 사용하기 불편함. 명시적 mapping으로 jsonb narrow + null 안전.
// ============================================================
import type { ViewRow } from './database.types';

/** 화면이 실제로 읽는 재무 필드. 이 목록 밖은 ISR payload 에서 제외한다. */
const FINANCIAL_FIELDS = [
  'revenue',
  'operating_income',
  'operating_margin',
  'debt_ratio',
  'inventory',
  'per',
  'pbr',
  'ev_ebitda',
] as const satisfies readonly (keyof FinancialYear)[];

/** 표가 읽는 연도 폭 — StockCells 의 fallbackYears(최신·-1·-2·-3)와 같아야 한다. */
const FINANCIAL_YEAR_SPAN = 4;

/**
 * `financials_by_year` 를 화면이 실제로 읽는 범위로 축소한다 (ISR payload 절감).
 *
 * 뷰는 평균 4.9개년 × 11필드를 담는데 표는 4개년 × 8필드만 쓴다. 나머지는 캐시
 * payload 를 키울 뿐이고, ISR write 는 8KB 단위 크기 기준 과금이라 재기록마다
 * 곱연산으로 비용이 된다. 3개 뷰 합산 645KB → 374KB (2026-08-06 실측).
 *
 * 🔴 연도 폭을 좁히지 말 것: FinancialCells 의 부채비율·재고회전율이 최신-3년까지
 * fallback 한다. 또 stockSort.getFinancialSortValue 는 `rev_${latestYear}` 정렬에서
 * **전 연도를 훑어** 매출이 있는 가장 최근 연도를 찾으므로, 그 연도가 4년 폭 밖이면
 * 함께 보존해야 정렬이 안 바뀐다(현재 해당 회사 0곳이나 데이터가 변하면 생긴다).
 */
export function trimFinancialYears(
  fy: Record<string, FinancialYear> | null
): Record<string, FinancialYear> | null {
  if (!fy) return null;
  const years = Object.keys(fy).filter((y) => /^\d{4}$/.test(y));
  if (years.length === 0) return fy;

  const cutoff = Math.max(...years.map(Number)) - (FINANCIAL_YEAR_SPAN - 1);
  const revenueYears = years.filter((y) => fy[y]?.revenue != null).map(Number);
  const latestRevenueYear = revenueYears.length > 0 ? Math.max(...revenueYears) : null;

  const trimmed: Record<string, FinancialYear> = {};
  for (const year of years) {
    const n = Number(year);
    if (n < cutoff && n !== latestRevenueYear) continue;
    const source = fy[year] as Partial<FinancialYear> | null;
    const kept = {} as FinancialYear;
    for (const field of FINANCIAL_FIELDS) kept[field] = source?.[field] ?? null;
    trimmed[year] = kept;
  }
  return trimmed;
}

/** related_stocks_view → RelatedStockRow */
export function mapRelatedStockRow(r: ViewRow<'related_stocks_view'>): RelatedStockRow {
  return {
    id: r.id ?? '',
    ticker: r.ticker,
    name: r.name ?? '',
    name_kr: r.name_kr ?? '',
    market: r.market,
    country: r.country ?? '',
    currency: r.currency ?? '',
    status: r.status ?? '',
    company_type: r.company_type as RelatedStockRow['company_type'],
    region: r.region,
    products: (r.products ?? []) as unknown as ProductItem[],
    customers: (r.customers ?? []) as unknown as CustomerItem[],
    last_price: r.last_price,
    last_change_pct: r.last_change_pct,
    last_updated_at: r.last_updated_at,
    market_cap: r.market_cap,
    homepage_url: r.homepage_url,
    fx_to_krw: r.fx_to_krw,
    fx_fin_to_krw: r.fx_fin_to_krw,
    financials_by_year: trimFinancialYears(
      r.financials_by_year as Record<string, FinancialYear> | null
    ),
    latest_quarter: r.latest_quarter as LatestQuarter | null,
  };
}

/**
 * domestic_stocks_view → DomesticStockRow
 * (parts_top100_stocks_view · humanoid_stocks_view 도 동일 구조 — 세 뷰가 매퍼를 공유한다)
 */
export function mapDomesticStockRow(
  r:
    | ViewRow<'domestic_stocks_view'>
    | ViewRow<'parts_top100_stocks_view'>
    | ViewRow<'humanoid_stocks_view'>
): DomesticStockRow {
  return {
    id: r.id ?? '',
    ticker: r.ticker,
    name: r.name ?? '',
    name_kr: r.name_kr ?? '',
    market: r.market,
    country: r.country ?? '',
    currency: r.currency ?? '',
    status: r.status ?? '',
    group_name: r.group_name,
    company_type: (r as { company_type?: string | null }).company_type ?? null,
    products: (r.products ?? []) as unknown as ProductItem[],
    customers: (r.customers ?? []) as unknown as CustomerItem[],
    last_price: r.last_price,
    last_change_pct: r.last_change_pct,
    last_updated_at: r.last_updated_at,
    market_cap: r.market_cap,
    homepage_url: r.homepage_url,
    fx_to_krw: r.fx_to_krw,
    fx_fin_to_krw: r.fx_fin_to_krw,
    financials_by_year: trimFinancialYears(
      r.financials_by_year as Record<string, FinancialYear> | null
    ),
    latest_quarter: r.latest_quarter as LatestQuarter | null,
    latest_revenue_krw: r.latest_revenue_krw,
    sales_rank: r.sales_rank,
  };
}

// ============================================================
// /humanoid 페이지 — 휴머노이드 완성품·부품 기업
// ============================================================

/** 로봇 도메인 역할. 겸업사는 둘 다 갖는다(사용자 결정 2026-08-24). */
export type RobotRole = 'humanoid' | 'parts';

/** 역할 버튼 라벨 — 표시 순서 고정 */
export const ROBOT_ROLE_LABELS: Record<RobotRole, string> = {
  humanoid: '휴머노이드',
  parts: '부품',
};

/**
 * 휴머노이드 제품군 카테고리 11종 + 기타.
 * 🔴 정본은 DB의 `product_category_map.normalized` (마이그레이션 20260824000002).
 *    여기는 필터 UI용 사본이므로 DB 시드를 늘리면 이 배열도 같이 늘려야 한다.
 */
export const ROBOT_PRODUCT_CATEGORIES = [
  '액추에이터',
  '감속기',
  '모터',
  '볼스크류/리니어',
  '힘토크센서',
  '위치센서',
  '비전카메라',
  '제어AI칩',
  '배터리',
  '구조기구',
  '그리퍼핸드',
  '기타',
] as const;

/** /humanoid 행 — DomesticStockRow + 로봇 역할·비상장 지표 */
export interface HumanoidStockRow extends DomesticStockRow {
  /** ['humanoid'] · ['parts'] · 둘 다. 비어 있으면 역할 미지정 */
  robot_roles: RobotRole[];
  /** 비상장사 기업가치(USD). 상장사는 null — 시가총액은 market_cap */
  valuation_usd: number | null;
  /** 비상장사 누적 조달액(USD) */
  funding_total_usd: number | null;
  /** 위 두 값의 기준일 — 없으면 숫자가 언제 것인지 알 수 없다 */
  valuation_asof: string | null;
}

/** 로봇 카테고리 판정용 집합 ('기타'는 자동차·로봇 공용이라 제외) */
const ROBOT_CATEGORY_SET = new Set<string>(ROBOT_PRODUCT_CATEGORIES.filter((c) => c !== '기타'));

/**
 * 로봇 제품을 앞으로 정렬한다.
 *
 * 겸업사(현대차·인피니온 등)는 자동차 제품이 이미 여러 개 있고 로봇 제품은 뒤에 덧붙는다.
 * 그대로 두면 휴머노이드 페이지의 제품 셀에 "그랜저, 넥쏘, 쏘나타…"만 보이고
 * 정작 봐야 할 로봇 제품이 잘려 나간다. 순서만 바꾸며 항목을 버리지 않는다.
 */
function robotProductsFirst(products: ProductItem[]): ProductItem[] {
  const robot: ProductItem[] = [];
  const rest: ProductItem[] = [];
  for (const p of products) {
    (ROBOT_CATEGORY_SET.has(p.category ?? '') ? robot : rest).push(p);
  }
  return [...robot, ...rest];
}

/** humanoid_stocks_view → HumanoidStockRow (공용 매퍼 재사용 + 로봇 필드만 추가) */
export function mapHumanoidStockRow(r: ViewRow<'humanoid_stocks_view'>): HumanoidStockRow {
  const roles = (r.robot_roles ?? []).filter(
    (v): v is RobotRole => v === 'humanoid' || v === 'parts'
  );
  const base = mapDomesticStockRow(r);
  return {
    ...base,
    products: robotProductsFirst(base.products),
    robot_roles: roles,
    valuation_usd: r.valuation_usd,
    funding_total_usd: r.funding_total_usd,
    valuation_asof: r.valuation_asof,
  };
}

// ============================================================
// /oem 페이지 — MarkLines 글로벌 OEM 판매량 차트
// ============================================================

/** PowerTrain 정규화 6종 (적재 스크립트와 동일) */
export type PowerTrain = 'ICE' | 'HV' | 'PHEV' | 'EV' | 'FCV' | 'Other';

/** oem_sales_group_month 한 행 */
export interface OemSalesGroupMonth {
  oem_group: string;
  year_month: number; // YYYYMM
  sales: number;
}

/** oem_sales_group_pt_month 한 행 */
export interface OemSalesGroupPtMonth {
  oem_group: string;
  powertrain: PowerTrain | string;
  year_month: number;
  sales: number;
}

/** oem_sales_group_country_month 한 행 */
export interface OemSalesGroupCountryMonth {
  oem_group: string;
  country: string;
  year_month: number;
  sales: number;
}

/** oem_sales_country_group_year 뷰 한 행 (연·OEM·국가 사전 집계 — 국가 TOP15/매트릭스용). */
export interface OemCountryGroupYear {
  year: number;
  oem_group: string;
  country: string;
  sales: number;
}

/** oem_sales_usa_group_month 뷰 한 행 (USA OEM·월별 사전 집계 — 미국 TOP10 시계열용). */
export interface OemUsaGroupMonth {
  oem_group: string;
  year_month: number;
  sales: number;
}

/** oem_sales_type_seg_month 한 행 */
export interface OemSalesTypeSegMonth {
  vehicle_type: string;
  segment: string;
  year_month: number;
  sales: number;
}

/** oem_sales_model_country_month 한 행 */
export interface OemSalesModelCountryMonth {
  oem_group: string;
  country: string;
  model: string;
  year_month: number;
  sales: number;
}

/** 북미 핵심 차종 월별 시리즈 (서버 사전 가공 결과) */
export interface ModelMonthlySeries {
  key: string; // 'grand_cherokee' 등 slug
  label: string; // 'Grand Cherokee' 표시명
  oemGroup: string; // 'Stellantis'
  data: { ym: number; ymLabel: string; sales: number; yoy: number | null }[];
}

/** OEM 순위 행 (TOP30 YTD / TOP40 등 공통) */
export interface OemRankRow {
  rank: number;
  oem_group: string;
  sales: number;
  /** 비교 기간(전년 등) 판매량 — YoY 계산용 */
  sales_prev: number;
  /** YoY 변화율 (%, sales_prev=0이면 null) */
  yoy: number | null;
  /** 비교 기간 순위 — 등락 표시용 */
  rank_prev?: number;
  /** 순위 등락 (양수=상승, 음수=하락, 0=유지, null=신규/소실) */
  rank_change?: number | null;
}

// ============================================================
// /oem/<company> 페이지 — 회사별 IR 차종 판매 (PR2~5)
// audit 결과(data/_oem_audit_report.md): 4사 IR에 powertrain 컬럼 없음 →
// vehicle_powertrain_map(별도 테이블)에서 LEFT JOIN. NULL 허용.
// ============================================================

/** vehicle_powertrain_map CHECK 제약과 일치. 'Multi'는 같은 모델명에 다중 PT(예: 토레스 ICE+EVX). */
export type CompanyPowertrain = 'ICE' | 'HV' | 'PHEV' | 'EV' | 'FCEV' | 'Multi';

/** vehicle_powertrain_map 한 행 (4사 공통). */
export interface VehiclePowertrainMapRow {
  company_slug: 'kg-mobility' | 'hyundai' | 'kia' | 'stellantis-na';
  vehicle_model: string;
  powertrain: CompanyPowertrain;
  valid_from: string; // YYYY-MM-DD
  valid_to: string | null;
  source_note: string | null;
}

/** 4사 공통 sale 컬럼 (회사별 테이블에서 공유). */
export interface CompanySaleRow {
  period_type: 'month' | 'quarter' | 'annual';
  year_period: string;
  region: string;
  vehicle_model: string;
  vehicle_type: string;
  /** 행에 직접 박힌 PT (대개 NULL). 있으면 매핑보다 우선. */
  powertrain: CompanyPowertrain | null;
  sales_units: number;
  source_url: string | null;
}

/** kg_mobility_sales 한 행 (PR2). 추가 컬럼 없음. */
export type KgMobilitySaleRow = CompanySaleRow;

/** hyundai_sales 한 행 (PR3). 해외 공장별 보강 위해 factory 컬럼 추가. */
export interface HyundaiSaleRow extends CompanySaleRow {
  /** 해외 공장명 (예: '미국 앨라배마', '중국 베이징', '체코 노쇼비체'). 국내/총합은 ''. */
  factory: string;
}

/** kia_sales 한 행 (PR4). 해외 공장 5종 + region='CKD' (Aggregate row, 1개월=1행). */
export interface KiaSaleRow extends CompanySaleRow {
  /** 해외 공장명 ('U.S. Plant' | 'China Plants' | 'Slovakia Plant' | 'Mexico Plant' | 'India Plant'). 국내 출하는 ''. */
  factory: string;
}

/** kia_retail_sales 한 행 (현지판매실적, 13 sheets 중 month sheet 1행).
 *  plant × vehicle_model × region 단위 retail.
 *  region: Korea, U.S.A, Canada, Mexico, Europe, Eastern Europe, Latin America,
 *          Middle East, Africa, Asia Pacific, India, China (12개). */
export interface KiaRetailSaleRow {
  period_type: 'month' | 'annual';
  year_period: string;
  /** 'Korea Plants' | 'U.S. Plant' | 'Slovakia Plant' | 'Mexico Plant' | 'China Plants'
   *  | 'India Plant' | 'HMGICs Plant' | 'CKD' | 'Special Vehicle' | 'Russia Plant' */
  plant: string;
  vehicle_model: string;
  region: string;
  retail_units: number;
}

/** kia_export_regions 한 행 (PR4). region(10) × vehicle_type(6 정규화) 분해.
 *  source = export-by-region(월별 region×type) | ir-quarterly(향후 분기 IR PDF region 합). */
export interface KiaExportRegionRow {
  period_type: 'month' | 'quarter' | 'annual';
  year_period: string;
  source: 'export-by-region' | 'ir-quarterly';
  region_name: string;
  vehicle_type: string;
  sales_units: number;
}

/** Kia 차종 type mix 한 점 (월/연 토글, 100% stacked).
 *  엑셀 vehicle_type 8종(연도별 명칭 차이 포함)을 6종 카테고리로 normalize:
 *  PC(승용) / RV(SUV·CUV·MPV) / CV(상용) / SV(특장) / CKD_ex(CKD 일반) / CKD_sp(CKD 특장). */
export type KiaExportType = 'PC' | 'RV' | 'CV' | 'SV' | 'CKD_ex' | 'CKD_sp';

/** Kia 수출 차종 type mix stacked bar 한 점. */
export interface KiaExportTypeMixPoint {
  period: string;
  period_label: string;
  PC: number;
  RV: number;
  CV: number;
  SV: number;
  CKD_ex: number;
  CKD_sp: number;
  total: number;
}

/** 공장별 stacked bar 차트용 (HyundaiFactoryChart). */
export interface FactoryMixPoint {
  period: string;
  period_label: string;
  /** factory_name → 판매량 (NULL/'' 제외) */
  factories: Record<string, number>;
  total: number;
}

/** 공장별 차종 mix 한 행 (주요 5개 공장만 — Others 미합산).
 *  factory 코드(HMI/HMMA/HMMC/BHMC/HMB 등) + 차종별 판매량. */
export interface FactoryModelMixPoint {
  /** 공장 코드 (예: 'HMI', 'HMMA') */
  factory: string;
  /** 공장 위치 (예: '인도 첸나이') */
  factoryLocation: string;
  /** model_name → 판매량 (TOP N + 'Others' 합산) */
  models: Record<string, number>;
  total: number;
}

/** Hyundai 차종 type 분류 (PC=세단 / RV=SUV·CUV·MPV / Genesis=럭셔리 / CV=상용 / Other). */
export type HyundaiVehicleType = 'PC' | 'RV' | 'Genesis' | 'CV' | 'Other';

/** hyundai_export_regions 한 행 (Phase 2A). source = export-by-region(월별 세부) | ir-summary(연 합계) | ir-quarterly(분기 IR PDF p.5~6 region별 도매). */
export interface HyundaiExportRegionRow {
  period_type: 'month' | 'quarter' | 'annual';
  year_period: string;
  source: 'export-by-region' | 'ir-summary' | 'ir-quarterly';
  region_name: string;
  sales_units: number;
}

/** export-by-region stacked bar 한 점 (월/연 토글). */
export interface HyundaiExportRegionPoint {
  period: string;
  period_label: string;
  /** region_name → 판매량 */
  regions: Record<string, number>;
  total: number;
  /** 진행 중인 연도(YTD)면 true — 라벨에 'YTD' 부착 + 색상 구분용. */
  is_ytd?: boolean;
}

/** 분기별 IR region 도매 stacked bar 한 점 (천대 단위).
 *  source='ir-quarterly' AND period_type='quarter' 필터링 결과 reshape.
 *  region을 컬럼으로 펼친 recharts 친화 형식. */
export interface HyundaiQuarterlyRegionPoint {
  /** 'YYYY-QN' (예: '2026-Q1') */
  period: string;
  /** X축 표시용 (예: '26Q1') */
  period_label: string;
  /** 전 region 합계 (천대) */
  total: number;
  /** region_name(한글) → 판매량(천대). 누락 region은 키 자체 없음. */
  regions: Record<string, number>;
}

/** IR 사이트 9개 region (연 합계) vs DB(model+factory) 연 합계 cross-check 요약 문구.
 *  HyundaiIRComparisonCard 삭제 후 9-region 차트 footer에 직렬화. */
export interface HyundaiIRComparisonSummary {
  /** 가장 최근 비교 연도 (IR+DB 모두 있는). */
  latestYear: string | null;
  /** 최근 연도 IR 합계 */
  latestIrTotal: number;
  /** 최근 연도 DB 합계 */
  latestDbTotal: number;
  /** 최근 연도 차이 (IR-DB) */
  latestDiff: number;
  /** 최근 연도 차이 % */
  latestDiffPct: number | null;
  /** 행 단위 raw 데이터 (footer 텍스트 빌더용) */
  rows: { year: string; ir_total: number; db_total: number; diff: number; pct: number | null }[];
}

/** ir-summary 연 합계 한 행 (사이트 9개 region cross-check용). */
export interface HyundaiIRSummaryRow {
  year: string;
  region_name: string;
  units: number;
}

/** Hyundai 차종 type mix 한 점 (월/연 토글 — 100% stacked). */
export interface HyundaiVehicleTypeMixPoint {
  period: string;
  period_label: string;
  PC: number;
  RV: number;
  Genesis: number;
  CV: number;
  Other: number;
  total: number;
}

/** vehicle_powertrain_map join 후 PT 부착된 sale 행. */
export interface CompanySaleRowWithPt extends CompanySaleRow {
  /** 매핑 join 결과. row.powertrain ?? 매핑.powertrain ?? null */
  resolved_powertrain: CompanyPowertrain | null;
}

/** 시계열 차트 한 점 (월 또는 분기). */
export interface CompanyTimeSeriesPoint {
  /** 'YYYY-MM' | 'YYYY-Q1' | 'YYYY' — period_type에 따라 형식 다름. */
  period: string;
  /** 차트 X축 표시용: '25.01' / '2025Q1' */
  period_label: string;
  sales: number;
  /** YoY % (전년 동기 대비). 전년이 0 또는 최소 임계 미만이면 null. */
  yoy_pct: number | null;
}

/** KPI 카드 입력. */
export interface CompanyKpiSummary {
  /** 가장 최근 완료된 연도 (12월까지 데이터 있는 연도) 라벨. 예: '2025년 실적'. */
  latestYearLabel: string;
  /** 최근 완료 연도 합계. */
  latestYearSales: number;
  /** 직전 연도 라벨. 예: '2024년 실적'. */
  prevYearLabel: string;
  /** 직전 연도 합계. */
  prevYearSales: number;
  /** YoY % (직전 연도 대비). 데이터 부족 시 null. */
  yoyPct: number | null;
  /** 진행 중인 연도 라벨. 예: '2026 YTD (1~4월)' 또는 '2026 YTD (대기)'. */
  ytdLabel: string;
  /** 진행 연도 누적. 데이터 없으면 0. */
  ytdCurrent: number;
  /** 전년 동기 라벨. 예: '2025 1~4월'. */
  ytdPrevLabel: string;
  /** 전년 동기 누적. */
  ytdPrev: number;
  /** YTD YoY %. */
  ytdYoyPct: number | null;
  /** EV+PHEV+FCEV 비중 (최근 완료 연도 기준). NULL=미매핑 비중 큼. */
  evRatio: number | null;
  /** 최신 데이터 기간 라벨 (예: '2025-12'). */
  latestPeriod: string;
}

/** TOP N 차종 행. */
export interface CompanyTopModelRow {
  model: string;
  /** 최근 완료 연도 합계 (예: 2025년). */
  salesLatestPeriod: number;
  /** 직전 연도 합계 (예: 2024년). */
  salesPrevPeriod: number;
  /** 진행 연도 YTD 합계 (예: 2026 1~4월). 데이터 없으면 0. */
  ytdSales: number;
  /** YTD 대비 (예: 2026 YTD vs 2025 동일 월 합산). 없으면 null. */
  ytdYoyPct?: number | null;
  /** YTD 대비 전년 동일 월 합계 (옵션, 검증/표시용). */
  ytdPrevSales?: number;
  yoyPct: number | null;
  resolvedPt: CompanyPowertrain | null;
  /** Stellantis 같은 회사: PT 대신 brand 표시 (옵션). */
  brand?: string;
}

/** TOP N + 회사 전체 합계 (region 필터 적용). 합계 행 + 전체 대비 비중 표시용. */
export interface CompanyTopModelsResult {
  rows: CompanyTopModelRow[];
  /** 회사 전체 합계 (TOP N 외 모든 모델 포함, region 필터 적용). */
  totals: {
    latestPeriod: number;
    prevPeriod: number;
    ytd: number;
    /** YTD 전년 동기 합 — YTD YoY 계산용 (옵션). */
    ytdPrev?: number;
  };
}

// ============================================================
// Phase 2B — 현대차 분기별 IR 실적 (hyundai_quarterly_earnings)
// ============================================================

/** hyundai_quarterly_earnings 한 행 (DB 컬럼 그대로). */
export interface HyundaiQuarterlyEarningsRow {
  fiscal_year: number;
  fiscal_quarter: number;
  period_end_date: string | null;
  revenue_krw_bn: number | null;
  revenue_auto_krw_bn: number | null;
  revenue_finance_krw_bn: number | null;
  revenue_other_krw_bn: number | null;
  operating_income_krw_bn: number | null;
  operating_margin_pct: number | null;
  net_income_krw_bn: number | null;
  ebitda_krw_bn: number | null;
  global_wholesale_k_units: number | null;
  global_retail_k_units: number | null;
  domestic_wholesale_k_units: number | null;
  overseas_wholesale_k_units: number | null;
  ev_k_units: number | null;
  hev_k_units: number | null;
  phev_k_units: number | null;
  fcev_k_units: number | null;
  eco_total_k_units: number | null;
}

/** 분기 차트 한 점 — revenue(bar) + opm(line) 듀얼 축. */
export interface HyundaiQuarterlyEarningsPoint {
  /** '2025-Q1' 등 internal key */
  period: string;
  /** X축 표시용: '25Q1' */
  period_label: string;
  fiscal_year: number;
  fiscal_quarter: number;
  /** 매출 (십억원) */
  revenue_krw_bn: number | null;
  /** 영업이익률 (%) — 행에 직접 있거나 (op/rev*100). 둘 다 NULL이면 null. */
  operating_margin_pct: number | null;
  /** 영업이익 (십억원). tooltip 보조. */
  operating_income_krw_bn: number | null;
  /** 글로벌 도매 (천대). tooltip 보조. */
  global_wholesale_k_units: number | null;
}

/** 연간 실적 차트 한 점 — 분기 합산(가용 분기까지) + 가중평균 opm. */
export interface HyundaiAnnualEarningsPoint {
  /** 'YYYY' 또는 'YYYY YTD' */
  period: string;
  /** X축 표시: 'YYYY' 또는 'YYYY YTD' */
  period_label: string;
  fiscal_year: number;
  /** 가용 분기 매출 합 (십억원). NULL이면 합산 제외. */
  revenue_krw_bn: number | null;
  /** 가중 평균 영업이익률 = (영업이익 합 / 매출 합) × 100. NULL이면 null. */
  operating_margin_pct: number | null;
  /** 가용 분기 영업이익 합 (십억원) */
  operating_income_krw_bn: number | null;
  /** 가용 분기 도매 합 (천대) */
  global_wholesale_k_units: number | null;
  /** 합산된 분기 수 (4=완전한 연간, <4=YTD/부분) */
  quarters_used: number;
  /** YTD(불완전 연간) 여부 */
  is_ytd: boolean;
}

// ============================================================
// Phase 2C — 현대차 미국/유럽 소매 (hyundai_retail_sales)
// ============================================================

/** hyundai_retail_sales 한 행 (DB 컬럼 그대로). */
export interface HyundaiRetailSaleRow {
  period_type: 'month' | 'annual';
  year_period: string;
  region: 'US' | 'EU';
  vehicle_type: string;
  vehicle_model: string;
  retail_units: number | null;
  market_share: number | null;
  industry_total: number | null;
}

/** US 시장 점유율 시계열 한 점 (월별). */
export interface HyundaiMarketSharePoint {
  /** 'YYYY-MM' */
  period: string;
  /** X축 표시용: 'YY.MM' */
  period_label: string;
  /** HMC 점유율 (%, market_share × 100). null=결측. */
  market_share_pct: number | null;
  /** 시장 전체 판매 (대). null=결측. */
  industry_total: number | null;
  /** HMC 미국 retail 합계 (대). tooltip 보조. */
  hmc_retail: number | null;
}

/** 한 지역(US/EU)의 retail vs wholesale 비교 카드 데이터. */
export interface HyundaiRetailWholesaleRegionCard {
  region: 'US' | 'EU';
  /** 비교 연도 (가장 최근 retail+wholesale 둘 다 있는 연도). */
  latestYear: string;
  /** 비교 연도 retail 합계 (대). */
  retailUnits: number;
  /** 비교 연도 wholesale 합계 (대). hyundai_export_regions ir-summary 기준. */
  wholesaleUnits: number;
  /** retail/wholesale 비율 (%). wholesale 0이면 null. */
  retailOverWholesalePct: number | null;
  /** 전년 retail 대비 YoY % — 전년 합계 0 또는 결측이면 null. */
  retailYoyPct: number | null;
  /** 전년 라벨 (예: '2024'). */
  prevYear: string;
}

/** retail vs wholesale 비교 카드 전체 (US + EU). */
export interface HyundaiRetailWholesaleData {
  us: HyundaiRetailWholesaleRegionCard | null;
  eu: HyundaiRetailWholesaleRegionCard | null;
}

/** EU retail 시계열 한 점 (월별 Total + YoY). */
export interface HyundaiEuRetailPoint {
  /** 'YYYY-MM' */
  period: string;
  /** X축 표시용: 'YY.MM' */
  period_label: string;
  /** 해당 월 retail 합계 (Total row). NULL=결측. */
  retail_units: number | null;
  /** 전년 동월 대비 YoY % (전년 합계 0 또는 결측이면 null). */
  yoy_pct: number | null;
}

/** EU retail TOP 차종 한 행 (단순 막대 차트용). */
export interface HyundaiEuRetailTopModel {
  model: string;
  /** 최근 완료 연도 retail 합계 */
  retailLatest: number;
  /** 직전 연도 retail 합계 */
  retailPrev: number;
  /** YoY % */
  yoyPct: number | null;
}

/** EU retail 통합 데이터 (월별 시계열 + 차종 TOP). */
export interface HyundaiEuRetailData {
  monthlySeries: HyundaiEuRetailPoint[];
  topModels: HyundaiEuRetailTopModel[];
  /** 최근 연도 라벨 (예: '2025') — TOP 표 헤더용 */
  latestYearLabel: string;
  /** 직전 연도 라벨 */
  prevYearLabel: string;
}

/** PowerTrain mix 스택드 바 한 점. period당 PT별 판매량. */
export interface CompanyPtMixPoint {
  period: string;
  period_label: string;
  ICE: number;
  HV: number;
  PHEV: number;
  EV: number;
  FCEV: number;
  Multi: number;
  /** powertrain 매핑이 없는 차종. 화면에서 '미분류'로 표시. */
  Unknown: number;
  total: number;
}

// ============================================================
// PR5 — Stellantis NA (/oem/stellantis-na) 분기 brand·차종 판매
// 출처: prnewswire.com FCA US LLC 분기 보도자료
// audit: data/_stellantis_audit_report.md
// ============================================================

/** stellantis_na_sales 한 행 (DB 컬럼 그대로).
 *  brand='Total' & vehicle_model='Total'은 회사 합계 row (cross-check용).
 *  brand=<Jeep|Ram|...> & vehicle_model='Total'은 brand 합계 row.
 *  period_type='quarter'는 매 분기 행. period_type='year'는 Q4 PR의 CYTD 자동 적재(연 합계). */
export interface StellantisNaSaleRow {
  period_type: 'quarter' | 'year';
  /** 'YYYY-Q1'~'YYYY-Q4' (quarter) 또는 'YYYY' (year). */
  year_period: string;
  /** 'Jeep' | 'Ram' | 'Chrysler' | 'Dodge' | 'Fiat' | 'Alfa Romeo' | 'Total'(회사 합계). */
  brand: string;
  /** 'Compass'·'Wrangler'·...·'Ram LD PU'·... 자유. 'Total'은 brand·회사 합계 행. */
  vehicle_model: string;
  /** 'US' 단일 (캐나다는 별도 PR 미수집). */
  region: string;
  sales_units: number;
  /** 전년 동기 (Q-1y or Y-1) 판매량 — prnewswire 표 'Pr Yr' 컬럼. */
  sales_units_prev: number | null;
  /** prnewswire 표 'Vol % Change'. */
  yoy_pct: number | null;
  source_url: string | null;
  release_id: string | null;
  publish_date: string | null;
}

/** brand 6종 + 'Total'(회사 합계 PK). */
export type StellantisNaBrand =
  | 'Jeep'
  | 'Ram'
  | 'Chrysler'
  | 'Dodge'
  | 'Fiat'
  | 'Alfa Romeo'
  | 'Total';

/** sale rows에 PT 매핑 join (vehicle_powertrain_map). */
export interface StellantisNaSaleRowWithPt extends StellantisNaSaleRow {
  resolved_powertrain: CompanyPowertrain | null;
}

/** brand stacked bar 한 점 (분기/연 토글). */
export interface StellantisNaBrandStackPoint {
  /** 'YYYY-Q1'·'YYYY'. */
  period: string;
  /** '25Q1'·'2025' X축 라벨. */
  period_label: string;
  /** brand → 판매량 (Total 제외). */
  brands: Record<string, number>;
  /** 합계 (라벨 표시용). */
  total: number;
}
