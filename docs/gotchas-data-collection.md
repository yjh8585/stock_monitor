# 함정: 데이터 수집 (DART · fnguide · 외부 수집기)

`AGENTS.md`에서 옮겨온 실측 함정 전문이다(원문 보존). **분량이 커 자동 로드에서 뺐을 뿐,
중요도는 그대로다.** 수집기를 건드리기 전에 읽는다.

| 트리거                                    | 볼 항목                                        |
| ----------------------------------------- | ---------------------------------------------- |
| DART 계정명↔컬럼 매핑 수정                | DART 계정명 매칭 금지 규칙                     |
| 회사명으로 corp_code 해석 · 동명이인 의심 | 동명이인 엔티티 검증                           |
| 비상장사 재무가 비어 있음                 | `finstate_all` 무데이터 → 감사보고서 HTML 경로 |
| `/domestic`·`/parts-top100` 값 이상       | 2026-07-18 감사 계통 오류                      |
| LLM 수집기 모델 교체 (vision·PDF 추출)    | 모델 전환 시 thinking 기본값 · 검증 경로       |
| GHA 수집 워크플로 실패 로그 읽기          | `KRX 로그인 실패`는 원인이 아니다              |
| fnguide 재무 수집 수정                    | fnguide 계약·적재 함정                         |
| Stellantis 북미 출하 수집 수정            | 출하 수집기 2종(IR primary · EDGAR 보완)       |
| Cox 딜러 재고일수 수집 실패               | 슬러그·파일명 불규칙 · outlier 제외 규칙       |
| 사외비 월별손익 sync 수정                 | 사외비 적재 세부(검증·dedupe·실 정정)          |
| OEM 차종 경쟁 분석 수집 수정              | `country` 의미 · 지표 앵커월 · NHTSA 조회      |

관련 문서: [`data-audit-2026-07-18.md`](./data-audit-2026-07-18.md)(정정 실행 결과) ·
[`fnguide-wcomp-migration.md`](./fnguide-wcomp-migration.md)(fnguide 신버전 계약)

---

- **DART 계정명→컬럼 매핑은 부분문자열 매칭 금지** — 반드시 `collect_dart_audit._match_acct`(정확일치 우선 + `ACCT_REJECT`) 경유. 짧은 키 `'매출'`이 `'매출채권'`(외상매출금)을 잡아 매출채권을 revenue로 오적재한 버그가 있었다(2026-07-17, 국내 상장사 다수 매출 축소·이익률 뻥튀기). **회사명→corp_code 부분매칭도 짧은 이름의 중간 삽입 매칭 금지**(`_name_contains_match` 길이·경계 가드) — 과거 `'워트' in '한국파워트레인'`, `'지디' in '인지디스플레이'`로 비상장 회사가 엉뚱한 상장 티커로 승격됐다. 약한 매칭 corp_code는 **자동 캐시 금지**(완전일치만). **⚠️ 동명이인 방어**: `collect_dart_domestic._resolve_corp_code`는 **DB `dart_corp_code` > `manual_dart_mapping` > `find_corp_code(name_kr)`+개체검증** 순으로 해석한다(2026-07-18 수정). 이전엔 이름을 최우선 재해석해 동명이인(다스·삼송·동희·우진공업 등 비상장 다수)이 재수집마다 엉뚱한 동명 소기업에 오배정됐다. **DB corp·수동매핑은 신뢰(무검증), 이름 해석분은 엔티티 검증으로 게이트**(2026-07-18 구현): 해석된 corp의 DART `company.json` 프로필(상장코드·홈페이지)이 우리 회사와 맞는지 `collect_dart_audit._verify_corp_identity(info, profile)`(순수)로 판정 → `'confirm'`(상장코드 일치 or 홈페이지 도메인 일치)/`'reject'`(상장코드 불일치·상장/비상장 어긋남·비상장 placeholder의 상장 승격)/`'unknown'`. 정책 `_identity_allows`: **confirm→통과, reject→차단, unknown→동명(정확일치 후보 2개↑)일 때만 차단**(사용자 결정 '동명 있을 때만 차단' — 동명 없으면 홈피 확증 없어도 수집 유지). ⚠️ `hm_url`은 모회사/JV 도메인 잡음이 섞여 도메인 **불일치만으로는 reject 안 함**(일치할 때만 confirm 근거). 회사당 `company.json` 1회 추가 호출(일일한도 2만의 <1%). 배선 3곳: domestic·audit `_resolve_corp_code_impl`(다중후보는 induty is_auto+identity 결합, 확증 후보 우선·전부 미확증이면 스킵. **삼송처럼 동명 후보가 둘 다 자동차면 induty 무력 → 홈피로 tie-break**)·`enrich_company` 자동캐싱(confirm일 때만 DB 저장). `profile=None`이면 게이트 skip(범위 밖 호출부 무회귀). 회귀 테스트 `scripts/lib/test_dart_corp_match.py`(`TestDomainKey`·`TestVerifyCorpIdentity`·`TestIdentityAllows`). **여전히 남는 사각지대 = 홈페이지·상장코드 둘 다 없는 비상장 동명이인**(예 위월드·티피씨 등 5개사) → 이 경우 수동 `manual_dart_mapping.json` 필요. 동명 회사 재무를 지울 땐 **행 삭제 대신 값만 NULL**(행 유지=has_fin)해야 재수집 재오염 방지. **비상장사는 `finstate_all` API가 "데이터없음(013)" 반환** → 감사보고서 HTML 파싱만 가능. 그 audit-HTML 경로가 `_collect_year`의 튜플버그(`_get_audit_rcpt` 3튜플을 통째로 `_get_main_doc_url`에 전달 → `'tuple' object has no attribute 'isdecimal'`)로 전면 실패하던 것을 2026-07-17 수정(rcpt_no만 전달). 상세 → 메모리 `project_domestic_data_contamination_2026_07_17`. **⚠️ DART audit-HTML 파싱 스코프**(2026-07-18): `_parse_financial_tables`는 손익계정을 '손익계산서 첫 본표'(매출액 + 영업이익/순이익 동시 보유)에서만, 대차계정을 재무상태표 본표에서만 추출(`income_done`/`balance_done`). 성질별 손익계산서엔 매출원가 행이 없어 주석/요약표에서 잘못 집던 것(단위 1000×·세부라인)을 차단 — 이런 회사는 **cogs=None이 정상**(미보고). OpenDartReader `sub_docs`는 라이브러리 버그(`name 'url' is not defined`, dart_utils.py:141)라 직접 호출 말고 `_get_main_doc_url`(직접 트리 파싱 + 주석 배제 `_pick_statement_node`) 경유. 회귀 `test_dart_statement_scope.py`·`test_dart_docsel.py`.

- **GHA 로그 맨 끝의 `KRX 로그인 실패`는 실패 원인이 아니다** (2026-08-10 실측) — `disable_pykrx_autologin()`이 pykrx import 전에 `KRX_ID`/`KRX_PW`를 `os.environ`에서 pop하므로, pykrx가 import 시점에 stdout으로 `KRX 로그인 실패: KRX_ID 또는 KRX_PW 환경 변수가 설정되지 않았습니다.`를 찍는다 — **우리 코드 문자열이 아니다**(`scripts/` 전체에 없다. 우리 것은 `krx_auth.py`의 `KRX 로그인 실패 — KRX 수집을 건너뜁니다.`). 직후 `ensure_krx_login()`이 직접 로그인해 `KRX 로그인 시도.../완료.`가 이어지고 코스피·코스닥은 정상 수집된다(성공 run 31350128047에서 각 1,221행). ⚠️ **pykrx는 stdout, loguru는 stderr라 GHA 로그에서 순서가 뒤섞여 실행 초반의 이 세 줄이 로그 맨 끝에 몰려 보인다** → `--log-failed`를 tail로 읽으면 마지막 줄이라 진짜 원인처럼 읽힌다(자격증명 Secret은 멀쩡한데 "KRX secret 만료"로 오진하기 쉽다). **진짜 원인은 그 위 `market_series 수집 실패: <이유>` 줄**이다(2026-08-09 실패는 `Server disconnected`, 외부 일시 오류라 이후 8회 연속 성공). 같은 이유로 실패 로그는 tail이 아니라 `Select-String`으로 `ERROR|실패` 라인을 뽑아 읽을 것.

- **LLM 수집기 모델을 바꿀 땐 thinking 기본값부터 확인** (2026-08-06 Opus 4.7 → Sonnet 5 전환 실측) — **모델마다 `thinking` 생략 시 동작이 다르다.** Opus 4.7은 생략 = 사고 없음이지만 **Sonnet 5는 생략 시 adaptive thinking이 기본 on**이다. 그대로 두면 (a) 사고 토큰이 과금돼 전환 목적인 비용 절감이 상쇄되고 (b) `max_tokens`가 사고+응답 **합산** 상한이라 tool_use 출력이 잘린다 → `thinking={'type': 'disabled'}`를 명시한다(`collect_cox_inventory.py`·`collect_hyundai_quarterly_earnings.py`·`collect_uzauto_financials.py` 적용). 세 스크립트 모두 `tool_choice`로 도구를 강제하므로 "thinking off 시 도구를 덜 쓴다"는 Sonnet 5의 알려진 경향에는 영향받지 않는다(이게 전환을 안전하게 만든 조건). 모델은 전부 env var(`COX_INVENTORY_MODEL`·`HYUNDAI_QUARTERLY_MODEL`·`UZAUTO_FINANCIALS_MODEL`)로 즉시 환원 가능. **⚠️ 검증 경로는 수집기마다 다르다**: Cox는 `--dry-run --year-month YYYYMM --reprocess-all`이 A/B 도구다 — `--reprocess-all`을 빼면 로컬 sha256 캐시가 히트해 **LLM 호출 0**이라 모델이 바뀐 것을 검증하지 못하고(실측으로 한 번 헛돌았다), 붙이면 `diff_rows`가 판독값을 기존 DB(옛 모델 적재분)와 대조해 정확도 차이를 자동 보고한다(202605·202606 둘 다 "기존 DB와 값 변경 없음", 이상치 제외 브랜드·불규칙 파일명 케이스 포함). 반면 **`collect_hyundai_quarterly_earnings.py`·`collect_uzauto_financials.py`는 `--dry-run`이 LLM 호출 자체를 건너뛰어**(각각 "PDF 다운로드+sha256까지만", "링크 추출까지만") DB에 쓰지 않고 추출 정확도만 보는 경로가 없다 → 실환경 첫 실행 로그로 확인할 것.

- **국내 재무 수집기 계통 오류 (2026-07-18 감사 → 정정·근본수정 완료)**: /domestic·/parts-top100 전수 감사(32건 CONFIRMED)로 확인된 수집기 계통 버그 — (a) **fnguide 분기 Q4 슬롯에 연간누적값**(153개사, `collect_financials.py` 분기 파싱 L385~510; annual 행은 정상, 분기합·Q4차트만 오염), (b) **`부채총계`가 `부채및자본총계(=자산총계)`를 오파싱**해 `total_liabilities==total_assets`(79개사217행, `collect_financials.py` 계정맵 L75 — `_match_acct`식 정확일치 미이식; 부채비율 지표 오염), (c) **market='KOSPI' 기본값**(실제 KOSDAQ 72+KONEX 3 오표기, `rematch_dart_unmatched.py:121` 하드코딩·`classify_new_marklines.py` LLM; pykrx 재도출로 정정), (d) DART audit-HTML **천원→백만원 단위 미변환** cogs(케이비오토텍·평화기공·피엔디티, `_table_unit_divider` 오인식), (e) **결산월 오설정**(동원모빌리티(구 동원금속) 3월인데 `fiscal_year_end_month=12`→열정렬 어긋나 매출 과소). corp **레거시 오배정 3건**(일진복합소재·베바스토코리아·서한이노빌리티 — 2026-07-18 게이트가 DB corp를 신뢰해 자동 미교정, 수동 DB 정정 필요). **정정 체크리스트·재현쿼리·수정대상 파일 → [`docs/data-audit-2026-07-18.md`](./data-audit-2026-07-18.md)** + 메모리 `project_domestic_parts_audit_2026_07_18`. 회사소개·부품사 해외상장사는 클린. **✅ 전량 해결(세션 2~4, 2026-07-18)**: 근본은 위 `collect_financials.py` fnguide 레이아웃 변경 + DART 파싱 스코프였다(옛 L385~510/L75 번호 무의미). P1 계통(Q4=연간·부채=자산·market)은 산술/pykrx로, cogs는 파싱스코프로, corp 3건은 수동 DB로 정정. KR 상장 ~169 신선 재수집 완료. 상세 → `docs/data-audit-2026-07-18.md` 상단 "정정 실행 결과".

- **fnguide 재무 수집(`collect_financials.py`)은 도메인·구조를 자주 갈아엎는다** (2026-07 레이아웃 변경 → 2026-08 도메인 이전, 두 번 다 KR 상장사 0행) — **현재 계약은 신버전 `wcomp.fnguide.com` JSON 엔드포인트**(`getFinIncome`/`getFinBalance`, `cmp_cd`+`freq_typ=Y|Q`+`consol_typ=C|P`). 브라우저 불필요, `scripts/lib/fnguide_client.py` 경유. 계정은 이름이 아니라 **표준 `AC_CODE`로 매칭**(200000 매출·130000 부채총계 등)해 '부채총계'가 '부채및자본총계'를 집던 부류를 원천차단한다. 분기 응답이 discrete 분기값이라 Q4=연간 버그도 차단. ⚠️ **연간(Y) 응답에 `(최근분기)` 열이 섞여 오고, `(전년동기)` 열은 손익에만 있어 적재하면 반쪽 행이 온전한 행을 덮는다** → `period_columns()`의 라벨 배제 규칙을 건드리지 말 것(단 결산월과 최신분기가 겹치면 라벨이 아예 안 붙는다). 연결(C) 우선·없으면 별도(P) 자동 폴백. 구조 변경 감지 가드 `_kr_health_ok`: KR 절반↑ 0행이면 `sys.exit(2)`. **계약이 또 깨졌는지는 `scripts/verify_fnguide.py`로 먼저 확인**(주 1회 `verify-fnguide.yml`이 자동 실행). 대상=`get_kr_companies()`(market 있는 전 KR ~169). 회귀 `test_fnguide_wcomp.py`. 계약표 전문 → [`fnguide-wcomp-migration.md`](./fnguide-wcomp-migration.md).

- **Stellantis 북미 출하(도매) 수집기는 2개, IR 홈페이지가 primary·EDGAR가 보완** (사용자 지시 2026-07-16) — 적재처 `stellantis_shipments`.
  - `collect_stellantis_shipments_ir.py` (**primary**) — **stellantis.com IR 홈페이지**의 분기 'Estimated Consolidated Shipments' 릴리스. **2026-01부터 이 릴리스가 지역별 절대값 표를 싣는다**(첫 열 `units/000`, `North America` 당기값을 직접 → `is_derived=false`). EDGAR 재무결과보다 ~2주 먼저 나오고 차분 도출이 불필요하다. **stellantis.com은 Akamai가 requests/curl을 403 차단하므로 Playwright 실브라우저로 우회**한다(과거 "쓰지 않는다"에서 정정 — 2026 형식 변경으로 primary 승격). 목록 페이지(`/en/news/press-releases`)에서 슬러그 `stellantis-reports-q{N}-{YYYY}-estimated-consolidated-shipments`로 PR 자동 발견. ⚠️ 2026-01-01부로 **'where sold' 기준 + 마세라티 지역 합산**이라 pre-2026(EDGAR, 마세라티 별도)과 완전 동일 기준은 아니다(북미 마세라티는 작아 방향엔 영향 미미). 파싱 회귀 `scripts/lib/test_stellantis_shipments_ir.py`. 워크플로 `collect-stellantis-shipments-ir.yml`(Jan/Apr/Jul/Oct 16·22·28일, Playwright chromium).
  - `collect_stellantis_shipments.py` (**보완·백필**) — SEC EDGAR 6-K(`data.sec.gov/submissions/CIK0001605484.json`, **UA 헤더 필수**). 지역별 절대값 표가 실린 실적 PR은 **Q1/H1/Q3/FY 4회만** → **Q2 = H1 − Q1, Q4 = FY − H1 − Q3** 차분 도출(`is_derived=true`, ±1,000대). **pre-2026 백필 + 교차검증**을 맡는다. **IR이 이미 실측(is_derived=false)으로 채운 분기를 차분값으로 덮지 않는 가드**(`existing_direct_quarters()`) 내장 — H1 발표 후 EDGAR가 Q2를 차분해도 IR 직접값(예: 26Q2 445천대)이 보존된다. 파싱 회귀 `scripts/lib/test_stellantis_shipments.py`.

- **Cox 브랜드별 딜러 재고일수(`collect_cox_inventory.py`) → `cox_brand_inventory`** — 무료·무로그인이나 **브랜드별 수치가 차트 JPEG 안에만** 있어 Anthropic vision 판독. URL 슬러그가 불규칙(어순 2종·full/축약 혼용, `february-`는 404이고 `feb-`가 정답) → **WordPress REST API 커스텀 포스트 타입 `insight`**로 발견(기본 `posts`는 빈 배열). **⚠️ Cox는 업계 평균(NATION) 2배 초과 브랜드를 차트에서 빼고 이름만 싣는다** → `days_supply=null` + `is_outlier_excluded=true`로 적재(값 없음이 아니라 "NATION×2 이상"이라는 신호. **대상 브랜드는 달마다 바뀐다** — Chrysler 202512~202603, Ram·Dodge 202606). **행 자체가 없는 것**은 저물량 제외·로스터 누락·판독실패로 의미가 다르니 섞지 말 것. **⚠️ 차트 이미지 파일명도 불규칙** — 실측 9개월은 전부 `inventory`를 포함했으나 202606은 `Slide1-v2.jpeg`(파워포인트 기본 내보내기 이름)로 올라와 파일명 필수 힌트가 깨졌다(2026-07-20 GHA 실패). `select_chart_image`는 힌트가 전부 어긋나면 **본문 이미지가 유일할 때만** 파일명 무관 채택하고, 여러 장이면 찍지 않고 None(차트 여부 최종 판정은 vision·`validate_extraction`에 위임). 파일명 힌트에 새 단어를 덧대는 식으로 대응하지 말 것. `temperature`는 **지정 금지**(Opus 4.7·Sonnet 5 모두 sampling 파라미터 거부 → 400 에러). 모델·`thinking` 설정은 위 「LLM 수집기 모델을 바꿀 땐…」 항목을 따른다. freshness 게이트가 조용한 정지를 exit 3으로 알린다.

- **사외비 월별손익 sync 8종의 적재 세부** (`sync_pnl_excel`·`sync_pnl_plan`·`sync_inventory`·`sync_personnel`·`sync_pnl_cost_structure`·`sync_pnl_fixed_variable`·`sync_finance`·`sync_loan`) — **"stdout에 금액·인원수 비노출"이라는 약속 자체는 AGENTS.md에 남아 있다.** 여기엔 실행 세부만 적는다. `sync_inventory.py`는 4분류합 vs 전체재고 검증(mismatch 행수만 보고, 임계 0.5%), `sync_finance.py`는 자산==부채+자본 항등식 검증(mismatch 시점수만 보고, 임계 0.5%) + '재무' 시트 '연간' 텍스트/월=12를 annual(연말)로, 월=1~11을 monthly로 정규화하고 PK 중복행(`자본` 중복 등)을 dedupe. `sync_loan.py`는 '이인텔리전스' 시트→`loan_entries`(억원, kind '계획'/'실적' 한글 그대로, 공란→null). WriteSession 자동 revalidate(`NEXT_REVALIDATE_URL` — 로컬은 localhost). **로컬 수동 실행은 프로덕션 캐시가 안 비워지므로 `--revalidate-prod` 플래그로 추가 무효화**(`NEXT_REVALIDATE_PROD_URL`+`NEXT_REVALIDATE_SECRET`, 적재 성공 후 1회). `pnl_cost_structure` 포함 5종 테이블은 `lib/revalidate.py` `COLUMN_TO_TAGS`에 매핑(누락 시 무효화 no-op). **엑셀에서 행 삭제·차원(실/부문/공장/제품/거래처) 변경 시 단순 resync로는 옛 PK 행이 DB에 잔존**(sync는 8차원 충돌키 upsert-only, delete 안 함) → 해당 행 DB delete 후 resync 필수(메모리 `project_pnl_dimension_change_resync`). **거래처의 실(sil) 소속이 바뀌면 엑셀 수정을 기다리지 말고 `sync_pnl_excel.py`의 `SIL_BY_CUSTOMER`에 한 줄 추가**(현재 `UZ Auto → 2실`, 사용자 지시 2026-07-30) — `sil`이 충돌키에 포함돼 엑셀이 옛 실로 남으면 옛/새 실 양쪽에 행이 생겨 합계가 이중 계산된다. 정정은 `normalize_sil()`이 `merge_by_pk` 전에 적용되어 옛·새 실 행이 같은 PK로 합산되고, 정정 건수는 **시트당 경고 1줄**로 업로드 화면 경고 목록에 뜬다. 기존 DB 행은 마이그레이션으로 1회 UPDATE(예 `20260730000001`). 회귀 `scripts/lib/test_sync_pnl_sil.py`.

- **`sync_longterm_revenue.py`는 위 8개와 별개다** — 입력이 월별손익이 아니라 **영업본부 중장기 매출 계획 엑셀**(`LONGTERM_EXCEL_PATH` env 우선, 없으면 `참고/영업계획/*.xlsx` 최신 glob)이라 **`sync_management_excel.py` 오케스트레이터에 등록하지 않는다**(등록 시 dry-run이 `unrecognized arguments`가 아니라 엉뚱한 파일을 읽어 통째 실패). 분기 1회 로컬 수동 실행 + `--revalidate-prod`. stdout은 (기준·계열)별 행수·연도·null 카운트만 — 금액 비노출. 시트 레이아웃(B3/D3/계열 라벨/기준 라벨 형식)이 어긋나면 exit 2로 즉시 실패(조용한 오적재 방지).

---

## 적재·파싱·진단 함정 (AGENTS.md에서 이관, 2026-08-12)

### 🔴 `.range()` 페이지네이션은 결정적 정렬이 없으면 행을 잃는다

1000행을 넘겨 여러 페이지로 fetch 할 때는 **반드시 `.order()`를 동반**한다(가급적 PK 전체).

`.in()`/필터가 걸린 조회는 인덱스 스캔이라 **정렬이 없으면 페이지 경계에서 행이 누락·중복된다.**
실제 사례: `lib/oem/source.ts` 의 `fetchModelRows` 가 전 국가를 fetch 하면서 정렬이 없어
**특정 연도가 통째로 누락**됐고, 그 결과 차트가 near-zero 로 그려졌다.

- WHERE 없는 `fetchAll` 은 seq-scan 이라 정렬 없이도 안정적이다(그래서 더 헷갈린다).
- **증상으로 알아보는 법**: 연간 합계는 정상인데 **차트만 특정 구간이 낮다** → 집계 버그가 아니라
  fetch 누락을 의심할 것.

### 집계 뷰의 `SUM`은 문자열로 온다

`SUM(int/bigint)` 은 Postgres 에서 `numeric` 이고, PostgREST(@supabase/supabase-js)가 `numeric` 을
**문자열로 직렬화**한다 → JS 산술이 조용히 깨진다(`"12" + 1 === "121"`).

→ 뷰 정의에서 `SUM(x)::bigint`(값 범위가 맞으면 `::int`)로 캐스팅해 number 로 반환시킨다.
예: `oem_sales_country_group_year`. **개별 int 컬럼은 number 로 정상 도착**하므로
`SUM`/`AVG` 등 **집계만** 해당한다.

### fnguide 는 도메인·구조를 자주 갈아엎는다

2026-07 과 2026-08, **두 번 다 KR 상장사 재무가 0행**이 됐다. 원인은 매번 fnguide 쪽 개편이었다.

- fnguide 접근은 **반드시 `scripts/lib/fnguide_client.py` 경유**(URL 을 스크립트에 직접 박지 말 것).
- **계약이 깨졌는지는 `scripts/verify_fnguide.py` 로 먼저 확인**한다(주 1회 `verify-fnguide.yml` 자동 실행).
  수집기를 뜯기 전에 이것부터 돌린다.

### `financials.source` 를 지우는 두 가지 경로

값은 `scripts/lib/financial_sources.py` 의 상수만 쓴다. 한 회사에 **여러 출처 행이 공존**하므로
(예: 상장사에 fnguide 행과 dart 행이 같이 있다) 출처가 비면 값이 틀렸을 때 **어느 수집기를 고칠지
특정할 수 없다.**

- ⚠️ **기존 행의 지표만 덧쓰는 UPDATE 경로에서는 `source` 를 건드리지 말 것** — 원 출처가 지워진다.
  `collect_global_snapshot.py` 의 PER/PBR 갱신이 그 사례라서, `source` 주입을 **INSERT 경로에만** 넣었다.
- ⚠️ **행 dict 의 키 개수로 "실데이터 유무"를 판정하는 코드가 있다**
  (`collect_dart_domestic._build_rows` 의 `_META_KEY_COUNT`). 메타 키를 늘리면 **그 상수도 함께** 고칠 것.

### LLM 추출 수집기는 로컬에서 돌아간다 (문서가 반대로 적혀 있었다)

`collect_uzauto_financials.py`·현대 분기 IR·`collect_cox_inventory.py` 등은 **로컬 실행 가능**하다.

`ANTHROPIC_API_KEY` 가 `scripts/.env` 엔 없지만 **프로젝트 루트 `.env.local` 에 있고**,
`lib/bootstrap.py` 의 `init_script()` 가 `scripts/.env` 와 `<root>/.env.local` 을 **둘 다** 로드한다
(2026-07-15 실측 정정 — 그 전까지 AGENTS.md 는 "로컬 실행 불가"라고 **잘못** 적고 있었다).

구식 스크립트가 `scripts/.env` 만 로드한다면 그건 그 스크립트의 boilerplate 문제이니
`init_script` 로 교체할 것. GHA Secrets 에도 같은 키가 있어 워크플로 실행도 가능하다.

### 스캔 PDF 는 텍스트 추출이 0자다

UzAuto IFRS 등 **스캔본**은 `pypdf`/`pdfplumber` 텍스트 추출이 0자이고, Read 도구의 PDF 렌더도
`pdftoppm`(poppler) 미설치로 실패한다.

→ venv `pymupdf`(fitz)로 페이지를 이미지로 렌더한 뒤 Read(vision)로 판독한다:
`fitz.open(p)[n].get_pixmap(dpi=200).save(png)`

### openpyxl `read_only=True` 단독 결과를 신뢰하지 말 것

손익·사외비 엑셀을 파싱 디버깅할 때, `read_only=True` 는 **행/열 인덱싱이 어긋나는 경우가 있다** —
부문값이 제품열로 읽히는 오진을 실제로 관측했다.

→ `read_only=False`(`ws.cell`) 또는 sync 의 `parse_sheet()` 를 직접 호출해 **교차검증**한다.

🔴 **더 심한 변형: `read_only=True`가 0행을 반환**(2026-08-13, `참고/oem 판매량/MarkLines_sales_data*.xlsx` 5개 파일 전부 재현). 시트 XML의 `<dimension ref="A1"/>` 태그가 실제 데이터 범위를 반영하지 않으면(생성 툴 버그로 추정) `read_only=True`의 `iter_rows(min_row=3, ...)` 최적화 경로가 행을 전혀 안 내놓는다 — 에러 없이 조용히 빈 리스트. `ws.max_row`도 `1`로 잘못 보고돼 증상을 숨긴다. → 이 경우도 `read_only=False`로 전체 로드하면 정상 동작한다. 가장 큰 5.8MB 파일(`MarkLines_sales_data_en.xlsx`) 단독 raw 행 수는 32,181행, 소요 약 27초 — 이 32,181은 파일 1개의 raw 행 수이고, 5개 파일을 전부 병합·중복제거해 DB에 적재한 최종 합계는 24,688행으로 **서로 다른 값**이니 혼동하지 말 것.

### Excel COM 시트→이미지 렌더는 대상 시트가 뒤바뀐다

`wb.ExportAsFixedFormat`(워크북 단위)은 **활성 시트 또는 전체 시트**를 내보내서 엉뚱한 시트가 나온다.

→ `ws.Activate()` + **`ws.ExportAsFixedFormat`(워크시트 단위)** 를 쓴다.
PrintArea 를 `UsedRange` 로만 잡으면 **셀 밖 도형(변경요약 박스 등)이 잘리므로**
도형(`ws.Shapes[].BottomRightCell`)까지 포함해 범위를 잡고 여백을 0 으로 준다.

### 🔴 렌더 산출물 검증은 실제로 열어볼 것

이미지/PDF 는 **"픽셀 해시가 다르다"만 보면 *내용이 뒤바뀐 것*을 못 잡는다.**
조직도 시트 swap 버그를 정확히 이 함정으로 놓쳤다.

→ Read(vision)로 **제목·구조·매핑을 눈으로** 확인한다.
사외비면 제목/구조만 보고 실명은 전사하지 않는다.

### Storage REST 업로드는 `apikey` 헤더도 필요하다

이 프로젝트의 `SUPABASE_SERVICE_ROLE_KEY` 는 신형 `sb_secret_...` 키라서
`Authorization: Bearer` 외에 **`apikey` 헤더도 함께** 보내야 한다.
(JS admin client 는 알아서 처리하므로 무관 — Python `requests` 로 직접 업로드할 때만 걸린다)

### 경영관리 업로드 적재 실패는 GHA 로그로 알 수 없다

`sync_management_excel.py` 오케스트레이터는 8개 사외비 sync 를 subprocess 로 순차 실행하는데,
**GHA 로그엔 오케스트레이터 라인만 보인다.**

→ 어떤 sync 가 왜 실패했는지는 `management_uploads.summary->'scripts'`(Supabase SQL)의
`exit_code`·`output`(각 sync stdout 캡처)으로 확인한다.

또한 엑셀 경로는 8개 모두 `MANAGEMENT_EXCEL_PATH` env 우선
(`scripts/lib/management_excel.py` 의 `resolve_excel_path`, 없으면 `참고/손익` glob).

### dry-run 정합성 경고는 staleness 아티팩트일 수 있다

`sync_pnl_fixed_variable` 은 업로드 엑셀의 '고정비' 시트를 DB `pnl_cost_structure`(**적재 전이라
한 업로드 뒤처진 상태**)와 대조한다. 그래서 진행연도 YTD 월수 차이 때문에 mismatch 경고가 떠도
**적재 후에는 0% 로 reconcile 된다.** 경고만 내고 차단하지 않는다 — 이걸 실패로 오인하지 말 것.

### GHA revalidate 시크릿 이름 오타는 조용히 스킵된다

수집 워크플로는 revalidate 시크릿을 **`NEXT_REVALIDATE_SECRET`** 으로 넘겨야 한다
(`lib/revalidate.py` 가 읽는 이름). `sync-oem-excel.yml`·`sync-oem-production-excel.yml` 이
`REVALIDATE_SECRET` 오타여서 **GHA 캐시 무효화가 조용히 스킵**되던 것을 2026-07-17 에 교정했다.

증상: **적재는 정상인데 화면만 `cacheLife` TTL 로 뒤늦게 갱신된다.**
신규 워크플로를 만들 때 이름을 정확히 확인할 것.

---

## OEM 차종 경쟁 분석 수집 함정 (2026-08-13)

`collect_oem_model_outlook.py` v2 재작성에서 **실제로 터진** 것들이다.
파이프라인 자체의 설명(경쟁군 SSOT·시장 구성·주기·비용)은
[`oem-collection.md`](./oem-collection.md) 「핵심 차종 경쟁 분석」 절이 정본이다.

### 🔴 생산과 판매의 `country` 는 의미가 정반대다

- `oem_production_model_country_month.country` = **공장 국가**(어디서 만들었나)
- `oem_sales_model_country_month.country` = **판매 시장**(어디서 팔렸나)

그래서 국가별로 생산 − 판매를 차감하면 수출입이 통째로 섞여 **무의미한 숫자**가 나온다
(멕시코 공장 생산 → 미국 판매가 양쪽 국가에서 각각 큰 갭으로 잡힌다).

→ 생산-판매 갭 지표는 **1차 범위에서 제외**했다. `build_digest(production_gap=...)` 인자와
포맷 코드는 남아 있지만 수집기는 항상 `None` 을 넘긴다. 되살린다면 **글로벌 합계 근사로만**
의미가 있고, 국가별 차감은 하지 말 것.

### `country` 에 대륙 값이 없다 — 'Europe' 로 필터하면 0행

니로의 **유럽 시장**을 `country = 'Europe'` 으로 잡으려 했으나 그런 값이 아예 없다(개별 국가만
있다). 필터를 빼면 이번엔 전 국가 합산이라 **유럽 시장이 글로벌로 뭉개진다** — 첫 구현이 실제로
그렇게 뭉개진 채 지표를 냈다.

→ `oem_competitor_set.countries text[]` 에 **서유럽 14개국을 명시**해 필터한다(Germany · UK ·
France · Italy · Spain · Netherlands · Sweden · Poland · Belgium · Austria · Norway · Denmark ·
Portugal · Switzerland). `countries IS NULL` 은 **GLOBAL(전 국가)** 이라는 의미로만 쓴다.
🔴 대상 차종과 경쟁 차종에 **같은 국가 집합**을 적용해야 점유율이 공정하다.

### MarkLines 의 `'N/A'` 모델을 반드시 제외한다

MarkLines 판매 데이터에는 미분류 행이 `N/A`(및 `N/A (Trucks)`) 모델명으로 들어 있고, 이게
**각국 판매 1위로 잡힌다.** 상위 모델을 뽑는 쿼리·스크립트를 새로 짤 때마다 같은 필터가 필요하다.

→ `scripts/lib/model_segment.py` 의 `EXCLUDED_MODELS` + `startswith('N/A')` 로 제외한다.

### 🔴 경쟁 지표의 기준월을 두 데이터셋에서 동기화해야 한다

대상 차종과 경쟁군은 MarkLines 도착 시점이 달라 **최신월이 어긋난다.** 각자의
`max(year_month)` 를 기준으로 12개월 창을 잡으면 서로 다른 기간을 비교하게 되고, 점유율이
**조용히 왜곡된다** — 에러도 경고도 나지 않는다.

→ 공통 앵커 = 두 최신월 중 **min**. `compute_market_metrics()` 가 앵커를 계산해
`anchor_month` 로 돌려주고, caller 가 그 값을 `compute_competitor_table(..., anchor=...)` 에
그대로 넘긴다(`_load_markets`). 프롬프트·화면에도 "언제 기준 수치인지"를 노출한다
(`outlook_prompt._fmt_market` 의 시장 헤더). 회귀 `scripts/lib/test_competition_metrics.py`.

**선례**: `lib/stellantis-forecast` 의 `lastCompleteMonth` — 생산·소매 도착 시점이 달라 공통
최신월까지만 쓴다. 도착 시점이 다른 두 시계열을 비교할 때마다 같은 처방이 필요하다.

### 🔴 NHTSA 모델명은 **접두 매칭**으로 풀어야 한다 — 정확 일치는 조용히 0건을 만든다

**가장 위험한 실패 모드다. 0건은 에러가 아니라 "리콜 없는 안전한 차"로 읽힌다.**

NHTSA 표기에는 파생형 접미사가 붙는다: `civic sedan` · `sienna hybrid hev` ·
`f-150 (super crew) gas` · `model x bev` · `niro hev` · `ram 1500 crew cab`.
리콜 API 는 이름이 틀려도 **Count 0** 을 돌려주므로 매핑 오류와 "리콜 없음"이 구분되지 않는다.

2026-08-13 에 `products/vehicle/models` 끝점으로 전수 검증했더니 **기존 매핑에서 실제 누락**이 나왔다:

| model_key     | 옛 매핑                  | 실제 NHTSA 이름        | 결과                                          |
| ------------- | ------------------------ | ---------------------- | --------------------------------------------- |
| `ram_truck`   | `['1500','2500','3500']` | `ram 1500 crew cab` 등 | **주력 1500 이 통째로 빠지고 `3500` 만** 잡힘 |
| `niro`        | `['niro']`               | `niro hev`             | 최신 연도에서 매번 헛폴백                     |
| `porsche_911` | `['911']`                | `911 carrera gts` 등   | 2024년형까지 밀려남                           |

→ `_list_models()` 로 그 make·연도의 **실제 모델 목록**을 받아 접두 매칭한다(`_resolve`).
매핑은 `(make, 접두 패턴, 제외 접두)` 3-튜플이고, 패턴이 하나도 안 잡히면 **경고를 남긴다**
(0건과 매핑 오류를 구분하기 위한 것 — 이 경고가 없으면 다시 조용해진다).

⚠️ **접두 매칭은 과잉 매칭을 부른다** — `corolla` 는 `corolla cross` 까지 잡는데 둘은 다른
차종이고 경쟁군에 각각 따로 있다. 그래서 제외 접두가 필요하다(`Corolla` → exclude
`['corolla cross']`, `Hummer Pickup` → exclude `['hummer ev suv']`, `Silverado` → exclude
`['silverado ev']`).

**리콜(`issueType=r`)과 불만(`issueType=c`)의 모델 목록이 서로 다르다.** 실측: Ram 2026 리콜
목록에는 `ram 1500 crew cab` 이 있지만 불만 끝점은 그 이름에 400 을 준다. 목록을 하나로 쓰면
그 파생형의 불만이 조용히 0 이 된다 → `_resolve(..., 'c')` 로 따로 풀되, 불만 목록을 못 받으면
리콜 이름으로 폴백한다. **한 건도 성공하지 못하면 `complaint_count = None`**(= 알 수 없음).
0 으로 두면 화면과 AI 가 "불만 없는 차"로 읽는다.

- **'데이터 없음'에도 HTTP 400 을 준다.** 아직 등록되지 않은 모델연도(예: 2026)를 조회하면
  Count 0 이 아니라 400 이 온다. 이걸 오류로 로깅하면 **정상 폴백마다 경고가 쏟아진다.**
  → `_get()` 은 비-200 을 조용히 `None` 으로 흡수하고, `MODEL_YEARS = [2026, 2025, 2024]` 로
  **모델연도 폴백**해 데이터가 처음 잡히는 연도를 쓴다(전 연도가 비면 `None` = 근거 미포함).
  네트워크 예외·JSON 파싱 실패만 `logger.warning` 대상이다.
- **모델 목록 조회가 간헐적으로 빈 본문을 준다**(연속 호출 시). 한 번 재시도한다 — 목록이 비면
  그 차종 건수가 통째로 0 이 되므로 위와 같은 오독을 부른다.

### Cox 재고일수는 최신 1행만 보면 안 된다

Cox 는 값이 업계평균을 크게 벗어나면 **그 달을 비워 둔다.** `order(year_month desc).limit(1)` 로
최신 1행만 집던 옛 `_load_inventory` 는 실측(2026-08-13)에서 **Ram 202606=NULL** 을 집어
"재고 데이터 없음"으로 저장했다 — 바로 앞 달 **202605=144일** 이 멀쩡히 있는데도.

→ `not_.is_('days_supply', 'null')` 로 거르고 **브랜드별 최신 non-null** 을 쓴다
(`_load_inventory_by_brand`). 기준월이 브랜드마다 다를 수 있으므로 `year_month` 를 함께 저장해
화면에 표기한다.

#### 🔴 그런데 non-null 만 집으면 **정반대 방향의 오독**이 생긴다 (2026-08-14 사용자 지적)

값이 빈 달은 "모르는 달"이 아니라 **업계 평균의 2배를 넘어 Cox 가 감춘 달**이다. 그 사실을 함께
넘기지 않으면 파이프라인 전체가 "직전 달의 멀쩡한 값"만 보게 된다:

- **화면**: `Ram 144일 (2026.05)` 만 뜬다. 2026-06 에 이상치로 빠졌다는 신호가 어디에도 없다.
- **AI 프롬프트**: `outlook_prompt.py` 에 경고 문구가 이미 있었지만 조건이 `days_supply is None`
  이었다 — 수집기가 non-null 만 넘기므로 **그 분기는 한 번도 실행된 적이 없다.** 조건이 코드에
  있다는 것과 동작한다는 것은 다르다.

처방: `_load_inventory_by_brand` 가 `outlier_excluded`·`outlier_month` 를 함께 싣고, 프롬프트와
화면이 **플래그로** 판정한다. 판정 기준월은 **Cox 전체의 최신 집계월**이다 — 브랜드 자신의 마지막
행으로 판정하면 그 달 로스터에서 통째로 빠진 브랜드(Lincoln 202601 등)까지 이상치로 몰아 없는
사실을 만든다. 화면(`lib/oem-competition/source.ts`)은 스냅샷 대신 `cox_brand_inventory` 를 직접
읽어 재수집 없이 최신 상태·직전 공개월 대비 증감을 반영한다.

실측(2026-08-14): `202606` 에 **Dodge·Ram 이 이상치 제외**됐고, 그 시점 화면은 Ram 을 2026-05 의
144 일로 아무 경고 없이 보여주고 있었다.

🔴 **재고일수는 브랜드 단위·미국 시장**이다(차종 아님). 같은 브랜드의 두 차종에 같은 값이 쓰인다
— 화면 문구에 반드시 남긴다. 경쟁 브랜드 매핑은 `oem_model_brand` 테이블이 정본이고
**Tesla·Rivian·Lucid·Jaguar 는 Cox 로스터에 없어 미등록**이다(그래서 리비안 경쟁군은 재고 비교 불가).

### `max_tokens` 는 사고+응답 합산 상한 — 잘리면 그 차종만 조용히 빠진다

**증상**: 2026-08-13 첫 GHA 실행에서 10종 중 `ram_truck` 하나만 갱신되지 않았다.
워크플로는 `success`, 나머지 9종은 정상. 그 차종만 옛 행이 그대로 남았다.

**원인**: `max_tokens=4000` 이었는데 이 값은 **adaptive thinking 토큰과 응답을 함께** 덮는
상한이다. 서술이 가장 긴 차종(`ram_truck` = 1500/2500/3500 합산)에서 JSON 이 문자열 중간
(`competitive_view` 970자 지점)에서 잘려 `json.loads` 가 실패했고, `_evaluate` 가 `None` 을
반환하자 `main` 의 `if not result: continue` 가 그 차종만 건너뛰었다.

**처방**: `max_tokens=16000`. 과금은 실제 사용량 기준이라 **상한만 올리는 것은 비용에 영향이
없다.** 같은 함정이 `collect_cox_inventory.py` 에도 기록돼 있다(브랜드 ~30개 tool_use 출력).

**놓치기 쉬운 이유**: 실패가 exit code 로 드러나지 않는다. 수집기는 `stop_reason == 'max_tokens'`
경고와 JSON 파싱 ERROR 를 남기지만 **전체 실행은 성공**하고, 화면에는 옛 데이터가 그대로 보인다.
→ 적재 후 확인은 행 수가 아니라 **`note_date` 가 오늘인 행이 대상 종수와 같은지**로 한다.

**일부 차종만 다시 채우려면** 전체 재실행($0.73, 멀쩡한 차종까지 덮어씀) 대신 `--only` 를 쓴다:

```powershell
scripts/venv/Scripts/python.exe scripts/collect_oem_model_outlook.py --only ram_truck
scripts/venv/Scripts/python.exe scripts/collect_oem_model_outlook.py --only ram_truck niro
```

알 수 없는 `model_key` 를 주면 가능한 값을 찍고 **아무것도 적재하지 않은 채** 중단한다.
🔴 로컬 실행은 `scripts/.env` 의 `NEXT_REVALIDATE_URL` 이 dev 를 가리켜 **프로덕션 캐시가
갱신되지 않는다**(로그에 revalidate 404). 프로덕션에 반영하려면 `/api/revalidate` 를
`{"tags":["oem_model_outlook"]}` 로 직접 호출한다.

## 휴머노이드 기업 데이터 함정 (2026-08-24)

`/humanoid` 페이지를 만들며 실제로 터진 것만 적는다. 규칙 요약은 `AGENTS.md` 「`/humanoid` 상세」.

### 1. 🔴 정규화 결과값을 raw 키로도 넣지 않으면 저장할 때마다 `'기타'`로 뭉개진다

`product_category_map` 은 `raw_category → normalized` 사전이고,
`companies_normalize_products` 트리거가 **INSERT/UPDATE 마다** `normalize_product_category()` 를 다시 적용한다.
즉 **정규화 결과값 자체가 raw 키로 등록돼 있지 않으면, 이미 정규화된 값을 다시 저장할 때 매핑에 실패해 `'기타'` 로 떨어진다.**

로봇 11종 중 10종은 raw 와 정규화값이 같은 문자열이라(`'감속기'→'감속기'`) 우연히 왕복이 성립했고,
`'볼스크류/리니어'` **하나만** raw 키가 `'볼스크류'`·`'LM가이드'` 뿐이라 왕복이 깨졌다.

증상은 두 갈래로 나타났고 **둘 다 조용했다**:

- 11개사의 볼스크류 제품이 `'기타'` 가 되어 **제품군 필터에서 통째로 빠졌다**(에러 없음)
- 시드의 "이미 그 카테고리가 있나" 검사가 영영 false 라 **재실행마다 항목이 늘었다**(멱등성 파괴)

발견 경위: 시드를 두 번 돌려 `products` 합계가 278 → 280 으로 늘어난 것을 보고 역추적했다.
**멱등성 시험이 없었으면 못 찾았다** — 화면에는 "필터에 안 걸리는 회사"로만 보였을 것이다.

⚠️ **앞선 검증이 이걸 놓친 이유**: 왕복을 raw 키(`'볼스크류'`)로만 시험하고 실제 저장값(`'볼스크류/리니어'`)으로 시험하지 않았다.
**검사는 코드가 실제로 쓰는 값으로 해야 한다.**

처방 = `20260824000005`. 11종 전부를 raw 키로 넣고, 마이그레이션 끝에 왕복 실패 시 `RAISE EXCEPTION` 하는 회귀 가드를 뒀다.
**카테고리를 늘릴 때 정규화 결과값을 raw 키로 함께 넣을 것.**

### 2. `trg_auto_page_mapping()` 은 `data_source` 만 보므로 로봇사가 자동차 표에 섞인다

휴머노이드 회사도 주가·재무는 같은 수집기(yfinance/fnguide/dart)를 쓴다.
그대로 두면 `yfinance` → `parts-top100`, `fnguide/dart` → `domestic` 으로 자동 매핑돼
**유니트리·Figure AI 가 자동차 부품사 TOP100 순위표에 들어간다.**

처방 = `20260824000003`. `robot_roles` 가 있으면 `data_source` 와 무관하게 `'humanoid'` 로만 매핑한다.
겸업사(현대모비스·셰플러 등)는 **이미 등록돼 있고 이 트리거는 AFTER INSERT 전용**이라
UPDATE 로 `robot_roles` 를 붙여도 발동하지 않는다 → 자동차 매핑이 보존되고 humanoid 매핑만 수동 추가하면 된다.

### 3. `companies.data_source` 는 NOT NULL 이다 — 비상장사도 값이 필요하다

비상장 로봇사에 `NULL` 을 넣다 `23502` 로 INSERT 전체가 실패했다.
기존 관례(실측): 한국 상장 `fnguide`(162사) · 해외 상장 `yfinance`(96사) · **한국 비상장 `dart`(245사)** · 해외 비상장 `marklines`(36사).
해외 비상장 로봇사는 자동차 부품 DB 인 `marklines` 가 맞지 않아 `financial_sources.py` 의 정식 상수 `web_search` 를 썼다.

### 4. Management API 는 전체를 트랜잭션으로 감싼다 (안전한 쪽의 함정)

위 3번으로 INSERT 가 실패했을 때, **앞서 성공한 UPDATE 35건도 함께 롤백**됐다(적용 0건 확인).
부분 적용을 걱정해 손으로 되돌리려 하지 말 것 — 실패했으면 아무것도 안 들어갔다.
