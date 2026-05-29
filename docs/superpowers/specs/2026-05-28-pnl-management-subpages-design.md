# 손익관리 하부 페이지 — 설계 문서

작성일: 2026-05-28
상태: 승인됨 (구현 대기)

## 0. 데이터 보안 제약 (필수)

이번 작업의 모든 입력 데이터는 **사외비**다. [[feedback-confidential-no-numbers]] 정책 준수:

- Claude 컨텍스트에는 **금액 숫자 값을 넣지 않는다.** 시트 구조·헤더·고객/제품/공장/법인 **명단**까지만 본다.
- 적재 스크립트는 **블라인드**로 작성하고 **사용자가 직접 실행**한다 (`! python ...`). Excel→스크립트→Supabase 경로만 사용.
- 정합성 검증 출력은 **집계/플래그만** (행 개수, 연도 커버리지, null 카운트, 총합 일치 OK/FAIL). 원시 금액 stdout 출력 금지.
- 신규 사외비 테이블은 RLS enable + 정책 없음(default deny) + `confidentialDb` facade 경유 (AGENTS.md "사외비 5-step").

## 1. 범위

데이터 소스: `참고/손익/자료정리_월별손익_2026 5 27.xlsx` (이후 `자료정리_월별손익*.xlsx` 최신본).

### Part 1 — 경영관리 페이지(`/management/pnl`) 업데이트

1. 신규 4월(2026-04) 데이터 재적재 (`pnl_entries`).
2. 신규 10번 차트 추가(9번 뒤): **이익기여도 top7/worst7 (고객-제품)**.
3. 13번 "시사점"(워터폴+파레토 묶음) → 독립 섹션 2개로 분리.
4. 섹션 번호 재조정.

### Part 2 — 계획 페이지(`/management/plan`) 신규 구현

계획 시트 → `pnl_plan` 적재 + 계획 대비 실적·달성율 콤보 차트 8종.

## 2. 데이터 분석 결과 (계획 시트)

long-format. 헤더 row 1, 데이터 row 2~231. 컬럼: `연도 | 연간/월 | 계획/실적 | 연결/별도 | 분류 | 항목 | 단위 | 밸류`.

| 분류     | 항목                        | 단위                                 | 계획 연도      | 실적                            |
| -------- | --------------------------- | ------------------------------------ | -------------- | ------------------------------- |
| 수주     | 수주액                      | 억원                                 | 2018~2026      | 2018~2025 연간 + 2026 월별(1~4) |
| 수주     | 수주액(취소 제외)           | 억원                                 | (없음)         | 2018~2022,2024 연간만 (sparse)  |
| 손익     | 매출 (연결·별도)            | 억원                                 | 2021~2026      | **없음 → pnl_entries**          |
| 손익     | 영업이익 (연결·별도)        | 억원                                 | 2021~2026      | **없음 → pnl_entries**          |
| 미국     | 매출 / 영업이익             | USD 백만                             | 2021~2026      | 2021~2025 연간 + 2026 월별(1~4) |
| 상숙     | 매출 / 영업이익             | 억원(계획)/**백만원**(2026월별 실적) | 2021~2026      | 2021~2025 연간 + 2026 월별(1~4) |
| 지린     | 매출 / 영업이익             | 억원(계획)/**백만원**(2026월별 실적) | 2021~2026      | 2021~2025 연간 + 2026 월별(1~4) |
| 손익개선 | Design VE / MCIP / 단가인상 | 백만원                               | 2021/2022~2026 | ~2025 연간 + 2026 월별(1~4)     |
| 공장     | 구동/제동/조향/전장 매출    | 억원                                 | 2021~2026      | 2021~2025 연간 (**2026 공백**)  |

`연간/월` 컬럼: `'연간'` = 연간 행, 숫자 = 해당 월(2026 월별 실적). `연결/별도`는 수주·손익개선·미국·상숙·지린은 연결, 공장은 별도, 손익은 연결+별도 둘 다.

신규 데이터 확인: `연결_월` 2026→4월, `월`(별도) 2026→4월 존재.

`수주` 시트(입찰총액/수주성공/수주실패/연기·중단·취소)는 8개 차트에 불필요 → **이번 적재 제외**.

## 3. 결정 사항 (사용자 확정)

1. **공장 차트 2026 실적**: 시트가 공백이므로 **2026 실적·달성율 공란**, 과거연도(2021~2025)만 표시. (DB derive 안 함.)
2. **수주 취소제외 토글**: 계획은 항상 `수주액` 계획 공통. 실적만 `수주액`↔`수주액(취소 제외)` 전환 → 달성율만 변동. 취소제외 데이터 없는 연도(2023,2025,2026)는 `수주액 = 수주액(취소제외)` 동일값으로 채운다.
3. **신규 10번 차트 basis**: 연결/별도 토글.
4. **계획 차트 연도 범위**: 전체 연도 표시 (추가 컨트롤 없음).

## 4. 아키텍처

### 4.1 DB — 마이그레이션 `supabase/migrations/20260528000001_create_pnl_plan.sql`

```sql
CREATE TABLE pnl_plan (
  category     text NOT NULL,
  item         text NOT NULL,
  basis        text NOT NULL CHECK (basis IN ('consolidated','standalone')),
  kind         text NOT NULL CHECK (kind IN ('plan','actual')),
  period_year  int  NOT NULL,
  period_type  text NOT NULL CHECK (period_type IN ('annual','month')),
  period_month int  NOT NULL DEFAULT 0,
  unit         text NOT NULL,
  value        numeric(18,4),
  PRIMARY KEY (category, item, basis, kind, period_year, period_type, period_month)
);
ALTER TABLE pnl_plan ENABLE ROW LEVEL SECURITY;  -- 정책 없음 = default deny
COMMENT ON TABLE pnl_plan IS '한세모빌리티 계획 대비 실적 — 사외비. admin client(service_role) 전용.';
```

- `lib/database.types.ts` 재생성 + `lib/supabase/confidential.ts` `CONFIDENTIAL_TABLES`에 `pnl_plan` 추가.

### 4.2 적재 스크립트

- **`scripts/sync_pnl_excel.py`** (`_archive`에서 복원·수정): EXCEL 경로를 `자료정리_월별손익*.xlsx` 최신 glob으로. `summarize()`에서 `revenue_sum` 제거(금액 비노출). WriteSession 적용. → 4월 포함 `pnl_entries` 재적재.
- **`scripts/sync_pnl_plan.py`** (신규): 계획 시트 파싱 → `pnl_plan` upsert.
  - `연결/별도` → consolidated/standalone, `계획/실적` → plan/actual, `연간/월` → period_type/period_month.
  - 헤더 검증(기대 라벨 일치). 출력은 (분류·항목·kind)별 행수·연도 커버리지·null 카운트만.
  - WriteSession 사용 → 자동 revalidate(`pnl_plan` 태그).
- 두 스크립트 모두 **사용자가 직접 실행**. `--dry-run` 지원.

### 4.3 `lib/plan/`

- **`source.ts`**: `'use cache'` + `cacheTag('pnl_plan')` + `confidentialDb.from('pnl_plan')`. 차트 2·3 실적은 `getPreparedPnl()`(pnl_entries) 재사용 — 전사 매출/영업이익 연간 + 2026 YTD를 basis별로.
- **`types.ts`**: `PlanRow`, 카테고리/항목 enum, 차트 시리즈 타입.
- **`aggregate.ts`** (pure, `aggregate.test.ts`): 차트별 (연도 → 계획·실적·달성율) 시리즈 빌더.
  - 단위 정규화: 상숙/지린 2026 월별 실적 백만원 → 억원(÷100). 차트별 표시 단위로 통일.
  - 취소제외 fill: 실적 series에서 결측 연도는 수주액 실적으로 대체.
  - 2026 YTD: 월별(1~4) 실적 합산. 계획은 연간값 그대로(YTD 안분 안 함 — 사용자 명시: "계획은 연간으로 두고 실적은 YTD").
  - 달성율(%) = 실적/계획×100. 계획 0/없음이면 null.
  - 미국 원화 환산: `exchange_rates` 현재 USD/KRW로 USD백만 → 억원.

### 4.4 컴포넌트 `components/management/plan/`

- **`PlanAchievementChart.tsx`** (공통 재사용): props로 `{ rows: {year, plan, actual, rate}[], unit, ... }`. Recharts `ComposedChart`: 계획 막대(연한색)+실적 막대(진한색)+달성율 라인(표식, 우측 Y축). 색·스타일은 `YoyMonthlyCompare`(OEM_COLORS solid/rgba(.45)) 참고. 2026 등 YTD 연도는 라벨에 표식(예: `2026 YTD`).
- **8개 차트 컴포넌트**: 각자 셀렉터 + `PlanAchievementChart` 호출.
  1. `OrderTargetChart` — 수주액/취소제외 2버튼.
  2. `RevenueTargetChart` — 연결/별도 2버튼 (실적 pnl_entries).
  3. `OpIncomeTargetChart` — 연결/별도 2버튼 (실적 pnl_entries).
  4. `UsTargetChart` — 매출/영업이익 + USD/원화 버튼.
  5. `SangsukTargetChart` — 매출/영업이익 버튼.
  6. `JilinTargetChart` — 매출/영업이익 버튼.
  7. `ImprovementTargetChart` — Design VE/MCIP/단가인상 버튼 (백만원).
  8. `FactoryTargetChart` — 구동/제동/조향/전장 버튼 (억원).
- **`PlanDashboard.tsx`**: 8개 차트를 LazyMount로 배치.
- **`app/management/plan/page.tsx`**: source 호출 → PlanDashboard.

단위: 1~6 억원(미국은 USD백만 기본, 원화 토글 시 억원), 7 백만원, 8 억원.

### 4.5 경영관리 페이지 수정

- **신규 `components/management/pnl/ProfitContribution.tsx`** (10번): 연결/별도 토글 + 연도 드롭다운. `aggregateBy(entriesForYear(annualByBasis[basis], basis, year), ['customer','product'])` → 영업이익 desc top7 / asc worst7. 표 컬럼: 고객 · 제품 · 매출 · 영업이익 · 영업이익률. 추가 행: **전사 합계**(매출/영업이익/이익률) · **top7 제외 나머지 합산**(매출/영업이익/이익률). 영업이익률 = op_income/revenue×100.
- **`PnlDashboard.tsx`**: ProfitContribution을 MarginScatter(9) 뒤·YoyMonthlyCompare 앞에 삽입. `Insights` 제거하고 `WaterfallProfitability`·`CustomerParetoChart`를 독립 `<section>`(번호 헤더 포함)으로 직접 배치.
- **번호 변경**: YoyMonthlyCompare 10→11, YoyMonthlyFiltered 11→12, YoyProductCustomer 12→13, WaterfallProfitability→14(섹션화), CustomerParetoChart→15(섹션화). 각 컴포넌트 `<h2>` 텍스트 수정.
- `Insights.tsx` 제거. Waterfall/Pareto는 현재 `<div className="rounded-md border...">` 하위 카드(Insights grid 내부용)이므로, 각 컴포넌트의 최상위 래퍼를 `<section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">` + 번호 `<h2>`로 변경해 YoyMonthlyCompare와 동일한 top-level 섹션으로 승격. PnlDashboard는 두 컴포넌트를 LazyMount로 직접 배치.

## 5. 검증

- `npm run check-all` (lint+format+typecheck+test) 통과.
- `lib/plan/aggregate.test.ts` 신규 (달성율·단위환산·취소제외fill·YTD 케이스).
- 적재 후 사용자 직접 실행 + 집계 검증 (행수/연도 커버리지/null). 금액 비노출.
- `npm run dev`로 두 페이지 골든 패스 확인 (콘솔/네트워크 에러 모니터링). 사외비라 로그인 필요.

## 6. AGENTS.md 갱신 (같은 커밋)

- 마이그레이션 신규 → 데이터 모델/사외비 목록.
- `/management/plan` 라우트 책임 갱신.
- `lib/plan/` 도메인 폴더 추가.
- `scripts/sync_pnl_plan.py` (신규 적재 스크립트).
- `.github/workflows`는 추가 없음(수동 적재).

## 7. 비목표 (YAGNI)

- 수주 funnel(입찰총액 등) 시각화 — 이번 제외.
- 계획의 월별 안분/월별 계획 차트 — 계획은 연간만.
- 공장 2026 실적 DB derive — 공란 유지.
- 재고/생산 페이지 — 이번 범위 아님.
