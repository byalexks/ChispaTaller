import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { normalize } from "./dates.js";
import type {
  Appointment,
  AppointmentStatus,
  AvailabilityBlock,
  Client,
  DaySummary,
  Draft,
  DraftMode,
  InboxMessage,
  Location,
  ScheduleBlock,
  ServiceType,
  Technician,
  TechnicianClient,
  Vehicle,
  VisitPhoto,
  WindowKey,
} from "./types";

const DB_NAME = "agenda-servicio-tecnico";
const DB_VERSION = 7;

/** Statuses that consume a slot. A rescheduled visit still happens on its new date. */
export const OCCUPYING = new Set([
  "scheduled",
  "to_confirm",
  "confirmed",
  "attended",
  "rescheduled",
]);

interface AgendaSchema extends DBSchema {
  technicians: { key: string; value: Technician };
  appointments: {
    key: string;
    value: Appointment;
    indexes: { byDate: string; byClient: string; byTechnician: string };
  };
  clients: {
    key: string;
    value: Client;
    indexes: { byName: string; byPhone: string };
  };
  vehicles: {
    key: string;
    value: Vehicle;
    indexes: { byClient: string };
  };
  locations: { key: string; value: Location };
  schedule: {
    key: string;
    value: ScheduleBlock;
    indexes: { byWeekday: number; byTechnician: string };
  };
  messages: {
    key: string;
    value: InboxMessage;
    indexes: { byInbox: number };
  };
  photos: { key: string; value: VisitPhoto; indexes: { byAppointment: string } };
  counters: { key: string; value: number };
  settings: { key: string; value: string };
}

export type AgendaDB = IDBPDatabase<AgendaSchema>;

let dbPromise: Promise<AgendaDB> | null = null;
let seedChecked = false;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isoWithOffset(baseIso: string, days: number): string {
  const [year, month, day] = baseIso.split("-").map(Number);
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function weekdayOf(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

export function windowOf(type: ServiceType | null): WindowKey {
  return type === "maintenance" ? "morning" : "afternoon";
}

/** One technician for now. Admin mode can add more. */
const SEED_TECHNICIANS: Technician[] = [
  { id: "tech-1", name: "Técnico", pin: "1234", color: "#0f5132", active: true },
];

const SEED_LOCATIONS: Location[] = [
  { id: "cartagena-1", name: "Cartagena 1", city: "Cartagena", aliases: [] },
  { id: "cartagena-2", name: "Cartagena 2", city: "Cartagena", aliases: [] },
  { id: "cartagena-3", name: "Cartagena 3", city: "Cartagena", aliases: [] },
  { id: "cartagena-4", name: "Cartagena 4", city: "Cartagena", aliases: [] },
  { id: "cartagena-5", name: "Cartagena 5", city: "Cartagena", aliases: [] },
  { id: "turbaco", name: "Turbaco", city: "Turbaco", aliases: [] },
];

/** Placeholder schedule: same shape for every technician until they configure theirs. */
function seedSchedule(technicianId: string): ScheduleBlock[] {
  const blocks: ScheduleBlock[] = [];
  for (let weekday = 1; weekday <= 5; weekday += 1) {
    blocks.push({
      id: `${technicianId}-w${weekday}-morning`,
      technicianId,
      weekday,
      from: "08:00",
      to: "12:00",
      locationId: "cartagena-1",
      window: "morning",
      capacity: 4,
      active: true,
    });
    blocks.push({
      id: `${technicianId}-w${weekday}-afternoon`,
      technicianId,
      weekday,
      from: "13:00",
      to: "18:00",
      locationId: "cartagena-1",
      window: "afternoon",
      capacity: 3,
      active: true,
    });
  }
  blocks.push({
    id: `${technicianId}-w6-morning`,
    technicianId,
    weekday: 6,
    from: "08:00",
    to: "12:00",
    locationId: "turbaco",
    window: "morning",
    capacity: 4,
    active: true,
  });
  return blocks;
}

async function seedIfEmpty(db: AgendaDB): Promise<void> {
  if (seedChecked) return;
  seedChecked = true;

  const technicians = await db.count("technicians");
  if (technicians === 0) {
    const tx = db.transaction(["technicians"], "readwrite");
    for (const technician of SEED_TECHNICIANS) {
      await tx.objectStore("technicians").put(technician);
    }
    await tx.done;
  }

  const locations = await db.count("locations");
  if (locations === 0) {
    const tx = db.transaction(["locations"], "readwrite");
    for (const location of SEED_LOCATIONS) {
      await tx.objectStore("locations").put(location);
    }
    await tx.done;
  }

  const blocks = await db.count("schedule");
  if (blocks === 0) {
    const roster = await db.getAll("technicians");
    const tx = db.transaction(["schedule"], "readwrite");
    for (const technician of roster) {
      for (const block of seedSchedule(technician.id)) {
        await tx.objectStore("schedule").put(block);
      }
    }
    await tx.done;
  }
}

/** One-time shift from the old 8–9 / 14–16 windows to 8–12 / 13–18. */
async function migrateWindows(db: AgendaDB): Promise<void> {
  if (await db.get("settings", "windows-v2")) return;

  const blocks = await db.getAll("schedule");
  const tx = db.transaction(["schedule", "settings"], "readwrite");
  for (const block of blocks) {
    if (block.from === "08:00" && block.to === "09:00") {
      await tx.objectStore("schedule").put({ ...block, to: "12:00" });
    } else if (block.from === "14:00" && block.to === "16:00") {
      await tx.objectStore("schedule").put({ ...block, from: "13:00", to: "18:00" });
    }
  }
  await tx.objectStore("settings").put("1", "windows-v2");
  await tx.done;
}

/** One-time move from a single photo per visit to a list of photo ids. */
async function migratePhotos(db: AgendaDB): Promise<void> {
  if (await db.get("settings", "photos-v2")) return;

  const photos = await db.getAll("photos");
  const tx = db.transaction(["photos", "appointments", "settings"], "readwrite");

  for (const photo of photos) {
    if (!photo.appointmentId) {
      await tx.objectStore("photos").put({ ...photo, appointmentId: photo.id });
    }
  }

  const appointments = await tx.objectStore("appointments").getAll();
  for (const appointment of appointments) {
    const legacy = (appointment as Appointment & { photoId?: string | null }).photoId;
    if (legacy && !appointment.photoIds?.length) {
      await tx.objectStore("appointments").put({ ...appointment, photoIds: [legacy] });
    }
  }

  await tx.objectStore("settings").put("1", "photos-v2");
  await tx.done;
}

export function getDb(): Promise<AgendaDB> {
  if (!dbPromise) {
    dbPromise = openDB<AgendaSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        if (!db.objectStoreNames.contains("technicians")) {
          db.createObjectStore("technicians", { keyPath: "id" });
        }

        if (!db.objectStoreNames.contains("appointments")) {
          const store = db.createObjectStore("appointments", { keyPath: "id" });
          store.createIndex("byDate", "date");
          store.createIndex("byClient", "clientId");
          store.createIndex("byTechnician", "technicianId");
        } else if (oldVersion < 2) {
          const store = tx.objectStore("appointments");
          if (!store.indexNames.contains("byTechnician")) {
            store.createIndex("byTechnician", "technicianId");
          }
        }

        if (!db.objectStoreNames.contains("clients")) {
          const store = db.createObjectStore("clients", { keyPath: "id" });
          store.createIndex("byName", "normalizedName");
          store.createIndex("byPhone", "phones", { multiEntry: true });
        }
        if (!db.objectStoreNames.contains("vehicles")) {
          const store = db.createObjectStore("vehicles", { keyPath: "id" });
          store.createIndex("byClient", "clientId");
        }
        if (!db.objectStoreNames.contains("locations")) {
          db.createObjectStore("locations", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("schedule")) {
          const store = db.createObjectStore("schedule", { keyPath: "id" });
          store.createIndex("byWeekday", "weekday");
          store.createIndex("byTechnician", "technicianId");
        } else if (oldVersion < 2) {
          const store = tx.objectStore("schedule");
          if (!store.indexNames.contains("byTechnician")) {
            store.createIndex("byTechnician", "technicianId");
          }
        }
        if (!db.objectStoreNames.contains("messages")) {
          const store = db.createObjectStore("messages", { keyPath: "id" });
          store.createIndex("byInbox", "inInbox");
        }
        if (!db.objectStoreNames.contains("photos")) {
          const store = db.createObjectStore("photos", { keyPath: "id" });
          store.createIndex("byAppointment", "appointmentId");
        } else if (oldVersion < 7) {
          const store = tx.objectStore("photos");
          if (!store.indexNames.contains("byAppointment")) {
            store.createIndex("byAppointment", "appointmentId");
          }
        }
        if (!db.objectStoreNames.contains("counters")) {
          db.createObjectStore("counters");
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings");
        }
      },
    }).then(async (db) => {
      await seedIfEmpty(db);
      await migrateWindows(db);
      await migratePhotos(db);
      return db;
    });
  }
  return dbPromise;
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  return (await db.get("settings", key)) ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.put("settings", value, key);
}

export async function listTechnicians(includeInactive = false): Promise<Technician[]> {
  const db = await getDb();
  const items = await db.getAll("technicians");
  const filtered = includeInactive ? items : items.filter((item) => item.active !== false);
  return filtered.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAdminPin(): Promise<string> {
  const db = await getDb();
  return (await db.get("settings", "adminPin")) ?? "9999";
}

export async function setAdminPin(pin: string): Promise<void> {
  const db = await getDb();
  await db.put("settings", pin, "adminPin");
}

export async function createTechnician(name: string, pin: string): Promise<Technician> {
  const db = await getDb();
  const palette = ["#0f5132", "#1d4ed8", "#b45309", "#7e22ce", "#0e7490"];
  const count = await db.count("technicians");
  const technician: Technician = {
    id: await nextId(db, "technicians", "T"),
    name: name.trim(),
    pin,
    color: palette[count % palette.length],
    active: true,
  };
  await db.put("technicians", technician);

  const tx = db.transaction("schedule", "readwrite");
  for (const block of seedSchedule(technician.id)) {
    await tx.store.put(block);
  }
  await tx.done;

  return technician;
}

export async function updateTechnician(
  id: string,
  patch: Partial<Pick<Technician, "name" | "pin" | "active" | "color">>
): Promise<void> {
  const db = await getDb();
  const technician = await db.get("technicians", id);
  if (!technician) return;
  await db.put("technicians", { ...technician, ...patch });
}

export async function deleteTechnician(
  id: string
): Promise<{ ok: boolean; appointments: number }> {
  const db = await getDb();
  const appointments = await db.getAllFromIndex("appointments", "byTechnician", id);
  if (appointments.length) return { ok: false, appointments: appointments.length };

  const blocks = await db.getAllFromIndex("schedule", "byTechnician", id);
  const tx = db.transaction("schedule", "readwrite");
  for (const block of blocks) {
    await tx.store.delete(block.id);
  }
  await tx.done;

  await db.delete("technicians", id);
  return { ok: true, appointments: 0 };
}

export async function clientsOfTechnician(id: string): Promise<TechnicianClient[]> {
  const db = await getDb();
  const appointments = await db.getAllFromIndex("appointments", "byTechnician", id);
  const today = todayIso();
  const map = new Map<string, TechnicianClient>();

  for (const appointment of appointments) {
    const key = appointment.clientId ?? appointment.phone ?? normalize(appointment.name ?? "");
    if (!key) continue;
    const current = map.get(key);
    const isUpcoming = Boolean(
      appointment.date && appointment.date >= today && OCCUPYING.has(appointment.status)
    );

    if (current) {
      current.visits += 1;
      if (appointment.date && (!current.lastDate || appointment.date > current.lastDate)) {
        current.lastDate = appointment.date;
      }
      if (isUpcoming && appointment.date && (!current.nextDate || appointment.date < current.nextDate)) {
        current.nextDate = appointment.date;
      }
      if (!current.phone && appointment.phone) current.phone = appointment.phone;
    } else {
      map.set(key, {
        clientId: key,
        name: appointment.name ?? "Sin nombre",
        phone: appointment.phone ?? null,
        visits: 1,
        lastDate: appointment.date ?? null,
        nextDate: isUpcoming ? appointment.date ?? null : null,
      });
    }
  }

  return [...map.values()].sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? ""));
}

export async function getTechnician(id: string): Promise<Technician | undefined> {
  const db = await getDb();
  return db.get("technicians", id);
}

export async function listLocations(includeInactive = true): Promise<Location[]> {
  const db = await getDb();
  const items = await db.getAll("locations");
  const filtered = includeInactive ? items : items.filter((item) => item.active !== false);
  return filtered.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createLocation(
  name: string,
  city: string,
  aliases: string[] = []
): Promise<Location> {
  const db = await getDb();
  const location: Location = {
    id: await nextId(db, "locations", "L"),
    name: name.trim(),
    city: city.trim() || "Cartagena",
    aliases: aliases.map((alias) => alias.trim()).filter(Boolean),
    active: true,
  };
  await db.put("locations", location);
  return location;
}

export async function updateLocation(
  id: string,
  patch: Partial<Pick<Location, "name" | "city" | "aliases" | "active">>
): Promise<void> {
  const db = await getDb();
  const location = await db.get("locations", id);
  if (!location) return;
  await db.put("locations", { ...location, ...patch });
}

function locationMatches(location: Location, text: string): boolean {
  const target = normalize(text);
  if (normalize(location.name) === target) return true;
  if (normalize(location.city) === target) return true;
  return location.aliases.some((alias) => normalize(alias) === target);
}

export async function resolveLocationText(text: string | null): Promise<string | null> {
  if (!text) return null;
  const locations = await listLocations();
  return locations.find((location) => locationMatches(location, text))?.id ?? null;
}

export async function suggestLocationId(
  date: string,
  type: ServiceType | null,
  technicianId: string
): Promise<string | null> {
  const db = await getDb();
  const weekday = weekdayOf(date);
  const blocks = await db.getAllFromIndex("schedule", "byTechnician", technicianId);
  const window = windowOf(type);
  const block = blocks
    .filter((item) => item.active && item.weekday === weekday && item.window === window)
    .sort((a, b) => a.from.localeCompare(b.from))[0];
  return block?.locationId ?? null;
}

/** Sequential, readable id: C-0001, C-000A, C-000B… */
async function nextId(db: AgendaDB, counter: string, prefix: string): Promise<string> {
  const tx = db.transaction("counters", "readwrite");
  const current = (await tx.store.get(counter)) ?? 0;
  const next = current + 1;
  await tx.store.put(next, counter);
  await tx.done;
  return `${prefix}-${next.toString(16).toUpperCase().padStart(4, "0")}`;
}

const NAME_PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "e"]);

function nameTokens(name: string): string[] {
  return normalize(name)
    .split(" ")
    .filter((token) => token.length > 2 && !NAME_PARTICLES.has(token));
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

/** Finds an open appointment that looks like the same job: by phone first, then by name. */
export async function findMatch(
  draft: Draft,
  technicianId: string
): Promise<Appointment | null> {
  const db = await getDb();
  const appointments = (await db.getAllFromIndex("appointments", "byTechnician", technicianId))
    .filter((item) => item.status !== "cancelled");
  if (!appointments.length) return null;

  const wanted = draft.name ? nameTokens(draft.name) : [];

  const scored = appointments
    .map((item) => {
      let score = 0;
      if (draft.phone && item.phone && draft.phone === item.phone) score += 20;

      if (wanted.length) {
        const have = nameTokens(item.name ?? "");
        const shared = wanted.filter((token) => have.includes(token)).length;
        if (shared >= 2) score += 10 + shared;
        else if (shared === 1 && wanted.length === 1 && have.length === 1) score += 11;
        else if (have.join(" ") === wanted.join(" ")) score += 15;
      }

      if (draft.model && item.model && normalize(item.model) === normalize(draft.model)) score += 4;
      if (draft.date && item.date === draft.date) score += 4;
      else if (draft.date && item.date) score -= Math.min(3, Math.abs(daysBetween(draft.date, item.date)));

      return { item, score };
    })
    .filter((entry) => entry.score >= 10)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.item ?? null;
}

async function applyDraftToAppointment(
  id: string,
  draft: Draft & { locationId?: string | null },
  mode: DraftMode
): Promise<void> {
  const db = await getDb();
  const current = await db.get("appointments", id);
  if (!current) return;
  const now = new Date().toISOString();

  if (mode === "cancel") {
    await db.put("appointments", { ...current, status: "cancelled", updatedAt: now });
    return;
  }

  if (mode === "reschedule") {
    await db.put("appointments", {
      ...current,
      date: draft.date ?? current.date,
      weekday: draft.weekday ?? current.weekday,
      time: draft.time ?? current.time,
      endTime: draft.endTime ?? current.endTime,
      status: "rescheduled",
      previousDate: current.date ?? null,
      alerts: draft.alerts ?? [],
      updatedAt: now,
    });
    return;
  }

  await db.put("appointments", {
    ...current,
    type: draft.type ?? current.type,
    secondaryType: draft.secondaryType ?? current.secondaryType,
    name: draft.name ?? current.name,
    model: draft.model ?? current.model,
    date: draft.date ?? current.date,
    weekday: draft.weekday ?? current.weekday,
    time: draft.time ?? current.time,
    endTime: draft.endTime ?? current.endTime,
    phone: draft.phone ?? current.phone,
    locationId: draft.locationId ?? current.locationId,
    part: draft.part ?? current.part,
    description: draft.description ?? current.description,
    amount: draft.amount ?? current.amount,
    payment: draft.amount !== null ? "paid" : current.payment,
    alerts: draft.alerts ?? [],
    updatedAt: now,
  });
}

async function findOrCreateClient(
  db: AgendaDB,
  name: string,
  phone: string | null
): Promise<Client> {
  if (phone) {
    const byPhone = await db.getAllFromIndex("clients", "byPhone", phone);
    if (byPhone.length) return byPhone[0];
  }

  const normalizedName = normalize(name);
  const byName = await db.getAllFromIndex("clients", "byName", normalizedName);
  if (byName.length) return byName[0];

  const client: Client = {
    id: await nextId(db, "clients", "CL"),
    name,
    normalizedName,
    phones: phone ? [phone] : [],
  };
  await db.put("clients", client);
  return client;
}

async function findOrCreateVehicle(
  db: AgendaDB,
  clientId: string,
  model: string | null,
  plate: string | null,
  serial: string | null
): Promise<Vehicle | null> {
  if (!model && !plate && !serial) return null;

  const vehicles = await db.getAllFromIndex("vehicles", "byClient", clientId);
  const match = vehicles.find(
    (vehicle) =>
      (plate && vehicle.plate === plate) ||
      (serial && vehicle.serial === serial) ||
      (model && normalize(vehicle.model ?? "") === normalize(model))
  );
  if (match) return match;

  const vehicle: Vehicle = {
    id: await nextId(db, "vehicles", "V"),
    clientId,
    model,
    plate,
    serial,
  };
  await db.put("vehicles", vehicle);
  return vehicle;
}

export async function saveDrafts(
  drafts: (Draft & {
    locationId?: string | null;
    mode?: DraftMode;
    matchId?: string | null;
  })[],
  technicianId: string
): Promise<{ saved: number; inbox: number }> {
  const db = await getDb();
  const locations = await listLocations();
  let saved = 0;
  let inbox = 0;

  for (const draft of drafts) {
    const messageId = await nextId(db, "messages", "M");
    const receivedAt = draft.receivedAt ?? new Date().toISOString();

    if (
      (draft.mode === "update" ||
        draft.mode === "cancel" ||
        draft.mode === "reschedule") &&
      draft.matchId
    ) {
      await applyDraftToAppointment(draft.matchId, draft, draft.mode);
      await db.put("messages", {
        id: messageId,
        text: draft.originalText,
        receivedAt,
        appointmentId: draft.matchId,
        inInbox: 0,
      });
      saved += 1;
      continue;
    }

    if (!draft.name || !draft.date) {
      await db.put("messages", {
        id: messageId,
        text: draft.originalText,
        receivedAt,
        appointmentId: null,
        inInbox: 1,
      });
      inbox += 1;
      continue;
    }

    const client = await findOrCreateClient(db, draft.name, draft.phone);
    const vehicle = await findOrCreateVehicle(db, client.id, draft.model, draft.plate, draft.serial);

    let locationId = draft.locationId ?? null;
    if (!locationId && draft.location) {
      const found = locations.find((item) => locationMatches(item, draft.location as string));
      locationId = found?.id ?? null;
    }
    if (!locationId) {
      locationId = await suggestLocationId(draft.date, draft.type, technicianId);
    }

    const now = new Date().toISOString();
    const appointment: Appointment = {
      ...draft,
      id: await nextId(db, "appointments", "C"),
      technicianId,
      clientId: client.id,
      vehicleId: vehicle?.id ?? null,
      locationId,
      alerts: draft.alerts ?? [],
      notes: null,
      closedAt: null,
      photoId: null,
      photoIds: [],
      createdAt: now,
      updatedAt: now,
    };

    await db.put("appointments", appointment);
    await db.put("messages", {
      id: messageId,
      text: draft.originalText,
      receivedAt,
      appointmentId: appointment.id,
      inInbox: 0,
    });
    saved += 1;
  }

  return { saved, inbox };
}

export async function countAppointments(technicianId: string): Promise<number> {
  const db = await getDb();
  return db.countFromIndex("appointments", "byTechnician", technicianId);
}

export async function deleteMessage(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("messages", id);
}

const DEMO_PEOPLE: {
  name: string;
  model: string;
  phone: string;
  type: ServiceType;
  part?: string;
  description?: string;
  amount?: number;
}[] = [
  { name: "Engerling Marrugo", model: "galaxy 3", phone: "3012277629", type: "maintenance", part: "flasher", amount: 240000 },
  { name: "Hilda de Ávila", model: "galaxy 3", phone: "3006532525", type: "maintenance" },
  { name: "Karol Giraldo", model: "stareer 3", phone: "3015558899", type: "revision", description: "No carga desde hace una semana." },
  { name: "Rosaida Hernández", model: "Ledo 3", phone: "3007771122", type: "warranty", part: "flasher" },
  { name: "Jorge Pérez", model: "galaxy 3", phone: "3001112233", type: "maintenance", amount: 180000 },
  { name: "Marta Ospina", model: "stareer 3", phone: "3124445566", type: "revision", description: "Ruido en la dirección." },
  { name: "Luis Cárdenas", model: "Ledo 3", phone: "3158889900", type: "maintenance" },
  { name: "Ana Beltrán", model: "galaxy 3", phone: "3182223344", type: "warranty", part: "cargador" },
  { name: "Pedro Salas", model: "stareer 3", phone: "3009998877", type: "revision", description: "Revisión de 10.000 km." },
  { name: "Sofía Ríos", model: "Ledo 3", phone: "3013334455", type: "maintenance", amount: 220000 },
];

/** Creates believable demo appointments for one technician, to test the UI. */
export async function seedDemoData(technicianId: string): Promise<number> {
  const base = todayIso();
  const statuses: AppointmentStatus[] = ["scheduled", "to_confirm", "confirmed"];

  const drafts = DEMO_PEOPLE.map((person, index) => {
    const date = isoWithOffset(base, index % 6);
    const time = person.type === "maintenance" ? "08:00" : "14:00";
    const draft: Draft = {
      type: person.type,
      secondaryType: person.part ? "part" : null,
      status: statuses[index % statuses.length],
      name: person.name,
      model: person.model,
      date,
      weekday: weekdayOf(date),
      time,
      endTime: person.type === "maintenance" ? "09:00" : "16:00",
      isWindow: true,
      phone: person.phone,
      location: null,
      address: null,
      part: person.part ?? null,
      description: person.description ?? null,
      instructions: null,
      amount: person.amount ?? null,
      payment: person.amount ? "paid" : "pending",
      plate: null,
      serial: null,
      extras: {},
      originalText: `Datos de prueba · ${person.name}`,
      receivedAt: new Date().toISOString(),
    };
    return draft;
  });

  const result = await saveDrafts(drafts, technicianId);
  return result.saved;
}

/** Deletes every appointment (and its photo) of one technician. Clients stay shared. */
export async function clearTechnicianData(technicianId: string): Promise<number> {
  const db = await getDb();
  const appointments = await db.getAllFromIndex("appointments", "byTechnician", technicianId);
  if (!appointments.length) return 0;

  const ids = new Set(appointments.map((appointment) => appointment.id));
  const messages = await db.getAll("messages");

  const tx = db.transaction(["appointments", "messages", "photos"], "readwrite");
  for (const appointment of appointments) {
    await tx.objectStore("appointments").delete(appointment.id);
    const photoIds =
      appointment.photoIds ?? (appointment.photoId ? [appointment.photoId] : []);
    for (const photoId of photoIds) {
      await tx.objectStore("photos").delete(photoId);
    }
  }
  for (const message of messages) {
    if (message.appointmentId && ids.has(message.appointmentId)) {
      await tx.objectStore("messages").delete(message.id);
    }
  }
  await tx.done;

  return appointments.length;
}

export async function allAppointmentsOfTechnician(
  technicianId: string
): Promise<Appointment[]> {
  const db = await getDb();
  return db.getAllFromIndex("appointments", "byTechnician", technicianId);
}

export async function allAppointmentsForDay(date: string): Promise<Appointment[]> {
  const db = await getDb();
  const items = await db.getAllFromIndex("appointments", "byDate", date);
  return items.sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));
}

export async function appointmentsForDay(
  date: string,
  technicianId: string
): Promise<Appointment[]> {
  const db = await getDb();
  const items = await db.getAllFromIndex("appointments", "byDate", date);
  return items
    .filter((item) => item.technicianId === technicianId)
    .sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));
}

export async function availabilityForDay(
  date: string,
  technicianId: string
): Promise<AvailabilityBlock[]> {
  const db = await getDb();
  const weekday = weekdayOf(date);
  const blocks = (await db.getAllFromIndex("schedule", "byTechnician", technicianId))
    .filter((block) => block.active && block.weekday === weekday)
    .sort((a, b) => a.from.localeCompare(b.from));
  const appointments = (await db.getAllFromIndex("appointments", "byDate", date)).filter(
    (appointment) => appointment.technicianId === technicianId
  );
  const locations = await db.getAll("locations");
  const names = new Map(locations.map((location) => [location.id, location.name]));

  return blocks.map((block) => {
    const occupied = appointments.filter(
      (appointment) =>
        appointment.locationId === block.locationId &&
        OCCUPYING.has(appointment.status) &&
        windowOf(appointment.type) === block.window
    ).length;
    const free = Math.max(0, block.capacity - occupied);
    return {
      ...block,
      locationName: names.get(block.locationId) ?? block.locationId,
      occupied,
      free,
      state: free === 0 ? "full" : free === 1 ? "last" : "available",
    };
  });
}

export async function listInbox(): Promise<InboxMessage[]> {
  const db = await getDb();
  const items = await db.getAllFromIndex("messages", "byInbox", 1);
  return items.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export async function inboxCount(): Promise<number> {
  const db = await getDb();
  return db.countFromIndex("messages", "byInbox", 1);
}

export async function weekOverview(
  fromDate: string,
  technicianId: string
): Promise<DaySummary[]> {
  const summary: DaySummary[] = [];

  for (let offset = 0; offset < 7; offset += 1) {
    const date = isoWithOffset(fromDate, offset);
    const [appointments, availability] = await Promise.all([
      appointmentsForDay(date, technicianId),
      availabilityForDay(date, technicianId),
    ]);
    summary.push({
      date,
      appointments: appointments.filter((item) => OCCUPYING.has(item.status)).length,
      free: availability.reduce((total, block) => total + block.free, 0),
    });
  }

  return summary;
}

export async function historyForClient(clientId: string): Promise<Appointment[]> {
  const db = await getDb();
  const items = await db.getAllFromIndex("appointments", "byClient", clientId);
  return items.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

export async function setAppointmentStatus(
  id: string,
  status: AppointmentStatus
): Promise<void> {
  const db = await getDb();
  const appointment = await db.get("appointments", id);
  if (!appointment) return;
  await db.put("appointments", {
    ...appointment,
    status,
    updatedAt: new Date().toISOString(),
  });
}

export async function rescheduleAppointment(id: string, date: string): Promise<void> {
  const db = await getDb();
  const appointment = await db.get("appointments", id);
  if (!appointment) return;
  const [year, month, day] = date.split("-").map(Number);
  await db.put("appointments", {
    ...appointment,
    date,
    weekday: new Date(year, month - 1, day).getDay(),
    status: "scheduled",
    updatedAt: new Date().toISOString(),
  });
}

export async function closeAppointment(
  id: string,
  data: {
    status: AppointmentStatus;
    notes: string;
    newPhotos?: { blob: Blob; mimeType: string }[];
    removePhotoIds?: string[];
  }
): Promise<void> {
  const db = await getDb();
  const appointment = await db.get("appointments", id);
  if (!appointment) return;

  const now = new Date().toISOString();
  const currentIds =
    appointment.photoIds ?? (appointment.photoId ? [appointment.photoId] : []);
  const removing = data.removePhotoIds ?? [];
  const kept = currentIds.filter((photoId) => !removing.includes(photoId));

  for (const photoId of removing) {
    await db.delete("photos", photoId);
  }

  const added: string[] = [];
  for (const photo of data.newPhotos ?? []) {
    const photoId = await nextId(db, "photos", "P");
    await db.put("photos", {
      id: photoId,
      appointmentId: id,
      blob: photo.blob,
      mimeType: photo.mimeType,
      createdAt: now,
    });
    added.push(photoId);
  }

  await db.put("appointments", {
    ...appointment,
    status: data.status,
    notes: data.notes.trim() || null,
    closedAt: now,
    photoIds: [...kept, ...added],
    updatedAt: now,
  });
}

export async function photosForAppointment(appointmentId: string): Promise<VisitPhoto[]> {
  const db = await getDb();
  const items = await db.getAllFromIndex("photos", "byAppointment", appointmentId);
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getPhoto(id: string): Promise<VisitPhoto | undefined> {
  const db = await getDb();
  return db.get("photos", id);
}

export async function listSchedule(technicianId: string): Promise<ScheduleBlock[]> {
  const db = await getDb();
  const blocks = await db.getAllFromIndex("schedule", "byTechnician", technicianId);
  return blocks.sort((a, b) => a.weekday - b.weekday || a.from.localeCompare(b.from));
}

export async function updateScheduleBlock(
  id: string,
  patch: Partial<ScheduleBlock>
): Promise<void> {
  const db = await getDb();
  const block = await db.get("schedule", id);
  if (!block) return;
  await db.put("schedule", { ...block, ...patch });
}

export async function clearAll(): Promise<void> {
  const db = await getDb();
  const stores = ["appointments", "clients", "vehicles", "messages"] as const;
  const tx = db.transaction(stores, "readwrite");
  await Promise.all(stores.map((store) => tx.objectStore(store).clear()));
  await tx.done;
}
