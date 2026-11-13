-- 협력사(소싱 후보) 페이지 /oem/suppliers — 사외비. 계획 = docs/plans/2026-11-13-suppliers-page.md
-- 우리 제품 구성·경쟁사·검색어가 구매 전략이라 RLS on + 정책 없음(default deny).
-- 행은 마이그레이션이 아니라 로컬 service_role 로만 넣는다(공개 레포에 명단을 남기지 않는다).

create table public.sourcing_products (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name_ko text not null,
  display_order int not null
);

create table public.sourcing_part_groups (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.sourcing_products(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9-]+$'),
  name_ko text not null,
  display_order int not null,
  -- 이 품목군에 묶이는 우리 BOM 부품명(화면 설명용).
  bom_parts text[] not null default '{}',
  -- MarkLines 부품 분류명(검색 partsName · 「분류 일치」 판정).
  ml_part_names text[] not null default '{}',
  -- MarkLines 공정명(「공정만 일치」 판정 — 예: 단조·다이캐스팅).
  ml_processes text[] not null default '{}',
  -- 품목 설명(parts_comments)에서 찾을 영문 단어(「품목 명시」 판정).
  keywords text[] not null default '{}',
  unique (product_id, slug)
);

create table public.sourcing_competitors (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.sourcing_products(id) on delete cascade,
  name text not null,
  -- MarkLines 납품처 부분일치용 별칭(본사·국가 법인 이름이 갈려 잡힌다).
  aliases text[] not null default '{}',
  unique (product_id, name)
);

create table public.sourcing_suppliers (
  id bigint generated always as identity primary key,
  source text not null check (source in ('marklines', 'web')),
  ml_supplier_id bigint unique,
  ml_rand_code text,
  name text not null,
  country text,
  region text not null check (region in ('한국','중국','일본','북미','인도','동남아','유럽','기타')),
  location text,
  address text,
  homepage text,
  established text,
  sales_text text,
  employees int,
  certifications text[] not null default '{}',
  product_categories text[] not null default '{}',
  processes text[] not null default '{}',
  parts_comments text[] not null default '{}',
  delivers_oem text[] not null default '{}',
  delivers_supplier text[] not null default '{}',
  remarks text[] not null default '{}',
  source_url text,
  fetched_at timestamptz not null default now()
);

-- 어떤 검색에서 걸렸나(출처). 일치 단계·점수는 저장하지 않는다(결정 9 — 화면에서 계산).
create table public.sourcing_supplier_links (
  supplier_id bigint not null references public.sourcing_suppliers(id) on delete cascade,
  part_group_id bigint not null references public.sourcing_part_groups(id) on delete cascade,
  -- null = 경쟁사 무관 검색(부품명 단독)에서 걸림.
  competitor_id bigint references public.sourcing_competitors(id) on delete cascade,
  found_at timestamptz not null default now(),
  constraint sourcing_supplier_links_uniq unique nulls not distinct (supplier_id, part_group_id, competitor_id)
);

create index sourcing_supplier_links_group_idx on public.sourcing_supplier_links (part_group_id);

alter table public.sourcing_products enable row level security;
alter table public.sourcing_part_groups enable row level security;
alter table public.sourcing_competitors enable row level security;
alter table public.sourcing_suppliers enable row level security;
alter table public.sourcing_supplier_links enable row level security;

-- 수집 표 — 같은 값 upsert 가 WAL 을 불리지 않게(AGENTS 「신규 수집 테이블」).
-- fetched_at 은 매번 바뀌므로 sourcing_suppliers 에는 붙이지 않는다.
create trigger trg_skip_identical_update before update on public.sourcing_supplier_links
  for each row execute function public.skip_identical_update();

comment on table public.sourcing_suppliers is '협력사 후보 원자료(MarkLines·웹) — 사외비 · service_role 전용.';
