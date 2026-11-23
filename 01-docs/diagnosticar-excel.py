"""Diagnóstico de un Excel existente (no destructivo).

Lee un .xlsx/.xlsm y genera un informe en Markdown con lo que hay que saber antes
de adaptarlo: hojas, encabezados, fórmulas, celdas combinadas, validaciones,
fechas guardadas como texto, columnas vacías y riesgos.

Uso:
    python diagnosticar-excel.py "ruta\al\archivo.xlsx"
    python diagnosticar-excel.py "ruta\al\archivo.xlsx" --filas 40

Nunca modifica el archivo: se abre en modo lectura.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from datetime import date, datetime
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

BASE = Path(__file__).resolve().parent
PATRON_FECHA = re.compile(
    r"^\s*(\d{1,2})[/\-.](\d{1,2})([/\-.](\d{2,4}))?\s*$"
)
PATRON_HORA = re.compile(r"^\s*\d{1,2}:\d{2}\s*$")
PATRON_TELEFONO = re.compile(r"^[+]?[\d\s\-()]{7,}$")


def valor_corto(v, limite: int = 40) -> str:
    if v is None:
        return ""
    texto = str(v).replace("\n", " ").strip()
    return texto if len(texto) <= limite else texto[: limite - 1] + "…"


def detectar_fila_encabezado(ws, maximo: int = 10) -> int:
    """Devuelve la fila con más celdas llenas entre las primeras (suele ser el encabezado)."""
    mejor_fila, mejor_puntaje = 1, -1
    for fila in range(1, min(ws.max_row, maximo) + 1):
        puntaje = sum(
            1
            for col in range(1, min(ws.max_column, 30) + 1)
            if ws.cell(row=fila, column=col).value not in (None, "")
        )
        if puntaje > mejor_puntaje:
            mejor_fila, mejor_puntaje = fila, puntaje
    return mejor_fila


def analizar_columna(ws, col: int, filas: int, desde: int = 2) -> dict:
    fechas_texto = horas_texto = numeros = textos = vacias = 0
    ejemplos: list[str] = []
    for fila in range(desde, min(ws.max_row, desde + filas) + 1):
        v = ws.cell(row=fila, column=col).value
        if v is None or (isinstance(v, str) and not v.strip()):
            vacias += 1
            continue
        if isinstance(v, (datetime, date)):
            numeros += 0
        elif isinstance(v, str) and PATRON_FECHA.match(v):
            fechas_texto += 1
            if len(ejemplos) < 3:
                ejemplos.append(v)
        elif isinstance(v, str) and PATRON_HORA.match(v):
            horas_texto += 1
        elif isinstance(v, (int, float)):
            numeros += 1
        else:
            textos += 1
    return {
        "fechas_texto": fechas_texto,
        "horas_texto": horas_texto,
        "numeros": numeros,
        "textos": textos,
        "vacias": vacias,
        "ejemplos": ejemplos,
    }


def diagnosticar(ruta: Path, filas_muestra: int = 40) -> str:
    lineas: list[str] = []
    add = lineas.append

    add(f"# Diagnóstico de `{ruta.name}`")
    add("")
    add(f"- **Ruta:** `{ruta}`")
    add(f"- **Tamaño:** {ruta.stat().st_size / 1024:.1f} KB")
    add(f"- **Formato:** `{ruta.suffix}`")
    if ruta.suffix.lower() == ".xlsm":
        add("- ⚠️ **Tiene macros.** Convertirlo a Google Sheet pierde el código VBA.")
    add("")

    wb = load_workbook(ruta, data_only=False)
    wb_valores = load_workbook(ruta, data_only=True)

    add("## Hojas")
    add("")
    add("| # | Hoja | Estado | Filas | Columnas | Combinadas | Fórmulas | Validaciones |")
    add("|---|---|---|---|---|---|---|---|")
    for i, nombre in enumerate(wb.sheetnames, start=1):
        ws = wb[nombre]
        combinadas = len(ws.merged_cells.ranges)
        formulas = sum(
            1
            for fila in ws.iter_rows()
            for c in fila
            if isinstance(c.value, str) and c.value.startswith("=")
        )
        add(
            f"| {i} | {nombre} | {ws.sheet_state} | {ws.max_row} | {ws.max_column} | "
            f"{combinadas} | {formulas} | {len(ws.data_validations.dataValidation)} |"
        )
    add("")

    for nombre in wb.sheetnames:
        ws = wb[nombre]
        ws_val = wb_valores[nombre]

        add(f"## Hoja `{nombre}`")
        add("")
        add(f"- Rango usado: `{ws.dimensions}`")
        add(f"- Congelado en: `{ws.freeze_panes or 'no'}`")
        add(f"- Filtro automático: `{ws.auto_filter.ref or 'no'}`")
        add(f"- Protegida: `{'sí' if ws.protection.sheet else 'no'}`")
        add(f"- Cuadrícula visible: `{'sí' if ws.sheet_view.showGridLines else 'no'}`")
        add(f"- Imprimir: `{ws.page_setup.orientation or 'sin definir'}` · área `{ws.print_area or 'sin definir'}`")
        add("")

        # Encabezados
        fila_enc = detectar_fila_encabezado(ws)
        encabezados = []
        for col in range(1, min(ws.max_column, 30) + 1):
            v = ws.cell(row=fila_enc, column=col).value
            if v is not None:
                encabezados.append((get_column_letter(col), str(v).strip()))
        if encabezados:
            add(f"**Encabezados (fila {fila_enc}):**")
            add("")
            add("| Col | Encabezado |")
            add("|---|---|")
            for letra, texto in encabezados:
                add(f"| {letra} | {texto} |")
            add("")

            repetidos = [t for t, n in Counter(t for _, t in encabezados).items() if n > 1]
            if repetidos:
                add(f"- ⚠️ Encabezados repetidos: {', '.join(repetidos)}")
                add("")
        else:
            add("- ⚠️ No se detectaron encabezados en las primeras filas.")
            add("")

        # Perfil de columnas
        add("**Perfil de columnas (muestra):**")
        add("")
        add("| Col | Tipo dominante | Fechas como texto | Vacías | Ejemplos |")
        add("|---|---|---|---|---|")
        for col in range(1, min(ws.max_column, 30) + 1):
            perfil = analizar_columna(ws, col, filas_muestra, desde=fila_enc + 1)
            total = sum(perfil[k] for k in ("fechas_texto", "horas_texto", "numeros", "textos"))
            if total == 0 and perfil["vacias"] == 0:
                continue
            dominante = max(
                (("número", perfil["numeros"]), ("texto", perfil["textos"]),
                 ("fecha-texto", perfil["fechas_texto"]), ("hora-texto", perfil["horas_texto"])),
                key=lambda par: par[1],
            )[0]
            ejemplo = ", ".join(perfil["ejemplos"][:2])
            add(
                f"| {get_column_letter(col)} | {dominante} | {perfil['fechas_texto']} | "
                f"{perfil['vacias']} | {ejemplo} |"
            )
        add("")

        # Valores de encabezado con datos reales para entender el contenido
        if ws.max_row > fila_enc:
            add("**Primeras filas de datos:**")
            add("")
            add("```")
            for fila in range(fila_enc + 1, min(ws.max_row, fila_enc + 3) + 1):
                valores = [valor_corto(ws_val.cell(row=fila, column=c).value) for c in range(1, min(ws.max_column, 12) + 1)]
                if any(valores):
                    add(" | ".join(valores))
            add("```")
            add("")

        # Combinadas dentro de la zona de datos
        en_datos = [
            str(r) for r in ws.merged_cells.ranges
            if r.min_row > fila_enc and r.max_row <= max(ws.max_row, 1)
        ]
        if en_datos:
            add(f"- ⚠️ Celdas combinadas en zona de datos: {len(en_datos)} (ej. {', '.join(en_datos[:5])})")
        if ws.data_validations.dataValidation:
            dv_resumen = [
                f"{dv.type}:{dv.sqref}" for dv in ws.data_validations.dataValidation[:8]
            ]
            add(f"- Validaciones de datos: {'; '.join(dv_resumen)}")
        if len(ws.conditional_formatting):
            add(f"- Reglas de formato condicional: {len(ws.conditional_formatting)}")
        add("")

    # Riesgos globales
    add("## Riesgos detectados")
    add("")
    riesgos: list[str] = []
    for nombre in wb.sheetnames:
        ws = wb[nombre]
        fila_enc = detectar_fila_encabezado(ws)
        for col in range(1, min(ws.max_column, 30) + 1):
            perfil = analizar_columna(ws, col, filas_muestra, desde=fila_enc + 1)
            if perfil["fechas_texto"] >= 3 and perfil["fechas_texto"] > perfil["numeros"]:
                riesgos.append(
                    f"`{nombre}` columna {get_column_letter(col)}: {perfil['fechas_texto']} fechas "
                    f"guardadas como texto (ej. {perfil['ejemplos'][:2]}). Rompen cualquier conteo por día."
                )
            if perfil["horas_texto"] >= 3:
                riesgos.append(
                    f"`{nombre}` columna {get_column_letter(col)}: horas guardadas como texto."
                )
    if any(wb[n].merged_cells.ranges for n in wb.sheetnames):
        riesgos.append("Hay celdas combinadas: complican filtrar, ordenar y copiar datos.")
    if not riesgos:
        riesgos.append("Sin riesgos evidentes en la muestra revisada.")
    for r in riesgos:
        add(f"- {r}")
    add("")
    add("## Siguiente paso")
    add("")
    add("Completar `analisis-formato-existente.md` con: qué se conserva, qué se corrige")
    add("y cómo se migran los datos. Regla: cambio mínimo indispensable.")

    return "\n".join(lineas)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Diagnostica un Excel antes de adaptarlo.")
    parser.add_argument("ruta", help="Archivo .xlsx o .xlsm")
    parser.add_argument("--filas", type=int, default=40, help="Filas de muestra por columna")
    parser.add_argument("--salida", help="Carpeta de salida (por defecto 01-docs)")
    args = parser.parse_args(argv)

    ruta = Path(args.ruta).expanduser()
    if not ruta.exists():
        print(f"No existe: {ruta}")
        return 1
    if ruta.suffix.lower() not in (".xlsx", ".xlsm"):
        print("Solo .xlsx o .xlsm. Si es un Google Sheet, descargalo primero como .xlsx.")
        return 1

    informe = diagnosticar(ruta, args.filas)
    destino_dir = Path(args.salida) if args.salida else BASE
    destino_dir.mkdir(parents=True, exist_ok=True)
    destino = destino_dir / f"diagnostico-{date.today():%Y-%m-%d}-{ruta.stem}.md"
    destino.write_text(informe, encoding="utf-8")
    print(f"Informe: {destino}")
    print(f"Líneas: {len(informe.splitlines())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
