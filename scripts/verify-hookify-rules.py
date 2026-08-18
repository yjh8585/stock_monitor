#!/usr/bin/env python
"""hookify 규칙 전수 검증기 — 토큰 0. 규칙마다 '걸려야 할 입력'과 '걸리면 안 되는 입력'을 실제로 통과시킨다.

왜 필요한가 (2026-08-18 실측 · agents 레포에서 발견해 전 프로젝트에 복제):
    이 PC 의 hookify 규칙 63개가 만든 이래 **한 번도 실행된 적이 없었다**. 고장이 두 겹이었다.
      ① 플러그인 `hooks.json` 이 `python3` 을 부르는데 이 PC 의 `python3` 은 Microsoft Store
         안내 스텁이라 exit 49 로 죽는다(진짜 파이썬은 `python`).
      ② 실행돼도 `core/config_loader.py` 가 `open(path, 'r')` 로 열어 한글 메시지를 CP949 로
         읽다 UnicodeDecodeError → 규칙 0개 로드.
    둘 다 **에러 없이 조용히** 무동작이라 "규칙을 만들었다"만으로는 알 수 없다.

    처방 = 플러그인 캐시 `hooks.json` 의 명령 4줄을 `python -X utf8` 로.
    🔴 **플러그인이 업데이트되면 새 캐시 폴더가 생기며 원복된다** → 이 스크립트가 "활성 0개"를
    보고하면 재발한 것이다.

사용:
    python -X utf8 scripts/verify-hookify-rules.py     (레포 루트에서)
"""
import os
import sys
import glob
import json

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_CACHE_GLOB = os.path.expanduser(
    "~/.claude/plugins/cache/claude-plugins-official/hookify/*/core/config_loader.py"
)


def find_plugin_root() -> str:
    """hookify 플러그인 루트를 찾는다(캐시는 버전 해시 폴더라 고정할 수 없다)."""
    env_root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if env_root and os.path.isfile(os.path.join(env_root, "core", "config_loader.py")):
        return env_root
    found = sorted(glob.glob(_CACHE_GLOB), key=os.path.getmtime, reverse=True)
    if not found:
        print("hookify 플러그인을 찾지 못했습니다. 설치돼 있습니까?")
        sys.exit(2)
    return os.path.dirname(os.path.dirname(found[0]))


PLUGIN_ROOT = find_plugin_root()
sys.path.insert(0, PLUGIN_ROOT)

from core.config_loader import load_rules, load_rule_file  # noqa: E402
from core.rule_engine import RuleEngine  # noqa: E402


# ---- 도구 호출 흉내 --------------------------------------------------------
# hookify 는 tool_name 이 Bash/Edit/Write/MultiEdit 이 아니면 event 필터를 끄고 전 규칙을
# 로드한 뒤 tool_input 필드로만 매칭한다 → PowerShell·Grep 도구도 규칙에 걸린다(실측 확인).


def bash(cmd: str) -> dict:
    return {"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": cmd}}


def ps(cmd: str) -> dict:
    return {"hook_event_name": "PreToolUse", "tool_name": "PowerShell", "tool_input": {"command": cmd}}


def edit(path: str, new: str) -> dict:
    return {
        "hook_event_name": "PreToolUse",
        "tool_name": "Edit",
        "tool_input": {"file_path": path, "old_string": "", "new_string": new},
    }


# (규칙이름, 걸려야 하는 입력, 걸리면 안 되는 입력)
CASES = [
    ("block-destructive-commands", bash("rm -rf build"), bash("rm build/out.txt")),
    ("warn-git-push-pipe", bash("git push | tail -3"), bash("git push")),
    ("warn-cd-cwd-drift", bash("cd app && pnpm build"), bash("pnpm build")),
    ("venv-python-encoding",
     bash("scripts/venv/Scripts/python scripts/sync_posts.py"),
     bash("PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python scripts/sync_posts.py")),
    ("warn-ytdlp-ffmpeg-location",
     bash('yt-dlp --download-sections "*0-30" https://x'),
     bash('yt-dlp --download-sections "*0-30" --ffmpeg-location C:/ffmpeg https://x')),
    ("warn-no-console-log",
     edit("app/page.tsx", "console.log('hi');"),
     edit("app/page.tsx", "logger.info('hi');")),
    ("warn-chart-guide-compliance",
     edit("app/chart.tsx", "<Bar dataKey='v' />"),
     edit("app/chart.tsx", "<div className='x' />")),
    ("warn-chart-label-fontsize",
     edit("app/chart.tsx", "<LabelList dataKey='v' fontSize={12} />"),
     edit("app/chart.tsx", "<LabelList dataKey='v' />")),
    ("warn-confidential-db-access",
     edit("app/api/route.ts", "const r = await db.from('pnl_entries').select()"),
     edit("app/api/route.ts", "const r = await confidentialDb.from('pnl_entries').select()")),
    ("confidential-sync-edit",
     edit("scripts/sync_inventory.py", "x = 1"),
     edit("scripts/sync_posts.py", "x = 1")),
    ("confidential-no-amounts",
     edit("scripts/report.py", "table = 'pnl_entries'"),
     edit("scripts/report.py", "table = 'posts'")),
]


def matched_names(inp: dict) -> set:
    """이 입력에 걸리는 규칙 이름 집합 — pretooluse.py 와 똑같은 순서로 event 를 정한다."""
    tool = inp.get("tool_name", "")
    event = "bash" if tool == "Bash" else ("file" if tool in ("Edit", "Write", "MultiEdit") else None)
    engine = RuleEngine()
    return {r.name for r in load_rules(event=event) if engine._rule_matches(r, inp)}


# ---- 배선 검사 -------------------------------------------------------------
# 🔴 규칙이 "로드된다"와 훅이 "실제로 불린다"는 별개다. 위의 케이스 검사는 규칙 파일을
#    직접 읽으므로 캐시 hooks.json 이 원복돼 훅이 한 번도 안 불려도 전부 통과한다.
#    배선은 다섯 프로젝트가 공유한다 → 어느 레포에서 돌려도 같은 것을 본다.
#    일괄 복구 = agents 레포의 scripts/fix-hookify-wiring.py
_HOOKS_GLOB = os.path.expanduser(
    "~/.claude/plugins/cache/claude-plugins-official/hookify/*/hooks/hooks.json"
)


def check_wiring() -> list:
    """캐시 hooks.json 이 '창 없는 exec 형식 + PreToolUse 하나'인지 확인한다."""
    problems: list = []
    paths = glob.glob(_HOOKS_GLOB)
    if not paths:
        return ["hookify 캐시 hooks.json 을 찾지 못했습니다(플러그인 미설치?)"]

    for path in paths:
        tag = os.path.basename(os.path.dirname(os.path.dirname(path)))
        try:
            with open(path, encoding="utf-8") as fh:
                cfg = json.load(fh)
        except Exception as exc:
            problems.append(f"[{tag}] hooks.json 을 읽지 못함: {exc}")
            continue

        events = cfg.get("hooks", {})
        extra = sorted(set(events) - {"PreToolUse"})
        if extra:
            problems.append(
                f"[{tag}] 쓰는 규칙이 0개인 이벤트가 등록돼 있음 {extra}"
                " → 호출마다 검은 콘솔 창이 그만큼 더 뜬다. PreToolUse 만 남길 것"
            )
        if "PreToolUse" not in events:
            problems.append(f"[{tag}] PreToolUse 등록이 없음 — 훅이 아예 안 불린다")
            continue

        for group in events["PreToolUse"]:
            for hook in group.get("hooks", []):
                cmd = str(hook.get("command", ""))
                args = hook.get("args") or []
                if "python3" in cmd or any("python3" in str(a) for a in args):
                    problems.append(
                        f"[{tag}] `python3` 로 원복됨 — 이 PC 에서는 Microsoft Store"
                        " 스텁이라 규칙이 하나도 안 걸린다"
                    )
                if not args:
                    problems.append(
                        f"[{tag}] exec 형식(`args`)이 아님 → bash 래퍼가 붙어"
                        " 호출마다 검은 콘솔 창이 뜬다"
                    )
                if not cmd.lower().endswith("pythonw.exe"):
                    problems.append(
                        f"[{tag}] command 가 pythonw.exe 가 아님({cmd!r})"
                        " → 콘솔 서브시스템이라 창이 뜬다"
                    )
    return problems


def main() -> int:
    if not os.path.isdir(".claude"):
        print("레포 루트에서 실행하십시오(.claude 폴더가 없습니다).")
        return 2

    files = glob.glob(os.path.join(".claude", "hookify.*.local.md"))
    # 🔴 "파일 수 ≠ 활성 규칙 수"를 곧바로 고장으로 읽지 말 것 — 일부러 끈 규칙과
    #    파싱에 실패한 규칙은 전혀 다르다.
    parsed = [(f, load_rule_file(f)) for f in files]
    broken = [f for f, r in parsed if r is None]
    disabled = sorted(r.name for _, r in parsed if r is not None and not r.enabled)
    loaded = {r.name for r in load_rules(None)}
    print(f"규칙 파일 {len(files)}개 · 활성 {len(loaded)}개 · 일부러 끈 것 {len(disabled)}개")
    if disabled:
        print("  비활성:", ", ".join(disabled))
    if broken:
        print(f"🔴 파싱 실패 {len(broken)}건 — 인코딩(CP949 오독)이나 YAML 서식을 의심하십시오:")
        for f in broken:
            print("   -", f)

    fails = [f"[배선] {w}" for w in check_wiring()]
    for name, positive, negative in CASES:
        if name not in loaded:
            fails.append(f"[{name}] 규칙이 로드되지 않음(파일 없음·이름 불일치·파싱 실패)")
            continue
        if name not in matched_names(positive):
            fails.append(f"[{name}] 걸려야 할 입력에 안 걸림 → {positive['tool_input']}")
        if name in matched_names(negative):
            fails.append(f"[{name}] 걸리면 안 되는 입력에 걸림(오탐) → {negative['tool_input']}")

    for orphan in sorted(loaded - {c[0] for c in CASES}):
        fails.append(f"[{orphan}] 검증 케이스가 없는 규칙 — CASES 에 정/오탐 두 줄을 추가하십시오")

    if fails:
        print(f"\n실패 {len(fails)}건:")
        for f in fails:
            print("  -", f)
        return 1
    print(f"전부 통과 ({len(CASES)}개 규칙 × 정탐·오탐 2케이스)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
