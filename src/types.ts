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

  workspaceDirs: Array<{ path: string; description: string }>;
  services: string[];
  frontendAppPath?: string;

  usesKafka: boolean;
  usesRedis: boolean;
  usesSSE: boolean;
  hasDocker: boolean;

  permCommands: string[];
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
