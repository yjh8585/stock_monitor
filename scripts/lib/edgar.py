"""SEC EDGAR 공용 — UA·재시도·요청 간격을 한곳에 둔다(SEC 공정 접근 규칙: UA 에 연락처 · 초당 10건 이하).

UA 는 env SEC_USER_AGENT(GHA Secret 권장) · 없으면 기본값. 기본값의 연락처는 자리표시자다(미확인 목록 참조).

🔴 CIK 를 DB(`companies.sec_cik`)에 넣을 때는 반드시 `normalize_cik` 를 거친다. 칸의 CHECK
(`^[0-9]{1,10}$`)는 앞 0 붙은 꼴(`0000320193`)도 통과시켜, 안 거르면 같은 회사가 두 꼴로 들어간다.
"""
import os
import re
import time
from dataclasses import dataclass

import requests

from lib.retry import with_retry

DEFAULT_UA = 'stock-monitor research contact@example.com'
SLEEP_S = 0.15
TIMEOUT_S = 30
_HTM_SKIP = re.compile(r'^R\d+\.htm$|-index', re.I)


def user_agent() -> str:
  return os.environ.get('SEC_USER_AGENT') or DEFAULT_UA


def headers() -> dict:
  return {'User-Agent': user_agent(), 'Accept-Encoding': 'gzip, deflate'}


def normalize_cik(cik: str | int) -> str:
  """CIK → 앞 0 없는 숫자 문자열(`'0000320193'`·`320193` → `'320193'`). 숫자가 아니거나 10자리 초과면 ValueError."""
  s = str(cik).strip()
  if not s.isdigit() or int(s) == 0:
    raise ValueError(f'CIK 형식 아님: {cik!r}')
  out = str(int(s))
  if len(out) > 10:
    raise ValueError(f'CIK 10자리 초과: {cik!r}')
  return out


def edgar_get(session: requests.Session, url: str) -> requests.Response:
  def _once():
    r = session.get(url, headers=headers(), timeout=TIMEOUT_S)
    r.raise_for_status()
    return r
  try:
    return with_retry(_once, _label=url)
  finally:
    time.sleep(SLEEP_S)


@dataclass(frozen=True)
class Filing:
  accession: str
  filing_date: str
  report_date: str
  form: str
  items: str
  primary_doc: str
  primary_desc: str

  def base_url(self, cik: str) -> str:
    return f'https://www.sec.gov/Archives/edgar/data/{int(cik)}/{self.accession.replace("-", "")}'


def parse_recent(sub: dict) -> list[Filing]:
  rec = sub['filings']['recent']
  keys = ('accessionNumber', 'filingDate', 'reportDate', 'form', 'items', 'primaryDocument', 'primaryDocDescription')
  return [Filing(*(rec[k][i] or '' for k in keys)) for i in range(len(rec['accessionNumber']))]


def fetch_filings(session, cik: str, forms: tuple[str, ...], since: str) -> list[Filing]:
  """최근 공시(submissions recent ≈ 1,000건) 중 forms·since 이후만. 2년 백필이면 recent 로 충분하다(실측: GM 2년 ≈ 120건)."""
  r = edgar_get(session, f'https://data.sec.gov/submissions/CIK{int(cik):010d}.json')
  return [f for f in parse_recent(r.json()) if f.form in forms and f.filing_date >= since]


def filing_htm_names(index_json: dict, primary: str) -> list[str]:
  """공시 폴더 index.json → 본문 먼저, 나머지 htm(EX-99.x)을 이름순. XBRL 조각(R1.htm)·색인은 뺀다."""
  names = [it['name'] for it in index_json['directory']['item']
           if it['name'].lower().endswith('.htm') and not _HTM_SKIP.search(it['name'])]
  return [primary] + sorted(n for n in names if n != primary)
