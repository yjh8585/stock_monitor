"""보고서 본문의 외화 금액에 원화 환산이 병기됐는지 검사한다 (report.md §3-B).

사용자 지시(2026-09-15): "모든 보고서에서 원화 아닌 통화로 수치가 나오면 괄호하고
원화로 환산해서 써줘" + "보고서 작성시점의 환율 그냥 집어넣어. 복잡하게 만들지 마".

  python scripts/verify_report_krw.py --run <원고.md>
  python scripts/verify_report_krw.py --post 137
  python scripts/verify_report_krw.py --all-posts     # 전수 감사(참고용)

EXIT 0 = 위반 없음 / 1 = 위반 있음 / 2 = 자가 시험 실패(검사기가 죽었다).

🔴 **새로 쓰는 글에만 적용한다.** 기존 글은 소급하지 않기로 했으므로(사용자 결정
   2026-09-15) `--all-posts` 의 위반 건수는 게이트가 아니라 참고 수치다.
🔴 이 검사기는 «원화가 병기됐는가»만 본다. 환율이 맞는지는 기계가 모른다 —
   적용 환율 각주는 사람이 확인한다(report.md §3-B 체크리스트).
"""
import argparse
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent))

# 외화 금액 — 숫자 + (선택)단위 + 통화.
# 🔴 통화명 뒤는 «막지 않는다» — 한국어는 조사가 붙는다("45.84억 달러다", "106억
#    유로를"). 처음에 `(?![가-힣])` 로 막았다가 자가 시험이 세 건을 잡았다.
# 🔴 대신 위험한 낱말만 개별로 막는다: 「유로존」(유로), 「엔진·엔지니어」(엔).
#    「엔」은 한 글자라 조사로는 못 가르므로 **앞에 단위(억·만·조·천)를 요구**한다
#    — "1,200억 엔"은 걸리고 "V8 엔진"은 앞에 단위가 없어 안 걸린다.
_KO_CUR = r"(?:달러|유로(?!존)|위안|파운드)(?:화|당|짜리)?"
_NUM = r"\d[\d,]*(?:\.\d+)?"

PATTERNS: list[re.Pattern[str]] = [
    # 123억 달러 / 4.57억 달러 / 1,500만 유로 / 30 억 유로
    re.compile(rf"{_NUM}\s*(?:억|만|조|천)?\s*{_KO_CUR}"),
    # 1,200억 엔 — 엔만 단위를 필수로 요구한다
    re.compile(rf"{_NUM}\s*(?:억|만|조|천)\s*엔"),
    # $1.5 / €90,969 / £12 / ¥300
    re.compile(rf"[$€£¥]\s?{_NUM}"),
    # 45.84 USD / 3,128 EUR
    re.compile(rf"{_NUM}\s*(?:USD|EUR|JPY|CNY|GBP|HKD)\b"),
]

# 원화 환산으로 인정하는 표기
KRW_MARK = re.compile(r"(?:조원|억원|만원|조 원|억 원)")

FORWARD = 80   # 매치 뒤 이만큼 안에 원화가 있으면 병기된 것으로 본다
BACKWARD = 40  # 앞에 있어도 인정(같은 괄호 안의 원문 병기값 등)

# --- 자가 시험 ---------------------------------------------------------
# 🔴 「위반 0건」과 「매칭이 죽었다」는 화면에서 똑같아 보인다. 양방향으로 시험한다.
MUST_HIT = [
    "전사 매출은 45.84억 달러다.",
    "총투자 약 4.3억 위안 규모의 신공장 착공",
    "멕시코 몬테레이에 2억 달러 규모 첨단 기술 센터",
    "약 106억 유로를 연구개발에 투입",
    "매출 234.92억 유로(2025년 12월 31일 결산)",
    "인수가는 $1.5 로 알려졌다",
    "부문 매출 7,035 EUR 수준",
    "지난해 3,000만 달러를 투자했다",
    "1,200억 엔 규모의 증설",
    "1,200억 엔을 투입했다",
    "수출액은 50억 달러화 기준이다",
    "계약 규모는 3억 유로로 알려졌다",
]
MUST_MISS = [
    "전사 매출은 45.84억 달러(약 6.51조원)다.",
    "총투자 약 4.3억 위안(약 881억원) 규모의 신공장 착공",
    "자본금 1억 위안(약 186억원 · 원문 병기 약 21.19억 엔)",
    "V8 엔진을 얹은 모델",
    "4기통 2.0 엔진을 단종했다",
    "소프트웨어 엔지니어링을 맡는다",
    "유로존 물가가 둔화됐다",
    "2025년 평균환율 1,419.84원/달러 적용",
    "유로존 경기가 둔화됐다",
    "매출 3,128 로 집계됐다",
    "임직원 412,800명",
    "위안부 문제와는 무관하다",
]


def find_violations(text: str) -> list[tuple[int, str, str]]:
    """(줄번호, 매치된 외화 표기, 그 줄) 목록을 돌려준다."""
    out: list[tuple[int, str, str]] = []
    seen: set[tuple[int, int]] = set()
    for lineno, line in enumerate(text.splitlines(), 1):
        for pat in PATTERNS:
            for m in pat.finditer(line):
                if (lineno, m.start()) in seen:
                    continue
                seen.add((lineno, m.start()))
                after = line[m.end(): m.end() + FORWARD]
                before = line[max(0, m.start() - BACKWARD): m.start()]
                if KRW_MARK.search(after) or KRW_MARK.search(before):
                    continue
                out.append((lineno, m.group(0).strip(), line.strip()[:160]))
    return out


def self_test() -> bool:
    ok = True
    for s in MUST_HIT:
        if not find_violations(s):
            print(f"[자가시험 실패] 잡혔어야 하는데 놓쳤다: {s}")
            ok = False
    for s in MUST_MISS:
        v = find_violations(s)
        if v:
            print(f"[자가시험 실패] 잡히면 안 되는데 잡았다: {s}  <- {v[0][1]!r}")
            ok = False
    return ok


def _report(label: str, text: str) -> int:
    violations = find_violations(text)
    if not violations:
        print(f"  OK  {label} — 외화 수치 전부 원화 병기됨")
        return 0
    print(f"  위반 {len(violations)}건 — {label}")
    for lineno, hit, line in violations:
        print(f"    L{lineno}  [{hit}]  {line}")
    return len(violations)


def main() -> int:
    ap = argparse.ArgumentParser(description="보고서 외화 수치의 원화 환산 병기 검사")
    ap.add_argument("--run", type=Path, help="검사할 원고 파일(.md)")
    ap.add_argument("--post", type=int, help="검사할 posts.id")
    ap.add_argument("--all-posts", action="store_true", help="게시된 글 전수 감사")
    args = ap.parse_args()

    if not self_test():
        print("[FAIL] 자가 시험이 깨졌다 — 정규식을 고치기 전에는 결과를 믿지 말 것")
        return 2

    if not (args.run or args.post or args.all_posts):
        ap.error("--run / --post / --all-posts 중 하나가 필요하다")

    total = 0
    if args.run:
        total += _report(args.run.name, args.run.read_text(encoding="utf-8"))

    if args.post or args.all_posts:
        from lib.bootstrap import init_script
        from lib.db import get_client

        init_script(__file__)
        q = get_client().table("posts").select("id,title,content")
        if args.post:
            q = q.eq("id", args.post)
        rows = (q.order("id").execute().data) or []
        bad = 0
        for r in rows:
            n = _report(f"#{r['id']} {(r['title'] or '')[:50]}", r["content"] or "")
            total += n
            bad += 1 if n else 0
        if args.all_posts:
            print(f"\n전수 감사: {len(rows)}편 중 {bad}편에 미병기 외화 수치가 있다")

    if total:
        print(f"\n[FAIL] 미병기 외화 수치 {total}건 — report.md §3-B 참조")
        return 1
    print("\n[OK] 위반 없음")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
