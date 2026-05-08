-- /domestic (국내자동차) 페이지 지원
-- 1) companies.group_name (소속 그룹)
-- 2) companies.homepage_url (이미 view 참조 / 누락 안전 보강)
-- 3) market 컬럼 NULL 허용 (비상장사 등록)
-- 4) company_pages 다대다 매핑 테이블 (한 회사가 여러 페이지에 노출 가능)
-- 5) related_stocks_view 재정의 + domestic_stocks_view 신규
--    (sales_rank = ROW_NUMBER OVER 최근연도 매출 KRW환산 DESC)

-- ── 1. companies 컬럼 보강 ────────────────────────────────────────────────
ALTER TABLE companies ALTER COLUMN market DROP NOT NULL;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS group_name   text,
  ADD COLUMN IF NOT EXISTS homepage_url text;

COMMENT ON COLUMN companies.group_name   IS '소속 그룹명(현대차, HL, 평화홀딩스, SECO 등). 미지정 시 NULL';
COMMENT ON COLUMN companies.homepage_url IS '회사 공식 홈페이지 URL (그룹 매핑 크롤링/링크용)';

CREATE INDEX IF NOT EXISTS idx_companies_group_name ON companies (group_name);

-- ── 2. company_pages 다대다 매핑 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_pages (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  page       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, page),
  CONSTRAINT company_pages_page_check
    CHECK (page IN ('related-stocks','domestic','oem','parts-top100','hanse'))
);

CREATE INDEX IF NOT EXISTS idx_company_pages_page ON company_pages (page);

ALTER TABLE company_pages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'anon_read_company_pages'
  ) THEN
    EXECUTE 'CREATE POLICY "anon_read_company_pages" ON company_pages FOR SELECT TO anon USING (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'service_write_company_pages'
  ) THEN
    EXECUTE 'CREATE POLICY "service_write_company_pages" ON company_pages FOR ALL TO service_role USING (true)';
  END IF;
END $$;

COMMENT ON TABLE company_pages IS '회사-페이지 다대다 매핑: 한 회사가 여러 페이지(/related-stocks, /domestic 등)에 노출될 수 있음';

-- 기존 25개(/related-stocks 노출)는 마이그레이션 시점에 매핑 시드
INSERT INTO company_pages (company_id, page)
SELECT id, 'related-stocks' FROM companies
ON CONFLICT (company_id, page) DO NOTHING;

-- ── 3. related_stocks_view 재정의 (company_pages JOIN) ──────────────────
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
  COALESCE(er_fin.rate, CASE WHEN COALESCE(lfc.currency, c.currency) = 'KRW' THEN 1 ELSE NULL END) AS fx_fin_to_krw
FROM companies c
JOIN company_pages cp ON cp.company_id = c.id AND cp.page = 'related-stocks'
LEFT JOIN exchange_rates_live er ON er.base = c.currency AND er.quote = 'KRW'
LEFT JOIN latest_fin_currency lfc ON lfc.company_id = c.id
LEFT JOIN exchange_rates_live er_fin ON er_fin.base = COALESCE(lfc.currency, c.currency) AND er_fin.quote = 'KRW';

COMMENT ON VIEW related_stocks_view IS
  '관련회사 페이지(/related-stocks) 합성 뷰: company_pages.page=''related-stocks''만';

-- ── 4. domestic_stocks_view 신규 (그룹/매출순위 포함) ───────────────────
CREATE VIEW domestic_stocks_view AS
WITH latest_fin_currency AS (
  SELECT DISTINCT ON (company_id) company_id, currency
  FROM financials
  WHERE period_type = 'annual' AND currency IS NOT NULL
  ORDER BY company_id, fiscal_year DESC
),
domestic_base AS (
  SELECT
    c.id, c.ticker, c.name, c.name_kr, c.market, c.country, c.currency, c.status,
    c.group_name, c.products, c.customers,
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
  JOIN company_pages cp ON cp.company_id = c.id AND cp.page = 'domestic'
  LEFT JOIN exchange_rates_live er ON er.base = c.currency AND er.quote = 'KRW'
  LEFT JOIN latest_fin_currency lfc ON lfc.company_id = c.id
  LEFT JOIN exchange_rates_live er_fin ON er_fin.base = COALESCE(lfc.currency, c.currency) AND er_fin.quote = 'KRW'
  WHERE c.status = 'active'
)
SELECT
  d.*,
  ROW_NUMBER() OVER (ORDER BY d.latest_revenue_krw DESC NULLS LAST, d.name_kr ASC) AS sales_rank
FROM domestic_base d;

COMMENT ON VIEW domestic_stocks_view IS
  '국내자동차 페이지(/domestic) 합성 뷰: 그룹명+매출순위. company_pages.page=''domestic'' AND status=''active''. sales_rank=ROW_NUMBER 매출 KRW환산 DESC';
