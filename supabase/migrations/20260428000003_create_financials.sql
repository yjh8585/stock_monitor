-- 분기/연간 실적 (원본 통화 저장, 단위: 백만)
CREATE TABLE IF NOT EXISTS financials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_type     text NOT NULL CHECK (period_type IN ('quarterly', 'annual')),
  fiscal_year     integer NOT NULL,
  fiscal_quarter  integer CHECK (fiscal_quarter BETWEEN 1 AND 4),
  period_end_date date,
  currency        text NOT NULL,
  -- 필수 4종
  revenue              numeric,
  operating_income     numeric,
  operating_margin     numeric GENERATED ALWAYS AS (
    CASE WHEN revenue IS NOT NULL AND revenue != 0
         THEN ROUND((operating_income / revenue * 100)::numeric, 2)
         ELSE NULL END
  ) STORED,
  -- 수익성 지표
  cogs             numeric,
  gross_profit     numeric,
  gross_margin     numeric GENERATED ALWAYS AS (
    CASE WHEN revenue IS NOT NULL AND revenue != 0
         THEN ROUND((gross_profit / revenue * 100)::numeric, 2)
         ELSE NULL END
  ) STORED,
  sga              numeric,
  net_income       numeric,
  net_margin       numeric GENERATED ALWAYS AS (
    CASE WHEN revenue IS NOT NULL AND revenue != 0
         THEN ROUND((net_income / revenue * 100)::numeric, 2)
         ELSE NULL END
  ) STORED,
  ebitda           numeric,
  -- 재무건전성 지표
  total_assets      numeric,
  total_liabilities numeric,
  total_equity      numeric,
  debt_ratio        numeric GENERATED ALWAYS AS (
    CASE WHEN total_equity IS NOT NULL AND total_equity != 0
         THEN ROUND((total_liabilities / total_equity * 100)::numeric, 2)
         ELSE NULL END
  ) STORED,
  current_ratio     numeric,
  roe               numeric,
  roa               numeric,
  UNIQUE (company_id, period_type, fiscal_year, fiscal_quarter)
);

CREATE INDEX IF NOT EXISTS idx_financials_company_period
  ON financials (company_id, period_type, fiscal_year DESC, fiscal_quarter DESC);

ALTER TABLE financials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_financials" ON financials FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_financials" ON financials FOR ALL TO service_role USING (true);
