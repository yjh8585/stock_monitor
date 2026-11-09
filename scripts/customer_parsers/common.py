"""회사별 파서가 같이 쓰는 표·문장 도우미(순수 함수)."""
import re

from customer_parsers.base import MONTHS, numeric_cells
from lib.doc_text import norm_text

_DATE_CELL = re.compile(r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*(\d{4})', re.I)
_WORD_NUM = {'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8,
             'nine': 9, 'ten': 10}


def quarter_of_month(month: int) -> int:
  return (month - 1) // 3 + 1


def quarter_from_date_text(s: str) -> str | None:
  """'September 30, 2026' → '2026-Q3'."""
  m = _DATE_CELL.search(s)
  if not m:
    return None
  return f'{m.group(2)}-Q{quarter_of_month(MONTHS[m.group(1).lower()])}'


def word_or_number(s: str) -> float:
  s = s.strip().lower()
  return float(_WORD_NUM[s]) if s in _WORD_NUM else float(s.replace(',', ''))


def money(s: str) -> float:
  """'$(1.85)' → -1.85 · '$14.5' → 14.5 · '€3' → 3."""
  s = norm_text(s).replace('$', '').replace('€', '').strip()
  neg = s.startswith('(') or s.startswith('-')
  v = float(s.strip('()').lstrip('-').replace(',', ''))
  return -v if neg else v


# '$14.5 billion - $15.5 billion' · '$(1.85)B - $(1.75)B' · '67,000 - 70,000' · '$12.75 - $13.75' · '$ 8.9-9.5'
RANGE = re.compile(
  r'(?P<a>\$?\s*\(?-?[\d,]*\.?\d+\)?)\s*(?P<ua>billion|B)?\s*(?:-|to)\s*'
  r'(?P<b>\$?\s*\(?-?[\d,]*\.?\d+\)?)\s*(?P<ub>billion|B)?')


def parse_range(cell: str) -> tuple[float, float] | None:
  m = RANGE.fullmatch(norm_text(cell).strip())
  if not m:
    return None
  return money(m.group('a')), money(m.group('b'))


def first_number(row: list[str]) -> float | None:
  nums = numeric_cells(row)
  return nums[0] if nums else None


def year_before(text: str, pos: int, rx: str = r'(?:expects|full year|Outlook for|fiscal year|for|in) (20\d{2})',
                window: int = 400) -> str | None:
  hits = re.findall(rx, text[max(0, pos - window):pos], re.I)
  return hits[-1] if hits else None


def dedupe_first(rows: list, key) -> list:
  """같은 문서 안 같은 칸(metric·period)이 두 번 잡히면 처음 것만(표 다음 본문 문장이 같은 값을 되풀이한다)."""
  seen, out = set(), []
  for r in rows:
    k = key(r)
    if k in seen:
      continue
    seen.add(k)
    out.append(r)
  return out
