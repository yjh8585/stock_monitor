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

MANAGEMENT_TABLES = [
  'pnl_entries', 'pnl_cost_structure', 'pnl_fixed_variable', 'pnl_plan',
  'inventory_entries', 'personnel_entries', 'finance_entries', 'loan_entries',
]

OUTPUT_TAIL = 2000


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
        break

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
    revalidate_for_tables(MANAGEMENT_TABLES)
    _set_status(args.job_id, status='applied', summary=summary, error_msg=None)
    logger.success('적재 완료 + 캐시 무효화')
  return 0


if __name__ == '__main__':
  sys.exit(main())
