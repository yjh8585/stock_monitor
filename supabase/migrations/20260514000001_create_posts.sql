-- 보고서/유튜브 게시판 (youtube-summary 통합)
--
-- 이전: youtube-summary 프로젝트의 큐레이션 게시판 데이터를 stock_monitor Supabase로 이관.
-- 소스: 유튜브 영상(자막 + Gemini 해설) 또는 보고서(웹페이지 / PDF + Claude 분석).
-- 본문(content)은 마크다운(Mermaid 다이어그램 포함)으로 저장.

CREATE TABLE posts (
  id BIGSERIAL PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('youtube', 'report')),
  title TEXT NOT NULL,
  source_name TEXT,
  source_url TEXT,
  file_path TEXT,
  file_name TEXT,
  thumbnail_url TEXT,
  content TEXT,
  key_scenes JSONB,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  error_message TEXT,
  source_published_at TIMESTAMPTZ,
  category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE posts IS '보고서/유튜브 큐레이션 게시판 (LLM 자동 생성 본문)';
COMMENT ON COLUMN posts.source_type IS 'youtube | report';
COMMENT ON COLUMN posts.file_path IS 'Supabase Storage reports 버킷 내 경로 (PDF만)';
COMMENT ON COLUMN posts.content IS 'LLM이 생성한 마크다운 본문';
COMMENT ON COLUMN posts.status IS 'processing | completed | failed';

CREATE INDEX idx_posts_source_type         ON posts (source_type);
CREATE INDEX idx_posts_category            ON posts (category);
CREATE INDEX idx_posts_source_name         ON posts (source_name);
CREATE INDEX idx_posts_created_at          ON posts (created_at DESC);
CREATE INDEX idx_posts_source_published_at ON posts (source_published_at DESC);
CREATE INDEX idx_posts_status              ON posts (status);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION posts_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_posts_set_updated_at
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION posts_set_updated_at();

-- RLS: 읽기는 anon/authenticated 모두 허용, 쓰기는 service_role만
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "posts_select_all" ON posts
  FOR SELECT
  TO anon, authenticated
  USING (true);
-- INSERT/UPDATE/DELETE 정책 미설정 = service_role만 가능
