-- 재고자산(inventory) 컬럼 추가 — 재고회전율(매출/재고자산) 계산용
ALTER TABLE financials
  ADD COLUMN IF NOT EXISTS inventory numeric;

COMMENT ON COLUMN financials.inventory IS '재고자산 (백만, 원본 통화 기준)';
