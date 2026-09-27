# -*- coding: utf-8 -*-
"""회수한 계약서 쪽 그림을 **콕 집어 다시 받는다**(그리고 다 쓰면 다시 회수한다).

## 왜 있나 — 약속만 있고 코드가 없었다

`agents/scripts/ma-contract-reap.py` 가 판독을 마친 폴더의 쪽 그림을 일부러 지운다
(2026-09-10 디스크 2.3GB 사고). 폴더째 지우지 않는 이유를 그 스크립트가 이렇게 적었다 —
「`_meta.json` 에 쪽마다 원본 주소(`src_url`)가 들어 있어 그 폴더만 콕 집어 다시 받을 수 있다」.

🔴 **그런데 되받는 코드가 없었다.** 「다시 받을 수 있다」는 문장만 네 곳에 있었다
(`ma-contract-reap.py` · `ma-contract-order.py` 두 곳 · `agents/docs/ma-workflow.md`).
2026-09-27 에 문언 대장이 저본 **27 공시분**을 못 열어 막혔고 그제서야 드러났다.
「사람이 이어서 돌려야 하는 단계는 반드시 잊힌다」가 **스크립트 사이에서도** 일어난 것이다.

## 왜 여기(stock_monitor)에 있나

내려받기 관례의 정본이 여기다 — `fetch_contracts.py` 의 UA·Referer·**요청 간격 2초**·
차단 대기 30분(README 「반드시 지킬 것」 2). agents 에 두면 그 관례가 두 벌이 되어 갈린다.
그래서 **무엇이 필요한가는 agents 가, 어떻게 받는가는 여기가** 안다.

    (agents)        python -X utf8 scripts/ma-clause-text-todo.py --restore-plan plan.json
    (stock_monitor) ... restore_contract_pages.py --plan plan.json
    ... 판독이 끝나면
    (stock_monitor) ... restore_contract_pages.py --reclaim <명세.json>

⚠️ 첨부를 **다시 열지 않는다** — `_meta.json` 에 적힌 쪽 주소를 그대로 쓴다. 그래서
README 「반드시 지킬 것」 1(정정공시는 원공시 rcpNo 로 연다)에 걸릴 일이 없다.

## 🔴 회수는 reap 이 아니라 이 스크립트가 한다

`ma-contract-reap.py` 는 판독 JSON 의 **`folder` 칸**을 보고 지우는데, 문언 대장
(`agents/docs/data/ma-clause-texts.json`)의 행에는 그 칸이 없다(`file`·`rcp` 뿐).
그대로 돌리면 「`folder` 칸이 없어 건너뛴 항목 N개」를 찍고 **한 장도 안 지운다**(2026-09-27 확인).
그래서 이 스크립트가 **자기가 받은 파일만** 명세에 적고 그것만 지운다 —
원래 있던 그림은 어떤 경우에도 건드리지 않는다.

실행:
    ./scripts/venv/Scripts/python.exe -X utf8 -u \
        scripts/dart_eval/restore_contract_pages.py --plan plan.json --dry-run
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

# 🔴 내려받기 관례는 `fetch_contracts` 가 정본이다 — 여기서 다시 적지 않는다.
#    (세션 헤더 · GAP 2초 · 차단 시 30분 대기 · env 로드 `init_script`)
sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_contracts as fc  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MANIFEST_DIR = fc.OUT_DIR / "_restored"


def page_on_disk(folder: Path, n: int) -> Path | None:
    """🔴 확장자가 둘이다 — `.jpeg` 폴더가 실재한다(사람인)."""
    for ext in ("jpg", "jpeg", "png"):
        p = folder / f"page_{n:02d}.{ext}"
        if p.exists():
            return p
    return None


def meta_index(folder: Path) -> dict[int, dict]:
    """`_meta.json` 의 쪽 목록을 번호로 색인한다. 없으면 빈 것."""
    mp = folder / "_meta.json"
    if not mp.exists():
        return {}
    out: dict[int, dict] = {}
    for pg in json.loads(mp.read_text(encoding="utf-8")).get("pages", []):
        stem = Path(pg.get("file") or "").stem
        try:
            out[int(stem.split("_")[-1])] = pg
        except ValueError:
            continue
    return out


def restore(plan_path: Path, dry: bool, limit: int) -> int:
    doc = json.loads(plan_path.read_text(encoding="utf-8"))
    items = doc.get("items") or []
    if limit:
        items = items[:limit]

    got: list[dict] = []          # 이번에 «내가» 받은 것만 — 회수 대상이다
    skipped_have = no_route = failed = mismatch = 0
    want_pages = sum(len(i.get("pages") or []) for i in items)
    print(f"■ 주문서 {plan_path.name} — 공시 {len(items)}건 · 쪽 {want_pages}장"
          f"{' (연습)' if dry else ''}", flush=True)

    for it in items:
        folder = fc.OUT_DIR / it["folder"]
        if not folder.exists():
            print(f"  [X] 폴더 없음 {it['folder']} — 되받기로 풀리는 갈래가 아니다")
            no_route += len(it.get("pages") or [])
            continue
        idx = meta_index(folder)
        n_got = 0
        for n in it.get("pages") or []:
            if page_on_disk(folder, n):
                skipped_have += 1
                continue
            pg = idx.get(n)
            if not pg or not pg.get("src_url"):
                # ⚠️ 대장이 가리킨 쪽이 이 문서에 «없다» — 다른 첨부(엑셀·한글)를 가리키는 것이다.
                #    받을 길이 없으니 조용히 넘기지 말고 세어서 보고한다.
                print(f"  [!] {it['folder']} page_{n:02d} — `_meta.json` 에 없다(다른 첨부 추정)")
                no_route += 1
                continue
            name = pg.get("file") or f"page_{n:02d}.jpg"
            if dry:
                got.append({"folder": it["folder"], "file": name,
                            "bytes_expected": pg.get("bytes")})
                n_got += 1
                continue
            blob = fc.get_bytes(pg["src_url"])
            if not blob:
                print(f"  [X] 실패 {it['folder']}/{name}")
                failed += 1
                continue
            exp = pg.get("bytes")
            if exp and len(blob) != exp:
                # 🔴 원본이 바뀌었다는 뜻이다(정정 공시 등). 받되 표시한다 —
                #    「같은 쪽을 받았다」고 단정하면 옛 판독과 어긋난 채 섞인다.
                print(f"  [!] 크기 다름 {it['folder']}/{name}: 기록 {exp} ≠ 받은 {len(blob)}")
                mismatch += 1
            (folder / name).write_bytes(blob)
            got.append({"folder": it["folder"], "file": name, "bytes": len(blob),
                        "bytes_expected": exp})
            n_got += 1
        print(f"  {(it.get('corp') or it['rcp'])[:18]:18s} {it['folder'][:38]:38s} "
              f"{n_got}/{len(it.get('pages') or [])}장", flush=True)

    print(f"\n받음 {len(got)} · 이미 있어 건너뜀 {skipped_have} · 받을 길 없음 {no_route}"
          f" · 실패 {failed} · 크기 다름 {mismatch}")
    if dry:
        print("연습이라 아무것도 안 받았다. --dry-run 을 빼고 다시 실행할 것.")
        return 0
    if not got:
        print("받은 것이 없어 명세를 남기지 않는다.")
        return 0

    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    mf = MANIFEST_DIR / f"{date.today().isoformat()}-{plan_path.stem}.json"
    # 🔴 같은 날 두 번 돌리면 덮어쓰지 말고 «합친다» — 덮으면 앞서 받은 것이 회수 밖에 남는다.
    old = json.loads(mf.read_text(encoding="utf-8")).get("files", []) if mf.exists() else []
    seen = {(f["folder"], f["file"]) for f in old}
    merged = old + [f for f in got if (f["folder"], f["file"]) not in seen]
    mf.write_text(json.dumps({"restored_at": date.today().isoformat(),
                              "plan": str(plan_path), "files": merged},
                             ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    print(f"명세: {mf}  ← 판독이 끝나면 `--reclaim` 에 이 파일을 준다")
    return 0


def reclaim(manifest_path: Path, dry: bool) -> int:
    """명세에 적힌 **그 파일만** 지운다. 🔴 명세 밖의 그림은 절대 건드리지 않는다."""
    doc = json.loads(manifest_path.read_text(encoding="utf-8"))
    files = doc.get("files") or []
    removed = gone = kept = freed = 0
    for f in files:
        p = fc.OUT_DIR / f["folder"] / f["file"]
        if not p.exists():
            gone += 1
            continue
        size = p.stat().st_size
        exp = f.get("bytes")
        if exp and size != exp:
            # 그 사이 누가 다시 받았거나 바뀐 것이다 — 내 것이라 단정할 수 없으니 남긴다.
            print(f"  [!] 크기가 달라 남긴다 {f['folder']}/{f['file']}: {size} ≠ {exp}")
            kept += 1
            continue
        if not dry:
            p.unlink()
        removed += 1
        freed += size
    print(f"■ 회수{' (연습)' if dry else ''} — 지움 {removed} · 이미 없음 {gone} · 남김 {kept}"
          f" · 돌려받은 용량 {freed / 1e6:.1f}MB")
    if not dry and removed:
        done = manifest_path.with_suffix(".reclaimed.json")
        manifest_path.rename(done)
        print(f"명세를 {done.name} 로 옮겼다 — 두 번 돌려도 안전하다")
    return 0


def selftest() -> None:
    """🔴 양방향. 「받을 게 없다」와 「고르개가 죽었다」는 화면에서 똑같아 보인다."""
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        d = Path(td)
        (d / "page_05.jpg").write_bytes(b"x")
        if page_on_disk(d, 5) is None:
            print("[X] 자기시험 — 있는 쪽을 못 봤다")
            raise SystemExit(2)
        if page_on_disk(d, 6) is not None:
            print("[X] 자기시험 — 없는 쪽을 있다고 했다")
            raise SystemExit(2)
        # `_meta.json` 색인 — 쪽 번호는 파일명 «끝 숫자»에서 온다
        (d / "_meta.json").write_text(json.dumps(
            {"pages": [{"file": "page_07.jpg", "src_url": "http://x", "bytes": 3}]},
            ensure_ascii=False), encoding="utf-8")
        idx = meta_index(d)
        if 7 not in idx or idx[7]["bytes"] != 3:
            print(f"[X] 자기시험 — 메타 색인: {idx}")
            raise SystemExit(2)
        if meta_index(d / "없는폴더"):
            print("[X] 자기시험 — 없는 메타를 채워 냈다")
            raise SystemExit(2)


def main() -> int:
    selftest()
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", help="agents 의 `--restore-plan` 이 낸 주문서 JSON")
    ap.add_argument("--reclaim", help="받은 뒤 남긴 명세 JSON — 그 파일만 지운다")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="주문서 앞에서 N건만")
    a = ap.parse_args()
    if bool(a.plan) == bool(a.reclaim):
        print("[X] --plan 과 --reclaim 중 하나를 준다.")
        return 2
    if a.plan:
        return restore(Path(a.plan), a.dry_run, a.limit)
    return reclaim(Path(a.reclaim), a.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
