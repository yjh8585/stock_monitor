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


class PorscheFactSheetTests(unittest.TestCase):
  """Task 3 — 포르쉐 팩트시트 XLSX(목록 어댑터가 doc_type='fact_sheet'·form='fact-sheet-xlsx' 로 낸 행) → 분기 단독 실적·인도.
  셀 값은 2026-11-10 실물 팩트시트(Q3 2026 · Q1 2025)에서 옮긴 것(porsche.FS_* — 원본 XLSX 는 저장하지 않는다)."""

  @classmethod
  def setUpClass(cls):
    from customer_parsers import porsche
    cls.P = porsche

  def _fs_doc(self, url='https://investorrelations.porsche.com/x/Q3-2026-fact-sheet-porsche-ag.xlsx'):
    return base.Doc(0, 'cid', 'P911.DE', 'ir', 'fact_sheet', 'fact-sheet-xlsx', '', 'Fact Sheet Q3 2026', url,
                    '2026-10-27')

  def test_list_rows_to_doc_wants(self):
    """목록 픽스처 행 → 숫자 수집기 Doc 꼴 → 팩트시트는 받고, 링크만인 문서(발표자료·CMD·보고서)는 안 받는다."""
    from lib import ir_lists
    fx = pathlib.Path(__file__).resolve().parent / 'fixtures' / 'ir_lists'
    import json
    rows = ir_lists.parse_porsche_all(json.loads((fx / 'porsche_feed.json').read_text(encoding='utf-8')),
                                      (fx / 'porsche_reports.html').read_text(encoding='utf-8'))

    def doc(r):
      return base.Doc(0, 'cid', 'P911.DE', r['source'], r['doc_type'], r['form'], r['items'] or '', r['title'],
                      r['url'], r['published_at'] or '', r['source_id'])
    fs = [r for r in rows if r['doc_type'] == 'fact_sheet']
    self.assertTrue(fs)
    self.assertTrue(all(self.P.wants(doc(r)) for r in fs))
    links = [r for r in rows if r['doc_type'] in ('presentation', 'investor_day', 'periodic', 'other')]
    self.assertTrue(links)
    self.assertFalse(any(self.P.wants(doc(r)) for r in links))

  def test_parse_q3_2026_quarters(self):
    res = self.P.parse(self._fs_doc(), self.P.fs_content(self.P.FS_Q3_2026))
    got = {(type(x).__name__, x.metric, x.period_grain, x.period): x.value for x in [*res.results, *res.volume]}
    self.assertEqual(got[('ResultRow', 'revenue', 'quarter', '2026-Q3')], 8053)
    self.assertEqual(got[('ResultRow', 'operating_income', 'quarter', '2026-Q2')], 753)
    self.assertEqual(got[('VolumeRow', 'deliveries', 'quarter', '2026-Q1')], 60991)
    self.assertEqual(len(got), 9)   # 그 해 분기(Q1~Q3) × 매출·영업이익·인도 — 전년 분기·누계 블록은 안 읽는다
    self.assertTrue(all(x.unit == 'million' and x.currency == 'EUR' for x in res.results))
    self.assertTrue(all(x.region == 'total' for x in res.volume))   # 기존 포르쉐 인도 행 어휘(Worldwide → total)
    self.assertFalse(self.P.llm_wants(self._fs_doc(), res))
    self.assertEqual(base.check_vocab(res), [])   # 적재 전 어휘·기간 형식 거르기에 안 걸린다

  def test_quotes_pass_quote_check(self):
    """quote = 원문(시트 글)의 연속 구간 — 대조기를 통과해야 화면(verified)에 나온다."""
    from lib import quote_check
    content = self.P.fs_content(self.P.FS_Q3_2026)
    res = self.P.parse(self._fs_doc(), content)
    for r in [*res.results, *res.volume]:
      self.assertEqual(quote_check.check_row(r, content.text), (True, 'ok'), r)

  def test_quarters_sum_to_eqs_9m(self):
    """검산 — 팩트시트 2026 Q1+Q2+Q3 = EQS 실적 보도(2026-10-27) 9M 누계. 둘 다 실물 원문 값(DB 를 읽지 않는다).
    허용오차 = EQS 반올림 반 단위(€0.01bn → €5m) + 분기 세 칸 각자의 반올림(백만 단위 · 0.5m × 3) = €6.5m.
    영업이익은 분기 합 1,735 · EQS €1.74bn 이라 차이 5m(EQS 가 1,735 를 반올림한 값). 인도는 정수라 0."""
    fs = self.P.parse(self._fs_doc(), self.P.fs_content(self.P.FS_Q3_2026))
    eqs = self.P.parse(base.Doc(0, 'cid', 'P911.DE', 'ir', 'earnings_release', '', '', '', '', '2026-10-27'),
                       base.Content(text='', tables=[self.P.RES_9M]))
    mult = {'billion': 1000, 'million': 1}
    for metric in ('revenue', 'operating_income'):
      q = sum(x.value for x in fs.results if x.metric == metric and x.period.startswith('2026-Q'))
      ytd = next(x for x in eqs.results if x.metric == metric and x.period == '2026-9M')
      self.assertLessEqual(abs(q - ytd.value * mult[ytd.unit]), 6.5, metric)
    dq = sum(x.value for x in fs.volume if x.period.startswith('2026-Q'))
    self.assertEqual(dq, next(x.value for x in eqs.volume if x.period == '2026-9M'))

  def test_fetch_fact_sheet_reads_xlsx_via_ir_get(self):
    """팩트시트 바이트는 ir_lists.ir_get(50MB 상한)으로 받고 openpyxl 로 연다 — 표시 형식(#,##0,, = 백만)대로 글을 만든다."""
    import io
    from unittest import mock
    import openpyxl
    from lib import ir_lists
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = '01 - Group EBIT'
    ws.append(['million €', None, 'Q2 2026', '%  ', None, 'Q1 2026', '%  '])
    ws.append(['Sales revenue', None, 8829571050.259998, 100, None, 8399884478.04, 100])
    ws.append(['Operating profit', None, 753197351.52, 8.530395726277339, None, 594987696.99, 7.083284282605187])
    for row in ws.iter_rows(min_row=2):
      for c in row[2:]:
        c.number_format = '0.0' if c.column in (4, 7) else '#,##0,,'
    ws2 = wb.create_sheet('03 - Sales_deliveries by Region')
    ws2.append(['Units', None, 'Q2 2026', None, 'Q1 2026'])
    ws2.append(['Deliveries to customers', None, 61315, None, 60991])
    for c in ws2[2][2:]:
      c.number_format = '#,##0'
    buf = io.BytesIO()
    wb.save(buf)
    resp = mock.Mock(content=buf.getvalue())
    with mock.patch.object(ir_lists, 'ir_get', return_value=resp) as g:
      content = self.P.fetch(object(), self._fs_doc())
    g.assert_called_once()
    self.assertIn('Sales revenue | 8,830 | 100.0 | 8,400', content.text)
    res = self.P.parse(self._fs_doc(), content)
    got = {(x.metric, x.period): x.value for x in [*res.results, *res.volume]}
    self.assertEqual(got, {('revenue', '2026-Q2'): 8830, ('revenue', '2026-Q1'): 8400,
                           ('operating_income', '2026-Q2'): 753, ('operating_income', '2026-Q1'): 595,
                           ('deliveries', '2026-Q2'): 61315, ('deliveries', '2026-Q1'): 60991})
    self.assertEqual(content.raw, buf.getvalue())

  def test_fetch_too_large_is_lib_class(self):
    from unittest import mock
    from lib import ir_lists
    with mock.patch.object(ir_lists, 'ir_get', side_effect=ir_lists.TooLarge(None)):
      with self.assertRaises(ir_lists.TooLarge):
        self.P.fetch(object(), self._fs_doc())

  def test_fetch_eqs_delegates_to_default(self):
    """fetch 는 모듈 단위 훅 — 팩트시트가 아닌 EQS 보도자료는 숫자 수집기의 기본 받기 그대로."""
    from unittest import mock
    import collect_customer_numbers as ccn_mod
    eqs = base.Doc(0, 'cid', 'P911.DE', 'ir', 'earnings_release', 'EQS-News', '', 'T', 'https://x/eqs', '2026-10-27')
    want = base.Content('본문')
    with mock.patch.object(ccn_mod, 'fetch_content', return_value=(want, 'sha')) as f:
      self.assertIs(self.P.fetch(object(), eqs), want)
    f.assert_called_once()


class MobisScriptTests(unittest.TestCase):
  """Task 5 — 현대모비스 영문 실적 Script(목록 어댑터가 form='script' 로 낸 행)의 연간 수주 목표를 코드가 읽는다.
  본문 = 2026-11-11 실물 Script PDF 의 pdf_text 결과에서 그 문단만 옮겼다(줄바꿈 자리도 실물 그대로 · PDF 는 저장 안 함)."""

  @classmethod
  def setUpClass(cls):
    from customer_parsers import kr_dart
    cls.K = kr_dart

  def _doc(self, title='2026 3Q Business Results Script', form='script'):
    return base.Doc(0, 'cid', self.K.MOBIS, 'ir', 'presentation', form, '', title,
                    'https://www.mobis.com/cmm/fms/PdfFileDown.do?fileId=1&fileSn=0&fileNm=x.pdf', '2026-10-30')

  def test_parse_3q26_target(self):
    content = base.Content(text=self.K.SCRIPT_3Q26)
    res = self.K.parse(self._doc(), content)
    self.assertTrue(res.recognized)
    self.assertEqual([(g.metric, g.period, g.low, g.high, g.unit, g.currency) for g in res.guidance],
                     [('order_intake', 'FY2026', 8.97, 8.97, 'billion', 'USD')])
    self.assertEqual(base.check_vocab(res), [])
    from lib import quote_check
    self.assertEqual(quote_check.check_row(res.guidance[0], content.text), (True, 'ok'))
    self.assertFalse(self.K.llm_wants(self._doc(), res))   # LLM 호출 0

  def test_cumulative_actual_is_not_read(self):
    res = self.K.parse(self._doc(), base.Content(
      text='Non-captive orders for Core Parts reached USD 1.15 billion on a cumulative basis through the third quarter '
           'of 2026'))
    self.assertEqual((res.guidance, res.recognized), ([], False))   # 목표 문장 없음 → 알아보지 않음(아래 경고 시험)

  def test_script_without_target_is_unrecognized_warning(self):
    """E7(2026-11-11 사용자 결정) — 목표 문장이 없는 Script(문구가 바뀐 회차)는 조용한 not_target 이 아니라
    숫자 수집기가 「서식 미인식」 으로 남기고 상태 사유에 센다(expects_numbers 가 참)."""
    import importlib.util
    from types import SimpleNamespace
    from unittest import mock
    p = pathlib.Path(__file__).resolve().parents[1] / 'collect_customer_numbers.py'
    spec = importlib.util.spec_from_file_location('ccn_t5', p)
    ccn = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ccn)
    self.assertTrue(self.K.expects_numbers(self._doc()))
    self.assertFalse(self.K.expects_numbers(self._doc(title='2026년 3분기 경영실적', form='performance')))
    changed = base.Content(text='Our annual order goal for 2026 is USD 8.97 billion.')   # 가상 — 문구 변경
    ws = mock.MagicMock()
    run = ccn._CompanyRun(self.K, mock.MagicMock(), None, ws, SimpleNamespace(dry_run=False, no_llm=True), 'cid')
    with mock.patch.object(ccn, 'fetch_content', return_value=(changed, 'sha')):
      run.process(base.Doc(**{**self._doc().__dict__, 'id': 9}), None, None)   # id 0 은 문서 행을 안 쓴다
    last = ws.table.return_value.update.call_args_list[-1].args[0]
    self.assertEqual((last['parse_status'], last['parse_note']), ('not_target', ccn.NOTE_UNRECOGNIZED))
    self.assertEqual(run.outcomes['unrecognized'], 1)

  def test_year_nearest_before_in_same_sentence(self):
    """다음 해 1월의 4분기 Script 꼴 — 문단엔 2026 이 있어도 같은 문장 앞의 2027 이 목표 연도(가상 문구)."""
    res = self.K.parse(self._doc(title='2026 4Q Business Results Script'), base.Content(text=self.K._SCRIPT_NEXT_YEAR))
    self.assertEqual([(g.period, g.low) for g in res.guidance], [('FY2027', 9.5)])

  def test_two_years_in_paragraph_no_row(self):
    """문장엔 연도가 없고 문단엔 둘 — 어느 해 목표인지 못 가려 행을 안 만든다(알아봄 · 0행 = failed)."""
    res = self.K.parse(self._doc(), base.Content(text=self.K._SCRIPT_TWO_YEARS))
    self.assertEqual((res.guidance, res.recognized), ([], True))

  def test_year_from_document_quarter_when_paragraph_has_none(self):
    res = self.K.parse(self._doc(), base.Content(
      text='representing 13% of the annual order target of USD 8.97 billion'))
    self.assertEqual([g.period for g in res.guidance], ['FY2026'])

  def test_no_year_anywhere_is_failed_not_invented(self):
    """문단에도 문서 제목에도 연도가 없으면 행을 만들지 않는다 — recognized 라 0행 = failed 로 드러난다."""
    res = self.K.parse(self._doc(title='Business Results Script'), base.Content(
      text='representing 13% of the annual order target of USD 8.97 billion'))
    self.assertEqual((res.guidance, res.recognized), ([], True))

  def test_script_routing(self):
    self.assertTrue(self.K.wants(self._doc()))
    self.assertFalse(self.K.llm_only(self._doc()))
    perf = self._doc(title='2026년 3분기 경영실적', form='performance')
    self.assertTrue(self.K.llm_only(perf))   # 국문 경영실적 PDF 는 지금처럼 LLM
    self.assertEqual(self.K.parse(perf, base.Content(text=self.K.SCRIPT_3Q26)).count(), 0)


class GmUsDeliveriesTests(unittest.TestCase):
  """Task 8 — GM IR 미국 분기 판매 상세의 Deliveries PDF(목록 어댑터가 form='us-deliveries' 로 낸 행) → 미국 분기 인도 총계.
  본문 = 2026-11-11 실물 PDF(Deliveries Q3 2026)의 pdf_text 결과에서 머리·총계 구간만 옮겼다(gm.DELIVERIES_Q3_2026)."""

  @classmethod
  def setUpClass(cls):
    from customer_parsers import gm
    cls.G = gm

  def _doc(self, form='us-deliveries', source='ir', doc_type='sales_release'):
    return base.Doc(0, 'cid', 'GM', source, doc_type, form, '', 'GM U.S. Deliveries Q3 2026',
                    'https://investor.gm.com/static-files/1294f515-0131-4d38-986e-f4d3160e7a68', '2026-10-01')

  def test_list_rows_to_doc_wants(self):
    """목록 픽스처 행 → 숫자 수집기 Doc 꼴 → Deliveries 는 받고, 덱·서한(3단계 몫)은 안 받는다."""
    from lib import ir_lists
    fx = pathlib.Path(__file__).resolve().parent / 'fixtures' / 'ir_lists'
    rows = ir_lists.parse_gm((fx / 'gm_quarterly_results.html').read_text(encoding='utf-8'),
                             [((fx / 'gm_sales_detail.html').read_text(encoding='utf-8'), '2026-10-01')])
    for r in rows:
      with self.subTest(title=r['title']):
        doc = base.Doc(0, 'cid', 'GM', r['source'], r['doc_type'], r['form'], '', r['title'], r['url'],
                       r['published_at'] or '', r['source_id'])
        self.assertEqual(self.G.wants(doc), r['form'] == 'us-deliveries')
    # EDGAR 경로는 그대로
    self.assertTrue(self.G.wants(self._doc(form='8-K', source='edgar', doc_type='earnings_release')))

  def test_parse_total_row(self):
    res = self.G.parse(self._doc(), base.Content(text=self.G.DELIVERIES_Q3_2026))
    self.assertTrue(res.recognized)
    self.assertEqual([(v.metric, v.region, v.period_grain, v.period, v.value) for v in res.volume],
                     [('deliveries', 'us', 'quarter', '2026-Q3', 670974)])
    self.assertEqual(base.check_vocab(res), [])

  def test_quote_passes_quote_check(self):
    from lib import quote_check
    res = self.G.parse(self._doc(), base.Content(text=self.G.DELIVERIES_Q3_2026))
    self.assertEqual(quote_check.check_row(res.volume[0], self.G.DELIVERIES_Q3_2026)[0], True)

  def test_missing_total_row_is_recognized_empty(self):
    """제목은 알아봤는데 총계 행이 없으면 0행 + recognized → 숫자 수집기가 failed 로 드러낸다(모델별 행은 읽지 않는다)."""
    text = self.G.DELIVERIES_Q3_2026.replace('GM Vehicle Total*', 'Grand Total')
    res = self.G.parse(self._doc(), base.Content(text=text))
    self.assertEqual((res.count(), res.recognized), (0, True))

  def test_fetch_ir_uses_chrome_and_pdf_text(self):
    from unittest import mock
    from lib import ir_lists
    with mock.patch.object(ir_lists, '_chrome_fetch', return_value=[(200, b'%PDF-1.7 x')]) as cf, \
         mock.patch('lib.doc_text.pdf_text', return_value=self.G.DELIVERIES_Q3_2026):
      content = self.G.fetch(object(), self._doc())
    cf.assert_called_once_with([self._doc().url])
    self.assertEqual(content.text, self.G.DELIVERIES_Q3_2026)
    self.assertEqual(content.raw, b'%PDF-1.7 x')

  def test_fetch_ir_failures_are_lib_classes(self):
    """403 = HTTPError(응답 403 → 숫자 수집기 blocked) · 크기 초과 = lib 의 TooLarge(바이트가 상한을 넘어도)."""
    import requests
    from unittest import mock
    from lib import ir_lists
    with mock.patch.object(ir_lists, '_chrome_fetch', return_value=[(403, b'')]):
      with self.assertRaises(requests.HTTPError) as cm:
        self.G.fetch(object(), self._doc())
    self.assertEqual(cm.exception.response.status_code, 403)
    for result in ([(ir_lists.CHROME_TOO_LARGE, b'')], [(200, b'x' * 11)]):
      with mock.patch.object(ir_lists, '_chrome_fetch', return_value=result), \
           mock.patch.object(ir_lists, 'MAX_IR_BYTES', 10), self.assertRaises(ir_lists.TooLarge):
        self.G.fetch(object(), self._doc())

  def test_fetch_edgar_delegates_to_default(self):
    from unittest import mock
    import collect_customer_numbers as ccn_mod
    want = base.Content('본문')
    with mock.patch.object(ccn_mod, 'fetch_content', return_value=(want, 'sha')) as f:
      self.assertIs(self.G.fetch(object(), self._doc(form='8-K', source='edgar', doc_type='earnings_release')), want)
    f.assert_called_once()


class GuidanceExtraTests(unittest.TestCase):
  """Task 9 — 지표 밖 연간 전망 6개(GM 4 · VW 2). 새 키 = eps_diluted · automotive_operating_cash_flow · special_items ·
  operating_margin_adjusted(+ 기존 net_income_parent · capex).
  GM 본문 = 2026-10-20(doc 196 · 3분기 판)·2026-01-27(doc 206 · 4분기 판) EX-99.1 의 html_to_text 결과에서 그 구간만 옮겼다."""
  # doc 196 — 전망 대조표 구간
  GM_TEXT_Q3 = (
    'Guidance Reconciliations The following table reconciles expected Net income attributable to stockholders to '
    'expected EBIT-adjusted (dollars in billions): Year Ending December 31, 2026 Updated(a) Previous Net income '
    'attributable to stockholders $ 8.9-9.5 $ 8.4-9.8 Income tax expense 2.0-2.4 2.2-2.8 Automotive interest (income) '
    'expense, net (0.1) (0.1) Adjustments 3.7 3.5 EBIT-adjusted $ 14.5-15.5 $ 14.0-16.0 __________ (a) Refer to the '
    'reconciliation of Net income (loss) attributable to stockholders to EBIT-adjusted and segment profit (loss) for '
    'adjustment details. These expected financial results do not include the potential impact of future adjustments '
    'related to special items . The following table reconciles expected EPS-diluted to expected EPS-diluted-adjusted: '
    'Year Ending December 31, 2026 Updated(a) Previous Diluted earnings per common share $ 9.72-10.72 $ 8.98-10.98 '
    'Adjustments 3.03 3.02 EPS-diluted-adjusted $ 12.75-13.75 $ 12.00-14.00 __________ (a) Refer to the reconciliation '
    'of diluted earnings per common share to EPS-diluted-adjusted for adjustment details. These expected financial '
    'results do not include the potential impact of future adjustments related to special items. The following table '
    'reconciles expected automotive net cash provided by operating activities to expected adjusted automotive free '
    'cash flow (dollars in billions): Year Ending December 31, 2026 Updated(a) Previous Net automotive cash provided by '
    'operating activities $ 17.3-20.3 $ 15.4-19.4 Less: Capital expenditures 10.0-12.0 10.0-12.0 Adjustments 4.2 4.1 '
    'Adjusted automotive free cash flow $ 11.5-12.5 $ 9.5-11.5')
  # doc 206 — 전망 표 + 새 해 대조표 구간
  GM_TEXT_Q4 = (
    'Final 2025 Guidance 2025 Results 2026 Guidance Net income attributable to stockholders $7.7 billion - $8.3 billion '
    '$2.7 billion $10.3 billion - $11.7 billion EBIT-adjusted $12.0 billion - $13.0 billion $12.7 billion $13.0 billion - '
    '$15.0 billion Automotive operating cash flow $19.2 billion - $21.2 billion $18.7 billion $19.0 billion - $23.0 '
    'billion Adjusted automotive free cash flow $10.0 billion - $11.0 billion $10.6 billion $9.0 billion - $11.0 billion '
    'EPS-diluted $8.30 - $9.05 $3.27 $11.00 - $13.00 EPS-diluted-adjusted $9.75 - $10.50 $10.60 $11.00 - $13.00 '
    "GM's 2026 financial guidance also includes anticipated capital spending of $10.0 billion - $12.0 billion. "
    '2026 Guidance Reconciliations The following table reconciles expected automotive net cash provided by operating '
    'activities to expected adjusted automotive free cash flow (dollars in billions): Year Ending December 31, 2026 '
    'Net automotive cash provided by operating activities $ 19.0-23.0 Less: Capital expenditures 10.0-12.0 Adjusted '
    'automotive free cash flow(a) $ 9.0-11.0')
  NEW = ('net_income_parent', 'eps_diluted', 'automotive_operating_cash_flow', 'capex')

  @classmethod
  def setUpClass(cls):
    from customer_parsers import gm, vw
    cls.G, cls.V = gm, vw

  def _gm(self, tables, text=''):
    doc = base.Doc(0, 'cid', 'GM', 'edgar', 'earnings_release', '8-K', '2.02,9.01', '8-K', '', '2026-10-20')
    return self.G.parse(doc, base.Content(text=text, tables=tables))

  def _rows(self, res):
    return {g.metric: (g.metric_label, g.low, g.high, g.unit, g.basis, g.period) for g in res.guidance
            if g.metric in self.NEW}

  def test_new_keys_in_vocab_and_llm_schema(self):
    from lib import llm_guidance
    new = ('eps_diluted', 'automotive_operating_cash_flow', 'special_items', 'operating_margin_adjusted')
    self.assertLessEqual(set(new), set(base.METRICS))
    self.assertLessEqual(set(new), set(llm_guidance.SCHEMA['properties']['items']['items']['properties']['metric']['enum']))
    # 빠뜨리면 LLM 행의 % 단위 검사(비율 단위)가 이 키를 놓친다
    self.assertIn('operating_margin_adjusted', llm_guidance.PERCENT_METRICS)

  def test_gm_q3_reconciliation_rows(self):
    """3분기 판 — 전망 표는 필수 3행뿐, 장부상 4지표는 전망 대조표('Year Ending December 31, 2026')의 Updated 칸."""
    from lib import quote_check
    res = self._gm([self.G.GUIDE_2026Q3, *self.G.RECON_2026Q3], self.GM_TEXT_Q3)
    self.assertEqual(self._rows(res), {
      'net_income_parent': ('Net income attributable to stockholders', 8.9, 9.5, 'billion', 'reported', 'FY2026'),
      'eps_diluted': ('Diluted earnings per common share', 9.72, 10.72, 'per_share', 'reported', 'FY2026'),
      'automotive_operating_cash_flow': ('Net automotive cash provided by operating activities', 17.3, 20.3, 'billion',
                                         'reported', 'FY2026'),
      'capex': ('Capital expenditures', 10.0, 12.0, 'billion', 'reported', 'FY2026')})
    self.assertEqual(len(res.guidance), 7)
    self.assertEqual(base.check_vocab(res), [])
    for g in res.guidance:
      if g.metric in self.NEW:
        with self.subTest(metric=g.metric):
          self.assertEqual(quote_check.check_row(g, self.GM_TEXT_Q3)[0], True)

  def test_gm_q4_guidance_table_rows_and_new_year_reconciliation(self):
    """4분기 판(머리 'Final 2025 Guidance | 2025 Results | 2026 Guidance') — 순이익·영업현금흐름·EPS-diluted 는 전망 표의
    '2026 Guidance' 칸, 설비투자는 새 해 대조표. 지난해 최종(2025) 대조표에서 FY2025 행을 만들지 않는다."""
    from lib import quote_check
    res = self._gm([self.G.GUIDE_2026Q4, *self.G.RECON_2026Q4], self.GM_TEXT_Q4)
    self.assertEqual(self._rows(res), {
      'net_income_parent': ('Net income attributable to stockholders', 10.3, 11.7, 'billion', 'reported', 'FY2026'),
      'eps_diluted': ('EPS-diluted', 11.0, 13.0, 'per_share', 'reported', 'FY2026'),
      'automotive_operating_cash_flow': ('Automotive operating cash flow', 19.0, 23.0, 'billion', 'reported', 'FY2026'),
      'capex': ('Capital expenditures', 10.0, 12.0, 'billion', 'reported', 'FY2026')})
    self.assertEqual({g.period for g in res.guidance}, {'FY2026'})
    self.assertEqual(len(res.guidance), 7)
    for g in res.guidance:
      if g.metric in self.NEW:
        with self.subTest(metric=g.metric):
          self.assertEqual(quote_check.check_row(g, self.GM_TEXT_Q4)[0], True)

  def test_gm_required_stays_three(self):
    """새 행은 «있으면 뽑는다» — 필수(GUIDANCE_REQUIRED)는 3지표 그대로라 3행뿐인 과거 판(대조표 없음)도 parsed 감."""
    self.assertEqual(self.G.GUIDANCE_REQUIRED, ('ebit_adjusted', 'adjusted_automotive_fcf', 'eps_adjusted'))
    res = self._gm([self.G.GUIDE_2026Q3])
    self.assertEqual(sorted(g.metric for g in res.guidance), ['adjusted_automotive_fcf', 'ebit_adjusted', 'eps_adjusted'])
    self.assertTrue(res.recognized)
    # 대조표 라벨이 바뀌어도 문서는 실패가 아니다(그 행만 빠진다)
    renamed = [[[c.replace('Diluted earnings per common share', 'Diluted EPS') for c in r] for r in t]
               for t in self.G.RECON_2026Q3]
    res = self._gm([self.G.GUIDE_2026Q3, *renamed])
    self.assertNotIn('eps_diluted', self._rows(res))
    self.assertEqual(len(res.guidance), 6)

  def test_gm_reconciliation_only_uses_header_year(self):
    """전망 표 없이 전망 대조표만 있는 판(2025-07 doc 212 꼴 — 본문은 'guidance is unchanged') — 장부상 4지표를
    대조표 머리 연도로 뽑는다. 필수 3지표는 대조표에서 읽지 않는다(새 4지표만)."""
    res = self._gm(self.G.RECON_2026Q3)
    self.assertEqual(self._rows(res), {
      'net_income_parent': ('Net income attributable to stockholders', 8.9, 9.5, 'billion', 'reported', 'FY2026'),
      'eps_diluted': ('Diluted earnings per common share', 9.72, 10.72, 'per_share', 'reported', 'FY2026'),
      'automotive_operating_cash_flow': ('Net automotive cash provided by operating activities', 17.3, 20.3, 'billion',
                                         'reported', 'FY2026'),
      'capex': ('Capital expenditures', 10.0, 12.0, 'billion', 'reported', 'FY2026')})
    self.assertEqual(len(res.guidance), 4)
    self.assertTrue(res.recognized)

  def test_gm_prior_year_reconciliation_only_is_ignored(self):
    """지난해 최종 대조표만 있으면(4분기 판 2026-01-27 doc 206 의 2025 표 3개) 아무 행도 만들지 않는다."""
    doc = base.Doc(0, 'cid', 'GM', 'edgar', 'earnings_release', '8-K', '2.02,9.01', '8-K', '', '2026-01-27')
    res = self.G.parse(doc, base.Content(text='', tables=self.G.RECON_2026Q4[:3]))
    self.assertEqual((res.guidance, res.recognized), ([], False))

  def test_gm_reconciliation_year_unconfirmed_fails_document(self):
    """대조표 연도가 발표 연도도, 그 이전도 아니면 연도를 확정할 수 없다 — 조용히 버리지 않고 0행 + recognized 로
    문서를 failed 로 드러낸다(실적 행도 함께 비운다 · 이 파서의 서식 변경 규칙)."""
    later = [[[c.replace('2026', '2027') for c in r] for r in t] for t in self.G.RECON_2026Q3]
    res = self._gm(later)
    self.assertEqual((res.count(), res.recognized), (0, True))
    # 머리에서 연도가 빠지거나 글자로 바뀐 대조표(Codex 재현 'TBD') — 대조표 없음과 갈라 failed 로
    for year_text in ('TBD', ''):
      blank = [[[c.replace('December 31, 2026', f'December 31, {year_text}'.strip()) for c in r] for r in t]
               for t in self.G.RECON_2026Q3]
      res = self._gm(blank)
      self.assertEqual((res.count(), res.recognized), (0, True), year_text)

  def test_vw_adhoc_special_items_and_adjusted_margin(self):
    from lib import quote_check
    doc = base.Doc(0, 'cid', 'VOW3.DE', 'ir', 'guidance', 'ad-hoc', '', '', '', '2026-09-18')
    res = self.V.parse(doc, base.Content(text=self.V.ADHOC))
    got = {g.metric: g for g in res.guidance}
    si, adj = got['special_items'], got['operating_margin_adjusted']
    self.assertEqual((si.low, si.high, si.unit, si.period, si.value_text), (10.0, 10.0, 'billion', 'FY2026', 'around 10 billion'))
    self.assertEqual((adj.low, adj.high, adj.unit, adj.basis, adj.value_text),
                     (4.0, 4.0, 'percent', 'adjusted', 'about 4 percent'))
    self.assertEqual((got['operating_margin'].low, got['operating_margin'].high), (None, 1.0))   # 기존 칸 그대로
    self.assertEqual(base.check_vocab(res), [])
    for g in (si, adj):
      with self.subTest(metric=g.metric):
        self.assertEqual(quote_check.check_row(g, self.V.ADHOC)[0], True)

  def test_direction_for_new_key_compares_values(self):
    """방향 판정은 metric 단위 — 새 키도 같은 규칙(GM 2026-07-21 doc 199 → 2026-10-20 doc 196 대조표 실물 값)."""
    from lib import guidance_direction
    rows = [
      {'id': 1, 'metric': 'eps_diluted', 'period': 'FY2026', 'published_at': '2026-07-21', 'document_id': 199,
       'extractor': 'code', 'low': 8.98, 'high': 10.98, 'value_text': None, 'stated': None, 'unit': 'per_share',
       'currency': 'USD'},
      {'id': 2, 'metric': 'eps_diluted', 'period': 'FY2026', 'published_at': '2026-10-20', 'document_id': 196,
       'extractor': 'code', 'low': 9.72, 'high': 10.72, 'value_text': None, 'stated': None, 'unit': 'per_share',
       'currency': 'USD'},
      {'id': 3, 'metric': 'capex', 'period': 'FY2026', 'published_at': '2026-07-21', 'document_id': 199,
       'extractor': 'code', 'low': 10.0, 'high': 12.0, 'value_text': None, 'stated': None, 'unit': 'billion',
       'currency': 'USD'},
      {'id': 4, 'metric': 'capex', 'period': 'FY2026', 'published_at': '2026-10-20', 'document_id': 196,
       'extractor': 'code', 'low': 10.0, 'high': 12.0, 'value_text': None, 'stated': None, 'unit': 'billion',
       'currency': 'USD'}]
    self.assertEqual(dict(guidance_direction.assign(rows)), {1: 'initiated', 2: 'raised', 3: 'initiated', 4: 'maintained'})


class VwChinaTests(unittest.TestCase):
  """Task 13 — 폭스바겐 중국 동향 숫자. 인도 표 = 2026-10-12 인도 보도자료(doc 1508) 실물 행 그대로 ·
  합작사 문장 = 2026-10-29 9M 실적 보도자료(doc 1507) 브랜드 그룹 표 각주 2) 원문."""
  HEAD = ['Deliveries to customers by  market', 'Jul. - Sep. 2026', 'Jul. - Sep. 2025', 'Delta (%)',
          'Jan. - Sep. 2026', 'Jan. - Sep. 2025', 'Delta (%)']
  MARKET = [HEAD, ['Western Europe', '780,000', '802,900', '-2.8', '2,528,400', '2,501,500', '+1.1'],
            ['Central and Eastern Europe', '135,000', '133,100', '+1.4', '427,600', '406,200', '+5.3'],
            ['North America', '232,700', '246,900', '-5.8', '680,200', '708,800', '-4.0'],
            ['South America', '175,300', '179,700', '-2.4', '502,500', '481,800', '+4.3'],
            ['China', '405,800', '660,300', '-38.5', '1,378,800', '1,974,000', '-30.2'],
            ['Rest of Asia-Pacific', '67,200', '76,800', '-12.4', '212,500', '233,900', '-9.1'],
            ['Middle East/Africa', '89,300', '99,300', '-10.0', '281,000', '298,100', '-5.7'],
            ['World', '1,885,300', '2,198,900', '-14.3', '6,011,000', '6,604,300', '-9.0']]
  # 같은 머리의 BEV 표 — 여기 China(18,000)는 전체 인도 중국 값이 아니다
  BEV = [HEAD, ['Europe', '209,100', '174,800', '+19.6', '586,100', '522,700', '+12.1'],
         ['USA', '5,100', '37,400', '-86.4', '14,900', '68,700', '-78.4'],
         ['China', '18,000', '25,800', '-30.1', '48,900', '85,100', '-42.5'],
         ['Rest of the world', '8,100', '14,100', '-43.0', '28,800', '41,100', '-30.0'],
         ['World', '240,200', '252,100', '-4.7', '678,700', '717,700', '-5.4']]
  JV = ('2) The sales revenue and operating result of the equity-accounted companies in China are not included in the '
        'consolidated figures; the share of the operating result generated by these companies amounted to €-113 (744) '
        'million. 3) In the operating result, mainly intragroup items')

  @classmethod
  def setUpClass(cls):
    from customer_parsers import vw
    cls.V = vw

  def _parse(self, tables, text='', doc_type='sales_release'):
    doc = base.Doc(0, 'cid', 'VOW3.DE', 'ir', doc_type, 'press-release', '', '', '', '2026-10-12')
    return self.V.parse(doc, base.Content(text=text, tables=tables))

  def _vol(self, res):
    return {(v.region, v.period_grain, v.period): v.value for v in res.volume}

  def test_china_row_beside_world(self):
    want = {('total', 'quarter', '2026-Q3'): 1885300, ('total', 'ytd', '2026-9M'): 6011000,
            ('china', 'quarter', '2026-Q3'): 405800, ('china', 'ytd', '2026-9M'): 1378800}
    for tables in ([self.MARKET, self.BEV], [self.BEV, self.MARKET]):   # 표 순서가 바뀌어도 BEV 표 China 를 안 읽는다
      with self.subTest(first=tables[0][1][0]):
        res = self._parse(tables)
        self.assertEqual(self._vol(res), want)   # 다른 시장(North America 등)은 이번 범위 밖 — 행이 없다
        self.assertTrue(all(v.metric == 'deliveries' for v in res.volume))
        self.assertEqual(base.check_vocab(res), [])
        china = next(v for v in res.volume if v.region == 'china')
        self.assertTrue(china.quote.startswith('China'))

  def test_china_label_missing_keeps_world(self):
    """중국 행은 «있으면 뽑는다» — 못 찾아도 World 행은 그대로 · 문서를 failed 로 만들지 않는다."""
    res = self._parse([[r for r in self.MARKET if r[0] != 'China'], self.BEV])
    self.assertTrue(res.recognized)
    self.assertEqual(self._vol(res), {('total', 'quarter', '2026-Q3'): 1885300, ('total', 'ytd', '2026-9M'): 6011000})

  def test_china_q1_quarter_only(self):
    res = self._parse([[['Deliveries to customers by market', 'Jan. - Mar. 2026', 'Jan. - Mar. 2025', 'Delta (%)'],
                        ['China', '480,000', '650,000', '-26.2'], ['World', '2,048,700', '2,133,800', '-4.0']]])
    self.assertEqual(self._vol(res), {('total', 'quarter', '2026-Q1'): 2048700, ('china', 'quarter', '2026-Q1'): 480000})

  def test_china_jv_operating_result(self):
    """브랜드 그룹 표 각주의 합작사 몫 영업 결과 — 기간은 그 표의 그룹 판매(5,880)가 실적 표 누계(9M)와 같을 때만."""
    from lib import quote_check
    text = self.V.OUT_9M + ' ' + self.JV
    res = self._parse([self.V.KPI_Q3, self.V.BRAND], text, 'earnings_release')
    jv = [x for x in res.results if x.metric == 'china_jv_operating_result']
    self.assertEqual(len(jv), 1)
    x = jv[0]
    self.assertEqual((x.value, x.unit, x.currency, x.basis, x.period_grain, x.period),
                     (-113.0, 'million', 'EUR', 'reported', 'ytd', '2026-9M'))
    self.assertIn('china_jv_operating_result', base.METRICS)
    self.assertEqual(base.check_vocab(res), [])
    self.assertEqual(quote_check.check_row(x, text)[0], True)

  def test_china_jv_skipped_when_period_unconfirmed(self):
    """브랜드 표 그룹 판매가 실적 표 누계와 다르거나 브랜드 표가 없으면 그 행만 빠진다(다른 행은 그대로)."""
    other = [*self.V.BRAND[:3], ['Volkswagen Group', '3,997', '4,363', '158,102', '158,364', '5,931', '6,707', '3.8', '4.2']]
    for tables in ([self.V.KPI_Q3, other], [self.V.KPI_Q3]):
      with self.subTest(n=len(tables)):
        res = self._parse(tables, self.V.OUT_9M + ' ' + self.JV, 'earnings_release')
        self.assertFalse(any(x.metric == 'china_jv_operating_result' for x in res.results))
        self.assertEqual(next(x.value for x in res.results if x.metric == 'operating_income'), -5860.0)

  def test_china_jv_needs_china_context(self):
    """'these companies' 가 중국 지분법 회사임을 밝히는 앞 절이 없으면(다른 합작사 설명일 수 있다) 싣지 않는다(Codex 검토)."""
    bare = self.JV.split('; ', 1)[1]   # 'the share of the operating result generated by these companies …' 만 남김
    res = self._parse([self.V.KPI_Q3, self.V.BRAND], self.V.OUT_9M + ' ' + bare, 'earnings_release')
    self.assertFalse(any(x.metric == 'china_jv_operating_result' for x in res.results))


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


class PreliminaryRange202Tests(unittest.TestCase):
  """Task 10 항목 2 — 분기 잠정 «범위»만 낸 EDGAR 8-K Item 2.02(폴라리스 문서 15 · 리비안 문서 117)는 숫자를 기대하지
  않는다(expects_numbers 거짓 → 「서식 미인식」 경고 없음). 근거는 Item 2.02 문단의 실물 문장(제목·items 로는 못 가른다)."""
  # 실물 Item 2.02 문단 앞부분(2026-11-11 EDGAR 원문)
  PII_15 = ('Item 2.02 Results of Operations and Financial Condition. On October 13, 2025, Polaris Inc. (the "Company") '
            'issued a press release announcing its decision to separate the Indian Motorcycle business (the "Indian '
            'Motorcycle Business") from its portfolio and into a standalone business (the "Transaction"). The press '
            'release included the Company\'s preview on its preliminary results for the third quarter ended September '
            '30, 2025. A copy of the Company\'s press release is furnished as Exhibit 99.1. '
            'Item 2.06 Material Impairments. ...')
  RIVN_117 = ('Item 2.02 - Results of Operations and Financial Condition. Set forth below are certain preliminary and '
              'unaudited estimates of selected financial information of Rivian Automotive, Inc. (the "Company") as of '
              'and for the three months ended June 30, 2026.')
  # 정상 실적 8-K — 첨부 보도자료(Item 9.01 뒤)에 'preliminary results' 가 있어도 Item 2.02 문단 밖이라 참
  NORMAL = ('Item 2.02 Results of Operations and Financial Condition. On October 28, 2026, the Company issued a press '
            'release announcing its financial results for the third quarter ended September 30, 2026. '
            'Item 9.01 Financial Statements and Exhibits. Exhibit 99.1 Press release. Revenue was $1.9 billion. '
            'These preliminary results are unaudited.')

  def _doc(self, ticker, items='2.02,9.01'):
    return base.Doc(0, 'test', ticker, 'edgar', 'earnings_release', '8-K', items, '8-K', '', '2026-10-28')

  def test_preliminary_range_202_not_expected(self):
    from customer_parsers import polaris, rivian
    for mod, ticker, text, items in ((polaris, 'PII', self.PII_15, '2.02,2.06,5.02,9.01'),
                                     (rivian, 'RIVN', self.RIVN_117, '2.02')):
      with self.subTest(ticker=ticker):
        self.assertFalse(mod.expects_numbers(self._doc(ticker, items), base.Content(text=text)))
        self.assertTrue(mod.expects_numbers(self._doc(ticker), base.Content(text=self.NORMAL)))
        # 2.02 가 없는 8-K(임원 변경 등)는 원래대로 거짓
        self.assertFalse(mod.expects_numbers(self._doc(ticker, '5.02,9.01'), base.Content(text=self.NORMAL)))


if __name__ == '__main__':
  unittest.main()
