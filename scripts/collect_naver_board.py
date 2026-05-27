#!/usr/bin/env python3
"""
한세 4종목(016450/105630/069640/053280)의 네이버 금융 종목토론실 글을 스크래핑해
naver_board_posts 테이블에 upsert한다.

URL 구조:
  https://finance.naver.com/item/board.naver?code={ticker}&page={n}

각 글의 nid(post_id)·작성일시·제목·조회수·공감·비공감만 목록 페이지에서 수집.
본문은 비용 대비 가치가 낮아 생략 (body=NULL).

수집 모드 (--mode):
- full         : 1~MAX_PAGES 페이지 (기본 5페이지)
- incremental  : 마지막 수집 post_id를 만나면 중단 (기본)
"""
import argparse
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows

HANSAE_TICKERS = ['016450', '105630', '069640', '053280']
HEADERS = {
  'User-Agent': (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
  ),
  'Referer': 'https://finance.naver.com/',
}
KST = timezone(timedelta(hours=9))
MAX_PAGES_DEFAULT = 5
PAGE_SLEEP = 0.5  # 페이지 간 sleep (부담 최소화)


def _load_hansae_companies() -> list[dict]:
  client = get_client()
  res = (
    client.table('companies')
    .select('id,ticker,name_kr')
    .in_('ticker', HANSAE_TICKERS)
    .execute()
  )
  return res.data


def _load_known_post_ids(company_id: str, since_days: int = 7) -> set[str]:
  """최근 N일 안의 post_id 집합. incremental 중단 판단용."""
  client = get_client()
  since = (datetime.now(KST) - timedelta(days=since_days)).isoformat()
  res = (
    client.table('naver_board_posts')
    .select('post_id')
    .eq('company_id', company_id)
    .gte('posted_at', since)
    .execute()
  )
  return {r['post_id'] for r in (res.data or [])}


def _parse_int(s: str) -> int | None:
  s = s.strip().replace(',', '')
  if not s or s == '-':
    return None
  try:
    return int(s)
  except ValueError:
    return None


def _parse_posted_at(s: str) -> str | None:
  """네이버 표기 → ISO KST. '2026.05.17 10:30' 또는 '2026.05.17' 형식."""
  s = s.strip()
  for fmt in ('%Y.%m.%d %H:%M', '%Y.%m.%d'):
    try:
      dt = datetime.strptime(s, fmt).replace(tzinfo=KST)
      return dt.isoformat()
    except ValueError:
      pass
  return None


_NID_RE = re.compile(r'nid=(\d+)')


def _fetch_page(ticker: str, page: int) -> list[dict]:
  """종목토론실 한 페이지의 글 목록을 dict 배열로 반환."""
  url = f'https://finance.naver.com/item/board.naver?code={ticker}&page={page}'
  r = requests.get(url, headers=HEADERS, timeout=15)
  # 네이버 금융은 EUC-KR
  r.encoding = r.apparent_encoding or 'euc-kr'
  soup = BeautifulSoup(r.text, 'html.parser')

  posts: list[dict] = []
  rows = soup.select('table.type2 tr[onmouseover]')
  if not rows:
    # 일부 환경은 onmouseover 속성이 없을 수 있어 대안 — td 첫 번째에 날짜 패턴 포함
    rows = [tr for tr in soup.select('table.type2 tr') if tr.select_one('td span.tah')]

  for tr in rows:
    tds = tr.find_all('td')
    if len(tds) < 6:
      continue
    a_tag = tds[1].find('a', href=True)
    if not a_tag:
      continue
    m = _NID_RE.search(a_tag['href'])
    if not m:
      continue
    post_id = m.group(1)
    title = a_tag.get_text(strip=True)
    posted = tds[0].get_text(strip=True)
    views = tds[3].get_text(strip=True)
    likes = tds[4].get_text(strip=True)
    dislikes = tds[5].get_text(strip=True)
    posts.append({
      'post_id': post_id,
      'title': title,
      'posted_at': _parse_posted_at(posted),
      'views': _parse_int(views),
      'likes': _parse_int(likes),
      'dislikes': _parse_int(dislikes),
    })
  return posts


def collectNaverBoard(mode: str = 'incremental', max_pages: int = MAX_PAGES_DEFAULT) -> None:
  companies = _load_hansae_companies()
  logger.info(f'종목토론 수집 모드: {mode}, max_pages={max_pages}, 종목 {len(companies)}개')

  total_rows = 0
  for company in companies:
    ticker = company['ticker']
    known = _load_known_post_ids(company['id']) if mode == 'incremental' else set()
    new_rows: list[dict] = []
    now_iso = datetime.now(KST).isoformat()

    for page in range(1, max_pages + 1):
      try:
        posts = _fetch_page(ticker, page)
      except Exception as e:
        logger.warning(f'{ticker} page={page} fetch 실패: {e}')
        continue
      if not posts:
        logger.debug(f'{ticker} page={page}: 빈 목록 — 중단')
        break

      page_new = 0
      for p in posts:
        if not p.get('post_id') or not p.get('posted_at'):
          continue
        if mode == 'incremental' and p['post_id'] in known:
          continue
        new_rows.append({
          'company_id': company['id'],
          'post_id': p['post_id'],
          'posted_at': p['posted_at'],
          'title': p['title'],
          'body': None,
          'views': p['views'],
          'likes': p['likes'],
          'dislikes': p['dislikes'],
          'fetched_at': now_iso,
        })
        page_new += 1

      logger.debug(f'{ticker} page={page}: {len(posts)}건 중 신규 {page_new}건')
      # incremental 모드: 페이지 전체가 known이면 더 안 봐도 됨
      if mode == 'incremental' and page_new == 0:
        break
      time.sleep(PAGE_SLEEP)

    if new_rows:
      upsert_rows('naver_board_posts', new_rows, 'company_id,post_id')
      total_rows += len(new_rows)
      logger.info(f"{ticker} ({company['name_kr']}): {len(new_rows)}건 upsert")
    else:
      logger.info(f"{ticker} ({company['name_kr']}): 신규 없음")

  logger.info(f'종목토론 수집 완료 — 총 {total_rows}건')


if __name__ == '__main__':
  parser = argparse.ArgumentParser(description='한세 3종목 네이버 종목토론 수집')
  parser.add_argument(
    '--mode', choices=['full', 'incremental'], default='incremental',
    help='full: 1~max_pages 모두, incremental: 기존 post_id 만나면 중단 (기본값)'
  )
  parser.add_argument('--max-pages', type=int, default=MAX_PAGES_DEFAULT)
  args = parser.parse_args()
  try:
    collectNaverBoard(mode=args.mode, max_pages=args.max_pages)
  except Exception as e:
    import traceback
    logger.error(f'종목토론 수집 실패: {e}\n{traceback.format_exc()}')
    sys.exit(1)
