-- 나를 찾아서 응시 기록 쓰기 권한 좁히기 — stock_monitor 프로젝트(tvexumxeobciihlqncal)에 적용 (2026-11-24 코드 검토 반영)
-- ① anon 은 created_at 을 못 넣는다 — 서버 시각(now())만. 미래·'infinity' 날짜로 관리자 목록을 가리거나 멈추게 하던 구멍
-- ② answers 에 빈 값(null) 금지 — 관리자 화면이 answers 로 다시 채점한다
-- ③ result 는 JSON 객체만 (관리자 화면은 result 를 믿지 않지만 기록 모양은 지킨다)

revoke insert on public.psycho_submissions from anon;
grant insert (id, name, age, consent, answers, result) on public.psycho_submissions to anon;

alter table public.psycho_submissions
  add constraint psycho_submissions_answers_no_null check (array_position(answers, null) is null),
  add constraint psycho_submissions_result_object check (jsonb_typeof(result) = 'object');
