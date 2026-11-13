"""협력사 후보 수집 — MarkLines 서플라이어 DB 검색 → 상세 → 사외비 표 (로컬 수동 실행 전용 · 결정 7).

순서: 사외비 표에서 품목군·경쟁사를 읽는다 → (품목군 × 경쟁사 별칭) 조합 검색 + 품목군 단독 검색 →
      모은 업체 상세를 1초 간격으로 받는다 → suppliers upsert → links upsert.
🔴 stdout 에 경쟁사·품목 이름을 찍지 않는다(id·건수만). 점수는 저장하지 않는다(결정 9).

단독 검색 상한(사용자 선택 2026-11-13): 품목군 «단위»로 판정한다. 그 품목군의 부품명 단독 검색 결과를
모두 합친 집합(합집합)이 N 곳 이하인 품목군만 단독 결과 전부를 받고, 넘으면 하나도 받지 않는다.
단독 검색 하나라도 SEARCH_CAP 에 닿으면 합집합이 실제보다 작게 보이므로 그 품목군은 건너뛴다.

상세 실패가 전체의 10% 를 넘으면 DB 에 쓰기 전에 멈춘다(exit 3) — 화면 구조가 바뀌었는데
일부만 적재되는 것을 막는다. 적재 전에 받은 상세를 참고/협력사/_collect_rows_<시각>.json(gitignore)에
저장해, 적재가 실패해도 다시 받지 않고 되살릴 수 있게 한다. 적재 upsert 는 일시 오류만 재시도한다.

사용: scripts/venv/Scripts/python.exe scripts/collect_sourcing_suppliers.py [--dry-run] [--max-details 3000]
      [--solo-max-hits N]   # 품목군 단독 검색 합집합이 N 곳 넘는 품목군은 단독 결과를 받지 않는다
"""
import argparse
import json
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

# 상세 실패 비율이 이 값을 넘으면 적재하지 않는다.
MAX_FAIL_RATIO = 0.10


def main() -> int:
  sys.stdout.reconfigure(encoding='utf-8', errors='replace')
  from lib.bootstrap import init_script
  init_script(__file__)
  from lib.db import WriteSession, get_client
  from lib.marklines_supplier_db import SEARCH_CAP, NotLoggedIn, SupplierDb, load_cookie
  from lib.retry import with_retry
  from lib.sourcing_parse import UNKNOWN_COUNTRIES, parse_detail

  ap = argparse.ArgumentParser()
  ap.add_argument('--dry-run', action='store_true')
  ap.add_argument('--max-details', type=int, default=3000)
  ap.add_argument('--solo-max-hits', type=int, default=0,
                  help='품목군마다 부품명 단독 검색 결과의 합집합이 이 값 이하일 때만 단독 결과를 받는다'
                       f'(단독 검색 하나라도 {SEARCH_CAP} 곳에 닿으면 건너뜀) · 0 = 단독 검색 안 함')
  args = ap.parse_args()

  c = get_client()
  groups = c.table('sourcing_part_groups').select('id,product_id,ml_part_names').order('id').execute().data
  comps = c.table('sourcing_competitors').select('id,product_id,aliases').order('id').execute().data

  db = SupplierDb(load_cookie())
  # (rand_code) → [(part_group_id, competitor_id | None)]
  hits: dict[str, list[tuple[int, int | None]]] = {}
  searches = 0
  for g in groups:
    for part in g['ml_part_names']:
      for comp in (x for x in comps if x['product_id'] == g['product_id']):
        for alias in comp['aliases']:
          _, codes = db.search(partsName=part, parts_isPartial='false',
                               opt_delName=alias, del_isPartial='true')
          searches += 1
          for code in codes:
            hits.setdefault(code, []).append((g['id'], comp['id']))
    if args.solo_max_hits > 0:
      solo: set[str] = set()
      capped = False
      for part in g['ml_part_names']:
        _, codes = db.search(partsName=part, parts_isPartial='false')
        searches += 1
        capped = capped or len(codes) >= SEARCH_CAP
        solo.update(codes)
      if capped:
        print(f'group#{g["id"]} 단독 검색 상한 걸림({SEARCH_CAP}곳 이상) — 건너뜀')
      elif len(solo) > args.solo_max_hits:
        print(f'group#{g["id"]} 단독 합집합 {len(solo)}곳 > 상한 — 건너뜀')
      else:
        print(f'group#{g["id"]} 단독 합집합 {len(solo)}곳 — 받음')
        for code in solo:
          hits.setdefault(code, []).append((g['id'], None))
  print(f'검색 {searches}회')
  print(f'상세 받을 업체: {len(hits)}')
  if len(hits) > args.max_details:
    print(f'🔴 {len(hits)} > --max-details {args.max_details} — 멈춘다(사용자에게 상한을 묻는다)')
    return 2
  if args.dry_run:
    return 0

  # 기본값 now() 는 INSERT 때만 들어간다 — 다시 받은 업체도 받은 시각이 갱신되게 명시한다.
  fetched_at = datetime.now(timezone.utc).isoformat()
  rows, failed = [], 0
  started = time.monotonic()
  for i, code in enumerate(hits, 1):
    try:
      detail = db.detail(code)
      # 요청한 업체가 아닌 응답이면 엉뚱한 회사 행을 적재하지 않도록 실패로 센다.
      if str(detail['profile'].get('supplier_rand_code')) != code:
        raise ValueError('응답 rand_code 불일치')
      rows.append({**parse_detail(detail, code), 'fetched_at': fetched_at})
    except NotLoggedIn:
      raise  # 로그인이 풀리면 전체를 멈춘다 — 빈 값으로 덮지 않는다.
    except Exception as e:  # 한 업체 실패는 건너뛴다(외부 입력 경계).
      failed += 1
      print(f'상세 실패 #{i}: {type(e).__name__}')
    if i % 100 == 0:
      eta_min = (time.monotonic() - started) / i * (len(hits) - i) / 60
      print(f'  {i}/{len(hits)} · 실패 {failed} · 남은 시간 약 {eta_min:.0f}분')

  if hits and failed / len(hits) > MAX_FAIL_RATIO:
    print(f'🔴 상세 실패 {failed}/{len(hits)} > {MAX_FAIL_RATIO:.0%} — 적재하지 않고 멈춘다(화면 구조 변경 의심)')
    return 3

  # 같은 업체(ml_supplier_id)가 두 rand_code 로 오면 한 배치 upsert 가 「같은 행을 두 번」으로 실패한다.
  # 뒤에 받은 행을 남기고, 지운 쪽 rand_code 는 남은 행의 rand_code 로 이어 links 가 빠지지 않게 한다.
  kept_by_id = {r['ml_supplier_id']: r for r in rows}
  kept_code = {r['ml_rand_code']: kept_by_id[r['ml_supplier_id']]['ml_rand_code'] for r in rows}
  rows = list(kept_by_id.values())

  # 적재가 실패해도 상세를 다시 받지 않고 되살릴 수 있게 먼저 저장한다(참고/ 는 gitignore).
  backup = (Path(__file__).resolve().parents[1] / '참고' / '협력사'
            / f'_collect_rows_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json')
  backup.parent.mkdir(parents=True, exist_ok=True)
  backup.write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')
  print(f'상세 저장: {backup}')

  with WriteSession() as ws:
    id_by_code: dict[str, int] = {}
    for start in range(0, len(rows), 500):
      batch = rows[start:start + 500]
      saved = with_retry(lambda: ws.table('sourcing_suppliers').upsert(
        batch, on_conflict='ml_supplier_id').execute(), _label='sourcing_suppliers upsert').data
      id_by_code.update({r['ml_rand_code']: r['id'] for r in saved})
    id_by_code.update({code: id_by_code[kept] for code, kept in kept_code.items() if kept in id_by_code})
    # found_at 은 보내지 않는다 — 처음 찾은 시각(INSERT 기본값)을 유지한다.
    # 두 rand_code 가 한 업체로 합쳐졌으면 같은 연결이 겹치므로 집합으로 한 번만 보낸다.
    keys = {(id_by_code[code], gid, cid)
            for code, pairs in hits.items() if code in id_by_code
            for gid, cid in pairs}
    links = [{'supplier_id': sid, 'part_group_id': gid, 'competitor_id': cid}
             for sid, gid, cid in sorted(keys, key=lambda k: (k[0], k[1], k[2] or 0))]
    for start in range(0, len(links), 500):
      batch = links[start:start + 500]
      with_retry(lambda: ws.table('sourcing_supplier_links').upsert(
        batch, on_conflict='supplier_id,part_group_id,competitor_id').execute(),
        _label='sourcing_supplier_links upsert')

  print(f'업체 {len(rows)} · 실패 {failed} · 연결 {len(links)}')
  print('지역별:', dict(Counter(r['region'] for r in rows)))
  if UNKNOWN_COUNTRIES:
    print('지역표에 없는 국가(기타로 분류):', sorted(UNKNOWN_COUNTRIES))
  return 0


if __name__ == '__main__':
  sys.exit(main())
