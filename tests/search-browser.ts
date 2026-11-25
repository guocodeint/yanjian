import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import type { Paper } from "../shared/schema.js";
const base = process.env.TEST_URL || "http://127.0.0.1:8939",
  browser = await chromium.launch(),
  p = await browser.newPage(),
  checks: string[] = [];
try {
  const paper = (
    JSON.parse(await readFile("tests/fixtures/papers.json", "utf8"))
      .items as Paper[]
  )[0];
  const sample = (id: string, score: number, position: number) => ({
    ...paper,
    id,
    key: "MED:" + id,
    title: "文献 " + id,
    url: "https://europepmc.org/article/MED/" + id,
    rank: { score, sourceRank: position, reasons: ["题名命中 · sleep"] },
  });
  await p.request.post(base + "/api/auth/register", {
    data: { username: "paging_" + Date.now(), password: "Paging-test-12345" },
  });
  await p.goto(base);
  let step = 0;
  await p.route("**/api/search", async (route) => {
    const args = route.request().postDataJSON();
    const a = sample("101", 55, 1),
      b = sample("102", 90, 2),
      c = sample("103", 99, 3);
    const items = step === 0 ? [b, a] : step === 1 ? [c, a] : [];
    if (step === 1) {
      assert.equal(args.cursor, "page2");
      assert.equal(args.offset, 2);
      assert.equal(args.from, "2020");
    }
    const events = [0, 1, 2, 3, 4].map((stage) =>
      JSON.stringify({
        event: { stage, detail: "测试事件", at: new Date().toISOString() },
      }),
    );
    step++;
    await route.fulfill({
      contentType: "application/x-ndjson",
      body:
        [
          ...events,
          JSON.stringify({
            result: {
              items,
              total: items.length ? 3 : 0,
              received: items.length,
              query: args.query,
              nextCursor: step === 1 ? "page2" : null,
              concepts: [],
            },
          }),
        ].join("\n") + "\n",
    });
  });
  await p.locator("#query").fill("sleep");
  await p.getByRole("button", { name: "开始检索", exact: true }).click();
  await p.getByLabel("选择文献 1", { exact: true }).check();
  await p.getByRole("button", { name: "查看摘要与备注" }).first().click();
  await p.getByLabel("人工阅读备注").fill("保留核对意见");
  await p.keyboard.press("Escape");
  await p.getByRole("button", { name: /加载更多/ }).click();
  await p.getByLabel("选择文献 3", { exact: true }).waitFor();
  assert.deepEqual(await p.locator(".paper .paper-title").allTextContents(), [
    "文献 103",
    "文献 102",
    "文献 101",
  ]);
  assert.equal(
    await p.getByLabel("选择文献 2", { exact: true }).isChecked(),
    true,
  );
  await p.getByRole("button", { name: "查看摘要与备注" }).nth(1).click();
  assert.equal(await p.getByLabel("人工阅读备注").inputValue(), "保留核对意见");
  await p.keyboard.press("Escape");
  checks.push("模拟分页合并、重复文献去重、新结果排在首位、已选与笔记保留");
  await p.getByRole("button", { name: "修改检索" }).click();
  await p.locator("#query").fill("absent keyword");
  await p.getByRole("button", { name: "开始检索", exact: true }).click();
  await p.getByRole("heading", { name: "这里还没有文献" }).waitFor();
  assert.equal(await p.locator(".paper").count(), 0);
  assert.equal(await p.locator(".flow li.reached").count(), 5);
  checks.push("模拟成功零篇，保留检索式与完成记录");
  await mkdir("artifacts/research-preview", { recursive: true });
  await writeFile(
    "artifacts/research-preview/分页与空结果.json",
    JSON.stringify(checks, null, 2),
  );
  console.log(checks);
} finally {
  await browser.close();
}
