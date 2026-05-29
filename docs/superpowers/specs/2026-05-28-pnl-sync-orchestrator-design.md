# 경영관리 엑셀 통합 Sync 설계

**작성일:** 2026-05-28
**갱신:** 2026-05-28 — CLI 단일 디자인 → 2단계 (Phase 0 CLI 유지 + Phase 1 웹 업로드) + dual maintenance
**상태:** Phase 0 운영 중 (Python CLI). Phase 1 디자인 승인, 구현은 별도 plan
**관련 메모리:** `feedback_confidential_no_numbers.md`, `project_writesession_2026_05_23.md`

---

## 1. 배경 / 문제

경영관리 페이지(`/management`)는 `참고/손익/자료정리_월별손익_*.xlsx` 단일 엑셀에서 데이터를 받는다. 현재 3개 Python 스크립트가 각각 같은 엑셀을 열고 자기 시트만 처리한다.

| 스크립트                     | 처리 시트            | 적재 테이블          |
| ---------------------------- | -------------------- | -------------------- |
| `sync_pnl_excel.py`          | 연간 / 연결\_월 / 월 | `pnl_entries`        |
| `sync_pnl_cost_structure.py` | 비용비율             | `pnl_cost_structure` |
| `sync_pnl_plan.py`           | 계획 / 수주          | `pnl_plan`           |

엑셀 시트 총 14개 중 6개가 수집 대상이고, 5개는 raw/intermediate(`월별_원본`, `정리_연간`, `정리_연결`, `정리_별도`, `참고`), 3개(`재고`, `인원`, `생산`)는 향후 수집 후보다.

**문제점:**

- 엑셀 1개 받을 때마다 사용자가 3개 스크립트를 순서대로 실행해야 한다.
- 새 시트(예: `재고`)가 추가되면 새 스크립트를 만들고 워크플로에 등록해야 하지만, 등록 누락이 생긴다.
- 미수집 시트가 늘어나도 알람이 없다 — 엑셀에는 있는데 DB에 없는 상태가 조용히 발생.
- 사외비 stdout 정책이 모듈마다 일관되지 않다 (`sync_pnl_plan.py`는 "금액 비노출" 가드 있지만 다른 모듈은 명시적 가드 부재).

## 2. 두 단계 접근

| 단계        | 운영 방식                                                                                      | 상태                                                |
| ----------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Phase 0** | Python CLI 직접 실행 (Claude Code/사용자가 `python scripts/sync_pnl_*.py`)                     | 운영 중                                             |
| **Phase 1** | 웹 업로드 (`/management/companies` 페이지 → Vercel API → exceljs 파싱 → confidentialDb upsert) | 디자인 승인. 구현은 데이터 검증 안정화 후 별도 plan |

**Phase 0 → Phase 1 마이그레이션 시점:** 사용자가 데이터 적재 검증을 충분히 마치고 명시적 GO 사인을 줄 때. 그 전까지는 Python이 단일 진실 공급원(SSOT).

**Phase 0 보강 (이번 작업):** Python 스크립트들에 통합 진입점 + 사외비 가드 헬퍼 도입. §4~5에 명세.

**Phase 1 (향후):** 같은 모듈 contract를 TypeScript로 재구현. §6~10에 명세.

## 3. 사외비 정책 (양 단계 공통)

**원칙:** 구조·명단·행수는 stdout 허용, 금액 숫자는 stdout 차단. 적재 자체는 정상.

- Phase 0: `scripts/lib/confidential_log.py` 공용 helper. `summarize_safe(rows, dim_keys)` + `assert_no_amount(text)` 가드.
- Phase 1: `lib/management-sync/confidential-log.ts`. 동일 시그니처를 TS로.
- 4자리 이상 숫자(콤마 포함) 패턴 매치 시 RuntimeError. 화이트리스트: 연도(2020~2099), 월(1~12), 백분율(`\d+%`), 메타(`rows=N`, `elapsedMs=N`).

## 4. Phase 0 — Python CLI (현재)

### 4.1 통합 진입점

```
scripts/
  sync_pnl_all.py            # 신규 — orchestrator (auto-discover)
  sync_pnl_excel.py          # 기존 — run() 진입점 노출
  sync_pnl_cost_structure.py # 기존 — run() 진입점 노출
  sync_pnl_plan.py           # 기존 — run() 진입점 노출
  lib/
    confidential_log.py      # 신규
```

새 시트 추가 시 `sync_pnl_<name>.py` 파일 1개 드롭 → orchestrator 자동 픽업.

### 4.2 모듈 contract (Python)

```python
SYNC_META = {
    'name': 'pnl_entries',
    'sheets': ['연간', '연결_월', '월'],
    'table': 'pnl_entries',
}

def run(excel_path: Path, *, dry_run: bool = False) -> SyncResult:
    """SyncResult 반환. 금액 stdout 노출 ✖."""
```

기존 `main()`은 유지 — `python scripts/sync_pnl_excel.py`도 그대로 동작 (stand-alone 호환).

### 4.3 CLI

```bash
python scripts/sync_pnl_all.py            # 전체 실행
python scripts/sync_pnl_all.py --dry-run
python scripts/sync_pnl_all.py --list     # 등록된 모듈 명세만
python scripts/sync_pnl_all.py --only pnl_entries,pnl_plan
```

### 4.4 미수집 시트 감지

`IGNORE_SHEETS = {'월별_원본', '정리_연간', '정리_연결', '정리_별도', '참고'}`. 엑셀 시트 ∖ 등록 시트 ∖ IGNORE → 경고로 출력. 코드 변경 ✖.

### 4.5 실패 정책

continue-on-error. 모듈 간 정합성 의존성 없음(각자 자기 테이블만 upsert).

## 5. Phase 1 — 웹 업로드 (향후)

### 5.1 데이터 흐름

```
[ /management/companies ]
  엑셀 선택 → [적재] 버튼 (admin only — 관리자 권한 spec 참조)
  ↓ multipart/form-data
POST /api/management-sync/upload
  ↓ buffer 받음 (디스크 ✖)
exceljs 파싱 → SYNC_MODULES.run() 순차 호출
  ↓
confidentialDb.from(table).upsert(...) + revalidateTag(table)
  ↓
INSERT management_sync_audit_log
  ↓ 200 OK
{ results: [...], uncoveredSheets: [...] }
  ↓
UI 결과 카드 렌더 (행수/연도/경고/실패)
```

### 5.2 파일 / 책임

| 종류 | 경로                                                                | 책임                                                |
| ---- | ------------------------------------------------------------------- | --------------------------------------------------- |
| 생성 | `app/api/management-sync/upload/route.ts`                           | POST handler (admin 가드 포함)                      |
| 생성 | `lib/management-sync/types.ts`                                      | `SyncModule`, `SyncResult`                          |
| 생성 | `lib/management-sync/registry.ts`                                   | `SYNC_MODULES` 배열 + `IGNORE_SHEETS`               |
| 생성 | `lib/management-sync/confidential-log.ts`                           | `summarizeSafe`, `assertNoAmount`                   |
| 생성 | `lib/management-sync/orchestrator.ts`                               | `runSync(buffer, opts)`                             |
| 생성 | `lib/management-sync/modules/pnl-entries.ts`                        | Python 모듈과 동등                                  |
| 생성 | `lib/management-sync/modules/cost-structure.ts`                     | 동일                                                |
| 생성 | `lib/management-sync/modules/plan.ts`                               | 동일                                                |
| 생성 | `lib/management-sync/modules/*.test.ts`                             | Vitest                                              |
| 생성 | `components/management/companies/ExcelUploader.tsx`                 | 업로드 폼 + 결과 카드                               |
| 수정 | `app/management/companies/page.tsx`                                 | ExcelUploader 마운트                                |
| 수정 | `lib/supabase/confidential.ts`                                      | `CONFIDENTIAL_TABLES`에 `management_sync_audit_log` |
| 생성 | `supabase/migrations/YYYYMMDD_create_management_sync_audit_log.sql` | audit 테이블 + RLS deny                             |

### 5.3 모듈 contract (TypeScript — Python과 동등)

```typescript
export interface SyncModule {
  readonly meta: {
    readonly name: string;
    readonly sheets: readonly string[];
    readonly table: string;
  };
  run(workbook: ExcelJS.Workbook, opts: { dryRun: boolean }): Promise<SyncResult>;
}

export interface SyncResult {
  name: string;
  rowsUpserted: number;
  sheetsProcessed: string[];
  yearsCovered: number[];
  elapsedMs: number;
  error?: string;
}
```

### 5.4 Registry (explicit, idiomatic for Next.js)

```typescript
import { pnlEntriesSync } from './modules/pnl-entries';
import { costStructureSync } from './modules/cost-structure';
import { planSync } from './modules/plan';

export const SYNC_MODULES: SyncModule[] = [pnlEntriesSync, costStructureSync, planSync];
export const IGNORE_SHEETS = new Set(['월별_원본', '정리_연간', '정리_연결', '정리_별도', '참고']);
```

새 시트 = `modules/<name>.ts` 생성 + registry.ts 2줄 추가. 외부 관점에선 "파일 1개 드롭"과 동등.

### 5.5 사외비 가드 (Phase 1 추가 지점)

- **메모리만**: `Buffer.from(await file.arrayBuffer())` → 처리 → 응답 후 GC. 디스크 ✖, Supabase Storage ✖.
- **로그 sanitization**: `assertNoAmount(text)` 가드 (Phase 0과 동일 화이트리스트).
- **API 응답**: metric만 (rows/years/elapsed). 금액·값 ✖.
- **audit log**: `modules_json`은 metric만. 엑셀 raw 셀 값 ✖.

### 5.6 권한

- `/management/companies` 페이지 자체가 admin only (관리자 권한 spec 참조).
- POST handler도 admin 가드 (UI 가드와 API 가드 모두 필수 — 직접 fetch 우회 차단).

## 6. dual maintenance 약속 (Phase 1 도입 후)

Phase 1 (TS 모듈) 도입 후:

- **Python 스크립트 수정 시 TS 모듈도 같은 PR에서 수정.** 헤더 매핑·SKIP 정책·차원 정규화 등 본질 로직 변경 시 양쪽 일관성 유지.
- 변경 미반영 시 Phase 0/Phase 1 출력 결과가 갈리며 디버깅 어려움.
- 마이그레이션 시점에 `tests/management-sync/test_parity.ts` (양쪽 dry-run 결과 비교)를 1회 작성 → CI에서 회귀 가드 권장(이번 spec 범위 ✖).

**Phase 1 도입 전 (현재 상태):** Python만 수정하면 OK. TS 모듈 없으니 dual maintenance 의무 없음.

## 7. 변경 / 변경 ✖ (Phase 0 + Phase 1 합산)

**변경:**

- Phase 0: Python 통합 진입점 `sync_pnl_all.py` + `scripts/lib/confidential_log.py` + 3개 모듈에 `SYNC_META`/`run()` 추출
- Phase 1: TS 모듈 + API route + UI 컴포넌트 + audit 테이블
- AGENTS.md: "사외비 적재 정책" 섹션에 2단계 흐름·dual maintenance 명시

**변경 ✖:**

- DB `pnl_entries` / `pnl_cost_structure` / `pnl_plan` 스키마
- 차트 · `/management/pnl` · `/management/plan` UI
- 기존 Python 스크립트 헤더 매핑 / SKIP 정책 / upsert 키 (본질 로직)
- `proxy.ts` · `vercel.json`

## 8. 검증

**Phase 0 수동 검증:**

1. `python scripts/sync_pnl_all.py --list` → 3개 모듈 정상 등록 + 재고/인원/생산 경고 표시.
2. `python scripts/sync_pnl_all.py --dry-run` → 금액 4자리 이상 숫자 stdout 부재.
3. `python scripts/sync_pnl_all.py` → 실제 적재 후 `/management/pnl` `/management/plan` 차트 반영 확인.
4. 기존 스크립트 단독 실행 회귀 (`python scripts/sync_pnl_excel.py`) 정상.

**Phase 1 수동 검증:**

1. 관리자 로그인 → `/management/companies`에서 업로드 → 5~10초 응답.
2. mobility/holdings 로그인 → `/management/companies` URL 차단 (관리자 권한 spec 가드).
3. 응답 페이로드 capture → 금액 4자리 이상 숫자 부재.
4. 적재 후 `/management/pnl` 차트 반영.

**자동 검증:**

- `npm run check-all` 통과
- 향후 `lib/management-sync/modules/*.test.ts` (Vitest) + `test_parity.ts`

## 9. 향후 확장 시나리오

**사례 A — 재고 시트 신규 수집:**

1. Phase 0: `scripts/sync_pnl_inventory.py` 작성 → `python sync_pnl_all.py` 자동 픽업.
2. Phase 1 도입 후: `lib/management-sync/modules/inventory.ts` 동시 작성 (dual maintenance), registry.ts 2줄 추가.
3. DB 테이블 `pnl_inventory` 마이그레이션 + `confidential.ts` `CONFIDENTIAL_TABLES` 한 줄.

**사례 B — 엑셀에 새 시트 추가, 모듈 ✖:**

- Phase 0: orchestrator의 "미처리 시트" 경고.
- Phase 1: 응답 페이로드의 `uncoveredSheets` 배열 → UI에 노란 경고 카드.

## 10. Open questions

없음 — Phase 0/Phase 1 핵심 결정(자동 발견 / 인프라만 / 모듈 책임+helper / Vercel Node.js / explicit registry / 동기 응답 / dual maintenance) brainstorming 단계 사용자 승인 완료.
