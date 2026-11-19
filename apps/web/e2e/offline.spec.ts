import { expect, test } from "@playwright/test";

import { findForeignUrls } from "../src/test/sameOrigin";

const origin = process.env.PAKO_OFFLINE_ORIGIN ?? "";
const secret = process.env.PAKO_OFFLINE_SECRET ?? "";


test("offline desktop walkthrough", async ({ browser }) => {
  if (!origin || !secret) throw new Error("PAKO_OFFLINE_ORIGIN is not set; run this spec with: pnpm --filter web e2e:offline");

  const context = await browser.newContext({ baseURL: origin, acceptDownloads: true });
  await context.addCookies([{ name: "pako_launch", value: secret, url: origin }]);

  await context.addInitScript(() => {
    const noop = () => Promise.resolve(null);
    (window as unknown as { pakoDesktop: unknown }).pakoDesktop = {
      isDesktop: true,
      version: "e2e",
      backupNow: noop,
      listBackups: () => Promise.resolve([]),
      restoreFromFile: noop,
      chooseBackupDir: noop,
      getBackupSettings: noop,
      openLogFolder: noop,
    };
  });

  const allRequests: string[] = [];
  const blocked: string[] = [];
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (findForeignUrls([url], origin).length === 0) return route.continue();
    blocked.push(url);
    return route.abort("internetdisconnected");
  });

  const page = await context.newPage();
  page.on("request", (request) => allRequests.push(request.url()));
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));

  await page.goto("/");
  await expect(page).toHaveURL(/\/first-run/);

  await page.locator("#fr-email").fill("owner@offline.test");
  await page.locator("#fr-name").fill("Offline Owner");
  await page.locator("#fr-password").fill("Offline-Pass-1");
  await page.getByRole("button", { name: "Create administrator" }).click();

  await expect(page.getByText("Your recovery code")).toBeVisible();
  await page.getByLabel("I saved the recovery code").check();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/login/);
  await page.locator("#email").fill("owner@offline.test");
  await page.locator("#password").fill("Offline-Pass-1");
  await page.locator("form button[type=submit]").click();

  await expect(page.getByRole("heading", { name: "Choose a company" })).toBeVisible();
  await page.getByRole("button", { name: "Create your first company" }).click();
  await page.locator("#nc-name").fill("Offline Test Sh.p.k.");
  const created = page.waitForResponse((r) => r.url().endsWith("/api/companies") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Create and open" }).click();
  expect((await created).ok()).toBeTruthy();

  const login = await context.request.post("/api/auth/login", { data: { email: "owner@offline.test", password: "Offline-Pass-1" } });
  expect(login.ok()).toBeTruthy();
  const { token } = (await login.json()) as { token: string };
  const headers = { Authorization: `Bearer ${token}` };
  const companiesResponse = await context.request.get("/api/companies", { headers });
  const companiesBody = await companiesResponse.text();
  const companies = JSON.parse(companiesBody) as { id: string }[];
  expect(companies.length, companiesBody).toBeGreaterThan(0);
  const companyId = companies[0].id;

  const partner = await context.request.post(`/api/companies/${companyId}/partners`, {
    headers,
    data: { name: "Offline Customer", taxNumber: "811111111", isCustomer: true, isVendor: false, isVatRegistered: true },
  });
  expect(partner.ok(), await partner.text()).toBeTruthy();
  const { id: partnerId } = (await partner.json()) as { id: string };

  const taxes = (await (await context.request.get(`/api/companies/${companyId}/taxes`, { headers })).json()) as { id: string; code?: string }[];
  const saleTax = taxes.find((t) => t.code === "S18");
  expect(saleTax).toBeDefined();

  const today = new Date().toISOString().slice(0, 10);
  const draft = await context.request.post(`/api/companies/${companyId}/invoices`, {
    headers,
    data: {
      partnerId,
      issueDate: today,
      dueDate: today,
      lines: [{ description: "Consulting", quantity: 2, unitPrice: 50, taxDefinitionId: saleTax!.id }],
    },
  });
  expect(draft.ok(), await draft.text()).toBeTruthy();
  const { id: invoiceId } = (await draft.json()) as { id: string };

  await page.getByText("Offline Test Sh.p.k.").first().click();
  await expect(page.getByRole("heading", { name: "Choose a company" })).toBeHidden();
  await page.goto(`/invoicing/${invoiceId}`);
  await page.getByRole("button", { name: "Post invoice" }).click();
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByText("Posted", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Submit to ATK/ })).toBeDisabled();

  await page.goto("/reports");
  await expect(page.getByRole("button", { name: "Export to Excel" }).first()).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export to Excel" }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);

  expect(allRequests.length).toBeGreaterThan(20);
  expect(blocked).toEqual([]);
  expect(findForeignUrls(allRequests, origin)).toEqual([]);
  expect(findForeignUrls(sockets, origin)).toEqual([]);
});
