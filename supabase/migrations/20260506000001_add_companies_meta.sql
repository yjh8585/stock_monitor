-- 관련주식 페이지 표시용 메타 컬럼 추가
-- company_type: OEM/부품사 분류
-- region: 표시용 지역 (한국, 미국, 독일, 일본, 홍콩, 영국, 베트남 등)
-- products: 주요 제품 [{name, share_pct?}]
-- customers: 주요 고객사 (부품사만) [{name, logo_url?}]

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS company_type text,
  ADD COLUMN IF NOT EXISTS region       text,
  ADD COLUMN IF NOT EXISTS products     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS customers    jsonb NOT NULL DEFAULT '[]'::jsonb;

-- CHECK 제약은 ALTER TABLE … ADD CONSTRAINT … NOT VALID 후 검증으로 처리 (NULL 허용)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_company_type_check'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_company_type_check
      CHECK (company_type IS NULL OR company_type IN ('OEM', '부품사'));
  END IF;
END $$;

COMMENT ON COLUMN companies.company_type IS 'OEM(완성차) | 부품사 분류';
COMMENT ON COLUMN companies.region       IS '표시용 주 근거지(예: 한국, 미국, 독일, 일본, 홍콩, 영국, 베트남)';
COMMENT ON COLUMN companies.products     IS '주요 제품 배열 [{name, share_pct?}]';
COMMENT ON COLUMN companies.customers    IS '주요 고객사 배열 [{name, logo_url?}] (부품사만)';

CREATE INDEX IF NOT EXISTS idx_companies_company_type ON companies (company_type);
