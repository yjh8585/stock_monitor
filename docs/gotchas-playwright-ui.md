# 함정: Playwright · UI 검증 · dev 서버

`AGENTS.md`에서 옮겨온 실측 함정 전문이다(원문 보존). **분량이 커 자동 로드에서 뺐을 뿐,
중요도는 그대로다.** UI를 브라우저로 검증하기 전에 해당 항목을 읽는다.

| 트리거                                                                 | 볼 항목                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| dev 서버가 재기동 안 됨 (`Another next dev server is already running`) | dev 서버 종료                                                 |
| 로그인이 404 / Server Action 오류                                      | 검증 산출물 위치 · 로그인 실패 진단                           |
| 보호 라우트(`/management/*`) UI 검증                                   | 보호 라우트 UI Playwright 검증                                |
| recharts 차트 개수·라벨이 0으로 측정됨                                 | 보호 라우트 UI Playwright 검증 (LazyMount·portal·headless 절) |
| 사외비 화면 검증                                                       | 사외비 차트 검증 (금액 비노출 규칙)                           |
| 권한 차단이 404인지 확인                                               | 권한 차단 검증을 HTTP 상태 코드로 하지 말 것                  |

---

- **권한 차단 검증을 HTTP 상태 코드로 하지 말 것** (2026-08-06 실측): `cacheComponents`(PPR)는 정적 셸을 **먼저 200으로 흘려보내고** 본문을 스트리밍하므로, 페이지 안에서 `notFound()`가 걸려도 **응답은 200**이다(화면은 404로 보인다). `resp.status == 404`로 판정하면 멀쩡한 차단을 실패로 오진한다. 판정 기준은 **내용이 새는가** — 본문 컨테이너(`article.prose`) 유무·핵심 요소 개수·제목 문자열 포함 여부로 확인하고, 보조로 404 문구를 본다.

- **dev 서버 종료는 포트 점유 PID를 직접 kill**: 래퍼(`npm run dev`)만 죽이면 자식 `next`가 포트를 물고 있어 재기동이 `⨯ Another next dev server is already running`으로 exit 1. `(Get-NetTCPConnection -LocalPort <port> -State Listen).OwningProcess` → `taskkill //PID <pid> //F`.

- **검증 산출물(스크린샷·로그)은 프로젝트 밖(scratchpad)에 쓸 것**: 프로젝트 폴더에 쓰면 Turbopack이 재컴파일해 Server Action ID가 어긋나고, 로그인 POST가 404(`Failed to find Server Action`) + 쿠키 미생성으로 깨진다. `.gitignore` 대상 폴더(`참고/`)도 **파일 감시자는 gitignore와 무관**하므로 예외 아님. 처방은 `.next` 삭제 후 재기동.

- **Playwright 로그인 실패 시 dev 서버 로그부터 확인**: `POST /login 303`이면 인증 성공(그 뒤 튕기면 다른 문제), `POST /login 404` + Server Action 오류면 위 항목. 인증 코드·`permissions.ts`를 먼저 의심하지 말 것.

- **보호 라우트 UI Playwright 검증**: `.env.local` dotenv 로드(`MOBILITY_ID/PW`) + 클릭 후 **고정 대기(2.5s) → 목표 URL 직접 `goto` → `'/login' in page.url` 체크**가 안정적(`wait_for_url`은 리다이렉트 체인이 호출 전에 끝나면 navigation 이벤트를 못 잡고 30초 타임아웃 → 간헐 실패. `networkidle`도 client redirect 전 반환). 루트 `.env.local` 로드 경로는 스크립트 깊이에 맞출 것 — `scripts/*.py`는 `parent.parent`지만 `scripts/_*/*.py`(중첩 일회성)는 `Path(__file__).resolve().parents[2]`(아니면 `scripts/.env.local`을 찾아 `MOBILITY_ID` KeyError). `LazyMount` 차트(recharts)는 IntersectionObserver라 스크롤해야 마운트(`wait_for_selector` 데드락). 단 **`/management/*`는 window가 아니라 레이아웃의 `div.flex-1.overflow-auto`가 스크롤**한다(`document.scrollingElement.scrollHeight == innerHeight`) → `mouse.wheel`·`window.scrollTo`는 커서 위치에 따라 안 먹어 **좁은 폭에서 차트가 0개로 오측정**(2026-07-15 실측 — 데스크톱은 통과, 390/820px만 0). 스크롤 컨테이너를 직접 찾아 `scrollTop`을 JS로 올릴 것(`overflowY` in `auto|scroll` 인 첫 엘리먼트). Turbopack dev 첫 진입 시 `/management/*` 탭이 간헐 404(컴파일 캐시) → 새로고침/dev 재시작; 한 라우트를 여러 번 편집한 뒤 **404가 재시작·새로고침으로도 안 풀리면 `rm -rf .next` 후 재기동**(코드 회귀 아님). 같은 캐시 이유로 `'use cache'`(서버 fetch) 결과가 dev에서 **stale**할 수 있어(편집해도 옛 server-cache 값 표시) UI 검증 전 dev 재시작/`.next` 삭제로 fresh 확인.
  - **사외비 차트 검증**은 금액 셀 미접근 — 라벨/범례 텍스트만 `evaluate`로 추출(자격증명은 dotenv 환경 로드, stdout 비노출). 픽셀 좌표 측정은 과다 스크롤 시 화면 밖(음수 좌표)으로 오측정 → element `screenshot` 또는 `scrollTo(0,0)` 후 측정. recharts SVG `<text>`는 `inner_text()` 불가(HTMLElement 아님) → `evaluate`로 `textContent`. **recharts v3는 `zIndex` 레이어를 portal로 뽑는다** — `ReferenceLine`의 `label`은 `.recharts-reference-line` 안이 아니라 형제 `g.recharts-zIndex-layer_2000`에 그려지므로, 부모에 스코프한 선택자(`.recharts-reference-line text`)는 **정상 렌더인데도 0개**를 반환한다(2026-07-15 — 이걸로 멀쩡한 라벨을 버그로 오진할 뻔). 라벨 검증은 `document.querySelectorAll('svg text')` 전역에서 텍스트로 찾을 것. 스타일·구조 검증은 `getComputedStyle`(fontSize·border 등)·소수점 유무 boolean·요소 개수만 추출(금액값 미출력). **headless에선 recharts 축 틱 `<text>` 자체가 안 그려짐**(틱 라인·막대 개수만 신뢰; 축 라벨 문자열 정확성은 vitest로 — 브라우저에서 "틱에 X 없음"은 **헛통과**함에 주의). 반면 **데이터 라벨(`.recharts-label-list text`)은 headless에서도 개수·bbox 측정 가능**(겹침 판정 등) — 단 **실행 중 `set_viewport_size`로 폭을 바꾸면 차트가 다시 그려져 라벨이 0개로 측정**되니 폭별 검증은 **폭마다 새 컨텍스트**로 열 것. 막대·범례의 **색 대조**(`fill`/`style.background`)는 금액과 무관해 안전하며, 범례-막대 순서 불일치 같은 조용한 버그를 잡는 데 유효. HTML 표는 in-page에서 관계 계산(세로합==합계 등) 후 **불리언만** 출력, 구조 텍스트는 정규식으로 숫자 `#` 마스킹. **`/management/*`는 `browser_snapshot`이 토큰 한도를 넘겨(70~98k) 실패** → 스냅샷 대신 `browser_evaluate`로 필요한 것만 구조 추출. **차트 날짜 범위는 `.recharts-bar-rectangle` 개수 ÷ 막대 시리즈 수**로 검증(headless가 축 틱 텍스트를 안 그리므로 — 예: 스텔란티스 차트2 130÷2=65개월=2021.01 시작). LazyMount 차트는 스크롤을 조금씩 내리며 **섹션이 마운트되면 멈춰 recharts 렌더 대기 후** 측정(지나쳐 스크롤하면 섹션이 다시 안 잡힘).
  - 🔴 **recharts 가 많은 페이지에서 `locator.screenshot()` 은 "waiting for element to be stable" 로 타임아웃한다**(2026-08-13 `/oem/competition` 실측 — `animations='disabled'` 를 줘도 2회 연속 실패). 위 항목의 "element `screenshot`" 권고는 **정적인 표·카드에만** 적용하고, 차트가 든 섹션은 **JS 로 스크롤한 뒤 뷰포트를 찍는다**(`page.evaluate` 로 `window.scrollTo(0, el.getBoundingClientRect().top + scrollY)` → `wait_for_timeout` → `page.screenshot()`). `full_page=True` 는 세로가 길어 글자가 뭉개져 판독용으로 못 쓴다.
  - **로그인 폼 셀렉터는 `input[name="id"]` · `input[name="password"]`** — `username` 이 아니다(추측하면 30초 타임아웃만 쓴다). 정본은 `scripts/e2e_smoke.py`.
  - 🔴 **`scripts/.env` 의 `NEXT_REVALIDATE_URL` 은 3000 을 가리키는데 dev 는 3001+ 로 뜬다**(3000 은 다른 앱 점유). 그대로 `revalidate_tags()` 를 부르면 **404 로 조용히 스킵**되고 `'use cache'` 가 옛 값을 그대로 들고 있어 **"코드를 고쳤는데 화면이 안 바뀐다"로 오진**하기 쉽다(2026-08-13 실측). 호출 전 `NEXT_REVALIDATE_URL` 을 실제 포트로 덮어쓰거나 `/api/revalidate` 에 직접 POST 할 것.
  - **로그인 계정 검증**: `getUsersFromEnv`는 모듈 레벨 캐시 → `.env.local`(계정) 변경 후 **dev 서버 재시작**(미반영 의심 시 새 포트로 fresh 기동). 로그인 redirect 체인(`/login`→`/`→`/management`→탭)은 200(RSC client redirect)이라 `wait_for_url(...'/login' not in u)`가 중간 `/`에서 조기 종료 → **최종 기대 경로까지** 대기.

- 🔴 **E2E smoke 가 「실패할 수 없는 검사기」였다** (2026-09-09 실측 · `scripts/e2e_smoke.py`). 위의 「권한 차단을 HTTP 상태로 판정하지 말 것」이 **로그인 판정에도 그대로 적용된다** — PPR 이 셸을 먼저 200 으로 흘려보내므로, 로그인이 통째로 실패해도 아홉 라우트가 전부 로그인 폼을 200 으로 돌려주고 스크립트는 `[OK]` 를 아홉 번 찍었다. 판정을 **내용**으로 바꿨다(`input[name="password"]` 가 보이면 로그아웃 상태). 🔴 **`page.url` 로도 판정하면 안 된다** — 로그인 리다이렉트 체인이 `networkidle` 뒤에도 진행 중이라 **성공했는데도** 주소가 아직 `/login` 인 순간이 있다(그래서 로그인 뒤 **고정 대기 2.5초**가 필요하다). 시험은 양방향으로 한다 — 정상 계정 exit 0 · 틀린 비밀번호 exit 1 을 **둘 다** 확인했다. 차단만 시험하면 우회로가, 통과만 시험하면 과잉 차단이 조용히 산다.

- 🔴 **그 스크립트가 산출물을 프로젝트 «안» 에 쓰고 있었다**(같은 날 수리). 위의 「검증 산출물은 프로젝트 밖에」 항목을 정작 이 스크립트가 어겨 `data/_e2e_screenshots/` 와 `scripts/_e2e_smoke_report.json` 에 썼다 — **자기가 만든 파일로 Turbopack 재컴파일을 유발해 자기 로그인을 깨뜨릴 수 있는** 구조였다. 기본값을 임시 폴더로 옮기고 `E2E_OUT_DIR` 로 바꿀 수 있게 했다. 아울러 소스에 박혀 있던 아이디·비밀번호 기본값을 걷었다(없으면 시작 전에 멈춘다) — 자격증명이 저장소에 남는 것도 문제지만, **`.env.local` 이 안 읽혀도 로그인이 되는 것처럼 보여** 계정이 바뀐 뒤에야 엉뚱한 곳을 의심하게 된다. 기본 포트도 3000 → **3001** 로 고쳤다(3000 은 다른 앱 점유).

- 🔴 **역할별 접근 E2E 를 admin 으로 돌리면 아무것도 못 잡는다**(2026-09-09 확장 · `scripts/e2e_smoke.py`). `permissions.ts` 의 `canAccess` 첫 줄이 `if (role === 'admin') return true` 라서 admin 은 **모든 경로를 통과**한다 — 「열리는가」만 재고 「막히는가」는 한 번도 안 재게 된다. `.env.local` 에 다섯 역할(`ADMIN`·`HOLDING`·`MOBILITY`·`HMOBILITY`·`GUEST`) 계정이 이미 있으니 **검증 전용 계정을 새로 만들 필요는 없다.** 기대표(역할 × 라우트)는 `permissions.ts` 를 import 해 만들지 **않는다** — 구현이 곧 정답이 되어 규칙 변경을 영원히 통과시킨다. 기대표에 차단 칸·허용 칸이 둘 다 있는지는 `_assertMatrixIsBidirectional` 이 실행 전에 강제하고, 「틀린 기대를 넣으면 정말 빨개지는가」는 `--self-test` 4건이 확인한다.

- ⚠️ **접근 판정을 「주소가 정확히 같은가」로 하면 정상 이동이 차단으로 찍힌다**(같은 날 실측 · 오탐 5건). `/etc` 는 설계상 `/etc/fx`(환율 탭)로 자동 이동하는데, 정확히 일치만 보면 다섯 역할 전부에서 `deny` 가 됐다. 권한 차단은 `proxy.ts` 의 서버 리다이렉트라 항상 `/` 나 역할별 랜딩으로 **나가므로** 하위 경로가 될 수 없다 → **접두 비교**(`path == route or path.startswith(route + '/')`)로 둘을 정확히 가른다. ⚠️ 이 자리에서 주소를 봐도 되는 이유는 서버 리다이렉트가 `networkidle` 전에 끝나기 때문이고, **로그인 판정은 여전히 주소로 하면 안 된다**(위 항목).

- ⚠️ **화면 실물 확인을 `table` 하나로 통일하면 차트 화면이 전부 오탐이 된다**(같은 날 실측 · 오탐 6건). `/compare` · `/management/inventory` · `/management/org-chart` 는 표가 아니라 **svg 차트**로 그린다(각 53·17·15개). 라우트별 선택자는 **표인지 그림인지 갈리는 곳만** 적고, 나머지는 **공통 바닥**(본문 글자 200자 하한 + `table, svg, canvas` 중 하나 이상)으로 받는다. 🔴 선택자를 적은 라우트만 검사하면 **안 적은 라우트는 영영 무검사로 통과**한다 — 실제로 `/management/companies` · `/management/upload` 가 그 구멍으로 빠져 있었다.

- 🔴 **「열리는가」와 「눌러서 동작하는가」는 다른 검사다**(2026-09-09 신설 · `scripts/e2e_interact.py`). `e2e_smoke.py` 는 65칸이 전부 초록이어도 **필터가 통째로 죽어 있으면 그대로 초록이다** — 화면이 열리고 표가 그려지는 것까지만 보기 때문이다. 그래서 조작 검사를 따로 뒀다(`/related-stocks` 16건). 🔴 **조작 시험도 양방향으로 쓴다**: 「끄면 줄어든다」만 재면 **아무 때나 0행을 내는 고장**도 통과한다 → ①끄면 줄고 ②**켜면 돌아오고** ③남은 행이 실제로 조건에 맞는지 셋을 함께 본다. 정렬은 「순서가 바뀌었다」가 아니라 **값이 실제로 정렬돼 있는가**(단조 감소/증가)를 재고, 팝업은 뜨는 것과 **Esc 로 닫히는 것**을 함께 잰다.

- ⚠️ **표 칸의 빈 값을 `0` 으로 읽으면 정렬 시험이 틀린 채 통과한다.** 「맨 아래가 0이니 내림차순 맞다」가 되기 때문이다. `parseNum` 은 숫자가 없으면 **`None` 을 돌려주고 그 행을 뺀다.** 🔴 다만 2026-09-09 현재 `/related-stocks` 의 매출 열에는 **빈 칸이 하나도 없어** 이 방어는 실물로 검증되지 않았다(단위 자기시험만 덮는다) — 뮤테이션으로 0 취급을 넣어도 실패가 안 났다. 매출이 빈 회사가 생기면 그때 다시 잰다. **「뮤테이션이 안 죽었다」가 늘 검사기 결함인 것은 아니고, 현재 자료가 그 갈래를 안 밟는 것일 수 있다.**

- ⚠️ **뮤테이션 시험에서 바꿔 끼울 함수는 «먼저» 원본을 붙잡아 둔다.** `lambda t: (E.parseNum(t) or 0)` 처럼 모듈 속성을 그대로 부르면 **교체된 자기 자신을 불러 무한 재귀**가 난다(실제로 `RecursionError` 가 났다). `_orig = E.parseNum` 을 먼저 잡고 람다는 그것을 부른다.

- ⚠️ **dev 서버의 첫 컴파일이 30초를 넘겨 E2E 한 칸이 간헐 실패한다**(2026-09-09 실측). 65칸 중 `admin//management/org-chart` 하나만 시간 초과로 빨개졌고 곧바로 그 역할만 다시 돌리니 13/13 통과였다 — **화면 문제가 아니라 환경 문제다.** `checkRoute` 가 **시간 초과일 때만** 한 번 다시 본다. 🔴 다른 실패(차단 오판·본문 없음)까지 재시도하면 간헐 통과로 **진짜 결함을 숨긴다.**

- 🔴 **조작 E2E 는 화면마다 사양을 «따로» 둔다 — 한 화면 것을 복사하면 조용히 0건이 된다**(2026-09-09 네 화면 실측 · `scripts/e2e_interact.py`). 같은 「표 화면」인데 딴판이었다: `/oem` 은 **누를 수 있는 머리글이 0개**이고 뉴스 팝업도 없다 · `/parts-top100` 의 구분 필터는 「국가」인데 `/domestic` 은 「그룹」이다 · 행 수도 27/126/133/80 으로 제각각이다. ⚠️ **`/oem` 의 「연간·월간」은 필터가 아니라 차트의 기간 전환 탭**(`role="tab"`)이라 눌러도 **행 수가 안 변한다**(80 → 80). 필터로 알고 걸었다가 2건이 빨개졌고, 실제로 바뀌는 것은 **선택된 탭**과 **막대 개수**(951 ↔ 944)였다 — 표가 아니라 그림을 봐야 하는 자리다. 🔴 사양을 덜 적으면 그 화면은 「행이 있다」 한 줄만 재고 초록으로 끝나므로, `_assertScreensMeasureSomething` 이 **잴 조작이 하나도 없는 사양**을 실행 전에 막는다.

- ⚠️ **Git Bash 에서 `--route /oem` 처럼 슬래시로 시작하는 인자는 윈도우 경로로 바뀐다.** `C:/Program Files/Git/oem` 이 되어 사양을 못 찾는다 → `MSYS_NO_PATHCONV=1` 을 앞에 붙인다. 🔴 이때 스크립트가 **조용히 0건으로 끝나지 않고 「그 사양이 없다」로 실패**하게 해 둔 것이 이 오류를 즉시 드러냈다 — 없는 대상을 지정하면 통과가 아니라 실패여야 한다.

- ✅ **`NEXT_REVALIDATE_PROD_URL` 이 GitHub Secrets 에 없는 것은 «문제가 아니다»**(2026-09-09 판정 — 재조사 금지). 워크플로 중 이 값을 넘기는 것은 `collect-yt-report.yml` 하나뿐이고, 그 스크립트는 `PROD_URL or NEXT_REVALIDATE_URL` 로 **대체 경로**를 탄다(`collect_yt_report.py:316`). `--revalidate-prod` 를 쓰는 나머지 셋(`sync_finance`·`sync_inventory`·`collect_stellantis_shipments_ir`)은 **로컬 수동 실행 전용**이라 `.env.local` 을 읽고, 거기엔 값이 있다. 실행 기록으로도 확인했다 — 최근 수집 런 로그에 `✓ cache revalidated [default]` 가 찍혀 있고, 이 줄은 **HTTP 200 일 때만** 나온다(`lib/revalidate.py:_post_revalidate`). ⚠️ 다만 `collect-yt-report.yml` 의 `NEXT_REVALIDATE_PROD_URL:` 줄은 **없는 시크릿을 가리키는 죽은 설정**이라 다음 사람이 또 조사하게 된다 — 지우지 않고 여기 남긴다.

- 🔴 **차트 화면의 「달라졌는가」를 `outerHTML` 해시로 재면 안 된다**(2026-09-09 실측). recharts 는 다시 그릴 때마다 `clipPath` 등에 **무작위 id** 를 새로 붙여서, 자료가 똑같아도 겉모양 문자열이 매번 달라진다. 「되돌렸는데 안 돌아왔다」로 보이던 실패 3건의 진짜 원인이 이것이었다 — **화면 고장이 아니라 재는 방법이 틀린 것**이다. **자료가 결정하는 것**(도형의 `d`·`x`·`y`·`width`·`height`·`cx`·`cy` 와 `<text>` 내용)만 모아 해시한다.

- 🔴 **지문 범위를 화면 «전체» 로 잡지 말 것.** `/management/inventory` 는 차트 묶음이 넷이라, 한 묶음의 버튼을 눌러도 다른 묶음까지 지문에 들어가 **누를 때마다 새 값**이 나온다. 누른 버튼에서 위로 올라가 **그 버튼과 같은 구역의 svg 만** 잰다(`sectionSigFor`).

- 🔴 **버튼 묶음이 「하나만 고르기」인지 「켜고 끄기」인지 먼저 확인한다.** `/management/inventory` 의 지역 버튼을 라디오로 알고 A→B→A 로 눌렀더니 **다섯 번 다 새 상태**였다 — 켜고 끄기라 되돌리려면 **같은 버튼을 한 번 더** 눌러야 한다. ⚠️ 같은 이름의 버튼이 **여러 묶음에 있을 수 있다**(「미국」이 해외·운송 두 곳에) — 이름으로 찾으면 앞엣것이 눌리므로, 짝은 반드시 **같은 묶음 안에서** 고른다.

- ⚠️ **되돌려도 처음 상태가 «될 수 없는» 화면이 있다.** `/compare` 는 두 칸에 같은 회사를 못 담는 설계라, 첫 칸을 B 로 바꾸면 B 가 들어 있던 둘째 칸이 「(선택 안 함)」으로 비워지고 되돌려도 안 채워진다. 이런 곳은 그림 복원 대신 **선택값이 원래대로 돌아오는지** 로 잰다. ⚠️ 회사 이름이 단추처럼 보이지만 **선택상자**라, 토글로 알고 두 번 누르면 두 번째 클릭이 열려 있는 목록에 가로막혀 30초 타임아웃이 난다.

- 🔴 **「선택상자」가 화면마다 «다른 물건» 이다 — 함수를 재사용하기 전에 실물을 본다**(2026-09-10 실측 · `/management/org-chart`). `/compare` 의 것은 만든 부품(`[data-slot="select-trigger"]`)이라 `_openSelect` 가 잡지만, 조직도의 것은 **브라우저 기본 `<select>`** 라 같은 함수가 **0개를 만나 멈춘다**. 겉보기는 둘 다 「고르는 칸」이라 사양을 복사하기 딱 좋은 자리다 — 기본 선택상자는 `page.select_option` 으로 잰다(`checkNativeSelect`). ✅ **멈춘 것이 다행이다** — 조용히 0건이었으면 「검사했다」로 지나갔다.

- 🔴 **화면에 svg 가 많다고 그것이 «내용» 인 것은 아니다**(같은 날 실측). 조직도 화면은 svg 가 14개지만 **전부 메뉴 아이콘**이고, 조직도 자체는 **그림 파일**(`<img src=".../org-chart/image/<id>">`)이다. 그래서 시점을 바꿔도 svg 지문이 **세 번 다 똑같았다**(`2067657579`) — `svgSignature` 로 재는 사양을 적었다면 「안 바뀐다」로 **영원히 빨간불**이었을 것이다. 자료가 결정하는 것은 **그림 주소**뿐이라 그것으로 잰다. ⚠️ 앞선 항목의 「`/management/org-chart` 는 svg 차트로 그린다(15개)」는 **열리는가 검사의 공통 바닥**을 말한 것이고, **무엇이 달라지는가** 를 재는 자리에서는 그 15개가 아무 쓸모가 없다 — **같은 숫자가 다른 검사에서는 다른 뜻**이다.

- ✅ **새 검사는 「통과했다」가 아니라 「실패할 수 있는가」로 확인한다**(같은 날 · 뮤테이션 4건). 없는 그림·없는 단추를 가리키면 빨개지는가 · 그림 주소를 늘 같은 값으로 고정하면 「바뀐다」가 빨개지는가 · 매번 다른 값을 내면 「돌아온다」가 빨개지는가. 넷 다 빨개지는 것을 확인하고서야 초록을 믿었다. ⚠️ 바꿔 끼울 함수는 **먼저 원본을 붙잡아 둔다**(`_origImgSrc = E.imgSrcFor`) — 모듈 속성을 그대로 부르면 교체된 자기 자신을 불러 무한 재귀가 난다.

- ⚠️ **`.next` 를 지운 뒤 첫 전체 E2E 는 시간 초과가 «정상» 이다**(2026-09-10). 라우트마다 처음 열 때 컴파일하므로 `/oem` 이 `networkidle` 60초를 넘겼다. 곧바로 다시 돌리니 **64건 전부 통과**였다 — 화면 문제가 아니라 환경 문제다(위 「첫 컴파일 30초」 항목과 같은 뿌리). 🔴 이때 코드를 고치기 시작하면 **멀쩡한 것을 망가뜨린다.**

- ✅ **`verify_no_secrets.py` 가 그날 바로 값을 했다** — 핸드오프를 쓰면서 내가 `MOBILITY_ID` 값을 본문에 그대로 적었고 검사기가 잡았다(`HANDOFF.md:62`). 🔴 **자격증명 이야기를 «문서로 남길 때» 가 가장 새기 쉬운 자리다** — 경위를 정확히 적으려다 값을 옮겨 적게 된다. 값 대신 **키 이름**으로 쓴다(`MOBILITY_ID 값(회사 이름)`).

---

## 컴포넌트 함정 (AGENTS.md에서 이관, 2026-08-12)

### `<Toaster />`(sonner)가 없으면 `toast.*()`는 조용히 무시된다

2026-07-30에 추가하기 전까지 **`<Toaster />`가 어디에도 마운트돼 있지 않았다.** 그동안
`toast.success/error(...)` 호출이 **업로드·회사등록·보고서 폼 4곳에서 아무 일도 하지 않았다** —
에러도 경고도 없이 그냥 안 떴다.

- 마운트 위치는 `app/layout.tsx` 의 body 끝, `position="top-center"`.
- 🔴 **우하단(`bottom-right`)으로 옮기지 말 것** — 챗봇 버튼(`fixed bottom-5 right-5 z-40`)이 그 자리를
  점유해서 toast 가 가려진다.
- **toast 를 새로 썼는데 화면에 안 뜨면 이 마운트가 살아 있는지부터 확인한다.** 컴포넌트 쪽을
  디버깅하기 전에 `app/layout.tsx` 를 먼저 볼 것.

**자리 옆에 붙어야 의미가 있는 검증 오류는 toast 가 아니라 인라인 요소로** 낸다(`<p role="alert">`).
업로드 폼의 확장자 거절이 그 예다 — 드롭존에서 파일이 거절됐는데 안내가 화면 상단에 뜨면
사용자는 자기가 뭘 잘못했는지 연결하지 못한다.

### base-ui `Select` — `value`와 표시 라벨이 다르면 root에 `items`를 줘야 한다

`components/ui/` 의 Select 는 shadcn 기본이 아니라 **base-ui(`@base-ui/react/select`) 기반**이다.

`SelectItem` 의 `value` 가 화면에 보여줄 라벨과 다르면, root 에
`<Select items={[{value,label},…]}>` 를 넘겨야 트리거가 라벨을 표시한다.
안 넘기면 **트리거에 raw value 가 그대로 노출된다**(2026-07-17 실측).
