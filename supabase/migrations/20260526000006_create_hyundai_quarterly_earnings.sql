-- 현대차 분기별 IR 보고서(요약 손익) — Phase 2B.
--
-- 출처: hyundai.com/worldwide/ko/company/ir/financial-information/quarterly-earnings
-- 분기별 PDF (button.btn-download:has-text("실적 발표 자료")) — `q{1-4}-{YYYY}-earnings-call-pt(-final)?-ko.pdf`
-- Anthropic API + PDF document + tool_use(submit_earnings) 패턴
-- (collect_uzauto_financials.py와 동일 구조).
--
-- 본 테이블은 PDF에서 추출한 분기별 KPI(매출/영업이익/순이익/판매량/EBITDA 등)를 저장한다.
-- 부문별 매출(자동차/금융/기타) + 판매량(글로벌 도매/소매 + EV 비중)도 함께.
--
-- financials 테이블이 별도이지만 (1) 부문 분해(자동차/금융/기타) (2) 분기 판매량
-- (3) PDF 캐시 sha256 + Anthropic 추출 메타 보존이 분리 동기/특수성 있어 별도 테이블.
-- cross-check: 연 합계와 hyundai_export_regions(ir-summary) 4,138,389(2024) 비교.

CREATE TABLE IF NOT EXISTS hyundai_quarterly_earnings (
  fiscal_year       smallint NOT NULL CHECK (fiscal_year BETWEEN 2010 AND 2050),
  fiscal_quarter    smallint NOT NULL CHECK (fiscal_quarter BETWEEN 1 AND 4),
  period_end_date   date     NULL,           -- 분기 마지막 날 (분기 보고서 기준)

  -- 손익 (단위: KRW 십억원, IR PDF '십억원' 단위 그대로 보존)
  revenue_krw_bn               bigint  NULL,  -- 매출액 (연결)
  revenue_auto_krw_bn          bigint  NULL,  -- 자동차 부문 매출
  revenue_finance_krw_bn       bigint  NULL,  -- 금융 부문 매출
  revenue_other_krw_bn         bigint  NULL,  -- 기타 부문 매출
  cogs_krw_bn                  bigint  NULL,  -- 매출원가
  gross_profit_krw_bn          bigint  NULL,  -- 매출총이익
  gross_margin_pct             numeric(5, 2) NULL,
  sga_krw_bn                   bigint  NULL,  -- 판매비와관리비
  operating_income_krw_bn      bigint  NULL,  -- 영업이익
  operating_margin_pct         numeric(5, 2) NULL,
  pretax_income_krw_bn         bigint  NULL,  -- 세전이익
  net_income_krw_bn            bigint  NULL,  -- 당기순이익 (지배+비지배)
  net_income_controlling_krw_bn bigint NULL,  -- 지배주주 순이익
  ebitda_krw_bn                bigint  NULL,  -- EBITDA

  -- 판매량 (단위: 천대, IR PDF '천대' 단위 그대로 보존)
  global_wholesale_k_units     integer NULL,  -- 글로벌 도매 합계
  global_retail_k_units        integer NULL,  -- 글로벌 소매 합계
  domestic_wholesale_k_units   integer NULL,  -- 내수 도매
  domestic_retail_k_units      integer NULL,  -- 내수 소매
  overseas_wholesale_k_units   integer NULL,  -- 해외 도매 (글로벌 - 내수)

  -- 친환경 판매 (단위: 천대)
  ev_k_units                   integer NULL,  -- 순수 전기차
  hev_k_units                  integer NULL,  -- 하이브리드
  phev_k_units                 integer NULL,  -- 플러그인 하이브리드
  fcev_k_units                 integer NULL,  -- 수소전기차
  eco_total_k_units            integer NULL,  -- 친환경 합계 (= EV+HEV+PHEV+FCEV)

  -- PDF 메타
  pdf_url           text NOT NULL,            -- 다운로드 PDF URL
  pdf_sha256        text NULL,                -- PDF 콘텐츠 해시 (재처리 판단)
  pdf_etag          text NULL,
  source_url        text NULL,                -- 페이지 URL
  last_processed_at timestamptz NULL,         -- LLM 추출 시각
  collected_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (fiscal_year, fiscal_quarter)
);

CREATE INDEX IF NOT EXISTS idx_hyundai_quarterly_earnings_year
  ON hyundai_quarterly_earnings(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_hyundai_quarterly_earnings_period
  ON hyundai_quarterly_earnings(fiscal_year DESC, fiscal_quarter DESC);

ALTER TABLE hyundai_quarterly_earnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_hyundai_quarterly_earnings
  ON hyundai_quarterly_earnings FOR SELECT TO anon USING (true);

CREATE POLICY service_write_hyundai_quarterly_earnings
  ON hyundai_quarterly_earnings FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE hyundai_quarterly_earnings IS
  '현대차 분기별 IR 보고서(실적 발표 자료 PDF) → Anthropic API + tool_use로 추출. 매출/영업이익/순이익/EBITDA/판매량/친환경 비중 + 부문별(자동차/금융/기타) 매출. PK=(fiscal_year, fiscal_quarter). 재진술 시 같은 PK upsert로 자연 우선. PDF sha256 캐시로 변경분만 LLM 재호출.';
COMMENT ON COLUMN hyundai_quarterly_earnings.revenue_krw_bn IS
  '매출액 (연결, KRW 십억원). IR PDF "(십억원)" 단위 그대로. KRW mn 환산은 ×1000.';
COMMENT ON COLUMN hyundai_quarterly_earnings.global_wholesale_k_units IS
  '글로벌 도매 합계 (천대). IR PDF "(단위: 천대)" 그대로.';
COMMENT ON COLUMN hyundai_quarterly_earnings.pdf_sha256 IS
  'PDF 콘텐츠 SHA256. cache hit 시 LLM 재호출 skip(비용 절감).';
