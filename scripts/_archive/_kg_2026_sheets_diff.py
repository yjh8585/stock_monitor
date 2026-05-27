"""ad-hoc: 2026 엑셀의 과거연도 시트(2021~2025) vs 기존 DB 데이터(년도별 엑셀 backfill 결과) 비교.

목적: 사용자가 "2026 엑셀에 과거 시트 다 있다 — 단일 파일로 충분" 제안 +
"과거 시트 데이터와 과거연도 엑셀 데이터가 다른지" 확인.
"""

import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.bootstrap import init_script

init_script(__file__)

# noqa: E402 — bootstrap 이후 import
from lib.db import get_client  # noqa: E402
from collect_kg_mobility_sales import parse_excel  # noqa: E402

WB_PATH = Path("data/_kg_downloads/2026_2026년 판매실적.xlsx")
TARGET_YEARS = list(range(2021, 2027))

print(f"\n=== 2026 엑셀 시트 파싱 ({WB_PATH.name}) ===")
new_rows = []
for year in TARGET_YEARS:
    try:
        rows = parse_excel(WB_PATH, year)
        print(f"  {year}: {len(rows)}행")
        new_rows.extend(rows)
    except Exception as e:
        print(f"  {year}: 파싱 실패 — {e}")

new_totals = defaultdict(int)
for r in new_rows:
    key = (r["year_period"], r["region"], r["vehicle_model"])
    new_totals[key] += r["sales_units"]

print(f"\n=== DB 데이터 fetch ===")
client = get_client()
db_rows = []
from_ = 0
while True:
    resp = (
        client.from_("kg_mobility_sales")
        .select("year_period,region,vehicle_model,sales_units")
        .range(from_, from_ + 999)
        .execute()
    )
    if not resp.data:
        break
    db_rows.extend(resp.data)
    if len(resp.data) < 1000:
        break
    from_ += 1000
print(f"  DB: {len(db_rows)}행")

db_totals = defaultdict(int)
for r in db_rows:
    key = (r["year_period"], r["region"], r["vehicle_model"])
    db_totals[key] += r["sales_units"]

print(f"\n=== Diff (new vs db) ===")
all_keys = set(new_totals) | set(db_totals)
diffs_present = []
diffs_only_new = []
diffs_only_db = []
for k in sorted(all_keys):
    n, d = new_totals.get(k, 0), db_totals.get(k, 0)
    if n != d:
        if d == 0:
            diffs_only_new.append((k, n))
        elif n == 0:
            diffs_only_db.append((k, d))
        else:
            diffs_present.append((k, n, d))

print(f"  값 다름: {len(diffs_present)}건")
for k, n, d in diffs_present[:30]:
    print(f"    {k}: new={n:>7,}  db={d:>7,}  delta={n - d:+,}")
if len(diffs_present) > 30:
    print(f"    ... {len(diffs_present) - 30}건 더")

print(f"\n  new에만 있음(DB는 0): {len(diffs_only_new)}건")
for k, n in diffs_only_new[:15]:
    print(f"    {k}: new={n:>7,}")

print(f"\n  db에만 있음(new는 0): {len(diffs_only_db)}건")
for k, d in diffs_only_db[:15]:
    print(f"    {k}: db={d:>7,}")

print(f"\n=== 합계 비교 ===")
print(f"  new total: {sum(new_totals.values()):,}")
print(f"  db  total: {sum(db_totals.values()):,}")
print(f"  delta:     {sum(new_totals.values()) - sum(db_totals.values()):+,}")
