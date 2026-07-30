# -*- coding: utf-8 -*-
"""MarkLines 페이지를 GitHub Actions 안에서 받아 artifact 로 남긴다 (2026-07-30 신설).

왜 이 우회가 필요한가
  유효한 로그인 쿠키가 **GitHub Secrets(`MARKLINES_COOKIE`)에만** 있다.
  Secrets 는 write-only 라 값을 꺼낼 수 없고(웹 UI 에서도 안 보인다),
  로컬 추출은 전부 막혔다 — Edge 쿠키 없음 · Chrome 127+ ABE 로 복호화 불가 ·
  Chrome 150 은 **기본 프로필의 원격 디버깅(CDP)을 거부**한다(쿠키 탈취 방지 보안).
  → 쿠키를 꺼내는 대신 **이미 그 쿠키로 성공하고 있는 곳(Actions)에서 받아** 내려온다.

용도: 유럽 공장 입지 보고서(3편)의 "지역별 OEM·부품사 현황" 보강.
  페이지 구조를 모르므로 **1단계는 탐색**이다 — 후보 URL 을 받아 HTML 과 링크 목록을 남기고,
  그것을 보고 2단계(정확한 표 추출)를 정한다.

출력: out/<슬러그>.html · out/_links.tsv(링크 전수) · out/_summary.txt(판정 요약)
종료코드: 1 = 쿠키 만료(로그인 페이지가 돌아왔다) → Secrets 갱신 필요
"""
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUT = Path(__file__).resolve().parent.parent / "out"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

# 탐색 대상 — 어디에 무엇이 있는지 모르므로 넓게 던지고 응답으로 판단한다.
TARGETS = [
    ("production_index", "https://www.marklines.com/en/vehicle_production/index"),
    ("sales_index", "https://www.marklines.com/en/vehicle_sales/index"),
    ("portal_top", "https://www.marklines.com/en/"),
    ("global_index", "https://www.marklines.com/en/global/"),
    ("report_all", "https://www.marklines.com/en/report_all/"),
    ("supplier_top", "https://www.marklines.com/en/supplier/"),
    # 동유럽 국가별 — 슬러그가 맞는지 응답 코드로 확인한다
    ("country_poland", "https://www.marklines.com/en/global/poland"),
    ("country_czech", "https://www.marklines.com/en/global/czech"),
    ("country_slovakia", "https://www.marklines.com/en/global/slovakia"),
    ("country_hungary", "https://www.marklines.com/en/global/hungary"),
    ("country_romania", "https://www.marklines.com/en/global/romania"),
    ("country_serbia", "https://www.marklines.com/en/global/serbia"),
    ("country_turkey", "https://www.marklines.com/en/global/turkey"),
]


def session_cookie():
    ck = os.environ.get("MARKLINES_COOKIE", "").strip()
    if not ck:
        sys.exit("[FAIL] MARKLINES_COOKIE 미설정")
    names = [c.split("=")[0].strip() for c in ck.split(";") if "=" in c]
    print(f"쿠키 {len(names)}개: {', '.join(names[:12])}")
    if "PLATFORM_SESSION" not in names:
        # 로컬 .env.local 이 GA 쿠키만 담고 있어 두 달을 헤맸다 → 먼저 이걸 본다
        print("[WARN] PLATFORM_SESSION 이 없다 — 로그인 세션 쿠키가 아닐 수 있다")
    return ck


def fetch(url, cookie):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Cookie": cookie,
        "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:
        print(f"  [ERR] {type(e).__name__}: {str(e)[:120]}")
        return 0, ""


def main():
    cookie = session_cookie()
    OUT.mkdir(parents=True, exist_ok=True)
    lines, links, logged_in_any = [], [], False

    for slug, url in TARGETS:
        status, body = fetch(url, cookie)
        tables = body.count("<table")
        nums = len(re.findall(r">[0-9]{1,3}(?:,[0-9]{3})+<", body))
        # 로그인 여부는 "표·수치가 실제로 있는가"로 판정한다(응답 200 은 로그인 페이지도 준다)
        rich = tables > 0 or nums > 20
        logged_in_any = logged_in_any or rich
        if body:
            (OUT / f"{slug}.html").write_text(body, encoding="utf-8")
            for m in re.finditer(r'href="([^"#?]+)"', body):
                href = m.group(1)
                if any(k in href.lower() for k in
                       ("global", "country", "region", "supplier", "plant", "report")):
                    links.append(f"{slug}\t{href}")
        msg = (f"{slug:20s} HTTP {status} · {len(body):>8,}자 · <table> {tables:>3} · "
               f"수치 {nums:>5} · {'DATA' if rich else '빈껍데기'}")
        print("  " + msg)
        lines.append(msg)

    (OUT / "_links.tsv").write_text("\n".join(sorted(set(links))), encoding="utf-8")
    (OUT / "_summary.txt").write_text("\n".join(lines), encoding="utf-8")
    print(f"\n저장: {OUT} · 링크 {len(set(links))}건")

    if not logged_in_any:
        print("[FAIL] 어느 페이지에서도 데이터가 없다 → 쿠키가 만료됐다(Secrets 갱신 필요)")
        return 1
    print("[OK] 로그인 상태 확인 — artifact 를 내려받아 분석할 것")
    return 0


if __name__ == "__main__":
    sys.exit(main())
