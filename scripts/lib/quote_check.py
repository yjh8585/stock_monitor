"""인용·숫자 대조기 — 뽑은 행의 quote 가 원문에 정말 있고, 값이 그 quote 안에 정말 있는지 본다.

agents 레포에서 옮겨 온 규칙(원본 = repo_assets 8번):
- 정규화: scripts/verify-essay-quotes.mjs normalize + scripts/pani9/codex_guard.py norm(합자 풀기)
- 조각 대조: codex_guard.py quote_frags(… · ' / ' 로 쪼개 12자 이상 조각만)
- 숫자 대조: apps/orchestrator/src/curatedQuality.ts NUMBER_RE · numbersIn
여기서 더한 것:
- 표 행 quote(' | ' 이음)는 원문에서 셀 사이 공백만 남으므로 '|' 를 공백으로 본다
- 값 대조는 단위 배수(백·천·백만·10억·만·억·조)와 괄호 음수를 풀어 본다 · 영어 수 낱말(one~twelve)도 숫자로 본다
- 12자 미만 짧은 표 행('CKD 60 60')은 «글자 라벨 + 숫자»가 함께 있고 통째로 원문에 있으면 인정
- 일정 행은 값이 아니라 날짜(연·월·일)가 quote 에 있는지로 본다(check_date_row)
이식 시험(2026-11-10)에서 더한 것 — 요약서 시제품의 빈틈 4갈래, 각각 표본으로 고정:
- 한글과 한글 사이 공백은 지운다(띄어쓰기 변이를 통과) · 활용형은 다른 글이라 그대로 실패
- 숫자로 끝나는 조각이 원문 수 한가운데서 잘린 자리면 실패('1,028' ↔ '1,028,500')
- 숫자·영문 바로 뒤의 '-' 는 범위 대시('7.55-7.60' 의 7.60 은 양수)
- 날짜는 월·일이 붙어 있는 꼴로만 인정('February 12th' 가 12월 12일로 통과하던 것)
코드 파서 행도 LLM 행도 같은 검사를 지나야 verified=true 다.
"""
import re
import unicodedata

LIG = {'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl'}
FRAG_SPLIT = re.compile(r'\s/\s|…|\.\.\.')
MIN_FRAG = 12
MIN_SHORT = 6
_WORDS = {'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9,
          'ten': 10, 'eleven': 11, 'twelve': 12}
_WORD_RE = re.compile(r'\b(' + '|'.join(_WORDS) + r')\b')
_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
           'november', 'december']


def normalize(s: str) -> str:
  for k, v in LIG.items():
    s = s.replace(k, v)
  s = unicodedata.normalize('NFKC', s)
  s = re.sub(r'[‐-―−]', '-', s)
  s = re.sub(r'[‘’‚‛“”„‟ʼ"\'`]', '', s)
  s = s.replace('|', ' ').replace('\xa0', ' ')
  s = re.sub(r'\s+', ' ', s).replace(' ,', ',').strip().lower()
  # 한글과 한글 사이 공백은 지운다 — 공시 원문(PDF·HTML 추출)과 LLM 인용의 띄어쓰기가 자주 갈린다
  # ('판매목표' ↔ '판매 목표'). 숫자·영문 사이 공백은 남긴다('CKD 60 60' 의 경계가 그것이다).
  s = re.sub(r'(?<=[가-힣]) (?=[가-힣])', '', s)
  return s.rstrip('.;:,')


def _frag_in(frag: str, src: str) -> bool:
  """조각이 원문에 있되, 숫자로 끝나거나 시작하는 조각은 원문의 수 한가운데서 잘린 자리면 거짓.
  ('sales of 1,028' 이 원문 'sales of 1,028,500' 에 부분 문자열로 들어가는 거짓 통과를 막는다)"""
  pat = re.escape(frag)
  if frag[:1].isdigit():
    pat = r'(?<![\d,.])' + pat
  if frag[-1:].isdigit():
    pat += r'(?![\d]|[,.]\d)'
  return re.search(pat, src) is not None


def quote_in_source(quote: str, source: str) -> bool:
  """quote 의 모든 조각(12자 이상)이 정규화한 원문에 그대로 있어야 참.
  조각이 하나도 없는 짧은 quote 는 «글자 라벨 + 숫자»를 함께 갖고 통째로 원문에 있을 때만 참."""
  src = normalize(source)
  frags = [normalize(f) for f in FRAG_SPLIT.split(quote)]
  long_frags = [f for f in frags if len(f) >= MIN_FRAG]
  if long_frags:
    return all(_frag_in(f, src) for f in long_frags)
  q = normalize(quote)
  return (len(q) >= MIN_SHORT and bool(re.search(r'[a-z가-힣]', q)) and bool(re.search(r'\d', q))
          and f' {q} ' in f' {src} ')


def numbers_in(s: str) -> list[float]:
  t = _WORD_RE.sub(lambda m: str(_WORDS[m.group(1)]), normalize(s))
  out = []
  for m in re.finditer(r'\(?-?[\d,]*\.?\d+\)?', t):
    tok = m.group(0)
    # 앞 글자가 숫자·영문이면 '-' 는 음수 부호가 아니라 범위 대시다('7.55-7.60' 의 7.60 은 양수)
    range_dash = tok.startswith('-') and m.start() > 0 and t[m.start() - 1].isalnum()
    neg = tok.startswith('(') and tok.endswith(')') or (tok.startswith('-') and not range_dash)
    digits = tok.strip('()').lstrip('-').replace(',', '')
    if not digits or digits == '.':
      continue
    try:
      v = float(digits)
    except ValueError:
      continue
    out.append(-v if neg else v)
  return out


def value_in_quote(value: float, quote: str, rel_tol: float = 1e-9) -> bool:
  """값이 quote 의 숫자 중 하나와 같다(단위 배수 1·백(억원→백만원)·천·백만·10억·만·억·조 중 하나로 맞으면 참)."""
  for n in numbers_in(quote):
    for mult in (1, 1e2, 1e3, 1e6, 1e9, 1e4, 1e8, 1e12, 1e-3, 1e-6):
      if abs(n * mult - value) <= max(abs(value) * rel_tol, 1e-9):
        return True
  return False


def check_row(row, source_text: str) -> tuple[bool, str]:
  """(verified, note). row 는 VolumeRow·ResultRow·GuidanceRow 어느 것이든(일정은 check_date_row)."""
  if not quote_in_source(row.quote, source_text):
    return False, 'quote_not_in_source'
  values = [getattr(row, k) for k in ('value', 'low', 'high') if getattr(row, k, None) is not None]
  for v in values:
    if not value_in_quote(float(v), row.quote):
      return False, f'value_not_in_quote:{v}'
  if not values and not getattr(row, 'value_text', None):
    return False, 'no_value'
  if getattr(row, 'value_text', None) and normalize(row.value_text) not in normalize(row.quote):
    return False, 'value_text_not_in_quote'
  return True, 'ok'


def check_date_row(row, source_text: str) -> tuple[bool, str]:
  """일정 행: quote 가 원문에 있고, event_date 의 연·월·일이 quote 안에 있어야 참.
  월·일은 «붙어 있는 꼴»로만 본다 — 따로 찾으면 'February 12th' 가 12월 12일로도 통과한다.
  영어 월 이름(약칭·서수·앞 0 유무) · 한국어 'M월 D일' · 숫자 'Y-M-D'·'Y.M.D'·'Y/M/D'·'M/D/Y'."""
  if not quote_in_source(row.quote, source_text):
    return False, 'quote_not_in_source'
  y, m, d = (int(x) for x in row.event_date.split('-'))
  q = normalize(row.quote)
  full = _MONTHS[m - 1]
  mon = rf'(?:{full}|{full[:3]}{"t?" if m == 9 else ""})\b\.?'  # 'mar[a-z]*' 로 열면 market·decline 에 걸린다
  day = rf'0?{d}(?:st|nd|rd|th)?(?!\d)'
  pats = [rf'\b{mon}\s+(?<!\d){day}', rf'(?<!\d){day}\s+(?:of\s+)?{mon}\b',  # February 12th · 12 February
          rf'(?<!\d)0?{m}\s*월\s*0?{d}\s*일',                                    # 2월 12일
          rf'{y}\s*[-./]\s*0?{m}\s*[-./]\s*0?{d}(?!\d)', rf'(?<!\d)0?{m}/0?{d}/{y}']
  has_year = str(y) in q
  has_md = any(re.search(p, q) for p in pats)
  return (True, 'ok') if has_year and has_md else (False, 'date_not_in_quote')


# ---------------------------------------------------------------- 자가 시험
class _R:
  def __init__(self, quote, value=None, low=None, high=None, value_text=None, event_date=None):
    self.quote, self.value, self.low, self.high, self.value_text = quote, value, low, high, value_text
    self.event_date = event_date


_SRC = ('Total | 1,028 | 977 | 2,917 | 2,862 ' 'The Company now expects 2026 adjusted sales to be between $7.55 billion '
        'to $7.60 billion versus prior guidance. Adjusted EBITDA | $(1.85)B – $(1.75)B '
        '2026년 판매목표(대수) 4,158,300 - 영업이익률 목표 : 7~8% '
        'CKD 60 60 0.0% - 0 - - 총계 6,537 8,863 -26.2 '  # KGM 2026-10 월 판매 공시(20261102800582) 원문

        'The Company expects 2026 sales to be up one to three percent versus 2025. '
        'The company also announced that on February 12th, 2026, after market close, it will release its fourth quarter'
        # 아래는 가상 문장 — 한국어 활용형·띄어쓰기 변이 · 잘린 수 · 붙은 범위 대시 · 한국어 날짜 꼴을 고정하려고 둔다
        ' 2026년 연간 매출액은 전년 대비 3~5% 증가할 것으로 전망합니다. '
        'Net sales of 1,028,500 units. Full-year guidance of $7.55-7.60 billion. '
        '2026년 1월 29일 경영실적 발표 예정')
MUST_HIT = [
  _R('Total | 1,028 | 977 | 2,917 | 2,862', value=1028000),                    # 천 대 → 대
  _R('expects 2026 adjusted sales to be between $7.55 billion to $7.60 billion', low=7.55, high=7.60),
  _R('Adjusted EBITDA | $(1.85)B - $(1.75)B', low=-1.85, high=-1.75),          # 괄호 음수 · 대시 정규화
  _R('2026년 판매목표(대수) 4,158,300', value=4158300),
  _R('CKD 60 60', value=60),                                                     # KGM 월 판매 짧은 행(9자)
  _R('expects 2026 sales to be up one to three percent', low=1.0, high=3.0),   # 폴라리스 — 영어 수 낱말
  _R('2026년 판매 목표(대수) 4,158,300', value=4158300),                      # 띄어쓰기 변이(원문 '판매목표')
  _R('연간 매출액은 전년대비 3~5% 증가할 것으로 전망합니다', low=3, high=5),     # 띄어쓰기 변이(원문 '전년 대비')
  _R('전년 대비 3~5% 증가할 것으로 전망합니다', value_text='증가할것으로 전망'),  # value_text 띄어쓰기 변이
  _R('Full-year guidance of $7.55-7.60 billion', low=7.55, high=7.60),         # 붙은 범위 대시 — 7.60 은 양수
]
MUST_MISS = [
  _R('Total | 1,028 | 977 | 2,917 | 2,862', value=1029000),                    # 숫자가 quote 에 없다
  _R('expects 2026 adjusted sales to be between $7.50 billion to $7.60 billion', low=7.50, high=7.60),  # 원문에 없는 quote
  _R('Total', value=1028),                                                       # 숫자 없는 짧은 quote
  _R('60 60', value=60),                                                         # 라벨 없는 짧은 quote
  _R('versus prior guidance. Adjusted EBITDA', value_text='Improved Y-o-Y'),     # value_text 가 quote 에 없다
  _R('expects 2026 sales to be up one to three percent', low=1.0, high=4.0),   # four 는 quote 에 없다
  _R('연간 매출액은 전년 대비 3~5% 증가했습니다', low=3, high=5),               # 활용형 — 전망을 실적으로 바꿔 쓴 인용
  _R('전년 대비 3~5% 증가할 것으로 전망합니다', value_text='증가했다'),           # value_text 활용형이 quote 와 다르다
  _R('CKD 6060', value=6060),                                                    # 숫자 사이 공백은 지우지 않는다
  _R('Net sales of 1,028', value=1028),                                          # 원문 1,028,500 의 한가운데서 잘린 수
]
DATE_HIT = [_R('on February 12th, 2026, after market close, it will release its fourth quarter', event_date='2026-02-12'),
            _R('2026년 1월 29일 경영실적 발표', event_date='2026-01-29')]
DATE_MISS = [_R('on February 12th, 2026, after market close, it will release its fourth quarter', event_date='2026-02-13'),
             _R('on February 12th, 2026, after market close, it will release its fourth quarter', event_date='2026-12-12'),  # 월·일 뒤바뀜
             _R('2026년 1월 29일 경영실적 발표', event_date='2026-01-09')]


def self_test() -> list[str]:
  errs = []
  for r in MUST_HIT:
    ok, note = check_row(r, _SRC)
    if not ok:
      errs.append(f'MUST_HIT 실패({note}): {r.quote[:50]}')
  for r in MUST_MISS:
    if check_row(r, _SRC)[0]:
      errs.append(f'MUST_MISS 통과돼 버림: {r.quote[:50]}')
  for r in DATE_HIT:
    ok, note = check_date_row(r, _SRC)
    if not ok:
      errs.append(f'DATE_HIT 실패({note}): {r.event_date}')
  for r in DATE_MISS:
    if check_date_row(r, _SRC)[0]:
      errs.append(f'DATE_MISS 통과돼 버림: {r.event_date}')
  return errs
