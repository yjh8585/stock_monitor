"""yt_report 툴킷의 **stock_monitor 고유** 값·함수 — `_common.py` 가 `from _repo import *` 로 다시 내보낸다.

🔴 이 파일은 두 레포 공통 파일이 아니다(agents 에는 같은 이름의 다른 파일이 있다 · 2026-11-24 정본화 D2).
   공통 8개(`_common`·`capture`·`crop`·`fetch_subs`·`grab`·`montage`·`scan`·`settle`)는 두 레포에서
   바이트 단위로 같고, 레포마다 다른 것만 여기 둔다. 공통 코드가 부르는 이름은 셋이다 —
   `find_existing`·`EXISTING_LABEL`·`YTDLP_PYTHON_CANDIDATES`. 나머지(`load_env`·`storage_pub_base`·
   `already_published`)는 stock_monitor 뒷단 전용이다(`scripts/pdf_report/publish.py` 가 `_common` 으로 가져간다).

🔴 `_common` 을 import 하지 않는다 — `_common` 이 이 파일을 import 하므로 순환이 된다.
   그래서 레포 루트(`_ROOT`)를 여기서 따로 구한다(값은 `_common.ROOT` 와 같다).
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

__all__ = [
    "EXISTING_LABEL",
    "YTDLP_PYTHON_CANDIDATES",
    "already_published",
    "find_existing",
    "load_env",
    "storage_pub_base",
]

_ROOT = Path(__file__).resolve().parents[2]

# yt-dlp 를 가진 파이썬 후보(`_common.find_ytdlp_python` 이 현재 인터프리터·YT_DLP_PYTHON 다음에 본다).
# 이 레포 venv 자신이다 — venv 로 돌리면 현재 인터프리터에서 먼저 잡히고, 시스템 파이썬으로 돌렸을 때만 쓰인다.
YTDLP_PYTHON_CANDIDATES = [str(_ROOT / "scripts" / "venv" / "Scripts" / "python.exe")]

# fetch_subs 가 중복 영상을 찍을 때 쓰는 머리말
EXISTING_LABEL = "이미 게시됨"


# ---- Supabase env / 공개 URL ----
def load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    envf = _ROOT / ".env.local"
    if envf.exists():
        for line in envf.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^([A-Z0-9_]+)=(.*)$", line)
            if m:
                out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def already_published(videos: list[dict]) -> dict[str, tuple[int, str]]:
    """videos 중 이미 posts 에 있는 것 → {key: (id, title)}. YT_ALLOW_UPDATE 로 푼 key 는 뺀다.

    🔴 2026-10-27: 새 회차 8편 중 1편이 9월에 게시된 리포트 132 와 같은 영상이었는데, 끝까지 작업한 뒤
    게시 단계에서 덮어썼다. 사용자 지시 「앞으로는 이미 올라간 영상인지 확인하고 작업하도록 해」 —
    그래서 착수 첫 단계(fetch_subs)에서 묻는다. 영상 ID 로 찾는다(youtu.be 등 주소 형태가 달라도 걸리게).
    """
    import urllib.parse
    import urllib.request

    allow = {k.strip() for k in os.environ.get("YT_ALLOW_UPDATE", "").split(",") if k.strip()}
    env = load_env()
    base = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    out: dict[str, tuple[int, str]] = {}
    for v in videos:
        if "all" in allow or v["key"] in allow:
            continue
        # 🔴 2026-11-17: 두 영상을 한 편으로 합친 글은 source_url 에 첫 영상만 남는다 → 본문(```youtube 블록)도 본다.
        #    본문 대조는 영상 ID(11자 · 대소문자 구분이라 우연 일치가 사실상 없다)라 오탐 걱정이 적다.
        vid = v["id"]
        q = urllib.parse.urlencode(
            {"select": "id,title", "or": f"(source_url.ilike.*{vid}*,content.like.*{vid}*)", "limit": "1"}
        )
        req = urllib.request.Request(
            f"{base}/rest/v1/posts?{q}", headers={"apikey": key, "Authorization": f"Bearer {key}"}
        )
        with urllib.request.urlopen(req, timeout=20) as r:
            rows = json.loads(r.read().decode("utf-8"))
        if rows:
            out[v["key"]] = (rows[0]["id"], rows[0]["title"])
    return out


def find_existing(videos: list[dict]) -> dict[str, str]:
    """공통 이름 — 이미 게시한 영상 → {key: 표시 문자열}(`id=… 「제목」`). 공통 `fetch_subs.py` 가 부른다."""
    return {k: f"id={pid} 「{title}」" for k, (pid, title) in already_published(videos).items()}


def storage_pub_base(folder: str, env: dict[str, str] | None = None) -> str:
    env = env or load_env()
    url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    return f"{url}/storage/v1/object/public/reports/{folder}"
