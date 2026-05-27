#!/usr/bin/env python3
"""우즈베키스탄 자동차 production 수집 — stat.uz 산업 보도자료 PDF.

플로우:
  1. stat.uz/ru/press-tsentr/novosti-goskomstata/ 페이지 순회 → 'Промышленное производство' 보도자료 link 수집
  2. 보도자료 HTML 에서 PDF iframe URL 추출
  3. PDF 다운로드 + pdfplumber로 'Количество произведенных автомобилей' 표 파싱
  4. uzbekistan_auto_stats upsert (kind='production', source_type='stat-uz', period_type='month' YTD 누계)

PDF 발표 패턴: 매월 25일 전후 '1~X월 YTD 누계' 1건.

YTD 차분 정책 (uzavtosanoat sales와 동일):
  - 같은 연도 PDF를 last_month 오름차순 정렬
  - 모델별 (YTD 이번) - (YTD 직전) = 월별 production
  - 첫 발표 (1월이 아니면) 평균 분할
  - 연 누계 row (가장 최신 YTD) 동시 적재

모델 정규화:
  - 'Cobalt'/'Damas'/'Tracker'/'Onix' → 그대로 (Chevrolet 브랜드)
  - 'KIA'/'Chery'/'Haval'/'BYD' → 그대로 (브랜드 자체)
  - 'Грузовые автомобили' = LCV (Light Commercial Vehicles) brand에 매핑
  - 'Специализированные автомобили' (특수차) — 사용자 명시: 'Damas/Labo' 통합 처리는 별도 모델

플래그:
  --year-from 2024
  --year-to <year>
  --max-pages 30
  --dry-run
"""
import argparse
import io
import json
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pdfplumber
import requests
from loguru import logger

from lib.bootstrap import init_script

init_script(__file__)

from lib.db import WriteSession  # noqa: E402

BASE = 'https://stat.uz'
NEWS_LIST = '/ru/press-tsentr/novosti-goskomstata'
RUN_LOG_DIR = Path(__file__).resolve().parent
CACHE_DIR = Path(__file__).resolve().parent.parent / 'data' / '_uzbekistan_statuz_cache'
CACHE_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

# 산업 보도자료 키워드 (Russian)
INDUSTRY_TITLE_RE = re.compile(r'промышленное\s+производств', re.IGNORECASE)

# YTD 기간 파싱 (러시아어 1~12월)
RU_MONTHS = {
  'январ': 1, 'феврал': 2, 'март': 3, 'апрел': 4, 'май': 5, 'мая': 5, 'июн': 6,
  'июл': 7, 'август': 8, 'сентябр': 9, 'октябр': 10, 'ноябр': 11, 'декабр': 12,
}
PERIOD_RE = re.compile(
  r'(?:за\s+)?(?P<from>январ\w*|феврал\w*|март\w*|апрел\w*|ма[яй]|июн\w*|июл\w*|август\w*|сентябр\w*|октябр\w*|ноябр\w*|декабр\w*)\s*[\-–—]\s*(?P<to>январ\w*|феврал\w*|март\w*|апрел\w*|ма[яй]|июн\w*|июл\w*|август\w*|сентябр\w*|октябр\w*|ноябр\w*|декабр\w*)\s+(?P<year>\d{4})',
  re.IGNORECASE
)

# 모델 라인 정규식: '"Cobalt"  44 747  53 802' (탭/공백 mix)
MODEL_LINE_RE = re.compile(
  r'[“"](?P<model>Cobalt|Damas|Tracker|Onix|KIA|Chery|Haval|BYD)[”"]\s*([\d\s ]+)\s+([\d\s ]+)',
  re.IGNORECASE
)
# 합계 라인
TRUCK_LINE_RE = re.compile(r'Грузовые\s+автомобили\s+([\d\s]+)\s+([\d\s]+)', re.IGNORECASE)
PC_LINE_RE = re.compile(r'Легковые\s+автомобили\s+([\d\s]+)\s+([\d\s]+)', re.IGNORECASE)
SV_LINE_RE = re.compile(r'Специализированные\s+автомоби\s*ли\s+([\d\s]+)\s+([\d\s]+)', re.IGNORECASE)


def _month_of(word: str) -> int | None:
  w = word.lower()
  for k, v in RU_MONTHS.items():
    if w.startswith(k):
      return v
  return None


def _parse_int_with_spaces(s: str) -> int:
  return int(re.sub(r'[\s  ,]', '', s))


def _nfc(s: str | None) -> str:
  if s is None:
    return ''
  return unicodedata.normalize('NFC', str(s)).strip()


def fetch_news_links(page_num: int) -> list[dict]:
  """News 리스트 페이지에서 '산업 생산' 보도자료 link 수집."""
  url = f'{BASE}{NEWS_LIST}?start={page_num * 20}'  # 20개씩
  try:
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
  except Exception as e:
    logger.warning(f'  page {page_num} fetch 실패: {e}')
    return []
  # 본문 link 정규식 추출
  pattern = re.compile(
    r'<a\s+[^>]*href=["\']([^"\']*/novosti-goskomstata/[^"\']+)["\'][^>]*>([^<]*)</a>',
    re.IGNORECASE
  )
  links = []
  seen = set()
  for href, text in pattern.findall(r.text):
    if href in seen:
      continue
    text_norm = _nfc(text).strip()
    if not INDUSTRY_TITLE_RE.search(text_norm):
      continue
    seen.add(href)
    full = href if href.startswith('http') else f'{BASE}{href}'
    links.append({'href': full, 'title': text_norm})
  return links


def fetch_pdf_url(news_url: str) -> str | None:
  """보도자료 HTML 에서 PDF iframe URL 추출."""
  try:
    r = requests.get(news_url, headers=HEADERS, timeout=30)
    r.raise_for_status()
  except Exception as e:
    logger.warning(f'  fetch {news_url[:60]} 실패: {e}')
    return None
  m = re.search(r'file=([^"\'&]+\.pdf)', r.text)
  if not m:
    return None
  import urllib.parse
  pdf_url = urllib.parse.unquote(m.group(1))
  return pdf_url


def fetch_pdf(pdf_url: str) -> bytes | None:
  """PDF 다운로드 (cache)."""
  slug = re.sub(r'[^a-zA-Z0-9_-]', '_', pdf_url.split('/')[-1])[:80]
  cache_file = CACHE_DIR / slug
  if cache_file.exists():
    return cache_file.read_bytes()
  try:
    r = requests.get(pdf_url, headers=HEADERS, timeout=60)
    r.raise_for_status()
    cache_file.write_bytes(r.content)
    return r.content
  except Exception as e:
    logger.warning(f'  fetch PDF {pdf_url[:60]} 실패: {e}')
    return None


def parse_industry_pdf(pdf_bytes: bytes) -> dict | None:
  """PDF에서 자동차 페이지 텍스트 + YTD 기간 + 모델별 production 추출."""
  with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
    auto_text = ''
    for p in pdf.pages:
      text = p.extract_text() or ''
      if 'автомоб' in text.lower() and ('cobalt' in text.lower() or 'легков' in text.lower()):
        auto_text += '\n' + text
    if not auto_text:
      return None

  # 기간 파싱
  period_m = PERIOD_RE.search(auto_text)
  if not period_m:
    # PDF 첫 페이지에도 기간 있음 — 다시 전체 pdf 확인
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
      first_text = pdf.pages[0].extract_text() or ''
    period_m = PERIOD_RE.search(first_text)
  if not period_m:
    return None
  year = int(period_m.group('year'))
  last_m = _month_of(period_m.group('to'))
  if last_m is None:
    return None

  # 모델별 production
  models: dict[str, int] = {}
  # 모델 row 정규식 — 두 컬럼 값 중 최신 (오른쪽) 사용
  for m in MODEL_LINE_RE.finditer(auto_text):
    name = m.group('model')
    try:
      prev_val = _parse_int_with_spaces(m.group(2))
      cur_val = _parse_int_with_spaces(m.group(3))
      models[name] = cur_val
      models[f'{name}_prev'] = prev_val  # cross-check 용
    except Exception:
      continue

  # Грузовые/Легковые/Специализированные
  tm = TRUCK_LINE_RE.search(auto_text)
  if tm:
    try:
      models['Грузовые'] = _parse_int_with_spaces(tm.group(2))
    except Exception:
      pass
  pm = PC_LINE_RE.search(auto_text)
  if pm:
    try:
      models['Легковые'] = _parse_int_with_spaces(pm.group(2))
    except Exception:
      pass
  sv = SV_LINE_RE.search(auto_text)
  if sv:
    try:
      # 사용자 명시: 'Damas/Labo' 통합 (Specialized + Damas)
      models['Специализированные'] = _parse_int_with_spaces(sv.group(2))
    except Exception:
      pass

  return {'year': year, 'last_month': last_m, 'models': models}


def diff_to_monthly(parsed: list[dict]) -> list[dict]:
  """YTD 차분 → 월별 row + 연 누계 row."""
  rows: list[dict] = []
  by_year: dict[int, list[dict]] = {}
  for p in parsed:
    by_year.setdefault(p['year'], []).append(p)
  for year, items in by_year.items():
    items.sort(key=lambda x: x['last_month'])
    prev_ytd: dict[str, int] = {}
    for p in items:
      mm = p['last_month']
      year_period = f'{year}-{mm:02d}'
      for model, ytd_v in p['models'].items():
        if model.endswith('_prev'):
          continue  # cross-check 용
        prev_v = prev_ytd.get(model, 0)
        month_v = ytd_v - prev_v
        # 'Damas' + 'Специализированные' → 'Damas/Labo' 통합 (사용자 명시)
        # Грузовые → 'LCV', Легковые → 합계 (적재 skip), 그 외 → 모델명 그대로
        if model == 'Грузовые':
          db_brand, db_model = 'LCV', ''
        elif model == 'Легковые':
          continue  # 합계 row — 모델별 SUM에서 도출 가능
        elif model in ('Damas', 'Специализированные'):
          db_brand, db_model = 'Chevrolet', 'Damas/Labo'
        elif model in ('Cobalt', 'Tracker', 'Onix'):
          db_brand, db_model = 'Chevrolet', model
        else:
          db_brand, db_model = model, ''
        # 평균 분할 (첫 발표가 1월 아니고 prev 없으면)
        if not prev_ytd and mm > 1:
          avg = ytd_v // mm
          for m in range(1, mm + 1):
            rows.append({
              'kind': 'production',
              'period_type': 'month',
              'year_period': f'{year}-{m:02d}',
              'company': '',
              'brand': db_brand,
              'vehicle_model': db_model,
              'units': avg,
              'source_type': 'stat-uz',
              'source_url': BASE + NEWS_LIST,
            })
        else:
          rows.append({
            'kind': 'production',
            'period_type': 'month',
            'year_period': year_period,
            'company': '',
            'brand': db_brand,
            'vehicle_model': db_model,
            'units': month_v,
            'source_type': 'stat-uz',
            'source_url': BASE + NEWS_LIST,
          })
        prev_ytd[model] = ytd_v

    # 연 누계 (마지막 YTD)
    last = items[-1]
    for model, ytd_v in last['models'].items():
      if model.endswith('_prev') or model == 'Легковые':
        continue
      if model == 'Грузовые':
        db_brand, db_model = 'LCV', ''
      elif model in ('Damas', 'Специализированные'):
        db_brand, db_model = 'Chevrolet', 'Damas/Labo'
      elif model in ('Cobalt', 'Tracker', 'Onix'):
        db_brand, db_model = 'Chevrolet', model
      else:
        db_brand, db_model = model, ''
      rows.append({
        'kind': 'production',
        'period_type': 'year',
        'year_period': str(year),
        'company': '',
        'brand': db_brand,
        'vehicle_model': db_model,
        'units': ytd_v,
        'source_type': 'stat-uz',
        'source_url': BASE + NEWS_LIST,
      })
  # dedupe (PK 충돌 시 합산)
  by_pk: dict[tuple, dict] = {}
  for r in rows:
    pk = (r['kind'], r['period_type'], r['year_period'], r['company'], r['brand'],
          r['vehicle_model'], r['source_type'])
    cur = by_pk.get(pk)
    if cur is None:
      by_pk[pk] = dict(r)
    else:
      cur['units'] += r['units']
  return list(by_pk.values())


def main() -> int:
  parser = argparse.ArgumentParser()
  parser.add_argument('--year-from', type=int, default=2024)
  parser.add_argument('--year-to', type=int, default=None)
  parser.add_argument('--max-pages', type=int, default=30)
  parser.add_argument('--dry-run', action='store_true')
  args = parser.parse_args()
  year_to = args.year_to or datetime.now(timezone.utc).year

  # News links iterate
  all_links: list[dict] = []
  for p in range(args.max_pages):
    items = fetch_news_links(p)
    if not items and p > 0:
      break
    all_links.extend(items)
    time.sleep(0.3)
  logger.info(f'산업 보도자료 link: {len(all_links)}개')

  parsed_list: list[dict] = []
  for n in all_links:
    pdf_url = fetch_pdf_url(n['href'])
    if not pdf_url:
      continue
    pdf_bytes = fetch_pdf(pdf_url)
    if not pdf_bytes:
      continue
    parsed = parse_industry_pdf(pdf_bytes)
    if parsed is None:
      continue
    if parsed['year'] < args.year_from or parsed['year'] > year_to:
      continue
    parsed['news_url'] = n['href']
    parsed_list.append(parsed)
    logger.debug(f'  parsed {parsed["year"]} 1-{parsed["last_month"]}월: '
                 f'models={list(parsed["models"].keys())}')

  logger.info(f'산업 PDF 파싱: {len(parsed_list)}건')
  rows = diff_to_monthly(parsed_list)
  logger.info(f'적재 row: {len(rows)}건')

  ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
  log_path = RUN_LOG_DIR / f'_uzbekistan_production_run_{ts}.json'
  try:
    with log_path.open('w', encoding='utf-8') as f:
      json.dump({'parsed_count': len(parsed_list), 'rows': len(rows),
                 'sample_parsed': parsed_list[:2]},
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
