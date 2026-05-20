-- financials period semantic CHECK 추가.
-- 배경:
--   period_type='annual'이면 fiscal_quarter는 NULL,
--   period_type='quarterly'이면 fiscal_quarter는 1~4 이어야 의미가 맞다.
--   원본 스키마에 이 의미 제약이 없어 'annual + Q1' 같은 잘못된 row 가 들어갈 수 있다.
-- 진단:
--   현재 데이터(annual: 2351건, quarterly: 1250건) 전수 검사 결과 위반 0건.
--   안전하게 CHECK 만 추가하면 향후 잘못된 데이터를 사전에 차단.
-- 정책:
--   같은 회사·연도·분기에 대해 단일 row 정책 유지 (consolidation/source 분기는 도입하지 않음).
--   현재 데이터에 충돌이 없고 메모리 정책(연결 우선·단일 row)과도 부합한다.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'financials_period_semantic_check'
  ) THEN
    ALTER TABLE financials
      ADD CONSTRAINT financials_period_semantic_check
      CHECK (
        (period_type = 'annual'    AND fiscal_quarter IS NULL)
        OR
        (period_type = 'quarterly' AND fiscal_quarter BETWEEN 1 AND 4)
      );
  END IF;
END $$;

COMMENT ON CONSTRAINT financials_period_semantic_check ON financials IS
  'annual이면 fiscal_quarter IS NULL, quarterly이면 1~4 (의미 제약).';
