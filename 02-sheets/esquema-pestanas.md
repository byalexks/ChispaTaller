# Esquema del libro real (fase 1–2)

Libro: `agenda-servicio-tecnico.xlsx` (subir a Drive → Guardar como hoja de cálculo
de Google). Nombres de pestañas sin espacios al inicio para no romper fórmulas.

## `Citas` — tabla transaccional

Una fila por cita. Fila 1 congelada, filtros activos, 500 filas preformateadas.

| Col | Campo | Tipo / validación |
|---|---|---|
| A | `id` | Texto autogenerado (`C-0001`) |
| B | `fecha` | Fecha real (validación `ESFECHA`) |
| C | `dia` | Fórmula `=TEXTO(B2;"dddd")` |
| D | `franja` | Mañana / Tarde |
| E | `tipo` | Mantenimiento / Revisión / Garantía / Repuesto |
| F | `estado` | Agendada / Confirmada / Asistió / No asistió / Reprogramada / Cancelada |
| G | `local` | Lista desde `Locales` |
| H | `cliente` | Texto |
| I | `telefono` | Texto |
| J | `modelo` | Texto |
| K | `serial` | Texto (VIN) |
| L | `placa` | Texto |
| M | `cobro` | Pagado / Gratuito / Garantía |
| N | `valor` | Moneda |
| O | `hora_entrada` | Hora |
| P | `hora_salida` | Hora |
| Q | `evidencia` | URL de Drive |
| R | `reprogramada_de` | `id` de la cita original |
| S | `observaciones` | Texto libre |
| T | `texto_original` | Mensaje de WhatsApp pegado |
| U | `creado_por` | Texto |
| V | `creado_en` | Fecha-hora |
| W | `actualizado_en` | Fecha-hora |

Formato condicional: fila gris si `estado` ∈ {Cancelada, Reprogramada, No
asistió}; rojo suave si `fecha` está vacía o es texto; verde si `Asistió`.

## `Capacidad` — reglas editables

```
local | dia_semana | max_mantenimientos | max_revisiones | activo
```

⚠️ Si el tope es **por local**, hay 6 locales × 6 días = 36 filas. Si es **total del
día**, basta una fila por día (o una sola fila con el tope general). La respuesta a
la pregunta 15/16 define esto.

## `Panel` — semáforo (solo fórmulas)

Por cada día de la semana visible:

```excel
Ocupados mantenimiento: =CONTAR.SI.CONJUNTO(Citas!B:B; fecha; Citas!E:E; "Mantenimiento"; Citas!F:F; "<>Cancelada"; Citas!F:F; "<>Reprogramada"; Citas!F:F; "<>No asistió")
Cupos libres:           =Capacidad!max_mantenimientos - Ocupados
Estado:                 =SI(libres<=0; "LLENO"; SI(libres=1; "CASI"; "DISPONIBLE"))
```

Colores: `DISPONIBLE` verde, `CASI` ámbar, `LLENO` rojo.
El panel debe responder las dos preguntas de negocio: *"¿cuántos van el
miércoles?"* y *"¿me cabe uno más?"*.

## `Locales`

```
nombre | ciudad | direccion | dias_abre | hora_inicio | hora_fin | notas
```

Precargado: Local 1–5 (Cartagena), Turbaco.

## `Clientes` / `Vehiculos`

Opcionales al inicio; se llenan solos desde `Citas` con `BUSCARV` o se cargan a
mano. Sirven para el historial (fase 4) y para no repetir datos.

## `Catalogos` y `Config`

- `Catalogos`: las listas de `tipo`, `estado`, `cobro`, `franja`. Las validaciones
  apuntan aquí, no a texto escrito en la fórmula.
- `Config`: nombre del negocio, zona horaria, tope global, si bloquea o avisa.

## `Log`

```
fecha_hora | usuario | accion | id_cita | detalle
```

Al inicio se llena a mano; si luego se automatiza, lo escribe el Apps Script.
