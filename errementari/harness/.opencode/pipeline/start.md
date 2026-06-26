# Start checklist — Pipeline step 0

Run **before creating the spec** (before Step 1/6).
Applies to both `feature` and `bugfix`.

## Steps

### 1. Pre-flight check

```bash
bash .opencode/pipeline/pre-spec.sh
```

If the script exits with an error, **stop here**. Resolve every issue before continuing:

| Issue | How to resolve it |
|---|---|
| Dirty working tree | `git add . && git commit` or `git stash -u` |
| Open PRs | Merge, close, or wait for the team's decision |
| Orphan commits in dev (feat/fix) | Create a PR to capture them: `gh pr create --base main --head dev`. They are a **hard FAIL** — a spec cannot start until dev is clean of feature work not merged into main |
| Orphan commits (chore/learnings) | Ignore — they are integration artifacts, not feature work |
| Pending close | Run `close.md` for the indicated scope |
| dev behind origin/main | `git checkout dev && git merge origin/main --no-edit` |

### 2. Create a branch from `origin/main`

```bash
git fetch origin main
git checkout -b <type>/<slug> origin/main
```

**Naming convention:**
- `feature/<short-kebab-description>`
- `fix/<short-kebab-description>`
- `chore/<short-kebab-description>`

⚠️ **Never** from `dev`, local `main`, or another feature branch.
Branching from `dev` inherits commits from other features and causes heavy conflicts when merging into `main`.

### 3. Continue with the normal pipeline

- **feature/bugfix:** advance to Step 1/6 (`/spec-generator` or triage)
- **chore:** execute directly (`scope → execute → verify → close`)
