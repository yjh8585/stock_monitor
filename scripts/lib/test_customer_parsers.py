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
