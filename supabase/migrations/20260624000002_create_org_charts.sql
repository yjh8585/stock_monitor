-- 조직도 이미지 메타데이터 (사외비) + 비공개 Storage 버킷.
-- chart_date = 조직도 스냅샷 날짜(시트명 _YYYYMMDD에서 파싱). 이력 누적 → upsert by chart_date.
-- image_path = org-charts 버킷 객체 키. RLS enable + 정책 없음(default deny):
--   서버는 confidentialDb(service_role)로만 접근. anon 직접 접근 불가.

create table if not exists public.org_charts (
  chart_date date primary key,
  title text,
  image_path text not null,
  source_file text,
  width int,
  height int,
  created_at timestamptz not null default now()
);

comment on table public.org_charts is
  '조직도 이미지 메타 (사외비). chart_date=스냅샷 날짜, image_path=org-charts 버킷 키.';

alter table public.org_charts enable row level security;
-- 정책 없음 = default deny.

-- 비공개 Storage 버킷 (public=false). 정책 없음 → anon 차단, service_role만 접근.
insert into storage.buckets (id, name, public)
values ('org-charts', 'org-charts', false)
on conflict (id) do nothing;
