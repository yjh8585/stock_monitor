"""collect_shfe 의 「끊긴 날 다시 열기」 회귀 검증 — 네트워크·DB 없이 unittest.

실행:
  scripts/venv/Scripts/python.exe scripts/lib/test_shfe.py

2026-11-10·11-12 GHA 에서 SHFE 가 중간부터 연결을 끊어(`Connection reset by peer`) 하루 이틀치를
못 받고 exit 1 로 끝났다. 쉬었다 다시 열면 받히는 일시 차단이라 두 번째 시도를 넣었다.
- 첫 시도에 끊긴 날이 두 번째에 받히면 성공(exit 없음)이고 그날도 적재돼야 한다
- 두 번째에도 끊기면 여전히 exit 1 이어야 한다(진짜 차단을 놓치지 않게)
"""
import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

_spec = importlib.util.spec_from_file_location('collect_shfe', SCRIPTS_DIR / 'collect_shfe.py')
col = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(col)


class RetryFailedDaysTest(unittest.TestCase):
  def _run(self, fails_per_day: int):
    """첫 번째 대상일만 fails_per_day 번 끊기고 나머지는 정상인 상황으로 collect(0) 을 돌린다."""
    calls: dict[str, int] = {}
    first: list[str] = []
    written: list[dict] = []

    def fake_fetch(ymd: str):
      if not first:
        first.append(ymd)
      calls[ymd] = calls.get(ymd, 0) + 1
      if ymd == first[0] and calls[ymd] <= fails_per_day:
        raise ConnectionError('Connection reset by peer')
      return col._SAMPLE

    with mock.patch.object(col, '_fetchDay', fake_fetch), \
         mock.patch.object(col, 'with_retry', lambda fn, *a, **k: fn(*a)), \
         mock.patch.object(col, 'upsert_rows', lambda _t, rows, _c: written.extend(rows) or len(rows)), \
         mock.patch.object(col.time, 'sleep', lambda _s: None):
      col.collect(0)
    return first[0], calls, written

  def test_reset_once_then_recovers(self):
    ymd, calls, written = self._run(fails_per_day=1)
    self.assertEqual(calls[ymd], 2, '끊긴 날을 한 번 더 열어야 한다')
    iso = f'{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}'
    self.assertEqual({r['series_code'] for r in written if r['trade_date'] == iso}, {'HRC_CN', 'ALU_CN'})

  def test_reset_twice_still_fails(self):
    with self.assertRaises(SystemExit) as cm:
      self._run(fails_per_day=2)
    self.assertEqual(cm.exception.code, 1)


if __name__ == '__main__':
  unittest.main()
