-- 한세그룹 대시보드(/app/hansae) 지원 스키마
-- 신규 5개 테이블 + RLS + 한세 3종목(016450 한세예스24홀딩스, 105630 한세실업, 069640 한세엠케이) 시드.

-- 1) 장중 5분봉 시세 시계열 (키움 REST 폴링 결과 적재)
CREATE TABLE IF NOT EXISTS stock_quotes_5min (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ts         timestamptz NOT NULL,
  price      numeric NOT NULL,
  change_pct numeric,
  volume     bigint,
  PRIMARY KEY (company_id, ts)
);
CREATE INDEX IF NOT EXISTS idx_quotes_5min_company_ts
  ON stock_quotes_5min (company_id, ts DESC);
ALTER TABLE stock_quotes_5min ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_quotes_5min"
  ON stock_quotes_5min FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_quotes_5min"
  ON stock_quotes_5min FOR ALL TO service_role USING (true);

-- 2) 일별 투자자별 매매동향 (외국인/기관/개인/프로그램 순매수)
CREATE TABLE IF NOT EXISTS stock_supply_demand (
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  trade_date      date NOT NULL,
  foreign_net     bigint,
  institution_net bigint,
  individual_net  bigint,
  program_net     bigint,
  PRIMARY KEY (company_id, trade_date)
);
ALTER TABLE stock_supply_demand ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_supply_demand"
  ON stock_supply_demand FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_supply_demand"
  ON stock_supply_demand FOR ALL TO service_role USING (true);

-- 3) 네이버 종목토론 원문
CREATE TABLE IF NOT EXISTS naver_board_posts (
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  post_id     text NOT NULL,
  posted_at   timestamptz NOT NULL,
  title       text NOT NULL,
  body        text,
  views       integer DEFAULT 0,
  likes       integer DEFAULT 0,
  dislikes    integer DEFAULT 0,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_naver_posts_company_posted
  ON naver_board_posts (company_id, posted_at DESC);
ALTER TABLE naver_board_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_naver_posts"
  ON naver_board_posts FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_naver_posts"
  ON naver_board_posts FOR ALL TO service_role USING (true);

-- 4) LLM 감성 분석 결과
CREATE TABLE IF NOT EXISTS board_sentiment (
  company_id  uuid NOT NULL,
  post_id     text NOT NULL,
  label       text NOT NULL CHECK (label IN ('positive', 'negative', 'neutral')),
  score       numeric CHECK (score BETWEEN -1.0 AND 1.0),
  reason      text,
  model       text NOT NULL,
  analyzed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, post_id),
  FOREIGN KEY (company_id, post_id)
    REFERENCES naver_board_posts(company_id, post_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sentiment_company_analyzed
  ON board_sentiment (company_id, analyzed_at DESC);
ALTER TABLE board_sentiment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_sentiment"
  ON board_sentiment FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_sentiment"
  ON board_sentiment FOR ALL TO service_role USING (true);

-- 5) 키움 OAuth access_token 캐시 (service_role 전용 — anon 정책 없음)
CREATE TABLE IF NOT EXISTS kiwoom_tokens (
  id           smallint PRIMARY KEY DEFAULT 1,
  access_token text NOT NULL,
  expires_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (id = 1)
);
ALTER TABLE kiwoom_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_rw_kiwoom_tokens"
  ON kiwoom_tokens FOR ALL TO service_role USING (true);

-- 6) 한세 3종목 시드 (ticker UNIQUE → 중복 시 무시)
INSERT INTO companies (ticker, name, name_kr, market, country, currency, data_source, status, is_seed)
VALUES
  ('016450', 'Hansae Yes24 Holdings', '한세예스24홀딩스', 'KOSPI',  'KR', 'KRW', 'pykrx', 'active', true),
  ('105630', 'Hansae',                '한세실업',         'KOSPI',  'KR', 'KRW', 'pykrx', 'active', true),
  ('069640', 'Hansae MK',             '한세엠케이',       'KOSDAQ', 'KR', 'KRW', 'pykrx', 'active', true)
ON CONFLICT (ticker) DO NOTHING;
