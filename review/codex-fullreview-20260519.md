# Codex 전체 코드 리뷰 — 2026-05-19

> 실행: 4-Tier 분할, `codex exec --sandbox read-only` 백그라운드 4회 병렬.
> 각 Tier 원본:
> - [Tier 1 — Frontend](./codex-fullreview-tier1-frontend.md)
> - [Tier 2 — Backend](./codex-fullreview-tier2-backend.md)
> - [Tier 3 — Python Scripts](./codex-fullreview-tier3-scripts.md)
> - [Tier 4 — DB schema](./codex-fullreview-tier4-db.md)

---

## 🚨 즉시 조치 (Critical, 보안·런타임 실패·데이터 정합성)

| # | 영역 | 파일 | 이슈 | 권장 조치 |
|---|---|---|---|---|
| C1 | 백엔드(보안) | `lib/reports/services/report-web.service.ts:63` | `url.includes('marklines.com')`로 도메인 검사 → `https://attacker.example/?marklines.com`처럼 path/query에 문자열만 들어가도 통과해 **MarkLines 쿠키가 외부 호스트로 전송됨** | `new URL(url).hostname === 'www.marklines.com'` 같은 정확 비교 |
| C2 | 백엔드(보안) | `lib/reports/services/report-web.service.ts:67` | 인증 사용자가 임의 URL을 서버에서 fetch → **SSRF**. localhost, 사설망, metadata IP, redirect 미차단 | URL allowlist + 비 HTTP(S)/사설망 차단 + `redirect: 'manual'` |
| C3 | 백엔드·프론트(런타임 실패) | `app/api/revalidate/route.ts:14,59` (+ Tier1·Tier2 동시 지적) | Route Handler에서 `updateTag()` 사용. Next.js 16 문서상 `updateTag`는 **Server Action 전용** | `revalidateTag(tag, 'max')`로 교체 |
| C4 | 스크립트(데이터 손실) | `scripts/collect_dart_domestic.py:260` | DART 매칭/공시 실패를 `status='delisted'`로 저장. 이후 `status='active'`만 처리(line 205) → **일시 실패가 영구 제외로 굳음** | `dart_collection_status`/`last_collect_error`/`retry_after` 신설, delisted는 명시 신호에서만 |
| C5 | 스크립트(데이터 손실) | `scripts/rematch_dart_unmatched.py:106` | ticker 충돌 시 기존 unmatched `companies` row hard delete. FK cascade 시 financials/news/pages 동시 손실 가능 | 트랜잭션 내 종속 테이블 재매핑 후 `merged_into_company_id`/`status='merged'` soft delete |
| C6 | DB(마이그레이션 실패) | `supabase/migrations/20260506000001_add_companies_meta.sql:21` + `20260509000003_seed_marklines_top100_new.sql:10` | `company_type` CHECK는 `OEM`/`부품사`만 허용 ↔ seed가 `반도체` insert → **신규 환경에서 마이그레이션 apply 실패** | CHECK에 `반도체` 추가 또는 seed 값을 기존 enum/별도 category 컬럼으로 분리 |

---

## 🟠 High (조만간 수정)

### 캐시·revalidate
- **H1** `app/api/revalidate/route.ts:17-26,54-55` — `ALL_TAGS`에 `oem_sales_model_country_month`, `oem_model_outlook`, `pnl_entries`, `pnl_cost_structure`, `stock_prices`, `stock_quotes_5min`, `posts` 누락. `tag=all`로도 신규 페이지(OEM, PNL, stock-prices) 캐시 갱신 안 됨.
- **H2** `proxy.ts:5` + `app/api/revalidate/posts/[id]/route.ts:10` — `/api/revalidate`가 공개 처리되고 별도 secret 검증 없음 → 누구나 캐시 무효화 DoS.

### 인증·세션
- **H3** `lib/auth/actions.ts:31` — 로그인에 rate limit / lockout / audit 부재. `/login` 공개 + env 기반 계정 무제한 대입 가능.

### 레이아웃·성능
- **H4** `app/layout.tsx:32-34`, `components/layout/AppShell.tsx:5` — 루트 `<body>` 전체를 `Suspense fallback={null}`로 감싸고 `cookies()` 기반 `getCurrentUser()` 대기. **모든 페이지의 LCP 차단**. auth/사이드바만 별도 Suspense로 분리 권장.
- **H5** `components/management/pnl/YoyMonthlyCompare.tsx:25-39` 외 PNL 차트 다수 — Recharts primitive를 각각 `next/dynamic(..., { ssr:false })`로 쪼갬 → chunk waterfall 비대화. 차트별 client wrapper 1개에서 정적 import 또는 공용 chart client module로 묶기.

### 재무·데이터 정합성
- **H6** `supabase/migrations/20260428000003_create_financials.sql:46` + `scripts/collect_dart_audit.py:665,923` — `financials` unique key가 `(company_id, period_type, fiscal_year, fiscal_quarter)`만이라 `consolidation`/`source`가 빠짐. 연결/별도, yfinance/marklines/web_search가 **같은 row 덮어쓰기**.
- **H7** `supabase/migrations/20260428000003_create_financials.sql:5` — `period_type='annual'`이면 `fiscal_quarter IS NULL`, `quarterly`면 `IS NOT NULL` 의미 제약 없음 → "annual Q1" 같은 잘못된 row 허용.
- **H8** `scripts/enrich_company.py:239,474-476` + `scripts/enrich_customers_websearch.py:113` — append-only 정책 위반, customers/products replace. 메모리(`project_customers_enrichment_20260513.md`)의 append-only 원칙과 충돌.
- **H9** `scripts/collect_financials.py:692,727-734` — "키 존재"만으로 과거 데이터 skip → restatement·단위 보정·source 개선 자동 반영 안 됨. `--force-years`, `source_version`, checksum 비교 필요.

### DB 운영
- **H10** `supabase/migrations/20260507000005_drop_unused_tables_and_view.sql:9` — `watchlist`/`shareholders`/`credit_ratings` DROP. append-only 원칙 충돌, 운영 데이터 있으면 복구 불가. soft-deprecate 권장.
- **H11** `supabase/migrations/20260511000001_drop_oem_sales_monthly.sql:11` — OEM raw long 테이블 DROP. 향후 raw 분석/재적재 추적성 손실.

---

## 🟡 Medium (개선 권장)

### 백엔드
- **M1** cron 라우트들(`app/api/cron/quotes-5min/route.ts:24`, `naver-board/route.ts:20`, `sentiment/route.ts:19`)이 secret을 **query param**으로 허용 → URL 로그/Referer 유출. header-only 권장.
- **M2** `app/api/uploads/report/route.ts:38` — 업로드 검증이 브라우저 제공 `file.type`에만 의존. magic bytes(`%PDF-`) 확인 필요.
- **M3** `lib/reports/dto/post.dto.ts:25` — `report-file`의 `file_path`가 임의 문자열. 업로드 API가 반환한 객체인지/bucket prefix 패턴 검증 부재.

### 프론트엔드
- **M4** `components/related-stocks/NewsModal.tsx:68-70` — 첫 클릭 시 `opened=true` 고정 → 실패/빈 결과 후 모달 재오픈해도 재시도 안 됨.
- **M5** `components/hansae/HansaeNewsPanel.tsx:21-38`, `components/stock-popup/PopupNewsSection.tsx:58-85` — fetch 취소를 boolean flag로만 처리. stale setState는 막지만 네트워크 요청은 계속. `AbortController` 권장.
- **M6** `lib/hansae/data.ts:211-253` — Supabase client에 `as any` + eslint disable. 컬럼/타입 변경이 컴파일에서 안 잡힘.
- **M7** `components/common/StickyTable.tsx:121-133` — `touchmove` 리스너 등록/해제 옵션 불일치.

### 스크립트
- **M8** `scripts/collect_dart_domestic.py:230` — annual financials 1개라도 있으면 회사 전체 skip → 최신 연도 누락/이름 변경/DART 코드 보정 재처리 안 됨. 회사 단위가 아닌 target year별 누락 기준으로.
- **M9** `scripts/collect_marklines_direct.py:107`, `scripts/sync_oem_excel.py:59`, `scripts/marklines_login_once.py:33` — MarkLines cookie 평문을 env/state 파일에 저장. `.gitignore`/secret scan/파일 권한/만료 검증 필요.

### DB
- **M10** `supabase/migrations/20260514000001_create_posts.sql:7`, `20260515000001_create_pnl_entries.sql:5`, `20260519000002_create_pnl_cost_structure.sql:6` — 모두 `CREATE TABLE IF NOT EXISTS` 아님. 인덱스/트리거/정책도 idempotent guard 없음 → 부분 실패 복구 취약.
- **M11** PNL `period_month` 컬럼들 — 주석은 `0 또는 1~12`인데 CHECK 없음. `period_kind='annual'`이면 0, `monthly'`면 1~12 제약 필요.
- **M12** `supabase/migrations/20260519000002_create_pnl_cost_structure.sql:14` — PK에 `category` 누락 → 같은 `account`가 다른 category에서 재사용되면 충돌.
- **M13** `supabase/migrations/20260428000001_create_companies.sql:27` 외 — `service_write_*` 정책에 `WITH CHECK (true)` 명시 누락(OEM 쪽과 일관성 차이).

---

## 🟢 Low / Nit

- **L1** `app/api/stock-prices/route.ts:14` — `id` 형식 검증 없음. UUID/known company id 검증으로 캐시 키 오염 방지.
- **L2** 외부 fetch 대부분에 명시 timeout/AbortSignal 없음. 예: `app/api/news/search/route.ts:62`, `lib/naver/board.ts:61`, `lib/kiwoom/client.ts:108`.
- **L3** `components/related-stocks/NewsModal.tsx:82,100,104` — 사용자 동작마다 `console.error`. logger/telemetry 또는 dev guard 권장.
- **L4** `components/related-stocks/CustomerBadges.tsx:61` — key가 `${customerName(c)}-${i}` → 순서 변경 시 remount.
- **L5** `app/compare/page.tsx`, `app/reports/page.tsx`, `app/hansae/page.tsx` — segment-level `loading.tsx`/`error.tsx` 일부 누락.
- **L6** `scripts/lib/db.py:27` — 공통 `upsert_rows`에 dry-run/row count 검증/nullable 보호 옵션 없음.
- **L7** `supabase/migrations/20260507000006_add_domestic_page_support.sql:10` — `companies.market DROP NOT NULL` 후 listed/unlisted 구분 CHECK 없음.

---

## 📌 최우선 1주 작업 제안 (Top 5)

1. **C1 + C2**: `report-web.service.ts` 도메인 검증·SSRF 가드 — 보안 핫픽스. 1~2시간.
2. **C3 + H1 + H2**: `app/api/revalidate/route.ts` 재작성 (`revalidateTag` 마이그레이션 + ALL_TAGS 보강 + secret 검증). 캐시 시스템 안정화. 2~3시간.
3. **C6**: `companies.company_type` CHECK 마이그레이션 정리 → 신규 환경 재현 가능성 확보. 30분.
4. **C4 + C5**: DART 수집 실패 처리(`delisted` 오분류·hard delete) — 데이터 무결성 핵심. 4~6시간 + 데이터 마이그레이션.
5. **H6 + H7**: `financials` 스키마 보강 (`consolidation`/`source`를 unique key에, period semantic CHECK). 마이그레이션 + 스크립트 conflict key 동기화. 1일.

---

## 📊 영역별 한 줄 총평

- **Frontend (app + components)**: 루트 Suspense·PNL 차트 dynamic import 설계가 LCP·번들에 불리. 캐시 무효화 태그 누락 케이스 다수.
- **Backend (app/api + lib)**: revalidate API가 Next.js 16 신규 API와 충돌. reports 서비스에 보안 누락 2건이 가장 큼.
- **Python Scripts**: 데이터 정합성 위주 이슈(append-only 위반, 실패=delisted 오분류, 과거 데이터 skip). MarkLines 인증 처리 정리 필요.
- **DB schema**: append-only 원칙과 충돌하는 DROP, idempotency 부족한 최신 마이그레이션, `financials` 의미 제약 누락.

---

## ⚠️ 리뷰 제한 사항
- 모든 Tier가 `--sandbox read-only` 정적 분석. 코드 수정/타입체크/마이그레이션 apply/데이터 검증은 실행하지 않음.
- Tier 1은 codex가 `npm run typecheck` 실행 차단되어 빌드 결과 미확인.
- 일부 이슈(C3, H1)는 Tier1·Tier2가 독립적으로 동일하게 지적 — 신뢰도 높음.
