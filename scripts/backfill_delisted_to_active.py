"""
status='hidden'(과거 'delisted')으로 잘못 분류된 회사들을 status='active'로 일괄 복원한다.

배경: 과거 collect_dart_domestic.py가 DART 매칭 실패를 status='delisted'로 저장하던
버그가 있었음(이미 수정). status 값은 'delisted' → 'hidden'으로 개명됨.
analyze_delisted_candidates.py 결과를 사람이 검토한 뒤,
복원할 ticker 목록을 JSON으로 받아 일괄 복원한다.

가드:
  - 입력에 있지만 DB에 없는 ticker → 제외
  - 이미 status != 'hidden' 인 회사 → 제외
  - merged_into_company_id IS NOT NULL → 강제 제외 (중복 노출 방지)

dry-run 포함 모든 실행에서 _backfill_backup_YYYYMMDD_HHMMSS.json 백업을 남긴다.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
load_dotenv(ROOT.parent / '.env.local')

from lib.db import get_client

# postgrest URL 길이 한계 회피용 batch select 크기
BATCH_SIZE = 200
DEFAULT_INPUT_PATH = ROOT / '_delisted_restore.json'
# 복원 후 companies에 기록할 필드 (status는 active로, 나머지는 reset)
RESTORE_PAYLOAD = {
  'status': 'active',
  'dart_collection_status': None,
  'last_collect_error': None,
  'retry_after': None,
}
# 백업에 보존할 회사 필드
SNAPSHOT_FIELDS = [
  'id', 'ticker', 'name_kr', 'status',
  'dart_collection_status', 'last_collect_error',
  'retry_after', 'merged_into_company_id',
]


def _parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description='delisted 회사 일괄 active 복원')
  parser.add_argument(
    '--json-path',
    type=Path,
    default=DEFAULT_INPUT_PATH,
    help=f'복원 대상 입력 JSON (기본: {DEFAULT_INPUT_PATH})',
  )
  parser.add_argument(
    '--dry-run',
    action='store_true',
    help='DB 변경 없이 복원 계획만 출력 (기본 False)',
  )
  return parser.parse_args()


def _load_input(path: Path) -> tuple[list[str], str]:
  """입력 JSON에서 tickers/reason 추출. 누락 시 친절한 에러."""
  if not path.exists():
    logger.error(f'입력 JSON 파일이 없습니다: {path}')
    logger.error(
      '형식 예: {"tickers": ["047060", "..."], "reason": "복원 사유"}'
    )
    sys.exit(1)
  try:
    raw = json.loads(path.read_text(encoding='utf-8'))
  except json.JSONDecodeError as e:
    logger.error(f'JSON 파싱 실패 ({path}): {e}')
    sys.exit(1)
  tickers = raw.get('tickers') or []
  reason = (raw.get('reason') or '').strip()
  if not isinstance(tickers, list):
    logger.error('tickers 필드는 list여야 합니다')
    sys.exit(1)
  # 빈 문자열/None 제거 + dedup (순서 보존)
  seen: set[str] = set()
  cleaned: list[str] = []
  for t in tickers:
    if not isinstance(t, str):
      continue
    t = t.strip()
    if not t or t in seen:
      continue
    seen.add(t)
    cleaned.append(t)
  return cleaned, reason


def _fetch_companies(tickers: list[str]) -> list[dict]:
  """tickers에 해당하는 companies 현재 상태를 batch SELECT."""
  client = get_client()
  rows: list[dict] = []
  cols = ','.join(SNAPSHOT_FIELDS)
  for i in range(0, len(tickers), BATCH_SIZE):
    chunk = tickers[i:i + BATCH_SIZE]
    try:
      res = client.table('companies').select(cols).in_('ticker', chunk).execute()
      rows.extend(res.data or [])
    except Exception as e:
      logger.error(f'companies 조회 실패 (chunk {i}~{i + BATCH_SIZE}): {e}')
      sys.exit(1)
  return rows


def _classify(
  input_tickers: list[str],
  companies: list[dict],
) -> tuple[list[dict], list[str], list[dict], list[dict]]:
  """복원 대상 / 제외 사유별 분류."""
  by_ticker = {c['ticker']: c for c in companies}
  found_tickers = set(by_ticker.keys())
  not_found = [t for t in input_tickers if t not in found_tickers]

  already_active: list[dict] = []
  merged: list[dict] = []
  to_restore: list[dict] = []
  for t in input_tickers:
    c = by_ticker.get(t)
    if c is None:
      continue
    if c.get('merged_into_company_id'):
      merged.append(c)
      continue
    if c.get('status') != 'hidden':
      already_active.append(c)
      continue
    to_restore.append(c)
  return to_restore, not_found, already_active, merged


def _write_backup(
  reason: str,
  input_tickers: list[str],
  not_found: list[str],
  already_active: list[dict],
  merged: list[dict],
  to_restore: list[dict],
  dry_run: bool,
  applied: bool,
) -> Path:
  """백업 JSON을 timestamp 파일에 기록하고 경로 반환."""
  ts = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
  out_path = ROOT / f'_backfill_backup_{ts}.json'
  payload = {
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'reason': reason,
    'input_tickers': input_tickers,
    'excluded_not_found': not_found,
    'excluded_already_active': already_active,
    'excluded_merged': merged,
    'restored_before': to_restore,
    'dry_run': dry_run,
    'applied': applied,
  }
  out_path.write_text(
    json.dumps(payload, ensure_ascii=False, indent=2),
    encoding='utf-8',
  )
  return out_path


def _apply_restore(restore_tickers: list[str]) -> int:
  """status='active' 일괄 업데이트. 반환: 갱신 row 수."""
  client = get_client()
  updated = 0
  for i in range(0, len(restore_tickers), BATCH_SIZE):
    chunk = restore_tickers[i:i + BATCH_SIZE]
    try:
      res = (
        client.table('companies')
        .update(RESTORE_PAYLOAD)
        .in_('ticker', chunk)
        .execute()
      )
      updated += len(res.data or [])
    except Exception as e:
      logger.error(f'update 실패 (chunk {i}~{i + BATCH_SIZE}): {e}')
      raise
  return updated


def _summarize(
  input_tickers: list[str],
  companies: list[dict],
  not_found: list[str],
  already_active: list[dict],
  merged: list[dict],
  to_restore: list[dict],
  applied_count: int | None,
  backup_path: Path,
  dry_run: bool,
) -> None:
  """콘솔 요약 출력."""
  logger.info('=' * 60)
  logger.info(f'입력 ticker 수      : {len(input_tickers)}')
  logger.info(f'DB에 있는 수        : {len(companies)}')
  logger.info(f'제외 (not_found)    : {len(not_found)}')
  logger.info(f'제외 (already_active): {len(already_active)}')
  logger.info(f'제외 (merged)       : {len(merged)}')
  logger.info(f'복원 대상           : {len(to_restore)}')
  if dry_run:
    logger.info('dry-run 모드 — DB 변경 없음')
  else:
    logger.info(f'실제 복원된 수      : {applied_count}')
  logger.info(f'백업 파일           : {backup_path}')
  logger.info('=' * 60)


def main() -> None:
  if 'SUPABASE_URL' not in os.environ or 'SUPABASE_SERVICE_ROLE_KEY' not in os.environ:
    logger.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수 없음')
    sys.exit(1)

  args = _parse_args()
  input_tickers, reason = _load_input(args.json_path)
  if not input_tickers:
    logger.warning('입력 tickers가 비어 있습니다 — 종료')
    sys.exit(0)

  logger.info(f'입력 JSON: {args.json_path} (tickers={len(input_tickers)})')
  if reason:
    logger.info(f'사유: {reason}')

  companies = _fetch_companies(input_tickers)
  to_restore, not_found, already_active, merged = _classify(input_tickers, companies)

  if not_found:
    logger.warning(f'DB에 없는 ticker {len(not_found)}개: {not_found[:10]}...')
  if already_active:
    sample = [(c['ticker'], c.get('status')) for c in already_active[:10]]
    logger.warning(f'이미 active 등 {len(already_active)}개 제외: {sample}...')
  if merged:
    sample = [c['ticker'] for c in merged[:10]]
    logger.warning(f'merged 회사 {len(merged)}개 강제 제외: {sample}...')

  if not to_restore:
    logger.warning('복원 대상이 없습니다')
    backup_path = _write_backup(
      reason, input_tickers, not_found, already_active, merged,
      to_restore, args.dry_run, applied=False,
    )
    _summarize(
      input_tickers, companies, not_found, already_active, merged,
      to_restore, applied_count=0, backup_path=backup_path, dry_run=args.dry_run,
    )
    return

  logger.info(f'복원 대상 ticker: {[c["ticker"] for c in to_restore]}')

  # 백업은 dry-run에서도 항상 먼저 기록
  backup_path = _write_backup(
    reason, input_tickers, not_found, already_active, merged,
    to_restore, dry_run=args.dry_run, applied=False,
  )

  if args.dry_run:
    logger.info(f'[dry-run] 적용될 페이로드: {RESTORE_PAYLOAD}')
    _summarize(
      input_tickers, companies, not_found, already_active, merged,
      to_restore, applied_count=None, backup_path=backup_path, dry_run=True,
    )
    return

  restore_tickers = [c['ticker'] for c in to_restore]
  updated = _apply_restore(restore_tickers)

  # 실제 모드에서는 applied=True로 백업 갱신
  backup_path = _write_backup(
    reason, input_tickers, not_found, already_active, merged,
    to_restore, dry_run=False, applied=True,
  )
  _summarize(
    input_tickers, companies, not_found, already_active, merged,
    to_restore, applied_count=updated, backup_path=backup_path, dry_run=False,
  )


if __name__ == '__main__':
  main()
