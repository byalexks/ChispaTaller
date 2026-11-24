/**
 * Google Calendar sync through the same Apps Script as the daily close.
 *
 * No OAuth and no Google verification: the script creates, updates and deletes
 * the events with the Google account that owns the Sheet. The token protects
 * the endpoint.
 */

export interface GoogleEvent {
  summary: string;
  location?: string;
  description?: string;
  /** ISO with Colombia's offset, e.g. 2026-11-24T08:00:00-05:00 */
  start: string;
  end: string;
}

type CalendarResponse = {
  ok?: boolean;
  error?: string;
  eventId?: string;
};

async function call(
  url: string,
  token: string,
  payload: Record<string, unknown>
): Promise<CalendarResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token, ...payload }),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  let data: CalendarResponse | null = null;
  try {
    data = JSON.parse(text) as CalendarResponse;
  } catch {
    throw new Error(
      "La URL no devolvió JSON. ¿Publicaste el Apps Script como aplicación web?"
    );
  }

  if (data?.ok === false) throw new Error(data.error ?? "El script rechazó el evento");
  return data ?? {};
}

export async function insertEvent(
  url: string,
  token: string,
  event: GoogleEvent
): Promise<string> {
  const data = await call(url, token, { action: "calendar-create", ...event });
  if (!data.eventId) throw new Error("Google no devolvió el evento");
  return data.eventId;
}

/** Updates the event. If it was deleted in Google, the script creates a new one. */
export async function patchEvent(
  url: string,
  token: string,
  eventId: string,
  event: GoogleEvent
): Promise<string> {
  const data = await call(url, token, { action: "calendar-update", eventId, ...event });
  return data.eventId ?? eventId;
}

export async function deleteEvent(
  url: string,
  token: string,
  eventId: string
): Promise<void> {
  await call(url, token, { action: "calendar-delete", eventId });
}
