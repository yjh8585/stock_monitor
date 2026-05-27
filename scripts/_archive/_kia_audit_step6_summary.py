#!/usr/bin/env python3
"""Step 6: API dump 분석 + 카테고리화."""
import json
from collections import Counter
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = PROJECT_ROOT / 'data' / '_kia_audit_logs'

d = json.load(open(LOG_DIR / '05_api_dumps.json', encoding='utf-8'))


def summarize_sales(items: list, label: str):
  print(f'\n=== {label}: {len(items)} items ===')
  # type 분포
  types = Counter(it.get('type', '?') for it in items)
  print(f'TYPES: {dict(types)}')
  # year 분포
  years = Counter(it.get('year', '?') for it in items)
  print(f'YEARS: {sorted(years.items(), reverse=True)[:15]}')
  # quarter / month
  qs = Counter(it.get('quarter', '?') for it in items)
  ms = Counter(it.get('month', '?') for it in items)
  print(f'QUARTERS: {sorted([(str(k), v) for k, v in qs.items()])}')
  print(f'MONTHS: {sorted([(str(k), v) for k, v in ms.items()])}')
  # title 패턴
  titles = [it.get('title', '') for it in items]
  print(f'TITLE samples (10):')
  for t in titles[:10]:
    print(f'  - {t}')
  print(f'TITLE last (5):')
  for t in titles[-5:]:
    print(f'  - {t}')
  # files 구조
  print(f'\nFILES structure (first 3):')
  for it in items[:3]:
    print(f'  title={it.get("title", "")[:60]}')
    print(f'    year={it.get("year")} q={it.get("quarter")} m={it.get("month")}')
    print(f'    files={json.dumps(it.get("files"), ensure_ascii=False)[:400]}')
  # 모든 type별로 1개씩 샘플
  print(f'\nBY TYPE samples:')
  seen_types = set()
  for it in items:
    t = it.get('type', '?')
    if t in seen_types: continue
    seen_types.add(t)
    print(f'  type={t}: title="{it.get("title", "")[:70]}" year={it.get("year")} q={it.get("quarter")} m={it.get("month")}')
    if it.get('files'):
      for f in (it['files'] if isinstance(it['files'], list) else [it['files']])[:2]:
        if isinstance(f, dict):
          print(f'    file: {json.dumps(f, ensure_ascii=False)[:300]}')


for label in ['business_sales_ko', 'business_sales_en', 'audit_annual', 'ir_activity_ko']:
  if label in d:
    summarize_sales(d[label], label)

# 파일 URL 패턴 모두 추출
print('\n\n=== ALL FILE URL patterns ===')
urls = set()
for label, items in d.items():
  for it in items:
    files = it.get('files') or it.get('attachments') or it.get('fileList') or []
    if isinstance(files, dict):
      files = [files]
    for f in files if isinstance(files, list) else []:
      if isinstance(f, dict):
        for k in ['url', 'downloadUrl', 'filePath', 'path', 'fileUrl', 'link']:
          if k in f and f[k]:
            urls.add(str(f[k])[:200])

print(f'unique URLs collected: {len(urls)}')
for u in sorted(urls)[:20]:
  print(f'  {u}')
