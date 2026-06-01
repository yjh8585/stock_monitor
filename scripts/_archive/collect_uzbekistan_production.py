#!/usr/bin/env python3
"""우즈베키스탄 자동차 production 수집 — stat.uz 산업 보도자료 PDF.

플로우:
  1. stat.uz/ru/press-tsentr/novosti-goskomstata/ 페이지 순회 → 'Промышленное производство' 보도자료 link 수집
  2. 보도자료 HTML 에서 PDF iframe URL 추출
  3. PDF 다운로드 + pdfplumber로 'Количество произведенных автомобилей' 표 파싱
  4. uzbekistan_auto_stats upsert (kind='production', source_type='stat-uz', period_type='ytd')

PDF 표 구조 (중요 — 차분 불가):
  'Количество произведенных автомобилей ... за январь-N, шт.'
  | Промышленная продукция | <전년> год | <당년> год |   ← 두 컬럼은 동일 1~N월 YTD의 전년/당년
  | "Cobalt"               | 44 747     | 53 802     |
  → 한 PDF = 1~N월 누계(YTD)의 당년·전년 동기 비교. 인접 발표 간 차분이 아니므로
    period_type='ytd', year_period='YYYY-MM'(=당년-N월, 전년-N월)로 모델별 스냅샷 적재.

천단위 표기: 공백 구분('53 802'=53802). 컬럼 구분도 공백이라 정규식이 마지막 3자리만
  뽑던 버그(53802→802) 수정 — 숫자 토큰을 '\\d{1,3}(?: \\d{3})*'로 명시.

모델 정규화 (사용자 명시):
  - 'Cobalt'/'Tracker'/'Onix' → Chevrolet 브랜드
  - 'Damas' + 'Специализированные'(특수차) → Chevrolet 'Damas/Labo' 합산 (같은 라인 변형)
  - 'KIA'/'Chery'/'Haval'/'BYD' → 브랜드 자체
  - 'Грузовые автомобили' → LCV (Light Commercial Vehicles)
  - 'Легковые автомобили' = 승용 합계 → 적재 skip (모델 합으로 도출, cross-check만)

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
_MONTH_ALT = r'январ\w*|феврал\w*|март\w*|апрел\w*|ма[яй]|июн\w*|июл\w*|август\w*|сентябр\w*|октябр\w*|ноябр\w*|декабр\w*'
# 표 제목의 기간 (연도 인라인 없을 수 있음): 'за январь-апрель, шт'
MONTH_RANGE_RE = re.compile(rf'(?P<from>{_MONTH_ALT})\s*[\-–—]\s*(?P<to>{_MONTH_ALT})', re.IGNORECASE)
# 컬럼 헤더의 두 연도: '2025 год¹⁾ 2026 год' → (전년, 당년)
YEARS_RE = re.compile(r'(\d{4})\s*год\D{0,8}?(\d{4})\s*год', re.IGNORECASE)

# 천단위 공백 숫자 토큰 — '53 802'=53802, '135 367'=135367. nbsp/narrow-nbsp 포함.
_N = r'(\d{1,3}(?:[\s  ]\d{3})*)'
# 모델 라인: '"Cobalt" 44 747 53 802' — (전년, 당년) 두 컬럼.
MODEL_LINE_RE = re.compile(
  rf'["“”«»]?(?P<model>Cobalt|Damas|Tracker|Onix|KIA|Chery|Haval|BYD)["“”«»]?\s+{_N}\s+{_N}',
  re.IGNORECASE
)
TRUCK_LINE_RE = re.compile(rf'Грузовые\s+автомобили\s+{_N}\s+{_N}', re.IGNORECASE)
PC_LINE_RE = re.compile(rf'Легковые\s+автомобили\s+{_N}\s+{_N}', re.IGNORECASE)
SV_LINE_RE = re.compile(rf'Специализированные\s+автомоби\s*ли\s+{_N}\s+{_N}', re.IGNORECASE)


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


# 모델명 → (brand, vehicle_model) 매핑. Damas/Специализированные는 별도 합산.
def _map_model(name: str) -> tuple[str, str]:
  if name in ('Cobalt', 'Tracker', 'Onix'):
    return ('Chevrolet', name)
  return (name, '')  # KIA/Chery/Haval/BYD → 브랜드 자체


def parse_industry_pdf(pdf_bytes: bytes) -> dict | None:
  """PDF 자동차 표에서 (당년/전년, 1~N월, 모델별 prev·cur YTD) 추출.

  반환: {'cur_year', 'prior_year', 'last_month', 'rows': [(brand, model, prev, cur)]}
  표 두 컬럼 = 동일 1~N월의 전년·당년 YTD (차분 아님). 천단위 공백 보존.
  """
  with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
    auto_text = ''
    first_text = pdf.pages[0].extract_text() or '' if pdf.pages else ''
    for p in pdf.pages:
      text = p.extract_text() or ''
      if 'автомоб' in text.lower() and ('cobalt' in text.lower() or 'легков' in text.lower()):
        auto_text += '\n' + text
  if not auto_text:
    return None

  # 기간(월) — 'за январь-апрель, шт'
  mr = MONTH_RANGE_RE.search(auto_text)
  last_m = _month_of(mr.group('to')) if mr else None
  if last_m is None:
    return None

  # 두 연도 — 컬럼 헤더 '2025 год 2026 год'. 없으면 첫 페이지/발행일로 추정.
  ym = YEARS_RE.search(auto_text) or YEARS_RE.search(first_text)
  if ym:
    prior_year, cur_year = int(ym.group(1)), int(ym.group(2))
  else:
    dm = re.search(r'(\d{2})\.(\d{2})\.(\d{4})', first_text)  # 'Дата выпуска: 26.05.2026'
    if not dm:
      return None
    cur_year = int(dm.group(3))
    prior_year = cur_year - 1
  if cur_year <= prior_year:
    cur_year, prior_year = prior_year, cur_year

  # 모델별 (prev, cur)
  out: list[tuple[str, str, int, int]] = []
  damas_prev = damas_cur = 0
  for m in MODEL_LINE_RE.finditer(auto_text):
    name = m.group('model')
    try:
      prev_v = _parse_int_with_spaces(m.group(2))
      cur_v = _parse_int_with_spaces(m.group(3))
    except Exception:
      continue
    if name == 'Damas':  # 'Damas/Labo'로 합산 (+ Специализированные)
      damas_prev += prev_v
      damas_cur += cur_v
    else:
      brand, model = _map_model(name)
      out.append((brand, model, prev_v, cur_v))

  sv = SV_LINE_RE.search(auto_text)  # Специализированные → Damas/Labo 합산
  if sv:
    try:
      damas_prev += _parse_int_with_spaces(sv.group(1))
      damas_cur += _parse_int_with_spaces(sv.group(2))
    except Exception:
      pass
  if damas_cur or damas_prev:
    out.append(('Chevrolet', 'Damas/Labo', damas_prev, damas_cur))

  tm = TRUCK_LINE_RE.search(auto_text)  # Грузовые → LCV
  if tm:
    try:
      out.append(('LCV', '', _parse_int_with_spaces(tm.group(1)), _parse_int_with_spaces(tm.group(2))))
    except Exception:
      pass

  if not out:
    return None
  return {'cur_year': cur_year, 'prior_year': prior_year, 'last_month': last_m, 'rows': out}


def build_ytd_rows(parsed: list[dict]) -> list[dict]:
  """모델별 YTD 스냅샷 row (period_type='ytd', year_period='YYYY-MM'). 당년+전년 동기.
  PK 충돌은 최신 발표(나중 호출) 우선."""
  src = BASE + NEWS_LIST
  by_pk: dict[tuple, dict] = {}
  for p in parsed:
    lm = p['last_month']
    for brand, model, prev_v, cur_v in p['rows']:
      for yr, units in ((p['cur_year'], cur_v), (p['prior_year'], prev_v)):
        row = {
          'kind': 'production', 'period_type': 'ytd', 'year_period': f'{yr}-{lm:02d}',
          'company': '', 'brand': brand, 'vehicle_model': model, 'units': units,
          'source_type': 'stat-uz', 'source_url': src,
        }
        pk = (row['year_period'], brand, model)
        by_pk[pk] = row  # 최신 우선
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
    # 당년 기준 필터 (전년 컬럼은 당년-1이라 함께 들어옴)
    if parsed['cur_year'] < args.year_from or parsed['cur_year'] > year_to:
      continue
    parsed['news_url'] = n['href']
    parsed_list.append(parsed)
    logger.debug(f'  parsed {parsed["cur_year"]} (vs {parsed["prior_year"]}) 1-{parsed["last_month"]}월: '
                 f'models={len(parsed["rows"])}')

  logger.info(f'산업 PDF 파싱: {len(parsed_list)}건')
  rows = build_ytd_rows(parsed_list)
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
