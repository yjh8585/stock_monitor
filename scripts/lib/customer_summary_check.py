"""고객사 문서·뉴스 요약 검사기 — 모델 출력이 이 검사를 통과해야 status='ok' 로 저장된다(틀린 요약보다 빈칸).

지시서 정본 = lib/customer_summary_prompt.py(여기서 잡는 규칙은 거기에도 같은 말로 적혀 있다).
호출 = scripts/summarize_customer_docs.py · scripts/summarize_customer_news.py — 지적이 있으면 1회 재요청, 그래도 있으면
check_failed 로 남긴다.

숫자 대조(unmatched_numbers) — 요약 숫자마다 원문에 «표시 자릿수 반올림 안»의 짝이 있어야 한다:
- 원문 토큰 = lib/llm_guidance.number_tokens. 🔴 그 함수는 문서 첫 표 머리 배수('in millions')를 단위 없는 모든 수에 씌운다
  → 원문 후보값은 «n×배수» 와 «n(배수 없음)» 둘 다로 보고, 문서 안 «모든» 표 머리 배수(_HEADERS — 「단위 : 십억원」 포함)도
  각각 씌워 본다(국문 IR 은 첫 머리가 「천대」이고 금액 표가 「십억원」 — 2026-11-12 드라이런 실측).
  SHORTCUT: 후보가 넓어진 만큼 틀린 값이 표 어딘가의 수와 우연히 맞아 통과할 수 있다(실측 28쪽 자료에서 「35.0조」 통과)
  → 줄의 지표 낱말과 표 행을 짝짓는 대조로 좁힐 수 있다(지금은 «원문에 그 수가 있다»까지만 본다).
- 🔴 원문의 쪽 표식 [p.N] 은 대조 전에 지운다(요약 7% 가 쪽 표식 7 로 통과했다 — Codex 대조 2026-11-12).
- 요약 수 뒤가 %·%p 면 원문 짝도 %·percent·per cent·pts·ppt·bp 가 붙은 수여야 한다(bp 는 ÷100).
- 요약 「N분기」는 원문의 분기 표기(Q3·3Q·third quarter·3분기·three months ended September)와만 맞춘다 —
  맨 숫자 3 과 맞추면 4% 의 4 가 「4분기」를 통과시킨다. 「1~3분기」는 누적 표기(nine months·YTD·누적)나 두 끝 분기 표기.
- 「N월」은 영어 달 이름이나 같은 수. 2자리 연도(FY26·'25·3Q25)는 20xx 로도 본다. 4자리 연도도 예외 없이 원문에 있어야 한다.
통화(currency_problems) — 요약 줄의 「수+통화 낱말」(달러·유로·원·엔·위안·파운드)이 원문 어딘가에 그 통화로 나와야 한다.
부호(±)는 검사하지 않는다(지시서로만).
번역투(translationese_problems) — verify_translationese.scan + 그 검사기가 안 잡는 표현(EXTRA_RULES). 「를 통해」는 흔해서 뺐다.
"""
import re

from lib import customer_summary_prompt as sp
from lib.llm_guidance import _JOIN, number_tokens

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
  r'|(?:€|\$|£|\bEUR|\bUSD)\s?(million|billion|mn|bn)\b', re.I)
_HEADER_MULT = {'천': 1e3, '만': 1e4, '백만': 1e6, '십억': 1e9, '억': 1e8, '조': 1e12, 'thousand': 1e3, 'million': 1e6,
                'mn': 1e6, 'billion': 1e9, 'bn': 1e9}
_YEAR2_BEFORE = re.compile(r"(?:\bFY|\bCY|['’]|\b[1-4]Q|\bQ[1-4]\s?|\bH[12]\s?)$", re.I)

_ORD = {'first': 1, 'second': 2, 'third': 3, 'fourth': 4, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4}
_Q_PATTERNS = (
  re.compile(r'\bQ\s?([1-4])(?!\d)', re.I),
  re.compile(r'(?<![\d.])([1-4])\s?Q(?![a-z])', re.I),
  re.compile(r'\b(first|second|third|fourth|1st|2nd|3rd|4th)[- ]quarter', re.I),
  re.compile(r'([1-4])\s*분기'),
)
_Q_MONTHS_ENDED = re.compile(r'three[- ]months?\s+ended\s+(March|June|September|December)', re.I)
_QEND = {'march': 1, 'june': 2, 'september': 3, 'december': 4}
# SHORTCUT: 누적 표기는 흔한 꼴만(nine months·YTD·누적·상반기 …) → 다른 꼴이 정상 요약을 막으면 여기에 더한다
_CUMULATIVE = {
  2: re.compile(r'six[- ]months|first[- ]half|\bH1\b|\b6M\b|상반기|1\s*[~～\-–]\s*2\s*분기', re.I),
  3: re.compile(r'nine[- ]months|\b9M\b|1\s*[~～\-–]\s*3\s*분기', re.I),
  4: re.compile(r'twelve[- ]months|full[- ]year|\bFY\b|연간|1\s*[~～\-–]\s*4\s*분기', re.I),
}
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
    self.cands: list[tuple[float, bool]] = []          # (값, % 수인가)
    toks = number_tokens(t)
    pct = [bool(_SRC_PCT.match(t[k.end:k.end + 24])) for k in toks]
    for i in range(len(toks) - 2, -1, -1):              # '3 and 5 per cent' — 앞 수가 뒤 % 를 이어받는다
      if not pct[i] and pct[i + 1] and _JOIN.fullmatch(t[toks[i].end:toks[i + 1].start]):
        pct[i] = True
    heads = {_HEADER_MULT[next(g for g in m.groups() if g).lower()] for m in _HEADERS.finditer(t)}
    for k, p in zip(toks, pct):
      vals = {k.n * k.mult, k.n} | {k.n * h for h in heads}
      if p and _SRC_BP.match(t[k.end:k.end + 24]):
        vals.add(k.n / 100)
      if k.n < 100 and k.n == int(k.n) and _YEAR2_BEFORE.search(t[max(0, k.start - 4):k.start]):
        vals.add(2000 + k.n)
      self.cands.extend((v, p) for v in vals)
    self.quarters = {int(m.group(1)) if m.group(1).isdigit() else _ORD[m.group(1).lower()]
                     for pat in _Q_PATTERNS for m in pat.finditer(t)}
    self.quarters |= {_QEND[m.group(1).lower()] for m in _Q_MONTHS_ENDED.finditer(t)}
    self.months = {_MONTHS[m.group(1).lower()] for m in _MONTH_WORD.finditer(t)}

  def has_value(self, v: float, tol: float, need_pct: bool) -> bool:
    eps = max(abs(v) * 1e-9, 1e-9)
    return any(abs(c - v) <= tol + eps for c, p in self.cands if p or not need_pct)

  def has_cumulative(self, end_q: int) -> bool:
    pat = _CUMULATIVE.get(end_q)
    return bool(_YTD.search(self.text) or (pat and pat.search(self.text)))


# ---------------------------------------------------------------- 요약 쪽 토큰
_SUM_PCT = re.compile(r'\)?\s*(?:%|퍼센트)')
_SUM_QUARTER = re.compile(r'\s*분기')
_SUM_MONTH = re.compile(r'\s*월(?!요일)')


def _decimals(s: str) -> int:
  return len(s.split('.', 1)[1]) if '.' in s else 0


def _frag(text: str, start: int, end: int) -> str:
  return _WS.sub(' ', text[max(0, start - 10):end + 10]).strip()


def _unmatched(summary_text: str, src: _Source) -> list[str]:
  s = summary_text or ''
  toks = number_tokens(s)
  n = len(toks)
  pct = [bool(_SUM_PCT.match(s[k.end:k.end + 4])) for k in toks]
  quarter = [bool(_SUM_QUARTER.match(s[k.end:k.end + 4])) for k in toks]
  joined = [i + 1 < n and bool(_JOIN.fullmatch(s[toks[i].end:toks[i + 1].start])) for i in range(n)]
  for i in range(n - 2, -1, -1):
    if joined[i] and pct[i + 1]:
      pct[i] = True
  out = []
  skip = set()
  for i, k in enumerate(toks):
    if i in skip:
      continue
    raw = s[k.start:k.end]
    if joined[i] and quarter[i + 1]:                    # 「1~3분기」 — 누적 표기 또는 두 끝 분기 표기
      a, b = int(k.n), int(toks[i + 1].n)
      if not (src.has_cumulative(b) or {a, b} <= src.quarters):
        out.append(_frag(s, k.start, toks[i + 1].end))
      skip.add(i + 1)
      continue
    if quarter[i]:
      if int(k.n) not in src.quarters:
        out.append(_frag(s, k.start, k.end))
      continue
    if _SUM_MONTH.match(s[k.end:k.end + 4]) and 1 <= k.n <= 12:
      if int(k.n) not in src.months and not src.has_value(k.n, 0.5, False):
        out.append(_frag(s, k.start, k.end))
      continue
    v = k.n * k.mult
    tol = 0.5 * 10 ** -_decimals(raw) * k.mult
    if not src.has_value(v, tol, pct[i]):
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
  # 국문 기사는 「영업익 2.5조」처럼 원을 생략한다 — 다른 통화 낱말이 붙지 않은 조·억 금액도 원으로 본다
  '원': re.compile(r'₩|\bKRW\b|\bwon\b|원|\d\s*[조억](?!\s*(?:달러|유로|엔|위안|파운드))', re.I),
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
  if not sp.LINE_MIN <= len(lines) <= sp.LINE_MAX:
    out.append(f'줄 수 {len(lines)}개({sp.LINE_MIN}~{sp.LINE_MAX}줄이어야 한다)')
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
    if found and e.get('page') not in found:
      notes.append(f'근거 쪽 {e.get("page")}→{found[0]}')
      e['page'] = found[0]

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
  """(고친 결과, 지적 목록). empty=true 면 줄 검사를 하지 않는다."""
  r = {**result, 'lines': [str(x).strip() for x in result.get('lines') or []],
       'link_ids': list(dict.fromkeys(int(x) for x in result.get('link_ids') or []))}
  if r.get('empty'):
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
  for want, sample in EXTRA_MUST_HIT:
    if not any(p.startswith(f'번역투: {want}') for p in translationese_problems(sample)):
      fails.append(f'번역투 안 걸림 [{want}] {sample}')
  for sample in EXTRA_MUST_MISS:
    if translationese_problems(sample):
      fails.append(f'번역투 오탐: {sample}')
  return fails
