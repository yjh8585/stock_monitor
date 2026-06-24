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
- **[`docs/chart-guide.md`](./docs/chart-guide.md)** — _차트 재사용 레퍼런스_. 라이브러리 선택·유형별 레시피·스타일 토큰(색/폰트/범례/툴팁)·페이지별 카탈로그. **차트 신규 작성·기존 수정 전 반드시 정독**: 콤보는 §4-F 이중축 영역 분리(막대 `[0,max×2.5]` 하단·선 `[-max×1.5,max×1.1]` 상단)+범례 `LegendRow`(막대 왼→오 → 꺾은선), 경영관리 데이터 레이블 16px(§5). `fontSize`·축 domain·범례 순서 임의 변경 금지.
- **[`report.md`](./report.md)** — _보고서(`/reports`) 작성 규칙_. 게시 절차(자동 `/api/posts` vs 직접 INSERT+캐시 무효화)·본문 형식·**한국어 마크다운 렌더 함정(CJK 강조·단일 `~`·연도 백틱·단독 `<br>`)**·이미지(Storage `reports` 버킷)·Mermaid 규칙. **보고서 본문 작성·수정 전 정독.** 스키마는 Architecture.md §7-G.

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
- `npm run check-all`은 **TS/JS 전용**(Python 미포함). Python 변경은 `scripts/venv/Scripts/python.exe -m py_compile <files>` + 순수 로직은 venv로 직접 단위 실행해 검증.
- 수집 스크립트/워크플로 실환경 검증: `gh workflow run <name>.yml --ref master` → `gh run watch <id> --exit-status` → `gh run view <id> --log`. 간헐 실패는 `gh run list --workflow=<name>.yml`로 이력 확인.

## 디렉터리 지도

폴더는 "어떤 책임을 맡는지" 중심으로 본다. 폴더별 컨벤션·약속은 아래 기준을 따른다.

### `app/` — Next App Router (라우트 = 페이지 단위 책임)

| 라우트              | 책임 / 약속                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/related-stocks`   | 21개사 메인 표. `related_stocks_view` 뷰를 `'use cache'`로 캐싱. **컬럼 추가는 뷰부터 수정.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/compare`          | 다중 회사 비교                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/domestic`         | 국내자동차 (5사 + 매크로)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/oem`              | OEM "전체" 탭 — 글로벌 MarkLines 대시보드 + 모델 outlook. 탭 네비는 `app/oem/layout.tsx`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/oem/<slug>`       | OEM 회사별 차종 판매 (hyundai·kia·kg-mobility·stellantis-na·uzbekistan). **수집 상세 → `docs/oem-collection.md`.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/parts-top100`     | 부품사 TOP100 (Marklines 매핑)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/hansae`           | 한세그룹 대시보드 + intraday                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/etc`              | 기타정보 (해운·철강·환율·매크로 outlook·두바이유)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/reports`          | 보고서 + youtube-summary. `'use cache'` + `generateStaticParams` + `updateTag` 패턴. 메모리 `project_reports_migration.md`. **본문 작성·수정 규칙(마크다운 렌더 함정 포함) → [`report.md`](./report.md).**                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/management`       | 경영관리. 탭 **pnl / plan / inventory / production / personnel / finance / companies**. **탭별 차트·섹션 구조 상세 → [`Architecture.md §5-A`](./Architecture.md#5-a-경영관리management-탭-구조).** 약속: 사외비 테이블(`pnl_entries`·`pnl_cost_structure`·`pnl_fixed_variable`·`pnl_plan`·`inventory_entries`·`personnel_entries`·`finance_entries`·`loan_entries`)은 **반드시 `confidentialDb.from(...)`로 조회**. USD 금액은 `value × fx_rate / 100` 환산(plan·inventory), 재무는 `value_mwon / 100`(억원), 대여금은 억원 원본(`loan_eok`). `/management/companies`는 신규 회사 INSERT 폼 → 성공 시 `onboard-company.yml` 자동 트리거(fire-and-forget, 실패해도 INSERT graceful). |
| `/login`            | 세션 로그인                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/stock-popup/[id]` | 주식 팝업 (3/4 주식 + 1/4 뉴스)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

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
- React 훅: `useChartHeight`, `useIsMobile`, `useRowHighlight`(표 행 클릭→노란 음영 토글 공용 — `ROW_HIGHLIGHT_CLASS`+aria/Enter·Space. 신규 표 강조는 인라인 재구현 말고 이 훅 재사용; sticky 셀은 행 bg를 명시적으로 덮어야 따라옴)
- `lib/supabase/` — 클라이언트 4종 (**혼용 금지**):
  - `client.ts`(클라이언트 컴포넌트) / `admin.ts`(`service_role`, 서버 전용 RLS 우회 — 사외비는 직접 X, `confidential.ts` 경유) / `anon.ts`(공개 SELECT, `'use cache'` 안 권장) / `confidential.ts`(**사외비 테이블 전용 facade** — `confidentialDb.from('pnl_entries'|'pnl_cost_structure'|'pnl_fixed_variable'|'pnl_plan'|'chat_audit_log'|'inventory_entries'|'personnel_entries'|'finance_entries'|'loan_entries')...`, TS union으로 명단 외 접근 컴파일 차단 + service_role 자동 라우팅)
- `lib/auth/` — 세션·권한·사용자. **5역할**(admin/holdings/mobility/hmobility/guest) 정의는 `roles.ts`가 SSOT(server-only 아님 → `proxy.ts`/`session.ts`에서 import 가능). **역할 추가 = `roles.ts` `ROLES` + `users.ts`(env 계정·exhaustive `getDisplayNameByRole`) + `permissions.ts`(`canAccess`·landing 헬퍼) 모두 갱신**(decode 화이트리스트는 `isRole`로 자동 — 누락 시 세션 거부→로그인 무한 `/login`). 계정은 역할별 **distinct env 키**(중복 키는 dotenv가 마지막 값만 채택→로그인 깨짐), 신규 계정은 optional(env 둘 다 있을 때만 추가 → Vercel env 미설정도 기존 로그인 유지). 접근 불가 역할 추가 시 랜딩(`/`·`/management`)은 **role-aware redirect**로(고정 redirect는 무한 루프). 새 라우트 권한은 `permissions.ts`.
- **도메인 폴더** (페이지·기능 단위, 각각 `source.ts`로 fetch+cache+mapping 격리. 페이지는 호출만):
  - `lib/reports/` — **레이어드**: `dto/`(Zod) + `repositories/post.repository.ts` + `services/*`. 단순 CRUD는 caller가 `PostRepository` 직접, 라이프사이클만 `PostService`.
  - `lib/pnl/`(사외비 — `pnl_entries`·`pnl_cost_structure`·`pnl_fixed_variable`. `getFixedVariable()`는 고정비/변동비 비용구조 표 `FixedVariableStructure` 소스), `lib/plan/`(사외비 — `pnl_plan` + 차트 2·3 실적은 `getPreparedPnl()` 재사용 + FX), `lib/inventory/`(사외비 — `inventory_entries` + `aggregate.ts` pure 빌더 8종 vitest 25 tests, USD→억원 환산 `value × fx_rate / 100`), `lib/personnel/`(사외비 — `personnel_entries` + `aggregate.ts` pure 빌더 5종 vitest 14 tests. 시점은 `period_date`(과거=연말, 현재=최신)), `lib/finance/`(사외비 — `finance_entries` 대차대조표 + `aggregate.ts` pure 빌더 3종 vitest 17 tests. 억원=`value_mwon/100`, 시점은 과거=연말(annual)·당해=최신월(YTD). + `loan_entries` 대여금(이인텔리전스) — `loan-aggregate.ts` `buildLoanAchievement`/`buildLoanKpis`, 억원 원본 `loan_eok`, 차트는 재고 `InventoryAchievementChart` 재사용), `lib/related-stocks/`, `lib/domestic/`, `lib/parts-top100/`, `lib/companies/`(마스터 — `/management/companies`·`/api/companies` 입구, anon client) — `source.ts` 패턴
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
- `seed_*` / `import_*` / `sync_*` / `gen_*` / `normalize_*` / `migrate_*.ts` — 시드·일회성. 종료 후 `_archive/` 이동(단 `sync_oem_excel.py`·`import_oem_sales.py`·`sync_pnl_excel.py`·`sync_pnl_plan.py`·`sync_inventory.py`·`sync_personnel.py`·`sync_pnl_fixed_variable.py`·`sync_finance.py`·`sync_loan.py`는 정기 재실행이라 유지).
- **사외비 적재 정책** (`sync_pnl_excel.py`, `sync_pnl_plan.py`, `sync_inventory.py`, `sync_personnel.py`, `sync_pnl_cost_structure.py`, `sync_pnl_fixed_variable.py`, `sync_finance.py`, `sync_loan.py`): 입력 엑셀은 `참고/손익/자료정리_월별손익*.xlsx` 최신 glob. **stdout에 금액·인원수 비노출** — `summarize()`/dry-run 출력은 행수·연도·월·null 카운트만. revenue_sum, headcount 등 금액·수치 합계 출력 금지. `sync_inventory.py`는 추가로 4분류합 vs 전체재고 검증(mismatch 행수만 보고, 임계 0.5%), `sync_finance.py`는 자산==부채+자본 항등식 검증(mismatch 시점수만 보고, 임계 0.5%). `sync_finance.py`는 '재무' 시트 '연간' 텍스트/월=12를 annual(연말)로, 월=1~11을 monthly로 정규화하고 PK 중복행(`자본` 중복 등)을 dedupe. `sync_loan.py`는 '이인텔리전스' 시트→`loan_entries`(억원, kind '계획'/'실적' 한글 그대로, 공란→null). dry-run 안전성 확인 후 본 적재. WriteSession 자동 revalidate(`NEXT_REVALIDATE_URL` — 로컬은 localhost). **로컬 수동 실행은 프로덕션 캐시가 안 비워지므로 `--revalidate-prod` 플래그로 추가 무효화**(`NEXT_REVALIDATE_PROD_URL`+`NEXT_REVALIDATE_SECRET` 사용, 적재 성공 후 1회). `pnl_cost_structure` 포함 5종 테이블은 `lib/revalidate.py` `COLUMN_TO_TAGS`에 매핑(누락 시 무효화 no-op). **엑셀에서 행 삭제·차원(실/부문/공장/제품/거래처) 변경 시 단순 resync로는 옛 PK 행이 DB에 잔존**(sync는 8차원 충돌키 upsert-only, delete 안 함) → 해당 행 DB delete 후 resync 필수(메모리 `project_pnl_dimension_change_resync`).
- `_*.json` / `_*.log` / `_*.py` — 임시 산출물. 비활성이면 `_archive/` 이동. 이 **파일 패턴만** `.gitignore` 자동 무시 — 새 산출물 _폴더_(예: `_yt_report/`)는 `.gitignore`에 명시 추가해야 무시됨.

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
- **수집 외 경로의 캐시 무효화**: `posts` 등 `'use cache'` 테이블을 수동(tsx/직접 INSERT)으로 변경하면 `revalidateTag`를 코드에서 못 부름 → `/api/revalidate`(POST `x-revalidate-secret` + `{tags:[...]}`, 프로덕션은 `NEXT_REVALIDATE_PROD_URL`+`NEXT_REVALIDATE_SECRET`) curl 또는 로컬 dev 재시작.
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
- **사외비 테이블 격리** (`20260523000002`/`3`, `20260528000001`/`2`/`3`, `20260609000001`/`2`, `20260610000001`, `20260611000001`, `20260624000001`): `pnl_entries`·`pnl_cost_structure`·`pnl_fixed_variable`·`chat_audit_log`·`pnl_plan`·`inventory_entries`·`personnel_entries`·`finance_entries`·`loan_entries`·`management_uploads`는 RLS enable + 정책 없음(default deny) → anon 직접 접근 불가. **서버 코드는 반드시 `confidentialDb.from(...)`** (`lib/supabase/confidential.ts`, service_role 자동 + TS union 컴파일 차단). **새 사외비 테이블 5-step**: (1) 마이그레이션 `ENABLE ROW LEVEL SECURITY`(정책 X) (2) `generate_typescript_types`로 `lib/database.types.ts` 갱신(단일 테이블 추가는 generate 대신 해당 블록만 알파벳 위치에 수동 삽입 가능 — 수동 ViewRow/TableRow 헬퍼·prettier churn 방지) (3) `confidential.ts`의 `CONFIDENTIAL_TABLES`에 한 줄 (4) 업로드 API `confidentialDb...upsert + revalidateTag` (5) 페이지 `'use cache' + cacheTag + confidentialDb...select`.
- **enum형 한글 컬럼**(예: `cost_type IN ('고정비','변동비')`): DB CHECK ↔ sync 적재값 ↔ UI 필터 ↔ TS union을 **한글 그대로** 일치시킬 것. sync에서 영문 매핑하면 CHECK 위반·UI 미표시(서브에이전트 위임 시 특히 점검).
- **챗봇 외부 LLM 전송 정책** (2026-05-23/24 SSOT): 챗봇(`/api/chat`) 도구 결과는 모두 Anthropic API로 전송. (1) `lib/chat/tools.ts` 화이트리스트에 **사외비 테이블 추가 금지**(PnL 의도적 제외) (2) `lib/chat/system-prompt.ts` DATA_CATALOG에 내부 고객사·공장·제품 명단 **평문 금지** (3) 모든 도구 호출은 `chat_audit_log` 자동 기록(`lib/chat/audit.ts` fire-and-forget) (4) 사외비 토픽 거절 안내는 `lib/chat/sensitive-policy.ts`의 `BLOCKED_TOPICS` SSOT — 새 도메인은 한 줄 추가.

**챗봇 감사 로그** (`chat_audit_log`, `20260523000003`): user_id/user_role/tool_name/input_json/row_count/is_error/error_msg. RLS 정책 없음(service_role 전용). `lib/chat/loop.ts`가 도구 실행 직후 `logToolCall()` 호출(await 안 함 — 실패해도 응답 정상). 보존 1년(cron 미구현).

## Python 스크립트 규칙

- DB 접근은 **postgrest-py 직접 호출**(`scripts/lib/db.py`). `supabase` SDK 금지(인증 의존성·실패 모드 — 메모리 `feedback_supabase_postgrest.md`).
- 공통 모듈 재사용(`db.py`·`accounts_map.py`·`fx.py`). upsert 키·멱등성 확보.
- **캐시 무효화**: 두 경로 모두 자동 hook. (1) `db.upsert_rows(...)` bulk upsert는 함수 안에서 `revalidate_for_tables` 자동 호출. (2) `WriteSession` — `with WriteSession() as w: w.table('x').update(...).execute()` 블록 종료 시 누적 테이블을 자동 revalidate(`select`는 추적 X, 예외 시에도 호출, silent fail). **신규 mutating 스크립트는 반드시 WriteSession**. 정기 cron 14개 적용 완료, 잔여 일회성은 점진 마이그레이션. 테스트 `scripts/lib/test_db_writesession.py`.
- Playwright는 시스템 캐시(`PLAYWRIGHT_BROWSERS_PATH`). 프로젝트에 브라우저 다운로드 금지.
- **LLM 추출 수집기**(`collect_uzauto_financials.py`·현대 분기 IR 등)는 로컬 `scripts/.env`에 `ANTHROPIC_API_KEY`가 없어 **로컬 실행 불가**(키는 GHA Secrets 전용) → 실환경 검증은 `gh workflow run`.
- **스캔 PDF**(UzAuto IFRS 등)는 `pypdf`/`pdfplumber` 텍스트 추출이 0자 + Read 도구 렌더가 `pdftoppm`(poppler) 미설치로 실패 → venv `pymupdf`(fitz)로 페이지 렌더(`fitz.open(p)[n].get_pixmap(dpi=200).save(png)`)→Read(vision)로 판독.
- 손익/사외비 엑셀 파싱 디버깅: **openpyxl `read_only=True` 단독 결과를 신뢰하지 말 것**(행/열 인덱싱이 어긋나 부문값이 제품열로 읽히는 오진 관측) → `read_only=False`(`ws.cell`) 또는 sync의 `parse_sheet()` 직접 호출로 교차검증.
- 진단/백업 산출물(`_*.json` 등)은 임시. 커밋 전 정리.

## PowerShell 환경 메모

- 셸은 PowerShell 5.1. `&&` 미지원 → `;` 또는 `if ($?) { ... }`.
- 기본 인코딩 UTF-16 LE BOM. 외부 도구 입력은 `-Encoding utf8` 명시.
- Codex CLI는 stdin hang 회피로 `"" | codex ... --output-last-message <file>` 패턴(메모리 `reference_codex_cli_powershell.md`).
- `master`에 백업 봇이 매일 커밋(`chore(backup): daily JSONB snapshot`) → push 거부 시 `git -c rebase.autoStash=true pull --rebase origin master` 후 재push. 파이프(`... | tail`)는 앞 명령 exit code를 가림 → `git push` 실패 후 `|| (rebase)` 분기가 안 탐. push는 파이프 없이 실행하거나 종료코드 별도 확인.
- Bash `grep`이 한글/ANSI 섞인 stdout을 binary로 처리해 결과를 숨김 → `grep -a` 강제(파일 내용 검색은 Grep 도구 사용).
- venv Python stdout 한글 깨짐 → Bash 도구로 실행 시 `PYTHONIOENCODING=utf-8` 프리픽스(예: `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe ...`).
- **보호 라우트 UI Playwright 검증**: `.env.local` dotenv 로드(`MOBILITY_ID/PW`) + 클릭 후 `wait_for_url(lambda u: '/login' not in u)`(networkidle은 client redirect 전 반환). 루트 `.env.local` 로드 경로는 스크립트 깊이에 맞출 것 — `scripts/*.py`는 `parent.parent`지만 `scripts/_*/*.py`(중첩 일회성)는 `Path(__file__).resolve().parents[2]`(아니면 `scripts/.env.local`을 찾아 `MOBILITY_ID` KeyError). `LazyMount` 차트(recharts)는 IntersectionObserver라 `mouse.wheel`로 스크롤해야 마운트(`wait_for_selector` 데드락). Turbopack dev 첫 진입 시 `/management/*` 탭이 간헐 404(컴파일 캐시) → 새로고침/dev 재시작; 한 라우트를 여러 번 편집한 뒤 **404가 재시작·새로고침으로도 안 풀리면 `rm -rf .next` 후 재기동**(코드 회귀 아님). 같은 캐시 이유로 `'use cache'`(서버 fetch) 결과가 dev에서 **stale**할 수 있어(편집해도 옛 server-cache 값 표시) UI 검증 전 dev 재시작/`.next` 삭제로 fresh 확인.
  - **사외비 차트 검증**은 금액 셀 미접근 — 라벨/범례 텍스트만 `evaluate`로 추출(자격증명은 dotenv 환경 로드, stdout 비노출). 픽셀 좌표 측정은 과다 스크롤 시 화면 밖(음수 좌표)으로 오측정 → element `screenshot` 또는 `scrollTo(0,0)` 후 측정. recharts SVG `<text>`는 `inner_text()` 불가(HTMLElement 아님) → `evaluate`로 `textContent`. 스타일·구조 검증은 `getComputedStyle`(fontSize·border 등)·소수점 유무 boolean·요소 개수만 추출(금액값 미출력). **headless에선 recharts 축 틱 `<text>` 자체가 안 그려짐**(틱 라인·막대 개수만 신뢰; 라벨 문자열 정확성은 vitest로). HTML 표는 in-page에서 관계 계산(세로합==합계 등) 후 **불리언만** 출력, 구조 텍스트는 정규식으로 숫자 `#` 마스킹.
  - **로그인 계정 검증**: `getUsersFromEnv`는 모듈 레벨 캐시 → `.env.local`(계정) 변경 후 **dev 서버 재시작**(미반영 의심 시 새 포트로 fresh 기동). 로그인 redirect 체인(`/login`→`/`→`/management`→탭)은 200(RSC client redirect)이라 `wait_for_url(...'/login' not in u)`가 중간 `/`에서 조기 종료 → **최종 기대 경로까지** 대기.

## 보안 / 자격증명

> 보안 정책 전체 매트릭스는 [`Architecture.md §11`](./Architecture.md) 참고.

- 키·토큰은 `.env.local`/`scripts/.env`/GitHub Actions Secrets에만. **코드·커밋 금지.**
- **커밋 전 secret 점검**: 일부 일회성·`scripts/_archive/*` 스크립트에 자격증명(Supabase PAT 등) 하드코딩 잔재 존재. untracked 정리·신규 추적 전 `sbp_`/토큰 패턴 grep. master 직접 push라 secret 포함 시 GitHub Push Protection(GH013)이 차단 → 해당 파일 제외 후 재커밋.
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
