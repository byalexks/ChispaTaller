# Cierre diario a Google (híbrido)

La app trabaja local en el teléfono. Al cerrar el día sube las citas a una
**hoja de Google** mediante un **Apps Script**. Sin servidor y sin costo.

## Camino corto

1. Abrí <https://sheets.new> y nombrala *Chispa Taller — Cierre*.
2. **Extensiones → Apps Script**.
3. Borrá todo y pegá `cierre.gs` tal como está (ya trae el token de la app).
4. **Implementar → Nueva implementación → Aplicación web**
   - *Ejecutar como*: **Yo**
   - *Acceso*: **Cualquier usuario**
5. Copiá la URL que termina en `/exec`.
6. En la app: **Mi perfil → Cierre automático** → pegá la URL → **Guardar** →
   **Subir ahora**. El token se llena solo con el valor por defecto.

> El token es la misma clave que está en `05-app/src/remote.ts`. Como la app se
> publica en GitHub Pages, esa clave es visible en el código: sirve para que
> cualquier equipo quede configurado solo, no como secreto fuerte. Si algún día
> la cambiás, cambiala en el script y en `remote.ts`, y publicá una **versión
> nueva** del script y un deploy nuevo de la app.

## Si cambiás el script

Siempre: **Implementar → Administrar implementaciones → lápiz → Nueva versión →
Implementar**. Sin eso, la web app sigue corriendo el código viejo (es la causa
más común de “Token inválido” o de que no aparezca la hoja).

## Cabeceras de la hoja

La **fila 1** siempre es la cabecera (`ID`, `Fecha`, `Hora`…). El script la revisa
en cada subida:

- Si borraste todo para hacer pruebas, la vuelve a escribir.
- Si hay datos viejos sin cabecera, **inserta una fila arriba** y no borra nada.
- Si la cabecera estaba a medias o en otra fila, la corrige en la fila 1.
- La fila 1 queda en negrita y congelada.

No hace falta limpiar la hoja de una forma especial: podés borrar las filas y la
próxima subida la deja lista otra vez. `VERSION` ahora es **4**.

## Google Calendar por técnico (OAuth)

Cada técnico conecta **su propia cuenta de Google** y los eventos se crean en
**su calendario principal**. La app usa Google Identity Services y el permiso
`calendar.events`; no hay backend.

### Configurar Google Cloud (una vez)

1. En <https://console.cloud.google.com> elegí el proyecto del Client ID.
2. **APIs y servicios → Pantalla de consentimiento de OAuth**:
   - Tipo de usuario: **Externo**.
   - Estado de publicación: **Prueba** (Testing).
   - En **Usuarios de prueba**, agregá el Gmail de **cada técnico**.
   - En **Permisos**, agregá `.../auth/calendar.events`.
3. **Credenciales → tu OAuth Client ID (Aplicación web) → Orígenes de JavaScript autorizados**:
   - `https://byalexks.github.io`
   - `http://localhost:5173` (para pruebas en el PC)
   - Sin barra al final.
4. **No pongas `github.io` en “Dominios autorizados”**: es un dominio compartido y
   Google no lo puede verificar como tuyo. Ese campo se puede dejar vacío.

### Conectar en cada teléfono

1. Entrá a la app con el técnico.
2. **Mi perfil → Google Calendar**.
3. Tocá **Conectar con mi cuenta de Google** y elegí la cuenta de ese técnico.
4. Si aparece “Google no verificó esta app”:
   - **Configuración avanzada → Ir a Chispa Taller (no seguro) → Permitir**.
5. Aceptá el permiso de Calendar.

Después, **Sincronizar ahora** crea los eventos de la semana visible en el
calendario de ese técnico. También se sincroniza al guardar o cambiar una cita.

> Si Google muestra **“Acceso bloqueado”**, casi siempre es porque la cuenta no
> está en **Usuarios de prueba** o la app quedó en estado **Publicado** sin
> verificar. Volvé a **Prueba** y agregá la cuenta. Un dominio propio elimina el
> aviso, pero hay que comprarlo y verificarlo.

## Configuración compartida (técnicos, PINs y PIN admin)

Si querés que los PINs sean **iguales en todos los teléfonos**, la app los guarda
en el script, **cifrados**, y los baja al abrir.

- El script almacena `configCipher` en *Propiedades del script*: AES-GCM con llave
  derivada del **TOKEN**. Sin token no se puede leer.
- El admin cambia un técnico o un PIN → se publica solo.
- Cada equipo baja la config al abrir. Sin internet, usa la última copia local.

**Requisito:** el `TOKEN` del script **no puede estar vacío** para esta función.

1. Poné una clave larga en `const TOKEN = "..."`.
2. **Nueva versión** de la implementación.
3. En cada equipo: **Mi perfil → Cierre automático** → URL `/exec` + token →
   **Guardar**.
4. Listo: los PINs y la pista quedan compartidos.

## Pista del PIN (opcional)

Cada técnico puede tener una **pista** (ej. “año del carro”) que se muestra en el
login con “Ver pista”. Se configura en Mi perfil (el propio técnico) o en
Administración → Editar técnico. El admin también tiene la suya.

## Probar que quedó bien

Abrí la URL `/exec` en el navegador: debe devolver

```json
{ "ok": true, "mensaje": "Chispa Taller listo" }
```

Para saber si el token coincide, agregá `?token=TU_TOKEN`:

```
https://script.google.com/macros/s/.../exec?token=chispa-taller-2026-9f3k2m8x
```

- `"tokenOk": true` → el script publicado tiene ese token; si la app falla, el
  token del formulario está mal escrito.
- `"tokenOk": false` → el script publicado tiene **otro** token (casi siempre
  porque no creaste una **versión nueva** después de editarlo).
- `"tokenOk": null` → no pasaste `?token=`.
