import { decryptJson, encryptJson } from "./crypto";
import type { Technician } from "./types";

export interface SharedConfig {
  adminPin: string;
  adminHint?: string;
  technicians: Technician[];
  uploadUrl?: string;
  uploadToken?: string;
}

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  try {
    return JSON.parse(text) as {
      ok?: boolean;
      error?: string;
      cipher?: string;
      mensaje?: string;
    };
  } catch {
    throw new Error("La URL no devolvió JSON");
  }
}

/** Reads the encrypted config from the Apps Script. */
export async function pullConfig(url: string, token: string): Promise<SharedConfig | null> {
  const target = new URL(url);
  target.searchParams.set("action", "config");
  target.searchParams.set("token", token);

  const data = await request(target.toString(), { method: "GET" });
  if (data.ok === false) throw new Error(data.error ?? "Config rechazada");
  if (!data.cipher) return null;

  return decryptJson<SharedConfig>(token, data.cipher);
}

/** Encrypts and stores the config in the Apps Script. */
export async function pushConfig(
  url: string,
  token: string,
  config: SharedConfig
): Promise<void> {
  const cipher = await encryptJson(token, config);

  const data = await request(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "config", token, cipher }),
  });

  if (data.ok === false) throw new Error(data.error ?? "No se pudo guardar la config");
}
