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
- **[`report.md`](./report.md)** — _보고서(`/reports`) 작성 규칙_. 게시 절차(자동 `/api/posts` vs 직접 INSERT+캐시 무효화)·본문 형식·**한국어 마크다운 렌더 함정(CJK 강조·단일 `~`·연도 백틱·단독 `<br>`)**·이미지(Storage `reports` 버킷)·Mermaid 규칙. **보고서 본문 작성·수정 전 정독.** 스키마는 Architecture.md §7-G. **⚠️ 유튜브 보고서는 주요 장면·차트를 반드시 캡처·삽입(차트 누락 금지, 사용자 지시 2026-07-18) — §7-4·§7-A·§8 필수 체크.**

- **[`docs/gotchas-playwright-ui.md`](./docs/gotchas-playwright-ui.md)** — _Playwright·UI 검증 함정_. dev 서버 재기동·검증 산출물 위치·로그인 404 진단·보호 라우트 검증·recharts headless/portal·사외비 차트 규칙. **UI를 브라우저로 검증하기 전 정독.**
- **[`docs/gotchas-data-collection.md`](./docs/gotchas-data-collection.md)** — _수집 함정 정본_. DART 계정명 부분매칭 금지·동명이인 엔티티 검증·비상장 `finstate_all` 무데이터·audit-HTML 파싱 스코프·2026-07-18 감사 계통 오류 + **fnguide 계약**·**Stellantis 출하 2종**·**Cox 재고일수**·**사외비 sync 적재 세부**·GHA 실패 로그 오독. **수집기 수정 전 정독.**
- **[`docs/fnguide-wcomp-migration.md`](./docs/fnguide-wcomp-migration.md)** — fnguide 신버전(wcomp) JSON 계약표·계정 코드·헤더 열 규칙.
- **[`docs/isr-write-optimization.md`](./docs/isr-write-optimization.md)** — _Vercel ISR Write 한도 대응_. 측정 이력·과금 메커니즘·기각된 옵션. **주식 뷰 3종(`related`/`domestic`/`parts-top100`)의 payload·cacheTag 를 건드리기 전 정독** — `cacheTag('exchange_rates_live')` 를 되돌리거나 `financials_by_year` 트리밍을 풀면 한도가 다시 터진다. ⚠️ Vercel 경고 메일은 100%에서 문구가 고정되고 14일마다 재발송되므로 **진척 판단 근거가 못 된다**(대시보드 Usage 탭에서만 확인).

> AGENTS.md는 "이 약속을 지켜라"만 다룬다. 구조 설명이 길어지면 Architecture.md로 옮기고 여기선 참조한다.
>
> 🔴 **새로 배운 함정은 AGENTS.md 본문이 아니라 `docs/gotchas-*.md`에 적는다.** 여기 쌓으면 매 세션
> 자동 로드 분량이 다시 불어난다(2026-08-04에 91.5KB → 62KB로 줄인 이유 — 표 정렬 공백이 21%,
> 함정 서술이 11KB였다). 트리거가 새로우면 위 목록에 **한 줄만** 추가한다.
>
> ⚠️ **표 셀에 긴 서술을 넣지 말 것.** prettier가 가장 긴 셀에 맞춰 모든 행을 공백으로 패딩해서,
> `| /compare | 다중 회사 비교 |` 한 줄이 1,792바이트가 된다. 긴 내용은 표 아래 `#### 라우트 상세`
> 블록으로 빼고 표에는 한 줄 요약만 남긴다.

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
- 수집 스크립트/워크플로 실환경 검증: `gh workflow run <name>.yml --ref master` → `gh run watch <id> --exit-status` → `gh run view <id> --log`. 간헐 실패는 `gh run list --workflow=<name>.yml`로 이력 확인. **실패가 인프라 탓인지 먼저 가른다** — `gh run view <id> --log-failed`가 **비어 있으면** 스텝 실행 전에 죽은 것이다. `gh run view <id>`의 ANNOTATIONS에 `job was not acquired by Runner`·`Service Unavailable`·`Failed to resolve action download info`가 보이면 GitHub 측 장애이니 코드를 고치지 말고 `githubstatus.com/api/v2/incidents.json`으로 확인 후 복구를 기다린다(2026-08-06 실측: 서로 다른 워크플로 6건이 각 15~16분 걸려 동시 실패). **수집 워크플로 로그는 tail로 읽지 말 것** — pykrx의 stdout이 loguru stderr와 뒤섞여 무해한 `KRX 로그인 실패`가 맨 끝에 몰리므로 진짜 원인처럼 읽힌다(→ [`docs/gotchas-data-collection.md`](./docs/gotchas-data-collection.md)).
- 프로덕션 = `stock-monitor-orcin.vercel.app`. **scripts/워크플로 변경은 재배포 불필요**(GHA가 master 체크아웃)지만 **`app/`·`components/` UI 변경은 Vercel 재배포(push→빌드 READY) 후** E2E 검증. 배포 상태는 Vercel MCP `list_deployments`(projectId/teamId = `.vercel/project.json`). **배포가 push 후 수 분 지연될 수 있고 `list_deployments` 시간필터(since/until)가 오도**하므로(2026-07-17 실측 — 있는데 없다고 오판) **현재 프로덕션에 뭐가 떠 있나는 prod alias(`stock-monitor-orcin.vercel.app`)에 `get_deployment`**로 확인(commit sha·`readyState` 반환). **재트리거에 빈 커밋은 무의미** — `vercel.json` `ignoreCommand`가 `data/backups` 외 diff 없으면 스킵하니 실제 변경 diff가 있어야 빌드된다. Vercel MCP엔 **usage/과금 조회 도구 없음** → ISR Writes·Bandwidth 등 사용량 수치는 대시보드 Usage 탭에서 확인.
- **Supabase MCP가 세션 중 `Unauthorized`면**(토큰 env 미주입) 재시작으로 세션 버리지 말고 Management API 직접 호출로 우회: `scripts/.env`의 `SUPABASE_Pesonal_Access_Token`(오타가 실제 키 이름) + `POST https://api.supabase.com/v1/projects/{ref}/database/query` (`ref`는 `SUPABASE_URL`의 `https://<ref>.supabase.co`에서 파싱). **브라우저 User-Agent 헤더 필수** — 안 붙이면 Cloudflare가 `403 error code 1010`으로 차단한다(2026-07-15 실측). DDL·SELECT 모두 가능 — MCP가 내부적으로 쓰는 같은 끝점. 단 이 경로는 `supabase_migrations.schema_migrations` 이력을 **안 남기므로** MCP `apply_migration`과 동등하게 맞추려면 `insert into supabase_migrations.schema_migrations (version, name)`을 직접 넣을 것.

## 디렉터리 지도

폴더는 "어떤 책임을 맡는지" 중심으로 본다. 폴더별 컨벤션·약속은 아래 기준을 따른다.

### `app/` — Next App Router (라우트 = 페이지 단위 책임)

| 라우트              | 책임 / 약속                                                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/related-stocks`   | 21개사 메인 표. `related_stocks_view` 뷰를 `'use cache'`로 캐싱. **컬럼 추가는 뷰부터 수정.**                                                                                                                                    |
| `/compare`          | 다중 회사 비교                                                                                                                                                                                                                   |
| `/domestic`         | 국내자동차 (5사 + 매크로)                                                                                                                                                                                                        |
| `/oem`              | OEM "전체" 탭 — 글로벌 MarkLines 대시보드 + 모델 outlook. 탭 네비는 `app/oem/layout.tsx`. 핵심 차종 콤보 차트는 북미(USA)·기타(글로벌 합산) 2섹션이 단일 `ModelNorthAmericaCharts` 공유 — 차트 카탈로그 → `docs/chart-guide.md`. |
| `/oem/<slug>`       | OEM 회사별 차종 판매 (hyundai·kia·kg-mobility·stellantis-na·uzbekistan). **수집 상세 → `docs/oem-collection.md`.**                                                                                                               |
| `/parts-top100`     | 부품사 TOP100 (Marklines 매핑)                                                                                                                                                                                                   |
| `/hansae`           | 한세그룹 대시보드 + intraday                                                                                                                                                                                                     |
| `/etc`              | 기타정보 (해운·철강·환율·매크로 outlook·두바이유)                                                                                                                                                                                |
| `/reports`          | 보고서 + youtube-summary (`use cache` + `generateStaticParams` + `updateTag`) — **↓ 상세**                                                                                                                                       |
| `/management`       | 경영관리 12탭 (사외비 — `confidentialDb` 필수) — **↓ 상세**                                                                                                                                                                      |
| `/login`            | 세션 로그인                                                                                                                                                                                                                      |
| `/stock-popup/[id]` | 주식 팝업 (3/4 주식 + 1/4 뉴스)                                                                                                                                                                                                  |

#### `/reports` 상세

보고서 + youtube-summary. `'use cache'` + `generateStaticParams` + `updateTag` 패턴(메모리 `project_reports_migration.md`). **본문 작성·수정 규칙, 사외비 게시 절차(§2-C), 유튜브 인라인 재생 블록(§6-A), 유튜브 자동 경로 → [`report.md`](./report.md) 정독.** 약속만 여기 싣는다:

- **사외비 보고서**(`posts.is_confidential`)는 RLS 가 anon 읽기를 막고 `canAccessConfidentialReports`(admin·holdings·mobility)가 service_role 조회를 게이트한다 — 목록·상세 `'use cache'` 함수에 `includeConfidential` 를 **인자로** 넘겨 역할별 캐시를 분리하므로 **새 호출부에서 이 인자를 빠뜨리지 말 것**.
- 유튜브 자동 경로는 **텍스트 먼저 확정 → 이미지 베스트에포트 보강**이라 이미지가 안 붙어도 `failed` 가 아니다(GHA IP 봇 차단이 잦다). 이미지가 꼭 필요하면 로컬 `scripts/yt_report/` 툴킷.

#### `/management` 상세

경영관리. 탭 **pnl / plan / stellantis / inventory / production / personnel / finance / org-chart / upload(admin 전용) / companies**. **탭별 차트·섹션 구조 상세 → [`Architecture.md §5-A`](./Architecture.md#5-a-경영관리management-탭-구조).** 약속만 여기 싣는다:

- 사외비 테이블(`pnl_entries`·`pnl_cost_structure`·`pnl_fixed_variable`·`pnl_plan`·`longterm_revenue_plan`·`inventory_entries`·`personnel_entries`·`finance_entries`·`loan_entries`)은 **반드시 `confidentialDb.from(...)`로 조회**.
- 탭 노출은 `ALL_TABS` + `canAccess` 자동 필터라 **신규 경영관리 탭에 `permissions.ts` 수정은 불필요**(guest·hmobility 자동 차단). 단 더 좁은 권한은 명시 — `/management/upload`는 admin 전용(`ADMIN_ONLY_PATHS`), 조직도는 admin·holdings·mobility.
- **단위**: DB 백만원 원본(`value_mwon`) → 화면 억원(÷100). USD 금액은 `value × fx_rate / 100`(plan·inventory), 대여금만 억원 원본(`loan_eok`).
- 조직도 이미지는 비공개 버킷 `org-charts` PNG 를 인증 프록시(`/api/management/org-chart/image/[date]`)로 스트리밍하고, 적재는 **로컬 `scripts/sync_org_chart.py`(Excel COM)만**.

`app/api/`:

- **공개는 `api/cron/*`·`api/revalidate*` 뿐이고 나머지는 세션 필수.** 새 `route.ts` 를 만들면 `proxy.ts` 의 `PUBLIC_PATH_PREFIXES` 와 [`Architecture.md §5`](./Architecture.md) 의 라우트 목록을 **함께** 갱신한다(목록 정본은 Architecture — 여기 중복하지 않는다. 두 곳에 두면 갈린다).
- `api/revalidate*`은 SSRF·쿠키 가드 패치 이력(commit `ea090be`). 회귀 주의.

### `components/`

폴더가 페이지 책임과 1:1 매핑. 새 컴포넌트는 같은 페이지 폴더에.

- `ui/` — shadcn 원자 컴포넌트 (수동 수정 금지, shadcn CLI로 추가). **Select는 base-ui(`@base-ui/react/select`) 기반** — SelectItem `value`가 표시 라벨과 다르면 root에 `<Select items={[{value,label},…]}>`를 줘야 트리거가 라벨을 표시한다(없으면 raw value 노출, 2026-07-17 실측)
- `layout/`, `common/`, `charts/` — 공용 / 나머지는 페이지별(`related-stocks/`, `oem/`, `hansae/`, `management/` 등)
- **`<Toaster />`(sonner)는 `app/layout.tsx` body 끝에 마운트**(2026-07-30 추가 — 그 전까지 어디에도 없어서 `toast.success/error(...)`가 업로드·회사등록·보고서 폼 4곳에서 **조용히 무시**되고 있었다). 위치는 `position="top-center"` — 우하단은 챗봇 버튼(`fixed bottom-5 right-5 z-40`)이 점유한다. toast를 새로 쓸 때 화면에 안 뜨면 이 마운트가 살아 있는지부터 확인할 것. **자리(드롭존·필드) 옆에 붙어야 의미가 있는 검증 오류는 toast 말고 인라인 요소**(`<p role="alert">`)로 — 업로드 폼의 확장자 거절이 그 예.

### `lib/`

도메인 모듈 + 공용 유틸. 각 하위 폴더는 응집된 책임 단위.

- 공용 유틸: `format`, `utils`, `logger`, `types`, `database.types`(Supabase 생성), `series`, `stockPrices`, `compareData`, `customerLogos`, `financialFormatter` 등
- React 훅: `useChartHeight`, `useIsMobile`, `useRowHighlight`(표 행 클릭→노란 음영 토글 공용 — `ROW_HIGHLIGHT_CLASS`+aria/Enter·Space. 신규 표 강조는 인라인 재구현 말고 이 훅 재사용; sticky 셀은 행 bg를 명시적으로 덮어야 따라옴)
- `lib/supabase/` — 클라이언트 4종 (**혼용 금지**):
  - `client.ts`(클라이언트 컴포넌트) / `admin.ts`(`service_role`, 서버 전용 RLS 우회 — 사외비는 직접 X, `confidential.ts` 경유) / `anon.ts`(공개 SELECT, `'use cache'` 안 권장) / `confidential.ts`(**사외비 테이블 전용 facade** — `confidentialDb.from('pnl_entries'|'pnl_cost_structure'|'pnl_fixed_variable'|'pnl_plan'|'chat_audit_log'|'inventory_entries'|'personnel_entries'|'finance_entries'|'loan_entries'|'management_uploads'|'org_charts'|'longterm_revenue_plan')...`, TS union으로 명단 외 접근 컴파일 차단 + service_role 자동 라우팅)
  - **`.range()` 페이지네이션은 결정적 정렬 필수**: 1000행 초과 다중 페이지 fetch는 반드시 `.order()`(가급적 PK 전체) 동반. `.in()`/필터는 인덱스 스캔이라 정렬 없으면 페이지 경계에서 행 **누락·중복**(예: `lib/oem/source.ts` `fetchModelRows` 전 국가 fetch가 특정 연도 통째 누락 → 차트 near-zero). WHERE 없는 `fetchAll`은 seq-scan이라 안정. 증상: 연간 합계는 정상인데 차트만 특정 구간 낮음 → 집계 아닌 fetch 의심.
  - **집계 뷰 `SUM`은 `numeric`→문자열**: `SUM(int/bigint)`은 Postgres에서 `numeric`이라 PostgREST(@supabase/supabase-js)가 **문자열로 직렬화** → JS 산술이 깨짐. 뷰 정의에서 `SUM(x)::bigint`(값 범위 맞으면 `::int`)로 캐스팅해 number 반환(예 `oem_sales_country_group_year`). 개별 int 컬럼은 number로 옴 — `SUM`/`AVG` 등 집계만 해당.
- `lib/auth/` — 세션·권한·사용자. **5역할**(admin/holdings/mobility/hmobility/guest) 정의는 `roles.ts`가 SSOT(server-only 아님 → `proxy.ts`/`session.ts`에서 import 가능). **역할 추가 = `roles.ts` `ROLES` + `users.ts`(env 계정·exhaustive `getDisplayNameByRole`) + `permissions.ts`(`canAccess`·landing 헬퍼) 모두 갱신**(decode 화이트리스트는 `isRole`로 자동 — 누락 시 세션 거부→로그인 무한 `/login`). 계정은 역할별 **distinct env 키**(중복 키는 dotenv가 마지막 값만 채택→로그인 깨짐), 신규 계정은 optional(env 둘 다 있을 때만 추가 → Vercel env 미설정도 기존 로그인 유지). 접근 불가 역할 추가 시 랜딩(`/`·`/management`)은 **role-aware redirect**로(고정 redirect는 무한 루프). 새 라우트 권한은 `permissions.ts`.
- **도메인 폴더** (페이지·기능 단위, 각각 `source.ts`로 fetch+cache+mapping 격리. 페이지는 호출만):
  - `lib/reports/` — **레이어드**: `dto/`(Zod) + `repositories/post.repository.ts` + `services/*`. 단순 CRUD는 caller가 `PostRepository` 직접, 라이프사이클만 `PostService`.
  - `lib/pnl/` · `lib/plan/` · `lib/inventory/` · `lib/personnel/` · `lib/finance/`(+대여금 `loan_entries`) · `lib/org-chart/` — **전부 사외비**라 `confidentialDb` 경유 필수. 모듈별 소스·빌더·단위 환산 구성 → [`Architecture.md §6`](./Architecture.md)
  - `lib/related-stocks/` · `lib/domestic/` · `lib/parts-top100/` · `lib/companies/`(회사 마스터 — `/management/companies`·`/api/companies` 입구, anon client)
  - `lib/stellantis-forecast/` — 경영관리 스텔란티스 탭(`/management/stellantis`). ⚠️ **`country` 의 의미가 생산=공장 국가 · 소매=판매 시장으로 정반대**이고, MarkLines 도착 시점이 서로 달라 공통 최신월(`lastCompleteMonth`)까지만 써야 하며, 마세라티 스코프를 맞춰야 한다 — **수정 전 [`Architecture.md §5-A`](./Architecture.md#5-a-경영관리management-탭-구조) 정독.** 옛 회귀·시차 상관·조건부 빈도 KPI 는 사용자 판정으로 삭제됐으니 되살리지 말 것.
  - `lib/oem/` — `source.ts` + `aggregate.ts`(pure 4종, `aggregate.test.ts`로 단위 테스트). **country×month 대용량(~12만 행)은 DB 집계 구체화 뷰 `oem_sales_country_group_year`·`oem_sales_usa_group_month`(마이그 `20260714000001` → `20260803000003` 전환)로 사전 집계** — 앱 전량 fetch가 프리렌더 statement/USE_CACHE timeout(배포 간헐 ERROR)을 유발해 이관. 🔴 **일반 뷰로는 재발했다**(2026-08-03): 일반 뷰는 조회할 때마다 12.3만 행을 재집계해 계산 비용이 그대로였다 → 구체화 뷰로 전환(80ms → 5.4ms). 🔴 **구체화 뷰는 자동 갱신되지 않는다** — 원본 적재 후 `refresh_oem_agg_views()` RPC 필수(`import_oem_sales.py`가 호출, 빼먹으면 `/oem`이 옛 값을 조용히 보여준다). 상세 → Architecture.md §7-E
  - `lib/oem-companies/<slug>/` — OEM 회사별 탭. `source.ts`(`'use cache'`+`cacheTag`+PT map LEFT JOIN) + `aggregate.ts`(pure) + `aggregate.test.ts`. 상세 → `docs/oem-collection.md`
  - `lib/hansae/`, `lib/naver/`, `lib/sentiment/`, `lib/chat/`

### `scripts/` — Python 데이터 수집

prefix 컨벤션. 신규 스크립트는 같은 카테고리 prefix 사용.

- **Stellantis 북미 출하(도매)** → `stellantis_shipments`. **수집기 2개, IR 홈페이지(`collect_stellantis_shipments_ir.py`)가 primary·EDGAR(`collect_stellantis_shipments.py`)가 보완·백필**(사용자 지시 2026-07-16). 기준 차이·차분 도출·덮어쓰기 가드 → **[`docs/gotchas-data-collection.md`](./docs/gotchas-data-collection.md)**.
- `collect_cox_inventory.py` — **Cox 브랜드별 딜러 재고일수** → `cox_brand_inventory`(차트 JPEG 를 vision 판독). 슬러그·파일명 불규칙, outlier 제외(`is_outlier_excluded`) 규칙, `temperature` 지정 금지 → **[`docs/gotchas-data-collection.md`](./docs/gotchas-data-collection.md)**.
- **`collect_financials.py`** (KR fnguide + 글로벌 yfinance) — 🔴 **fnguide 는 도메인·구조를 자주 갈아엎는다**(2026-07·2026-08 두 번 다 KR 상장사 0행). fnguide 접근은 **반드시 `scripts/lib/fnguide_client.py` 경유**. **계약이 깨졌는지는 `scripts/verify_fnguide.py`로 먼저 확인**(주 1회 `verify-fnguide.yml` 자동 실행). 계약·적재 함정 → **[`docs/gotchas-data-collection.md`](./docs/gotchas-data-collection.md)**, 계약표 전문 → [`docs/fnguide-wcomp-migration.md`](./docs/fnguide-wcomp-migration.md).
- `collect_*.py` — 외부 → DB 수집. **PDF-only 회사**(UzAuto)·**현대 분기 IR PDF**는 sha256 캐시 → 변경분만 Anthropic API(`claude-sonnet-5`, 2026-08-06 Opus 4.7에서 비용 전환 — env var로 환원 가능) + `tool_use` 구조화 추출 패턴. 상세는 `docs/oem-collection.md` + 각 스크립트.
- `enrich_*.py` — 기존 행 보강(외부 LLM·검색). **append-only**. `enrich_company.py`는 메타+재무+뉴스 일괄.
- `onboard_company.py` — 신규 회사 추가 직후 1회 실행(ticker/name/id 식별 → enrich + 캐시 무효화). **멱등**(append-only + DB 트리거 page 매핑 + WriteSession 자동 revalidate) → 부분 실패 시 같은 명령 재실행. 비-12월 결산은 `--fiscal-year-end-month`.
- `e2e_smoke.py` — 9개 보호 라우트 자동 로그인 + 콘솔/네트워크 에러 + 스크린샷. 결과 `data/_e2e_screenshots/` + `scripts/_e2e_smoke_report.json`.
- **`scripts/yt_report/`** — 유튜브 영상 N편 → `/reports` 보고서 **재사용 툴킷(커밋)**. `fetch_subs`·`capture`·`montage`·`crop`·`finalize`·`upload.ts`·`publish.ts`·`verify.py` + `_common.py`. 절차·데이터 계약은 `scripts/yt_report/README.md`, 내용 규칙은 [`report.md §7`](./report.md)(주요 장면·차트 필수). 일회성 산출물(자막·프레임·png·중간 json)은 `scripts/_yt_report/`(gitignore, `RUN_DIR`). **본문 작성·프레임 선별·차트 발굴은 에이전트/서브에이전트 단계**(수동 고품질 경로, Opus).
- **`collect_yt_report.py`** — 위 툴킷의 **완전 자동 버전**(GHA `collect-yt-report.yml`이 실행). 자막→LLM(Haiku) 본문+프레임계획→캡처(베스트에포트)→LLM vision 차트/장면 선별→조립→Storage 업로드(`yt-auto/<postid>/`)→posts UPDATE. `/reports/new` 유튜브 제출이 자동 트리거. `scripts/yt_report/_common.py` 헬퍼 재사용. 로컬 실행 가능(`--url`, 옵션 `--post-id`). 자동이라 품질은 Haiku급 — 고품질은 위 수동 툴킷.
- `analyze_*` / `recheck_*` / `recollect_*` / `find_*` / `inspect_*` / `debug_*` — 진단·복원. 종료 후 **`scripts/_archive/`** 이동.
- `seed_*` / `import_*` / `sync_*` / `gen_*` / `normalize_*` / `migrate_*.ts` — 시드·일회성. 종료 후 `_archive/` 이동. **단 아래는 정기 재실행이라 유지**: `sync_oem_excel.py`·`import_oem_sales.py`·`sync_oem_production_excel.py`·`import_oem_production.py`(MarkLines 판매량·생산량 — **페이지·레이아웃·파일명이 서로 달라 한쪽 코드를 복제하지 말 것**, 상세 → [`docs/oem-collection.md`](./docs/oem-collection.md)) · `sync_pnl_excel.py`·`sync_pnl_plan.py`·`sync_inventory.py`·`sync_personnel.py`·`sync_pnl_fixed_variable.py`·`sync_finance.py`·`sync_loan.py` · `sync_management_excel.py`(8개 sync 오케스트레이터, GHA workflow_dispatch 전용) · `sync_org_chart.py`(**로컬 전용 — Excel COM 의존, Vercel/GHA 렌더 불가**) · `sync_longterm_revenue.py`(중장기 매출 전망, **별도 엑셀**).
- **사외비 적재 정책** (`sync_pnl_excel.py`·`sync_pnl_plan.py`·`sync_inventory.py`·`sync_personnel.py`·`sync_pnl_cost_structure.py`·`sync_pnl_fixed_variable.py`·`sync_finance.py`·`sync_loan.py`): 입력 엑셀은 `참고/손익/자료정리_월별손익*.xlsx` 최신 glob. 🔴 **stdout 에 금액·인원수 비노출** — `summarize()`/dry-run 출력은 행수·연도·월·null 카운트만(revenue_sum·headcount 등 합계 출력 금지). dry-run 안전성 확인 후 본 적재. 정합성 검증·차원 변경 resync·실(sil) 정정 등 실행 세부 → **[`docs/gotchas-data-collection.md`](./docs/gotchas-data-collection.md)**.
- **`sync_longterm_revenue.py`는 위 8개와 별개** — 입력이 다른 엑셀(`참고/영업계획/*.xlsx`)이라 **`sync_management_excel.py` 오케스트레이터에 등록하지 않는다**(등록하면 dry-run 이 엉뚱한 파일을 읽어 통째 실패). 분기 1회 로컬 수동 실행 + `--revalidate-prod`. stdout 금액 비노출은 위와 동일. 상세 → **[`docs/gotchas-data-collection.md`](./docs/gotchas-data-collection.md)**.
- `_*.json` / `_*.log` / `_*.py` / `_*.md` / `_*.ts(x)` — 임시 산출물. 비활성이면 `_archive/` 이동. `scripts/` **최상위의 이 확장자들**은 `.gitignore`가 패턴으로 무시한다(2026-08-06 추가 — 그 전에는 개별 파일만 나열돼 있어 **사외비 본문이 담긴 산출물이 커밋될 수 있었다**). 새 산출물 _폴더_(예: `_yt_report/`)는 여전히 `.gitignore`에 명시 추가해야 무시됨.

`scripts/lib/` (공용 모듈, 모든 스크립트 재사용):

**각 모듈의 배경·함정은 파일 docstring 이 정본이다**(전부 갖고 있다). 여기엔 **지켜야 할 약속만** 싣는다.

- `db.py`(**모든 DB 접근이 경유**. 분 단위 수집 테이블을 새로 만들면 `purge_older_than()` 보존 정책을 **반드시 함께** 붙일 것 — 없으면 무한 누적) · `revalidate.py`(**수집 후 캐시 무효화 — 필수**) · `financial_sources.py`(**financials 에 행을 쓰는 수집기는 `source` 를 반드시 채운다**. 문자열 직접 입력 금지 — 상수만) · `fnguide_client.py`(**fnguide URL 을 스크립트에 직접 박지 말고 이 모듈 경유**) · `krx_auth.py`(pykrx **import 전** `disable_pykrx_autologin()`)
- 나머지: `bootstrap.py`(boilerplate `init_script(__file__)`) · `accounts_map.py`(계정과목) · `fx.py`(환율) · `companies.py`+`companies.json`(시드) · `kis_client.py`(KIS API) · `text.py`(LLM 응답 sanitize·거부 감지) · `management_excel.py`(월별손익 엑셀 경로 해석) · `org_chart_sheets.py`(조직도 시트 날짜 파싱) · `fnguide_guard.py`(fnguide 폴백 페이지 감지)
- 정적 매핑: `series_sources.py`, `shipping_sources.py`, `market_series.py`, `labor_targets.py`, `macro_targets.py`, `manual_dart_mapping.json`, `marklines_slugs.json`, `groups_seed.json`

### `supabase/migrations/`

- 명명 `YYYYMMDD000NNN_<설명>.sql` 시간순. 한 마이그레이션 = 한 변경 단위(View/function/RLS/constraint 모두).
- 새 파일은 **마지막 번호 다음**. 기존 파일 수정 금지.

### `.github/workflows/`

> 워크플로 전체 목록·카테고리·주기는 [`Architecture.md §10`](./Architecture.md) 참고. 신규/제거 시 §10 갱신.

- 대부분 GHA가 Python 직접 호출(로컬 venv 불필요).
- 짧은 간격 cron은 curl 트리거(Hobby 제약 회피, `cron-sentiment`). 한세 종목토론은 Vercel 60s timeout 우회로 GHA runner에서 Node tsx 직접 실행(`collect-naver-board.yml`).
- 신규 onboarding `onboard-company.yml`은 `workflow_dispatch` 전용 — `/api/companies` POST가 INSERT 성공 후 GitHub API로 자동 트리거. Vercel env `GITHUB_PAT` 필요.
- **`marklines-adhoc-fetch.yml`**(`workflow_dispatch` 전용 · DB 미접근) — **MarkLines 쿠키를 꺼낼 수 없을 때 쓰는 우회 통로.** 유효 쿠키는 Secrets `MARKLINES_COOKIE` 에만 있고 Secrets 는 write-only 라 값 조회가 불가능하다(로컬 추출도 전멸: Edge 쿠키 없음 · **Chrome 127+ ABE** 복호화 불가 · **Chrome 150 은 기본 프로필 CDP 거부**). 그래서 쿠키를 빼오는 대신 **Actions 안에서 페이지를 받아 artifact `marklines-raw` 로 회수**한다(`gh run download <id> -n marklines-raw`). 스케줄이 없어 저절로 돌지 않으므로 남겨 둬도 부작용 없음. ⚠ 로그인 판정은 HTTP 200 이 아니라 **`<table>`·천단위 수치 유무**로 해야 한다 — 로그인 안 된 상태도 200 에 144KB 껍데기를 준다.
- **`collect-yt-report.yml`**(`workflow_dispatch` 전용) — **기본 활성**(끄려면 Vercel env `YT_AUTO_REPORT=0`) `/reports/new` 유튜브 제출 시 `/api/posts`(`post.service.ts`)가 텍스트 확정 후 트리거 → `scripts/collect_yt_report.py --enrich`가 주요장면·차트 캡처해 **이미지 있을 때만** post 덮어씀(실패해도 텍스트 유지, failed 아님). **필요 GHA Secrets(`SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`·`ANTHROPIC_API_KEY`·`NEXT_REVALIDATE_*`)는 onboard용으로 이미 존재**, 신규는 선택 `YOUTUBE_COOKIES`뿐. Vercel `GITHUB_PAT`(onboard용 존재). ffmpeg는 apt, yt-dlp는 requirements. **⚠️ GHA IP는 유튜브 봇차단이 잦아(2026-07-19 실측: 자막 실패) 쿠키 없이는 이미지가 대개 안 붙는다** → 이미지 확실히 원하면 수동 `scripts/yt_report/` 툴킷(로컬 IP).

### 루트 설정

- `proxy.ts`(라우트 미들웨어, 구 middleware) / `next.config.ts`(`cacheComponents`+`staleTimes`+`serverExternalPackages`) / `vercel.json`(배포, vercel.ts로 옮기지 말 것 — `ignoreCommand`로 `data/backups`-only 일일 백업 봇 커밋의 프로덕션 배포를 스킵: 배포마다 ISR 캐시가 배포 단위로 리셋돼 전 라우트가 dedup 없이 full-payload 재기록되는 baseline write를 제거) / `.claude/agents/`(서브 에이전트 4종) / `.mcp.json`(MCP 서버)

## 데이터 흐름

> 수집 → 적재 → 캐시 무효화 → UI 전체 흐름도는 [`Architecture.md §8`](./Architecture.md) 참고.

**유의 사항 (규칙):**

- 수집 스크립트가 끝나면 **반드시 `scripts/lib/revalidate.py`로 태그 무효화**. 안 하면 페이지가 `'use cache'` 결과를 들고 있어 stale.
- **수집 외 경로의 캐시 무효화**: `posts` 등 `'use cache'` 테이블을 수동(tsx/직접 INSERT)으로 변경하면 `revalidateTag`를 코드에서 못 부름 → `/api/revalidate`(POST `x-revalidate-secret` + `{tags:[...]}`, 프로덕션은 `NEXT_REVALIDATE_PROD_URL`+`NEXT_REVALIDATE_SECRET`) curl 또는 로컬 dev 재시작.
- **⚠️ GHA revalidate 시크릿 이름**: 수집 워크플로는 revalidate 시크릿을 **`NEXT_REVALIDATE_SECRET`** 로 넘겨야 한다(`lib/revalidate.py`가 읽는 이름). `sync-oem-excel.yml`·`sync-oem-production-excel.yml`이 `REVALIDATE_SECRET` 오타라 GHA 캐시 무효화가 **조용히 스킵**되던 것을 2026-07-17 교정. 유사 오타 시 적재는 정상이나 화면은 `cacheLife` TTL로 뒤늦게 갱신되는 증상 → 신규 워크플로 작성 시 정확한 이름 확인.
- **dev `'use cache'` stale 가볍게 무효화**: source.ts 등 편집 후 dev가 옛 캐시 값을 들고 있을 때 `rm -rf .next`+재시작 대신 `scripts/lib/revalidate.py`의 `revalidate_tags([태그])`를 로컬 호출(`NEXT_REVALIDATE_URL`=localhost)하면 해당 태그만 무효화돼 빠르다.
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
- **사외비 테이블 격리** (`20260523000002`/`3`, `20260528000001`/`2`/`3`, `20260609000001`/`2`, `20260610000001`, `20260611000001`, `20260624000001`/`2`, `20260715000001`): `pnl_entries`·`pnl_cost_structure`·`pnl_fixed_variable`·`chat_audit_log`·`pnl_plan`·`inventory_entries`·`personnel_entries`·`finance_entries`·`loan_entries`·`management_uploads`·`org_charts`·`longterm_revenue_plan`은 RLS enable + 정책 없음(default deny) → anon 직접 접근 불가. **서버 코드는 반드시 `confidentialDb.from(...)`** (`lib/supabase/confidential.ts`, service_role 자동 + TS union 컴파일 차단). 비공개 Storage 버킷도 사외비 격리: `management-excel`(엑셀 업로드)·`org-charts`(조직도 PNG)는 public=false + 정책 없음 → service_role(`confidentialDb`/인증 프록시) 전용. **새 사외비 테이블 5-step**: (1) 마이그레이션 `ENABLE ROW LEVEL SECURITY`(정책 X) (2) `generate_typescript_types`로 `lib/database.types.ts` 갱신(단일 테이블 추가는 generate 대신 해당 블록만 알파벳 위치에 수동 삽입 가능 — 수동 ViewRow/TableRow 헬퍼·prettier churn 방지) (3) `confidential.ts`의 `CONFIDENTIAL_TABLES`에 한 줄 (4) 업로드 API `confidentialDb...upsert + revalidateTag` (5) 페이지 `'use cache' + cacheTag + confidentialDb...select`.
- **enum형 한글 컬럼**(예: `cost_type IN ('고정비','변동비')`): DB CHECK ↔ sync 적재값 ↔ UI 필터 ↔ TS union을 **한글 그대로** 일치시킬 것. sync에서 영문 매핑하면 CHECK 위반·UI 미표시(서브에이전트 위임 시 특히 점검).
- **수집 함정 전반**(DART 계정명 부분매칭 금지·동명이인 엔티티 검증·비상장 `finstate_all` 무데이터·audit-HTML 파싱 스코프·2026-07-18 감사 계통 오류·fnguide 계약·Stellantis 출하·Cox 재고일수·사외비 sync 적재 세부) → **[`docs/gotchas-data-collection.md`](./docs/gotchas-data-collection.md) 정독**. 수집기 수정 전 필수.
- **신규 수집 테이블은 `trg_skip_identical_update` 부착 검토** (20260803000002): 수집 스크립트는 매 실행마다 전체 행을 upsert하므로 값이 그대로여도 UPDATE가 발생해 WAL·dead tuple이 폭증한다(2026-08-03 Supabase 용량 초과의 주원인 — `exchange_rates`가 8,165행에 누적 UPDATE 521만 회 = 행당 638회, WAL 하루 1.65GB 생성). `updated_at`처럼 매번 바뀌는 컬럼이 없는 **순수 데이터 테이블이면 트리거를 붙일 것**. 적용 목록·근거 → [`Architecture.md §7-J`](./Architecture.md). **부작용**: 동일 값 upsert는 **0행을 반환**하므로 반환 행수로 성공을 판정하지 말 것(`upsert_rows`는 입력 길이를 반환해 무관). 실측 효과: `market_series_daily` 27,784행 전체 재upsert에도 UPDATE 652회에 그침.
- **`financials.source`는 수집기가 반드시 채운다** (2026-08-04 복구): 값은 `scripts/lib/financial_sources.py` 상수만 사용(`fnguide`·`yfinance`·`dart`·`marklines`·`web_search`, UzAuto만 `uzauto-pdf:<원문 URL>`). **한 회사에 여러 출처 행이 공존**하므로(예: 상장사에 fnguide 행과 dart 행이 같이 있다) 출처가 비면 값이 틀렸을 때 어느 수집기를 고칠지 특정할 수 없다. ⚠️ **기존 행의 지표만 덧쓰는 UPDATE 경로에서는 `source`를 건드리지 말 것** — 원 출처가 지워진다(`collect_global_snapshot.py`의 PER/PBR 갱신이 그 사례라 INSERT 경로에만 넣었다). ⚠️ **행 dict의 키 개수로 "실데이터 유무"를 판정하는 코드가 있다**(`collect_dart_domestic._build_rows`의 `_META_KEY_COUNT`) — 메타 키를 늘리면 그 상수도 함께 고칠 것.
- **`financials` 생성컬럼**: `operating_margin`·`gross_margin`·`net_margin`·`debt_ratio`는 GENERATED ALWAYS — **직접 UPDATE 금지**(base 컬럼 revenue·operating_income·total_liabilities·total_equity만 고치면 자동 재계산). 데이터 정정 시 주의. 재수집 후 `q4_annual_bad`(허위 Q4=연간행) 재확인 — 신선 annual 갱신이 옛 잔존 Q4행 값과 일치시켜 재등장할 수 있음.
- **챗봇 외부 LLM 전송 정책** (2026-05-23/24 SSOT): 챗봇(`/api/chat`) 도구 결과는 모두 Anthropic API로 전송. (1) `lib/chat/tools.ts` 화이트리스트에 **사외비 테이블 추가 금지**(PnL 의도적 제외) (2) `lib/chat/system-prompt.ts` DATA_CATALOG에 내부 고객사·공장·제품 명단 **평문 금지** (3) 모든 도구 호출은 `chat_audit_log` 자동 기록(`lib/chat/audit.ts` fire-and-forget) (4) 사외비 토픽 거절 안내는 `lib/chat/sensitive-policy.ts`의 `BLOCKED_TOPICS` SSOT — 새 도메인은 한 줄 추가.

- **보고서는 행 단위 사외비** (`posts.is_confidential`, `20260806000001`): posts 는 위 테이블들처럼 통째로 막지 않고 **행 단위**로 가른다 — 정책 `posts_select_public` 이 anon·authenticated 에게 `is_confidential = false` 행만 준다(그 전 `posts_select_all` = `USING(true)` 는 anon 키만으로 전 보고서 덤프가 가능했다). 사외비 행은 service_role 로만 읽고 `canAccessConfidentialReports`(admin·holdings·mobility)로 게이트한다. **원문 파일을 `reports` 버킷(public)에 올리지 말 것.** 절차 → [`report.md §2-C`](./report.md).

**챗봇 감사 로그** (`chat_audit_log`, `20260523000003`): user_id/user_role/tool_name/input_json/row_count/is_error/error_msg. RLS 정책 없음(service_role 전용). `lib/chat/loop.ts`가 도구 실행 직후 `logToolCall()` 호출(await 안 함 — 실패해도 응답 정상). 보존 1년(cron 미구현).

## Python 스크립트 규칙

- DB 접근은 **postgrest-py 직접 호출**(`scripts/lib/db.py`). `supabase` SDK 금지(인증 의존성·실패 모드 — 메모리 `feedback_supabase_postgrest.md`).
- 공통 모듈 재사용(`db.py`·`accounts_map.py`·`fx.py`). upsert 키·멱등성 확보.
- **캐시 무효화**: 두 경로 모두 자동 hook. (1) `db.upsert_rows(...)` bulk upsert는 함수 안에서 `revalidate_for_tables` 자동 호출. (2) `WriteSession` — `with WriteSession() as w: w.table('x').update(...).execute()` 블록 종료 시 누적 테이블을 자동 revalidate(`select`는 추적 X, 예외 시에도 호출, silent fail). **신규 mutating 스크립트는 반드시 WriteSession**. 정기 cron 14개 적용 완료, 잔여 일회성은 점진 마이그레이션. 테스트 `scripts/lib/test_db_writesession.py`.
- Playwright는 시스템 캐시(`PLAYWRIGHT_BROWSERS_PATH`). 프로젝트에 브라우저 다운로드 금지.
- **OEM MarkLines Excel sync**(`sync_oem_excel.py`·`sync_oem_production_excel.py`)는 만료되는 세션 쿠키 GitHub Secret **`MARKLINES_COOKIE`** 의존(아이디/비번 자동 로그인 아님 — 브라우저 DevTools에서 수동 채취). 만료 시 워크플로가 exit 1(로그 '쿠키 만료')로 실패 → Secret 재채취·갱신 필요. **MarkLines 단일 디바이스 정책**상 사람이 로컬에서 로그인하면 CI 쿠키가 조용히 무효화될 수 있다(OEM sync 실패의 흔한 원인).
- **LLM 추출 수집기**(`collect_uzauto_financials.py`·현대 분기 IR·`collect_cox_inventory.py` 등)는 **로컬 실행 가능**하다 — `ANTHROPIC_API_KEY`가 `scripts/.env`엔 없지만 **프로젝트 루트 `.env.local`에 있고**, `lib/bootstrap.py`의 `init_script()`가 `scripts/.env`와 `<root>/.env.local`을 **둘 다** 로드한다(2026-07-15 실측 정정 — 과거 이 문서는 "로컬 실행 불가"라고 잘못 적고 있었다). 구식 스크립트가 `scripts/.env`만 로드한다면 그건 그 스크립트의 boilerplate 문제이니 `init_script`로 교체할 것. GHA Secrets에도 같은 키가 있어 워크플로 실행도 가능.
- **스캔 PDF**(UzAuto IFRS 등)는 `pypdf`/`pdfplumber` 텍스트 추출이 0자 + Read 도구 렌더가 `pdftoppm`(poppler) 미설치로 실패 → venv `pymupdf`(fitz)로 페이지 렌더(`fitz.open(p)[n].get_pixmap(dpi=200).save(png)`)→Read(vision)로 판독.
- 손익/사외비 엑셀 파싱 디버깅: **openpyxl `read_only=True` 단독 결과를 신뢰하지 말 것**(행/열 인덱싱이 어긋나 부문값이 제품열로 읽히는 오진 관측) → `read_only=False`(`ws.cell`) 또는 sync의 `parse_sheet()` 직접 호출로 교차검증.
- **Excel COM 시트→이미지 렌더**(win32com): `wb.ExportAsFixedFormat`은 활성/전체 시트를 내보내 **대상 시트가 뒤바뀐다** → `ws.Activate()` + **`ws.ExportAsFixedFormat`(워크시트 단위)** 사용. PrintArea를 `UsedRange`로만 잡으면 셀 밖 도형(변경요약 박스 등)이 잘림 → 도형(`ws.Shapes[].BottomRightCell`)까지 포함해 범위 설정 + 여백 0.
- **렌더 산출물 검증은 실제로 열어볼 것**: 이미지/PDF는 "픽셀 해시가 다르다"만 보면 *내용 뒤바뀜*을 못 잡는다(조직도 시트 swap 버그를 이 함정으로 놓침) → Read(vision)로 제목·구조·매핑을 눈으로 확인. 사외비면 제목/구조만 보고 실명 비전사.
- **Storage REST 업로드 인증**: 이 프로젝트 `SUPABASE_SERVICE_ROLE_KEY`는 신형 `sb_secret_...` 키 → `Authorization: Bearer` 외 **`apikey` 헤더도 필요**(JS admin client는 무관, Python `requests` 직접 업로드 시 주의).
- **경영관리 엑셀 업로드 적재**(`sync_management_excel.py` 오케스트레이터)는 8개 사외비 sync를 subprocess 순차 실행하며 **전부에 `--dry-run` 전달** → 새 사외비 sync 추가 시 반드시 `--dry-run` 지원 + 오케스트레이터 `SCRIPTS` 목록 등록(누락 시 dry-run이 `unrecognized arguments`로 통째 실패). 엑셀 경로는 8개 모두 `MANAGEMENT_EXCEL_PATH` env 우선(`scripts/lib/management_excel.py` `resolve_excel_path`, 없으면 `참고/손익` glob).
- **업로드 적재 실패 진단**: GHA 로그엔 오케스트레이터 라인만 보임 → 어떤 sync가 왜 실패했는지는 `management_uploads.summary->'scripts'`(Supabase SQL)의 `exit_code`·`output`(각 sync stdout 캡처)으로 확인.
- **dry-run 정합성 경고는 staleness 아티팩트일 수 있음**: `sync_pnl_fixed_variable`는 업로드 엑셀 '고정비' 시트를 DB `pnl_cost_structure`(적재 전이라 한 업로드 뒤처짐)와 대조 → 진행연도 YTD 월수 차이로 mismatch 경고가 떠도 적재 후 0% reconcile. 경고만(차단 안 함).
- 진단/백업 산출물(`_*.json` 등)은 임시. 커밋 전 정리.

## PowerShell 환경 메모

- 셸은 PowerShell 5.1. `&&` 미지원 → `;` 또는 `if ($?) { ... }`.
- 기본 인코딩 UTF-16 LE BOM. 외부 도구 입력은 `-Encoding utf8` 명시.
- Codex CLI는 stdin hang 회피로 `"" | codex ... --output-last-message <file>` 패턴(메모리 `reference_codex_cli_powershell.md`).
- `master`에 백업 봇이 매일 커밋(`chore(backup): daily JSONB snapshot`) → push 거부 시 `git -c rebase.autoStash=true pull --rebase origin master` 후 재push. 파이프(`... | tail`)는 앞 명령 exit code를 가림 → `git push` 실패 후 `|| (rebase)` 분기가 안 탐. push는 파이프 없이 실행하거나 종료코드 별도 확인.
- Bash `grep`이 한글/ANSI 섞인 stdout을 binary로 처리해 결과를 숨김 → `grep -a` 강제(파일 내용 검색은 Grep 도구 사용).
- venv Python stdout 한글 깨짐 → Bash 도구로 실행 시 `PYTHONIOENCODING=utf-8` 프리픽스(예: `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe ...`).
- **Playwright·UI 검증 함정**(dev 서버 재기동·검증 산출물 위치·로그인 404 진단·보호 라우트 검증·recharts headless/portal·사외비 차트) → **[`docs/gotchas-playwright-ui.md`](./docs/gotchas-playwright-ui.md) 정독**. UI를 브라우저로 검증하기 전에 반드시 읽을 것.

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
4. 작업 유형이 아래에 해당하면 **시작 전** 해당 문서 정독 (본문은 자동 로드되지 않는다)

| 작업                          | 먼저 읽을 문서                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| UI를 브라우저로 검증          | [`docs/gotchas-playwright-ui.md`](./docs/gotchas-playwright-ui.md)                                        |
| 수집기 수정 (재무·LLM·외부)   | [`docs/gotchas-data-collection.md`](./docs/gotchas-data-collection.md)                                    |
| fnguide 수집이 깨짐           | `scripts/verify_fnguide.py` 실행 → [`docs/fnguide-wcomp-migration.md`](./docs/fnguide-wcomp-migration.md) |
| 차트 신규·수정                | [`docs/chart-guide.md`](./docs/chart-guide.md)                                                            |
| 보고서 본문 작성              | [`report.md`](./report.md)                                                                                |
| OEM 회사별 탭                 | [`docs/oem-collection.md`](./docs/oem-collection.md)                                                      |
| DB 스키마 확인                | [`Architecture.md`](./Architecture.md)                                                                    |
| 주식 뷰 payload·캐시태그 수정 | [`docs/isr-write-optimization.md`](./docs/isr-write-optimization.md)                                      |

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
  `문서 역할 분리`·`작업 시작 시 체크리스트` 표에 **한 줄만** 추가
- 도메인 약속 변경(append-only / 연결 우선 / `status` 값 등) → 데이터·DB 규칙 갱신

> hook 오탐 시 `SKIP_AGENTS_CHECK=1 git commit ...`으로 우회(한 번만, 다음 커밋엔 재적용).
