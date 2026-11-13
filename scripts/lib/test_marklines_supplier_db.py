"""MarkLines 서플라이어 DB 로그인 풀림 판정 · 수집기 이어받기 시험 — 실제 네트워크·실명 없음(공개 레포)."""
import pytest
import requests

import collect_sourcing_suppliers as css
import lib.retry as retry
from lib.marklines_supplier_db import NotLoggedIn, SupplierDb


class _FakeResp:
  def __init__(self, status: int):
    self.status_code = status

  def raise_for_status(self):
    if self.status_code >= 400:
      raise requests.HTTPError(f'{self.status_code}', response=self)


class _FakeSession:
  def __init__(self, status: int):
    self.status = status
    self.calls = 0

  def get(self, *a, **k):
    self.calls += 1
    return _FakeResp(self.status)


def _db(status: int) -> tuple[SupplierDb, _FakeSession]:
  db = SupplierDb('PLATFORM_SESSION=x')
  db._s = _FakeSession(status)
  return db, db._s


@pytest.mark.parametrize('status', [401, 403])
def test_401_403은_재시도없이_NotLoggedIn(status):
  db, s = _db(status)
  with pytest.raises(NotLoggedIn):
    db._get('https://example.invalid', {})
  assert s.calls == 1


def test_503은_로그인풀림이_아니라_재시도한다(monkeypatch):
  monkeypatch.setattr(retry.time, 'sleep', lambda *_: None)
  db, s = _db(503)
  with pytest.raises(requests.HTTPError):
    db._get('https://example.invalid', {})
  assert s.calls == 3


def test_이어받기는_이미_받은_코드를_건너뛴다():
  hits = {'A': [(1, 2)], 'B': [(1, None)], 'C': [(3, 4)]}
  rows = [{'ml_rand_code': 'B'}]
  assert css.pending_codes(hits, rows) == ['A', 'C']


def test_검색결과_합치기는_짝을_한번만():
  a = {'A': [(1, 2)], 'B': [(1, None)]}
  b = {'A': [(1, 2), (3, None)], 'C': [(5, 6)]}
  assert css.merge_hits(a, b) == {'A': [(1, 2), (3, None)], 'B': [(1, None)], 'C': [(5, 6)]}


def test_저장한_상태를_다시_읽으면_짝이_튜플로_돌아온다(tmp_path, monkeypatch):
  monkeypatch.setattr(css, 'STATE_DIR', tmp_path)
  path = css.save_state('partial', [{'ml_rand_code': 'A'}], {'A': [(1, None)]})
  rows, hits = css.load_state(str(path))
  assert rows == [{'ml_rand_code': 'A'}]
  assert hits == {'A': [(1, None)]}
  assert ':' not in path.name
