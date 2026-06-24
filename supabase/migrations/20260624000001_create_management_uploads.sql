-- 경영관리 엑셀 업로드 작업 추적 (사외비). 금액 비노출 — summary엔 행수/연도/mismatch만.
-- 소스: admin이 /management/upload에서 올린 자료정리_월별손익*.xlsx.
-- RLS enable + 정책 없음(default deny) → anon 직접 접근 불가, 서버는 confidentialDb(service_role) 전용.
create table public.management_uploads (
  id          uuid primary key default gen_random_uuid(),
  status      text not null default 'uploaded'
              check (status in (
                'uploaded', 'dry_run_running', 'dry_run_ok', 'dry_run_failed',
                'applying', 'applied', 'apply_failed'
              )),
  mode        text check (mode in ('dry-run', 'apply')),
  excel_path  text not null,
  file_name   text not null,
  uploaded_by text,
  summary     jsonb,
  error_msg   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.management_uploads enable row level security;

create index management_uploads_created_at_idx
  on public.management_uploads (created_at desc);

-- updated_at 자동 갱신
create or replace function public.management_uploads_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger management_uploads_updated_at
  before update on public.management_uploads
  for each row execute function public.management_uploads_set_updated_at();

comment on table public.management_uploads is
  '경영관리 엑셀 업로드 작업 추적(사외비). RLS default deny, confidentialDb 전용. summary 금액 비노출.';

-- 사외비 엑셀 원본 비공개 버킷 (service_role만 접근, 정책 없음 → anon deny).
insert into storage.buckets (id, name, public)
values ('management-excel', 'management-excel', false)
on conflict (id) do nothing;
