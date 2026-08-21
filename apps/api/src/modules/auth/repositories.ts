import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { Session, SessionStore, SingleUser, SingleUserRepository } from "./auth-service.js";

interface Queryable {
  query(query: string, values?: readonly unknown[]): Promise<unknown>;
}

export async function ensureInitialUser(
  pool: Queryable,
  username: string,
  passwordHash: string
): Promise<void> {
  await pool.query(
    "INSERT INTO app_users (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING",
    [username, passwordHash]
  );
}

export class PostgresSingleUserRepository implements SingleUserRepository {
  constructor(private readonly pool: Pool) {}
  async findByUsername(username: string): Promise<SingleUser | null> {
    const result = await this.pool.query<SingleUser>(
      "SELECT id, username, password_hash AS \"passwordHash\" FROM app_users WHERE username = $1 LIMIT 1", [username]
    );
    return result.rows[0] ?? null;
  }
}

export class EmptySingleUserRepository implements SingleUserRepository {
  async findByUsername(): Promise<SingleUser | null> { return null; }
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Durable login sessions; only a one-way token hash is persisted. */
export class PostgresSessionStore implements SessionStore {
  constructor(private readonly pool: Pool, private readonly ttlMs = 1000 * 60 * 60 * 24 * 7) {}

  async create(userId: string): Promise<Session> {
    const session = {
      token: randomBytes(32).toString("base64url"),
      userId,
      expiresAt: new Date(Date.now() + this.ttlMs)
    };
    await this.pool.query(
      "INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
      [tokenHash(session.token), session.userId, session.expiresAt]
    );
    return session;
  }

  async find(token: string): Promise<Session | null> {
    const hash = tokenHash(token);
    await this.pool.query("DELETE FROM app_sessions WHERE token_hash = $1 AND expires_at <= now()", [hash]);
    const result = await this.pool.query<{ userId: string; expiresAt: Date }>(
      "SELECT user_id AS \"userId\", expires_at AS \"expiresAt\" FROM app_sessions WHERE token_hash = $1 AND expires_at > now() LIMIT 1",
      [hash]
    );
    const row = result.rows[0];
    return row ? { token, userId: row.userId, expiresAt: row.expiresAt } : null;
  }

  async delete(token: string): Promise<void> {
    await this.pool.query("DELETE FROM app_sessions WHERE token_hash = $1", [tokenHash(token)]);
  }
}
