"""휴머노이드 종목의 증권사 리포트가 «회사와 연결됐는가» 검사 (exit 0 이 정상).

  python scripts/verify_research_company_link.py           # 본 검사
  python scripts/verify_research_company_link.py --fix     # 끊긴 연결을 채운다

EXIT 0 = 위반 없음 / 1 = 위반 있음 / 2 = 자가 시험 실패(검사기가 죽었다).

왜 필요한가 (2026-09-16 실측):
  `collect_naver_research.py` 는 **수집 시점에 휴머노이드 페이지에 있던 종목**만
  `company_id` 로 연결한다(같은 파일 머리말 1번). 그래서 회사를 «나중에» 추가하면
  그 회사의 기존 리포트는 끊긴 채로 남는다.

🔴 **재수집해도 안 고쳐진다.** 같은 수집기의 「함정 1」이 이미 아는 `naver_nid` 를
   건너뛰기 때문이다(아는 행을 다시 쓰면 데이터가 뒤로 가서 그렇게 만들었다).
   즉 **사람이 손대지 않으면 영영 끊겨 있다.**

실제 사고: 고영(098460)을 휴머노이드에 추가했을 때 기존 리포트 3건이 끊겨 있었고,
그중 2건은 **정리본까지 있는 것**이었다. 화면 목록에는 보이므로 눈으로는 안 드러난다.

⚠️ 여기서 보는 것은 **휴머노이드 페이지 종목뿐**이다. `/domestic`·`/parts-top100`
   종목(LG전자·현대위아 등)의 `company_id` 가 비어 있는 것은 **설계대로**이지 결함이
   아니다 — 수집기가 애초에 그 종목들을 연결 대상으로 삼지 않는다.
"""
import argparse
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.bootstrap import init_script  # noqa: E402

init_script(__file__)

from lib.db import WriteSession, get_client  # noqa: E402


# ──────────────────────────────────────────────────────────────
# 판정
# ──────────────────────────────────────────────────────────────

def is_broken_link(report: dict, humanoid_tickers: set[str]) -> bool:
  """이 리포트는 «연결됐어야 하는데 안 된» 것인가.

  세 조건이 모두 참일 때만 위반이다:
    1. 리포트에 ticker 가 있다 (산업 리포트는 ticker 가 없다)
    2. 그 ticker 가 휴머노이드 페이지 종목이다 (자동차 종목은 대상이 아니다)
    3. company_id 가 비어 있다
  """
  ticker = (report.get("ticker") or "").strip()
  if not ticker:
    return False
  if ticker not in humanoid_tickers:
    return False
  return report.get("company_id") is None


# ──────────────────────────────────────────────────────────────
# 자가 시험 — 본 검사 «전에» 돌린다
# ──────────────────────────────────────────────────────────────
#
# 🔴 「위반 0건」과 「검사가 죽었다」는 화면에서 똑같아 보인다. 실제로 터졌던 모양을
#    표본으로 박아 두고, 어긋나면 본 검사를 돌리지 않고 멈춘다.

_TICKERS = {"098460", "108490"}          # 휴머노이드 종목이라 치고

MUST_HIT = [   # 반드시 위반으로 «잡혀야» 한다
  # 2026-09-16 실사고 — 고영을 추가하기 전에 수집된 리포트 3건이 이 모양이었다
  {"ticker": "098460", "company_id": None, "_why": "휴머노이드 종목인데 연결이 비었다"},
]

MUST_MISS = [  # 걸리면 «안» 된다
  {"ticker": "098460", "company_id": "uuid-있음", "_why": "정상 연결"},
  {"ticker": None, "company_id": None, "_why": "산업 리포트 — ticker 자체가 없다"},
  {"ticker": "", "company_id": None, "_why": "빈 ticker"},
  # 🔴 이 칸이 핵심이다. 자동차 종목은 «설계대로» 안 채워지므로 위반이 아니다.
  #    이걸 위반으로 세면 매 실행마다 9건이 빨개져 진짜 결함이 묻힌다.
  {"ticker": "066570", "company_id": None, "_why": "LG전자 — /parts-top100 종목이라 대상 밖"},
]


def self_test() -> bool:
  ok = True
  for row in MUST_HIT:
    if not is_broken_link(row, _TICKERS):
      print(f"  자가 시험 실패(못 잡음): {row['_why']}")
      ok = False
  for row in MUST_MISS:
    if is_broken_link(row, _TICKERS):
      print(f"  자가 시험 실패(오탐): {row['_why']}")
      ok = False
  return ok


# ──────────────────────────────────────────────────────────────
# 조회
# ──────────────────────────────────────────────────────────────

def load_humanoid_tickers(client) -> dict[str, str]:
  """휴머노이드 페이지의 active 상장사 ticker → company_id."""
  rows = (
    client.table("company_pages")
    .select("company_id, companies(id, ticker, status, market)")
    .eq("page", "humanoid")
    .execute()
  ).data or []
  out: dict[str, str] = {}
  for r in rows:
    c = r.get("companies") or {}
    ticker = (c.get("ticker") or "").strip()
    if ticker and c.get("status") == "active" and c.get("market"):
      out[ticker] = c["id"]
  return out


def load_reports(client) -> list[dict]:
  """유효 리포트(제외되지 않은 것) 전량. 페이지네이션은 .order() 필수."""
  out: list[dict] = []
  step = 1000
  start = 0
  while True:
    rows = (
      client.table("research_reports")
      .select("id, ticker, target_name, company_id, published_at, title, excluded_at")
      .is_("excluded_at", "null")
      .order("id")
      .range(start, start + step - 1)
      .execute()
    ).data or []
    out.extend(rows)
    if len(rows) < step:
      return out
    start += step


# ──────────────────────────────────────────────────────────────
# 메인
# ──────────────────────────────────────────────────────────────

def main() -> int:
  ap = argparse.ArgumentParser()
  ap.add_argument("--fix", action="store_true", help="끊긴 연결을 채운다")
  args = ap.parse_args()

  print("자가 시험…")
  if not self_test():
    print("🔴 검사기 자신이 고장났다 — 본 검사를 돌리지 않는다.")
    return 2
  print(f"  통과 (잡아야 할 {len(MUST_HIT)}건 · 놓쳐야 할 {len(MUST_MISS)}건)")

  client = get_client()
  tickers = load_humanoid_tickers(client)
  reports = load_reports(client)
  broken = [r for r in reports if is_broken_link(r, set(tickers))]

  if not broken:
    print(f"위반 0 / 유효 리포트 {len(reports)} · 휴머노이드 상장사 {len(tickers)}곳")
    return 0

  print(f"위반 {len(broken)}건 — 휴머노이드 종목인데 리포트가 회사와 안 이어져 있다:")
  for r in broken:
    print(f"  {r.get('target_name')}({r.get('ticker')}) {r.get('published_at')} {(r.get('title') or '')[:40]}")

  if not args.fix:
    print()
    print("처방: python scripts/verify_research_company_link.py --fix")
    print("      재수집으로는 안 고쳐진다 — 수집기가 아는 naver_nid 를 건너뛴다.")
    return 1

  # WriteSession.table() 이 건드린 테이블을 추적해 블록 종료 시 캐시를 무효화한다.
  with WriteSession() as w:
    for r in broken:
      w.table("research_reports").update(
        {"company_id": tickers[r["ticker"]]}
      ).eq("id", r["id"]).execute()
  print(f"{len(broken)}건 연결 완료.")
  return 0


if __name__ == "__main__":
  sys.exit(main())
