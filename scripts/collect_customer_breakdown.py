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


def _args(argv):
  p = argparse.ArgumentParser(description='고객사 IR 지역·차종·점유율')
  g = p.add_mutually_exclusive_group(required=True)
  g.add_argument('--dump', type=int, nargs='+', metavar='DOC_ID')
  g.add_argument('--load', metavar='FILE')
  p.add_argument('--out', help='--dump 출력 폴더')
  p.add_argument('--dry-run', action='store_true')
  a = p.parse_args(argv)
  if a.dump and not a.out:
    p.error('--dump 는 --out 이 필요하다')
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


def load(client, session, path: pathlib.Path, dry_run: bool) -> int:
  from lib import db
  from lib.customer_breakdown import SourcePages, payloads, row_from_dict, save_document, verify
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
      src = SourcePages(content)
      results = [(r, *verify(r, src)) for r in rows]
      out, conflicts = payloads(doc, results)
      notes = Counter(n.split(':')[0] for _, ok, n in results if not ok)
      ok_n = sum(1 for p in out if p['verified'])
      totals.update(rows=len(out), verified=ok_n, conflicts=conflicts)
      tail = (' · 실패 ' + ' '.join(f'{k} {v}' for k, v in notes.most_common())) if notes else ''
      print(f'문서 {doc_id} · {ticker} · 행 {len(out)} · verified {ok_n}' + (f' · 충돌 {conflicts}' if conflicts else '')
            + tail + (' · 요약 행 없음(표식 못 찍음)' if summ is None else ''))
      if ws is not None:
        try:
          save_document(ws, doc_id, out, now=now)
        except Exception as e:
          errors += 1
          print(f'문서 {doc_id} · 저장 실패({type(e).__name__})')
  print(f'합계 · 문서 {len(plan)} · 행 {totals["rows"]} · verified {totals["verified"]} · 충돌 {totals["conflicts"]}'
        + (' · dry-run(쓰기 0)' if dry_run else ''))
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
  return load(client, session, pathlib.Path(args.load), args.dry_run)


if __name__ == '__main__':
  sys.exit(main())
