import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
const base = process.env.TEST_URL || "http://127.0.0.1:8795";
const live = process.env.LIVE_AI === "1";
const b = await chromium.launch(),
  pg = await b.newPage();
const fixture = JSON.parse(
  await readFile("tests/fixtures/papers.json", "utf8"),
);
const items = fixture.items.slice(0, 2);
items[1].abstract = "";
let requests = 0;
try {
  await pg.request.post(base + "/api/auth/register", {
    data: {
      username: "translation_" + Date.now(),
      password: "Test-Translation-2026!",
    },
  });
  const absent = await pg.request.post(base + "/api/translate", {
    data: {
      items: [{ key: items[0].key, field: "title", text: items[0].title }],
    },
  });
  assert.equal(absent.status(), 409);
  const key = live
    ? process.env.DEEPSEEK_API_KEY
    : "synthetic-translation-only";
  if (!key) throw new Error("缺少测试账号的真实密钥");
  const config = await pg.request.put(base + "/api/settings/ai", {
    data: { key, model: process.env.DEEPSEEK_MODEL || "deepseek-flash" },
  });
  assert.equal(config.status(), 200);
  await pg.route("**/api/search", (r) =>
    r.fulfill({
      contentType: "application/x-ndjson",
      body:
        JSON.stringify({
          result: {
            items: items,
            total: 2,
            received: 2,
            concepts: [],
            nextCursor: null,
            query: "quercetin",
          },
        }) + "\n",
    }),
  );
  if (!live)
    await pg.route("**/api/translate", (r) =>
      r.fulfill({
        json: {
          items: r
            .request()
            .postDataJSON()
            .items.map((v: { key: string; field: string }) => ({
              ...v,
              zh: v.field === "title" ? "标题翻译测试" : "摘要翻译测试",
            })),
        },
      }),
    );
  pg.on("request", (r) => {
    if (r.url().endsWith("/api/translate")) requests++;
  });
  await pg.goto(base);
  await pg.locator("#query").fill("quercetin");
  await pg.getByRole("button", { name: "开始检索", exact: true }).click();
  await pg.getByRole("button", { name: "翻译标题（2 篇）" }).click();
  await pg
    .locator(".translation-original")
    .first()
    .waitFor({ timeout: 145000 });
  assert.equal(await pg.locator(".translation-original").count(), 2);
  assert.match(
    await pg.locator(".paper-title").first().innerText(),
    /[\u3400-\u9fff]/,
  );
  await pg.getByRole("button", { name: "查看摘要与备注" }).first().click();
  await pg.getByRole("button", { name: "翻译为简体中文" }).click();
  await pg.locator(".translated-abstract p").waitFor({ timeout: 145000 });
  const zh = await pg.locator(".translated-abstract p").innerText();
  assert.match(zh, /[\u3400-\u9fff]/);
  assert.equal(
    await pg.locator(".full-abstract").innerText(),
    items[0].abstract,
  );
  assert.equal(requests, 2);
  await mkdir("artifacts/translation-preview", { recursive: true });
  await pg.screenshot({
    path: "artifacts/translation-preview/摘要中外文对照.png",
  });
  await pg.keyboard.press("Escape");
  await pg.getByText("已同步到账号", { exact: true }).waitFor();
  await pg.reload();
  await pg.getByRole("button", { name: "文献工作台", exact: true }).click();
  await pg.getByRole("button", { name: "查看摘要与备注" }).first().click();
  assert.equal(await pg.locator(".translated-abstract p").innerText(), zh);
  assert.equal(requests, 2);
  await pg.keyboard.press("Escape");
  await pg.getByRole("button", { name: "查看摘要与备注" }).nth(1).click();
  assert.equal(await pg.locator(".translated-abstract").count(), 0);
  assert.equal(
    await pg.locator(".full-abstract").innerText(),
    "当前来源未提供摘要。",
  );
  console.log(
    "通过：未配置密钥拒绝生成、两篇标题、单篇摘要、原文保留、刷新复用、无摘要提示。模型模式：" +
      (live ? "真实 DeepSeek" : "模拟"),
  );
} finally {
  await pg.request.delete(base + "/api/settings/ai").catch(() => {});
  await b.close();
}
