-- financials INSERT/UPDATE 시 dart_collection_status='success' 자동 SET.
-- collect_dart_audit.py가 status를 SET하지 않는 구조라 매 GHA cron 후 NULL로 남던 이슈 해소.
-- B 옵션: SQL 트리거로 모든 수집 경로 자동화.
--
-- 조건:
--   - 대상 회사가 data_source='dart' AND status='active'
--   - financials.period_type='annual' AND fiscal_year >= 올해-2 (최근 데이터일 때만)
--   - 현재 status != 'success' (불필요한 write skip)

CREATE OR REPLACE FUNCTION trg_set_dart_collection_status() RETURNS trigger AS $$
BEGIN
  IF NEW.period_type <> 'annual' THEN
    RETURN NEW;
  END IF;
  IF NEW.fiscal_year < EXTRACT(YEAR FROM now())::int - 2 THEN
    RETURN NEW;
  END IF;
  UPDATE companies
  SET dart_collection_status = 'success',
      last_collect_error = NULL,
      retry_after = NULL
  WHERE id = NEW.company_id
    AND status = 'active'
    AND data_source = 'dart'
    AND dart_collection_status IS DISTINCT FROM 'success';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS financials_auto_set_dart_status ON financials;
CREATE TRIGGER financials_auto_set_dart_status
  AFTER INSERT OR UPDATE ON financials
  FOR EACH ROW
  EXECUTE FUNCTION trg_set_dart_collection_status();

COMMENT ON FUNCTION trg_set_dart_collection_status() IS
  'financials INSERT/UPDATE 시 data_source=dart 회사의 dart_collection_status를 success로 자동 SET.';
COMMENT ON TRIGGER financials_auto_set_dart_status ON financials IS
  'collect_dart_audit가 status SET 안 하던 구조 보완. 모든 수집 경로 자동화.';
