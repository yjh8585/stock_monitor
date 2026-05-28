# 경영관리 엑셀 통합 Sync Orchestrator Design

**작성일:** 2026-05-28
**상태:** Draft → User review
**관련 메모리:** `feedback_confidential_no_numbers.md`, `project_writesession_2026_05_23.md`

---

## 1. 배경 / 문제

경영관리 페이지(`/management`)는 `참고/손익/자료정리_월별손익_*.xlsx` 단일 엑셀에서 데이터를 받는다. 현재 3개 스크립트가 각각 같은 엑셀을 열고 자기 시트만 처리한다.

| 스크립트 | 처리 시트 | 적재 테이블 |
|---|---|---|
| `sync_pnl_excel.py` | 연간 / 연결_월 / 월 | `pnl_entries` |
| `sync_pnl_cost_structure.py` | 비용비율 | `pnl_cost_structure` |
| `sync_pnl_plan.py` | 계획 / 수주 | `pnl_plan` |

엑셀 시트 총 14개 중 6개가 수집 대상이고, 5개는 raw/intermediate(`월별_원본`, `정리_연간`, `정리_연결`, `정리_별도`, `참고`), 3개(`재고`, `인원`, `생산`)는 향후 수집 후보다. `/management`의 inventory·production 탭은 UI는 있으나 DB가 비어 있다.

**문제점:**

- 엑셀 1개 받을 때마다 사용자가 3개 스크립트를 순서대로 실행해야 한다.
- 새 시트(예: `재고`)가 추가되면 새 스크립트를 만들고 워크플로에 등록해야 하지만, 등록 누락이 생긴다.
- 미수집 시트가 늘어나도 알람이 없다 — 엑셀에는 있는데 DB에 없는 상태가 조용히 발생.
- 사외비 stdout 정책이 모듈마다 일관되지 않다 (`sync_pnl_plan.py`는 "금액 비노출" 가드 있지만 다른 모듈은 명시적 가드 부재).

## 2. 목표 / 비목표

**목표 (이번 작업):**

1. 단일 진입점 `scripts/sync_pnl_all.py` — 한 번 실행으로 등록된 모든 sync 모듈을 처리.
2. 자동 발견 — `scripts/sync_pnl_*.py` 파일 1개 드롭만으로 새 시트 통합. orchestrator 코드 변경 ✖.
3. 미수집 시트 자동 감지 — 엑셀에는 있지만 어느 모듈도 다루지 않는 시트를 경고.
4. 사외비 stdout 가드를 공용 helper로 일원화 — 모든 모듈이 동일한 정책 준수.
5. 기존 3개 스크립트의 stand-alone 호환성 유지 (`python sync_pnl_excel.py`도 그대로 동작).

**비목표 (이번 작업 ✖):**

- 재고/인원/생산 모듈·DB 테이블 구현 — 인프라만 준비, 모듈은 필요 시 후속 작업.
- 차트/UI 변경.
- 기존 sync 로직의 본질적 변경 (헤더 매핑·SKIP 정책·upsert 방식 등).
- 엑셀 위치 변경, 다중 엑셀 지원.

## 3. 사외비 정책 (필수 제약)

**원칙:** 구조·명단·행수는 stdout 허용, 금액 숫자는 stdout 차단. 적재 자체는 정상.

**가드 메커니즘:**

- `scripts/lib/confidential_log.py` 공용 helper 도입.
- `summarize_safe(rows, dim_keys, exclude=DEFAULT_VALUE_KEYS)` — 차원 키별 집계 dict를 반환. value/revenue/op_income 등 금액 키는 자동 제거.
- `assert_no_amount(text: str)` — 4자리 이상 숫자(콤마 포함) 패턴이 매치되면 `RuntimeError`. 단, 연도(`2020`~`2099`), 월 수(`1`~`12`), 비율(`%`), 행수 명시(`rows=N`) 등 명백히 안전한 패턴은 화이트리스트.
- 각 모듈은 dry-run summarize 직전에 `assert_no_amount(message)` 호출 — regression 방지 가드.

**orchestrator stdout:**

- 모듈 결과는 `SyncResult` dict의 metric 키(rows_upserted/sheets_processed/years_covered/elapsed_ms)만 출력.
- value/금액 키 절대 출력 ✖.

**검증:** orchestrator/모듈의 dry-run 출력을 capture해 4자리 이상 숫자 등장을 unit test로 차단(`tests/scripts/test_no_amount_in_stdout.py` — 향후 작업 항목, 이번 spec에는 포함 ✖).

## 4. 모듈 contract (각 `sync_pnl_*.py`)

각 sync 모듈은 다음 두 가지를 노출한다:

```python
# 모듈 레벨 상수 — orchestrator가 인트로스펙션
SYNC_META = {
    'name': 'pnl_entries',                  # 사람이 읽는 식별자 (로그·--list 용)
    'sheets': ['연간', '연결_월', '월'],      # 처리하는 엑셀 시트 명단
    'table': 'pnl_entries',                 # 적재 대상 DB 테이블
}

def run(excel_path: Path, *, dry_run: bool = False) -> SyncResult:
    """엑셀 경로 받아 적재 실행. SyncResult 반환. 금액 stdout 노출 ✖."""
    ...
```

**`SyncResult` dataclass** (`scripts/lib/confidential_log.py`에 정의):

```python
@dataclass(frozen=True)
class SyncResult:
    name: str                  # SYNC_META['name']과 동일
    rows_upserted: int         # 실제 upsert된 행수 (dry-run이면 시뮬레이션 행수)
    sheets_processed: list[str]
    years_covered: list[int]
    elapsed_ms: int
    error: str | None = None   # 실패 시 메시지, 성공 시 None
```

**호환성:** 기존 `main()` 함수는 유지 — `argparse`로 `--dry-run` 처리 후 `run(EXCEL_PATH, dry_run=...)` 호출. `python scripts/sync_pnl_excel.py`도 그대로 동작.

## 5. 자동 발견 알고리즘

```python
# scripts/sync_pnl_all.py 내부
SCRIPTS_DIR = Path(__file__).parent
SELF = Path(__file__).name

def discover_modules() -> list[ModuleType]:
    """sync_pnl_*.py glob → import → SYNC_META·run 존재 확인."""
    modules = []
    for path in sorted(SCRIPTS_DIR.glob('sync_pnl_*.py')):
        if path.name == SELF:
            continue
        mod = importlib.import_module(path.stem)
        if not hasattr(mod, 'SYNC_META') or not hasattr(mod, 'run'):
            logger.warning(f'{path.name}: SYNC_META 또는 run 누락 — 스킵')
            continue
        modules.append(mod)
    return modules
```

**무시 디렉터리:** `scripts/lib/` 하위는 glob 대상 아님(prefix 다름).

## 6. 미수집 시트 감지

```python
IGNORE_SHEETS = {'월별_원본', '정리_연간', '정리_연결', '정리_별도', '참고'}

def detect_uncovered(excel_path: Path, modules: list[ModuleType]) -> list[str]:
    wb = openpyxl.load_workbook(excel_path, read_only=True)
    excel_sheets = set(wb.sheetnames)
    covered = set()
    for mod in modules:
        covered.update(mod.SYNC_META['sheets'])
    return sorted(excel_sheets - covered - IGNORE_SHEETS)
```

미처리 시트가 발견되면 orchestrator는 경고 출력하고 종료 코드 0(경고)으로 계속 진행:

```
[경고] 미처리 엑셀 시트 (모듈 추가 필요):
  - 재고
  - 인원
  - 생산
```

`IGNORE_SHEETS`는 코드에 하드코딩. 향후 raw 시트가 늘면 같은 리스트에 추가.

## 7. CLI 인터페이스

```bash
# 전체 실행 (디폴트)
python scripts/sync_pnl_all.py

# 전 모듈 dry-run
python scripts/sync_pnl_all.py --dry-run

# 등록된 모듈 명세만 출력 (실행 ✖)
python scripts/sync_pnl_all.py --list

# 디버깅: 특정 모듈만 실행 (SYNC_META['name'] 매치)
python scripts/sync_pnl_all.py --only pnl_entries,pnl_plan
```

**`--list` 출력 예시:**

```
등록된 sync 모듈 (3):
  pnl_entries        sync_pnl_excel.py            sheets=[연간, 연결_월, 월]
  pnl_cost_structure sync_pnl_cost_structure.py   sheets=[비용비율]
  pnl_plan           sync_pnl_plan.py             sheets=[계획, 수주]

엑셀 미처리 시트 (3):
  재고, 인원, 생산
```

**`--dry-run` 출력 예시:** (실제 금액 없이 행수/연도만)

```
[pnl_entries] dry-run: 4225 rows / sheets=[연간, 연결_월, 월] / years=[2020..2026] / 318ms
[pnl_cost_structure] dry-run: 86 rows / sheets=[비용비율] / years=[2024..2026] / 42ms
[pnl_plan] dry-run: 312 rows / sheets=[계획, 수주] / years=[2020..2026] / 156ms

종합: 3/3 모듈 성공, 4623 rows.
```

## 8. 실패 정책

**continue-on-error:** 한 모듈이 실패해도 다른 모듈 실행 계속. 마지막에 성공/실패 종합 출력.

**근거:**

- 각 모듈은 자기 DB 테이블만 upsert — 모듈 간 데이터 정합성 의존성 없음.
- 한 모듈 헤더 검증 실패가 다른 모듈 적재를 막을 이유 없음.
- dry-run으로 사전 확인하는 워크플로 — 실 실행 시 실패 발생 빈도 낮음.

**종료 코드:**

- 0: 모든 모듈 성공.
- 1: 1개 이상 모듈 실패.
- 2: orchestrator 자체 실패(엑셀 파일 없음, import 실패 등).

각 모듈의 `run()`은 raise 대신 `SyncResult(error=...)` 반환 — orchestrator가 일관 처리.

## 9. 캐시 무효화

기존 모듈들은 이미 두 경로 중 하나로 자동 revalidate:

- `sync_pnl_excel.py` / `sync_pnl_cost_structure.py`: `db.upsert_rows()` 내부에서 `revalidate_for_tables` 자동 호출.
- `sync_pnl_plan.py`: `WriteSession` 사용 → 컨텍스트 종료 시 자동 revalidate.

**orchestrator는 별도 revalidate 호출 ✖** — 모듈에 위임. 새 모듈도 동일하게 둘 중 하나 사용 의무.

## 10. 변경/생성 파일 목록

| 종류 | 파일 | 변경 요약 |
|---|---|---|
| 생성 | `scripts/sync_pnl_all.py` | orchestrator (~180 LOC) |
| 생성 | `scripts/lib/confidential_log.py` | `summarize_safe`, `assert_no_amount`, `SyncResult` dataclass (~80 LOC) |
| 수정 | `scripts/sync_pnl_excel.py` | `SYNC_META` 추가 + `run()` 함수 추출(기존 main 본체) + `assert_no_amount` 호출 |
| 수정 | `scripts/sync_pnl_cost_structure.py` | 동일 |
| 수정 | `scripts/sync_pnl_plan.py` | 동일 |
| 수정 | `AGENTS.md` | "사외비 적재 정책" 섹션에 통합 진입점·모듈 contract 명시 |

**변경 ✖:**

- DB 마이그레이션 — 신규 테이블 없음.
- 기존 헤더 매핑/SKIP 정책/upsert 키 — 본질 로직 그대로.
- UI/페이지/차트.

## 11. 테스트 / 검증

**자동 테스트 (이번 spec 작업 범위 ✖, 후속 작업):**

- `scripts/lib/test_confidential_log.py` — `assert_no_amount`의 화이트리스트 검증.
- `tests/scripts/test_no_amount_in_stdout.py` — orchestrator dry-run capture → regex 검증.

**수동 검증 (이번 작업):**

1. `python scripts/sync_pnl_all.py --list` → 3개 모듈 정상 등록 + 재고/인원/생산 경고 표시.
2. `python scripts/sync_pnl_all.py --dry-run` → 3개 모듈 모두 성공 표시, 금액 4자리 이상 숫자 stdout 부재 검증.
3. `python scripts/sync_pnl_all.py` → 실제 적재 후 `/management/pnl` `/management/plan` 차트가 4월 데이터 반영 확인.
4. 각 기존 스크립트 단독 실행 (`python scripts/sync_pnl_excel.py`) 정상 동작 회귀.

**검증 기준:**

- `npm run check-all` 통과 — TS 영향 없으므로 자동 통과 예상.
- dry-run stdout 캡처에서 4자리 이상 숫자 등장 없음(`grep -E '[0-9]{4,}'` no match, 단 연도/100% 화이트리스트 제외).

## 12. 향후 확장 시나리오

**사례 A — 재고 시트 신규 수집 필요:**

1. 마이그레이션: `pnl_inventory` 테이블 생성 (RLS enable + 정책 없음).
2. `lib/database.types.ts` 재생성, `lib/supabase/confidential.ts`의 `CONFIDENTIAL_TABLES`에 한 줄 추가.
3. `scripts/sync_pnl_inventory.py` 생성 — `SYNC_META = {sheets: ['재고'], table: 'pnl_inventory'}` + `run()`.
4. **orchestrator 코드 변경 ✖** — 다음 실행부터 자동 픽업.

**사례 B — 엑셀에 새 시트 추가됐는데 모듈은 아직 ✖:**

- `sync_pnl_all.py` 실행 시 "미처리 시트" 경고 자동 노출. 사용자가 인지 → 모듈 작성 결정.

## 13. Open questions

없음 — brainstorming 단계에서 3가지 핵심 결정(자동 발견 / 인프라만 / 모듈 책임+helper) 모두 사용자 승인 완료.
