# servicio-tecnico-agenda

Agenda de visitas técnicas (mantenimiento, revisión, garantía, repuesto) para un
negocio con 6 locales: 5 en Cartagena y 1 en Turbaco.

> **Foco actual:** solo el producto del técnico (**Chispa Taller**, PWA). La rama
> Excel / Google Sheets está **parqueada** y no se toca hasta que se pida.

Dos productos, uno construido y otro parqueado:

- **Producto B — técnico (Chispa Taller, en construcción):** sitio web instalable como
  PWA. El técnico pega el mensaje de WhatsApp, la app lo interpreta y arma su día.
- **Producto A — negocio (hoja de Google, parqueado):** el libro completo para el
  negocio. Espera el archivo real del cliente. Ver `00-plan/RAMAS.md`.

## Estado

- [x] Transcripción del audio de requerimientos
- [x] Plantillas reales de WhatsApp como corpus de prueba
- [x] Parser determinista (sin IA) — 10/10 pruebas
- [x] Login simple por técnico (nombre + PIN)
- [x] Hoy, Bandeja, Semana, Clientes, pegar, revisión, cierre de visita, horario
- [x] Administración de técnicos con datos de prueba y doble confirmación
- [x] Respaldo: exportar e importar (incluye fotos)
- [x] Modo oscuro "dim" (gris, no negro)
- [ ] Sincronización entre dispositivos (hoy es local: IndexedDB)
- [ ] Rama Excel

## Estructura

```
00-plan/
  PLAN.md            Plan del proyecto
  RAMAS.md           Las dos ramas y sus reglas
  PREGUNTAS.md       Cuestionario de descubrimiento (44 preguntas)
  DECISIONES.md      Registro de decisiones
01-docs/
  transcripcion-*.md/.txt            Audios transcritos
  parser-plantillas.md               Diseño del parser
  modelo-datos.md                    Entidades y cálculo de huecos
  analisis-formato-existente.md      Checklist para la rama Excel
02-sheets/           Rama Excel (cuestionario y esquema)
03-pruebas/
  plantillas-reales.md               Mensajes reales, verbatim
05-app/              Rama trabajador (sitio web + PWA)
```

## Cómo correr la app

```powershell
cd C:\pro\servicio-tecnico-agenda\05-app
npm install
npm run dev        # http://localhost:5173
npm test           # parser, 10 pruebas
npm run test:e2e   # 24 pasos con Playwright
npm run build      # dist/ listo para publicar
```

## En internet

Sitio publicado con GitHub Pages:

```
https://byalexks.github.io/ChispaTaller/
```

Cada push a `main` reconstruye y publica (`.github/workflows/deploy.yml`).
La app es una PWA: se puede instalar desde el navegador del celular.

> El origen `https://byalexks.github.io` debe estar autorizado en el Client ID de
> Google para que funcione el calendario.

Técnicos de prueba: `Técnico 1`, `Técnico 2`, `Técnico 3` · PIN `1234`.

Los datos viven en IndexedDB del navegador. Borrar datos del sitio = perder todo:
el respaldo (exportar) todavía no está implementado.

## Reglas del producto

- Sin IA: el parser lee etiquetas y valida.
- La **sede** es un atributo de cada cita: sale del mensaje o se elige a mano. No
  depende del horario.
- Cupos **generales del técnico** por ventana: mañana (8:00-12:00) y tarde
  (13:00-18:00). No se separan por sede.
- Un mensaje puede **crear, actualizar o cancelar** una cita.
- IDs secuenciales legibles en hexadecimal: `C-0001`, `CL-0001`.
