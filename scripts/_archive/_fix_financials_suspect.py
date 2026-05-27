"""파싱 버그 의심 14사 매출 정확값 fetch.

흐름:
1. 회사별 corp_code resolve (DB에 있으면 사용, 없으면 _resolve_corp_code)
2. 각 회계연도별 사업보고서 또는 감사보고서 rcpNo 찾기 (연결 우선)
3. HTML 본문에서 '매출(액)' 행 추출 → 단위 자동 인식
4. 현재 DB 값과 비교
5. 차이 큰 행만 출력 (UPDATE SQL 생성)
"""
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
load_dotenv(ROOT.parent / '.env.local')

sys.path.insert(0, str(ROOT))
import OpenDartReader as O  # noqa: E402
import requests  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402
from lib.db import get_client  # noqa: E402
from collect_dart_audit import _resolve_corp_code  # noqa: E402

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
session = requests.Session()
session.headers.update(HEADERS)

TARGETS: list[tuple[str, str, str | None]] = [
  # (db_id, name_kr, db_corp_code)
  ('2da2655e-d678-4ccf-8f91-b4dcb8493ebe', '금오중공업', '00481144'),
  ('ad5c2c51-6892-45c8-a84b-132d0e33acfe', '넥스트칩', '01515864'),
  ('484ff75e-ddb7-4fc1-925c-9b24de30d409', '다산디엠씨', None),
  ('858b3202-2599-4f3b-995a-19a3e4b7d2c3', '동원금속', None),
  ('90e3da4d-4a98-4d38-b9c7-635c699e5729', '메탈다인코리아', '01477157'),
  ('b019efb3-4775-4580-9515-6c51be49ea38', '모토닉', None),
  ('10d11687-f366-4fd1-8bf4-306b5185c1b3', '삼송', '01742556'),
  ('21c45c44-4194-4f56-a8dc-68694d2c7620', '성우하이텍', None),
  ('ffe3afaf-673c-4a64-b0b5-f2fcd6b0ddb4', '세원물산', None),
  ('75a0455b-5ecf-4104-a913-85eb2ef64ac9', '세원이앤씨', None),
  ('8688d80e-302e-4ba0-95ec-c914588cf42e', '유라테크', None),
  ('1ad8dc98-0e4f-412b-8cb7-7dddc587e640', '케이비아이메탈', None),
  ('9788695a-0664-41d8-9cfd-873bf5a8362a', '화천기계', None),
  # 토요타이어는 yfinance — DART 못 함 (별도 처리)
]

YEARS = [2025, 2024, 2023, 2022, 2021]


def _detect_unit_divider(table_text: str, prev_text: str = '') -> tuple[int, str]:
  """표 본문 + 직전 sibling 텍스트에서 단위 인식. (divider, label) 반환."""
  txt = (table_text + ' ' + prev_text)[:1500]
  if '백만원' in txt: return 1, '백만원'
  if '천원' in txt: return 1000, '천원'
  if '원' in txt: return 1_000_000, '원'
  return 1_000_000, '원(default)'


def _parse_num(s: str) -> float | None:
  s = s.strip().replace(' ', '')
  neg = s.startswith('(') and s.endswith(')')
  s = s.strip('()')
  if not s or s in ('-', 'None'): return None
  if ',' in s:
    parts = s.lstrip('-').split(',')
    if not parts[0].isdigit() or not (1 <= len(parts[0]) <= 3): return None
    for p in parts[1:]:
      if not p.split('.')[0].isdigit() or len(p.split('.')[0]) != 3: return None
    s = s.replace(',', '')
  try:
    v = float(s)
    return -v if neg else v
  except (ValueError, TypeError):
    return None


def _max_nums_row_for_revenue(soup) -> tuple[str | None, list[float], int, str]:
  """첫 매출액 행 찾고 단위 추정. (cells_preview, nums, divider, unit_label)"""
  for ti, t in enumerate(soup.find_all('table')):
    txt = t.get_text()
    if '매출액' not in txt or '영업이익' not in txt:
      continue
    # 직전 5개 sibling text 단위 힌트
    prev = t
    prev_txt = ''
    for _ in range(5):
      prev = prev.find_previous(['p', 'div', 'td', 'b', 'strong', 'span', 'th'])
      if prev is None: break
      prev_txt += ' ' + prev.get_text()
    divider, unit_label = _detect_unit_divider(txt[:2000], prev_txt)

    for row in t.find_all('tr'):
      cells = [td.get_text(strip=True) for td in row.find_all(['th','td'])]
      if not cells: continue
      c0 = re.sub(r'\s+', '', cells[0])
      # '매출액' 단순 매치 (매출원가/매출총이익/매출채권 거부)
      if not (c0.startswith('매출액') or c0 == '매출' or c0 == '총매출액' or '매출액' in c0):
        continue
      if '매출원가' in c0 or '매출총' in c0 or '매출채권' in c0 or '매출액및' in c0:
        continue
      nums_all = []
      for c in cells[1:]:
        v = _parse_num(c)
        if v is not None: nums_all.append(v)
      if nums_all:
        return ' | '.join(cells[:8]), nums_all, divider, unit_label
  return None, [], 1_000_000, '?'


def fetch_revenue(dart, corp_code: str, year: int) -> tuple[float | None, str]:
  """year fiscal year 사업보고서 또는 감사보고서에서 매출(백만원) 추출."""
  try:
    filings = dart.list(corp_code, start=f'{year}-01-01', end=f'{year+1}-06-30', final=False)
  except Exception as e:
    return None, f'list_err: {e}'
  if filings is None or filings.empty:
    return None, 'no_filings'
  cand = filings[filings['report_nm'].str.contains('연결감사보고서|감사보고서|사업보고서', regex=True, na=False)]
  cand = cand[~cand['report_nm'].str.contains('분기|반기', regex=True, na=False)]
  # 연결 우선, 정정 우선
  def score(rpt: str) -> int:
    s = 0
    if '[기재정정]' in rpt: s += 4
    if '연결' in rpt: s += 2
    if '감사보고서' in rpt: s += 1
    return s
  cand = cand.copy()
  cand['_score'] = cand['report_nm'].apply(score)
  # year 매치 확인 (보고서 명에 year 포함)
  cand = cand[cand['report_nm'].str.contains(str(year), regex=False, na=False)]
  if cand.empty:
    return None, 'no_year_match'
  cand = cand.sort_values(['_score', 'rcept_dt'], ascending=[False, False])

  for _, row in cand.head(2).iterrows():
    rcpt = row['rcept_no']
    try:
      docs = dart.sub_docs(rcpt)
      if docs is None or docs.empty: continue
      def lng(u):
        m = re.search(r'length=(\d+)', str(u))
        return int(m.group(1)) if m else 0
      url = max(docs['url'], key=lng)
      r = session.get(url, timeout=30)
      soup = BeautifulSoup(r.content, 'html.parser')
      preview, nums, divider, unit = _max_nums_row_for_revenue(soup)
      if nums:
        # 첫 nums가 당기, 두 번째가 전기 (또는 외부매출액 마지막)
        # 연결 손익계산서면 매출액=cells[1] (당기) 또는 마지막 (외부)
        # 안전하게 첫 nums 사용 — 표 구조 통일 안 되어 추정 어려움
        revenue_raw = nums[0]
        revenue_mil = revenue_raw / divider
        return revenue_mil, f'{rcpt} {row["report_nm"]} | unit={unit} divider={divider} | raw={revenue_raw:,.0f} | mil={revenue_mil:,.4f} | preview={preview}'
    except Exception as e:
      logger.debug(f'  {rcpt} 예외: {e}')
      continue
  return None, 'no_parse'


def main() -> int:
  dart = O(os.environ['DART_API_KEY'])
  client = get_client()

  for db_id, name, db_corp in TARGETS:
    logger.info(f'\n=== {name} ===')
    corp_code = db_corp
    if not corp_code:
      try:
        corp_code = _resolve_corp_code(dart, name, None)
      except Exception as e:
        logger.warning(f'  corp_code resolve 실패: {e}')
        continue
    if not corp_code:
      logger.warning(f'  corp_code 없음')
      continue
    logger.info(f'  corp_code={corp_code}')

    # 현재 DB 매출
    fin = client.table('financials').select('fiscal_year,revenue').eq('company_id', db_id).eq('period_type', 'annual').order('fiscal_year', desc=True).execute()
    db_rev = {r['fiscal_year']: float(r['revenue']) if r['revenue'] is not None else None for r in (fin.data or [])}

    for year in YEARS:
      rev, log = fetch_revenue(dart, corp_code, year)
      db_v = db_rev.get(year)
      diff_pct = None
      if rev is not None and db_v is not None and db_v != 0:
        diff_pct = abs(rev - db_v) / abs(db_v) * 100
      status = '?'
      if rev is None:
        status = '✗'
      elif db_v is None:
        status = 'NEW'
      elif diff_pct is not None and diff_pct < 1:
        status = '✓'
      elif diff_pct is not None and diff_pct < 10:
        status = '~'
      else:
        status = 'DIFF'
      logger.info(f'  [{year}] {status} DB={db_v} | DART={rev} ({log[:120]})')

  return 0


if __name__ == '__main__':
  sys.exit(main())
