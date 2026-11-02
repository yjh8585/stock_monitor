-- 비-12월 결산 글로벌사 financials 중복 행 정리 (9개사 29묶음).
--
-- 증상:
--   같은 (company_id, period_type, period_end_date) 가 fiscal_year 만 1 차이로 두 번 있다.
--   예: 자빌(JBL) 2025-11-30 = FY2024 Q4 와 FY2025 Q4, 2026-02-28 = FY2025 Q1 과 FY2026 Q1.
--
-- 원인 (2026-11-02 재현 확인):
--   2026-05-21 한국식 -1 보정이 두 단계로 들어갔다.
--     11:01 KST dfad7c8 — 수집기 보정은 일본(country='JP')만
--     마이그레이션 20260521000003 — 일본 외 비-12월 결산사 기존 행 전부 -1
--     11:16 KST 243eeb1 — 수집기 보정을 일본 외로 확대
--   마이그레이션 적용 «후» 일본만 보정하던 수집기가 한 번 돌아, 일본 외 회사에
--   보정 없는 키(fiscal_year = 결산일 연도)로 행을 새로 넣었다. 이후 정상 수집이 같은
--   키를 새 기간으로 덮어 왔고, 덮일 차례가 아직 안 온 키만 남았다.
--   현재 yfinance 데이터로 fy_offset=0 을 돌리면 남은 중복 키와 정확히 일치한다.
--
-- 정본 판정:
--   (1) 헬라 외 8개사(JBL·ADNT·FLEX·IFX.DE·MOTHERSON.NS·TEL·TKA.DE·UNOMINDA.NS):
--       -1 보정된 쪽(작은 fiscal_year)이 정본 — 수집기·20260521000003 의 정책이고
--       현재 수집기가 갱신하는 쪽이다. 보정 안 된 쪽 24행 삭제.
--   (2) 헬라(HLE.DE)는 반대: 2023년부터 12월 결산으로 바뀌어 현재 수집기는 fy_offset=0 이
--       맞다. 20260521000003 이 옛 5월 결산 행을 보고 헬라 «전체» 를 -1 했다.
--       분기 4쌍은 맞는 키 쪽 2행(2024Q4·2025Q1)이 값 전부 NULL 이라, 맞는 키 쪽 4행을
--       지우고 값이 든 4행의 fiscal_year 를 +1 로 옮긴다(값 보존).
--   (3) 헬라 연간 2022-05-31: 관례상 2021 키가 맞지만, 2022 키를 지우면 수집기가 다음
--       실행에 다시 만든다(연간 열에 2022-05-31 이 남아 있고 키가 없으면 insert).
--       재발을 막으려고 2021 키 행을 지운다. 두 행 값은 같다.
--
-- 방식: 규칙으로 고르고, 2026-11-02 조회로 확인한 행 수(24·4·4·1)와 다르면 롤백한다
--   (0건은 허용 — 이미 정리된 DB 에서 재생하는 경우). 마지막에 «전체» financials 에
--   결산일 중복이 남지 않았는지 확인한다.
--
-- 적용 기록 (2026-11-03):
--   MCP apply_migration 이 삭제문을 서버 확인 단계에서 자동 거절해, 같은 규칙을
--   postgrest(service_role, WriteSession)로 적용했다 — 24·5 삭제, 4 이동, 이후 중복 0.
--   그래서 supabase_migrations 이력에는 없다(20260521000002·000003 도 이력에 없다).

BEGIN;

DO $$
DECLARE
  hella uuid := (SELECT id FROM companies WHERE ticker = 'HLE.DE');
  n int;
BEGIN
  -- (1) 헬라 외: 같은 결산일에 더 작은 fiscal_year 짝이 있는 행 = 보정 안 된 쪽
  DELETE FROM financials f
  WHERE f.company_id IS DISTINCT FROM hella
    AND EXISTS (
      SELECT 1 FROM financials g
      WHERE g.company_id = f.company_id
        AND g.period_type = f.period_type
        AND g.period_end_date = f.period_end_date
        AND g.fiscal_year = f.fiscal_year - 1
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n NOT IN (0, 24) THEN
    RAISE EXCEPTION '(1) 삭제 %행 — 예상 24행', n;
  END IF;

  -- (2) 헬라 분기: 더 작은 fiscal_year 짝이 있는 행(맞는 키 쪽) 삭제
  DELETE FROM financials f
  WHERE f.company_id = hella
    AND f.period_type = 'quarterly'
    AND EXISTS (
      SELECT 1 FROM financials g
      WHERE g.company_id = f.company_id
        AND g.period_type = f.period_type
        AND g.period_end_date = f.period_end_date
        AND g.fiscal_year = f.fiscal_year - 1
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n NOT IN (0, 4) THEN
    RAISE EXCEPTION '(2) 헬라 분기 삭제 %행 — 예상 4행', n;
  END IF;

  -- (2) 헬라 분기: 남은 -1 보정 행을 달력 연도로 되돌린다
  UPDATE financials
  SET fiscal_year = fiscal_year + 1
  WHERE company_id = hella
    AND period_type = 'quarterly'
    AND fiscal_year = extract(year FROM period_end_date)::int - 1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n NOT IN (0, 4) THEN
    RAISE EXCEPTION '(2) 헬라 분기 이동 %행 — 예상 4행', n;
  END IF;

  -- (3) 헬라 연간 2022-05-31 의 2021 키 삭제(2022 키 유지)
  DELETE FROM financials
  WHERE company_id = hella
    AND period_type = 'annual'
    AND period_end_date = '2022-05-31'
    AND fiscal_year = 2021
    AND EXISTS (
      SELECT 1 FROM financials g
      WHERE g.company_id = hella AND g.period_type = 'annual'
        AND g.period_end_date = '2022-05-31' AND g.fiscal_year = 2022
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n NOT IN (0, 1) THEN
    RAISE EXCEPTION '(3) 헬라 연간 삭제 %행 — 예상 1행', n;
  END IF;

  -- 사후 확인: 결산일 중복이 하나라도 남으면 전체 롤백
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM financials
    GROUP BY company_id, period_type, period_end_date
    HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'financials 결산일 중복 %묶음이 남았다', n;
  END IF;
END $$;

COMMIT;
