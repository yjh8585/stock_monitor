-- 전사 고정비/변동비 비용구조 (엑셀 '고정비' 시트 적재).
-- 각 비용 계정을 고정비/변동비로 분해한 금액(백만원)을 담는다.
--  - 계정분류: 매출원가(재료비/노무비/경비) + 판매관리비(판매관리비/연구개발비) 2단 + 계정명(사무·생산직접 등)
--  - 매출 행(고정/변동 구분 없음)·기준 변동비율 행은 적재 제외 — 비용 행만.
--  - '기타'·'감가상각비' 계정명이 category3 간 중복되므로 PK에 category2/category3 포함.
-- pnl_cost_structure(비용비율 시트)와 분류 체계가 달라 별도 테이블로 분리.
-- 사외비: RLS enable + 정책 없음(default deny). 서버 코드는 confidentialDb 경유로만 접근.

CREATE TABLE pnl_fixed_variable (
  period_year  int     NOT NULL,
  period_kind  text    NOT NULL CHECK (period_kind IN ('annual','monthly')),
  period_month int     NOT NULL DEFAULT 0,   -- annual=0, monthly=1..12
  cost_type    text    NOT NULL CHECK (cost_type IN ('고정비','변동비')),
  category2    text    NOT NULL,             -- 매출원가 / 판매관리비
  category3    text    NOT NULL,             -- 재료비/노무비/경비/판매관리비/연구개발비
  account      text    NOT NULL,             -- 계정명(사무·생산직접·감가상각비 등)
  value_mwon   numeric(18,4),                -- 백만원 단위
  PRIMARY KEY (period_year, period_kind, period_month, cost_type, category2, category3, account)
);

CREATE INDEX idx_pnl_fixed_variable_year_kind ON pnl_fixed_variable(period_year, period_kind, period_month);
CREATE INDEX idx_pnl_fixed_variable_cat ON pnl_fixed_variable(category2, category3);

ALTER TABLE pnl_fixed_variable ENABLE ROW LEVEL SECURITY;
-- 정책 없음(default deny). service_role(confidentialDb)만 접근.
