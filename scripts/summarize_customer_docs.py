"""고객사 공식 문서 → 한국어 3~5줄 요약·중요도·근거 쪽 캡처(사외비 표 customer_doc_summaries · 버킷 customer-doc-pages).

순서: 자가 시험(exit 2) → 대상 문서(종류 TARGET_TYPES · 게시일 범위 · 요약 행 없음 · 게시일 오름차순) → 문서마다
원문 받기(collect_customer_numbers.doc_content — 회사 파서 fetch 우선 → 공통 fetch_content) → PDF 면 쪽 표식 글 →
API 호출(구조화 출력) → 검사(lib.customer_summary_check) → 지적 있으면 1회 재요청 → 그래도 지적이면 check_failed →
ok·PDF·쪽 있으면 렌더·업로드 → upsert(doc_id).
쪽 렌더·업로드가 실패하면 요약은 ok 그대로 두고 그 쪽을 pages 에 key=None 으로 남긴다(사유는 check_note 「N쪽 캡처 실패(…)」)
→ --retry-pages 가 그 쪽만 원문을 다시 받아 렌더·업로드한다(API 호출 0 · 요약 행이 있어 정기 실행은 다시 안 집는다).
--recheck = 검사기를 고친 뒤 check_failed 행의 «저장된» 요약을 원문과 다시 검사한다(API 호출 0). 통과하면 status=ok ·
쪽 캡처 · updated_at(prompt_version·요약 본문 그대로) · 여전히 실패면 check_note 만 새 지적으로. 원문 sha 가 다르면 건너뜀.

exit 0 정상(검사 실패 check_failed · 글이 짧아 건너뜀 포함 — 저장 행·로그에 남는다)
       · 원문 받기 «경고»(HTTP 401·403 접근 차단 · 404 없음 · 크기 초과) 포함 — GHA 에선 ::warning:: 으로 노랗게 뜬다
         (수집기 collect_customer_numbers 의 401·403 꼴 · 행이 안 생겨 14일 창 안에서 다음 실행이 다시 집는다)
     1 API 오류·DB 오류(요약·저장 실패) 1건 이상 · 그 밖 받기 실패(5xx·연결·시간 초과·형식 오류) 1건 이상 ·
       API 키 없음(대상 문서가 있을 때)
     2 자가 시험 실패 · 인자 오류 · 회사 없음
사용: summarize_customer_docs.py [--company TICKER] [--doc-id ID ...] [--since-days 14] [--backfill] [--limit N] [--dry-run]
      summarize_customer_docs.py --retry-pages [--company TICKER] [--doc-id ID ...] [--limit N] [--dry-run]
      summarize_customer_docs.py --recheck [--company TICKER] [--doc-id ID ...] [--limit N] [--dry-run]

🔴 GHA 정기 실행은 새 문서만(게시일 최근 14일 · 요약 행 없음). 소급(--backfill = 365일)은 사용자 승인 뒤 로컬 수동 —
   정기 실행이 소급을 대신하면 비용 관문(B8)이 무너진다.
🔴 --dry-run = API 호출·검사·로컬 렌더까지만. Storage 업로드·DB 쓰기 0회(WriteSession 도 열지 않는다).
   요약 본문은 --dry-run 때만 출력한다(정기 로그엔 건수·토큰·상태 + 재요청이면 「첫 시도 지적: 숫자 2 · 통화 1」처럼
   갈래 이름·건수만).
--doc-id 는 요약 행이 있어도 다시 만든다(upsert).
"""
import argparse
import contextlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone

MODEL = os.environ.get('CUSTOMER_SUMMARY_MODEL', 'claude-opus-5-5')
EFFORT = os.environ.get('CUSTOMER_SUMMARY_EFFORT', 'high')
MAX_TOKENS = 16000
PRICE_IN, PRICE_OUT = 4.0, 20.0     # USD per MTok(Opus 5.5) — 비용 출력용
MIN_CHARS = 300
TARGET_TYPES = ('earnings_release', 'presentation', 'shareholder_letter', 'investor_day', 'guidance', 'fact_sheet',
                'prelim_results')
# 화면 배지(lib/customers/format.ts DOC_TYPE)와 같은 이름 · 주주서한은 화면 표에 없어 여기서만
DOC_TYPE_KO = {'earnings_release': '실적 발표', 'presentation': '발표 자료', 'shareholder_letter': '주주서한',
               'investor_day': '투자자의 날', 'guidance': '전망 공시', 'fact_sheet': '팩트시트', 'prelim_results': '잠정 실적'}
DOC_COLS = 'id,company_id,source,source_id,doc_type,form,items,title,url,published_at'
DEFAULT_SINCE_DAYS, BACKFILL_DAYS = 14, 365
_IN_CHUNK = 100
_NOTE_MAX = 500
_FETCH_WARN_HTTP = (401, 403, 404)   # 받기 실패 중 경고(exit 0)로 셀 HTTP 상태


def usd(in_tok: int, out_tok: int) -> float:
  return in_tok / 1e6 * PRICE_IN + out_tok / 1e6 * PRICE_OUT


# ── API 호출(뉴스 요약기도 쓴다) ──────────────────────────────────────────────

def _call(llm, system: str, schema: dict, messages: list[dict]):
  from lib.llm_guidance import Incomplete
  msg = llm.messages.create(
    model=MODEL, max_tokens=MAX_TOKENS, thinking={'type': 'adaptive'},
    output_config={'effort': EFFORT, 'format': {'type': 'json_schema', 'schema': schema}},
    system=system, messages=messages)
  usage = getattr(msg, 'usage', None)
  tok = (getattr(usage, 'input_tokens', 0) or 0, getattr(usage, 'output_tokens', 0) or 0)
  if msg.stop_reason in ('max_tokens', 'refusal'):
    raise Incomplete(msg.stop_reason)
  body = next((b.text for b in msg.content if b.type == 'text'), '')
  return json.loads(body), body, tok


def ask(llm, system: str, schema: dict, user: str, check) -> dict:
  """호출 → check(result) → 지적이 있으면 그 지적을 붙여 1회 재요청. 반환 = {result, problems, in, out, tries}.
  check 는 (고친 결과, 지적 목록)을 돌려준다. 예외(API·JSON·Incomplete)는 호출자가 그 문서만 격리한다."""
  from lib.customer_summary_prompt import retry_message
  messages = [{'role': 'user', 'content': user}]
  raw, body, (i1, o1) = _call(llm, system, schema, messages)
  result, problems = check(raw)
  out = {'result': result, 'problems': problems, 'in': i1, 'out': o1, 'tries': 1}
  if not problems:
    return out
  messages += [{'role': 'assistant', 'content': body}, {'role': 'user', 'content': retry_message(problems)}]
  raw2, _, (i2, o2) = _call(llm, system, schema, messages)
  result2, problems2 = check(raw2)
  return {'result': result2, 'problems': problems2, 'in': i1 + i2, 'out': o1 + o2, 'tries': 2,
          'first_problems': problems}


def now_iso() -> str:
  return datetime.now(timezone.utc).isoformat()


def fetch_failure_is_warning(e: Exception) -> bool:
  """원문 받기 실패 중 경고(exit 0)로 셀 것 — 접근 차단 401·403 · 없음 404 · 크기 초과(TooLarge).
  그 밖(5xx·연결·시간 초과·형식 오류)은 오류(exit 1) — 수집기(collect_customer_numbers.fetch_failure_kind)의 차단 꼴."""
  from collect_customer_numbers import http_status
  from lib.ir_lists import TooLarge
  return isinstance(e, TooLarge) or http_status(e) in _FETCH_WARN_HTTP


# ── 원문 → 요약할 글 ─────────────────────────────────────────────────────────

def source_text(content) -> tuple[str, bool, int]:
  """(글, PDF 인가, 쪽 수). PDF 면 쪽 표식 글 · 아니면 본문 + 표 행. DART 는 raw 가 빈 바이트다(본문만)."""
  from lib.customer_doc_pages import page_marked_text
  from lib.doc_text import row_text
  raw = content.raw or b''
  if raw[:5] == b'%PDF-':
    text, pages = page_marked_text(raw)
    return text, True, pages
  rows = '\n'.join(row_text(r) for t in content.tables or [] for r in t)   # tables = [표[행[칸]]] — 세 겹
  return (content.text or '') + ('\n' + rows if rows else ''), False, 0


# ── 쪽 캡처(요약기·--retry-pages 공통) ──────────────────────────────────────

def _page_fail_note(page, why: str) -> str:
  return f'{page}쪽 캡처 실패({why})'


def _capture(raw: bytes, company_id: str, doc_id: int, page: int, dry_run: bool, uploader) -> tuple[str | None, str | None]:
  """한 쪽 렌더 → 업로드. (key, 실패 사유) — 성공이면 사유 None · 실패면 key None. dry_run 은 렌더까지만(key 는 채운다)."""
  from lib import customer_doc_pages as pages_lib
  png = pages_lib.render_page(raw, page)
  if png is None:
    return None, '렌더'
  key = pages_lib.page_key(company_id, doc_id, page)
  if not dry_run:
    try:
      (uploader or pages_lib.upload_png)(key, png)
    except Exception as e:  # 그 쪽만 key 없이 남기고 요약은 저장한다
      return None, f'업로드 {type(e).__name__}'
  return key, None


def missing_pages(pages) -> list[int]:
  """pages(JSONB) 중 key 가 없는 쪽 번호 — 형태가 어긋나면 빈 목록."""
  if not isinstance(pages, list):
    return []
  return [int(p['page']) for p in pages if isinstance(p, dict) and p.get('page') and not p.get('key')]


def retry_pages(summary: dict, content, *, dry_run: bool, ws=None, uploader=None) -> dict:
  """--retry-pages — summary(customer_doc_summaries 행: doc_id·company_id·pages·check_note)의 key 없는 쪽만 다시 렌더·업로드.
  API 호출 0 · 요약 본문·상태는 안 건드린다. 하나라도 고치면 pages·check_note(고친 쪽의 실패 사유만 지움)를 update.
  반환 {fixed, still}."""
  pages = [dict(p) for p in summary['pages']]
  fixed, still = [], []
  for p in pages:
    if p.get('key'):
      continue
    key, why = _capture(content.raw or b'', summary['company_id'], summary['doc_id'], int(p['page']), dry_run, uploader)
    if why:
      still.append(p['page'])
      print(f'    문서 {summary["doc_id"]} {_page_fail_note(p["page"], why)} — 다시 실패')
      continue
    p['key'] = key
    fixed.append(p['page'])
  if fixed and not dry_run and ws is not None:
    heads = tuple(_page_fail_note(pg, '')[:-1] for pg in fixed)   # 「N쪽 캡처 실패(」
    note = ' · '.join(n for n in (summary.get('check_note') or '').split(' · ') if n and not n.startswith(heads))
    ws.table('customer_doc_summaries').update(
      {'pages': pages, 'check_note': note or None, 'updated_at': now_iso()}).eq('doc_id', summary['doc_id']).execute()
  return {'fixed': len(fixed), 'still': len(still)}


def recheck_doc(summary: dict, content, *, dry_run: bool, ws=None, uploader=None) -> dict:
  """--recheck — 검사 실패 행(summary)의 «저장된» 요약을 지금 검사기로 다시 검사(API 호출 0).
  통과 → status=ok · check_note(고침 메모만) · PDF 면 쪽 캡처(_capture) · updated_at 갱신(요약 본문·prompt_version 그대로).
  여전히 실패 → check_note 만 새 지적으로. 반환 {outcome, problems}."""
  from lib.customer_summary_check import check_doc
  from lib.llm_guidance import MAX_CHARS
  text, is_pdf, page_count = source_text(content)
  text = text[:MAX_CHARS]                                # 요약 때 넘긴 글과 같게(summarize_doc 과 같은 자르기)
  stored = {k: summary.get(k) for k in ('lines', 'importance', 'importance_reason', 'evidence', 'c_materials')}
  stored['pages'] = [{'page': p['page'], 'caption': p['caption']} for p in summary.get('pages') or []]
  r, problems = check_doc(stored, text, is_pdf, page_count)
  notes = [n for n in (r.get('check_note'), ' · '.join(problems) if problems else None) if n]
  if problems:
    update = {'check_note': ' · '.join(notes)[:_NOTE_MAX]}
  else:
    pages = []
    for p in r['pages'] if is_pdf else []:
      key, why = _capture(content.raw, summary['company_id'], summary['doc_id'], int(p['page']), dry_run, uploader)
      if why:
        print(f'    문서 {summary["doc_id"]} {_page_fail_note(p["page"], why)} — key 없이 남김')
        notes.append(_page_fail_note(p['page'], why))
      pages.append({'page': int(p['page']), 'caption': p['caption'], 'key': key})
    update = {'status': 'ok', 'importance': r.get('importance'), 'evidence': r['evidence'], 'pages': pages,
              'c_materials': r['c_materials'], 'check_note': ' · '.join(notes)[:_NOTE_MAX] or None,
              'updated_at': now_iso()}
  if not dry_run and ws is not None:
    ws.table('customer_doc_summaries').update(update).eq('doc_id', summary['doc_id']).execute()
  return {'outcome': 'check_failed' if problems else 'ok', 'problems': problems}


# ── 문서 하나 ────────────────────────────────────────────────────────────────

def summarize_doc(llm, row: dict, company: str, content, sha: str | None, *, dry_run: bool, ws=None,
                  uploader=None) -> dict:
  """문서 하나 → 결과 dict(outcome = ok | check_failed | skipped). 저장은 dry_run 이 아니고 ws 가 있을 때만.
  uploader = lib.customer_doc_pages.upload_png(시험은 가짜) — dry_run 이면 부르지 않는다."""
  from lib import customer_summary_prompt as sp
  from lib.customer_summary_check import check_doc
  from lib.llm_guidance import MAX_CHARS

  text, is_pdf, page_count = source_text(content)
  if len(text.strip()) < MIN_CHARS:
    return {'outcome': 'skipped', 'why': f'글 {len(text.strip())}자'}
  if len(text) > MAX_CHARS:
    print(f'    문서 {row["id"]} 글 {len(text):,}자 → 앞 {MAX_CHARS:,}자만 넘김')
    text = text[:MAX_CHARS]
  user = sp.doc_user_message(company, DOC_TYPE_KO.get(row['doc_type'], row['doc_type']), row['title'],
                             str(row['published_at']), text, is_pdf, page_count)
  got = ask(llm, sp.DOC_SYSTEM, sp.DOC_SCHEMA, user, lambda r: check_doc(r, text, is_pdf, page_count))
  r, problems = got['result'], got['problems']
  status = 'check_failed' if problems else 'ok'
  notes = [n for n in (r.get('check_note'), ' · '.join(problems) if problems else None) if n]

  pages = []
  if status == 'ok' and is_pdf:
    for p in r['pages']:
      key, why = _capture(content.raw, row['company_id'], row['id'], int(p['page']), dry_run, uploader)
      if why:   # 요약은 ok 로 저장하고 그 쪽은 key=None 으로 남긴다 → --retry-pages 가 다시 집는다(Codex 2026-11-12)
        print(f'    문서 {row["id"]} {_page_fail_note(p["page"], why)} — key 없이 남김')
        notes.append(_page_fail_note(p['page'], why))
      pages.append({'page': int(p['page']), 'caption': p['caption'], 'key': key})
  elif is_pdf:   # 검사 실패 — 캡처 없이 고른 쪽·캡션만 남긴다(--recheck 가 통과시키면 그때 캡처 · 화면은 ok 행만 읽는다)
    pages = [{'page': p.get('page'), 'caption': p.get('caption'), 'key': None} for p in r['pages']]

  out = {
    'doc_id': row['id'], 'company_id': row['company_id'], 'status': status,
    'importance': r.get('importance'), 'importance_reason': r.get('importance_reason'),
    'lines': r['lines'], 'evidence': r['evidence'], 'pages': pages, 'c_materials': r['c_materials'],
    'check_note': ' · '.join(notes)[:_NOTE_MAX] or None,
    'model': MODEL, 'prompt_version': sp.PROMPT_VERSION,
    'input_tokens': got['in'], 'output_tokens': got['out'], 'source_sha': sha, 'updated_at': now_iso(),
  }
  if not dry_run and ws is not None:
    ws.table('customer_doc_summaries').upsert(out, on_conflict='doc_id').execute()
  return {'outcome': status, 'row': out, 'problems': problems, 'tries': got['tries'], 'picked': len(r['pages']),
          'first_problems': got.get('first_problems', [])}


# ── 대상 ─────────────────────────────────────────────────────────────────────

def load_targets(client, company_id: str | None, doc_ids: list[int], since: str) -> list[dict]:
  from collect_customer_numbers import fetch_all

  def q():
    b = client.table('customer_documents').select(DOC_COLS).in_('doc_type', list(TARGET_TYPES))
    b = b.in_('id', doc_ids) if doc_ids else b.gte('published_at', since)
    return b.eq('company_id', company_id) if company_id else b
  rows = fetch_all(q, ('published_at', 'id'))
  if doc_ids:
    return rows
  done = set()
  ids = [r['id'] for r in rows]
  for i in range(0, len(ids), _IN_CHUNK):
    got = client.table('customer_doc_summaries').select('doc_id').in_('doc_id', ids[i:i + _IN_CHUNK]).execute().data
    done |= {g['doc_id'] for g in got}
  return [r for r in rows if r['id'] not in done]


def load_retry_targets(client, company_id: str | None, doc_ids: list[int]) -> list[dict]:
  """--retry-pages 대상 — status=ok 이고 pages 에 key 없는 쪽이 있는 요약 행."""
  from collect_customer_numbers import fetch_all

  def q():
    b = client.table('customer_doc_summaries').select('doc_id,company_id,pages,check_note,source_sha').eq('status', 'ok')
    b = b.in_('doc_id', doc_ids) if doc_ids else b
    return b.eq('company_id', company_id) if company_id else b
  return [r for r in fetch_all(q, ('doc_id',)) if missing_pages(r['pages'])]


def _with_sources(client, targets: list[dict], dry_run: bool, counts: dict, label_of):
  """요약 행마다 원문을 다시 받아 (행, 원문, ws, 라벨)을 내준다(--retry-pages·--recheck 공통 · API 호출 0).
  원문 행 없음·받기 오류는 counts['error'] · 받기 경고는 counts['fetch_warn'] · 원문 sha 가 저장값과 다르면
  counts['changed'] 로 세고 건너뛴다(요약과 다른 원문이면 쪽·인용이 갈린다). dry_run 이면 ws=None(쓰기 0)."""
  import requests

  import customer_parsers
  from collect_customer_numbers import _to_doc, doc_content, http_status
  from lib import db
  docs = {}
  ids = [t['doc_id'] for t in targets]
  for i in range(0, len(ids), _IN_CHUNK):
    for d in client.table('customer_documents').select(DOC_COLS).in_('id', ids[i:i + _IN_CHUNK]).execute().data:
      docs[d['id']] = d
  names = load_company_names(client, {t['company_id'] for t in targets})
  session = requests.Session()
  ctx = contextlib.nullcontext(None) if dry_run else db.WriteSession()
  with ctx as ws:
    for t in targets:
      d = docs.get(t['doc_id'])
      ticker = names.get(t['company_id'], ('?', '?'))[0]
      label = label_of(t, ticker)
      if d is None:
        counts['error'] += 1
        print(f'{label} · 원문 행 없음')
        continue
      try:
        content, sha = doc_content(customer_parsers.module_for(ticker), session, _to_doc(d, ticker))
      except Exception as e:
        code = http_status(e)
        warn = fetch_failure_is_warning(e)
        counts['fetch_warn' if warn else 'error'] += 1
        print(f'{label} · 받기 실패({type(e).__name__}' + (f' HTTP {code}' if code else '') + ')' + (' — 경고' if warn else ''))
        continue
      if sha and t.get('source_sha') and sha != t['source_sha']:
        counts['changed'] += 1
        print(f'{label} · 원문이 요약 때와 다르다 — 건너뜀(--doc-id 로 요약을 다시 만들 것)')
        continue
      yield t, content, ws, label


def run_retry_pages(client, company_id: str | None, doc_ids: list[int], limit: int | None, dry_run: bool) -> int:
  """키 없는 쪽만 원문을 다시 받아 렌더·업로드(API 호출 0). exit = 받기 «오류»(경고 아닌 것) 1건 이상이면 1."""
  targets = load_retry_targets(client, company_id, doc_ids)[:limit or None]
  print(f'쪽 재시도 대상 {len(targets)}건' + (' · dry-run' if dry_run else ''))
  counts = {'fixed': 0, 'still': 0, 'changed': 0, 'fetch_warn': 0, 'error': 0}
  label_of = lambda t, ticker: f'  문서 {t["doc_id"]} {ticker} 쪽 {missing_pages(t["pages"])}'  # noqa: E731
  for t, content, ws, label in _with_sources(client, targets, dry_run, counts, label_of):
    try:
      res = retry_pages(t, content, dry_run=dry_run, ws=ws)
    except Exception as e:
      counts['error'] += 1
      print(f'{label} · 실패({type(e).__name__})')
      continue
    counts['fixed'] += res['fixed']
    counts['still'] += res['still']
    print(f'{label} · 고침 {res["fixed"]} · 다시 실패 {res["still"]}')
  print(f'쪽 고침 {counts["fixed"]} · 다시 실패 {counts["still"]} · 원문 바뀜 {counts["changed"]} · 받기 경고 '
        f'{counts["fetch_warn"]} · 오류 {counts["error"]} · API 호출 0')
  return 1 if counts['error'] else 0


def load_recheck_targets(client, company_id: str | None, doc_ids: list[int]) -> list[dict]:
  """--recheck 대상 — status=check_failed 인 요약 행(저장된 결과 전부)."""
  from collect_customer_numbers import fetch_all

  def q():
    b = client.table('customer_doc_summaries').select(
      'doc_id,company_id,lines,importance,importance_reason,evidence,pages,c_materials,check_note,source_sha'
    ).eq('status', 'check_failed')
    b = b.in_('doc_id', doc_ids) if doc_ids else b
    return b.eq('company_id', company_id) if company_id else b
  return fetch_all(q, ('doc_id',))


def run_recheck(client, company_id: str | None, doc_ids: list[int], limit: int | None, dry_run: bool) -> int:
  """검사 실패 행의 저장된 요약을 원문과 다시 검사(API 호출 0). exit = 받기·저장 «오류» 1건 이상이면 1.
  --dry-run 이면 판정과 지적만 출력(쓰기·업로드 0)."""
  targets = load_recheck_targets(client, company_id, doc_ids)[:limit or None]
  print(f'재검사 대상 {len(targets)}건' + (' · dry-run' if dry_run else ''))
  counts = {'ok': 0, 'check_failed': 0, 'changed': 0, 'fetch_warn': 0, 'error': 0}
  label_of = lambda t, ticker: f'  문서 {t["doc_id"]} {ticker}'  # noqa: E731
  for t, content, ws, label in _with_sources(client, targets, dry_run, counts, label_of):
    try:
      res = recheck_doc(t, content, dry_run=dry_run, ws=ws)
    except Exception as e:
      counts['error'] += 1
      print(f'{label} · 실패({type(e).__name__})')
      continue
    counts[res['outcome']] += 1
    print(f'{label} · {res["outcome"]}')
    if dry_run:
      for p in res['problems']:
        print(f'    지적: {p}')
  print(f'재검사 ok {counts["ok"]} · 여전히 실패 {counts["check_failed"]} · 원문 바뀜 {counts["changed"]} · 받기 경고 '
        f'{counts["fetch_warn"]} · 오류 {counts["error"]} · API 호출 0')
  return 1 if counts['error'] else 0


def load_company_names(client, ids: set[str]) -> dict[str, tuple[str, str]]:
  """company_id → (ticker, 표시 이름)."""
  ids, out = sorted(ids), {}
  for i in range(0, len(ids), _IN_CHUNK):
    for c in client.table('companies').select('id,ticker,name_kr').in_('id', ids[i:i + _IN_CHUNK]).execute().data:
      out[c['id']] = (c['ticker'], c['name_kr'] or c['ticker'])
  return out


def _args(argv):
  p = argparse.ArgumentParser(description='고객사 공식 문서 요약')
  p.add_argument('--company')
  p.add_argument('--doc-id', type=int, action='append', default=[])
  p.add_argument('--since-days', type=int, default=DEFAULT_SINCE_DAYS)
  p.add_argument('--backfill', action='store_true', help=f'게시일 최근 {BACKFILL_DAYS}일(사용자 승인 뒤 로컬 수동)')
  p.add_argument('--limit', type=int)
  p.add_argument('--retry-pages', action='store_true',
                 help='key 없는 쪽이 있는 ok 행만 원문을 다시 받아 렌더·업로드(API 호출 0 · --company·--doc-id·--limit 적용)')
  p.add_argument('--recheck', action='store_true',
                 help='check_failed 행의 저장된 요약을 원문과 다시 검사(API 호출 0 · --company·--doc-id·--limit 적용)')
  p.add_argument('--dry-run', action='store_true')
  a = p.parse_args(argv)
  if a.retry_pages and a.recheck:
    p.error('--retry-pages 와 --recheck 는 함께 쓸 수 없다')
  return a


def self_tests() -> list[str]:
  from lib.customer_summary_check import self_test
  return self_test()


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

  import requests

  import customer_parsers
  from collect_customer_numbers import _to_doc, doc_content, http_status
  from lib import db, llm_guidance
  from lib.customer_summary_check import problem_kinds

  client = db.get_client()
  company_id = None
  if args.company:
    got = client.table('companies').select('id').eq('ticker', args.company).execute().data
    if not got:
      print(f'회사 없음: {args.company}')
      return 2
    company_id = got[0]['id']
  if args.retry_pages:
    return run_retry_pages(client, company_id, args.doc_id, args.limit, args.dry_run)
  if args.recheck:
    return run_recheck(client, company_id, args.doc_id, args.limit, args.dry_run)
  days = BACKFILL_DAYS if args.backfill else args.since_days
  since = (datetime.now(timezone(timedelta(hours=9))).date() - timedelta(days=days)).isoformat()
  rows = load_targets(client, company_id, args.doc_id, since)
  if args.limit:
    rows = rows[:args.limit]
  names = load_company_names(client, {r['company_id'] for r in rows})
  print(f'대상 문서 {len(rows)}건' + (f' · 게시일 {since} 이후' if not args.doc_id else '') + (' · dry-run' if args.dry_run else ''))
  if not rows:
    return 0
  llm = llm_guidance.make_client()
  if llm is None:
    print('ANTHROPIC_API_KEY 없음 — 요약 못 함')
    if os.environ.get('GITHUB_ACTIONS'):
      print(f'::warning::ANTHROPIC_API_KEY 없음 — 문서 {len(rows)}건 요약을 건너뛰었다(Secret 확인)')
    return 1

  session = requests.Session()
  counts = {'ok': 0, 'check_failed': 0, 'skipped': 0, 'fetch_warn': 0, 'error': 0}
  tok_in = tok_out = 0
  ctx = contextlib.nullcontext(None) if args.dry_run else db.WriteSession()
  with ctx as ws:
    for r in rows:
      ticker, name = names.get(r['company_id'], ('?', '?'))
      label = f'  문서 {r["id"]} {ticker} {r["doc_type"]} {r["published_at"]}'
      try:
        content, sha = doc_content(customer_parsers.module_for(ticker), session, _to_doc(r, ticker))
      except Exception as e:
        code = http_status(e)
        what = f'{type(e).__name__}' + (f' HTTP {code}' if code else '')   # 예외 문장엔 URL·키가 실릴 수 있다
        if fetch_failure_is_warning(e):
          counts['fetch_warn'] += 1
          print(f'{label} · 받기 실패({what}) — 경고')
        else:
          counts['error'] += 1
          print(f'{label} · 받기 실패({what})')
        continue
      try:
        res = summarize_doc(llm, r, name, content, sha, dry_run=args.dry_run, ws=ws)
      except Exception as e:
        counts['error'] += 1
        print(f'{label} · 요약 실패({type(e).__name__})')
        continue
      counts[res['outcome']] += 1
      if res['outcome'] == 'skipped':
        print(f'{label} · 건너뜀({res["why"]})')
        continue
      row = res['row']
      tok_in, tok_out = tok_in + row['input_tokens'], tok_out + row['output_tokens']
      print(f'{label} · {res["outcome"]} · 호출 {res["tries"]}회 · 토큰 입력 {row["input_tokens"]:,} 출력 '
            f'{row["output_tokens"]:,} · 쪽 {sum(1 for p in row["pages"] if p["key"])}/{res["picked"]}')
      if res['first_problems'] and not args.dry_run:   # 재요청 원인 — 갈래 이름·건수만(본문·숫자 값 없음)
        print(f'    첫 시도 지적: {problem_kinds(res["first_problems"])}')
      if args.dry_run:
        for p in res['first_problems']:
          print(f'    첫 시도 지적: {p}')
        print(f'    중요도 {row["importance"]} — {row["importance_reason"]}')
        for line in row['lines']:
          print(f'    | {line}')
        for p in row['pages']:
          print(f'    쪽 {p["page"]}: {p["caption"]}')
        for c in row['c_materials']:
          print(f'    C 재료 {c["kind"]} 쪽 {c["page"]}: {c["note"]}')
        if row['check_note']:
          print(f'    검사: {row["check_note"]}')
  print(f'처리 {sum(counts.values())} · ok {counts["ok"]} · 검사 실패 {counts["check_failed"]} · 건너뜀 '
        f'{counts["skipped"]} · 받기 경고 {counts["fetch_warn"]} · 오류 {counts["error"]} · 토큰 입력 {tok_in:,} '
        f'출력 {tok_out:,} · 추정 {usd(tok_in, tok_out):.2f} USD ({MODEL})')
  if counts['fetch_warn'] and os.environ.get('GITHUB_ACTIONS'):
    print(f'::warning::문서 {counts["fetch_warn"]}건 원문 받기 실패(HTTP 401·403·404·크기 초과) — 요약 건너뜀')
  return 1 if counts['error'] else 0


if __name__ == '__main__':
  sys.exit(main())
