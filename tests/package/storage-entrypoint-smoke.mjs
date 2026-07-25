import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = mkdtempSync(path.join(tmpdir(), "memo-grafter-package-"));
const npmCli = process.env.npm_execpath;
assert(npmCli, "Run this smoke test through npm so npm_execpath is available");

const runNpm = (args, options) =>
  execFileSync(process.execPath, [npmCli, ...args], options);

try {
  const packResult = JSON.parse(runNpm(
    ["pack", "--json", "--ignore-scripts", "--pack-destination", fixtureRoot],
    { cwd: repositoryRoot, encoding: "utf8" },
  ));
  const packageFilename = packResult[0]?.filename;
  assert(packageFilename, "npm pack did not return a package filename");

  runNpm(["init", "-y"], {
    cwd: fixtureRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  runNpm(
    ["install", path.join(fixtureRoot, packageFilename), "--omit=optional", "--ignore-scripts"],
    { cwd: fixtureRoot, encoding: "utf8", stdio: "pipe" },
  );

  const packageJson = JSON.parse(readFileSync(
    path.join(fixtureRoot, "node_modules", "memo-grafter", "package.json"),
    "utf8",
  ));
  for (const providerSdk of ["@anthropic-ai/sdk", "@google/genai", "openai"]) {
    assert.equal(
      packageJson.peerDependenciesMeta?.[providerSdk]?.optional,
      true,
      `${providerSdk} must remain an optional peer dependency`,
    );
    assert.equal(
      existsSync(path.join(fixtureRoot, "node_modules", ...providerSdk.split("/"))),
      false,
      `${providerSdk} should not be installed in the storage-only fixture`,
    );
  }

  const storeModuleUrl = pathToFileURL(
    path.join(fixtureRoot, "node_modules", "memo-grafter", "dist", "store", "index.js"),
  ).href;
  const storeModule = await import(storeModuleUrl);
  assert.equal(typeof storeModule.PostgresGraphStore, "function");

  const memoGrafterCli = path.join(
    fixtureRoot,
    "node_modules",
    "memo-grafter",
    "dist",
    "cli",
    "index.js",
  );
  execFileSync(process.execPath, [memoGrafterCli, "init"], {
    cwd: fixtureRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  const migration = spawnSync(
    process.execPath,
    [
      memoGrafterCli,
      "migrate",
      "--db",
      "postgres://postgres:postgres@127.0.0.1:1/memo_grafter?connect_timeout=1",
    ],
    { cwd: fixtureRoot, encoding: "utf8" },
  );
  const migrationOutput = `${migration.stdout ?? ""}\n${migration.stderr ?? ""}`;
  assert.notEqual(migration.status, 0, "migration against a closed port should fail");
  assert.doesNotMatch(
    migrationOutput,
    /ERR_MODULE_NOT_FOUND|@anthropic-ai\/sdk|@google\/genai|Cannot find package ['"]openai/,
    migrationOutput,
  );

  process.stdout.write("storage-only package entrypoint smoke test passed\n");
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
