# Registro de decisiones

Formato: fecha · decisión · estado · motivo.

## Cerradas

| Fecha | Decisión | Motivo |
|---|---|---|
| 2026-11-23 | El producto es **solo un libro de Google Sheets**; no hay app, ni backend, ni parser automático en esta fase (**rama Excel**). | Es lo que el cliente quiere: todo se maneja en Google, un Sheet como base de datos. |
| 2026-11-23 | **Sin IA.** El parseo de mensajes es determinista: se leen las etiquetas de la plantilla y se valida. Lo que no es plantilla cae en bandeja para clasificar a mano. | El mensaje real es una plantilla con etiquetas (`*Nombre y Apellidos:*`, `*Vehículo:*`). No hay que adivinar nada. La IA solo se evalúa si aparecen mensajes libres que a mano no den abasto, y eso sería una decisión aparte. |
| 2026-11-23 | **No se programa una plantilla por mensaje.** El parser es un motor genérico: normalizar → segmentar etiquetas → mapear alias → detectores universales → validar. Agregar una plantilla nueva es configuración, no código. | Ya aparecieron 4 estructuras distintas; con regex por plantilla, el quinto mensaje rompe todo. |
| 2026-11-23 | Reglas del formato confirmadas por audio: cancelación = mismo formato + `CANCELADO` al final; revisión = ventana 14:00–16:00; mantenimiento = recepción 8:00–9:00 con entrega en la tarde; primer mantenimiento gratuito; `TOTAL A PAGAR` indica que es pago. | Lo dictó el cliente. Además aclaró que el formato es estable ("no se modifica mucho"). |
| 2026-11-23 | La agenda se maneja por **cupos por ventana**, no por horas. | Es lo que dicen los mensajes y es la misma lógica del problema original: cuántos caben en la mañana y cuántos en la tarde. |
| 2026-11-23 | La rama del trabajador es **sitio web + PWA**, sin app Android ni escritorio. | Decisión del usuario: no quiere instalar toolchains de Android. |
| 2026-11-23 | Almacenamiento en **IndexedDB**, no SQLite. | SQLite no corre en un navegador. IndexedDB da persistencia local, offline y cero servidor. |
| 2026-11-23 | **Multi-técnico con login simple** (nombre + PIN de 4 dígitos). | Cada técnico necesita su agenda y su horario. El PIN separa agendas, no protege datos. |
| 2026-11-23 | **IDs secuenciales en hexadecimal** (`C-0001`, `CL-0001`, `V-0001`, `M-0001`). | Legibles para buscar, dictar y conciliar sobre papel. |
| 2026-11-23 | Un mensaje pegado puede **crear, actualizar o cancelar** una cita. | Es el flujo real: reprograman y cancelan por WhatsApp todo el tiempo. El match es por teléfono y por nombre. |
| 2026-11-23 | Tema oscuro **"dim"**: gris medio, no negro. | Pedido explícito: trabajar cómodo sin cansar la vista. |
| 2026-11-23 | Código e identificadores en **inglés semántico**; texto de interfaz en español. | Convención pedida por el usuario. |
| 2026-11-23 | La base de datos **es** el libro (no hay Postgres ni Supabase). | Requisito del cliente. |
| 2026-11-23 | Nombre del proyecto y de la carpeta: `servicio-tecnico-agenda`. | Elección del usuario. |
| 2026-11-23 | Se empieza por un **cuestionario de descubrimiento** antes de construir el libro. | Evitar diseñar sobre supuestos; el audio deja reglas ambiguas. |
| 2026-11-23 | El libro debe ser **hoja nativa de Google Sheets**, no un `.xlsx` usado como base de datos. | Un `.xlsx` en Drive no se puede leer/escribir por API ni tiene validaciones vivas. Se exporta a `.xlsx` cuando haga falta. |
| 2026-11-23 | **El cliente ya tiene un formato propio.** El proyecto se adapta a su estructura; no se diseña un libro nuevo desde cero. | Es su herramienta de trabajo y su forma de entender la operación. Cambiarles el formato genera rechazo. |

## Abiertas (bloquean el diseño del libro)

| # | Decisión | Por qué importa |
|---|---|---|
| 1 | ¿Los 6–7 cupos diarios son **por local** o **totales del día** para el técnico? | Define si la pestaña `Capacidad` tiene 1 fila o 6, y si el semáforo es por local o global. |
| 2 | ¿Sábados: solo Turbaco, con regla distinta? | Cambia los días válidos por local. |
| 3 | ¿La agenda **bloquea** o solo **avisa** al pasar el cupo? | Define validación dura vs. formato condicional. |
| 4 | ¿La evidencia fotográfica es interna o se le envía al cliente? | Define si hay que guardar enlace de Drive en cada fila. |
| 5 | ¿Quiénes usan el libro y con qué correos? | Permisos de edición vs. solo lectura. |
| 6 | ¿La garantía ocupa cupo de agenda? | Afecta el conteo de capacidad. |
| 7 | ¿"Excel" significa archivo `.xlsx` o Sheet de Google? | Si insisten en `.xlsx`, hay que replantear el alcance. |
| 8 | ¿Se usa **su archivo tal cual** (convirtiéndolo a Sheet) o se construye uno nuevo **copiando su estructura**? | Define si hay riesgo de romper algo que ya usan. |
| 9 | ¿Qué columnas y hojas de su formato son **intocables** (porque las imprimen o las usan otros)? | Marca el límite de lo que se puede reordenar. |
| 10 | ¿Hay datos históricos que migrar? ¿Cuántos meses? | Define volumen y esfuerzo de migración. |

> Al responder el cuestionario (`PREGUNTAS.md`), mover las decisiones de esta tabla
> a "Cerradas" con la respuesta concreta.
