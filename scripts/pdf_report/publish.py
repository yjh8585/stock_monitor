"""PDF 정리본 게시 — 회차 폴더의 report.md 를 posts 에 넣는다(docs/report-from-pdf.md §1-A).

회차마다 게시 스크립트를 새로 짜던 것(10-30 `_katech_pdf_publish.ts` · 11-17 `publish_pdf.py`)을 하나로 모았다.

사용:
  PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe scripts/pdf_report/publish.py \
      --dir scripts/_pdf_report/<날짜> --title "<제목 (발행처 간행물 호수)>" \
      --source-name 산업연구원 --source-url <발행처 상세페이지> --date 2026-10-30 \
      --category 로봇 [--confidential] [--dry-run]

- `<dir>/report.md` 의 `{{PUB}}` 를 Storage 공개 주소(`<dir>/batch.json` 의 storage_folder)로 바꿔
  `<dir>/reports_final/<이름>.md` 로 남긴다(verify_yt_report.py 가 그 폴더를 읽는다).
- 같은 source_url 이 있으면 UPDATE, 없으면 INSERT 한다. 덮어쓰기는 `--allow-update` 가 있어야 한다
  (다른 회차가 같은 링크로 이미 게시한 글을 조용히 덮지 않게).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "yt_report"))
from _common import load_env, storage_pub_base  # noqa: E402
from retro_check import check as retro_check  # noqa: E402

DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="회차 폴더(report.md·batch.json 이 있는 곳)")
    ap.add_argument("--title", required=True)
    ap.add_argument("--source-name", required=True, help="발행처(예: 산업연구원)")
    ap.add_argument("--source-url", required=True, help="발행처 상세페이지(PDF 직링크보다 우선 · §2)")
    ap.add_argument("--date", required=True, help="발행일 YYYY-MM-DD — UTC 자정으로 저장(§3-F)")
    ap.add_argument("--category", required=True, help="로봇이면 휴머노이드 보고서에만 뜬다")
    ap.add_argument("--confidential", action="store_true")
    ap.add_argument("--allow-update", action="store_true", help="같은 source_url 글을 덮어쓴다")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    run = (ROOT / args.dir).resolve() if not Path(args.dir).is_absolute() else Path(args.dir)
    if not DATE.match(args.date):
        print(f"--date 형식이 YYYY-MM-DD 가 아니다: {args.date}")
        return 2
    # 🔴 회고 표 없이 게시하지 않는다 — .env.local 을 읽기 전에(사용자 선택 2026-11-24 「S publish.py + A 검사기」 ·
    #    공통 파일 retro_check.py 의 pdf 갈래 · 절차 = agents scripts/pdf_report/README.md 「회차 끝 회고」)
    retro = retro_check(run, flow="pdf")
    if retro != 0:
        hint = ("회고 검사를 끝내지 못했다(회고 파일 읽기·원장 CLI) — 위 🛑 줄의 원인 확인" if retro == 2
                else f"위 🛑 줄의 사유를 고치고 다시 돌려라({run / 'retro.md'})")
        print(f"🛑 게시하지 않고 멈춘다 — {hint}")
        return 1
    batch = json.loads((run / "batch.json").read_text(encoding="utf-8"))
    env = load_env()
    base = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    hdr = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    body = (run / "report.md").read_text(encoding="utf-8")
    body = body.replace("{{PUB}}", storage_pub_base(batch["storage_folder"], env))
    if "{{" in body:
        print("자리표시자({{…}})가 남았다 — 게시하지 않는다")
        return 2
    out_dir = run / "reports_final"
    out_dir.mkdir(exist_ok=True)
    (out_dir / f"{batch['storage_folder']}.md").write_text(body, encoding="utf-8", newline="\n")

    row = {
        "source_type": "report",
        "title": args.title,
        "source_name": args.source_name,
        "source_url": args.source_url,
        # 🔴 +09:00 으로 넣으면 화면에서 하루 앞당겨 보인다(§3-F)
        "source_published_at": f"{args.date}T00:00:00Z",
        "category": args.category,
        "status": "completed",
        "is_confidential": args.confidential,
        "content": body,
    }
    q = urllib.parse.urlencode({"select": "id,title", "source_url": f"eq.{args.source_url}"})
    existing = json.loads(urllib.request.urlopen(urllib.request.Request(f"{base}/rest/v1/posts?{q}", headers=hdr), timeout=20).read())
    print("기존:", existing, "· 본문", len(body), "자")
    if existing and not args.allow_update:
        print("같은 source_url 글이 이미 있다 — 덮어쓰려면 --allow-update")
        return 3
    if args.dry_run:
        return 0
    if existing:
        url, method = f"{base}/rest/v1/posts?id=eq.{existing[0]['id']}", "PATCH"
    else:
        url, method = f"{base}/rest/v1/posts", "POST"
    req = urllib.request.Request(
        url, data=json.dumps(row).encode("utf-8"), method=method, headers={**hdr, "Prefer": "return=representation"}
    )
    out = json.loads(urllib.request.urlopen(req, timeout=30).read())
    print(f"{method} id={out[0]['id']} category={out[0]['category']}")
    print("다음: 무효화(posts·post:<id>) → verify.py --ids <id> (로봇이면 --route humanoid/reports 도)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
