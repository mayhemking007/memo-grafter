import { existsSync } from "node:fs";
import path from "node:path";

const REQUIRED_INIT_FILES = [
  "src/memo-grafter/mg-schema",
  "src/memo-grafter/mg.config",
] as const;

export interface ProjectInitializationStatus {
  initialized: boolean;
  missing: string[];
}

export function getProjectInitializationStatus(cwd: string): ProjectInitializationStatus {
  const missing = REQUIRED_INIT_FILES
    .filter((fileBase) => !hasTypeScriptOrJavaScriptFile(cwd, fileBase))
    .map((fileBase) => `${fileBase}.ts`);

  return {
    initialized: missing.length === 0,
    missing,
  };
}

export function assertProjectInitialized(cwd: string): void {
  const status = getProjectInitializationStatus(cwd);
  if (status.initialized) return;

  throw new Error([
    "MemoGrafter is not initialized in this project.",
    "Run: npx memo-grafter init",
    `Missing: ${status.missing.join(", ")}`,
  ].join("\n"));
}

function hasTypeScriptOrJavaScriptFile(cwd: string, fileBase: string): boolean {
  return [".ts", ".js", ".mjs", ".cjs"].some((extension) =>
    existsSync(path.join(cwd, `${fileBase}${extension}`))
  );
}
