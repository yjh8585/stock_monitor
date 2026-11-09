"""고객사 문서 «내용» → 숫자. 순서: 자가 시험(exit 2) → pending 문서(오래된 것부터) → 내용 1회 받기 →
회사 파서 → (llm 칸만) LLM → 어휘·기간 형식 거르기 → 인용·숫자 대조 → 적재 → 가이던스 방향 재계산 → 상태 기록.

exit 0 정상(내용 접근 차단 401·403 포함 — 상태 표에 blocked 사유가 남는다)
     1 파싱 실패(새 문서인데 숫자 0개·대조 통과 0·파서 예외·LLM 재시도 상한) 또는 내용 받기 실패(401·403 밖) 1건 이상
       (LLM 재시도 대기 = pending 은 exit 1 이 아니다 — LLM 은 실행마다 결과가 달라 한 번 실패로 GHA 를 빨갛게 하지 않는다)
     2 자가 시험 실패 · 인자 오류 · --add-file 대상 회사에 파서 없음
사용: collect_customer_numbers.py [--company TICKER] [--no-llm] [--reparse DOC_ID] [--dry-run]
     collect_customer_numbers.py --company TICKER --add-file PDF --url URL --doc-type fact_sheet --title T --published YYYY-MM-DD
       (사이트가 브라우저 내려받기만 받아 주는 소급 문서를 로컬 파일로 넣는다 — 문서 행을 만들고 그 내용으로 바로 파싱.
        이 문서를 나중에 --reparse 하면 HTTP 로 다시 받다가 막힐 수 있다 — 그때는 --add-file 로 다시)

🔴 문서 상태(parse_status·parse_note·sha256)는 이 스크립트만 쓴다 — 목록 수집기(collect_customer_docs.store)는 이 칸을 거부한다.
🔴 등록부(customer_parsers.MODULE_NAMES)에 파서가 없는 회사의 문서는 pending 그대로 둔다. not_target 으로 닫으면 나중에
   그 회사 파서가 생겨도 문서를 다시 못 본다(--reparse 를 문서마다 돌려야 한다).
   같은 까닭으로 파서의 wants 가 거짓인 문서(IR 출처 등)도 pending + note 「대상 파서 없음」, LLM 이 읽을 문서(llm_wants)인데
   LLM 이 이번에 못 돈 문서도 pending + note 「LLM 대기」 — 같은 note 면 다시 쓰지 않는다(매 실행 쓰기 0).
   코드 행은 뽑혀 parsed 로 닫는 문서도 llm_wants 가 참인데 LLM 이 안 돌았으면 note 맨 앞에 「LLM 대기 — 코드 행만 적재」
   (parsed 는 pending 목록에 다시 안 끼므로 매 실행 쓰기 0 이 그대로다). LLM 안 돈 문서 전부:
   select id from customer_documents where parse_note like 'LLM 대기%'  → 문서마다 --reparse.
🔴 LLM(Task 11 · lib.llm_guidance): 클라이언트는 실행마다 한 번 — ANTHROPIC_API_KEY 가 없으면 LLM 칸만 건너뛴다(위 「LLM 대기」).
   exit 는 0 그대로 — GHA 에서는 대상 문서가 있으면 ::warning:: 으로 실행 요약에 띄운다(키 누락을 놓치지 않게).
   🔴 LLM 재시도(customer_documents.llm_attempts): extract 예외(API 오류·JSON·응답 중단)이거나 값 행이 전부 LLM 행인데
   전부 대조 실패면 그 문서만 pending 으로 두고 llm_attempts +1 · note 「LLM 대기 — <사유> (n/3)」 — 코드 행은 그대로 적재하고
   다음 실행이 다시 시도한다(코드 행 적재는 upsert·선삭제라 멱등). 3회째면 닫는다: 코드 값 행이 있으면 parsed + note
   「LLM 3회 실패」, 없으면 failed(이것만 exit 1). LLM 이 제대로 돌면 llm_attempts 를 0 으로 되돌린다.
   extract 안의 프로그래밍 오류(KeyError·TypeError 등 _PROGRAMMING_ERRORS)는 LLM 실패로 뭉개지 않고 파서 예외(failed)로.
   LLM 행 거르기(lib.llm_guidance.screen — 분기·규모·통화·CAGR·숫자 other·파서 LLM_DROP)로 버린 수는 note 「LLM 거름 …」.
   파서의 llm_only 가 참인 문서(LLM 만 읽는 IR 발표자료)는 LLM 이 안 도는 실행에서 내려받지도 않는다.
   코드 표식은 있는데 코드 가이던스가 모자라 LLM 이 채운 문서(ParseResult.code_miss)는 note 에 「코드 문구 미스」 —
   LLM 행이 파서 문구 미스를 가리지 않게(Task 7 carry). 찾기 = parse_note like '%코드 문구 미스%'.
🔴 LLM 행이 1건 이상이면 코드 파서의 recognized=False 보다 우선한다(judge — 중장기 Investor Day 처럼 코드가 못 알아보는 서식).
🔴 내용 받기 실패는 그 문서만 처리하고 다음 문서로 간다(note = 예외 클래스·HTTP 상태만 — 본문·URL 금지).
   일시 실패(401·403·408·425·429·5xx·연결·시간 초과·만료 URL)는 pending 그대로 note 만 → 다음 실행이 다시 시도하고 회사 상태가
   blocked·error 로 매번 다시 난다. 영구 실패(404·410·그 밖 4xx·내용 형식 오류)만 failed 로 닫는다.
   현대모비스 IR URL 의 fileId 는 요청마다 바뀌어 저장된 URL 이 만료될 수 있다 → note 에 「만료 가능 URL」.
🔴 파서 예외(parse · 파서 모듈 fetch 의 AttributeError·TypeError 등)는 그 문서만 failed('파서 예외: <클래스>').
출력은 회사·문서 건수·행수만(금액 금지 — 공개 수치여도 습관을 지킨다).
"""
import argparse
import hashlib
import os
import sys
from collections import Counter
from datetime import date
from urllib.parse import parse_qs, urlsplit

import requests

DOC_COLS = 'id,company_id,source,source_id,doc_type,form,items,title,url,published_at,parse_note,llm_attempts'
NOTE_NO_PARSER = '대상 파서 없음'
NOTE_LLM_WAIT = 'LLM 대기 — 코드 파서가 못 알아보는 서식'
# parsed 로 닫되 LLM 칸을 못 읽은 문서 — 두 표식 모두 'LLM 대기' 로 시작해 parse_note LIKE 'LLM 대기%' 한 번으로 뽑힌다
NOTE_LLM_WAIT_PARSED = 'LLM 대기 — 코드 행만 적재(LLM 칸 미실행)'
NOTE_NO_KEY = 'LLM 키 없음'
NOTE_LLM_FAIL = 'LLM 실패'
NOTE_CODE_MISS_ONLY = '코드 문구 미스 — LLM 행만'          # 코드 표식은 있는데 코드 가이던스 0행 → LLM 이 전부 채움
NOTE_CODE_MISS_FILL = '코드 문구 미스 — LLM 이 빠진 항목 메움'  # 코드 가이던스 일부 + LLM 이 나머지
LLM_MAX_ATTEMPTS = 3                    # 이 횟수째 실패하면 닫는다(코드 행 있으면 parsed · 없으면 failed)
NOTE_LLM_RETRY = 'LLM 대기 — '          # + 사유 (n/3) — 'LLM 대기%' 로 같이 뽑힌다
NOTE_LLM_GAVE_UP = f'LLM {LLM_MAX_ATTEMPTS}회 실패'
NOTE_LLM_UNVERIFIED = 'LLM 행 대조 통과 0'
DOC_TYPES = ('earnings_release', 'presentation', 'shareholder_letter', 'periodic', 'current_report', 'prelim_results',
             'sales_release', 'guidance', 'ir_event', 'fact_sheet', 'investor_day', 'other')  # DB CHECK 와 같음
_PAGE = 1000      # PostgREST 한 응답 최대 행 수 — 넘으면 .range() 로 넘긴다(.order() 필수)
_IN_CHUNK = 100
_NOTE_MAX = 500


def self_tests() -> list[str]:
  import customer_parsers
  from customer_parsers import base
  from lib import guidance_direction, llm_guidance, quote_check
  errs = [f'quote_check: {e}' for e in quote_check.self_test()]
  errs += [f'guidance_direction: {e}' for e in guidance_direction.self_test()]
  errs += [f'llm_guidance: {e}' for e in llm_guidance.self_test()]
  errs += [f'customer_parsers.base: {e}' for e in base.self_test()]
  for m in customer_parsers.modules():
    errs += [f'{m.__name__}: {e}' for e in m.self_test()]
    if hasattr(m, 'llm_wants') and getattr(m, 'BASE_CURRENCY', None) not in base.CURRENCIES:
      errs.append(f'{m.__name__}: llm_wants 가 있는데 BASE_CURRENCY 가 없다(LLM 행 통화 검사 기준)')
  return errs


# ── 내용 받기 ─────────────────────────────────────────────────────────────────

def _sha(b: bytes) -> str:
  return hashlib.sha256(b).hexdigest()


def _ir_get(session, url: str) -> requests.Response:
  """IR 문서 — 목록 어댑터와 같은 브라우저 UA(없으면 일부 사이트가 403) · 5xx 만 재시도."""
  from lib.ir_lists import BROWSER_UA
  from lib.retry import with_retry

  def _once():
    r = session.get(url, headers={'User-Agent': BROWSER_UA}, timeout=60)
    r.raise_for_status()
    return r
  return with_retry(_once, _label=urlsplit(url).netloc)


def fetch_content(session, doc, local: bytes | None = None):
  """출처별로 내용을 한 번만 받는다 → (Content, sha256). local = --add-file 로 넘긴 파일 바이트(PDF 만)."""
  from customer_parsers.base import Content
  from lib import dart_api, edgar
  from lib.doc_text import html_to_table_rows, html_to_text, pdf_text
  if local is not None:
    return Content(pdf_text(local), [], local), _sha(local)
  if doc.source == 'edgar':
    base = doc.url.rsplit('/', 1)[0]
    idx = edgar.edgar_get(session, f'{base}/index.json').json()
    texts, tables, raw = [], [], b''
    for name in edgar.filing_htm_names(idx, doc.url.rsplit('/', 1)[1]):
      b = edgar.edgar_get(session, f'{base}/{name}').content
      h = b.decode('utf-8', errors='replace')
      raw += b
      texts.append(html_to_text(h))
      tables += html_to_table_rows(h)
    return Content('\n'.join(texts), tables, raw), _sha(raw)
  if doc.source == 'dart':
    text = dart_api.document_text(session, doc.source_id)
    return Content(text), _sha(text.encode())
  r = _ir_get(session, doc.url)
  b = r.content
  if b[:5] == b'%PDF-':
    return Content(pdf_text(b), [], b), _sha(b)
  # requests 는 charset 없는 text/* 에 ISO-8859-1 을 준다 → '€' 가 깨져 VW·포르쉐 정규식이 조용히 0건 → 머리에 charset 이 없으면 추정값
  enc = r.encoding if 'charset=' in r.headers.get('content-type', '').lower() else (r.apparent_encoding or 'utf-8')
  h = b.decode(enc, errors='replace')
  return Content(html_to_text(h), html_to_table_rows(h), b), _sha(b)


def http_status(e: Exception) -> int | None:
  return getattr(getattr(e, 'response', None), 'status_code', None)


def _expiring_url(doc) -> bool:
  """현대모비스 IR 다운로드 — fileId 가 요청마다 바뀌어 저장된 URL 이 만료된다(목록 수집기가 새 URL 로 고쳐 넣는다)."""
  return doc.source == 'ir' and 'fileId' in parse_qs(urlsplit(doc.url).query)


def fetch_failure_note(e: Exception, doc) -> str:
  """내용 받기 실패 → parse_note. 예외 클래스·HTTP 상태만(예외 문장엔 URL·DART 키가 실릴 수 있다)."""
  code = http_status(e)
  note = f'내용 받기 실패: {type(e).__name__}' + (f' HTTP {code}' if code else '')
  if _expiring_url(doc):
    note += ' · 만료 가능 URL(요청마다 바뀌는 fileId)'
  return note


_BLOCKED_CODES = (401, 403)        # 인증·봇 차단 — 화면에 「접근 차단」 사유
_RETRY_4XX = (408, 425, 429)       # 시간 초과·너무 이름·요청 과다 — 다음 실행에 다시


def fetch_failure_kind(e: Exception, doc) -> str:
  """받기 실패 갈래 → 'blocked'(401·403) · 'retry'(일시 — pending 유지) · 'failed'(영구 — 닫는다).
  🔴 일시 실패를 failed 로 닫으면 다음 실행이 다시 안 봐 차단·오류 신호가 하루 만에 사라진다
  (회사의 다른 문서가 파싱되면 상태 표가 ok 로 덮인다). pending 으로 두면 매 실행 다시 시도돼 blocked·error 가 매번 다시 난다.
  일시 = 408·425·429·5xx·연결 오류·시간 초과·만료 URL. 영구 = 404·410·그 밖 4xx · 내용 형식 오류(PDF·zip 깨짐 등 HTTP 밖 예외)."""
  code = http_status(e)
  if code in _BLOCKED_CODES:
    return 'blocked'
  if _expiring_url(doc):
    return 'retry'   # 만료 URL 의 404 도 — 목록 수집기가 새 URL 을 넣으면 다음 실행에서 받힌다
  if code is not None:
    return 'retry' if code >= 500 or code in _RETRY_4XX else 'failed'
  if isinstance(e, (requests.ConnectionError, requests.Timeout)):
    return 'retry'
  return 'failed'


# 파서 모듈 자체 fetch 의 이 예외는 사이트 문제가 아니라 코드 문제다 → 「파서 예외」(받기 실패와 섞지 않는다)
_PROGRAMMING_ERRORS = (AttributeError, TypeError, NameError, KeyError, IndexError, AssertionError, ImportError)


# ── 판정(순수) ────────────────────────────────────────────────────────────────

def value_rows(res) -> list:
  return [*res.volume, *res.results, *res.guidance]


def judge(res, verified_values: int, verified_dates: int, llm_rows: int = 0) -> tuple[str, str | None]:
  """(parse_status, note). 순서가 뜻이다(계획서 Task 6 Step 6).
  값 행도 없고 검증된 일정도 없는 문서(일정 행이 전부 대조 실패)는 「대조 통과 0」 — 요약서의 「그 밖 parsed」가
  이 꼴을 parsed 로 넘겨 일정 파서가 깨져도 조용해지는 것을 막는다.
  llm_rows = 거르기·dedupe 뒤 남은 LLM 행 수 — 1 이상이면 코드 파서가 못 알아본 문서여도 대상이다."""
  if not res.recognized and not llm_rows:
    return 'not_target', None
  if res.count() == 0:
    return 'failed', '새 문서인데 숫자 0개'
  n_values = len(value_rows(res))
  if n_values == 0:
    return ('parsed', None) if verified_dates else ('failed', '대조 통과 0')
  if verified_values == 0:
    return 'failed', '대조 통과 0'
  return 'parsed', None


def verify(res, text: str) -> dict:
  """행 id → (verified, note). 값 행은 check_row, 일정은 check_date_row(원문 = content.text)."""
  from lib import quote_check
  out = {id(r): quote_check.check_row(r, text) for r in value_rows(res)}
  out.update({id(d): quote_check.check_date_row(d, text) for d in res.dates})
  return out


def payloads(doc, res, checks: dict, llm_ids: set[int]) -> dict[str, list[dict]]:
  """표 이름 → 적재 행. 일정 표에는 verified 칸이 없어 통과한 일정만 싣는다."""
  ref = {'company_id': doc.company_id, 'document_id': doc.id, 'source': doc.source, 'source_ref': doc.source_id,
         'published_at': doc.published_at}
  vol = [{**ref, 'metric': v.metric, 'region': v.region, 'period_grain': v.period_grain, 'period': v.period,
          'value': int(v.value), 'definition': v.definition, 'quote': v.quote, 'verified': checks[id(v)][0]}
         for v in res.volume]
  rr = [{**ref, 'metric': x.metric, 'metric_name': x.metric_name, 'basis': x.basis, 'period_grain': x.period_grain,
         'period': x.period, 'value': x.value, 'unit': x.unit, 'currency': x.currency, 'quote': x.quote,
         'verified': checks[id(x)][0]} for x in res.results]
  gd = [{'company_id': doc.company_id, 'document_id': doc.id, 'published_at': doc.published_at, 'metric': g.metric,
         'metric_label': g.metric_label, 'period': g.period, 'low': g.low, 'high': g.high, 'value_text': g.value_text,
         'unit': g.unit, 'currency': g.currency, 'basis': g.basis, 'quote': g.quote, 'stated': g.stated,
         'extractor': 'llm' if id(g) in llm_ids else 'code', 'verified': checks[id(g)][0],
         'verify_note': checks[id(g)][1]} for g in res.guidance]
  dt = [{'company_id': doc.company_id, 'period': d.period, 'event_date': d.event_date, 'quote': d.quote,
         'source': doc.source, 'source_ref': doc.source_id, 'url': doc.url, 'published_at': doc.published_at}
        for d in res.dates if checks[id(d)][0]]
  return {'customer_volume_ir': vol, 'customer_reported_results': rr, 'customer_guidance': gd,
          'customer_earnings_dates': dt}


# 표 → (충돌 칸, «나중 공시 우선» 비교 키 칸 | None)
TABLES = {
  'customer_volume_ir': ('company_id,metric,region,period_grain,period', ('metric', 'region', 'period_grain', 'period')),
  'customer_reported_results': ('company_id,period_grain,period,metric', ('period_grain', 'period', 'metric')),
  'customer_earnings_dates': ('company_id,period', None),
  'customer_guidance': ('document_id,metric,period', None),
}


def newer_only(rows: list[dict], existing: dict[tuple, tuple[str, bool]], key_cols: tuple[str, ...]) -> list[dict]:
  """existing = 키 → (기존 published_at, 기존 verified). 실을 행만 남긴다.
  - 기존 행이 더 «나중 공시»면 뺀다 — 백필을 다시 돌려도 최신값이 옛 값에 덮이지 않게(같은 날이면 덮는다)
  - 🔴 미검증 행은 같은 키에 기존 «검증» 행이 있으면 뺀다 — 물량·실적 표 키엔 document_id 가 없어서, 나중 문서의
    대조 실패 행이 앞 문서의 검증 행을 덮으면 화면(verified 만)이 빈칸이 된다
  - 🔴 반대로 검증 행은 기존 행이 «미검증»이면 공시일과 무관하게 싣는다 — 백필·--add-file 로 앞 문서가 나중에
    들어올 때, 공시일 규칙에 막히면 미검증 행(화면 빈칸)이 영영 남는다"""
  out = []
  for r in rows:
    key = tuple(r[c] for c in key_cols)
    if key not in existing:
      out.append(r)
      continue
    pub, verified = existing[key]
    if r['verified'] and not verified:
      out.append(r)
    elif pub <= r['published_at'] and (r['verified'] or not verified):
      out.append(r)
  return out


# ── DB ────────────────────────────────────────────────────────────────────────

def fetch_all(make_query, order_cols: tuple[str, ...]) -> list[dict]:
  """페이지 넘김 조회. make_query() 는 매번 새 빌더를 돌려준다. 순서 칸 = 유일 키 전체(행 누락 방지)."""
  out, start = [], 0
  while True:
    q = make_query()
    for c in order_cols:
      q = q.order(c)
    page = q.range(start, start + _PAGE - 1).execute().data
    out += page
    if len(page) < _PAGE:
      return out
    start += _PAGE


def _to_doc(r: dict, ticker: str):
  from customer_parsers.base import Doc
  return Doc(id=r['id'], company_id=r['company_id'], ticker=ticker, source=r['source'], doc_type=r['doc_type'],
             form=r['form'] or '', items=r['items'] or '', title=r['title'], url=r['url'],
             published_at=r['published_at'], source_id=r['source_id'])


def load_companies(client, ids: set[str]) -> dict[str, str]:
  """company_id → ticker."""
  ids, out = sorted(ids), {}
  for i in range(0, len(ids), _IN_CHUNK):
    for c in client.table('companies').select('id,ticker').in_('id', ids[i:i + _IN_CHUNK]).execute().data:
      out[c['id']] = c['ticker']
  return out


def load_docs(client, company_id: str | None, reparse: int | None) -> list[dict]:
  """pending 문서를 (published_at, id) 오름차순으로 — 같은 칸을 여러 문서가 내면 «나중 공시»가 마지막 upsert 가 되게.
  일시 받기 실패 문서도 pending 이라 다시 끼지만, 한 실행이 pending 전부를 돌아(상한 없음) 뒤 문서를 막지 않는다.
  ⚠️ 한 실행 문서 수 상한을 넣으면 그 문서들(parse_note 「내용 받기 실패」)을 뒤로 보내야 한다 — 안 그러면 상한을 다 먹는다."""
  def q():
    b = client.table('customer_documents').select(DOC_COLS)
    b = b.eq('id', reparse) if reparse is not None else b.eq('parse_status', 'pending')
    return b.eq('company_id', company_id) if company_id else b
  return fetch_all(q, ('published_at', 'id'))


def existing_pubs(client, table: str, company_id: str, key_cols: tuple[str, ...]) -> dict[tuple, tuple[str, bool]]:
  """키 → (published_at, verified) — newer_only 의 비교 근거."""
  rows = fetch_all(lambda: client.table(table).select(','.join(key_cols) + ',published_at,verified')
                   .eq('company_id', company_id), key_cols)
  return {tuple(r[c] for c in key_cols): (r['published_at'], bool(r['verified'])) for r in rows}


def add_file_doc(client, args, company: dict, blob: bytes) -> dict:
  """--add-file → customer_documents 행(source='ir' · source_id = ir_source_id(url) — IR 목록이 넣은 같은 문서와
  한 행이 되게).
  🔴 이미 행이 있으면(IR 목록이 넣었다) 그 행을 그대로 쓴다 — title·published_at·form·items 를 덮으면 다음 목록 수집과
  값이 엇갈린다. sha256·파싱 상태는 파싱 뒤 _set_doc 이 갱신한다. 없을 때만 새로 넣는다(dry-run 이면 안 넣고 id 0)."""
  from lib import db
  from lib.ir_lists import ir_source_id
  source_id = ir_source_id(args.url)

  def find():
    return (client.table('customer_documents').select(DOC_COLS).eq('source', 'ir').eq('source_id', source_id)
            .execute().data)
  got = find()
  if got:
    return got[0]
  row = {'company_id': company['id'], 'source': 'ir', 'source_id': source_id, 'doc_type': args.doc_type,
         'form': None, 'items': None, 'title': args.title, 'url': args.url, 'published_at': args.published,
         'sha256': _sha(blob)}
  if args.dry_run:
    return {**row, 'id': 0}
  db.upsert_rows('customer_documents', [row], 'source,source_id')
  return find()[0]


# ── 실행 ──────────────────────────────────────────────────────────────────────

def _args(argv):
  ap = argparse.ArgumentParser(description='고객사 문서 내용 → 숫자(물량·실적·가이던스·실적 일정)')
  ap.add_argument('--company', help='ticker 하나만')
  ap.add_argument('--no-llm', action='store_true', help='LLM 칸을 건너뛴다(코드 행만)')
  ap.add_argument('--reparse', type=int, metavar='DOC_ID', help='상태와 무관하게 이 문서 하나를 다시')
  ap.add_argument('--dry-run', action='store_true', help='건수만 — 쓰지 않는다')
  ap.add_argument('--add-file', metavar='PDF', help='로컬 PDF 를 문서로 넣고 바로 파싱(--company·--url·--doc-type·--title·--published 필수)')
  ap.add_argument('--url')
  ap.add_argument('--doc-type', choices=DOC_TYPES)
  ap.add_argument('--title')
  ap.add_argument('--published', help='YYYY-MM-DD 필수 — 지어내지 않는다. 문서에 날짜가 없으면 같은 회사의 해당 연간 '
                                      '실적 공시일(customer_documents)을 사람이 찾아 넣는다(자동 조회 없음)')
  return ap.parse_args(argv)


def _add_file_error(args) -> str | None:
  missing = [n for n in ('company', 'url', 'doc_type', 'title', 'published') if not getattr(args, n)]
  if missing:
    return f'--add-file 에 필요한 인자 없음: {", ".join("--" + m.replace("_", "-") for m in missing)}'
  try:
    date.fromisoformat(args.published)
  except ValueError:
    return f'--published 형식 아님(YYYY-MM-DD): {args.published}'
  return None


def main(argv: list[str] | None = None) -> int:
  sys.stdout.reconfigure(encoding='utf-8', errors='replace')
  from lib.bootstrap import init_script
  init_script(__file__)
  args = _args(argv)

  errs = self_tests()
  if errs:
    for e in errs:
      print(f'자가 시험 실패 — {e}')
    return 2

  blob = None
  if args.add_file:
    err = _add_file_error(args)
    if err:
      print(err)
      return 2
    with open(args.add_file, 'rb') as f:
      blob = f.read()
    if blob[:5] != b'%PDF-':
      print('--add-file 은 PDF 만 받는다')
      return 2

  from lib import db
  client = db.get_client()
  company = None
  if args.company:
    got = client.table('companies').select('id,ticker').eq('ticker', args.company).execute().data
    if not got:
      print(f'회사 없음: {args.company}')
      return 2
    company = got[0]

  if blob is not None:
    import customer_parsers
    if customer_parsers.module_for(args.company) is None:  # 문서 행만 남고 영영 안 읽힌다 — 만들기 전에 멈춘다
      print(f'--add-file 대상 회사에 파서가 없다(customer_parsers 등록부): {args.company}')
      return 2
    docs = [add_file_doc(client, args, company, blob)]
  else:
    docs = load_docs(client, company['id'] if company else None, args.reparse)
  tickers = load_companies(client, {d['company_id'] for d in docs})
  print(f'대상 문서 {len(docs)}건 · 회사 {len(tickers)}곳' + (' · dry-run' if args.dry_run else ''))

  llm = None
  if not args.no_llm:
    from lib import llm_guidance
    llm = llm_guidance.make_client()
    if llm is None:
      print('ANTHROPIC_API_KEY 없음 — LLM 칸 건너뜀(그 문서는 LLM 대기로 남는다)')
      # 정기 실행에서 Secret 이 빠지면 exit 0 이라 아무도 모른다 — 대상 문서가 있으면 실행 요약에 노랗게 띄운다.
      # (LLM 대기 문서는 pending 으로 남아 다음 실행에도 대상이라, 키가 빠진 동안 매 실행 다시 뜬다)
      if docs and os.environ.get('GITHUB_ACTIONS'):
        print(f'::warning::ANTHROPIC_API_KEY 없음 — 문서 {len(docs)}건의 LLM 칸을 건너뛰었다(Secret 확인)')
  session = requests.Session()
  with db.WriteSession() as ws:
    failures = _run(docs, tickers, client, session, ws, args, blob, llm)
  return 1 if failures else 0


def _run(docs: list[dict], tickers: dict[str, str], client, session, ws, args, blob: bytes | None, llm=None) -> int:
  import customer_parsers
  by_company: dict[str, list[dict]] = {}
  for d in docs:  # 회사 안에서 (published_at, id) 순서를 그대로 둔다
    by_company.setdefault(d['company_id'], []).append(d)
  failures = calls = 0
  for cid, rows in by_company.items():
    ticker = tickers.get(cid, '?')
    mod = customer_parsers.module_for(ticker)
    if mod is None:
      print(f'  {ticker:<10} 문서 {len(rows)} · 파서 없음(pending 유지)')
      continue
    run = _CompanyRun(mod, client, session, ws, args, cid, llm)
    for r in rows:
      # --reparse = 사람이 손으로 다시 돌렸다 → 재시도 횟수를 새로 센다(note 의 n/3 도 이 값에서 이어진다 · 수정 2회차 N6)
      attempts = 0 if args.reparse is not None else r.get('llm_attempts') or 0
      run.process(_to_doc(r, ticker), blob, r.get('parse_note'), attempts)
    failures += run.finish(ticker, len(rows))
    calls += run.llm_calls
  if llm is not None:
    print(f'LLM 호출 {calls}회')
  return failures


class _CompanyRun:
  """한 회사의 문서들을 차례로 → 적재 → 방향 재계산 → 상태 행."""

  def __init__(self, mod, client, session, ws, args, company_id: str, llm=None):
    self.mod, self.client, self.session, self.ws, self.args, self.cid = mod, client, session, ws, args, company_id
    self.llm = llm                      # Anthropic 클라이언트(실행마다 한 번 · 키 없으면 None)
    self.llm_calls = 0
    self._company_label: str | None = None
    self.outcomes: Counter = Counter()
    self.rows: Counter = Counter()      # 표 → 적재(또는 dry-run 이면 적재할) 행 수
    self.verified: Counter = Counter()
    self.dropped = 0
    self.llm_screened: Counter = Counter()   # LLM 행 거르기 사유 → 건수
    self._pubs: dict[str, dict] = {}    # 표 → «나중 공시 우선» 비교용 기존 공시일

  def _set_doc(self, doc, status: str, note: str | None, sha: str | None, llm_attempts: int | None = None) -> None:
    if self.args.dry_run or not doc.id:
      return
    patch = {'parse_status': status, 'parse_note': note[:_NOTE_MAX] if note else None}
    if sha:
      patch['sha256'] = sha
    if llm_attempts is not None:
      patch['llm_attempts'] = llm_attempts
    self.ws.table('customer_documents').update(patch).eq('id', doc.id).execute()

  def _content(self, doc, blob):
    if blob is not None:
      return fetch_content(self.session, doc, blob)
    if hasattr(self.mod, 'fetch'):
      c = self.mod.fetch(self.session, doc)
      return c, _sha(c.raw or c.text.encode())
    return fetch_content(self.session, doc)

  def _llm_off(self) -> bool:
    return self.args.no_llm or self.llm is None

  def _label(self) -> str:
    """LLM 프롬프트의 회사 이름(companies.name) — 회사마다 한 번만 읽는다."""
    if self._company_label is None:
      got = self.client.table('companies').select('name').eq('id', self.cid).execute().data
      self._company_label = (got[0]['name'] if got else '') or ''
    return self._company_label

  def _llm(self, doc, content, res, notes: list[str]) -> set[int] | None:
    """LLM 행 id 집합. None = 이번에 LLM 이 돌지 않았다(--no-llm·키 없음·llm_wants 거짓·LLM 실패) — 선삭제가 옛 LLM
    행을 남긴다. 🔴 extract 예외는 이 문서만 「LLM 실패」(그 문서는 LLM 대기 · 코드 행은 그대로) — 실행 전체를 죽이지 않는다."""
    if self.args.no_llm or not hasattr(self.mod, 'llm_wants') or not self.mod.llm_wants(doc, res):
      return None
    if self.llm is None:
      notes.append(NOTE_NO_KEY)
      return None
    from lib import llm_guidance
    label = self._label()   # DB 오류는 「LLM 실패」가 아니다 — try 밖(실행이 죽어 드러난다)
    try:
      hint = getattr(self.mod, 'LLM_HINT', '')
      hint = hint(doc) if callable(hint) else hint
      self.llm_calls += 1
      rows, why = llm_guidance.extract(self.llm, doc, content.text, label, hint,
                                       getattr(self.mod, 'BASE_CURRENCY', None), getattr(self.mod, 'LLM_DROP', None))
    except _PROGRAMMING_ERRORS:
      raise   # 코드 버그 — process 가 파서 예외(failed)로 닫는다(LLM 재시도로 뭉개면 영영 안 드러난다)
    except Exception as e:  # API 오류·JSON 파싱·응답 중단 — 그 문서만(예외 문장엔 본문이 실릴 수 있어 클래스 이름만)
      self.outcomes['llm_failed'] += 1   # 예외 건수 — finish 의 kinds 출력(llm_failed=N)에 실린다(재시도 대기와 구분)
      notes.append(f'{NOTE_LLM_FAIL}: {type(e).__name__}')
      return None
    if why:
      self.llm_screened += why
      notes.append('LLM 거름 ' + ' · '.join(f'{k} {v}' for k, v in sorted(why.items())))
    res.guidance += rows
    return {id(g) for g in rows}

  def _keep_pending(self, doc, note: str, prev_note: str | None, kind: str) -> None:
    """pending 그대로 note 만 — 같은 note 면 쓰지 않는다(매 실행 같은 문서를 다시 쓰지 않게)."""
    self.outcomes[kind] += 1
    if prev_note != note:
      self._set_doc(doc, 'pending', note, None)

  def process(self, doc, blob: bytes | None, prev_note: str | None = None, llm_attempts: int = 0) -> None:
    from customer_parsers.base import drop_off_vocab
    if not self.mod.wants(doc):
      # not_target 으로 닫지 않는다 — 나중에 이 서식의 파서(IR PDF 등)가 생기면 다시 봐야 한다
      return self._keep_pending(doc, NOTE_NO_PARSER, prev_note, 'no_parser')
    if blob is None and self._llm_off() and getattr(self.mod, 'llm_only', lambda d: False)(doc):
      # LLM 만 읽는 문서(IR 발표자료 등)인데 이번 실행은 LLM 이 안 돈다 — 내려받아 봐야 읽을 수 없다
      return self._keep_pending(doc, NOTE_LLM_WAIT, prev_note, 'llm_wait')
    try:
      content, sha = self._content(doc, blob)
    except Exception as e:  # 문서 하나 받기 실패가 실행 전체를 죽이지 않게
      if isinstance(e, _PROGRAMMING_ERRORS) and hasattr(self.mod, 'fetch') and blob is None:
        return self._parser_error(doc, e)
      kind = fetch_failure_kind(e, doc)
      self.outcomes[{'blocked': 'blocked', 'retry': 'fetch_retry', 'failed': 'fetch_failed'}[kind]] += 1
      # 일시 실패(차단·5xx 등·연결·만료 URL)는 pending 그대로 note 만 — 다음 실행이 다시 시도한다
      self._set_doc(doc, 'failed' if kind == 'failed' else 'pending', fetch_failure_note(e, doc), None)
      return
    notes: list[str] = []
    try:
      res = self.mod.parse(doc, content)
    except Exception as e:  # 파서 버그 하나가 다른 문서·회사를 막지 않게
      return self._parser_error(doc, e)
    try:
      llm_ids = self._llm(doc, content, res, notes)
    except _PROGRAMMING_ERRORS as e:
      return self._parser_error(doc, e)
    # 형식 밖 행을 먼저 버린다 — dedupe 가 먼저면 같은 키의 (형식 밖 코드 행, 맞는 LLM 행) 중 코드 행이 남았다가 버려져 둘 다 잃는다
    dropped = drop_off_vocab(res)
    if dropped:
      self.dropped += len(dropped)
      notes.append(f'어휘·기간 형식 밖 {len(dropped)}행 버림: ' + '; '.join(dropped[:5]))
    res.dedupe()  # 코드 행이 먼저 들어 있어 같은 키면 코드 우선
    checks = verify(res, content.text)
    v_values = sum(checks[id(r)][0] for r in value_rows(res))
    v_dates = sum(checks[id(d)][0] for d in res.dates)
    llm_n = sum(id(g) in llm_ids for g in res.guidance) if llm_ids else 0
    if llm_n and res.code_miss:
      # 코드 표식은 있는데 코드 가이던스가 모자랐다 — LLM 행이 파서 문구 미스를 가리지 않게 드러낸다
      code_n = len(res.guidance) - llm_n
      notes.append(NOTE_CODE_MISS_FILL if code_n else NOTE_CODE_MISS_ONLY)
      self.outcomes['code_miss'] += 1
    status, note = judge(res, v_values, v_dates, llm_n)
    retry = self._llm_retry_reason(res, notes, status, llm_n, v_values)
    if retry:
      return self._llm_retry(doc, res, checks, notes, status, note, retry, llm_attempts, sha, v_values, v_dates)
    llm_missed = llm_ids is None and hasattr(self.mod, 'llm_wants') and self.mod.llm_wants(doc, res)
    if status == 'not_target' and llm_missed:
      # LLM 이 읽어야 할 문서인데 이번에 못 돌았다(--no-llm·키 없음) — 닫으면 다시 못 본다
      return self._keep_pending(doc, NOTE_LLM_WAIT, prev_note, 'llm_wait')
    if status == 'parsed' and llm_missed:
      # 코드 행은 정상이라 parsed 로 닫되, LLM 칸(가이던스)을 못 읽었다는 표식을 note 맨 앞에 — 나중에 LLM 경로가
      # 붙으면 parse_note LIKE 'LLM 대기%' 로 뽑아 --reparse 한다. 다음 --reparse 에서 LLM 이 돌면 note 가 새로 써져 사라진다
      notes.insert(0, NOTE_LLM_WAIT_PARSED)
      self.outcomes['llm_wait_parsed'] += 1
    if note:
      notes.insert(0, note)
    self.outcomes[status] += 1
    if status == 'parsed':
      self._store(doc, payloads(doc, res, checks, llm_ids or set()), llm_ran=llm_ids is not None)
      self.verified['values'] += v_values
      self.verified['dates'] += v_dates
    # LLM 이 제대로 돌았으면 재시도 횟수를 0 으로(다음 --reparse 의 실패가 옛 횟수를 이어 세지 않게)
    reset = 0 if llm_ids is not None and llm_attempts else None
    self._set_doc(doc, status, ' · '.join(notes) or None, sha, reset)

  @staticmethod
  def _llm_retry_reason(res, notes: list[str], status: str, llm_n: int, v_values: int) -> str | None:
    """LLM 을 다음 실행에 다시 돌릴 사유 — (a) extract 예외(판정이 무엇이든 — 코드가 서식을 알아봤는데 0행이라 failed 인
    문서도 LLM 이 채울 수 있다 · 수정 2회차 A) · (b) 값 행이 전부 LLM 행인데 전부 대조 실패."""
    fail = next((n for n in notes if n.startswith(NOTE_LLM_FAIL)), None)
    if fail:
      return fail
    if status == 'failed' and llm_n and llm_n == len(value_rows(res)) and v_values == 0:
      return NOTE_LLM_UNVERIFIED
    return None

  def _llm_retry(self, doc, res, checks, notes, status, judged, reason, attempts, sha, v_values, v_dates) -> None:
    """재시도 대기(pending · llm_attempts+1) 또는 상한이면 닫기. 코드 값 행은 어느 쪽이든 적재한다(멱등)."""
    attempts += 1
    code_ok = status == 'parsed'   # (a) 코드 행이 있어 parsed 로 판정된 문서
    if code_ok:
      # 코드 행만 싣는다(LLM 은 실패했다) — llm_ran=False 라 선삭제가 옛 LLM 행을 지우지 않는다
      self._store(doc, payloads(doc, res, checks, set()), llm_ran=False)
      self.verified['values'] += v_values
      self.verified['dates'] += v_dates
    # judge 의 note('새 문서인데 숫자 0개')는 LLM 예외 때만 덧붙인다 — 대조 실패 사유는 같은 말을 이미 한다
    keep = [judged] if judged and reason != NOTE_LLM_UNVERIFIED else []
    others = keep + [n for n in notes if not n.startswith(NOTE_LLM_FAIL)]
    if attempts < LLM_MAX_ATTEMPTS:
      self.outcomes['llm_retry'] += 1
      note = f'{NOTE_LLM_RETRY}{reason} ({attempts}/{LLM_MAX_ATTEMPTS})'
      return self._set_doc(doc, 'pending', ' · '.join([note, *others]), sha, attempts)
    closed = 'parsed' if code_ok else 'failed'
    self.outcomes[closed] += 1
    self.outcomes['llm_gave_up'] += 1
    self._set_doc(doc, closed, ' · '.join([f'{NOTE_LLM_GAVE_UP} — {reason}', *others]), sha, attempts)

  def _parser_error(self, doc, e: Exception) -> None:
    self.outcomes['failed'] += 1
    self._set_doc(doc, 'failed', f'파서 예외: {type(e).__name__}', None)

  def _store(self, doc, tables: dict[str, list[dict]], llm_ran: bool) -> None:
    """문서 1건 = 표마다 upsert 1회(dedupe 뒤라 한 요청 안 PK 중복 없음)."""
    from lib.retry import with_retry
    if not self.args.dry_run and doc.id:
      # 가이던스 키는 (document_id, metric, period) — 다시 파싱(--reparse·--add-file)한 문서에서 사라진 칸이
      # 옛 행으로 남지 않게 그 문서 행을 먼저 지운다(새 문서면 지울 행이 없다). 방향은 finish 가 다시 매긴다.
      # 이번에 LLM 이 안 돌았으면 코드 행만 지운다 — LLM 행은 다시 만들 수 없는데 같이 지우면 그냥 사라진다.
      q = self.ws.table('customer_guidance').delete().eq('document_id', doc.id)
      if not llm_ran:
        q = q.eq('extractor', 'code')
      q.execute()
    for table, rows in tables.items():
      conflict, key_cols = TABLES[table]
      if key_cols:
        if table not in self._pubs:
          self._pubs[table] = existing_pubs(self.client, table, self.cid, key_cols)
        rows = newer_only(rows, self._pubs[table], key_cols)
      if not rows:
        continue
      self.rows[table] += len(rows)
      if self.args.dry_run:
        continue
      with_retry(lambda: self.ws.table(table).upsert(rows, on_conflict=conflict).execute(), _label=f'{table} upsert')
      if key_cols:
        self._pubs[table].update({tuple(r[c] for c in key_cols): (r['published_at'], r['verified']) for r in rows})

  def _directions(self) -> int:
    """그 회사의 verified 가이던스 전부 → assign → 바뀐 행만 update. 반환 = 바뀐 행 수.
    ⚠️ dry-run 은 DB 에 이미 있는 행만 본다 — 이번에 적재할 예정 행은 아직 없어 그 숫자에 안 들어간다."""
    from lib import guidance_direction
    rows = fetch_all(lambda: self.client.table('customer_guidance')
                     .select('id,metric,period,published_at,document_id,low,high,value_text,stated,unit,currency,'
                             'direction')
                     .eq('company_id', self.cid).eq('verified', True), ('id',))
    base = getattr(self.mod, 'BASE_CURRENCY', None)
    for r in rows:   # null = 회사 보고 통화 — 통화가 다른 행끼리는 decide 가 숫자를 견주지 않는다(수정 2회차 N5)
      r['currency'] = r.get('currency') or base
    cur = {r['id']: r['direction'] for r in rows}
    changed = [(i, d) for i, d in guidance_direction.assign(rows) if cur[i] != d]
    if not self.args.dry_run:
      for i, d in changed:
        self.ws.table('customer_guidance').update({'direction': d}).eq('id', i).execute()
    return len(changed)

  def finish(self, ticker: str, n_docs: int) -> int:
    """방향 재계산 · 상태 행 · 한 줄 출력. 반환 = exit 1 사유 건수(파싱 실패 + 401·403 밖 받기 실패).
    상태 우선순위 parse_failed > blocked > error > ok — 일시 실패 문서는 pending 이라 매 실행 다시 시도돼
    차단(401·403)이면 blocked, 5xx·연결 오류면 error 가 실행마다 다시 난다(하루 만에 ok 로 덮이지 않는다)."""
    from collect_customer_docs import write_status
    o = self.outcomes
    # 가이던스를 쓴 문서(parsed · LLM 재시도 대기 중 코드 행을 실은 문서)가 하나라도 있으면 다시 매긴다 — 실은
    # 가이던스가 0행이어도 선삭제가 옛 행을 지웠을 수 있고, 그러면 뒤 문서가 옛 기준으로 매긴 방향을 그대로 들고 남는다
    moved = self._directions() if o['parsed'] or o['llm_retry'] else 0
    parse_failed, blocked = o['failed'], o['blocked']
    fetch_failed = o['fetch_failed'] + o['fetch_retry']
    llm_retry = o['llm_retry']
    reasons = []
    if parse_failed:
      reasons.append(f'새 문서 {parse_failed}건에서 숫자를 못 뽑음(파서 점검 필요)')
    if blocked:
      reasons.append(f'문서 {blocked}건 내용 접근 차단(HTTP 401·403)')
    if fetch_failed:
      reasons.append(f'문서 {fetch_failed}건 내용 받기 실패')
    if llm_retry:
      reasons.append(f'문서 {llm_retry}건 LLM 재시도 대기(pending · 다음 실행이 다시 시도)')
    if o['llm_gave_up']:
      reasons.append(f'문서 {o["llm_gave_up"]}건 LLM {LLM_MAX_ATTEMPTS}회 실패로 닫음')
    status = ('parse_failed' if parse_failed else 'blocked' if blocked else 'error' if fetch_failed else 'ok')
    if not self.args.dry_run:
      write_status(self.ws, self.cid, 'parse', status, ' · '.join(reasons) or None)
    kinds = ' '.join(f'{k}={v}' for k, v in sorted(o.items()))
    tabs = ' '.join(f'{t.removeprefix("customer_")}={n}' for t, n in sorted(self.rows.items()))
    moved_label = '방향 바뀜(기존 행만 · 적재 예정 미반영)' if self.args.dry_run else '방향 바뀜'
    print(f'  {ticker:<10} 문서 {n_docs} · {kinds}' + (f' · 행 {tabs}' if tabs else '')
          + f' · 검증 값 {self.verified["values"]} 일정 {self.verified["dates"]}'
          + (f' · 형식 밖 버림 {self.dropped}' if self.dropped else '')
          + (f' · LLM 호출 {self.llm_calls}' if self.llm_calls else '')
          + (f' · LLM 거름 {sum(v for k, v in self.llm_screened.items() if k != "억→million 환산")}'
             if self.llm_screened else '') + f' · {moved_label} {moved} · {status}')
    return parse_failed + fetch_failed


if __name__ == '__main__':
  sys.exit(main())
