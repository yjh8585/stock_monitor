-- 인원 추이 — 인원 시트(long-format) 적재.
-- 한 행 = (지역, 상세, 구분, 시점) 단위의 인원 수.
-- 사외비: RLS enable + 정책 없음(default deny). service_role(admin)만 접근.

CREATE TABLE personnel_entries (
  region       text NOT NULL CHECK (region IN ('국내','외주','미국','중국','우즈벡','이인텔리전스')),
  detail       text NOT NULL DEFAULT '',     -- 국내: 11종 / 외주: 사내외주·협력사원 / 그 외: ''
  kind         text NOT NULL CHECK (kind IN ('임원','사무','생산')),
  period_date  date NOT NULL,                -- 과거: 연말(12.31), 현재: 최신 시점
  headcount    int,
  PRIMARY KEY (region, detail, kind, period_date)
);

CREATE INDEX idx_personnel_entries_lookup
  ON personnel_entries(region, period_date);

ALTER TABLE personnel_entries ENABLE ROW LEVEL SECURITY;
-- 정책 생성하지 않음 → anon/authenticated default deny. service_role은 RLS 우회.

COMMENT ON TABLE personnel_entries IS '한세모빌리티 인원 추이 — 사외비. 서버 컴포넌트의 admin client(service_role)로만 접근.';
