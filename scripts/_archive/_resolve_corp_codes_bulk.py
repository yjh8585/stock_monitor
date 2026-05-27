"""DART corp_code 일괄 자동 매핑 (data_source='dart' AND corp_code IS NULL).

collect_dart_audit의 _resolve_corp_code_impl 함수 재활용.
매칭 성공한 corp_code는 DB에 즉시 UPDATE (트리거가 customers 정규화 안 함 — corp_code만 SET).
매칭 실패는 _unmapped 리스트로 출력.
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
load_dotenv(ROOT.parent / '.env.local')

sys.path.insert(0, str(ROOT))
from lib.db import get_client  # noqa: E402
from collect_dart_audit import _get_dart, _resolve_corp_code  # noqa: E402


def main() -> int:
  dart = _get_dart()
  if dart is None:
    logger.error('DART 초기화 실패')
    return 1
  client = get_client()
  # 대상: status='active' AND data_source='dart' AND dart_corp_code IS NULL
  resp = (
    client.table('companies')
    .select('id,name_kr,ticker,dart_corp_code,dart_collection_status')
    .eq('status', 'active')
    .eq('data_source', 'dart')
    .is_('dart_corp_code', 'null')
    .execute()
  )
  rows = resp.data or []
  logger.info(f'대상 {len(rows)}개')

  matched: list[tuple[str, str, str]] = []  # (id, name_kr, corp_code)
  unmapped: list[tuple[str, str]] = []

  for i, c in enumerate(rows, 1):
    cid = c['id']
    name = c['name_kr']
    try:
      code = _resolve_corp_code(dart, name, None)
    except Exception as e:
      logger.warning(f'[{i}/{len(rows)}] {name}: 예외 {type(e).__name__}: {e}')
      unmapped.append((cid, name))
      continue
    if code:
      matched.append((cid, name, code))
      logger.info(f'[{i}/{len(rows)}] ✓ {name} → {code}')
    else:
      unmapped.append((cid, name))
      logger.debug(f'[{i}/{len(rows)}] ✗ {name}: 매칭 실패')

  # 일괄 UPDATE
  if matched:
    logger.info(f'\nDB UPDATE 시작: {len(matched)}개')
    for cid, name, code in matched:
      client.table('companies').update({'dart_corp_code': code}).eq('id', cid).execute()

  logger.info(f'\n=== 요약 ===')
  logger.info(f'  매칭 성공: {len(matched)}/{len(rows)}')
  logger.info(f'  매칭 실패: {len(unmapped)}/{len(rows)}')

  if unmapped:
    logger.warning(f'\n매칭 실패 목록 ({len(unmapped)}개):')
    for cid, name in unmapped[:50]:
      logger.warning(f'  {name}')
    if len(unmapped) > 50:
      logger.warning(f'  ... 그 외 {len(unmapped)-50}개')

  return 0


if __name__ == '__main__':
  sys.exit(main())
