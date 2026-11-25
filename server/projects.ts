import { Router } from "express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { db, dataDir } from "./database.js";
import { projectSchema, type Project } from "../shared/schema.js";
import { csv, markdown } from "../src/export.js";
import { ServiceError } from "./services.js";
export const projectRoutes = Router();
function id(value: unknown) {
  return z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,100}$/)
    .parse(value);
}
const storage = resolve(dataDir, "objects");
await mkdir(storage, { recursive: true });
projectRoutes.get("/projects", (_req, res) => {
  const rows = db
    .prepare(
      "SELECT payload FROM projects WHERE user_id=? ORDER BY updated_at DESC",
    )
    .all(res.locals.user.id) as { payload: string }[];
  res.json(rows.map((r) => JSON.parse(r.payload)));
});
projectRoutes.put("/projects/:id", (req, res) => {
  const p = projectSchema.parse(req.body),
    userId = res.locals.user.id;
  if (p.id !== id(req.params.id))
    throw new ServiceError("项目标识不匹配。", 400);
  const existing = db
    .prepare("SELECT payload FROM projects WHERE user_id=? AND id=?")
    .get(userId, p.id) as { payload: string } | undefined;
  const revision = existing ? JSON.parse(existing.payload).revision || 0 : 0;
  if (p.revision !== revision)
    throw new ServiceError(
      "另一设备已更新此研究。请先下载本地备份，再刷新页面重新打开；当前修改未覆盖服务器。",
      409,
    );
  const total = db
    .prepare("SELECT COUNT(*) as n FROM projects WHERE user_id=?")
    .get(userId) as { n: number };
  if (total.n >= 100 && !existing)
    throw new ServiceError("最多保存 100 个项目，请导出后清理旧记录。", 409);
  const saved = { ...p, revision: revision + 1 };
  db.prepare(
    "INSERT INTO projects(id,user_id,payload,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
  ).run(p.id, userId, JSON.stringify(saved), p.updatedAt);
  res.json({ ok: true, revision: saved.revision });
});
projectRoutes.delete("/projects/:id", async (req, res) => {
  const projectId = id(req.params.id),
    userId = res.locals.user.id;
  const files = db
    .prepare("SELECT object_key FROM exports WHERE user_id=? AND project_id=?")
    .all(userId, projectId) as { object_key: string }[];
  db.prepare("DELETE FROM projects WHERE user_id=? AND id=?").run(
    userId,
    projectId,
  );
  db.prepare("DELETE FROM exports WHERE user_id=? AND project_id=?").run(
    userId,
    projectId,
  );
  for (const file of files)
    await unlink(resolve(storage, file.object_key)).catch(() => {});
  res.json({ ok: true });
});
projectRoutes.get("/exports", (_req, res) =>
  res.json(
    db
      .prepare(
        "SELECT id,project_id,filename,created_at FROM exports WHERE user_id=? ORDER BY created_at DESC",
      )
      .all(res.locals.user.id),
  ),
);
projectRoutes.post("/projects/:id/exports", async (req, res) => {
  const format = z.enum(["json", "csv", "md"]).parse(req.body.format),
    userId = res.locals.user.id,
    projectId = id(req.params.id);
  const row = db
    .prepare("SELECT payload FROM projects WHERE user_id=? AND id=?")
    .get(userId, projectId) as { payload: string } | undefined;
  if (!row) throw new ServiceError("研究项目不存在。", 404);
  const p = JSON.parse(row.payload) as Project,
    exportId = randomUUID(),
    filename = `研笺-${format === "json" ? "研究项目" : format === "csv" ? "证据表" : "研究简报"}.${format}`;
  const content =
    format === "json"
      ? JSON.stringify(p, null, 2)
      : format === "csv"
        ? csv(p)
        : markdown(p);
  const mime =
    format === "json"
      ? "application/json"
      : format === "csv"
        ? "text/csv;charset=utf-8"
        : "text/markdown;charset=utf-8";
  await writeFile(resolve(storage, exportId), content, "utf8");
  db.prepare("INSERT INTO exports VALUES(?,?,?,?,?,?,?)").run(
    exportId,
    userId,
    projectId,
    filename,
    exportId,
    mime,
    new Date().toISOString(),
  );
  res
    .status(201)
    .json({ id: exportId, url: `/api/exports/${exportId}`, filename });
});
projectRoutes.get("/exports/:id", (req, res) => {
  const row = db
    .prepare("SELECT * FROM exports WHERE id=? AND user_id=?")
    .get(id(req.params.id), res.locals.user.id) as
    { object_key: string; filename: string; mime: string } | undefined;
  if (!row) throw new ServiceError("文件不存在或无权访问。", 404);
  res.setHeader("Content-Type", row.mime);
  res.download(resolve(storage, row.object_key), row.filename);
});
