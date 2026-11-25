import { projectSchema, type Project } from "../shared/schema";
async function request(path: string, method = "GET", body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "服务端存储暂时不可用");
  return data;
}
const revisions = new Map<string, number>();
const pending = new Map<string, Promise<unknown>>();
export function resetStorageSession() {
  revisions.clear();
  pending.clear();
}
export async function saveProject(p: Project) {
  const prior = pending.get(p.id) || Promise.resolve();
  const task = prior
    .catch(() => {})
    .then(async () => {
      const result = await request(
        `/api/projects/${encodeURIComponent(p.id)}`,
        "PUT",
        {
          ...projectSchema.parse(p),
          revision: revisions.get(p.id) ?? p.revision,
        },
      );
      revisions.set(p.id, result.revision);
    });
  pending.set(p.id, task);
  try {
    await task;
  } finally {
    if (pending.get(p.id) === task) pending.delete(p.id);
  }
}
export async function listProjects(): Promise<Project[]> {
  const projects: Project[] = (await request("/api/projects")).map(
    (p: unknown) => projectSchema.parse(p),
  );
  for (const p of projects)
    if (!revisions.has(p.id)) revisions.set(p.id, p.revision);
  return projects;
}
export async function deleteProject(id: string) {
  await request(`/api/projects/${encodeURIComponent(id)}`, "DELETE");
}
export async function storedExport(p: Project, format: "json" | "md" | "csv") {
  await saveProject(p);
  const file = await request(
    `/api/projects/${encodeURIComponent(p.id)}/exports`,
    "POST",
    { format },
  );
  const a = document.createElement("a");
  a.href = file.url;
  a.download = file.filename;
  a.click();
}
