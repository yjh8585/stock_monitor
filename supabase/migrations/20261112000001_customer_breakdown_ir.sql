-- 고객사 IR 문서에서 뽑은 지역별·차종별·점유율 값 (사외비) + 문서 요약 행의 C 처리 완료 표식.
-- 계획 = docs/plans/2026-11-11-customers-page-revisions.md 「C」 절(결정 C1~C10).
-- 문서 단위로 저장한다 — 같은 값이 발표자료·보도자료·팩트시트에 겹쳐 나오므로 화면이 「가장 최근 공시의 검증 값」을 고른다.
-- 재처리는 그 문서 행을 지우고 다시 넣는다(라벨이 바뀐 옛 행이 남지 않게).
-- 「수준」 값만(대수·구성비·점유율·매출) — 증감률만 있는 항목은 싣지 않는다(결정 C7).
-- 화면은 verified=true 만(결정 C8 — quote_check 를 그 쪽 글자층에 · 그림 속 숫자는 소급 때 두 번째 읽기 일치).
-- RLS enable + 정책 없음(default deny): 서버는 confidentialDb(service_role)로만 접근.

create table public.customer_breakdown_ir (
  id bigserial primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  document_id bigint not null references public.customer_documents (id) on delete cascade,
  page int,                              -- PDF 쪽(1부터) · 비PDF 는 null
  kind text not null check (kind in ('region', 'model', 'share')),
  metric text not null,                  -- deliveries · sales · wholesale · shipments · retail · revenue · orders 등 원문 성격
  label_raw text not null,               -- 원문 구분 이름 그대로(결정 C3)
  label_ko text not null,                -- 한국어 이름
  period_grain text not null check (period_grain in ('month', 'quarter', 'half', 'ytd', 'year', 'asof')),
  period text not null,                  -- 2026-10 · 2026-Q3 · 2026-H1 · 2026-9M · 2026 · asof = YYYY-MM-DD
  value numeric not null,
  unit text not null check (unit in ('units', 'pct', 'share_pct', 'KRW', 'USD', 'EUR', 'VND')),
  definition text,                       -- 구분 정의(뜻 상자) — 예: 「중국 합작사 제외」
  quote text not null,
  extractor text not null check (extractor in ('code', 'llm', 'manual')),
  verified boolean not null default false,
  verify_note text,
  published_at date not null,
  unique (document_id, kind, metric, label_raw, period_grain, period)
);
create index customer_breakdown_ir_company_idx on public.customer_breakdown_ir (company_id, kind, period);

comment on table public.customer_breakdown_ir is
  '사외비 — confidentialDb 전용. 고객사 IR 문서의 지역별·차종별 판매·시장점유율(문서 단위 · 화면은 verified 만).';

alter table public.customer_breakdown_ir enable row level security;
-- 정책 없음 = default deny. service_role 전용.

-- 순수 데이터 표(updated_at 없음) — 같은 값 upsert 가 WAL·dead tuple 을 불리지 않게.
create trigger trg_skip_identical_update before update on public.customer_breakdown_ir
  for each row execute function public.skip_identical_update();

-- C 처리 완료 표식 — 읽었으나 수준 값이 0행인 문서도 다시 처리하지 않게(Codex 계획 대조 2026-11-12).
alter table public.customer_doc_summaries add column breakdown_at timestamptz;
