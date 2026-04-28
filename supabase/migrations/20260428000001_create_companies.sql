-- 기업 마스터 테이블 (인트라데이 현재가 포함)
CREATE TABLE IF NOT EXISTS companies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker          text NOT NULL UNIQUE,
  name            text NOT NULL,
  name_kr         text NOT NULL,
  market          text NOT NULL,        -- KOSPI/NYSE/NASDAQ/XETRA/TSE/HKEX/LSE
  country         text NOT NULL,        -- KR/US/DE/JP/HK/GB
  currency        text NOT NULL,        -- KRW/USD/EUR/JPY/HKD/GBP
  data_source     text NOT NULL,        -- pykrx+dart / yfinance
  status          text NOT NULL DEFAULT 'active',  -- active/delisted/merged
  is_seed         boolean NOT NULL DEFAULT false,
  last_price      numeric,
  last_change_pct numeric,
  last_volume     bigint,
  last_updated_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_companies_status ON companies (status);
CREATE INDEX IF NOT EXISTS idx_companies_country ON companies (country);

-- RLS
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_companies" ON companies FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_companies" ON companies FOR ALL TO service_role USING (true);
