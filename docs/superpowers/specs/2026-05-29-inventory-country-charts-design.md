# 재고 페이지 국가 분류 차트 추가 — 설계

- 작성일: 2026-05-29
- 대상 라우트: `/management/inventory`
- 데이터 소스: `자료정리_월별손익*.xlsx` '재고' 시트 → `inventory_entries`(사외비)

## 1. 목표

기존 재고 페이지(종류 분류 기반 차트 3종)에 **국가 분류**(국내/미국/우즈벡) 데이터와 차트를 추가한다. 결과적으로 차트는 3종 → **6종**으로 확장되고, 일부는 제목이 변경된다.

## 2. 데이터 구조

엑셀 '재고' 시트는 이미 두 가지 직교 분류를 모두 포함한다(둘 다 전체의 분해). 컬럼: `연도 / 월 / 계획·실적 / 적용환율 / 분류 / 항목 / 단위 / 밸류`. 환율 일관 `1,400원/$`.

### 종류 분류 (기존)

| 분류 | 항목        | 단위                |
| ---- | ----------- | ------------------- |
| 운영 | 운영 재고   | 억원                |
| 관리 | 관리 재고   | 억원                |
| 보상 | 보상 재고   | 억원                |
| 운송 | 영업 재고   | 억원                |
| 운송 | 미국 운송   | 백만USD             |
| 운송 | 우즈벡 운송 | 백만USD (2026~)     |
| 전체 | 전체 재고   | 억원                |
| 전체 | 회전율      | (단위 없음, 실적만) |

### 국가 분류 (신규)

| 분류   | 항목     | 단위    | 비고                         |
| ------ | -------- | ------- | ---------------------------- |
| 국내   | 구동     | 억원    | 2025~                        |
| 국내   | 제동조향 | 억원    | 2025~                        |
| 국내   | 전장     | 억원    | 2025~                        |
| 미국   | 미국     | 백만USD | 2025~                        |
| 우즈벡 | 우즈벡   | 백만USD | **2026만, 실적 대부분 null** |

USD 환산: `value × fx_rate ÷ 100 = value × 14` 억원 (기존 `convertToKrwEok` 재사용).

## 3. 핵심 발견 — 국가합 ≠ 전체 (검증 완료)

데이터 진단 결과(금액 비노출, 비율/카운트만):

- 종류합(운영+관리+보상+운송)은 **전 기간 정확히 전체와 100% 일치**.
- 국가합(국내+미국+우즈벡)은 **전 기간 전체의 ~88%** (계획·실적 동일, 모든 달 mismatch). 약 12% 갭이 일정.
- 갭의 정체(사용자 확인): **영업재고 + 보상재고(국내분)**. 보상재고의 미국·우즈벡분은 이미 미국·우즈벡 국가값에 포함되어 있어, 국가 분류에서 빠지는 것은 영업재고와 보상재고의 국내분뿐.
- 환산 오류 아님: 종류합의 USD 항목(미국 운송 등)도 동일 환산을 쓰는데 100% 일치하므로 환산은 정확.

### 차액 처리 (차트 2)

차트 2에 4번째 누적층 **"영업+국내보상"** 을 추가한다.

- `residual = 전체재고(actual) − (국내 + 미국 + 우즈벡)` — **전체−국가합으로 정확히 계산**.
- **기본 숨김**(범례 비활성 상태로 시작). 범례 클릭 시 표시.
- 표시하면 스택 총액 = 전체재고 = 1번 차트 합계와 정의상 일치 → "총액이 1번과 맞는지" 시각 확인용 토글.

## 4. 차트 최종 명세 (6종)

| #   | 제목                      | 컴포넌트                                 | 토글/범례                                       | 비고                             |
| --- | ------------------------- | ---------------------------------------- | ----------------------------------------------- | -------------------------------- |
| 1   | 재고 현황 (종류)          | `InventoryStatusChart` (기존)            | 운영/관리/보상/운송 + 회전율                    | 제목만 변경 (`(실적)`→`(종류)`)  |
| 2   | **재고 현황 (국가)**      | **`InventoryCountryStatusChart` (신규)** | 국내/미국/우즈벡 + **영업+국내보상(기본 숨김)** | 회전율 없음                      |
| 3   | 계획 대비 실적 (전사)     | `InventoryAchievementChart` (재사용)     | 전체/운영/관리/보상/운송                        | 제목 변경 (`2. 계획 대비 실적`→) |
| 4   | **계획 대비 실적 (국내)** | `InventoryAchievementChart` (재사용)     | **구동/제동조향/전장**                          | 신규                             |
| 5   | **계획 대비 실적 (해외)** | `InventoryAchievementChart` (재사용)     | **미국/우즈벡** (국가값, 운송과 별개)           | 신규                             |
| 6   | 계획 대비 실적 (운송)     | `InventoryAchievementChart` (재사용)     | 미국/우즈벡/영업재고 (운송)                     | 제목 변경 (`3. 계획 대비 운송`→) |

KPI 카드 5종은 페이지 상단 그대로 유지(변경 없음).

## 5. 변경 범위 (파일별)

### 5.1 `lib/inventory/types.ts`

- 추가: `CountryStatusPoint { monthLabel, year, month, domestic, us, uz, residual, total }` (회전율 없음, `total`=전체재고 actual)
- 추가: `DomesticItem = 'drive' | 'brake' | 'electronics'` (구동/제동조향/전장)
- 추가: `OverseasItem = 'us' | 'uz'` (미국/우즈벡 국가값 — 운송용 `TransportItem`과 별개)

### 5.2 `lib/inventory/aggregate.ts` (pure 빌더 3종 추가)

- `buildCountryStatusPoints(rows)`: 실적만. `domestic`=구동+제동조향+전장 합, `us`=미국/미국, `uz`=우즈벡/우즈벡, `total`=전체/전체재고 actual, `residual = total − (domestic+us+uz)` (음수/총액 null 시 안전 처리). (year, month) 그룹·오름차순.
- `buildDomesticAchievementPoints(rows, item)`: `category='국내'` + item 매핑(구동/제동조향/전장). 기존 `aggregateAchievement` 재사용.
- `buildOverseasAchievementPoints(rows, item)`: `(category='미국', item='미국')` 또는 `(category='우즈벡', item='우즈벡')`. 기존 `aggregateAchievement` 재사용.
- 매핑 상수: `DOMESTIC_ITEM_MAP`, `OVERSEAS_MAP`.

### 5.3 `lib/inventory/__tests__/aggregate.test.ts`

- 신규 빌더 3종 단위 테스트 추가(기존 vitest 패턴): 국가 status + residual 계산, 국내 토글, 해외 토글. 현재 16 → 약 22 tests.

### 5.4 컴포넌트

- **신규** `components/management/inventory/InventoryCountryStatusChart.tsx`: 기존 `InventoryStatusChart`에서 회전율 라인/우축 제거, 누적층 4개(국내/미국/우즈벡/영업+국내보상). 영업+국내보상은 `hidden` 초기값에 포함. 상단 합계 라벨 = 보이는 막대 합(`sumVisibleStack`). 툴팁 패턴 동일.
- **변경** `components/management/inventory/InventoryStatusChart.tsx`: 제목 문자열 `"1. 재고 현황 (실적)"` → `"1. 재고 현황 (종류)"` (2곳).
- **재사용(무변경)** `InventoryAchievementChart.tsx`: 차트 4·5·6은 이 컴포넌트를 그대로 사용. 신규 컴포넌트 불필요.

### 5.5 `components/management/inventory/InventoryDashboard.tsx`

- 6차트 재배치(위 §4 표 순서).
- 신규 상태: `domItem: DomesticItem`(기본 `'drive'`), `ovsItem: OverseasItem`(기본 `'us'`).
- 신규 `useMemo`: `countryPts`, `domPts`, `ovsPts`.
- 신규 토글 옵션 상수: `DOMESTIC_OPTIONS`(구동/제동조향/전장), `OVERSEAS_OPTIONS`(미국/우즈벡).
- 기존 ChartSection 제목 변경: `2. 계획 대비 실적` → `3. 계획 대비 실적 (전사)`, `3. 계획 대비 운송` → `6. 계획 대비 실적 (운송)`.

### 5.6 `scripts/sync_inventory.py`

- **파싱 변경 없음** — 제네릭 파서가 국내/미국/우즈벡 행을 자동 적재(충돌키에 category·item 포함).
- **정합성 검증**: 기존 종류합(==전체) 체크 유지. 국가합은 정의상 전체와 안 맞으므로 `국가합 == 전체` 단언 미추가. `summarize()`가 이미 국내/미국/우즈벡 행수·null 출력.

### 5.7 `AGENTS.md`

- `/management` inventory 설명을 차트 3종 → 6종 + 국가 분류로 갱신.
- `lib/inventory` 도메인 폴더 설명의 빌더 수·vitest 테스트 수 갱신.

## 6. 결정 사항 (grill-me로 확정)

1. **국가 차트 빌드**: 갭 인정하고 그대로 빌드. 차트 2에 차액층 추가.
2. **차액 계산**: `전체 − 국가합` (정확). type 행 합산 방식(영업+보상)은 이중계산으로 비채택.
3. **sync 검증**: 종류 체크 유지, 국가 단언 미추가.
4. **KPI**: 변경 없음.
5. **차트 4·5·6**: 기존 `InventoryAchievementChart` 재사용(신규 컴포넌트 X).

## 7. 검증 계획

- 코드: `npm run check-all` (lint + format:check + typecheck + vitest). 신규 빌더 3종 단위 테스트 포함.
- 데이터 적재: 사외비 정책상 사용자가 `python scripts/sync_inventory.py` 직접 실행(`--dry-run` 후 본 적재). 로컬은 `--revalidate-prod` 선택.
- UI 시각: 적재 완료 후 `npm run dev`에서 6차트 + 차트 2 범례 토글(영업+국내보상 켜면 총액=차트 1) 확인.

## 8. 비범위 (Out of scope)

- KPI 카드 변경.
- 국가 기반 신규 KPI.
- 엑셀 원본 데이터 수정(보상 국내/해외 분리 등).
- 차트 1(종류)의 구조 변경.
