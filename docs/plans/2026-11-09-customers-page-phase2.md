# 고객사 페이지 2단계 구현 계획 (2026-11-09 · 공개 판)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/customers` 화면에 회사 공식 문서(EDGAR·DART·IR)에서 뽑은 **자료실 · 가이던스(+변경 이력) · 회사 발표 물량 · 회사 발표 실적(조정 지표 포함) · 다음 실적 일정**을 더한다. 화면에는 원문 대조를 통과한(`verified=true`) 값만 나간다.

**Architecture:** 문서 «목록»(`collect_customer_docs.py` · EDGAR·DART·IR)과 문서 «내용»(`collect_customer_numbers.py` · 회사별 파서 모듈)을 가른다. 숫자는 **코드 우선** — 회사별 규칙 파서(`scripts/customer_parsers/<회사>.py`)가 뽑고, 코드로 못 뽑는 칸만 Sonnet(`scripts/lib/llm_guidance.py`)이 뽑는다. 어느 쪽이든 `scripts/lib/quote_check.py`(인용·숫자 대조)를 통과해야 `verified=true`. 가이던스 방향(상향·하향)은 LLM 이 아니라 코드(`scripts/lib/guidance_direction.py`)가 직전 값과 비교해 정한다. 새 표 6개는 전부 사외비(RLS on · 정책 없음).

**Tech Stack:** Python 3.13(requests·BeautifulSoup·pymupdf·Playwright·anthropic) · GitHub Actions(평일 1회) · Next.js 16.2.4(`'use cache'`·`cacheLife('days')`) · Supabase(`confidentialDb`) · vitest · pytest

설계 정본 = [`2026-11-09-customers-page.md`](./2026-11-09-customers-page.md) · 1단계 = [`-phase1.md`](./2026-11-09-customers-page-phase1.md) · 결정 = [`_결정이행.md`](./2026-11-09-customers-page_결정이행.md) · 지시 원문 = [`_최초지시.md`](./2026-11-09-customers-page_최초지시.md)(선택 5차·6차·7차 포함) · 조사 노트 = `참고/고객사/research/{korea,germany,us_domestic,foreign_filers,repo_assets}.md`(gitignore · 출처 URL·실측 원문은 거기)

이 계획의 파서·대조기 코드는 **2026-11-09 실물 문서 24건(DART 13 · EDGAR 8 · IR 3)으로 돌려 본 시제품**이다 — 자가 시험 10종 전부 통과 · 실물 105행 중 대조기 실패 0(억원 배수를 보탠 뒤). 시제품에 없는 부분(목록 수집기·IR 어댑터·LLM·화면)은 «착수 시 실측»으로 표시했다.

## Global Constraints

- 🔴 **이 레포는 공개다.** OEM 이름은 코드·계획서에 써도 된다(선택 5차). 그러나 **손익 고객명(`pnl_customers` 값)·매출 비중·공급 품목·「○○는 우리 고객」 류 문장은 코드·주석·시험 데이터·커밋 메시지에 쓰지 않는다**(사외비 표 `customer_accounts` 에만). 시험 데이터의 사외비 쪽은 가짜 이름(`가나자동차`·`Acme Motors`·`다라그룹`).
- 커밋 전 `git diff --cached` 에 손익 고객명이 없는지 grep(목록은 `참고/고객사/` 원본에서 읽는다) — 1단계와 같은 절차.
- ⚠️ 손익 고객명 중 2개는 **OEM 이름·공시 원문 라벨과 글자가 같다**(2026-11-09 실측 · 목록은 원본에서). 포르쉐 파서의 원문 라벨 `Porsche`(`Porsche AG Group`)는 **사외비 grep 예외**(사용자 승인 2026-11-09). 다른 하나는 계획서·코드에서 약칭(KGM)을 쓴다.
- 🔴 **코드 우선** — 규칙 파서가 뽑을 수 있는 칸에 LLM 을 쓰지 않는다. LLM 은 아래 「회사별 코드/AI 표」의 `llm` 칸만. 모델 상수는 한곳(`scripts/lib/llm_guidance.py` 의 `MODEL = os.environ.get('CUSTOMER_GUIDANCE_MODEL', 'claude-sonnet-5-5')`).
- 🔴 **화면에는 `verified=true` 만** — 코드 행도 LLM 행도 `quote_check.check_row` 를 지나야 참. 검사기·파서마다 `MUST_HIT`·`MUST_MISS` 자가 시험을 본 실행 «전에» 돌리고 어긋나면 exit 2.
- 🔴 **「새 문서인데 숫자 0개」 = exit 1**(파싱 실패). 단 「대상 아님」(`recognized=False` → `not_target`)·「숫자를 내지 않는 문서」(`no_numbers_expected`)는 실패가 아니다. 상태는 `customer_documents.parse_status` 와 `customer_collect_status` 에 남긴다.
- 🔴 **「확인 실패」(봇 차단 403 등)는 조용히 넘기지 않는다** — `customer_collect_status.status='blocked'` + 사유 문장 → 화면에 「GM IR 사이트 접근 차단(…)으로 미국 소매 판매 미수집」처럼 사유를 보인다.
- 사외비: 새 표 6개 전부 RLS enable + 정책 없음 · `lib/supabase/confidential.ts` `CONFIDENTIAL_TABLES` 에 추가 · 조회는 `confidentialDb.from(...)` 만.
- 캐시 태그 세 곳 함께(`cacheTag` · `app/api/revalidate/route.ts` `ALL_TAGS` · `scripts/lib/revalidate.py` `COLUMN_TO_TAGS`) · `cacheLife('days')` · `cacheTag('exchange_rates_live')` 금지(ISR Write).
- 수집기는 `lib.bootstrap.init_script(__file__)` · 쓰기는 `WriteSession` 블록 안 `db.upsert_rows` · 재시도는 `lib.retry.with_retry`(4xx 즉시 raise) · 키(`DART_API_KEY`·`ANTHROPIC_API_KEY`)를 stdout·예외 문자열에 넣지 않는다.
- EDGAR: UA = env `SEC_USER_AGENT`(기본 `'stock-monitor research contact@example.com'`) · 요청 간 0.15초 · `scripts/lib/edgar.py` 한곳.
- DART: OpenAPI(`list.json`·`document.xml`)만. 웹 뷰어 첨부는 쓰지 않는다(GHA 접근 미확인 — 「미확인」 표).
- PDF 는 저장하지 않는다(링크 + `sha256`). 중복 판정 = `(source, source_id)` 유일 + `sha256`.
- 기존 표·수집기는 건드리지 않는다: `financials`(yfinance) · `hyundai_sales`·`kia_sales`·`kg_mobility_sales` · `stellantis_*`. 회사 발표 실적은 새 표에만.
- 연도는 `currentYear()`(TS) · 파이썬은 문서에서 읽은 연도(문서 밖 연도 하드코딩 금지).
- 마이그레이션 `YYYYMMDD000NNN_*.sql`(착수 시 `ls supabase/migrations | tail -1` — 작성 시점 최신 `20261109000003`, 다음 `20261109000004`) · 새 수집 표는 `trg_skip_identical_update` 부착.
- 차트·화면은 [`docs/chart-guide.md`](../chart-guide.md) + 아래 「재사용 짝짓기」 표 — 새 차트를 만들지 않는다.
- 검증 명령: `npm run check-all` · `scripts/venv/Scripts/python.exe scripts/verify_revalidate_tags.py` · `scripts/venv/Scripts/python.exe scripts/verify_call_contracts.py` · Python 시험 `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib -q`(Bash 에서는 앞의 환경변수 필수).
- 파일 UTF-8(BOM 없음)+LF · 커밋은 경로 명시(`git add -A` 금지) · `npm` · 푸시는 사용자 요청 시에만 · 서브에이전트 `model` 칸 비움.

- 🔴 **`.githooks/pre-commit`**: `scripts/lib/*` · `.github/workflows/*` · 마이그레이션을 «새로 추가»하는 커밋은 `AGENTS.md` 또는 `Architecture.md` 가 같이 스테이지돼야 통과한다(`ADDED_PATTERN`). 그래서 새 `scripts/lib` 모듈을 만드는 태스크(2·3·4·5·6·11)는 **그 커밋에** `Architecture.md` 부록 C 「scripts/lib 모듈 목록」 한 줄씩을 함께 넣는다(Task 15 로 미루지 않는다).
- 🔴 Next.js 16 제약: 서버 컴포넌트가 `'use client'` 파일의 «함수»를 값으로 import 해 부르지 않는다(컴포넌트 렌더만 가능) — 공용 계산은 `lib/customers/*.ts`(지시어 없는 순수 모듈)에 둔다.

## 회사별 코드/AI 표 (이 계획의 기준표)

| 회사       | 문서 목록 출처                                   | 가이던스                                             | 물량                                                 | 회사 발표 실적(장부상 / 조정)                                      | 실적 일정                |
| ---------- | ------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ | ------------------------ |
| GM         | EDGAR 8-K(2.02·7.01) · IR(Akamai 403 → GHA 시험) | code(EX-99.1 전망 표)                                | code 도매(wholesale) 분기·누계·지역 2                | code / code(EBIT-adjusted·EPS-diluted-adjusted)                    | 확인 실패 시 추정        |
| 리비안     | EDGAR 8-K                                        | code(전망 표 + 인도 보도자료 문장)                   | code 생산·인도 분기·연간                             | code / code(Adjusted EBITDA)                                       | code(인도 보도자료 문장) |
| 폴라리스   | EDGAR 8-K · IR Q4 JSON                           | code(BUSINESS OUTLOOK) + llm(컨퍼런스 발표자료)      | 없음(대수 미공표)                                    | code / code(Adjusted sales·Adjusted EPS)                           | code(IR Event JSON)      |
| 빈패스트   | EDGAR 6-K                                        | llm                                                  | code **자동차만**(분기·누계·베트남 월) · 이륜차 제외 | code 매출만 / 없음                                                 | 미확인                   |
| 스텔란티스 | EDGAR 6-K · IR(Playwright)                       | code(가이던스 상자 3항목 문구) + llm(보조·최초 발표) | code 연결 출하 분기·누계 + 북미(기존 IR 수집기)      | code / code(AOI) · 2025 분기 이익 = 소급 팩트시트 PDF(일회성 백필) | code(예고 6-K 문장)      |
| 폭스바겐   | IR RSS·financial-results·ad-hoc·ICS(HTTP)        | code(Outlook 문장) + llm(문장꼴 바뀌면)              | code 인도(대)·판매·생산(천 대)                       | code / code(특수항목 전 영업이익, 누계)                            | code(ICS)                |
| 포르쉐     | EQS JSON(HTTP)                                   | code(9M 문장) + llm(3월 연간)                        | code 인도 누계(분기는 차이) · 생산 미확인            | code(누계) / 없음                                                  | 미공표 → 추정            |
| 현대차     | DART(I002·I003) · IR JSON                        | code(전망 공시·[기재정정]) + llm(중장기·FCF PDF)     | code 월 판매(국내·해외·계)                           | code 잠정(대조용) / 없음                                           | code(IR 개최 공시)       |
| 기아       | DART · IR API                                    | code(전망 판매대수·사업계획) + llm(중장기)           | code 월 판매(내수·해외·특수·계)                      | code 잠정(대조용) / 없음                                           | code(IR 개최 공시)       |
| 현대모비스 | DART · IR HTML                                   | llm(수주 목표·중장기)                                | 없음(공표 없음)                                      | code 잠정(대조용) / 없음                                           | code(IR 개최 공시)       |
| KGM        | DART · IR JSON                                   | llm(CEO IR 발표자료)                                 | code 월 판매(내수·수출·CKD·총계)                     | code 잠정 «별도»(대조용) / 없음                                    | 부분(IR 개최 공시)       |

#### 상세

- **문서 목록은 OEM 전체**(선택 5차) — `companies.company_type='OEM'` 이면서 `sec_cik` 또는 `dart_corp_code` 가 있는 회사 전부 + 파서 모듈의 `TICKERS`(부품사인 현대모비스 포함). 파서가 없는 OEM 은 목록만 쌓이고 `parse_status='not_target'`.
- **빈패스트는 자동차만**(사용자 지시 2026-11-09): 전기 이륜차(e-scooter·e-bike) 수치는 수집·표시하지 않는다. 파서는 `electric vehicles ("EVs")`·`EV Deliveries` 라벨만 잡고, 이륜차 문장·표 행은 `MUST_MISS` 로 못 박는다(Task 9). LLM 가이던스 프롬프트에도 「이륜차 목표는 뽑지 말 것」(Task 11 — 해석: 물량 지시를 가이던스에도 적용 · 판정 요청 목록 참조).
- **실적 화면 규칙**(선택 7차 — 6차의 「빈 분기만 채움」을 바꿨다): 해외 7곳의 매출·영업이익·순이익 화면 값 = **회사 공시 우선**. 영업이익 = 회사 장부상(`customer_reported_results` `basis='reported'`) → 없으면 회사 조정 영업이익(`ebit_adjusted`·`aoi`·`operating_result_bsi` 순 · 각주 「회사 발표 조정 영업이익(<회사 이름>) — 장부상 미발표」) → 회사가 그 분기 이익을 어디에도 안 냈을 때만 `financials`(yfinance) + 각주(「회사 미발표 · 시장 데이터 추정 · 회사 발표 반기 값 …」) → 그것도 없으면 「미발표」. 매출·순이익은 회사 장부상 → yfinance → 「미발표」. 차트 영업이익률 선·요약 표 영업이익률도 고른 값으로 다시 잰다. 고르기는 «읽을 때» 순수 함수(`pickEarnings`, Task 13)가 하고 칸마다 출처를 `origin` 으로 내려 준다 — DB 의 yfinance 행은 지우지도 덮지도 않는다. 국내 4곳은 지금(fnguide·DART 장부상) 그대로 — `pickEarnings` 를 부르지 않는다. 실적 표에 「회사 발표 조정 지표」 줄은 그대로 덧붙인다. 조정 지표의 `metric` 키는 가이던스 `metric` 키와 같게 맞춘다(예 `ebit_adjusted`·`aoi`·`adjusted_ebitda`·`eps_adjusted`) — 가이던스 카드에서 실적과 나란히 보이게.
- **국내 4곳의 잠정실적**은 `financials` 에 빈칸이 없어 화면 채움에는 안 쓰고 «대조용»으로만 담는다(같은 파서 경로).

## 실측 근거 (2026-11-09)

| 항목                             | 실측                                                                                                                                                                                               | 계획에 반영                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| DART 월 판매 공시                | 현대·기아·KGM 25/25개월 · 1월 표 1개 · 표 머리가 회사마다 다름(`구분(단위:대,%)` · `구분 (단위:대,%) 당기실적 ('26.10월)` · `구분 (단위: 대, %) 당기실적 (2026년 10월)`)                           | 머리 정규식 1개 + 회사별 행 라벨 · 「부분 합 = 계」 검사         |
| DART 잠정실적 단위               | 현대·기아 연결 백만원 · KGM 별도 억원                                                                                                                                                              | 단위 환산 + `metric_name` 에 「(별도)」                          |
| 현대 전망 공시 정정              | 정정 문서에 정정 전·후 값이 함께(4,158,300 → 4,000,000)                                                                                                                                            | `정정사항` 뒤만 읽는다                                           |
| 해외 7곳 `financials` 빈 분기    | GM 3 · VW 3 · 폴라리스 2 · 리비안·빈패스트·스텔란티스·포르쉐 각 1                                                                                                                                  | 회사 공시 우선으로 고르면서 함께 채워진다(출처 표시)             |
| yfinance 영업이익 vs 회사 장부상 | 야후식 표준화 값이라 다르다 — 스텔란티스 2024 장부상 3,687 vs yfinance 5,435(백만 유로 · SEC XBRL `ProfitLossFromOperatingActivities`) · 매출은 일치                                               | 선택 7차: 이익은 회사 공시 우선(`pickEarnings`)                  |
| 스텔란티스 2025 Q1·Q3 이익       | 당일 보도자료·발표자료·콜 녹취·팩트시트엔 없음 · 2026-02 연간 발표 때 낸 소급 PDF 3쪽(IFRS)·4쪽(조정)에 분기별 값 · Q1+Q2 = 상반기 발표값 검산 일치 · stellantis.com 은 브라우저로 내려받기만 통과 | Task 9 Step 3b 일회성 백필(로컬 파일 입력)                       |
| GM 도매 합계                     | GMNA 870 + GMI 159 = 1,029 ≠ Total 1,028(반올림)                                                                                                                                                   | 합계 검사 허용오차 ±1천 대 · 정의 상자에 적는다                  |
| VW 실적 표                       | 반기 판 퍼센트 칸이 독일식(`–6,3`) · 값 칸에 `–`                                                                                                                                                   | 숫자만 세지 않고 «칸 위치»로 읽는다                              |
| VW 인도                          | 실적 표는 천 대 반올림(1,885) · 인도 보도자료는 대(1,885,300)                                                                                                                                      | 인도는 인도 보도자료만                                           |
| VW 매출 전망                     | 반기 `−3~0%`(증감률) → 9개월 `around €315 billion`(금액)                                                                                                                                           | metric 이 바뀐다 → 방향 비교 안 함(`revenue_growth` ≠ `revenue`) |
| 리비안 인도 전망                 | 10-02 `65,000 - 70,000`(reaffirming) → 10-29 `67,000 – 70,000`                                                                                                                                     | 가운데값 비교 → raised                                           |
| GM 전망 표 머리                  | 1~3분기 `Updated 2026 guidance \| Previous …` · 4분기 `Final 2025 Guidance \| 2025 Results \| 2026 Guidance`                                                                                       | 머리 칸 정규식으로 열을 찾는다                                   |
| 스텔란티스 EDGAR 출하 보도자료   | 지역 표가 그림(jpg)                                                                                                                                                                                | 분기 «합계»는 실적 보도자료 표 · 북미는 기존 IR 수집기           |
| stellantis.com · investor.gm.com | 로컬 curl 403(Akamai) · 스텔란티스는 Playwright 200 · GM 은 Playwright 도 403                                                                                                                      | GM IR 은 GHA 러너 시험 단계 + 실패 시 사유 표시                  |

## File Structure

| 파일                                                                                                                   | 신규/수정    | 책임                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------- |
| `supabase/migrations/20261109000004_create_customer_ir_tables.sql`                                                     | 신규         | `companies.sec_cik` + 사외비 표 6개                                                   |
| `lib/database.types.ts` · `lib/supabase/confidential.ts`                                                               | 수정         | 타입 블록 · `CONFIDENTIAL_TABLES` 6줄                                                 |
| `app/api/revalidate/route.ts` · `scripts/lib/revalidate.py`                                                            | 수정         | 캐시 태그 6개                                                                         |
| `scripts/lib/doc_text.py` (+test)                                                                                      | 신규         | html·xml·pdf → 글·표 행(기존 `normalize_cell`·`html_to_table_rows` 이전)              |
| `scripts/lib/edgar.py` (+test)                                                                                         | 신규         | UA·재시도·간격 · 공시 목록 · 첨부 이름                                                |
| `scripts/lib/dart_api.py` (+test)                                                                                      | 신규         | `list.json` 페이지 넘김 · `document.xml` 글                                           |
| `scripts/collect_stellantis_shipments.py`                                                                              | 수정         | `_get` → `edgar.edgar_get` 위임 · 표 함수 re-export                                   |
| `scripts/backfill_filer_ids.py`                                                                                        | 신규(일회성) | `sec_cik`·`dart_corp_code` 채우기 → 끝나면 `_archive/`                                |
| `scripts/collect_customer_docs.py`                                                                                     | 신규         | 문서 목록(EDGAR·DART·IR) → `customer_documents`                                       |
| `scripts/lib/ir_lists.py` (+test)                                                                                      | 신규         | 회사별 IR 목록 어댑터(HTTP · GM 은 시험)                                              |
| `scripts/lib/quote_check.py` (+test)                                                                                   | 신규         | 인용·숫자 대조(agents 이식)                                                           |
| `scripts/lib/guidance_direction.py` (+test)                                                                            | 신규         | 방향 판정                                                                             |
| `scripts/customer_parsers/{__init__,base,common}.py`                                                                   | 신규         | 파서 규약·도우미                                                                      |
| `scripts/customer_parsers/{kr_dart,gm,rivian,polaris,vinfast,stellantis,vw,porsche}.py`                                | 신규         | 회사별 규칙 파서(각자 `self_test`)                                                    |
| `scripts/lib/test_customer_parsers.py`                                                                                 | 신규         | 파서 자가 시험을 pytest 로                                                            |
| `scripts/collect_stellantis_shipments_ir.py` (+test)                                                                   | 수정         | 행 라벨 인자화(`extract_row_thousands`) — 기존 동작 불변                              |
| `scripts/collect_customer_numbers.py`                                                                                  | 신규         | 오케스트레이터(자가 시험 → 내용 → 파서 → 대조 → 적재 → 방향)                          |
| `scripts/lib/llm_guidance.py` (+test)                                                                                  | 신규         | Sonnet 구조화 출력(엄격 스키마)                                                       |
| `.github/workflows/collect-customer-docs.yml`                                                                          | 신규         | 평일 1회 + 회사별 `workflow_dispatch`                                                 |
| `lib/customers/ir.ts` (+test)                                                                                          | 신규         | 순수 함수(누계→분기 · 최신 가이던스 · 다음 일정 · 실적 칸 출처 고르기 `pickEarnings`) |
| `lib/customers/source.ts` · `types.ts`                                                                                 | 수정         | `getCustomerIr(slug)` · 요약 표 열                                                    |
| `lib/customers/format.ts`                                                                                              | 수정         | 범위·금액 표시 함수 신규(`rangeText`·`amountText`)                                    |
| `lib/currentYear.ts`                                                                                                   | 수정         | `todaySeoul()` 신설(서울 날짜 한곳)                                                   |
| `components/oem-companies/common/CompanyTimeSeriesChart.tsx` · `CompanyTimeSeriesChartInner.tsx`                       | 수정         | 선택 인자 `secondary?`(기본값 = 지금 동작)                                            |
| `.prettierignore`                                                                                                      | 수정         | `scripts/lib/fixtures/` 한 줄                                                         |
| `components/customers/{CustomerGuidanceCards,CustomerDocumentList,CustomerVolumeCompare,CustomerEarningsSchedule}.tsx` | 신규         | 개별 화면 4절                                                                         |
| `components/customers/CustomerEarningsTable.tsx` · `CustomersOverviewTable.tsx`                                        | 수정         | 조정 지표 줄 · 출처 표시 · 「최근 가이던스 변경」 열                                  |
| `app/customers/page.tsx` · `app/customers/[slug]/page.tsx`                                                             | 수정         | 절 배치                                                                               |
| `Architecture.md` · `AGENTS.md` · `docs/gotchas-data-collection.md`                                                    | 수정         | 표·수집기·워크플로·함정                                                               |

## 재사용 짝짓기 (설계서 표 이어서 · 신규 칸만 만든다)

| 2단계 항목                                 | 기존 자산                                                                                                                         | 판정                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| EDGAR 요청·공시 목록                       | `collect_stellantis_shipments.py` `_get`·`discover_press_releases`·`COMMON_HEADERS`                                               | 선택 인자만 더해 재사용 — `lib/edgar.py` 로 옮기고 원 파일은 위임                                                  |
| 표 행 추출                                 | `collect_stellantis_shipments.py` `normalize_cell`·`html_to_table_rows`                                                           | 그대로 재사용 — `lib/doc_text.py` 로 이전 + re-export                                                              |
| 스텔란티스 IR 출하                         | `collect_stellantis_shipments_ir.py` `extract_north_america_thousands`                                                            | 선택 인자만 — `extract_row_thousands(rows, q, y, label)` + 기존 함수는 감싸기                                      |
| DART corp_code                             | `collect_dart_domestic.py:87 _resolve_corp_code`                                                                                  | 이번엔 불필요 — 대상 4곳 값이 조사 노트에 확정(`backfill_filer_ids.py` 고정 표)                                    |
| DART 재시도                                | `collect_dart_audit._with_retry` → 이미 `lib/retry.with_retry` 로 공용화                                                          | 그대로 재사용                                                                                                      |
| DART list.json 루프                        | `scripts/dart_eval/scan_all.py:73 fetch_list`                                                                                     | 베껴 공용화(`lib/dart_api.list_disclosures`)                                                                       |
| 자가 시험 exit 2                           | `scripts/lib/naver_market_cap.py:68 self_test`                                                                                    | 그대로 본뜬다                                                                                                      |
| 구조화 출력                                | `collect_oem_model_outlook.py:431-457 _evaluate`                                                                                  | 그대로 본뜬다(`output_config.format json_schema`)                                                                  |
| PDF 글                                     | `summarize_naver_research.py:138 pdf_text`                                                                                        | 본뜨되 예외를 삼키지 않는 판(`doc_text.pdf_text`)                                                                  |
| 인용·숫자 대조                             | agents `codex_guard.py`·`verify-essay-quotes.mjs`·`curatedQuality.ts`                                                             | 이식(`lib/quote_check.py`)                                                                                         |
| GHA                                        | `collect-stellantis-shipments-ir.yml` · `collect-hyundai-quarterly.yml`                                                           | 그대로 본뜬다                                                                                                      |
| 실적 표 · 콤보 차트                        | 1단계 `CustomerEarningsTable` · `HyundaiQuarterlyEarningsChart`                                                                   | 선택 인자만(조정 지표 줄 · 출처 각주) — 차트 신규 없음                                                             |
| 물량 나란히                                | `components/oem-companies/common/CompanyTimeSeriesChart.tsx`·`CompanyTimeSeriesChartInner.tsx`(props = `monthly·annual·title` 뿐) | 선택 인자만 더해 재사용 — 두 파일에 `secondary?`(두 번째 계열 · 기본값 = 지금 동작 그대로) · OEM 탭 화면 불변 확인 |
| 최근 동향 뉴스                             | `components/stock-popup/PopupNewsSection.tsx`                                                                                     | 그대로 재사용 + 문서 목록을 위에                                                                                   |
| 요약 표 행                                 | 1단계 `CustomersOverviewTable`(서버 컴포넌트 · 회사명 링크만)                                                                     | 그대로 — 행 강조 훅 넣지 않음(클라이언트 전환 시 사외비 칸이 RSC payload 로 샌다)                                  |
| 가이던스 카드 · 일정 상자 · 정의 차이 상자 | 없음                                                                                                                              | 신규(이 3개만)                                                                                                     |

---

### Task 1: 사외비 표 6개 + `companies.sec_cik` + 캐시 태그

**Files:**

- Create: `supabase/migrations/20261109000004_create_customer_ir_tables.sql`
- Modify: `lib/database.types.ts` · `lib/supabase/confidential.ts` · `app/api/revalidate/route.ts` · `scripts/lib/revalidate.py` · `Architecture.md` §7-G·§7-J

**Interfaces:**

- Produces: `customer_documents` · `customer_guidance` · `customer_volume_ir` · `customer_reported_results` · `customer_earnings_dates` · `customer_collect_status` · `companies.sec_cik` · 캐시 태그 6개(표 이름과 같음)

- [ ] **Step 1: 번호 확인** — Run: `ls supabase/migrations | tail -1` · Expected: `20261109000003_create_customer_accounts.sql` → 새 파일 `…000004`. 더 올라가 있으면 그 다음 번호.

- [ ] **Step 2: 마이그레이션 작성**

```sql
-- 고객사 페이지 2단계 — 회사 공식 문서(EDGAR·DART·IR)와 거기서 뽑은 숫자. 전부 사외비(RLS on · 정책 없음).
-- 설계 = docs/plans/2026-11-09-customers-page.md · 계획 = …-phase2.md Task 1.

alter table public.companies add column if not exists sec_cik text
  check (sec_cik is null or sec_cik ~ '^[0-9]{1,10}$');
create unique index if not exists companies_sec_cik_key on public.companies (sec_cik) where sec_cik is not null;
comment on column public.companies.sec_cik is 'SEC EDGAR CIK(앞 0 없이). 고객사 문서 목록 수집 대상 판정.';

create table public.customer_documents (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  source text not null check (source in ('edgar', 'dart', 'ir')),
  -- 출처 고유 ID: EDGAR accession · DART 접수번호 · IR 은 어댑터가 정한 안정 키(URL 경로 등)
  source_id text not null,
  doc_type text not null check (doc_type in (
    'earnings_release', 'presentation', 'shareholder_letter', 'periodic', 'current_report', 'prelim_results',
    'sales_release', 'guidance', 'ir_event', 'fact_sheet', 'investor_day', 'other')),
  form text,
  items text,
  title text not null,
  url text not null,
  published_at date not null,
  sha256 text,
  parse_status text not null default 'pending'
    check (parse_status in ('pending', 'parsed', 'not_target', 'no_numbers_expected', 'failed')),
  parse_note text,
  first_seen_at timestamptz not null default now(),
  unique (source, source_id)
);
create index customer_documents_company_pub_idx on public.customer_documents (company_id, published_at desc);
create index customer_documents_pending_idx on public.customer_documents (company_id) where parse_status = 'pending';

create table public.customer_guidance (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  document_id bigint not null references public.customer_documents (id) on delete cascade,
  metric text not null,               -- 코드 키(ebit_adjusted·deliveries·revenue_growth …) — 실적 metric 과 같은 키
  metric_label text not null,         -- 회사가 쓴 이름 그대로
  period text not null check (period ~ '^FY[0-9]{4}$'),
  low numeric,
  high numeric,
  value_text text,                    -- 숫자 아닌 전망('Low-Single Digit %') — low·high 는 null
  unit text not null,                 -- billion·million·per_share·percent·units·text
  basis text check (basis is null or basis in ('reported', 'adjusted')),
  quote text not null,
  stated text check (stated is null or stated in ('raised', 'maintained', 'lowered', 'withdrawn')),
  direction text check (direction is null or direction in ('raised', 'maintained', 'lowered', 'initiated', 'withdrawn')),
  extractor text not null check (extractor in ('code', 'llm')),
  verified boolean not null default false,
  verify_note text,
  published_at date not null,
  unique (document_id, metric, period),
  check (low is not null or high is not null or value_text is not null)
);
create index customer_guidance_company_idx on public.customer_guidance (company_id, metric, period, published_at);

create table public.customer_volume_ir (
  company_id uuid not null references public.companies (id) on delete cascade,
  metric text not null check (metric in ('shipments', 'deliveries', 'production', 'wholesale', 'sales')),
  region text not null default 'total',
  period_grain text not null check (period_grain in ('month', 'quarter', 'ytd', 'year')),
  period text not null,               -- 2026-10 · 2026-Q3 · 2026-9M · 2026
  value bigint not null,
  definition text not null,
  quote text not null,
  document_id bigint references public.customer_documents (id) on delete set null,
  source text not null,               -- 'dart' · 'edgar' · 'ir'
  source_ref text,                    -- 접수번호 · accession · IR 키
  published_at date not null,
  verified boolean not null default false,
  primary key (company_id, metric, region, period_grain, period)
);

create table public.customer_reported_results (
  company_id uuid not null references public.companies (id) on delete cascade,
  period_grain text not null check (period_grain in ('quarter', 'ytd', 'year')),
  period text not null,
  metric text not null,
  metric_name text not null,          -- 회사가 쓴 이름 그대로(EBIT-adjusted · Adjusted operating income/(loss) …)
  basis text not null check (basis in ('reported', 'adjusted')),
  value numeric not null,
  unit text not null check (unit in ('million', 'billion', 'per_share')),
  currency text not null,
  quote text not null,
  document_id bigint references public.customer_documents (id) on delete set null,
  source text not null,
  source_ref text,
  published_at date not null,
  verified boolean not null default false,
  primary key (company_id, period_grain, period, metric)
);

create table public.customer_earnings_dates (
  company_id uuid not null references public.companies (id) on delete cascade,
  period text not null,               -- 발표 대상 2026-Q3 · 2026-FY
  event_date date not null,
  quote text not null,
  source text not null,
  source_ref text,
  url text,
  published_at date not null,
  primary key (company_id, period)
);

create table public.customer_collect_status (
  company_id uuid not null references public.companies (id) on delete cascade,
  collector text not null,            -- 'edgar_list' · 'dart_list' · 'ir_list' · 'parse' · 'llm'
  status text not null check (status in ('ok', 'no_new', 'blocked', 'parse_failed', 'error')),
  reason text,                        -- 화면에 그대로 나가는 사유 한 문장(키·내부 경로 금지)
  checked_at timestamptz not null default now(),
  primary key (company_id, collector)
);

alter table public.customer_documents enable row level security;
alter table public.customer_guidance enable row level security;
alter table public.customer_volume_ir enable row level security;
alter table public.customer_reported_results enable row level security;
alter table public.customer_earnings_dates enable row level security;
alter table public.customer_collect_status enable row level security;

-- 동일 값 upsert 는 0행(Architecture §7-J). collect_status 는 checked_at 이 매번 바뀌어 붙이지 않는다.
create trigger trg_skip_identical_update before update on public.customer_documents
  for each row execute function public.skip_identical_update();
create trigger trg_skip_identical_update before update on public.customer_volume_ir
  for each row execute function public.skip_identical_update();
create trigger trg_skip_identical_update before update on public.customer_reported_results
  for each row execute function public.skip_identical_update();
create trigger trg_skip_identical_update before update on public.customer_earnings_dates
  for each row execute function public.skip_identical_update();
create trigger trg_skip_identical_update before update on public.customer_guidance
  for each row execute function public.skip_identical_update();
```

착수 시 `20260803000002_skip_identical_updates.sql` 의 함수 이름·트리거 이름을 열어 위 두 이름이 같은지 본다(다르면 그쪽에 맞춘다).

- [ ] **Step 3: 적용·확인** — Supabase MCP `apply_migration`(name=`create_customer_ir_tables`). 그다음:

```sql
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policies p where p.tablename = c.relname) as policies
from pg_class c where c.relname like 'customer\_%' and c.relkind = 'r' order by 1;
```

Expected: 7행(1단계 `customer_accounts` 포함) 전부 `relrowsecurity=true`, `policies=0`.

- [ ] **Step 4: 타입** — MCP `generate_typescript_types` 에서 **새 표 6개 블록 + `companies.sec_cik` 줄만** 붙인다. 🔴 파일 전체를 덮지 않는다(`docs/gotchas-ci-deploy.md` §7).

- [ ] **Step 5: 사외비 명단·캐시 태그 세 곳** — `CONFIDENTIAL_TABLES` 끝(`'customer_accounts',` 다음)에 6개, `ALL_TAGS` 의 `'customer_accounts',` 다음에 6개, `COLUMN_TO_TAGS` 의 `'customer_accounts': [...]` 다음에 `'<표>': ['<표>'],` 6줄. 표 이름 = 태그 이름.

- [ ] **Step 6: 검사** — Run: `npm run typecheck` → PASS. `verify_revalidate_tags.py` 는 `cacheTag` 리터럴이 Task 13 에서 생기므로 위반 내용을 적어 두고 Task 13 끝에서 0 인지 본다.

- [ ] **Step 7: Architecture.md** — §7-G 사외비 표 목록에 6줄(한 줄 요약) · §7-J skip 트리거 적용 목록에 5개 · `companies` 표 칸에 `sec_cik`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261109000004_create_customer_ir_tables.sql lib/database.types.ts lib/supabase/confidential.ts app/api/revalidate/route.ts scripts/lib/revalidate.py Architecture.md
git diff --cached --stat
git commit -m "feat(고객사): 2단계 사외비 표 6개 + companies.sec_cik + 캐시 태그"
```

---

### Task 2: 공용 헬퍼 3종(기존 코드 이전) + 식별자 채우기

**Files:**

- Create: `scripts/lib/doc_text.py` · `scripts/lib/edgar.py` · `scripts/lib/dart_api.py` · `scripts/lib/test_doc_text.py` · `scripts/lib/test_edgar.py` · `scripts/lib/test_dart_api.py` · `scripts/backfill_filer_ids.py`
- Modify: `scripts/collect_stellantis_shipments.py`(표 함수·`_get` 위임 — 호출부 그대로)

**Interfaces:**

- Produces: `doc_text.{normalize_cell, norm_text, html_to_text, html_to_table_rows, xml_to_text, pdf_text, row_text}` · `edgar.{user_agent, headers, edgar_get, Filing, parse_recent, fetch_filings, filing_htm_names}` · `dart_api.{list_disclosures, document_text}`
- Consumes: `lib.retry.with_retry`

- [ ] **Step 1: `scripts/lib/doc_text.py`** — `normalize_cell`·`html_to_table_rows` 는 `collect_stellantis_shipments.py` 본문을 «그대로» 옮긴다(아래 시제품의 두 함수가 그 사본).

```python
# scripts/lib/doc_text.py
"""공시·보도자료 원문 → 파서가 읽는 텍스트·표 행.

고객사 수집기(collect_customer_*)와 스텔란티스 출하 수집기가 같이 쓴다.
`normalize_cell`·`html_to_table_rows` 는 collect_stellantis_shipments.py 에서 그대로 옮겼다
(그쪽은 같은 이름으로 다시 내보내 기존 호출부·시험이 그대로 돈다).
"""
import html as _html
import re

from bs4 import BeautifulSoup

# 각종 대시(‐ ‑ ‒ – — ― −) → '-' · 굽은 따옴표 → 곧은 따옴표. 회차마다 섞여 나와(리비안 `-`·`–`) 파서 정규식을 하나로 쓰려고 맞춘다.
_DASHES = dict.fromkeys(map(ord, '‐‑‒–—―−'), '-')
_QUOTES = {0x201C: '"', 0x201D: '"', 0x2018: "'", 0x2019: "'"}


def normalize_cell(text: str | None) -> str:
  """표 셀 텍스트 정규화 — nbsp 제거 + 트림."""
  if text is None:
    return ''
  return text.replace('\xa0', ' ').strip()


def norm_text(s: str) -> str:
  """nbsp·대시·굽은 따옴표를 하나로 맞추고 공백을 한 칸으로."""
  s = s.replace('\xa0', ' ').translate(_DASHES).translate(_QUOTES)
  return re.sub(r'\s+', ' ', s).strip()


def html_to_text(html: str) -> str:
  """HTML 본문 → 한 줄 텍스트(script·style 제외)."""
  soup = BeautifulSoup(html, 'html.parser')
  for tag in soup(['script', 'style']):
    tag.decompose()
  return norm_text(soup.get_text(' '))


def html_to_table_rows(html: str) -> list[list[list[str]]]:
  """HTML → 표별 정규화 행 매트릭스 (빈 셀 제거)."""
  soup = BeautifulSoup(html, 'html.parser')
  tables: list[list[list[str]]] = []
  for table in soup.find_all('table'):
    rows: list[list[str]] = []
    for tr in table.find_all('tr'):
      cells = [normalize_cell(c.get_text(' ')) for c in tr.find_all(['td', 'th'])]
      cells = [c for c in cells if c != '']
      if cells:
        rows.append(cells)
    if rows:
      tables.append(rows)
  return tables


def xml_to_text(xml: str) -> str:
  """DART document.xml → 태그를 지우고 공백을 한 칸으로(실측 파일 korea.md 의 표본과 같은 꼴)."""
  return norm_text(_html.unescape(re.sub(r'<[^>]+>', ' ', xml)))


def pdf_text(pdf_bytes: bytes) -> str:
  """PDF → 쪽을 줄바꿈으로 이은 텍스트.

  summarize_naver_research.pdf_text 와 같은 pymupdf 호출이지만 그쪽은 실패를 빈 문자열로 삼킨다.
  여기서는 예외를 그대로 올린다 — 빈 문자열이 「숫자 0개」로 이어져 형식 변경과 구분이 안 된다.
  """
  import fitz  # pymupdf — requirements.txt 에 이미 있다

  with fitz.open(stream=pdf_bytes, filetype='pdf') as doc:
    return '\n'.join(page.get_text() for page in doc)


def row_text(row: list[str]) -> str:
  """표 행 → 인용 칸에 넣을 한 줄(셀 사이 ' | ')."""
  return ' | '.join(norm_text(c) for c in row)
```

- [ ] **Step 2: 원 파일은 re-export** — `collect_stellantis_shipments.py` 에서 두 함수 정의를 지우고 `from lib.doc_text import normalize_cell, html_to_table_rows  # noqa: F401 — 기존 호출부·시험 호환` 한 줄. `_get(session, url)` 본문은 `return edgar.edgar_get(session, url)` 로 바꾸고 `USER_AGENT`·`COMMON_HEADERS` 는 `edgar.user_agent()`·`edgar.headers()` 를 쓰게 한다(기존 RuntimeError 대신 `requests.HTTPError` 가 난다 — 호출부가 예외 종류로 가르는지 `grep -n "RuntimeError" scripts/collect_stellantis_shipments*.py` 로 먼저 본다). 🔴 이전·위임 뒤 그 파일에 남는 고아(`from bs4 import BeautifulSoup` · `import time` · `USER_AGENT` · `COMMON_HEADERS` · `REQUEST_TIMEOUT_S` · `REQUEST_SLEEP_S`)는 **레포 전체 grep** 으로 다른 사용처가 없음을 확인하고 지운다(내 변경이 만든 고아).

- [ ] **Step 3: `scripts/lib/edgar.py`**

```python
"""SEC EDGAR 공용 — UA·재시도·요청 간격을 한곳에 둔다(SEC 공정 접근 규칙: UA 에 연락처 · 초당 10건 이하).

UA 는 env SEC_USER_AGENT(GHA Secret 권장) · 없으면 기본값. 기본값의 연락처는 자리표시자다(미확인 목록 참조).
"""
import os
import re
import time
from dataclasses import dataclass

import requests

from lib.retry import with_retry

DEFAULT_UA = 'stock-monitor research contact@example.com'
SLEEP_S = 0.15
TIMEOUT_S = 30
_HTM_SKIP = re.compile(r'^R\d+\.htm$|-index', re.I)


def user_agent() -> str:
  return os.environ.get('SEC_USER_AGENT') or DEFAULT_UA


def headers() -> dict:
  return {'User-Agent': user_agent(), 'Accept-Encoding': 'gzip, deflate'}


def edgar_get(session: requests.Session, url: str) -> requests.Response:
  def _once():
    r = session.get(url, headers=headers(), timeout=TIMEOUT_S)
    r.raise_for_status()
    return r
  try:
    return with_retry(_once, _label=url)
  finally:
    time.sleep(SLEEP_S)


@dataclass(frozen=True)
class Filing:
  accession: str
  filing_date: str
  report_date: str
  form: str
  items: str
  primary_doc: str
  primary_desc: str

  def base_url(self, cik: str) -> str:
    return f'https://www.sec.gov/Archives/edgar/data/{int(cik)}/{self.accession.replace("-", "")}'


def parse_recent(sub: dict) -> list[Filing]:
  rec = sub['filings']['recent']
  keys = ('accessionNumber', 'filingDate', 'reportDate', 'form', 'items', 'primaryDocument', 'primaryDocDescription')
  return [Filing(*(rec[k][i] or '' for k in keys)) for i in range(len(rec['accessionNumber']))]


def fetch_filings(session, cik: str, forms: tuple[str, ...], since: str) -> list[Filing]:
  """최근 공시(submissions recent ≈ 1,000건) 중 forms·since 이후만. 2년 백필이면 recent 로 충분하다(실측: GM 2년 ≈ 120건)."""
  r = edgar_get(session, f'https://data.sec.gov/submissions/CIK{int(cik):010d}.json')
  return [f for f in parse_recent(r.json()) if f.form in forms and f.filing_date >= since]


def filing_htm_names(index_json: dict, primary: str) -> list[str]:
  """공시 폴더 index.json → 본문 먼저, 나머지 htm(EX-99.x)을 이름순. XBRL 조각(R1.htm)·색인은 뺀다."""
  names = [it['name'] for it in index_json['directory']['item']
           if it['name'].lower().endswith('.htm') and not _HTM_SKIP.search(it['name'])]
  return [primary] + sorted(n for n in names if n != primary)
```

- [ ] **Step 4: `scripts/lib/test_edgar.py`** — 고정 픽스처(네트워크 없음):

```python
import unittest

from lib import edgar


class EdgarTest(unittest.TestCase):
  def test_parse_recent(self):
    sub = {'filings': {'recent': {
      'accessionNumber': ['0001467858-26-000056'], 'filingDate': ['2026-10-20'], 'reportDate': ['2026-10-20'],
      'form': ['8-K'], 'items': ['2.02,9.01'], 'primaryDocument': ['gm-20261020.htm'],
      'primaryDocDescription': ['8-K']}}}
    f = edgar.parse_recent(sub)[0]
    self.assertEqual((f.form, f.items), ('8-K', '2.02,9.01'))
    self.assertEqual(f.base_url('1467858'), 'https://www.sec.gov/Archives/edgar/data/1467858/000146785826000056')

  def test_htm_names(self):
    idx = {'directory': {'item': [{'name': 'gm-20261020.htm'}, {'name': 'R1.htm'}, {'name': 'gmq32026pressreleaseandfin.htm'},
                                  {'name': '0001467858-26-000056-index.htm'}, {'name': 'logo.jpg'}]}}
    self.assertEqual(edgar.filing_htm_names(idx, 'gm-20261020.htm'),
                     ['gm-20261020.htm', 'gmq32026pressreleaseandfin.htm'])

  def test_default_ua(self):
    self.assertIn('@', edgar.user_agent())
```

- [ ] **Step 5: `scripts/lib/dart_api.py`**

```python
"""DART OpenAPI 공용 — list.json 페이지 넘김 · document.xml 본문 글. 웹 뷰어(dart.fss.or.kr)는 쓰지 않는다.

키(DART_API_KEY)는 요청 인자에만 — 예외·로그 문자열에 URL 을 그대로 넣지 않는다(쿼리에 키가 있다).
본보기 = scripts/dart_eval/scan_all.py:73 fetch_list.
"""
import io
import os
import time
import zipfile

import requests

from lib.doc_text import xml_to_text
from lib.retry import with_retry

LIST_URL = 'https://opendart.fss.or.kr/api/list.json'
DOC_URL = 'https://opendart.fss.or.kr/api/document.xml'
GAP_S = 0.25


def _key() -> str:
  return os.environ['DART_API_KEY']


def list_disclosures(session, corp_code: str, bgn_de: str, end_de: str, detail_ty: str) -> list[dict]:
  """bgn_de·end_de = YYYYMMDD. status 013(조회 결과 없음)은 빈 목록. 그 밖의 비정상 status 는 RuntimeError(키 없는 문장)."""
  out, page = [], 1
  while True:
    def _once():
      r = session.get(LIST_URL, params={'crtfc_key': _key(), 'corp_code': corp_code, 'bgn_de': bgn_de,
                                        'end_de': end_de, 'pblntf_detail_ty': detail_ty, 'page_no': page,
                                        'page_count': 100}, timeout=30)
      r.raise_for_status()
      return r.json()
    j = with_retry(_once, _label=f'dart list {corp_code} {detail_ty} p{page}')
    status = j.get('status')
    if status == '013':
      return out
    if status != '000':
      raise RuntimeError(f'DART list status={status} corp={corp_code} ty={detail_ty}')
    out += j.get('list', [])
    if page >= int(j.get('total_page', 1)):
      return out
    page += 1
    time.sleep(GAP_S)


def document_text(session, rcept_no: str) -> str:
  """document.xml(zip) 안의 xml 전부를 글로 이어 붙인다."""
  def _once():
    r = session.get(DOC_URL, params={'crtfc_key': _key(), 'rcept_no': rcept_no}, timeout=60)
    r.raise_for_status()
    return r.content
  raw = with_retry(_once, _label=f'dart document {rcept_no}')
  time.sleep(GAP_S)
  with zipfile.ZipFile(io.BytesIO(raw)) as z:
    return '\n'.join(xml_to_text(z.read(n).decode('utf-8', errors='replace')) for n in sorted(z.namelist()))
```

`test_dart_api.py` 는 `requests.Session` 대역(가짜 `get`)으로 ① status 013 → `[]` ② total_page 2 → 두 쪽 합 ③ status 020 → RuntimeError 이고 메시지에 `crtfc_key` 가 없다 — 세 가지를 본다.

- [ ] **Step 6: `scripts/backfill_filer_ids.py`(일회성)** — `sec_cik` 는 SEC `company_tickers.json`(ticker → cik)으로 **미국 상장 OEM 전체**를 채우고, 거기 없는 외국 등록사는 고정 표로 채운다. `dart_corp_code` 는 빈 4곳만 고정 표(조사 노트 korea.md 실측). 이미 값이 있으면 덮지 않는다(다르면 경고만).

```python
"""companies.sec_cik · dart_corp_code 채우기(일회성 · 끝나면 scripts/_archive/).

- sec_cik: company_tickers.json 의 ticker 일치(company_type='OEM' 전부) + 아래 고정 표(6-K 제출사)
- dart_corp_code: 아래 고정 표(빈칸만) — 값은 참고/고객사/research/korea.md 실측
출력은 회사 수·채운 수만.
"""
import sys

import requests

from lib.bootstrap import init_script
init_script(__file__)
from lib import db, edgar  # noqa: E402
from lib.db import WriteSession  # noqa: E402

SEC_CIK_FIXED = {'STLA': '1605484', 'VFS': '1913510'}  # 20-F/6-K 제출사 — 티커 표에 있어도 고정값이 우선
DART_FIXED = {'005380': '00164742', '000270': '00106641', '012330': '00164788', '003620': '00138242'}


def main(dry_run: bool) -> int:
  sys.stdout.reconfigure(encoding='utf-8', errors='replace')
  with requests.Session() as s:
    tickers = {v['ticker'].upper(): str(v['cik_str']) for v in
               edgar.edgar_get(s, 'https://www.sec.gov/files/company_tickers.json').json().values()}
  # 서버에서 거른다 — 표 전체(지금 634행)를 받으면 PostgREST 1000행 상한을 넘는 날 OEM 이 조용히 빠진다
  cols, c = 'id,ticker,company_type,sec_cik,dart_corp_code', db.get_client()
  rows = c.table('companies').select(cols).eq('company_type', 'OEM').execute().data
  rows += (c.table('companies').select(cols).in_('ticker', sorted(set(SEC_CIK_FIXED) | set(DART_FIXED)))
           .neq('company_type', 'OEM').execute().data)
  updates = []
  for r in rows:
    t = (r['ticker'] or '').upper()
    patch = {}
    cik = SEC_CIK_FIXED.get(t) or (tickers.get(t) if r['company_type'] == 'OEM' else None)
    if cik and not r['sec_cik']:
      patch['sec_cik'] = cik
    corp = DART_FIXED.get(t)
    if corp and not r['dart_corp_code']:
      patch['dart_corp_code'] = corp
    elif corp and r['dart_corp_code'] != corp:
      print(f'경고: {t} dart_corp_code 기존값과 다름 — 덮지 않음')
    if patch:
      updates.append((r['id'], patch))
  print(f'대상 {len(rows)}곳 · 채울 곳 {len(updates)}')
  if dry_run:
    return 0
  with WriteSession() as ws:
    for cid, patch in updates:
      ws.table('companies').update(patch).eq('id', cid).execute()
  return 0


if __name__ == '__main__':
  sys.exit(main('--dry-run' in sys.argv))
```

`scripts/lib/db.py` 실측 API: 조회 `db.get_client().table(...)` · 쓰기 `WriteSession().table(...)`(끝날 때 자동 revalidate) · `db.upsert_rows(table, rows, 'a,b')`(충돌 칸은 쉼표 문자열). 🔴 `company_tickers.json` 의 티커가 우리 `ticker` 와 다른 꼴(예 `VOW3.DE`)이면 안 맞는 게 정상 — 미국 상장만 대상이다.

- [ ] **Step 7: 실행·확인** — Run: `scripts/venv/Scripts/python.exe scripts/backfill_filer_ids.py --dry-run` → Expected: `채울 곳` 이 0 이 아니고 경고 0. 본 실행 뒤:

```sql
select ticker, sec_cik, dart_corp_code from companies
where ticker in ('GM','RIVN','PII','STLA','VFS','005380','000270','012330','003620') order by ticker;
```

Expected: GM 1467858 · RIVN 1874178 · PII 931015 · STLA 1605484 · VFS 1913510 · 005380 00164742 · 000270 00106641 · 012330 00164788 · 003620 00138242.

- [ ] **Step 8: 시험** — Run: `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib -q` → PASS(기존 `test_stellantis_shipments*.py` 포함 — 이전한 함수가 그대로 도는지). `scripts/venv/Scripts/python.exe scripts/verify_call_contracts.py; echo "EXIT=$?"` → 0.

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/doc_text.py scripts/lib/edgar.py scripts/lib/dart_api.py scripts/lib/test_doc_text.py scripts/lib/test_edgar.py scripts/lib/test_dart_api.py scripts/collect_stellantis_shipments.py scripts/backfill_filer_ids.py Architecture.md
git commit -m "refactor(수집): EDGAR·DART·문서 글 공용 헬퍼로 이전 + 공시 식별자 채우기"
```

`test_doc_text.py` 는 `html_to_table_rows` 에 셀 쪼개진 괄호(`(13,441,754` · `)`) · `&nbsp;` · 빈 셀이 든 작은 html 을 넣어 기존 결과와 같은지 본다.

---

### Task 3: 문서 목록 수집기 — EDGAR · DART

**Files:**

- Create: `scripts/collect_customer_docs.py` · `scripts/lib/test_customer_docs_classify.py`

**Interfaces:**

- Consumes: `edgar.fetch_filings`·`filing_htm_names` · `dart_api.list_disclosures` · Task 4 의 `ir_lists.IR_LISTS`
- Produces: `customer_documents` 행(`parse_status='pending'`) · `customer_collect_status`(collector `edgar_list`·`dart_list`·`ir_list`)

- [ ] **Step 1: 분류 함수(순수) 먼저 — 시험부터**

```python
# scripts/collect_customer_docs.py 의 분류부
import re

_DART_TYPES = (  # (보고서명 정규식, doc_type) — [기재정정]·[첨부정정] 머리는 떼고 본다
  (r'영업\(잠정\)실적|연결재무제표기준영업\(잠정\)실적', 'prelim_results'),
  (r'기업설명회\(IR\)개최', 'ir_event'),
  (r'영업실적등에대한전망|장래사업ㆍ경영계획', 'guidance'),
)
_EDGAR_6K = ((r'result', 'earnings_release'), (r'deliver|shipment|production', 'sales_release'))


def classify_dart(report_nm: str) -> str | None:
  name = re.sub(r'^\[[^\]]+\]\s*', '', report_nm.strip()).replace(' ', '')
  return next((t for rx, t in _DART_TYPES if re.search(rx, name)), None)


def classify_edgar(form: str, items: str, desc: str) -> str | None:
  if form in ('10-Q', '10-K', '20-F'):
    return 'periodic'
  if form == '8-K':
    return 'earnings_release' if '2.02' in items.split(',') else 'current_report'
  if form == '6-K':
    d = (desc or '').lower()
    return next((t for rx, t in _EDGAR_6K if re.search(rx, d)), 'current_report')
  return None
```

```python
# scripts/lib/test_customer_docs_classify.py — 보고서명은 2026 실물 그대로
import importlib.util, pathlib, unittest

_p = pathlib.Path(__file__).resolve().parents[1] / 'collect_customer_docs.py'
spec = importlib.util.spec_from_file_location('ccd', _p)
ccd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ccd)


class ClassifyTest(unittest.TestCase):
  def test_dart(self):
    self.assertEqual(ccd.classify_dart('연결재무제표기준영업(잠정)실적(공정공시)'), 'prelim_results')
    self.assertEqual(ccd.classify_dart('영업(잠정)실적(공정공시)'), 'prelim_results')
    self.assertEqual(ccd.classify_dart('[기재정정]영업실적등에대한전망(공정공시)'), 'guidance')
    self.assertEqual(ccd.classify_dart('기업설명회(IR)개최(안내공시)'), 'ir_event')
    self.assertIsNone(ccd.classify_dart('임원ㆍ주요주주특정증권등소유상황보고서'))

  def test_edgar(self):
    self.assertEqual(ccd.classify_edgar('8-K', '2.02,9.01', ''), 'earnings_release')
    self.assertEqual(ccd.classify_edgar('8-K', '7.01,9.01', ''), 'current_report')
    self.assertEqual(ccd.classify_edgar('6-K', '', 'Q3 2026 Shipments'), 'sales_release')
    self.assertEqual(ccd.classify_edgar('10-Q', '', ''), 'periodic')
```

`collect_customer_docs.py` 는 최상단에서 `init_script` 를 부르므로, 시험이 import 할 때 부작용이 없게 `init_script` 호출을 `main()` 안으로 둔다(분류 함수는 모듈 최상단 · DB import 는 `main()` 안).

Run: `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_customer_docs_classify.py -q` → 먼저 FAIL(파일 없음) → 분류부 작성 → PASS.

- [ ] **Step 2: 수집 본문**

```python
# OEM 이 아니지만 파서 대상인 회사(현대모비스 = 부품사). customer_parsers 패키지(Task 6)에 기대지 않으려고 여기 둔다 —
# Task 6 의 test_customer_parsers 가 parser_tickers() 와 어긋나지 않는지 본다.
PARSER_ONLY_TICKERS = ('012330',)


def targets() -> list[dict]:
  """활성 OEM + PARSER_ONLY_TICKERS 중 sec_cik 또는 dart_corp_code 가 있는 회사. 거르기는 서버에서."""
  from lib import db
  cols, c = 'id,ticker,name_kr,company_type,sec_cik,dart_corp_code,status', db.get_client()
  rows = c.table('companies').select(cols).eq('company_type', 'OEM').eq('status', 'active').execute().data
  rows += (c.table('companies').select(cols).in_('ticker', list(PARSER_ONLY_TICKERS)).eq('status', 'active')
           .execute().data)
  return [r for r in rows if r['sec_cik'] or r['dart_corp_code']]


def edgar_rows(session, c: dict, since: str) -> list[dict]:
  out = []
  for f in edgar.fetch_filings(session, c['sec_cik'], ('8-K', '6-K', '10-Q', '10-K', '20-F'), since):
    t = classify_edgar(f.form, f.items, f.primary_desc)
    if not t:
      continue
    out.append({'company_id': c['id'], 'source': 'edgar', 'source_id': f.accession, 'doc_type': t, 'form': f.form,
                'items': f.items, 'title': f.primary_desc or f.form, 'url': f'{f.base_url(c["sec_cik"])}/{f.primary_doc}',
                'published_at': f.filing_date})
  return out


def dart_rows(session, c: dict, bgn: str, end: str) -> list[dict]:
  out = []
  for ty in ('I002', 'I003'):  # 공정공시 · 안내공시(IR 개최) — 착수 시 list.json 으로 IR 개최 공시의 detail_ty 를 재확인
    for d in dart_api.list_disclosures(session, c['dart_corp_code'], bgn, end, ty):
      t = classify_dart(d['report_nm'])
      if t:
        out.append({'company_id': c['id'], 'source': 'dart', 'source_id': d['rcept_no'], 'doc_type': t, 'form': ty,
                    'items': None, 'title': d['report_nm'].strip(),
                    'url': f'https://dart.fss.or.kr/dsaf001/main.do?rcpNo={d["rcept_no"]}',
                    'published_at': f'{d["rcept_dt"][:4]}-{d["rcept_dt"][4:6]}-{d["rcept_dt"][6:]}'})
  return out
```

`main(argv)`: `--company <ticker>`(GHA 회사별 실행) · `--since YYYY-MM-DD`(기본 = 오늘 − 400일 · `--backfill` 이면 − 760일 ≈ 2년) · `--dry-run`(건수만). 회사마다 EDGAR·DART·IR 을 따로 `try` 로 감싸 한 출처 실패가 다른 출처를 막지 않게 하고, 결과를 `customer_collect_status` 에 남긴다: upsert «전»에 기존 `(source, source_id)` 를 조회해 새 키 수 n 을 센다(`upsert_rows` 반환값은 «보낸» 행 수이고 skip 트리거로 같은 값은 0행이라 근거가 못 된다) — n>0 → `ok` · 0 → `no_new` · `requests.HTTPError` 403 → `blocked`(사유 「<출처> 접근 차단(HTTP 403)」) · 그 밖 → `error`(사유 = 예외 클래스 이름만). 적재는 `WriteSession` 안에서 `db.upsert_rows('customer_documents', rows, 'source,source_id')` — 🔴 payload 에 `parse_status`·`sha256`·`first_seen_at` 을 넣지 않는다(PostgREST upsert 는 payload 칸만 덮으므로 이미 파싱한 문서가 `pending` 으로 돌아가지 않는다). 🔴 `customer_collect_status` payload 에는 `checked_at`(UTC ISO 현재 시각)을 **매번** 넣는다 — `default now()` 는 INSERT 에만 들어가 upsert 로는 확인 시각이 첫 기록에 멈춘다. 상태 행 적재는 공용 함수 `write_status(ws, company_id, collector, status, reason)` 하나로(Task 6 오케스트레이터도 같은 함수).

- [ ] **Step 3: 실측 실행(로컬)** — Run: `scripts/venv/Scripts/python.exe scripts/collect_customer_docs.py --dry-run --company GM` → Expected: EDGAR 문서 수 n>0(2년이면 8-K 실적 8건 이상), IR 은 Task 4 전이라 건너뜀. 국내 1곳(`--company 005380 --dry-run`)도 prelim_results·guidance·ir_event 가 다 나오는지.

- [ ] **Step 4: 본 실행(백필)** — `--backfill` 로 전체. 확인:

```sql
select c.ticker, d.source, d.doc_type, count(*) from customer_documents d join companies c on c.id = d.company_id
group by 1,2,3 order by 1,2,3;
```

Expected: 국내 4곳(현대모비스는 `PARSER_ONLY_TICKERS` 로)·미국 5곳 = 9곳 1행 이상 · VW·포르쉐는 Task 4 뒤 · 파서 없는 OEM(이미 `dart_corp_code` 가 있는 비상장 국내 OEM 4곳 등)도 목록은 쌓인다(`not_target` 예정).

- [ ] **Step 5: Commit** — `git add scripts/collect_customer_docs.py scripts/lib/test_customer_docs_classify.py Architecture.md` · `git commit -m "feat(고객사): 공식 문서 목록 수집기(EDGAR·DART)"`(새 `scripts/lib` 시험 파일 → 부록 C 한 줄 · pre-commit)

---

### Task 4: IR 사이트 목록 어댑터 (HTTP · GM 은 GHA 시험)

**Files:**

- Create: `scripts/lib/ir_lists.py` · `scripts/lib/test_ir_lists.py` · `scripts/lib/fixtures/ir_lists/*.json|*.html|*.xml`(각 출처 응답 1개씩 — 2026-11 실물을 잘라 저장)
- Modify: `scripts/collect_customer_docs.py`(IR 출처 연결) · `.prettierignore`(`scripts/lib/fixtures/` 한 줄 — 잘라 낸 JSON·원문 HTML 이 `format:check`(= `prettier --check .`)를 깨지 않게) · `Architecture.md`(부록 C)

**Interfaces:**

- Produces: `ir_lists.IR_LISTS: dict[ticker, Callable[[Session, since], list[dict]]]` — 각 dict 는 `customer_documents` 칸(`source='ir'`) · `probe_gm()`(브라우저 UA `requests` → 실패 시 Playwright 1회 → HTTP 상태만 출력 · `customer_collect_status(GM, 'ir_list')` 기록 · 스스로 `init_script` — Task 12 워크플로가 부른다)

각 어댑터는 «목록 응답 → 행» 순수 함수(`parse_<회사>(payload) -> list[dict]`)와 «받기»(`fetch_<회사>(session)`)로 가른다. 시험은 순수 함수만, 픽스처로.

| 회사          | 목록 URL(조사 노트 실측)                                                                                                                                       | 응답에서 쓰는 칸                                                                    | doc_type 판정                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 폭스바겐      | `https://www.volkswagen-group.com/en/feeds/press-releases`(RSS) + `/en/financial-results-18486`(연도×Q1/H1/Q3/AMC 행렬) + `/en/ad-hoc`                         | RSS `title`·`pubDate`·`link` · 행렬 앵커 텍스트·href                                | 제목에 `results`·`Outlook` → earnings_release · `deliver` → sales_release · ad-hoc → guidance · 나머지 버림                           |
| 폭스바겐 일정 | `/en/events` → 이벤트별 `/en/events/<slug>-<id>/ics`                                                                                                           | `DTSTART;VALUE=DATE:` · `SUMMARY:`                                                  | `customer_earnings_dates` 직행(문서 아님)                                                                                             |
| 포르쉐        | `https://ir-api.eqs.com/feeds/news/280d99fe-1c97-49ce-8a12-e08a72f252c9/json?companyToken=280d99fe-1c97-49ce-8a12-e08a72f252c9&lang=en&from=…&till=…&limit=-1` | `date_published`(UTC) · `title` · `url` · `_eqs.news_type` · `content_html`         | `EQS-News`·`EQS-Ad-hoc` 중 제목에 `results`·`forecast`·`outlook` → earnings_release · `deliveries` → sales_release · `EQS-AFR` → 버림 |
| 폴라리스      | Q4 Inc `FinancialReport.svc/GetFinancialReportList` · `Event.svc/GetEventList`(apiKey 는 조사 노트)                                                            | 보고 `Documents[].category/title/path` · 이벤트 `StartDate`·`Title`·`Attachments[]` | 발표자료 → presentation · 컨퍼런스 첨부 → investor_day · 실적 콜 이벤트 → `customer_earnings_dates`                                   |
| 현대차        | `POST https://www.hyundai.com/wsvc/ww/quarterlyResults.detail.do` body `year=YYYY&lang=ko`                                                                     | `quarter`·`presentationValue`·`guidanceValue`                                       | 발표 PDF → presentation · 가이던스 PDF → guidance(날짜 칸 없음 → 같은 분기 DART 잠정실적 공시일로)                                    |
| 기아          | `GET https://worldwide.kia.com/api/investors/business-sales-results?language=ko&year=YYYY&page=1`                                                              | `type`(`business`만) · `quarter` · `publicatedAt` · `files[].path`                  | presentation                                                                                                                          |
| 현대모비스    | `GET https://www.mobis.com/kr/ir/irReportLoad.do?type=performance&pageIndex=1&srcYear=YYYY`                                                                    | 제목(「2026년 3분기 경영실적」) · `/cmm/fms/PdfFileDown.do?fileId=`                 | presentation(날짜 없음 → DART 잠정실적 공시일)                                                                                        |
| KGM           | `GET https://web.kg-mobility.com/app/display/about/getAboutKGMDataRoomContentsList.do`                                                                         | `body.releaseList`·`managementList` 의 제목·`fileUrl`(파일명 타임스탬프 = 날짜)     | releaseList → presentation(「CEO IR설명회」 → investor_day) · managementList → earnings_release                                       |
| GM            | `https://investor.gm.com/shareholders/quarterly-results`                                                                                                       | 분기별 Earnings Deck · Shareholder Letter · U.S. Sales Release 링크                 | 🔴 로컬 403 — 아래 Step 3                                                                                                             |
| 스텔란티스    | 목록은 EDGAR 로 충분(실적·출하 6-K) · 북미 출하·일정은 기존 IR 수집기·Playwright                                                                               | —                                                                                   | 어댑터 없음                                                                                                                           |
| 빈패스트      | EDGAR 로 충분                                                                                                                                                  | —                                                                                   | 어댑터 없음                                                                                                                           |

🔴 응답 칸 이름 중 **KGM 목록 항목의 제목 칸 이름은 미확인**(노트에 `fileUrl` 만 있다) — Step 1 에서 실물을 받아 픽스처로 저장하며 확정한다.

- [ ] **Step 1: 픽스처 받기(로컬 1회)** — 각 URL 을 `requests` 로 받아 앞부분만 잘라 `scripts/lib/fixtures/ir_lists/` 에 저장. 응답에 회사 외 개인정보가 없는지 눈으로 본다(IR 목록이라 없어야 정상).

- [ ] **Step 2: 순수 파서 + 시험** — 회사마다 `MUST_HIT`(픽스처에서 반드시 나와야 할 행 1개 이상: 예 VW `Volkswagen Group nine-month results underline urgent need for action` → earnings_release · 2026-10-30) · `MUST_MISS`(홍보 글 1개 → 버림). Run: `pytest scripts/lib/test_ir_lists.py -q` → FAIL → 구현 → PASS.

- [ ] **Step 3: GM IR 은 GHA 러너에서 시험** — 로컬에선 curl·Playwright 모두 403(Akamai). `.github/workflows/collect-customer-docs.yml`(Task 12)의 `workflow_dispatch` 입력 `probe_gm_ir=true` 로 러너에서 `requests`(브라우저 UA) → 실패 시 Playwright 1회를 시도하고 HTTP 상태만 로그에 남긴다.
  - 성공하면: GM 어댑터를 켠다(분기 Earnings Deck·Shareholder Letter → presentation·shareholder_letter · U.S. Sales Release → sales_release).
  - 실패하면: 어댑터를 끈 채 `customer_collect_status(GM, 'ir_list') = blocked` · 사유 「GM IR 사이트가 자동 접근을 막아(HTTP 403) 실적 발표자료·미국 분기 소매 판매를 못 모읍니다」 — 화면 자료실·물량 절에 이 문장을 보인다(Task 14). 미국 소매 판매는 «미수집»이며 대체 경로(외부 크롤러)는 이 계획 범위 밖.

- [ ] **Step 4: 수집기 연결** — `collect_customer_docs.py` 가 회사 ticker 가 `IR_LISTS` 에 있으면 IR 행도 같은 upsert 에 더한다. IR `source_id` = URL 경로(쿼리 제외) — 같은 문서가 RSS·행렬 양쪽에 나오면 하나로 합쳐진다.

- [ ] **Step 5: 실측** — `--dry-run --company VOW3.DE` · `P911.DE` · `PII` · `000270` → 출처별 건수 > 0.

- [ ] **Step 6: Commit** — `git add scripts/lib/ir_lists.py scripts/lib/test_ir_lists.py scripts/lib/fixtures/ir_lists scripts/collect_customer_docs.py .prettierignore Architecture.md` · `git commit -m "feat(고객사): IR 사이트 문서 목록 어댑터(독일·폴라리스·국내 3곳)"`

---

### Task 5: 인용·숫자 대조기 `scripts/lib/quote_check.py` (agents 이식)

**Files:**

- Create: `scripts/lib/quote_check.py` · `scripts/lib/test_quote_check.py`

**Interfaces:**

- Produces: `normalize(s)` · `quote_in_source(quote, source)` · `value_in_quote(value, quote)` · `check_row(row, source_text) -> (verified, note)` · `self_test() -> list[str]`

이식 원본(agents 레포 · 조사 노트 repo_assets 8번): `scripts/pani9/codex_guard.py`(합자 `LIG` · 조각 `FRAG_SPLIT` · `MIN_FRAG=12` · `norm`) · `scripts/verify-essay-quotes.mjs`(`normalize` — 따옴표·대시·공백) · `apps/orchestrator/src/curatedQuality.ts:264`(`NUMBER_RE` · `numbersIn`). 여기서 더한 것 3가지: 표 행 quote(`' | '` 이음)를 원문 글과 맞추려고 `|` 를 공백으로 · 값은 단위 배수(백·천·백만·10억·만·억·조)와 괄호 음수를 풀어 본다 · `value_text` 는 quote 안에 그대로 있어야 한다. 대조 지적(2026-11-09) 뒤 더한 것: 12자 미만 표 행(KGM `CKD 60 60`)은 «글자 라벨 + 숫자»가 함께 있고 통째로 원문에 있으면 인정 · 영어 수 낱말 one~twelve(폴라리스 `up one to three percent`) · 일정 행은 `check_date_row`(날짜의 연·월·일이 quote 에) — 셋 다 실물 표본을 `MUST_HIT`·`MUST_MISS`·`DATE_HIT`·`DATE_MISS` 에 넣었다.

- [ ] **Step 1: 시험 먼저** — `test_quote_check.py`: `self.assertEqual(quote_check.self_test(), [])` 한 줄 + 아래 실물 3건.

```python
import unittest

from lib import quote_check as qc


class QuoteCheckTest(unittest.TestCase):
  def test_self(self):
    self.assertEqual(qc.self_test(), [])

  def test_real_rows(self):
    src = 'EBIT-adjusted $14.5 billion - $15.5 billion $14.0 billion - $16.0 billion'
    class R:  # noqa: E306
      quote, value, low, high, value_text = 'EBIT-adjusted | $14.5 billion - $15.5 billion | $14.0 billion - $16.0 billion', None, 14.5, 15.5, None
    self.assertEqual(qc.check_row(R, src), (True, 'ok'))
    R.low = 14.0 + 0.1
    self.assertFalse(qc.check_row(R, src)[0])
```

Run: `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_quote_check.py -q` → FAIL(모듈 없음).

- [ ] **Step 2: 구현**(시제품 — 실물 105행 대조 실패 0)

```python
# scripts/lib/quote_check.py
"""인용·숫자 대조기 — 뽑은 행의 quote 가 원문에 정말 있고, 값이 그 quote 안에 정말 있는지 본다.

agents 레포에서 옮겨 온 규칙(원본 = repo_assets 8번):
- 정규화: scripts/verify-essay-quotes.mjs normalize + scripts/pani9/codex_guard.py norm(합자 풀기)
- 조각 대조: codex_guard.py quote_frags(… · ' / ' 로 쪼개 12자 이상 조각만)
- 숫자 대조: apps/orchestrator/src/curatedQuality.ts NUMBER_RE · numbersIn
여기서 더한 것:
- 표 행 quote(' | ' 이음)는 원문에서 셀 사이 공백만 남으므로 '|' 를 공백으로 본다
- 값 대조는 단위 배수(백·천·백만·10억·만·억·조)와 괄호 음수를 풀어 본다 · 영어 수 낱말(one~twelve)도 숫자로 본다
- 12자 미만 짧은 표 행('CKD 60 60')은 «글자 라벨 + 숫자»가 함께 있고 통째로 원문에 있으면 인정
- 일정 행은 값이 아니라 날짜(연·월·일)가 quote 에 있는지로 본다(check_date_row)
코드 파서 행도 LLM 행도 같은 검사를 지나야 verified=true 다.
"""
import re
import unicodedata

LIG = {'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl'}
FRAG_SPLIT = re.compile(r'\s/\s|…|\.\.\.')
MIN_FRAG = 12
MIN_SHORT = 6
_WORDS = {'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9,
          'ten': 10, 'eleven': 11, 'twelve': 12}
_WORD_RE = re.compile(r'\b(' + '|'.join(_WORDS) + r')\b')
_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
           'november', 'december']


def normalize(s: str) -> str:
  for k, v in LIG.items():
    s = s.replace(k, v)
  s = unicodedata.normalize('NFKC', s)
  s = re.sub(r'[‐-―−]', '-', s)
  s = re.sub(r'[‘’‚‛“”„‟ʼ"\'`]', '', s)
  s = s.replace('|', ' ').replace('\xa0', ' ')
  s = re.sub(r'\s+', ' ', s).replace(' ,', ',').strip().lower()
  return s.rstrip('.;:,')


def quote_in_source(quote: str, source: str) -> bool:
  """quote 의 모든 조각(12자 이상)이 정규화한 원문에 그대로 있어야 참.
  조각이 하나도 없는 짧은 quote 는 «글자 라벨 + 숫자»를 함께 갖고 통째로 원문에 있을 때만 참."""
  src = normalize(source)
  frags = [normalize(f) for f in FRAG_SPLIT.split(quote)]
  long_frags = [f for f in frags if len(f) >= MIN_FRAG]
  if long_frags:
    return all(f in src for f in long_frags)
  q = normalize(quote)
  return (len(q) >= MIN_SHORT and bool(re.search(r'[a-z가-힣]', q)) and bool(re.search(r'\d', q))
          and f' {q} ' in f' {src} ')


def numbers_in(s: str) -> list[float]:
  t = _WORD_RE.sub(lambda m: str(_WORDS[m.group(1)]), normalize(s))
  out = []
  for m in re.finditer(r'\(?-?[\d,]*\.?\d+\)?', t):
    tok = m.group(0)
    neg = tok.startswith('(') and tok.endswith(')') or tok.startswith('-')
    digits = tok.strip('()').lstrip('-').replace(',', '')
    if not digits or digits == '.':
      continue
    try:
      v = float(digits)
    except ValueError:
      continue
    out.append(-v if neg else v)
  return out


def value_in_quote(value: float, quote: str, rel_tol: float = 1e-9) -> bool:
  """값이 quote 의 숫자 중 하나와 같다(단위 배수 1·백(억원→백만원)·천·백만·10억·만·억·조 중 하나로 맞으면 참)."""
  for n in numbers_in(quote):
    for mult in (1, 1e2, 1e3, 1e6, 1e9, 1e4, 1e8, 1e12, 1e-3, 1e-6):
      if abs(n * mult - value) <= max(abs(value) * rel_tol, 1e-9):
        return True
  return False


def check_row(row, source_text: str) -> tuple[bool, str]:
  """(verified, note). row 는 VolumeRow·ResultRow·GuidanceRow 어느 것이든(일정은 check_date_row)."""
  if not quote_in_source(row.quote, source_text):
    return False, 'quote_not_in_source'
  values = [getattr(row, k) for k in ('value', 'low', 'high') if getattr(row, k, None) is not None]
  for v in values:
    if not value_in_quote(float(v), row.quote):
      return False, f'value_not_in_quote:{v}'
  if not values and not getattr(row, 'value_text', None):
    return False, 'no_value'
  if getattr(row, 'value_text', None) and normalize(row.value_text) not in normalize(row.quote):
    return False, 'value_text_not_in_quote'
  return True, 'ok'


def check_date_row(row, source_text: str) -> tuple[bool, str]:
  """일정 행: quote 가 원문에 있고, event_date 의 연·월·일이 quote 안에 있어야 참.
  월은 영어 이름·숫자 둘 다 · 일은 앞 0 유무·서수(12th) 둘 다 본다."""
  if not quote_in_source(row.quote, source_text):
    return False, 'quote_not_in_source'
  y, m, d = (int(x) for x in row.event_date.split('-'))
  q = normalize(row.quote)
  has_year = str(y) in q
  has_month = _MONTHS[m - 1] in q or re.search(rf'(?<!\d)0?{m}(?!\d)', q) is not None
  has_day = re.search(rf'(?<!\d)0?{d}(?:st|nd|rd|th)?(?!\d)', q) is not None
  return (True, 'ok') if has_year and has_month and has_day else (False, 'date_not_in_quote')


# ---------------------------------------------------------------- 자가 시험
class _R:
  def __init__(self, quote, value=None, low=None, high=None, value_text=None, event_date=None):
    self.quote, self.value, self.low, self.high, self.value_text = quote, value, low, high, value_text
    self.event_date = event_date


_SRC = ('Total | 1,028 | 977 | 2,917 | 2,862 ' 'The Company now expects 2026 adjusted sales to be between $7.55 billion '
        'to $7.60 billion versus prior guidance. Adjusted EBITDA | $(1.85)B – $(1.75)B '
        '2026년 판매목표(대수) 4,158,300 - 영업이익률 목표 : 7~8% '
        'CKD 60 60 0.0% - 0 - - 총계 6,537 8,863 -26.2 '  # KGM 2026-10 월 판매 공시(20261102800582) 원문

        'The Company expects 2026 sales to be up one to three percent versus 2025. '
        'The company also announced that on February 12th, 2026, after market close, it will release its fourth quarter')
MUST_HIT = [
  _R('Total | 1,028 | 977 | 2,917 | 2,862', value=1028000),                    # 천 대 → 대
  _R('expects 2026 adjusted sales to be between $7.55 billion to $7.60 billion', low=7.55, high=7.60),
  _R('Adjusted EBITDA | $(1.85)B - $(1.75)B', low=-1.85, high=-1.75),          # 괄호 음수 · 대시 정규화
  _R('2026년 판매목표(대수) 4,158,300', value=4158300),
  _R('CKD 60 60', value=60),                                                     # KGM 월 판매 짧은 행(9자)
  _R('expects 2026 sales to be up one to three percent', low=1.0, high=3.0),   # 폴라리스 — 영어 수 낱말
]
MUST_MISS = [
  _R('Total | 1,028 | 977 | 2,917 | 2,862', value=1029000),                    # 숫자가 quote 에 없다
  _R('expects 2026 adjusted sales to be between $7.50 billion to $7.60 billion', low=7.50, high=7.60),  # 원문에 없는 quote
  _R('Total', value=1028),                                                       # 숫자 없는 짧은 quote
  _R('60 60', value=60),                                                         # 라벨 없는 짧은 quote
  _R('versus prior guidance. Adjusted EBITDA', value_text='Improved Y-o-Y'),     # value_text 가 quote 에 없다
  _R('expects 2026 sales to be up one to three percent', low=1.0, high=4.0),   # four 는 quote 에 없다
]
DATE_HIT = [_R('on February 12th, 2026, after market close, it will release its fourth quarter', event_date='2026-02-12')]
DATE_MISS = [_R('on February 12th, 2026, after market close, it will release its fourth quarter', event_date='2026-02-13')]


def self_test() -> list[str]:
  errs = []
  for r in MUST_HIT:
    ok, note = check_row(r, _SRC)
    if not ok:
      errs.append(f'MUST_HIT 실패({note}): {r.quote[:50]}')
  for r in MUST_MISS:
    if check_row(r, _SRC)[0]:
      errs.append(f'MUST_MISS 통과돼 버림: {r.quote[:50]}')
  for r in DATE_HIT:
    ok, note = check_date_row(r, _SRC)
    if not ok:
      errs.append(f'DATE_HIT 실패({note}): {r.event_date}')
  for r in DATE_MISS:
    if check_date_row(r, _SRC)[0]:
      errs.append(f'DATE_MISS 통과돼 버림: {r.event_date}')
  return errs
```

- [ ] **Step 3: PASS 확인 · Commit** — `git add scripts/lib/quote_check.py scripts/lib/test_quote_check.py Architecture.md` · `git commit -m "feat(수집): 인용·숫자 대조기(agents 규칙 이식)"`

---

### Task 6: 파서 틀 · 방향 판정 · 오케스트레이터

**Files:**

- Create: `scripts/customer_parsers/__init__.py` · `base.py` · `common.py` · `scripts/lib/guidance_direction.py` · `scripts/lib/test_guidance_direction.py` · `scripts/lib/test_customer_parsers.py` · `scripts/collect_customer_numbers.py`

**Interfaces:**

- 모듈 규약(`base.py` 머리 주석): `TICKERS: tuple[str]` · `wants(doc) -> bool` · `parse(doc, content) -> ParseResult` · `self_test() -> list[str]` · 선택 `fetch(session, doc) -> Content` · 선택 `llm_wants(doc, result) -> bool`
- `ParseResult.recognized` = 「이 문서가 이 파서의 대상 꼴이다」. `recognized and count()==0` → `failed`(exit 1) · `not recognized` → `not_target`
- Produces: `customer_volume_ir` · `customer_reported_results` · `customer_guidance` · `customer_earnings_dates` 행 · `customer_documents.parse_status/sha256/parse_note` · `customer_collect_status(collector='parse')`

- [ ] **Step 1: `base.py` · `common.py`**(시제품 그대로) — `base.py` 에 정규 어휘 상수(`METRICS` · `VOLUME_METRICS` · `UNITS` · `RESULT_UNITS` · `BASES`)와 `check_vocab` · `ParseResult.dedupe` 가 있다. 모든 파서와 LLM 스키마(Task 11 enum)는 이 어휘만 쓴다 — 키가 갈리면 코드 행·LLM 행 충돌 판정과 방향 이력이 갈라진다.

```python
# scripts/customer_parsers/base.py
"""고객사 숫자 파서 공통 — 문서·결과 자료형과 숫자 읽기.

파서 모듈(이 폴더의 회사별 파일)은 아래 이름을 갖는다:
  TICKERS: tuple[str, ...]              companies.ticker — 회사 식별(코드에 「고객」 명단을 두지 않는다)
  wants(doc: Doc) -> bool               이 문서를 읽을지(제목·서식·폼으로만 — 본문은 아직 없다)
  parse(doc: Doc, content: Content) -> ParseResult
  self_test() -> list[str]              MUST_HIT·MUST_MISS 어긋남 목록(빈 목록 = 통과)
  (선택) fetch(session, doc) -> Content  기본 내려받기로 안 되는 곳(Playwright·XLSX)
  (선택) llm_wants(doc, result) -> bool  코드로 못 뽑는 칸을 LLM 에 넘길 문서인지
"""
import re
from dataclasses import dataclass, field
from datetime import date

from lib.doc_text import norm_text


@dataclass(frozen=True)
class Doc:
  id: int
  company_id: str
  ticker: str
  source: str          # edgar | dart | ir
  doc_type: str
  form: str
  items: str
  title: str
  url: str
  published_at: str    # YYYY-MM-DD
  source_id: str = ''  # EDGAR accession · DART 접수번호 · IR 키


@dataclass
class Content:
  text: str
  tables: list[list[list[str]]] = field(default_factory=list)
  raw: bytes = b''


@dataclass(frozen=True)
class VolumeRow:
  metric: str          # shipments | deliveries | production | wholesale | sales
  region: str          # 'total' 또는 회사 원문 지역(소문자 영문 키)
  period_grain: str    # month | quarter | ytd | year
  period: str          # 2026-10 · 2026-Q3 · 2026-9M · 2026
  value: int           # 대
  definition: str      # 회사 정의 한 줄(화면 「정의 차이」 상자)
  quote: str           # 원문 행·문장


@dataclass(frozen=True)
class ResultRow:
  metric: str          # revenue | operating_income | net_income | ebit_adjusted | ...
  metric_name: str     # 회사가 쓴 이름 그대로
  basis: str           # reported | adjusted
  period_grain: str    # quarter | ytd
  period: str          # 2026-Q3 · 2026-6M
  value: float
  unit: str            # million | billion | per_share
  currency: str
  quote: str


@dataclass(frozen=True)
class GuidanceRow:
  metric: str
  metric_label: str
  period: str          # FY2026
  low: float | None
  high: float | None
  value_text: str | None
  unit: str
  basis: str | None
  quote: str
  stated: str | None = None   # 원문이 밝힌 방향 낱말 → raised 등(숫자로 비교 못 할 때만 쓴다)


@dataclass(frozen=True)
class EarningsDate:
  period: str          # 발표 대상 2026-Q3 · 2026-FY
  event_date: str      # YYYY-MM-DD
  quote: str


@dataclass
class ParseResult:
  volume: list[VolumeRow] = field(default_factory=list)
  results: list[ResultRow] = field(default_factory=list)
  guidance: list[GuidanceRow] = field(default_factory=list)
  dates: list[EarningsDate] = field(default_factory=list)
  # 대상 서식으로 «알아봤는가». True 인데 숫자가 0개면 형식 변경(파싱 실패)이다.
  recognized: bool = False

  def count(self) -> int:
    return len(self.volume) + len(self.results) + len(self.guidance) + len(self.dates)

  def dedupe(self) -> None:
    """적재 키(PK) 기준 중복 제거 — 먼저 들어온 행이 남는다(코드 행을 LLM 행보다 먼저 넣으므로 코드 우선).
    한 upsert 안에 같은 PK 가 두 번 있으면 Postgres 가 'cannot affect row a second time' 으로 문서 적재를 통째로 거절한다."""
    def first(rows, key):
      seen, out = set(), []
      for r in rows:
        k = key(r)
        if k not in seen:
          seen.add(k)
          out.append(r)
      return out
    self.volume = first(self.volume, lambda r: (r.metric, r.region, r.period_grain, r.period))
    self.results = first(self.results, lambda r: (r.period_grain, r.period, r.metric))
    self.guidance = first(self.guidance, lambda r: (r.metric, r.period))
    self.dates = first(self.dates, lambda r: r.period)

  def extend(self, other: 'ParseResult') -> None:
    self.volume += other.volume
    self.results += other.results
    self.guidance += other.guidance
    self.dates += other.dates
    self.recognized = self.recognized or other.recognized


# ---------------------------------------------------------------- 정규 어휘(파서·LLM 스키마가 이것만 쓴다)
# 실적·가이던스 metric 은 한 벌이다 — 같은 키여야 가이던스 카드에서 실적과 나란히 보이고, 코드 행·LLM 행 충돌 판정과
# 방향 이력이 같은 칸으로 모인다. 새 키는 여기 한 줄 + 화면 라벨(lib/customers) 한 줄.
METRICS = (
  'revenue', 'revenue_growth', 'operating_income', 'operating_margin', 'net_income', 'net_income_parent',
  'ebit_adjusted', 'aoi', 'aoi_margin', 'adjusted_ebitda', 'adjusted_sales', 'eps_adjusted', 'operating_result_bsi',
  'adjusted_automotive_fcf', 'industrial_fcf', 'free_cash_flow', 'automotive_net_cash_flow', 'automotive_net_liquidity',
  'automotive_ncf_margin', 'automotive_ebitda_margin', 'investment_ratio', 'capex', 'bev_share', 'order_intake',
  'deliveries', 'sales_units', 'other')
VOLUME_METRICS = ('shipments', 'deliveries', 'production', 'wholesale', 'sales')   # DB CHECK 와 같음
UNITS = ('million', 'billion', 'trillion', 'per_share', 'percent', 'units', 'text')
RESULT_UNITS = ('million', 'billion', 'per_share')                                  # DB CHECK 와 같음
BASES = ('reported', 'adjusted')                                                    # DB CHECK 와 같음 — 연결/별도는 여기 아님


def check_vocab(r: 'ParseResult') -> list[str]:
  """어휘 밖 값 목록. 오케스트레이터는 하나라도 있으면 그 문서를 failed 로 둔다(DB CHECK 오류를 미리 막는다)."""
  errs = [f'volume metric {v.metric}' for v in r.volume if v.metric not in VOLUME_METRICS]
  errs += [f'result metric {x.metric}' for x in r.results if x.metric not in METRICS]
  errs += [f'result unit {x.unit}' for x in r.results if x.unit not in RESULT_UNITS]
  errs += [f'result basis {x.basis}' for x in r.results if x.basis not in BASES]
  errs += [f'guidance metric {g.metric}' for g in r.guidance if g.metric not in METRICS]
  errs += [f'guidance unit {g.unit}' for g in r.guidance if g.unit not in UNITS]
  errs += [f'guidance basis {g.basis}' for g in r.guidance if g.basis is not None and g.basis not in BASES]
  return errs


# ---------------------------------------------------------------- 숫자 읽기
_NUM_CELL = re.compile(r'^\(?[-+]?\d[\d,]*(?:\.\d+)?\)?$')
MONTHS = {m: i for i, m in enumerate(
  ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
   'september', 'october', 'november', 'december'], 1)}
QUARTER_WORDS = {'first': 1, 'second': 2, 'third': 3, 'fourth': 4}


def to_number(s: str) -> float | None:
  """'1,472' → 1472 · '(191)' → -191 · '(13,441,754' → -13441754(괄호가 셀로 쪼개진 꼴) · '-0.5' → -0.5."""
  s = norm_text(s).replace('$', '').replace('€', '').strip()
  if not s:
    return None
  neg = s.startswith('(') or s.startswith('-')
  digits = s.strip('()').lstrip('+-').replace(',', '')
  try:
    v = float(digits)
  except ValueError:
    return None
  return -v if neg else v


def numeric_cells(row: list[str]) -> list[float]:
  """라벨(첫 셀)을 뺀 숫자 셀만. '$'·'%'·'n.m.'·'—' 셀은 건너뛴다(퍼센트 셀은 숫자로 안 본다)."""
  out = []
  for c in row[1:]:
    c = norm_text(c)
    if _NUM_CELL.match(c):
      v = to_number(c)
      if v is not None:
        out.append(v)
  return out


def find_row(tables: list[list[list[str]]], label_re: str) -> list[str] | None:
  """첫 셀(또는 'I F R S' 같은 머리 셀 다음 둘째 셀)이 라벨에 맞는 첫 행."""
  rx = re.compile(label_re, re.I)
  for rows in tables:
    for row in rows:
      for i in (0, 1):
        if i < len(row) and rx.match(norm_text(row[i])):
          return row[i:]
  return None


def prev_month(published_at: str) -> str:
  """공시일 → 그 전달 'YYYY-MM'(국내 월 판매 공시는 매월 첫 영업일에 전달 분을 낸다)."""
  d = date.fromisoformat(published_at)
  y, m = (d.year, d.month - 1) if d.month > 1 else (d.year - 1, 12)
  return f'{y}-{m:02d}'


def prev_quarter(published_at: str) -> str:
  """공시일 → 직전 분기 'YYYY-Qn'(분기 종료 직후 나오는 생산·인도 보도자료)."""
  d = date.fromisoformat(published_at)
  q = (d.month - 1) // 3  # 이번 분기 번호 - 1
  return f'{d.year - 1}-Q4' if q == 0 else f'{d.year}-Q{q}'


def month_name_date(month: str, day: str, year: str) -> str:
  return f'{int(year)}-{MONTHS[month.lower()]:02d}-{int(day):02d}'
```

```python
# scripts/customer_parsers/common.py
"""회사별 파서가 같이 쓰는 표·문장 도우미(순수 함수)."""
import re

from customer_parsers.base import MONTHS, numeric_cells
from lib.doc_text import norm_text

_DATE_CELL = re.compile(r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*(\d{4})', re.I)
_WORD_NUM = {'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8,
             'nine': 9, 'ten': 10}


def quarter_of_month(month: int) -> int:
  return (month - 1) // 3 + 1


def quarter_from_date_text(s: str) -> str | None:
  """'September 30, 2026' → '2026-Q3'."""
  m = _DATE_CELL.search(s)
  if not m:
    return None
  return f'{m.group(2)}-Q{quarter_of_month(MONTHS[m.group(1).lower()])}'


def word_or_number(s: str) -> float:
  s = s.strip().lower()
  return float(_WORD_NUM[s]) if s in _WORD_NUM else float(s.replace(',', ''))


def money(s: str) -> float:
  """'$(1.85)' → -1.85 · '$14.5' → 14.5 · '€3' → 3."""
  s = norm_text(s).replace('$', '').replace('€', '').strip()
  neg = s.startswith('(') or s.startswith('-')
  v = float(s.strip('()').lstrip('-').replace(',', ''))
  return -v if neg else v


# '$14.5 billion - $15.5 billion' · '$(1.85)B - $(1.75)B' · '67,000 - 70,000' · '$12.75 - $13.75' · '$ 8.9-9.5'
RANGE = re.compile(
  r'(?P<a>\$?\s*\(?-?[\d,]*\.?\d+\)?)\s*(?P<ua>billion|B)?\s*(?:-|to)\s*'
  r'(?P<b>\$?\s*\(?-?[\d,]*\.?\d+\)?)\s*(?P<ub>billion|B)?')


def parse_range(cell: str) -> tuple[float, float] | None:
  m = RANGE.fullmatch(norm_text(cell).strip())
  if not m:
    return None
  return money(m.group('a')), money(m.group('b'))


def first_number(row: list[str]) -> float | None:
  nums = numeric_cells(row)
  return nums[0] if nums else None


def year_before(text: str, pos: int, rx: str = r'(?:expects|full year|Outlook for|fiscal year|for|in) (20\d{2})',
                window: int = 400) -> str | None:
  hits = re.findall(rx, text[max(0, pos - window):pos], re.I)
  return hits[-1] if hits else None


def dedupe_first(rows: list, key) -> list:
  """같은 문서 안 같은 칸(metric·period)이 두 번 잡히면 처음 것만(표 다음 본문 문장이 같은 값을 되풀이한다)."""
  seen, out = set(), []
  for r in rows:
    k = key(r)
    if k in seen:
      continue
    seen.add(k)
    out.append(r)
  return out
```

- [ ] **Step 2: `__init__.py` — 등록부**

```python
"""회사별 규칙 파서 등록부. 새 회사 = 모듈 하나 + 아래 목록 한 줄."""
import importlib

MODULE_NAMES = ('kr_dart', 'gm', 'rivian', 'polaris', 'vinfast', 'stellantis', 'vw', 'porsche')


def modules():
  return [importlib.import_module(f'customer_parsers.{n}') for n in MODULE_NAMES]


def module_for(ticker: str):
  return next((m for m in modules() if ticker in m.TICKERS), None)


def parser_tickers() -> set[str]:
  return {t for m in modules() for t in m.TICKERS}
```

Task 6 시점엔 모듈이 아직 없으므로 `MODULE_NAMES` 는 빈 튜플로 시작하고 Task 7~10 에서 한 줄씩 더한다.

- [ ] **Step 3: 방향 판정 — 시험 먼저 → 구현**

`test_guidance_direction.py`: `assertEqual(guidance_direction.self_test(), [])` + `assign()` 시험 1건(같은 metric·period 3행을 날짜 뒤섞어 넣으면 initiated → raised → maintained 순).

```python
# scripts/lib/guidance_direction.py
"""가이던스 방향(direction) — 같은 회사·metric·period 의 직전 검증 행과 비교해 코드가 정한다(LLM 이 정하지 않는다).

규칙(계획서 Task 6):
- 직전 행 없음 → initiated
- 둘 다 숫자: 가운데값 비교(한쪽 끝만 있으면 그 끝) · 상대 차 0.5% 이내 → maintained(반올림 표기 차 흡수:
  현대 '416만 대' vs '4,158,300 대') · 크면 raised · 작으면 lowered
  ⚠️ 범위 좁히기(GM 14.0~16.0 → 14.5~15.5)는 가운데값이 같아 maintained 다 — 원문이 'raising' 이라 해도 숫자가 우선
- 숫자로 비교 못 함(value_text 만): 원문 낱말(stated)이 있으면 그것 · 글자가 같으면 maintained · 아니면 None(화면 「변경」)
- withdrawn 은 stated='withdrawn' 일 때만
"""


def _point(low, high):
  if low is not None and high is not None:
    return (low + high) / 2
  return low if low is not None else high


def decide(prev: dict | None, cur: dict) -> str | None:
  if cur.get('stated') == 'withdrawn':
    return 'withdrawn'
  if prev is None:
    return 'initiated'
  a, b = _point(prev.get('low'), prev.get('high')), _point(cur.get('low'), cur.get('high'))
  if a is not None and b is not None:
    if abs(b - a) <= abs(a) * 0.005:
      return 'maintained'
    return 'raised' if b > a else 'lowered'
  if cur.get('stated') in ('raised', 'maintained', 'lowered'):
    return cur['stated']
  if (prev.get('value_text') or '').strip().lower() == (cur.get('value_text') or '').strip().lower():
    return 'maintained'
  return None


def assign(rows: list[dict]) -> list[tuple[int, str | None]]:
  """rows = 한 회사의 verified 가이던스 전부(id·metric·period·published_at·document_id·low·high·value_text·stated).
  (metric, period) 별로 (published_at, document_id) 순 정렬 뒤 앞 행과 비교 → [(id, direction)]."""
  out, groups = [], {}
  for r in rows:
    groups.setdefault((r['metric'], r['period']), []).append(r)
  for items in groups.values():
    items.sort(key=lambda r: (r['published_at'], r['document_id']))
    prev = None
    for r in items:
      out.append((r['id'], decide(prev, r)))
      prev = r
  return out


MUST_HIT = [  # (prev, cur, 기대)
  (None, {'low': 13.0, 'high': 15.0}, 'initiated'),
  ({'low': 4158300, 'high': 4158300}, {'low': 4160000, 'high': 4160000}, 'maintained'),   # 416만 대 반올림
  ({'low': 65000, 'high': 70000}, {'low': 67000, 'high': 70000}, 'raised'),              # 리비안 10-02 → 10-29
  ({'low': 4.0, 'high': 5.5}, {'low': None, 'high': 1.0}, 'lowered'),                     # VW 반기 → 9개월
  ({'low': 14.0, 'high': 16.0}, {'low': 14.5, 'high': 15.5, 'stated': 'raised'}, 'maintained'),  # 숫자가 우선
  ({'value_text': 'Low-Single Digit %'}, {'value_text': 'low-single digit %'}, 'maintained'),
  ({'value_text': 'Improved Y-o-Y'}, {'value_text': 'Positive'}, None),
  ({'low': 1.0, 'high': 2.0}, {'low': None, 'high': None, 'stated': 'withdrawn'}, 'withdrawn'),
]


def self_test() -> list[str]:
  errs = []
  for prev, cur, want in MUST_HIT:
    got = decide(prev, cur)
    if got != want:
      errs.append(f'{prev} → {cur}: 기대 {want} · 실제 {got}')
  return errs
```

- [ ] **Step 4: 파서 자가 시험을 pytest 로** — `scripts/lib/test_customer_parsers.py`

```python
"""회사별 파서의 MUST_HIT·MUST_MISS 를 pytest 로도 돈다(오케스트레이터는 실행 때마다 같은 것을 먼저 돈다)."""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))  # scripts/
import customer_parsers  # noqa: E402


class ParserSelfTests(unittest.TestCase):
  def test_all(self):
    for m in customer_parsers.modules():
      with self.subTest(module=m.__name__):
        self.assertEqual(m.self_test(), [])

  def test_parser_only_tickers_registered(self):
    """collect_customer_docs.PARSER_ONLY_TICKERS(목록 수집 대상)가 실제 파서 등록부와 어긋나지 않는다."""
    if not customer_parsers.modules():
      self.skipTest('파서 0개(Task 6) — Task 7 부터 검사')
    import importlib.util
    p = pathlib.Path(__file__).resolve().parents[1] / 'collect_customer_docs.py'
    spec = importlib.util.spec_from_file_location('ccd', p)
    ccd = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ccd)
    self.assertLessEqual(set(ccd.PARSER_ONLY_TICKERS), customer_parsers.parser_tickers())
```

- [ ] **Step 5: 오케스트레이터 `scripts/collect_customer_numbers.py`**

```python
"""고객사 문서 «내용» → 숫자. 순서: 자가 시험(exit 2) → pending 문서(오래된 것부터) → 내용 1회 받기 →
회사 파서 → (llm 칸만) LLM → 인용·숫자 대조 → 적재 → 가이던스 방향 재계산 → 상태 기록.
exit 0 정상 · 1 새 문서인데 숫자 0개(파싱 실패) 1건 이상 · 2 자가 시험 실패.
사용: collect_customer_numbers.py [--company TICKER] [--no-llm] [--reparse DOC_ID] [--dry-run]
     collect_customer_numbers.py --company TICKER --add-file PDF --url URL --doc-type fact_sheet --title T --published YYYY-MM-DD
       (사이트가 브라우저 내려받기만 받아 주는 소급 문서를 로컬 파일로 넣는다 — 문서 행을 만들고 그 내용으로 바로 파싱)
"""
import argparse
import hashlib
import sys

import requests

from lib.bootstrap import init_script


def self_tests() -> list[str]:
  import customer_parsers
  from lib import guidance_direction, quote_check
  errs = [f'quote_check: {e}' for e in quote_check.self_test()]
  errs += [f'guidance_direction: {e}' for e in guidance_direction.self_test()]
  for m in customer_parsers.modules():
    errs += [f'{m.__name__}: {e}' for e in m.self_test()]
  return errs


def fetch_content(session, doc, company, local: bytes | None = None):
  """출처별로 내용을 한 번만 받는다 → (Content, sha256). local = --add-file 로 넘긴 파일 바이트(PDF 만)."""
  from customer_parsers.base import Content
  from lib import dart_api, edgar
  from lib.doc_text import html_to_table_rows, html_to_text, pdf_text
  if local is not None:
    if local[:5] != b'%PDF-':
      raise ValueError('--add-file 은 PDF 만 받는다')
    return Content(pdf_text(local), [], local), hashlib.sha256(local).hexdigest()
  if doc.source == 'edgar':
    base = doc.url.rsplit('/', 1)[0]
    idx = edgar.edgar_get(session, f'{base}/index.json').json()
    texts, tables, raw = [], [], b''
    for name in edgar.filing_htm_names(idx, doc.url.rsplit('/', 1)[1]):
      b = edgar.edgar_get(session, f'{base}/{name}').content
      h = b.decode('utf-8', errors='replace')
      raw += b
      texts.append(html_to_text(h))
      tables += html_to_table_rows(h)
    return Content('\n'.join(texts), tables, raw), hashlib.sha256(raw).hexdigest()
  if doc.source == 'dart':
    text = dart_api.document_text(session, doc.source_id)
    return Content(text), hashlib.sha256(text.encode()).hexdigest()
  r = session.get(doc.url, timeout=60)
  r.raise_for_status()
  b = r.content
  if b[:5] == b'%PDF-':
    return Content(pdf_text(b), [], b), hashlib.sha256(b).hexdigest()
  # requests 는 charset 없는 text/* 에 ISO-8859-1 을 준다 → '€' 가 깨져 VW·포르쉐 정규식이 조용히 0건 → 머리에 charset 이 없으면 추정값
  enc = r.encoding if 'charset=' in r.headers.get('content-type', '').lower() else (r.apparent_encoding or 'utf-8')
  h = b.decode(enc, errors='replace')
  return Content(html_to_text(h), html_to_table_rows(h), b), hashlib.sha256(b).hexdigest()
```

`base.Doc.id` 는 DB id, `Doc.source_id` 는 출처 ID(accession·접수번호). 본문(`main`)의 규칙:

1. `errs = self_tests()` → 있으면 한 줄씩 찍고 `return 2`(DB 접근 전).
   - `--add-file`: 파일을 읽어 `customer_documents` 에 1행 upsert(`source='ir'` · `source_id` = URL 경로 · `url`·`title`·`doc_type`·`published_at` = 인자 · `sha256` = 파일 · 충돌 `source,source_id`) → 그 문서만 `local=` 바이트로 아래 3~9를 탄다. `--published` 는 지어내지 않는다 — 문서에 날짜가 없으면 같은 회사의 해당 연간 실적 6-K 공시일(`customer_documents`)을 조회해 넣는다. 이 문서를 나중에 `--reparse` 하면 HTTP 로 다시 받다가 막힐 수 있다(그때는 `--add-file` 로 다시).
2. `pending` 문서를 `(published_at, id)` 오름차순으로 — 같은 칸을 여러 문서가 내면 «나중 공시»가 마지막 upsert 가 되게(정정공시·전월 수정 = 최신 공시로 덮고 `source_ref` 에 접수번호).
3. 문서마다: `mod = module_for(ticker)` 없거나 `wants` 거짓 → `not_target`. 내용 받기 실패(HTTP 403) → `customer_collect_status(parse)=blocked` 후 다음 문서(문서는 `pending` 그대로 — 다음 실행에서 다시).
4. `res = mod.parse(doc, content)` · `llm_wants` 가 참이고 `--no-llm` 이 아니면 `res.guidance += llm_guidance.extract(...)`(Task 11 · `extractor='llm'`).
5. 대조 전에 `res.dedupe()`(코드 행을 먼저, LLM 행을 뒤에 넣었으므로 같은 키면 코드 우선) · `check_vocab(res)` 가 비지 않으면 그 문서는 `failed`(`parse_note='어휘 밖: …'` — DB CHECK 오류를 미리 막는다). 값 행(물량·실적·가이던스)은 `quote_check.check_row(row, content.text)`, 일정 행은 `quote_check.check_date_row` → `verified`·`verify_note`(일정 표에는 verified 칸이 없으므로 통과한 일정만 적재). 🔴 표 행 quote 는 `' | '.join` 이라 원문 글(`html_to_text`)과 셀 사이 공백만 다르다 — 대조 원문은 `content.text`(시제품 실측: 실물 문서 110행 · 어휘·값·일정 대조 실패 0).
6. 판정(이 순서): `not res.recognized` → `not_target` · `res.count()==0` → `failed`(`'새 문서인데 숫자 0개'`) · 값 행 0 + 검증된 일정 ≥1 → `parsed`(일정 전용 문서 — 국내 IR 개최 공시·스텔란티스 예고 6-K · 「검증 0행 실패」에서 뺀다) · 값 행이 있는데 `verified` 0 → `failed`(`'대조 통과 0'`) · 그 밖 `parsed`.
7. 적재(`WriteSession`) — 🔴 문서 1건 = 표마다 upsert 1회(dedupe 뒤라 한 요청 안 PK 중복 없음 — 겹치면 Postgres 가 'cannot affect row a second time' 으로 그 문서를 통째로 거절한다. 국내 전월 행처럼 «문서 사이» 겹침은 아래 «나중 공시 우선»으로): 물량 `customer_volume_ir`(충돌 `company_id,metric,region,period_grain,period`) · 실적 `customer_reported_results`(충돌 `company_id,period_grain,period,metric`) — 🔴 둘 다 기존 행이 더 «나중 공시»면 건너뛴다(백필을 다시 돌려도 최신값이 옛 값에 덮이지 않게 · 반대로 소급 공표처럼 «나중» 문서가 오면 그 칸이 회사 새 값으로 바뀐다) · 일정 `customer_earnings_dates` · 가이던스 `customer_guidance`(충돌 `document_id,metric,period`). 행에는 `document_id`·`source`(`edgar`/`dart`/`ir`)·`source_ref`(accession·접수번호)·`published_at`(문서 공시일).
8. 회사마다 끝에 방향 재계산: 그 회사의 `verified` 가이던스 전부 → `guidance_direction.assign` → 바뀐 행만 `update({'direction': …}).eq('id', …)`.
9. `customer_collect_status(company, 'parse')`: 실패 0 → `ok` · 실패 n → `parse_failed`(사유 「새 문서 n건에서 숫자를 못 뽑음(파서 점검 필요)」). Task 3 의 공용 `write_status`(payload 에 `checked_at` 매번)로.
10. 출력은 회사·문서 건수·행수만(금액 금지 — 공개 수치여도 습관을 지킨다).

- [ ] **Step 6: 시험 실행** — Run: `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_guidance_direction.py scripts/lib/test_customer_parsers.py -q` → PASS(파서 0개라 빈 반복).

- [ ] **Step 7: Commit** — `git add scripts/customer_parsers/__init__.py scripts/customer_parsers/base.py scripts/customer_parsers/common.py scripts/lib/guidance_direction.py scripts/lib/test_guidance_direction.py scripts/lib/test_customer_parsers.py scripts/collect_customer_numbers.py Architecture.md` · `git commit -m "feat(고객사): 파서 규약·가이던스 방향 판정·숫자 수집 오케스트레이터"`

---

### Task 7: 국내 4곳 — DART 규칙 파서 `kr_dart.py`

**Files:** Create `scripts/customer_parsers/kr_dart.py` · Modify `scripts/customer_parsers/__init__.py`(`MODULE_NAMES` 에 `'kr_dart'`)

**뽑는 것:** 월 판매(현대 국내·해외·계 / 기아 내수·해외·특수·계 / KGM 내수·수출·CKD·총계 — 당월·전월, 부분 합 ≠ 계면 0행으로 실패 처리) · 잠정실적(매출·영업이익·순이익·지배주주 순이익 — 단위 환산, 별도면 이름에 「(별도)」) · 전망 공시(연간 판매 목표 · 매출 성장률 · 영업이익률 목표 · 매출·영업이익 목표(조원) · 투자) · IR 개최 공시의 「N분기 경영실적 발표」 일시.

**MUST*HIT(원문 그대로 — 모듈 안 `MUST_HIT*\*`):** 현대 `구분(단위:대,%) 당기실적 (2026년10월) 전기실적 (2026년9월)` 머리 · 기아 `구분 (단위:대,%) 당기실적 ('26.10월) 전기실적 ('26.9월)` · KGM `구분 (단위: 대, %) 당기실적 (2026년 10월) 전기실적 (2026년 09월)` · 기아 구서식 `판매대수(내수) 38,403 46,070 -16.6 44,608 -13.9`(20250203800774) · 현대 3Q26 연결 매출 45,110,247 백만원(20261029800228) · KGM 3Q26 별도 9,941억원 → 994,100 백만원 · 현대 정정 전망 공시에서 4,158,300 이 아니라 **4,000,000**.
**MUST_MISS:** 중장기 「9+α%」 · 기아 2028·2030 재무 목표(연간 가이던스 아님) · 비거래 IR(NDR) 공시(20261104800225).

- [ ] **Step 1: 시험 실패 확인** — `__init__.py` 에 `'kr_dart'` 를 먼저 넣고 `pytest scripts/lib/test_customer_parsers.py -q` → FAIL(ModuleNotFoundError).

- [ ] **Step 2: 구현**(시제품 — 실물 13건 기대값 일치)

```python
# scripts/customer_parsers/kr_dart.py
"""국내 상장 4사 DART 공정공시 파서 — 월 판매 · 분기 잠정실적 · 연간 가이던스 서식 · IR 개최 일정.

출처·표본 = 참고/고객사/research/korea.md(2026-11-09 실측) + 계획서 phase2 Task 7 의 채록분.
본문은 lib.dart_api.document_text(태그 제거·공백 한 칸) 결과를 읽는다.

함정(실측):
  - 1월분 월 판매는 표가 하나(누계 표 없음) → 「다음 표 머리까지」가 아니라 「2. 정보제공」 앞까지 자른다.
  - 2025년분 서식엔 「실적기간」 줄이 없다 → 기간은 「당기실적 (2026년10월)」·「('26.10월)」 머리에서 읽는다.
  - 정정공시는 정정 전 값이 먼저 나온다 → 정정사항 표 «뒤»의 서식만 읽는다(가이던스는 마지막 매치).
  - KGM 은 월 판매와 분기 실적이 같은 제목 → 본문 「단위:대」 표가 있으면 판매, 「매출액 당해실적 <숫자>」면 실적.
  - 모비스는 월 판매 공시가 없다(부품사) — 분기 잠정실적·IR 일정만.
"""
import re

from customer_parsers.base import (
  Content, Doc, EarningsDate, GuidanceRow, ParseResult, ResultRow, VolumeRow,
)

TICKERS = ('005380', '000270', '003620', '012330')

# (지역 키, 공시 행 라벨) — 순서대로 찾는다(합계 라벨 「계」 가 다른 행 이름 안에 있어서).
SALES_LABELS = {
  '005380': [('domestic', '국내'), ('overseas', '해외'), ('total', '계')],
  '000270': [('domestic', '판매대수(내수)'), ('overseas', '판매대수(해외)'),
             ('special', '판매대수(특수)'), ('total', '계')],
  '003620': [('domestic', '내수'), ('export', '수출'), ('ckd', 'CKD'), ('total', '총계')],
}
SALES_DEFINITION = '회사 발표 월 판매(도매·출고 기준) — DART 영업(잠정)실적 공정공시'

_SALES_HEAD = re.compile(r'구분\s*\(단위\s*:\s*대')
_SALES_PERIOD = re.compile(r"당기실적\s*\((?:(\d{4})년\s*|'(\d{2})\.)(\d{1,2})월\)")
_UNIT = re.compile(r'단위\s*:\s*(백만원|억원|천원)')
_TO_MILLION = {'백만원': 1.0, '억원': 100.0, '천원': 0.001}
_RESULT_PERIOD = re.compile(r'당기실적\s+(\d{4})-(\d{2})-\d{2}\s*~\s*(\d{4})-(\d{2})-\d{2}')
_RESULT_PERIOD_OLD = re.compile(r'\((\d{4})년\s*([1-4])분기\)')
RESULT_ITEMS = [
  ('revenue', '매출액'),
  ('operating_income', '영업이익'),
  ('net_income', '당기순이익'),
  ('net_income_parent', '지배기업 소유주지분 순이익'),
]

G_SALES_FORM = re.compile(r'(\d{4})년 판매목표\(대수\)\s+(\d[\d,]*)\s+-')
G_SALES_PLAN = re.compile(r'(\d{4})년 판매목표\s*:\s*(\d+(?:\.\d+)?)만\s*대')
G_REV_GROWTH = re.compile(
  r'(\d{4})년 연결 기준 매출액 성장률\(전년대비\)\s*:\s*(-?\d+(?:\.\d+)?)\s*~\s*(-?\d+(?:\.\d+)?)\s*%')
G_OPM = re.compile(r'영업이익률 목표\s*:\s*(\d+(?:\.\d+)?)(?:\s*~\s*(\d+(?:\.\d+)?))?\s*%')
G_REV_TARGET = re.compile(r'매출액 목표\s*:\s*(\d+(?:\.\d+)?)\s*조원')
G_OP_TARGET = re.compile(r'영업이익 목표\s*:\s*(\d+(?:\.\d+)?)\s*조원')
G_CAPEX = re.compile(r'(\d{4})년 투자계획\s*:\s*(\d+(?:\.\d+)?)\s*조원')

_IR = re.compile(
  r'일시\s+(\d{4}-\d{2}-\d{2})\s+(?:\d{2}:\d{2}|--:--).{0,200}?개최목적\s+(\d{4})년\s*([1-4])분기\s*경영실적\s*발표')


def wants(doc: Doc) -> bool:
  return doc.source == 'dart' and doc.doc_type in (
    'prelim_results', 'earnings_release', 'guidance', 'ir_event')


def _int(s: str) -> int:
  return int(s.replace(',', ''))


def _after_correction(text: str) -> int:
  """정정공시면 정정사항 표가 끝난 뒤(서식 본문)부터 읽는다. 아니면 0."""
  i = text.find('정정사항')
  return 0 if i < 0 else i


def _shift_month(ym: str, delta: int) -> str:
  y, m = map(int, ym.split('-'))
  m += delta
  while m < 1:
    y, m = y - 1, m + 12
  return f'{y}-{m:02d}'


def sales_period(text: str) -> str | None:
  m = _SALES_PERIOD.search(text)
  if not m:
    return None
  year = int(m.group(1)) if m.group(1) else 2000 + int(m.group(2))
  return f'{year}-{int(m.group(3)):02d}'


def parse_sales(ticker: str, text: str) -> tuple[list[VolumeRow], bool]:
  """월 판매 → (행, 서식을 알아봤나). 당기·전기 두 달을 같이 낸다(전월 값은 다음 공시에서 바뀐다 — 최신으로 덮는다)."""
  labels = SALES_LABELS.get(ticker)
  base = _after_correction(text)
  head = _SALES_HEAD.search(text, base)
  if labels is None or head is None:
    return [], False
  start = head.start()
  end = text.find('2. 정보제공', start)
  sec = text[start:end if end > 0 else len(text)]
  period = sales_period(sec) or sales_period(text)
  if period is None:
    return [], True
  cur: dict[str, int] = {}
  prev: dict[str, int] = {}
  quotes: dict[str, str] = {}
  pos = 0
  for key, label in labels:
    m = re.compile(r'(?:^|\s)' + re.escape(label) + r'\s+(-?\d[\d,]*)\s+(-?\d[\d,]*)').search(sec, pos)
    if not m:
      return [], True
    cur[key], prev[key] = _int(m.group(1)), _int(m.group(2))
    quotes[key] = m.group(0).strip()
    pos = m.end()
  parts = [k for k, _ in labels if k != 'total']
  for col in (cur, prev):
    if sum(col[k] for k in parts) != col['total']:
      return [], True  # 검산 실패 = 표 구조가 바뀌었다
  rows = []
  for p, col in ((period, cur), (_shift_month(period, -1), prev)):
    for key, _ in labels:
      rows.append(VolumeRow('sales', key, 'month', p, col[key], SALES_DEFINITION, quotes[key]))
  return rows, True


def parse_results(text: str) -> tuple[list[ResultRow], bool]:
  """분기 잠정실적(연결 또는 별도) → 백만원 환산 행."""
  base = _after_correction(text)
  body = text[base:]
  unit = _UNIT.search(body)
  first = re.search(r'(?:^|\s)매출액\s+당해실적\s+(-?\d[\d,]*)', body)
  if not first or not unit:
    return [], False
  m = _RESULT_PERIOD.search(body)
  if m and int(m.group(1)) == int(m.group(3)) and int(m.group(4)) - int(m.group(2)) == 2:
    period = f'{m.group(3)}-Q{int(m.group(4)) // 3}'
  else:
    old = _RESULT_PERIOD_OLD.search(body)
    if not old:
      return [], True
    period = f'{old.group(1)}-Q{old.group(2)}'
  factor = _TO_MILLION[unit.group(1)]
  # 본문 앞머리는 xforms CSS 라 앞부분만 보면 안 된다(실측: 현대 연결 공시를 별도로 오판).
  separate = '별도 재무제표' in body or '연결' not in body
  rows = []
  for metric, label in RESULT_ITEMS:
    r = re.search(r'(?:^|\s)' + re.escape(label) + r'\s+당해실적\s+(-?\d[\d,]*)', body)
    if not r:
      continue
    rows.append(ResultRow(
      metric=metric, metric_name=label + (' (별도)' if separate else ''), basis='reported',
      period_grain='quarter', period=period, value=_int(r.group(1)) * factor,
      unit='million', currency='KRW', quote=r.group(0).strip()))
  return rows, True


def _year_before(text: str, pos: int, window: int = 80) -> str | None:
  hits = re.findall(r'(\d{4})년', text[max(0, pos - window):pos])
  return hits[-1] if hits else None


def _last(rx: re.Pattern, text: str):
  found = list(rx.finditer(text))
  return found[-1] if found else None


def parse_guidance(text: str) -> tuple[list[GuidanceRow], bool]:
  """연간 가이던스 서식(전망 공시·장래사업). 정정공시는 마지막 서식이 정정 후 값이다."""
  out: list[GuidanceRow] = []
  m = _last(G_SALES_FORM, text)
  if m:
    v = _int(m.group(2))
    out.append(GuidanceRow('sales_units', '판매목표(대수)', f'FY{m.group(1)}', v, v, None, 'units', None,
                           m.group(0).rstrip(' -').strip()))
  m = _last(G_SALES_PLAN, text)
  if m:
    v = round(float(m.group(2)) * 10_000)
    out.append(GuidanceRow('sales_units', '판매목표', f'FY{m.group(1)}', v, v, None, 'units', None, m.group(0)))
  m = _last(G_REV_GROWTH, text)
  if m:
    out.append(GuidanceRow('revenue_growth', '연결 기준 매출액 성장률(전년대비)', f'FY{m.group(1)}',
                           float(m.group(2)), float(m.group(3)), None, 'percent', 'reported', m.group(0)))
  for rx, metric, label, unit in (
    (G_OPM, 'operating_margin', '영업이익률 목표', 'percent'),
    (G_REV_TARGET, 'revenue', '매출액 목표', 'trillion'),
    (G_OP_TARGET, 'operating_income', '영업이익 목표', 'trillion'),
  ):
    m = _last(rx, text)
    if not m:
      continue
    year = _year_before(text, m.start())
    if year is None:
      continue
    low = float(m.group(1))
    high = float(m.group(2)) if m.lastindex and m.lastindex >= 2 and m.group(2) else low
    out.append(GuidanceRow(metric, label, f'FY{year}', low, high, None, unit,
                           'reported' if '연결 기준' in text[max(0, m.start() - 40):m.start()] else None,  # 연결 여부는 label 로
                           m.group(0)))
  m = _last(G_CAPEX, text)
  if m:
    v = float(m.group(2))
    out.append(GuidanceRow('capex', '투자계획', f'FY{m.group(1)}', v, v, None, 'trillion', None, m.group(0)))
  return out, bool(out) or '판매목표' in text or '사업계획' in text


def parse_ir_date(text: str) -> tuple[list[EarningsDate], bool]:
  """IR 개최 안내공시 → 실적 발표일. NDR·컨퍼런스(개최목적에 「분기 경영실적 발표」 없음)는 건너뛴다."""
  m = _IR.search(text)
  if not m:
    return [], False
  return [EarningsDate(f'{m.group(2)}-Q{m.group(3)}', m.group(1), m.group(0))], True


def parse(doc: Doc, content: Content) -> ParseResult:
  text = content.text
  res = ParseResult()
  if doc.doc_type == 'ir_event':
    res.dates, res.recognized = parse_ir_date(text)
    return res
  if doc.doc_type == 'guidance':
    res.guidance, res.recognized = parse_guidance(text)
    return res
  res.volume, sales_ok = parse_sales(doc.ticker, text)
  res.results, results_ok = parse_results(text)
  res.recognized = sales_ok or results_ok
  return res


# ---------------------------------------------------------------- 자가 시험
# 행 값 = korea.md 표본 원문 그대로. 앞의 표 머리(「구분 (단위…) 당기실적 (…)」)는 같은 공시 본문에서 그대로 옮겼다
# (2026-11-09 채록: 현대 20261102800520·20250203800835 · 기아 20261102800493 · KGM 20261102800582).
# 🔴 머리 띄어쓰기가 회사마다 다르다 — 현대 `구분(단위:대,%)` · 기아 `구분 (단위:대,%)` · KGM `구분 (단위: 대, %)`·`(2026년 10월)`.
_HEAD_2610 = '구분(단위:대,%) 당기실적 (2026년10월) 전기실적 (2026년9월) 전기대비 증감율(%) 흑자적자전환여부 전년동기실적 (2025년10월) 전년동기 대비 증감율(%) 흑자적자전환여부 '
MUST_HIT_SALES = [
  ('005380', _HEAD_2610 + '국내 49,042 49,022 0.04 - 53,822 -8.9 - 해외 280,731 261,026 7.5 - 298,261 -5.9 - 계 329,773 310,048 6.4 - 352,083 -6.3 -',
   {('2026-10', 'domestic'): 49042, ('2026-10', 'overseas'): 280731, ('2026-10', 'total'): 329773,
    ('2026-09', 'overseas'): 261026}),
  ('005380', '구분(단위:대,%) 당기실적 (2025년1월) 전기실적 (2024년12월) 전기대비 증감율(%) 전년동기실적 (2024년1월) 전년동기 대비증감율(%) ' + '국내 46,054 61,323 -24.9 49,810 -7.5 해외 264,345 268,967 -1.7 268,013 -1.4 계 310,399 330,290 -6.0 317,823 -2.3',
   {('2025-01', 'total'): 310399, ('2024-12', 'overseas'): 268967}),
  ('000270', "구분 (단위:대,%) 당기실적 ('26.10월) 전기실적 ('26.9월) 전기대비 증감율 (%) - 전년동기실적 ('25.10월) 전년동기대비 증감율 (%) - " + '판매대수(내수) 51,007 45,705 +11.6 - 40,001 +27.5 - 판매대수(해외) 239,308 236,125 +1.3 - 223,215 +7.2 - 판매대수(특수) 904 745 +21.3 - 801 +12.9 - 계 291,219 282,575 +3.1 - 264,017 +10.3 -',
   {('2026-10', 'domestic'): 51007, ('2026-10', 'special'): 904, ('2026-10', 'total'): 291219}),
  ('003620', '구분 (단위: 대, %) 당기실적 (2026년 10월) 전기실적 (2026년 09월) 전기 대비 증감율 (%) - 전년동기 실적 (2025년 10월) 전년동기대비 증감율(%) - ' + '내수 2,037 2,100 -3.0% - 3,537 -42.4% - 수출 4,440 6,703 -33.8% - 5,980 -25.8% - 완성차 계 6,477 8,803 -26.4% - 9,517 -31.9% - CKD 60 60 0.0% - 0 - - 총계 6,537 8,863 -26.2% - 9,517 -31.3% -',
   {('2026-10', 'export'): 4440, ('2026-10', 'ckd'): 60, ('2026-10', 'total'): 6537}),
]
# DART 20261029800228(현대 3Q26 연결) · 20261104800215(KGM 3Q26 별도·억원) 본문에서 그대로 옮김(2026-11-09 채록).
MUST_HIT_RESULTS = [
  ('연결재무제표 기준 영업(잠정)실적(공정공시) 실적기간 당기실적 2026-07-01 ~ 2026-09-30 전기실적 2026-04-01 ~ 2026-06-30 '
   '1. 연결실적내용 단위 : 백만원, % 구분 당기실적 전기실적 전기대비 전년동기실적 전년동기대비 (2026년 3분기) (2026년 2분기) '
   '증감율(%) 흑자적자전환여부 (2025년 3분기) 증감율(%) 흑자적자전환여부 매출액 당해실적 45,110,247 49,215,328 -8.3 - '
   '46,721,448 -3.4 - 누계실적 140,264,461 - - - 139,415,886 0.6 - 영업이익 당해실적 2,677,232 2,850,888 -6.1 - '
   '2,537,266 5.5 -',
   {('revenue', '2026-Q3'): 45110247.0, ('operating_income', '2026-Q3'): 2677232.0}),
  ('영업(잠정)실적(공정공시) 실적기간 당기실적 2026-07-01 ~ 2026-09-30 전기실적 2026-04-01 ~ 2026-06-30 1. 실적내용 '
   '단위 : 억원, % 구분 당기실적 전기실적 전기대비 전년동기실적 전년동기대비 (2026년 3분기) (2026년 2분기) 증감율(%) '
   '흑자적자전환여부 (2025년 3분기) 증감율(%) 흑자적자전환여부 매출액 당해실적 9,941 11,823 -15.9 - 11,889 -16.4 - '
   '누계실적 33,129 - - - 31,321 5.8 - 영업이익 당해실적 -298 88 - 적자전환 30 - 적자전환 '
   '- 상기 실적은 한국채택국제회계기준(K-IFRS)에 따라 작성된 별도 재무제표로',
   {('revenue', '2026-Q3'): 994100.0, ('operating_income', '2026-Q3'): -29800.0}),
]
MUST_HIT_GUIDANCE = [
  # 20260129800348 (현대 장래사업, 2026-01-29) — korea.md 표본
  ('·2026년 판매목표 : 416만대 ·2026년 연결 기준 매출액 성장률(전년대비) : 1.0 ~ 2.0% 수준 ·2026년 연결 기준 영업이익률 목표 : 6.3 ~ 7.3% 수준 ·2026년 투자계획 : 17.8조원',
   {('sales_units', 'FY2026'): (4160000, 4160000), ('revenue_growth', 'FY2026'): (1.0, 2.0),
    ('operating_margin', 'FY2026'): (6.3, 7.3), ('capex', 'FY2026'): (17.8, 17.8)}),
  # 20261029800240 (현대 전망 정정, 2026-10-29) — 정정사항 표(정정전 4,158,300) 뒤 서식이 정정후 4,000,000
  ('4. 정정사항 정정항목 정정전 정정후 2026년 판매목표(대수) 4,158,300 4,000,000 2026년 판매목표(대수)-국내 700,000 664,000 '
   '2026년 판매목표(대수)-해외 3,458,300 3,336,000 ※ 관련공시 - 2026-01-05 영업실적 등에 대한 전망(공정공시) - '
   '영업실적 등에 대한 전망(공정공시) ※ 동 정보는 예측정보로서 향후 실제 결과와는 다를 수 있음 1. 영업실적 전망 내용 '
   '구분(단위 : 억원) 2026 사업연도 2027 사업연도 2028 사업연도 대상기간 시작일 - - - 종료일 - - - 매출액 - - - '
   '영업이익 - - - 법인세비용차감전계속사업이익 - - - 당기순이익 - - - 2026년 판매목표(대수) 4,000,000 - - -국내 664,000 - - -해외 3,336,000 - -',
   {('sales_units', 'FY2026'): (4000000, 4000000)}),
  # 20260105800035 (기아 전망, 2026-01-05) · 20260128800332 (기아 사업계획, 2026-01-28) — korea.md 표본
  ('2026년 판매목표(대수) 3,350,000 - - - 국내 565,000 - - - 해외 2,775,000 - - - 특수사업 10,000 - -',
   {('sales_units', 'FY2026'): (3350000, 3350000)}),
  ('◎ 2026년 손익 사업계획 · 매출액 목표 : 122.3조원 · 영업이익 목표 : 10.2조원 · 영업이익률 목표 : 8.3%',
   {('revenue', 'FY2026'): (122.3, 122.3), ('operating_income', 'FY2026'): (10.2, 10.2),
    ('operating_margin', 'FY2026'): (8.3, 8.3)}),
]
# 코드가 뽑으면 안 되는 문구 — 중장기 목표(LLM 몫)·NDR 일정
MUST_MISS_GUIDANCE = [
  '중장기(2030년) 영업이익률 목표 : 9+α%',                                  # 20260826800246 현대 Investor Day
  '재무 목표 1. 매출액 2028년 : 150조원 2030년 : 170조원 2. 영업이익 / 영업이익률 2028년 : 13.5조원 / 9% 2030년 : 17.0조원 / 10%',  # 20260409800576 기아
]
MUST_HIT_IR = [
  ('1. 일시 및 장소 일시 2026-10-29 14:10 장소 - 2. 참가 대상자 기관 투자가 및 애널리스트 3. 개최목적 2026년 3분기 경영실적발표 4.',
   ('2026-Q3', '2026-10-29')),   # 20261022800377 현대
  ('1. 일시 및 장소 일시 2026-10-30 --:-- 장소 서울 2. 참가 대상자 애널리스트, 기관투자자, 언론 外 3. 개최목적 2026년 3분기 경영실적 발표',
   ('2026-Q3', '2026-10-30')),   # 20261014800271 기아 — 시각이 --:--
]
MUST_MISS_IR = [
  '1. 일시 및 장소 일시 2026-11-04 09:00 장소 유럽/미국/아시아 2. 참가 대상자 해외 주요 기관 투자가 3. 개최목적 해외지역 방문 IR',  # 20261104800225 NDR
]


def self_test() -> list[str]:
  errs = []
  for ticker, text, want in MUST_HIT_SALES:
    rows, ok = parse_sales(ticker, text)
    got = {(r.period, r.region): r.value for r in rows}
    for k, v in want.items():
      if got.get(k) != v:
        errs.append(f'kr_dart 월 판매 {ticker} {k}: {got.get(k)} ≠ {v}')
  for (text, want), name in zip(MUST_HIT_RESULTS, ('매출액', '매출액 (별도)')):
    rows, _ = parse_results(text)
    got = {(r.metric, r.period): r.value for r in rows}
    for k, v in want.items():
      if got.get(k) != v:
        errs.append(f'kr_dart 분기 실적 {k}: {got.get(k)} ≠ {v}')
    names = {r.metric_name for r in rows if r.metric == 'revenue'}
    if names != {name}:
      errs.append(f'kr_dart 연결/별도 판정: {names} ≠ {name}')
  for text, want in MUST_HIT_GUIDANCE:
    rows, _ = parse_guidance(text)
    got = {(r.metric, r.period): (r.low, r.high) for r in rows}
    for k, v in want.items():
      if got.get(k) != v:
        errs.append(f'kr_dart 가이던스 {k}: {got.get(k)} ≠ {v}')
  for text in MUST_MISS_GUIDANCE:
    rows, _ = parse_guidance(text)
    if rows:
      errs.append(f'kr_dart 가이던스 오탐: {text[:40]} → {rows}')
  for text, (period, day) in MUST_HIT_IR:
    rows, _ = parse_ir_date(text)
    if not rows or (rows[0].period, rows[0].event_date) != (period, day):
      errs.append(f'kr_dart IR 일정 놓침: {text[:50]}')
  for text in MUST_MISS_IR:
    if parse_ir_date(text)[0]:
      errs.append(f'kr_dart IR 일정 오탐: {text[:50]}')
  return errs
```

- [ ] **Step 3: PASS** → 실물 1회: `scripts/venv/Scripts/python.exe scripts/collect_customer_numbers.py --company 005380 --dry-run` → Expected: prelim_results 문서마다 volume 6행(국내·해외·계 × 당월·전월) · 실패 0.

- [ ] **Step 4: 기존 표와 대조(1회 · 읽기만)** — 같은 달 `hyundai_sales`·`kia_sales`·`kg_mobility_sales` 합계와 `customer_volume_ir`(region total)를 SQL 로 맞대 본다. 다르면 정의 차이(공장 판매 vs 도매 등)인지 원문으로 확인해 `definition` 문구에 적는다 — 기존 표는 고치지 않는다.

- [ ] **Step 5: Commit** — `git add scripts/customer_parsers/kr_dart.py scripts/customer_parsers/__init__.py` · `git commit -m "feat(고객사): 국내 DART 월 판매·잠정실적·전망·IR 일정 파서"`

---

### Task 8: 미국 ① — GM · 리비안 · 폴라리스

**Files:** Create `scripts/customer_parsers/{gm,rivian,polaris}.py` · Modify `__init__.py`(3줄)

- **GM**
  - MUST_HIT: `Revenue | $ | 50,015` · `EBIT-adjusted | $ | 4,106` · 전망 `EBIT-adjusted | $14.5 billion - $15.5 billion | $14.0 billion - $16.0 billion`(앞 칸) · 4분기 판 `Final 2025 Guidance | 2025 Results | 2026 Guidance` 의 셋째 칸 · 도매 `Total | 1,028 | 977 | 2,917 | 2,862`
  - MUST_MISS: `GMNA EBIT-adjusted`(부문) · `Previous` 칸만 있는 표 · `Total fleet sales` 표
- **리비안**
  - MUST_HIT: 5분기 표 `Production | … | 19,751` · `Adjusted EBITDA (non-GAAP) 1 | … | (435)` · 손익 `Loss from operations | (983) | (881)`(전년이 앞 → 둘째) · `Current Outlook` · `2026 Annual Guidance Summary` · 문장 `reaffirming its 2026 delivery range guidance of 65,000 - 70,000` · `raising its full year 2026 delivery guidance from 62,000 - 67,000 vehicles, to 65,000 - 70,000` · 일정 `on October 29, 2026, after market close, it will release its third quarter 2026 financial results` · `on February 12th, 2026 … fourth quarter and full year 2025`
  - MUST_MISS: `the launch of R2 in the second quarter of 2026`(일정 아님)
- **폴라리스**
  - MUST_HIT: `Quarter ended September 30, 2026 | Reported | … | Adjusted*` 표 · `Operating income (loss) | 73.4` · `now expects 2026 adjusted sales to be between $7.55 billion to $7.60 billion versus prior guidance of $7.30 billion to $7.50 billion`(앞 범위) · `expects 2026 sales to be up one to three percent` · `adjusted diluted EPS … to be between $1.50 and $1.60`
  - MUST_MISS: 하이라이트 글머리표(절 밖) · 10-14 잠정실적의 «분기» 전망 `third quarter adjusted EPS to be in the range of $0.31 to $0.41`

- [ ] **Step 1: `__init__` 3줄 → FAIL 확인**
- [ ] **Step 2: 구현**(시제품 — 3분기 실물 EX-99.1 로 실행 확인)

```python
# scripts/customer_parsers/gm.py
"""GM — EDGAR 8-K 2.02 의 EX-99.1(실적 보도자료) 표에서 실적·도매 판매·가이던스를 뽑는다.

표 3종을 머리 행으로 알아본다(표 번호는 분기마다 바뀐다):
- 실적 요약: 머리 행 첫 칸 '($M) except per share amounts' · 둘째 칸 분기말 날짜
- 도매 판매: 행 라벨이 정확히 GMNA·GMI·Total 인 표(대수 천 대 · fleet 표는 'Total fleet sales' 라 빠진다)
- 가이던스: 머리 행에 'Updated 2026 guidance' 또는 '2027 Guidance'(4분기 판) 칸이 있는 표
"""
import re

from customer_parsers.base import (Doc, Content, ParseResult, ResultRow, VolumeRow, GuidanceRow,
                                   numeric_cells, to_number)
from customer_parsers.common import quarter_from_date_text, parse_range
from lib.doc_text import norm_text, row_text

TICKERS = ('GM',)
WHOLESALE_DEF = ('GM 도매 판매(wholesale): 딜러·유통사·미국 정부에 넘긴 대수, 합작사(중국 등) 판매 제외. '
                 '천 대 단위 발표(합계는 반올림으로 지역 합과 1천 대까지 어긋날 수 있다)')
RESULT_ROWS = (  # (라벨 정규식, metric, basis, unit)
  (r'Revenue$', 'revenue', 'reported', 'million'),
  (r'Net income \(loss\) attributable to stockholders', 'net_income_parent', 'reported', 'million'),
  (r'EBIT-adjusted$', 'ebit_adjusted', 'adjusted', 'million'),
  (r'EPS-diluted-adjusted$', 'eps_adjusted', 'adjusted', 'per_share'),
)
GUIDANCE_ROWS = (  # (라벨 정규식, metric, 단위)
  (r'EBIT-adjusted$', 'ebit_adjusted', 'billion'),
  (r'Adjusted automotive free cash flow$', 'adjusted_automotive_fcf', 'billion'),
  (r'EPS-diluted-adjusted$', 'eps_adjusted', 'per_share'),
)
_GUIDE_HEAD = re.compile(r'^(?:Updated |Initial )?(20\d{2}) [Gg]uidance$')


def wants(doc: Doc) -> bool:
  # 8-K 7.01(분기 중 전망 수정 · 2025-05-01 실측)도 같은 전망 표가 있으면 읽는다
  return doc.source == 'edgar' and doc.doc_type in ('earnings_release', 'current_report')


def _label(row: list[str]) -> str:
  return re.sub(r'\(\w\)$', '', norm_text(row[0])).strip()


def parse_results(tables) -> list[ResultRow]:
  for rows in tables:
    head = next((r for r in rows[:3] if norm_text(r[0]).startswith('($M) except per share')), None)
    if not head or len(head) < 2:
      continue
    period = quarter_from_date_text(head[1])
    out = []
    for row in rows:
      for rx, metric, basis, unit in RESULT_ROWS:
        nums = numeric_cells(row)
        if re.match(rx, _label(row)) and nums:
          out.append(ResultRow(metric, _label(row), basis, 'quarter', period, nums[0], unit, 'USD',
                               row_text(row)))
    if out:
      return out
  return []


def parse_operating_income(tables, period: str) -> list[ResultRow]:
  """연결 손익 표('Three Months Ended …' 머리)의 Operating income 행 — Combined 열(넷째 숫자)."""
  for rows in tables:
    if not rows or not norm_text(rows[0][0]).startswith('Three Months Ended'):
      continue
    if len(rows) < 2 or 'Combined' not in rows[1]:
      continue
    for row in rows:
      if _label(row) == 'Operating income (loss)':
        # '—' 는 빈 부문(0)이라 칸 위치를 지키려고 남기고 '$' 칸만 뺀다 → 넷째 칸이 Combined
        cells = [c for c in row[1:] if norm_text(c) != '$']
        # 🔴 norm_text 는 '—' 를 '-' 로 바꾼다 — 빈 칸 판정은 정규화 «전» 원문으로
        v = 0.0 if len(cells) >= 4 and cells[3].strip() in ('—', '–', '-') else (to_number(cells[3]) if len(cells) >= 4 else None)
        if v is not None:
          return [ResultRow('operating_income', 'Operating income (loss)', 'reported', 'quarter', period,
                            v, 'million', 'USD', row_text(row))]
  return []


def parse_wholesale(tables) -> list[VolumeRow]:
  for rows in tables:
    labels = {_label(r): r for r in rows if r}
    if not {'GMNA', 'GMI', 'Total'} <= labels.keys():
      continue
    head = next((r for r in rows[:3] if quarter_from_date_text(r[0])), None)
    if not head:
      continue
    period = quarter_from_date_text(head[0])
    year, q = period.split('-Q')
    months = int(q) * 3
    ytd_grain, ytd_period = ('year', year) if months == 12 else ('ytd', f'{year}-{months}M')
    out = []
    for name, region in (('GMNA', 'north_america'), ('GMI', 'international'), ('Total', 'total')):
      nums = numeric_cells(labels[name])
      if len(nums) < 3:
        continue
      out.append(VolumeRow('wholesale', region, 'quarter', period, round(nums[0] * 1000), WHOLESALE_DEF,
                           row_text(labels[name])))
      out.append(VolumeRow('wholesale', region, ytd_grain, ytd_period, round(nums[2] * 1000), WHOLESALE_DEF,
                           row_text(labels[name])))
    return out
  return []


def parse_guidance(tables) -> list[GuidanceRow]:
  for rows in tables:
    head = rows[0] if rows else []
    col = next((i for i, c in enumerate(head) if _GUIDE_HEAD.match(norm_text(c))), None)
    if col is None:
      continue
    year = _GUIDE_HEAD.match(norm_text(head[col])).group(1)
    out = []
    for row in rows[1:]:
      if len(row) != len(head) + 1:
        continue
      for rx, metric, unit in GUIDANCE_ROWS:
        if re.match(rx, _label(row)):
          rng = parse_range(row[col + 1])
          if rng:
            out.append(GuidanceRow(metric, _label(row), f'FY{year}', rng[0], rng[1], None, unit, 'adjusted',
                                   row_text(row)))
    if out:
      return out
  return []


def parse(doc: Doc, content: Content) -> ParseResult:
  r = ParseResult()
  r.results = parse_results(content.tables)
  if r.results:
    r.results += parse_operating_income(content.tables, r.results[0].period)
  r.volume = parse_wholesale(content.tables)
  r.guidance = parse_guidance(content.tables)
  r.recognized = bool(r.results or r.guidance)  # 전망 표만 있는 7.01 도 대상
  return r


# ---------------------------------------------------------------- 자가 시험(2026-11-09 실물 EX-99.1 원문 행)
MUST_HIT = [
  ([[['Three Months Ended'],
     ['($M) except per share amounts', 'September 30, 2026', 'September 30, 2025', 'Change', '% Change'],
     ['Revenue', '$', '50,015', '$', '48,591', '$', '1,424', '2.9', '%'],
     ['Net income (loss) attributable to stockholders(a)', '$', '3,335', '$', '1,327', '$', '2,008', 'n.m.'],
     ['EBIT-adjusted', '$', '4,106', '$', '3,376', '$', '730', '21.6', '%'],
     ['EBIT-adjusted margin', '8.2', '%', '6.9', '%', '1.3 ppts', '18.8', '%'],
     ['EPS-diluted-adjusted', '$', '3.70', '$', '2.80', '$', '0.90', '32.2', '%']],
    [['Three Months Ended September 30, 2026', 'Three Months Ended September 30, 2025'],
     ['Automotive', 'GM Financial', 'Reclassifications/Eliminations', 'Combined', 'Automotive', 'Cruise', 'GM Financial',
      'Reclassifications/Eliminations', 'Combined'],
     ['Operating income (loss)', '2,938', '660', '—', '3,598', '281', '—', '795', '—', '1,076']],
    [['Updated 2026 guidance', 'Previous 2026 guidance'],
     ['EBIT-adjusted', '$14.5 billion - $15.5 billion', '$14.0 billion - $16.0 billion'],
     ['Adjusted automotive free cash flow', '$11.5 billion - $12.5 billion', '$9.5 billion - $11.5 billion'],
     ['EPS-diluted-adjusted', '$12.75 - $13.75', '$12.00 - $14.00']],
    [['Three Months Ended', 'Nine Months Ended'],
     ['September 30, 2026', 'September 30, 2025', 'September 30, 2026', 'September 30, 2025'],
     ['GMNA', '870', '840', '2,511', '2,516'],
     ['GMI', '159', '137', '407', '346'],
     ['Total', '1,028', '977', '2,917', '2,862']],
    [['Three Months Ended', 'Nine Months Ended'],
     ['September 30, 2026', 'September 30, 2025', 'September 30, 2026', 'September 30, 2025'],
     ['GMNA', '160', '148', '551', '498'],
     ['GMI', '107', '113', '302', '277'],
     ['Total fleet sales', '267', '261', '853', '775']]],
   {('R', 'revenue', '2026-Q3'): 50015.0, ('R', 'operating_income', '2026-Q3'): 3598.0, ('R', 'net_income_parent', '2026-Q3'): 3335.0,
    ('R', 'ebit_adjusted', '2026-Q3'): 4106.0, ('R', 'eps_adjusted', '2026-Q3'): 3.70,
    ('G', 'ebit_adjusted', 'FY2026'): (14.5, 15.5), ('G', 'adjusted_automotive_fcf', 'FY2026'): (11.5, 12.5),
    ('G', 'eps_adjusted', 'FY2026'): (12.75, 13.75),
    ('V', 'total', '2026-Q3'): 1028000, ('V', 'north_america', '2026-Q3'): 870000,
    ('V', 'total', '2026-9M'): 2917000}),
  # Combined 칸 자체가 '—'(빈 부문 = 0)인 행 — 정규화 뒤 비교면 조용히 [] 였다(2026-11-09 대조 지적)
  ([[['($M) except per share amounts', 'September 30, 2026', 'September 30, 2025'],
     ['Revenue', '$', '50,015', '$', '48,591']],
    [['Three Months Ended September 30, 2026'], ['Automotive', 'GM Financial', 'Reclassifications/Eliminations', 'Combined'],
     ['Operating income (loss)', '—', '—', '—', '—']]],
   {('R', 'operating_income', '2026-Q3'): 0.0}),
  # 전망 표만 있는 8-K 7.01(2025-05-01 실물 머리) — recognized 여야 not_target 으로 버려지지 않는다
  ([[['Updated 2025 Guidance', 'Previous 2025 Guidance'],
     ['EBIT-adjusted', '$10.0 billion - $12.5 billion', '$13.7 billion - $15.7 billion']]],
   {('G', 'ebit_adjusted', 'FY2025'): (10.0, 12.5)}),
  # 4분기 판 머리(2026-01 실물): 'Final 2025 Guidance | 2025 Results | 2026 Guidance' — 셋째 칸이 새 해 전망
  ([[['Final 2025 Guidance', '2025 Results', '2026 Guidance'],
     ['EBIT-adjusted', '$12.0 billion - $13.0 billion', '$12.7 billion', '$13.0 billion - $15.0 billion']]],
   {('G', 'ebit_adjusted', 'FY2026'): (13.0, 15.0)}),
]
MUST_MISS = [
  # 실적 요약의 'GMNA EBIT-adjusted' 행은 부문 값이라 회사 전체 칸에 들어가면 안 된다
  ([[['($M) except per share amounts', 'September 30, 2026', 'September 30, 2025'],
     ['GMNA EBIT-adjusted', '$', '3,592', '$', '2,506', '$', '1,087', '43.4', '%']]], ('R', 'ebit_adjusted')),
  # 'Previous' 칸만 있는 표는 전망이 아니다
  ([[['Previous 2026 guidance'], ['EBIT-adjusted', '$14.0 billion - $16.0 billion']]], ('G', 'ebit_adjusted')),
  # fleet 표(합계 라벨이 'Total fleet sales')는 도매 판매가 아니다
  ([[['Three Months Ended', 'Nine Months Ended'], ['September 30, 2026', 'September 30, 2025'],
     ['GMNA', '160', '148', '551', '498'], ['GMI', '107', '113', '302', '277'],
     ['Total fleet sales', '267', '261', '853', '775']]], ('V', 'total')),
]


def _flatten(r: ParseResult) -> dict:
  out = {}
  for x in r.results:
    out[('R', x.metric, x.period)] = x.value
  for x in r.guidance:
    out[('G', x.metric, x.period)] = (x.low, x.high)
  for x in r.volume:
    out[('V', x.region, x.period)] = x.value
  return out


def self_test() -> list[str]:
  errs = []
  doc = Doc(0, 'test', 'GM', 'edgar', 'earnings_release', '8-K', '2.02', '', '', '2026-10-20')
  for tables, want in MUST_HIT:
    got = _flatten(parse(doc, Content(text='', tables=tables)))
    for k, v in want.items():
      if got.get(k) != v:
        errs.append(f'MUST_HIT {k}: 기대 {v} · 실제 {got.get(k)}')
  for tables, key in MUST_MISS:
    got = _flatten(parse(doc, Content(text='', tables=tables)))
    if any(k[:2] == key for k in got):
      errs.append(f'MUST_MISS {key} 가 뽑혔다')
  return errs
```

```python
# scripts/customer_parsers/rivian.py
"""리비안 — EDGAR 8-K 의 실적 보도자료(EX-99.1 표) + 분기 생산·인도 보도자료(문장).

- 실적: 5개 분기 나란히 표('Three Months Ended' 머리 · 맨 오른쪽 = 이번 분기)의 Production·Delivery·
  Total revenues·Adjusted EBITDA, 손익계산서(머리 '2025 | 2026 | 2025 | 2026' — 전년이 앞)의 Loss from operations
- 가이던스: 'Current Outlook' · '2026 Annual Guidance Summary' · '2026 Guidance' 표
- 생산·인도 보도자료: 'produced N vehicles … delivered M vehicles' 문장 · 인도 가이던스 문장 · 실적 발표일 문장
"""
import re

from customer_parsers.base import (Doc, Content, ParseResult, ResultRow, VolumeRow, GuidanceRow, EarningsDate,
                                   numeric_cells, month_name_date, QUARTER_WORDS)
from customer_parsers.common import quarter_from_date_text, parse_range, dedupe_first
from lib.doc_text import norm_text, row_text

TICKERS = ('RIVN',)
DEF = {'production': '리비안 생산: 일리노이 노멀 공장 생산 대수(회사 발표)',
       'deliveries': '리비안 인도: 고객 인도 대수(회사 발표)'}
_GUIDE_HEAD = re.compile(r'^(?:Current Outlook|(20\d{2}) (?:Annual )?Guidance(?: Summary)?)$', re.I)
GUIDANCE_ROWS = ((r'Vehicles Delivered$', 'deliveries', 'units', None),
                 (r'Adj(?:usted|\.) EBITDA$', 'adjusted_ebitda', 'billion', 'adjusted'),
                 (r'Capital Expenditures$', 'capex', 'billion', None))
_MONTH = r'(January|February|March|April|May|June|July|August|September|October|November|December)'
_PD = re.compile(r'quarter (?:and year )?ending ' + _MONTH + r' (\d{1,2}), (\d{4})\. The company produced ([\d,]+) '
                 r'vehicles .{0,80}?delivered ([\d,]+) vehicles')
_PD_YEAR = re.compile(r'For the full year (20\d{2}), Rivian produced ([\d,]+) vehicles and delivered ([\d,]+) vehicles')
_G_SENT = re.compile(r'(reaffirm\w*|rais\w*|lower\w*|reduc\w*|updat\w*) its (?:full[- ]year )?(20\d{2}) delivery '
                     r'(?:range )?guidance (?:of |from [\d,]+ ?- ?[\d,]+(?: vehicles)?,? to )([\d,]+) ?(?:-|to) ?([\d,]+)')
_STATED = {'reaffirm': 'maintained', 'rais': 'raised', 'lower': 'lowered', 'reduc': 'lowered'}
_DATE = re.compile(r'on ' + _MONTH + r' (\d{1,2})(?:st|nd|rd|th)?, (\d{4}), after market close, it will release its '
                   r'(first|second|third|fourth) quarter (?:and full year )?(\d{4}) financial results')


def wants(doc: Doc) -> bool:
  return doc.source == 'edgar' and doc.doc_type in ('earnings_release', 'sales_release', 'current_report')


def _label(row):
  return re.sub(r'\s*\d$', '', norm_text(row[0])).strip()  # 'Adjusted EBITDA (non-GAAP) 1' 의 각주 번호


def parse_quarter_table(tables) -> tuple[list[VolumeRow], list[ResultRow]]:
  for rows in tables:
    if len(rows) < 3 or norm_text(rows[0][0]) != 'Three Months Ended':
      continue
    dates = rows[1]
    if len(dates) < 2 or not all(quarter_from_date_text(c) for c in dates):
      continue
    period = quarter_from_date_text(dates[-1])
    vol, res = [], []
    for row in rows[2:]:
      nums = numeric_cells(row)
      if len(nums) != len(dates):
        continue
      lab = _label(row)
      if lab in ('Production', 'Delivery'):
        metric = 'production' if lab == 'Production' else 'deliveries'
        vol.append(VolumeRow(metric, 'total', 'quarter', period, round(nums[-1]), DEF[metric], row_text(row)))
      elif lab == 'Total revenues':
        res.append(ResultRow('revenue', 'Total revenues', 'reported', 'quarter', period, nums[-1], 'million', 'USD',
                             row_text(row)))
      elif lab == 'Adjusted EBITDA (non-GAAP)':
        res.append(ResultRow('adjusted_ebitda', 'Adjusted EBITDA', 'adjusted', 'quarter', period, nums[-1],
                             'million', 'USD', row_text(row)))
    return vol, res
  return [], []


def parse_operating(tables, period: str) -> list[ResultRow]:
  year = int(period[:4])
  for rows in tables:
    if len(rows) < 3 or not norm_text(rows[0][0]).startswith('Three Months Ended'):
      continue
    if rows[1][:2] != [str(year - 1), str(year)]:  # 전년이 앞 — 둘째 숫자가 이번 분기
      continue
    for row in rows:
      if _label(row) == 'Loss from operations':
        nums = numeric_cells(row)
        if len(nums) >= 2:
          return [ResultRow('operating_income', 'Loss from operations', 'reported', 'quarter', period, nums[1],
                            'million', 'USD', row_text(row))]
  return []


def parse_guidance_table(tables, default_year: str) -> list[GuidanceRow]:
  for rows in tables:
    m = _GUIDE_HEAD.match(norm_text(rows[0][0])) if rows and rows[0] else None
    if not m:
      continue
    year = m.group(1) or default_year
    out = []
    for row in rows[1:]:
      if len(row) < 2:
        continue
      for rx, metric, unit, basis in GUIDANCE_ROWS:
        if re.match(rx, _label(row)):
          cell = norm_text(row[1]).replace(' billion', 'B')
          rng = parse_range(cell)
          if rng:
            out.append(GuidanceRow(metric, _label(row), f'FY{year}', rng[0], rng[1], None, unit, basis,
                                   row_text(row)))
    if out:
      return out
  return []


def parse_text(text: str) -> ParseResult:
  r = ParseResult()
  t = norm_text(text)
  for m in _PD.finditer(t):
    period = quarter_from_date_text(f'{m.group(1)} {m.group(2)}, {m.group(3)}')
    r.volume.append(VolumeRow('production', 'total', 'quarter', period, int(m.group(4).replace(',', '')),
                              DEF['production'], m.group(0)))
    r.volume.append(VolumeRow('deliveries', 'total', 'quarter', period, int(m.group(5).replace(',', '')),
                              DEF['deliveries'], m.group(0)))
  for m in _PD_YEAR.finditer(t):
    r.volume.append(VolumeRow('production', 'total', 'year', m.group(1), int(m.group(2).replace(',', '')),
                              DEF['production'], m.group(0)))
    r.volume.append(VolumeRow('deliveries', 'total', 'year', m.group(1), int(m.group(3).replace(',', '')),
                              DEF['deliveries'], m.group(0)))
  for m in _G_SENT.finditer(t):
    stated = next((v for k, v in _STATED.items() if m.group(1).lower().startswith(k)), None)
    r.guidance.append(GuidanceRow('deliveries', 'Vehicles Delivered', f'FY{m.group(2)}',
                                  float(m.group(3).replace(',', '')), float(m.group(4).replace(',', '')),
                                  None, 'units', None, m.group(0), stated))
  for m in _DATE.finditer(t):
    q = QUARTER_WORDS[m.group(4).lower()]
    r.dates.append(EarningsDate(f'{m.group(5)}-Q{q}',month_name_date(m.group(1), m.group(2), m.group(3)),
                                m.group(0)))
  r.recognized = bool(r.volume or r.guidance or r.dates)
  return r


def parse(doc: Doc, content: Content) -> ParseResult:
  r = ParseResult()
  vol, res = parse_quarter_table(content.tables)
  r.volume, r.results = vol, res
  if res:
    r.results += parse_operating(content.tables, res[0].period)
    r.guidance = parse_guidance_table(content.tables, res[0].period[:4])
    r.recognized = True
  r.extend(parse_text(content.text))
  r.volume = dedupe_first(r.volume, lambda v: (v.metric, v.period))
  r.guidance = dedupe_first(r.guidance, lambda g: (g.metric, g.period))
  return r


# ---------------------------------------------------------------- 자가 시험(2026 실물 원문)
Q3_TABLES = [
  [['Three Months Ended'],
   ['September 30, 2025', 'December 31, 2025', 'March 31, 2026', 'June 30, 2026', 'September 30, 2026'],
   ['Production', '10,720', '10,974', '10,236', '12,613', '19,751'],
   ['Delivery', '13,201', '9,745', '10,365', '12,194', '19,248'],
   ['Total revenues', '$', '1,558', '$', '1,286', '$', '1,381', '$', '1,658', '$', '2,155'],
   ['Adjusted EBITDA (non-GAAP) 1', '$', '(602)', '$', '(465)', '$', '(472)', '$', '(379)', '$', '(435)']],
  [['Three Months Ended September 30,', 'Nine Months Ended September 30,'], ['2025', '2026', '2025', '2026'],
   ['Loss from operations', '(983)', '(881)', '(2,752)', '(2,598)']],
  [['Current Outlook'], ['Vehicles Delivered', '67,000 – 70,000'], ['Adjusted EBITDA', '$(1.85)B – $(1.75)B'],
   ['Capital Expenditures', '$1.40B – $1.50B']],
]
MUST_HIT = [
  (Q3_TABLES, '', {('V', 'production', '2026-Q3'): 19751, ('V', 'deliveries', '2026-Q3'): 19248,
                   ('R', 'revenue', '2026-Q3'): 2155.0, ('R', 'adjusted_ebitda', '2026-Q3'): -435.0,
                   ('R', 'operating_income', '2026-Q3'): -881.0,
                   ('G', 'deliveries', 'FY2026'): (67000.0, 70000.0),
                   ('G', 'adjusted_ebitda', 'FY2026'): (-1.85, -1.75), ('G', 'capex', 'FY2026'): (1.40, 1.50)}),
  ([[['2026 Annual Guidance Summary'], ['Vehicles Delivered', '62,000 - 67,000'],
     ['Adj. EBITDA', '$(2.10) billion - $(1.80) billion']]],
   '', {}),  # 실적 표가 없는 문서 조각이면 표 전망은 안 뽑는다(아래 4분기 본문 시험이 따로 있다)
  ([], 'today announced production and delivery totals for the quarter ending September 30, 2026. The company '
       'produced 19,751 vehicles at its manufacturing facility in Normal, Illinois and delivered 19,248 vehicles '
       'during the same period. Production and delivery results for the quarter are in line with Rivian\'s outlook. '
       'The company is reaffirming its 2026 delivery range guidance of 65,000 - 70,000. The company also announced '
       'that on October 29, 2026, after market close, it will release its third quarter 2026 financial results.',
   {('V', 'production', '2026-Q3'): 19751, ('V', 'deliveries', '2026-Q3'): 19248,
    ('G', 'deliveries', 'FY2026'): (65000.0, 70000.0), ('D', '2026-Q3'): '2026-10-29',
    ('S', 'deliveries'): 'maintained'}),
  ([], 'the company is today raising its full year 2026 delivery guidance from 62,000 - 67,000 vehicles, to '
       '65,000 - 70,000.', {('G', 'deliveries', 'FY2026'): (65000.0, 70000.0), ('S', 'deliveries'): 'raised'}),
  ([], 'For the full year 2025, Rivian produced 42,284 vehicles and delivered 42,247 vehicles. The company also '
       'announced that on February 12th, 2026, after market close, it will release its fourth quarter and full year '
       '2025 financial results.',
   {('V', 'production', '2025'): 42284, ('V', 'deliveries', '2025'): 42247, ('D', '2025-Q4'): '2026-02-12'}),
]
MUST_MISS = [
  # 사업 설명 속 'R2 출시는 2026년 2분기' 는 실적 발표일이 아니다
  ([], 'in preparation for the launch of R2 in the second quarter of 2026.', 'D'),
]


def _flatten(r: ParseResult) -> dict:
  out = {}
  for x in r.volume:
    out[('V', x.metric, x.period)] = x.value
  for x in r.results:
    out[('R', x.metric, x.period)] = x.value
  for x in r.guidance:
    out[('G', x.metric, x.period)] = (x.low, x.high)
    if x.stated:
      out[('S', x.metric)] = x.stated
  for x in r.dates:
    out[('D', x.period)] = x.event_date
  return out


def self_test() -> list[str]:
  errs = []
  doc = Doc(0, 'test', 'RIVN', 'edgar', 'earnings_release', '8-K', '2.02', '', '', '2026-10-29')
  for tables, text, want in MUST_HIT:
    got = _flatten(parse(doc, Content(text=text, tables=tables)))
    for k, v in want.items():
      if got.get(k) != v:
        errs.append(f'MUST_HIT {k}: 기대 {v} · 실제 {got.get(k)}')
  for tables, text, kind in MUST_MISS:
    got = _flatten(parse(doc, Content(text=text, tables=tables)))
    if any(k[0] == kind for k in got):
      errs.append(f'MUST_MISS {kind} 가 뽑혔다: {got}')
  return errs
```

```python
# scripts/customer_parsers/polaris.py
"""폴라리스 — EDGAR 8-K 2.02 EX-99.1. 실적은 표, 가이던스는 '20XX BUSINESS OUTLOOK' 절의 문장.

- 실적 요약 표: 머리 'Quarter ended <날짜> | Reported | YOY % Chg. | Adjusted* | YOY % Chg.'
  (퍼센트 셀은 numeric_cells 가 건너뛰므로 숫자 두 개 = 장부상·조정)
- 손익계산서: 머리 '2026 | 2025 | 2026 | 2025'(이번 해가 앞)의 Operating income (loss)
- 물량: 폴라리스는 대수를 발표하지 않는다 → 물량 없음(파서가 만들지 않는다)
"""
import re

from customer_parsers.base import Doc, Content, ParseResult, ResultRow, GuidanceRow, numeric_cells
from customer_parsers.common import quarter_from_date_text, word_or_number, year_before
from lib.doc_text import norm_text, row_text

TICKERS = ('PII',)
_HEAD = re.compile(r'^Quarter ended (.+\d{4})$')
_STATED = re.compile(r'The Company is (raising|reaffirming|lowering|reducing|updating) (20\d{2}) full year', re.I)
_STATED_MAP = {'raising': 'raised', 'reaffirming': 'maintained', 'lowering': 'lowered', 'reducing': 'lowered'}
_G = (
  (re.compile(r'expects (20\d{2}) adjusted sales to be between \$([\d.]+) billion (?:to|and) \$([\d.]+) billion'),
   'adjusted_sales', 'Adjusted sales', 'billion'),
  (re.compile(r'expects adjusted (?:diluted )?EPS (?:attributed to Polaris Inc\. common stockholders )?'
              r'(?:of|to be between) \$([\d.]+) (?:to|and) \$([\d.]+)'),
   'eps_adjusted', 'Adjusted EPS', 'per_share'),
  (re.compile(r'expects (20\d{2}) sales to be up (\w+) to (\w+) percent'), 'revenue_growth', 'Sales growth', 'percent'),
)


def wants(doc: Doc) -> bool:
  return doc.source == 'edgar' and doc.doc_type == 'earnings_release'


def parse_results(tables) -> list[ResultRow]:
  for rows in tables:
    head = next((r for r in rows[:3] if _HEAD.match(norm_text(r[0]))), None)
    if not head or 'Reported' not in head or not any(c.startswith('Adjusted') for c in head):
      continue
    period = quarter_from_date_text(head[0])
    out = []
    for row in rows:
      lab, nums = norm_text(row[0]), numeric_cells(row)
      if len(nums) != 2:
        continue
      if lab == 'Sales':
        out += [ResultRow('revenue', 'Sales', 'reported', 'quarter', period, nums[0], 'million', 'USD', row_text(row)),
                ResultRow('adjusted_sales', 'Adjusted sales', 'adjusted', 'quarter', period, nums[1], 'million', 'USD',
                          row_text(row))]
      elif lab == 'Diluted EPS attributable to Polaris':
        out.append(ResultRow('eps_adjusted', 'Adjusted EPS', 'adjusted', 'quarter', period, nums[1], 'per_share',
                             'USD', row_text(row)))
    if out:
      return out
  return []


def parse_operating(tables, period: str) -> list[ResultRow]:
  y = period[:4]
  for rows in tables:
    if not any(r[:2] == [y, str(int(y) - 1)] for r in rows[:5]):
      continue
    for row in rows:
      if norm_text(row[0]) == 'Operating income (loss)':
        nums = numeric_cells(row)
        if nums:
          return [ResultRow('operating_income', 'Operating income (loss)', 'reported', 'quarter', period, nums[0],
                            'million', 'USD', row_text(row))]
  return []


def parse_guidance(text: str) -> list[GuidanceRow]:
  t = norm_text(text)
  start = t.find('BUSINESS OUTLOOK')  # 하이라이트 줄·CEO 말·잠정실적 문장은 보지 않는다
  if start < 0:
    return []
  sect = t[start:start + 1500]
  sm = _STATED.search(sect)
  stated = _STATED_MAP.get(sm.group(1).lower()) if sm else None
  default_year = re.match(r'BUSINESS OUTLOOK', sect) and year_before(t, start + 20, r'(20\d{2}) BUSINESS OUTLOOK', 30)
  out = []
  for rx, metric, label, unit in _G:
    m = rx.search(sect)
    if not m:
      continue
    g = m.groups()
    year, lo, hi = (g[0], g[1], g[2]) if len(g) == 3 else (default_year, g[0], g[1])
    out.append(GuidanceRow(metric, label, f'FY{year}', word_or_number(lo), word_or_number(hi), None, unit, 'adjusted'
                           if metric != 'revenue_growth' else 'reported', m.group(0), stated))
  return out


def parse(doc: Doc, content: Content) -> ParseResult:
  r = ParseResult()
  r.results = parse_results(content.tables)
  if r.results:
    r.results += parse_operating(content.tables, r.results[0].period)
  r.guidance = parse_guidance(content.text)
  r.recognized = bool(r.results)
  return r


# ---------------------------------------------------------------- 자가 시험(2026 실물 원문)
MUST_HIT = [
  ([[['(in millions, except per share data)'],
     ['Quarter ended September 30, 2026', 'Reported', 'YOY % Chg.', 'Adjusted*', 'YOY % Chg.'],
     ['Sales', '$', '2,042.6', '11%', '$', '2,041.8', '11%'],
     ['Diluted EPS attributable to Polaris', '$', '0.66', 'NM', '$', '1.08', '163%']],
    [['Three months ended September 30,', 'Nine months ended September 30,'], ['2026', '2025', '2026', '2025'],
     ['Operating income (loss)', '73.4', '20.4', '183.1', '(28.6)']]],
   '2026 BUSINESS OUTLOOK The Company is raising 2026 full year adjusted sales and adjusted EPS guidance. The Company '
   'now expects 2026 adjusted sales to be between $7.55 billion to $7.60 billion versus prior guidance of $7.30 '
   'billion to $7.50 billion. The Company now expects adjusted EPS of $3.50 to $3.60 versus prior guidance of $3.00 '
   'to $3.10, of which approximately $1.09 is attributed to the benefit of tariff refunds',
   {('R', 'revenue', '2026-Q3'): 2042.6, ('R', 'adjusted_sales', '2026-Q3'): 2041.8,
    ('R', 'eps_adjusted', '2026-Q3'): 1.08, ('R', 'operating_income', '2026-Q3'): 73.4,
    ('G', 'adjusted_sales', 'FY2026'): (7.55, 7.60), ('G', 'eps_adjusted', 'FY2026'): (3.50, 3.60),
    ('S', 'eps_adjusted'): 'raised'}),
  ([], '2026 BUSINESS OUTLOOK The Company expects 2026 sales to be up one to three percent versus 2025. The Company '
       'expects adjusted diluted EPS attributed to Polaris Inc. common stockholders to be between $1.50 and $1.60, '
       'relative to ($0.01) in 2025.',
   {('G', 'revenue_growth', 'FY2026'): (1.0, 3.0), ('G', 'eps_adjusted', 'FY2026'): (1.50, 1.60)}),
  ([], '2026 BUSINESS OUTLOOK The Company is reaffirming 2026 full year adjusted sales and adjusted EPS guidance. The '
       'Company expects 2026 adjusted sales to be between $7.15 billion to $7.30 billion and adjusted EPS of $1.60 to '
       '$1.70.', {('G', 'adjusted_sales', 'FY2026'): (7.15, 7.30), ('S', 'adjusted_sales'): 'maintained'}),
]
MUST_MISS = [
  # 하이라이트 줄(본문 'BUSINESS OUTLOOK' 절 밖)은 같은 값을 되풀이할 뿐 — 절 밖에서는 뽑지 않는다
  ([], '• Polaris is raising full year 2026 guidance to adjusted EPS of $3.50 to $3.60 from $3.00 to $3.10.', 'G'),
  # 10-14 잠정실적 보도자료의 '분기' 전망 범위는 연간 가이던스가 아니다
  ([], 'we expect third quarter sales to be at the high end of our previously issued guidance range of $1.6 billion to '
       '$1.8 billion. We anticipate third quarter adjusted EPS to be in the range of $0.31 to $0.41', 'G'),
]


def _flatten(r: ParseResult) -> dict:
  out = {}
  for x in r.results:
    out[('R', x.metric, x.period)] = x.value
  for x in r.guidance:
    out[('G', x.metric, x.period)] = (x.low, x.high)
    if x.stated:
      out[('S', x.metric)] = x.stated
  return out


def self_test() -> list[str]:
  errs = []
  doc = Doc(0, 'test', 'PII', 'edgar', 'earnings_release', '8-K', '2.02', '', '', '2026-10-27')
  for tables, text, want in MUST_HIT:
    got = _flatten(parse(doc, Content(text=text, tables=tables)))
    for k, v in want.items():
      if got.get(k) != v:
        errs.append(f'MUST_HIT {k}: 기대 {v} · 실제 {got.get(k)}')
  for tables, text, kind in MUST_MISS:
    got = _flatten(parse(doc, Content(text=text, tables=tables)))
    if any(k[0] == kind for k in got):
      errs.append(f'MUST_MISS {kind} 가 뽑혔다: {got}')
  return errs
```

- [ ] **Step 3: 실물 회귀(2년 백필)** — Run: `scripts/venv/Scripts/python.exe scripts/collect_customer_numbers.py --company GM --no-llm` 뒤 `select parse_status, count(*) from customer_documents where company_id=… group by 1` → Expected: earnings_release 는 전부 `parsed`, `failed` 0. 실패가 나오면 그 문서의 표 머리를 `parse_note` 로 보고 **MUST_HIT 에 실물 행을 더한 뒤** 고친다(고치고 나서 표본을 넣지 않는다).
  - GM 8-K 7.01(분기 중 전망 수정 — 2025-05-01 `Updated 2025 Guidance | Previous 2025 Guidance` 실측): 시제품 `wants` 가 `current_report` 를 포함하고 `recognized = bool(results or guidance)` 다(전망 표만 있는 7.01 이 `not_target` 으로 버려지지 않게 · MUST_HIT 에 그 머리 1건). 전망 표도 실적 표도 없으면 `recognized=False`(not_target).
- [ ] **Step 4: Commit** — `git add scripts/customer_parsers/gm.py scripts/customer_parsers/rivian.py scripts/customer_parsers/polaris.py scripts/customer_parsers/__init__.py` · `git commit -m "feat(고객사): GM·리비안·폴라리스 실적·물량·전망 파서"`

---

### Task 9: 미국 ② — 빈패스트(자동차만) · 스텔란티스

**Files:** Create `scripts/customer_parsers/{vinfast,stellantis}.py` · Modify `__init__.py` · `scripts/collect_stellantis_shipments_ir.py` · `scripts/lib/test_stellantis_shipments_ir.py`

스텔란티스 2025 분기 이익(선택 7차): 당일 Q1·Q3 보도자료·발표자료·팩트시트엔 이익이 없고, 2026-02 연간 발표 때 낸 소급 PDF `https://www.stellantis.com/content/dam/stellantis-corporate/investors/events-and-presentations/other-documents/Financial-Fact-Sheet-Expanded-Quarterly-Reporting-for-2025-and-Segment-Reclassification-for-2025-and-2024.pdf` 3쪽(IFRS 손익표)·4쪽(조정 손익표)에 있다. 파서 `parse_factsheet`(아래 시제품)가 `doc_type='fact_sheet'` 문서를 읽는다.

🔴 **빈패스트는 자동차만**(사용자 지시 2026-11-09). 전기 이륜차 수치는 수집·표시하지 않는다.

- **빈패스트**
  - MUST_HIT: `The Company delivered 82,580 electric vehicles (“EVs”) globally in the third quarter of 2026` · `in the first nine months of 2026, VinFast delivered 211,242 EVs to customers globally` · `domestic Vietnam deliveries of 23,624 electric vehicles (“EVs”) for September 2026` · 표 `EV Deliveries 1 | 70,085 | 58,577 | 35,837` · `EV deliveries were 70,085 in the second quarter of 2026` · `Total Revenues | 30,340,852`(VND 백만)
  - MUST_MISS: 🔴 이륜차 `VinFast also delivered 284,831 e-scooters and e-bikes globally during the third quarter of 2026 …` · `… VinFast delivered 714,006 e-scooters and e-bikes globally …` · `E-scooter and e-bike deliveries were 286,039 in the second quarter of 2026 …` · 표 `E-scooter & E-bike Deliveries | 286,039 | 143,136 | 69,580` · 모델별 `the VF 3 and Limo Green were the best-selling models, with deliveries of 21,744 and 19,100 vehicles`
- **스텔란티스**
  - MUST_HIT: 머리 `€ million / 000's units | Q3 2026 | Q3 2025 | Change | YTD 2026 | …` · `I F R S | Net revenues | 37,611` · `Net profit/(loss) | (453)` · `N O N - G A A P | Adjusted operating income/(loss) (1) | 256` · `Consolidated shipments (6) | 1,286 | … | 4,244` · 상자 `FY 2026 FINANCIAL GUIDANCE Net revenues: Mid-Single Digit % Increase AOI margin % (2) : Low-Single Digit % Industrial free cash flows (3) : Improved Y-o-Y` · 일정 `will release its Third Quarter 2026 Financial Results on Wednesday, October 28, 2026`
  - MUST_MISS: `Adjusted operating income margin (2) | 0.7%`(비율 행) · `Expect positive Industrial free cash flows (3) in 2027`(FY2027 칸 금지)
  - 소급 팩트시트 `FS_HIT`(실물 PDF 줄 그대로 · 백만 유로): Q1 AOI 327 · 영업이익 −316 · 순이익 −387 / Q2 213 · −2,394 · −1,869 / Q3 90 · −2,455 · −2,068 / 상반기 540 · −2,710 · −2,256 · Q1 매출 35,813 · 연간 영업이익 −26,254. 검산 시험 Q1+Q2 = H1(상반기 발표값) 세 지표 · 파서 안에서도 Q1+Q2=H1 · Q3+Q4=H2 · H1+H2=FY(±1) 가 어긋난 지표는 버린다.
  - 소급 팩트시트 MUST_MISS: 비율 행 `Adjusted operating income/(loss) margin (%)` 이 AOI 칸에 섞이지 않는다(Q4 AOI = −1,472 그대로) · 영업이익 Q2 를 −2,400 으로 바꾼 글은 영업이익 행이 통째로 빠진다 · 머리 끝 7칸(`Q1 '25 … FY '25`)이 없는 PDF 는 `recognized=False`. 🔴 앞 해 열도 같은 7칸 꼴(`Q1 '24 … FY '24` 뒤에 `as reported`)이라 «첫» 자리를 잡으면 2025 값이 2024 칸에 들어간다(시제품에서 실제로 났다) — 바로 다음 줄이 머리 칸이 아닌 자리만 인정.

- [ ] **Step 1: `__init__` 2줄 → FAIL 확인**
- [ ] **Step 2: 구현**(시제품)

```python
# scripts/customer_parsers/vinfast.py
"""빈패스트 — EDGAR 6-K(본문 htm·EX-99.1). 🔴 자동차(EV)만 다룬다 — 전기 이륜차(e-scooter·e-bike) 수치는
수집·표시하지 않는다(사용자 지시 2026-11-09). 문장·표 모두 'electric vehicles ("EVs")'·'EV Deliveries' 라벨만 잡고,
이륜차 문장·행은 MUST_MISS 로 못 박는다.

- 분기 인도(6-K 잠정): 'The Company delivered N electric vehicles ("EVs") globally in the third quarter of 2026'
- 누적(같은 문서): 'in the first nine months of 2026, VinFast delivered N EVs to customers globally'
- 베트남 월 인도(6-K): 'preliminary domestic Vietnam deliveries of N electric vehicles ("EVs") for September 2026'
- 실적 보도자료 표: 머리 '2Q2026 | 1Q2026 | 2Q2025' 의 'EV Deliveries' · 'Total Revenues'(VND 백만)
- 영업손실: 표 머리가 VND·USD 열이 섞여 열 위치가 분기마다 다르다 → 2단계 범위 밖(미확인 · 계획서 참조)
- 가이던스: 문장이 제각각이라 LLM 칸(llm_wants)
"""
import re

from customer_parsers.base import Doc, Content, ParseResult, ResultRow, VolumeRow, numeric_cells, QUARTER_WORDS, MONTHS
from lib.doc_text import norm_text, row_text

TICKERS = ('VFS',)
DEF_GLOBAL = '빈패스트 전기차(EV) 고객 인도 — 잠정치(연말 감사 후 바뀔 수 있음) · 전기 이륜차 제외'
DEF_VN = '빈패스트 베트남 내수 EV 인도 — 잠정치 · 해외 수출 예정분 제외 · 전기 이륜차 제외'
_Q = re.compile(r'The Company delivered ([\d,]+) electric vehicles \("EVs"\) globally in the '
                r'(first|second|third|fourth) quarter of (\d{4})')
_YTD = re.compile(r'in the first (six|nine) months of (\d{4}), VinFast delivered ([\d,]+) EVs to customers globally')
_FY = re.compile(r'in (?:full[- ]year |the full year )(\d{4}), VinFast delivered ([\d,]+) EVs to customers globally')
_VN_MONTH = re.compile(r'domestic Vietnam deliveries of ([\d,]+) electric vehicles \("EVs"\) for '
                       r'(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})')
_QHEAD = re.compile(r'^([1-4])Q(\d{4})$')


def wants(doc: Doc) -> bool:
  return doc.source == 'edgar' and doc.form in ('6-K', '20-F')


def llm_wants(doc: Doc, result: ParseResult) -> bool:
  """가이던스는 실적 보도자료 본문 문장 — 코드로 못 뽑는다."""
  return doc.doc_type == 'earnings_release'


def _n(s: str) -> int:
  return int(s.replace(',', ''))


def parse_text(text: str) -> list[VolumeRow]:
  t = norm_text(text)
  out = []
  for m in _Q.finditer(t):
    out.append(VolumeRow('deliveries', 'total', 'quarter', f'{m.group(3)}-Q{QUARTER_WORDS[m.group(2)]}', _n(m.group(1)),
                         DEF_GLOBAL, m.group(0)))
  for m in _YTD.finditer(t):
    months = 6 if m.group(1) == 'six' else 9
    out.append(VolumeRow('deliveries', 'total', 'ytd', f'{m.group(2)}-{months}M', _n(m.group(3)), DEF_GLOBAL, m.group(0)))
  for m in _FY.finditer(t):
    out.append(VolumeRow('deliveries', 'total', 'year', m.group(1), _n(m.group(2)), DEF_GLOBAL, m.group(0)))
  for m in _VN_MONTH.finditer(t):
    out.append(VolumeRow('deliveries', 'vietnam', 'month', f'{m.group(3)}-{MONTHS[m.group(2).lower()]:02d}',
                         _n(m.group(1)), DEF_VN, m.group(0)))
  return out


def parse_tables(tables) -> tuple[list[VolumeRow], list[ResultRow]]:
  vol, res = [], []
  for rows in tables:
    if not rows:
      continue
    m = _QHEAD.match(norm_text(rows[0][0]))
    if not m:
      continue
    period = f'{m.group(2)}-Q{m.group(1)}'
    for row in rows[1:]:
      lab, nums = re.sub(r'\s*\d$', '', norm_text(row[0])), numeric_cells(row)
      if not nums:
        continue
      if lab == 'EV Deliveries':
        vol.append(VolumeRow('deliveries', 'total', 'quarter', period, round(nums[0]), DEF_GLOBAL, row_text(row)))
      elif lab == 'Total Revenues':
        res.append(ResultRow('revenue', 'Total Revenues', 'reported', 'quarter', period, nums[0], 'million', 'VND',
                             row_text(row)))
  return vol, res


def parse(doc: Doc, content: Content) -> ParseResult:
  r = ParseResult()
  vol, res = parse_tables(content.tables)
  r.volume = vol + parse_text(content.text)
  r.results = res
  r.recognized = bool(r.volume or r.results)
  r.dedupe()  # 표와 문장이 같은 분기를 함께 낼 때(2Q 보도자료)
  return r


# ---------------------------------------------------------------- 자가 시험(2026 실물 원문)
MUST_HIT = [
  ([], 'Preliminary Global Deliveries in 3Q26 The Company delivered 82,580 electric vehicles (“EVs”) globally in the '
       'third quarter of 2026, representing a 116% increase year-over-year. Cumulatively, in the first nine months of '
       '2026, VinFast delivered 211,242 EVs to customers globally, representing a 91% increase year-over-year.',
   {('deliveries', 'total', '2026-Q3'): 82580, ('deliveries', 'total', '2026-9M'): 211242}),
  ([], 'announced preliminary domestic Vietnam deliveries of 23,624 electric vehicles (“EVs”) for September 2026, '
       'representing an increase of 17% compared to the previous month.',
   {('deliveries', 'vietnam', '2026-09'): 23624}),
  ([[['2Q2026', '1Q2026', '2Q2025'], ['EV Deliveries 1', '70,085', '58,577', '35,837'],
     ['E-scooter & E-bike Deliveries', '286,039', '143,136', '69,580']],
    [['2Q2026', '1Q2026', '2Q2025', 'QoQ', 'YoY'],
     ['Total Revenues', '30,340,852', '22,836,084', '16,356,556', '32.9', '%', '85.5', '%']]],
   'EV deliveries were 70,085 in the second quarter of 2026, representing an increase of 20% from first quarter of '
   '2026 and 96% increase from the second quarter of 2025.',
   {('deliveries', 'total', '2026-Q2'): 70085, ('R', 'revenue', '2026-Q2'): 30340852.0}),
]
# 🔴 이륜차 — 하나라도 물량 행이 생기면 실패(사용자 지시 2026-11-09)
MUST_MISS = [
  'VinFast also delivered 284,831 e-scooters and e-bikes globally during the third quarter of 2026, representing a '
  '137% increase year-over-year, of which 281,409 units were delivered in Vietnam.',
  'Cumulatively, in the first nine months of 2026, VinFast delivered 714,006 e-scooters and e-bikes globally, '
  'representing a 204% increase year-over-year.',
  'E-scooter and e-bike deliveries were 286,039 in the second quarter of 2026, representing a 100% increase from first '
  'quarter of 2026 and 311% increase from the second quarter of 2025.',
  # 모델별 대수는 회사 합계가 아니다
  'During the third quarter of 2026, the VF 3 and Limo Green were the best-selling models, with deliveries of 21,744 '
  'and 19,100 vehicles, respectively.',
]
MUST_MISS_TABLE = [[['2Q2026', '1Q2026', '2Q2025'], ['E-scooter & E-bike Deliveries', '286,039', '143,136', '69,580']]]


def self_test() -> list[str]:
  errs = []
  doc = Doc(0, 'test', 'VFS', 'edgar', 'current_report', '6-K', '', '', '', '2026-10-29')
  for tables, text, want in MUST_HIT:
    r = parse(doc, Content(text=text, tables=tables))
    got = {(v.metric, v.region, v.period): v.value for v in r.volume}
    got.update({('R', x.metric, x.period): x.value for x in r.results})
    for k, v in want.items():
      if got.get(k) != v:
        errs.append(f'MUST_HIT {k}: 기대 {v} · 실제 {got.get(k)}')
  for text in MUST_MISS:
    if parse(doc, Content(text=text)).volume:
      errs.append(f'MUST_MISS 이륜차·모델 문장이 뽑혔다: {text[:60]}')
  if parse(doc, Content(text='', tables=MUST_MISS_TABLE)).volume:
    errs.append('MUST_MISS 이륜차 표 행이 뽑혔다')
  return errs
```

```python
# scripts/customer_parsers/stellantis.py
"""스텔란티스 — EDGAR 6-K EX-99.1(분기 실적·출하 보도자료) + 실적 일정 6-K.

- 요약 표: 머리 '€ million / 000's units | Q3 2026 | Q3 2025 | Change | YTD 2026 | …' (첫 숫자 = 이번 분기)
  행 Net revenues · Net profit/(loss) · Adjusted operating income/(loss) · Consolidated shipments(천 대)
  ('I F R S'·'N O N - G A A P' 머리 셀이 첫 칸에 붙는 행이 있어 find_row 처럼 둘째 칸까지 본다)
- 가이던스 상자: 같은 표 머리 행 마지막 칸 'FY 2026 FINANCIAL GUIDANCE Net revenues: … AOI margin % (2) : … ' —
  숫자가 아닌 전망이라 value_text 로(low·high 는 null)
- H1(6월)·FY(2월) 보도자료의 열 머리는 미확인(실물 미확보) → 머리가 'Q\\d YYYY' 가 아니면 recognized=False 로
  '파싱 실패'가 아니라 '대상 아님' 처리하고 Task 9 착수 때 실물로 MUST_HIT 를 보탠다
- 북미 출하(IR 사이트 표)는 기존 collect_stellantis_shipments_ir.py 가 맡는다 — 여기서 만들지 않는다
- 소급 분기 팩트시트(IR PDF · doc_type='fact_sheet'): 2025 Q1·Q3 당일 보도자료엔 이익이 없고, 2026-02 연간 발표 때 낸
  「Financial Fact Sheet: Expanded Quarterly Reporting for 2025 …」에 분기별 IFRS 영업이익·순이익·AOI 가 있다(3쪽·4쪽).
  PDF 글은 셀이 한 줄씩 세로로 나온다 → 라벨 줄 뒤 숫자 줄들의 «끝 7개» = 머리 끝 7칸(Q1·Q2·H1·Q3·Q4·H2·FY).
  행마다 앞쪽 열 수가 다르다(매출 19칸 · 영업이익 15칸 — 2024 분기 열이 없다)라 앞에서 세면 틀린다.
  Q1+Q2=H1 · Q3+Q4=H2 · H1+H2=FY(±1, 반올림) 검산이 어긋난 지표는 버린다(조용히 틀린 칸보다 빈칸).
"""
import re

from customer_parsers.base import (Doc, Content, ParseResult, ResultRow, VolumeRow, GuidanceRow, EarningsDate,
                                   numeric_cells, month_name_date, to_number, QUARTER_WORDS)
from lib.doc_text import norm_text, row_text

TICKERS = ('STLA',)
SHIP_DEF = '스텔란티스 연결 출하(consolidated shipments): 공장에서 딜러·유통사로 넘긴 대수, 합작사 제외 · 천 대 단위 발표'
_QH = re.compile(r'^Q([1-4]) (\d{4})$')
_ROWS = (  # (라벨 정규식, metric, basis)
  (r'Net revenues$', 'revenue', 'reported'),
  (r'Net profit/\(loss\)$', 'net_income', 'reported'),
  (r'Adjusted operating income/\(loss\)', 'aoi', 'adjusted'),
)
_BOX = re.compile(r'FY (20\d{2}) FINANCIAL GUIDANCE (.+)$')
_BOX_ITEMS = (
  (re.compile(r'Net revenues: (.+?)(?= AOI margin| Industrial free|$)'), 'revenue_growth', 'Net revenues', None),
  (re.compile(r'AOI margin %(?: \(\d\))? : (.+?)(?= Industrial free|$)'), 'aoi_margin', 'AOI margin %', 'adjusted'),
  (re.compile(r'Industrial free cash flows(?: \(\d\))? : (.+?)(?= \(incl\.| Expect|$)'), 'industrial_fcf',
   'Industrial free cash flows', 'adjusted'),
)
_DATE = re.compile(r'will release its (First|Second|Third|Fourth|Full Year) (?:Quarter )?(\d{4}) (?:Financial )?Results on '
                   r'\w+day, (January|February|March|April|May|June|July|August|September|October|November|December) '
                   r'(\d{1,2}), (\d{4})', re.I)


def wants(doc: Doc) -> bool:
  return (doc.source == 'edgar' and doc.form == '6-K') or (doc.source == 'ir' and doc.doc_type == 'fact_sheet')


def _cells(row):
  """'I F R S' 같은 세로 머리 셀을 떼어낸 행."""
  return row[1:] if re.fullmatch(r'(?:[A-Z] ?)+(?:- ?(?:[A-Z] ?)+)*', norm_text(row[0])) and len(row) > 2 else row


def parse_summary(tables) -> ParseResult:
  r = ParseResult()
  for rows in tables:
    head = rows[0] if rows else []
    if len(head) < 3 or not norm_text(head[0]).startswith('€ million'):
      continue
    m = _QH.match(norm_text(head[1]))
    if not m:
      return r  # H1·FY 판 — 열 머리 미확인(모듈 설명 참조)
    q, y = int(m.group(1)), m.group(2)
    period, ytd = f'{y}-Q{q}', (y if q == 4 else f'{y}-{q * 3}M')
    ytd_grain = 'year' if q == 4 else 'ytd'
    r.recognized = True
    for raw in rows[1:]:
      row = _cells(raw)
      lab, nums = re.sub(r'\s*\(\d\)$', '', norm_text(row[0])), numeric_cells(row)
      if len(nums) < 4:
        continue
      for rx, metric, basis in _ROWS:
        if re.match(rx, lab):
          r.results.append(ResultRow(metric, lab, basis, 'quarter', period, nums[0], 'million', 'EUR', row_text(row)))
      if lab == 'Consolidated shipments':
        r.volume += [VolumeRow('shipments', 'total', 'quarter', period, round(nums[0] * 1000), SHIP_DEF, row_text(row)),
                     VolumeRow('shipments', 'total', ytd_grain, ytd, round(nums[2] * 1000), SHIP_DEF, row_text(row))]
    box = _BOX.search(norm_text(head[-1]))
    if box:
      for rx, metric, label, basis in _BOX_ITEMS:
        bm = rx.search(box.group(2))
        if bm:
          r.guidance.append(GuidanceRow(metric, label, f'FY{box.group(1)}', None, None, bm.group(1).strip(), 'text',
                                        basis, bm.group(0)))
    return r
  return r


def parse_dates(text: str) -> list[EarningsDate]:
  out = []
  for m in _DATE.finditer(norm_text(text)):
    word = m.group(1).lower()
    period = f'{m.group(2)}-FY' if word == 'full year' else f'{m.group(2)}-Q{QUARTER_WORDS[word]}'
    out.append(EarningsDate(period, month_name_date(m.group(3), m.group(4), m.group(5)), m.group(0)))
  return out


# ---------------------------------------------------------------- 소급 분기 팩트시트(PDF)
FACTSHEET_URL = ('https://www.stellantis.com/content/dam/stellantis-corporate/investors/events-and-presentations/'
                 'other-documents/Financial-Fact-Sheet-Expanded-Quarterly-Reporting-for-2025-and-Segment-'
                 'Reclassification-for-2025-and-2024.pdf')
_FS_TAIL = ('Q1', 'Q2', 'H1', 'Q3', 'Q4', 'H2', 'FY')
_FS_ROWS = (  # (라벨 정규식 — 각주 번호 '(1)(4)(5)' 허용 · 비율 행 'margin (%)' 은 안 걸린다, metric, 회사 이름, basis)
  (r'Net revenues \(EUR M\)', 'revenue', 'Net revenues', 'reported'),
  (r'Operating income/\(loss\) \(EUR M\)', 'operating_income', 'Operating income/(loss)', 'reported'),
  (r'Net profit/\(loss\) \(EUR M\)', 'net_income', 'Net profit/(loss)', 'reported'),
  (r'Adjusted operating income/\(loss\) \(EUR M\)', 'aoi', 'Adjusted operating income/(loss)', 'adjusted'),
)
_FS_NUM = re.compile(r'^-?[\d,]+$')


_FS_HEADCELL = re.compile(r"(?:Q[1-4]|H[12]|FY) '\d\d|as (?:reported|adjusted).*")


def _fs_year(lines: list[str]) -> int | None:
  """머리의 «마지막» 7칸 "Q1 '25 … FY '25" 의 연도. 앞 해 열도 같은 7칸 꼴이라(Q1 '24 … FY '24 뒤에 'as reported')
  바로 다음 줄이 머리 칸이 아닌 자리만 인정한다 — 첫 자리를 잡으면 2025 값이 2024 칸으로 들어간다(시제품 실측)."""
  for i in range(len(lines) - 7):
    m = re.fullmatch(r"Q1 '(\d\d)", lines[i])
    if (m and [lines[i + k] for k in range(7)] == [f"{t} '{m.group(1)}" for t in _FS_TAIL]
        and not _FS_HEADCELL.fullmatch(lines[i + 7])):
      return 2000 + int(m.group(1))
  return None


def factsheet_checks(v: dict) -> bool:
  """Q1+Q2=H1 · Q3+Q4=H2 · H1+H2=FY (백만 단위 반올림이라 ±1)."""
  return all(abs(a + b - c) <= 1 for a, b, c in ((v['Q1'], v['Q2'], v['H1']), (v['Q3'], v['Q4'], v['H2']),
                                                  (v['H1'], v['H2'], v['FY'])))


def parse_factsheet(text: str) -> ParseResult:
  r = ParseResult()
  lines = [norm_text(l) for l in text.split('\n')]
  year = _fs_year(lines)
  if year is None:
    return r  # 다른 팩트시트(연간만 등) — 대상 아님
  r.recognized = True
  for rx, metric, name, basis in _FS_ROWS:
    j = next((i for i, l in enumerate(lines) if re.fullmatch(rx + r'(?:\(\d\))*', l)), None)
    if j is None:
      continue
    k = j + 1
    while k < len(lines) and _FS_NUM.match(lines[k]):
      k += 1
    nums = [to_number(x) for x in lines[j + 1:k]]
    if len(nums) < 7:
      continue
    v = dict(zip(_FS_TAIL, nums[-7:]))
    if not factsheet_checks(v):
      continue
    quote = ' '.join(lines[j:k])
    for t in ('Q1', 'Q2', 'Q3', 'Q4'):
      r.results.append(ResultRow(metric, name, basis, 'quarter', f'{year}-{t}', v[t], 'million', 'EUR', quote))
    r.results.append(ResultRow(metric, name, basis, 'ytd', f'{year}-6M', v['H1'], 'million', 'EUR', quote))
    r.results.append(ResultRow(metric, name, basis, 'year', str(year), v['FY'], 'million', 'EUR', quote))
  return r


def parse(doc: Doc, content: Content) -> ParseResult:
  if doc.doc_type == 'fact_sheet':
    return parse_factsheet(content.text)
  r = parse_summary(content.tables)
  r.dates = parse_dates(content.text)
  r.recognized = r.recognized or bool(r.dates)
  return r


# ---------------------------------------------------------------- 자가 시험(2026 실물 원문)
Q3_HEAD = ["€ million / 000's units", 'Q3 2026', 'Q3 2025', 'Change', 'YTD 2026', 'YTD 2025', 'Change',
           "FY 2026 FINANCIAL GUIDANCE Net revenues: Mid-Single Digit % Increase AOI margin % (2) : Low-Single Digit % "
           "Industrial free cash flows (3) : Improved Y-o-Y (incl. ∼€1.6B in cash payments related to H2 '25 charges) "
           "Expect positive Industrial free cash flows (3) in 2027"]
MUST_HIT = [
  ([[Q3_HEAD,
     ['I F R S', 'Net revenues', '37,611', '37,206', '+1%', '119,225', '111,467', '+7%'],
     ['Net profit/(loss)', '(453)', '(4,532)', '+90%', '217', '(6,788)', 'n.m.'],
     ['N O N - G A A P', 'Adjusted operating income/(loss) (1)', '256', '90', '+184%', '1,989', '630', '+216%'],
     ['Consolidated shipments (6)', '1,286', '1,300', '(1)%', '4,244', '3,964', '+7%']]], '',
   {('R', 'revenue', '2026-Q3'): 37611.0, ('R', 'net_income', '2026-Q3'): -453.0, ('R', 'aoi', '2026-Q3'): 256.0,
    ('V', 'shipments', '2026-Q3'): 1286000, ('V', 'shipments', '2026-9M'): 4244000,
    ('G', 'revenue_growth', 'FY2026'): 'Mid-Single Digit % Increase', ('G', 'aoi_margin', 'FY2026'): 'Low-Single Digit %',
    ('G', 'industrial_fcf', 'FY2026'): 'Improved Y-o-Y'}),
  ([], 'Stellantis N.V. announced that it will release its Third Quarter 2026 Financial Results on Wednesday, '
       'October 28, 2026.', {('D', '2026-Q3'): '2026-10-28'}),
]
MUST_MISS = [
  # 'Adjusted operating income margin' 은 비율 행 — AOI 금액 칸에 들어가면 안 된다(퍼센트 셀이라 숫자 4개가 안 된다)
  ([[Q3_HEAD[:7], ['Adjusted operating income margin (2)', '0.7%', '0.2%', '50', 'bps', '1.7%', '0.6%', '110', 'bps']]],
   ('R', 'aoi')),
  # 2027 산업 FCF 기대 문장은 FY2026 전망 칸이 아니다
  ([[Q3_HEAD[:7] + ['FY 2026 FINANCIAL GUIDANCE Industrial free cash flows (3) : Improved Y-o-Y Expect positive '
                    'Industrial free cash flows (3) in 2027']]], ('G', 'FY2027')),
]


_FS_HEAD = ["FY '22", "H1 '23", "H2 '23", "FY '23", "Q1 '24", "Q2 '24", "H1 '24", "Q3 '24", "Q4 '24", "H2 '24", "FY '24",
            'as reported', "FY '24", 'as adjusted(1)', "Q1 '25", "Q2 '25", "H1 '25", "Q3 '25", "Q4 '25", "H2 '25", "FY '25"]
_FS_TEXT = '\n'.join(_FS_HEAD + [
  'Net revenues (EUR M)(1)', '179,592', '98,368', '91,176', '189,544', '41,697', '43,320', '85,017', '32,960', '38,901',
  '71,861', '156,878', '156,878', '35,813', '38,448', '74,261', '37,206', '42,041', '79,247', '153,508', 'North America',
  '85,475',
  'Operating income/(loss) (EUR M)', '20,276', '13,541', '8,835', '22,376', '6,639', '-2,952', '3,687', '3,687', '-316',
  '-2,394', '-2,710', '-2,455', '-21,089', '-23,544', '-26,254', 'Net financial expenses/(income) (EUR M)', '768',
  'Net profit/(loss) (EUR M)', '16,779', '10,918', '7,707', '18,625', '5,647', '-127', '5,520', '5,520', '-387', '-1,869',
  '-2,256', '-2,068', '-18,008', '-20,076', '-22,332', 'Diluted EPS (EUR)', '5.31',
  'Adjusted operating income/(loss) (EUR M)(1)(4)(5)', '24,017', '14,126', '10,217', '24,343', '8,463', '185', '8,648',
  '8,648', '327', '213', '540', '90', '-1,472', '-1,382', '-842', 'North America', '13,987',
  'Adjusted operating income/(loss) margin (%)(2)(5)', '13.4%', '14.4%', '11.2%', '12.8%', '10.0%', '0.3%', '5.5%', '5.5%',
  '0.9%', '0.6%', '0.7%', '0.2%', '-3.5%', '-1.7%', '-0.5%'])
FS_HIT = {('R', 'aoi', '2025-Q1'): 327.0, ('R', 'operating_income', '2025-Q1'): -316.0, ('R', 'net_income', '2025-Q1'): -387.0,
          ('R', 'aoi', '2025-Q2'): 213.0, ('R', 'operating_income', '2025-Q2'): -2394.0, ('R', 'net_income', '2025-Q2'): -1869.0,
          ('R', 'aoi', '2025-Q3'): 90.0, ('R', 'operating_income', '2025-Q3'): -2455.0, ('R', 'net_income', '2025-Q3'): -2068.0,
          ('R', 'aoi', '2025-6M'): 540.0, ('R', 'operating_income', '2025-6M'): -2710.0, ('R', 'net_income', '2025-6M'): -2256.0,
          ('R', 'revenue', '2025-Q1'): 35813.0, ('R', 'operating_income', '2025'): -26254.0}


def _flatten(r: ParseResult) -> dict:
  out = {('R', x.metric, x.period): x.value for x in r.results}
  out.update({('V', x.metric, x.period): x.value for x in r.volume})
  out.update({('G', x.metric, x.period): x.value_text for x in r.guidance})
  out.update({('D', x.period): x.event_date for x in r.dates})
  return out


def self_test() -> list[str]:
  errs = []
  doc = Doc(0, 'test', 'STLA', 'edgar', 'earnings_release', '6-K', '', '', '', '2026-10-28')
  for tables, text, want in MUST_HIT:
    got = _flatten(parse(doc, Content(text=text, tables=tables)))
    for k, v in want.items():
      if got.get(k) != v:
        errs.append(f'MUST_HIT {k}: 기대 {v} · 실제 {got.get(k)}')
  fdoc = Doc(0, 'test', 'STLA', 'ir', 'fact_sheet', '', '', '', FACTSHEET_URL, '2026-02-26')
  got = _flatten(parse(fdoc, Content(text=_FS_TEXT)))
  for k, v in FS_HIT.items():
    if got.get(k) != v:
      errs.append(f'FS_HIT {k}: 기대 {v} · 실제 {got.get(k)}')
  # 검산: Q1+Q2 = H1(상반기 발표값 540 · −2,710 · −2,256)
  for m in ('aoi', 'operating_income', 'net_income'):
    if got.get(('R', m, '2025-Q1'), 0) + got.get(('R', m, '2025-Q2'), 0) != got.get(('R', m, '2025-6M')):
      errs.append(f'FS 검산 {m}: Q1+Q2 ≠ H1')
  # MUST_MISS: 비율 행(margin %)이 aoi 칸으로 들어가면 안 된다 · 검산이 어긋난 지표는 통째로 버린다
  if got.get(('R', 'aoi', '2025-Q4')) != -1472.0:
    errs.append('FS aoi Q4 가 비율 행에 오염됐다')
  bad = _FS_TEXT.replace('\n-2,394\n', '\n-2,400\n')  # 영업이익 Q2 만 6 틀리게 → Q1+Q2 ≠ H1
  if any(k[1] == 'operating_income' for k in _flatten(parse(fdoc, Content(text=bad)))):
    errs.append('FS 검산이 어긋난 영업이익 행이 버려지지 않았다')
  if parse(fdoc, Content(text='\n'.join(_FS_HEAD[:14]))).recognized:
    errs.append('FS 머리 끝 7칸이 없는 PDF 를 대상으로 알아봤다')
  for tables, key in MUST_MISS:
    got = _flatten(parse(doc, Content(text='', tables=tables)))
    if any(k[0] == key[0] and key[1] in k[1:] for k in got):
      errs.append(f'MUST_MISS {key} 가 뽑혔다: {got}')
  return errs
```

- [ ] **Step 3: 스텔란티스 IR 출하 — 행 라벨 인자화(기존 동작 불변)** — `collect_stellantis_shipments_ir.py`:

```python
# 이 파일은 4칸 들여쓰기 · 반환형은 기존과 같은 int | None(parse_numeric_cell)
def extract_row_thousands(rows: list[list[str]], quarter: int, year: int, label: str) -> int | None:
    """출하 표에서 label 행(소문자 비교)의 이번 분기 열 값(천 대). 기존 북미 함수의 일반화."""
    ...  # extract_north_america_thousands 본문에서 NORTH_AMERICA_LABEL 을 label 로 바꾼 것


def extract_north_america_thousands(rows: list[list[str]], quarter: int, year: int) -> int | None:
    return extract_row_thousands(rows, quarter, year, NORTH_AMERICA_LABEL)
```

`test_stellantis_shipments_ir.py` 에 「전사 합계 행 라벨로 부르면 합계 값」 시험 1건 추가 · 기존 시험 그대로 PASS. 2단계는 이 함수로 «전사 합계»를 IR 판에서도 읽어 EDGAR 실적 보도자료 값(1,286)과 같은지 대조만 한다(적재는 EDGAR 쪽 — 실적 보도자료가 IR 출하 보도자료보다 늦은 확정치). 전사 합계 행의 실제 라벨 문자열은 미확인(아래 표) → 착수 시 IR 표에서 확인.

- [ ] **Step 3b: 스텔란티스 소급 팩트시트 일회성 백필** — stellantis.com PDF 는 로컬 curl 403(Akamai) · 브라우저로 열어 내려받기만 통과(기존 기록) → 헤드리스 Playwright 로 IR 자료 화면을 연 뒤 내려받아 스크래치 폴더에 두고(레포에 넣지 않는다):

```bash
PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe scripts/collect_customer_numbers.py --company STLA --no-llm \
  --add-file "<스크래치>/Financial-Fact-Sheet-Expanded-Quarterly-Reporting-for-2025-and-Segment-Reclassification-for-2025-and-2024.pdf" \
  --url "https://www.stellantis.com/content/dam/stellantis-corporate/investors/events-and-presentations/other-documents/Financial-Fact-Sheet-Expanded-Quarterly-Reporting-for-2025-and-Segment-Reclassification-for-2025-and-2024.pdf" \
  --doc-type fact_sheet --title "Financial Fact Sheet: Expanded Quarterly Reporting for 2025, and Segment Reclassification for 2025 and 2024" \
  --published <FY2025 실적 6-K 공시일 — customer_documents 에서 조회>
```

Expected: 문서 1건 `parsed` · `customer_reported_results` 24행(4지표 × Q1~Q4·상반기·연간) 전부 `verified=true` · `select metric, period, value from customer_reported_results where company_id=<STLA> and period in ('2025-Q1','2025-Q2','2025-Q3') and metric in ('operating_income','net_income','aoi') order by 1,2` → 위 FS_HIT 9개와 같다. (시제품 실측: 실물 PDF → 24행 · 어휘·대조 실패 0.) 앞으로 「당일엔 없고 나중에 소급 공표」가 또 오면 같은 명령 한 줄 — 화면은 다음 렌더부터 그 칸을 회사 값으로 바꾼다(Task 13 `pickEarnings` 시험 「뒤늦게 적재」).

- [ ] **Step 4: 실물 회귀** — `--company VFS --no-llm` · `--company STLA --no-llm` → failed 0. 🔴 빈패스트: `select count(*) from customer_volume_ir where company_id=<VFS> and (definition ilike '%scooter%' or quote ilike '%scooter%' or quote ilike '%e-bike%')` → 0.
  - 스텔란티스 H1(7월)·FY(2월) 보도자료는 열 머리가 미확인 — 모듈이 `recognized` 를 거짓으로 둬 `not_target` 이 된다. 실물을 열어 머리가 `H1 2026 | H1 2025 …` 꼴이면 반기 누계로 읽는 분기를 MUST_HIT 와 함께 더한다(Q2 = H1 − Q1 은 조회 계층이 뺀다).
- [ ] **Step 5: Commit** — `git add scripts/customer_parsers/vinfast.py scripts/customer_parsers/stellantis.py scripts/customer_parsers/__init__.py scripts/collect_stellantis_shipments_ir.py scripts/lib/test_stellantis_shipments_ir.py` · `git commit -m "feat(고객사): 빈패스트(자동차만)·스텔란티스 파서(소급 분기 팩트시트 포함) + IR 출하 행 라벨 인자화"`

---

### Task 10: 독일 — 폭스바겐 · 포르쉐 (IR · 일반 HTTP)

**Files:** Create `scripts/customer_parsers/{vw,porsche}.py` · Modify `__init__.py`

- **폭스바겐**
  - MUST_HIT: 머리 `Q3 | 9M` · `Production (units) | 1,786 | 2,125 | -15.9 | 5,957` · `Operating result | -5,860 | -1,299 | – | 71`(칸 위치) · 반기 `Production (units) | 2,014 | 2,325 | -13.4 | 4,171 | 4,519 | -7,7` · `8.8 billion EUR Operating Result before special items in 9M 2026` · 9M 전망 `expects Group sales revenue in 2026 of around €315 billion` · `operating return on sales is expected to reach up to 1 percent` · `investment ratio of between 11 and 12 percent` · `net cash flow of between €3 billion and €6 billion` · 반기 전망 `expects sales revenue in 2026 to develop within a range of –3 to 0 percent` · `is still expected to be between 4.0 and 5.5 percent` · `Net cash flow for the year 2026 is expected to range between EUR 3 billion and EUR 6 billion` · 인도 `World | 1,885,300 | 2,198,900 | -14.3 | 6,011,000`
  - MUST_MISS: 실적 표의 `Deliveries to customers (units) | 1,885`(천 대 반올림 — 인도 칸 금지) · 브랜드 그룹 표 `Core brand group | 3,753 …`
- **포르쉐**
  - MUST_HIT: `Porsche AG Group | Q1-Q3 2026 | Q1-Q3 2025` · `Sales revenue | €25.28 billion` · `Operating profit | €1.74 billion` · `Deliveries to customers | 178,532` · `Group sales revenue of between 35 and 36 billion euros. Group operating return on sales of 5.5 to 7.5 per cent. Automotive net cashflow margin of 5.5 to 7.5 per cent. Automotive EBITDA margin of 15 to 17 per cent. Automotive BEV share between 24 and 26 per cent.`
  - MUST_MISS: `Operating return on sales | 6.9%`(실적 비율)

- 🔴 폭스바겐 「Original Forecast」(보고서 KPI 표의 연초 전망 열)는 «직전 유효 전망»으로 다룬다(지시) — 방향은 이 파서가 아니라 `guidance_direction` 이 직전 «검증» 행과 비교해 정한다. 따라서 KPI 표를 읽는 경우에도 «이번 전망» 열만 적재하고 Original 열은 적재하지 않는다(적재하면 날짜가 같은 두 행이 생겨 방향이 꼬인다).
- 반기 → 9개월에 매출 전망이 증감률(`revenue_growth`)에서 금액(`revenue`)으로 바뀌었다 — metric 이 달라 방향 비교 대상이 아니다. 화면은 같은 카드에 「전망 기준 변경」 표시(Task 14).
- `llm_wants` = 실적 보도자료인데 전망 0건. 시제품은 9M·반기 두 꼴 다 코드로 5항목을 뽑는다. 전망 행의 `value_text` 는 숫자로 못 담는 문구만 — 범위·'up to' 는 low·high 로, 문장은 `quote` 에(시제품은 VW 행 전부 `value_text=None`).

- [ ] **Step 1: `__init__` 2줄 → FAIL 확인**
- [ ] **Step 2: 구현**(시제품)

```python
# scripts/customer_parsers/vw.py
"""폭스바겐 그룹 — IR 사이트 보도자료(일반 HTTP). 실적 보도자료 표 + 'Outlook for 2026' 문장 + 분기 인도 보도자료 표.

- 실적 표: 머리 'Q3 | 9M' / '2026 | 2025 | % | 2026 | 2025 | %' — 칸 위치로 읽는다(값 '–' 칸이 끼면 숫자만
  세는 방식은 열이 밀린다 · 반기 판 퍼센트 칸은 '–6,3' 처럼 독일식 소수점이라 숫자로 읽으면 안 된다)
  행 Production·Vehicle sales(천 대) · Sales revenue · Operating result(€ 백만)
  ⚠️ 이 표의 Deliveries to customers 는 천 대 반올림이라 쓰지 않는다 — 인도는 인도 보도자료의 대 단위 값을 쓴다
- 특수항목 전 영업이익: '8.8 billion EUR Operating Result before special items in 9M 2026' (누계 · 분기는 조회 계층이 뺄셈)
- 전망: 'Outlook for 2026 …' 문장 5종. 문장꼴이 바뀌어 0건이면 llm_wants 가 LLM 으로 넘긴다
"""
import re

from customer_parsers.base import (Doc, Content, ParseResult, ResultRow, VolumeRow, GuidanceRow, to_number)
from lib.doc_text import norm_text, row_text

TICKERS = ('VOW3.DE',)
DEF = {'production': '폭스바겐 그룹 생산(합작사 포함 여부는 회사 정의 따름 · 천 대 단위 발표)',
       'sales': '폭스바겐 그룹 차량 판매(vehicle sales: 매출 인식 대수 · 천 대 단위 발표)',
       'deliveries': '폭스바겐 그룹 고객 인도(중국 합작사 포함 · 대 단위)'}
_PERIOD = re.compile(r'^(Q[1-4])$')
_YTD = {'Q1': (None, None), 'H1': ('ytd', 6), '9M': ('ytd', 9), 'FY': ('year', 12)}
_BSI = re.compile(r'([\d.]+) billion EUR Operating Result before special items in (Q1|H1|9M|FY) (\d{4})')
_OUT = re.compile(r'Outlook for (20\d{2}) (.{0,900})')
_EUR = r'(?:€|EUR )'
_G = (
  (re.compile(r'expects Group sales revenue in 20\d{2} (?:of )?(around|between) ' + _EUR + r'([\d.]+) billion'
              r'(?: and ' + _EUR + r'([\d.]+) billion)?'), 'revenue', 'Group sales revenue', 'billion', 'reported'),
  # 반기 판(2026-07)은 같은 칸을 증감률로 냈다 — 다른 metric 이라 방향 비교는 하지 않는다(계획서 「metric 이 바뀐 전망」)
  (re.compile(r'expects sales revenue in 20\d{2} to develop within a (range) of ([-+]?[\d.]+) to ([-+]?[\d.]+) percent'),
   'revenue_growth', 'Group sales revenue growth', 'percent', 'reported'),
  (re.compile(r"operating return on sales is (?:still )?expected to (?:reach |be )?(up to|between|around) ([\d.]+)"
              r"(?: and ([\d.]+))? percent"), 'operating_margin', 'Group operating return on sales', 'percent', 'reported'),
  (re.compile(r'investment ratio of (between|around|up to) ([\d.]+)(?: and ([\d.]+))? percent'),
   'investment_ratio', 'Automotive investment ratio', 'percent', None),
  (re.compile(r'[Nn]et cash flow (?:of |for the year 20\d{2} is expected to range )(between|around|up to) ' + _EUR +
              r'([\d.]+) billion(?: and ' + _EUR + r'([\d.]+) billion)?'),
   'automotive_net_cash_flow', 'Automotive net cash flow', 'billion', None),
  (re.compile(r'Net liquidity in the Automotive Division is expected to (?:range )?(between|around) ' + _EUR +
              r'([\d.]+) billion(?: and ' + _EUR + r'([\d.]+) billion)?'),
   'automotive_net_liquidity', 'Automotive net liquidity', 'billion', None),
)
_DELIV_HEAD = re.compile(r'^Deliveries to customers by market$')
_MON = {'Mar.': 3, 'Jun.': 6, 'Sep.': 9, 'Dec.': 12}


def wants(doc: Doc) -> bool:
  return doc.source == 'ir' and doc.doc_type in ('earnings_release', 'sales_release')


def llm_wants(doc: Doc, result: ParseResult) -> bool:
  return doc.doc_type == 'earnings_release' and not result.guidance


def _range(word: str, a: str, b: str | None) -> tuple[float | None, float | None]:
  a_ = float(a)
  if word == 'up to':
    return None, a_
  return (a_, float(b)) if b else (a_, a_)


def parse_kpi(tables) -> ParseResult:
  r = ParseResult()
  for rows in tables:
    if len(rows) < 3 or not _PERIOD.match(norm_text(rows[0][0])) or len(rows[0]) < 2:
      continue
    q, ytd_word = rows[0][0], norm_text(rows[0][1])
    year = norm_text(rows[1][0])
    if not re.fullmatch(r'20\d{2}', year):
      continue
    period = f'{year}-{q}'
    grain, months = _YTD.get(ytd_word, (None, None))
    ytd = (year if grain == 'year' else f'{year}-{months}M') if grain else None
    r.recognized = True
    for row in rows[2:]:
      lab = re.sub(r'\s*\(units\)$', '', norm_text(row[0]))
      cells = row[1:]
      if len(cells) < 4:
        continue
      cur, ytd_v = to_number(cells[0]), to_number(cells[3])
      if lab in ('Production', 'Vehicle sales'):
        metric = 'production' if lab == 'Production' else 'sales'
        r.volume.append(VolumeRow(metric, 'total', 'quarter', period, round(cur * 1000), DEF[metric], row_text(row)))
        if ytd and ytd_v is not None:
          r.volume.append(VolumeRow(metric, 'total', grain, ytd, round(ytd_v * 1000), DEF[metric], row_text(row)))
      elif lab in ('Sales revenue', 'Operating result'):
        metric = 'revenue' if lab == 'Sales revenue' else 'operating_income'
        r.results.append(ResultRow(metric, lab, 'reported', 'quarter', period, cur, 'million', 'EUR', row_text(row)))
    return r
  return r


def parse_text(text: str) -> ParseResult:
  r = ParseResult()
  t = norm_text(text)
  for m in _BSI.finditer(t):
    grain, months = _YTD[m.group(2)] if m.group(2) != 'Q1' else ('quarter', 3)
    period = f'{m.group(3)}-Q1' if m.group(2) == 'Q1' else (m.group(3) if grain == 'year' else f'{m.group(3)}-{months}M')
    r.results.append(ResultRow('operating_result_bsi', 'Operating Result before special items', 'adjusted', grain, period,
                               float(m.group(1)), 'billion', 'EUR', m.group(0)))
  om = _OUT.search(t)
  if om:
    year, body = om.group(1), om.group(2)
    for rx, metric, label, unit, basis in _G:
      m = rx.search(body)
      if m:
        lo, hi = _range(m.group(1), m.group(2), m.group(3))
        # value_text 는 숫자로 못 담는 문구만 — 여기선 lo·hi 로 다 표현되므로 None(문장은 quote 에)
        r.guidance.append(GuidanceRow(metric, label, f'FY{year}', lo, hi, None, unit, basis, m.group(0)))
  return r


def parse_deliveries(tables) -> list[VolumeRow]:
  for rows in tables:
    if not rows or not _DELIV_HEAD.match(norm_text(rows[0][0])) or len(rows[0]) < 5:
      continue
    m = re.match(r'\w{3}\. - (\w{3}\.) (\d{4})', norm_text(rows[0][1]))
    if not m or m.group(1) not in _MON:
      return []
    year, end = m.group(2), _MON[m.group(1)]
    quarter, ytd = f'{year}-Q{end // 3}', (year if end == 12 else f'{year}-{end}M')
    for row in rows:
      if norm_text(row[0]) == 'World':
        cells = row[1:]
        out = [VolumeRow('deliveries', 'total', 'quarter', quarter, round(to_number(cells[0])), DEF['deliveries'],
                         row_text(row))]
        if end != 3:
          out.append(VolumeRow('deliveries', 'total', 'year' if end == 12 else 'ytd', ytd, round(to_number(cells[3])),
                               DEF['deliveries'], row_text(row)))
        return out
  return []


def parse(doc: Doc, content: Content) -> ParseResult:
  r = parse_kpi(content.tables)
  r.extend(parse_text(content.text))
  dv = parse_deliveries(content.tables)
  r.volume += dv
  r.recognized = r.recognized or bool(dv)
  return r


# ---------------------------------------------------------------- 자가 시험(2026 실물 원문)
MUST_HIT = [
  ([[['Q3', '9M'], ['2026', '2025', '%', '2026', '2025', '%'], ['Volume Data 1 in thousands'],
     ['Deliveries to customers (units)', '1,885', '2,199', '-14.3', '6,011', '6,604', '-9.0'],
     ['Vehicle sales (units)', '1,883', '2,218', '-15.1', '5,880', '6,581', '-10.6'],
     ['Production (units)', '1,786', '2,125', '-15.9', '5,957', '6,644', '-10.3'],
     ['Sales revenue', '75,277', '80,305', '-6.3', '233,378', '238,669', '-2.2'],
     ['Operating result', '-5,860', '-1,299', '–', '71', '5,408', '-98.7']]],
   '8.8 billion EUR Operating Result before special items in 9M 2026; operating return on sales before special items '
   'of 3.8% … Outlook for 2026 The Volkswagen Group expects Group sales revenue in 2026 of around €315 billion. The '
   'Group’s operating return on sales is expected to reach up to 1 percent. In the Automotive Division, the company '
   'expects an investment ratio of between 11 and 12 percent and net cash flow of between €3 billion and €6 billion '
   'for 2026. Net liquidity in the Automotive Division is expected to range between €32 billion and €34 billion in 2026.',
   {('V', 'production', '2026-Q3'): 1786000, ('V', 'sales', '2026-9M'): 5880000,
    ('R', 'revenue', '2026-Q3'): 75277.0, ('R', 'operating_income', '2026-Q3'): -5860.0,
    ('R', 'operating_result_bsi', '2026-9M'): 8.8,
    ('G', 'revenue', 'FY2026'): (315.0, 315.0), ('G', 'operating_margin', 'FY2026'): (None, 1.0),
    ('G', 'investment_ratio', 'FY2026'): (11.0, 12.0), ('G', 'automotive_net_cash_flow', 'FY2026'): (3.0, 6.0),
    ('G', 'automotive_net_liquidity', 'FY2026'): (32.0, 34.0)}),
  ([], 'Adjusted Outlook for 2026 The Volkswagen Group expects sales revenue in 2026 to develop within a range of –3 to 0 '
       'percent compared with the previous year (previously: range of 0 to +3 percent). The Group’s operating return '
       'on sales is still expected to be between 4.0 and 5.5 percent. In the Automotive Division, the company continues '
       'to expect an investment ratio of between 11 and 12 percent in 2026. Net cash flow for the year 2026 is expected '
       'to range between EUR 3 billion and EUR 6 billion. Net liquidity in the Automotive Division is expected to range '
       'between EUR 32 billion and EUR 34 billion in 2026.',
   {('G', 'revenue_growth', 'FY2026'): (-3.0, 0.0), ('G', 'operating_margin', 'FY2026'): (4.0, 5.5),
    ('G', 'automotive_net_cash_flow', 'FY2026'): (3.0, 6.0), ('G', 'automotive_net_liquidity', 'FY2026'): (32.0, 34.0)}),
  # 반기 판 — 퍼센트 칸이 '–6,3' 꼴(독일식)이어도 칸 위치로 읽어 반기 누계를 맞힌다
  ([[['Q2', 'H1'], ['2026', '2025', '%', '2026', '2025', '%'],
     ['Production (units)', '2,014', '2,325', '-13.4', '4,171', '4,519', '-7,7'],
     ['Sales revenue', '82,444', '80,806', '2.0', '158,102', '158,364', '–0.2']]],
   '6.9 billion EUR Operating Result before special items in H1 2026',
   {('V', 'production', '2026-6M'): 4171000, ('R', 'revenue', '2026-Q2'): 82444.0,
    ('R', 'operating_result_bsi', '2026-6M'): 6.9}),
  ([[['Deliveries to customers by market', 'Jul. - Sep. 2026', 'Jul. - Sep. 2025', 'Delta (%)', 'Jan. - Sep. 2026',
      'Jan. - Sep. 2025', 'Delta (%)'],
     ['North America', '232,700', '246,900', '-5.8', '680,200', '708,800', '-4.0'],
     ['World', '1,885,300', '2,198,900', '-14.3', '6,011,000', '6,604,300', '-9.0']]], '',
   {('V', 'deliveries', '2026-Q3'): 1885300, ('V', 'deliveries', '2026-9M'): 6011000}),
]
MUST_MISS = [
  # 실적 표의 천 대 반올림 인도(1,885)는 인도 칸에 들어가면 안 된다(인도 보도자료 1,885,300 과 충돌)
  ([[['Q3', '9M'], ['2026', '2025', '%', '2026', '2025', '%'],
     ['Deliveries to customers (units)', '1,885', '2,199', '-14.3', '6,011', '6,604', '-9.0']]], '', ('V', 'deliveries')),
  # 브랜드 그룹 표의 Operating result 는 그룹 값이 아니다
  ([[['Vehicle sales', 'Sales revenue', 'Operating result', 'Operating margin'],
     ['Thousand vehicles/ € million', '2026', '2025', '2026', '2025'],
     ['Core brand group', '3,753', '3,771', '106,417', '106,950', '4,326', '4,719', '4.1', '4.4']]], '',
   ('R', 'operating_income')),
]


def _flatten(r: ParseResult) -> dict:
  out = {('V', x.metric, x.period): x.value for x in r.volume}
  out.update({('R', x.metric, x.period): x.value for x in r.results})
  out.update({('G', x.metric, x.period): (x.low, x.high) for x in r.guidance})
  return out


def self_test() -> list[str]:
  errs = []
  doc = Doc(0, 'test', 'VOW3.DE', 'ir', 'earnings_release', '', '', '', '', '2026-10-30')
  for tables, text, want in MUST_HIT:
    got = _flatten(parse(doc, Content(text=text, tables=tables)))
    for k, v in want.items():
      if got.get(k) != v:
        errs.append(f'MUST_HIT {k}: 기대 {v} · 실제 {got.get(k)}')
  for tables, text, key in MUST_MISS:
    got = _flatten(parse(doc, Content(text=text, tables=tables)))
    if any(k[:2] == key for k in got):
      errs.append(f'MUST_MISS {key} 가 뽑혔다: {got}')
  return errs
```

```python
# scripts/customer_parsers/porsche.py
"""포르쉐 AG — IR 사이트 보도자료(EQS 공시 html · 일반 HTTP). 누계 표 + 'forecast is based on' 문장.

- 누계 표: 머리 'Porsche AG Group | Q1-Q3 2026 | Q1-Q3 2025' · 값 '€25.28 billion' · 인도 '178,532'
  (분기 값은 발표하지 않는다 → 누계로 담고 분기는 조회 계층이 뺄셈 · 표시는 「누계 차이로 계산」)
- 전망: 'Group sales revenue of between 35 and 36 billion euros. Group operating return on sales of 5.5 to 7.5 per cent.'
  3월 연간 보도자료의 전망 문단은 꼴이 달라 LLM(llm_wants)
- 생산 대수: 미확인(발표 위치를 못 찾았다 — 계획서 미확인 목록)
"""
import re

from customer_parsers.base import Doc, Content, ParseResult, ResultRow, VolumeRow, GuidanceRow, to_number
from lib.doc_text import norm_text, row_text

TICKERS = ('P911.DE',)
DEF = '포르쉐 AG 그룹 고객 인도(누계 발표 · 분기는 누계 차이)'
_HEAD = re.compile(r'^(Q1|Q1-Q2|H1|Q1-Q3|9M|FY|Fiscal year) (\d{4})$')
_MONTHS = {'Q1': 3, 'Q1-Q2': 6, 'H1': 6, 'Q1-Q3': 9, '9M': 9, 'FY': 12, 'Fiscal year': 12}
_BILLION = re.compile(r'^€\s?([\d.]+) billion$')
_G = (
  (r'Group sales revenue of (?:between )?([\d.]+) (?:and|to) ([\d.]+) billion euros', 'revenue', 'Group sales revenue',
   'billion', 'reported'),
  (r'Group operating return on sales of (?:between )?([\d.]+) (?:and|to) ([\d.]+) per cent', 'operating_margin',
   'Group operating return on sales', 'percent', 'reported'),
  (r'Automotive net cashflow margin of (?:between )?([\d.]+) (?:and|to) ([\d.]+) per cent', 'automotive_ncf_margin',
   'Automotive net cashflow margin', 'percent', None),
  (r'Automotive EBITDA margin of (?:between )?([\d.]+) (?:and|to) ([\d.]+) per cent', 'automotive_ebitda_margin',
   'Automotive EBITDA margin', 'percent', None),
  (r'Automotive BEV share (?:of )?between ([\d.]+) and ([\d.]+) per cent', 'bev_share', 'Automotive BEV share',
   'percent', None),
)


def wants(doc: Doc) -> bool:
  return doc.source == 'ir' and doc.doc_type in ('earnings_release', 'sales_release')


def llm_wants(doc: Doc, result: ParseResult) -> bool:
  return doc.doc_type == 'earnings_release' and not result.guidance


def parse_table(tables) -> ParseResult:
  r = ParseResult()
  for rows in tables:
    head = next((x for x in rows[:2] if norm_text(x[0]) == 'Porsche AG Group' and len(x) >= 2), None)
    m = _HEAD.match(norm_text(head[1])) if head else None
    if not m:
      continue
    months, year = _MONTHS[m.group(1)], m.group(2)
    grain, period = ('quarter', f'{year}-Q1') if months == 3 else (('year', year) if months == 12 else
                                                                    ('ytd', f'{year}-{months}M'))
    r.recognized = True
    for row in rows:
      lab, cell = norm_text(row[0]), norm_text(row[1]) if len(row) > 1 else ''
      b = _BILLION.match(cell)
      if lab in ('Sales revenue', 'Operating profit') and b:
        metric = 'revenue' if lab == 'Sales revenue' else 'operating_income'
        r.results.append(ResultRow(metric, lab, 'reported', grain, period, float(b.group(1)), 'billion', 'EUR',
                                   row_text(row)))
      elif lab == 'Deliveries to customers' and to_number(cell) is not None:
        r.volume.append(VolumeRow('deliveries', 'total', grain, period, round(to_number(cell)), DEF, row_text(row)))
    return r
  return r


def parse_guidance(text: str, year: str) -> list[GuidanceRow]:
  t = norm_text(text)
  out = []
  for rx, metric, label, unit, basis in _G:
    m = re.search(rx, t)
    if m:
      out.append(GuidanceRow(metric, label, f'FY{year}', float(m.group(1)), float(m.group(2)), None, unit, basis,
                             m.group(0)))
  return out


def parse(doc: Doc, content: Content) -> ParseResult:
  r = parse_table(content.tables)
  year = r.results[0].period[:4] if r.results else doc.published_at[:4]
  r.guidance = parse_guidance(content.text, year)
  return r


# ---------------------------------------------------------------- 자가 시험(2026 실물 원문)
MUST_HIT = [
  ([[['Porsche AG Group', 'Q1-Q3 2026', 'Q1-Q3 2025'], ['Sales revenue', '€25.28 billion', '€26.86 billion'],
     ['Operating profit', '€1.74 billion', '€0.04 billion'], ['Operating return on sales', '6.9%', '0.2%'],
     ['Deliveries to customers', '178,532', '212,509']]],
   'The forecast is based on the following figures: Group sales revenue of between 35 and 36 billion euros. Group '
   'operating return on sales of 5.5 to 7.5 per cent. Automotive net cashflow margin of 5.5 to 7.5 per cent. '
   'Automotive EBITDA margin of 15 to 17 per cent. Automotive BEV share between 24 and 26 per cent.',
   {('R', 'revenue', '2026-9M'): 25.28, ('R', 'operating_income', '2026-9M'): 1.74,
    ('V', 'deliveries', '2026-9M'): 178532, ('G', 'revenue', 'FY2026'): (35.0, 36.0),
    ('G', 'operating_margin', 'FY2026'): (5.5, 7.5), ('G', 'automotive_ncf_margin', 'FY2026'): (5.5, 7.5),
    ('G', 'automotive_ebitda_margin', 'FY2026'): (15.0, 17.0), ('G', 'bev_share', 'FY2026'): (24.0, 26.0)}),
]
MUST_MISS = [
  # 'Operating return on sales 6.9%' 는 실적 비율이지 전망이 아니다
  ([[['Porsche AG Group', 'Q1-Q3 2026', 'Q1-Q3 2025'], ['Operating return on sales', '6.9%', '0.2%']]],
   'Operating return on sales of 6.9 per cent in the first nine months.', 'G'),
]


def _flatten(r: ParseResult) -> dict:
  out = {('V', x.metric, x.period): x.value for x in r.volume}
  out.update({('R', x.metric, x.period): x.value for x in r.results})
  out.update({('G', x.metric, x.period): (x.low, x.high) for x in r.guidance})
  return out


def self_test() -> list[str]:
  errs = []
  doc = Doc(0, 'test', 'P911.DE', 'ir', 'earnings_release', '', '', '', '', '2026-10-28')
  for tables, text, want in MUST_HIT:
    got = _flatten(parse(doc, Content(text=text, tables=tables)))
    for k, v in want.items():
      if got.get(k) != v:
        errs.append(f'MUST_HIT {k}: 기대 {v} · 실제 {got.get(k)}')
  for tables, text, kind in MUST_MISS:
    got = _flatten(parse(doc, Content(text=text, tables=tables)))
    if any(k[0] == kind for k in got):
      errs.append(f'MUST_MISS {kind} 가 뽑혔다: {got}')
  return errs
```

- [ ] **Step 3: 실물 회귀** — `--company VOW3.DE --no-llm` · `--company P911.DE --no-llm` → failed 0. 포르쉐 3월 연간 보도자료는 `recognized` 참(표가 `FY` 머리면) + 전망 0건 → `llm_wants` 참 → Task 11 뒤 다시.
- [ ] **Step 4: Commit** — `git add scripts/customer_parsers/vw.py scripts/customer_parsers/porsche.py scripts/customer_parsers/__init__.py` · `git commit -m "feat(고객사): 폭스바겐·포르쉐 실적·인도·전망 파서"`

---

### Task 11: LLM 가이던스 — 코드로 못 뽑는 칸만 `scripts/lib/llm_guidance.py`

**Files:** Create `scripts/lib/llm_guidance.py` · `scripts/lib/test_llm_guidance.py` · Modify 대상 파서의 `llm_wants`(vinfast·polaris·stellantis·vw·porsche·kr_dart)

**Interfaces:**

- Produces: `extract(client, doc, content, company_label, hint) -> list[GuidanceRow]`(행마다 `extractor='llm'` 은 오케스트레이터가 붙인다) · `MODEL` · `SCHEMA`
- 대상(`llm_wants` 가 참이 되는 자리 — 「회사별 코드/AI 표」의 llm 칸):

| 회사              | 문서                                                                               | 뽑을 것                                                        |
| ----------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 빈패스트          | 실적 보도자료(EX-99.1)                                                             | 연간 **자동차** 인도 목표·매출·이익 전망 — 🔴 이륜차 목표 제외 |
| 폴라리스          | IR 컨퍼런스 발표자료 PDF(예 2026-03-03 `Full Year 2026 Guidance (Updated 3/3/26)`) | Sales·Adjusted EPS 범위                                        |
| 스텔란티스        | 실적 보도자료의 상자 밖 보조 전망 글머리표 · 2026-02-06 최초 발표                  | 상자 3항목 외 전망                                             |
| 폭스바겐 · 포르쉐 | 실적 보도자료인데 코드 0건(문장꼴 변경) · 포르쉐 3월 연간 보도자료                 | Outlook 문단의 항목                                            |
| 현대모비스        | IR 경영실적 PDF                                                                    | 수주 목표(연간) — 중장기 목표는 `period` 를 그 해로            |
| KGM               | CEO IR 설명회 PDF(`releaseList`)                                                   | 「20XX년 사업계획」 판매·매출 목표                             |
| 현대차 · 기아     | 가이던스 PDF(IR JSON `guidanceValue`) · Investor Day                               | FCF·중장기(전망 공시에 없는 항목만)                            |

- [ ] **Step 1: 시험 먼저(네트워크 없음)** — `test_llm_guidance.py`: 가짜 클라이언트(`messages.create` 가 정해진 JSON 을 돌려줌)로 ① JSON → `GuidanceRow` 변환 ② `quote` 가 원문에 없는 항목은 오케스트레이터 대조에서 `verified=false` 가 되는지 ③ `stop_reason='max_tokens'` 면 경고 후 빈 목록 ④ 스키마가 `additionalProperties: false`·전 칸 required 인지.

- [ ] **Step 2: 구현**

```python
"""고객사 가이던스 LLM 추출 — 코드 파서가 못 뽑는 칸만(회사별 llm_wants). 결과는 반드시 quote_check 를 지난다.

모델 상수는 여기 한곳. 구조화 출력 본보기 = collect_oem_model_outlook.py:431 _evaluate.
"""
import json
import os

from customer_parsers.base import BASES, METRICS, UNITS, GuidanceRow

MODEL = os.environ.get('CUSTOMER_GUIDANCE_MODEL', 'claude-sonnet-5-5')
MAX_CHARS = 120_000   # 문서 글 상한(앞에서 자른다) — 실적 보도자료는 대개 40k 이하
_NULLABLE_NUM = {'anyOf': [{'type': 'number'}, {'type': 'null'}]}
_NULLABLE_STR = {'anyOf': [{'type': 'string'}, {'type': 'null'}]}
SCHEMA = {
  'type': 'object', 'additionalProperties': False, 'required': ['items'],
  'properties': {'items': {'type': 'array', 'items': {
    'type': 'object', 'additionalProperties': False,
    'required': ['metric', 'metric_label', 'year', 'low', 'high', 'value_text', 'unit', 'basis', 'quote', 'stated'],
    'properties': {
      'metric': {'type': 'string', 'enum': list(METRICS)},   # 파서와 같은 어휘(base.py)
      'metric_label': {'type': 'string'},
      'year': {'type': 'integer'},
      'low': _NULLABLE_NUM, 'high': _NULLABLE_NUM, 'value_text': _NULLABLE_STR,
      'unit': {'type': 'string', 'enum': list(UNITS)},
      'basis': {'anyOf': [{'type': 'string', 'enum': list(BASES)}, {'type': 'null'}]},
      'quote': {'type': 'string'},
      'stated': {'anyOf': [{'type': 'string', 'enum': ['raised', 'maintained', 'lowered', 'withdrawn']}, {'type': 'null'}]},
    }}}},
}
SYSTEM = """너는 자동차 회사 공식 문서에서 «회사가 이번 문서에서 밝힌 연간 전망(가이던스)»만 뽑는다.
- 뽑는 것: 회계연도 전체에 대한 회사 자신의 전망·목표. 범위면 low·high, 한 점이면 low=high, '최대 X' 면 high 만.
- 숫자가 아닌 전망('mid-single digit increase')은 value_text 에 원문 그대로, low·high 는 null.
- 뽑지 않는 것: 분기 전망 · 과거 실적 · 애널리스트·시장 추정 · 직전 전망(바뀌기 전 값) · 중장기 목표 중 연도가 없는 것.
- quote 는 그 값이 들어 있는 원문 문장(또는 표 한 행)을 «한 글자도 바꾸지 말고» 그대로. 번역·요약 금지.
- stated 는 원문이 raise/reaffirm/lower/withdraw 같은 말을 직접 썼을 때만, 아니면 null.
- 확신이 없으면 항목을 만들지 말고 빈 목록을 돌려준다."""


def extract(client, doc, text: str, company_label: str, hint: str = '') -> list[GuidanceRow]:
  msg = client.messages.create(
    model=MODEL, max_tokens=16000, thinking={'type': 'adaptive'},
    output_config={'effort': 'medium', 'format': {'type': 'json_schema', 'schema': SCHEMA}},
    system=SYSTEM,
    messages=[{'role': 'user', 'content':
               f'회사: {company_label}\n문서: {doc.title} ({doc.published_at})\n{hint}\n\n--- 원문 ---\n{text[:MAX_CHARS]}'}],
  )
  if msg.stop_reason == 'max_tokens':
    print(f'경고: LLM 응답이 max_tokens 에서 잘림(doc {doc.id}) — 이 문서는 건너뜀')
    return []
  body = next((b.text for b in msg.content if b.type == 'text'), '')
  items = json.loads(body).get('items', [])
  return [GuidanceRow(i['metric'], i['metric_label'], f'FY{i["year"]}', i['low'], i['high'], i['value_text'],
                      i['unit'], i['basis'], i['quote'], i['stated']) for i in items]
```

`hint` 는 회사 파서가 준다(예 빈패스트: `'전기 이륜차(e-scooter·e-bike) 목표·수치는 뽑지 마세요. 자동차(EV)만.'`). 오케스트레이터는 LLM 행에도 Task 5 대조를 똑같이 돌리고, 🔴 같은 `(document_id, metric, period)` 에 코드 행이 이미 있으면 LLM 행을 버린다(코드 우선).
`thinking`·`output_config` 인자 이름은 착수 시 Context7(Anthropic SDK)로 현재 판을 확인한다 — 모델 ID `claude-sonnet-5-5` 도(기존 스크립트는 `claude-sonnet-5`).

- [ ] **Step 3: 실물 1회(로컬 · `ANTHROPIC_API_KEY` 필요)** — `--company VFS` → 실적 보도자료 1건에서 항목 n개 · 전부 `verified=true` 인지 · 이륜차 항목 0인지 눈으로 확인. 비용은 호출 수 × 문서 길이 — 출력에 호출 수만 찍는다.
- [ ] **Step 4: Commit** — `git add scripts/lib/llm_guidance.py scripts/lib/test_llm_guidance.py scripts/customer_parsers/*.py scripts/collect_customer_numbers.py Architecture.md` · `git commit -m "feat(고객사): 코드로 못 뽑는 가이던스만 LLM 추출(대조 통과분만 검증)"`

---

### Task 12: GitHub Actions — 평일 1회 · 회사별 격리

**Files:** Create `.github/workflows/collect-customer-docs.yml` · Modify `Architecture.md` §10

회사별 실패가 서로를 막지 않게 matrix(`fail-fast: false`)로 회사마다 한 job — 「GHA 회사별 파일」(선택 5차)은 회사별 «파서 파일»로 읽었다(워크플로를 11개로 쪼개지 않음 · 판정 요청 목록).

```yaml
name: collect-customer-docs
on:
  schedule:
    - cron: '0 23 * * 0-4' # KST 평일 08:00 — 미국·유럽 전날 공시 · 국내 전날 장후 공시
  workflow_dispatch:
    inputs:
      company: { description: '한 회사만(ticker) — 비우면 전체', required: false, default: '' }
      backfill: { description: '2년 백필', type: boolean, default: false }
      probe_gm_ir: { description: 'GM IR 사이트 접근 시험(Akamai)', type: boolean, default: false }
jobs:
  collect:
    runs-on: ubuntu-latest
    timeout-minutes: 40
    strategy:
      fail-fast: false
      matrix:
        ticker:
          [
            'GM',
            'RIVN',
            'PII',
            'VFS',
            'STLA',
            'VOW3.DE',
            'P911.DE',
            '005380',
            '000270',
            '012330',
            '003620',
          ]
    defaults: { run: { working-directory: scripts } }
    env:
      SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      NEXT_REVALIDATE_URL: ${{ secrets.NEXT_REVALIDATE_URL }}
      NEXT_REVALIDATE_SECRET: ${{ secrets.NEXT_REVALIDATE_SECRET }}
      DART_API_KEY: ${{ secrets.DART_API_KEY }}
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      SEC_USER_AGENT: ${{ secrets.SEC_USER_AGENT }}
    steps:
      - uses: actions/checkout@v7
        if: ${{ inputs.company == '' || inputs.company == matrix.ticker }}
      - uses: actions/setup-python@v7
        if: ${{ inputs.company == '' || inputs.company == matrix.ticker }}
        with:
          { python-version: '3.13', cache: pip, cache-dependency-path: scripts/requirements.txt }
      - name: 의존성
        if: ${{ inputs.company == '' || inputs.company == matrix.ticker }}
        run: pip install -r requirements.txt
      - name: GM IR 접근 시험(수동 입력일 때만)
        if: ${{ inputs.probe_gm_ir && matrix.ticker == 'GM' }}
        run: |
          python -m playwright install --with-deps chromium
          python -c "from lib.ir_lists import probe_gm; probe_gm()"
      - name: 문서 목록
        if: ${{ inputs.company == '' || inputs.company == matrix.ticker }}
        run: python collect_customer_docs.py --company "${{ matrix.ticker }}" ${{ inputs.backfill && '--backfill' || '' }}
      - name: 숫자
        if: ${{ inputs.company == '' || inputs.company == matrix.ticker }}
        run: python collect_customer_numbers.py --company "${{ matrix.ticker }}"
```

- `checkout@v7` · `setup-python@v7` · `cache-dependency-path: scripts/requirements.txt` 는 본보기 두 파일(`collect-stellantis-shipments-ir.yml` · `collect-hyundai-quarterly.yml`)과 같게 맞춘 값이다 — 착수 시 두 파일을 한 번 더 열어 달라졌으면 따른다.
- `probe_gm()` 는 `requests`(브라우저 UA) → 실패 시 Playwright 1회 → **HTTP 상태만** 찍고 `customer_collect_status(GM, 'ir_list')` 를 `ok`/`blocked` 로 남긴다. (함수는 Task 4 가 `scripts/lib/ir_lists.py` 에 만든다.)
- 새 Secret `SEC_USER_AGENT`(연락처 이메일 포함 문자열) — 사용자가 GitHub 에 등록(USER_ACTIONS). 없으면 기본값으로 돈다.
- 🔴 exit 1(파싱 실패)은 job 실패로 보이게 둔다 — 「안 돌았다」와 「돌았는데 못 뽑았다」를 Actions 화면에서 가른다.

- [ ] **Step 1: 작성** · **Step 2: `workflow_dispatch` 로 `company=GM probe_gm_ir=true` 1회** → 로그의 HTTP 상태를 계획서 「미확인」 표의 GM 줄에 적는다. **Step 3: `backfill=true` 전체 1회** → 회사별 job 결과·`customer_collect_status` 확인.
- [ ] **Step 4: Architecture.md §10** 워크플로 표에 한 줄 · AGENTS.md 「검증 명령」에 `collect_customer_numbers.py` 의 exit 규약 한 줄(0 정상 · 1 파싱 실패 · 2 자가 시험 실패).
- [ ] **Step 5: Commit** — `git add .github/workflows/collect-customer-docs.yml Architecture.md AGENTS.md` · `git commit -m "ci(고객사): 공식 문서 수집 평일 1회(회사별 격리)"`

---

### Task 13: 조회 계층 — 순수 함수(TDD) + `getCustomerIr`

**Files:** Create `lib/customers/ir.ts` · `lib/customers/ir.test.ts` · Modify `lib/customers/types.ts` · `lib/customers/source.ts` · `lib/currentYear.ts`(`todaySeoul`)

**Interfaces:**

- `quarterize(rows: IrSeriesRow[]): QuarterPoint[]` — 분기 행은 그대로, 누계(`ytd`·`year`)는 이웃 누계를 빼 분기를 만들고 `derived=true`(Q1 = 3M 또는 Q1 행 · Q2 = 6M − Q1 · Q3 = 9M − 6M · Q4 = 연간 − 9M). 빼기 재료가 하나라도 없으면 그 분기는 만들지 않는다(추정 금지).
- `latestGuidance(rows: GuidanceRowTs[]): GuidanceCard[]` — `verified` 만 · metric 별 가장 최근 FY 의 최신 행 + 같은 (metric, FY) 이력(오래된 것부터).
- `nextEarnings(rows: EarningsDateRow[], today: string): NextEarnings | null` — `event_date >= today` 중 가장 이른 것(`estimated=false`). 없으면 마지막 발표 + 4분기 뒤 대상의 «작년 같은 분기 발표일 + 1년»(`estimated=true`, 화면 「추정」). 재료 없으면 null.
- `pickEarnings(earnings: CustomerEarnings, reported: ReportedRow[]): CustomerEarnings` — 해외 7곳 전용(선택 7차). 칸마다 출처 순서대로 고르고 `origin` 으로 내려 준다: 영업이익 = 회사 장부상 → 회사 조정 영업이익(`ADJUSTED_OPERATING_METRICS` = `ebit_adjusted`·`aoi`·`operating_result_bsi` 순 · EBITDA 는 영업이익이 아니라 제외) → 시장(`financials`) → `none` · 매출·순이익 = 회사 장부상 → 시장 → `none`. 회사 분기 값은 직접 행 우선 · 없으면 회사 누계 차이(`quarterize` · `derived=true` — 각주 「회사 발표 누계 차이로 계산」). `market` 칸에는 같은 해 회사 누계(반기·연간 장부상·조정)를 `company_cumulative` 로 붙인다(각주 재료). 영업이익률 = 고른 영업이익 ÷ 고른 매출 · 매출이 회사 값이면 전년 대비도 다시 잰다. `financials` 에 없는 분기도 회사 값이 있으면 점을 만든다. 통화가 다른 회사 행·주당 값은 쓰지 않는다. 조정 지표 줄 재료는 `adjusted: {metric, name, value_bn}[]`. 🔴 출처는 «읽을 때» 고른다 — 회사 값이 나중에 적재되면(소급 공표) 같은 `financials` 입력으로도 그 칸이 시장 → 회사로 바뀌고, 입력(DB 의 yfinance 값)은 건드리지 않는다(시험 「뒤늦게 적재」). 국내 4곳(`dart_corp_code` 가 있는 회사)은 부르지 않는다 — `getCustomerIr` 가 `earningsRule: 'company_first' | 'financials'` 를 함께 돌려준다.
- `today` 는 서울 날짜 문자열(`YYYY-MM-DD`)을 인자로 받는다 — 함수 안에서 `new Date()` 금지. `todaySeoul()` 은 레포에 **없다**(2026-11-09 grep 0건 · `lib/currentYear.ts:14`·`lib/hansae/data.ts:90` 이 그 자리에서 직접 계산) → `lib/currentYear.ts` 에 `export function todaySeoul(): string { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); }` 를 새로 두고 화면은 이것만 쓴다(기존 두 곳은 건드리지 않는다).

- [ ] **Step 1: 시험 먼저** — `ir.test.ts`(가짜 회사 `Acme Motors` · 숫자는 임의 — 스텔란티스 실물과 같은 꼴만 빌렸다):

```ts
// lib/customers/ir.test.ts
import { describe, expect, it } from 'vitest';
import { latestGuidance, nextEarnings, pickEarnings, quarterize, type ReportedRow } from './ir';
import type { CustomerEarnings, CustomerEarningsPoint } from './types';

describe('quarterize', () => {
  it('누계를 빼서 분기를 만든다(포르쉐형)', () => {
    const q = quarterize([
      { period_grain: 'quarter', period: '2026-Q1', value: 60 },
      { period_grain: 'ytd', period: '2026-6M', value: 130 },
      { period_grain: 'ytd', period: '2026-9M', value: 180 },
    ]);
    expect(q).toEqual([
      { period: '2026-Q1', value: 60, derived: false },
      { period: '2026-Q2', value: 70, derived: true },
      { period: '2026-Q3', value: 50, derived: true },
    ]);
  });
  it('빼기 재료가 없으면 만들지 않는다', () => {
    expect(quarterize([{ period_grain: 'ytd', period: '2026-9M', value: 180 }])).toEqual([]);
  });
  it('분기 행이 있으면 누계 차이보다 우선', () => {
    const q = quarterize([
      { period_grain: 'quarter', period: '2026-Q3', value: 51 },
      { period_grain: 'ytd', period: '2026-6M', value: 130 },
      { period_grain: 'ytd', period: '2026-9M', value: 180 },
    ]);
    expect(q.find((p) => p.period === '2026-Q3')).toEqual({
      period: '2026-Q3',
      value: 51,
      derived: false,
    });
  });
});

describe('latestGuidance', () => {
  it('검증 안 된 행은 버리고 최신 FY 의 최신 행 + 이력', () => {
    const cards = latestGuidance([
      {
        metric: 'deliveries',
        metric_label: 'Vehicles Delivered',
        period: 'FY2026',
        low: 62000,
        high: 67000,
        value_text: null,
        unit: 'units',
        direction: 'initiated',
        published_at: '2026-02-12',
        verified: true,
      },
      {
        metric: 'deliveries',
        metric_label: 'Vehicles Delivered',
        period: 'FY2026',
        low: 65000,
        high: 70000,
        value_text: null,
        unit: 'units',
        direction: 'raised',
        published_at: '2026-07-02',
        verified: true,
      },
      {
        metric: 'deliveries',
        metric_label: 'Vehicles Delivered',
        period: 'FY2026',
        low: 1,
        high: 2,
        value_text: null,
        unit: 'units',
        direction: 'lowered',
        published_at: '2026-08-01',
        verified: false,
      },
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].current.low).toBe(65000);
    expect(cards[0].history.map((h) => h.direction)).toEqual(['initiated', 'raised']);
  });
});

describe('nextEarnings', () => {
  it('미래 일정이 있으면 확정', () => {
    expect(nextEarnings([{ period: '2026-Q3', event_date: '2026-10-29' }], '2026-10-01')).toEqual({
      period: '2026-Q3',
      date: '2026-10-29',
      estimated: false,
    });
  });
  it('없으면 작년 같은 분기 + 1년 = 추정', () => {
    expect(
      nextEarnings(
        [
          { period: '2025-Q4', event_date: '2026-02-12' },
          { period: '2026-Q3', event_date: '2026-10-29' },
        ],
        '2026-11-09'
      )
    ).toEqual({ period: '2026-Q4', date: '2027-02-12', estimated: true });
  });
});

// ---------------------------------------------------------------- pickEarnings(선택 7차) — 가짜 회사 Acme Motors · 숫자는 임의
const pt = (
  y: number,
  q: number,
  rev: number | null,
  op: number | null,
  net: number | null
): CustomerEarningsPoint => ({
  period_label: `${y}Q${q}`,
  fiscal_year: y,
  fiscal_quarter: q,
  revenue_bn: rev,
  operating_income_bn: op,
  operating_margin_pct: rev && op != null ? (op / rev) * 100 : null,
  net_income_bn: net,
  revenue_yoy_pct: null,
});
const earn = (quarterly: CustomerEarningsPoint[]): CustomerEarnings => ({
  currency: 'EUR',
  quarterly,
  annual: [],
});
const row = (
  period: string,
  metric: string,
  basis: 'reported' | 'adjusted',
  value: number,
  extra: Partial<ReportedRow> = {}
): ReportedRow => ({
  period_grain: period.endsWith('M') ? 'ytd' : /-Q\d$/.test(period) ? 'quarter' : 'year',
  period,
  metric,
  metric_name: metric === 'aoi' ? 'Adjusted operating income/(loss)' : metric,
  basis,
  value,
  unit: 'million',
  currency: 'EUR',
  ...extra,
});

describe('pickEarnings', () => {
  it('회사 장부상 값이 있으면 시장 값보다 우선(값이 달라도) · 영업이익률도 회사 값으로', () => {
    const out = pickEarnings(earn([pt(2025, 1, 35.8, 5.4, 4.0)]), [
      row('2025-Q1', 'revenue', 'reported', 35813),
      row('2025-Q1', 'operating_income', 'reported', -316),
      row('2025-Q1', 'net_income', 'reported', -387),
    ]);
    const p = out.quarterly[0];
    expect(p.operating_income_bn).toBeCloseTo(-0.316);
    expect(p.net_income_bn).toBeCloseTo(-0.387);
    expect(p.operating_margin_pct).toBeCloseTo((-316 / 35813) * 100);
    expect(p.origin).toEqual({
      revenue: { source: 'company_reported' },
      operating_income: { source: 'company_reported' },
      net_income: { source: 'company_reported' },
    });
  });

  it('장부상이 없으면 회사 조정 영업이익 · 회사가 쓴 이름을 내려 준다', () => {
    const p = pickEarnings(earn([pt(2025, 1, 35.8, 5.4, null)]), [
      row('2025-Q1', 'aoi', 'adjusted', 327),
    ]).quarterly[0];
    expect(p.operating_income_bn).toBeCloseTo(0.327);
    expect(p.origin?.operating_income).toEqual({
      source: 'company_adjusted',
      metric_name: 'Adjusted operating income/(loss)',
    });
    expect(p.adjusted).toEqual([
      { metric: 'aoi', name: 'Adjusted operating income/(loss)', value_bn: 0.327 },
    ]);
    expect(p.origin?.revenue).toEqual({ source: 'market' });
  });

  it('회사가 그 분기 이익을 어디에도 안 냈을 때만 시장 값 + 같은 해 회사 누계(각주 재료)', () => {
    const p = pickEarnings(earn([pt(2025, 1, 35.8, 1.1, 0.9)]), [
      row('2025-6M', 'operating_income', 'reported', -2710),
      row('2025-6M', 'aoi', 'adjusted', 540),
    ]).quarterly[0];
    expect(p.operating_income_bn).toBeCloseTo(1.1);
    expect(p.origin?.operating_income).toEqual({
      source: 'market',
      company_cumulative: [
        { period: '2025-6M', metric_name: 'operating_income', basis: 'reported', value_bn: -2.71 },
        {
          period: '2025-6M',
          metric_name: 'Adjusted operating income/(loss)',
          basis: 'adjusted',
          value_bn: 0.54,
        },
      ],
    });
  });

  it('누계 차이로 만든 회사 분기는 시장 값보다 우선이고 derived 를 표시한다', () => {
    const p = pickEarnings(earn([pt(2025, 1, 35.8, 1.1, null), pt(2025, 2, 38.4, 2.0, null)]), [
      row('2025-Q1', 'operating_income', 'reported', -316),
      row('2025-6M', 'operating_income', 'reported', -2710),
    ]).quarterly[1];
    expect(p.operating_income_bn).toBeCloseTo(-2.394);
    expect(p.origin?.operating_income).toEqual({ source: 'company_reported', derived: true });
  });

  it('어디에도 없으면 none(「미발표」) · financials 에 없는 분기는 회사 값으로 점을 만든다', () => {
    const out = pickEarnings(earn([pt(2025, 1, 35.8, null, null)]), [
      row('2025-Q2', 'revenue', 'reported', 38448),
    ]);
    expect(out.quarterly[0].origin?.operating_income).toEqual({ source: 'none' });
    expect(out.quarterly[0].operating_income_bn).toBeNull();
    expect(out.quarterly.map((p) => p.period_label)).toEqual(['2025Q1', '2025Q2']);
    expect(out.quarterly[1].revenue_bn).toBeCloseTo(38.448);
  });

  it('회사 값이 뒤늦게 적재되면 같은 입력의 그 칸이 시장 → 회사로 바뀐다(소급 공표)', () => {
    const fin = earn([pt(2025, 3, 37.2, 2.6, 1.9)]);
    expect(pickEarnings(fin, []).quarterly[0].origin?.operating_income.source).toBe('market');
    const after = pickEarnings(fin, [row('2025-Q3', 'operating_income', 'reported', -2455)])
      .quarterly[0];
    expect(after.origin?.operating_income.source).toBe('company_reported');
    expect(after.operating_income_bn).toBeCloseTo(-2.455);
    expect(fin.quarterly[0].operating_income_bn).toBe(2.6); // 입력(= DB 의 yfinance 값)은 건드리지 않는다
  });

  it('통화가 다른 회사 행·주당 값은 쓰지 않는다', () => {
    const p = pickEarnings(earn([pt(2025, 1, 35.8, 1.1, null)]), [
      row('2025-Q1', 'operating_income', 'reported', 999, { currency: 'USD' }),
      row('2025-Q1', 'eps_adjusted', 'adjusted', 1.2, { unit: 'per_share' }),
    ]).quarterly[0];
    expect(p.origin?.operating_income.source).toBe('market');
    expect(p.adjusted).toBeUndefined();
  });

  it('매출 출처가 회사면 전년 대비를 고른 값으로 다시 잰다', () => {
    const out = pickEarnings(earn([pt(2024, 1, 40, null, null), pt(2025, 1, null, null, null)]), [
      row('2025-Q1', 'revenue', 'reported', 44000),
    ]);
    expect(out.quarterly[1].revenue_yoy_pct).toBeCloseTo(10);
  });
});
```

Run: `npx vitest run lib/customers/ir.test.ts` → FAIL(모듈 없음).

- [ ] **Step 2: `ir.ts` 구현** — 시제품(위 시험 14건 PASS · `tsc --strict` 통과 · 2026-11-09 스크래치에서 실행). 타입은 `types.ts` 에:

```ts
// lib/customers/types.ts (추가분)
// CustomerEarningsPoint 끝에 선택 칸 2개 — 1단계 호출부는 그대로 컴파일된다
//   origin?: EarningsOrigin;   // 칸마다 출처(해외만 · pickEarnings). 없으면 1단계 그대로(financials)
//   adjusted?: { metric: string; name: string; value_bn: number }[];   // 그 분기 회사 발표 조정 영업이익(회사 이름 그대로)
// 그리고 파일 끝에:
/** 칸의 출처. 회사 장부상 → 회사 조정 영업이익 → 시장 데이터(yfinance) → 없음(「미발표」). */
export type EarningsSource = 'company_reported' | 'company_adjusted' | 'market' | 'none';
export interface CumulativeNote {
  period: string; // 2025-6M · 2025
  metric_name: string;
  basis: 'reported' | 'adjusted';
  value_bn: number;
}
export interface CellOrigin {
  source: EarningsSource;
  /** 회사 누계 차이로 계산한 분기(H1 − Q1 등). */
  derived?: boolean;
  /** 회사가 쓴 이름(조정 지표일 때 각주에 그대로). */
  metric_name?: string;
  /** source='market' 일 때 같은 해 회사 발표 누계(반기·연간) — 각주 「회사 발표 반기 값 …」. */
  company_cumulative?: CumulativeNote[];
}
export interface EarningsOrigin {
  revenue: CellOrigin;
  operating_income: CellOrigin;
  net_income: CellOrigin;
}

export interface CustomerEarnings {
  /** 표·차트에 쓴 통화. 재무 행이 없으면 null. */
  currency: string | null;
  quarterly: CustomerEarningsPoint[];
  annual: CustomerEarningsPoint[];
}

export interface PricePoint {
  trade_date: string; // 'YYYY-MM-DD'
  close: number;
}

export interface PriceReturns {
  lastClose: number | null;
  lastDate: string | null;
  /** 마지막 종가 vs 한 달 전 날짜 이전 마지막 거래일 종가, %. */
  return1mPct: number | null;
  /** 마지막 종가 vs 전년 마지막 거래일 종가, %. */
  returnYtdPct: number | null;
}
```

```ts
// lib/customers/ir.ts
import type { CellOrigin, CumulativeNote, CustomerEarnings, CustomerEarningsPoint } from './types';

// ---------------------------------------------------------------- 누계 → 분기
export interface IrSeriesRow {
  period_grain: 'quarter' | 'ytd' | 'year';
  period: string; // 2026-Q3 · 2026-6M · 2026
  value: number;
}
export interface QuarterPoint {
  period: string; // 2026-Q3
  value: number;
  /** 누계끼리 빼서 만든 값(회사가 분기 값을 따로 내지 않았다). */
  derived: boolean;
}

/**
 * 분기 행은 그대로, 누계(ytd·year)는 이웃 누계를 빼 분기를 만든다(derived=true).
 * Q1 = 분기 행 또는 3M · Q2 = 6M − Q1 · Q3 = 9M − 6M · Q4 = 연간 − 9M. 재료가 하나라도 없으면 만들지 않는다(추정 금지).
 */
export function quarterize(rows: IrSeriesRow[]): QuarterPoint[] {
  const direct = new Map<string, number>();
  const cum = new Map<string, number>(); // `${y}|${n}` → n 분기까지 누계
  for (const r of rows) {
    if (r.period_grain === 'quarter') direct.set(r.period, r.value);
    else if (r.period_grain === 'year') cum.set(`${r.period}|4`, r.value);
    else {
      const m = /^(\d{4})-(3|6|9)M$/.exec(r.period);
      if (m) cum.set(`${m[1]}|${Number(m[2]) / 3}`, r.value);
    }
  }
  const years = new Set<string>();
  for (const k of [...direct.keys()]) years.add(k.slice(0, 4));
  for (const k of [...cum.keys()]) years.add(k.slice(0, 4));
  const out: QuarterPoint[] = [];
  for (const y of [...years].sort()) {
    // Q1 은 분기 행이 곧 누계
    const c = (n: number) =>
      n === 0 ? 0 : n === 1 ? (direct.get(`${y}-Q1`) ?? cum.get(`${y}|1`)) : cum.get(`${y}|${n}`);
    for (let q = 1; q <= 4; q++) {
      const period = `${y}-Q${q}`;
      const d = direct.get(period);
      if (d != null) out.push({ period, value: d, derived: false });
      else if (q === 1 && cum.get(`${y}|1`) != null)
        out.push({ period, value: cum.get(`${y}|1`)!, derived: false });
      else {
        const hi = c(q);
        const lo = c(q - 1);
        if (q > 1 && hi != null && lo != null) out.push({ period, value: hi - lo, derived: true });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- 가이던스
export interface GuidanceRowTs {
  metric: string;
  metric_label: string;
  period: string;
  low: number | null;
  high: number | null;
  value_text: string | null;
  unit: string;
  direction: string | null;
  published_at: string;
  verified: boolean;
}
export interface GuidanceCard {
  metric: string;
  current: GuidanceRowTs;
  history: GuidanceRowTs[];
}

export function latestGuidance(rows: GuidanceRowTs[]): GuidanceCard[] {
  const ok = rows.filter((r) => r.verified);
  const byMetric = new Map<string, GuidanceRowTs[]>();
  for (const r of ok) byMetric.set(r.metric, [...(byMetric.get(r.metric) ?? []), r]);
  const cards: GuidanceCard[] = [];
  for (const [metric, list] of byMetric) {
    const fy = list
      .map((r) => r.period)
      .sort()
      .at(-1)!;
    const history = list
      .filter((r) => r.period === fy)
      .sort((a, b) => a.published_at.localeCompare(b.published_at));
    cards.push({ metric, current: history.at(-1)!, history });
  }
  return cards;
}

// ---------------------------------------------------------------- 다음 실적 일정
export interface EarningsDateRow {
  period: string; // 2026-Q3 · 2026-FY
  event_date: string;
}
export interface NextEarnings {
  period: string;
  date: string;
  estimated: boolean;
}
const qKey = (p: string) => p.replace(/-FY$/, '-Q4');

export function nextEarnings(rows: EarningsDateRow[], today: string): NextEarnings | null {
  const future = rows
    .filter((r) => r.event_date >= today)
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
  if (future.length > 0)
    return { period: future[0].period, date: future[0].event_date, estimated: false };
  const last = [...rows].sort((a, b) => qKey(a.period).localeCompare(qKey(b.period))).at(-1);
  const m = last && /^(\d{4})-Q([1-4])$/.exec(qKey(last.period));
  if (!m) return null;
  const [y, q] = [Number(m[1]), Number(m[2])];
  const next = q === 4 ? { y: y + 1, q: 1 } : { y, q: q + 1 };
  const prev = rows.find((r) => qKey(r.period) === `${next.y - 1}-Q${next.q}`);
  if (!prev) return null;
  const date = `${Number(prev.event_date.slice(0, 4)) + 1}${prev.event_date.slice(4)}`;
  return { period: `${next.y}-Q${next.q}`, date, estimated: true };
}

// ---------------------------------------------------------------- 실적 칸 출처 고르기(선택 7차)
export interface ReportedRow {
  period_grain: 'quarter' | 'ytd' | 'year';
  period: string;
  metric: string;
  metric_name: string;
  basis: 'reported' | 'adjusted';
  value: number;
  unit: 'million' | 'billion' | 'per_share';
  currency: string;
}
/** 장부상 영업이익이 없을 때 대신 쓰는 회사 조정 영업이익 — 앞의 것이 먼저. EBITDA 는 영업이익이 아니라 넣지 않는다. */
export const ADJUSTED_OPERATING_METRICS = ['ebit_adjusted', 'aoi', 'operating_result_bsi'] as const;

const bn = (r: { value: number; unit: string }) =>
  r.unit === 'million' ? r.value / 1000 : r.value;

type Pick = { value_bn: number; derived: boolean; metric_name: string };

/** metric 하나의 회사 값: 분기 = 직접 행 우선 · 없으면 누계 차이 / 연간 = year 행. */
function companySeries(rows: ReportedRow[], metric: string, quarterly: boolean): Map<string, Pick> {
  const mine = rows.filter((r) => r.metric === metric);
  const out = new Map<string, Pick>();
  if (mine.length === 0) return out;
  const name = mine.find((r) => r.period_grain === 'quarter')?.metric_name ?? mine[0].metric_name;
  if (quarterly) {
    for (const p of quarterize(
      mine.map((r) => ({ period_grain: r.period_grain, period: r.period, value: bn(r) }))
    ))
      out.set(p.period, { value_bn: p.value, derived: p.derived, metric_name: name });
  } else {
    for (const r of mine.filter((x) => x.period_grain === 'year'))
      out.set(r.period, { value_bn: bn(r), derived: false, metric_name: r.metric_name });
  }
  return out;
}

function cumulativeNotes(
  rows: ReportedRow[],
  year: number,
  metrics: readonly string[]
): CumulativeNote[] {
  return rows
    .filter(
      (r) =>
        metrics.includes(r.metric) &&
        r.period_grain !== 'quarter' &&
        r.period.startsWith(String(year))
    )
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((r) => ({
      period: r.period,
      metric_name: r.metric_name,
      basis: r.basis,
      value_bn: bn(r),
    }));
}

/**
 * 해외 회사 실적 점의 매출·영업이익·순이익을 출처 순서대로 고르고, 칸마다 출처를 `origin` 에 내려 준다.
 * - 매출·순이익: 회사 장부상 → 시장 데이터 → 없음
 * - 영업이익: 회사 장부상 → 회사 조정 영업이익(ADJUSTED_OPERATING_METRICS 순) → 시장 데이터 → 없음
 * - 영업이익률 = 고른 영업이익 ÷ 고른 매출(둘 중 하나라도 없으면 null)
 * - 회사 값만 있고 financials 점이 없는 분기도 점을 만든다
 * 출처는 «읽을 때» 고른다 — DB 의 yfinance 행은 그대로 두고, 회사 값이 나중에 적재되면 다음 렌더부터 그 칸이 회사 값으로 바뀐다.
 * 통화가 다른 회사 행(financials 통화 ≠ 공시 통화)은 쓰지 않는다. 주당 값(per_share)은 여기서 다루지 않는다.
 */
export function pickEarnings(
  earnings: CustomerEarnings,
  reported: ReportedRow[]
): CustomerEarnings {
  const currency =
    earnings.currency ?? reported.find((r) => r.unit !== 'per_share')?.currency ?? null;
  const rows = reported.filter((r) => r.currency === currency && r.unit !== 'per_share');
  const reportedRows = rows.filter((r) => r.basis === 'reported');
  return {
    currency,
    quarterly: pickPoints(earnings.quarterly, rows, reportedRows, true),
    annual: pickPoints(earnings.annual, rows, reportedRows, false),
  };
}

function pickPoints(
  points: CustomerEarningsPoint[],
  rows: ReportedRow[],
  reportedRows: ReportedRow[],
  quarterly: boolean
): CustomerEarningsPoint[] {
  const key = (y: number, q: number | null) => (quarterly ? `${y}-Q${q}` : String(y));
  const rev = companySeries(reportedRows, 'revenue', quarterly);
  const op = companySeries(reportedRows, 'operating_income', quarterly);
  const net = companySeries(reportedRows, 'net_income', quarterly);
  const adj = ADJUSTED_OPERATING_METRICS.map((m) =>
    companySeries(
      rows.filter((r) => r.basis === 'adjusted'),
      m,
      quarterly
    )
  );

  // financials 점 + 회사 값만 있는 기간
  const base = new Map(points.map((p) => [key(p.fiscal_year, p.fiscal_quarter), p]));
  for (const k of [
    ...rev.keys(),
    ...op.keys(),
    ...net.keys(),
    ...adj.flatMap((a) => [...a.keys()]),
  ]) {
    if (base.has(k)) continue;
    const m = /^(\d{4})(?:-Q([1-4]))?$/.exec(k);
    if (!m) continue;
    const [y, q] = [Number(m[1]), m[2] ? Number(m[2]) : null];
    base.set(k, {
      period_label: quarterly ? `${y}Q${q}` : String(y),
      fiscal_year: y,
      fiscal_quarter: q,
      revenue_bn: null,
      operating_income_bn: null,
      operating_margin_pct: null,
      net_income_bn: null,
      revenue_yoy_pct: null,
    });
  }

  const opMetrics = ['operating_income', ...ADJUSTED_OPERATING_METRICS];
  const chosen = new Map<string, CustomerEarningsPoint>();
  for (const [k, p] of base) {
    const cell = (company: Pick | undefined, market: number | null, metrics: readonly string[]) => {
      if (company) {
        const o: CellOrigin = { source: 'company_reported' };
        if (company.derived) o.derived = true;
        return { v: company.value_bn, o };
      }
      if (market != null) {
        const notes = cumulativeNotes(rows, p.fiscal_year, metrics);
        const o: CellOrigin = { source: 'market' };
        if (notes.length > 0) o.company_cumulative = notes;
        return { v: market, o };
      }
      return { v: null, o: { source: 'none' } as CellOrigin };
    };
    const r = cell(rev.get(k), p.revenue_bn, ['revenue']);
    const n = cell(net.get(k), p.net_income_bn, ['net_income']);
    let o = cell(op.get(k), p.operating_income_bn, opMetrics);
    if (!op.get(k)) {
      const a = adj.map((s) => s.get(k)).find((x) => x != null);
      if (a) {
        const origin: CellOrigin = { source: 'company_adjusted', metric_name: a.metric_name };
        if (a.derived) origin.derived = true;
        o = { v: a.value_bn, o: origin };
      }
    }
    const margin = o.v != null && r.v != null && r.v !== 0 ? (o.v / r.v) * 100 : null;
    const adjusted = ADJUSTED_OPERATING_METRICS.flatMap((m, i) => {
      const a = adj[i].get(k);
      return a && !a.derived
        ? [{ metric: m as string, name: a.metric_name, value_bn: a.value_bn }]
        : [];
    });
    chosen.set(k, {
      ...p,
      revenue_bn: r.v,
      operating_income_bn: o.v,
      operating_margin_pct: margin,
      net_income_bn: n.v,
      origin: { revenue: r.o, operating_income: o.o, net_income: n.o },
      ...(adjusted.length > 0 ? { adjusted } : {}),
    });
  }

  // 매출 출처가 회사로 바뀐 점만 전년 대비를 다시 잰다(시장 값 그대로인 점은 1단계 값 유지)
  const out = [...chosen.values()].sort(
    (a, b) =>
      a.fiscal_year * 10 + (a.fiscal_quarter ?? 5) - (b.fiscal_year * 10 + (b.fiscal_quarter ?? 5))
  );
  for (const p of out) {
    if (p.origin?.revenue.source !== 'company_reported') continue;
    const prev = chosen.get(key(p.fiscal_year - 1, p.fiscal_quarter));
    p.revenue_yoy_pct =
      p.revenue_bn != null && prev?.revenue_bn != null && prev.revenue_bn > 0
        ? ((p.revenue_bn - prev.revenue_bn) / prev.revenue_bn) * 100
        : p.revenue_yoy_pct;
  }
  return out;
}
```

Run: `npx vitest run lib/customers/ir.test.ts` → PASS.

- [ ] **Step 3: `source.ts` — `getCustomerIr(slug)`**

```ts
export async function getCustomerIr(slug: string): Promise<CustomerIr | null> {
  'use cache';
  cacheLife('days');
  cacheTag('customer_accounts');
  cacheTag('customer_documents');
  cacheTag('customer_guidance');
  cacheTag('customer_volume_ir');
  cacheTag('customer_reported_results');
  cacheTag('customer_earnings_dates');
  cacheTag('customer_collect_status');
  // 1) customer_accounts 에서 company_id(slug) — confidentialDb
  // 2) 6개 표를 company_id 로 — 전부 confidentialDb.from(...), 화면에 쓰는 칸만 select
  //    guidance·volume·reported 는 .eq('verified', true) · documents 는 최근 40건(published_at desc, id desc)
  //    다중 페이지가 필요한 표는 PK 전체로 .order()
  // 3) 순수 함수로 접어 반환(quarterize · latestGuidance · nextEarnings는 화면에서 today 를 넣는다)
  //    reported 는 grain 전부(quarter·ytd·year — pickEarnings 가 누계 차이·각주 재료로 쓴다)
  //    earningsRule = companies.dart_corp_code 가 있으면 'financials'(국내 4곳 그대로) · 없으면 'company_first'
}
```

요약 화면용 `getCustomersOverview()` 에는 회사별 「최근 가이던스 변경」(가장 최근 `direction in ('raised','lowered')` 행 1개: metric_label·direction·published_at)과 「다가오는 실적 일정」 재료를 더한다 — 같은 6개 태그를 붙인다. 🔴 `cacheTag('exchange_rates_live')` 금지.

- [ ] **Step 4: 검사** — Run: `npm run typecheck` · `npx vitest run lib/customers` → PASS. `scripts/venv/Scripts/python.exe scripts/verify_revalidate_tags.py; echo "EXIT=$?"` → 0(Task 1 에서 미뤄 둔 확인).
- [ ] **Step 5: Commit** — `git add lib/customers/ir.ts lib/customers/ir.test.ts lib/customers/types.ts lib/customers/source.ts lib/currentYear.ts` · `git commit -m "feat(고객사): 공식 문서 조회 계층 — 누계→분기·최신 가이던스·다음 일정·실적 칸 출처 고르기"`

---

### Task 14: 화면 — 개별 4절 + 요약 2열

**Files:**

- Create: `components/customers/CustomerGuidanceCards.tsx` · `CustomerDocumentList.tsx` · `CustomerVolumeCompare.tsx` · `CustomerEarningsSchedule.tsx`
- Modify: `components/customers/CustomerEarningsTable.tsx` · `CustomersOverviewTable.tsx` · `app/customers/[slug]/page.tsx` · `app/customers/page.tsx` · `components/oem-companies/common/CompanyTimeSeriesChart.tsx` · `CompanyTimeSeriesChartInner.tsx` · `lib/customers/format.ts`(+test)

착수 전 정독: `docs/chart-guide.md`(§4-F 콤보 · §5 글자 크기) · 1단계 화면 두 파일. 새 차트 없음. 🔴 Next.js 16: 서버 컴포넌트(페이지·`CustomersOverviewTable`)는 `'use client'` 파일의 «함수»를 값으로 import 해 부르지 않는다 — `nextEarnings`·`latestGuidance`·표시 함수는 지시어 없는 `lib/customers/*.ts` 에서 import 한다.

| 절                        | 구성                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 재사용                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 실적(기존 절 보강)        | 해외는 `earningsRule='company_first'` 면 페이지에서 `pickEarnings(earnings, ir.reported)` 결과로 표·차트(영업이익률 선 포함)를 그린다 · 국내는 지금 그대로. 칸 각주는 `origin` 으로: `company_adjusted` → 「회사 발표 조정 영업이익(<metric_name>) — 장부상 미발표」 · `market` → 「회사 미발표 · 시장 데이터 추정」 + `company_cumulative` 가 있으면 「회사 발표 <반기·연간> <이름> <값>」 · `derived` → 「회사 발표 누계 차이로 계산」 · `none` → 「미발표」 · `company_reported` 는 각주 없음. 「회사 발표 조정 지표」 줄(회사 이름 그대로 · 예 `EBIT-adjusted`) | `CustomerEarningsTable` 에 선택 인자 `adjustedRows`·`footnotes`(각주 문장은 `lib/customers/format.ts` 의 신규 `originNote(origin)` — vitest) · 차트는 같은 점 배열을 넘길 뿐 |
| 가이던스 카드 + 변경 이력 | 카드 = metric_label · 범위(또는 문구) · 기준(조정/장부) · 방향 배지(상향 초록 · 하향 빨강 · 유지 회색 · 최초 파랑) · 공시일 · 원문 인용 접기 · 같은 metric 의 최근 실적 조정 지표 한 줄 · 이력 목록(오래된 것부터) · metric 이 바뀐 경우 「전망 기준 변경」                                                                                                                                                                                                                                                                                                         | 신규                                                                                                                                                                         |
| 물량 비교                 | MarkLines(1단계 그래프)와 회사 발표 계열을 한 차트에 · 「정의 차이」 상자(`definition` 문구 · 누계 차이로 만든 분기는 「계산값」) · 빈패스트 「자동차만(전기 이륜차 제외)」                                                                                                                                                                                                                                                                                                                                                                                         | `CompanyTimeSeriesChart`·`Inner` 에 선택 인자 `secondary?: { label; monthly?; annual? }`(기본값 없음 = 지금 동작 그대로) · 상자는 신규                                       |
| 다음 실적 일정            | 날짜 · 대상 분기 · 「추정」 표시 · 출처                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 신규(작은 상자)                                                                                                                                                              |
| 자료실 · 최근 동향        | 문서 목록(종류 배지 · 날짜 · 원문 링크 새 창) 위 · 기존 뉴스 아래                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `PopupNewsSection` 그대로                                                                                                                                                    |
| 수집 상태                 | `blocked`·`parse_failed` 가 있으면 절 머리에 사유 한 줄(예 GM IR 403)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 신규(문장 1줄)                                                                                                                                                               |

요약 표: 「최근 가이던스 변경」 열(상향 초록 ▲ · 하향 빨강 ▼ · 항목 이름 · 날짜) · 「다음 실적」 열(날짜 · 추정이면 흐리게). 🔴 `CustomersOverviewTable` 은 **서버 컴포넌트 그대로** — 1단계에서 `'use client'` 면 사외비 칸이 RSC payload 로 브라우저에 실려 일부러 서버로 바꿨다. 행 강조 없음(회사명 링크만 · 기존 그대로). 색은 기존 토큰(상승·하락) — 새 색 정의 금지.

- [ ] **Step 0: `CompanyTimeSeriesChart` 선택 인자** — Chart·Inner 두 파일에 `secondary?` 를 더한다(없으면 렌더 결과가 지금과 바이트 단위로 같게 — 조건부로만 두 번째 `<Line>`·범례 항목을 그린다 · 축·`fontSize` 는 chart-guide §5 그대로). Run: `grep -rn "CompanyTimeSeriesChart" app components` 로 기존 호출부를 모두 적고, `npm run typecheck` PASS + 헤드리스로 OEM 탭 2곳(`/oem/…` 기존 호출부 중 둘)을 변경 전·후 찍어 같은지 본다.
- [ ] **Step 1: 컴포넌트 4개** — 서버 컴포넌트 우선(상호작용은 인용 접기뿐 → `<details>`). 숫자 표시는 `lib/customers/format.ts` 에 «신규» 함수(`rangeText(low, high, unit)` · `amountText(value, unit, currency)`)를 더해 쓴다(지금 format.ts 엔 `pctText`·`pctClass` 뿐이고 실적 표의 `num` 은 파일 안 지역 함수) — vitest 먼저.
- [ ] **Step 2: 페이지 배치** — `[slug]/page.tsx` 에서 `getCustomerIr(slug)` 를 기존 조회와 `Promise.all` · `nextEarnings(..., todaySeoul())`(Task 13 이 `lib/currentYear.ts` 에 신설). 권한 판정(`canAccess('/customers', role)`)은 기존 그대로.
- [ ] **Step 3: 검사** — `npm run check-all` → PASS.
- [ ] **Step 4: 화면 확인(헤드리스 먼저)** — `npm run dev` 후 `~/.claude/scripts/headless_check.py` 로 `/customers`·`/customers/<GM slug>`·`<VFS slug>`·`<VW slug>` 를 찍어 Read 로 본다(로그인 쿠키는 `docs/gotchas-playwright-ui.md` 절차). 확인: ① 가이던스 카드에 GM `EBIT-adjusted 14.5~15.5 십억 달러` 상향/유지 배지 ⑦ 스텔란티스 2025 Q1·Q2·Q3 영업이익 = −0.316 · −2.394 · −2.455(십억 유로 · 각주 없음 = 회사 장부상) · 순이익 −0.387 · −1.869 · −2.068 ② 빈패스트 물량에 이륜차 수치 없음 ③ GM 자료실 머리에 IR 차단 사유(probe 실패 시) ④ 요약 표 두 열 ⑤ 다크 모드. ⑥ Step 0 의 OEM 탭 2곳이 변경 전과 같다.
- [ ] **Step 5: Commit** — `git add components/customers app/customers components/oem-companies/common/CompanyTimeSeriesChart.tsx components/oem-companies/common/CompanyTimeSeriesChartInner.tsx lib/customers/format.ts lib/customers/format.test.ts` · `git commit -m "feat(고객사): 가이던스 카드·자료실·물량 비교·실적 일정 화면"`

---

### Task 15: 문서 · 표본 대조 · 마무리

- [ ] **Step 1: Codex 원문 대조(설계서 「2단계 완료」 조건)** — 가이던스 표본 3사(GM · 폭스바겐 · 현대차 — 코드 2 + 국내 1) × 최근 2개 문서의 `customer_guidance` 행을 원문 URL 과 함께 `codex-delegate` 로 넘겨 값·기간·방향을 대조. 불일치는 파서 MUST_HIT 에 실물을 넣고 고친다.
- [ ] **Step 2: 수집기 MUST_HIT 전부 통과** — Run: `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib -q` · `npm run check-all` · `verify_revalidate_tags.py` · `verify_call_contracts.py` → 전부 0.
- [ ] **Step 3: 문서** — `Architecture.md`(§5 라우트 변경 없음 확인 · §7-G·§7-J · §10 · 부록 C `scripts/lib` 새 모듈 5개 · `scripts/customer_parsers/` 폴더) · `AGENTS.md` 「폴더별 약속」 한 줄(「고객사 숫자는 `customer_parsers` 코드 우선 · LLM 은 `llm_wants` 칸만 · 화면은 verified 만」) · `docs/gotchas-data-collection.md`(VW 독일식 소수점 · 스텔란티스 EDGAR 지역 표가 그림 · GM IR Akamai · VW 인도 천 대 반올림 · DART 전망 정정 문서의 정정 전 값).
- [ ] **Step 4: 사외비 grep** — `git diff master --stat` 범위의 모든 파일에 손익 고객명 grep(목록 = `참고/고객사/` 원본) → 0.
- [ ] **Step 5: `_결정이행.md`** 에 2단계 결정별 「그대로 / 변경 + 승인일」(아래 「판정 요청」 표의 결과 포함).
- [ ] **Step 6: Commit** — 문서만 경로 명시 커밋.

---

## 미확인 (착수 전·중에 확인할 것 — 지어내지 않음)

| 항목                                                 | 지금 아는 것                                                                         | 확인 방법 · 실패 시                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| GM IR(`investor.gm.com`) GHA 접근                    | 로컬 curl·Playwright·WebFetch 전부 403(Akamai)                                       | Task 12 probe · 실패 시 `blocked` + 화면 사유(실적 발표자료·미국 분기 소매 판매 미수집)                                    |
| GM 실적 일정                                         | IR 이벤트 페이지에만(403) · 8-K 에 예고 없음                                         | 위와 같음 · 실패 시 「추정」만                                                                                             |
| GM 미국 분기 판매(Deliveries)                        | IR 보도자료에만(`GM sales in Q3 totaled 670,974 vehicles` — 외부 크롤러로만 읽힘)    | 위와 같음                                                                                                                  |
| 스텔란티스 H1·FY 보도자료 열 머리                    | Q3 판만 실물 확인                                                                    | Task 9 Step 4                                                                                                              |
| 스텔란티스 IR 출하 표의 전사 합계 행 라벨            | 북미 라벨만 기존 코드에                                                              | Task 9 Step 3                                                                                                              |
| 스텔란티스 Investor Day 목표 · FY2026 실적일         | 미공표                                                                               | 공표되면 llm · 일정은 예고 6-K                                                                                             |
| 스텔란티스 연간(FY2024 등) 회사 장부상               | 소급 팩트시트는 2025 분기·반기·연간만 파싱 · FY 6-K 열 머리 미확인(위 줄)            | Task 9 Step 4 에서 FY 판 머리를 확인해 연간 행을 더한다 · 그 전까지 연간 칸은 `market` + 각주(지어내지 않음)               |
| 다른 회사의 «당일 미발표 → 소급 공표» 자료           | 스텔란티스 1건만 확인                                                                | 발견하면 Task 9 Step 3b 와 같은 `--add-file` 한 줄 + 그 회사 파서에 `fact_sheet` 읽기 · 화면은 자동으로 회사 값으로 바뀐다 |
| 스텔란티스 통화                                      | `companies.currency='USD'` · 보도자료는 EUR                                          | 실적 표는 `customer_reported_results.currency` 를 따른다 · `companies` 칸은 건드리지 않음                                  |
| 빈패스트 생산량 · 영업손실 · 실적 일정               | 영업손실 표는 VND·USD 열이 섞이고 열 묶음이 분기마다 다름 · 생산 공표 위치 못 찾음   | 범위 밖으로 두고 화면 「미수집」                                                                                           |
| 포르쉐 생산 대수 · FY2025 팩트시트 · 연차보고서 표   | 팩트시트 XLSX 는 2023Q1~ 있으나 FY2025 파일 미확인                                   | 착수 시 IR 표에서                                                                                                          |
| 폭스바겐 연간·Q1 판 KPI 표 · ad-hoc 전망 수정 문장꼴 | 9M·H1 만 실물                                                                        | Task 10 Step 3 회귀에서                                                                                                    |
| 폴라리스 발표자료 「Guidance – Key Metrics」 표      | PDF 텍스트가 줄 단위로 풀림 · 미시험                                                 | llm 칸으로                                                                                                                 |
| 폴라리스 Q4 Inc apiKey 안정성                        | 공개 키가 IR 화면 소스에 박혀 있음                                                   | 바뀌면 `ir_list` = error · 사유 표시                                                                                       |
| DART IR 개최 공시의 `pblntf_detail_ty`               | I003 으로 기록돼 있으나 재확인 안 함                                                 | Task 3 Step 3                                                                                                              |
| DART 웹 뷰어 첨부(발표자료 PDF)의 GHA 접근           | 조사 노트끼리 상충(repo_assets 「IP 차단」 vs korea.md 「쿠키+Referer 로 됨(로컬)」) | 이 계획은 뷰어를 안 쓰고 IR 사이트 PDF 로 우회                                                                             |
| DART 월 판매 «정정» 공시 표 구조                     | 실물 표본 없음                                                                       | 첫 정정 공시가 오면 MUST_HIT 추가                                                                                          |
| 현대 2025-09 전망 공시의 판매목표 줄                 | 그 달 문서에서 줄 누락 관측                                                          | Task 7 회귀 때 원문 대조                                                                                                   |
| 현대모비스 IR PDF 글 추출                            | 일부 PDF 추출 실패 관측                                                              | 실패 문서는 `failed` + 사유 · llm 에 이미지 입력은 범위 밖                                                                 |
| KGM 2025 docx 보도자료 · IR JSON 제목 칸 이름        | docx 파서 없음 · 제목 칸 미확인                                                      | docx 는 `not_target` · 칸은 Task 4 Step 1                                                                                  |
| 모델 ID `claude-sonnet-5-5`                          | 지시값 · 기존 스크립트는 `claude-sonnet-5`                                           | Task 11 착수 시 Context7·API 로 확인                                                                                       |
| EDGAR UA 연락처                                      | 기본값은 자리표시자                                                                  | 사용자가 Secret `SEC_USER_AGENT` 등록                                                                                      |
| Supabase 용량                                        | 문서 본문은 저장 안 함(링크) · 행 수만 늘어남                                        | 백필 뒤 표 크기 SQL 로 확인                                                                                                |
| VW 인도 보도자료의 지역 표                           | `World` 행만 사용                                                                    | 지역은 3단계                                                                                                               |

## 판정 요청 — 승인됨 2026-11-09

사용자 승인(2026-11-09): 1~10 은 아래 「이 계획의 처리」대로 · 손익 고객명과 글자가 같은 포르쉐 원문 라벨 `Porsche` 는 사외비 grep 예외.

| #   | 정한 것                                                                      | 실측·해석                                                                              | 이 계획의 처리(승인됨 2026-11-09)                                                            |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | 설계서 표: `customer_documents`·`customer_volume_ir`·`customer_guidance` 3개 | 회사 발표 실적(선택 6차) · 실적 일정 · 수집 상태(확인 실패 사유 표시)를 담을 칸이 없다 | 표 3개 추가(`customer_reported_results`·`customer_earnings_dates`·`customer_collect_status`) |
| 2   | 설계서 `customer_volume_ir` 칸                                               | 지역(GM GMNA/GMI · 빈패스트 베트남)과 정의 문구가 필요                                 | `region`·`definition`·`verified` 칸 추가                                                     |
| 3   | `customer_guidance` 에 `direction`                                           | 숫자로 비교 못 하는 문구 전망은 원문 낱말이 필요                                       | `stated` 칸 추가(방향은 여전히 코드가 정함)                                                  |
| 4   | 설계서 「유럽 IR 은 Playwright `collect_ir_sites.py`」                       | 독일 2곳 일반 HTTP 로 됨(지시로 이미 HTTP)                                             | 파일명도 `lib/ir_lists.py` 로(목록 어댑터)                                                   |
| 5   | 태스크 묶음 ④ 물량 파서 · ⑤ 가이던스 파서                                    | 같은 문서·같은 표에서 실적·물량·전망이 함께 나와 따로 짜면 내용을 두 번 받는다         | 회사 묶음(국내 · 미국 ① · 미국 ② · 독일)으로 나눔                                            |
| 6   | 빈패스트 «물량»은 자동차만                                                   | 가이던스에도 이륜차 목표가 있음                                                        | 가이던스에서도 이륜차 제외(LLM 힌트)                                                         |
| 7   | 「GHA 회사별 파일」(선택 5차)                                                | 워크플로 11개로 쪼갤지 · 파서만 회사별일지                                             | 워크플로 1개 + 회사별 matrix job(실패 격리) · 파서는 회사별 파일                             |
| 8   | 국내 월 판매 → `customer_volume_ir`                                          | 기존 `hyundai_sales` 등과 정의가 다를 수 있음(공장 판매 vs 도매)                       | 기존 표 그대로 · Task 7 Step 4 에서 대조만 하고 정의 문구로 남김                             |
| 9   | 조사 노트 상충: DART 웹 IP 차단 vs 뷰어 됨                                   | 어느 쪽이 GHA 에 맞는지 미확인                                                         | 뷰어를 쓰지 않는 경로로 설계(판정 불필요하나 기록)                                           |
| 10  | 백필 「최근 4분기(쉬우면 2년)」                                              | EDGAR·DART 는 2년이 쉬움 · IR 은 출처마다 다름                                         | 기본 400일 · `--backfill` 760일                                                              |
