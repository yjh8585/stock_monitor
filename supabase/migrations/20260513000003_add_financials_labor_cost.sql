-- financials에 인건비(labor_cost) 컬럼 추가.
-- DART 연결감사보고서 주석의 "비용의 성격별 분류" 또는 "부가가치" 항목에서
-- 인건비성 비용(급여+퇴직급여+복리후생 등, 매출원가+판관비 합계)을 추출하여 저장한다.
-- 단위: MILLION (백만원) — revenue/cogs/sga 등과 동일.
ALTER TABLE financials ADD COLUMN IF NOT EXISTS labor_cost bigint;
COMMENT ON COLUMN financials.labor_cost IS '인건비(급여+퇴직급여+복리후생 합계, MILLION 단위, source=dart_labor)';
