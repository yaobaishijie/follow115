import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadConfig } from "../config.js";

const migrationDir = join(dirname(fileURLToPath(import.meta.url)), "../../../../infra/postgres/migrations");
const { Client } = pg;

async function migrate(): Promise<void> {
  const client = new Client({ connectionString: loadConfig().databaseUrl });
  await client.connect();
  try {
    await client.query("CREATE TABLE IF NOT EXISTS app_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const migrations = (await readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort();
    for (const name of migrations) {
      const exists = await client.query("SELECT 1 FROM app_schema_migrations WHERE name = $1", [name]);
      if (exists.rowCount) continue;
      await client.query("BEGIN");
      try {
        await client.query(await readFile(join(migrationDir, name), "utf8"));
        await client.query("INSERT INTO app_schema_migrations(name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    }
  } finally { await client.end(); }
}
migrate().catch((error: unknown) => { console.error(error); process.exitCode = 1; });

