export function readDatabaseArgument(args: string[], command: string): string | undefined {
  let db: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument.startsWith("--db=")) {
      db = argument.slice("--db=".length);
      if (!db) throw new Error("--db requires a connection string.");
    } else if (argument === "--db") {
      db = args[index + 1];
      if (!db || db.startsWith("--")) {
        throw new Error("--db requires a connection string.");
      }
      index += 1;
    } else {
      throw new Error(`Unknown ${command} option: ${argument}`);
    }
  }

  return db;
}
