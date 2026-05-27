#!/usr/bin/env python3
"""2025 cache-only parse 결과 검증 — model/factory/export 합계 vs Grand Total."""
import sys
from pathlib import Path
from lib.bootstrap import init_script

init_script(__file__)

from collect_hyundai_sales import (  # noqa: E402
  DOWNLOAD_DIR,
  parse_factory_excel,
  parse_model_excel,
  parse_export_excel,
)


def verify(year: int) -> None:
  print(f'\n=== {year} parse vs Excel Grand Total ===')
  m_rows = parse_model_excel(DOWNLOAD_DIR / f'{year}_model.xlsx', year)
  f_rows = parse_factory_excel(DOWNLOAD_DIR / f'{year}_factory.xlsx', year)
  e_rows = parse_export_excel(DOWNLOAD_DIR / f'{year}_export.xlsx', year)

  m_total = sum(r['sales_units'] for r in m_rows)
  f_total = sum(r['sales_units'] for r in f_rows)
  e_total = sum(r['sales_units'] for r in e_rows)

  m_dom = sum(r['sales_units'] for r in m_rows if r['region'] == '내수')
  m_exp = sum(r['sales_units'] for r in m_rows if r['region'] == '수출')

  f_dom = sum(r['sales_units'] for r in f_rows if r['region'] == '내수')
  f_exp = sum(r['sales_units'] for r in f_rows if r['region'] == '수출')
  f_ckd = sum(r['sales_units'] for r in f_rows if r['region'] == 'CKD')

  print(f'  model rows={len(m_rows)}, sum={m_total:,} (Domestic={m_dom:,}, Export={m_exp:,})')
  print(f'    Grand Total target=1,839,148  diff={m_total - 1839148:+,}')
  print(f'  factory rows={len(f_rows)}, sum={f_total:,} (Dom={f_dom:,}, Exp={f_exp:,}, CKD={f_ckd:,})')
  print(f'    Grand Total target=2,271,234  diff={f_total - 2271234:+,}')
  print(f'  export rows={len(e_rows)}, sum={e_total:,} (target=1,142,659  diff={e_total - 1142659:+,})')

  # 누락 모델 점검 (LCV/HCV 행이 들어왔는지)
  lcv_hcv = [r for r in m_rows if r['vehicle_model'] in ('LCV', 'HCV')]
  print(f'\n  model의 LCV/HCV: {len(lcv_hcv)}건')
  for r in lcv_hcv[:24]:
    print(f'    {r["region"]} {r["vehicle_model"]} {r["year_period"]} {r["sales_units"]:,}')

  # CKD 행 점검
  ckd = [r for r in f_rows if r['region'] == 'CKD' or r['factory'] == 'CKD']
  print(f'\n  factory의 CKD: {len(ckd)}건')
  for r in ckd[:24]:
    print(f'    f={r["factory"]} reg={r["region"]} vm={r["vehicle_model"]} {r["year_period"]} {r["sales_units"]:,}')


if __name__ == '__main__':
  for y in [2025]:
    verify(y)
