import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { projectSchema } from "../shared/schema.js";
import { anchorMap, referenceKeys } from "../shared/evidence.js";
const base = process.env.TEST_URL || "http://127.0.0.1:8936",
  dir = "artifacts/research-preview";
const browser = await chromium.launch(),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage();
const errors: string[] = [],
  events: string[] = [],
  audits: { page: string; violations: string[] }[] = [];
const step = (s: string) => {
  events.push(s);
  console.log(s);
};
page.on("pageerror", (e) => errors.push(e.message));
await mkdir(dir, { recursive: true });
try {
  const signup = await page.request.post(base + "/api/auth/register", {
    data: { username: "flow_" + Date.now(), password: "Quality-Test-12345" },
  });
  assert.equal(signup.status(), 201);
  await page.goto(base);
  await page.getByRole("heading", { name: "使用说明" }).waitFor();
  assert.deepEqual(
    await (await page.request.get(base + "/api/projects")).json(),
    [],
  );
  step("新账号使用说明与空研究库");
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw Error("实测需要独立测试账号的模型密钥");
  assert.equal(
    (
      await page.request.put(base + "/api/settings/ai", {
        data: { key, model: process.env.DEEPSEEK_MODEL || "deepseek-flash" },
      })
    ).status(),
    200,
  );
  await page.reload();
  await page
    .locator("#question")
    .fill("正念与大学生睡眠质量的研究有何发现和局限？");
  await page
    .locator("#query")
    .fill("(EXT_ID:43021860 OR EXT_ID:43059015) AND SRC:MED");
  await page.locator(".concepts summary").click();
  const boxes = page.locator(".concepts input:not([type=checkbox])");
  while (await boxes.count())
    await page.locator(".concepts button[aria-label^=移除概念]").last().click();
  for (const term of [
    "mindfulness | mindful",
    "students | college",
    "sleep | insomnia",
  ]) {
    await page.getByText("添加概念", { exact: true }).click();
    await boxes.last().fill(term);
  }
  await page.getByRole("button", { name: "开始检索", exact: true }).click();
  await page.getByRole("region", { name: "检索流程" }).waitFor();
  await page.locator(".paper").first().waitFor({ timeout: 60000 });
  assert.equal(await page.locator(".paper").count(), 2);
  assert.equal(await page.locator(".flow li.reached").count(), 5);
  await page.locator(".rank-details summary").first().click();
  await page.screenshot({ path: dir + "/01-排序与检索流程.png" });
  step("在线查询指定的两篇文献、五步检索事件、展开排序依据");
  const audit = async (name: string) => {
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    audits.push({ page: name, violations: result.violations.map((v) => v.id) });
  };
  await audit("文献");
  const refine = page.waitForResponse((r) => r.url().endsWith("/api/rerank"), {
    timeout: 150000,
  });
  await page.getByRole("button", { name: /按我的问题精排/ }).click();
  const refined = await refine;
  assert.equal(refined.status(), 200, JSON.stringify(await refined.json()));
  await page
    .locator(".rank-details summary")
    .filter({ hasText: "模型精排" })
    .first()
    .waitFor();
  await page.getByLabel("选择文献 1", { exact: true }).check();
  await page.getByLabel("选择文献 2", { exact: true }).check();
  const request = page.waitForResponse(
    (r) => r.url().endsWith("/api/analyze"),
    { timeout: 180000 },
  );
  await page.getByRole("button", { name: "生成证据与简报" }).click();
  const analysis = await request;
  const data = await analysis.json();
  assert.equal(analysis.status(), 200, JSON.stringify(data));
  step("个人模型精排和真实简报生成");
  console.log(
    "文献来源",
    data.evidence.map((e: any) => [
      e.paperKey,
      [...new Set(e.anchors.map((a: any) => a.kind))],
    ]),
  );
  await page.locator(".evidence-links button").first().waitFor();
  const full = page
      .locator(".evidence-links button")
      .filter({ hasText: "全文" }),
    abs = page.locator(".evidence-links button").filter({ hasText: "摘要" });
  assert.ok((await full.count()) > 0);
  assert.ok((await abs.count()) > 0);
  await full.first().click();
  await page.locator(".passage mark").waitFor();
  assert.ok((await page.locator(".passage mark").innerText()).length > 0);
  await page.screenshot({ path: dir + "/02-全文原句定位.png" });
  await page.keyboard.press("Escape");
  await abs.first().click();
  await page.locator(".passage strong").filter({ hasText: "摘要" }).waitFor();
  await page.keyboard.press("Escape");
  step("同一次分析覆盖开放全文和仅摘要两篇，原句位置可点击");
  await page.getByRole("button", { name: "查看研究简报" }).click();
  assert.equal(await page.locator(".report-section").count(), 3);
  await page.locator(".claims sup button").first().click();
  await page.locator(".passage mark").waitFor();
  await page.keyboard.press("Escape");
  await audit("简报");
  await page.screenshot({ path: dir + "/03-逐句引用.png" });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.locator(".claims sup button").first().click();
    await page.locator(".passage mark").waitFor();
    await page.keyboard.press("Escape");
    if (width === 375)
      await page.screenshot({ path: dir + "/04-手机简报.png" });
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await (await download).saveAs(dir + "/简报.md");
  await page.pdf({
    path: dir + "/打印简报.pdf",
    format: "A4",
    printBackground: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "研究简报", exact: true }).click();
  await page.locator(".claims sup button").first().waitFor();
  const all = await (await page.request.get(base + "/api/projects")).json(),
    p = projectSchema.parse(all.find((x: any) => x.sections.length)),
    anchors = anchorMap(p),
    keys = referenceKeys(p);
  for (const s of p.sections)
    for (const c of s.claims || [])
      for (const ref of c.refs) {
        const a = anchors.get(ref);
        assert.ok(a);
        assert.ok(keys.includes(a.paperKey));
      }
  const md = await readFile(dir + "/简报.md", "utf8");
  assert.ok(md.includes("<sup>"));
  for (const [i, k] of keys.entries())
    assert.ok(
      md.includes(
        "[" + (i + 1) + "] " + p.papers.find((x) => x.key === k)!.title,
      ),
    );
  await writeFile(
    dir + "/引用核对.json",
    JSON.stringify(
      {
        papers: p.papers.map(({ key, title, url }) => ({ key, title, url })),
        sections: p.sections,
        anchors: [...anchors.values()],
      },
      null,
      2,
    ),
  );
  step("桌面、平板、手机点击引文，Markdown 编号比对、打印 PDF、刷新恢复");
  await page.getByRole("button", { name: "编辑本节" }).first().click();
  const editor = page.locator(".claim-edit textarea").first();
  await editor.fill("人工修改后重新核对。");
  await page.getByText("· 待复核", { exact: false }).first().waitFor();
  await page.getByRole("button", { name: "开始研究", exact: true }).click();
  await page.route("**/api/search", (r) =>
    r.fulfill({
      contentType: "application/x-ndjson",
      body:
        JSON.stringify({
          event: { stage: 1, detail: "请求来源", at: new Date().toISOString() },
        }) +
        "\n" +
        JSON.stringify({ error: "模拟上游超时" }) +
        "\n",
    }),
  );
  await page.getByRole("button", { name: "开始检索", exact: true }).click();
  await page.getByRole("button", { name: "重试本次检索" }).waitFor();
  await page.getByRole("button", { name: "文献工作台", exact: true }).click();
  assert.equal(await page.locator(".paper").count(), 2);
  step("人工修改标记待复核、模拟上游失败保留两篇文献并提供重试");
  assert.deepEqual(errors, []);
  await writeFile(
    dir + "/浏览器验收.json",
    JSON.stringify({ events, errors, audits }, null, 2),
  );
} finally {
  await page.request.delete(base + "/api/settings/ai").catch(() => {});
  await browser.close();
}
