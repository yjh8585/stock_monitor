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
from datetime import datetime
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
DEFAULT_YEARS = (2021, 2022)


def _load_state(w) -> tuple[dict, dict]:
  """`(meta, by_company)` — active 회사 메타와 `{cid: {fy: row}}` 연간 재무.

  🔴 **출처로 거르지 않는다**(2026-09-11 수리). 종전엔 `source in ('fnguide','dart')`
  만 봤는데, 현대위아 FY2021 은 옛 수집기가 남긴 `pykrx+dart` 라 **탐지에서 통째로
  빠졌다**(1.49조 → 실제 연결 7.7조). 탐지는 «라벨» 이 아니라 «값» 을 봐야 한다.
  """
  rows: list[dict] = []
  start = 0
  while True:
    # 🔴 `.range()` 다중 페이지는 `.order()` 필수 — 빠뜨리면 행이 조용히 누락된다.
    batch = (
      w.table('financials')
      .select('company_id,fiscal_year,revenue,source,consolidation,period_type')
      .eq('period_type', 'annual')
      .order('company_id').order('fiscal_year')
      .range(start, start + 999).execute().data or []
    )
    rows.extend(batch)
    if len(batch) < 1000:
      break
    start += 1000

  by_company: dict[str, dict[int, dict]] = {}
  for r in rows:
    by_company.setdefault(r['company_id'], {})[r['fiscal_year']] = r

  companies = (
    w.table('companies').select('id,name_kr,ticker,dart_corp_code,status')
    .eq('status', 'active').execute().data or []
  )
  return {c['id']: c for c in companies}, by_company


def _parse_only(spec: str, meta: dict) -> dict[str, list[int]]:
  """`--only "진영산업:2023,현대트랜시스:2022"` → `{company_id: [years]}`.

  🔴 급변 검사만으로는 **어느 쪽 해가 틀렸는지 못 가른다** — 진영산업은 FY2022 가 맞고
  FY2023 이 1,000배 틀렸는데, 비율만 보면 앞 해가 범인처럼 보인다. 실측으로 범인을
  특정했을 때 **그 해만 정확히** 다시 받으려고 둔 문이다.
  """
  by_name = {(c.get('name_kr') or '').strip(): cid for cid, c in meta.items()}
  out: dict[str, list[int]] = {}
  for token in spec.split(','):
    token = token.strip()
    if not token:
      continue
    name, _, year = token.partition(':')
    cid = by_name.get(name.strip())
    if not cid:
      sys.exit(f'--only: 회사를 못 찾았다 — {name}')
    if not year.strip().isdigit():
      sys.exit(f'--only: 연도를 밝혀라 — {token} (예: {name}:2023)')
    out.setdefault(cid, []).append(int(year))
  return out


def _find_broken(
  meta: dict, by_company: dict, target_years: tuple[int, ...], redo_dart: bool = False
) -> dict[str, dict]:
  """`{company_id: {name, ticker, corp_code, years}}` — 깨진 회사와 연도."""
  # 🔴 `redo_dart` 는 **이미 이 스크립트로 채운 행을 다시 받기 위한** 것이다.
  #    연결 우선 수리(2026-09-11) 전에 별도재무제표가 들어갔고, 그 값은 「그럴듯해서」
  #    급변 검사에 안 걸린다 — 검사만 믿으면 영영 안 고쳐진다.
  broken: dict[str, dict] = {}
  for cid, years in by_company.items():
    if cid not in meta:
      continue
    bad_years: list[int] = []
    for fy in target_years:
      cur, nxt = years.get(fy), years.get(fy + 1)
      cur_rev = float(cur['revenue']) if cur and cur.get('revenue') else 0.0
      nxt_rev = float(nxt['revenue']) if nxt and nxt.get('revenue') else 0.0
      if cur_rev > 0 and nxt_rev > 0 and nxt_rev / cur_rev > JUMP_RATIO:
        bad_years.append(fy)
      elif redo_dart and cur is not None and cur.get('source') == 'dart':
        bad_years.append(fy)
    if bad_years:
      c = meta[cid]
      broken[cid] = {
        'name': c.get('name_kr'),
        'ticker': (c.get('ticker') or '').strip(),
        'corp_code': c.get('dart_corp_code'),
        'years': sorted(set(bad_years)),
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
  target_years = tuple(int(y) for y in args.years.split(',')) if args.years else DEFAULT_YEARS
  meta, by_company = _load_state(w)

  if args.only:
    picked = _parse_only(args.only, meta)
    broken = {
      cid: {
        'name': meta[cid].get('name_kr'),
        'ticker': (meta[cid].get('ticker') or '').strip(),
        'corp_code': meta[cid].get('dart_corp_code'),
        'years': sorted(set(years)),
      }
      for cid, years in picked.items()
    }
  else:
    broken = _find_broken(meta, by_company, target_years, redo_dart=args.redo_dart)

  logger.info(f'깨진 회사 {len(broken)}개사 · 연도 {sum(len(v["years"]) for v in broken.values())}건')
  if not broken:
    return

  # 🔴 **이웃 연도를 덮어쓰지 않는다**(2026-09-11 수리). `_collect_company` 는 요청 연도의
  #    «당기 + 전기» 를 함께 주는데, 종전엔 그 전기 행까지 전부 upsert 해서 **멀쩡한
  #    fnguide 행이 DART 별도 값으로 갈렸다**(화승코퍼레이션 FY2020: 연결 약 1.2조 →
  #    별도 427억). 쓸 연도는 「요청한 해」 + 「이미 이 스크립트가 쓴 dart 행(= 되돌려야
  #    할 피해)」 로 한정한다.
  writable: set[tuple[str, int]] = set()
  for cid, info in broken.items():
    for fy in info['years']:
      writable.add((cid, fy))
      prev = by_company.get(cid, {}).get(fy - 1)
      if prev is not None and prev.get('source') == 'dart':
        writable.add((cid, fy - 1))

  # 🔴 **고칠 해 N 을 받을 때 N+1 보고서도 함께 받는다**(2026-09-11 실사고로 신설).
  #    `_dedup_rows` 가 더 최신 보고서를 우선하므로, N+1 보고서의 «전기» 가 N 의 값이 된다.
  #    왜 그래야 하나 — **원보고서와 후속보고서가 둘 다 맞을 수 있기 때문**이다.
  #    중단사업·매각으로 지배력을 잃으면 다음 해 보고서가 **전기를 계속영업 기준으로
  #    재작성**한다. 디에이치오토넥스 FY2022 는 원보고서 5,367억 · FY2023 보고서의 전기
  #    502억이고 **둘 다 원문 그대로**다. 원보고서만 보고 「DB 가 틀렸다」며 덮었더니
  #    FY2022→23 에 10배 낙차가 새로 생겼다(디와이에이도 같은 일).
  #    ⚠️ 「DART 와 DB 가 다르다」는 「DB 가 틀렸다」가 아니다 — **어느 보고서를 보느냐**다.
  this_year = datetime.now().year
  for info in broken.values():
    info['request_years'] = sorted(
      {y for fy in info['years'] for y in (fy, fy + 1) if y <= this_year}
    )

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
    rows = AUDIT._collect_company(dart, cid, corp, info['request_years'])
    got = {r['fiscal_year']: r.get('revenue') for r in rows}
    logger.info(
      f"[{i}/{len(broken)}] {info['name']} corp={corp} 고칠해 {info['years']} "
      f"(요청 {info['request_years']}) → 수집 {got}"
    )
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
  skipped = [r for r in collected if (r['company_id'], r['fiscal_year']) not in writable]
  collected = [r for r in collected if (r['company_id'], r['fiscal_year']) in writable]
  if skipped:
    logger.info(f'이웃 연도 {len(skipped)}행은 쓰지 않는다(멀쩡한 행 보호)')

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
    help='이 스크립트로 이미 채운 dart 행도 다시 받는다(수집기 수리 후 재실행용)',
  )
  ap.add_argument('--years', help=f'검사할 연도 (기본 {",".join(map(str, DEFAULT_YEARS))})')
  ap.add_argument(
    '--only',
    help='급변 검사 대신 «지정한 회사·연도» 만 다시 받는다 — 예: "진영산업:2023,현대트랜시스:2022"',
  )
  args = ap.parse_args()
  # 🔴 신규 mutating 스크립트는 WriteSession 필수 — 종료 시 캐시 태그가 자동 무효화된다.
  with WriteSession() as w:
    _main_in_session(w, args)


if __name__ == '__main__':
  main()
