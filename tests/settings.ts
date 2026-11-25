import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const base = process.env.TEST_URL || "http://127.0.0.1:8793";
const browser = await chromium.launch();
const pg = await browser.newPage();
const other = await browser.newContext();
try {
  const username = "settings_" + Date.now(),
    password = "Test-passphrase-2026!",
    updated = "New-passphrase-2026!";
  await pg.goto(base);
  await pg.getByRole("button", { name: "还没有账号？创建账号" }).click();
  await pg.getByLabel("用户名", { exact: true }).fill(username);
  await pg.getByLabel("密码", { exact: true }).fill(password);
  await pg.getByRole("button", { name: "创建账号", exact: true }).click();
  await pg.getByRole("heading", { name: "使用说明" }).waitFor();
  assert.equal(await pg.locator("#query").inputValue(), "");
  assert.equal(await pg.locator("#question").inputValue(), "");
  assert.deepEqual(
    await (await pg.request.get(base + "/api/projects")).json(),
    [],
  );
  assert.doesNotMatch(
    await pg.locator("main").innerText(),
    /槲皮素|快照|咖啡因/,
  );
  await pg
    .getByRole("button", { name: "个人设置", exact: true })
    .first()
    .click();
  await pg.getByLabel("昵称", { exact: true }).fill("药学同学");
  await pg.getByLabel("研究方向").fill("文献综述");
  await pg.getByRole("button", { name: "保存资料" }).click();
  await pg.getByText("资料已保存。").waitFor();
  const key = "synthetic-settings-key";
  await pg.getByLabel("API 密钥", { exact: true }).fill(key);
  await pg.getByRole("button", { name: "保存 AI 设置" }).click();
  await pg.getByText(/下次使用 AI 时会验证/).waitFor();
  assert.equal(
    await pg.getByLabel("API 密钥", { exact: true }).inputValue(),
    "",
  );
  const pref = await (await pg.request.get(base + "/api/settings")).json();
  assert.equal(pref.aiConfigured, true);
  assert.equal(pref.nickname, "药学同学");
  assert.ok(!JSON.stringify(pref).includes(key));
  await other.request.post(base + "/api/auth/register", {
    data: { username: username + "b", password },
  });
  assert.equal(
    (await (await other.request.get(base + "/api/settings")).json())
      .aiConfigured,
    false,
  );
  assert.equal(
    (
      await other.request.post(base + "/api/query", {
        data: { question: "research question" },
      })
    ).status(),
    409,
  );
  await pg.getByRole("button", { name: "清除密钥" }).click();
  await pg.getByText("已清除个人密钥。").waitFor();
  assert.equal(
    (await (await pg.request.get(base + "/api/settings")).json()).aiConfigured,
    false,
  );
  await other.request.post(base + "/api/auth/login", {
    data: { username, password },
  });
  await pg.getByLabel("当前密码").fill(password);
  await pg.getByLabel("新密码", { exact: true }).fill(updated);
  await pg.getByLabel("确认新密码").fill(updated);
  await pg.getByRole("button", { name: "修改密码" }).click();
  await pg.getByText(/其他设备需要重新登录/).waitFor();
  assert.equal((await other.request.get(base + "/api/projects")).status(), 401);
  assert.equal(
    (
      await other.request.post(base + "/api/auth/login", {
        data: { username, password },
      })
    ).status(),
    401,
  );
  assert.equal(
    (
      await other.request.post(base + "/api/auth/login", {
        data: { username, password: updated },
      })
    ).status(),
    200,
  );
  await mkdir("artifacts/settings-preview", { recursive: true });
  await pg.screenshot({
    path: "artifacts/settings-preview/个人设置.png",
    fullPage: true,
  });
  await pg.getByRole("button", { name: "开始研究", exact: true }).click();
  await pg.screenshot({
    path: "artifacts/settings-preview/首次使用.png",
    fullPage: true,
  });
  console.log(
    "新账号空库、说明、个人资料、密钥保存/隔离/清除、密码轮换与旧会话撤销全部通过",
  );
} finally {
  await browser.close();
}
