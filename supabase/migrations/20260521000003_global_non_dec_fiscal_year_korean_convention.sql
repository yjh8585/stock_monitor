-- 비-12월 결산 글로벌 회사의 fiscal_year를 한국식 표기로 -1 보정.
--
-- 배경:
--   yfinance가 회계연도를 period_end_date의 종료 연도로 부여. 9월 결산법인 같은
--   경우 FY2025/10~2026/9 → yfinance fiscal_year=2026 ↔ 12월 결산법인의 2026은
--   2026/1~12로 발표 시점이 2027/3경. 같은 "2026 컬럼"에 9월 결산 4~5개사만
--   채워지고 대다수는 비어있는 UI 왜곡 발생.
--
--   한국식 표기는 모든 회사를 동일 시간축에 정렬 → 비-12월 결산법인 fiscal_year -1.
--   사용자 결정 (2026-05-21): "9월 결산법인 때문에 매출/영업이익이 2026까지 표시,
--   대다수는 미발표" → 모든 비-12월 결산법인 한국식 보정.
--
-- 대상:
--   country NOT IN ('KR', 'JP') AND annual.period_end_date의 월 ≠ 12 회사의 전 financials 행
--   (KR: _build_kr_rows에서 비-12월 결산 스킵 / JP: 20260521000002에서 이미 -1 보정).
--   10개사, annual 46 + quarterly 58 = 총 104행.
--
--   - 3월 결산 (인도/홍콩/플렉스): MOTHERSON, UNOMINDA, 0179.HK, FLEX
--   - 5월 결산 (독일): HLE.DE (헬라, 옛 데이터만)
--   - 8월 결산 (미국): JBL (자빌)
--   - 9월 결산 (CH/DE/IE): TEL, IFX.DE, TKA.DE, ADNT
--
-- 방식:
--   unique constraint (company_id, period_type, fiscal_year, fiscal_quarter) 충돌 회피를
--   위해 2단계 UPDATE: +10000 → -10001 (BEGIN/COMMIT 트랜잭션).
--   (마이그레이션 20260521000002와 동일 패턴.)

BEGIN;

WITH non_dec_co AS (
  SELECT DISTINCT f.company_id
  FROM financials f
  JOIN companies c ON c.id = f.company_id
  WHERE c.country NOT IN ('KR', 'JP')
    AND f.period_type = 'annual'
    AND extract(month from f.period_end_date) != 12
)
UPDATE financials
SET fiscal_year = fiscal_year + 10000
WHERE company_id IN (SELECT company_id FROM non_dec_co);

UPDATE financials
SET fiscal_year = fiscal_year - 10001
WHERE fiscal_year > 10000;

COMMIT;
