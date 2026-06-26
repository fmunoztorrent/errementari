# Close checklist

Run **immediately** when the last todo of a scope is marked `completed`.

## Steps

> **Precondition:** Step **5b/7 Empirical Validation** (`.opencode/pipeline/validate-empirica.md`) must have run and passed all checks before starting the close. If 5b failed, the pipeline went back to QA RED and you must NOT close.
> 
> **TDD precondition:** If the REFACTOR step (step 6) was not executed, verify mutation score >= 80% or document why it was skipped.
> 
> **BDD precondition:** Verify all Gherkin scenarios from `.feature` files pass. If any scenario is pending/undefined, do NOT close.

### 1. Update spec (if applicable)

- Find the related spec in `spec/` by date/subject
- Add entries under `<result>`:
  - `<completed-at>`: completion date
  - `<implemented>`: completed USTs with `[x]`
  - `<bdd-scenarios>`: count of BDD scenarios passing/failing
  - `<mutation-score>`: final mutation score
  - `<deviations>`: if any
  - `<tests>`: results summary
- Change `spec@status` from `draft` to `completed`
- Set `<meta>/<archived>` to `true`
- Increment `spec@revision` and add a `<revision>` entry to `<history>`
- **Move the file** from `spec/<file>.spec.md` to `spec/archived/<file>.spec.md`
- **Update `spec/registry.json`** — mark the spec as `completed`
- If there is no associated spec, skip this step

### 2. Merge current branch into local `dev` (integration)

> **⚠️ `dev` is permanent.** The `dev` branch is **never** deleted. When cleaning
> branches after a consolidation, only feature/bugfix/chore branches are deleted;
> `dev` and `main` are always preserved.

- **Goal:** integrate the current branch into the local `dev` branch as an early
  integration point, before the PR enters review.
- Run the helper: `.opencode/pipeline/merge-to-dev.sh`
- The script takes care of:
  - If the current branch is `main` or `dev`: do nothing (avoids a noop).
  - If `dev` does not exist: create it from `main` (`git branch dev main`).
  - If `dev` exists: `git merge --no-ff` the current branch into `dev`.
  - On conflict: aborts the merge (`git merge --abort`) and returns exit 2.
- **⛔ If `merge-to-dev.sh` returns exit 2 (conflict): STOP — do not continue to
  step 2b or 3.** Resolve the conflict first, then resume from this step.
- When it finishes without conflict, the worktree returns to the original branch automatically.
- **Local only:** this step does not `git push`. Pushing happens when you decide
  to sync the remote (not done by default at close).
- If the work was done directly on `main` without a spec, skip this step.

### 2b. Verify PR coverage (captured commits)

> This step prevents orphan commits in `dev` — the problem where work done
> post-merge never reaches a PR.

```bash
git log origin/main..HEAD --no-merges --oneline
```

- If the list is **empty**: there is nothing new to push — the PR is unnecessary
  (integration-only changes), skip to step 3 and omit the push.
- If the list has commits: **confirm they are all related to this feature**.
  - If there are commits that should not be on this branch (e.g. made on `dev`
    instead of the feature branch): **STOP** — move those commits to the right
    branch before creating the PR.
- Mentally note the commits to verify the PR includes them all.

### 3. Create Pull Request

- If the work was done on an ad-hoc branch (not `main`):
  - `git push -u origin HEAD`
  - Open a PR on GitHub/GitLab using `gh` or the browser
  - Make sure the PR targets `main` (not `dev` — `dev` is local integration only)
- If the work was done directly on `main` (trivial changes only, no spec), skip this step
- Do not merge the PR yet — mark it "ready for review"

### 3b. Post-merge: sync dev with main

Run **after the PR is merged into `main`** (immediately or deferred):

```bash
git fetch origin main
git checkout dev
git merge origin/main --no-edit
```

Then verify no orphan commits remain:

```bash
git log origin/main..dev --no-merges --oneline
```

- If the list is **empty**: dev is clean. ✓
- If there are feature/fix commits: they are orphans — create an additional PR to capture them.
- If there are chore/learnings commits (archiving specs, auto-update hooks): they are
  legitimate integration artifacts, no additional PR required.

### 4. LEARNINGS.md entry

- Open `.claude/LEARNINGS.md`
- Append an entry using the standard template:

```markdown
---
date: YYYY-MM-DD
agent: agent-type
category: setup | pattern | api-gotcha | test-strategy | security-finding | spec-process | user-feedback
tags: [tag1, tag2]
slug: short-kebab-case-description
---

**Context**: what I was doing when I discovered it.
**What happened**: the surprising behavior, the error, or the decision.
**Lesson**: what to do / not do in the future.
**How to apply**: in which specific situations to remember this.
```

- Ask the user if they want to add anything
- Only add an entry if there is a non-obvious lesson

### 4b. Extract learning to agent skill

- Run the automatic extraction: `npx tsx scripts/extract-learnings.ts`
- This reads the latest LEARNINGS.md entry and updates the corresponding skill in `.claude/skills/{agent}-learnings/SKILL.md`
- If a lesson appears a second time, the script automatically promotes it to "Active rules"
- If a lesson appears a third time, the script adds it to "Blocking action items" in `.claude/AGENTS.md`
- The extraction also runs automatically via the plugin's and Claude Code's hooks. This manual step is a fallback.

### 4c. Post-close self-improvement (Step 7)

Step 4b runs `extract-learnings.ts`, which implements 3 levels of automatic
learning promotion:

| Level | Condition | Action | Affected file |
|-------|-----------|--------|-----------------|
| **1** | 1st occurrence of a slug | Adds to "Recent lessons" | `.claude/skills/{agent}-learnings/SKILL.md` |
| **2** | 2nd occurrence (≥2) | Moves to "Active rules" with `(x2,)` marker | `.claude/skills/{agent}-learnings/SKILL.md` |
| **3** | 3rd occurrence (≥3) | Adds to "Blocking action items" | `.claude/AGENTS.md` |

After running `npx tsx scripts/extract-learnings.ts`, review the output:

- If the output mentions **"level 3"** or **"AGENTS.md"**: check `.claude/AGENTS.md`
  to confirm the entry was added correctly to the
  `## Blocking action items (Level 3 — Auto-generated)` table.
- If the output mentions **"level 2"** or **"Active rules"**: check the corresponding
  skill in `.claude/skills/{agent}-learnings/SKILL.md`.
- If the output mentions **"level 1"**: it is a new lesson, no further action.

Commit the generated changes (updated skills + `AGENTS.md` if applicable).
If there were no promotions (output "nothing to do" or "skipping"), this step produces no changes.

The pipeline gets stricter with every error that repeats 3 times:
the blocking action items table serves as a reference for future agents and
can be integrated into automatic validations.

### 6. Review CLAUDE.md

- Did anything change in the project structure?
- New commands to document?
- New conventions or patterns?
- New skills configured?
- Update only if relevant

### 7. Clean up close-pending

- **Delete** `.opencode/pipeline/close-pending.json`:
  ```bash
  rm -f .opencode/pipeline/close-pending.json
  git add .opencode/pipeline/close-pending.json
  ```
- The close history stays in git (the commit that deletes the file) — the JSON does not need preserving.
- Set `completed_at` in state.json for the closed scope.

### 8. Announce close

```
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  Close completed · <scope>
  Spec: updated | not applicable
  Merge to dev: OK | not applicable | conflict|reported to user
  PR: open | not applicable
  LEARNINGS.md: entry added | no changes
  CLAUDE.md: updated | no changes
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```
