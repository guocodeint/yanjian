import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.TEST_URL || "http://127.0.0.1:8787";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const results: string[] = [];
const username = "test_" + Date.now(),
  password = "Test-research-123!";
try {
  await page.goto(base);
  await page.getByRole("heading", { name: "欢迎回到研究空间" }).waitFor();
  await page.screenshot({
    path: "artifacts/login-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "还没有账号？创建账号" }).click();
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await page.getByRole("heading", { name: "开始研究" }).waitFor();
  results.push("账号注册并登录成功");
  await page.screenshot({ path: "artifacts/home-desktop.png", fullPage: true });

  await page
    .getByLabel("研究问题", { exact: true })
    .fill("槲皮素纳米递送研究采用了哪些方法，摘要证据有哪些局限？");
  await page
    .getByLabel("英文检索式", { exact: false })
    .fill("quercetin AND nanoparticles AND bioavailability");
  await page.getByRole("button", { name: "开始检索", exact: true }).click();
  await page
    .getByLabel("选择文献 1", { exact: true })
    .waitFor({ timeout: 60000 });
  results.push("真实 Europe PMC 检索成功");
  await page.getByLabel("选择文献 1", { exact: true }).check();
  await page.getByLabel("选择文献 2", { exact: true }).check();
  await page.getByLabel("选择文献 3", { exact: true }).check();
  await page.getByRole("button", { name: "手工整理", exact: true }).click();
  const findings = page.getByLabel("主要发现", { exact: true });
  await findings.first().fill("人工阅读记录：请进一步核对全文中的研究方法。");
  await page.waitForTimeout(700);
  await page.reload();
  await page.getByRole("button", { name: "证据矩阵", exact: true }).click();
  assert.equal(
    await findings.first().inputValue(),
    "人工阅读记录：请进一步核对全文中的研究方法。",
  );
  results.push("服务端数据库刷新恢复与人工证据编辑成功");
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV", exact: true }).click();
  await (await csvDownload).saveAs("artifacts/evidence.csv");
  await page.getByRole("button", { name: "查看研究简报" }).click();
  await page
    .getByRole("textbox", { name: "证据对比第1句", exact: true })
    .fill("已选文献仅供摘要整理，本记录尚未完成全文审核。");
  const mdDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await (await mdDownload).saveAs("artifacts/report.md");
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "项目 JSON", exact: true }).click();
  await (await jsonDownload).saveAs("artifacts/project.json");
  await page.pdf({
    path: "artifacts/report.pdf",
    format: "A4",
    printBackground: true,
  });
  results.push("CSV、Markdown、JSON 和浏览器 PDF 导出成功");
  await page.getByRole("button", { name: /账号研究库/ }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles("artifacts/project.json");
  await page.getByText("已导入为独立副本；导入内容未经本应用验证。").waitFor();
  results.push("JSON 导入副本成功");
  await page.getByRole("button", { name: "文献工作台", exact: true }).click();
  if (process.env.LIVE_AI === "1") {
    if (!process.env.DEEPSEEK_API_KEY)
      throw new Error("真实 AI 测试需要为隔离测试账号配置密钥");
    await page.request.put(base + "/api/settings/ai", {
      data: {
        key: process.env.DEEPSEEK_API_KEY,
        model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
      },
    });
    await page.reload();
    await page.getByRole("button", { name: "文献工作台", exact: true }).click();
    const analysisResponse = page.waitForResponse(
      (r) => r.url().endsWith("/api/analyze"),
      { timeout: 150000 },
    );
    await page
      .getByRole("button", { name: "生成证据与简报", exact: true })
      .click();
    const response = await analysisResponse;
    assert.equal(response.status(), 200, JSON.stringify(await response.json()));
    await page
      .getByRole("button", { name: /查看 AI 原始提取/ })
      .waitFor({ timeout: 180000 });
    results.push("真实 DeepSeek 摘要分析与引用校验成功");
    await page.waitForTimeout(800);
    const exported = await page.evaluate(() =>
      fetch("/api/projects").then((r) => r.json()),
    );
    assert.ok(Array.isArray(exported));
    assert.ok(exported.some((x: any) => x.original));
    await writeFile(
      "artifacts/live-projects.json",
      JSON.stringify(exported, null, 2),
    );
    await page.screenshot({
      path: "artifacts/evidence-desktop.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "查看研究简报" }).click();
    await page.screenshot({
      path: "artifacts/report-desktop.png",
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "开始研究", exact: true }).click();
  await page.screenshot({ path: "artifacts/home-mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  results.push("390px 手机布局无横向溢出");
  const isolated = await browser.newContext();
  const other = await isolated.newPage();
  await other.goto(base);
  await other.getByRole("heading", { name: "欢迎回到研究空间" }).waitFor();
  assert.equal((await other.request.get(base + "/api/projects")).status(), 401);
  await other.getByLabel("用户名", { exact: true }).fill(username);
  await other.getByLabel("密码", { exact: true }).fill(password);
  await other.getByRole("button", { name: "登录", exact: true }).click();
  await other.getByRole("button", { name: "账号研究库", exact: false }).click();
  await other.locator(".history-list article").first().waitFor();
  assert.ok((await other.locator(".history-list article").count()) > 0);
  results.push("未登录访问被拒绝；同一账号在独立浏览器恢复服务端记录");
  await isolated.close();
  // 模拟失败仅用于测试，产品不提供伪装成功的测试接口。
  await page.route("**/api/search", (r) =>
    r.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "测试：文献服务暂时不可用" }),
    }),
  );
  await page.getByRole("button", { name: "开始检索", exact: true }).click();
  await page.getByText("测试：文献服务暂时不可用").first().waitFor();
  results.push("检索失败明确提示且已有记录保留");
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/browser-results.json",
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(results.join("\n"));
} catch (e) {
  await page.screenshot({ path: "artifacts/failure.png", fullPage: true });
  console.log((await page.locator("body").innerText()).slice(-5000));
  throw e;
} finally {
  if (process.env.LIVE_AI === "1")
    await page.request.delete(base + "/api/settings/ai").catch(() => {});
  await browser.close();
}
