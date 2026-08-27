# -*- coding: utf-8 -*-
"""Q1b 층2 선별 수집 — 층1 대장에서 후보를 골라 **첨부 평가의견서 본문**을 받고 점수화한다.

계획서 = agents `docs/superpowers/specs/2026-08-25-ma-knowledge-wiki.md`
        「확장 갈래 — DART 외부기관평가의견서 수집」 Q1b

원형 = `verify_rcpno_pair.py`(가설 검증 10/10 통과)를 승격한 것. 승격하며 더한 것은
       ① 층1 대장 기반 후보 선정 ② 본문 텍스트 보존 ③ 점수화·저장 배선.

🔴 이 스크립트는 **웹(dart.fss.or.kr)** 을 쓴다 — OpenAPI 와 달리 **IP 차단이 있다.**
   요청 간격 2초 + 차단 감지 시 30분 대기(정찰 실측: 0.15초에 차단 · 26분 뒤 해제 ·
   2초 간격 30요청에서는 재차단 없음).

🔴 첨부는 **`rcpNo`+`dcmNo` 쌍**으로 연다. 정정공시의 첨부는 **원공시 rcpNo** 에 매달려 있고
   원공시가 최대 17개월 앞선 경우가 있다 — 정정본 rcpNo 로는 구조적으로 절대 안 열린다.

실행:
  ./scripts/venv/Scripts/python.exe -X utf8 -u scripts/dart_eval/fetch_opinion.py
  옵션: --per-bucket 5 (버킷당 후보) · --buckets 12 · --limit N · --dry-run(후보만 출력)

산출:
  fetch_opinion_result.json                       건별 점수·판정
  <볼트>/지식/_추출/dart-eval/<rcp>_<회사>.md      본문(정독용 · Claude Code 가 직접 읽는다)
"""
import argparse
import io
import json
import os
import re
import sys
import time
from collections import Counter, defaultdict

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lib.bootstrap import init_script  # noqa: E402

init_script(__file__)

import requests  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SM = os.path.dirname(os.path.dirname(HERE))
AGENTS = os.path.join(os.path.dirname(SM), "agents")
LEDGER = os.path.join(AGENTS, "docs", "data", "ma-valuation-params.json")
VAULT = os.environ.get(
    "MANAGEMENT_VAULT_DIR",
    r"C:\Users\junghwan.yoon\workspace\3.옵시디언\20_경영")
OUT_DIR = os.path.join(VAULT, "지식", "_추출", "dart-eval")
# 누적 버킷 카운터는 agents 레포의 문서 데이터로 둔다(결정 11 — 산출은 agents).
AGENTS_DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))))),
    "agents", "docs", "data")

GAP = 2.0          # 🔴 요청 간격(초). 0.15초로 두들겨 차단당했다
BLOCK_WAIT = 1800  # 차단 감지 시 대기(초) — 실측 해제 26분
MIN_CHARS = 20000  # G3 — 형식적 요약본 배제(실측 통과율 70%)

S = requests.Session()
S.headers.update({
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"),
    "Accept-Language": "ko-KR,ko;q=0.9",
    "Referer": "https://dart.fss.or.kr/",
})

TREE_RE = re.compile(
    r"node\d+\['text'\]\s*=\s*\"([^\"]*)\";.*?node\d+\['rcpNo'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['dcmNo'\]\s*=\s*\"([^\"]*)\";.*?node\d+\['eleId'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['offset'\]\s*=\s*\"([^\"]*)\";.*?node\d+\['length'\]\s*=\s*\"([^\"]*)\";.*?"
    r"node\d+\['dtd'\]\s*=\s*\"([^\"]*)\";",
    re.DOTALL,
)


# ─────────────────────────────── 웹 접근 ───────────────────────────────

def get(url: str) -> str | None:
    """지수 백오프 재시도. 연속 실패는 차단으로 보고 길게 쉰다."""
    for i in range(4):
        try:
            r = S.get(url, timeout=40)
            time.sleep(GAP)
            return r.text
        except Exception:
            if i == 2:  # 세 번째까지 실패하면 차단으로 보고 30분 쉰다
                print(f"      !! 연속 실패 — 차단 추정. {BLOCK_WAIT // 60}분 대기", flush=True)
                time.sleep(BLOCK_WAIT)
            else:
                time.sleep(5 * (i + 1))
    return None


def att_pairs(rcp: str):
    """첨부문서 [(문서명, 첨부rcpNo, dcmNo)] — 🔴 rcpNo 를 함께 뽑는 것이 핵심이다."""
    h = get(f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcp}")
    if h is None:
        return None
    m = re.search(r'<select[^>]*id="att".*?</select>', h, re.S)
    if not m:
        return []
    out = []
    for v, t in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', m.group(0), re.S):
        v = v.replace("&amp;", "&")
        mr, md = re.search(r"rcpNo=(\d+)", v), re.search(r"dcmNo=(\d+)", v)
        if mr and md:
            nm = re.sub(r"\s+", " ", re.sub("<[^>]+>", "", t)).replace("\xa0", " ").strip()
            out.append((nm, mr.group(1), md.group(1)))
    return out


def body(rcp_att: str, dcm: str):
    """(글자수, 표개수, 판정, 본문텍스트) — 2단 경유(main.do -> 트리 -> viewer.do)."""
    h = get(f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcp_att}&dcmNo={dcm}")
    if h is None:
        return 0, 0, "요청실패", ""
    nodes = TREE_RE.findall(h)
    if not nodes:
        return 0, 0, ("PDF전용" if "download" in h.lower() else "본문없음"), ""
    n = max(nodes, key=lambda x: int(x[5]) if str(x[5]).isdigit() else 0)
    hv = get(f"https://dart.fss.or.kr/report/viewer.do?rcpNo={n[1]}&dcmNo={n[2]}"
             f"&eleId={n[3]}&offset={n[4]}&length={n[5]}&dtd={n[6]}")
    if hv is None:
        return 0, 0, "뷰어실패", ""
    bs = BeautifulSoup(hv, "html.parser")
    txt = bs.get_text("\n", strip=True)
    return len(txt), len(bs.find_all("table")), "HTML", txt


# ─────────────────────────────── 점수화 ───────────────────────────────

def score(txt: str, n_tables: int, deal_mn: float | None) -> dict:
    """계획서 「2단계 점수 — 100점 만점」. 본문을 받아야 매길 수 있는 항목들이다.

    ⚠️ 「산업분석 서술량」은 5절 경계를 정확히 못 자른다 — 산업 관련 어휘가 든 줄의
       분량으로 **근사**한다. 근사치임을 결과에 남긴다.
    """
    s: dict = {}
    # 20점 — 산업분석 서술량(근사)
    ind_lines = [l for l in txt.split("\n")
                 if any(k in l for k in ("산업", "시장", "경쟁", "밸류체인", "수요", "전방"))]
    ind_chars = sum(len(l) for l in ind_lines)
    s["industry_chars"] = ind_chars
    s["s_industry"] = 20 if ind_chars >= 8000 else 14 if ind_chars >= 4000 else 8 if ind_chars >= 2000 else 2

    # 20점 — 분량 (실측 중앙 29,274자)
    n = len(txt)
    s["s_volume"] = 20 if n >= 40000 else 14 if n >= 30000 else 8 if n >= 20000 else 2

    # 15점 — 민감도 분석 (실측 64%만 있다 · 변별력이 가장 크다)
    s["has_sensitivity"] = "민감도" in txt
    s["s_sensitivity"] = 15 if s["has_sensitivity"] else 0

    # 15점 — WACC 구성 상세
    wacc_terms = sum(1 for k in ("무위험이자율", "시장위험프리미엄", "베타", "Beta",
                                 "자기자본비용", "타인자본비용", "목표자본구조", "법인세율",
                                 "가중평균자본비용") if k in txt)
    s["wacc_terms"] = wacc_terms
    s["s_wacc"] = 15 if wacc_terms >= 7 else 10 if wacc_terms >= 5 else 5 if wacc_terms >= 3 else 0

    # 10점 — 평가방법 다양성
    methods = sum(1 for k in ("현금흐름할인", "상대가치", "자산가치", "순자산") if k in txt)
    s["methods"] = methods
    s["s_methods"] = 10 if methods >= 3 else 6 if methods == 2 else 2

    # 10점 — 수행기준 체크리스트 충실도(부록B)
    # ⚠️ 2026-08-27 정독 61건에서 **이 지표는 무력하다**고 판정됐다.
    #    체크리스트가 형식적으로 채워진다 — 시너지이노베이션 건은 대상회사의 사업·재무·산업 서술이
    #    문서 전체에 하나도 없는데 이행점검표에는 "재무제표 분석 충실"·"비재무정보 분석 충실"이
    #    모두 「Yes」였다. 초록뱀푸드팜 건(외식업)은 별첨에 「소셜카지노게임업 규제 위험」 문구가
    #    그대로 남아 있었다(다른 건 템플릿 복붙).
    #    → 점수는 그대로 두되 **이 값을 근거로 품질을 판정하지 말 것.**
    #      대체 지표 후보 = 「본문에 다른 산업 이야기가 섞여 있는가」(템플릿 복붙 탐지).
    s["has_checklist"] = "수행기준" in txt or "외부평가업무" in txt
    s["s_checklist"] = 10 if s["has_checklist"] and n_tables >= 40 else 6 if s["has_checklist"] else 0

    # 10점 — 거래 중요도(층1에서 파싱한 거래금액)
    s["s_deal"] = (10 if deal_mn and deal_mn >= 100000 else
                   7 if deal_mn and deal_mn >= 30000 else
                   4 if deal_mn and deal_mn >= 10000 else 1)

    s["total"] = (s["s_industry"] + s["s_volume"] + s["s_sensitivity"] + s["s_wacc"]
                  + s["s_methods"] + s["s_checklist"] + s["s_deal"])
    return s


# ─────────────────────────────── 후보 선정 ───────────────────────────────

def pick_candidates(rows: list, per_bucket: int, n_buckets: int) -> list:
    """🔴 층1 게이트는 G1(외부평가 예) + G5(5년) + G6(최신본)뿐이다.
    G4(DCF)를 여기 걸면 **의견 전문 파싱이 안 된 건을 통째로 버린다**(470 -> 139).
    G2·G3·G4 는 본문을 받은 뒤 판정한다.

    버킷은 KSIC 앞 2자리. 버킷 안에서는 **거래금액 큰 순**(큰 딜일수록 분석이 깊다) ·
    의견 전문이 있는 건을 앞세운다.
    """
    g1 = [r for r in rows if r.get("is_latest") and (r.get("eval_yn") or "").startswith("예")]
    buckets = defaultdict(list)
    for r in g1:
        buckets[(r.get("induty") or "")[:2] or "??"].append(r)

    def deal_of(r) -> float:
        m = re.search(r"([\d,]{4,})", r.get("deal_amount_raw") or "")
        return float(m.group(1).replace(",", "")) if m else 0.0

    order = sorted(buckets.items(), key=lambda kv: len(kv[1]), reverse=True)[:n_buckets]
    picked = []
    for code, items in order:
        items.sort(key=lambda r: (bool(r.get("opinion")), deal_of(r)), reverse=True)
        for r in items[:per_bucket]:
            r = dict(r)
            r["bucket"] = code
            r["deal_mn"] = deal_of(r) / 1_000_000 if deal_of(r) > 1e8 else deal_of(r)
            picked.append(r)
    return picked


# ─────────────────────────────── 실행 ───────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-bucket", type=int, default=5)
    ap.add_argument("--buckets", type=int, default=12)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true", help="후보만 출력하고 웹은 안 건드린다")
    ap.add_argument("--rcps", default="",
                    help="🔴 접수번호를 쉼표로 직접 지정한다(버킷 선정을 건너뛴다). "
                         "같은 거래의 매도·매수 양면처럼 **특정 사례를 겨냥해** 받을 때 쓴다")
    args = ap.parse_args()

    led = json.load(io.open(LEDGER, encoding="utf-8"))

    # 🔴 이미 받은 건을 **후보 선정 전에** 걷어낸다.
    #    고른 뒤에 거르면 주간 cron 이 매주 같은 상위 후보를 골라 전부 건너뛰고
    #    영원히 0건이 된다 — 새로 들어온 딜이 후보에 오르지 못한다.
    res_path = os.path.join(HERE, "fetch_opinion_result.json")
    done = {}
    if os.path.exists(res_path):
        done = {r["rcp"]: r for r in json.load(io.open(res_path, encoding="utf-8"))}
        print(f"기존 결과 {len(done)}건 — 이어서 받는다")

    if args.rcps:
        want = {x.strip() for x in args.rcps.split(",") if x.strip()}
        by_rcp = {r["rcp"]: r for r in led["rows"]}
        cands = []
        for rcp in want:
            r = by_rcp.get(rcp)
            if r is None:
                print(f"  !! 대장에 없는 접수번호: {rcp}")
                continue
            r = dict(r)
            r["bucket"] = (r.get("induty") or "")[:2] or "??"
            r["deal_mn"] = None
            cands.append(r)
        print(f"지정 수집 {len(cands)}건 (버킷 선정 건너뜀)")
    else:
        pool = [r for r in led["rows"] if r["rcp"] not in done]
        cands = pick_candidates(pool, args.per_bucket, args.buckets)
        print(f"후보 {len(cands)}건 (버킷 {args.buckets}개 × {args.per_bucket}건)")
        print("버킷별:", dict(Counter(c["bucket"] for c in cands)))
    if args.limit:
        cands = cands[:args.limit]
    if args.dry_run:
        for c in cands[:40]:
            print(f"  {c['bucket']}  {c['dt']}  {c['corp'][:14]:<14} "
                  f"{'의견○' if c.get('opinion') else '의견-'}  {c.get('deal_amount_raw', '')[:28]}")
        return

    os.makedirs(OUT_DIR, exist_ok=True)
    results = list(done.values())
    for i, c in enumerate(cands, 1):
        rcp = c["rcp"]
        if rcp in done:
            continue
        pairs = att_pairs(rcp)
        if pairs is None:
            print(f"  [{i:3d}] {rcp} 첨부조회 실패(차단?) — 중단", flush=True)
            break
        ev = [p for p in pairs if any(k in p[0].replace(" ", "")
                                      for k in ("평가의견서", "외부평가"))]
        rec = {"rcp": rcp, "corp": c["corp"], "bucket": c["bucket"], "dt": c["dt"],
               "report_nm": c["report_nm"], "n_att": len(pairs), "has_eval": bool(ev)}
        if not ev:
            rec["verdict"] = "G1탈락-첨부없음"
            results.append(rec)
            print(f"  [{i:3d}] {c['corp'][:12]:<12} 평가의견서 첨부 없음", flush=True)
            continue

        nm, rcp_att, dcm = ev[0]
        rec["att_name"] = nm
        rec["att_rcp"] = rcp_att
        rec["rcp_differs"] = rcp_att != rcp  # 정정공시 여부의 직접 증거
        n, ntab, kind, txt = body(rcp_att, dcm)
        rec.update(chars=n, tables=ntab, kind=kind)
        # 🔴 `--rcps` 로 **직접 지정한 건은 게이트를 적용하지 않는다.**
        #    게이트(G3 2만자 등)는 「산업 지식을 뽑을 만큼 두꺼운가」를 보는 장치인데,
        #    양면 비교·소형 딜·소수지분처럼 **특정 사례를 겨냥해 받는 건**은 목적이 다르다.
        #    실제로 메타랩스(초록뱀미디어 거래의 상대편)가 17,592자로 탈락해 버려질 뻔했다.
        gate = not args.rcps
        if kind != "HTML" or n == 0:
            rec["verdict"] = f"G2탈락-{kind}"
        elif gate and n < MIN_CHARS:
            rec["verdict"] = f"G3탈락-{n}자"
        elif gate and not any(k in txt for k in ("현금흐름할인", "가중평균자본비용", "DCF")):
            rec["verdict"] = "G4탈락-DCF없음"
        else:
            rec.update(score(txt, ntab, c.get("deal_mn")))
            rec["verdict"] = "채택후보"
            safe = re.sub(r'[<>:"/\\|?*]', "-", c["corp"])[:20]
            with io.open(os.path.join(OUT_DIR, f"{rcp}_{safe}.md"), "w",
                         encoding="utf-8", newline="\n") as f:
                f.write(f"# {c['corp']} — 외부평가의견서\n\n"
                        f"- 접수번호: {rcp} (첨부 rcpNo {rcp_att})\n"
                        f"- 공시일: {c['dt']} · 보고서: {c['report_nm']}\n"
                        f"- 업종(KSIC): {c.get('induty', '')} · 버킷 {c['bucket']}\n"
                        f"- 첨부문서: {nm}\n"
                        f"- 분량: {n:,}자 · 표 {ntab}개 · 점수 {rec['total']}\n\n---\n\n" + txt)
        results.append(rec)
        io.open(res_path, "w", encoding="utf-8", newline="\n").write(
            json.dumps(results, ensure_ascii=False, indent=1))
        print(f"  [{i:3d}] {c['corp'][:12]:<12} {rec['verdict']:<16} "
              f"{rec.get('chars', 0):>7,}자 점수 {rec.get('total', '-')}", flush=True)

    ok = [r for r in results if r.get("verdict") == "채택후보"]
    ok.sort(key=lambda r: r["total"], reverse=True)
    print(f"\n===== Q1b 결과 =====")
    print(f"시도 {len(results)}건 · 채택후보 {len(ok)}건")
    print("판정:", dict(Counter(r.get("verdict") for r in results)))
    if ok:
        print(f"점수 — 최고 {ok[0]['total']} · 중앙 {ok[len(ok) // 2]['total']} · 최저 {ok[-1]['total']}")
        print(f"65점 이상: {sum(1 for r in ok if r['total'] >= 65)}건")
        print("\n상위 20:")
        for r in ok[:20]:
            print(f"  {r['total']:3d}  {r['bucket']}  {r['corp'][:14]:<14} "
                  f"{r['chars']:>7,}자  민감도{'O' if r.get('has_sensitivity') else 'X'} "
                  f"WACC항목{r.get('wacc_terms', 0)}")
    print(f"\n본문 저장: {OUT_DIR}")

    # ── 주간 cron 이 읽을 실행별 요약 ──────────────────────────────
    # 🔴 누적 파일(fetch_opinion_result.json)에서 세면 매주 같은 숫자가 나온다.
    #    이번 실행에서 **새로 시도한 것**만 담는다.
    fresh = [r for r in results if r["rcp"] not in done]
    fresh_ok = [r for r in fresh if r.get("verdict") == "채택후보"]
    run = {
        "tried": len(fresh),
        "adopted": len(fresh_ok),
        "buckets": dict(Counter(r.get("bucket") for r in fresh_ok)),
        "top": [
            {"corp": r.get("corp"), "score": r.get("total"), "bucket": r.get("bucket")}
            for r in sorted(fresh_ok, key=lambda x: x.get("total", 0), reverse=True)[:5]
        ],
        "blocked": any(r.get("verdict") == "첨부조회실패" for r in fresh),
    }
    io.open(os.path.join(HERE, "fetch_opinion_last_run.json"), "w",
            encoding="utf-8", newline="\n").write(
        json.dumps(run, ensure_ascii=False, indent=1))

    # ── 누적 버킷 카운터(계획서 지정 산출물) ──────────────────────
    # 매주 같은 산업만 쌓이는 것을 막으려고 누적으로 센다.
    bpath = os.path.join(AGENTS_DATA, "ma-eval-buckets.json")
    acc = {}
    if os.path.exists(bpath):
        try:
            acc = json.load(io.open(bpath, encoding="utf-8"))
        except (ValueError, OSError):
            acc = {}
    counts = acc.get("counts", {})
    for r in fresh_ok:
        b = r.get("bucket") or "??"
        counts[b] = counts.get(b, 0) + 1
    acc["counts"] = counts
    acc["total"] = sum(counts.values())
    io.open(bpath, "w", encoding="utf-8", newline="\n").write(
        json.dumps(acc, ensure_ascii=False, indent=1))
    print(f"버킷 누적: {acc['total']}건 · {len(counts)}개 버킷")


if __name__ == "__main__":
    main()
