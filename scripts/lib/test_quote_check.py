"""lib/quote_check.py 시험 — 자가 시험(MUST_HIT·MUST_MISS·DATE_HIT·DATE_MISS) + 실물 표 행 대조.

실행:
  PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_quote_check.py -q
"""
import pathlib
import sys
import unittest

_SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_SCRIPTS))

from lib import quote_check as qc  # noqa: E402


class QuoteCheckTest(unittest.TestCase):
  def test_self(self):
    self.assertEqual(qc.self_test(), [])

  def test_real_rows(self):
    src = 'EBIT-adjusted $14.5 billion - $15.5 billion $14.0 billion - $16.0 billion'
    class R:  # noqa: E306
      quote, value, low, high, value_text = 'EBIT-adjusted | $14.5 billion - $15.5 billion | $14.0 billion - $16.0 billion', None, 14.5, 15.5, None
    self.assertEqual(qc.check_row(R, src), (True, 'ok'))
    R.low = 14.0 + 0.1
    self.assertFalse(qc.check_row(R, src)[0])


if __name__ == '__main__':
  unittest.main()
