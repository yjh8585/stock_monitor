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


# 마침표·쌍반점 뒤 공백 + 대문자·괄호·숫자 앞에서 끊는다('per cent). 09.09.2026 …' 의 날짜 줄도 끊긴다).
# '321.9' 처럼 소수점 뒤에 바로 숫자가 오면 공백이 없어 끊지 않는다
_SENT_SPLIT = re.compile(r'(?<=[.;])\s+(?=[A-Z(\d])')


def uncovered_marks(text: str, mark: re.Pattern, quotes: list[str]) -> list[str]:
  """표식(전망 변경 낱말)이 든 문장 중 뽑은 행의 quote 를 하나도 품지 않은 문장 — 문장꼴이 바뀌어 코드가 놓친 항목.
  하나라도 있으면 파서가 llm_hint 를 세운다(코드 행은 그대로 적재 · LLM 이 빠진 항목을 메운다)."""
  return [s for s in _SENT_SPLIT.split(text) if mark.search(s) and not any(q in s for q in quotes)]


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


# EDGAR 8-K Item 2.02 문단(다음 Item 머리까지 · 머리가 없으면 2,000자) — 'Item 2.02 of this Form 8-K' 같은 뒤쪽 언급은
# 머리가 아니라 첫 일치만 쓴다
_ITEM_202 = re.compile(r'Item\s+2\.02\b')
_NEXT_ITEM = re.compile(r'Item\s+(?!2\.02\b)\d\.\d{2}\b')
# 분기 잠정 «범위» 공시의 Item 2.02 문장(실물 2건 — 폴라리스 2025-10-14 'preview on its preliminary results' ·
# 리비안 2026-07-06 'certain preliminary and unaudited estimates')
_PRELIM_202 = re.compile(r'preliminary (?:results|and unaudited estimates)', re.I)


def edgar_202_expects_numbers(doc, content) -> bool:
  """EDGAR 8-K Item 2.02(실적 발표)이고 분기 잠정 «범위» 공시가 아니면 참 — 파서 expects_numbers 훅용(Task 10 항목 2).
  잠정 범위는 코드가 일부러 안 읽어 not_target 이 정상인데, 2.02 만 보면 「서식 미인식」 경고가 뜬다. 제목·items 로는
  못 가르고(폴라리스는 9.01 이 있다) Item 2.02 문단의 문장에만 근거가 있다 — 첨부 보도자료의 'preliminary' 는 보지 않는다."""
  if doc.source != 'edgar' or '2.02' not in (doc.items or '').split(','):
    return False
  text = content.text if content is not None else ''
  head = _ITEM_202.search(text)
  if head is None:
    return True
  nxt = _NEXT_ITEM.search(text, head.end())
  para = text[head.start():nxt.start() if nxt else head.start() + 2000]
  return _PRELIM_202.search(para) is None
