-- 전사 비용구조 (엑셀 '비용비율' 시트 적재).
-- 비용비율 시트는 회사 내부 비용 분류(재료비성/경비성/인건비성/영업이익)에 따른
-- 세부 항목(재료비, 관세, 운반및보관료, 인건비, 외주가공비, 경비, 영업이익)별 금액을 담는다.
-- pnl_entries 의 회계 분류(재료비/노무비/경비/판관비/연구비)와 분류 체계가 다르므로 별도 테이블로 분리.

CREATE TABLE pnl_cost_structure (
  period_year  int     NOT NULL,
  period_kind  text    NOT NULL CHECK (period_kind IN ('annual','monthly')),
  period_month int     NOT NULL DEFAULT 0,  -- annual=0, monthly=1..12
  kind         text    NOT NULL CHECK (kind IN ('actual','plan')),
  category     text    NOT NULL,            -- 매출/재료비성/경비성/인건비성/영업이익
  account      text    NOT NULL,            -- 매출/재료비/관세/운반및보관료/인건비/외주가공비/경비/영업이익
  value_mwon   numeric(18,4),               -- 백만원 단위
  PRIMARY KEY (period_year, period_kind, period_month, kind, account)
);

CREATE INDEX idx_cost_structure_year_kind ON pnl_cost_structure(period_year, period_kind, period_month);
CREATE INDEX idx_cost_structure_category  ON pnl_cost_structure(category);

ALTER TABLE pnl_cost_structure ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read pnl_cost_structure" ON pnl_cost_structure
  FOR SELECT USING (true);
