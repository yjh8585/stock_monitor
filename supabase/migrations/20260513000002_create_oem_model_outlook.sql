-- 북미 핵심 차종 AI 평가 (Claude Haiku 4.5) 결과 저장
-- 주 1회 자동 수집 → (model_key, note_date) 유니크. 최신 1건씩 카드에 노출.

CREATE TABLE IF NOT EXISTS oem_model_outlook (
  model_key     text NOT NULL,        -- 'grand_cherokee' 등 slug
  model_name    text NOT NULL,        -- 'Jeep Grand Cherokee'
  oem_group     text NOT NULL,
  region        text NOT NULL DEFAULT 'North America',
  note_date     date NOT NULL,
  label         text NOT NULL,        -- 'GREEN' | 'YELLOW' | 'RED'
  consumer_view text NOT NULL,        -- 소비자 평가 요약 (2~3줄)
  outlook       text NOT NULL,        -- 판매전망 요약 (2~3줄)
  rationale     text NOT NULL,        -- 색상 라벨 근거 (1~2줄)
  sources_used  text,                 -- 참고한 뉴스/리뷰 출처 메타
  PRIMARY KEY (model_key, note_date)
);

CREATE INDEX IF NOT EXISTS idx_omo_recent ON oem_model_outlook(note_date DESC);
