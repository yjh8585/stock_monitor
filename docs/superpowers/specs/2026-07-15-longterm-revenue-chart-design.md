# 중장기 매출 전망 차트 (/management/plan) — 설계

작성일: 2026-07-15 · 상태: 승인됨(사용자 확인 2026-07-15)

## 1. 목적 / 범위

경영관리 계획 페이지(`/management/plan`)에 **중장기 매출 전망** 세로 그룹 막대 차트를 추가한다.
영업본부가 분기마다 산출하는 2027~2031년 연도별 매출 전망을 3개 산출 기준(수주 Volume /
고객 EDI 100% / 한세 전망)으로 비교한다.

- 차트 위치: **1번** (기존 9개 차트는 2~10번으로 재정렬).
- 데이터 기준(2026.1Q · 2026.2Q)은 **드롭다운**으로 전환.
- 단위 백만원, 환율 기준 문구를 화면에 표기.
- 데이터는 **사외비** — 외부 LLM 전송 금지, 적재·검증 과정에서 금액 stdout 비노출.

**범위 밖(out of scope)**

- 시트 13~14행 비율 행(EDI/수주, 전망/수주) — 요청 범위 아님.
- 보조 시트 3종(`중장기 DATA_*`, 864행 원장) — 요약 시트만 사용.
- `/management/upload` 업로드 UI 편입 — 월별손익 엑셀과 다른 파일이므로 미편입.
- 챗봇(`lib/chat/tools.ts`) 노출 — 사외비 화이트리스트 추가 금지 원칙 유지.

## 2. 소스 데이터

파일: `(260624) 영업본부 중장기 매출 계획.xlsx` · 시트: `연도별 Booked 매출` · 범위 B2:H14

| 위치      | 내용                                                              |
| --------- | ----------------------------------------------------------------- |
| B2        | 환율 기준 문구 1줄 (`Booked 기준 (FX n,nnn원/USD, n,nnn원/EUR)`)   |
| B3:C4     | `중장기 계획` (병합) / D3:H3 `연도별 매출액 (백만원)` (병합)      |
| D4:H4     | 전망 연도 5개 — **문자열** (`"2027년"` 형태)                      |
| B5:B7     | 기준 1 (병합) · 5~7행 = 수주 Volume / 고객 EDI 100% / 한세 전망   |
| B9:B11    | 기준 2 (병합) · 9~11행 = 동일 3계열                               |
| B13:B14   | 비율 행 — 사용 안 함                                              |

**확인된 사실**

- 기준 라벨 형식은 `26. 1Q`(2자리 연도, 점, 공백, 분기) → `2026.1Q`로 정규화.
- 환율 문구는 시트 전체에 **1개**(기준별로 존재하지 않음).
- **기준 1(2026.1Q)의 `고객 EDI 100%`는 5개 연도 전부 문자열 `N/A`** → 값 없음.

## 3. 데이터 모델

신규 마이그레이션 `supabase/migrations/20260715000001_create_longterm_revenue_plan.sql`

```sql
create table public.longterm_revenue_plan (
  basis_year    integer not null,
  basis_quarter integer not null check (basis_quarter between 1 and 4),
  series        text    not null check (series in ('수주 Volume', '고객 EDI 100%', '한세 전망')),
  period_year   integer not null,
  value_mwon    numeric,
  fx_note       text,
  primary key (basis_year, basis_quarter, series, period_year)
);
alter table public.longterm_revenue_plan enable row level security;
```

- 규모: 2기준 × 3계열 × 5연도 = **30행**. 1Q의 `고객 EDI 100%` 5행은 `value_mwon = null`.
- `series`는 **한글 그대로** — DB CHECK ↔ sync 적재값 ↔ TS union ↔ UI를 한글로 일치(AGENTS.md
  "enum형 한글 컬럼" 규칙). 영문 매핑 금지.
- RLS enable + **정책 없음**(default deny) → anon 접근 불가, 서버는 `confidentialDb` 전용.
- `fx_note`는 시트에 1개뿐이라 전 행에 동일 문자열이 중복 저장된다(결정 ①). 30행 규모에
  조인/별도 테이블은 과설계. 향후 기준별 환율이 갈리면 스키마 변경 없이 수용 가능.

## 4. 적재 — `scripts/sync_longterm_revenue.py` (신규)

`scripts/sync_loan.py` 패턴 복제(소형 시트 + 사외비 + dry-run + WriteSession).

- **엑셀 경로**: `LONGTERM_EXCEL_PATH` env 우선 → 없으면 `참고/영업계획/*.xlsx` glob 최신.
  `참고/`는 `.gitignore` 대상(개인 자료). 경로 해석은 스크립트 내 로컬 함수 — 재사용처가
  1곳뿐이라 `scripts/lib/management_excel.py`(월별손익 8개 sync 공유) 수정하지 않는다.
- **파싱**: 고정 좌표. 연도 D4:H4(문자열 → `int` 추출), 기준 블록 5~7 / 9~11행, 값 D:H열.
- **헤더 검증**: B3 · D3 · 계열 라벨 3종 × 2블록 · 기준 라벨 형식(`\d{2}\.\s*\d`Q) 대조.
  불일치 시 **exit 2**(조용한 오적재 방지).
- **N/A·공란 → `None`** (숫자 아닌 셀은 전부 null 처리).
- **금액 비노출**: `summarize()`는 (기준·계열)별 행수 / 연도 커버리지 / null 카운트만 출력.
  금액·합계 출력 금지.
- `--dry-run`(파싱·검증만) · `--revalidate-prod`(적재 후 프로덕션 캐시 무효화).
- `WriteSession`으로 upsert → 블록 종료 시 `longterm_revenue_plan` 태그 자동 revalidate.
- **`sync_management_excel.py` 오케스트레이터에 등록하지 않는다** — 다른 엑셀 파일.

## 5. 도메인 레이어

계획 페이지는 이미 `lib/plan/source.ts` **단일 입구**가 3개 테이블(pnl_plan + pnl_entries +
exchange_rates_live)을 모아 온다. 새 도메인 폴더를 만들면 페이지가 입구를 둘 갖게 되어 기존
패턴이 깨지므로 `lib/plan`을 확장한다(결정 ②). 대신 순수 계산은 새 파일로 분리해 파일별
책임을 좁게 유지한다.

- `lib/plan/source.ts` (수정) — `fetchLongtermRows()` 추가, `getPlanData()`가 `longterm` 동봉.
  `cacheTag('longterm_revenue_plan')` 추가.
- `lib/plan/longterm.ts` (신규) — 타입 + 순수 함수:
  - `LongtermRow` / `LongtermSeries`(한글 union) / `LongtermBasis` / `LongtermPoint`
  - `listBases(rows)` → 드롭다운 옵션. `{ key: '2026.2Q', basisYear, basisQuarter }`,
    **최신 기준 우선** 정렬(연도 desc, 분기 desc).
  - `activeSeries(rows, basis)` → 해당 기준에서 **값이 하나라도 있는 계열만** 고정 순서
    (수주 Volume → 고객 EDI 100% → 한세 전망)로 반환. 1Q의 EDI가 여기서 탈락.
  - `buildLongtermPoints(rows, basis)` → 연도 오름차순 `[{ year, '수주 Volume': n|null, ... }]`.
  - `fxNote(rows, basis)` → `string | null`.
- `lib/plan/__tests__/longterm.test.ts` (신규) — Vitest. 커버:
  N/A 계열 제외 / 기준 정렬(최신 우선) / 연도 오름차순 / 계열 고정 순서 / 빈 데이터 / fx null.

## 6. UI — `components/management/plan/LongtermRevenueChart.tsx` (신규)

- `ChartSection title="1. 중장기 매출 전망" unit="백만원"`, controls 슬롯에 **드롭다운**.
- 드롭다운: `components/ui/select.tsx`(shadcn Select) 재사용. 옵션은 `listBases()` 결과,
  **기본값 = 최신 기준**(2026.2Q). 기준이 1개뿐이어도 정상 동작.
- 환율 문구: 차트 상단에 `text-sm text-muted-foreground` 한 줄(엑셀 원문 그대로, 결정 ③).
  `ChartSection`에 caption 슬롯을 새로 파지 않고 children 최상단에 렌더(최소 변경).
- 차트: Recharts 세로 그룹 막대 — `docs/chart-guide.md` §4-B 레시피 + §5 토큰 준수.
  - 높이 `useChartHeight` · 색 `OEM_COLORS[0..2]` · 툴팁 `TOOLTIP_CONTENT_STYLE`
  - 그리드 `vertical={false}` + `GRID_STROKE_OPACITY` · `radius={[3,3,0,0]}`
  - Y축 `Y_AXIS_PADDED_DOMAIN`(상단 라벨 잘림 방지) · 범례 상단 중앙
  - 데이터 라벨 **16px**(경영관리 규칙, chart-guide §5-B) · 리터럴 복붙 금지
  - `<Bar>`는 `activeSeries()` 결과만 map 렌더 → 1Q에서 EDI 막대·범례 자동 생략
- `PlanDashboard.tsx`에 `LazyMount` + `dynamic(ssr:false)`로 **맨 위** 등록(기존 9개와 동일 패턴).
- 빈 데이터(테이블 미적재) 시 안내 문구 렌더 후 조기 반환.

## 7. 차트 번호 재정렬

제목 문자열만 변경, 로직 무변경.

| 파일                       | 변경           |
| -------------------------- | -------------- |
| `OrderTargetChart`         | `1.` → `2.`    |
| `OrderFunnelChart`         | `2.` → `3.`    |
| `RevenueTargetChart`       | `3.` → `4.`    |
| `OpIncomeTargetChart`      | `4.` → `5.`    |
| `UsTargetChart`            | `5.` → `6.`    |
| `SangsukTargetChart`       | `6.` → `7.`    |
| `JilinTargetChart`         | `7.` → `8.`    |
| `ImprovementTargetChart`   | `8.` → `9.`    |
| `FactoryTargetChart`       | `9.` → `10.`   |

## 8. 부수 갱신 (누락 시 조용히 깨지는 지점)

- `lib/database.types.ts` — `longterm_revenue_plan` 블록을 알파벳 위치에 **수동 삽입**
  (generate 전량 재생성은 수동 ViewRow/TableRow 헬퍼 소실 + prettier churn 유발).
- `lib/supabase/confidential.ts` — `CONFIDENTIAL_TABLES`에 한 줄 + 주석.
- `scripts/lib/revalidate.py` — `COLUMN_TO_TAGS['longterm_revenue_plan']`.
- `app/api/revalidate/route.ts` — `ALL_TAGS`에 태그 추가(양쪽 정합성 필수).
- 문서: `AGENTS.md`(사외비 테이블 격리 명단 · sync 유지 목록 · 사외비 적재 정책),
  `Architecture.md`(§5-A 탭 구조 · §7 스키마), `docs/chart-guide.md`(§3 management 카탈로그).

## 9. 검증 계획

1. `scripts/venv/Scripts/python.exe -m py_compile scripts/sync_longterm_revenue.py`
2. `python scripts/sync_longterm_revenue.py --dry-run` → 행수 30 / 1Q EDI null 5 확인
   (금액 비노출 출력만).
3. 본 적재 → `--revalidate-prod`.
4. `npm run check-all` (lint + format:check + typecheck + vitest).
5. dev 서버(로컬 3001) Playwright: 로그인 → `/management/plan` → 차트 1번 위치 확인 →
   드롭다운 2026.2Q/1Q 전환. **금액 셀 미접근** — 범례 계열 개수(3 vs 2)·차트 제목·
   막대 개수 등 구조 불리언만 추출. 콘솔/네트워크 에러 모니터링.
   (headless recharts는 축 틱 `<text>`가 페인트되지 않으므로 라벨 문자열 정확성은 Vitest로 담보.)

## 10. 결정 기록

| # | 결정                                              | 이유 |
| - | ------------------------------------------------- | ---- |
| ① | `fx_note` 30행 중복 저장 (별도 테이블 분리 안 함) | 30행 규모에 조인은 과설계. 기준별 환율 분기 시 스키마 변경 불필요 |
| ② | `lib/longterm-revenue/` 신설 대신 `lib/plan` 확장 | 페이지 = 단일 source 입구 패턴 유지. 순수 로직만 `longterm.ts`로 분리해 파일 책임 유지 |
| ③ | 환율은 엑셀 원문 문자열 그대로 저장·표시          | 숫자 재조립 시 서식 변경에 취약. 계산에 쓸 계획 없음(값은 이미 백만원 환산 완료) |
| ④ | 1Q의 `고객 EDI 100%`는 막대·범례에서 생략          | 0으로 그리면 "전망 0원"이라는 거짓 사실을 표시하게 됨 |
| ⑤ | 기준 선택은 드롭다운(shadcn Select)               | 사용자 요청. 분기마다 기준이 누적되므로 토글 버튼은 폭 초과 |
| ⑥ | 업로드 오케스트레이터 미편입                      | 다른 엑셀 파일. 편입 시 기존 8개 sync의 dry-run 흐름에 분기 위험 |
