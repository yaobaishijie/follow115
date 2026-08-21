import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { AppError } from "@follow115/contracts";

const scrypt = promisify(scryptCallback);
const keyLength = 64;

export interface SingleUser { id: string; username: string; passwordHash: string; }
export interface SingleUserRepository { findByUsername(username: string): Promise<SingleUser | null>; }
export interface Session { token: string; userId: string; expiresAt: Date; }
export interface SessionStore {
  create(userId: string): Promise<Session>;
  find(token: string): Promise<Session | null>;
  delete(token: string): Promise<void>;
}

export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString("base64url");
    const derived = await scrypt(password, salt, keyLength) as Buffer;
    return `scrypt$${salt}$${derived.toString("base64url")}`;
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    const [algorithm, salt, stored] = encoded.split("$");
    if (algorithm !== "scrypt" || !salt || !stored) return false;
    try {
      const expected = Buffer.from(stored, "base64url");
      const derived = await scrypt(password, salt, expected.length) as Buffer;
      return expected.length === derived.length && timingSafeEqual(expected, derived);
    } catch { return false; }
  }
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly ttlMs = 1000 * 60 * 60 * 24 * 7) {}
  async create(userId: string): Promise<Session> {
    const session = { token: randomBytes(32).toString("base64url"), userId, expiresAt: new Date(Date.now() + this.ttlMs) };
    this.sessions.set(session.token, session);
    return session;
  }
  async find(token: string): Promise<Session | null> {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= new Date()) { this.sessions.delete(token); return null; }
    return session;
  }
  async delete(token: string): Promise<void> { this.sessions.delete(token); }
}

export class AuthService {
  constructor(private readonly users: SingleUserRepository, private readonly sessions: SessionStore, private readonly passwords = new PasswordHasher()) {}
  async login(username: string, password: string): Promise<Session> {
    const user = await this.users.findByUsername(username);
    if (!user || !(await this.passwords.verify(password, user.passwordHash))) {
      throw new AppError("UNAUTHENTICATED", "Invalid username or password.");
    }
    return this.sessions.create(user.id);
  }
  async requireSession(token: string | undefined): Promise<Session> {
    const session = token ? await this.sessions.find(token) : null;
    if (!session) throw new AppError("UNAUTHENTICATED", "A valid session is required.");
    return session;
  }
  async logout(token: string | undefined): Promise<void> {
    await this.requireSession(token);
    await this.sessions.delete(token!);
  }
}
