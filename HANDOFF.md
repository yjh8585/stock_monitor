# HANDOFF

다음 세션이 그대로 이어받기 위한 인수인계 기록. **맨 위가 최신**이고, 새 블록을 쓸 때
직전 블록은 `## 이전 상태 …` 로 강등한다.

**여기엔 최근 10블록만 둔다.** 그보다 오래된 블록은 지우지 않고
[`docs/handoff-archive-2026.md`](./docs/handoff-archive-2026.md)(현재 **30블록** · 2026-11-03 실측)로 옮긴다.

---

## 최신 상태 · 재개 지점 (2026-11-10, **고객사 페이지 2단계 끝 — 공식 문서 수집·가이던스·물량·실적 일정 + 최종 검토 수정 전량 · 미푸시**)

> 이 세션의 관통 주제: 「고객사」 페이지(`/customers`) 2단계 — 11개 상장 자동차 고객사의 공식 문서(EDGAR·DART·IR 사이트)를 모아 회사별 코드 파서(+코드로 못 뽑는 칸만 LLM)로 가이던스·물량·실적·실적 일정을 뽑고, 인용·숫자 대조를 통과한 행만 화면에 띄운다. 태스크 15개 → 최종 검토 3명 → 수정 22건 + 잔여 Minor 5건까지 끝냈다.

**결과**: 커밋 `bba925e..e4a9e05`(master · **푸시 안 함** — 1단계 화면 커밋부터 원격보다 54개 앞섬). 계획서 `docs/plans/2026-11-09-customers-page-phase2.md` · 결정 기록 `docs/plans/2026-11-09-customers-page_결정이행.md`(2단계-a~ah) · 수집 규칙 `docs/customers-collection.md` · 종료 코드 `docs/commands.md` 「고객사 수집 종료 코드」 · GHA `.github/workflows/collect-customer-docs.yml`(평일 KST 08:00 · 회사별 matrix). SDD 원장 `.superpowers/sdd/2026-11-09-customers-page-phase2/progress.md`(gitignore · 맨 끝 「최종 검토 complete」).

**사용자 지시·선택 (2026-11-10)**: 워크플로 커밋 승인 · GM IR 은 GHA 에서 먼저 시험하고 막히면 사용자 PC · PDF 상한 50MB · 현대·기아 CEO Investor Day 는 AI 가 읽는다 · D7 「넣어도 돼」(NDA 문구 있는 기아 PDF 캡처 허용) · D8 「가로 해」(스텔란티스 IR 자료실 = 3단계, 설계서 「2단계에서 넘어온 것」 절에 기록) · `SEC_USER_AGENT` Secret 은 따로 등록 안 함(기존 스텔란티스 EDGAR 수집기가 `lib/edgar.py` 기본 UA 로 GHA 에서 성공 중 — 2026-08-27 정기 실행).

**비자명한 사실 (재조사 금지)**:

- 공개 레포라 손익 고객명·매출 비중·공급 품목·「○○는 우리 고객」 문장은 코드·시험·주석·커밋 메시지에 금지(OEM 이름은 허용 · 약칭 KGM · 포르쉐 원문 라벨 `Porsche` 는 승인된 예외 · 시험 데이터는 `가나자동차`·`Acme Motors`). 원본 명단·IR 조사는 `참고/고객사/`(gitignore · 이 PC 에만).
- GM IR 사이트(Akamai)는 실제 Chrome `--headless=new` + 일반 UA + CDP + 페이지 안 fetch 로만 열렸다(이 PC). GHA IP 에서는 미확인 — 스크립트 원형은 세션 scratchpad 였으니 IR 확장 때 `참고/고객사/research/ir_us.md` 를 보고 다시 짠다.
- 같은 날 DART 공시(code)와 IR 자료(llm)가 같은 전망을 내면 화면(`lib/customers/ir.ts` foldHistory)과 방향 판정(`scripts/lib/guidance_direction.assign`) 둘 다 code 행을 그날의 전망으로 본다 — 한쪽만 바꾸면 화면 배지와 DB direction 이 갈린다.
- LLM `stated`(상향·유지·하향·철회)는 인용에 근거 낱말이 없으면 지운다(`llm_guidance._STATED_WORDS`). 이미 DB 에 있는 행은 `--reparse` 전까지 옛 값 — PII 문서 303·304 · STLA 317·318 의 4행은 다시 처리하면 stated 가 지워지는 것이 옳다(원문 확인 끝 · 아직 안 돌림).
- DART 원문 받기: status 013·014(자료·파일 없음)만 영구 실패로 닫고, 키 없음·한도·점검·비-zip 응답은 pending 으로 두어 다음 실행이 다시 집는다.
- `Architecture.md` 여유 36B(150,939/150,975) · `docs/gotchas-data-collection.md` 여유 30B · AGENTS.md 36,529/36,600 — 고객사 내용을 더 적을 땐 `docs/customers-collection.md` 로.
- Codex 는 이번 주 한도 게이트(90%)에 걸려 2단계 후반 점검은 서브에이전트가 대신했다.

**재개 지점**: IR 확장 계획서 작성부터. 재료 = `참고/고객사/research/ir_expansion.md`(태스크 T1~T6 · 결정 D1~D9) + 원장 `progress.md` 의 `minor (deferred)` 줄 + `final-fix-list.md` 「받지 않음 / 나중」. 새 계획서는 공개 판 규칙으로 `docs/plans/2026-11-10-customers-ir-expansion.md`. 넣을 것: D1 GM 은 GHA 에서 Chrome CDP 경로 먼저 → 막히면 PC · D2 50MB · D6 기아 CID 는 AI 가 읽고 첫 문서에서 비용 실측 · D4 새 문서 종류 없음 · D9 증권사 리포트 없음 · Codex 표본에서 빠진 연간 가이던스(GM 순이익·조정 전 EPS·자동차 영업현금흐름·capex · VW 조정 마진 약 4%·특별 항목 약 €10bn) · 영구 받기 실패 문서를 사람이 not_target 으로 닫는 절차 · P4 「서식 미인식」 오탐 정리(폴라리스·리비안 expects_numbers) · raised 어간 `increas` 로 느슨해진 stated 거르기(guidance·outlook 낱말과 함께) · 스텔란티스 `TOTAL_LABEL` 대조 · 포드·비상장 OEM 이 matrix 밖 · VW approximately/about.

**푸시 뒤 사용자가 할 일**: GHA `collect-customer-docs.yml` 수동 실행 두 번 — ① `probe_gm_ir` 체크(GM 행만) ② `backfill` 체크(2년 백필 · 첫 실행 회사별 소요로 `timeout-minutes: 40` 확정). 필요하면 `--reparse` 로 위 4행 교정.

**따로 할 일(이번 범위 밖)**: GM 뉴스에 MP Materials 기사 섞임 · 폴라리스 뉴스 · 화면 `-0` 표시 · 스텔란티스 MarkLines 2020 YTD=1.

**검증**: `npm run check-all` EXIT 0(vitest 633) · pytest 750 통과 · `verify_call_contracts`·`verify_revalidate_tags`·`verify_docs` exit 0 · 최종 검토 재검토 P1~P14·T1~T8 전부 해결 · 헤드리스 화면 확인(T 수정분).

## 이전 상태 · 재개 지점 (2026-11-09, **알루미늄 미국·국제·한국·중국 비교 차트 + 수집기 3종 일반 이름으로**)

> 이 세션의 관통 주제: 구리·열연 비교 차트를 끝낸 뒤 「알류미늄도 동일하게 조사해서 그래프 그려봐」 지시로 알루미늄 원천 4개를 붙이고, 금속마다 따로 있던 수집기 3개를 일반 이름으로 합쳤다.

**결과**: 이번 커밋(마이그레이션 `20261109000002` · 수집기 `collect_komis_lme.py`·`collect_pps_metals.py`·`collect_shfe.py`(옛 `collect_copper_lme`·`collect_copper_pps`·`collect_shfe_hrc` 에서 `git mv`) · 원자재 화면 세 번째 카드 · 문서). 계획서·사용자 선택·검토 반영 표 = `docs/plans/2026-11-09-iron-copper-prices_최초지시.md` 「## 알루미늄」.

**사용자 지시**: _"알류미늄도 동일하게 조사해서 그래프 그려봐"_ → 선택: 미국 선 = 중서부 실거래가(LME + `AUP=F` 프리미엄) · 조달청 = 서구산 · 기존 `ALU` 라벨 → 「알루미늄 (COMEX)」 · 수집기 = 일반 이름으로 (2026-11-09).

**비자명한 사실 (재조사 금지)**:

- 새 시리즈: `ALU_LME`(KOMIS `MNRL0009` — 페이지에 광종 이름이 없어 DB 와 맞대 판별) · `ALU_KR`(조달청 「알루미늄(서구산)」 원/t 부가세 포함) · `ALU_CN`(SHFE `al` 위안/t 증치세 포함) · `ALU_MWP`(야후 `AUP=F` USD/lb — `collect-market-series` 가 모은다 · 라이브 수집에선 제외).
- 미국 알루미늄 가격은 COMEX `ALI=F` 가 아니다 — 관세가 빠져 LME 와 거의 같다. 화면의 미국 선 = LME + 프리미엄 ×2204.62262, 프리미엄이 10일보다 오래되면 그 점을 그리지 않는다(`lib/commodityUnits.ts` `PREMIUM_MAX_LAG_DAYS`).
- 조달청은 알루미늄 서구산도 아예 안 파는 날이 있다(5년 28일 · 원문 4편 확인). 판매 안 함 = 「알루미늄」 글자가 없거나, 그 글자가 든 칸이 전부 비서구산. 「알루미늄 (서구산)」 같은 표기 변경은 실패(exit 1)로 잡힌다(자가 시험에 변형 3종).
- 🔴 이 PC 에서 yfinance 가 모든 심볼을 「possibly delisted」 0행으로 내면 `PYTHONUTF8=0` 으로 다시 돌린다(한글 레포 경로와 겹칠 때만 · GHA 는 해당 없음 · gotchas 에 기록).
- (같은 날 후속 지시) 열연은 중국, 알루미늄은 미국 선을 왼쪽 보조축으로 · `MultiSeriesChart` 범례 클릭 토글(경제지표·주식 비교 카드에도 적용). **미국 구리엔 웃돈을 더하지 않는다** — 정제 구리는 232조 관세 면제이고 2027·2028 단계 관세는 미시행(2026-11-06 기사), COMEX 가 곧 미국 가격(사용자 선택 「그대로 + 설명」 · 근거 링크 = 계획서 「## 보조축 · 범례 토글 · 구리 미국 가격」). 정제 구리 관세가 실제로 시행되면 그때 다시 본다.
- (같은 날 후속 지시) 주식 비교 카드(`DualStockCard`·`CrossMarketCard`)는 선택기가 「좌축」이라 부르는 첫 종목을 실제로는 오른쪽 눈금에 그리고 있었다 → `secondaryFor={[0]}` 로 차트를 라벨에 맞췄다(국내×해외 = 국내가 왼쪽). 카드 머리 현재가 단위도 박지 않고 `companies.currency` 로 종목마다(해외는 USD·EUR·JPY·CNY 등이 섞인다 — 전엔 폭스바겐이 「USD」로 떴다).
- `Architecture.md` 상한(150,975B)은 같은 날 두 번 깨졌다 — 고객사 세션이 라우트 표에 긴 칸 하나를 넣자 16행 전체의 정렬 공백이 늘었다(AGENTS.md 「표 셀에 긴 서술 금지」의 실례). 두 번 다 날짜 경위를 `docs/history/Architecture-경위.md` 로 옮겨 맞췄다(부록 A 통째 포함) · 다음에 또 넘치면 그 표의 `/customers` 칸을 줄이는 것이 가장 싸다(고객사 세션 것이라 이번엔 안 건드림).
- 공용 `collect_market_series.py` 는 한 심볼이 0행이어도 exit 0 이다(기존 동작 · 이번에 안 바꿈). 그래서 `AUP=F` 가 끊기면 메일은 안 오고, 화면의 미국 알루미늄 선이 끊기는 것으로만 드러난다.

**재개 지점**: 끝났다. 내일 06시대 정기 GHA `collect-steel-kr.yml` 이 새 파일명 세 단계로 초록인지 본다. `AUP=F` 가 월평균 정산 선물이라 「그날 실거래가」와 다를 수 있다는 검토 의견은 미확인으로 남겼다(라벨은 「LME+프리미엄」). 한국 열연은 여전히 보류.

**검증**: `npm run check-all` EXIT 0(vitest 544) · `verify_call_contracts.py` 위반 0 · 실패 경로 시험 20건 통과 · 수집기 3종 기본 실행 EXIT 0 · 백필(ALU_KR 1,133일 · ALU_CN 1,204일 · 오류 0) · 헤드리스 캡처(라이트·다크)로 4선 확인 · Codex·오퍼스 diff 검토 지적 반영. `verify_docs.py` 는 기존부터 있던 `gotchas-ci-deploy.md` 상한 초과 1건(이번 변경과 무관).

## 이전 상태 · 재개 지점 (2026-11-09, **STEEL_KR GHA 실패 수정 + 구리·열연 미국·국제·한국·중국 비교 차트**)

> 이 세션의 관통 주제: GHA 실패 메일(철광석)을 고친 뒤, 「철·구리 가격을 미국·한국·국제로 모두 보고 싶다 · 단위를 통일해 한 차트에」 요청으로 원천 3개를 새로 붙이고 원자재 화면 맨 위에 USD/t 비교 차트 2개를 넣었다.

**결과**: 커밋 `256a0c4`(KOMIS 가격기준 코드를 이름으로 조회) · `7c7ce5f`(수집기 3종 + 비교 차트 + 문서) + 이번 마무리 커밋(조달청 판매 중단일 처리 · LME 색 · 계획서 실행 결과). 계획서·사용자 선택·검토 반영 표 = `docs/plans/2026-11-09-iron-copper-prices_최초지시.md`.

**사용자 지시**: _"메일에 gha 실패 알림이 자꾸 오는데 확인해서 수정해"_ → _"철, 구리는 미국, 한국, 국제가격이 다 궁금한데 모두 수집해서 표시할 수 있나? 단위가 다르면 단위 통일해서 한 차트에 그리면 좋을텐데."_ → 선택: 달러/톤 · 한국 철강은 일단 뺌(무료 일별 출처 미확인) · 세금 빼고 비교 · 맨 위 추가·기존 차트 유지 (2026-11-09).

**비자명한 사실 (재조사 금지)**:

- KOMIS 철광석 가격기준 코드가 예고 없이 793→878 로 바뀌어 옛 코드가 **HTTP 200 빈 배열**을 줬다 — 이제 `scripts/lib/komis.py` 의 `resolvePriceCode` 가 이름으로 찾는다.
- 새 시리즈: `COPPER_LME`(KOMIS, USD/t) · `COPPER_KR`(조달청 비축 판매가, 원/t **부가세 포함**) · `HRC_CN`(SHFE 주력월물 결산가, 위안/t **증치세 포함**). DB 는 원값 그대로, 환산은 `lib/commodityUnits.ts` 에서만.
- 조달청은 **구리를 아예 안 파는 날**이 있다(5년 중 17일) — 실패가 아니다(`collect_pps_metals.py` 의 `isNoSale`). 「구리」 글자가 있는데 행을 못 읽거나 목록이 0건이면 exit 1.
- SHFE 는 장중엔 파일이 있어도 결산가가 비고, `小计` 소계 행이 미결제약정 최대라 숫자 월물만 본다. **GHA(미국 IP)에서도 열린다**(11-09 수동 실행 4단계 전부 성공).
- 수집기 3종은 받은 값을 저장한 «뒤» 실패를 exit 1 로 드러낸다 — 기본 조회 범위(조달청 1쪽 ≈ 10영업일 · SHFE 10일)보다 오래 끊기면 `--backfill-years N` 으로 메운다.
- dev 화면에서 새 선이 잘려 보이면 낡은 캐시다 — `scripts/.env` 무효화 주소가 3000 인데 dev 가 3001 에 뜬다(`gotchas-playwright-ui.md` 에 이미 있음).

**재개 지점**: 끝났다. 내일 06시대 정기 GHA(`collect-steel-kr.yml`)가 4단계 모두 초록인지만 본다. 한국 열연(철강) 가격은 사용자 선택으로 보류 — 무료 일별 출처를 찾으면 같은 비교 차트에 한 선을 더한다.

**검증**: `npm run check-all` EXIT 0(vitest 542) · `verify_call_contracts.py` 위반 0 · 실패 경로 시험 11건 통과(실물 판매 중단 글 3건 포함) · GHA 수동 실행 성공 · 헤드리스 캡처로 5선 확인. `verify_docs.py` 는 기존부터 있던 `gotchas-ci-deploy.md` 상한 초과 1건(이번 변경과 무관).

## 이전 상태 · 재개 지점 (2026-11-03, **financials 결산일 중복 29묶음 정리 + 재발 경로 차단**)

> 이 세션의 관통 주제: 11-02 회차가 「자빌만」이라 넘긴 중복이 실제로는 비-12월 결산 9개사 29묶음이었다. 원인을 재현으로 확정하고, 정본을 회사마다 판정해 정리한 뒤, 검사기와 수집기 양쪽에 다시 못 생기게 막았다.

**결과**: 커밋 `a69e50b`(마이그레이션 `20261103000001` · `verify_financials_sanity.py` 5번 「결산일 중복」 · gotchas) + 이번 마무리 커밋(`collect_financials.py` 연간 손익이 비면 그 회사 스킵 · 회귀 `scripts/lib/test_yf_fiscal_offset.py` 4건 · gotchas 2편). DB: 8개사 24행 삭제 · 헬라 5행 삭제 + 4행 fiscal_year +1 → 결산일 중복 0.

**사용자 지시**: 상위 세션 위임(조사 → 원인 재현 → 정리안 승인 후에만 삭제) → _"중복 검사 포함 진행"_ → _"남은 위험도 고치고 wrap-up으로 마무리 해"_ (2026-11-02~03).

**비자명한 사실 (재조사 금지)**:

- 원인: 2026-05-21 -1 보정을 마이그레이션 `20260521000003`(기존 행)과 수집기 `243eeb1`(새 행)에 따로 넣은 사이, **일본만 보정하던 `dfad7c8` 수집기가 한 번 돌았다**(GHA run 26201157660 · 로그 만료). 현재 yfinance 로 `fy_offset=0` 을 돌리면 남은 키와 정확히 일치. 정상 실행이 같은 키를 새 기간으로 덮어 가서 «덮일 차례가 안 온 최근 키»만 남아 있었다.
- 정본: 8개사는 -1 쪽. **헬라(HLE.DE)는 반대** — 2023년부터 12월 결산이라 수집기 `fy_offset=0` 이 맞고, 마이그레이션이 옛 5월 결산 행 때문에 헬라 전체를 -1 했다. 헬라 연간 2022-05-31 은 관례상 2021 이지만 수집기가 2022 키를 다시 만들어 2021 쪽을 지웠다.
- 기존 `verify_financials_sanity.py` 는 연간 값만 봐서 29묶음이 있어도 exit 0 이었다(5번 신설로 정리 전 29건 검출 확인).
- 🔴 MCP `apply_migration`·`execute_sql` 은 DELETE 를 `declined` 로 돌려준다(권한 모드를 바꿔도). 이번엔 postgrest(`WriteSession`)로 적용했다 — 트랜잭션이 필요하면 Management API 끝점(`gotchas-ci-deploy.md` §3). 데이터 마이그레이션은 이력 표에 없다(5월 것도 없음).
- 워크트리엔 `.env`·`node_modules`·`참고/손익` 엑셀이 없다 — 본 체크아웃 것을 `set -a; . ../../../scripts/.env` · `PATH=../../../node_modules/.bin` 으로 빌려 썼다. `test_sync_pnl_sil.py` 는 엑셀이 없어 워크트리에서 수집 오류(무관).

**재개 지점**: 끝났다. 다음 분기 재무 수집(2027-01-14) 뒤 `verify_financials_sanity.py` 가 exit 0 인지만 보면 된다(결산일 중복이 생기면 5번이 잡는다). 수집 로그의 「연간 손익이 비어 … 스킵」 경고가 같은 회사에 연속으로 뜨면 yfinance 쪽 문제다.

**검증**: `npm run check-all` EXIT 0(vitest 535) · `pytest scripts/lib`(엑셀 의존 1개 제외) 520 passed · `verify_financials_sanity.py` 위반 0 · DB 결산일 중복 0묶음.

## 이전 상태 · 재개 지점 (2026-11-02, **GHA 실패 점검 — Stellantis 3분기 · 2월 결산 재무 복구**)

> 이 세션의 관통 주제: 「GHA 오류 확인」 요청에서 오늘 실패 1건(일시 장애)보다 **10월에 실패한 채 다음 분기까지 방치될 뻔한 분기 워크플로 2건**이 더 컸다. 분기 1회 워크플로는 마지막 실행이 실패면 그 분기 데이터가 3개월 빈다 — 실패 목록은 「오늘」이 아니라 **워크플로별 최신 실행**으로 본다.

**결과**: 커밋 `a9713ad`. ① `collect_stellantis_na_sales.py` — 회사 합계 줄 이름 `STELLANTIS US` 추가 · Dodge 허용치 Q 25→40 · YTD 100→200(PR 원문 자체의 차이) · 회귀 2건 → GHA 수동 실행(41448376816)으로 2026-Q3 29행 적재. ② 마이그레이션 `20261102000001` — `financials_period_semantic_check` 허용 결산월에 2 추가(야스카와 6506.T) → 10-14 재무 수집 실패 작업만 재실행, 2,275행 적재 · 야스카와 연간 5개년 확인.

**사용자 지시**: _"GHA 오류가 있던데 확인해봐"_ → _"둘 다 고쳐"_ → _"커밋하고 적재"_ (2026-11-02).

**비자명한 사실 (재조사 금지)**:

- 11-02 `verify-fnguide` 실패는 `ConnectTimeout`(응답 0) — 계약 변경 아님. 로컬 36/36 OK · 재실행 성공. 검사기 안내문(「계약이 바뀌었을 수 있다」)은 접속 실패에도 같은 문구를 낸다.
- 글로벌(yfinance) 경로는 `companies.fiscal_year_end_month` 를 쓰지 않는다(데이터 첫 연간 결산일로 판단). 글로벌 비-12월 결산사 36곳이 12 로 남아 있는 것이 현행이라 **야스카와만 고치지 않았다**. CHECK 허용 월 목록은 이제 Architecture §7-J 에 있다.
- 비-12월 결산사의 분기 번호는 「달력 분기 + 회계연도 -1」(덴소 2025-06-30 = FY2024 Q2) — 기존 규칙. 자빌(JBL)에만 같은 `period_end_date` 가 `fiscal_year` 만 달리 두 번 있는 중복 행이 있다 → 별도 세션(「비-12월 결산 글로벌사 재무 분기 중복 행 정리」, 워크트리)이 맡았다.
- `collect_stellantis_na_sales.py --auto-discover` 는 dry-run 에서도 `scripts/lib/stellantis_pr_urls.json` 을 CRLF·끝 줄바꿈 없이 다시 써서 `format:check` 를 깬다 → `npx prettier --write` 로 맞춘다.
- `collect_financials.py` 엔 dry-run 이 없다. 회사별 결산월 대조는 일회용 읽기 스크립트로 했다(scratchpad · 남지 않음).

**재개 지점**: 끝났다. 남은 것은 별도 세션의 JBL 중복 행 정리뿐. 다음 분기(2027-01)에 Stellantis 이름표가 또 바뀌면 같은 처방(gotchas-data-collection 「판매」 줄).

**검증**: `npm run check-all` EXIT 0(시험 535) · `test_stellantis_na_parsing.py` 25 passed · `verify_financials_sanity.py` 위반 0 · `verify_fnguide.py` 로컬 36/36 · DB 2026-Q3 29행(회사 합계 324,277 = 원문) · 야스카와 annual 5행.

## 이전 상태 · 재개 지점 (2026-10-31, **「기타 > 경영표준」 신설 — 그룹웨어 경영표준 종합 보고서 14편(리포트 149~162) 게시**)

> 이 세션의 관통 주제: 그룹웨어 경영표준 514건을 「분야별 지식노트 19편 → 회사 운영체계 보고서 12장+부록 2」 두 단계로 정리했다. 원고 → 검사기 → 검토 패널 6명(지적 약 160건) → 장별 수정자 6명이 원문 대조로 반영·기각 → 장 사이 넘김을 메인이 중계했다. Codex 는 전 장이 사외비라 원고 대조에 쓰지 않았고 코드 diff 검토에만 썼다.

**결과**: `/etc/mgmt-standard`(장 목차 · 사외비 — admin·holdings·mobility 만) · `/etc/mgmt-standard/[id]`(`PostDetail` 공용). posts 149~162, category '경영표준', 전부 `is_confidential=true`, `source_published_at=2026-10-30T00:00:00Z`, `source_url`=그룹웨어 경영표준 화면. `/reports` 목록·카테고리·출처 드롭다운에서 감춘다(`HIDDEN_CATEGORIES`). 지식노트 19편 = 볼트 `20_경영/사내표준`(지식 폴더 아님 — Voyage 색인 대상 밖).

**사용자 지시**: 원문 = `docs/참고/_최초지시_경영표준_2026-10-30.md`(gitignore) · 확정 결정 8개 = `docs/plans/2026-10-30-mgmt-standard.md`(이행 = `_결정이행.md`).

**비자명한 사실 (재조사 금지)**:

- 원고·도구는 레포 안 gitignore 폴더 `참고/경영표준/`(보고서/·도구/·묶음/·원본/) — 커밋되지 않는다. 다시 게시 = `npx tsx scripts/_mgmt_standard_publish.ts [--dry-run] 00 01 … 11 A B`(gitignore `scripts/_*.ts` · 같은 제목이면 UPDATE). 게시 전 검사 = `verify_report.py`·`verify_translationese.py`·`verify_report_krw.py`·`node 참고/경영표준/도구/verify_mermaid.mjs`·`verify_docnos.py`.
- 검사기 둘(`verify_mermaid.mjs`·`verify_report.py`)은 CRLF 원고를 실패로 친다 — 파이썬 `write_text` 가 07장을 CRLF 로 바꿔 Mermaid 3개가 조용히 빠진 사고 뒤 넣었다(전역 gotchas §5).
- 원문끼리 다른 값은 판정하지 않고 각 장 「확인이 필요한 곳」에 나란히 적었다(모으는 장: EPC·초기유동관리 종료·PQC·사내 R@R = 10장, PM 선정 = 07장). 경영검토 주기 = MS-A10 「정기적으로」·QM-A9.0 「최소한 매년」.
- 07장 제목을 「일감에서 수금까지」로 바꿨다(장 경계는 그대로 · 제1원리 검토 지적). 장 번호는 사용자 결정 4로 고정.
- 처리표(반영 177 · 기각 10 · 메인 결정 5 · 넘김 6 · 미결 0)·검토 원본은 세션 scratchpad 에만 있다 — 다음 세션엔 없다.
- `revalidateTag(t, 'max')` 라 게시 직후 첫 요청은 옛 캐시 — 두 번 열어 확인한다.
- 지식노트 07·11편에 고객사 이름이 남아 있다(노트 규칙엔 이름 금지가 없고 개인 볼트 사외비라 그대로 둠 — 사용자에게 알림, 답 없음).
- 커밋 전 diff 검토(오퍼스·Codex 따로) — Critical·Important 0. 기각한 Minor(휴머노이드 상세와 같은 기존 방식이라 공용 컴포넌트를 건드려 세 화면을 함께 바꾸지 않았다): ① 상세가 카테고리를 확인하지 않는다(권한자가 남의 글 id 를 쳐도 이 경로에 보인다 — 권한 상승은 아님) ② `PostDeleteButton` 이 삭제 뒤 `/reports` 로 간다 ③ 사이드바 하위 메뉴 활성 표시가 정확 일치라 상세에서 꺼진다 ④ `/etc/mgmt-standard` 경로 문자열이 목차·상세·권한·사이드바 네 곳.

**재개 지점**: 끝났다. 남은 선택지만 있다 — ① 운영 배포 뒤 운영 화면을 헤드리스로 한 번 열어 보기(로컬 3001 에서는 확인 완료) ② 노트 07·11 고객사 이름 정리 여부(사용자 판단).

**검증**: `npm run check-all` EXIT 0(시험 535) · anon REST 경영표준 0행 / service 14행 전부 사외비 · 로컬 헤드리스(admin 목차 14·Mermaid SVG·별표 0·가로 넘침 0 · hmobility·guest 차단 · `/reports` 누출 0) · 원고 검사 다섯 종 EXIT 0(Mermaid 53/0).

## 이전 상태 · 재개 지점 (2026-10-30, **KATECH PDF 2편 게시 — 리포트 147 · 148**)

> 이 세션의 관통 주제: 88쪽 격월간지를 한 편으로 정리했다 — 꼭지별 서브에이전트 4명이 초안을 쓰고, 메인이 그림 15장을 직접 열어 캡션을 대조하고, Codex 사실 대조를 범위 둘로 나눠 돌렸다. Codex 지적 12건은 전부 맞았고 대부분 원문 단서(「~할 수 있다」)가 단정으로 바뀐 것이었다.

**결과**: `/reports/147` 세계 100대 자동차 부품기업 분석(KATECH 산업분석 Vol.173 · 카테고리 「부품사」 · 표 7) · `/reports/148` 산업전환 시대, 자동차 인력의 변화와 대응(모빌리티 인사이트 Vol.45 · 카테고리 「인력」(새 카테고리) · 표 15 · 그림 15장 = Storage `reports/katech-mi45/` · 약 7.6만 자). 두 편 모두 PDF 미업로드 · KATECH 게시판 링크. 원고·조립본·게시 스크립트는 `scripts/_k173_report.md` · `scripts/_pdf_report/2026-10-30/` · `scripts/_katech_pdf_publish.ts`(전부 gitignore · 사용자 승인 없이 지우지 않아 남아 있다).

**사용자 지시**: _"첨부한 보고서를 각각 보고서 페이지에 정리해서 게시해."_ (2026-10-30, PDF 2개) · 리포트 146 작성일 하루 밀림 가능성에는 _"그대로 둬"_

**비자명한 사실 (재조사 금지)**:

- `source_published_at` 은 **UTC 자정(`…T00:00:00Z`)** 으로 넣는다 — `+09:00` 자정이면 작성일이 하루 앞당겨 보인다(147 에서 실측 · 같은 날 고침 · `docs/report-from-pdf.md` §3-F). 146 도 같은 형식이지만 사용자 판단으로 그대로 둔다
- KATECH 목록 맨 위 `data-post_key` 는 `[안내]` 공지일 수 있다 — 줄 순서로 제목과 짝짓는다
- 모빌리티 인사이트는 **격월간**(원문 86쪽)
- 운영 화면 헤드리스 확인: 본문이 안쪽 영역에서 스크롤돼 `full_page` 가 첫 화면뿐 · 그림은 지연 로딩이라 「로드 0장」은 결함이 아니다

**재개 지점**: 이 작업은 끝났다. 남은 일 없음. (임시 파일 삭제는 사용자 승인 사항 — 원하면 위 세 경로를 지운다)

**검증**: 두 편 모두 `verify_yt_report.py` · `verify_report_krw.py` · `verify_translationese.py` EXIT 0 · 운영 헤드리스 두 번 열기(147 표 7 · 148 표 15·그림 15 · 깨진 `**` 0 · 원화 각주·원문 링크 있음) · `npm run check-all` 중 lint·typecheck·시험 531 통과, `format:check` 는 남의 미추적 파일 `docs/plans/2026-10-30-mgmt-standard_결정이행.md` 1건으로만 실패

## 이전 상태 · 재개 지점 (2026-10-30, **OEM 「중국」 탭 신설 — 기존 차트 재사용으로 재작업 + 검토 지적 전량 반영**)

> 이 세션의 관통 주제: 첫 판이 「전체 탭처럼」 지시를 받고도 전체 탭 컴포넌트를 열지 않아 새 차트 7개를 만들었다 → 사용자 지적 2회로 전부 지우고 기존 부품만 조립했다. 재작업 판도 토글·카드 껍데기를 또 새로 짜 검토에서 걸렸다 — **짝은 「같은 모양」이 아니라 「같은 일」로 찾는다.**

**결과**: `/oem/china`(MarkLines 중국 엑셀 3종 → `oem_china_*` 3테이블 · 생산 63,312 · 차급 1,850 · 수출 21,352행). 화면은 새 부품 0개 — 「전체」 탭 차트 4종(`year` 등 기본값 현행인 선택 인자) + 회사 탭 공용 + KG `KgDomesticExportSplit`(`title`·`footer`) + 우즈베키스탄 `UzbekistanDimensionToggle`(`options`). GHA `sync-oem-china-excel.yml` 월 10:20 KST. 계획서·결정 이행 = `docs/plans/2026-10-29-oem-china-tab.md` + `_결정이행.md`(짝짓기 표가 다음 국가 탭 본보기).

**사용자 지시**: _"oem 페이지에 신규 서브페이지 추가 … 3개 엑셀파일 읽어보고 분석해서 "전체" 서브페이지 처럼 구성해봐"_ (2026-10-29) · _"무작정 새로 양식 만들지 말고 있는 차트양식 최대한 참고해"_ · _"과거 작업 확인하는 것은 규칙에 집어넣어"_ (2026-10-30 → 전역 CLAUDE.md 「같은 종류의 과거 작업부터 연다」 + `docs/chart-guide.md` §7 0번)

**비자명한 사실 (재조사 금지)**:

- 연도는 **데이터 앵커**(생산·수출 최신월 중 이른 쪽)로 정해 차트에 `year` 로 넘긴다 — 중국 엑셀은 한 달 넘게 늦어 `currentYear()` 를 쓰면 1~2월에 빈 화면·화면끼리 다른 해
- 승용차 엑셀은 받을 때마다 zip 안 시각이 바뀌어 md5 가 늘 다르다 → 읽은 행으로 비교. 303 리다이렉트에서 `requests` 가 Cookie 헤더를 떼므로 손으로 따라가되 MarkLines 밖으로는 안 간다
- 브랜드 「MG (2006-)」 꼬리를 떼고 재적재(키 10~14% 변경 → 이 한 번만 보호 비율 20%) · DB 꼬리 0건 확인
- 지울 키는 upsert **앞에서** 판정, 기존의 5% 초과면 아무것도 안 쓰고 멈춘다(`STALE_ABORT_RATIO`) · 파서 규칙만 바꾸면 파일이 같아 재적재 안 됨 → 로컬 `import_oem_china.py` 또는 Actions 캐시 삭제
- C: 가 100%(1.1GB) 찬 상태에서 dev 서버를 재기동한 뒤 `.next/dev/types/routes.d.ts` 꼬리가 중복돼 typecheck 실패 → 사용자 승인으로 `.next`(약 4GB) 삭제 + `npx next typegen` 으로 복구(`docs/gotchas-playwright-ui.md`). 다음 dev 첫 기동은 캐시가 없어 느리다
- 회사 탭 Inner 16곳의 `fmtUnitsTick` 은 1,000만 이상을 10배 작게 찍는다 — KG Inner 만 고쳤다(목록 = `docs/chart-guide.md` §3)

**재개 지점**:

1. GHA `sync-oem-china-excel.yml` 첫 스케줄 실행(다음 월요일 10:20 KST) 결과 확인 — `MARKLINES_COOKIE` 만료면 종료 코드 1
2. 고치지 않고 보고만 한 것: 교차 검증이 경고만 냄 · NEV 실패가 다른 파일 동기화도 멈춤 · 음수 내수·빈 달 표시 · 수출 정지가 생산 화면도 멈춤 · 단위 표기 혼재
3. 프로덕션 화면은 사용자 눈 확인 전(로컬 dev 헤드리스로만 확인)

**검증**: `npm run check-all` EXIT 0(시험 531 · 중국 집계 48) · pytest 28 · `verify_revalidate_tags.py` EXIT 0 · 헤드리스(중국 카드 14 · 콘솔 오류 0 · 「전체」 「OEM」·KG 「내수/수출 분리」·우즈베키스탄 「브랜드/회사」 그대로)

## 이전 상태 · 재개 지점 (2026-10-29, **자체 조사 보고서 「IATF 16949와 VDA 완전 해설」 게시 — 리포트 146**)

> 이 세션의 관통 주제: 원문 없는 «자체 조사» 보고서라 근거 표시가 품질을 갈랐다 — 초안 v1 은 필자 지식과 조사 자료를 구분 없이 확정형으로 썼고, 검토 7개 관점이 낸 69건 중 66건을 반영했다.

**결과**: `/reports/146`(카테고리 「품질」 — 새 카테고리, 한 편짜리 카테고리가 이미 있어 문제없음) · 표 16 · Mermaid 4 · 약 3.2만 자 · 프로덕션 무효화 200. 원고·처리표·게시/갱신 스크립트는 `scripts/_iatf_vda_*`(gitignore).

**사용자 지시**: _"보고서 페이지에 아래 주제에 대한 내용 조사해서 보고서 게시해. * 자동차 품질 관련 국제 표준인 IATF16949와 VDA에 대해 상세 분석. * 2개 국제 표준의 비교도 필요하지만, 각각을 초심자도 이해할 수 있도록 자세히 설명해줘."_

**비자명한 사실 (재조사 금지)**:

- 검토 순서 = 조사(research-pplx·Parallel) → 오퍼스 초안 → 오퍼스 검토자 5명 + Codex 사실 대조(조사 자료 5개만 읽힘) → 전면 재작성 → 냉독(요약·들어가며·핵심 정리만) → 검사기 3종 → 게시 → 로컬 dev 렌더 점검. 처리표 = `scripts/_iatf_vda_review.md`(58+11행 · 원인 묶음 4개 → 교정 원장 4줄)
- 가장 큰 오류는 셈이었다: 「IATF 2판 전환 약 2년, 예전보다 짧다」 → 직전 전환은 약 23개월, 이번은 2027년 6~8월 발행 가정 시 약 26~28개월(3명 일치)
- VDA 6.3 강등 규칙은 자료끼리 다르다(교육 자료: 아무 0점 → B · QMbench: 아무 0점 → C) → 본문은 「2016년판 교육 자료 기준 · 현행판 확인 필요」
- 프로덕션 `/reports/*` 는 로그인 필수 — 에이전트는 운영 사이트에 로그인하지 않는다. 렌더 점검은 로컬 dev(3001, `.claude/launch.json`)에서 `.env.local` 계정을 스크립트가 읽어(출력 안 함) 했다
- 가로 Mermaid(노드 9개)는 880×50px 로 줄어 읽을 수 없었다 → TB 로 바꿔 UPDATE(규칙 = `report.md` §6)
- UPDATE 뒤 첫 요청은 옛 본문(`revalidateTag(t,'max')`) → 운영에서 처음 열 때 옛 가로 도식이 한 번 보일 수 있다(`report.md` §2-B)

**재개 지점**:

1. 미확인으로 남긴 4건 — 현대·기아의 IATF 16949 요구 여부 · 부적합 시정조치 기한 일수 · MLA 3판의 관문 이름·규칙 · 2판 전환 심사에 90일 확정 규칙 적용 여부. 확인되면 `scripts/_iatf_vda_update.ts`(id+title 일치 행만 UPDATE)로 고친다
2. 프로덕션 화면은 사용자 눈 확인 전(로컬 dev 로만 확인)

**검증**: `npm run check-all` EXIT 0(시험 483) · `verify_report_krw.py`·`verify_translationese.py` EXIT 0 · 렌더 점검(raw 별표 0 · 표 16/16 · Mermaid 4/4 · 실패 0 · 1280/390px 가로 넘침 없음)

## 이전 상태 · 재개 지점 (2026-10-27, **유튜브 보고서 8편 게시 — Codex·오퍼스 비교 후 「오퍼스 초안+Codex 점검」**)

> 이 세션의 관통 주제: 받은 영상 목록에 «이미 게시된 영상»이 섞여 있는지 착수 전에 안 봐서, 끝까지 작업한 뒤 9월 리포트 132 를 덮어썼다 — 이제 착수(`fetch_subs.py`)·게시(`publish.ts`) 두 곳에서 기계가 막는다.

**결과**: 8편 게시 — v1 139 · v2 140 · v3 141 · v4 142 · v5 **132(덮어씀)** · v6 143 · v7 144 · v8 145 · 그림 133장 · 운영 캐시 무효화 · `verify.py` 8편 ALL_OK(깨짐 0 · 받는 중 0). 작업 폴더 `scripts/_yt_report/2026-10-27/`(gitignore · 비교 원장 `compare/결과.md` · 정답지 8편).

**사용자 결정**:

- 비교(표본 3편 · 눈가림 채점) 뒤 작업 방식 = 「오퍼스 초안+Codex 점검」 — 결과 `~/.claude/docs/codex-vs-opus.md` §1·§3 · 경위 `docs/history/codex-vs-opus-경위.md` §9·§9-1
- _"지식노트 작업처럼 작업하면서 계속 작업방식을 개선해. 규칙이나 코드로 막을 수 있는건 막고"_
- _"앞으로는 이미 올라간 영상인지 확인하고 작업하도록 해"_ → `fetch_subs.py` 가 자막 받기 전에 멈춘다

**비자명한 사실 (재조사 금지)**:

- 그림 자리는 자막으로 못 맞힌다(적중 29~40%) → `scan.py` 접촉 시트로 정답지 → `capture.py --exact` · `settle.py` 권장 시각을 되풀이 채택하면 전환 효과로 끌려간다(정본 `docs/report-from-youtube.md` §2-F)
- 자막 고유명사 오기는 그림 속 글자로 바로잡는다(한 회차 6건 · §2-G)
- `verify.py` 「깨짐」이 나오면 먼저 URL 을 `curl -I` — 지연 로딩 그림을 깨짐으로 세던 검사기 결함을 고쳤다(§2-I)
- 덮어쓰기를 의도할 땐 `YT_ALLOW_UPDATE=<key,…>|all` (착수·게시 두 단계 같은 변수)

**재개 지점**:

1. ~~리포트 132 옛 판 처리 — 사용자 결정 대기~~ → ✅ 2026-10-28 사용자 결정 _"리포트 132 새 버전 유지해"_ — 새 판(2026-10-27) 그대로 · 옛 판 복구 안 함. 9월 원고는 `scripts/_yt_report/2026-09-11/` 에 남아 있다.
2. ~~`scripts/_yt_report/2026-10-27/video/`(274MB) 정리 여부~~ → ✅ 2026-10-28 _"원본 영상 폴더 지워"_ — mp4 8개 삭제. 캡처·접촉 시트(`png/`·`scan/`·`sheets/`)는 남아 있어 다시 뜨려면 영상만 새로 받으면 된다.
3. `~/.claude` `skills/weekly-review/SKILL.md` 상한 초과(280B)는 다른 세션 몫 — 주간 정리
4. ✅ 2026-10-28 사용자 질문 _"오퍼스랑 코덱스 차이점도 업데이트 했어? 작업 방식 개선을 위한 코드나 규칙도 업데이트 하고?"_ — 비교 문서는 반영돼 있었으나 **절차서에 역할 분담이 없고 작성·점검 지시서가 gitignore 작업 폴더에만** 있었다 → `scripts/yt_report/prompts/`(write·check) · README 3단계 재작성 · `verify_yt_report.py` 검사 10(편마다 `check/(codex|opus)_<key>.md` 300B 이상 · 없으면 게시 게이트가 막는다 · 이번 회차 통과 / 9월 회차 5편 전부 걸림 / 빈 파일 걸림)

**이 회차에 남은 일 없음.**

**검증**:

- `npm run check-all` EXIT=0(시험 파일 28 / 시험 483) · `verify_docs.py` 오류 0 · 게시 전 `verify_yt_report.py` 오류 0(경고 2 = 눈으로 확정) · 번역투 8편 0 · 원화 병기 8편 OK
- 가드 시험 — `publish.ts` 실제 배치로 8편 전부 멈춤(쓰기 0) · `fetch_subs.py` ① 실제 목록 8편 멈춤 ② 없는 ID 통과 ③ `YT_ALLOW_UPDATE=v5` 면 v5 만 빠짐
