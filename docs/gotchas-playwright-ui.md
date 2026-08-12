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
  - **로그인 계정 검증**: `getUsersFromEnv`는 모듈 레벨 캐시 → `.env.local`(계정) 변경 후 **dev 서버 재시작**(미반영 의심 시 새 포트로 fresh 기동). 로그인 redirect 체인(`/login`→`/`→`/management`→탭)은 200(RSC client redirect)이라 `wait_for_url(...'/login' not in u)`가 중간 `/`에서 조기 종료 → **최종 기대 경로까지** 대기.

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
