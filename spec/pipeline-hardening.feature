Feature: Pipeline Hardening
  As a developer using Errementari
  I want the init process to produce a fully functional harness
  So that pipeline scripts work without manual intervention

  Background:
    Given Errementari v2.0.0 source is available at a known path
    And a target project exists with package.json and TypeScript config

  Scenario: init copies pipeline instructional .md files
    When I run "errementari init /tmp/test-project -y"
    Then ".opencode/pipeline/start.md" exists with pipeline start instructions
    And ".opencode/pipeline/close.md" exists with close checklist
    And ".opencode/pipeline/validate-empirica.md" exists

  Scenario: init installs errementari plugin from local checkout
    Given errementari is NOT available on the public npm registry
    When I run "errementari init /tmp/test-project -y"
    Then ".opencode/node_modules/errementari/pipeline/pre-spec.sh" exists

  Scenario: Vite project CLAUDE.md documents noEmit convention
    Given the target project has "vite.config.ts"
    When I run "errementari init /tmp/test-project -y"
    Then CLAUDE.md contains the text "tsc is typecheck-only" or "noEmit"

  Scenario: SSG project CLAUDE.md documents import.meta.glob pattern
    Given the target project has "vite-react-ssg" in devDependencies
    When I run "errementari init /tmp/test-project -y"
    Then CLAUDE.md contains the text "import.meta.glob"

  Scenario: init creates empty coordination state file
    When I run "errementari init /tmp/test-project -y"
    Then ".opencode/pipeline/coordination.json" exists with "{}"

  Scenario: wrapper error message suggests local install path
    Given the errementari plugin is NOT installed in node_modules
    When a pipeline wrapper script runs
    Then the error message mentions "npm link" or a local install path
