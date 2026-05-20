-- 일본 비-12월 결산법인의 fiscal_year를 한국식 표기로 -1 보정.
--
-- 배경:
--   yfinance가 일본 회사의 fiscal_year를 period_end_date의 종료 연도로 부여.
--   예: 덴소(3월 결산) FY2025/4~2026/3 → yfinance fiscal_year=2026.
--   한국식 표기로는 "2025년도 결산"이라 부르는 게 일반적 → fiscal_year=2025로 보정.
--
-- 대상:
--   country='JP' AND annual.period_end_date의 월이 12가 아닌 회사의 모든 financials 행
--   (annual + quarterly 둘 다). 25개사 121행 (annual 99 + quarterly 22).
--   12월 결산 일본 회사(르네사스, 브리지스톤, 스미토모고무, 요코하마고무 등)는 한국식과
--   동일하므로 보정 제외.
--
-- 방식:
--   unique constraint (company_id, period_type, fiscal_year, fiscal_quarter) 충돌 회피를
--   위해 2단계 UPDATE: +10000 → -10001 (BEGIN/COMMIT 트랜잭션).

BEGIN;

WITH japan_non_dec AS (
  SELECT DISTINCT f.company_id
  FROM financials f
  JOIN companies c ON c.id = f.company_id
  WHERE c.country = 'JP'
    AND f.period_type = 'annual'
    AND extract(month from f.period_end_date) != 12
)
UPDATE financials
SET fiscal_year = fiscal_year + 10000
WHERE company_id IN (SELECT company_id FROM japan_non_dec);

UPDATE financials
SET fiscal_year = fiscal_year - 10001
WHERE fiscal_year > 10000;

COMMIT;
