-- 재무(대차대조표) 추이 — '재무' 시트(long-format) 적재.
-- 한 행 = (자회사,연결/별도,연도,기간종류,월,계정명) 단위의 단일 지표값(백만원).
-- 사외비: RLS enable + 정책 없음(default deny). service_role(admin)만 접근.
--
-- 시점 규칙: 과거 연도는 연말(annual, period_month=12), 2026~ 월별(monthly, 1~12).
--   UI는 과거=연말, 당해연도=최신월(YTD)을 사용. 단위 환산은 lib/finance/aggregate.ts(억원=value_mwon/100).

CREATE TABLE finance_entries (
  subsidiary    text NOT NULL,                  -- 전체|미국|상숙|...
  consolidation text NOT NULL,                  -- 연결|별도 (현재 연결만)
  period_year   int  NOT NULL,
  period_kind   text NOT NULL CHECK (period_kind IN ('annual','monthly')),
  period_month  int  NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  account       text NOT NULL,                  -- 자산|부채|자본|채권|채무|재고|유형자산|무형자산|현금성자산|차입|증자
  value_mwon    numeric(18,4),                  -- 백만원 (미입력 시 null)
  PRIMARY KEY (subsidiary, consolidation, period_year, period_kind, period_month, account)
);

CREATE INDEX idx_finance_entries_lookup
  ON finance_entries(subsidiary, period_year, period_kind, period_month);

ALTER TABLE finance_entries ENABLE ROW LEVEL SECURITY;
-- 정책 생성하지 않음 → anon/authenticated default deny. service_role은 RLS 우회.

COMMENT ON TABLE finance_entries IS '한세모빌리티 재무(대차대조표) 추이 — 사외비. 서버 컴포넌트의 confidentialDb(service_role)로만 접근.';
