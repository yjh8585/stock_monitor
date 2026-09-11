"""대장의 `deal_key`·`is_latest` 를 다시 계산한다 — **DART 를 다시 긁지 않는다**(네트워크 0회).

🔴 `assign_deals`·`mark_latest` 는 `scan_all.py` 에서 **import 한다.** 여기에 다시 적으면
   두 곳이 갈리고, 다음에 `scan_all` 을 고쳤을 때 이 스크립트가 옛 규칙으로 대장을 되돌린다.

쓰는 법:
    ./scripts/venv/Scripts/python.exe -X utf8 scripts/dart_eval/recompute_deals.py [--write]
    (기본은 미리보기 — `--write` 를 붙여야 대장을 고친다)
"""

import argparse
import io
import json
import sys
from collections import Counter
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent))

from scan_all import LEDGER, assign_deals, mark_latest  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="실제로 대장을 고친다(기본은 미리보기)")
    args = ap.parse_args()

    d = json.loads(io.open(LEDGER, encoding="utf-8").read())
    rows = d["rows"]
    before_latest = sum(1 for r in rows if r.get("is_latest"))
    before_keys = len({r.get("dedup_key") for r in rows})

    assign_deals(rows)
    mark_latest(rows)

    after_latest = sum(1 for r in rows if r.get("is_latest"))
    after_keys = len({r.get("deal_key") for r in rows})

    print(f"대장 {len(rows):,}행")
    print(f"  dedup_key 무리   {before_keys:,}  →  deal_key 무리   {after_keys:,}"
          f"  ({after_keys - before_keys:+,})")
    print(f"  is_latest        {before_latest:,}  →  {after_latest:,}"
          f"  ({after_latest - before_latest:+,})")

    # 딜 하나가 몇 행을 거느리는지 — 정정본이 제대로 붙었는지 눈으로 본다
    sizes = Counter(Counter(r["deal_key"] for r in rows).values())
    print("  딜당 행 수 분포:", dict(sorted(sizes.items())))

    if not args.write:
        print("\n(미리보기 — 아무것도 쓰지 않았다. 고치려면 --write)")
        return 0

    d["total"] = len(rows)
    io.open(LEDGER, "w", encoding="utf-8", newline="\n").write(
        json.dumps(d, ensure_ascii=False, indent=1))
    print(f"\n저장: {LEDGER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
