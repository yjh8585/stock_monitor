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
    return L.parse_vw((FIX / 'vw_rss.xml').read_bytes(), _text('vw_results.html'), _text('vw_adhoc.html'),
                      _text('vw_deliveries.html'), _json('vw_gallery.json'))
  if company == 'porsche':
    return L.parse_porsche_all(_json('porsche_feed.json'), _text('porsche_reports.html'))
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
  if company == 'vinfast':  # 회사 소개 자료 날짜 = PDF 만든 날(2026-11-10 실물 메타데이터)
    return L.parse_vinfast(_text('vinfast_reports.html'), _text('vinfast_mobility_day.html'), '2026-11-09')
  if company == 'rivian':
    nd = _json('rivian_next_data.json')
    return L.parse_rivian(nd['investors'], nd['events'])
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
    # 발표자료 갤러리(2026-11-10 실물) — 타일 날짜 그대로
    ('Volkswagen Group 9M Roadshow Presentation', 'presentation', '2026-11-05'),
    ('Volkswagen Group 9M 2026 Pre-Close Call', 'presentation', '2026-10-13'),
    ('China Investor Update 2026 - China Product Strategy', 'investor_day', '2026-04-23'),
    ('Bridge to 2030 Targets', 'investor_day', '2026-10-12'),
    ('Battery Strategy Europe', 'investor_day', '2026-10-12'),  # 제목엔 목표 낱말이 없다 — 같은 날 목표 발표로 묶는다
    ('Volkswagen Group Factbook 2026', 'fact_sheet', '2026-05-05'),
    # 1분기 인도 보도자료 — 제목에 deliver 가 없다. 인도 표 페이지의 같은 날 표가 근거
    ('Volkswagen Group maintains stable market share in declining global market in Q1', 'sales_release', '2026-04-13'),
  ],
  'porsche': [
    ('Porsche AG systematically implements its strategic realignment', 'earnings_release', '2026-10-27'),
    ('Porsche delivers 178,532 cars worldwide', 'sales_release', '2026-10-09'),
    ('Expected decline in sales due to limited product availability', 'sales_release', '2026-04-10'),  # 1분기 인도
    ('Porsche delivers 279,449 sports cars', 'sales_release', '2026-01-16'),  # EQS-Media
    ('Porsche completes sale of its stakes in Bugatti Rimac', 'guidance', '2026-09-09'),  # 전망 상향이 일반 뉴스로
    # 보고서 표(열 = 분기 · 날짜 없음) — 같은 분기 EQS 실적 보도일
    ('Fact Sheet Q4 & Full Year 2025', 'fact_sheet', '2026-03-11'),
    ('Presentation Q3 2026', 'presentation', '2026-10-27'),
    ('Pre-Close Call Presentation Q3 2026', 'presentation', '2026-10-27'),
    ('Presentation H1 2026', 'presentation', None),  # 피드 픽스처에 2분기 실적 보도가 없다 → 보류
    ('Capital Markets Day 2026', 'investor_day', '2026-10-07'),
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
  # 2026-11-10 실물. 분기 보고서는 날짜 칸이 없다 → EDGAR 실적 문서 접수일(wait='edgar')
  'vinfast': [
    ('VinFast Earnings Report Q2/2026', 'shareholder_letter', None),
    ('VinFast Earnings Report Q4/2025', 'shareholder_letter', None),
    ('VinFast Corporate Presentation (2026.11.-corporate-presentation)', 'presentation', '2026-11-09'),
    ('VinFast 2025 Mobility Day Presentation', 'investor_day', '2025-11-10'),  # 제목 연도 + 날짜 칸 11/10
  ],
  'rivian': [
    ('Rivian Q3 2026 Shareholder Presentation', 'shareholder_letter', None),
    ('Rivian Q4 2025 Shareholder Letter', 'shareholder_letter', None),  # 「Q4 & Full Year」 블록
    ('Inaugural Autonomy & AI Day (Presentation)', 'investor_day', '2025-12-11'),
    ('Rivian 2024 Investor Day (Presentation)', 'investor_day', '2024-06-27'),
    ('Rivian and Volkswagen Group Announce the Launch of their Joint Venture (Shareholder Letter)', 'investor_day',
     '2024-11-12'),  # VW 합작 덱 — 실물 라벨이 「Shareholder Letter」
  ],
}

MUST_MISS = {
  # 홍보 글 · 갤러리의 실적 콜 발표자료(실적 행렬의 'Presentation 2026 Q3' 와 같은 문서 — 하나로)
  'vw': ['Automated vehicle logistics put to the test', '9M 2026 Investor, Analyst and Media Call'],
  'porsche': ['Porsche Mission S', 'Preliminary announcement of the publication',  # 홍보 · EQS-AFR
              'Porsche sells MHP', 'Possible changes in the Executive Board',  # 매각(인도 낱말만) · 인사 ad-hoc
              'Icons of Porsche'],  # 다른 탭(날짜 없는 행사 자료)
  'polaris': ['Annual Meeting', 'Press Release', 'Transcript'],
  'hyundai': ['4분기'],  # isUpcoming — 파일 없음
  'kia': ['AOD', '판매실적', '지역별수출실적'],
  'mobis': ['웹캐스트'],
  'kgm': ['판매실적', '영업보고서'],
  'vinfast': ['Webcast', 'Newsletter', 'Takeaway', 'Earnings Report Q1/2024 (Restated)'],  # 증권사 리포트는 VinFastTest
  'rivian': ['Impact', 'Supplier', 'Proxy', 'Letter to Shareholders', 'Annual Meeting', 'Barclays', 'Webcast',
             'Investor Call'],  # 실물 Investor Call 의 「Shareholder letter」 는 URL 없는 내부 링크
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


class VwGalleryTest(unittest.TestCase):
  """발표자료 갤러리 JSON(2026-11-10 실물 · 2026 갤러리 10쪽)."""
  PAGES = _json('vw_gallery.json')

  def _gallery(self) -> list[dict]:
    return [r for p in self.PAGES for r in L.parse_vw_gallery(p)]

  def test_first_page_roadshow(self):
    rows = L.parse_vw_gallery(self.PAGES[0])
    self.assertEqual(len(rows), 3)
    road = next(r for r in rows if 'Roadshow' in r['title'])
    self.assertEqual((road['doc_type'], road['form'], road['published_at']), ('presentation', 'roadshow', '2026-11-05'))
    self.assertTrue(road['url'].startswith('https://uploads.vw-mms.de/') and road['url'].endswith('.pdf?1793883086'))
    self.assertNotIn('?', road['source_id'])  # 쿼리(올린 시각)는 키에 안 쓴다

  def test_china_investor_update_six_are_investor_day(self):
    """Task 13 이 2026-04-23 China Investor Update 6건을 investor_day 로 기대한다."""
    rows = [r for r in self._gallery() if 'China Investor Update' in r['title']]
    self.assertEqual(len(rows), 6)
    self.assertEqual({(r['doc_type'], r['published_at']) for r in rows}, {('investor_day', '2026-04-23')})

  def test_target_event_grouped_by_date(self):
    """2026-10-12 목표 발표 5건 — 제목에 목표 낱말이 없는 3건도 같은 날 행사로 묶는다(merge 단계 · parse_vw)."""
    rows = [r for r in _rows('vw') if r['published_at'] == '2026-10-12' and 'uploads.vw-mms.de' in r['url']]
    self.assertEqual(len(rows), 5)  # 같은 날 RSS 인도 보도자료(sales_release)는 갤러리 밖이라 묶이지 않는다
    self.assertEqual({r['doc_type'] for r in rows}, {'investor_day'})

  def test_kinds(self):
    got = {r['title']: (r['doc_type'], r['form']) for r in self._gallery()}
    self.assertEqual(got['Volkswagen Group 9M 2026 Pre-Close Call'], ('presentation', 'pre-close-call'))
    self.assertEqual(got['Q1 2026 Investor, Analyst and Media Call'], ('presentation', 'earnings-call'))
    self.assertEqual(got['Full Year 2025 Investor & Analyst Call'], ('presentation', 'earnings-call'))
    self.assertEqual(got['Investor and Analyst Call - Future Plan 2030'][0], 'investor_day')  # 실적 콜 아님
    self.assertEqual(got['Volkswagen Group Factbook 2026'], ('fact_sheet', 'factbook'))
    esg = [v for t, v in got.items() if 'Circular Economy' in t]
    self.assertTrue(esg)
    self.assertEqual({v[0] for v in esg}, {'other'})  # ESG 회의 자료 = 나머지(D4)

  def test_earnings_call_merged_into_matrix_row(self):
    """갤러리의 실적 콜 = 실적 행렬의 발표자료와 같은 문서(같은 랜딩 페이지) — 행렬 행 하나만 남는다."""
    rows = _rows('vw')
    self.assertEqual(len([r for r in rows if r['title'] == 'Presentation 2026 Q3']), 1)
    self.assertFalse([r for r in rows if 'Investor, Analyst and Media Call' in r['title']])

  def test_gallery_ids_and_year_pages(self):
    html = _text('vw_presentations.html')
    self.assertEqual(L.vw_gallery_ids(html), ['2177435', '2180176'])
    # 올해 쪽(presentations-15715 · 연도 없는 경로)은 늘 받고, 지난 연도 쪽은 since 의 연도부터
    self.assertEqual(L.vw_presentation_pages(html, '2025-10-06'), ['/en/presentations-2025-20142'])
    self.assertEqual(L.vw_presentation_pages(html, '2026-01-01'), [])

  def test_deliveries_dates(self):
    dates = L.parse_vw_deliveries(_text('vw_deliveries.html'))
    self.assertIn('2026-04-13', dates)
    self.assertIn('2026-10-12', dates)  # 파일명 꼴이 다른 표(20261012_…)도 링크 글의 날짜로
    with self.assertRaises(L.EmptyListError) as cm:
      L.parse_vw_deliveries('<html></html>')
    self.assertEqual(str(cm.exception), 'VW 인도 표 0건')

  def _fake_fetch(self, galleries: dict[str, list[dict]], calls: list):
    """galleries = {갤러리 ID: 쪽들} — 올해 쪽 HTML 에 그 ID 들이 박힌다."""
    def resp(body, content=None):
      r = MagicMock()
      r.text, r.content = body, content if content is not None else body.encode('utf-8')
      return r
    its = {g: iter(pages) for g, pages in galleries.items()}
    main = ''.join(f'<div up-data="{{&quot;url&quot;:&quot;/en/item/galleries/{g}/documents&quot;}}"></div>'
                   for g in galleries)

    def fetch(session, url, **kw):
      calls.append((url, kw))
      if '/item/galleries/' in url:
        r = MagicMock()
        r.json.return_value = next(its[url.split('/item/galleries/')[1].split('/')[0]])
        return r
      return resp({L.VW_RSS: '', L.VW_RESULTS: _text('vw_results.html'), L.VW_ADHOC: _text('vw_adhoc.html'),
                   L.VW_DELIVERIES: _text('vw_deliveries.html'), L.VW_PRESENTATIONS: main}[url],
                  (FIX / 'vw_rss.xml').read_bytes() if url == L.VW_RSS else None)
    return fetch

  def test_fetch_pages_with_accept_json(self):
    calls = []
    pages = [{'html': self.PAGES[0]['html'], 'nextOffset': 3}, {'html': self.PAGES[1]['html'], 'nextOffset': None}]
    with patch.object(L, '_fetch', side_effect=self._fake_fetch({'7': pages}, calls)):
      rows = L.fetch_vw(MagicMock(), '2026-01-01')
    gallery = [(u, kw) for u, kw in calls if '/item/galleries/' in u]
    self.assertEqual([kw['params'] for _, kw in gallery], [{'offset': 0}, {'offset': 3}])
    self.assertTrue(all(kw['headers'] == {'Accept': 'application/json'} for _, kw in gallery))
    self.assertTrue([r for r in rows if r['form'] == 'roadshow'])

  EMPTY = [{'html': '', 'nextOffset': None}]

  def test_one_empty_gallery_passes(self):
    """새해에 올해 쪽 갤러리 하나가 비어도 IR 목록 전체(RSS·행렬·ad-hoc)가 멈추지 않는다 — 다른 갤러리 행은 그대로."""
    galleries = {'7': self.EMPTY, '8': [{'html': self.PAGES[0]['html'], 'nextOffset': None}]}
    with patch.object(L, '_fetch', side_effect=self._fake_fetch(galleries, [])):
      rows = L.fetch_vw(MagicMock(), '2026-01-01')
    self.assertTrue([r for r in rows if r['form'] == 'roadshow'])
    self.assertTrue([r for r in rows if r['form'] == 'ad-hoc'])

  def test_all_galleries_empty_is_error(self):
    with patch.object(L, '_fetch', side_effect=self._fake_fetch({'7': self.EMPTY, '8': self.EMPTY}, [])):
      with self.assertRaises(L.EmptyListError) as cm:
        L.fetch_vw(MagicMock(), '2026-01-01')
    self.assertEqual(str(cm.exception), 'VW 발표자료 갤러리 전체 0건')

  def test_delivery_day_rule_skips_day_with_titled_release(self):
    """그날 제목으로 이미 인도 보도자료(2026-10-12 「delivers 6 million」)가 있으면 같은 날 제목 미판정 글은 홍보 글."""
    extra = (b'<item><title>Volkswagen opens new design studio</title><description></description>'
             b'<pubDate>Mon, 12 Oct 2026 00:00:00 +0000</pubDate>'
             b'<link>https://www.volkswagen-group.com/en/press-releases/new-design-studio-1</link></item></channel>')
    rss = (FIX / 'vw_rss.xml').read_bytes().replace(b'</channel>', extra, 1)
    rows = L.parse_vw(rss, _text('vw_results.html'), _text('vw_adhoc.html'), _text('vw_deliveries.html'),
                      _json('vw_gallery.json'))
    self.assertFalse([r for r in rows if 'new design studio' in r['title']])
    self.assertEqual(next(r for r in rows if 'delivers 6 million' in r['title'])['doc_type'], 'sales_release')


class PorscheReportsTest(unittest.TestCase):
  """보고서·발표자료 표(2026-11-10 실물 · 2026·2025 분기 표 + 행사 탭 2026 표)."""

  def _by_url_end(self, tail: str) -> dict:
    return next(r for r in _rows('porsche') if r['url'].endswith(tail))

  def test_fact_sheet_row_for_task3(self):
    """Task 3 이 doc_type='fact_sheet' · form='fact-sheet-xlsx' 로 고른다."""
    r = self._by_url_end('FY-2025-fact-sheet-porsche-ag.xlsx')
    self.assertEqual((r['doc_type'], r['form'], r['published_at']), ('fact_sheet', 'fact-sheet-xlsx', '2026-03-11'))

  def test_german_folder_is_not_assumed_german(self):
    """FY25 발표자료는 독일어 폴더(results-and-presentations-de) 아래다 — 경로로 언어를 가르지 않는다."""
    r = self._by_url_end('FY25%20Presentation.pdf')
    self.assertIn('results-and-presentations-de', r['url'])
    self.assertEqual((r['doc_type'], r['published_at']), ('presentation', '2026-03-11'))

  def test_pdf_viewer_links_unwrapped(self):
    """뷰어 링크(/pdf-viewer.aspx?src=…)를 그대로 쓰면 ir_source_id 가 쿼리를 버려 전부 한 키로 뭉개진다."""
    rows = L.parse_porsche_reports(_text('porsche_reports.html'))
    self.assertFalse([r for r in rows if 'pdf-viewer' in r['url']])
    self.assertEqual(len({r['source_id'] for r in rows}), len(rows))
    self.assertTrue(all(L.urlsplit(r['url']).netloc == 'investorrelations.porsche.com' for r in rows))  # 뉴스룸 링크 제외

  def test_report_rows_wait_for_feed(self):
    """표 행은 날짜가 없다 — 분기만 실어 내보내고(parse_porsche_reports) 피드 실적 보도일로 채운다(parse_porsche_all)."""
    rows = L.parse_porsche_reports(_text('porsche_reports.html'))
    self.assertTrue(all(r['published_at'] is None and r['_wait'] == 'eqs' for r in rows))
    h1 = self._by_url_end('H1-2026-Presentation.pdf')
    self.assertEqual((h1['_quarter'], h1['_wait']), ('2026-Q2', 'eqs'))
    got, holds = L.resolve_dates([h1], {}, '2026-01-01')
    self.assertEqual((got, holds), ([], {'eqs': 1}))

  def test_cmd_fixed_path(self):
    r = next(r for r in _rows('porsche') if r['doc_type'] == 'investor_day')
    self.assertEqual(r['url'], 'https://investorrelations.porsche.com/~/media/Files/P/porsche-ir/cmd-2026/CapitalMarketsDay2026.pdf')

  def test_empty_table_is_error(self):
    with self.assertRaises(L.EmptyListError) as cm:
      L.parse_porsche_reports('<html></html>')
    self.assertEqual(str(cm.exception), '포르쉐 보고서 표 0건')


class NumbersCollectorWantsTest(unittest.TestCase):
  """목록 드라이런은 새 문서를 DB 에 싣지 않는다 — 새 행을 숫자 수집기의 Doc 꼴로 바꿔 wants 를 직접 본다.
  발표자료·행사·VW Factbook 은 대상 밖(pending) · 1분기 인도 보도자료와 포르쉐 팩트시트 XLSX(Task 3)는 대상."""

  def _doc(self, ticker: str, r: dict):
    from customer_parsers.base import Doc
    return Doc(id=0, company_id='x', ticker=ticker, source=r['source'], doc_type=r['doc_type'], form=r['form'],
               items='', title=r['title'], url=r['url'], published_at=r['published_at'] or '', source_id=r['source_id'])

  def test_new_rows(self):
    from customer_parsers import porsche, vw
    for ticker, mod, company in (('VOW3.DE', vw, 'vw'), ('P911.DE', porsche, 'porsche')):
      new = [r for r in _rows(company) if r['doc_type'] in ('presentation', 'investor_day', 'fact_sheet')]
      self.assertTrue(new)
      for r in new:
        with self.subTest(ticker=ticker, title=r['title']):
          want = company == 'porsche' and r['doc_type'] == 'fact_sheet'
          self.assertEqual(mod.wants(self._doc(ticker, r)), want)
    q1 = next(r for r in _rows('vw') if r['title'].startswith('Volkswagen Group maintains stable market share'))
    self.assertTrue(vw.wants(self._doc('VOW3.DE', q1)))

  def test_vinfast_rivian_links_only(self):
    """빈패스트·리비안 IR 문서는 전부 링크만 — 숫자 수집기가 받지 않는다(리비안 180MB·431MB PDF 포함)."""
    from customer_parsers import rivian, vinfast
    for ticker, mod, company in (('VFS', vinfast, 'vinfast'), ('RIVN', rivian, 'rivian')):
      rows = _rows(company)
      self.assertTrue(rows)
      for r in rows:
        with self.subTest(ticker=ticker, title=r['title']):
          self.assertFalse(mod.wants(self._doc(ticker, r)))


class FetchHeadersTest(unittest.TestCase):
  def test_default_headers_unchanged_and_merge(self):
    s = MagicMock()
    L._fetch(s, 'https://a.example/x')
    self.assertEqual(s.request.call_args.kwargs['headers'], {'User-Agent': L.BROWSER_UA})
    L._fetch(s, 'https://a.example/x', headers={'Accept': 'application/json'})
    self.assertEqual(s.request.call_args.kwargs['headers'], {'User-Agent': L.BROWSER_UA, 'Accept': 'application/json'})


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
    self.assertEqual(set(L.HOLD_REASONS), {'dart', 'press', 'rss', 'call', 'eqs', 'edgar'})


class EdgarDatesTest(unittest.TestCase):
  """EDGAR 회사(빈패스트·리비안)의 날짜 갈래 — 분기 = 실적 문서가 «보고한 기간»(숫자 수집기가 읽은 값), 날짜 = 그 문서 접수일.

  빈패스트 실물(2026-11-10 DB): 실적 6-K 가 분기 끝 뒤 2~4달에 나온다 — 2분기 실적이 2026-10-19(3분기 끝 뒤),
  4분기 실적이 2025-04-24. 「분기 끝 뒤 첫 실적 문서」로 고르면 3분기 행이 2분기 실적일을 받는다."""
  # (보고한 기간, 접수일) — 빈패스트 실물 꼴
  VFS = [('2025-Q4', '2026-03-16'), ('2026-Q1', '2026-06-08'), ('2026-Q2', '2026-10-19'), ('2024-Q4', '2025-04-24')]

  def test_period_from_reported_results(self):
    self.assertEqual(L.results_quarter_dates(self.VFS),
                     {'2025-Q4': '2026-03-16', '2026-Q1': '2026-06-08', '2026-Q2': '2026-10-19', '2024-Q4': '2025-04-24'})

  def test_earliest_after_quarter_end_only(self):
    """같은 기간을 두 문서가 보고하면 이른 접수일 · 분기 끝 전 접수일은 그 분기 실적일 수 없다 — 버린다."""
    got = L.results_quarter_dates([('2026-Q2', '2026-10-25'), ('2026-Q2', '2026-10-19'), ('2026-Q3', '2026-09-30')])
    self.assertEqual(got, {'2026-Q2': '2026-10-19'})

  def test_resolve_edgar_fills_or_holds(self):
    row = L._row('shareholder_letter', 'x', 'https://a.example/q3.pdf', None, 'f', quarter='2026-Q3', wait='edgar')
    qdates = L.results_quarter_dates(self.VFS)
    # 3분기 실적 문서가 아직 없다 — 3분기 끝 뒤에 나온 2분기 실적일(10-19)을 받지 않고 보류
    self.assertEqual(L.resolve_dates([row], qdates, '2026-01-01'), ([], {'edgar': 1}))
    got, holds = L.resolve_dates([row], {**qdates, '2026-Q3': '2026-12-02'}, '2026-01-01')
    self.assertEqual(([r['published_at'] for r in got], holds), (['2026-12-02'], {}))

  def test_rivian_prelim_range_8k_not_used(self):
    """리비안 2026-07-06 8-K 2.02(잠정 범위) 는 숫자 수집기가 실적 행을 안 남긴다 — 2분기 날짜는 07-30 실적 8-K."""
    self.assertEqual(L.results_quarter_dates([('2026-Q2', '2026-07-30')]), {'2026-Q2': '2026-07-30'})


class VinFastTest(unittest.TestCase):
  """빈패스트 IR(2026-11-10 실물 — Our Reports 표 · 회사 소개 자료 링크 · Mobility Day 상세)."""

  def test_earnings_reports_wait_for_edgar(self):
    rows = [r for r in _rows('vinfast') if r['doc_type'] == 'shareholder_letter']
    self.assertEqual(len(rows), 13)  # Q2/2023 ~ Q2/2026 (재작성 행은 보고서 칸이 비었다)
    self.assertTrue(all(r['published_at'] is None and r['_wait'] == 'edgar' for r in rows))
    q2 = next(r for r in rows if r['title'].endswith('Q2/2026'))
    self.assertEqual(q2['_quarter'], '2026-Q2')
    self.assertEqual(q2['url'], 'https://vingroup.widen.net/s/xhqtktdtjf/q2-2026-vinfast-auto-earnings-report')

  def test_no_analyst_reports(self):
    """D9 — 증권사 리포트 원문(IR 첫 쪽 표 · Mobility Day 애널리스트 노트)은 넣지 않는다."""
    from bs4 import BeautifulSoup
    analyst = {a['href'] for a in BeautifulSoup(_text('vinfast_reports.html'), 'html.parser').select('table a[href]')
               if 'Securities' in a.find_parent('table').get_text()}
    analyst |= {a['href'] for a in BeautifulSoup(_text('vinfast_mobility_day.html'), 'html.parser').select('li a[href]')}
    self.assertGreaterEqual(len(analyst), 13)
    self.assertFalse({r['url'] for r in _rows('vinfast')} & analyst)

  def test_presentation_key_is_edition_without_signature(self):
    """저장 URL = 뷰어 쪽(만료 없음) · 키 = 판 이름이 든 경로. 서명 URL(쿼리만 다름)은 행에 싣지 않는다."""
    pres = next(r for r in _rows('vinfast') if r['doc_type'] == 'presentation')
    self.assertEqual(pres['url'], 'https://vingroup.widen.net/s/5jbbztcrrr/2026.11.-corporate-presentation')
    self.assertEqual(pres['source_id'], 'vingroup.widen.net/s/5jbbztcrrr/2026.11.-corporate-presentation')
    signed = L.vinfast_pdf_url(_text('vinfast_presentation.html'))
    self.assertTrue(signed.startswith('https://previews.eu-west-1.widencdn.net/') and 'sig=' in signed)
    other = signed.replace('sig=FAKE-SIGNATURE', 'sig=OTHER-SIGNATURE')  # 픽스처 서명 값은 가짜(형식만 실물)
    self.assertNotEqual(signed, other)
    self.assertEqual(L.ir_source_id(signed), L.ir_source_id(other))

  def test_edition_date(self):
    """PDF 만든 날을 쓰되 판 이름의 연·월과 맞을 때만(옛 판 PDF 를 새 판 이름에 붙이지 않는다)."""
    url = 'https://vingroup.widen.net/s/5jbbztcrrr/2026.11.-corporate-presentation'
    self.assertEqual(L.vinfast_edition_date(url, "D:20261109134612+07'00'"), '2026-11-09')
    self.assertIsNone(L.vinfast_edition_date(url, "D:20261009134612+07'00'"))  # 달이 다르다
    self.assertIsNone(L.vinfast_edition_date(url, ''))
    self.assertIsNone(L.vinfast_edition_date('https://vingroup.widen.net/s/x/corporate-presentation', 'D:20261109'))

  def test_empty_reports_table_is_error(self):
    with self.assertRaises(L.EmptyListError) as cm:
      L.parse_vinfast_reports('<html></html>')
    self.assertEqual(str(cm.exception), '빈패스트 Our Reports 표 0건')

  def test_fetch_two_step_presentation(self):
    """뷰어 HTML → 서명 PDF → 만든 날. PDF 받기가 상한에 걸리면 날짜 없이(행은 «날짜 없음»으로 세어진다)."""
    import fitz
    doc = fitz.open()
    doc.new_page()
    doc.set_metadata({'creationDate': "D:20261109134612+07'00'"})
    pdf = doc.tobytes()
    pages = {L.VINFAST_IR: _text('vinfast_reports.html'), L.VINFAST_MOBILITY_DAY: _text('vinfast_mobility_day.html'),
             'https://vingroup.widen.net/s/5jbbztcrrr/2026.11.-corporate-presentation': _text('vinfast_presentation.html')}
    fetch = lambda s, url, **kw: MagicMock(text=pages[url])  # noqa: E731
    with patch.object(L, '_fetch', side_effect=fetch), patch.object(L, 'ir_get', return_value=MagicMock(content=pdf)) as g:
      rows = L.fetch_vinfast(MagicMock(), '2026-01-01')
    self.assertTrue(g.call_args.args[1].startswith('https://previews.eu-west-1.widencdn.net/'))
    self.assertEqual(next(r for r in rows if r['doc_type'] == 'presentation')['published_at'], '2026-11-09')
    with patch.object(L, '_fetch', side_effect=fetch), patch.object(L, 'ir_get', side_effect=L.TooLarge(None)), \
         patch('builtins.print'):
      rows = L.fetch_vinfast(MagicMock(), '2026-01-01')
    self.assertIsNone(next(r for r in rows if r['doc_type'] == 'presentation')['published_at'])

  def _fetch_with_pdf_failure(self, **ir_get_kw) -> tuple[list[dict], str]:
    pages = {L.VINFAST_IR: _text('vinfast_reports.html'), L.VINFAST_MOBILITY_DAY: _text('vinfast_mobility_day.html'),
             'https://vingroup.widen.net/s/5jbbztcrrr/2026.11.-corporate-presentation': _text('vinfast_presentation.html')}
    with patch.object(L, '_fetch', side_effect=lambda s, url, **kw: MagicMock(text=pages[url])), \
         patch.object(L, 'ir_get', **ir_get_kw), patch('builtins.print') as out:
      rows = L.fetch_vinfast(MagicMock(), '2026-01-01')
    return rows, '\n'.join(c.args[0] for c in out.call_args_list)

  def _assert_only_presentation_undated(self, rows: list[dict]):
    """PDF 한 건이 실패해도 목록 전체(분기 보고서 13 · 행사 1)는 그대로 — 회사 소개 자료만 날짜 없음."""
    self.assertEqual(len([r for r in rows if r['doc_type'] == 'shareholder_letter']), 13)
    self.assertEqual(next(r for r in rows if r['doc_type'] == 'investor_day')['published_at'], '2025-11-10')
    self.assertIsNone(next(r for r in rows if r['doc_type'] == 'presentation')['published_at'])

  def test_pdf_4xx_keeps_list(self):
    """서명 만료·CDN 403 — ir_get 은 4xx 를 즉시 raise. 목록이 blocked/error 로 죽지 않는다 · 경고에 URL 이 없다."""
    resp = requests.Response()
    resp.status_code, resp.url = 403, 'https://previews.eu-west-1.widencdn.net/x.pdf?sig=SECRET'
    rows, printed = self._fetch_with_pdf_failure(side_effect=requests.HTTPError('403 for url ...sig=SECRET', response=resp))
    self._assert_only_presentation_undated(rows)
    self.assertIn('HTTPError', printed)
    self.assertNotIn('sig', printed)

  def test_pdf_not_a_pdf_keeps_list(self):
    """PDF 대신 HTML(오류 쪽)이 오거나 빈 응답이어도 날짜만 비운다(pymupdf: HTML = 빈 메타 · 빈 바이트 = 예외)."""
    for body in (b'<html>Access denied</html>', b''):
      with self.subTest(body=body):
        rows, _ = self._fetch_with_pdf_failure(return_value=MagicMock(content=body))
        self._assert_only_presentation_undated(rows)

  def test_event_date_cell_not_numeric(self):
    """날짜 칸이 숫자가 아니면 날짜만 None — 목록은 맨 예외로 죽지 않는다."""
    html = _text('vinfast_mobility_day.html').replace('<span class="start-month">11</span>',
                                                       '<span class="start-month">Nov</span>')
    rows = L.parse_vinfast_event(html)
    self.assertEqual(len(rows), 1)
    self.assertIsNone(rows[0]['published_at'])


class RivianTest(unittest.TestCase):
  """리비안 __NEXT_DATA__(2026-11-10 실물 — /investors 분기 실적·행사 절 + /investors/events 행사 절)."""

  def test_quarter_blocks(self):
    rows = [r for r in _rows('rivian') if r['doc_type'] == 'shareholder_letter']
    self.assertEqual(len(rows), 11)  # 픽스처 = 2024 Q1 ~ 2026 Q3
    self.assertTrue(all(r['published_at'] is None and r['_wait'] == 'edgar' for r in rows))
    q3 = next(r for r in rows if r['title'] == 'Rivian Q3 2026 Shareholder Presentation')
    self.assertEqual(q3['_quarter'], '2026-Q3')
    self.assertTrue(q3['url'].startswith('https://downloads.rivian.com/'))

  def test_events_from_both_pages_once(self):
    """AI Day 는 두 쪽에 다 있다 — 하나로. 2026 행사(/investors 쪽에만)도 본다."""
    rows = [r for r in _rows('rivian') if r['doc_type'] == 'investor_day']
    self.assertEqual(len(rows), 3)
    nd = _json('rivian_next_data.json')
    # /investors 쪽 = AI Day · VW 합작(2024-11 까지만 싣는다) — Investor Day 2024 는 /investors/events 에만
    self.assertEqual(len(L.parse_rivian_events(nd['investors'])), 2)

  def test_next_data_missing_is_error(self):
    """JS 로만 그리는 쪽으로 바뀌면 조용히 0건이 아니라 멈춘다."""
    with self.assertRaises(L.EmptyListError):
      L._next_data('<html><body></body></html>')
    nd = L._next_data('<script id="__NEXT_DATA__" type="application/json">{"props": {}}</script>')
    self.assertEqual(nd, {'props': {}})


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
    deliv, gal = _text('vw_deliveries.html'), _json('vw_gallery.json')
    self.assertEmpty('VW 보도자료 RSS', L.parse_vw, b'<rss><channel></channel></rss>', res, adhoc, deliv, gal)
    self.assertEmpty('VW 실적 행렬', L.parse_vw, rss, '<html><h2 id="financial-results-2026"></h2></html>', adhoc,
                     deliv, gal)
    self.assertEmpty('VW ad-hoc', L.parse_vw, rss, res, '<html></html>', deliv, gal)
    self.assertEmpty('VW 인도 표', L.parse_vw, rss, res, adhoc, '<html></html>', gal)
    self.assertEmpty('VW 발표자료 갤러리', L.vw_gallery_ids, '<html></html>')
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

  VFS = {'id': 'u-vfs', 'ticker': 'VFS', 'sec_cik': '1913510', 'dart_corp_code': None}

  def test_edgar_company_dates_from_reported_results(self):
    """EDGAR 회사 — 날짜 근거 = 숫자 수집기가 실적을 읽은 EDGAR 6-K/8-K 접수일. 보류 문장은 'edgar' 사유."""
    rows = [L._row('shareholder_letter', 'Q2', 'https://a.example/q2.pdf', None, 'f', quarter='2026-Q2', wait='edgar'),
            L._row('shareholder_letter', 'Q3', 'https://a.example/q3.pdf', None, 'f', quarter='2026-Q3', wait='edgar')]
    with patch.dict(ccd.ir_lists.IR_LISTS, {'VFS': lambda s, since: rows}), \
         patch.object(ccd, 'edgar_quarter_dates', return_value={'2026-Q2': '2026-10-19'}) as eq, \
         patch.object(ccd, 'prelim_quarter_dates') as pq, patch('builtins.print') as out:
      got = ccd.ir_rows(MagicMock(), self.VFS, '2026-01-01', MagicMock())
    eq.assert_called_once()
    pq.assert_not_called()
    self.assertEqual([(r['title'], r['published_at']) for r in got], [('Q2', '2026-10-19')])
    printed = '\n'.join(c.args[0] for c in out.call_args_list)
    self.assertIn(f'날짜 보류 1건 — {L.HOLD_REASONS["edgar"]}', printed)

  def test_edgar_quarter_dates_query(self):
    """실적 행(분기) → 문서 id → EDGAR 6-K/8-K 접수일. 다른 출처·없는 문서는 버린다."""
    client = MagicMock()
    res = [{'period': '2026-Q2', 'document_id': 7}, {'period': '2026-Q1', 'document_id': 5},
           {'period': '2026-Q1', 'document_id': None}]
    docs = [{'id': 7, 'published_at': '2026-10-19'}]  # id 5 = 질의 조건(edgar·6-K/8-K)에 안 걸린 문서
    t = {'customer_reported_results': MagicMock(), 'customer_documents': MagicMock()}
    t['customer_reported_results'].select.return_value.eq.return_value.eq.return_value.execute.return_value.data = res
    t['customer_documents'].select.return_value.in_.return_value.eq.return_value.in_.return_value.execute \
      .return_value.data = docs
    client.table.side_effect = lambda name: t[name]
    self.assertEqual(ccd.edgar_quarter_dates(client, 'u-vfs'), {'2026-Q2': '2026-10-19'})
    q = t['customer_documents'].select.return_value
    self.assertEqual(q.in_.call_args.args, ('id', [5, 7]))
    self.assertEqual(q.in_.return_value.eq.call_args.args, ('source', 'edgar'))
    self.assertEqual(q.in_.return_value.eq.return_value.in_.call_args.args, ('form', ['6-K', '8-K']))

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
