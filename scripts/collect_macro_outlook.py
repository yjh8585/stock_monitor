#!/usr/bin/env python3
"""
미국 경기소비재·자동차 OEM·딜러·물류 12개 회사의 최근 뉴스 헤드라인과 SEC EDGAR 8-K 공시를
한 번에 수집해 Claude API로 '미국 경제 전체에 대한 한국어 10줄 요약 + 종합 sentiment'를 생성하고
macro_outlook_notes 테이블에 source='US_ECONOMY'로 단일 행 upsert한다.

(source, note_date) UNIQUE 제약으로 같은 날짜 재실행 시 갱신.
"""
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
import yfinance as yf
from anthropic import Anthropic
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import upsert_rows
from lib.macro_targets import allTickers

ANTHROPIC_MODEL = os.environ.get('MACRO_OUTLOOK_MODEL', 'claude-haiku-4-5-20251001')
NEWS_LIMIT = 8
EDGAR_LIMIT = 5
EDGAR_LOOKBACK_MONTHS = 6
EDGAR_HEADERS = {
  'User-Agent': 'stock_monitor macro_outlook collector contact@example.com',
  'Accept': 'application/json',
}
KST = timezone(timedelta(hours=9))
ECONOMY_SOURCE_KEY = 'US_ECONOMY'


def _fetchYfNews(ticker: str) -> list[dict]:
  """yfinance의 최근 뉴스 헤드라인 N개를 반환한다."""
  try:
    raw = yf.Ticker(ticker).news or []
  except Exception as e:
    logger.warning(f"{ticker}: yfinance.news 실패 — {e}")
    return []

  rows = []
  for item in raw[:NEWS_LIMIT]:
    content = item.get('content') if isinstance(item.get('content'), dict) else item
    title = content.get('title') or item.get('title')
    publisher = (
      content.get('provider', {}).get('displayName')
      if isinstance(content.get('provider'), dict)
      else content.get('publisher') or item.get('publisher')
    )
    pub_date = content.get('pubDate') or content.get('providerPublishTime') or item.get('providerPublishTime')
    if isinstance(pub_date, int):
      pub_date = datetime.fromtimestamp(pub_date, tz=timezone.utc).isoformat()
    if not title:
      continue
    rows.append({'title': title, 'publisher': publisher, 'pubDate': pub_date})
  return rows


def _fetchEdgar8K(ticker: str, cik_map: dict[str, str]) -> list[dict]:
  """SEC EDGAR에서 최근 6개월 8-K filing metadata 목록을 반환한다."""
  cik = cik_map.get(ticker.upper())
  if not cik:
    return []
  try:
    url = f'https://data.sec.gov/submissions/CIK{cik}.json'
    resp = requests.get(url, headers=EDGAR_HEADERS, timeout=30)
    resp.raise_for_status()
    recent = resp.json().get('filings', {}).get('recent', {})
    forms = recent.get('form', [])
    dates = recent.get('filingDate', [])
    items_l = recent.get('items', [])
    primary = recent.get('primaryDocDescription', [])
    cutoff = (date.today() - timedelta(days=30 * EDGAR_LOOKBACK_MONTHS)).isoformat()
    out = []
    for i, form in enumerate(forms):
      if form != '8-K':
        continue
      filed = dates[i] if i < len(dates) else ''
      if filed < cutoff:
        continue
      out.append({
        'filed_at': filed,
        'items': items_l[i] if i < len(items_l) else '',
        'description': primary[i] if i < len(primary) else '',
      })
      if len(out) >= EDGAR_LIMIT:
        break
    return out
  except Exception as e:
    logger.warning(f"{ticker}: EDGAR 호출 실패 — {e}")
    return []


def _loadCikMap() -> dict[str, str]:
  """EDGAR ticker→CIK 매핑 한 번만 로드."""
  url = 'https://www.sec.gov/files/company_tickers.json'
  try:
    resp = requests.get(url, headers=EDGAR_HEADERS, timeout=30)
    resp.raise_for_status()
    return {row['ticker'].upper(): str(row['cik_str']).zfill(10) for row in resp.json().values()}
  except Exception as e:
    logger.warning(f"EDGAR CIK 매핑 로드 실패 — {e}")
    return {}


def _buildDigest(payload: dict[str, dict]) -> str:
  """카테고리별로 그룹핑된 회사 데이터를 Claude 프롬프트용 텍스트로 변환."""
  by_category: dict[str, list[str]] = {}
  for ticker, info in payload.items():
    cat = info['category']
    name_kr = info['name_kr']
    news_lines = [
      f"  - [{n.get('pubDate', '')[:10]}] {n['title']} ({n.get('publisher') or '-'})"
      for n in info['news']
    ] or ['  - (뉴스 없음)']
    filing_lines = [
      f"  - [{f['filed_at']}] 8-K items={f['items'] or '-'} ({f['description'] or '-'})"
      for f in info['filings']
    ] or ['  - (최근 8-K 없음)']
    block = (
      f"\n### {name_kr} ({ticker})\n"
      f"[뉴스 헤드라인]\n" + '\n'.join(news_lines) + '\n'
      + "[8-K 공시]\n" + '\n'.join(filing_lines)
    )
    by_category.setdefault(cat, []).append(block)
  parts: list[str] = []
  for cat, blocks in by_category.items():
    parts.append(f"\n## {cat}")
    parts.extend(blocks)
  return '\n'.join(parts).strip()


def _summarizeEconomy(client: Anthropic, digest: str) -> dict | None:
  """12개 회사 시그널을 종합해 미국 경제 전반의 10줄 요약과 sentiment를 생성한다."""
  prompt = f"""당신은 미국 경제 거시 분석가입니다. 아래는 미국 경기소비재(WMT/TGT/COST), 자동차 OEM(F/GM/STLA), 자동차 딜러(AN/ABG/LAD), 물류(FDX/UPS/CASS) 총 12개 상장사의 최근 뉴스 헤드라인과 SEC EDGAR 8-K 공시 목록입니다.

이 시그널들을 모두 종합해 **앞으로의 미국 경제 전반의 흐름**을 한국어로 정확히 10줄로 요약하세요.
- 개별 회사의 자질구레한 사건이 아니라 **거시 시그널**에 초점: 소비 둔화·확장, 인플레이션·디플레이션 압력, 가계 지출 트렌드, 자동차 수요·재고·가격, 물류량·운임 추세, 고용·임금, 금리·달러 환경 등.
- 회사명은 보강 근거로만 짧게 언급해도 좋지만 핵심은 거시 결론입니다.
- 각 줄은 완결된 문장으로 작성. 줄 사이는 줄바꿈(\\n)으로 구분.
- 정확히 10줄. 더하거나 빼지 마세요.

그리고 전체 톤을 'bullish' / 'neutral' / 'bearish' 중 하나로 분류하세요.

응답은 반드시 아래 JSON 형식으로만 출력. 다른 텍스트·코드펜스 금지:
{{"summary": "한 줄\\n두 줄\\n... 10번째 줄", "sentiment": "bullish|neutral|bearish"}}

[입력 데이터]
{digest}
"""
  try:
    msg = client.messages.create(
      model=ANTHROPIC_MODEL,
      max_tokens=2000,
      messages=[{'role': 'user', 'content': prompt}],
    )
    raw = msg.content[0].text if msg.content else ''
  except Exception as e:
    logger.error(f"Claude 호출 실패 — {e}")
    return None

  text = raw.strip()
  if text.startswith('```'):
    text = text.split('```', 2)[1]
    if text.startswith('json'):
      text = text[4:]
    text = text.strip('` \n')
  try:
    parsed = json.loads(text)
    summary = (parsed.get('summary') or '').strip()
    sentiment = (parsed.get('sentiment') or 'neutral').strip().lower()
    if sentiment not in ('bullish', 'neutral', 'bearish'):
      sentiment = 'neutral'
    if not summary:
      return None
    return {'summary': summary, 'sentiment': sentiment}
  except json.JSONDecodeError as e:
    logger.error(f"Claude 응답 JSON 파싱 실패 — {e} / raw={raw[:300]}")
    return None


def collectMacroOutlook() -> None:
  """12개 ticker 데이터를 모두 모아 단일 미국 경제 통합 요약을 생성·적재한다."""
  api_key = os.environ.get('ANTHROPIC_API_KEY')
  if not api_key:
    logger.error('ANTHROPIC_API_KEY 환경변수 미설정')
    sys.exit(1)
  client = Anthropic(api_key=api_key)

  cik_map = _loadCikMap()
  payload: dict[str, dict] = {}
  for category, ticker, name_kr in allTickers():
    logger.info(f"{ticker} ({name_kr}) 수집")
    news = _fetchYfNews(ticker)
    filings = _fetchEdgar8K(ticker, cik_map)
    if not news and not filings:
      logger.warning(f"{ticker}: 데이터 없음 — 묶음에서 제외")
      continue
    payload[ticker] = {
      'category': category,
      'name_kr': name_kr,
      'news': news,
      'filings': filings,
    }

  if not payload:
    logger.error('수집된 데이터가 없어 요약을 생성하지 않습니다.')
    return

  digest = _buildDigest(payload)
  logger.info(f"종합 요약 생성 — {len(payload)}개 회사, prompt {len(digest)} chars")
  result = _summarizeEconomy(client, digest)
  if not result:
    logger.error('요약 실패')
    sys.exit(1)

  today = datetime.now(KST).date().isoformat()
  row = {
    'source': ECONOMY_SOURCE_KEY,
    'note_date': today,
    'summary': result['summary'],
    'sentiment': result['sentiment'],
  }
  upsert_rows('macro_outlook_notes', [row], 'source,note_date')
  logger.info(f"US_ECONOMY {today} {result['sentiment']} upsert 완료")


if __name__ == '__main__':
  try:
    collectMacroOutlook()
  except Exception as e:
    logger.error(f"macro_outlook 수집 실패: {e}")
    sys.exit(1)
