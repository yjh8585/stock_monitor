"""고객사 공식 문서 → 한국어 3~5줄 요약·중요도·근거 쪽 캡처(사외비 표 customer_doc_summaries · 버킷 customer-doc-pages).

순서: 자가 시험(exit 2) → 대상 문서(종류 TARGET_TYPES · 게시일 범위 · 요약 행 없음 · 게시일 오름차순) → 문서마다
원문 받기(collect_customer_numbers.doc_content — 회사 파서 fetch 우선 → 공통 fetch_content) → PDF 면 쪽 표식 글 →
API 호출(구조화 출력) → 검사(lib.customer_summary_check) → 지적 있으면 1회 재요청 → 그래도 지적이면 check_failed →
ok·PDF·쪽 있으면 렌더·업로드 → upsert(doc_id).

exit 0 정상(검사 실패 check_failed · 글이 짧아 건너뜀 포함 — 저장 행·로그에 남는다)
     1 받기 실패·API 오류가 1건 이상(그 문서는 행이 안 생겨 다음 실행이 다시 집는다) · API 키 없음(대상 문서가 있을 때)
     2 자가 시험 실패 · 인자 오류 · 회사 없음
사용: summarize_customer_docs.py [--company TICKER] [--doc-id ID ...] [--since-days 14] [--backfill] [--limit N] [--dry-run]

🔴 GHA 정기 실행은 새 문서만(게시일 최근 14일 · 요약 행 없음). 소급(--backfill = 365일)은 사용자 승인 뒤 로컬 수동 —
   정기 실행이 소급을 대신하면 비용 관문(B8)이 무너진다.
🔴 --dry-run = API 호출·검사·로컬 렌더까지만. Storage 업로드·DB 쓰기 0회(WriteSession 도 열지 않는다).
   요약 본문은 --dry-run 때만 출력한다(정기 로그엔 건수·토큰·상태만).
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


# ── 원문 → 요약할 글 ─────────────────────────────────────────────────────────

def source_text(content) -> tuple[str, bool, int]:
  """(글, PDF 인가, 쪽 수). PDF 면 쪽 표식 글 · 아니면 본문 + 표 행. DART 는 raw 가 빈 바이트다(본문만)."""
  from lib.customer_doc_pages import page_marked_text
  from lib.doc_text import row_text
  raw = content.raw or b''
  if raw[:5] == b'%PDF-':
    text, pages = page_marked_text(raw)
    return text, True, pages
  rows = '\n'.join(row_text(r) for r in content.tables or [])
  return (content.text or '') + ('\n' + rows if rows else ''), False, 0


# ── 문서 하나 ────────────────────────────────────────────────────────────────

def summarize_doc(llm, row: dict, company: str, content, sha: str | None, *, dry_run: bool, ws=None,
                  uploader=None) -> dict:
  """문서 하나 → 결과 dict(outcome = ok | check_failed | skipped). 저장은 dry_run 이 아니고 ws 가 있을 때만.
  uploader = lib.customer_doc_pages.upload_png(시험은 가짜) — dry_run 이면 부르지 않는다."""
  from lib import customer_doc_pages as pages_lib
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
      png = pages_lib.render_page(content.raw, int(p['page']))
      if png is None:
        print(f'    문서 {row["id"]} {p["page"]}쪽 렌더 실패 — 뺌')
        continue
      key = pages_lib.page_key(row['company_id'], row['id'], int(p['page']))
      if not dry_run:
        try:
          (uploader or pages_lib.upload_png)(key, png)
        except Exception as e:  # 그 쪽만 빼고 요약은 저장한다
          print(f'    문서 {row["id"]} {p["page"]}쪽 업로드 실패({type(e).__name__}) — 뺌')
          continue
      pages.append({'page': int(p['page']), 'caption': p['caption'], 'key': key})

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
  p.add_argument('--dry-run', action='store_true')
  return p.parse_args(argv)


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
  from collect_customer_numbers import _to_doc, doc_content
  from lib import db, llm_guidance

  client = db.get_client()
  company_id = None
  if args.company:
    got = client.table('companies').select('id').eq('ticker', args.company).execute().data
    if not got:
      print(f'회사 없음: {args.company}')
      return 2
    company_id = got[0]['id']
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
  counts = {'ok': 0, 'check_failed': 0, 'skipped': 0, 'error': 0}
  tok_in = tok_out = 0
  ctx = contextlib.nullcontext(None) if args.dry_run else db.WriteSession()
  with ctx as ws:
    for r in rows:
      ticker, name = names.get(r['company_id'], ('?', '?'))
      label = f'  문서 {r["id"]} {ticker} {r["doc_type"]} {r["published_at"]}'
      try:
        content, sha = doc_content(customer_parsers.module_for(ticker), session, _to_doc(r, ticker))
      except Exception as e:
        counts['error'] += 1
        print(f'{label} · 받기 실패({type(e).__name__})')
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
            f'{row["output_tokens"]:,} · 쪽 {len(row["pages"])}/{res["picked"]}')
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
        f'{counts["skipped"]} · 오류 {counts["error"]} · 토큰 입력 {tok_in:,} 출력 {tok_out:,} · '
        f'추정 {usd(tok_in, tok_out):.2f} USD ({MODEL})')
  return 1 if counts['error'] else 0


if __name__ == '__main__':
  sys.exit(main())
