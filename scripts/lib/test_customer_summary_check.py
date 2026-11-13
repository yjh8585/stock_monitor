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
  check_doc, check_news, currency_problems, problem_kinds, self_test, translationese_problems, unmatched_numbers)

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

  # ── Codex 1회차 검토 지적(2026-11-12) 반례 ──
  def test_own_unit_keeps_multiplier(self):
    # 지적 1: 수에 단위 낱말이 붙어 있으면 그 배수를 지우지 않는다(배수 지우기는 표 머리를 이어받은 수만)
    self.assertTrue(unmatched_numbers('매출은 4,213달러였다.', 'Revenue was $4,213 million.'))
    self.assertEqual(unmatched_numbers('매출은 42.1억 달러였다.', 'Revenue was $4,213 million.'), [])
    self.assertEqual(unmatched_numbers('매출 4,213', '(in millions) Revenue 4,213'), [])

  def test_bp_vs_percent_point(self):
    # 지적 2: bp 는 ÷100 한 값만 · 요약의 bp 도 비율 문맥이어야 한다
    self.assertTrue(unmatched_numbers('이익률은 50%p 올랐다.', 'Margin increased 50 bps.'))
    self.assertTrue(unmatched_numbers('50bp 올랐다.', 'Production rose 50 units.'))
    self.assertEqual(unmatched_numbers('이익률이 50bp 올랐다.', 'Margin increased 50 bps.'), [])
    self.assertEqual(unmatched_numbers('이익률이 0.5%p 올랐다.', 'Margin increased 50 bps.'), [])

  # ── Codex 2회차 검토 지적(2026-11-12) 반례 ──
  def test_bp_range_front_number(self):
    # 지적 1: bp 범위의 앞 숫자도 bp 를 이어받아 ÷100
    src = 'Margin increased 50 to 100 bps.'
    self.assertTrue(unmatched_numbers('이익률은 50%p 올랐다.', src))
    self.assertEqual(unmatched_numbers('이익률은 0.5~1.0%p 올랐다.', src), [])
    self.assertEqual(unmatched_numbers('이익률은 50~100bp 올랐다.', src), [])

  def test_currency_of_each_number(self):
    # 지적 2: 수마다 그 수의 통화로 맞춘다(문서 안 다른 통화 금액이 근거가 되면 안 된다)
    src = 'Revenue was $1 billion. Costs were EUR 200 million.'
    self.assertTrue(unmatched_numbers('매출은 10억 유로였다.', src))
    self.assertEqual(unmatched_numbers('매출은 10억 달러였다.', src), [])
    self.assertEqual(unmatched_numbers('원가는 2억 유로였다.', src), [])
    self.assertTrue(unmatched_numbers('원가는 2억 달러였다.', src))
    # 범위는 통화를 나눠 받는다 · 표 머리 통화 · 통화를 모르는 수는 어느 통화와도 맞는다
    self.assertTrue(unmatched_numbers('매출은 1~2조 원이었다.', 'Revenue of 1 to 2 trillion yen.'))
    self.assertTrue(unmatched_numbers('매출은 42.1억 달러였다.', '(€ million) Sales revenue 4,213'))
    self.assertEqual(unmatched_numbers('영업이익은 2.5조 원이었다.', '영업익 2.5조'), [])

  def test_year_only_from_year_notation(self):
    # 지적 3: 금액 2,027 이 「2027년」의 근거가 되면 안 된다
    src = 'FY2026 revenue was $2,027 million.'
    self.assertTrue(unmatched_numbers('2027년 매출은 20.3억 달러다.', src))
    self.assertEqual(unmatched_numbers('2026년 매출은 20.3억 달러다.', src), [])
    self.assertTrue(unmatched_numbers('FY2027 매출은 20.3억 달러다.', src))
    self.assertEqual(unmatched_numbers('FY2026 매출은 20.3억 달러다.', src), [])

  def test_year_notation_forms(self):
    for src in ('three months ended September 30, 2026', 'Q3 2026 results', '2026 Q3 results', 'H1 2026',
                '9M 2026', 'fiscal year 2026', 'Fiscal 2026 outlook', '2026년 매출 전망', '2026.10.28 공시',
                '2026-09-30', 'September 2026'):
      self.assertEqual(unmatched_numbers('2026년 실적', src), [], src)

  def test_cumulative_start_and_end(self):
    # 지적 5: 누적 구간은 시작·끝 분기를 원문과 맞춘다
    self.assertTrue(unmatched_numbers('1~4분기 매출은 100억 달러였다.', 'Q3 YTD revenue was $10 billion.'))
    self.assertEqual(unmatched_numbers('1~3분기 매출은 100억 달러였다.', 'Q3 YTD revenue was $10 billion.'), [])
    self.assertTrue(unmatched_numbers('1~3분기 매출은 100억 달러였다.', 'YTD revenue was $10 billion.'))   # 끝을 모른다
    self.assertTrue(unmatched_numbers('2~3분기 매출은 100억 달러였다.', 'nine months revenue was $10 billion.'))
    self.assertEqual(unmatched_numbers('1~3분기 매출은 100억 달러였다.', 'nine months revenue was $10 billion.'), [])
    self.assertEqual(unmatched_numbers('1~2분기 매출은 100억 달러였다.', '1H26 revenue was $10 billion.'), [])
    self.assertEqual(unmatched_numbers('1~3분기 매출은 100억 달러였다.', '9M revenue was $10 billion.'), [])

  # ── 소급 180건의 검사 실패 17건(2026-11-12) — 요약이 맞는데 검사기가 원문 수를 못 찾은 꼴 ──
  def test_plain_year_in_source(self):
    # 실물: 'positive Industrial free cash flow in 2027' · 'since 2015' · 'Growth 2025-2035' · '2024 VS. 2025'
    for src, line in (('positive Industrial free cash flow in 2027', '2027년 산업 잉여현금흐름'),
                      ('highest market share since 2015', '2015년 이후 최고'),
                      ('Growth 2025-2035 41%', '2025년부터 2035년까지 41% 성장'),
                      ('Deliveries 2024 VS. 2025', '2024년보다 줄었다'),
                      ('From 2026 to 2030, supply', '2026~2030년 공급'),
                      # 다음 줄의 '-29.4k' 가 범위 잇기로 붙어도 2024 는 연도(VOW3 investor_day 실물)
                      ('efficiency measures since 2024\n-29.4k1', '2024년 이후 감축')):
      self.assertEqual(unmatched_numbers(line, src), [], src)
    # 금액 배수·%·통화 표지가 붙은 수, 쉼표 있는 수는 여전히 연도가 아니다
    for src in ('Revenue was $2,027 million.', 'Revenue was 2027 million.', 'Share was 2027 percent.',
                'Price was $2027.', 'Revenue of 2027.5'):
      self.assertTrue(unmatched_numbers('2027년 전망', src), src)

  def test_unit_header_million_euro(self):
    # 실물(포르쉐 fact_sheet XLSX): 머리 칸이 'million € | Q1 2026 | % |' — 단위 낱말이 통화 앞
    src = 'million € | Q1 2026 | % | Q1 2025 | %\nSales revenue | 8,400 | 100.0 | 8,858 | 100.0'
    self.assertEqual(unmatched_numbers('1분기 매출은 8,400백만 유로였다.', src), [])
    self.assertEqual(unmatched_numbers('1분기 매출은 84억 유로였다.', src), [])
    self.assertTrue(unmatched_numbers('1분기 매출은 84억 달러였다.', src))   # 머리 통화가 유로 — 달러는 지적

  def test_percent_header(self):
    # 실물: 포르쉐 XLSX 머리 칸 '| % |' · DART 잠정실적 '단위 : 억원, %' · '증감율(%)'
    xlsx = 'million € | Q1 2026 | % | Q1 2025 | %\nOperating profit | 1,348 | 7.8 | 1,007 | 5.5'
    self.assertEqual(unmatched_numbers('영업이익률은 7.8%로 전년(5.5%)보다 높았다.', xlsx), [])
    dart = '1. 실적내용 단위 : 억원, % 구분 당기실적 전기실적 전기대비 증감율(%) 매출액 당해실적 11,365 11,112 2.3 - 9,070 25.3'
    self.assertEqual(unmatched_numbers('매출은 전년 동기 대비 25.3%, 전기 대비 2.3% 늘었다.', dart), [])
    self.assertEqual(unmatched_numbers('매출은 전년 대비 5.3% 늘었다.', '증감율(%) 매출액 28,017,510 5.3'), [])
    # % 머리가 없으면 맨 수는 여전히 % 의 근거가 아니다 · 머리가 있어도 원문에 없는 수는 지적
    self.assertTrue(unmatched_numbers('이익률은 7.8%였다.', 'million € | Q1 2026\nOperating profit | 1,348 | 7.8'))
    self.assertTrue(unmatched_numbers('영업이익률은 9.9%였다.', xlsx))

  def test_percent_number_word(self):
    # 실물(PII 실적 발표): 'decreased five percent' — 수가 영어 낱말
    src = 'International sales of $233 million represented 14 percent and decreased five percent.'
    self.assertEqual(unmatched_numbers('해외 매출은 2.33억 달러로 5% 줄었다.', src), [])
    self.assertTrue(unmatched_numbers('해외 매출은 6% 줄었다.', src))
    self.assertTrue(unmatched_numbers('공장 5곳', 'five plants'))   # % 낱말이 붙어야만 후보


class Currency(unittest.TestCase):
  def test_euro_on_dollar_source(self):
    p = currency_problems('3분기 매출은 42.1억 유로였다.', SRC)
    self.assertTrue(p and '통화' in p[0])

  def test_dollar_ok(self):
    self.assertEqual(currency_problems('3분기 매출은 42.1억 달러였다.', SRC), [])

  def test_won_word_not_currency(self):
    # 「원문」·「원가」의 원은 통화가 아니다
    self.assertEqual(currency_problems('3분기 원가가 늘었다고 원문은 밝혔다.', SRC), [])

  def test_won_word_in_source_not_krw(self):
    # 지적 4: 원문의 「원가」·「임직원」은 원화 근거가 아니다
    for src in ('Revenue was $4,213 million. 원가를 설명했다.', 'Revenue was $4,213 million. 임직원 수를 밝혔다.'):
      self.assertTrue(currency_problems('매출은 42.1억 원이었다.', src), src)

  def test_won_in_source_forms(self):
    for src in ('매출 1,234원', '(단위 : 십억원) 매출액 31,617', '매출 4,213억원', 'KRW 1.2 trillion', '₩1.2 trillion',
                'revenue of 1.2 trillion won', '영업이익 2.5조'):
      self.assertEqual(currency_problems('매출은 1.2조 원이었다.', src), [], src)


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

  def test_five_pages_allowed(self):
    # 2026-11-13 사용자 지시 「3페이지 → 5페이지」 — 상수만 보지 않고 5쪽을 직접 넣어 본다
    pages = [{'page': n, 'caption': '표'} for n in range(1, 6)]
    _, p = check_doc(_ok(pages=pages), SRC, True, 12)
    self.assertFalse(any('쪽 캡처' in x for x in p))

  def test_too_many_pages(self):
    pages = [{'page': n, 'caption': '표'} for n in range(1, sp.MAX_PAGES + 2)]  # 상한 + 1쪽
    _, p = check_doc(_ok(pages=pages), SRC, True, 12)
    self.assertTrue(any('쪽 캡처' in x and '최대' in x for x in p))

  def test_pages_on_html(self):
    _, p = check_doc(_ok(evidence=[{'quote': 'Regional deliveries table', 'page': None}]), SRC, False, 0)
    self.assertEqual(len(p), 1)
    self.assertIn('PDF', p[0])

  def test_highlight_kept_and_measured_plain(self):
    # 올바른 표시는 그대로 두고, 글자 수·숫자 대조는 기호를 뺀 글로 한다(기호 4자가 상한을 넘기지 않게)
    edge = '3분기 매출은 **42.1억 달러**였다' + '고' * (sp.LINE_CHARS - len('3분기 매출은 42.1억 달러였다.')) + '.'
    lines = _ok()['lines'][:2] + [edge]
    r, p = check_doc(_ok(lines=lines), SRC, True, 12)
    self.assertEqual(p, [])
    self.assertEqual(r['lines'][2], edge)
    self.assertIsNone(r['check_note'])

  def test_broken_highlight_is_fixed_not_flagged(self):
    # 꼴이 깨진 표시는 지적(재요청·check_failed)이 아니라 기호만 지우는 고침
    lines = _ok()['lines'][:2] + ['3분기 매출은 **42.1억 달러였다.']
    r, p = check_doc(_ok(lines=lines, importance_reason='**전망 하향**'), SRC, True, 12)
    self.assertEqual(p, [])
    self.assertEqual(r['lines'][2], '3분기 매출은 42.1억 달러였다.')
    self.assertIn('강조 표시 지움: 3줄째', r['check_note'])
    self.assertEqual(r['importance_reason'], '전망 하향')

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
    # Codex 2회차(2026-11-12) 뒤로 숫자 대조도 통화를 본다 — 39.8억의 원문 짝($3,980 million)은 달러라 숫자 지적도 함께 난다
    self.assertEqual(len(p), 2)
    self.assertTrue(any('통화' in x for x in p))
    self.assertTrue(any('숫자 원문 없음' in x for x in p))

  def test_evidence_across_page_boundary(self):
    # 지적 9: 쪽 경계를 넘는 인용은 시작 쪽으로 보정한다
    src = '[p.1] We will close [p.2] plants'
    r, p = check_doc(_ok(evidence=[{'quote': 'will close plants', 'page': 99}], pages=[]), src, True, 2)
    self.assertEqual(r['evidence'][0]['page'], 1)
    self.assertFalse(any(x.startswith('근거') for x in p))
    self.assertIn('근거 쪽 99→1', r['check_note'])

  def test_evidence_page_out_of_range(self):
    # 쪽 표식이 쪽 수보다 크면(보정 뒤에도 범위 밖) 지적
    src = '[p.1] intro [p.3] We will close plants'
    _, p = check_doc(_ok(evidence=[{'quote': 'We will close plants', 'page': 3}], pages=[]), src, True, 2)
    self.assertTrue(any(x.startswith('근거 쪽 번호') for x in p))

  def test_blank_lines(self):
    # 지적 10: 빈 줄·공백만인 줄은 지적 · 유효 줄 수로 3~5 검사
    _, p = check_doc(_ok(lines=['', '', '']), SRC, True, 12)
    self.assertTrue(any(x.startswith('빈 줄') for x in p))
    self.assertTrue(any(x.startswith('줄 수 0개') for x in p))
    _, p = check_doc(_ok(lines=_ok()['lines'] + ['   ']), SRC, True, 12)
    self.assertTrue(any(x.startswith('빈 줄') for x in p))
    self.assertFalse(any(x.startswith('줄 수') for x in p))

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

  def test_empty_contradiction(self):
    # 지적 6: empty=true 인데 줄·링크·관련 기사 수가 있으면 지적(재요청 대상)
    _, p = check_news({'lines': self.LINES, 'link_ids': [999], 'empty': True, 'relevant_count': 1}, self.ITEMS)
    self.assertTrue(any(x.startswith('empty 모순') for x in p))
    for body in ({'lines': ['가나자동차 노조가 파업했다.'], 'link_ids': [], 'relevant_count': 0},
                 {'lines': [], 'link_ids': [1], 'relevant_count': 0},
                 {'lines': [], 'link_ids': [], 'relevant_count': 2}):
      _, p = check_news({**body, 'empty': True}, self.ITEMS)
      self.assertTrue(any(x.startswith('empty 모순') for x in p), body)
    self.assertEqual(check_news({'lines': ['  '], 'link_ids': [], 'empty': True, 'relevant_count': 0}, self.ITEMS)[1], [])

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


class ProblemKinds(unittest.TestCase):
  def test_counts_names_only(self):
    # 지적 11: 정기 로그엔 갈래 이름과 건수만 — 숫자 값·본문 조각은 안 나간다
    probs = ['숫자 원문 없음: 1줄째 「매출 45억 달러」', '숫자 원문 없음: 2줄째 「7%」', '통화: 「유로」가 원문에 없다 — 매출',
             '쪽 번호 40 이 범위 밖(1~12)', '근거 인용이 원문에 없다(그대로 복사할 것): 「x」', '번역투: 에 있어서 — 영향에 있어서']
    got = problem_kinds(probs)
    self.assertEqual(got, '숫자 2 · 통화 1 · 쪽 1 · 근거 1 · 번역투 1')
    self.assertNotIn('45', got)
    self.assertEqual(problem_kinds([]), '')

  def test_every_message_has_a_kind(self):
    # 검사기가 내는 지적 문구가 전부 이름 표에 걸리는지(「기타」가 나오면 표에 줄을 더한다)
    _, p1 = check_doc(_ok(lines=['', '3분기 매출은 45억 유로였다' + '고' * sp.LINE_CHARS, '관세 영향에 있어서 늘었다.'],
                          evidence=[{'quote': '없는 문장', 'page': 6}], pages=[{'page': 40, 'caption': 'x'}] * 4),
                      SRC, True, 12)
    _, p2 = check_doc(_ok(), SRC, False, 0)
    _, p3 = check_news({'lines': ['a'] * 3, 'link_ids': [999], 'empty': False, 'relevant_count': 0}, CheckNews.ITEMS)
    _, p4 = check_news({'lines': ['a'] * 3, 'link_ids': [1], 'empty': False, 'relevant_count': 3}, CheckNews.ITEMS)
    _, p5 = check_news({'lines': ['a'], 'link_ids': [], 'empty': True, 'relevant_count': 0}, CheckNews.ITEMS)
    for p in (p1, p2, p3, p4, p5):
      self.assertTrue(p)
      self.assertNotIn('기타', problem_kinds(p), p)


class SelfTest(unittest.TestCase):
  def test_self_test_passes(self):
    self.assertEqual(self_test(), [])


if __name__ == '__main__':
  unittest.main()
