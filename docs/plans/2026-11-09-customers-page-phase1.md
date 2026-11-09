# 고객사 페이지 1단계 구현 계획 (2026-11-09 · 공개 판)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사외비 역할(admin·holdings·mobility)만 들어가는 `/customers`(요약)·`/customers/[slug]`(개별) 화면을 기존 DB 데이터(재무·주가·MarkLines 판매·손익 매출)로 채운다.

**Architecture:** 고객 명단은 새 사외비 표 `customer_accounts` 에만 둔다(코드·커밋에 고객명 없음). 계산은 `lib/customers/` 의 순수 함수(vitest)로, 조회는 `lib/customers/source.ts` 의 `'use cache'` 함수로 가른다. 차트는 현대 IR 실적 콤보·OEM 회사 탭 물량 부품을 선택 인자로 재사용한다.

**Tech Stack:** Next.js 16.2.4(cacheComponents) · React 19 · Supabase(`confidentialDb`·anon) · recharts · vitest · Python(시드 1회)

설계 정본 = [`2026-11-09-customers-page.md`](./2026-11-09-customers-page.md) · 결정 = [`_결정이행.md`](./2026-11-09-customers-page_결정이행.md) · 지시 원문 = [`_최초지시.md`](./2026-11-09-customers-page_최초지시.md) · 명단 원본 = `참고/고객사/`(gitignore)

## Global Constraints

- 🔴 **이 레포는 공개다.** 코드·시험 데이터·주석·커밋 메시지·이 계획서에 **실제 고객명·손익 고객명·공급 품목을 쓰지 않는다.** 시험 데이터는 가짜 이름(`가나자동차`·`Acme Motors`·`다라그룹`)만.
- 커밋 전 `git diff --cached` 에 손익 고객명이 없는지 grep(목록은 `참고/고객사/` 원본에서 읽는다 · 검사기 자가 시험 = 원본에 같은 패턴을 돌려 잡히는지).
- 사외비 계산 결과(금액·비중)를 stdout·로그에 찍지 않는다. 스크립트 출력은 행수·건수만.
- 사외비 표 조회는 `confidentialDb.from(...)` 만(`lib/supabase/confidential.ts`). 새 사외비 표는 `CONFIDENTIAL_TABLES` 에 한 줄.
- 새 `cacheTag` 는 세 곳을 함께: `cacheTag` · `app/api/revalidate/route.ts` `ALL_TAGS` · `scripts/lib/revalidate.py` `COLUMN_TO_TAGS`. `cacheLife('days')`. `exchange_rates_live` 태그 금지(ISR Write).
- 연도는 `lib/currentYear.ts` 의 `currentYear()` — 모듈 최상단 상수 금지 · `new Date().getFullYear()` 금지.
- `.range()` 다중 페이지 조회는 PK 전체로 `.order()`.
- 실적 표·차트는 **현지 통화**(결정 8) — 원화 환산 없음.
- 매출 비중 = **연결 · 실적 최신월 앵커 최근 12개월 · 0월(연간 합계 행) 제외**(사용자 선택 2026-11-09 3차).
- 마이그레이션 파일명 `YYYYMMDD000NNN_*.sql` · 기존 파일 수정 금지. 착수 시 `ls supabase/migrations | tail -1` 로 다음 번호를 다시 잰다(작성 시점 최신 = `20261109000002`).
- 파일은 UTF-8(BOM 없음) + LF · 커밋은 경로 명시(`git add -A` 금지) · `npm`(pnpm 아님) · 푸시는 사용자 요청 시에만.
- 서브에이전트 `model` 칸은 비운다(세션 모델 상속).

## 1단계 범위에서 «뺀» 것

- 3단계로: 요약 표의 ①~⑥ 신호 열 · 개별 화면의 공급사 관점 브리프 · IR 물량(`customer_volume_ir`) · 정의 차이 설명 박스. 2단계로: 자료실·동향·실적 일정. (설계서 그대로)
- 기존 OEM 회사 탭(`app/oem/*`)의 판매·출하 표는 **복제하지 않고 그 탭으로 가는 링크**로 잇는다(`customer_accounts.oem_tab_path`) — 사용자 선택 2026-11-09 3차. 같은 표를 두 곳에 그리면 갈린다.

## 실측 근거 (2026-11-09 · 이 계획의 기본값을 정한 숫자)

| 항목               | 실측                                                                              | 계획에 반영                       |
| ------------------ | --------------------------------------------------------------------------------- | --------------------------------- |
| 손익 실적 범위     | 연결 2025-01~2026-09 · 개별 2022-01~2026-09 · 실적의 추정 행 0건                  | 연결 · 최신월 앵커 12개월         |
| 손익 연간 합계 행  | 연결 2025 에 `period_month=0` 행(1~12월 합과 같음)                                | 0월 제외(이중 합산 방지)          |
| 재무 분기 행       | 회사당 2023 이후 매출 있는 분기 6~7개 · 해외사 분기 매출 null 1~3건               | null 은 표 「—」·차트 빈칸        |
| 재무 통화 혼재     | 한 회사가 분기 1건만 다른 통화·나머지 현지 통화                                   | 최신 매출 행의 통화만 남긴다      |
| `consolidation` 칸 | 고객 후보 전부 null                                                               | 연결/별도로 거르지 않음           |
| 주가 일봉          | `stock_prices` 고객 후보 전부 있음(최신 2026-11-06~09) · `stock_daily_prices` 0곳 | `stock_prices.close` 로 1M·YTD    |
| MarkLines          | `oem_sales_group_month {oem_group, year_month(YYYYMM), sales}` · 그룹 단위        | `marklines_group` nullable · 사유 |

## File Structure

| 파일                                                              | 신규/수정       | 책임                                        |
| ----------------------------------------------------------------- | --------------- | ------------------------------------------- |
| `supabase/migrations/2026110900000N_create_customer_accounts.sql` | 신규            | 사외비 표                                   |
| `lib/database.types.ts`                                           | 수정            | 타입(해당 블록만)                           |
| `lib/supabase/confidential.ts`                                    | 수정            | `CONFIDENTIAL_TABLES` 한 줄                 |
| `app/api/revalidate/route.ts` · `scripts/lib/revalidate.py`       | 수정            | 태그 `customer_accounts`                    |
| `참고/고객사/seed_customer_accounts.py` · `customer_seed.json`    | 신규(gitignore) | 명단 1회 INSERT                             |
| `lib/auth/permissions.ts` · `permissions.test.ts`                 | 수정            | `canAccessCustomers` + `/customers` 분기    |
| `components/layout/Sidebar.tsx`                                   | 수정            | 「고객사」 메뉴                             |
| `lib/customers/types.ts`                                          | 신규            | 도메인 타입                                 |
| `lib/customers/share.ts` (+test)                                  | 신규            | 손익 행 → 매출 비중·상위 품목               |
| `lib/customers/earnings.ts` (+test)                               | 신규            | 재무 행 → 분기·연간 실적 점(현지 통화 십억) |
| `lib/customers/prices.ts` (+test)                                 | 신규            | 일봉 → 1M·YTD                               |
| `lib/customers/volume.ts` (+test)                                 | 신규            | MarkLines 그룹 월 → 기존 집계 입력 행       |
| `lib/customers/source.ts`                                         | 신규            | `'use cache'` 조회 2종                      |
| `lib/pnl/source.ts`                                               | 수정            | `fetchPnlEntries` 에 `export` 만            |
| `components/oem-companies/common/revenueFormat.ts`                | 신규            | 통화별 매출 축·라벨·툴팁                    |
| `components/oem-companies/hyundai/` 실적 차트 3파일               | 수정            | 선택 인자(기본값 = 현재 동작)               |
| `components/customers/` 표 2종                                    | 신규            | 요약 표 · 실적 표                           |
| `app/customers/page.tsx` · `app/customers/[slug]/page.tsx`        | 신규            | 화면                                        |
| `Architecture.md`                                                 | 수정            | §5 라우트 · §7-G 사외비 표 · 부록 C         |

## 재사용 짝짓기 (설계서 표의 「미정」 2칸 확정)

| 화면 요소       | 짝(기존)                                              | 판정                                                |
| --------------- | ----------------------------------------------------- | --------------------------------------------------- |
| 실적 콤보 차트  | `HyundaiQuarterlyEarningsChart` + Inner 2종           | 선택 인자 추가 재사용                               |
| 실적 표         | OEM 회사 탭에 분기 실적 «표» 없음(확인)               | 신규 `CustomerEarningsTable`                        |
| 매출 비중       | 손익 「부문별 매출 비중」 = 부문 × 기준 토글 표       | 용도가 달라 셀·머리 문구로 신규(공용화 없음)        |
| 물량 KPI·시계열 | `CompanyKpiCards` · `CompanyTimeSeriesChart`          | 그대로 · 집계는 `kg-mobility/aggregate.ts` 3함수    |
| 뉴스            | `PopupNewsSection`                                    | 그대로                                              |
| 주가 일봉 조회  | `lib/stockPrices.ts` `getStockPriceSeries`(1종목 5년) | 여러 종목·짧은 기간이라 조회 신규, 루프 패턴만 따름 |

---

### Task 1: `customer_accounts` 사외비 표 + 캐시 태그

**Files:**

- Create: `supabase/migrations/2026110900000N_create_customer_accounts.sql`(N = 착수 시 다음 번호)
- Modify: `lib/database.types.ts` · `lib/supabase/confidential.ts:42-55` · `app/api/revalidate/route.ts`(`ALL_TAGS`) · `scripts/lib/revalidate.py`(`COLUMN_TO_TAGS`) · `Architecture.md` §7-G

**Interfaces:**

- Produces: 표 `public.customer_accounts` · 캐시 태그 `'customer_accounts'`

- [ ] **Step 1: 다음 마이그레이션 번호 확인**

Run: `ls supabase/migrations | tail -1`
Expected: `20261109000002_...` 이면 새 파일은 `20261109000003_create_customer_accounts.sql`. 다른 세션이 더 올렸으면 그 다음 번호.

- [ ] **Step 2: 마이그레이션 작성**

```sql
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
```

- [ ] **Step 3: 적용·확인**

Supabase MCP `apply_migration`(name = 파일명에서 번호·확장자 뺀 것). 그다음:

```sql
select relrowsecurity, (select count(*) from pg_policies where tablename='customer_accounts') as policies
from pg_class where relname='customer_accounts';
```

Expected: `relrowsecurity=true`, `policies=0`.

- [ ] **Step 4: 타입**

MCP `generate_typescript_types` 결과에서 **`customer_accounts` 블록만** `lib/database.types.ts` 의 `Tables` 알파벳 자리에 붙인다. 🔴 파일 전체를 덮지 말 것 — 손으로 붙인 `TableRow`·`ViewRow` 가 지워진다(`docs/gotchas-ci-deploy.md` §7).

- [ ] **Step 5: 사외비 명단·캐시 태그 세 곳**

- `lib/supabase/confidential.ts` `CONFIDENTIAL_TABLES` 배열 끝에 `'customer_accounts',`
- `app/api/revalidate/route.ts` `ALL_TAGS` 의 `'pnl_entries',` 다음에 `'customer_accounts',`
- `scripts/lib/revalidate.py` `COLUMN_TO_TAGS` 의 `'pnl_entries': ['pnl_entries'],` 다음에 `'customer_accounts': ['customer_accounts'],`

- [ ] **Step 6: 검사**

Run: `npm run typecheck` → PASS
Run: `scripts/venv/Scripts/python.exe scripts/verify_revalidate_tags.py; echo "EXIT=$?"` — 이 시점엔 `cacheTag('customer_accounts')` 리터럴이 아직 없다. 위반이 나오면 내용을 적어 두고 Task 5 끝에서 다시 돌려 0 인지 본다.

- [ ] **Step 7: Architecture.md §7-G** — 사외비 표 목록에 `customer_accounts` 한 줄: 「고객사 페이지 명단·손익 고객명 매핑. 행은 로컬 1회 INSERT(공개 레포에 명단 없음)」.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/2026110900000N_create_customer_accounts.sql lib/database.types.ts lib/supabase/confidential.ts app/api/revalidate/route.ts scripts/lib/revalidate.py Architecture.md
git diff --cached --stat
git commit -m "feat(고객사): customer_accounts 사외비 표 + 캐시 태그"
```

---

### Task 2: 미등록 1곳 등록 + 명단 시드(로컬 1회)

**Files:**

- Create(gitignore): `참고/고객사/customer_seed.json` · `참고/고객사/seed_customer_accounts.py`
- DB: `companies` 1행(미등록 상장사) · `customer_accounts` 11행

**Interfaces:**

- Consumes: Task 1 의 표
- Produces: `customer_accounts` 행(slug 는 영문 소문자·하이픈)

🔴 이 태스크의 산출물은 **전부 gitignore 경로**다. 고객명을 레포 파일에 쓰지 않는다.

- [ ] **Step 1: gitignore 확인**

Run: `git check-ignore -v 참고/고객사/customer_seed.json`
Expected: `.gitignore` 규칙이 찍힌다. 안 찍히면 멈추고 보고.

- [ ] **Step 2: 미등록 상장사 등록**

원본 `참고/고객사/2026-11-09-customers-page.md` 의 「미등록」 회사 티커로:

```bash
scripts/venv/Scripts/python.exe scripts/onboard_company.py --ticker <원본의 티커>
```

그다음 MCP `execute_sql` 로 `company_type` 이 `'OEM'` 인지 확인하고 아니면 `update companies set company_type='OEM' where id='<id>'`. `company_pages` 매핑도 확인(트리거가 넣는다 — 「관련주식」 은 수동 큐레이션이라 넣지 않는다). `stock_prices` 가 정기 수집 전이라 비면 화면은 「—」 — 정상으로 보고.

- [ ] **Step 3: 시드 JSON**

원본의 고객 매핑으로 11행. 형식(값은 원본에서 — 여기 적지 않는다):

```json
[
  {
    "ticker": "<원본>",
    "slug": "<영문-소문자>",
    "display_order": 1,
    "pnl_customers": ["<손익 고객명>"],
    "share_group": null,
    "marklines_group": "<oem_group 값 또는 null>",
    "oem_tab_path": "</oem/... 또는 null>",
    "note": null
  }
]
```

`marklines_group` 은 `select distinct oem_group from oem_sales_group_month order by 1` 결과에서 철자 그대로. 합산 행만 있는 두 회사는 같은 `pnl_customers`·같은 `share_group`, 손익 행이 없는 회사는 `pnl_customers: []`. `oem_tab_path` 는 `ls app/oem` 의 실제 폴더로.

- [ ] **Step 4: 시드 스크립트**

```python
"""고객사 명단 1회 시드 — 이 파일과 JSON 은 gitignore(참고/고객사/). 커밋 금지.

출력은 행수만 — 고객명·금액을 찍지 않는다(AGENTS 사외비 적재 정책).
"""
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))

from lib.bootstrap import init_script  # noqa: E402

init_script(str(REPO / "scripts" / "seed_customer_accounts.py"))
from lib import db  # noqa: E402

rows_in = json.loads((Path(__file__).parent / "customer_seed.json").read_text(encoding="utf-8"))
dry = "--dry-run" in sys.argv

companies = db.select("companies", "id,ticker", {"status": "eq.active"})
by_ticker = {c["ticker"]: c["id"] for c in companies if c.get("ticker")}
missing = [r["ticker"] for r in rows_in if r["ticker"] not in by_ticker]
if missing:
    print(f"티커 미일치 {len(missing)}건 — 중단")
    sys.exit(1)

keys = ("slug", "display_order", "pnl_customers", "share_group", "marklines_group", "oem_tab_path", "note")
rows = [{"company_id": by_ticker[r["ticker"]], **{k: r[k] for k in keys}} for r in rows_in]
print(f"시드 대상 {len(rows)}행 (dry-run={dry})")
if not dry:
    with db.WriteSession():
        db.upsert_rows("customer_accounts", rows, on_conflict="company_id")
    print("적재 완료")
```

착수 전 `scripts/lib/db.py`·`scripts/lib/bootstrap.py` 에서 `select`·`upsert_rows`·`WriteSession`·`init_script` 의 실제 시그니처를 열어 맞춘다(이름이 다르면 그 모듈의 것을 쓴다 — 새 헬퍼를 만들지 않는다).

- [ ] **Step 5: dry-run → 본 적재**

Run: `scripts/venv/Scripts/python.exe 참고/고객사/seed_customer_accounts.py --dry-run` → `시드 대상 11행 (dry-run=True)`
Run: `scripts/venv/Scripts/python.exe 참고/고객사/seed_customer_accounts.py` → `적재 완료`

- [ ] **Step 6: 적재 확인(금액 없는 질의)**

```sql
select count(*) n, count(marklines_group) with_ml, count(oem_tab_path) with_tab,
       count(*) filter (where cardinality(pnl_customers)=0) no_pnl
from customer_accounts;
```

Expected: `n=11`. 나머지 셋은 원본 매핑과 같은 개수.

- [ ] **Step 7: 커밋 없음** — `git status --short 참고/` 가 비어 있어야 정상.

---

### Task 3: 권한 · 사이드바 · 라우트 문서

**Files:**

- Modify: `lib/auth/permissions.ts`(31-33 다음 · `canAccess` 의 `/etc/mgmt-standard` 분기 위) · `lib/auth/permissions.test.ts` · `components/layout/Sidebar.tsx`(lucide import · 53행 다음) · `Architecture.md` §5

**Interfaces:**

- Produces: `canAccessCustomers(role: Role): boolean` · `canAccess('/customers…', role)`

- [ ] **Step 1: 실패하는 시험** — `lib/auth/permissions.test.ts` 기존 import 에 `canAccessCustomers` 를 더하고:

```ts
describe('고객사 페이지 접근(/customers)', () => {
  it('사외비 역할만 들어간다', () => {
    expect(canAccessCustomers('admin')).toBe(true);
    expect(canAccessCustomers('holdings')).toBe(true);
    expect(canAccessCustomers('mobility')).toBe(true);
    expect(canAccessCustomers('hmobility')).toBe(false);
    expect(canAccessCustomers('guest')).toBe(false);
  });

  it('canAccess 가 요약·개별 경로를 같은 기준으로 막는다', () => {
    for (const path of ['/customers', '/customers/acme-motors']) {
      expect(canAccess(path, 'admin')).toBe(true);
      expect(canAccess(path, 'holdings')).toBe(true);
      expect(canAccess(path, 'mobility')).toBe(true);
      expect(canAccess(path, 'hmobility')).toBe(false);
      expect(canAccess(path, 'guest')).toBe(false);
    }
  });

  it('비슷한 접두사는 막지 않는다', () => {
    expect(canAccess('/customersfoo', 'guest')).toBe(true);
  });
});
```

Run: `npx vitest run lib/auth/permissions.test.ts` → FAIL(`canAccessCustomers` 없음)

- [ ] **Step 2: 구현** — `canAccessConfidentialReports` 다음에:

```ts
/**
 * 고객사 페이지(`/customers`) 열람 권한.
 *
 * 사용자 결정(2026-11-09 결정 2): admin·holdings·mobility 만 — 우리 매출 비중(사외비)을 보여 준다.
 * `canAccessConfidentialReports` 와 지금은 명단이 같지만 **의미가 다르므로**(보고서 열람 vs 고객 정보)
 * 재사용하지 않는다 — 한쪽 명단 변경이 다른 쪽에 새면 안 된다.
 */
export function canAccessCustomers(role: Role): boolean {
  return role === 'admin' || role === 'holdings' || role === 'mobility';
}
```

`canAccess` 의 `/etc/mgmt-standard` 분기 바로 위에:

```ts
// 고객사 — 우리 매출 비중이 실려 사외비 역할만(2026-11-09 결정 2).
if (matchesPath(pathname, '/customers')) {
  return canAccessCustomers(role);
}
```

`canAccess` JSDoc 목록의 hmobility·guest 줄 끝에 「· 고객사 차단」.

- [ ] **Step 3: 통과 확인** — `npx vitest run lib/auth/permissions.test.ts` → PASS. 3번째 시험이 실패하면 `matchesPath` 를 읽고 보고(고치지 않는다 — 기존 동작).

- [ ] **Step 4: 사이드바** — lucide import 에 `Handshake`, `NAV_ITEMS_ALL` 의 `{ label: '비교', ... }` 다음 줄:

```ts
  { label: '고객사', href: '/customers', Icon: Handshake },
```

- [ ] **Step 5: Architecture.md §5 라우트 표 두 줄** — `/customers`「고객사 요약 · 사외비 역할만(`canAccessCustomers`)」 · `/customers/[slug]`「고객사 개별(실적·MarkLines 판매·뉴스)」. 셀은 한 줄 요약(prettier 패딩).

- [ ] **Step 6: 검사·커밋**

Run: `npm run typecheck` → PASS · `npx vitest run lib/auth` → PASS

```bash
git add lib/auth/permissions.ts lib/auth/permissions.test.ts components/layout/Sidebar.tsx Architecture.md
git commit -m "feat(고객사): 사외비 역할 전용 권한 + 사이드바 메뉴"
```

---

### Task 4: 순수 계산 함수 4종 (TDD)

**Files:**

- Create: `lib/customers/types.ts` · `share.ts`·`share.test.ts` · `earnings.ts`·`earnings.test.ts` · `prices.ts`·`prices.test.ts` · `volume.ts`·`volume.test.ts` (전부 `lib/customers/`)

**Interfaces:**

- Consumes: `CompanySaleRowWithPt`·`OemSalesGroupMonth`(`lib/types.ts`)
- Produces(Task 5·6·7 이 이 이름을 쓴다):
  - `computeShares(rows: PnlRevenueRow[], accounts: ShareAccount[]): ShareResult`
  - `buildEarnings(rows: FinancialPeriodRow[]): CustomerEarnings`
  - `priceReturns(series: PricePoint[]): PriceReturns`
  - `groupMonthToSaleRows(rows: OemSalesGroupMonth[], group: string): CompanySaleRowWithPt[]`

- [ ] **Step 1: 타입** — `lib/customers/types.ts`:

```ts
/** 고객사 페이지 도메인 타입 — 순수 함수(share·earnings·prices·volume)와 source 가 공유한다. */

/** 손익 매출 한 행(연결·실적·1~12월로 호출부가 이미 거른 것). */
export interface PnlRevenueRow {
  customer: string;
  product: string;
  period_year: number;
  period_month: number;
  revenue: number | null;
}

export interface ShareAccount {
  company_id: string;
  pnl_customers: string[];
}

export interface CustomerShare {
  /** 최근 12개월 우리 연결 매출 중 이 회사 비중(%). 손익 고객 행이 없으면 null(「해당 없음」). */
  sharePct: number | null;
  /** 매출 상위 품목(최대 3) — 사외비. */
  topProducts: string[];
}

export interface ShareResult {
  /** 예: '2025.10~2026.09'. 손익 행이 없으면 ''. */
  windowLabel: string;
  byCompany: Record<string, CustomerShare>;
}

/** financials 한 행 중 실적에 쓰는 칸. 금액 = 원통화 백만. */
export interface FinancialPeriodRow {
  fiscal_year: number;
  fiscal_quarter: number | null;
  period_type: string;
  period_end_date: string | null;
  currency: string;
  revenue: number | null;
  operating_income: number | null;
  operating_margin: number | null;
  net_income: number | null;
}

/** 실적 표·차트 한 점. 금액 = 현지 통화 십억(bn). */
export interface CustomerEarningsPoint {
  period_label: string;
  fiscal_year: number;
  fiscal_quarter: number | null;
  revenue_bn: number | null;
  operating_income_bn: number | null;
  operating_margin_pct: number | null;
  net_income_bn: number | null;
  /** 전년 같은 기간 대비 매출 증감(%). 비교 대상이 없으면 null. */
  revenue_yoy_pct: number | null;
}

export interface CustomerEarnings {
  /** 표·차트에 쓴 통화. 재무 행이 없으면 null. */
  currency: string | null;
  quarterly: CustomerEarningsPoint[];
  annual: CustomerEarningsPoint[];
}

export interface PricePoint {
  trade_date: string; // 'YYYY-MM-DD'
  close: number;
}

export interface PriceReturns {
  lastClose: number | null;
  lastDate: string | null;
  /** 마지막 종가 vs 한 달 전 날짜 이전 마지막 거래일 종가, %. */
  return1mPct: number | null;
  /** 마지막 종가 vs 전년 마지막 거래일 종가, %. */
  returnYtdPct: number | null;
}
```

- [ ] **Step 2: 매출 비중 — 실패하는 시험** — `lib/customers/share.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeShares } from './share';
import type { PnlRevenueRow } from './types';

const row = (
  customer: string,
  product: string,
  y: number,
  m: number,
  revenue: number | null
): PnlRevenueRow => ({
  customer,
  product,
  period_year: y,
  period_month: m,
  revenue,
});

describe('computeShares', () => {
  it('최신월로 끝나는 12개월만 센다', () => {
    const rows = [
      row('가나자동차', '부품A', 2025, 9, 1000), // 창 밖(2025.10~2026.09)
      row('가나자동차', '부품A', 2025, 10, 30),
      row('다라그룹', '부품B', 2026, 9, 70),
    ];
    const r = computeShares(rows, [{ company_id: 'c1', pnl_customers: ['가나자동차'] }]);
    expect(r.windowLabel).toBe('2025.10~2026.09');
    expect(r.byCompany.c1.sharePct).toBeCloseTo(30);
  });

  it('여러 손익 고객명을 한 회사로 합친다', () => {
    const rows = [
      row('가나 북미', 'A', 2026, 1, 20),
      row('가나 유럽', 'A', 2026, 1, 30),
      row('기타사', 'B', 2026, 1, 50),
    ];
    const r = computeShares(rows, [
      { company_id: 'c1', pnl_customers: ['가나 북미', '가나 유럽'] },
    ]);
    expect(r.byCompany.c1.sharePct).toBeCloseTo(50);
  });

  it('손익 고객명이 없으면 null(해당 없음)', () => {
    const r = computeShares(
      [row('기타사', 'B', 2026, 1, 50)],
      [{ company_id: 'c2', pnl_customers: [] }]
    );
    expect(r.byCompany.c2.sharePct).toBeNull();
    expect(r.byCompany.c2.topProducts).toEqual([]);
  });

  it('상위 품목은 매출 순 최대 3개', () => {
    const rows = [
      row('가나자동차', 'P1', 2026, 1, 10),
      row('가나자동차', 'P2', 2026, 1, 40),
      row('가나자동차', 'P3', 2026, 1, 30),
      row('가나자동차', 'P4', 2026, 1, 20),
    ];
    const r = computeShares(rows, [{ company_id: 'c1', pnl_customers: ['가나자동차'] }]);
    expect(r.byCompany.c1.topProducts).toEqual(['P2', 'P3', 'P4']);
  });

  it('null 매출은 건너뛴다 · 값 있는 행이 없으면 빈 결과', () => {
    const r = computeShares(
      [row('가나자동차', 'A', 2026, 1, null)],
      [{ company_id: 'c1', pnl_customers: ['가나자동차'] }]
    );
    expect(r.windowLabel).toBe('');
    expect(r.byCompany.c1.sharePct).toBeNull();
  });
});
```

Run: `npx vitest run lib/customers/share.test.ts` → FAIL(모듈 없음)

- [ ] **Step 3: 매출 비중 구현** — `lib/customers/share.ts`:

```ts
import type { CustomerShare, PnlRevenueRow, ShareAccount, ShareResult } from './types';

const ym = (y: number, m: number) => y * 12 + (m - 1);
const fmtYm = (n: number) => `${Math.floor(n / 12)}.${String((n % 12) + 1).padStart(2, '0')}`;
const empty = (): CustomerShare => ({ sharePct: null, topProducts: [] });

/**
 * 손익 매출 → 고객사별 비중(사용자 선택 2026-11-09: 연결·최신월 앵커 12개월·0월 제외 — 거르기는 호출부).
 * 창 = 매출이 있는 최신월로 끝나는 12개월 · 분모 = 창 안 전체 고객 매출 합.
 */
export function computeShares(rows: PnlRevenueRow[], accounts: ShareAccount[]): ShareResult {
  const valued = rows.filter((r): r is PnlRevenueRow & { revenue: number } => r.revenue != null);
  if (valued.length === 0) {
    return {
      windowLabel: '',
      byCompany: Object.fromEntries(accounts.map((a) => [a.company_id, empty()])),
    };
  }
  const end = Math.max(...valued.map((r) => ym(r.period_year, r.period_month)));
  const start = end - 11;
  const inWindow = valued.filter((r) => {
    const k = ym(r.period_year, r.period_month);
    return k >= start && k <= end;
  });
  const total = inWindow.reduce((s, r) => s + r.revenue, 0);

  const byCompany: Record<string, CustomerShare> = {};
  for (const a of accounts) {
    if (a.pnl_customers.length === 0 || total === 0) {
      byCompany[a.company_id] = empty();
      continue;
    }
    const names = new Set(a.pnl_customers);
    const mine = inWindow.filter((r) => names.has(r.customer));
    const sum = mine.reduce((s, r) => s + r.revenue, 0);
    const byProduct = new Map<string, number>();
    for (const r of mine) byProduct.set(r.product, (byProduct.get(r.product) ?? 0) + r.revenue);
    const topProducts = [...byProduct.entries()]
      .filter(([, v]) => v > 0)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([p]) => p);
    byCompany[a.company_id] = { sharePct: (sum / total) * 100, topProducts };
  }
  return { windowLabel: `${fmtYm(start)}~${fmtYm(end)}`, byCompany };
}
```

Run: `npx vitest run lib/customers/share.test.ts` → PASS

- [ ] **Step 4: 실적 — 실패하는 시험** — `lib/customers/earnings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildEarnings } from './earnings';
import type { FinancialPeriodRow } from './types';

const q = (
  y: number,
  qt: number,
  revenue: number | null,
  extra: Partial<FinancialPeriodRow> = {}
): FinancialPeriodRow => ({
  fiscal_year: y,
  fiscal_quarter: qt,
  period_type: 'quarterly',
  period_end_date: `${y}-${String(qt * 3).padStart(2, '0')}-28`,
  currency: 'USD',
  revenue,
  operating_income: revenue == null ? null : revenue / 10,
  operating_margin: revenue == null ? null : 10,
  net_income: null,
  ...extra,
});
const a = (
  y: number,
  revenue: number,
  extra: Partial<FinancialPeriodRow> = {}
): FinancialPeriodRow => ({
  fiscal_year: y,
  fiscal_quarter: null,
  period_type: 'annual',
  period_end_date: `${y}-12-31`,
  currency: 'USD',
  revenue,
  operating_income: revenue / 20,
  operating_margin: 5,
  net_income: -1,
  ...extra,
});

describe('buildEarnings', () => {
  it('백만 → 십억, 분기 라벨·오름차순', () => {
    const r = buildEarnings([q(2026, 2, 2000), q(2026, 1, 1000)]);
    expect(r.currency).toBe('USD');
    expect(r.quarterly.map((p) => p.period_label)).toEqual(['2026Q1', '2026Q2']);
    expect(r.quarterly[1].revenue_bn).toBe(2);
    expect(r.quarterly[1].operating_income_bn).toBe(0.2);
  });

  it('전년 같은 분기 대비 매출 YoY', () => {
    const r = buildEarnings([q(2025, 1, 1000), q(2026, 1, 1100)]);
    expect(r.quarterly[1].revenue_yoy_pct).toBeCloseTo(10);
    expect(r.quarterly[0].revenue_yoy_pct).toBeNull();
  });

  it('최신 매출 행의 통화만 남긴다(통화 혼재)', () => {
    const r = buildEarnings([
      q(2024, 3, 5, { currency: 'USD' }),
      q(2026, 2, 900000, { currency: 'VND' }),
      a(2025, 3000000, { currency: 'VND' }),
    ]);
    expect(r.currency).toBe('VND');
    expect(r.quarterly.map((p) => p.period_label)).toEqual(['2026Q2']);
  });

  it('같은 기간 중복은 결산일이 늦은 행', () => {
    const r = buildEarnings([
      q(2026, 1, 100, { period_end_date: '2026-03-28' }),
      q(2026, 1, 200, { period_end_date: '2026-03-31' }),
    ]);
    expect(r.quarterly).toHaveLength(1);
    expect(r.quarterly[0].revenue_bn).toBe(0.2);
  });

  it('매출 null 분기는 남기되 값은 null · 연간 분리', () => {
    const r = buildEarnings([q(2026, 1, null), a(2025, 4000)]);
    expect(r.quarterly[0].revenue_bn).toBeNull();
    expect(r.annual[0]).toMatchObject({
      period_label: '2025',
      revenue_bn: 4,
      net_income_bn: -0.001,
    });
  });

  it('행이 없으면 통화 null·빈 배열', () => {
    expect(buildEarnings([])).toEqual({ currency: null, quarterly: [], annual: [] });
  });
});
```

Run: `npx vitest run lib/customers/earnings.test.ts` → FAIL

- [ ] **Step 5: 실적 구현** — `lib/customers/earnings.ts`:

```ts
import type { CustomerEarnings, CustomerEarningsPoint, FinancialPeriodRow } from './types';

const toBn = (v: number | null) => (v == null ? null : v / 1000);
/** 정렬 키 — 연간 행(분기 null)은 5로 쳐서 같은 해 분기들 뒤에 둔다. */
const order = (r: FinancialPeriodRow) => r.fiscal_year * 10 + (r.fiscal_quarter ?? 5);

/** 같은 (구분, 연, 분기) 중 결산일이 늦은 행 하나. */
function dedupe(rows: FinancialPeriodRow[]): FinancialPeriodRow[] {
  const map = new Map<string, FinancialPeriodRow>();
  for (const r of rows) {
    const key = `${r.period_type}|${r.fiscal_year}|${r.fiscal_quarter ?? ''}`;
    const prev = map.get(key);
    if (!prev || (r.period_end_date ?? '') > (prev.period_end_date ?? '')) map.set(key, r);
  }
  return [...map.values()];
}

function toPoints(rows: FinancialPeriodRow[], quarterly: boolean): CustomerEarningsPoint[] {
  const sorted = [...rows].sort((x, y) => order(x) - order(y));
  const byKey = new Map(sorted.map((r) => [`${r.fiscal_year}|${r.fiscal_quarter ?? ''}`, r]));
  return sorted.map((r) => {
    const prev = byKey.get(`${r.fiscal_year - 1}|${r.fiscal_quarter ?? ''}`);
    const yoy =
      r.revenue != null && prev?.revenue != null && prev.revenue > 0
        ? ((r.revenue - prev.revenue) / prev.revenue) * 100
        : null;
    return {
      period_label: quarterly ? `${r.fiscal_year}Q${r.fiscal_quarter}` : String(r.fiscal_year),
      fiscal_year: r.fiscal_year,
      fiscal_quarter: r.fiscal_quarter,
      revenue_bn: toBn(r.revenue),
      operating_income_bn: toBn(r.operating_income),
      operating_margin_pct: r.operating_margin,
      net_income_bn: toBn(r.net_income),
      revenue_yoy_pct: yoy,
    };
  });
}

/**
 * financials → 실적 표·차트 점(현지 통화 십억).
 * 통화가 섞인 회사가 있어(분기 1건만 다른 통화) 매출이 있는 최신 행의 통화만 남긴다.
 */
export function buildEarnings(rows: FinancialPeriodRow[]): CustomerEarnings {
  const withRevenue = rows.filter((r) => r.revenue != null);
  if (withRevenue.length === 0) return { currency: null, quarterly: [], annual: [] };
  const latest = withRevenue.reduce((best, r) => (order(r) > order(best) ? r : best));
  const same = dedupe(rows.filter((r) => r.currency === latest.currency));
  return {
    currency: latest.currency,
    quarterly: toPoints(
      same.filter((r) => r.period_type === 'quarterly' && r.fiscal_quarter != null),
      true
    ),
    annual: toPoints(
      same.filter((r) => r.period_type === 'annual'),
      false
    ),
  };
}
```

Run: `npx vitest run lib/customers/earnings.test.ts` → PASS

- [ ] **Step 6: 주가 등락 — 실패하는 시험** — `lib/customers/prices.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { priceReturns } from './prices';

describe('priceReturns', () => {
  it('1M = 한 달 전 날짜 이전 마지막 거래일 · YTD = 전년 마지막 거래일', () => {
    const r = priceReturns([
      { trade_date: '2025-12-30', close: 100 },
      { trade_date: '2026-10-08', close: 80 },
      { trade_date: '2026-10-10', close: 90 },
      { trade_date: '2026-11-08', close: 120 },
    ]);
    expect(r.lastClose).toBe(120);
    expect(r.lastDate).toBe('2026-11-08');
    expect(r.return1mPct).toBeCloseTo(50);
    expect(r.returnYtdPct).toBeCloseTo(20);
  });

  it('정렬되지 않은 입력도 처리', () => {
    const r = priceReturns([
      { trade_date: '2026-11-08', close: 110 },
      { trade_date: '2025-12-31', close: 100 },
    ]);
    expect(r.returnYtdPct).toBeCloseTo(10);
    expect(r.return1mPct).toBeCloseTo(10);
  });

  it('기준 종가가 없으면 null · 빈 입력', () => {
    expect(priceReturns([{ trade_date: '2026-11-08', close: 1 }]).returnYtdPct).toBeNull();
    expect(priceReturns([])).toEqual({
      lastClose: null,
      lastDate: null,
      return1mPct: null,
      returnYtdPct: null,
    });
  });
});
```

Run: `npx vitest run lib/customers/prices.test.ts` → FAIL

- [ ] **Step 7: 주가 등락 구현** — `lib/customers/prices.ts`:

```ts
import type { PricePoint, PriceReturns } from './types';

/** 'YYYY-MM-DD' 에서 한 달 뺀 날짜(말일은 그 달 말일로). UTC 로 만들고 UTC 로 읽는다 — 시간대 섞임 없음. */
function minusOneMonth(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return `${py}-${String(pm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

const pct = (now: number, base: number | undefined) =>
  base == null || base <= 0 ? null : ((now - base) / base) * 100;

/** 일봉 → 마지막 종가·1M·YTD. 기준일은 데이터의 마지막 거래일(오늘 시각을 쓰지 않는다). */
export function priceReturns(series: PricePoint[]): PriceReturns {
  if (series.length === 0)
    return { lastClose: null, lastDate: null, return1mPct: null, returnYtdPct: null };
  const s = [...series].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const last = s[s.length - 1];
  const earlier = s.slice(0, -1).reverse();
  const closeOnOrBefore = (cut: string) => earlier.find((p) => p.trade_date <= cut)?.close;
  return {
    lastClose: last.close,
    lastDate: last.trade_date,
    return1mPct: pct(last.close, closeOnOrBefore(minusOneMonth(last.trade_date))),
    returnYtdPct: pct(
      last.close,
      closeOnOrBefore(`${Number(last.trade_date.slice(0, 4)) - 1}-12-31`)
    ),
  };
}
```

Run: `npx vitest run lib/customers/prices.test.ts` → PASS

- [ ] **Step 8: 물량 어댑터 — 실패하는 시험** — `lib/customers/volume.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { aggregateMonthlySeries } from '@/lib/oem-companies/kg-mobility/aggregate';
import { groupMonthToSaleRows } from './volume';

describe('groupMonthToSaleRows', () => {
  const rows = [
    { oem_group: '다라그룹', year_month: 202501, sales: 100 },
    { oem_group: '다라그룹', year_month: 202601, sales: 120 },
    { oem_group: '마바그룹', year_month: 202601, sales: 999 },
  ];

  it('지정 그룹만 · YYYYMM → YYYY-MM · 월 행', () => {
    const out = groupMonthToSaleRows(rows, '다라그룹');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      period_type: 'month',
      year_period: '2025-01',
      sales_units: 100,
      resolved_powertrain: null,
    });
  });

  it('기존 KG 월 집계 함수에 그대로 들어간다(YoY)', () => {
    const series = aggregateMonthlySeries(groupMonthToSaleRows(rows, '다라그룹'));
    const jan26 = series.find((p) => p.period === '2026-01');
    expect(jan26?.sales).toBe(120);
    expect(jan26?.yoy_pct).toBeCloseTo(20);
  });
});
```

Run: `npx vitest run lib/customers/volume.test.ts` → FAIL

- [ ] **Step 9: 물량 어댑터 구현** — `lib/customers/volume.ts`:

```ts
import type { CompanySaleRowWithPt, OemSalesGroupMonth } from '@/lib/types';

/**
 * MarkLines 그룹 월 판매 → OEM 회사 탭 집계 함수(`kg-mobility/aggregate.ts`)의 입력 행.
 * 그룹 월 표엔 지역·차종·PT 가 없어 빈 값 → EV 비중은 계산하지 않는다(호출부가 null 로 덮는다).
 */
export function groupMonthToSaleRows(
  rows: OemSalesGroupMonth[],
  group: string
): CompanySaleRowWithPt[] {
  return rows
    .filter((r) => r.oem_group === group)
    .map((r) => {
      const s = String(r.year_month);
      return {
        period_type: 'month' as const,
        year_period: `${s.slice(0, 4)}-${s.slice(4, 6)}`,
        region: '',
        vehicle_model: '',
        vehicle_type: '',
        powertrain: null,
        sales_units: r.sales,
        source_url: null,
        resolved_powertrain: null,
      };
    });
}
```

Run: `npx vitest run lib/customers` → PASS(4개 파일). `aggregateMonthlySeries` 의 `period` 형식이 `'2026-01'` 이 아니면 `lib/oem-companies/kg-mobility/aggregate.ts:86-106` 을 읽고 **시험 기대값만** 실제 형식에 맞춘다(집계 함수는 고치지 않는다).

- [ ] **Step 10: Commit**

```bash
git add lib/customers/types.ts lib/customers/share.ts lib/customers/share.test.ts lib/customers/earnings.ts lib/customers/earnings.test.ts lib/customers/prices.ts lib/customers/prices.test.ts lib/customers/volume.ts lib/customers/volume.test.ts
git commit -m "feat(고객사): 매출 비중·실적·주가 등락·물량 순수 함수 + 시험"
```

---

### Task 5: 조회 계층 `lib/customers/source.ts`

**Files:**

- Create: `lib/customers/source.ts`
- Modify: `lib/pnl/source.ts:23-31`

**Interfaces:**

- Consumes: Task 4 의 4함수 · `fetchPnlEntries(): Promise<PnlEntry[]>` · `aggregateMonthlySeries`·`aggregateAnnualSeries`·`aggregateKpi`
- Produces:

```ts
export interface CustomerOverviewRow {
  company_id: string;
  slug: string;
  name_kr: string;
  ticker: string | null;
  currency: string;
  share: CustomerShare;
  share_group: string | null;
  share_group_peers: string[];
  price: PriceReturns;
  latestQuarter: CustomerEarningsPoint | null;
  earningsCurrency: string | null;
}
export interface CustomersOverview {
  windowLabel: string;
  rows: CustomerOverviewRow[];
}
export interface CustomerDetail {
  row: CustomerOverviewRow;
  country: string;
  windowLabel: string;
  earnings: CustomerEarnings;
  volume: {
    group: string | null;
    monthly: CompanyTimeSeriesPoint[];
    annual: CompanyTimeSeriesPoint[];
    kpi: CompanyKpiSummary | null;
  };
  oemTabPath: string | null;
}
export async function getCustomersOverview(): Promise<CustomersOverview>;
export async function getCustomerDetail(slug: string): Promise<CustomerDetail | null>;
```

- [ ] **Step 1: `fetchPnlEntries` 공개** — `lib/pnl/source.ts` 의 `async function fetchPnlEntries()` 앞에 `export`. JSDoc 「외부는 `getPreparedPnl()`만 호출한다」 다음 줄에 「예외: 고객사 매출 비중(`lib/customers/source.ts`)이 raw 를 서버에서만 집계한다 — 결과(비중)만 화면에 넘긴다.」

- [ ] **Step 2: PK 확인** — `lib/database.types.ts` 와 마이그레이션에서 `financials`·`stock_prices`·`oem_sales_group_month` 의 PK 를 확인한다. 아래 코드는 `financials.id` · `stock_prices(company_id, trade_date)` · `oem_sales_group_month(oem_group, year_month)` 를 가정한다 — 다르면 `.order()` 를 PK 칸으로 바꾼다.

- [ ] **Step 3: source 작성** — `lib/customers/source.ts`:

```ts
/**
 * 고객사 페이지 조회 계층 — 명단(customer_accounts)·손익 매출이 사외비라 confidentialDb 로 읽는다.
 * 손익 raw 는 이 모듈 밖으로 나가지 않는다(비중·상위 품목만 반환).
 */
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import logger from '@/lib/logger';
import { currentYear } from '@/lib/currentYear';
import { confidentialDb } from '@/lib/supabase/confidential';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import { fetchPnlEntries } from '@/lib/pnl/source';
import {
  aggregateAnnualSeries,
  aggregateKpi,
  aggregateMonthlySeries,
} from '@/lib/oem-companies/kg-mobility/aggregate';
import type { CompanyKpiSummary, CompanyTimeSeriesPoint, OemSalesGroupMonth } from '@/lib/types';
import { computeShares } from './share';
import { buildEarnings } from './earnings';
import { priceReturns } from './prices';
import { groupMonthToSaleRows } from './volume';
import type {
  CustomerEarnings,
  CustomerEarningsPoint,
  CustomerShare,
  FinancialPeriodRow,
  PricePoint,
  PriceReturns,
} from './types';

const PAGE = 1000;

// ↓ 위 Interfaces 블록의 CustomerOverviewRow·CustomersOverview·CustomerDetail 를 그대로 여기에 export 한다.

interface AccountRow {
  company_id: string;
  slug: string;
  display_order: number;
  pnl_customers: string[];
  share_group: string | null;
  marklines_group: string | null;
  oem_tab_path: string | null;
}

async function fetchAccounts(): Promise<AccountRow[]> {
  const { data, error } = await confidentialDb
    .from('customer_accounts')
    .select('company_id,slug,display_order,pnl_customers,share_group,marklines_group,oem_tab_path')
    .order('display_order', { ascending: true });
  if (error) {
    logger.error({ err: error }, 'customer_accounts 조회 실패');
    throw new Error(`customer_accounts 조회 실패: ${error.message}`);
  }
  return data ?? [];
}

async function fetchCompanies(ids: string[]) {
  const sb = createSupabaseAnonClient();
  const { data, error } = await sb
    .from('companies')
    .select('id,name_kr,name,ticker,currency,country')
    .in('id', ids)
    .eq('status', 'active');
  if (error) throw new Error(`companies 조회 실패: ${error.message}`);
  return new Map((data ?? []).map((c) => [c.id, c]));
}

async function fetchFinancials(ids: string[]): Promise<Map<string, FinancialPeriodRow[]>> {
  const sb = createSupabaseAnonClient();
  const out = new Map<string, FinancialPeriodRow[]>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('financials')
      .select(
        'id,company_id,fiscal_year,fiscal_quarter,period_type,period_end_date,currency,revenue,operating_income,operating_margin,net_income'
      )
      .in('company_id', ids)
      .gte('fiscal_year', currentYear() - 3)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`financials 조회 실패: ${error.message}`);
    for (const r of data ?? []) {
      const list = out.get(r.company_id) ?? [];
      list.push(r);
      out.set(r.company_id, list);
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function fetchPrices(ids: string[]): Promise<Map<string, PricePoint[]>> {
  const sb = createSupabaseAnonClient();
  // 전년 12월부터면 YTD 기준(전년 마지막 거래일)·1M 기준이 모두 들어온다.
  const since = `${currentYear() - 1}-12-01`;
  const out = new Map<string, PricePoint[]>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('stock_prices')
      .select('company_id,trade_date,close')
      .in('company_id', ids)
      .gte('trade_date', since)
      .order('company_id', { ascending: true })
      .order('trade_date', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`stock_prices 조회 실패: ${error.message}`);
    for (const r of data ?? []) {
      const list = out.get(r.company_id) ?? [];
      list.push({ trade_date: r.trade_date, close: Number(r.close) });
      out.set(r.company_id, list);
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function computeShareResult(accounts: AccountRow[]) {
  const pnl = await fetchPnlEntries();
  const rows = pnl
    .filter(
      (r) => r.basis === 'consolidated' && !r.is_plan && r.period_month >= 1 && r.period_month <= 12
    )
    .map((r) => ({
      customer: r.customer,
      product: r.product,
      period_year: r.period_year,
      period_month: r.period_month,
      revenue: r.revenue,
    }));
  return computeShares(rows, accounts);
}

interface BuiltRow {
  account: AccountRow;
  country: string;
  earnings: CustomerEarnings;
  row: CustomerOverviewRow;
}

async function buildRows(
  accounts: AccountRow[]
): Promise<{ rows: BuiltRow[]; windowLabel: string }> {
  const ids = accounts.map((a) => a.company_id);
  const [companies, financials, prices, shares] = await Promise.all([
    fetchCompanies(ids),
    fetchFinancials(ids),
    fetchPrices(ids),
    computeShareResult(accounts),
  ]);
  const rows: BuiltRow[] = [];
  for (const a of accounts) {
    const c = companies.get(a.company_id);
    if (!c) continue; // hidden·병합된 회사는 명단에 남아도 화면에서 뺀다
    const earnings = buildEarnings(financials.get(a.company_id) ?? []);
    const latestQuarter =
      [...earnings.quarterly].reverse().find((p) => p.revenue_bn != null) ?? null;
    rows.push({
      account: a,
      country: c.country ?? '',
      earnings,
      row: {
        company_id: a.company_id,
        slug: a.slug,
        name_kr: c.name_kr ?? c.name,
        ticker: c.ticker,
        currency: c.currency,
        share: shares.byCompany[a.company_id] ?? { sharePct: null, topProducts: [] },
        share_group: a.share_group,
        share_group_peers: [],
        price: priceReturns(prices.get(a.company_id) ?? []),
        latestQuarter,
        earningsCurrency: earnings.currency,
      },
    });
  }
  // 합산 그룹 동료 이름 — 명단은 DB 에서만 온다(코드에 고객명 없음).
  for (const x of rows) {
    if (!x.row.share_group) continue;
    x.row.share_group_peers = rows
      .filter((y) => y !== x && y.row.share_group === x.row.share_group)
      .map((y) => y.row.name_kr);
  }
  return { rows, windowLabel: shares.windowLabel };
}

export async function getCustomersOverview(): Promise<CustomersOverview> {
  'use cache';
  cacheLife('days');
  cacheTag('customer_accounts');
  cacheTag('pnl_entries');
  cacheTag('financials');
  cacheTag('stock_prices');
  cacheTag('companies');
  const { rows, windowLabel } = await buildRows(await fetchAccounts());
  return { windowLabel, rows: rows.map((x) => x.row) };
}

async function fetchGroupMonth(group: string): Promise<OemSalesGroupMonth[]> {
  const sb = createSupabaseAnonClient();
  const out: OemSalesGroupMonth[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('oem_sales_group_month')
      .select('oem_group,year_month,sales')
      .eq('oem_group', group)
      .order('oem_group', { ascending: true })
      .order('year_month', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`oem_sales_group_month 조회 실패: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function getCustomerDetail(slug: string): Promise<CustomerDetail | null> {
  'use cache';
  cacheLife('days');
  cacheTag('customer_accounts');
  cacheTag('pnl_entries');
  cacheTag('financials');
  cacheTag('stock_prices');
  cacheTag('companies');
  cacheTag('oem_sales_group_month');
  const accounts = await fetchAccounts();
  if (!accounts.some((a) => a.slug === slug)) return null;
  // 비중 분모·합산 동료 이름이 전체 명단에 걸려 있어 전체로 계산하고 하나를 고른다.
  const { rows, windowLabel } = await buildRows(accounts);
  const hit = rows.find((x) => x.row.slug === slug);
  if (!hit) return null;

  const group = hit.account.marklines_group;
  let volume: CustomerDetail['volume'] = { group, monthly: [], annual: [], kpi: null };
  if (group) {
    const saleRows = groupMonthToSaleRows(await fetchGroupMonth(group), group);
    volume = {
      group,
      monthly: aggregateMonthlySeries(saleRows),
      annual: aggregateAnnualSeries(saleRows),
      // 그룹 월 표엔 PT 가 없어 EV 비중을 계산하지 않는다(카드에 「—」).
      kpi: { ...aggregateKpi(saleRows), evRatio: null },
    };
  }
  return {
    row: hit.row,
    country: hit.country,
    windowLabel,
    earnings: hit.earnings,
    volume,
    oemTabPath: hit.account.oem_tab_path,
  };
}
```

- [ ] **Step 4: 검사**

Run: `npm run typecheck` → PASS
Run: `scripts/venv/Scripts/python.exe scripts/verify_revalidate_tags.py; echo "EXIT=$?"` → `EXIT=0`

- [ ] **Step 5: Commit**

```bash
git add lib/customers/source.ts lib/pnl/source.ts
git commit -m "feat(고객사): 조회 계층 — 매출 비중·실적·주가·MarkLines 판매"
```

---

### Task 6: 실적 콤보 차트에 선택 인자 (현대 화면 동작 불변)

**Files:**

- Create: `components/oem-companies/common/revenueFormat.ts`
- Modify: `components/oem-companies/hyundai/HyundaiQuarterlyEarningsChart.tsx` · `HyundaiQuarterlyEarningsChartInner.tsx` · `HyundaiAnnualEarningsChartInner.tsx`

**Interfaces:**

- Consumes: `CustomerEarningsPoint`(Task 4)
- Produces: 래퍼 선택 props — `revenueKey?: 'revenue_krw_bn' | 'revenue_bn'`(기본 `'revenue_krw_bn'`) · `currency?: string`(기본 `'KRW'`) · `allowNegativeMargin?: boolean`(기본 false) · `titleLabel?: string`(기본 `'IR 실적'`) · `sourceNote?: string`(기본 = 현재 hyundai.com 문구). `data`·`annual` 타입은 `HyundaiQuarterlyEarningsPoint[] | CustomerEarningsPoint[]`·`HyundaiAnnualEarningsPoint[] | CustomerEarningsPoint[]`.

🔴 서버 컴포넌트 → 클라이언트 컴포넌트로 함수를 넘길 수 없다(직렬화 불가). 그래서 포맷 함수가 아니라 `currency` 문자열을 넘기고 Inner 가 `revenueFormat(currency)` 로 고른다.

- [ ] **Step 0: 변경 전 스크린샷** — `npm run dev` 상태에서 `/oem/hyundai` 실적 차트(분기·연간 두 장)를 헤드리스로 찍어 둔다(Task 8 비교용 · 산출물 위치는 `docs/gotchas-playwright-ui.md`).

- [ ] **Step 1: 포맷 모듈** — `components/oem-companies/common/revenueFormat.ts`:

```ts
/**
 * 실적 콤보 차트의 매출(십억 단위 입력) 표기 — 통화별.
 * KRW 는 현대 IR 차트의 기존 표기(조원)를 그대로 옮긴 것이다(기본값 = 변경 전 동작).
 */
export interface RevenueFormat {
  axisLabel: string;
  tick: (n: number) => string;
  label: (value: unknown) => string;
  tooltip: (v: number) => string;
}

function labelOf(value: unknown, f: (n: number) => string): string {
  if (value == null) return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  return f(n);
}

export function revenueFormat(currency: string): RevenueFormat {
  if (currency === 'KRW') {
    return {
      axisLabel: '매출(조원)',
      tick: (n) => `${(n / 1000).toFixed(0)}조`,
      label: (value) => labelOf(value, (n) => `${(n / 1000).toFixed(1)}조`),
      tooltip: (v) => `${v.toLocaleString('ko-KR')} 십억원 (≈${(v / 1000).toFixed(1)}조원)`,
    };
  }
  return {
    axisLabel: `매출(${currency} bn)`,
    tick: (n) => n.toLocaleString('en-US', { maximumFractionDigits: 0 }),
    label: (value) =>
      labelOf(value, (n) => n.toLocaleString('en-US', { maximumFractionDigits: 1 })),
    tooltip: (v) => `${v.toLocaleString('en-US', { maximumFractionDigits: 2 })} bn ${currency}`,
  };
}
```

vitest include 가 `lib/**/*.test.ts` 뿐이라 이 파일 시험은 안 돈다 → 「동작 불변」 은 Step 0 스크린샷과 Task 8 비교로 확인한다. KRW 갈래의 문자열은 기존 Inner 의 `fmtRevenueTick`·`fmtRevenueLabel`·툴팁과 글자 하나까지 같아야 한다 — 옮긴 뒤 `git diff` 로 대조.

- [ ] **Step 2: 분기 Inner** — `HyundaiQuarterlyEarningsChartInner.tsx`:

1. `fmtRevenueTick`·`fmtRevenueLabel` 삭제(포맷 모듈로 옮김). `fmtOpmTick` 은 그대로.
2. Props:

```ts
interface Props {
  data: HyundaiQuarterlyEarningsPoint[] | CustomerEarningsPoint[];
  /** 매출 막대 칸 — 현대 IR = revenue_krw_bn, 고객사(financials) = revenue_bn. 둘 다 십억 단위. */
  revenueKey?: 'revenue_krw_bn' | 'revenue_bn';
  /** 매출 표기 통화(기본 KRW = 조원 표기). */
  currency?: string;
  /** 영업이익률 축을 음수까지 연다(적자 회사). 기본 false = 0 부터. */
  allowNegativeMargin?: boolean;
}
```

3. 시그니처 `({ data, revenueKey = 'revenue_krw_bn', currency = 'KRW', allowNegativeMargin = false }: Props)`, 본문 첫 줄 `const fmt = revenueFormat(currency);`
4. 바꿀 자리: 왼쪽 YAxis `tickFormatter={fmt.tick}`·`label.value: fmt.axisLabel` / 오른쪽 YAxis `domain={allowNegativeMargin ? ['auto', 'auto'] : [0, 'auto']}` / 툴팁 매출 갈래 `return [fmt.tooltip(v), '매출'];` / `<Bar dataKey={revenueKey} ... hide={isHidden(revenueKey)}>` / `<LabelList dataKey={revenueKey} formatter={fmt.label} .../>`
5. import: `import type { CustomerEarningsPoint } from '@/lib/customers/types';` · `import { revenueFormat } from '../common/revenueFormat';`

- [ ] **Step 3: 연간 Inner** — Step 2 의 1~5 를 `HyundaiAnnualEarningsChartInner.tsx` 에 같게 적용. 다른 점:
- `data` 타입 `HyundaiAnnualEarningsPoint[] | CustomerEarningsPoint[]`
- 툴팁 `payload` 캐스트를 `item?.payload as { is_ytd?: boolean; quarters_used?: number } | undefined` 로 넓힌다(고객사 점엔 YTD 칸이 없어 접미사가 빈 문자열)
- 매출 툴팁 ``return [`${fmt.tooltip(v)}${ytdSuffix}`, '매출'];``

- [ ] **Step 4: 래퍼** — `HyundaiQuarterlyEarningsChart.tsx`:

```ts
interface Props {
  data: HyundaiQuarterlyEarningsPoint[] | CustomerEarningsPoint[];
  annual: HyundaiAnnualEarningsPoint[] | CustomerEarningsPoint[];
  revenueKey?: 'revenue_krw_bn' | 'revenue_bn';
  currency?: string;
  allowNegativeMargin?: boolean;
  /** 제목 가운데 말(기본 'IR 실적' → 「분기별 IR 실적 (매출 + 영업이익률)」). */
  titleLabel?: string;
  /** 출처 문구 앞부분(기본 = hyundai.com IR 문구). */
  sourceNote?: string;
}
```

- 기본값 `titleLabel = 'IR 실적'` · `sourceNote = 'hyundai.com IR · 분기별 실적 발표 자료(PDF)'`(가운뎃점은 `&middot;` 렌더 결과와 같은 U+00B7).
- 제목 `{mode === 'quarter' ? '분기별' : '연간'} {titleLabel} (매출 + 영업이익률)`.
- 출처 줄 `출처: {sourceNote} &middot;{' '}` 다음은 기존 그대로, 단 분기 문구는 `currency === 'KRW' ? '매출 단위: 조원, 영업이익률(%)' : \`매출 단위: ${currency} bn, 영업이익률(%)\``.
- Inner 두 곳에 `revenueKey={revenueKey} currency={currency} allowNegativeMargin={allowNegativeMargin}`.

- [ ] **Step 5: 검사·커밋**

Run: `npm run typecheck` → PASS · `npm run lint` → PASS

```bash
git add components/oem-companies/common/revenueFormat.ts components/oem-companies/hyundai/HyundaiQuarterlyEarningsChart.tsx components/oem-companies/hyundai/HyundaiQuarterlyEarningsChartInner.tsx components/oem-companies/hyundai/HyundaiAnnualEarningsChartInner.tsx
git commit -m "refactor(차트): 실적 콤보에 통화·매출 칸·음수 마진 선택 인자 — 기본값은 기존 동작"
```

---

### Task 7: 화면 — 요약 표 · 실적 표 · 두 페이지

**Files:**

- Create: `components/customers/CustomersOverviewTable.tsx` · `components/customers/CustomerEarningsTable.tsx` · `app/customers/page.tsx` · `app/customers/[slug]/page.tsx`
- Modify: `Architecture.md` 부록 C

**Interfaces:**

- Consumes: `getCustomersOverview`·`getCustomerDetail`·`CustomerOverviewRow`(Task 5) · 래퍼 선택 인자(Task 6) · `CompanyKpiCards({kpi})` · `CompanyTimeSeriesChart({monthly, annual, title?})` · `PopupNewsSection({companyId, companyName, ticker, country})`

- [ ] **Step 1: 요약 표(client)** — `components/customers/CustomersOverviewTable.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { CustomerOverviewRow } from '@/lib/customers/source';

const TD = 'px-3 py-2 whitespace-nowrap';
const NUM = `${TD} text-right tabular-nums`;

function pctText(v: number | null, signed = true): string {
  if (v == null) return '—';
  return `${signed && v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}
function pctClass(v: number | null): string {
  if (v == null || v === 0) return 'text-muted-foreground';
  return v > 0 ? 'text-emerald-600' : 'text-rose-600';
}

interface Props {
  rows: CustomerOverviewRow[];
  windowLabel: string;
}

export default function CustomersOverviewTable({ rows, windowLabel }: Props) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className={`${TD} text-left`}>고객사</th>
            <th className={`${TD} text-right`}>
              우리 매출 비중
              {windowLabel && <span className="block font-normal">{windowLabel} · 연결</span>}
            </th>
            <th className={`${TD} text-right`}>종가</th>
            <th className={`${TD} text-right`}>1개월</th>
            <th className={`${TD} text-right`}>연초 대비</th>
            <th className={`${TD} text-right`}>최근 분기</th>
            <th className={`${TD} text-right`}>매출 YoY</th>
            <th className={`${TD} text-right`}>영업이익률</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const q = r.latestQuarter;
            return (
              <tr key={r.company_id} className="border-t border-border hover:bg-muted/30">
                <td className={TD}>
                  <Link href={`/customers/${r.slug}`} className="font-medium hover:underline">
                    {r.name_kr}
                  </Link>
                  {r.ticker && (
                    <span className="ml-2 text-xs text-muted-foreground">{r.ticker}</span>
                  )}
                </td>
                <td className={NUM}>
                  {r.share.sharePct == null ? (
                    <span className="text-muted-foreground">해당 없음</span>
                  ) : (
                    <span
                      title={
                        r.share_group
                          ? `합산: ${[r.name_kr, ...r.share_group_peers].join('·')}`
                          : undefined
                      }
                    >
                      {r.share.sharePct.toFixed(1)}%
                      {r.share_group && (
                        <span className="ml-1 rounded bg-muted px-1 text-[11px] text-muted-foreground">
                          합산
                        </span>
                      )}
                    </span>
                  )}
                </td>
                <td className={NUM}>
                  {r.price.lastClose == null
                    ? '—'
                    : `${r.price.lastClose.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${r.currency}`}
                </td>
                <td className={cn(NUM, pctClass(r.price.return1mPct))}>
                  {pctText(r.price.return1mPct)}
                </td>
                <td className={cn(NUM, pctClass(r.price.returnYtdPct))}>
                  {pctText(r.price.returnYtdPct)}
                </td>
                <td className={NUM}>{q?.period_label ?? '—'}</td>
                <td className={cn(NUM, pctClass(q?.revenue_yoy_pct ?? null))}>
                  {pctText(q?.revenue_yoy_pct ?? null)}
                </td>
                <td className={cn(NUM, pctClass(q?.operating_margin_pct ?? null))}>
                  {pctText(q?.operating_margin_pct ?? null, false)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

`'use client'` 파일이 `@/lib/customers/source`(server-only)에서 **타입만** 가져오므로 `import type` 이어야 한다(값 import 면 빌드가 깨진다). AGENTS 「표 행 클릭 강조는 `useRowHighlight`」 — 이 표는 행 클릭 동작 없이 회사명 링크만 있어 해당 없음(보고에 적는다).

- [ ] **Step 2: 실적 표(client)** — `components/customers/CustomerEarningsTable.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { CustomerEarnings } from '@/lib/customers/types';

const TD = 'px-3 py-1.5 whitespace-nowrap text-right tabular-nums';
const num = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 1 });
const pct = (v: number | null, signed = false) =>
  v == null ? '—' : `${signed && v > 0 ? '+' : ''}${v.toFixed(1)}%`;
const tone = (v: number | null) =>
  v == null || v === 0 ? '' : v > 0 ? 'text-emerald-600' : 'text-rose-600';

export default function CustomerEarningsTable({ earnings }: { earnings: CustomerEarnings }) {
  const [mode, setMode] = useState<'quarter' | 'annual'>('quarter');
  if (!earnings.currency) return <p className="text-sm text-muted-foreground">재무 데이터 없음</p>;
  const rows = [...(mode === 'quarter' ? earnings.quarterly : earnings.annual)].reverse();
  const unit = earnings.currency === 'KRW' ? '십억원' : `${earnings.currency} 십억(bn)`;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {/* SHORTCUT: 출처를 일반 표기 → financials.source 를 행별로 실으면 정확해진다 */}
        <span>단위: {unit} · 출처: financials(yfinance·DART)</span>
        <div role="tablist" aria-label="실적 기간 단위" className="flex gap-1">
          {(['quarter', 'annual'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              type="button"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                'rounded-md border px-3 py-1',
                mode === m
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border hover:bg-muted'
              )}
            >
              {m === 'quarter' ? '분기' : '연간'}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left">기간</th>
              <th className={TD}>매출</th>
              <th className={TD}>매출 YoY</th>
              <th className={TD}>영업이익</th>
              <th className={TD}>영업이익률</th>
              <th className={TD}>순이익</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.period_label} className="border-t border-border">
                <td className="px-3 py-1.5 text-left">{p.period_label}</td>
                <td className={TD}>{num(p.revenue_bn)}</td>
                <td className={cn(TD, tone(p.revenue_yoy_pct))}>{pct(p.revenue_yoy_pct, true)}</td>
                <td className={cn(TD, tone(p.operating_income_bn))}>
                  {num(p.operating_income_bn)}
                </td>
                <td className={cn(TD, tone(p.operating_margin_pct))}>
                  {pct(p.operating_margin_pct)}
                </td>
                <td className={cn(TD, tone(p.net_income_bn))}>{num(p.net_income_bn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 요약 페이지** — `app/customers/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import CustomersOverviewTable from '@/components/customers/CustomersOverviewTable';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canAccess } from '@/lib/auth/permissions';
import { getCustomersOverview } from '@/lib/customers/source';

export default async function CustomersPage() {
  // proxy.ts 가 먼저 막지만, 사외비 조회 전에 페이지에서도 한 번 더 막는다(app/hansae 와 같은 패턴).
  const user = await getCurrentUser();
  if (!user || !canAccess('/customers', user.role)) redirect('/');
  const { rows, windowLabel } = await getCustomersOverview();
  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">고객사</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          상장 고객사 요약 · 우리 매출 비중(손익 연결 최근 12개월) · 주가 · 최근 분기 실적(현지
          통화) · 사외비
        </p>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <CustomersOverviewTable rows={rows} windowLabel={windowLabel} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 개별 페이지** — `app/customers/[slug]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import HyundaiQuarterlyEarningsChart from '@/components/oem-companies/hyundai/HyundaiQuarterlyEarningsChart';
import CompanyKpiCards from '@/components/oem-companies/common/CompanyKpiCards';
import CompanyTimeSeriesChart from '@/components/oem-companies/common/CompanyTimeSeriesChart';
import PopupNewsSection from '@/components/stock-popup/PopupNewsSection';
import CustomerEarningsTable from '@/components/customers/CustomerEarningsTable';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canAccess } from '@/lib/auth/permissions';
import { getCustomerDetail } from '@/lib/customers/source';

/** Cache Components 는 dynamic route 에 generateStaticParams 결과를 최소 1개 요구한다(app/stock-popup/[id] 와 같은 방식). */
export async function generateStaticParams() {
  return [{ slug: '_' }];
}

export default async function CustomerPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user || !canAccess('/customers', user.role)) redirect('/');
  const { slug } = await params;
  const d = await getCustomerDetail(slug);
  if (!d) notFound();
  const { row, earnings, volume } = d;
  const shareText = row.share.sharePct == null ? '해당 없음' : `${row.share.sharePct.toFixed(1)}%`;
  const shareScope = d.windowLabel
    ? ` (${d.windowLabel} · 연결${row.share_group ? ` · ${[row.name_kr, ...row.share_group_peers].join('·')} 합산` : ''})`
    : '';
  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <Link href="/customers" className="text-xs text-muted-foreground hover:underline">
          ← 고객사
        </Link>
        <h1 className="text-lg font-semibold">
          {row.name_kr}{' '}
          {row.ticker && <span className="text-sm text-muted-foreground">{row.ticker}</span>}
        </h1>
        <p className="text-sm tabular-nums mt-0.5">
          {row.price.lastClose == null
            ? '주가 —'
            : `${row.price.lastClose.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${row.currency} · 1개월 ${
                row.price.return1mPct == null ? '—' : `${row.price.return1mPct.toFixed(1)}%`
              } · 연초 대비 ${row.price.returnYtdPct == null ? '—' : `${row.price.returnYtdPct.toFixed(1)}%`} (${row.price.lastDate})`}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          우리 매출 비중 {shareText}
          {shareScope}
          {row.share.topProducts.length > 0 && ` · 공급 품목 ${row.share.topProducts.join(', ')}`}
        </p>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-6">
        <section className="space-y-3">
          <h2 className="text-base font-semibold">실적</h2>
          {earnings.currency && (
            <HyundaiQuarterlyEarningsChart
              data={earnings.quarterly}
              annual={earnings.annual}
              revenueKey="revenue_bn"
              currency={earnings.currency}
              allowNegativeMargin
              titleLabel="실적"
              sourceNote="financials(yfinance·DART) · 현지 통화"
            />
          )}
          <CustomerEarningsTable earnings={earnings} />
        </section>
        <section className="space-y-3">
          <h2 className="text-base font-semibold">물량 (MarkLines 판매)</h2>
          {volume.group && volume.kpi ? (
            <>
              <p className="text-xs text-muted-foreground">
                MarkLines 그룹 「{volume.group}」 전체 판매 — 그룹 단위라 계열 브랜드가 함께 잡힌다.
              </p>
              <CompanyKpiCards kpi={volume.kpi} />
              <CompanyTimeSeriesChart
                monthly={volume.monthly}
                annual={volume.annual}
                title="MarkLines 그룹 판매"
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">MarkLines 에 이 회사 단독 그룹이 없다.</p>
          )}
          {d.oemTabPath && (
            <Link href={d.oemTabPath} className="text-sm text-primary hover:underline">
              회사 발표 판매·출하 상세 → OEM 탭
            </Link>
          )}
        </section>
        <section className="space-y-3">
          <h2 className="text-base font-semibold">최근 뉴스</h2>
          <PopupNewsSection
            companyId={row.company_id}
            companyName={row.name_kr}
            ticker={row.ticker ?? ''}
            country={d.country}
          />
        </section>
      </div>
    </div>
  );
}
```

착수 시 `components/stock-popup/PopupNewsSection.tsx` 50~90줄을 읽어 `ticker` 빈 문자열이 안전한지 확인(안 되면 `row.ticker &&` 로 감싼다).

- [ ] **Step 5: 빌드** — Run: `npm run build`. 「Uncached data was accessed outside of `<Suspense>`」 가 `/customers` 에서 나면 `app/stock-popup/[id]/page.tsx` 처럼 본문을 `<Suspense>` 로 감싼 하위 async 컴포넌트로 옮긴다(권한 판정도 그 안으로). 다른 라우트 오류면 내 변경 탓인지 오류 경로로 판단해 보고.

- [ ] **Step 6: Architecture.md 부록 C** — `lib/` 절에 `lib/customers/`「고객사 페이지 조회·계산(손익·명단은 `confidentialDb`, 결과만 반환)」, `components/` 절에 `components/customers/`「고객사 요약·실적 표」 한 줄씩.

- [ ] **Step 7: Commit**

```bash
git add components/customers/CustomersOverviewTable.tsx components/customers/CustomerEarningsTable.tsx app/customers/page.tsx "app/customers/[slug]/page.tsx" Architecture.md
git commit -m "feat(고객사): /customers 요약·개별 화면 — 매출 비중·실적·MarkLines 판매·뉴스"
```

---

### Task 8: 검증 · 화면 확인 · 문서 마무리

**Files:**

- Modify: `docs/plans/2026-11-09-customers-page_결정이행.md`(+ 원본 `참고/고객사/` 같은 파일) · `docs/plans/2026-11-09-customers-page.md` 「미확인」 절

- [ ] **Step 1: 통합 검사**

Run: `npm run check-all 2>&1 | tail -15; echo "EXIT=${PIPESTATUS[0]}"` → `EXIT=0`. `.next/dev/types` 구문 오류면 `docs/gotchas-playwright-ui.md` 「dev 생성 타입 파일 꼬리 중복」 절대로.
Run: `scripts/venv/Scripts/python.exe scripts/verify_revalidate_tags.py; echo "EXIT=$?"` → `EXIT=0`

- [ ] **Step 2: 화면 확인(헤드리스)** — `docs/gotchas-playwright-ui.md` 를 먼저 읽고 `npm run dev` → `~/.claude/scripts/headless_check.py`:

1. mobility 로그인 → `/customers` 표 11행 · 비중 열 · 1M·YTD 색 · 「합산」 배지·「해당 없음」 개수가 원본 매핑과 같은지
2. 개별 화면 3곳 — 원화 회사 1 · 해외 적자 회사 1(음수 마진이 0 아래로) · MarkLines 그룹 없는 회사 1(안내 문구)
3. `/oem/hyundai` 실적 차트가 Task 6 Step 0 스크린샷과 같은지(제목·축 「매출(조원)」·막대 라벨·출처 문구)
4. guest·hmobility 로 `/customers`·`/customers/<slug>` → `/` 로 돌아가는지 · 사이드바에 「고객사」 가 없는지
5. 사이드바 「비교」 바로 아래 「고객사」

- [ ] **Step 3: 사외비 누출 점검** — 이번 단계 커밋 전체의 diff 를 스크래치 파일로 뽑아 원본 `참고/고객사/` 의 손익 고객명·고객사명 목록으로 `grep -c` → 0건. 검사기 자가 시험: 같은 grep 을 원본 파일에 돌려 1건 이상(0이면 검사기가 죽은 것).

- [ ] **Step 4: 결정이행 표에 덧붙임**(공개 판·원본 둘 다, 공개 판엔 고객명·수치 없이)
- 「1단계 — 기존 OEM 회사 탭 판매·출하 표: 복제하지 않고 `oem_tab_path` 링크로 이음 · 구조 선택 → 2026-11-09 사용자 승인(선택 3차)」
- 「매출 비중 기준: 연결 · 최신월 앵커 12개월 · 0월 제외 · 2026-11-09 사용자 승인(선택 3차)」

설계서 「미확인」 절의 `pnl_entries.basis` 줄은 「확정 — 위 기준(2026-11-09)」 으로 바꾼다.

- [ ] **Step 5: 사용자 화면 확인 요청** — 1단계 완료 정의(설계서 「단계별 범위」)대로 화면을 보여 주고 2단계 진행 승인을 받는다. 승인 전 2단계 착수 금지(결정 10).

- [ ] **Step 6: Commit(문서)**

```bash
git add docs/plans/2026-11-09-customers-page_결정이행.md docs/plans/2026-11-09-customers-page.md
git commit -m "docs(고객사): 1단계 결정 이행·실측 기본값 기록"
```
