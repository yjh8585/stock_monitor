-- 나를 찾아서: 나이 입력 제거(2026-11-24 사용자 선택 「빼기」) — stock_monitor 프로젝트(tvexumxeobciihlqncal)에 적용
-- 칸은 지우지 않고 비어 있어도 되게만 바꾼다. 예전 화면을 연 채 시험 중인 사람이 age 를 보내도 저장이 실패하지 않게
-- (1~120 검사는 그대로 — null 은 검사를 통과한다). anon insert 열 권한도 그대로 둔다.
alter table public.psycho_submissions alter column age drop not null;
comment on column public.psycho_submissions.age is '2026-11-24 부터 받지 않음(예전 화면 응시자만 채워질 수 있음)';
