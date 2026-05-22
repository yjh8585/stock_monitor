-- domestic_stocks_view에 company_type 컬럼 추가.
-- 사용처: components/domestic/DomesticTable.tsx 의 productCategoryFilter가 부품사만 적용되도록 분기.
--
-- 주의: CREATE OR REPLACE VIEW는 기존 컬럼 순서 변경 불가 → company_type을 마지막에 추가.

CREATE OR REPLACE VIEW domestic_stocks_view AS
WITH latest_fin_currency AS (
  SELECT DISTINCT ON (financials.company_id) financials.company_id, financials.currency
  FROM financials
  WHERE financials.period_type = 'annual'::text AND financials.currency IS NOT NULL
  ORDER BY financials.company_id, financials.fiscal_year DESC
), domestic_base AS (
  SELECT c.id, c.ticker, c.name, c.name_kr, c.market, c.country, c.currency, c.status,
    c.group_name, c.products, c.customers, c.last_price, c.last_change_pct,
    c.last_updated_at, c.market_cap, c.business_summary, c.summary_updated_at, c.homepage_url,
    COALESCE(er.rate, CASE WHEN c.currency = 'KRW'::text THEN 1 ELSE NULL::integer END::numeric) AS fx_to_krw,
    (SELECT jsonb_object_agg(f.fiscal_year::text, jsonb_build_object('revenue', f.revenue, 'operating_income', f.operating_income, 'operating_margin', f.operating_margin, 'total_liabilities', f.total_liabilities, 'total_equity', f.total_equity, 'debt_ratio', f.debt_ratio, 'inventory', f.inventory, 'eps', f.eps, 'per', f.per, 'pbr', f.pbr, 'ev_ebitda', f.ev_ebitda))
       FROM financials f WHERE f.company_id = c.id AND f.period_type = 'annual'::text AND f.fiscal_year >= 2020 AND f.fiscal_year <= (EXTRACT(year FROM now())::integer + 1)) AS financials_by_year,
    (SELECT jsonb_build_object('fiscal_year', f.fiscal_year, 'fiscal_quarter', f.fiscal_quarter, 'revenue', f.revenue, 'operating_income', f.operating_income, 'operating_margin', f.operating_margin, 'prev_revenue', (SELECT p.revenue FROM financials p WHERE p.company_id = f.company_id AND p.period_type = 'quarterly'::text AND p.fiscal_year = (f.fiscal_year - 1) AND p.fiscal_quarter = f.fiscal_quarter LIMIT 1), 'prev_operating_income', (SELECT p.operating_income FROM financials p WHERE p.company_id = f.company_id AND p.period_type = 'quarterly'::text AND p.fiscal_year = (f.fiscal_year - 1) AND p.fiscal_quarter = f.fiscal_quarter LIMIT 1), 'prev_operating_margin', (SELECT p.operating_margin FROM financials p WHERE p.company_id = f.company_id AND p.period_type = 'quarterly'::text AND p.fiscal_year = (f.fiscal_year - 1) AND p.fiscal_quarter = f.fiscal_quarter LIMIT 1))
       FROM financials f WHERE f.company_id = c.id AND f.period_type = 'quarterly'::text AND f.revenue IS NOT NULL ORDER BY f.fiscal_year DESC, f.fiscal_quarter DESC NULLS LAST LIMIT 1) AS latest_quarter,
    COALESCE(er_fin.rate, CASE WHEN COALESCE(lfc.currency, c.currency) = 'KRW'::text THEN 1 ELSE NULL::integer END::numeric) AS fx_fin_to_krw,
    (SELECT f.revenue * COALESCE(er_fin.rate, CASE WHEN COALESCE(lfc.currency, c.currency) = 'KRW'::text THEN 1 ELSE NULL::integer END::numeric)
       FROM financials f WHERE f.company_id = c.id AND f.period_type = 'annual'::text AND f.revenue IS NOT NULL ORDER BY f.fiscal_year DESC LIMIT 1) AS latest_revenue_krw,
    c.company_type
  FROM companies c
    JOIN company_pages cp ON cp.company_id = c.id AND cp.page = 'domestic'::text
    LEFT JOIN exchange_rates_live er ON er.base = c.currency AND er.quote = 'KRW'::text
    LEFT JOIN latest_fin_currency lfc ON lfc.company_id = c.id
    LEFT JOIN exchange_rates_live er_fin ON er_fin.base = COALESCE(lfc.currency, c.currency) AND er_fin.quote = 'KRW'::text
  WHERE c.status = 'active'::text
)
SELECT id, ticker, name, name_kr, market, country, currency, status, group_name,
  products, customers, last_price, last_change_pct, last_updated_at, market_cap,
  business_summary, summary_updated_at, homepage_url, fx_to_krw, financials_by_year,
  latest_quarter, fx_fin_to_krw, latest_revenue_krw,
  row_number() OVER (ORDER BY latest_revenue_krw DESC NULLS LAST, name_kr) AS sales_rank,
  company_type
FROM domestic_base d;
