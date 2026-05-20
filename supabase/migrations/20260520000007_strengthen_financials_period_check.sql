-- financials period semantic CHECK 강화.
-- 배경:
--   기존 financials_period_semantic_check 는 fiscal_quarter NULL 여부만 검사했다.
--   period_end_date 의 월은 검사하지 않아 annual 에 분기 데이터(2026-03-31 등)가 들어와도 통과.
--   추가6 코드 가드(_build_kr_rows) 는 KR fnguide 경로 한 곳만 차단하므로 DB 백스톱 필요.
-- 정책:
--   허용 월 = {3, 5, 6, 8, 9, 12} — 현재 DB 에 존재하는 모든 정상 결산월
--     12: 한국 KOSPI/KOSDAQ + 미국 대부분 + 독일 일부
--     3:  일본 (3월 결산)
--     5:  헬라 (HLE.DE)
--     6:  야자키 (일본 일부)
--     8:  자빌 (JBL)
--     9:  ADNT / IFX.DE / TKA.DE / TEL (미국·독일 9월 결산)
--   분기 어긋난 월(1,2,4,7,10,11)이 annual 로 적재 시도되면 차단.
--   향후 새 결산월 회사 도입 시 본 제약 보강 마이그레이션 필요.
-- 사전 검증: WHERE period_type='annual' AND EXTRACT(MONTH FROM period_end_date) NOT IN (3,5,6,8,9,12) → 0건.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'financials_period_semantic_check'
  ) THEN
    ALTER TABLE financials DROP CONSTRAINT financials_period_semantic_check;
  END IF;
END $$;

ALTER TABLE financials
  ADD CONSTRAINT financials_period_semantic_check
  CHECK (
    (period_type = 'annual'
     AND fiscal_quarter IS NULL
     AND EXTRACT(MONTH FROM period_end_date) IN (3, 5, 6, 8, 9, 12))
    OR
    (period_type = 'quarterly'
     AND fiscal_quarter BETWEEN 1 AND 4)
  );

COMMENT ON CONSTRAINT financials_period_semantic_check ON financials IS
  'annual: fiscal_quarter NULL + period_end_date 월 IN (3,5,6,8,9,12). quarterly: fiscal_quarter 1~4.';
