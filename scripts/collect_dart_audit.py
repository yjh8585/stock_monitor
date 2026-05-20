#!/usr/bin/env python3
"""
국내 비상장 외감법인의 연결감사보고서를 DART에서 직접 파싱해 재무 데이터를 수집한다.

흐름:
  1) companies 테이블에서 data_source='dart' 회사 로드(dart_corp_code 수동 매핑 포함).
  2) _resolve_corp_code: DB 매핑 우선 → corpCode.xml 양방향 정규화 매치 → 부분 일치 +
     자동차 업종(induty prefix) 우선.
  3) _get_audit_rcpt: 회계연도 N 보고서 후보 수집(검색 기간 N년부터 N+5년) →
     [기재정정] > 연결 > 별도 + 최신 rcept_dt 점수로 1건 선택.
  4) _get_main_doc_url: sub_docs 우선, 실패 시 main.do 트리 노드 직접 파싱(length 최대값 본문).
  5) _fetch_tables: HTML 테이블 다운로드(지수 백오프 3회 재시도). PDF 전용 보고서는 검출 후 WARN.
  6) _parse_financial_tables: 표 단위(백만원/천원/원) 자동 인식 + 동적 숫자 컬럼 감지로 파싱.
  7) financials upsert. dedup은 같은 (company_id, fiscal_year)에 대해 더 최근 보고서가 우선,
     값이 다른 컬럼은 WARN 로그(정정 추적).

단위: DART 문서의 원(KRW) 단위 → 백만원으로 변환해 저장.
"""
import contextlib
import io as _io_mod
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from dotenv import dotenv_values, load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows

DART_KEY = ''
try:
  _env = dotenv_values(Path(__file__).parent / '.env')
  DART_KEY = _env.get('DART_API_KEY', '')
except Exception:
  pass
DART_KEY = DART_KEY or os.environ.get('DART_API_KEY', '')

MILLION = 1_000_000
GENERATED_COLS = frozenset({'operating_margin', 'gross_margin', 'net_margin', 'debt_ratio'})
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

# DART는 매번 새 연결을 열면 SSL_EOF가 폭증한다 — 모듈 싱글톤 세션으로 keep-alive 유지.
_session = requests.Session()
_session.headers.update(HEADERS)

# 회사 간 sleep (DART rate limit 완화)
COMPANY_SLEEP = float(os.environ.get('COMPANY_SLEEP', '0.5'))
# 정정본 추적용 검색 기간 확장 (회계연도 N → N+AUDIT_LOOKBACK_YEARS년까지 정정 추적)
AUDIT_LOOKBACK_YEARS = int(os.environ.get('AUDIT_LOOKBACK_YEARS', '5'))
# 수집 대상 회계연도 — 직전 회계연도부터 과거 N년치
YEARS_BACK = int(os.environ.get('YEARS_BACK', '4'))
# corp_code 해소 1회당 최대 대기 (단일 회사 hang 방지)
RESOLVE_CORP_CODE_TIMEOUT = int(os.environ.get('RESOLVE_CORP_CODE_TIMEOUT', '60'))

# DART 계정명 → DB 컬럼 매핑 (완전 일치 우선, 부분 일치 fallback)
ACCT_TO_DB: dict[str, str] = {
  '매출액': 'revenue',
  '매출': 'revenue',
  '영업수익': 'revenue',
  '수익(매출액)': 'revenue',
  '매출(영업수익)': 'revenue',
  '매출원가': 'cogs',
  '판매비와관리비': 'sga',
  '판매비및관리비': 'sga',
  '판관비': 'sga',
  '영업이익': 'operating_income',
  '영업이익(손실)': 'operating_income',
  '영업손실': 'operating_income',
  '당기순이익': 'net_income',
  '당기순이익(손실)': 'net_income',
  '지배기업주주귀속순이익': 'net_income',
  '자산총계': 'total_assets',
  '부채총계': 'total_liabilities',
  '자본총계': 'total_equity',
  '재고자산': 'inventory',
}

# 키워드 부분 일치로 잘못 잡힐 가능성이 있는 함정 계정명 — 매칭 거부.
ACCT_REJECT = frozenset({
  '매출원가율',
  '매출총이익', '매출총손익',
  '매출채권', '매출채권및기타채권',
  '단기차입금', '장기차입금',
  '영업외수익', '영업외비용', '기타수익', '기타영업수익',
  '금융수익', '금융비용', '미실현수익', '이연수익',
  '이연법인세자산', '이연법인세부채',
  '영업이익률', '영업비용',
  '비지배지분순이익', '비지배지분', '비지배주주순이익',
  '매출액및영업이익',
  '판매관리비',
})

# 자동차/운송장비/부품 가능 업종 KSIC prefix (한국표준산업분류 대분류 2자리).
# 24=1차금속, 25=금속가공, 26=전자부품, 27=정밀기기, 28=전기장비, 29=기타기계,
# 30=자동차, 31=기타운송장비, 32=가구, 33=기타제품, 46=도매업.
_AUTO_INDUTY_PREFIXES = ('24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '46')

# 법인 형태 접미사/접두사 정규화 — DB(짧음) ↔ DART(정식명) 매칭용.
_LEGAL_FORM_RE = re.compile(r'(주식회사|유한책임회사|유한회사|\(주\)|\(유\))')

# 한글 음역 → 영문 발음 (greedy longest match용 — 긴 자모가 먼저).
_JAMO_TO_ENG: dict[str, str] = {
  '에이치': 'h', '더블유': 'w', '더블류': 'w',  # '더블류'는 흔한 이형 표기
  '에이': 'a', '에스': 's', '에프': 'f', '와이': 'y', '엑스': 'x',
  '제이': 'j', '제트': 'z', '브이': 'v', '아이': 'i', '케이': 'k',
  '비': 'b', '시': 'c', '디': 'd', '이': 'e', '지': 'g',
  '엘': 'l', '엠': 'm', '엔': 'n', '오': 'o', '피': 'p',
  '큐': 'q', '알': 'r', '티': 't', '유': 'u',
}

# 자동차 부품 업계 한국어 단어 → 영문 (음역 변환과 동시에 적용).
_KOR_WORD_TO_ENG: dict[str, str] = {
  '오토모티브': 'automotive', '모티브': 'motiv',
  '시스템즈': 'systems', '시스템스': 'systems', '시스템': 'system',
  '테크놀로지스': 'technologies', '테크놀로지': 'technology', '테크': 'tech',
  '모듈': 'module', '모빌리티': 'mobility',
  '에너지': 'energy', '솔루션': 'solution', '인더스트리': 'industry',
  '글로벌': 'global', '코리아': 'korea', '아메리카': 'america',
  '오토텍': 'autotech', '일렉트로닉스': 'electronics', '인터내셔널': 'international',
  '컴포넌트': 'component', '컴포넌츠': 'components',
  '머티리얼스': 'materials', '머티리얼': 'material',
  '엔지니어링': 'engineering', '디자인': 'design',
  '센서스': 'sensors', '센서': 'sensor', '컨트롤스': 'controls', '컨트롤': 'control',
  '와이퍼': 'wiper', '미러': 'mirror', '씰': 'seal',
  '메탈': 'metal', '플라스틱': 'plastic', '러버': 'rubber', '폴리머': 'polymer',
  '바디': 'body', '섀시': 'chassis', '엔진': 'engine',
  '브레이크스': 'brakes', '브레이크': 'brake',
  '트랜스미션': 'transmission', '미션': 'mission', '드라이브': 'drive',
  '액슬': 'axle', '베어링스': 'bearings', '베어링': 'bearing',
  '클러치': 'clutch', '필터': 'filter', '램프': 'lamp',
  '디스플레이': 'display', '카메라': 'camera',
  '커넥티비티': 'connectivity', '커넥터': 'connector',
  '하니스': 'harness', '하네스': 'harness', '와이어링': 'wiring', '와이어': 'wire',
  '인터페이스': 'interface', '한국': 'korea',
  '홀딩스': 'holdings', '홀딩': 'holding', '그룹': 'group',
  '인베스트먼트': 'investment', '캐피탈': 'capital', '캐피털': 'capital',
}

# greedy longest match용 변환 테이블 (단어 사전 + 자모 매핑, 키 길이 내림차순).
_KOR_TO_ASCII_TABLE: list[tuple[str, str]] = sorted(
  list(_KOR_WORD_TO_ENG.items()) + list(_JAMO_TO_ENG.items()),
  key=lambda kv: -len(kv[0]),
)

# 영문 약어 → 한글 자모 음역 (DB 'HL클레무브' ↔ DART '에이치엘클레무브' 매칭용).
_ENG_TO_JAMO: dict[str, str] = {
  'A': '에이', 'B': '비', 'C': '씨', 'D': '디', 'E': '이', 'F': '에프',
  'G': '지', 'H': '에이치', 'I': '아이', 'J': '제이', 'K': '케이', 'L': '엘',
  'M': '엠', 'N': '엔', 'O': '오', 'P': '피', 'Q': '큐', 'R': '알',
  'S': '에스', 'T': '티', 'U': '유', 'V': '브이', 'W': '더블유', 'X': '엑스',
  'Y': '와이', 'Z': '제트',
}


def _normalize_corp_name(name: str) -> str:
  """회사명에서 법인 형태와 공백을 제거해 매칭 키 형태로 정규화."""
  s = _LEGAL_FORM_RE.sub('', name or '')
  return re.sub(r'\s+', '', s).strip()


def _ascii_part(s: str) -> str:
  """문자열에서 ASCII 영문/숫자만 추출(소문자화). 영문/한글 혼용 매칭용.

  예: 'SNT모티브' → 'snt', 'SNT Motiv' → 'sntmotiv', '에스엔티모티브' → ''
  """
  return re.sub(r'[^A-Za-z0-9]+', '', s or '').lower()


def _ascii_to_korean(s: str) -> str:
  """영문 알파벳을 한글 자모 음역으로, 한글/숫자는 그대로 유지.

  DB가 영문 약어를 그대로 쓰지만(예: 'HL클레무브') DART corp_name은
  완전 한글 음역(예: '에이치엘클레무브')일 때의 매칭 보완용.

  예: 'HL클레무브' → '에이치엘클레무브', 'KBI메탈' → '케이비아이메탈',
      'SNT다이내믹스' → '에스엔티다이내믹스'
  """
  if not s:
    return ''
  result: list[str] = []
  for ch in s:
    if ch.isascii() and ch.isalpha():
      result.append(_ENG_TO_JAMO.get(ch.upper(), ''))
    else:
      result.append(ch)
  return ''.join(result)


def _korean_to_ascii(s: str) -> str:
  """한글 음역·자동차 업계 한국어 단어를 영문 ASCII로 변환.

  greedy longest match: 긴 단어/자모를 먼저 매칭(예: '에이치'→'h'가 '에이'→'a'보다 우선).
  변환된 영문과 원본 ASCII만 살리고 소문자화. 변환 불가 한글은 제거.

  예: '에스에이치비' → 'shb', '에스엠알오토모티브모듈코리아' → 'smrautomotivemodulekorea',
      '케이비와이퍼시스템' → 'kbwipersystem', '한국에스케이에프씰' → 'koreaskfseal'
  """
  if not s:
    return ''
  result: list[str] = []
  i = 0
  n = len(s)
  while i < n:
    matched = False
    for kor, eng in _KOR_TO_ASCII_TABLE:
      if s.startswith(kor, i):
        result.append(eng)
        i += len(kor)
        matched = True
        break
    if not matched:
      ch = s[i]
      if 'A' <= ch <= 'Z' or 'a' <= ch <= 'z' or '0' <= ch <= '9':
        result.append(ch)
      i += 1
  return re.sub(r'[^A-Za-z0-9]+', '', ''.join(result)).lower()


def _is_transient_error(e: Exception) -> bool:
  """일시적 네트워크/SSL 에러만 재시도 대상으로 판정."""
  if isinstance(e, FuturesTimeout):
    return True
  msg = str(e).lower()
  return (
    isinstance(e, (requests.exceptions.ConnectionError, requests.exceptions.Timeout))
    or 'ssleof' in msg
    or 'connection reset' in msg
    or 'connection broken' in msg
    or 'timed out' in msg
  )


def _with_retry(
  fn,
  *args,
  _attempts: int = 5,
  _backoff: float = 1.0,
  _deadline: float | None = None,
  _silence_stdout: bool = False,
  **kwargs,
):
  """지수 백오프 재시도. 일시적 네트워크/SSL 에러만 재시도, 다른 예외는 즉시 raise.
  기본 2회(즉시+1회 재시도, 0.5s 대기). _deadline 지정 시 별도 스레드에서 실행해 시간 초과면
  강제로 TimeoutError 발생(OpenDartReader 내부의 무한 hang 방어용).
  _silence_stdout=True 시 fn 호출 동안 stdout을 캡처(OpenDartReader가 status 013 같은
  빈 응답을 raw print하는 노이즈 차단)."""
  last = None

  def _silencer():
    return (
      contextlib.redirect_stdout(_io_mod.StringIO())
      if _silence_stdout
      else contextlib.nullcontext()
    )

  for i in range(_attempts):
    try:
      with _silencer():
        if _deadline is None:
          return fn(*args, **kwargs)
        with ThreadPoolExecutor(max_workers=1) as ex:
          return ex.submit(fn, *args, **kwargs).result(timeout=_deadline)
    except Exception as e:
      last = e
      if i < _attempts - 1 and _is_transient_error(e):
        wait = _backoff * (2 ** i)
        logger.debug(f'  재시도 {i+1}/{_attempts} ({type(e).__name__}: {e}) → {wait}s 대기')
        time.sleep(wait)
        continue
      raise
  raise last  # 도달하지 않음


def _target_years() -> list[int]:
  """직전 회계연도부터 과거 YEARS_BACK 년치 (최신 우선)."""
  this_year = datetime.now().year
  return list(range(this_year - 1, this_year - 1 - YEARS_BACK, -1))


def _get_dart():
  """OpenDartReader 클라이언트 반환."""
  try:
    from opendartreader import OpenDartReader as ODR
  except ImportError:
    try:
      import OpenDartReader as ODR  # 구버전(단일 파일 모듈) 호환
    except ImportError as e:
      logger.error(f'OpenDartReader import 실패: {e!r}')
      return None
  if not DART_KEY:
    logger.error('DART_API_KEY 없음')
    return None
  return ODR(DART_KEY)


def _normalize(s: str) -> str:
  """공백·비공백(\xa0) 문자 제거해 계정명을 정규화한다."""
  return re.sub(r'[\s\xa0]+', '', s)


def _parse_num(s: str) -> float | None:
  """문자열에서 숫자 파싱. 괄호는 음수로 처리.

  콤마는 한국 회계 천 단위 구분자만 허용 (3자리 그룹).
  주석번호 셀(예: '6,27,35', '17,18')은 콤마 위치가 비표준이라 None을 반환.
  """
  s = s.strip().replace(' ', '')
  negative = s.startswith('(') and s.endswith(')')
  s = s.strip('()')
  if not s or s in ('-', '', 'None'):
    return None
  if ',' in s:
    body = s.lstrip('-')
    parts = body.split(',')
    if not parts[0].isdigit() or not (1 <= len(parts[0]) <= 3):
      return None
    for p in parts[1:]:
      head = p.split('.')[0]
      if not head.isdigit() or len(head) != 3:
        return None
    s = s.replace(',', '')
  try:
    v = float(s)
    return -v if negative else v
  except (ValueError, TypeError):
    return None


def _clean_acct(raw: str) -> str:
  """계정명 정규화: 공백 제거 → 주석·서수 접두어 제거."""
  s = _normalize(raw)
  s = re.sub(r'\(주석\d+.*?\)', '', s)
  s = re.sub(r'^[Ⅰ-Ⅿⅰ-ⅿ가-힣]+\.', '', s)
  s = re.sub(r'^\(\d+\)\.?', '', s)
  s = re.sub(r'^\d+\.', '', s)
  return s.strip()


def _match_acct(raw: str) -> str | None:
  """계정명을 ACCT_TO_DB에서 찾는다. 완전 일치 → 부분 일치 순. ACCT_REJECT는 거부."""
  clean = _clean_acct(raw)
  if not clean:
    return None
  if clean in ACCT_REJECT or any(rej in clean for rej in ACCT_REJECT):
    return None
  if clean in ACCT_TO_DB:
    return ACCT_TO_DB[clean]
  for key, col in ACCT_TO_DB.items():
    if key in clean:
      return col
  return None


def _detect_unit_divider(tbl_text: str) -> int:
  """표 본문 텍스트에서 단위(백만원/천원/원) 인식 → 백만원 환산 divider 반환."""
  if '백만원' in tbl_text:
    return 1
  if '천원' in tbl_text:
    return 1000
  return MILLION


def _table_unit_divider(table) -> int:
  """표 본문 + 직전 5개 sibling 텍스트에서 단위 인식.
  단위 표기가 표 위 sibling 요소(예: '(단위:백만원)')에 있는 보고서 대응."""
  text = _normalize(table.get_text())
  prev = table
  for _ in range(5):
    prev = prev.find_previous(['p', 'div', 'td', 'b', 'strong', 'span', 'th'])
    if prev is None:
      break
    text += ' ' + _normalize(prev.get_text())
  return _detect_unit_divider(text)


def _filter_annotation_nums(nums: list[float]) -> list[float]:
  """주석번호처럼 자릿수가 본 데이터보다 4자리 이상 작은 값을 제거.
  예: 손익계산서 매출액 행 [33, 125_356_270_873, 117_677_526_325]에서 '33'은 주석번호."""
  if len(nums) < 2:
    return nums
  nonzero = [abs(v) for v in nums if v != 0]
  if not nonzero:
    return nums
  mx = max(nonzero)
  threshold = mx / 10000
  return [v for v in nums if v == 0 or abs(v) >= threshold]


def _parse_financial_tables(tables: list) -> dict[str, dict[str, float | None]]:
  """재무제표 테이블 목록에서 {db_col: {current, prior}} 형태로 파싱한다.

  표 구조 처리: 계정명 셀(첫 셀) 다음의 모든 셀에서 숫자 컬럼을 동적으로 추출.
  - 짝수 개 숫자: [당기세부..당기합계, 전기세부..전기합계] 가정 → 양쪽 마지막(합계) 사용.
  - 홀수 개 숫자(또는 2개): 첫 두 개를 당기/전기로 사용.
  - 단일: 당기만.
  """
  result: dict[str, dict[str, float | None]] = {}
  seen: set[str] = set()

  for tbl in tables:
    tbl_text = _normalize(tbl.get_text())
    if not any(kw in tbl_text for kw in ACCT_TO_DB):
      continue

    divider = _table_unit_divider(tbl)

    for row in tbl.find_all('tr'):
      cells = [td.get_text(strip=True) for td in row.find_all(['th', 'td'])]
      if len(cells) < 2:
        continue

      db_col = _match_acct(cells[0])
      if db_col is None or db_col in GENERATED_COLS or db_col in seen:
        continue

      # 계정명 셀 이후의 모든 셀에서 숫자만 추출 (주석 번호·빈 셀·기호 무시)
      nums = [v for c in cells[1:] for v in (_parse_num(c),) if v is not None]
      if not nums:
        continue
      # 자릿수가 본 데이터보다 4자리 이상 작은 값(주석번호 등)을 제거
      nums = _filter_annotation_nums(nums)

      n = len(nums)
      if n == 1:
        curr, prior = nums[0], None
      elif n == 2:
        curr, prior = nums[0], nums[1]
      elif n % 2 == 0:
        # 짝수: [당기..당기합계, 전기..전기합계] → 양쪽 마지막
        half = n // 2
        curr, prior = nums[half - 1], nums[n - 1]
      else:
        curr, prior = nums[0], nums[1]

      result[db_col] = {
        'current': curr / divider,
        'prior': prior / divider if prior is not None else None,
      }
      seen.add(db_col)

  return result


def _score_report(report_nm: str, rcept_dt: str) -> tuple[int, str]:
  """보고서 우선순위 점수. (등급, rcept_dt) — 큰 값이 우선.

  등급 가중치:
    + 4점: [기재정정] 포함 (정정본 우선)
    + 2점: '연결' 포함 (연결재무제표 우선)
    + 1점: '감사보고서' 포함 (다른 공시 제외)
  rcept_dt: 동률일 때 최신순.
  """
  score = 0
  if '[기재정정]' in report_nm:
    score += 4
  if '연결' in report_nm:
    score += 2
  if '감사보고서' in report_nm:
    score += 1
  return (score, rcept_dt)


def _infer_fiscal_year_from_rcept(rcept_dt: str) -> int | None:
  """rcept_dt(YYYYMMDD)에서 회계연도 추정. 1~6월 제출이면 N-1, 7~12월이면 N."""
  if not rcept_dt or len(rcept_dt) != 8:
    return None
  try:
    y = int(rcept_dt[:4])
    m = int(rcept_dt[4:6])
  except ValueError:
    return None
  return y - 1 if m <= 6 else y


def _get_audit_rcpt(dart, corp_code: str, fiscal_year: int) -> tuple[str | None, str | None, bool]:
  """회계연도 fiscal_year의 가장 적합한 보고서를 선택.

  1순위: 감사보고서. 없으면 연간 사업보고서 fallback (분기·반기 제외).

  Returns:
    (rcept_no, report_nm, is_consolidated) — 못 찾으면 (None, None, False).
  """
  today = datetime.now()
  end_year = min(today.year, fiscal_year + AUDIT_LOOKBACK_YEARS)
  end_date = today.strftime('%Y-%m-%d') if end_year == today.year else f'{end_year}-12-31'

  try:
    filings = _with_retry(
      dart.list,
      corp_code,
      start=f'{fiscal_year}-01-01',
      end=end_date,
      final=False,
      _deadline=60,
      _silence_stdout=True,
    )
  except Exception as e:
    logger.warning(f'{corp_code} {fiscal_year}년: dart.list 실패 — {e}')
    return None, None, False

  if filings is None or filings.empty:
    return None, None, False

  def _scan(predicate) -> list[tuple[tuple[int, str], str, str, bool]]:
    out: list[tuple[tuple[int, str], str, str, bool]] = []
    for _, row in filings.iterrows():
      rpt = str(row.get('report_nm', ''))
      rcept_no = str(row.get('rcept_no', ''))
      rcept_dt = str(row.get('rcept_dt', ''))
      if not predicate(rpt):
        continue
      year_match = str(fiscal_year) in rpt
      inferred = _infer_fiscal_year_from_rcept(rcept_dt)
      if not year_match and inferred != fiscal_year:
        continue
      score = _score_report(rpt, rcept_dt)
      out.append((score, rcept_no, rpt, '연결' in rpt))
    return out

  # 1순위: 감사보고서
  candidates = _scan(lambda rpt: '감사보고서' in rpt)

  # 2순위 fallback: 연간 사업보고서 (분기·반기 제외)
  if not candidates:
    candidates = _scan(
      lambda rpt: '사업보고서' in rpt and '분기' not in rpt and '반기' not in rpt
    )
    if candidates:
      logger.info(f'{corp_code} {fiscal_year}년: 감사보고서 부재 → 사업보고서 fallback')

  if not candidates:
    return None, None, False

  candidates.sort(reverse=True)
  _, best_no, best_nm, is_cons = candidates[0]
  return best_no, best_nm, is_cons


# main.do 좌측 트리 노드 블록 (OpenDartReader 0.1.6의 pattern을 줄바꿈 관대화).
_TREE_NODE_RE = re.compile(
  r"node[12]\['text'\]\s*=\s*\"([^\"]*)\";.*?"
  r"node[12]\['rcpNo'\]\s*=\s*\"([^\"]*)\";.*?"
  r"node[12]\['dcmNo'\]\s*=\s*\"([^\"]*)\";.*?"
  r"node[12]\['eleId'\]\s*=\s*\"([^\"]*)\";.*?"
  r"node[12]\['offset'\]\s*=\s*\"([^\"]*)\";.*?"
  r"node[12]\['length'\]\s*=\s*\"([^\"]*)\";.*?"
  r"node[12]\['dtd'\]\s*=\s*\"([^\"]*)\";",
  re.DOTALL,
)

_VIEWDOC_RE = re.compile(
  r'viewDoc\(\s*["\'](\d+)["\']\s*,\s*["\'](\d+)["\']\s*,\s*["\']([^"\']*)["\']\s*,\s*'
  r'["\'](\d+)["\']\s*,\s*["\'](\d+)["\']\s*,\s*["\']([^"\']+)["\']'
)


def _fallback_viewer_url(rcpt_no: str) -> str | None:
  """sub_docs가 못 찾는 보고서에서 main.do 좌측 트리를 직접 파싱해 본문 viewer URL을 만든다."""
  url = f'http://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcpt_no}'
  try:
    r = _with_retry(_session.get, url, timeout=(10, 30))
  except Exception as e:
    logger.warning(f'fallback main.do 요청 실패 (rcpNo={rcpt_no}): {e}')
    return None

  nodes = _TREE_NODE_RE.findall(r.text)
  if nodes:
    def _node_length(node: tuple[str, ...]) -> int:
      lng = node[5]
      return int(lng) if lng.isdigit() else 0

    text, rcp, dcm, ele, off, lng, dtd = max(nodes, key=_node_length)
    logger.info(f'fallback 트리 본문 선택 (rcpNo={rcpt_no}): eleId={ele} length={lng} text={text}')
    return (
      f'http://dart.fss.or.kr/report/viewer.do?'
      f'rcpNo={rcp}&dcmNo={dcm}&eleId={ele}&offset={off}&length={lng}&dtd={dtd}'
    )

  m = _VIEWDOC_RE.search(r.text)
  if not m:
    logger.warning(f'fallback: 트리/viewDoc 모두 못 찾음 (rcpNo={rcpt_no})')
    return None
  rcp, dcm, ele, off, lng, dtd = m.groups()
  return (
    f'http://dart.fss.or.kr/report/viewer.do?'
    f'rcpNo={rcp}&dcmNo={dcm}&eleId={ele}&offset={off}&length={lng}&dtd={dtd}'
  )


def _get_main_doc_url(dart, rcpt_no: str) -> str | None:
  """sub_docs에서 가장 큰(재무제표 본문) 문서 URL을 반환. 실패 시 main.do 직접 파싱."""
  try:
    docs = _with_retry(dart.sub_docs, rcpt_no, _deadline=60, _silence_stdout=True)
  except Exception as e:
    logger.warning(f'sub_docs 실패 (rcpNo={rcpt_no}): {e} — main.do fallback 사용')
    return _fallback_viewer_url(rcpt_no)
  if docs is None or docs.empty:
    return _fallback_viewer_url(rcpt_no)

  def extract_length(url: str) -> int:
    m = re.search(r'length=(\d+)', str(url))
    return int(m.group(1)) if m else 0

  return str(max(docs['url'], key=extract_length))


def _is_pdf_only_report(rcpt_no: str) -> bool:
  """main.do에서 PDF 다운로드 링크가 있고 HTML 본문 트리/viewDoc 리터럴이 없으면 True."""
  try:
    r = _with_retry(
      _session.get,
      f'http://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcpt_no}',
      timeout=(10, 30),
    )
  except Exception:
    return False
  has_pdf = 'openPdfDownload' in r.text or '.pdf' in r.text
  has_tree = bool(_TREE_NODE_RE.search(r.text))
  has_viewdoc = bool(_VIEWDOC_RE.search(r.text))
  return has_pdf and not (has_tree or has_viewdoc)


def _fetch_tables(url: str) -> list:
  """DART 뷰어 URL에서 HTML 테이블 목록을 반환."""
  try:
    r = _with_retry(_session.get, url, timeout=(10, 30))
    soup = BeautifulSoup(r.content, 'html.parser')
    return soup.find_all('table')
  except Exception as e:
    logger.error(f'HTML 수집 실패 ({url}): {e}')
    return []


def _collect_company(
  dart, company_id: str, corp_code: str, years: list[int]
) -> list[dict]:
  """비상장사의 연도별 감사보고서를 파싱해 financials 행 목록을 반환한다.

  각 행에 메타필드 _report_fiscal_year(보고서 회계연도) + consolidation을 포함.
  upsert 전에 _report_fiscal_year는 제거된다.
  """
  rows: list[dict] = []

  for year in years:
    rcept_no, report_nm, is_cons = _get_audit_rcpt(dart, corp_code, year)
    if not rcept_no:
      logger.warning(f'{corp_code} {year}년: 감사보고서·사업보고서 모두 없음')
      continue

    logger.info(f'{corp_code} {year}년: rcpNo={rcept_no} | {report_nm}')
    doc_url = _get_main_doc_url(dart, rcept_no)
    if not doc_url:
      logger.warning(f'{corp_code} {year}년: 문서 URL 없음')
      continue

    tables = _fetch_tables(doc_url)
    if not tables:
      if _is_pdf_only_report(rcept_no):
        logger.warning(f'{corp_code} {year}년: PDF 전용 보고서 — HTML 파싱 불가, 스킵')
      else:
        logger.warning(f'{corp_code} {year}년: 테이블 없음')
      continue

    parsed = _parse_financial_tables(tables)
    if not parsed:
      logger.warning(f'{corp_code} {year}년: 재무 데이터 파싱 실패')
      continue

    consolidation = 'consolidated' if is_cons else 'separate'

    # 당기(year) 행
    row: dict = {
      'company_id': company_id,
      'period_type': 'annual',
      'fiscal_year': year,
      'fiscal_quarter': None,
      'period_end_date': f'{year}-12-31',
      'currency': 'KRW',
      'consolidation': consolidation,
      '_report_fiscal_year': year,
    }
    for db_col, vals in parsed.items():
      row[db_col] = round(vals['current'], 4) if vals['current'] is not None else None
    rows.append(row)
    logger.info(f'{corp_code} {year}년: {len(parsed)}개 항목 수집 ({consolidation}) — {list(parsed.keys())}')

    # 전기(year-1) 행
    prior_vals = {col: v['prior'] for col, v in parsed.items() if v['prior'] is not None}
    if prior_vals:
      prior_row: dict = {
        'company_id': company_id,
        'period_type': 'annual',
        'fiscal_year': year - 1,
        'fiscal_quarter': None,
        'period_end_date': f'{year - 1}-12-31',
        'currency': 'KRW',
        'consolidation': consolidation,
        '_report_fiscal_year': year,
      }
      for db_col, val in prior_vals.items():
        prior_row[db_col] = round(val, 4)
      rows.append(prior_row)
      logger.debug(f'{corp_code} {year - 1}년(전기): {len(prior_vals)}개 항목')

  return rows


def _resolve_corp_code(dart, name: str, db_corp_code: str | None) -> str | None:
  """`_resolve_corp_code_impl`을 회사 단위 timeout 가드로 감싼 wrapper.

  과거 일부 회사에서 corp_codes 조회·company.json 호출이 무한 hang하며
  shard 전체를 240분 timeout으로 cancelled 시키는 사례가 있어 도입.
  타임아웃 시 None 반환 + 호출부는 그 회사를 unmapped로 처리하고 다음 회사로 진행.
  """
  try:
    with ThreadPoolExecutor(max_workers=1) as ex:
      return ex.submit(_resolve_corp_code_impl, dart, name, db_corp_code).result(
        timeout=RESOLVE_CORP_CODE_TIMEOUT
      )
  except FuturesTimeout:
    logger.warning(
      f'{name}: corp_code 해소 {RESOLVE_CORP_CODE_TIMEOUT}s timeout — 스킵'
    )
    return None


def _resolve_corp_code_impl(dart, name: str, db_corp_code: str | None) -> str | None:
  """회사명에서 DART corp_code를 식별. 동명/표기 차이/이름 변경 모두 대응.

  우선순위:
    1) companies.dart_corp_code 수동 매핑 (검증 없이 사용).
    2) corp_codes에서 corp_name 완전 일치 (정규화 후 양쪽 비교).
    3) 정규화 부분 일치(포함 관계).
    4) 후보 여럿이면 induty_code prefix(자동차 30/31/33 외 24~33,46)로 자동차 우선,
       자동차 후보 없으면 None 반환 + WARN.
    5) 자동차 후보 안에서 modify_date 최신.
  """
  if db_corp_code:
    return db_corp_code

  codes = getattr(dart, 'corp_codes', None)
  if codes is None or codes.empty:
    return None

  target = _normalize_corp_name(name)
  if not target:
    return None

  # 1차: corp_name 정규화 완전 일치 (원본 + 영문→한글 음역 변환본 둘 다 시도)
  norms = codes['corp_name'].fillna('').apply(_normalize_corp_name)
  candidates = codes[norms == target]
  target_eng2kor = _normalize_corp_name(_ascii_to_korean(name))
  if candidates.empty and target_eng2kor and target_eng2kor != target:
    candidates = codes[norms == target_eng2kor]
    if not candidates.empty:
      logger.info(
        f'{name}: 영문→한글 음역 완전 일치 {len(candidates)}개 '
        f'(변환: {target_eng2kor!r}) — 자동차 업종 우선 선택'
      )

  # 2차: corp_name 정규화 부분 일치 (양방향 contains). 변환본도 함께 시도.
  if candidates.empty:
    keys = [target]
    if target_eng2kor and target_eng2kor != target:
      keys.append(target_eng2kor)
    import pandas as _pd
    mask = _pd.Series(False, index=codes.index)
    for k in keys:
      mask = mask | norms.str.contains(re.escape(k), na=False) | norms.apply(
        lambda x, _k=k: _k in x or (x and x in _k)
      )
    candidates = codes[mask]
    if not candidates.empty:
      suffix = f' (영문→한글: {target_eng2kor!r})' if len(keys) > 1 else ''
      logger.info(
        f'{name}: corp_name 부분 일치 {len(candidates)}개{suffix} — 자동차 업종 우선 선택'
      )

  # 3차: 영문/숫자 부분(ascii_part) 매치 — 'SNT모티브' ↔ 'SNT Motiv' 같은 영한 혼용 케이스
  if candidates.empty:
    target_ascii = _ascii_part(name)
    eng_col = 'corp_eng_name' if 'corp_eng_name' in codes.columns else None
    if len(target_ascii) >= 3 and eng_col:
      eng_ascii = codes[eng_col].fillna('').apply(_ascii_part)
      name_ascii = codes['corp_name'].fillna('').apply(_ascii_part)
      mask = (
        eng_ascii.str.contains(re.escape(target_ascii), na=False)
        | name_ascii.str.contains(re.escape(target_ascii), na=False)
      )
      candidates = codes[mask]
      if not candidates.empty:
        logger.info(f'{name}: 영문 ASCII 부분 일치 {len(candidates)}개 — 자동차 업종 우선 선택')

  # 4차: 한글 음역 변환(_korean_to_ascii) 매치 — '에스에이치비'↔'SHB' 같은 완전 음역 케이스
  if candidates.empty:
    target_kor = _korean_to_ascii(name)
    eng_col = 'corp_eng_name' if 'corp_eng_name' in codes.columns else None
    if len(target_kor) >= 3 and eng_col:
      eng_ascii = codes[eng_col].fillna('').apply(_ascii_part)
      name_ascii = codes['corp_name'].fillna('').apply(_ascii_part)
      mask = (
        eng_ascii.str.contains(re.escape(target_kor), na=False)
        | name_ascii.str.contains(re.escape(target_kor), na=False)
      )
      candidates = codes[mask]
      if not candidates.empty:
        logger.info(
          f'{name}: 한글 음역 변환 부분 일치 {len(candidates)}개 '
          f'(변환: {target_kor!r}) — 자동차 업종 우선 선택'
        )

  if candidates.empty:
    return None
  if len(candidates) == 1:
    return str(candidates.iloc[0]['corp_code'])

  logger.info(f'{name}: 동명/유사명 회사 {len(candidates)}개 — 자동차 업종 우선 선택')
  scored: list[tuple[int, str, str]] = []  # (is_auto, modify_date, corp_code)
  any_auto = False
  for _, row in candidates.iterrows():
    code = str(row['corp_code'])
    modify = str(row.get('modify_date') or '')
    try:
      info = _with_retry(
        _session.get,
        'https://opendart.fss.or.kr/api/company.json',
        params={'crtfc_key': DART_KEY, 'corp_code': code},
        timeout=(10, 15),
      ).json()
    except Exception as e:
      logger.warning(f'  {code}: company.json 조회 실패 ({e})')
      scored.append((0, modify, code))
      continue
    if info.get('status') != '000':
      scored.append((0, modify, code))
      continue
    induty = str(info.get('induty_code') or '')
    is_auto = any(induty.startswith(p) for p in _AUTO_INDUTY_PREFIXES)
    if is_auto:
      any_auto = True
    scored.append((1 if is_auto else 0, modify, code))
    logger.info(f'  {code} induty={induty} modify={modify} {"← 자동차" if is_auto else ""}')

  if not any_auto:
    logger.warning(
      f'{name}: 동명/유사명 후보 {len(candidates)}개 중 자동차 업종 매치 없음 — '
      f'companies.dart_corp_code 수동 매핑 권장. 스킵.'
    )
    return None

  # 자동차 매치만 필터링 후 modify_date 최신
  auto_only = [s for s in scored if s[0] == 1]
  auto_only.sort(key=lambda t: t[1], reverse=True)
  return auto_only[0][2]


def _dedup_rows(all_rows: list[dict]) -> list[dict]:
  """(company_id, fiscal_year) 기준 dedup.
  더 최근 보고서(_report_fiscal_year 큰)가 우선. 값이 다른 컬럼은 WARN 로그.
  """
  deduped: dict[tuple, dict] = {}
  for r in all_rows:
    key = (r['company_id'], r['fiscal_year'])
    existing = deduped.get(key)
    if existing is None:
      deduped[key] = r
      continue
    existing_year = existing.get('_report_fiscal_year', 0)
    new_year = r.get('_report_fiscal_year', 0)
    if new_year > existing_year:
      # 새 행이 더 최신 보고서 — 값 변경 감지
      for col, new_val in r.items():
        if col.startswith('_') or col in ('company_id', 'period_type', 'fiscal_year',
                                          'fiscal_quarter', 'period_end_date', 'currency'):
          continue
        old_val = existing.get(col)
        if old_val is not None and new_val is not None and old_val != new_val:
          logger.warning(
            f'  [정정 감지] company={r["company_id"]} year={r["fiscal_year"]} '
            f'{col}: {old_val} → {new_val} (보고서 {existing_year}→{new_year})'
          )
      deduped[key] = r

  # 메타필드 제거
  out = []
  for r in deduped.values():
    clean = {k: v for k, v in r.items() if not k.startswith('_')}
    out.append(clean)
  return out


def collectDartAudit() -> None:
  """data_source='dart'인 비상장사의 연결감사보고서 재무 데이터를 수집한다."""
  if not DART_KEY:
    logger.error('DART_API_KEY 없음. scripts/.env에 추가하세요.')
    sys.exit(1)

  dart = _get_dart()
  if not dart:
    sys.exit(1)

  client = get_client()
  raw = os.environ.get('TARGET_TICKERS', '').strip()
  target_filter: set[str] = {t.strip() for t in raw.split(',') if t.strip()}

  companies = [
    r for r in client.table('companies').select('id,ticker,name_kr,data_source,dart_corp_code').execute().data
    if r.get('data_source') == 'dart'
    and (not target_filter or r.get('ticker') in target_filter)
  ]
  if target_filter:
    logger.info(f'TARGET_TICKERS 필터 적용: {sorted(target_filter)} → {len(companies)}개')

  # GitHub Actions matrix 분할: SHARD_INDEX/SHARD_COUNT가 주어지면 id 기준 round-robin.
  shard_index = int(os.environ.get('SHARD_INDEX', '0'))
  shard_count = int(os.environ.get('SHARD_COUNT', '1'))
  if shard_count > 1:
    companies.sort(key=lambda r: r['id'])
    total = len(companies)
    companies = [c for i, c in enumerate(companies) if i % shard_count == shard_index]
    logger.info(f'SHARD {shard_index}/{shard_count} 슬라이싱: 전체 {total} → 본 shard {len(companies)}개')

  if not companies:
    logger.info('DART 수집 대상 기업 없음')
    return

  all_rows: list[dict] = []
  unmapped: list[dict] = []  # corp_code 미해소 회사 명단
  for company in companies:
    name = company['name_kr']
    company_id = company['id']

    db_corp_code = company.get('dart_corp_code')
    logger.info(f'{name} DART 코드 검색 중...' + (f' (DB 매핑: {db_corp_code})' if db_corp_code else ''))
    try:
      corp_code = _resolve_corp_code(dart, name, db_corp_code)
    except Exception as e:
      logger.error(f'{name} corp_code 검색 실패: {e}')
      unmapped.append({'id': company_id, 'name_kr': name, 'reason': f'예외: {e}'})
      continue

    if not corp_code:
      logger.warning(f'{name}: DART 코드 없음 — 스킵')
      unmapped.append({'id': company_id, 'name_kr': name, 'reason': 'corp_code 미해소'})
      continue

    logger.info(f'{name}: corp_code={corp_code}')
    rows = _collect_company(dart, company_id, corp_code, years=_target_years())
    all_rows.extend(rows)
    logger.info(f'{name}({corp_code}): {len(rows)}행 수집')
    time.sleep(COMPANY_SLEEP)

  if all_rows:
    final = _dedup_rows(all_rows)
    upsert_rows('financials', final, 'company_id,period_type,fiscal_year,fiscal_quarter')
    logger.info(f'DART 감사보고서 수집 완료 — {len(final)}행')
  else:
    logger.warning('수집된 재무 데이터 없음')

  # corp_code 미해소 회사 종합 리포트 — 사용자가 dart_corp_code 수동 매핑 참고용
  if unmapped:
    logger.warning(f'\n=== corp_code 미해소 회사 {len(unmapped)}개 (수동 매핑 권장) ===')
    for u in unmapped:
      logger.warning(f"  {u['name_kr']:30}  ({u['reason']})  id={u['id']}")
    logger.warning(
      "  ↳ DART(https://dart.fss.or.kr)에서 해당 회사 검색 → corp_code 확인 후\n"
      "    UPDATE public.companies SET dart_corp_code='########' WHERE id='<id>';\n"
      "    로 매핑하면 다음 워크플로부터 정상 수집됩니다."
    )


if __name__ == '__main__':
  try:
    collectDartAudit()
  except Exception as e:
    logger.error(f'DART 감사보고서 수집 실패: {e}')
    sys.exit(1)
