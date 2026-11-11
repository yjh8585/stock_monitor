# 고객사 페이지 수집 상세 (`/customers` 2단계)

이 파일은 `/customers` 화면에 나가는 **회사 공식 문서(EDGAR·DART·IR)와 거기서 뽑은 숫자**의 수집 흐름·표·약속·함정을 다룬다.
**고객사 수집기(`collect_customer_*.py`·`scripts/customer_parsers/`·아래 `scripts/lib` 모듈)를 고치기 전에 읽는다.**
라우트·사외비 표 명단은 [`Architecture.md`](../Architecture.md) §5·§7-G·§11, 실행 명령·종료 코드는 [`commands.md`](./commands.md) 「고객사 수집 종료 코드」,
결정과 승인 기록은 [`plans/2026-11-09-customers-page_결정이행.md`](./plans/2026-11-09-customers-page_결정이행.md), 구현 계획은 [`plans/2026-11-09-customers-page-phase2.md`](./plans/2026-11-09-customers-page-phase2.md).
IR 확장(2026-11-10~11)의 계획·결정은 [`plans/2026-11-10-customers-ir-expansion.md`](./plans/2026-11-10-customers-ir-expansion.md) · [`_결정이행.md`](./plans/2026-11-10-customers-ir-expansion_결정이행.md).

> 🔴 **이 레포는 공개다.** OEM 이름은 써도 된다(사용자 선택 5차). 손익 고객명·매출 비중·공급 품목·「○○는 우리 고객」 류 문장은
> 코드·문서·커밋 메시지에 쓰지 않는다(사외비 표 `customer_accounts` 에만). 예외는 포르쉐 원문 라벨 `Porsche`(승인 2026-11-09) 하나.

---

## 흐름 — 목록 → 내용 → 화면

1. **목록** `scripts/collect_customer_docs.py` — EDGAR·DART·IR 사이트의 문서 목록 → `customer_documents`(본문은 받지 않는다 · 새 문서는 `pending`). IR 목록 중 실적 일정은 `customer_earnings_dates` 로 간다. 결과는 `customer_collect_status`.
2. **내용** `scripts/collect_customer_numbers.py` — `pending` 문서를 오래된 것부터: 자가 시험 → 내용 1회 받기 → 회사 파서 → (`llm_wants` 칸만) LLM → 어휘·기간 거르기 → 인용·숫자 대조 → 적재 → 가이던스 방향 재계산 → 상태.
3. **화면** `lib/customers/`(`source.ts` 서버 조회 · `ir.ts`·`earnings.ts`·`volume.ts` 순수 계산) → `components/customers/`. **`verified=true` 행만** 나간다. 해외 실적은 `pickCustomerEarnings` 가 칸마다 출처를 고른다(아래 「실적 화면 규칙」).
4. **정기 실행** GHA `collect-customer-docs.yml`(평일 1회 · 회사별 matrix job · 목록 → 숫자 순서). 2026-11-10 사용자 승인으로 커밋. 첫 실행 전 GitHub Secret `SEC_USER_AGENT`(연락처 있는 UA) 등록. 종료 코드 규약 = 파일 머리 주석 · `docs/commands.md`.
   **비용**(2026-11-11 실측 · Task 12): 러너는 공개 레포라 0원 · 돈이 드는 곳은 숫자 수집기의 LLM(`llm_guidance.extract` 한곳 · 새 문서 중 `llm_wants` 만)뿐이다. 32회 실측 = 호출당 입력 3천~5.2만 · 출력 9~1.4천 토큰 · 평균 약 $0.03. LLM 이 읽은 문서는 2년치 44건(연 약 22건) → **연 약 $0.6**(재시도 3회 상한을 다 써도 약 $2 · 입력 12만 자·출력 16,000 상한을 매번 채우는 이론 최댓값 약 $20). 새 문서가 없는 날은 호출 0.
5. **요약**(B 묶음 · 2026-11-12) — 문서 `scripts/summarize_customer_docs.py`(원문 받기는 `collect_customer_numbers.doc_content` 를 그대로 부른다 — 사본을 만들지 말 것) → `customer_doc_summaries`(+ 쪽 캡처 버킷 `customer-doc-pages`) · 뉴스 `scripts/summarize_customer_news.py` → `customer_news_weekly`(주 1개 · 그 주 기사 최신 150건). 규칙·금지·출력 정본 = `scripts/lib/customer_summary_prompt.py` · 검사 = `scripts/lib/customer_summary_check.py`(통과 못 하면 `check_failed` 로 남고 화면엔 안 보인다). 쪽 캡처 렌더·업로드가 실패하면 요약은 `ok` 로 두고 그 쪽만 `pages[].key = null`(사유는 `check_note`) — 화면·프록시는 그 쪽을 건너뛰고, 복구는 `summarize_customer_docs.py --retry-pages`(API 호출 0).
   🔴 **정기 실행은 새 문서만**(게시일 최근 14일 · 요약 행 없음)이고 뉴스는 지난 완결 주 하나 · `--backfill`(소급)은 사용자 승인 뒤 로컬 수동(비용 관문). 원문 받기 401·403·404·크기 초과는 경고(exit 0) — 행이 안 생겨 14일 창 안에서 다음 실행이 다시 집는다. GHA 배선(문서 수집 워크플로의 「요약」 step · 주간 뉴스 워크플로)은 **사용자 승인 대기**(2026-11-12 — 인프라 파일 게이트).

## 표 9개 — 전부 사외비

전부 RLS on + 정책 없음 → service_role 전용(`confidentialDb` · 명단 정본 = `lib/supabase/confidential.ts` 의 `CONFIDENTIAL_TABLES`). 캐시 태그 = 표 이름. `customer_collect_status`(`checked_at` 이 매번 바뀌어 제외) 외 2단계 5개는 `trg_skip_identical_update` 부착([`Architecture.md`](../Architecture.md) §7-J — 같은 값 upsert 는 0행 반환).

- `customer_accounts`(1단계 · 20261109000003) — 고객사 페이지 명단·손익 고객명 매핑. PK `company_id`(→ `companies.id`) · `slug` unique. 행은 로컬 1회 INSERT(공개 레포에 명단 없음).
- `customer_documents` — EDGAR·DART·IR 문서 목록. PK `id` · UNIQUE (`source`, `source_id`) · `parse_status` 로 추출 대기 판정 · `llm_attempts`(LLM 재시도 횟수, 3 이면 닫음 · 20261109000005)
- `customer_guidance` — 연간 가이던스(범위·문구). UNIQUE (`document_id`, `metric`, `period`) · `period` 는 `FY2026` 꼴 · `stated`(원문 낱말 — 방향은 코드가 정한다 · GM 은 지표를 특정한 문장만) · `value_text` = 숫자 없는 문장 전망 «또는» 숫자 행의 근사 구절(VW `around …` → 화면 「약」 — `value_text` 가 있다고 문장 전망으로 판정하지 말 것) · `currency`(null = 회사 보고 통화 · 외화 LLM 행만 KRW·USD·EUR·VND · 20261109000005)
- `customer_volume_ir` — 회사 공표 출하·인도·생산·도매·판매 물량. PK (`company_id`, `metric`, `region`, `period_grain`, `period`) · `definition`(정의 문구)
- `customer_reported_results` — 회사 발표 실적(회사가 쓴 지표 이름 그대로 · `basis` 장부상/조정). PK (`company_id`, `period_grain`, `period`, `metric`)
- `customer_earnings_dates` — 다음 실적 발표일. PK (`company_id`, `period`) · 기간은 `YYYY-Qn`·연간 `YYYY-FY`
- `customer_collect_status` — 수집기별 마지막 상태·화면용 사유(`blocked`「차단」·`parse_failed`「읽기 실패」·`error`「오류」 면 라벨과 사유를 화면에 보인다 — `ok`·`no_new` 만 조용하다). PK (`company_id`, `collector`)

- `customer_doc_summaries`(B · 20261111000001) — 문서 요약. PK `doc_id`(→ `customer_documents` cascade) · `status`·`importance`·`lines`·`evidence`·`pages`(쪽·캡션·캡처 키)·`c_materials`·`check_note`·`model`·`prompt_version`·토큰 수
- `customer_news_weekly`(B · 20261111000001) — 뉴스 주간 요약. PK (`company_id`, `week_start`) · `week_start` = KST 월요일 · `status`(ok·check_failed·empty)·`lines`·`links`·`news_count`·토큰 수

요약 2종은 API(LLM)가 만들고 검사기를 통과해야 `status='ok'` 다(검사 실패 행은 화면에 안 보인다). 요약기가 매번 `updated_at` 을 넣어 `trg_skip_identical_update` 는 붙이지 않는다. **버킷 `customer-doc-pages`**(비공개 · 정책 없음 → service_role 전용) = 요약 근거 쪽 PNG(`<company_id>/<doc_id>/p<쪽>.png` · PDF 문서만) · 열람은 인증 프록시 `/api/customers/doc-page/[docId]/[page]` 로만.

마이그레이션 = `20261109000003`(명단) · `20261109000004`(6종 + `companies.sec_cik`) · `20261109000005`(`currency`·`llm_attempts`) · `20261111000001`(요약 2종 + 버킷).

## 회사별 출처 — 코드 / LLM

정본 = 계획서 「회사별 코드/AI 표」. 코드가 뽑을 수 있는 칸에 LLM 을 쓰지 않는다(「코드로 수집할 수 있는 건 최대한 코드로」).

- **GM** — EDGAR 8-K. 가이던스·도매(분기·누계·GMNA/GMI)·실적(장부상 + EBIT-adjusted·EPS-diluted-adjusted) 전부 코드. 전망은 필수 3지표(조정) + 장부상 4지표(`net_income_parent`·`eps_diluted`·`automotive_operating_cash_flow`·`capex` — 전망 표 행이 먼저, 없으면 «전망 대조표»에서 · 아래 약속). **IR 사이트는 실제 Chrome(CDP) 어댑터**(아래 함정): 실적 덱·주주서한(링크만 · 날짜 = 같은 분기 EDGAR 실적 문서 접수일) · 미국 분기 인도 총계 `Deliveries` PDF(코드 · `GM Vehicle Total*` 행 → `region='us'`) · 다음 실적일(최신 실적 콜 상세의 일정 문장).
- **리비안** — EDGAR 8-K. 전망 표 + 인도 보도자료 문장 · 생산·인도 · Adjusted EBITDA 전부 코드. IR 목록(`__NEXT_DATA__`) = 분기 Shareholder Presentation·Letter · 행사 발표자료 — 링크만(날짜 = EDGAR 실적 문서 접수일).
- **폴라리스** — EDGAR 8-K + IR 이벤트 JSON. 전망(BUSINESS OUTLOOK)은 코드, 컨퍼런스 발표자료만 LLM. 물량 미공표.
- **빈패스트** — EDGAR 6-K. 가이던스는 LLM · 물량은 **자동차만**(이륜차 제외 — 가이던스에서도 버린다) · 실적은 매출만. IR 목록 = Our Reports 의 Earnings Report · 회사 소개 자료(판 이름이 연·월과 맞을 때만 PDF 작성일) · Mobility Day 발표 — 링크만. 게시된 증권사 리포트 원문은 넣지 않는다(D9).
- **스텔란티스** — EDGAR 6-K + IR. 가이던스 상자 3항목은 코드(「가이던스 확인·변경 없음」 문장은 `other` · `maintained` 행) · 연결 출하 · AOI. 2025 분기 이익은 소급 팩트시트 PDF 일회성 백필(`--add-file`). IR 자료실은 3단계(D8).
- **폭스바겐** — IR RSS·financial-results·ad-hoc·ICS·발표자료 갤러리. Outlook 문장(`around`·`about`·`approximately` = 근사 · 원문 구절이 `value_text`)·인도(대 · 전체 + **중국** `region='china'`)·판매·생산(천 대)·특수항목 전 영업이익·특수항목 전망(`special_items`)·조정 영업이익률 전망(`operating_margin_adjusted` · 문장이 밝힌 연도가 전망 연도와 같을 때만)·중국 합작사 영업 결과 몫(`china_jv_operating_result`)·실적 일정 전부 코드, 문장꼴이 바뀌면 LLM. 갤러리(로드쇼·Pre-Close Call·실적 콜·China Investor Update·Factbook)는 링크만. 1분기 인도 보도자료는 제목에 deliver 가 없어 «인도 표 PDF 를 올린 날과 같은 날의 RSS 글»로 고른다.
- **포르쉐** — EQS JSON + IR 보고서 표. 9M 문장·인도 누계·실적(누계) 코드, 3월 연간 전망은 LLM. **분기 단독 인도·매출·영업이익은 IR 팩트시트 XLSX**(`fact_sheet`/`fact-sheet-xlsx` · 코드). 보고서 표의 발표자료·Pre-Close Call·보고서와 CMD 2026 은 링크만. 실적 일정 = EQS-AFR 공고(Report Type · Date of disclosure — 연도는 공표일에서).
- **현대차·기아** — DART(전망 공시·[기재정정]·월 판매·잠정실적·IR 개최) 코드, 중장기·FCF PDF·**CEO Investor Day PDF** 는 LLM(D6 실측: 문서 1편 약 2.6만 자 · 잘림 없음). CID 날짜 = 현대 `pastIrEvent` 의 같은 해 CID 행사일(그 해 CID 가 둘이면 날짜 없음) · 기아 `ir-activity` 의 `periodStart`.
- **현대모비스** — DART 코드(잠정실적·IR 개최) · 중장기는 LLM. **수주 목표는 영문 실적 Script 에서 코드**(`annual order target of USD …` → `order_intake` · USD) — 목표 문장이 없는 Script 는 «서식 미인식»(E7). 원가율·현지화율은 3단계 신호 표(D5). 물량 미공표.
- **KGM** — DART 월 판매·잠정 «별도» 코드 · CEO IR 발표자료는 LLM. CEO IR설명회·Pressday 는 행사일이 공시 본문에만 있어 «날짜 없음» 유지(E8).

국내 4곳의 잠정실적은 대조용으로만 담는다(화면 실적은 기존 fnguide·DART 장부상 그대로).

## IR 확장 공통 규칙 (2026-11-10~11)

- **수집 대상(E1)** = 파서가 있거나 IR 어댑터가 있는 회사(`collect_customer_docs.select_targets` · GHA matrix 11곳). 대상에서 빠진 회사의 옛 문서·상태 행은 지우지 않는다.
- **목록에 넣는 것 ≠ 숫자로 읽는 것** — IR 목록 행은 자료실 링크로 다 보이지만, 숫자 수집은 파서의 `wants` 가 참인 것만 받는다. 새로 숫자로 읽는 IR 문서는 포르쉐 팩트시트 · 모비스 영문 Script · GM 미국 Deliveries PDF · 현대·기아 CEO Investor Day(LLM)뿐이고 나머지(덱·서한·갤러리·보고서·회사 소개)는 링크만.
- **새 문서 종류를 만들지 않는다(D4)** — 가까운 `doc_type` + `form` 에 세부 종류(`fact-sheet-xlsx`·`script`·`ceo-investor-day`·`ir-activity`·`us-deliveries`·`china-investor-update`·`pre-close-call` 등).
- **IR 문서 받기 상한 50MB(D2)** — `ir_lists.MAX_IR_BYTES`·`TooLarge`·`ir_get` 한곳(숫자 수집기·파서 자체 받기·GM Chrome 받기가 같이 쓴다). 넘으면 `not_target` + note 「크기 초과(N MB) — 링크만」 · exit 0 · 상태 사유 「크기 초과 n건」.
- **수동 닫기** `collect_customer_numbers.py --close DOC_ID --note "사유"` — 영구 받기 실패 문서를 `not_target` + 「수동 닫음: 사유」로. 문서 상태 칸은 이 스크립트만 쓴다는 약속의 연장 · 인자 오류·문서 없음·parsed 문서는 exit 2(parsed 를 닫으면 상태만 바뀌고 숫자가 화면에 남는다).
- **새 지표 키** — `eps_diluted`·`automotive_operating_cash_flow`(GM) · `special_items`·`operating_margin_adjusted`(VW 전망 · E2 는 3개가 아니라 4개) · `china_jv_operating_result`(VW 실적 · 누계 기간이 실적 표 누계와 같을 때만). DB 변경 없음(`base.METRICS` + `llm_guidance._METRIC_WORDS` 한 줄씩).
- **새 지역 키** — `customer_volume_ir.region` 의 `us`(GM 미국 분기 인도 총계)·`china`(VW 중국 인도 — 전체 인도가 가장 큰 표의 `China` 행만 · BEV 표의 `China` 는 안 읽는다). 화면 라벨 = `lib/customers/format.ts` `VOLUME_REGION`(`미국`·`중국`).
- **실적 일정 출처** — 회사마다 하나: DART(국내 4곳) · EDGAR(리비안·스텔란티스·빈패스트) · IR(폴라리스 이벤트 · VW ICS · 포르쉐 EQS-AFR · GM 실적 콜 상세). 2026-11-11 실측 65행에서 두 출처 이상인 회사가 0이라 우선순위 상수는 두지 않았다 — 같은 회사에 출처를 하나 더 붙이면 그때 우선순위를 정한다.
- **목록 행의 날짜** — 원문 날짜가 없으면 `_quarter` + `wait` 로 내고 수집기가 같은 분기의 실적 공시일로 채운다(`dart` = DART «연결» 잠정실적 · `edgar` = 그 분기 실적을 보고한 EDGAR 6-K/8-K 접수일 · `eqs` = 같은 분기 EQS 실적 보도). 못 채우면 보류로 세고 지어내지 않는다.

## 실적 화면 규칙 (사용자 선택 6·7차)

- 해외 7곳의 매출·영업이익·순이익 = **회사 공시 우선**. 영업이익 = 회사 장부상 → 회사 조정치(`ebit_adjusted`·`aoi`·`operating_result_bsi` 순 · 각주) → 회사가 어디에도 안 냈을 때만 yfinance(`financials`) + 각주 → 「미발표」. 매출·순이익은 회사 장부상 → yfinance → 「미발표」. `net_income_parent` 도 회사 장부값으로 본다.
- 영업이익·조정 영업이익은 두 줄로 나란히 보인다(선택 6차). DB 의 yfinance 행은 지우지도 덮지도 않는다 — 고르기는 «읽을 때» 순수 함수가 한다.
- 가이던스 카드의 대표 FY = 올해(`currentYear()`) 이상 가장 가까운 FY · 더 먼 FY 는 `longer_term` 으로 따로(FY2030 목표가 올해 전망을 가리지 않게).

## 약속 — 어기면 조용히 깨진다

- 🔴 **숫자는 `customer_parsers` 코드 우선 · LLM 은 파서의 `llm_wants` 칸만 · 화면은 `verified=true` 만.** 코드 행도 LLM 행도 `quote_check` 를 지나야 참이다. 가이던스 방향은 LLM 이 아니라 `guidance_direction` 이 직전 verified 행과 숫자로 비교해 정한다.
- 🔴 **「새 문서인데 숫자 0개」는 exit 1**(파싱 실패). 「대상 아님」·LLM 재시도 대기·접근 차단(401·403)은 실패가 아니다(상태 표에 사유가 남는다). 종료 코드 표 = [`commands.md`](./commands.md).
- 🔴 **회사 상태 `parse_failed` 는 DB 의 닫힌 failed 문서로도 매긴다**(사유 「닫힌 실패 문서 N건 — --reparse 필요」) — 이번 실행의 실패만 보면 다음 날 다른 문서가 파싱돼 `ok` 로 덮인다. exit 1 은 그대로 «이번 실행에서 새로 생긴» 실패만.
- 🔴 **LLM 이 읽을 문서(`llm_wants`)인데 LLM 이 못 돈 실행(키 없음·`--no-llm`)은 문서를 닫지 않는다** — 판정과 무관하게 `pending` + note 「LLM 대기」(코드 행은 그때 싣는다 · 멱등) → 다음 실행이 다시 집는다. 상태 사유 「LLM 키 없음 n건」. 예전의 「parsed 인데 note 맨 앞 『LLM 대기 — 코드 행만 적재』」 표식은 없어졌다.
- **서식 미인식** — 숫자가 반드시 있어야 하는 문서(EDGAR 8-K Item 2.02 · 파서 `expects_numbers(doc, content)` — `kr_dart` 는 잠정실적·모비스 Script)인데 코드가 서식을 못 알아봐 `not_target` 이면 note 「서식 미인식」 · 상태 사유 · GHA `::warning::`(exit 0). 분기 잠정 «범위»만 낸 2.02(폴라리스 2025-10-14 · 리비안 2026-07-06)는 일부러 안 읽는 문서라 **경고하지 않는다** — `common.edgar_202_expects_numbers` 가 본문의 Item 2.02 문단에 `preliminary results`·`preliminary and unaudited estimates` 가 있으면 «숫자 기대 안 함»으로 본다(2026-11-11 · `09c8bfd`).
- 🔴 **LLM 가이던스 행의 지표 키는 원문 낱말과 맞아야 verified** — 현대 CID 에서 LLM 이 「총주주환원율 35%」를 `free_cash_flow` 로 실어 대조를 통과한 실사고(2026-11-11). `llm_guidance.metric_mismatch` 가 (가) 비율 지표가 아닌 키에 `percent` (나) 키 낱말(`_METRIC_WORDS`)이 없음을 본다 — 낱말은 **quote 를 먼저**(각주 `(3)` 은 지우고) 보고, quote 가 숫자·단위뿐인 표 칸일 때만 라벨을 본다. 걸린 행은 버리지 않고 `verified=False` + note `metric_mismatch:<사유>`(문서 note 「LLM 거름 지표 불일치 N」). 낱말 규칙이 없는 키는 `metric_unverifiable`(확인 불가 = 미검증) — 자가 시험이 `METRICS` 전부에 규칙이 있는지 보므로 **새 지표 키를 넣으면 `_METRIC_WORDS` 도 한 줄** 더한다. 값 행이 «전부» LLM 행이고 그 전부가 지표 불일치인 문서는 같은 원문을 다시 물어도 무익해 **재시도 없이 failed**(note 맨 앞 「LLM 행 지표 불일치뿐 — 재시도 안 함」) · 인용 대조 실패가 하나라도 섞이면 지금처럼 재시도(상한 3) · 검증된 코드 값 행이 하나라도 있으면 문서는 parsed(exit 0)이고 불일치 LLM 행만 미검증으로 남는다.
- 🔴 **GM 장부상 4지표의 «전망 대조표»는 머리 연도가 맞아야 읽는다** — 머리 `Year Ending December 31, <연도>`(실적 대조표는 `Years Ended` 라 안 걸린다) · 값은 `Updated` 칸. 전망 표가 있으면 그 연도와 같은 대조표만, 전망 표가 없는 판(「guidance is unchanged」)은 **발표 연도와 같은 대조표**에서 새 4지표만(필수 3지표는 대조표에서 읽지 않는다). 지난해 표뿐 = 0행(실패 아님) · 대조표 연도가 발표 연도보다 뒤뿐이거나 연도를 못 읽음(`TBD`) = 문서 failed.
- **LLM 안 돈 문서 찾기** — `parse_note like 'LLM 대기%'`(키 없음·`--no-llm`·재시도 대기 — 전부 `pending` 이라 다음 실행이 다시 집는다). 코드 문구가 빠져 LLM 이 메운 문서 = `parse_note like '%코드 문구 미스%'`. 서식 미인식 = `parse_note = '서식 미인식'`.
- ⚠️ **`--reparse` 한 문서가 LLM 은 돌았는데 parsed 가 아니면(`not_target`·`failed`) 옛 가이던스 행이 남는다** — 선삭제는 싣기(`_store`)에서만 돈다. 정기 실행은 새 문서뿐이라 해당 없음. 2026-11-11 현대 1740 이 이 꼴로 옛 `free_cash_flow` 행(345)을 남겨 손으로 지웠다 → 다시 처리 뒤 그 문서 행 수를 확인한다.

### `scripts/customer_parsers/`

고객사 문서 «내용» → 숫자 규칙 파서(회사별 모듈 + 등록부 `__init__.MODULE_NAMES`). 공통 틀 `base.py`(자료형·정규 어휘·기간 형식 `check_vocab`/`drop_off_vocab`·숫자 읽기) · `common.py`(표·문장 도우미). 오케스트레이터 = `collect_customer_numbers.py`(자가 시험 → pending 문서 → 파서 → 대조 → 적재 → 방향 재계산 → 상태), 시험 = `scripts/lib/test_customer_parsers.py`·`test_customer_numbers.py`. 🔴 **문서 상태 칸(`parse_status`·`parse_note`·`sha256`)은 이 오케스트레이터만 쓴다** · **등록부에 없는 회사의 문서는 pending 그대로**(not_target 으로 닫으면 나중에 생긴 파서가 못 본다) · **quote 는 값이 든 원문 연속 구간을 통째로**(`…` 뒤에 값만 붙이면 대조 실패) · 기간 표기는 표마다 하나(일정의 연간 발표 = `YYYY-FY`, `YYYY-Q4` 아님).

### `scripts/lib` 모듈 (부록 C 에서 이관 · 각 모듈 docstring 이 정본)

- `doc_text.py`·`edgar.py`·`dart_api.py`(공시·보도자료 원문 → 텍스트·표 행 / SEC EDGAR / DART OpenAPI 공용 — 고객사 수집기·스텔란티스 출하 수집기가 같이 쓴다. 🔴 **EDGAR 요청은 `edgar.edgar_get` 한곳**(UA=env `SEC_USER_AGENT` · 0.15초 간격 · 재시도) · **`companies.sec_cik` 에 넣는 CIK 는 `edgar.normalize_cik` 로 앞 0 없는 꼴**(칸 CHECK 가 `0000320193` 도 통과시켜 같은 회사가 두 꼴로 들어간다) · **DART 키는 예외·로그 문장에 넣지 않는다**(`raise_for_status` 문장은 쿼리째 URL 을 싣는다 → `dart_api._get` 경유) · `doc_text.pdf_text` 는 실패를 빈 문자열로 삼키지 않는다)
- `test_customer_docs_classify.py`(고객사 문서 목록 수집기 `scripts/collect_customer_docs.py` 의 문서 종류 분류·적재 칸·상태 판정 + `edgar.fetch_filings` 종류·날짜 거르기 시험. 🔴 **`customer_documents` upsert 에 `parse_status`·`sha256`·`first_seen_at` 을 싣지 않는다** — 실으면 이미 파싱한 문서가 재수집 때 `pending` 으로 돌아간다)
- `ir_lists.py`(고객사 IR 사이트 «문서 목록» 어댑터 — 폭스바겐·포르쉐·폴라리스·현대차·기아·현대모비스·KGM·빈패스트·리비안·GM. IR 받기 공용 `MAX_IR_BYTES`·`TooLarge`·`ir_get`(50MB 상한)과 실제 Chrome 도우미 `_chrome_fetch`(임시 프로필 · 끝나면 프로세스·폴더 정리 · URL 당 시간 상한 · Chrome 없으면 `ChromeUnavailable`「Chrome 없음」)도 여기 있다 — 파서는 이것들을 `collect_customer_numbers.py` 가 아니라 여기서 import 한다(그 파일은 `__main__` 으로 돌아 import 하면 사본이 둘이 되고 `TooLarge` 의 `isinstance` 가 조용히 빗나간다). 회사마다 받기 `fetch_*` 와 순수 `parse_*` 를 가르고 `test_ir_lists.py` 가 `fixtures/ir_lists/`(2026-11 실물을 자른 응답)로 본다. `source_id` 는 `ir_source_id()` 한 곳에서만 만든다(호스트+경로 · 쿼리 제외 · 모비스만 서버 파일명 — 다운로드 쿼리가 요청마다 바뀐다). 🔴 **날짜 칸 없는 목록(현대차·모비스)은 `_quarter` 로 내고 수집기가 같은 분기 DART «연결» 잠정실적 공시일로 채운다** — 월 판매 공시도 이름이 「영업(잠정)실적」이라 섞으면 날짜가 틀린다. KGM 발표자료는 같은 분기 보도자료 날짜(파일 올린 날은 재업로드면 한 달 늦어 안 쓴다). 못 찾으면 보류로 세고 지어내지 않는다. 하위 목록 하나가 0건이면 그 이름을 실은 `EmptyListError`. 실적 일정 기간은 `YYYY-Qn`·연간 `YYYY-FY`. GM IR 은 일반 받기가 403 이라 `_chrome_fetch` 로만 받는다 · `probe_gm()` 은 requests → Playwright → CDP 결과를 로그로만 남기고 상태 표에 쓰지 않는다)
- `quote_check.py`(인용·숫자 대조기 — 순수 함수, agents 규칙 이식. 고객사 파서가 뽑은 행의 quote 가 원문에 있고 값이 그 quote 안에 있는지 본다 → `check_row`·일정은 `check_date_row`. 🔴 **코드 행도 LLM 행도 이걸 지나야 `verified=true`** · 자가 시험 `self_test()`(MUST_HIT·MUST_MISS·DATE_HIT·DATE_MISS — 한국어 띄어쓰기 변이는 통과·활용형은 실패로 고정)를 본 실행 «전에» 부를 것)
- `guidance_direction.py`(가이던스 방향 raised·maintained·lowered·initiated·withdrawn — 같은 회사·metric·period 의 직전 «verified» 행과 숫자로 비교하는 순수 함수, `test_guidance_direction.py`. 🔴 **LLM 이 방향을 정하지 않는다** · 가운데값 상대 차 0.5% 이내는 maintained(범위 좁히기도 maintained — 원문 낱말보다 숫자가 우선) · 호출은 `collect_customer_numbers.py` 가 회사마다 전부 다시 매긴다)
- `llm_guidance.py`(고객사 가이던스 LLM 추출 — 코드 파서가 못 뽑는 칸(파서의 `llm_wants`)만. 모델 상수 `MODEL`(env `CUSTOMER_GUIDANCE_MODEL`, 기본 `claude-sonnet-5-5`) 한곳 · 구조화 출력 `SCHEMA` · `test_llm_guidance.py`. 🔴 **코드 우선**(같은 문서·metric·period 의 코드 행이 있으면 LLM 행을 버린다) · LLM 행도 `quote_check` 를 지나야 verified · 응답 중단(max_tokens·refusal)은 빈 목록이 아니라 예외(문서는 LLM 대기로 남는다) · 🔴 `quote_check` 는 배수 아무것으로나 수를 맞춰 보므로 규모·통화·기간이 틀린 행도 통과한다 → `screen` 이 돌려주기 전에 거른다(분기·반기 표지 · 원문 배수 낱말로 구한 절대값 ≠ low×단위 · 값에 붙은 외화 표지인데 `currency` 빈칸(값 뒤 괄호 환산은 그 값의 통화가 아니다) · CAGR · 숫자 `other` · 파서 `LLM_DROP` · 문서 발행 연도보다 앞선 해(숫자 지표만 — 상태 행 `other` 는 남긴다) · low > high) — 원문 'N억' 을 billion 으로 적은 행만 million 으로 환산. 🔴 `stated` 는 인용 대조 밖이라 quote 에 그 낱말 어간(raise·increase·reaffirm·lower·trim·withdraw·상향·올린·유지·낮춘 … — 한국어 동사는 활용형을 낱낱이)이 없으면 `stated` 만 지운다(방향 계산이 `withdrawn` 을 숫자보다 먼저 쓴다). 거른 수는 문서 note 「LLM 거름」)
- `customer_summary_prompt.py`·`customer_summary_check.py`(문서·뉴스 요약 지시서 정본 · 검사기. 🔴 **검사기가 잡는 규칙은 지시서에도 같은 말로 적고, 지시서를 바꾸면 `PROMPT_VERSION` 을 올린다**) · `customer_doc_pages.py`(요약용 PDF 쪽 표식 글 · 지정 쪽 렌더 · 비공개 버킷 `customer-doc-pages` 업로드)

## 수집 함정 (2026-11-09~10 실측)

- **VW 실적 표의 퍼센트 칸이 독일식 소수점이다**(반기 판 `–6,3` · 값 칸에 `–`). 숫자만 세면 열이 밀리고 `6,3` 을 63 으로 읽는다 → 숫자를 세지 않고 «칸 위치»로 읽는다.
- **포르쉐 2024~2025 상반기 보도는 서식이 다르다**(2026-11-11 2년 백필 · `6ac2060`) — 매출 `Turnover` · 인도 `Deliveries` · 대수에 독일식 천 단위 점(`71.470`). 소수로 읽으면 71 대가 된다 → 대수는 천 단위 꼴만 받고(`porsche._units`) 소수 꼴은 failed. 대조기는 1천 배수를 허용해 `71.470` 인용이 71,470 을 덮는다.
- **기아 IR 목록이 죽은 링크를 건다**(2026-11-11) — 2025 CEO Investor Day 국문 발표·녹취 PDF 가 404. 목록에 다시 떠도 `--close` 로 닫혀 있다(2408·2409).
- **VW 인도는 실적 표가 천 대 반올림(1,885) · 인도 보도자료는 대 단위(1,885,300)** 다. 실적 표 값을 인도 칸에 넣으면 같은 분기가 두 값으로 부딪친다 → 인도는 인도 보도자료만(실적 표 인도 행은 MUST_MISS). 판매·생산은 천 대 단위 발표라 정의 문구에 단위를 적는다.
- **스텔란티스 EDGAR 출하 보도자료의 지역 표는 그림(jpg)** 이라 글로 0행이다 → 분기 «합계»는 실적 보도자료 표에서, 북미는 기존 IR 수집기(`collect_stellantis_shipments_ir.py`)에서. FY2025 표 머리는 `units million` 으로 잘못 적혀 있어 값을 천 대로 검산해 읽었다.
- **GM IR(`investor.gm.com`)은 Akamai 차단** — 로컬 curl·Playwright·WebFetch 전부 403. 실제 Chrome `--headless=new` + 브라우저 UA + 페이지 안 `fetch`(CDP)로만 열린다(2026-11-11 이 PC 전부 200 · 리눅스에선 `--no-sandbox`). 🔴 **GHA 러너에서 통하는지는 미확인** — 푸시 뒤 `workflow_dispatch` 의 `probe_gm_ir` 로 러너 결과(`google-chrome --version` · requests/Playwright/CDP 각 HTTP)를 본다. 막히면 D1 의 «사용자 PC» 갈래(PC 정기 실행은 결과를 본 뒤 정한다). 매일 실행에서 실패하면 GM `ir_list` 상태가 `blocked`(「IR 접근 차단(HTTP 403)」) 또는 `error`(「Chrome 없음」 · 기동·연결 실패는 `ConnectionError`)로 화면에 뜬다. stellantis.com 도 curl 403 · Playwright 는 통과.
- **GM IR 사이트 자체의 오류** — 분기 실적 표의 「Earnings Date」 칸은 `TBD`·연도 오기가 있어 안 쓴다(덱·서한 날짜는 EDGAR 접수일) · 같은 서한 파일이 두 분기에 걸린 칸은 어느 분기인지 몰라 둘 다 뺀다 · 칸이 밀린 해가 있어 링크는 칸 번호가 아니라 링크 글로 고른다 · 판매 목록 연도 필터 이름이 위젯 해시라 페이지 select 에서 읽는다 · 올해 판매 목록이 비는 것은 1월 한 달만 허용(`GM_FIRST_SALES_BY` · 사용자 선택 2026-11-11 · 2월 1일부터 0건은 멈춘다).
- **포르쉐 IR 의 PDF 링크는 뷰어 래퍼(`/pdf-viewer.aspx?…&src=…`)** — 그대로 두면 `ir_source_id` 가 쿼리를 버려 모든 PDF 가 한 키로 뭉개진다 → `src` 의 실제 파일로 푼다. 팩트시트 XLSX 는 판마다 칸 순서가 반대(최신이 왼쪽/오른쪽)이고 누계 블록 머리에 원문 오기가 있어 «머리 글이 전부 분기인 블록»만, 칸은 머리 글로 찾는다(셀 값은 원 단위 실수 · 보이는 글은 표시 형식 `#,##0,,` 로 만든다).
- **목록에 날짜가 없거나 틀린 IR** — 현대 CID 목록의 `createDate` 는 재업로드일(행사일 아님) · 모비스 영문 Script 링크엔 `fileNm` 이 없어 키를 분기로 만든다 · 빈패스트 6-K 는 «분기 끝 뒤 첫 실적 문서» 규칙이 틀린다(2분기 실적이 3분기 끝 뒤에 나옴) → 분기 = 그 문서가 보고한 기간.
- **DART 전망 정정 공시(`[기재정정]`)에는 정정 전·후 값이 함께 있다** — 정정사항 표의 「정정전」 칸이 먼저 나와 그날의 가이던스로 잡힌 실사고(기아 2024-10-25 장래사업 정정 · 현대 전망 정정 4,158,300 → 4,000,000). 정정사항 표 «뒤»의 서식만 읽는다(`kr_dart._restated`) · 시험은 기대 칸만이 아니라 행 전부 일치로.
- **requests 는 charset 없는 `text/*` 에 ISO-8859-1 을 준다** → `€` 가 깨져 VW·포르쉐 정규식이 조용히 0건. 머리에 charset 이 없으면 추정 인코딩으로 디코딩한다(`collect_customer_numbers.fetch_content`).
- **LLM 이 원문 「N억」을 billion 으로 적어 10배 틀린 행이 대조를 통과했다**(`quote_check` 는 배수 아무것으로나 맞춰 본다) → `llm_guidance.screen` 의 규모 검사. 국문 △ 음수도 `numbers_in` 이 양수로 읽어 부호 반전이 통과하던 것을 막았다.
- **현대모비스 IR 다운로드 URL 의 `fileId` 는 요청마다 바뀐다** → 저장 URL 이 만료될 수 있다(note 「만료 가능 URL」 · 일시 실패로 보고 pending 유지). `source_id` 는 서버 파일명.
- **국내 월 판매 공시도 이름이 「영업(잠정)실적」이다** — 실적 공시와 이름으로 못 가른다. KGM 은 본문(「매출액 당해실적」)으로 가르고, IR 날짜는 같은 분기 «연결» 잠정실적 공시일 또는 숫자 수집기가 분기 실적을 읽은 DART 공시일로 채운다(KGM 은 2025 부터 분기 실적 제목에 「연결재무제표기준」이 없다). KGM 자료실 파일 시각은 2024-12 재업로드분이 섞여 분기 끝 + 120일 밖이면 날짜로 쓰지 않는다.
- **같은 날 같은 지표의 전망 공시가 둘이면 방향 비교를 하지 않는다**(현대 판매목표 두 공시가 방향이 갈렸다) · **지표가 바뀐 전망은 방향을 매기지 않는다**(VW 매출 전망이 증감률 `revenue_growth` → 금액 `revenue` 으로 바뀜 — 화면은 「전망 기준 변경」).

### 요약(B) 함정 (2026-11-12 소급 실측)

- **`doc_text` 의 `Content.tables` 는 `[표[행[칸]]]` 세 겹이다** — 행 목록(두 겹)으로 읽으면 표가 있는 HTML·XLSX 원문(EDGAR 실적 보도자료·포르쉐 팩트시트)에서 `AttributeError` 로 죽는다. 표가 없는 PDF 로만 시험하면 안 걸린다(`b8125d4` · 회귀 시험 있음).
- **뉴스는 `NEWS_RETENTION_DAYS`(60일)가 지나면 지워진다** → 뉴스 주간 요약 소급은 약 10주가 끝이다(보존 연장은 하지 않기로 함 · 결정이행 B5). 기사 수가 적은 회사(포르쉐 60일 17건)는 빈 주(`empty`)가 생긴다 — 요약기가 아니라 뉴스 수집 질의 쪽 문제다.
- **IR 받기 상한(`ir_lists.MAX_IR_BYTES` 50MB)을 넘는 PDF 는 `TooLarge` 경고로 끝나고 요약이 없다**(리비안 주주서한 5건) — 실패가 아니라 exit 0 경고다(401·403·404 도 같은 갈래). 상한은 IR 확장 계획의 확정 결정 D2(`docs/plans/2026-11-10-customers-ir-expansion.md` — 넘으면 링크만)라 요약기에서 따로 올리지 않는다.
- **검사기 오탐 3갈래가 소급 17건을 막았다** — ① 쉼표 없는 4자리 연도(「2027년까지」)를 금액 후보로만 봤다 ② 표 머리에만 단위가 있는 표(「€ million」·「(%)」) ③ % 칸. 고친 뒤 저장된 결과를 API 없이 다시 검사하는 길이 `summarize_customer_docs.py --recheck` 다(원문 sha 가 바뀐 행은 건너뛴다). 검사기를 고치면 이것부터 돌린다.

## 남은 일 (2026-11-11 IR 확장 기준)

**3단계로 넘긴 것**

- 스텔란티스 분기 출하 «합계» 대조 — IR 원문은 Playwright 로만 열리고(일반 받기 403) 기존 출하 표엔 북미만 있어 대조할 합계가 없다(D8 과 함께).
- KGM CEO IR설명회·Pressday 행사일 — 공시 본문을 받아야 한다(E8 · 지금은 «날짜 없음»).
- 부문별·중기 수치(원가율·현지화율·EV 대수 목표 등) 신호 표(D5) · 기아 「비밀유지계약」 문구 PDF 캡처(D7) · VW 중국 서술형 동향 요약(E4).

**VW 중국 화면(사용자 결정 2026-11-11 · E9·E10)**

- 중국 인도(`region='china'`)는 MarkLines 비교 차트에 섞지 않고 **따로 분기 막대 차트**(`CustomerVolumeCompare` → `CompanyTimeSeriesChart` 를 `hideModeToggle`·`seriesLabel` 선택 인자로 재사용 · 점 = `ir.regionQuarterCharts`)로 보인다. 차트를 그리는 지역은 `REGION_CHART_REGIONS`(지금 `china` 뿐) — GM 북미 같은 다른 지역 계열은 분기 표의 줄로만 남는다.
- 중국 합작사 영업 결과 몫은 실적 표 아래 **한 줄**(가장 최근 기간 + 전년 같은 기간 · `ir.latestChinaJv`)이다. 연결 실적 밖 값이라 실적 표 칸·차트에는 넣지 않는다. 파서는 같은 문장 앞 절 «equity-accounted companies in China …;» 이 있을 때만 이 행을 만든다(다른 합작사 설명을 중국 값으로 싣지 않게).

**요약(B) — 남은 것 (2026-11-12)**

- 정기 실행(GHA)은 **승인 대기** — `collect-customer-docs.yml` 에 문서 요약 단계 추가 · `summarize-customer-news.yml` 신설. 그때까지는 로컬 수동 실행(명령 = [`docs/commands.md`](./commands.md)).
- 검사 실패로 남은 것: 문서 1건 · 뉴스 1주(VW 2026-10-19 주). 화면엔 안 보인다.
- Codex 검토에서 기록만 하고 안 고친 것(사소): 상세 30개 제한과 「최근 중요 문서」 앵커가 어긋날 수 있다 · 검사기 `SHORTCUT:` 5곳(`grep -n SHORTCUT: scripts/lib/customer_summary_check.py` — 표 머리 배수 넓힘 · % 머리 문서의 비-% 수 · 약한 연도 표기 · 누적 표기 · 표 안 금액 2027 을 연도로 통과) · 뉴스의 인과 서술은 기계 검사 밖 · 404 문서는 14일 창 동안 매일 경고 · `recentDoc` 30일 판정은 캐시 시점 기준.
