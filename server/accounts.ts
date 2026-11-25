import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response, NextFunction } from "express";
import { Router } from "express";
import { z } from "zod";
import { db } from "./database.js";
import { ServiceError } from "./services.js";
const derive = promisify(scrypt),
  sha = (s: string) => createHash("sha256").update(s).digest("hex");
const credentials = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(10).max(128),
});
const lifetime = 7 * 24 * 60 * 60 * 1000;
function cookie(req: Request) {
  return (
    req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("zhiyan_session="))
      ?.slice("zhiyan_session=".length) || ""
  );
}
export function currentUser(
  req: Request,
): { id: string; username: string } | undefined {
  const token = cookie(req);
  if (!/^[a-f0-9]{64}$/.test(token)) return undefined;
  return db
    .prepare(
      "SELECT users.id,users.username FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?",
    )
    .get(sha(token), Date.now()) as
    { id: string; username: string } | undefined;
}
export function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = currentUser(req);
  if (!user)
    return res
      .status(401)
      .json({ error: "请先登录，或重新登录已过期的会话。" });
  res.locals.user = user;
  next();
}
function session(req: Request, res: Response, userId: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash=? OR expires_at<?").run(
    sha(cookie(req)),
    Date.now(),
  );
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    sha(token),
    userId,
    Date.now() + lifetime,
  );
  res.cookie("zhiyan_session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: lifetime,
    path: "/",
  });
}
async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await derive(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
async function verify(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const actual = (await derive(password, salt, 64)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(hash, "hex"));
}
export const accountRoutes = Router();
const attempts = new Map<string, { count: number; until: number }>();
accountRoutes.use((req, _res, next) => {
  if (req.method === "GET" || req.path === "/logout") return next();
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  const keys = [
    `ip:${req.ip}`,
    `name:${String(req.body?.username || "")
      .toLowerCase()
      .slice(0, 32)}`,
  ];
  for (const key of keys) {
    const v = attempts.get(key) || { count: 0, until: now + 600000 };
    if (v.count >= 15)
      throw new ServiceError("登录或注册尝试过于频繁，请十分钟后重试。", 429);
    v.count++;
    attempts.set(key, v);
  }
  next();
});
accountRoutes.get("/me", (req, res) =>
  res.json({ user: currentUser(req) || null }),
);
accountRoutes.post("/register", async (req, res) => {
  const { username, password } = credentials.parse(req.body);
  if (db.prepare("SELECT id FROM users WHERE username=?").get(username))
    throw new ServiceError("该用户名已被使用。", 409);
  const id = randomUUID(),
    hash = await hashPassword(password);
  try {
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      id,
      username,
      hash,
      new Date().toISOString(),
    );
  } catch {
    throw new ServiceError("该用户名已被使用。", 409);
  }
  session(req, res, id);
  res.status(201).json({ user: { id, username } });
});
accountRoutes.post("/login", async (req, res) => {
  const { username, password } = credentials.parse(req.body);
  const user = db
    .prepare("SELECT * FROM users WHERE username=?")
    .get(username) as
    { id: string; username: string; password_hash: string } | undefined;
  const valid = await verify(
    password,
    user?.password_hash || `${"0".repeat(32)}:${"0".repeat(128)}`,
  );
  if (!user || !valid) throw new ServiceError("用户名或密码不正确。", 401);
  session(req, res, user.id);
  res.json({ user: { id: user.id, username: user.username } });
});
accountRoutes.post("/logout", (req, res) => {
  db.prepare("DELETE FROM sessions WHERE token_hash=?").run(sha(cookie(req)));
  res.clearCookie("zhiyan_session", {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE === "true",
  });
  res.json({ ok: true });
});
accountRoutes.post("/password", requireUser, async (req, res) => {
  const { currentPassword, newPassword } = z
    .object({
      currentPassword: z.string().min(1).max(128),
      newPassword: z.string().min(10).max(128),
    })
    .parse(req.body);
  const owner = res.locals.user.id;
  const row = db
    .prepare("SELECT password_hash FROM users WHERE id=?")
    .get(owner) as { password_hash: string };
  if (!(await verify(currentPassword, row.password_hash)))
    throw new ServiceError("当前密码不正确。", 400);
  const hash = await hashPassword(newPassword);
  const change = db
    .prepare("UPDATE users SET password_hash=? WHERE id=? AND password_hash=?")
    .run(hash, owner, row.password_hash);
  if (!change.changes) throw new ServiceError("密码已变更，请重新登录。", 409);
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(owner);
  session(req, res, owner);
  res.json({ ok: true });
});
