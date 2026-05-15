-- 손익 단일 테이블: 엑셀 3개 raw 시트(연간/연결_월/월)를 통합 적재.
-- 매출총이익은 derived (revenue - material_cost - labor_cost - expense)이므로 저장하지 않는다.
-- period_month=0 은 연간 합계, 1~12 는 월별.

CREATE TABLE pnl_entries (
  basis        text NOT NULL CHECK (basis IN ('consolidated','standalone')),
  year_label   text NOT NULL,            -- '2023'|'2024'|'2025'|'2025(E)'|'2026'|'2026(P)' 등 원본 라벨 보존
  period_year  int  NOT NULL,
  period_month int  NOT NULL DEFAULT 0,  -- 0=연간, 1~12=월별
  is_plan      boolean NOT NULL DEFAULT false,  -- '(P)' 라벨이면 true
  is_estimate  boolean NOT NULL DEFAULT false,  -- '(E)' 라벨이면 true
  sil          text NOT NULL DEFAULT '',
  division     text NOT NULL DEFAULT '',
  factory      text NOT NULL DEFAULT '',
  product      text NOT NULL DEFAULT '',
  customer     text NOT NULL DEFAULT '',
  revenue        numeric(18,4),
  material_cost  numeric(18,4),
  labor_cost     numeric(18,4),
  expense        numeric(18,4),
  sga            numeric(18,4),
  rnd            numeric(18,4),
  op_income      numeric(18,4),
  PRIMARY KEY (basis, year_label, period_month, sil, division, factory, product, customer)
);

CREATE INDEX idx_pnl_basis_year_month ON pnl_entries(basis, period_year, period_month);
CREATE INDEX idx_pnl_customer ON pnl_entries(customer);
CREATE INDEX idx_pnl_product  ON pnl_entries(product);
CREATE INDEX idx_pnl_division ON pnl_entries(division);
CREATE INDEX idx_pnl_sil      ON pnl_entries(sil);

ALTER TABLE pnl_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read pnl_entries" ON pnl_entries
  FOR SELECT USING (true);
