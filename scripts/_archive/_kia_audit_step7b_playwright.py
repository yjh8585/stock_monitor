#!/usr/bin/env python3
"""Step 7b: Playwright + APIRequestContext로 file 다운로드 (브라우저 fingerprint 사용)."""
import json
import os
from pathlib import Path

from loguru import logger
from playwright.sync_api import sync_playwright

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = PROJECT_ROOT / 'data' / '_kia_audit_logs'
EXCEL_DIR = PROJECT_ROOT / 'data' / '_kia_audit_excel'
PDF_DIR = PROJECT_ROOT / 'data' / '_kia_audit_pdf'

# 기존 잘못된 mass copy 정리
for fp in EXCEL_DIR.glob('perf_plans_ko_*.xlsx'):
  if 'perf_plans_ko_2026' not in fp.name or fp.name.count('_') >= 3:
    try: os.remove(fp)
    except: pass
for fp in PDF_DIR.glob('reports_ko_*.pdf'):
  if 'reports_ko_2025' not in fp.name or fp.name.count('_') >= 2:
    try: os.remove(fp)
    except: pass
for fp in PDF_DIR.glob('e_disclosure_ko_*.pdf'):
  if 'e_disclosure_ko_2026' not in fp.name or fp.name.count('_') >= 2:
    try: os.remove(fp)
    except: pass

BASE = 'https://worldwide.kia.com/files/'

d = json.load(open(LOG_DIR / '05_api_dumps.json', encoding='utf-8'))


def download_path(api_ctx, path: str, dest: Path) -> bool:
  url = f'{BASE}{path}'
  try:
    r = api_ctx.get(url, timeout=60_000)
    if r.status != 200:
      logger.error(f'  {dest.name}: {r.status}')
      return False
    dest.write_bytes(r.body())
    logger.info(f'  {dest.name}: {len(r.body())/1024:.0f} KB')
    return True
  except Exception as e:
    logger.error(f'  {dest.name}: {e}')
    return False


def safe_name(title: str) -> str:
  if '차종별' in title or 'by Model' in title: return 'model'
  if '해외공장' in title or 'Overseas Plant' in title: return 'factory'
  if ('지역별수출' in title or '지역별 수출' in title or
      ('Export' in title and 'Region' in title)): return 'export'
  return 'other'


with sync_playwright() as pw:
  browser = pw.chromium.launch(headless=True)
  ctx = browser.new_context(
    user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    locale='ko-KR',
  )
  page = ctx.new_page()
  # 일단 사이트 접속해서 쿠키 획득
  page.goto('https://worldwide.kia.com/ko/company/investor-relations/library/performance-and-plans/', wait_until='networkidle')
  page.wait_for_timeout(3000)

  api_ctx = ctx.request

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
      kind = safe_name(title)
      dest = EXCEL_DIR / f'kia_{year}_{kind}.xlsx'
      download_path(api_ctx, path, dest)

  # 2. 영문 2025
  for item in d['business_sales_en']:
    if item.get('type') != 'sales' or item.get('year') != 2025:
      continue
    for f in item.get('files') or []:
      title = f.get('title', '')
      path = f.get('path', '')
      if not path or not title.lower().endswith('.xlsx'):
        continue
      kind = safe_name(title)
      dest = EXCEL_DIR / f'kia_2025_en_{kind}.xlsx'
      download_path(api_ctx, path, dest)

  # 3. 분기 IR PDF (3Q/4Q 2025, 4Q 2024)
  for item in d['business_sales_ko']:
    if item.get('type') != 'business':
      continue
    year = item.get('year')
    q = item.get('quarter')
    if not ((year == 2025 and q in ('3Q', '4Q')) or (year == 2024 and q == '4Q')):
      continue
    for f in item.get('files') or []:
      title = f.get('title', '')
      path = f.get('path', '')
      if not path or not title.lower().endswith('.pdf'):
        continue
      dest = PDF_DIR / f'kia_{year}_{q.lower()}_business.pdf'
      download_path(api_ctx, path, dest)

  ctx.close()
  browser.close()

logger.info('Done')
