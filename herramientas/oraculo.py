"""Genera los archivos dorados: ejecuta la implementación Python de referencia
sobre el corpus y vuelca lo que devuelve.

Es una herramienta de desarrollo de ESTE repositorio, no del otro. Vive aquí a
propósito: el repositorio de referencia quedó congelado —se consulta, no se
modifica— y ampliar el corpus al portar cada módulo no puede exigir un commit
allá.

    Referencia (solo lectura): github.com/haroldstyven/Formateador

Ese repositorio conserva una copia de este script, de cuando el oráculo todavía
vivía ahí. La copia canónica es esta.

La suite no ejecuta nada de esto: compara contra los JSON ya versionados. Este
script solo se corre al ampliar el corpus.

Uso:

    python herramientas/oraculo.py --modulo valores --generar-corpus
    python herramientas/oraculo.py --modulo valores > herramientas/salida-python-valores.json

Espera el repositorio de referencia en `../Formateador-Banner`; para otra ruta,
la variable de entorno FORMATEADOR_REFERENCIA.

CUANDO LAS DOS IMPLEMENTACIONES DIFIERAN. La referencia está congelada, así que
ya no se le puede aplicar una corrección. La regla pasa a ser:

  1. Decidir cuál tiene razón. El oráculo es la referencia, no la autoridad.
  2. Si tiene razón el port, se regenera el dorado y **el commit explica por
     qué el valor nuevo es el correcto**. Un dorado que cambia sin esa
     explicación es un test desactivado en silencio.
  3. Si tiene razón la referencia, se corrige el port.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from decimal import Decimal
from pathlib import Path

AQUI = Path(__file__).resolve().parent


def _localizar_referencia() -> Path:
    raiz = Path(
        os.environ.get("FORMATEADOR_REFERENCIA")
        or AQUI.parent.parent / "Formateador-Banner"
    ).resolve()
    if not (raiz / "formateador" / "redondeo.py").exists():
        raise SystemExit(
            f"No encuentro la implementación de referencia en {raiz}.\n"
            "Clona github.com/haroldstyven/Formateador junto a este repositorio, "
            "o indica la ruta con --referencia / FORMATEADOR_REFERENCIA."
        )
    return raiz


# Se resuelve al importar, porque los `from formateador...` de abajo dependen
# de ella. Por eso la ruta se configura por entorno y no por argumento.
RAIZ = _localizar_referencia()
sys.path.insert(0, str(RAIZ))

from formateador.redondeo import ValorNoDecimal, formatear  # noqa: E402
from formateador.valores import ConfigValores, interpretar  # noqa: E402
from formateador.mapeo import (  # noqa: E402
    CatalogoAlias,
    mapear,
    puntaje_encabezado,
)
from formateador.lectura import Tabla  # noqa: E402
from formateador.flujo import Analisis, FilaAnalizada  # noqa: E402
from formateador.plantilla import (  # noqa: E402
    EsquemaBanner,
    FilaPlantilla,
    Plantilla,
    cruzar,
)

CORPUS = AQUI / "corpus.json"


def generar_corpus() -> list[dict[str, object]]:
    """Construye el corpus compartido. Se ejecuta una vez y se versiona."""
    casos: list[dict[str, object]] = []

    # Los 50 valores de frontera, como texto y como número.
    for i in range(501):
        texto = f"{Decimal(i) / 100:.2f}"
        if texto.endswith("5"):
            casos.append({"tipo": "texto", "valor": texto})
            casos.append({"tipo": "numero", "valor": float(texto)})

    # Toda la escala ya formateada: verifica la propiedad no-op.
    for i in range(51):
        casos.append({"tipo": "texto", "valor": f"{Decimal(i) / 10:.1f}"})

    # Salidas típicas de una fórmula de promedio ponderado.
    for texto in [
        "4.283333333333333",
        "3.9666666666666668",
        "2.9499999999999997",
        "2.9500000000000002",
        "0.049999999999999996",
        "4.9500000000000002",
        "3.0000000000000004",
    ]:
        casos.append({"tipo": "texto", "valor": texto})
        casos.append({"tipo": "numero", "valor": float(texto)})

    # Enteros y formas alternativas del mismo número.
    for texto in ["0", "3", "5", "3.", ".5", "+4.5", "4.50", "4.5000", " 4.5 ", "4.5e0", "45e-1"]:
        casos.append({"tipo": "texto", "valor": texto})

    # Basura que tiene que ser rechazada igual en las dos implementaciones.
    for texto in ["", "  ", "NP", "4,5", "nan", "inf", "-inf", "1_0", "0x1f", "ver acta", "N/A", "--", "3.0.0"]:
        casos.append({"tipo": "texto", "valor": texto})

    # Fuera de rango: se redondea igual, el rango lo valida otra capa.
    for texto in ["-0.05", "-1.5", "5.05", "9.95"]:
        casos.append({"tipo": "texto", "valor": texto})

    # Cero negativo: Excel lo produce solo y `en_rango` lo acepta, asi que sin
    # normalizar llega hasta `Final Grade`. Lo encontro la prueba diferencial.
    for texto in ["-0.0", "-0", "-0.00", "-0.04", "-0.1"]:
        casos.append({"tipo": "texto", "valor": texto})
    casos.append({"tipo": "numero", "valor": -0.0})

    return casos


def evaluar(casos: list[dict[str, object]]) -> list[dict[str, object]]:
    resultados: list[dict[str, object]] = []
    for caso in casos:
        try:
            resultados.append({"salida": formatear(caso["valor"]), "error": None})
        except ValorNoDecimal:
            resultados.append({"salida": None, "error": "ValorNoDecimal"})
    return resultados


# --------------------------------------------------------------------------
# Módulo `valores`: interpretación de una celda.
#
# Aquí no se compara la prosa de `detalle`, y es deliberado. La representación
# de un Decimal difiere entre Python y decimal.js en los bordes —Decimal("0.0")
# imprime "0.0", decimal.js imprime "0"— y esas cadenas van dentro del mensaje.
# Perseguir igualdad byte a byte en el texto obligaría a deformar una de las
# dos implementaciones para que se parezca a la otra.
#
# Lo que sí se compara es todo lo que decide algo: el estado, el valor emitido,
# el token, y las tres banderas que gobiernan si el archivo se puede generar y
# si la nota entra al diff. El principio §4.4 ya dice que la prosa nunca es la
# fuente de verdad; esto es consistente con eso.
# --------------------------------------------------------------------------

CORPUS_VALORES = AQUI / "corpus-valores.json"

# La config se lee de ESTE repositorio, no del de referencia: es la misma que
# carga `tests/oraculo.test.ts`, y si fueran dos archivos distintos el dorado
# podría producirse con una política y compararse contra otra.
CONFIG_REPO = AQUI.parent / "config" / "valores_no_numericos.json"


def _configs() -> dict[str, ConfigValores]:
    """Las configuraciones con nombre que el corpus puede referenciar."""
    return {
        "vacia": ConfigValores(),
        "repo": ConfigValores.desde_json(CONFIG_REPO),
        "np_reemplazo": ConfigValores.desde_dict(
            {"tokens": {"np": {"accion": "reemplazar", "valor": "0.0"}}}
        ),
        "np_dejar_vacio": ConfigValores.desde_dict(
            {"tokens": {"np": {"accion": "dejar_vacio"}}}
        ),
        "np_descartar": ConfigValores.desde_dict(
            {"tokens": {"np": {"accion": "descartar_fila"}}}
        ),
    }


def generar_corpus_valores() -> list[dict[str, object]]:
    casos: list[dict[str, object]] = []

    def añadir(valor, config="vacia", tipo="texto", formula=False):
        casos.append(
            {"config": config, "tipo": tipo, "valor": valor, "formula": formula}
        )

    # Vacías y fórmulas sin calcular: los dos casos que no se pueden colapsar.
    for v in [None, "", "   ", "\t", "\n  \t"]:
        añadir(v)
    añadir(None, formula=True)
    añadir("4.5", formula=True)

    # Numéricas: la escala completa, la frontera y las salidas de fórmula.
    for i in range(51):
        añadir(f"{Decimal(i) / 10:.1f}")
    for i in range(501):
        texto = f"{Decimal(i) / 100:.2f}"
        if texto.endswith("5"):
            añadir(texto)
            añadir(float(texto), tipo="numero")
    for texto in ["4.283333333333333", "3.9666666666666668", "2.9499999999999997"]:
        añadir(texto)
        añadir(float(texto), tipo="numero")

    # Coma decimal, ambigüedades y formas raras de escribir un número.
    for texto in ["4,5", "4,25", "0,05", "2,95", "1,234.5", "1.234,5", "4,5,6", "4,", ",5"]:
        añadir(texto)
    for texto in ["4.50", "3.", ".5", "+4.5", " 4.5 ", "4.5e0", "45e-1", "0", "5"]:
        añadir(texto)

    # Fuera de rango: no se recorta, se reporta.
    for texto in ["85", "5.1", "-1", "100", "-0.05", "5.05", "9.95"]:
        añadir(texto)

    # Cero negativo: pasa `en_rango` porque -0.0 == 0.0, asi que si no se
    # normaliza sale escrito "-0.0" en la columna de nota.
    for texto in ["-0.0", "-0", "-0.00"]:
        añadir(texto)
    añadir(-0.0, tipo="numero")

    # Tokens administrativos, contra cada configuración con nombre.
    tokens = [
        "NP", "np", "N.P.", " Np ", "n.p.", "N/P",
        "null", "NULL", "None", "NA", "N/A", "-", "--",
        "retiro", "Retirado", "cancelo", "Cancelación", "I", "INC",
        "pendiente", "homologación", "excusa", "No Presentó", "sin nota",
        "ver acta", "texto arbitrario", "?", "0,0,0",
    ]
    for config in ("vacia", "repo", "np_reemplazo", "np_dejar_vacio", "np_descartar"):
        for token in tokens:
            añadir(token, config=config)

    # Booleanos y tipos que no son notas.
    añadir(True, tipo="crudo")
    añadir(False, tipo="crudo")

    return casos


def evaluar_valores(casos: list[dict[str, object]]) -> list[dict[str, object]]:
    configs = _configs()
    resultados: list[dict[str, object]] = []

    for caso in casos:
        config = configs[str(caso["config"])]
        nota = interpretar(
            caso["valor"],
            config,
            formula_sin_calcular=bool(caso.get("formula")),
        )
        resultados.append(
            {
                "estado": nota.estado.value,
                # Un decimal exacto: es lo que se escribe en Banner.
                "valor": None if nota.valor is None else f"{nota.valor:.1f}",
                "token": nota.token,
                "formato_corregido": nota.formato_corregido,
                "requiere_decision": nota.requiere_decision,
                "fue_modificada": nota.fue_modificada,
                "tiene_valor_previo": nota.valor_previo is not None,
            }
        )

    return resultados


# --------------------------------------------------------------------------
# Módulo `mapeo`: qué columna es cuál.
#
# Es el corpus que más importa de los tres, porque `mapeo.ts` no traduce solo
# código nuestro: reimplementa `difflib.SequenceMatcher`. Los puntajes se
# comparan como doubles exactos, sin tolerancia — si el algoritmo quedó "casi
# igual", la diferencia solo se nota en la frontera de 0.90 y 0.78, que es
# justo donde se decide si una columna se elige sola o se pregunta.
#
# Tampoco aquí se compara la prosa de `motivo`: incluye un `f"{x:.2f}"`, y el
# formateo de flotantes en el punto medio no coincide entre Python y JavaScript.
# --------------------------------------------------------------------------

CORPUS_MAPEO = AQUI / "corpus-mapeo.json"

CATALOGO_REPO = AQUI.parent / "config" / "alias_columnas.json"

# Los 13 encabezados de la plantilla oficial de Banner (`plan.md` §2.2).
PLANTILLA_BANNER = [
    "Term Code", "CRN", "Course", "Student ID", "Full Name", "Final Grade",
    "Rolled", "Confidential", "Last Attended Date", "Hours Attended",
    "Incomplete Final Grade", "Extension Date", "Extension Date Constraints",
]

# El archivo real de Humberto (`plan.md` §0.8).
ARCHIVO_REAL = [
    "nombre", "codigo de estudiante", "trabajos", "quizes", "examen",
    "nota definitiva",
]


def generar_corpus_mapeo() -> list[dict[str, object]]:
    filas: list[list[object]] = [
        ARCHIVO_REAL,
        PLANTILLA_BANNER,
        [],
        ["columna a", "columna b"],
        ["codigo", "nota examen", "nota parcial"],
        ["codigo de estudiante", "examen"],
        ["codigo", "nota definitiva", "definitiva"],
        ["codigo de estudiante", "promedio"],
        # Variantes de escritura: acentos, mayúsculas, guiones bajos, erratas.
        ["Código de Estudiante", "NOTA DEFINITIVA"],
        ["CODIGO_DE_ESTUDIANTE", "Nota  Definitiva"],
        ["codigo", "nota_definitiva"],
        ["codigo", "Nota Definitva"],
        ["codigo", "notta definitiva"],
        ["codigo", "nta definitva"],
        ["codigo", "definitivas"],
        ["codigo", "calificacion definitiva"],
        ["codigo", "calificasion final"],
        # Alias débiles: plausibles, nunca seguros.
        ["id", "nota"],
        ["no", "total"],
        ["numero", "final"],
        ["documento", "promedio"],
        # Ambigüedades reales entre dos candidatas fuertes.
        ["cedula", "documento", "nota final", "nota definitiva"],
        ["student id", "final grade", "definitiva"],
        ["codigo", "nombre", "nombres", "nombre completo", "definitiva"],
        # Solo señuelos: no puede resolver la nota.
        ["trabajos", "quizes", "examen", "parcial", "taller"],
        ["primer corte", "segundo corte", "tercer corte"],
        # Ruido, vacíos y tipos que no son texto.
        ["", "   ", "codigo", "definitiva"],
        [None, "codigo de estudiante", "nota definitiva"],
        [1, 2.5, "codigo", "definitiva"],
        ["   nota   definitiva   ", "   codigo   "],
        ["!!!", "???", "codigo", "definitiva"],
        # Encabezados largos, para tocar el camino de la coincidencia difusa.
        ["codigo del estudiante matriculado", "nota definitiva del curso"],
        ["identificacion", "calificacion final del semestre"],
    ]

    # Cada fila del archivo real, aislada: fuerza el caso de una sola columna.
    for encabezado in ARCHIVO_REAL + PLANTILLA_BANNER:
        filas.append([encabezado])

    return [{"encabezados": fila} for fila in filas]


def evaluar_mapeo(casos: list[dict[str, object]]) -> list[dict[str, object]]:
    catalogo = CatalogoAlias.desde_json(CATALOGO_REPO)
    resultados: list[dict[str, object]] = []

    for caso in casos:
        encabezados = list(caso["encabezados"])  # type: ignore[arg-type]
        mapa = mapear(encabezados, catalogo)

        campos: dict[str, object] = {}
        for campo, a in mapa.items():
            campos[campo] = {
                "encabezado": a.encabezado,
                "indice": a.indice,
                "confianza": a.confianza.value,
                "resuelto": a.resuelto,
                "requiere_confirmacion": a.requiere_confirmacion,
                # Puntajes exactos: es lo que valida el port de difflib.
                "candidatas": [
                    {"encabezado": c.encabezado, "indice": c.indice, "puntaje": c.puntaje}
                    for c in a.candidatas
                ],
            }

        resultados.append(
            {
                "campos": campos,
                # Lo usa el lector para encontrar la fila de encabezados.
                "puntaje_encabezado": puntaje_encabezado(encabezados, catalogo),
            }
        )

    return resultados


# --------------------------------------------------------------------------
# Módulo `plantilla`: el cruce por identificador.
#
# Se evalúa `cruzar()` sobre analisis y plantillas armados a mano, sin pasar
# por el lector ni por `analizar_archivo`: lo que se contrasta es la logica del
# cruce, no la lectura del .xlsx. La lectura y la escritura las cubre la suite
# del adaptador, contra el ejemplar anonimizado.
#
# Aqui SI se comparan los motivos de bloqueo, a diferencia de los otros
# modulos: son plantillas de texto con conteos enteros, sin ningun flotante
# formateado, asi que la igualdad literal es alcanzable y vale la pena.
# --------------------------------------------------------------------------

CORPUS_PLANTILLA = AQUI / "corpus-plantilla.json"

IDS = [f"ID-{n:03d}" for n in range(1, 13)]


def _fila(numero: int, codigo: str, valor: object) -> FilaAnalizada:
    return FilaAnalizada(
        numero=numero,
        codigo=codigo,
        nombre=f"Estudiante {numero:03d}",
        nota=interpretar(valor),
    )


def _analisis(filas: list[FilaAnalizada], origen: str | None = "notas.xlsx") -> Analisis:
    tabla = Tabla(
        encabezados=[],
        filas=[],
        origen=Path(origen) if origen else None,
    )
    return Analisis(tabla=tabla, mapa={}, indice_nota=0, filas=filas)


def _plantilla(
    ids: list[str],
    rolled: list[str] | None = None,
    nota_existente: dict[str, str] | None = None,
    origen: str = "Template_Anonimo.xlsx",
) -> Plantilla:
    rolled = rolled or []
    nota_existente = nota_existente or {}
    filas = tuple(
        FilaPlantilla(
            fila=i + 2,
            identificador=ident,
            nombre=f"Anonimo {i + 1}",
            rolled=ident in rolled,
            confidencial=False,
            nota_existente=nota_existente.get(ident, ""),
        )
        for i, ident in enumerate(ids)
    )
    return Plantilla(
        ruta=Path(origen),
        esquema=EsquemaBanner.desde_json(AQUI.parent / "config" / "schema_banner.json"),
        columnas={"Student ID": 4, "Final Grade": 8},
        filas=filas,
        control={"Course": "ANON-101", "Term Code": "202610", "CRN": "12345"},
    )


def generar_corpus_plantilla() -> list[dict[str, object]]:
    """Cada caso declara las notas del docente y la forma de la plantilla."""
    casos: list[dict[str, object]] = []

    def añadir(notas, ids=None, rolled=None, nota_existente=None,
               origen_analisis="notas.xlsx", origen_plantilla="Template_Anonimo.xlsx"):
        casos.append({
            "notas": notas,                       # lista de [codigo, valor]
            "ids": ids if ids is not None else IDS,
            "rolled": rolled or [],
            "nota_existente": nota_existente or {},
            "origen_analisis": origen_analisis,
            "origen_plantilla": origen_plantilla,
        })

    completo = [[i, "4.25"] for i in IDS]

    añadir(completo)
    añadir([[i, "3.5"] for i in IDS])
    añadir([[i, "2.95"] for i in IDS])          # la frontera de aprobacion
    añadir([[i, "4,5"] for i in IDS])           # coma decimal
    añadir([[i, "3.5"] for i in reversed(IDS)])  # orden invertido
    añadir([[i, "3.5"] for i in IDS[:-2]])      # dos estudiantes sin nota
    añadir([])                                   # archivo vacio
    añadir([["ID-999", "5.0"]])                  # solo un intruso
    añadir([[i, "3.5"] for i in IDS] + [["ID-999", "5.0"]])
    añadir([[i, "NP" if k == 3 else "3.5"] for k, i in enumerate(IDS)])
    añadir([[i, "" if k == 7 else "3.5"] for k, i in enumerate(IDS)])
    añadir([[i, "85" if k == 0 else "3.5"] for k, i in enumerate(IDS)])
    añadir([[i.lower().replace("-", " "), "3.5"] for i in IDS])
    añadir([[i, "3.5"] for i in IDS] + [[IDS[0], "1.0"]])   # duplicado
    añadir(completo, rolled=[IDS[2]])
    añadir(completo, rolled=IDS)
    añadir(completo, nota_existente={IDS[0]: "4.0", IDS[1]: "2.0"})
    # Mismo archivo: el docente subio la plantilla ya diligenciada.
    añadir(completo, nota_existente={IDS[0]: "4.0"},
           origen_analisis="Template_Anonimo.xlsx")
    añadir(completo, ids=IDS[:3])                # plantilla mas corta
    añadir([[i, "3.5"] for i in IDS[:3]], ids=IDS[:3])
    añadir([["", "3.5"], [IDS[0], "3.5"]], ids=[IDS[0]])   # codigo vacio

    return casos


def evaluar_plantilla(casos: list[dict[str, object]]) -> list[dict[str, object]]:
    resultados: list[dict[str, object]] = []

    for caso in casos:
        filas = [
            _fila(k + 1, str(codigo), valor)
            for k, (codigo, valor) in enumerate(caso["notas"])  # type: ignore[arg-type]
        ]
        analisis = _analisis(filas, str(caso["origen_analisis"]))
        plantilla = _plantilla(
            list(caso["ids"]),                    # type: ignore[arg-type]
            list(caso["rolled"]),                 # type: ignore[arg-type]
            dict(caso["nota_existente"]),         # type: ignore[arg-type]
            str(caso["origen_plantilla"]),
        )
        cruce = cruzar(analisis, plantilla)

        resultados.append(
            {
                "emparejados": [
                    {
                        "identificador": e.plantilla.identificador,
                        "nota": e.nota_texto,
                        "normalizado": e.identificador_normalizado,
                    }
                    for e in cruce.emparejados
                ],
                "sin_nota": [f.identificador for f in cruce.sin_nota],
                "ya_consolidados": [e.plantilla.identificador for e in cruce.ya_consolidados],
                "sobrantes": [f.codigo for f in cruce.sobrantes],
                "pendientes": [f.codigo for f in cruce.pendientes],
                "sobrescriben_nota": [
                    e.plantilla.identificador for e in cruce.sobrescriben_nota
                ],
                "mismo_archivo": cruce.mismo_archivo,
                "puede_generar": cruce.puede_generar,
                "motivos": cruce.motivos_de_bloqueo,
            }
        )

    return resultados


MODULOS = {
    "redondeo": (CORPUS, generar_corpus, evaluar),
    "valores": (CORPUS_VALORES, generar_corpus_valores, evaluar_valores),
    "mapeo": (CORPUS_MAPEO, generar_corpus_mapeo, evaluar_mapeo),
    "plantilla": (CORPUS_PLANTILLA, generar_corpus_plantilla, evaluar_plantilla),
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generar-corpus", action="store_true")
    parser.add_argument("--modulo", choices=sorted(MODULOS), default="redondeo")
    args = parser.parse_args()

    # En Windows, `> archivo.json` hereda la codificación de la consola (cp1252)
    # y parte cualquier encabezado con tilde. Los dorados son UTF-8 siempre.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", newline="\n")

    corpus, generar, evaluador = MODULOS[args.modulo]

    if args.generar_corpus:
        corpus.write_text(
            json.dumps(generar(), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"corpus escrito en {corpus}", file=sys.stderr)
        return 0

    if not corpus.exists():
        print(
            f"falta {corpus}. Ejecuta: "
            f"python herramientas/oraculo.py --modulo {args.modulo} --generar-corpus",
            file=sys.stderr,
        )
        return 1

    casos = json.loads(corpus.read_text(encoding="utf-8"))
    json.dump(evaluador(casos), sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
