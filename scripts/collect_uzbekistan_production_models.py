#!/usr/bin/env python3
"""우즈베키스탄 차종(모델)별 생산량 수집 — stat.uz 뉴스 채널 (news-of-committee).

기존 collect_uzbekistan_production.py(산업 PDF, 회사 합계/엔진 위주)와 달리, 이 채널은
모델별 생산량을 영문 평문으로 발표한다 (원 audit의 src2). 만년 + 월별 YTD 누계가 연속 게시됨.

소스 형식 (en):
  목록: https://stat.uz/en/press-center/news-of-committee?start=N (N=0,20,40,...)
  기사: .../news-of-committee/{id}-{slug}  (div#article-body 텍스트)
  본문 예:
    "... 457,883 passenger cars ... produced in Uzbekistan in 2025. ...
     Cobalt - 161,152 units; Damas - 93,681 units; ... Special passenger cars - 54,301 units."
    "... produced in Uzbekistan in January 2026. ..." / "... in January-March 2026. ..."

기간 판정:
  - "in Uzbekistan in <YYYY>." (월 없음)      → 만년 → period_type='year', year_period='YYYY', last_month=12
  - "in <Month>[-<Month>] <YYYY>"             → YTD 누계 → last_month = to-month

이미지(인포그래픽) 기사:
  2024 이하·2025 일부는 본문이 그림(인포그래픽)으로만 발행됨. 텍스트 파싱 실패 + 생산 slug일 때
  article-body 이미지 → Anthropic 비전(tool_use submit_production)으로 추출(sha256 캐시, 재호출 방지).
  ANTHROPIC_API_KEY 필요(CI Secrets). 키 없으면 이미지 기사는 skip(텍스트만). --no-vision으로 강제 비활성.

적재 (모두 source_type='stat-uz', kind='production'):
  - period_type='month': 같은 연도 YTD 스냅샷을 last_month 오름차순 차분 (누락월 균등 분배). "매월 생산량"
  - period_type='year' : last_month=12 스냅샷(만년 기사)이 있으면 그 값으로 적재

모델 정규화 (사용자 명시 + audit):
  - Cobalt/Tracker/Onix/Spark/Nexia/Gentra/Lacetti/Captiva/Malibu/Equinox/Traverse/Tahoe → Chevrolet 모델
  - Damas + Labo + Special passenger cars(특수승용) → Chevrolet 'Damas/Labo' 합산
  - KIA/BYD/Chery/Haval → 브랜드 자체
  - 'Tank 500' → 브랜드 Tank / 모델 500 (GWM Tank)
  - 그 외 → 브랜드=이름, 모델=''

플래그:
  --max-start 800   목록 페이지네이션 최대 start (default 800 = 40 페이지)
  --year-from 2022  당년 기준 하한
  --dry-run
환경:
  UZ_VERIFY_SSL=0   로컬에서 SSL 검증 끄기 (CI는 기본 검증)
"""
import argparse
import base64
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from loguru import logger

from lib.bootstrap import init_script

init_script(__file__)

from lib.db import WriteSession  # noqa: E402

BASE = 'https://stat.uz'
LIST_PATH = '/en/press-center/news-of-committee'
RUN_LOG_DIR = Path(__file__).resolve().parent
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
VERIFY_SSL = os.environ.get('UZ_VERIFY_SSL', '1') != '0'
SRC_URL = BASE + LIST_PATH

EN_MONTHS = {
  'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
  'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12,
}

# 모델 → (brand, vehicle_model)
CHEVROLET_MODELS = {
  'cobalt', 'tracker', 'onix', 'spark', 'nexia', 'gentra', 'lacetti',
  'captiva', 'malibu', 'equinox', 'traverse', 'tahoe', 'damas', 'labo',
}
DAMAS_LABO_LABELS = {'damas', 'labo', 'special passenger cars', 'specialized passenger cars',
                     'specialized passenger car', 'special passenger car'}

# 자동차 모델 생산 기사 식별 — 본문에 'passenger cars' + 'produced' + 모델 라인 ≥ MIN_MODEL_LINES
MIN_MODEL_LINES = 4
CAR_KEYWORDS = re.compile(r'passenger cars', re.IGNORECASE)

# 이미지(인포그래픽) 기사 비전 추출 — 2024 이하·2025 일부는 텍스트 없이 그림으로 발행됨.
ANTHROPIC_MODEL = os.environ.get('UZ_VISION_MODEL', 'claude-sonnet-4-6')
IMG_CACHE_DIR = Path(__file__).resolve().parent.parent / 'data' / '_uzbekistan_statuz_cache'
IMG_CACHE_DIR.mkdir(parents=True, exist_ok=True)
# 차종 생산 기사 slug 게이트 (이미지 비전 호출 낭비 방지): 생산 기사만, 수입/좌석/타이어/등록 제외.
PROD_SLUG_RE = re.compile(r'(avtomobil|cobalt|yengil|engil).*ishlab-chi', re.IGNORECASE)
EXCLUDE_SLUG_RE = re.compile(
  r'import|eksport|o-rindi|rindiq|kuzov|bamper|shina|ro-yxat|royxat|uy-xo|top-10|davlat|household',
  re.IGNORECASE,
)

VISION_TOOL = {
  'name': 'submit_production',
  'description': '우즈베키스탄 차종(모델)별 자동차 생산량 추출 결과 제출.',
  'input_schema': {
    'type': 'object',
    'properties': {
      'year': {'type': 'integer', 'description': '연도 (예: 2024)'},
      'last_month': {
        'type': 'integer',
        'description': '누계 마지막 월 (1~12). "January-November"이면 11, 만년/"in YYYY"이면 12.',
      },
      'total_units': {'type': 'integer', 'description': '총 승용차 생산량(대).'},
      'models': {
        'type': 'array',
        'description': '모델/브랜드별 생산량. 이미지에 표기된 라벨 그대로 (Cobalt/Damas/Tracker/Onix/KIA/BYD/Chery/Haval/Lacetti-Gentra/Tank 500/LADA/Special passenger cars 등).',
        'items': {
          'type': 'object',
          'properties': {
            'name': {'type': 'string'},
            'units': {'type': 'integer'},
          },
          'required': ['name', 'units'],
        },
      },
    },
    'required': ['year', 'last_month', 'models'],
  },
}


def fetch(url: str) -> str | None:
  try:
    r = requests.get(url, headers=HEADERS, timeout=40, verify=VERIFY_SSL)
    r.raise_for_status()
    return r.text
  except Exception as e:
    logger.warning(f'  fetch 실패 {url[:70]}: {e}')
    return None


def article_body(html: str) -> str:
  m = re.search(r'<div[^>]*id=["\']article-body["\'][^>]*>(.*?)</div>', html, re.S | re.I)
  if not m:
    m = re.search(r'<div[^>]*class=["\'][^"\']*article-body[^"\']*["\'][^>]*>(.*?)</div>',
                  html, re.S | re.I)
  body = m.group(1) if m else ''
  body = re.sub(r'<[^>]+>', ' ', body)
  return re.sub(r'\s+', ' ', body).strip()


def parse_period(text: str) -> tuple[int, int] | None:
  """(year, last_month) 반환. 만년이면 last_month=12. 실패 시 None."""
  # 월 범위/단일월 우선: 'in Uzbekistan in January-March 2026' / 'in January 2026'
  mm = re.search(
    r'in\s+([A-Za-z]+)(?:\s*[-–—]\s*([A-Za-z]+))?\s+(\d{4})', text, re.IGNORECASE)
  if mm:
    from_m = EN_MONTHS.get(mm.group(1).lower())
    to_m = EN_MONTHS.get((mm.group(2) or mm.group(1)).lower())
    if from_m and to_m:
      return (int(mm.group(3)), to_m)
  # 만년: 'produced in Uzbekistan in 2025'
  ym = re.search(r'in\s+Uzbekistan\s+in\s+(\d{4})\b', text, re.IGNORECASE)
  if ym:
    return (int(ym.group(1)), 12)
  return None


def parse_models(text: str) -> dict[tuple[str, str], int]:
  """모델 라인 파싱 → {(brand, model): units}. 본문 전체에서 'Name - N units' finditer."""
  pairs = [
    (m.group(1).strip(), int(m.group(2).replace(',', '')))
    for m in re.finditer(r'([A-Za-z][A-Za-z0-9 ]*?)\s*[-–—]\s*([\d,]+)\s*units?\b', text)
  ]
  return _accumulate(pairs)


def _map_one(name: str) -> tuple[str, str] | None:
  """모델/브랜드명 → (brand, vehicle_model). Damas/Labo·Special는 '__DAMAS__' 센티넬. 미인식 None(skip)."""
  low = name.lower().strip().strip('"“”')
  if low in DAMAS_LABO_LABELS:
    return ('__DAMAS__', '')
  if 'lacetti' in low or 'gentra' in low:
    return ('Chevrolet', 'Lacetti-Gentra')
  if low in CHEVROLET_MODELS:
    return ('Chevrolet', name.strip().title())
  if low in ('kia', 'byd', 'chery', 'haval'):
    return ({'kia': 'KIA', 'byd': 'BYD', 'chery': 'Chery', 'haval': 'Haval'}[low], '')
  if low.startswith('tank'):
    return ('Tank', name.split(maxsplit=1)[1] if ' ' in name else '')
  if low.startswith('lada'):
    return ('LADA', '')
  return None  # 미인식(수입 국가명 등) skip — 차종 화이트리스트만


def _accumulate(pairs: list[tuple[str, int]]) -> dict[tuple[str, str], int]:
  """(name, units) 목록 → {(brand, model): units}. Damas+Special+Labo는 'Damas/Labo' 합산."""
  out: dict[tuple[str, str], int] = {}
  damas = 0
  for name, units in pairs:
    k = _map_one(name)
    if k is None:
      continue
    if k[0] == '__DAMAS__':
      damas += units
      continue
    out[k] = out.get(k, 0) + units
  if damas > 0:
    out[('Chevrolet', 'Damas/Labo')] = out.get(('Chevrolet', 'Damas/Labo'), 0) + damas
  return out


def article_image(html: str) -> str | None:
  """article-body 내 첫 이미지 URL (절대경로)."""
  m = re.search(r'<div[^>]*id=["\']article-body["\'][^>]*>(.*?)</div>', html, re.S | re.I)
  raw = m.group(1) if m else html
  im = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', raw)
  if not im:
    return None
  src = im.group(1)
  if src.startswith('//'):
    return 'https:' + src
  if src.startswith('/'):
    return BASE + src
  return src


def download_image(url: str) -> bytes | None:
  try:
    r = requests.get(url, headers=HEADERS, timeout=40, verify=VERIFY_SSL)
    r.raise_for_status()
    return r.content
  except Exception as e:
    logger.warning(f'  이미지 다운로드 실패 {url[:70]}: {e}')
    return None


def call_anthropic_for_image(client, img_bytes: bytes, media_type: str) -> dict | None:
  """인포그래픽 이미지 → 비전 추출. 결과는 sha256 캐시. {year,last_month,models:{(brand,model):units}}."""
  sha = hashlib.sha256(img_bytes).hexdigest()[:24]
  cache_file = IMG_CACHE_DIR / f'vision_{sha}.json'
  if cache_file.exists():
    raw = json.loads(cache_file.read_text(encoding='utf-8'))
  else:
    if client is None:
      return None
    prompt = (
      'This is an Uzbekistan statistics infographic about how many passenger CARS were '
      'PRODUCED (ishlab chiqarilgan), broken down by model/brand. Extract the year, the '
      'last cumulative month (e.g. "January-November" → 11, "in 2024" full year → 12), the '
      'total passenger cars, and each model with its units. Keep model labels exactly as '
      'shown (Cobalt, Damas, Tracker, Onix, KIA, BYD, Chery, Haval, Lacetti-Gentra, '
      'Tank 500, LADA, Special passenger cars, etc.). If this image is NOT about car '
      'production by model (e.g. imports by country, tires, seats, registrations), return '
      'an empty models array. Call submit_production.'
    )
    try:
      msg = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=1500,
        tools=[VISION_TOOL],
        tool_choice={'type': 'tool', 'name': 'submit_production'},
        messages=[{
          'role': 'user',
          'content': [
            {'type': 'image', 'source': {'type': 'base64', 'media_type': media_type,
                                         'data': base64.standard_b64encode(img_bytes).decode()}},
            {'type': 'text', 'text': prompt},
          ],
        }],
      )
    except Exception as e:
      logger.error(f'  Anthropic 비전 호출 실패: {e}')
      return None
    raw = None
    for block in msg.content:
      if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_production':
        raw = dict(block.input)
        break
    if raw is None:
      return None
    cache_file.write_text(json.dumps(raw, ensure_ascii=False), encoding='utf-8')

  models = raw.get('models') or []
  if len(models) < MIN_MODEL_LINES:
    return None
  pairs = [(m['name'], int(m['units'])) for m in models if m.get('name') and m.get('units') is not None]
  return {'year': int(raw['year']), 'last_month': int(raw['last_month']), 'models': _accumulate(pairs)}


def discover_articles(max_start: int) -> list[str]:
  """목록 페이지에서 자동차 모델 생산 기사 후보 slug 수집."""
  kw = re.compile(r'cobalt|avtomobil|engil-avto|passenger|legkov', re.IGNORECASE)
  seen: list[str] = []
  seen_set: set[str] = set()
  fail_streak = 0
  for start in range(0, max_start + 1, 20):
    html = fetch(f'{BASE}{LIST_PATH}?start={start}')
    if not html:
      fail_streak += 1
      if fail_streak >= 4:  # 연속 fetch 실패 시에만 중단 (빈 결과 페이지는 계속)
        break
      continue
    fail_streak = 0
    for slug in re.findall(r'/en/press-center/news-of-committee/(\d+[\w-]+)', html):
      if kw.search(slug) and slug not in seen_set:
        seen_set.add(slug)
        seen.append(slug)
    time.sleep(0.15)
  return seen


def diff_to_monthly(by_year: dict[int, list[dict]]) -> list[dict]:
  """연도별 YTD 스냅샷 → 월별 차분 (모델별, 누락월 균등 분배) + 만년 year row."""
  rows: list[dict] = []
  for year, snaps in by_year.items():
    # 모델별 (last_month → units)
    timeline: dict[tuple[str, str], dict[int, int]] = {}
    annual_models: dict[tuple[str, str], int] | None = None
    for s in sorted(snaps, key=lambda x: x['last_month']):
      for key, units in s['models'].items():
        timeline.setdefault(key, {})[s['last_month']] = units
      if s['last_month'] == 12:
        annual_models = s['models']
    for key, points in timeline.items():
      brand, model = key
      prev_m, prev_v = 0, 0
      for m in sorted(points):
        v = points[m]
        span = m - prev_m
        if span <= 0:
          prev_v = v
          continue
        delta = v - prev_v
        base = delta // span
        rem = delta - base * span
        for mm in range(prev_m + 1, m + 1):
          rows.append({
            'kind': 'production', 'period_type': 'month', 'year_period': f'{year}-{mm:02d}',
            'company': '', 'brand': brand, 'vehicle_model': model,
            'units': base + (rem if mm == m else 0),
            'source_type': 'stat-uz', 'source_url': SRC_URL,
          })
        prev_m, prev_v = m, v
    # 만년 (12월 스냅샷 있을 때만)
    if annual_models:
      for (brand, model), units in annual_models.items():
        rows.append({
          'kind': 'production', 'period_type': 'year', 'year_period': str(year),
          'company': '', 'brand': brand, 'vehicle_model': model, 'units': units,
          'source_type': 'stat-uz', 'source_url': SRC_URL,
        })
  return rows


def main() -> int:
  parser = argparse.ArgumentParser()
  parser.add_argument('--max-start', type=int, default=800)
  parser.add_argument('--year-from', type=int, default=2022)
  parser.add_argument('--dry-run', action='store_true')
  parser.add_argument('--no-vision', action='store_true', help='이미지 비전 추출 비활성화')
  args = parser.parse_args()
  if not VERIFY_SSL:
    requests.packages.urllib3.disable_warnings()  # type: ignore[attr-defined]

  # 이미지(인포그래픽) 기사용 Anthropic 클라이언트 (키 없으면 텍스트만)
  client = None
  if not args.no_vision:
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if api_key:
      try:
        from anthropic import Anthropic
        client = Anthropic(api_key=api_key)
        logger.info(f'비전 추출 활성화 (model={ANTHROPIC_MODEL})')
      except Exception as e:
        logger.warning(f'Anthropic 초기화 실패 (텍스트만 진행): {e}')
    else:
      logger.warning('ANTHROPIC_API_KEY 미설정 → 이미지 기사는 skip (텍스트만)')

  slugs = discover_articles(args.max_start)
  logger.info(f'자동차 기사 후보: {len(slugs)}개')

  by_year: dict[int, list[dict]] = {}
  parsed_n = 0
  vision_n = 0
  for slug in slugs:
    html = fetch(f'{BASE}{LIST_PATH}/{slug}')
    if not html:
      continue
    body = article_body(html)
    year = last_m = None
    models: dict[tuple[str, str], int] = {}

    # 1) 텍스트 경로
    if body and CAR_KEYWORDS.search(body):
      models = parse_models(body)
      per = parse_period(body)
      if len(models) >= MIN_MODEL_LINES and per is not None:
        year, last_m = per

    # 2) 이미지(인포그래픽) 경로 — 텍스트 실패 + 생산 slug + 이미지 존재
    if year is None and PROD_SLUG_RE.search(slug) and not EXCLUDE_SLUG_RE.search(slug):
      img_url = article_image(html)
      if img_url and client is not None:
        img = download_image(img_url)
        if img:
          media = 'image/png' if img_url.lower().endswith('.png') else 'image/jpeg'
          ext = call_anthropic_for_image(client, img, media)
          if ext and len(ext['models']) >= MIN_MODEL_LINES:
            year, last_m, models = ext['year'], ext['last_month'], ext['models']
            vision_n += 1
          time.sleep(0.3)

    if year is None or last_m is None or len(models) < MIN_MODEL_LINES:
      continue
    if year < args.year_from:
      continue
    by_year.setdefault(year, []).append({'last_month': last_m, 'models': models, 'slug': slug})
    parsed_n += 1
    logger.debug(f'  {year} 1-{last_m}월: models={len(models)} ({slug[:30]})')
    time.sleep(0.15)

  logger.info(f'  (이미지 비전 추출 {vision_n}건 포함)')

  logger.info(f'파싱 성공: {parsed_n}건 / 연도 {sorted(by_year)}')
  rows = diff_to_monthly(by_year)
  logger.info(f'적재 row: {len(rows)}건')

  ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
  log_path = RUN_LOG_DIR / f'_uzbekistan_prodmodels_run_{ts}.json'
  try:
    summary = {y: sorted(s['last_month'] for s in v) for y, v in by_year.items()}
    log_path.write_text(json.dumps({'parsed': parsed_n, 'rows': len(rows), 'by_year_months': summary},
                                    ensure_ascii=False, indent=2), encoding='utf-8')
    logger.info(f'결과 로그: {log_path}')
  except Exception as e:
    logger.warning(f'로그 저장 실패: {e}')

  if args.dry_run:
    print('=== sample rows ===')
    for r in rows[:12]:
      print(r)
    logger.success('dry-run 종료 (DB 쓰기 없음)')
    return 0

  if not rows:
    logger.warning('적재할 행 없음')
    return 1

  with WriteSession() as w:
    BATCH = 500
    for i in range(0, len(rows), BATCH):
      w.table('uzbekistan_auto_stats').upsert(
        rows[i:i + BATCH],
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
