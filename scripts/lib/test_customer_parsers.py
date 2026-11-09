"""회사별 파서의 MUST_HIT·MUST_MISS 를 pytest 로도 돈다(오케스트레이터는 실행 때마다 같은 것을 먼저 돈다).
+ 파서 공통 틀(base)의 어휘·기간 형식 거르기.

실행:
  PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_customer_parsers.py -q
"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))  # scripts/
import customer_parsers  # noqa: E402
from customer_parsers import base  # noqa: E402


class ParserSelfTests(unittest.TestCase):
  def test_all(self):
    for m in customer_parsers.modules():
      with self.subTest(module=m.__name__):
        self.assertEqual(m.self_test(), [])

  def test_parser_only_tickers_registered(self):
    """collect_customer_docs.PARSER_ONLY_TICKERS(목록 수집 대상)가 실제 파서 등록부와 어긋나지 않는다."""
    if not customer_parsers.modules():
      self.skipTest('파서 0개(Task 6) — Task 7 부터 검사')
    import importlib.util
    p = pathlib.Path(__file__).resolve().parents[1] / 'collect_customer_docs.py'
    spec = importlib.util.spec_from_file_location('ccd', p)
    ccd = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ccd)
    self.assertLessEqual(set(ccd.PARSER_ONLY_TICKERS), customer_parsers.parser_tickers())


class VocabTests(unittest.TestCase):
  def test_base_self_test(self):
    self.assertEqual(base.self_test(), [])

  def test_drop_keeps_good_rows_and_reports_bad(self):
    """어긋난 행만 버리고(문서 전체 아님) 사유를 돌려준다 — 사유엔 표기만, 값은 없다."""
    good = base.VolumeRow('deliveries', 'total', 'quarter', '2026-Q3', 123456, 'd', 'q')
    bad = base.VolumeRow('deliveries', 'total', 'quarter', 'Q3 2026', 654321, 'd', 'q')
    bad_date = base.EarningsDate('2026-Q4', '2027-02-10', 'q')
    r = base.ParseResult(volume=[good, bad], dates=[bad_date], recognized=True)
    self.assertEqual(len(base.check_vocab(r)), 2)
    notes = base.drop_off_vocab(r)
    self.assertEqual(r.volume, [good])
    self.assertEqual(r.dates, [])
    self.assertEqual(len(notes), 2)
    self.assertFalse(any('654321' in n for n in notes))

  def test_metric_unit_basis_still_checked(self):
    g = base.GuidanceRow('ebitda_guess', 'X', 'FY2026', 1.0, 2.0, None, 'billion', 'gaap', 'q')
    self.assertEqual(base.check_vocab(base.ParseResult(guidance=[g])),
                     ['guidance metric ebitda_guess', 'guidance basis gaap'])

  def test_guidance_needs_a_value(self):
    g = base.GuidanceRow('revenue', 'Revenue', 'FY2026', None, None, None, 'billion', None, 'q')
    self.assertEqual(base.check_vocab(base.ParseResult(guidance=[g])), ['guidance 값 없음'])


if __name__ == '__main__':
  unittest.main()
