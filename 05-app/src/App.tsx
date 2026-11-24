import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { parseMessage, splitMessages } from "./parser.js";
import {
  allAppointmentsForDay,
  allAppointmentsOfTechnician,
  appointmentsForDay,
  availabilityForDay,
  capacityFor,
  clearTechnicianData,
  clientsOfTechnician,
  closeAppointment,
  countAppointments,
  createLocation,
  createTechnician,
  deleteMessage,
  deleteTechnician,
  findMatch,
  getAdminPin,
  getClient,
  getSetting,
  photosForAppointment,
  putTechnician,
  removeTechnicianRecord,
  getTechnician,
  historyForClient,
  inboxCount as countInbox,
  isoWithOffset,
  listInbox,
  listLocations,
  listSchedule,
  listTechnicians,
  nextFreeSlot,
  rescheduleAppointment,
  resolveLocationText,
  saveDrafts,
  seedDemoData,
  setAdminPin,
  setAppointmentStatus,
  setSetting,
  suggestLocationId,
  timeConflict,
  todayIso,
  updateScheduleBlock,
  updateTechnician,
  updateLocation,
  updateAppointmentSync,
  weekdayOf,
  weekOverview,
  windowOf,
} from "./db";
import { compressPhoto } from "./images";
import { exportBackup, importBackup } from "./backup";
import {
  connect as connectGoogle,
  deleteEvent as deleteGoogleEvent,
  insertEvent as insertGoogleEvent,
  isConnected as isGoogleConnected,
  patchEvent as patchGoogleEvent,
  DEFAULT_CLIENT_ID,
  type GoogleEvent,
} from "./google";
import { downloadCsv, downloadJson, downloadBlob, safeFileName } from "./export";
import { buildDaily, buildRange, uploadDaily } from "./daily";
import { pullConfig, pushConfig } from "./configSync";
import { zipSync } from "fflate";
import { attemptsLeft, clearFailures, lockRemaining, registerFailure } from "./auth";
import type {
  Alert,
  Appointment,
  AppointmentStatus,
  AvailabilityBlock,
  DaySummary,
  Draft,
  DraftMode,
  InboxMessage,
  Location,
  ParseResult,
  ReviewDraft,
  ScheduleBlock,
  ServiceType,
  Technician,
  TechnicianClient,
} from "./types";

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: "Agendada",
  to_confirm: "Por confirmar",
  confirmed: "Confirmada",
  attended: "Asistió",
  no_show: "No vino",
  rescheduled: "Reprogramada",
  cancelled: "Cancelada",
};

const STATUS_TONE: Record<AppointmentStatus, Tone> = {
  scheduled: "neutral",
  to_confirm: "warning",
  confirmed: "success",
  attended: "solid",
  no_show: "danger",
  rescheduled: "neutral",
  cancelled: "muted",
};

type Tone = "neutral" | "success" | "warning" | "danger" | "solid" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border border-line bg-surface text-muted",
  success: "bg-brand-soft text-brand",
  warning: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  solid: "bg-brand-solid text-white",
  muted: "bg-canvas text-muted line-through",
};

function Label({
  tone = "neutral",
  dot = false,
  icon,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE_CLASS[tone]}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />}
      {icon}
      {children}
    </span>
  );
}

const TYPE_LABEL: Record<ServiceType, string> = {
  maintenance: "Mantenimiento",
  revision: "Revisión",
  warranty: "Garantía",
  part: "Repuesto",
};

const WINDOW_LABEL: Record<"morning" | "afternoon", string> = {
  morning: "Jornada mañana",
  afternoon: "Jornada tarde",
};

const APP_VERSION = "0.2.2";

const longDate = new Intl.DateTimeFormat("es-CO", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const shortDate = new Intl.DateTimeFormat("es-CO", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

function formatLong(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return longDate.format(new Date(year, month - 1, day));
}

function formatShort(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return shortDate.format(new Date(year, month - 1, day));
}

function money(value: number | null): string {
  if (value === null) return "";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function App() {
  const [technician, setTechnician] = useState<Technician | null>(null);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState<"today" | "inbox" | "week" | "clients">("today");
  const [sheet, setSheet] = useState<"actions" | "paste" | "review" | null>(null);
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<ReviewDraft[]>([]);
  const [today, setToday] = useState(todayIso());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [availability, setAvailability] = useState<AvailabilityBlock[]>([]);
  const [inbox, setInbox] = useState<InboxMessage[]>([]);
  const [inboxTotal, setInboxTotal] = useState(0);
  const [week, setWeek] = useState<DaySummary[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [clients, setClients] = useState<TechnicianClient[]>([]);
  const [clientHistory, setClientHistory] = useState<TechnicianClient | null>(null);
  const [clientAppointments, setClientAppointments] = useState<Appointment[]>([]);
  const [weekStart, setWeekStart] = useState(todayIso());
  const [weekAppointments, setWeekAppointments] = useState<Appointment[]>([]);
  const [refreshAsk, setRefreshAsk] = useState(false);
  const [dayView, setDayView] = useState<{
    date: string;
    appointments: Appointment[];
    availability: AvailabilityBlock[];
  } | null>(null);
  const [manualMessage, setManualMessage] = useState<InboxMessage | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [visit, setVisit] = useState<Appointment | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [closingReminder, setClosingReminder] = useState(false);
  const [backupDays, setBackupDays] = useState<number | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [uploadUrl, setUploadUrl] = useState("");
  const [uploadToken, setUploadToken] = useState("");
  const [autoUpload, setAutoUpload] = useState(false);
  const [autoUploading, setAutoUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastKind, setToastKind] = useState<"ok" | "error">("ok");

  function showToast(message: string, kind: "ok" | "error" = "ok") {
    setToastKind(kind);
    setToast(message);
  }
  const [theme, setTheme] = useState<"light" | "dim">(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dim") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dim" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  const refresh = useCallback(async () => {
    if (!technician) return;
    const current = todayIso();
    setToday(current);
    const [dayAppointments, dayAvailability, inboxItems, inboxCount, weekDays, locationList, clientList] =
      await Promise.all([
        appointmentsForDay(current, technician.id),
        availabilityForDay(current, technician.id),
        listInbox(),
        countInbox(),
        weekOverview(current, technician.id),
        listLocations(false),
        clientsOfTechnician(technician.id),
      ]);
    setAppointments(dayAppointments);
    setAvailability(dayAvailability);
    setInbox(inboxItems);
    setInboxTotal(inboxCount);
    setWeek(weekDays);
    setLocations(locationList);
    setClients(clientList);

    const [backup, closing] = await Promise.all([
      getSetting("lastBackupAt"),
      getSetting("closingReminder"),
    ]);
    setLastBackupAt(backup);
    setClosingReminder(closing === "1");

    const [url, token, auto] = await Promise.all([
      getSetting("uploadUrl"),
      getSetting("uploadToken"),
      getSetting("autoUpload"),
    ]);
    setUploadUrl(url ?? "");
    setUploadToken(token ?? "");
    setAutoUpload(auto === "1");
    setGoogleConnected(isGoogleConnected());
    if (backup) {
      const days = Math.floor((Date.now() - new Date(backup).getTime()) / 86_400_000);
      setBackupDays(days >= 7 ? days : null);
    } else {
      setBackupDays(999);
    }
  }, [technician]);

  useEffect(() => {
    if (!closingReminder) return;

    const check = async () => {
      const now = new Date();
      if (now.getHours() < 18) return;
      const today = todayIso();
      if ((await getSetting("lastClosingPrompt")) === today) return;
      await setSetting("lastClosingPrompt", today);
      setToast("Cierre del día: exportá el resumen desde el perfil.");
      void autoUploadDay();
    };

    void check();
    const timer = setInterval(() => void check(), 60_000);
    return () => clearInterval(timer);
  }, [closingReminder]);

  async function toggleClosingReminder(value: boolean) {
    setClosingReminder(value);
    await setSetting("closingReminder", value ? "1" : "0");
  }

  async function markBackupDone() {
    const now = new Date().toISOString();
    setLastBackupAt(now);
    setBackupDays(null);
    await setSetting("lastBackupAt", now);
  }

  /** After 18:00 the day is closed; before that, the pending day is yesterday. */
  function autoTargetDate(): string {
    const today = todayIso();
    return new Date().getHours() >= 18 ? today : isoWithOffset(today, -1);
  }

  async function autoUploadDay(quiet = true) {
    if (!autoUpload || !uploadUrl.trim()) return;

    try {
      const last = await getSetting("lastAutoUploadDate");
      const target = autoTargetDate();
      if (last && last >= target) return;

      setAutoUploading(true);
      const start = last && last < target ? isoWithOffset(last, 1) : target;
      const payload = await buildRange(start, target);

      if (!payload.total) {
        await setSetting("lastAutoUploadDate", target);
        return;
      }

      const message = await uploadDaily(uploadUrl.trim(), uploadToken.trim(), payload);
      await setSetting("lastAutoUploadDate", target);
      if (!quiet) setToast(message);
    } catch (error) {
      if (!quiet) showToast(error instanceof Error ? error.message : "No se pudo subir", "error");
    } finally {
      setAutoUploading(false);
    }
  }

  async function pushSharedConfig(notify = false) {
    try {
      const [url, token] = await Promise.all([
        getSetting("uploadUrl"),
        getSetting("uploadToken"),
      ]);
      if (!url || !token) {
        if (notify) showToast("Faltan la URL y el token en este equipo", "error");
        return;
      }

      const [list, adminPin, adminHint] = await Promise.all([
        listTechnicians(true),
        getAdminPin(),
        getSetting("adminHint"),
      ]);
      await pushConfig(url, token, {
        adminPin,
        adminHint: adminHint ?? "",
        technicians: list,
      });
      if (notify) showToast("Configuración compartida actualizada");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "No se pudo sincronizar la configuración",
        "error"
      );
    }
  }

  async function testUpload() {
    const url = uploadUrl.trim();
    if (!url) {
      showToast("Pegá la URL del Apps Script primero", "error");
      return;
    }
    try {
      const response = await fetch(url, { method: "GET" });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        tokenConfigurado?: boolean;
      };
      if (data?.ok) {
        showToast(data.tokenConfigurado ? "Conexión OK · con token" : "Conexión OK · sin token");
      } else {
        showToast(data?.error ?? "Respuesta inesperada", "error");
      }
    } catch {
      showToast("No se pudo conectar con el script", "error");
    }
  }

  async function manualUpload() {
    if (!uploadUrl.trim()) {
      setToast("Configurá la URL del Apps Script en Mi perfil");
      return;
    }

    setAutoUploading(true);
    try {
      const today = todayIso();
      const last = await getSetting("lastAutoUploadDate");
      const start = last && last < today ? isoWithOffset(last, 1) : today;
      const payload = await buildRange(start, today);

      if (!payload.total) {
        setToast("No hay citas nuevas para subir");
        return;
      }

      const message = await uploadDaily(uploadUrl.trim(), uploadToken.trim(), payload);
      await setSetting("lastAutoUploadDate", today);
      showToast(message);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo subir", "error");
    } finally {
      setAutoUploading(false);
    }
  }

  useEffect(() => {
    if (!technician || !autoUpload || !uploadUrl.trim()) return;

    void autoUploadDay();
    const timer = setInterval(() => void autoUploadDay(), 10 * 60 * 1000);
    const onFocus = () => void autoUploadDay();
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [technician?.id, autoUpload, uploadUrl, uploadToken]);

  async function pullSharedConfig() {
    try {
      const [url, token] = await Promise.all([
        getSetting("uploadUrl"),
        getSetting("uploadToken"),
      ]);
      if (!url || !token) return;

      const shared = await pullConfig(url, token);
      if (!shared) return;

      for (const tech of shared.technicians) {
        await putTechnician(tech);
      }

      const cloudIds = new Set(shared.technicians.map((tech) => tech.id));
      for (const local of await listTechnicians(true)) {
        if (!cloudIds.has(local.id)) await removeTechnicianRecord(local.id);
      }

      await setAdminPin(shared.adminPin);
      await setSetting("adminHint", shared.adminHint ?? "");
      setTechnicians(await listTechnicians());
      if (technician) {
        const fresh = await getTechnician(technician.id);
        if (fresh) setTechnician(fresh);
      }
    } catch {
      // Sin red o sin config: se usa lo local.
    }
  }

  useEffect(() => {
    void (async () => {
      await pullSharedConfig();

      const savedId = localStorage.getItem("technicianId");
      if (savedId) {
        const found = await getTechnician(savedId);
        if (found) setTechnician(found);
      }
      setBooting(false);
    })();
  }, []);

  useEffect(() => {
    const onFocus = () => {
      if (technician) void pullSharedConfig();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [technician?.id]);

  useEffect(() => {
    if (technician) void refresh();
  }, [technician, refresh]);

  useEffect(() => {
    if (!technician) return;
    void (async () => {
      const days = await weekOverview(weekStart, technician.id);
      setWeek(days);
      const lists = await Promise.all(
        days.map((day) => appointmentsForDay(day.date, technician.id))
      );
      setWeekAppointments(lists.flat());
    })();
  }, [weekStart, technician]);

  function switchTechnician() {
    localStorage.removeItem("technicianId");
    setTechnician(null);
    setView("today");
  }

  function exportCalendar() {
    if (weekAppointments.length === 0) return;

    const stamp = `${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
    const place = new Map(locations.map((location) => [location.id, location.name]));
    const addHour = (time: string) =>
      `${String(Number(time.slice(0, 2)) + 1).padStart(2, "0")}:${time.slice(3)}`;

    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Chispa Taller//ES"];

    for (const appointment of weekAppointments) {
      if (!appointment.date || !appointment.time) continue;
      if (appointment.status === "cancelled") continue;

      const day = appointment.date.replace(/-/g, "");
      const start = `${day}T${appointment.time.replace(":", "")}00`;
      const endTime = appointment.endTime ?? addHour(appointment.time);
      const end = `${day}T${endTime.replace(":", "")}00`;
      const summary = `${appointment.type ? TYPE_LABEL[appointment.type] : "Cita"} · ${
        appointment.name ?? ""
      }`;

      lines.push(
        "BEGIN:VEVENT",
        `UID:${appointment.id}@chispatalle`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${start}`,
        `DTEND:${end}`,
        `SUMMARY:${summary}`,
        `LOCATION:${appointment.locationId ? place.get(appointment.locationId) ?? "" : ""}`,
        `DESCRIPTION:${(appointment.description ?? "").replace(/\n/g, " ")}`,
        "END:VEVENT"
      );
    }

    lines.push("END:VCALENDAR");
    downloadBlob(
      "chispa-taller.ics",
      new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" })
    );
  }

  async function refreshAll() {
    await refresh();
    if (!technician) return;
    const days = await weekOverview(weekStart, technician.id);
    setWeek(days);
    const lists = await Promise.all(
      days.map((day) => appointmentsForDay(day.date, technician.id))
    );
    setWeekAppointments(lists.flat());
  }

  function googleBody(appointment: Appointment): GoogleEvent {
    const place = locations.find((location) => location.id === appointment.locationId)?.name ?? "";
    const day = appointment.date as string;
    const time = appointment.time as string;
    const endTime =
      appointment.endTime ?? `${String(Number(time.slice(0, 2)) + 1).padStart(2, "0")}:00`;

    return {
      summary: `${appointment.type ? TYPE_LABEL[appointment.type] : "Cita"} · ${
        appointment.name ?? ""
      }`,
      location: place,
      description: `Cita ${appointment.id}`,
      start: { dateTime: `${day}T${time}:00`, timeZone: "America/Bogota" },
      end: { dateTime: `${day}T${endTime}:00`, timeZone: "America/Bogota" },
    };
  }

  async function syncGoogle(force = false, quiet = false) {
    if (!technician || !isGoogleConnected() || syncing) return;

    setSyncing(true);
    try {
      const days = await weekOverview(weekStart, technician.id);
      const lists = await Promise.all(
        days.map((day) => appointmentsForDay(day.date, technician.id))
      );
      const appointments = lists.flat();

      const pending = appointments.filter((appointment) => {
        if (appointment.status === "cancelled") return Boolean(appointment.googleEventId);
        if (!appointment.googleEventId) return true;
        return (
          force || (appointment.updatedAt ?? "") > (appointment.googleSyncedAt ?? "")
        );
      });

      if (!pending.length) {
        if (!quiet) setToast("Google Calendar ya está al día");
        return;
      }

      for (const appointment of pending) {
        if (appointment.status === "cancelled" && appointment.googleEventId) {
          await deleteGoogleEvent(appointment.googleEventId);
          await updateAppointmentSync(appointment.id, null, new Date().toISOString());
          continue;
        }
        if (!appointment.date || !appointment.time) continue;

        const body = googleBody(appointment);
        if (appointment.googleEventId) {
          await patchGoogleEvent(appointment.googleEventId, body);
          await updateAppointmentSync(
            appointment.id,
            appointment.googleEventId,
            new Date().toISOString()
          );
        } else {
          const eventId = await insertGoogleEvent(body);
          await updateAppointmentSync(appointment.id, eventId, new Date().toISOString());
        }
      }

      await refreshAll();
      setToast(
        `${pending.length} cita${pending.length === 1 ? "" : "s"} sincronizada${
          pending.length === 1 ? "" : "s"
        } con Google`
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message.slice(0, 70) : "No se pudo sincronizar", "error");
    } finally {
      setSyncing(false);
    }
  }

  async function handleConnectGoogle(clientId: string) {
    try {
      await connectGoogle(clientId);
      setGoogleConnected(true);
      await syncGoogle(true);
      setToast("Google Calendar conectado");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo conectar con Google", "error");
    }
  }

  async function openClient(client: TechnicianClient) {
    setClientHistory(client);
    setClientAppointments(await historyForClient(client.clientId));
  }

  async function openDay(date: string) {
    if (!technician) return;
    const [appointments, availability] = await Promise.all([
      appointmentsForDay(date, technician.id),
      availabilityForDay(date, technician.id),
    ]);
    setDayView({ date, appointments, availability });
  }

  async function exportWeek() {
    if (!technician) return;

    const [appointments, schedule, clients, places] = await Promise.all([
      allAppointmentsOfTechnician(technician.id),
      listSchedule(technician.id),
      clientsOfTechnician(technician.id),
      listLocations(true),
    ]);

    const place = new Map(places.map((location) => [location.id, location.name]));

    const mapAppointment = (appointment: Appointment) => ({
      id: appointment.id,
      hora: appointment.time,
      cliente: appointment.name,
      telefono: appointment.phone,
      vehiculo: appointment.model,
      tipo: appointment.type,
      tipoTexto: appointment.type ? TYPE_LABEL[appointment.type] : null,
      estado: appointment.status,
      estadoTexto: STATUS_LABEL[appointment.status],
      local: appointment.locationId ? place.get(appointment.locationId) ?? null : null,
      monto: appointment.amount,
      observaciones: appointment.notes,
    });

    const grouped = new Map<string, Appointment[]>();
    for (const appointment of appointments) {
      const key = appointment.date ?? "";
      const list = grouped.get(key) ?? [];
      list.push(appointment);
      grouped.set(key, list);
    }

    const dates = [...grouped.keys()].filter(Boolean).sort();
    const days = [];

    for (const date of dates) {
      const availability = await availabilityForDay(date, technician.id);
      days.push({
        fecha: date,
        cupos: availability.map((block) => ({
          jornada: block.window,
          jornadaTexto: WINDOW_LABEL[block.window],
          desde: block.from,
          hasta: block.to,
          local: block.locationName,
          cupo: block.capacity,
          ocupados: block.occupied,
          libres: block.free,
        })),
        citas: (grouped.get(date) ?? [])
          .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""))
          .map(mapAppointment),
      });
    }

    downloadJson(`agenda-completa-${todayIso()}.json`, {
      generadoEn: new Date().toISOString(),
      tecnico: { id: technician.id, nombre: technician.name },
      locales: places.map((location) => ({
        id: location.id,
        nombre: location.name,
        ciudad: location.city,
        activo: location.active !== false,
      })),
      horario: schedule.map((block) => ({
        diaSemana: block.weekday,
        jornada: block.window,
        desde: block.from,
        hasta: block.to,
        local: place.get(block.locationId) ?? null,
        cupo: block.capacity,
        activo: block.active,
      })),
      clientes: clients.map((client) => ({
        nombre: client.name,
        telefono: client.phone,
        visitas: client.visits,
        ultimaVisita: client.lastDate,
      })),
      totalCitas: appointments.length,
      dias: days,
      sinFecha: (grouped.get("") ?? []).map(mapAppointment),
    });
  }

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const freeSlots = useMemo(
    () => availability.reduce((total, block) => total + block.free, 0),
    [availability]
  );

  async function handleProcess(input: string) {
    if (!technician) return;
    const blocks = splitMessages(input);
    const results = blocks.map(
      (block) => parseMessage(block, { receivedAt: new Date() }) as ParseResult
    );

    const prepared = await Promise.all(
      results.map(async (result) => {
        const appointment = result.appointment;
        const fromText = await resolveLocationText(appointment.location);
        const suggested = appointment.date
          ? await suggestLocationId(appointment.date, appointment.type, technician.id)
          : null;
        const match = await findMatch(appointment, technician.id);
        const mode: DraftMode = match
          ? appointment.intent === "cancel"
            ? "cancel"
            : appointment.intent === "reschedule"
              ? "reschedule"
              : "update"
          : "create";
        const capacity = appointment.date
          ? await capacityFor(appointment.date, appointment.type, technician.id)
          : null;
        const conflict =
          appointment.date && appointment.time && mode !== "cancel"
            ? await timeConflict(
                appointment.date,
                appointment.time,
                technician.id,
                mode === "create" ? undefined : match?.id
              )
            : null;
        const capacityFull = mode !== "update" && capacity ? capacity.free <= 0 : false;
        const blocked = capacityFull || Boolean(conflict);
        const suggestion =
          blocked && appointment.date
            ? await nextFreeSlot(appointment.date, appointment.type, technician.id)
            : null;

        return {
          ...appointment,
          alerts: result.alerts,
          locationId: fromText ?? suggested,
          mode,
          matchId: match?.id ?? null,
          matchLabel: match
            ? `${match.name} · ${match.date}${match.time ? ` · ${match.time}` : ""}`
            : null,
          capacityFull,
          capacityLabel: capacity ? `${capacity.occupied}/${capacity.capacity}` : null,
          conflict: conflict
            ? `${conflict.name ?? "otra cita"}${conflict.time ? ` a las ${conflict.time}` : ""}`
            : null,
          suggestion,
        } as ReviewDraft;
      })
    );

    setDrafts(prepared);
    setSheet("review");
  }

  async function handleConfirm() {
    if (!technician || busy) return;
    setBusy(true);
    try {
      const otherDays = drafts.filter((draft) => draft.date && draft.date !== today).length;
      const result = await saveDrafts(drafts, technician.id);
      setSheet(null);
      setDrafts([]);
      setText("");
      await refresh();
      void syncGoogle();
      const parts = [`${result.saved} cita${result.saved === 1 ? "" : "s"} guardada${result.saved === 1 ? "" : "s"}`];
      if (result.inbox) parts.push(`${result.inbox} a bandeja`);
      if (otherDays) parts.push(`${otherDays} para otro día`);
      setToast(parts.join(" · "));
    } finally {
      setBusy(false);
    }
  }

  async function handleClipboard() {
    try {
      const value = await navigator.clipboard.readText();
      if (!value.trim()) {
        setToast("El portapapeles está vacío.");
        return;
      }
      setText((current) => (current.trim() ? `${current}\n\n${value}` : value));
    } catch {
      showToast("El navegador no dejó leer el portapapeles. Pegá con Ctrl+V.", "error");
    }
  }

  if (booting) {
    return (
      <div className="flex min-h-full items-center justify-center text-sm text-muted">
        Cargando…
      </div>
    );
  }

  if (adminUnlocked) {
    return (
      <>
        <AdminView
          onToast={setToast}
          onConfigChanged={() => void pushSharedConfig()}
          onSyncConfig={() => void pushSharedConfig(true)}
          onClose={() => {
            setAdminUnlocked(false);
            void listTechnicians().then(setTechnicians);
          }}
        />
        <Toast message={toast} kind={toastKind} />
      </>
    );
  }

  if (!technician) {
    return (
      <Login
        technicians={technicians}
        theme={theme}
        onToggleTheme={() => setTheme(theme === "dim" ? "light" : "dim")}
        onAdminRequest={async (pin) => (await getAdminPin()) === pin}
        onAdmin={() => setAdminUnlocked(true)}
        onLogin={(selected) => {
          localStorage.setItem("technicianId", selected.id);
          setTechnician(selected);
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col">
      <header className="sticky top-0 z-10 bg-canvas/95 px-5 pb-3 pt-6 backdrop-blur">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="flex items-center gap-2 text-left"
            title="Mi perfil"
          >
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white"
              style={{ backgroundColor: technician.color }}
            >
              {technician.name.trim().charAt(0).toUpperCase()}
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand">
              {technician.name}
            </span>
            <span className="text-[10px] text-muted">cambiar</span>
          </button>
          <div className="flex items-center gap-2">
            <ThemeToggle
              theme={theme}
              onToggle={() => setTheme(theme === "dim" ? "light" : "dim")}
            />
            <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand">
              {freeSlots} cupo{freeSlots === 1 ? "" : "s"} libre{freeSlots === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <h1 className="mt-1 text-[22px] font-extrabold capitalize leading-tight">
          {formatLong(today)}
        </h1>
      </header>

      <main className="flex-1 px-5 pb-36">
        {view === "today" && (
          <TodayView
            appointments={appointments}
            availability={availability}
            onAdd={() => setSheet("actions")}
            onOpen={setVisit}
            backupDays={backupDays}
            onBackup={() => setProfileOpen(true)}
          />
        )}
        {view === "inbox" && (
          <InboxView messages={inbox} onAdd={() => setSheet("actions")} onClassify={setManualMessage} />
        )}
        {view === "week" && (
          <WeekView
            days={week}
            appointments={weekAppointments}
            onShift={(offset) => setWeekStart(isoWithOffset(weekStart, offset))}
            onOpenDay={(date) => void openDay(date)}
            onOpen={(appointment) => setVisit(appointment)}
            onExport={() => void exportWeek()}
            onSyncGoogle={() => {
              if (!isGoogleConnected()) {
                setToast("Conectá Google Calendar en Mi perfil");
                return;
              }
              void syncGoogle(true);
            }}
            googleConnected={googleConnected}
            onRefresh={() => setRefreshAsk(true)}
          />
        )}
        {view === "clients" && (
          <ClientsView clients={clients} onOpen={(client) => void openClient(client)} onAdd={() => setSheet("actions")} />
        )}
      </main>

      <button
        type="button"
        onClick={() => setSheet("actions")}
        aria-label="Agregar"
        className="fixed bottom-24 right-5 z-20 grid h-14 w-14 place-items-center rounded-full bg-brand-solid text-white shadow-xl shadow-brand-solid/30 active:scale-95"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-7 w-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <BottomNav view={view} onChange={setView} inboxCount={inboxTotal} />

      {sheet === "actions" && (
        <Sheet title="Agregar" onClose={() => setSheet(null)}>
          <SheetAction
            title="Pegar mensaje de WhatsApp"
            hint="Copiado del chat, tal cual"
            onClick={() => setSheet("paste")}
          />
          <SheetAction
            title="Cargar cita a mano"
            hint="Sin pasar por WhatsApp"
            onClick={() => {
              setSheet(null);
              setManualOpen(true);
            }}
          />
          <SheetAction
            title="Mi horario de trabajo"
            hint="Bloques, cupos y locales"
            onClick={() => {
              setSheet(null);
              setScheduleOpen(true);
            }}
          />
        </Sheet>
      )}

      {sheet === "paste" && (
        <Sheet title="Pegar mensaje" onClose={() => setSheet(null)}>
          <p className="mb-3 text-sm text-muted">
            Copiá el mensaje desde WhatsApp y pegalo acá. Podés pegar varios de una vez.
          </p>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={7}
            placeholder="PROGRAMACION DE MANTENIMIENTO…"
            className="w-full resize-none rounded-2xl border border-line bg-surface p-3 text-sm outline-none focus:border-brand"
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleClipboard}
              className="h-12 rounded-xl border border-line bg-surface text-sm font-semibold text-ink active:scale-[0.99]"
            >
              Pegar del portapapeles
            </button>
            <button
              type="button"
              disabled={!text.trim()}
              onClick={() => void handleProcess(text)}
              className="h-12 rounded-xl bg-brand-solid text-sm font-semibold text-white active:scale-[0.99] disabled:opacity-40"
            >
              Procesar
            </button>
          </div>
        </Sheet>
      )}

      {sheet === "review" && (
        <ReviewSheet
          drafts={drafts}
          locations={locations}
          busy={busy}
          onChange={setDrafts}
          onCancel={() => setSheet(null)}
          onConfirm={() => void handleConfirm()}
        />
      )}

      {scheduleOpen && (
        <ScheduleSheet
          technicianId={technician.id}
          locations={locations}
          onClose={() => setScheduleOpen(false)}
          onChanged={() => void refresh()}
        />
      )}

      {clientHistory && (
        <ClientSheet
          client={clientHistory}
          appointments={clientAppointments}
          onClose={() => setClientHistory(null)}
          onOpen={(appointment) => {
            setClientHistory(null);
            setVisit(appointment);
          }}
        />
      )}

      {dayView && (
        <DaySheet
          date={dayView.date}
          appointments={dayView.appointments}
          availability={dayView.availability}
          onClose={() => setDayView(null)}
          onOpen={(appointment) => {
            setDayView(null);
            setVisit(appointment);
          }}
          onAdd={() => {
            setDayView(null);
            setSheet("actions");
          }}
        />
      )}

      {manualOpen && technician && (
        <ManualAppointmentSheet
          message={null}
          technicianId={technician.id}
          locations={locations}
          onClose={() => setManualOpen(false)}
          onSaved={async () => {
            setManualOpen(false);
            await refresh();
            void syncGoogle();
            setToast("Cita creada");
          }}
        />
      )}

      {manualMessage && technician && (
        <ManualAppointmentSheet
          message={manualMessage}
          technicianId={technician.id}
          locations={locations}
          onClose={() => setManualMessage(null)}
          onSaved={async () => {
            setManualMessage(null);
            await refresh();
            setToast("Cita creada desde la bandeja");
          }}
        />
      )}

      {visit && (
        <VisitSheet
          appointment={visit}
          locations={locations}
          onClose={() => setVisit(null)}
          onSaved={async () => {
            setVisit(null);
            await refresh();
            void syncGoogle();
            setToast("Visita cerrada");
          }}
        />
      )}

      {refreshAsk && (
        <ConfirmSheet
          title="Actualizar"
          body="Se recargan los datos guardados en este dispositivo. No se borra nada."
          confirmLabel="Sí, actualizar"
          onCancel={() => setRefreshAsk(false)}
          onConfirm={() => {
            setRefreshAsk(false);
            void refreshAll().then(() => setToast("Datos actualizados"));
          }}
        />
      )}

      {profileOpen && (
        <ProfileSheet
          technician={technician}
          lastBackupAt={lastBackupAt}
          closingReminder={closingReminder}
          onToggleClosing={(value) => void toggleClosingReminder(value)}
          onBackupDone={() => void markBackupDone()}
          googleConnected={googleConnected}
          syncing={syncing}
          onConnectGoogle={handleConnectGoogle}
          onSyncGoogle={() => void syncGoogle(true)}
          uploadUrl={uploadUrl}
          uploadToken={uploadToken}
          autoUpload={autoUpload}
          uploading={autoUploading}
          onManualUpload={() => void manualUpload()}
          onTestUpload={() => void testUpload()}
          onSaveUpload={(url, token, auto) => {
            setUploadUrl(url);
            setUploadToken(token);
            setAutoUpload(auto);
            setToast(auto ? "Cierre automático activado" : "Cierre automático desactivado");
          }}
          onToast={setToast}
          onClose={() => setProfileOpen(false)}
          onSaved={async () => {
            const updated = await getTechnician(technician.id);
            if (updated) setTechnician(updated);
            void pushSharedConfig();
            setProfileOpen(false);
            setToast("Perfil actualizado");
          }}
          onLogout={switchTechnician}
        />
      )}

      <Toast message={toast} kind={toastKind} />
    </div>
  );
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`animate-spin ${className}`}
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Toast({ message, kind = "ok" }: { message: string | null; kind?: "ok" | "error" }) {
  if (!message) return null;

  return (
    <div className="fixed left-1/2 top-24 z-40 flex animate-toast -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white shadow-lg">
      {kind === "ok" ? (
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5 text-green-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5 text-red-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      )}
      {message}
    </div>
  );
}

function TodayView({
  appointments,
  availability,
  onAdd,
  onOpen,
  backupDays,
  onBackup,
}: {
  appointments: Appointment[];
  availability: AvailabilityBlock[];
  onAdd: () => void;
  onOpen: (appointment: Appointment) => void;
  backupDays: number | null;
  onBackup: () => void;
}) {
  const morning = appointments.filter((item) => windowOf(item.type) === "morning");
  const afternoon = appointments.filter((item) => windowOf(item.type) === "afternoon");

  return (
    <div className="space-y-6">
      {backupDays !== null && (
        <button
          type="button"
          onClick={onBackup}
          className="w-full rounded-xl bg-warn-soft px-3 py-2 text-left text-[11px] font-medium text-warn"
        >
          <b>Respaldo pendiente.</b>{" "}
          {backupDays === 999 ? "Nunca exportaste." : `Hace ${backupDays} días que no respaldás.`}{" "}
          Tocá para abrir Mi perfil.
        </button>
      )}

      {availability.length === 0 && (
        <p className="rounded-2xl border border-dashed border-line bg-surface/60 p-4 text-sm text-muted">
          Hoy no hay horario configurado.
        </p>
      )}

      {availability.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {(["morning", "afternoon"] as const).map((window) => {
            const block = availability.find((item) => item.window === window);
            return (
              <div
                key={window}
                className={`rounded-2xl border px-3 py-3 ${
                  !block
                    ? "border-line bg-surface text-muted"
                    : block.state === "full"
                      ? "border-danger/30 bg-danger-soft text-danger"
                      : block.state === "last"
                        ? "border-warn/30 bg-warn-soft text-warn"
                        : "border-line bg-surface text-ink"
                }`}
              >
                <p className="flex items-center gap-1.5 text-[11px] font-bold">
                  <span className={window === "morning" ? "text-amber-500" : "text-orange-600"}>
                    <WindowIcon window={window} className="h-5 w-5" />
                  </span>
                  {WINDOW_LABEL[window]}
                </p>
                <p className="mt-1 text-[11px]">
                  {block
                    ? `${block.occupied}/${block.capacity} · ${block.locationName}`
                    : "Cerrado"}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {appointments.length === 0 ? (
        <EmptyState
          title="No hay nada cargado hoy"
          body="Pegá el mensaje que te llegó por WhatsApp y aparece acá."
          action="Pegar mensaje"
          onAction={onAdd}
          kind="calendar"
        />
      ) : (
        <>
          <AppointmentGroup
            title="Jornada mañana · 8:00–12:00"
            window="morning"
            block={availability.find((item) => item.window === "morning")}
            items={morning}
            onOpen={onOpen}
          />
          <AppointmentGroup
            title="Jornada tarde · 13:00–18:00"
            window="afternoon"
            block={availability.find((item) => item.window === "afternoon")}
            items={afternoon}
            onOpen={onOpen}
          />
        </>
      )}
    </div>
  );
}

function AppointmentGroup({
  title,
  window,
  block,
  items,
  onOpen,
}: {
  title: string;
  window: "morning" | "afternoon";
  block?: AvailabilityBlock;
  items: Appointment[];
  onOpen: (appointment: Appointment) => void;
}) {
  if (!items.length) return null;

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted">
          <span className={window === "morning" ? "text-amber-500" : "text-orange-600"}>
            <WindowIcon window={window} className="h-4 w-4" />
          </span>
          {title}
        </h2>
        {block && (
          <span className="text-[11px] font-semibold text-muted">
            {block.occupied}/{block.capacity}
          </span>
        )}
      </div>
      <div className="space-y-2">
        {items.map((appointment) => (
          <AppointmentCard key={appointment.id} appointment={appointment} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function AppointmentCard({
  appointment,
  onOpen,
}: {
  appointment: Appointment;
  onOpen: (appointment: Appointment) => void;
}) {
  const alerts = appointment.alerts ?? [];
  const critical = alerts.find((item) => item.severity !== "low");

  return (
    <article
      onClick={() => onOpen(appointment)}
      className="animate-fade cursor-pointer rounded-2xl border border-line bg-surface p-4 shadow-sm active:scale-[0.995]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold leading-tight">
            {appointment.name ?? "Sin nombre"}
          </h3>
          <p className="mt-0.5 truncate text-sm text-muted">
            {[appointment.model, appointment.time].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Label tone={STATUS_TONE[appointment.status]} dot>
          {STATUS_LABEL[appointment.status]}
        </Label>
      </div>

      {(appointment.part || appointment.description) && (
        <p className="mt-2 line-clamp-2 text-sm text-muted">
          {appointment.part ? `Repuesto: ${appointment.part}` : appointment.description}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <span className="rounded-md bg-canvas px-1.5 py-0.5 font-mono text-[10px]">
          #{appointment.id}
        </span>
        {appointment.type && <Label>{TYPE_LABEL[appointment.type]}</Label>}
        {appointment.amount !== null && (
          <span className="font-semibold text-brand">{money(appointment.amount)}</span>
        )}
        {appointment.phone && <span>{appointment.phone}</span>}
      </div>

      {critical && (
        <p className="mt-2 rounded-lg bg-warn-soft px-2 py-1.5 text-[11px] font-medium text-warn">
          {critical.message}
        </p>
      )}
    </article>
  );
}

function InboxView({
  messages,
  onAdd,
  onClassify,
}: {
  messages: InboxMessage[];
  onAdd: () => void;
  onClassify: (message: InboxMessage) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-canvas px-3 py-2 text-[11px] text-muted">
        Acá llegan los mensajes que la app <b>no pudo convertir en cita</b>. Tocá
        «Clasificar», completá los datos y se agenda.
      </p>

      {messages.length === 0 ? (
        <EmptyState
          title="No hay mensajes pendientes"
          body="Todo lo que pegaste se entendió. Si algo no se entiende, aparece acá."
          action="Pegar mensaje"
          onAction={onAdd}
          kind="message"
        />
      ) : (
        messages.map((message) => (
          <article key={message.id} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {new Date(message.receivedAt).toLocaleDateString("es-CO")}
            </p>
            <p className="mt-1 line-clamp-4 whitespace-pre-line text-sm text-ink">
              {message.text}
            </p>
            <button
              type="button"
              onClick={() => onClassify(message)}
              className="mt-3 h-9 w-full rounded-lg border border-brand/40 text-xs font-semibold text-brand"
            >
              Clasificar
            </button>
          </article>
        ))
      )}
    </div>
  );
}

function WeekView({
  days,
  appointments,
  onShift,
  onOpenDay,
  onOpen,
  onExport,
  onSyncGoogle,
  googleConnected,
  onRefresh,
}: {
  days: DaySummary[];
  appointments: Appointment[];
  onShift: (offset: number) => void;
  onOpenDay: (date: string) => void;
  onOpen: (appointment: Appointment) => void;
  onExport: () => void;
  onSyncGoogle: () => void;
  googleConnected: boolean;
  onRefresh: () => void;
}) {
  const [mode, setMode] = useState<"list" | "calendar">("list");
  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-xl border border-line bg-surface px-2 py-1.5">
        <button
          type="button"
          onClick={() => onShift(-7)}
          className="grid h-8 w-8 place-items-center rounded-lg text-lg text-muted"
          aria-label="Semana anterior"
        >
          ‹
        </button>
        <span className="text-[11px] font-semibold capitalize text-muted">
          {first && last ? `${formatShort(first)} — ${formatShort(last)}` : "—"}
        </span>
        <button
          type="button"
          onClick={() => onShift(7)}
          className="grid h-8 w-8 place-items-center rounded-lg text-lg text-muted"
          aria-label="Semana siguiente"
        >
          ›
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {(
          [
            { key: "list", label: "Lista" },
            { key: "calendar", label: "Calendario" },
          ] as const
        ).map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setMode(option.key)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
              mode === option.key
                ? "bg-brand-solid text-white"
                : "border border-line bg-surface text-muted"
            }`}
          >
            {option.label}
          </button>
        ))}

        <button
          type="button"
          onClick={onRefresh}
          className="ml-auto rounded-full border border-line bg-surface px-3 py-1.5 text-[11px] font-semibold text-muted"
        >
          Actualizar
        </button>
      </div>

      {mode === "list" ? (
        <div className="space-y-2">
          {days.map((day) => (
            <button
              key={day.date}
              type="button"
              onClick={() => onOpenDay(day.date)}
              className="flex w-full items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 text-left active:scale-[0.99]"
            >
              <div>
                <p className="text-sm font-semibold capitalize">{formatShort(day.date)}</p>
                <p className="text-[11px] text-muted">
                  {day.appointments} cita{day.appointments === 1 ? "" : "s"}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  day.free === 0 ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand"
                }`}
              >
                {day.free === 0 ? "Lleno" : `${day.free} libres`}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div className="min-w-[680px]">
            <div className="grid grid-cols-7 gap-1">
              {days.map((day) => (
                <div
                  key={day.date}
                  className="text-center text-[10px] font-semibold capitalize text-muted"
                >
                  {formatShort(day.date)}
                </div>
              ))}
            </div>

            <div className="mt-1 grid grid-cols-7 gap-1">
              {days.map((day) => (
                <div
                  key={day.date}
                  className="relative rounded-lg border border-line bg-surface"
                  style={{ height: 11 * 40 }}
                  onClick={() => onOpenDay(day.date)}
                >
                  {appointments
                    .filter((item) => item.date === day.date && item.time)
                    .filter((item) => {
                      const hour = Number((item.time as string).slice(0, 2));
                      return hour >= 8 && hour <= 18;
                    })
                    .map((item) => {
                      const hour = Number((item.time as string).slice(0, 2));
                      const top = (hour - 8) * 40;
                      const tone =
                        item.status === "cancelled"
                          ? "border-line bg-canvas text-muted line-through"
                          : item.status === "no_show"
                            ? "border-danger/30 bg-danger-soft text-danger"
                            : item.status === "attended"
                              ? "border-brand/30 bg-brand-soft text-brand"
                              : "border-line bg-surface text-ink";
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpen(item);
                          }}
                          style={{ top, height: 38 }}
                          className={`absolute inset-x-0.5 overflow-hidden rounded-md border px-1 text-left text-[9px] leading-tight ${tone}`}
                        >
                          <span className="block font-semibold">{item.time}</span>
                          <span className="block truncate">
                            {(item.name ?? "").split(" ")[0]}
                          </span>
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={onSyncGoogle}
          className="text-[11px] font-semibold text-brand"
        >
          {googleConnected ? "Sincronizar con Google" : "Conectar Google"}
        </button>
        <button
          type="button"
          onClick={onExport}
          className="flex items-center gap-1 text-[11px] font-semibold text-brand"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3v12" />
            <path d="M7 10l5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
          Descargar todo (JSON)
        </button>
      </div>
    </div>
  );
}

function ReviewSheet({
  drafts,
  locations,
  busy,
  onChange,
  onCancel,
  onConfirm,
}: {
  drafts: ReviewDraft[];
  locations: Location[];
  busy: boolean;
  onChange: (drafts: ReviewDraft[]) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  function update(index: number, patch: Partial<ReviewDraft>) {
    onChange(drafts.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)));
  }

  return (
    <Sheet
      title={`Revisión · ${drafts.length} mensaje${drafts.length === 1 ? "" : "s"}`}
      onClose={onCancel}
    >
      <div className="max-h-[58vh] space-y-3 overflow-y-auto pr-1">
        {drafts.map((draft, index) => (
          <DraftCard
            key={`${draft.originalText.slice(0, 12)}-${index}`}
            draft={draft}
            locations={locations}
            onLocationChange={(locationId) => update(index, { locationId })}
            onMode={(mode) => update(index, { mode })}
            onUseSuggestion={(suggestion) =>
              update(index, {
                date: suggestion.date,
                weekday: weekdayOf(suggestion.date),
                time: suggestion.time,
                capacityFull: false,
                capacityLabel: null,
                conflict: null,
                suggestion: null,
              })
            }
          />
        ))}
      </div>

      {drafts.some((draft) => draft.capacityFull || draft.conflict) && (
        <p className="mt-3 rounded-lg bg-danger-soft px-2 py-1.5 text-[11px] text-danger">
          Hay citas que no caben. Usá la sugerencia o cambiá la fecha antes de confirmar.
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-12 rounded-xl border border-line bg-surface text-sm font-semibold active:scale-[0.99]"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={busy || drafts.some((draft) => draft.capacityFull || draft.conflict)}
          onClick={onConfirm}
          className="h-12 rounded-xl bg-brand-solid text-sm font-semibold text-white active:scale-[0.99] disabled:opacity-50"
        >
          {busy ? "Guardando…" : "Confirmar"}
        </button>
      </div>
    </Sheet>
  );
}

function DraftCard({
  draft,
  locations,
  onLocationChange,
  onMode,
  onUseSuggestion,
}: {
  draft: ReviewDraft;
  locations: Location[];
  onLocationChange: (locationId: string | null) => void;
  onMode: (mode: DraftMode) => void;
  onUseSuggestion: (suggestion: { date: string; time: string }) => void;
}) {
  const alerts: Alert[] = draft.alerts ?? [];
  const goesToInbox = !draft.name || !draft.date;

  const modeOptions: { key: DraftMode; label: string }[] = [
    { key: "update", label: "Actualizar" },
    { key: "reschedule", label: "Reprogramar" },
    { key: "create", label: "Crear nueva" },
  ];
  if (draft.intent === "cancel") {
    modeOptions.push({ key: "cancel", label: "Cancelar cita" });
  }

  return (
    <article className="rounded-2xl border border-line bg-canvas p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold">{draft.name ?? "Sin nombre"}</h3>
          <p className="truncate text-[11px] text-muted">
            {[draft.model, draft.type ? TYPE_LABEL[draft.type] : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        {goesToInbox && (
          <span className="shrink-0 rounded-full bg-warn-soft px-2 py-1 text-[10px] font-bold text-warn">
            Bandeja
          </span>
        )}
      </div>

      <p className="mt-2 text-[13px] font-semibold">
        {draft.date ? formatLong(draft.date) : "Sin fecha"}
        {draft.time ? ` · ${draft.time}` : ""}
      </p>

      {draft.capacityLabel && (
        <p className={`text-[10px] ${draft.capacityFull ? "text-danger" : "text-muted"}`}>
          {WINDOW_LABEL[windowOf(draft.type)]}: {draft.capacityLabel}
          {draft.capacityFull ? " · completa" : ""}
        </p>
      )}

      {draft.conflict && (
        <p className="text-[10px] text-danger">Choque de horario con {draft.conflict}</p>
      )}

      {(draft.capacityFull || draft.conflict) && (
        <div className="mt-2 rounded-lg bg-danger-soft p-2">
          <p className="text-[11px] font-semibold text-danger">No se puede registrar.</p>
          {draft.suggestion && (
            <button
              type="button"
              onClick={() => onUseSuggestion(draft.suggestion!)}
              className="mt-1 text-[11px] font-semibold text-brand underline"
            >
              Usar {formatShort(draft.suggestion.date)} · {draft.suggestion.time}
            </button>
          )}
        </div>
      )}

      <select
        value={draft.locationId ?? ""}
        onChange={(event) => onLocationChange(event.target.value || null)}
        className="mt-2 w-full rounded-lg border border-line bg-surface px-2 py-2 text-xs"
      >
        <option value="">Sin local</option>
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </select>

      {draft.matchId && (
        <div className="mt-2 rounded-lg border border-line bg-surface p-2">
          <p className="text-[10px] text-muted">Coincide con {draft.matchLabel}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {modeOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => onMode(option.key)}
                className={`flex-1 whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-semibold ${
                  draft.mode === option.key ? "bg-brand-solid text-white" : "bg-canvas text-muted"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {alerts.length > 0 && (
        <ul className="mt-2 space-y-1">
          {alerts.map((alert) => (
            <li
              key={`${alert.code}-${alert.field}`}
              className={`rounded-md px-2 py-1 text-[11px] ${
                alert.severity === "low" ? "bg-surface text-muted" : "bg-warn-soft text-warn"
              }`}
            >
              {alert.message}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function BottomNav({
  view,
  onChange,
  inboxCount,
}: {
  view: "today" | "inbox" | "week" | "clients";
  onChange: (view: "today" | "inbox" | "week" | "clients") => void;
  inboxCount: number;
}) {
  const items = [
    { key: "today", label: "Hoy" },
    { key: "inbox", label: "Mensajes" },
    { key: "week", label: "Semana" },
    { key: "clients", label: "Clientes" },
  ] as const;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto grid max-w-md grid-cols-4">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            aria-current={view === item.key ? "page" : undefined}
            className={`relative py-3 text-xs font-semibold ${
              view === item.key ? "text-brand" : "text-muted"
            }`}
          >
            {item.label}
            {item.key === "inbox" && inboxCount > 0 && (
              <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                {inboxCount}
              </span>
            )}
            {view === item.key && (
              <span className="absolute inset-x-6 bottom-1 h-0.5 rounded-full bg-brand" />
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}

function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex animate-fade items-end justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md animate-sheet rounded-t-3xl bg-canvas p-5 pb-8 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="text-sm font-semibold text-muted">
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SheetAction({
  title,
  hint,
  onClick,
  disabled,
}: {
  title: string;
  hint: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mb-2 flex w-full items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 text-left active:scale-[0.99] disabled:opacity-50"
    >
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-[11px] text-muted">{hint}</span>
      </span>
      <span className="text-lg text-muted">›</span>
    </button>
  );
}

function Illustration({ kind }: { kind: "calendar" | "message" | "clients" }) {
  return (
    <svg
      viewBox="0 0 96 96"
      className="mx-auto mb-3 h-20 w-20 animate-float text-brand"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="48" cy="52" r="30" fill="var(--color-brand-soft)" stroke="none" opacity="0.6" />
      {kind === "calendar" && (
        <>
          <rect x="28" y="32" width="40" height="36" rx="8" />
          <path d="M28 44h40M38 26v8M58 26v8" />
          <path d="M40 56h6M52 56h6M40 62h6" />
        </>
      )}
      {kind === "message" && (
        <>
          <path d="M28 34h40a8 8 0 0 1 8 8v16a8 8 0 0 1-8 8H44l-10 8v-8h-6a8 8 0 0 1-8-8V42a8 8 0 0 1 8-8Z" />
          <path d="M38 48h20M38 56h12" />
        </>
      )}
      {kind === "clients" && (
        <>
          <circle cx="40" cy="42" r="8" />
          <path d="M26 68c0-8 6-14 14-14s14 6 14 14" />
          <circle cx="62" cy="46" r="6" />
          <path d="M56 68c0-6 4-10 10-10" />
        </>
      )}
    </svg>
  );
}

function EmptyState({
  title,
  body,
  action,
  onAction,
  kind = "calendar",
}: {
  title: string;
  body: string;
  action: string;
  onAction: () => void;
  kind?: "calendar" | "message" | "clients";
}) {
  return (
    <div className="animate-fade rounded-2xl border border-dashed border-line bg-surface/70 p-6 text-center">
      <Illustration kind={kind} />
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-4 h-11 rounded-xl bg-brand-solid px-4 text-sm font-semibold text-white"
      >
        {action}
      </button>
    </div>
  );
}

function Login({
  technicians,
  theme,
  onToggleTheme,
  onAdminRequest,
  onAdmin,
  onLogin,
}: {
  technicians: Technician[];
  theme: "light" | "dim";
  onToggleTheme: () => void;
  onAdminRequest: (pin: string) => Promise<boolean>;
  onAdmin: () => void;
  onLogin: (technician: Technician) => void;
}) {
  const [selected, setSelected] = useState<Technician | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adminMode, setAdminMode] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [adminHint, setAdminHint] = useState("");
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    void getSetting("adminHint").then((value) => setAdminHint(value ?? ""));
  }, []);

  const hint = adminMode ? adminHint : selected?.hint ?? "";

  useEffect(() => {
    if (!lockedUntil) {
      setRemaining(0);
      return;
    }
    const tick = () => {
      const left = lockedUntil - Date.now();
      if (left <= 0) {
        setLockedUntil(0);
        setRemaining(0);
        setError(null);
      } else {
        setRemaining(Math.ceil(left / 1000));
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  function guard(): boolean {
    const identity = adminMode ? "admin" : selected?.id ?? "";
    const left = lockRemaining(identity);
    if (left > 0) {
      setLockedUntil(Date.now() + left);
      return false;
    }
    return true;
  }

  function fail(identity: string) {
    const until = registerFailure(identity);
    setPin("");
    if (until) {
      setLockedUntil(until);
      setError(null);
    } else if (attemptsLeft(identity) === 0) {
      setError("PIN incorrecto. Un intento más y se bloquea 1 minuto.");
    } else {
      setError(`PIN incorrecto. Te quedan ${attemptsLeft(identity)} intentos.`);
    }
  }

  function submit(value: string) {
    if (!selected || !guard()) return;
    if (value === selected.pin) {
      clearFailures(selected.id);
      onLogin(selected);
      return;
    }
    fail(selected.id);
  }

  async function submitAdmin(value: string) {
    if (!guard()) return;
    setChecking(true);
    try {
      if (await onAdminRequest(value)) {
        clearFailures("admin");
        onAdmin();
        return;
      }
      fail("admin");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="relative mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-6 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>

      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 animate-pop items-center justify-center rounded-2xl bg-brand-solid text-2xl font-bold text-white">
          A
        </div>
        <h1 className="text-2xl font-extrabold">Agenda</h1>
        <p className="mt-1 text-sm text-muted">
          {adminMode ? "PIN de administrador" : "¿Quién está usando la agenda?"}
        </p>
      </div>

      {adminMode ? (
        <div>
          <button
            type="button"
            onClick={() => {
              setAdminMode(false);
              setPin("");
              setError(null);
            }}
            className="mb-4 text-xs font-semibold text-muted"
          >
            ‹ Volver
          </button>
          <input
            autoFocus
            value={pin}
            onChange={(event) => {
              const value = event.target.value.replace(/\D/g, "").slice(0, 4);
              setPin(value);
              setError(null);
              if (value.length === 4) void submitAdmin(value);
            }}
            inputMode="numeric"
            type="password"
            disabled={remaining > 0}
            placeholder="••••"
            aria-label="PIN"
            className={`mx-auto block w-40 rounded-xl border bg-surface px-4 py-3 text-center text-2xl tracking-[0.4em] outline-none ${
              error ? "border-danger" : "border-line focus:border-brand"
            }`}
          />
          {remaining > 0 ? (
            <p className="mt-2 text-center text-xs font-semibold text-danger">
              Demasiados intentos. Esperá {remaining} s.
            </p>
          ) : (
            error && <p className="mt-2 text-center text-xs font-semibold text-danger">{error}</p>
          )}
          {checking && <p className="mt-2 text-center text-xs text-muted">Verificando…</p>}
          {hint && (
            <div className="mt-2 text-center">
              <button
                type="button"
                onClick={() => setShowHint((value) => !value)}
                className="text-[10px] text-muted underline"
              >
                {showHint ? "Ocultar pista" : "Ver pista"}
              </button>
              {showHint && (
                <p className="mt-1 text-[10px] text-muted">Pista: {hint}</p>
              )}
            </div>
          )}
          <p className="mt-6 text-center text-[11px] text-muted">PIN inicial: 9999</p>
        </div>
      ) : !selected ? (
        <div className="space-y-2">
          {technicians.map((technician) => (
            <button
              key={technician.id}
              type="button"
              onClick={() => {
                setSelected(technician);
                setPin("");
                setError(null);
              }}
              className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left active:scale-[0.99]"
            >
              <span
                className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: technician.color }}
              >
                {technician.name.trim().charAt(0).toUpperCase()}
              </span>
              <span className="flex-1 text-sm font-semibold">{technician.name}</span>
              <span className="text-lg text-muted">›</span>
            </button>
          ))}

          <button
            type="button"
            onClick={() => {
              setAdminMode(true);
              setPin("");
              setError(null);
            }}
            className="mt-3 w-full rounded-2xl border border-dashed border-line px-4 py-3 text-xs font-semibold text-muted"
          >
            Administrar técnicos
          </button>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setPin("");
              setError(null);
            }}
            className="mb-4 text-xs font-semibold text-muted"
          >
            ‹ Volver
          </button>
          <p className="text-center text-sm font-semibold">{selected.name}</p>
          <p className="mt-1 text-center text-xs text-muted">PIN de 4 dígitos</p>
          <input
            autoFocus
            value={pin}
            onChange={(event) => {
              const value = event.target.value.replace(/\D/g, "").slice(0, 4);
              setPin(value);
              setError(null);
              if (value.length === 4) submit(value);
            }}
            inputMode="numeric"
            type="password"
            disabled={remaining > 0}
            placeholder="••••"
            aria-label="PIN"
            className={`mx-auto mt-4 block w-40 rounded-xl border bg-surface px-4 py-3 text-center text-2xl tracking-[0.4em] outline-none ${
              error ? "border-danger" : "border-line focus:border-brand"
            }`}
          />
          {remaining > 0 ? (
            <p className="mt-2 text-center text-xs font-semibold text-danger">
              Demasiados intentos. Esperá {remaining} s.
            </p>
          ) : (
            error && <p className="mt-2 text-center text-xs font-semibold text-danger">{error}</p>
          )}
          {hint && (
            <div className="mt-2 text-center">
              <button
                type="button"
                onClick={() => setShowHint((value) => !value)}
                className="text-[10px] text-muted underline"
              >
                {showHint ? "Ocultar pista" : "Ver pista"}
              </button>
              {showHint && (
                <p className="mt-1 text-[10px] text-muted">Pista: {hint}</p>
              )}
            </div>
          )}
          <p className="mt-6 text-center text-[11px] text-muted">PIN inicial del técnico: 1234</p>
          <p className="mt-2 text-center text-[10px] text-muted">versión {APP_VERSION}</p>
        </div>
      )}
    </div>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: "light" | "dim"; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={theme === "dim" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-[13px] text-muted active:scale-95"
    >
      {theme === "dim" ? "☀" : "☾"}
    </button>
  );
}

function WindowIcon({
  window,
  className = "h-4 w-4",
}: {
  window: "morning" | "afternoon";
  className?: string;
}) {
  const sunrise = (
    <>
      <path d="M3 19h18" />
      <circle cx="12" cy="12.5" r="4" />
      <path d="M12 4.5v2.5" />
      <path d="M6 8l1.8 1.8" />
      <path d="M18 8l-1.8 1.8" />
    </>
  );

  const sunset = (
    <>
      <path d="M3 13h18" />
      <circle cx="12" cy="15.5" r="4" />
      <path d="M12 3.5v2.5" />
      <path d="M6 6.5l1.8 1.8" />
      <path d="M18 6.5l-1.8 1.8" />
    </>
  );

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {window === "morning" ? sunrise : sunset}
    </svg>
  );
}

const WEEKDAY_LABEL = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

function VisitSheet({
  appointment,
  locations,
  onClose,
  onSaved,
}: {
  appointment: Appointment;
  locations: Location[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [outcome, setOutcome] = useState<"attended" | "no_show">(
    appointment.status === "no_show" ? "no_show" : "attended"
  );
  const [notes, setNotes] = useState(appointment.notes ?? "");
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<Appointment[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [newDate, setNewDate] = useState(appointment.date ?? todayIso());
  const [clientPhone, setClientPhone] = useState<string | null>(null);

  useEffect(() => {
    if (!appointment.clientId) return;
    let alive = true;
    void getClient(appointment.clientId).then((client) => {
      if (alive && client?.phones?.length) setClientPhone(client.phones[0]);
    });
    return () => {
      alive = false;
    };
  }, [appointment.clientId]);

  useEffect(() => {
    let urls: string[] = [];
    let alive = true;
    void (async () => {
      const list = await photosForAppointment(appointment.id);
      if (!alive) return;
      urls = list.map((photo) => URL.createObjectURL(photo.blob));
      setPhotos(list.map((photo, index) => ({ id: photo.id, url: urls[index] })));
      if (appointment.clientId) {
        const items = await historyForClient(appointment.clientId);
        if (alive) setHistory(items.filter((item) => item.id !== appointment.id).slice(0, 4));
      }
    })();
    return () => {
      alive = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [appointment]);

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const newPhotos: { blob: Blob; mimeType: string }[] = [];
      for (const file of files) {
        newPhotos.push(await compressPhoto(file));
      }
      await closeAppointment(appointment.id, {
        status: outcome,
        notes,
        newPhotos,
        removePhotoIds: removed,
      });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  const visible = photos.filter((photo) => !removed.includes(photo.id));
  const placeName =
    locations.find((location) => location.id === appointment.locationId)?.name ?? "";

  const calendarUrl = (() => {
    if (!appointment.date || !appointment.time) return null;
    const day = appointment.date.replace(/-/g, "");
    const start = `${day}T${appointment.time.replace(":", "")}00`;
    const endHour = appointment.endTime
      ? appointment.endTime
      : `${String(Number(appointment.time.slice(0, 2)) + 1).padStart(2, "0")}:00`;
    const end = `${day}T${endHour.replace(":", "")}00`;
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: `${appointment.type ? TYPE_LABEL[appointment.type] : "Cita"} · ${
        appointment.name ?? ""
      }`,
      dates: `${start}/${end}`,
      ctz: "America/Bogota",
      details: `${appointment.description ?? ""}\nCita: ${appointment.id}`,
      location: placeName,
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  })();

  async function downloadPhotos() {
    for (const [index, photo] of visible.entries()) {
      const blob = await (await fetch(photo.url)).blob();
      downloadBlob(`${appointment.id}-${index + 1}.jpg`, blob);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  return (
    <Sheet title="Cerrar visita" onClose={onClose}>
      <div className="max-h-[62vh] space-y-3 overflow-y-auto pr-1">
        <div className="rounded-2xl border border-line bg-surface p-3">
          <p className="font-semibold">{appointment.name}</p>
          <p className="text-xs text-muted">
            {[appointment.model, appointment.time].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-1 font-mono text-[10px] text-muted">#{appointment.id}</p>
        </div>

        {(() => {
          const phone = appointment.phone ?? clientPhone;
          const enabled = Boolean(phone);
          const place = locations.find((item) => item.id === appointment.locationId)?.name;
          const firstName = (appointment.name ?? "").split(" ")[0] ?? "";
          const when = [
            appointment.date ? formatLong(appointment.date) : null,
            appointment.time,
          ]
            .filter(Boolean)
            .join(" a las ");
          const text = `Hola ${firstName}, le confirmo su cita${when ? ` del ${when}` : ""}${
            place ? ` en ${place}` : ""
          }.`;

          return (
            <div className="space-y-1">
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={enabled ? `tel:+57${phone}` : undefined}
                  aria-disabled={!enabled}
                  className={`grid h-10 place-items-center rounded-xl border border-line bg-surface text-xs font-semibold text-ink ${
                    enabled ? "" : "pointer-events-none opacity-40"
                  }`}
                >
                  Llamar
                </a>
                <a
                  href={
                    enabled
                      ? `https://wa.me/57${phone}?text=${encodeURIComponent(text)}`
                      : undefined
                  }
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={!enabled}
                  className={`grid h-10 place-items-center rounded-xl bg-brand-soft text-xs font-semibold text-brand ${
                    enabled ? "" : "pointer-events-none opacity-40"
                  }`}
                >
                  Confirmar por WhatsApp
                </a>
              </div>
              {!enabled && (
                <p className="text-[10px] text-muted">El cliente no tiene teléfono cargado.</p>
              )}
            </div>
          );
        })()}

        {calendarUrl && (
          <a
            href={calendarUrl}
            target="_blank"
            rel="noreferrer"
            className="grid h-10 w-full place-items-center rounded-xl border border-line bg-surface text-xs font-semibold text-ink"
          >
            Añadir a Google Calendar
          </a>
        )}

        <div>
          <p className="mb-1 text-xs font-semibold text-muted">
            Fotos {visible.length + previews.length > 0 ? `(${visible.length + previews.length})` : ""}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {visible.map((photo) => (
              <div
                key={photo.id}
                className="relative aspect-square overflow-hidden rounded-xl border border-line bg-surface"
              >
                <button
                  type="button"
                  onClick={() => setZoomUrl(photo.url)}
                  className="h-full w-full"
                  aria-label="Ver foto"
                >
                  <img
                    src={photo.url}
                    alt="Evidencia de la visita"
                    className="h-full w-full object-cover"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setRemoved([...removed, photo.id])}
                  aria-label="Quitar foto"
                  className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-sm text-white"
                >
                  ×
                </button>
              </div>
            ))}

            {previews.map((url, index) => (
              <div
                key={url}
                className="relative aspect-square overflow-hidden rounded-xl border border-line bg-surface"
              >
                <button
                  type="button"
                  onClick={() => setZoomUrl(url)}
                  className="h-full w-full"
                  aria-label="Ver foto"
                >
                  <img src={url} alt="Nueva evidencia" className="h-full w-full object-cover" />
                </button>
                <button
                  type="button"
                  onClick={() => setFiles(files.filter((_, position) => position !== index))}
                  aria-label="Quitar foto"
                  className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-sm text-white"
                >
                  ×
                </button>
              </div>
            ))}

            <label className="grid aspect-square cursor-pointer place-items-center rounded-xl border border-dashed border-line bg-surface text-center">
              <span className="text-xl leading-none text-muted">＋</span>
              <span className="text-[9px] text-muted">Foto</span>
              <input
                type="file"
                accept="image/*"
                multiple
                capture="environment"
                className="hidden"
                onChange={(event) => {
                  const list = Array.from(event.target.files ?? []);
                  setFiles([...files, ...list]);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          {visible.length > 0 && (
            <>
              <p className="mt-1 text-[10px] text-muted">La × quita la foto al guardar.</p>
              <button
                type="button"
                onClick={() => void downloadPhotos()}
                className="mt-2 h-9 w-full rounded-lg border border-line text-[11px] font-semibold text-brand"
              >
                Descargar {visible.length} foto{visible.length === 1 ? "" : "s"}
              </button>
            </>
          )}
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold text-muted">¿Cómo salió?</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setOutcome("attended")}
              className={`h-11 rounded-xl text-sm font-semibold ${
                outcome === "attended"
                  ? "bg-brand-solid text-white"
                  : "border border-line bg-surface text-muted"
              }`}
            >
              Se hizo
            </button>
            <button
              type="button"
              onClick={() => setOutcome("no_show")}
              className={`h-11 rounded-xl text-sm font-semibold ${
                outcome === "no_show"
                  ? "bg-danger text-white"
                  : "border border-line bg-surface text-muted"
              }`}
            >
              No vino
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1">
          <button
            type="button"
            onClick={() => {
              void setAppointmentStatus(appointment.id, "to_confirm").then(onSaved);
            }}
            className="h-10 rounded-xl border border-line bg-surface text-[11px] font-semibold text-warn"
          >
            Por confirmar
          </button>
          <button
            type="button"
            onClick={() => {
              void setAppointmentStatus(appointment.id, "confirmed").then(onSaved);
            }}
            className="h-10 rounded-xl border border-line bg-surface text-[11px] font-semibold text-brand"
          >
            Confirmar
          </button>
          <button
            type="button"
            onClick={() => setMoving((value) => !value)}
            className="h-10 rounded-xl border border-line bg-surface text-[11px] font-semibold text-muted"
          >
            Reprogramar
          </button>
        </div>

        {moving && (
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-2">
            <input
              type="date"
              value={newDate}
              onChange={(event) => setNewDate(event.target.value)}
              className="flex-1 rounded-lg border border-line bg-canvas px-2 py-1.5 text-xs"
            />
            <button
              type="button"
              onClick={() => {
                void rescheduleAppointment(appointment.id, newDate).then(onSaved);
              }}
              className="h-8 rounded-lg bg-brand-solid px-3 text-xs font-semibold text-white"
            >
              Mover
            </button>
          </div>
        )}

        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          placeholder="Observaciones: qué se hizo, qué quedó pendiente…"
          className="w-full resize-none rounded-xl border border-line bg-surface p-3 text-sm outline-none focus:border-brand"
        />

        {history.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-muted">Historial</p>
            <div className="space-y-1">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-lg bg-surface px-2 py-1.5 text-[11px]"
                >
                  <span className="text-muted">
                    {item.date ? formatShort(item.date) : "—"}
                  </span>
                  <span className="text-muted">{item.type ? TYPE_LABEL[item.type] : "—"}</span>
                  <span className="font-semibold">{STATUS_LABEL[item.status]}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p className="rounded-lg bg-danger-soft px-2 py-1.5 text-xs text-danger">{error}</p>}
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="mt-4 h-12 w-full rounded-xl bg-brand-solid text-sm font-semibold text-white disabled:opacity-50"
      >
        {saving ? "Guardando…" : "Confirmar visita"}
      </button>

      {zoomUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setZoomUrl(null)}
        >
          <img
            src={zoomUrl}
            alt="Evidencia de la visita"
            className="max-h-full max-w-full rounded-xl object-contain"
          />
          <button
            type="button"
            onClick={() => setZoomUrl(null)}
            className="absolute right-4 top-4 rounded-full bg-white/15 px-3 py-2 text-xs font-semibold text-white"
          >
            Cerrar
          </button>
        </div>
      )}
    </Sheet>
  );
}

function ScheduleSheet({
  technicianId,
  locations,
  onClose,
  onChanged,
}: {
  technicianId: string;
  locations: Location[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const names = new Map(locations.map((location) => [location.id, location.name]));

  const load = useCallback(async () => {
    setBlocks(await listSchedule(technicianId));
  }, [technicianId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function step(block: ScheduleBlock, delta: number) {
    const capacity = Math.max(0, Math.min(20, block.capacity + delta));
    await updateScheduleBlock(block.id, { capacity });
    await load();
    onChanged();
  }

  async function toggle(block: ScheduleBlock) {
    await updateScheduleBlock(block.id, { active: !block.active });
    await load();
    onChanged();
  }

  const days = [1, 2, 3, 4, 5, 6, 0];

  return (
    <Sheet title="Mi horario" onClose={onClose}>
      <p className="mb-3 text-xs text-muted">
        El local de cada cita sale de este horario. Mañana: mantenimientos. Tarde: revisiones y
        garantías.
      </p>

      <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
        {days.map((day) => {
          const items = blocks.filter((block) => block.weekday === day);
          return (
            <div key={day}>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
                {WEEKDAY_LABEL[day]}
              </p>
              {items.length === 0 ? (
                <p className="mt-1 rounded-lg bg-surface px-2 py-1.5 text-[11px] text-muted">
                  Cerrado
                </p>
              ) : (
                <div className="mt-1 space-y-1">
                  {items.map((block) => (
                    <div
                      key={block.id}
                      className="flex items-center gap-2 rounded-xl border border-line bg-surface px-2 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p
                          className={`truncate text-[12px] font-semibold ${
                            block.active ? "" : "text-muted line-through"
                          }`}
                        >
                          {WINDOW_LABEL[block.window]} · {block.from}–{block.to}
                        </p>
                        <p className="truncate text-[10px] text-muted">
                          {names.get(block.locationId) ?? block.locationId}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void step(block, -1)}
                          className="grid h-7 w-7 place-items-center rounded-md border border-line text-sm leading-none"
                        >
                          −
                        </button>
                        <span className="w-5 text-center text-[12px] font-bold">
                          {block.capacity}
                        </span>
                        <button
                          type="button"
                          onClick={() => void step(block, 1)}
                          className="grid h-7 w-7 place-items-center rounded-md border border-line text-sm leading-none"
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => void toggle(block)}
                        className={`h-7 rounded-md px-2 text-[10px] font-semibold ${
                          block.active ? "bg-brand-soft text-brand" : "bg-canvas text-muted"
                        }`}
                      >
                        {block.active ? "Activo" : "Off"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onClose}
        className="mt-4 h-12 w-full rounded-xl bg-brand-solid text-sm font-semibold text-white"
      >
        Listo
      </button>
    </Sheet>
  );
}

function ProfileSheet({
  technician,
  lastBackupAt,
  closingReminder,
  onToggleClosing,
  onBackupDone,
  googleConnected,
  syncing,
  onConnectGoogle,
  onSyncGoogle,
  uploadUrl,
  uploadToken,
  autoUpload,
  onSaveUpload,
  uploading,
  onManualUpload,
  onTestUpload,
  onToast,
  onClose,
  onSaved,
  onLogout,
}: {
  technician: Technician;
  lastBackupAt: string | null;
  closingReminder: boolean;
  onToggleClosing: (value: boolean) => void;
  onBackupDone: () => void;
  googleConnected: boolean;
  syncing: boolean;
  onConnectGoogle: (clientId: string) => Promise<void>;
  onSyncGoogle: () => void;
  uploadUrl: string;
  uploadToken: string;
  autoUpload: boolean;
  onSaveUpload: (url: string, token: string, auto: boolean) => void;
  uploading: boolean;
  onManualUpload: () => void;
  onTestUpload: () => void;
  onToast: (message: string) => void;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onLogout: () => void;
}) {
  const [name, setName] = useState(technician.name);
  const [hint, setHint] = useState(technician.hint ?? "");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [repeatPin, setRepeatPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [clientId, setClientId] = useState("");
  const [uploadForm, setUploadForm] = useState({ url: "", token: "", auto: false });

  useEffect(() => {
    setUploadForm({ url: uploadUrl, token: uploadToken, auto: autoUpload });
  }, [uploadUrl, uploadToken, autoUpload]);

  async function saveUploadConfig() {
    await setSetting("uploadUrl", uploadForm.url.trim());
    await setSetting("uploadToken", uploadForm.token.trim());
    await setSetting("autoUpload", uploadForm.auto ? "1" : "0");
    onToast("Cierre automático guardado");
    onSaveUpload(uploadForm.url.trim(), uploadForm.token.trim(), uploadForm.auto);
  }

  useEffect(() => {
    void getSetting("googleClientId").then((value) =>
      setClientId(value?.trim() ? value : DEFAULT_CLIENT_ID)
    );
  }, []);

  async function saveAndConnect() {
    const id = clientId.trim() || DEFAULT_CLIENT_ID;
    await setSetting("googleClientId", id);
    await onConnectGoogle(id);
  }

  async function handleExport() {
    const blob = await exportBackup();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `agenda-respaldo-${todayIso()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    onBackupDone();
    onToast("Respaldo descargado");
  }

  async function save() {
    setError(null);
    if (name.trim().length < 2) {
      setError("Escribí un nombre.");
      return;
    }

    const wantsPin = newPin.length > 0 || repeatPin.length > 0;
    if (wantsPin) {
      if (currentPin !== technician.pin) {
        setError("El PIN actual no coincide.");
        return;
      }
      if (!/^\d{4}$/.test(newPin)) {
        setError("El PIN nuevo debe tener 4 dígitos.");
        return;
      }
      if (newPin !== repeatPin) {
        setError("Los PIN nuevos no coinciden.");
        return;
      }
    }

    setSaving(true);
    try {
      await updateTechnician(technician.id, {
        name: name.trim(),
        hint: hint.trim(),
        ...(wantsPin ? { pin: newPin } : {}),
      });
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title="Mi perfil" onClose={onClose}>
      <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
        <label className="block">
          <span className="text-xs font-semibold text-muted">Nombre</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-muted">Pista del PIN (opcional)</span>
          <input
            value={hint}
            onChange={(event) => setHint(event.target.value)}
            placeholder="Ej.: año del carro"
            className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>

        <div className="rounded-xl border border-line bg-surface p-3">
          <p className="text-xs font-semibold">Cambiar PIN</p>
          <input
            value={currentPin}
            onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="PIN actual"
            inputMode="numeric"
            type="password"
            className="mt-2 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input
              value={newPin}
              onChange={(event) => setNewPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="PIN nuevo"
              inputMode="numeric"
              type="password"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <input
              value={repeatPin}
              onChange={(event) => setRepeatPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="Repetir PIN"
              inputMode="numeric"
              type="password"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface p-3">
          <p className="text-xs font-semibold">Respaldo</p>
          <p className="mt-1 text-[10px] text-muted">
            Los datos viven solo en este dispositivo. Exportá un archivo para no perderlos.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void handleExport()}
              className="h-10 rounded-lg border border-line bg-canvas text-xs font-semibold text-brand"
            >
              Exportar
            </button>
            <label className="grid h-10 cursor-pointer place-items-center rounded-lg border border-line bg-canvas text-xs font-semibold text-muted">
              Importar
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) setPendingImport(file);
                }}
              />
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold">Aviso de cierre</p>
              <p className="text-[10px] text-muted">A las 18:00, si la app está abierta.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                onToggleClosing(!closingReminder);
                onToast(closingReminder ? "Aviso desactivado" : "Aviso activado");
              }}
              className={`h-9 shrink-0 rounded-lg px-3 text-[11px] font-semibold ${
                closingReminder
                  ? "bg-brand-solid text-white"
                  : "border border-line bg-canvas text-muted"
              }`}
            >
              {closingReminder ? "Activado" : "Desactivado"}
            </button>
          </div>
          <p className="mt-2 text-[10px] text-muted">
            Último respaldo:{" "}
            {lastBackupAt ? new Date(lastBackupAt).toLocaleString("es-CO") : "nunca"}
          </p>
        </div>

        <div className="rounded-xl border border-line bg-surface p-3">
          <p className="text-xs font-semibold">Google Calendar</p>
          <p className="text-[10px] text-muted">
            Sincroniza la semana visible. Solo actualiza las citas que cambiaron.
          </p>
          {googleConnected ? (
            <button
              type="button"
              onClick={onSyncGoogle}
              disabled={syncing}
              className="mt-2 h-9 w-full rounded-lg bg-brand-solid text-[11px] font-semibold text-white disabled:opacity-50"
            >
              {syncing ? "Sincronizando…" : "Sincronizar ahora"}
            </button>
          ) : (
            <>
              <input
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                placeholder="Client ID de Google"
                aria-label="Client ID de Google"
                className="mt-2 w-full rounded-lg border border-line bg-canvas px-2 py-2 text-[11px] outline-none focus:border-brand"
              />
              <button
                type="button"
                onClick={() => void saveAndConnect()}
                className="mt-1 h-9 w-full rounded-lg border border-line text-[11px] font-semibold text-brand"
              >
                Guardar y conectar
              </button>
            </>
          )}
        </div>

        <div className="rounded-xl border border-line bg-surface p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold">Cierre automático a Google</p>
              <p className="text-[10px] text-muted">
                Se sube solo después de las 18:00. Si no abriste la app, se pone al día al
                abrirla.
              </p>
            </div>
            {uploading && (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-brand">
                <Spinner className="h-3.5 w-3.5" />
                Subiendo…
              </span>
            )}
          </div>
          <input
            value={uploadForm.url}
            onChange={(event) => setUploadForm({ ...uploadForm, url: event.target.value })}
            placeholder="URL del Apps Script (/exec)"
            aria-label="URL del Apps Script"
            className="mt-2 w-full rounded-lg border border-line bg-canvas px-2 py-2 text-[11px] outline-none focus:border-brand"
          />
          <input
            value={uploadForm.token}
            onChange={(event) => setUploadForm({ ...uploadForm, token: event.target.value })}
            placeholder="Token"
            aria-label="Token del Apps Script"
            className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-2 text-[11px] outline-none focus:border-brand"
          />
          <div className="mt-1 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => setUploadForm({ ...uploadForm, auto: !uploadForm.auto })}
              className={`h-9 rounded-lg text-[11px] font-semibold ${
                uploadForm.auto
                  ? "bg-brand-solid text-white"
                  : "border border-line bg-canvas text-muted"
              }`}
            >
              {uploadForm.auto ? "Automático: sí" : "Automático: no"}
            </button>
            <button
              type="button"
              onClick={() => void saveUploadConfig()}
              className="h-9 rounded-lg border border-line text-[11px] font-semibold text-brand"
            >
              Guardar
            </button>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={onTestUpload}
              className="h-9 rounded-lg border border-line text-[11px] font-semibold text-muted"
            >
              Probar
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={onManualUpload}
              className="h-9 rounded-lg border border-line text-[11px] font-semibold text-brand disabled:opacity-60"
            >
              {uploading ? "Subiendo…" : "Subir ahora"}
            </button>
          </div>
        </div>

        {error && <p className="rounded-lg bg-danger-soft px-2 py-1.5 text-xs text-danger">{error}</p>}

        <button
          type="button"
          onClick={onLogout}
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-muted"
        >
          Cerrar sesión en este dispositivo
        </button>

        <p className="text-center text-[10px] text-muted">versión {APP_VERSION}</p>
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="mt-4 h-12 w-full rounded-xl bg-brand-solid text-sm font-semibold text-white disabled:opacity-50"
      >
        {saving ? "Guardando…" : "Guardar"}
      </button>

      {pendingImport && (
        <ConfirmSheet
          title="Importar respaldo"
          body="Se reemplazan TODOS los datos de este dispositivo con los del archivo. No se puede deshacer."
          confirmLabel="Importar"
          danger
          onCancel={() => setPendingImport(null)}
          onConfirm={() => {
            const file = pendingImport;
            setPendingImport(null);
            void importBackup(file).then(() => window.location.reload());
          }}
        />
      )}
    </Sheet>
  );
}

function AdminView({
  onClose,
  onToast,
  onConfigChanged,
  onSyncConfig,
}: {
  onClose: () => void;
  onToast: (message: string) => void;
  onConfigChanged: () => void;
  onSyncConfig: () => void;
}) {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sub, setSub] = useState<{ kind: "week" | "clients"; technician: Technician } | null>(
    null
  );
  const [week, setWeek] = useState<DaySummary[]>([]);
  const [clients, setClients] = useState<TechnicianClient[]>([]);
  const [loadingSub, setLoadingSub] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationForm, setLocationForm] = useState<{
    id?: string;
    name: string;
    city: string;
    aliases: string;
  } | null>(null);
  const [editForm, setEditForm] = useState<{
    id: string;
    name: string;
    pin: string;
    hint: string;
  } | null>(null);
  const [business, setBusiness] = useState<"day" | "clients" | null>(null);
  const [businessRows, setBusinessRows] = useState<Appointment[]>([]);
  const [businessClients, setBusinessClients] = useState<TechnicianClient[]>([]);
  const [uploadUrl, setUploadUrl] = useState("");
  const [uploadToken, setUploadToken] = useState("");
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [adminPin, setAdminPinValue] = useState("");
  const [adminCurrent, setAdminCurrent] = useState("");
  const [adminNew, setAdminNew] = useState("");
  const [adminRepeat, setAdminRepeat] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminHint, setAdminHint] = useState("");
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    confirmLabel: string;
    danger?: boolean;
    run: () => Promise<void>;
  } | null>(null);

  const load = useCallback(async () => {
    const list = await listTechnicians(true);
    setTechnicians(list);
    setLocations(await listLocations(true));
    setAdminPinValue(await getAdminPin());
    setAdminHint((await getSetting("adminHint")) ?? "");
    setUploadUrl((await getSetting("uploadUrl")) ?? "");
    setUploadToken((await getSetting("uploadToken")) ?? "");
    const entries = await Promise.all(
      list.map(async (technician) => [technician.id, await countAppointments(technician.id)] as const)
    );
    setCounts(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setError(null);
    if (name.trim().length < 2) {
      setError("Escribí el nombre del técnico.");
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError("El PIN debe tener 4 dígitos.");
      return;
    }
    await createTechnician(name.trim(), pin);
    setName("");
    setPin("");
    onToast("Técnico agregado");
    onConfigChanged();
    await load();
  }

  async function toggle(technician: Technician) {
    const nextActive = technician.active === false;
    setConfirm({
      title: nextActive ? "Activar técnico" : "Desactivar técnico",
      body: nextActive
        ? `${technician.name} va a volver a aparecer en el login.`
        : `${technician.name} no va a poder entrar, pero sus citas se conservan.`,
      confirmLabel: nextActive ? "Activar" : "Desactivar",
      run: async () => {
        await updateTechnician(technician.id, { active: nextActive });
        onToast(nextActive ? "Técnico activado" : "Técnico desactivado");
        onConfigChanged();
        await load();
      },
    });
  }

  function remove(technician: Technician) {
    setConfirm({
      title: "Eliminar técnico",
      body: `¿Eliminar a ${technician.name}? Solo se puede si no tiene citas cargadas.`,
      confirmLabel: "Eliminar",
      danger: true,
      run: async () => {
        const result = await deleteTechnician(technician.id);
        if (result.ok) {
          onToast("Técnico eliminado");
          onConfigChanged();
        }
        setError(
          result.ok
            ? null
            : `${technician.name} tiene ${result.appointments} citas. Desactivalo en vez de borrarlo.`
        );
        await load();
      },
    });
  }

  function seed(technician: Technician) {
    setConfirm({
      title: "Crear datos de prueba",
      body: `Se van a crear 10 citas de ejemplo para ${technician.name}, repartidas en la semana. Podés borrarlas después.`,
      confirmLabel: "Crear",
      run: async () => {
        await seedDemoData(technician.id);
        onToast("Datos de prueba creados");
        await load();
      },
    });
  }

  function clear(technician: Technician) {
    const total = counts[technician.id] ?? 0;
    setConfirm({
      title: "Borrar datos del técnico",
      body: `Se eliminarán las ${total} citas de ${technician.name}, sus fotos y los mensajes asociados. No se puede deshacer.`,
      confirmLabel: "Borrar",
      danger: true,
      run: async () => {
        await clearTechnicianData(technician.id);
        onToast("Datos del técnico borrados");
        await load();
      },
    });
  }

  async function exportDay() {
    const date = todayIso();
    const [all, places] = await Promise.all([allAppointmentsForDay(date), listLocations()]);
    const names = new Map(technicians.map((technician) => [technician.id, technician.name]));
    const place = new Map(places.map((location) => [location.id, location.name]));

    downloadCsv(
      `cierre-${date}.csv`,
      all.map((appointment) => ({
        id: appointment.id,
        fecha: appointment.date ?? "",
        hora: appointment.time ?? "",
        tecnico: names.get(appointment.technicianId) ?? appointment.technicianId,
        local: appointment.locationId ? place.get(appointment.locationId) ?? "" : "",
        cliente: appointment.name ?? "",
        telefono: appointment.phone ?? "",
        vehiculo: appointment.model ?? "",
        tipo: appointment.type ?? "",
        estado: appointment.status,
        valor: appointment.amount ?? "",
        observaciones: appointment.notes ?? "",
      }))
    );
  }

  async function openBusiness(kind: "day" | "clients") {
    setBusiness(kind);
    if (kind === "day") {
      setBusinessRows(await allAppointmentsForDay(todayIso()));
      return;
    }

    const roster = await listTechnicians(true);
    const lists = await Promise.all(roster.map((technician) => clientsOfTechnician(technician.id)));
    const merged = new Map<string, TechnicianClient>();

    for (const list of lists) {
      for (const client of list) {
        const current = merged.get(client.clientId);
        if (current) {
          current.visits += client.visits;
          if (client.lastDate && (!current.lastDate || client.lastDate > current.lastDate)) {
            current.lastDate = client.lastDate;
          }
          if (client.nextDate && (!current.nextDate || client.nextDate < current.nextDate)) {
            current.nextDate = client.nextDate;
          }
          if (!current.phone && client.phone) current.phone = client.phone;
        } else {
          merged.set(client.clientId, { ...client });
        }
      }
    }

    setBusinessClients(
      [...merged.values()].sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? ""))
    );
  }

  async function exportDayPhotos() {
    const date = todayIso();
    const all = await allAppointmentsForDay(date);
    const names = new Map(technicians.map((technician) => [technician.id, technician.name]));
    const files: Record<string, Uint8Array> = {};
    let total = 0;

    for (const appointment of all) {
      const photos = await photosForAppointment(appointment.id);
      for (const [index, photo] of photos.entries()) {
        const base = safeFileName(
          `${names.get(appointment.technicianId) ?? "tecnico"}-${appointment.name ?? "cliente"}-${appointment.id}`
        );
        files[`${base}-${index + 1}.jpg`] = new Uint8Array(await photo.blob.arrayBuffer());
        total += 1;
      }
    }

    if (!total) {
      setError("Hoy no hay fotos para exportar.");
      return;
    }
    setError(null);
    const zipped = zipSync(files);
    downloadBlob(`fotos-${date}.zip`, new Blob([zipped], { type: "application/zip" }));
  }

  async function exportClients(technician: Technician) {
    const list = await clientsOfTechnician(technician.id);
    downloadCsv(
      `clientes-${technician.name.replace(/\s+/g, "-").toLowerCase()}.csv`,
      list.map((client) => ({
        cliente: client.name,
        telefono: client.phone ?? "",
        visitas: client.visits,
        ultima_visita: client.lastDate ?? "",
      }))
    );
  }

  async function saveTechnician() {
    if (!editForm) return;
    if (editForm.name.trim().length < 2) {
      setError("Escribí el nombre del técnico.");
      return;
    }
    if (!/^\d{4}$/.test(editForm.pin)) {
      setError("El PIN debe tener 4 dígitos.");
      return;
    }
    await updateTechnician(editForm.id, {
      name: editForm.name.trim(),
      pin: editForm.pin,
      hint: editForm.hint.trim(),
    });
    setEditForm(null);
    setError(null);
    onToast("Técnico actualizado");
    onConfigChanged();
    await load();
  }

  async function saveLocation() {
    if (!locationForm) return;
    const name = locationForm.name.trim();
    if (name.length < 2) {
      setError("Escribí el nombre del local.");
      return;
    }
    const duplicate = locations.find(
      (location) =>
        location.id !== locationForm.id && location.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      setError("Ya existe un local con ese nombre.");
      return;
    }

    const aliases = locationForm.aliases
      .split(",")
      .map((alias) => alias.trim())
      .filter(Boolean);

    if (locationForm.id) {
      await updateLocation(locationForm.id, {
        name,
        city: locationForm.city.trim() || "Cartagena",
        aliases,
      });
    } else {
      await createLocation(name, locationForm.city, aliases);
    }

    setLocationForm(null);
    setError(null);
    onToast(locationForm.id ? "Local actualizado" : "Local creado");
    await load();
  }

  async function toggleLocation(location: Location) {
    await updateLocation(location.id, { active: location.active === false });
    await load();
  }

  async function saveUploadSettings() {
    await setSetting("uploadUrl", uploadUrl.trim());
    await setSetting("uploadToken", uploadToken.trim());
    setUploadStatus("Guardado");
    onToast("Ajustes guardados");
  }

  async function uploadDay() {
    const url = uploadUrl.trim();
    if (!url) {
      setError("Pegá la URL del Apps Script.");
      return;
    }
    setUploading(true);
    try {
      const payload = await buildDaily(todayIso());
      if (!payload.total) {
        setError("Hoy no hay citas para subir.");
        return;
      }
      const message = await uploadDaily(url, uploadToken.trim(), payload);
      setError(null);
      setUploadStatus(message);
      onToast(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo subir.");
    } finally {
      setUploading(false);
    }
  }

  function askUpload() {
    setConfirm({
      title: "Subir cierre del día",
      body: "Se envían las citas de hoy a tu Google Sheet. Si ya subiste hoy, no se duplican.",
      confirmLabel: "Subir",
      run: async () => {
        await uploadDay();
      },
    });
  }

  async function uploadWeek() {
    const url = uploadUrl.trim();
    if (!url) {
      setError("Pegá la URL del Apps Script.");
      return;
    }
    setUploading(true);
    try {
      const today = todayIso();
      const payload = await buildRange(isoWithOffset(today, -6), today);
      if (!payload.total) {
        setError("No hay citas en los últimos 7 días.");
        return;
      }
      const message = await uploadDaily(url, uploadToken.trim(), payload);
      setError(null);
      setUploadStatus(message);
      onToast(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo subir.");
    } finally {
      setUploading(false);
    }
  }

  function askUploadWeek() {
    setConfirm({
      title: "Subir últimos 7 días",
      body: "Se envían las citas de la última semana. Las que ya están en la hoja se saltan, así que no hay duplicados.",
      confirmLabel: "Subir 7 días",
      run: async () => {
        await uploadWeek();
      },
    });
  }

  function changeAdminPin() {
    if (adminCurrent !== adminPin) {
      setAdminError("El PIN actual no coincide.");
      return;
    }
    if (!/^\d{4}$/.test(adminNew)) {
      setAdminError("El PIN nuevo debe tener 4 dígitos.");
      return;
    }
    if (adminNew !== adminRepeat) {
      setAdminError("Los PIN nuevos no coinciden.");
      return;
    }
    setConfirm({
      title: "Cambiar PIN de administrador",
      body: "El próximo acceso a administración va a usar el PIN nuevo.",
      confirmLabel: "Cambiar",
      run: async () => {
        await setAdminPin(adminNew);
        await setSetting("adminHint", adminHint.trim());
        setAdminPinValue(adminNew);
        setAdminCurrent("");
        setAdminNew("");
        setAdminRepeat("");
        setAdminError(null);
        onToast("PIN de administrador cambiado");
        onConfigChanged();
      },
    });
  }

  async function openSub(kind: "week" | "clients", technician: Technician) {
    setSub({ kind, technician });
    setLoadingSub(true);
    try {
      if (kind === "week") setWeek(await weekOverview(todayIso(), technician.id));
      else setClients(await clientsOfTechnician(technician.id));
    } finally {
      setLoadingSub(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-canvas/95 px-5 pb-3 pt-6 backdrop-blur">
        <button type="button" onClick={onClose} className="text-xs font-semibold text-muted">
          ‹ Volver
        </button>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand">
          Administración
        </p>
        <span className="w-10" />
      </header>

      <main className="flex-1 space-y-4 px-5 pb-24">
        <p className="rounded-xl bg-brand-soft px-3 py-2 text-[11px] text-brand">
          Agregá, desactivá o borrá técnicos. Podés ver su calendario y sus clientes.
        </p>

        <section className="rounded-2xl border border-line bg-surface p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold">Cierre del día</p>
              <p className="text-[10px] text-muted">Todas las citas de hoy, en CSV.</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => void exportDay()}
                className="h-9 rounded-lg border border-line px-2 text-[11px] font-semibold text-brand"
              >
                CSV
              </button>
              <button
                type="button"
                onClick={() => void exportDayPhotos()}
                className="h-9 rounded-lg border border-line px-2 text-[11px] font-semibold text-brand"
              >
                Fotos ZIP
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-3">
          <p className="text-xs font-semibold">Todo el negocio</p>
          <p className="text-[10px] text-muted">Todos los técnicos juntos, no uno por uno.</p>
          <div className="mt-2 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => void openBusiness("day")}
              className="h-9 rounded-lg border border-line text-[11px] font-semibold text-brand"
            >
              Hoy (todos)
            </button>
            <button
              type="button"
              onClick={() => void openBusiness("clients")}
              className="h-9 rounded-lg border border-line text-[11px] font-semibold text-brand"
            >
              Clientes (todos)
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-3">
          <p className="text-xs font-semibold">Subir a Google</p>
          <p className="text-[10px] text-muted">Cierre del día a tu hoja (Apps Script).</p>
          <input
            value={uploadUrl}
            onChange={(event) => setUploadUrl(event.target.value)}
            placeholder="URL del Apps Script (/exec)"
            className="mt-2 w-full rounded-lg border border-line bg-canvas px-2 py-2 text-[11px] outline-none focus:border-brand"
          />
          <input
            value={uploadToken}
            onChange={(event) => setUploadToken(event.target.value)}
            placeholder="Token"
            className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-2 text-[11px] outline-none focus:border-brand"
          />
          <div className="mt-2 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => void saveUploadSettings()}
              className="h-9 rounded-lg border border-line text-[11px] font-semibold text-muted"
            >
              Guardar
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={askUpload}
              className="grid h-9 place-items-center rounded-lg bg-brand-solid text-[11px] font-semibold text-white disabled:opacity-60"
            >
              {uploading ? (
                <span className="flex items-center gap-1">
                  <Spinner className="h-3.5 w-3.5" />
                  Subiendo…
                </span>
              ) : (
                "Subir hoy"
              )}
            </button>
          </div>
          <button
            type="button"
            disabled={uploading}
            onClick={askUploadWeek}
            className="mt-1 h-9 w-full rounded-lg border border-line text-[11px] font-semibold text-brand disabled:opacity-60"
          >
            Subir últimos 7 días
          </button>
          <button
            type="button"
            onClick={onSyncConfig}
            className="mt-1 h-9 w-full rounded-lg border border-line text-[11px] font-semibold text-brand"
          >
            Sincronizar configuración (PINs)
          </button>
          {uploadStatus && <p className="mt-1 text-[10px] text-brand">{uploadStatus}</p>}
        </section>

        <section className="rounded-2xl border border-line bg-surface p-3">
          <p className="text-xs font-semibold">Agregar técnico</p>
          <div className="mt-2 space-y-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nombre"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <input
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="PIN de 4 dígitos"
              inputMode="numeric"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <button
              type="button"
              onClick={() => void add()}
              className="h-10 w-full rounded-lg bg-brand-solid text-sm font-semibold text-white"
            >
              Agregar
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold">Locales</p>
              <p className="text-[10px] text-muted">Nombre, ciudad y alias.</p>
            </div>
            <button
              type="button"
              onClick={() => setLocationForm({ name: "", city: "Cartagena", aliases: "" })}
              className="h-9 rounded-lg border border-line px-3 text-[11px] font-semibold text-brand"
            >
              Agregar
            </button>
          </div>

          <div className="mt-2 space-y-1">
            {locations.map((location) => (
              <div
                key={location.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-canvas px-2 py-1.5"
              >
                <div className="min-w-0">
                  <p
                    className={`truncate text-[12px] font-semibold ${
                      location.active === false ? "text-muted line-through" : ""
                    }`}
                  >
                    {location.name}
                  </p>
                  <p className="truncate text-[10px] text-muted">
                    {location.city}
                    {location.aliases.length ? ` · ${location.aliases.join(", ")}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setLocationForm({
                        id: location.id,
                        name: location.name,
                        city: location.city,
                        aliases: location.aliases.join(", "),
                      })
                    }
                    className="rounded-md border border-line px-2 py-1 text-[10px] font-semibold text-muted"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleLocation(location)}
                    className="rounded-md border border-line px-2 py-1 text-[10px] font-semibold text-muted"
                  >
                    {location.active === false ? "Activar" : "Desactivar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-3">
          <p className="text-xs font-semibold">PIN de administrador</p>
          <p className="mt-1 text-[10px] text-muted">Actual: {adminPin}</p>
          <div className="mt-2 grid grid-cols-3 gap-1">
            <input
              value={adminCurrent}
              onChange={(event) =>
                setAdminCurrent(event.target.value.replace(/\D/g, "").slice(0, 4))
              }
              placeholder="Actual"
              inputMode="numeric"
              type="password"
              className="w-full rounded-lg border border-line bg-canvas px-2 py-2 text-xs"
            />
            <input
              value={adminNew}
              onChange={(event) => setAdminNew(event.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="Nuevo"
              inputMode="numeric"
              type="password"
              className="w-full rounded-lg border border-line bg-canvas px-2 py-2 text-xs"
            />
            <input
              value={adminRepeat}
              onChange={(event) =>
                setAdminRepeat(event.target.value.replace(/\D/g, "").slice(0, 4))
              }
              placeholder="Repetir"
              inputMode="numeric"
              type="password"
              className="w-full rounded-lg border border-line bg-canvas px-2 py-2 text-xs"
            />
          </div>
          {adminError && <p className="mt-1 text-[10px] text-danger">{adminError}</p>}
          <input
            value={adminHint}
            onChange={(event) => setAdminHint(event.target.value)}
            placeholder="Pista del PIN (opcional)"
            aria-label="Pista del PIN de administrador"
            className="mt-1 w-full rounded-lg border border-line bg-canvas px-2 py-2 text-xs outline-none focus:border-brand"
          />
          <button
            type="button"
            onClick={changeAdminPin}
            className="mt-2 h-9 w-full rounded-lg border border-line text-xs font-semibold text-muted"
          >
            Cambiar PIN de administrador
          </button>
        </section>

        <section className="space-y-2">
          {technicians.map((technician) => (
            <article key={technician.id} className="rounded-2xl border border-line bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: technician.color }}
                  >
                    {technician.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{technician.name}</p>
                    <p className="text-[10px] text-muted">
                      {technician.active === false ? "Desactivado" : "Activo"} · PIN{" "}
                      {technician.pin} · {counts[technician.id] ?? 0} citas
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void toggle(technician)}
                  className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold ${
                    technician.active === false
                      ? "bg-brand-soft text-brand"
                      : "bg-canvas text-muted"
                  }`}
                >
                  {technician.active === false ? "Activar" : "Desactivar"}
                </button>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => void openSub("week", technician)}
                  className="rounded-lg border border-line py-1.5 text-[10px] font-semibold text-muted"
                >
                  Calendario
                </button>
                <button
                  type="button"
                  onClick={() => void openSub("clients", technician)}
                  className="rounded-lg border border-line py-1.5 text-[10px] font-semibold text-muted"
                >
                  Clientes
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setEditForm({
                      id: technician.id,
                      name: technician.name,
                      pin: technician.pin,
                      hint: technician.hint ?? "",
                    })
                  }
                  className="rounded-lg border border-line py-1.5 text-[10px] font-semibold text-brand"
                >
                  Editar
                </button>
              </div>

              <div className="mt-1 grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => void exportClients(technician)}
                  className="rounded-lg border border-line py-1.5 text-[10px] font-semibold text-muted"
                >
                  Clientes CSV
                </button>
                <button
                  type="button"
                  onClick={() => seed(technician)}
                  className="rounded-lg border border-line py-1.5 text-[10px] font-semibold text-brand"
                >
                  Crear datos
                </button>
                <button
                  type="button"
                  onClick={() => clear(technician)}
                  className="rounded-lg border border-danger/30 py-1.5 text-[10px] font-semibold text-danger"
                >
                  Borrar datos
                </button>
              </div>
            </article>
          ))}
        </section>

        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
      </main>

      {sub && (
        <Sheet
          title={
            sub.kind === "week"
              ? `Semana · ${sub.technician.name}`
              : `Clientes · ${sub.technician.name}`
          }
          onClose={() => setSub(null)}
        >
          {loadingSub ? (
            <p className="text-sm text-muted">Cargando…</p>
          ) : sub.kind === "week" ? (
            <div className="max-h-[55vh] space-y-1 overflow-y-auto">
              {week.map((day) => (
                <div
                  key={day.date}
                  className="flex items-center justify-between rounded-lg bg-surface px-3 py-2 text-xs"
                >
                  <span className="capitalize">{formatShort(day.date)}</span>
                  <span className="text-muted">
                    {day.appointments} cita{day.appointments === 1 ? "" : "s"}
                  </span>
                  <span className="font-semibold">
                    {day.free === 0 ? "Lleno" : `${day.free} libres`}
                  </span>
                </div>
              ))}
            </div>
          ) : clients.length === 0 ? (
            <p className="text-sm text-muted">Todavía no tiene clientes.</p>
          ) : (
            <div className="max-h-[55vh] space-y-1 overflow-y-auto">
              {clients.map((client) => (
                <div
                  key={client.clientId}
                  className="flex items-center justify-between rounded-lg bg-surface px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{client.name}</p>
                    <p className="text-[10px] text-muted">{client.phone ?? "sin teléfono"}</p>
                  </div>
                  <span className="shrink-0 text-muted">
                    {client.visits} visita{client.visits === 1 ? "" : "s"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Sheet>
      )}

      {editForm && (
        <Sheet title="Editar técnico" onClose={() => setEditForm(null)}>
          <div className="space-y-2">
            <input
              value={editForm.name}
              onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
              placeholder="Nombre"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <input
              value={editForm.pin}
              onChange={(event) =>
                setEditForm({
                  ...editForm,
                  pin: event.target.value.replace(/\D/g, "").slice(0, 4),
                })
              }
              placeholder="PIN de 4 dígitos"
              inputMode="numeric"
              aria-label="PIN del técnico"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <input
              value={editForm.hint}
              onChange={(event) => setEditForm({ ...editForm, hint: event.target.value })}
              placeholder="Pista del PIN (opcional)"
              aria-label="Pista del PIN"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <p className="text-[10px] text-muted">
              El técnico va a usar este nombre y PIN la próxima vez que entre.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void saveTechnician()}
            className="mt-3 h-11 w-full rounded-xl bg-brand-solid text-sm font-semibold text-white"
          >
            Guardar
          </button>

          <button
            type="button"
            onClick={() => {
              const target = technicians.find((item) => item.id === editForm.id);
              setEditForm(null);
              if (target) remove(target);
            }}
            className="mt-2 h-10 w-full rounded-xl border border-danger/30 text-xs font-semibold text-danger"
          >
            Eliminar técnico
          </button>
        </Sheet>
      )}

      {locationForm && (
        <Sheet
          title={locationForm.id ? "Editar local" : "Nuevo local"}
          onClose={() => setLocationForm(null)}
        >
          <div className="space-y-2">
            <input
              value={locationForm.name}
              onChange={(event) =>
                setLocationForm({ ...locationForm, name: event.target.value })
              }
              placeholder="Nombre del local"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <input
              value={locationForm.city}
              onChange={(event) =>
                setLocationForm({ ...locationForm, city: event.target.value })
              }
              placeholder="Ciudad"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <input
              value={locationForm.aliases}
              onChange={(event) =>
                setLocationForm({ ...locationForm, aliases: event.target.value })
              }
              placeholder="Alias separados por coma (opcional)"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <p className="text-[10px] text-muted">
              Los alias sirven para reconocer el local cuando el mensaje lo escribe distinto
              (ej.: "Ofero centro").
            </p>
          </div>
          <button
            type="button"
            onClick={() => void saveLocation()}
            className="mt-3 h-11 w-full rounded-xl bg-brand-solid text-sm font-semibold text-white"
          >
            Guardar
          </button>
        </Sheet>
      )}

      {business && (
        <Sheet
          title={business === "day" ? "Hoy · todo el negocio" : "Clientes · todo el negocio"}
          onClose={() => setBusiness(null)}
        >
          {business === "day" ? (
            businessRows.length === 0 ? (
              <p className="text-sm text-muted">No hay citas hoy.</p>
            ) : (
              <div className="max-h-[55vh] space-y-1 overflow-y-auto">
                <p className="mb-2 text-[11px] text-muted">{businessRows.length} citas hoy</p>
                {businessRows.map((appointment) => (
                  <div
                    key={appointment.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-surface px-2 py-1.5 text-[11px]"
                  >
                    <span className="w-11 shrink-0 font-mono font-semibold">
                      {appointment.time ?? "—"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{appointment.name ?? "Sin nombre"}</p>
                      <p className="truncate text-[10px] text-muted">
                        {technicians.find((item) => item.id === appointment.technicianId)?.name ??
                          appointment.technicianId}
                      </p>
                    </div>
                    <Label tone={STATUS_TONE[appointment.status]} dot>
                      {STATUS_LABEL[appointment.status]}
                    </Label>
                  </div>
                ))}
              </div>
            )
          ) : businessClients.length === 0 ? (
            <p className="text-sm text-muted">Todavía no hay clientes.</p>
          ) : (
            <div className="max-h-[55vh] space-y-1 overflow-y-auto">
              <p className="mb-2 text-[11px] text-muted">
                {businessClients.length} clientes en todos los técnicos
              </p>
              {businessClients.map((client) => (
                <div
                  key={client.clientId}
                  className="flex items-center justify-between gap-2 rounded-lg bg-surface px-2 py-1.5 text-[11px]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{client.name}</p>
                    <p className="truncate text-[10px] text-muted">
                      {client.phone ?? "sin teléfono"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-[10px] text-muted">
                    <p>
                      {client.visits} visita{client.visits === 1 ? "" : "s"}
                    </p>
                    <p>{client.lastDate ? formatShort(client.lastDate) : "—"}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Sheet>
      )}

      {confirm && (
        <ConfirmSheet
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const run = confirm.run;
            setConfirm(null);
            void run();
          }}
        />
      )}
    </div>
  );
}

function ConfirmSheet({
  title,
  body,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Sheet title={title} onClose={onCancel}>
      <p className="text-sm text-muted">{body}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-12 rounded-xl border border-line bg-surface text-sm font-semibold"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`h-12 rounded-xl text-sm font-semibold text-white ${
            danger ? "bg-danger" : "bg-brand-solid"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

function ClientsView({
  clients,
  onOpen,
  onAdd,
}: {
  clients: TechnicianClient[];
  onOpen: (client: TechnicianClient) => void;
  onAdd: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "upcoming" | "none">("all");

  const fold = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const visible = clients.filter((client) => {
    const haystack = `${client.name} ${client.phone ?? ""}`;
    if (query.trim() && !fold(haystack).includes(fold(query.trim()))) return false;
    if (filter === "upcoming") return Boolean(client.nextDate);
    if (filter === "none") return !client.nextDate;
    return true;
  });

  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Buscar por nombre o teléfono"
        aria-label="Buscar cliente"
        className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand"
      />

      <div className="flex gap-1">
        {(
          [
            { key: "all", label: "Todos" },
            { key: "upcoming", label: "Con cita" },
            { key: "none", label: "Sin cita" },
          ] as const
        ).map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setFilter(option.key)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
              filter === option.key
                ? "bg-brand-solid text-white"
                : "border border-line bg-surface text-muted"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {clients.length === 0 ? (
        <EmptyState
          title="Todavía no hay clientes"
          body="Cuando cargues una cita, el cliente aparece acá con su historial."
          action="Pegar mensaje"
          onAction={onAdd}
          kind="clients"
        />
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-surface/70 px-4 py-6 text-center text-sm text-muted">
          Ningún cliente coincide con la búsqueda.
        </p>
      ) : (
        visible.map((client) => (
          <button
            key={client.clientId}
            type="button"
            onClick={() => onOpen(client)}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left active:scale-[0.99]"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{client.name}</p>
              <p className="truncate text-[11px] text-muted">
                {client.phone ?? "sin teléfono"} · {client.visits} visita
                {client.visits === 1 ? "" : "s"}
              </p>
              <p className="mt-0.5 text-[10px] text-muted">
                {client.nextDate
                  ? `Próxima: ${formatShort(client.nextDate)}`
                  : "Sin cita próxima"}
              </p>
            </div>
            <span className="shrink-0 text-lg text-muted">›</span>
          </button>
        ))
      )}
    </div>
  );
}

function ClientSheet({
  client,
  appointments,
  onClose,
  onOpen,
}: {
  client: TechnicianClient;
  appointments: Appointment[];
  onClose: () => void;
  onOpen: (appointment: Appointment) => void;
}) {
  return (
    <Sheet title={client.name} onClose={onClose}>
      <p className="mb-3 text-xs text-muted">
        {client.phone ?? "sin teléfono"} · {appointments.length} visita
        {appointments.length === 1 ? "" : "s"}
      </p>

      <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
        {appointments.length === 0 ? (
          <p className="text-sm text-muted">Sin historial todavía.</p>
        ) : (
          appointments.map((appointment) => (
            <button
              key={appointment.id}
              type="button"
              onClick={() => onOpen(appointment)}
              className="w-full rounded-xl border border-line bg-surface p-3 text-left active:scale-[0.99]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold capitalize">
                  {appointment.date ? formatShort(appointment.date) : "Sin fecha"}
                </span>
                <Label tone={STATUS_TONE[appointment.status]} dot>
                  {STATUS_LABEL[appointment.status]}
                </Label>
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {appointment.type ? TYPE_LABEL[appointment.type] : "—"}
                {appointment.amount !== null ? ` · ${money(appointment.amount)}` : ""}
              </p>
              {appointment.notes && (
                <p className="mt-1 line-clamp-2 text-[11px] text-muted">{appointment.notes}</p>
              )}
              {((appointment.photoIds?.length ?? 0) > 0 || appointment.photoId) && (<p className="mt-1 text-[10px] text-brand">📷 con foto</p>)}
            </button>
          ))
        )}
      </div>
    </Sheet>
  );
}

function DaySheet({
  date,
  appointments,
  availability,
  onClose,
  onOpen,
  onAdd,
}: {
  date: string;
  appointments: Appointment[];
  availability: AvailabilityBlock[];
  onClose: () => void;
  onOpen: (appointment: Appointment) => void;
  onAdd: () => void;
}) {
  const morning = appointments.filter((item) => windowOf(item.type) === "morning");
  const afternoon = appointments.filter((item) => windowOf(item.type) === "afternoon");

  return (
    <Sheet title={formatLong(date)} onClose={onClose}>
      {availability.length > 0 && (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {availability.map((block) => (
            <span
              key={block.id}
              className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold ${
                block.state === "full"
                  ? "bg-danger-soft text-danger"
                  : block.state === "last"
                    ? "bg-warn-soft text-warn"
                    : "bg-brand-soft text-brand"
              }`}
            >
              {WINDOW_LABEL[block.window]} {block.occupied}/{block.capacity}
            </span>
          ))}
        </div>
      )}

      <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
        {appointments.length === 0 ? (
          <p className="rounded-xl bg-surface px-3 py-6 text-center text-sm text-muted">
            No hay citas este día.
          </p>
        ) : (
          <>
            {[
              { title: "Jornada mañana", window: "morning" as const, items: morning },
              { title: "Jornada tarde", window: "afternoon" as const, items: afternoon },
            ].map((group) =>
              group.items.length ? (
                <section key={group.title}>
                  <p className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                    <span
                      className={group.window === "morning" ? "text-amber-500" : "text-orange-600"}
                    >
                      <WindowIcon window={group.window} className="h-4 w-4" />
                    </span>
                    {group.title}
                  </p>
                  <div className="space-y-2">
                    {group.items.map((appointment) => (
                      <AppointmentCard
                        key={appointment.id}
                        appointment={appointment}
                        onOpen={onOpen}
                      />
                    ))}
                  </div>
                </section>
              ) : null
            )}
          </>
        )}
      </div>

      <button
        type="button"
        onClick={onAdd}
        className="mt-4 h-11 w-full rounded-xl border border-line bg-surface text-sm font-semibold text-muted"
      >
        Pegar mensaje
      </button>
    </Sheet>
  );
}

function ManualAppointmentSheet({
  message,
  technicianId,
  locations,
  onClose,
  onSaved,
}: {
  message: InboxMessage | null;
  technicianId: string;
  locations: Location[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState("08:00");
  const [type, setType] = useState<ServiceType>("maintenance");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<{
    occupied: number;
    capacity: number;
    free: number;
  } | null>(null);

  useEffect(() => {
    void capacityFor(date, type, technicianId).then(setCapacity);
  }, [date, type, technicianId]);

  async function save() {
    if (name.trim().length < 2) {
      setError("Falta el nombre del cliente.");
      return;
    }
    if (!date) {
      setError("Falta la fecha.");
      return;
    }

    if (capacity && capacity.free <= 0) {
      const next = await nextFreeSlot(date, type, technicianId);
      setError(
        `La jornada está completa (${capacity.occupied}/${capacity.capacity}).${
          next ? ` Próximo hueco: ${formatShort(next.date)} a las ${next.time}.` : ""
        }`
      );
      return;
    }

    const conflict = await timeConflict(date, time, technicianId);
    if (conflict) {
      setError(
        `Ya hay una cita a las ${conflict.time} (${conflict.name ?? "otro cliente"}). Cambiá la hora.`
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const draft: Draft = {
        type,
        secondaryType: null,
        status: "scheduled",
        name: name.trim(),
        model: model.trim() || null,
        date,
        weekday: weekdayOf(date),
        time: time || null,
        endTime: null,
        isWindow: false,
        phone: phone.replace(/\D/g, "").slice(-10) || null,
        location: null,
        address: null,
        part: null,
        description: notes.trim() || null,
        instructions: null,
        amount: null,
        payment: "pending",
        plate: null,
        serial: null,
        extras: {},
        originalText: message?.text ?? "",
        receivedAt: message?.receivedAt ?? new Date().toISOString(),
      };
      await saveDrafts([{ ...draft, locationId }], technicianId);
      if (message) await deleteMessage(message.id);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title={message ? "Clasificar mensaje" : "Nueva cita"} onClose={onClose}>
      <div className="max-h-[66vh] space-y-3 overflow-y-auto pr-1">
        {message && (
          <p className="max-h-24 overflow-y-auto rounded-xl bg-surface p-3 text-[11px] whitespace-pre-line text-muted">
            {message.text}
          </p>
        )}

        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nombre del cliente"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <input
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="Vehículo / modelo"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <input
          value={phone}
          onChange={(event) =>
            setPhone(event.target.value.replace(/[^\d+ ]/g, "").slice(0, 15))
          }
          placeholder="Teléfono (opcional)"
          inputMode="tel"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        />

        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm"
          />
          <input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm"
          />
        </div>

        {capacity && (
          <p className={`text-[11px] ${capacity.free <= 0 ? "text-danger" : "text-muted"}`}>
            {WINDOW_LABEL[windowOf(type)]}: {capacity.occupied}/{capacity.capacity}
            {capacity.free <= 0 ? " · completa" : ` · quedan ${capacity.free}`}
          </p>
        )}

        <select
          value={type}
          onChange={(event) => setType(event.target.value as ServiceType)}
          className="w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm"
        >
          <option value="maintenance">Mantenimiento</option>
          <option value="revision">Revisión</option>
          <option value="warranty">Garantía</option>
          <option value="part">Repuesto</option>
        </select>

        <select
          value={locationId ?? ""}
          onChange={(event) => setLocationId(event.target.value || null)}
          className="w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm"
        >
          <option value="">Sin local</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>

        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          placeholder="Notas"
          className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        />

        {error && <p className="rounded-lg bg-danger-soft px-2 py-1.5 text-xs text-danger">{error}</p>}
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="mt-4 h-12 w-full rounded-xl bg-brand-solid text-sm font-semibold text-white disabled:opacity-50"
      >
        {saving ? "Guardando…" : "Convertir en cita"}
      </button>
    </Sheet>
  );
}

