-- 부품사 Top100 페이지(/parts-top100) 합성 뷰
-- domestic_stocks_view 패턴 그대로 + group_name 자리에 country→한글 국가명 매핑
-- DomesticStockRow 타입과 같은 컬럼 구조라 DomesticTable 컴포넌트 재사용 가능.

DROP VIEW IF EXISTS parts_top100_stocks_view;

CREATE VIEW parts_top100_stocks_view AS
WITH latest_fin_currency AS (
  SELECT DISTINCT ON (company_id) company_id, currency
  FROM financials
  WHERE period_type = 'annual' AND currency IS NOT NULL
  ORDER BY company_id, fiscal_year DESC
),
top100_base AS (
  SELECT
    c.id, c.ticker, c.name, c.name_kr, c.market, c.country, c.currency, c.status,
    -- group_name: country 코드를 한글 국가명으로 매핑
    CASE c.country
      WHEN 'DE' THEN '독일'
      WHEN 'JP' THEN '일본'
      WHEN 'US' THEN '미국'
      WHEN 'CN' THEN '중국'
      WHEN 'KR' THEN '한국'
      WHEN 'FR' THEN '프랑스'
      WHEN 'IT' THEN '이탈리아'
      WHEN 'ES' THEN '스페인'
      WHEN 'CH' THEN '스위스'
      WHEN 'CA' THEN '캐나다'
      WHEN 'IE' THEN '아일랜드'
      WHEN 'NL' THEN '네덜란드'
      WHEN 'SE' THEN '스웨덴'
      WHEN 'IN' THEN '인도'
      WHEN 'MX' THEN '멕시코'
      WHEN 'AT' THEN '오스트리아'
      WHEN 'GB' THEN '영국'
      WHEN 'HK' THEN '홍콩'
      WHEN 'TW' THEN '대만'
      ELSE c.country
    END AS group_name,
    c.products, c.customers,
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
          WHERE p.company_id = f.company_id AND p.period_type = 'quarterly'
            AND p.fiscal_year = f.fiscal_year - 1 AND p.fiscal_quarter = f.fiscal_quarter
          LIMIT 1
        ),
        'prev_operating_income', (
          SELECT p.operating_income FROM financials p
          WHERE p.company_id = f.company_id AND p.period_type = 'quarterly'
            AND p.fiscal_year = f.fiscal_year - 1 AND p.fiscal_quarter = f.fiscal_quarter
          LIMIT 1
        ),
        'prev_operating_margin', (
          SELECT p.operating_margin FROM financials p
          WHERE p.company_id = f.company_id AND p.period_type = 'quarterly'
            AND p.fiscal_year = f.fiscal_year - 1 AND p.fiscal_quarter = f.fiscal_quarter
          LIMIT 1
        )
      )
      FROM financials f
      WHERE f.company_id = c.id AND f.period_type = 'quarterly' AND f.revenue IS NOT NULL
      ORDER BY f.fiscal_year DESC, f.fiscal_quarter DESC NULLS LAST
      LIMIT 1
    ) AS latest_quarter,
    COALESCE(er_fin.rate, CASE WHEN COALESCE(lfc.currency, c.currency) = 'KRW' THEN 1 ELSE NULL END) AS fx_fin_to_krw,
    (
      SELECT (
        f.revenue *
        COALESCE(er_fin.rate, CASE WHEN COALESCE(lfc.currency, c.currency) = 'KRW' THEN 1 ELSE NULL END)
      )
      FROM financials f
      WHERE f.company_id = c.id AND f.period_type = 'annual' AND f.revenue IS NOT NULL
      ORDER BY f.fiscal_year DESC
      LIMIT 1
    ) AS latest_revenue_krw
  FROM companies c
  JOIN company_pages cp ON cp.company_id = c.id AND cp.page = 'parts-top100'
  LEFT JOIN exchange_rates_live er ON er.base = c.currency AND er.quote = 'KRW'
  LEFT JOIN latest_fin_currency lfc ON lfc.company_id = c.id
  LEFT JOIN exchange_rates_live er_fin ON er_fin.base = COALESCE(lfc.currency, c.currency) AND er_fin.quote = 'KRW'
  WHERE c.status = 'active'
)
SELECT
  d.*,
  ROW_NUMBER() OVER (ORDER BY d.latest_revenue_krw DESC NULLS LAST, d.name_kr ASC) AS sales_rank
FROM top100_base d;

COMMENT ON VIEW parts_top100_stocks_view IS
  '부품사 Top100 페이지(/parts-top100) 합성 뷰: country 한글 매핑+매출순위. company_pages.page=''parts-top100'' AND status=''active''. sales_rank=ROW_NUMBER 매출 KRW환산 DESC';
