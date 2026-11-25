import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Router } from "express";
import { z } from "zod";
import { dataDir, db } from "./database.js";
import { ServiceError } from "./services.js";

db.exec(`CREATE TABLE IF NOT EXISTS preferences (
 owner TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 nickname TEXT NOT NULL DEFAULT '', focus TEXT NOT NULL DEFAULT '',
 model TEXT NOT NULL DEFAULT 'deepseek-flash', secret TEXT NOT NULL DEFAULT ''
)`);
type Preferences = {
  nickname: string;
  focus: string;
  model: string;
  secret: string;
};
function prefs(owner: string): Preferences {
  return (
    (db
      .prepare(
        "SELECT nickname,focus,model,secret FROM preferences WHERE owner=?",
      )
      .get(owner) as Preferences | undefined) ?? {
      nickname: "",
      focus: "",
      model: "deepseek-flash",
      secret: "",
    }
  );
}
function master() {
  const configured = process.env.YANJIAN_MASTER_KEY;
  if (configured) {
    if (!/^[a-fA-F0-9]{64}$/.test(configured))
      throw new ServiceError("服务端加密配置无效。", 503);
    return Buffer.from(configured, "hex");
  }
  const path = join(dataDir, "ai-master.key");
  try {
    return readFileSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const key = randomBytes(32);
  writeFileSync(path, key, { flag: "wx", mode: 0o600 });
  return key;
}
function seal(owner: string, secret: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", master(), iv);
  cipher.setAAD(Buffer.from(owner));
  const value = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), value]
    .map((x) => x.toString("base64"))
    .join(".");
}
export function personalAI(owner: string) {
  const settings = prefs(owner);
  if (!settings.secret)
    throw new ServiceError(
      "请在个人设置中配置自己的 DeepSeek API 密钥，或继续手工整理。",
      409,
    );
  const [iv, tag, body] = settings.secret
    .split(".")
    .map((x) => Buffer.from(x, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", master(), iv);
  decipher.setAAD(Buffer.from(owner));
  decipher.setAuthTag(tag);
  return {
    key: Buffer.concat([decipher.update(body), decipher.final()]).toString(),
    model: settings.model,
  };
}
function publicPrefs(owner: string) {
  const { secret, ...rest } = prefs(owner);
  return { ...rest, aiConfigured: !!secret };
}
export const settingsRoutes = Router();
settingsRoutes.get("/", (_req, res) =>
  res.json(publicPrefs(res.locals.user.id)),
);
settingsRoutes.put("/profile", (req, res) => {
  const owner = res.locals.user.id;
  const { nickname, focus } = z
    .object({
      nickname: z.string().trim().max(48),
      focus: z.string().trim().max(240),
    })
    .parse(req.body);
  db.prepare(
    "INSERT INTO preferences(owner,nickname,focus) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET nickname=excluded.nickname,focus=excluded.focus",
  ).run(owner, nickname, focus);
  res.json(publicPrefs(owner));
});
settingsRoutes.put("/ai", (req, res) => {
  const owner = res.locals.user.id;
  const { key, model } = z
    .object({
      key: z.string().trim().min(8).max(512).optional(),
      model: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9._-]{1,100}$/),
    })
    .parse(req.body);
  const secret = key ? seal(owner, key) : prefs(owner).secret;
  if (!secret) throw new ServiceError("请先填写 API 密钥。", 400);
  db.prepare(
    "INSERT INTO preferences(owner,model,secret) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET model=excluded.model,secret=excluded.secret",
  ).run(owner, model, secret);
  res.json(publicPrefs(owner));
});
settingsRoutes.delete("/ai", (_req, res) => {
  db.prepare("UPDATE preferences SET secret='' WHERE owner=?").run(
    res.locals.user.id,
  );
  res.json(publicPrefs(res.locals.user.id));
});
