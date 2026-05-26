-- UzAuto Motors(우즈베키스탄 OEM) 등 PDF-only 보고서 회사를 지원하기 위한 변경.
-- 두 가지를 한 파일에 묶는다:
--   (a) trg_auto_page_mapping() 함수에 'uzauto-pdf' → related-stocks 분기 추가
--   (b) PDF 재처리 캐시 테이블 uzauto_pdf_cache 신규 (sha256/etag 변경분만 LLM 재호출)
--
-- 향후 다른 PDF-only 회사가 생기면 같은 'xxx-pdf' 패턴으로 enum 한 줄, 트리거 한 줄 추가.

-- ---------------------------------------------------------------------------
-- (a) 자동 page 매핑 트리거 — 'uzauto-pdf' 분기 추가
-- ---------------------------------------------------------------------------
-- 기존 분기는 그대로 보존. UPDATE에는 발동 안 함(수동 제어 보존).

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
    WHEN 'uzauto-pdf' THEN ARRAY['related-stocks']  -- PDF-only OEM (UzAuto Motors)
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

COMMENT ON FUNCTION trg_auto_page_mapping() IS
  'AFTER INSERT 트리거 — data_source에 따라 company_pages 자동 등록. uzauto-pdf 등 ''xxx-pdf'' 패턴은 PDF-only 회사 케이스.';

-- ---------------------------------------------------------------------------
-- (b) PDF 재처리 캐시 테이블 — uzauto_pdf_cache
-- ---------------------------------------------------------------------------
-- collect_uzauto_financials.py 가 /investors 에서 추출한 PDF URL의 sha256/etag을 저장.
-- 매주 cron 실행 시 해시 변경분만 Anthropic API 호출 → 비용·시간 절감.
-- 사외비는 아니지만 anon 직접 접근 차단을 위해 RLS enable + 정책 없음(default deny).
-- service_role 클라이언트(scripts/lib/db.py)만 R/W.

CREATE TABLE IF NOT EXISTS uzauto_pdf_cache (
  url text PRIMARY KEY,
  fiscal_year smallint NOT NULL,
  report_type text NOT NULL CHECK (report_type IN ('annual', 'half_year')),
  etag text,
  sha256 text,
  last_processed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE uzauto_pdf_cache ENABLE ROW LEVEL SECURITY;
-- 정책 없음 (default deny). PnL 등과 동일 패턴.

COMMENT ON TABLE uzauto_pdf_cache IS
  'UzAuto IFRS PDF 보고서 처리 이력 — url PK + sha256/etag으로 변경 감지. service_role 전용.';
