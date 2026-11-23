import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { parseMessage, splitMessages } from "./parser.js";
import {
  allAppointmentsForDay,
  appointmentsForDay,
  availabilityForDay,
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
  getPhoto,
  getTechnician,
  historyForClient,
  inboxCount as countInbox,
  isoWithOffset,
  listInbox,
  listLocations,
  listSchedule,
  listTechnicians,
  rescheduleAppointment,
  resolveLocationText,
  saveDrafts,
  seedDemoData,
  setAdminPin,
  setAppointmentStatus,
  suggestLocationId,
  todayIso,
  updateScheduleBlock,
  updateTechnician,
  updateLocation,
  weekdayOf,
  weekOverview,
  windowOf,
} from "./db";
import { compressPhoto } from "./images";
import { exportBackup, importBackup } from "./backup";
import { downloadCsv, downloadJson } from "./export";
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
  const [dayView, setDayView] = useState<{
    date: string;
    appointments: Appointment[];
    availability: AvailabilityBlock[];
  } | null>(null);
  const [manualMessage, setManualMessage] = useState<InboxMessage | null>(null);
  const [visit, setVisit] = useState<Appointment | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
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
  }, [technician]);

  useEffect(() => {
    void (async () => {
      const roster = await listTechnicians();
      setTechnicians(roster);
      const savedId = localStorage.getItem("technicianId");
      if (savedId) {
        const found = await getTechnician(savedId);
        if (found) setTechnician(found);
      }
      setBooting(false);
    })();
  }, []);

  useEffect(() => {
    if (technician) void refresh();
  }, [technician, refresh]);

  useEffect(() => {
    if (!technician) return;
    void weekOverview(weekStart, technician.id).then(setWeek);
  }, [weekStart, technician]);

  function switchTechnician() {
    localStorage.removeItem("technicianId");
    setTechnician(null);
    setView("today");
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
    if (!technician || week.length === 0) return;
    const places = await listLocations(true);
    const place = new Map(places.map((location) => [location.id, location.name]));
    const days = [];

    for (const day of week) {
      const [appointments, availability] = await Promise.all([
        appointmentsForDay(day.date, technician.id),
        availabilityForDay(day.date, technician.id),
      ]);
      days.push({
        fecha: day.date,
        cupos: availability.map((block) => ({
          jornada: block.window,
          desde: block.from,
          hasta: block.to,
          local: block.locationName,
          cupo: block.capacity,
          ocupados: block.occupied,
          libres: block.free,
        })),
        citas: appointments.map((appointment) => ({
          id: appointment.id,
          hora: appointment.time,
          cliente: appointment.name,
          telefono: appointment.phone,
          vehiculo: appointment.model,
          tipo: appointment.type,
          estado: appointment.status,
          local: appointment.locationId ? place.get(appointment.locationId) ?? null : null,
          monto: appointment.amount,
          observaciones: appointment.notes,
        })),
      });
    }

    downloadJson(`semana-${week[0].date}.json`, {
      generadoEn: new Date().toISOString(),
      tecnico: technician.name,
      desde: week[0].date,
      hasta: week[week.length - 1].date,
      dias: days,
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
          ? appointment.status === "cancelled"
            ? "cancel"
            : "update"
          : "create";
        return {
          ...appointment,
          alerts: result.alerts,
          locationId: fromText ?? suggested,
          mode,
          matchId: match?.id ?? null,
          matchLabel: match
            ? `${match.name} · ${match.date}${match.time ? ` · ${match.time}` : ""}`
            : null,
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
      setToast("El navegador no dejó leer el portapapeles. Pegá con Ctrl+V.");
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
      <AdminView
        onClose={() => {
          setAdminUnlocked(false);
          void listTechnicians().then(setTechnicians);
        }}
      />
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
          />
        )}
        {view === "inbox" && (
          <InboxView messages={inbox} onAdd={() => setSheet("actions")} onClassify={setManualMessage} />
        )}
        {view === "week" && (
          <WeekView
            days={week}
            onShift={(offset) => setWeekStart(isoWithOffset(weekStart, offset))}
            onOpenDay={(date) => void openDay(date)}
            onExport={() => void exportWeek()}
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
          <SheetAction title="Cargar cita a mano" hint="Pronto" disabled />
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
            setToast("Visita cerrada");
          }}
        />
      )}

      {profileOpen && (
        <ProfileSheet
          technician={technician}
          onClose={() => setProfileOpen(false)}
          onSaved={async () => {
            const updated = await getTechnician(technician.id);
            if (updated) setTechnician(updated);
            setProfileOpen(false);
            setToast("Perfil actualizado");
          }}
          onLogout={switchTechnician}
        />
      )}

      {toast && (
        <div className="fixed left-1/2 top-4 z-40 animate-toast -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function TodayView({
  appointments,
  availability,
  onAdd,
  onOpen,
}: {
  appointments: Appointment[];
  availability: AvailabilityBlock[];
  onAdd: () => void;
  onOpen: (appointment: Appointment) => void;
}) {
  const morning = appointments.filter((item) => windowOf(item.type) === "morning");
  const afternoon = appointments.filter((item) => windowOf(item.type) === "afternoon");

  return (
    <div className="space-y-6">
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
            title="Jornada mañana · Recepción 8:00–9:00"
            window="morning"
            block={availability.find((item) => item.window === "morning")}
            items={morning}
            onOpen={onOpen}
          />
          <AppointmentGroup
            title="Jornada tarde · Revisiones 14:00–16:00"
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
  onShift,
  onOpenDay,
  onExport,
}: {
  days: DaySummary[];
  onShift: (offset: number) => void;
  onOpenDay: (date: string) => void;
  onExport: () => void;
}) {
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

      <div className="flex justify-end">
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
          Descargar semana (JSON)
        </button>
      </div>

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
          />
        ))}
      </div>

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
          disabled={busy}
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
}: {
  draft: ReviewDraft;
  locations: Location[];
  onLocationChange: (locationId: string | null) => void;
  onMode: (mode: DraftMode) => void;
}) {
  const alerts: Alert[] = draft.alerts ?? [];
  const goesToInbox = !draft.name || !draft.date;

  const modeOptions: { key: DraftMode; label: string }[] = [
    { key: "update", label: "Actualizar" },
    { key: "create", label: "Crear nueva" },
  ];
  if (draft.status === "cancelled") {
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
          <div className="mt-1 flex gap-1">
            {modeOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => onMode(option.key)}
                className={`flex-1 rounded-md px-2 py-1 text-[10px] font-semibold ${
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
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [history, setHistory] = useState<Appointment[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [newDate, setNewDate] = useState(appointment.date ?? todayIso());

  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    void (async () => {
      if (appointment.photoId) {
        const photo = await getPhoto(appointment.photoId);
        if (photo && alive) {
          url = URL.createObjectURL(photo.blob);
          setExisting(url);
        }
      }
      if (appointment.clientId) {
        const items = await historyForClient(appointment.clientId);
        if (alive) setHistory(items.filter((item) => item.id !== appointment.id).slice(0, 4));
      }
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [appointment]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const photo = file ? await compressPhoto(file) : null;
      await closeAppointment(appointment.id, { status: outcome, notes, photo });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  const photoUrl = preview ?? existing;

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

        {appointment.phone && (() => {
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
            <div className="grid grid-cols-2 gap-2">
              <a
                href={`tel:+57${appointment.phone}`}
                className="grid h-10 place-items-center rounded-xl border border-line bg-surface text-xs font-semibold text-ink"
              >
                Llamar
              </a>
              <a
                href={`https://wa.me/57${appointment.phone}?text=${encodeURIComponent(text)}`}
                target="_blank"
                rel="noreferrer"
                className="grid h-10 place-items-center rounded-xl bg-brand-soft text-xs font-semibold text-brand"
              >
                Confirmar por WhatsApp
              </a>
            </div>
          );
        })()}

        <label className="flex h-32 w-full cursor-pointer items-center justify-center overflow-hidden rounded-2xl border border-dashed border-line bg-surface text-center">
          {photoUrl ? (
            <img src={photoUrl} alt="Evidencia de la visita" className="h-full w-full object-cover" />
          ) : (
            <span className="text-sm text-muted">
              <span className="mb-1 block text-2xl">📷</span>
              Tomar foto del vehículo
            </span>
          )}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>

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

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              void setAppointmentStatus(appointment.id, "confirmed").then(onSaved);
            }}
            className="h-10 rounded-xl border border-line bg-surface text-xs font-semibold text-brand"
          >
            Confirmar cita
          </button>
          <button
            type="button"
            onClick={() => setMoving((value) => !value)}
            className="h-10 rounded-xl border border-line bg-surface text-xs font-semibold text-muted"
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
  onClose,
  onSaved,
  onLogout,
}: {
  technician: Technician;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onLogout: () => void;
}) {
  const [name, setName] = useState(technician.name);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [repeatPin, setRepeatPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingImport, setPendingImport] = useState<File | null>(null);

  async function handleExport() {
    const blob = await exportBackup();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `agenda-respaldo-${todayIso()}.json`;
    link.click();
    URL.revokeObjectURL(url);
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

function AdminView({ onClose }: { onClose: () => void }) {
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
  const [adminPin, setAdminPinValue] = useState("");
  const [adminCurrent, setAdminCurrent] = useState("");
  const [adminNew, setAdminNew] = useState("");
  const [adminRepeat, setAdminRepeat] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
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
    await load();
  }

  async function toggleLocation(location: Location) {
    await updateLocation(location.id, { active: location.active === false });
    await load();
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
        setAdminPinValue(adminNew);
        setAdminCurrent("");
        setAdminNew("");
        setAdminRepeat("");
        setAdminError(null);
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
            <button
              type="button"
              onClick={() => void exportDay()}
              className="h-9 shrink-0 rounded-lg border border-line px-3 text-[11px] font-semibold text-brand"
            >
              Exportar CSV
            </button>
          </div>
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
                  onClick={() => void remove(technician)}
                  className="rounded-lg border border-danger/30 py-1.5 text-[10px] font-semibold text-danger"
                >
                  Eliminar
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
  return (
    <div className="space-y-2">
      {clients.length === 0 ? (
        <EmptyState
          title="Todavía no hay clientes"
          body="Cuando cargues una cita, el cliente aparece acá con su historial."
          action="Pegar mensaje"
          onAction={onAdd}
          kind="clients"
        />
      ) : (
        clients.map((client) => (
          <button
            key={client.clientId}
            type="button"
            onClick={() => onOpen(client)}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left active:scale-[0.99]"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{client.name}</p>
              <p className="text-[11px] text-muted">
                {client.phone ?? "sin teléfono"} · {client.visits} visita
                {client.visits === 1 ? "" : "s"}
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
              {appointment.photoId && <p className="mt-1 text-[10px] text-brand">📷 con foto</p>}
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
  message: InboxMessage;
  technicianId: string;
  locations: Location[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState("08:00");
  const [type, setType] = useState<ServiceType>("maintenance");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (name.trim().length < 2) {
      setError("Falta el nombre del cliente.");
      return;
    }
    if (!date) {
      setError("Falta la fecha.");
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
        phone: null,
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
        originalText: message.text,
        receivedAt: message.receivedAt,
      };
      await saveDrafts([{ ...draft, locationId }], technicianId);
      await deleteMessage(message.id);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title="Clasificar mensaje" onClose={onClose}>
      <div className="max-h-[66vh] space-y-3 overflow-y-auto pr-1">
        <p className="max-h-24 overflow-y-auto rounded-xl bg-surface p-3 text-[11px] whitespace-pre-line text-muted">
          {message.text}
        </p>

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

