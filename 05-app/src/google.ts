/**
 * Google Calendar sync (minimal, no backend).
 *
 * Uses Google Identity Services (GIS) to get an access token in the browser and
 * the Calendar API to insert/patch/delete events. Each technician authorizes
 * with their own Google account, so the events go to their own calendar.
 */

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GIS_SRC = "https://accounts.google.com/gsi/client";

/** Public OAuth client id for Chispa Taller. Not a secret. */
export const DEFAULT_CLIENT_ID =
  "344688969462-4hi6f3pfcfnbbf1eh6qr32pr3pcr499u.apps.googleusercontent.com";

type Token = { value: string; expiresAt: number };

let token: Token | null = null;
let tokenClient: {
  requestAccessToken: (options?: { prompt?: string }) => void;
} | null = null;
let gisLoading: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (gisLoading) return gisLoading;
  gisLoading = new Promise((resolve, reject) => {
    if ((window as unknown as { google?: unknown }).google) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("No se pudo cargar Google Identity Services"));
    document.head.appendChild(script);
  });
  return gisLoading;
}

export function isConnected(): boolean {
  return Boolean(token && token.expiresAt > Date.now() + 60_000);
}

export async function connect(clientId: string): Promise<void> {
  if (!clientId.trim()) throw new Error("Falta el Client ID de Google.");
  await loadGis();

  const google = (window as unknown as {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: {
              access_token?: string;
              expires_in?: number;
              error?: string;
            }) => void;
          }) => { requestAccessToken: (options?: { prompt?: string }) => void };
        };
      };
    };
  }).google;

  const oauth2 = google?.accounts?.oauth2;
  if (!oauth2) throw new Error("Google no está disponible en este navegador.");

  await new Promise<void>((resolve, reject) => {
    tokenClient = oauth2.initTokenClient({
      client_id: clientId.trim(),
      scope: SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error ?? "Sin token de Google"));
          return;
        }
        token = {
          value: response.access_token,
          expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
        };
        resolve();
      },
    });
    tokenClient?.requestAccessToken({ prompt: "consent" });
  });
}

async function api(path: string, init: RequestInit = {}) {
  if (!token) throw new Error("No conectado a Google.");

  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token.value}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Google ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

export interface GoogleEvent {
  summary: string;
  location?: string;
  description?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

export async function insertEvent(event: GoogleEvent): Promise<string> {
  const created = (await api("/calendars/primary/events", {
    method: "POST",
    body: JSON.stringify(event),
  })) as { id?: string };
  if (!created?.id) throw new Error("Google no devolvió el evento.");
  return created.id;
}

export async function patchEvent(eventId: string, event: GoogleEvent): Promise<void> {
  await api(`/calendars/primary/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: JSON.stringify(event),
  });
}

export async function deleteEvent(eventId: string): Promise<void> {
  try {
    await api(`/calendars/primary/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
    });
  } catch (error) {
    // Already deleted in Google: nothing to do.
    if (!String(error).includes("410")) throw error;
  }
}
