#!/usr/bin/env python3
"""Step 7: 발견된 file path 패턴으로 정확한 샘플 다운로드.

URL 패턴: https://worldwide.kia.com/files/{path}
다운로드:
  - 2025/2024/2023 차종별판매실적 (sales by model) — 연도별 1개
  - 2025/2024/2023 해외공장판매실적 (overseas plant sales)
  - 2025/2024/2023 지역별수출실적 (regional export)
  - 2025년 3분기 경영실적 PDF (business)
  - 2025년 영업보고서 PDF (annual business report)
"""
import json
from pathlib import Path

import httpx
from loguru import logger

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = PROJECT_ROOT / 'data' / '_kia_audit_logs'
EXCEL_DIR = PROJECT_ROOT / 'data' / '_kia_audit_excel'
PDF_DIR = PROJECT_ROOT / 'data' / '_kia_audit_pdf'

# 기존 mass-copy 정리
import os
for fp in EXCEL_DIR.glob('perf_plans_ko_*.xlsx'):
  if fp.name != 'perf_plans_ko_2026 지역별수출실적.xlsx':
    os.remove(fp)
for fp in PDF_DIR.glob('reports_ko_*.pdf'):
  if fp.name != 'reports_ko_2025년 3분기 연결검토보고서.pdf':
    os.remove(fp)
for fp in PDF_DIR.glob('e_disclosure_ko_*.pdf'):
  if fp.name != 'e_disclosure_ko_2026년 임시주주총회 기준일 설정 공고.pdf':
    os.remove(fp)

BASE = 'https://worldwide.kia.com/files/'

HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Referer': 'https://worldwide.kia.com/ko/company/investor-relations/library/performance-and-plans/',
}

d = json.load(open(LOG_DIR / '05_api_dumps.json', encoding='utf-8'))


def download_file(client: httpx.Client, path: str, dest: Path) -> bool:
  url = f'{BASE}{path}'
  try:
    r = client.get(url, timeout=60)
    if r.status_code != 200:
      logger.error(f'  {dest.name}: {r.status_code}')
      return False
    dest.write_bytes(r.content)
    logger.info(f'  {dest.name}: {len(r.content)/1024:.0f} KB ← {url}')
    return True
  except Exception as e:
    logger.error(f'  {dest.name}: {e}')
    return False


with httpx.Client(headers=HEADERS) as client:
  # 1. 연간 엑셀 3종 (2023, 2024, 2025)
  for item in d['business_sales_ko']:
    if item.get('type') != 'sales':
      continue
    year = item.get('year')
    if year not in (2023, 2024, 2025):
      continue
    for f in item.get('files') or []:
      title = f.get('title', '')
      path = f.get('path', '')
      if not path or not title.lower().endswith('.xlsx'):
        continue
      # 간략한 파일명
      kind = ''
      if '차종별' in title:
        kind = 'model'
      elif '해외공장' in title:
        kind = 'factory'
      elif '지역별수출' in title or '지역별 수출' in title:
        kind = 'export'
      else:
        kind = 'other'
      dest = EXCEL_DIR / f'kia_{year}_{kind}.xlsx'
      download_file(client, path, dest)

  # 2. 영문 연간 엑셀 (2025만 — 다국어 비교용)
  for item in d['business_sales_en']:
    if item.get('type') != 'sales' or item.get('year') != 2025:
      continue
    for f in item.get('files') or []:
      title = f.get('title', '')
      path = f.get('path', '')
      if not path or not title.lower().endswith('.xlsx'):
        continue
      kind = ''
      if 'Sales by Model' in title:
        kind = 'model'
      elif 'Overseas Plant' in title:
        kind = 'factory'
      elif 'Export' in title and 'Region' in title:
        kind = 'export'
      else:
        kind = 'other'
      dest = EXCEL_DIR / f'kia_2025_en_{kind}.xlsx'
      download_file(client, path, dest)

  # 3. 분기 IR PDF — 2025년 3분기 경영실적
  for item in d['business_sales_ko']:
    if item.get('type') != 'business':
      continue
    year = item.get('year')
    q = item.get('quarter')
    if not (year == 2025 and q == '3Q'):
      continue
    for f in item.get('files') or []:
      title = f.get('title', '')
      path = f.get('path', '')
      if not path or not title.lower().endswith('.pdf'):
        continue
      dest = PDF_DIR / f'kia_2025_q3_business.pdf'
      download_file(client, path, dest)

  # 4. 분기 IR PDF — 2025년 4분기 + 2024년 4분기 비교
  for item in d['business_sales_ko']:
    if item.get('type') != 'business':
      continue
    year = item.get('year')
    q = item.get('quarter')
    if not ((year == 2025 and q == '4Q') or (year == 2024 and q == '4Q')):
      continue
    for f in item.get('files') or []:
      title = f.get('title', '')
      path = f.get('path', '')
      if not path or not title.lower().endswith('.pdf'):
        continue
      dest = PDF_DIR / f'kia_{year}_q4_business.pdf'
      download_file(client, path, dest)

logger.info('Done')
