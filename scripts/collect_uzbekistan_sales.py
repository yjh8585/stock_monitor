#!/usr/bin/env python3
"""우즈베키스탄 자동차 회사별 실적 수집 — uzavtosanoat.uz 보도자료 (판매 + 생산).

플로우:
  1. https://uzavtosanoat.uz/ru/news_category/news 페이지 1~N 순회 (RU)
     ※ EN 페이지는 일부만 번역. RU는 회사별 raw 숫자 일관 표기.
  2. 각 News card에서 보도자료 URL + 발표 날짜 추출.
  3. 제목/본문에 'Данные производителей Узбекистана' 키워드 포함 보도자료만 처리.
  4. 본문 정규식 파싱 (관련뉴스 푸터 제거 후):
       - YTD 기간 식별: 'январь-апрель 2026 года' / 'январь 2025 года'
       - 회사별 라인: 'UzAuto Motors: 58 168' / 'UzAuto Motors — 144 822' / ... (구분자 : – — - 혼용)
       - 합계 라인: 'было реализовано 121 601 единиц автомобилей' (cross-check)
  5. uzbekistan_auto_stats upsert (kind 분류 + period_type='month'/'year', YTD 차분).

생산/판매 분류 (사용자 명시 — 절대 혼합 금지):
  - 'реализовано'(판매) → kind='sales'
  - 'выпущено' / 'произведено' / 'собрано'(생산) → kind='production'
  ※ 같은 uzavtosanoat 보도자료라도 용어에 따라 kind를 분리 적재. 월말/연말 보고가
    'произведено'(생산)로 나오는 경우가 있어 연도가 아닌 본문 용어로 판정한다.

YTD 차분 정책 (수집 단계 처리):
  - 같은 (kind, year) 보도자료를 발표 월(last_month) 오름차순 정렬, 회사별 타임라인 구성.
  - period_type='month': (이번 YTD - 직전 YTD) / (구간 월수) 로 누락월 균등 분배 (lumping 제거).
  - 첫 발표가 N월(>1)이면 1~N월에 균등 분배 (모든 회사 동일 적용).
  - period_type='year': 회사별 마지막 발표 YTD (가장 최신 누계). 부분연도면 partial(라벨은 source.ts).

회사 enum (7): UzAuto Motors / Khorezm Auto / ADM Jizzakh / BYD Uzbekistan Factory /
              SamAuto / Asaka Motors / Jizzakh Auto.
※ 'BYD Uzbekistan'(보도자료 표기) → 'BYD Uzbekistan Factory'(DB enum) 정규화.

플래그:
  --year-from 2024     수집 시작 연도 (default 2024).
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
# ⚠ 'adm jizzakh'는 'jizzakh auto'보다 먼저 — 'jizzakh' 부분일치 오매핑 방지 (별도 alias이므로 무관하나 명시).
COMPANY_ALIAS = {
  'uzauto motors': 'UzAuto Motors',
  'uzauto': 'UzAuto Motors',
  'khorezm auto': 'Khorezm Auto',
  'adm jizzakh': 'ADM Jizzakh',
  'adm-jizzakh': 'ADM Jizzakh',
  'byd uzbekistan factory': 'BYD Uzbekistan Factory',
  'byd uzbekistan': 'BYD Uzbekistan Factory',
  'завод byd в узбекистане': 'BYD Uzbekistan Factory',  # 러시아어 표기 변형
  'samauto': 'SamAuto',
  'asaka motors': 'Asaka Motors',
  'jizzakh auto': 'Jizzakh Auto',
  'alyans auto': 'Alyans Auto',
}
ALL_COMPANIES = ['UzAuto Motors', 'Khorezm Auto', 'ADM Jizzakh', 'BYD Uzbekistan Factory',
                 'SamAuto', 'Asaka Motors', 'Jizzakh Auto', 'Alyans Auto']

# 생산/판매 분류 (본문 용어 → kind). 사용자 명시: 생산/판매 절대 혼합 금지.
# 판매: реализовано / продано. 생산: выпущено / произведено / собрано.
SALES_VERB_RE = re.compile(r'реализован|продан', re.IGNORECASE)
PRODUCTION_VERB_RE = re.compile(r'выпущен|произведен|собрано', re.IGNORECASE)

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
# 회사 라인 정규식 (greedy 매칭). 구분자: 콜론/하이픈/en-dash(–)/em-dash(—)/figure-dash/minus 혼용.
_SEP = '[:\\-‒–—−]'
def _company_regex(name: str) -> re.Pattern:
  esc = re.escape(name)
  # 이름 뒤 각주 별표(*)·공백·구분자 허용: 'BYD Uzbekistan Factory* — 11 580'
  return re.compile(rf'{esc}\*?\s*{_SEP}?\s*{NUM_RE}', re.IGNORECASE)


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


def _trim_footer(text: str) -> str:
  """본문 하단의 '관련 뉴스'/'카테고리'/발행정보 푸터 제거 — 다른 기사 기간·숫자 오염 방지."""
  markers = ['\nevent', 'Подпишитесь', 'Похожие новости', 'ПОДПИСАТЬСЯ', 'Категории\n',
             'Поделиться', 'Подробности можно найти']
  cut = len(text)
  for mk in markers:
    idx = text.find(mk)
    if idx != -1:
      cut = min(cut, idx)
  return text[:cut]


def parse_press_release(text: str) -> dict | None:
  """본문에서 (kind, year, last_month, total, by_company) 추출.
  kind는 본문 용어로 판정 (реализовано=sales / выпущено·произведено=production). 실패 시 None."""
  if not text:
    return None
  text = text.replace(' ', ' ').replace(' ', ' ')

  text = _trim_footer(text)

  # 생산/판매 분류 (본문 용어). 판매 우선 — 'реализовано'가 있으면 sales.
  if SALES_VERB_RE.search(text):
    kind = 'sales'
  elif PRODUCTION_VERB_RE.search(text):
    kind = 'production'
  else:
    return None

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
  return {'kind': kind, 'year': year, 'last_month': last_m, 'total': total, 'by_company': by_company}


def diff_to_monthly(parsed_list: list[dict]) -> list[dict]:
  """(kind, year)별 YTD 누계 → 월별 차분 + 연 누계 row. 생산/판매는 kind로 분리.

  - 회사별 (last_month → YTD) 타임라인을 만들고 인접 발표 간 차분.
  - 누락월: delta를 구간 월수로 균등 분배 (나머지는 마지막 달) → lumping 제거, 합계 보존.
  - 첫 발표가 N월(>1, prev=0): 1~N월 균등 분배 (모든 회사 동일 적용).
  - period_type='year' = 회사별 마지막 YTD (= 월별 합과 정확히 일치).
  parsed_list = [{kind, year, last_month, by_company}]."""
  rows: list[dict] = []
  src = BASE + '/ru/news_category/news'
  groups: dict[tuple[str, int], list[dict]] = {}
  for p in parsed_list:
    groups.setdefault((p['kind'], p['year']), []).append(p)

  for (kind, year), items in groups.items():
    # 회사별 (last_month → ytd) — 같은 달 중복 발표는 최신값으로 덮음
    timeline: dict[str, dict[int, int]] = {}
    for p in sorted(items, key=lambda x: x['last_month']):
      for company, ytd_v in p['by_company'].items():
        timeline.setdefault(company, {})[p['last_month']] = ytd_v

    for company, points in timeline.items():
      prev_m, prev_ytd = 0, 0
      for m in sorted(points):
        ytd_v = points[m]
        span = m - prev_m
        if span <= 0:  # 같은 달 재발표(정정) — 최신값만 반영, 월 분배 생략
          prev_ytd = ytd_v
          continue
        delta = ytd_v - prev_ytd
        base = delta // span  # 구간 균등 분배
        rem = delta - base * span  # 나머지는 마지막 달에 (합계 = delta 정확 보존)
        for mm in range(prev_m + 1, m + 1):
          rows.append({
            'kind': kind, 'period_type': 'month', 'year_period': f'{year}-{mm:02d}',
            'company': company, 'brand': '', 'vehicle_model': '',
            'units': base + (rem if mm == m else 0),
            'source_type': 'uzavtosanoat', 'source_url': src,
          })
        prev_m, prev_ytd = m, ytd_v
      # 연 누계 (회사별 마지막 발표 YTD)
      last_m = max(points)
      rows.append({
        'kind': kind, 'period_type': 'year', 'year_period': str(year),
        'company': company, 'brand': '', 'vehicle_model': '', 'units': points[last_m],
        'source_type': 'uzavtosanoat', 'source_url': src,
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
