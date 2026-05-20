<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

## 프로젝트 개요

자동차 산업 주식 모니터링 대시보드. Next.js + Supabase로 21개사 + α의 주가·환율·재무·뉴스·DART 공시 등을 수집·시각화한다.

- 현재 단계는 `ROADMAP.md`(Phase 0~3 완료, 3.5/5 진행 중)와 `MEMORY.md`(누적 진행 상황) 우선 확인.
- 7개 페이지 구성: 관련주식 / 비교 / 국내자동차 / OEM / 부품사 TOP100 / 한세그룹 / 기타. `/reports`, `/management`, `/login`, `/stock-popup/[id]` 별도.

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
- 배포 설정은 **`vercel.json`** 사용 중 (`vercel.ts`로 옮기지 말 것; 사용자가 요청한 적 없음).

## 검증 명령 (작업 완료 후 반드시 실행)

```powershell
npm run check-all       # lint + format:check + typecheck 일괄
# 개별
npm run lint            # eslint .
npm run format:check    # prettier --check .
npm run typecheck       # tsc --noEmit
npm run lint:fix        # 자동 수정
npm run format          # 자동 포맷
```

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
| `/management`       | 경영관리/손익(PnL) 입력·5표·5차트. `pnl_entries` 테이블                                                                                                    |
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
  - `server.ts` — 서버 컴포넌트·서버 액션 (쿠키 기반 SSR)
  - `client.ts` — 클라이언트 컴포넌트
  - `admin.ts` — `service_role` (서버 전용, RLS 우회 — 신중히)
  - `anon.ts` — anon (인증 없이, 공개 API용)
- `lib/auth/` — 세션·권한·사용자 (`proxy.ts`가 사용). 새 라우트 권한은 `permissions.ts`에 등록.
- 도메인 폴더 (페이지·기능 단위):
  - `lib/reports/` — 보고서. **레이어드 구조 채택**: `dto/`, `repositories/`, `services/{post,report-pdf,report-web,url-guard,youtube}` + `anthropic.ts`, `gemini.ts`, `pdf-page-renderer.ts`, `search.service.ts`. 다른 도메인보다 복잡도 높음.
  - `lib/pnl/` — 손익 집계
  - `lib/hansae/`, `lib/kiwoom/`, `lib/naver/`, `lib/sentiment/` — 페이지/기능별

### `scripts/` — Python 데이터 수집

prefix 컨벤션. 신규 스크립트는 같은 카테고리 prefix 사용.

- `collect_*.py` — 외부 → DB 수집
- `enrich_*.py` — 기존 행 보강 (외부 LLM·검색). **append-only 정책**
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
- `series_sources.py`, `shipping_sources.py`, `market_series.py`, `labor_targets.py`, `macro_targets.py` — 시계열·매크로 소스 매핑
- `manual_dart_mapping.json`, `marklines_slugs.json`, `groups_seed.json` — 정적 매핑

### `supabase/migrations/`

- 명명: `YYYYMMDD000NNN_<설명>.sql` (시간순)
- 한 마이그레이션 = 한 변경 단위. View / function / RLS / constraint 모두 여기에.
- 새 마이그레이션은 **마지막 파일 번호 다음**으로 생성. 기존 파일 수정 금지.

### `.github/workflows/`

19개 수집 워크플로. GitHub Actions에서 직접 Python 호출 (로컬 `scripts/venv` 없이).

- 가격·환율: 매일/매시간
- 재무: 분기별 (1/4/7/10월 15일)
- 뉴스·감성: 4시간/일간
- DART·매크로·해운·철강·원자재: 일간/주간

### 루트 설정

- `proxy.ts` — 라우트 미들웨어 (Next.js 16에서 구 middleware의 새 이름)
- `next.config.ts` — `cacheComponents` + `staleTimes` + `serverExternalPackages`
- `vercel.json` — 배포·크론 설정 (vercel.ts로 옮기지 말 것)
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
                  GitHub Actions 19개 워크플로                                │
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

- **Supabase 마이그레이션**: `supabase/migrations/YYYYMMDD000NNN_*.sql` 시간 정렬 컨벤션 유지. 새 파일을 만들지 말고 기존 컨벤션을 따른다.
- **상태 컬럼**: `companies.status` = `active` | `hidden` | `merged_into`. 과거 `delisted`는 `hidden`으로 개명됨 (2026-05-20 마이그레이션). 화면 노출은 `active`만.
- **재무(`financials`)**: 연결(consolidated) 우선, 종속회사 없을 때만 별도. period CHECK 제약 강화됨 — `annual`은 12월만 허용.
- **append-only 보강**: `customers`, `description` 등 기존 보강 필드는 **덮어쓰지 말고 append-only**. 자동 enrich 시 diff 로그(`scripts/_*_diff_*.json`) 생성.
- **회사 description**: 추측 금지, DART 출처 제외, 홈페이지+인터넷 검색 결과만, Claude Code가 직접 작성하는 워크플로 유지(`enrich_description_*.py` 참고).
- **dart_collection_status**: companies에 별도 추가됨(2026-05-20). DART 수집 결과는 financials와 분리해 관리.

## Python 스크립트 규칙

- DB 접근은 **`postgrest-py` 직접 호출** (`scripts/lib/db.py`). `supabase` SDK 사용 금지 (인증 의존성·실패 모드 이슈로 제외). 메모리 `feedback_supabase_postgrest.md` 참고.
- 공통 유틸: `scripts/lib/db.py`(클라이언트), `scripts/lib/accounts_map.py`(계정과목 매핑), `scripts/lib/fx.py`(환율 변환).
- 신규 수집 스크립트는 위 공통 모듈 재사용. upsert 키와 멱등성 확보.
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
