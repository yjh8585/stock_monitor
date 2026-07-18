"""selected.json + batch.json → (1) 선택 프레임 png 변환 (2) 본문 [[FRAME:slug]] 토큰 치환.

입력:
  RUN_DIR/reports/<key>.md   — 에이전트가 쓴 본문(플레이스홀더 [[FRAME:slug]] 포함)
  RUN_DIR/batch.json         — {reports:[{key, frames:[{slug,alt,caption,public_url}]}], ...}
  RUN_DIR/selected.json      — {slug: offset}  (드롭 slug은 없음)
출력:
  RUN_DIR/png/<slug>.png         — 선택 프레임(jpg→png). crop.py가 이후 일부를 덮어씀.
  RUN_DIR/reports_final/<key>.md — 토큰이 이미지 마크다운으로 치환된 최종 본문

토큰이 selected에 없거나 png 변환 실패 시 해당 토큰 줄은 제거(누락 이미지 자동 정리).
usage: python finalize.py
"""
from __future__ import annotations

import json
import re
import subprocess

from _common import ensure_dir, find_ffmpeg, run_path

SENTINEL = "\x01DROPFRAME\x01"
TOKEN = re.compile(r"^[ \t]*\[\[FRAME:([a-z0-9_]+)\]\][ \t]*$", re.M)


def jpg_to_png(slug: str, offset: int, ff: str) -> bool:
    src = run_path("frames", f"{slug}_{offset:02d}.jpg")
    dst = run_path("png", f"{slug}.png")
    if not src.exists():
        return False
    r = subprocess.run(
        [ff, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), str(dst)],
        check=False, capture_output=True,
    )
    return r.returncode == 0 and dst.exists()


def main() -> int:
    ff, _ = find_ffmpeg()
    ensure_dir(run_path("png"))
    ensure_dir(run_path("reports_final"))
    batch = json.loads(run_path("batch.json").read_text(encoding="utf-8"))
    selected = json.loads(run_path("selected.json").read_text(encoding="utf-8"))

    print("=== PNG 변환 ===")
    png_ok: set[str] = set()
    for slug, off in selected.items():
        ok = jpg_to_png(slug, int(off), ff)
        if ok:
            png_ok.add(slug)
        print(f"  {'OK ' if ok else 'ERR'} {slug} @ {off}s")

    print("=== 본문 조립 ===")
    for rep in batch["reports"]:
        key = rep["key"]
        meta = {fr["slug"]: fr for fr in rep["frames"]}
        text = run_path("reports", f"{key}.md").read_text(encoding="utf-8")
        used, dropped = [], []

        def repl(m: re.Match) -> str:
            slug = m.group(1)
            if slug in selected and slug in png_ok and slug in meta:
                fr = meta[slug]
                used.append(slug)
                return f"![{fr['alt']}]({fr['public_url']})\n*{fr['caption']}*"
            dropped.append(slug)
            return SENTINEL

        text = TOKEN.sub(repl, text)
        text = re.sub(rf"[ \t]*{re.escape(SENTINEL)}[ \t]*", "", text)
        text = re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"
        run_path("reports_final", f"{key}.md").write_text(text, encoding="utf-8")
        print(f"  {key}: 이미지 {len(used)}개, 드롭 {len(dropped)}개  {dropped if dropped else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
