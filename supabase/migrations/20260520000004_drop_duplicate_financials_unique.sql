-- financials 중복 UNIQUE 제약 정리.
-- 배경:
--   20260428000003_create_financials.sql 에서 UNIQUE(company_id, period_type, fiscal_year, fiscal_quarter)
--     → constraint name: financials_company_id_period_type_fiscal_year_fiscal_quarte_key (PG 자동 명명)
--   20260428000008_financials_nulls_not_distinct.sql 에서 UNIQUE NULLS NOT DISTINCT(...) 동일 컬럼셋 추가
--     → constraint name: financials_unique_period
--   현재 두 제약이 공존. 동일 컬럼셋이지만 NULL 처리가 다름.
-- 정책:
--   NULLS NOT DISTINCT 쪽이 더 엄격하고 의도(annual row 1개)와 일치하므로 _unique_period 만 남기고
--   기본 UNIQUE 는 DROP. DROP CONSTRAINT 시 PG 가 자동 생성한 index 도 함께 drop 되지만
--   _unique_period 가 자체 index 라 쿼리 성능 영향은 없다.
-- 스크립트 호환:
--   postgrest 의 on_conflict 는 컬럼 리스트 매칭이라 _unique_period 가 자동 선택됨 (변경 불필요).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'financials_company_id_period_type_fiscal_year_fiscal_quarte_key'
  ) THEN
    ALTER TABLE financials
      DROP CONSTRAINT financials_company_id_period_type_fiscal_year_fiscal_quarte_key;
  END IF;
END $$;
