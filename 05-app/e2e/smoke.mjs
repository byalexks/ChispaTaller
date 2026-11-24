/**
 * End-to-end smoke test with Playwright.
 * Runs against the dev server (http://localhost:5173).
 *
 *   node e2e/smoke.mjs
 *
 * Covers: admin login, demo data, technician login, confirm, close with photo,
 * no-show, cancel by pasted message, client history, JSON export.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const SHOTS = "e2e/shots";
mkdirSync(SHOTS, { recursive: true });

// 1x1 PNG, enough for the camera input.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const isoOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const problems = [];
page.on("console", (message) => {
  if (message.type() === "error") problems.push(message.text());
});
page.on("pageerror", (error) => problems.push(String(error)));

let passed = 0;
async function step(name, run) {
  try {
    await run();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}\n  ${error.message}`);
    await page.screenshot({ path: join(SHOTS, `fail-${passed + 1}.png`), fullPage: true });
    throw error;
  }
}

const pause = (ms = 350) => page.waitForTimeout(ms);
const pin = async (value) => {
  const input = page.locator('input[type="password"]').first();
  await input.fill(value);
  await pause(500);
};

try {
  await page.goto(BASE, { waitUntil: "networkidle" });

  await step("abrir administración con PIN 9999", async () => {
    await page.getByRole("button", { name: /Administrar técnicos/i }).click();
    await pin("9999");
    await page.getByText("Administración", { exact: false }).first().waitFor();
  });

  await step("limpiar datos previos del técnico", async () => {
    await page.getByRole("button", { name: "Borrar datos" }).first().click();
    await page.getByRole("button", { name: "Borrar", exact: true }).click();
    await pause(600);
  });

  await step("crear datos de prueba del técnico", async () => {
    await page.getByRole("button", { name: "Crear datos" }).first().click();
    await page.getByRole("button", { name: "Crear", exact: true }).click();
    await pause(900);
    await page.getByText(/citas/).first().waitFor();
  });

  await step("volver al login", async () => {
    await page.getByRole("button", { name: /Volver/ }).first().click();
    await page.getByRole("button", { name: /Administrar técnicos/i }).waitFor();
  });

  await step("entrar como técnico con PIN 1234", async () => {
    await page.getByText("Técnico", { exact: true }).first().click();
    await pin("1234");
    await page.getByText("Jornada mañana", { exact: false }).first().waitFor();
  });

  await step("confirmar una cita", async () => {
    await page.getByText("Engerling Marrugo", { exact: true }).first().click();
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await pause(600);
    await page.getByText("Jornada mañana", { exact: false }).first().waitFor();
  });

  await step("crear una cita a mano", async () => {
    await page.getByRole("button", { name: "Agregar" }).click();
    await page.getByText("Cargar cita a mano", { exact: true }).click();
    await page.getByPlaceholder("Nombre del cliente").fill("Cliente Manual");
    await page.getByPlaceholder("Vehículo / modelo").fill("galaxy 3");
    await page.getByPlaceholder("Teléfono (opcional)").fill("3001234567");
    await page.getByRole("button", { name: "Convertir en cita" }).click();
    await pause(900);
    await page.getByText("Cliente Manual", { exact: true }).first().waitFor();
  });

  await step("marcar una cita como por confirmar", async () => {
    await page.getByText("Cliente Manual", { exact: true }).first().click();
    await page.getByRole("button", { name: "Por confirmar" }).click();
    await pause(800);
    await page.getByText("Por confirmar", { exact: true }).first().waitFor();
  });

  await step("cerrar visita con foto y observaciones", async () => {
    await page.getByText("Engerling Marrugo", { exact: true }).first().click();
    await page.getByRole("button", { name: "Se hizo" }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "evidencia.png",
      mimeType: "image/png",
      buffer: PNG,
    });
    await page.locator('textarea[placeholder^="Observaciones"]').fill("Prueba automática: todo bien.");
    await pause(400);
    await page.getByRole("button", { name: "Confirmar visita" }).click();
    await pause(800);
    await page.getByText("Jornada mañana", { exact: false }).first().waitFor();
  });

  await step("descargar la foto de la visita", async () => {
    await page.getByText("Engerling Marrugo", { exact: true }).first().click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Descargar 1 foto/ }).click(),
    ]);
    if (!download.suggestedFilename().endsWith(".jpg")) {
      throw new Error(`Nombre inesperado: ${download.suggestedFilename()}`);
    }
    await pause(400);
    await page.getByRole("button", { name: "Cerrar", exact: true }).first().click();
  });

  await step("marcar una cita como no vino", async () => {
    await page.getByText("Luis Cárdenas", { exact: true }).first().click();
    await page.getByRole("button", { name: "No vino" }).click();
    await page.getByRole("button", { name: "Confirmar visita" }).click();
    await pause(800);
    await page.getByText("Jornada tarde", { exact: false }).first().waitFor();
  });

  await step("semana: abrir un día", async () => {
    await page.getByRole("button", { name: "Semana", exact: true }).click();
    await page.getByRole("button", { name: /Descargar todo/ }).waitFor();
    await page.locator("button").filter({ hasText: /\d+ cita/ }).first().click();
    await page.getByText(/Jornada (mañana|tarde)/).first().waitFor();
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  });

  await step("exportar todo en JSON", async () => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Descargar todo/ }).click(),
    ]);
    const path = await download.path();
    const { readFileSync } = await import("node:fs");
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(data.dias) || typeof data.totalCitas !== "number") {
      throw new Error("El JSON no tiene la forma esperada");
    }
    console.log(`  JSON: ${data.totalCitas} citas en ${data.dias.length} días`);
  });

  await step("clientes: buscar y abrir historial", async () => {
    await page.getByRole("button", { name: "Clientes", exact: true }).click();
    await page.getByPlaceholder("Buscar por nombre o teléfono").waitFor();
    await page.getByPlaceholder("Buscar por nombre o teléfono").fill("hilda");
    await page.getByText("Hilda de Ávila", { exact: true }).first().click();
    await page.getByText(/visita/).first().waitFor();
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  });

  await step("historial muestra la foto de evidencia", async () => {
    await page.getByPlaceholder("Buscar por nombre o teléfono").fill("engerling");
    await page.getByText("Engerling Marrugo", { exact: true }).first().click();
    await page.getByText(/con foto/i).first().waitFor();
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  });

  await step("cancelar una cita desde un mensaje CANCELADO", async () => {
    await page.getByRole("button", { name: "Hoy", exact: true }).click();
    await page.getByRole("button", { name: "Agregar" }).click();
    await page.getByText("Pegar mensaje de WhatsApp", { exact: false }).click();

    const months = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
    const target = new Date();
    target.setDate(target.getDate() + 4);
    const readable = `${target.getDate()} de ${months[target.getMonth()]} de ${target.getFullYear()}`;

    const text = `PROGRAMACION DE MANTENIMIENTO

Nombre y Apellidos:
JORGE PEREZ
Vehículo: galaxy 3
Día y Hora: ${readable} 8:00am
Teléfono: 3001112233.

CANCELADO`;

    await page.locator("textarea").first().fill(text);
    await page.getByRole("button", { name: "Procesar" }).click();
    await page.getByText(/Revisión/).first().waitFor();
    await page.getByRole("button", { name: "Cancelar cita" }).click();
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await pause(900);
    await page.getByText("Jornada mañana", { exact: false }).first().waitFor();
  });

  await step("historial muestra la cita cancelada", async () => {
    await page.getByRole("button", { name: "Clientes", exact: true }).click();
    await page.getByPlaceholder("Buscar por nombre o teléfono").fill("jorge");
    await page.getByText("Jorge Pérez", { exact: true }).first().click();
    await page.getByText("Cancelada", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
    await page.getByText("Sin cita próxima", { exact: true }).first().waitFor();
  });

  await step("reprogramar una cita desde un mensaje", async () => {
    await page.getByRole("button", { name: "Hoy", exact: true }).click();
    await page.getByRole("button", { name: "Agregar" }).click();
    await page.getByText("Pegar mensaje de WhatsApp", { exact: false }).click();

    const target = new Date();
    target.setDate(target.getDate() + 6);
    const readable = target.toLocaleDateString("es-CO", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const text = `REPROGRAMACION DE CITA

Nombre: Marta Ospina
Vehículo: stareer 3
Fecha y hora: ${readable} 2:00 pm
Problema: se reprograma porque la clienta viaja.`;

    await page.locator("textarea").first().fill(text);
    await page.getByRole("button", { name: "Procesar" }).click();
    await page.getByText(/Revisión/).first().waitFor();
    await page.getByRole("button", { name: "Reprogramar", exact: true }).click();
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await pause(900);
    await page.getByText("Jornada mañana", { exact: false }).first().waitFor();
  });

  await step("historial muestra la cita reprogramada", async () => {
    await page.getByRole("button", { name: "Clientes", exact: true }).click();
    await page.getByPlaceholder("Buscar por nombre o teléfono").fill("marta");
    await page.getByText("Marta Ospina", { exact: true }).first().click();
    await page.getByText("Reprogramada", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  });

  await step("cambiar a modo oscuro", async () => {
    await page.getByRole("button", { name: /Cambiar a tema/i }).click();
    await page.waitForTimeout(300);
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    if (theme !== "dim") throw new Error(`Tema inesperado: ${theme}`);
  });

  await step("admin exporta las fotos del día en ZIP", async () => {
    await page.getByTitle("Mi perfil").click();
    await page.getByRole("button", { name: /Cerrar sesión/ }).click();
    await page.getByRole("button", { name: /Administrar técnicos/ }).click();
    await pin("9999");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Fotos ZIP" }).click(),
    ]);
    if (!download.suggestedFilename().endsWith(".zip")) {
      throw new Error(`No es ZIP: ${download.suggestedFilename()}`);
    }
  });

  const realProblems = problems.filter(
    (message) =>
      !message.includes("Download the React DevTools") &&
      !message.includes("favicon") &&
      !message.includes("manifest")
  );

  console.log(`\nPasos OK: ${passed}`);
  console.log(`Errores de consola: ${realProblems.length}`);
  for (const problem of realProblems.slice(0, 10)) console.log(`  - ${problem}`);

  await page.screenshot({ path: join(SHOTS, "final.png"), fullPage: true });

  if (realProblems.length) process.exitCode = 1;
} finally {
  await browser.close();
}
