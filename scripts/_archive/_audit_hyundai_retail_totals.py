#!/usr/bin/env python3
"""파싱 결과의 US/EU Total을 print — 도매와 cross-check 용."""
from pathlib import Path

from lib.bootstrap import init_script

init_script(__file__)

import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location(
  'collect_hyundai_retail',
  Path(__file__).resolve().parent / 'collect_hyundai_retail.py',
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

DEST_DIR = Path(__file__).resolve().parent.parent / 'data' / '_hyundai_downloads'

for region in ('US', 'EU'):
  path = DEST_DIR / f'2024_retail_{region}.xlsx'
  if not path.exists():
    print(f'{region}: {path} 없음')
    continue
  rows = mod.parse_retail_excel(path, 2024, region)
  total_rows = [r for r in rows if r['vehicle_model'] == 'Total' and r['period_type'] == 'annual']
  industry = [r for r in rows if r['vehicle_model'] == 'Industry' and r['period_type'] == 'annual']
  share = [r for r in rows if r['vehicle_model'] == 'MarketShare' and r['period_type'] == 'annual']
  print(f'\n=== {region} 2024 ===')
  print(f'  총 rows: {len(rows)}')
  print(f'  Total annual: {total_rows}')
  print(f'  Industry annual: {industry}')
  print(f'  MarketShare annual: {share}')
  # 월 12개 합 vs annual Total cross-check
  months = [r for r in rows if r['vehicle_model'] == 'Total' and r['period_type'] == 'month']
  month_sum = sum((r['retail_units'] or 0) for r in months)
  print(f'  월별 Total 합: {month_sum}')
