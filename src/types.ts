export interface ProjectContext {
  name: string;
  slug: string;
  description: string;

  isNode: boolean;
  isTypeScript: boolean;
  isPython: boolean;
  isGo: boolean;

  hasBackend: boolean;
  hasFrontend: boolean;
  monorepo: boolean;
  usesHexagonalArchitecture: boolean;

  packageManager: string;
  backendFramework?: string;
  frontendFramework?: string;

  testCommand: string;
  buildCommand: string;
  lintCommand: string;
  typecheckCommand: string;

  usesMutationTesting: boolean;
  mutationTestCommand: string;

  workspaceDirs: Array<{ path: string; description: string; name: string }>;
  services: string[];
  frontendAppPath?: string;

  usesKafka: boolean;
  usesRedis: boolean;
  usesSSE: boolean;
  hasDocker: boolean;
  hasFirebase: boolean;
  usesVite: boolean;
  usesBDD: boolean;

  permCommands: string[];

  selectedCLIs: string[];
}

export interface ManifestEntry {
  type: "generic" | "template" | "stub" | "static";
  hash?: string;
  originalHash?: string;
  version?: string;
}

export interface Manifest {
  version: string;
  installed_at: string;
  files: Record<string, ManifestEntry>;
}

export type HarnessCategory = "harness-owned" | "custom" | "stub" | "unknown";

export interface HarnessFile {
  path: string;
  category: HarnessCategory;
  matchesTemplate?: string;
  hasContent: boolean;
}

export interface ExistingHarness {
  files: HarnessFile[];
  hasClaudeMd: boolean;
  hasOpencodeDir: boolean;
  hasClaudeDir: boolean;
  hasClaudeIgnore: boolean;
  hasSettingsJson: boolean;
  hasSettingsLocalJson: boolean;
  customAgents: string[];
  harnessAgents: string[];
}

export type MergeAction = "merge" | "keep" | "overwrite" | "skip";

export interface ReconciliationResult {
  claudeMdAction: MergeAction;
  agentActions: Record<string, MergeAction>;
  ignoredFiles: string[];
  backupPaths: string[];
  aborted: boolean;
}

export interface ReconciliationOptions {
  interactive: boolean;
  dryRun?: boolean;
}
