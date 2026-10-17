"""Hermes native plugin and private configuration overlay; no provider API calls."""
import json
import os
import subprocess
import sys
from pathlib import Path


def prepare(source, target):
    from hermes_cli.config import fast_safe_load
    source, target = Path(source), Path(target)
    target.mkdir(parents=True, exist_ok=True)
    config = fast_safe_load((source / "config.yaml").read_text(encoding="utf-8-sig")) or {}
    if not isinstance(config, dict):
        raise ValueError("Hermes config must be a mapping")
    # Mirror the existing profile by links, preserving login and session stores.
    # Only config and this plugin are private to the Orquestra profile.
    for item in source.iterdir():
        if item.name in ("config.yaml", "plugins"):
            continue
        destination = target / item.name
        if destination.exists():
            continue
        if item.is_dir():
            if os.name == "nt":
                subprocess.run(["cmd.exe", "/d", "/c", "mklink", "/J", str(destination), str(item)], check=True, capture_output=True)
            else:
                destination.symlink_to(item, target_is_directory=True)
        else:
            os.link(item, destination)
    plugins = target / "plugins"
    plugins.mkdir(exist_ok=True)
    if (source / "plugins").exists():
        for item in (source / "plugins").iterdir():
            dest = plugins / item.name
            if item.name == "orquestra-memory" or dest.exists():
                continue
            if item.is_dir() and os.name == "nt":
                subprocess.run(["cmd.exe", "/d", "/c", "mklink", "/J", str(dest), str(item)], check=True, capture_output=True)
            else:
                dest.symlink_to(item, target_is_directory=item.is_dir())
    plugin = plugins / "orquestra-memory"
    plugin.mkdir(exist_ok=True)
    (plugin / "__init__.py").write_text(Path(__file__).read_text(encoding="utf-8"), encoding="utf-8")
    (plugin / "plugin.yaml").write_text(json.dumps({"name": "orquestra-memory", "version": "1.0.0", "description": "Native lifecycle capture to the shared Orquestra AI Memory"}), encoding="utf-8")
    options = config.setdefault("plugins", {})
    disabled = options.get("disabled", [])
    if "orquestra-memory" in disabled:
        raise ValueError("The Orquestra memory plugin is explicitly disabled")
    enabled = options.get("enabled", []) or []
    options["enabled"] = list(dict.fromkeys([*enabled, "orquestra-memory"]))
    (target / "config.yaml").write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")


def register(ctx):
    """Observe native IDs and semantic callbacks; never parse terminal output."""
    if not os.environ.get("ORQUESTRA_MEMORY_PROJECT"):
        return
    import threading
    lock = threading.Lock()
    started, prompts, ended = set(), set(), set()

    def emit(event, session_id, **fields):
        if not session_id:
            return ""
        payload = {"session_id": session_id, "cwd": os.getcwd(), **fields}
        args = [os.environ["ORQUESTRA_MEMORY_BINARY"], "--data-dir", os.environ["AI_MEMORY_DATA_DIR"], "hook", "--agent", "hermes", "--event", event, "--server-url", os.environ["ORQUESTRA_MEMORY_ENDPOINT"]]
        try:
            done = subprocess.run(args, input=json.dumps(payload), text=True, encoding="utf-8", capture_output=True, timeout=8, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            return done.stdout if done.returncode == 0 else ""
        except (OSError, subprocess.TimeoutExpired):
            return ""

    def start(session_id=None, **kwargs):
        with lock:
            if not session_id or session_id in started:
                return
            started.add(session_id)
        emit("session-start", session_id)

    def prompt(session_id=None, turn_id=None, user_message=None, **kwargs):
        start(session_id)
        if not session_id or not turn_id:
            return
        key = (session_id, turn_id)
        with lock:
            if key in prompts:
                return
            prompts.add(key)
        emit("user-prompt-submit", session_id, prompt=user_message if isinstance(user_message, str) else json.dumps(user_message, ensure_ascii=False))

    def before(session_id=None, tool_name=None, args=None, **kwargs):
        start(session_id)
        emit("pre-tool-use", session_id, tool_name=tool_name, tool_input=args)

    def after(session_id=None, tool_name=None, result=None, **kwargs):
        emit("post-tool-use", session_id, tool_name=tool_name, tool_result=result if isinstance(result, (str, dict, list, int, float, bool, type(None))) else str(result))

    def stop(session_id=None, **kwargs):
        emit("stop", session_id)

    def finalize(session_id=None, **kwargs):
        with lock:
            if not session_id or session_id in ended:
                return
            ended.add(session_id)
        emit("session-end", session_id)

    for event, callback in [("on_session_start", start), ("pre_llm_call", prompt), ("pre_tool_call", before), ("post_tool_call", after), ("on_session_end", stop), ("on_session_finalize", finalize), ("on_session_reset", finalize)]:
        ctx.register_hook(event, callback)


if __name__ == "__main__":
    prepare(*sys.argv[1:3])
