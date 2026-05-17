-- 장중 잠정 수급 시간별 스냅샷 (한세 4종목, 5분 간격).
-- KRX 잠정 일별 누적값을 매 5분 timestamptz로 저장 → 분 단위 변화량 추세 시각화.

CREATE TABLE IF NOT EXISTS stock_supply_demand_intraday (
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  snapshot_ts     timestamptz NOT NULL,
  trade_date      date NOT NULL,
  foreign_net     bigint,
  institution_net bigint,
  individual_net  bigint,
  PRIMARY KEY (company_id, snapshot_ts)
);
CREATE INDEX IF NOT EXISTS idx_supply_intraday_company_ts
  ON stock_supply_demand_intraday (company_id, snapshot_ts DESC);
CREATE INDEX IF NOT EXISTS idx_supply_intraday_company_date
  ON stock_supply_demand_intraday (company_id, trade_date);
ALTER TABLE stock_supply_demand_intraday ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_supply_intraday"
  ON stock_supply_demand_intraday FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_supply_intraday"
  ON stock_supply_demand_intraday FOR ALL TO service_role USING (true);
