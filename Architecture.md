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
| 배포       | Vercel + GitHub Actions (23 워크플로)                                         | Hobby 플랜                               |
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
│  23 워크플로     │    │  collect / enrich  │    │  PostgreSQL +    │
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

탭: **pnl** / **plan** / **stellantis** / **inventory** / **production** / **personnel** / **finance** / **org-chart** / **companies**. 사외비 테이블(`pnl_entries`·`pnl_cost_structure`·`pnl_fixed_variable`·`pnl_plan`·`longterm_revenue_plan`·`inventory_entries`·`personnel_entries`·`finance_entries`·`loan_entries`)은 모두 `confidentialDb.from(...)` 경유(§7-G + AGENTS.md 데이터·DB 규칙).

- **pnl** — 손익 16섹션: 1 전사 비용구조, **2-1 손익분기점(BEP) 분석**(콤보차트: 우상단 토글[손익분기점·매출(억원) / 공헌이익률·고정비율(%)] 묶은 막대 + 영업이익률 표식 꺾은선, 이중축 영역 분리[§4-F]·범례 LegendRow. 영업이익률=공헌이익률−고정비율), **2-2 전사 고정비·변동비 구조**(계정명 표: 매출액→비용합계→상세→영업이익, 연도별 합계/고정비/변동비+매출대비% & 변동비/고정비율 열. 우상단 토글 기본/상세·인건비·상각비 — 인건비/상각비는 해당 계정을 비용 상단 소계로 묶고 원그룹서 제외. 계정명은 최신연도 합계 내림차순 정렬['기타'는 맨 아래], 행 클릭 시 노란 강조 토글(다중)), 3 2026 연간 추정, 4~9 전사/부문/고객/제품/고객·제품/실별 실적, 10 수익성 산점(매출 YoY×영업이익률), 11 이익기여도 TOP10/WORST10, 12·13 전년대비 월별, 14 제품·고객 YoY, 15 고객 매출 집중도(파레토). 소스 `pnl_entries`·`pnl_cost_structure`·`pnl_fixed_variable`.
- **plan** — 차트 10종.
  1. **중장기 매출 전망**(`LongtermRevenueChart`) — 2027~2031 연도별 세로 그룹 막대 3계열(수주 Volume·고객 EDI 100%·한세 전망) + 데이터 기준 드롭다운(2026.1Q/2026.2Q, 기본=최신). 단위 **억원**(DB `value_mwon`은 엑셀 원본 백만원, `buildLongtermPoints()`가 ÷100 환산 — 재무 탭과 같은 규칙). 환율 기준은 엑셀 원문 문구를 차트 상단에 표기. 값이 전무한 계열은 막대·범례 모두 생략(2026.1Q의 '고객 EDI 100%'=엑셀 N/A). 범례 클릭으로 계열 on/off(`useHiddenSeries`), **기본은 '한세 전망'만 켜짐**. 범례는 `LegendRow`로 순서 고정(recharts 기본 범례는 데이터 키 가나다순을 따라가 막대 왼→오와 어긋남). 소스 `longterm_revenue_plan`(§7-G), 적재 `sync_longterm_revenue.py`.
  2. ~10. 계획 대비 실적·달성율 콤보 차트 9종(수주·입찰 성공율·전사 매출/영업이익·미국/상숙/지린·손익개선·공장). `pnl_plan` 사외비 + 차트 4·5는 `pnl_entries` 실적 재사용. 2026 계획=연간, 실적=YTD. USD 환산 FX 적용.
- **stellantis** — 주거래처 스텔란티스 북미 매출 전망. 항등식 **출하 − 소매 = 딜러 재고 증감**. 진단 카드 4장(재고 상태 3색 + 판정 근거 전문 · 출하 vs 소매 갭 · 탐지 시차[r·n 동반] · 다음 분기 전망) + 차트 4종:
  1. 북미 출하·소매 막대 + 재고 증감 꺾은선 콤보 — **선이 음수(재고 소진) 가능**해 §4-F 공식을 일반화한 domain + 0선 `ReferenceLine`(chart-guide §4-F). 차분 도출 분기(Q2·Q4)는 빗금 막대
  2. 자사 매출(억원) 막대 + 스텔란티스 북미 소매(대) 꺾은선 — 탐지 시차만큼 밀어 정렬, 결측 구간은 선 미연결
  3. 대당 매출 원단위(자사 매출 ÷ 북미 출하) 라인 + 평균선 — 4번 전망의 전제(CV로 안정성 표시)
  4. 매출 전망 막대 — 최근 8분기 실적 + 시나리오 3종(재고 유지/정상화/추세 지속, 빗금). **가정 문장을 차트 하단에 노출**
  - 소스 `lib/stellantis-forecast/`(`source.ts` + pure `aggregate.ts`). 공개 3종(`stellantis_shipments`·MarkLines·`cox_brand_inventory`)은 anon, **자사 매출(`pnl_entries` customer='Stellantis NA')만 `confidentialDb`**. 소매는 캐나다 1개월 지연 → 3개국이 다 찬 분기까지만 집계(`lastCompleteQuarter`), 제약은 페이지 각주로 상시 노출. 권한은 `/management` 분기 자동 적용(guest·hmobility 차단) — `permissions.ts` 수정 불필요.
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
- **finance** — 재무(대차대조표) 차트 2종:
  1. 재무 레버리지 콤보 — 자산·부채 묶은 막대 + 부채비율(=부채/자본 ×100) 표식 꺾은선, 이중축 오프셋으로 막대(하단)·선(상단) 분리. 자회사 필터(전체/미국/상숙, 데이터 기반 자동) — 차트1 전용.
  2. 투하자본·자금조달 표 — 모든 연속 구간 증감(▲파랑/▼빨강). 투하자본 = 순운전자본(채권+재고−채무) + CAPEX(유형+무형), 자금조달 = 현금+증자+차입금. 전체/연결 고정.
  3. 이인텔리전스 대여금 — KPI 3장(누적/당월/2026 YTD 계획대비 지급율) + 계획 대비 실적 막대(재고 `InventoryAchievementChart` 재사용, 2025=실적만·2026=계획+실적). 소스 `loan_entries`(억원 원본 `loan_eok`).
  - 소스 `finance_entries`. 억원=`value_mwon / 100`. 시점은 과거=연말(annual), 당해연도=최신월(YTD).
- **org-chart** — 조직도: 시점별 조직도 이미지(비공개 버킷 `org-charts` PNG) + 날짜 드롭다운. admin·holdings·mobility 전용(hmobility·guest 차단, `permissions.ts`). 메타는 `org_charts`(사외비, §7-G), 이미지는 인증 프록시 `/api/management/org-chart/image/[date]`로 스트리밍. 적재는 로컬 `scripts/sync_org_chart.py`(Excel COM).
- **companies** — 신규 회사 INSERT 폼 → 성공 시 `onboard-company.yml` 자동 트리거(fire-and-forget, INSERT graceful).
- **upload** (admin 전용) — 월별손익 엑셀(`.xlsx`) 업로드 → `management-excel` 버킷 저장 + `management_uploads` 작업행 INSERT + `sync-management.yml` dry-run dispatch. UI가 `/api/management/upload/[jobId]`를 폴링, 완료 후 admin이 "적재 확정" → apply dispatch → 8 sync 실행 + 8종 태그 일괄 revalidate. 소스 `management_uploads`(사외비, §7-G). admin 역할만 접근(`permissions.ts`).

**API 라우트 분류**:

- **공개**: `/api/cron/*` (workflow가 호출), `/api/revalidate*` (토큰 검증 후 `updateTag()`)
- **보호** (세션 필수): `/api/news/search`, `/api/stock-prices`, `/api/posts/*`, `/api/uploads/report`, **`/api/chat`** (AI 어시스턴트), `/api/management/org-chart/image/[date]` (조직도 이미지 프록시 — admin·holdings·mobility만)

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

#### `/oem` 프리렌더 집계 뷰 (마이그레이션 `20260714000001`)

`oem_sales_group_country_month`(약 12만 행)를 앱에서 전량 fetch·집계하면 빌드 프리렌더가 statement/USE_CACHE timeout(백업 커밋 배포 간헐 ERROR) → 무거운 SUM을 DB로 이관. 순수 SUM 재집계라 값은 원본과 동일(전역 합계 항등 검증됨).

| 뷰                             | 정의                                                               | 행 수  | 용도                           |
| ------------------------------ | ------------------------------------------------------------------ | ------ | ------------------------------ |
| `oem_sales_country_group_year` | `year(=ym/100) × oem_group × country` → SUM(sales)::bigint         | ~1.2만 | 국가 TOP15 / OEM×국가 매트릭스 |
| `oem_sales_usa_group_month`    | `country='USA'` 한정 `oem_group × year_month` → SUM(sales)::bigint | ~1.8천 | 미국 TOP10 OEM 월별 시계열     |

- `lib/oem/source.ts`가 뷰1은 `TARGET_YEAR`만, 뷰2는 전체 기간 fetch. `cacheTag`는 원본 `oem_sales_group_country_month` 유지(뷰는 실시간 반영이라 수집 시 원본 무효화로 자동 갱신).

> ⚠️ **지표 정의**: 위 5개 테이블 + 2개 뷰는 전부 MarkLines `vehicle_sales` export **하나**에서 파생되며 **판매(소매/신차등록)** 다. 출하·생산이 아니다(`import_oem_sales.py`의 단일 `aggregate()`가 소스). 프로젝트 전체에서 **출하(도매)는 `stellantis_shipments`·`hyundai_sales`·`kia_sales`·`kg_mobility_sales`뿐**이고, **생산은 `uzbekistan_auto_stats`(`kind='production'`)뿐**이다.

#### `stellantis_shipments` (21행, 신규 `20260716000001`) — Stellantis IR 북미 도매 출하

| region | period_type | year_period | shipments_units | is_derived | source_url | filing_date | collected_at |

- **PK** (region, period_type, year_period) · **인덱스** (period_type, year_period) · **RLS** anon read / service_role write (공개 데이터)
- 출처 **SEC EDGAR 6-K**(`data.sec.gov/submissions/CIK0001605484.json`, **UA 헤더 필수**). stellantis.com은 Akamai 403 차단이라 미사용.
- 지표 = `shipments`(공장→딜러 인도, **매출 인식 기준**). `stellantis_na_sales`(소매+플릿 최종고객 인도)와 **정반대 지표**다.
- `region='North America'`는 미국+캐나다+멕시코이며 **마세라티 제외**(별도 세그먼트) → 소매와 대비 시 스코프를 맞출 것.
- `is_derived=true` = **Q2 = H1 − Q1, Q4 = FY − H1 − Q3** 차분 도출(실적 PR이 Q1/H1/Q3/FY 4회뿐, 천대 반올림 ±1,000대). **2026 이후에도 동일** → 최신 분기가 비어 있는 게 정상.
- 검증: FY PR의 H2 표(스크립트 미사용 독립 소스)와 `Q3 + 도출Q4` 대조 → 2021~2025 **오차 0**.

#### `cox_brand_inventory` (신규 `20260716000001` + `20260716000002`) — Cox 브랜드별 딜러 재고일수

| brand | year_month | days_supply | is_outlier_excluded | source_url | image_url | collected_at |

- **PK** (brand, year_month) · **인덱스** year_month · **RLS** anon read / service_role write (공개 데이터)
- 출처 coxautoinc.com 월간 리포트. **브랜드별 수치가 차트 JPEG 안에만** 있어 LLM vision 판독(CSV 첨부는 산업 전체만).
- **CHECK**: `(is_outlier_excluded AND days_supply IS NULL) OR (NOT is_outlier_excluded AND days_supply IS NOT NULL)`
- **결측의 의미가 2가지다 — 섞지 말 것**: `is_outlier_excluded=true` + `days_supply=null` = Cox가 **업계 평균(NATION)×2 초과라 값을 감춘 것**(= 강한 위험 신호. Chrysler가 202512~202603 이 상태). **행 자체가 없으면** 저물량 상시 제외(Fiat·Alfa Romeo)·그 달 로스터 누락·판독 실패 중 하나로 **우리가 모르는 상태**.
- `brand`는 `BRAND_ALIASES` 정규화 후 값(Cox가 202602부터 `Mercedes-Benz` → `Mercedes`로 라벨 변경). 업계 평균 행은 `NATION`.
- 과거치가 **소급 수정**되므로 최근 3개월 재적재. 적재 전 기존 DB 값과 대조해 변경분을 경고한다.

#### `oem_model_outlook` (10행) — 모델 outlook 노트

| model_key | model_name | oem_group | region | note_date | label | consumer_view | outlook | rationale | sources_used |

#### `uzbekistan_auto_stats` — 우즈베키스탄 자동차 (`/oem/uzbekistan`)

PK `(kind, period_type, year_period, company, brand, vehicle_model, source_type)`. 마이그레이션 `20260527000004` 생성, `20260601000001` CHECK 확장.

| 컬럼                                                                                                                  | 값/제약(CHECK)                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `kind`                                                                                                                | `sales` \| `production`                                                                                                        |
| `period_type`                                                                                                         | `month` \| `quarter` \| `year` \| `ytd` (`ytd` 2026-06-01 추가)                                                                |
| `year_period`                                                                                                         | `YYYY` \| `YYYY-MM`                                                                                                            |
| `company`                                                                                                             | '' / UzAuto Motors / Khorezm Auto / ADM Jizzakh / BYD Uzbekistan Factory / SamAuto / Asaka Motors / Jizzakh Auto / Alyans Auto |
| `brand`, `vehicle_model`, `units`, `source_type`(uzavtosanoat\|stat-uz), `source_url`, `publish_date`, `collected_at` |                                                                                                                                |

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

#### `market_series_live` — 지수·원자재 라이브 끝점 (현재가)

| series_code (PK→market_series) | price | updated_at |  
RLS: `anon_read`(SELECT) + `service_write`(ALL), `market_series_daily`와 동일.  
수집(`collect_market_series_live.py`, 매일 매시 `collect-market-series-live.yml`): `market_series.yf_symbol`이 있고 국채(UST10Y/UST30Y)가 아닌 16종을 yfinance `fast_info.last_price`로 upsert. 일봉(`market_series_daily`) 차트 끝점을 `appendLivePoint`로 라이브 갱신(환율 `exchange_rates_live` 패턴). 국채는 제외.

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

#### `pnl_fixed_variable` (신규, 20260609000001 + 02) — 고정비/변동비 비용구조 (사외비)

| period_year | period_kind('annual'|'monthly') | period_month | cost_type('고정비'|'변동비'|'매출'|'변동비율') | category2(매출원가/판매관리비) | category3(재료비/노무비/경비/판매관리비/연구개발비) | account(계정명) | value_mwon |

엑셀 '고정비' 시트 적재(`sync_pnl_fixed_variable.py`). cost_type 4종:

- `고정비`/`변동비`: 계정명별 연도 비용 금액(백만원).
- `매출`: 매출 행(고정/변동 구분 없음). category2/3/account 모두 '매출' 센티넬.
- `변동비율`: 기준 변동비율 가정치(0~1). `period_year=0`(연도 무관), `value_mwon`에 비율 저장. 고정비율은 UI에서 1−변동비율.

'기타'·'감가상각비' 계정명이 category3 간 중복이라 PK에 category2/category3 포함. `/management/pnl`의 `FixedVariableStructure`(2번 표)가 계정명 레벨로: 매출액 → 비용합계 → 매출원가/판관비 상세 → 영업이익(=매출−비용합계), 연도별 합계·고정비·변동비(매출대비%) + 구분 우측 변동비(%)·고정비(%) 열. `sync`는 시트 매출·파생 영업이익을 DB `pnl_cost_structure`와 대조(정합성, 임계 0.5%, 금액 비노출).
**인덱스**: (period_year, period_kind, period_month), (category2, category3)
**RLS**: 정책 없음 (20260609000001) → service_role 전용(`getFixedVariable()` confidentialDb).

#### `finance_entries` (신규, 20260610000001) — 재무(대차대조표) 추이 (사외비)

| subsidiary | consolidation | period_year | period_kind('annual'|'monthly') | period_month | account | value_mwon |

엑셀 '재무' 시트 적재(`sync_finance.py`). 대차대조표 계정(자산·부채·자본·채권·채무·재고·유형자산·무형자산·현금성자산·차입·증자). 시점 정규화: 과거='연간'/월=12 → annual(month=12, 연말), 당해=월별(monthly, 1~11). UI는 억원(`value_mwon/100`), 과거=연말·당해=최신월(YTD). `/management/finance`가 `FinanceLeverageChart`(자산·부채·부채비율 콤보)+`FinanceCapitalTable`(투하자본·자금조달 증감표)로 렌더.
**PK**: (subsidiary, consolidation, period_year, period_kind, period_month, account)
**인덱스**: (subsidiary, period_year, period_kind, period_month)
**RLS**: 정책 없음 (20260610000001) → service_role 전용(`confidentialDb`).

#### `loan_entries` (신규, 20260611000001) — 이인텔리전스 대여금 계획·실적 (사외비)

| period_year | period_month(1~12) | kind('계획'\|'실적') | loan_eok |

엑셀 '이인텔리전스' 시트 적재(`sync_loan.py`). 자회사(이인텔리전스) 대여금. 단위 억원 원본(`loan_eok`, 환산 없음). 공란(미래월·결측월)→null. `/management/finance` 3번 블록: `LoanKpiCards`(누적/당월/2026 YTD 계획대비 지급율) + 계획대비 실적 막대(재고 `InventoryAchievementChart` 재사용, 2025=실적만·2026=계획+실적).
**PK**: (period_year, period_month, kind)
**RLS**: 정책 없음 (20260611000001) → service_role 전용(`confidentialDb`).

#### `longterm_revenue_plan` (신규, 20260715000001) — 영업본부 중장기 매출 전망 (사외비)

| basis_year | basis_quarter(1~4) | series('수주 Volume'\|'고객 EDI 100%'\|'한세 전망') | period_year | value_mwon | fx_note |

`참고/영업계획/*.xlsx` '연도별 Booked 매출' 시트 요약표(B2:H11) 적재(`sync_longterm_revenue.py`, **월별손익 엑셀과 다른 파일** → 업로드 오케스트레이터 미편입). DB는 백만원 원본(`value_mwon`), 화면은 억원(÷100). 기준(basis) 2종 × 계열 3종 × 전망 연도 5개(2027~2031) = 30행. 엑셀 `N/A`(2026.1Q의 '고객 EDI 100%')→null이며 값이 전무한 계열은 차트에서 막대·범례 모두 생략(0으로 그리지 않음). `fx_note`는 시트 B2 원문 1줄 — 시트에 하나뿐이라 전 행 동일값 중복 저장(조인 회피). `/management/plan` 1번 차트: `LongtermRevenueChart`(기준 드롭다운 + 3계열 세로 그룹 막대).
**PK**: (basis_year, basis_quarter, series, period_year)
**RLS**: 정책 없음 (20260715000001) → service_role 전용(`confidentialDb`).

#### `management_uploads` (신규, 20260624000001) — 경영관리 엑셀 업로드 작업 (사외비)

| 컬럼          | 타입        | 설명                                                                                                   |
| ------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| `id`          | uuid PK     | 작업 식별자 (job_id)                                                                                   |
| `status`      | text        | `uploaded` → `dry_run_running` → `dry_run_ok`/`dry_run_failed` → `applying` → `applied`/`apply_failed` |
| `mode`        | text        | `dry-run` / `apply`                                                                                    |
| `excel_path`  | text        | 버킷 내 경로 (`{YYYY-MM-DD}/{job_id}.xlsx`)                                                            |
| `file_name`   | text        | 원본 파일명                                                                                            |
| `uploaded_by` | text        | admin 사용자 식별                                                                                      |
| `summary`     | jsonb       | dry-run/apply 결과 요약 — 행수·연도·mismatch 수 등 **금액 비노출**                                     |
| `error_msg`   | text        | 실패 시 오류 메시지                                                                                    |
| `created_at`  | timestamptz | 자동 설정                                                                                              |
| `updated_at`  | timestamptz | 트리거 자동 갱신                                                                                       |

**인덱스**: created_at DESC  
**RLS**: 정책 없음 (20260624000001) → anon 차단. `confidentialDb.from('management_uploads')` 전용.  
**상태 머신**: `uploaded`(업로드 직후) → `dry_run_running`(GHA 실행 중) → `dry_run_ok`(정상)/`dry_run_failed`(오류) → `applying`(admin 확정 후) → `applied`(성공)/`apply_failed`(오류).

**버킷 `management-excel`** (비공개, public=false, 정책 없음 → service_role 전용):  
업로드 경로 `{YYYY-MM-DD}/{job_id}.xlsx`. GHA runner가 Supabase Storage API로 다운로드(`SUPABASE_URL`+`SUPABASE_SERVICE_ROLE_KEY`).

#### `org_charts` (신규, 20260624000002) — 조직도 이미지 메타 (사외비)

| 컬럼          | 타입          | 설명                                             |
| ------------- | ------------- | ------------------------------------------------ |
| `chart_date`  | date PK       | 조직도 스냅샷 날짜 (시트명 `_YYYYMMDD`에서 파싱) |
| `title`       | text          | 조직도 제목                                      |
| `image_path`  | text NOT NULL | `org-charts` 버킷 객체 키                        |
| `source_file` | text          | 원본 엑셀 파일명                                 |
| `width`       | int           | 이미지 가로(px)                                  |
| `height`      | int           | 이미지 세로(px)                                  |
| `created_at`  | timestamptz   | 자동 설정                                        |

**PK**: chart_date (이력 누적 → upsert by chart_date)  
**RLS**: 정책 없음 (20260624000002) → anon 차단. `confidentialDb.from('org_charts')` 전용.  
적재는 로컬 `scripts/sync_org_chart.py`(Excel COM, Windows+Excel 필요 — Vercel/GHA 자동 렌더 불가). 페이지 `/management/org-chart`(admin·holdings·mobility 전용)는 메타를 `'use cache'`로 캐싱(`lib/org-chart/source.ts`), 이미지는 인증 프록시 `/api/management/org-chart/image/[date]`로 스트리밍.

**버킷 `org-charts`** (비공개, public=false, 정책 없음 → service_role 전용):  
조직도 PNG 저장. anon 직접 접근 불가 — 인증 프록시 API를 통해서만 스트리밍.

---

#### `chat_audit_log` (신규, 20260523000003) — 챗봇 도구 호출 감사

| id(bigserial) | user_id | user_role | tool_name | input_json(jsonb) | row_count | is_error | error_msg | created_at |

**인덱스**: created_at DESC, (user_id, created_at DESC), (tool_name, created_at DESC)
**RLS**: 정책 없음 → service_role 전용. 보존 1년 (수동 운영 또는 별도 cron).

#### `posts` (68행) — 보고서 본문

| id(bigint) | source_type | title | source_name | source_url | file_path | file_name | thumbnail_url | content | key_scenes(jsonb) | status | error_message | source_published_at | category | created_at | updated_at |

**인덱스**: status, category, source_type, source_name, created_at DESC, source_published_at DESC

> 본문(`content`) **작성 규칙·게시 절차·마크다운 렌더 함정**은 [`report.md`](./report.md) 참고.

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

**경영관리 엑셀 업로드 흐름** (admin 전용):

```
admin /management/upload
   ↓ POST /api/management/upload (.xlsx)
Supabase Storage management-excel 버킷 저장
   + management_uploads 작업행 INSERT (status=uploaded)
   ↓ GitHub workflow_dispatch (sync-management.yml, mode=dry-run)
GHA runner: sync_management_excel.py
   → 버킷에서 엑셀 다운로드
   → 8개 sync 스크립트 --dry-run 순차 실행 (정합성 검증 포함)
   → management_uploads.summary 갱신 (행수·연도·mismatch 수, 금액 비노출)
   → status = dry_run_ok / dry_run_failed
   ↓ UI 폴링 GET /api/management/upload/[jobId]
admin 결과 확인 → "적재 확정" 클릭
   ↓ POST /api/management/upload/[jobId]/apply
GitHub workflow_dispatch (mode=apply)
GHA runner: sync_management_excel.py (apply)
   → 8개 sync 실제 적재 (upsert)
   → 8종 태그 일괄 revalidate (revalidate.py)
   → status = applied / apply_failed
```

엔드투엔드 소요시간 약 6~10분(GHA 러너 부팅 + 의존성 설치 + 8 sync × 2 사이클). 엑셀 행 삭제·차원 변경은 이 흐름으로도 옛 PK가 잔존하므로 `project_pnl_dimension_change_resync` 절차 병행.

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

### 23개 워크플로 카테고리

| 카테고리                | 워크플로 예시                                                                                                         | 주기                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 가격                    | collect-prices, collect-prices-live                                                                                   | 매시간 / 5분                   |
| 환율                    | collect-fx, collect-fx-live                                                                                           | 매시간 / 5분                   |
| 재무                    | collect-financials (4 job: listed/dart-audit×8/domestic/snapshot)                                                     | 분기 (1/4/7/10월 15일)         |
| 뉴스                    | collect-news                                                                                                          | 4시간                          |
| 감성                    | analyze-board-sentiment                                                                                               | 일간                           |
| DART                    | collect-dart-audit (shard 8), collect-dart-labor                                                                      | 분기 / 일간                    |
| 매크로                  | collect-macro-outlook, collect-market-series, collect-market-series-live                                              | 일간 / 주간 / 매시간           |
| 해운·철강               | collect-shipping, collect-steel-kr                                                                                    | 일간                           |
| 원자재                  | collect-dubai-oil                                                                                                     | 일간                           |
| 글로벌 스냅샷           | collect-global-snapshot                                                                                               | 일간                           |
| 한세 종목토론           | collect-naver-board (GHA Node tsx 직접)                                                                               | 30분                           |
| 한세 분봉               | collect-hansae-intraday (KIS)                                                                                         | 5분                            |
| OEM                     | collect-oem-model-outlook                                                                                             | 일간                           |
| OEM 우즈벡              | collect-uzbekistan-sales (uzavtosanoat 판매), collect-uzbekistan-production (stat.uz 차종별 생산, 텍스트+이미지 비전) | 매월 20·28일                   |
| OEM 스텔란티스          | collect-stellantis-na-sales (prnewswire 미국 소매 판매), collect-stellantis-shipments (SEC EDGAR 북미 도매 출하)      | 분기 (1/4/7/10월 · 2/5/8/11월) |
| 신차 재고 (Cox)         | collect-cox-inventory (coxautoinc 브랜드별 재고일수, 차트 이미지 비전 판독)                                           | 매월 20일                      |
| 보강                    | enrich-company                                                                                                        | 수동                           |
| 경영관리 엑셀 업로드    | sync-management (workflow_dispatch — dry-run/apply)                                                                   | 수동                           |
| Vercel cron 대체 (curl) | cron-sentiment                                                                                                        | 일 1회                         |

### cron-job.org 외부 트리거

GitHub Actions schedule이 5분 간격은 안정성 보장 안 되어 cron-job.org에서 매 5분 GHA dispatch 호출.

### 회사 onboarding (수동)

```bash
python scripts/onboard_company.py --ticker 005380
# → enrich_company (재무 + 메타 + 뉴스) + revalidate
# 주가는 다음 collect_prices_live cron에서 자동
```

## 11. 보안

| 영역              | 정책                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **세션**          | Supabase Auth (쿠키), `proxy.ts`가 `PUBLIC_PATH_PREFIXES` 외 라우트는 세션 강제                                                                                                                                                                                                                                                                                                      |
| **권한**          | `lib/auth/permissions.ts` — 역할별 라우트 화이트리스트                                                                                                                                                                                                                                                                                                                               |
| **API 토큰**      | `/api/revalidate*`은 `x-revalidate-secret` 헤더 검증 + SSRF·쿠키 가드                                                                                                                                                                                                                                                                                                                |
| **DB**            | RLS 활성화 (Supabase 호스팅). `service_role`은 server 전용 (`lib/supabase/admin.ts`)                                                                                                                                                                                                                                                                                                 |
| **사외비 테이블** | `pnl_entries`, `pnl_cost_structure`, `pnl_fixed_variable`, `pnl_plan`, `inventory_entries`, `personnel_entries`, `finance_entries`, `loan_entries`, `management_uploads`, `org_charts`, `chat_audit_log`, `longterm_revenue_plan` — RLS 정책 없음 → anon 차단. `confidentialDb.from(...)` 전용 (20260523~20260715). `management-excel`·`org-charts` 버킷도 service_role 전용(비공개) |
| **AI 외부 전송**  | 챗봇은 Anthropic API로 데이터 전송 → 사외비(손익)는 도구·system-prompt에서 완전 제외. 입력창에 외부 전송 경고 배너. 모든 도구 호출 `chat_audit_log` 기록                                                                                                                                                                                                                             |
| **Secrets**       | `.env.local`, `scripts/.env`, GitHub Actions Secrets. **코드 커밋 금지**                                                                                                                                                                                                                                                                                                             |
| **외부 입력**     | Zod 검증 (`lib/reports/dto/`)                                                                                                                                                                                                                                                                                                                                                        |
| **SQL**           | postgrest 파라미터 바인딩만 (문자열 결합 금지)                                                                                                                                                                                                                                                                                                                                       |

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
