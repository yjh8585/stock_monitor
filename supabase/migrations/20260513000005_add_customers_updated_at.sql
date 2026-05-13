-- customers 갱신 추적용 타임스탬프 컬럼 추가
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS customers_updated_at timestamptz;
