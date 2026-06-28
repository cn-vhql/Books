import { chromium } from "playwright";

const baseUrl = process.env.KOODO_BASE_URL || "http://127.0.0.1:18083";
const username = process.env.KOODO_USERNAME || "admin";
const password = process.env.KOODO_PASSWORD || "ChangeMe_2026!";
const bookName = process.env.KOODO_BOOK_NAME || "";
const bookKey = process.env.KOODO_BOOK_KEY || "";
const bookFormat = (process.env.KOODO_BOOK_FORMAT || "").toLowerCase();
const bookTitle = process.env.KOODO_BOOK_TITLE || "";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
const page = await context.newPage();

const consoleEvents = [];
const requestFailures = [];
const responses = [];

page.on("console", (message) => {
  consoleEvents.push({
    type: message.type(),
    text: message.text(),
  });
});

page.on("requestfailed", (request) => {
  requestFailures.push({
    url: request.url(),
    method: request.method(),
    failure: request.failure(),
  });
});

page.on("response", async (response) => {
  const url = response.url();
  if (
    response.status() >= 400 ||
    url.includes("/api/library/books/") ||
    url.includes("/static/") ||
    url.includes("/lib/")
  ) {
    responses.push({
      url,
      status: response.status(),
      contentType: response.headers()["content-type"] || "",
    });
  }
});

async function dumpState(label) {
  console.log(`\n=== ${label} ===`);
  console.log("url:", page.url());
  console.log("title:", await page.title());
  const bodyText = await page.locator("body").innerText().catch(() => "");
  console.log("body text preview:", bodyText.slice(0, 600));
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60000 });
  await dumpState("home");

  const loginInputs = page.locator(".login-server-input");
  if ((await loginInputs.count()) >= 2) {
    await loginInputs.nth(0).fill(username);
    await loginInputs.nth(1).fill(password);
    await page.locator(".login-server-button").click();
    await page.waitForLoadState("networkidle");
  }

  await dumpState("after-login");

  const books = page.locator(".book-list-item-container, .book-list-item");
  const bookCount = await books.count();
  console.log("book count:", bookCount);

  if (bookCount === 0) {
    throw new Error("No books rendered on manager page");
  }

  const overlay = page.locator(".drag-background");
  if ((await overlay.count()) > 0) {
    await overlay.evaluateAll((nodes) => {
      for (const node of nodes) {
        const element = node;
        element.style.display = "none";
        element.style.pointerEvents = "none";
      }
    });
  }

  let readerPage = page;
  if (bookKey && bookFormat) {
    const titleParam = encodeURIComponent(bookTitle || bookName || bookKey);
    await page.goto(
      `${baseUrl}/#/${bookFormat}/${bookKey}?title=${titleParam}&file=${bookKey}`,
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );
    await page.waitForLoadState("networkidle").catch(() => {});
  } else {
    let clickable = page
      .locator(
        ".book-item-cover, .book-item-list-cover, .book-item-title, .book-item-list-title"
      )
      .first();
    if (bookName) {
      const titled = page.locator(
        `.book-item-title:has-text("${bookName}"), .book-item-list-title:has-text("${bookName}")`
      );
      if ((await titled.count()) > 0) {
        clickable = titled.first();
      }
    }

    const popupPromise = page.waitForEvent("popup", { timeout: 30000 });
    await clickable.click({ force: true });
    readerPage = await popupPromise;
    await readerPage.waitForLoadState("domcontentloaded", { timeout: 60000 });
  }
  await readerPage.waitForTimeout(5000);
  await readerPage.waitForLoadState("networkidle").catch(() => {});
  console.log("popup pages:", context.pages().length);
  console.log("reader popup url:", readerPage.url());
  console.log("reader popup title:", await readerPage.title());
  const readerBodyText = await readerPage.locator("body").innerText().catch(() => "");
  console.log("reader popup text preview:", readerBodyText.slice(0, 1000));

  const screenshotPath = "/tmp/koodo-reader-smoke.png";
  await readerPage.screenshot({ path: screenshotPath, fullPage: true });
  console.log("screenshot:", screenshotPath);
  console.log(
    "reader route:",
    readerPage.url(),
    "has viewer:",
    await readerPage
      .locator(".viewer, .ebook-viewer, .view-area-page, iframe, canvas")
      .count()
  );
  console.log(
    "page-area children:",
    await readerPage
      .locator("#page-area")
      .evaluate((node) => node.children.length)
      .catch(() => -1)
  );
} catch (error) {
  console.error("SMOKE_ERROR", error);
} finally {
  console.log("\n=== console events ===");
  for (const event of consoleEvents.slice(-100)) {
    console.log(`[${event.type}] ${event.text}`);
  }

  console.log("\n=== request failures ===");
  for (const item of requestFailures.slice(-100)) {
    console.log(JSON.stringify(item));
  }

  console.log("\n=== interesting responses ===");
  for (const item of responses.slice(-200)) {
    console.log(JSON.stringify(item));
  }

  await browser.close();
}
