-- 재고 추이 — 재고 시트(long-format) 적재.
-- 한 행 = (분류,항목,계획/실적,연도,월) 단위의 단일 지표값.
-- 사외비: RLS enable + 정책 없음(default deny). service_role(admin)만 접근.

CREATE TABLE inventory_entries (
  category     text NOT NULL,                  -- 전체|운영|관리|보상|운송
  item         text NOT NULL,                  -- 전체 재고|운영 재고|관리 재고|보상 재고|영업 재고|미국 운송|우즈벡 운송|회전율
  kind         text NOT NULL CHECK (kind IN ('plan','actual')),
  period_year  int  NOT NULL,
  period_month int  NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  unit         text,                            -- 억원|백만USD|NULL(회전율)
  fx_rate      numeric(10,4),                   -- 적용환율 (1400.0). USD 환산용.
  value        numeric(18,4),
  PRIMARY KEY (category, item, kind, period_year, period_month)
);

CREATE INDEX idx_inventory_entries_lookup
  ON inventory_entries(category, item, kind, period_year, period_month);

ALTER TABLE inventory_entries ENABLE ROW LEVEL SECURITY;
-- 정책 생성하지 않음 → anon/authenticated default deny. service_role은 RLS 우회.

COMMENT ON TABLE inventory_entries IS '한세모빌리티 재고 계획·실적 추이 — 사외비. 서버 컴포넌트의 admin client(service_role)로만 접근.';
