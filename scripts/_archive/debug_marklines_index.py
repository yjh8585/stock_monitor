"""
marklines top500 인덱스 페이지에서 회사명 → slug 매핑 자동 수집.
실패한 9개 회사의 정확한 slug 찾기.
"""
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

import requests
from bs4 import BeautifulSoup

COOKIE = os.environ.get('MARKLINES_COOKIE', '').strip()
if not COOKIE:
  print('MARKLINES_COOKIE 미설정')
  sys.exit(1)

headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Cookie': COOKIE,
  'Referer': 'https://www.marklines.com/en/',
}

# top500 인덱스 — 페이지네이션 1~25 (회사당 ~20개씩 = 500개)
URLS = [f'https://www.marklines.com/en/top500/?page={p}' for p in range(1, 26)]
URLS += [f'https://www.marklines.com/en/top500/?p={p}' for p in range(1, 11)]
URLS += ['https://www.marklines.com/en/top500/?per_page=500',
         'https://www.marklines.com/en/top500/?limit=500']

# 우리가 찾고자 하는 9개 회사 (실패)
TARGETS = [
  'Benteler', 'BHAP', 'Beijing Hainachuan', 'Brose', 'Clarios',
  'Draexlmaier', 'Dräxlmaier', 'Eberspaecher', 'Eberspächer',
  'Antolin', 'Grupo Antolin', 'NBHX', 'Zhongce', 'ZC Rubber',
]

all_slugs: dict[str, str] = {}

import time
for url in URLS:
  try:
    r = requests.get(url, headers=headers, timeout=30, allow_redirects=True)
    if r.status_code != 200:
      continue
    soup = BeautifulSoup(r.text, 'html.parser')
    count = 0
    for a in soup.find_all('a', href=True):
      href = a['href']
      m = re.search(r'/en/top500/([a-z0-9][a-z0-9\-]*?)(?:/|$|\?|#)', href)
      if m:
        slug = m.group(1)
        text = a.get_text(' ', strip=True)
        if slug and slug not in ('top500', 'index', 'search', 'cf') and text and len(text) < 200:
          # 숫자.회사명 패턴만 (case study 제외)
          if re.match(r'^\d+\.\s', text):
            all_slugs[text] = slug
            count += 1
    print(f'  {url.split("?")[-1]}: {count} 회사 (누적 {len(all_slugs)})')
    time.sleep(0.5)
  except Exception as e:
    print(f'  ERROR {url}: {e}')

print(f'\n총 unique 회사 매핑: {len(all_slugs)}')

# 9개 타겟 회사 매칭
print('\n=== 타겟 회사 9개 매칭 ===')
for target in TARGETS:
  matched = []
  for name, slug in all_slugs.items():
    if target.lower() in name.lower() or target.lower() in slug.lower():
      matched.append((name, slug))
  if matched:
    print(f'\n  [{target}]')
    for name, slug in matched[:5]:
      print(f'    - "{name}" → {slug}')
  else:
    print(f'\n  [{target}] 매칭 없음')

# 전체 슬러그 파일로 저장
out = Path(__file__).parent / '_marklines_index_slugs.json'
import json
out.write_text(json.dumps(all_slugs, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'\n전체 매핑 → {out}')
