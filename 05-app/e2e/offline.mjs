/**
 * Offline check: the PWA must boot with the network disabled.
 * Requires the built app served by `npm run preview` (http://localhost:4173).
 *
 *   npm run build
 *   npm run preview
 *   node e2e/offline.mjs
 */

import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:4173";

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(BASE, { waitUntil: "networkidle" });

  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) throw new Error("No hay service worker registrado");
    await navigator.serviceWorker.ready;
  });

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });

  await page.getByText("Agenda", { exact: true }).first().waitFor({ timeout: 15000 });
  await page.getByText(/Administrar técnicos/).first().waitFor({ timeout: 5000 });

  console.log("✓ offline: la app abre y muestra el login sin red");
} catch (error) {
  console.error(`✗ offline: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
