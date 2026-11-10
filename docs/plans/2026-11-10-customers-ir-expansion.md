# 고객사 IR 확장 구현 계획 (2026-11-10 · 공개 판)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2단계에서 EDGAR·DART·일부 IR 로 모으던 고객사 공식 문서를 IR 전용 자료(발표자료 갤러리·팩트시트·Investor Day·주주서한·영문 Script·실적 일정)까지 넓히고, 2단계에서 미룬 작은 결함과 지표 밖 연간 전망 6개를 함께 닫는다.

**Architecture:** 2단계 구조를 그대로 쓴다 — 문서 «목록»은 `scripts/collect_customer_docs.py` + `scripts/lib/ir_lists.py`(회사별 `fetch_<회사>` 받기 / 순수 `parse_<회사>`), 문서 «내용»은 `scripts/collect_customer_numbers.py` + `scripts/customer_parsers/<회사>.py`(코드 우선 · LLM 은 `llm_wants`/`llm_only` 칸만) + `scripts/lib/quote_check.py`(원문 대조). 새 표·새 마이그레이션은 없다. 목록에 넣기만 하고 파서 `wants()` 가 받지 않는 문서는 내려받지도 LLM 을 부르지도 않는다(자료실 링크만).

**Tech Stack:** Python 3.13(requests·BeautifulSoup·pymupdf·openpyxl·Playwright CDP) · 실제 Chrome(`--headless=new`) · GitHub Actions `collect-customer-docs.yml` · pytest · (화면은 원칙적으로 손대지 않는다 — 새 지표 키는 `metric_label` 원문으로 뜬다)

정본 문서: 설계 [`2026-11-09-customers-page.md`](./2026-11-09-customers-page.md) · 2단계 [`-phase2.md`](./2026-11-09-customers-page-phase2.md) · 앞 결정 [`_결정이행.md`](./2026-11-09-customers-page_결정이행.md)(2단계-a~ah) · 이 계획의 결정 이행 [`2026-11-10-customers-ir-expansion_결정이행.md`](./2026-11-10-customers-ir-expansion_결정이행.md) · 수집 규칙 [`docs/customers-collection.md`](../customers-collection.md) · 종료 코드 [`docs/commands.md`](../commands.md) 「고객사 수집 종료 코드」.
조사 원문(gitignore · 이 PC 에만): `참고/고객사/research/ir_expansion.md`(태스크 표 T1~T6 · 결정 D1~D9 — 이 계획의 바탕) · `ir_us.md` · `ir_foreign.md` · `ir_germany.md` · `ir_korea.md`. 실측 원문·URL·쪽 번호는 거기 있다 — 이 계획서엔 코드에 필요한 것만 옮긴다.

---

## 사용자 지시 원문 (요지 · 원문 = `참고/고객사/2026-11-09-customers-page_최초지시.md` 2026-11-10 절)

- 2026-11-10 IR 확장 결정 질문 답(원문 그대로):
  - D1 GM IR: 「GHA 시험 후 실패시 PC (추천)」
  - D2·D6 큰 PDF: 「50MB 상한 + AI 읽음 (추천)」
  - D7·D8: 「D7 넣어도 돼」 · D8 설명 뒤 「가로 해」(스텔란티스 IR 자료실 = 3단계)
  - D3·D4·D5·D9: 이의 없음 → 추천대로
- 2026-11-10 이 계획서 작성 전 질문 답:
  - 문서 목록 수집 대상: 「11곳으로 좁힘 (추천)」
  - 지표 목록 밖 연간 전망 6개(GM 순이익·조정 전 EPS·자동차 영업현금흐름·설비투자 · VW 특별 항목 제외 영업이익률 약 4%·특별 항목 약 €10bn): 「6개 모두 뽑음 (추천)」
  - 새 계획서 `docs/plans/2026-11-10-customers-ir-expansion.md` 로 따로 낼지: 「새 계획서로 (추천)」 — 2단계·설계서 확정 결정은 아래 「따르는 앞 결정」에 옮겨 적고 그대로 따른다.
  - 구현 뒤 GM·VW 문서와 상향·유지 표시 4줄(폴라리스 2·스텔란티스 2)을 바로 다시 처리할지: 「구현 뒤 바로 다시 처리 (추천)」
- 2026-11-10 추가 지시 원문(초안 보고 뒤):
  > - 폭스바겐은 중국시장에서 의 동향도 추가해.
  > - (노사 갈등·파업 추적 요청 — 특정 회사 공장 사례를 든 원문은 공개 판에서 가림 · 원문 = `참고/고객사/2026-11-09-customers-page_최초지시.md` 「추가 지시 (2026-11-10 · IR 확장 계획서 실행 승인 뒤)」)
  - 범위 질문 답: 실행 방식 「작업별 서브에이전트 (추천)」 · 노사 동향 「별도 계획서로 새 기능 (추천)」(이 계획 밖 — 아래 범위 밖 표) · 폭스바겐 중국 「숫자 + 자료 목록 (추천)」(→ Task 13)

## 확정된 결정

| #   | 결정                                                                                                                          | 출처           |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | -------------- |
| D1  | GM IR 은 GHA 에서 «통하는 조합»(실제 Chrome + 일반 UA + 페이지 안 fetch)으로 먼저 → 막히면 사용자 PC                          | 사용자 11-10   |
| D2  | IR 문서 내려받기 상한 50MB — 넘으면 링크만(자료실엔 보이고 숫자 대상에서 빠진다)                                              | 사용자 11-10   |
| D3  | 그림(이미지) PDF 를 AI vision 으로 읽지 않는다                                                                                | 추천대로 11-10 |
| D4  | 새 문서 종류(`doc_type`)를 만들지 않는다 — 가까운 종류 + `form` 에 세부 종류                                                  | 추천대로 11-10 |
| D5  | 부문별·중기 수치(EV 대수 목표·원가절감 % 등)는 3단계 신호 표 — 이번 지표에 안 넣는다                                          | 추천대로 11-10 |
| D6  | 현대·기아 CEO Investor Day PDF 는 LLM 이 읽는다 — 첫 문서에서 토큰·잘림 실측해 보고                                           | 사용자 11-10   |
| D7  | 기아 「비밀유지계약」 문구 PDF 도 3단계 캡처에 쓴다(이번 계획 영향 없음 — 목록 링크만)                                        | 사용자 11-10   |
| D8  | 스텔란티스 IR 자료실(Playwright)은 3단계 — 이번에 안 한다                                                                     | 사용자 11-10   |
| D9  | 빈패스트가 게시한 증권사 리포트 원문은 넣지 않는다                                                                            | 추천대로 11-10 |
| E1  | 문서 목록 수집 대상 = 파서가 있거나 IR 어댑터가 있는 회사(= GHA matrix 11곳). 이미 쌓인 포드 문서는 둔다                      | 사용자 11-10   |
| E2  | 지표 밖 연간 전망 6개를 뽑는다 — 기존 키에 붙는 것은 기존 키, 없는 것만 새 키(DB 변경 없음)                                   | 사용자 11-10   |
| E3  | 구현·검증이 끝나면 영향받는 기존 문서(GM·VW 전망 문서 · stated 4줄 문서)를 메인이 바로 `--reparse`                            | 사용자 11-10   |
| E4  | 폭스바겐 중국 = 회사 발표 숫자(분기 중국 인도 · 중국 합작사 이익 — 공개 시) + China Investor Update 목록. 서술형 동향은 3단계 | 사용자 11-10   |
| E5  | 고객사 노사 갈등·파업은 별도 계획서의 새 기능(이 계획 밖 · IR 확장 뒤)                                                        | 사용자 11-10   |

> E2 실측 보정(계획서 작성 중 발견): `customer_guidance` 는 `unique (document_id, metric, period)`(마이그레이션 `20261109000004` `:52`)라 VW ad-hoc 한 문서 안의 «장부 영업이익률(up to 1%)»과 «특별 항목 제외 영업이익률(about 4%)»이 같은 `operating_margin` 키면 충돌한다. 그래서 새 키는 사용자에게 말한 3개(`eps_diluted`·`automotive_operating_cash_flow`·`special_items`)에 `operating_margin_adjusted` 하나가 더해져 **4개**다. DB 구조 변경 없음은 그대로(metric 칸에 DB CHECK 없음 — 같은 마이그레이션 `:37`). 결정 이행 문서에 「변경」으로 적고 사용자에게 보고한다.

## 따르는 앞 결정 (설계서·2단계 — 이번 태스크가 건드리는 것만 · 정본 = `_결정이행.md`)

| 앞 결정   | 내용                                                                 | 이번에 걸리는 태스크                |
| --------- | -------------------------------------------------------------------- | ----------------------------------- |
| 2단계-a   | 회사별 파서를 공개 레포 + GHA 에 회사별 파일로                       | 전부                                |
| 2단계-c   | 영업이익·조정 영업이익 두 줄 병기(조정 지표는 회사가 쓴 이름 그대로) | 9                                   |
| 2단계-g   | 코드로 수집할 수 있는 건 최대한 코드로 · LLM 은 `llm_wants` 칸만     | 3·5·8·9                             |
| 2단계-k   | KGM 발표자료 날짜 = 같은 분기 보도자료 날짜, 없으면 보류             | 7                                   |
| 2단계-m   | 파서 없는 회사·대상 아닌 문서는 `pending` 유지(나중 파서가 보게)     | 2·4·8                               |
| 2단계-n   | 받기 실패: 일시(403·5xx)는 `pending`, 영구(404·410)만 `failed`       | 1(상한 초과는 새 갈래 — not_target) |
| 2단계-o   | 일정 기간 = `YYYY-Qn`·연간 `YYYY-FY`                                 | 6·8                                 |
| 2단계-s·w | `llm_wants` 문서는 「LLM 대기」 표식 · LLM 재시도 상한 3             | 5·12                                |
| 2단계-x   | LLM 이 낸 숫자 `other` 행은 버린다                                   | 5(D5 와 같은 방향)                  |
| 2단계-z   | 접근 차단(blocked)은 실패 대신 GHA 경고                              | 6·8                                 |
| 2단계-ag  | VW 「around」 근사 구절을 `value_text` 에 보존 → 화면 「약」         | 9·10                                |
| 2단계-ae  | 3단계로 넘김(스텔란티스 IR 자료실·세그먼트 수치·그림 PDF·캡처)       | 범위 밖 표                          |

## Global Constraints

- 🔴 **이 레포는 공개다.** OEM 이름은 코드·계획서에 써도 된다. **손익 고객명(`pnl_customers` 값)·매출 비중·공급 품목·「○○는 우리 고객」 류 문장은 코드·주석·시험 데이터·커밋 메시지·GHA 로그에 쓰지 않는다.** 시험 데이터의 사외비 쪽은 가짜 이름(`가나자동차`·`Acme Motors`). 포르쉐 원문 라벨 `Porsche` 는 승인된 예외 · 다른 하나는 약칭 KGM.
- 커밋 전 `git diff --cached` 에 손익 고객명이 없는지 grep(목록은 `참고/고객사/` 원본에서 읽는다 — 1·2단계와 같은 절차). `참고/` 아래 파일은 커밋하지 않는다(gitignore).
- 🔴 **코드 우선** — 표·고정 문구면 코드 파서, LLM 은 파서의 `llm_wants`/`llm_only` 칸만. 모델 상수는 `scripts/lib/llm_guidance.py` `MODEL` 한곳.
- 🔴 **화면에는 `verified=true` 만** · 파서·검사기마다 `MUST_HIT`/`MUST_MISS` 자가 시험을 본 실행 «전에» 돌리고 어긋나면 exit 2(2단계와 같다).
- 🔴 **조용한 0행 금지** — 표 머리를 알아봤는데 필수 칸이 없으면 문서 failed(2단계 GM `GUIDANCE_REQUIRED` 방식). 목록 하위 페이지 0건은 `EmptyListError`(`ir_lists.py` `_need`).
- 🔴 **차단(401·403)은 `BLOCKED_HTTP` 한곳**(`ir_lists.py:41`)으로 판정하고 `customer_collect_status.status='blocked'` + 사유 — 조용히 넘기지 않는다.
- 🔴 **문서 상태 칸(`parse_status`·`parse_note`·`sha256`)은 `collect_customer_numbers.py` 만 쓴다**(수동 닫기도 이 스크립트의 인자로 — Task 1).
- 날짜는 원문 근거가 있을 때만. 없으면 «날짜 없음»으로 보류(지어내지 않는다 · 2단계-k).
- 새 행의 `source_id` 는 `ir_lists.ir_source_id()` 한 곳. 서명 URL·매번 바뀌는 `fileId` 는 키에 쓰지 않는다.
- 🔴 **새 `scripts/lib/*.py` 모듈을 만들지 않는다** — `.githooks/pre-commit` 이 새 lib 모듈 커밋에 `AGENTS.md`/`Architecture.md` 동반을 요구하는데 `Architecture.md` 여유가 36B(150,939/150,975)다. Chrome CDP 도우미는 `scripts/lib/ir_lists.py` 안에 둔다. 고객사 서술은 `docs/customers-collection.md` 로.
- 🔴 **픽스처 추가 커밋도 같은 훅에 걸린다** — `ADDED_PATTERN` 이 `scripts/lib/.+` 전체를 본다(`.githooks/pre-commit:19` · 2단계 `f483017` 은 Architecture 를 함께 담았다). 새 픽스처는 구조 변경이 아니므로 그 커밋만 `SKIP_AGENTS_CHECK=1 git commit …` 으로 한 번 우회하고(AGENTS.md 가 정한 오탐 우회 변수) 보고서에 사유를 적는다. 새 `.py` 모듈에는 쓰지 않는다.
- 🔴 **`collect_customer_numbers.py` 의 이름을 파서에서 import 하지 않는다** — 그 파일은 `__main__` 으로 실행되고 시험은 `spec_from_file_location` 으로 따로 읽어, import 하면 사본이 둘이 되고 예외 클래스(`TooLarge`)의 `isinstance` 가 조용히 빗나간다. 파서와 숫자 수집기가 함께 쓰는 것(`MAX_IR_BYTES`·`TooLarge`·`ir_get`)은 `scripts/lib/ir_lists.py` 에 두고 양쪽이 거기서 import 한다. 파서가 기본 받기(`fetch_content`)가 필요하면 함수 안에서 늦게 import 하되 예외 클래스는 lib 쪽 것만 쓴다.
- 🔴 **기존 표·수집기는 고치지 않는다**: `stellantis_*`·`hyundai_sales`·`kia_sales`·`kg_mobility_sales` 와 그 수집기(`collect_stellantis_shipments_ir.py` 등) — 읽기·함수 재사용만.
- 수집기는 `lib.bootstrap.init_script(__file__)` · 쓰기는 `WriteSession` · 재시도 `lib.retry.with_retry`(4xx 즉시 raise) · 키를 stdout·예외 문자열에 넣지 않는다 · 파이썬 진입점 첫머리 `sys.stdout.reconfigure(encoding='utf-8', errors='replace')`.
- 연도를 코드에 박지 않는다 — 문서에서 읽은 연도만. 시험 픽스처의 연도는 실물 원문 그대로.
- 픽스처는 2026-11 실물을 필요한 만큼만 잘라 `scripts/lib/fixtures/ir_lists/<회사>_<무엇>.{html,json,xml}` 로 저장(PDF·XLSX 원본은 저장하지 않는다 — 파서 시험은 추출된 표·글을 문자열로 박는다. 2단계 관례).
- 검증 명령: `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib -q`(숫자 수집 자가 시험 `ccn.self_tests()` 도 `test_customer_numbers.py` 가 돌린다) · `npm run check-all` · 공용 헬퍼 시그니처를 바꿨으면 `scripts/venv/Scripts/python.exe scripts/verify_call_contracts.py`.
- 파일 UTF-8(BOM 없음)+LF · 커밋은 경로 명시 한 명령(`git add <경로> && git commit --only -F <파일> -- <경로>`) · `git add -A` 금지 · 🔴 **푸시하지 않는다**(사용자 요청 시에만 — 푸시 = Vercel 배포 + 매일 유료 LLM 수집 시작).
- 🔴 네트워크 실측은 착수 Step 1 에서 «한 번» 받아 픽스처로 굳힌 뒤 시험은 픽스처로만 돈다. 실측이 이 계획과 다르면 **동작 불가(형식·경로가 다름)는 고치고 보고서에 기록 · 구조 선택(어디서 돌릴지·새 표·새 문서 종류·새 외부 의존)은 멈추고 보고**(전역 규칙).
- 🔴 DB 에 쓰는 실행은 Task 5 Step 5(CID 1건)와 Task 12(메인이 직접)뿐. 구현 태스크의 확인은 `--dry-run`.
- 🔴 **목록 드라이런은 새 문서를 저장하지 않고 숫자 수집기는 DB 의 문서만 읽는다**(`collect_customer_docs.py:288` · Codex 대조 2026-11-10) — 그래서 «새 문서가 숫자 수집 드라이런에서 대상으로 잡힌다»는 확인은 성립하지 않는다. 대신 시험으로: 목록 파서가 낸 픽스처 행 → 숫자 수집기의 `Doc` 꼴로 바꿔 → `mod.wants(doc)`(받아야 할 문서 True · 링크만인 문서 False) + 그 문서의 본문 픽스처로 `mod.parse`. 실물 연결 확인은 Task 12 에서 메인이 목록을 본 적재한 뒤 한다. 각 태스크의 「숫자 수집 드라이런」 문구는 이 뜻으로 읽는다(기존 문서에 대한 드라이런은 그대로 유효).

---

## 재사용 짝짓기 (신규 칸만 만든다)

| 이번 항목                      | 과거 산출물                                                                | 판정                                    |
| ------------------------------ | -------------------------------------------------------------------------- | --------------------------------------- |
| IR 목록 어댑터(받기/순수 파싱) | `ir_lists.py` `fetch_vw`·`parse_vw_results`·`parse_kgm` 등                 | 그대로 재사용(같은 틀로 함수 추가)      |
| 분기만 있는 목록의 날짜        | `ir_lists.resolve_dates`(DART 갈래)                                        | 선택 인자만 더해 재사용(EDGAR 갈래)     |
| 실적 일정                      | `IR_EARNINGS_DATES` · `collect_customer_docs.sync_earnings_dates`          | 그대로(등록부에 회사 추가)              |
| 파서별 내려받기                | `_CompanyRun._content` 의 `mod.fetch` 훅                                   | 그대로(포르쉐·GM 이 처음 구현)          |
| HTML·PDF 글 추출               | `lib/doc_text.py` `html_to_text`·`html_to_table_rows`·`pdf_text`           | 그대로                                  |
| XLSX 읽기                      | 레포 sync 스크립트들의 openpyxl 사용                                       | openpyxl 그대로(새 헬퍼 안 만든다)      |
| 브라우저 경로                  | `ir_lists._playwright_status`(Playwright chromium)                         | 신규 — 실제 Chrome CDP `_chrome_fetch`  |
| 크기 상한                      | 없음                                                                       | 신규 — `_ir_get` 안                     |
| 수동 닫기                      | `collect_customer_numbers.py --reparse`                                    | 선택 인자만 더함(`--close`)             |
| 가이던스 지표 어휘             | `customer_parsers/base.py` `METRICS`                                       | 키 4개 추가(화면은 `metric_label` 원문) |
| 스텔란티스 IR 출하 합계 행     | `collect_stellantis_shipments_ir.py` `TOTAL_LABEL`·`extract_row_thousands` | 그대로 읽기만                           |

---

## File Structure

| 파일                                                  | 맡는 일                                                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/collect_customer_numbers.py`                 | 50MB 상한(`_ir_get`) · 상한 초과 → not_target · 수동 닫기 `--close`                                                                               |
| `scripts/collect_customer_docs.py`                    | 대상 11곳(E1) · 일정 실패 분류                                                                                                                    |
| `scripts/lib/ir_lists.py`                             | VW 갤러리·인도 · 포르쉐 보고서 표·AFR 일정 · 빈패스트·리비안 어댑터 · 현대·기아 CID · 모비스 영문 Script · KGM 날짜 · Chrome CDP · GM 어댑터·일정 |
| `scripts/lib/test_ir_lists.py` + `fixtures/ir_lists/` | 위 순수 함수 시험                                                                                                                                 |
| `scripts/customer_parsers/porsche.py`                 | `fetch()`(팩트시트 XLSX 만) · 분기 단독 인도·실적                                                                                                 |
| `scripts/customer_parsers/kr_dart.py`                 | 모비스 영문 Script 수주 목표 코드 정규식 · `llm_only` 에서 Script 제외                                                                            |
| `scripts/customer_parsers/gm.py`                      | IR 문서 `fetch()`(CDP) · Deliveries 총계 · 추가 전망 4지표                                                                                        |
| `scripts/customer_parsers/vw.py`                      | 추가 전망 2지표 · `approximately`/`about` 근사                                                                                                    |
| `scripts/customer_parsers/polaris.py`·`rivian.py`     | `expects_numbers`(분기 잠정 범위 8-K 오탐)                                                                                                        |
| `scripts/customer_parsers/stellantis.py`              | 연결 출하 ↔ IR 출하 표 합계 행 대조                                                                                                               |
| `scripts/customer_parsers/base.py`                    | `METRICS` 키 4개                                                                                                                                  |
| `scripts/lib/llm_guidance.py`                         | `raised` 어간 조임 · 토큰 사용량 한 줄 출력                                                                                                       |
| `scripts/lib/test_customer_parsers.py`                | 파서 시험                                                                                                                                         |
| `.github/workflows/collect-customer-docs.yml`         | GM 접근 시험 step · 머리 주석                                                                                                                     |
| `docs/customers-collection.md` · `docs/commands.md`   | 새 출처·수동 닫기·상한·GM 경로                                                                                                                    |

---

### Task 1: 공통 기반 — 50MB 상한 · 수동 닫기 · 수집 대상 11곳

**Files:**

- Modify: `scripts/lib/ir_lists.py`(새 `MAX_IR_BYTES`·`TooLarge`·`ir_get` — 공용 자리 · Global Constraints 「import 금지」)
- Modify: `scripts/collect_customer_numbers.py`(`_ir_get` `:100-109` 를 `ir_lists.ir_get` 호출로 · `fetch_failure_kind` `:169-188` · `_args` `:376-388` · `main` · `_CompanyRun.process` 받기 실패 갈래 `:577-581`)
- Modify: `scripts/collect_customer_docs.py`(`targets` `:89-100` · 모듈 docstring 5행 · `PARSER_ONLY_TICKERS` 위 주석 `:76-77`)
- Test: 숫자 수집기 시험 파일(착수 때 `ls scripts/lib/test_customer*` — 2단계는 `scripts/lib/test_customer_numbers.py`) · 목록 수집기 시험 파일
- Docs: `docs/customers-collection.md` · `docs/commands.md`

**Interfaces:**

- Produces(`scripts/lib/ir_lists.py`): `MAX_IR_BYTES = 50 * 1024 * 1024` · `class TooLarge(Exception)`(속성 `size: int | None`) · `ir_get(session, url) -> requests.Response`(브라우저 UA · 5xx 재시도 · 상한). 숫자 수집기의 `_ir_get` 은 이것을 부르는 얇은 이름으로 남기거나 호출부를 바꾼다(호출부 grep).
- Produces(숫자 수집기): `fetch_failure_kind(e, doc)` 가 `ir_lists.TooLarge` 면 `'too_large'` · CLI `--close DOC_ID --note TEXT` · 목록 수집기 `select_targets(rows: list[dict], wanted: set[str]) -> list[dict]`(순수).
- 뒤 태스크가 기대는 것: 큰 PDF(리비안 180MB·AI Day 431MB)가 받기 대상이 돼도 러너가 죽지 않는다.

- [ ] **Step 1: 실패하는 시험**
  - `_ir_get` 이 `Content-Length: 60000000` 응답(가짜 세션 — `requests.Response` 를 직접 만들어 `headers`·`iter_content` 를 채운다)에 `TooLarge` 를 던진다.
  - `Content-Length` 가 없고 본문 조각 합이 상한을 넘으면 `TooLarge(None)`.
  - 상한 이하(1KB)는 `r.content` 가 원래 바이트와 같다 · `r.encoding`·`r.apparent_encoding` 이 그대로 쓸 수 있다.
  - `fetch_failure_kind(TooLarge(60_000_000), doc) == 'too_large'`.
  - `select_targets`: 활성 OEM 행(가짜 `F`·비상장 국내 OEM 1곳·`GM`) + `wanted={'GM'}` → `GM` 만. 기존 조건(`sec_cik`·`dart_corp_code`·IR 어댑터 중 하나)도 유지 · `id` 중복 제거 유지.
- [ ] **Step 2: 실패 확인** — `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib -q -k "too_large or select_targets or TooLarge"` → FAIL.
- [ ] **Step 3: 구현**
  - `ir_lists.ir_get`(기존 `_ir_get` 본문을 옮겨): `session.get(url, headers=..., timeout=60, stream=True)` → `raise_for_status()` → `Content-Length` 가 있고 > `MAX_IR_BYTES` 면 `r.close()` 후 `TooLarge(size)` · 아니면 `iter_content(1 << 20)` 로 모으다 넘으면 `r.close()` + `TooLarge(None)`. 다 모으면 `r._content = b''.join(chunks)` 로 기존 호출부(`fetch_content` 의 `r.content`·`r.encoding`·`r.apparent_encoding`)가 그대로 돈다. `TooLarge` 가 `with_retry` 에서 재시도되지 않는지 `scripts/lib/retry.py` 로 확인하고 시험 1건.
  - `fetch_failure_kind`: `TooLarge` → `'too_large'`. 🔴 `process` 받기 실패 갈래(`:577-581`)는 `self.outcomes[{'blocked': …, 'retry': …, 'failed': …}[kind]]` dict 조회라 `'too_large'` 를 그 dict 에 안 넣으면 except 안에서 KeyError 로 실행 전체가 죽는다 → dict 조회 «앞에서» `kind == 'too_large'` 를 먼저 처리한다: 문서를 `not_target` + note `크기 초과(N MB) — 링크만`(크기 모르면 `50MB 초과`) · `outcomes['too_large']` · `fetch_failed` 에 넣지 않는다(실패 아님 · exit 0 · 다음 실행이 다시 받지 않는다). `finish` 상태 사유에 「크기 초과 n건」.
  - `--close DOC_ID --note TEXT`: 그 문서 하나를 `parse_status='not_target'` · `parse_note='수동 닫음: <TEXT>'`. `--note` 없음 · 문서 없음 · `--reparse`/`--add-file` 과 함께 옴 = 인자 오류(exit 2 — 기존 `_add_file_error` 처럼). `--dry-run` 이면 쓰지 않고 한 줄 출력. 쓰기는 `WriteSession`. `finish` 를 타지 않으므로 회사 상태 표(닫힌 실패 수)는 다음 정기 실행에 고쳐진다 — 문서에 적는다.
  - `targets()`: 기존 두 질의는 그대로 두고 거르기를 `select_targets(rows, customer_parsers.parser_tickers() | set(ir_lists.IR_LISTS))` 로 — `customer_parsers` 는 `targets()` 안에서 늦게 import 한다(`:76-77` 주석 「customer_parsers 패키지에 기대지 않으려고」를 「대상 판정만 늦게 import」로 고친다). docstring 을 「파서·IR 어댑터가 있는 회사(= GHA matrix · 시험 P13)」로. GHA 는 matrix 로 이미 11곳만 돌아 실제 효과는 로컬 전체 실행이다. 빠진 회사(포드 등)의 `customer_collect_status` 행은 지우지 않고 둔다(고객사 화면 대상이 아니라 보이지 않는다 — 착수 때 `lib/customers/source.ts` 가 회사를 어떻게 고르는지 한 번 확인해 보고).
- [ ] **Step 4: 통과 확인** — 위 명령 PASS + `pytest scripts/lib -q` 전체 PASS.
- [ ] **Step 5: 문서** — `docs/customers-collection.md` 에 ① 「IR 문서 50MB 상한 — 넘으면 not_target + 「크기 초과」, 자료실 링크는 남는다」 ② 「영구 받기 실패 문서 닫기: `collect_customer_numbers.py --close <id> --note "<사유>"`」 ③ 수집 대상 문장. `docs/commands.md` 종료 코드 표가 이 동작과 맞는지 확인(다르면 고친다).
- [ ] **Step 6: 커밋.**

### Task 2: 독일 2곳 IR 목록 확장 — VW 발표자료 갤러리·Q1 인도 · 포르쉐 보고서 표·CMD (조사 T1)

**Files:**

- Modify: `scripts/lib/ir_lists.py`(`fetch_vw` `:259-266` · 새 `parse_vw_gallery` · `fetch_porsche` `:343-365` · 새 `parse_porsche_reports` · `_fetch` `:57-63` 에 선택 인자 `headers: dict | None = None` — 지금은 헤더가 고정이라 갤러리의 `Accept: application/json` 을 못 넘긴다. 기본값이면 지금과 같은 헤더 · 시그니처가 바뀌니 `verify_call_contracts.py` 를 돌린다)
- Test: `scripts/lib/test_ir_lists.py` + 픽스처 `vw_gallery.json`·`vw_deliveries.html`·`porsche_reports.html`

**Interfaces:**

- Consumes: `_fetch`·`_row`·`_need`·`ir_source_id`·`resolve_dates`·`EmptyListError`(기존).
- Produces: `parse_vw_gallery(payload: dict) -> list[dict]` · `parse_porsche_reports(html: str) -> list[dict]`(행 꼴은 기존 `_row` 결과). 포르쉐 팩트시트 행은 `doc_type='fact_sheet'`·`form='fact-sheet-xlsx'` — Task 3 이 이 값으로 고른다.

- [ ] **Step 1: 실측 → 픽스처**
  - VW: IR 발표자료 페이지 HTML 에서 갤러리 ID 를 정규식으로 뽑고 `GET /en/item/galleries/<id>/documents?offset=n` + 헤더 `Accept: application/json`(조사 `ir_germany.md:38-44`)을 끝까지 넘겨 받는다 → 첫 쪽 JSON 을 픽스처로. 「Deliveries to Customers」 페이지(`ir_germany.md:13`)를 받아 분기 인도 보도자료 링크가 있는지 본다(**미확인** — 있으면 픽스처, 없으면 Step 3 대안).
  - 포르쉐: 보고서·발표자료 표 페이지(서버 렌더 HTML · 행=종류 · 열=분기 · 2022~)를 픽스처로. CMD 2026 PDF 는 고정 경로 1건(`ir_germany.md:148`).
- [ ] **Step 2: 실패하는 시험**
  - MUST_HIT: VW `Roadshow` 2026-11-05 행(`doc_type='presentation'`·`form='roadshow'`) · 포르쉐 `FY-2025-fact-sheet-porsche-ag.xlsx` 행(`doc_type='fact_sheet'`·`form='fact-sheet-xlsx'`) · 포르쉐 CMD 2026(`doc_type='investor_day'`).
  - 종류: Roadshow·Pre-Close Call·실적 콜 = `presentation` · 2030 목표 발표·China Investor Update·CMD = `investor_day` · Factbook·팩트시트 XLSX = `fact_sheet` · 나머지 = `other`(D4) · 세부 종류는 `form`.
  - 날짜: VW 타일 `MM/DD/YYYY` 그대로 · 포르쉐 표는 열=분기라 날짜가 없다 → 같은 분기 EQS 실적 보도일(같은 목록의 `earnings_release` 행)로 채우고 없으면 행을 내지 않는다(보류). 포르쉐 FY25 발표자료가 독일어 폴더 경로여도(`ir_germany.md:129`) 경로로 언어를 가정하지 않는다 — 시험 1건.
  - MUST_MISS: 갤러리 0건이면 `EmptyListError`.
  - VW 2026-Q1 인도 행이 목록 결과에 있다.
- [ ] **Step 3: 구현** — `fetch_vw` 에 갤러리 하위 목록(갤러리마다 `_need`) · Q1 인도: Deliveries 페이지에 링크가 있으면 그 페이지를 하위 목록으로, 없으면 RSS 제목 판정(`classify_vw_title` `:184-191`)을 넓힌다(`deliveries` + 분기/기간 낱말) — 어느 쪽인지 보고서에. `fetch_porsche` 에 보고서 표 + CMD 고정 경로.
- [ ] **Step 4: 시험·드라이런** — `pytest scripts/lib/test_ir_lists.py -q` PASS · `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe scripts/collect_customer_docs.py --dry-run --company VOW3.DE` · `P911.DE` → 새 문서 수 > 0. 숫자 수집 드라이런에서 새 `presentation`·`investor_day` 행은 「대상 파서 없음」 pending 으로만(`vw.wants`·`porsche.wants` 가 안 받음 — 내려받기 0).
- [ ] **Step 5: 커밋.**

### Task 3: 포르쉐 팩트시트 XLSX → 분기 단독 인도·실적 (조사 T2)

**Files:**

- Modify: `scripts/customer_parsers/porsche.py`(`wants` `:69-70` · 새 `fetch` · 시트 파서 · 자가 시험)
- Test: `scripts/lib/test_customer_parsers.py`

**Interfaces:**

- Consumes: Task 2 의 `doc_type='fact_sheet'`·`form='fact-sheet-xlsx'` 행 · `collect_customer_numbers.fetch_content`(기존 — 파서는 이미 이 함수를 늦게 import 하는 꼴이면 그대로 · 아니면 `fetch()` 안에서 늦게 import) · `ir_lists.ir_get`·`ir_lists.TooLarge`(Task 1 · 🔴 `collect_customer_numbers` 에서 `TooLarge` 를 import 하지 않는다 — 스크립트로 실행될 때 `__main__` 모듈과 import 된 모듈의 클래스가 둘로 갈려 `isinstance` 가 빗나간다 · Global Constraints).
- Produces: `customer_reported_results`(period_grain quarter · revenue · operating_income) · `customer_volume_ir`(deliveries · quarter · region 은 기존 포르쉐 인도 행과 같은 어휘).

- [ ] **Step 1: 실측** — 팩트시트 XLSX 1건을 받아 openpyxl 로 시트 이름·머리 행·라벨 열을 적는다(조사 근거는 `01 Group EBIT` 시트뿐 — 인도 시트 이름은 **미확인**). 파일은 저장하지 않고 시험에 필요한 셀만 리스트로 옮긴다.
- [ ] **Step 2: 실패하는 시험** — 시트 셀 리스트(실물 그대로) → 분기 단독 매출·영업이익·인도. MUST_MISS: 분기 머리 라벨을 못 찾으면 0행 parsed 가 아니라 failed. 검산 시험: 같은 해 Q1+Q2+Q3 = DB 에 이미 적재된 9M 누계(EQS 실적 표)와 같다 — 허용오차는 원문 반올림 단위(착수 때 정해 보고서에).
- [ ] **Step 3: 구현**
  - 🔴 `fetch` 는 «모듈 단위» 훅이라 정의하는 순간 포르쉐 EQS 보도자료까지 이 함수로 받는다(`collect_customer_numbers.py:512-519`). 그래서 `doc.doc_type != 'fact_sheet'` 면 `fetch_content(session, doc)[0]` 를 그대로 돌려주고, 팩트시트만 `_ir_get` 바이트를 `openpyxl.load_workbook(BytesIO(b), data_only=True)` 로 열어 `Content(text, tables, raw)` 를 만든다(tables = 시트별 행 리스트 · text = 시트 이름 + 행을 이어 붙인 글 — `quote_check` 가 대조할 원문).
  - ⚠️ `read_only=True` 단독 결과를 믿지 않는다(AGENTS.md) — 일반 모드로 연다.
  - `wants` 에 `doc.source == 'ir' and doc.doc_type == 'fact_sheet'` 추가.
  - `parse` 의 `llm_hint` 판정(`porsche.py:178-191`)은 EQS 보도자료용이다 — 팩트시트 갈래는 `llm_hint=False`(표를 코드가 다 읽으니 LLM 에 넘기지 않는다 · 시험 1건).
  - quote 는 «값이 든 원문 연속 구간»(같은 행의 라벨+값)으로 — `quote_check.check_row` 를 통과해야 verified.
- [ ] **Step 4: 시험·드라이런** — 자가 시험 · `pytest` · `collect_customer_numbers.py --company P911.DE --dry-run` 에서 팩트시트 문서가 parsed 예정이고 기존 EQS 문서 결과가 바뀌지 않는다(드라이런 전후 건수를 보고서에).
- [ ] **Step 5: 커밋.**

### Task 4: 빈패스트·리비안 IR 목록 어댑터 — 링크만 (조사 T3)

**Files:**

- Modify: `scripts/lib/ir_lists.py`(새 `fetch_vinfast`·`parse_vinfast`·`fetch_rivian`·`parse_rivian` · `resolve_dates` `:144-183` 에 EDGAR 갈래 · 등록부 `IR_LISTS` `:593-601` · 등록부 위 주석 「스텔란티스·빈패스트 = EDGAR 로 충분」 수정)
- Modify: `scripts/collect_customer_docs.py` — 🔴 지금 IR 목록 날짜 근거 `qdates` 는 `dart_corp_code` 가 있는 회사만 만든다(`:141`) · 보류 사유는 `HOLD_REASONS[wait]`(`:147`)라 새 `wait` 값을 쓰면 KeyError. EDGAR 회사(VFS·RIVN)의 날짜 근거 = 같은 회사 `customer_documents` 의 EDGAR 실적 문서 접수일 목록(빈패스트는 6-K 가 `doc_type='current_report'` 로 들어 있다 — 실적 6-K 를 가를 조건을 실물로 정한다 · 리비안은 8-K Item 2.02) · `HOLD_REASONS['edgar']` 문구 추가.
- Test: `scripts/lib/test_ir_lists.py` + 픽스처 `vinfast_reports.html`·`vinfast_presentation.html`·`rivian_next_data.json`
- 워크플로는 바꾸지 않는다(`VFS`·`RIVN` 은 이미 matrix 에 있다 · P13 시험이 등록부 ∪ 파서 = matrix 를 본다).

**Interfaces:**

- Produces: `IR_LISTS['VFS']`·`IR_LISTS['RIVN']` · `resolve_dates` 의 EDGAR 갈래 = 분기만 있는 행에 같은 회사 EDGAR 실적 문서(6-K/8-K) 일자. 인자 이름은 기존 `resolve_dates` 시그니처를 보고 맞춘다(시그니처를 바꾸면 `verify_call_contracts.py`).

- [ ] **Step 1: 실측 → 픽스처**
  - 빈패스트: IR 첫 쪽 「Our Reports」 서버 렌더 표(분기 · Earnings Report 링크) · 회사 소개 자료(뷰어 HTML 안 서명 URL — curl 2단계 · `ir_foreign.md:148-150`) · Mobility Day 2025 행사 상세.
  - 리비안: IR 페이지의 `__NEXT_DATA__` JSON(리치텍스트 링크 · 분기 블록 · 이벤트 문서).
- [ ] **Step 2: 실패하는 시험**
  - 빈패스트: 분기 보고서 = `shareholder_letter` · 회사 소개 자료 = `presentation` 이고 **`source_id` 가 판 이름**(서명 URL 쿼리가 키에 없다 — 서명만 다른 두 URL 이 같은 키) · Mobility Day = `investor_day` · 증권사 리포트 원문 링크는 나오지 않는다(D9 MUST_MISS).
  - 리비안: 분기 블록 PDF = `shareholder_letter` · Investor Day 2024·AI Day·VW JV 덱 = `investor_day` · Impact Report·공급사 행동강령은 나오지 않는다.
  - EDGAR 날짜 갈래: 분기 `2026-Q3` 행 + 같은 회사 EDGAR 실적 문서 일자 목록 → 그 분기 끝 뒤 첫 실적 문서 일자 · 없으면 보류.
- [ ] **Step 3: 구현** — 받기/순수 파싱 분리. 링크 주변 문장에 날짜가 있으면 그것 우선, 없으면 EDGAR 갈래.
- [ ] **Step 4: 시험·드라이런** — `--dry-run --company VFS` · `RIVN` 새 문서 > 0 · 숫자 수집 드라이런에서 두 회사 IR 문서는 「대상 파서 없음」 pending 으로만(`vinfast.wants`·`rivian.wants` = EDGAR 만 → 180MB·431MB 파일도 내려받지 않는다).
- [ ] **Step 5: 커밋.**

### Task 5: 국내 IR 확장 — 현대·기아 CEO Investor Day · 모비스 영문 Script 코드 파서 (조사 T4 · D6)

**Files:**

- Modify: `scripts/lib/ir_lists.py`(`fetch_hyundai` `:461-473` · `fetch_kia` `:491-502` · `fetch_mobis` `:524-536`)
- Modify: `scripts/customer_parsers/kr_dart.py`(`llm_only` `:91-97` · `wants` `:100-102` · `parse` `:327` 의 `if llm_only(doc): return res` 앞에 Script 갈래 · 새 Script 판정·정규식 · 자가 시험). 🔴 지금 `wants` 는 Script 문서를 받지 않고, `parse` 는 `llm_only` 면 코드 파싱 없이 돌아간다 — 두 곳을 다 고쳐야 Script 가 코드로 읽힌다. `wants` 추가 조건 = `doc.source == 'ir' and doc.ticker == <모비스 티커 상수> and doc.form == 'script'`(`Doc.form` 은 `base.py:37` · DB 칸은 마이그레이션에 이미 있다).
- Modify: `scripts/lib/llm_guidance.py`(호출 뒤 `msg.usage` 입력·출력 토큰 한 줄 출력 — 금액 계산은 하지 않는다)
- Test: `scripts/lib/test_ir_lists.py` + 픽스처 `hyundai_ceo_investor_day.json`·`kia_ir_activity.json`·`mobis_en_performance.html` · `scripts/lib/test_customer_parsers.py`

**Interfaces:**

- Produces: 현대·기아 CID 행 `doc_type='investor_day'`(→ 기존 `llm_only` 로 LLM 대상 · D6) · 모비스 Script 행 `doc_type='presentation'`·`form='script'` · `customer_guidance(metric='order_intake', period='FY<연도>', currency='USD', unit='billion', extractor='code')`.

- [ ] **Step 1: 실측 → 픽스처**
  - 현대: `POST /wsvc/ww/ceoInvestorDay.list.do`(JSON · 경로 공백은 URL 인코딩 · `ir_korea.md:42,70`).
  - 기아: `GET /api/investors/ir-activity?language=ko&isMobile=false&year=<연도>&page=<n>`(10건씩 · `ir_korea.md:151`) — 이번엔 **CEO Investor Day 행만**(컨퍼런스·NDR 은 나중).
  - 모비스: `GET /en/ir/irReportLoad.do?type=performance&pageIndex=N`(HTML 조각 · `fileId` 는 매번 새로 — 키는 `fileNm` · `ir_lists.py:69-83`). 2Q26 이전 분기는 Script 가 없다.
- [ ] **Step 2: 실패하는 시험**
  - 목록: 현대 CID 2019~2026 행 · 기아 CID 행 · 모비스 Script 행(`form='script'`).
  - Script 정규식(원문 `ir_korea.md:243`): MUST_HIT `representing 13% of the annual order target of USD 8.97 billion` → (FY2026, 8.97, 8.97, USD, billion) · MUST_MISS `Non-captive orders for Core Parts reached USD 1.15 billion on a cumulative basis through the third quarter of 2026`(누계 실적 — 목표 아님). 연도는 같은 문단의 연도 또는 문서 분기의 연도(문서 밖 연도 금지).
  - `llm_only(Script 문서) is False` — 코드가 읽는 문서는 LLM 에 넘기지 않는다(국문 경영실적 PDF 는 지금처럼 LLM).
- [ ] **Step 3: 구현** — 목록 3종 · `kr_dart` Script 갈래 · `llm_only` 에 `doc.form != 'script'` · Script 에 목표 문장이 없는 회차는 `recognized=False`(실물로 확인해 보고).
- [ ] **Step 4: 시험·드라이런** — `kr_dart` 자가 시험 · `pytest` · `--dry-run --company 012330`(Script 문서에서 코드 가이던스 1행 · LLM 호출 0).
- [ ] **Step 5: D6 실측** — 로컬(`init_script` 가 루트 `.env.local` 의 `ANTHROPIC_API_KEY` 를 읽는다)에서 현대 CID 최신 1건만 문서 목록에 적재한 뒤 `collect_customer_numbers.py --reparse <id>` 로 돌려 ① 글 길이(자) ② `MAX_CHARS`(120,000자 · `llm_guidance.py:40`) 초과로 잘렸는지 ③ 입력·출력 토큰 ④ 뽑힌 행·verified 수를 보고서에 적는다. 기아 CID(189쪽)는 `pdf_text` 길이만 재고 LLM 은 돌리지 않는다 — 잘림이 크면 «쪽 범위를 고를지»는 구조 선택이라 멈추고 보고. 🔴 DB 에 쓰는 실행 — 그 문서가 새 문서인지(기존 가이던스 행 없음) 먼저 확인.
- [ ] **Step 6: 커밋.**

### Task 6: 실적 일정 — 포르쉐 EQS-AFR · 일정 결함 정리 (조사 T5)

**Files:**

- Modify: `scripts/lib/ir_lists.py`(새 `parse_porsche_dates` · `IR_EARNINGS_DATES` `:604-607` · 기간 필터 뒤 0건 거짓 오류 — 그 `_need` 는 `fetch_vw_dates` 가 아니라 `parse_vw_events` `:267-270` 안에 있다)
- Modify: `scripts/collect_customer_docs.py`(`:294-302` 일정 실패 분류 · `sync_earnings_dates` `:151-161`)
- Test: `scripts/lib/test_ir_lists.py` + 픽스처 `porsche_afr.xml`

**Interfaces:**

- Produces: 포르쉐 일정 행 `{'period','event_date','quote','source','source_ref','url'}`(기존 꼴).

- [ ] **Step 1: 실측** — 포르쉐 EQS 피드에서 AFR(연간 재무 보고 일정 공고 — `classify_porsche` 가 지금 버리는 항목) 원문을 픽스처로. 고정 서식 `Date of disclosure:`.
- [ ] **Step 2: 실패하는 시험** — AFR 서식 MUST_HIT(Report Type → `YYYY-Qn`/`YYYY-FY` · 날짜 · quote = 원문 두 줄) · AFR 아닌 뉴스 MUST_MISS · VW 일정이 기간 필터 뒤 0건이어도 «받은 원문이 비지 않았으면» `EmptyListError` 가 아니다 · 일정 받기 403 → `blocked`.
- [ ] **Step 3: 구현**
  - 일정 받기 실패를 `BLOCKED_HTTP` 로 가려 403 은 `blocked`(error 로 세지 않는다 · 2단계-z).
  - 출처 간 덮어쓰기: `customer_earnings_dates` PK 가 `(company_id, period)` 라 IR 일정과 공시 파서 일정이 서로 덮을 «수» 있다. 대조 결과 **지금은 한 회사에 두 출처가 겹치지 않는다**(포르쉐는 IR 일정만 생긴다). 그래서 우선순위 상수는 만들지 않는다(YAGNI) — 착수 때 회사별 일정 출처(어휘 `'edgar'|'dart'|'ir'`)를 DB 로 세어 겹침 0 을 확인하고 보고서에 적는다. 겹침이 나오면 그때 멈추고 보고(덮어쓰기 판정은 `newer_only` `:295` 와 함께 바꿔야 한다).
- [ ] **Step 4: 시험·드라이런** — `--dry-run --company P911.DE` 일정 수 > 0.
- [ ] **Step 5: 커밋.**

### Task 7: 2단계 Task 4 이월 정리 + KGM 날짜 근거 (조사 T6)

**Files:**

- Modify: `scripts/lib/ir_lists.py` · (필요하면) `scripts/collect_customer_docs.py`
- Test: `scripts/lib/test_ir_lists.py`

항목마다 MUST_HIT/MUST_MISS 1쌍 이상:

1. **기아 `page=1` 고정**(`fetch_kia`) — 조사(`ir_korea.md:166` 「page 를 바꿔도 같은 목록」)와 기존 수집기 docstring(`collect_kia_sales.py:6` 「page=1,2,… 로 분산」)이 **서로 다르다** → 착수 때 두 페이지를 실제로 받아 비교하고 결과에 맞춘다(결과를 보고서에).
2. **VW 실적 행렬 「연도 절마다 표 1개」 가정**(`parse_vw_results` `:203-226`) — 두 번째 표가 있으면 조용히 빠진다 → 절 안의 표 전부.
3. **정정공시 분기 키** — `quarter_dates`(`:121-134`)가 «공시일 직전 분기»로 키를 만들어 다음 분기에 낸 [기재정정]은 엉뚱한 분기가 된다. 입력(`{'title','published_at'}` · `collect_customer_docs.py:133`)에 원공시 참조가 없어 원공시를 특정할 수 없다(Codex 대조) → **정정공시(제목에 `정정`)는 `qdates` 를 만들지 않는다** — 그 분기의 날짜는 원공시가 이미 준다. MUST_MISS: 다음 분기 공시일의 `[기재정정]영업(잠정)실적` 이 어떤 분기 키도 덮지 않는다 · MUST_HIT: 원공시 키는 그대로.
4. **VW ad-hoc 전부 `guidance`**(`parse_vw_adhoc` `:227-237`) — 제목에 results 가 있으면 `earnings_release`(자료실 라벨만 바뀐다 — 숫자는 `vw.py` 가 본문으로 가른다).
5. **KGM 발표자료 날짜 근거** — DART 영업(잠정)실적 중 KGM 분기 실적 공시의 접수일을 `qdates` 로. 지금 `quarter_dates` 는 「연결재무제표기준」 공시만 본다 — KGM 공시 제목 꼴은 **미확인** → 실측해 맞춘다. 🔴 KGM 발표자료 행은 지금 `wait='press'`(`ir_lists.py:582`)라 `qdates` 를 아예 안 본다 → 발표자료 행의 `wait` 를 `'dart'` 로 바꾸거나, 보도자료 날짜를 못 찾을 때 `qdates` 로 넘어가는 갈래를 둔다(어느 쪽인지 보고서에 · 새 `wait` 값이면 `HOLD_REASONS` 에도).
6. **KGM CEO IR설명회·Pressday 날짜** — DART IR 개최 공시(I003) 일자로. KGM 이 그 공시를 냈는지 **미확인** → 없으면 지금처럼 «날짜 없음».
7. **KGM 보도자료 파일명 시각 = 재업로드일 위험**(`parse_kgm` `:541-585` · `--backfill` 때) — 같은 분기 DART 실적 공시일이 있으면 그쪽 우선.

- [ ] **Step 1~4**: 항목별 실측 → 시험 → 구현 → `pytest` · `--dry-run --company 003620`(KGM 2026 발표자료 보류 수 감소) · `000270`.
- [ ] **Step 5: 커밋**(2~3 커밋으로 나눠도 된다).

### Task 8: GM IR — 실제 Chrome CDP · 목록 · 미국 분기 인도 총계 · 실적 일정 (D1)

**Files:**

- Modify: `scripts/lib/ir_lists.py`(새 `_chrome_fetch` · `probe_gm` `:646-674` 에 CDP 갈래 · 새 `parse_gm_results`·`parse_gm_sales`·`parse_gm_dates`·`fetch_gm`·`fetch_gm_dates` · 등록부 · 등록부 위 주석 「GM = 접근 차단」 수정)
- Modify: `scripts/customer_parsers/gm.py`(IR 문서 `fetch()` · `wants` `:64` · Deliveries 총계 파서 · 자가 시험)
- Modify: `.github/workflows/collect-customer-docs.yml`(GM 접근 시험 step · 문서 목록 step 앞 Chrome 확인 · 머리 주석 `probe_gm()` 줄)
- Modify: `scripts/collect_customer_docs.py`(`failure_status` `:210-217` — `_chrome_fetch` 가 내는 예외가 기존 분류를 그대로 타는지 시험 1건)
- Test: `scripts/lib/test_ir_lists.py` + 픽스처 `gm_quarterly_results.html`·`gm_sales_list.html`·`gm_event_detail.html` · `scripts/lib/test_customer_parsers.py`

**Interfaces:**

- Produces: `_chrome_fetch(urls: list[str]) -> list[tuple[int | None, bytes]]` — 실제 Chrome 을 `--headless=new --remote-debugging-port=<빈 포트> --user-agent=<BROWSER_UA> --user-data-dir=<임시 폴더>` 로 띄우고 Playwright `connect_over_cdp` 로 붙어, 첫 URL 로 이동한 뒤 «페이지 안 `fetch()`»로 각 URL 을 받는다(상태 코드 + 바이트 · base64 로 넘긴다). 끝나면 브라우저 프로세스를 닫고 임시 프로필을 지운다(`finally`). Chrome 경로 = env `CHROME_PATH` → `shutil.which('google-chrome')`·`('chrome')` → Windows 표준 경로. 못 찾거나 연결 실패면 그 URL 들은 `(None, b'')`(예외 문장은 찍지 않는다). 받는 쪽(`fetch_gm`·`fetch_gm_dates`·`gm.fetch`)은 결과를 기존 실패 분류가 알아듣는 예외로 바꾼다 — 403 = `requests.HTTPError`(응답 상태 403 을 단 것 → `blocked`) · `None`(Chrome 없음·연결 실패) = `requests.ConnectionError`. 그래야 `failure_status`·`fetch_failure_kind` 를 고치지 않고 탄다.
- `IR_LISTS['GM'] = fetch_gm` · `IR_EARNINGS_DATES['GM'] = fetch_gm_dates`.
- GM IR 문서 행: 분기 실적 묶음의 `Earnings Deck`(`presentation`) · `Shareholder Letter`(`shareholder_letter`) · 미국 분기 판매 상세의 `Deliveries` PDF(`sales_release`·`form='us-deliveries'`). `Earnings Release`(EDGAR 99.1 과 같은 문서)·중국 판매 보도는 넣지 않는다(중복·서술형).

근거(조사 `ir_us.md:11-22,32-39,52-54`): 이 PC 에서 「실제 Chrome + headless=new + 일반 UA + 페이지 안 fetch」만 200. Playwright 자체 HTTP·curl 은 403(TLS 지문). Playwright 가 `channel="chrome"` 으로 실제 Chrome 을 못 띄워 CDP 직접 연결을 썼다. GHA 러너(데이터센터 IP)는 **미확인**.

- [ ] **Step 1: 로컬 실측 → 픽스처** — `_chrome_fetch` 를 먼저 짜서 이 PC 에서 분기 실적 페이지 · Sales 목록 · Q3 2026 실적 콜 이벤트 상세 · Deliveries Q3 2026 PDF 를 받는다. HTML 3건은 필요한 부분만 픽스처로, PDF 는 `pdf_text` 결과에서 머리·총계 행만 문자열로 옮긴다. 🔴 Bash 에서 실행하고 콘솔·브라우저 창이 뜨지 않는지, 끝난 뒤 chrome 프로세스가 남지 않는지 확인.
- [ ] **Step 2: 실패하는 시험**
  - 목록: 분기 실적 페이지의 분기별 덱·서한 링크 · 2022 Q2 처럼 서한·덱이 같은 파일인 사이트 오류는 한 행만(`ir_us.md:52`).
  - 일정 MUST_HIT(원문 `ir_us.md:54`): `Fourth quarter 2026 earnings announcement is scheduled for Wednesday, January 27, 2027 and the first quarter 2027 earnings announcement is scheduled for Wednesday, April 21, 2027.` → 두 행. 4분기 발표의 기간 표기는 2단계-o(연간 발표 = `YYYY-FY`)와 `docs/customers-collection.md` 의 일정 규칙을 따른다.
  - Deliveries 총계(원문 꼴 `ir_us.md:53`): 제목 `GM U.S. DELIVERIES FOR QUARTER 3 2026` + 총계 행 → `customer_volume_ir(metric='deliveries', period_grain='quarter', period='2026-Q3')`. 모델별 행은 읽지 않는다(차종 칸 없음). 총계 행 라벨은 실물로 정한다(**미확인**). 총계 행을 못 찾으면 failed. region 은 새 키 `'us'` — 대조 결과 기존 어휘에 미국 단독 키가 없고(GM 도매 행은 `north_america`·`international`·`total`), `total` 로 넣으면 전 세계 합계로 읽힌다. 화면 라벨 `lib/customers/format.ts:337-338` 근처 지역 이름 표에 `us: '미국'` 한 줄 + vitest 1건(`volumeSeriesLabel` · `format.test.ts:365` 근처). Task 13 이 `china` 를 같은 자리에 더한다 — 먼저 끝난 쪽이 표를 만들고 뒤쪽은 한 줄만.
  - `gm_probe_status` 는 그대로 — CDP 결과 코드가 목록에 더해질 뿐(시험 1건: `[403, None, 200]` → ok).
  - 🔴 기존 시험 `test_gm_has_no_adapter`(`test_ir_lists.py:395` · `assertNotIn('GM', L.IR_LISTS)`)는 등록하면 반드시 깨진다 → `IR_LISTS['GM'] is fetch_gm` · `IR_EARNINGS_DATES['GM'] is fetch_gm_dates` 를 보는 시험으로 바꾼다(이름도 바꾼다).
  - 50MB 상한은 «받은 뒤»가 아니라 «받는 도중»에: 페이지 안 JS 가 `content-length` 머리가 상한을 넘으면 본문을 읽지 않고, 머리가 없으면 `response.body.getReader()` 로 읽으며 누적이 상한을 넘는 순간 `reader.cancel()` 하고 «크기 초과» 표식을 돌려준다(`_chrome_fetch` 결과에 상태 대신 표식 · 받는 쪽이 `ir_lists.TooLarge` 로 바꾼다). 상한 값은 `MAX_IR_BYTES` 를 JS 에 인자로 넘긴다(두 곳에 박지 않는다). 시험: JS 문자열에 상한이 인자로 들어가는지 + 표식 → `TooLarge` 변환(순수 함수로 떼어 시험).
- [ ] **Step 3: 구현**
  - `probe_gm`: requests → Playwright → **CDP** 순. 어느 하나라도 200 이면 ok. 🔴 GM 이 등록부에 들어가면 문서 목록 step 도 `(GM, 'ir_list')` 상태를 쓴다 — 시험 step 과 같은 칸을 덮어 서로 결과를 지운다. 그래서 등록 뒤 `probe_gm` 은 **로그만** 찍고 상태 표에 쓰지 않는다(수집기 상태 칸 CHECK 제약이 있으면 새 칸을 만들지 말고 이 방식으로).
  - `fetch_gm`·`fetch_gm_dates`: `_chrome_fetch` 로 받아 순수 파서로. 403 이면 `blocked`(기존 `GM_BLOCKED_REASON`) — 차단은 실패가 아니다(exit 0 · 노란 경고). Chrome 이 없으면 `error`(사유 「Chrome 없음」).
  - `gm.fetch(session, doc)`: `doc.source != 'ir'` 면 `fetch_content(session, doc)[0]`(EDGAR 경로 불변) · IR 이면 `_chrome_fetch([doc.url])` 바이트 → 길이가 `ir_lists.MAX_IR_BYTES` 를 넘으면 `ir_lists.TooLarge`(Task 1 · `collect_customer_numbers` 에서 import 하지 않는다) · PDF 면 `pdf_text`.
  - `gm.wants`: 기존 EDGAR 조건 + `doc.source == 'ir' and doc.form == 'us-deliveries'`(덱·서한은 3단계 — 내려받지 않는다).
- [ ] **Step 4: 워크플로** — 「GM IR 접근 시험」 step: `python -m playwright install --with-deps chromium` 은 남기고(Playwright 갈래 + CDP 의 `connect_over_cdp` 클라이언트), 그 앞에 `google-chrome --version || true` 한 줄(러너에 Chrome 이 있는지 로그로). ubuntu-latest 에 Chrome 이 있는지는 **미확인** — 없다고 확인되면 새 외부 액션을 넣지 말고 멈추고 보고(새 외부 의존 = 구조 선택). 머리 주석 `probe_gm()` 줄을 「requests → Playwright → 실제 Chrome(CDP)」로. 매일 실행의 GM 문서 목록도 Chrome 에 기댄다 — 문서 목록 step 앞에 `google-chrome --version || echo "Chrome 없음"` 한 줄(GM 행에서만 · 실패로 만들지 않는다 · Chrome 이 없으면 위 「Chrome 없음」 error 로 상태 표에 남는다). 이 동작(Chrome 없는 날 GM 이 error)이 맞는지는 푸시 전 사용자 확인 항목으로 HANDOFF 에 적는다.
- [ ] **Step 5: 시험·로컬 드라이런** — `pytest` · `--dry-run --company GM`(이 PC) 새 문서 > 0 · 일정 2행 · Deliveries 문서가 숫자 대상인지는 시험(`gm.wants`)으로(Global Constraints 「목록 드라이런」 줄).
- [ ] **Step 6: 커밋.** 🔴 GHA 에서 통하는지는 푸시 뒤 사용자가 `probe_gm_ir` 로 확인한다(이 계획 안에서 판정하지 않는다). 막히면 D1 의 「사용자 PC」 갈래 — PC 정기 실행 등록은 결과를 본 뒤 따로 정한다(보고서·HANDOFF 에 적는다).

### Task 9: 지표 밖 연간 전망 6개 — GM 4 · VW 2 (E2)

**Files:**

- Modify: `scripts/customer_parsers/base.py`(`METRICS` `:148-153`)
- Modify: `scripts/customer_parsers/gm.py`(🔴 `GUIDANCE_REQUIRED` 가 `GUIDANCE_ROWS` 에서 파생된다(`:47`) — 새 행을 `GUIDANCE_ROWS` 에 넣으면 필수가 7개가 돼 과거 판이 failed. 새 행은 별도 `GUIDANCE_EXTRA_ROWS` 로 두고 `GUIDANCE_REQUIRED` 는 지금 3개 그대로 · 자가 시험)
- Modify: `scripts/customer_parsers/vw.py`(전망 문장 갈래 `:210-218` 부근 · `MUST_MISS` `:405-420` · `ADHOC` MUST_HIT 개수 `('N',): 4` → 6 `:364-366`)
- Modify: `scripts/lib/llm_guidance.py`(`PERCENT_METRICS` `:148-149` 에 `operating_margin_adjusted` — 빠뜨리면 LLM 행의 % 단위 검사가 이 키를 놓친다)
- Check: `scripts/lib/llm_guidance.py`(LLM 스키마의 metric 열거가 `METRICS` 를 따르는지 — 따르면 손댈 것 없음) · `lib/customers/format.ts` `METRIC_FAMILY` `:240-243`(손 목록 · 아래)
- Test: `scripts/lib/test_customer_parsers.py`(TS 를 고치면 vitest 1건)

**Interfaces:**

- 새 `METRICS` 키 4개: `eps_diluted`(조정 전 희석 EPS · `per_share`) · `automotive_operating_cash_flow` · `special_items` · `operating_margin_adjusted`. 기존 키: GM 순이익 → `net_income_parent`(라벨이 «attributable to stockholders»면) · GM 설비투자 → `capex`.
- 화면: 가이던스 카드는 `metric_label`(회사 원문 이름)로 뜬다. `METRIC_FAMILY` 는 «같은 지표의 다른 이름»을 한 묶음으로 접는 목록이다 — 새 4키는 각각 독립 지표라 넣지 않는다(넣으면 `operating_margin_adjusted` 가 `operating_margin` 과 한 줄로 접혀 이력이 섞인다). 카드가 빠지면 그때만 원인을 보고.
- 🔴 LLM 이 읽는 문서(현대·기아 IR 등)가 지금까지 `operating_margin`·`other` 로 내던 조정 마진·특별 항목 행이 새 키로 옮겨 갈 수 있다 — Task 12 재처리 때 metric 별 행 수 전후를 보고한다.

- [ ] **Step 1: 원문 찾기** — GM: 2단계 Codex 표본 대조가 «원문에 있다»고 한 GM 실적 8-K(4분기 판 2026-01 · 3분기 판 2026-10 — `customer_documents` 에서 찾는다)를 `fetch_content` 로 받아 순이익·조정 전 EPS·자동차 영업현금흐름·설비투자 전망이 **어느 표/문장에 어떤 라벨로** 있는지 적는다(전망 표 3행 밖의 조정 대조표일 가능성 — **미확인**). VW: ad-hoc 2026-09-18 원문(`vw.py` `ADHOC` 시험 문자열)의 `Special effects totaling around 10 billion euros` · `Adjusted for the special effects, the operating return on sales for the full year 2026 would amount to about 4 percent`. 다른 VW 문서(반기·9M 판)에도 같은 꼴이 있는지 확인.
- [ ] **Step 2: 실패하는 시험**
  - GM: 원문 그대로의 표/문장 → 4행(값·단위·basis — 순이익·EPS·영업현금흐름·설비투자는 `reported`). 4분기 판처럼 머리가 다른 꼴도 1건.
  - VW: `ADHOC` → `('G','special_items','FY2026') == (10.0, 10.0)` + `value_text` 에 「around」 원문 · `('G','operating_margin_adjusted','FY2026') == (4.0, 4.0)` + `value_text` 에 「about」 원문. 기존 MUST_MISS(`operating_margin == (None, 1.0)` · 이전 범위 4.0~5.5·매출 증가율을 읽지 않음)는 **그대로 통과**해야 한다 — 그 시험의 주석 「조정 영업이익률 'about 4 percent' 는 이번 전망 아님」은 «`operating_margin` 칸의 값은 아님»으로 고친다.
  - 🔴 GM 새 행을 `GUIDANCE_REQUIRED` 에 넣지 않는다 — 넣으면 3지표뿐인 과거 판(2024~2025 · 8-K 7.01)이 failed 가 된다. 새 행은 «있으면 뽑는다».
- [ ] **Step 3: 구현** — `METRICS` 4줄 · GM·VW 파서. 방향 판정(`guidance_direction`)은 metric 단위라 새 키도 같은 규칙으로 돈다(시험 1건: 새 키 두 문서 → 값 비교로 raised/maintained).
- [ ] **Step 4: 시험** — 자가 시험 · `pytest` · `collect_customer_numbers.py --company GM --dry-run` · `VOW3.DE`. 이미 parsed 인 문서는 `--reparse` 해야 새 행이 생긴다 — 대상 문서 id 목록을 보고서에 적는다(실행은 Task 12 에서 메인이).
- [ ] **Step 5: 커밋.**

### Task 10: 미룬 작은 문제 묶음

**Files:**

- Modify: `scripts/lib/llm_guidance.py`(`_STATED_WORDS` `:342-350`)
- Modify: `scripts/customer_parsers/polaris.py`·`rivian.py`(`expects_numbers`)
- Modify: `scripts/customer_parsers/stellantis.py`(합계 대조)
- Modify: `scripts/customer_parsers/vw.py`(`_RANGE_WORD` `:64` · 근사어)
- Test: `scripts/lib/test_customer_parsers.py` · 각 모듈 자가 시험

항목:

1. **`raised` 어간 `increas` 조임** — 지금 `\bincreas` 는 «매출이 늘었다» 같은 실적 문장에도 걸려, 숫자 비교를 못 하는 행·`other` 행의 stated 거르기가 느슨하다. `raised` 판정 = `rais(e|ed|es|ing)` 단독 또는 «(increas|boost|upgrad|lift|상향|올려|올린|높여|높인) + 같은 quote 안의 전망 낱말(guidance|outlook|forecast|target|expect|전망|목표|가이던스)». 전망 낱말에 `계획|plan|range|projection` 도 넣는다(실물 문장에 쓰인다). MUST_HIT `The Company increased its full-year guidance for adjusted EBITDA.`(기존 시험 `:558`) · `연간 매출 목표를 상향` · `전망을 올려` · `투자 계획을 상향` / MUST_MISS `Revenue increased 12% year over year to $5.2 billion.` · `판매가 늘어 매출을 올린 분기`(전망 낱말 없음). 🔴 한국어는 활용형을 낱낱이 나열하고 띄어쓰기 변이는 `\s*`(전역 경고 「한국어 부분 문자열」). 기존 STATED 시험 32건(`STATED_HIT` 26 · `STATED_MISS` 6 · `llm_guidance.py:538·569`)이 그대로 통과해야 한다 — `('lowered', '투자 계획을 내린 15조 원')` 처럼 이미 `계획` 을 전망 낱말로 쓰는 행이 있다.
2. **P4 「서식 미인식」 오탐** — 분기 잠정 «범위»만 낸 EDGAR 8-K Item 2.02(폴라리스 2025-10-14 · 리비안 2026-07-06 — `collect_customer_numbers._expects_numbers` docstring)는 새로 오면 경고가 한 번 뜬다. 두 파서에 `expects_numbers(doc)` 훅을 두어 «잠정 범위 공시» 꼴을 False 로 — 가르는 근거(제목·items·본문 첫 문장)는 두 실물로 확인. 근거가 실물에 없으면 고치지 말고 보고(지금 동작 = 한 번 뜨고 사람이 넘김 — 문서화돼 있다). 훅이 생기면 `_expects_numbers` 기본 갈래(EDGAR 2.02)는 그 회사에서 쓰이지 않으므로 훅 안에서 2.02 조건을 다시 포함한다.
3. **스텔란티스 출하 합계 대조** — `collect_stellantis_shipments_ir.py:83` `TOTAL_LABEL`(전사 합계 행 `'stellantis'`)과 `extract_row_thousands` 는 있지만(2단계 T9) 고객사 파서의 연결 출하와 맞대는 대조가 없다. 같은 분기의 «EDGAR 실적 보도자료 연결 출하»(stellantis 파서 행)와 «IR 출하 표 합계 행»이 다르면 — 🔴 파서가 메모를 넘길 통로가 지금 없다(`ParseResult` 에 메모 칸 없음 `base.py:101` · 수집기 `notes` 는 `process` 지역 변수 `collect_customer_numbers.py:582-634` · Codex 대조) → `ParseResult.notes: list[str] = field(default_factory=list)` 를 더하고 `process` 가 `notes.extend(res.notes)` 하도록 한 줄(Files 에 `base.py`·`collect_customer_numbers.py` 추가 · 기존 파서는 안 쓰면 빈 목록이라 그대로) — 문서 note 에 「출하 합계 불일치(EDGAR n천 · IR m천)」 + 상태 사유(값은 버리지 않는다 · exit 0). 허용오차 = 반올림 단위(천 대 → ±1). IR 출하 표를 어디서 읽을지(같은 원문 표를 받아 `extract_row_thousands` 로 읽기 · 또는 기존 표 `stellantis_*` 를 읽기만)는 착수 때 보고 — 🔴 기존 표·수집기는 고치지 않는다. 대조할 IR 원문을 받을 방법이 Playwright 뿐이면(D8 과 같은 사이트) 이 항목은 멈추고 보고(3단계로).
4. **VW `approximately`/`about`** — `_RANGE_WORD` 에 둘을 더하되 `around` 와 같은 근사 처리(숫자 그대로 · 원문 구절을 `value_text` · 2단계-ag). Task 9 의 `operating_margin_adjusted` 와 겹치지 않게 — MUST_HIT `expects Group sales revenue in 2026 of approximately €315 billion` · MUST_MISS(근사어가 이전 전망 구절 안이면 읽지 않음 — 기존 `previous forecast` 규칙 유지).

- [ ] **Step 1~4**: 항목별 시험 → 구현 → 자가 시험·`pytest`.
- [ ] **Step 5: 커밋**(항목별 커밋 권장).

### Task 13: 폭스바겐 중국 시장 동향 — 숫자 + 문서 목록 (E4 · 실행 순서 = Task 10 다음, Task 11 앞)

사용자 지시(2026-11-10): 「폭스바겐은 중국시장에서의 동향도 추가해.」 범위 선택 = **숫자 + 문서 목록**(서술형 동향 요약은 3단계).

**Files:**

- Modify: `scripts/customer_parsers/vw.py`(인도 표 파서 — 지금 `World` 행만 읽는다 `:237-239` · `_DELIV_HEAD` · 자가 시험). 🔴 자가 시험의 펼치기 키 `('V', x.metric, x.period)`(`vw.py:477`)에 지역이 없어 중국 행이 전 세계 행을 덮는다(Codex 재현: 전체 100→999 로 바꿔도 중국 30 이 덮어 결과 동일) → 키에 `x.region` 을 넣고 기존 기대 키(`ADHOC`·인도 시험 등)를 함께 고친다.
- Modify: `scripts/lib/ir_lists.py`(Task 2 의 갤러리 결과에서 China Investor Update 판정 — Task 2 가 이미 `investor_day` 로 넣었으면 `form` 만 확인)
- Modify: `lib/customers/format.ts`(지역 이름 표에 `china: '중국'` · Task 8 과 같은 자리) · `lib/customers/format.test.ts`
- Check: `lib/customers/ir.ts` `buildVolumeSeries` `:298-318` · `components/customers/CustomerVolumeCompare.tsx`(total 이 아닌 지역도 계열로 뜨는지 — 뜨면 손댈 것 없음)
- Test: `scripts/lib/test_customer_parsers.py`

**Interfaces:**

- Consumes: Task 2 의 VW 갤러리 행(`investor_day` · China Investor Update 2026-04-23 PDF 6건 — 조사 `ir_germany.md:24`) · 기존 `customer_volume_ir` 꼴.
- Produces: `customer_volume_ir(metric='deliveries', region='china', period_grain=<기존 VW 인도 행과 같은 값>)` · (원문에 있으면) 중국 합작사 지분법 영업 결과 행 — 키 이름은 실물 라벨을 보고 정한다(새 `METRICS` 키가 필요하면 Task 9 와 같은 방식으로 한 줄 · 보고서에).

- [ ] **Step 1: 실측** — 이미 parsed 인 VW 인도 보도자료 1건을 `fetch_content` 로 받아 인도 표의 시장 행 이름을 적는다(`China` 단독 행인지 · `China incl. Hong Kong` 같은 꼴인지 · 단위). 실적 보도자료·반기 보고서에 «China joint ventures proportionate operating result» 같은 행이 있는지 찾는다(**미확인** — 없으면 그 행은 만들지 않는다).
- [ ] **Step 2: 실패하는 시험** — 인도 표(실물 행 그대로) → `World` 행(기존 · 그대로 통과) + `China` 행 → region `'china'`. MUST_MISS: `Asia-Pacific`·`North America` 같은 다른 시장 행은 이번에 내지 않는다(범위 = 중국 · 다른 시장을 더할지는 사용자 판단) · 중국 행 라벨을 못 찾으면 중국 행만 빠지고 `World` 행은 그대로(문서를 failed 로 만들지 않는다 — 중국 행은 «있으면 뽑는다»).
- [ ] **Step 3: 구현** — `vw.py` 인도 파서에 중국 행 · 화면 지역 라벨 한 줄 · (있으면) 합작사 결과 행.
- [ ] **Step 4: 시험** — 자가 시험 · `pytest` · `npm run check-all`(TS 를 고쳤으므로) · `collect_customer_numbers.py --company VOW3.DE --dry-run` 에서 새 중국 행 수. 이미 parsed 인 인도 문서는 `--reparse` 대상 — id 목록을 보고서에(실행은 Task 12).
- [ ] **Step 5: 화면 확인** — dev 서버 + 헤드리스(`~/.claude/scripts/headless_check.py`)로 VW 상세의 물량 차트에 「중국」 계열이 보이는지 찍어 본다(DB 에 행이 생기는 것은 Task 12 뒤라 이 단계는 Task 12 Step 4 에서 메인이 대신해도 된다 — 보고서에 적는다).
- [ ] **Step 6: 커밋.**

### Task 11: 문서 · 결정 이행 · 전체 검증

**Files:**

- Modify: `docs/customers-collection.md` · `docs/commands.md`
- Modify: `docs/plans/2026-11-10-customers-ir-expansion_결정이행.md`(이행 칸)

- [ ] **Step 1**: `docs/customers-collection.md` — 회사별 새 출처(무엇을 목록에 넣고 무엇을 숫자로 읽나 · 링크만인 것) · 50MB 상한 · `--close` · GM CDP 경로와 「GHA 미확인 — `probe_gm_ir` 로 확인 · 막히면 PC」 · 포르쉐 팩트시트 · 모비스 Script · 새 지표 키 4개 · 일정 출처 우선순위 · 수집 대상(E1).
- [ ] **Step 2**: `docs/commands.md` 종료 코드 표가 실제와 맞는지 다시 확인(`too_large` 는 exit 0 · `--close` 인자 오류 2).
- [ ] **Step 3**: 결정 이행 문서의 D1~D9·E1~E5 이행 칸(그대로/변경+근거). `docs/customers-collection.md` 에 VW 중국 행(Task 13)·지역 키 `us`·`china` 도.
- [ ] **Step 4**: 전체 검증 — `pytest scripts/lib -q` · 숫자 수집 자가 시험 · `npm run check-all` · (공용 헬퍼 시그니처를 바꿨으면) `verify_call_contracts.py`.
- [ ] **Step 5: 커밋.**

### Task 12: 기존 문서 다시 처리 (E3 · 메인이 직접 · 최종 검토 수정 뒤)

구현 서브에이전트에 맡기지 않는다 — 최종 검토와 수정이 끝난 뒤 메인 세션이 돌린다.

- [ ] **Step 0: 새 문서 목록 본 적재** — `collect_customer_docs.py`(드라이런 아님)를 11곳에 돌려 Task 2~8·13 의 새 문서를 `customer_documents` 에 넣는다(목록만 · 매일 GHA 가 푸시 뒤 할 일과 같다). 이어 `collect_customer_numbers.py`(드라이런 아님)로 새 문서를 처리한다 — 새 코드 대상(포르쉐 팩트시트 · 모비스 Script · GM 인도)은 코드로, 현대·기아 CID 등 LLM 대상은 LLM 으로. 회사별 새 문서 수 · parsed/not_target/failed 수 · LLM 토큰을 기록(Global Constraints 「목록 드라이런」 줄의 실물 확인).
- [ ] **Step 1: 대상 목록** — Task 9·13 보고서의 GM·VW 문서 id · stated 4줄 문서(폴라리스 303·304 · 스텔란티스 317·318 — 2단계 HANDOFF) · Task 10-1 로 stated 가 바뀔 수 있는 문서(`customer_guidance.stated is not null` 이고 `extractor='llm'` 인 행의 문서 — 쿼리로 뽑는다) · Task 9 새 키로 옮겨 갈 수 있는 LLM 문서(`extractor='llm'` 이고 `metric in ('operating_margin','other')` 이면서 `metric_label`/quote 에 조정·특별 항목·EPS·영업현금흐름 낱말이 있는 행의 문서 — 쿼리로 뽑아 건수를 먼저 보고 · 0건이면 그렇게 적는다). 문서별로 «LLM 을 부르는지»(`llm_wants`/`llm_only`)를 표시.
- [ ] **Step 2: 드라이런** — 대상마다 `--reparse <id> --dry-run` 으로 바뀔 행 수를 본다(🔴 2단계 기록: `--dry-run` 도 LLM 을 부른다 — LLM 대상 문서는 드라이런을 건너뛰고 본 실행만 한다).
- [ ] **Step 3: 본 실행** — 한 건씩 `--reparse <id>`. 각 실행의 바뀐 행 수 · LLM 토큰(Task 5 출력)을 기록. 실패(exit 1)가 나면 거기서 멈추고 원인을 본다. 🔴 exit 0 이 완료가 아니다 — LLM 실패로 재시도 대기(`pending`)가 되거나 키가 없어 LLM 을 건너뛰어도 0 이 나오고 옛 LLM 행이 남는다(`collect_customer_numbers.py:659-680` · Codex 대조). 문서마다 실행 뒤 `parse_status='parsed'` · LLM 대상이면 이번 실행에서 LLM 이 돌았는지(토큰 줄) · 새 행의 `created_at` 이 실행 시각 뒤인지를 확인하고, 어긋나면 그 문서를 다시 한다.
- [ ] **Step 4: 확인** — 새 지표 행 `verified=true` 수 · LLM 문서의 metric 별 행 수 전후(Task 9 — 새 키로 옮겨 간 행) · stated 4줄이 지워졌는지 · 방향(`direction`) 재계산 결과를 Supabase MCP `execute_sql`(읽기)로 확인. 금액·비중 같은 사외비 값은 출력하지 않는다(고객사 공개 지표는 사외비가 아니지만 행 수·verified 수만 보고).
- [ ] **Step 5: 기록** — 결과를 HANDOFF·결정 이행 문서(E3)에. 코드 변경이 없으면 커밋할 것은 문서뿐.

---

## 범위 밖 (이 계획에서 하지 않는다)

| 항목                                                                                                  | 왜                                               |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 스텔란티스 IR 자료실(슬라이드·녹취록·팩트시트·Investor Day 세션)                                      | D8 — 3단계(설계서 「2단계에서 넘어온 것」)       |
| 그림 PDF 값 읽기(GM Investor Day·컨퍼런스 덱 · 모비스 CID)                                            | D3                                               |
| 녹취록·ESG·신용등급 등 새 문서 종류                                                                   | D4                                               |
| 부문별·중기 수치(EV 대수 목표·원가절감 %·BOM 절감·현지화율)                                           | D5 — 3단계 신호 표                               |
| 차종 단위 물량(GM 모델별 인도 · 포르쉐 차종별)                                                        | `customer_volume_ir` 에 차종 칸 없음 — 구조 결정 |
| 모비스 경영전략 갈래(CID 이미지 PDF)                                                                  | D3 · 넣으면 LLM 3회 실패 → failed                |
| 폴라리스 녹취록 · VW 연차보고서 XLSX · 포르쉐 연차보고서 전망 표 · 기아 생산 그래프 · 컨퍼런스·NDR 덱 | 조사 표 「나중」                                 |
| GM 사용자 PC 정기 실행 등록                                                                           | D1 — GHA 결과를 본 뒤                            |
| GM 뉴스 MP Materials 섞임 · 폴라리스 뉴스 · 화면 `-0` · 스텔란티스 MarkLines 2020 YTD                 | 고객사 수집과 무관한 별도 과제(HANDOFF)          |
| 완성차 노조 갈등·파업 추적                                                                            | E5 — 새 기능 · 별도 설계·계획서                  |
| VW 중국 서술형 동향 요약 · 중국 외 시장 행                                                            | E4 — 3단계 / 사용자 판단                         |

## 미확인 (착수 중 실측 · 지어내지 않는다)

1. VW 「Deliveries to Customers」 페이지가 분기 인도 보도자료 링크를 갖는지(Task 2).
2. 포르쉐 팩트시트 인도 시트 이름·칸 배치(Task 3).
3. 기아 `ir-activity` page 동작 — 조사와 기존 수집기 docstring 상충(Task 7-1).
4. KGM 분기 실적 공시 제목 꼴 · I003 공시 유무(Task 7-5·6).
5. GM Deliveries PDF 총계 행 라벨 · GM 추가 전망 4지표의 위치·라벨(Task 8·9).
6. ubuntu-latest 러너의 Chrome 유무 · GHA IP 에서 GM 접근 성공 여부(Task 8 — 후자는 푸시 뒤 사용자 실행).
7. CID 1건 LLM 토큰·잘림(Task 5 Step 5).
8. 폴라리스·리비안 잠정 범위 8-K 를 가를 근거(Task 10-2).
9. 스텔란티스 IR 출하 원문을 HTTP 로 받을 수 있는지(Task 10-3).
10. VW 인도 표의 중국 행 라벨 · 중국 합작사 지분법 결과 행 유무(Task 13).
11. 지금 한 회사에 실적 일정 출처가 둘 이상 겹치는지(Task 6 — 대조 결과 0 으로 보이나 DB 로 센다).
