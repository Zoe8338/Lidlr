import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { prisma } from "./db";

const COOKIE = "lidlr_session";
const SESSION_DAYS = 30;

let cachedSecret: Buffer | null = null;

function secret(): Buffer {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.AUTH_SECRET;
  if (fromEnv) {
    cachedSecret = Buffer.from(fromEnv, "utf8");
    return cachedSecret;
  }
  const dataDir = path.resolve(process.env.DATA_DIR || "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "auth-secret");
  if (fs.existsSync(file)) {
    cachedSecret = Buffer.from(fs.readFileSync(file, "utf8"), "utf8");
    return cachedSecret;
  }
  const generated = randomBytes(32).toString("hex");
  fs.writeFileSync(file, generated, { mode: 0o600 });
  cachedSecret = Buffer.from(generated, "utf8");
  return cachedSecret;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export async function startSession(userId: number) {
  const exp = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  const payload = `${userId}.${exp}`;
  const token = `${payload}.${sign(payload)}`;
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.FORCE_INSECURE_COOKIES !== "1",
    maxAge: SESSION_DAYS * 24 * 3600,
    path: "/",
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export function parseSessionToken(token: string | undefined): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, mac] = parts;
  if (sign(`${userId}.${exp}`) !== mac) return null;
  if (Number(exp) < Date.now()) return null;
  const id = Number(userId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function currentUser() {
  const jar = await cookies();
  const id = parseSessionToken(jar.get(COOKIE)?.value);
  if (!id) return null;
  return prisma.user.findUnique({ where: { id } });
}
