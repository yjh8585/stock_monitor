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


# ---------------------------------------------------------------------------
# WriteSession — postgrest 직접 호출의 캐시 무효화 hook을 자동화하는 context manager
# ---------------------------------------------------------------------------
# upsert_rows() 외의 직접 호출 패턴 (client.table().update/upsert/delete/insert)을 쓸 때
# 스크립트 작성자가 마지막에 revalidate_for_tables(...)을 손으로 적지 않아도 되게 한다.
#
# 사용:
#   with WriteSession() as w:
#       w.table('companies').update({'business_summary': '...'}).eq('id', cid).execute()
#       w.table('financials').upsert(rows, on_conflict='company_id,fiscal_year').execute()
#   # __exit__에서 revalidate_for_tables(['companies', 'financials']) 자동 1회 호출
#
# 정책:
#   - update / upsert / delete / insert 메서드가 호출되는 순간 _touched.add(table)
#   - select는 추적하지 않음 (read-only)
#   - __exit__에서 누적분을 한 번에 revalidate. 예외가 발생해도 누적분은 무효화한다
#     (postgrest는 트랜잭션이 아니라 부분 commit이 일어날 수 있으므로 안전 우선).
#   - revalidate 자체는 silent fail — 수집 스크립트의 종료 코드에 영향 주지 않음.


_MUTATING_METHODS = ('update', 'upsert', 'delete', 'insert')


class _TrackedBuilder:
  """postgrest RequestBuilder를 감싼 proxy. mutating 메서드 호출 시 테이블명 누적."""

  def __init__(self, inner, table_name: str, touched: set[str]):
    self._inner = inner
    self._table = table_name
    self._touched = touched

  def __getattr__(self, name: str):
    attr = getattr(self._inner, name)
    if name in _MUTATING_METHODS and callable(attr):
      def wrapper(*args, **kwargs):
        self._touched.add(self._table)
        # update/upsert/delete/insert는 새 builder를 돌려준다 — 그 뒤의
        # .eq/.gt/.execute 등은 그대로 사용 가능 (이미 mutating 의도 기록됨).
        return attr(*args, **kwargs)
      return wrapper
    return attr


class WriteSession:
  """캐시 무효화를 자동 처리하는 mutating 작업 단위."""

  def __init__(self):
    self._touched: set[str] = set()
    self._client = None

  def __enter__(self) -> 'WriteSession':
    self._client = get_client()
    return self

  def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
    # 예외 발생 여부와 무관하게 누적분 revalidate (부분 commit 가능성 — 안전 우선).
    if self._touched:
      try:
        from lib.revalidate import revalidate_for_tables
        revalidate_for_tables(sorted(self._touched))
      except Exception as e:
        logger.debug(f"  revalidate skip: {e}")
    # 예외는 호출자에게 그대로 전파.
    return False

  def table(self, name: str) -> _TrackedBuilder:
    """postgrest client.table(name)을 감싼 추적 가능한 builder를 반환한다."""
    if self._client is None:
      raise RuntimeError("WriteSession은 'with' 블록 안에서만 사용한다")
    return _TrackedBuilder(self._client.table(name), name, self._touched)
