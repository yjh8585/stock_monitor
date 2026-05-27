#!/usr/bin/env python3
"""Kia IR audit - Step 5: 발견된 JSON API 직접 호출.

Kia IR 사이트는 React SPA. 데이터는 다음 API에서 fetch:
  - GET /api/investors/business-sales-results?year={Y}&page={P}&language={ko|en}
  - GET /api/investors/audit-annual-report?year={Y}&page={P}
  - GET /api/investors/ir-activity?language={ko|en}&isMobile=false&year={Y}&page={P}

연도/페이지 조합으로 전체 데이터 수집 → 파일 URL/메타데이터/엑셀 종류 인벤토리.
"""
import json
import time
from pathlib import Path

import httpx
from loguru import logger

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = PROJECT_ROOT / 'data' / '_kia_audit_logs'
EXCEL_DIR = PROJECT_ROOT / 'data' / '_kia_audit_excel'
PDF_DIR = PROJECT_ROOT / 'data' / '_kia_audit_pdf'

BASE = 'https://worldwide.kia.com'

HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
  'Referer': 'https://worldwide.kia.com/ko/company/investor-relations/library/performance-and-plans/',
}


def fetch_api(client: httpx.Client, endpoint: str, params: dict) -> dict | None:
  try:
    r = client.get(f'{BASE}{endpoint}', params=params, timeout=30)
    if r.status_code != 200:
      return {'__status__': r.status_code, '__text__': r.text[:300]}
    return r.json()
  except Exception as e:
    return {'__err__': str(e)}


def crawl_endpoint(client: httpx.Client, endpoint: str, base_params: dict, label: str) -> list:
  """다양한 year + page 조합으로 전체 데이터 수집."""
  all_items = []
  pages_seen = set()
  # year=0 우선 (전체), 그 다음 2021~2025
  for year in [0, 2021, 2022, 2023, 2024, 2025, 2026]:
    for page in range(0, 50):
      params = dict(base_params, year=year, page=page)
      data = fetch_api(client, endpoint, params)
      if not data or '__err__' in data or '__status__' in data:
        if data:
          logger.warning(f'  {label} y={year} p={page}: {data.get("__status__", "err")} {data.get("__text__", data.get("__err__", ""))[:60]}')
        break
      # 응답 구조 정규화
      items = []
      if isinstance(data, list):
        items = data
      elif isinstance(data, dict):
        for k in ['data', 'list', 'items', 'content', 'result', 'rows']:
          if k in data and isinstance(data[k], list):
            items = data[k]
            break
        if not items and 'data' in data and isinstance(data['data'], dict):
          for k in ['list', 'items', 'content', 'rows']:
            if k in data['data'] and isinstance(data['data'][k], list):
              items = data['data'][k]
              break
      if not items:
        break
      # 중복 제거 (id 기준)
      new_count = 0
      for it in items:
        key = json.dumps(it, sort_keys=True, ensure_ascii=False)[:200]
        if key not in pages_seen:
          pages_seen.add(key)
          all_items.append(dict(it, _year_param=year, _page_param=page))
          new_count += 1
      logger.info(f'  {label} y={year} p={page}: items={len(items)} new={new_count} total={len(all_items)}')
      if new_count == 0:
        break
      time.sleep(0.2)
  return all_items


def main():
  results = {}
  with httpx.Client(headers=HEADERS, follow_redirects=True) as client:
    for label, endpoint, params in [
      ('business_sales_ko', '/api/investors/business-sales-results', {'language': 'ko'}),
      ('business_sales_en', '/api/investors/business-sales-results', {'language': 'en'}),
      ('audit_annual', '/api/investors/audit-annual-report', {}),
      ('ir_activity_ko', '/api/investors/ir-activity', {'language': 'ko', 'isMobile': 'false'}),
    ]:
      logger.info(f'>> {label}: {endpoint}')
      items = crawl_endpoint(client, endpoint, params, label)
      results[label] = items
      logger.info(f'  total: {len(items)}')
  out = LOG_DIR / '05_api_dumps.json'
  out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
  logger.info(f'Saved: {out}')

  # 요약 출력
  for label, items in results.items():
    print(f'== {label}: {len(items)} items')
    if items:
      print(f'  sample keys: {list(items[0].keys())}')
      for it in items[:3]:
        print(f'  {json.dumps({k: v for k, v in it.items() if not k.startswith("_")}, ensure_ascii=False)[:300]}')


if __name__ == '__main__':
  main()
