-- fiscal_quarter NULL(연간) 레코드의 upsert 충돌 감지를 위해 NULLS NOT DISTINCT로 교체
-- PostgreSQL 15+ 기능: NULL 값을 UNIQUE 비교에서 동일하게 취급
ALTER TABLE financials
  DROP CONSTRAINT IF EXISTS financials_company_id_period_type_fiscal_year_fiscal_quarter_key;

ALTER TABLE financials
  ADD CONSTRAINT financials_unique_period
  UNIQUE NULLS NOT DISTINCT (company_id, period_type, fiscal_year, fiscal_quarter);
