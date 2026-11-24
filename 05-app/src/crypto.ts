/**
 * AES-GCM para la configuración compartida.
 * La llave se deriva del token con PBKDF2, así que el script solo guarda
 * texto cifrado y sin el token no se puede leer.
 */

const SALT = "chispa-taller-config-v1";
const ITERATIONS = 120_000;

async function deriveKey(token: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(token),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: encoder.encode(SALT), iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    for (let j = 0; j < slice.length; j += 1) {
      binary += String.fromCharCode(slice[j]);
    }
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export async function encryptJson(token: string, value: unknown): Promise<string> {
  const key = await deriveKey(token);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data)
  );

  const combined = new Uint8Array(iv.length + cipher.length);
  combined.set(iv);
  combined.set(cipher, iv.length);
  return toBase64(combined);
}

export async function decryptJson<T>(token: string, payload: string): Promise<T> {
  const raw = fromBase64(payload);
  const iv = raw.slice(0, 12);
  const key = await deriveKey(token);
  const data = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    raw.slice(12)
  );
  return JSON.parse(new TextDecoder().decode(data)) as T;
}
