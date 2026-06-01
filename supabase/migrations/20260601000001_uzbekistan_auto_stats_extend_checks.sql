-- 우즈베키스탄 자동차 테이블 CHECK 제약 확장 — 데이터 정합성 수정 후속.
--
-- 배경: collect_uzbekistan_sales.py / collect_uzbekistan_production.py 파서 수정으로
--   (1) uzavtosanoat 보도자료에서 누락됐던 회사 'Jizzakh Auto'·'Alyans Auto'가 정상 추출됨
--       → company CHECK enum 확장 (기존 적재 실패 방지).
--   (2) stat.uz 산업 PDF는 "1~N월 누계(YTD)" 형식이라 월별 차분이 불가/부정확 →
--       모델별 YTD 스냅샷(당년·전년 동기)으로 적재 → period_type='ytd' 추가.
--
-- 회사명 트리거(㈜ 제거 등)는 이 테이블에 없음 — 보도자료 표기 그대로.

ALTER TABLE uzbekistan_auto_stats
  DROP CONSTRAINT uzbekistan_auto_stats_company_check;

ALTER TABLE uzbekistan_auto_stats
  ADD CONSTRAINT uzbekistan_auto_stats_company_check
  CHECK (company IN ('', 'UzAuto Motors', 'Khorezm Auto', 'ADM Jizzakh',
                     'BYD Uzbekistan Factory', 'SamAuto', 'Asaka Motors',
                     'Jizzakh Auto', 'Alyans Auto'));

ALTER TABLE uzbekistan_auto_stats
  DROP CONSTRAINT uzbekistan_auto_stats_period_type_check;

ALTER TABLE uzbekistan_auto_stats
  ADD CONSTRAINT uzbekistan_auto_stats_period_type_check
  CHECK (period_type IN ('month', 'quarter', 'year', 'ytd'));

COMMENT ON COLUMN uzbekistan_auto_stats.period_type IS
  'month=월별(uzavtosanoat 차분) / year=연 누계 / ytd=1~N월 누계 스냅샷(stat.uz 모델별, year_period=YYYY-MM).';
COMMENT ON COLUMN uzbekistan_auto_stats.company IS
  '회사 enum(판매·회사별 생산). production 브랜드/모델 데이터(stat.uz)는 회사 정보 없으므로 ''''.';
