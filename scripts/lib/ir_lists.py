"""고객사 IR 사이트 «문서 목록» 어댑터 — collect_customer_docs.py 가 EDGAR·DART 행과 같은 upsert 로 싣는다(source='ir').

회사마다 «받기»(`fetch_<회사>(session, since)`)와 «응답 → 행» 순수 함수(`parse_<회사>(…)`)를 가른다.
시험(test_ir_lists.py)은 순수 함수만, 2026-11 실물을 잘라 둔 픽스처(fixtures/ir_lists/)로 본다.

행 = customer_documents 칸(company_id 는 수집기가 붙인다). source_id = `ir_source_id(url)` 한 곳에서만 만든다
(호스트 + URL 경로, 쿼리 제외 — 같은 문서가 두 목록(VW RSS·실적 행렬)에 나와도 하나로 합쳐진다. 예외는 그 함수 docstring).

날짜 칸이 없는 목록(현대차·현대모비스 IR · KGM 발표자료 · 빈패스트·리비안 분기 보고서 등)은 published_at=None
+ `_quarter`('2026-Q3') + `_wait`(어디서 날짜가 올지)로 내보내고, 수집기가 `resolve_dates` 로 채운다. 못 찾으면 행을 버리지 않고 «보류»로 세어
알린다(날짜를 지어내지 않는다 — 다음 실행에 근거가 생기면 그때 들어간다). 분기도 날짜도 없는 행은 «날짜 없음»으로
따로 센다(다음 실행에도 안 풀린다).

목록이 통째로 0건이면 사이트 구조가 바뀐 것이다 — 하위 목록마다 `EmptyListError`(문장이 상태 표 사유로 나간다).

실적 일정(customer_earnings_dates)은 문서가 아니라 `IR_EARNINGS_DATES` 로 따로 낸다(VW ICS · 폴라리스 이벤트).
기간 = 'YYYY-Qn' · 연간(4분기+연간 발표) = 'YYYY-FY'.

GM IR 은 Akamai 가 로컬·Playwright 모두 403 이라 어댑터가 없다 — `probe_gm()` 이 GHA 러너에서 접근만 시험하고
customer_collect_status(GM, 'ir_list') 에 결과를 남긴다(Task 12 워크플로가 부른다).
"""
import json
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
from requests.utils import requote_uri

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
           data: dict | None = None, headers: dict | None = None) -> requests.Response:
  """headers 는 기본 헤더(브라우저 UA)에 덧씌운다 — VW 갤러리가 `Accept: application/json` 을 줘야 JSON 을 낸다."""
  def _once():
    r = session.request(method, url, params=params, data=data, headers={'User-Agent': BROWSER_UA, **(headers or {})},
                        timeout=TIMEOUT_S)
    r.raise_for_status()
    return r
  return with_retry(_once, _label=urlsplit(url).netloc)


# ── 문서 «내용» 받기(숫자 수집기·파서가 함께 쓴다) ─────────────────────────────

# IR 문서 한 건의 상한 — 넘으면 받지 않는다(리비안 180MB·AI Day 431MB 같은 PDF 를 통째로 메모리에 올리면 러너가 죽는다).
# 🔴 숫자 수집기(collect_customer_numbers.py)는 __main__ 으로 돌고 시험은 따로 읽어 사본이 둘이 된다 — 파서와 함께 쓰는
#    이 셋(MAX_IR_BYTES·TooLarge·ir_get)은 여기 한곳에 두고 양쪽이 import 한다(예외 isinstance 가 빗나가지 않게).
MAX_IR_BYTES = 50 * 1024 * 1024


class TooLarge(Exception):
  """IR 문서가 MAX_IR_BYTES 를 넘는다. size = Content-Length(바이트) · 머리에 없어 받다가 넘었으면 None.
  일시 오류가 아니다 — with_retry 의 판정(상태 코드·연결 예외·문구)에 안 걸려 재시도하지 않는다."""

  def __init__(self, size: int | None):
    self.size = size
    super().__init__(f'IR 문서 상한 초과: {size if size is not None else "Content-Length 없음"}')


def ir_get(session, url: str) -> requests.Response:
  """IR 문서 — 목록 어댑터와 같은 브라우저 UA(없으면 일부 사이트가 403) · 5xx 만 재시도 · MAX_IR_BYTES 상한.
  stream 으로 받아 Content-Length 가 넘으면 본문을 안 읽고, 머리가 없으면 1MB 씩 모으다 넘는 순간 끊는다.
  다 모으면 r._content 에 넣어 호출부의 r.content·r.encoding·r.apparent_encoding 이 평소대로 돈다."""
  def _once():
    r = session.get(url, headers={'User-Agent': BROWSER_UA}, timeout=60, stream=True)
    r.raise_for_status()
    length = r.headers.get('Content-Length')
    if length and length.isdigit() and int(length) > MAX_IR_BYTES:
      r.close()
      raise TooLarge(int(length))
    chunks, total = [], 0
    for chunk in r.iter_content(1 << 20):
      total += len(chunk)
      if total > MAX_IR_BYTES:
        r.close()
        raise TooLarge(None)
      chunks.append(chunk)
    r._content = b''.join(chunks)
    r._content_consumed = True
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

# 보류 사유(`_wait`) → 수집기가 찍는 문장. 'dart'·'edgar' 만 resolve_dates 가 채운다(수집기가 회사의 공시 식별자로
# 어느 쪽 날짜를 넘길지 고른다) — 나머지는 어댑터가 같은 응답 안에서 이미 찾아봤고 없었던 것이라, 다음 실행에 원문에
# 생겨야 풀린다.
HOLD_REASONS = {
  'dart': '같은 분기 DART 연결 잠정실적 공시가 아직 없다',
  'press': '같은 분기 경영실적 보도자료가 자료실에 아직 없다',
  'rss': '같은 분기 실적 보도자료가 RSS 에 없다',
  'call': '같은 분기 실적 콜 이벤트가 아직 없다',
  'eqs': '같은 분기 실적 보도자료가 EQS 피드에 아직 없다',
  'edgar': '같은 분기 실적을 읽어 낸 EDGAR 실적 공시(6-K·8-K)가 아직 없다',
}
_QDATE_WAITS = ('dart', 'edgar')  # resolve_dates 가 qdates 로 채우는 사유
NO_DATE = 'nodate'  # 분기도 날짜도 없는 행 — 다음 실행에도 안 풀린다


def quarter_dates(prelims: list[dict]) -> dict[str, str]:
  """DART 잠정실적 공시({'title','published_at'}) → {'2026-Q3': '2026-10-29'}. 분기 = 공시 직전 분기, 같은 분기면 이른 날."""
  return _earliest_by_quarter(p['published_at'] for p in prelims
                              if _CONSOLIDATED_PRELIM in p['title'].replace(' ', ''))


def _earliest_by_quarter(days) -> dict[str, str]:
  """실적 발표일(YYYY-MM-DD) → {대상 분기: 가장 이른 날}. 대상 분기 = 발표 직전 분기(1~3월 발표 = 전년 4분기)."""
  out: dict[str, str] = {}
  for day in days:
    d = date.fromisoformat(day)
    q = (d.month - 1) // 3
    key = f'{d.year - 1}-Q4' if q == 0 else f'{d.year}-Q{q}'
    if key not in out or day < out[key]:
      out[key] = day
  return out


def _quarter_end(q: str) -> date:
  y, n = int(q[:4]), int(q[-1])
  return date(y, 12, 31) if n == 4 else date(y, 3 * n + 1, 1) - timedelta(days=1)


def results_quarter_dates(pairs) -> dict[str, str]:
  """EDGAR 회사 — (실적 문서가 보고한 분기 'YYYY-Qn', 그 문서 접수일) → {분기: 가장 이른 접수일}.

  분기는 접수일로 «추정»하지 않고 숫자 수집기가 문서에서 읽은 기간을 쓴다(수집기가 customer_reported_results 로
  짝을 만든다). 빈패스트 실적 6-K 는 분기 끝 뒤 2~4달에 나와(2026-11-10 DB: 2분기 실적 2026-10-19 · 4분기 실적
  2025-04-24) «분기 끝 뒤 첫 실적 공시»로 고르면 3분기 행이 2분기 실적일을 받는다. 분기 끝 전 접수일은 버린다."""
  out: dict[str, str] = {}
  for q, day in pairs:
    if day > _quarter_end(q).isoformat() and (q not in out or day < out[q]):
      out[q] = day
  return out


# 분기 말 + 이 날수 안에 실적이 나온다(국내·독일·미국 실물 최장 = 4분기 3월 초). 이보다 오래된 «날짜 미상» 행은 범위 밖.
_RESULTS_LAG_DAYS = 100


def resolve_dates(rows: list[dict], qdates: dict[str, str], since: str) -> tuple[list[dict], dict[str, int]]:
  """`_quarter` 행에 날짜를 채우고 since 이후만 남긴다. → (행, {보류 사유: 수}).

  qdates = {분기: 날짜} — 'dart'·'edgar' 사유 행만 여기서 채운다(DART 잠정실적 공시일 · EDGAR 실적 문서 접수일 중
  수집기가 회사에 맞는 쪽을 넘긴다).
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
      if wait in _QDATE_WAITS:
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
VW_DELIVERIES = f'{VW_BASE}/en/deliveries-to-customers-15741'
VW_PRESENTATIONS = f'{VW_BASE}/en/presentations-15715'  # 올해 발표자료(연도 없는 경로) + Key Investor Presentations

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


_VW_DELIV_TABLE_DATE = re.compile(r'-\s*(\d{4}-\d{2}-\d{2})\s*$')


def parse_vw_deliveries(html: str) -> list[str]:
  """「Deliveries to Customers」 페이지 → 분기 인도 표 PDF 를 올린 날들. 링크 글 끝의 날짜를 읽는다
  (「… - January - March 2026 - 2026-04-13」 · 파일명 꼴은 회차마다 달라 쓰지 않는다 — 2026-11-10 실측).

  2026-11-10 실측: 이 페이지엔 인도 «보도자료» 링크가 없고 표 PDF 만 있다. 보도자료는 RSS 에만 있고, 1분기 제목엔
  deliver 낱말이 없어(「maintains stable market share … in Q1」) 제목 판정이 놓친다 — 같은 날 표가 그 근거다(parse_vw)."""
  out = []
  for a in BeautifulSoup(html, 'html.parser').select('div.file-attachment a[href]'):
    m = _VW_DELIV_TABLE_DATE.search(a.get_text(' ', strip=True))
    if m:
      out.append(m.group(1))
  return _need('VW 인도 표', list(dict.fromkeys(out)))


# 발표자료 갤러리 타일 제목 → (doc_type, form). 위에서부터 첫 일치(실적 콜 꼴보다 Pre-Close Call 이 먼저).
# 나머지(ESG 회의·연설문 등)는 other + 타일 종류(D4 — 새 doc_type 을 만들지 않는다).
_VW_TILE_KINDS = (
  (re.compile(r'\bRoadshow\b', re.I), 'presentation', 'roadshow'),
  (re.compile(r'\bPre-Close Call\b', re.I), 'presentation', 'pre-close-call'),
  (re.compile(r'\bChina Investor Update\b', re.I), 'investor_day', 'china-investor-update'),
  (re.compile(r'\bInvestor (?:and Analyst )?Update\b|\bCapital Markets Day\b|\bInvestor Day\b', re.I),
   'investor_day', 'investor-update'),
  (re.compile(r'\bTargets?\b|\bTarget Picture\b|\bFuture Plan\b', re.I), 'investor_day', 'strategy-update'),
  (re.compile(r'\bFactbook\b', re.I), 'fact_sheet', 'factbook'),
  (re.compile(r'\b(?:Q[1-4]|H1|9M|Full Year|FY)\s+20\d\d\b.*\bCall\b', re.I), 'presentation', 'earnings-call'),
)


def _vw_tiles(html: str) -> list[tuple[dict, str | None]]:
  """갤러리 타일 → (행, 랜딩 페이지 URL). 랜딩 = 실적 행렬이 거는 그 문서의 페이지(공유 버튼의 url) — 같은 문서 합치기용."""
  out = []
  for t in BeautifulSoup(html, 'html.parser').select('div.document-tile'):
    a = t.select_one('.document-tile--text > a[href]')
    title, tm = t.select_one('.document-tile--title'), t.select_one('.document-tile--description time')
    if not a or not title or not tm:
      continue
    title = title.get_text(' ', strip=True)
    kind = t.select_one('.document-tile--description span')
    form = (kind.get_text(strip=True) if kind else 'document').lower()
    doc_type, form = next(((d, f) for rx, d, f in _VW_TILE_KINDS if rx.search(title)), ('other', form))
    share = t.select_one('[native-share][up-data]')
    landing = None
    if share:
      try:
        landing = json.loads(share['up-data']).get('url')
      except ValueError:
        landing = None
    out.append((_row(doc_type, title, a['href'], _us_date(tm.get_text(strip=True)), form), landing))
  return out


def parse_vw_gallery(payload: dict) -> list[dict]:
  """발표자료 갤러리 JSON 한 쪽(`{"html": 타일, "nextOffset": n|null}`) → 행. 날짜 = 타일의 MM/DD/YYYY 그대로 ·
  url = uploads.vw-mms.de PDF 직링크(쿼리의 올린 시각은 ir_source_id 가 버린다).
  같은 날 행사 묶기(목표 발표 5건)와 실적 행렬과의 합치기는 쪽을 다 모은 뒤 parse_vw 가 한다."""
  return [r for r, _ in _vw_tiles(payload.get('html') or '')]


def vw_gallery_ids(html: str) -> list[str]:
  """발표자료 페이지 → 갤러리 ID(목록 URL 이 `up-data` 에 박혀 있다 — 조사 ir_germany ①)."""
  return _need('VW 발표자료 갤러리', list(dict.fromkeys(re.findall(r'/en/item/galleries/(\d+)/documents', html))))


def vw_presentation_pages(html: str, since: str) -> list[str]:
  """올해 쪽에 걸린 지난 연도 발표자료 쪽(`/en/presentations-2025-20142`) 중 since 의 연도부터. 연도는 링크에서 읽는다."""
  pages = re.findall(r'href="(/en/presentations-(\d{4})-\d+)"', html)
  return list(dict.fromkeys(p for p, y in pages if int(y) >= int(since[:4])))


def _vw_gallery_rows(pages: list[dict], matrix_ids: set[str]) -> list[dict]:
  """갤러리 쪽 전부 → 행. 실적 행렬에 이미 있는 문서(랜딩 페이지가 같은 실적 콜 발표자료)는 뺀다 — 행렬 행이 이미
  DB 키다. 행사 자료는 같은 날 묶음으로 본다: 2026-10-12 목표 발표 5건 중 3건은 제목에 목표 낱말이 없다."""
  rows = {}
  for p in pages:
    for r, landing in _vw_tiles(p.get('html') or ''):
      if landing and ir_source_id(landing) in matrix_ids:
        continue
      rows.setdefault(r['source_id'], r)
  event_form = {}
  for r in rows.values():
    if r['doc_type'] == 'investor_day':
      event_form.setdefault(r['published_at'], r['form'])
  for r in rows.values():
    if r['doc_type'] == 'other' and r['published_at'] in event_form:
      r['doc_type'], r['form'] = 'investor_day', event_form[r['published_at']]
  return list(rows.values())


def parse_vw(rss_xml: str | bytes, results_html: str, adhoc_html: str, deliveries_html: str,
             gallery_pages: list[dict]) -> list[dict]:
  """RSS + 실적 행렬 + ad-hoc + 인도 표 날짜 + 발표자료 갤러리 → 행.
  같은 보도자료가 RSS·행렬에 둘 다 있으면 하나(행렬의 종류 · RSS 의 제목·날짜).

  행렬에는 날짜가 없다 — 같은 열(연도·분기)의 보도자료가 RSS 에 있으면 그 날짜를 보고서·발표자료에도 쓴다
  (세 문서가 같은 날 나온다). RSS(약 100건 ≈ 2년)에 없으면 `_quarter`(wait='rss')로 내보내 수집기가 범위 밖으로 거른다.

  제목으로 종류를 못 정한 RSS 글이 분기 인도 표를 올린 날과 같은 날이면 인도 보도자료다(1분기 제목엔 deliver 가 없다).
  단 그날 제목으로 이미 인도 보도자료가 된 글이 있으면 그 글이 인도 보도이고 나머지는 홍보 글이다.
  """
  rss = {r['source_id']: r for r in parse_vw_rss(rss_xml)}
  titled = {r['published_at'] for r in rss.values() if r['doc_type'] == 'sales_release'}
  deliv_days = set(parse_vw_deliveries(deliveries_html)) - titled
  for r in rss.values():
    if r['doc_type'] is None and r['published_at'] in deliv_days:
      r['doc_type'] = 'sales_release'
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
  for r in _vw_gallery_rows(gallery_pages, {ir_source_id(u) for *_, u in cells}):
    out.setdefault(r['source_id'], r)
  return list(out.values())


def _vw_gallery_pages(session: requests.Session, gallery_id: str) -> list[dict]:
  """갤러리 하나를 끝까지(`nextOffset` 이 null 이 될 때까지 · 한 쪽 3건). 0건 판정은 fetch_vw 가 갤러리 전체 합계로 한다."""
  url, offset, pages = f'{VW_BASE}/en/item/galleries/{gallery_id}/documents', 0, []
  while offset is not None:
    p = _fetch(session, url, params={'offset': offset}, headers={'Accept': 'application/json'}).json()
    pages.append(p)
    nxt = p.get('nextOffset')
    if nxt is not None and nxt <= offset:
      raise ValueError(f'VW 발표자료 갤러리 {gallery_id} 쪽 번호가 앞으로 가지 않는다({offset} → {nxt})')
    offset = nxt
  return pages


def fetch_vw(session: requests.Session, since: str) -> list[dict]:
  main = _fetch(session, VW_PRESENTATIONS).text
  htmls = [main] + [_fetch(session, urljoin(VW_BASE, p)).text for p in vw_presentation_pages(main, since)]
  ids = list(dict.fromkeys(g for h in htmls for g in vw_gallery_ids(h)))
  pages = [p for g in ids for p in _vw_gallery_pages(session, g)]
  # 0건 판정은 갤러리 «전체 합계»로 — 새해에 올해 쪽 갤러리 하나가 비어도 RSS·행렬·ad-hoc 까지 멈추지 않게.
  # 전부 비면 갤러리 구조가 바뀐 것이다.
  _need('VW 발표자료 갤러리 전체', [r for p in pages for r in parse_vw_gallery(p)])
  return parse_vw(_fetch(session, VW_RSS).content, _fetch(session, VW_RESULTS).text, _fetch(session, VW_ADHOC).text,
                  _fetch(session, VW_DELIVERIES).text, pages)


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


PORSCHE_IR = 'https://investorrelations.porsche.com'
PORSCHE_REPORTS = f'{PORSCHE_IR}/en/financial-information/reports-and-presentations'
# CMD 2026 발표자료 — 고정 경로 1건(조사 ir_germany.md · HEAD 200 application/pdf 31.6MB, 2026-11-10 실측).
# 날짜 근거 = EQS 2026-10-07 보도 「At its Capital Markets Day, Porsche AG presents its strategy ‘Sportwagenschmiede '35’」.
# 보고서 표의 행사 탭에도 있지만 그 표엔 날짜가 없다. 다음 CMD 는 경로가 달라질 것이라 여기 한 건만 둔다.
PORSCHE_CMD = (f'{PORSCHE_IR}/~/media/Files/P/porsche-ir/cmd-2026/CapitalMarketsDay2026.pdf',
               'Capital Markets Day 2026 Presentation',
               # SHORTCUT: CMD 날짜를 EQS 2026-10-07 보도에서 옮겨 적음 → 다음 CMD 때 피드의 Capital Markets Day 보도일에서 읽도록
               '2026-10-07')

# 보고서 표의 행 이름 → (doc_type, form). 모르는 행은 other(D4) + 'report-table'.
_P_REPORT_ROWS = {
  'Conference Calls': ('ir_event', 'conference-call'),
  'Presentation': ('presentation', 'results-presentation'),
  'Pre-Close Call Presentation': ('presentation', 'pre-close-call'),
  'Fact Sheet': ('fact_sheet', 'fact-sheet-xlsx'),  # Task 3 이 이 두 값으로 고른다
  'Quarterly Statement': ('periodic', 'quarterly-statement'),
  'Half-Year Financial Report': ('periodic', 'half-year-report'),
  'Annual & Sustainability Report': ('periodic', 'annual-report'),
  'Annual Financial Statements': ('periodic', 'annual-financial-statements'),
  'ESEF Annual Financial Report (XHTML)': ('other', 'esef'),
  'ESEF Consolidated Financial Report (XHTML)': ('other', 'esef'),
}
_P_COLS = {'Q1': 1, 'H1': 2, 'Q3': 3, 'Q4': 4}  # 머리 칸 앞말 → 분기(「Q4 & Full Year」 = 4분기 · 연간)


def _porsche_file_url(href: str) -> str:
  """뷰어 링크(`/pdf-viewer.aspx?gid=…&src=/~/media/…pdf`)는 src 의 실제 파일로 푼다 — 그대로 두면 ir_source_id 가
  쿼리를 버려 모든 PDF 가 한 키(`/pdf-viewer.aspx`)로 뭉개진다. 파일명의 공백은 %20 으로."""
  u = urlsplit(urljoin(PORSCHE_IR, href))
  if u.path.endswith('/pdf-viewer.aspx'):
    src = (parse_qs(u.query).get('src') or [''])[0]
    if src:
      return requote_uri(urljoin(PORSCHE_IR, src))
  return requote_uri(urljoin(PORSCHE_IR, href))


def parse_porsche_reports(html: str) -> list[dict]:
  """보고서·발표자료 표(연도 탭마다 표 하나 · 행 = 문서 종류 · 열 = 분기) → 행. 표엔 날짜가 없다 — 분기만 실어
  (`_quarter`, wait='eqs') 내보내고 parse_porsche_all 이 같은 분기 EQS 실적 보도일로 채운다.
  연도 = 표를 감싼 탭 id(`tab-12026-pane` 의 끝 네 자리). 머리에 Q1 칸이 없는 표(행사 탭 — 날짜 없는 자료)는 버린다.
  IR 호스트 밖 링크(연차보고서 칸의 뉴스룸 「Online ASR」)는 문서가 아니라 버린다.
  경로로 언어를 가르지 않는다 — FY25 발표자료·팩트시트는 독일어 폴더(results-and-presentations-de) 아래에 있다."""
  rows = {}
  for tb in BeautifulSoup(html, 'html.parser').find_all('table'):
    pane = tb.find_parent(id=re.compile(r'\d{4}-pane$'))
    heads = [th.get_text(' ', strip=True) for th in tb.select('thead th')]
    cols = [next((q for k, q in _P_COLS.items() if h.startswith(k)), None) for h in heads]
    if not pane or 1 not in cols:
      continue
    year = int(re.search(r'(\d{4})-pane$', pane['id']).group(1))
    for tr in tb.select('tbody tr'):
      tds = tr.find_all('td')
      if not tds:
        continue
      label = tds[0].get_text(' ', strip=True)
      doc_type, form = _P_REPORT_ROWS.get(label, ('other', 'report-table'))
      for td, q, head in zip(tds[1:], cols[1:], heads[1:]):
        for a in td.find_all('a', href=True) if q else []:
          url = _porsche_file_url(a['href'])
          if urlsplit(url).netloc != urlsplit(PORSCHE_IR).netloc:
            continue
          r = _row(doc_type, f'{label} {head} {year}', url, None, form, quarter=f'{year}-Q{q}', wait='eqs')
          rows.setdefault(r['source_id'], r)
  return _need('포르쉐 보고서 표', list(rows.values()))


def parse_porsche_all(payload: dict, reports_html: str) -> list[dict]:
  """EQS 피드 + 보고서 표 + CMD 고정 1건. 표 행의 날짜 = 같은 분기 EQS 실적 보도일(피드의 earnings_release 중 그
  분기 가장 이른 날). 없으면 `_quarter` 그대로 — 수집기가 보류로 센다(날짜를 지어내지 않는다)."""
  feed = parse_porsche(payload)
  release = _earliest_by_quarter(r['published_at'] for r in feed if r['doc_type'] == 'earnings_release')
  out = {r['source_id']: r for r in feed}
  for r in parse_porsche_reports(reports_html):
    if r['_quarter'] in release:
      r['published_at'] = release[r.pop('_quarter')]
      r.pop('_wait')
    out.setdefault(r['source_id'], r)
  cmd = _row('investor_day', PORSCHE_CMD[1], PORSCHE_CMD[0], PORSCHE_CMD[2], 'capital-markets-day')
  out.setdefault(cmd['source_id'], cmd)
  return list(out.values())


def fetch_porsche(session: requests.Session, since: str) -> list[dict]:
  # 피드는 since 보다 _RESULTS_LAG_DAYS 앞에서부터 — 범위 안 분기의 실적 보도일이 since 직전일 수 있다(표 행 날짜용).
  # 그 앞 피드 글은 수집기 resolve_dates 가 since 로 거른다.
  start = (date.fromisoformat(since) - timedelta(days=_RESULTS_LAG_DAYS)).isoformat()
  params = {'companyToken': PORSCHE_EQS_TOKEN, 'lang': 'en', 'from': start, 'till': date.today().isoformat(),
            'limit': -1}
  payload = _fetch(session, PORSCHE_FEED, params=params).json()
  return parse_porsche_all(payload, _fetch(session, PORSCHE_REPORTS).text)


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


# ── 빈패스트(링크만 — 숫자는 EDGAR 6-K) ───────────────────────────────────────

VINFAST_IR = 'https://vinfastauto.us/investor-relations/'
# Mobility Day 2025 상세 — 고정 1건(조사 ir_foreign.md 가 짚은 IR 전용 행사 발표 · 다른 행사 상세는 열어 보지 않았다).
# SHORTCUT: 행사 상세 1쪽만 본다 → 다음 투자자 행사가 생기면 행사 목록(/investor-relations/events)에서 상세 쪽을 고르도록
VINFAST_MOBILITY_DAY = f'{VINFAST_IR}events/vinfast-2025-mobility-day'
_VF_PERIOD = re.compile(r'Q([1-4])/(\d{4})')
_VF_EDITION = re.compile(r'/(\d{4})\.(\d{1,2})\.[^/]*$')  # 회사 소개 자료 링크 끝 = 판 이름(`2026.11.-corporate-presentation`)
_VF_PDF_URL = re.compile(r"viewerPdfUrl\s*=\s*'([^']+)'")
_PDF_DATE = re.compile(r'D:(\d{4})(\d{2})(\d{2})')


def parse_vinfast_reports(html: str) -> list[dict]:
  """IR 첫 쪽 「Our Reports」 표(Period · Earnings Release · Delivery · Webcast · Earnings Report) → Earnings Report 칸만
  shareholder_letter(주주서한형 분기 보고서). 실적 보도자료·인도 칸은 SEC 링크(EDGAR 로 이미 받는다) · 웹캐스트는 문서가 아니다.

  표엔 날짜가 없다 — 분기만 실어 wait='edgar'(같은 분기 실적 6-K 접수일). 링크 이름의 날짜(`250410_q424-ec-deck`)는
  쓰지 않는다: 2024 4분기 실적은 2025-04-24 에 나왔다(2026-11-10 DB) — 올린 파일 이름이 발표일이 아니다."""
  out = []
  for tb in BeautifulSoup(html, 'html.parser').find_all('table'):
    heads = [th.get_text(' ', strip=True) for th in tb.find_all('th')]
    if 'Period' not in heads or 'Earnings Report' not in heads:
      continue
    col = heads.index('Earnings Report')
    for tr in tb.select('tbody tr'):
      tds = tr.find_all('td')
      period = tds[0].get_text(' ', strip=True) if tds else ''
      m = _VF_PERIOD.fullmatch(period)  # 「Q1/2024 (Restated)」 행은 보고서 칸이 비었다
      if not m or len(tds) <= col:
        continue
      for a in tds[col].find_all('a', href=True):
        out.append(_row('shareholder_letter', f'VinFast Earnings Report {period}', a['href'], None, 'earnings-report',
                        quarter=f'{m.group(2)}-Q{m.group(1)}', wait='edgar'))
  return _need('빈패스트 Our Reports 표', out)


def vinfast_presentation_link(html: str) -> str:
  """IR 첫 쪽 「Investor - Presentation」 버튼 = 회사 소개 자료 뷰어 쪽(widen). 판이 바뀌면 링크 끝 이름이 바뀐다."""
  a = BeautifulSoup(html, 'html.parser').find('a', string=lambda s: s and s.strip() == 'Investor - Presentation')
  if not a or not a.get('href'):
    raise EmptyListError('빈패스트 회사 소개 자료 링크 0건')
  return a['href']


def vinfast_pdf_url(viewer_html: str) -> str | None:
  """뷰어 HTML 안의 서명된 PDF 주소(`sig.expires` — 만료된다). 행에는 싣지 않고 날짜를 읽을 때만 쓴다."""
  m = _VF_PDF_URL.search(viewer_html)
  return m.group(1) if m else None


def vinfast_edition_date(viewer_url: str, creation: str) -> str | None:
  """회사 소개 자료 날짜 = PDF 를 만든 날(메타데이터 CreationDate · 2026-11 판 = 2026-11-09). IR 쪽에는 날짜가 없다.
  판 이름(링크 끝 `2026.11.`)의 연·월과 같을 때만 쓴다 — 다르면 근거가 어긋난 것이라 날짜 없이 둔다."""
  m, d = _VF_EDITION.search(urlsplit(viewer_url).path), _PDF_DATE.match(creation or '')
  if m and d and (int(m.group(1)), int(m.group(2))) == (int(d.group(1)), int(d.group(2))):
    return f'{d.group(1)}-{d.group(2)}-{d.group(3)}'
  return None


def _pdf_creation(content: bytes) -> str:
  import fitz  # pymupdf(requirements.txt) — 지역 import: 순수 함수 시험이 fitz 없이 돌게
  with fitz.open(stream=content, filetype='pdf') as doc:
    return (doc.metadata or {}).get('creationDate') or ''


def parse_vinfast_event(html: str) -> list[dict]:
  """행사 상세 → 「Details」 칸의 widen 발표 링크 = investor_day. 날짜 = 제목 연도(`VinFast 2025 Mobility Day`) +
  날짜 칸(start-month·start-date). 본문의 애널리스트 노트 링크(증권사 리포트 원문 · D9)는 보지 않는다."""
  soup = BeautifulSoup(html, 'html.parser')
  title = soup.find('h2').get_text(' ', strip=True) if soup.find('h2') else ''
  year, month, day = re.search(r'\b(20\d\d)\b', title), soup.select_one('.start-month'), soup.select_one('.start-date')
  published = (f'{year.group(1)}-{int(month.get_text(strip=True)):02d}-{int(day.get_text(strip=True)):02d}'
               if year and month and day else None)
  out = [_row('investor_day', f'{title} Presentation', a['href'], published, 'event')
         for a in soup.select('.events-detail-place a[href]') if urlsplit(a['href']).netloc.endswith('widen.net')]
  return _need('빈패스트 Mobility Day 발표', out)


def parse_vinfast(reports_html: str, event_html: str, presentation_date: str | None) -> list[dict]:
  """분기 보고서(EDGAR 날짜 대기) + 회사 소개 자료(뷰어 쪽 URL — 만료 없음 · 키 = 판 이름이 든 경로) + Mobility Day.
  증권사 리포트 원문 표 · 주주 뉴스레터(날짜 칸이 «월»뿐) · 웹캐스트는 싣지 않는다."""
  link = vinfast_presentation_link(reports_html)
  edition = urlsplit(link).path.rstrip('/').rsplit('/', 1)[-1]
  rows = parse_vinfast_reports(reports_html)
  rows.append(_row('presentation', f'VinFast Corporate Presentation ({edition})', link, presentation_date,
                   'corporate-presentation'))
  rows += parse_vinfast_event(event_html)
  return list({r['source_id']: r for r in rows}.values())


def fetch_vinfast(session: requests.Session, since: str) -> list[dict]:
  """IR 첫 쪽 → 회사 소개 자료 뷰어 → 서명 PDF(만든 날만 읽는다) · Mobility Day 상세. PDF 가 상한을 넘으면 날짜 없이
  (수집기가 «날짜 없음»으로 센다)."""
  html = _fetch(session, VINFAST_IR).text
  link = vinfast_presentation_link(html)
  pdf, created = vinfast_pdf_url(_fetch(session, link).text), ''
  if pdf:
    try:
      created = _pdf_creation(ir_get(session, pdf).content)
    except TooLarge:
      pass
  return parse_vinfast(html, _fetch(session, VINFAST_MOBILITY_DAY).text, vinfast_edition_date(link, created))


# ── 리비안(링크만 — 숫자는 EDGAR 8-K · Next.js __NEXT_DATA__ 의 Contentful 리치텍스트) ──────────

RIVN_BASE = 'https://rivian.com'
RIVN_INVESTORS = f'{RIVN_BASE}/investors'
RIVN_EVENTS = f'{RIVN_BASE}/investors/events'
_RV_LETTER = re.compile(r'Shareholder (Presentation|Letter)', re.I)  # 분기 블록 = 발표자료/주주서한 PDF(EDGAR 99.2 와 같은 글)
_RV_EVENT_DOC = re.compile(r'Presentation|Shareholder Letter', re.I)  # 행사 = AI Day·Investor Day 발표 · VW 합작 덱
_RV_LINKS = ('hyperlink', 'asset-hyperlink', 'entry-hyperlink')


def _next_data(html: str) -> dict:
  tag = BeautifulSoup(html, 'html.parser').find('script', id='__NEXT_DATA__')
  if not tag or not tag.string:
    raise EmptyListError('리비안 __NEXT_DATA__ 없음')
  return json.loads(tag.string)


def _rt_text(node) -> str:
  if not isinstance(node, dict):
    return ''
  if node.get('nodeType') == 'text':
    return node.get('value') or ''
  return ''.join(_rt_text(c) for c in node.get('content') or [])


def _rt_links(node) -> list[tuple[str, str]]:
  """리치텍스트 안 링크 → (글, 절대 URL). 내부 항목 링크(entry-hyperlink — URL 없음)는 버린다."""
  if not isinstance(node, dict):
    return []
  if node.get('nodeType') in _RV_LINKS:
    uri = (node.get('data') or {}).get('uri')
    return [(' '.join(_rt_text(node).split()), urljoin(RIVN_BASE, uri))] if uri else []
  return [x for c in node.get('content') or [] for x in _rt_links(c)]


def _rv_items(nd: dict, results: bool) -> list[dict]:
  """분기 실적 절(anchorTag='results') 또는 그 밖의 절의 블록 리치텍스트 문서들."""
  secs = ((nd.get('props') or {}).get('pageProps') or {}).get('data', {}).get('sections') or []
  return [((it.get('description') or {}).get('json') or {}) for s in secs if (s.get('anchorTag') == 'results') == results
          for it in (s.get('blocks') or {}).get('items') or []]


def parse_rivian_quarters(nd: dict) -> list[dict]:
  """분기 실적 절 — 연도 블록(「2026」) 뒤의 분기 블록(머리 「Q1」…「Q4 & Full Year」) 안 「Shareholder Presentation/Letter」
  PDF → shareholder_letter. 날짜가 없다 → wait='edgar'(같은 분기 실적 8-K 접수일). 실적 뉴스·10-Q·웹캐스트는 버린다."""
  out, year = [], None
  for doc in _rv_items(nd, results=True):
    text = _rt_text(doc).strip()
    if re.fullmatch(r'20\d\d', text):
      year = int(text)
      continue
    head = next((_rt_text(b).strip() for b in doc.get('content') or [] if b.get('nodeType', '').startswith('heading')), '')
    m = re.match(r'Q([1-4])\b', head)
    if not (m and year):
      continue
    for label, url in _rt_links(doc):
      if _RV_LETTER.fullmatch(label):
        out.append(_row('shareholder_letter', f'Rivian Q{m.group(1)} {year} {label}', url, None, 'quarterly-results',
                        quarter=f'{year}-Q{m.group(1)}', wait='edgar'))
  return _need('리비안 분기 실적 블록', out)


def _rv_date(text: str) -> str | None:
  try:
    return datetime.strptime(' '.join(text.split()).title(), '%B %d, %Y').date().isoformat()  # 「NOVEMBER 12, 2025」
  except ValueError:
    return None


def parse_rivian_events(nd: dict) -> list[dict]:
  """행사 연표(머리6 = 날짜 · 머리3 = 행사 이름 · 다음 문단 = 링크) → 「Presentation」·「Shareholder Letter」 PDF 링크 =
  investor_day(날짜 = 그 행사 머리의 날짜). 보도자료·웹캐스트·위임장(Download)·URL 없는 내부 링크는 버린다."""
  out = []
  for doc in _rv_items(nd, results=False):
    day, title = None, ''
    for b in doc.get('content') or []:
      kind = b.get('nodeType')
      if kind == 'heading-6':
        day, title = _rv_date(_rt_text(b)), ''
      elif kind == 'heading-3':
        title = ' '.join(_rt_text(b).split())
      elif title:
        for label, url in _rt_links(b):
          if _RV_EVENT_DOC.fullmatch(label):
            out.append(_row('investor_day', f'{title} ({label})', url, day, 'event'))
  return out


def parse_rivian(investors: dict, events: dict) -> list[dict]:
  """/investors(분기 실적 + 최근 행사) + /investors/events(행사 전체 — 2026 행사는 /investors 쪽에만) → 행.
  Impact Report·공급사 행동강령은 두 쪽 리치텍스트 어디에도 링크가 없다(다른 쪽 — 받지 않는다)."""
  rows = parse_rivian_quarters(investors)
  rows += _need('리비안 행사 문서', parse_rivian_events(investors) + parse_rivian_events(events))
  return list({r['source_id']: r for r in rows}.values())


def fetch_rivian(session: requests.Session, since: str) -> list[dict]:
  return parse_rivian(*(_next_data(_fetch(session, u).text) for u in (RIVN_INVESTORS, RIVN_EVENTS)))


# ── 등록부 ────────────────────────────────────────────────────────────────────

# 스텔란티스 = EDGAR 로 충분(어댑터 없음) · 빈패스트·리비안 = 링크만(숫자 파서는 EDGAR 만 받는다) · GM = 접근 차단(아래 probe_gm)
IR_LISTS: dict[str, Callable[[requests.Session, str], list[dict]]] = {
  'VOW3.DE': fetch_vw,
  'P911.DE': fetch_porsche,
  'PII': fetch_polaris,
  '005380': fetch_hyundai,
  '000270': fetch_kia,
  '012330': fetch_mobis,
  '003620': fetch_kgm,
  'VFS': fetch_vinfast,
  'RIVN': fetch_rivian,
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
