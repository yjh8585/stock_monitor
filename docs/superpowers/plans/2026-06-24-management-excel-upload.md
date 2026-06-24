# 경영관리 엑셀 업로드 자동 적재 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** admin이 `/management/upload`에서 월별손익 엑셀을 업로드하면, 8개 사외비 sync 스크립트를 GitHub Actions로 dry-run→확인→적재 자동 실행한다.

**Architecture:** Next.js API가 엑셀을 Supabase 비공개 버킷에 올리고 `management_uploads`(사외비) 작업행을 만든 뒤 `workflow_dispatch`로 GHA 트리거. GHA의 오케스트레이터 `sync_management_excel.py`가 엑셀을 내려받아 `MANAGEMENT_EXCEL_PATH` 환경변수로 8개 sync를 subprocess 실행하고 결과 요약(금액 비노출)을 `management_uploads`에 기록. UI는 작업행을 폴링한다.

**Tech Stack:** Next.js 16 App Router, Supabase(Storage+PostgREST), Python 3.13(postgrest-py, openpyxl, requests), GitHub Actions, Vitest, pytest 미사용(순수 함수는 venv 직접 실행).

**오픈 이슈 결정(spec §11):**
- mismatch는 **경고만**(적재 차단 안 함).
- `--revalidate-prod`는 **오케스트레이터가 마지막에 8종 일괄 1회**(각 sync에 플래그 미전달).

---

## 파일 구조

**신규**
- `supabase/migrations/20260624000001_create_management_uploads.sql` — 작업 테이블 + 비공개 버킷
- `scripts/lib/management_excel.py` — `resolve_excel_path()` 공통 헬퍼
- `scripts/lib/test_management_excel.py` — 헬퍼 단위 테스트
- `scripts/sync_management_excel.py` — 오케스트레이터
- `scripts/lib/test_sync_management.py` — 오케스트레이터 순수 함수 테스트
- `.github/workflows/sync-management.yml` — GHA 워크플로
- `lib/github/workflow-dispatch.ts` — 재사용 dispatch 헬퍼
- `lib/management/upload-schema.ts` — Zod 입력/상태 타입
- `app/api/management/upload/route.ts` — POST(업로드+dry-run 트리거)
- `app/api/management/upload/[jobId]/route.ts` — GET(폴링)
- `app/api/management/upload/[jobId]/apply/route.ts` — POST(적재 트리거)
- `app/management/upload/page.tsx` — 페이지
- `components/management/upload/upload-form.tsx` — 클라이언트 폼+폴링

**수정**
- `scripts/sync_pnl_excel.py`, `sync_pnl_cost_structure.py`, `sync_pnl_fixed_variable.py`, `sync_pnl_plan.py`, `sync_inventory.py`, `sync_personnel.py`, `sync_finance.py`, `sync_loan.py` — `_latest_excel()` 본문을 공통 헬퍼 호출로 교체
- `lib/database.types.ts` — `management_uploads` 타입 블록 추가(말미 ViewRow/TableRow 헬퍼 보존)
- `lib/supabase/confidential.ts` — `CONFIDENTIAL_TABLES`에 `management_uploads` 추가
- `lib/auth/permissions.ts` — `ADMIN_ONLY_PATHS`에 `/management/upload` 추가
- `components/management/management-tabs.tsx` — "자료 업로드" 탭 추가
- `AGENTS.md`, `Architecture.md`, 메모리 — 문서 갱신

---

## Task 1: DB 마이그레이션 — management_uploads + 비공개 버킷

**Files:**
- Create: `supabase/migrations/20260624000001_create_management_uploads.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 경영관리 엑셀 업로드 작업 추적 (사외비). 금액 비노출 — summary엔 행수/연도/mismatch만.
-- 소스: admin이 /management/upload에서 올린 자료정리_월별손익*.xlsx.
-- RLS enable + 정책 없음(default deny) → anon 직접 접근 불가, 서버는 confidentialDb(service_role) 전용.
create table public.management_uploads (
  id          uuid primary key default gen_random_uuid(),
  status      text not null default 'uploaded'
              check (status in (
                'uploaded', 'dry_run_running', 'dry_run_ok', 'dry_run_failed',
                'applying', 'applied', 'apply_failed'
              )),
  mode        text check (mode in ('dry-run', 'apply')),
  excel_path  text not null,
  file_name   text not null,
  uploaded_by text,
  summary     jsonb,
  error_msg   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.management_uploads enable row level security;

create index management_uploads_created_at_idx
  on public.management_uploads (created_at desc);

-- updated_at 자동 갱신
create or replace function public.management_uploads_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger management_uploads_updated_at
  before update on public.management_uploads
  for each row execute function public.management_uploads_set_updated_at();

comment on table public.management_uploads is
  '경영관리 엑셀 업로드 작업 추적(사외비). RLS default deny, confidentialDb 전용. summary 금액 비노출.';

-- 사외비 엑셀 원본 비공개 버킷 (service_role만 접근, 정책 없음 → anon deny).
insert into storage.buckets (id, name, public)
values ('management-excel', 'management-excel', false)
on conflict (id) do nothing;
```

- [ ] **Step 2: 마이그레이션 적용**

MCP `mcp__supabase__apply_migration` (name: `create_management_uploads`) 또는 Supabase 대시보드로 적용.
Expected: 성공, `management_uploads` 테이블 + `management-excel` 버킷 생성.

- [ ] **Step 3: 검증 (테이블·RLS·버킷)**

`mcp__supabase__list_tables`로 `management_uploads` 존재 + RLS enabled 확인.
`mcp__supabase__execute_sql`: `select id, public from storage.buckets where id='management-excel';` → public=false.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260624000001_create_management_uploads.sql
git commit -m "feat(db): management_uploads 작업 테이블 + management-excel 비공개 버킷"
```

---

## Task 2: TypeScript 타입 — database.types + confidential 명단

**Files:**
- Modify: `lib/database.types.ts` (Tables 알파벳 위치에 `management_uploads` 블록 삽입)
- Modify: `lib/supabase/confidential.ts:39-49`

- [ ] **Step 1: database.types.ts에 management_uploads 블록 추가**

`Database['public']['Tables']` 안, 알파벳 순서상 `loan_entries` 다음 / `market_series` 이전 위치에 삽입:

```ts
      management_uploads: {
        Row: {
          created_at: string
          error_msg: string | null
          excel_path: string
          file_name: string
          id: string
          mode: string | null
          status: string
          summary: Json | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          error_msg?: string | null
          excel_path: string
          file_name: string
          id?: string
          mode?: string | null
          status?: string
          summary?: Json | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          error_msg?: string | null
          excel_path?: string
          file_name?: string
          id?: string
          mode?: string | null
          status?: string
          summary?: Json | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
```

> 주의: 파일 **말미의 수동 `ViewRow`/`TableRow` 헬퍼**(메모리 `database_types_helpers`)는 그대로 유지. 자동 generate로 덮지 말 것(수동 삽입으로 prettier churn 회피).

- [ ] **Step 2: confidential.ts 명단에 추가**

`lib/supabase/confidential.ts`의 `CONFIDENTIAL_TABLES` 배열 마지막 항목 뒤에 추가:

```ts
  'loan_entries',
  'management_uploads',
] as const;
```

그리고 주석 블록(`* - loan_entries: ...` 아래)에 한 줄:

```ts
 * - management_uploads: 경영관리 엑셀 업로드 작업 추적 (migration 20260624000001)
```

- [ ] **Step 3: 타입 체크**

Run: `npm run typecheck`
Expected: PASS (management_uploads가 ConfidentialTable union에 포함, schema에 존재).

- [ ] **Step 4: Commit**

```bash
git add lib/database.types.ts lib/supabase/confidential.ts
git commit -m "feat(types): management_uploads 타입 + confidentialDb 명단 등록"
```

---

## Task 3: 공통 엑셀 경로 헬퍼 (TDD)

**Files:**
- Create: `scripts/lib/management_excel.py`
- Test: `scripts/lib/test_management_excel.py`

- [ ] **Step 1: 실패하는 테스트 작성**

```python
"""resolve_excel_path() 단위 테스트 — 환경변수 우선 / glob 폴백."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib.management_excel import resolve_excel_path  # noqa: E402


def test_env_override_takes_precedence(tmp_path, monkeypatch):
  f = tmp_path / 'uploaded.xlsx'
  f.write_bytes(b'x')
  monkeypatch.setenv('MANAGEMENT_EXCEL_PATH', str(f))
  assert resolve_excel_path() == f


def test_env_missing_file_raises(monkeypatch):
  monkeypatch.setenv('MANAGEMENT_EXCEL_PATH', '/no/such/file.xlsx')
  try:
    resolve_excel_path()
    assert False, 'should raise'
  except FileNotFoundError:
    pass


def test_glob_fallback_when_no_env(tmp_path, monkeypatch):
  monkeypatch.delenv('MANAGEMENT_EXCEL_PATH', raising=False)
  base = tmp_path / '참고' / '손익'
  base.mkdir(parents=True)
  (base / '자료정리_월별손익_2026 5 27.xlsx').write_bytes(b'a')
  (base / '자료정리_월별손익_2026 6 22.xlsx').write_bytes(b'b')
  got = resolve_excel_path(base_dir=base)
  assert got.name == '자료정리_월별손익_2026 6 22.xlsx'  # 사전순 마지막


if __name__ == '__main__':
  import pytest
  sys.exit(pytest.main([__file__, '-v']))
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_management_excel.py -v`
Expected: FAIL — `ModuleNotFoundError: lib.management_excel`.

> pytest 미설치면 `scripts/venv/Scripts/python.exe -m pip install pytest` 후 진행. (CI 검증은 순수 로직이라 vitest와 별개)

- [ ] **Step 3: 헬퍼 구현**

```python
"""월별손익 엑셀 경로 해석 — 환경변수 우선, 없으면 참고/손익 glob 최신.

GHA 업로드 경로: 오케스트레이터가 Storage에서 받은 파일을 MANAGEMENT_EXCEL_PATH로 지정.
로컬 수동 실행: 환경변수 없음 → 기존 '참고/손익/자료정리_월별손익*.xlsx' glob 동작 보존.
"""
import os
from pathlib import Path

GLOB = '자료정리_월별손익*.xlsx'


def resolve_excel_path(base_dir: Path | None = None) -> Path:
  env = os.environ.get('MANAGEMENT_EXCEL_PATH', '').strip()
  if env:
    p = Path(env)
    if not p.exists():
      raise FileNotFoundError(f'MANAGEMENT_EXCEL_PATH 파일 없음: {p}')
    return p
  base = base_dir or (Path(__file__).resolve().parents[2] / '참고' / '손익')
  cands = sorted(base.glob(GLOB))
  if not cands:
    raise FileNotFoundError(f'손익 엑셀 없음: {base}')
  return cands[-1]
```

> 경로 주의: `scripts/lib/management_excel.py`에서 `참고/손익`은 `parents[2]`(repo root)다. (`scripts/sync_*.py`는 `parents[1]`이지만 lib는 한 단계 더 깊음.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_management_excel.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/management_excel.py scripts/lib/test_management_excel.py
git commit -m "feat(scripts): resolve_excel_path 공통 헬퍼 (env 우선/glob 폴백)"
```

---

## Task 4: 8개 sync의 `_latest_excel()` 공통 헬퍼로 교체

**Files (각 파일의 `_latest_excel()` 함수 동일 교체):**
- Modify: `scripts/sync_pnl_excel.py`
- Modify: `scripts/sync_pnl_cost_structure.py`
- Modify: `scripts/sync_pnl_fixed_variable.py`
- Modify: `scripts/sync_pnl_plan.py`
- Modify: `scripts/sync_inventory.py`
- Modify: `scripts/sync_personnel.py`
- Modify: `scripts/sync_finance.py`
- Modify: `scripts/sync_loan.py`

- [ ] **Step 1: 8개 파일에서 기존 `_latest_excel()` 본문 동일 확인**

Run: `npx -y grep` 대신 Grep 도구로 `def _latest_excel` 검색 → 8개 모두 아래와 동일한지 확인:

```python
def _latest_excel() -> Path:
  base = Path(__file__).resolve().parents[1] / '참고' / '손익'
  cands = sorted(base.glob('자료정리_월별손익*.xlsx'))
  if not cands:
    raise FileNotFoundError(f'손익 엑셀 없음: {base}')
  return cands[-1]
```

> 한 곳이라도 다르면 그 파일만 본문을 개별 확인 후 교체. (sync_pnl_excel은 PK 병합 등 다른 로직이 있어도 `_latest_excel`은 동일해야 함.)

- [ ] **Step 2: 각 파일에서 sys.path 아래 import 추가 + 함수 본문 교체**

각 파일의 기존 `from lib.db import ...` 라인 근처(이미 `sys.path.insert(0, str(Path(__file__).parent))`가 있음)에 import 추가:

```python
from lib.management_excel import resolve_excel_path  # noqa: E402
```

그리고 `_latest_excel()` 함수 전체를 아래로 교체(이름 유지 → 호출부 `path = _latest_excel()` 무변경):

```python
def _latest_excel() -> Path:
  return resolve_excel_path()
```

8개 파일 모두 동일하게 적용.

- [ ] **Step 3: 컴파일 체크**

Run:
```bash
scripts/venv/Scripts/python.exe -m py_compile scripts/sync_pnl_excel.py scripts/sync_pnl_cost_structure.py scripts/sync_pnl_fixed_variable.py scripts/sync_pnl_plan.py scripts/sync_inventory.py scripts/sync_personnel.py scripts/sync_finance.py scripts/sync_loan.py
```
Expected: 오류 없음(종료 코드 0).

- [ ] **Step 4: 로컬 회귀 — 환경변수 없이 dry-run 동작 보존 확인**

`scripts/.env`에 DB 자격증명이 있다는 전제. 환경변수 미설정 상태로 한 스크립트 dry-run:
Run: `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe scripts/sync_finance.py --dry-run`
Expected: 기존과 동일하게 `참고/손익`의 최신 엑셀을 찾아 파싱·검증 요약 출력(금액 비노출), `dry-run 완료`.

> DB 미연결 환경이면 이 단계는 "엑셀 로드: …최신파일" 로그까지만 확인하고 사유 보고.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync_pnl_excel.py scripts/sync_pnl_cost_structure.py scripts/sync_pnl_fixed_variable.py scripts/sync_pnl_plan.py scripts/sync_inventory.py scripts/sync_personnel.py scripts/sync_finance.py scripts/sync_loan.py
git commit -m "refactor(scripts): 8개 sync _latest_excel을 resolve_excel_path로 통합"
```

---

## Task 5: 오케스트레이터 `sync_management_excel.py` (순수 함수 TDD + 실행부)

**Files:**
- Create: `scripts/sync_management_excel.py`
- Test: `scripts/lib/test_sync_management.py`

- [ ] **Step 1: 순수 함수 테스트 작성 (build_job_summary, extract_warnings)**

```python
"""오케스트레이터 순수 함수 테스트 — 요약 빌드 / 경고 추출 (금액 비노출)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sync_management_excel import build_job_summary, extract_warnings  # noqa: E402


def test_extract_warnings_picks_mismatch_and_warning_lines():
  out = (
    'INFO 엑셀 로드: x\n'
    'WARNING 자산 != 부채+자본 mismatch: 1/5시점 (tol=0.5%)\n'
    'INFO 검증 OK\n'
  )
  w = extract_warnings(out)
  assert any('mismatch' in line for line in w)
  assert all('밸류' not in line for line in w)  # 금액 라벨 미포함


def test_build_job_summary_all_ok():
  results = [
    {'name': 'sync_finance', 'exit_code': 0, 'output': 'INFO 검증 OK\n'},
    {'name': 'sync_loan', 'exit_code': 0, 'output': 'INFO 완료\n'},
  ]
  s = build_job_summary(results)
  assert s['ok'] is True
  assert len(s['scripts']) == 2
  assert all(item['ok'] for item in s['scripts'])
  assert s['warnings'] == []


def test_build_job_summary_one_failed():
  results = [
    {'name': 'sync_finance', 'exit_code': 2, 'output': 'ERROR 헤더 불일치\n'},
    {'name': 'sync_loan', 'exit_code': 0, 'output': 'INFO 완료\n'},
  ]
  s = build_job_summary(results)
  assert s['ok'] is False
  finance = next(i for i in s['scripts'] if i['name'] == 'sync_finance')
  assert finance['ok'] is False
  assert finance['exit_code'] == 2


if __name__ == '__main__':
  import pytest
  sys.exit(pytest.main([__file__, '-v']))
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_sync_management.py -v`
Expected: FAIL — `ModuleNotFoundError: sync_management_excel`.

- [ ] **Step 3: 오케스트레이터 구현**

```python
#!/usr/bin/env python3
"""경영관리 엑셀 업로드 오케스트레이터.

Storage(management-excel 버킷)에서 엑셀을 내려받아 MANAGEMENT_EXCEL_PATH로 지정한 뒤
8개 sync 스크립트를 정의 순서로 subprocess 실행한다. 결과 요약(금액 비노출)을
management_uploads 작업행에 기록한다. GHA(workflow_dispatch)에서만 실행.

mode=dry-run : 각 sync에 --dry-run. status dry_run_running→dry_run_ok/dry_run_failed.
mode=apply   : 각 sync 실제 적재(fail-fast). 마지막에 8종 태그 일괄 revalidate.
               status applying→applied/apply_failed.

금액 비노출: sync 스크립트 stdout/stderr 자체가 행수/연도/null/mismatch만 출력하므로
캡처 텍스트를 그대로 summary에 담아도 안전(AGENTS '사외비 적재 정책').

사용법
-----
  python scripts/sync_management_excel.py --job-id <uuid> --excel-path <bucket/path> --mode dry-run
"""
import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')
sys.path.insert(0, str(Path(__file__).parent))
from lib.db import get_client  # noqa: E402
from lib.revalidate import revalidate_for_tables  # noqa: E402

BUCKET = 'management-excel'
JOB_TABLE = 'management_uploads'

# 실행 순서: pnl → cost_structure/fixed_variable(정합성 검증이 pnl 참조) → 나머지.
SCRIPTS = [
  'sync_pnl_excel.py',
  'sync_pnl_cost_structure.py',
  'sync_pnl_fixed_variable.py',
  'sync_pnl_plan.py',
  'sync_inventory.py',
  'sync_personnel.py',
  'sync_finance.py',
  'sync_loan.py',
]

# revalidate 대상 8종 테이블 (apply 마지막 일괄 1회).
MANAGEMENT_TABLES = [
  'pnl_entries', 'pnl_cost_structure', 'pnl_fixed_variable', 'pnl_plan',
  'inventory_entries', 'personnel_entries', 'finance_entries', 'loan_entries',
]

OUTPUT_TAIL = 2000  # summary에 담는 스크립트별 출력 말미 길이


def extract_warnings(output: str) -> list[str]:
  """캡처 출력에서 경고/mismatch 라인만 추출 (금액 비노출 — 원문 그대로)."""
  out: list[str] = []
  for line in output.splitlines():
    low = line.lower()
    if 'mismatch' in low or 'warning' in low or 'error' in low:
      out.append(line.strip())
  return out


def build_job_summary(results: list[dict[str, Any]]) -> dict[str, Any]:
  """subprocess 결과 목록 → summary JSONB dict (금액 비노출)."""
  scripts = []
  warnings: list[str] = []
  for r in results:
    ok = r['exit_code'] == 0
    scripts.append({
      'name': r['name'],
      'exit_code': r['exit_code'],
      'ok': ok,
      'output': r['output'][-OUTPUT_TAIL:],
    })
    for w in extract_warnings(r['output']):
      warnings.append(f"{r['name']}: {w}")
  return {
    'ok': all(s['ok'] for s in scripts),
    'scripts': scripts,
    'warnings': warnings,
  }


def _set_status(job_id: str, **fields: Any) -> None:
  """management_uploads 작업행 갱신 (사외비 — 페이지 캐시 태그 없음, 직접 update)."""
  get_client().table(JOB_TABLE).update(fields).eq('id', job_id).execute()


def _download_excel(excel_path: str) -> Path:
  """Storage management-excel 버킷에서 엑셀을 임시 파일로 내려받는다."""
  url = os.environ['SUPABASE_URL'].rstrip('/')
  key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
  endpoint = f'{url}/storage/v1/object/{BUCKET}/{excel_path}'
  resp = requests.get(
    endpoint,
    headers={'apikey': key, 'Authorization': f'Bearer {key}'},
    timeout=60,
  )
  resp.raise_for_status()
  fd, tmp = tempfile.mkstemp(suffix='.xlsx', prefix='mgmt_')
  with os.fdopen(fd, 'wb') as f:
    f.write(resp.content)
  return Path(tmp)


def _run_script(script: str, dry_run: bool, env: dict[str, str]) -> dict[str, Any]:
  """단일 sync 스크립트를 subprocess 실행, stdout+stderr 캡처."""
  cmd = [sys.executable, str(Path(__file__).parent / script)]
  if dry_run:
    cmd.append('--dry-run')
  logger.info(f'▶ {script} {"(dry-run)" if dry_run else "(apply)"}')
  proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
  output = (proc.stdout or '') + (proc.stderr or '')
  return {'name': script.replace('.py', ''), 'exit_code': proc.returncode, 'output': output}


def main() -> int:
  ap = argparse.ArgumentParser(description='경영관리 엑셀 업로드 오케스트레이터 (GHA 전용)')
  ap.add_argument('--job-id', required=True)
  ap.add_argument('--excel-path', required=True, help='management-excel 버킷 내 경로')
  ap.add_argument('--mode', required=True, choices=['dry-run', 'apply'])
  args = ap.parse_args()

  dry_run = args.mode == 'dry-run'
  running = 'dry_run_running' if dry_run else 'applying'
  _set_status(args.job_id, status=running, mode=args.mode)

  try:
    excel = _download_excel(args.excel_path)
  except Exception as e:
    logger.error(f'엑셀 다운로드 실패: {e}')
    _set_status(args.job_id,
                status='dry_run_failed' if dry_run else 'apply_failed',
                error_msg=f'엑셀 다운로드 실패: {e}')
    return 1

  env = dict(os.environ)
  env['MANAGEMENT_EXCEL_PATH'] = str(excel)
  env['PYTHONIOENCODING'] = 'utf-8'

  results: list[dict[str, Any]] = []
  failed = False
  for script in SCRIPTS:
    r = _run_script(script, dry_run, env)
    results.append(r)
    if r['exit_code'] != 0:
      failed = True
      if not dry_run:
        logger.error(f'{script} 실패 — apply fail-fast 중단')
        break  # apply는 fail-fast

  summary = build_job_summary(results)

  if failed:
    _set_status(args.job_id,
                status='dry_run_failed' if dry_run else 'apply_failed',
                summary=summary,
                error_msg='하나 이상의 sync 실패 — output 참고')
    logger.error(f'작업 실패 (mode={args.mode})')
    return 1

  if dry_run:
    _set_status(args.job_id, status='dry_run_ok', summary=summary, error_msg=None)
    logger.success('dry-run 완료')
  else:
    # 적재 성공 → 8종 태그 일괄 revalidate 1회 (GHA에선 NEXT_REVALIDATE_URL=prod).
    revalidate_for_tables(MANAGEMENT_TABLES)
    _set_status(args.job_id, status='applied', summary=summary, error_msg=None)
    logger.success('적재 완료 + 캐시 무효화')
  return 0


if __name__ == '__main__':
  sys.exit(main())
```

- [ ] **Step 4: 순수 함수 테스트 통과 확인**

Run: `scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_sync_management.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: 컴파일 체크**

Run: `scripts/venv/Scripts/python.exe -m py_compile scripts/sync_management_excel.py`
Expected: 오류 없음.

- [ ] **Step 6: Commit**

```bash
git add scripts/sync_management_excel.py scripts/lib/test_sync_management.py
git commit -m "feat(scripts): 경영관리 엑셀 업로드 오케스트레이터 (8 sync 순차 + 요약)"
```

---

## Task 6: GitHub Actions 워크플로

**Files:**
- Create: `.github/workflows/sync-management.yml`

- [ ] **Step 1: 워크플로 작성**

```yaml
name: 경영관리 엑셀 업로드 적재 (dry-run/apply)

on:
  workflow_dispatch:
    inputs:
      job_id:
        description: 'management_uploads 작업 id (uuid)'
        required: true
        type: string
      excel_path:
        description: 'management-excel 버킷 내 엑셀 경로'
        required: true
        type: string
      mode:
        description: '실행 모드'
        required: true
        type: choice
        options:
          - dry-run
          - apply

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    defaults:
      run:
        working-directory: scripts

    steps:
      - name: 저장소 체크아웃
        uses: actions/checkout@v4

      - name: Python 3.13 설정
        uses: actions/setup-python@v5
        with:
          python-version: '3.13'
          cache: 'pip'
          cache-dependency-path: scripts/requirements.txt

      - name: 의존성 설치
        run: pip install -r requirements.txt

      - name: 경영관리 엑셀 적재 실행
        run: |
          python sync_management_excel.py \
            --job-id "${{ github.event.inputs.job_id }}" \
            --excel-path "${{ github.event.inputs.excel_path }}" \
            --mode "${{ github.event.inputs.mode }}"
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          NEXT_REVALIDATE_URL: ${{ secrets.NEXT_REVALIDATE_URL }}
          NEXT_REVALIDATE_SECRET: ${{ secrets.NEXT_REVALIDATE_SECRET }}
```

> Playwright 설치 단계 없음(이 워크플로는 엑셀 파싱·DB만, 스크래핑 없음). `NEXT_REVALIDATE_URL` 시크릿이 프로덕션 `/api/revalidate`라 적재 후 캐시가 prod에서 무효화됨.

- [ ] **Step 2: YAML 문법 확인**

Run: `npx -y js-yaml .github/workflows/sync-management.yml > /dev/null && echo OK` (또는 GitHub에서 lint).
Expected: OK (파싱 성공).

> js-yaml 없으면 Python: `scripts/venv/Scripts/python.exe -c "import yaml,sys; yaml.safe_load(open('.github/workflows/sync-management.yml',encoding='utf-8')); print('OK')"`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/sync-management.yml
git commit -m "feat(ci): sync-management 워크플로 (엑셀 업로드 dry-run/apply)"
```

---

## Task 7: GitHub workflow_dispatch 재사용 헬퍼

**Files:**
- Create: `lib/github/workflow-dispatch.ts`

- [ ] **Step 1: 헬퍼 작성**

```ts
import 'server-only';

const GITHUB_OWNER = 'yjh8585';
const GITHUB_REPO = 'stock_monitor';

export type DispatchResult = { ok: boolean; url?: string; error?: string };

/**
 * GitHub Actions workflow_dispatch 트리거 (fire-and-forget).
 *
 * @param workflow  워크플로 파일명 (예: 'sync-management.yml')
 * @param inputs    workflow_dispatch inputs
 * @returns ok=false 시 error 메시지. 호출부에서 graceful 처리.
 */
export async function dispatchWorkflow(
  workflow: string,
  inputs: Record<string, string>
): Promise<DispatchResult> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) return { ok: false, error: 'GITHUB_PAT 환경변수 미설정' };
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${workflow}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ ref: 'master', inputs }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `GitHub API ${res.status}: ${text.slice(0, 200)}` };
    }
    return {
      ok: true,
      url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${workflow}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 2: 타입 체크**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/github/workflow-dispatch.ts
git commit -m "feat(github): workflow_dispatch 재사용 헬퍼"
```

---

## Task 8: Zod 스키마 + 업로드 POST API

**Files:**
- Create: `lib/management/upload-schema.ts`
- Create: `app/api/management/upload/route.ts`

- [ ] **Step 1: 스키마/타입 작성**

```ts
import { z } from 'zod';

/** 업로드 작업 상태 머신. management_uploads.status CHECK와 일치. */
export const UPLOAD_STATUSES = [
  'uploaded',
  'dry_run_running',
  'dry_run_ok',
  'dry_run_failed',
  'applying',
  'applied',
  'apply_failed',
] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

/** GET 폴링 응답에 노출하는 작업 요약 (금액 비노출 — 행수/연도/경고만). */
export const uploadJobViewSchema = z.object({
  id: z.string(),
  status: z.enum(UPLOAD_STATUSES),
  file_name: z.string(),
  summary: z.unknown().nullable(),
  error_msg: z.string().nullable(),
});
export type UploadJobView = z.infer<typeof uploadJobViewSchema>;

export const MAX_XLSX_BYTES = 50 * 1024 * 1024; // 50MB
```

- [ ] **Step 2: POST 라우트 작성**

```ts
import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { isAdmin } from '@/lib/auth/permissions';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { dispatchWorkflow } from '@/lib/github/workflow-dispatch';
import logger from '@/lib/logger';
import { MAX_XLSX_BYTES } from '@/lib/management/upload-schema';
import { fail, ok } from '@/lib/reports/api-response';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { confidentialDb } from '@/lib/supabase/confidential';

const BUCKET = 'management-excel';
const WORKFLOW = 'sync-management.yml';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * 경영관리 엑셀 업로드 → 비공개 버킷 저장 → management_uploads INSERT
 * → sync-management.yml(dry-run) workflow_dispatch. 응답 { job_id }.
 * admin 전용. dispatch 실패해도 작업행은 유지(graceful), error_msg 기록.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json(fail('UNAUTHORIZED', '로그인이 필요합니다.'), { status: 401 });
  if (!isAdmin(user.role))
    return NextResponse.json(fail('FORBIDDEN', '관리자만 사용할 수 있습니다.'), { status: 403 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(fail('INVALID_FORM', 'multipart 요청이 아닙니다.'), { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File))
    return NextResponse.json(fail('FILE_REQUIRED', 'file 필드가 필요합니다.'), { status: 400 });
  if (file.size === 0)
    return NextResponse.json(fail('EMPTY_FILE', '빈 파일은 업로드할 수 없습니다.'), { status: 400 });
  if (file.size > MAX_XLSX_BYTES)
    return NextResponse.json(fail('FILE_TOO_LARGE', '50MB 이하만 업로드 가능합니다.'), { status: 400 });
  const isXlsx = file.name.toLowerCase().endsWith('.xlsx') && (file.type === XLSX_MIME || file.type === '');
  if (!isXlsx)
    return NextResponse.json(fail('INVALID_TYPE', '.xlsx 파일만 업로드 가능합니다.'), { status: 400 });

  const jobId = randomUUID();
  const objectPath = `${new Date().toISOString().slice(0, 10)}/${jobId}.xlsx`;

  const admin = createSupabaseAdminClient();
  const arrayBuffer = await file.arrayBuffer();
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(objectPath, Buffer.from(arrayBuffer), { contentType: XLSX_MIME, upsert: false });
  if (upErr) {
    logger.error({ err: upErr }, '엑셀 업로드 실패');
    return NextResponse.json(fail('UPLOAD_FAILED', '엑셀 업로드에 실패했습니다.'), { status: 500 });
  }

  const { error: insErr } = await confidentialDb.from('management_uploads').insert({
    id: jobId,
    status: 'uploaded',
    excel_path: objectPath,
    file_name: file.name,
    uploaded_by: user.id,
  });
  if (insErr) {
    logger.error({ err: insErr }, 'management_uploads INSERT 실패');
    return NextResponse.json(fail('INSERT_FAILED', insErr.message), { status: 500 });
  }

  const dispatch = await dispatchWorkflow(WORKFLOW, {
    job_id: jobId,
    excel_path: objectPath,
    mode: 'dry-run',
  });
  if (!dispatch.ok) {
    logger.warn({ err: dispatch.error, jobId }, 'sync-management dispatch 실패 — 작업행 유지');
    await confidentialDb
      .from('management_uploads')
      .update({ status: 'dry_run_failed', error_msg: `dispatch 실패: ${dispatch.error}` })
      .eq('id', jobId);
  }

  return NextResponse.json(
    ok({ job_id: jobId, dispatchError: dispatch.ok ? null : dispatch.error }),
    { status: 201 }
  );
}
```

- [ ] **Step 3: 타입 체크 + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/management/upload-schema.ts app/api/management/upload/route.ts
git commit -m "feat(api): 경영관리 엑셀 업로드 POST (버킷 저장 + dry-run dispatch)"
```

---

## Task 9: 폴링 GET API

**Files:**
- Create: `app/api/management/upload/[jobId]/route.ts`

- [ ] **Step 1: GET 라우트 작성**

```ts
import { NextResponse } from 'next/server';

import { isAdmin } from '@/lib/auth/permissions';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { fail, ok } from '@/lib/reports/api-response';
import { confidentialDb } from '@/lib/supabase/confidential';

/**
 * 업로드 작업 폴링. admin 전용. 금액 비노출(summary엔 행수/연도/경고만).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json(fail('UNAUTHORIZED', '로그인이 필요합니다.'), { status: 401 });
  if (!isAdmin(user.role))
    return NextResponse.json(fail('FORBIDDEN', '관리자만 사용할 수 있습니다.'), { status: 403 });

  const { jobId } = await params;
  const { data, error } = await confidentialDb
    .from('management_uploads')
    .select('id, status, file_name, summary, error_msg')
    .eq('id', jobId)
    .maybeSingle();
  if (error) return NextResponse.json(fail('LOOKUP_FAILED', error.message), { status: 500 });
  if (!data) return NextResponse.json(fail('NOT_FOUND', '작업을 찾을 수 없습니다.'), { status: 404 });

  return NextResponse.json(ok(data));
}
```

- [ ] **Step 2: 타입 체크**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/management/upload/[jobId]/route.ts
git commit -m "feat(api): 업로드 작업 폴링 GET"
```

---

## Task 10: 적재 확정 POST API

**Files:**
- Create: `app/api/management/upload/[jobId]/apply/route.ts`

- [ ] **Step 1: apply 라우트 작성**

```ts
import { NextResponse } from 'next/server';

import { isAdmin } from '@/lib/auth/permissions';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { dispatchWorkflow } from '@/lib/github/workflow-dispatch';
import logger from '@/lib/logger';
import { fail, ok } from '@/lib/reports/api-response';
import { confidentialDb } from '@/lib/supabase/confidential';

const WORKFLOW = 'sync-management.yml';

/**
 * 적재 확정. status가 dry_run_ok일 때만 apply 모드 workflow_dispatch.
 * admin 전용. mismatch는 차단하지 않음(경고만, spec §11 결정).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json(fail('UNAUTHORIZED', '로그인이 필요합니다.'), { status: 401 });
  if (!isAdmin(user.role))
    return NextResponse.json(fail('FORBIDDEN', '관리자만 사용할 수 있습니다.'), { status: 403 });

  const { jobId } = await params;
  const { data: job, error } = await confidentialDb
    .from('management_uploads')
    .select('id, status, excel_path')
    .eq('id', jobId)
    .maybeSingle();
  if (error) return NextResponse.json(fail('LOOKUP_FAILED', error.message), { status: 500 });
  if (!job) return NextResponse.json(fail('NOT_FOUND', '작업을 찾을 수 없습니다.'), { status: 404 });
  if (job.status !== 'dry_run_ok')
    return NextResponse.json(
      fail('INVALID_STATE', `dry-run 성공 상태에서만 적재할 수 있습니다 (현재: ${job.status}).`),
      { status: 409 }
    );

  const dispatch = await dispatchWorkflow(WORKFLOW, {
    job_id: jobId,
    excel_path: job.excel_path,
    mode: 'apply',
  });
  if (!dispatch.ok) {
    logger.warn({ err: dispatch.error, jobId }, 'apply dispatch 실패');
    return NextResponse.json(fail('DISPATCH_FAILED', dispatch.error ?? 'dispatch 실패'), {
      status: 502,
    });
  }

  await confidentialDb.from('management_uploads').update({ status: 'applying' }).eq('id', jobId);
  return NextResponse.json(ok({ job_id: jobId }));
}
```

> dispatch 실패 시 status를 `applying`으로 바꾸지 않음 — `dry_run_ok` 유지로 재시도 가능.

- [ ] **Step 2: 타입 체크 + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/management/upload/[jobId]/apply/route.ts
git commit -m "feat(api): 적재 확정 POST (dry_run_ok→apply dispatch)"
```

---

## Task 11: 권한 — /management/upload admin 전용

**Files:**
- Modify: `lib/auth/permissions.ts:4`

- [ ] **Step 1: ADMIN_ONLY_PATHS에 추가**

```ts
/** admin 전용 페이지 prefix — 비관리자는 proxy.ts에서 `/`로 redirect. */
const ADMIN_ONLY_PATHS = ['/management/companies', '/management/upload'];
```

- [ ] **Step 2: 타입 체크**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/auth/permissions.ts
git commit -m "feat(auth): /management/upload admin 전용 경로 등록"
```

---

## Task 12: UI — 페이지 + 업로드 폼 + 탭

**Files:**
- Create: `app/management/upload/page.tsx`
- Create: `components/management/upload/upload-form.tsx`
- Modify: `components/management/management-tabs.tsx:10-18`

- [ ] **Step 1: 탭 추가**

`ALL_TABS` 배열의 `회사` 항목 앞에 추가:

```ts
  { label: '재무', href: '/management/finance' },
  { label: '자료 업로드', href: '/management/upload' },
  { label: '회사', href: '/management/companies' },
] as const;
```

(canAccess가 admin만 통과시키므로 admin에게만 노출.)

- [ ] **Step 2: 페이지 작성**

```tsx
import { ManagementExcelUploadForm } from '@/components/management/upload/upload-form';

export const metadata = {
  title: '자료 업로드 — 경영관리',
};

/**
 * 월별손익 엑셀 업로드 → dry-run 검증 → 확인 후 적재. admin 전용(permissions ADMIN_ONLY_PATHS).
 * 실제 적재는 GitHub Actions(sync-management.yml)에서 8개 sync 실행.
 */
export default function ManagementUploadPage() {
  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h2 className="text-base font-semibold">월별손익 엑셀 업로드</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          자료정리_월별손익 엑셀을 올리면 8개 사외비 데이터(손익·계획·재고·인원·비용비율·고정비·재무·대여금)를
          자동 적재합니다. 먼저 dry-run으로 검증 요약을 확인한 뒤 적재를 확정하세요. 적재까지 수 분 소요됩니다.
        </p>
      </div>
      <ManagementExcelUploadForm />
    </div>
  );
}
```

- [ ] **Step 3: 업로드 폼(클라이언트) 작성**

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import type { UploadStatus } from '@/lib/management/upload-schema';

type ScriptItem = { name: string; ok: boolean; exit_code: number; output: string };
type JobSummary = { ok: boolean; scripts: ScriptItem[]; warnings: string[] } | null;
type JobView = {
  id: string;
  status: UploadStatus;
  file_name: string;
  summary: JobSummary;
  error_msg: string | null;
};

const POLL_MS = 3000;
const TERMINAL: UploadStatus[] = ['dry_run_ok', 'dry_run_failed', 'applied', 'apply_failed'];

export function ManagementExcelUploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/management/upload/${id}`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        const v = json.data as JobView;
        setJob(v);
        if (!TERMINAL.includes(v.status)) {
          timer.current = setTimeout(() => poll(id), POLL_MS);
        }
      }
    } catch {
      timer.current = setTimeout(() => poll(id), POLL_MS);
    }
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onUpload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/management/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(json?.error?.message ?? '업로드 실패');
        return;
      }
      const id = json.data.job_id as string;
      setJobId(id);
      setJob(null);
      toast.success('업로드 완료. dry-run 검증을 시작합니다.');
      poll(id);
    } finally {
      setBusy(false);
    }
  };

  const onApply = async () => {
    if (!jobId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/management/upload/${jobId}/apply`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(json?.error?.message ?? '적재 트리거 실패');
        return;
      }
      toast.success('적재를 시작합니다.');
      poll(jobId);
    } finally {
      setBusy(false);
    }
  };

  const status = job?.status;
  const inProgress = status === 'dry_run_running' || status === 'applying' || (!!jobId && !job);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        <Button onClick={onUpload} disabled={!file || busy || inProgress}>
          업로드 + 검증
        </Button>
      </div>

      {inProgress && (
        <p className="text-sm text-muted-foreground">
          {status === 'applying' ? '적재 중…' : '검증 중…'} (수 분 소요, 자동 갱신)
        </p>
      )}

      {status === 'dry_run_failed' && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">검증 실패</p>
          <p className="text-muted-foreground mt-1">{job?.error_msg}</p>
          <ScriptTable summary={job?.summary} />
        </div>
      )}

      {status === 'dry_run_ok' && (
        <div className="rounded-md border border-border p-3 text-sm space-y-3">
          <p className="font-medium">검증 완료 — 적재 준비됨</p>
          <WarningList summary={job?.summary} />
          <ScriptTable summary={job?.summary} />
          <Button onClick={onApply} disabled={busy}>
            적재 확정
          </Button>
        </div>
      )}

      {status === 'applied' && (
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium text-green-600">적재 완료</p>
          <p className="text-muted-foreground mt-1">페이지 데이터가 갱신되었습니다.</p>
        </div>
      )}

      {status === 'apply_failed' && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">적재 실패</p>
          <p className="text-muted-foreground mt-1">{job?.error_msg}</p>
          <ScriptTable summary={job?.summary} />
        </div>
      )}
    </div>
  );
}

function WarningList({ summary }: { summary: JobSummary }) {
  if (!summary?.warnings?.length) return null;
  return (
    <ul className="list-disc pl-5 text-amber-600 text-xs space-y-0.5">
      {summary.warnings.map((w, i) => (
        <li key={i}>{w}</li>
      ))}
    </ul>
  );
}

function ScriptTable({ summary }: { summary: JobSummary }) {
  if (!summary?.scripts?.length) return null;
  return (
    <table className="w-full text-xs mt-2">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="py-1">스크립트</th>
          <th className="py-1">결과</th>
        </tr>
      </thead>
      <tbody>
        {summary.scripts.map((s) => (
          <tr key={s.name} className="border-t border-border/50">
            <td className="py-1">{s.name}</td>
            <td className="py-1">{s.ok ? '✓ OK' : `✗ 실패(${s.exit_code})`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

> `sonner`(toast)·`Button`은 기존 컴포넌트 사용처(`new-company-form.tsx`)와 동일. import 경로 다르면 그쪽 기준으로 맞출 것.

- [ ] **Step 4: 타입 체크 + lint + format**

Run: `npm run typecheck && npm run lint && npm run format:check`
Expected: PASS (필요 시 `npm run format`).

- [ ] **Step 5: Commit**

```bash
git add app/management/upload/page.tsx components/management/upload/upload-form.tsx components/management/management-tabs.tsx
git commit -m "feat(ui): 경영관리 자료 업로드 페이지 + 폼 + 탭"
```

---

## Task 13: 문서 갱신 (같은 작업 묶음)

**Files:**
- Modify: `AGENTS.md`
- Modify: `Architecture.md`
- Create: 메모리 `project_management_excel_upload_2026_06_24.md` + `MEMORY.md` 인덱스 한 줄

- [ ] **Step 1: AGENTS.md 갱신**

- 라우트 책임 표(`app/` 섹션): `/management` 행 설명에 "자료 업로드 탭(`/management/upload`, admin 전용)" 추가.
- `app/api/` 보호 라우트 목록에 `api/management/upload`, `api/management/upload/[jobId]`, `api/management/upload/[jobId]/apply` 추가.
- `scripts/` 카테고리: `sync_management_excel.py`(오케스트레이터, 유지 대상) 추가. `scripts/lib/` 공용 모듈에 `management_excel.py` 추가.
- 사외비 적재 정책 단락: `management_uploads` 작업 테이블 + `management-excel` 버킷 추가. 사외비 테이블 명단에 `management_uploads` 추가.
- `.github/workflows/` 섹션: `sync-management.yml` 언급(상세는 Architecture §10).

- [ ] **Step 2: Architecture.md 갱신**

- §5-A 경영관리 탭 구조: "자료 업로드" 탭 + 업로드→GHA dry-run/apply 흐름.
- §7 스키마: `management_uploads` 테이블(컬럼·상태 머신·RLS) + `management-excel` 버킷.
- §8 데이터 흐름: 엑셀 업로드 경로(웹→Storage→GHA→DB→캐시) 추가.
- §10 워크플로 목록: `sync-management.yml`(workflow_dispatch) 추가.
- §11 보안: 사외비 테이블/버킷 한 줄.

- [ ] **Step 3: 메모리 작성**

`memory/project_management_excel_upload_2026_06_24.md` (frontmatter type: project). 내용: 기능 요약, 흐름(업로드→dry-run→확인→apply), 핵심 파일, 시간감(엔드투엔드 6~10분), 오픈이슈 결정(mismatch 경고만/revalidate 일괄), `[[project_pnl_dimension_change_resync]]` 링크(차원 변경 시 delete+resync는 이 업로드로 해결 안 됨 주의).
`MEMORY.md`에 인덱스 한 줄 추가.

- [ ] **Step 4: pre-commit hook 통과 확인 + Commit**

```bash
git add AGENTS.md Architecture.md
git commit -m "docs: 경영관리 엑셀 업로드 기능 반영 (AGENTS/Architecture)"
```

> `.githooks/pre-commit`이 AGENTS.md 동반 수정을 강제. 누락 경고 시 해당 항목 보강. (메모리 파일은 git 추적 외 — 별도.)

---

## Task 14: 통합 검증

- [ ] **Step 1: 전체 정적 검사**

Run: `npm run check-all`
Expected: lint + format:check + typecheck + test 모두 PASS.

- [ ] **Step 2: Python 검증**

Run:
```bash
scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_management_excel.py scripts/lib/test_sync_management.py -v
scripts/venv/Scripts/python.exe -m py_compile scripts/sync_management_excel.py scripts/lib/management_excel.py
```
Expected: 테스트 PASS, 컴파일 오류 없음.

- [ ] **Step 3: 워크플로 실환경 dry-run (선택, GHA Secrets 필요)**

먼저 작은 작업행을 수동 생성하거나, UI로 업로드 후 자동 트리거된 run을 관찰:
```bash
gh run list --workflow=sync-management.yml
gh run watch <run-id> --exit-status
gh run view <run-id> --log
```
Expected: dry-run run 성공, `management_uploads` 해당 행 status=`dry_run_ok` + summary 기록(금액 없음).

- [ ] **Step 4: UI 골든 패스 (npm run dev + admin 로그인)**

`npm run dev` → admin 로그인 → `/management/upload` → `.xlsx` 업로드 → "업로드+검증" → 폴링으로 dry-run 요약 표시 확인 → "적재 확정" → applied 확인.
> Playwright 검증 시 사외비 규칙 준수: 금액 셀 미접근, 라벨/구조/상태 텍스트만 `evaluate`. dotenv로 ADMIN 자격증명 환경 로드(stdout 비노출). dev 재시작/`.next` 삭제로 fresh 확인.

- [ ] **Step 5: 콘솔/네트워크 에러 점검**

dev 브라우저 콘솔·네트워크 무에러 확인. 비-admin 계정으로 `/management/upload` 접근 시 `/`로 redirect되는지(proxy ADMIN_ONLY_PATHS) 확인.

- [ ] **Step 6: 최종 상태 보고**

check-all 결과, pytest 결과, (가능 시) GHA dry-run 결과, UI 골든패스 결과를 요약 보고.

---

## Self-Review 메모

- **Spec 커버리지**: §3 흐름(Task 5/6/8/9/10), §4 데이터모델(Task 1/2), §5 스크립트(Task 3/4/5), §6 워크플로(Task 6), §7 API(Task 8/9/10), §8 UI(Task 12), §9 권한(Task 8/9/10/11), §10 문서(Task 13). 모두 매핑됨.
- **오픈이슈**: mismatch 경고만(apply API가 status만 검사, mismatch 미차단) / revalidate 일괄(오케스트레이터 `revalidate_for_tables(MANAGEMENT_TABLES)` 1회) — 반영됨.
- **타입 일관성**: `UploadStatus`(스키마)·status CHECK(마이그레이션)·`TERMINAL`/`running` 문자열 동일 7개 값. `confidentialDb.from('management_uploads')`는 Task 2에서 union 등록 후 사용. `dispatchWorkflow(workflow, inputs)` 시그니처 Task 7 정의 = Task 8/10 호출 일치.
