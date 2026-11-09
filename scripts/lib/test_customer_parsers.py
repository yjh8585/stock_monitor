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

  def test_workflow_tickers_match_registry(self):
    """최종 검토 P13 — 워크플로 matrix·수동 실행 options(yml 은 읽기만)가 파서 등록부 ∪ IR 목록 어댑터와 같다.
    파서·어댑터를 더하고 yml 을 안 고치면 그 회사가 정기 실행에서 조용히 빠진다(반대면 빈 job).
    yml 파서 의존성(PyYAML)을 늘리지 않으려고 두 목록 블록만 정규식으로 읽는다."""
    import re
    from lib import ir_lists
    yml = (pathlib.Path(__file__).resolve().parents[2] / '.github' / 'workflows' / 'collect-customer-docs.yml'
           ).read_text(encoding='utf-8')

    def block(key: str) -> list[str]:
      m = re.search(rf'^\s*{key}:\s*\n?\s*\[(.*?)\]', yml, re.S | re.M)
      self.assertIsNotNone(m, f'yml 에서 {key} 목록을 못 찾음')
      return re.findall(r"'([^']*)'", m.group(1))

    want = customer_parsers.parser_tickers() | set(ir_lists.IR_LISTS)
    matrix, options = block('ticker'), block('options')
    self.assertEqual(len(matrix), len(set(matrix)), 'matrix 중복')
    self.assertEqual(set(matrix), want)
    self.assertEqual(options[0], '')   # 비우면 전체
    self.assertEqual(set(options[1:]), want)


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
