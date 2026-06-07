<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

## 프로젝트 개요

자동차 산업 주식 모니터링 대시보드. Next.js + Supabase로 21개사 + α의 주가·환율·재무·뉴스·DART 공시 등을 수집·시각화한다.

- 현재 단계는 `ROADMAP.md`(Phase 0~3 완료, 3.5/5 진행 중)와 `MEMORY.md`(누적 진행) 우선 확인.
- 7개 페이지: 관련주식 / 비교 / 국내자동차 / OEM / 부품사 TOP100 / 한세그룹 / 기타. `/reports`, `/management`, `/login`, `/stock-popup/[id]` 별도.

## 문서 역할 분리

- **`AGENTS.md` (이 문서)** — _작업 지침·컨벤션·약속_. 코드 작성·DB 변경·커밋 시 따라야 할 규칙. 누락 시 `.githooks/pre-commit`이 차단.
- **[`Architecture.md`](./Architecture.md)** — _시스템 구조의 단일 진실 공급원_. 테이블·뷰 컬럼/인덱스/트리거, 라우트 맵, 캐싱·배포·자동화 흐름. DB 스키마·구조 상세는 모두 여기로.
- **[`docs/oem-collection.md`](./docs/oem-collection.md)** — OEM 회사별 탭(`/oem/*`) 수집 로직·gotcha 상세.
- **[`docs/chart-guide.md`](./docs/chart-guide.md)** — _차트 재사용 레퍼런스_. 라이브러리 선택·유형별 레시피·스타일 토큰(색/폰트/범례/툴팁)·페이지별 카탈로그. 신규 차트 작성 시 참고.

> AGENTS.md는 "이 약속을 지켜라"만 다룬다. 구조 설명이 길어지면 Architecture.md로 옮기고 여기선 참조한다.

## 핵심 스택 (실제 설치값 기준)

- **Next.js 16.2.4** + React 19.2.4 + TS 5 / **Tailwind 4** + shadcn/ui + base-ui/react + lucide-react
- 차트 lightweight-charts + Recharts / Supabase JS(`@supabase/ssr`, `@supabase/supabase-js`)
- 상태 Zustand / 폼 React Hook Form + Zod / 로깅 Pino / AI `@anthropic-ai/sdk`·`@google/genai`
- 데이터 수집 Python 3 + `postgrest-py` + Playwright + pykrx + yfinance

> 글로벌 CLAUDE.md는 pnpm/uv를 권장하나 **이 프로젝트는 npm + venv 사용 중**(`package-lock.json`, `scripts/venv`). 임의 마이그레이션 금지.

## Next.js 16 주의 사항 (학습 데이터와 다름)

- **`proxy.ts`** = 구 `middleware.ts`. 루트에서 세션 쿠키 검증 + 권한 체크(`lib/auth/permissions.ts`). 새 미들웨어 로직은 여기에.
- **`cacheComponents: true`** (next.config.ts). `'use cache'` 디렉티브로 캐싱, 무효화는 `updateTag(...)`. `unstable_cache` 미사용. 패턴은 `/reports` 라우트·메모리 `project_reports_migration.md` 참고.
- `experimental.staleTimes`: 라우터 캐시 TTL 0 → 재방문 시 클라이언트 컴포넌트 재마운트, 서버 데이터는 `use cache`로 보존.
- `serverExternalPackages`로 `@napi-rs/canvas`, `pdfjs-dist`, `jsdom`, `@mozilla/readability`, `youtube-transcript`, `@supabase/ssr` 격리(번들 제외).
- 배포 설정은 **`vercel.json`** 사용 (`vercel.ts`로 옮기지 말 것). Vercel cron은 Hobby 제약(일 1회)으로 미사용, 짧은 간격 cron은 GitHub Actions(`.github/workflows/cron-*.yml`)에서 curl 트리거.

## 검증 명령 (작업 완료 후 반드시 실행)

```powershell
npm run check-all       # lint + format:check + typecheck + test 일괄
# 개별
npm run lint            # eslint .
npm run format:check    # prettier --check .
npm run typecheck       # tsc --noEmit
npm test                # vitest run (lib/**/*.test.ts)
npm run lint:fix        # 자동 수정
npm run format          # 자동 포맷
```

테스트는 `lib/` 하위 순수 함수 대상(Vitest, node 환경). `vitest.config.ts`의 `@/*` alias는 tsconfig와 동일.

- UI 변경은 `npm run dev` 띄워 브라우저에서 골든 패스 + 엣지 케이스 확인(콘솔/네트워크 에러 모니터링).
- Python 스크립트는 `scripts/venv` 활성화 후 실행. 환경변수는 `scripts/.env`.

## 디렉터리 지도

폴더는 "어떤 책임을 맡는지" 중심으로 본다. 폴더별 컨벤션·약속은 아래 기준을 따른다.

### `app/` — Next App Router (라우트 = 페이지 단위 책임)

| 라우트              | 책임 / 약속                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/related-stocks`   | 21개사 메인 표. `related_stocks_view` 뷰를 `'use cache'`로 캐싱. **컬럼 추가는 뷰부터 수정.**                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/compare`          | 다중 회사 비교                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/domestic`         | 국내자동차 (5사 + 매크로)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/oem`              | OEM "전체" 탭 — 글로벌 MarkLines 대시보드 + 모델 outlook. 탭 네비는 `app/oem/layout.tsx`.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/oem/<slug>`       | OEM 회사별 차종 판매 (hyundai·kia·kg-mobility·stellantis-na·uzbekistan). **수집 상세 → `docs/oem-collection.md`.**                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/parts-top100`     | 부품사 TOP100 (Marklines 매핑)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/hansae`           | 한세그룹 대시보드 + intraday                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/etc`              | 기타정보 (해운·철강·환율·매크로 outlook·두바이유)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/reports`          | 보고서 + youtube-summary. `'use cache'` + `generateStaticParams` + `updateTag` 패턴. 메모리 `project_reports_migration.md`.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/management`       | 경영관리. 탭 **pnl / plan / inventory / production / personnel / companies**. **탭별 차트·섹션 구조 상세 → [`Architecture.md §5-A`](./Architecture.md#5-a-경영관리management-탭-구조).** 약속: 사외비 테이블(`pnl_entries`·`pnl_cost_structure`·`pnl_plan`·`inventory_entries`·`personnel_entries`)은 **반드시 `confidentialDb.from(...)`로 조회**. USD 금액은 `value × fx_rate / 100` 환산(plan·inventory). `/management/companies`는 신규 회사 INSERT 폼 → 성공 시 `onboard-company.yml` 자동 트리거(fire-and-forget, 실패해도 INSERT graceful). |
| `/login`            | 세션 로그인                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/stock-popup/[id]` | 주식 팝업 (3/4 주식 + 1/4 뉴스)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

`app/api/`:

- **공개 라우트**: `api/cron/*`, `api/revalidate*` — `proxy.ts`의 `PUBLIC_PATH_PREFIXES`와 반드시 일치.
- **보호 라우트**(세션 필수): `api/news/search`, `api/stock-prices`, `api/posts/*`, `api/uploads/report`, `api/companies`, `api/chat`.
- `api/revalidate*`은 SSRF·쿠키 가드 패치 이력(commit `ea090be`). 회귀 주의.

### `components/`

폴더가 페이지 책임과 1:1 매핑. 새 컴포넌트는 같은 페이지 폴더에.

- `ui/` — shadcn 원자 컴포넌트 (수동 수정 금지, shadcn CLI로 추가)
- `layout/`, `common/`, `charts/` — 공용 / 나머지는 페이지별(`related-stocks/`, `oem/`, `hansae/`, `management/` 등)

### `lib/`

도메인 모듈 + 공용 유틸. 각 하위 폴더는 응집된 책임 단위.

- 공용 유틸: `format`, `utils`, `logger`, `types`, `database.types`(Supabase 생성), `series`, `stockPrices`, `compareData`, `customerLogos`, `financialFormatter` 등
- React 훅: `useChartHeight`, `useIsMobile`
- `lib/supabase/` — 클라이언트 4종 (**혼용 금지**):
  - `client.ts`(클라이언트 컴포넌트) / `admin.ts`(`service_role`, 서버 전용 RLS 우회 — 사외비는 직접 X, `confidential.ts` 경유) / `anon.ts`(공개 SELECT, `'use cache'` 안 권장) / `confidential.ts`(**사외비 테이블 전용 facade** — `confidentialDb.from('pnl_entries'|'pnl_cost_structure'|'pnl_plan'|'chat_audit_log'|'inventory_entries'|'personnel_entries')...`, TS union으로 명단 외 접근 컴파일 차단 + service_role 자동 라우팅)
- `lib/auth/` — 세션·권한·사용자 (`proxy.ts`가 사용). 새 라우트 권한은 `permissions.ts`에 등록.
- **도메인 폴더** (페이지·기능 단위, 각각 `source.ts`로 fetch+cache+mapping 격리. 페이지는 호출만):
  - `lib/reports/` — **레이어드**: `dto/`(Zod) + `repositories/post.repository.ts` + `services/*`. 단순 CRUD는 caller가 `PostRepository` 직접, 라이프사이클만 `PostService`.
  - `lib/pnl/`(사외비), `lib/plan/`(사외비 — `pnl_plan` + 차트 2·3 실적은 `getPreparedPnl()` 재사용 + FX), `lib/inventory/`(사외비 — `inventory_entries` + `aggregate.ts` pure 빌더 8종 vitest 25 tests, USD→억원 환산 `value × fx_rate / 100`), `lib/personnel/`(사외비 — `personnel_entries` + `aggregate.ts` pure 빌더 5종 vitest 14 tests. 시점은 `period_date`(과거=연말, 현재=최신)), `lib/related-stocks/`, `lib/domestic/`, `lib/parts-top100/`, `lib/companies/`(마스터 — `/management/companies`·`/api/companies` 입구, anon client) — `source.ts` 패턴
  - `lib/oem/` — `source.ts` + `aggregate.ts`(pure 4종, `aggregate.test.ts`로 단위 테스트)
  - `lib/oem-companies/<slug>/` — OEM 회사별 탭. `source.ts`(`'use cache'`+`cacheTag`+PT map LEFT JOIN) + `aggregate.ts`(pure) + `aggregate.test.ts`. 상세 → `docs/oem-collection.md`
  - `lib/hansae/`, `lib/naver/`, `lib/sentiment/`, `lib/chat/`

### `scripts/` — Python 데이터 수집

prefix 컨벤션. 신규 스크립트는 같은 카테고리 prefix 사용.

- `collect_*.py` — 외부 → DB 수집. **PDF-only 회사**(UzAuto)·**현대 분기 IR PDF**는 sha256 캐시 → 변경분만 Anthropic API(`claude-opus-4-7`) + `tool_use` 구조화 추출 패턴. 상세는 `docs/oem-collection.md` + 각 스크립트.
- `enrich_*.py` — 기존 행 보강(외부 LLM·검색). **append-only**. `enrich_company.py`는 메타+재무+뉴스 일괄.
- `onboard_company.py` — 신규 회사 추가 직후 1회 실행(ticker/name/id 식별 → enrich + 캐시 무효화). **멱등**(append-only + DB 트리거 page 매핑 + WriteSession 자동 revalidate) → 부분 실패 시 같은 명령 재실행. 비-12월 결산은 `--fiscal-year-end-month`.
- `e2e_smoke.py` — 9개 보호 라우트 자동 로그인 + 콘솔/네트워크 에러 + 스크린샷. 결과 `data/_e2e_screenshots/` + `scripts/_e2e_smoke_report.json`.
- `analyze_*` / `recheck_*` / `recollect_*` / `find_*` / `inspect_*` / `debug_*` — 진단·복원. 종료 후 **`scripts/_archive/`** 이동.
- `seed_*` / `import_*` / `sync_*` / `gen_*` / `normalize_*` / `migrate_*.ts` — 시드·일회성. 종료 후 `_archive/` 이동(단 `sync_oem_excel.py`·`import_oem_sales.py`·`sync_pnl_excel.py`·`sync_pnl_plan.py`·`sync_inventory.py`·`sync_personnel.py`는 정기 재실행이라 유지).
- **사외비 적재 정책** (`sync_pnl_excel.py`, `sync_pnl_plan.py`, `sync_inventory.py`, `sync_personnel.py`): 입력 엑셀은 `참고/손익/자료정리_월별손익*.xlsx` 최신 glob. **stdout에 금액·인원수 비노출** — `summarize()`/dry-run 출력은 행수·연도·월·null 카운트만. revenue_sum, headcount 등 금액·수치 합계 출력 금지. `sync_inventory.py`는 추가로 4분류합 vs 전체재고 검증(mismatch 행수만 보고, 임계 0.5%). dry-run 안전성 확인 후 본 적재. WriteSession 자동 revalidate(`NEXT_REVALIDATE_URL` — 로컬은 localhost). **로컬 수동 실행은 프로덕션 캐시가 안 비워지므로 `--revalidate-prod` 플래그로 추가 무효화**(`NEXT_REVALIDATE_PROD_URL`+`NEXT_REVALIDATE_SECRET` 사용, 적재 성공 후 1회). `pnl_cost_structure` 포함 5종 테이블은 `lib/revalidate.py` `COLUMN_TO_TAGS`에 매핑(누락 시 무효화 no-op).
- `_*.json` / `_*.log` / `_*.py` — 임시 산출물. 비활성이면 `_archive/` 이동(폴더 `.gitignore`가 새 산출물 자동 무시).

`scripts/lib/` (공용 모듈, 모든 스크립트 재사용):

- `bootstrap.py`(신규 스크립트 boilerplate `init_script(__file__)`) · `db.py`(**postgrest-py 클라이언트 — 모든 DB 접근 경유**) · `accounts_map.py`(계정과목) · `fx.py`(환율) · `companies.py`+`companies.json`(시드) · `kis_client.py`(KIS API) · `revalidate.py`(**수집 후 캐시 무효화 — 필수**) · `text.py`(LLM 응답 sanitize·거부 패턴 감지 quality gate) · `krx_auth.py`(**pykrx import-time 자동 로그인 크래시 방지** — pykrx import 전 `disable_pykrx_autologin()` + 수집 직전 `ensure_krx_login()`. KRX가 GHA IP에 간헐 빈응답 시 import가 죽는 문제 회피)
- 정적 매핑: `series_sources.py`, `shipping_sources.py`, `market_series.py`, `labor_targets.py`, `macro_targets.py`, `manual_dart_mapping.json`, `marklines_slugs.json`, `groups_seed.json`

### `supabase/migrations/`

- 명명 `YYYYMMDD000NNN_<설명>.sql` 시간순. 한 마이그레이션 = 한 변경 단위(View/function/RLS/constraint 모두).
- 새 파일은 **마지막 번호 다음**. 기존 파일 수정 금지.

### `.github/workflows/`

> 워크플로 전체 목록·카테고리·주기는 [`Architecture.md §10`](./Architecture.md) 참고. 신규/제거 시 §10 갱신.

- 대부분 GHA가 Python 직접 호출(로컬 venv 불필요).
- 짧은 간격 cron은 curl 트리거(Hobby 제약 회피, `cron-sentiment`). 한세 종목토론은 Vercel 60s timeout 우회로 GHA runner에서 Node tsx 직접 실행(`collect-naver-board.yml`).
- 신규 onboarding `onboard-company.yml`은 `workflow_dispatch` 전용 — `/api/companies` POST가 INSERT 성공 후 GitHub API로 자동 트리거. Vercel env `GITHUB_PAT` 필요.

### 루트 설정

- `proxy.ts`(라우트 미들웨어, 구 middleware) / `next.config.ts`(`cacheComponents`+`staleTimes`+`serverExternalPackages`) / `vercel.json`(배포, vercel.ts로 옮기지 말 것) / `.claude/agents/`(서브 에이전트 4종) / `.mcp.json`(MCP 서버)

## 데이터 흐름

> 수집 → 적재 → 캐시 무효화 → UI 전체 흐름도는 [`Architecture.md §8`](./Architecture.md) 참고.

**유의 사항 (규칙):**

- 수집 스크립트가 끝나면 **반드시 `scripts/lib/revalidate.py`로 태그 무효화**. 안 하면 페이지가 `'use cache'` 결과를 들고 있어 stale.
- 뷰(`related_stocks_view` 등)는 SQL 마이그레이션에 정의. **컬럼 추가 시 뷰부터 수정** → 페이지는 자동 반영.
- 실패·이상치는 `scripts/_*_log.json`에 기록. `analyze_*.py` 진단 후 `recheck_*.py`/`recollect_*.py`로 재처리.

## 데이터 / DB 규칙

> DB 스키마 상세(테이블·뷰 컬럼/인덱스/트리거)는 [`Architecture.md §7`](./Architecture.md#7-데이터-모델-db-스키마-상세) 참고. 본 섹션은 _지켜야 할 약속·정책_ 만.

**마이그레이션 컨벤션**: `supabase/migrations/YYYYMMDD000NNN_*.sql` 시간 정렬. 기존 파일 수정 금지, 신규는 가장 큰 번호 다음.

**데이터 정책**

- **상태값**: `companies.status = active` 만 화면 노출. `hidden`(과거 `delisted`)·`merged_into`는 자동 필터링.
- **회사명**: 트리거가 (주)·㈜·주식회사 등 자동 제거.
- **재무 우선순위**: **연결(consolidated) 우선**, 종속회사 없을 때만 별도(separate).
- **비-12월 결산 fiscal_year**: 한국식 -1 보정(덴소 4월 결산 FY2025/4~2026/3 → `fiscal_year=2025`). yfinance 자동 적용.
- **회사별 결산월**(`companies.fiscal_year_end_month`, 1~12 default 12, `20260523000001`): `collect_financials.py`가 결산월과 `period_end.month` 비교 → 일치 시 적재(비-12월이면 -1 보정), 불일치 시 분기 데이터로 판정해 SKIP(fnguide 분기 열 오적재 방지). 비-12월 신규 등록은 `onboard_company.py --fiscal-year-end-month <M>`.
- **append-only**: `customers`, `description`(=`business_summary`) 등 보강 필드는 **덮어쓰지 말고 추가만**. enrich 시 diff 로그(`scripts/_*_diff_*.json`).
- **customers 정규화 v3** (`20260522000001`/`2`/`4`): BEFORE 트리거 `companies_normalize_customers`가 `expand_customer_name()→text[]`로 자동 정규화(변경 시 `customers_updated_at`도 SET). **자동차 OEM 화이트리스트(~90)만 통과**, 부품사·반도체·placeholder 폐기. "현대기아"→`['현대차','기아']`, "GM대우/대우자동차"→`한국지엠`, "재규어·랜드로버"→`JLR`. 신규 별칭 추가 시 `expand_customer_name` + `lib/customerLogos.ts` 함께 갱신.
- **company_type 자동 분류** (`20260522000003`): 컬럼 DEFAULT `'부품사'`, OEM만 명시 입력. `products[].category`도 트리거 `companies_normalize_products`가 `normalize_product_category()`로 정규화(매핑 없으면 `'기타'`).
- **신규 회사 자동 page 매핑** (`20260522000005`/`20260526000001`): AFTER INSERT 트리거 `companies_auto_page_mapping`이 `data_source`별 기본 page 등록. dart/fnguide→domestic, yfinance/marklines→parts-top100, **uzauto-pdf→related-stocks**. `related-stocks`는 그 외 수동 등록(큐레이션). page 매핑 누락 방지(예: HL클레무브).
- **PDF-only 회사 재진술 정책** (`data_source='uzauto-pdf'`, `20260526000001`): 신규 보고서가 과거 연도 재진술 경향 → 연도 오름차순 처리로 최신 보고서가 마지막 upsert 자연 우선. sha256/etag을 `uzauto_pdf_cache`(RLS deny)에 저장, 변경분만 LLM 재호출.
- **DART 수집 상태 자동 SET** (`20260522000007`): financials 트리거 `financials_auto_set_dart_status`가 `period_type='annual' AND fiscal_year>=올해-2`일 때 `dart_collection_status='success'` 자동 SET.
- **OEM products는 차종, 부품사 products는 부품**. OEM에 부품 채우지 말 것. 제품군 카테고리 필터(`StockTable`/`DomesticTable`)는 부품사에만 적용(OEM은 항상 통과).
- **회사 description**: 추측 금지, DART 출처 제외, 홈페이지·인터넷 검색만(`enrich_description_*.py`).
- **dart_collection_status**: companies 별도 컬럼. 실패/재시도 추적은 financials와 분리.
- **사외비 테이블 격리** (`20260523000002`/`3`, `20260528000001`/`2`/`3`): `pnl_entries`·`pnl_cost_structure`·`chat_audit_log`·`pnl_plan`·`inventory_entries`·`personnel_entries`는 RLS enable + 정책 없음(default deny) → anon 직접 접근 불가. **서버 코드는 반드시 `confidentialDb.from(...)`** (`lib/supabase/confidential.ts`, service_role 자동 + TS union 컴파일 차단). **새 사외비 테이블 5-step**: (1) 마이그레이션 `ENABLE ROW LEVEL SECURITY`(정책 X) (2) `generate_typescript_types`로 `lib/database.types.ts` 갱신 (3) `confidential.ts`의 `CONFIDENTIAL_TABLES`에 한 줄 (4) 업로드 API `confidentialDb...upsert + revalidateTag` (5) 페이지 `'use cache' + cacheTag + confidentialDb...select`.
- **챗봇 외부 LLM 전송 정책** (2026-05-23/24 SSOT): 챗봇(`/api/chat`) 도구 결과는 모두 Anthropic API로 전송. (1) `lib/chat/tools.ts` 화이트리스트에 **사외비 테이블 추가 금지**(PnL 의도적 제외) (2) `lib/chat/system-prompt.ts` DATA_CATALOG에 내부 고객사·공장·제품 명단 **평문 금지** (3) 모든 도구 호출은 `chat_audit_log` 자동 기록(`lib/chat/audit.ts` fire-and-forget) (4) 사외비 토픽 거절 안내는 `lib/chat/sensitive-policy.ts`의 `BLOCKED_TOPICS` SSOT — 새 도메인은 한 줄 추가.

**챗봇 감사 로그** (`chat_audit_log`, `20260523000003`): user_id/user_role/tool_name/input_json/row_count/is_error/error_msg. RLS 정책 없음(service_role 전용). `lib/chat/loop.ts`가 도구 실행 직후 `logToolCall()` 호출(await 안 함 — 실패해도 응답 정상). 보존 1년(cron 미구현).

## Python 스크립트 규칙

- DB 접근은 **postgrest-py 직접 호출**(`scripts/lib/db.py`). `supabase` SDK 금지(인증 의존성·실패 모드 — 메모리 `feedback_supabase_postgrest.md`).
- 공통 모듈 재사용(`db.py`·`accounts_map.py`·`fx.py`). upsert 키·멱등성 확보.
- **캐시 무효화**: 두 경로 모두 자동 hook. (1) `db.upsert_rows(...)` bulk upsert는 함수 안에서 `revalidate_for_tables` 자동 호출. (2) `WriteSession` — `with WriteSession() as w: w.table('x').update(...).execute()` 블록 종료 시 누적 테이블을 자동 revalidate(`select`는 추적 X, 예외 시에도 호출, silent fail). **신규 mutating 스크립트는 반드시 WriteSession**. 정기 cron 14개 적용 완료, 잔여 일회성은 점진 마이그레이션. 테스트 `scripts/lib/test_db_writesession.py`.
- Playwright는 시스템 캐시(`PLAYWRIGHT_BROWSERS_PATH`). 프로젝트에 브라우저 다운로드 금지.
- 진단/백업 산출물(`_*.json` 등)은 임시. 커밋 전 정리.

## PowerShell 환경 메모

- 셸은 PowerShell 5.1. `&&` 미지원 → `;` 또는 `if ($?) { ... }`.
- 기본 인코딩 UTF-16 LE BOM. 외부 도구 입력은 `-Encoding utf8` 명시.
- Codex CLI는 stdin hang 회피로 `"" | codex ... --output-last-message <file>` 패턴(메모리 `reference_codex_cli_powershell.md`).

## 보안 / 자격증명

> 보안 정책 전체 매트릭스는 [`Architecture.md §11`](./Architecture.md) 참고.

- 키·토큰은 `.env.local`/`scripts/.env`/GitHub Actions Secrets에만. **코드·커밋 금지.**
- `proxy.ts`의 `PUBLIC_PATH_PREFIXES`(`/login`, `/api/cron`, `/api/revalidate`) 외 라우트는 세션 필수. 새 공개 라우트 신중히.
- `/api/revalidate*`은 토큰 검증 후 `updateTag()`. SSRF·쿠키 가드 회귀 주의(commit `ea090be`).
- **사외비 데이터**는 `service_role` 전용. NEXT_PUBLIC anon key는 클라이언트 번들 노출 → RLS `USING(true)`로 노출 금지. 새 사외비 테이블은 RLS enable + 정책 없음(default deny) 유지.

## 작업 시작 시 체크리스트

1. `MEMORY.md` 인덱스 → 관련 메모리 본문 (특히 진행 중 Phase·페이지)
2. `ROADMAP.md`에서 현재 Phase 위치 확인
3. DB 변경이면 최신 `supabase/migrations/` 파일명·순서 확인
4. 작업 후 `npm run check-all` 통과 + UI는 dev 서버에서 직접 확인

## 이 파일(AGENTS.md) 갱신 트리거

다음 변경이 발생하면 **같은 커밋에서 AGENTS.md도 같이 수정한다.** 누락은 `.githooks/pre-commit`이 차단(`USER_ACTIONS.md` §8 참고).

- `supabase/migrations/*.sql` 새 파일 → 스키마·뷰·제약이 디렉터리 지도/데이터 흐름과 갈리면 갱신
- `app/<라우트>/page.tsx` 새 파일 → 라우트 책임 표에 행 추가
- `app/oem/<slug>` 탭 변경 → `docs/oem-collection.md` 갱신
- `app/api/**/route.ts` 새 파일 → 공개/보호 라우트 목록 + `proxy.ts`의 `PUBLIC_PATH_PREFIXES` 정합성 확인
- `scripts/lib/*` 새 모듈 → 공용 모듈 목록 갱신
- `.github/workflows/*` 신규/제거 → Architecture.md §10 갱신
- `next.config.ts` / `proxy.ts` / `vercel.json` 변경 → 루트 설정 또는 Next.js 16 주의 사항 점검
- `lib/<new-domain>/` 새 도메인 폴더 → 도메인 폴더 섹션에 추가 (hook은 잡지 않음 — 사람이 챙긴다)
- `scripts/` 새 prefix 카테고리 → prefix 컨벤션 목록 갱신 (hook은 잡지 않음)
- 도메인 약속 변경(append-only / 연결 우선 / `status` 값 등) → 데이터·DB 규칙 갱신

> hook 오탐 시 `SKIP_AGENTS_CHECK=1 git commit ...`으로 우회(한 번만, 다음 커밋엔 재적용).
