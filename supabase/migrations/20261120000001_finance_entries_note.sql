-- 재무 3번 「자금수지」 표 — 계정별 비고(내역) 칸.
-- 엑셀 '재무' 시트 8열 '비고'를 그대로 싣는다. 화면은 셀 호버·비고 칸으로 보여 준다.
-- 「[더미]」로 시작하면 입력 예시용 가짜 값이라는 표식(화면이 주황 기울임으로 구분).
alter table public.finance_entries add column if not exists note text;

comment on column public.finance_entries.note is
  '엑셀 재무 시트 비고(내역). [더미]로 시작하면 입력 예시용 가짜 값';
