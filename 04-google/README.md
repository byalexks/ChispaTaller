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
próxima subida la deja lista otra vez. `VERSION` ahora es **5**.

## Google Calendar (sin OAuth)

El calendario usa el **mismo Apps Script**, no OAuth. El script crea, actualiza y
borra los eventos en el **calendario principal de la cuenta dueña del script**
(la misma del Sheet). Por eso ya no hace falta verificar `github.io` ni agregar
orígenes en Google Cloud.

- No funciona en el calendario personal de cada técnico: todos los eventos caen
  en el calendario del administrador. Es el precio de no tener OAuth.
- La primera vez, Apps Script pide autorización para **Calendar**. Aceptala.
- En la app: **Mi perfil → Google Calendar → Sincronizar ahora**. También se
  sincroniza solo al guardar o cambiar una cita.

El script no crea eventos duplicados: guarda el `eventId` de Google en cada cita.
Si un evento se borra a mano en Google, la próxima sincronización lo vuelve a
crear.

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
