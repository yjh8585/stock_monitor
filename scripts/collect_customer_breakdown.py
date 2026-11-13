"""고객사 IR 문서 → 지역별·차종별·점유율 «수준» 값(사외비 표 customer_breakdown_ir).

계획 = docs/plans/2026-11-11-customers-page-revisions.md 「C」 절. 규칙(모양·증감률·글자층 대조·두 번째 읽기·적재) 정본 =
scripts/lib/customer_breakdown.py. 읽을 문서·쪽 = 요약기가 남긴 customer_doc_summaries.c_materials.

갈래:
  --dump DOC_ID ... --out DIR   소급용 읽기 재료 — 문서마다 <DIR>/<doc>.md(머리·C 재료·해당 쪽 글자층 · 비PDF 는 본문 전체)
                                 + PDF 면 C 재료 쪽 PNG(<doc>_p<N>.png). DB 쓰기 0.
  --load FILE.json [--dry-run]  읽은 결과 적재 — [{"doc_id": 1, "rows": [{kind, metric, label_raw, label_ko, period_grain,
                                 period, value, unit, quote, page?, definition?, second_value?}, ...]}, ...].
                                 rows 가 빈 문서도 처리 표식(breakdown_at)만 찍는다. extractor = 'manual'.
                                 문서마다 원문을 다시 받아 그 쪽 글자층으로 검사한다(lib.customer_breakdown.verify).
  --company TICKER [--doc-id N ...] [--since-days 365] [--dry-run]
                                 정기 — 요약 status ok · c_materials 있음 · breakdown_at 비어 있음 · 게시일 최근 1년(결정 C2).
                                 코드 파서(customer_parsers/breakdown.py)가 맡는 문서는 코드로 읽어 적재(extractor='code').
                                 코드 몫이 아닌 문서는 --api 일 때만 API 로 읽는다(lib/llm_breakdown.py · 실제 과금 —
                                 정기 GHA step 만 붙인다). --api 가 없으면 «API 대기»로 세고 표식을 찍지 않는다
                                 (로컬엔 .env.local 에 키가 있어 인자 없이 부르면 과금되던 자리를 막는다).
                                 코드가 서식을 알아봤는데 0행이면 꼴이 바뀐 것 — 표식을 찍지 않고 경고(조용한 0행 금지).
                                 API 가 읽고 0행이면 표식을 찍는다(읽었으나 수준 값 없는 문서를 매번 다시 사지 않게).

출력엔 건수·검사 사유만 찍는다(값 목록은 --dry-run 에서도 찍지 않는다 — 결과 JSON 이 따로 있다).
exit 0 정상 · 1 받기·DB 오류 1건 이상 · 2 인자 오류·파일 형식 오류.
"""
import argparse
import contextlib
import json
import pathlib
import sys
from collections import Counter
from datetime import datetime, timezone

DOC_COLS = 'id,company_id,source,source_id,doc_type,form,items,title,url,published_at'
SINCE_DAYS = 365   # 결정 C2 — IR 문서 최근 1년
_IN_CHUNK = 100


def _args(argv):
  p = argparse.ArgumentParser(description='고객사 IR 지역·차종·점유율')
  g = p.add_mutually_exclusive_group(required=True)
  g.add_argument('--dump', type=int, nargs='+', metavar='DOC_ID')
  g.add_argument('--load', metavar='FILE')
  g.add_argument('--company', metavar='TICKER')
  p.add_argument('--out', help='--dump 출력 폴더')
  p.add_argument('--doc-id', type=int, nargs='+', default=[], help='--company 와 함께 — 이 문서만(처리 표식 무시)')
  p.add_argument('--since-days', type=int, default=SINCE_DAYS)
  p.add_argument('--api', action='store_true', help='--company 와 함께 — 코드 몫 아닌 문서를 API 로 읽는다(실제 과금)')
  p.add_argument('--dry-run', action='store_true')
  a = p.parse_args(argv)
  if a.dump and not a.out:
    p.error('--dump 는 --out 이 필요하다')
  if (a.doc_id or a.api) and not a.company:
    p.error('--doc-id·--api 는 --company 와 함께')
  return a


def _fetch(client, session, doc_id: int):
  """(문서 행, ticker, Content, 요약 행) — 원문은 collect_customer_numbers.doc_content 그대로(사본 금지)."""
  import customer_parsers
  from collect_customer_numbers import _to_doc, doc_content
  doc = client.table('customer_documents').select(DOC_COLS).eq('id', doc_id).execute().data
  if not doc:
    raise LookupError(f'문서 {doc_id} 없음')
  doc = doc[0]
  ticker = client.table('companies').select('ticker').eq('id', doc['company_id']).execute().data[0]['ticker']
  content, _sha = doc_content(customer_parsers.module_for(ticker), session, _to_doc(doc, ticker))
  summ = client.table('customer_doc_summaries').select('c_materials,breakdown_at').eq('doc_id', doc_id).execute().data
  return doc, ticker, content, (summ[0] if summ else None)


def dump(client, session, doc_ids: list[int], out: pathlib.Path) -> int:
  from lib import customer_doc_pages as pages_lib
  from lib.customer_breakdown import SourcePages
  out.mkdir(parents=True, exist_ok=True)
  errors = 0
  for doc_id in doc_ids:
    try:
      doc, ticker, content, summ = _fetch(client, session, doc_id)
    except Exception as e:
      errors += 1
      print(f'문서 {doc_id} · 받기 실패({type(e).__name__})')
      continue
    src = SourcePages(content)
    mats = (summ or {}).get('c_materials') or []
    lines = [f'# 문서 {doc_id} · {ticker} · {doc["doc_type"]} · {doc["published_at"]}', '', f'제목: {doc["title"]}',
             f'URL: {doc["url"]}', f'PDF: {src.is_pdf}' + (f' · {len(src.pages)}쪽' if src.is_pdf else ''), '',
             '## C 재료(요약기가 남긴 쪽·메모)', '']
    lines += [f'- {m.get("kind")} · p.{m.get("page")} · {m.get("note")}' for m in mats] or ['- (없음)']
    pages = sorted({int(m['page']) for m in mats if m.get('page')}) if src.is_pdf else []
    for pg in pages:
      lines += ['', f'## p.{pg} 글자층', '', '```', src.text_for(pg).strip(), '```']
      png = pages_lib.render_page(content.raw, pg)
      if png:
        (out / f'{doc_id}_p{pg}.png').write_bytes(png)
    if not src.is_pdf or not pages:
      lines += ['', '## 본문 전체(비PDF 이거나 쪽 미지정)', '', '```', src.whole.strip(), '```']
    (out / f'{doc_id}.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'문서 {doc_id} · {ticker} · 쪽 {len(pages)}개 렌더 · 재료 {len(mats)}건')
  return 1 if errors else 0


def _store(ws, doc, ticker, content, summ, rows, totals: Counter, now: str, tag: str = '') -> bool:
  """검사 → 건수·사유 한 줄 → 적재(ws 가 None 이면 dry-run). 저장 실패면 False."""
  import os

  from lib.customer_breakdown import SourcePages, keep_for_company, payloads, save_document, suspect_parent_sums, verify
  dropped = len(rows)
  rows = keep_for_company(ticker, rows)
  dropped -= len(rows)
  tag += f' · 점유율 외 {dropped}행 버림(국내 3사)' if dropped else ''
  # 경고만 — 상위 합계와 하위 구분이 같은 metric 이면 화면이 두 번 쌓는다(이름만 찍는다 · 값은 안 찍는다).
  for parent, kids in suspect_parent_sums(rows):
    msg = f'문서 {doc["id"]} · 상위 합계 의심 {parent} ← {" + ".join(kids)} — 하위면 metric 을 _detail 로 다시 적재'
    print(f'::warning::{msg}' if os.environ.get('GITHUB_ACTIONS') else msg)
  src = SourcePages(content)
  results = [(r, *verify(r, src)) for r in rows]
  out, conflicts = payloads(doc, results)
  notes = Counter(n.split(':')[0] for _, ok, n in results if not ok)
  ok_n = sum(1 for p in out if p['verified'])
  totals.update(docs=1, rows=len(out), verified=ok_n, conflicts=conflicts)
  tail = (' · 실패 ' + ' '.join(f'{k} {v}' for k, v in notes.most_common())) if notes else ''
  print(f'문서 {doc["id"]} · {ticker}{tag} · 행 {len(out)} · verified {ok_n}' + (f' · 충돌 {conflicts}' if conflicts else '')
        + tail + (' · 요약 행 없음(표식 못 찍음)' if summ is None else ''))
  if ws is None:
    return True
  try:
    save_document(ws, doc['id'], out, now=now)
    return True
  except Exception as e:
    print(f'문서 {doc["id"]} · 저장 실패({type(e).__name__})')
    return False


def _total_line(totals: Counter, dry_run: bool) -> str:
  return (f'합계 · 문서 {totals["docs"]} · 행 {totals["rows"]} · verified {totals["verified"]} · 충돌 {totals["conflicts"]}'
          + (' · dry-run(쓰기 0)' if dry_run else ''))


def load(client, session, path: pathlib.Path, dry_run: bool) -> int:
  from lib import db
  from lib.customer_breakdown import row_from_dict
  try:
    items = json.loads(path.read_text(encoding='utf-8'))
    assert isinstance(items, list) and all(isinstance(x, dict) and 'doc_id' in x for x in items)
    plan = [(int(x['doc_id']), [row_from_dict(r) for r in x.get('rows') or []]) for x in items]
  except Exception as e:
    print(f'파일 형식 오류: {type(e).__name__} {e}')
    return 2
  errors = 0
  totals = Counter()
  now = datetime.now(timezone.utc).isoformat()
  ctx = contextlib.nullcontext(None) if dry_run else db.WriteSession()
  with ctx as ws:
    for doc_id, rows in plan:
      try:
        doc, ticker, content, summ = _fetch(client, session, doc_id)
      except Exception as e:
        errors += 1
        print(f'문서 {doc_id} · 받기 실패({type(e).__name__})')
        continue
      errors += not _store(ws, doc, ticker, content, summ, rows, totals, now)
  print(_total_line(totals, dry_run))
  return 1 if errors else 0


def load_code_only(client, company_id: str, types: tuple[str, ...], doc_ids: list[int], since: str) -> list[int]:
  """요약 대상 밖이지만 코드 파서가 읽는 문서(breakdown.CODE_ONLY_TYPES — 폭스바겐 인도 보도자료 · 결정 C2 확장 2026-11-13).
  요약 행이 없어 breakdown_at 표식을 못 찍는다 → 이 문서의 행이 이미 있으면 처리된 것으로 본다
  (SHORTCUT: 표가 없는 같은 종류 문서는 1년 동안 매일 다시 받는다 — 하루 1~2건이라 둔다 → 늘면 표식 칸을 따로 둔다).
  doc_ids 를 주면 그 문서 중 해당 종류만(행 유무·게시일 무시)."""
  if not types:
    return []
  b = client.table('customer_documents').select('id,published_at').eq('company_id', company_id).in_('doc_type', list(types))
  docs = (b.in_('id', doc_ids) if doc_ids else b.gte('published_at', since)).execute().data
  if doc_ids or not docs:
    return [d['id'] for d in docs]
  done = {r['document_id'] for r in client.table('customer_breakdown_ir').select('document_id')
          .in_('document_id', [d['id'] for d in docs]).execute().data}
  return [d['id'] for d in docs if d['id'] not in done]


def load_targets(client, company_id: str, doc_ids: list[int], since: str,
                 code_only: tuple[str, ...] = ()) -> tuple[list[int], set[int]]:
  """(정기 대상 문서 id(게시일 순), 그중 코드 전용 문서 id). doc_ids 를 주면 그 문서만(처리 표식·게시일 무시 ·
  재료 없는 문서는 뺀다 — 코드 전용 종류는 예외). code_only = 요약 재료 없이 코드 파서가 읽는 문서 종류."""
  from collect_customer_numbers import fetch_all

  def q():
    b = client.table('customer_doc_summaries').select('doc_id,c_materials').eq('company_id', company_id).eq('status', 'ok')
    return b.in_('doc_id', doc_ids) if doc_ids else b.is_('breakdown_at', 'null')
  ids = [s['doc_id'] for s in fetch_all(q, ('doc_id',)) if s.get('c_materials')]
  extra = {i for i in load_code_only(client, company_id, code_only, doc_ids, since) if i not in ids}
  ids += sorted(extra)
  if doc_ids:
    return ids, extra
  keep = []
  for i in range(0, len(ids), _IN_CHUNK):
    got = (client.table('customer_documents').select('id,published_at').in_('id', ids[i:i + _IN_CHUNK])
           .gte('published_at', since).execute().data)
    keep += got
  return [d['id'] for d in sorted(keep, key=lambda d: (d['published_at'], d['id']))], extra


def run_company(client, session, ticker: str, doc_ids: list[int], since_days: int, dry_run: bool,
                use_api: bool = False) -> int:
  import os
  from datetime import timedelta

  from customer_parsers import breakdown
  from lib import db, llm_breakdown, llm_guidance
  got = client.table('companies').select('id').eq('ticker', ticker).execute().data
  if not got:
    print(f'회사 없음: {ticker}')
    return 2
  since = (datetime.now(timezone(timedelta(hours=9))).date() - timedelta(days=since_days)).isoformat()
  ids, code_only = load_targets(client, got[0]['id'], doc_ids, since, breakdown.CODE_ONLY_TYPES.get(ticker, ()))
  print(f'대상 문서 {len(ids)}건 · {ticker}' + (f' · 게시일 {since} 이후' if not doc_ids else '')
        + (' · dry-run' if dry_run else ''))
  errors = 0
  totals, skipped = Counter(), Counter()
  tok_in = tok_out = 0
  now = datetime.now(timezone.utc).isoformat()
  gha = bool(os.environ.get('GITHUB_ACTIONS'))
  llm = llm_guidance.make_client() if use_api and ids else None
  if use_api and ids and llm is None:
    msg = 'ANTHROPIC_API_KEY 없음 — 코드 몫 아닌 문서는 API 대기로 남는다(Secret 확인)'
    print(f'::warning::{msg}' if gha else msg)
    errors += 1
  ctx = contextlib.nullcontext(None) if dry_run else db.WriteSession()
  with ctx as ws:
    for doc_id in ids:
      try:
        doc, _t, content, summ = _fetch(client, session, doc_id)
      except Exception as e:
        errors += 1
        print(f'문서 {doc_id} · 받기 실패({type(e).__name__})')
        continue
      parsed = breakdown.parse(ticker, doc, content)
      if parsed is None and doc_id in code_only:
        skipped['code_only_no_table'] += 1   # 요약 재료가 없어 API 로 넘길 쪽을 모른다 — 표 없는 보도자료
        continue
      if parsed is None:
        if llm is None:
          skipped['api_wait'] += 1   # 표식 없이 남는다 — --api 정기 실행이 집는다
          continue
        try:
          rows, (i, o) = llm_breakdown.read_document(llm, doc, ticker, (summ or {}).get('c_materials') or [], content)
        except Exception as e:
          errors += 1
          print(f'문서 {doc_id} · API 읽기 실패({type(e).__name__})')
          continue
        tok_in, tok_out = tok_in + i, tok_out + o
        errors += not _store(ws, doc, ticker, content, summ, rows, totals, now, f' · API {i}+{o} 토큰')
        continue
      rows, unknown = parsed
      if unknown:
        # 경고로 띄운다 — 나머지 행이 실리면 그 문서는 「처리됨」이 돼 다음 실행이 다시 안 집는다(고친 뒤 --doc-id 로 다시)
        msg = f'문서 {doc_id} · 처음 보는 라벨 {len(unknown)}개(행 안 만듦 — 라벨 사전에 더할 것): {", ".join(unknown)}'
        print(f'::warning::{msg}' if gha else msg)
      if not rows:
        skipped['code_empty'] += 1
        msg = f'문서 {doc_id} · 코드 파서가 서식은 알아봤는데 0행 — 꼴이 바뀌었을 수 있다(표식 안 찍음)'
        print(f'::warning::{msg}' if gha else msg)
        continue
      errors += not _store(ws, doc, ticker, content, summ, rows, totals, now, ' · 코드')
  cost = (f' · API 토큰 {tok_in}+{tok_out} · 약 {llm_breakdown.usd(tok_in, tok_out):.2f} USD' if tok_in or tok_out else '')
  print(_total_line(totals, dry_run) + ''.join(f' · {k} {v}' for k, v in sorted(skipped.items())) + cost)
  return 1 if errors else 0


def main(argv: list[str] | None = None) -> int:
  sys.stdout.reconfigure(encoding='utf-8', errors='replace')
  from lib.bootstrap import init_script
  init_script(__file__)
  args = _args(argv)
  import requests

  from lib import db
  client, session = db.get_client(), requests.Session()
  if args.dump:
    return dump(client, session, args.dump, pathlib.Path(args.out))
  if args.company:
    return run_company(client, session, args.company, args.doc_id, args.since_days, args.dry_run, args.api)
  return load(client, session, pathlib.Path(args.load), args.dry_run)


if __name__ == '__main__':
  sys.exit(main())
