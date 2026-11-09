"""고객사 공식 문서 «목록» 수집 — EDGAR·DART·IR 사이트 → customer_documents · 결과는 customer_collect_status.

뒤 단계(회사별 파서)가 이 목록에서 parse_status='pending' 인 문서를 읽는다. 여기서는 본문을 받지 않는다.

대상 = 활성 OEM + PARSER_ONLY_TICKERS 중 sec_cik 또는 dart_corp_code 가 있거나 IR 어댑터(lib/ir_lists.IR_LISTS)가
있는 회사(파서 없는 OEM 도 목록은 쌓인다 · 폭스바겐·포르쉐는 공시 식별자 없이 IR 만).
IR 목록 중 실적 일정(VW ICS·폴라리스 이벤트)은 문서가 아니라 customer_earnings_dates 로 간다.

실행:
  scripts/venv/Scripts/python.exe scripts/collect_customer_docs.py --dry-run --company GM
  scripts/venv/Scripts/python.exe scripts/collect_customer_docs.py --backfill          # 약 2년

🔴 customer_documents upsert payload 에 parse_status·sha256·first_seen_at 을 싣지 않는다.
   PostgREST upsert 는 payload 칸만 덮으므로, 실으면 이미 parsed 로 판정된 문서가 재수집 때 pending 으로 돌아간다.
   새 행은 DB DEFAULT(pending·now())가 채운다. → store() 가 막고 test_customer_docs_classify.py 가 고정한다.
🔴 「새 문서 수」는 upsert «전»에 기존 (source, source_id) 를 조회해 센다 — upsert_rows 반환값은 «보낸» 행 수이고
   skip 트리거로 같은 값은 0행이라 근거가 못 된다.

종료 코드: 0 = 정상(차단 blocked 포함 — 상태 표에 사유가 남고 GHA 에선 ::warning:: 으로 실행 요약에 뜬다)
         · 1 = 출처 하나 이상 error · 2 = 인자 오류.
🔴 정기 실행(GHA collect-customer-docs.yml)은 --since 를 주지 않는다 — 짧게 주면 그 기간 공시가 0건인 EDGAR 회사가
   require_rows 에 걸려 error(exit 1)가 된다(400일 기본값이 「0건 = 목록이 깨졌다」 판정의 전제다).
"""
import argparse
import os
import re
import sys
from collections import Counter
from datetime import date, datetime, timedelta, timezone

import requests

from lib import dart_api, edgar, ir_lists

# ── 분류(순수) ────────────────────────────────────────────────────────────────

_DART_TYPES = (  # (보고서명 정규식, doc_type) — [기재정정]·[첨부정정] 머리는 떼고 본다
  (r'영업\(잠정\)실적|연결재무제표기준영업\(잠정\)실적', 'prelim_results'),
  (r'기업설명회\(IR\)개최', 'ir_event'),
  (r'영업실적등에대한전망|장래사업ㆍ경영계획', 'guidance'),
)
# 6-K 는 EDGAR 「primaryDocDescription」(소문자)로 가른다. 위에서부터 첫 일치. 실물(2024-10~2026-11):
#   STLA `6-K COVER PAGE Q3 2026 PRESS RELEASE`·`… SUPPLEMENTAL INFORMATION` = 실적 보도자료·보충자료
#   STLA `6-K STELLANTIS N.V. Q3 2026` = Interim Report(H1 은 Semi-Annual Report) — 정기 보고서
#   STLA `6-K`(출하·실적 예고 등 보도자료 전부) · VFS `FORM 6-K`(59/60) = 설명에 실마리 없음 → current_report
_PERIOD = r'\b(q[1-4]|h[12]|9m|fy) 20\d\d\b'
_EDGAR_6K = (
  (_PERIOD + r'.*\b(press release|supplemental information)\b', 'earnings_release'),
  # 아래 둘은 대상 회사 실물 표본 없음(요약서 갈래 유지). `Results of Annual General Meeting` 은 실적이 아니다.
  (r'\bfinancial results\b|\b(quarter|half[- ]year|full[- ]year|annual) (20\d\d )?results\b', 'earnings_release'),
  (r'deliver|shipment|production', 'sales_release'),
  (_PERIOD, 'periodic'),  # 기간만 있고 보도자료·실적·출하 낱말이 없으면 정기 보고서(Interim·Semi-Annual Report)
)
EDGAR_FORMS = ('8-K', '6-K', '10-Q', '10-K', '20-F')
DART_DETAIL_TYPES = ('I002', 'I003')  # 공정공시 · 안내공시(IR 개최)


def classify_dart(report_nm: str) -> str | None:
  name = re.sub(r'^\[[^\]]+\]\s*', '', report_nm.strip()).replace(' ', '')
  return next((t for rx, t in _DART_TYPES if re.search(rx, name)), None)


def classify_edgar(form: str, items: str, desc: str) -> str | None:
  if form in ('10-Q', '10-K', '20-F'):
    return 'periodic'
  if form == '8-K':
    return 'earnings_release' if '2.02' in items.split(',') else 'current_report'
  if form == '6-K':
    d = (desc or '').lower()
    return next((t for rx, t in _EDGAR_6K if re.search(rx, d)), 'current_report')
  return None


# ── 행 만들기 ─────────────────────────────────────────────────────────────────

# OEM 이 아니지만 파서 대상인 회사(현대모비스 = 부품사). customer_parsers 패키지(Task 6)에 기대지 않으려고 여기 둔다 —
# Task 6 의 test_customer_parsers 가 parser_tickers() 와 어긋나지 않는지 본다.
PARSER_ONLY_TICKERS = ('012330',)

# upsert 에 실으면 안 되는 칸 — 파싱 상태·최초 발견 시각은 DB DEFAULT 와 파서의 몫이다.
_PARSE_STATE_COLS = frozenset({'parse_status', 'sha256', 'first_seen_at', 'parse_note', 'id'})


def _db():
  from lib import db
  return db


def targets() -> list[dict]:
  """활성 OEM + PARSER_ONLY_TICKERS 중 sec_cik·dart_corp_code·IR 어댑터 중 하나라도 있는 회사. 거르기는 서버에서."""
  cols, c = 'id,ticker,name_kr,company_type,sec_cik,dart_corp_code,status', _db().get_client()
  rows = c.table('companies').select(cols).eq('company_type', 'OEM').eq('status', 'active').execute().data
  rows += (c.table('companies').select(cols).in_('ticker', list(PARSER_ONLY_TICKERS)).eq('status', 'active')
           .execute().data)
  seen, out = set(), []
  for r in rows:
    if (r['sec_cik'] or r['dart_corp_code'] or r['ticker'] in ir_lists.IR_LISTS) and r['id'] not in seen:
      seen.add(r['id'])
      out.append(r)
  return out


def edgar_rows(session, c: dict, since: str) -> list[dict]:
  out = []
  for f in edgar.fetch_filings(session, c['sec_cik'], EDGAR_FORMS, since):
    t = classify_edgar(f.form, f.items, f.primary_desc)
    if not t:
      continue
    out.append({'company_id': c['id'], 'source': 'edgar', 'source_id': f.accession, 'doc_type': t, 'form': f.form,
                'items': f.items, 'title': f.primary_desc or f.form, 'url': f'{f.base_url(c["sec_cik"])}/{f.primary_doc}',
                'published_at': f.filing_date})
  return out


def dart_rows(session, c: dict, bgn: str, end: str) -> list[dict]:
  """bgn·end = YYYYMMDD."""
  out = []
  for ty in DART_DETAIL_TYPES:
    for d in dart_api.list_disclosures(session, c['dart_corp_code'], bgn, end, ty):
      t = classify_dart(d['report_nm'])
      if t:
        out.append({'company_id': c['id'], 'source': 'dart', 'source_id': d['rcept_no'], 'doc_type': t, 'form': ty,
                    'items': None, 'title': d['report_nm'].strip(),
                    'url': f'https://dart.fss.or.kr/dsaf001/main.do?rcpNo={d["rcept_no"]}',
                    'published_at': f'{d["rcept_dt"][:4]}-{d["rcept_dt"][4:6]}-{d["rcept_dt"][6:]}'})
  return out


def prelim_quarter_dates(client, company_id: str) -> dict[str, str]:
  """이미 적재된 DART 잠정실적 공시 → {'2026-Q3': 공시일}. 현대차·현대모비스 IR 목록엔 날짜 칸이 없어 이 날을 쓴다.

  같은 실행에서 DART 출처가 IR 보다 먼저 적재된다(sources 순서) — dry-run 이면 이전 실행분을 본다."""
  data = (client.table('customer_documents').select('title,published_at').eq('company_id', company_id)
          .eq('source', 'dart').eq('doc_type', 'prelim_results').execute().data)
  return ir_lists.quarter_dates(data)


def ir_rows(session, c: dict, since: str, client) -> list[dict]:
  """IR 어댑터 행 → 날짜 채우기(_quarter) → since 이후 → company_id. 어댑터가 0건이면 목록이 깨진 것이다(error)."""
  raw = require_rows('IR', ir_lists.IR_LISTS[c['ticker']](session, since))
  qdates = prelim_quarter_dates(client, c['id']) if c['dart_corp_code'] else {}
  rows, holds = ir_lists.resolve_dates(raw, qdates, since)
  for wait, n in sorted(holds.items()):
    if wait == ir_lists.NO_DATE:
      print(f'  {c["ticker"]:<10} IR    날짜 없음 {n}건 — 원문에 분기도 날짜도 없어 싣지 않는다(다음 실행에도 안 풀린다)')
    else:
      print(f'  {c["ticker"]:<10} IR    날짜 보류 {n}건 — {ir_lists.HOLD_REASONS[wait]}(다음 실행에 다시 본다)')
  return [{'company_id': c['id'], **r} for r in rows]


def sync_earnings_dates(client, company_id: str, rows: list[dict], dry_run: bool) -> int:
  """IR 실적 일정 → customer_earnings_dates. (분기, 날짜)가 이미 있으면 건너뛴다 — published_at 은 «처음 본 날»
  (원문에 게시일이 없다)이라 매번 실으면 같은 일정이 날마다 다시 쓰인다. 반환 = 새로 쓰거나 바뀐 분기 수."""
  have = {(d['period'], d['event_date']) for d in client.table('customer_earnings_dates')
          .select('period,event_date').eq('company_id', company_id).execute().data}
  by_period = {r['period']: r for r in rows}  # 한 요청에 같은 PK 둘이면 upsert 가 통째로 실패한다
  today = date.today().isoformat()
  changed = [{'company_id': company_id, **r, 'published_at': today} for r in by_period.values()
             if (r['period'], r['event_date']) not in have]
  if changed and not dry_run:
    _db().upsert_rows('customer_earnings_dates', changed, 'company_id,period')
  return len(changed)


def dedupe(rows: list[dict]) -> list[dict]:
  """같은 (source, source_id) 가 한 배치에 둘이면 PostgREST upsert 가 통째로 실패한다 — 뒤의 것 하나만 남긴다."""
  return list({(r['source'], r['source_id']): r for r in rows}.values())


# ── 적재 · 상태 ───────────────────────────────────────────────────────────────

_IN_CHUNK = 100  # in_() 한 번에 넣는 키 수 — URL 길이 · 응답 행 수(<1,000)를 같이 묶어 둔다(페이지 넘김 불필요)


def count_new(client, rows: list[dict]) -> int:
  """rows 중 customer_documents 에 아직 없는 (source, source_id) 수. 키 = 표의 유일 제약 전체."""
  new = 0
  by_source: dict[str, list[str]] = {}
  for r in rows:
    by_source.setdefault(r['source'], []).append(r['source_id'])
  for source, ids in by_source.items():
    ids = sorted(set(ids))
    seen = set()
    for i in range(0, len(ids), _IN_CHUNK):
      chunk = ids[i:i + _IN_CHUNK]
      data = (client.table('customer_documents').select('source_id').eq('source', source).in_('source_id', chunk)
              .execute().data)
      seen |= {d['source_id'] for d in data}
    new += len(set(ids) - seen)
  return new


def store(rows: list[dict]) -> None:
  bad = _PARSE_STATE_COLS & {k for r in rows for k in r}
  if bad:
    raise ValueError(f'customer_documents payload 에 파싱 상태 칸: {sorted(bad)}')
  _db().upsert_rows('customer_documents', rows, 'source,source_id')


EmptyListError = ir_lists.EmptyListError  # IR 하위 목록 0건도 같은 클래스로 올라온다(정의는 lib/ir_lists.py)


def require_rows(label: str, rows: list[dict]) -> list[dict]:
  """EDGAR 대상 회사인데 400일 동안 공시 0건은 정상일 수 없다(DART 는 비상장 OEM 이 정상 0건이라 쓰지 않는다)."""
  if not rows:
    raise EmptyListError(f'{label} 목록 0건')
  return rows


def failure_status(label: str, e: Exception) -> tuple[str, str]:
  """예외 → (status, reason). reason 은 화면에 그대로 나가므로 예외 문장(URL·키)을 싣지 않는다."""
  if isinstance(e, EmptyListError):
    return 'error', str(e)
  code = getattr(getattr(e, 'response', None), 'status_code', None)
  if isinstance(e, requests.HTTPError) and code in ir_lists.BLOCKED_HTTP:
    return 'blocked', f'{label} 접근 차단(HTTP {code})'
  return 'error', type(e).__name__


def write_status(ws, company_id: str, collector: str, status: str, reason: str | None) -> None:
  """customer_collect_status 한 행. checked_at 은 매번 싣는다 — default now() 는 INSERT 에만 들어간다."""
  ws.table('customer_collect_status').upsert(
    {'company_id': company_id, 'collector': collector, 'status': status, 'reason': reason,
     'checked_at': datetime.now(timezone.utc).isoformat()},
    on_conflict='company_id,collector').execute()


def sources(c: dict, since: str, end: str, client=None) -> list[tuple]:
  """(collector, 화면 라벨, fetch(session) → rows). 순서가 뜻이 있다 — IR 의 날짜 채우기가 DART 적재분을 읽는다."""
  out = []
  if c['sec_cik']:
    out.append(('edgar_list', 'EDGAR', lambda s: require_rows('EDGAR', edgar_rows(s, c, since))))
  if c['dart_corp_code']:
    out.append(('dart_list', 'DART', lambda s: dart_rows(s, c, since.replace('-', ''), end.replace('-', ''))))
  if c['ticker'] in ir_lists.IR_LISTS:
    out.append(('ir_list', 'IR', lambda s: ir_rows(s, c, since, client)))
  return out


# ── 실행 ──────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
  sys.stdout.reconfigure(encoding='utf-8', errors='replace')
  from lib.bootstrap import init_script
  init_script(__file__)

  ap = argparse.ArgumentParser(description='고객사 공식 문서 목록 수집(EDGAR·DART·IR)')
  ap.add_argument('--company', help='ticker 하나만(GHA 회사별 실행)')
  ap.add_argument('--since', help='YYYY-MM-DD (기본 = 오늘 − 400일 · --backfill 이면 − 760일)')
  ap.add_argument('--backfill', action='store_true', help='약 2년 치')
  ap.add_argument('--dry-run', action='store_true', help='건수만 — 쓰지 않는다')
  args = ap.parse_args(argv)

  today = date.today()
  since = args.since or (today - timedelta(days=760 if args.backfill else 400)).isoformat()
  try:
    since = date.fromisoformat(since).isoformat()
  except ValueError:
    print(f'--since 형식 아님(YYYY-MM-DD): {since}')
    return 2
  end = today.isoformat()

  db = _db()
  cos = targets()
  if args.company:
    cos = [c for c in cos if c['ticker'] == args.company]
    if not cos:
      print(f'대상 아님(활성 OEM·파서 대상 중 공시 식별자·IR 어댑터 있는 회사가 아님): {args.company}')
      return 2
  print(f'대상 {len(cos)}곳 · {since} ~ {end}' + (' · dry-run' if args.dry_run else ''))

  client = db.get_client()
  session = requests.Session()
  with db.WriteSession() as ws:  # 상태 행 캐시 무효화를 끝에 한 번으로 묶는다
    errors = _run(cos, since, end, client, session, ws, args.dry_run)
  return 1 if errors else 0


def _run(cos, since, end, client, session, ws, dry_run: bool) -> int:
  errors = 0
  for c in cos:
    for collector, label, fetch in sources(c, since, end, client):
      rows, reason, dates_note = [], None, ''
      try:
        rows = dedupe(fetch(session))
        n = count_new(client, rows)
        status = 'ok' if n else 'no_new'
        if rows and not dry_run:
          store(rows)
      except Exception as e:  # 한 출처 실패가 다른 출처·회사를 막지 않게 — 상태 표에 남긴다
        status, reason = failure_status(label, e)
        n = 0
        errors += status == 'error'
      date_fetch = ir_lists.IR_EARNINGS_DATES.get(c['ticker']) if collector == 'ir_list' else None
      if date_fetch:  # 문서와 따로 — 일정이 깨져도 이미 실은 문서의 상태는 그대로 두고 사유만 덧붙인다
        try:
          dates = date_fetch(session, since)
          dates_note = f' · 일정 {len(dates)} · 일정 새/바뀜 {sync_earnings_dates(client, c["id"], dates, dry_run)}'
        except Exception as e:
          note = f'실적 일정 실패: {failure_status(label, e)[1]}'
          reason = f'{reason} · {note}' if reason else note
          errors += 1
      kinds = ' '.join(f'{k}={v}' for k, v in sorted(Counter(r['doc_type'] for r in rows).items()))
      print(f'  {c["ticker"]:<10} {label:<5} {status:<7} 문서 {len(rows)} · 새 {n}' + (f' · {kinds}' if kinds else '')
            + dates_note + (f' · {reason}' if reason else ''))
      if status == 'blocked' and os.environ.get('GITHUB_ACTIONS'):  # exit 0 그대로(매일 막히는 출처가 job 을 늘 빨갛게
        print(f'::warning::{c["ticker"]} · {reason}')               # 만들지 않게) — 실행 요약에만 노랗게 띄운다
      if not dry_run:
        write_status(ws, c['id'], collector, status, reason)
  return errors


if __name__ == '__main__':
  sys.exit(main())
