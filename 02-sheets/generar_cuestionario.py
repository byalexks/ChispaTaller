"""Genera el cuestionario de descubrimiento para el cliente.

Salida: cuestionario-cliente.xlsx (subir a Drive y abrir como hoja de Google).

Uso:
    python -m pip install openpyxl
    python generar_cuestionario.py
"""

from __future__ import annotations

import math
from pathlib import Path

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Protection, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

BASE = Path(__file__).resolve().parent
SALIDA = BASE / "cuestionario-cliente.xlsx"
VERSION = "v1 · 2026-11-23"

VERDE = "14532D"
VERDE_MEDIO = "22C55E"
VERDE_CLARO = "DCFCE7"
AMBAR = "FEF3C7"
GRIS = "F3F4F6"
GRIS_TEXTO = "6B7280"
BLANCO = "FFFFFF"

SECCIONES = [
    ("A", "Negocio y accesos"),
    ("B", "Locales y horarios"),
    ("C", "Tipos de servicio"),
    ("D", "Capacidad"),
    ("E", "Cómo llegan las citas"),
    ("F", "Evidencia, cobro y cierre"),
    ("G", "Cambios y garantías"),
    ("H", "Control y éxito"),
    ("I", "El archivo que ya usan"),
]

# (n, sección, pregunta, ayuda, tipo, opciones)
PREGUNTAS = [
    (1, "A", "¿Cuál es el nombre exacto del negocio como debe aparecer en la agenda?",
     "Ej.: Servicio Técnico Los Andes", "Texto", ""),
    (2, "A", "¿Quiénes van a usar la agenda? Nombre y cargo de cada uno.",
     "Ej.: Ana – asesora; Luis – técnico", "Texto", ""),
    (3, "A", "¿Con qué correo de Google se comparte el archivo?",
     "El correo con el que entran a Drive", "Correo", ""),
    (4, "A", "¿Prefiere llenar esto por escrito o en una llamada de 20 minutos?",
     "Si elige llamada, no hace falta llenar el resto", "Opción", "Por escrito,Llamada"),

    (5, "B", "⭐ Liste los locales: nombre, ciudad y dirección.",
     "Use la pestaña 2. Locales", "Pestaña", ""),
    (6, "B", "¿Qué días abre cada local?", "Puede variar según el local", "Opción",
     "Lunes a viernes,Lunes a sábado,Todos los días,Otro"),
    (7, "B", "⭐ ¿Cuál es el horario de atención de cada local?",
     "Ej.: 8:00 a 18:00", "Texto", ""),
    (8, "B", "Los sábados, ¿atiende en todos los locales o solo en Turbaco?",
     "", "Opción", "Todos,Solo Turbaco,Ninguno"),
    (9, "B", "¿Trabaja domingos o festivos?", "", "Opción", "No,Sí,Solo emergencias"),
    (10, "B", "¿Cuánto dura en promedio un mantenimiento y una revisión?",
     "En minutos. Ej.: 120 y 45", "Texto", ""),

    (11, "C", "⭐ ¿Qué tipos de trabajo existen hoy?",
     "Mantenimiento, revisión, garantía, repuesto, otro...", "Texto", ""),
    (12, "C", "¿Cada tipo tiene una franja fija? (mantenimiento en la mañana, revisión en la tarde)",
     "", "Opción", "Sí,No,Depende"),
    (13, "C", "¿Un mismo día puede tener mantenimientos y revisiones?", "", "Opción", "Sí,No"),
    (14, "C", "¿Hay servicios que ocupen más de un cupo? (ej. cambio de pieza largo)",
     "Cuáles y cuántos cupos", "Texto", ""),

    (15, "D", "⭐ ¿Cuántos mantenimientos máximo por día?",
     "Y ese tope: ¿por local o en total para usted?", "Texto", ""),
    (16, "D", "⭐ ¿Cuántas revisiones máximo por día?",
     "Misma aclaración: por local o en total", "Texto", ""),
    (17, "D", "¿El tope es igual todos los días o cambia según el día o el local?",
     "Si cambia, explique", "Opción", "Igual,Cambia"),
    (18, "D", "Si un día se llena, ¿la agenda debe bloquear o solo avisar en rojo?",
     "", "Opción", "Bloquear,Avisar"),
    (19, "D", "¿Cuánto tiempo necesita entre un servicio y otro por traslado?",
     "En minutos", "Texto", ""),
    (20, "D", "Si un servicio se alarga y no alcanza para los siguientes, ¿qué hace?",
     "", "Texto", ""),

    (21, "E", "¿Quién agenda hoy?", "", "Opción", "Usted,Asesoras,El cliente directo,Varios"),
    (22, "E", "⭐ ¿Todo llega por WhatsApp? ¿A un grupo o a chats individuales?",
     "", "Opción", "Grupo,Individual,Ambos"),
    (23, "E", "⭐ Pegue 3 mensajes reales tal como llegan hoy.",
     "Use la pestaña 3. Ejemplos", "Pestaña", ""),
    (24, "E", "¿Se confirma la cita con el cliente? ¿Cómo?",
     "", "Opción", "Llamada,WhatsApp,No se confirma"),
    (25, "E", "¿Con cuánta anticipación se agenda normalmente?", "En días", "Texto", ""),

    (26, "F", "¿Qué evidencia se toma hoy y dónde se guarda?", "", "Texto", ""),
    (27, "F", "¿La foto se le envía al cliente o es solo control interno?",
     "", "Opción", "Cliente,Interno,Ambos"),
    (28, "F", "¿Se registra hora de entrada y salida?", "", "Opción", "Sí,No,Solo entrada"),
    (29, "F", "¿El cobro es en el local, facturado después, o gratuito?",
     "", "Opción", "En el local,Facturado después,Gratuito,Mixto"),

    (30, "G", "Si el cliente no llega, ¿se reagenda solo o espera su instrucción?",
     "", "Opción", "Automático,Espera instrucción"),
    (31, "G", "¿Quién puede reprogramar o cancelar?", "", "Opción", "Usted,Asesoras,Ambos"),
    (32, "G", "¿Cancelar libera el cupo de inmediato?", "", "Opción", "Sí,No"),
    (33, "G", "⭐ ¿Cómo distingue una garantía de un servicio normal?",
     "Ej.: orden de servicio, etiqueta, color", "Texto", ""),
    (34, "G", "¿La garantía ocupa cupo de agenda?", "", "Opción", "Sí,No,A veces"),
    (35, "G", "¿Quién autoriza un cambio de repuesto?", "", "Texto", ""),

    (36, "H", "¿Qué necesita ver al cerrar la semana?", "", "Texto", ""),
    (37, "H", "¿Necesita consultar el historial de un cliente o vehículo?", "", "Opción", "Sí,No"),
    (38, "H", "¿Necesita exportar a Excel o imprimir la agenda del día?",
     "", "Opción", "Sí,No,Ambos"),
    (39, "H", "¿Cómo sabremos en un mes que esto funcionó?", "", "Texto", ""),

    (40, "I", "¿Quién creó el formato que usan hoy y quién lo mantiene?", "", "Texto", ""),
    (41, "I", "⭐ ¿Qué es lo que MÁS le gusta de su formato y qué no quiere que cambie?",
     "Esto se conserva sí o sí", "Texto", ""),
    (42, "I", "⭐ ¿Qué le falta o le molesta del formato actual?", "", "Texto", ""),
    (43, "I", "¿Lo llenan en computador, en celular, o lo imprimen y escriben a mano?",
     "", "Opción", "Computador,Celular,Impreso,Varios"),
    (44, "I", "¿Puede compartir el archivo tal como está hoy?",
     "Se trabaja sobre una copia; el original no se toca", "Opción",
     "Sí con datos,Sí vacío,No puede"),
]

FILA_INICIO = 6
FILA_FIN = FILA_INICIO + len(PREGUNTAS) - 1


def altura(texto: str, ancho: int, minimo: int = 18) -> float:
    """Altura aproximada de fila para que el texto envuelto se vea completo."""
    lineas = max(1, math.ceil(len(texto) / max(1, ancho * 1.05)))
    return max(minimo, 14.5 * lineas + 3)


def barra(contando: str, total: str, ancho: int = 22) -> str:
    proporcion = f"ROUND({contando}/{total}*{ancho},0)"
    return (
        f'=REPT("█",{proporcion})&REPT("░",{ancho}-{proporcion})'
    )


def hoja_cuestionario(wb: Workbook) -> None:
    ws = wb.active
    ws.title = "1. Cuestionario"
    ws.sheet_properties.tabColor = VERDE

    anchos = {"A": 5, "B": 19, "C": 62, "D": 34, "E": 11, "F": 36, "G": 30, "H": 26}
    for col, ancho in anchos.items():
        ws.column_dimensions[col].width = ancho

    rango_total = f"C{FILA_INICIO}:C{FILA_FIN}"
    rango_resp = f"G{FILA_INICIO}:G{FILA_FIN}"

    # Título
    ws.merge_cells("A1:H1")
    c = ws["A1"]
    c.value = "Cuestionario inicial — Agenda de servicio técnico"
    c.font = Font(size=18, bold=True, color=BLANCO)
    c.fill = PatternFill("solid", fgColor=VERDE)
    c.alignment = Alignment(vertical="center", horizontal="left", indent=1)
    ws.row_dimensions[1].height = 42

    ws.merge_cells("A2:H2")
    c = ws["A2"]
    c.value = f"{VERSION} · 44 preguntas · ~18 minutos · ⭐ = no pueden quedar en blanco"
    c.font = Font(size=10, color=GRIS_TEXTO, italic=True)
    c.alignment = Alignment(vertical="center", indent=1)
    ws.row_dimensions[2].height = 20

    ws.merge_cells("A3:H3")
    c = ws["A3"]
    c.value = (
        "Cómo llenarlo: solo escriba en la columna RESPUESTA (verde). Las preguntas con ⭐ "
        "son las importantes. Si algo no lo tiene claro, escriba «no sé» y lo resolvemos en "
        "una llamada. No hace falta escribir bonito: palabras sueltas sirven."
    )
    c.font = Font(size=10, color="1F2937")
    c.fill = PatternFill("solid", fgColor=VERDE_CLARO)
    c.alignment = Alignment(wrap_text=True, vertical="center", indent=1)
    ws.row_dimensions[3].height = 46

    # Avance
    ws["A4"] = "Avance"
    ws["A4"].font = Font(bold=True, size=10, color=VERDE)
    ws.merge_cells("A4:B4")
    ws["A4"].alignment = Alignment(horizontal="right", vertical="center")

    ws["C4"] = barra(f'COUNTIF({rango_resp},"<>")', f"COUNTA({rango_total})")
    ws["C4"].font = Font(name="Consolas", size=11, color=VERDE_MEDIO)
    ws["C4"].alignment = Alignment(vertical="center")

    ws["D4"] = f"=IFERROR(COUNTIF({rango_resp},\"<>\")/COUNTA({rango_total}),0)"
    ws["D4"].number_format = "0%"
    ws["D4"].font = Font(bold=True, size=11, color=VERDE)
    ws["D4"].alignment = Alignment(vertical="center", indent=1)

    ws.merge_cells("E4:H4")
    ws["E4"] = "Las que faltan se ven en ámbar."
    ws["E4"].font = Font(size=9, italic=True, color=GRIS_TEXTO)
    ws["E4"].alignment = Alignment(horizontal="right", vertical="center")
    ws.row_dimensions[4].height = 22

    # Encabezados
    encabezados = ["Nº", "Sección", "Pregunta", "Ejemplo / ayuda", "Tipo", "Opciones",
                   "RESPUESTA", "Notas"]
    borde = Border(bottom=Side(style="thin", color=VERDE_MEDIO))
    for i, texto in enumerate(encabezados, start=1):
        c = ws.cell(row=5, column=i, value=texto)
        c.font = Font(bold=True, color=BLANCO, size=10)
        c.fill = PatternFill("solid", fgColor=VERDE)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = borde
    ws.row_dimensions[5].height = 28

    # Preguntas
    idx_seccion = {clave: pos for pos, (clave, _) in enumerate(SECCIONES)}
    nombres = {clave: f"{clave}. {nombre}" for clave, nombre in SECCIONES}
    for offset, (num, seccion, pregunta, ayuda, tipo, opciones) in enumerate(PREGUNTAS):
        fila = FILA_INICIO + offset
        es_estrella = "⭐" in pregunta
        banda = PatternFill("solid", fgColor=GRIS) if idx_seccion[seccion] % 2 == 0 else None

        valores = [num, nombres[seccion], pregunta, ayuda, tipo, opciones, "", ""]
        for col, valor in enumerate(valores, start=1):
            c = ws.cell(row=fila, column=col, value=valor)
            c.font = Font(size=10, bold=(col == 3 and es_estrella))
            c.alignment = Alignment(
                vertical="top",
                horizontal="center" if col in (1, 5) else "left",
                wrap_text=col in (2, 3, 4, 6, 8),
            )
            if banda is not None and col not in (7,):
                c.fill = banda

        ws.cell(row=fila, column=2).font = Font(size=9, color=GRIS_TEXTO)
        ws.cell(row=fila, column=5).font = Font(size=9, color=GRIS_TEXTO)
        ws.cell(row=fila, column=6).font = Font(size=9, color=GRIS_TEXTO)

        # Zona de respuesta
        for col in (7, 8):
            c = ws.cell(row=fila, column=col)
            c.fill = PatternFill("solid", fgColor=VERDE_CLARO)
            c.border = Border(left=Side(style="thin", color=VERDE_MEDIO))

        ws.row_dimensions[fila].height = max(
            altura(pregunta, anchos["C"]), altura(ayuda, anchos["D"])
        )

        # Lista desplegable
        if tipo == "Opción" and opciones:
            dv = DataValidation(
                type="list",
                formula1='"' + ",".join(opciones.split(",")) + '"',
                allow_blank=True,
                showDropDown=False,
            )
            dv.error = "Elija una de las opciones de la lista."
            dv.errorTitle = "Respuesta no válida"
            ws.add_data_validation(dv)
            dv.add(ws.cell(row=fila, column=7))

    # Semáforo de respuestas
    ws.conditional_formatting.add(
        rango_resp,
        FormulaRule(formula=[f'LEN($G{FILA_INICIO})=0'],
                    fill=PatternFill("solid", start_color=AMBAR, end_color=AMBAR)),
    )
    ws.conditional_formatting.add(
        rango_resp,
        FormulaRule(formula=[f'LEN($G{FILA_INICIO})>0'],
                    fill=PatternFill("solid", start_color=VERDE_CLARO, end_color=VERDE_CLARO)),
    )

    # Protección: solo se pueden editar RESPUESTA y Notas
    for fila in range(FILA_INICIO, FILA_FIN + 1):
        for col in (7, 8):
            ws.cell(row=fila, column=col).protection = Protection(locked=False)

    ws.protection.sheet = True
    ws.protection.insertRows = True
    ws.protection.autoFilter = True
    ws.protection.sort = True
    ws.protection.formatCells = False

    ws.freeze_panes = "A6"
    ws.auto_filter.ref = f"A5:H{FILA_FIN}"
    ws.sheet_view.showGridLines = False
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True


def hoja_locales(wb: Workbook) -> None:
    ws = wb.create_sheet("2. Locales")
    ws.sheet_properties.tabColor = VERDE_MEDIO
    ws.sheet_view.showGridLines = False

    anchos = {"A": 16, "B": 16, "C": 34, "D": 18, "E": 18, "F": 20, "G": 18, "H": 28}
    for col, ancho in anchos.items():
        ws.column_dimensions[col].width = ancho

    ws.merge_cells("A1:H1")
    ws["A1"] = "Locales"
    ws["A1"].font = Font(size=16, bold=True, color=BLANCO)
    ws["A1"].fill = PatternFill("solid", fgColor=VERDE)
    ws["A1"].alignment = Alignment(vertical="center", indent=1)
    ws.row_dimensions[1].height = 36

    ws.merge_cells("A2:H2")
    ws["A2"] = ("Complete una fila por local. Si no sabe el tope todavía, déjelo vacío; "
                "es la pregunta 15 y 16 del cuestionario.")
    ws["A2"].font = Font(size=10, italic=True, color=GRIS_TEXTO)
    ws["A2"].alignment = Alignment(vertical="center", indent=1)

    encabezados = ["Local", "Ciudad", "Dirección", "Días que abre", "Horario",
                   "Máx. mantenimientos", "Máx. revisiones", "Notas"]
    for i, texto in enumerate(encabezados, start=1):
        c = ws.cell(row=4, column=i, value=texto)
        c.font = Font(bold=True, color=BLANCO, size=10)
        c.fill = PatternFill("solid", fgColor=VERDE)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[4].height = 30

    locales = [("Local 1", "Cartagena"), ("Local 2", "Cartagena"), ("Local 3", "Cartagena"),
               ("Local 4", "Cartagena"), ("Local 5", "Cartagena"), ("Turbaco", "Turbaco")]
    for offset, (nombre, ciudad) in enumerate(locales):
        fila = 5 + offset
        ws.cell(row=fila, column=1, value=nombre).font = Font(bold=True, size=10)
        ws.cell(row=fila, column=2, value=ciudad).font = Font(size=10)
        for col in range(1, 9):
            ws.cell(row=fila, column=col).alignment = Alignment(
                vertical="center", horizontal="left" if col <= 2 else "center"
            )
            ws.cell(row=fila, column=col).border = Border(
                bottom=Side(style="thin", color="E5E7EB")
            )
        for col in range(1, 9):
            ws.cell(row=fila, column=col).protection = Protection(locked=False)

    dv_dias = DataValidation(
        type="list",
        formula1='"Lunes a viernes,Lunes a sábado,Todos los días,Otro"',
        allow_blank=True,
    )
    ws.add_data_validation(dv_dias)
    dv_dias.add("D5:D20")

    ws.protection.sheet = True
    ws.protection.insertRows = True
    ws.freeze_panes = "A5"


def hoja_ejemplos(wb: Workbook) -> None:
    ws = wb.create_sheet("3. Ejemplos")
    ws.sheet_properties.tabColor = "F59E0B"
    ws.sheet_view.showGridLines = False

    anchos = {"A": 5, "B": 16, "C": 20, "D": 90, "E": 30}
    for col, ancho in anchos.items():
        ws.column_dimensions[col].width = ancho

    ws.merge_cells("A1:E1")
    ws["A1"] = "Mensajes reales de WhatsApp"
    ws["A1"].font = Font(size=16, bold=True, color=BLANCO)
    ws["A1"].fill = PatternFill("solid", fgColor="B45309")
    ws["A1"].alignment = Alignment(vertical="center", indent=1)
    ws.row_dimensions[1].height = 36

    ws.merge_cells("A2:E2")
    ws["A2"] = ("Pegue los mensajes tal cual llegan, sin corregir. Son la base para diseñar "
                "el libro: no invente ejemplos, use los reales.")
    ws["A2"].font = Font(size=10, italic=True, color=GRIS_TEXTO)
    ws["A2"].alignment = Alignment(vertical="center", indent=1)

    encabezados = ["#", "Fecha del mensaje", "¿Quién lo envía?", "Mensaje tal como llega", "Notas"]
    for i, texto in enumerate(encabezados, start=1):
        c = ws.cell(row=4, column=i, value=texto)
        c.font = Font(bold=True, color=BLANCO, size=10)
        c.fill = PatternFill("solid", fgColor="B45309")
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[4].height = 28

    for offset in range(1, 11):
        fila = 4 + offset
        ws.cell(row=fila, column=1, value=offset).alignment = Alignment(horizontal="center")
        for col in (4, 5):
            ws.cell(row=fila, column=col).alignment = Alignment(wrap_text=True, vertical="top")
            ws.cell(row=fila, column=col).fill = PatternFill("solid", fgColor="FFFBEB")
        for col in range(1, 6):
            ws.cell(row=fila, column=col).border = Border(
                bottom=Side(style="thin", color="FDE68A")
            )
        ws.row_dimensions[fila].height = 60

    ws.freeze_panes = "A5"


def hoja_resumen(wb: Workbook) -> None:
    ws = wb.create_sheet("4. Resumen")
    ws.sheet_properties.tabColor = "1F2937"
    ws.sheet_view.showGridLines = False

    anchos = {"A": 34, "B": 18, "C": 18, "D": 30}
    for col, ancho in anchos.items():
        ws.column_dimensions[col].width = ancho

    ws.merge_cells("A1:D1")
    ws["A1"] = "Resumen"
    ws["A1"].font = Font(size=16, bold=True, color=BLANCO)
    ws["A1"].fill = PatternFill("solid", fgColor="1F2937")
    ws["A1"].alignment = Alignment(vertical="center", indent=1)
    ws.row_dimensions[1].height = 36

    ws["A3"] = "Avance total"
    ws["A3"].font = Font(bold=True, size=11)
    ws["B3"] = '=IFERROR(COUNTIF(\'1. Cuestionario\'!G6:G49,"<>")/COUNTA(\'1. Cuestionario\'!C6:C49),0)'
    ws["B3"].number_format = "0%"
    ws["B3"].font = Font(bold=True, size=12, color=VERDE)
    ws["C3"] = ('=REPT("█",ROUND(B3*20,0))&REPT("░",20-ROUND(B3*20,0))')
    ws["C3"].font = Font(name="Consolas", size=11, color=VERDE_MEDIO)
    ws["D3"] = "Respondidas / 44"
    ws["D3"].font = Font(size=9, italic=True, color=GRIS_TEXTO)

    ws["A5"] = "Por sección"
    ws["A5"].font = Font(bold=True, size=11, color=VERDE)
    encabezados = ["Sección", "Respondidas", "Total", ""]
    for i, texto in enumerate(encabezados, start=1):
        c = ws.cell(row=6, column=i, value=texto)
        c.font = Font(bold=True, color=BLANCO, size=10)
        c.fill = PatternFill("solid", fgColor=VERDE)
        c.alignment = Alignment(horizontal="center" if i > 1 else "left", vertical="center")

    for offset, (clave, nombre) in enumerate(SECCIONES):
        fila = 7 + offset
        ws.cell(row=fila, column=1, value=f"{clave}. {nombre}").font = Font(size=10)
        ws.cell(row=fila, column=2,
                value=(f"=COUNTIFS('1. Cuestionario'!$B$6:$B$49,$A{fila},"
                       f"'1. Cuestionario'!$G$6:$G$49,\"<>\")"))
        ws.cell(row=fila, column=3,
                value=f"=COUNTIF('1. Cuestionario'!$B$6:$B$49,$A{fila})")
        for col in (2, 3):
            ws.cell(row=fila, column=col).alignment = Alignment(horizontal="center")
            ws.cell(row=fila, column=col).font = Font(size=10)

    fila_nota = 7 + len(SECCIONES) + 1
    ws.merge_cells(f"A{fila_nota}:D{fila_nota}")
    c = ws.cell(row=fila_nota, column=1)
    c.value = ("Las preguntas sin responder aparecen en ámbar en la pestaña 1. "
               "Las que tienen ⭐ no se pueden saltar.")
    c.font = Font(size=10, italic=True, color=GRIS_TEXTO)
    c.alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[fila_nota].height = 34

    fila_alerta = fila_nota + 2
    ws.merge_cells(f"A{fila_alerta}:D{fila_alerta}")
    c = ws.cell(row=fila_alerta, column=1)
    c.value = ("Si el negocio ya tiene un formato en Excel, ese archivo es el insumo "
               "principal: el proyecto se adapta a él, no lo reemplaza.")
    c.font = Font(size=10, bold=True, color="92400E")
    c.fill = PatternFill("solid", fgColor=AMBAR)
    c.alignment = Alignment(wrap_text=True, vertical="center", indent=1)
    ws.row_dimensions[fila_alerta].height = 40

    ws.protection.sheet = True


def main() -> None:
    wb = Workbook()
    hoja_cuestionario(wb)
    hoja_locales(wb)
    hoja_ejemplos(wb)
    hoja_resumen(wb)

    wb.properties.title = "Cuestionario inicial — Agenda de servicio técnico"
    wb.properties.subject = "Descubrimiento de requerimientos"
    wb.properties.creator = "servicio-tecnico-agenda"
    wb.calculation.fullCalcOnLoad = True

    wb.save(SALIDA)
    print(f"Generado: {SALIDA}")
    print(f"Preguntas: {len(PREGUNTAS)}")


if __name__ == "__main__":
    main()
