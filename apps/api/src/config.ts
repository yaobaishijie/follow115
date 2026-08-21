export interface Config {
  host: string;
  port: number;
  databaseUrl: string;
  logLevel: string;
  adminUsername: string;
  adminPassword: string;
  /** Required by loadConfig for production; optional only to keep isolated app tests minimal. */
  appEncryptionKey?: string;
}
export function loadConfig(env = process.env): Config {
  const port = Number(env.APP_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("APP_PORT must be a valid TCP port.");
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const adminUsername = env.ADMIN_USERNAME;
  const adminPassword = env.ADMIN_PASSWORD;
  const appEncryptionKey = env.APP_ENCRYPTION_KEY;
  if (!adminUsername || !adminPassword) throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD are required.");
  if (!appEncryptionKey) throw new Error("APP_ENCRYPTION_KEY is required.");
  return { host: env.APP_HOST ?? "0.0.0.0", port, databaseUrl, logLevel: env.APP_LOG_LEVEL ?? "info", adminUsername, adminPassword, appEncryptionKey };
}
