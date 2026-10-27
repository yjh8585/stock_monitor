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
            # 바닥까지 내린다 — 고정 4회(16,000px)는 긴 글(39장)의 아래쪽 지연 로딩 이미지를
            # 아예 안 불러 「깨짐」으로 셌다(2026-10-27 id=132 16장 · URL 은 전부 200 이었다).
            for _ in range(60):
                page.mouse.wheel(0, 4000)
                page.wait_for_timeout(700)
                if page.evaluate("innerHeight + scrollY >= document.body.scrollHeight - 2"):
                    break
            # 「아직 받는 중」과 「못 받음」을 가른다 — 둘을 한데 세면 긴 글일수록 깨짐이 부풀었다.
            # 4,000px 씩 건너뛰면 지연 로딩 감지 범위를 지나쳐 아예 요청조차 안 된 그림이 남는다.
            # 이 검사가 묻는 것은 「모든 그림이 받아지나」라 eager 로 돌려 전부 요청시킨다.
            page.evaluate("document.querySelectorAll('img[loading=lazy]').forEach(i => { i.loading = 'eager'; })")
            try:
                page.wait_for_function("[...document.images].every(i => i.complete)", timeout=30000)
            except Exception:
                pass
            art = page.inner_text("article") if page.locator("article").count() else page.inner_text("main")
            raw = art.count("**")
            stat = page.evaluate(
                """(mark) => { const g=[...document.querySelectorAll('img')].filter(i=>(i.currentSrc||i.src).includes(mark));
                    return {t:g.length,p:g.filter(i=>!i.complete).length,
                            b:g.filter(i=>i.complete&&i.naturalWidth===0).length}; }""",
                img_mark,
            )
            ok = http == 200 and raw == 0 and stat["b"] == 0 and stat["p"] == 0 and len(errs) == 0
            all_ok = all_ok and ok
            print(f"[{'OK ' if ok else 'NG '}] id={pid} http={http} raw**={raw} "
                  f"img={stat['t']}/broken={stat['b']}/pending={stat['p']} err={len(errs)}")

        browser.close()
        print("RESULT=" + ("ALL_OK" if all_ok else "HAS_ISSUE"))
        return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
