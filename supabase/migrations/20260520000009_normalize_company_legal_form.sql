-- 회사명 법인격 표기 자동 정규화
--
-- 배경:
--   companies.name / name_kr에 "(주)", "(유)", "㈜", "(株)", "주식회사",
--   "유한회사", "유한책임회사" 같은 법인격 표기가 섞여 있어 화면 노출이 들쭉날쭉.
--   hidden → active 복원된 회사들 다수가 이 패턴으로 dirty 상태.
--
-- 처리:
--   1) clean_company_legal_form(text): 한글 법인격 표기 제거 + 공백 정리
--      - 영문 접미사(Inc., Corp. 등)는 다루지 않음 (사용자 요청 범위 한정)
--   2) BEFORE INSERT/UPDATE 트리거: 어떤 경로(seed/enrich/dart/수동)로 들어와도
--      companies.name / companies.name_kr 자동 정리 → 향후 dirty 행 발생 방지
--   3) 기존 데이터 일괄 UPDATE: dirty 행만 갱신
--
-- 무결성:
--   - companies UNIQUE 제약은 ticker만 → name/name_kr 정리 후 중복 발생해도 거절 없음
--   - 정리 결과가 빈 문자열이면 원본 유지 (방어)
--   - IMMUTABLE 함수로 표시 — 동일 입력에 동일 출력

CREATE OR REPLACE FUNCTION clean_company_legal_form(raw text) RETURNS text AS $$
DECLARE
  cleaned text;
BEGIN
  IF raw IS NULL OR length(trim(raw)) = 0 THEN
    RETURN raw;
  END IF;

  cleaned := raw;

  -- 1) 괄호형 법인격: (주), (유), (株), ㈜  (전각/반각 괄호 모두)
  cleaned := regexp_replace(cleaned, '[\(（](주|유|株)[\)）]', '', 'g');
  cleaned := replace(cleaned, '㈜', '');

  -- 2) 한글 법인격 단어 (긴 표기 먼저 매칭되도록 alternation 순서 보장)
  cleaned := regexp_replace(cleaned, '유한책임회사|유한회사|주식회사', '', 'g');

  -- 3) 연속 공백 → 단일 공백 + 앞뒤 trim
  cleaned := regexp_replace(cleaned, '\s+', ' ', 'g');
  cleaned := trim(cleaned);

  -- 결과가 비면 원본 유지
  IF length(cleaned) = 0 THEN
    RETURN raw;
  END IF;

  RETURN cleaned;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION clean_company_legal_form(text) IS
  '회사명에서 한글 법인격 표기((주)/(유)/㈜/(株)/주식회사/유한회사/유한책임회사) 제거 + 공백 정리';


-- 트리거 함수: INSERT/UPDATE 시 name / name_kr 자동 정리
CREATE OR REPLACE FUNCTION companies_clean_legal_form_trg() RETURNS trigger AS $$
BEGIN
  IF NEW.name IS NOT NULL THEN
    NEW.name := clean_company_legal_form(NEW.name);
  END IF;
  IF NEW.name_kr IS NOT NULL THEN
    NEW.name_kr := clean_company_legal_form(NEW.name_kr);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS companies_clean_legal_form_before_iu ON companies;
CREATE TRIGGER companies_clean_legal_form_before_iu
  BEFORE INSERT OR UPDATE OF name, name_kr ON companies
  FOR EACH ROW EXECUTE FUNCTION companies_clean_legal_form_trg();


-- 기존 데이터 일괄 정리 (변경 발생 행만)
UPDATE companies
SET
  name = clean_company_legal_form(name),
  name_kr = clean_company_legal_form(name_kr)
WHERE
  name IS DISTINCT FROM clean_company_legal_form(name)
  OR name_kr IS DISTINCT FROM clean_company_legal_form(name_kr);
