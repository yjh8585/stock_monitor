-- financials_by_quarter 컬럼 제거 + latest_quarter에 prev_* (전년 동기) 필드 추가
-- 사용 목적: 표 컬럼은 분기 미사용으로 단순화, 회사 설명 영역에서 매출/영업이익 YOY 표시용
-- 컬럼 제거를 위해 DROP VIEW 후 재생성

DROP VIEW IF EXISTS related_stocks_view;

CREATE VIEW related_stocks_view AS
WITH latest_fin_currency AS (
  SELECT DISTINCT ON (company_id) company_id, currency
  FROM financials
  WHERE period_type = 'annual' AND currency IS NOT NULL
  ORDER BY company_id, fiscal_year DESC
)
SELECT
  c.id, c.ticker, c.name, c.name_kr, c.market, c.country, c.currency, c.status,
  c.company_type, c.region, c.products, c.customers,
  c.last_price, c.last_change_pct, c.last_updated_at, c.market_cap,
  c.business_summary, c.summary_updated_at, c.homepage_url,
  COALESCE(er.rate, CASE WHEN c.currency = 'KRW' THEN 1 ELSE NULL END) AS fx_to_krw,
  (
    SELECT jsonb_object_agg(f.fiscal_year::text, jsonb_build_object(
      'revenue', f.revenue, 'operating_income', f.operating_income,
      'operating_margin', f.operating_margin,
      'total_liabilities', f.total_liabilities, 'total_equity', f.total_equity,
      'debt_ratio', f.debt_ratio, 'inventory', f.inventory,
      'eps', f.eps, 'per', f.per, 'pbr', f.pbr, 'ev_ebitda', f.ev_ebitda
    ))
    FROM financials f
    WHERE f.company_id = c.id AND f.period_type = 'annual'
      AND f.fiscal_year BETWEEN 2020 AND (extract(year from now())::int + 1)
  ) AS financials_by_year,
  (
    SELECT jsonb_build_object(
      'fiscal_year',          f.fiscal_year,
      'fiscal_quarter',       f.fiscal_quarter,
      'revenue',              f.revenue,
      'operating_income',     f.operating_income,
      'operating_margin',     f.operating_margin,
      'prev_revenue', (
        SELECT p.revenue FROM financials p
        WHERE p.company_id = f.company_id
          AND p.period_type = 'quarterly'
          AND p.fiscal_year = f.fiscal_year - 1
          AND p.fiscal_quarter = f.fiscal_quarter
        LIMIT 1
      ),
      'prev_operating_income', (
        SELECT p.operating_income FROM financials p
        WHERE p.company_id = f.company_id
          AND p.period_type = 'quarterly'
          AND p.fiscal_year = f.fiscal_year - 1
          AND p.fiscal_quarter = f.fiscal_quarter
        LIMIT 1
      ),
      'prev_operating_margin', (
        SELECT p.operating_margin FROM financials p
        WHERE p.company_id = f.company_id
          AND p.period_type = 'quarterly'
          AND p.fiscal_year = f.fiscal_year - 1
          AND p.fiscal_quarter = f.fiscal_quarter
        LIMIT 1
      )
    )
    FROM financials f
    WHERE f.company_id = c.id AND f.period_type = 'quarterly' AND f.revenue IS NOT NULL
    ORDER BY f.fiscal_year DESC, f.fiscal_quarter DESC NULLS LAST
    LIMIT 1
  ) AS latest_quarter,
  COALESCE(er_fin.rate, CASE WHEN COALESCE(lfc.currency, c.currency) = 'KRW' THEN 1 ELSE NULL END) AS fx_fin_to_krw
FROM companies c
LEFT JOIN exchange_rates_live er ON er.base = c.currency AND er.quote = 'KRW'
LEFT JOIN latest_fin_currency lfc ON lfc.company_id = c.id
LEFT JOIN exchange_rates_live er_fin ON er_fin.base = COALESCE(lfc.currency, c.currency) AND er_fin.quote = 'KRW';

COMMENT ON VIEW related_stocks_view IS
  '관련주식 페이지용 합성 뷰: 메타+주가+연간실적+최근분기(YOY 비교용 prev 포함)+환율';
