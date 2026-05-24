"""
requests + 사용자 marklines 쿠키로 보쉬 페이지 직접 GET — Playwright 없이 검증.

용법:
  1. scripts/.env 또는 .env.local 에 MARKLINES_COOKIE 등록
     예) MARKLINES_COOKIE=PLATFORM_SESSION=...; XSRF-TOKEN=...; _ga=...
  2. python scripts/debug_marklines_http.py
"""
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

import requests  # noqa: E402

URL = 'https://www.marklines.com/en/top500/bosch'
COOKIE = os.environ.get('MARKLINES_COOKIE', '').strip()

if not COOKIE:
  print('MARKLINES_COOKIE 환경변수 미설정 — scripts/.env 에 추가 필요')
  sys.exit(1)

headers = {
  'User-Agent': (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  ),
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
  'Cookie': COOKIE,
  'Referer': 'https://www.marklines.com/en/',
}

print(f'GET {URL}')
print(f'Cookie 길이: {len(COOKIE)} chars\n')

resp = requests.get(URL, headers=headers, timeout=30, allow_redirects=True)
print(f'Status: {resp.status_code}')
print(f'Final URL: {resp.url}')
print(f'Body length: {len(resp.text):,} chars\n')

if resp.url != URL:
  print(f'⚠ 리다이렉트 발생 — 세션 무효 가능성. 최종 경로: {resp.url}')

# HTML 파일 저장
out_path = Path(__file__).parent / '_debug_bosch_http.html'
out_path.write_text(resp.text, encoding='utf-8')
print(f'전체 HTML → {out_path}\n')

# BeautifulSoup으로 텍스트 추출 + 키워드 분석
try:
  from bs4 import BeautifulSoup
except ImportError:
  print('bs4 미설치 — pip install beautifulsoup4')
  sys.exit(1)

soup = BeautifulSoup(resp.text, 'html.parser')
for tag in soup(['script', 'style', 'noscript']):
  tag.decompose()
text = soup.get_text(separator='\n')
text = re.sub(r'\n{3,}', '\n\n', text).strip()

low = text.lower()
print('=' * 60)
print('인증 상태 체크')
print('=' * 60)
print(f'  "logout" 포함: {"logout" in low}')
print(f'  "/members/logout" 포함: {"/members/logout" in low}')
print(f'  "sign up for a free trial" 포함: {"sign up for a free trial" in low}')
print(f'  "GmbH" 포함: {"gmbh" in low}')
print(f'  "Robert Bosch" 포함: {"robert bosch" in low}')

print('\n' + '=' * 60)
print('EBIT 키워드 컨텍스트')
print('=' * 60)
for m in list(re.finditer(r'ebit', text, flags=re.IGNORECASE))[:5]:
  s = max(0, m.start() - 100)
  print('  ---')
  print('  ' + text[s:m.end() + 500].replace('\n', '\n  '))

print('\n' + '=' * 60)
print('Sales/Revenue 키워드 컨텍스트')
print('=' * 60)
for m in list(re.finditer(r'\b(sales|revenue|turnover)\b', text, flags=re.IGNORECASE))[:5]:
  s = max(0, m.start() - 60)
  print('  ---')
  print('  ' + text[s:m.end() + 400].replace('\n', '\n  '))

print('\n' + '=' * 60)
print('Business Highlight 섹션')
print('=' * 60)
idx = low.find('business highlight')
if idx == -1:
  print('  (못 찾음)')
else:
  print('  ' + text[idx:idx + 2500].replace('\n', '\n  '))

# 정제 텍스트도 저장
text_path = Path(__file__).parent / '_debug_bosch_http_text.txt'
text_path.write_text(text, encoding='utf-8')
print(f'\n정제 텍스트 → {text_path}')
print(f'정제 텍스트 길이: {len(text):,} chars')
