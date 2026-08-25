-- 증권사 리포트 «영구 제외» 표시 (사용자 선택 2026-08-25)
--
-- 왜 필요한가:
--   사용자가 144편 중 의미 있는 것만 남기기로 해 나머지 요약을 지웠다. 그런데 요약기의
--   평소 대상은 「summary 가 비어 있는 것」이라, 지우는 순간 그 75편이 **다시 대상이 됐다.**
--   손대지 않으면 다음 스케줄이 빼기로 한 것을 도로 채운다.
--
-- 🔴 선별 규칙만으로 막지 않는 이유: 규칙이 완화되면 조용히 다시 딸려 들어온다.
--    사람이 내린 «이건 빼라»는 판단은 규칙과 별개로 데이터에 남겨야 한다.

alter table research_reports
  add column if not exists excluded_at timestamptz;

comment on column research_reports.excluded_at is
  '요약 대상에서 영구 제외한 시각. NULL 이면 대상. 되살리려면 NULL 로 되돌린다.';

-- 요약이 비어 있는 것 = 오늘 사용자가 빼기로 한 것들.
update research_reports
   set excluded_at = now()
 where summary is null
   and excluded_at is null;

-- 평소 조회는 «제외되지 않은 것»만 훑는다.
create index if not exists idx_research_reports_not_excluded
  on research_reports (published_at)
  where excluded_at is null;
