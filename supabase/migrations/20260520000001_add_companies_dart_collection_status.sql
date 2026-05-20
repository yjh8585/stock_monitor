-- DART 수집 상태를 status 컬럼과 분리.
-- 배경:
--   기존 scripts/collect_dart_domestic.py 가 DART 매칭 실패(DART_NO_MATCH)나
--   감사보고서 미발견(NO_AUDIT_REPORT) 시 companies.status='delisted' 로 변경했다.
--   이후 collectDartDomestic 은 status='active' 만 대상으로 처리하므로
--   일시 실패한 회사가 영구 제외되는 회귀가 발생한다.
-- 조치:
--   수집 상태 전용 컬럼(dart_collection_status / last_collect_error / retry_after)을 신설하여
--   companies.status 의 의미(상장 상태)와 수집 결과를 분리한다.
--   status='delisted' 변경은 명시적 상장폐지 신호에서만 사용한다.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS dart_collection_status text,
  ADD COLUMN IF NOT EXISTS last_collect_error     text,
  ADD COLUMN IF NOT EXISTS retry_after            timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_dart_collection_status_check'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_dart_collection_status_check
      CHECK (
        dart_collection_status IS NULL
        OR dart_collection_status IN ('pending', 'success', 'failed', 'no_match', 'no_audit_report')
      );
  END IF;
END $$;

COMMENT ON COLUMN companies.dart_collection_status IS
  'DART 수집 상태(pending|success|failed|no_match|no_audit_report). NULL=미시도. companies.status 와는 독립.';
COMMENT ON COLUMN companies.last_collect_error IS
  'DART 수집 마지막 실패 사유(자유 텍스트).';
COMMENT ON COLUMN companies.retry_after IS
  'DART 재수집 가능 시각(이전 실패의 backoff). NULL=즉시 재시도 가능.';

-- 재시도 대기열 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_companies_dart_retry
  ON companies (dart_collection_status, retry_after)
  WHERE dart_collection_status IN ('failed', 'no_match', 'no_audit_report');
