"""게시된 /reports 글 렌더 검증(프로덕션). raw '**'=0 · 이미지 깨짐 0 · console error 0.

자격증명은 .env.local(MOBILITY_ID/PW) 로드(비노출). 이미지 경로는 batch.json.storage_folder로 필터.
usage: python verify.py --ids 98,99,100,101,102,103
       python verify.py --ids 98,99 --base https://stock-monitor-orcin.vercel.app
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from _common import ROOT, run_path
from dotenv import load_dotenv

load_dotenv(ROOT / ".env.local")
from playwright.sync_api import ConsoleMessage, sync_playwright


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", required=True, help="쉼표구분 posts id")
    ap.add_argument("--base", default="https://stock-monitor-orcin.vercel.app")
    args = ap.parse_args()
    ids = [int(x) for x in args.ids.split(",")]

    batch = json.loads(run_path("batch.json").read_text(encoding="utf-8"))
    img_mark = batch.get("storage_folder", "")
    user, pw = os.environ["MOBILITY_ID"], os.environ["MOBILITY_PW"]

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
        page.goto(f"{args.base}/login", wait_until="networkidle", timeout=30000)
        page.fill('input[name="id"]', user)
        page.fill('input[name="password"]', pw)
        page.click('button[type="submit"]')
        page.wait_for_url(lambda u: "/login" not in u, timeout=30000)
        print("[login] ok")

        errs: list[str] = []
        page.on("console", lambda m: errs.append(m.text[:160]) if m.type == "error" else None)

        all_ok = True
        for pid in ids:
            errs.clear()
            resp = page.goto(f"{args.base}/reports/{pid}", wait_until="networkidle", timeout=30000)
            http = resp.status if resp else None
            for _ in range(4):
                page.mouse.wheel(0, 4000)
                page.wait_for_timeout(1000)
            art = page.inner_text("article") if page.locator("article").count() else page.inner_text("main")
            raw = art.count("**")
            stat = page.evaluate(
                """(mark) => { const g=[...document.querySelectorAll('img')].filter(i=>(i.currentSrc||i.src).includes(mark));
                    return {t:g.length,b:g.filter(i=>!i.complete||i.naturalWidth===0).length}; }""",
                img_mark,
            )
            ok = http == 200 and raw == 0 and stat["b"] == 0 and len(errs) == 0
            all_ok = all_ok and ok
            print(f"[{'OK ' if ok else 'NG '}] id={pid} http={http} raw**={raw} img={stat['t']}/broken={stat['b']} err={len(errs)}")

        browser.close()
        print("RESULT=" + ("ALL_OK" if all_ok else "HAS_ISSUE"))
        return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
