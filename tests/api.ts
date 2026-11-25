import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { emptyProject } from "../shared/schema.js";
const base = process.env.TEST_URL || "http://127.0.0.1:8787";
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = "",
) {
  return fetch(base + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function register(suffix: string) {
  const username = `api_${Date.now()}_${suffix}`,
    password = "Verification-12345!";
  const response = await request("/api/auth/register", "POST", {
    username,
    password,
  });
  assert.equal(response.status, 201);
  return {
    username,
    password,
    cookie: response.headers.get("set-cookie")!.split(";")[0],
  };
}
const results: string[] = [];
const a = await register("a"),
  b = await register("b");
assert.equal((await request("/api/projects")).status, 401);
const project = {
  ...emptyProject(),
  question: "权限隔离测试",
  query: "caffeine",
};
assert.equal(
  (await request("/api/projects/" + project.id, "PUT", project, a.cookie))
    .status,
  200,
);
assert.equal(
  (
    await request(
      "/api/projects/" + project.id,
      "PUT",
      { ...project, question: "过期设备修改" },
      a.cookie,
    )
  ).status,
  409,
);
const retained = await (
  await request("/api/projects", "GET", undefined, a.cookie)
).json();
assert.equal(retained[0].question, "权限隔离测试");
results.push("过期修订号返回 409，并保留服务器版本");
assert.equal(
  (await (await request("/api/projects", "GET", undefined, b.cookie)).json())
    .length,
  0,
);
assert.equal(
  (
    await request(
      `/api/projects/${project.id}/exports`,
      "POST",
      { format: "json" },
      b.cookie,
    )
  ).status,
  404,
);
const file = (await (
  await request(
    `/api/projects/${project.id}/exports`,
    "POST",
    { format: "json" },
    a.cookie,
  )
).json()) as { url: string };
assert.equal((await request(file.url, "GET", undefined, b.cookie)).status, 404);
assert.equal((await request(file.url)).status, 401);
assert.equal((await request(file.url, "GET", undefined, a.cookie)).status, 200);
await request(`/api/projects/${project.id}`, "DELETE", undefined, b.cookie);
assert.equal(
  (await (await request("/api/projects", "GET", undefined, a.cookie)).json())
    .length,
  1,
);
results.push(
  "账号 B 无法读取、删除账号 A 项目，也无法读取其导出文件；匿名请求被拒绝",
);
const badLogin = await request("/api/auth/login", "POST", {
  username: a.username,
  password: "Wrong-password-123!",
});
assert.equal(badLogin.status, 401);
const login = await request("/api/auth/login", "POST", {
  username: a.username,
  password: a.password,
});
assert.equal(login.status, 200);
const cookie2 = login.headers.get("set-cookie")!.split(";")[0];
assert.equal(
  (await (await request("/api/projects", "GET", undefined, cookie2)).json())
    .length,
  1,
);
await request("/api/auth/logout", "POST", {}, cookie2);
assert.equal(
  (await request("/api/projects", "GET", undefined, cookie2)).status,
  401,
);
results.push("密码错误拒绝登录；新会话恢复记录；退出撤销会话");
const csrf = await fetch(base + "/api/projects/" + project.id, {
  method: "DELETE",
  headers: { Origin: "https://evil.invalid", Cookie: a.cookie },
});
assert.equal(csrf.status, 403);
results.push("跨站写请求被拒绝");
assert.equal(
  (
    await request(
      "/api/projects/" + project.id,
      "PUT",
      { ...project, papers: [{ url: "javascript:alert(1)" }] },
      a.cookie,
    )
  ).status,
  400,
);
assert.equal(
  (
    await request(
      "/api/analyze",
      "POST",
      {
        question: "test",
        papers: [{ source: "MED", id: "https://evil.invalid" }],
      },
      a.cookie,
    )
  ).status,
  400,
);
results.push("非法导入与任意来源地址被拒绝");
await request("/api/projects/" + project.id, "DELETE", undefined, a.cookie);
assert.equal((await request(file.url, "GET", undefined, a.cookie)).status, 404);
results.push("删除研究同时撤销关联导出文件");
await mkdir("artifacts",{recursive:true});
await writeFile("artifacts/api-results.json", JSON.stringify(results, null, 2));
console.log(results.join("\n"));
