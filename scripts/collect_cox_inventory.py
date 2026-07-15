#!/usr/bin/env python3
"""Cox Automotive 브랜드별 신차 재고일수(days' supply) → cox_brand_inventory 적재.

플로우:
  1. WordPress REST API(`/wp-json/wp/v2/insight`)로 'new vehicle inventory' 기사 발견.
     → 슬러그에서 (연, 월) 파싱. **URL 조립 안 함** (아래 gotcha 참고).
  2. 기사 HTML fetch → 본문(`div.post-content`)에서 브랜드 차트 이미지 링크 선별.
  3. 이미지 다운로드 → sha256 → 캐시 비교. 변경 없으면 LLM 호출 skip(캐시된 판독 재사용).
  4. 변경분만 Anthropic vision + tool_use(submit_brand_inventory)로 구조화 추출.
  5. 검증(NATION 존재·중복·범위·이상치 모순) 통과분만 WriteSession upsert → revalidate 자동.
     upsert 직전 기존 DB 값과 대조해 변경분을 로그로 남긴다(대량 변경은 그 달을 실패 처리).

**결측(행 없음)의 의미는 하나가 아니다.** 사유가 최소 4가지이고, 그중 ①만 행으로 표현한다:
  ① 이상치 제외  — Cox가 업계 평균 2배 초과라 막대에서 빼고 이름만 실은 브랜드.
     수치는 미공개지만 "NATION × 2 이상"이라는 **강한 신호**다.
     → `days_supply=None, is_outlier_excluded=True` 행으로 적재한다.
  ② 저물량 상시 제외 — Fiat·Alfa Romeo. 전 기간 차트에 없다. → 행 없음.
  ③ 그 달만 로스터 누락 — Lincoln 202601, Audi 202512. 제외 박스에도 없다. → 행 없음.
  ④ 판독/검증 실패 — 우리 쪽 문제. → 행 없음.
  ②③④는 우리가 아는 게 없으므로 **아는 척하지 않는다**(행을 만들지 않는다).
  소비 측은 `is_outlier_excluded=true`(=재고 심각)와 행 없음(=모름)을 구분해서 읽어야 한다.

gotcha (2026-07-15 실측):
  - **브랜드별 수치는 차트 JPEG 안에만 있다.** 기사 첨부 CSV/XLSX에는 산업 전체 수치만
    있고 브랜드 분해가 없다 → vision 판독이 유일한 경로.
  - **기사 슬러그가 불규칙**해 URL 조립이 불가능하다. 두 어순이 섞이고
    (`may-2026-new-vehicle-inventory` vs `new-vehicle-inventory-may-2023`),
    월 이름도 full/축약이 섞인다(`march-2026` vs `feb-2026`·`sept-2025`).
    실제로 `february-2026-new-vehicle-inventory`는 404이고 `feb-2026-...`가 정답이다.
    → REST API 검색으로 발견하고 API가 준 `link`를 그대로 쓴다.
  - **이미지 파일명도 매월 제각각**이라 조립 불가
    (`May-New-Inventory-Brand.jpeg` / `April-2026-Inventory.jpg` /
     `Dec-2025-new-vehicle-inventory-chart-REVISED.png`) → 본문 스크래핑으로 찾는다.
  - **alt 속성은 전 기사가 빈 문자열**이라 판별에 못 쓴다 → 본문 컨테이너 범위 +
    파일명 힌트('inventory'/'brand'/'chart')로 선별한다.
  - **과거 수치가 소급 수정된다**(Dec-2025 차트는 파일명에 REVISED가 붙었다) →
    기본 동작으로 최근 DEFAULT_RECENT_MONTHS개월을 매번 재처리한다. 이미지가 실제로
    바뀌었을 때만 sha256이 달라져 LLM을 재호출하므로 비용은 거의 안 는다.
  - 차트의 업계 평균 막대(초록)는 라벨이 'NATION'이다. 굵은 글씨는 NATION이 아닐 수 있다
    (2026-04 차트는 BMW 라벨이 굵다) → 굵기로 NATION을 찾지 말 것.
  - Fiat·Alfa Romeo는 물량 미달로 차트에 없다(스텔란티스는 Jeep/Ram/Dodge/Chrysler 4개).
  - **업계 평균의 2배를 넘는 브랜드는 막대에서 빠지고 오른쪽 별도 박스에 이름만 실린다**
    ("Automaker with days' supply at least twice the industry average: Chrysler").
    수치가 아예 공개되지 않으므로 값은 지어내지 않되, **행은 만든다**
    (`days_supply=None, is_outlier_excluded=True` — 위 결측 4분류 ① 참고).
    실측: Chrysler가 2025-12~2026-03 4개월 연속 제외됐다가 2026-04에 복귀(135 < 78×2).
    하필 재고가 가장 심각한 달에 값이 없다 → 이 신호를 로그·캐시로만 남기면
    (캐시는 gitignore라 CI에서 증발) 이 테이블의 존재 이유인 스텔란티스 재고 감시가 깨진다.
  - **LLM 재판독은 매번 같은 값을 보장하지 않는다.** 캐시가 gitignore라 CI 러너엔 없어서
    매월 cron이 과거 DEFAULT_RECENT_MONTHS개월을 재판독한다. 145→146 같은 한 자리 오독은
    validate_extraction(범위·개수 게이트)을 통과하므로, upsert 직전 기존 DB 값과 대조해
    변경분을 로그로 남기고 대량 변경은 실패 처리한다(_diff·MAX_CHANGED_BRANDS_PER_MONTH).
    **temperature로는 못 막는다** — call_anthropic_for_chart 주석 참고.
  - **소스가 브랜드 라벨을 바꾼다**: 2026-01까지 'Mercedes-Benz' → 2026-02부터 'Mercedes'.
    brand가 PK라 그대로 두면 한 회사가 두 시계열로 쪼개진다 → BRAND_ALIASES로 정규화한다.

플래그:
  --months N          최근 N개월 처리 (default 3 — 소급 수정 재적재)
  --year-month YYYYMM 특정 월만 (반복 지정 가능). 지정 시 --months 무시.
  --reprocess-all     sha256 캐시 무시하고 전부 LLM 재판독
  --dry-run           DB 쓰기 없이 판독·검증 결과만 출력 (vision 호출은 수행)

사용:
  scripts/venv/Scripts/python.exe scripts/collect_cox_inventory.py --dry-run --year-month 202605

비용 (Opus 4.7, 이미지 1장 ≈ 1.6K 입력 tokens):
  월 1건 × ($15/M × ~2K + $75/M × ~1K) ≈ $0.1. 캐시 hit이면 0.
"""
import argparse
import base64
import hashlib
import json
import os
import re
import sys
import time
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests
from anthropic import Anthropic
from bs4 import BeautifulSoup
from loguru import logger

from lib.bootstrap import init_script

init_script(__file__)

from lib.db import WriteSession, get_client  # noqa: E402

# ---------------------------------------------------------------------------
# 상수
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
IMAGE_CACHE_DIR = SCRIPT_DIR.parent / 'data' / '_cox_inventory_cache'

SITE_ROOT = 'https://www.coxautoinc.com'
# 기사는 기본 'post'가 아니라 커스텀 포스트 타입 'insight'다(/wp-json/wp/v2/types로 확인).
# 'posts' 끝점으로 검색하면 빈 배열만 돌아온다.
INSIGHT_API_URL = f'{SITE_ROOT}/wp-json/wp/v2/insight'
INSIGHT_SEARCH_TERM = 'new vehicle inventory'

# 소급 수정 대응 기본 재처리 범위. 관측된 수정은 발표 직후 몇 달 내에 일어난다
# (2025-05 재고가 Dec-2025 발표와 May-2026 발표에서 서로 달랐다).
DEFAULT_RECENT_MONTHS = 3

REQUEST_TIMEOUT_S = 30
REQUEST_SLEEP_S = 0.8               # 기사 사이 요청 간격 (예의)
API_PER_PAGE = 100                  # WP REST 최대값
API_MAX_PAGES = 5                   # 안전 상한 — 1페이지로 통상 1년치가 덮인다
USER_AGENT = (
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
)
COMMON_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

ANTHROPIC_MODEL = os.environ.get('COX_INVENTORY_MODEL', 'claude-opus-4-7')
LLM_MAX_TOKENS = 4000               # 브랜드 ~30개 × 짧은 객체 — 여유 포함

# 업계 평균 막대(초록)의 라벨. 판독 성공 판정의 필수 조건이다.
NATION_LABEL = 'NATION'

# 소스가 라벨을 바꾼 브랜드의 별칭 → 정본. brand가 PK라 정규화하지 않으면 같은 회사가
# 두 시계열로 쪼개진다(collect_stellantis_na_sales.py의 MODEL_ALIASES와 같은 이유).
# 정본은 **소스의 최신 표기**로 맞춘다 — 앞으로 들어올 달이 그 표기를 쓰므로 추가 손질이 없다.
#   실측: 2025-12·2026-01 'Mercedes-Benz' → 2026-02~ 'Mercedes'.
# 원본 라벨은 data/_cox_inventory_cache/<YYYYMM>.meta.json에 그대로 남는다.
BRAND_ALIASES = {'mercedes-benz': 'Mercedes'}
# 차트에 실린 브랜드 수. 실측 2026-04/05 모두 30개(NATION 포함)였다.
# 절반 이하로 떨어지면 차트 일부만 읽은 것으로 보고 실패 처리한다.
MIN_BRANDS_EXPECTED = 12
# 재고일수 상한 sanity. 실측 최대는 Dodge 148일. 400일(≈13개월)을 넘으면
# 자릿수 오독(144 → 1448)일 가능성이 높다.
MAX_PLAUSIBLE_DAYS_SUPPLY = 400

# 한 달에 이 수 이상의 브랜드 값이 기존 DB와 달라지면 그 달을 실패 처리(upsert 제외)한다.
# 근거: 관측된 소급 수정은 한두 브랜드 단위이고, LLM 한 자리 오독도 보통 1~2개다
# (둘 다 경고 로그로 추적 가능하고 blast radius가 작다). 반면 3개 이상이 한꺼번에 바뀌는 건
# (a) 라벨-막대 정렬이 밀려 여러 값이 통째로 어긋난 구조적 오독이거나
# (b) Cox가 차트를 통째로 재작성한 경우 — 둘 다 이미 확정된 달을 덮어쓰기 전에 사람이 봐야 한다.
# 해당 월만 떨어뜨리므로 신규 월 적재는 계속된다(전체 중단 시 최신 월까지 못 들어오는 게 더 나쁘다).
MAX_CHANGED_BRANDS_PER_MONTH = 3

# Cox 발행일은 매월 11~18일(전월 데이터). cron은 매월 20일.
# 이 날짜를 넘겼는데도 전월 기사가 안 보이면 발견 로직이 깨진 것으로 본다.
# 1~10일 수동 실행처럼 아직 발행 전일 수 있는 시점은 이 여유로 흡수한다.
PUBLISH_GRACE_DAY = 18
# freshness 게이트 실패 종료 코드. 1(월별 판독 실패)·2(upsert 실패)와 구분해
# CI가 "발견이 멈췄다"를 따로 알아볼 수 있게 한다.
EXIT_STALE = 3

# 기사 본문 컨테이너. 404 페이지는 이 클래스가 없고 'error-hero-pattern'만 있어
# 자연히 걸러진다(404 페이지에도 wp-image-* 장식 이미지가 3개 있다).
POST_CONTENT_SELECTOR = 'div.post-content'

# 브랜드 차트 후보 이미지 확장자 (Anthropic vision 지원 포맷).
RASTER_MEDIA_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

# 파일명 힌트 → 점수. alt가 전부 비어 있어 파일명이 유일한 텍스트 단서다.
# 'inventory'가 없으면 후보에서 제외한다(실측 9개월 파일명 전부 포함).
FILENAME_REQUIRED_HINT = 'inventory'
FILENAME_BONUS_HINTS = {'brand': 3, 'chart': 2}
FILENAME_BASE_SCORE = 10

# 슬러그 판별. 'used-vehicle-inventory-*'(중고차)는 이 마커가 없어 자동 제외된다.
NEW_INVENTORY_MARKER = 'new-vehicle-inventory'
# '<월>-<연도>' 토큰. 어순이 뒤집힌 슬러그(new-vehicle-inventory-may-2023)도 같은 패턴으로 잡힌다.
_SLUG_MONTH_RE = re.compile(r'(?:^|-)([a-z]+)-(20\d{2})(?:-|$)')
# full/축약 혼용 실측: march·april·may vs feb·sept·oct·nov·dec·jan.
MONTH_TOKENS = {
  'january': 1, 'jan': 1,
  'february': 2, 'feb': 2,
  'march': 3, 'mar': 3,
  'april': 4, 'apr': 4,
  'may': 5,
  'june': 6, 'jun': 6,
  'july': 7, 'jul': 7,
  'august': 8, 'aug': 8,
  'september': 9, 'sept': 9, 'sep': 9,
  'october': 10, 'oct': 10,
  'november': 11, 'nov': 11,
  'december': 12, 'dec': 12,
}

BRAND_INVENTORY_TOOL = {
  'name': 'submit_brand_inventory',
  'description': (
    "Submit every bar read from a Cox Automotive new-vehicle days' supply bar chart. "
    'Report one entry per bar, including the industry-average bar. '
    'Read the printed number above each bar — never estimate from bar height.'
  ),
  'input_schema': {
    'type': 'object',
    'properties': {
      'brands': {
        'type': 'array',
        'description': 'One entry per bar, in left-to-right order as drawn.',
        'items': {
          'type': 'object',
          'properties': {
            'brand': {
              'type': 'string',
              'description': (
                "The x-axis label exactly as printed (e.g. 'Land Rover', 'Volkswagen', "
                "'NATION' for the green industry-average bar). Do not translate or expand."
              ),
            },
            'days_supply': {
              'type': 'integer',
              'description': "The number printed above the bar (days' supply).",
            },
          },
          'required': ['brand', 'days_supply'],
        },
      },
      'excluded_outlier_brands': {
        'type': 'array',
        'description': (
          'Brands named in the side box titled "Automaker with days\' supply at least twice '
          'the industry average" (singular "Automaker" even when it lists one name). '
          'These have NO bar and NO published number — report the brand name only, never a '
          'guessed value, and never also report them in "brands". '
          'Return an empty array if the box is absent. Always include this field.'
        ),
        'items': {
          'type': 'string',
          'description': "The brand name exactly as printed in the box (e.g. 'Chrysler').",
        },
      },
    },
    # excluded_outlier_brands도 required — optional로 두면 박스가 있는데도 필드를 통째로
    # 생략하는 응답이 나오고, 그 달의 이상치 신호(가장 중요한 신호)가 조용히 사라진다.
    # 박스가 없으면 빈 배열을 받는다.
    'required': ['brands', 'excluded_outlier_brands'],
  },
}


# ---------------------------------------------------------------------------
# 순수 함수 (scripts/lib/test_cox_inventory.py가 검증)
# ---------------------------------------------------------------------------
def parse_year_month_from_slug(slug: str) -> int | None:
  """기사 슬러그 → year_month(YYYYMM). 월간 재고 기사가 아니면 None.

  슬러그의 월/연도가 **데이터 기준월**이다(발행은 다음 달 중순).
    'may-2026-new-vehicle-inventory'    (2026-06-11 발행) → 202605
    'new-vehicle-inventory-may-2023'    (어순 반대)        → 202305
    'feb-2026-new-vehicle-inventory'    (축약)             → 202602
  월 토큰이 없는 특집·연간 기사는 None:
    '2022-new-vehicle-inventory', 'new-vehicle-inventory-level-healthy-2024'
  """
  s = slug.lower()
  if NEW_INVENTORY_MARKER not in s:
    return None
  # finditer — 'healthy-2024'처럼 월이 아닌 <단어>-<연도>를 건너뛰고 진짜 월을 찾는다.
  for m in _SLUG_MONTH_RE.finditer(s):
    month = MONTH_TOKENS.get(m.group(1))
    if month:
      return int(m.group(2)) * 100 + month
  return None


def full_res_image_url(src: str, page_url: str) -> str:
  """<img src> → 원본 최대 해상도 절대 URL.

  WordPress가 붙이는 리사이즈 쿼리(?w=1024, ?resize=768,432)를 떼면 원본이 나온다
  (실측: ?w=1024는 1024px, 쿼리 없는 원본은 1280px). vision 판독은 해상도가 높을수록
  라벨 숫자 오독이 준다.
  """
  return urljoin(page_url, src.split('?', 1)[0])


def media_type_for_url(url: str) -> str | None:
  """이미지 URL 확장자 → Anthropic media_type. 지원 밖(svg 등)이면 None."""
  ext = Path(url.split('?', 1)[0]).suffix.lower()
  return RASTER_MEDIA_TYPES.get(ext)


def score_image_candidate(url: str) -> int:
  """이미지 URL → 브랜드 차트 가능성 점수. 0이면 후보 아님.

  alt가 전 기사 빈 문자열이라 파일명이 유일한 텍스트 단서다. 실측 9개월 파일명은
  대소문자만 다를 뿐 전부 'inventory'를 포함한다(404 페이지 장식 about-us-img.png는 미포함).
  """
  name = Path(url.split('?', 1)[0]).name.lower()
  if FILENAME_REQUIRED_HINT not in name:
    return 0
  score = FILENAME_BASE_SCORE
  for hint, bonus in FILENAME_BONUS_HINTS.items():
    if hint in name:
      score += bonus
  return score


def select_chart_image(html: str, page_url: str) -> str | None:
  """기사 HTML → 브랜드 차트 이미지의 원본 URL. 못 찾으면 None.

  본문 컨테이너로 먼저 좁힌 뒤(헤더 로고·저자 사진·관련글 썸네일 제외) 파일명 점수로
  고른다. 404 페이지는 본문 컨테이너 자체가 없어 여기서 None이 된다.
  """
  soup = BeautifulSoup(html, 'html.parser')
  container = soup.select_one(POST_CONTENT_SELECTOR)
  if container is None:
    return None

  scored: list[tuple[int, str]] = []
  for img in container.find_all('img'):
    src = img.get('src')
    if not src:
      continue
    url = full_res_image_url(str(src), page_url)
    if media_type_for_url(url) is None:
      continue
    score = score_image_candidate(url)
    if score > 0:
      scored.append((score, url))

  if not scored:
    return None
  scored.sort(key=lambda t: -t[0])
  if len(scored) > 1 and scored[0][0] == scored[1][0]:
    logger.warning(
      f'  차트 후보 이미지가 동점으로 복수 — 첫 항목 채택: {[u for _, u in scored]}'
    )
  return scored[0][1]


def normalize_brand_label(label: str) -> str:
  """단일 라벨 → 공백 제거 + BRAND_ALIASES 정규화."""
  s = str(label).strip()
  return BRAND_ALIASES.get(s.lower(), s)


def normalize_brands(brands: list[dict]) -> list[dict]:
  """라벨 공백 제거 + BRAND_ALIASES 정규화. 값은 건드리지 않는다.

  판독 직후(캐시 hit 포함) 한 번만 적용한다 — 이후 중복 검사가 정규화된 라벨을 보게 해서
  'Mercedes'와 'Mercedes-Benz'가 한 차트에 동시에 나오는 이상 상황도 중복으로 잡힌다.
  """
  return [{**b, 'brand': normalize_brand_label(b.get('brand', ''))} for b in brands]


def normalize_excluded(excluded: list[str]) -> list[str]:
  """이상치 제외 브랜드명 정규화 → 빈 라벨·중복 제거.

  막대 라벨과 **똑같은** BRAND_ALIASES를 적용한다. 안 하면 제외된 달이 'Mercedes-Benz',
  복귀한 달이 'Mercedes'로 적재돼 brand가 PK인 시계열이 두 개로 쪼개진다
  (normalize_brands만 고치고 여기를 빼먹는 게 정확히 그 버그다).
  """
  out: list[str] = []
  seen: set[str] = set()
  for label in excluded:
    lb = normalize_brand_label(label)
    if not lb or lb.upper() in seen:
      continue
    seen.add(lb.upper())
    out.append(lb)
  return out


def validate_extraction(
  brands: list[dict], year_month: int, excluded: list[str] | None = None,
) -> list[str]:
  """vision 판독 결과 검증 → 실패 사유 목록 (빈 리스트면 통과).

  차트가 아닌 이미지를 잘못 골랐거나 자릿수를 오독하면 여기서 걸린다.
  `excluded`는 정규화된 이상치 제외 브랜드 목록(normalize_excluded 통과분).
  """
  fails: list[str] = []
  if not brands:
    fails.append(f'{year_month}: 판독된 막대 0개')
    return fails

  labels = [str(b.get('brand', '')).strip() for b in brands]
  if len(brands) < MIN_BRANDS_EXPECTED:
    fails.append(
      f'{year_month}: 막대 {len(brands)}개 — 최소 {MIN_BRANDS_EXPECTED}개 미만 (차트 일부만 판독?)'
    )
  # NATION 부재 = 재고일수 차트가 아닐 가능성 (다른 이미지를 골랐다는 신호)
  if not any(lb.upper() == NATION_LABEL for lb in labels):
    fails.append(f'{year_month}: 업계 평균 행 {NATION_LABEL!r} 없음 — 차트 오선택 의심')

  seen: set[str] = set()
  for lb in labels:
    key = lb.upper()
    if not lb:
      fails.append(f'{year_month}: 라벨이 빈 항목 존재')
    elif key in seen:
      fails.append(f'{year_month}: 브랜드 중복 — {lb!r}')
    seen.add(key)

  for b in brands:
    v = b.get('days_supply')
    if not isinstance(v, int):
      fails.append(f'{year_month}: {b.get("brand")!r} days_supply 정수 아님 ({v!r})')
    elif v < 0 or v > MAX_PLAUSIBLE_DAYS_SUPPLY:
      fails.append(
        f'{year_month}: {b.get("brand")!r} days_supply={v} — 0~{MAX_PLAUSIBLE_DAYS_SUPPLY} 범위 밖 (자릿수 오독?)'
      )

  # 이상치 제외 브랜드는 막대가 없어서 제외된 것이다. 둘 다에 있으면 판독이 모순이므로
  # 그 달을 통째로 버린다 — 어느 쪽이 맞는지 우리가 알 수 없고, 그대로 두면 같은 브랜드가
  # 값 있는 행과 값 없는 행 사이에서 오락가락한다(PK 충돌로 upsert도 깨진다).
  for lb in (excluded or []):
    if lb.upper() in seen:
      fails.append(
        f'{year_month}: {lb!r}가 막대와 이상치 제외 박스에 동시 등장 — 판독 모순'
      )
  return fails


def build_db_rows(
  brands: list[dict], year_month: int, source_url: str, image_url: str,
  excluded: list[str] | None = None,
) -> list[dict]:
  """판독 결과 → cox_brand_inventory upsert row 목록.

  막대로 읽은 브랜드는 `is_outlier_excluded=False` + 값,
  이상치 제외 브랜드(`excluded`)는 `is_outlier_excluded=True` + `days_supply=None`.
  DB CHECK(cox_brand_inventory_outlier_null_check)가 이 짝을 강제하므로 뒤집으면 적재가 거부된다.
  """
  collected_at = datetime.now(timezone.utc).isoformat()
  rows = [
    {
      'brand': str(b['brand']).strip(),
      'year_month': year_month,
      'days_supply': int(b['days_supply']),
      'is_outlier_excluded': False,
      'source_url': source_url,
      'image_url': image_url,
      'collected_at': collected_at,
    }
    for b in brands
  ]
  # 값을 모르는 게 아니라 "NATION×2 이상이라 Cox가 감췄다"를 표현하는 행이다.
  rows.extend(
    {
      'brand': lb,
      'year_month': year_month,
      'days_supply': None,
      'is_outlier_excluded': True,
      'source_url': source_url,
      'image_url': image_url,
      'collected_at': collected_at,
    }
    for lb in (excluded or [])
  )
  return rows


def add_months(year_month: int, delta: int) -> int:
  """YYYYMM에 개월 수를 더한다 (음수 가능)."""
  year, month = divmod(year_month, 100)
  idx = year * 12 + (month - 1) + delta
  return (idx // 12) * 100 + (idx % 12) + 1


def months_between(a: int, b: int) -> int:
  """a - b를 개월 수로. 둘 다 YYYYMM."""
  ay, am = divmod(a, 100)
  by, bm = divmod(b, 100)
  return (ay * 12 + am) - (by * 12 + bm)


def check_freshness(latest_ym: int, today: date) -> str | None:
  """발견된 최신 데이터 월이 충분히 최신인가 → 문제 사유, 정상이면 None.

  Cox 슬러그 규칙은 이미 두 번 바뀌었다(어순 반전, full/축약 혼용). 또 바뀌면 발견이
  **과거 기사만** 반환하고, 스크립트는 과거 몇 달을 재판독해 같은 값을 upsert한 뒤
  성공 보고를 한다 — 최신 월이 영영 안 들어와도 아무도 모른다. 그 조용한 정지를 막는 게 이 게이트다.

  기준: 데이터 월은 발행 월의 전월(2026-06 데이터 → 2026-07-11~18 발행)이므로
  오늘 기준 전월이 최신이어야 한다. 다만 발행 창(11~18일) 전에 돌리면 전월이 아직 없는 게
  정상이라 PUBLISH_GRACE_DAY까지는 한 달 뒤처짐을 허용한다. 두 달 이상 뒤처지면 항상 실패.
  """
  expected = add_months(today.year * 100 + today.month, -1)
  lag = months_between(expected, latest_ym)
  if lag <= 0:
    return None
  if lag == 1 and today.day <= PUBLISH_GRACE_DAY:
    # 전월 기사가 아직 발행 전일 수 있는 구간 — 정상.
    return None
  return (
    f'최신 발견 월 {latest_ym} — 오늘({today.isoformat()}) 기준 기대 월 {expected}보다 '
    f'{lag}개월 뒤처짐. Cox 슬러그 규칙 변경으로 발견이 멈췄을 가능성 (과거 기사만 반환 중)'
  )


def diff_rows(new_rows: list[dict], existing: dict[tuple[str, int], dict]) -> list[dict]:
  """upsert 예정 행 vs 기존 DB 행 → 값이 바뀌는 행 목록.

  기존 행이 없으면(신규 월·신규 브랜드) 변경이 아니다 — 덮어쓸 게 없다.
  소급 수정이면 정상이지만 LLM 오독이면 이 목록이 유일한 단서다.

  days_supply만 비교하면 is_outlier_excluded 변화도 함께 잡힌다: DB CHECK
  (cox_brand_inventory_outlier_null_check)가 제외 ⟺ 값 null을 강제하므로 플래그가 뒤집히면
  값도 반드시 바뀐다(135 → None). 플래그를 따로 비교하는 코드는 절대 발화하지 않는
  죽은 가지라 두지 않는다(뮤테이션 테스트로 확인 — 해당 조건을 무력화해도 통과했다).
  """
  changes: list[dict] = []
  for r in new_rows:
    old = existing.get((r['brand'], r['year_month']))
    if old is None:
      continue
    if old.get('days_supply') == r['days_supply']:
      continue
    changes.append({
      'brand': r['brand'],
      'year_month': r['year_month'],
      'old_days_supply': old.get('days_supply'),
      'new_days_supply': r['days_supply'],
      'old_excluded': bool(old.get('is_outlier_excluded')),
      'new_excluded': bool(r['is_outlier_excluded']),
    })
  return changes


def months_over_change_threshold(changes: list[dict]) -> dict[int, int]:
  """월별 변경 브랜드 수 중 MAX_CHANGED_BRANDS_PER_MONTH 이상 → {year_month: 변경수}."""
  counts = Counter(c['year_month'] for c in changes)
  return {
    ym: n for ym, n in sorted(counts.items()) if n >= MAX_CHANGED_BRANDS_PER_MONTH
  }


# ---------------------------------------------------------------------------
# 기사 발견 (WordPress REST API)
# ---------------------------------------------------------------------------
def discover_articles(session: requests.Session) -> dict[int, dict]:
  """'insight' 포스트 타입 검색 → {year_month: {'url', 'slug', 'date'}}.

  기본 정렬이 발행일 내림차순이라 최신 월이 먼저 온다. 같은 달 기사가 둘이면
  나중에 발행된 쪽(수정 재게시)을 채택한다.
  """
  found: dict[int, dict] = {}
  for page in range(1, API_MAX_PAGES + 1):
    params = {
      'search': INSIGHT_SEARCH_TERM,
      'per_page': API_PER_PAGE,
      'page': page,
      '_fields': 'slug,date,link',
    }
    try:
      r = session.get(
        INSIGHT_API_URL, params=params, headers=COMMON_HEADERS, timeout=REQUEST_TIMEOUT_S
      )
    except Exception as e:
      raise RuntimeError(f'insight API 요청 실패 (page={page}): {e}') from e
    if r.status_code == 400 and page > 1:
      # WP는 마지막 페이지를 넘기면 400(rest_post_invalid_page_number) — 정상 종료
      break
    if r.status_code != 200:
      raise RuntimeError(f'insight API status={r.status_code} (page={page})')

    batch = r.json()
    if not isinstance(batch, list) or not batch:
      break

    for item in batch:
      slug = item.get('slug') or ''
      ym = parse_year_month_from_slug(slug)
      if ym is None:
        continue
      prev = found.get(ym)
      if prev is None or (item.get('date') or '') > prev['date']:
        found[ym] = {
          'url': item.get('link') or f'{SITE_ROOT}/insights/{slug}/',
          'slug': slug,
          'date': item.get('date') or '',
        }

    if len(batch) < API_PER_PAGE:
      break
  return found


def select_targets(
  found: dict[int, dict], months: int, explicit: list[int],
) -> list[tuple[int, dict]]:
  """처리 대상 [(year_month, meta)] — 최신순 정렬."""
  if explicit:
    out = []
    for ym in sorted(set(explicit), reverse=True):
      meta = found.get(ym)
      if meta is None:
        logger.warning(f'  {ym}: 기사를 찾지 못함 — skip')
        continue
      out.append((ym, meta))
    return out
  return sorted(found.items(), key=lambda t: -t[0])[:months]


# ---------------------------------------------------------------------------
# 이미지 fetch + sha256 캐시
# ---------------------------------------------------------------------------
def _meta_path(year_month: int) -> Path:
  return IMAGE_CACHE_DIR / f'{year_month}.meta.json'


def load_cache_meta(year_month: int) -> dict | None:
  p = _meta_path(year_month)
  if not p.exists():
    return None
  try:
    with p.open('r', encoding='utf-8') as f:
      return json.load(f)
  except Exception as e:
    logger.debug(f'  {year_month}: 캐시 meta 읽기 실패 {e}')
    return None


def save_cache_meta(year_month: int, meta: dict) -> None:
  IMAGE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
  with _meta_path(year_month).open('w', encoding='utf-8') as f:
    json.dump(meta, f, ensure_ascii=False, indent=2)


def fetch_article_html(session: requests.Session, url: str) -> str:
  r = session.get(url, headers=COMMON_HEADERS, timeout=REQUEST_TIMEOUT_S)
  if r.status_code != 200:
    raise RuntimeError(f'기사 status={r.status_code}: {url}')
  return r.text


def download_image(session: requests.Session, url: str) -> tuple[bytes, str]:
  """이미지 → (bytes, sha256)."""
  r = session.get(url, headers=COMMON_HEADERS, timeout=REQUEST_TIMEOUT_S)
  if r.status_code != 200:
    raise RuntimeError(f'이미지 status={r.status_code}: {url}')
  data = r.content
  return data, hashlib.sha256(data).hexdigest()


def save_image_copy(year_month: int, image_url: str, data: bytes) -> None:
  """판독 근거 보존용 원본 사본. 재판독·오독 조사에 쓴다."""
  ext = Path(image_url.split('?', 1)[0]).suffix.lower() or '.img'
  IMAGE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
  (IMAGE_CACHE_DIR / f'{year_month}{ext}').write_bytes(data)


# ---------------------------------------------------------------------------
# LLM vision 판독
# ---------------------------------------------------------------------------
def call_anthropic_for_chart(
  client: Anthropic, image_bytes: bytes, media_type: str, year_month: int,
) -> dict | None:
  """차트 이미지 → {'brands': [...], 'excluded_outlier_brands': [...]}. 실패 시 None.

  **temperature를 넘기지 않는다 — 넘기면 400으로 죽는다.** Opus 4.7부터 sampling 파라미터
  (temperature/top_p/top_k)가 제거됐다. 2026-07-15 실측:
      temperature=0 → BadRequestError 400 "`temperature` is deprecated for this model."
  즉 "SDK 기본 temperature=1.0으로 샘플링된다"는 건 이 모델엔 해당이 없다(SDK가 애초에
  안 보낸다). 추출 태스크의 결정성을 temperature로 사는 건 이 모델에선 불가능하고,
  설령 가능했어도 temperature=0이 동일 출력을 보장한 적은 없다.
  → 재판독 흔들림은 upsert 직전 기존 DB 값 대조(diff_rows)로 잡는다. 그게 모델 무관하게 동작한다.
  COX_INVENTORY_MODEL로 구형 모델을 지정하면 temperature가 받아들여지지만,
  기본값(claude-opus-4-7)에서 죽지 않는 쪽을 택한다.
  """
  b64 = base64.standard_b64encode(image_bytes).decode('utf-8')
  year, month = divmod(year_month, 100)
  prompt = (
    f"This image is Cox Automotive's new-vehicle days' supply bar chart for "
    f'{year}-{month:02d}.\n\n'
    'Read EVERY bar, left to right, and call submit_brand_inventory.\n\n'
    'Rules:\n'
    '  - Each bar has its value printed directly above it. Read that printed number. '
    'Do NOT estimate values from bar height.\n'
    '  - Use the x-axis label exactly as printed (e.g. "Land Rover", "Volkswagen", "MINI").\n'
    "  - One bar is the industry average, drawn in green and labeled 'NATION'. "
    "Include it with brand='NATION'.\n"
    '  - Bold text does NOT mark the industry average — rely only on the label text.\n'
    '  - Include every bar, even brands with low volume. Do not skip or merge bars.\n'
    '  - Do not invent brands that are absent from the chart. Some brands are deliberately\n'
    '    omitted from the bars and listed only in a side box (see excluded_outlier_brands);\n'
    '    report those there, never as a bar with a guessed value.'
  )

  try:
    msg = client.messages.create(
      model=ANTHROPIC_MODEL,
      max_tokens=LLM_MAX_TOKENS,
      tools=[BRAND_INVENTORY_TOOL],
      tool_choice={'type': 'tool', 'name': 'submit_brand_inventory'},
      messages=[
        {
          'role': 'user',
          'content': [
            {
              'type': 'image',
              'source': {'type': 'base64', 'media_type': media_type, 'data': b64},
            },
            {'type': 'text', 'text': prompt},
          ],
        }
      ],
    )
  except Exception as e:
    logger.error(f'  {year_month}: Anthropic 호출 실패 — {e}')
    return None

  for block in msg.content:
    if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_brand_inventory':
      data = dict(block.input)
      return {
        'brands': list(data.get('brands') or []),
        'excluded_outlier_brands': list(data.get('excluded_outlier_brands') or []),
      }

  logger.error(f'  {year_month}: tool_use 응답 없음 (stop_reason={msg.stop_reason})')
  return None


# ---------------------------------------------------------------------------
# 월 단위 처리
# ---------------------------------------------------------------------------
def _log_excluded(year_month: int, excluded: list[str]) -> None:
  """차트에서 제외된 이상치 브랜드를 로그로 남긴다.

  값 자체는 소스가 공개하지 않아 지어내지 않지만, 행은 적재한다
  (`days_supply=None, is_outlier_excluded=True`) — 재고가 가장 심각한 달의 신호라
  로그로만 남기면 CI에서 증발한다.
  """
  if excluded:
    logger.warning(
      f'    {year_month}: 업계 평균 2배 초과로 차트에서 제외된 브랜드 — {", ".join(excluded)} '
      f'(수치 미공개 → days_supply=null + is_outlier_excluded=true로 적재)'
    )


def process_month(
  session: requests.Session, client: Anthropic | None, year_month: int, meta: dict,
  reprocess: bool,
) -> tuple[list[dict], list[str], bool]:
  """단일 월 → (db_rows, fails, used_llm)."""
  source_url = meta['url']
  logger.info(f'  {year_month}: {source_url}')

  try:
    html = fetch_article_html(session, source_url)
  except Exception as e:
    return [], [f'{year_month}/fetch: {e}'], False

  image_url = select_chart_image(html, source_url)
  if not image_url:
    return [], [f'{year_month}/image: 본문에서 브랜드 차트 이미지 미발견'], False

  media_type = media_type_for_url(image_url)
  if media_type is None:
    return [], [f'{year_month}/image: 지원 밖 포맷 — {image_url}'], False

  try:
    image_bytes, sha = download_image(session, image_url)
  except Exception as e:
    return [], [f'{year_month}/image: {e}'], False

  cached = load_cache_meta(year_month)
  if not reprocess and cached and cached.get('sha256') == sha and cached.get('brands'):
    # 이미지 무변경 → 판독 결과 재사용(LLM 호출 0). 그래도 upsert는 한다 — 멱등.
    # 캐시가 BRAND_ALIASES 추가 이전 것일 수 있으므로 정규화는 여기서도 다시 적용한다.
    brands = normalize_brands(cached['brands'])
    excluded = normalize_excluded(cached.get('excluded_outlier_brands') or [])
    logger.info(f'    CACHED (sha256 일치) — 브랜드 {len(brands)}개 재사용')
    _log_excluded(year_month, excluded)
    return (
      build_db_rows(brands, year_month, source_url, image_url, excluded), [], False,
    )

  if client is None:
    return [], [f'{year_month}: ANTHROPIC_API_KEY 없음 — 판독 불가'], False

  logger.info(f'    판독 {image_url.split("/")[-1]} ({len(image_bytes)/1024:.0f} KB, sha={sha[:8]})')
  extracted = call_anthropic_for_chart(client, image_bytes, media_type, year_month)
  if extracted is None:
    return [], [f'{year_month}: vision 판독 실패'], True

  brands = normalize_brands(extracted['brands'])
  excluded = normalize_excluded(extracted['excluded_outlier_brands'])
  fails = validate_extraction(brands, year_month, excluded)
  if fails:
    return [], fails, True

  _log_excluded(year_month, excluded)
  save_image_copy(year_month, image_url, image_bytes)
  save_cache_meta(year_month, {
    'sha256': sha,
    'image_url': image_url,
    'source_url': source_url,
    'slug': meta.get('slug'),
    'published_at': meta.get('date'),
    'extracted_at': datetime.now(timezone.utc).isoformat(),
    'model': ANTHROPIC_MODEL,
    # 정규화 전 원본 라벨을 그대로 남긴다 — 소스 표기 변화 추적용.
    'brands': extracted['brands'],
    'excluded_outlier_brands': extracted['excluded_outlier_brands'],
  })
  return (
    build_db_rows(brands, year_month, source_url, image_url, excluded), [], True,
  )


def fetch_existing_rows(year_months: list[int]) -> dict[tuple[str, int], dict]:
  """대상 월의 기존 DB 행 → {(brand, year_month): {days_supply, is_outlier_excluded}}.

  upsert가 조용히 덮어쓰기 전에 대조할 기준값. 대상 월만 좁혀 읽으므로
  (기본 3개월 × ~30 브랜드 ≈ 90행) PostgREST 1000행 상한과 무관하다.
  """
  client = get_client()
  resp = (
    client.table('cox_brand_inventory')
    .select('brand,year_month,days_supply,is_outlier_excluded')
    .in_('year_month', sorted(year_months))
    .order('year_month')
    .order('brand')
    .execute()
  )
  return {
    (r['brand'], r['year_month']): r for r in (resp.data or [])
  }


def _report_changes(all_rows: list[dict]) -> tuple[list[dict], list[str]]:
  """기존 DB 값과 대조 → (임계 초과 월을 뺀 행 목록, 실패 사유).

  소급 수정이면 정상이고 LLM 오독이면 이 로그가 유일한 단서다. 둘을 자동으로 구분할 수는
  없으므로(캐시가 CI에 없어 '이미지가 실제로 바뀌었는지'도 모른다) 전부 남기고,
  대량 변경만 사람이 보게 막는다.
  """
  existing = fetch_existing_rows(sorted({r['year_month'] for r in all_rows}))
  changes = diff_rows(all_rows, existing)
  if not changes:
    logger.info(f'  기존 DB와 값 변경 없음 (대조 {len(existing)}행)')
    return all_rows, []

  logger.warning(f'  기존 DB 값과 달라진 행 {len(changes)}건:')
  for c in sorted(changes, key=lambda c: (-c['year_month'], c['brand'])):
    old = '제외' if c['old_excluded'] else c['old_days_supply']
    new = '제외' if c['new_excluded'] else c['new_days_supply']
    logger.warning(f"    {c['year_month']} {c['brand']}: {old} → {new}")

  over = months_over_change_threshold(changes)
  if not over:
    return all_rows, []

  fails = [
    f'{ym}: 기존 DB 대비 {n}개 브랜드 변경 — 임계 {MAX_CHANGED_BRANDS_PER_MONTH} 이상이라 '
    f'적재 보류 (소급 수정이면 --year-month {ym}로 개별 확인 후 재실행)'
    for ym, n in over.items()
  ]
  kept = [r for r in all_rows if r['year_month'] not in over]
  logger.error(
    f'  대량 변경 월 {sorted(over)} 적재 제외 — 남은 행 {len(kept)}/{len(all_rows)}'
  )
  return kept, fails


def _fmt_row(row: dict) -> str:
  """dry-run 출력용 한 행 표기. 이상치 제외 행은 값 대신 표식."""
  if row['is_outlier_excluded']:
    return f'{row["brand"]} [제외:NATION×2↑]'
  return f'{row["brand"]} {row["days_supply"]}'


def parse_args() -> argparse.Namespace:
  p = argparse.ArgumentParser(description="Cox 브랜드별 신차 재고일수 수집.")
  p.add_argument('--months', type=int, default=DEFAULT_RECENT_MONTHS,
                 help=f'최근 N개월 처리 (default {DEFAULT_RECENT_MONTHS} — 소급 수정 재적재)')
  p.add_argument('--year-month', type=int, action='append', default=[],
                 metavar='YYYYMM', help='특정 월만 (반복 지정 가능). 지정 시 --months 무시')
  p.add_argument('--reprocess-all', action='store_true',
                 help='sha256 캐시 무시하고 전부 LLM 재판독')
  p.add_argument('--dry-run', action='store_true',
                 help='DB 쓰기 없이 판독·검증 결과만 (vision 호출은 수행)')
  return p.parse_args()


def main() -> int:
  args = parse_args()
  logger.info(
    f'Cox 브랜드 재고일수 수집: months={args.months} year_month={args.year_month or "-"} '
    f'dry_run={args.dry_run} reprocess={args.reprocess_all} model={ANTHROPIC_MODEL}'
  )

  api_key = os.environ.get('ANTHROPIC_API_KEY')
  if not api_key:
    logger.warning('ANTHROPIC_API_KEY 미설정 — 캐시 hit인 월만 처리 가능')
  client = Anthropic(api_key=api_key) if api_key else None

  session = requests.Session()
  found = discover_articles(session)
  logger.info(f'월간 재고 기사 {len(found)}건 발견 (최신 {max(found) if found else "-"})')
  if not found:
    logger.error('기사 발견 0건 — 사이트 구조 또는 REST API 변경 가능성')
    return 1

  # 조용한 정지 방지: 발견이 과거 기사만 반환하면 재판독→같은 값 upsert→exit 0으로 성공
  # 보고가 나고 최신 월이 영영 안 들어와도 아무도 모른다. 여기서 exit code로 드러낸다.
  stale = check_freshness(max(found), date.today())
  if stale:
    logger.error(f'freshness 게이트 실패 — {stale}')

  targets = select_targets(found, args.months, args.year_month)
  if not targets:
    logger.error('처리 대상 없음 — 필터 확인')
    return 1

  all_rows: list[dict] = []
  fails: list[str] = []
  llm_calls = 0
  for i, (ym, meta) in enumerate(targets):
    if i:
      time.sleep(REQUEST_SLEEP_S)
    rows, f, used_llm = process_month(session, client, ym, meta, args.reprocess_all)
    llm_calls += int(used_llm)
    if f:
      fails.extend(f)
      continue
    all_rows.extend(rows)
    nation = next((r['days_supply'] for r in rows if r['brand'].upper() == NATION_LABEL), None)
    n_excluded = sum(1 for r in rows if r['is_outlier_excluded'])
    logger.success(
      f'    OK 브랜드 {len(rows)}개 (막대 {len(rows) - n_excluded} + 이상치제외 {n_excluded}, '
      f'NATION={nation})'
    )

  logger.info(f'처리 완료: 대상={len(targets)} LLM호출={llm_calls} DB rows={len(all_rows)}')

  # 기존 DB 값 대조 — dry-run에서도 수행한다(SELECT뿐이라 쓰기 없음).
  # 적재 전에 "무엇이 덮어써지는가"를 보는 게 dry-run의 목적이다.
  if all_rows:
    all_rows, change_fails = _report_changes(all_rows)
    fails.extend(change_fails)

  if fails:
    logger.warning(f'실패 {len(fails)}건:')
    for f in fails:
      logger.warning(f'  {f}')

  if args.dry_run:
    for ym in sorted({r['year_month'] for r in all_rows}, reverse=True):
      # days_supply=None(이상치 제외)이 섞이므로 None을 뒤로 몰아 정렬한다
      # (None과 int 직접 비교는 TypeError).
      rows = sorted(
        (r for r in all_rows if r['year_month'] == ym),
        key=lambda r: (r['days_supply'] is None, r['days_supply'] or 0),
      )
      logger.info(
        f'  [{ym}] ' + ', '.join(_fmt_row(r) for r in rows)
      )
    logger.success(f'dry-run 종료 (DB 쓰기 없음). rows={len(all_rows)}')
    return EXIT_STALE if stale else (1 if fails else 0)

  if not all_rows:
    logger.warning('적재할 행 없음 — DB 호출 생략')
    return EXIT_STALE if stale else (1 if fails else 0)

  try:
    with WriteSession() as w:
      w.table('cox_brand_inventory').upsert(
        all_rows, on_conflict='brand,year_month',
      ).execute()
    logger.success(f'cox_brand_inventory upsert 완료: {len(all_rows)}행')
  except Exception as e:
    logger.exception(f'upsert 실패: {e}')
    return 2

  # freshness 실패는 개별 월 실패보다 심각(발견 자체가 멈춤)하므로 우선 반환한다.
  return EXIT_STALE if stale else (1 if fails else 0)


if __name__ == '__main__':
  try:
    sys.exit(main())
  except KeyboardInterrupt:
    logger.warning('사용자 중단')
    sys.exit(130)
  except Exception as e:
    logger.exception(f'예기치 못한 오류: {e}')
    sys.exit(1)
