import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { prisma } from "./db.ts";

const COOKIE = "lidlr_session";
const SESSION_DAYS = 30;
const CODE_TTL_MS = 15 * 60 * 1000;

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

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function hashCode(code: string): string {
  return createHmac("sha256", secret()).update(code.toUpperCase().trim()).digest("hex");
}

export function generateCode(): string {
  return String(randomBytes(3).readUIntBE(0, 3) % 1000000).padStart(6, "0");
}

export async function issueLoginCode(email: string): Promise<string> {
  const user = await prisma.user.upsert({ where: { email }, update: {}, create: { email } });
  await prisma.loginToken.deleteMany({ where: { userId: user.id, usedAt: null } });
  const code = generateCode();
  await prisma.loginToken.create({
    data: { userId: user.id, codeHash: hashCode(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });
  return code;
}

export async function verifyLoginCode(email: string, code: string): Promise<number | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  const token = await prisma.loginToken.findFirst({
    where: { userId: user.id, codeHash: hashCode(code), usedAt: null, expiresAt: { gt: new Date() } },
  });
  if (!token) return null;
  await prisma.loginToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
  return user.id;
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

export async function getTheme(): Promise<"light" | "dark"> {
  const jar = await cookies();
  return jar.get("lidlr_theme")?.value === "dark" ? "dark" : "light";
}
