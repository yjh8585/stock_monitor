-- companies 테이블에 FnGuide 수집 스냅샷 컬럼 추가
-- market_cap: 시가총액 (억원 단위, KRW 기준)
-- business_summary: 기업개요 텍스트
-- summary_updated_at: 개요 마지막 수집 시각

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS market_cap          numeric,
  ADD COLUMN IF NOT EXISTS business_summary    text,
  ADD COLUMN IF NOT EXISTS summary_updated_at  timestamptz;

COMMENT ON COLUMN companies.market_cap         IS '시가총액 (억원 단위, KRW 기준)';
COMMENT ON COLUMN companies.business_summary   IS 'FnGuide 기업개요 텍스트';
COMMENT ON COLUMN companies.summary_updated_at IS '기업개요 마지막 수집 시각';
