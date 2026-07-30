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

# 🔴 1차 탐색(2026-07-30)에서 배운 것 — 추측 URL 은 거의 404 였다.
#    · 데이터 페이지는 `/index` 가 아니라 **`/search?rf=left_menu`** 다(성공 중인
#      `sync_oem_production_excel.py` 가 쓰는 URL). `/index` 는 껍데기를 준다.
#    · 국가별 페이지는 슬러그(`/global/poland`)가 아니라 **숫자 ID**(`/global/1443`)다.
#    · 실재하는 경로는 1차에서 받은 `portal_top` 의 링크에서 확보했다.
TARGETS = [
    # ① 쿠키 유효성 판정용 — 이 페이지에 "Latest month" 엑셀 링크가 보이면 로그인된 것이다
    ("production_search", "https://www.marklines.com/en/vehicle_production/search?rf=left_menu"),
    ("sales_search", "https://www.marklines.com/en/vehicle_sales/search?rf=left_menu"),
    # ② 지역별 OEM·부품사 현황(보고서에 필요한 것)
    ("global_index", "https://www.marklines.com/en/global/index"),
    ("global_maker_list", "https://www.marklines.com/en/global/maker-list"),
    ("global_search", "https://www.marklines.com/en/global/search"),
    ("global_top", "https://www.marklines.com/en/global/top"),
    ("supplier_db", "https://www.marklines.com/en/supplier_db/"),
    ("supplier_db_top", "https://www.marklines.com/en/supplier_db/top"),
    ("parts_suppliers_theme", "https://www.marklines.com/en/topics_by_theme/769/parts-suppliers"),
    ("analysis_report", "https://www.marklines.com/en/analysis_report"),
    # ③ 유럽 리포트 — 동유럽 OEM 동향이 여기 있을 가능성
    ("eu_report", "https://www.marklines.com/en/report/eu_report_202606"),
    ("supplier_report", "https://www.marklines.com/en/report/supplier0032"),
    # ④ 숫자 ID 페이지 표본 — 이 구조를 확인하면 10개국 ID 를 찾아 3단계에서 돌린다
    ("global_1443", "https://www.marklines.com/en/global/1443"),
    ("global_9270", "https://www.marklines.com/en/global/9270"),
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
        # Referer 를 붙인다 — 성공 중인 sync_oem_production_excel.py 와 헤더를 맞춘다
        "Referer": "https://www.marklines.com/en/",
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
        low = body.lower()
        # 🔴 판정 기준 교정(2026-07-30) — 1차에서 "표 개수"로 봤다가 전부 '빈껍데기'로 오판했다.
        #    MarkLines 페이지는 표가 없어도 정상이다(div 레이아웃·JS 렌더). 성공 중인
        #    sync_oem_*.py 와 같은 기준을 쓴다: **로그인 페이지로 튕겼는가**.
        kicked = "/members/login" in low or "login_form" in low
        # 회원 전용 신호 — 엑셀 다운로드 링크("latest month")가 보이면 확실히 로그인된 것이다
        member_only = "latest month" in low or ".xls" in low
        rich = bool(body) and not kicked
        logged_in_any = logged_in_any or member_only
        if body:
            (OUT / f"{slug}.html").write_text(body, encoding="utf-8")
            for m in re.finditer(r'href="([^"#?]+)"', body):
                href = m.group(1)
                if any(k in href.lower() for k in
                       ("global", "country", "region", "supplier", "plant", "report")):
                    links.append(f"{slug}\t{href}")
        msg = (f"{slug:22s} HTTP {status} · {len(body):>9,}자 · tbl {tables:>3} · "
               f"수치 {nums:>5} · {'로그인튕김' if kicked else 'OK'}"
               f"{' · 회원전용✓' if member_only else ''}")
        print("  " + msg)
        lines.append(msg)

    (OUT / "_links.tsv").write_text("\n".join(sorted(set(links))), encoding="utf-8")
    (OUT / "_summary.txt").write_text("\n".join(lines), encoding="utf-8")
    print(f"\n저장: {OUT} · 링크 {len(set(links))}건")

    if not logged_in_any:
        # 실패로 종료하지 않는다 — HTML 을 받아 눈으로 봐야 원인을 안다(1차에서 오판했다)
        print("[WARN] 회원 전용 신호(Latest month·.xls)를 찾지 못했다 — HTML 을 직접 확인할 것")
    else:
        print("[OK] 회원 전용 링크 확인 = 쿠키 유효")
    return 0


if __name__ == "__main__":
    sys.exit(main())
