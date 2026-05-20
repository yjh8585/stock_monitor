-- related_stocks_view 에 명시적 WHERE c.status = 'active' 필터 추가.
-- 배경:
--   domestic_stocks_view / parts_top100_stocks_view 는 이미 WHERE c.status='active' 명시.
--   related_stocks_view 만 누락 → merged/delisted 회사가 노출될 잠재 위험.
--   현재 데이터 진단: company_pages.page='related-stocks' 매핑 회사 26개 전부 status='active'
--   → 필터 추가 후 노출 변화 없음(회귀 0건).
-- 변경:
--   기존 정의 + JOIN 절 끝에 WHERE 한 줄 추가.

CREATE OR REPLACE VIEW related_stocks_view AS
 WITH latest_fin_currency AS (
         SELECT DISTINCT ON (financials.company_id) financials.company_id,
            financials.currency
           FROM financials
          WHERE financials.period_type = 'annual'::text AND financials.currency IS NOT NULL
          ORDER BY financials.company_id, financials.fiscal_year DESC
        )
 SELECT c.id,
    c.ticker,
    c.name,
    c.name_kr,
    c.market,
    c.country,
    c.currency,
    c.status,
    c.company_type,
    c.region,
    c.products,
    c.customers,
    c.last_price,
    c.last_change_pct,
    c.last_updated_at,
    c.market_cap,
    c.business_summary,
    c.summary_updated_at,
    c.homepage_url,
    COALESCE(er.rate,
        CASE
            WHEN c.currency = 'KRW'::text THEN 1
            ELSE NULL::integer
        END::numeric) AS fx_to_krw,
    ( SELECT jsonb_object_agg(f.fiscal_year::text, jsonb_build_object('revenue', f.revenue, 'operating_income', f.operating_income, 'operating_margin', f.operating_margin, 'total_liabilities', f.total_liabilities, 'total_equity', f.total_equity, 'debt_ratio', f.debt_ratio, 'inventory', f.inventory, 'eps', f.eps, 'per', f.per, 'pbr', f.pbr, 'ev_ebitda', f.ev_ebitda)) AS jsonb_object_agg
           FROM financials f
          WHERE f.company_id = c.id AND f.period_type = 'annual'::text AND f.fiscal_year >= 2020 AND f.fiscal_year <= (EXTRACT(year FROM now())::integer + 1)) AS financials_by_year,
    ( SELECT jsonb_build_object('fiscal_year', f.fiscal_year, 'fiscal_quarter', f.fiscal_quarter, 'revenue', f.revenue, 'operating_income', f.operating_income, 'operating_margin', f.operating_margin, 'prev_revenue', ( SELECT p.revenue
                   FROM financials p
                  WHERE p.company_id = f.company_id AND p.period_type = 'quarterly'::text AND p.fiscal_year = (f.fiscal_year - 1) AND p.fiscal_quarter = f.fiscal_quarter
                 LIMIT 1), 'prev_operating_income', ( SELECT p.operating_income
                   FROM financials p
                  WHERE p.company_id = f.company_id AND p.period_type = 'quarterly'::text AND p.fiscal_year = (f.fiscal_year - 1) AND p.fiscal_quarter = f.fiscal_quarter
                 LIMIT 1), 'prev_operating_margin', ( SELECT p.operating_margin
                   FROM financials p
                  WHERE p.company_id = f.company_id AND p.period_type = 'quarterly'::text AND p.fiscal_year = (f.fiscal_year - 1) AND p.fiscal_quarter = f.fiscal_quarter
                 LIMIT 1)) AS jsonb_build_object
           FROM financials f
          WHERE f.company_id = c.id AND f.period_type = 'quarterly'::text AND f.revenue IS NOT NULL
          ORDER BY f.fiscal_year DESC, f.fiscal_quarter DESC NULLS LAST
         LIMIT 1) AS latest_quarter,
    COALESCE(er_fin.rate,
        CASE
            WHEN COALESCE(lfc.currency, c.currency) = 'KRW'::text THEN 1
            ELSE NULL::integer
        END::numeric) AS fx_fin_to_krw
   FROM companies c
     JOIN company_pages cp ON cp.company_id = c.id AND cp.page = 'related-stocks'::text
     LEFT JOIN exchange_rates_live er ON er.base = c.currency AND er.quote = 'KRW'::text
     LEFT JOIN latest_fin_currency lfc ON lfc.company_id = c.id
     LEFT JOIN exchange_rates_live er_fin ON er_fin.base = COALESCE(lfc.currency, c.currency) AND er_fin.quote = 'KRW'::text
  WHERE c.status = 'active';
