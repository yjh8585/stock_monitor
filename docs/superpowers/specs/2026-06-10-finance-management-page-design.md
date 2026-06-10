# 경영관리 › 재무 페이지 설계

> 2026-06-10 · 상태: 설계 승인됨(사용자 "진행해") · 후속: 구현 플랜(`docs/superpowers/plans/`)

## 목표

경영관리(`/management`)에 신규 탭 **재무**(`/management/finance`)를 추가한다. 데이터는 엑셀
`참고/손익/자료정리_월별손익_2026 5 27.xlsx`의 **'재무' 시트**(대차대조표 계정). 밸류는 아직
미입력 상태 → **검토용 샘플 값을 시드**해 차트 양식을 먼저 확인하고, 실제 값 입력 후 sync로 교체한다.

차트 2종:

1. **재무 레버리지 콤보** — 묶은 세로막대(자산·부채) + 표식 꺾은선(부채비율), 이중축 영역 분리,
   자회사 필터(전체/미국/…) 차트1 전용.
2. **투하자본·자금조달 표** — 모든 구간 증감 강조. 전체(연결) 고정.

## 결정 사항 (승인됨)

- **단위: 억원**. 엑셀 밸류는 백만원 → `value_mwon / 100 = 억원`.
- **필터 버튼: 데이터 기반 자동**. `subsidiary` 고유값으로 생성(현재 전체/미국, 상숙 데이터 추가 시 자동 등장). 기본 '전체'.
- **검토 데이터: 샘플 시드**. 실제 값 입력 후 첫 sync가 덮어씀(별도 정리 불필요).
- **증감 표시: 모든 연속 구간 증감열**. 증가 `#3b82f6`(파랑) / 감소 `#ef4444`(빨강), ▲▼ + 금액·%.
- **필터 범위: 차트1에만**. 표는 전체(연결) 고정.
- **부채비율 정의: 부채 / 자본(자기자본) × 100** (한국 표준, 자산=부채+자본과 정합).

## 데이터 계층 (사외비 5-step)

### 신규 테이블 `finance_entries` (RLS enable, 정책 없음 → confidentialDb 전용)

| 컬럼            | 타입         | 설명                                  |
| --------------- | ------------ | ------------------------------------- |
| `subsidiary`    | text         | 자회사 (전체/미국/…)                  |
| `consolidation` | text         | 연결/별도 (현재 연결만)               |
| `period_year`   | int          | 연도                                  |
| `period_kind`   | text         | `annual`(과거 연말) / `monthly`(월별) |
| `account`       | text         | 계정명 11종                           |
| `period_month`  | int          | annual=12, monthly=1~12               |
| `value_mwon`    | numeric null | 밸류(백만원, 미입력 시 null)          |

- **PK** = (subsidiary, consolidation, period_year, period_kind, period_month, account).
  시트의 `자본` 중복행은 upsert로 자동 정리.
- **계정명 11종**: 자산·부채·자본·채권·채무·재고·유형자산·무형자산·현금성자산·차입·증자.
- **인덱스**: (subsidiary, period_year, period_kind, period_month).

### 시점 규칙

- 과거(2023~2025): 연말 1행 → `annual`, `period_month=12`. (시트의 '연간'/12 표기를 annual/12로 정규화)
- 2026: 월별(현재 1~5월) → `monthly`. **YTD = 최신월(max month)** 1행 사용.
- 차트 X축 순서: `[2023, 2024, 2025, 2026 YTD]`.

### 파이프라인

마이그레이션(`YYYYMMDD000NNN_finance_entries.sql`) → `lib/database.types.ts` 수동 삽입(알파벳 위치) →
`lib/supabase/confidential.ts` `CONFIDENTIAL_TABLES`에 한 줄 → `scripts/sync_finance.py`
(`sync_inventory.py` 패턴: WriteSession, **stdout 금액 비노출**, dry-run, `--revalidate-prod`) →
`scripts/lib/revalidate.py` `COLUMN_TO_TAGS`에 `finance_entries → ['finance_entries']` →
`lib/finance/{source,aggregate,types}.ts` + `aggregate.test.ts`(vitest, pure 빌더).

## 도메인 로직 (`lib/finance/aggregate.ts`, pure)

- `listSubsidiaries(rows): string[]` — '전체' 우선, 그 외 자회사 고유값(필터 버튼).
- `buildLeverageSeries(rows, subsidiary): LeveragePoint[]` — 연도별
  `{ yearLabel, assets, liabilities, debtRatio }`. 억원 환산, 부채비율 = 부채/자본×100.
- `buildCapitalTable(rows): CapitalTable` — 투하자본/자금조달 행 + 구간별 증감(절대값·%).
- 모든 빌더: 억원 환산(`/100`), null 안전. 단위 테스트로 환산·증감·부채비율·시점선택 검증.

## 차트 1 — `FinanceLeverageChart` (콤보)

- `ComposedChart`. 묶은 막대 자산(`#2563eb` 파랑)·부채(`#f59e0b` amber) `amount` 축, 꺾은선 부채비율(`#dc2626` 빨강 — 코드베이스 비율선 컨벤션) `ratio` 축. (막대·선 색 충돌 회피)
- **영역 분리(표준)**: `amount` 도메인 `[0, max×2.5]`(막대 하단 밴드), `ratio` 도메인
  `[-ratioMax×1.5, ratioMax×1.1]`(선 상단 밴드). → chart-guide §4-F 표준 레시피.
- 필터 버튼(우상단, 차트1 전용): `listSubsidiaries()`로 동적 생성, 기본 '전체'.
- 막대 위 값 라벨 + 선 위 % 라벨, 상단 중앙 범례(LegendRow), 커스텀 툴팁, 빈 상태 처리.
- 높이 `useChartHeight(320, 400, 460)`.

## 차트 2 — `FinanceCapitalTable` (표, 전체/연결 고정)

열: `항목 | 2023 | 증감 | 2024 | 증감 | 2025 | 증감 | 2026.5(YTD)` (모든 연속 구간 증감).

행(들여쓰기 위계):

```
투하자본
 ├ 순운전자본            = 채권 + 재고 − 채무
 │   채권(+) · 재고(+) · 채무(−차감)
 ├ CAPEX                 = 유형자산 + 무형자산
 │   유형자산 · 무형자산
 └ 투하자본 합계         = 순운전자본 + CAPEX
자금조달
   현금(현금성자산) · 증자 · 차입금(차입)
   자금조달 합계         = 현금 + 증자 + 차입금
```

- 소계/합계 행 강조(굵게 + 배경). 증감 셀: ▲파랑/▼빨강 + 금액(억원)·%.
- 채무는 자체 값은 양수로 표기하되 `(차감)` 라벨, 순운전자본 합계에서 차감.
- 단위 억원. 빈 상태 처리.

## 페이지 / 탭 배선

- `app/management/finance/page.tsx`(server) → `getFinanceData()` → `FinanceDashboard`(client).
- `FinanceDashboard` — 차트 `dynamic(() => import(...), { ssr: false })` lazy + `LazyMount`(컨벤션).
- `components/management/management-tabs.tsx` `BASE_TABS`에 `{ label: '재무', href: '/management/finance' }` 추가(인원 다음).

## 검토용 샘플 데이터

`finance_entries`에 전체/미국 × {2023,2024,2025 연말, 2026.1~5} 그럴듯한 대차대조표 샘플 값을
SQL로 시드(자산=부채+자본 항등식 충족). dev 서버에서 양식 확인. 실제 값 입력 후 첫 `sync_finance.py`가 덮어씀.

## 문서 갱신 (pre-commit hook 동반 요건)

- **`docs/chart-guide.md` §4-F**: 콤보 막대·꺾은선 **영역 분리 규칙을 MUST로 명문화** + 표준 오프셋 도메인 레시피.
- **AGENTS.md**: 경영관리 탭 표(+재무), 사외비 테이블 명단(+finance_entries), sync 적재 정책(+sync_finance.py), lib/finance 도메인.
- **Architecture.md**: §5-A 재무 탭, §7-G `finance_entries` 스키마, 마이그레이션/태그 목록.

## 검증

- `npm run check-all`(lint+format+typecheck+vitest) 통과 + `lib/finance/aggregate.test.ts`.
- `sync_finance.py` `py_compile` + dry-run 안전성.
- dev 서버에서 sm/md/lg 폭, 필터 토글, 콘솔/네트워크 에러 확인.

## 비목표 (YAGNI)

- 별도(separate) 기준 — 현재 연결만. 추후 필요 시 확장.
- 표 필터 — 차트1에만(승인).
- 부채비율 외 추가 비율(유동비율 등) — 요청 범위 밖.
