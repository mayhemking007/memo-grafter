#!/usr/bin/env node
import { runInit } from "./commands/init.js";
import { runMigrate } from "./commands/migrate.js";
import { logger } from "./utils/logger.js";

const [, , command, ...args] = process.argv;

try {
  if (command === "init") {
    await runInit();
  } else if (command === "migrate") {
    await runMigrate({ db: readFlag(args, "--db") });
  } else {
    printHelp();
    process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function readFlag(args: string[], flag: string): string | undefined {
  const equalsValue = args.find((arg) => arg.startsWith(`${flag}=`));
  if (equalsValue) return equalsValue.slice(flag.length + 1);

  const index = args.indexOf(flag);
  if (index >= 0) return args[index + 1];

  return undefined;
}

function printHelp(): void {
  logger.info(`MemoGrafter CLI

Usage:
  memo-grafter init
  memo-grafter migrate [--db <connection-string>]
`);
}
