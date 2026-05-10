"""namu.wiki 자동차 제조사/브랜드 페이지에서 로고 이미지 URL 추출.

표 구조: 회사 한글명 + 이미지 (img 태그) 셀이 인접.
DOM에서 회사명 ↔ 이미지 URL 매핑 추출.
"""
import json
import re
import sys
from pathlib import Path

import requests
from bs4 import BeautifulSoup

URL = 'https://namu.wiki/w/자동차/제조사 및 브랜드'
OUT = Path(__file__).parent / '_namu_logos.json'

UA = (
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
)

r = requests.get(URL, headers={'User-Agent': UA, 'Accept-Language': 'ko,en;q=0.9'},
                 timeout=30, allow_redirects=True)
print(f'status={r.status_code} len={len(r.text):,}')

soup = BeautifulSoup(r.text, 'html.parser')

# 모든 img 태그 + 인접 텍스트 추출
mapping: dict[str, str] = {}

# 표 안의 img 찾기 — 같은 셀(td) 안에 한글 텍스트 + img
# 또는 div 그리드 셀 — 같은 부모 안에 img와 텍스트
for img in soup.find_all('img'):
  src = img.get('src', '')
  if not src or 'namu.wiki/i/' not in src and 'i.namu.wiki' not in src:
    continue
  # 절대 URL 정규화
  if src.startswith('//'):
    src = 'https:' + src

  # alt 텍스트 우선
  alt = (img.get('alt') or '').strip()
  if alt and re.search(r'[가-힣]', alt):
    mapping[alt] = src
    continue

  # 부모/조부모 셀 안의 한글 텍스트 찾기
  parent = img.parent
  for _ in range(5):
    if not parent: break
    text = parent.get_text(' ', strip=True)
    # 한글 단어 (2~30 chars)만 후보
    if text and re.search(r'[가-힣]', text):
      # 이미지 별로 셀 단위로 분리되어 있을 가능성
      # text가 여러 회사명을 포함하면 첫 한글 단어
      candidates = re.findall(r'[가-힣A-Za-z0-9·\-]{2,30}', text)
      kor_candidates = [c for c in candidates if re.search(r'[가-힣]', c)]
      if kor_candidates and len(kor_candidates) <= 3:
        # 첫 번째 한글 단어
        name = kor_candidates[0]
        if name not in mapping:
          mapping[name] = src
        break
    parent = parent.parent

print(f'\n추출 매핑: {len(mapping)}개')
for name, src in list(mapping.items())[:30]:
  print(f'  {name}: {src[:80]}')

OUT.write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'\n저장 → {OUT}')
