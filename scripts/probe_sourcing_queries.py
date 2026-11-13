"""품목군·경쟁사 조합별 MarkLines 검색 건수 사전 점검 (상세는 받지 않는다).

사용: scripts/venv/Scripts/python.exe scripts/probe_sourcing_queries.py --seed 참고/협력사/sourcing_seed.json

🔴 공개 레포 — stdout 에 경쟁사·부품명을 쓰지 않는다(slug·번호·건수만). 실제 값은 시드 JSON(gitignore)에만.
"""
import argparse
import json
import sys


def main() -> int:
  sys.stdout.reconfigure(encoding='utf-8', errors='replace')
  from lib.bootstrap import init_script
  init_script(__file__)
  from lib.marklines_supplier_db import SEARCH_CAP, SupplierDb, load_cookie

  def n(ids: list[int]) -> str:
    return f'{len(ids)}(상한 — 잘림)' if len(ids) >= SEARCH_CAP else str(len(ids))

  ap = argparse.ArgumentParser()
  ap.add_argument('--seed', required=True)
  args = ap.parse_args()
  with open(args.seed, encoding='utf-8') as f:
    seed = json.load(f)
  db = SupplierDb(load_cookie())
  union: set[int] = set()  # 경쟁사 조합 검색에서 걸린 업체
  solo: set[int] = set()  # 부품명 단독 검색에서 걸린 업체
  for p in seed['products']:
    for g in p['part_groups']:
      g_union: set[int] = set()
      g_solo: set[int] = set()
      for pi, part in enumerate(g['ml_part_names']):
        ids, _ = db.search(partsName=part, parts_isPartial='false')
        g_solo.update(ids)
        print(f"{p['slug']}/{g['slug']} 단독 part#{pi}: {n(ids)}")
        for ci, c in enumerate(p['competitors']):
          for ai, alias in enumerate(c['aliases']):
            cids, _ = db.search(partsName=part, parts_isPartial='false',
                                opt_delName=alias, del_isPartial='true')
            g_union.update(cids)
            print(f'  × competitor#{ci} alias#{ai}: {n(cids)}')
      print(f"= {p['slug']}/{g['slug']} 조합 합집합 {len(g_union)} · 단독 합집합 {len(g_solo)}")
      union |= g_union
      solo |= g_solo
  print(f'경쟁사 조합 합집합: {len(union)}')
  print(f'단독 검색 합집합: {len(solo)}')
  print(f'전체 합집합(조합 ∪ 단독): {len(union | solo)}')
  return 0


if __name__ == '__main__':
  sys.exit(main())
