# 고객사 페이지 수집 상세 (`/customers` 2단계)

이 파일은 `/customers` 화면에 나가는 **회사 공식 문서(EDGAR·DART·IR)와 거기서 뽑은 숫자**의 수집 흐름·표·약속·함정을 다룬다.
**고객사 수집기(`collect_customer_*.py`·`scripts/customer_parsers/`·아래 `scripts/lib` 모듈)를 고치기 전에 읽는다.**
라우트·사외비 표 명단은 [`Architecture.md`](../Architecture.md) §5·§7-G·§11, 실행 명령·종료 코드는 [`commands.md`](./commands.md) 「고객사 수집 종료 코드」,
결정과 승인 기록은 [`plans/2026-11-09-customers-page_결정이행.md`](./plans/2026-11-09-customers-page_결정이행.md), 구현 계획은 [`plans/2026-11-09-customers-page-phase2.md`](./plans/2026-11-09-customers-page-phase2.md).

> 🔴 **이 레포는 공개다.** OEM 이름은 써도 된다(사용자 선택 5차). 손익 고객명·매출 비중·공급 품목·「○○는 우리 고객」 류 문장은
> 코드·문서·커밋 메시지에 쓰지 않는다(사외비 표 `customer_accounts` 에만). 예외는 포르쉐 원문 라벨 `Porsche`(승인 2026-11-09) 하나.

---

## 흐름 — 목록 → 내용 → 화면

1. **목록** `scripts/collect_customer_docs.py` — EDGAR·DART·IR 사이트의 문서 목록 → `customer_documents`(본문은 받지 않는다 · 새 문서는 `pending`). IR 목록 중 실적 일정은 `customer_earnings_dates` 로 간다. 결과는 `customer_collect_status`.
2. **내용** `scripts/collect_customer_numbers.py` — `pending` 문서를 오래된 것부터: 자가 시험 → 내용 1회 받기 → 회사 파서 → (`llm_wants` 칸만) LLM → 어휘·기간 거르기 → 인용·숫자 대조 → 적재 → 가이던스 방향 재계산 → 상태.
3. **화면** `lib/customers/`(`source.ts` 서버 조회 · `ir.ts`·`earnings.ts`·`volume.ts` 순수 계산) → `components/customers/`. **`verified=true` 행만** 나간다. 해외 실적은 `pickCustomerEarnings` 가 칸마다 출처를 고른다(아래 「실적 화면 규칙」).
4. **정기 실행** GHA `collect-customer-docs.yml`(평일 1회 · 회사별 matrix job · 목록 → 숫자 순서). 2026-11-10 사용자 승인으로 커밋. 첫 실행 전 GitHub Secret `SEC_USER_AGENT`(연락처 있는 UA) 등록. 종료 코드 규약 = 파일 머리 주석 · `docs/commands.md`.

## 표 7개 — 전부 사외비

전부 RLS on + 정책 없음 → service_role 전용(`confidentialDb` · 명단 정본 = `lib/supabase/confidential.ts` 의 `CONFIDENTIAL_TABLES`). 캐시 태그 = 표 이름. `customer_collect_status`(`checked_at` 이 매번 바뀌어 제외) 외 2단계 5개는 `trg_skip_identical_update` 부착([`Architecture.md`](../Architecture.md) §7-J — 같은 값 upsert 는 0행 반환).

- `customer_accounts`(1단계 · 20261109000003) — 고객사 페이지 명단·손익 고객명 매핑. PK `company_id`(→ `companies.id`) · `slug` unique. 행은 로컬 1회 INSERT(공개 레포에 명단 없음).
- `customer_documents` — EDGAR·DART·IR 문서 목록. PK `id` · UNIQUE (`source`, `source_id`) · `parse_status` 로 추출 대기 판정 · `llm_attempts`(LLM 재시도 횟수, 3 이면 닫음 · 20261109000005)
- `customer_guidance` — 연간 가이던스(범위·문구). UNIQUE (`document_id`, `metric`, `period`) · `period` 는 `FY2026` 꼴 · `stated`(원문 낱말 — 방향은 코드가 정한다 · GM 은 지표를 특정한 문장만) · `value_text` = 숫자 없는 문장 전망 «또는» 숫자 행의 근사 구절(VW `around …` → 화면 「약」 — `value_text` 가 있다고 문장 전망으로 판정하지 말 것) · `currency`(null = 회사 보고 통화 · 외화 LLM 행만 KRW·USD·EUR·VND · 20261109000005)
- `customer_volume_ir` — 회사 공표 출하·인도·생산·도매·판매 물량. PK (`company_id`, `metric`, `region`, `period_grain`, `period`) · `definition`(정의 문구)
- `customer_reported_results` — 회사 발표 실적(회사가 쓴 지표 이름 그대로 · `basis` 장부상/조정). PK (`company_id`, `period_grain`, `period`, `metric`)
- `customer_earnings_dates` — 다음 실적 발표일. PK (`company_id`, `period`) · 기간은 `YYYY-Qn`·연간 `YYYY-FY`
- `customer_collect_status` — 수집기별 마지막 상태·화면용 사유(`blocked`「차단」·`parse_failed`「읽기 실패」·`error`「오류」 면 라벨과 사유를 화면에 보인다 — `ok`·`no_new` 만 조용하다). PK (`company_id`, `collector`)

마이그레이션 = `20261109000003`(명단) · `20261109000004`(6종 + `companies.sec_cik`) · `20261109000005`(`currency`·`llm_attempts`).

## 회사별 출처 — 코드 / LLM

정본 = 계획서 「회사별 코드/AI 표」. 코드가 뽑을 수 있는 칸에 LLM 을 쓰지 않는다(「코드로 수집할 수 있는 건 최대한 코드로」).

- **GM** — EDGAR 8-K. 가이던스·도매(분기·누계·GMNA/GMI)·실적(장부상 + EBIT-adjusted·EPS-diluted-adjusted) 전부 코드. IR 사이트는 차단(아래 함정) → 실적 일정은 추정.
- **리비안** — EDGAR 8-K. 전망 표 + 인도 보도자료 문장 · 생산·인도 · Adjusted EBITDA 전부 코드.
- **폴라리스** — EDGAR 8-K + IR 이벤트 JSON. 전망(BUSINESS OUTLOOK)은 코드, 컨퍼런스 발표자료만 LLM. 물량 미공표.
- **빈패스트** — EDGAR 6-K. 가이던스는 LLM · 물량은 **자동차만**(이륜차 제외 — 가이던스에서도 버린다) · 실적은 매출만.
- **스텔란티스** — EDGAR 6-K + IR. 가이던스 상자 3항목은 코드(「가이던스 확인·변경 없음」 문장은 `other` · `maintained` 행) · 연결 출하 · AOI. 2025 분기 이익은 소급 팩트시트 PDF 일회성 백필(`--add-file`).
- **폭스바겐** — IR RSS·financial-results·ad-hoc·ICS. Outlook 문장·인도(대)·판매·생산(천 대)·특수항목 전 영업이익·실적 일정 전부 코드, 문장꼴이 바뀌면 LLM.
- **포르쉐** — EQS JSON. 9M 문장·인도 누계·실적(누계) 코드, 3월 연간 전망은 LLM. 실적 일정 미공표 → 추정.
- **현대차·기아** — DART(전망 공시·[기재정정]·월 판매·잠정실적·IR 개최) 코드, 중장기·FCF PDF 는 LLM.
- **현대모비스** — DART 코드(잠정실적·IR 개최) · 수주 목표·중장기는 LLM. 물량 미공표.
- **KGM** — DART 월 판매·잠정 «별도» 코드 · CEO IR 발표자료는 LLM.

국내 4곳의 잠정실적은 대조용으로만 담는다(화면 실적은 기존 fnguide·DART 장부상 그대로).

## 실적 화면 규칙 (사용자 선택 6·7차)

- 해외 7곳의 매출·영업이익·순이익 = **회사 공시 우선**. 영업이익 = 회사 장부상 → 회사 조정치(`ebit_adjusted`·`aoi`·`operating_result_bsi` 순 · 각주) → 회사가 어디에도 안 냈을 때만 yfinance(`financials`) + 각주 → 「미발표」. 매출·순이익은 회사 장부상 → yfinance → 「미발표」. `net_income_parent` 도 회사 장부값으로 본다.
- 영업이익·조정 영업이익은 두 줄로 나란히 보인다(선택 6차). DB 의 yfinance 행은 지우지도 덮지도 않는다 — 고르기는 «읽을 때» 순수 함수가 한다.
- 가이던스 카드의 대표 FY = 올해(`currentYear()`) 이상 가장 가까운 FY · 더 먼 FY 는 `longer_term` 으로 따로(FY2030 목표가 올해 전망을 가리지 않게).

## 약속 — 어기면 조용히 깨진다

- 🔴 **숫자는 `customer_parsers` 코드 우선 · LLM 은 파서의 `llm_wants` 칸만 · 화면은 `verified=true` 만.** 코드 행도 LLM 행도 `quote_check` 를 지나야 참이다. 가이던스 방향은 LLM 이 아니라 `guidance_direction` 이 직전 verified 행과 숫자로 비교해 정한다.
- 🔴 **「새 문서인데 숫자 0개」는 exit 1**(파싱 실패). 「대상 아님」·LLM 재시도 대기·접근 차단(401·403)은 실패가 아니다(상태 표에 사유가 남는다). 종료 코드 표 = [`commands.md`](./commands.md).
- 🔴 **회사 상태 `parse_failed` 는 DB 의 닫힌 failed 문서로도 매긴다**(사유 「닫힌 실패 문서 N건 — --reparse 필요」) — 이번 실행의 실패만 보면 다음 날 다른 문서가 파싱돼 `ok` 로 덮인다. exit 1 은 그대로 «이번 실행에서 새로 생긴» 실패만.
- 🔴 **LLM 이 읽을 문서(`llm_wants`)인데 LLM 이 못 돈 실행(키 없음·`--no-llm`)은 문서를 닫지 않는다** — 판정과 무관하게 `pending` + note 「LLM 대기」(코드 행은 그때 싣는다 · 멱등) → 다음 실행이 다시 집는다. 상태 사유 「LLM 키 없음 n건」. 예전의 「parsed 인데 note 맨 앞 『LLM 대기 — 코드 행만 적재』」 표식은 없어졌다.
- **서식 미인식** — 숫자가 반드시 있어야 하는 문서(EDGAR 8-K Item 2.02 · 파서 `expects_numbers` — `kr_dart` 는 잠정실적)인데 코드가 서식을 못 알아봐 `not_target` 이면 note 「서식 미인식」 · 상태 사유 · GHA `::warning::`(exit 0). 분기 잠정 «범위»만 낸 2.02(폴라리스 2025-10-14 · 리비안 2026-07-06)는 일부러 안 읽는 문서라 새로 오면 한 번 뜬다.
- **LLM 안 돈 문서 찾기** — `parse_note like 'LLM 대기%'`(키 없음·`--no-llm`·재시도 대기 — 전부 `pending` 이라 다음 실행이 다시 집는다). 코드 문구가 빠져 LLM 이 메운 문서 = `parse_note like '%코드 문구 미스%'`. 서식 미인식 = `parse_note = '서식 미인식'`.

### `scripts/customer_parsers/`

고객사 문서 «내용» → 숫자 규칙 파서(회사별 모듈 + 등록부 `__init__.MODULE_NAMES`). 공통 틀 `base.py`(자료형·정규 어휘·기간 형식 `check_vocab`/`drop_off_vocab`·숫자 읽기) · `common.py`(표·문장 도우미). 오케스트레이터 = `collect_customer_numbers.py`(자가 시험 → pending 문서 → 파서 → 대조 → 적재 → 방향 재계산 → 상태), 시험 = `scripts/lib/test_customer_parsers.py`·`test_customer_numbers.py`. 🔴 **문서 상태 칸(`parse_status`·`parse_note`·`sha256`)은 이 오케스트레이터만 쓴다** · **등록부에 없는 회사의 문서는 pending 그대로**(not_target 으로 닫으면 나중에 생긴 파서가 못 본다) · **quote 는 값이 든 원문 연속 구간을 통째로**(`…` 뒤에 값만 붙이면 대조 실패) · 기간 표기는 표마다 하나(일정의 연간 발표 = `YYYY-FY`, `YYYY-Q4` 아님).

### `scripts/lib` 모듈 (부록 C 에서 이관 · 각 모듈 docstring 이 정본)

- `doc_text.py`·`edgar.py`·`dart_api.py`(공시·보도자료 원문 → 텍스트·표 행 / SEC EDGAR / DART OpenAPI 공용 — 고객사 수집기·스텔란티스 출하 수집기가 같이 쓴다. 🔴 **EDGAR 요청은 `edgar.edgar_get` 한곳**(UA=env `SEC_USER_AGENT` · 0.15초 간격 · 재시도) · **`companies.sec_cik` 에 넣는 CIK 는 `edgar.normalize_cik` 로 앞 0 없는 꼴**(칸 CHECK 가 `0000320193` 도 통과시켜 같은 회사가 두 꼴로 들어간다) · **DART 키는 예외·로그 문장에 넣지 않는다**(`raise_for_status` 문장은 쿼리째 URL 을 싣는다 → `dart_api._get` 경유) · `doc_text.pdf_text` 는 실패를 빈 문자열로 삼키지 않는다)
- `test_customer_docs_classify.py`(고객사 문서 목록 수집기 `scripts/collect_customer_docs.py` 의 문서 종류 분류·적재 칸·상태 판정 + `edgar.fetch_filings` 종류·날짜 거르기 시험. 🔴 **`customer_documents` upsert 에 `parse_status`·`sha256`·`first_seen_at` 을 싣지 않는다** — 실으면 이미 파싱한 문서가 재수집 때 `pending` 으로 돌아간다)
- `ir_lists.py`(고객사 IR 사이트 «문서 목록» 어댑터 — 폭스바겐·포르쉐·폴라리스·현대차·기아·현대모비스·KGM. 회사마다 받기 `fetch_*` 와 순수 `parse_*` 를 가르고 `test_ir_lists.py` 가 `fixtures/ir_lists/`(2026-11 실물을 자른 응답)로 본다. `source_id` 는 `ir_source_id()` 한 곳에서만 만든다(호스트+경로 · 쿼리 제외 · 모비스만 서버 파일명 — 다운로드 쿼리가 요청마다 바뀐다). 🔴 **날짜 칸 없는 목록(현대차·모비스)은 `_quarter` 로 내고 수집기가 같은 분기 DART «연결» 잠정실적 공시일로 채운다** — 월 판매 공시도 이름이 「영업(잠정)실적」이라 섞으면 날짜가 틀린다. KGM 발표자료는 같은 분기 보도자료 날짜(파일 올린 날은 재업로드면 한 달 늦어 안 쓴다). 못 찾으면 보류로 세고 지어내지 않는다. 하위 목록 하나가 0건이면 그 이름을 실은 `EmptyListError`. 실적 일정 기간은 `YYYY-Qn`·연간 `YYYY-FY`. GM IR 은 403 이라 어댑터 없이 `probe_gm()` 만)
- `quote_check.py`(인용·숫자 대조기 — 순수 함수, agents 규칙 이식. 고객사 파서가 뽑은 행의 quote 가 원문에 있고 값이 그 quote 안에 있는지 본다 → `check_row`·일정은 `check_date_row`. 🔴 **코드 행도 LLM 행도 이걸 지나야 `verified=true`** · 자가 시험 `self_test()`(MUST_HIT·MUST_MISS·DATE_HIT·DATE_MISS — 한국어 띄어쓰기 변이는 통과·활용형은 실패로 고정)를 본 실행 «전에» 부를 것)
- `guidance_direction.py`(가이던스 방향 raised·maintained·lowered·initiated·withdrawn — 같은 회사·metric·period 의 직전 «verified» 행과 숫자로 비교하는 순수 함수, `test_guidance_direction.py`. 🔴 **LLM 이 방향을 정하지 않는다** · 가운데값 상대 차 0.5% 이내는 maintained(범위 좁히기도 maintained — 원문 낱말보다 숫자가 우선) · 호출은 `collect_customer_numbers.py` 가 회사마다 전부 다시 매긴다)
- `llm_guidance.py`(고객사 가이던스 LLM 추출 — 코드 파서가 못 뽑는 칸(파서의 `llm_wants`)만. 모델 상수 `MODEL`(env `CUSTOMER_GUIDANCE_MODEL`, 기본 `claude-sonnet-5-5`) 한곳 · 구조화 출력 `SCHEMA` · `test_llm_guidance.py`. 🔴 **코드 우선**(같은 문서·metric·period 의 코드 행이 있으면 LLM 행을 버린다) · LLM 행도 `quote_check` 를 지나야 verified · 응답 중단(max_tokens·refusal)은 빈 목록이 아니라 예외(문서는 LLM 대기로 남는다) · 🔴 `quote_check` 는 배수 아무것으로나 수를 맞춰 보므로 규모·통화·기간이 틀린 행도 통과한다 → `screen` 이 돌려주기 전에 거른다(분기·반기 표지 · 원문 배수 낱말로 구한 절대값 ≠ low×단위 · 값에 붙은 외화 표지인데 `currency` 빈칸(값 뒤 괄호 환산은 그 값의 통화가 아니다) · CAGR · 숫자 `other` · 파서 `LLM_DROP` · 문서 발행 연도보다 앞선 해 · low > high) — 원문 'N억' 을 billion 으로 적은 행만 million 으로 환산. 🔴 `stated` 는 인용 대조 밖이라 quote 에 그 낱말 어간(raise·reaffirm·lower·withdraw·상향·유지 …)이 없으면 `stated` 만 지운다(방향 계산이 `withdrawn` 을 숫자보다 먼저 쓴다). 거른 수는 문서 note 「LLM 거름」)

## 수집 함정 (2026-11-09~10 실측)

- **VW 실적 표의 퍼센트 칸이 독일식 소수점이다**(반기 판 `–6,3` · 값 칸에 `–`). 숫자만 세면 열이 밀리고 `6,3` 을 63 으로 읽는다 → 숫자를 세지 않고 «칸 위치»로 읽는다.
- **VW 인도는 실적 표가 천 대 반올림(1,885) · 인도 보도자료는 대 단위(1,885,300)** 다. 실적 표 값을 인도 칸에 넣으면 같은 분기가 두 값으로 부딪친다 → 인도는 인도 보도자료만(실적 표 인도 행은 MUST_MISS). 판매·생산은 천 대 단위 발표라 정의 문구에 단위를 적는다.
- **스텔란티스 EDGAR 출하 보도자료의 지역 표는 그림(jpg)** 이라 글로 0행이다 → 분기 «합계»는 실적 보도자료 표에서, 북미는 기존 IR 수집기(`collect_stellantis_shipments_ir.py`)에서. FY2025 표 머리는 `units million` 으로 잘못 적혀 있어 값을 천 대로 검산해 읽었다.
- **GM IR(`investor.gm.com`)은 Akamai 차단** — 로컬 curl·Playwright·WebFetch 전부 403. 실제 Chrome `--headless=new` + UA 교체 + CDP fetch 로만 열렸고 GHA 러너 IP 에서는 미검증. 실패하면 `blocked` + 화면 사유(실적 발표자료·미국 분기 소매 판매 미수집). stellantis.com 도 curl 403 · Playwright 는 통과.
- **DART 전망 정정 공시(`[기재정정]`)에는 정정 전·후 값이 함께 있다** — 정정사항 표의 「정정전」 칸이 먼저 나와 그날의 가이던스로 잡힌 실사고(기아 2024-10-25 장래사업 정정 · 현대 전망 정정 4,158,300 → 4,000,000). 정정사항 표 «뒤»의 서식만 읽는다(`kr_dart._restated`) · 시험은 기대 칸만이 아니라 행 전부 일치로.
- **requests 는 charset 없는 `text/*` 에 ISO-8859-1 을 준다** → `€` 가 깨져 VW·포르쉐 정규식이 조용히 0건. 머리에 charset 이 없으면 추정 인코딩으로 디코딩한다(`collect_customer_numbers.fetch_content`).
- **LLM 이 원문 「N억」을 billion 으로 적어 10배 틀린 행이 대조를 통과했다**(`quote_check` 는 배수 아무것으로나 맞춰 본다) → `llm_guidance.screen` 의 규모 검사. 국문 △ 음수도 `numbers_in` 이 양수로 읽어 부호 반전이 통과하던 것을 막았다.
- **현대모비스 IR 다운로드 URL 의 `fileId` 는 요청마다 바뀐다** → 저장 URL 이 만료될 수 있다(note 「만료 가능 URL」 · 일시 실패로 보고 pending 유지). `source_id` 는 서버 파일명.
- **국내 월 판매 공시도 이름이 「영업(잠정)실적」이다** — 실적 공시와 이름으로 못 가른다. KGM 은 본문(「매출액 당해실적」)으로 가르고, IR 날짜는 같은 분기 «연결» 잠정실적 공시일로 채운다.
- **같은 날 같은 지표의 전망 공시가 둘이면 방향 비교를 하지 않는다**(현대 판매목표 두 공시가 방향이 갈렸다) · **지표가 바뀐 전망은 방향을 매기지 않는다**(VW 매출 전망이 증감률 `revenue_growth` → 금액 `revenue` 으로 바뀜 — 화면은 「전망 기준 변경」).
