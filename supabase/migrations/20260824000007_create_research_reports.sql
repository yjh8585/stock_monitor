-- 네이버 증권사 리포트 정본 표 (계획서 P3-a · 확정된 결정 1)
--
-- 왜 볼트가 아니라 Supabase 인가: stock_monitor 는 Vercel 에서 돌아 로컬 옵시디언 볼트를
-- 읽을 수 없다. 그래서 리포트만은 DB 를 정본으로 둔다(계획서 결정 1).
--
-- 컬럼명 한 가지가 계획서 스케치와 다르다 — 계획서는 `stock_code` 라 적었지만 이 레포는
-- companies 를 비롯해 전부 `ticker` 를 쓴다. 확정된 결정 13건에 없는 항목이고 동작도
-- 같으므로 레포 관례를 따랐다(전역 규칙 「기존 스타일에 맞춘다」).
-- 경위 = docs/superpowers/plans/2026-08-24-humanoid-research_결정이행.md (agents 레포)

CREATE TABLE IF NOT EXISTS research_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 어디서 왔나
  source          text NOT NULL DEFAULT 'naver',
  kind            text NOT NULL CHECK (kind IN ('industry', 'company')),
  naver_nid       integer NOT NULL,

  -- 무엇에 대한 리포트인가
  target_name     text NOT NULL,                       -- 종목명 또는 업종명
  company_id      uuid REFERENCES companies(id) ON DELETE SET NULL,
  ticker          text,

  -- 메타
  title           text NOT NULL,
  broker          text,
  published_at    date,
  pdf_url         text,
  view_count      integer,

  -- 요약 (NULL = 메타만 저장 · 요약 대상 아님 — 계획서 결정 3)
  summary         text,
  is_delta        boolean NOT NULL DEFAULT false,      -- 후속 리포트(직전 대비 변화만 요약)
  prev_report_id  uuid REFERENCES research_reports(id) ON DELETE SET NULL,
  target_price    numeric,
  opinion         text,

  -- 정기물(데일리·위클리 등)은 요약 대상에서 제외 — 계획서 결정 3
  is_periodic     boolean NOT NULL DEFAULT false,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- 🔴 재실행해도 건수가 늘지 않게 하는 유일한 방어선.
  --    naver_nid 는 산업/종목 목록에서 각각 따로 매겨지므로 kind 와 묶어야 한다.
  CONSTRAINT research_reports_nid_uniq UNIQUE (kind, naver_nid)
);

-- 화면 3가지 조회 패턴에 각각 대응한다.
CREATE INDEX IF NOT EXISTS research_reports_group_idx
  ON research_reports (broker, target_name, published_at DESC);   -- 델타 묶기
CREATE INDEX IF NOT EXISTS research_reports_company_idx
  ON research_reports (company_id, published_at DESC);            -- 종목별 이력
CREATE INDEX IF NOT EXISTS research_reports_published_idx
  ON research_reports (published_at DESC);                        -- 최신순 목록

-- 요약 대기열 조회(summary IS NULL 인 대상)를 매번 풀스캔하지 않도록.
-- 부분 인덱스라 이미 요약된 행은 색인에 들어가지 않는다.
CREATE INDEX IF NOT EXISTS research_reports_pending_idx
  ON research_reports (published_at DESC)
  WHERE summary IS NULL;

ALTER TABLE research_reports ENABLE ROW LEVEL SECURITY;

-- 키움 웹앱이 anon 키로 읽는다(계획서 P3-c).
DROP POLICY IF EXISTS research_reports_read ON research_reports;
CREATE POLICY research_reports_read ON research_reports
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS research_reports_write ON research_reports;
CREATE POLICY research_reports_write ON research_reports
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 내용이 같은 UPDATE 를 삼켜 ISR Write 과금을 줄인다(20260803000002 와 같은 함수).
-- 🔴 수집기가 매 회차 같은 행을 다시 써도 실제 변경이 없으면 트리거가 막는다.
DROP TRIGGER IF EXISTS trg_skip_identical_update ON research_reports;
CREATE TRIGGER trg_skip_identical_update
  BEFORE UPDATE ON research_reports
  FOR EACH ROW EXECUTE FUNCTION public.skip_identical_update();

COMMENT ON TABLE research_reports IS
  '네이버 증권 리서치(산업분석·종목분석) 메타 + 선별 요약. 수집=collect_naver_research.py · 요약=summarize_naver_research.py';
COMMENT ON COLUMN research_reports.summary IS
  'NULL = 메타만 저장(요약 대상 아님). 선별 규칙은 scripts/lib/naver_research.py 의 is_summary_target';
COMMENT ON COLUMN research_reports.is_delta IS
  'true = 같은 (broker, target_name) 묶음의 후속 리포트라 직전 대비 변화만 요약했다';
