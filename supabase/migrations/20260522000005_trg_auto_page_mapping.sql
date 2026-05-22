-- 신규 회사 INSERT 시 data_source에 따라 company_pages 자동 등록.
-- HL클레무브 같은 onboard 누락 방지 (회사만 등록되고 page 매핑 빠진 케이스).
--
-- 정책 (2026-05-22 사용자 확정):
--   data_source='dart' (한국 비상장 외감)        → domestic
--   data_source='fnguide' (한국 상장)            → domestic (related-stocks는 사용자 수동)
--   data_source='yfinance' (글로벌 상장)         → parts-top100 (related-stocks는 사용자 수동)
--   data_source='marklines' (글로벌 비상장 부품) → parts-top100
--   data_source='pykrx+dart' (특수)              → domestic
--   그 외 NULL/unknown                           → 매핑 없음 (사용자 수동)
--
-- AFTER INSERT 트리거 — 회사 row가 commit된 후 page 등록.
-- 사용자가 추가/제거하면 트리거가 다시 발동하지 않으므로 수동 제어 가능.

CREATE OR REPLACE FUNCTION trg_auto_page_mapping() RETURNS trigger AS $$
DECLARE
  pages text[];
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  pages := CASE NEW.data_source
    WHEN 'dart' THEN ARRAY['domestic']
    WHEN 'fnguide' THEN ARRAY['domestic']
    WHEN 'yfinance' THEN ARRAY['parts-top100']
    WHEN 'marklines' THEN ARRAY['parts-top100']
    WHEN 'pykrx+dart' THEN ARRAY['domestic']
    ELSE NULL
  END;

  IF pages IS NULL OR array_length(pages, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO company_pages (company_id, page)
  SELECT NEW.id, unnest(pages)
  ON CONFLICT (company_id, page) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS companies_auto_page_mapping ON companies;
CREATE TRIGGER companies_auto_page_mapping
  AFTER INSERT ON companies
  FOR EACH ROW
  EXECUTE FUNCTION trg_auto_page_mapping();

COMMENT ON FUNCTION trg_auto_page_mapping() IS
  'AFTER INSERT 트리거 — data_source에 따라 company_pages를 자동 등록. ON CONFLICT DO NOTHING으로 멱등성 확보.';
COMMENT ON TRIGGER companies_auto_page_mapping ON companies IS
  '신규 회사 등록 시 기본 page 매핑. UPDATE에는 발동 안 함 (수동 제어 보존).';
