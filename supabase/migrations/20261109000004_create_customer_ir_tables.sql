-- 고객사 페이지 2단계 — 회사 공식 문서(EDGAR·DART·IR)와 거기서 뽑은 숫자. 전부 사외비(RLS on · 정책 없음).
-- 설계 = docs/plans/2026-11-09-customers-page.md · 계획 = …-phase2.md Task 1.

alter table public.companies add column if not exists sec_cik text
  check (sec_cik is null or sec_cik ~ '^[0-9]{1,10}$');
create unique index if not exists companies_sec_cik_key on public.companies (sec_cik) where sec_cik is not null;
comment on column public.companies.sec_cik is 'SEC EDGAR CIK(앞 0 없이). 고객사 문서 목록 수집 대상 판정.';

create table public.customer_documents (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  source text not null check (source in ('edgar', 'dart', 'ir')),
  -- 출처 고유 ID: EDGAR accession · DART 접수번호 · IR 은 어댑터가 정한 안정 키(URL 경로 등)
  source_id text not null,
  doc_type text not null check (doc_type in (
    'earnings_release', 'presentation', 'shareholder_letter', 'periodic', 'current_report', 'prelim_results',
    'sales_release', 'guidance', 'ir_event', 'fact_sheet', 'investor_day', 'other')),
  form text,
  items text,
  title text not null,
  url text not null,
  published_at date not null,
  sha256 text,
  parse_status text not null default 'pending'
    check (parse_status in ('pending', 'parsed', 'not_target', 'no_numbers_expected', 'failed')),
  parse_note text,
  first_seen_at timestamptz not null default now(),
  unique (source, source_id)
);
create index customer_documents_company_pub_idx on public.customer_documents (company_id, published_at desc);
create index customer_documents_pending_idx on public.customer_documents (company_id) where parse_status = 'pending';

create table public.customer_guidance (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  document_id bigint not null references public.customer_documents (id) on delete cascade,
  metric text not null,               -- 코드 키(ebit_adjusted·deliveries·revenue_growth …) — 실적 metric 과 같은 키
  metric_label text not null,         -- 회사가 쓴 이름 그대로
  period text not null check (period ~ '^FY[0-9]{4}$'),
  low numeric,
  high numeric,
  value_text text,                    -- 숫자 아닌 전망('Low-Single Digit %') — low·high 는 null
  unit text not null,                 -- billion·million·per_share·percent·units·text
  basis text check (basis is null or basis in ('reported', 'adjusted')),
  quote text not null,
  stated text check (stated is null or stated in ('raised', 'maintained', 'lowered', 'withdrawn')),
  direction text check (direction is null or direction in ('raised', 'maintained', 'lowered', 'initiated', 'withdrawn')),
  extractor text not null check (extractor in ('code', 'llm')),
  verified boolean not null default false,
  verify_note text,
  published_at date not null,
  unique (document_id, metric, period),
  check (low is not null or high is not null or value_text is not null)
);
create index customer_guidance_company_idx on public.customer_guidance (company_id, metric, period, published_at);

create table public.customer_volume_ir (
  company_id uuid not null references public.companies (id) on delete cascade,
  metric text not null check (metric in ('shipments', 'deliveries', 'production', 'wholesale', 'sales')),
  region text not null default 'total',
  period_grain text not null check (period_grain in ('month', 'quarter', 'ytd', 'year')),
  period text not null,               -- 2026-10 · 2026-Q3 · 2026-9M · 2026
  value bigint not null,
  definition text not null,
  quote text not null,
  document_id bigint references public.customer_documents (id) on delete set null,
  source text not null,               -- 'dart' · 'edgar' · 'ir'
  source_ref text,                    -- 접수번호 · accession · IR 키
  published_at date not null,
  verified boolean not null default false,
  primary key (company_id, metric, region, period_grain, period)
);

create table public.customer_reported_results (
  company_id uuid not null references public.companies (id) on delete cascade,
  period_grain text not null check (period_grain in ('quarter', 'ytd', 'year')),
  period text not null,
  metric text not null,
  metric_name text not null,          -- 회사가 쓴 이름 그대로(EBIT-adjusted · Adjusted operating income/(loss) …)
  basis text not null check (basis in ('reported', 'adjusted')),
  value numeric not null,
  unit text not null check (unit in ('million', 'billion', 'per_share')),
  currency text not null,
  quote text not null,
  document_id bigint references public.customer_documents (id) on delete set null,
  source text not null,
  source_ref text,
  published_at date not null,
  verified boolean not null default false,
  primary key (company_id, period_grain, period, metric)
);

create table public.customer_earnings_dates (
  company_id uuid not null references public.companies (id) on delete cascade,
  period text not null,               -- 발표 대상 2026-Q3 · 2026-FY
  event_date date not null,
  quote text not null,
  source text not null,
  source_ref text,
  url text,
  published_at date not null,
  primary key (company_id, period)
);

create table public.customer_collect_status (
  company_id uuid not null references public.companies (id) on delete cascade,
  collector text not null,            -- 'edgar_list' · 'dart_list' · 'ir_list' · 'parse' · 'llm'
  status text not null check (status in ('ok', 'no_new', 'blocked', 'parse_failed', 'error')),
  reason text,                        -- 화면에 그대로 나가는 사유 한 문장(키·내부 경로 금지)
  checked_at timestamptz not null default now(),
  primary key (company_id, collector)
);

alter table public.customer_documents enable row level security;
alter table public.customer_guidance enable row level security;
alter table public.customer_volume_ir enable row level security;
alter table public.customer_reported_results enable row level security;
alter table public.customer_earnings_dates enable row level security;
alter table public.customer_collect_status enable row level security;

-- 동일 값 upsert 는 0행(Architecture §7-J). collect_status 는 checked_at 이 매번 바뀌어 붙이지 않는다.
create trigger trg_skip_identical_update before update on public.customer_documents
  for each row execute function public.skip_identical_update();
create trigger trg_skip_identical_update before update on public.customer_volume_ir
  for each row execute function public.skip_identical_update();
create trigger trg_skip_identical_update before update on public.customer_reported_results
  for each row execute function public.skip_identical_update();
create trigger trg_skip_identical_update before update on public.customer_earnings_dates
  for each row execute function public.skip_identical_update();
create trigger trg_skip_identical_update before update on public.customer_guidance
  for each row execute function public.skip_identical_update();
