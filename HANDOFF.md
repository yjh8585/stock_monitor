# HANDOFF

다음 세션이 그대로 이어받기 위한 인수인계 기록. **맨 위가 최신**이고, 새 블록을 쓸 때
직전 블록은 `## 이전 상태 …` 로 강등한다.

**여기엔 최근 10블록만 둔다.** 그보다 오래된 블록은 지우지 않고
[`docs/handoff-archive-2026.md`](./docs/handoff-archive-2026.md)(현재 **41블록** · 2026-11-13 실측)로 옮긴다.

---

## 최신 상태 · 재개 지점 (2026-11-13, **고객사 수정 회차 D — 속도(sin1·나눠 그리기)·VW 지역 코드 파서·쪽 5장·핵심 구절 강조 — 푸시·배포 끝 · sin1 확인**)

> 사용자 지시(원문 = `docs/plans/2026-11-11-customers-page-revisions_최초지시.md` 「추가 지시 (2026-11-13)」): 고객사 페이지가 느리다 · 폭스바겐 지역·차종·점유율이 안 모인다(「데이터는 다 있어」) · 쪽 캡처 3→5 · 요약·뉴스의 중요한 부분 강조. 선택 4건 전부 추천안(결정이행 「수정 회차 D」). **API 0**(기존 자료 채우기는 코드·이 세션·서브에이전트).

**결과**:

- 속도: Vercel 함수 지역 `sin1`(`vercel.json` · Supabase 싱가포르와 같은 곳 — 그전 iad1 이라 조회마다 태평양 왕복) · 상세·IR 조회 겹쳐 돌리기 · 고객사 캐시에서 `companies` 태그 제거(평일 매시간 주가 수집이 캐시를 통째로 비웠다) · 「지역·차종·점유율」 절을 Suspense 로 떼어 국내 3사 OEM 자료가 나머지를 막지 않게.
- 폭스바겐: 분기 인도 보도자료(`sales_release` · 요약 대상 밖)를 코드 파서로(`breakdown.CODE_ONLY_TYPES`) — 4편 322행 verified · 권역 7 + 브랜드그룹·브랜드 · 24Q4~26Q3 + 연간·누계. 표 없는 1510 은 건너뜀.
- 쪽 캡처 `MAX_PAGES` 3→5 + `--fill-pages`(기존 요약에 C 재료 쪽을 더함) — 51건에 101장.
- 강조: 지시문(`PROMPT_VERSION` b2) + 검사기(깨진 꼴은 «고침» = 기호만 지움) + 화면 `SummaryLine`(굵게+노란 음영). 기존 264건(문서·뉴스)은 서브에이전트 5명이 표시 → 기호를 빼면 원문과 같은지 기계 대조 뒤 적재.

**🔴 재개 지점**:

1. 푸시(`b9892f1`)·Vercel 배포 성공 · 함수 지역 `sin1` 확인 끝(2026-11-13 — 동적 라우트 `x-vercel-id` 둘째 칸 · `curl -sI -X POST <프로덕션>/api/revalidate` 는 401 이어도 헤더가 온다).
2. 프로덕션 눈 확인(사용자 몫 · 로그인 필요): 폭스바겐 「지역·차종·점유율」 분기·연간 · 요약 강조 · 쪽 5장 · 국내 3사 페이지의 첫 화면 속도.
3. 앞 블록의 「첫 정기 실행 확인」은 그대로 남아 있다.

**🔴 이번에 배운 것**:

- dev 서버에서 쪽 캡처 프록시가 HTML 404 를 냈다 — DB 키·Storage 파일·라우트 코드 모두 정상이었고, 라우트 파일을 한 번 고쳐 재컴파일하자 200. Turbopack 라우트 컴파일 캐시 함정(`docs/gotchas-playwright-ui.md`)이다. **라우트 JSON 404 인지 Next HTML 404 인지 본문부터** 본다.
- 세로축 「650 · 130만」 단위 섞임(기존 축 서식 · 값은 맞음) — 범위 밖이라 안 고쳤다.

**검토**(Codex + 오퍼스 따로) 반영·기각 = 결정이행 「회차 D 검토」.

**검증**: `check-all` 0(시험 739) · Python 시험 123 · `verify_*` 3종 0 · dev 화면 3사(별표 노출 0 · 쪽 캡처 200).

---

## 이전 상태 · 재개 지점 (2026-11-12 낮, **고객사 — 누계(YTD)·호버 YoY·VW 1분기 수정 + 남은 일 ①~④(큰 PDF 요약·차종 모드 물량) — 푸시**)

> 이 세션의 관통 주제: 사용자 「남은 일 이어서 해 · 지역·차종·점유율 차트에서 올해 YTD 가 작성 가능하면 모두 · 폭스바겐은 왜 최근 2개년도의 Q1 만 있지 · 호버 시 YoY」. API 0(요약은 이 세션이 직접 읽고 `--from-json` 으로 저장).

**결과**: `0bab4f6`(YTD·호버 YoY·VW 기간 고르기) + 이번 커밋(Codex 지적 반영 · 차종 모드 · 큰 PDF).

- VW 원인: 25Q1·26Q1 두 점을 「분기 계열」로 셌다 → 분기 계열은 서로 다른 분기 번호가 2개 이상일 때만.
- 현대 문서 1274 요약 없음 원인: 글자 243자(가이던스 표) < `MIN_CHARS` 300 — 의도된 건너뜀.
- 모비스 2026 문서엔 「한국」 행이 없어 전체 YoY 를 숨긴다(정상).
- 리비안 큰 문서 4편(1845·1846·1847·1851) 요약 저장 · 1854(AI Day)는 글자층 없는 이미지 PDF라 검사기 아래에선 요약 불가(내용은 1851 6~7쪽에 있다).
- 50MB 넘는 `.pdf` → 임시 파일(600MB 상한)로 받아 글자층을 읽는다(`ir_get_to_file`·`summary_source`).
- 차종 모드: `customer_accounts.marklines_models text[]`(20261112000002 · DB 적용 끝). 차면 물량 = 그 차종 합 + 차종별 분기 생산·판매 표.

**🔴 재개 지점**:

1. ✅ **리비안 행 UPDATE 끝**(2026-11-12 `5d15086` Vercel success 뒤 · 1행 · 프로덕션 `customer_accounts` 무효화 200). 다른 묶음 그룹 회사를 차종 모드로 돌릴 때도 같은 순서다: 새 코드가 배포되기 «전»에 `marklines_group` 을 넣으면 옛 코드가 묶음 그룹(`Small and Medium OEM`) 전체를 그린다.
   `update customer_accounts set marklines_group='Small and Medium OEM', marklines_models=array['R1S','R1T','Rivian EDV','Rivian EDV 500','Rivian EDV 500/700','Rivian R2'] where company_id=(select id from companies where ticker='RIVN');`
   → 프로덕션 `/api/revalidate` 로 `customer_accounts` 태그 무효화. 차종명 6개는 2026-11-12 DB 에서 철자 확인(EDV 500 계열은 판매 표에만 · 생산 표는 「Rivian EDV」 하나).
2. 프로덕션 눈 확인(사용자 몫 · 로그인 필요): 리비안 물량 절 「MarkLines 차종 합 판매」 차트 + 차종별 분기 표(행 클릭 노란 강조) · 지역·차종·점유율 연간 보기 맨 오른쪽 YTD 막대 · 호버에 YoY · VW 분기 보기.
3. 앞 블록의 「첫 정기 실행 확인」은 그대로 남아 있다.

**🔴 이번에 배운 것**:

- MarkLines 차종 나눔은 추정이다 — 리비안은 차종 합이 회사 발표 인도와 가깝지만 R2 는 판매 < 생산, EDV 는 판매가 튄다. 그래서 표 설명에 「신차는 생산 쪽을 먼저 본다」를 박았다.
- 생산 표는 판매 표보다 한 달 늦게 들어온다 → 분기 칸은 갈래별로 석 달이 다 찼을 때만.
- scratchpad 에 `q3_26.pdf` 171MB 를 남겼다(지울지 사용자에게 물었다).

**Codex diff 검토(2회차 · 차종 모드·큰 PDF) 5건 전부 반영**: ① 판매 0행이어도 생산 표는 그린다 ② 차종 합의 빈 달을 0 으로 채움(적재기가 0대 행을 안 남겨 연간 YoY 와 KPI 가 갈렸다) ③ `--from-json` 은 DOC_SCHEMA 필수 칸·중요도 값·모르는 칸을 먼저 막는다 ④ 판매·생산 어느 표에도 없는 차종명은 화면에 경고 ⑤ 수동 모델명 시험이 상수를 베끼지 않게.

**검증**: `npm run check-all` exit 0(시험 736) · Python 시험 36 · `verify_call_contracts` 0 · `verify_docs` 오류 0.

## 이전 상태 · 재개 지점 (2026-11-12 오전, **고객사 페이지 수정 회차 C(지역·차종·점유율) 끝 + 화면 추가 요청 3건 — 푸시·배포**)

> 이 세션의 관통 주제: 계획서 `docs/plans/2026-11-11-customers-page-revisions.md` 의 C 절(C1~C10 · Task C-1~C-7). 사용자 지시 「Api 사용하지 마 이제. 직접 해」로 소급 값 뽑기·구현은 이 세션이 직접(API 0) · 검토는 Codex + 오퍼스 검토자 따로. 끝에 화면 추가 요청 3건(원문 = `_최초지시.md` 「추가 지시 (2026-11-12 · C 마무리 중)」).

**결과**: C 계획·C-1(표)·C-2(검사·적재·소급 CLI)·C-3(코드 파서)·C-4(정기 API 읽기)·C-6·C-7(화면·GHA 「분해」 step·문서) · 화면 추가 3건(연간 YTD · 막대/선 영역 분리 · 표 행 강조) — 푸시 `4bcf668`(백업 봇 커밋 위로 rebase).

**🔴 재개 지점**:

1. **프로덕션 화면 눈 확인은 사용자 몫으로 남았다** — 로그인이 필요한 화면이라 에이전트가 프로덕션에 비밀번호를 넣지 않는다(안전 규칙 · 사용자 허락으로도 안 됨). 에이전트는 배포 상태·보호 경로·축 계산만 확인했다. 확인 목록: (가) 실적 차트 「연간」에 맨 오른쪽 「2026 YTD(1~n분기)」 막대 (나) 막대는 아래·선은 위로 갈라져 숫자가 안 겹치나(gm) (다) 표 행 클릭 → 노란 음영 · 다시 클릭 → 해제(요약·실적·물량·구성비·국내 3사 차종 표) (라) 「지역·차종·점유율」 절(gm 인도 「(세분)」 차트 · volkswagen · stellantis · mobis · polaris · vinfast · 국내 3사는 OEM 차트 + 점유율).
2. **첫 정기 실행 확인(미확인)** — `collect-customer-docs.yml` 의 「요약」·「분해」 step(평일 08:00 KST) · `summarize-customer-news.yml`(월 06:00). 「분해」는 `--api` 첫 실호출이다(사용자 「정기 수집부터 api가 하고」). `::warning::` 「상위 합계 의심」이 뜨면 그 문서 하위 행을 `_detail` 로 다시 적재.
3. 포르쉐 「분기 전체」 제안(사용자 답 없음) — 묻지 않고 두었다.

**사용자 결정 (2026-11-12)**: 지역 탭은 `customer_volume_ir` 지역 행을 되풀이 안 함(물량 절에만) · C: 0MB 사고 뒤 dev 촬영 건너뜀 → 배포 뒤 프로덕션 점검(「개발서버로 하지말고」) · 계획 파일 새로 만들지 않음.

**🔴 이번에 배운 것**:

- GM 8-K 는 「Total North America」 와 그 안의 United States·Other 를 함께 싣는다 — 같은 metric 이면 차트가 2배로 쌓인다. 하위는 `<metric>_detail`. 자동 판별기는 계층 없는 모비스 지역 매출에서 우연한 합 일치 5행을 잡아 «경고만» 둔다(`suspect_parent_sums`).
- 이름 앞부분만 겹치는 형제(「VF 8」·「VF 8 Plus」)가 있다 — 하위 라벨 제거는 하위 합 ≤ 상위 값일 때만.
- 서버 컴포넌트 표에 행 강조를 붙일 땐 표 전체를 `'use client'` 로 바꾸지 말고 행만(`components/customers/HighlightRow.tsx`) — 사외비 칸이 RSC payload 로 실린다.
- 고객사 실적 차트는 `splitBands` 로 §4-F 영역 분리. OEM 현대 탭은 그대로(같은 부품 · 기본 false) — §4-F 위반이 남아 있다.
- C: 가 0MB 까지 찼다(dev 촬영 중 · `.next` 3.2GB). 촬영·check-all 전 `df -h /c`.
- GHA 상태 API(`gh api repos/<repo>/commits/<sha>/statuses`)로 Vercel 빌드 결과를 볼 수 있다 — Vercel MCP 가 없는 세션의 대안.

**검증**: `npm run check-all` exit 0(시험 717) · Python 시험 38 통과 · `verify_docs.py` 오류 0 · Vercel 빌드 success(`4bcf668` Production 배포) · 프로덕션 `/login` 200 · `/customers/gm` 307 → `/login?next=…`(보호 경로 정상).

## 이전 상태 · 재개 지점 (2026-11-12 새벽, **고객사 페이지 수정 회차 B(문서·뉴스 요약) 끝 — 소급 완료 · GHA 적용(사용자 승인) · 푸시**)

> 이 세션의 관통 주제: 계획서 `docs/plans/2026-11-11-customers-page-revisions.md` 의 B 절(B1~B9 확정 → B-1~B-9 작업). 구현은 API 헤드리스(오퍼스 5.5 · effort high · API 키 과금 — 사용자 지시 「사용량 없으니깐 api 활용하고 나 잘거니까 쭉 진행해」), 검토는 Codex 2회, 메인은 중계·검산·직접 수정 1건.

**결과**: `fd53521`(표 2·비공개 버킷) · `ad9bfeb`(지시서·검사기) · `e84d694`(문서 요약기·쪽 캡처) · `b83261a`(뉴스 주간 요약기) · `e547809`(받기 경고 갈래) · `1a33236`(캡처 인증 프록시) · `42c98e3`(조회·캐시 태그) · `cc71c83`(화면 3곳) · 수정 회차 `ec77e65`·`d0519fe`·`b8125d4`·`9029d25`·`45424dc`·`d784d36`·`afd59ec` · 문서 `e6d9b98`.

**🔴 재개 지점**:

1. **B 는 남은 일 없음** — B-5 GHA(`collect-customer-docs.yml` 「요약」 step · 새 `summarize-customer-news.yml`)는 사용자 승인(2026-11-12 「둘 다 적용」) 뒤 적용 · 푸시(사용자 선택 「지금 푸시」). 첫 정기 실행(평일 08:00 · 뉴스는 월 06:00 KST)에서 「요약」 step 과 뉴스 워크플로가 초록인지 본다 — 미확인.
2. **C 묶음**(지역별·차종별·점유율 수집)은 grill-me 로 시작 — 출발점 = 계획서 C 절의 「C 재료」 표.

**사용자 결정 (2026-11-11 밤 · 결정이행 반영)**: 뉴스 소급 = 남은 완결 주(약 9~10주)만 · 보존 연장 안 함 / 추정 50달러 이하면 묻지 않고 소급 / effort high.

**소급 실측 (재조사 금지)** — 문서 ok 176 · 검사 실패 1 · 쪽 key 누락 0 / 뉴스 ok 82 · 검사 실패 1(VW 2026-10-19 주) · empty 5(포르쉐 — 뉴스 60일 17건뿐) · 비용 약 25 USD(+실측 약 1). 검사기 오탐 17건은 고친 뒤 `--recheck`(API 0)로 16건 살렸다. 리비안 주주서한 5건은 50MB 받기 상한으로 요약 없음. 함정 4건 = `docs/customers-collection.md` 「요약(B) 함정」.

**🔴 이번에 배운 것**:

- `doc_text.Content.tables` 는 세 겹 — 표 없는 PDF 로만 시험하면 안 걸린다. 비용 실측(진짜 원문 여러 종류)에서 처음 드러났다.
- Architecture.md 가 상한을 넘었다(153KB / 151KB) — 새 표 설명은 도메인 문서로 보내고 Architecture 엔 한 줄 + 링크(고객사 표 7종이 이미 그 꼴이었다).
- 파일 이름에 `*` 를 넣은 명령(`…revisions*.md`)은 계획서 훅이 «새 계획서»로 오인해 막는다 — 파일을 하나씩 적는다.

**검증**: Python 시험 284 통과 · `npm run check-all` exit 0 · `verify_revalidate_tags.py` exit 0 · `verify_docs.py` 오류 0.

## 이전 상태 · 재개 지점 (2026-11-11, **고객사 IR 확장 계획 전부 끝 — Task 1~13 · 최종 검토 · 2년 백필 · 푸시 완료**)

> 이 세션의 관통 주제: IR 확장 계획서(`docs/plans/2026-11-10-customers-ir-expansion.md`)의 Task 9·10·13·11 → 최종 검토(Codex) → Task 12(2년 백필·다시 처리·화면 확인)를 끝냈다. 도중에 사용자 지시 「이제 더이상 api 쓰지말고 직접 해」로 **구현은 메인 직접 · 검토는 Codex** 로 돌아왔다.

**결과**: Task 9 `4c32bbe`~`ff288d3` · Task 10 `0bbe93c`~`e2df5a6` · Task 13 `43c7a7c`·`ea2e896` · Task 11 `4f5428f` · E9·E10 `58b8a80`·`50a54f8`·`750f382` · 최종 검토 반영 `79250ca` · Task 12 포르쉐 옛 서식 `6ac2060`. 결정 이행 E3·E6 = 그대로(`_결정이행.md` 상세에 실측).

**🔴 재개 지점**: 계획·푸시·GHA 확인까지 끝 — 남은 일 없음. SDD 원장(`.superpowers/sdd/2026-11-10-customers-ir-expansion/progress.md` · gitignore)은 `Task 12: complete`.

**사용자 결정 (2026-11-11)**: E9 VW 중국 인도 = 분기 표 위에 «중국 작은 차트» · E10 합작사 영업이익 몫 = 실적 칸 한 줄 · 「수집기 LLM은 허용」(Task 12 의 LLM 호출) · 「이제 더이상 api 쓰지말고 직접 해」(헤드리스 API 구현자 중단).

**Task 12 실측 (재조사 금지)** — 건수·행 수 전후 = `_결정이행.md` 상세 E3·E6 · 함정·한계·비용 = `docs/customers-collection.md`(정기 실행 줄 · 약속 절 · 수집 함정 절):

- 기아 2건은 원 출처 404 라 `--close`(2408·2409). 포르쉐 옛 판 4건 failed → `6ac2060`.
- 🔴 `--reparse` 한 1740 이 `not_target` 이라 옛 345 행이 남아 손으로 지웠다(정기 실행은 해당 없음).
- 방향 빈 검증 행 = VW FY2025 `revenue_growth` 2행(글 전망 · 설계대로).
- LLM 이번 32회 ≈ $0.90 · GHA 정기 실행 추정 연 약 $0.6(러너 0원).

**푸시 전 결정 — 사용자 선택 2026-11-11**: 지금 푸시 · 빈패스트 `sig=` 값이 `da1260f` 히스토리에 남은 것은 그대로(만료 2026-11-10 04:00 UTC) · 수집 주기 유지 · GM 빈 목록 허용 = 1월 한 달(`GM_FIRST_SALES_BY = (2, 1)`).

- **푸시 완료**(`6c72157` · 백업 봇 스냅샷은 병합으로 수용 — 리베이스하면 문서가 가리키는 커밋 번호가 바뀐다) · Vercel success.
- GHA GM 러너 확인 = 실행 42963234533(`probe_gm_ir`): Chrome 156 · IR 문서 14 · 11 job success → D1 「사용자 PC」 불필요.

**검증**: 마무리 시점 `pytest scripts/lib` 901 통과·3 건너뜀 · 포르쉐 자가 시험 0건 실패 · `npm run check-all` 통과(vitest 640 · exit 0).

## 이전 상태 · 재개 지점 (2026-11-11, **고객사 IR 확장 계획 실행 중 — Task 1~8 완료 · 다음 Task 9 · 미푸시**)

> 이 세션의 관통 주제: IR 확장 계획서(`docs/plans/2026-11-10-customers-ir-expansion.md` · Task 1~13 · 결정 기록 `_결정이행.md` D1~D9·E1~E8)를 SDD 로 이어 실행. 구독 한도가 12% 로 떨어져 사용자 지시로 **구현자 = API 키 과금 헤드리스 · 검토자 = Codex** 로 바꿨다. 컴팩트 전 정리.

**결과**: Task 4 `da1260f`·`98302a7` · Task 5 `f9d2ae9`·`288d6fa` · Task 6 `d978770`·`2683f21` · Task 7 `51e5f70`·`b452cfc`·`83f238b` · Task 8 `5116661`·`5cd9717`·`a2c48ec`·`9f54546` · 결정 E7 `64b92db`. **푸시 안 함.**

**🔴 재개 지점**: SDD 원장 `.superpowers/sdd/2026-11-10-customers-ir-expansion/progress.md`(gitignore) 맨 끝. 다음 = **Task 9**(지시문 준비됨 · `scratchpad` 는 세션과 함께 사라지므로 아래 «실행 방식»대로 다시 만든다) → 10 → 13 → 11 → 최종 검토 → Task 12.

- Task 10 에 **더할 항목**(원장 「Task 5 걱정 ④」): LLM 이 어휘에 없는 지표(총주주환원율 35%+)를 `free_cash_flow` 로 실어 `verified=true` 가 됐다(`customer_guidance` id 345 · 문서 1740 · 현대 CID). 지시문(`llm_guidance.py` 「맞는 지표가 없으면 만들지 않는다」)은 이미 있어 코드 가드(라벨↔지표 정합)가 필요 → 고친 뒤 `--reparse 1740` 으로 행 345 가 사라지는지.
- Task 11 에 **더할 항목**: `docs/customers-collection.md` 의 「GM IR 차단·어댑터 없음」 서술(38·74행)을 Task 8 결과로 고친다 · `porsche.py:48` 인도 정의 문구(Task 3 이월).

**실행 방식(사용자 지시 2026-11-11 「한도가 12% … codex나 앤트로픽 api 쓸 수 있는 것은 써봐. api도 같은 모델과 같은 effort 사용하고」)**:

- 구현자 = `ANTHROPIC_API_KEY=<루트 .env.local 의 값> claude -p --model claude-opus-5-5 --effort high --permission-mode bypassPermissions --output-format stream-json --verbose < 지시문.md > 로그.jsonl`(레포 루트에서 · 키를 출력하지 않는다). 로그의 init 줄 `apiKeySource=ANTHROPIC_API_KEY` 로 API 과금을 확인. 수정 회차는 `--resume <session_id>`(로그 result 줄). 비용 실측: Task 7 첫 구현 $5.99 · Task 8 $7.53 · 수정 회차는 이어받기라 누적이 크다($9~13).
- 지시문 = SDD `implementer-prompt.md` 틀 + 브리프 경로(`scripts/task-brief <plan> N`) + 이 계획의 제약(공개 레포 · 커밋 규칙 · DB 쓰기 금지 · 남의 미커밋 파일 · `참고/` 금지) + 보고서 경로. HANDOFF.md 는 구현자가 고치지 않는다(「HANDOFF 에 넣을 것」 절로 보고).
- 검토·재검토 = Codex(`python -X utf8 ~/.claude/scripts/codex_run.py run <지시문> <결과> --cwd <레포> --tag diff-review`) · 지시문은 SDD `task-reviewer-prompt.md`·`re-review-prompt.md` 를 한국어로 옮긴 것 · 읽기 전용 · `참고/` 금지.
- 같은 파일을 고치는 두 구현자를 동시에 돌리지 않는다(`--only` 커밋에 남의 hunk 가 섞인다) — 검토(읽기 전용)와 다음 구현은 겹쳐도 된다.

**사용자 결정 (2026-11-11)**: E7 모비스 Script 목표 문장 없음 = «서식 미인식» 경고(상태는 not_target + note · 2단계 P4 와 같은 방식) · E8 KGM CEO IR설명회·Pressday = 날짜 없음 유지(행사일은 공시 본문에만 · 3단계로).

**비자명한 사실 (재조사 금지)**:

- 현대 CID 목록에 행사일 칸이 없다 → 같은 사이트 `pastIrEvent.list.do` 로 붙임(2019 는 CID 두 번이라 날짜 없음). 모비스 영문 Script 링크엔 `fileNm` 이 없어 키 = 분기 이름.
- D6 실측: 현대 CID 25,957자 · 기아 CID 56,237자 — 둘 다 12만 자 상한 안(잘림 없음). 현대 CID LLM 1회 = 입력 25,690 · 출력 113 토큰, 행 1개(위 오분류 행).
- KGM 은 분기 실적 공시와 월 판매 공시의 제목·종류가 같다 → 정정공시의 원공시는 «IR 실적 발표일과 같은 날 낸 같은 제목 공시»로만 확인, 아니면 날짜 없음(Task 7).
- 포르쉐 EQS 피드는 XML 이 아니라 JSON. 일정만 403 이면 수집 상태를 blocked 로 올린다(Task 6).
- GM: 이 PC 에서 실제 Chrome(CDP)로 페이지·PDF 전부 200 · 드라이런 새 문서 14(덱 5·서한 5·Deliveries 4) · 일정 2. Chrome 받기 URL 당 120초 상한(`CHROME_URL_TIMEOUT_S`).
- 고친 결정 기록: `_결정이행.md` E8 줄은 이 마무리 커밋에 들어갔다.

**푸시 전 사용자 확인 항목(누적)**:

- 빈패스트 픽스처에 들어갔던 실제 서명(`sig=`) 값이 `da1260f` 히스토리에 남아 있다(만료 1794283200 · 푸시하면 공개) — 커밋 합치기 여부.
- GHA 매일 실행의 GM 문서 목록이 러너의 Chrome 에 기댄다 — 러너에 Chrome 이 없으면 GM 행이 매일 `error`(사유 「Chrome 없음」). 푸시 뒤 `probe_gm_ir` 수동 실행으로 확인 · 막히면 D1 「사용자 PC」 갈래.
- GM 올해 판매 목록의 빈 표식은 서울 기준 1월 1·2일만 허용(`GM_FIRST_SALES_BY`) — 첫 보도가 늦은 해엔 1월 3일~첫 보도일 GM 행이 error 로 뜬다(조용한 0건보다 시끄러운 실패 · 컨트롤러 판정 · E7 방향).
- 사용자 질문(2026-11-11 「분기별 실적이 나오는데 왜 매일 수집해?」)에 답함: 매일은 «새 문서 확인»만, AI 는 새 문서가 있는 날만 돈다(평일 08:00 KST · 공개 레포라 GHA 무료) — 주기를 줄일지 사용자 답 대기(줄이면 Task 11 에서 cron 한 줄).

**남은 사소 지적**: 원장의 `minor (deferred)` 줄(Task 1~8) — 최종 검토에서 가린다.

**검증**: 마무리 시점 `pytest scripts/lib` 873 통과·3 건너뜀(exit 0) · `npm run check-all` 통과(vitest 633 · exit 0).

## 이전 상태 · 재개 지점 (2026-11-11, **API 크레딧 일회성 작업 끝 — DB 반영·커밋 완료 · 미푸시(사용자 확인 대기)**)

> **이 작업에서 남은 코드 일은 없다.** 고객사 IR 확장(바로 아래 블록)은 다른 세션의 진행 중 작업이니 그쪽 재개 지점은 아래를 본다.
> 지시 원문·선택·판정 = [`docs/plans/2026-11-10-api-credit_최초지시.md`](./docs/plans/2026-11-10-api-credit_최초지시.md)

**끝난 것(DB 는 이미 운영에 반영 · 캐시 갱신 완료)**

- 증권사 리포트 미요약: 원인은 「작성 가치 없음」이 아니라 선별 점수 문턱(5점) 미달 — 내려받은 파일 정리, 밀린 4편 요약
- `enrich_customers_websearch.py`: 트리거가 `[{"name":..}]` 객체 배열만 읽는데 문자열 배열을 넘겨 조용히 `[]` 가 되던 버그 수정 · LLM 이 짐작한 고객사 3곳은 원래 값으로 되돌림
- Cox 딜러 재고일수 과거분 백필(46개월) · 2022-10 은 차급 차트라 제외 · 대소문자 표기 변형(`Nation`·`INFINITI`·`Mini`)을 `BRAND_ALIASES` 로 흡수(시험 70개 통과) · 함정 = `docs/gotchas-data-collection.md` 「Cox 과거분을 다시 읽을 때」
- 스텔란티스 화면 헤드리스 확인: 최근 24개월 재고 항목 23건 = Cox 21 + 수동 2(24.12·26.06, 수동 우선 설계대로) · 전부 업계 평균 붙음
- 휴머노이드 기업가치 4건 + 홀리데이 7,000억원(4.6714억 달러)·1X 기준일 2025-01-31 정정 · 애질리티 → 나스닥 AGLT 상장사 전환, 일봉 2026-11-05 부터만(그 전은 SPAC 시세)

**남은 것**

1. **푸시 안 함** — master 의 미푸시 커밋 67개(2026-11-11 실측) 대부분이 다른 세션의 고객사 작업(`da1260f` 등, 배포·유료 수집 시작이라 사용자 확인 대기)이라 함께 나간다. 사용자 확인 뒤 한 번에 푸시
2. 검증: `npm run check-all` exit 0(테스트 633개 · 2026-11-11) · `verify_docs.py` 오류 0 — 함정 문서가 상한을 넘어 08-13·08-14 Cox 경위와 이번 절 원문을 `docs/history/gotchas-data-collection-경위.md` 로 옮겼다
3. AGLT 는 정기 수집이 이어 받았다 — 일봉 11-05·06·09, 현재가 11-10 갱신(2026-11-11 확인)

## 이전 상태 · 재개 지점 (2026-11-10, **고객사 IR 확장 계획 실행 중 — Task 1~3 완료 · Task 4 수정 1회차 도중 중단 · 미푸시**)

> 이 세션의 관통 주제: 고객사 2단계 위에 얹는 IR 확장(계획서 `docs/plans/2026-11-10-customers-ir-expansion.md` · Task 1~13 · 결정 기록 `_결정이행.md` D1~D9·E1~E6)을 작업별 서브에이전트(SDD)로 실행. 사용자가 PC 를 꺼서 Task 4 수정 도중 멈췄다.

**결과**: 커밋 `888db50`(계획) · `dd6bd3a`(Codex 대조 반영) · `a13374c`(E6) · Task 1 `c7f386a` · Task 2 `559fd05`·`84ab2b7` · Task 3 `ea02611` · Task 4 `da1260f`(첫 구현 · 검토 「수정 필요」). **푸시 안 함**(원격보다 60여 커밋 앞섬).

**🔴 재개 지점**: SDD 원장 `.superpowers/sdd/2026-11-10-customers-ir-expansion/progress.md`(gitignore) 맨 끝부터. 지금은 `Task 4: fix round 1 dispatched`.

1. Task 4 수정 1회차는 **커밋됨 `98302a7`**(pytest 784 통과 · 마무리 직후 도착). 남은 것 = 그 수정의 범위 좁힌 재검토(`review-package <plan> da1260f 98302a7` → 재검토 프롬프트 = SDD 스킬 `re-review-prompt.md`) → 통과면 원장에 `Task 4: complete`. 수정 지시(재검토 대조용) = Important 1(`fetch_vinfast` PDF 받기 실패가 VFS 목록 전체를 죽임 → `TooLarge`·`requests.RequestException`·PDF 파싱 오류를 잡아 날짜만 비움 + 시험 2건) + Minor 5(`_RESULTS_LAG_DAYS` 100→120 · `edgar_quarter_dates` docstring 한 줄 · `parse_vinfast_event` 날짜 ValueError → None · 픽스처 `sig=` 값 가림 · PDF 만든 날 SHORTCUT 주석). 이어받는 법: 변경을 읽어 지시와 맞는지 보고, 모자라면 새 구현자에게 브리프(`task-4-brief.md`)·보고서(`task-4-report.md`)·이 지시를 주고 끝내게 한 뒤 → 커밋 → 범위 좁힌 재검토(`review-package <plan> da1260f HEAD`).
2. 그다음 Task 5 → 6 → 7 → 8 → 9 → 10 → 13 → 11 → 최종 검토(Opus 검토 + Codex diff 검토 따로) → Task 12(메인 직접 · Step 0 = `collect_customer_docs.py --backfill` 본 적재 + 숫자 수집 본 실행 · LLM 아끼지 않음).

**사용자 지시·선택 (2026-11-10 · 원문 = `참고/고객사/2026-11-09-customers-page_최초지시.md` 끝 세 절)**: 폭스바겐 중국 동향 = 숫자+문서 목록(Task 13) · 노사 갈등·파업 = 별도 계획서의 새 기능(E5) · 「코덱스 한도 다 차면 재설정해서 사용량 복구할 거니까 코덱스 사용해」(게이트에 걸려도 Codex 를 쓴다 — 메모리 `feedback_use_codex_despite_gate`) · 「프로모션 API 크레딧 … 과거~최신 자료 등 찾거나 정리할 때 지금 최대한 써」 → 과거 2년치 백필+LLM 을 푸시 전 이 PC 에서(E6 · 푸시 뒤 GHA 백필은 불필요해짐).

**비자명한 사실 (재조사 금지)**:

- 목록 드라이런은 새 문서를 DB 에 저장하지 않고 숫자 수집기는 DB 문서만 읽는다 → «새 문서의 숫자 수집 드라이런» 확인은 성립하지 않는다. 시험(`mod.wants`·`parse`)으로 대신하고 실물은 Task 12 Step 0(Codex 대조 · 계획서 Global Constraints 마지막 줄).
- 공개 레포라 계획서에 «고객사 노조 + 우리 생산량 + 특정 OEM 공장» 원문을 그대로 두면 그 OEM 이 우리 고객임이 드러난다 → 공개 판에서 가림(원문은 `참고/`).
- 화면(`lib/customers/ir.ts`)은 실적 행 단위를 `bn()` 으로 환산하고 `quarterize` 가 실측 분기 행을 누계 차이보다 우선한다 — 포르쉐 팩트시트(million)와 EQS(billion) 공존은 결함 아님(Task 3 검토).
- 빈패스트 2분기 실적 6-K 가 3분기 끝 뒤(2026-10-19)에 나온다 → EDGAR 회사 IR 날짜는 «숫자 수집기가 그 문서에서 읽은 실적 기간 → 그 문서 접수일»(Task 4 · 계획 규칙은 실물에서 틀림).
- 화면 회사 목록 `customer_accounts` 에 수집 대상 11곳 밖 회사 0건(대상 밖 `customer_collect_status` 행 5건은 남지만 안 보임).
- 노사 조사 = `참고/고객사/research/labor_2026-11.md`(⑧절 = Codex 원문 대조: 조합원 9,000명 초과가 기준 · C$529m 은 연방 약정만 · no board 뒤 16일 지나 17일째 · 기아 08-21 파업 실행 여부 확정 불가 · 현대차 5.5만 대는 누적).

**남은 사소 지적(최종 검토에서 가림)**: 원장의 `minor (deferred)` 줄 — Task 1 4건 · Task 2 7건 · Task 3 4건(그중 `porsche.py:48` 인도 정의 문구는 Task 11/12 에서 고칠 것).

**검증**: Task 별 — Task 3 시점 `pytest scripts/lib` 763 통과 · Task 4 첫 구현 779 통과 · `npm run check-all` 각 Task 통과(구현자 보고 · 검토자 확인). 마무리 시점 전체 재검증은 PC 종료 때문에 못 돌림(Task 4 수정분이 미커밋이라 지금 트리는 검증 대상 아님).

**푸시 뒤 사용자가 할 일(변경)**: GHA `probe_gm_ir` 수동 실행만(GM IR 접근 시험) — 2년 백필은 E6 으로 이 PC 에서 한다.

## 이전 상태 · 재개 지점 (2026-11-10, **고객사 페이지 2단계 끝 — 공식 문서 수집·가이던스·물량·실적 일정 + 최종 검토 수정 전량 · 미푸시**)

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
