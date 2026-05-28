-- 손익 계획 대비 실적 — 계획 시트(long-format) 적재.
-- 한 행 = (분류,항목,기준,계획/실적,연도,연간/월) 단위의 단일 지표값.
-- 사외비: RLS enable + 정책 없음(default deny). service_role(admin)만 접근.

CREATE TABLE pnl_plan (
  category     text NOT NULL,                  -- 수주|손익|미국|상숙|지린|손익개선|공장
  item         text NOT NULL,                  -- 수주액|수주액(취소 제외)|매출|영업이익|Design VE|MCIP|단가인상|구동 매출|제동 매출|조향 매출|전장 매출
  basis        text NOT NULL CHECK (basis IN ('consolidated','standalone')),
  kind         text NOT NULL CHECK (kind IN ('plan','actual')),
  period_year  int  NOT NULL,
  period_type  text NOT NULL CHECK (period_type IN ('annual','month')),
  period_month int  NOT NULL DEFAULT 0,        -- 0=연간, 1~12=월별
  unit         text NOT NULL,                  -- 억원|USD 백만|백만원
  value        numeric(18,4),
  PRIMARY KEY (category, item, basis, kind, period_year, period_type, period_month)
);

CREATE INDEX idx_pnl_plan_lookup ON pnl_plan(category, item, basis, kind, period_year);

ALTER TABLE pnl_plan ENABLE ROW LEVEL SECURITY;
-- 정책 생성하지 않음 → anon/authenticated default deny. service_role은 RLS 우회.

COMMENT ON TABLE pnl_plan IS '한세모빌리티 계획 대비 실적 — 사외비. 서버 컴포넌트의 admin client(service_role)로만 접근.';
