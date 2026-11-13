"""협력사 페이지 시드 — 제품·품목군·경쟁사를 사외비 표에 upsert (이름은 JSON 에만 · 공개 레포).

사용: scripts/venv/Scripts/python.exe scripts/seed_sourcing.py --seed 참고/협력사/sourcing_seed.json [--dry-run]

시드를 고칠 때마다 다시 돌리므로 _archive/ 로 옮기지 않는다(멱등 upsert). stdout 은 건수만.
"""
import argparse
import json
import sys


def main() -> int:
  sys.stdout.reconfigure(encoding='utf-8', errors='replace')
  from lib.bootstrap import init_script
  init_script(__file__)
  from lib.db import WriteSession

  ap = argparse.ArgumentParser()
  ap.add_argument('--seed', required=True)
  ap.add_argument('--dry-run', action='store_true')
  args = ap.parse_args()
  with open(args.seed, encoding='utf-8') as f:
    seed = json.load(f)
  n_p = len(seed['products'])
  n_g = sum(len(p['part_groups']) for p in seed['products'])
  n_c = sum(len(p['competitors']) for p in seed['products'])
  print(f'제품 {n_p} · 품목군 {n_g} · 경쟁사 {n_c}')
  if args.dry_run:
    return 0
  with WriteSession() as ws:
    for p in seed['products']:
      prod = ws.table('sourcing_products').upsert(
        {'slug': p['slug'], 'name_ko': p['name_ko'], 'display_order': p['display_order']},
        on_conflict='slug').execute().data[0]
      for g in p['part_groups']:
        ws.table('sourcing_part_groups').upsert(
          {**{k: g[k] for k in ('slug', 'name_ko', 'display_order', 'bom_parts',
                                 'ml_part_names', 'ml_processes', 'keywords')},
           'product_id': prod['id']}, on_conflict='product_id,slug').execute()
      for c in p['competitors']:
        ws.table('sourcing_competitors').upsert(
          {'product_id': prod['id'], 'name': c['name'], 'aliases': c['aliases']},
          on_conflict='product_id,name').execute()
  print('시드 완료')
  return 0


if __name__ == '__main__':
  sys.exit(main())
