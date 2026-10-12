# 함정: 데이터 수집 (DART · fnguide · 외부 수집기)

`AGENTS.md`에서 옮겨온 실측 함정 전문이다(원문 보존). **분량이 커 자동 로드에서 뺐을 뿐,
중요도는 그대로다.** 수집기를 건드리기 전에 읽는다.
**날짜 붙은 경위·사고 서사·실측표·인용은 [경위 문서](./history/gotchas-data-collection-경위.md) 의 같은 제목 절로 옮겼다**(2026-10-12). 여기엔 규칙·처방만 둔다.

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
| 휴머노이드에 회사를 새로 추가             | 기존 증권사 리포트 연결이 끊긴 채 남는다       |

관련 문서: [`data-audit-2026-07-18.md`](./data-audit-2026-07-18.md)(정정 실행 결과) ·
[`fnguide-wcomp-migration.md`](./fnguide-wcomp-migration.md)(fnguide 신버전 계약)

---

- **DART 계정명→컬럼 매핑은 부분문자열 매칭 금지** — 반드시 `collect_dart_audit._match_acct`(정확일치 우선 + `ACCT_REJECT`) 경유(`'매출'`이 `'매출채권'`을 잡는다). **회사명→corp_code 부분매칭도 짧은 이름의 중간 삽입 매칭 금지**(`_name_contains_match` 길이·경계 가드). 약한 매칭 corp_code는 **자동 캐시 금지**(완전일치만).
  - **⚠️ 동명이인 방어**: `collect_dart_domestic._resolve_corp_code`는 **DB `dart_corp_code` > `manual_dart_mapping` > `find_corp_code(name_kr)`+개체검증** 순. DB corp·수동매핑은 신뢰(무검증), 이름 해석분은 `collect_dart_audit._verify_corp_identity(info, profile)`로 `'confirm'`/`'reject'`/`'unknown'` 판정 → `_identity_allows`: **confirm→통과, reject→차단, unknown→동명(정확일치 후보 2개↑)일 때만 차단**(사용자 결정). `hm_url` 도메인 **불일치만으로는 reject 안 함**. 동명 후보가 둘 다 자동차면 induty 무력 → 홈피로 tie-break. `profile=None`이면 게이트 skip. 회귀 `scripts/lib/test_dart_corp_match.py`.
  - **남는 사각지대 = 홈페이지·상장코드 둘 다 없는 비상장 동명이인** → 수동 `manual_dart_mapping.json`. 동명 회사 재무를 지울 땐 **행 삭제 대신 값만 NULL**(행 유지=has_fin)해야 재수집 재오염 방지.
  - **비상장사는 `finstate_all` API가 "데이터없음(013)"** → 감사보고서 HTML 파싱만 가능(`_get_audit_rcpt` 는 rcpt_no 만 넘긴다).
  - **⚠️ DART audit-HTML 파싱 스코프**: `_parse_financial_tables`는 손익계정을 '손익계산서 첫 본표'에서만, 대차계정을 재무상태표 본표에서만 추출(`income_done`/`balance_done`). 성질별 손익계산서 회사는 **cogs=None이 정상**. OpenDartReader `sub_docs`는 라이브러리 버그라 직접 호출 말고 `_get_main_doc_url`(주석 배제 `_pick_statement_node`) 경유. 회귀 `test_dart_statement_scope.py`·`test_dart_docsel.py`.

- **GHA 로그 맨 끝의 `KRX 로그인 실패`는 실패 원인이 아니다** — pykrx 가 import 시 stdout 으로 찍는 문구다(우리 것은 `krx_auth.py`의 `KRX 로그인 실패 — KRX 수집을 건너뜁니다.`). 직후 `ensure_krx_login()`이 직접 로그인한다. pykrx는 stdout·loguru는 stderr라 순서가 뒤섞여 맨 끝에 몰린다 → **진짜 원인은 그 위 `market_series 수집 실패: <이유>` 줄**. 실패 로그는 tail이 아니라 `ERROR|실패` 라인을 뽑아 읽을 것.

- **LLM 수집기 모델을 바꿀 땐 thinking 기본값부터 확인** — Sonnet 5는 `thinking` 생략 시 adaptive thinking이 기본 on이다(사고 토큰 과금 + `max_tokens`가 사고+응답 **합산** 상한이라 tool_use 출력이 잘린다) → `thinking={'type': 'disabled'}`를 명시한다. 모델은 env var(`COX_INVENTORY_MODEL`·`HYUNDAI_QUARTERLY_MODEL`·`UZAUTO_FINANCIALS_MODEL`)로 즉시 환원 가능.
  - **⚠️ 검증 경로는 수집기마다 다르다**: Cox는 `--dry-run --year-month YYYYMM --reprocess-all`(빼면 sha256 캐시 히트로 **LLM 호출 0**) · `collect_hyundai_quarterly_earnings.py`·`collect_uzauto_financials.py`는 `--dry-run`이 LLM 호출을 건너뛰므로 실환경 첫 실행 로그로 확인.

- **국내 재무 수집기 계통 오류 (2026-07-18 감사 → 정정·근본수정 완료)** — 정정 체크리스트·재현쿼리·수정대상 파일 → [`docs/data-audit-2026-07-18.md`](./data-audit-2026-07-18.md) 상단 "정정 실행 결과". corp 레거시 오배정은 게이트가 DB corp를 신뢰하므로 **자동 교정되지 않는다**(수동 DB 정정).

- **fnguide 재무 수집(`collect_financials.py`)은 도메인·구조를 자주 갈아엎는다** (2026-07 레이아웃 변경 → 2026-08 도메인 이전, 두 번 다 KR 상장사 0행) — **현재 계약은 신버전 `wcomp.fnguide.com` JSON 엔드포인트**(`getFinIncome`/`getFinBalance`, `cmp_cd`+`freq_typ=Y|Q`+`consol_typ=C|P`). 브라우저 불필요, `scripts/lib/fnguide_client.py` 경유. 계정은 이름이 아니라 **표준 `AC_CODE`로 매칭**(200000 매출·130000 부채총계 등)해 '부채총계'가 '부채및자본총계'를 집던 부류를 원천차단한다. 분기 응답이 discrete 분기값이라 Q4=연간 버그도 차단. ⚠️ **연간(Y) 응답에 `(최근분기)` 열이 섞여 오고, `(전년동기)` 열은 손익에만 있어 적재하면 반쪽 행이 온전한 행을 덮는다** → `period_columns()`의 라벨 배제 규칙을 건드리지 말 것(단 결산월과 최신분기가 겹치면 라벨이 아예 안 붙는다). 연결(C) 우선·없으면 별도(P) 자동 폴백. 구조 변경 감지 가드 `_kr_health_ok`: KR 절반↑ 0행이면 `sys.exit(2)`. **계약이 또 깨졌는지는 `scripts/verify_fnguide.py`로 먼저 확인**(주 1회 `verify-fnguide.yml`이 자동 실행). 대상=`get_kr_companies()`(market 있는 전 KR ~169). 회귀 `test_fnguide_wcomp.py`. 계약표 전문 → [`fnguide-wcomp-migration.md`](./fnguide-wcomp-migration.md).

- **Stellantis 북미 출하(도매) 수집기는 2개, IR 홈페이지가 primary·EDGAR가 보완** (사용자 지시 2026-07-16) — 적재처 `stellantis_shipments`.
  - `collect_stellantis_shipments_ir.py` (**primary**) — **stellantis.com IR 홈페이지**의 분기 'Estimated Consolidated Shipments' 릴리스. **2026-01부터 이 릴리스가 지역별 절대값 표를 싣는다**(첫 열 `units/000`, `North America` 당기값을 직접 → `is_derived=false`). EDGAR 재무결과보다 ~2주 먼저 나오고 차분 도출이 불필요하다. **stellantis.com은 Akamai가 requests/curl을 403 차단하므로 Playwright 실브라우저로 우회**한다(과거 "쓰지 않는다"에서 정정 — 2026 형식 변경으로 primary 승격). 목록 페이지(`/en/news/press-releases`)에서 슬러그 `stellantis-reports-q{N}-{YYYY}-estimated-consolidated-shipments`로 PR 자동 발견. ⚠️ 2026-01-01부로 **'where sold' 기준 + 마세라티 지역 합산**이라 pre-2026(EDGAR, 마세라티 별도)과 완전 동일 기준은 아니다(북미 마세라티는 작아 방향엔 영향 미미). 파싱 회귀 `scripts/lib/test_stellantis_shipments_ir.py`. 워크플로 `collect-stellantis-shipments-ir.yml`(Jan/Apr/Jul/Oct 16·22·28일, Playwright chromium).
  - `collect_stellantis_shipments.py` (**보완·백필**) — SEC EDGAR 6-K(`data.sec.gov/submissions/CIK0001605484.json`, **UA 헤더 필수**). 지역별 절대값 표가 실린 실적 PR은 **Q1/H1/Q3/FY 4회만** → **Q2 = H1 − Q1, Q4 = FY − H1 − Q3** 차분 도출(`is_derived=true`, ±1,000대). **pre-2026 백필 + 교차검증**을 맡는다. **IR이 이미 실측(is_derived=false)으로 채운 분기를 차분값으로 덮지 않는 가드**(`existing_direct_quarters()`) 내장 — H1 발표 후 EDGAR가 Q2를 차분해도 IR 직접값(예: 26Q2 445천대)이 보존된다. 파싱 회귀 `scripts/lib/test_stellantis_shipments.py`.

- **Cox 브랜드별 딜러 재고일수(`collect_cox_inventory.py`) → `cox_brand_inventory`** — 브랜드별 수치가 **차트 JPEG 안에만** 있어 Anthropic vision 판독. 포스트 발견은 **WordPress REST API 커스텀 포스트 타입 `insight`**(슬러그 불규칙 · 기본 `posts`는 빈 배열).
  - **⚠️ NATION 2배 초과 브랜드는 차트에서 빠진다** → `days_supply=null` + `is_outlier_excluded=true`(대상 브랜드는 달마다 바뀐다). **행 자체가 없는 것**(저물량 제외·로스터 누락·판독실패)과 섞지 말 것.
  - **⚠️ 차트 이미지 파일명도 불규칙** — `select_chart_image`는 힌트가 전부 어긋나면 **본문 이미지가 유일할 때만** 채택, 여러 장이면 None. 파일명 힌트에 새 단어를 덧대지 말 것.
  - `temperature`는 **지정 금지**(sampling 파라미터 거부 → 400). 모델·`thinking`은 위 「LLM 수집기 모델을 바꿀 땐…」 항목. freshness 게이트가 조용한 정지를 exit 3으로 알린다.

- **사외비 월별손익 sync 8종의 적재 세부** (`sync_pnl_excel`·`sync_pnl_plan`·`sync_inventory`·`sync_personnel`·`sync_pnl_cost_structure`·`sync_pnl_fixed_variable`·`sync_finance`·`sync_loan`) — **"stdout에 금액·인원수 비노출"이라는 약속 자체는 AGENTS.md에 남아 있다.** 여기엔 실행 세부만 적는다. `sync_inventory.py`는 4분류합 vs 전체재고 검증(mismatch 행수만 보고, 임계 0.5%), `sync_finance.py`는 자산==부채+자본 항등식 검증(mismatch 시점수만 보고, 임계 0.5%) + '재무' 시트 '연간' 텍스트/월=12를 annual(연말)로, 월=1~11을 monthly로 정규화하고 PK 중복행(`자본` 중복 등)을 dedupe. `sync_loan.py`는 '이인텔리전스' 시트→`loan_entries`(억원, kind '계획'/'실적' 한글 그대로, 공란→null). WriteSession 자동 revalidate(`NEXT_REVALIDATE_URL` — 로컬은 localhost). **로컬 수동 실행은 프로덕션 캐시가 안 비워지므로 `--revalidate-prod` 플래그로 추가 무효화**(`NEXT_REVALIDATE_PROD_URL`+`NEXT_REVALIDATE_SECRET`, 적재 성공 후 1회). `pnl_cost_structure` 포함 5종 테이블은 `lib/revalidate.py` `COLUMN_TO_TAGS`에 매핑(누락 시 무효화 no-op). **엑셀에서 행 삭제·차원(실/부문/공장/제품/거래처) 변경 시 단순 resync로는 옛 PK 행이 DB에 잔존**(sync는 8차원 충돌키 upsert-only, delete 안 함) → 해당 행 DB delete 후 resync 필수(메모리 `project_pnl_dimension_change_resync`). **거래처의 실(sil) 소속이 바뀌면 엑셀 수정을 기다리지 말고 `sync_pnl_excel.py`의 `SIL_BY_CUSTOMER`에 한 줄 추가**(현재 `UZ Auto → 2실`, 사용자 지시 2026-07-30) — `sil`이 충돌키에 포함돼 엑셀이 옛 실로 남으면 옛/새 실 양쪽에 행이 생겨 합계가 이중 계산된다. 정정은 `normalize_sil()`이 `merge_by_pk` 전에 적용되어 옛·새 실 행이 같은 PK로 합산되고, 정정 건수는 **시트당 경고 1줄**로 업로드 화면 경고 목록에 뜬다. 기존 DB 행은 마이그레이션으로 1회 UPDATE(예 `20260730000001`). 회귀 `scripts/lib/test_sync_pnl_sil.py`.

- **`sync_longterm_revenue.py`는 위 8개와 별개다** — 입력이 월별손익이 아니라 **영업본부 중장기 매출 계획 엑셀**(`LONGTERM_EXCEL_PATH` env 우선, 없으면 `참고/영업계획/*.xlsx` 최신 glob)이라 **`sync_management_excel.py` 오케스트레이터에 등록하지 않는다**(등록 시 dry-run이 `unrecognized arguments`가 아니라 엉뚱한 파일을 읽어 통째 실패). 분기 1회 로컬 수동 실행 + `--revalidate-prod`. stdout은 (기준·계열)별 행수·연도·null 카운트만 — 금액 비노출. 시트 레이아웃(B3/D3/계열 라벨/기준 라벨 형식)이 어긋나면 exit 2로 즉시 실패(조용한 오적재 방지).

---

## 적재·파싱·진단 함정 (AGENTS.md에서 이관, 2026-08-12)

### 🔴 `.range()` 페이지네이션은 결정적 정렬이 없으면 행을 잃는다

1000행을 넘겨 여러 페이지로 fetch 할 때는 **반드시 `.order()`를 동반**한다(가급적 PK 전체).

`.in()`/필터가 걸린 조회는 인덱스 스캔이라 **정렬이 없으면 페이지 경계에서 행이 누락·중복된다.**

→ [경위](./history/gotchas-data-collection-경위.md)

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

→ [경위](./history/gotchas-data-collection-경위.md)

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

→ [경위](./history/gotchas-data-collection-경위.md)

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

→ [경위](./history/gotchas-data-collection-경위.md)

🔴 **더 심한 변형: `read_only=True`가 에러 없이 0행을 반환한다.** 시트 XML의 `<dimension ref="A1"/>`이 실제 범위를 반영하지 않으면 `iter_rows(min_row=3, ...)` 최적화 경로가 빈 리스트를 내고 `ws.max_row`도 `1`로 보고한다. → `read_only=False`로 전체 로드한다.

### Excel COM 시트→이미지 렌더는 대상 시트가 뒤바뀐다

`wb.ExportAsFixedFormat`(워크북 단위)은 **활성 시트 또는 전체 시트**를 내보내서 엉뚱한 시트가 나온다.

→ `ws.Activate()` + **`ws.ExportAsFixedFormat`(워크시트 단위)** 를 쓴다.
PrintArea 를 `UsedRange` 로만 잡으면 **셀 밖 도형(변경요약 박스 등)이 잘리므로**
도형(`ws.Shapes[].BottomRightCell`)까지 포함해 범위를 잡고 여백을 0 으로 준다.

**`Workbooks.Open` 은 상대 경로를 못 연다**(2026-09-07 실측). Excel 프로세스의 작업 폴더는
파이썬과 다르므로 `ORG_CHART_EXCEL_PATH=참고/조직도/x.xlsx` 처럼 상대 경로를 주면
"파일을 찾을 수 없습니다"(`com_error -2147352567`)로 죽는다 — 파일은 멀쩡히 그 자리에 있다.
→ 경로는 넘기기 전에 `Path.resolve()` 한다(`sync_org_chart.py` 의 `resolve_excel`).

### 🔴 렌더 산출물 검증은 실제로 열어볼 것

이미지/PDF 는 **"픽셀 해시가 다르다"만 보면 *내용이 뒤바뀐 것*을 못 잡는다.**

→ [경위](./history/gotchas-data-collection-경위.md)

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

## 2026-07-18 감사 잔여 3건을 실제로 고치며 드러난 것 (2026-09-11)

→ [경위](./history/gotchas-data-collection-경위.md)

### 🔴 DART 보고서 선택이 「정정 공시」 앞에서 무너진다 — 3년 전 실적이 최신 연도로 적재된다

`_get_audit_rcpt` 는 후보를 두 갈래로 받아들였다 — 보고서명에 연도가 있거나(`str(fy) in rpt`),
**제출일 추정**(`_infer_fiscal_year_from_rcept`: 1~6월이면 N-1, 7~12월이면 N)이 맞거나.
정정 공시는 몇 년 뒤에 나오므로 이 추정이 무력하다. 게다가 `_score_report` 가 `[기재정정]` 에
**+4점**을 줘서, 연도가 맞는 정답(점수 3)을 **연도가 틀린 정정본(점수 7)이 이긴다.**

→ [경위](./history/gotchas-data-collection-경위.md)

**처방**: `_stated_fiscal_year()` 로 보고서명의 `(YYYY.MM)` 을 읽어 **그것이 있으면 그것만 믿는다**
(다르면 후보에서 제외). 제출일 추정은 연도를 안 밝힌 보고서에만 쓴다. 정정본 «우선» 자체는
옳으므로 같은 연도 안에서는 그대로 이긴다. 회귀 = `scripts/lib/test_dart_fiscal_year.py`(11건).

### 🔴 수집기가 `hidden` 회사를 거르지 않아 유령 재무가 쌓이고 있었다 (2026-09-11)

→ [경위](./history/gotchas-data-collection-경위.md)

- 그런데 `collect_dart_audit.py` 의 수집 대상 필터에 **`status` 조건이 없었다** —
  `data_source == 'dart'` 만 봤다. 그래서 hidden 회사가 매번 수집됐고, 물려받은
  「일진」의 corp_code 로 **5년치 재무가 일진의 값 그대로 복제**됐다(소수점까지 동일).
- 🔴 **화면은 hidden 을 걸러 주니 아무도 못 봤다.** 「연도만 다르고 값이 같은 행」을
  전수로 세는 검사에서야 드러났다 — 화면에 안 보이는 데이터는 **검사기가 유일한 눈**이다.

**처방**: ①수집 대상에 `status == 'active'` 조건 추가(근본) ②유령 재무 5행 삭제
③`dart_corp_code` 를 NULL 로 비우고 `merged_into_company_id` 를 일진하이솔루스로 지정
(왜 hidden 인지 계보를 남긴다) ④「일진」 재수집 → **dart 출처 중복쌍 0건**.

⚠️ **`corp_name` 이 「일진」인 corp_code 가 DART 에 5건 있다**(00172839 · 00174068 ·
01373888 · 01288173 · 01465550). 이름만으로 고르면 틀린다 — **최근 공시가 있는 쪽**으로
확인할 것(00172839 만 2026-08 까지 공시가 있다).

### 🔴 fnguide 는 과거 연도를 «버린다» — 옛 파서가 남긴 값이 그 자리에 굳어 있었다 (2026-09-11)

→ [경위](./history/gotchas-data-collection-경위.md)

- 🔴 **재수집으로는 안 고쳐진다.** ①fnguide 화면이 **최근 3~4개 연도만** 준다(실측: 일진
  하이솔루스 FY2024~25 · 삼성SDI FY2023~25) ②`collect_financials.py` 의
  `RECENT_YEARS_KEEP=2` 가 그보다 오래된 연도를 「안정화된 과거」로 스킵한다.
- 화면에 드러나는 것은 **FY2022 뿐**이다 — 표는 '23~'25 를 보여주지만 YoY 화살표가
  **전년(2022)** 을 참조한다(`components/common/StockCells.tsx`).

**처방**: `scripts/backfill_fnguide_gap.py`(신설) — 깨진 연도를 DB 에서 직접 찾아
DART 에서 받아 채운다. 상장사는 `dart_corp_code` 가 비어 있으므로 **종목코드로** corpCode 를
해소한다(상장사는 이 매칭이 유일해서 위의 동명이인 함정이 없다).

#### 🔴 그 보강이 처음에 «별도재무제표» 를 넣었다 — 같은 날 다시 고쳤다

→ [경위](./history/gotchas-data-collection-경위.md)

- `_get_audit_rcpt` 는 「감사보고서제출」(상장사의 제출 알림 공시)과 「기타경영사항(자율공시)(감사보고서 제출 지연)」을 **후보에서 뺀다** → 사업보고서로 폴백.
- `_pick_statement_node` 는 길이가 아니라 **연결 우선**으로 본문 노드를 고른다.

🔴 **연결 우선에는 함정이 하나 더 있다** — 종속회사가 없는 회사는 「2.연결재무제표」를
**「해당사항 없음」 한 줄(len=128)** 로 남긴다. 그걸 집으면 「테이블 없음」으로 수집이 통째로
실패한다(일진하이솔루스 실측). 그래서 **내용이 있는 연결만**(`_MIN_STATEMENT_LENGTH=2,000`)
후보로 본다.

⚠️ **`consolidation` 라벨을 보고서명으로 정하면 안 된다.** 상장사 사업보고서에는 '연결' 이라는
말이 없어서, 연결 본문을 읽고도 `separate` 로 기록됐다. **실제로 고른 노드 제목**으로 판정한다.

🔴 **이 종류의 잘못은 「그럴듯해서」 급변 검사에 안 걸린다.** 그래서 재보강용 `--redo-dart`
옵션을 뒀다 — **검사만 믿으면 한 번 잘못 채운 값은 영영 안 고쳐진다.**

### 🔴 `products[].category` 는 수집기가 아니라 **트리거가 단독으로** 정한다

`normalize_product_category(raw)` 는 `product_category_map` **완전일치 룩업**이다 —
부분일치도 소문자화도 없고, 미스는 전부 `'기타'`. 게다가 트리거는 category 키가 **없으면**
곧바로 `'기타'` 를 박는다. 그런데 products 를 쓰는 스크립트 5개 중 **4개가 category 를
아예 안 넣었고**(`enrich_company.py`·`enrich_top100_meta.py`·`map_kaica_products.py`·
`enrich_with_marklines.py`), 넣는 하나(`enrich_products_customers_sonnet.py`)도 LLM 에
**목록을 주지 않아**(스키마 description 에 예시 4개, enum 아님) 자유 문자열이 나왔다.

→ [경위](./history/gotchas-data-collection-경위.md)

🔴 **「map 을 넓히면 된다」는 처방은 틀렸다**(ROADMAP 의 옛 진단). `'기타'` 1,860건의
제품명이 거의 전부 고유해서(최다가 「금형」 9건) 사전에 다 넣을 수 없다. 의미 판정이 필요하다.

**처방**: 목록의 정본은 DB 이므로 `scripts/lib/product_categories.py` 가 실행 시 읽어
enum 으로 주입한다(수집기에 목록을 박지 않는다 — UI 에 이미 사본이 3벌 있다).
기존 데이터는 `scripts/normalize_product_categories.py` 가 회사 맥락과 함께 재분류한다.

### 🔴 재분류를 LLM 에 맡길 때 **후보를 안 가르면 맞던 값까지 망가진다**

→ [경위](./history/gotchas-data-collection-경위.md)

- **이름만으로는 범위를 못 짚는다** → `fetch_category_examples()` 가 raw 키를 예시로 붙인다.
- 🔴 **예시를 붙여도 「후보에 있으면 고른다」** — 자동차 부품이 로봇 칸(제어AI칩·구조기구)으로
  새는 것은 예시로 안 막혔다. **후보에서 빼야** 막힌다(`split_domains()` · 로봇 카테고리는
  `company_pages.page='humanoid'` 인 67개사에만 제시).
- 🔴 **「맞던 값이 틀린 값으로 바뀌는 것」이 가장 비싼 실패다.** 바뀐 건수만 세면 잘 돌아가는
  것처럼 보인다 — **원래 맞던 항목이 유지되는지**를 함께 봐야 한다.

### 🔴 모델을 올리니 경계가 갈렸다 — Haiku vs Sonnet 실측 대조

→ [경위](./history/gotchas-data-collection-경위.md)

분류 재작업은 **Sonnet** 을 쓴다(사용자 판단 · 같은 프롬프트에서 Haiku 는 경계 항목을 무더기로 틀렸다).

🔴 **분류는 「싼 모델로 충분한 단순 작업」이 아니었다.** 항목 대부분은 Haiku 로도 맞지만,
틀리는 자리가 하필 **경계**여서 사람이 다시 봐야 할 것이 무더기로 남는다. 전수 검토 비용이
모델 차액보다 훨씬 비싸다.

### 🔴 경계 규칙은 사람이 정한다 (사용자 결정 2026-09-11)

Sonnet 으로도 갈리는 자리가 남았다 — 어느 쪽도 「틀렸다」고 잘라 말할 수 없어서
**건수를 세어 사용자에게 물었다**(추측으로 정하지 않았다). 정해진 기준은
`scripts/lib/product_categories.py` 의 `_BOUNDARY_RULES` 에 박혀 있고,
**수집기와 재분류가 같은 가이드를 쓰므로 앞으로 수집되는 것에도 적용된다.**

- **조명·와이퍼(76건) → `전장`**(업계 관행). `안전` 은 에어백·ADAS·시트벨트처럼
  **사고에 대응하는** 부품에만 쓴다. (Sonnet 은 이것들을 `안전` 으로 보냈다.)
- **차량용 반도체(52건) → 용도별 분산 유지.** 기본은 `전장` 이되 각도·위치 IC 는 `위치센서`,
  AI 가속기·로봇 제어기는 `제어AI칩`. 🔴 **차량용 반도체를 `기타` 로 내리지 않는다.**
- 냉각·열관리 → `공조`(단 EGR·터보차저처럼 **연소에 직접 관여**하면 `엔진`) ·
  배터리 하우징/팩/BMS → `배터리`(차량용이 아닌 IT기기용 배터리는 `기타`).

⚠️ **OEM 은 재분류 대상이 아니다** — products 에 «차종» 을 담으므로(AGENTS.md) 「3시리즈 세단」을
`차체` 로 넣으면 의미가 왜곡되고, 제품군 필터도 OEM 은 항상 통과시킨다. 17개사 99건 제외.

### 🔴 「추적 종목이면 무조건」은 대형주에서 거꾸로 터진다 (2026-09-14)

증권사 리포트 선별(`lib/naver_research.is_relevant`)이 **추적 종목이면 제목과 무관하게 통과**시켰다.
로봇 전업사(클로봇·씨메스)를 놓치지 않으려던 2026-08-25 개정의 짝이었는데, **현대차·현대모비스·
HL만도에서 정반대로 작동**했다. 셋은 로봇 밸류체인이라 추적하지만 **본업이 자동차**라, 분기 실적
리뷰가 전부 딸려 들어온다.

→ [경위](./history/gotchas-data-collection-경위.md)

**처방** — `DIVERSIFIED_TICKERS`(현대차·현대모비스·HL만도)만 제목 핵심어를 **함께** 요구한다.

- 🔴 **가르는 기준은 시가총액이 아니라 「이 회사 리포트의 대부분이 로봇 이야기인가」**다.
  두산로보틱스·로보티즈·에스피지·에스비비테크는 제목에 낱말이 없어도("업종 내 차별적 매출/수익
  성장성 보유") 로봇 리포트라 **넣지 않는다**.
- 🔴 `is_relevant(..., ticker=...)` 를 **빠뜨리면 조용히 옛 규칙**이 된다(기본값 `None`). 호출부
  셋(`collect` 2곳 · `summarize` 1곳)이 전부 ticker 를 갖고 있으니 반드시 넘긴다. 테스트
  `test_diversified_rule_is_inert_without_ticker` 가 이 성질을 박아 뒀다.
- 기존 36건은 `excluded_at` 으로 접었다(**이미 요약된 것은 0건**이라 정보 손실 없음).
  접기만 하고 규칙을 안 고치면 **다음 수집이 그대로 되살린다**(AGENTS.md 의 「화면에서만 걸러
  두면 안 된다」와 같은 함정).

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

### 🔴 판매의 `country = 'China'` 는 수출까지 포함한다 — 「판매 시장」이 아니다 (2026-09-11 실측)

바로 위 줄에 판매의 `country` 가 **판매 시장**이라고 적혀 있지만, **중국 브랜드는 그렇지 않다.**
`oem_sales_country_group_year` 의 China 합계는 **중국에서 팔린 대수가 아니라 중국 업체의 글로벌
출하(내수 + 수출)** 다. 사용자 질문(「34백만대가 내수+수출인가」)에서 출발해 세 방향으로 확인했다.

→ [경위](./history/gotchas-data-collection-경위.md)

→ **국가별 값을 단순 합산하면 중국 수출분이 두 번 세어진다**(China 칸의 글로벌 출하 + 도착 국가 행).

**처방 — 어떤 숫자를 쓸지 자리마다 다르다:**

- **중국 시장 규모**로 쓸 때는 DB 값이 아니라 **CAAM 국내 판매 27.302백만**(= 34.40 − 7.098,
  상용차 포함)을 쓴다. 승용차 소매만 필요하면 **CPCA 23.744백만**(2025)이다.
- **다른 나라와 나란히 비교하지 말 것** — 미국 16.7백만은 순수 시장 판매라 기준이 어긋난다
  (「중국이 미국의 2.1배」는 과장이고, 27.3백만 기준이면 1.63배다).
- **전 세계 합계를 만들지 말 것.** 이 표의 총합은 시장 규모가 아니다.
- 화면에는 주석을 달아 뒀다(`components/oem/CountryTop15.tsx` 캡션 · OEM×국가 매트릭스 부제).

용어: **도매**(wholesale, 공장→대리점 출하 시점에 세는 것 — CAAM 방식) vs **소매**(retail,
대리점→소비자 인도 시점 — CPCA 방식). 재고가 쌓이면 도매가 소매보다 커진다.

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

→ [경위](./history/gotchas-data-collection-경위.md)

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

→ [경위](./history/gotchas-data-collection-경위.md)

🔴 **재고일수는 브랜드 단위·미국 시장**이다(차종 아님). 같은 브랜드의 두 차종에 같은 값이 쓰인다
— 화면 문구에 반드시 남긴다. 경쟁 브랜드 매핑은 `oem_model_brand` 테이블이 정본이고
**Tesla·Rivian·Lucid·Jaguar 는 Cox 로스터에 없어 미등록**이다(그래서 리비안 경쟁군은 재고 비교 불가).

### `max_tokens` 는 사고+응답 합산 상한 — 잘리면 그 차종만 조용히 빠진다

→ [경위](./history/gotchas-data-collection-경위.md)

**원인**: `max_tokens` 는 **adaptive thinking 토큰과 응답을 함께** 덮는 상한이라, 서술이 긴 차종에서 JSON 이 중간에 잘려 `json.loads` 가 실패하고 `main` 의 `if not result: continue` 가 그 차종만 건너뛴다.

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

→ [경위](./history/gotchas-data-collection-경위.md)

증상은 두 갈래로 나타났고 **둘 다 조용했다**:

- 11개사의 볼스크류 제품이 `'기타'` 가 되어 **제품군 필터에서 통째로 빠졌다**(에러 없음)
- 시드의 "이미 그 카테고리가 있나" 검사가 영영 false 라 **재실행마다 항목이 늘었다**(멱등성 파괴)

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

## 네이버 증권사 리포트 수집 함정 (2026-08-24)

`collect_naver_research.py` · `summarize_naver_research.py` · `lib/naver_research.py` 를 만들며 실제로 겪은 것들.

### 0. 🔴 2026-09-12 — 네이버 금융이 Next.js 로 개편돼 HTML 수집이 통째로 죽었다

→ [경위](./history/gotchas-data-collection-경위.md)

**증상**: 수집기는 「목록 파싱 0건 = 구조 변경」으로 exit 3 을 냈지만, 그 경고를 아무도 안 보면 화면에선 「새 리포트가 없네」로만 보인다.

⚠️ **먼저 「안 돌았다」로 단정하지 말 것.** 스케줄(`NAVER_RESEARCH_CRON` 평일 15:00)은
멀쩡히 돌고 있었다. 로그는 **agents 레포**(`logs/bot-*.log`)에 있고 UTF-16LE 이라
그냥 grep 하면 0건이 나온다(전역 규칙 `warn-log-utf16-bash`).
게다가 메시지가 한국어(「네이버 리포트 수집 종료코드=3」)라 `naver` 로 찾으면 안 걸린다.

🔴 **종목토론은 exit 3 같은 신호가 없어 «조용히» 멈췄다**(아래 0-A 에서 exit 3 을 심었다).

⚠️ **고칠 대상을 잘못 짚기 쉬웠다.** `scripts/collect_naver_board.py` 라는 파이썬 수집기가
있었지만 **아무것도 그것을 부르지 않았다.** 실제로 도는 것은 GHA(`collect-naver-board.yml`)가
`npx tsx` 로 돌리는 **`scripts/collect_naver_board.ts` → `lib/naver/board.ts`** 다.
죽은 중복본이라 **2026-09-14 에 지웠다**(사용자 승인) — 되살리지 말 것. 종목토론 수집은
**타입스크립트 한 갈래뿐**이다.

**처방 — 모바일 JSON API 로 갈아탔다**:

```
목록  GET m.stock.naver.com/api/research/{industry|company}?page=1&pageSize=100
상세  GET m.stock.naver.com/api/research/{industry|company}/{researchId}
```

- 목록 필드 = `researchId`·`title`·`brokerName`·`writeDate`·`category`(+종목분석만 `itemCode`·`itemName`).
  **PDF 주소는 목록에 없고** 상세의 `researchContent.attachUrl` 에 있다.
- 상세 = `{"researchContent": {...}, "researchSummaries": [...]}`.
  `researchSummaries` 는 「같은 종목의 다른 리포트」라 **이 리포트의 내용이 아니다**.
- 🔴 **`r.encoding = "euc-kr"` 를 되살리지 말 것** — 옛 HTML 때의 잔재다. 세 스크립트가
  전부 그 줄을 갖고 있었고, 그대로 두면 JSON 한글이 통째로 깨진다.
- `m.stock.naver.com` 계열은 **개편에도 멀쩡했다**(뉴스 API 가 그 증거다). 그래서 골랐다.

🔴 **키워드 검색이 사라졌다.** 새 API 는 `keyword`·`query`·`q`·`searchKeyword` 어느
이름을 줘도 **무시하고 전체 최신 목록**을 준다(넷 다 실측). 그래서 전체를 받아
`is_relevant()` 로 거른다. ⚠️ **손해는 없다** — 정리본 76건으로 견줘 보니 제목 핵심어로
72건(94%)이 걸리고 나머지 4건은 전부 종목분석이라 `itemCode` 가 추적 종목이라 잡힌다(**100%**).

목록 단계에서 `is_relevant()` 로 **먼저** 거른 뒤 상세를 받는다(관련 없는 글의 상세 요청이 폭증한다). 이 1차 거름이 안전한 이유는 **새 API 의 목록 제목이 안 잘리기 때문**이다(옛 HTML 목록은 `...` 로 잘렸다 ↓ 2번 절).

#### 0-A. 종목토론 — 도메인까지 옮겨졌다 (`stock.naver.com`, 2026-09-14 수리)

리서치와 달리 **호스트 자체가 바뀌었다.** 옛 URL 로 가면 브라우저가
`stock.naver.com/domestic/stock/<코드>/discussion` 으로 리다이렉트된다.

→ [경위](./history/gotchas-data-collection-경위.md)

```
목록  GET stock.naver.com/api/community/discussion/posts/by-item
        ?discussionType=domesticStock&itemCode=<코드>&pageSize=100[&offset=<커서>]
반응  GET stock.naver.com/api/community/discussion/posts/reactions?postIds=<쉼표 구분>
```

🔴 **목록의 `viewCount`·`recommendCount`·`notRecommendCount` 는 전부 0 이다.** 진짜 값은
`reactions` 에만 있다. 목록 필드를 그대로 믿고 적재하면 **조회수·공감이 통째로 0** 이 되는데,
행 수는 정상이라 건수 점검으로는 안 걸린다. 화면 자신도 30개씩 묶어 따로 부른다.

🔴 **네이버 자동 글(`postType`이 `itemNews*`)이 섞여 온다** — 「5% 이상 하락했어요 😞」.
최근 100건에 15~30% 다. 투자자 심리가 아니라 주가를 기계적으로 따라가는 글이라
**수집 단계에서 거른다**(사용자 결정 2026-09-14 · `postType === 'normal'` 만 통과).
**`excludesItemNews=true` 를 줘도 안 걸러지므로**(실측 차이 0건) 직접 걸러야 한다.

⚠️ **옛 HTML 게시판은 이 글을 함께 실었다 — DB 에 109건 남아 있다**(2026-03~09).
지우지 않았으므로 **그 구간만 수집 범위가 다르다.** 감성 추이를 길게 견줄 때 감안할 것.

- `writtenAt` 은 `2026-09-11T15:18:37` 처럼 **표준시가 안 붙어** 온다. KST 다 —
  `+09:00` 을 붙여 읽지 않으면 GHA(UTC)에서 9시간 밀린다.
- 페이지네이션은 쪽 번호가 아니라 **커서**다(`offset` = 직전 응답의 `lastOffset`).
  `pageSize` 상한은 **100**(200 은 400 Bad Request).
- 본문이 `contentSwReplacedButImg` 로 **목록에 함께 온다**(옛 구조는 글당 1회 더 받아야 해서
  기본으로 껐었다). 지금은 공짜지만 감성 분석이 제목만 써서 적재는 계속 끄고 있다.
- 로그인·쿠키 불필요. `User-Agent` 와 `Referer: https://stock.naver.com/` 만 있으면 된다.

🔴 **같은 침묵이 반복되지 않게 `collect_naver_board.ts` 에 exit 3 을 심었다** — 종목이 하나라도
실패하거나 **네 종목 모두 `rawCount === 0`** 이면 실패로 끝낸다. `rawCount`(cutoff 로 자르기
전 건수)가 있어야 「글이 없다」와 「API 가 빈 배열을 준다」를 가를 수 있다. 회귀는
`lib/naver/board.test.ts`(16건) — 구조가 또 바뀌면 `parseListPayload` 가 **0건이 아니라 예외**를
낸다는 것까지 못 박아 뒀다.

### 1. 🔴 상세 페이지 제목이 분류명으로 덮여 407건이 통째로 오염됐다

리포트 상세(`*_read.naver`)의 `.view_sbj` 한 덩어리에 **분류/종목명 + 제목 + 증권사 | 날짜 | 조회수**가
모두 들어 있다.

```html
<th class="view_sbj">
  <em>기타</em> 안녕하세요 위클리에요(로봇/방산) 유진투자증권 | 2026.08.24 | 조회 871
</th>
```

`get_text("\n").split("\n")[0]` 으로 첫 줄을 집으면 `<em>` 안의 **분류명("기타"·"조선"·"자동차")** 이 나온다.
그것으로 목록의 진짜 제목을 덮어써서 407건 전부가 분류명이 됐다.

→ [경위](./history/gotchas-data-collection-경위.md)

**처방** — `parse_detail_page(html, broker, target_name)`:

1. `<em>` 을 `decompose()` 로 들어낸다
2. 꼬리 `| YYYY.MM.DD | 조회 N` 을 정규식으로 자른다
3. 남은 꼬리의 증권사명을 자른다(목록에서 받은 `broker` 로, 없으면 `…증권` 폴백)
4. 안전망 — 상세 제목이 `target_name` 과 같으면 **목록 제목을 지킨다**

### 2. 🔴 「제목 핵심어」로 거르면 산업분석이 0건이 된다 — 네이버 검색은 본문 기준이다

> ⚠️ **이 절은 2026-09-12 개편으로 전제가 사라졌다**(↑ 0번 절). 이제 검색 자체가 없어서
> 전체를 받아 제목·`itemCode` 로 거르고, 그 방식으로 정리본 76건을 **100% 재현**한다.
> 아래는 옛 HTML 시절의 기록이다 — 되돌리려 할 때 왜 그랬는지 알기 위해 남긴다.

→ [경위](./history/gotchas-data-collection-경위.md)

### 3. 목록 `<td>` 는 6칸이다 (5칸 파서는 조용히 0건)

`[분류/종목, 제목, 증권사, PDF첨부, 날짜(YY.MM.DD), 조회수]`. 종목분석은 첫 칸 링크에
`?code=108490` 이 있어 그게 `ticker` 다(산업분석은 분류명뿐이라 링크가 없다).

목록 표는 `table.type_1` 이고, 같은 페이지의 **인기검색어 표(`type_r1`)** 가 섞이지 않게
문서 전체가 아니라 그 표 안만 훑는다.

### 4. `keyword` 는 EUC-KR 퍼센트 인코딩이어야 한다

UTF-8 로 보내면 **200 OK 인데 결과가 0건**이다. 에러가 아니라 "검색 결과 없음"으로 보여서
틀린 줄 모른다. `로봇` → `%B7%CE%BA%BF`.

### 5. 이미 아는 행을 다시 쓰면 데이터가 뒤로 간다

목록 제목은 잘려 오고 상세 제목은 온전하다. 증분 수집이 알려진 `nid` 를 다시 upsert 하면
**온전한 제목이 잘린 제목으로 퇴화**한다. 그래서 알려진 `(kind, nid)` 는 건너뛴다.

### 6. 종료 코드로 "새 글 0건"과 "구조가 바뀌었다"를 가른다

증분 수집은 대개 0건이라 그것을 실패로 쓰면 매일 빨간불이 뜬다. 반대로 네이버가 페이지 구조를
바꾸면 파서가 **에러 없이 0건**을 낸다. 그래서:

| 코드 | 뜻                                                                                         |
| ---- | ------------------------------------------------------------------------------------------ |
| 0    | 정상(신규 0건 포함)                                                                        |
| 1    | full 모드인데 한 건도 못 모았다                                                            |
| 2    | upsert 실패                                                                                |
| 3    | **목록 파싱이 전부 0건 = 구조 변경** → 오케스트레이터가 요약 단계를 건너뛰고 알림을 보낸다 |

3일 때 요약을 돌리면 "대상 0건"이라는 정상 신호가 나와 진짜 고장을 덮는다.

### 7. 만회(catch-up)를 원장 표 없이 한다

계획서는 `job_runs` 원장을 쓰라고 적었지만 **stock_monitor 에 그런 표가 없다**(agents 쪽 개념이다).
사용자 결정(2026-08-24)은 **표를 새로 만들지 않고 데이터로 판단**하는 것 — 저장된 리포트의
가장 최근 발행일에서 `CATCHUP_MARGIN_DAYS`(7일)를 뺀 날부터 다시 훑는다. PC 가 며칠 꺼져 있어도
그 사이 글을 가져오고, 늦게 등록된 글도 여유 기간이 흡수한다.

### 8. 🔴 헤드리스 요약 턴 한도 8은 큰 리포트에서 모자란다

→ [경위](./history/gotchas-data-collection-경위.md)

→ `REPORT_SUMMARY_MAX_TURNS` 기본값을 **20**으로 올렸다(agents `summarizeReportCmd.ts`).
🔴 **본문을 잘라 맞추지 않는다** — 저본을 앞부분만 읽히면 뒤쪽이 통째로 빠진 채 "요약했다"고
나온다(지정학 서적 정리에서 겪은 것과 같은 실패 모드).

판정은 **종료 코드가 아니라 파일이 생겼는지**로 한다. 헤드리스는 실패해도 0을 낼 수 있다.

### 9. PDF 가 없는 리포트는 요약할 원문 자체가 없다 (코드 문제가 아니다)

→ [경위](./history/gotchas-data-collection-경위.md)

즉 「본문을 얻지 못함」은 대개 **진짜로 없는 것**이다. 파서를 고쳐도 나오지 않는다.
다만 그 페이지에도 **목표가·투자의견은 있다**(아래 10번).

### 10. 「목표주가」가 아니라 「목표가」다

상세 페이지 요약 줄은 `목표가 790,000 | 투자의견 매수` 형태다. `목표주가` 로만 찾으면
놓친다 — 실측에서 종목분석 194건 중 목표주가가 채워진 것이 **65건(33.5%)** 뿐이었던 원인.

→ `목표(?:주)?가` 로 고쳤다. ⚠️ **이미 적재된 행은 갱신되지 않는다**(수집기는 알려진 `nid` 를
건너뛴다) — 기존분 보강은 별건이다.

→ [경위](./history/gotchas-data-collection-경위.md)

🔴 **빈 값이 전부 결함은 아니다** — 대상 107건 중 **70건은 상세 페이지에도 목표가가 없었다**
(탐방노트·커버리지 개시·산업분석). 그래서 "회수 못 함"을 실패로 세면 종료 코드가 거짓말을 한다
→ 스크립트가 `fixed` 와 `intact`(원래 없음)를 갈라 세고, 빈 값을 빈 값으로 다시 쓰지 않는다.

⚠️ **`.lt()` 는 NULL 을 집지 않는다**(SQL 3값 논리). 빈 행까지 보려면
`.or_("target_price.lt.1000,target_price.is.null")` 처럼 명시해야 한다 — 그냥 부등호만 쓰면
**대상이 조용히 빠진다.**

⚠️ 로컬 실행은 `revalidate 404` 가 난다(위 「로컬 실행은 …」 항목과 같은 원인) → 프로덕션 반영은 `NEXT_REVALIDATE_PROD_URL` 에 `{"tags":["research_reports"]}` 로 직접 POST.

## 증권사 리포트 수집 함정 (2026-08-25)

### 1. 「35.6만원」이 `35` 로 저장됐다 — 목표주가 단위

옛 정규식이 `목표(?:주)?가\s*[:\s]*([0-9,]+)` 라 **소수점 앞에서 끊기고 「만원」을 버렸다.**

→ [경위](./history/gotchas-data-collection-경위.md)

- 처방: `lib/naver_research.parse_target_price()` 경유. 소수점 + 만/억 단위를 함께 읽는다.
- 기존 행 복구: `scripts/recheck_research_target_price.py`(상세 페이지 재파싱 — DB 값만으로는
  `35` 가 35원인지 35만원인지 복원할 근거가 없다). 16/16 복원 확인.
- 🔴 **정규식을 다시 짜지 말 것.** 단위를 안 보는 순간 조용히 1/10000 이 된다.

### 2. 요약 앞머리에 `RULES-OK:` 가 섞였다

agents 레포의 헤드리스 Claude CLI 가 훅 게이트를 통과하려고 출력한 탈출 문구가 결과 파일
첫 줄에 남아 그대로 DB 에 들어갔다(실측 5건). 화면에서는 요약이 엉뚱한 문장으로 시작한다.

- 처방: `summarize_naver_research.clean_summary()` 가 저장 직전에 걷어낸다.
  규칙 정본은 agents 쪽이지만 **받는 쪽에서 한 번 더 막는다.**

### 3. 선별을 화면에서만 하면 되살아난다

2026-08-25 에 비관련 251건을 지웠는데, 수집기가 그대로면 **다음 실행에 전부 다시 들어온다.**
`collect_naver_research.py` 가 `is_relevant()` 로 **저장 여부**를 가르도록 고친 이유다.

- 판정이 두 번 뒤집혔다 → 경위는 `is_relevant()` docstring 이 정본.
  ① 종목분석 「추적 67사만」 → 클로봇·씨메스·큐렉소 등 로봇사를 놓쳐 **제목 핵심어 OR** 추가
  ② 종목분석 정기물 예외 → 사용자 지시로 **정기물은 종목·산업 불문 제외**
- 「피지컬 AI」는 로봇이라는 말 없이 쓰이는 대표 용어다. 핵심어에서 빼면 9건이 갈린다.
- 정기물은 **목록 제목만으로 배제**해 상세 요청 자체를 아낀다(407건 중 121건).

### 4. 요약은 GitHub Actions 에서 못 돈다

`summarize_naver_research.py` 는 agents 레포의 **구독 인증 헤드리스 CLI** 를 부른다.
러너에 로그인 세션이 없어 실패한다 — `collect-naver-research.yml` 에 요약 단계를 넣지 말 것.
요약은 로컬에서 `--limit` 로 나눠 돌린다(세션 한도 공유).

### 5. 증권사가 PDF 를 안 올리면 「정리 안 된 카드」가 남는다

**신한투자증권은 네이버에 PDF 를 올리지 않는다.** 첨부 자리에 자사 사이트 팝업 링크
(`shinhansec.com/siw/insights/research/list/view-popup.do`)만 있고, **그 주소에는 리포트
식별자가 없어** 어느 보고서인지 특정할 수 없다 → 원문을 받아올 방법이 없다.
네이버 상세 페이지가 주는 것은 `.view_cnt` 안의 **131자 요지 한 줄**뿐이라 요약이
성립하지 않는다. 2026-08-25 실측: 16건 중 12건이 이 상태였다.

- 🔴 **「PDF 없으면 버린다」로 자르면 틀린다** — 같은 증권사의 산업분석 3건은 상세 본문이
  충실해 864~1,177자로 제대로 정리됐다. 기준은 PDF 유무가 아니라 **요약할 재료가 있느냐**다.
- 처방: `lib/naver_research.body_text_length()` 로 `.view_cnt` 본문 길이를 재고,
  `MIN_BODY_TEXT`(300자) 미만이면 **수집 단계에서 저장하지 않는다.**

→ [경위](./history/gotchas-data-collection-경위.md)

- 🔴 **수집과 요약이 같은 상수를 봐야 한다.** `summarize_naver_research.MIN_PDF_TEXT` 는
  `MIN_BODY_TEXT` 를 그대로 받는다. 두 값이 갈리면 수집이 저장한 것을 요약이 못 다뤄
  화면에 "정리 안 된 카드"가 다시 생긴다.
- 네비게이션·목록 텍스트를 세면 안 된다(재료 없는 글이 통과한다) → `.view_cnt` 안만 본다.

## 증권사 리포트 PDF 그림 추출 함정 (2026-08-25)

정본 = `scripts/lib/pdf_figures.py` · 순수 함수 시험 = `scripts/lib/test_pdf_figures.py`(36건).

→ [경위](./history/gotchas-data-collection-경위.md)

- 🔴 **`page.get_images()` 로는 거의 0건이다.** 증권사 리포트의 차트는 래스터 이미지가 아니라
  **벡터 도형**(선·사각형)으로 그려져 있다. `page.get_drawings()` 의 bbox 를 모아 **뭉쳐야**
  한 장의 그림이 된다. 이걸 모르면 "이 PDF엔 이미지가 없다"는 잘못된 결론에 이른다.
- 🔴 **뭉치기 전에 전폭 구분선·배경 사각형을 버려야 한다.** 머리글 밑줄 하나가 페이지
  위아래 도형을 전부 이어 붙여 「그림 = 페이지 전체」가 된다. 실패가 조용해서 더 위험하다.
- 🔴 **도형 좌표는 페이지 밖으로 나간다.** 실측에서 폭 **1,134pt**(A4 는 595pt)짜리 그림이
  나왔다. 자르지 않으면 오른쪽 절반이 빈 여백인 PNG 가 된다 → `clip_to_page()`.
- 🔴 **축·파이 라벨은 도형이 아니라 글자라 잘려 나간다.** 도형 bbox 만 쓰면 파이 조각의
  "대한민국 17.9%" 가 사라진다. **영역에 이미 걸친** 글자 덩어리만 품고 한 변당 26pt 까지만
  넓힌다(`expand_to_text_blocks`) — 아무 글자나 품으면 본문 문단까지 삼켜 페이지가 된다.
- **표지·사이드바가 그림으로 잡힌다.** 면적 상한만으로는 안 걸린다(표지 0.70) →
  **높이 비율 상한**(0.72)을 함께 둔다. 세로 사이드바는 0.93 으로 걸린다.
- **캡션은 위쪽 상자를 통째로 이어 붙이면 안 된다.** 앞 그림의 「자료: …」가 캡션 앞에
  붙는다. 그림에 **가까운 줄부터** 보고 출처 줄은 뒤로 미룬다(`pick_caption_line`).
- 🔴 **표준 재무제표 부록·컴플라이언스 페이지는 통째로 건너뛴다**(사용자 지시 2026-08-25 —
  "재무실적 중 중요한 것은 기업 페이지에 나오니까"). 판정은 `is_skippable_page()`:
  재무제표 표제어는 **2개 이상** 나와야 부록으로 본다(본문에서 "현금흐름표" 한 번 언급했다고
  그 페이지 차트를 버리면 손해), 컴플라이언스 표현은 **1개**로 충분하다(본문에 안 쓰인다).
- **Storage 버킷이 받는 MIME 은 `image/png`·`application/pdf` 뿐**이라 처음부터 PNG 로
  렌더한다(report.md §5). jpg 로 올리면 거부된다.
- **PDF 는 한 번만 받는다.** 텍스트와 그림을 같은 바이트에서 뽑는다 — 따로 받으면
  144편이면 다운로드가 두 배가 된다.

### 전량 재요약을 돌릴 때

- 🔴 **재개 표식이 없으면 끝나지 않는다.** 144편 × 3~4분이라 여러 시간이 걸리고 중간에
  끊긴다. `--force` 는 **이미 새 규격인 것을 건너뛴다** — 판정은 정리본이
  「> 한 줄 핵심 요약」 인용 블록으로 시작하는지(`is_current_format`). 옛 규격은
  `## 투자포인트` 로 시작했다. 정말 전부 다시 만들 때만 `--redo-all`.
- **오래된 것부터 처리하는 순서는 `--force` 에서도 지킨다** — 델타의 「직전 요약」이
  이미 새 규격이라야 비교가 성립한다.

### 무엇을 먼저 정리할지 고를 때 (2026-08-25)

정본 = `scripts/lib/research_priority.py` · 시험 = `test_research_priority.py`(19건).

- 🔴 **점수만으로 자르면 안 된다.** 상위 35편은 품질은 최고지만 **대상 49개 중 10개만**
  덮는다(현대차·현대모비스·HL만도·산업분석에 쏠린다). 나머지 39개 종목은 요약이 하나도
  없는 빈 페이지가 된다. 그래서 「점수 높은 산업 조망」에 **「대상별 최소 1편」을 더한다.**
- **가장 강한 변별 신호는 제목이 분기 실적 리뷰인가**다. 실측 제목으로 확인:
  「1Q26 Preview: Rough Start」·「딱 예상한대로」·「Trade-off 국면」에는 로봇 이야기가
  거의 없고, 「로봇 하드웨어 티어 1 공급자의 길」·「휴머노이드: Ph.2 진입」에는 있다.
  단 **「2Q26 리뷰: 로봇 액추에이터 수주 기대」처럼 둘 다인 제목**이 있으므로 로봇 주제면
  감점하지 않는다.
- 🔴 **선별은 「이미 끝난 것 걸러내기」보다 먼저** 한다. 순서를 뒤집으면 대상별 그 1편이
  이미 완료됐을 때 같은 대상의 다른 편이 새로 뽑혀 대상당 여러 편이 쌓인다.
- **`today` 를 인자로 받는다** — 「최근 3개월」 판정이 실행 시각에 매이면 시험이 어느 날
  갑자기 깨진다.
- **`--list-only` 는 파일로 쓴다.** Windows 콘솔이 CP949 라 한글 로그가 깨져 보인다
  (파일은 멀쩡하다 — 여기서 오진하지 말 것).

### 화면에서 옛 규격을 숨길 때

- 🔴 **표식이 두 곳에 있다.** 파이썬 `is_current_format` 과 TypeScript `CURATED_PREFIX`
  가 같은 「본문이 `>` 로 시작하는가」를 본다. 한쪽만 바꾸면 **스크립트가 「정리됨」이라
  여긴 것이 화면에서 사라진다.**
- 목록에서 숨기면 **새로 수집된(아직 요약 전) 리포트도 안 보인다.** 수집이 도는지 확인은
  화면이 아니라 DB 로 한다: `select count(*) from research_reports`.

## 본문 글자가 이미지로 심긴 증권사 PDF (2026-08-25)

→ [경위](./history/gotchas-data-collection-경위.md)

**원인.** 이 증권사 PDF 는 본문 글자를 **글리프 이미지로** 심는다. 실측(LG씨엔에스 5쪽):

읽을 글이 없으니 헤드리스가 3,000~6,000자 정리본을 못 쓰고 파일을 안 만든 채 끝난다.

🔴 **더 고약한 것은 기존 폴백이 안 걸렸다는 점이다.** 「PDF 텍스트가 짧으면 네이버 상세
페이지로 폴백」하는 장치가 이미 있었는데 판정이 **총 길이 300자**였다. 5쪽짜리가 576자면
쪽당 115자인데도 "300자 이상"이라 정상으로 통과했다. **총 길이로 재면 쪽수가 많을수록
오판이 커진다.**

**처방.** 판정을 밀도로 바꾸고, 시각 인식 우회로를 붙였다.

- `pdf_figures.is_image_body(글자수, 쪽수)` — 쪽당 `MIN_CHARS_PER_PAGE`(400자) 미만이면 이미지 본문
- `pdf_figures.render_pages()` — 페이지를 통째로 2배 확대해 PNG 렌더
- `summarize_naver_research.save_page_images()` — 렌더 결과를 `_tmp` 에 저장하고, 재료 파일에
  「이 그림들을 Read 로 열어 눈으로 읽으라」는 절을 넣는다

⚠️ **렌더한 페이지는 업로드하지 않는다.** 화면에 싣는 그림은 `collect_figures` 가 따로 잘라
올린 것이고, 페이지 렌더는 헤드리스가 읽기만 하는 임시 산출물이다. 둘을 섞으면 페이지
통짜 이미지가 보고서 본문에 박힌다(사용자가 명시적으로 기각한 방식).

## 선별을 플래그로 두면 스케줄에서 안 걸린다 (2026-08-25)

→ [경위](./history/gotchas-data-collection-경위.md)

**원인 둘.**

1. 정기 스케줄(agents 오케스트레이터 `naverResearchJob.ts`)은 요약기를 **인자 없이** 부른다.
   `--priority` 가 안 붙으니 선별이 통째로 안 돌고 「요약이 비어 있는 것 전부」가 대상이 된다.
   🔴 **선별처럼 「기본이어야 하는 정책」을 옵트인 플래그로 만들면, 부르는 쪽이 다른 레포에
   있을 때 조용히 꺼진 채로 돈다.** 정책은 기본값에 두고 해제를 플래그(`--all`)로 준다.
2. 옛 규격 요약을 지운 순간, 그 75편이 「summary 가 비어 있는 것」이 되어 **다시 대상이 됐다.**
   지우는 행위가 되살리는 행위였다. → `excluded_at` 컬럼으로 사람의 제외 판단을 데이터에 남긴다.

**앞으로의 기준(사용자 선택 2026-08-25 「점수 기준만 적용」).** `select_ongoing` — 점수 문턱
`ONGOING_MIN_SCORE`(5점)만 본다. 「대상별 최소 1편」은 초기 채우기 전용이라 평소에는 쓰지
않는다(그대로 두면 점수와 무관하게 대상마다 1편씩 통과해 실적 리뷰가 계속 섞인다).

🔴 **점수 규칙의 구멍 하나도 여기서 드러났다** — 「감속기」·「모션제어」 같은 **부품 이름**이
로봇 주제 낱말에 없어서, 하이젠알앤엠(「산업용 모터 및 감속기 제조 전문기업」)·에스비비테크
(「SSS급 정밀 감속기 제조사」) 같은 로봇 부품 순수기업이 문턱 아래로 떨어졌다. 제목에
「로봇」이 안 들어가는 로봇 회사가 있다.

---

## 좁은 창(窓)으로 도는 수집기가 대장을 통째로 다시 쓰면 과거가 사라진다 (2026-09-01)

→ [경위](./history/gotchas-data-collection-경위.md)

**원인.** `scan_all.py` 가 대장을 `open(LEDGER, "w")` 로 **통째로 다시 쓴다.** 그런데
주간 cron(agents `maEvalJob.ts`)은 `--years 1` 로 부른다 — **창 밖의 과거 행이 매주 지워진다.**
행마다 있던 분석 필드(`method_dcf`·`values_mn`·`deal_price_mn`)까지 함께 날아갔다.

🔴 **「증분 수집기」와 「전량 산출물」을 한 파일에서 만나게 하면 반드시 이 사고가 난다.**
스캔 범위(창)와 산출물 범위(대장)는 **다른 것**인데, 같은 변수(`rows`)로 이어져 있었다.

**처방(적용 완료).** `merge_rows()` 로 **접수번호(rcp) 병합**한다 — 이번 스캔이 같은 rcp 를
이기고, 창 밖 과거 행은 남는다. `years` 는 `max(기존, 이번 창)` 로 두어 되돌아가지 않는다.
🔴 **`mark_latest()` 는 병합한 뒤에 부른다** — 병합 전에 부르면 창 안에서만 최신이 되어,
창 밖에 정정본이 있는 딜의 `is_latest` 가 뒤집힌다.
회귀 = `scripts/dart_eval/test_scan_all_merge.py`(5건).

⚠️ **같은 형태를 다른 수집기에서도 찾을 것** — 판정 기준은 「쓰기 모드가 `"w"` 인가」가 아니라
**「부르는 쪽의 창이 산출물의 범위보다 좁은가」**다.

## 형제 함수가 이미 옳게 고쳐져 있는데 따라가지 않는다 (2026-09-08)

→ [경위](./history/gotchas-data-collection-경위.md)

같은 일을 하는 형제 함수가 **바로 옆에 옳게 구현돼 있는데** 따르지 않은 결함이다(`.range()` 정렬 누락 · 단위 환산 누락 · 진행 중 연도 YoY).

🔴 **주석으로 경고를 남겨 두는 것으로는 재발을 못 막는다** — 경고 주석이 달린 함수 바로 위 함수가 그대로 어기고 있었고, AGENTS.md 규칙이 있는데도 11곳이 어겼다.

**처방.**

- 같은 일을 하는 함수가 여럿이면 **하나를 고칠 때 형제를 전부 grep 한다.** 판정 기준은
  「이 파일을 고쳤나」가 아니라 **「같은 패턴이 몇 군데인가」**다.
- `.range()` 를 쓰면 **정렬 키가 유일한지**까지 본다. `lib/pnl/source.ts` 는 `.order()` 가
  **있었는데도** (basis, 연, 월)만 잡아 5차원으로 갈린 행의 동률이 페이지 경계에서 흔들렸다 —
  **「정렬이 있다」가 아니라 「정렬이 유일하다」가 조건이다.**
- 단위가 다른 컬럼을 옮겨 담을 때는 **타입 주석을 믿지 말고** 환산을 순수 함수로 뽑아
  테스트를 붙인다(`toRevenueRows`). 이번 100배는 `RevenueMonthRow.revenueEok` 의 주석이
  이미 「억원」이라 적혀 있었는데 값만 백만원이었다.

## 세션을 통과했다고 권한이 있는 것이 아니다 — API 역할 게이트 (2026-09-08)

**증상.** `POST /api/companies`(회사 마스터 INSERT + GHA workflow_dispatch)·`POST /api/posts`
(maxDuration=300 짜리 LLM 작업)·`POST /api/uploads/report`(100MB 업로드)가 **guest 를 포함한
전 역할에 열려 있었다.**

**원인.** `lib/auth/permissions.ts` 의 `canAccess` 가 페이지 경로만 판정하고 **`/api/*` 는
마지막 `return true` 로 흘려보낸다.** `proxy.ts` 는 세션(로그인 여부)만 확인하므로,
**로그인한 guest 가 그대로 통과**한다. 유일한 예외였던 `/api/management/org-chart` 의 주석이
이것을 자백하고 있었다 — _"canAccess의 /management 분기는 '/api/...' 접두사를 매칭하지
못하므로 명시적으로 처리"_. 한 라우트만 손으로 메웠고 나머지는 그대로였다.

**처방(적용 완료).** 게이트를 **route handler 안에서 직접** 부른다:

```typescript
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !canPublishReports(user.role)) {
    return NextResponse.json(fail('FORBIDDEN', '게시 권한이 없습니다.'), { status: 403 });
  }
  // ...body 파싱은 그 다음
```

🔴 **`proxy.ts`/`canAccess` 에 넣지 말 것** — 그쪽 실패 경로는 `NextResponse.redirect` 라
`fetch` 가 302 를 따라가 **HTML 을 받고** `res.json()` 이 엉뚱한 파싱 오류를 낸다. API 는 403 JSON 이다.
🔴 **게이트는 핸들러 첫 줄**에 온다 — body 파싱·Zod 검증보다 앞이어야 권한 없는 요청에 비용을 안 쓴다.
🔴 **화면도 같이 막을 것.** API 만 막으면 비권한자에게 버튼이 보이고 눌러야 403 이 뜬다
(`/reports/new` 페이지 진입 + `/reports` 의 「+ 글쓰기」 버튼을 함께 게이트했다).

**판정 기준.** 「이 라우트가 세션을 요구하나」가 아니라 **「역할을 구분하나」**다. 세션 검사는
`proxy.ts` 가 이미 한다 — 그것만으로 끝났다고 보면 이 사고가 반복된다. 게시 권한 판정은
`canPublishReports`(admin·holdings·mobility), 관리자 전용은 `isAdmin` 이다.

## NHTSA 리콜 조회 실패가 「리콜 0건」이 된다 · 캐시 태그 매핑 누락 (2026-09-08)

**증상 1.** `scripts/lib/nhtsa_client.py` 의 `_get()` 은 실패에 `None`, 진짜 0건에 `[]` 를 준다.
그런데 리콜 루프는 `if recalls:` 하나로 둘을 똑같이 흘려보냈다. 네트워크가 통째로 죽어도
결과는 `recalls: {'count': 0}` — 화면에는 **「리콜 없는 안전한 차」**로 나온다. 바로 아래 불만
루프는 같은 문제를 `any_ok` 로 이미 막고 있었다(형제 코드가 옳게 돼 있는데 따라가지 않은 것).

**처방.** `_fetch` 의 리콜 루프에도 `recall_ok` 를 달아 한 건도 성공 못 하면 `recalls=None`
(=알 수 없음)을 준다. **소비하는 쪽도 함께 고쳐야** 이 수정이 무의미해지지 않는다 —
`scripts/lib/outlook_prompt.py`(AI 프롬프트 렌더)와 `scripts/collect_oem_model_outlook.py`
(경쟁 차종 summary)가 `safety['recalls']['count']` 를 non-null 로 가정하고 있어서 `None` 을
`.get()`/`['count']` 하면 죽는다 — `if rec else '조회 실패(알 수 없음)'` 로 감쌀 것.

**증상 2.** 캐시 태그 매핑이 3곳(TS `cacheTag()` 전수 · `app/api/revalidate/route.ts` 의
`ALL_TAGS` · `scripts/lib/revalidate.py` 의 `COLUMN_TO_TAGS`)에 흩어져 있어 한쪽만 추가하면
구멍이 생긴다. 실측: `hyundai_retail_sales` 가 `COLUMN_TO_TAGS` 에 키 자체가 없었고,
`humanoid_stocks_view` 가 읽는 원천 테이블(`companies`·`financials`·`exchange_rates_live`·
`company_pages`)의 매핑에 그 태그가 없어 회사·재무를 수집해도 `/humanoid` 가 낡은 채로 남았다.

→ [경위](./history/gotchas-data-collection-경위.md)

**처방.** `scripts/verify_revalidate_tags.py` — (1)⊄(2) 면 「tag=all 로 안 풀리는 태그」,
(3)⊄(2) 면 「존재하지 않는 태그를 수집기가 부른다」로 실패(exit 1). **exit 0(통과)이 정상 상태다** —
위반이 나오면 그것이 회귀다.

## 그럴듯한 숫자가 가장 오래 산다 — DART 재무 파싱 함정 4종 (2026-09-11)

→ [경위](./history/gotchas-data-collection-경위.md)

넷 다 **그럴듯한 값**이라 화면·lint·타입·테스트 어디에도 안 걸린다. **기계 검사기 = `scripts/verify_financials_sanity.py`(exit 0 이 정상).**

### 1. 「정정 공시」는 정정한 첨부 하나만 담고 있다 — 연결이 통째로 사라진다

→ [경위](./history/gotchas-data-collection-경위.md)

**원인**: `_score_report` 는 `[첨부정정]` 본과 원본에 같은 점수를 주고 동점이면 늦은 정정본이 이기는데, 정정본의 문서 트리에는 **정정한 첨부(별도 재무제표) 하나뿐**이고 `2.연결재무제표` 는 원본에만 있다.

**처방**: `_get_audit_candidates()` 가 후보를 **목록으로** 돌려주고, `_read_year()` 가
연결을 못 찾으면 다음 후보를 연다. ⚠️ **정정본이 아닌데 연결이 없으면 거기서 멈춘다** —
종속회사가 없어 정말 별도만 내는 회사까지 훑으면 HTTP 만 3배가 되고 결과는 같다.

### 2. 단위는 «선언» 으로 정한다 — 표 안에 스쳐 든 '천원' 에 넘어가지 말 것

→ [경위](./history/gotchas-data-collection-경위.md)

**처방**: `_UNIT_DECL_RE` 로 «단위 선언» 만 찾고, **표 머리(첫 두 행) → 표 위 sibling →
표 본문** 순서로 본다. 선언이 아무 데도 없을 때만 옛 방식(맨 키워드)으로 폴백한다.
🔴 정규식 교대에서 **'백만원' 을 '원' 보다 먼저** 둘 것 — '백만원' 안에 '원' 이 있다.

### 3. 계정명 뒤 「작은 정수」는 주석 번호다

→ [경위](./history/gotchas-data-collection-경위.md)

**원인**: `_filter_annotation_nums` 의 문턱이 «최댓값의 1/10,000» 인데 34 vs 151,726 은
4,462배라 통과한다. 홀수 개라서 `nums[0], nums[1]` 이 당기·전기가 됐다.

**처방**: `_strip_leading_note_no()` — ①개수가 홀수 ②맨 앞이 1,000 미만 **정수**
③나머지가 1,000배 이상. **셋을 다 만족할 때만** 뗀다(정상 값을 지우지 않으려고).

### 4. 🔴 「DART 와 DB 가 다르다」는 「DB 가 틀렸다」가 아니다 — 전기는 재작성된다

→ [경위](./history/gotchas-data-collection-경위.md)

다음 해 보고서가 전기를 **재작성**할 수 있다(종속회사가 빠져 계속영업 기준으로). 원보고서 값으로 덮으면 연도 사이에 **새 낙차**가 생긴다 — 대조 결과로 DB 를 덮기 전에 이것부터 의심한다.

**처방**: 고칠 해 N 을 받을 때 **N+1 보고서도 함께** 받는다. `_dedup_rows` 가 더 최신
보고서를 우선하므로 재작성된 전기가 이긴다(`backfill_fnguide_gap.py` 의 `request_years`).
로그에 `[정정 감지]` 가 뜨면 그것이 재작성이다.

### 곁가지 — 반환형을 바꿨으면 «부르는 쪽» 을 전수로 찾을 것

→ [경위](./history/gotchas-data-collection-경위.md)

🔴 **`except` 로 감싼 경로의 회귀는 «실패» 가 아니라 «침묵» 으로 나타난다.**

**처방 (같은 날 신설)**: `scripts/verify_call_contracts.py`(exit 0 이 정상)가 정적으로 잡는다 —
①호출 시그니처 불일치 ②**언제나 N-튜플을 돌려주는 함수를 단일 이름으로 받고, 그 이름을
한 번도 첨자·언팩·순회하지 않는** 경우. ②의 조건이 관건이다. 쌍을 «쌍으로» 쓰는 정상
코드(정렬 키·딕셔너리 키·사각형)가 24건 있어 단순히 「단일 대입」만 보면 **오탐이 24건**
이었다. 실제 통과 후 남은 정상 사례 3건만 근거와 함께 `ALLOWED_SCALAR_TUPLE` 에 적었다.

⚠️ 만들 때 **모듈을 파일 이름(stem)으로 식별했다가 오탐 2건**이 났다(`yt_report/finalize.py`
와 임시 사본 `_yt_report/finalize.py` 충돌). 상대 경로로 식별하고 `_` 로 시작하는 폴더는 뺀다.

## 🔴 「공시 0건인 corp_code」는 매핑이 틀렸다는 신호다 (2026-09-11)

→ [경위](./history/gotchas-data-collection-경위.md)

**신호로 쓸 것**: `dart_corp_code` 가 있는데 **그 법인의 공시가 0건**이면 매핑을 의심한다.
DART 호출이 회사당 한 번이라 상시 검사로는 비싸고, **가끔 돌리는 감사**로 적합하다.
⚠️ `corp_name` 이 「신원」인 법인이 DART 에 **6개**다 — 이름으로 고르면 반드시 틀린다.

## 🔴 회사명이 «보통명사» 면 뉴스 수집이 통째로 오염된다 (2026-09-11 실측)

→ [경위](./history/gotchas-data-collection-경위.md)

회사명이 보통명사면(「신원」·「경신」·「대승」·「용산」) 그 회사 뉴스가 「신원 공개」·「지지율 경신」 같은 무관 기사로 채워진다.

**🔴 그런데 더 큰 원인이 따로 있었다 — 질의에 «따옴표» 가 없었다.**

`urllib.parse.quote(name)` 은 URL 인코딩일 뿐 **검색 구절을 묶어 주지 않는다.** 그래서
구글이 사명을 토큰으로 쪼개 검색했고, 두 글자가 아닌 이름까지 오염됐다.

⚠️ **전부가 오염은 아니다** — 「기아」(1,454건)는 진짜 회사 기사다(상장사라 네이버 종목
큐레이션을 타서 애초에 이 경로가 아니다). **이름 길이로 일괄 삭제하면 안 되고, 회사당
표본을 열어 보고** 가려야 한다.

**왜 안 잡혔나**: 뉴스는 개수만 늘 뿐 «틀린 값» 이 아니라서 어떤 검사에도 안 걸린다.
화면에서도 그 회사를 눌러야 보인다. 🔴 **검사기가 없는 데이터는 아무도 안 본다.**

### 처방 (2026-09-11 적용 · A/B/C/D 를 실제로 던져 보고 골랐다)

| 사명         | 질의                          | 제목 필터 |
| ------------ | ----------------------------- | --------- |
| 두 글자      | `("(주)X" OR "㈜X") <맥락어>` | **건다**  |
| 세 글자 이상 | `"X" <맥락어>`                | 안 건다   |

맥락어는 `로봇`(`company_pages.page='humanoid'`) 아니면 `자동차부품`이다.
구현 = `collect_news.py` 의 `_kr_unlisted_query` · `_needs_title_check` · `_title_mentions`.

🔴 **두 글자를 `OR` 로 이으면 안 된다.** `"(주)세정" OR "㈜세정" OR "세정 자동차부품"` 은
20건 **전부 동명 타사**(세정그룹 의류·세정씨푸드)를 물어 왔다. `AND` 로 묶자 신영·용산·
경신·호원·명신·동보·일진이 **전부 진짜 회사 기사**가 됐다.

🔴 **제목 필터를 세 글자 이상에 걸면 «진짜 뉴스» 가 죽는다.** 기사는 사명을 줄여 쓴다 —
현대성우쏠라이트 → 「쏠라이트」(55/60 탈락) · 타타대우모빌리티 → 「타타대우」 ·
HL클레무브 → 「HL 클레무브」(공백) · 한국지엠 → 「GM」. 정확 구절 질의가 이미 본문에
사명이 있는 기사만 물어 오므로 제목까지 볼 필요가 없다.

⚠️ **완전히는 못 막는다.** 남는 것은 **동명 타사**다 — ㈜세정(자동차 부품)과 세정그룹(의류)은
이름만으로 가를 방법이 없다. 여기까지가 한계이고, 그 이상은 사람이 봐야 한다.

→ [경위](./history/gotchas-data-collection-경위.md)

**재발 방지**: `scripts/verify_news_relevance.py`(**exit 0 이 정상**) — 비상장 부품사의
뉴스가 150건을 넘거나(정리 후 실측 최대 97) 25건 이상인데 제목 일치율이 40% 미만이면
실패한다. 질의 형태 자체는 `scripts/lib/test_news_query.py` 가 잡는다.

---

## 🔴 한국어를 부분 문자열로 맞추면 조용히 0건이 된다 (2026-09-15 실측 · 두 세션 동시 발생)

「대상 없음」·「위반 0건」으로 보이지만 **검사기가 죽어 있는** 자리다. 건수가 줄어드는 것이
아니라 애초에 안 잡히므로, 지표로는 오히려 건강해 보인다.

**갈래가 둘이고 처방이 다르다.** 하나로 뭉치면 다음 사람이 반쪽만 고친다.

### (ㄱ) 어간 결합 — 음절이 합쳐져 어간이 «사라진다»

한글은 자모가 한 음절로 합쳐지므로, 활용하면 어간의 글자 자체가 바뀐다.

```python
'어렵'    in '판독이 어려운'   # False   ← 어+려+운  vs  어+렵
'나뉘어지' in '나뉘어진 구조'   # False   ← 지 + ㄴ = 진
```

**처방 = 어형을 낱낱이 나열한다.** `어[렵려]` · `나뉘어(지|진|졌)`.

### (ㄴ) 띄어쓰기·어순 변이 — 글자는 다 있는데 자리가 다르다

```python
'판독하지 못' in '판독 못 한'   # False   ← 「하지」가 빠지고 띄어쓰기가 다르다
```

**처방 = `\s*` 와 선택 어절.** `판독\s*(하지\s*)?못`.

🔴 **(ㄱ) 처방으로 (ㄴ) 을 못 고치고 그 반대도 안 된다.** 어형만 나열하면 띄어쓰기 변이를
놓치고, `\s*` 만 붙이면 활용형을 놓친다.

→ [경위](./history/gotchas-data-collection-경위.md)

### 그래서 무엇을 하나

🔴 **한국어를 맞추는 규칙을 쓰면 「걸려야 하는 표본」을 같은 파일에 박아 둔다.**
`verify_translationese.py` 의 `MUST_HIT`/`MUST_MISS` 가 그 형태이고, 매 실행마다 먼저 돌아
하나라도 어긋나면 **본 검사 전에 exit 2** 로 멈춘다. 위반 0건과 검사기가 죽은 것은
화면에서 똑같아 보이기 때문에, 이 양방향 시험이 없으면 구분할 방법이 없다.

**전역 규칙으로 올렸다**(2026-09-15 사용자 승인) — `~/.claude/rules/warn-korean-substring-match.md`.
파이썬 `'<한글>' in` · JS `.includes()`/`startsWith()` 등에서 **활용형·띄어쓰기 위험이 있는
literal 일 때만** 걸린다(명사 매칭은 안 걸린다). 발동 5 · 오탐 0 을 훅에 직접 먹여 확인했고,
이 레포 전체에서 걸리는 곳은 1군데뿐이라 경고가 묻히지 않는다.

관련 = 전역 규칙 `warn-regex-wordboundary-korean`(JS 정규식 `\b` 는 한국어에 무동작).
🔴 **갈래가 다르다** — 그쪽은 «경계가 없다», 이쪽은 «어간이 합쳐진다·자리가 다르다» 다.

---

## 🔴 폐지된 도메인은 404 가 아니라 HTTP 200 을 준다 — 폴백이 정본을 조용히 덮는다 (2026-09-16 실측)

→ [경위](./history/gotchas-data-collection-경위.md)

**증상.** 국내 상장사 `business_summary` 의 fnguide 원문이 LLM 요약으로 통째로 덮여 있었다 — fnguide 수집기는 멀쩡했고, 다른 보강 스크립트의 폴백이 덮었다.

### 원인 ① — 폐지 도메인이 「내용 없음」으로 읽힌다

→ [경위](./history/gotchas-data-collection-경위.md)

구 도메인은 404 가 아니라 **HTTP 200 + 안내 페이지**를 준다(→ `fnguide-wcomp-migration.md`). `raise_for_status()` 류에 안 걸리고 셀렉터가 빈 결과를 내 **「내용이 없다」**로 읽히면, 보강 스크립트(`enrich_description_v2.py`)가 이를 실패가 아니라 «1차 출처가 부실한 회사» 로 보고 **2차 LLM 폴백**으로 원문을 덮는다. 에러 로그는 0줄이다.

### 원인 ② — 보강 «대상» 판정과 «저장 항목» 을 묶었다

`enrich_company.py` 의 `_missing_meta()` 는 **제품이나 홈페이지가 비었으면** 그 회사를
보강 대상에 넣는데, 대상이 되면 `business_summary` 까지 새로 써서 덮었다.

→ [경위](./history/gotchas-data-collection-경위.md)

### 처방

- **1차 출처가 실패했을 때 폴백이 정본을 덮게 두지 말 것.** `lib/companies.py` 의
  `keeps_existing_summary()` 가 「국내 상장사 **and** 설명이 이미 있음」을 판정하고,
  보강 스크립트 5개가 이 값이 True 면 설명을 쓰지 않는다. **값이 비어 있을 때만** LLM 이
  임시로 채운다(신규 상장사가 영영 빈 칸으로 남는 것을 막는 예외 · 사용자 결정 2026-09-16).
- **대상 판정과 저장 항목을 묶지 말 것.** 제품이 비어 대상이 됐으면 제품만 채운다.
- 기계 검사 = **`scripts/verify_summary_source.py`**(exit 0 이 정상). fnguide 기업개요는
  예외 없이 「동사」로 시작한다 — 복구 후 180/180 에서 성립했고 평균 450자·최소 405자다.
- 🔴 조회 컬럼에 **`market` 을 빠뜨리면 판정이 전부 False 가 되어 가드가 조용히 무동작**한다.
  다섯 스크립트의 `select()` 를 함께 고쳤다.

## 수집기가 성공해도 revalidate 가 없으면 화면은 낡는다 (2026-09-16)

`collect_kr_snapshot.py` 는 `get_client()` 로 직접 UPDATE 해서 **`WriteSession` 의 자동
캐시 무효화를 타지 않았다.** GHA 워크플로가 `NEXT_REVALIDATE_SECRET` 을 넘겨 주는데
정작 스크립트가 쓰지 않아, 수집이 성공해도 페이지는 `'use cache'` 결과를 들고 있었다.
`WriteSession` 으로 바꿨다. **새 mutating 스크립트는 반드시 `WriteSession`** 이라는
약속이 이래서 있다.

## 「값이 있다」가 「값이 최신이다」는 아니다 — 시가총액이 조용히 멈춘다 (2026-09-16)

`collect_prices_live.py` 는 시가총액을 못 받으면 **갱신 payload 에서 그 항목을 뺀다.**
그래서 실패해도 과거 값이 그대로 남고, **주가는 정상 갱신되니 화면에서 구분되지 않는다.**

→ [경위](./history/gotchas-data-collection-경위.md)

**원인.** KRX 의 **시총 계열 엔드포인트만** 깨졌다 — `get_market_cap()` 은 JSON 이 아닌 응답, `get_market_cap_by_ticker()` 는 「시가총액」 컬럼 자체가 없다. 대조군 `get_market_ohlcv()` 는 정상이라 KRX 접근이 막힌 것이 아니다.

**처방.** 빈 응답·0원에도 경고를 남기고, 전면 실패면 나머지 수집을 마친 뒤 **exit 3**
(종전에는 이 상태가 초록불로 지나갔다). 시총 출처는 **`lib/naver_market_cap.py`** 로
옮겼다 — KRX 가 살아 있으면 그쪽을 먼저 쓰고 죽었을 때만 네이버를 쓴다.
🔴 네이버는 「75조 1,461억」 같은 **한국어 문자열**로 주고(숫자 엔드포인트가 없다)
**반환값이 이미 억원 단위**라 `EOK` 로 나누면 자릿수가 통째로 어긋난다. 파싱은 조용히
틀리므로 실측값 표본으로 **자가 시험을 내장**해 수집 시작 전에 돌린다.

🔴 **로컬에서 죽는다고 원격도 죽은 것은 아니다.** 로컬은 KRX 접근이 통째로 막혀
**대조군(주가 조회)까지 함께 죽는다.** 원인을 가르려면 **대조군을 같이 돌려** 환경 문제인지
대상 문제인지 먼저 나누고, 그다음 GHA 에서 확인한다.

---

## 🔴 회사를 «나중에» 추가하면 그 회사의 증권사 리포트는 영영 끊긴 채 남는다 (2026-09-16 실측)

**증상** — 휴머노이드 페이지에 새 회사를 넣었는데, 그 회사 이름으로 이미 수집돼 있던
증권사 리포트의 `research_reports.company_id` 가 **`NULL` 그대로**다. 화면 목록에는
리포트가 멀쩡히 보이므로 눈으로는 드러나지 않는다.

**원인 — 두 설계가 겹쳐서 그렇다. 하나만 알면 못 고친다.**

1. `collect_naver_research.py` 는 **수집 시점에 휴머노이드 페이지에 있던 종목만**
   `ticker → company_id` 표에 담는다(같은 파일 머리말 1번). 그때 없던 회사는 당연히 `NULL` 이다.
2. 🔴 **그래서 재수집하면 될 것 같지만 안 된다.** 같은 파일 「함정 1」이 **이미 아는
   `naver_nid` 를 건너뛴다** — 아는 행을 다시 쓰면 상세 보강분이 되레 뒤로 가기 때문에
   일부러 그렇게 만들었다. 두 결정 각각은 옳은데, 겹치면 **사람이 손대기 전까지 영영 끊겨 있다.**

→ [경위](./history/gotchas-data-collection-경위.md)

**처방**

```bash
scripts/venv/Scripts/python.exe scripts/verify_research_company_link.py        # 검사
scripts/venv/Scripts/python.exe scripts/verify_research_company_link.py --fix  # 연결
```

⚠️ **`/domestic`·`/parts-top100` 종목의 `company_id` 가 비어 있는 것은 결함이 아니다**
(LG전자·현대위아·에스엘 등 9곳). 수집기가 애초에 자동차 종목을 연결 대상으로 삼지 않으므로
**설계대로**다. 검사기도 휴머노이드 종목만 본다 — 이걸 위반으로 세면 매번 9건이 빨개져
**진짜 결함이 묻힌다**(검사기의 `MUST_MISS` 에 이 칸을 박아 두었다).

---

## 특정 연도만 재무가 빈다 — 그 해에 «연결»이 없는 회사다 (2026-09-16 실측)

**증상** — 화면 표에서 한 회사만 `'23 매출`·`CAGR`·`'23 OP%` 가 비어 있다. 다른 연도는
멀쩡하고 수집 로그에도 오류가 없다.

**원인** — fnguide 는 **헤더에 2023 컬럼을 주면서 값만 전부 `None`** 으로 준다. 회사가
그 해에 연결재무제표를 내지 않았기 때문이다(종속회사가 나중에 생긴 경우). 실측:

→ [경위](./history/gotchas-data-collection-경위.md)

`collect_financials.py` 의 폴백은 **회사 단위**다 — `has_dataset_values()` 가 「VAL 이 하나라도
있으면」 연결로 판정하므로, 2024·2025 연결이 있는 회사는 연결을 쓰고 **2023 은 빈 채로 남는다.**

🔴 **이것은 결함이 아니라 옳은 동작이다. 별도로 메우려 들지 말 것.** 2023 별도 + 2024 연결을
한 줄에 놓으면 연결이 대개 더 커서 **매출 성장률과 CAGR 이 거짓이 된다.** 기준이 섞인 표는
빈칸보다 나쁘다 — 빈칸은 모른다는 것을 보여 주지만 섞인 값은 틀린 것을 아는 것처럼 보여 준다.

⚠️ **`PER`·`EV/EBITDA` 빈칸은 또 다른 갈래다** — 적자 기업은 애초에 정의되지 않는다
(씨메스로보틱스·클로봇·에이럭스가 2025 순손실이라 비어 있다). 이쪽도 정상이다.
