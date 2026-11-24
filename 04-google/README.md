# Cierre diario a Google (híbrido)

La app trabaja local en el teléfono. Al cerrar el día sube las citas a una
**hoja de Google** mediante un **Apps Script**. Sin servidor y sin costo.

## Camino corto (sin token)

1. Abrí <https://sheets.new> y nombrala *Chispa Taller — Cierre*.
2. **Extensiones → Apps Script**.
3. Borrá todo y pegá `cierre.gs` tal como está (el `TOKEN` viene vacío).
4. **Implementar → Nueva implementación → Aplicación web**
   - *Ejecutar como*: **Yo**
   - *Acceso*: **Cualquier usuario**
5. Copiá la URL que termina en `/exec`.
6. En la app: **Mi perfil → Cierre automático** → pegá la URL → **Guardar** →
   **Subir ahora**. El campo Token puede quedar vacío.

> Con `TOKEN` vacío no se valida clave: quien tenga la URL puede escribir en la
> hoja. Sirve para probar. Cuando funcione, poné una clave en el script, creá una
> **versión nueva** y pegala en la app.

## Si cambiás el script

Siempre: **Implementar → Administrar implementaciones → lápiz → Nueva versión →
Implementar**. Sin eso, la web app sigue corriendo el código viejo (es la causa
más común de “Token inválido” o de que no aparezca la hoja).

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
