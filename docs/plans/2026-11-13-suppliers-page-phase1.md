# 협력사 페이지 1단계 Implementation Plan

> 🗑️ **폐기됨 (2026-11-16 사용자 지시)** — MarkLines 계정 정지로 협력사 작업 전체를 폐기했다(코드·표 삭제). 이 문서는 기록으로만 남긴다 · 경위 = `docs/oem-collection.md` 맨 끝 절.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MarkLines 서플라이어 DB 에서 「경쟁사에 납품하는 · 우리 품목을 만드는」 공급사를 모아 사외비 표에 싣고, `/oem/suppliers`(순위표)·`/oem/suppliers/[id]`(업체 상세)로 보여 준다.

**Architecture:** 로컬 수동 수집기(Python)가 MarkLines 검색·상세 JSON 을 받아 원자료만 사외비 표 5종에 upsert 한다. 점수는 저장하지 않고 서버 조회 계층(`lib/sourcing/source.ts`)이 순수 함수(`lib/sourcing/score.ts`)로 매번 계산한다. 제품·품목군·경쟁사·검색어는 코드가 아니라 사외비 표에만 있다(시드 JSON 은 gitignore 된 `참고/협력사/`).

**Tech Stack:** Next.js 16(App Router · `'use cache'`) · Supabase(`confidentialDb`) · vitest · Python 3 + requests + postgrest-py · pytest.

- 설계·결정 = [`2026-11-13-suppliers-page.md`](./2026-11-13-suppliers-page.md) · 결정 이행 = [`2026-11-13-suppliers-page_결정이행.md`](./2026-11-13-suppliers-page_결정이행.md)

## 계획서 점검 기록 (2026-11-13)

- 메인 자체 점검: `matchesAlias` 가 복수형(「Brass gizmos」)을 못 잡던 결함 · 수집기가 `fetched_at` 을 안 보내 재수집 때 갱신되지 않던 결함 → 고침.
- Codex 대조(계획서↔실제 코드 · 21건: 틀림 5 · 위험 5 · 확인됨 10 · 확인 실패 1) — 메인이 실물로 검산 후 **전부 반영**, 기각 0:
  DB 타입 재생성 단계 추가(Task 1) · 연결 upsert 를 실제 PostgREST 경로로 시험하고 「연결 전체 삭제」 대안 금지(Task 4) · 검색어 앞 3글자 출력 제거(Task 3) · 검색 결과 숨은 칸이 없으면 0건이 아니라 멈춤(Task 3) · 요청 간격을 재시도 안으로(Task 3) · 구조 문서를 각 커밋에 함께(전역) · 셸 명령은 Bash 도구로(전역) · 품목군 필터의 없는 id 처리·제품 전환 때 초기화(Task 8) · 협력사 하위 layout 권한 확인(Task 7) · 순위표 출처 칸(Task 8).
- 「확인 실패」 1건(새 표의 실제 HTTP upsert · OEM layout 변경 뒤 빌드)은 Task 4 Step 3 · Task 7 Step 5 에서 실행으로 확인한다.

## Global Constraints

- 🔴 레포가 공개다. 코드·시험·주석·커밋 메시지·stdout 에 **실제 경쟁사 이름·우리 품목 구성·검색어를 쓰지 않는다**(시험은 가짜 이름 `Acme`·`Globex`·`Initech`). 실제 값은 `참고/협력사/sourcing_seed.json`(gitignore)에만.
- 새 표 5종은 RLS enable + 정책 없음 · `lib/supabase/confidential.ts` `CONFIDENTIAL_TABLES` 등록 · 조회는 `confidentialDb` 만.
- 권한: admin·holdings·mobility 만(`canAccessSuppliers`). 화면·layout·page 가 각각 한 번 더 막는다(고객사 페이지와 같은 패턴).
- 캐시 태그 `sourcing` 하나 — `cacheTag` · `ALL_TAGS` · `COLUMN_TO_TAGS` 세 곳 함께. `cacheLife('days')`. `exchange_rates_live` 금지.
- MarkLines 쿠키는 `scripts/.env` 의 `MARKLINES_COOKIE`(9종)만 쓴다. `.env.local` 의 같은 이름은 껍데기(2종)다. 로그인 판정은 HTTP 200 이 아니라 상세 JSON 의 `profile` 존재로.
- MarkLines 요청 간격 1초 이상. 수집은 이 PC 수동 실행만(GHA 금지 — 결정 7).
- 지역 9탭 = 전체·한국·중국·일본·북미·인도·동남아·유럽·기타. 북미 = 미국·캐나다·멕시코. 지역은 점수에 안 넣는다(결정 5).
- 점수(결정 8): 경쟁사 1곳당 15(최대 45) · 품목 named 30 / category 20 / process 10 · IATF16949(또는 ISO/TS16949) 10 / ISO9001 만 5 · 규모 0~15.
- 1단계는 보기만 — 상태·메모 저장, mutating API 만들지 않는다(결정 11).
- 마이그레이션 파일명 `supabase/migrations/20261113000001_create_sourcing_tables.sql`(현재 최대 = `20261112000002`).
- Python 스크립트 첫머리 `sys.stdout.reconfigure(encoding="utf-8", errors="replace")` + `init_script(__file__)`. 변경 DB 쓰기는 `WriteSession`.
- 파일은 UTF-8(BOM 없음)+LF. `npm run dev`(pnpm 금지).
- 이 계획서의 셸 명령은 전부 **Bash 도구(Git Bash)** 로 실행한다(`&&`·`${PIPESTATUS[0]}` 를 쓴다 — PowerShell 5.1 에선 안 된다).
- 🔴 구조 문서는 **그 변경을 들이는 커밋에 함께** 넣는다(`.githooks/pre-commit` 이 새 `scripts/lib/*`·마이그레이션 커밋에 `AGENTS.md`/`Architecture.md` 가 없으면 막는다 · AGENTS 「갱신 트리거」). Task 10 으로 미루지 않는다.

## 파일 구조

| 파일                                                            | 책임                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------- |
| `supabase/migrations/20261113000001_create_sourcing_tables.sql` | 표 5종 · RLS · 트리거                                               |
| `scripts/lib/sourcing_parse.py` + `test_sourcing_parse.py`      | MarkLines 상세 JSON → 행 dict · 국가→지역 · 종업원 파싱(순수 함수)  |
| `scripts/lib/marklines_supplier_db.py`                          | MarkLines 서플라이어 DB HTTP(검색 id · 상세) · 로그인 판정          |
| `scripts/seed_sourcing.py`                                      | 시드 JSON → 제품·품목군·경쟁사 upsert(이름 없는 일반 스크립트)      |
| `scripts/probe_sourcing_queries.py`                             | 품목군·경쟁사 조합별 검색 건수만 세는 사전 점검(상세 안 받음)       |
| `scripts/collect_sourcing_suppliers.py`                         | 검색 → 상세 → `sourcing_suppliers`·`sourcing_supplier_links` upsert |
| `lib/sourcing/types.ts`                                         | 행 타입 · `REGIONS` · 점수 결과 타입                                |
| `lib/sourcing/score.ts` + `score.test.ts`                       | 경쟁사 적중·품목 일치·인증·규모·본인/계열 판정·총점(순수)           |
| `lib/sourcing/source.ts`                                        | `'use cache'` 조회 · 순위 계산 · 상세                               |
| `lib/auth/permissions.ts`(+test)                                | `canAccessSuppliers` · `canAccess` 분기                             |
| `components/oem/OemTabs.tsx`                                    | OEM 탭 줄(client) — layout 에서 옮김 + `showSuppliers` 인자         |
| `app/oem/layout.tsx`                                            | server 로 바꾸고 역할로 `showSuppliers` 결정                        |
| `components/oem/suppliers/SupplierFilters.tsx`                  | 제품·지역·품목군 링크 탭 + 지역별 건수                              |
| `components/oem/suppliers/SupplierRankingTable.tsx`             | 순위표(client · `useRowHighlight`)                                  |
| `app/oem/suppliers/page.tsx` · `[id]/page.tsx` · `loading.tsx`  | 목록 · 상세                                                         |

---

### Task 1: 사외비 표 5종 + 캐시 태그 배선

**Files:**

- Create: `supabase/migrations/20261113000001_create_sourcing_tables.sql`
- Modify: `lib/supabase/confidential.ts`(머리 주석 목록 + `CONFIDENTIAL_TABLES`)
- Modify: `app/api/revalidate/route.ts`(`ALL_TAGS` 에 `'sourcing'`)
- Modify: `scripts/lib/revalidate.py`(`COLUMN_TO_TAGS` 에 5개 표 → `['sourcing']`)
- Modify: `Architecture.md` §7-G 사외비 표 명단 · §7 표 설명

**Interfaces:**

- Produces: 표 `sourcing_products(id bigint, slug, name_ko, display_order)` · `sourcing_part_groups(id, product_id, slug, name_ko, display_order, bom_parts text[], ml_part_names text[], ml_processes text[], keywords text[])` · `sourcing_competitors(id, product_id, name, aliases text[])` · `sourcing_suppliers(...)` · `sourcing_supplier_links(supplier_id, part_group_id, competitor_id, found_at)` · 캐시 태그 `'sourcing'`.

- [ ] **Step 1: 마이그레이션 작성**

```sql
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
```

- [ ] **Step 2: 트리거 전제 확인** — 함수 `public.skip_identical_update()` 는 `20260803000002_skip_identical_updates.sql` 에 있다(2026-11-13 확인). `found_at` 이 매번 바뀌면 트리거가 무의미하므로, 수집기는 upsert 시 `found_at` 을 보내지 않는다(Task 4 의 links 행에 `found_at` 키가 없는지 확인).

- [ ] **Step 3: 적용** — Supabase MCP `apply_migration`(name `create_sourcing_tables`, 위 SQL). 그다음 `list_tables` 로 5개 확인 + `execute_sql`: `select relname, relrowsecurity from pg_class where relname like 'sourcing_%' and relkind='r';`
      Expected: 5행 모두 `relrowsecurity = true`. `select count(*) from pg_policies where tablename like 'sourcing_%';` → 0.

- [ ] **Step 4: 사외비 명단·캐시 태그 세 곳**

`lib/supabase/confidential.ts` 의 `CONFIDENTIAL_TABLES` 끝에 5개 추가하고 머리 주석에 한 줄:

```ts
 * - sourcing_products · sourcing_part_groups · sourcing_competitors · sourcing_suppliers ·
 *   sourcing_supplier_links: 협력사(소싱 후보) 페이지 (migration 20261113000001)
```

`app/api/revalidate/route.ts` `ALL_TAGS` 에 `'sourcing',` · `scripts/lib/revalidate.py` `COLUMN_TO_TAGS` 에:

```python
    'sourcing_products': ['sourcing'],
    'sourcing_part_groups': ['sourcing'],
    'sourcing_competitors': ['sourcing'],
    'sourcing_suppliers': ['sourcing'],
    'sourcing_supplier_links': ['sourcing'],
```

- [ ] **Step 4-1: DB 타입 재생성** — `lib/supabase/confidential.ts` 의 `ConfidentialTable` 은 `keyof Database['public']['Tables']` 와 교차하므로, 타입을 안 고치면 Task 6 의 `.from('sourcing_…')` 가 타입 오류다. Supabase MCP `generate_typescript_types` 로 `lib/database.types.ts` 를 갱신하되 🔴 **손으로 붙인 `TableRow`·`ViewRow` 등 헬퍼를 덮지 않는다** — 먼저 `docs/gotchas-ci-deploy.md` §7 을 읽고 그 절차대로(생성 결과의 `sourcing_*` 5개 표 블록만 기존 파일의 `Tables` 안에 끼워 넣는 방식이면 그렇게). `npm run typecheck` → 0 errors.

- [ ] **Step 5: 검사** — `scripts/venv/Scripts/python.exe scripts/verify_revalidate_tags.py`
      Expected: exit 0(Codex 대조 2026-11-13 — `sourcing` 이 아직 TS 에서 안 쓰여 「미사용」 경고만 나고 실패 조건은 아니다). Task 6 뒤 그 경고가 사라지는지 다시 본다.

- [ ] **Step 6: 커밋** — `git add <위 파일 경로들 + lib/database.types.ts + Architecture.md> && git commit --only -F <메시지 파일> -- <같은 경로들>` · 메시지 `feat(협력사): 사외비 표 5종·캐시 태그 sourcing`.

---

### Task 2: MarkLines 상세 파서(순수 함수) + 시험

**Files:**

- Create: `scripts/lib/sourcing_parse.py`
- Test: `scripts/lib/test_sourcing_parse.py`
- Modify: `Architecture.md` 부록 C 모듈 목록(`sourcing_parse.py` 한 줄 — 이 Task 의 커밋에 함께)

**Interfaces:**

- Produces: `region_of(country: str | None) -> str` · `parse_employees(text: str | None) -> int | None` · `parse_detail(detail: dict, rand_code: str) -> dict`(키 = `sourcing_suppliers` 칸 이름, `source='marklines'`) · `UNKNOWN_COUNTRIES: set[str]`(region_of 가 「기타」로 떨군 국가 — 수집기가 마지막에 출력).

- [ ] **Step 1: 실패하는 시험**

```python
"""sourcing_parse 순수 함수 시험 — 실제 경쟁사·품목 이름을 쓰지 않는다(공개 레포)."""
from lib.sourcing_parse import parse_detail, parse_employees, region_of, UNKNOWN_COUNTRIES

DETAIL = {
  'profile': {
    'id': 4242,
    'supplier_rand_code': '000000000000777',
    'i18n_suppliers': [{
      'name': 'Acme Widgets Co., Ltd.',
      'establish': '1971',
      'sales': 'THB 42 million (FY ended Jun. 30, 2024)',
      'employee': '1,234 employees (As of Jun. 30, 2024)',
      'address': '42 Example Street, Exampleville, Thailand',
      'homepage': 'https://acme.example',
      'i18n_supplier_remarks': [{'remark': '-Hooli Group company'}],
    }],
    'mst_nation': {'name': 'Thailand'},
    'quality_assurances': [{'name': 'IATF16949'}, {'name': 'ISO9001'}],
  },
  'products': {
    'Engine parts': [{'s_name': 'Widget'}],
    'Process type (example)': [{'s_name': 'Die casting'}],
  },
  'parts_comments': {'en': [{'parts': 'Widget housings'}]},
  'delivers': {
    'oem': [{'name': 'Initech Motors'}],
    'supplier': [{'name': 'Globex'}, {'name': 'Globex Widgets Asia'}],
  },
}


def test_region_of():
  assert region_of('Thailand') == '동남아'
  assert region_of('Mexico') == '북미'
  assert region_of('Korea') == '한국'
  assert region_of('Germany') == '유럽'
  assert region_of('India') == '인도'
  assert region_of('Japan') == '일본'
  assert region_of('China') == '중국'
  assert region_of(None) == '기타'


def test_region_of_unknown_is_recorded():
  UNKNOWN_COUNTRIES.clear()
  assert region_of('Atlantis') == '기타'
  assert 'Atlantis' in UNKNOWN_COUNTRIES


def test_parse_employees():
  assert parse_employees('1,234 employees (As of Jun. 30, 2024)') == 1234
  assert parse_employees('Approx. 120') == 120
  assert parse_employees(None) is None
  assert parse_employees('N/A') is None


def test_parse_detail():
  row = parse_detail(DETAIL, '000000000000777')
  assert row['ml_supplier_id'] == 4242
  assert row['ml_rand_code'] == '000000000000777'
  assert row['name'] == 'Acme Widgets Co., Ltd.'
  assert row['country'] == 'Thailand' and row['region'] == '동남아'
  assert row['employees'] == 1234
  assert row['certifications'] == ['IATF16949', 'ISO9001']
  assert row['product_categories'] == ['Widget']
  assert row['processes'] == ['Die casting']
  assert row['parts_comments'] == ['Widget housings']
  assert row['delivers_oem'] == ['Initech Motors']
  assert row['delivers_supplier'] == ['Globex', 'Globex Widgets Asia']
  assert row['remarks'] == ['-Hooli Group company']
  assert row['source'] == 'marklines'
  assert row['source_url'] == 'https://www.marklines.com/en/supplier_db/000000000000777/'
  assert 'fetched_at' not in row
```

- [ ] **Step 2: 실패 확인** — `scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_sourcing_parse.py -q` → `ModuleNotFoundError`.

- [ ] **Step 3: 구현**

```python
"""MarkLines 서플라이어 DB 상세 JSON → sourcing_suppliers 행 (순수 함수).

계획 = docs/plans/2026-11-13-suppliers-page-phase1.md Task 2.
상세 JSON 구조는 2026-11-13 실측(GET /en/supplier_db/{rand_code}/?is_modal=true).
"""
from __future__ import annotations

import re

# 공정 분류는 products 의 이 키 아래 들어 있다(실측). 나머지 키는 부품 분류.
PROCESS_KEY_PREFIX = 'Process type'

# 국가(MarkLines mst_nation.name) → 지역 9탭. 지역 구분은 지리라 공개 무방.
REGION_BY_COUNTRY: dict[str, str] = {
  **{c: '한국' for c in ('Korea', 'South Korea', 'Republic of Korea')},
  **{c: '중국' for c in ('China', 'Hong Kong')},
  'Japan': '일본',
  **{c: '북미' for c in ('USA', 'U.S.A.', 'United States', 'Canada', 'Mexico')},
  'India': '인도',
  **{c: '동남아' for c in ('Thailand', 'Indonesia', 'Malaysia', 'Vietnam', 'Philippines',
                         'Singapore', 'Myanmar', 'Cambodia', 'Laos')},
  **{c: '유럽' for c in ('Germany', 'France', 'Italy', 'Spain', 'United Kingdom', 'UK', 'Portugal',
                        'Czech Republic', 'Czechia', 'Poland', 'Hungary', 'Slovakia', 'Slovenia',
                        'Romania', 'Bulgaria', 'Serbia', 'Austria', 'Switzerland', 'Belgium',
                        'Netherlands', 'Sweden', 'Finland', 'Denmark', 'Norway', 'Ireland',
                        'Turkey', 'Türkiye')},
}

# region_of 가 모르는 국가를 모은다 — 수집기가 끝에 출력해 표를 보강한다.
UNKNOWN_COUNTRIES: set[str] = set()


def region_of(country: str | None) -> str:
  if not country:
    return '기타'
  region = REGION_BY_COUNTRY.get(country.strip())
  if region is None:
    UNKNOWN_COUNTRIES.add(country.strip())
    return '기타'
  return region


def parse_employees(text: str | None) -> int | None:
  if not text:
    return None
  m = re.search(r'\d[\d,]*', text)
  return int(m.group(0).replace(',', '')) if m else None


def _names(items: list[dict] | None, key: str) -> list[str]:
  return [str(x[key]).strip() for x in (items or []) if x.get(key)]


def parse_detail(detail: dict, rand_code: str) -> dict:
  profile = detail['profile']
  i18n = (profile.get('i18n_suppliers') or [{}])[0]
  country = (profile.get('mst_nation') or {}).get('name')
  products = detail.get('products') or {}
  categories: list[str] = []
  processes: list[str] = []
  for key, items in products.items():
    (processes if key.startswith(PROCESS_KEY_PREFIX) else categories).extend(_names(items, 's_name'))
  comments = (detail.get('parts_comments') or {}).get('en') or []
  delivers = detail.get('delivers') or {}
  return {
    'source': 'marklines',
    'ml_supplier_id': int(profile['id']),
    'ml_rand_code': rand_code,
    'name': (i18n.get('name') or '').strip(),
    'country': country,
    'region': region_of(country),
    'location': None,
    'address': i18n.get('address'),
    'homepage': i18n.get('homepage'),
    'established': i18n.get('establish'),
    'sales_text': i18n.get('sales'),
    'employees': parse_employees(i18n.get('employee')),
    'certifications': _names(profile.get('quality_assurances'), 'name'),
    'product_categories': categories,
    'processes': processes,
    'parts_comments': _names(comments, 'parts'),
    'delivers_oem': _names(delivers.get('oem'), 'name'),
    'delivers_supplier': _names(delivers.get('supplier'), 'name'),
    'remarks': _names(i18n.get('i18n_supplier_remarks'), 'remark'),
    'source_url': f'https://www.marklines.com/en/supplier_db/{rand_code}/',
  }
```

- [ ] **Step 4: 통과 확인** — 같은 명령 → `4 passed`.
- [ ] **Step 5: 커밋** — 파서·시험·`Architecture.md` 함께 · `feat(협력사): MarkLines 서플라이어 상세 파서`.

---

### Task 3: MarkLines HTTP 모듈 + 시드 + 검색 건수 사전 점검 + 🔴 사용자 확인 게이트

**Files:**

- Create: `scripts/lib/marklines_supplier_db.py` · `scripts/seed_sourcing.py` · `scripts/probe_sourcing_queries.py`
- Create(gitignore): `참고/협력사/sourcing_seed.json` · `참고/협력사/품목군_대응표.md`

**Interfaces:**

- Produces: `class SupplierDb`(`__init__(cookie: str)` · `search(**params) -> tuple[list[int], list[str]]`(supplier_ids, rand_codes 같은 순서) · `detail(rand_code: str) -> dict`(로그인 아니면 `NotLoggedIn` raise)) · `load_cookie() -> str`(`scripts/.env` 에서만).
- Seed JSON 형식:

```json
{
  "products": [
    {
      "slug": "product-a",
      "name_ko": "제품A",
      "display_order": 1,
      "part_groups": [
        {
          "slug": "group-1",
          "name_ko": "품목군1",
          "display_order": 1,
          "bom_parts": ["..."],
          "ml_part_names": ["..."],
          "ml_processes": ["..."],
          "keywords": ["..."]
        }
      ],
      "competitors": [{ "name": "...", "aliases": ["..."] }]
    }
  ]
}
```

- [ ] **Step 1: `marklines_supplier_db.py` 작성**

```python
"""MarkLines 서플라이어 DB HTTP — 검색 id · 상세 JSON (2026-11-13 실측 경로).

🔴 쿠키는 scripts/.env 의 MARKLINES_COOKIE 만 쓴다. .env.local 의 같은 이름은 GA 쿠키뿐인 껍데기라
   유료 벽이 HTTP 200 으로 온다(docs/oem-collection.md 「쿠키가 «두 곳»에 있다」).
🔴 로그인 판정은 상세 JSON 의 profile 존재로 한다(200 은 아무것도 보장하지 않는다).
"""
from __future__ import annotations

import html
import json
import pathlib
import re
import time

import requests
from dotenv import dotenv_values

from lib.retry import with_retry  # with_retry(fn, *args, _attempts=3, _backoff=2.0, _label='', **kwargs) — 일시적 오류만 재시도

BASE = 'https://www.marklines.com/en/supplier_db'
MIN_INTERVAL_SEC = 1.0


class NotLoggedIn(RuntimeError):
  pass


def load_cookie() -> str:
  env = pathlib.Path(__file__).resolve().parents[1] / '.env'
  cookie = dotenv_values(env).get('MARKLINES_COOKIE')
  if not cookie or 'PLATFORM_SESSION' not in cookie:
    raise NotLoggedIn('scripts/.env 의 MARKLINES_COOKIE 에 세션 쿠키가 없다')
  return cookie


class SupplierDb:
  def __init__(self, cookie: str):
    self._s = requests.Session()
    self._s.headers.update({'Cookie': cookie, 'User-Agent': 'Mozilla/5.0',
                            'X-Requested-With': 'XMLHttpRequest'})
    self._last = 0.0

  def _get(self, url: str, params: dict) -> requests.Response:
    def call() -> requests.Response:
      # 간격은 실제 HTTP 호출마다 — 재시도 요청도 1초 간격을 지킨다(Codex 대조 2026-11-13).
      wait = MIN_INTERVAL_SEC - (time.monotonic() - self._last)
      if wait > 0:
        time.sleep(wait)
      self._last = time.monotonic()
      resp = self._s.get(url, params=params, timeout=60)
      # 4xx 는 즉시 raise — 단 429 는 retry.py 가 일시적 오류로 보고 재시도한다(retry.py:24).
      resp.raise_for_status()
      return resp
    return with_retry(call, _label='marklines supplier_db')

  def search(self, **params) -> tuple[list[int], list[str]]:
    """결과 HTML 숨은 칸에서 id 목록을 읽는다.

    정상 0건이면 칸은 있고 값이 `[]` 다(2026-11-13 실측 — 납품처 검색 0건 사례).
    🔴 칸 자체가 없으면 로그인 풀림·화면 구조 변경이다 — 0건으로 삼키지 않고 멈춘다.
    """
    text = self._get(f'{BASE}/result', params).text
    ids = re.search(r'id="supplier_ids"[^>]*value="([^"]*)"', text)
    codes = re.search(r'id="suppliers_code_list"[^>]*value="([^"]*)"', text)
    if not ids or not codes:
      raise NotLoggedIn('검색 결과에 supplier_ids 칸이 없다(로그인 풀림 또는 화면 구조 변경)')
    return json.loads(html.unescape(ids.group(1))), json.loads(html.unescape(codes.group(1)))

  def detail(self, rand_code: str) -> dict:
    r = self._get(f'{BASE}/{rand_code}/', {'is_modal': 'true', 'index': 1, 'count': 1})
    try:
      data = r.json()
    except ValueError as e:
      raise NotLoggedIn(f'상세가 JSON 이 아니다(유료 벽 의심): {rand_code}') from e
    if not data.get('profile'):
      raise NotLoggedIn(f'상세에 profile 이 없다: {rand_code}')
    return data
```

- [ ] **Step 2: 0건 표본 확인** — 결과가 0건인 검색 하나(설계서 실측의 「국내 경쟁사 납품처 0곳」 조합)를 `search()` 로 불러 `([], [])` 가 나오는지(예외가 아닌지) 본다. 예외가 나면 0건 페이지의 형태를 실측해 `search()` 를 고치고 이 Step 에 기록.

- [ ] **Step 3: 품목군 대응표 초안** — PPT 추출본(세션 scratchpad `pptx_out.txt` · 원본 PPT 5개)으로 하프샤프트·얼터네이터 품목군을 묶고, 각 군의 `ml_part_names` 후보를 `get_part_name_suggest`(`GET {BASE}/get_part_name_suggest?search_part_name=<단어>`)로 실제 존재하는 이름만 고른다. 결과를 `참고/협력사/품목군_대응표.md`(사람용 표)와 `참고/협력사/sourcing_seed.json`(위 형식)으로 쓴다. 경쟁사 별칭은 `search(companyName=…, com_isPartial='true')` 로 MarkLines 표기를 확인해 넣는다.

- [ ] **Step 4: `probe_sourcing_queries.py`** — 시드 JSON 을 읽어 (품목군 × 경쟁사 별칭) 조합 검색과 품목군 단독 검색의 **건수만** 출력한다(상세 안 받음). stdout 은 `group-1 × competitor#2: 14` 처럼 slug·번호만 — 이름 금지.

```python
"""품목군·경쟁사 조합별 MarkLines 검색 건수 사전 점검 (상세는 받지 않는다).

사용: scripts/venv/Scripts/python.exe scripts/probe_sourcing_queries.py --seed 참고/협력사/sourcing_seed.json
"""
import argparse
import json
import sys


def main() -> int:
  sys.stdout.reconfigure(encoding='utf-8', errors='replace')
  from lib.bootstrap import init_script
  init_script(__file__)
  from lib.marklines_supplier_db import SupplierDb, load_cookie

  ap = argparse.ArgumentParser()
  ap.add_argument('--seed', required=True)
  args = ap.parse_args()
  seed = json.load(open(args.seed, encoding='utf-8'))
  db = SupplierDb(load_cookie())
  union: set[int] = set()
  for p in seed['products']:
    for g in p['part_groups']:
      for pi, part in enumerate(g['ml_part_names']):
        ids, _ = db.search(partsName=part, parts_isPartial='false')
        print(f"{p['slug']}/{g['slug']} 단독 part#{pi}: {len(ids)}")
        for ci, c in enumerate(p['competitors']):
          for alias in c['aliases']:
            cids, _ = db.search(partsName=part, parts_isPartial='false',
                                opt_delName=alias, del_isPartial='true')
            union.update(cids)
            print(f"  × competitor#{ci}: {len(cids)}")
  print(f'경쟁사 조합 합집합: {len(union)}')
  return 0


if __name__ == '__main__':
  sys.exit(main())
```

- [ ] **Step 5: `seed_sourcing.py`** — 시드 JSON → `sourcing_products`(conflict `slug`) → `sourcing_part_groups`(conflict `product_id,slug`) → `sourcing_competitors`(conflict `product_id,name`) upsert. `WriteSession` 사용. `--dry-run` 이면 건수만 출력. stdout 은 건수만.

```python
"""협력사 페이지 시드 — 제품·품목군·경쟁사를 사외비 표에 upsert (이름은 JSON 에만 · 공개 레포).

사용: scripts/venv/Scripts/python.exe scripts/seed_sourcing.py --seed 참고/협력사/sourcing_seed.json [--dry-run]
"""
import argparse
import json
import sys


def main() -> int:
  sys.stdout.reconfigure(encoding='utf-8', errors='replace')
  from lib.bootstrap import init_script
  init_script(__file__)
  from lib.db import WriteSession

  ap = argparse.ArgumentParser()
  ap.add_argument('--seed', required=True)
  ap.add_argument('--dry-run', action='store_true')
  args = ap.parse_args()
  seed = json.load(open(args.seed, encoding='utf-8'))
  n_p = len(seed['products'])
  n_g = sum(len(p['part_groups']) for p in seed['products'])
  n_c = sum(len(p['competitors']) for p in seed['products'])
  print(f'제품 {n_p} · 품목군 {n_g} · 경쟁사 {n_c}')
  if args.dry_run:
    return 0
  with WriteSession() as ws:
    for p in seed['products']:
      prod = ws.table('sourcing_products').upsert(
        {'slug': p['slug'], 'name_ko': p['name_ko'], 'display_order': p['display_order']},
        on_conflict='slug').execute().data[0]
      for g in p['part_groups']:
        ws.table('sourcing_part_groups').upsert(
          {**{k: g[k] for k in ('slug', 'name_ko', 'display_order', 'bom_parts',
                                 'ml_part_names', 'ml_processes', 'keywords')},
           'product_id': prod['id']}, on_conflict='product_id,slug').execute()
      for c in p['competitors']:
        ws.table('sourcing_competitors').upsert(
          {'product_id': prod['id'], 'name': c['name'], 'aliases': c['aliases']},
          on_conflict='product_id,name').execute()
  print('시드 완료')
  return 0


if __name__ == '__main__':
  sys.exit(main())
```

- [ ] **Step 6: 🔴 사용자 확인 게이트(코드 진행 멈춤)** — `참고/협력사/품목군_대응표.md` 와 Step 4 건수(경쟁사 조합 합집합 · 단독 검색 건수)를 사용자에게 보여 주고 AskUserQuestion 으로 묻는다: (가) 대응표가 맞는가 (나) 단독 검색(경쟁사 무관 후보)을 어디까지 받을지 — 합집합 + 단독이 3,000곳을 넘으면 상세 수집이 1시간 이상 걸리므로 「단독 검색은 건수가 N 이하인 품목군만」 같은 상한을 사용자가 고른다. 답을 `_최초지시.md` 에 원문으로 남긴다.

- [ ] **Step 7: 시드 적재** — `--dry-run` 으로 건수 확인 → 본 실행 → `execute_sql`: `select count(*) from sourcing_part_groups;` 가 시드 품목군 수와 같은지.

- [ ] **Step 8: 커밋** — 스크립트 3개 + `Architecture.md`(부록 C 에 `marklines_supplier_db.py` 한 줄 · 부록 B-3 정기 재실행 목록에 `seed_sourcing.py` — 시드 갱신 때 다시 쓰므로 `_archive/` 로 옮기지 않는다). `참고/` 는 gitignore. 커밋 전 `git diff --cached` 에 실제 경쟁사 이름이 없는지 Grep 으로 확인. 메시지 `feat(협력사): MarkLines 서플라이어 DB 모듈·시드·검색 사전 점검`.

---

### Task 4: 수집기 `collect_sourcing_suppliers.py` + 실제 수집

**Files:**

- Create: `scripts/collect_sourcing_suppliers.py`

**Interfaces:**

- Consumes: `SupplierDb` · `load_cookie` · `NotLoggedIn`(Task 3) · `parse_detail` · `UNKNOWN_COUNTRIES`(Task 2) · 사외비 표(Task 1).
- Produces: `sourcing_suppliers`(conflict `ml_supplier_id`) · `sourcing_supplier_links`(conflict `supplier_id,part_group_id,competitor_id`).

- [ ] **Step 1: 작성**

```python
"""협력사 후보 수집 — MarkLines 서플라이어 DB 검색 → 상세 → 사외비 표 (로컬 수동 실행 전용 · 결정 7).

순서: 사외비 표에서 품목군·경쟁사를 읽는다 → (품목군 × 경쟁사 별칭) 조합 검색 + 품목군 단독 검색 →
      모은 업체 상세를 1초 간격으로 받는다 → suppliers upsert → links upsert.
🔴 stdout 에 경쟁사·품목 이름을 찍지 않는다(id·건수만). 점수는 저장하지 않는다(결정 9).

사용: scripts/venv/Scripts/python.exe scripts/collect_sourcing_suppliers.py [--dry-run] [--max-details 3000]
      [--solo-max-hits N]   # 단독 검색 결과가 N 곳 넘는 품목군은 단독 검색을 건너뛴다(Task 3 Step 6 에서 사용자가 고른 값)
"""
import argparse
import sys
from collections import Counter
from datetime import datetime, timezone


def main() -> int:
  sys.stdout.reconfigure(encoding='utf-8', errors='replace')
  from lib.bootstrap import init_script
  init_script(__file__)
  from lib.db import WriteSession, get_client
  from lib.marklines_supplier_db import NotLoggedIn, SupplierDb, load_cookie
  from lib.sourcing_parse import UNKNOWN_COUNTRIES, parse_detail

  ap = argparse.ArgumentParser()
  ap.add_argument('--dry-run', action='store_true')
  ap.add_argument('--max-details', type=int, default=3000)
  ap.add_argument('--solo-max-hits', type=int, default=0, help='0 = 단독 검색 안 함')
  args = ap.parse_args()

  c = get_client()
  groups = c.table('sourcing_part_groups').select('id,product_id,ml_part_names').order('id').execute().data
  comps = c.table('sourcing_competitors').select('id,product_id,aliases').order('id').execute().data

  db = SupplierDb(load_cookie())
  # (rand_code) → [(part_group_id, competitor_id | None)]
  hits: dict[str, list[tuple[int, int | None]]] = {}
  for g in groups:
    for part in g['ml_part_names']:
      for comp in (x for x in comps if x['product_id'] == g['product_id']):
        for alias in comp['aliases']:
          _, codes = db.search(partsName=part, parts_isPartial='false',
                               opt_delName=alias, del_isPartial='true')
          for code in codes:
            hits.setdefault(code, []).append((g['id'], comp['id']))
      if args.solo_max_hits > 0:
        _, codes = db.search(partsName=part, parts_isPartial='false')
        if len(codes) <= args.solo_max_hits:
          for code in codes:
            hits.setdefault(code, []).append((g['id'], None))
        else:
          print(f'group#{g["id"]} 단독 검색 {len(codes)}곳 > 상한 — 건너뜀')
  print(f'상세 받을 업체: {len(hits)}')
  if len(hits) > args.max_details:
    print(f'🔴 {len(hits)} > --max-details {args.max_details} — 멈춘다(사용자에게 상한을 묻는다)')
    return 2
  if args.dry_run:
    return 0

  # 기본값 now() 는 INSERT 때만 들어간다 — 다시 받은 업체도 받은 시각이 갱신되게 명시한다.
  fetched_at = datetime.now(timezone.utc).isoformat()
  rows, failed = [], 0
  for i, code in enumerate(hits, 1):
    try:
      rows.append({**parse_detail(db.detail(code), code), 'fetched_at': fetched_at})
    except NotLoggedIn:
      raise  # 로그인이 풀리면 전체를 멈춘다 — 빈 값으로 덮지 않는다.
    except Exception as e:  # 한 업체 실패는 건너뛴다(외부 입력 경계).
      failed += 1
      print(f'상세 실패 #{i}: {type(e).__name__}')
    if i % 100 == 0:
      print(f'  {i}/{len(hits)}')

  with WriteSession() as ws:
    id_by_code: dict[str, int] = {}
    for start in range(0, len(rows), 500):
      saved = ws.table('sourcing_suppliers').upsert(
        rows[start:start + 500], on_conflict='ml_supplier_id').execute().data
      id_by_code.update({r['ml_rand_code']: r['id'] for r in saved})
    links = [{'supplier_id': id_by_code[code], 'part_group_id': gid, 'competitor_id': cid}
             for code, pairs in hits.items() if code in id_by_code
             for gid, cid in set(pairs)]
    for start in range(0, len(links), 500):
      ws.table('sourcing_supplier_links').upsert(
        links[start:start + 500], on_conflict='supplier_id,part_group_id,competitor_id').execute()

  print(f'업체 {len(rows)} · 실패 {failed} · 연결 {len(links)}')
  print('지역별:', dict(Counter(r['region'] for r in rows)))
  if UNKNOWN_COUNTRIES:
    print('지역표에 없는 국가(기타로 분류):', sorted(UNKNOWN_COUNTRIES))
  return 0


if __name__ == '__main__':
  sys.exit(main())
```

- [ ] **Step 2: `--dry-run`** — Task 3 Step 6 에서 고른 `--solo-max-hits` 로 실행. Expected: 「상세 받을 업체: N」 · exit 0(N ≤ 상한).
- [ ] **Step 3: 실제 PostgREST 경로로 `nulls not distinct` 확인** — SQL 이 아니라 수집기와 **같은 호출**(`ws.table('sourcing_supplier_links').upsert(rows, on_conflict='supplier_id,part_group_id,competitor_id')`)로, 시험용 공급사 1곳(`source='web'`, 이름 `zz-test`)에 연결 3행(경쟁사 null 1행 포함)을 **두 번** 보내는 일회성 스크립트를 scratchpad 에 만들어 돌린다. Expected: 두 번째도 오류 없음 · 행 수 3 유지. 끝나면 시험 공급사를 지운다(연결은 cascade). 레포 선례: `20260428000008_financials_nulls_not_distinct.sql`·`20260520000004_drop_duplicate_financials_unique.sql` 주석(「on_conflict 는 컬럼 리스트 매칭이라 자동 선택」). 실패하면 멈추고 사용자에게 보고한다 — 🔴 「공급사의 연결 전체 삭제 후 insert」로 바꾸면 다른 제품·품목군 연결까지 지우므로 그 대안은 쓰지 않는다.
- [ ] **Step 4: 본 실행** — `run_in_background`. 끝나면 출력의 「지역별」·「지역표에 없는 국가」를 기록한다. 없는 국가가 있으면 `REGION_BY_COUNTRY` 에 넣고 Task 2 시험을 다시 돌린 뒤 수집기를 한 번 더 실행(상세는 다시 받는다 — 지역 칸만 고치는 별도 경로를 만들지 않는다).
- [ ] **Step 5: DB 검증** — `execute_sql`: `select region, count(*) from sourcing_suppliers group by 1 order by 2 desc;` · `select count(*) from sourcing_supplier_links;` · `select count(*) from sourcing_suppliers where name = '' or employees < 0;` → 0.
- [ ] **Step 6: 커밋** — `feat(협력사): MarkLines 협력사 후보 수집기`.

---

### Task 5: 점수 계산 순수 함수 + 시험

**Files:**

- Create: `lib/sourcing/types.ts` · `lib/sourcing/score.ts` · `lib/sourcing/score.test.ts`

**Interfaces:**

- Produces(`types.ts`):

```ts
export const REGIONS = ['한국', '중국', '일본', '북미', '인도', '동남아', '유럽', '기타'] as const;
export type Region = (typeof REGIONS)[number];
export type MatchLevel = 'named' | 'category' | 'process' | 'none';

export interface PartGroupRow {
  id: number;
  product_id: number;
  slug: string;
  name_ko: string;
  display_order: number;
  bom_parts: string[];
  ml_part_names: string[];
  ml_processes: string[];
  keywords: string[];
}
export interface CompetitorRow {
  id: number;
  product_id: number;
  name: string;
  aliases: string[];
}
export interface SupplierRow {
  id: number;
  source: 'marklines' | 'web';
  name: string;
  country: string | null;
  region: Region;
  address: string | null;
  homepage: string | null;
  established: string | null;
  sales_text: string | null;
  employees: number | null;
  certifications: string[];
  product_categories: string[];
  processes: string[];
  parts_comments: string[];
  delivers_oem: string[];
  delivers_supplier: string[];
  remarks: string[];
  source_url: string | null;
  fetched_at: string;
}
export interface ScoreBreakdown {
  competitorIds: number[];
  competitorPoints: number;
  groupLevels: Record<number, MatchLevel>; // part_group_id → 단계
  bestLevel: MatchLevel;
  matchPoints: number;
  certPoints: number;
  sizePoints: number;
  total: number;
}
```

- Produces(`score.ts`): `matchesAlias(text: string, alias: string): boolean` · `competitorHits(s: SupplierRow, comps: CompetitorRow[]): number[]` · `matchLevel(s: SupplierRow, g: PartGroupRow): MatchLevel` · `certPoints(certs: string[]): number` · `sizePoints(employees: number | null): number` · `isCompetitorSelf(s: SupplierRow, comps: CompetitorRow[]): boolean` · `affiliateHint(s: SupplierRow, comps: CompetitorRow[]): number[]` · `scoreSupplier(s: SupplierRow, groups: PartGroupRow[], comps: CompetitorRow[]): ScoreBreakdown` · 상수 `SCORE_WEIGHTS`.

- [ ] **Step 1: 실패하는 시험**

```ts
import { describe, expect, it } from 'vitest';
import {
  affiliateHint,
  certPoints,
  competitorHits,
  isCompetitorSelf,
  matchesAlias,
  matchLevel,
  scoreSupplier,
  sizePoints,
} from './score';
import type { CompetitorRow, PartGroupRow, SupplierRow } from './types';

// 공개 레포 — 실제 경쟁사·품목 이름 대신 가짜 이름.
const comps: CompetitorRow[] = [
  { id: 1, product_id: 1, name: 'Globex', aliases: ['Globex'] },
  { id: 2, product_id: 1, name: 'Initech', aliases: ['Initech'] },
  { id: 3, product_id: 1, name: 'Umbrella', aliases: ['Umbrella'] },
  { id: 4, product_id: 1, name: 'Hooli', aliases: ['Hooli'] },
];
const group: PartGroupRow = {
  id: 10,
  product_id: 1,
  slug: 'g',
  name_ko: '품목군',
  display_order: 1,
  bom_parts: [],
  ml_part_names: ['Widget joint'],
  ml_processes: ['Die casting'],
  keywords: ['gizmo'],
};
const base: SupplierRow = {
  id: 7,
  source: 'marklines',
  name: 'Acme Widgets',
  country: 'Thailand',
  region: '동남아',
  address: null,
  homepage: null,
  established: null,
  sales_text: null,
  employees: null,
  certifications: [],
  product_categories: [],
  processes: [],
  parts_comments: [],
  delivers_oem: [],
  delivers_supplier: [],
  remarks: [],
  source_url: null,
  fetched_at: '2026-11-13T00:00:00Z',
};

describe('matchesAlias', () => {
  it('단어 경계로 대소문자 무시', () => {
    expect(matchesAlias('Globex Driveline Thailand', 'globex')).toBe(true);
    expect(matchesAlias('Globexx Ltd', 'Globex')).toBe(false);
  });
  it('복수형은 잡고 다른 단어로 이어지면 안 잡는다', () => {
    expect(matchesAlias('Brass gizmos', 'gizmo')).toBe(true);
    expect(matchesAlias('Gizmoway', 'gizmo')).toBe(false);
  });
});

describe('competitorHits', () => {
  it('서로 다른 경쟁사만 센다(같은 경쟁사 법인 둘은 1곳)', () => {
    const s = { ...base, delivers_supplier: ['Globex', 'Globex Driveline Japan', 'Initech'] };
    expect(competitorHits(s, comps)).toEqual([1, 2]);
  });
});

describe('matchLevel', () => {
  it('품목 설명에 키워드 → named', () => {
    expect(matchLevel({ ...base, parts_comments: ['Brass gizmos'] }, group)).toBe('named');
  });
  it('분류 일치 → category', () => {
    expect(matchLevel({ ...base, product_categories: ['Widget joint'] }, group)).toBe('category');
  });
  it('공정만 → process', () => {
    expect(matchLevel({ ...base, processes: ['Die casting'] }, group)).toBe('process');
  });
  it('없으면 none', () => {
    expect(matchLevel(base, group)).toBe('none');
  });
});

describe('certPoints · sizePoints', () => {
  it('IATF 10 · TS16949 10 · ISO9001 만 5 · 없음 0', () => {
    expect(certPoints(['IATF16949', 'ISO9001'])).toBe(10);
    expect(certPoints(['ISO/TS16949'])).toBe(10);
    expect(certPoints(['ISO9001'])).toBe(5);
    expect(certPoints(['ISO14001'])).toBe(0);
  });
  it('종업원 구간', () => {
    expect(sizePoints(null)).toBe(0);
    expect(sizePoints(40)).toBe(0);
    expect(sizePoints(50)).toBe(3);
    expect(sizePoints(300)).toBe(6);
    expect(sizePoints(1000)).toBe(10);
    expect(sizePoints(5000)).toBe(15);
  });
});

describe('본인·계열', () => {
  it('이름에 별칭 → 본인', () => {
    expect(isCompetitorSelf({ ...base, name: 'Globex Driveline Thailand' }, comps)).toBe(true);
    expect(isCompetitorSelf(base, comps)).toBe(false);
  });
  it('비고에 별칭 → 계열 가능성', () => {
    expect(affiliateHint({ ...base, remarks: ['-Initech Group company'] }, comps)).toEqual([2]);
  });
});

describe('scoreSupplier', () => {
  it('경쟁사 4곳은 45 상한 · 최고 일치 단계 하나만', () => {
    const s: SupplierRow = {
      ...base,
      delivers_supplier: ['Globex', 'Initech', 'Umbrella', 'Hooli'],
      parts_comments: ['gizmo'],
      processes: ['Die casting'],
      certifications: ['IATF16949'],
      employees: 1200,
    };
    const r = scoreSupplier(s, [group], comps);
    expect(r.competitorPoints).toBe(45);
    expect(r.bestLevel).toBe('named');
    expect(r.matchPoints).toBe(30);
    expect(r.total).toBe(45 + 30 + 10 + 10);
    expect(r.groupLevels[10]).toBe('named');
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run lib/sourcing/score.test.ts` → 모듈 없음.

- [ ] **Step 3: 구현**

```ts
/**
 * 협력사 후보 점수 — 결정 8(2026-11-13). 지역은 점수에 넣지 않는다(결정 5 — 탭으로만).
 * 저장하지 않고 조회 때마다 계산한다(결정 9 — 배점을 바꿔도 재수집 불필요).
 */
import type { CompetitorRow, MatchLevel, PartGroupRow, ScoreBreakdown, SupplierRow } from './types';

export const SCORE_WEIGHTS = {
  perCompetitor: 15,
  competitorCap: 45,
  match: { named: 30, category: 20, process: 10, none: 0 } satisfies Record<MatchLevel, number>,
  cert: { iatf: 10, iso9001: 5 },
  // SHORTCUT: 종업원 구간은 초안 — 1단계 화면에서 실측 분포를 보고 조정(결정 8).
  size: [
    { min: 5000, points: 15 },
    { min: 1000, points: 10 },
    { min: 300, points: 6 },
    { min: 50, points: 3 },
  ],
} as const;

const LEVEL_ORDER: MatchLevel[] = ['named', 'category', 'process', 'none'];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 영문 별칭·키워드 전용 — 단어 경계로 대소문자 무시(부분 문자열 오탐 방지).
 * 끝에 복수 어미(s·es)를 허용한다 — 품목 설명은 「Brass gizmos」처럼 복수로 적힌다.
 */
export function matchesAlias(text: string, alias: string): boolean {
  if (!alias.trim()) return false;
  return new RegExp(`\\b${escapeRegExp(alias.trim())}(?:e?s)?\\b`, 'i').test(text);
}

const anyMatch = (texts: string[], words: string[]) =>
  texts.some((t) => words.some((w) => matchesAlias(t, w)));

export function competitorHits(s: SupplierRow, comps: CompetitorRow[]): number[] {
  return comps.filter((c) => anyMatch(s.delivers_supplier, c.aliases)).map((c) => c.id);
}

export function matchLevel(s: SupplierRow, g: PartGroupRow): MatchLevel {
  if (anyMatch(s.parts_comments, g.keywords)) return 'named';
  const cats = new Set(s.product_categories.map((x) => x.toLowerCase()));
  if (g.ml_part_names.some((p) => cats.has(p.toLowerCase()))) return 'category';
  const procs = new Set(s.processes.map((x) => x.toLowerCase()));
  if (g.ml_processes.some((p) => procs.has(p.toLowerCase()))) return 'process';
  return 'none';
}

export function certPoints(certs: string[]): number {
  const up = certs.map((c) => c.toUpperCase().replace(/\s+/g, ''));
  if (up.some((c) => c.includes('IATF16949') || c.includes('TS16949')))
    return SCORE_WEIGHTS.cert.iatf;
  if (up.some((c) => c.includes('ISO9001'))) return SCORE_WEIGHTS.cert.iso9001;
  return 0;
}

export function sizePoints(employees: number | null): number {
  if (employees == null) return 0;
  return SCORE_WEIGHTS.size.find((b) => employees >= b.min)?.points ?? 0;
}

export function isCompetitorSelf(s: SupplierRow, comps: CompetitorRow[]): boolean {
  return comps.some((c) => c.aliases.some((a) => matchesAlias(s.name, a)));
}

export function affiliateHint(s: SupplierRow, comps: CompetitorRow[]): number[] {
  return comps.filter((c) => anyMatch(s.remarks, c.aliases)).map((c) => c.id);
}

export function scoreSupplier(
  s: SupplierRow,
  groups: PartGroupRow[],
  comps: CompetitorRow[]
): ScoreBreakdown {
  const competitorIds = competitorHits(s, comps);
  const competitorPoints = Math.min(
    SCORE_WEIGHTS.competitorCap,
    competitorIds.length * SCORE_WEIGHTS.perCompetitor
  );
  const groupLevels: Record<number, MatchLevel> = {};
  for (const g of groups) groupLevels[g.id] = matchLevel(s, g);
  const bestLevel = LEVEL_ORDER.find((l) => Object.values(groupLevels).includes(l)) ?? 'none';
  const matchPoints = SCORE_WEIGHTS.match[bestLevel];
  const cert = certPoints(s.certifications);
  const size = sizePoints(s.employees);
  return {
    competitorIds,
    competitorPoints,
    groupLevels,
    bestLevel,
    matchPoints,
    certPoints: cert,
    sizePoints: size,
    total: competitorPoints + matchPoints + cert + size,
  };
}
```

- [ ] **Step 4: 통과 확인** — 같은 명령 → 전부 PASS.
- [ ] **Step 5: 커밋** — `lib/sourcing/` 새 도메인이라 `Architecture.md` 부록 C 한 줄 + `AGENTS.md` 「폴더별 약속」 [`lib/`] 한 줄(`lib/sourcing/` 은 사외비 — `confidentialDb` 경유 · 경쟁사·품목 이름을 코드에 쓰지 말 것 · 수집은 로컬 수동)을 함께 · `feat(협력사): 점수 계산 순수 함수`.

---

### Task 6: 조회 계층 `lib/sourcing/source.ts`

**Files:**

- Create: `lib/sourcing/source.ts`

**Interfaces:**

- Consumes: Task 5 타입·함수 · `confidentialDb`.
- Produces:

```ts
export interface ProductTab {
  slug: string;
  name_ko: string;
}
export interface RankedSupplier {
  supplier: Pick<
    SupplierRow,
    'id' | 'name' | 'country' | 'region' | 'employees' | 'sales_text' | 'certifications' | 'source'
  >;
  score: ScoreBreakdown;
  competitorNames: string[];
  affiliateNames: string[];
  groupIds: number[]; // links 로 걸린 품목군
}
export interface SupplierRanking {
  product: ProductTab;
  groups: PartGroupRow[];
  rows: RankedSupplier[]; // 본인 제외 · 총점 내림차순 · 동점은 이름순
  regionCounts: Record<Region, number>;
  fetchedAt: string | null; // 가장 최근 fetched_at
}
export async function getSourcingProducts(): Promise<ProductTab[]>;
export async function getSupplierRanking(productSlug: string): Promise<SupplierRanking | null>;
export async function getSupplierDetail(
  id: number,
  productSlug: string
): Promise<{
  supplier: SupplierRow;
  product: ProductTab;
  groups: PartGroupRow[];
  score: ScoreBreakdown;
  competitors: CompetitorRow[];
  affiliateNames: string[];
  siblings: Pick<SupplierRow, 'id' | 'name' | 'country'>[];
} | null>;
```

- [ ] **Step 1: 구현** — 모든 export 함수는 `'use cache'` + `cacheLife('days')` + `cacheTag('sourcing')`. 조회는 `confidentialDb.from(...)`, 실패는 `logger.error` 후 throw(고객사 `fetchAccounts` 와 같은 꼴).
  - `getSupplierRanking`: 제품 → 품목군 → 경쟁사 → links(`part_group_id in 품목군`) → suppliers(`id in links`). 🔴 links·suppliers 는 수천 행이 될 수 있으므로 `.range()` 로 페이지를 돌고 **`.order('supplier_id').order('part_group_id').order('competitor_id')` / `.order('id')` 를 반드시 붙인다**(AGENTS — 다중 페이지는 PK 전체 정렬). `in` 목록은 500개씩 나눠 조회.
  - 본인(`isCompetitorSelf`)은 `rows` 에서 뺀다(결정 10). `regionCounts` 는 뺀 뒤 기준.
  - `siblings`: 이름 첫 단어(3자 이상)가 같은 다른 공급사 — `// SHORTCUT: 첫 단어 일치로 같은 그룹 거점을 추정 → MarkLines 그룹 정보가 생기면 그것으로`. `ilike` 에 넣는 첫 단어는 `%`·`_` 를 이스케이프.
- [ ] **Step 2: 타입 검사** — `npm run typecheck` → 0 errors.
- [ ] **Step 3: 캐시 태그 검사** — `scripts/venv/Scripts/python.exe scripts/verify_revalidate_tags.py` → exit 0.
- [ ] **Step 4: 커밋** — `feat(협력사): 조회 계층`.

---

### Task 7: 권한 + OEM 탭(사외비 역할에게만 「협력사」)

**Files:**

- Modify: `lib/auth/permissions.ts` · `lib/auth/permissions.test.ts`
- Create: `components/oem/OemTabs.tsx`
- Create: `app/oem/suppliers/layout.tsx`(권한 재확인 — 아래 Step 5-1)
- Modify: `app/oem/layout.tsx`(client → server)
- Modify: `Architecture.md` §5 라우트 맵(`/oem/suppliers` · `/oem/suppliers/[id]`) · `docs/oem-collection.md`(탭 목록에 「협력사」 — AGENTS 「`app/oem/<slug>` 탭 변경 → oem-collection 갱신」) — 이 Task 커밋에 함께

**Interfaces:**

- Produces: `canAccessSuppliers(role: Role): boolean` · `OemTabs({ showSuppliers }: { showSuppliers: boolean })`.

- [ ] **Step 1: 실패하는 시험** — `permissions.test.ts` import 에 `canAccessSuppliers` 추가 후:

```ts
describe('협력사 페이지 접근(/oem/suppliers)', () => {
  it('사외비 역할만 들어간다', () => {
    expect(canAccessSuppliers('admin')).toBe(true);
    expect(canAccessSuppliers('holdings')).toBe(true);
    expect(canAccessSuppliers('mobility')).toBe(true);
    expect(canAccessSuppliers('hmobility')).toBe(false);
    expect(canAccessSuppliers('guest')).toBe(false);
  });

  it('canAccess 가 목록·상세를 같은 기준으로 막는다', () => {
    for (const path of ['/oem/suppliers', '/oem/suppliers/123']) {
      expect(canAccess(path, 'mobility')).toBe(true);
      expect(canAccess(path, 'hmobility')).toBe(false);
      expect(canAccess(path, 'guest')).toBe(false);
    }
  });

  it('다른 OEM 탭은 그대로 열려 있다', () => {
    expect(canAccess('/oem', 'guest')).toBe(true);
    expect(canAccess('/oem/china', 'guest')).toBe(true);
    expect(canAccess('/oem/suppliersfoo', 'guest')).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run lib/auth/permissions.test.ts` → `canAccessSuppliers` 없음.

- [ ] **Step 3: 구현** — `canAccessCustomers` 아래에:

```ts
/**
 * 협력사 페이지(`/oem/suppliers`) 열람 권한.
 *
 * 사용자 결정(2026-11-13 결정 3): admin·holdings·mobility 만 — 우리 제품 구성·우선 컨택 후보(구매 전략).
 * `canAccessCustomers` 와 지금은 명단이 같지만 **의미가 다르므로** 재사용하지 않는다.
 */
export function canAccessSuppliers(role: Role): boolean {
  return role === 'admin' || role === 'holdings' || role === 'mobility';
}
```

`canAccess` 의 고객사 분기 바로 아래에:

```ts
// 협력사 — 구매 전략이라 사외비 역할만(2026-11-13 결정 3). /oem 의 다른 탭은 그대로.
if (matchesPath(pathname, '/oem/suppliers')) {
  return canAccessSuppliers(role);
}
```

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS. `canAccess` 의 함수 머리 주석 역할별 목록에 「협력사 차단」을 hmobility·guest 줄에 덧붙인다.

- [ ] **Step 5: `OemTabs` 로 옮기기** — `app/oem/layout.tsx` 의 `OEM_TABS`·탭 렌더링을 그대로 `components/oem/OemTabs.tsx`(`'use client'`)로 옮기고 끝에 `{ label: '협력사', href: '/oem/suppliers' }` 를 `showSuppliers` 일 때만 붙인다:

```tsx
const tabs = showSuppliers ? [...OEM_TABS, { label: '협력사', href: '/oem/suppliers' }] : OEM_TABS;
```

`app/oem/layout.tsx` 는 server 로:

```tsx
import { OemTabs } from '@/components/oem/OemTabs';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canAccessSuppliers } from '@/lib/auth/permissions';

export default async function OemLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const showSuppliers = !!user && canAccessSuppliers(user.role);
  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">OEM</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          전체 시장(MarkLines) + 회사별 IR 차종 판매 · 매월 갱신
        </p>
        <OemTabs showSuppliers={showSuppliers} />
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
```

🔴 `getCurrentUser` 가 쿠키를 읽어 `/oem` 하위의 `'use cache'` 페이지들이 동적으로 바뀌는지 확인한다 — `npm run build` 출력에서 `/oem/*` 라우트 표시가 바뀌거나 빌드 오류(「uncached data was accessed outside of `<Suspense>`」류)가 나면, 탭 줄을 `<Suspense>` 로 감싸 역할 판정만 동적으로 두고 이 Step 에 기록한다. `components/layout/Sidebar.tsx` 가 역할을 받는 방식(`AppLayout`)을 먼저 열어 같은 꼴을 따른다.

- [ ] **Step 5-1: 협력사 하위 layout 에서 막기** — `app/oem/layout.tsx` 는 탭을 숨길 뿐 경로를 막지 않는다. Global Constraints 의 「layout·page 가 각각 막는다」를 지키려고 `app/oem/suppliers/layout.tsx` 를 둔다(`app/customers/layout.tsx` 와 같은 꼴):

```tsx
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canAccess } from '@/lib/auth/permissions';

/** /oem/suppliers 트리 — 구매 전략(사외비)이라 하위 페이지 전에 권한부터 본다(페이지도 한 번 더 막는다). */
export default async function SuppliersLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user || !canAccess('/oem/suppliers', user.role)) redirect('/');
  return children;
}
```

- [ ] **Step 6: 검사** — `npm run typecheck` · `npx vitest run lib/auth` → 통과.
- [ ] **Step 7: 커밋** — `feat(협력사): 권한·OEM 탭(사외비 역할만 노출)`.

---

### Task 8: 목록 화면 `/oem/suppliers`

**Files:**

- Create: `app/oem/suppliers/page.tsx` · `app/oem/suppliers/loading.tsx`
- Create: `components/oem/suppliers/SupplierFilters.tsx` · `components/oem/suppliers/SupplierRankingTable.tsx`

**Interfaces:**

- Consumes: `getSourcingProducts` · `getSupplierRanking`(Task 6) · `REGIONS`(Task 5) · `useRowHighlight`(`lib/useRowHighlight.ts`).
- searchParams: `product`(slug · 기본 첫 제품) · `region`(`REGIONS` 중 하나 · 없으면 전체) · `group`(품목군 id · 없으면 전체).

- [ ] **Step 1: page** — 권한 재확인(`canAccess('/oem/suppliers', role)` 아니면 `redirect('/')`) → `getSourcingProducts()` → 제품 없으면 「아직 수집 전입니다」 안내 → `getSupplierRanking(product)` → `region`·`group` 으로 거른 행을 표에 넘긴다(거르기는 page 에서 — 캐시 키를 늘리지 않는다). 🔴 `group` 은 **현재 제품의 품목군 id 일 때만** 쓴다 — 아니면(숫자 아님 · 다른 제품 것 · 없는 id) 무시하고 전체로 본다(`groupLevels[없는 id]` 는 `undefined` 라 `!== 'none'` 이 참이 되어 모든 행이 통과한다 · Codex 대조 2026-11-13). `group` 필터 = `groupIds.includes(group) || (score.groupLevels[group] ?? 'none') !== 'none'`. `region` 도 `REGIONS` 에 없으면 전체. 상단 고지 한 줄(설계서 「화면」 절 문구 그대로) + 「MarkLines 기준일: fetchedAt(서울 날짜)」.
- [ ] **Step 2: `SupplierFilters`(server)** — 제품·지역·품목군을 `Link` 탭으로(현재 searchParams 를 유지하며 한 칸만 바꾼다 — 단 **제품 탭 링크는 `group` 을 지운다**: 품목군 id 는 제품마다 다르다). 지역 탭에는 `regionCounts` 건수를 붙인다(`한국 12`). 탭 모양은 `OemTabs`·`CustomersTabs` 와 같은 클래스(`rounded-md px-3 py-1.5 text-sm font-medium` · 활성 `bg-primary text-primary-foreground`).
- [ ] **Step 3: `SupplierRankingTable`(client)** — 칸: 순위 · 업체명(상세 링크 `/oem/suppliers/{id}?product={slug}`) · 국가 · 점수 · 경쟁사 배지(`competitorNames`) · 일치 단계(named=「품목 명시」·category=「분류 일치」·process=「공정만」) · 종업원 · 인증(IATF/ISO9001) · 출처(`MarkLines`/`웹 조사` — 설계서 순위표 칸) · 계열 가능성 배지(`affiliateNames` 가 있으면 「계열 가능성: …」). 행 강조는 `useRowHighlight().rowToggleProps(String(id), name)` + `ROW_HIGHLIGHT_CLASS`. 행이 많을 수 있으니 상위 200행만 그리고 「N곳 중 200곳 표시」를 적는다(`// SHORTCUT: 200행 상한 → 필요하면 페이지 넘김`).
- [ ] **Step 4: 검사** — `npm run typecheck` · `npm run lint`.
- [ ] **Step 5: 화면 확인** — `npm run dev`(포트 확인) → admin 세션으로 `~/.claude/scripts/headless_check.py` 로 `/oem/suppliers` 를 찍어 Read 로 본다. 확인: 탭 줄에 「협력사」 · 제품 2개 · 지역 9탭 건수 합 = 「전체」 건수 · 순위표 점수 내림차순 · 경쟁사 본인이 목록에 없음. guest 세션으로 `/oem/suppliers` → 리다이렉트, `/oem` 탭 줄에 「협력사」 없음. 로그인·보호 라우트 검증 절차는 `docs/gotchas-playwright-ui.md` 를 먼저 읽는다.
- [ ] **Step 6: 커밋** — `feat(협력사): 목록 화면`.

---

### Task 9: 상세 화면 `/oem/suppliers/[id]`

**Files:**

- Create: `app/oem/suppliers/[id]/page.tsx`

**Interfaces:**

- Consumes: `getSupplierDetail(id, productSlug)`(Task 6).

- [ ] **Step 1: page** — 권한 재확인 → `id` 가 정수가 아니거나 결과 null 이면 `notFound()` → 다섯 구획:
  1. 개요 표 — 국가·지역·주소·홈페이지(외부 링크 `rel="noopener noreferrer"`)·설립·매출(`sales_text` 원문)·종업원·인증
  2. 생산 품목·공정 — `product_categories`·`processes` 배지, `parts_comments` 원문 목록
  3. 납품처 — 완성차 / 부품사 두 목록, 경쟁사 별칭에 걸리는 이름은 굵게 + 「경쟁사」 배지
  4. 점수 내역 — 항목 · 근거 · 점수 표(경쟁사 납품 · 품목 일치(품목군별 단계) · 인증 · 규모 · 합계)와 배점 설명 한 줄
  5. 같은 그룹 거점(`siblings` 링크) · MarkLines 원문 링크(`source_url`) · 「목록으로」 링크(제품 유지)
- [ ] **Step 2: 검사** — `npm run typecheck` · `npm run lint`.
- [ ] **Step 3: 화면 확인** — 목록 상위 3곳의 상세를 헤드리스로 찍어 Read 로 본다. 점수 내역 합계 = 목록 점수, 경쟁사 강조가 목록 배지와 같은지.
- [ ] **Step 4: 커밋** — `feat(협력사): 업체 상세 화면`.

---

### Task 10: 마무리 — 통합 검사 · 문서 · 결정 이행

**Files:**

- (구조 문서 `Architecture.md`·`AGENTS.md` 는 Task 1·2·3·5·7 커밋에서 이미 갱신했다 — 여기선 빠진 곳만 확인)
- Modify: `docs/oem-collection.md`(「`/oem/suppliers` — 협력사 수집」 절: 명령·순서·쿠키·상한 · Task 3 Step 6 에서 고른 값)
- Modify: `docs/plans/2026-11-13-suppliers-page_결정이행.md`(결정별 「그대로」/「변경+승인일」)

- [ ] **Step 1: 통합 검사** — `npm run check-all 2>&1 | tail -15; echo "EXIT=${PIPESTATUS[0]}"` → `EXIT=0`. `scripts/venv/Scripts/python.exe -m pytest scripts/lib -q` → 전부 통과. `verify_revalidate_tags.py` → exit 0.
- [ ] **Step 2: 공개 레포 누출 검사** — `참고/협력사/sourcing_seed.json` 의 경쟁사 이름·별칭·키워드를 읽어 레포 추적 파일 전체를 Grep(`git ls-files` 범위). Expected: 0건(시험의 가짜 이름만). 🔴 0건이면 검사가 정말 돌았는지 알려진 단어 하나(`Acme`)로 양성 대조를 함께 돌린다.
- [ ] **Step 3: 문서** — `docs/oem-collection.md` 절을 쓰고, `Architecture.md`·`AGENTS.md` 에 이번 1단계 파일이 빠짐없이 올라 있는지 Grep 으로 확인한다(`sourcing`).
- [ ] **Step 4: 결정 이행 갱신** — 12개 결정의 이행 칸을 채운다. 설계서와 달라진 점 하나를 「그대로(세부 조정)」로 적는다: links 표에서 `match_level` 칸을 빼고 일치 단계를 화면에서 계산(결정 9 와 맞추기 위함).
- [ ] **Step 5: 커밋** — `docs(협력사): 1단계 문서·결정 이행`. 커밋 전 `git diff --cached` 를 읽고, 예상 파일 목록과 다르면 멈춘다.
- [ ] **Step 6: 사용자 화면 확인 요청** — 결정 12: 2단계(웹 보충) 착수 전에 사용자가 화면을 본다. 무엇을 눌러 무엇을 볼지 적어 요청한다.
