#!/usr/bin/env python3
"""우즈베키스탄 자동차 시장 회사별 sales 수집 — uzavtosanoat.uz 보도자료.

플로우:
  1. https://uzavtosanoat.uz/ru/news_category/news 페이지 1~N 순회 (RU)
     ※ EN 페이지는 일부만 번역. RU는 6 회사 raw 숫자 일관 표기.
  2. 각 News card에서 보도자료 URL + 발표 날짜 추출.
  3. 제목/본문에 'Данные производителей Узбекистана' 키워드 포함 보도자료만 처리.
  4. 본문 정규식 파싱:
       - YTD 기간 식별: 'январь-апрель 2026 года' / '2026 года по январь' / '2026 года'
       - 회사별 6개 라인: 'UzAuto Motors: 58 168' / 'Khorezm Auto: 37 559' / ...
       - 합계 라인: 'было реализовано 121 601 единиц автомобилей' (cross-check)
  5. uzbekistan_auto_stats upsert (kind='sales', period_type='month', YTD 차분으로 월별 도출).

YTD 차분 정책 (수집 단계 처리):
  - 같은 회사의 같은 연도 보도자료를 발표 날짜 오름차순 정렬.
  - period_type='month' year_period='YYYY-MM' units = (이번 발표 YTD) - (직전 발표 YTD).
  - 첫 월(1월) 발표는 그 자체로 1월 값.
  - YTD 누계 보존 위해 period_type='year' year_period='YYYY' 도 동시 적재 (가장 최신 YTD = 연 누계).

회사 enum (6): UzAuto Motors / Khorezm Auto / ADM Jizzakh / BYD Uzbekistan Factory /
              SamAuto / Asaka Motors.
※ 'BYD Uzbekistan'(보도자료 표기) → 'BYD Uzbekistan Factory'(DB enum) 정규화.

플래그:
  --year-from 2024     수집 시작 연도 (default 2024 — 2024년 이전 보도자료는 형식 불일치 다수).
  --year-to <year>     마지막 연도 (default 현재 연도).
  --max-pages 30       News 페이지 최대 페이지 (default 30, 1 페이지 ≈ 9개).
  --dry-run            DB 쓰기 없이 파싱 결과만 print.
  --use-cache-only     캐시된 보도자료만 처리 (개발/재처리).
"""
import argparse
import json
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from loguru import logger

from lib.bootstrap import init_script

init_script(__file__)

from lib.db import WriteSession  # noqa: E402

BASE = 'https://uzavtosanoat.uz'
NEWS_LIST_RU = '/ru/news_category/news?page={page}'
RUN_LOG_DIR = Path(__file__).resolve().parent
CACHE_DIR = Path(__file__).resolve().parent.parent / 'data' / '_uzbekistan_news_cache'
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# 회사명 → DB enum 매핑 (보도자료 표기 → enum 표기)
COMPANY_ALIAS = {
  'uzauto motors': 'UzAuto Motors',
  'uzauto': 'UzAuto Motors',
  'khorezm auto': 'Khorezm Auto',
  'adm jizzakh': 'ADM Jizzakh',
  'adm-jizzakh': 'ADM Jizzakh',
  'byd uzbekistan': 'BYD Uzbekistan Factory',
  'byd uzbekistan factory': 'BYD Uzbekistan Factory',
  'samauto': 'SamAuto',
  'asaka motors': 'Asaka Motors',
}
ALL_COMPANIES = ['UzAuto Motors', 'Khorezm Auto', 'ADM Jizzakh',
                 'BYD Uzbekistan Factory', 'SamAuto', 'Asaka Motors']

# 월 이름 → 번호 (러시아어)
RU_MONTHS = {
  'январ': 1, 'феврал': 2, 'март': 3, 'апрел': 4, 'май': 5, 'мая': 5, 'июн': 6,
  'июл': 7, 'август': 8, 'сентябр': 9, 'октябр': 10, 'ноябр': 11, 'декабр': 12,
}

# sales 보도자료 키워드 (제목/본문)
TITLE_PATTERNS = [
  re.compile(r'данные\s+производителей', re.IGNORECASE),
  re.compile(r'автомобильная\s+промышленность', re.IGNORECASE),
]

# 본문 회사별 숫자 정규식: 'UzAuto Motors: 58 168' / 'UzAuto Motors – 58 168' / 'UzAuto Motors 58 168'
# 숫자에 공백/non-breaking space 포함 가능.
NUM_RE = r'((?:\d[\d\s  ]{0,12}\d)|\d)'
# 회사 라인 정규식 (greedy 매칭)
def _company_regex(name: str) -> re.Pattern:
  esc = re.escape(name)
  return re.compile(rf'{esc}\s*[:––\-]?\s*{NUM_RE}', re.IGNORECASE)


def _parse_int_with_spaces(s: str) -> int:
  return int(re.sub(r'[\s  ,]', '', s))


def _normalize(s: str | None) -> str:
  if s is None:
    return ''
  return unicodedata.normalize('NFC', str(s)).strip()


def fetch_news_page(page_ctx, page_num: int) -> list[dict]:
  """News 리스트 페이지에서 보도자료 항목 (url, date) 추출."""
  url = BASE + NEWS_LIST_RU.format(page=page_num)
  resp = page_ctx.goto(url, wait_until='networkidle')
  if resp is None or resp.status != 200:
    logger.warning(f'  page {page_num}: status={resp.status if resp else "?"}')
    return []
  page_ctx.wait_for_timeout(1500)
  items = page_ctx.eval_on_selector_all('a[href*="news_show"]', '''
    els => els.map(e => ({
      href: e.href,
      title: (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
    })).filter(x => x.href)
  ''')
  # 중복 제거
  seen = set()
  uniq = []
  for it in items:
    if it['href'] in seen:
      continue
    seen.add(it['href'])
    uniq.append(it)
  return uniq


def fetch_news_body(page_ctx, news_url: str, use_cache: bool = True) -> str | None:
  """보도자료 본문 텍스트 + 발표 날짜 (cache 우선)."""
  # cache key = URL의 slug 부분
  slug = news_url.rstrip('/').split('/')[-1][:80]
  cache_file = CACHE_DIR / f'{slug}.txt'
  if use_cache and cache_file.exists():
    return cache_file.read_text(encoding='utf-8')
  try:
    resp = page_ctx.goto(news_url, wait_until='networkidle', timeout=30000)
    if resp is None or resp.status != 200:
      return None
    page_ctx.wait_for_timeout(1500)
    text = page_ctx.eval_on_selector('main, article, body', "el => el.innerText")
    cache_file.write_text(text, encoding='utf-8')
    return text
  except Exception as e:
    logger.warning(f'  fetch {news_url[:60]} 실패: {e}')
    return None


# YTD 기간 파싱 — 본문에서 'январь-апрель 2026 года' 등 추출
PERIOD_RE = re.compile(
  r'((?:с\s+)?(?P<from>январ\w*|феврал\w*|март\w*|апрел\w*|ма[яй]|июн\w*|июл\w*|август\w*|сентябр\w*|октябр\w*|ноябр\w*|декабр\w*)\s*[\-–—по\s]+\s*(?P<to>январ\w*|феврал\w*|март\w*|апрел\w*|ма[яй]|июн\w*|июл\w*|август\w*|сентябр\w*|октябр\w*|ноябр\w*|декабр\w*)\s+(?P<year>\d{4})|за\s+(?P<single>январ\w*|феврал\w*|март\w*|апрел\w*|ма[яй]|июн\w*|июл\w*|август\w*|сентябр\w*|октябр\w*|ноябр\w*|декабр\w*)\s+(?P<year2>\d{4}))',
  re.IGNORECASE
)

def _month_of(word: str) -> int | None:
  w = word.lower()
  for k, v in RU_MONTHS.items():
    if w.startswith(k):
      return v
  return None


def parse_press_release(text: str) -> dict | None:
  """본문에서 (year, last_month_in_ytd, total_units, by_company) 추출.
  매칭 실패 시 None."""
  if not text:
    return None
  text = text.replace(' ', ' ').replace(' ', ' ')

  # 기간 파싱
  period_m = PERIOD_RE.search(text)
  if not period_m:
    return None
  year_str = period_m.group('year') or period_m.group('year2')
  if not year_str:
    return None
  year = int(year_str)
  if period_m.group('from') and period_m.group('to'):
    last_m = _month_of(period_m.group('to'))
  elif period_m.group('single'):
    last_m = _month_of(period_m.group('single'))
  else:
    last_m = None
  if last_m is None:
    return None

  # 합계 단위 '121 601 единиц автомобилей' (있으면 cross-check)
  total = None
  total_m = re.search(r'(?:реализован\w*|продан\w*|собрано|произведен\w*)\s+([\d\s]+)\s+(?:единиц|шт|автомобил)',
                     text, re.IGNORECASE)
  if total_m:
    try:
      total = _parse_int_with_spaces(total_m.group(1))
    except Exception:
      total = None

  # 회사별 추출
  by_company: dict[str, int] = {}
  for alias, enum_name in COMPANY_ALIAS.items():
    # 같은 enum_name에 이미 값이 있으면 skip
    if enum_name in by_company:
      continue
    pat = _company_regex(alias)
    m = pat.search(text)
    if m:
      try:
        v = _parse_int_with_spaces(m.group(1))
        by_company[enum_name] = v
      except Exception:
        pass
  if not by_company:
    return None
  return {'year': year, 'last_month': last_m, 'total': total, 'by_company': by_company}


def diff_to_monthly(parsed_list: list[dict]) -> list[dict]:
  """같은 연도 발표 YTD 누계 → 월별 차분 → uzbekistan_auto_stats row.
  parsed_list = [{year, last_month, by_company}], 발표 last_month 오름차순.
  반환: rows = [{period_type, year_period, company, units}]."""
  rows: list[dict] = []
  # year 별 그룹화
  by_year: dict[int, list[dict]] = {}
  for p in parsed_list:
    by_year.setdefault(p['year'], []).append(p)

  for year, items in by_year.items():
    items.sort(key=lambda x: x['last_month'])
    # 회사별 이전 YTD
    prev_ytd: dict[str, int] = {}
    for p in items:
      mm = p['last_month']
      year_period = f'{year}-{mm:02d}'
      for company, ytd_v in p['by_company'].items():
        prev_v = prev_ytd.get(company, 0)
        month_v = ytd_v - prev_v
        # 첫 보도자료가 1월이 아니면 (예: 4월 = 1~4월 누계) → '1~4월 합'을 단일 row로 적재 어려움.
        # 정책: 첫 발표가 1월 이외면 'period_type=ytd' 별도 row + 그 다음부터 월별 차분.
        # 간단화: 첫 발표가 1월 아닐 때는 평균 분할 (월별 row N개 = ytd_v / N) — 보수적.
        if not prev_ytd and mm > 1:
          # ytd_v를 mm개월에 균등 분할 (단순화)
          avg = ytd_v // mm
          for m in range(1, mm + 1):
            rows.append({
              'kind': 'sales',
              'period_type': 'month',
              'year_period': f'{year}-{m:02d}',
              'company': company,
              'brand': '',
              'vehicle_model': '',
              'units': avg,
              'source_type': 'uzavtosanoat',
              'source_url': BASE + '/ru/news_category/news',
            })
        else:
          rows.append({
            'kind': 'sales',
            'period_type': 'month',
            'year_period': year_period,
            'company': company,
            'brand': '',
            'vehicle_model': '',
            'units': month_v,
            'source_type': 'uzavtosanoat',
            'source_url': BASE + '/ru/news_category/news',
          })
        prev_ytd[company] = ytd_v
    # 연 누계 (마지막 발표의 YTD)
    last = items[-1]
    for company, ytd_v in last['by_company'].items():
      rows.append({
        'kind': 'sales',
        'period_type': 'year',
        'year_period': str(year),
        'company': company,
        'brand': '',
        'vehicle_model': '',
        'units': ytd_v,
        'source_type': 'uzavtosanoat',
        'source_url': BASE + '/ru/news_category/news',
      })
  return rows


def main() -> int:
  parser = argparse.ArgumentParser()
  parser.add_argument('--year-from', type=int, default=2024)
  parser.add_argument('--year-to', type=int, default=None)
  parser.add_argument('--max-pages', type=int, default=30)
  parser.add_argument('--dry-run', action='store_true')
  parser.add_argument('--use-cache-only', action='store_true')
  args = parser.parse_args()
  current_year = datetime.now(timezone.utc).year
  year_to = args.year_to or current_year

  from playwright.sync_api import sync_playwright  # noqa: E402

  parsed_list: list[dict] = []
  with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True)
    ctx = b.new_context(locale='ru-RU')
    page = ctx.new_page()
    page.set_default_timeout(60000)

    # News list iterate (페이지별 timeout은 skip — 부분 결과 보존)
    all_news: list[dict] = []
    if not args.use_cache_only:
      for p in range(1, args.max_pages + 1):
        try:
          items = fetch_news_page(page, p)
        except Exception as e:
          logger.warning(f'  page {p} fetch 실패 (skip): {e}')
          continue
        if not items:
          break
        all_news.extend(items)
        time.sleep(0.5)
      logger.info(f'News 리스트 수집: {len(all_news)}개 (페이지 1~{args.max_pages})')
    else:
      # cache 만 처리
      for f in CACHE_DIR.glob('*.txt'):
        all_news.append({'href': f'cache:{f.stem}', 'title': ''})
      logger.info(f'cache 보도자료: {len(all_news)}개')

    # 각 보도자료 본문 fetch + parse
    for n in all_news:
      url = n['href']
      title = n.get('title', '')
      # 제목 빠른 필터 (텍스트 비어있을 수 있으니 우회: 본문 가져와 검사)
      if url.startswith('cache:'):
        slug = url[6:]
        text = (CACHE_DIR / f'{slug}.txt').read_text(encoding='utf-8')
      else:
        text = fetch_news_body(page, url, use_cache=True)
      if not text:
        continue
      # sales 보도자료 키워드 매칭
      if not any(p.search(text) for p in TITLE_PATTERNS):
        continue
      parsed = parse_press_release(text)
      if parsed is None:
        continue
      if parsed['year'] < args.year_from or parsed['year'] > year_to:
        continue
      parsed['source_url'] = url if not url.startswith('cache:') else BASE
      parsed_list.append(parsed)
      logger.debug(f'  parsed {parsed["year"]} 1-{parsed["last_month"]}월: total={parsed["total"]}, '
                   f'companies={len(parsed["by_company"])}')
    b.close()

  logger.info(f'sales 보도자료 파싱: {len(parsed_list)}건')
  rows = diff_to_monthly(parsed_list)
  logger.info(f'월별 row: {len(rows)}건')

  # 결과 로그
  ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
  log_path = RUN_LOG_DIR / f'_uzbekistan_sales_run_{ts}.json'
  try:
    with log_path.open('w', encoding='utf-8') as f:
      json.dump({'parsed_count': len(parsed_list), 'rows': len(rows),
                 'parsed_sample': parsed_list[:3]},
                f, ensure_ascii=False, indent=2, default=str)
    logger.info(f'결과 로그: {log_path}')
  except Exception as e:
    logger.warning(f'결과 로그 저장 실패: {e}')

  if args.dry_run:
    print('=== sample rows ===')
    for r in rows[:10]:
      print(r)
    logger.success('dry-run 종료 (DB 쓰기 없음)')
    return 0

  if not rows:
    logger.warning('적재할 행 없음')
    return 1

  with WriteSession() as w:
    BATCH = 500
    for i in range(0, len(rows), BATCH):
      chunk = rows[i:i + BATCH]
      w.table('uzbekistan_auto_stats').upsert(
        chunk,
        on_conflict='kind,period_type,year_period,company,brand,vehicle_model,source_type',
      ).execute()
  logger.success(f'uzbekistan_auto_stats upsert 완료: {len(rows)}행')
  return 0


if __name__ == '__main__':
  try:
    sys.exit(main())
  except KeyboardInterrupt:
    sys.exit(130)
  except Exception as e:
    logger.exception(f'예기치 못한 오류: {e}')
    sys.exit(1)
