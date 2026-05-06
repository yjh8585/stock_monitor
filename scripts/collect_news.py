#!/usr/bin/env python3
"""
21개사 최신 뉴스를 수집해 news 테이블에 upsert한다.
- 글로벌(yfinance): Ticker.news → 최근 20건
- 한국 상장사(yfinance): {ticker}.KS 심볼로 최근 20건
- 비상장사(DART 소스): 수집 생략
"""
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client

MAX_NEWS = 20  # 회사당 최대 수집 건수


def _yf_ticker(ticker: str, country: str, market: str | None) -> str:
  """DB ticker → yfinance 조회용 심볼 반환."""
  if country == 'KR' and market in ('KOSPI', 'KOSDAQ'):
    suffix = 'KS' if market == 'KOSPI' else 'KQ'
    return f'{ticker}.{suffix}'
  return ticker


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
  # 신형 yfinance 뉴스 포맷 처리 (content 중첩)
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
  companies = client.table('companies').select('id,ticker,name_kr,country,market,data_source').execute().data

  # 기존 URL 전체 로드 (회사 구분 없이 전역 중복 방지)
  existing_urls: set[str] = {
    r['url']
    for r in client.table('news').select('url').execute().data
  }
  logger.info(f'기존 뉴스 URL {len(existing_urls)}건 로드')

  total = 0
  for company in companies:
    ticker = company.get('ticker') or ''
    name = company['name_kr']
    country = company.get('country', '')
    market = company.get('market')
    data_source = company.get('data_source', '')

    # 비상장사(DART) 또는 거래소 없으면 스킵
    if data_source == 'dart' or not market:
      logger.debug(f'{name}: 비상장/비대상 — 뉴스 스킵')
      continue

    yf_sym = _yf_ticker(ticker, country, market)
    raw_news = _fetch_news(yf_sym)
    if not raw_news:
      logger.info(f'{name}({yf_sym}): 뉴스 없음')
      continue

    rows = []
    for item in raw_news:
      row = _to_news_row(item, company['id'])
      if row and row['url'] not in existing_urls:
        rows.append(row)
        existing_urls.add(row['url'])  # 이번 배치 내 중복도 방지

    if rows:
      client.table('news').insert(rows).execute()
      total += len(rows)
      logger.info(f'{name}({yf_sym}): {len(rows)}건 저장')
    else:
      logger.info(f'{name}({yf_sym}): 신규 뉴스 없음')

  logger.info(f'뉴스 수집 완료 — 총 {total}건')


if __name__ == '__main__':
  try:
    collectNews()
  except Exception as e:
    logger.error(f'뉴스 수집 실패: {e}')
    sys.exit(1)
