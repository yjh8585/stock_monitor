# HANDOFF

다음 세션이 그대로 이어받기 위한 인수인계 기록. **맨 위가 최신**이고, 새 블록을 쓸 때
직전 블록은 `## 이전 상태 …` 로 강등한다.

---

## 최신 상태 · 재개 지점 (2026-09-09 밤 3) — 조작 E2E 네 화면 + revalidate 오해 해소

**무엇을 했나**:
1. **`NEXT_REVALIDATE_PROD_URL` 이 GitHub Secrets 에 없는 건 «문제가 아니었다».** 내가 앞
   회차에 「조용히 고장 나 있을 수 있다」고 올린 의심을 실물로 확인해 **기각**했다.
2. **조작 E2E 를 네 화면으로 넓혔다** — `e2e_interact.py` 42건 EXIT=0
   (`/related-stocks` 27행 · `/domestic` 126행 · `/parts-top100` 133행 · `/oem` 80행).

**결정과 근거**:
- 🔴 **revalidate 는 정상이다(재조사 금지).** 이 값을 넘기는 워크플로는 `collect-yt-report.yml`
  하나뿐이고 그 스크립트는 `PROD_URL or NEXT_REVALIDATE_URL` 로 **대체 경로**를 탄다
  (`collect_yt_report.py:316`). `--revalidate-prod` 를 쓰는 나머지 셋은 **로컬 수동 실행 전용**
  이라 `.env.local` 을 읽고 거기엔 값이 있다. 실행 기록으로도 확인 —
  최근 런 로그에 `✓ cache revalidated [default]` 가 있고 이 줄은 **HTTP 200 일 때만** 나온다.
  ⚠️ 다만 워크플로의 그 env 줄은 **없는 시크릿을 가리키는 죽은 설정**이다. 지우지 않고 남겼다
  (내 변경과 무관한 죽은 설정은 언급만 한다) — 다음 사람이 또 조사하지 않도록 gotchas 에 적었다.
- 🔴 **화면마다 사양을 «따로» 뒀다.** 실물로 재 보니 같은 「표 화면」인데 딴판이었다 —
  `/oem` 은 정렬 머리글 0개·팝업 0개, `/parts-top100` 구분 필터는 「국가」, `/domestic` 은 「그룹」.
  한 화면 스크립트를 복사했으면 버튼을 못 찾아 **조용히 0건**이 됐을 것이다.

**막힌 곳 / 안 되더라**:
- **`/oem` 의 「연간·월간」을 필터로 알고 걸었다가 2건이 빨개졌다.** 그것은 필터가 아니라
  차트의 **기간 전환 탭**(`role="tab"`)이라 눌러도 행 수가 안 변한다(80 → 80).
  실제로 바뀌는 것은 선택된 탭과 **막대 개수**(951 ↔ 944)였다 — 표가 아니라 그림을 봐야 했다.
  🔴 **내 기대가 틀린 것이지 앱 결함이 아니었다**(오늘 세 번째로 같은 패턴).
- ⚠️ **Git Bash 에서 `--route /oem` 이 `C:/Program Files/Git/oem` 으로 바뀐다.**
  `MSYS_NO_PATHCONV=1` 을 붙인다. 없는 사양을 지정하면 **조용히 통과하지 않고 실패**하게
  해 둔 덕에 즉시 드러났다.
- 사양을 덜 적으면 그 화면이 「행이 있다」 한 줄만 재고 초록이 되므로
  `_assertScreensMeasureSomething` 으로 실행 전에 막았다.

**재개 지점**: `/hansae`·`/compare`·`/management/*` 의 조작 검증.
🔴 **복사하지 말 것** — 화면마다 실물을 먼저 재고 `SCREENS` 에 사양을 적는다.

---

## 이전 상태 (2026-09-09 밤 2) — 자격증명 교체 실증 + 표 조작 E2E

**무엇을 했나** — 세 갈래가 하루에 이어졌다.

1. **자격증명 유출 수습(완결).** E2E 확장 뒤 「값이 샜나」를 확인하다
   `2026-05-28-admin-role-permissions-design.md` 11행에서 관리자 아이디·비밀번호를
   **평문으로** 찾았다(넉 달 · **공개 저장소**). 문서에서 걷어내고, `verify_no_secrets.py`
   를 심고, `git filter-repo` 로 649 커밋을 다시 써 원격을 덮었다.
2. **비밀번호 교체 실증.** 사용자가 `.env.local` 과 Vercel 양쪽을 바꿨고,
   **양방향으로 실측했다** — 로컬·운영 각각 새 비밀번호는 로그인되고 **옛 비밀번호는 막힌다**(4/4).
3. **표 조작 E2E 신설.** `scripts/e2e_interact.py` 16건 — `/related-stocks` 의
   필터·정렬·팝업을 **눌러서** 확인한다.

**결정과 근거**:
- 🔴 **「기록 정리」보다 「값 교체」가 먼저다.** 기록을 다시 쓰고 원격을 덮은 «직후에» 재 보니
  GitHub 은 옛 커밋을 SHA 로 **여전히 돌려주고**, 그 시점 파일에서 비밀번호가 읽혔다.
  참조가 끊긴 객체를 GitHub 이 정리할 때까지 남고 그것을 사용자가 시킬 수단이 없다.
  값을 바꾼 지금은 무해하다 — 이 순서를 뒤집으면 안 된다.
- **`hansaemobility` 는 과거 기록에서 «바꾸지 않았다».** 회사 홈페이지 주소로
  `companies.json` 에 정상적으로 쓰여 통째로 치환하면 데이터가 망가진다. 문서에서
  아이디로 쓰인 자리만 정규식으로 집었다.
- **조작 시험도 전부 양방향으로 썼다.** 「끄면 줄어든다」만 재면 아무 때나 0행을 내는
  고장도 통과한다 → ①끄면 줄고 ②**켜면 돌아오고** ③남은 행이 조건에 맞는지 셋을 함께 본다.

**막힌 곳 / 안 되더라**:
- **검사기가 두 번 고장 났고 둘 다 초록이었다.** 1판은 짧은 값을 건너뛰어 **정작 유출된
  `ADMIN_PW`(5자)가 검사 밖**이었고, 2판은 「같은 줄에 키가 있으면」으로 완화했다가
  `process.env.HMOBILITY_ID` 같은 정상 코드를 잡았다(오탐 4건). 지금은 값 길이로 찾는 법을
  가르고 두 오탐을 자기시험에 못 박았다(7/7). 속도도 3분 초과 → 16초.
- 🔴 **내가 그 검사기 docstring 예시에 진짜 아이디를 적었다.** 기록 정리 때 함께 치환되며
  드러났다 — 검사기를 설명하면서 검사 대상을 만들었다. 예시는 늘 가짜 값으로.
- **dev 첫 컴파일로 E2E 한 칸이 간헐 실패**(`admin//management/org-chart` 30초 초과).
  같은 역할만 다시 돌리니 13/13 — 환경 문제다. **시간 초과일 때만** 한 번 재시도하게 고쳤다.
- ⚠️ **뮤테이션 하나가 안 죽었다.** 「빈 칸을 0으로 읽기」를 넣어도 실패가 안 났는데,
  현재 매출 열에 **빈 칸이 하나도 없어서**다. 검사기 결함이 아니라 자료가 그 갈래를 안 밟는 것 —
  단위 자기시험만 덮는다고 ROADMAP·gotchas 에 적었다.

**재개 지점**: 다른 표 화면(`/oem`·`/domestic`·`/parts-top100`)의 조작 검증.
🔴 **`e2e_interact.py` 를 복사하지 말 것** — 열 위치·필터 이름이 달라 조용히 0건이 된다.
화면마다 실물을 먼저 재고 상수를 따로 둔다.
별건으로 `NEXT_REVALIDATE_PROD_URL` 이 워크플로에서 참조되는데 GitHub Secrets 에 없다
(없는 시크릿은 빈 값으로 넘어가 조용히 아무 일도 안 한다) — 미확인, 다음 회차 후보.

---

## 이전 상태 (2026-09-09 밤) — E2E 를 역할 5종 × 라우트 13개로 넓혔다

**무엇을 했나**: 오전에 「실패할 수 없던」 E2E smoke 를 고친 데 이어, 이번엔 **재는 범위**를 넓혔다.
`scripts/e2e_smoke.py` 가 이제 역할 5종(admin·holdings·mobility·hmobility·guest) × 라우트 13개
= **65칸**을 실제 브라우저로 훑는다 — 열려야 48칸 · **막혀야 17칸**. 화면 실물도 함께 본다
(본문 글자 200자 하한 + `table, svg, canvas` 중 하나 이상 + 라우트별 본문 선택자).

**결정과 근거**:
- 🔴 **admin 계정 하나로는 아무것도 못 잡는다.** `canAccess` 첫 줄이 `if (role === 'admin') return true`
  라서 admin 은 전 경로를 통과한다 — 「열리는가」만 재고 「막히는가」는 한 칸도 못 잰다.
  사용자 질문(*"admin 아이디로 접근하면 되지 않아?"*)에 대한 답이 이것이다.
- **검증 전용 계정은 만들지 않았다.** `.env.local` 에 다섯 역할 계정이 이미 다 있어 그대로 썼다.
- **기대표를 `permissions.ts` 에서 파생시키지 않았다.** import 해서 만들면 구현이 곧 정답이 되어
  규칙이 바뀌어도 영원히 통과한다. 사람이 읽는 규약을 손으로 옮겼고, 한쪽이 바뀌면 여기서 빨개진다.

**막힌 곳 / 안 되더라** — 첫 실행에서 **13건이 빨개졌는데 전부 내 기대값이 틀린 것**이었다(앱은 정상):
1. `/etc` 는 설계상 `/etc/fx` 로 자동 이동하는데 주소를 정확히 일치로 봐서 다섯 역할 전부 `deny` 로 찍혔다
   → 접두 비교로 고쳤다(권한 차단은 항상 `/` 나 랜딩으로 «나가므로» 하위 경로가 될 수 없다).
2. `/compare`·`/management/inventory`·`/management/org-chart` 를 `table` 로 기대했는데 **svg 차트**
   화면이었다(각 53·17·15개) → 라우트별 선택자는 갈리는 곳만 적고 나머지는 공통 바닥으로 받는다.
3. 선택자를 안 적은 `/management/companies`·`/management/upload` 는 **무검사로 통과**하고 있었다
   → 공통 바닥을 깔아 막았다.

**검증**: 65칸 EXIT=0 · 자기시험 `--self-test` 4/4(틀린 기대를 넣으면 정말 빨개지는지 · 틀린 비밀번호로
로그인 실패가 잡히는지) · `npm run check-all` EXIT=0(462건) · `verify_docs.py` EXIT=0.
⚠️ AGENTS.md 가 상한을 47B 넘겨서 **상한을 올리지 않고 내 추가분을 줄였다**(37,293 / 37,500).

**재개 지점**: 남은 것은 **조작** 검증이다 — 필터·정렬·팝업을 실제로 눌러 보는 단계. 지금은
「열리고 그려지는가」까지만 본다. dev 서버는 3001 이고(3000 은 다른 앱), 이번 회차 뒤 닫아 두었다.

---

## 이전 상태 (2026-09-09 저녁) — E2E smoke 가 실패할 수 없는 상태였다

### 🔴 재개 지점

- **E2E 는 이제 실패할 수 있다.** 남은 것은 **동작** 검증이다 — 지금은 「화면이 열리는가」까지만 본다.
  표 렌더링·필터·정렬·팝업은 `ROADMAP.md:227` 에 남겨 두었다.
- 돌리는 법: dev 를 띄운 뒤 **포트를 실물로 확인하고**(3000 은 다른 앱 점유 → 3001+ 로 배정된다)
  `E2E_BASE_URL=http://localhost:<포트> scripts/venv/Scripts/python.exe scripts/e2e_smoke.py`.

### 무엇을 했나

`scripts/e2e_smoke.py` 를 고쳤다(`c451803`). 발단은 「E2E 를 확대하자」였는데, 실물을 재 보니
**확대가 아니라 수리가 필요한 상태**였다.

- 🔴 **로그인이 통째로 실패해도 아홉 라우트 전부 `[OK]` 였다.** `cacheComponents`(PPR)가 정적 셸을
  먼저 200 으로 흘려보내므로 로그인 폼이 돌아와도 HTTP 는 200 이다. `docs/gotchas-playwright-ui.md`
  가 「권한 차단을 상태 코드로 판정하지 말 것」이라 적어 둔 바로 그 함정인데, **그 문서가 정본으로
  지목한 스크립트가 어기고 있었다.** 판정을 화면 **내용**으로 바꿨다.
- 산출물을 프로젝트 **밖**으로(옛 코드는 `data/_e2e_screenshots/`·`scripts/` 에 써서 Turbopack
  재컴파일을 유발 → **자기가 만든 파일로 자기 로그인을 깨뜨릴 수 있는** 구조였다).
- 소스에 박힌 아이디·비밀번호 기본값 제거 · 기본 포트 3000 → 3001.

### 결정과 근거

- **새 E2E 프레임워크(.spec.ts)를 들이지 않았다**(사용자 선택 「작게 시작」). 조사 단계에서
  「E2E 가 일부 있다」던 것은 실제로는 `lib/` 순수 함수 Vitest 였고, **E2E 는 이 파이썬 스크립트로
  이미 있었다.** ROADMAP 한 줄이 둘을 같은 칸에 적어 두어 생긴 오독이라 그 줄도 고쳤다.

### 막힌 곳 / 안 되더라

- 로그인 직후 곧바로 보호 라우트로 가면 **성공했는데도** 로그인 폼이 돌아온다. 리다이렉트 체인이
  `networkidle` 뒤에도 진행 중이기 때문이고, **고정 대기 2.5초**가 필요하다(문서의 권고 그대로였다).
  같은 이유로 `page.url` 로 판정하면 안 된다 — 성공해도 한동안 `/login` 이다.

### 검증

정상 계정 → EXIT=0(아홉 라우트) · 틀린 비밀번호 → EXIT=1 **양방향 실측** ·
`verify_docs.py` EXIT=0 · `npm run check-all` EXIT=0(462건). dev 서버는 검증 후 종료했다.

---

## 이전 상태 (2026-09-09)

### 무엇을 했나

Supabase 보안 경고 메일(9월 8일 발송)을 확인하고, 실제로 남아 있던 것만 고쳤다.
커밋 `a57be20` 1건 — 마이그레이션 `20260909000001_function_search_path.sql` + 문서 2곳.

트리거 함수 3개(`trg_auto_page_mapping` · `management_uploads_set_updated_at` ·
`skip_identical_update`)에 `set search_path = public, pg_temp` 를 붙였다. 본문은 안 건드렸다.

### 결정과 근거 — 「경고 4종 중 고칠 것은 1종뿐」

**메일이 지목한 Critical 은 이미 고쳐진 것이었다.** 메일의 데이터 기준일(09-06)이 발송일보다
앞서서, 하루 전 `20260907000002_rls_backup_tables.sql` 로 막은 백업 테이블 2개가 다시 온 것이다.
🔴 **메일보다 `get_advisors` 실시간 조회를 먼저 볼 것.**

남은 둘은 **의도된 설계라 고치지 않기로 했다**(전수 확인 후 판정):

- `rls_enabled_no_policy` 15건 — 사외비 격리 방식(RLS enable + 정책 없음 = default deny) 그 자체다.
  **정책을 만들면 오히려 구멍이 난다.**
- `materialized_view_in_api` 3건 — 구체화 뷰엔 RLS 를 못 걸지만, 원본 `oem_sales_*` 테이블이
  이미 `anon` 읽기를 전면 허용(`qual = true`)한다. 뷰를 막아도 원본에서 같은 값을 읽으므로
  **추가 유출이 아니다.** 🔴 여기서 `revoke` 하면 `/oem` 과 `/oem/competition` 이 조용히 빈 화면이 된다.

### 막힌 곳 / 안 되더라

- **검증용 임시 테이블을 `public` 에 만들면 그 자체가 다음 주 메일의 Critical 이 된다.**
  트리거 동작을 `_sp_probe` 로 확인한 뒤 반드시 지웠고, RLS 미적용 테이블 0개를 재확인했다.
- **PowerShell here-string(`@'...'@`)을 Bash 도구에 쓰면 제목에 `@` 가 박힌다.** 첫 커밋이 그랬고
  `--amend` 로 정정했다. 여러 줄 커밋 메시지는 파일에 써서 `git commit -F` 로 넘기는 것이 맞다.
- `.githooks/pre-commit` 이 마이그레이션 새 파일에 AGENTS.md 동반 수정을 요구했는데, 이번은
  스키마·뷰·제약·라우트 변경이 없어 `SKIP_AGENTS_CHECK=1` 로 우회했다(사유는 커밋 메시지에 기록).

### 재개 지점

이 건은 **완결됐다.** 다음 주 같은 메일이 오면 `docs/gotchas-ci-deploy.md` §10 을 먼저 열면 된다
(어느 테이블인지 가리는 SQL 과 두 경고의 판정이 거기 있다).

이번 작업과 무관한 **원래 남아 있던 것**은 ROADMAP Phase 5 의 미완 3건이다 — E2E 테스트 확대 ·
Lighthouse 90+ · 그에 딸린 프로덕션 배포 체크(`ROADMAP.md:227~229`). 이번 세션에서 건드리지 않았다.

---

## 이전 상태 · 재개 지점 (2026-09-08 오후)

### 무엇을 했나

오전에 「상위 3군만」 고치고 남겼던 **코드리뷰 지적을 전량 처리**했다. 브랜치
`fix/code-review-2026-09-08-part2` 에 16커밋 · 53파일 · +1,900/-370.

| 커밋      | 내용                                                                   |
| --------- | ---------------------------------------------------------------------- |
| `f4e0e86` | `lib/currentYear.ts` 신설 — `currentFiscalYear` 개명 + 계층 역전 해소  |
| `ab134d0` | NHTSA 리콜 실패를 0건으로 숨기던 것 + 캐시 태그 정합성 **검사기 신설** |
| `5546d48` | 손익 표 3종의 연도 열을 **데이터에서 파생**                            |
| `0929088` | `Forecast2026.tsx` → `AnnualForecast.tsx` 개명 + 연도 무관화           |
| `665fed3` | 조회 실패를 200 ok 로 보고하던 것 + 날짜 하나로 검색 전체가 죽던 것    |
| `552caa2` | `sanitizeNext` 백슬래시 오픈 리다이렉트 (`lib/auth/sanitize-next.ts`)  |
| `35df255` | 챗봇 한세 게이트 누락 + `or()` 필터 주입 + 오늘 뉴스 KST 자정          |
| `583bcc9` | `recall_count` null 전파 + `ALL_TAGS` 8개 보강 (검사기 exit 0)         |
| `264e018` | 소스의 **날 NUL 바이트** 제거 — Grep 도구가 파일을 통째로 건너뛰던 것  |
| `8ebdade` | 연도 하드코딩·UTC 연도 전량 제거 — 모듈 상수 대신 **함수 호출로**      |
| `be91eb1` | guest 는 챗봇을 쓸 수 없게 (요금 통로 차단)                            |
| `daa73f8` | 1차 연도 수정의 회귀 테스트 보강                                       |
| `c8c7fbb` | `/oem` 화면의 연도 리터럴을 `targetYear()`/`currentYear()` 로          |
| `fc72df6` | gotchas — 검사기 exit 0 이 정상 상태로 바뀐 것 반영                    |

**검증:** `check-all` EXIT=0 (462 테스트) · `pytest scripts/lib` 417 passed ·
`verify_revalidate_tags.py` **exit 0** · `verify_docs.py` 오류 0 ·
`new Date().getFullYear()` 0건 · 추적 파일 NUL 0건 ·
🔴 **미래 시각 2027-01-05 KST 전체 스위트 통과**(리뷰어 2명이 각각 재현).

**계획서:** `docs/plan-code-review-fixes-2026-09-08.md` 「2차」 섹션 (Task 8~16)
**작업 기록:** `.superpowers/sdd/plan-code-review-fixes-2026-09-08/progress.md`

### 알아 둘 것 — 코드·git 으로는 안 보이는 것

1. 🔴 **소스에 날 NUL 바이트가 있으면 Grep 도구가 그 파일을 통째로 건너뛴다.**
   `lib/oem-competition/source.ts` 가 그랬고, 그래서 「`recalls` 소비처 전수 grep」이 0건을 내
   NHTSA 수정이 화면까지 안 이어진 채 완료로 보고됐다. 증상·처방·전수 점검 명령 =
   `docs/gotchas-ci-deploy.md` §8. **넓게 훑어 0건이면 파일을 콕 집어 다시 세어라.**
2. 🔴 **`verify_revalidate_tags.py` 는 exit 0 이 정상이다.** 위반이 나오면 그것이 회귀다.
   (한때 「exit 1 이 정상」이라 적혀 있었고, 그대로 뒀으면 다음 세션이 진짜 회귀를 넘겼을 것이다.)
   **2026-09-09 에 역방향 검사를 붙였다** — 「태그는 있는데 그걸 부르는 원천 테이블 매핑이 없다」까지
   본다(초판이 통과시키던 `hyundai_retail_sales` 유형). 판정은 순수 함수 `evaluate()` 이고
   `scripts/lib/test_verify_revalidate_tags.py` 가 **검사기 자신을 시험한다.**
   🔴 **매핑 면제는 `TAGS_WITHOUT_COLLECTOR` 뿐이다**(`oem_model_brand` — 마이그레이션 전용).
   여기에 태그를 더하는 것은 「수집기가 안 건드린다」는 **주장**이니 함부로 늘리지 말 것 —
   늘리면 검사기가 조용히 무력해진다(테스트가 목록을 못 박아 둬서 같이 고쳐야 한다).
3. 🔴 **연도 규칙이 세 가지이고 자리마다 다르다.** 섞으면 값이 어긋난다.
   - **데이터 파생**(`buildPeriodColumns`·`AnnualForecast` 지역 `targetYear`) = 적재가 화면보다 늦는 자리
   - **`currentYear()`** = 라벨 상한·YTD 판정·창
   - **`currentYear()-1`**(`lib/oem/aggregate.ts` 의 `targetYear()`) = 연 사전집계 뷰
4. 🔴 **`const X = currentYear()` 를 모듈 최상단에 두지 말 것.** 평가 시점에 값이 굳어
   장수 프로세스가 해를 넘겨도 안 따라온다. 하드코딩을 지우고 같은 버그를 다시 심는 유일한 길이다.
5. ⚠️ **`targetYear` 라는 이름이 두 곳에서 반대 의미다** — `lib/oem/aggregate.ts` 의 export 는
   「직전 완결 연도」, `AnnualForecast.tsx` 의 지역 변수는 「데이터 최대 연도」.
   지금은 import 경로가 안 겹쳐 안전하나 자동완성으로 잘못 끌어오면 조용히 틀린다.
6. **사용자 결정(2026-09-08 오후)**: OEM 기준 연도 = 직전 완결 연도 ·
   `Forecast2026.tsx` 는 개명 · `/api/chat` 은 **guest 만** 차단.

### 재개 지점 — 남은 일

> 최종 전체 브랜치 리뷰가 **Critical 0 · 병합 가능**으로 판정한 뒤 남긴 것들이다.
> 전부 「지금 깨지지 않는 것」이라 급하지 않다.

**1순위 — 이름·주석 정리 (동작 무관)**

- `targetYear` 이름 충돌(위 「알아 둘 것」 5번). `lib/oem/aggregate.ts` 쪽을 `lastCompleteYear()` 로
  바꾸는 것이 자연스럽다.
- JSDoc 연도 잔재 — `components/management/pnl/AnnualForecast.tsx:15,139,141,143,145` ·
  `FixedVariableStructure.tsx:304`.
- `lib/oem/aggregate.ts` 의 「직전 완결 연도」 명명이 1~2월엔 사실이 아니다(12월 MarkLines 분이 아직
  안 들어온다). 형제인 `hyundai`/`kia` 는 같은 개념을 `isComplete ? latest : latest-1` 로
  **데이터에서** 판정한다 — 같은 개념의 두 처리.

**2순위 — 알려진 한계 (운영 데이터에선 미발생)**

- `lib/pnl/periodColumns.ts` — YTD 열을 항상 맨 뒤에 붙인다. 중간 연도만 monthly-only 면 열 순서가
  뒤집힌다.
- `lib/chat/tools.ts:207` — `or()` 살균이 `,().*%_\` 는 막지만 `"` · `:` 는 남긴다.
  큰따옴표 섞인 검색어는 여전히 400 가능(**권한 우회는 불가** — 콤마가 제거돼 or 분기를 못 늘린다).
- `lib/oem-competition/source.ts:328` — 대상 차종 `recall_count=null` 이면 safety 항목 자체가
  안 만들어진다. `KpiStrip` 이 `—` 로 내므로 **「0건」 오독은 아니고** 정보량이 적을 뿐.
- `lib/oem-companies/stellantis-na/aggregate.ts` 의 `isYtd` 는 과거 연도에 분기 구멍이 나면
  그 해를 영구히 YTD 로 표시한다(2021 부터 완전 백필이라 현재 무해).
- `lib/finance/loan-aggregate.ts:62` — 매년 1월, 당해 실적 적재 전까지 YTD 지급율이 `—`.
  **틀린 값이 아니라 빈 값**이다.

**3순위 — 무관한 기존 항목**

- lint 경고 2건 — `lib/oem-companies/kia/aggregate.ts` 의 `RETAIL_ANNUAL_MIN_YEAR`(커밋 `44e99d8`
  이전부터 존재) · `lib/supabase/confidential.ts` 의 `CONFIDENTIAL_TABLES`(타입 전용 export).
  **이번 변경과 무관해 손대지 않았다.**
- `buildCorpAchievement` 무커버리지.

### 알아 둘 것 — 운영

- **AGENTS.md 를 다이어트했다 (2026-09-09)** — 37,495B(여유 5B) → **36,537B / 상한 37,500B, 여유 963B.**
  상한은 **건드리지 않았다**(`verify_docs.py` 가 「상한을 올려서 통과시키지 말 것」이라 명시한다).
  가른 기준은 AGENTS.md 자신의 원칙 — **어기면 조용히 깨지는 것만 남기고 카탈로그·함정 서사는 옮긴다**:
  - `scripts/lib/` **모듈 카탈로그** → [`Architecture.md 부록 C`](./Architecture.md). AGENTS 엔 약속 11개만.
    🔴 옮기기 전에 확인했더니 **Architecture 쪽이 2026-08-25 이관 이후 갱신이 안 돼**
    `pdf_figures.py`·`research_priority.py` 두 모듈이 빠져 있었다 — **먼저 동기화하고** 옮겼다.
  - **새 사외비 테이블 5-step**(절차) → [`Architecture.md §7-G`](./Architecture.md)
  - **훅 검사기 함정 서사** → [`docs/gotchas-ci-deploy.md`](./docs/gotchas-ci-deploy.md) §9
  - `collect_*.py` 줄은 **Architecture 에 99% 동일본이 이미 있었다**(이관이 복사로 끝나 원본이 남은 것).
    🔴 **다음 추가도 원칙은 같다** — 여유가 963B 로 늘었어도 함정은 `docs/gotchas-*.md` 가 정본이다.
- **푸시 완료** (`9f79851`, 2026-09-08). 프로덕션(Vercel)에 올라갔다.
  - 🔴 **배포 직후 Cox 재고 캐시가 한 번은 안 풀릴 수 있다** — 태그 이름을
    `cox-brand-inventory` → `cox_brand_inventory` 로 통일했다. `cacheLife('days')` 라 최악 하루.
    이상해 보이면 `/api/revalidate` 로 `cox_brand_inventory` 를 한 번 쳐 주면 된다.
  - 푸시가 **한 번 거부됐다** — 원격에 백업 봇의 일일 스냅샷(`20755e7`, `data/backups/` 만)이
    먼저 올라와 있었다. 🔴 **rebase 하지 말 것**(HANDOFF·메모리에 적은 커밋 해시 14개가 전부 무효가
    된다). `git merge origin/master` 로 받으면 해시가 보존된다. 백업 봇 커밋은 `data/backups/` 만
    건드리므로 소스 충돌이 없다.
- dev 서버를 띄웠다 끄면 `.next/dev/types/validator.ts` 가 잘린 채 남아 **`tsc` 가 그 생성 파일에서
  실패**할 수 있다. 소스 문제가 아니니 `.next/dev/types` 를 지우고 다시 돌리면 된다.

---

## 이전 상태 · 코드리뷰 1차 (2026-09-08 오전)

> 🔴 아래 「재개 지점 — 남은 일」의 **1~4순위는 같은 날 오후에 거의 전량 처리됐다.**
> 지금 남은 일은 **맨 위 블록**을 볼 것. 이 블록은 그때의 판단 근거로만 남긴다.

### 무엇을 했나

`lib/` · `scripts/lib/` · `app/api/` 전수 코드리뷰(196파일 / 37,562줄)를 돌리고, 나온 지적
중 **상위 3군**을 고쳤다. 브랜치 `fix/code-review-2026-09-08` 에 10커밋.

| 커밋      | 내용                                                                               |
| --------- | ---------------------------------------------------------------------------------- |
| `bfb7012` | `check-all` 이 format:check 에서 죽던 것 복구 — dart_eval 진단 JSON 추적 해제      |
| `d15c226` | `canPublishReports` 신설 (admin·holdings·mobility)                                 |
| `4361be2` | API 3종에 역할 게이트 (403 JSON)                                                   |
| `577e1bb` | 게시 화면 게이트 (`/reports/new` 진입 + 「+ 글쓰기」 버튼)                         |
| `3bf9a6b` | 스텔란티스 매출 KPI 100배 — 백만원→억원 환산 누락, `toRevenueRows` 순수함수로 분리 |
| `edf43ff` | `.range()` 페이징 11곳에 결정적 정렬                                               |
| `c2f97e0` | 스텔란티스 북미 진행 중 연도 YoY 허위 급락 −75%                                    |
| `7856c27` | 연도 2026 하드코딩 제거 (`currentFiscalYear`)                                      |
| `e03b01f` | 위 fix — `(P)` 계획값 누출·연초 YTD 공백 회귀                                      |
| `99eb0c0` | 최종 리뷰 fix — `pnl/source.ts` 정렬 비유일 + `hyundai fetchExportRegions`         |

**검증:** `check-all` 4단계 통과 (vitest 440) · `verify_docs.py` 오류 0 · 브라우저 E2E 3항목 PASS
(권한 4칸 · OEM 6페이지 200/콘솔0/4xx-5xx 0 · 스텔란티스 KPI 렌더).

**계획서:** `docs/plan-code-review-fixes-2026-09-08.md` (grill-me 심문 반영본)
**작업 기록:** `.superpowers/sdd/plan-code-review-fixes-2026-09-08/progress.md` (Task별 판정·이월 항목)

### 재개 지점 — 남은 일

> 이번 범위는 「상위 3군」이었다. 아래는 **의도적으로 남긴 것**이며, 최종 whole-branch
> 리뷰가 「병합 전 필수 없음」으로 판정했다.

**1순위 — 2027-01-01 에 손익 화면이 여전히 멈춘다 (Task 7 의 후속)**

`lib/` 는 고쳤지만 **같은 화면을 그리는 컴포넌트 4개가 2026 에 못 박혀 있다.** 라벨만
2027 로 넘어가고 카드는 2025/2026 에 남아 **오히려 더 헷갈리는 상태**가 된다.

- `components/management/pnl/Forecast2026.tsx:159,165,174,180` (파일명부터 연도다)
- `components/management/pnl/CostStructure.tsx:64,65,70,72`
- `components/management/pnl/FixedVariableBep.tsx:61,73,75,77`
- `components/management/pnl/FixedVariableStructure.tsx:242,260,261,264,266`

**2순위 — 리뷰 지적 중 미처리 8건**

| 위치                                 | 증상                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `scripts/lib/nhtsa_client.py:201`    | 수집 실패가 「리콜 0건」으로 둔갑 (리콜 경로만 `any_ok` 가드 누락)                         |
| `scripts/lib/revalidate.py:32`       | `humanoid_stocks_view`·`hyundai_retail_sales` 태그 매핑 누락 → 수집 성공해도 페이지가 낡음 |
| `app/api/cron/sentiment/route.ts:39` | 조회 `error` 를 안 받아 DB 실패에도 200 `ok`                                               |
| `lib/hansae/data.ts:89`              | `setUTCHours(0,0,0,0)` 이 KST 자정이 아니라 09시                                           |
| `lib/chat/tools.ts:194`              | `runQueryCompanies` 만 한세 차단 게이트를 안 거침                                          |
| `lib/chat/tools.ts:206`              | 사용자 입력이 PostgREST `or()` 에 그대로 (콤마 하나로 400)                                 |
| `lib/auth/actions.ts:14`             | `sanitizeNext` 가 `/\` 를 놓쳐 오픈 리다이렉트                                             |
| `app/api/news/search/route.ts:88`    | `<pubDate>` 하나가 깨지면 전체 502                                                         |

**3순위 — 연도·시각 하드코딩 잔재** (전부 2027 시한폭탄)

- `lib/finance/loan-aggregate.ts:12` — `YTD_YEAR = 2026`
- `components/oem/OemDashboard.tsx:17` — `YTD_YEAR = 2026`
- `lib/oem/aggregate.ts:22` — `TARGET_YEAR = 2025` (**지금 이미 작년치를 보여 준다** — 「직전 완결 연도」 의도인지 판단 필요)
- `new Date().getFullYear()` 서버 로컬시간 → Vercel(UTC)에서 연초 9시간 밀림:
  `kia/aggregate.ts:128,202,636,783,854,1091` · `hyundai/aggregate.ts:212` · `uzbekistan/source.ts:249`
  (`kia/aggregate.ts:202` 의 `isCurrentYear` 는 lint 가 잡은 죽은 변수 — 같이 정리)
- `lib/stockSort.ts` 의 `FALLBACK_YEAR = '2025'` (2029 부터 `SUPPORTED_YEARS` 창 밖)

**4순위 — 구조·위생**

- `currentFiscalYear` 는 **달력 연도**인데 이름이 회계연도를 시사한다(`companies.fiscal_year_end_month` 규칙과 혼동). `lib/fiscalYear.ts` 로 빼면서 개명하면 **`lib/stockSort.ts`(공개 유틸) → `lib/pnl/aggregate.ts`(손익 도메인) 계층 역전도 함께 풀린다** — 두 개는 같은 작업이니 묶는 게 이득이다.
- Task 7 fix 의 「확정 연간 행이 없는 연도만 derive」에 **회귀 테스트가 없다**(되돌려도 기존 테스트가 통과한다). 순수 입력으로 시험 가능하다.
- `buildCorpAchievement` 무커버리지 · JSDoc 3곳에 2026 잔존(`pnl/aggregate.ts:57-58`, `finance/pnl-derived.ts:60`)
- `/api/chat` 에 역할 게이트 없음 — 데이터 유출은 아니지만(도구 화이트리스트가 사외비 제외) guest 도 Anthropic API 를 태울 수 있다. **정책 결정 사항**
- Task 6 의 `isYtd` 는 과거 연도에 분기 구멍이 나면 그 해를 영구히 YTD 로 표시한다(2021 부터 완전 백필이라 현재는 무해)

### 알아 둘 것

- ~~AGENTS.md 여유가 5바이트뿐이다~~ — **2026-09-09 다이어트로 해소**(36,537B, 여유 963B). 경위는 맨 위 블록. 다만 「함정은 `docs/gotchas-*.md` 가 정본」이라는 원칙 자체는 그대로다.
- 이번에 얻은 함정 2건은 `docs/gotchas-data-collection.md` 끝에 적었다 — 「형제 함수가 이미 옳게 고쳐져 있는데 따라가지 않는다」·「세션을 통과했다고 권한이 있는 것이 아니다」.
- `.superpowers/` 는 git-ignored 작업 폴더다. 이번 작업의 Task별 리뷰 판정·E2E 스크린샷 11장이 거기 있다.
