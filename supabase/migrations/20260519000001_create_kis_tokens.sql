-- KIS Developers OAuth access_token 캐싱 테이블.
-- 토큰 발급은 1분당 1회 제한, 유효기간 24시간. 매 요청마다 발급 금지.
-- env_key는 'prod' | 'vts' (실전 / 모의투자) — 환경별 토큰을 한 행씩 보관.
-- RLS: service_role 전용 (anon 노출 금지: 토큰 자체가 시크릿).

CREATE TABLE IF NOT EXISTS kis_tokens (
  env_key     text PRIMARY KEY CHECK (env_key IN ('prod', 'vts')),
  token       text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE kis_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_rw_kis_tokens"
  ON kis_tokens FOR ALL TO service_role
  USING (true) WITH CHECK (true);
