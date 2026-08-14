<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

## 프로젝트 개요

자동차 산업 주식 모니터링 대시보드. Next.js + Supabase로 21개사 + α의 주가·환율·재무·뉴스·DART 공시 등을 수집·시각화한다.

- 현재 단계는 `ROADMAP.md`(Phase 0~3 완료, 3.5/5 진행 중)와 **개인 메모리**(누적 진행) 우선 확인. 🔴 메모리는 **이 레포에 없다** — `~/.claude/projects/C--Users-junghwan-yoon-workspace-1-----stock-monitor/memory/`의 `MEMORY.md` 인덱스가 실물이다.
- 7개 페이지: 관련주식 / 비교 / 국내자동차 / OEM / 부품사 TOP100 / 한세그룹 / 기타. `/reports`, `/management`, `/login`, `/stock-popup/[id]` 별도.

## 문서 역할 분리

- **`AGENTS.md` (이 문서)** — _작업 지침·컨벤션·약속_. 코드 작성·DB 변경·커밋 시 따라야 할 규칙. 누락 시 `.githooks/pre-commit`이 차단.
- **[`Architecture.md`](./Architecture.md)** — _시스템 구조의 단일 진실 공급원_. 테이블·뷰 컬럼/인덱스/트리거, 라우트 맵, 캐싱·배포·자동화, 폴더별 **모듈 구성**. **DB 스키마 확인·구조 변경 전.**
- **[`report.md`](./report.md)** — _보고서(`/reports`) 작성 규칙_. 게시 절차·본문 형식·**한국어 마크다운 렌더 함정(§4)**·이미지·Mermaid·유튜브 워크플로(§7). **보고서 본문 작성·수정 전 정독.** **⚠️ 유튜브 보고서는 주요 장면·차트를 반드시 캡처·삽입(차트 누락 금지, 사용자 지시 2026-07-18) — §7-4·§7-A·§8 필수 체크.**
- **[`docs/chart-guide.md`](./docs/chart-guide.md)** — _차트 재사용 레퍼런스_. **차트 신규·수정 전 정독**(콤보 이중축 영역 분리 §4-F · 스타일 토큰·글자 크기 §5). `fontSize`·축 domain·범례 순서 임의 변경 금지.
- **[`docs/gotchas-data-collection.md`](./docs/gotchas-data-collection.md)** — _수집·적재·파싱 함정 정본_. **수집기 수정 전 정독.**
- **[`docs/gotchas-playwright-ui.md`](./docs/gotchas-playwright-ui.md)** — _Playwright·UI 검증 함정_. **UI를 브라우저로 검증하기 전 정독.**
- **[`docs/gotchas-ci-deploy.md`](./docs/gotchas-ci-deploy.md)** — _CI·배포·플랫폼 운영 함정_(GHA 실패 판별·Vercel 배포 확인·Supabase MCP 우회·PowerShell). **워크플로를 돌리거나 배포를 확인하기 전 정독.**
- **[`docs/oem-collection.md`](./docs/oem-collection.md)** — OEM 회사별 탭(`/oem/*`) 수집 로직·MarkLines 함정. **OEM 탭 작업 전.**
- **[`docs/isr-write-optimization.md`](./docs/isr-write-optimization.md)** — _Vercel ISR Write 한도 대응_. **주식 뷰 3종(`related`/`domestic`/`parts-top100`)의 payload·cacheTag를 건드리기 전 정독** — `cacheTag('exchange_rates_live')`를 되돌리거나 `financials_by_year` 트리밍을 풀면 한도가 다시 터진다.
- **[`docs/fnguide-wcomp-migration.md`](./docs/fnguide-wcomp-migration.md)** — fnguide 신버전(wcomp) JSON 계약표·계정 코드. **`scripts/verify_fnguide.py`가 실패했을 때.**
- **[`docs/data-audit-2026-07-18.md`](./docs/data-audit-2026-07-18.md)** — 2026-07-18 데이터 감사 원본 기록.

> AGENTS.md는 "이 약속을 지켜라"만 다룬다. 구조 설명이 길어지면 Architecture.md로 옮기고 여기선 참조한다.
>
> 🔴 **새로 배운 함정은 AGENTS.md 본문이 아니라 `docs/gotchas-*.md`에 적는다.** 여기 쌓으면 매 세션 자동 로드 분량이 다시 불어난다(경위·실측 수치 = `scripts/verify_docs.py` docstring). 트리거가 새로우면 위 목록에 **한 줄만** 추가한다.
>
> ⚠️ **표 셀에 긴 서술을 넣지 말 것** — prettier가 가장 긴 셀에 맞춰 모든 행을 패딩해 정렬 공백이 폭증한다. 긴 내용은 표 아래 `#### 상세` 블록으로 빼고 표에는 한 줄 요약만 남긴다.

## 핵심 스택 (실제 설치값 기준)

- **Next.js 16.2.4** + React 19.2.4 + TS 5 / **Tailwind 4** + shadcn/ui + base-ui/react / 차트 lightweight-charts + Recharts / Supabase JS(`@supabase/ssr`) / Zustand · RHF+Zod · Pino / AI `@anthropic-ai/sdk`·`@google/genai` / 수집 Python 3 + `postgrest-py` + Playwright + pykrx + yfinance. 상세·버전 정본 = [`Architecture.md §2`](./Architecture.md).

> 글로벌 CLAUDE.md는 pnpm/uv를 권장하나 **이 프로젝트는 npm + venv 사용 중**(`package-lock.json`, `scripts/venv`). 임의 마이그레이션 금지.

## Next.js 16 주의 사항 (학습 데이터와 다름)

- **`proxy.ts`** = 구 `middleware.ts`. 루트에서 세션 쿠키 검증 + 권한 체크(`lib/auth/permissions.ts`). 새 미들웨어 로직은 여기에.
- **`cacheComponents: true`** (next.config.ts). `'use cache'` 디렉티브로 캐싱, 무효화는 `updateTag(...)`. `unstable_cache` 미사용. 패턴은 `/reports` 라우트·메모리 `project_reports_migration.md` 참고.
- `experimental.staleTimes`(라우터 캐시 TTL 0) · `serverExternalPackages`(`@napi-rs/canvas`·`pdfjs-dist`·`jsdom` 등 번들 제외) — 설정 근거는 [`Architecture.md §9`](./Architecture.md).
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

Python 쪽 상시 검사(토큰 0, 문서·수집 계약 회귀 감시):

```powershell
scripts/venv/Scripts/python.exe scripts/verify_docs.py     # 표 구조·상대 링크·자동 로드 분량
scripts/venv/Scripts/python.exe scripts/verify_fnguide.py  # fnguide 수집 계약 (주 1회 GHA도 실행)
scripts/venv/Scripts/python.exe -m pytest scripts/lib -q   # 순수 함수 회귀
```

테스트는 `lib/` 하위 순수 함수 대상(Vitest, node 환경). `vitest.config.ts`의 `@/*` alias는 tsconfig와 동일.

- UI 변경은 `npm run dev` 띄워 브라우저에서 골든 패스 + 엣지 케이스 확인(콘솔/네트워크 에러 모니터링). **`pnpm run dev` 금지** — pnpm 11이 스크립트 실행 전 의존성 검사를 돌리다 `ERR_PNPM_IGNORED_BUILDS`(sharp·esbuild·@google/genai 등 5개 빌드 미승인)로 exit 1 나서 dev가 아예 안 뜬다. 포트 3000은 다른 앱 점유라 3001+로 자동 배정된다.
- Python 스크립트는 `scripts/venv` 활성화 후 실행. 환경변수는 `scripts/.env`.
- `npm run check-all`은 **TS/JS 전용**(Python 미포함). Python 변경은 `scripts/venv/Scripts/python.exe -m py_compile <files>` + 순수 로직은 venv로 직접 단위 실행해 검증.
- 수집 스크립트/워크플로 실환경 검증: `gh workflow run <name>.yml --ref master` → `gh run watch <id> --exit-status` → `gh run view <id> --log`. 🔴 **실패가 인프라 탓인지 먼저 가르고**(동시다발 실패는 거의 항상 GitHub 장애), **수집 로그는 tail로 읽지 말 것**(pykrx stdout이 뒤섞여 무해한 메시지가 끝에 몰린다) → **[`docs/gotchas-ci-deploy.md`](./docs/gotchas-ci-deploy.md) §1.**
- 프로덕션 = `stock-monitor-orcin.vercel.app`. **scripts/워크플로 변경은 재배포 불필요**(GHA가 master 체크아웃)지만 **`app/`·`components/` UI 변경은 Vercel 재배포(push→빌드 READY) 후** E2E 검증. 🔴 **`list_deployments` 시간필터는 오도하고 빈 커밋 재트리거는 무의미** → 확인법은 **[`docs/gotchas-ci-deploy.md`](./docs/gotchas-ci-deploy.md) §2.**
- **Supabase MCP가 세션 중 `Unauthorized`면** 재시작으로 세션을 버리지 말고 `scripts/.env`의 **`SUPABASE_Pesonal_Access_Token`(오타가 실제 키 이름)** + Management API 직접 호출로 우회한다 → 끝점·User-Agent 필수·마이그레이션 이력 보정은 **[`docs/gotchas-ci-deploy.md`](./docs/gotchas-ci-deploy.md) §3.**

## 디렉터리 지도

폴더는 "어떤 책임을 맡는지" 중심으로 본다. 폴더별 컨벤션·약속은 아래 기준을 따른다.

### `app/` — Next App Router (라우트 = 페이지 단위 책임)

| 라우트              | 책임 / 약속                                                        |
| ------------------- | ------------------------------------------------------------------ |
| `/related-stocks`   | 21개사 메인 표(`related_stocks_view`). **컬럼 추가는 뷰부터 수정** |
| `/compare`          | 다중 회사 비교                                                     |
| `/domestic`         | 국내자동차 (421개사 + 매크로)                                      |
| `/oem`              | OEM "전체" 탭 — MarkLines 대시보드                                 |
| `/oem/competition`  | 핵심 차종 경쟁 분석 (10종 · 월 1회 갱신) — **↓ 상세**              |
| `/oem/<slug>`       | OEM 회사별 차종 판매 — **↓ 상세**                                  |
| `/parts-top100`     | 부품사 TOP100 (Marklines 매핑)                                     |
| `/hansae`           | 한세그룹 대시보드 + intraday                                       |
| `/etc`              | 기타정보 (해운·철강·환율·매크로·두바이유)                          |
| `/reports`          | 보고서 + youtube-summary — **↓ 상세**                              |
| `/management`       | 경영관리 10탭 (사외비) — **↓ 상세**                                |
| `/login`            | 세션 로그인                                                        |
| `/stock-popup/[id]` | 주식 팝업 (3/4 주식 + 1/4 뉴스)                                    |

`/oem` 탭 네비는 `app/oem/layout.tsx`, 차트 카탈로그는 `docs/chart-guide.md`. **`/oem/<slug>`(hyundai·kia·kg-mobility·stellantis-na·uzbekistan) 수집 상세 → [`docs/oem-collection.md`](./docs/oem-collection.md).** `/management`는 `confidentialDb` 필수, `/reports`는 `'use cache'`+`generateStaticParams`+`updateTag`.

#### `/oem/competition` 상세

스코어보드 + 차트 7종(`components/oem/competition/`). 화면 → [`Architecture.md §5`](./Architecture.md) · 수집 → [`docs/oem-collection.md`](./docs/oem-collection.md) · 차트 → [`docs/chart-guide.md §3`](./docs/chart-guide.md). 약속만:

- 🔴 **SSOT 3개를 코드에 다시 박지 말 것** — 경쟁군 `oem_competitor_set` · 모델→Cox 브랜드 `oem_model_brand`(바꾸려면 새 마이그레이션) · 신호등 임계값 `signals.ts`의 `SIGNAL_THRESHOLDS`(판정·툴팁 문구 모두). 종합 라벨은 **AI 판단 그대로** 쓴다.
- 다중 시장은 **시장 탭**(유럽은 `countries` 배열). 순서 = `MODEL_DISPLAY_ORDER`.
- 🔴 Cox(브랜드 **유통재고**)·NHTSA는 **미국 전용** — **USA·GLOBAL 탭에만**, **GLOBAL은 등급 제외**(`usMetricsBasis`). 이상치 제외=**2배 초과 RED**. `metrics` 키를 바꾸면 차트가 조용히 비니 `types.ts`와 같이 고칠 것.

#### `/reports` 상세

보고서 + youtube-summary(`'use cache'`+`generateStaticParams`+`updateTag`). **본문 규칙·사외비 게시 절차(§2-C)·유튜브 경로(§2-A·§7) → [`report.md`](./report.md) 정독.** 약속만 여기 싣는다:

- **사외비 보고서**(`posts.is_confidential`)는 RLS가 anon 읽기를 막고 `canAccessConfidentialReports`(admin·holdings·mobility)가 service_role 조회를 게이트한다 — 목록·상세 `'use cache'` 함수에 `includeConfidential`을 **인자로** 넘겨 역할별 캐시를 분리하므로 **새 호출부에서 이 인자를 빠뜨리지 말 것**.

#### `/management` 상세

경영관리 10탭(pnl·plan·stellantis·inventory·production·personnel·finance·org-chart·upload·companies). **탭별 차트·섹션 구조 → [`Architecture.md §5-A`](./Architecture.md#5-a-경영관리management-탭-구조).** 약속만 여기 싣는다:

- 사외비 테이블은 **반드시 `confidentialDb.from(...)`로 조회**. 🔴 **명단 정본은 `lib/supabase/confidential.ts`의 `CONFIDENTIAL_TABLES`**(2026-08-12 기준 12종 — 여기 다시 나열하지 말 것. 문서에 베껴 적었더니 9종·5종으로 갈려 있었다).
- 탭 노출은 `ALL_TABS` + `canAccess` 자동 필터라 **신규 경영관리 탭에 `permissions.ts` 수정은 불필요**(guest·hmobility 자동 차단). 더 좁은 권한만 명시 — `/management/upload`는 admin 전용(`ADMIN_ONLY_PATHS`).
- **단위**: DB 백만원 원본(`value_mwon`) → 화면 억원(÷100). USD는 `value × fx_rate / 100`(plan·inventory), 대여금만 억원 원본(`loan_eok`). 조직도 이미지·프록시 구성 → [`Architecture.md §5-A`](./Architecture.md#5-a-경영관리management-탭-구조).

`app/api/`:

- **공개는 `api/cron/*`·`api/revalidate*` 뿐이고 나머지는 세션 필수.** 새 `route.ts` 를 만들면 `proxy.ts` 의 `PUBLIC_PATH_PREFIXES` 와 [`Architecture.md §5`](./Architecture.md) 의 라우트 목록을 **함께** 갱신한다(목록 정본은 Architecture — 여기 중복하지 않는다. 두 곳에 두면 갈린다).
- `api/revalidate*`은 SSRF·쿠키 가드 패치 이력(commit `ea090be`). 회귀 주의.

### `components/`

폴더가 페이지 책임과 1:1 매핑. 새 컴포넌트는 같은 페이지 폴더에.

- `ui/` — shadcn 원자 컴포넌트 (수동 수정 금지, shadcn CLI로 추가). **Select는 base-ui 기반**이라 `value`≠라벨이면 root에 `items`가 필요 → [`docs/gotchas-playwright-ui.md`](./docs/gotchas-playwright-ui.md)
- `layout/`, `common/`, `charts/` — 공용 / 나머지는 페이지별(`related-stocks/`, `oem/`, `hansae/`, `management/` 등)
- **`<Toaster />`(sonner)는 `app/layout.tsx` body 끝 `position="top-center"` 고정 — 제거·이동 금지.** 자리 옆에 붙어야 하는 검증 오류는 toast 말고 인라인 `<p role="alert">`. 경위·이유 → [`docs/gotchas-playwright-ui.md`](./docs/gotchas-playwright-ui.md)

### `lib/`

도메인 모듈 + 공용 유틸. 각 하위 폴더는 응집된 책임 단위.

- 공용 유틸·React 훅 목록 → [`Architecture.md §6`](./Architecture.md). **표 행 클릭 강조는 `useRowHighlight` 훅을 재사용**(인라인 재구현 금지 — `ROW_HIGHLIGHT_CLASS`+aria/Enter·Space. sticky 셀은 행 bg를 명시적으로 덮어야 따라온다)
- `lib/supabase/` — 클라이언트 4종 (**혼용 금지**):
  - `client.ts`(클라이언트 컴포넌트) / `admin.ts`(`service_role`, 서버 전용 RLS 우회 — 사외비는 직접 X, `confidential.ts` 경유) / `anon.ts`(공개 SELECT, `'use cache'` 안 권장) / `confidential.ts`(**사외비 테이블 전용 facade** — TS union으로 명단 외 접근 컴파일 차단 + service_role 자동 라우팅. 🔴 명단은 여기 나열하지 않는다)
  - **`.range()` 다중 페이지 fetch는 `.order()` 필수** · **집계 뷰의 `SUM`은 `::bigint` 캐스팅 필수** (각각 행 누락·문자열 직렬화를 부른다) → [`docs/gotchas-data-collection.md`](./docs/gotchas-data-collection.md)
- `lib/auth/` — 세션·권한·사용자. **5역할**(admin/holdings/mobility/hmobility/guest) 정의는 `roles.ts`가 SSOT. 🔴 **역할을 추가하면 `roles.ts`·`users.ts`·`permissions.ts` 3곳을 모두 갱신**해야 한다(빠뜨리면 세션 거부 → `/login` 무한 리다이렉트). 계정 env 키·랜딩 redirect 주의 → [`Architecture.md 부록 B-2`](./Architecture.md). 새 라우트 권한은 `permissions.ts`.
- **도메인 폴더** (페이지·기능 단위, 각각 `source.ts`로 fetch+cache+mapping 격리. 페이지는 호출만). 폴더 목록·모듈 구성 정본 = [`Architecture.md §6`](./Architecture.md). 약속만:
  - `lib/reports/` — **레이어드**: `dto/`(Zod) + `repositories/post.repository.ts` + `services/*`. 단순 CRUD는 caller가 `PostRepository` 직접, 라이프사이클만 `PostService`.
  - `lib/pnl/` · `lib/plan/` · `lib/inventory/` · `lib/personnel/` · `lib/finance/` · `lib/org-chart/` — **전부 사외비**라 `confidentialDb` 경유 필수.
  - `lib/stellantis-forecast/` — ⚠️ **`country`의 의미가 생산=공장 국가 · 소매=판매 시장으로 정반대**이고 MarkLines 도착 시점이 달라 공통 최신월(`lastCompleteMonth`)까지만 쓴다 — **수정 전 [`Architecture.md §5-A`](./Architecture.md#5-a-경영관리management-탭-구조) 정독.** 옛 회귀·시차 상관·조건부 빈도 KPI 는 사용자 판정으로 삭제됐으니 되살리지 말 것.
  - `lib/oem/` — `source.ts` + `aggregate.ts`(pure, `aggregate.test.ts`). country×month 대용량은 **구체화 뷰**로 사전 집계하고, 🔴 **구체화 뷰는 자동 갱신되지 않으므로 원본 적재 후 `refresh_oem_agg_views()` RPC 필수**(빼먹으면 `/oem`이 옛 값을 조용히 보여준다). 경위·수치 → [`Architecture.md §7-E`](./Architecture.md)
  - `lib/oem-companies/<slug>/` — `source.ts`(`'use cache'`+`cacheTag`) + `aggregate.ts`(pure) + 테스트. 상세 → `docs/oem-collection.md`
  - `lib/oem-competition/` — `/oem/competition` 조회 계층(`types.ts` + `source.ts`). `'use cache'` 함수엔 **`cacheLife('days')`를 반드시 붙일 것** — 빠뜨리면 기본값 15분마다 재생성돼 ISR Write를 낭비한다(월 1회 갱신 데이터). JSONB 컬럼은 형태가 어긋날 수 있어 배열 아니면 버린다.

### `scripts/` — Python 데이터 수집

prefix 컨벤션. 신규 스크립트는 같은 카테고리 prefix 사용.

- `collect_*.py` — 외부 → DB 수집. **Stellantis 북미 출하(도매)** → `stellantis_shipments`는 **수집기 2개, IR 홈페이지(`collect_stellantis_shipments_ir.py`)가 primary·EDGAR(`collect_stellantis_shipments.py`)가 보완·백필**(사용자 지시 2026-07-16). 🔴 **fnguide 접근은 반드시 `scripts/lib/fnguide_client.py` 경유**하고, **계약이 깨졌는지는 `scripts/verify_fnguide.py`로 먼저 확인**한다(주 1회 `verify-fnguide.yml`). Cox 재고일수·PDF-only(UzAuto)·현대 분기 IR 등 개별 수집기 세부 → **[`docs/gotchas-data-collection.md`](./docs/gotchas-data-collection.md)** · `docs/oem-collection.md` · 계약표 [`docs/fnguide-wcomp-migration.md`](./docs/fnguide-wcomp-migration.md).
- `enrich_*.py` — 기존 행 보강(외부 LLM·검색). **append-only**. `onboard_company.py`는 신규 회사 추가 직후 1회 실행하며 **멱등**이라 부분 실패 시 같은 명령을 재실행하면 된다(비-12월 결산은 `--fiscal-year-end-month`).
- `e2e_smoke.py` — 9개 보호 라우트 자동 로그인 + 콘솔/네트워크 에러 + 스크린샷. 결과 `data/_e2e_screenshots/` + `scripts/_e2e_smoke_report.json`.
- **`scripts/yt_report/`**(수동 고품질 툴킷 — **커밋돼 있으니 새로 짜지 말 것**) / **`collect_yt_report.py`**(완전 자동, GHA `collect-yt-report.yml`) → [`report.md §7-B·§2-A`](./report.md).
- `analyze_*` / `recheck_*` / `recollect_*` / `find_*` / `inspect_*` / `debug_*` — 진단·복원. 종료 후 **`scripts/_archive/`** 이동.
- `seed_*` / `import_*` / `sync_*` / `gen_*` / `normalize_*` / `migrate_*.ts` — 시드·일회성. 종료 후 `_archive/` 이동. **단 정기 재실행 12종은 유지**(목록 → [`Architecture.md 부록 B-3`](./Architecture.md)). ⚠️ MarkLines 판매량·생산량 sync는 **페이지·레이아웃·파일명이 서로 달라 한쪽 코드를 복제하지 말 것**(→ [`docs/oem-collection.md`](./docs/oem-collection.md)) · `sync_org_chart.py`는 **로컬 전용**(Excel COM).
- **사외비 적재 정책**(월별손익 sync 8종): 입력은 `참고/손익/자료정리_월별손익*.xlsx` 최신 glob. 🔴 **stdout에 금액·인원수 비노출** — dry-run 출력은 행수·연도·월·null 카운트만(합계 금지). dry-run 확인 후 본 적재. 🔴 **`sync_longterm_revenue.py`는 별개라 오케스트레이터에 등록하지 않는다**(등록하면 dry-run이 엉뚱한 파일을 읽어 통째 실패). 세부 → **[`docs/gotchas-data-collection.md`](./docs/gotchas-data-collection.md)**.
- `_*.json` / `_*.log` / `_*.py` / `_*.md` / `_*.ts(x)` — 임시 산출물. 비활성이면 `_archive/` 이동. `scripts/` **최상위의 이 확장자들**은 `.gitignore`가 패턴으로 무시한다(사외비 본문이 담긴 산출물의 커밋 방지). 새 산출물 *폴더*는 여전히 `.gitignore`에 명시 추가해야 한다.

`scripts/lib/` (공용 모듈, 모든 스크립트 재사용) — **모듈 목록은 [`Architecture.md §6`](./Architecture.md), 각 모듈의 배경·함정은 파일 docstring이 정본이다.** 여기엔 **지켜야 할 약속만** 싣는다.

- `db.py`(**모든 DB 접근이 경유**. 분 단위 수집 테이블을 새로 만들면 `purge_older_than()` 보존 정책을 **반드시 함께** 붙일 것 — 없으면 무한 누적) · `revalidate.py`(**수집 후 캐시 무효화 — 필수**) · `financial_sources.py`(**financials에 행을 쓰는 수집기는 `source`를 반드시 채운다**. 문자열 직접 입력 금지 — 상수만) · `fnguide_client.py`(**fnguide URL을 스크립트에 직접 박지 말고 이 모듈 경유**) · `nhtsa_client.py`(NHTSA 무료 API — 리콜·불만 데이터, 매핑+폴백 로직) · `competition_metrics.py`(OEM 차종 경쟁 지표 계산 — 순수 함수. **대상·경쟁군의 기준월을 공통 앵커로 맞출 것** — 각자의 최신월을 쓰면 점유율이 조용히 왜곡된다) · `perplexity_client.py`(웹 검색. 🔴 **키가 없으면 검색만 조용히 건너뛰고 수집은 성공**한다 — 품질 저하로만 나타난다) · `model_segment.py`·`outlook_prompt.py`(세그먼트 매핑 · 프롬프트 조립) · `krx_auth.py`(pykrx **import 전** `disable_pykrx_autologin()`) · `bootstrap.py`(boilerplate `init_script(__file__)`)

### `supabase/migrations/`

- 한 마이그레이션 = 한 변경 단위(View/function/RLS/constraint 모두). 명명·순서 규칙은 「데이터 / DB 규칙」의 **마이그레이션 컨벤션** 참조(두 곳에 적지 않는다).

### `.github/workflows/`

> 워크플로 전체 목록·카테고리·주기는 [`Architecture.md §10`](./Architecture.md) 참고. 신규/제거 시 §10 갱신.

- 대부분 GHA가 Python을 직접 호출한다(로컬 venv 불필요). 짧은 간격 cron은 curl 트리거(Hobby 제약 회피, `cron-sentiment`), 한세 종목토론은 Vercel 60s timeout 우회로 GHA runner에서 Node tsx 직접 실행(`collect-naver-board.yml`).
- 신규 onboarding `onboard-company.yml`은 `workflow_dispatch` 전용 — `/api/companies` POST가 INSERT 성공 후 GitHub API로 자동 트리거. Vercel env `GITHUB_PAT` 필요.
- **`marklines-adhoc-fetch.yml`**(`workflow_dispatch` 전용 · DB 미접근) — MarkLines 쿠키를 꺼낼 수 없을 때의 우회 통로(Actions 안에서 페이지를 받아 artifact로 회수). 스케줄이 없어 남겨 둬도 부작용 없음. 절차·로그인 판정 주의 → [`docs/oem-collection.md`](./docs/oem-collection.md).
- **`collect-yt-report.yml`**(`workflow_dispatch` 전용 · **기본 활성**, 끄려면 Vercel env `YT_AUTO_REPORT=0`) — `/reports/new` 유튜브 제출 시 자동 트리거. 배선·필요 Secrets·봇차단 한계 → [`report.md §2-A`](./report.md).

### 루트 설정

- `proxy.ts`(라우트 미들웨어, 구 middleware) / `next.config.ts` / `vercel.json`(배포 — **vercel.ts로 옮기지 말 것**. `ignoreCommand`로 백업 봇 커밋의 배포를 스킵하며, 근거·부작용 → [`docs/isr-write-optimization.md`](./docs/isr-write-optimization.md)) / `.claude/agents/`(서브 에이전트 4종) / `.mcp.json`(MCP 서버)

## 데이터 흐름

> 수집 → 적재 → 캐시 무효화 → UI 전체 흐름도는 [`Architecture.md §8`](./Architecture.md) 참고.

**유의 사항 (규칙):**

- 수집 스크립트가 끝나면 **반드시 `scripts/lib/revalidate.py`로 태그 무효화**. 안 하면 페이지가 `'use cache'` 결과를 들고 있어 stale.
- **수집 외 경로의 캐시 무효화**: `posts` 등 `'use cache'` 테이블을 수동(tsx/직접 INSERT)으로 변경하면 `revalidateTag`를 코드에서 못 부름 → `/api/revalidate`(POST `x-revalidate-secret` + `{tags:[...]}`, 프로덕션은 `NEXT_REVALIDATE_PROD_URL`+`NEXT_REVALIDATE_SECRET`) curl 또는 로컬 dev 재시작.
- **⚠️ GHA revalidate 시크릿 이름은 `NEXT_REVALIDATE_SECRET`**(`lib/revalidate.py`가 읽는 이름). 오타면 **적재는 정상인데 캐시 무효화만 조용히 스킵**된다 → [`docs/gotchas-data-collection.md`](./docs/gotchas-data-collection.md). 신규 워크플로 작성 시 이름 확인.
- **dev `'use cache'` stale 무효화**는 `rm -rf .next`+재시작 말고 `revalidate_tags([태그])` 로컬 호출이 빠르다 → [`docs/gotchas-ci-deploy.md`](./docs/gotchas-ci-deploy.md).
- 뷰(`related_stocks_view` 등)는 SQL 마이그레이션에 정의. **컬럼 추가 시 뷰부터 수정** → 페이지는 자동 반영.
- 실패·이상치는 `scripts/_*_log.json`에 기록. `analyze_*.py` 진단 후 `recheck_*.py`/`recollect_*.py`로 재처리.

## 데이터 / DB 규칙

> DB 스키마 상세(테이블·뷰 컬럼/인덱스/트리거)는 [`Architecture.md §7`](./Architecture.md#7-데이터-모델-db-스키마-상세) 참고. 본 섹션은 _지켜야 할 약속·정책_ 만.

**마이그레이션 컨벤션**: `supabase/migrations/YYYYMMDD000NNN_*.sql` 시간 정렬. 기존 파일 수정 금지, 신규는 가장 큰 번호 다음.

**데이터 정책**

- **상태값**: `companies.status = active` 만 화면 노출(`hidden`·`merged_into`는 자동 필터링). **회사명**은 트리거가 (주)·㈜·주식회사 등을 자동 제거한다.
- **재무 우선순위**: **연결(consolidated) 우선**, 종속회사 없을 때만 별도(separate).
- **비-12월 결산 fiscal_year**: 한국식 -1 보정(덴소 4월 결산 FY2025/4~2026/3 → `fiscal_year=2025`). yfinance 자동 적용.
- **회사별 결산월**(`companies.fiscal_year_end_month`, 1~12 default 12): `collect_financials.py`가 결산월과 `period_end.month`를 비교해 일치 시 적재(비-12월이면 -1 보정), 불일치 시 분기 데이터로 판정해 SKIP한다. 신규 등록은 `onboard_company.py --fiscal-year-end-month <M>`.
- **append-only**: `customers`, `description`(=`business_summary`) 등 보강 필드는 **덮어쓰지 말고 추가만**. enrich 시 diff 로그(`scripts/_*_diff_*.json`).
- **customers 정규화 v3**: BEFORE 트리거가 `expand_customer_name()→text[]`로 자동 정규화한다(자동차 OEM 화이트리스트만 통과). 🔴 **신규 별칭은 `expand_customer_name` + `lib/customerLogos.ts`를 함께 갱신.** 별칭 예시·트리거 명단 → [`Architecture.md 부록 B-1`](./Architecture.md).
- **company_type**: 컬럼 DEFAULT `'부품사'`, **OEM만 명시 입력**. `products[].category`도 트리거가 정규화한다(매핑 없으면 `'기타'`).
- **신규 회사 page 매핑·DART 수집 상태**는 AFTER INSERT 트리거가 자동 처리한다(`related-stocks`만 **수동 큐레이션**). 매핑 규칙 → [`Architecture.md 부록 B-1`](./Architecture.md).
- **PDF-only 회사 재진술 정책**(`data_source='uzauto-pdf'`): 신규 보고서가 과거 연도를 재진술하므로 **연도 오름차순 처리**로 최신 보고서가 마지막 upsert가 되게 한다. 상세 → `docs/oem-collection.md`.
- **OEM products는 차종, 부품사 products는 부품**. OEM에 부품 채우지 말 것. 제품군 카테고리 필터(`StockTable`/`DomesticTable`)는 부품사에만 적용(OEM은 항상 통과).
- **회사 description**: 추측 금지, DART 출처 제외, 홈페이지·인터넷 검색만(`enrich_description_*.py`).
- **dart_collection_status**: companies 별도 컬럼. 실패/재시도 추적은 financials와 분리.
- **사외비 테이블 격리**: 해당 테이블들은 RLS enable + 정책 없음(default deny) → anon 직접 접근 불가. **서버 코드는 반드시 `confidentialDb.from(...)`**(`lib/supabase/confidential.ts`, service_role 자동 + TS union 컴파일 차단). 비공개 Storage 버킷(`management-excel`·`org-charts`)도 public=false + 정책 없음 → service_role 전용. 테이블 명단·마이그레이션 이력 → [`Architecture.md §7-G`](./Architecture.md). **새 사외비 테이블 5-step**: (1) 마이그레이션 `ENABLE ROW LEVEL SECURITY`(정책 X) (2) `generate_typescript_types`로 `lib/database.types.ts` 갱신 (3) `confidential.ts`의 `CONFIDENTIAL_TABLES`에 한 줄 (4) 업로드 API `confidentialDb...upsert + revalidateTag` (5) 페이지 `'use cache' + cacheTag + confidentialDb...select`.
- **enum형 한글 컬럼**(예: `cost_type IN ('고정비','변동비')`): DB CHECK ↔ sync 적재값 ↔ UI 필터 ↔ TS union을 **한글 그대로** 일치시킬 것. sync에서 영문 매핑하면 CHECK 위반·UI 미표시(서브에이전트 위임 시 특히 점검).
- **수집 함정 전반**(DART 계정명 부분매칭 금지·동명이인 엔티티 검증·비상장 `finstate_all` 무데이터·audit-HTML 파싱 스코프·fnguide 계약·Stellantis 출하·Cox 재고일수·사외비 sync 적재) → **[`docs/gotchas-data-collection.md`](./docs/gotchas-data-collection.md) 정독**. 수집기 수정 전 필수.
- **신규 수집 테이블은 `trg_skip_identical_update` 부착 검토**: 수집 스크립트는 매 실행마다 전체 행을 upsert하므로 값이 그대로여도 UPDATE가 발생해 WAL·dead tuple이 폭증한다. `updated_at`처럼 매번 바뀌는 컬럼이 없는 **순수 데이터 테이블이면 붙일 것**. **부작용**: 동일 값 upsert는 **0행을 반환**하므로 반환 행수로 성공을 판정하지 말 것. 적용 목록·실측 근거 → [`Architecture.md §7-J`](./Architecture.md).
- **`financials.source`는 수집기가 반드시 채운다**: 값은 `scripts/lib/financial_sources.py` 상수만 사용(`fnguide`·`yfinance`·`dart`·`marklines`·`web_search`, UzAuto만 `uzauto-pdf:<원문 URL>`). **한 회사에 여러 출처 행이 공존**하므로 출처가 비면 값이 틀렸을 때 어느 수집기를 고칠지 특정할 수 없다. ⚠️ **UPDATE 경로에서 `source`를 건드리면 원 출처가 지워지고**, **키 개수로 실데이터 유무를 판정하는 상수**(`_META_KEY_COUNT`)가 있다 → [`docs/gotchas-data-collection.md`](./docs/gotchas-data-collection.md).
- **`financials` 생성컬럼**: `operating_margin`·`gross_margin`·`net_margin`·`debt_ratio`는 GENERATED ALWAYS — **직접 UPDATE 금지**(base 컬럼만 고치면 자동 재계산). 재수집 후 `q4_annual_bad`(허위 Q4=연간행) 재확인 — 신선 annual 갱신이 옛 잔존 Q4행과 값이 일치해 재등장할 수 있다.
- **챗봇 외부 LLM 전송 정책** (2026-05-23/24 SSOT): 챗봇(`/api/chat`) 도구 결과는 모두 Anthropic API로 전송. (1) `lib/chat/tools.ts` 화이트리스트에 **사외비 테이블 추가 금지**(PnL 의도적 제외) (2) `lib/chat/system-prompt.ts` DATA_CATALOG에 내부 고객사·공장·제품 명단 **평문 금지** (3) 모든 도구 호출은 `chat_audit_log` 자동 기록(`lib/chat/audit.ts` fire-and-forget) (4) 사외비 토픽 거절 안내는 `lib/chat/sensitive-policy.ts`의 `BLOCKED_TOPICS` SSOT — 새 도메인은 한 줄 추가.

- **보고서는 행 단위 사외비** (`posts.is_confidential`): posts는 통째로 막지 않고 **행 단위**로 가른다 — 정책 `posts_select_public`이 anon·authenticated에게 `is_confidential = false` 행만 준다. 사외비 행은 service_role로만 읽고 `canAccessConfidentialReports`(admin·holdings·mobility)로 게이트한다. **원문 파일을 `reports` 버킷(public)에 올리지 말 것.** 절차 → [`report.md §2-C`](./report.md).

**챗봇 감사 로그**(`chat_audit_log`): 도구 실행 직후 `logToolCall()`이 기록하되 **await하지 않는다**(실패해도 응답 정상). service_role 전용·보존 1년. 스키마 → [`Architecture.md 부록 B-4`](./Architecture.md).

## Python 스크립트 규칙

- DB 접근은 **postgrest-py 직접 호출**(`scripts/lib/db.py`). `supabase` SDK 금지(인증 의존성·실패 모드 — 메모리 `feedback_supabase_postgrest.md`).
- 공통 모듈 재사용(`db.py`·`accounts_map.py`·`fx.py`). upsert 키·멱등성 확보.
- **캐시 무효화는 자동 hook 두 경로**: (1) `db.upsert_rows(...)` bulk upsert가 `revalidate_for_tables`를 자동 호출 (2) `WriteSession` 블록 종료 시 누적 테이블을 자동 revalidate(`select`는 추적 X, 예외 시에도 호출, silent fail). 🔴 **신규 mutating 스크립트는 반드시 `WriteSession`.**
- Playwright는 시스템 캐시(`PLAYWRIGHT_BROWSERS_PATH`). 프로젝트에 브라우저 다운로드 금지.
- **OEM MarkLines Excel sync**(`sync_oem_excel.py`·`sync_oem_production_excel.py`)는 만료되는 세션 쿠키 GitHub Secret **`MARKLINES_COOKIE`** 에 의존한다(자동 로그인 아님 — 수동 채취). 만료 시 워크플로가 exit 1로 실패 → Secret 재채취. 채취 절차·단일 디바이스 정책 → [`docs/oem-collection.md`](./docs/oem-collection.md).
- **LLM 추출 수집기**(`collect_uzauto_financials.py`·현대 분기 IR·`collect_cox_inventory.py` 등)는 **로컬 실행 가능**하다 — `lib/bootstrap.py`의 `init_script()`가 `scripts/.env`와 **루트 `.env.local`을 둘 다** 로드하기 때문(`ANTHROPIC_API_KEY`는 후자에 있다). 구식 스크립트가 한쪽만 로드하면 `init_script`로 교체할 것 → [`docs/gotchas-data-collection.md`](./docs/gotchas-data-collection.md).
- **엑셀·PDF·이미지 파싱과 업로드 진단 함정**(스캔 PDF는 `pymupdf` 렌더→vision · openpyxl `read_only=True` 단독 결과 불신 · Excel COM은 **워크시트 단위** `ExportAsFixedFormat` · 렌더 산출물은 픽셀 해시 말고 **실제로 열어볼 것** · Storage REST는 `apikey` 헤더 필수 · 업로드 실패는 `management_uploads.summary->'scripts'`로 진단 · dry-run 정합성 경고는 staleness) → **[`docs/gotchas-data-collection.md`](./docs/gotchas-data-collection.md) 정독.**
- **경영관리 엑셀 업로드 적재**(`sync_management_excel.py` 오케스트레이터)는 8개 사외비 sync를 subprocess로 순차 실행하며 **전부에 `--dry-run`을 전달**한다 → 새 사외비 sync 추가 시 반드시 **`--dry-run` 지원 + 오케스트레이터 `SCRIPTS` 목록 등록**(누락 시 dry-run이 `unrecognized arguments`로 통째 실패).
- 진단/백업 산출물(`_*.json` 등)은 임시. 커밋 전 정리.

## PowerShell 환경 메모

- 셸은 PowerShell 5.1. `&&` 미지원 → `;` 또는 `if ($?) { ... }`.
- 기본 인코딩 UTF-16 LE BOM. 외부 도구 입력은 `-Encoding utf8` 명시.
- **백업 봇 push 거부·Codex CLI stdin·`grep -a`·`PYTHONIOENCODING`** → [`docs/gotchas-ci-deploy.md`](./docs/gotchas-ci-deploy.md) §4.
- **Playwright·UI 검증 함정**(dev 서버 재기동·검증 산출물 위치·로그인 404 진단·보호 라우트 검증·recharts headless/portal·사외비 차트) → **[`docs/gotchas-playwright-ui.md`](./docs/gotchas-playwright-ui.md) 정독**. UI를 브라우저로 검증하기 전에 반드시 읽을 것.

## 보안 / 자격증명

> 보안 정책 전체 매트릭스는 [`Architecture.md §11`](./Architecture.md) 참고.

- 키·토큰은 `.env.local`/`scripts/.env`/GitHub Actions Secrets에만. **코드·커밋 금지.**
- **커밋 전 secret 점검**: untracked 정리·신규 추적 전 `sbp_`/토큰 패턴 grep(하드코딩 잔재가 남아 있다). master 직접 push라 Push Protection(GH013) 차단 시 해당 파일 제외 후 재커밋 → [`docs/gotchas-ci-deploy.md`](./docs/gotchas-ci-deploy.md) §5.
- `proxy.ts`의 `PUBLIC_PATH_PREFIXES`(`/login`, `/api/cron`, `/api/revalidate`) 외 라우트는 세션 필수. 새 공개 라우트 신중히.
- `/api/revalidate*`은 토큰 검증 후 `updateTag()`. SSRF·쿠키 가드 회귀 주의(commit `ea090be`).
- **사외비 데이터**는 `service_role` 전용. NEXT_PUBLIC anon key는 클라이언트 번들 노출 → RLS `USING(true)`로 노출 금지. 새 사외비 테이블은 RLS enable + 정책 없음(default deny) 유지.

## 작업 시작 시 체크리스트

1. 개인 메모리 `MEMORY.md` 인덱스(위치는 「프로젝트 개요」 참조 — 레포 안이 아니다) → 관련 메모리 본문 (특히 진행 중 Phase·페이지)
2. `ROADMAP.md`에서 현재 Phase 위치 확인
3. DB 변경이면 최신 `supabase/migrations/` 파일명·순서 확인
4. 작업 유형별로 **시작 전** 정독할 문서는 「문서 역할 분리」의 각 줄 끝(**굵게 표시된 정독 시점**)을 볼 것 — 같은 목록을 두 번 싣지 않는다.

5. 작업 후 `npm run check-all` 통과 + UI는 dev 서버에서 직접 확인

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
- **새로 겪은 함정** → AGENTS.md 본문이 아니라 `docs/gotchas-*.md`에 적고, 트리거가 새로우면
  `문서 역할 분리` 목록에 **한 줄만** 추가
- 도메인 약속 변경(append-only / 연결 우선 / `status` 값 등) → 데이터·DB 규칙 갱신

> hook 오탐 시 `SKIP_AGENTS_CHECK=1 git commit ...`으로 우회(한 번만, 다음 커밋엔 재적용).
