-- 고객사 공식 문서 요약 · 뉴스 주간 요약 (사외비) + 근거 쪽 캡처 비공개 Storage 버킷.
-- 요약은 API(LLM)로 만들고 코드 검사기를 통과해야 status='ok' 로 저장된다(검사 실패 행은 화면에 안 보인다).
-- RLS enable + 정책 없음(default deny): 서버는 confidentialDb(service_role)로만 접근. anon 직접 접근 불가.
-- trg_skip_identical_update 는 붙이지 않는다 — 요약기가 매번 updated_at 을 넣는다.

create table public.customer_doc_summaries (
  doc_id bigint primary key references public.customer_documents (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  status text not null check (status in ('ok', 'check_failed')),
  importance text check (importance in ('high', 'mid', 'low')),
  importance_reason text,
  lines jsonb not null default '[]'::jsonb,        -- ["한 줄", ...] 3~5개
  evidence jsonb not null default '[]'::jsonb,     -- [{"quote": "원문 인용", "page": 3|null}]
  pages jsonb not null default '[]'::jsonb,        -- [{"page": 7, "caption": "한 줄", "key": "<company_id>/<doc_id>/p7.png"}]
  c_materials jsonb not null default '[]'::jsonb,  -- [{"kind": "region"|"model"|"share", "page": 12|null, "note": "한 줄"}]
  check_note text,
  model text not null,
  prompt_version text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  source_sha text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customer_doc_summaries_company_idx on public.customer_doc_summaries (company_id);

create table public.customer_news_weekly (
  company_id uuid not null references public.companies (id) on delete cascade,
  week_start date not null,                        -- 그 주 월요일(KST)
  status text not null check (status in ('ok', 'check_failed', 'empty')),
  lines jsonb not null default '[]'::jsonb,
  links jsonb not null default '[]'::jsonb,        -- [{"news_id": 123, "title": "...", "url": "...", "source": "..."}]
  news_count int not null default 0,
  check_note text,
  model text not null,
  prompt_version text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, week_start)
);

comment on table public.customer_doc_summaries is
  '사외비 — confidentialDb 전용. 고객사 공식 문서별 한국어 3~5줄 요약·중요도·근거 쪽 캡처 키.';
comment on table public.customer_news_weekly is
  '사외비 — confidentialDb 전용. 고객사 회사별 주간 뉴스 요약(week_start = KST 월요일).';

alter table public.customer_doc_summaries enable row level security;
alter table public.customer_news_weekly enable row level security;
-- 정책 없음 = default deny. service_role 전용.

-- 비공개 Storage 버킷 (public=false). 정책 없음 → anon 차단, service_role만 접근.
insert into storage.buckets (id, name, public)
values ('customer-doc-pages', 'customer-doc-pages', false)
on conflict (id) do nothing;
