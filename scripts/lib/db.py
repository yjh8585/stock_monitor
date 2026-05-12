"""
Supabase PostgREST 클라이언트 싱글톤 및 공통 DB 유틸리티.
supabase SDK 대신 postgrest-py를 직접 사용해 pyiceberg 의존성을 제거.
환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""
import os
from functools import lru_cache
from typing import Any

from loguru import logger
from postgrest import SyncPostgrestClient


@lru_cache(maxsize=1)
def get_client() -> SyncPostgrestClient:
  """Supabase PostgREST 서비스 역할 클라이언트를 반환한다 (싱글톤)."""
  url = os.environ['SUPABASE_URL']
  key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
  postgrest_url = f"{url.rstrip('/')}/rest/v1"
  headers = {
    'apikey': key,
    'Authorization': f'Bearer {key}',
  }
  return SyncPostgrestClient(postgrest_url, headers=headers)


def upsert_rows(table: str, rows: list[dict[str, Any]], conflict_cols: str) -> int:
  """
  지정 테이블에 행을 upsert한다.

  Args:
    table: 테이블 이름
    rows: upsert할 행 목록
    conflict_cols: 충돌 기준 컬럼 (쉼표 구분)

  Returns:
    처리된 행 수
  """
  if not rows:
    return 0

  client = get_client()
  BATCH_SIZE = 500
  total = 0

  for i in range(0, len(rows), BATCH_SIZE):
    batch = rows[i:i + BATCH_SIZE]
    try:
      client.table(table).upsert(batch, on_conflict=conflict_cols).execute()
      total += len(batch)
      logger.debug(f"{table}: {total}/{len(rows)}행 upsert 완료")
    except Exception as e:
      logger.error(f"{table} upsert 실패 (배치 {i}~{i+BATCH_SIZE}): {e}")
      raise

  # Next.js 캐시 자동 무효화 (영향받는 페이지)
  try:
    from lib.revalidate import revalidate_for_tables
    revalidate_for_tables([table])
  except Exception as e:
    logger.debug(f"  revalidate skip: {e}")

  return total


def test_connection() -> bool:
  """Supabase 연결 테스트. 성공 시 True 반환."""
  try:
    client = get_client()
    client.table('companies').select('id').limit(1).execute()
    logger.info("Supabase 연결 성공")
    return True
  except Exception as e:
    logger.error(f"Supabase 연결 실패: {e}")
    return False
