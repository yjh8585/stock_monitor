# Architecture (시스템 구조)

> **목적**: 코드/데이터/배포가 어떻게 맞물려 돌아가는지 한 곳에서 본다.  
> **AGENTS.md와의 차이**: AGENTS.md는 *어떻게 작업해야 하는지* (에이전트 지침·컨벤션), Architecture.md는 *시스템이 어떻게 구성되어 있는지* (구조·다이어그램).  
> **자동 갱신**: `.githooks/pre-commit`이 구조 변경 트리거 발생 시 Architecture.md 누락을 차단한다. 트리거 목록은 마지막 섹션 참고.

---

## 1. Overview

자동차 산업 주식 모니터링 대시보드. **21개사 + α**(현재 421개사가 /domestic 등록)의 주가·환율·재무·뉴스·DART 공시·OEM 판매·해운·철강 등을 매시간~매일 수집해 7개 페이지로 시각화한다.

- **사용자**: 한세모빌리티 BI 내부 사용자 (Vercel 인증 + Supabase Auth).
- **핵심 기능**: 다중 회사 비교, 그룹별 분류 (47개 그룹), 손익(PnL) 관리, 보고서 작성·뷰어 (YouTube 요약 통합), DART 공시 추적.

## 2. Tech Stack (실제 설치 기준)

| 영역 | 기술 | 비고 |
|---|---|---|
| 프론트엔드 | Next.js 16.2.4 (App Router) + React 19.2.4 + TypeScript 5 | `cacheComponents: true` |
| 스타일 | Tailwind CSS 4 + shadcn/ui + base-ui/react + lucide-react | — |
| 차트 | lightweight-charts + Recharts | — |
| DB | Supabase (PostgreSQL 17) | `@supabase/ssr`, `@supabase/supabase-js` |
| 상태 | Zustand | 폼: React Hook Form + Zod |
| 로깅 | Pino | 클라이언트 / Loguru: Python |
| AI SDK | `@anthropic-ai/sdk` + `@google/genai` | Claude·Gemini |
| 수집 | Python 3.13 + `postgrest-py` + Playwright + pykrx + yfinance + OpenDartReader | venv |
| 배포 | Vercel + GitHub Actions (22 워크플로) | Hobby 플랜 |
| Cron | GitHub Actions schedule + cron-job.org (5분 간격) | Vercel cron 미사용 (Hobby 제약) |

## 3. 시스템 컨텍스트 다이어그램

```
                ┌──────────────────────────────────────────────────┐
                │              External Data Sources                │
                │  pykrx · yfinance · fnguide(PW) · DART · ER-API   │
                │  Naver · Yahoo · Marklines · KIS · Naver금융      │
                └─────────────────┬────────────────────────────────┘
                                  │ HTTP/scrape
                                  ▼
┌──────────────────┐    ┌────────────────────┐    ┌──────────────────┐
│  GitHub Actions  │ ─▶ │  scripts/*.py      │ ─▶ │  Supabase        │
│  22 워크플로     │    │  collect / enrich  │    │  PostgreSQL +    │
│  (cron · manual) │    │  (postgrest-py)    │    │  Auth + Storage  │
└──────────────────┘    └─────────┬──────────┘    └────────┬─────────┘
                                  │                         │
                                  │ revalidate              │ SSR + RLS
                                  ▼                         ▼
                       ┌──────────────────────────────────────────┐
                       │  Vercel (Next.js 16 App Router)          │
                       │  proxy.ts (auth) + use cache + updateTag │
                       └──────────────────┬───────────────────────┘
                                          │ HTML/JSON
                                          ▼
                                  ┌──────────────┐
                                  │   사용자     │
                                  └──────────────┘
```

## 4. 레이어 아키텍처

| 레이어 | 책임 | 위치 |
|---|---|---|
| **External** | 외부 데이터 소스 | DART, fnguide, yfinance, pykrx, Naver, KIS, ER-API, Marklines, Yahoo |
| **Collection** | 외부 → DB 적재 + 보강 | `scripts/collect_*.py`, `scripts/enrich_*.py`, `scripts/onboard_company.py` |
| **Orchestration** | Cron·트리거·CI | `.github/workflows/*.yml`, cron-job.org (5분 간격 워크플로) |
| **Data** | PostgreSQL + 뷰 + 마이그레이션 | `supabase/migrations/`, Supabase 호스팅 |
| **Domain Library** | 페이지·기능별 데이터 가공 | `lib/<도메인>/` (reports, pnl, hansae, naver, kiwoom, sentiment) |
| **API Routes** | 공개/보호 API | `app/api/*/route.ts` (cron / revalidate / posts / uploads / news / stock-prices) |
| **App Router** | 페이지 + 'use cache' RSC | `app/<route>/page.tsx` |
| **Components** | 페이지별 / 공용 UI | `components/<page-or-shared>/` |
| **Middleware** | 세션·권한 체크 | `proxy.ts` (Next.js 16의 새 미들웨어 이름) |

## 5. 페이지·라우트 맵

| 라우트 | 목적 | 데이터 소스 |
|---|---|---|
| `/related-stocks` | 21개사 메인 표 | `related_stocks_view` |
| `/compare` | 다중 회사 비교 | `compareData`, `compareMetrics` |
| `/domestic` | 국내자동차 (421개사 + 매크로) | `domestic_stocks_view` |
| `/oem` | OEM + 모델 outlook | `oem_sales_*` 7개 테이블 |
| `/parts-top100` | 부품사 TOP100 | `parts_top100_stocks_view` |
| `/hansae` | 한세그룹 (3 종목 intraday) | KIS 분봉 + pykrx 수급 |
| `/etc` | 해운·철강·환율·매크로·두바이유 | `market_series_*`, `exchange_rates_*` |
| `/reports` | 보고서 + YouTube 요약 | `posts` 테이블 + `cacheComponents` 패턴 |
| `/management` | 경영관리/손익(PnL) | `pnl_entries`, `pnl_cost_structure` |
| `/login` | 세션 로그인 | Supabase Auth |
| `/stock-popup/[id]` | 주식 팝업 (3/4 주식 + 1/4 뉴스) | `stock_prices`, `news`, `naver_board_posts` |

**API 라우트 분류**:
- **공개**: `/api/cron/*` (workflow가 호출), `/api/revalidate*` (토큰 검증 후 `updateTag()`)
- **보호** (세션 필수): `/api/news/search`, `/api/stock-prices`, `/api/posts/*`, `/api/uploads/report`

`proxy.ts`의 `PUBLIC_PATH_PREFIXES`(`/login`, `/api/cron`, `/api/revalidate`)와 반드시 일치.

## 6. 디렉토리 구조 (요약)

> 상세: AGENTS.md "디렉터리 지도" 섹션 참고.

```
app/                      # Next App Router (라우트별 페이지)
components/<page>/        # 페이지별 UI 컴포넌트
components/ui/            # shadcn 원자 컴포넌트 (수동 수정 금지)
components/layout/        # Sidebar, AppLayout 등 공용
lib/                      # 도메인 모듈 + 공용 유틸
  reports/                #   레이어드 (dto/repositories/services)
  pnl/ hansae/ kiwoom/ naver/ sentiment/
  supabase/               #   클라이언트 4종 (server/client/admin/anon)
  auth/                   #   세션·권한·사용자
scripts/                  # Python 수집 + onboarding
  lib/                    #   공용 모듈 (db.py, accounts_map, fx, revalidate)
supabase/migrations/      # 시간순 SQL (YYYYMMDD000NNN_*.sql)
.github/workflows/        # 22개 GHA 워크플로
proxy.ts                  # Next.js 16 미들웨어
next.config.ts            # cacheComponents + staleTimes + serverExternalPackages
vercel.json               # 배포 설정 (Vercel cron 미사용)
```

## 7. 데이터 모델 (DB 스키마 요약)

### 핵심 테이블

| 테이블 | 행 수 | 용도 |
|---|---|---|
| **companies** | 574 | 회사 마스터 (id, ticker, name, name_kr, country, market, **group_name**, **homepage_url**, business_summary, products, customers, data_source, status, dart_corp_code) |
| **company_pages** | 592 | (company_id, page) 다대다 매핑 |
| **financials** | 4,109 | period_type(annual/quarterly) × fiscal_year × company_id |
| **stock_prices** | 316,694 | 일봉 OHLCV |
| **stock_quotes_5min** | 8,183 | 5분봉 (KIS 분봉) |
| **stock_daily_prices** | 4,916 | (legacy, stale — `stock_prices`로 통합 중) |
| **news** | 4,547 | (company_id, source, title, link, published_at, body, summary) |
| **naver_board_posts** | 495 | 한세그룹 종목토론 (회사별) |
| **board_sentiment** | 495 | 종목토론 감성 분석 결과 |
| **exchange_rates** / `_live` | 7,854 | ER-API + live FX |
| **posts** | 68 | 보고서 본문 |
| **pnl_entries** + `pnl_cost_structure` | 4,643 | 손익 입력 + 원가구조 |

### OEM 판매 (대용량)

| 테이블 | 행 수 | 크기 |
|---|---|---|
| oem_sales_model_country_month | 923,582 | 205 MB |
| oem_sales_group_country_month | 118,653 | 28 MB |
| oem_sales_group_pt_month | 14,878 | 3.6 MB |
| oem_sales_type_seg_month | 13,394 | 2.9 MB |
| oem_sales_group_month | 5,518 | 1.2 MB |

### 매크로·시계열

| 테이블 | 용도 |
|---|---|
| market_series_daily / market_series | 해운·철강·원자재 시계열 |
| macro_outlook_notes | 매크로 outlook 텍스트 |
| oem_model_outlook | OEM 모델 outlook |
| stock_supply_demand[_intraday] | pykrx 수급 (외국인/기관/개인) |

### 메타·인증

- **kis_tokens** / kiwoom_tokens — API 토큰 (자체 갱신)
- **product_category_map** — 제품 카테고리 정규화

### 주요 뷰 (`supabase/migrations/`)

- `related_stocks_view` — 21개사 메인 (company_type, region)
- `domestic_stocks_view` — `/domestic` 페이지 (sales_rank ROW_NUMBER)
- `parts_top100_stocks_view` — TOP100 + 매출 가드 (미래 period_end 제외)
- `companies_with_latest` — companies + 최신 가격

### 트리거·제약

- `companies_clean_legal_form_before_iu` — name/name_kr에서 (주)·㈜·주식회사 자동 제거
- `financials.period` CHECK — annual은 12월만 허용
- 비-12월 결산 글로벌 회사 fiscal_year 한국식 -1 보정 (20260521000002, 20260521000003)

## 8. 데이터 흐름 (수집 → 적재 → 캐시 무효화)

```
┌────────────────┐   ┌──────────────────────┐   ┌─────────────────┐   ┌───────────────────┐
│  외부 소스     │ → │ scripts/collect_*.py │ → │  Supabase       │ → │  Next.js App      │
│                │   │  (postgrest-py)      │   │  + 뷰/제약/RLS  │   │  'use cache'      │
└────────────────┘   └──────────┬───────────┘   └────────┬────────┘   └──────────▲────────┘
                                │                        │                       │
                                │                        │  SELECT (RLS)         │
                                │                        │                       │
                                ▼                        │                       │
                  scripts/lib/revalidate.py              │                       │
                       │                                 │                       │
                       ▼                                 │                       │
            /api/revalidate?tag=...  ── updateTag() ─────┴───────────────────────┘
            (토큰 검증 + SSRF·쿠키 가드)
```

**핵심 약속**:
- 수집 스크립트가 끝나면 **반드시 `scripts/lib/revalidate.py`로 태그 무효화**. 안 하면 페이지가 `'use cache'` 결과를 stale 유지.
- 뷰는 SQL 마이그레이션에 정의. 컬럼 추가 시 **뷰부터 수정** → 페이지는 자동 갱신.
- 신규 회사 추가 직후 1회: `python scripts/onboard_company.py --ticker XXX` → enrich(financials/meta/news) + revalidate.

## 9. 캐싱 전략

| 메커니즘 | 적용 위치 | TTL/무효화 |
|---|---|---|
| **`cacheComponents: true`** | `next.config.ts` 전역 | RSC 함수에 `'use cache'` 디렉티브 필요 |
| **`'use cache'` + `cacheTag(...)`** | 페이지·서버 함수 | `updateTag(tag)`로 명시 무효화 |
| **`experimental.staleTimes: 0`** | 라우터 캐시 | 페이지 재방문 시 클라이언트 컴포넌트 재마운트 |
| **HTTP cache (Vercel CDN)** | `/_next/static/*` | 빌드 시 immutable |
| **Supabase 풀러** | server/admin client | 풀 사이즈 default (서버 컴포넌트 매 호출 새 인스턴스) |

**무효화 태그**:
- `related_stocks_view`, `domestic_stocks_view`, `parts_top100_stocks_view`
- `exchange_rates_live`, `oem_sales_group_month`, `oem_sales_group_pt_month`, `oem_sales_group_country_month`, `oem_sales_type_seg_month`

자동 매핑: `scripts/lib/revalidate.py::COLUMN_TO_TAGS` (수정 시 `revalidate_for_tables` 호출 가능).

## 10. 자동화 (GitHub Actions + cron-job.org)

### 22개 워크플로 카테고리

| 카테고리 | 워크플로 예시 | 주기 |
|---|---|---|
| 가격 | collect-prices, collect-prices-live | 매시간 / 5분 |
| 환율 | collect-fx, collect-fx-live | 매시간 / 5분 |
| 재무 | collect-financials (4 job: listed/dart-audit×8/domestic/snapshot) | 분기 (1/4/7/10월 15일) |
| 뉴스 | collect-news | 4시간 |
| 감성 | analyze-board-sentiment | 일간 |
| DART | collect-dart-audit (shard 8), collect-dart-labor | 분기 / 일간 |
| 매크로 | collect-macro-outlook, collect-market-series | 일간 / 주간 |
| 해운·철강 | collect-shipping, collect-steel-kr | 일간 |
| 원자재 | collect-dubai-oil | 일간 |
| 글로벌 스냅샷 | collect-global-snapshot | 일간 |
| 한세 종목토론 | collect-naver-board (GHA Node tsx 직접) | 30분 |
| 한세 분봉 | collect-hansae-intraday (KIS) | 5분 |
| OEM | collect-oem-model-outlook | 일간 |
| 보강 | enrich-company | 수동 |
| Vercel cron 대체 (curl) | cron-quotes-5min, cron-sentiment | 5분 / 일 1회 |

### cron-job.org 외부 트리거

GitHub Actions schedule이 5분 간격은 안정성 보장 안 되어 cron-job.org에서 매 5분 GHA dispatch 호출.

### 회사 onboarding (수동)

```bash
python scripts/onboard_company.py --ticker 005380
# → enrich_company (재무 + 메타 + 뉴스) + revalidate
# 주가는 다음 collect_prices_live cron에서 자동
```

## 11. 보안

| 영역 | 정책 |
|---|---|
| **세션** | Supabase Auth (쿠키), `proxy.ts`가 `PUBLIC_PATH_PREFIXES` 외 라우트는 세션 강제 |
| **권한** | `lib/auth/permissions.ts` — 역할별 라우트 화이트리스트 |
| **API 토큰** | `/api/revalidate*`은 `x-revalidate-secret` 헤더 검증 + SSRF·쿠키 가드 |
| **DB** | RLS 활성화 (Supabase 호스팅). `service_role`은 server 전용 (`lib/supabase/admin.ts`) |
| **Secrets** | `.env.local`, `scripts/.env`, GitHub Actions Secrets. **코드 커밋 금지** |
| **외부 입력** | Zod 검증 (`lib/reports/dto/`) |
| **SQL** | postgrest 파라미터 바인딩만 (문자열 결합 금지) |

## 12. 배포 파이프라인

```
GitHub master push
   ↓
Vercel 자동 빌드·배포 (Next.js)
   ↓
prod 도메인 (NEXT_REVALIDATE_URL 대상)

GitHub Actions
   ↓ (cron / dispatch)
runner Python venv → postgrest-py → Supabase
                          ↓
            scripts/lib/revalidate.py → /api/revalidate → updateTag
```

- **Vercel**: Hobby 플랜 (cron 일 1회 제약 → GHA로 우회)
- **GitHub Actions**: 매 워크플로에 `NEXT_REVALIDATE_URL`/`SECRET` env (18개 워크플로 적용 완료)
- **vercel.json**: 배포 설정 (vercel.ts로 옮기지 말 것 — 사용자가 요청한 적 없음)

## 13. 자동 갱신 트리거

`.githooks/pre-commit`은 다음 변경 시 **`Architecture.md` + `AGENTS.md`** 동반 커밋을 강제한다:

| 패턴 | 이유 |
|---|---|
| `supabase/migrations/*.sql` 신규 | DB 스키마 변경 → §7 갱신 |
| `app/<라우트>/page.tsx` 신규 | 페이지 추가 → §5 갱신 |
| `app/api/**/route.ts` 신규 | API 라우트 + 공개/보호 분류 → §5 갱신 |
| `scripts/lib/*` 신규 | 공용 수집 모듈 → §6, §10 |
| `.github/workflows/*` 신규/제거 | 자동화 변경 → §10 |
| `next.config.ts` / `proxy.ts` / `vercel.json` 수정 | 캐싱·보안·배포 변경 → §9, §11, §12 |
| `lib/<new-domain>/` 신규 폴더 | 도메인 모듈 추가 → §6 |
| `scripts/` 새 prefix | 카테고리 추가 → §6 |
| 도메인 약속 변경 (append-only, 연결 우선 등) | 데이터 정책 → §7 |

> hook이 오탐인 경우 `SKIP_AGENTS_CHECK=1 git commit ...`로 우회 (한 번만 우회되고 다음 커밋엔 다시 적용).

---

## 부록 A. 최근 주요 변경 (2026-05-20 ~ 2026-05-21)

- **status='hidden'** 도입 (`delisted` → `hidden`)
- 일본 회계연도 한국식 -1 보정 (20260521000002, 20260521000003)
- 부품사 TOP100 뷰 미래 가드 (20260521000001)
- DART corp_code 자동/수동 매핑 24개
- 6차 워크플로 stable (`os._exit(0)` + yfinance 미래 period_end 가드)
- 그룹 분류 50개 정리 (사람인 NICE 기반)
- **homepage_url** enrich_company에 수집 추가 + onboard_company.py 도입
