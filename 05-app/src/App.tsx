import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { parseMessage, splitMessages } from "./parser.js";
import {
  appointmentsForDay,
  availabilityForDay,
  closeAppointment,
  findMatch,
  getPhoto,
  getTechnician,
  historyForClient,
  inboxCount as countInbox,
  listInbox,
  listLocations,
  listSchedule,
  listTechnicians,
  resolveLocationText,
  saveDrafts,
  suggestLocationId,
  todayIso,
  updateScheduleBlock,
  weekOverview,
  windowOf,
} from "./db";
import { compressPhoto } from "./images";
import type {
  Alert,
  Appointment,
  AppointmentStatus,
  AvailabilityBlock,
  DaySummary,
  DraftMode,
  InboxMessage,
  Location,
  ParseResult,
  ReviewDraft,
  ScheduleBlock,
  ServiceType,
  Technician,
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

const STATUS_STYLE: Record<AppointmentStatus, string> = {
  scheduled: "bg-canvas text-muted",
  to_confirm: "bg-warn-soft text-warn",
  confirmed: "bg-brand-soft text-brand",
  attended: "bg-brand-solid text-white",
  no_show: "bg-danger-soft text-danger",
  rescheduled: "bg-canvas text-muted",
  cancelled: "bg-canvas text-muted line-through",
};

const TYPE_LABEL: Record<ServiceType, string> = {
  maintenance: "Mantenimiento",
  revision: "Revisión",
  warranty: "Garantía",
  part: "Repuesto",
};

const WINDOW_LABEL: Record<"morning" | "afternoon", string> = {
  morning: "Mañana",
  afternoon: "Tarde",
};

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
  const [view, setView] = useState<"today" | "inbox" | "week">("today");
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
  const [visit, setVisit] = useState<Appointment | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
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
    const [dayAppointments, dayAvailability, inboxItems, inboxCount, weekDays, locationList] =
      await Promise.all([
        appointmentsForDay(current, technician.id),
        availabilityForDay(current, technician.id),
        listInbox(),
        countInbox(),
        weekOverview(current, technician.id),
        listLocations(),
      ]);
    setAppointments(dayAppointments);
    setAvailability(dayAvailability);
    setInbox(inboxItems);
    setInboxTotal(inboxCount);
    setWeek(weekDays);
    setLocations(locationList);
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

  function switchTechnician() {
    localStorage.removeItem("technicianId");
    setTechnician(null);
    setView("today");
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
        Cargandoâ€¦
      </div>
    );
  }

  if (!technician) {
    return (
      <Login
        technicians={technicians}
        theme={theme}
        onToggleTheme={() => setTheme(theme === "dim" ? "light" : "dim")}
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
            onClick={switchTechnician}
            className="flex items-center gap-2 text-left"
            title="Cambiar de técnico"
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
        {view === "inbox" && <InboxView messages={inbox} onAdd={() => setSheet("actions")} />}
        {view === "week" && <WeekView days={week} />}
      </main>

      <button
        type="button"
        onClick={() => setSheet("actions")}
        aria-label="Agregar"
        className="fixed bottom-24 right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-brand-solid text-3xl font-light text-white shadow-xl shadow-brand-solid/30 active:scale-95"
      >
        +
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
            placeholder="PROGRAMACION DE MANTENIMIENTOâ€¦"
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

      {visit && (
        <VisitSheet
          appointment={visit}
          onClose={() => setVisit(null)}
          onSaved={async () => {
            setVisit(null);
            await refresh();
            setToast("Visita cerrada");
          }}
        />
      )}

      {toast && (
        <div className="fixed left-1/2 top-4 z-40 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white shadow-lg">
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
        <div className="flex gap-2 overflow-x-auto pb-1">
          {availability.map((block) => (
            <div
              key={block.id}
              className={`shrink-0 rounded-xl border px-3 py-2 text-xs ${
                block.state === "full"
                  ? "border-danger/30 bg-danger-soft text-danger"
                  : block.state === "last"
                    ? "border-warn/30 bg-warn-soft text-warn"
                    : "border-line bg-surface text-ink"
              }`}
            >
              <p className="font-bold">{WINDOW_LABEL[block.window]}</p>
              <p className="mt-0.5">
                {block.occupied}/{block.capacity} · {block.locationName}
              </p>
            </div>
          ))}
        </div>
      )}

      {appointments.length === 0 ? (
        <EmptyState
          title="No hay nada cargado hoy"
          body="Pegá el mensaje que te llegó por WhatsApp y aparece acá."
          action="Pegar mensaje"
          onAction={onAdd}
        />
      ) : (
        <>
          <AppointmentGroup
            title="Mañana · Recepción 8:00–9:00"
            block={availability.find((item) => item.window === "morning")}
            items={morning}
            onOpen={onOpen}
          />
          <AppointmentGroup
            title="Tarde · Revisión 14:00–16:00"
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
  block,
  items,
  onOpen,
}: {
  title: string;
  block?: AvailabilityBlock;
  items: Appointment[];
  onOpen: (appointment: Appointment) => void;
}) {
  if (!items.length) return null;

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted">{title}</h2>
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
      className="cursor-pointer rounded-2xl border border-line bg-surface p-4 shadow-sm active:scale-[0.995]"
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
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${STATUS_STYLE[appointment.status]}`}
        >
          {STATUS_LABEL[appointment.status]}
        </span>
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
        {appointment.type && (
          <span className="rounded-md bg-canvas px-1.5 py-0.5 font-semibold">
            {TYPE_LABEL[appointment.type]}
          </span>
        )}
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

function InboxView({ messages, onAdd }: { messages: InboxMessage[]; onAdd: () => void }) {
  return (
    <div className="space-y-3">
      {messages.length === 0 ? (
        <EmptyState
          title="La bandeja está vacía"
          body="Acá caen los mensajes que no se pudieron interpretar."
          action="Pegar mensaje"
          onAction={onAdd}
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
          </article>
        ))
      )}
    </div>
  );
}

function WeekView({ days }: { days: DaySummary[] }) {
  return (
    <div className="space-y-2">
      {days.map((day) => (
        <div
          key={day.date}
          className="flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3"
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
        </div>
      ))}
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
          {busy ? "Guardandoâ€¦" : "Confirmar"}
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
  view: "today" | "inbox" | "week";
  onChange: (view: "today" | "inbox" | "week") => void;
  inboxCount: number;
}) {
  const items = [
    { key: "today", label: "Hoy" },
    { key: "inbox", label: "Bandeja" },
    { key: "week", label: "Semana" },
  ] as const;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto grid max-w-md grid-cols-3">
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
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl bg-canvas p-5 pb-8 shadow-2xl"
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
      <span className="text-lg text-muted">â€º</span>
    </button>
  );
}

function EmptyState({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface/70 p-6 text-center">
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
  onLogin,
}: {
  technicians: Technician[];
  theme: "light" | "dim";
  onToggleTheme: () => void;
  onLogin: (technician: Technician) => void;
}) {
  const [selected, setSelected] = useState<Technician | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  function submit(value: string) {
    if (!selected) return;
    if (value === selected.pin) {
      onLogin(selected);
      return;
    }
    setError(true);
    setPin("");
  }

  return (
    <div className="relative mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-6 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-solid text-2xl font-bold text-white">
          A
        </div>
        <h1 className="text-2xl font-extrabold">Agenda</h1>
        <p className="mt-1 text-sm text-muted">¿Quién está usando la agenda?</p>
      </div>

      {!selected ? (
        <div className="space-y-2">
          {technicians.map((technician) => (
            <button
              key={technician.id}
              type="button"
              onClick={() => {
                setSelected(technician);
                setPin("");
                setError(false);
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
              <span className="text-lg text-muted">â€º</span>
            </button>
          ))}
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setPin("");
              setError(false);
            }}
            className="mb-4 text-xs font-semibold text-muted"
          >
            â€¹ Volver
          </button>
          <p className="text-center text-sm font-semibold">{selected.name}</p>
          <p className="mt-1 text-center text-xs text-muted">PIN de 4 dígitos</p>
          <input
            autoFocus
            value={pin}
            onChange={(event) => {
              const value = event.target.value.replace(/\D/g, "").slice(0, 4);
              setPin(value);
              setError(false);
              if (value.length === 4) submit(value);
            }}
            inputMode="numeric"
            type="password"
            placeholder="â€¢â€¢â€¢â€¢"
            className={`mx-auto mt-4 block w-40 rounded-xl border bg-surface px-4 py-3 text-center text-2xl tracking-[0.4em] outline-none ${
              error ? "border-danger" : "border-line focus:border-brand"
            }`}
          />
          {error && (
            <p className="mt-2 text-center text-xs font-semibold text-danger">PIN incorrecto</p>
          )}
          <p className="mt-6 text-center text-[11px] text-muted">PIN inicial de prueba: 1234</p>
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
  onClose,
  onSaved,
}: {
  appointment: Appointment;
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
                          className="h-7 w-7 rounded-md border border-line text-sm"
                        >
                          −
                        </button>
                        <span className="w-5 text-center text-[12px] font-bold">
                          {block.capacity}
                        </span>
                        <button
                          type="button"
                          onClick={() => void step(block, 1)}
                          className="h-7 w-7 rounded-md border border-line text-sm"
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

