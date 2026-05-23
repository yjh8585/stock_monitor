"""WriteSession 자동 검증 — mock 기반 unittest.

실행:
  scripts/venv/Scripts/python.exe scripts/lib/test_db_writesession.py

postgrest client와 revalidate_for_tables를 mock해 실제 DB / HTTP 호출 없이
WriteSession의 모든 의도된 동작을 검증한다.
"""
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# scripts/ 디렉터리를 import path에 추가 (lib.db, lib.revalidate import 가능하도록)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# get_client()는 SUPABASE_URL / SERVICE_ROLE_KEY env가 필요해서, env가 없으면 import 시점에 죽지는
# 않지만 호출 시 KeyError. 모든 테스트에서 patch로 우회한다.
os.environ.setdefault('SUPABASE_URL', 'http://localhost:54321')
os.environ.setdefault('SUPABASE_SERVICE_ROLE_KEY', 'test-key')

from lib import db as db_module  # noqa: E402
from lib.db import WriteSession, _TrackedBuilder, _MUTATING_METHODS  # noqa: E402


def _make_mock_postgrest_client():
  """postgrest SyncPostgrestClient를 흉내내는 mock. table(name)에서 mutating chain 호출 가능."""
  client = MagicMock(name='postgrest_client')
  # client.table(name) → builder. builder.update/upsert/delete/insert → 새 builder. .execute() → result.
  client.table.return_value = MagicMock(name='request_builder')
  return client


class WriteSessionTests(unittest.TestCase):
  """디자인에서 합의한 모든 동작을 검증한다."""

  def setUp(self) -> None:
    # get_client() 호출이 진짜 HTTP를 만지지 않도록 매 테스트마다 mock 주입.
    self._mock_client = _make_mock_postgrest_client()
    self._get_client_patcher = patch.object(db_module, 'get_client', return_value=self._mock_client)
    self._get_client_patcher.start()
    # 캐시 무효화도 mock — 실제 /api/revalidate를 부르지 않고 호출 인자만 본다.
    self._revalidate_mock = MagicMock(return_value=True)
    self._revalidate_patcher = patch('lib.revalidate.revalidate_for_tables', self._revalidate_mock)
    self._revalidate_patcher.start()

  def tearDown(self) -> None:
    self._get_client_patcher.stop()
    self._revalidate_patcher.stop()

  # ----- 기본 동작 -----

  def test_update_marks_table_as_touched(self) -> None:
    """update 호출 → _touched에 테이블명 추가, __exit__에서 revalidate."""
    with WriteSession() as w:
      w.table('companies').update({'name': 'X'}).eq('id', 'abc').execute()
    self._revalidate_mock.assert_called_once_with(['companies'])

  def test_upsert_marks_table_as_touched(self) -> None:
    with WriteSession() as w:
      w.table('financials').upsert([{'id': 1}], on_conflict='id').execute()
    self._revalidate_mock.assert_called_once_with(['financials'])

  def test_delete_marks_table_as_touched(self) -> None:
    with WriteSession() as w:
      w.table('news').delete().eq('id', 'x').execute()
    self._revalidate_mock.assert_called_once_with(['news'])

  def test_insert_marks_table_as_touched(self) -> None:
    with WriteSession() as w:
      w.table('posts').insert({'title': 'hi'}).execute()
    self._revalidate_mock.assert_called_once_with(['posts'])

  # ----- select는 무시 -----

  def test_select_does_not_mark_table(self) -> None:
    """select는 read-only — _touched에 들어가면 안 된다."""
    with WriteSession() as w:
      w.table('companies').select('id').eq('status', 'active').execute()
    self._revalidate_mock.assert_not_called()

  def test_select_then_update_in_same_session_only_marks_update_table(self) -> None:
    """select와 update를 한 세션에 섞어 써도 select 테이블은 추적 안 됨."""
    with WriteSession() as w:
      w.table('companies').select('id').execute()  # read-only — 무시
      w.table('financials').update({'rev': 100}).eq('id', 1).execute()
    self._revalidate_mock.assert_called_once_with(['financials'])

  # ----- 다중 mutating은 1회 revalidate로 합쳐짐 -----

  def test_multiple_mutations_call_revalidate_once_with_sorted_tables(self) -> None:
    """한 세션에서 update/upsert/delete가 여러 번 일어나도 __exit__에서 1번만 호출.
    누적된 테이블 집합은 정렬되어 전달된다 (deterministic 로그)."""
    with WriteSession() as w:
      w.table('news').delete().eq('id', 1).execute()
      w.table('companies').update({'name': 'X'}).eq('id', 1).execute()
      w.table('financials').upsert([{'x': 1}], on_conflict='x').execute()
    self._revalidate_mock.assert_called_once_with(['companies', 'financials', 'news'])

  def test_same_table_mutated_twice_counted_once(self) -> None:
    """같은 테이블을 두 번 mutate해도 _touched는 set이라 1개만 들어간다."""
    with WriteSession() as w:
      w.table('companies').update({'name': 'A'}).eq('id', 1).execute()
      w.table('companies').update({'name': 'B'}).eq('id', 2).execute()
    self._revalidate_mock.assert_called_once_with(['companies'])

  # ----- 예외 시 동작 (안전 우선) -----

  def test_exception_in_block_still_triggers_revalidate_for_already_touched(self) -> None:
    """블록 안에서 예외가 나도 그 전에 누적된 테이블은 revalidate해야 한다.
    postgrest는 트랜잭션이 아니라 이미 commit된 변경이 있을 수 있으므로."""
    with self.assertRaises(ValueError):
      with WriteSession() as w:
        w.table('companies').update({'name': 'X'}).eq('id', 1).execute()
        raise ValueError('boom')
    # 예외 발생해도 누적분은 revalidate
    self._revalidate_mock.assert_called_once_with(['companies'])

  def test_exception_with_nothing_touched_does_not_call_revalidate(self) -> None:
    """아무것도 안 건드린 채 예외가 나면 revalidate 호출도 없다."""
    with self.assertRaises(RuntimeError):
      with WriteSession():
        raise RuntimeError('early')
    self._revalidate_mock.assert_not_called()

  def test_revalidate_failure_is_swallowed_and_does_not_break_caller(self) -> None:
    """revalidate 자체가 실패해도 silent fail — 호출자에게 전파되지 않음."""
    self._revalidate_mock.side_effect = RuntimeError('network down')
    # 예외 안 던져져야 한다 (silent fail).
    with WriteSession() as w:
      w.table('companies').update({'name': 'X'}).eq('id', 1).execute()
    self._revalidate_mock.assert_called_once()

  # ----- 세션 외부 호출 금지 -----

  def test_table_outside_with_block_raises(self) -> None:
    """WriteSession을 with 없이 쓰면 RuntimeError."""
    w = WriteSession()
    with self.assertRaises(RuntimeError):
      w.table('companies')

  # ----- 누적 시점 (디자인 (C): 메서드 호출 시 즉시) -----

  def test_touched_is_recorded_at_method_call_not_at_execute(self) -> None:
    """.update() 호출 시점에 즉시 _touched에 추가 — .execute() 호출 여부와 무관."""
    w = WriteSession()
    with w:
      # .execute()를 일부러 안 부른다 (실제로는 의도된 패턴 아니지만 디자인 검증용)
      _ = w.table('companies').update({'x': 1}).eq('id', 1)
      # 이 시점에 이미 'companies'가 _touched에 들어가 있어야 한다
      self.assertIn('companies', w._touched)
    self._revalidate_mock.assert_called_once_with(['companies'])

  def test_mutating_method_constant_matches_design(self) -> None:
    """디자인에서 추적 대상으로 합의한 메서드 4종이 _MUTATING_METHODS와 일치."""
    self.assertEqual(set(_MUTATING_METHODS), {'update', 'upsert', 'delete', 'insert'})


class TrackedBuilderTests(unittest.TestCase):
  """proxy 객체 _TrackedBuilder의 메서드 가로채기 검증."""

  def test_non_mutating_attributes_passthrough(self) -> None:
    """eq/gt/limit 같은 비-mutating 속성은 그대로 inner builder로 흘려보낸다."""
    touched: set[str] = set()
    inner = MagicMock(name='inner_builder')
    proxy = _TrackedBuilder(inner, 'companies', touched)

    # 비-mutating 속성 접근
    _ = proxy.eq('id', 1)
    inner.eq.assert_called_once_with('id', 1)
    self.assertEqual(touched, set())  # 추적 안 됨

  def test_mutating_method_marks_touched_then_calls_inner(self) -> None:
    """update 호출 시 _touched.add → inner.update 호출."""
    touched: set[str] = set()
    inner = MagicMock(name='inner_builder')
    proxy = _TrackedBuilder(inner, 'companies', touched)

    proxy.update({'name': 'X'})
    self.assertEqual(touched, {'companies'})
    inner.update.assert_called_once_with({'name': 'X'})


if __name__ == '__main__':
  unittest.main(verbosity=2)
