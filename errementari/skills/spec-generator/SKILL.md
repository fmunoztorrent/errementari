---
name: spec-generator
description: Generates a formal spec with REASONS Canvas and BDD scenarios (Gherkin .feature files). Entry point for SDD + BDD + SPDD. Use as STEP 1 of the feature pipeline.
disable-model-invocation: false
---

# Spec Generator (SDD + BDD + SPDD)

Generate a complete specification for a feature combining all three methodologies.

## When to use

STEP 1 of the feature pipeline, after `pre-spec.sh` passes and a branch is created.

## Input

The user's feature description (from `/task implement <description>`).

## Process

### 1. Generate REASONS Canvas (SPDD)

Run `/errementari:spdd-reasons-canvas` internally:
- R — Requirements: what problem, definition of done, scope
- E — Entities: domain model, relationships
- A — Approach: strategy, design decisions
- S — Structure: files to create/modify
- O — Operations: concrete implementation steps
- N — Norms: conventions and patterns
- S — Safeguards: constraints and boundaries

Save to: `spdd/prompt/<id>-canvas.md`

### 2. Generate formal spec (SDD)

Create `spec/<YYYY-MM-DD>-<kebab-slug>.spec.md`:

```markdown
# Spec: <title>
<!-- spec@id: <id>  spec@status: draft  spec@revision: 1 -->

## Meta
- **Created**: <YYYY-MM-DD>
- **Author**: pipeline agent
- **Type**: feature
- **BDD scenarios**: N

## User Stories

### US-01: <title>
**As a** <role>
**I want** <goal>
**So that** <benefit>

**Acceptance Criteria:**
1. Given <context> when <action> then <outcome>

## Dependencies between USTs
| UST | Depends on | Parallelizable? |
|-----|-----------|-----------------|
| US-01 | — | yes (layer 1) |

## REASONS Canvas
Reference: `spdd/prompt/<id>-canvas.md`

## Result
<!-- Filled at close -->
```

### 3. Generate BDD scenarios (BDD)

Create `.feature` files for each user story:

```gherkin
Feature: <feature name>
  As a <role>
  I want <goal>
  So that <benefit>

  Scenario: <scenario name>
    Given <precondition>
    When <action>
    Then <expected outcome>
```

Save to: `spec/<slug>.feature`

### 4. Map USTs → BDD scenarios

Add a traceability table to the spec:

```markdown
## Traceability: USTs → BDD scenarios
| UST | Scenario | Feature file | Expected result |
|-----|----------|-------------|-----------------|
| US-01 | <scenario name> | spec/<slug>.feature | <result> |
```

## Exit

- Announce the generated artifacts with their paths
- Proceed to architect validation (STEP 2)
