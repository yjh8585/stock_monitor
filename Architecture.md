# Architecture (시스템 구조)

> **목적**: 코드/데이터/배포가 어떻게 맞물려 돌아가는지 한 곳에서 본다.  
> **AGENTS.md와의 차이**: AGENTS.md는 _어떻게 작업해야 하는지_ (에이전트 지침·컨벤션), Architecture.md는 _시스템이 어떻게 구성되어 있는지_ (구조·다이어그램).  
> **자동 갱신**: `.githooks/pre-commit`이 구조 변경 트리거 발생 시 Architecture.md 누락을 차단한다. 트리거 목록은 마지막 섹션 참고.

---

## 1. Overview

자동차 산업 주식 모니터링 대시보드. **21개사 + α**(현재 421개사가 /domestic 등록)의 주가·환율·재무·뉴스·DART 공시·OEM 판매·해운·철강 등을 매시간~매일 수집해 7개 페이지로 시각화한다.

- **사용자**: 한세모빌리티 BI 내부 사용자 (Vercel 인증 + Supabase Auth).
- **핵심 기능**: 다중 회사 비교, 그룹별 분류 (47개 그룹), 손익(PnL) 관리, 보고서 작성·뷰어 (YouTube 요약 통합), DART 공시 추적.

## 2. Tech Stack (실제 설치 기준)

| 영역       | 기술                                                                          | 비고                                     |
| ---------- | ----------------------------------------------------------------------------- | ---------------------------------------- |
| 프론트엔드 | Next.js 16.2.4 (App Router) + React 19.2.4 + TypeScript 5                     | `cacheComponents: true`                  |
| 스타일     | Tailwind CSS 4 + shadcn/ui + base-ui/react + lucide-react                     | —                                        |
| 차트       | lightweight-charts + Recharts                                                 | —                                        |
| DB         | Supabase (PostgreSQL 17)                                                      | `@supabase/ssr`, `@supabase/supabase-js` |
| 상태       | Zustand                                                                       | 폼: React Hook Form + Zod                |
| 로깅       | Pino                                                                          | 클라이언트 / Loguru: Python              |
| AI SDK     | `@anthropic-ai/sdk` + `@google/genai`                                         | Claude·Gemini                            |
| 수집       | Python 3.13 + `postgrest-py` + Playwright + pykrx + yfinance + OpenDartReader | venv                                     |
| 배포       | Vercel + GitHub Actions (22 워크플로)                                         | Hobby 플랜                               |
| Cron       | GitHub Actions schedule + cron-job.org (5분 간격)                             | Vercel cron 미사용 (Hobby 제약)          |

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

| 레이어             | 책임                           | 위치                                                                             |
| ------------------ | ------------------------------ | -------------------------------------------------------------------------------- |
| **External**       | 외부 데이터 소스               | DART, fnguide, yfinance, pykrx, Naver, KIS, ER-API, Marklines, Yahoo             |
| **Collection**     | 외부 → DB 적재 + 보강          | `scripts/collect_*.py`, `scripts/enrich_*.py`, `scripts/onboard_company.py`      |
| **Orchestration**  | Cron·트리거·CI                 | `.github/workflows/*.yml`, cron-job.org (5분 간격 워크플로)                      |
| **Data**           | PostgreSQL + 뷰 + 마이그레이션 | `supabase/migrations/`, Supabase 호스팅                                          |
| **Domain Library** | 페이지·기능별 데이터 가공      | `lib/<도메인>/` (reports, pnl, hansae, naver, sentiment)                         |
| **API Routes**     | 공개/보호 API                  | `app/api/*/route.ts` (cron / revalidate / posts / uploads / news / stock-prices) |
| **App Router**     | 페이지 + 'use cache' RSC       | `app/<route>/page.tsx`                                                           |
| **Components**     | 페이지별 / 공용 UI             | `components/<page-or-shared>/`                                                   |
| **Middleware**     | 세션·권한 체크                 | `proxy.ts` (Next.js 16의 새 미들웨어 이름)                                       |

## 5. 페이지·라우트 맵

| 라우트              | 목적                            | 데이터 소스                                 |
| ------------------- | ------------------------------- | ------------------------------------------- |
| `/related-stocks`   | 21개사 메인 표                  | `related_stocks_view`                       |
| `/compare`          | 다중 회사 비교                  | `compareData`, `compareMetrics`             |
| `/domestic`         | 국내자동차 (421개사 + 매크로)   | `domestic_stocks_view`                      |
| `/oem`              | OEM + 모델 outlook              | `oem_sales_*` 7개 테이블                    |
| `/parts-top100`     | 부품사 TOP100                   | `parts_top100_stocks_view`                  |
| `/hansae`           | 한세그룹 (3 종목 intraday)      | KIS 분봉 + pykrx 수급                       |
| `/etc`              | 해운·철강·환율·매크로·두바이유  | `market_series_*`, `exchange_rates_*`       |
| `/reports`          | 보고서 + YouTube 요약           | `posts` 테이블 + `cacheComponents` 패턴     |
| `/management`       | 경영관리 (탭 구조 → §5-A)       | 사외비 5종 (`pnl_entries` 등, §7-G)         |
| `/login`            | 세션 로그인                     | Supabase Auth                               |
| `/stock-popup/[id]` | 주식 팝업 (3/4 주식 + 1/4 뉴스) | `stock_prices`, `news`, `naver_board_posts` |

### 5-A. 경영관리(`/management`) 탭 구조

탭: **pnl** / **plan** / **inventory** / **production** / **personnel** / **companies**. 사외비 테이블(`pnl_entries`·`pnl_cost_structure`·`pnl_plan`·`inventory_entries`·`personnel_entries`)은 모두 `confidentialDb.from(...)` 경유(§7-G + AGENTS.md 데이터·DB 규칙).

- **pnl** — 손익 15섹션: 1~9 기존, 10 이익기여도 TOP7/WORST7(고객·제품), 11·12 전년대비 월별, 13 제품·고객 YoY, 14 수익성 워터폴, 15 고객 매출 집중도(파레토). 소스 `pnl_entries`·`pnl_cost_structure`.
- **plan** — 계획 대비 실적·달성율 콤보 차트 8종(수주·전사 매출/영업이익·미국/상숙/지린·손익개선·공장). `pnl_plan` 사외비 + 차트 2·3은 `pnl_entries` 실적 재사용. 2026 계획=연간, 실적=YTD. USD 환산 FX 적용.
- **inventory** — 재고 KPI 5개 + 차트 6종:
  1. 재고 현황(종류) 콤보 — 운영+관리+보상+운송 누적막대 + 회전율 꺾은선(실적만)
  2. 재고 현황(국가) 누적막대 — 국내(구동+제동조향+전장)·미국·우즈벡 + 영업+국내보상(=전체−국가합, 기본 숨김; 켜면 총액=차트1). 실적만, 회전율 제외
  3. 계획대비 실적(전사) 토글[전체·운영·관리·보상·운송]
  4. 계획대비 실적(국내) 토글[구동·제동조향·전장]
  5. 계획대비 실적(해외) 토글[미국·우즈벡 국가값, 운송과 별개]
  6. 계획대비 실적(운송) 토글[미국·우즈벡·영업재고]
  - 차트 3~6은 최근연도 12월 계획값을 빨간 점선 ReferenceLine. 국가합(국내+미국+우즈벡)은 전체의 ~88%(나머지=영업+보상 국내분). 소스 `inventory_entries`. USD→원화는 `value × fx_rate / 100`(fx=1400).
- **production** — (목록상 탭, 상세 미기재)
- **personnel** — 인원 차트 4종 + 표:
  1. 전체 인원 누적막대 5층[국내(외주포함)·미국·중국·우즈벡·이인텔리전스]
  2. 국내 인원 누적막대 3층[국내·사내외주·협력사원] — 1·2는 전체/사무/생산 토글
  3. 해외·자회사 막대[미국·중국·우즈벡·이인텔리전스 토글]
  4. 사무·생산 비중 누적막대 2층, 드롭다운[전체·국내+외주·국내·미국·중국·우즈벡]
  5. 인원 수 표(시점 4개 가로 펼침, 국내·국내+외주·해외 소계 + 전체 합계)
  - 사무=임원+사무. 소스 `personnel_entries`. 과거=연말, 현재=최신 시점.
- **companies** — 신규 회사 INSERT 폼 → 성공 시 `onboard-company.yml` 자동 트리거(fire-and-forget, INSERT graceful).

**API 라우트 분류**:

- **공개**: `/api/cron/*` (workflow가 호출), `/api/revalidate*` (토큰 검증 후 `updateTag()`)
- **보호** (세션 필수): `/api/news/search`, `/api/stock-prices`, `/api/posts/*`, `/api/uploads/report`, **`/api/chat`** (AI 어시스턴트)

`proxy.ts`의 `PUBLIC_PATH_PREFIXES`(`/login`, `/api/cron`, `/api/revalidate`)와 반드시 일치.

**AI 챗봇 (`/api/chat`)**:

- `lib/chat/` — types, tools(화이트리스트 6개), system-prompt, loop(tool_use 최대 5회), audit
- `components/chat/` — ChatWidget(floating 버튼+Sheet), ChatMessages, ChatInput(외부 전송 경고 배너 포함)
- AppLayout에 마운트되어 모든 페이지에 노출 (로그인·팝업 제외)
- Claude `claude-haiku-4-5` + prompt caching, 세션 메모리만(DB 저장 X), per-user 분당 20회
- 도구 6개: query_companies / query_financials / query_stock_prices / query_news / query_oem_sales / query_macro_series — 모두 anon Supabase로 LIMIT 50 강제
- **PnL 데이터 외부 전송 차단** (20260523): 한세모빌리티 손익은 사외비라 챗봇 도구·system-prompt에서 완전 제외. 시스템 프롬프트의 고객사·공장·제품 명단도 평문 박혀있던 것 제거. 손익 관련 질문은 "/management 페이지 직접 확인" 안내로 정중 거절
- **감사 로그**: 모든 도구 호출은 `chat_audit_log`에 기록 (user_id, tool_name, input, row_count). service_role 전용, 보존 1년. fire-and-forget이라 실패해도 응답은 정상

## 6. 디렉토리 구조 (요약)

> 상세: AGENTS.md "디렉터리 지도" 섹션 참고.

```
app/                      # Next App Router (라우트별 페이지)
components/<page>/        # 페이지별 UI 컴포넌트
components/ui/            # shadcn 원자 컴포넌트 (수동 수정 금지)
components/layout/        # Sidebar, AppLayout 등 공용
lib/                      # 도메인 모듈 + 공용 유틸
  reports/                #   레이어드 (dto/repositories/services)
  pnl/ hansae/ naver/ sentiment/
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

## 7. 데이터 모델 (DB 스키마 상세)

> **이 섹션은 28개 테이블 + 3개 뷰의 단일 진실 공급원이다.** 컬럼 추가/제거 시 본 섹션을 동기화하고, 도메인 규칙(append-only · 연결 우선 등)은 AGENTS.md "데이터/DB 규칙"을 함께 갱신.

### 7-A. 회사 · 매핑

#### `companies` (574행) — 회사 마스터

| 컬럼                                                                                | 타입        | 설명                                                                       |
| ----------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------- |
| `id`                                                                                | uuid PK     | 내부 식별자                                                                |
| `ticker`                                                                            | text UNIQUE | 6자리(KR) / 글로벌 ticker / 비상장은 회사명                                |
| `name`, `name_kr`                                                                   | text        | 영문·한글명 (트리거가 (주)·㈜·주식회사 자동 제거)                          |
| `country`, `market`, `currency`                                                     | text        | KR/US/JP… / kospi/kosdaq/nasdaq/NULL=비상장 / KRW/USD…                     |
| `status`                                                                            | text        | `active` / `hidden` / `merged_into` (구 `delisted` → `hidden`, 2026-05-20) |
| `data_source`                                                                       | text        | yfinance / fnguide / dart / marklines / other                              |
| `group_name`                                                                        | text        | 그룹 분류 (50개 그룹, 사람인 NICE 기반)                                    |
| `company_type`, `region`                                                            | text        | OEM/부품사, 국내/해외 (related_stocks_view용)                              |
| `homepage_url`                                                                      | text        | 비상장사 회사명 클릭 시 새 창 (enrich_company가 수집)                      |
| `business_summary`                                                                  | text        | fnguide / yfinance / LLM 요약                                              |
| `products`, `customers`                                                             | jsonb       | LLM enrich로 채움, append-only                                             |
| `last_price`, `last_change_pct`, `last_volume`, `last_updated_at`                   | —           | 최신 가격 캐시                                                             |
| `market_cap`                                                                        | numeric     | 시총                                                                       |
| `dart_corp_code`, `dart_collection_status`, `last_collect_error`, `retry_after`     | —           | DART 수집 상태 추적                                                        |
| `merged_into_company_id`                                                            | uuid        | 사명변경·합병 시 새 회사로 마이그레이션 후 이 컬럼에 연결                  |
| `is_seed`, `summary_updated_at`, `customers_updated_at`, `created_at`, `updated_at` | —           | 메타                                                                       |

**인덱스**: ticker UNIQUE / status / country / company_type / group_name / dart_corp_code (partial) / dart_collection_status+retry_after (partial) / merged_into_company_id (partial)  
**트리거**: `companies_clean_legal_form_before_iu` — name/name_kr 한글 법인격 자동 정리

#### `company_pages` (592행) — 페이지 매핑

| 컬럼       | 타입                                                     |
| ---------- | -------------------------------------------------------- |
| company_id | uuid FK                                                  |
| page       | text (`domestic` / `related-stocks` / `parts-top100` 등) |
| created_at | timestamptz                                              |

회사 1개가 여러 페이지에 노출 가능. 인덱스: page.

---

### 7-B. 재무

#### `financials` (4,109행)

| 컬럼                                                                                       | 타입    | 비고                                                      |
| ------------------------------------------------------------------------------------------ | ------- | --------------------------------------------------------- |
| `id`                                                                                       | uuid PK |
| `company_id`                                                                               | uuid FK |
| `period_type`                                                                              | text    | `annual` / `quarterly`. annual은 12월 결산만 (CHECK)      |
| `fiscal_year`, `fiscal_quarter`                                                            | int     | 비-12월 결산 글로벌사는 한국식 -1 보정 (20260521000002~3) |
| `period_end_date`                                                                          | date    | 결산일                                                    |
| `currency`                                                                                 | text    | KRW/USD/JPY…                                              |
| `revenue`, `operating_income`, `operating_margin`                                          | numeric | 매출·영익·영익률                                          |
| `cogs`, `gross_profit`, `gross_margin`, `sga`                                              | numeric | 원가·매출총익·판관비                                      |
| `net_income`, `net_margin`, `ebitda`                                                       | numeric | 순익·EBITDA                                               |
| `total_assets`, `total_liabilities`, `total_equity`, `inventory`                           | numeric | 재무상태표                                                |
| `debt_ratio`, `current_ratio`, `roe`, `roa`                                                | numeric | 비율                                                      |
| `eps`, `bps`, `dps`, `cfps`, `per`, `pbr`, `psr`, `ev_ebitda`, `ev_ebit`, `dividend_yield` | numeric | 주당 지표 + 밸류에이션                                    |
| `labor_cost`                                                                               | bigint  | 인건비                                                    |
| `source`                                                                                   | text    | yfinance / fnguide / dart                                 |
| `consolidation`                                                                            | text    | `consolidated` 우선, 종속회사 없을 때만 `separate`        |

**UNIQUE**: (company_id, period_type, fiscal_year, fiscal_quarter) NULLS NOT DISTINCT  
**인덱스**: (company_id, period_type, fiscal_year DESC, fiscal_quarter DESC), source

---

### 7-C. 주가 · 수급

#### `stock_prices` (316,694행) — 일봉 OHLCV

| company_id | trade_date | open | high | low | close | adj_close | volume |

#### `stock_daily_prices` (4,916행, legacy)

deprecated — `stock_prices`로 통합 중. 새 코드는 stock_prices 사용.

#### `stock_quotes_5min` (8,183행) — 분봉 (KIS)

| company_id | ts(timestamptz) | price | change_pct | volume |

#### `stock_supply_demand` (124행) — 일간 수급 (pykrx)

| company_id | trade_date | foreign_net | institution_net | individual_net | program_net | close_price | change_pct |

#### `stock_supply_demand_intraday` (183행) — KIS 잠정 누적 수급

| company_id | snapshot_ts | trade_date | foreign_net | institution_net | individual_net |

**인덱스 패턴**: (company_id, trade_date DESC) / (company_id, ts DESC)

---

### 7-D. 뉴스 · 종목토론

#### `news` (4,547행)

| id | company_id | title | url(UNIQUE) | source | summary | published_at | created_at |

**인덱스**: (company_id, published_at DESC), url UNIQUE

#### `naver_board_posts` (495행) — 한세 3종 종목토론

| company_id | post_id | posted_at | title | body | views | likes | dislikes | fetched_at |

#### `board_sentiment` (495행) — 종목토론 감성 분석

| company_id | post_id | label (positive/negative/neutral) | score | reason | model | analyzed_at |

---

### 7-E. OEM 판매 (Marklines 출처, 대용량)

`year_month`는 YYYYMM 정수 (예: 202504 = 2025년 4월).

| 테이블                          | 키                                      | 행 수   | 인덱스                                     |
| ------------------------------- | --------------------------------------- | ------- | ------------------------------------------ |
| `oem_sales_group_month`         | (oem_group, year_month)                 | 5,518   | year_month                                 |
| `oem_sales_group_country_month` | (oem_group, country, year_month)        | 118,653 | (country, year_month), year_month          |
| `oem_sales_model_country_month` | (oem_group, country, model, year_month) | 923,582 | (model, year_month), (country, year_month) |
| `oem_sales_group_pt_month`      | (oem_group, powertrain, year_month)     | 14,878  | (powertrain, year_month), year_month       |
| `oem_sales_type_seg_month`      | (vehicle_type, segment, year_month)     | 13,394  | year_month                                 |

#### `oem_model_outlook` (10행) — 모델 outlook 노트

| model_key | model_name | oem_group | region | note_date | label | consumer_view | outlook | rationale | sources_used |

#### `uzbekistan_auto_stats` — 우즈베키스탄 자동차 (`/oem/uzbekistan`)

PK `(kind, period_type, year_period, company, brand, vehicle_model, source_type)`. 마이그레이션 `20260527000004` 생성, `20260601000001` CHECK 확장.

| 컬럼          | 값/제약(CHECK)                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `kind`        | `sales` \| `production`                                                                                                   |
| `period_type` | `month` \| `quarter` \| `year` \| `ytd` (`ytd` 2026-06-01 추가)                                                          |
| `year_period` | `YYYY` \| `YYYY-MM`                                                                                                        |
| `company`     | '' / UzAuto Motors / Khorezm Auto / ADM Jizzakh / BYD Uzbekistan Factory / SamAuto / Asaka Motors / Jizzakh Auto / Alyans Auto |
| `brand`, `vehicle_model`, `units`, `source_type`(uzavtosanoat\|stat-uz), `source_url`, `publish_date`, `collected_at` | |

- **판매**(uzavtosanoat 보도자료): 회사별, 본문 용어로 kind 판정, YTD 차분 → month + year. RLS `USING(true)` 공개 SELECT.
- **생산**(stat.uz news-of-committee): 차종(모델)별, 텍스트 + 인포그래픽 이미지(Anthropic 비전 OCR) → month + year. 엔진(Powertrain) 제외.
- 수집 상세 → [`docs/oem-collection.md`](./docs/oem-collection.md) `/oem/uzbekistan`.

---

### 7-F. 매크로 · 환율 · 시계열

#### `exchange_rates` (7,839행) — 일별 환율 (ER-API)

| base | quote | rate_date | rate |  
인덱스: (base, rate_date DESC)

#### `exchange_rates_live` (15행) — 실시간 환율

| base | quote | rate | updated_at |

#### `market_series` (23행) — 시계열 메타

| series_code | label | unit | source | yf_symbol | fred_symbol | category | sort_order |

#### `market_series_daily` (26,635행)

| series_code | trade_date | close |  
인덱스: (series_code, trade_date DESC)  
수집(`collect_market_series.py`): KOSPI·KOSDAQ는 KRX(pykrx `get_index_ohlcv`, `KRX_ID`/`KRX_PW` 로그인 필요 — 야후 `^KS11`/`^KQ11` 당일 지연 회피), 그 외 지수·금/은·국채·원자재는 yfinance(`end`는 exclusive라 +1일 보정), 일부는 FRED. 출처 표기는 `market_series.source`.

#### `macro_outlook_notes` (20행)

| id | note_date | source | summary | sentiment | created_at |  
UNIQUE: (source, note_date)

---

### 7-G. 손익(PnL) · 감사 · 보고서

#### `pnl_entries` (4,589행) — 손익 입력 (사외비)

| basis | year_label | period_year | period_month | is_plan | is_estimate | sil | division | factory | product | customer | revenue | material_cost | labor_cost | expense | sga | rnd | op_income |

**인덱스**: (basis, period_year, period_month), customer, division, product, sil
**RLS**: 정책 없음 (20260523000002 `USING(true)` 삭제) → anon 차단. `service_role` (admin client)만 접근. `/management/pnl` 페이지가 `createSupabaseAdminClient()`로 직접 조회.

#### `pnl_cost_structure` (54행) — 원가구조 (사외비)

| period_year | period_kind | period_month | kind | category | account | value_mwon |
**RLS**: 정책 없음 (20260523000002) → service_role 전용.

#### `chat_audit_log` (신규, 20260523000003) — 챗봇 도구 호출 감사

| id(bigserial) | user_id | user_role | tool_name | input_json(jsonb) | row_count | is_error | error_msg | created_at |

**인덱스**: created_at DESC, (user_id, created_at DESC), (tool_name, created_at DESC)
**RLS**: 정책 없음 → service_role 전용. 보존 1년 (수동 운영 또는 별도 cron).

#### `posts` (68행) — 보고서 본문

| id(bigint) | source_type | title | source_name | source_url | file_path | file_name | thumbnail_url | content | key_scenes(jsonb) | status | error_message | source_published_at | category | created_at | updated_at |

**인덱스**: status, category, source_type, source_name, created_at DESC, source_published_at DESC

---

### 7-H. 토큰 · 매핑

| 테이블                 | 컬럼                                   | 용도                              |
| ---------------------- | -------------------------------------- | --------------------------------- |
| `kis_tokens`           | env_key, token, expires_at, updated_at | 한국투자증권 API 토큰 (자체 갱신) |
| `product_category_map` | raw_category, normalized               | 제품 카테고리 정규화 매핑 (63행)  |

---

### 7-I. 주요 뷰

#### `related_stocks_view`

`/related-stocks` 페이지용. `company_pages.page='related-stocks'` JOIN + `financials` 최근 5년 jsonb 집계 + `latest_quarter` 전년 동기 비교 + `exchange_rates_live`로 KRW 환산. company_type/region 포함.

#### `domestic_stocks_view`

`/domestic` 페이지용 (421개사). related와 동일 구조 + `sales_rank` = `ROW_NUMBER() OVER (ORDER BY latest_revenue_krw DESC NULLS LAST, name_kr)`.

#### `parts_top100_stocks_view`

`/parts-top100` 페이지용. country 코드를 한글 국가명(`group_name`)으로 치환. **미래 가드**: `period_end_date <= now()` 필터로 미래 회계연도 데이터 노출 차단 (20260521000001).

---

### 7-J. 핵심 트리거 · 제약 · 정책

- `companies_clean_legal_form_before_iu` — name/name_kr 자동 정리: `(주)`, `㈜`, `(株)`, `주식회사`, `유한회사`, `유한책임회사` 제거 (20260520000009)
- `financials.period` CHECK — annual은 12월만 허용
- 비-12월 결산 글로벌사 fiscal_year 한국식 -1 보정 (20260521000002 일본 / 20260521000003 일본 외)
- `parts_top100_stocks_view` 미래 period_end_date 가드 (20260521000001)
- `companies.status` — `active` / `hidden` / `merged_into` (구 `delisted` 명칭 변경, 20260520)

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

| 메커니즘                            | 적용 위치             | TTL/무효화                                            |
| ----------------------------------- | --------------------- | ----------------------------------------------------- |
| **`cacheComponents: true`**         | `next.config.ts` 전역 | RSC 함수에 `'use cache'` 디렉티브 필요                |
| **`'use cache'` + `cacheTag(...)`** | 페이지·서버 함수      | `updateTag(tag)`로 명시 무효화                        |
| **`experimental.staleTimes: 0`**    | 라우터 캐시           | 페이지 재방문 시 클라이언트 컴포넌트 재마운트         |
| **HTTP cache (Vercel CDN)**         | `/_next/static/*`     | 빌드 시 immutable                                     |
| **Supabase 풀러**                   | server/admin client   | 풀 사이즈 default (서버 컴포넌트 매 호출 새 인스턴스) |

**무효화 태그**:

- `related_stocks_view`, `domestic_stocks_view`, `parts_top100_stocks_view`
- `exchange_rates_live`, `oem_sales_group_month`, `oem_sales_group_pt_month`, `oem_sales_group_country_month`, `oem_sales_type_seg_month`

자동 매핑: `scripts/lib/revalidate.py::COLUMN_TO_TAGS` (수정 시 `revalidate_for_tables` 호출 가능).

## 10. 자동화 (GitHub Actions + cron-job.org)

### 22개 워크플로 카테고리

| 카테고리                | 워크플로 예시                                                     | 주기                   |
| ----------------------- | ----------------------------------------------------------------- | ---------------------- |
| 가격                    | collect-prices, collect-prices-live                               | 매시간 / 5분           |
| 환율                    | collect-fx, collect-fx-live                                       | 매시간 / 5분           |
| 재무                    | collect-financials (4 job: listed/dart-audit×8/domestic/snapshot) | 분기 (1/4/7/10월 15일) |
| 뉴스                    | collect-news                                                      | 4시간                  |
| 감성                    | analyze-board-sentiment                                           | 일간                   |
| DART                    | collect-dart-audit (shard 8), collect-dart-labor                  | 분기 / 일간            |
| 매크로                  | collect-macro-outlook, collect-market-series                      | 일간 / 주간            |
| 해운·철강               | collect-shipping, collect-steel-kr                                | 일간                   |
| 원자재                  | collect-dubai-oil                                                 | 일간                   |
| 글로벌 스냅샷           | collect-global-snapshot                                           | 일간                   |
| 한세 종목토론           | collect-naver-board (GHA Node tsx 직접)                           | 30분                   |
| 한세 분봉               | collect-hansae-intraday (KIS)                                     | 5분                    |
| OEM                     | collect-oem-model-outlook                                         | 일간                   |
| OEM 우즈벡              | collect-uzbekistan-sales (uzavtosanoat 판매), collect-uzbekistan-production (stat.uz 차종별 생산, 텍스트+이미지 비전) | 매월 20·28일 |
| 보강                    | enrich-company                                                    | 수동                   |
| Vercel cron 대체 (curl) | cron-sentiment                                                    | 일 1회                 |

### cron-job.org 외부 트리거

GitHub Actions schedule이 5분 간격은 안정성 보장 안 되어 cron-job.org에서 매 5분 GHA dispatch 호출.

### 회사 onboarding (수동)

```bash
python scripts/onboard_company.py --ticker 005380
# → enrich_company (재무 + 메타 + 뉴스) + revalidate
# 주가는 다음 collect_prices_live cron에서 자동
```

## 11. 보안

| 영역              | 정책                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **세션**          | Supabase Auth (쿠키), `proxy.ts`가 `PUBLIC_PATH_PREFIXES` 외 라우트는 세션 강제                                                                          |
| **권한**          | `lib/auth/permissions.ts` — 역할별 라우트 화이트리스트                                                                                                   |
| **API 토큰**      | `/api/revalidate*`은 `x-revalidate-secret` 헤더 검증 + SSRF·쿠키 가드                                                                                    |
| **DB**            | RLS 활성화 (Supabase 호스팅). `service_role`은 server 전용 (`lib/supabase/admin.ts`)                                                                     |
| **사외비 테이블** | `pnl_entries`, `pnl_cost_structure`, `chat_audit_log` 은 RLS 정책 없음 → anon 차단. server 컴포넌트에서 admin client만 접근 (20260523)                   |
| **AI 외부 전송**  | 챗봇은 Anthropic API로 데이터 전송 → 사외비(손익)는 도구·system-prompt에서 완전 제외. 입력창에 외부 전송 경고 배너. 모든 도구 호출 `chat_audit_log` 기록 |
| **Secrets**       | `.env.local`, `scripts/.env`, GitHub Actions Secrets. **코드 커밋 금지**                                                                                 |
| **외부 입력**     | Zod 검증 (`lib/reports/dto/`)                                                                                                                            |
| **SQL**           | postgrest 파라미터 바인딩만 (문자열 결합 금지)                                                                                                           |

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

| 패턴                                               | 이유                                  |
| -------------------------------------------------- | ------------------------------------- |
| `supabase/migrations/*.sql` 신규                   | DB 스키마 변경 → §7 갱신              |
| `app/<라우트>/page.tsx` 신규                       | 페이지 추가 → §5 갱신                 |
| `app/api/**/route.ts` 신규                         | API 라우트 + 공개/보호 분류 → §5 갱신 |
| `scripts/lib/*` 신규                               | 공용 수집 모듈 → §6, §10              |
| `.github/workflows/*` 신규/제거                    | 자동화 변경 → §10                     |
| `next.config.ts` / `proxy.ts` / `vercel.json` 수정 | 캐싱·보안·배포 변경 → §9, §11, §12    |
| `lib/<new-domain>/` 신규 폴더                      | 도메인 모듈 추가 → §6                 |
| `scripts/` 새 prefix                               | 카테고리 추가 → §6                    |
| 도메인 약속 변경 (append-only, 연결 우선 등)       | 데이터 정책 → §7                      |

> hook이 오탐인 경우 `SKIP_AGENTS_CHECK=1 git commit ...`로 우회 (한 번만 우회되고 다음 커밋엔 다시 적용).

---

## 부록 A. 최근 주요 변경 (2026-05-20 ~ 2026-05-23)

- **status='hidden'** 도입 (`delisted` → `hidden`)
- 일본 회계연도 한국식 -1 보정 (20260521000002, 20260521000003)
- 부품사 TOP100 뷰 미래 가드 (20260521000001)
- DART corp_code 자동/수동 매핑 24개
- 6차 워크플로 stable (`os._exit(0)` + yfinance 미래 period_end 가드)
- 그룹 분류 50개 정리 (사람인 NICE 기반)
- **homepage_url** enrich_company에 수집 추가 + onboard_company.py 도입
- **챗봇 PnL 외부 전송 차단** (2026-05-23): `query_pnl` 도구 + system-prompt PnL 카탈로그(고객사·공장·제품 명단) 완전 제거. `pnl_entries`·`pnl_cost_structure` RLS 정책 삭제(anon 차단) + admin client 전용 전환 (20260523000002). `chat_audit_log` 신규 — 모든 챗봇 도구 호출 1년 보존 (20260523000003). 챗봇 입력창에 외부 전송 경고 배너 추가.
