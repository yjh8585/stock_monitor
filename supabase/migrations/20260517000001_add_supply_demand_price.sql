-- stock_supply_demand 일별 종가/등락률 컬럼 추가.
-- 한세 대시보드 수급 패널에 가격 등락을 함께 표시하기 위함.

ALTER TABLE stock_supply_demand
  ADD COLUMN IF NOT EXISTS close_price numeric,
  ADD COLUMN IF NOT EXISTS change_pct  numeric;
