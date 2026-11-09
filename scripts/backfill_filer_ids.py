"""companies.sec_cik · dart_corp_code 채우기(일회성 · 끝나면 scripts/_archive/).

- sec_cik: company_tickers.json 의 ticker 일치(company_type='OEM' 전부) + 아래 고정 표(6-K 제출사)
- dart_corp_code: 아래 고정 표(빈칸만) — 값은 참고/고객사/research/korea.md 실측
- 🔴 CIK 는 `edgar.normalize_cik` 로 앞 0 없는 꼴 하나로 맞춰 넣는다(칸 CHECK 는 `0000320193` 도 통과시킨다).
- 이미 값이 있으면 덮지 않는다(다르면 경고만). 같은 CIK 가 두 회사로 가면 둘 다 건너뛴다(부분 UNIQUE).
출력은 공개 표(companies)의 티커·식별자만 — 사외비 아님.

사용:
  scripts/venv/Scripts/python.exe scripts/backfill_filer_ids.py --dry-run
"""
import sys
from collections import Counter

import requests

from lib.bootstrap import init_script
init_script(__file__)
from lib import db, edgar  # noqa: E402
from lib.db import WriteSession  # noqa: E402

SEC_CIK_FIXED = {'STLA': '1605484', 'VFS': '1913510'}  # 20-F/6-K 제출사 — 티커 표에 있어도 고정값이 우선
DART_FIXED = {'005380': '00164742', '000270': '00106641', '012330': '00164788', '003620': '00138242'}


def plan_updates(rows: list[dict], tickers: dict[str, tuple[str, str]]) -> tuple[list[tuple[int, str, dict]], list[str]]:
  """DB 행 + SEC 티커 표({TICKER: (cik, 이름)}) → ([(id, ticker, patch)], 경고 목록). 순수 함수."""
  warnings: list[str] = []
  planned: list[tuple[int, str, dict]] = []
  for r in rows:
    t = (r['ticker'] or '').upper()
    patch = {}
    raw = SEC_CIK_FIXED.get(t) or (tickers[t][0] if r['company_type'] == 'OEM' and t in tickers else None)
    cik = edgar.normalize_cik(raw) if raw else None
    if cik and not r['sec_cik']:
      patch['sec_cik'] = cik
    elif cik and edgar.normalize_cik(r['sec_cik']) != cik:
      warnings.append(f'{t} sec_cik 기존값({r["sec_cik"]})과 다름({cik}) — 덮지 않음')
    corp = DART_FIXED.get(t)
    if corp and not r['dart_corp_code']:
      patch['dart_corp_code'] = corp
    elif corp and r['dart_corp_code'] != corp:
      warnings.append(f'{t} dart_corp_code 기존값과 다름 — 덮지 않음')
    if patch:
      planned.append((r['id'], t, patch))

  # 같은 CIK 를 두 회사에 넣으면 부분 UNIQUE 에 걸린다 — 이미 DB 에 있는 값까지 세어 둘 다 뺀다.
  taken = Counter([edgar.normalize_cik(r['sec_cik']) for r in rows if r['sec_cik']]
                  + [p['sec_cik'] for _, _, p in planned if 'sec_cik' in p])
  dup = {c for c, n in taken.items() if n > 1}
  out = []
  for cid, t, patch in planned:
    if patch.get('sec_cik') in dup:
      warnings.append(f'{t} sec_cik {patch["sec_cik"]} 가 다른 회사와 겹침 — 건너뜀')
      patch = {k: v for k, v in patch.items() if k != 'sec_cik'}
    if patch:
      out.append((cid, t, patch))
  return out, warnings


def main(dry_run: bool) -> int:
  sys.stdout.reconfigure(encoding='utf-8', errors='replace')
  with requests.Session() as s:
    tickers = {v['ticker'].upper(): (str(v['cik_str']), v.get('title', '')) for v in
               edgar.edgar_get(s, 'https://www.sec.gov/files/company_tickers.json').json().values()}
  # 서버에서 거른다 — 표 전체(지금 634행)를 받으면 PostgREST 1000행 상한을 넘는 날 OEM 이 조용히 빠진다
  cols, c = 'id,ticker,company_type,sec_cik,dart_corp_code', db.get_client()
  rows = c.table('companies').select(cols).eq('company_type', 'OEM').execute().data
  rows += (c.table('companies').select(cols).in_('ticker', sorted(set(SEC_CIK_FIXED) | set(DART_FIXED)))
           .neq('company_type', 'OEM').execute().data)
  updates, warnings = plan_updates(rows, tickers)
  for _, t, patch in updates:
    title = tickers.get(t, ('', ''))[1] if 'sec_cik' in patch else ''
    print(f'  {t:<8} {patch}  {title}'.rstrip())
  for w in warnings:
    print(f'경고: {w}')
  print(f'대상 {len(rows)}곳 · 채울 곳 {len(updates)} · 경고 {len(warnings)}')
  if dry_run:
    return 0
  with WriteSession() as ws:
    for cid, _, patch in updates:
      ws.table('companies').update(patch).eq('id', cid).execute()
  print(f'적용 {len(updates)}곳')
  return 0


if __name__ == '__main__':
  sys.exit(main('--dry-run' in sys.argv))
