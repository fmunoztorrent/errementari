#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Coordination of Claude Code ↔ opencode sessions over the SAME working tree.
#
# Problem it solves: two agentic tools (Claude Code and opencode) operate on
# the same working tree. A destructive git operation in one (checkout -f,
# reset --hard, clean -f, ...) discards the other's uncommitted changes or
# deletes its untracked files. This caused real work loss.
#
# Shared state: coordination.json (gitignored, per machine). Records which
# tool has a live session and on which branch. The guard does NOT rely only on
# the registry: the underlying protection is "is the tree dirty?" — and the
# tree is shared, so it protects both tools by construction.
#
# Usage:
#   coordination.sh register  <tool> [task]   # session registration/heartbeat
#   coordination.sh heartbeat <tool>          # update heartbeat
#   coordination.sh release   <tool>          # session removal
#   coordination.sh list                      # print shared state
#   coordination.sh guard-git "<command>"     # exit 2 if it would destroy changes
#
# One-off override: COORD_OVERRIDE=1 <command-that-would-be-blocked>
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COORD_FILE="$SCRIPT_DIR/coordination.json"
TTL_SECONDS=1800   # 30 min without heartbeat ⇒ dead session (purged)
PY="$(command -v python3 || true)"

now_iso()     { date -u +%Y-%m-%dT%H:%M:%SZ; }
repo_branch() { git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?"; }
ensure_file() { [ -f "$COORD_FILE" ] || echo '{"sessions":{}}' > "$COORD_FILE"; }

cmd="${1:-}"; shift 2>/dev/null || true

case "$cmd" in
  register|heartbeat)
    [ -z "$PY" ] && exit 0   # without python3 we don't coordinate, but we don't break anything
    ensure_file
    TOOL="${1:-unknown}" TASK="${2:-}" BRANCH="$(repo_branch)" PID="${PPID:-0}" \
    NOW="$(now_iso)" TTL="$TTL_SECONDS" "$PY" - "$COORD_FILE" <<'PY'
import json, os, sys, datetime
f = sys.argv[1]
try:
    d = json.load(open(f))
except Exception:
    d = {"sessions": {}}
s = d.setdefault("sessions", {})

def age(ts):
    try:
        t = datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")
        return (datetime.datetime.utcnow() - t).total_seconds()
    except Exception:
        return 1e18

ttl = float(os.environ["TTL"])
for k in list(s):
    if age(s[k].get("heartbeat", "")) > ttl:
        del s[k]

tool = os.environ["TOOL"]
now = os.environ["NOW"]
e = s.setdefault(tool, {})
e["tool"] = tool
e["pid"] = int(os.environ["PID"])
e["branch"] = os.environ["BRANCH"]
e["heartbeat"] = now
e.setdefault("registered_at", now)
if os.environ.get("TASK"):
    e["task"] = os.environ["TASK"]
json.dump(d, open(f, "w"), indent=2)
PY
    ;;

  release)
    [ -z "$PY" ] && exit 0
    ensure_file
    TOOL="${1:-unknown}" "$PY" - "$COORD_FILE" <<'PY'
import json, os, sys
f = sys.argv[1]
try:
    d = json.load(open(f))
except Exception:
    d = {"sessions": {}}
d.get("sessions", {}).pop(os.environ["TOOL"], None)
json.dump(d, open(f, "w"), indent=2)
PY
    ;;

  list)
    ensure_file
    cat "$COORD_FILE"
    ;;

  guard-git)
    full="$*"

    # Is this a git operation destructive to the working tree?
    # The destructive git must be in COMMAND POSITION (start of line or after
    # ; && || | ( ) so we don't match mentions inside quotes, e.g.
    # echo "git reset --hard" or a commit message. grep processes line by line.
    boundary='(^|[;&|(])[[:space:]]*'
    destructive_re="${boundary}git[[:space:]]+(reset[[:space:]]+--hard|clean[[:space:]]+-[a-zA-Z]*f|checkout[[:space:]]+-f|checkout[[:space:]]+--([[:space:]]|\$)|checkout[[:space:]]+\.|switch[[:space:]]+(-f|--discard-changes)|stash([[:space:]]|\$))"
    if ! printf '%s' "$full" | grep -Eq "$destructive_re"; then
      exit 0   # not destructive → allow
    fi

    dirty="$(git status --porcelain 2>/dev/null)"
    [ -z "$dirty" ] && exit 0   # clean tree → nothing to lose

    # Info on other live sessions (only to enrich the message)
    others=""
    if [ -n "$PY" ] && [ -f "$COORD_FILE" ]; then
      others="$(THIS="$(repo_branch)" "$PY" - "$COORD_FILE" <<'PY'
import json, os, sys, datetime
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
def age(ts):
    try:
        t = datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")
        return (datetime.datetime.utcnow() - t).total_seconds()
    except Exception:
        return 1e18
out = []
for k, v in d.get("sessions", {}).items():
    if age(v.get("heartbeat", "")) <= 1800:
        out.append(f"  • {v.get('tool', k)} on branch '{v.get('branch','?')}' (heartbeat {v.get('heartbeat','?')})")
print("\n".join(out))
PY
)"
    fi

    # stash is recoverable (git stash list) → warn only, don't block
    if printf '%s' "$full" | grep -Eq "${boundary}git[[:space:]]+stash"; then
      echo "[coordination] WARNING: '$full' with a dirty tree; stash is recoverable via 'git stash list'." >&2
      exit 0
    fi

    if [ "${COORD_OVERRIDE:-0}" = "1" ]; then
      echo "[coordination] OVERRIDE active — allowing '$full' despite the dirty tree." >&2
      exit 0
    fi

    {
      echo "[coordination] BLOCKED: '$full' would destroy uncommitted changes in the shared working tree."
      echo
      echo "Changes at risk:"
      printf '%s\n' "$dirty" | sed 's/^/  /'
      if [ -n "$others" ]; then
        echo
        echo "Live sessions detected:"
        printf '%s\n' "$others"
      fi
      echo
      echo "This is what caused work loss between Claude/opencode sessions."
      echo "Before continuing, preserve the work:"
      echo "  • git add -A && git commit -m '...'   (recommended), or"
      echo "  • git stash -u                        (recoverable via git stash list)"
      echo
      echo "Force anyway: COORD_OVERRIDE=1 <command>"
    } >&2
    exit 2
    ;;

  *)
    echo "usage: coordination.sh {register|heartbeat|release|list|guard-git} ..." >&2
    exit 1
    ;;
esac
