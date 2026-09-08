# HANDOFF

다음 세션이 그대로 이어받기 위한 인수인계 기록. **맨 위가 최신**이고, 새 블록을 쓸 때
직전 블록은 `## 이전 상태 …` 로 강등한다.

---

## 최신 상태 · 재개 지점 (2026-09-08)

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

- 🔴 **AGENTS.md 자동 로드 분량이 37,495B / 상한 37,500B 다.** 여유가 **5바이트**뿐이니 다음 추가는 반드시 `docs/gotchas-*.md` 로 가고 AGENTS.md 에는 트리거 한 줄만 남긴다.
- 이번에 얻은 함정 2건은 `docs/gotchas-data-collection.md` 끝에 적었다 — 「형제 함수가 이미 옳게 고쳐져 있는데 따라가지 않는다」·「세션을 통과했다고 권한이 있는 것이 아니다」.
- `.superpowers/` 는 git-ignored 작업 폴더다. 이번 작업의 Task별 리뷰 판정·E2E 스크린샷 11장이 거기 있다.
