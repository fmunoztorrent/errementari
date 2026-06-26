---
name: spdd-sync
description: Synchronizes code-side changes (refactoring, bug fixes) back into the REASONS Canvas so the prompt stays an accurate record of the current code. Use after every refactor step and at pipeline close.
disable-model-invocation: false
---

# SPDD Sync

Synchronize code changes back to the REASONS Canvas.

## When to use

- **After refactoring** (STEP 6 in feature pipeline): code was improved without changing behavior → sync the structural changes
- **At pipeline close** (STEP 7b): final sync to ensure Canvas matches the committed code exactly
- **After any manual code fix** that was done outside `/errementari:spdd-generate`

## Input

- The Canvas file: `spdd/prompt/<id>-canvas.md`
- The current code (post-changes)
- Git diff showing what changed

## Process

### 1. Detect changes

Compare Canvas Operations with actual code:
- Methods that were renamed, moved, or had their signature changed
- New files created during refactoring
- Files deleted or merged
- Constants extracted from magic numbers

### 2. Categorize changes

| Change type | SPDD action |
|-------------|-------------|
| **Renamed method/symbol** | Update Operation signatures, Entity names |
| **Moved file** | Update Structure section paths |
| **Extracted constant/config** | Add to Norms if reusable |
| **New validation/guard** | Add to Safeguards if it constrains behavior |
| **Deleted code** | Remove corresponding Operations |
| **Logic correction** | Flag — should have gone through spdd-prompt-update first |

### 3. Update the Canvas

Apply changes ONLY to affected sections:
- **E — Entities**: rename, add, or remove entities
- **S — Structure**: update file paths
- **O — Operations**: update method signatures, add/remove operations
- **N — Norms**: add extracted patterns
- **S — Safeguards**: add new constraints

**Do NOT modify**: R (Requirements), A (Approach) — these are intent, not code structure.

### 4. Verify consistency

After sync, verify:
- Every file in Structure exists in the codebase
- Every Operation maps to a real method
- Every Entity matches the actual class/interface
- No Operations reference deleted code

## Exit

- Canvas updated and committed
- Announce: `── SPDD Sync complete · <N> sections updated · Canvas = code ──`
