-- 목록 화면용 요약 발췌 컬럼.
--
-- 🔴 왜 필요해졌나 — 2026-08-25 에 요약 규격을 「900~1,500자」에서 「3,000~6,000자」로
--    바꿨다(실제 산출물은 8,000자대도 나온다). `/humanoid/research` 목록은 리포트 144건을
--    한 번에 실어 나르는데, 본문을 그대로 담으면 캐시·클라이언트 payload 가 1MB 를 넘는다.
--    이 프로젝트는 이미 Vercel ISR Write 한도에 걸린 전력이 있다
--    (`docs/isr-write-optimization.md`) — 목록에는 발췌만 보낸다.
--
-- 800자인 이유: 화면에 쓰는 발췌는 180자인데, 그 앞에 인용 블록·헤딩·강조 기호가 섞여 있어
-- 마크다운을 걷어내면 짧아진다. 800자를 받아 두면 걷어낸 뒤에도 180자가 남는다.
--
-- GENERATED ALWAYS 라 직접 UPDATE 하지 않는다 — summary 만 고치면 따라 바뀐다
-- (`financials` 의 마진 컬럼들과 같은 규칙).

alter table public.research_reports
  add column if not exists summary_excerpt text
  generated always as (left(summary, 800)) stored;

comment on column public.research_reports.summary_excerpt is
  '목록 화면용 요약 앞부분(800자). 본문 전체는 상세 페이지에서만 읽는다 — ISR Write 절감.';
