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

from lib.db import WriteSession

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

# 🔴 «보통명사 사명» 대책 (2026-09-11 실측으로 신설).
#    맨 사명을 구글 뉴스에 던지면 회사와 무관한 기사가 쏟아진다. 지우기 전 실물 확인:
#    용산 1,793건(전량 용산구·용산공원) · 경신 1,571건(「지지율 경신」) ·
#    대승 719건(축구 「대승」) · 나전 217건(나전칠기) · 호원 142건(의정부 호원동).
#    한국 비상장 뉴스 9,699건 중 **6,419건(66%)** 이 이렇게 들어왔다.
#
#    처방은 두 겹이다 — ①질의에 맥락을 실어 애초에 덜 긁어 오고 ②제목에 사명이
#    없는 것을 버린다. A/B/C 를 실제로 던져 재고 고른 형태다(경위 =
#    `docs/gotchas-data-collection.md` 「사명이 보통명사면 뉴스가 통째로 오염된다」).
#
#    ⚠️ **완전히는 못 막는다.** 남는 것은 «동명 타사» 다(㈜세정 = 의류 세정그룹 ·
#    삼송비엔씨 · 일진전기). 사명만으로 법인을 가르는 방법이 없다 — 여기까지가 한계다.
_ROBOT_CTX = '로봇'
_AUTO_CTX = '자동차부품'


def _kr_unlisted_query(name: str, is_robot: bool) -> str:
  """한국 비상장사의 Google News 질의를 만든다.

  두 글자 사명은 **법인 표기**(`(주)X`·`㈜X`)를 맥락어와 **AND 로** 묶는다.
  🔴 `OR` 로 이으면 안 된다 — 실측에서 `"(주)세정" OR "㈜세정" OR "세정 자동차부품"` 은
  20건 전부 **동명 타사**(세정그룹 의류·세정씨푸드·세정이엔지)를 물어 왔다.
  AND 로 묶자 신영·용산·경신·호원·명신·동보·일진이 **전부 진짜 회사 기사**가 됐다
  (`㈜신영, 자동차 차체 제작공장 증설` · `㈜호원 분규로 기아 광주공장 정상화`).

  ⚠️ 대가는 회수율이다 — 세정·삼송·나전은 이 형태로 **0건**이 된다(기사가 법인 표기를
  안 쓴다). 그래도 0건으로 둔다. **대시보드에는 틀린 기사보다 빈칸이 낫다.**

  세 글자 이상은 맥락어만 붙인다. 법인 표기까지 요구하면 오히려 놓친다 —
  기사가 「테솔로,」·「코렌스,」처럼 맨 이름으로 쓰기 때문이다(실측).
  """
  ctx = _ROBOT_CTX if is_robot else _AUTO_CTX
  if len(name) <= 2:
    return f'("(주){name}" OR "㈜{name}") {ctx}'
  return f'"{name}" {ctx}'


def _needs_title_check(name: str) -> bool:
  """제목 필터를 걸 이름인가 — **두 글자 사명만**.

  🔴 세 글자 이상에 걸면 «진짜 뉴스를 떨어뜨린다». 실측에서 기사는 사명을 줄여 쓴다:
  현대성우쏠라이트 → 「쏠라이트」(55/60 탈락) · 타타대우모빌리티 → 「타타대우」 ·
  HL클레무브 → 「HL 클레무브」(공백) · 한국지엠 → 「GM」. 정확 구절 질의가 이미
  본문에 사명이 있는 기사만 물어 오므로, 세 글자 이상은 제목까지 볼 필요가 없다.

  두 글자는 다르다 — 정확 구절도 보통명사와 겹친다(「용산 주택공급」이 그대로 통과).
  """
  return len(name) <= 2


def _title_mentions(title: str, name: str) -> bool:
  """제목에 사명이 있나. 없으면 «그 회사 기사가 아니다»(맥락어에 딸려 온 것)."""
  return name in (title or '')


def _fetch_news_google_rss(name: str, locale: str = 'ko') -> list[dict]:
  """Google News RSS로 회사명 검색 결과를 반환한다. 자격증명 불필요.

  ticker 가 없는 회사(비상장)의 유일한 뉴스 소스다. 한국 비상장사는 한국어로,
  해외 비상장사는 영어로 검색한다 — 영문 사명을 한국어 로케일로 던지면 거의 안 걸린다.
  """
  hl, gl, ceid = ('ko', 'KR', 'KR:ko') if locale == 'ko' else ('en-US', 'US', 'US:en')
  query = urllib.parse.quote(name)
  url = f'https://news.google.com/rss/search?q={query}&hl={hl}&gl={gl}&ceid={ceid}'
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
    logger.warning(f'{name} Google News RSS 오류: {e}')
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
  # WriteSession이 __exit__에서 자동으로 revalidate_for_tables(['news', ...])를 호출한다.
  # select는 추적 안 되고 upsert/delete만 누적되므로 함수 전체를 한 세션으로 감싸도 무방.
  with WriteSession() as w:
    _collect_news_in_session(w)


def _collect_news_in_session(w: WriteSession) -> None:
  # active 회사만 (delisted 제외) + 선택적 TARGET_TICKERS 필터
  raw = os.environ.get('TARGET_TICKERS', '').strip()
  target_filter = {t.strip() for t in raw.split(',') if t.strip()}
  q = w.table('companies').select(
    'id,ticker,name,name_kr,country,market,data_source,status'
  ).eq('status', 'active')
  if target_filter:
    q = q.in_('ticker', list(target_filter))
    logger.info(f'TARGET_TICKERS 필터 적용: {sorted(target_filter)}')
  companies = q.execute().data or []
  logger.info(f'대상 회사 {len(companies)}개')

  # 로봇 회사는 질의 맥락어가 다르다(「자동차부품」이 아니라 「로봇」).
  # 도메인 구분 컬럼이 없어서 `/humanoid` 페이지 매핑을 그 표식으로 쓴다.
  robot_ids = {
    r['company_id']
    for r in (w.table('company_pages').select('company_id').eq('page', 'humanoid').execute().data or [])
  }
  logger.info(f'로봇 도메인 회사 {len(robot_ids)}곳')

  # 기존 URL 전체 로드 (Supabase 기본 한도 1000 초과 시 페이지네이션)
  existing_urls: set[str] = set()
  page_size = 1000
  offset = 0
  while True:
    batch = (
      w.table('news')
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
    # 🔴 비상장은 국적을 가리지 않는다. 예전엔 KR 비상장만 Google RSS 를 타고 나머지는
    #    전부 yfinance 로 갔는데, ticker 가 없으니 무조건 0건이었다(2026-08-25 실측:
    #    Figure AI·Apptronik·Boston Dynamics 등 해외 비상장 전원 뉴스 0건).
    is_unlisted = not market or not ticker

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
    elif is_unlisted:
      # 비상장사: Google News RSS. 국내는 한글 사명·한국어, 해외는 영문 사명·영어.
      if country == 'KR':
        query, locale = _kr_unlisted_query(name, company['id'] in robot_ids), 'ko'
      else:
        query, locale = (company.get('name') or name), 'en'
      g_items = _fetch_news_google_rss(query, locale)
      if not g_items:
        logger.info(f'{name}: 뉴스 없음 (Google RSS)')
        if SLEEP_SEC > 0:
          time.sleep(SLEEP_SEC)
        continue
      dropped = 0
      for item in g_items:
        # 🔴 두 글자 사명은 제목까지 본다 — 정확 구절로도 보통명사가 새어 든다.
        if country == 'KR' and _needs_title_check(name) and not _title_mentions(
          item.get('title') or '', name
        ):
          dropped += 1
          continue
        row = _google_rss_item_to_row(item, company['id'])
        if row and row['url'] not in existing_urls:
          rows.append(row)
          existing_urls.add(row['url'])
      if dropped:
        logger.info(f'{name}: 제목에 사명 없는 {dropped}건 제외')
    else:
      # 글로벌 상장사: yfinance 우선
      yf_sym = ticker
      raw_news = _fetch_news(yf_sym)
      for item in raw_news or []:
        row = _to_news_row(item, company['id'])
        if row and row['url'] not in existing_urls:
          rows.append(row)
          existing_urls.add(row['url'])

      # 🔴 yfinance 가 0건이면 Google News RSS 로 한 번 더 간다(2026-08-25 신설).
      #    실측: 일본·중국·대만 상장사는 yfinance 뉴스가 통째로 비어 있다
      #    (하모닉드라이브·THK·NSK·HIWIN·닝보투오푸 등 15사가 영구 0건이었다).
      #    미국 종목만 채워지는 소스 하나에 의존하면 아시아 부품사는 영영 빈칸이다.
      if not rows:
        # 영문 사명 → 그래도 없으면 한글 사명. 둘 다 시도하는 이유:
        # 🔴 영문 검색은 일본·중국 부품사에서 **60일 보존 정책에 걸릴 만큼 오래된**
        #    기사만 돌려주는 일이 잦다(2026-08-25 실측: 37건 넣고 37건이 정리됨).
        #    이 대시보드는 한국 사용자용이고, 하모닉드라이브·THK 같은 로봇 부품주는
        #    한국 매체가 오히려 최신으로 다룬다.
        for query, locale in ((company.get('name') or name, 'en'), (name, 'ko')):
          if not query:
            continue
          for item in _fetch_news_google_rss(query, locale):
            row = _google_rss_item_to_row(item, company['id'])
            if row and row['url'] not in existing_urls:
              rows.append(row)
              existing_urls.add(row['url'])
          if rows:
            logger.info(
              f'{name}({yf_sym}): yfinance 0건 → Google RSS[{locale}] 폴백 {len(rows)}건')
            break

      if not rows:
        logger.info(f'{name}({yf_sym}): 뉴스 없음')
        if SLEEP_SEC > 0:
          time.sleep(SLEEP_SEC)
        continue

    if rows:
      try:
        w.table('news').upsert(rows, on_conflict='url').execute()
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
        w.table('news').delete().lt('published_at', cutoff).execute().data
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
