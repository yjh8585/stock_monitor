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
검토 1회차(2026-11-10)에서 더한 것:
- 값·value_text·날짜는 quote 전체가 아니라 «원문에서 확인된 긴 조각»에서만 찾는다('… 9.99' 지어낸 수 차단)
- 짧은 표 행은 한글 공백을 지운 꼴·안 지운 꼴 중 하나로 경계를 본다 · 연도 꼴은 배수 1 로만 ·
  한글 뒤 '-' 는 음수 부호 · 위첨자 각주 제거 · 공백 뒤 '-' 부호를 떨군 조각은 실패 · 유럽식·기간 날짜

한계(원리상 못 막는 것 — 파서 책임):
- 같은 quote 안의 «다른 칸» 숫자를 고르는 실수(열 선택 오류 — 당월 대신 누계, 올해 대신 전년)는 못 막는다.
  그 숫자도 quote 안에, 원문 안에 정말 있기 때문이다. 어느 열을 읽을지는 파서가 표 머리로 정해야 한다.
- 단위 환산이 맞는지(천 대·백만원·billion)도 보지 않는다 — 배수 중 하나로 맞으면 참이다.
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


def normalize(s: str, squash_ko: bool = True) -> str:
  """squash_ko=False 는 한글 사이 공백을 남긴 꼴 — 짧은 표 행의 공백 경계 판정용."""
  for k, v in LIG.items():
    s = s.replace(k, v)
  s = re.sub(r'[¹²³⁰-⁹]', '', s)  # 위첨자 각주 — NFKC 가 숫자로 바꿔 '1,028¹' 이 1,0281 이 된다
  s = unicodedata.normalize('NFKC', s)
  s = re.sub(r'[‐-―−]', '-', s)
  s = re.sub(r'[‘’‚‛“”„‟ʼ"\'`]', '', s)
  s = s.replace('|', ' ').replace('\xa0', ' ')
  s = re.sub(r'\s+', ' ', s).replace(' ,', ',').strip().lower()
  # 한글과 한글 사이 공백은 지운다 — 공시 원문(PDF·HTML 추출)과 LLM 인용의 띄어쓰기가 자주 갈린다
  # ('판매목표' ↔ '판매 목표'). 숫자·영문 사이 공백은 남긴다('CKD 60 60' 의 경계가 그것이다).
  if squash_ko:
    s = re.sub(r'(?<=[가-힣]) (?=[가-힣])', '', s)
  return s.rstrip('.;:,')


def _frag_in(frag: str, src: str) -> bool:
  """조각이 원문에 있되, 숫자로 시작하거나 끝나는 조각은 원문의 수를 잘라 먹은 자리면 거짓.
  - 끝: 'sales of 1,028' 이 원문 'sales of 1,028,500' 에 부분 문자열로 들어가는 거짓 통과를 막는다
  - 앞: 원문 '-26.2' 의 부호를 떨군 '26.2 …' 를 막는다. 공백·문장 시작 바로 뒤의 '-' 만
    부호로 본다 — 'Q3-2026' 의 '-' 는 하이픈이라 '2026 …' 조각은 통과한다"""
  pat = re.escape(frag)
  if frag[:1].isdigit():
    pat = r'(?<![\d,.])(?<!\s-)' + pat
  if frag[-1:].isdigit():
    pat += r'(?![\d]|[,.]\d)'
  return re.search(pat, ' ' + src) is not None


def _verified_text(quote: str, source: str) -> str | None:
  """quote 중 원문에서 확인된 부분(정규화 꼴). 원문에 없으면 None.
  긴 조각(12자 이상)은 전부 원문에 있어야 하고, 돌려주는 것은 그 긴 조각들뿐이다 — 짧아서 확인하지 않은
  조각('… 9.99')의 숫자를 값 근거로 인정하면 지어낸 숫자가 '…' 뒤에 붙어 통과한다.
  조각이 하나도 없는 짧은 quote 는 «글자 라벨 + 숫자»를 함께 갖고 통째로 원문에 있을 때만 인정한다.
  공백 경계로 보므로 한글 공백을 지운 꼴·안 지운 꼴 중 하나라도 맞으면 된다
  (지운 꼴만 쓰면 원문 '승용 렉스턴 60 60' 이 '승용렉스턴 60 60' 이 돼 '렉스턴 60 60' 이 경계를 잃는다)."""
  src = normalize(source)
  frags = [normalize(f) for f in FRAG_SPLIT.split(quote)]
  long_frags = [f for f in frags if len(f) >= MIN_FRAG]
  if long_frags:
    return ' '.join(long_frags) if all(_frag_in(f, src) for f in long_frags) else None
  q, q_raw = normalize(quote), normalize(quote, squash_ko=False)
  if len(q) < MIN_SHORT or not re.search(r'[a-z가-힣]', q) or not re.search(r'\d', q):
    return None
  if f' {q} ' in f' {src} ' or f' {q_raw} ' in f' {normalize(source, squash_ko=False)} ':
    return q
  return None


def quote_in_source(quote: str, source: str) -> bool:
  """quote 의 모든 조각(12자 이상)이 정규화한 원문에 그대로 있어야 참.
  조각이 하나도 없는 짧은 quote 는 «글자 라벨 + 숫자»를 함께 갖고 통째로 원문에 있을 때만 참."""
  return _verified_text(quote, source) is not None


def _number_tokens(s: str) -> list[tuple[float, bool]]:
  """(값, 연도 꼴인가). 연도 꼴 = 쉼표·소수점·부호 없는 19xx·20xx(원본 curatedQuality.ts numbersIn 의 연도 제외)."""
  t = _WORD_RE.sub(lambda m: str(_WORDS[m.group(1)]), normalize(s))
  out = []
  for m in re.finditer(r'\(?-?[\d,]*\.?\d+\)?', t):
    tok = m.group(0)
    # 앞 글자가 숫자·영문이면 '-' 는 음수 부호가 아니라 범위 대시다('7.55-7.60' 의 7.60 은 양수).
    # str.isalnum() 은 한글에도 참이라 '영업손실-1,234' 가 양수가 된다 → ASCII 만 본다
    range_dash = tok.startswith('-') and m.start() > 0 and re.match(r'[0-9a-z]', t[m.start() - 1]) is not None
    neg = tok.startswith('(') and tok.endswith(')') or (tok.startswith('-') and not range_dash)
    digits = tok.strip('()').lstrip('-').replace(',', '')
    if not digits or digits == '.':
      continue
    try:
      v = float(digits)
    except ValueError:
      continue
    out.append((-v if neg else v, re.fullmatch(r'(19|20)\d{2}', tok) is not None))
  return out


def numbers_in(s: str) -> list[float]:
  return [v for v, _ in _number_tokens(s)]


_MULTS = (1, 1e2, 1e3, 1e6, 1e9, 1e4, 1e8, 1e12, 1e-3, 1e-6)


def value_in_quote(value: float, quote: str, rel_tol: float = 1e-9) -> bool:
  """값이 quote 의 숫자 중 하나와 같다(단위 배수 1·백(억원→백만원)·천·백만·10억·만·억·조 중 하나로 맞으면 참).
  연도 꼴(2026)은 배수 1 로만 본다 — '2026년 판매목표' 의 2026 이 2,026,000·2.026 의 근거가 되면 안 된다."""
  for n, is_year in _number_tokens(quote):
    for mult in ((1,) if is_year else _MULTS):
      if abs(n * mult - value) <= max(abs(value) * rel_tol, 1e-9):
        return True
  return False


def check_row(row, source_text: str) -> tuple[bool, str]:
  """(verified, note). row 는 VolumeRow·ResultRow·GuidanceRow 어느 것이든(일정은 check_date_row).
  값·value_text 는 quote 전체가 아니라 «원문에서 확인된 부분»(_verified_text)에서만 찾는다."""
  seen = _verified_text(row.quote, source_text)
  if seen is None:
    return False, 'quote_not_in_source'
  values = [getattr(row, k) for k in ('value', 'low', 'high') if getattr(row, k, None) is not None]
  for v in values:
    if not value_in_quote(float(v), seen):
      return False, f'value_not_in_quote:{v}'
  if not values and not getattr(row, 'value_text', None):
    return False, 'no_value'
  if getattr(row, 'value_text', None) and normalize(row.value_text) not in seen:
    return False, 'value_text_not_in_quote'
  return True, 'ok'


def check_date_row(row, source_text: str) -> tuple[bool, str]:
  """일정 행: quote 가 원문에 있고, event_date 의 연·월·일이 quote 안에 있어야 참.
  월·일은 «붙어 있는 꼴»로만 본다 — 따로 찾으면 'February 12th' 가 12월 12일로도 통과한다.
  영어 월 이름(약칭·서수·앞 0 유무 · 기간 'Feb 11-12' · 'DD-Mon-YYYY') · 한국어 'M월 D일' ·
  숫자 'Y-M-D'·'Y.M.D'·'Y/M/D'·'M/D/Y'(빗금) · 유럽식 'D.M.Y'(점 — 포르쉐 공시 '27.10.2026').
  quote 중 원문에서 확인된 부분(_verified_text)에서만 찾는다."""
  q = _verified_text(row.quote, source_text)
  if q is None:
    return False, 'quote_not_in_source'
  y, m, d = (int(x) for x in row.event_date.split('-'))
  full = _MONTHS[m - 1]
  mon = rf'(?:{full}|{full[:3]}{"t?" if m == 9 else ""})\b\.?'  # 'mar[a-z]*' 로 열면 market·decline 에 걸린다
  day = rf'0?{d}(?:st|nd|rd|th)?(?!\d)'
  pats = [rf'\b{mon}\s+(?<!\d){day}',                                      # February 12th
          rf'\b{mon}\s+\d{{1,2}}(?:st|nd|rd|th)?\s*-\s*{day}',              # Feb 11-12 (끝날)
          rf'(?<!\d){day}(?:\s+(?:of\s+)?|\s*-\s*){mon}',                    # 12 February · 12-Feb-2026
          rf'(?<!\d)0?{m}\s*월\s*0?{d}\s*일',                                # 2월 12일
          rf'{y}\s*[-./]\s*0?{m}\s*[-./]\s*0?{d}(?!\d)', rf'(?<!\d)0?{m}/0?{d}/{y}',
          rf'(?<!\d)0?{d}\.\s*0?{m}\.\s*{y}']                                # 12.02.2026
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
        '2026년 1월 29일 경영실적 발표 예정 '
        # 검토 1회차 — 포르쉐 EQS 공시 실물(fixtures/ir_lists/porsche_feed.json 2026-10-08 글)
        'Preliminary announcement of the publication of quarterly reports and quarterly/interim statements '
        '08.10.2026 / 15:07 CET/CEST ... Date of disclosure: October 27, 2026 Address: '
        # 검토 1회차 — 가상 문장(검토자 탐침): 짧은 한글 표 행 · 한글 뒤 음수 · 위첨자 각주 · 하이픈 연도 · 유럽식·기간 날짜
        '구분 승용 렉스턴 60 60 0.0% 당기 영업손실-1,234 백만원 Deliveries 1,028¹ 977 '
        'Outlook Q3-2026 deliveries 1,500 units. Annual General Meeting 12.02.2026 '
        'Capital Markets Day Feb 11-12, 2026 12-Feb-2026 Annual General Meeting')
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
  # 검토 1회차
  _R('렉스턴 60 60', value=60),                                                  # 짧은 한글 표 행 — 앞 칸 라벨과 붙지 않는다
  _R('승용 | 렉스턴 | 60 | 60', value=60),                                       # 짧은 표 행(정규화 후 11자)
  _R('expects 2026 adjusted sales to be between $7.55 billion … versus prior guidance', low=7.55),  # 확인된 긴 조각의 수는 인정
  _R('당기 영업손실-1,234 백만원', value=-1234),                                 # 한글 뒤 '-' 는 음수 부호
  _R('Deliveries | 1,028¹ | 977', value=1028),                                   # 위첨자 각주는 지운다
  _R('2026 deliveries 1,500 units', value=1500),                                 # 'Q3-2026' 의 '-' 는 하이픈 — 부호 아님
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
  # 검토 1회차 — 확인 안 된 짧은 조각에 지어낸 수를 붙인 꼴
  _R('expects 2026 adjusted sales to be between $7.55 billion … 9.99', value=9.99),
  _R('expects 2026 adjusted sales to be between $7.55 billion / 9.99', value=9.99),
  _R('Net sales of 1,028,500 units... 777', value=777),
  _R('2026년 판매목표(대수) 4,158,300', value=2026000),                         # 연도를 천 단위 값으로
  _R('2026년 판매목표(대수) 4,158,300', value=2.026),                           # 연도를 1/1000 값으로
  _R('당기 영업손실-1,234 백만원', value=1234),                                  # 손실을 양수로
  _R('26.2 The Company expects 2026 sales', value=26.2),                          # 원문 '-26.2' 의 부호를 떨군 조각
]
DATE_HIT = [_R('on February 12th, 2026, after market close, it will release its fourth quarter', event_date='2026-02-12'),
            _R('2026년 1월 29일 경영실적 발표', event_date='2026-01-29'),
            _R('quarterly/interim statements 08.10.2026 / 15:07 CET/CEST', event_date='2026-10-08'),  # 포르쉐 실물 D.M.Y
            _R('Date of disclosure: October 27, 2026', event_date='2026-10-27'),                       # 포르쉐 실물
            _R('Annual General Meeting 12.02.2026', event_date='2026-02-12'),
            _R('Capital Markets Day Feb 11-12, 2026', event_date='2026-02-12'),                        # 기간의 끝날
            _R('12-Feb-2026 Annual General Meeting', event_date='2026-02-12')]
DATE_MISS = [_R('on February 12th, 2026, after market close, it will release its fourth quarter', event_date='2026-02-13'),
             _R('on February 12th, 2026, after market close, it will release its fourth quarter', event_date='2026-12-12'),  # 월·일 뒤바뀜
             _R('2026년 1월 29일 경영실적 발표', event_date='2026-01-09'),
             _R('Annual General Meeting 12.02.2026', event_date='2026-12-02'),                         # D.M.Y 를 M.D.Y 로
             _R('Capital Markets Day Feb 11-12, 2026', event_date='2026-02-13')]


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
