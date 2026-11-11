"""고객사 문서·뉴스 요약 검사기 — 모델 출력이 이 검사를 통과해야 status='ok' 로 저장된다(틀린 요약보다 빈칸).

지시서 정본 = lib/customer_summary_prompt.py(여기서 잡는 규칙은 거기에도 같은 말로 적혀 있다).
호출 = scripts/summarize_customer_docs.py · scripts/summarize_customer_news.py — 지적이 있으면 1회 재요청, 그래도 있으면
check_failed 로 남긴다.

숫자 대조(unmatched_numbers) — 요약 숫자마다 원문에 «표시 자릿수 반올림 안»의 짝이 있어야 한다:
- 원문 토큰 = lib/llm_guidance.number_tokens. 🔴 그 함수는 문서 첫 표 머리 배수('in millions')를 단위 없는 모든 수에 씌운다
  → «자체 단위 낱말이 없는» 원문 수만 후보값을 «n×배수» 와 «n(배수 없음)» 둘 다로 보고, 문서 안 «모든» 표 머리 배수
  (_HEADERS — 「단위 : 십억원」 포함)도 각각 씌워 본다(국문 IR 은 첫 머리가 「천대」이고 금액 표가 「십억원」 — 2026-11-12
  드라이런 실측). 단위가 박힌 수($4,213 million)는 그 배수 값 하나뿐(요약 「4,213달러」가 통과했다 — Codex 2026-11-12).
  SHORTCUT: 후보가 넓어진 만큼 틀린 값이 표 어딘가의 수와 우연히 맞아 통과할 수 있다(실측 28쪽 자료에서 「35.0조」 통과)
  → 줄의 지표 낱말과 표 행을 짝짓는 대조로 좁힐 수 있다(지금은 «원문에 그 수가 있다»까지만 본다).
- 🔴 원문의 쪽 표식 [p.N] 은 대조 전에 지운다(요약 7% 가 쪽 표식 7 로 통과했다 — Codex 대조 2026-11-12).
- 요약 수 뒤가 %·%p·bp 면 원문 짝도 %·percent·per cent·pts·ppt·bp 가 붙은 수여야 한다. 원문 bp 는 ÷100 한 값만,
  요약 bp 도 ÷100 해서 맞춘다(50bp ↔ 0.5%p · 50bp ≠ 50%p). 범위('50 to 100 bps')의 앞 수도 bp 를 이어받는다.
- 원문 수마다 통화를 붙여 둔다(수 앞뒤 표지 → 문서에 하나뿐인 표 머리 통화 → 모름). 요약 수에 통화 낱말이 붙어 있으면
  통화가 같거나 모르는 원문 수와만 맞춘다('$1 billion … EUR 200 million' 원문에 「10억 유로」는 지적).
- 요약 「N분기」는 원문의 분기 표기(Q3·3Q·third quarter·3분기·three months ended September)와만 맞춘다 —
  맨 숫자 3 과 맞추면 4% 의 4 가 「4분기」를 통과시킨다. 「a~b분기」는 원문 누적 구간과 시작·끝이 같아야 한다
  (nine months·9M = 1~3 · six months·H1·1H = 1~2 · YTD·누적 = 같은 원문의 분기 표기 n 으로 1~n · 끝을 모르면 지적)
  — 아니면 두 끝 분기 표기가 둘 다 원문에 있어야 한다.
- 「N년」·「FY」 꼴 연도는 원문 연도 표기(FY·CY·년·year·fiscal·Q/H/9M 옆·날짜 — _SRC_YEAR)에서 뽑은 후보와만 맞춘다.
  2자리 연도(FY26·'25·3Q25·1H26)는 20xx 로 본다. 「N월」은 영어 달 이름이나 같은 수.
  맨 연도('in 2027'·'since 2015')도 후보 — 쉼표·소수점 없는 1990~2100 정수이고 바로 뒤에 배수 낱말·%, 바로 앞에 통화
  표지가 없을 때만(소급 180건의 검사 실패 17건 중 10건이 이 꼴 — 2026-11-12).
- 표 머리 % (「단위 : 억원, %」·「(%)」·XLSX 머리 칸 '| % |')가 있는 문서는 맨 수도 % 후보 · 'five percent' 꼴 낱말 % 도 후보.
통화(currency_problems) — 요약 줄의 「수+통화 낱말」(달러·유로·원·엔·위안·파운드)이 원문 어딘가에 그 통화로 나와야 한다.
  원문 원화 근거는 수 뒤의 원·₩·KRW·단위 머리(십억원 …)만(맨 「원」은 원가·임직원에 걸린다).
줄 — 빈 줄·공백만인 줄은 지적, 줄 수 3~5 는 내용 있는 줄로 센다. 근거 인용이 쪽 경계를 넘으면 시작 쪽으로 고치고, 쪽 번호가
  1..쪽 수 밖이면 지적. 뉴스 empty=true 인데 줄·링크·관련 기사 수가 있으면 지적(재요청).
부호(±)는 검사하지 않는다(지시서로만).
번역투(translationese_problems) — verify_translationese.scan + 그 검사기가 안 잡는 표현(EXTRA_RULES). 「를 통해」는 흔해서 뺐다.
"""
import re

from lib import customer_summary_prompt as sp
from lib.llm_guidance import _JOIN, _own_mult, number_tokens

# ---------------------------------------------------------------- 원문 정리
_PAGE_MARK = re.compile(r'\[p\.(\d+)\]')
_WS = re.compile(r'\s+')


def _strip_marks(text: str) -> str:
  return _PAGE_MARK.sub(' ', text or '')


def _norm(text: str) -> str:
  """근거 인용 대조용 — 쪽 표식 제거 · 공백 하나로 · 둥근 따옴표를 곧은 것으로."""
  t = _strip_marks(text).replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"')
  return _WS.sub(' ', t).strip()


def _page_segments(text: str) -> list[tuple[int, str]]:
  """[p.N] 표식으로 나눈 (쪽, 정규화 글) — 첫 표식 앞 글은 버린다(쪽을 모른다)."""
  marks = list(_PAGE_MARK.finditer(text or ''))
  return [(int(m.group(1)), _norm(text[m.end(): marks[i + 1].start() if i + 1 < len(marks) else len(text)]))
          for i, m in enumerate(marks)]


def _start_page(segments: list[tuple[int, str]], q: str) -> int | None:
  """여러 쪽에 걸친 인용의 시작 쪽 — 쪽 글을 공백 하나로 이은 글에서 q 가 시작하는 자리의 쪽(없으면 None)."""
  joined, starts = '', []
  for pg, seg in segments:
    if not seg:
      continue
    if joined:
      joined += ' '
    starts.append((len(joined), pg))
    joined += seg
  at = joined.find(q)
  if at < 0:
    return None
  return [pg for pos, pg in starts if pos <= at][-1]


# ---------------------------------------------------------------- 원문 쪽 후보
_SRC_PCT = re.compile(r'\)?\s*(?:%|percent\b|per\s?cent\b|percentage\s+points?\b|pts?\b|ppts?\b|bps?\b|basis\s+points?\b'
                      r'|퍼센트|포인트)', re.I)
_SRC_BP = re.compile(r'\)?\s*(?:bps?\b|basis\s+points?\b)', re.I)
# 표 머리 단위 — 문서 안의 «모든» 머리를 모아 단위 없는 수에 각각 씌워 본다.
# 🔴 number_tokens 는 «첫» 머리 하나만 쓰고 「십억」을 모른다 — 국문 IR 자료는 첫 머리가 「(단위 : 천대)」이고 금액 표가
#    「(단위 : 십억원)」이라 맞는 「31.6조 원」이 걸리고 재요청에서 매출 금액이 빠졌다(2026-11-12 드라이런 실측).
_HEADERS = re.compile(
  r'단위\s*[:：]?\s*(?:[A-Za-z$€£₩¥]{1,3}\s*)?(천|만|백만|십억|억|조)'
  r'|\(\s*(천|만|백만|십억|억|조)\s*(?:원|달러|유로|대)\s*\)'
  r'|\bin\s+(?:[€$£¥₩]|EUR|USD|GBP|JPY|KRW)?\s*(thousand|million|billion|mn|bn)s?\b'
  r'|\(\s*(?:[€$£₩¥]|EUR|USD|KRW|GBP|JPY)?\s*(thousand|million|billion|mn|bn)s?\s*\)'
  r'|(?:€|\$|£|\bEUR|\bUSD)\s?(million|billion|mn|bn)\b'
  # 단위 낱말이 통화 앞 — 포르쉐 fact_sheet XLSX 머리 칸 'million € | Q1 2026 | % |'(소급 2026-11-12 실측)
  r'|\b(thousand|million|billion|mn|bn)s?\s*(?:€|\$|£|EUR\b|USD\b)', re.I)
# 표 머리 % — 단위가 칸이 아니라 머리에 있는 표(DART 잠정실적 「단위 : 억원, %」·「증감율(%)」 · XLSX 머리 칸 '| % |').
# 문서에 이 머리가 있으면 단위 낱말 없는 원문 수도 % 후보로 본다(소급 2026-11-12: 맞는 「25.3%」·「7.8%」가 걸렸다).
# SHORTCUT: 문서 단위로 켠다 — 표 경계를 몰라 % 아닌 칸의 수도 % 후보가 된다 → 표 행·열 구조를 살린 대조로 좁힐 수 있다
_PCT_HEADER = re.compile(r'단위\s*[:：][^|\n()]{0,20}%|\(\s*%\s*\)|\|\s*%\s*(?:\||$)|\bin\s+%', re.I | re.M)
# 낱말로 쓴 % — 'decreased five percent'(PII 실적 발표 · 소급 2026-11-12)
_WORD_NUM = {w: i for i, w in enumerate(
  'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen '
  'nineteen twenty'.split(), 1)}
_WORD_PCT = re.compile(r'\b(' + '|'.join(_WORD_NUM) + r')\s+(?:percent|per\s?cent)\b', re.I)
_HEADER_MULT = {'천': 1e3, '만': 1e4, '백만': 1e6, '십억': 1e9, '억': 1e8, '조': 1e12, 'thousand': 1e3, 'million': 1e6,
                'mn': 1e6, 'billion': 1e9, 'bn': 1e9}
# 수마다 통화(Codex 2회차 2026-11-12: '$1 billion … EUR 200 million' 원문에 「10억 유로」가 통과했다 — 수와 통화를 따로
# 찾았기 때문). 표지는 수 바로 앞('$1'·'EUR 200') 또는 수·배수 낱말에 바로 붙은 뒤('200 million euros'·'31.6조 원').
# 모양은 llm_guidance._token_currencies 와 같다 — 그쪽은 USD·EUR·VND·KRW 만 알아 엔·위안·파운드를 못 가려 따로 둔다.
_CUR_NAMES = (
  ('달러', re.compile(r'US\$|\$|USD|dollars?|달러', re.I)),
  ('유로', re.compile(r'€|EUR|euros?|유로', re.I)),
  ('파운드', re.compile(r'£|GBP|pounds?\s+sterling|파운드', re.I)),
  ('엔', re.compile(r'¥|JPY|yen|엔', re.I)),
  ('위안', re.compile(r'CNY|RMB|yuan|위안', re.I)),
  ('원', re.compile(r'₩|KRW|won|원', re.I)),
)
_CUR_ANY = re.compile(r'US\$|\$|€|£|¥|₩|\b(?:USD|EUR|GBP|JPY|CNY|RMB|KRW)\b|달러|유로|원|엔|위안|파운드', re.I)
_CUR_PRE = re.compile(r'(US\$|\$|€|£|¥|₩|USD|EUR|GBP|JPY|CNY|RMB|KRW)\s*\(?\s*$', re.I)
_CUR_SUF = re.compile(r'\)?\s*(?:[천백]?\s?(?:조|억|만)|천|(?:trillion|tn|billion|bn|million|mn|thousand|[kbm])(?![a-z]))?'
                      r'\s*(?:in\s+)?(?:U\.?\s?S\.?\s*)?(euros?\b|dollars?\b|yen\b|yuan\b|won\b|pounds?\s+sterling\b'
                      r'|달러|유로|원(?!가)|엔(?![진터지트])|위안|파운드|USD\b|EUR\b|KRW\b|JPY\b|CNY\b|RMB\b|GBP\b)', re.I)


def _cur_name(word: str) -> str:
  return next(name for name, p in _CUR_NAMES if p.fullmatch(word))


def _currency_in(text: str) -> str | None:
  """표 머리 글 안의 통화 이름(없으면 None)."""
  m = _CUR_ANY.search(text)
  return _cur_name(m.group(0)) if m else None


def _num_currencies(t: str, toks: list, fallback: str | None) -> list[str | None]:
  """토큰마다 통화 이름(달러·유로 …) — 범위로 이어진 수끼리 나눠 받고, 끝내 없으면 fallback."""
  out = []
  for k in toks:
    m = _CUR_PRE.search(t[max(0, k.start - 6):k.start]) or _CUR_SUF.match(t, k.end)
    out.append(_cur_name(m.group(1)) if m else None)
  joined = [bool(_JOIN.fullmatch(t[toks[i].end:toks[i + 1].start])) for i in range(len(toks) - 1)]
  for i in range(len(toks) - 1):                        # 앞으로 한 번 · 뒤로 한 번 — '1 to 2 trillion yen'
    if joined[i] and out[i + 1] is None:
      out[i + 1] = out[i]
  for i in range(len(toks) - 2, -1, -1):
    if joined[i] and out[i] is None:
      out[i] = out[i + 1]
  return [c or fallback for c in out]


_YEAR2_BEFORE = re.compile(r"(?:\bFY|\bCY|['’]|\b[1-4]Q|\bQ[1-4]\s?|\bH[12]\s?|\b[12]H)$", re.I)
# 연도 표기 — 「N년」·「FY」 꼴 요약 연도는 이 후보와만 맞춘다(금액 2,027 이 「2027년」 근거가 되면 안 된다 — Codex 2026-11-12).
# SHORTCUT: 「in 2026」·「2026E」처럼 표기가 약한 연도는 후보가 아니다 → 정상 요약이 막히면 여기 꼴을 더한다
_Y4 = r'((?:19|20)\d{2})(?!\d)'
_MONTH_NAMES = (r'(?:january|february|march|april|may|june|july|august|september|october|november|december'
                r'|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\.?')
_PERIOD = (r'(?:Q[1-4]|[1-4]Q|H[12]|[12]H|9M|6M|3M|(?:first|second|third|fourth)[- ]quarter|quarter|'
           r'(?:first|second)[- ]half|nine[- ]months|six[- ]months)')
_SRC_YEAR = (
  re.compile(r"(?<![A-Za-z])(?:FY|CY)\s?['’]?" + _Y4, re.I),
  re.compile(r'(?<!\d)' + _Y4 + r'\s*년'),
  re.compile(r'\b(?:fiscal|year)(?:\s+(?:year|of))?\s+' + _Y4, re.I),
  re.compile(r'\b' + _Y4 + r'\s+(?:fiscal\s+)?year\b', re.I),
  re.compile(r'\b' + _PERIOD + r"(?:\s+of)?\s*['’]?\s*" + _Y4, re.I),
  re.compile(r'\b' + _Y4 + r'\s*' + _PERIOD + r'\b', re.I),
  re.compile(r'\b' + _MONTH_NAMES + r'\s+(?:\d{1,2}(?:st|nd|rd|th)?,?\s+)?' + _Y4, re.I),
  re.compile(r'\b\d{1,2}\s+' + _MONTH_NAMES + r',?\s+' + _Y4, re.I),
  # 날짜 — 「2026-09」·「2026/09」·「2026.10.28」(점 하나 「2026.10」은 금액 2026.10 과 못 가른다)
  re.compile(r'(?<![\d.,])' + _Y4 + r'(?:[-/]\d{1,2}(?!\d)|\.\s?\d{1,2}\.\s?\d{1,2}(?!\d))'),
  re.compile(r'(?<![\d.,])\d{1,2}[-./]\d{1,2}[-./]' + _Y4),
)

_ORD = {'first': 1, 'second': 2, 'third': 3, 'fourth': 4, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4}
_Q_PATTERNS = (
  re.compile(r'\bQ\s?([1-4])(?!\d)', re.I),
  re.compile(r'(?<![\d.])([1-4])\s?Q(?![a-z])', re.I),
  re.compile(r'\b(first|second|third|fourth|1st|2nd|3rd|4th)[- ]quarter', re.I),
  re.compile(r'([1-4])\s*분기'),
)
_Q_MONTHS_ENDED = re.compile(r'three[- ]months?\s+ended\s+(March|June|September|December)', re.I)
_QEND = {'march': 1, 'june': 2, 'september': 3, 'december': 4}
# 누적 구간 (시작 분기, 끝 분기) — 요약 「a~b분기」는 이 구간 하나와 시작·끝이 같아야 한다(Codex 2026-11-12: 「2~3분기」가
# nine months 로, 「1~4분기」가 Q3 YTD 로 통과했다).
# SHORTCUT: 누적 표기는 흔한 꼴만(nine months·YTD·누적·상반기 …) → 다른 꼴이 정상 요약을 막으면 여기에 더한다
_CUMULATIVE = (
  ((1, 2), re.compile(r'six[- ]months|first[- ]half|\bH1\b|\b1H(?:\d{2})?\b|\b6M(?:\d{2})?\b|상반기', re.I)),
  ((1, 3), re.compile(r'nine[- ]months|\b9M(?:\d{2})?\b', re.I)),
  ((1, 4), re.compile(r'twelve[- ]months|full[- ]year|\bFY\b|연간', re.I)),
)
_KO_Q_RANGE = re.compile(r'([1-4])\s*[~～\-–]\s*([1-4])\s*분기')
# YTD·누적은 끝 분기를 스스로 말하지 않는다 — 같은 원문의 분기 표기(Qn·n분기)를 끝으로 본다(없으면 구간 없음)
_YTD = re.compile(r'year[- ]to[- ]date|\bYTD\b|누적', re.I)
_MONTHS = {m: i + 1 for i, names in enumerate([
  ('january', 'jan'), ('february', 'feb'), ('march', 'mar'), ('april', 'apr'), ('may',), ('june', 'jun'),
  ('july', 'jul'), ('august', 'aug'), ('september', 'sept', 'sep'), ('october', 'oct'), ('november', 'nov'),
  ('december', 'dec')]) for m in names}
_MONTH_WORD = re.compile(r'\b(' + '|'.join(sorted(_MONTHS, key=len, reverse=True)) + r')\b\.?', re.I)


class _Source:
  """원문 한 편의 대조 후보(한 번만 계산)."""

  def __init__(self, text: str):
    self.text = _strip_marks(text)
    t = self.text
    self.cands: list[tuple[float, bool, str | None]] = []   # (값, % 수인가, 통화 — None 은 모름)
    toks = number_tokens(t)
    pct = [bool(_SRC_PCT.match(t[k.end:k.end + 24])) for k in toks]
    bp = [p and bool(_SRC_BP.match(t[k.end:k.end + 24])) for k, p in zip(toks, pct)]
    for i in range(len(toks) - 2, -1, -1):              # '3 and 5 per cent' — 앞 수가 뒤 % 를 이어받는다
      if not pct[i] and pct[i + 1] and _JOIN.fullmatch(t[toks[i].end:toks[i + 1].start]):
        pct[i] = True
        bp[i] = bp[i + 1]                               # '50 to 100 bps' — 앞 수도 bp(÷100) — Codex 2회차 2026-11-12
    # 자체 단위 낱말(million·억·% …)이 붙은 수 — 범위 잇기로 뒤 수의 낱말을 이어받은 것 포함(number_tokens 와 같은 규칙)
    own = [_own_mult(t[k.end:k.end + 16]) for k in toks]
    for i in range(len(toks) - 2, -1, -1):
      if own[i] is None and own[i + 1] is not None and _JOIN.fullmatch(t[toks[i].end:toks[i + 1].start]):
        own[i] = own[i + 1]
    head_matches = list(_HEADERS.finditer(t))
    heads = {_HEADER_MULT[next(g for g in m.groups() if g).lower()] for m in head_matches}
    # 수마다 통화 — 그 수 앞뒤의 통화 표지, 없으면 표 머리 통화(문서 안에 하나뿐일 때), 그것도 없으면 None(모름)
    head_curs = {c for m in head_matches if (c := _currency_in(t[m.start():m.end() + 2]))}
    curs = _num_currencies(t, toks, next(iter(head_curs)) if len(head_curs) == 1 else None)
    self.years = {int(m.group(1)) for pat in _SRC_YEAR for m in pat.finditer(t)}
    pct_head = bool(_PCT_HEADER.search(t))
    for k, p, b, o, c in zip(toks, pct, bp, own, curs):
      raw = t[k.start:k.end]
      # 맨 연도 — 쉼표·소수점 없는 1990~2100 정수이고 금액 배수 낱말·%·통화 표지가 안 붙은 수('in 2027'·'since 2015'
      # ·'2024 VS. 2025' — 소급 2026-11-12 실측). '$2,027 million' 은 쉼표·배수 둘 다로 빠진다.
      # 배수·% 는 «바로 뒤»만 본다 — 범위 잇기로 물려받은 것은 안 본다('since 2024' 다음 줄 '-29.4k' 가 '-' 로 이어졌다).
      # SHORTCUT: 표 머리 배수 아래의 맨 수 2027(금액)도 연도 후보가 된다 → 표 칸 구조를 살리면 좁힐 수 있다
      after = t[k.end:k.end + 24]
      if (1990 <= k.n <= 2100 and ',' not in raw and '.' not in raw and _own_mult(after[:16]) is None
              and not _SRC_PCT.match(after) and not _CUR_PRE.search(t[max(0, k.start - 6):k.start])):
        self.years.add(int(k.n))
      if b:
        vals = {k.n / 100}                              # bp 는 %p 로 바꾼 값만(50bp 가 50%p 의 근거가 되면 안 된다)
      elif o is not None:
        vals = {k.n * o}                                # 단위가 박힌 수 — 배수를 지우지 않는다($4,213 million ≠ 4,213달러)
      else:
        vals = {k.n, k.n * k.mult} | {k.n * h for h in heads}   # 표 머리 배수를 이어받은 수만 배수 없는 값도 후보
      if k.n < 100 and k.n == int(k.n) and _YEAR2_BEFORE.search(t[max(0, k.start - 4):k.start]):
        self.years.add(2000 + int(k.n))
      self.cands.extend((v, p, c) for v in vals)
      if pct_head and o is None and not p:              # 표 머리 % 아래 맨 수 — 배수 없는 값만 % 후보
        self.cands.append((k.n, True, None))
    self.cands.extend((float(_WORD_NUM[m.group(1).lower()]), True, None) for m in _WORD_PCT.finditer(t))
    self.quarters = {int(m.group(1)) if m.group(1).isdigit() else _ORD[m.group(1).lower()]
                     for pat in _Q_PATTERNS for m in pat.finditer(t)}
    self.quarters |= {_QEND[m.group(1).lower()] for m in _Q_MONTHS_ENDED.finditer(t)}
    self.months = {_MONTHS[m.group(1).lower()] for m in _MONTH_WORD.finditer(t)}
    self.cumulative = {span for span, pat in _CUMULATIVE if pat.search(t)}
    self.cumulative |= {(int(m.group(1)), int(m.group(2))) for m in _KO_Q_RANGE.finditer(t)}
    if _YTD.search(t):
      self.cumulative |= {(1, q) for q in self.quarters}

  def has_value(self, v: float, tol: float, need_pct: bool, cur: str | None = None) -> bool:
    """cur(요약 수에 붙은 통화)가 있으면 통화가 같거나 모르는 후보와만 맞춘다."""
    eps = max(abs(v) * 1e-9, 1e-9)
    return any(abs(c - v) <= tol + eps for c, p, cc in self.cands
               if (p or not need_pct) and (cur is None or cc is None or cc == cur))


# ---------------------------------------------------------------- 요약 쪽 토큰
_SUM_PCT = re.compile(r'\)?\s*(?:%|퍼센트)')
_SUM_BP = re.compile(r'\s*(?:bps?(?![a-z])|베이시스\s*포인트)', re.I)
_SUM_QUARTER = re.compile(r'\s*분기')
_SUM_MONTH = re.compile(r'\s*월(?!요일)')
_SUM_YEAR_AFTER = re.compile(r'\s*년')
_SUM_FY_BEFORE = re.compile(r'(?<![A-Za-z])(?:FY|CY)\s?$', re.I)


def _decimals(s: str) -> int:
  return len(s.split('.', 1)[1]) if '.' in s else 0


def _frag(text: str, start: int, end: int) -> str:
  return _WS.sub(' ', text[max(0, start - 10):end + 10]).strip()


def _unmatched(summary_text: str, src: _Source) -> list[str]:
  s = summary_text or ''
  toks = number_tokens(s)
  n = len(toks)
  pct = [bool(_SUM_PCT.match(s[k.end:k.end + 4])) for k in toks]
  bp = [bool(_SUM_BP.match(s[k.end:k.end + 8])) for k in toks]
  quarter = [bool(_SUM_QUARTER.match(s[k.end:k.end + 4])) for k in toks]
  year_after = [bool(_SUM_YEAR_AFTER.match(s[k.end:k.end + 3])) for k in toks]
  curs = _num_currencies(s, toks, None)                 # 「10억 유로」 — 통화가 같거나 모르는 원문 수와만 맞춘다
  joined = [i + 1 < n and bool(_JOIN.fullmatch(s[toks[i].end:toks[i + 1].start])) for i in range(n)]
  for i in range(n - 2, -1, -1):
    if joined[i] and pct[i + 1]:
      pct[i] = True
    if joined[i] and bp[i + 1]:
      bp[i] = True
    if joined[i] and year_after[i + 1]:                 # 「2026~2027년」 — 앞 수도 연도
      year_after[i] = True
  out = []
  skip = set()
  for i, k in enumerate(toks):
    if i in skip:
      continue
    raw = s[k.start:k.end]
    if joined[i] and quarter[i + 1]:                    # 「1~3분기」 — 누적 구간(시작·끝 같게) 또는 두 끝 분기 표기
      a, b = int(k.n), int(toks[i + 1].n)
      if not ((a, b) in src.cumulative or {a, b} <= src.quarters):
        out.append(_frag(s, k.start, toks[i + 1].end))
      skip.add(i + 1)
      continue
    if quarter[i]:
      if int(k.n) not in src.quarters:
        out.append(_frag(s, k.start, k.end))
      continue
    # 연도 — 「2026년」·「FY2026」·「FY26」은 원문 연도 표기 후보와만(일반 수와 맞추지 않는다)
    fy = bool(_SUM_FY_BEFORE.search(s[max(0, k.start - 3):k.start]))
    if k.n == int(k.n) and ',' not in raw and ((year_after[i] and 1900 <= k.n <= 2099) or (fy and k.n < 2100)):
      y = int(k.n) + (2000 if k.n < 100 else 0)
      if y not in src.years:
        out.append(_frag(s, k.start, k.end))
      continue
    if _SUM_MONTH.match(s[k.end:k.end + 4]) and 1 <= k.n <= 12:
      if int(k.n) not in src.months and not src.has_value(k.n, 0.5, False):
        out.append(_frag(s, k.start, k.end))
      continue
    v = k.n * k.mult
    tol = 0.5 * 10 ** -_decimals(raw) * k.mult
    if bp[i]:                                           # 요약 bp 는 %p 로 바꿔 % 문맥 원문과 맞춘다
      v, tol = v / 100, tol / 100
    if not src.has_value(v, tol, pct[i] or bp[i], curs[i]):
      out.append(_frag(s, k.start, k.end))
  return out


def unmatched_numbers(summary_text: str, source_text: str) -> list[str]:
  """요약 숫자 중 원문에 짝이 없는 것의 조각(앞뒤 10자) 목록. 빈 목록이면 통과."""
  return _unmatched(summary_text, _Source(source_text))


# ---------------------------------------------------------------- 통화
_SUM_CURRENCY = re.compile(r'\d[\d,.]*\s*(?:[천백]?\s*(?:조|억|만)\s*)?(달러|유로|원|엔(?![진터지트])|위안|파운드)')
_SRC_CURRENCY = {
  '달러': re.compile(r'\$|\bUSD\b|\bdollars?\b|달러', re.I),
  '유로': re.compile(r'€|\bEUR\b|\beuros?\b|유로', re.I),
  # 원화 근거는 «수 뒤에 붙은 원»·₩·KRW·단위 머리(십억원·억원·조원·백만원)만 — 맨 「원」은 원가·임직원에 걸린다(Codex 2026-11-12).
  # 국문 기사는 「영업익 2.5조」처럼 원을 생략한다 — 다른 통화 낱말이 붙지 않은 조·억 금액도 원으로 본다
  '원': re.compile(r'₩|\bKRW\b|\d[\d,.]*\s*(?:[천백]?\s*(?:조|억|만)\s*|천\s*)?원'
                  r'|\d[\d,.]*\s*(?:trillion|billion|million|tn|bn|mn)?\s*won\b'
                  r'|(?:십억|백만|천만|억|조)\s*원|\d\s*[조억](?!\s*(?:달러|유로|엔|위안|파운드))', re.I),
  '엔': re.compile(r'¥|\bJPY\b|\byen\b|엔화|\d\s*엔', re.I),
  '위안': re.compile(r'\bCNY\b|\bRMB\b|\byuan\b|위안', re.I),
  '파운드': re.compile(r'£|\bGBP\b|\bpounds?\s+sterling\b|파운드', re.I),
}


def currency_problems(line: str, source_text: str) -> list[str]:
  out = []
  for cur in dict.fromkeys(m.group(1) for m in _SUM_CURRENCY.finditer(line or '')):
    if not _SRC_CURRENCY[cur].search(source_text or ''):
      out.append(f'통화: 「{cur}」가 원문에 없다 — 원문 통화 그대로 적을 것 ({_WS.sub(" ", line)[:40]})')
  return out


# ---------------------------------------------------------------- 번역투
# verify_translationese.scan 이 안 잡는 표현. 이름 = 지적 문구에 그대로 나간다.
# 🔴 한국어는 활용하면 글자가 바뀐다 — 어형을 낱낱이 적고, 표본을 MUST_HIT/MUST_MISS 로 함께 돌린다(self_test).
EXTRA_RULES: list[tuple[str, str]] = [
  ('에 있어서', r'에\s*있어서'),
  ('것으로 나타났다', r'것으로\s*나타났|것으로\s*나타난다'),
  ('이루어졌다', r'이루어졌|이뤄졌'),
  ('되어진', r'되어진'),
  ('되어졌', r'되어졌'),
]
EXTRA_MUST_HIT = [
  ('에 있어서', '관세 영향에 있어서 비용이 늘었다.'),
  ('것으로 나타났다', '판매가 늘어난 것으로 나타났다.'),
  ('것으로 나타났다', '판매가 늘어난 것으로 나타났으며 이익도 늘었다.'),
  ('이루어졌다', '구조조정이 이루어졌다.'),
  ('이루어졌다', '투자가 이뤄졌다.'),
]
EXTRA_MUST_MISS = [
  '회사는 하향 이유로 미국 관세 비용을 들었다.',
  '공장에 있는 설비를 옮겼다.',
  '합의가 이루어질 수 있다고 회사는 밝혔다.',
  '판매가 늘었다고 회사는 밝혔다.',
]


def _scan():
  import verify_translationese   # scripts/ 가 sys.path 에 있어야 한다(lib 시험·요약기 둘 다 그렇다)
  return verify_translationese


def translationese_problems(text: str) -> list[str]:
  vt = _scan()
  hits = vt.scan(text or '')
  out = [f'번역투: {name} — {frag}' for name, frag, _ in hits]
  double = any(name == '이중 피동' for name, _, _ in hits)
  for name, pat in EXTRA_RULES:
    if double and name in ('되어진', '되어졌'):
      continue
    for m in re.finditer(pat, text or ''):
      out.append(f'번역투: {name} — {_frag(text, m.start(), m.end())}')
  return list(dict.fromkeys(out))


# ---------------------------------------------------------------- 공통 줄 검사
def _line_problems(lines: list, source_text: str, src: _Source) -> list[str]:
  out = []
  blank = sum(1 for line in lines if not line.strip())
  if blank:
    out.append(f'빈 줄 {blank}개(내용 없는 줄은 빼고 {sp.LINE_MIN}~{sp.LINE_MAX}줄을 채울 것)')
  valid = len(lines) - blank
  if not sp.LINE_MIN <= valid <= sp.LINE_MAX:
    out.append(f'줄 수 {valid}개({sp.LINE_MIN}~{sp.LINE_MAX}줄이어야 한다)')
  for i, line in enumerate(lines, 1):
    if len(line) > sp.LINE_CHARS:
      out.append(f'글자 상한: {i}줄째 {len(line)}자({sp.LINE_CHARS}자 이내)')
    out += [f'숫자 원문 없음: {i}줄째 「{f}」' for f in _unmatched(line, src)]
    out += currency_problems(line, source_text)
  out += translationese_problems('\n'.join(lines))
  return out


# ---------------------------------------------------------------- 문서
def check_doc(result: dict, source_text: str, is_pdf: bool, page_count: int) -> tuple[dict, list[str]]:
  """(고친 결과, 지적 목록). 지적이 있으면 재요청 대상. 고침(지적 아님)은 결과에 반영하고 check_note 에 남긴다."""
  r = {**result,
       'lines': [str(x).strip() for x in result.get('lines') or []],
       'evidence': [dict(e) for e in result.get('evidence') or []],
       'pages': [dict(p) for p in result.get('pages') or []],
       'c_materials': [dict(c) for c in result.get('c_materials') or []]}
  src = _Source(source_text)
  notes = []
  problems = _line_problems(r['lines'], source_text, src)

  if not is_pdf and r['pages']:
    problems.append(f'PDF 가 아닌데 쪽 캡처 {len(r["pages"])}개(pages 는 빈 배열이어야 한다)')
  if is_pdf:
    if len(r['pages']) > sp.MAX_PAGES:
      problems.append(f'쪽 캡처 {len(r["pages"])}개(최대 {sp.MAX_PAGES}개)')
    for p in r['pages']:
      if not 1 <= int(p.get('page') or 0) <= page_count:
        problems.append(f'쪽 번호 {p.get("page")} 이 범위 밖(1~{page_count})')

  whole = _norm(source_text)
  segments = _page_segments(source_text) if is_pdf else []
  grounded = 0
  for e in r['evidence']:
    q = _norm(e.get('quote') or '')
    if not q or q not in whole:
      problems.append(f'근거 인용이 원문에 없다(그대로 복사할 것): 「{q[:40]}」')
      continue
    grounded += 1
    if not is_pdf:
      e['page'] = None
      continue
    found = [pg for pg, seg in segments if q in seg]
    if not found:                                       # 쪽 경계([p.N])를 넘는 인용 — 시작 쪽으로(Codex 2026-11-12)
      found = [pg for pg in [_start_page(segments, q)] if pg is not None]
    if found and e.get('page') not in found:
      notes.append(f'근거 쪽 {e.get("page")}→{found[0]}')
      e['page'] = found[0]
    if not 1 <= int(e.get('page') or 0) <= page_count:
      problems.append(f'근거 쪽 번호 {e.get("page")} 이 범위 밖(1~{page_count})')

  if r.get('importance') == 'high' and grounded == 0:
    r['importance'] = 'mid'
    notes.append('중요도 high → mid: 원문에 있는 근거 인용 없음')

  for c in r['c_materials']:
    pg = c.get('page')
    if pg is not None and (not is_pdf or not 1 <= int(pg) <= page_count):
      c['page'] = None

  r['check_note'] = ' · '.join(notes) or None
  return r, problems


# ---------------------------------------------------------------- 뉴스
def check_news(result: dict, items: list[dict]) -> tuple[dict, list[str]]:
  """(고친 결과, 지적 목록). empty=true 면 줄 검사 대신 «줄·링크·관련 기사 수가 모두 비었나»만 본다
  (모순이면 지적 → 재요청 — 안 보면 그 주가 empty 로 굳어 다시 안 집힌다 · Codex 2026-11-12)."""
  r = {**result, 'lines': [str(x).strip() for x in result.get('lines') or []],
       'link_ids': list(dict.fromkeys(int(x) for x in result.get('link_ids') or []))}
  if r.get('empty'):
    filled = sum(1 for line in r['lines'] if line)
    rc = int(r.get('relevant_count') or 0)
    if filled or r['link_ids'] or rc > 0:
      return r, [f'empty 모순: empty=true 인데 요약 줄 {filled}개 · 링크 {len(r["link_ids"])}개 · 관련 기사 {rc}건'
                 '(관련 기사가 없으면 셋 다 비우고, 있으면 empty=false)']
    return r, []
  source_text = '\n'.join(f"{it.get('title') or ''}\n{it.get('summary') or ''}" for it in items)
  problems = _line_problems(r['lines'], source_text, _Source(source_text))
  ids = {int(it['id']) for it in items}
  for x in r['link_ids']:
    if x not in ids:
      problems.append(f'링크 id {x} 가 입력 기사에 없다')
  rc = min(int(r.get('relevant_count') or 0), len(items))
  r['relevant_count'] = rc
  if rc < 1:
    problems.append('empty 가 아닌데 관련 기사 수(relevant_count)가 0')
  elif not min(2, rc) <= len(r['link_ids']) <= 3:
    problems.append(f'대표 링크 수 {len(r["link_ids"])}개({min(2, rc)}~3개 — 관련 기사 {rc}건)')
  return r, problems


# ---------------------------------------------------------------- 지적 갈래(정기 로그용)
# (지적 문구 머리, 갈래 이름) — 위에서부터 첫 일치. 정기 실행 로그엔 이름과 건수만 찍는다(숫자 값·본문 조각·근거 인용 없음).
_KINDS = (
  ('숫자', '숫자'), ('통화', '통화'), ('번역투', '번역투'), ('빈 줄', '빈 줄'), ('줄 수', '줄 수'), ('글자', '글자'),
  ('근거', '근거'), ('쪽', '쪽'), ('PDF', '쪽'), ('링크', '링크'), ('대표 링크', '링크'), ('empty 모순', 'empty 모순'),
  ('empty 가 아닌데', '관련 기사 수'),
)


def problem_kinds(problems: list[str]) -> str:
  """지적 목록 → 「숫자 2 · 통화 1」(처음 나온 순서). 표에 없는 문구는 「기타」."""
  counts: dict[str, int] = {}
  for p in problems:
    name = next((nm for head, nm in _KINDS if p.startswith(head)), '기타')
    counts[name] = counts.get(name, 0) + 1
  return ' · '.join(f'{k} {v}' for k, v in counts.items())


# ---------------------------------------------------------------- 자가 시험
def self_test() -> list[str]:
  """검사기가 살아 있는지 — 실패 목록(빈 목록이면 통과). 요약기 main 이 DB 접속 전에 돈다(실패 exit 2)."""
  fails = []
  src = 'Revenue was $4,213 million in Q3 2026. Margin was 4% to 5%. [p.7]'
  if unmatched_numbers('3분기 매출은 42.1억 달러였다.', src):
    fails.append('반올림한 맞는 숫자를 막았다')
  for bad in ('3분기 매출은 45억 달러였다.', '4분기 매출은 42.1억 달러였다.', '이익률은 7%였다.'):
    if not unmatched_numbers(bad, src):
      fails.append(f'틀린 숫자를 통과시켰다: {bad}')
  if not currency_problems('매출은 42.1억 유로였다.', src):
    fails.append('통화 불일치를 통과시켰다')
  # Codex 1회차 검토(2026-11-12) 대표 반례 — 단위 배수 지우기 · bp↔%p · 금액을 연도로 · 원가의 원
  for bad, s in (('매출은 4,213달러였다.', src), ('이익률은 50%p 올랐다.', 'Margin increased 50 bps.'),
                 ('2027년 매출은 20.3억 달러다.', 'FY2026 revenue was $2,027 million.'),
                 ('1~4분기 매출은 100억 달러였다.', 'Q3 YTD revenue was $10 billion.')):
    if not unmatched_numbers(bad, s):
      fails.append(f'틀린 숫자를 통과시켰다: {bad}')
  if not currency_problems('매출은 42.1억 원이었다.', 'Revenue was $4,213 million. 원가를 설명했다.'):
    fails.append('원가의 「원」을 원화 근거로 봤다')
  for want, sample in EXTRA_MUST_HIT:
    if not any(p.startswith(f'번역투: {want}') for p in translationese_problems(sample)):
      fails.append(f'번역투 안 걸림 [{want}] {sample}')
  for sample in EXTRA_MUST_MISS:
    if translationese_problems(sample):
      fails.append(f'번역투 오탐: {sample}')
  return fails
