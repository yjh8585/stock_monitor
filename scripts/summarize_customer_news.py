"""고객사 뉴스 → 회사별 주간 한국어 3~5줄 요약 + 대표 링크 2~3개(사외비 표 customer_news_weekly).

순서: 자가 시험(exit 2) → 회사(collect_customer_docs.targets() ∩ customer_documents 에 문서가 있는 회사) → 주(KST 월~일 ·
완결 주만 · 행 있으면 건너뜀) → 그 주 news 최대 150건(최신순) → 0건이면 status='empty' 만 저장(호출 없음) → API 호출·검사
(lib.customer_summary_check.check_news)·지적 있으면 1회 재요청 → 링크 = 고른 기사 {news_id, title, url, source}.

exit 0 정상(검사 실패·empty 포함) · 1 API 오류 1건 이상 / API 키 없음(대상 주가 있을 때) · 2 자가 시험 실패·인자 오류·회사 없음
사용: summarize_customer_news.py [--company TICKER] [--weeks N] [--backfill] [--dry-run]
  --weeks N   지난 완결 주 N개(기본 1 = 지난주)
  --backfill  DB 에 남은 완결 주 전부(뉴스 보존 60일 — 가장 오래된 주가 잘려 있으면 뺀다) — 사용자 승인 뒤 로컬 수동

🔴 news.id 는 uuid 다 — 모델에는 그 주 기사에 1..N 번호를 붙여 넘기고(link_ids 는 정수) 저장할 때 uuid 로 되돌린다.
🔴 --dry-run = API 호출·검사까지만. DB 쓰기 0회(WriteSession 도 열지 않는다). 요약 본문은 --dry-run 때만 출력.
"""
import argparse
import contextlib
import os
import sys
from datetime import date, datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
MAX_ITEMS = 150   # 큰 회사는 60건이면 그 주 앞쪽이 빠졌다(2026-11-12 기아 실측) · 입력이 늘어도 주당 수 센트


# ── 주 계산(순수) ────────────────────────────────────────────────────────────

def week_start(d: date) -> date:
  """그 날이 속한 주의 월요일."""
  return d - timedelta(days=d.weekday())


def completed_weeks(today: date, n: int) -> list[date]:
  """today(KST) 기준 끝난 주 n개의 월요일 — 오래된 것부터. 오늘이 일요일이어도 이번 주는 아직 안 끝났다."""
  last = week_start(today) - timedelta(days=7)
  return [last - timedelta(days=7 * k) for k in range(n - 1, -1, -1)]


def backfill_weeks(oldest: date, today: date) -> list[date]:
  """DB 의 가장 오래된 기사일(KST)부터 지난주까지의 월요일. 가장 오래된 주가 월요일부터 차 있지 않으면 잘린 주라 뺀다."""
  first = week_start(oldest) if oldest.weekday() == 0 else week_start(oldest) + timedelta(days=7)
  last = week_start(today) - timedelta(days=7)
  out, w = [], first
  while w <= last:
    out.append(w)
    w += timedelta(days=7)
  return out


def week_bounds(monday: date) -> tuple[str, str]:
  """KST 월요일 0시 ~ 다음 월요일 0시(ISO, +09:00)."""
  start = datetime(monday.year, monday.month, monday.day, tzinfo=KST)
  return start.isoformat(), (start + timedelta(days=7)).isoformat()


# ── 한 회사·한 주 ────────────────────────────────────────────────────────────

def summarize_week(llm, company_id: str, company: str, monday: date, news: list[dict], *, dry_run: bool,
                   ws=None) -> dict:
  """news = 그 주 기사 행(id uuid, title, summary, source, url, published_at). 결과 dict(outcome = ok|check_failed|empty)."""
  from lib import customer_summary_prompt as sp
  from lib.customer_summary_check import check_news
  from summarize_customer_docs import MODEL, ask, now_iso

  items = [{'id': i, 'title': n['title'], 'summary': n.get('summary'), 'source': n.get('source'),
            'published_at': n.get('published_at')} for i, n in enumerate(news, start=1)]
  by_id = {i: n for i, n in enumerate(news, start=1)}
  row = {'company_id': company_id, 'week_start': monday.isoformat(), 'news_count': len(news), 'model': MODEL,
         'prompt_version': sp.PROMPT_VERSION, 'lines': [], 'links': [], 'check_note': None,
         'input_tokens': 0, 'output_tokens': 0, 'updated_at': now_iso()}
  tries, first = 0, []
  if not news:
    row['status'] = 'empty'
  else:
    label = f'{monday.isoformat()} ~ {(monday + timedelta(days=6)).isoformat()} (KST)'
    got = ask(llm, sp.NEWS_SYSTEM, sp.NEWS_SCHEMA, sp.news_user_message(company, label, items),
              lambda r: check_news(r, items))
    r, problems = got['result'], got['problems']
    tries, first = got['tries'], got.get('first_problems', [])
    row.update(input_tokens=got['in'], output_tokens=got['out'])
    if problems:
      row.update(status='check_failed', lines=r['lines'], check_note=' · '.join(problems)[:500])
    elif r.get('empty'):
      row['status'] = 'empty'
    else:
      row.update(status='ok', lines=r['lines'], links=[
        {'news_id': by_id[i]['id'], 'title': by_id[i]['title'], 'url': by_id[i]['url'], 'source': by_id[i].get('source')}
        for i in r['link_ids']])
  if not dry_run and ws is not None:
    ws.table('customer_news_weekly').upsert(row, on_conflict='company_id,week_start').execute()
  return {'outcome': row['status'], 'row': row, 'tries': tries, 'first_problems': first}


# ── 대상 ─────────────────────────────────────────────────────────────────────

def target_companies(client) -> list[dict]:
  """collect_customer_docs.targets()(고객사 IR 대상) ∩ customer_documents 에 문서가 있는 회사."""
  from collect_customer_docs import targets
  out = []
  for c in targets():
    if client.table('customer_documents').select('id').eq('company_id', c['id']).limit(1).execute().data:
      out.append(c)
  return out


def load_news(client, company_id: str, monday: date) -> list[dict]:
  lo, hi = week_bounds(monday)
  rows = (client.table('news').select('id,title,summary,source,url,published_at').eq('company_id', company_id)
          .gte('published_at', lo).lt('published_at', hi).order('published_at', desc=True).order('id')
          .limit(MAX_ITEMS).execute().data)
  return sorted(rows, key=lambda r: (r['published_at'], r['id']))


def oldest_news_date(client, company_ids: list[str]) -> date | None:
  got = (client.table('news').select('published_at').in_('company_id', company_ids).order('published_at')
         .limit(1).execute().data)
  if not got:
    return None
  return datetime.fromisoformat(got[0]['published_at'].replace('Z', '+00:00')).astimezone(KST).date()


def existing_weeks(client, company_id: str) -> set[str]:
  rows = client.table('customer_news_weekly').select('week_start').eq('company_id', company_id).execute().data
  return {r['week_start'] for r in rows}


def _args(argv):
  p = argparse.ArgumentParser(description='고객사 뉴스 주간 요약')
  p.add_argument('--company')
  p.add_argument('--weeks', type=int, default=1)
  p.add_argument('--backfill', action='store_true')
  p.add_argument('--dry-run', action='store_true')
  a = p.parse_args(argv)
  if a.weeks < 1:
    p.error('--weeks 는 1 이상')
  return a


def main(argv: list[str] | None = None) -> int:
  sys.stdout.reconfigure(encoding='utf-8', errors='replace')
  from lib.bootstrap import init_script
  init_script(__file__)
  args = _args(argv)
  from lib.customer_summary_check import self_test
  errs = self_test()
  if errs:
    for e in errs:
      print(f'자가 시험 실패 — {e}')
    return 2

  from lib import db, llm_guidance
  from summarize_customer_docs import MODEL, usd

  client = db.get_client()
  companies = target_companies(client)
  if args.company:
    companies = [c for c in companies if c['ticker'] == args.company]
    if not companies:
      print(f'회사 없음(고객사 IR 대상 아님): {args.company}')
      return 2
  today = datetime.now(KST).date()
  if args.backfill:
    oldest = oldest_news_date(client, [c['id'] for c in companies])
    weeks = backfill_weeks(oldest, today) if oldest else []
  else:
    weeks = completed_weeks(today, args.weeks)
  jobs = []
  for c in companies:
    have = existing_weeks(client, c['id'])
    jobs += [(c, w) for w in weeks if w.isoformat() not in have]
  print(f'회사 {len(companies)}곳 · 주 {len(weeks)}개 · 할 일 {len(jobs)}건' + (' · dry-run' if args.dry_run else ''))
  if not jobs:
    return 0
  llm = llm_guidance.make_client()
  if llm is None:
    print('ANTHROPIC_API_KEY 없음 — 요약 못 함')
    if os.environ.get('GITHUB_ACTIONS'):
      print(f'::warning::ANTHROPIC_API_KEY 없음 — 뉴스 주간 요약 {len(jobs)}건을 건너뛰었다(Secret 확인)')
    return 1

  counts = {'ok': 0, 'check_failed': 0, 'empty': 0, 'error': 0}
  tok_in = tok_out = 0
  ctx = contextlib.nullcontext(None) if args.dry_run else db.WriteSession()
  with ctx as ws:
    for c, w in jobs:
      label = f'  {c["ticker"]} {w.isoformat()} 주'
      try:
        news = load_news(client, c['id'], w)
        res = summarize_week(llm, c['id'], c.get('name_kr') or c['ticker'], w, news, dry_run=args.dry_run, ws=ws)
      except Exception as e:
        counts['error'] += 1
        print(f'{label} · 실패({type(e).__name__})')
        continue
      row = res['row']
      counts[res['outcome']] += 1
      tok_in, tok_out = tok_in + row['input_tokens'], tok_out + row['output_tokens']
      print(f'{label} · 기사 {row["news_count"]} · {res["outcome"]} · 호출 {res["tries"]}회 · 토큰 입력 '
            f'{row["input_tokens"]:,} 출력 {row["output_tokens"]:,} · 링크 {len(row["links"])}')
      if args.dry_run:
        for p in res['first_problems']:
          print(f'    첫 시도 지적: {p}')
        for line in row['lines']:
          print(f'    | {line}')
        for lk in row['links']:
          print(f'    링크: {lk["title"][:60]} ({lk["source"]})')
        if row['check_note']:
          print(f'    검사: {row["check_note"]}')
  print(f'처리 {sum(counts.values())} · ok {counts["ok"]} · 검사 실패 {counts["check_failed"]} · empty {counts["empty"]} · '
        f'오류 {counts["error"]} · 토큰 입력 {tok_in:,} 출력 {tok_out:,} · 추정 {usd(tok_in, tok_out):.2f} USD ({MODEL})')
  return 1 if counts['error'] else 0


if __name__ == '__main__':
  sys.exit(main())
