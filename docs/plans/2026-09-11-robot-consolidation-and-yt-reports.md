# 로봇 글 휴머노이드 일원화 + 증권사 리포트 표 UI + 유튜브 5편 게시 (2026-09-11)

## 사용자 지시 원문

> - 지금 보고서 페이지의 로봇 카테고리 게시글이 휴머노이드 페이지와 보고서 페이지에 중복 게시되어 있는데 휴머노이드 페이지에서만 보이도록 해. 이제 로봇 관련된 것은 다 휴머노이드로 옮길 거야.
> - 휴머노이드의 증권사 리포트 페이지와 보고서 페이지의 ui가 다른데 보고서 페이지 ui로 통일해줘.
> - 이제 유튜브나 pdf 파일 바탕으로 보고서 만들 때 오퍼스 최신 모델을 사용해.
> - 보고서 페이지 게시글 작성 : https://youtu.be/lb92luVHn-o?si=yDd_DnFbbW1g2tB4, https://youtu.be/SE7KEnX3Qps?si=Y8GDLgWxW_yn-SqU
> - 로봇 페이지 게시글 작성 : https://youtu.be/CH1FrANSxgU?si=tAPLrUjyS4DokaHp, https://youtu.be/qgvpo2bakFQ?si=fm9AKZ0OBcViQ23Z, https://youtu.be/4LPWH2hCIUk?si=BQN6VjXtg0bICZ-r

추가 지시 (2026-09-11, AskUserQuestion 답변 원문):

> 아 자동으로 할 때는 지금의 방식 그대로 하고, 내가 클로드코드에서 작성할 때 오퍼스를 쓰라는 이야기야.

## 기존 계획서와의 관계 (착수 전 정독함)

| 계획서                                                            | 이번 작업이 건드리는 확정 결정               | 처리                                                               |
| ----------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| `agents/.../2026-08-24-humanoid-research.md` 결정 2               | 보고서(posts 로봇) / 증권사 리포트 원천 분리 | **그대로 유지** — 두 탭은 계속 원천이 다르다                       |
| `docs/plans/2026-08-25-humanoid-improvements.md` 결정 2 · 작업 B7 | 화면 형태 = 목록 + 상세, 목록은 **카드**     | 목록+상세 구조 유지. **카드 → 표**는 2026-09-11 사용자 지시로 변경 |

## 확정된 결정 (AskUserQuestion + grill-me 심문, 2026-09-11)

| #   | 결정                            | 사용자 선택                                                                                            |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | 증권사 리포트 표 구조           | **완전 평면화** — 리포트 1건 = 1행. 증권사×종목 묶음과 「이전 리포트」 펼치기 폐기                     |
| 2   | 오퍼스 지시의 코드 반영 범위    | **코드 변경 없음** — 자동 경로(Haiku·Gemini) 유지. Claude Code 수동 작성 시 `claude-opus-5`            |
| 3   | 계획서                          | 새 계획서로 진행 (이 파일)                                                                             |
| 4   | 로봇 분류 안전망                | **제목 키워드로 강제** — 제목에 로봇어가 있으면 LLM 판정과 무관하게 `category='로봇'`                  |
| 5   | 증권사 리포트 필터·페이지네이션 | **표만 통일, 필터는 즉각 반응 유지**(클라이언트). 서버 방식은 필터 조합마다 캐시가 쌓여 ISR Write 위험 |
| 6   | 로봇 글 상세 화면               | **`/humanoid/reports/[id]` 신설** — 휴머노이드 탭 안에서 본문을 본다                                   |

## 진단 (실측 2026-09-11)

- `posts` 카테고리 분포: OEM 29 · 시장 19 · 기술 19 · 전기차 11 · **로봇 8** · 자율주행 8 · 부품사 5 · null 5 · 기타 3.
  제목에 로봇·휴머노이드가 든 글은 **전부 이미 `category='로봇'`** — 과거 글 재분류는 불필요하다.
- 분류기(`classifyCategory`)는 "없으면 적합한 한 단어"를 허용해 `글로벌 자동차`·`해외사업` 같은 목록 밖 값이 실제로 들어와 있다 → 로봇을 LLM 판정에만 맡기면 새는 것이 결정 4의 근거.
- `/reports`와 `/humanoid/reports`는 **같은 `posts` 표**를 본다. 후자만 `category='로봇'`으로 좁혀 중복이 생겼다.
- `components/reports/post-list.tsx`의 `buildSortHref()`와 `post-filter.tsx`의 `push()`가 `/reports`를 **하드코딩** → 휴머노이드에서 정렬을 누르면 게시판으로 튄다(현재도 있는 버그).
- `research_reports` 155건 중 요약 76건, 새 규격 정리본만 목록에 오른다(`CURATED_PREFIX = '>'`). 증권사 17 · 대상 50.

## 작업

### A. 로봇 글을 휴머노이드 전용으로

- **A1** 로봇 카테고리 상수와 제목 키워드를 SSOT 한 곳(`lib/reports/robot.ts`)에 둔다.
- **A2** `PostRepository.list()`에 `excludeCategory` 옵션, `getDistinctCategories()`에도 제외 → `/reports` 목록·필터 드롭다운 양쪽에서 사라진다.
- **A3** `app/reports/page.tsx`가 로봇 제외로 조회. `?category=로봇`으로 직접 들어와도 안 보인다.
- **A4** `classifyCategory()`에 제목 키워드 강제(결정 4). ASCII `robot`은 단어 경계로, 한글은 부분일치로 — 한국어에 `\b`는 무동작이다.
- **A5** `PostList`·`PostFilter`·`PostPagination`에 `basePath` prop(기본 `/reports`).
- **A6** `/humanoid/reports`의 「보고서 게시판에서 보기」 링크 제거.

### B. 로봇 글 상세를 휴머노이드 안에 (결정 6)

- **B1** `app/reports/[id]/page.tsx`의 본문을 `components/reports/post-detail.tsx`로 뽑고 `backHref`를 인자로 받는다(사외비 게이트·삭제 버튼·상태 감시는 그대로 옮긴다).
- **B2** `app/humanoid/reports/[id]/page.tsx` 신설 — 같은 컴포넌트에 `backHref="/humanoid/reports"`.
- **B3** `/humanoid/reports` 목록의 링크를 `/humanoid/reports/<id>`로.

### C. 증권사 리포트를 보고서 페이지 표 UI로

- **C1** `lib/humanoid/research.ts` — 평면 행 목록(`rows`)을 내려준다. 상세 조회(`getResearchDetail`)는 건드리지 않는다.
- **C2** `components/humanoid/research-list.tsx` — 카드를 `PostList`와 같은 표로 재작성.
  컬럼: No. / 종목·업종 / 제목 / 증권사 / 의견 / 목표가 / 작성일. 파란 헤더·정렬 아이콘·번호 역순까지 같게.
- **C3** 필터 바(검색·증권사·종목·기간)는 유지하고 **클라이언트 페이지네이션**을 붙인다(결정 5).
- **C4** `cacheLife` 는 지금 값을 유지 — ISR Write 규칙.

### D. 유튜브 5편 → 보고서 게시 (report.md §7 · yt_report 툴킷)

| key | 영상                                                      | 채널       | 게시 대상         |
| --- | --------------------------------------------------------- | ---------- | ----------------- |
| v1  | 현대차 소프트웨어는 왜 아직 돈을 못벌까 (현대오토에버)    | 대신TV     | `/reports`        |
| v2  | 자동차 안 팝니다, 전기차는 포기합니다 (딥다이브 모아보기) | 딥다이브   | `/reports`        |
| v3  | 세계의 공장 다시 노리는 중국 (딥엑스 김녹원 대표)         | 언더스탠딩 | `category='로봇'` |
| v4  | 중국 1위 로봇회사의 폭로 (해담경제연구소 어예진 소장)     | 언더스탠딩 | `category='로봇'` |
| v5  | 엔비디아가 찾아왔다 (스카이인텔리전스 이재철 대표)        | 언더스탠딩 | `category='로봇'` |

- 절차는 `scripts/yt_report/README.md` 12단계 그대로. 산출물 `YT_RUN_DIR=scripts/_yt_report/2026-09-11`.
- 본문 작성·프레임 선별은 **claude-opus-5**(결정 2). 언더스탠딩 3편은 진행자 패널 레이아웃이라 `crop.py` 필요.
- 🔴 차트·도해 전수 캡처(report.md §7-4) + 2차 패스(§7-A) 필수.

## 검증

- `npm run check-all`
- `scripts/venv/Scripts/python.exe scripts/verify_revalidate_tags.py` (exit 0 이 정상)
- dev 서버 육안 확인 — `/reports`(로봇 0건 · 필터에 로봇 없음) · `/humanoid/reports`(정렬이 제자리 · 상세가 휴머노이드 탭 안) · `/humanoid/research`(표)
- `python scripts/yt_report/verify.py --ids <게시된 id들>` → `ALL_OK`
