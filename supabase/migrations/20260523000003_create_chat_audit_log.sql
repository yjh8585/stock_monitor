-- chat_audit_log: 챗봇 도구 호출 감사 기록.
-- 누가 언제 어떤 도구를 어떤 인자로 호출했고 결과 행 수가 얼마인지 기록한다.
-- 외부 LLM(Anthropic) 전송이 발생하는 챗봇이므로 유출 의심 발생 시 추적 가능해야 한다.
-- 보존: 1년 (자동 삭제 잡은 별도 cron 또는 수동 운영).

CREATE TABLE chat_audit_log (
  id          bigserial PRIMARY KEY,
  user_id     text       NOT NULL,
  user_role   text       NOT NULL,
  tool_name   text       NOT NULL,
  input_json  jsonb      NOT NULL,
  row_count   integer,                       -- 도구 응답이 rows 배열을 가지면 그 길이, 아니면 NULL
  is_error    boolean    NOT NULL DEFAULT false,
  error_msg   text,                          -- is_error=true 시에만 채움
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_audit_log_created_at ON chat_audit_log(created_at DESC);
CREATE INDEX idx_chat_audit_log_user_id    ON chat_audit_log(user_id, created_at DESC);
CREATE INDEX idx_chat_audit_log_tool_name  ON chat_audit_log(tool_name, created_at DESC);

ALTER TABLE chat_audit_log ENABLE ROW LEVEL SECURITY;
-- 정책 없음 → anon/authenticated 모두 deny. service_role(admin)만 INSERT/SELECT 가능.

COMMENT ON TABLE chat_audit_log IS '챗봇 도구 호출 감사 로그. 보존 1년. service_role 전용.';
