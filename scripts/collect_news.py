#!/usr/bin/env python3
"""
모든 active 회사의 최신 뉴스를 수집해 news 테이블에 upsert한다.
- 한국 상장사: Naver Finance 모바일 API — 종목별 큐레이션 (관련성 100%)
- 한국 비상장사(market=NULL): Google News RSS — 회사명 기반 검색
- 글로벌 상장사(yfinance): Ticker.news → 최근 20건

환경변수:
  TARGET_TICKERS  콤마 구분 ticker (옵션) — 신규 회사 추가 직후 즉시 수집용
  NEWS_RETENTION_DAYS  뉴스 보존 일수 (default 60, 0 이하면 삭제 skip)
  NEWS_SLEEP_SEC  회사 간 sleep 초 (default 0.5) — Naver/yfinance/Google RSS rate limit 회피
"""
import html
import os
import sys
import time
import urllib.parse
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests
import yfinance as yf
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client

MAX_NEWS = 20  # 회사당 최대 수집 건수
_HTTP_HEADERS = {'User-Agent': 'Mozilla/5.0'}
_KST = timezone(timedelta(hours=9))
SLEEP_SEC = float(os.environ.get('NEWS_SLEEP_SEC', '0.5'))
RETENTION_DAYS = int(os.environ.get('NEWS_RETENTION_DAYS', '60'))


# ── 한국 상장사: Naver Finance 모바일 API (종목별 큐레이션) ────────


def _fetch_kr_news_naver(ticker: str, name_kr: str) -> list[dict]:
  """Naver Finance 모바일 API로 종목 큐레이션 뉴스 항목을 반환한다."""
  url = f'https://m.stock.naver.com/api/news/stock/{ticker}?pageSize={MAX_NEWS}'
  try:
    resp = requests.get(url, timeout=10, headers=_HTTP_HEADERS)
    resp.raise_for_status()
    groups = resp.json()
    if not isinstance(groups, list):
      return []
    items: list[dict] = []
    for g in groups:
      items.extend(g.get('items', []))
    return items[:MAX_NEWS]
  except Exception as e:
    logger.warning(f'{name_kr}({ticker}) Naver Finance API 오류: {e}')
    return []


def _naver_item_to_row(item: dict, company_id: str) -> dict | None:
  """Naver Finance API item → news 테이블 행으로 변환한다."""
  title = html.unescape((item.get('title') or '').strip())
  url = (item.get('mobileNewsUrl') or '').strip()
  source = (item.get('officeName') or '').strip()
  dt_str = (item.get('datetime') or '').strip()  # YYYYMMDDHHMM
  try:
    published_at = datetime.strptime(dt_str, '%Y%m%d%H%M').replace(tzinfo=_KST).isoformat()
  except (ValueError, TypeError):
    published_at = datetime.now(timezone.utc).isoformat()

  if not title or not url:
    return None

  return {
    'id': str(uuid.uuid4()),
    'company_id': company_id,
    'title': title[:500],
    'url': url[:1000],
    'source': source[:100],
    'summary': '',
    'published_at': published_at,
  }


# ── 한국 비상장사: Google News RSS (회사명 검색) ────────────────


def _fetch_kr_news_google_rss(name_kr: str) -> list[dict]:
  """Google News RSS로 회사명 검색 결과를 반환한다. 자격증명 불필요."""
  query = urllib.parse.quote(name_kr)
  url = f'https://news.google.com/rss/search?q={query}&hl=ko&gl=KR&ceid=KR:ko'
  try:
    resp = requests.get(url, timeout=10, headers=_HTTP_HEADERS)
    resp.raise_for_status()
    root = ET.fromstring(resp.content)
    items = []
    for item in root.findall('.//item')[:MAX_NEWS]:
      title = (item.findtext('title') or '').strip()
      link = (item.findtext('link') or '').strip()
      pub = (item.findtext('pubDate') or '').strip()
      src = item.find('source')
      source = (src.text or '').strip() if src is not None else ''
      desc = (item.findtext('description') or '').strip()
      items.append({'title': title, 'link': link, 'pubDate': pub, 'source': source, 'description': desc})
    return items
  except Exception as e:
    logger.warning(f'{name_kr} Google News RSS 오류: {e}')
    return []


def _google_rss_item_to_row(item: dict, company_id: str) -> dict | None:
  """Google News RSS item → news 테이블 행."""
  title = html.unescape(item.get('title') or '').strip()
  url = (item.get('link') or '').strip()
  source = (item.get('source') or '').strip()
  try:
    published_at = parsedate_to_datetime(item.get('pubDate') or '').astimezone(timezone.utc).isoformat()
  except (TypeError, ValueError):
    published_at = datetime.now(timezone.utc).isoformat()

  if not title or not url:
    return None

  return {
    'id': str(uuid.uuid4()),
    'company_id': company_id,
    'title': title[:500],
    'url': url[:1000],
    'source': source[:100],
    'summary': '',
    'published_at': published_at,
  }


# ── 글로벌 상장사: yfinance ──────────────────────────────────────


def _fetch_news(yf_symbol: str) -> list[dict]:
  """yfinance에서 뉴스 항목 목록을 가져온다."""
  try:
    t = yf.Ticker(yf_symbol)
    raw = t.news or []
    return raw[:MAX_NEWS]
  except Exception as e:
    logger.warning(f'{yf_symbol} 뉴스 수집 오류: {e}')
    return []


def _to_news_row(item: dict, company_id: str) -> dict | None:
  """yfinance 뉴스 아이템을 news 테이블 행으로 변환한다.
  신형(content 중첩) / 구형(flat) 양쪽 포맷을 지원한다."""
  content = item.get('content') or {}
  if content:
    title = content.get('title') or ''
    url = (
      (content.get('canonicalUrl') or {}).get('url')
      or (content.get('clickThroughUrl') or {}).get('url')
      or ''
    )
    source = (content.get('provider') or {}).get('displayName') or ''
    summary = content.get('summary') or ''
    pub_str = content.get('pubDate') or content.get('displayTime') or ''
    try:
      published_at = datetime.fromisoformat(pub_str.replace('Z', '+00:00')).isoformat() if pub_str else datetime.now(timezone.utc).isoformat()
    except ValueError:
      published_at = datetime.now(timezone.utc).isoformat()
  else:
    # 구형 flat 포맷 (하위 호환)
    title = item.get('title') or ''
    url = item.get('link') or item.get('url') or ''
    source = item.get('publisher') or ''
    summary = item.get('summary') or ''
    ts = item.get('providerPublishTime')
    published_at = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else datetime.now(timezone.utc).isoformat()

  if not title or not url:
    return None

  return {
    'id': str(uuid.uuid4()),
    'company_id': company_id,
    'title': title[:500],
    'url': url[:1000],
    'source': source[:100],
    'summary': summary[:1000],
    'published_at': published_at,
  }


def collectNews() -> None:
  client = get_client()

  # active 회사만 (delisted 제외) + 선택적 TARGET_TICKERS 필터
  raw = os.environ.get('TARGET_TICKERS', '').strip()
  target_filter = {t.strip() for t in raw.split(',') if t.strip()}
  q = client.table('companies').select(
    'id,ticker,name_kr,country,market,data_source,status'
  ).eq('status', 'active')
  if target_filter:
    q = q.in_('ticker', list(target_filter))
    logger.info(f'TARGET_TICKERS 필터 적용: {sorted(target_filter)}')
  companies = q.execute().data or []
  logger.info(f'대상 회사 {len(companies)}개')

  # 기존 URL 전체 로드 (Supabase 기본 한도 1000 초과 시 페이지네이션)
  existing_urls: set[str] = set()
  page_size = 1000
  offset = 0
  while True:
    batch = (
      client.table('news')
      .select('url')
      .range(offset, offset + page_size - 1)
      .execute()
      .data
    )
    if not batch:
      break
    existing_urls.update(r['url'] for r in batch)
    if len(batch) < page_size:
      break
    offset += page_size
  logger.info(f'기존 뉴스 URL {len(existing_urls)}건 로드')

  total = 0
  for company in companies:
    ticker = company.get('ticker') or ''
    name = company['name_kr']
    country = company.get('country', '')
    market = company.get('market')
    data_source = company.get('data_source', '')

    rows = []
    is_kr_listed = country == 'KR' and market in ('KOSPI', 'KOSDAQ')
    is_kr_unlisted = country == 'KR' and not market

    if is_kr_listed:
      # 한국 상장사: Naver Finance 모바일 API (종목별 큐레이션)
      naver_items = _fetch_kr_news_naver(ticker, name)
      if not naver_items:
        logger.info(f'{name}({ticker}): 뉴스 없음 (Naver)')
        if SLEEP_SEC > 0:
          time.sleep(SLEEP_SEC)
        continue
      for item in naver_items:
        row = _naver_item_to_row(item, company['id'])
        if row and row['url'] not in existing_urls:
          rows.append(row)
          existing_urls.add(row['url'])
    elif is_kr_unlisted:
      # 한국 비상장사: Google News RSS (회사명 검색)
      g_items = _fetch_kr_news_google_rss(name)
      if not g_items:
        logger.info(f'{name}: 뉴스 없음 (Google RSS)')
        if SLEEP_SEC > 0:
          time.sleep(SLEEP_SEC)
        continue
      for item in g_items:
        row = _google_rss_item_to_row(item, company['id'])
        if row and row['url'] not in existing_urls:
          rows.append(row)
          existing_urls.add(row['url'])
    else:
      # 글로벌 상장사: yfinance
      yf_sym = ticker
      raw_news = _fetch_news(yf_sym)
      if not raw_news:
        logger.info(f'{name}({yf_sym}): 뉴스 없음')
        if SLEEP_SEC > 0:
          time.sleep(SLEEP_SEC)
        continue
      for item in raw_news:
        row = _to_news_row(item, company['id'])
        if row and row['url'] not in existing_urls:
          rows.append(row)
          existing_urls.add(row['url'])

    if rows:
      try:
        client.table('news').upsert(rows, on_conflict='url').execute()
        total += len(rows)
        logger.info(f'{name}({ticker}): {len(rows)}건 저장')
      except Exception as e:
        err_str = str(e)
        if '23505' in err_str:
          logger.warning(f'{name}({ticker}): 중복 URL 충돌 — 건너뜀')
        else:
          logger.error(f'{name}({ticker}): 저장 실패 — {e}')
    else:
      logger.info(f'{name}({ticker}): 신규 뉴스 없음')

    # rate limit 회피 — Naver 모바일 API/yfinance 호출 분산
    if SLEEP_SEC > 0:
      time.sleep(SLEEP_SEC)

  logger.info(f'뉴스 수집 완료 — 총 {total}건')

  # 보존 정책: N일 이전 뉴스 자동 삭제 (DB 누적량 제한)
  if RETENTION_DAYS > 0:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).isoformat()
    try:
      deleted = (
        client.table('news').delete().lt('published_at', cutoff).execute().data
      )
      n = len(deleted) if isinstance(deleted, list) else 0
      logger.info(f'{RETENTION_DAYS}일 이전 뉴스 {n}건 삭제 (cutoff={cutoff[:10]})')
    except Exception as e:
      logger.warning(f'오래된 뉴스 삭제 실패: {e}')


if __name__ == '__main__':
  try:
    collectNews()
  except Exception as e:
    logger.error(f'뉴스 수집 실패: {e}')
    sys.exit(1)
