-- financials 테이블에 source 컬럼 추가
-- 회사 단위 data_source(companies.data_source)는 연도별 출처 다양성을 반영하지 못함.
-- 예: 콘티넨탈은 2022~2023은 yfinance, 2024는 marklines 재수집 등.
-- 각 financial row에 실제 수집 출처를 기록해 추적 가능하게 한다.

ALTER TABLE financials
  ADD COLUMN IF NOT EXISTS source text;

COMMENT ON COLUMN financials.source IS
  '데이터 출처: yfinance / yahoo_web / fnguide / pykrx / dart / dart_audit / marklines / pdf / manual / web_search';

-- 기존 row는 회사의 data_source 기반으로 초기값 설정 (best-effort backfill)
UPDATE financials f
SET source = c.data_source
FROM companies c
WHERE f.company_id = c.id AND f.source IS NULL;

CREATE INDEX IF NOT EXISTS idx_financials_source ON financials(source);
