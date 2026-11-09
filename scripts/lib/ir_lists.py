"""고객사 IR 사이트 «문서 목록» 어댑터 — collect_customer_docs.py 가 EDGAR·DART 행과 같은 upsert 로 싣는다(source='ir').

회사마다 «받기»(`fetch_<회사>(session, since)`)와 «응답 → 행» 순수 함수(`parse_<회사>(…)`)를 가른다.
시험(test_ir_lists.py)은 순수 함수만, 2026-11 실물을 잘라 둔 픽스처(fixtures/ir_lists/)로 본다.

행 = customer_documents 칸(company_id 는 수집기가 붙인다). source_id = `ir_source_id(url)` 한 곳에서만 만든다
(호스트 + URL 경로, 쿼리 제외 — 같은 문서가 두 목록(VW RSS·실적 행렬)에 나와도 하나로 합쳐진다. 예외는 그 함수 docstring).

날짜 칸이 없는 목록(현대차·현대모비스 IR · KGM 발표자료 등)은 published_at=None + `_quarter`('2026-Q3') + `_wait`
(어디서 날짜가 올지)로 내보내고, 수집기가 `resolve_dates` 로 채운다. 못 찾으면 행을 버리지 않고 «보류»로 세어
알린다(날짜를 지어내지 않는다 — 다음 실행에 근거가 생기면 그때 들어간다). 분기도 날짜도 없는 행은 «날짜 없음»으로
따로 센다(다음 실행에도 안 풀린다).

목록이 통째로 0건이면 사이트 구조가 바뀐 것이다 — 하위 목록마다 `EmptyListError`(문장이 상태 표 사유로 나간다).

실적 일정(customer_earnings_dates)은 문서가 아니라 `IR_EARNINGS_DATES` 로 따로 낸다(VW ICS · 폴라리스 이벤트).
기간 = 'YYYY-Qn' · 연간(4분기+연간 발표) = 'YYYY-FY'.

GM IR 은 Akamai 가 로컬·Playwright 모두 403 이라 어댑터가 없다 — `probe_gm()` 이 GHA 러너에서 접근만 시험하고
customer_collect_status(GM, 'ir_list') 에 결과를 남긴다(Task 12 워크플로가 부른다).
"""
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Callable
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit

import requests
from bs4 import BeautifulSoup

from lib.doc_text import html_to_text
from lib.retry import with_retry

BROWSER_UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
              'Chrome/130.0.0.0 Safari/537.36')
TIMEOUT_S = 30
# 「접근 차단」(인증·봇 차단)으로 보는 HTTP 상태 — 목록 수집기·숫자 수집기·GM 접근 시험이 이 한 튜플을 쓴다(최종 검토 P12)
BLOCKED_HTTP = (401, 403)


class EmptyListError(Exception):
  """정상일 수 없는 0건 — 조용한 0건을 no_new 로 숨기지 않는다. 문장은 상태 표 사유(화면)로 그대로 나간다.

  수집기(collect_customer_docs.py)도 같은 클래스를 쓴다(EDGAR 0건 · IR 전체 0건)."""


def _need(label: str, items: list) -> list:
  """하위 목록이 비면 그 목록 이름을 실어 멈춘다(어느 목록이 깨졌는지 상태 표만 보고 알 수 있게)."""
  if not items:
    raise EmptyListError(f'{label} 0건')
  return items


def _fetch(session: requests.Session, url: str, *, method: str = 'GET', params: dict | None = None,
           data: dict | None = None) -> requests.Response:
  def _once():
    r = session.request(method, url, params=params, data=data, headers={'User-Agent': BROWSER_UA}, timeout=TIMEOUT_S)
    r.raise_for_status()
    return r
  return with_retry(_once, _label=urlsplit(url).netloc)


_MOBIS_DOWNLOAD = '/cmm/fms/PdfFileDown.do'


def ir_source_id(url: str) -> str:
  """IR 문서의 안정 키 = 호스트 + 경로(쿼리·조각 제외). 호스트를 붙여 회사 사이의 같은 경로 충돌을 막는다.

  예외: 현대모비스 다운로드는 경로가 전부 같고 쿼리의 fileId 가 요청마다 바뀐다(2026-11-09 실측) — 서버 파일명
  `fileNm` 쿼리를 키로 쓴다(어댑터가 URL 에 붙여 둔다 · 서버는 덧붙은 fileNm 을 무시하고 PDF 를 준다). 없으면 멈춘다
  (경로만으로 키를 만들면 모비스 문서 전부가 한 행으로 뭉개진다)."""
  u = urlsplit(url)
  if u.path.endswith(_MOBIS_DOWNLOAD):
    name = (parse_qs(u.query).get('fileNm') or [''])[0]
    if not name:
      raise ValueError('현대모비스 다운로드 URL 에 fileNm 이 없다')
    return f'{u.netloc}/cmm/fms/{name}'
  return f'{u.netloc}{u.path}'


def _nfc(s: str) -> str:
  """한글 자모 분리형(NFD) → 완성형. 기아 파일 제목 일부가 NFD 다(2026-11-09 실측: 2·3분기만) — 그대로 두면
  「2026년 3분기」 검색·비교가 조용히 0건이 된다."""
  return ' '.join(unicodedata.normalize('NFC', s).split())


def _row(doc_type: str, title: str, url: str, published_at: str | None, form: str, *, quarter: str | None = None,
         wait: str = 'dart') -> dict:
  row = {'source': 'ir', 'source_id': ir_source_id(url), 'doc_type': doc_type, 'form': form, 'items': None,
         'title': _nfc(title), 'url': url, 'published_at': published_at}
  if published_at is None and quarter:
    row['_quarter'] = quarter  # 수집기 resolve_dates 가 날짜로 바꾸고 지운다(DB 칸 아님)
    row['_wait'] = wait  # 날짜가 올 곳 — HOLD_REASONS 키
  return row


def _years(since: str) -> range:
  return range(int(since[:4]), date.today().year + 1)


# ── 날짜 채우기(수집기가 부른다 · 순수) ───────────────────────────────────────

# 월 판매 공시도 보고서명이 「영업(잠정)실적(공정공시)」라 분기 실적과 섞인다(2026-11-09 DB 실측: 매월 1~4일).
# 분기 실적은 「연결재무제표기준」 공시만 — 현대차·기아·현대모비스 실물 전부 이 꼴이다.
_CONSOLIDATED_PRELIM = '연결재무제표기준'

# 보류 사유(`_wait`) → 수집기가 찍는 문장. 'dart' 만 resolve_dates 가 채운다 — 나머지는 어댑터가 같은 응답 안에서
# 이미 찾아봤고 없었던 것이라, 다음 실행에 원문에 생겨야 풀린다.
HOLD_REASONS = {
  'dart': '같은 분기 DART 연결 잠정실적 공시가 아직 없다',
  'press': '같은 분기 경영실적 보도자료가 자료실에 아직 없다',
  'rss': '같은 분기 실적 보도자료가 RSS 에 없다',
  'call': '같은 분기 실적 콜 이벤트가 아직 없다',
}
NO_DATE = 'nodate'  # 분기도 날짜도 없는 행 — 다음 실행에도 안 풀린다


def quarter_dates(prelims: list[dict]) -> dict[str, str]:
  """DART 잠정실적 공시({'title','published_at'}) → {'2026-Q3': '2026-10-29'}. 분기 = 공시 직전 분기, 같은 분기면 이른 날."""
  out: dict[str, str] = {}
  for p in prelims:
    if _CONSOLIDATED_PRELIM not in p['title'].replace(' ', ''):
      continue
    d = date.fromisoformat(p['published_at'])
    q = (d.month - 1) // 3
    key = f'{d.year - 1}-Q4' if q == 0 else f'{d.year}-Q{q}'
    if key not in out or p['published_at'] < out[key]:
      out[key] = p['published_at']
  return out


def _quarter_end(q: str) -> date:
  y, n = int(q[:4]), int(q[-1])
  return date(y, 12, 31) if n == 4 else date(y, 3 * n + 1, 1) - timedelta(days=1)


# 분기 말 + 이 날수 안에 실적이 나온다(국내·독일·미국 실물 최장 = 4분기 3월 초). 이보다 오래된 «날짜 미상» 행은 범위 밖.
_RESULTS_LAG_DAYS = 100


def resolve_dates(rows: list[dict], qdates: dict[str, str], since: str) -> tuple[list[dict], dict[str, int]]:
  """`_quarter` 행에 날짜를 채우고 since 이후만 남긴다. → (행, {보류 사유: 수}).

  사유 = HOLD_REASONS 키(다음 실행에 다시 본다) 또는 NO_DATE(분기도 날짜도 없음 — 안 풀린다).
  분기가 since 보다 한참 오래된 행은 보류가 아니라 범위 밖이라 조용히 뺀다.
  """
  out, holds = [], {}
  for r in rows:
    r = dict(r)
    q, wait = r.pop('_quarter', None), r.pop('_wait', None)
    if r['published_at'] is None:
      if not q:
        holds[NO_DATE] = holds.get(NO_DATE, 0) + 1
        continue
      if wait == 'dart':
        r['published_at'] = qdates.get(q)
      if r['published_at'] is None:
        if (_quarter_end(q) + timedelta(days=_RESULTS_LAG_DAYS)).isoformat() < since:
          continue  # 범위 밖(오래된 분기)
        holds[wait] = holds.get(wait, 0) + 1
        continue
    if r['published_at'] >= since:
      out.append(r)
  return out, holds


# ── 폭스바겐 ──────────────────────────────────────────────────────────────────

VW_BASE = 'https://www.volkswagen-group.com'
VW_RSS = f'{VW_BASE}/en/feeds/press-releases'
VW_RESULTS = f'{VW_BASE}/en/financial-results-18486'
VW_ADHOC = f'{VW_BASE}/en/ad-hoc'
VW_EVENTS = f'{VW_BASE}/en/events'

_VW_EARN = re.compile(r'\bresults?\b|\boutlook\b', re.I)
_VW_DELIV = re.compile(r'\bdeliver', re.I)
_VW_COLS = {'Q1': 'Q1', 'H1': 'Q2', 'Q3': 'Q3', 'AMC': 'Q4'}  # 행렬 열 → 실적 대상 분기(AMC = 연간)
_VW_ROWS = (('press release', 'earnings_release'), ('report', 'periodic'), ('presentation', 'presentation'))


def classify_vw_title(title: str) -> str | None:
  if _VW_EARN.search(title):
    return 'earnings_release'
  if _VW_DELIV.search(title):
    return 'sales_release'
  return None


def parse_vw_rss(xml: str | bytes) -> list[dict]:
  """RSS 보도자료 전부 → 행(doc_type 이 None 이면 홍보 글 — parse_vw 가 버린다). 바이트를 받는다 — XML 선언의
  인코딩을 파서가 읽게 한다(requests .text 의 추정 인코딩을 거치지 않는다)."""
  out = []
  for item in ET.fromstring(xml).iter('item'):
    title, link = item.findtext('title') or '', (item.findtext('link') or '').strip()
    pub = parsedate_to_datetime(item.findtext('pubDate')).date().isoformat()
    out.append(_row(classify_vw_title(title), title, link, pub, 'press-release'))
  return _need('VW 보도자료 RSS', out)


def parse_vw_results(html: str) -> list[tuple[int, str, str, str, str]]:
  """실적 행렬(연도 × Q1/H1/Q3/AMC) → (연도, 분기, doc_type, 행 이름, 절대 URL). 웹캐스트·이벤트 행은 버린다."""
  out, year = [], None
  for el in BeautifulSoup(html, 'html.parser').find_all(['h2', 'table']):
    if el.name == 'h2':
      m = re.fullmatch(r'financial-results-(\d{4})', el.get('id') or '')
      year = int(m.group(1)) if m else None
      continue
    if year is None:
      continue
    for tr in el.find_all('tr'):
      tds = tr.find_all('td')
      label = tds[0].get_text(' ', strip=True) if tds else ''
      doc_type = next((t for k, t in _VW_ROWS if k in label.lower()), None)
      if not doc_type:
        continue
      for a in tr.find_all('a', href=True):
        col = a.get_text(strip=True)
        if col in _VW_COLS:
          out.append((year, _VW_COLS[col], doc_type, label, urljoin(VW_BASE, a['href'])))
    year = None  # 연도 절마다 표 1개
  return _need('VW 실적 행렬', out)


def parse_vw_adhoc(html: str) -> list[dict]:
  out = []
  for a in BeautifulSoup(html, 'html.parser').select('a.vertical-page-list-item[href^="/en/ad-hoc/"]'):
    t = a.find('time')
    title = a.select_one('.vertical-page-list-item--title')
    if t and title and t.get('datetime'):
      out.append(_row('guidance', title.get_text(' ', strip=True), urljoin(VW_BASE, a['href']), t['datetime'][:10],
                      'ad-hoc'))
  return _need('VW ad-hoc', out)


def parse_vw(rss_xml: str | bytes, results_html: str, adhoc_html: str) -> list[dict]:
  """RSS + 실적 행렬 + ad-hoc → 행. 같은 보도자료가 RSS·행렬에 둘 다 있으면 하나(행렬의 종류 · RSS 의 제목·날짜).

  행렬에는 날짜가 없다 — 같은 열(연도·분기)의 보도자료가 RSS 에 있으면 그 날짜를 보고서·발표자료에도 쓴다
  (세 문서가 같은 날 나온다). RSS(약 100건 ≈ 2년)에 없으면 `_quarter`(wait='rss')로 내보내 수집기가 범위 밖으로 거른다.
  """
  rss = {r['source_id']: r for r in parse_vw_rss(rss_xml)}
  cells = parse_vw_results(results_html)
  col_date = {(y, q): rss[ir_source_id(u)]['published_at'] for y, q, t, _, u in cells
              if t == 'earnings_release' and ir_source_id(u) in rss}
  out = {k: r for k, r in rss.items() if r['doc_type']}
  for y, q, doc_type, label, url in cells:
    base = rss.get(ir_source_id(url))
    d = col_date.get((y, q))
    title = base['title'] if base else f'{label} {y} {q}'
    out[ir_source_id(url)] = _row(doc_type, title, url, d, 'financial-results', quarter=f'{y}-{q}', wait='rss')
  for r in parse_vw_adhoc(adhoc_html):
    out[r['source_id']] = r
  return list(out.values())


def fetch_vw(session: requests.Session, since: str) -> list[dict]:
  return parse_vw(_fetch(session, VW_RSS).content, _fetch(session, VW_RESULTS).text, _fetch(session, VW_ADHOC).text)


_VW_EVENT_SLUG = re.compile(r'/en/events/[^"/]*(interim-report|half-yearly-financial-report|annual-media-conference)'
                            r'[^"/]*/ics$')


def parse_vw_events(html: str) -> list[str]:
  """일정 화면 → 실적 발표 일정의 ICS 경로(학회·로드쇼·주총은 버린다)."""
  hrefs = [a['href'] for a in BeautifulSoup(html, 'html.parser').find_all('a', href=True)]
  return _need('VW 실적 일정', list(dict.fromkeys(h for h in hrefs if _VW_EVENT_SLUG.search(h))))


_VW_ICS_PERIOD = ((re.compile(r'Interim Report January\s*[–-]\s*March (\d{4})'), 'Q1'),
                  (re.compile(r'Half-Yearly Financial Report (\d{4})'), 'Q2'),
                  (re.compile(r'Interim Report January\s*[–-]\s*September (\d{4})'), 'Q3'))


def parse_vw_ics(ics: str) -> dict | None:
  """ICS 1건 → {'period','event_date','quote'}. quote = 원문 두 줄(DTSTART·SUMMARY). 실적 일정이 아니면 None."""
  lines = re.sub(r'\r?\n[ \t]', '', ics).splitlines()  # RFC 5545 줄 접기 풀기
  start = next((ln for ln in lines if ln.startswith('DTSTART;VALUE=DATE:')), None)
  summary = next((ln for ln in lines if ln.startswith('SUMMARY:')), None)
  if not start or not summary:
    return None
  ymd = start.split(':', 1)[1].strip()
  event_date = f'{ymd[:4]}-{ymd[4:6]}-{ymd[6:8]}'
  text = summary.split(':', 1)[1]
  period = next((f'{m.group(1)}-{q}' for rx, q in _VW_ICS_PERIOD if (m := rx.search(text))), None)
  if period is None and 'Annual Media Conference' in text:
    period = f'{int(ymd[:4]) - 1}-FY'  # 3월 연차 기자회견 = 전년 연간 실적
  return {'period': period, 'event_date': event_date, 'quote': f'{start}\n{summary}'} if period else None


def fetch_vw_dates(session: requests.Session, since: str) -> list[dict]:
  out = []
  for path in parse_vw_events(_fetch(session, VW_EVENTS).text):
    # ICS 응답은 `text/calendar` 에 charset 이 없어 requests 가 Latin-1 로 읽는다 — 「January – March」의 en dash 가
    # 깨져 Q1·Q3 일정이 조용히 빠졌다(2026-11-09 실측). 바이트를 UTF-8 로 직접 푼다.
    d = parse_vw_ics(_fetch(session, urljoin(VW_BASE, path)).content.decode('utf-8', errors='replace'))
    if d is None:  # 실적 일정 경로인데 기간을 못 읽었다 = 제목 꼴이 바뀌었다(조용히 빠지지 않게)
      raise EmptyListError('VW 실적 일정 ICS 해석 실패')
    out.append({**d, 'source': 'ir', 'source_ref': path, 'url': urljoin(VW_BASE, path[:-len('/ics')])})
  return out


# ── 포르쉐(EQS 공개 JSON 피드 — IR 화면이 쓰는 것과 같다) ─────────────────────

PORSCHE_EQS_TOKEN = '280d99fe-1c97-49ce-8a12-e08a72f252c9'  # IR 화면이 쓰는 공개 회사 토큰(비밀 아님)
PORSCHE_FEED = f'https://ir-api.eqs.com/feeds/news/{PORSCHE_EQS_TOKEN}/json'
_PORSCHE_KINDS = ('EQS-News', 'EQS-Ad-hoc', 'EQS-Media')  # AFR(보고서 공표 예고)·DD(임원 거래)·PVR 은 버린다
_P_EARN_TITLE = re.compile(r'\bresults?\b|\bforecast\b|\boutlook\b', re.I)
# 실적 보도자료 제목엔 results 가 거의 없다(2026 Q1·H1·연간 전부 없음 — 실측). 본문 세 낱말이 함께 있으면 실적이다.
_P_EARN_BODY = (re.compile(r'sales revenue', re.I), re.compile(r'operating return on sales', re.I),
                re.compile(r'operating (profit|result)', re.I))
_P_DELIV_TITLE = re.compile(r'\bdeliver', re.I)
_P_DELIV_BODY = (re.compile(r'\bdeliver', re.I), re.compile(r'first (quarter|half|nine months)', re.I))
# 전망 변경이 실적·ad-hoc 이 아닌 일반 뉴스로 온 적이 있다(2026-09-09 Bugatti Rimac 매각 — 조사 노트).
_P_GUIDE_BODY = re.compile(r'previous forecast', re.I)


def classify_porsche(kind: str, title: str, body_text: str) -> str | None:
  if kind not in _PORSCHE_KINDS:
    return None
  if _P_EARN_TITLE.search(title) or all(rx.search(body_text) for rx in _P_EARN_BODY):
    return 'earnings_release'
  if _P_DELIV_TITLE.search(title) or all(rx.search(body_text) for rx in _P_DELIV_BODY):
    return 'sales_release'
  if _P_GUIDE_BODY.search(body_text):
    return 'guidance'
  return None


def parse_porsche(payload: dict) -> list[dict]:
  out = []
  for it in payload.get('items') or []:
    kind = (it.get('_eqs') or {}).get('news_type') or ''
    t = classify_porsche(kind, it.get('title') or '', html_to_text(it.get('content_html') or ''))
    if t:
      out.append(_row(t, it['title'], it['url'], it['date_published'][:10], kind))  # date_published 는 UTC
  return out


def fetch_porsche(session: requests.Session, since: str) -> list[dict]:
  params = {'companyToken': PORSCHE_EQS_TOKEN, 'lang': 'en', 'from': since, 'till': date.today().isoformat(),
            'limit': -1}
  payload = _fetch(session, PORSCHE_FEED, params=params).json()
  return parse_porsche(payload)


# ── 폴라리스(Q4 Inc 피드) ─────────────────────────────────────────────────────

# 🔓 Q4 Inc 피드의 apiKey 는 IR 웹페이지가 브라우저에 그대로 내려 주는 공개 키다(비밀 아님 · 조사 노트 us_domestic.md).
#    .env 에 둘 값이 아니다. 키가 바뀌면 피드가 4xx 를 내고 상태 표에 error 로 남는다.
PII_Q4_API_KEY = 'BF185719B0464B3CB809D23926182246'
PII_BASE = 'https://ir.polaris.com'
_Q4_COMMON = {'apiKey': PII_Q4_API_KEY, 'LanguageId': 1, 'pageSize': -1, 'pageNumber': 0, 'tagList': '',
              'includeTags': 'true', 'year': -1, 'excludeSelection': 1}
PII_REPORTS = (f'{PII_BASE}/feed/FinancialReport.svc/GetFinancialReportList', {**_Q4_COMMON, 'reportTypes': ''})
PII_EVENTS = (f'{PII_BASE}/feed/Event.svc/GetEventList',
                  {**_Q4_COMMON, 'eventSelection': 3, 'eventDateFilter': 3, 'includeFinancialReports': 'true',
                   'includePresentations': 'true', 'includePressReleases': 'true', 'sortOperator': 1})
_PII_QUARTERS = {'First Quarter': 1, 'Second Quarter': 2, 'Third Quarter': 3, 'Fourth Quarter': 4}
_PII_EARNINGS_EVENT = re.compile(r'\bQ([1-4])\b(?:\s*&\s*FY)?\s+(20\d\d)\s+Earnings', re.I)


def _us_date(s: str) -> str:
  return datetime.strptime(s.split(' ')[0], '%m/%d/%Y').date().isoformat()


def polaris_earnings_events(events: list[dict]) -> dict[str, list[dict]]:
  """실적 콜 이벤트 → {'2026-Q3': [이벤트…](이른 날 먼저)}. Q4 콜(「Q4 & FY 2025」)은 '2025-Q4'.

  한 분기에 이벤트가 둘 이상일 수 있다(콜 · 다시 듣기 등) — 전부 «실적 콜»로 묶어 investor_day 로 새지 않게 한다."""
  out: dict[str, list[dict]] = {}
  for e in events:
    m = _PII_EARNINGS_EVENT.search(e.get('Title') or '')
    if m and e.get('StartDate'):
      out.setdefault(f'{m.group(2)}-Q{m.group(1)}', []).append(e)
  for es in out.values():
    es.sort(key=lambda e: _us_date(e['StartDate']))
  return out


def parse_polaris(reports: list[dict], events: list[dict]) -> list[dict]:
  """분기 보고의 발표자료 → presentation(날짜 = 같은 분기 첫 실적 콜 이벤트일) · 실적 콜이 아닌 이벤트 첨부 → investor_day.

  실적 콜 이벤트의 첨부 발표자료는 보고 쪽과 같은 문서인데 경로가 다를 때가 있어(2026 Q2 실측) 쓰지 않는다.
  """
  _need('Polaris 재무 보고', reports)
  _need('Polaris 이벤트', events)
  calls = polaris_earnings_events(events)
  out = []
  for rep in reports:
    q = _PII_QUARTERS.get(rep.get('ReportSubType') or '')
    if not q:
      continue
    key = f'{rep["ReportYear"]}-Q{q}'
    call = calls[key][0] if key in calls else None
    for d in rep.get('Documents') or []:
      if d.get('DocumentCategory') == 'presentation' and d.get('DocumentPath'):
        out.append(_row('presentation', f'{rep["ReportTitle"]} {d.get("DocumentTitle") or ""}', d['DocumentPath'],
                        _us_date(call['StartDate']) if call else None, 'financial-report', quarter=key, wait='call'))
  call_ids = {id(e) for es in calls.values() for e in es}
  for e in events:
    if id(e) in call_ids or not e.get('StartDate'):
      continue
    for a in e.get('Attachments') or []:
      if (a.get('Title') or '').lower() == 'presentation' and a.get('Url'):
        out.append(_row('investor_day', e['Title'], a['Url'], _us_date(e['StartDate']), 'event'))
  return out


def parse_polaris_dates(events: list[dict]) -> list[dict]:
  """실적 콜 → 일정 행. 기간 = 'YYYY-Qn', 4분기 콜(「Q4 & FY」)은 연간 발표라 'YYYY-FY'."""
  calls = _need('Polaris 실적 콜 이벤트', list(polaris_earnings_events(events).items()))
  out = []
  for key, es in calls:
    e = es[0]
    out.append({'period': key.replace('-Q4', '-FY'), 'event_date': _us_date(e['StartDate']),
                'quote': f'{e["Title"]} {e["StartDate"]}', 'source': 'ir', 'source_ref': str(e.get('EventId') or ''),
                'url': urljoin(PII_BASE, e['LinkToDetailPage']) if e.get('LinkToDetailPage') else None})
  return out


def _polaris_lists(session: requests.Session) -> tuple[list[dict], list[dict]]:
  reports = _fetch(session, PII_REPORTS[0], params=PII_REPORTS[1]).json()['GetFinancialReportListResult']
  events = _fetch(session, PII_EVENTS[0], params=PII_EVENTS[1]).json()['GetEventListResult']
  return reports, events


def fetch_polaris(session: requests.Session, since: str) -> list[dict]:
  return parse_polaris(*_polaris_lists(session))


def fetch_polaris_dates(session: requests.Session, since: str) -> list[dict]:
  return [d for d in parse_polaris_dates(_polaris_lists(session)[1]) if d['event_date'] >= since]


# ── 현대차(날짜 칸 없음 → 같은 분기 DART 연결 잠정실적 공시일) ───────────────

HYUNDAI_BASE = 'https://www.hyundai.com'
HYUNDAI_URL = f'{HYUNDAI_BASE}/wsvc/ww/quarterlyResults.detail.do'


def parse_hyundai(payload: dict, year: int) -> list[dict]:
  """연도 하나. 자료가 없는 해(1월의 새해 등)는 `{"data":[],"resultCode":"0000"}` 로 온다 — 정상 0건(2026-11-09 실측 2027)."""
  if payload.get('resultCode') != '0000':
    raise ValueError(f'현대차 IR 응답 코드 {payload.get("resultCode")}')
  out = []
  for it in payload.get('data') or []:
    q = f'{year}-Q{it["quarter"]}'
    if it.get('presentationValue'):
      out.append(_row('presentation', f'{year}년 {it["quarter"]}분기 경영실적 발표자료',
                      urljoin(HYUNDAI_BASE, it['presentationValue']), None, 'quarterly-results', quarter=q))
    if it.get('guidanceValue'):
      out.append(_row('guidance', f'{year}년 {it["quarter"]}분기 가이던스 자료',
                      urljoin(HYUNDAI_BASE, it['guidanceValue']), None, 'quarterly-results', quarter=q))
  return out


def fetch_hyundai(session: requests.Session, since: str) -> list[dict]:
  return [r for y in _years(since)
          for r in parse_hyundai(_fetch(session, HYUNDAI_URL, method='POST', data={'year': y, 'lang': 'ko'}).json(), y)]


# ── 기아 ──────────────────────────────────────────────────────────────────────

KIA_URL = 'https://worldwide.kia.com/api/investors/business-sales-results'
KIA_FILES = 'https://worldwide.kia.com/files/'
# 자료가 없는 해는 HTTP 200 에 이 오류 본문이 온다(2026-11-09 실측 2027) — 정상 0건. 다른 오류 본문은 멈춘다.
_KIA_EMPTY_YEAR = 'index list not found'


def parse_kia(payload: dict) -> list[dict]:
  """type='business'(분기 경영실적)의 PDF 만. 'sales'(판매 엑셀)·AOD 음성은 버린다."""
  if 'error' in payload:
    if (payload.get('error') or {}).get('message') == _KIA_EMPTY_YEAR:
      return []
    raise ValueError(f'기아 IR 응답 오류(status {payload.get("status")})')
  out = []
  for it in (payload.get('data') or {}).get('list') or []:
    if it.get('type') != 'business' or not it.get('publicatedAt'):
      continue
    for f in it.get('files') or []:
      if (f.get('fileName') or '').lower().endswith('.pdf'):
        title = re.sub(r'\.pdf$', '', f.get('title') or it.get('title') or '', flags=re.I)
        out.append(_row('presentation', title, KIA_FILES + f['path'], it['publicatedAt'][:10], 'business'))
  return out


def fetch_kia(session: requests.Session, since: str) -> list[dict]:
  return [r for y in _years(since)
          for r in parse_kia(_fetch(session, KIA_URL, params={'language': 'ko', 'year': y, 'page': 1}).json())]


# ── 현대모비스(HTML 조각 · 날짜 칸 없음 → DART) ──────────────────────────────

MOBIS_BASE = 'https://www.mobis.com'
MOBIS_URL = f'{MOBIS_BASE}/kr/ir/irReportLoad.do'
_MOBIS_PERIOD = re.compile(r'(\d{4})년\s*(?:(\d)분기|(연간))')


def _mobis_url(href: str, file_name: str) -> str:
  """다운로드 URL 에 서버 파일명을 덧붙인다 — ir_source_id 가 이것을 키로 쓴다(fileId 는 요청마다 바뀐다)."""
  url = urljoin(MOBIS_BASE, href)
  return f'{url}{"&" if urlsplit(url).query else "?"}{urlencode({"fileNm": file_name})}'


def parse_mobis(html: str) -> list[dict]:
  """연도 하나. 자료가 없는 해는 빈 표 — 정상 0건(2026-11-09 실측 2027). 분기를 못 읽은 제목은 «날짜 없음»으로 센다."""
  out = []
  for tr in BeautifulSoup(html, 'html.parser').select('tbody tr'):
    title = tr.select_one('p.b')
    a = tr.select_one('a[href*="PdfFileDown.do"][filenm]')
    if not title or not a:
      continue
    t = _nfc(title.get_text(' ', strip=True))
    m = _MOBIS_PERIOD.search(t)
    q = f'{m.group(1)}-Q{m.group(2) or 4}' if m else None
    out.append(_row('presentation', t, _mobis_url(a['href'], a['filenm']), None, 'performance', quarter=q))
  return out


def fetch_mobis(session: requests.Session, since: str) -> list[dict]:
  return [r for y in _years(since) for r in parse_mobis(
    _fetch(session, MOBIS_URL, params={'type': 'performance', 'pageIndex': 1, 'srcYear': y}).text)]


# ── KGM(자료실 JSON 하나에 4종) ───────────────────────────────────────────────

KGM_URL = 'https://web.kg-mobility.com/app/display/about/getAboutKGMDataRoomContentsList.do'
_KGM_TITLE_DATE = re.compile(r'\((\d{4})\.(\d{1,2})\.(\d{1,2})\)')
_KGM_FILE_DATE = re.compile(r'/(\d{4})(\d{2})(\d{2})\d*_[^/]+$')
_KGM_QUARTER = re.compile(r'(\d{4})년\s*(\d)분기')


def _ymd(m: re.Match) -> str:
  return f'{int(m.group(1))}-{int(m.group(2)):02d}-{int(m.group(3)):02d}'


def parse_kgm(payload: dict) -> list[dict]:
  """releaseList(발표자료) → presentation(「CEO IR설명회」 → investor_day) · managementList(경영실적 보도자료) →
  earnings_release. 제목 칸 = `fileNm`(2026-11-09 실물). salesList·businessList 는 버린다.

  날짜:
  - 보도자료 = 파일명 타임스탬프(보도 당일 올린다 — 2025 실물 4건이 전부 발표 다음 날 안쪽).
  - 발표자료 = 제목의 「(2025.10.29)」 → 없으면 같은 분기 보도자료의 날짜 → 없으면 보류(wait='press').
    발표자료 파일명 타임스탬프는 쓰지 않는다 — 재업로드면 한 달 넘게 늦다(2025 3분기: 발표 10-29 · 파일 12-01).
  - 분기도 제목 날짜도 없는 발표자료(Pressday·CEO IR설명회)는 «날짜 없음»(수집기가 세어 찍고 싣지 않는다).
  """
  if payload.get('code') != '0000':
    raise ValueError(f'KGM 자료실 응답 코드 {payload.get("code")}')
  body = payload.get('body') or {}

  def files(list_name: str) -> list[tuple[str, str]]:
    out = []
    for group in body.get(list_name) or []:
      for f in group.get('fileList') or []:
        title, url = _nfc(f.get('fileNm') or ''), f.get('fileUrl') or ''
        if title and url:
          if not re.search(r'\d{4}년', title) and group.get('date'):
            title = f'{group["date"]}년 {title}'  # managementList 제목엔 연도가 없다(「3분기 경영실적 보도자료」)
          out.append((title, url))
    return out

  releases = _need('KGM 발표자료(releaseList)', files('releaseList'))
  press = _need('KGM 경영실적 보도자료(managementList)', files('managementList'))

  out, press_dates = [], {}
  for title, url in press:
    m, d = _KGM_QUARTER.search(title), _KGM_FILE_DATE.search(url)
    published = _ymd(d) if d else None
    if m and published:
      q = f'{m.group(1)}-Q{m.group(2)}'
      press_dates[q] = min(press_dates.get(q, published), published)
    out.append(_row('earnings_release', title, url, published, 'managementList'))
  for title, url in releases:
    m, d = _KGM_QUARTER.search(title), _KGM_TITLE_DATE.search(title)
    q = f'{m.group(1)}-Q{m.group(2)}' if m else None
    published = _ymd(d) if d else press_dates.get(q)
    t = 'investor_day' if 'CEOIR설명회' in title.replace(' ', '') else 'presentation'
    out.append(_row(t, title, url, published, 'releaseList', quarter=q, wait='press'))
  return out


def fetch_kgm(session: requests.Session, since: str) -> list[dict]:
  return parse_kgm(_fetch(session, KGM_URL).json())


# ── 등록부 ────────────────────────────────────────────────────────────────────

# 스텔란티스·빈패스트 = EDGAR 로 충분(어댑터 없음) · GM = 접근 차단(아래 probe_gm)
IR_LISTS: dict[str, Callable[[requests.Session, str], list[dict]]] = {
  'VOW3.DE': fetch_vw,
  'P911.DE': fetch_porsche,
  'PII': fetch_polaris,
  '005380': fetch_hyundai,
  '000270': fetch_kia,
  '012330': fetch_mobis,
  '003620': fetch_kgm,
}

# customer_earnings_dates 행({'period','event_date','quote','source','source_ref','url'}) — 문서가 아니다.
IR_EARNINGS_DATES: dict[str, Callable[[requests.Session, str], list[dict]]] = {
  'VOW3.DE': fetch_vw_dates,
  'PII': fetch_polaris_dates,
}


# ── GM IR 접근 시험(Task 12 워크플로가 GHA 러너에서 부른다) ────────────────────

GM_IR_URL = 'https://investor.gm.com/shareholders/quarterly-results'
GM_BLOCKED_REASON = 'GM IR 사이트가 자동 접근을 막아(HTTP 403) 실적 발표자료·미국 분기 소매 판매를 못 모읍니다'


def gm_probe_status(codes: list[int | None]) -> tuple[str, str | None]:
  """시도별 HTTP 상태(연결 실패 = None) → (status, reason). 한 번이라도 200 이면 ok."""
  if 200 in codes:
    return 'ok', None
  blocked = next((c for c in codes if c in BLOCKED_HTTP), None)
  if blocked:
    return 'blocked', GM_BLOCKED_REASON.replace('HTTP 403', f'HTTP {blocked}')
  last = next((c for c in reversed(codes) if c is not None), None)
  return 'error', f'GM IR 사이트 접근 실패(HTTP {last})' if last else 'GM IR 사이트 접근 실패(연결 안 됨)'


def gm_probe_exit(status: str) -> int:
  """워크플로 종료 코드 — 차단(blocked)은 알려진 상태라 0, 그 밖의 실패(error)는 1 로 눈에 띄게."""
  return 1 if status == 'error' else 0


def _playwright_status(url: str) -> int | None:
  try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
      browser = p.chromium.launch(headless=True)
      try:
        resp = browser.new_page(user_agent=BROWSER_UA).goto(url, timeout=60_000)
        return resp.status if resp else None
      finally:
        browser.close()
  except Exception:  # 브라우저 미설치·시간 초과 = 상태 없음(None) — 예외 문장은 찍지 않는다
    return None


def probe_gm() -> int:
  """requests(브라우저 UA) → 실패 시 Playwright 1회. HTTP 상태만 찍고 customer_collect_status(GM, 'ir_list') 에 남긴다."""
  sys.stdout.reconfigure(encoding='utf-8', errors='replace')
  from lib.bootstrap import init_script
  init_script(__file__)
  from lib import db

  codes: list[int | None] = []
  try:
    codes.append(requests.get(GM_IR_URL, headers={'User-Agent': BROWSER_UA}, timeout=TIMEOUT_S).status_code)
  except requests.RequestException:
    codes.append(None)
  print(f'GM IR requests: HTTP {codes[-1]}')
  if codes[-1] != 200:
    codes.append(_playwright_status(GM_IR_URL))
    print(f'GM IR Playwright: HTTP {codes[-1]}')
  status, reason = gm_probe_status(codes)

  found = db.get_client().table('companies').select('id').eq('ticker', 'GM').eq('status', 'active').execute().data
  if not found:
    print('GM 회사 행 없음 — 상태를 남기지 않는다')
    return 1
  with db.WriteSession() as ws:
    ws.table('customer_collect_status').upsert(
      {'company_id': found[0]['id'], 'collector': 'ir_list', 'status': status, 'reason': reason,
       'checked_at': datetime.now(timezone.utc).isoformat()},
      on_conflict='company_id,collector').execute()
  print(f'상태 기록: ir_list = {status}')
  return gm_probe_exit(status)
