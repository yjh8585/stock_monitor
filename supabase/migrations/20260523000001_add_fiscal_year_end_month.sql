-- companies에 fiscal_year_end_month 컬럼 추가 (회사별 회계 결산월).
--
-- 배경:
--   - 한국 상장사는 대부분 12월 결산이지만 일부 회사(예: 학교법인 산하사, 일부 금융사)는
--     3월/6월 결산이고, 글로벌사는 더 다양 (덴소 4월, 도요타 3월 등).
--   - 기존 collect_financials.py는 period_end.month != 12 인 한국 annual을 무조건 SKIP했는데,
--     이는 비-12월 결산 회사의 데이터를 영구 누락시킨다.
--   - yfinance 수집은 fy_offset 인자로 한국식 -1 보정을 처리해왔지만, 회사별 정책이
--     코드에 산재되어 있어 신규 회사 추가 시마다 수동 등록이 필요했다.
--
-- 해결책:
--   - fiscal_year_end_month: 1~12 (default 12). 회사의 회계 결산월(예: 도요타=3).
--   - collect_financials.py가 회사별 결산월과 period_end.month를 비교:
--       * 일치: annual 데이터로 인정, fiscal_year에 한국식 -1 보정 자동 적용
--       * 불일치: 분기 데이터로 판정해 SKIP (기존 우측 분기열 오적재 방지 로직 보존)
--
-- 영향:
--   - 기존 모든 회사는 12월 결산 default가 적용되므로 기존 데이터 동작 변화 없음.
--   - 미래 신규 회사 등록 시 비-12월 결산은 명시적으로 지정해야 정상 집계.

ALTER TABLE companies
  ADD COLUMN fiscal_year_end_month smallint NOT NULL DEFAULT 12
    CHECK (fiscal_year_end_month BETWEEN 1 AND 12);

COMMENT ON COLUMN companies.fiscal_year_end_month IS
  '회계 결산월 (1~12, 기본 12). collect_financials.py가 fnguide annual 적재 시 회사별 결산월과 period_end.month를 비교해 일치하면 적재(한국식 -1 보정 후), 불일치하면 분기 데이터로 판정 SKIP.';
