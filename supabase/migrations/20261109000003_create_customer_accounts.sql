-- 고객사 페이지(/customers) 명단 — 사외비. 명단 자체가 영업 정보라 RLS on + 정책 없음(default deny).
-- 행은 마이그레이션이 아니라 로컬 service_role 1회 INSERT 로만 넣는다(공개 레포에 명단을 남기지 않는다).
create table public.customer_accounts (
  company_id uuid primary key references public.companies(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  display_order int not null,
  -- 손익(pnl_entries.customer) 에서 이 회사로 묶을 고객명들. 비면 비중 「해당 없음」.
  pnl_customers text[] not null default '{}',
  -- 손익에 합산 행만 있는 회사들끼리 같은 값(결정 5). 화면은 「합산」 배지.
  share_group text,
  -- oem_sales_group_month.oem_group. MarkLines 에 단독 그룹이 없으면 null.
  marklines_group text,
  -- 기존 OEM 회사 탭 경로. 없으면 null.
  oem_tab_path text check (oem_tab_path is null or oem_tab_path ~ '^/oem/[a-z0-9/-]+$'),
  note text,
  created_at timestamptz not null default now()
);

alter table public.customer_accounts enable row level security;

comment on table public.customer_accounts is
  '고객사 페이지 명단(사외비) — service_role 전용. 정책 없음 = anon·authenticated 차단.';
