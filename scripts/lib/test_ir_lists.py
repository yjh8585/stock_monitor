"""lib/ir_lists.py 시험 — 회사별 IR 목록 «응답 → 행» 순수 함수 + 날짜 채우기 + GM 시험 판정 + 수집기 연결(네트워크·DB 없음).

픽스처 = 2026-11-09 실물 응답을 잘라 둔 것(fixtures/ir_lists/). 회사마다 MUST_HIT(반드시 나와야 할 행)와
MUST_MISS(홍보 글 등 — 버려져야 할 제목)를 둔다. 매칭이 죽어도 「0건」은 화면에서 정상처럼 보여 양방향으로 박는다.

실행:
  PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_ir_lists.py -q
"""
import importlib.util
import json
import pathlib
import sys
import unicodedata
import unittest
from unittest.mock import MagicMock, patch

import requests

_SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_SCRIPTS))

from lib import ir_lists as L  # noqa: E402

FIX = pathlib.Path(__file__).resolve().parent / 'fixtures' / 'ir_lists'
_ROW_KEYS = {'source', 'source_id', 'doc_type', 'form', 'items', 'title', 'url', 'published_at'}
_DOC_TYPES = {'earnings_release', 'presentation', 'shareholder_letter', 'periodic', 'current_report', 'prelim_results',
              'sales_release', 'guidance', 'ir_event', 'fact_sheet', 'investor_day', 'other'}  # DB CHECK 와 같음


def _text(name: str) -> str:
  return (FIX / name).read_text(encoding='utf-8')


def _json(name: str):
  return json.loads(_text(name))


def _rows(company: str) -> list[dict]:
  if company == 'vw':  # RSS 는 어댑터처럼 바이트로
    return L.parse_vw((FIX / 'vw_rss.xml').read_bytes(), _text('vw_results.html'), _text('vw_adhoc.html'))
  if company == 'porsche':
    return L.parse_porsche(_json('porsche_feed.json'))
  if company == 'polaris':
    return L.parse_polaris(_json('polaris_reports.json')['GetFinancialReportListResult'],
                           _json('polaris_events.json')['GetEventListResult'])
  if company == 'hyundai':
    return L.parse_hyundai(_json('hyundai_2026.json'), 2026)
  if company == 'kia':
    return L.parse_kia(_json('kia_2026.json'))
  if company == 'mobis':
    return L.parse_mobis(_text('mobis_2026.html'))
  if company == 'kgm':
    return L.parse_kgm(_json('kgm_dataroom.json'))
  raise KeyError(company)


# (제목 일부, doc_type, published_at) — published_at None 이면 `_quarter` 로 나와야 한다(수집기가 DART 로 채운다)
MUST_HIT = {
  'vw': [
    # 요약서 예시는 2026-10-30 이었으나 RSS 실물 pubDate 는 「Thu, 29 Oct 2026」 — 실물을 따른다
    ('Volkswagen Group: Nine-month results underline urgent need for action', 'earnings_release', '2026-10-29'),
    ('Volkswagen Group delivers 6 million vehicles through September', 'sales_release', '2026-10-12'),
    ('Volkswagen AG updates its forecast for fiscal year 2026', 'guidance', '2026-09-18'),
    # 제목에 results 가 없지만 실적 행렬의 Q1 보도자료 — 행렬이 종류를 정한다
    ('First Quarter: Volkswagen Group makes progress', 'earnings_release', '2026-04-30'),
    ('Presentation 2026 Q3', 'presentation', '2026-10-29'),
    ('Interim Report / Annual Report 2026 Q3', 'periodic', '2026-10-29'),
    ('Presentation 2025 Q4', 'presentation', '2026-03-10'),  # AMC 열 = 전년 연간
  ],
  'porsche': [
    ('Porsche AG systematically implements its strategic realignment', 'earnings_release', '2026-10-27'),
    ('Porsche delivers 178,532 cars worldwide', 'sales_release', '2026-10-09'),
    ('Expected decline in sales due to limited product availability', 'sales_release', '2026-04-10'),  # 1분기 인도
    ('Porsche delivers 279,449 sports cars', 'sales_release', '2026-01-16'),  # EQS-Media
    ('Porsche completes sale of its stakes in Bugatti Rimac', 'guidance', '2026-09-09'),  # 전망 상향이 일반 뉴스로
  ],
  'polaris': [
    ('Third Quarter 2026 Presentation', 'presentation', '2026-10-27'),
    ('Fourth Quarter 2025 Presentation', 'presentation', '2026-01-27'),
    ('Polaris Presents at Raymond James Conference', 'investor_day', '2026-03-03'),
  ],
  'hyundai': [
    ('2026년 3분기 가이던스 자료', 'guidance', None),
    ('2026년 3분기 경영실적 발표자료', 'presentation', None),
  ],
  'kia': [('2026년 3분기 경영실적', 'presentation', '2026-10-30')],
  'mobis': [('2026년 3분기 경영실적', 'presentation', None)],
  'kgm': [
    ('2025년 3분기 경영실적 발표 - (2025.10.29)', 'presentation', '2025-10-29'),  # 제목 날짜 > 올린 날(2025-12-01)
    ('2025년 3분기 경영실적 보도자료', 'earnings_release', '2025-10-30'),  # 연도 없는 제목엔 묶음 연도를 붙인다
    # 제목 날짜 없음 + 2026 보도자료 없음 → 보류(올린 날 2026-04-24 를 쓰지 않는다)
    ('2026년 1분기 경영실적', 'presentation', None),
    ('2026년 2분기 경영실적', 'presentation', None),
  ],
}

MUST_MISS = {
  'vw': ['Automated vehicle logistics put to the test'],  # 홍보 글
  'porsche': ['Porsche Mission S', 'Preliminary announcement of the publication',  # 홍보 · EQS-AFR
              'Porsche sells MHP', 'Possible changes in the Executive Board'],  # 매각(인도 낱말만) · 인사 ad-hoc
  'polaris': ['Annual Meeting', 'Press Release', 'Transcript'],
  'hyundai': ['4분기'],  # isUpcoming — 파일 없음
  'kia': ['AOD', '판매실적', '지역별수출실적'],
  'mobis': ['웹캐스트'],
  'kgm': ['판매실적', '영업보고서'],
}


class MustHitMissTest(unittest.TestCase):
  def test_must_hit(self):
    for company, hits in MUST_HIT.items():
      rows = _rows(company)
      for title, doc_type, published in hits:
        with self.subTest(company=company, title=title):
          found = [r for r in rows if title in r['title']]
          self.assertTrue(found, f'{company}: {title} 없음')
          self.assertEqual(found[0]['doc_type'], doc_type)
          self.assertEqual(found[0]['published_at'], published)
          if published is None:
            self.assertRegex(found[0]['_quarter'], r'^\d{4}-Q[1-4]$')

  def test_must_miss(self):
    for company, misses in MUST_MISS.items():
      titles = [r['title'] for r in _rows(company)]
      for m in misses:
        with self.subTest(company=company, miss=m):
          self.assertFalse([t for t in titles if m in t], f'{company}: 버려야 할 {m} 이 나왔다')

  def test_row_shape(self):
    """customer_documents 칸만(+ 수집기가 지우는 _quarter·_wait) · 파싱 상태 칸 금지 · doc_type 은 DB CHECK 안."""
    for company in MUST_HIT:
      for r in _rows(company):
        with self.subTest(company=company, source_id=r['source_id']):
          self.assertEqual(set(r) - {'_quarter', '_wait'}, _ROW_KEYS)
          self.assertEqual(r['source'], 'ir')
          self.assertIn(r['doc_type'], _DOC_TYPES)
          self.assertTrue(r['url'].startswith('https://'))
          self.assertNotIn('?', r['source_id'])
          self.assertEqual(r['source_id'], L.ir_source_id(r['url']))  # 키는 한 함수에서만
          self.assertTrue(r['title'])
          self.assertEqual(r['title'], unicodedata.normalize('NFC', r['title']))  # 기아 2·3분기 제목이 NFD 실물
      ids = [r['source_id'] for r in _rows(company)]
      self.assertEqual(len(ids), len(set(ids)), f'{company}: source_id 중복')


class VwTest(unittest.TestCase):
  def test_rss_and_matrix_merge_into_one(self):
    """같은 보도자료가 RSS·행렬 둘 다에 있다 — source_id(URL 경로)로 하나."""
    rows = [r for r in _rows('vw') if r['source_id'].endswith('-20799')]
    self.assertEqual(len(rows), 1)
    self.assertEqual(rows[0]['form'], 'financial-results')

  def test_matrix_cell_without_rss_date_waits_for_quarter(self):
    """RSS(약 2년)에 없는 열은 날짜를 지어내지 않고 _quarter 로 낸다 — 수집기가 범위 밖으로 거른다."""
    row = next(r for r in _rows('vw') if r['title'] == 'Press Release 2025 Q1')
    self.assertIsNone(row['published_at'])
    self.assertEqual((row['_quarter'], row['_wait']), ('2025-Q1', 'rss'))

  def test_events_only_results(self):
    paths = L.parse_vw_events(_text('vw_events.html'))
    self.assertTrue(paths)
    self.assertTrue(all(p.endswith('/ics') for p in paths))
    self.assertFalse([p for p in paths if 'ubs-european' in p or 'annual-general' in p])

  def test_ics(self):
    self.assertEqual(L.parse_vw_ics(_text('vw_q1_2027.ics')),
                     {'period': '2027-Q1', 'event_date': '2027-04-29',
                      'quote': 'DTSTART;VALUE=DATE:20270429\nSUMMARY:Interim Report January – March 2027'})
    self.assertEqual(L.parse_vw_ics(_text('vw_amc_2027.ics'))['period'], '2026-FY')  # 3월 연차 회견 = 전년 연간
    self.assertEqual(L.parse_vw_ics(_text('vw_h1_2027.ics'))['period'], '2027-Q2')
    self.assertIsNone(L.parse_vw_ics('BEGIN:VEVENT\nDTSTART;VALUE=DATE:20261111\nSUMMARY:UBS Conference\nEND:VEVENT'))

  def test_ics_without_charset_decoded_as_utf8(self):
    """실물 ICS 응답은 charset 이 없다 — .text(Latin-1)로 읽으면 en dash 가 깨져 Q1·Q3 일정이 조용히 빠졌다."""
    def resp(body: bytes, ctype: str) -> requests.Response:
      r = requests.Response()
      r.status_code, r._content, r.headers['Content-Type'] = 200, body, ctype
      r.encoding = requests.utils.get_encoding_from_headers(r.headers)  # 실제 어댑터처럼 — text/* 무 charset = Latin-1
      return r
    pages = {L.VW_EVENTS: resp(_text('vw_events.html').encode('utf-8'), 'text/html; charset=utf-8')}
    ics = (FIX / 'vw_q1_2027.ics').read_bytes()
    with patch.object(L, '_fetch', side_effect=lambda s, url, **kw: pages.get(url) or resp(ics, 'text/calendar')):
      got = L.fetch_vw_dates(MagicMock(), '2026-01-01')
    self.assertTrue(got)
    self.assertTrue(all(d['period'] == '2027-Q1' for d in got))


class PolarisTest(unittest.TestCase):
  def test_earnings_dates(self):
    dates = {d['period']: d for d in L.parse_polaris_dates(_json('polaris_events.json')['GetEventListResult'])}
    self.assertEqual(dates['2026-Q3']['event_date'], '2026-10-27')
    self.assertEqual(dates['2025-FY']['event_date'], '2026-01-27')  # 「Q4 & FY 2025」 = 연간
    self.assertNotIn('2025-Q4', dates)
    self.assertIn('Q3 2026 Earnings Call', dates['2026-Q3']['quote'])
    self.assertTrue(all(d['source'] == 'ir' for d in dates.values()))

  def test_q4_report_stays_q4_in_documents(self):
    """문서 쪽 분기 키는 Q4 그대로(일정만 FY) — 4분기 발표자료가 4분기 콜 날짜를 받는다."""
    row = next(r for r in _rows('polaris') if 'Fourth Quarter 2025' in r['title'])
    self.assertEqual(row['published_at'], '2026-01-27')

  def test_every_matched_call_event_is_a_call(self):
    """한 분기에 실적 콜 이벤트가 둘이면(다시 듣기 등) 둘 다 콜 — investor_day 로 새지 않고 날짜는 이른 것."""
    events = _json('polaris_events.json')['GetEventListResult']
    replay = {'Title': 'Polaris Q3 2026 Earnings Call Replay', 'StartDate': '10/30/2026 08:00:00', 'EventId': 9999,
              'Attachments': [{'Title': 'Presentation', 'Url': 'https://ir.polaris.com/replay-deck.pdf'}]}
    reports = _json('polaris_reports.json')['GetFinancialReportListResult']
    rows = L.parse_polaris(reports, [replay] + events)  # 늦은 이벤트를 앞에 둬도
    self.assertFalse([r for r in rows if 'Replay' in r['title']])
    dates = {d['period']: d for d in L.parse_polaris_dates([replay] + events)}
    self.assertEqual(dates['2026-Q3']['event_date'], '2026-10-27')
    q3 = next(r for r in rows if 'Third Quarter 2026' in r['title'])
    self.assertEqual(q3['published_at'], '2026-10-27')

  def test_api_key_is_documented_public(self):
    """공개 키라는 주석이 상수 옆에 있어야 한다(비밀로 오해해 .env 로 옮기거나, 반대로 다른 키를 박지 않게)."""
    src = (pathlib.Path(L.__file__)).read_text(encoding='utf-8')
    self.assertIn('공개 키', src[:src.index('PII_Q4_API_KEY =')])


class DatesTest(unittest.TestCase):
  PRELIMS = [
    {'title': '연결재무제표기준영업(잠정)실적(공정공시)', 'published_at': '2026-10-29'},
    {'title': '영업(잠정)실적(공정공시)', 'published_at': '2026-11-02'},  # 월 판매 — 분기 실적 아님
    {'title': '[기재정정]연결재무제표기준영업(잠정)실적(공정공시)', 'published_at': '2026-10-30'},
    {'title': '연결재무제표기준영업(잠정)실적(공정공시)', 'published_at': '2026-01-29'},
  ]

  def test_quarter_dates_consolidated_only_and_earliest(self):
    self.assertEqual(L.quarter_dates(self.PRELIMS), {'2026-Q3': '2026-10-29', '2025-Q4': '2026-01-29'})

  def test_resolve_fills_holds_and_drops(self):
    rows = _rows('hyundai')  # 2026 Q1·Q2·Q3 발표자료 + Q3 가이던스 — 전부 _quarter
    got, held = L.resolve_dates(rows, L.quarter_dates(self.PRELIMS), '2026-01-01')
    self.assertEqual({r['title']: r['published_at'] for r in got},
                     {'2026년 3분기 경영실적 발표자료': '2026-10-29', '2026년 3분기 가이던스 자료': '2026-10-29'})
    self.assertEqual(held, {'dart': 2})  # Q1·Q2 = DART 날짜 없음 → 버리지 않고 보류로 센다
    self.assertTrue(all('_quarter' not in r and '_wait' not in r for r in got))
    self.assertTrue(all('_quarter' in r for r in rows))  # 입력은 바꾸지 않는다

  def test_resolve_old_quarter_is_out_of_range_not_held(self):
    rows = [L._row('presentation', 'x', 'https://a.example/x.pdf', None, 'f', quarter='2024-Q1')]
    self.assertEqual(L.resolve_dates(rows, {}, '2025-10-01'), ([], {}))

  def test_resolve_since_filter(self):
    rows = [L._row('presentation', 'x', 'https://a.example/x.pdf', '2025-01-01', 'f')]
    self.assertEqual(L.resolve_dates(rows, {}, '2025-06-01'), ([], {}))

  def test_resolve_only_dart_wait_reads_dart(self):
    """보도자료·RSS·콜을 기다리는 행은 DART 날짜로 채우지 않는다(근거가 다른 날짜를 섞지 않는다)."""
    rows = [L._row('presentation', 'x', 'https://a.example/x.pdf', None, 'f', quarter='2026-Q3', wait='press')]
    self.assertEqual(L.resolve_dates(rows, {'2026-Q3': '2026-10-29'}, '2026-01-01'), ([], {'press': 1}))

  def test_resolve_counts_rows_without_quarter_or_date(self):
    """분기도 날짜도 없는 행 = 안 풀리는 «날짜 없음» — 기다리는 보류와 따로 센다."""
    rows = [L._row('presentation', 'x', 'https://a.example/x.pdf', None, 'f')]
    self.assertEqual(L.resolve_dates(rows, {}, '2026-01-01'), ([], {L.NO_DATE: 1}))
    self.assertEqual(set(L.HOLD_REASONS), {'dart', 'press', 'rss', 'call'})


class SourceIdTest(unittest.TestCase):
  def test_host_and_path_without_query(self):
    self.assertEqual(L.ir_source_id('https://ir.polaris.com/a/b.pdf?v=3#p2'), 'ir.polaris.com/a/b.pdf')

  def test_mobis_keys_on_file_name(self):
    """모비스 다운로드는 경로가 전부 같고 fileId 가 요청마다 바뀐다 — fileNm 이 키, 없으면 멈춘다."""
    a = L.ir_source_id('https://www.mobis.com/cmm/fms/PdfFileDown.do?fileId=1&fileNm=A_2026.pdf')
    b = L.ir_source_id('https://www.mobis.com/cmm/fms/PdfFileDown.do?fileId=2&fileNm=A_2026.pdf')
    self.assertEqual(a, b)
    self.assertEqual(a, 'www.mobis.com/cmm/fms/A_2026.pdf')
    with self.assertRaises(ValueError):
      L.ir_source_id('https://www.mobis.com/cmm/fms/PdfFileDown.do?fileId=1')

  def test_mobis_rows_carry_file_name_in_url(self):
    rows = _rows('mobis')
    self.assertTrue(rows)
    self.assertTrue(all('fileNm=' in r['url'] for r in rows))
    self.assertEqual(len({r['source_id'] for r in rows}), len(rows))


class EmptySubListTest(unittest.TestCase):
  """하위 목록 하나가 0건이면 그 목록 이름을 실은 EmptyListError — 상태 표 사유로 그대로 나간다."""

  def assertEmpty(self, label: str, fn, *args):
    with self.assertRaises(L.EmptyListError) as cm:
      fn(*args)
    self.assertEqual(str(cm.exception), f'{label} 0건')

  def test_vw(self):
    rss, res, adhoc = (FIX / 'vw_rss.xml').read_bytes(), _text('vw_results.html'), _text('vw_adhoc.html')
    self.assertEmpty('VW 보도자료 RSS', L.parse_vw, b'<rss><channel></channel></rss>', res, adhoc)
    self.assertEmpty('VW 실적 행렬', L.parse_vw, rss, '<html><h2 id="financial-results-2026"></h2></html>', adhoc)
    self.assertEmpty('VW ad-hoc', L.parse_vw, rss, res, '<html></html>')
    self.assertEmpty('VW 실적 일정', L.parse_vw_events, '<html><a href="/en/events/ubs/ics">x</a></html>')

  def test_vw_results_ics_that_does_not_parse(self):
    """실적 일정 경로인데 기간을 못 읽으면(제목 꼴 변경) 조용히 빠지지 않고 멈춘다."""
    def resp(body: bytes) -> requests.Response:
      r = requests.Response()
      r.status_code, r._content = 200, body
      return r
    page = b'<a href="/en/events/interim-report-january-march-2028-9/ics">x</a>'
    ics = b'BEGIN:VEVENT\nDTSTART;VALUE=DATE:20280428\nSUMMARY:Q1 2028 statement\nEND:VEVENT'
    with patch.object(L, '_fetch', side_effect=lambda s, url, **kw: resp(page if url == L.VW_EVENTS else ics)):
      with self.assertRaises(L.EmptyListError) as cm:
        L.fetch_vw_dates(MagicMock(), '2026-01-01')
    self.assertEqual(str(cm.exception), 'VW 실적 일정 ICS 해석 실패')

  def test_polaris(self):
    reports = _json('polaris_reports.json')['GetFinancialReportListResult']
    events = _json('polaris_events.json')['GetEventListResult']
    self.assertEmpty('Polaris 재무 보고', L.parse_polaris, [], events)
    self.assertEmpty('Polaris 이벤트', L.parse_polaris, reports, [])
    self.assertEmpty('Polaris 실적 콜 이벤트', L.parse_polaris_dates, [e for e in events if 'Earnings' not in e['Title']])

  def test_kgm(self):
    full = _json('kgm_dataroom.json')
    for name, label in (('releaseList', 'KGM 발표자료(releaseList)'),
                        ('managementList', 'KGM 경영실적 보도자료(managementList)')):
      with self.subTest(name=name):
        payload = json.loads(json.dumps(full))
        payload['body'][name] = []
        self.assertEmpty(label, L.parse_kgm, payload)


class EmptyYearTest(unittest.TestCase):
  """자료가 없는 해(1월의 새해 등)는 정상 0건 — 2026-11-09 실측 2027 응답 그대로."""

  def test_hyundai(self):
    self.assertEqual(L.parse_hyundai({'data': [], 'resultCode': '0000'}, 2027), [])

  def test_kia(self):
    self.assertEqual(L.parse_kia({'status': 400, 'error': {'message': 'index list not found'}}), [])
    with self.assertRaises(ValueError):  # 다른 오류 본문은 조용히 0건으로 넘기지 않는다
      L.parse_kia({'status': 500, 'error': {'message': 'internal'}})

  def test_mobis(self):
    self.assertEqual(L.parse_mobis('<table><tbody></tbody></table>'), [])


class KgmDateTest(unittest.TestCase):
  def _with_press(self, title: str, stamp: str) -> dict:
    payload = _json('kgm_dataroom.json')
    payload['body']['managementList'].insert(0, {'date': '2026', 'fileList': [
      {'fileNm': title, 'fileUrl': f'https://web.kg-mobility.com/file/x/{stamp}000_abc.pdf'}]})
    return payload

  def test_2026_q2_waits_for_press_release(self):
    """2026 2분기 발표자료 = 제목 날짜 없음 · 같은 분기 보도자료 없음 → 보류(올린 날 2026-09-11 을 쓰지 않는다)."""
    row = next(r for r in _rows('kgm') if r['title'] == '2026년 2분기 경영실적')
    self.assertIsNone(row['published_at'])
    self.assertEqual((row['_quarter'], row['_wait']), ('2026-Q2', 'press'))

  def test_2026_q2_takes_same_quarter_press_date(self):
    rows = L.parse_kgm(self._with_press('2분기 경영실적 보도자료', '20260723110000'))
    row = next(r for r in rows if r['title'] == '2026년 2분기 경영실적')
    self.assertEqual(row['published_at'], '2026-07-23')

  def test_title_date_beats_press(self):
    rows = L.parse_kgm(self._with_press('3분기 경영실적 보도자료', '20251031110000'))
    row = next(r for r in rows if r['title'].startswith('2025년 3분기 경영실적 발표'))
    self.assertEqual(row['published_at'], '2025-10-29')

  def test_hold_and_no_date_counts(self):
    """2026 1·2·3분기 = 보도자료 대기 · Pressday·CEO IR설명회 = 분기도 날짜도 없음(싣지 않고 센다)."""
    got, holds = L.resolve_dates(_rows('kgm'), {}, '2026-01-01')
    self.assertEqual(holds, {'press': 3, L.NO_DATE: 2})
    self.assertFalse([r for r in got if r['title'].startswith('2026년')])


class GmProbeTest(unittest.TestCase):
  def test_status(self):
    self.assertEqual(L.gm_probe_status([403, 403]), ('blocked', L.GM_BLOCKED_REASON))
    self.assertEqual(L.gm_probe_status([403, 200]), ('ok', None))
    self.assertEqual(L.gm_probe_status([200]), ('ok', None))
    self.assertEqual(L.gm_probe_status([503, None]), ('error', 'GM IR 사이트 접근 실패(HTTP 503)'))
    self.assertEqual(L.gm_probe_status([None, None]), ('error', 'GM IR 사이트 접근 실패(연결 안 됨)'))
    # 최종 검토 P12 — 401 도 차단(BLOCKED_HTTP 한곳) · 사유의 상태 숫자는 실제 값
    self.assertEqual(L.gm_probe_status([401, None]),
                     ('blocked', L.GM_BLOCKED_REASON.replace('HTTP 403', 'HTTP 401')))

  def test_blocked_codes_single_source(self):
    """차단 코드는 lib.ir_lists.BLOCKED_HTTP 한곳 — 숫자 수집기도 같은 튜플을 쓴다(P12)."""
    self.assertEqual(L.BLOCKED_HTTP, (401, 403))
    ccn_spec = importlib.util.spec_from_file_location('ccn_p12', _SCRIPTS / 'collect_customer_numbers.py')
    ccn = importlib.util.module_from_spec(ccn_spec)
    ccn_spec.loader.exec_module(ccn)
    self.assertIs(ccn._BLOCKED_CODES, L.BLOCKED_HTTP)

  def test_reason_sentence(self):
    """화면(Task 14)에 그대로 나가는 문장 — 요약서 원문과 글자까지 같아야 한다."""
    self.assertEqual(L.GM_BLOCKED_REASON,
                     'GM IR 사이트가 자동 접근을 막아(HTTP 403) 실적 발표자료·미국 분기 소매 판매를 못 모읍니다')

  def test_gm_has_no_adapter(self):
    self.assertNotIn('GM', L.IR_LISTS)

  def test_exit_code(self):
    """차단은 알려진 상태(0) · 그 밖의 실패는 워크플로에서 눈에 띄게(1)."""
    self.assertEqual([L.gm_probe_exit(s) for s in ('ok', 'blocked', 'error')], [0, 0, 1])


# ── 수집기 연결(collect_customer_docs.py) ─────────────────────────────────────

_p = _SCRIPTS / 'collect_customer_docs.py'
_spec = importlib.util.spec_from_file_location('ccd_ir', _p)
ccd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ccd)


class CollectorWiringTest(unittest.TestCase):
  VW = {'id': 'u-vw', 'ticker': 'VOW3.DE', 'sec_cik': None, 'dart_corp_code': None}
  HMC = {'id': 'u-hmc', 'ticker': '005380', 'sec_cik': None, 'dart_corp_code': '00000002'}

  def test_ir_only_company_gets_ir_source(self):
    self.assertEqual([s[0] for s in ccd.sources(self.VW, '2026-01-01', '2026-11-09')], ['ir_list'])

  def test_ir_after_dart(self):
    """IR 날짜 채우기가 DART 적재분을 읽는다 — DART 가 먼저."""
    self.assertEqual([s[0] for s in ccd.sources(self.HMC, '2026-01-01', '2026-11-09')], ['dart_list', 'ir_list'])

  def test_ir_rows_resolve_and_company_id(self):
    client = MagicMock()
    chain = client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value
    chain.execute.return_value.data = DatesTest.PRELIMS
    with patch.dict(ccd.ir_lists.IR_LISTS, {'005380': lambda s, since: _rows('hyundai')}):
      fetch = dict((c, f) for c, _, f in ccd.sources(self.HMC, '2026-01-01', '2026-11-09', client))['ir_list']
      rows = fetch(MagicMock())
    self.assertEqual(len(rows), 2)
    self.assertTrue(all(r['company_id'] == 'u-hmc' and r['published_at'] == '2026-10-29' for r in rows))
    self.assertTrue(all(set(r) == _ROW_KEYS | {'company_id'} for r in rows))
    with patch.object(ccd, '_db') as db:
      ccd.store(rows)  # 금지 칸 없음 → 통과
      db.return_value.upsert_rows.assert_called_once()

  def test_ir_empty_list_is_error(self):
    with patch.dict(ccd.ir_lists.IR_LISTS, {'VOW3.DE': lambda s, since: []}):
      fetch = ccd.sources(self.VW, '2026-01-01', '2026-11-09')[0][2]
      with self.assertRaises(ccd.EmptyListError) as cm:
        fetch(MagicMock())
    self.assertEqual(ccd.failure_status('IR', cm.exception), ('error', 'IR 목록 0건'))

  def test_sub_list_empty_reason_reaches_status(self):
    """어댑터 안의 하위 목록 0건도 같은 클래스 — 목록 이름이 상태 사유로 그대로 나간다."""
    self.assertIs(ccd.EmptyListError, L.EmptyListError)
    self.assertEqual(ccd.failure_status('IR', L.EmptyListError('VW ad-hoc 0건')), ('error', 'VW ad-hoc 0건'))

  def test_hold_messages_distinguish_waiting_from_never(self):
    client = MagicMock()
    rows = [L._row('presentation', '2026년 2분기', 'https://a.example/q2.pdf', None, 'f', quarter='2026-Q2'),
            L._row('presentation', 'Pressday', 'https://a.example/p.pdf', None, 'f'),
            L._row('presentation', 'ok', 'https://a.example/ok.pdf', '2026-05-01', 'f')]
    with patch.dict(ccd.ir_lists.IR_LISTS, {'VOW3.DE': lambda s, since: rows}), patch('builtins.print') as out:
      got = ccd.ir_rows(MagicMock(), self.VW, '2026-01-01', client)
    self.assertEqual([r['title'] for r in got], ['ok'])
    printed = '\n'.join(c.args[0] for c in out.call_args_list)
    self.assertIn('날짜 보류 1건 — 같은 분기 DART 연결 잠정실적 공시가 아직 없다(다음 실행에 다시 본다)', printed)
    self.assertIn('날짜 없음 1건', printed)
    self.assertIn('다음 실행에도 안 풀린다', printed)

  def test_earnings_dates_failure_keeps_document_status(self):
    """일정 받기가 깨져도 문서는 실리고 상태는 문서 기준 그대로 — 사유에 일정 실패만 덧붙는다."""
    rows = [{'company_id': 'u-vw', **L._row('presentation', 'x', 'https://a.example/x.pdf', '2026-05-01', 'f')}]

    def broken(session, since):
      raise L.EmptyListError('VW 실적 일정 0건')
    ws = MagicMock()
    with patch.object(ccd, 'sources', return_value=[('ir_list', 'IR', lambda s: rows)]), \
         patch.object(ccd, 'count_new', return_value=1), patch.object(ccd, 'store') as store, \
         patch.dict(ccd.ir_lists.IR_EARNINGS_DATES, {'VOW3.DE': broken}), \
         patch.object(ccd, 'write_status') as ws_call, patch('builtins.print'):
      errors = ccd._run([self.VW], '2026-01-01', '2026-11-09', MagicMock(), MagicMock(), ws, dry_run=False)
    store.assert_called_once()
    self.assertEqual(ws_call.call_args.args[2:], ('ir_list', 'ok', '실적 일정 실패: VW 실적 일정 0건'))
    self.assertEqual(errors, 1)

  def test_sync_earnings_dates_skips_known(self):
    client = MagicMock()
    chain = client.table.return_value.select.return_value.eq.return_value
    chain.execute.return_value.data = [{'period': '2026-Q3', 'event_date': '2026-10-27'}]
    rows = [{'period': '2026-Q3', 'event_date': '2026-10-27', 'quote': 'q', 'source': 'ir', 'source_ref': '1', 'url': None},
            {'period': '2027-Q1', 'event_date': '2027-04-29', 'quote': 'q', 'source': 'ir', 'source_ref': '2', 'url': None}]
    with patch.object(ccd, '_db') as db:
      self.assertEqual(ccd.sync_earnings_dates(client, 'u-vw', rows, dry_run=True), 1)
      db.return_value.upsert_rows.assert_not_called()
      self.assertEqual(ccd.sync_earnings_dates(client, 'u-vw', rows, dry_run=False), 1)
      table, sent, conflict = db.return_value.upsert_rows.call_args.args
    self.assertEqual((table, conflict), ('customer_earnings_dates', 'company_id,period'))
    self.assertEqual([(r['company_id'], r['period']) for r in sent], [('u-vw', '2027-Q1')])
    self.assertRegex(sent[0]['published_at'], r'^\d{4}-\d{2}-\d{2}$')


if __name__ == '__main__':
  unittest.main()
