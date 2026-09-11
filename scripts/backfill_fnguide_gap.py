#!/usr/bin/env python3
"""fnguide 가 더 이상 주지 않는 과거 연도를 DART 에서 채운다 (일회성).

**왜 필요한가** (2026-09-11 실측):
  fnguide 화면은 **최근 3~4개 연도만** 제공한다(일진하이솔루스 FY2024~25 · 삼성SDI
  FY2023~25). 그런데 DB 에는 그보다 오래된 FY2021~2022 행이 남아 있고, 그 값들이
  **옛 파서가 남긴 쓰레기**다 — 영업이익 > 매출(일진하이솔루스 9,803 > 6,371),
  다음 해 매출의 1/8~1/12. 전수로 세니 **51개사**가 그랬고 FY2023 이후는 0건이다.

🔴 **`collect_financials.py` 재실행으로는 못 고친다.** ①fnguide 가 그 연도를 안 준다
   ②`RECENT_YEARS_KEEP=2` 라 옛 연도는 「안정화된 과거」로 스킵된다.

🔴 **화면에 실제로 드러나는 것은 FY2022 다** — `/domestic` 표가 '23~'25 를 보여주면서
   YoY 화살표를 **전년(=2022)** 으로 계산한다. FY2021 은 지금 어디에도 안 쓰이지만
   값이 틀린 채 남아 있으면 표시 연도를 넓히는 순간 되살아난다.

무엇을 하나:
  1. 오염 회사·연도를 **DB 에서 직접 찾는다**(목록을 코드에 박지 않는다 — 다시 돌려도
     그때의 실제 상태를 본다).
  2. 상장사는 `dart_corp_code` 가 대개 비어 있으므로 **종목코드(stock_code)로** DART
     corpCode 를 해소한다. 상장사는 이 매칭이 유일해서 동명이인 함정이 없다
     (비상장사 이름 매칭과 다른 점) → `docs/gotchas-data-collection.md`.
  3. `collect_dart_audit._collect_company()` 를 그대로 재사용해 해당 연도만 받아
     `financials` 에 upsert 한다(`source='dart'`).

사용:
  python scripts/backfill_fnguide_gap.py              # dry-run (기본)
  python scripts/backfill_fnguide_gap.py --apply
"""
import argparse
import sys
from pathlib import Path

from loguru import logger

sys.path.insert(0, str(Path(__file__).parent))
from lib.bootstrap import init_script  # noqa: E402

init_script(__file__)

import collect_dart_audit as AUDIT  # noqa: E402
from lib.db import WriteSession, upsert_rows  # noqa: E402

# 다음 해 매출이 이 배수를 넘게 뛰면 그 해 값을 «깨진 것» 으로 본다.
# 실측 분포가 8~9배에 몰려 있고 FY2023 이후는 3배 초과가 0건이라 3을 문턱으로 둔다.
JUMP_RATIO = 3.0
TARGET_YEARS = (2021, 2022)


def _find_broken(w, redo_dart: bool = False) -> dict[str, dict]:
  """`{company_id: {name, ticker, corp_code, years}}` — 깨진 회사와 연도."""
  # 🔴 `redo_dart` 는 **이미 이 스크립트로 채운 행을 다시 받기 위한** 것이다.
  #    연결 우선 수리(2026-09-11) 전에 별도재무제표가 들어갔고, 그 값은 「그럴듯해서」
  #    급변 검사에 안 걸린다 — 검사만 믿으면 영영 안 고쳐진다.
  src_filter = ['fnguide', 'dart'] if redo_dart else ['fnguide']
  rows = (
    w.table('financials').select('company_id,fiscal_year,revenue,source,period_type')
    .eq('period_type', 'annual').in_('source', src_filter).execute().data or []
  )
  by_company: dict[str, dict[int, float]] = {}
  dart_years: dict[str, set] = {}
  for r in rows:
    rev = r.get('revenue')
    if rev is None or float(rev) <= 0:
      continue
    by_company.setdefault(r['company_id'], {})[r['fiscal_year']] = float(rev)
    if r.get('source') == 'dart' and r['fiscal_year'] in TARGET_YEARS:
      dart_years.setdefault(r['company_id'], set()).add(r['fiscal_year'])

  companies = (
    w.table('companies').select('id,name_kr,ticker,dart_corp_code,status')
    .eq('status', 'active').execute().data or []
  )
  meta = {c['id']: c for c in companies}

  broken: dict[str, dict] = {}
  for cid, years in by_company.items():
    if cid not in meta:
      continue
    bad_years = []
    for fy in TARGET_YEARS:
      cur, nxt = years.get(fy), years.get(fy + 1)
      if cur and nxt and nxt / cur > JUMP_RATIO:
        bad_years.append(fy)
      elif redo_dart and cur and dart_years.get(cid, set()) & {fy}:
        bad_years.append(fy)
    if bad_years:
      c = meta[cid]
      broken[cid] = {
        'name': c.get('name_kr'),
        'ticker': (c.get('ticker') or '').strip(),
        'corp_code': c.get('dart_corp_code'),
        'years': bad_years,
      }
  return broken


def _resolve_by_stock_code(dart, ticker: str) -> str | None:
  """종목코드 → corp_code. 상장사는 이 매칭이 유일하다."""
  if not ticker or not ticker.isdigit() or len(ticker) != 6:
    return None
  codes = dart.corp_codes
  hit = codes[codes['stock_code'].astype(str).str.strip() == ticker]
  return None if hit.empty else str(hit.iloc[0]['corp_code'])


def _main_in_session(w, args) -> None:
  broken = _find_broken(w, redo_dart=args.redo_dart)
  logger.info(f'깨진 회사 {len(broken)}개사 · 연도 {sum(len(v["years"]) for v in broken.values())}건')
  if not broken:
    return

  dart = AUDIT._get_dart()
  if not dart:
    sys.exit('DART 클라이언트 초기화 실패')

  collected: list[dict] = []
  unresolved: list[str] = []
  for i, (cid, info) in enumerate(sorted(broken.items(), key=lambda kv: kv[1]['name'] or ''), 1):
    corp = info['corp_code'] or _resolve_by_stock_code(dart, info['ticker'])
    if not corp:
      unresolved.append(f"{info['name']} (ticker={info['ticker'] or '-'})")
      continue
    rows = AUDIT._collect_company(dart, cid, corp, info['years'])
    got = {r['fiscal_year']: r.get('revenue') for r in rows}
    logger.info(f"[{i}/{len(broken)}] {info['name']} corp={corp} 요청 {info['years']} → 수집 {got}")
    collected.extend(rows)

  if unresolved:
    logger.warning(f'corp_code 미해소 {len(unresolved)}개사: {", ".join(unresolved[:12])}')

  if not collected:
    logger.warning('수집된 행 없음')
    return

  # 🔴 **dedup 은 수집기의 `_dedup_rows` 를 그대로 쓴다**(2026-09-11 실패로 배웠다).
  #    `_collect_company` 는 요청 연도의 «당기 + 전기» 를 함께 돌려주므로 FY2021·FY2022 를
  #    같이 요청하면 2021 이 두 번 나온다 → upsert 가
  #    `ON CONFLICT DO UPDATE command cannot affect row a second time` 로 죽는다.
  #    ⚠️ `_report_fiscal_year` 를 미리 지우면 안 된다 — dedup 이 그 값으로 최신 보고서를 고른다.
  collected = AUDIT._dedup_rows(collected)
  for r in collected:
    r.pop('_report_fiscal_year', None)

  if args.apply:
    upsert_rows(
      'financials', collected, 'company_id,period_type,fiscal_year,fiscal_quarter'
    )
    logger.info(f'반영 {len(collected)}행')
  else:
    logger.info(f'DRY-RUN — {len(collected)}행 수집(반영 안 함). --apply 로 반영할 것.')


def main() -> None:
  ap = argparse.ArgumentParser()
  ap.add_argument('--apply', action='store_true', help='실제 DB 반영 (기본은 dry-run)')
  ap.add_argument(
    '--redo-dart', action='store_true',
    help='이 스크립트로 이미 채운 FY2021~22 행도 다시 받는다(연결 우선 수리 후 재실행용)',
  )
  args = ap.parse_args()
  # 🔴 신규 mutating 스크립트는 WriteSession 필수 — 종료 시 캐시 태그가 자동 무효화된다.
  with WriteSession() as w:
    _main_in_session(w, args)


if __name__ == '__main__':
  main()
