<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

## 프로젝트 개요

자동차 산업 주식 모니터링 대시보드. Next.js + Supabase로 21개사 + α의 주가·환율·재무·뉴스·DART 공시 등을 수집·시각화한다.

- 현재 단계는 `ROADMAP.md`(Phase 0~3 완료, 3.5/5 진행 중)와 `MEMORY.md`(누적 진행 상황) 우선 확인.
- 7개 페이지 구성: 관련주식 / 비교 / 국내자동차 / OEM / 부품사 TOP100 / 한세그룹 / 기타. `/reports`, `/management`, `/login`, `/stock-popup/[id]` 별도.

## 문서 역할 분리

- **`AGENTS.md` (이 문서)** — *작업 지침·컨벤션·약속*. 에이전트가 코드 작성·DB 변경·커밋 시 따라야 할 규칙. 누락 시 `.githooks/pre-commit`이 차단.
- **[`Architecture.md`](./Architecture.md)** — *시스템 구조의 단일 진실 공급원*. 28개 테이블·3개 뷰의 컬럼·인덱스·트리거 상세, 페이지 라우트 맵, 캐싱 전략, 배포 파이프라인, 자동화 흐름.

> DB 스키마 세부는 모두 Architecture.md §7로 이전됨. AGENTS.md는 "이 약속을 지켜라"만 다룬다.

## 핵심 스택 (실제 설치값 기준)

- **Next.js 16.2.4** + React 19.2.4 + TypeScript 5
- **Tailwind CSS 4** + shadcn/ui + base-ui/react + lucide-react
- 차트: lightweight-charts + Recharts
- Supabase JS (`@supabase/ssr`, `@supabase/supabase-js`)
- 상태: Zustand / 폼: React Hook Form + Zod / 로깅: Pino
- AI SDK: `@anthropic-ai/sdk`, `@google/genai`
- 데이터 수집: Python 3 + `postgrest-py` + Playwright + pykrx + yfinance

> 글로벌 CLAUDE.md는 pnpm/uv를 권장하지만 **이 프로젝트는 npm + venv를 사용 중**(`package-lock.json`, `scripts/venv` 존재). 임의로 마이그레이션하지 말 것.

## Next.js 16 주의 사항 (학습 데이터와 다름)

- **`proxy.ts`** = 이전의 `middleware.ts`. 루트의 `proxy.ts`에서 세션 쿠키 검증 + 권한 체크(`lib/auth/permissions.ts`). 새 미들웨어 로직은 여기에 추가.
- **`cacheComponents: true`** (next.config.ts). 페이지·서버 함수에 `'use cache'` 디렉티브로 캐싱. 무효화는 `updateTag(...)`. `unstable_cache`는 더 이상 사용하지 않는다. 상세 패턴은 `/reports` 라우트와 메모리 `project_reports_migration.md` 참고.
- `experimental.staleTimes`: 라우터 캐시 TTL 0 → 페이지 재방문 시 클라이언트 컴포넌트 재마운트, 서버 데이터는 `use cache`로 보존.
- `serverExternalPackages`로 `@napi-rs/canvas`, `pdfjs-dist`, `jsdom`, `@mozilla/readability`, `youtube-transcript`, `@supabase/ssr`을 외부 패키지로 격리(번들 제외).
- 배포 설정은 **`vercel.json`** 사용 중 (`vercel.ts`로 옮기지 말 것; 사용자가 요청한 적 없음). Vercel cron은 Hobby 플랜 제약(일 1회) 때문에 사용하지 않고, 짧은 간격 cron은 GitHub Actions `.github/workflows/cron-*.yml` 에서 curl로 트리거한다.

## 검증 명령 (작업 완료 후 반드시 실행)

```powershell
npm run check-all       # lint + format:check + typecheck + test 일괄
# 개별
npm run lint            # eslint .
npm run format:check    # prettier --check .
npm run typecheck       # tsc --noEmit
npm test                # vitest run (lib/**/*.test.ts)
npm run test:watch      # 개발 중 watch 모드
npm run test:coverage   # v8 커버리지 리포트
npm run lint:fix        # 자동 수정
npm run format          # 자동 포맷
```

테스트는 `lib/` 하위 순수 함수 대상 (Vitest, node 환경). `vitest.config.ts`에서 `@/*` alias가 tsconfig와 동일하게 매핑된다.

- UI 변경은 `npm run dev` 띄워 브라우저에서 골든 패스 + 엣지 케이스 확인. 콘솔/네트워크 에러 모니터링.
- Python 스크립트는 `scripts/venv` 활성화 후 실행. 환경변수는 `scripts/.env`에서 읽음.

## 디렉터리 지도

폴더는 "어떤 책임을 맡는지" 중심으로 본다. 파일 수가 많은 영역은 실제 코드를 확인하되, 폴더별 컨벤션·약속은 아래 기준을 따른다.

### `app/` — Next App Router (라우트 = 페이지 단위 책임)

| 라우트              | 책임 / 데이터 출처                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/related-stocks`   | 21개사 메인 표. `related_stocks_view` 뷰를 `'use cache'`로 캐싱. 컬럼 추가는 **뷰부터 수정**.                                                              |
| `/compare`          | 다중 회사 비교                                                                                                                                             |
| `/domestic`         | 국내자동차 페이지 (5사 + 매크로)                                                                                                                           |
| `/oem`              | OEM 페이지 + OEM 모델 outlook                                                                                                                              |
| `/parts-top100`     | 부품사 TOP100 (Marklines 매핑 기반)                                                                                                                        |
| `/hansae`           | 한세그룹 대시보드 + intraday                                                                                                                               |
| `/etc`              | 기타정보 (해운·철강·환율·매크로 outlook·두바이유)                                                                                                          |
| `/reports`          | 보고서. youtube-summary 통합. cacheComponents 호환 패턴: `'use cache'` + `generateStaticParams` + `updateTag`. 메모리 `project_reports_migration.md` 참고. |
| `/management`       | 경영관리/손익(PnL) 입력·5표·5차트. `pnl_entries`·`pnl_cost_structure` 사외비 테이블 — **`confidentialDb.from(...)`로 조회** (TypeScript로 사외비 명단 강제 + service_role 자동 라우팅, 마이그레이션 `20260523000002`)                                                                                                    |
| `/login`            | 세션 로그인                                                                                                                                                |
| `/stock-popup/[id]` | 주식 팝업 (3/4 주식 + 1/4 뉴스)                                                                                                                            |

`app/api/`:

- **공개 라우트**: `api/cron/*` (workflow가 호출), `api/revalidate*` (토큰 검증 후 `updateTag()`). `proxy.ts`의 `PUBLIC_PATH_PREFIXES`와 반드시 일치.
- **보호 라우트**: `api/news/search`, `api/stock-prices`, `api/posts/*`, `api/uploads/report` → 세션 필수.
- `api/revalidate*`은 SSRF·쿠키 가드 패치 이력 있음 (commit `ea090be`). 회귀 주의.

### `components/`

폴더가 페이지 책임과 1:1로 매핑된다. 새 컴포넌트는 같은 페이지 폴더 안에 둔다.

- `ui/` — shadcn 원자 컴포넌트 (수동 수정 금지, shadcn CLI로 추가)
- `layout/`, `common/`, `charts/` — 공용
- `related-stocks/`, `compare/`, `domestic/`, `oem/`, `hansae/`, `management/`, `reports/`, `stock-popup/`, `stock-prices/` — 페이지별

### `lib/`

도메인 모듈 + 공용 유틸. 각 하위 폴더는 응집된 책임 단위.

- 공용 유틸: `format`, `utils`, `logger`, `types`, `database.types` (Supabase에서 생성)
- 데이터 가공/정규화: `series`, `seriesRange`, `stockPrices`, `stockSort`, `compareData`, `compareMetrics`, `companyLink`, `customerLogos`, `financialFormatter`
- React 훅: `useChartHeight`, `useIsMobile`
- `lib/supabase/` — 클라이언트 4종 (역할별로 분리, **혼용 금지**):
  - `client.ts` — 클라이언트 컴포넌트
  - `admin.ts` — `service_role` (서버 전용, RLS 우회 — 신중히). 사외비 테이블은 직접 부르지 말고 `confidential.ts` 경유
  - `anon.ts` — anon (인증 없이, 공개 SELECT용. `'use cache'` 안에서 권장 — cookies 의존 없음)
  - `confidential.ts` — **사외비 테이블 전용 facade**. `confidentialDb.from('pnl_entries')...` 처럼 사용. TypeScript union으로 사외비 명단 외 접근 컴파일 차단 + service_role 자동 라우팅
- `lib/auth/` — 세션·권한·사용자 (`proxy.ts`가 사용). 새 라우트 권한은 `permissions.ts`에 등록.
- 도메인 폴더 (페이지·기능 단위):
  - `lib/reports/` — 보고서. **레이어드 구조**: `dto/post.dto.ts`(Zod 스키마), `repositories/post.repository.ts`(query·필터·CRUD), `services/{post,report-pdf,report-web,url-guard,youtube}` + `anthropic.ts`, `gemini.ts`, `pdf-page-renderer.ts`, `search.service.ts`, `api-response.ts`(API ok/fail helper). **post 영역**: 단순 CRUD는 caller가 `PostRepository` 직접 호출(`new PostRepository()` lazy), 라이프사이클(`createInitial`/`runBackground`)만 `PostService`. 다른 도메인보다 복잡도 높음.
  - `lib/pnl/` — 손익 집계 + `source.ts`(페이지 fetch+cache+mapping 격리, 사외비)
  - `lib/related-stocks/`, `lib/domestic/`, `lib/parts-top100/` — 각 페이지 fetch+cache+mapping 격리 (`source.ts`). 페이지(`app/<route>/page.tsx`)는 호출만 한다.
  - `lib/oem/` — `source.ts`(fetch+cache+오케스트레이션) + `aggregate.ts`(pure 사전 가공 4종, NA_MODEL_TARGETS 상수 포함). pure 함수는 `aggregate.test.ts`로 단위 테스트.
  - `lib/hansae/`, `lib/kiwoom/`, `lib/naver/`, `lib/sentiment/` — 페이지/기능별

### `scripts/` — Python 데이터 수집

prefix 컨벤션. 신규 스크립트는 같은 카테고리 prefix 사용.

- `collect_*.py` — 외부 → DB 수집
- `enrich_*.py` — 기존 행 보강 (외부 LLM·검색). **append-only 정책**. `enrich_company.py`는 메타(business_summary·products·customers·**homepage_url**) + 재무 + 뉴스를 일괄 보강.
- `onboard_company.py` — **신규 회사 추가 직후 1회 실행**. 단일 회사 식별(ticker/name/id) → enrich_company 트리거 → 캐시 무효화. 사용: `python scripts/onboard_company.py --ticker 005380`. 주가는 collect_prices_live cron이 자동 fetch.
- `analyze_*.py` / `recheck_*.py` / `recollect_*.py` / `find_*.py` / `inspect_*.py` / `debug_*.py` — 진단·복원
- `seed_*.py` / `import_*.py` / `sync_*.py` / `gen_*.py` / `normalize_*.py` / `migrate_*.ts` — 시드·일회성 마이그레이션
- `_*.json` / `_*.log` / `_*.py` — 임시 산출물 (커밋 전 정리)

`scripts/lib/` (공용 모듈, 모든 스크립트에서 재사용):

- `db.py` — `postgrest-py` 클라이언트 (싱글톤). **모든 DB 접근은 여기를 통한다.**
- `accounts_map.py` — 재무 계정과목 매핑
- `fx.py` — 환율 변환
- `companies.py` + `companies.json` — 회사 시드 + 헬퍼
- `kis_client.py` — 한국투자증권 API
- `revalidate.py` — 수집 완료 시 `/api/revalidate` 호출 (필수 — 안 호출하면 캐시 stale)
- `text.py` — LLM 응답 sanitize (`<cite>` 태그 제거, "죄송"·"확인할 수 없" 등 거부 응답 패턴 감지). enrich 스크립트에서 저장 직전 quality gate 용도.
- `normalize_customers_oem_only.py` — customers 추출 후 OEM 표준명으로 매핑·dedup (ALIAS_TO_STANDARD + `_normalize_one`). `enrich_products_customers_sonnet.py`에서 사용. DB 트리거(`expand_customer_name`)와 동일 정책이지만 Python에서 미리 적용해 LLM 결과를 그대로 LLM 응답에서 보존.
- `series_sources.py`, `shipping_sources.py`, `market_series.py`, `labor_targets.py`, `macro_targets.py` — 시계열·매크로 소스 매핑
- `manual_dart_mapping.json`, `marklines_slugs.json`, `groups_seed.json` — 정적 매핑

### `supabase/migrations/`

- 명명: `YYYYMMDD000NNN_<설명>.sql` (시간순)
- 한 마이그레이션 = 한 변경 단위. View / function / RLS / constraint 모두 여기에.
- 새 마이그레이션은 **마지막 파일 번호 다음**으로 생성. 기존 파일 수정 금지.

### `.github/workflows/`

24개 워크플로. 대부분 GitHub Actions가 Python 직접 호출(로컬 `scripts/venv` 없이). cron-* 3종은 Vercel cron 대체용으로 curl 호출.

- 가격·환율: 매일/매시간
- 재무: 분기별 (1/4/7/10월 15일)
- 뉴스·감성: 4시간/일간
- DART·매크로·해운·철강·원자재: 일간/주간
- Vercel cron 대체(curl 트리거): `cron-quotes-5min`, `cron-sentiment` — Hobby 플랜 일 1회 제약 회피. secret 필요: `APP_BASE_URL`, `CRON_SECRET`
- 한세 종목토론은 Vercel 60s timeout 우회 위해 GHA runner에서 Node 직접 실행: `collect-naver-board.yml` → `scripts/collect_naver_board.ts`(`@supabase/supabase-js`+`lib/naver/board.ts` 재사용). secret 필요: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

### 루트 설정

- `proxy.ts` — 라우트 미들웨어 (Next.js 16에서 구 middleware의 새 이름)
- `next.config.ts` — `cacheComponents` + `staleTimes` + `serverExternalPackages`
- `vercel.json` — 배포 설정 (vercel.ts로 옮기지 말 것). cron은 Hobby 플랜 제약으로 GitHub Actions(`cron-*.yml`)로 이전됨
- `.claude/agents/` — 서브 에이전트 4종 (dashboard-ui, data-collector, db-architect, qa-tester)
- `.mcp.json` — MCP 서버 등록

## 데이터 흐름 (수집 → 적재 → 캐시 무효화 → UI)

```
┌────────────────┐   ┌──────────────────────┐   ┌─────────────────┐   ┌───────────────────┐
│  외부 소스     │ → │ scripts/collect_*.py │ → │  Supabase       │ → │  Next.js (app/)   │
│                │   │  (postgrest-py)      │   │  + 뷰/제약      │   │  'use cache'      │
├────────────────┤   ├──────────────────────┤   ├─────────────────┤   ├───────────────────┤
│ pykrx          │   │ collect_prices       │   │ stock_prices    │   │ /related-stocks   │
│ yfinance       │   │ collect_financials   │   │ financials      │   │ /compare /oem     │
│ fnguide(PW)    │   │ collect_kr_snapshot  │   │ companies       │   │ /domestic         │
│ DART API       │   │ collect_dart_*       │   │ companies(dart) │   │ /parts-top100     │
│ ER-API / FX    │   │ collect_fx*          │   │ exchange_rates* │   │ /hansae /etc      │
│ Naver / Yahoo  │   │ collect_news         │   │ news            │   │ /reports          │
│ Marklines      │   │ collect_marklines*   │   │ (TOP100 매핑)   │   │ /management       │
└────────────────┘   └──────────────────────┘   └─────────────────┘   └───────────────────┘
                              │                                              ▲
                  GitHub Actions 24개 워크플로                                │
                  (cron · 수동 dispatch)                                      │
                              │                                              │
                              ▼                                              │
                     scripts/lib/revalidate.py                                │
                              │                                              │
                              ▼                                              │
                  /api/revalidate?tag=... ── updateTag() ────────────────────┘
                  (토큰 검증 + SSRF·쿠키 가드)
```

**유의 사항**

- 수집 스크립트가 끝나면 **반드시 `scripts/lib/revalidate.py`로 태그 무효화**. 안 하면 페이지가 `'use cache'` 결과를 계속 들고 있어 stale.
- 뷰(`related_stocks_view`, `companies_with_latest` 등)는 SQL 마이그레이션에 정의. 컬럼 추가 시 **뷰부터 수정** → Next.js 페이지는 자동으로 받게 한다.
- 실패·이상치는 `scripts/_*_log.json`에 기록. `analyze_*.py`로 진단 후 `recheck_*.py` / `recollect_*.py`로 재처리.

## 데이터 / DB 규칙

> **DB 스키마 상세 (28개 테이블 + 3개 뷰의 컬럼·인덱스·트리거)는 [`Architecture.md §7`](./Architecture.md#7-데이터-모델-db-스키마-상세) 참고.** 본 섹션은 *작업 시 지켜야 하는 약속·정책* 만 다룬다.

**마이그레이션 컨벤션**
- `supabase/migrations/YYYYMMDD000NNN_*.sql` 시간 정렬. 기존 파일 수정 금지, 신규 파일은 가장 큰 번호 다음으로.

**데이터 정책**
- **상태값**: `companies.status = active` 만 화면 노출. `hidden`(과거 `delisted`)·`merged_into`는 자동 필터링.
- **회사명**: 트리거가 (주)·㈜·주식회사 등을 자동 제거 — 수동·자동 어느 경로든 보강 가능.
- **재무 우선순위**: **연결(consolidated) 우선**, 종속회사 없을 때만 별도(separate).
- **비-12월 결산 글로벌사 fiscal_year**: 한국식 -1 보정 (예: 덴소 4월 결산 FY2025/4~2026/3 → `fiscal_year=2025`). yfinance 수집 자동 적용.
- **회사별 결산월 (`companies.fiscal_year_end_month`, 마이그레이션 `20260523000001`)**: 1~12 (default 12, CHECK 제약). `collect_financials.py`(fnguide)가 annual 적재 시 회사별 결산월과 `period_end.month`를 비교해 (a) **일치 시** 적재 + 비-12월이면 자동 한국식 -1 보정, (b) **불일치 시** 분기 데이터로 판정해 SKIP (fnguide 우측 분기 열 오적재 방지). 비-12월 결산 회사 신규 등록 시 `python scripts/onboard_company.py --ticker <T> --fiscal-year-end-month <M>`으로 지정. 기존 회사는 default 12 그대로 유지(영향 없음).
- **append-only**: `customers`, `description`(=`business_summary`) 등 보강 필드는 **덮어쓰지 말고** 추가만. 자동 enrich 시 diff 로그(`scripts/_*_diff_*.json`).
- **고객사(customers) 정규화 v3** (마이그레이션 `20260522000001`, `20260522000002`, `20260522000004`): `companies.customers` 컬럼은 BEFORE INSERT/UPDATE 트리거(`companies_normalize_customers`)가 `expand_customer_name(text)→text[]` 함수로 자동 정규화하고, 값이 변경되면 `customers_updated_at`도 `now()`로 자동 SET한다. **자동차 OEM 화이트리스트(약 90개)**만 통과시키고 부품사·반도체·가전·placeholder는 폐기. "현대기아"는 `['현대차','기아']`로 분리, "GM대우/대우자동차/GM코리아"는 `한국지엠`으로, "재규어·랜드로버"는 `JLR`로 통합. 신규 OEM 별칭 추가 시 (1) `expand_customer_name` 함수의 매핑 행, (2) `lib/customerLogos.ts`의 `CUSTOMER_LOGOS`에 로고를 함께 갱신.
- **회사 분류(company_type) 자동 분류** (마이그레이션 `20260522000003`): 컬럼 DEFAULT가 `'부품사'`. OEM은 명시적으로 입력해야 하고 그 외 신규 등록은 자동으로 부품사. `products[].category`도 BEFORE INSERT/UPDATE 트리거(`companies_normalize_products`)가 `normalize_product_category()`로 자동 정규화(매핑 없으면 `'기타'`).
- **신규 회사 자동 page 매핑** (마이그레이션 `20260522000005`): AFTER INSERT 트리거(`companies_auto_page_mapping`)가 `data_source`에 따라 기본 page 자동 등록. dart→domestic / fnguide→domestic / yfinance→parts-top100 / marklines→parts-top100. `related-stocks`는 사용자 수동 등록(중요도 큐레이션). 회사가 등록만 되고 page 매핑 누락되는 케이스(예: HL클레무브) 방지.
- **DART 수집 상태 자동 SET** (마이그레이션 `20260522000007`): financials INSERT/UPDATE 트리거(`financials_auto_set_dart_status`)가 `period_type='annual' AND fiscal_year>=올해-2`일 때 해당 회사의 `dart_collection_status`를 자동으로 `'success'`로 SET. `collect_dart_audit.py`가 status를 SET 안 하는 구조 보완 — 모든 수집 경로에서 자동 갱신.
- **OEM 회사 products는 차종**, 부품사 products는 부품/제품. OEM에 부품을 채우지 말 것. 제품군 카테고리 필터(`StockTable`/`DomesticTable`의 productCategoryFilter)는 부품사에만 적용한다(OEM은 항상 통과).
- **회사 description**: 추측 금지, DART 출처 제외, 홈페이지·인터넷 검색만 (`enrich_description_*.py` 참고).
- **dart_collection_status**: companies에 별도 컬럼. DART 수집 실패/재시도 추적은 financials와 분리.
- **사외비 테이블 격리 (마이그레이션 `20260523000002`, `20260523000003`)**: `pnl_entries`·`pnl_cost_structure`·`chat_audit_log`는 사외비. RLS enable + 정책 없음(default deny) → anon key로 PostgREST 직접 접근 불가. **서버 코드는 반드시 `confidentialDb.from(...)` (`lib/supabase/confidential.ts`)로 조회** — 자동으로 service_role 클라이언트 사용 + TypeScript union으로 사외비 명단 외 접근 컴파일 차단. **새 사외비 테이블 추가 5-step 절차**: (1) 마이그레이션에 `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` (정책 생성하지 않음) (2) `mcp__supabase__generate_typescript_types`로 `lib/database.types.ts` 갱신 (3) `lib/supabase/confidential.ts`의 `CONFIDENTIAL_TABLES` 배열에 한 줄 추가 (4) 업로드 API는 `confidentialDb.from('테이블').upsert(...) + revalidateTag(...)` (5) 페이지는 `'use cache' + cacheTag(...) + confidentialDb.from('테이블').select(...)`. 향후 경영관리 하부 페이지(계획·재고·생산 등) 모두 동일 패턴.
- **챗봇 외부 LLM 전송 정책 (2026-05-23)**: 챗봇(`/api/chat`)이 호출하는 도구의 결과는 모두 Anthropic API로 전송된다. (1) `lib/chat/tools.ts`의 도구 화이트리스트에 **사외비 테이블을 추가하지 말 것** — PnL은 의도적으로 제외됨. (2) `lib/chat/system-prompt.ts`의 DATA_CATALOG에는 회사 내부 고객사·공장·제품 명단을 **평문으로 박지 말 것** — 매 호출마다 전송됨. (3) 모든 도구 호출은 `chat_audit_log`에 자동 기록(`lib/chat/audit.ts` fire-and-forget). 새 도구 추가 시 별도 작업 없이 그대로 기록됨.

**챗봇 감사 로그 (`chat_audit_log`, 마이그레이션 `20260523000003`)**
- 컬럼: id(bigserial), user_id, user_role, tool_name, input_json(jsonb), row_count, is_error, error_msg, created_at
- RLS 정책 없음 → service_role(admin) 전용 INSERT/SELECT
- 보존 1년 (수동 운영 또는 별도 cron — 현재 미구현)
- `lib/chat/loop.ts`가 도구 실행 직후 `logToolCall()` 호출 (await 안 함). 실패해도 챗봇 응답은 정상 진행.

## Python 스크립트 규칙

- DB 접근은 **`postgrest-py` 직접 호출** (`scripts/lib/db.py`). `supabase` SDK 사용 금지 (인증 의존성·실패 모드 이슈로 제외). 메모리 `feedback_supabase_postgrest.md` 참고.
- 공통 유틸: `scripts/lib/db.py`(클라이언트), `scripts/lib/accounts_map.py`(계정과목 매핑), `scripts/lib/fx.py`(환율 변환).
- 신규 수집 스크립트는 위 공통 모듈 재사용. upsert 키와 멱등성 확보.
- **캐시 무효화 컨벤션**: 두 가지 경로 모두 자동 hook이 동작한다.
  - (1) `db.upsert_rows(table, rows, conflict_cols)` — bulk upsert는 함수 안에서 `revalidate_for_tables([table])` 자동 호출.
  - (2) `WriteSession` (`scripts/lib/db.py`) — `client.table().update/upsert/delete/insert` 직접 호출 패턴용. `with WriteSession() as w:` 블록 안에서 `w.table('x').update(...).eq(...).execute()` 처럼 쓰면, 블록을 빠져나가는 순간 `__exit__`에서 누적된 테이블 집합을 자동으로 `revalidate_for_tables([...])`로 펼친다. `select`는 추적하지 않는다 (read-only). 예외가 발생해도 누적분은 revalidate 호출 (postgrest는 트랜잭션이 아니라 부분 commit 가능 — 안전 우선). revalidate 자체는 silent fail. 신규 mutating 스크립트는 **반드시 WriteSession 사용**. 정기 cron 14개(`collect_*`, `enrich_*`, `onboard_company`) 모두 적용 완료. 잔여 일회성 스크립트(`seed_*`, `normalize_*`, `recollect_*`, `_*`)는 다음 운영 시 점진 마이그레이션.
  - 자동 테스트: `scripts/lib/test_db_writesession.py` (unittest, mock 기반 16 cases). 실행은 `scripts/venv/Scripts/python.exe scripts/lib/test_db_writesession.py`.
- Playwright는 시스템 캐시(`PLAYWRIGHT_BROWSERS_PATH`) 사용. 프로젝트에 브라우저 다운로드 금지.
- 진단/백업 산출물(`_*.json`, `_*_backup_*.json`)은 임시 파일. 커밋 전 정리 필요.

## PowerShell 환경 메모

- 셸은 PowerShell 5.1. `&&` 미지원 → `;` 또는 `if ($?) { ... }`.
- 기본 파일 인코딩은 UTF-16 LE BOM. 외부 도구 입력은 `-Encoding utf8` 명시.
- Codex CLI 호출 시 stdin hang 회피를 위해 `"" | codex ... --output-last-message <file>` 패턴 사용. 메모리 `reference_codex_cli_powershell.md` 참고.

## 보안 / 자격증명

- 키·토큰은 `.env.local` / `scripts/.env` / GitHub Actions Secrets에만. 코드/커밋 금지.
- `proxy.ts`의 `PUBLIC_PATH_PREFIXES`(`/login`, `/api/cron`, `/api/revalidate`) 외 라우트는 세션 필수. 새 공개 라우트 추가 시 신중히 검토.
- `/api/revalidate*`은 토큰 검증 후 `updateTag()` 실행. SSRF·쿠키 가드 강화 이력 있음(commit `ea090be`). 보안 패치 회귀 주의.
- **사외비 데이터 (PnL 등)** 는 `service_role` (admin client) 전용. NEXT_PUBLIC anon key는 클라이언트 번들에 노출되므로 RLS `USING(true)` 정책으로 노출시키지 말 것. 새 사외비 테이블 생성 시 RLS enable + 정책 없음(default deny) 패턴 유지.
- **AI 챗봇 외부 전송**: `/api/chat`은 도구 결과를 Anthropic API에 전송 (기본 30일 로그 보관, ZDR 미적용). 사외비 데이터는 챗봇 도구·system-prompt 어디에도 노출 금지. 외부 LLM 경로를 새로 추가할 때(GenAI, OpenAI 등) 같은 정책 적용.

## 작업 시작 시 체크리스트

1. `MEMORY.md` 인덱스 → 관련 메모리 본문 읽기 (특히 진행 중인 Phase·페이지)
2. `ROADMAP.md`에서 현재 Phase 위치 확인
3. 변경 범위가 DB라면 최신 `supabase/migrations/` 파일명·순서 확인
4. 작업 후 `npm run check-all` 통과 + UI는 dev 서버에서 직접 확인

## 이 파일(AGENTS.md) 갱신 트리거

다음 변경이 발생하면 **같은 커밋에서 AGENTS.md도 같이 수정한다.** 누락은 `.githooks/pre-commit`이 차단한다 (`USER_ACTIONS.md` §8 참고).

- `supabase/migrations/*.sql` 새 파일 → 스키마·뷰·제약이 디렉터리 지도/데이터 흐름과 갈리면 본문 갱신
- `app/<라우트>/page.tsx` 새 파일 → 라우트 책임 테이블에 행 추가
- `app/api/**/route.ts` 새 파일 → 공개/보호 라우트 목록 갱신 + `proxy.ts`의 `PUBLIC_PATH_PREFIXES`와 정합성 확인
- `scripts/lib/*` 새 모듈 → 공용 모듈 목록 갱신
- `.github/workflows/*` 신규/제거 → 카테고리·개수 갱신
- `next.config.ts` / `proxy.ts` / `vercel.json` 변경 → 루트 설정 또는 Next.js 16 주의 사항 섹션 점검
- `lib/<new-domain>/` 새 도메인 폴더 → 도메인 폴더 섹션에 추가 (hook은 잡지 않음 — 사람이 챙긴다)
- `scripts/` 새 prefix 카테고리 → prefix 컨벤션 목록 갱신 (hook은 잡지 않음)
- 도메인 약속 변경 (append-only / 연결 우선 / `status` 값 등) → 데이터·DB 규칙 갱신

> hook이 오탐인 경우 `SKIP_AGENTS_CHECK=1 git commit ...`으로 우회 (한 번만 우회되고 다음 커밋엔 다시 적용됨).
