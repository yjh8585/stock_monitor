#!/usr/bin/env python3
"""뉴스가 «그 회사 기사» 인지 기계로 본다. **exit 0 이 정상이다.**

왜 있나 (2026-09-11 실사고로 신설):
  한국 비상장사는 구글 뉴스 RSS 에 **따옴표 없는 맨 사명** 을 던졌다. 그래서
  ①구글이 사명을 쪼개 검색했고(「광진기계」 → 광진 + 기계) ②사명이 보통명사면
  회사와 무관한 기사가 통째로 들어왔다. 지우기 전 실물로 확인한 것:

    용산 1,793건 = 용산구·용산공원 · 경신 1,571건 = 「지지율 경신」 ·
    대승 719건 = 축구 「대승」 · 세정 690건 = 국세 세정 · 나전 217건 = 나전칠기 ·
    광진기계 58건 = 광진소방서 · 한국캐스팅 57건 = 드라마 캐스팅.

  한국 비상장 뉴스 9,699건 중 **6,787건(70%)** 이 이렇게 들어와 있었다.

  🔴 **왜 여태 안 보였나 — 뉴스는 «틀린 값» 이 아니라 «남의 값» 이라 어떤 검사에도
  안 걸린다.** 건수는 늘기만 하니 지표로는 오히려 건강해 보인다.
  **검사기가 없는 데이터는 아무도 안 본다.** 그래서 이 검사기를 둔다.

무엇을 보나 (대상 = 한국 비상장 **부품사**. 소스가 사명 검색인 유일한 갈래다):
  1. **뉴스가 너무 많다** — 비상장 부품사가 보존기간(60일) 안에 150건을 넘기지 않는다.
     정리 후 실측 최대는 디알액시온 97건이었다. 넘으면 보통명사 오염을 의심한다.
  2. **제목에 사명이 없다** — 25건 이상인데 일치율이 40% 미만이면 남의 기사를 모으고 있다.
     기사가 사명을 줄여 쓰는 정상 사례는 `ALLOWED_LOW_TITLE_MATCH` 에 근거와 함께 적는다.

한계 (일부러 안 하는 것):
  - **동명 타사는 못 가른다.** ㈜세정(자동차 부품) vs 세정그룹(의류)처럼 이름이 같으면
    제목만으로 법인을 가를 방법이 없다. 여기까지가 이 검사기의 사정거리다.
  - 완성차(OEM)는 제외한다 — 르노코리아 724·한국지엠 391 은 정상이다.
  - 한국 상장사(네이버 종목 큐레이션)·해외(yfinance)는 소스가 종목에 붙어 와서
    이 오염 경로가 없다.

사용:
  python scripts/verify_news_relevance.py
  python scripts/verify_news_relevance.py --list   # 허용된 것까지 표본 제목 출력
"""
import argparse
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.bootstrap import init_script  # noqa: E402

init_script(__file__)

from lib.db import get_client  # noqa: E402

VOLUME_CAP = 150  # 비상장 부품사의 60일 뉴스 상한 (실측 최대 97 = 디알액시온)
TITLE_MIN_N = 25  # 일치율을 따지기 시작하는 표본 크기
TITLE_MIN_RATE = 0.40

# 제목 일치율이 낮아도 «정상» 인 자리. 값 = 왜 정상인가.
# 🔴 근거 없이 추가하지 말 것 — 그러면 이 검사기가 무력해진다.
ALLOWED_LOW_TITLE_MATCH: dict[str, str] = {
  '베바스토코리아': '기사가 「베바스토」로만 쓴다 — 당진 공장 증설 등 전부 이 회사 기사다',
  '르네사스일렉트로닉스한국': '기사가 「르네사스」로만 쓴다',
  '현대케피코': '현대차그룹 협력사 기사에 묶여 나온다 — 본문은 이 회사를 다룬다',
  '삼보에이앤티': 'UAM 협약 기사가 진짜다(36%). 나머지도 본문에 사명이 있다',
}


def main() -> None:
  ap = argparse.ArgumentParser()
  ap.add_argument('--list', action='store_true', help='허용된 것까지 표본 제목 출력')
  args = ap.parse_args()

  db = get_client()
  comps = (
    db.table('companies')
    .select('id,name_kr,ticker,market,country,status,company_type')
    .eq('status', 'active')
    .eq('country', 'KR')
    .execute()
    .data
    or []
  )
  targets = {
    c['id']: c['name_kr']
    for c in comps
    if (not c.get('market') or not c.get('ticker')) and c.get('company_type') != 'OEM'
  }

  titles: dict[str, list[str]] = {}
  offset = 0
  while True:
    batch = (
      db.table('news').select('company_id,title').order('id').range(offset, offset + 999).execute().data
    )
    if not batch:
      break
    for r in batch:
      name = targets.get(r['company_id'])
      if name:
        titles.setdefault(name, []).append(r.get('title') or '')
    if len(batch) < 1000:
      break
    offset += 1000

  violations: list[str] = []
  allowed: list[str] = []
  hit_allow: set[str] = set()
  for name, ts in sorted(titles.items(), key=lambda x: -len(x[1])):
    n = len(ts)
    rate = sum(1 for t in ts if name in t) / n
    if n > VOLUME_CAP:
      violations.append(f'[건수] {name} — 뉴스 {n}건 (상한 {VOLUME_CAP}). 보통명사 오염을 의심할 것')
    if n >= TITLE_MIN_N and rate < TITLE_MIN_RATE:
      line = f'{name} — {n}건 중 제목에 사명이 있는 것 {rate * 100:.0f}%'
      why = ALLOWED_LOW_TITLE_MATCH.get(name)
      if why:
        allowed.append(f'  (확인됨) {line} — {why}')
        hit_allow.add(name)
      else:
        violations.append(f'[제목] {line}. 남의 기사를 모으고 있지 않은지 볼 것')
    if args.list and (n > VOLUME_CAP or (n >= TITLE_MIN_N and rate < TITLE_MIN_RATE)):
      for t in ts[:3]:
        print(f'    · {name}: {t[:90]}')

  if args.list:
    print(f'\n확인된 «낮은 제목 일치율» {len(allowed)}건')
    for a in allowed:
      print(a)
    print()

  # 🔴 검사기 자신을 먼저 의심한다 — 안 걸리는 허용목록은 「대상을 놓쳤다」는 신호다.
  #    (회사가 hidden 이 됐거나, 뉴스가 다 빠졌거나, 대상 판정이 바뀌었을 수 있다.)
  dead = sorted(set(ALLOWED_LOW_TITLE_MATCH) - hit_allow)
  if dead:
    print(f'⚠ 허용목록에 있는데 조건에 안 걸린다: {dead}')
    print('  더 이상 필요 없어졌으면 지우고, 대상에서 빠진 것이면 그 이유를 확인할 것.\n')

  total = sum(len(t) for t in titles.values())
  if violations:
    print(f'위반 {len(violations)}건')
    for v in violations:
      print(f'  {v}')
    print('\n수집기(`collect_news.py`)의 질의 형태와 제목 필터가 회귀했는지 먼저 볼 것.')
    print('경위 = `docs/gotchas-data-collection.md` 「사명이 보통명사면 뉴스가 통째로 오염된다」')
    sys.exit(1)

  print(
    f'위반 0건 (한국 비상장 부품사 {len(targets)}곳 · 뉴스 보유 {len(titles)}곳 · '
    f'{total}건 전수 확인 · 확인된 낮은 일치율 {len(allowed)}건은 허용목록)'
  )


if __name__ == '__main__':
  main()
