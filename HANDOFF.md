# HANDOFF

다음 세션이 그대로 이어받기 위한 인수인계 기록. **맨 위가 최신**이고, 새 블록을 쓸 때
직전 블록은 `## 이전 상태 …` 로 강등한다.

**여기엔 최근 10블록만 둔다.** 그보다 오래된 블록은 지우지 않고
[`docs/handoff-archive-2026.md`](./docs/handoff-archive-2026.md)(현재 **44블록** · 2026-11-16 실측)로 옮긴다.

---

## 최신 상태 · 재개 지점 (2026-11-16, **협력사 페이지 폐기 — 코드·사외비 표 삭제 · 가림 fixup 합친 기록으로 재작성**)

> 사용자 지시(원문 = `docs/plans/2026-11-13-suppliers-page_최초지시.md` 5차): 「이건 쓸수 없겠다. 관련 내용 폐기하자 히스토리는 남겨놓고」 — 선택: 협력사 전체 폐기 · 가림 fixup 을 계획서 커밋에 합친 뒤 폐기 커밋.

**결과**:

- MarkLines 가 계정 정지 뒤 목적·경위·도구 해명을 요구했다(답장은 사용자). 실제 요청 수는 앞서 적은 「약 700회」가 아니라 **약 2,300회**(검색 198×2 · 상세 1,895 — 401 뒤에도 1,416회 계속)였다.
- 협력사 코드(화면·탭·권한·수집기·점수·조회) 삭제 · 고쳤던 공용 파일(`permissions.ts`·`confidential.ts`·캐시 태그·`app/oem/layout.tsx`·AGENTS·Architecture)은 서버판으로 복원 · 표 5개 삭제 마이그레이션 `20261116000001`.
- 기록은 남겼다: 협력사 커밋 전부 + 설계·계획·결정이행·지시 문서(맨 위에 「폐기됨」). 계획서 커밋의 실제 공급사 특징·품목 단어는 fixup 을 합쳐 기록에서 없앴다(커밋별 누출 검사 = 제품 이름 2개만).
- 이미 서버에 올라간 모빌리티 권한 커밋 3개(cb74982·215daf2·6494be7)는 로컬 사본을 빼고 그 핸드오프 기록만 남겼다.
- 교훈은 `docs/oem-collection.md` 맨 끝 절 · 전역 규칙(`~/.claude/CLAUDE.md` 보안 「외부 사이트를 긁기 전」).

**MarkLines 2차 메일(11-16)**: 약관 7조 9항(자동 다운로드 금지 · 양·목적 예외 없음) 위반 가능성 → 손 서명 재발 방지 확약서 요구. 그래서 같은 날 **엑셀 자동 수집 GHA 4개를 껐고**(`sync-oem-excel`·`sync-oem-production-excel`·`sync-oem-china-excel`·`marklines-adhoc-fetch` — `gh workflow disable`, 파일은 그대로) **쿠키를 지웠다**(`scripts/.env`·`.env.local`·GitHub 비밀값).

**🔴 재개 지점**: ① 워크플로 4개를 **다시 켜지 말 것**(확약 위반) — 엑셀은 사용자가 브라우저로 받아 수동 적재(매주 월 텔레그램 알림 · 다음 커밋) ② `.env.local` 의 `MARKLINES_EMAIL`·`MARKLINES_PASSWORD` 삭제는 사용자 답 대기 ③ `참고/협력사/`(시드·대응표 · gitignore)는 남겨 뒀다.

---

## 이전 상태 · 재개 지점 (2026-11-16, **모빌리티 계정 축소 — 경영관리는 스텔란티스만 · 비교·경영표준 차단 — 운영 반영(협력사와 떼어 푸시)**)

> 사용자 지시 원문(2026-11-16, 순서대로): 「모빌리티 경영관리 페이지 볼수 없게 막아. 사외비 보고서는 볼 수 있게 그대로 유지하고.」 → 「아 경영관리 페이지에서 스텔란티스만 볼 수 있게 해줘」 → 「모빌리티 계정으로 로그인해도 다 보이는데?」(미푸시가 원인) → 푸시 방식 선택 「권한 변경만 먼저」 → 「아 모빌리티 계정은 비교 페이지도 못 보게 해.」 · 「기타 경영표준도 못 보게 하고.」

**결과**:

- `lib/auth/permissions.ts` — mobility 는 `/management`(랜딩)·`/management/stellantis` 만 통과(`MOBILITY_MANAGEMENT_PATHS`), 첫 탭 = 스텔란티스. `/compare` 는 guest·mobility 차단. `/etc/mgmt-standard` 는 `canAccessConfidentialReports && role !== 'mobility'`. 조직도 이미지 API 는 admin·holdings 만.
- 그대로 둔 것: mobility 의 사외비 보고서 열람·게시 · 고객사 · 협력사 · 챗봇. holdings·hmobility·guest 변화 없음.
- 탭 줄(`ManagementTabs`)·왼쪽 메뉴(하위 메뉴 포함)·`proxy.ts` 가 전부 `canAccess` 라 판정 함수 한 곳으로 같이 바뀐다.
- **운영 반영 경로**: 원격 master(`c73fcec` 백업 봇) 위에 `.claude/worktrees/` 임시 작업 폴더로 `cb74982`(권한)·`215daf2`(조직도 문구) 두 커밋만 만들어 푸시. 협력사 커밋은 원격에 안 올라갔다. 로컬 master 에는 같은 내용을 cherry-pick(`6b57453`·`c51a21d`)으로 얹었다 — 핸드오프·메모리가 해시로 가리키는 협력사 fixup·KG 커밋 번호를 바꾸지 않으려고 rebase 는 하지 않았다.

**🔴 재개 지점**:

1. **협력사 푸시 때** origin/master 위로 rebase 하면 로컬의 `7fed786`·`6b57453`·`c51a21d` 가 원격 `cb74982`·`215daf2` 와 겹친다 → 충돌 나면 원격 쪽 권한 코드에 협력사 줄(`canAccessSuppliers`·「고객사·협력사」 문구)만 더한 것이 정답. 내용이 같아 빈 커밋이 되면 건너뛴다.
2. ~~남은 빈틈~~ **해결(사용자 「막아」)**: `/reports/<번호>` 직타로 경영표준 글이 열리던 것을 `canReadPost(role, post)`(사외비 + 경영표준 카테고리 판정)로 막았다 — 상세 화면·HTML·동영상 첨부 프록시 셋 다. 원격 `6494be7` · 로컬 cherry-pick `aa4b32d`. 협력사 푸시 rebase 때 이것도 원격과 겹친다(1번과 같은 방식으로 푼다).
3. 화면 눈 확인 안 함 — mobility 로 로그인해 경영관리 탭 줄 = 스텔란티스 하나, 왼쪽 메뉴에 비교·경영표준 없음.

**검증**: `npm run check-all` 통과(로컬 master vitest 774 · 원격 기준 작업 폴더 vitest 744) · `verify_docs` 는 기존 `docs/gotchas-data-collection.md` 상한 초과 1건(이번 변경 무관 · 미수정).

## 이전 상태 · 재개 지점 (2026-11-13 밤, **협력사 페이지 1단계 — 코드·화면 완성 · 적재 0곳(MarkLines 계정 정지 의심) · 미푸시(사용자 지시)**)

> 사용자 지시(원문 = `docs/plans/2026-11-13-suppliers-page_최초지시.md` · 실명판 `참고/협력사/`): `/oem` 아래 「협력사」 — 우리 제품(하프샤프트·얼터네이터)을 공급할 수 있는 업체를 지역별로 모으고 경쟁사 납품 업체부터 컨택 순위. 4차 지시(밤): 「너 때문에 아이디가 정지된것 같은데? … 일단 만들 수 있는것만 만들고 그만해. 정리는 하되 푸시는 하지말고」.

**결과** (계획서 `docs/plans/2026-11-13-suppliers-page-phase1.md` Task 1~10 · SDD 원장 `.superpowers/sdd/2026-11-13-suppliers-page-phase1/progress.md`):

- 사외비 표 5종 `sourcing_*`(시드: 제품 2 · 품목군 14 · 경쟁사 10 — 값은 `참고/협력사/sourcing_seed.json` 만) · 상세 파서 · MarkLines 검색 모듈 · 수집기(`--resume`·부분 저장 포함) · 점수·순위 순수 함수 · 조회 계층 · 권한(`canAccessSuppliers`) · OEM 탭 · 목록·상세 화면. 각 Task 검토 통과(Approved).
- **적재된 협력사 0곳.** 본 수집 1회차가 1초 간격 약 30분·요청 약 700회 뒤 401 로 끊겼고, 그 뒤 로그인이 되지 않았다(사용자: 계정 정지 의심). 화면은 빈 상태로 뜬다.

**🔴 재개 지점**:

1. **MarkLines 에 요청하지 말 것** — 계정 상태를 사용자가 확인하기 전까지. 재수집 전 확인 사항 = `docs/oem-collection.md` 「MarkLines 계정 정지 의심」 절(간격 상향·하루 상한은 사용자 승인 뒤).
2. **푸시 전 필수 2가지**: ① fixup 커밋 2개(`2e09752`·`3756fad`)를 `b7542d7` 에 합친다 — `b7542d7` 계획서에 실제 공급사 지문(종업원 수·지역·연도)과 실제 품목·공정 단어가 들어 있다(`git rebase -i --autosquash` 는 이 환경에서 못 쓰니 `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash origin/master` 를 사용자 확인 뒤 · 남의 미커밋 파일이 워크트리에 있으니 먼저 확인). ② 최종 전체 검토(SDD 마지막 단계 · Codex 와 오퍼스 따로)는 사용자 지시로 건너뛰었다 — 원장의 `minor (deferred)` 목록이 그 입력이다.
3. 첫 수집 뒤 할 일: Task 4 Step 5 DB 검증(지역별 건수·links·빈 이름 0) · 상세 화면 「점수 합계 = 목록 점수」·경쟁사 강조 확인 · 사용자 화면 확인(결정 12).
4. 남은 다듬기(원장 deferred): 라벨·배지 색 목록/상세 중복 → `lib/sourcing` 공용 · `regionCounts` 화면 미사용 · Architecture.md:95·:1045 탭 목록 위치가 옛 `app/oem/layout.tsx`.

**🔴 이번에 배운 것**:

- 유료 사이트에 대량 수집을 걸기 전에 이용 한도·속도를 확인하거나 사용자에게 묻지 않았다(교정 원장 기록). 「요청 간격 1초」는 서버 부하 예절일 뿐 계정 보호 기준이 아니다.
- 401 을 일반 실패로 세어 받은 479곳을 통째로 잃었다 → 로그인 풀림은 즉시 멈추고 저장(`exit 4`), Ctrl+C·실패율 초과도 저장.
- `PLATFORM_SESSION` 쿠키는 로그인 전에도 있다 — 로그인 판정은 상세 JSON 의 `profile` 로만.
- `npm run typecheck` 가 `.next/types/validator.ts` 로 실패하면 서브에이전트의 빌드·dev 가 남긴 낡은 생성 타입이다 → `npx next typegen`(지우지 않아도 됐다).
- 공개 레포 누출 검사는 「추적 파일 전체」가 아니라 **이 브랜치가 더한 줄**만 봐야 판정이 선다(전체는 기존 회사 데이터와 155파일 겹침).

**검증**: `check-all` 통과(lint·format·typecheck · vitest 769) · pytest `scripts/lib` 1076 · `verify_revalidate_tags` 0 · `verify_docs` 는 기존 `gotchas-data-collection.md` 상한 초과 1건(이번 변경 무관) · 화면은 헤드리스로 admin(빈 상태)·guest(차단) 확인.

---

## 이전 상태 · 재개 지점 (2026-11-13, **고객사 수정 회차 D — 속도(sin1·나눠 그리기)·VW 지역 코드 파서·쪽 5장·핵심 구절 강조 — 푸시·배포 끝 · sin1 확인**)

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
