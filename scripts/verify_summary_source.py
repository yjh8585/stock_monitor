"""국내 상장사 회사설명(business_summary)이 fnguide 정본인지 검사한다.

회사 설명에는 **정본이 둘** 있다 — 국내 상장사는 fnguide 기업개요(`collect_kr_snapshot.py`),
그 밖(해외·비상장)은 LLM 보강이다. 이 경계를 아는 코드가 없어 LLM 보강 스크립트가
fnguide 값을 덮어 왔고, 2026-09-16 전수 조사에서 국내 상장사 180곳 중 fnguide 원문
생존은 **0곳**이었다.

  python scripts/verify_summary_source.py            # 본 검사
  python scripts/verify_summary_source.py --list     # 위반 전체를 줄마다 출력

EXIT 0 = 위반 없음 / 1 = 위반 있음 / 2 = 자가 시험 실패(검사기가 죽었다).

사고 경위 두 갈래:
  ① 2026-07-17 `enrich_description_v2.py` 가 폐지된 구 fnguide 도메인을 보고 있었다.
     폐지 도메인은 404 가 아니라 **HTTP 200 안내 페이지**라 오류 없이 「내용 없음」이
     되어 166곳이 2차 LLM 경로로 샜다(docs/fnguide-wcomp-migration.md).
  ② 2026-08-24 `enrich_company.py` 가 **제품·홈페이지가 비었다는 이유**로 대상에
     넣고 설명까지 새로 써서 덮었다. 대상 판정과 저장 항목을 묶은 것이 원인이다.

🔴 이 검사기는 «fnguide 원문인가»만 본다. 내용이 최신인지는 모른다 — 그것은
   분기 1회 `collect-financials.yml` 의 수집 주기가 결정한다.
"""
import argparse
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.bootstrap import init_script  # noqa: E402

init_script(__file__)

from lib.db import get_client  # noqa: E402

# ──────────────────────────────────────────────────────────────
# 판정
# ──────────────────────────────────────────────────────────────

# fnguide 기업개요는 **예외 없이 「동사」로 시작**한다.
# 2026-09-16 복구 후 국내 상장사 180곳 전수에서 성립했다(평균 450자 · 최소 405자).
FNGUIDE_PREFIX = '동사'

# 정본이 짧을 수는 있어도 LLM 요약(100~250자)과는 분포가 갈린다. 길이는 보조 지표로만
# 출력하고 판정에는 쓰지 않는다 — 접두어 하나로 충분하고, 조건을 늘리면 오탐이 는다.


def is_fnguide_original(text: str | None) -> bool:
  """fnguide 기업개요인가 — 예외 없이 「동사」로 시작한다."""
  return bool(text) and text.lstrip().startswith(FNGUIDE_PREFIX)


# ──────────────────────────────────────────────────────────────
# 자가 시험 — 본 검사 «전에» 돌린다
# ──────────────────────────────────────────────────────────────
#
# 🔴 한국어를 부분 문자열로 맞추는 검사는 조용히 0건이 된다. 「위반 0건」과 「검사가
#    죽었다」는 화면에서 똑같아 보이므로, 실제로 터졌던 문장을 표본으로 박아 둔다.

MUST_HIT = [   # LLM 이 덮었던 실제 값 — 반드시 위반으로 «잡혀야» 한다
  '하이젠 RNM은 로봇 구동모듈, 모빌리티 구동모듈, 서보 시스템, 산업용 모터 사업을 전문으로 하는 기업입니다.',
  '뉴로메카는 협동로봇 중심의 산업용 로봇과 자동화 솔루션을 개발·판매하는 기업으로,',
  '두산로보틱스는 2015년 설립된 협동로봇 전문 제조사로,',
]

MUST_MISS = [  # fnguide 실측 원문 — 위반으로 «잡히면 안 된다»
  '동사는 2007년 설립 후 오티스엘리베이터코리아의 산업용 모터사업부문을 인수하여 시작하고,',
  '동사는 2011년 설립된 로봇 전문기업으로, 2021년 코스닥시장에 기술성장기업으로 상장함.',
  '동사는 1999년 설립된 액츄에이터 기반 휴머노이드 솔루션 전문 기업으로,',
]


def _self_test() -> None:
  """판정 함수가 살아 있는지 양방향으로 확인한다. 어긋나면 본 검사를 돌리지 않는다."""
  for s in MUST_HIT:
    if is_fnguide_original(s):
      print(f'자가 시험 실패 — 위반이어야 할 문장을 통과시켰다: {s[:40]}')
      sys.exit(2)
  for s in MUST_MISS:
    if not is_fnguide_original(s):
      print(f'자가 시험 실패 — 정상 문장을 위반으로 잡았다: {s[:40]}')
      sys.exit(2)


# ──────────────────────────────────────────────────────────────
# 본 검사
# ──────────────────────────────────────────────────────────────

def _fetch_targets() -> list[dict]:
  """국내 상장사(active + KR + market 있음)를 가져온다."""
  rows = (
    get_client()
    .table('companies')
    .select('name_kr,ticker,market,business_summary')
    .eq('status', 'active')
    .eq('country', 'KR')
    .execute()
    .data or []
  )
  return [r for r in rows if r.get('market')]


def main() -> int:
  ap = argparse.ArgumentParser()
  ap.add_argument('--list', action='store_true', help='위반을 줄마다 전부 출력')
  args = ap.parse_args()

  _self_test()

  targets = _fetch_targets()
  if not targets:
    # 🔴 「대상 0건」은 통과가 아니다 — 조회가 깨졌을 때도 위반 0건으로 보인다.
    print('대상 0건 — 국내 상장사를 하나도 못 읽었다. 조회 조건이나 DB 연결을 의심하라.')
    return 2

  violations = [r for r in targets if not is_fnguide_original(r.get('business_summary'))]

  if violations:
    print(f'위반 {len(violations)}건 — 국내 상장사 설명이 fnguide 정본이 아니다:')
    shown = violations if args.list else violations[:20]
    for r in shown:
      bs = (r.get('business_summary') or '').replace('\n', ' ')
      print(f"  {r['name_kr']}({r['ticker']}) {len(bs)}자: {bs[:40]}")
    if len(shown) < len(violations):
      print(f'  … 외 {len(violations) - len(shown)}건 (--list 로 전체 출력)')
    print()
    print('처방: python scripts/collect_kr_snapshot.py 로 fnguide 정본을 다시 받는다.')
    print('      덮은 범인은 enrich_* 계열이다 — lib/companies.py 의 keeps_existing_summary 가 걸러야 한다.')

  print(f'위반 {len(violations)} / 대상 {len(targets)}')
  return 1 if violations else 0


if __name__ == '__main__':
  sys.exit(main())
