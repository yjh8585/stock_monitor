-- pnl_fixed_variable에 매출 행·기준 변동비율 행 적재 허용.
--  - 매출(계정분류1='매출', 고정/변동 구분 없음): 표 최상단 매출액. cost_type='매출'.
--    category2/category3/account를 모두 '매출' 센티넬로 저장(NOT NULL 충족). 영업이익은 매출-비용합계 파생.
--  - 변동비율(시트 '기준' 행): 계정명별 변동비율 가정치(0~1). cost_type='변동비율',
--    period_year=0(연도 무관 기준) + value_mwon에 비율 저장. 고정비율은 UI에서 1-변동비율.
-- cost_type CHECK에 '매출'·'변동비율' 추가.

ALTER TABLE pnl_fixed_variable DROP CONSTRAINT IF EXISTS pnl_fixed_variable_cost_type_check;
ALTER TABLE pnl_fixed_variable
  ADD CONSTRAINT pnl_fixed_variable_cost_type_check
  CHECK (cost_type IN ('고정비', '변동비', '매출', '변동비율'));
