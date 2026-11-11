"""lib/customer_summary_check.py 시험 — 요약 검사기(네트워크 없음).

실행:
  PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_customer_summary_check.py -q

🔴 실패 시험은 검사 한 갈래만 어기게 만들고 지적 문구로 갈래를 확인한다(다른 갈래 지적으로 통과하지 않게).
"""
import pathlib
import sys
import unittest

_SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_SCRIPTS))

from lib import customer_summary_prompt as sp  # noqa: E402
from lib.customer_summary_check import (  # noqa: E402
  check_doc, check_news, currency_problems, self_test, translationese_problems, unmatched_numbers)

SRC = ("[p.6] Revenue was $4,213 million in Q3 2026, up from $3,980 million in Q3 2025. We now expect FY2026 "
       "adjusted operating margin of 4% to 5%, down from 5% to 6%. [p.7] Regional deliveries table")


def _ok(**kw):
  base = {'lines': ['가나자동차는 2026년 조정 영업이익률 전망을 5~6%에서 4~5%로 낮췄다.',
                    '3분기 매출은 42.1억 달러였다.', '전년 같은 분기는 39.8억 달러였다.'],
          'importance': 'mid', 'importance_reason': '전망 하향',
          'evidence': [{'quote': 'We now expect FY2026 adjusted operating margin of 4% to 5%', 'page': 6}],
          'pages': [{'page': 7, 'caption': '지역별 인도 표'}], 'c_materials': []}
  base.update(kw)
  return base


class Numbers(unittest.TestCase):
  def test_rounded_number_ok(self):
    self.assertEqual(unmatched_numbers('3분기 매출은 42.1억 달러였다.', SRC), [])

  def test_wrong_number(self):
    self.assertTrue(unmatched_numbers('3분기 매출은 45억 달러였다.', SRC))

  def test_invented_percent(self):
    self.assertTrue(unmatched_numbers('매출이 5.9% 늘었다.', SRC))

  def test_range_ok(self):
    self.assertEqual(unmatched_numbers('이익률 전망을 5~6%에서 4~5%로 낮췄다.', SRC), [])

  def test_quarter_must_be_quarter_in_source(self):
    # 원문엔 Q3 만 있고 숫자 4 는 % 로만 있다 → 「4분기」는 근거 없음
    src = 'Revenue was $4,213 million in Q3 2026. Margin was 4% to 5%.'
    self.assertTrue(unmatched_numbers('4분기 매출은 42.1억 달러였다.', src))
    self.assertEqual(unmatched_numbers('3분기 매출은 42.1억 달러였다.', src), [])

  def test_quarter_word_forms(self):
    self.assertEqual(unmatched_numbers('3분기 실적', 'third-quarter results'), [])
    self.assertEqual(unmatched_numbers('3분기 실적', 'results for 3Q25'), [])
    self.assertEqual(unmatched_numbers('3분기 실적', 'three months ended September 30'), [])

  def test_year_not_in_source(self):
    src = 'We expect FY2026 revenue of $10 billion.'
    self.assertTrue(unmatched_numbers('2027년 매출 전망은 100억 달러다.', src))
    self.assertEqual(unmatched_numbers('2026년 매출 전망은 100억 달러다.', src), [])

  def test_two_digit_year_alias(self):
    self.assertEqual(unmatched_numbers('2026년 전망', 'FY26 outlook'), [])
    self.assertEqual(unmatched_numbers('2025년 3분기', "Q3'25 results"), [])

  def test_page_marker_is_not_a_number(self):
    self.assertTrue(unmatched_numbers('이익률은 7%였다.', 'Margin table [p.7] see appendix'))
    # % 문맥 검사와 겹치지 않는 표본 — 표식 제거만이 막는다
    self.assertTrue(unmatched_numbers('공장 7곳을 닫는다.', 'We will close plants. [p.7] Appendix'))

  def test_percent_needs_percent_in_source(self):
    # 원문 7 은 금액(백만)이다 — 요약 7% 의 근거가 아니다
    self.assertTrue(unmatched_numbers('이익률은 7%였다.', 'Revenue was 7 million.'))
    self.assertEqual(unmatched_numbers('이익률은 7%였다.', 'Margin was 7 percent.'), [])
    self.assertEqual(unmatched_numbers('이익률은 0.5%p 올랐다.', 'margin up 50 bps'), [])

  def test_header_multiplier_both_ways(self):
    src = '(in millions) Revenue 4,213 Fiscal year 2026'
    self.assertEqual(unmatched_numbers('2026년 매출은 42.1억 달러였다.', src), [])

  def test_every_header_multiplier(self):
    # 실물(국문 IR 발표 자료, 2026-11-12 드라이런): 첫 머리는 「천대」, 금액 표는 「십억원」 — 첫 머리만 쓰면 맞는 금액이 걸린다
    src = '(단위 : 천대, %) 현지판매 829 6.9% (단위 : 십억원) 매출액 31,617 영업이익 1,824'
    self.assertEqual(unmatched_numbers('매출은 31.6조 원, 영업이익은 1.82조 원이었다.', src), [])
    self.assertEqual(unmatched_numbers('현지판매는 82.9만 대였다.', src), [])
    self.assertTrue(unmatched_numbers('매출은 35.0조 원이었다.', src))
    src_en = '(€ million) Sales revenue 4,213 ... deliveries (in thousand units) 829'
    self.assertEqual(unmatched_numbers('매출은 42.1억 유로, 인도는 82.9만 대였다.', src_en), [])


class Currency(unittest.TestCase):
  def test_euro_on_dollar_source(self):
    p = currency_problems('3분기 매출은 42.1억 유로였다.', SRC)
    self.assertTrue(p and '통화' in p[0])

  def test_dollar_ok(self):
    self.assertEqual(currency_problems('3분기 매출은 42.1억 달러였다.', SRC), [])

  def test_won_word_not_currency(self):
    # 「원문」·「원가」의 원은 통화가 아니다
    self.assertEqual(currency_problems('3분기 원가가 늘었다고 원문은 밝혔다.', SRC), [])


class Translationese(unittest.TestCase):
  def test_extra_patterns(self):
    p = translationese_problems('관세 영향에 있어서 비용 증가가 이루어졌다.')
    self.assertTrue(any('번역투' in x and '에 있어서' in x for x in p))
    self.assertTrue(any('번역투' in x and '이루어졌다' in x for x in p))

  def test_scan_rule(self):
    p = translationese_problems('그 결과는 표에 잘 보여지고 있다.')
    self.assertTrue(any(x.startswith('번역투: 이중 피동') for x in p))

  def test_clean_line(self):
    self.assertEqual(translationese_problems('회사는 하향 이유로 미국 관세 비용을 들었다.'), [])

  def test_check_doc_reports_translationese(self):
    lines = _ok()['lines'][:2] + ['회사는 관세 영향에 있어서 비용이 늘었다고 밝혔다.']
    _, p = check_doc(_ok(lines=lines), SRC, True, 12)
    self.assertTrue(any(x.startswith('번역투') for x in p))
    self.assertFalse(any(x.startswith('숫자') for x in p))


class CheckDoc(unittest.TestCase):
  def test_good_passes(self):
    r, p = check_doc(_ok(), SRC, True, 12)
    self.assertEqual(p, [])
    self.assertIsNone(r.get('check_note'))

  def test_high_without_evidence_demoted(self):
    r, _ = check_doc(_ok(importance='high', evidence=[{'quote': '없는 문장', 'page': None}]), SRC, True, 12)
    self.assertEqual(r['importance'], 'mid')
    self.assertIn('high', r['check_note'])

  def test_high_with_evidence_kept(self):
    r, p = check_doc(_ok(importance='high'), SRC, True, 12)
    self.assertEqual((r['importance'], p), ('high', []))

  def test_evidence_not_in_source(self):
    _, p = check_doc(_ok(evidence=[{'quote': 'This sentence is invented.', 'page': 6}]), SRC, True, 12)
    self.assertTrue(any('근거' in x for x in p))

  def test_evidence_page_fixed(self):
    r, p = check_doc(_ok(evidence=[{'quote': 'Regional deliveries table', 'page': 3}]), SRC, True, 12)
    self.assertEqual((r['evidence'][0]['page'], p), (7, []))

  def test_page_out_of_range(self):
    _, p = check_doc(_ok(pages=[{'page': 40, 'caption': '표'}]), SRC, True, 12)
    self.assertTrue(any('쪽 번호' in x for x in p))

  def test_too_many_pages(self):
    pages = [{'page': n, 'caption': '표'} for n in (6, 7, 8, 9)]
    _, p = check_doc(_ok(pages=pages), SRC, True, 12)
    self.assertTrue(any('쪽 캡처' in x and '최대' in x for x in p))

  def test_pages_on_html(self):
    _, p = check_doc(_ok(evidence=[{'quote': 'Regional deliveries table', 'page': None}]), SRC, False, 0)
    self.assertEqual(len(p), 1)
    self.assertIn('PDF', p[0])

  def test_line_count(self):
    _, p = check_doc(_ok(lines=['3분기 매출은 42.1억 달러였다.']), SRC, True, 12)
    self.assertTrue(any('줄 수' in x for x in p))

  def test_line_chars(self):
    long = '3분기 매출은 42.1억 달러였다' + '고' * sp.LINE_CHARS + '.'
    _, p = check_doc(_ok(lines=_ok()['lines'][:2] + [long]), SRC, True, 12)
    self.assertTrue(any('글자' in x for x in p))
    self.assertFalse(any(x.startswith('숫자') for x in p))

  def test_number_in_line(self):
    lines = _ok()['lines'][:2] + ['전년 같은 분기는 45억 달러였다.']
    _, p = check_doc(_ok(lines=lines), SRC, True, 12)
    self.assertEqual(len(p), 1)
    self.assertTrue(p[0].startswith('숫자'))

  def test_currency_in_line(self):
    lines = _ok()['lines'][:2] + ['전년 같은 분기는 39.8억 유로였다.']
    _, p = check_doc(_ok(lines=lines), SRC, True, 12)
    self.assertEqual(len(p), 1)
    self.assertIn('통화', p[0])

  def test_c_materials_page_cleared(self):
    r, p = check_doc(_ok(c_materials=[{'kind': 'region', 'page': 99, 'note': '지역별 인도'}]), SRC, True, 12)
    self.assertEqual((r['c_materials'][0]['page'], p), (None, []))


class CheckNews(unittest.TestCase):
  ITEMS = [{'id': 1, 'title': '가나자동차 3분기 영업이익 2.5조', 'summary': None},
           {'id': 2, 'title': '가나자동차 신차 출시', 'summary': '전기 SUV 를 공개했다'},
           {'id': 3, 'title': '가나자동차 노조 파업', 'summary': None}]
  LINES = ['가나자동차의 3분기 영업이익은 2.5조 원이었다.', '가나자동차는 전기 SUV 신차를 공개했다.', '가나자동차 노조가 파업했다.']

  def _r(self, **kw):
    base = {'lines': list(self.LINES), 'link_ids': [1, 2], 'empty': False, 'relevant_count': 3}
    base.update(kw)
    return base

  def test_good(self):
    self.assertEqual(check_news(self._r(), self.ITEMS)[1], [])

  def test_link_outside(self):
    _, p = check_news({'lines': ['가나자동차가 신차를 냈다.'] * 3, 'link_ids': [999], 'empty': False,
                       'relevant_count': 1}, [{'id': 1, 'title': '가나자동차 신차', 'summary': None}])
    self.assertTrue(any('링크' in x and '999' in x for x in p))

  def test_link_count(self):
    _, p = check_news(self._r(link_ids=[1]), self.ITEMS)
    self.assertTrue(any('링크 수' in x for x in p))

  def test_one_relevant_one_link_ok(self):
    self.assertEqual(check_news(self._r(link_ids=[1], relevant_count=1), self.ITEMS)[1], [])

  def test_number_not_in_titles(self):
    lines = self.LINES[:2] + ['가나자동차 노조 3,000명이 파업했다.']
    _, p = check_news(self._r(lines=lines), self.ITEMS)
    self.assertEqual(len(p), 1)
    self.assertTrue(p[0].startswith('숫자'))

  def test_empty_ok(self):
    self.assertEqual(check_news({'lines': [], 'link_ids': [], 'empty': True, 'relevant_count': 0}, self.ITEMS)[1], [])

  def test_line_count(self):
    _, p = check_news(self._r(lines=self.LINES[:2]), self.ITEMS)
    self.assertTrue(any('줄 수' in x for x in p))


class Prompt(unittest.TestCase):
  def test_schema_required_all(self):
    for schema in (sp.DOC_SCHEMA, sp.NEWS_SCHEMA):
      self.assertEqual(set(schema['required']), set(schema['properties']))
      self.assertFalse(schema['additionalProperties'])
    self.assertIn('relevant_count', sp.NEWS_SCHEMA['properties'])

  def test_user_message_fences_text(self):
    m = sp.doc_user_message('가나자동차', '실적 발표', 'Q3 results', '2026-10-28', '[p.1] body', True, 3)
    self.assertIn('<<<자료 시작>>>', m)
    self.assertIn('3쪽', m)
    n = sp.news_user_message('가나자동차', '2026-11-02 주', [{'id': 7, 'title': 't', 'summary': None,
                                                           'source': 's', 'published_at': '2026-11-03'}])
    self.assertIn('[7]', n)

  def test_retry_lists_problems(self):
    self.assertIn('줄 수 2개', sp.retry_message(['줄 수 2개(3~5줄)']))


class SelfTest(unittest.TestCase):
  def test_self_test_passes(self):
    self.assertEqual(self_test(), [])


if __name__ == '__main__':
  unittest.main()
