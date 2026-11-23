# Plantillas reales de WhatsApp (corpus de prueba)

Mensajes tal como llegan, sin corregir. **No editar**: son el fixture del parser.
Se ignora el encabezado de reenvío y la hora de WhatsApp.

---

## T1 — Mantenimiento (con repuesto)

```
PROGRAMACION POR  MANTENIMIENTO DEL VEHICULO ELÉCTRICO Y INSTALACIÓN DE REPUESTOS

TOTAL A PAGAR: $240.000

Nombre y Apellidos:
Engerling Marrugo arroyo 
Vehículo: galaxy 3 
Día y Hora: viernes   20 - NOVIEMBRE -2026 8:00am
Dirección: 
Barrio Villa Estrella Tv. 54 Cra. 89 - 91 (Diagonal a la entrada de Ciudad Jardín)
 Teléfono: 3012277629.

RECOMENDACIONES:
Ser puntual el día y a la hora programada, ya que se reciben los vehículos eléctricos de 8:00 hasta 9:00 am  dejar el vehículo y la entrega es después del medio día por orden de llegada.
Llevar:
•Manual de usuario
•Tarjeta de propiedad.
•Vehículo Eléctrico debe estar limpio.
```

## T2 — Revisión

```
REVISION VIERNES 20 DE NOVIEMBRE A LAS 2PM

Nombre : Karol Giraldo 
Modelo: stareer 3 
Problema: la clienta dejo descargada el vehículo por una semana y no ah querido cargar más.
```

## T3 — Garantía / instalación de repuesto

```
INSTALACIÓN DE REPUESTO POR GARANTÍA


Nombre: rosaida Hernández 
Modelo: Ledo 3
Repuesto: flasher 
Local : Ofero centro
Fecha y hora:  viernes 20/11/26 a las 2 pm
```

## T4 — Mantenimiento (caso con día inconsistente)

```
*PROGRAMACION DE MANTENIMIENTO 

*Nombre y Apellidos:*
HILDA DE AVILA
*Vehículo:* galaxy 3 
*Día y Hora:* miércoles  20- NOVIEMBRE -2026 8:00AM A 9PM
*Dirección:* 
Barrio Villa Estrella Tv. 54 Cra. 89 - 91 (Diagonal a la entrada de Ciudad Jardín)
 *Teléfono:* 3006532525.

*RECOMENDACIONES:*
Ser puntual el día y a la hora programada, 
*Llevar:*
*•Manual de usuario*
*•Tarjeta de propiedad.*
*•Vehículo Eléctrico debe estar limpio.*
```

---

## Lo que debe salir de cada uno

### T1
| Campo | Valor | Nota |
|---|---|---|
| tipo | Mantenimiento | + instalación de repuesto |
| nombre | Engerling Marrugo Arroyo | venía en minúscula |
| modelo | galaxy 3 | |
| fecha | 2026-11-20 | viernes ✓ coincide |
| hora | 8:00 | recepción 8–9 |
| teléfono | 3012277629 | |
| dirección | Barrio Villa Estrella Tv. 54 Cra. 89-91 | |
| valor | 240000 | `$240.000` |
| local | — | **no viene** |
| serial / placa | — | **no vienen** |

### T2
| Campo | Valor | Nota |
|---|---|---|
| tipo | Revisión | |
| nombre | Karol Giraldo | |
| modelo | stareer 3 | |
| fecha | 2026-11-20 | **está en el título**, no en un campo |
| hora | 14:00 | |
| problema | "la clienta dejó descargada…" | texto libre, con errores |
| teléfono | — | **no viene** |
| local | — | **no viene** |

### T3
| Campo | Valor | Nota |
|---|---|---|
| tipo | Garantía / repuesto | |
| nombre | Rosaida Hernández | |
| modelo | Ledo 3 | |
| repuesto | flasher | |
| local | Ofero centro | **único mensaje que trae local** |
| fecha | 2026-11-20 | formato `dd/mm/aa` |
| hora | 14:00 | |
| teléfono | — | **no viene** |

### T4
| Campo | Valor | Nota |
|---|---|---|
| tipo | Mantenimiento | |
| nombre | HILDA DE AVILA | |
| fecha | 2026-11-20 | ⚠️ dice **miércoles**, pero el 20/11/2026 es **viernes** |
| hora | 8:00 | dice `8:00AM A 9PM` (13 horas) |
| teléfono | 3006532525 | |

---

## Hallazgos que obligan a cambiar el diseño

1. **No hay un formato, hay cuatro.** Mismo negocio, misma persona enviando, cuatro
   estructuras distintas.
2. **La fecha puede venir en el título** (T2) o en un campo (T1, T3, T4).
3. **Cuatro formatos de fecha**: `20 - NOVIEMBRE -2026`, `20 DE NOVIEMBRE`,
   `20/11/26`, `20- NOVIEMBRE -2026`. Dos con año, dos sin.
4. **Los nombres de campo cambian**: `Vehículo` / `Modelo`; `Nombre y Apellidos` /
   `Nombre`; `Día y Hora` / `Fecha y hora`.
5. **Solo T3 trae local.** T1, T2 y T4 no dicen dónde se atiende.
6. **Solo T1 y T4 traen teléfono.** T2 y T3 no: el dedupe no puede depender del
   teléfono.
7. **T2 y T3 no traen precio.** T1 sí, con formato `$240.000`.
8. **Los mantenimientos no son citas por hora.** T1 lo dice literal: se reciben de
   8:00 a 9:00 y la entrega es en la tarde **por orden de llegada**.
9. **El año no es confiable.** T4 dice "miércoles 20 de noviembre de 2026" y ese día
   fue miércoles en **2024**. Es una plantilla reciclada.
10. **Los modelos vienen escritos distinto**: `galaxy 3`, `stareer 3`, `Ledo 3`.
    Hace falta el catálogo real antes de normalizarlos.

## Regla que sale de todo esto

El **día de la semana es el checksum**: si el texto dice "viernes" y la fecha
calculada cae viernes, se confía. Si no coincide, se marca para revisión. Es la
forma más barata de detectar plantillas recicladas sin IA.
