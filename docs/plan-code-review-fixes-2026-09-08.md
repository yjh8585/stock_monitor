# 코드리뷰 지적 수정 계획 (2026-09-08)

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (권장) 또는 `superpowers:executing-plans` 로 task 단위 실행. 각 단계는 체크박스(`- [ ]`)로 추적한다.

**Goal:** 2026-09-08 전수 코드리뷰(`lib/` · `scripts/lib/` · `app/api/`, 196파일/37,562줄)에서 확인된 상위 3군 — ①역할 권한 게이트 누락 ②화면에 틀린 값이 나오는 결함 4건 ③`npm run check-all` 중단 — 을 고친다.

**Architecture:** 권한은 라우트마다 손으로 메우는 대신 `lib/auth/permissions.ts` 한 곳에 판정 함수를 두고 각 API 가 그것을 부른다(게이트 SSOT). 값 오류는 순수 함수로 뽑아 vitest 회귀 테스트를 먼저 쓰고 고친다. 검사 파이프라인 복구는 코드 변경이 아니라 git 추적 해제다.

**Tech Stack:** Next.js 16.2.4 (App Router · `cacheComponents`) · TypeScript 5 · Vitest (node 환경, `lib/**/*.test.ts`) · Supabase(PostgREST) · `proxy.ts` 미들웨어

## 사용자 지시 원문

> 주어진 스킬과 서브에이전트 등 최대한 활용하여 코드리뷰를 실시해

> 계획서를 쓰고 순서대로 작업해

**AskUserQuestion 결정 (2026-09-08):**

| 질문                                                                               | 사용자 선택                                      |
| ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| 리뷰 범위 / 강도                                                                   | 핵심 모듈 전수 감사 · max                        |
| 보고서 게시(`/reports/new`·`POST /api/posts`·`POST /api/uploads/report`) 허용 역할 | **admin + holdings + mobility**                  |
| `scripts/dart_eval/` 진단 JSON 9개                                                 | **추적 해제** (`.gitignore` + `git rm --cached`) |
| 작업 범위                                                                          | **상위 3군 먼저** (권한 / 값 오류 / check-all)   |
| 손익 연도 상한 처리 (심문)                                                         | **현재 연도로 동적화** (상한 제거 아님)          |
| `lib/stockSort.ts` 연도 하드코딩 (심문 — 범위 밖 항목)                             | **같이 고친다**                                  |
| 스텔란티스 100배 검증 방법 (심문)                                                  | **순수 함수로 뽑아 테스트**                      |

## 심문(`grill-me`)에서 뒤집힌 것

초안을 그대로 실행했으면 틀렸을 지점들이다. **아래는 전부 실물 확인을 마쳤다.**

1. **초안의 테스트 코드가 실제 픽스처와 어긋났다.** stellantis-na 테스트 헬퍼는 `mkRow` 가 아니라 `row({period, brand, model, units})` 이고, 기간 형식은 `'2025Q1'` 이 아니라 **`'2025-Q1'`**(하이픈), 호출은 `withPt(rows)` 로 감싼다.
2. **`KpiMetric` 에 `.value` 필드는 없다** — `currentValue`·`priorValue`·`yoyPct`·`absChange`·`unit` 이다.
3. **`getDisplayYearLabels(entries, basis)`** 는 `PnlEntry[]` 를 받는다(초안은 `annualByBasis` 를 넘겼다).
4. **`app/reports/page.tsx` 는 이미 `getCurrentUser` 를 부른다**(103줄 `currentUser`). 캐시는 내부 `getPostsListData` 에만 걸려 있어 페이지에서 쿠키를 읽을 수 있다 — 새로 조회할 필요가 없다.
5. **`fail`·`NextResponse` 는 세 라우트에 이미 import 되어 있다**(각 파일 1~7줄). 추가 import 는 `getCurrentUser` 와 권한 함수뿐이다.
6. **`.order()` 누락의 실제 위험도를 행수로 쟀다** — 아래 Task 5 표. 9개 테이블이 실제로 여러 페이지를 돈다.

**전제 검증(뒤집히면 Task 4 가 무효가 되는 것):** `pnl_entries.revenue` 의 단위는 **백만원**이 맞다. 근거 셋 — 적재 엑셀 헤더가 「밸류(백만원)」(`scripts/sync_pnl_cost_structure.py:5`) · `lib/plan/aggregate.ts:158` 의 `metric: 'revenue' | 'op_income'` 을 `/100` · `lib/finance/pnl-derived.ts:16` 의 `MWON_TO_EOK = 100 // 백만원 → ÷100 = 억원`.

## Global Constraints

- 역할 명단 SSOT 는 `lib/auth/roles.ts` 의 `ROLES` — 5역할 `mobility`·`hmobility`·`guest`·`holdings`·`admin`. 새 역할을 만들지 않는다.
- **API 라우트의 권한 실패 응답은 403 JSON 이다.** `proxy.ts:30` 의 `canAccess` 실패는 `NextResponse.redirect` 라, API 에 적용하면 `fetch` 가 302 를 따라가 HTML 을 받고 `res.json()` 이 엉뚱한 파싱 오류를 낸다. 따라서 **API 게이트를 `canAccess`/`proxy.ts` 에 넣지 않고** 각 route handler 안에서 판정 함수를 부른다.
- 사용자 조회는 `getCurrentUser()` (`@/lib/auth/get-current-user`, `server-only`, 반환 `{ id, role, displayName } | null`).
- 파일 저장은 UTF-8(BOM 없음) + LF. 들여쓰기 2칸. 주석·커밋 메시지는 한국어.
- `git add` 는 **경로를 하나씩 명시**한다(`-A`·`.` 금지 — 이 워크트리는 여러 세션이 공유한다).
- 각 Task 끝에서 `npm run check-all` 이 통과해야 한다(Task 0 이후로는 4단계 전부 돈다).
- 기존 공개 시그니처를 바꾸지 않는다(`fetchAll` 의 내부 인자 추가는 예외 — 같은 파일 안에서만 쓰인다).
- **사외비 금액은 stdout·화면 캡처로 남기지 않는다.** Task 4 의 화면 확인은 「자릿수가 두 자리 줄었다」까지만 보고한다.
- 이번 범위 밖: `scripts/lib/` 지적(nhtsa·revalidate), 챗봇·인증·뉴스 라우트 지적, 부가 9건. HANDOFF 에 남긴다.

## File Structure

| 파일                                                                        | 이번 계획에서의 책임                                  |
| --------------------------------------------------------------------------- | ----------------------------------------------------- |
| `scripts/dart_eval/.gitignore`                                              | 진단 산출물 추적 해제 (Task 0)                        |
| `lib/auth/permissions.ts` · `permissions.test.ts`                           | 게시 권한 판정 `canPublishReports` 신설 (Task 1)      |
| `app/api/companies/route.ts` · `posts/route.ts` · `uploads/report/route.ts` | POST 에 역할 게이트 (Task 2)                          |
| `app/reports/new/page.tsx` · `app/reports/page.tsx`                         | 게시 화면 게이트 (Task 3)                             |
| `lib/stellantis-forecast/source.ts` · `aggregate.test.ts`                   | 백만원→억원 환산을 순수 함수로 분리 + 테스트 (Task 4) |
| `lib/oem/source.ts` · `lib/oem-companies/*/source.ts` 5개                   | 페이징 10곳에 결정적 정렬 (Task 5)                    |
| `lib/oem-companies/stellantis-na/aggregate.ts` · `aggregate.test.ts`        | 진행 중 연도 YoY 를 전년 동기로 (Task 6)              |
| `lib/pnl/aggregate.ts` · `lib/plan/aggregate.ts` · `lib/stockSort.ts`       | 연도 하드코딩 제거 (Task 7)                           |

---

## Task 0: `npm run check-all` 복구

**먼저 하는 이유:** `check-all` 은 `lint → format:check → typecheck → test` 순인데 지금 2단계 `format:check` 가 exit 1 로 끊겨 **typecheck·test 가 아예 실행되지 않는다.** 이후 Task 들의 「검사 통과」를 확인할 수단이 없으므로 이것부터 고친다. (사용자가 제시한 3군 순서에서 check-all 은 ③이지만, 검증 수단이라 앞으로 당긴다 — 결과물은 같고 순서만 바뀐다.)

**Files:** Modify `scripts/dart_eval/.gitignore` · Untrack `scripts/dart_eval/*.json` 9개

**Interfaces:** Consumes 없음 / Produces 이후 모든 Task 가 `check-all` 4단계를 완주할 수 있게 된다.

- [ ] **Step 1: 현재 실패를 눈으로 확인**

```bash
npm run format:check; echo "exit=$?"
```

Expected: `exit=1`, `scripts/dart_eval/` 의 10개 파일이 warn 으로 나열된다.

- [ ] **Step 2: 추적 대상을 먼저 본다**

```bash
git ls-files scripts/dart_eval/
cat scripts/dart_eval/.gitignore
```

Expected: JSON 9개가 추적 중이고 `.gitignore` 에 이들을 덮는 규칙이 없다. 파이썬 스크립트 8개와 테스트 2개는 **남겨야 한다**(`fetch_*.py`·`layer1_parse.py`·`probe_*.py`·`recon_*.py`·`scan_all.py`·`verify_rcpno_pair.py`·`test_*.py`).

- [ ] **Step 3: `.gitignore` 에 규칙 추가**

`scripts/dart_eval/.gitignore` 끝에 추가한다:

```gitignore
# 진단·탐침 산출물 — 재생성 가능하므로 추적하지 않는다 (AGENTS.md 「진단 산출물은 임시」).
# 계약·샘플로 남겨야 할 것이 생기면 파일명을 !예외로 적고 prettier 포맷을 맞출 것.
*.json
```

- [ ] **Step 4: 인덱스에서만 제거 (로컬 파일은 남긴다)**

```bash
git rm --cached scripts/dart_eval/fetch_opinion_last_run.json scripts/dart_eval/fetch_opinion_result.json scripts/dart_eval/layer1_sample_result.json scripts/dart_eval/major_2y.json scripts/dart_eval/probe_attachments_all.json scripts/dart_eval/q2_targets.json scripts/dart_eval/recon_sample_result.json scripts/dart_eval/scan_all_list.json scripts/dart_eval/verify_rcpno_pair_result.json
```

`--cached` 가 핵심이다. 디스크의 파일은 그대로 두고 git 추적만 끊는다.

- [ ] **Step 5: 남은 README 포맷을 맞춘다**

```bash
npx prettier --write scripts/dart_eval/README.md
```

- [ ] **Step 6: 검사가 4단계를 완주하는지 확인**

```bash
npm run check-all
```

Expected: PASS. **`format:check` 통과 후 `typecheck`·`test`(vitest 429건) 출력까지 나와야 한다.** 2단계에서 멈추면 실패다.

- [ ] **Step 7: 커밋**

```bash
git add scripts/dart_eval/.gitignore scripts/dart_eval/README.md
git add -u scripts/dart_eval
git status   # 스테이징 목록을 눈으로 확인 — dart_eval 밖의 파일이 섞이면 안 된다
git commit -m "fix(검사): dart_eval 진단 JSON 9개 추적 해제 — check-all 이 2단계에서 죽고 있었다

format:check 가 exit 1 이라 typecheck·test 가 아예 실행되지 않았다.
파일은 디스크에 남긴다(--cached)."
```

---

## Task 1: 게시 권한 판정 함수 신설

**Files:** Modify `lib/auth/permissions.ts` · Test `lib/auth/permissions.test.ts`

**Interfaces:**

- Consumes: `lib/auth/roles.ts` 의 `Role`·`ROLES`
- Produces: **`canPublishReports(role: Role): boolean`** — Task 2 의 세 라우트와 Task 3 의 두 화면이 부른다.

**왜 `canAccessConfidentialReports` 를 재사용하지 않는가:** 지금은 명단이 같지만(admin·holdings·mobility) 의미가 다르다. 하나는 _사외비 열람_, 하나는 *게시*다. 한쪽 명단이 바뀔 때 다른 쪽이 조용히 따라 바뀌면 안 되므로 별도 함수로 둔다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`lib/auth/permissions.test.ts` 파일 끝에 추가한다:

```typescript
describe('canPublishReports', () => {
  it('admin·holdings·mobility 는 게시할 수 있다', () => {
    expect(canPublishReports('admin')).toBe(true);
    expect(canPublishReports('holdings')).toBe(true);
    expect(canPublishReports('mobility')).toBe(true);
  });

  it('hmobility·guest 는 게시할 수 없다', () => {
    expect(canPublishReports('hmobility')).toBe(false);
    expect(canPublishReports('guest')).toBe(false);
  });
});
```

파일 상단 import 목록에 `canPublishReports` 를 더한다(기존 import 문 형태를 그대로 따른다).

- [ ] **Step 2: 실패를 확인한다**

```bash
npx vitest run lib/auth/permissions.test.ts
```

Expected: FAIL — `canPublishReports is not a function` 또는 TS 오류.

- [ ] **Step 3: 최소 구현**

`lib/auth/permissions.ts` 의 `canAccessConfidentialReports` 바로 아래에 추가한다:

```typescript
/**
 * 보고서 게시 권한 — `/reports/new` 화면과 게시 API 2종(`POST /api/posts`,
 * `POST /api/uploads/report`)의 공통 게이트.
 *
 * 사용자 결정(2026-09-08): admin·holdings·mobility 만 게시한다.
 * `canAccessConfidentialReports` 와 지금은 명단이 같지만 **의미가 다르므로**
 * (열람 vs 게시) 재사용하지 않는다 — 한쪽 명단 변경이 다른 쪽에 새면 안 된다.
 *
 * 화이트리스트로 적어 새 역할이 추가돼도 기본은 차단되게 한다.
 */
export function canPublishReports(role: Role): boolean {
  return role === 'admin' || role === 'holdings' || role === 'mobility';
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx vitest run lib/auth/permissions.test.ts
```

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add lib/auth/permissions.ts lib/auth/permissions.test.ts
git commit -m "feat(권한): 보고서 게시 판정 canPublishReports 신설 — admin·holdings·mobility"
```

---

## Task 2: API 라우트 3곳에 역할 게이트

**배경(실측):** `lib/auth/permissions.ts:79` 의 `canAccess` 는 `/api/*` 에 대해 `return true` 다. `proxy.ts` 의 세션 검사만 통과하면 **어떤 역할이든** API 를 부를 수 있다. 유일한 예외 `/api/management/org-chart` 의 주석이 이를 자백한다 — _"canAccess의 /management 분기는 '/api/...' 접두사를 매칭하지 못하므로 명시적으로 처리"_.

**Files:** Modify `app/api/companies/route.ts`(POST, 64줄) · `app/api/posts/route.ts`(POST, 40줄) · `app/api/uploads/report/route.ts`(POST, 16줄)

**Interfaces:** Consumes Task 1 의 `canPublishReports` · 기존 `isAdmin`(`permissions.ts:17`) · `getCurrentUser` / Produces 없음

**따를 기존 패턴:** `app/api/management/upload/route.ts:24-28` 이 이미 올바른 형태다. 그대로 흉내 낸다. **`fail`·`NextResponse` 는 세 파일에 이미 import 되어 있다**(확인 완료) — 추가할 import 는 아래 두 줄뿐이다.

- [ ] **Step 1: `/api/companies` POST 에 admin 게이트**

상단 import 에 추가한다:

```typescript
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { isAdmin } from '@/lib/auth/permissions';
```

`export async function POST(req: Request) {` **바로 다음 줄**에 삽입한다:

```typescript
// 회사 마스터 INSERT + GHA workflow_dispatch — 화면(/management/companies)이
// ADMIN_ONLY_PATHS 라 API 도 admin 으로 맞춘다. proxy.ts 는 세션만 보고
// canAccess 는 '/api/*' 를 판정하지 않으므로 여기서 직접 막는다.
const user = await getCurrentUser();
if (!user || !isAdmin(user.role)) {
  return NextResponse.json(fail('FORBIDDEN', '권한이 없습니다.'), { status: 403 });
}
```

- [ ] **Step 2: `/api/posts` POST 에 게시 게이트**

상단 import 에 추가한다:

```typescript
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canPublishReports } from '@/lib/auth/permissions';
```

`export async function POST(req: Request) {` **바로 다음 줄**에 삽입한다:

```typescript
// 게시는 admin·holdings·mobility 만(사용자 결정 2026-09-08). 본문 생성이
// maxDuration=300 짜리 LLM 작업이라 과금 통로이기도 하다.
const user = await getCurrentUser();
if (!user || !canPublishReports(user.role)) {
  return NextResponse.json(fail('FORBIDDEN', '게시 권한이 없습니다.'), { status: 403 });
}
```

- [ ] **Step 3: `/api/uploads/report` POST 에 게시 게이트**

Step 2 와 같은 import 를 추가하고, `export async function POST(req: Request) {` 바로 다음 줄에 삽입한다:

```typescript
// 게시 폼(new-post-form.tsx:65)이 POST /api/posts 직전에 부르는 업로드다.
// 같은 게이트를 걸지 않으면 100MB 업로드만 열린 채로 남는다.
const user = await getCurrentUser();
if (!user || !canPublishReports(user.role)) {
  return NextResponse.json(fail('FORBIDDEN', '업로드 권한이 없습니다.'), { status: 403 });
}
```

- [ ] **Step 4: 정적 검사**

```bash
npm run typecheck && npm run lint
```

Expected: 둘 다 통과.

- [ ] **Step 5: 커밋**

```bash
git add app/api/companies/route.ts app/api/posts/route.ts app/api/uploads/report/route.ts
git commit -m "fix(보안): API 3종에 역할 게이트 — canAccess 가 /api/* 를 판정하지 않아 전 역할에 열려 있었다

companies POST=admin, posts POST·uploads/report POST=canPublishReports.
proxy.ts 는 redirect 라 API 에 못 쓴다 → route 안에서 403 JSON."
```

---

## Task 3: 게시 화면 게이트

**배경(실측):** `app/reports/new/page.tsx` 에는 권한 검사가 전혀 없고, `app/reports/page.tsx:138` 의 「+ 글쓰기」 버튼도 조건 없이 노출된다. API 만 막으면 비권한자에게 버튼이 보이고 눌렀을 때 403 이 뜬다 — 화면도 같이 맞춘다.

**Files:** Modify `app/reports/new/page.tsx` · `app/reports/page.tsx`

**Interfaces:** Consumes Task 1 의 `canPublishReports` / Produces 없음

- [ ] **Step 1: `/reports/new` 진입을 막는다**

`app/reports/new/page.tsx` 상단 import 에 추가한다:

```typescript
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth/get-current-user';
import { canPublishReports } from '@/lib/auth/permissions';
```

`export default function NewReportPage() {` 를 **async 로 바꾸고** 첫 줄에 게이트를 넣는다:

```typescript
export default async function NewReportPage() {
  // 게시 권한이 없으면 폼을 보여 주지 않는다 — API(Task 2)와 같은 게이트.
  const user = await getCurrentUser();
  if (!user || !canPublishReports(user.role)) {
    redirect('/reports');
  }
```

나머지 JSX 는 그대로 둔다.

- [ ] **Step 2: 「+ 글쓰기」 버튼 노출을 조건부로**

`app/reports/page.tsx` 는 **103줄에서 이미 `currentUser` 를 조회한다.** 새로 조회하지 말고 그 값을 쓴다. 상단 import 의 `canAccessConfidentialReports` 옆에 `canPublishReports` 를 더하고, `includeConfidential` 계산 바로 아래에 추가한다:

```typescript
const canPublish = currentUser ? canPublishReports(currentUser.role) : false;
```

그리고 138줄의 `<Link>` 를 감싼다:

```tsx
{
  canPublish && (
    <Link href="/reports/new" className={buttonVariants()}>
      + 글쓰기
    </Link>
  );
}
```

**`buttonVariants()` 와 자식 텍스트 `+ 글쓰기` 는 그대로 둔다.**

- [ ] **Step 3: 검사**

```bash
npm run check-all
```

Expected: PASS.

- [ ] **Step 4: 브라우저 확인 (골든 패스)**

```bash
npm run dev
```

`.env.local` 에 5역할 계정이 모두 있다(확인 완료). **mobility(허용)** 와 **guest(차단)** 로 각각 로그인해 확인한다:

| 역할     | `/reports` 「+ 글쓰기」 | `/reports/new` 직접 진입 |
| -------- | ----------------------- | ------------------------ |
| mobility | 보인다                  | 폼이 뜬다                |
| guest    | 안 보인다               | `/reports` 로 튕긴다     |

콘솔·네트워크 에러를 함께 본다. 포트 3000 은 다른 앱이 점유해 3001+ 로 자동 배정된다. **확인 후 dev 서버를 반드시 종료한다.**

- [ ] **Step 5: 커밋**

```bash
git add app/reports/new/page.tsx app/reports/page.tsx
git commit -m "fix(보안): 보고서 게시 화면에도 게이트 — 버튼·페이지가 전 역할에 열려 있었다"
```

---

## Task 4: 스텔란티스 매출 KPI 100배 수정

**배경(실측):** `lib/stellantis-forecast/source.ts:169` 가 `pnl_entries.revenue`(백만원)를 환산 없이 `revenueEok` 에 담는다. `RevenueMonthRow.revenueEok` 의 타입 주석은 **"억원"** 이라고 못 박고 있고(`types.ts:49`), `buildRevenueKpi`(`aggregate.ts:533`)가 `unit: 'eok'` 를 붙여 카드에 "억원"으로 렌더한다. **YoY 는 분모·분자가 같이 커져 무사하고 절대값 카드만 100배다** — 그래서 지금까지 안 들켰다.

**심문 결과:** 환산이 DB 접근 함수 안에 있어 단위 테스트로 못 잡는다. 사용자 결정에 따라 **합산+환산 부분을 순수 함수로 분리**해 회귀 테스트를 붙인다.

**Files:** Modify `lib/stellantis-forecast/source.ts` · Test `lib/stellantis-forecast/aggregate.test.ts`

**Interfaces:**

- Consumes: `pnl_entries` 의 `{ period_year, period_month, revenue }` 행 (revenue 는 **백만원**, null 가능)
- Produces: **`toRevenueRows(rows: readonly PnlRevenueRow[]): RevenueMonthRow[]`** — `source.ts` 에서 export 한다. `fetchRevenue` 가 DB 응답을 이 함수에 넘긴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`lib/stellantis-forecast/aggregate.test.ts` 파일 끝에 추가한다. import 목록에 `toRevenueRows` 를 더한다(`from '@/lib/stellantis-forecast/source'` — 기존 import 가 `./aggregate` 상대 경로면 그 형태에 맞춰 `./source` 로 쓴다):

```typescript
describe('toRevenueRows', () => {
  it('백만원을 억원으로 환산한다 — 100배 표시 회귀', () => {
    const out = toRevenueRows([{ period_year: 2026, period_month: 1, revenue: 12345 }]);
    expect(out).toEqual([{ year_month: 202601, revenueEok: 123.45 }]);
  });

  it('같은 (연,월)이 차원별로 쪼개져 있으면 합산한 뒤 환산한다', () => {
    const out = toRevenueRows([
      { period_year: 2026, period_month: 3, revenue: 10000 },
      { period_year: 2026, period_month: 3, revenue: 5000 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].revenueEok).toBeCloseTo(150, 4);
  });

  it('revenue 가 null 인 행은 버린다', () => {
    const out = toRevenueRows([{ period_year: 2026, period_month: 2, revenue: null }]);
    expect(out).toEqual([]);
  });

  it('year_month 오름차순으로 정렬한다', () => {
    const out = toRevenueRows([
      { period_year: 2026, period_month: 3, revenue: 100 },
      { period_year: 2025, period_month: 12, revenue: 100 },
    ]);
    expect(out.map((r) => r.year_month)).toEqual([202512, 202603]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx vitest run lib/stellantis-forecast/aggregate.test.ts
```

Expected: FAIL — `toRevenueRows` 가 아직 없다.

- [ ] **Step 3: 순수 함수를 뽑아내고 환산을 넣는다**

`lib/stellantis-forecast/source.ts` 의 `fetchRevenue` **위**에 추가한다:

```typescript
/** pnl_entries.revenue 는 백만원 단위 — 화면 표기(억원)로 맞추려면 100 으로 나눈다. */
const MWON_TO_EOK = 100;

/** `toRevenueRows` 가 받는 최소 형태 — DB 응답의 부분집합. */
export interface PnlRevenueRow {
  period_year: number;
  period_month: number;
  revenue: number | null;
}

/**
 * pnl_entries 행 → 월별 매출(억원). 순수 함수라 단위 테스트로 고정한다.
 *
 * 같은 (연,월)이 차원(sil·공장·제품 등)별로 쪼개져 여러 행일 수 있으니 합산한다.
 * **백만원 → 억원 환산을 빠뜨리면 KPI 카드가 100배가 된다**(2026-09-08 실제 결함).
 * YoY 는 분모·분자가 같이 커져 무사하므로 절대값 카드로만 드러난다.
 */
export function toRevenueRows(rows: readonly PnlRevenueRow[]): RevenueMonthRow[] {
  const byMonth = new Map<number, number>();
  for (const row of rows) {
    if (row.revenue === null) continue;
    const yearMonth = row.period_year * 100 + row.period_month;
    byMonth.set(yearMonth, (byMonth.get(yearMonth) ?? 0) + row.revenue);
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year_month, revenueMwon]) => ({ year_month, revenueEok: revenueMwon / MWON_TO_EOK }));
}
```

그리고 `fetchRevenue` 의 본문에서 **합산·정렬 블록(161~170줄)을 통째로 지우고** 아래 한 줄로 바꾼다:

```typescript
  return toRevenueRows(data ?? []);
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npm run check-all
```

Expected: PASS. 기존 스텔란티스 테스트가 깨지면 **그 테스트가 백만원을 넣는지 억원을 넣는지 먼저 읽고** 어느 쪽이 옳은지 판단한다. 기계적으로 기대값을 바꾸지 말 것.

- [ ] **Step 5: 화면 확인**

```bash
npm run dev
```

`/management/stellantis` 의 「스텔란티스향 매출」 KPI 카드를 연다. **자릿수가 두 자리 줄어드는지만** 확인한다 — 사외비 금액이므로 **값을 로그·보고에 남기지 않는다.** 확인 후 dev 서버를 종료한다.

- [ ] **Step 6: 커밋**

```bash
git add lib/stellantis-forecast/source.ts lib/stellantis-forecast/aggregate.test.ts
git commit -m "fix(스텔란티스): 매출 KPI 100배 — 백만원을 억원 필드에 그대로 넣고 있었다

환산·합산을 toRevenueRows 순수 함수로 뽑아 회귀 테스트를 붙였다.
DB 함수 안에 있어 지금까지 테스트로 못 잡았다."
```

---

## Task 5: `.range()` 페이징에 결정적 정렬 추가

**배경(실측):** `lib/oem/source.ts:89` 의 주석이 이 증상을 이미 적어 놨다 — _"`.range()` 페이지네이션은 반드시 **결정적 전체 정렬**과 함께 써야 한다. ORDER BY 없이는 페이지 경계에서 순서가 흔들려 행이 누락·중복된다(특정 연도가 통째로 빠지는 증상)."_ 그 파일의 `fetchModelRows` 는 고쳤는데 **바로 위 `fetchAll` 은 정렬 없이, 그것도 `Promise.all` 로 페이지를 동시에 던진다.**

**위험도 실측 (2026-09-08, 페이지 크기 1000):**

| 파일:줄                      | 테이블                     | 행수       | 페이지 | `.order()` 로 넣을 PK 컬럼                                                               |
| ---------------------------- | -------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------- |
| `oem/source.ts:202`          | `oem_sales_group_pt_month` | **15,818** | 16     | `oem_group`, `powertrain`, `year_month`                                                  |
| `kia/source.ts:115`          | `kia_retail_sales`         | **15,490** | 16     | `period_type`, `year_period`, `plant`, `vehicle_model`, `region`                         |
| `oem/source.ts:205`          | `oem_sales_type_seg_month` | **14,029** | 15     | `vehicle_type`, `segment`, `year_month`                                                  |
| `hyundai/source.ts:83`       | `hyundai_sales`            | **10,230** | 11     | `period_type`, `year_period`, `region`, `factory`, `vehicle_model`                       |
| `oem/source.ts:201`          | `oem_sales_group_month`    | **5,817**  | 6      | `oem_group`, `year_month`                                                                |
| `hyundai/source.ts:146`      | `hyundai_retail_sales`     | **3,955**  | 4      | `period_type`, `year_period`, `region`, `vehicle_type`, `vehicle_model`                  |
| `kia/source.ts:70`           | `kia_sales`                | **3,854**  | 4      | `period_type`, `year_period`, `region`, `factory`, `vehicle_model`                       |
| `kia/source.ts:90`           | `kia_export_regions`       | **1,635**  | 2      | `period_type`, `year_period`, `source`, `region_name`, `vehicle_type`                    |
| `kg-mobility/source.ts:53`   | `kg_mobility_sales`        | **1,076**  | 2      | `period_type`, `year_period`, `region`, `vehicle_model`                                  |
| `stellantis-na/source.ts:53` | `stellantis_na_sales`      | 995        | 1      | `period_type`, `year_period`, `brand`, `vehicle_model`, `region`                         |
| `uzbekistan/source.ts:151`   | `uzbekistan_auto_stats`    | 573        | 1      | `kind`, `period_type`, `year_period`, `company`, `brand`, `vehicle_model`, `source_type` |

**위 9개는 지금 이 순간 실제로 여러 페이지를 돈다 — 결함이 활성 상태다.** 아래 2개는 아직 단일 페이지지만 `stellantis_na_sales` 는 **995행으로 경계(1000) 코앞**이라 다섯 행만 늘면 즉시 위험해진다. 둘 다 함께 고친다.

**범위 밖:** `hyundai/source.ts:100` 의 `.range(0, 9999)` 는 페이징 루프가 아니라 단일 요청이다(현재 876행). 10,000행 초과 시 조용히 잘리는 별개 위험은 HANDOFF 에 남기고 **손대지 않는다.**

**「통과했다」의 뜻(정직한 정의):** 행 누락은 수집기가 캐시 재생성 중에 upsert 할 때만 나는 경합이라 **회귀 테스트로 재현할 수 없다.** 이 Task 의 검증은 ①`check-all` 통과 ②Step 5 의 행수 대조(fetch 길이 == DB count)까지다. 「화면이 이전과 같다」는 검증이 아니다 — 이전 값이 이미 누락된 값일 수 있기 때문이다.

**Files:** Modify `lib/oem/source.ts` · `lib/oem-companies/{hyundai,kia,kg-mobility,stellantis-na,uzbekistan}/source.ts`

**Interfaces:** Produces `fetchAll<TName>(supabase, table, orderColumns: readonly string[])` — 세 번째 인자가 추가된다(같은 파일 안에서만 쓰인다).

- [ ] **Step 1: 제네릭 `fetchAll` 에 정렬 키 인자를 추가한다**

`lib/oem/source.ts:45` 의 시그니처를 바꾼다:

```typescript
async function fetchAll<TName extends keyof Database['public']['Tables']>(
  supabase: AnonClient,
  table: TName,
  orderColumns: readonly string[]
): Promise<TableRow<TName>[]> {
```

첫 페이지 쿼리(50~52줄)를 바꾼다:

```typescript
let firstQuery = supabase.from(table).select('*', { count: 'exact' });
for (const col of orderColumns) firstQuery = firstQuery.order(col);
const first = await firstQuery.range(0, SUPABASE_PAGE_SIZE - 1);
```

병렬 배치 안(68~70줄)도 바꾼다:

```typescript
let pageQuery = supabase.from(table).select('*');
for (const col of orderColumns) pageQuery = pageQuery.order(col);
batch.push(pageQuery.range(offset, offset + SUPABASE_PAGE_SIZE - 1));
```

함수 위에 docstring 을 붙인다:

```typescript
/**
 * 테이블 전체 fetch. `.range()` 다중 페이지는 **결정적 전체 정렬**이 필수다 —
 * ORDER BY 없이는 페이지 경계에서 순서가 흔들려 행이 누락·중복된다.
 * 여기서는 페이지를 Promise.all 로 동시에 던지므로 특히 그렇다.
 * `orderColumns` 에는 그 테이블의 PK 컬럼을 순서대로 준다.
 */
```

- [ ] **Step 2: 호출부 3곳에 PK 를 넘긴다**

`lib/oem/source.ts:201-205` 를 표대로 바꾼다:

```typescript
    fetchAll(supabase, 'oem_sales_group_month', ['oem_group', 'year_month']),
    fetchAll(supabase, 'oem_sales_group_pt_month', ['oem_group', 'powertrain', 'year_month']),
```

205줄:

```typescript
    fetchAll(supabase, 'oem_sales_type_seg_month', ['vehicle_type', 'segment', 'year_month']),
```

- [ ] **Step 3: 회사별 페이징 8곳에 `.order()` 를 넣는다**

각 파일에서 `.select(...)` 와 `.range(...)` **사이에** 위 표의 PK 를 순서대로 넣는다. 예시 — `lib/oem-companies/hyundai/source.ts:81-83`:

```typescript
      .from('hyundai_sales')
      .select('*')
      .order('period_type')
      .order('year_period')
      .order('region')
      .order('factory')
      .order('vehicle_model')
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
```

나머지 7곳도 **표의 컬럼을 그대로** 같은 방식으로 넣는다(`hyundai:146` · `kia:70` · `kia:90` · `kia:115` · `kg-mobility:53` · `stellantis-na:53` · `uzbekistan:151`).

⚠️ `kia/source.ts:115` 와 `uzbekistan/source.ts:151` 은 `client.from(...)` 로 `any` 캐스트를 거쳐 **컬럼명 오타가 타입 검사에 안 걸리고 런타임 400 이 된다** — 표를 그대로 복사할 것.

- [ ] **Step 4: 정적 검사**

```bash
npm run check-all
```

Expected: PASS.

- [ ] **Step 5: 행수 대조 — 이 Task 의 실제 검증**

`npm run dev` 로 띄운 뒤 `/oem` · `/oem/hyundai` · `/oem/kia` · `/oem/kg-mobility` · `/oem/stellantis-na` · `/oem/uzbekistan` 을 연다. 각 페이지가 500 없이 뜨고 **연도 축에 빈 구간이 없는지** 본다.

그다음 Supabase 로 각 테이블의 행수를 다시 재어 위 표와 대조한다(수집기가 그사이 늘렸으면 표보다 커진다 — 줄어들면 안 된다). 이 페이지들은 `cacheLife('days')` 라 옛 캐시를 볼 수 있다 — 값이 안 바뀌면 `docs/gotchas-ci-deploy.md` 의 `revalidate_tags` 로 무효화한 뒤 다시 본다. 확인 후 **dev 서버를 종료한다.**

- [ ] **Step 6: 커밋**

```bash
git add lib/oem/source.ts lib/oem-companies/hyundai/source.ts lib/oem-companies/kia/source.ts lib/oem-companies/kg-mobility/source.ts lib/oem-companies/stellantis-na/source.ts lib/oem-companies/uzbekistan/source.ts
git commit -m "fix(OEM): .range() 페이징 11곳에 결정적 정렬 — 행이 조용히 누락·중복되고 있었다

9개 테이블이 실제로 여러 페이지를 돈다(최대 15,818행=16페이지).
같은 파일 fetchModelRows 주석이 이미 이 증상을 적어 뒀는데
바로 위 fetchAll 은 정렬 없이 Promise.all 로 페이지를 동시에 던지고 있었다.
정렬 키는 각 테이블 PK."
```

---

## Task 6: 스텔란티스 북미 연도 YoY — 진행 중 연도를 전년 동기와 비교

**배경(실측):** `lib/oem-companies/stellantis-na/aggregate.ts:149-165` 의 `aggregateAnnualSeries` 는 분기 행을 연 합계로 접은 뒤 `yearTotals.get(prevYear)` 로 **무조건** 나눈다. 2026 Q1 만 적재된 시점에 완전한 2025 와 비교돼 `yoy_pct ≈ -75%` 가 `2026` 이라는 평범한 라벨에 붙는다. **올바른 참조 구현이 형제 파일에 있다** — `lib/oem-companies/kg-mobility/aggregate.ts:107-140` 이 `isYtd` 를 판정해 전년 동기만 다시 합산하고 라벨을 `2026 YTD` 로 단다. kg-mobility 는 **월** 단위(12개월 미만이면 YTD), stellantis-na 는 **분기** 단위(4분기 미만이면 YTD)다.

**확인된 사실:** `year_period` 형식은 **`'2025-Q1'`**(하이픈 포함)이고 `periodYear` 는 `period.slice(0, 4)`, 분기 추출은 `slice(-2)` → `'Q1'`. 테스트 헬퍼는 `row({period, brand, model, units})` 이고 `withPt(rows)` 로 감싸 호출한다.

**Files:** Modify `lib/oem-companies/stellantis-na/aggregate.ts` · Test `lib/oem-companies/stellantis-na/aggregate.test.ts`

**Interfaces:** Produces `aggregateAnnualSeries(rows): CompanyTimeSeriesPoint[]` — **시그니처 불변.** `period_label` 이 진행 중 연도에 한해 `"2026 YTD"` 가 되고 `yoy_pct` 가 전년 동기 기준이 된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`lib/oem-companies/stellantis-na/aggregate.test.ts` 의 기존 `describe('aggregateAnnualSeries', ...)`(127줄) 블록 **안**에 추가한다:

```typescript
it('진행 중 연도는 전년 동기 분기와 비교하고 YTD 라벨을 단다', () => {
  const rows: StellantisNaSaleRow[] = [];
  for (let q = 1; q <= 4; q++) {
    rows.push(row({ period: `2025-Q${q}`, brand: 'Jeep', model: 'X', units: 100 }));
  }
  rows.push(row({ period: '2026-Q1', brand: 'Jeep', model: 'X', units: 110 }));

  const out = aggregateAnnualSeries(withPt(rows));
  const y2026 = out.find((p) => p.period === '2026')!;

  expect(y2026.period_label).toBe('2026 YTD');
  // 110 vs 2025-Q1 의 100 → +10%. 전년 만년(400)과 비교하면 -72.5% 가 나온다(옛 버그).
  expect(y2026.yoy_pct).toBeCloseTo(10, 1);
});

it('4개 분기가 다 찬 연도는 전년 만년과 비교하고 YTD 를 붙이지 않는다', () => {
  const rows: StellantisNaSaleRow[] = [];
  for (let q = 1; q <= 4; q++) {
    rows.push(row({ period: `2025-Q${q}`, brand: 'Jeep', model: 'X', units: 100 }));
    rows.push(row({ period: `2026-Q${q}`, brand: 'Jeep', model: 'X', units: 110 }));
  }

  const out = aggregateAnnualSeries(withPt(rows));
  const y2026 = out.find((p) => p.period === '2026')!;

  expect(y2026.period_label).toBe('2026');
  expect(y2026.yoy_pct).toBeCloseTo(10, 1);
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx vitest run lib/oem-companies/stellantis-na/aggregate.test.ts
```

Expected: 첫 테스트가 FAIL — `period_label` 이 `'2026'` 이고 `yoy_pct` 가 `-72.5` 근처로 나온다. **이 실패값이 곧 지금 화면에 뜨는 허위 급락이다.** 둘째 테스트는 이미 통과해야 한다(회귀 방지용).

- [ ] **Step 3: 구현을 고친다**

`aggregateAnnualSeries` 본문을 바꾼다(docstring 은 남기고 YoY 설명만 고친다):

```typescript
export function aggregateAnnualSeries(rows: StellantisNaSaleRowWithPt[]): CompanyTimeSeriesPoint[] {
  const quarterRows = rows.filter((r) => r.period_type === 'quarter' && isModelRow(r));
  const yearTotals = new Map<string, number>();
  const yearQuarters = new Map<string, Set<string>>();
  for (const r of quarterRows) {
    const y = periodYear(r.year_period);
    yearTotals.set(y, (yearTotals.get(y) ?? 0) + r.sales_units);
    if (!yearQuarters.has(y)) yearQuarters.set(y, new Set());
    yearQuarters.get(y)!.add(r.year_period.slice(-2));
  }
  const years = [...yearTotals.keys()].sort();
  return years.map((year) => {
    const sales = yearTotals.get(year) ?? 0;
    const quarters = yearQuarters.get(year) ?? new Set<string>();
    // 4분기가 다 차지 않았으면 진행 중 연도 — 전년 '동일 분기'만 다시 합산해 비교한다.
    // 전년 만년과 비교하면 2026 Q1 하나가 2025 전체와 맞붙어 허위 급락(-75%)이 나온다.
    const isYtd = quarters.size > 0 && quarters.size < 4;
    const prevYear = String(parseInt(year, 10) - 1);
    let prevSales: number;
    if (isYtd) {
      prevSales = quarterRows
        .filter(
          (r) => periodYear(r.year_period) === prevYear && quarters.has(r.year_period.slice(-2))
        )
        .reduce((sum, r) => sum + r.sales_units, 0);
    } else {
      prevSales = yearTotals.get(prevYear) ?? 0;
    }
    const yoy = prevSales < MIN_YOY_PREV_SALES ? null : ((sales - prevSales) / prevSales) * 100;
    return {
      period: year,
      period_label: isYtd ? `${year} YTD` : year,
      sales,
      yoy_pct: yoy,
    };
  });
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npm run check-all
```

Expected: PASS. 기존 테스트(128줄 「연 단위 합산 + YoY (분기 SUM)」)는 두 해 모두 4분기가 차 있으므로 **그대로 통과해야 한다.** 깨지면 구현이 틀린 것이다.

- [ ] **Step 5: 커밋**

```bash
git add lib/oem-companies/stellantis-na/aggregate.ts lib/oem-companies/stellantis-na/aggregate.test.ts
git commit -m "fix(스텔란티스북미): 진행 중 연도 YoY 를 전년 동기 분기와 비교 — 허위 급락 -75%

Q1 만 적재된 2026 이 완전한 2025 와 맞붙어 평범한 '2026' 라벨에
1/4 높이 막대가 붙고 있었다. kg-mobility 의 isYtd 방식을 분기 단위로 적용."
```

---

## Task 7: 연도 하드코딩 제거 — 2027-01-01 에 화면이 멈추는 것

**배경(실측):** `lib/pnl/aggregate.ts:61,69` 가 `y >= 2023 && y <= 2026` 으로 연도 라벨을 자르고, `:531` 이 `(y) => y === 2026` 일 때만 YTD 행을 만들며, `:528` 이 `year_label !== '2026(P)'` 로 계획값을 거른다. `lib/plan/aggregate.ts:170` 은 `ytd: lbl === '2026'`, `lib/stockSort.ts:23` 은 `SUPPORTED_YEARS = ['2026','2025','2024','2023']` 이다. **2027 실적이 적재돼도 에러 없이 2026 에 고정된다.**

**설계(사용자 결정):** 하한 2023 은 「데이터가 그때부터 있다」는 사실이므로 상수로 남긴다. **상한과 「진행 중 연도」만 현재 연도(서울)에서 끌어온다.** UTC 로 읽으면 연말연시 9시간 동안 한 해가 밀리므로 반드시 `Asia/Seoul` 로 구한다(이 레포에 `todaySeoul` 유틸은 없고 `lib/hansae/data.ts:307` 이 `toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })` 를 쓴다 — 같은 방식으로 맞춘다).

**Files:** Modify `lib/pnl/aggregate.ts` · `lib/plan/aggregate.ts` · `lib/stockSort.ts` · Test `lib/pnl/__tests__/aggregate.test.ts`

**Interfaces:** Produces `lib/pnl/aggregate.ts` 에서 `PNL_MIN_YEAR`(=2023) 와 `currentFiscalYear(): number` 를 export 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`lib/pnl/__tests__/aggregate.test.ts` 에 추가한다. import 에 `currentFiscalYear`·`getDisplayYearLabels` 를 더한다:

```typescript
describe('연도 상한 동적화', () => {
  it('현재 연도 실적이 라벨에 포함된다 — 2027 에 화면이 멈추지 않는다', () => {
    const thisYear = currentFiscalYear();
    const entries: PnlEntry[] = [
      mkEntry({ basis: 'standalone', period_year: thisYear, period_month: 1 }),
      mkEntry({ basis: 'standalone', period_year: thisYear - 1, period_month: 1 }),
    ];

    const labels = getDisplayYearLabels(entries, 'standalone');

    expect(labels).toContain(String(thisYear));
    expect(labels).toContain(String(thisYear - 1));
  });

  it('하한(2023) 이전 연도는 계속 잘린다', () => {
    const entries: PnlEntry[] = [
      mkEntry({ basis: 'standalone', period_year: 2022, period_month: 1 }),
    ];
    expect(getDisplayYearLabels(entries, 'standalone')).not.toContain('2022');
  });
});
```

`mkEntry` 는 이 파일의 기존 fixture 헬퍼 이름에 맞춘다 — **파일을 먼저 읽어 실제 이름과 필수 필드를 확인할 것**(이 파일은 fixture 를 각 describe 앞에 인라인으로 두는 스타일이다). 헬퍼가 없으면 `PnlEntry` 필수 필드를 채운 최소 객체를 이 describe 안에서 만든다.

- [ ] **Step 2: 실패를 확인한다**

```bash
npx vitest run lib/pnl/__tests__/aggregate.test.ts
```

Expected: FAIL — `currentFiscalYear` 가 없다.

- [ ] **Step 3: 헬퍼를 만든다**

`lib/pnl/aggregate.ts` 상단(기존 import 아래)에 추가한다:

```typescript
/** 손익 데이터가 존재하는 첫 해 — 데이터 사실이므로 고정값이다. */
export const PNL_MIN_YEAR = 2023;

/**
 * 표시 기준 연도(서울). 라벨 상한과 「진행 중 연도(YTD)」 판정에 쓴다.
 *
 * UTC 로 읽으면 연말연시 9시간 동안 한 해가 밀린다 — 반드시 Asia/Seoul 로 구한다.
 * 하드코딩(`<= 2026`)이었을 때는 해가 바뀌면 손익 화면이 조용히 2026 에 고정됐다.
 */
export function currentFiscalYear(): number {
  const seoulDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  return parseInt(seoulDate.slice(0, 4), 10);
}
```

- [ ] **Step 4: 하드코딩을 치환한다**

`lib/pnl/aggregate.ts:61`:

```typescript
if (y >= PNL_MIN_YEAR && y <= currentFiscalYear()) labels.add(String(y));
```

`:69`:

```typescript
return y >= PNL_MIN_YEAR && y <= currentFiscalYear();
```

`:528`(계획값 라벨 제외) — 현재 연도를 따라가게 한다:

```typescript
const thisYear = currentFiscalYear();
const consolidatedAnnual = data.filter(
  (e) => e.basis === 'consolidated' && e.period_month === 0 && e.year_label !== `${thisYear}(P)`
);
```

`:531`:

```typescript
// 연결 진행 중 연도 YTD: monthly 1~N월 합산 → period_month=0 derive.
const consolidatedYtd = deriveAnnualFromMonthly(data, 'consolidated', (y) => y === thisYear);
```

⚠️ 변수명을 `consolidated2026Ytd` → `consolidatedYtd` 로 바꾸면 **아래 `annualEntries` 배열(535줄 부근)의 사용처도 함께 고친다.** typecheck 가 잡아 준다.

`lib/plan/aggregate.ts:170`:

```typescript
entriesActualByYear.set(yr, {
  value: agg[0][metric] / 100,
  ytd: lbl === String(currentFiscalYear()),
});
```

상단에 `import { currentFiscalYear } from '@/lib/pnl/aggregate';` 를 추가한다. **순환 import 가 생기면**(`pnl/aggregate.ts` 가 `plan/` 을 import 하고 있으면) 헬퍼를 새 파일 `lib/fiscalYear.ts` 로 빼고 양쪽이 그것을 import 한다 — typecheck 와 vitest 가 순환을 알려 준다.

`lib/stockSort.ts:23` — 최근 4개 연도를 내림차순으로 만든다:

```typescript
const SUPPORTED_YEARS: readonly string[] = Array.from({ length: 4 }, (_, i) =>
  String(currentFiscalYear() - i)
);
```

`as const` 를 제거했으므로 이 상수의 좁은 타입에 의존하는 곳이 있으면 typecheck 가 알려 준다. `FALLBACK_YEAR` 는 그대로 둔다.

- [ ] **Step 5: 검사**

```bash
npm run check-all
```

Expected: PASS. **기존 테스트가 `'2026'` 을 문자열로 기대하는 곳이 여럿 나올 수 있다** — 그런 테스트마다 고정 연도가 옳은지(과거 데이터 검증) 현재 연도를 따라야 하는지(표시 규칙 검증) 하나씩 판단해 고친다. 기계적으로 치환하지 말 것.

- [ ] **Step 6: 커밋**

```bash
git add lib/pnl/aggregate.ts lib/plan/aggregate.ts lib/stockSort.ts lib/pnl/__tests__/aggregate.test.ts
git commit -m "fix(손익): 연도 상한 2026 하드코딩 제거 — 2027-01-01 에 화면이 조용히 멈춘다

라벨 상한·YTD 판정·계획값 라벨·주식표 지원연도를 서울 기준 현재 연도에서 끌어온다.
하한 2023 은 데이터 사실이라 상수로 남긴다."
```

---

## 최종 확인

- [ ] **Step 1: 전체 검사**

```bash
npm run check-all
PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe scripts/verify_docs.py
```

Expected: 둘 다 통과. `check-all` 이 **4단계를 전부 완주**하는지 확인한다(Task 0 의 목적).

- [ ] **Step 2: 문서 갱신 판단**

이번 변경으로 사실이 달라진 문서를 같은 작업 안에서 고친다:

- `AGENTS.md` — `lib/` 약속에 「`.range()` 다중 페이지 fetch 는 `.order()` 필수」가 **이미 적혀 있다**(지켜지지 않았을 뿐). 권한 게이트에 API 계층이 생긴 것은 새 사실이므로 `[app/]` 줄에 한 줄 추가를 검토한다. 적을 것이 없으면 **「문서 갱신 불필요」라고 명시 보고**한다.
- `docs/gotchas-data-collection.md` — 「같은 파일·형제 파일에 올바른 구현이 있는데 따르지 않았다」가 이번에 **3번 반복**됐다(`.order()` · 단위 환산 · YoY YTD). 한 줄 항목으로 남길 가치가 있는지 판단한다.
- `Architecture.md §11` — 보안 매트릭스에 API 역할 게이트를 반영할지 확인한다.

- [ ] **Step 3: 핸드오프**

`HANDOFF.md` 맨 위에 새 `## 최신 상태 · 재개 지점` 블록을 쓰고 직전 블록을 `## 이전 상태 …` 로 강등한다. **남은 일**로 아래를 명시한다 — 이번 범위에서 의도적으로 제외한 것들이다:

- 리뷰 지적 미처리 8건: `scripts/lib/nhtsa_client.py:201`(수집 실패가 「리콜 0건」으로 둔갑) · `scripts/lib/revalidate.py:32`(`humanoid_stocks_view`·`hyundai_retail_sales` 태그 매핑 누락) · `app/api/cron/sentiment/route.ts:39`(에러를 버려 200 ok) · `lib/hansae/data.ts:89`(KST 09시 컷오프) · `lib/chat/tools.ts:194`(한세 게이트 누락) · `lib/chat/tools.ts:206`(PostgREST `or()` 인젝션) · `lib/auth/actions.ts:14`(오픈 리다이렉트 `/\`) · `app/api/news/search/route.ts:88`(날짜 하나로 전체 502)
- 부가 9건(리뷰 「지적하지 않았지만 확인된 것」 — `app/api/stock-prices/route.ts:16` id 무검증 등)
- `lib/oem-companies/hyundai/source.ts:100` 의 `.range(0, 9999)` — 현재 876행이라 안전하지만 10,000행 초과 시 조용히 잘린다

---

# 2차 — 남은 지적 전량 (2026-09-08 오후)

1차에서 「이번 범위 밖」으로 남긴 것을 전부 처리한다. 산출물·완료 정의는 1차와 같다
(**같은 코드리뷰에서 나온 지적을 코드로 없애는 것**)이므로 새 계획서를 내지 않고 여기 잇는다.

## 사용자 지시 원문 (2026-09-08 오후)

> 남은 일 진행해

AskUserQuestion 으로 확정한 것 3건:

1. **OEM 대시보드 `TARGET_YEAR`** → 「직전 완결 연도」(현재 연도 − 1). 지금 화면은 그대로 2025 이고
   2027 이 되면 자동으로 2026 으로 넘어간다.
2. **`Forecast2026.tsx`** → `AnnualForecast.tsx` 로 **개명**(`git mv`, import 하는 곳도 같이).
3. **`/api/chat`** → **guest 만 403**. 나머지 4역할은 그대로.

## 2차 Global Constraints (1차 것에 더한다)

- 1차의 Global Constraints 는 전부 그대로 유효하다 — 특히 **경로 명시 `git add`**,
  **사외비 금액 비노출**, **각 Task 끝에서 `npm run check-all` 통과**.
- **연도를 코드에 박지 않는다.** 새로 쓰는 판정은 ⓐ 데이터에서 파생하거나 ⓑ `currentYear()`
  에서 파생한다. 리터럴 연도가 정당한 자리는 **`PNL_MIN_YEAR = 2023`(데이터가 시작한 해)** 뿐이다.
- **연도를 다루는 수정은 미래 시각에서 돌려 봐야 검증이 끝난다.** 1차 Task 7 에서 이 절차가 없어
  회귀 2건을 계획서가 직접 만들어 냈다. 해당 Task 는 `vi.setSystemTime` 으로 **최소 2개 시점**
  (현재, 그리고 다음 해 1월 5일)에서 단위 테스트를 돌린다.
- **파이썬은 `scripts/venv/Scripts/python.exe`** 로 돌린다. 출력이 있는 실행에는
  `PYTHONIOENCODING=utf-8` 프리픽스를 붙인다(`-m py_compile` 은 불필요).
- `Asia/Seoul` 로 연·월·일을 구한다. `new Date().getFullYear()` 는 Vercel(UTC)에서 연초 9시간
  동안 한 해가 밀리므로 **새 코드에 쓰지 않는다.**

## 2차 File Structure

| 파일                                                                                                                                                                | 책임                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `lib/currentYear.ts` · `lib/currentYear.test.ts` (신설)                                                                                                             | 서울 기준 달력 연도 단일 출처 (Task 8)                |
| `lib/pnl/aggregate.ts` · `lib/plan/aggregate.ts` · `lib/stockSort.ts`                                                                                               | `currentFiscalYear` 폐기 → `currentYear` (Task 8)     |
| `lib/pnl/periodColumns.ts` · `periodColumns.test.ts` (신설)                                                                                                         | 손익 표 「연간 N개 + 진행 연도 YTD」 열 파생 (Task 9) |
| `components/management/pnl/CostStructure.tsx` · `FixedVariableBep.tsx` · `FixedVariableStructure.tsx`                                                               | 위 함수로 교체 (Task 9)                               |
| `components/management/pnl/AnnualForecast.tsx` (개명) · `PnlDashboard.tsx`                                                                                          | 연도 무관 추정 (Task 10)                              |
| `lib/finance/loan-aggregate.ts` · `components/oem/OemDashboard.tsx` · `lib/oem/aggregate.ts` · `lib/oem-companies/{kia,hyundai,uzbekistan}/*` · `lib/chat/tools.ts` | 연도 하드코딩·UTC 연도 제거 (Task 11)                 |
| `scripts/lib/nhtsa_client.py` · `scripts/lib/revalidate.py` · `app/api/revalidate/route.ts` · `scripts/verify_revalidate_tags.py` (신설)                            | 수집 실패 은폐 · 태그 매핑 (Task 12)                  |
| `app/api/cron/sentiment/route.ts` · `lib/hansae/data.ts` · `lib/chat/tools.ts` · `lib/auth/actions.ts` · `app/api/news/search/route.ts`                             | 라우트·유틸 지적 6건 (Task 13)                        |
| `app/api/chat/route.ts` · `lib/auth/permissions.ts`                                                                                                                 | guest 챗봇 차단 (Task 14)                             |
| `lib/pnl/__tests__/aggregate.test.ts` · JSDoc 3곳                                                                                                                   | 1차의 미검증 항목 보강 (Task 15)                      |

---

## Task 8: 연도 단일 출처 `lib/currentYear.ts` 신설

**왜**: 1차에서 만든 `currentFiscalYear` 는 이름이 **회계연도**를 시사하는데 실제로는 **달력 연도**다.
이 레포에는 `companies.fiscal_year_end_month`(회사별 결산월)로 진짜 회계연도를 −1 보정하는 규칙이
따로 있어(AGENTS.md 「비-12월 결산 fiscal_year」) 이름이 정면으로 충돌한다.
게다가 **공개 유틸 `lib/stockSort.ts` 가 손익 도메인 `lib/pnl/aggregate.ts` 를 import** 하는
계층 역전이 생겼다. 둘은 같은 수술로 풀린다.

**Files:**

- Create: `lib/currentYear.ts`
- Create: `lib/currentYear.test.ts`
- Modify: `lib/pnl/aggregate.ts` (함수 제거 + import 로 교체)
- Modify: `lib/plan/aggregate.ts:4,177`
- Modify: `lib/stockSort.ts:10,25`
- Modify: `lib/pnl/__tests__/aggregate.test.ts:3,200,250,317`

**Interfaces:**

- Produces: `export function currentYear(): number` — 서울 기준 달력 연도.
  Task 9~11 이 전부 이것을 쓴다. 다른 이름을 만들지 말 것.
- `PNL_MIN_YEAR` 는 `lib/pnl/aggregate.ts` 에 **그대로 둔다** — 손익 데이터가 시작한 해라
  손익 도메인의 사실이지 공용 상수가 아니다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `lib/currentYear.test.ts`

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentYear } from './currentYear';

describe('currentYear', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('UTC 로는 전년인 순간에도 서울 연도를 준다', () => {
    // 2026-12-31T16:00Z = 서울 2027-01-01 01:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-31T16:00:00Z'));
    expect(currentYear()).toBe(2027);
  });

  it('UTC 로는 이미 새해인 순간에도 서울이 아직 전년이면 전년을 준다', () => {
    // 2026-01-01T00:30Z = 서울 2026-01-01 09:30 → 같은 해라 경계가 안 잡힌다.
    // 반대 방향 경계: 서울이 아직 12/31 인 순간은 UTC 로도 12/31 이므로
    // 서울 기준이 UTC 보다 **앞서기만** 한다는 사실을 명시적으로 고정한다.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    expect(currentYear()).toBe(2026);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

`npx vitest run lib/currentYear.test.ts` → `Cannot find module './currentYear'`

- [ ] **Step 3: 구현한다** — `lib/currentYear.ts`

```typescript
/**
 * 서울 기준 **달력 연도**.
 *
 * 화면 라벨·「진행 중 연도(YTD)」 판정·연도 상한을 전부 여기서 파생시킨다.
 * 연도를 코드에 박으면 해가 바뀌는 순간 화면이 조용히 지난해에 멈춘다(2026 하드코딩 사고).
 *
 * 🔴 `new Date().getFullYear()` 를 쓰지 말 것 — 서버 로컬시간이라 Vercel(UTC)에서는
 * 매년 1월 1일 00:00~09:00(KST) 동안 전년을 돌려준다.
 *
 * 🔴 회사별 **회계연도**(`companies.fiscal_year_end_month` 로 −1 보정하는 그것)와는
 * 다른 개념이다. 재무 fiscal_year 판정에 이 함수를 쓰지 말 것.
 */
export function currentYear(): number {
  const seoulDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  return parseInt(seoulDate.slice(0, 4), 10);
}
```

- [ ] **Step 4: 통과를 확인한다** — `npx vitest run lib/currentYear.test.ts`

- [ ] **Step 5: 호출부 4곳을 옮긴다**

`lib/pnl/aggregate.ts` — `currentFiscalYear` 정의를 **지우고** 맨 위 import 에
`import { currentYear } from '../currentYear';` 를 넣은 뒤 본문 2곳(`:75`, `:83`)을 `currentYear()` 로 바꾼다.
`lib/plan/aggregate.ts` — import 출처를 `'@/lib/currentYear'` 로, 호출을 `currentYear()` 로.
`lib/stockSort.ts` — `import { currentFiscalYear } from './pnl/aggregate';` 를
`import { currentYear } from './currentYear';` 로 바꾼다. **이 줄이 계층 역전 해소의 본체다.**
`lib/pnl/__tests__/aggregate.test.ts` — import 와 `const thisYear = currentYear();` 3곳.

🔴 `currentFiscalYear` 라는 이름이 레포 어디에도 남지 않아야 한다:
`grep -rn "currentFiscalYear" --include=*.ts --include=*.tsx lib components app` 가 0건.

- [ ] **Step 6: 검증 + 커밋**

```bash
npm run check-all
git add lib/currentYear.ts lib/currentYear.test.ts lib/pnl/aggregate.ts lib/plan/aggregate.ts lib/stockSort.ts lib/pnl/__tests__/aggregate.test.ts
git commit -m "refactor(연도): currentFiscalYear를 lib/currentYear.ts로 분리·개명 — 계층 역전 해소"
```

---

## Task 9: 손익 표 열을 데이터에서 파생 (연간 N개 + 진행 연도 YTD)

**왜**: 세 컴포넌트가 **똑같은 열 정의를 각자 복제**해 두고 연도를 리터럴로 박았다.
2027-01-01 이 되면 세 화면이 전부 2023·2024·2025 연간 + 「2026 YTD」에 멈춘다.

**연도 무관 규칙**(1차 Task 7 이 손익 라벨에 쓴 것과 **같은 규칙**을 쓴다):

- **연간 열** = 데이터에 `period_kind='annual'` 행이 있는 연도 전부, 오름차순.
- **YTD 열** = `period_kind='monthly'` 행이 있는 **가장 큰 연도**. 단 그 연도에 연간 행이
  **이미 있으면 만들지 않는다**(확정 연간이 들어오면 YTD 는 사라진다).
- YTD 라벨 = 최대 월이 12 면 `'2026'`, 아니면 `'2026 YTD'` — 현행과 동일.

**Files:**

- Create: `lib/pnl/periodColumns.ts`
- Create: `lib/pnl/__tests__/periodColumns.test.ts`
- Modify: `components/management/pnl/CostStructure.tsx:42-78,130`
- Modify: `components/management/pnl/FixedVariableBep.tsx:58-81`
- Modify: `components/management/pnl/FixedVariableStructure.tsx:238-272,415`

**Interfaces:**

- Consumes: 없음(순수 함수).
- Produces:

```typescript
export interface PeriodRowLike {
  period_year: number;
  period_kind: string;
  period_month: number;
}

export interface PeriodColumn<T> {
  /** 화면 라벨 — '2024' 또는 '2026 YTD' */
  label: string;
  /** 그 열에 속하는 행인가 */
  match: (r: T) => boolean;
  /** YTD 열이면 누적 개월 수, 연간 열이면 null */
  ytdMonths: number | null;
}

export function buildPeriodColumns<T extends PeriodRowLike>(
  rows: readonly T[],
  extraFilter?: (r: T) => boolean
): PeriodColumn<T>[];
```

`extraFilter` 는 `CostStructure` 의 `r.kind === 'actual'` 처럼 **그 화면에만 있는 추가 조건**이다.
넘기면 열 목록을 고를 때도, `match` 안에서도 함께 적용된다. 안 넘기면 항상 통과.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `lib/pnl/__tests__/periodColumns.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { buildPeriodColumns } from '../periodColumns';

interface Row {
  period_year: number;
  period_kind: string;
  period_month: number;
  kind?: string;
}

const annual = (y: number, kind = 'actual'): Row => ({
  period_year: y,
  period_kind: 'annual',
  period_month: 0,
  kind,
});
const monthly = (y: number, m: number, kind = 'actual'): Row => ({
  period_year: y,
  period_kind: 'monthly',
  period_month: m,
  kind,
});

describe('buildPeriodColumns', () => {
  it('연간 행이 있는 연도를 오름차순 열로 만든다', () => {
    const cols = buildPeriodColumns([annual(2025), annual(2023), annual(2024)]);
    expect(cols.map((c) => c.label)).toEqual(['2023', '2024', '2025']);
    expect(cols.every((c) => c.ytdMonths === null)).toBe(true);
  });

  it('월별만 있는 최신 연도는 YTD 열이 되고 최대 월을 라벨에 쓴다', () => {
    const cols = buildPeriodColumns([annual(2024), monthly(2025, 1), monthly(2025, 3)]);
    expect(cols.map((c) => c.label)).toEqual(['2024', '2025 YTD']);
    expect(cols[1].ytdMonths).toBe(3);
  });

  it('12개월이 다 차면 YTD 표기를 떼고 연도만 쓴다', () => {
    const rows = Array.from({ length: 12 }, (_, i) => monthly(2025, i + 1));
    const cols = buildPeriodColumns(rows);
    expect(cols.map((c) => c.label)).toEqual(['2025']);
    expect(cols[0].ytdMonths).toBe(12);
  });

  it('확정 연간 행이 들어온 연도는 YTD 열을 만들지 않는다', () => {
    const cols = buildPeriodColumns([annual(2025), monthly(2025, 4)]);
    expect(cols.map((c) => c.label)).toEqual(['2025']);
    expect(cols[0].ytdMonths).toBeNull();
    // 연간 열의 match 는 연간 행만 받는다
    expect(cols[0].match(annual(2025))).toBe(true);
    expect(cols[0].match(monthly(2025, 4))).toBe(false);
  });

  it('YTD 열의 match 는 1~최대월만 받는다', () => {
    const cols = buildPeriodColumns([monthly(2025, 2), monthly(2025, 5)]);
    const ytd = cols[0];
    expect(ytd.match(monthly(2025, 5))).toBe(true);
    expect(ytd.match(monthly(2025, 6))).toBe(false);
    expect(ytd.match(monthly(2024, 3))).toBe(false);
  });

  it('extraFilter 로 걸러진 행은 열 목록에도 안 잡힌다', () => {
    const rows = [annual(2024), annual(2025, 'plan'), monthly(2026, 2, 'plan')];
    const cols = buildPeriodColumns(rows, (r) => r.kind === 'actual');
    expect(cols.map((c) => c.label)).toEqual(['2024']);
  });

  it('빈 입력은 빈 배열', () => {
    expect(buildPeriodColumns([])).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다** — `npx vitest run lib/pnl/__tests__/periodColumns.test.ts`

- [ ] **Step 3: 구현한다** — `lib/pnl/periodColumns.ts`

```typescript
/**
 * 손익 표 3종(비용구조·고정변동 구조·BEP)이 공통으로 쓰는 「연도 열」 파생.
 *
 * 🔴 연도를 코드에 박지 않는다 — 열은 **데이터에 실제로 있는 연도**에서 나온다.
 * 셋이 각자 2023·2024·2025 를 리터럴로 들고 있었고, 그래서 해가 바뀌면 세 화면이
 * 동시에 지난해에 멈췄다.
 *
 * 규칙은 `preparePnlData` 의 연간 derive 와 같다 — **확정 연간 행이 있는 연도는
 * 그것을 쓰고, 없는 연도만 월별 누적(YTD)으로 만든다.**
 */

export interface PeriodRowLike {
  period_year: number;
  period_kind: string;
  period_month: number;
}

export interface PeriodColumn<T> {
  /** 화면 라벨 — '2024' 또는 '2026 YTD' */
  label: string;
  /** 그 열에 속하는 행인가 */
  match: (r: T) => boolean;
  /** YTD 열이면 누적 개월 수, 연간 열이면 null */
  ytdMonths: number | null;
}

const PASS = () => true;

export function buildPeriodColumns<T extends PeriodRowLike>(
  rows: readonly T[],
  extraFilter: (r: T) => boolean = PASS
): PeriodColumn<T>[] {
  const annualYears = new Set<number>();
  /** 연도 → 그 연도 월별 행의 최대 월 */
  const monthlyMax = new Map<number, number>();

  for (const r of rows) {
    if (!extraFilter(r)) continue;
    if (r.period_kind === 'annual') {
      annualYears.add(r.period_year);
    } else if (r.period_kind === 'monthly') {
      const prev = monthlyMax.get(r.period_year) ?? 0;
      if (r.period_month > prev) monthlyMax.set(r.period_year, r.period_month);
    }
  }

  const columns: PeriodColumn<T>[] = [...annualYears]
    .sort((a, b) => a - b)
    .map((year) => ({
      label: String(year),
      ytdMonths: null,
      match: (r: T) => extraFilter(r) && r.period_year === year && r.period_kind === 'annual',
    }));

  // 진행 중 연도 = 월별만 있고 확정 연간이 아직 없는 연도 중 가장 큰 것.
  const ytdYear = [...monthlyMax.keys()]
    .filter((y) => !annualYears.has(y))
    .sort((a, b) => b - a)[0];

  if (ytdYear !== undefined) {
    const months = monthlyMax.get(ytdYear) ?? 0;
    columns.push({
      label: months === 12 ? String(ytdYear) : `${ytdYear} YTD`,
      ytdMonths: months,
      match: (r: T) =>
        extraFilter(r) &&
        r.period_year === ytdYear &&
        r.period_kind === 'monthly' &&
        r.period_month >= 1 &&
        r.period_month <= months,
    });
  }

  return columns;
}
```

- [ ] **Step 4: 통과를 확인한다** — `npx vitest run lib/pnl/__tests__/periodColumns.test.ts`

- [ ] **Step 5: `CostStructure.tsx` 를 교체한다**

`maxYtdMonth`·`buildColumnDefs` 지역 함수를 **지우고** `buildPeriodColumns(costStructure, (r) => r.kind === 'actual')` 를 쓴다.
`ColumnDef` 타입 선언도 `PeriodColumn<CostStructureRow>` 로 갈음한다(같은 파일에 남은 참조를 전수 grep 해 고칠 것).

`:130` 의 부제 문구는 열에서 파생시킨다 — YTD 열이 없으면 그 문장을 아예 내지 않는다:

```tsx
{
  (() => {
    const ytd = columns.find((c) => c.ytdMonths !== null);
    return ytd
      ? `연결 기준 · ${ytd.label.slice(0, 4)}은 1~${ytd.ytdMonths}월 누적(YTD) 실적 · 단위 백만원`
      : '연결 기준 · 단위 백만원';
  })();
}
```

🔴 **`useMemo` 의존성 배열을 그대로 둘 것** — `[costStructure]` 로 충분하다.

- [ ] **Step 6: `FixedVariableBep.tsx` 를 교체한다**

`maxYtdMonth` 를 지우고 `buildData` 안의 `defs` 를 `buildPeriodColumns(rows)` 로 바꾼다.
`{ year, match }` 를 쓰던 자리는 `{ label, match }` 가 되므로 **`d.year` → `d.label`** 로 고친다.
이 화면은 `kind` 필터가 없으므로 `extraFilter` 를 넘기지 않는다.

- [ ] **Step 7: `FixedVariableStructure.tsx` 를 교체한다**

`maxYtdMonth`·`buildYearGroups` 를 지우고 `buildPeriodColumns(rows)` 를 쓴다.
`:366` 의 주석(`2026이면 월 누적, 그 외 연간`)은 `진행 연도면 월 누적, 그 외 연간` 으로 고친다.
`:415` 의 부제는 CostStructure 와 같은 방식으로 열에서 파생시킨다.

- [ ] **Step 8: 화면 확인**

`npm run dev` 로 `/management/pnl` 을 admin 으로 열어 **열 라벨과 열 개수**가 바뀌지 않았는지 본다.
🔴 **금액은 보고하지 않는다** — 「열 4개, 라벨 2023·2024·2025·2026 YTD 로 이전과 동일」까지만.
확인이 끝나면 **dev 서버를 반드시 종료**한다.

- [ ] **Step 9: 검증 + 커밋**

```bash
npm run check-all
git add lib/pnl/periodColumns.ts lib/pnl/__tests__/periodColumns.test.ts components/management/pnl/CostStructure.tsx components/management/pnl/FixedVariableBep.tsx components/management/pnl/FixedVariableStructure.tsx
git commit -m "fix(손익): 표 3종의 연도 열을 데이터에서 파생 — 2027에 화면이 멈추던 것"
```

---

## Task 10: `Forecast2026.tsx` → `AnnualForecast.tsx` 개명 + 연도 무관화

**왜**: 「2025 실적 → 2026 추정」이 파일명·변수명·화면 문구에 전부 박혀 있다.
1차에서 `lib/` 만 고쳐 놔서, 지금 상태로 해가 바뀌면 **라벨만 2027 로 넘어가고 카드는 2025/2026 에
남아 오히려 더 헷갈린다.**

**연도 무관 규칙**:

- `targetYear` = 월별 실적이 있는 가장 큰 연도(= 추정 대상, 옛 2026).
- `baseYear` = `targetYear - 1`(= 직전 실적, 옛 2025).
- `cagrFromYear` = `PNL_MIN_YEAR`(= 옛 2023). CAGR 기간은 `baseYear - cagrFromYear` 년.
- 정상비율 평균 대상 = `cagrFromYear` ~ `baseYear - 1`(= 옛 2023·2024).

**Files:**

- Rename: `components/management/pnl/Forecast2026.tsx` → `AnnualForecast.tsx` (**`git mv`**)
- Modify: `components/management/pnl/PnlDashboard.tsx:12,63`

- [ ] **Step 1: `git mv` 로 옮긴다**

```bash
git mv components/management/pnl/Forecast2026.tsx components/management/pnl/AnnualForecast.tsx
```

🔴 파일을 새로 쓰고 옛것을 지우지 말 것 — `git mv` 여야 히스토리가 이어진다.

- [ ] **Step 2: 컴포넌트 이름과 import 를 고친다**

`AnnualForecast.tsx` 의 `export default function Forecast2026(...)` → `AnnualForecast`.
`PnlDashboard.tsx:12` 의 import 경로·이름, `:63` 의 사용처를 같이 고친다.

- [ ] **Step 3: 연도를 파생값으로 바꾼다**

`useMemo` 맨 앞에서 두 연도를 구한다:

```typescript
// 추정 대상 = 월별 실적이 들어온 가장 큰 연도. 연도를 코드에 박으면 해가 바뀔 때 멈춘다.
const targetYear = monthlyByBasis[basis].reduce(
  (max, e) => (e.period_month >= 1 && e.period_year > max ? e.period_year : max),
  PNL_MIN_YEAR
);
const baseYear = targetYear - 1;
```

그 아래 리터럴을 전부 치환한다 — `2026` → `targetYear`, `2025` → `baseYear`,
`2024` → `baseYear - 1`, `2023` → `PNL_MIN_YEAR`.
변수명도 같이 고친다: `actual2025` → `actualBase`, `ytd_2025` → `ytdBase`, `ytd_2026` → `ytdTarget`.
`rev24`/`rev25Cs`/`op25Cs`/`v24`/`v25` → `revPrev`/`revBase`/`opBase`/`vPrev`/`vBase`.

- [ ] **Step 4: 화면 문구를 템플릿으로 바꾼다**

`'3. 2026 연간 추정'` → `` `3. ${targetYear} 연간 추정` ``,
`'2026 매출 추정'` → `` `${targetYear} 매출 추정` ``,
`actualLabel="2025 실적"` → ``actualLabel={`${baseYear} 실적`}`` …
표 헤더(`'2024 비율'`·`'2025 실제 비율'`·`'2025 초과액'`), 행 라벨, 하단 설명문의 연도까지 전부.

🔴 `rowToggleProps` 의 **첫 인자(키)는 문자열 리터럴 그대로 둔다** — `'evi-actual2025'` 같은 키는
화면 표시가 아니라 행 강조 식별자라 연도와 무관해야 안정적이다. **두 번째 인자(읽어 주는 라벨)만**
템플릿으로 바꾼다.

- [ ] **Step 5: 남은 리터럴이 없는지 기계로 확인한다**

```bash
grep -nE "\b20(2[3-9]|3[0-9])\b" components/management/pnl/AnnualForecast.tsx
```

남아도 되는 것은 **주석 안의 설명**뿐이다. JSX 텍스트·조건식에 연도가 남으면 실패.

- [ ] **Step 6: 화면 확인 + 검증 + 커밋**

`/management/pnl` 3번 카드의 라벨이 이전과 같은지 본다(금액 비보고). dev 서버 종료.

```bash
npm run check-all
git add components/management/pnl/AnnualForecast.tsx components/management/pnl/PnlDashboard.tsx
git commit -m "fix(손익): 연간 추정을 연도 무관하게 — Forecast2026 -> AnnualForecast 개명"
```

---

## Task 11: 남은 연도·UTC 하드코딩 전량 제거

**Files:**

- Modify: `lib/finance/loan-aggregate.ts:12`
- Modify: `components/oem/OemDashboard.tsx:17`
- Modify: `lib/oem/aggregate.ts:22` + `lib/oem/aggregate.test.ts` + `lib/oem/source.ts:201`
- Modify: `lib/oem-companies/kia/aggregate.ts:128,202,636,783,854,1091`
- Modify: `lib/oem-companies/hyundai/aggregate.ts:212`
- Modify: `lib/oem-companies/uzbekistan/source.ts:249`
- Modify: `lib/chat/tools.ts:229-230`
- Modify: `lib/stockSort.ts` (`FALLBACK_YEAR`)

- [ ] **Step 1: `YTD_YEAR` 2곳을 `currentYear()` 로**

```typescript
// lib/finance/loan-aggregate.ts
import { currentYear } from '@/lib/currentYear';
// const YTD_YEAR = 2026;  ← 삭제
```

`:89`, `:100` 의 `YTD_YEAR` 를 함수 본문 첫 줄에서 뽑은 `const ytdYear = currentYear();` 로 바꾼다.
🔴 **모듈 최상단 `const ytdYear = currentYear()` 로 두지 말 것** — 모듈 평가 시점에 한 번만
계산돼 장수 프로세스가 해를 넘기면 옛 값이 굳는다. **함수 안에서 부른다.**
`components/oem/OemDashboard.tsx:105` 도 같은 방식(`useMemo` 안에서 호출).

- [ ] **Step 2: `TARGET_YEAR` 를 「직전 완결 연도」로**

사용자 결정: **현재 연도 − 1**. `lib/oem/aggregate.ts`:

```typescript
/**
 * 대시보드 국가 TOP15·OEM×국가 매트릭스 집계 대상 연도 = **직전 완결 연도**.
 *
 * 연간 사전 집계 뷰를 읽으므로 진행 중 연도를 쓰면 부분 실적으로 국가 순위가 흔들린다.
 * 사용자 결정(2026-09-08): 상수 고정이 아니라 현재 연도에서 파생한다.
 */
export function targetYear(): number {
  return currentYear() - 1;
}
```

🔴 **상수 `TARGET_YEAR` 를 지우고 함수로 바꾼다** — 상수로 두면 모듈 평가 시점에 굳는다.
`lib/oem/source.ts:201` 의 `fetchCountryGroupYear(supabase, TARGET_YEAR)` 를 `targetYear()` 로.
`lib/oem/aggregate.ts:115,133,151` 의 비교도 각 함수 안에서 `const year = targetYear();` 로 뽑아 쓴다.
`lib/oem/aggregate.test.ts` 의 `TARGET_YEAR` 참조 9곳을 `targetYear()` 로 바꾼다.

🔴 **`lib/oem/source.ts` 의 `'use cache'` 함수 안에서 `targetYear()` 를 부르면
캐시 키에 연도가 안 들어간다.** `cacheLife` 가 만료되기 전까지 옛 연도 결과가 남는다 —
현재 `cacheLife('days')` 이므로 해가 바뀌고 최대 하루 지연된다. **허용 범위이며 그대로 둔다.**
(연도를 캐시 키로 올리려면 인자로 빼야 하는데, 그러면 매일 새 캐시 엔트리가 생겨 ISR Write 가 는다.)
이 판단을 주석으로 남길 것.

- [ ] **Step 3: `new Date().getFullYear()` 8곳을 `currentYear()` 로**

`kia/aggregate.ts` 6곳 · `hyundai/aggregate.ts` 1곳 · `uzbekistan/source.ts` 1곳 · `chat/tools.ts` 2곳.
전부 `import { currentYear } from '@/lib/currentYear';` 를 더하고 호출만 바꾼다.

`kia/aggregate.ts:202` 의 `isCurrentYear` 는 **lint 가 잡은 죽은 변수**다 — 선언째 지운다.
지운 뒤 그 줄이 쓰던 다른 변수가 고아가 되지 않는지 확인할 것.

`components/oem/competition/ModelCycleChart.tsx:225` 의 `new Date().getFullYear()` 는
`noteDate` 파싱 실패 시의 **폴백**이다. 여기도 `currentYear()` 로 바꾼다.

- [ ] **Step 4: `stockSort.ts` 의 `FALLBACK_YEAR` 를 창 안으로**

```typescript
// 지원 창(최근 4년) 어디에도 매출이 없으면 가장 오래된 지원 연도를 준다.
// '2025' 리터럴이었을 때는 2029 부터 창 밖 값을 돌려줬다.
const FALLBACK_YEAR = SUPPORTED_YEARS[SUPPORTED_YEARS.length - 1];
```

🔴 `SUPPORTED_YEARS` 도 **모듈 상수라 평가 시점에 굳는다.** 함수 안에서 만들도록 바꾼다:
`resolveLatestYear` 첫 줄에서 `const years = supportedYears();` 를 뽑고, `supportedYears()` 는
`Array.from({ length: 4 }, (_, i) => String(currentYear() - i))` 를 돌려주는 지역 함수로 둔다.
`SUPPORTED_YEARS` 를 밖에서 import 하는 곳이 있는지 grep 해 확인할 것.

- [ ] **Step 5: 미래 시각 회귀 테스트**

`lib/stockSort.test.ts` 가 있으면 거기에, 없으면 만든다:

```typescript
it('해가 바뀌어도 지원 연도 창이 따라 올라간다', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2030-01-05T00:00:00+09:00'));
  const rows = [{ financials_by_year: { '2029': { revenue: 1 } } } as never];
  expect(resolveLatestYear(rows)).toBe('2029');
  vi.useRealTimers();
});
```

- [ ] **Step 6: 기계 확인 + 검증 + 커밋**

```bash
grep -rn "new Date().getFullYear()" --include=*.ts --include=*.tsx lib components app
```

0건이어야 한다.

```bash
npm run check-all
git add lib/finance/loan-aggregate.ts components/oem/OemDashboard.tsx lib/oem/aggregate.ts lib/oem/aggregate.test.ts lib/oem/source.ts lib/oem-companies/kia/aggregate.ts lib/oem-companies/hyundai/aggregate.ts lib/oem-companies/uzbekistan/source.ts lib/chat/tools.ts lib/stockSort.ts components/oem/competition/ModelCycleChart.tsx
git commit -m "fix(연도): 남은 하드코딩·UTC 연도 전량 제거 — 모듈 상수 대신 함수 호출로"
```

---

## Task 12: 수집 쪽 지적 2건 — 실패 은폐 · 태그 매핑

### 12-A. `scripts/lib/nhtsa_client.py` — 리콜 조회 실패가 「리콜 0건」이 된다

**증상**: `_get()` 은 실패에 `None`, 진짜 0건에 `[]` 를 준다. 그런데 리콜 루프는
`if recalls:` 하나로 둘을 똑같이 흘려보낸다. 네트워크가 통째로 죽어도 결과는
`recalls: {'count': 0}` — 화면에는 **「리콜 없는 안전한 차」**로 나온다.
바로 아래 불만 루프는 같은 문제를 `any_ok` 로 이미 막고 있다. **형제 코드가 옳게 돼 있는데
따라가지 않은 것**(1차에서 `docs/gotchas-data-collection.md` 에 적은 그 패턴이다).

- [ ] **Step 1: 리콜 루프에 `recall_ok` 를 단다** (`_fetch` 안)

```python
    all_recalls: list[dict] = []
    recall_ok = False
    for model in variants:
      recalls = _get(RECALL_URL, make, model, year)
      if recalls is None:
        logger.warning(f'NHTSA 리콜 조회 실패 {make}/{model}/{year}')
        continue
      recall_ok = True
      all_recalls.extend(recalls)
```

- [ ] **Step 2: 한 건도 성공 못 했으면 `None` 을 넣는다**

```python
    # 한 건도 성공 못 했으면 None(=알 수 없음). 0 으로 두면 "리콜 없는 안전한 차"로 오독된다.
    if not recall_ok:
      summary = None
    else:
      summary = summarize_recalls(all_recalls) if detail else {'count': len(all_recalls)}
```

- [ ] **Step 3: 소비하는 쪽이 `None` 을 견디는지 확인한다**

```bash
grep -rn "'recalls'\|\.recalls\b" --include=*.py --include=*.ts --include=*.tsx scripts lib components app
```

TS 쪽 타입이 `recalls: {...}` 로 non-null 이면 `| null` 을 더하고 화면은 「데이터 없음」으로
떨어지게 한다. 🔴 **`recalls` 가 null 인 것을 「0건」으로 렌더하면 이 수정이 무의미해진다.**

- [ ] **Step 4: 순수 함수 회귀 테스트** — `scripts/lib/test_nhtsa_client.py` 가 있으면 거기에,
      없으면 `_fetch` 를 `_get` 만 monkeypatch 해 두 경우를 고정한다:
      ① `_get` 이 항상 `None` → 결과의 `recalls` 가 `None`.
      ② `_get` 이 항상 `[]` → 결과의 `recalls['count']` 가 `0`.

```bash
PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib -q
```

### 12-B. 캐시 태그 매핑 누락 — 수집은 성공했는데 화면이 낡는다

**실측 확인한 구멍 2개**:

1. `hyundai_retail_sales` 가 `COLUMN_TO_TAGS` 에 **키 자체가 없다.** 태그 `oem-hyundai-retail`
   (`lib/oem-companies/hyundai/source.ts:270`)은 `app/api/revalidate/route.ts` 의 `ALL_TAGS` 에도
   **없다** — 그래서 `tag=all` 로도 안 풀린다.
2. `humanoid_stocks_view` 는 `ALL_TAGS` 엔 있지만, 그 뷰가 읽는 원천 테이블
   (`companies`·`financials`·`exchange_rates_live`·`company_pages`)의 매핑에 이 태그가 없다.
   회사·재무를 수집해도 `/humanoid` 가 낡은 채로 남는다.

**처방은 두 줄 추가가 아니라 검사기다.** 같은 종류의 구멍이 또 생기지 않게 기계로 감시한다
(AGENTS.md 「기계로 판정 가능한 것은 전부 스크립트로 — 토큰 0」).

- [ ] **Step 1: 구멍 2개를 먼저 메운다**

`scripts/lib/revalidate.py`:

```python
    'hyundai_retail_sales': ['oem-hyundai-retail'],
```

를 `hyundai_quarterly_earnings` 줄 다음에 넣고,
`companies`·`financials`·`exchange_rates_live` 세 키의 리스트에 `'humanoid_stocks_view'` 를 더한다.
(`company_pages` 키가 없으면 새로 만든다 — 뷰가 읽는 테이블이다.)

`app/api/revalidate/route.ts` 의 `ALL_TAGS` 에 `'oem-hyundai-retail'` 을 더한다
(`'oem-hyundai-quarterly'` 다음 줄, 기존 정렬을 따를 것).

- [ ] **Step 2: 검사기를 만든다** — `scripts/verify_revalidate_tags.py`

세 곳의 정합성을 본다. 실패면 exit 1, 성공이면 요약 한 줄.

1. TS 소스의 `cacheTag('X')` 전수 (동적 ``cacheTag(`company:${id}`)`` 는 제외 — 백틱 리터럴은 건너뛴다)
2. `app/api/revalidate/route.ts` 의 `ALL_TAGS`
3. `scripts/lib/revalidate.py` 의 `COLUMN_TO_TAGS` 값 합집합

**판정**: (1) ⊄ (2) 면 「`tag=all` 로 안 풀리는 태그」로 실패. (3) ⊄ (2) 면 「존재하지 않는 태그를
수집기가 부른다」로 실패. (2) − (1) 은 **경고만**(쓰던 태그를 지운 잔재일 수 있다).

🔴 첫머리에 `sys.stdout.reconfigure(encoding="utf-8", errors="replace")` 를 넣는다 —
콘솔이 CP949 라 기호 출력에서 죽는다.
🔴 정규식은 `cacheTag\(\s*'([a-zA-Z0-9_\-]+)'\s*\)` 로 **작은따옴표 리터럴만** 잡는다.

- [ ] **Step 3: 검사기를 돌려 통과시킨다**

```bash
PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe scripts/verify_revalidate_tags.py
```

🔴 **처음 돌렸을 때 「위반 0건」이 나오면 검사기를 의심할 것** — Step 1 을 되돌려 놓고
돌렸을 때 **반드시 2건이 잡혀야** 검사기가 실제로 작동하는 것이다. 확인 후 Step 1 을 되살린다.

- [ ] **Step 4: AGENTS.md 검증 명령 목록에 한 줄 추가**

🔴 **AGENTS.md 자동 로드 분량 여유가 5바이트뿐이다.** 한 줄을 더하려면 **같은 커밋에서
다른 줄을 그만큼 줄여야** 한다. `verify_docs.py` 로 확인하고, 상한을 올려서 통과시키지 말 것.
줄일 여지가 없으면 **AGENTS.md 를 건드리지 말고** `docs/gotchas-data-collection.md` 에만 적는다.

- [ ] **Step 5: 검증 + 커밋**

```bash
PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib -q
PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe scripts/verify_revalidate_tags.py
PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe scripts/verify_docs.py
npm run check-all
git add scripts/lib/nhtsa_client.py scripts/lib/revalidate.py scripts/verify_revalidate_tags.py app/api/revalidate/route.ts
git commit -m "fix(수집): NHTSA 리콜 조회 실패를 0건으로 숨기던 것 + 캐시 태그 누락 2건 + 정합성 검사기"
```

---

## Task 13: 라우트·유틸 지적 6건

한 파일에 하나씩, 서로 독립이다. **6개를 한 커밋에 담지 말고 논리 단위로 2~3커밋**으로 나눈다.

- [ ] **Step 1: `app/api/cron/sentiment/route.ts:39` — DB 실패가 200 ok 가 된다**

`const { data: candidates } = await sb...` 가 `error` 를 안 받는다. 조회가 실패하면 `candidates` 가
`null` → `?? []` → 「분석할 글 없음」 → `analyzed: 0` 으로 **성공 응답**이 나간다.
cron 이 조용히 아무것도 안 하는데 모니터링은 초록이다.

```typescript
    const { data: candidates, error: candErr } = await sb
      ...
    if (candErr) {
      logger.error({ err: candErr, ticker: c.ticker }, '감성 분석 후보 조회 실패');
      return NextResponse.json(
        { ok: false, error: 'candidates_query_failed', ticker: c.ticker },
        { status: 500 }
      );
    }
```

같은 핸들러의 `already` 조회(`:52` 부근)도 **같은 함정**이다 — 실패하면 이미 분석한 글을
다시 분석해 요금이 두 배로 나간다. 같이 고친다.
`logger` 가 import 돼 있는지 확인하고 없으면 `@/lib/logger` 에서 가져온다.

- [ ] **Step 2: `lib/hansae/data.ts:89` — 「오늘」이 KST 09시부터다**

`start.setUTCHours(0,0,0,0)` 은 UTC 자정 = **KST 09:00**. KST 00:00~09:00 에 나온 뉴스가
「오늘 뉴스」에서 빠진다. 장 시작 전 뉴스가 통째로 사라지는 자리다.

```typescript
// KST 자정 — UTC 자정(setUTCHours)은 서울 09시라 새벽 뉴스가 통째로 빠진다.
const seoulToday = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const start = new Date(`${seoulToday}T00:00:00+09:00`);
```

🔴 이렇게 만든 `Date` 를 다시 `getUTC*` 로 읽지 말 것(전역 규칙). 여기서는
`start.toISOString()` 으로 넘기므로 안전하다.

- [ ] **Step 3: `lib/chat/tools.ts:206` — 사용자 입력이 PostgREST `or()` 에 그대로 들어간다**

``const term = `%${args.query}%`; q = q.or(`name.ilike.${term},...`)`` —
검색어에 **콤마 하나만 들어가도** PostgREST 가 필터 구분자로 읽어 400 이 난다.
괄호·점도 같다. 챗봇 사용자가 「현대, 기아」라고 치면 조회가 깨진다.

```typescript
if (args.query) {
  // PostgREST 의 or() 는 콤마·괄호를 구분자로 읽는다 — 검색어에 섞이면 필터가 깨진다.
  // ilike 패턴 메타문자(% _)도 함께 무력화한다.
  const safe = args.query.replace(/[,().*%_\\]/g, ' ').trim();
  if (safe) {
    const term = `%${safe}%`;
    q = q.or(`name.ilike.${term},name_kr.ilike.${term},ticker.ilike.${term}`);
  }
}
```

- [ ] **Step 4: `lib/chat/tools.ts:194` — `runQueryCompanies` 만 한세 차단을 안 거친다**

같은 파일의 `runQueryFinancials` 는 `isHansaeRestricted(role, ticker)` 로 막는데
`runQueryCompanies` 는 `role` 을 **인자로 받지도 않는다.** 제한 역할이 한세 4종목의 이름·시세·
사업개요를 그대로 가져갈 수 있다.

`runQueryCompanies(input: unknown, role: UserRole)` 로 시그니처를 맞추고(다른 실행기와 동일),
제한 역할이면 **결과에서 한세 티커 행을 걸러낸다**:

```typescript
const rows = data ?? [];
// 제한 역할에는 한세 종목을 목록에서 뺀다. 목록 조회라 에러 대신 필터가 맞다
// (runQueryFinancials 는 티커를 콕 집어 묻는 조회라 에러를 돌려준다).
const visible = HANSAE_RESTRICTED_ROLES.has(role)
  ? rows.filter((r) => !HANSAE_TICKERS.includes(r.ticker ?? ''))
  : rows;
return { rows: visible, count: visible.length };
```

🔴 **디스패처가 `role` 을 넘기고 있는지 확인할 것.** 안 넘기면 그쪽도 고친다 —
안 고치면 타입은 통과해도 `role` 이 `undefined` 라 게이트가 조용히 무력화된다.

- [ ] **Step 5: `lib/auth/actions.ts:14` — `sanitizeNext` 오픈 리다이렉트**

`//evil.com` 은 막는데 **`/\evil.com`** 은 통과한다. 브라우저가 백슬래시를 슬래시로 정규화해
프로토콜 상대 URL 로 읽는다.

```typescript
function sanitizeNext(next: unknown): string {
  if (typeof next !== 'string') return '/';
  // `//evil.com` 뿐 아니라 `/\evil.com` 도 브라우저가 프로토콜 상대 URL 로 읽는다.
  // 제어문자·개행이 섞인 값도 헤더를 오염시키므로 함께 막는다.
  if (!next.startsWith('/')) return '/';
  if (/^\/[/\\]/.test(next)) return '/';
  if (/[\x00-\x1f\x7f]/.test(next)) return '/';
  if (next.startsWith('/login')) return '/';
  return next;
}
```

`lib/auth/actions.test.ts` 가 있으면 케이스를 더하고, 없으면 만든다:
`'/\\evil.com'` · `'//evil.com'` · `'/reports'`(통과) · `'/login?x=1'` · `'/a\nb'`.

- [ ] **Step 6: `app/api/news/search/route.ts:88` — `pubDate` 하나가 깨지면 전체 502**

`new Date(pub).toISOString()` 은 파싱 실패 시 `Invalid Date` 가 되고 `toISOString()` 이
`RangeError` 를 던진다. 항목 하나 때문에 **검색 응답 전체**가 죽는다.

```typescript
// 날짜 하나가 깨졌다고 검색 전체를 죽이지 않는다 — 그 항목만 published_at=null.
let publishedAt: string | null = null;
if (pub) {
  const d = new Date(pub);
  if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
}
```

- [ ] **Step 7: 검증 + 커밋 (2~3개로 나눈다)**

```bash
npm run check-all
git add app/api/cron/sentiment/route.ts app/api/news/search/route.ts
git commit -m "fix(라우트): 조회 실패를 성공으로 보고하던 것 + 날짜 하나로 검색 전체가 죽던 것"
git add lib/auth/actions.ts lib/auth/actions.test.ts
git commit -m "fix(인증): sanitizeNext 가 백슬래시 오픈 리다이렉트를 놓치던 것"
git add lib/chat/tools.ts lib/hansae/data.ts
git commit -m "fix(챗봇): 회사 조회 한세 차단 누락 + or() 필터 주입 + 오늘 뉴스 KST 자정"
```

---

## Task 14: `/api/chat` 에 guest 게이트

사용자 결정: **guest 만 403.** 데이터 유출은 아니지만(도구 화이트리스트가 사외비를 뺀다)
요금이 나가는 통로다.

**Files:**

- Modify: `lib/auth/permissions.ts` (+ `permissions.test.ts`)
- Modify: `app/api/chat/route.ts:59` 부근

- [ ] **Step 1: 판정 함수를 더한다** — `lib/auth/permissions.ts`

```typescript
/**
 * 챗봇 사용 권한 — `/api/chat`.
 *
 * 사용자 결정(2026-09-08): guest 만 막는다. 사외비 유출 경로는 아니지만
 * (`lib/chat/tools.ts` 화이트리스트가 사외비 테이블을 뺀다) 호출마다 Anthropic 요금이 난다.
 */
export function canUseChat(role: Role): boolean {
  return role !== 'guest';
}
```

- [ ] **Step 2: 테스트를 더한다** — 5역할 전부 고정한다(4개 true, guest false).

- [ ] **Step 3: 라우트에 건다** — `app/api/chat/route.ts`

이미 `getCurrentUser()` 를 부르고 있으므로(`:59`) 그 판정 **바로 다음 줄**에 넣는다.
🔴 **응답 형태를 그 라우트의 기존 오류 응답과 맞출 것** — 이 라우트는 스트리밍(SSE)이라
다른 라우트의 `fail()` 헬퍼와 형태가 다를 수 있다. **먼저 기존 401 응답을 읽고 그 모양을 따른다.**

- [ ] **Step 4: 검증 + 커밋**

```bash
npm run check-all
git add lib/auth/permissions.ts lib/auth/permissions.test.ts app/api/chat/route.ts
git commit -m "feat(권한): guest 는 챗봇을 쓸 수 없게 — 요금 통로 차단"
```

---

## Task 15: 1차의 미검증 항목 보강

- [ ] **Step 1: 1차 Task 7 fix 의 회귀 테스트를 만든다**

1차에서 `preparePnlData` 를 「**확정 연간 행이 없는 연도만** 월별에서 derive」로 고쳤는데
**회귀 테스트가 없다** — 되돌려도 기존 테스트가 전부 통과한다.
`lib/pnl/__tests__/aggregate.test.ts` 에 순수 입력으로 두 케이스를 고정한다:

```typescript
it('확정 연간 행이 있는 연도는 월별에서 다시 derive 하지 않는다', () => {
  // 연간 1행 + 같은 해 월별 2행 → 연간 값이 살아야 하고 월별 합으로 덮이면 안 된다
});

it('연간 행이 없는 연도만 월별 누적으로 만든다', () => {
  // 전년은 연간, 올해는 월별만 → 두 해가 모두 나오고 올해만 derive
});
```

- [ ] **Step 2: `(P)` 계획값 누출 회귀를 미래 시각으로 고정한다**

```typescript
it('해가 바뀌어도 (P) 계획 라벨은 실적 집계에 안 섞인다', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2027-06-15T00:00:00+09:00'));
  // year_label '2026(P)' 행이 consolidatedAnnual 에 안 들어가야 한다
  vi.useRealTimers();
});
```

- [ ] **Step 3: JSDoc 에 남은 2026 을 고친다**

`lib/pnl/aggregate.ts:57-58` · `lib/finance/pnl-derived.ts:60`.
설명이 「2026」을 예로 드는 자리면 **「진행 연도」**로 바꾼다. 날짜가 붙은 완료 기록은 그대로 둔다.

- [ ] **Step 4: 검증 + 커밋**

```bash
npm run check-all
git add lib/pnl/__tests__/aggregate.test.ts lib/pnl/aggregate.ts lib/finance/pnl-derived.ts
git commit -m "test(손익): 1차 연도 수정의 회귀 테스트 보강 + JSDoc 연도 잔재 정리"
```

---

## 2차 최종 확인

- [ ] `npm run check-all` 4단계 통과
- [ ] `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib -q` 통과
- [ ] `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe scripts/verify_docs.py` 오류 0
- [ ] `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe scripts/verify_revalidate_tags.py` 통과
- [ ] `grep -rn "new Date().getFullYear()" --include=*.ts --include=*.tsx lib components app` 0건
- [ ] `grep -rn "currentFiscalYear" --include=*.ts --include=*.tsx lib components app` 0건
- [ ] `/management/pnl` · `/oem` 을 dev 서버로 열어 열·라벨이 이전과 같은지 확인(**금액 비보고**), 서버 종료
- [ ] `HANDOFF.md` 의 「재개 지점 — 남은 일」에서 **이번에 없앤 항목을 지운다**
