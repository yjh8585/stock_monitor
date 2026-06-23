# 경영관리 엑셀 업로드 자동 적재 — 설계 문서

- 작성일: 2026-06-24
- 대상: `/management` (경영관리) 사외비 데이터 8종
- 작성 배경: admin이 월별손익 엑셀(`자료정리_월별손익*.xlsx`)을 웹에서 업로드하면, 현재 로컬에서 수동 실행하던 8개 `sync_*.py`를 자동 실행해 DB를 갱신한다.

## 1. 목표 / 비목표

### 목표
- admin 계정이 `/management/upload`에서 월별손익 엑셀을 업로드하면, 8종 사외비 데이터(손익·계획·재고·인원·비용비율·고정비·재무·대여금)가 자동 적재된다.
- 적재 전 **dry-run**으로 파싱·정합성 검증 요약을 화면에서 확인하고, admin이 "적재 확정"을 눌러야 실제 반영된다.
- 진행 상태(업로드 → dry-run → 확인 → 적재 → 완료)를 UI에서 폴링으로 표시한다.
- 기존 sync 스크립트의 정합성 검증을 **빠짐없이** 그대로 수행한다.

### 비목표
- 시트/테이블 선택 적재(부분 적재)는 만들지 않는다. 항상 8종 전체 일괄.
- 엑셀 자체를 웹에서 편집하는 기능은 없다.
- 로컬 수동 실행 워크플로는 폐기하지 않는다(환경변수 없을 때 기존 동작 보존).

## 2. 제약 / 전제

- **Vercel(Next.js)에서는 Python을 실행할 수 없다.** → 기존 `/management/companies` → `onboard-company.yml`과 동일하게 GitHub `workflow_dispatch`로 GHA에서 Python을 실행한다(`GITHUB_PAT` 필요).
- 엑셀은 **사외비**다. 원본 파일·요약·작업 상태 모두 사외비 격리 정책을 따른다(금액 비노출, RLS default deny, `confidentialDb`/service_role 전용).
- sync 스크립트의 정합성 검증은 **스크립트 내부에 내장**되어 있어 실행 경로(로컬/GHA)와 무관하게 항상 작동한다.

## 3. 전체 흐름

```
[admin /management/upload]
  │ ① 엑셀 선택 → POST /api/management/upload
  ▼
[Next.js API]
  - 파일 검증(.xlsx, 크기 한도)
  - Storage 비공개 버킷 업로드 (admin.ts / service_role)
  - management_uploads INSERT (status='uploaded')
  - GitHub workflow_dispatch (sync-management.yml, mode=dry-run, job_id, excel_path)
  - 응답 { job_id }
  ▼
[GHA sync-management.yml] mode=dry-run
  - Storage에서 엑셀 다운로드 → MANAGEMENT_EXCEL_PATH 설정
  - 8개 sync --dry-run 순차 실행 (정합성 검증 포함)
  - 요약(행수/연도/null/mismatch, 금액 비노출) → management_uploads UPDATE (status='dry_run_ok' | 'dry_run_failed')
  ▼
[UI 폴링] GET /api/management/upload/[jobId]  (2~3초 간격)
  - status='dry_run_ok' → 요약 표 + mismatch 경고 표시
  │ ② admin "적재 확정" 클릭 → POST /api/management/upload/[jobId]/apply
  ▼
[GHA sync-management.yml] mode=apply  (같은 excel_path)
  - 8개 sync 실제 실행 + --revalidate-prod
  - management_uploads UPDATE (status='applied' | 'apply_failed')
  ▼
[UI 폴링] status='applied' → 완료 표시 / 페이지 캐시 무효화 완료
```

### 왜 GitHub run id 대신 테이블 폴링인가
`workflow_dispatch`는 run id를 즉시 반환하지 않는다. 따라서 GHA가 진행 상태를 `management_uploads`에 기록하고 UI는 그 테이블만 폴링한다. dry-run 요약을 그대로 담을 수 있고, dispatch 실패/타임아웃도 상태로 표현 가능하다.

## 4. 데이터 모델

### 4.1 새 사외비 테이블 `management_uploads`

신규 사외비 테이블 → AGENTS.md **사외비 5-step** 준수.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK (default gen_random_uuid) | job_id |
| `status` | text NOT NULL | 상태 머신(아래 enum) |
| `mode` | text | 마지막 트리거 모드 `dry-run`/`apply` (관측용) |
| `excel_path` | text NOT NULL | Storage 비공개 버킷 경로 |
| `file_name` | text NOT NULL | 원본 파일명 |
| `uploaded_by` | text | 세션 sub(사용자 식별자) |
| `summary` | jsonb | dry-run 요약 — 스크립트별 행수/연도/null/mismatch (**금액 없음**) |
| `error_msg` | text | 실패 시 메시지 |
| `created_at` | timestamptz NOT NULL default now() | |
| `updated_at` | timestamptz NOT NULL default now() | 트리거로 자동 갱신 |

- `status` CHECK: `('uploaded','dry_run_running','dry_run_ok','dry_run_failed','applying','applied','apply_failed')`
- RLS enable + 정책 없음(default deny). 서버는 `confidentialDb.from('management_uploads')`로만 접근.
- 인덱스: `created_at desc` (목록/최근 조회용).

#### 상태 머신
```
uploaded ─dispatch→ dry_run_running ─GHA→ dry_run_ok ─apply→ applying ─GHA→ applied
                          │                    │                  │
                          └→ dry_run_failed    │                  └→ apply_failed
                                               └(admin 미확정 시 종착)
```

### 4.2 Storage 비공개 버킷 `management-excel`
- `public=false`, RLS deny. 경로 `{YYYY-MM-DD}/{job_id}.xlsx`.
- 업로드: `admin.ts`(service_role). GHA 다운로드: service_role.
- 보존: 적재 후에도 보관(재적재·감사). 별도 정리 정책은 본 스코프 밖(추후 cron 검토).

### 4.3 summary JSONB 형태(예시 스키마)
```json
{
  "scripts": [
    { "name": "sync_pnl_excel", "rows": 0, "years": [], "mismatch": 0, "ok": true },
    { "name": "sync_finance",   "rows": 0, "years": [], "mismatch": 0, "ok": true }
  ],
  "warnings": ["sync_finance: 자산=부채+자본 mismatch 1건"]
}
```
금액·인원수 등 수치 합계는 절대 포함하지 않는다. 행수/연도/월/null/mismatch 건수만.

## 5. 스크립트 변경 (최소 침습)

### 5.1 공통 헬퍼 `scripts/lib/management_excel.py` (신규)
- `resolve_excel_path() -> Path`: 환경변수 `MANAGEMENT_EXCEL_PATH`가 있으면 그 경로, 없으면 기존 `참고/손익/자료정리_월별손익*.xlsx` glob 최신.
- 8개 스크립트가 동일 글로브 로직을 중복 보유 → 이 헬퍼로 통합.

### 5.2 8개 sync의 `_latest_excel()` 교체
- `sync_pnl_excel.py`, `sync_pnl_plan.py`, `sync_inventory.py`, `sync_personnel.py`, `sync_pnl_cost_structure.py`, `sync_pnl_fixed_variable.py`, `sync_finance.py`, `sync_loan.py`
- 각 파일의 `_latest_excel()` 본문을 `resolve_excel_path()` 호출로 교체. **환경변수 없을 때 기존 동작 100% 보존**(로컬 수동 실행 회귀 없음).

### 5.3 오케스트레이터 `scripts/sync_management_excel.py` (신규)
- 인자: `--job-id <uuid> --excel-path <storage_path> --mode {dry-run|apply}`.
- 동작:
  1. `management_uploads` status를 `dry_run_running`/`applying`으로 UPDATE.
  2. Storage에서 엑셀 다운로드 → 임시 파일 → `os.environ['MANAGEMENT_EXCEL_PATH']` 설정.
  3. 8개 sync를 **정의된 순서**로 subprocess 실행:
     `pnl_excel → pnl_cost_structure → pnl_fixed_variable → pnl_plan → inventory → personnel → finance → loan`
     - dry-run: 각 `--dry-run`. apply: 각 기본 실행(+ `--revalidate-prod`는 오케스트레이터가 마지막에 1회 또는 각 스크립트에 위임 — 구현 시 확정).
  4. 각 스크립트 stdout 요약(금액 비노출)을 파싱·수집 → `summary` JSONB 구성.
  5. 성공: status `dry_run_ok`/`applied`. 하나라도 실패(exit≠0): `dry_run_failed`/`apply_failed` + `error_msg`. **apply는 fail-fast**(앞 스크립트 실패 시 중단).
- DB 접근은 `scripts/lib/db.py`(postgrest-py). 상태 UPDATE는 `WriteSession`이 아닌 직접 update(추적 대상 아님) 또는 management_uploads 전용 헬퍼.

#### 실행 순서 근거
의존 관계가 있는 것 우선: `pnl_cost_structure`/`pnl_fixed_variable`의 정합성 체크가 `pnl` 데이터를 참조하므로 `pnl_excel` → cost_structure/fixed_variable 순. 나머지는 독립이라 임의 순서지만 가독성 위해 도메인 묶음 유지.

## 6. GitHub Actions `.github/workflows/sync-management.yml` (신규)
- `workflow_dispatch` inputs: `job_id`(required), `excel_path`(required), `mode`(required, dry-run|apply).
- env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_REVALIDATE_URL`, `NEXT_REVALIDATE_SECRET`, `NEXT_REVALIDATE_PROD_URL`(있으면) — 기존 사외비 워크플로 설정 재사용.
- 단계: checkout → setup-python(+pip 캐시) → `pip install` → `python scripts/sync_management_excel.py --job-id ... --excel-path ... --mode ...`.
- Architecture.md §10 워크플로 목록에 추가.

## 7. API 라우트 (보호, admin 전용)

| 라우트 | 메서드 | 동작 |
|---|---|---|
| `/api/management/upload` | POST | 파일 검증 → Storage 업로드 → `management_uploads` INSERT → GHA dispatch(dry-run). 응답 `{ job_id }`. |
| `/api/management/upload/[jobId]` | GET | `confidentialDb`로 job 조회(폴링용). 응답 `{ status, summary, error_msg, file_name }`. |
| `/api/management/upload/[jobId]/apply` | POST | status가 `dry_run_ok`일 때만 GHA dispatch(apply) + status `applying`. 그 외 409. |

- 세 라우트 모두 `proxy.ts` 세션 검증 + 핸들러 내 `isAdmin(role)` 가드(admin 외 403).
- 파일 검증: 확장자 `.xlsx`, MIME, 크기 한도(예: 50MB). Zod로 입력 검증.
- GHA dispatch는 기존 `triggerOnboardWorkflow` 패턴 재사용(공통 헬퍼로 추출 검토).
- `/api/management/*`는 보호 라우트 — `proxy.ts` `PUBLIC_PATH_PREFIXES`에 추가하지 않는다.

## 8. UI

### 8.1 페이지 `app/management/upload/page.tsx`
- 서버 컴포넌트 + 클라이언트 업로드 폼.
- `/management` 탭 네비에 "자료 업로드" 추가(admin만 노출 — 역할 기반 조건부 렌더).

### 8.2 컴포넌트 `components/management/upload/upload-form.tsx` (client)
- 파일 선택(드래그&드롭 또는 input) → 업로드 → `job_id` 수신.
- `job_id` 폴링(2~3초): 상태별 표시
  - `uploaded`/`dry_run_running`: 진행 스피너 + "검증 중".
  - `dry_run_ok`: 스크립트별 요약 표(행수/연도) + **mismatch 경고 배지** + "적재 확정"/"취소" 버튼.
  - `dry_run_failed`: 오류 메시지 + 재업로드 안내.
  - `applying`: "적재 중" 스피너.
  - `applied`: 완료 메시지.
  - `apply_failed`: 오류 메시지.
- 금액 비노출: summary엔 수치 합계가 없으므로 화면에도 행수/연도/mismatch 건수만 표시.

### 8.3 mismatch 정책
- 정합성 mismatch는 **적재를 차단하지 않고 경고로 표시**한다(임계 0.5% 초과라도 admin 판단 우선). admin이 경고를 보고 "적재 확정"을 누를 수 있다. — *결정 필요: 차단으로 바꿀지 여부는 §11 오픈 이슈.*

## 9. 권한 / 보안
- `/management/upload` + `/api/management/upload*` → admin 전용. `permissions.ts` `ADMIN_ONLY_PATHS`에 `/management/upload` 추가, API 핸들러는 `isAdmin` 가드.
- 사외비 격리: `management_uploads`(RLS deny), `management-excel` 버킷(비공개), summary 금액 비노출.
- secret: `GITHUB_PAT`(Vercel env, 기존), GHA Secrets(기존). 코드 하드코딩 없음.

## 10. 문서 갱신 (같은 커밋)
- **AGENTS.md**: 라우트 책임 표(`/management/upload`), 공개/보호 라우트(`/api/management/upload*`), 새 워크플로(`sync-management.yml`), 새 사외비 테이블(`management_uploads`), 새 스크립트(`sync_management_excel.py`, `scripts/lib/management_excel.py`).
- **Architecture.md**: §5-A(경영관리 탭에 업로드), §7(스키마 `management_uploads`), §10(워크플로), §8(데이터 흐름).
- **메모리**: 본 기능 요약 + 시간감(6~10분) 기록.

## 11. 오픈 이슈 / 구현 시 확정
1. **mismatch 시 적재 차단 여부** — 현재 설계는 "경고만". 강한 차단을 원하면 dry_run_ok 대신 dry_run_warned 상태를 두고 확정 버튼에 추가 확인 모달.
2. **`--revalidate-prod` 호출 위치** — 오케스트레이터 마지막 1회 vs 각 sync 위임. 각 sync가 이미 WriteSession/upsert_rows로 자동 revalidate하므로, 프로덕션 추가 무효화만 오케스트레이터가 마지막에 8종 태그 일괄 1회 호출이 효율적.
3. **타임아웃 처리** — dispatch 후 N분간 상태 변화 없으면 UI가 "지연/실패 가능" 안내(GHA 시작 실패 대비). 폴링 최대 횟수 제한.
4. **Storage 보존 정리** — 누적 엑셀 정리 cron은 후속 과제.

## 12. 검증 계획
- Python: `py_compile` + 오케스트레이터/헬퍼 순수 로직 단위 실행. 8개 sync는 `MANAGEMENT_EXCEL_PATH` 분기 동작을 로컬 dry-run으로 확인(환경변수 set/unset 양쪽).
- TS: `npm run check-all`(lint/format/typecheck/test).
- 워크플로 실환경: `gh workflow run sync-management.yml`(dry-run) → `gh run watch` → 상태/요약이 `management_uploads`에 기록되는지 확인.
- UI: `npm run dev` + admin 로그인 → 업로드 → 폴링 → dry-run 요약 → 적재 확정 골든 패스(Playwright, 사외비 검증 규칙 준수: 금액 셀 미접근, 라벨/구조만).
```

