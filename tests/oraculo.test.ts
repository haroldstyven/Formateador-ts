/**
 * Prueba diferencial contra la implementación Python.
 *
 * El port no se considera correcto porque pase sus propios tests, sino porque
 * produce exactamente lo mismo que la implementación que ya está probada y
 * defendida ante la dirección de cargue académico.
 *
 * Este repositorio es autónomo: no necesita Python ni el repo de la PoC. Lo
 * que se versiona aquí son pares de archivos JSON, uno por módulo portado —
 * `corpus-<modulo>.json` con las entradas y `salida-python-<modulo>.json` con
 * lo que la referencia devuelve para cada una, el archivo dorado:
 *
 *   redondeo   (corpus.json / salida-python.json, sin sufijo por ser el primero)
 *   valores    interpretación de una celda
 *   mapeo      qué columna es cuál, con los puntajes de difflib
 *   plantilla  el cruce por identificador
 *
 * Cómo se regeneran (solo al ampliar un corpus, y siempre en un commit aparte
 * para que el diff se pueda revisar) — con `herramientas/oraculo.py`, que es de
 * este repositorio y lee la referencia desde un clon local:
 *
 *   python herramientas/oraculo.py --modulo valores --generar-corpus
 *   python herramientas/oraculo.py --modulo valores > herramientas/salida-python-valores.json
 *
 * La referencia está congelada, así que ante una divergencia la pregunta es
 * cuál de las dos tiene razón. Si la tiene el port, se regenera el dorado y el
 * commit explica por qué. Lo que no se hace nunca es actualizar el dorado para
 * que el test pase.
 *
 * QUÉ SE COMPARA, Y POR QUÉ NO TODO. En `valores` no se compara la prosa de
 * `detalle`. La representación de un decimal difiere entre Python y decimal.js
 * en los bordes —`Decimal("0.0")` imprime "0.0", decimal.js imprime "0"— y esas
 * cadenas van dentro del mensaje; perseguir igualdad byte a byte en el texto
 * obligaría a deformar una implementación para que se parezca a la otra. Se
 * compara todo lo que decide algo: estado, valor emitido, token y las banderas
 * que gobiernan si el archivo se puede generar y si la nota entra al diff. El
 * principio §4.4 ya dice que la prosa nunca es la fuente de verdad.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ValorNoDecimal, formatear } from "@dominio/redondeo.ts";
import {
  ConfigValores,
  fueModificada,
  interpretar,
  requiereDecision,
} from "@dominio/valores.ts";
import {
  CatalogoAlias,
  mapear,
  puntajeEncabezado,
  requiereConfirmacion,
  resuelto,
} from "@dominio/mapeo.ts";
import {
  type FilaPlantilla,
  type Plantilla,
  cruzar,
  esquemaDesdeObjeto,
  motivosDeBloqueo,
  notaTexto,
  puedeGenerarCruce,
  sobrescribenNota,
} from "@dominio/plantilla.ts";
import type { Analisis, FilaAnalizada } from "@dominio/modelo.ts";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

function leerJson<T>(ruta: string): T {
  return JSON.parse(readFileSync(`${RAIZ}${ruta}`, "utf-8")) as T;
}

/** Reporta las divergencias con contexto suficiente para depurarlas. */
function exigirCoincidencia(divergencias: readonly string[]): void {
  expect(
    divergencias,
    divergencias.length ? `\n${divergencias.slice(0, 20).join("\n")}\n` : undefined,
  ).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// Módulo redondeo
// ---------------------------------------------------------------------------

interface CasoRedondeo {
  tipo: "texto" | "numero";
  valor: string | number;
}

interface ResultadoRedondeo {
  salida: string | null;
  error: string | null;
}

describe("redondeo · diferencial contra el oráculo Python", () => {
  const corpus = leerJson<CasoRedondeo[]>("herramientas/corpus.json");
  const dorado = leerJson<ResultadoRedondeo[]>("herramientas/salida-python.json");

  it("el corpus y el archivo dorado tienen el mismo tamaño", () => {
    expect(dorado).toHaveLength(corpus.length);
    expect(corpus.length).toBeGreaterThan(0);
  });

  it("TypeScript y Python coinciden en el 100% de los casos", () => {
    const divergencias: string[] = [];

    corpus.forEach((caso, i) => {
      const esperado = dorado[i]!;
      let obtenido: ResultadoRedondeo;
      try {
        obtenido = { salida: formatear(caso.valor), error: null };
      } catch (e) {
        obtenido = {
          salida: null,
          error: e instanceof ValorNoDecimal ? "ValorNoDecimal" : String(e),
        };
      }

      if (obtenido.salida !== esperado.salida || obtenido.error !== esperado.error) {
        divergencias.push(
          `[${caso.tipo}] ${JSON.stringify(caso.valor)} — ` +
            `python: ${JSON.stringify(esperado)} · ts: ${JSON.stringify(obtenido)}`,
        );
      }
    });

    exigirCoincidencia(divergencias);
  });
});

// ---------------------------------------------------------------------------
// Módulo valores
// ---------------------------------------------------------------------------

interface CasoValores {
  config: string;
  tipo: "texto" | "numero" | "crudo";
  valor: unknown;
  formula: boolean;
}

interface ResultadoValores {
  estado: string;
  valor: string | null;
  token: string | null;
  formato_corregido: boolean;
  requiere_decision: boolean;
  fue_modificada: boolean;
  tiene_valor_previo: boolean;
}

/** Las mismas configuraciones con nombre que declara el oráculo. */
function configuraciones(): Record<string, ConfigValores> {
  return {
    vacia: new ConfigValores(),
    repo: ConfigValores.desdeObjeto(
      leerJson<unknown>("config/valores_no_numericos.json"),
    ),
    np_reemplazo: ConfigValores.desdeObjeto({
      tokens: { np: { accion: "reemplazar", valor: "0.0" } },
    }),
    np_dejar_vacio: ConfigValores.desdeObjeto({
      tokens: { np: { accion: "dejar_vacio" } },
    }),
    np_descartar: ConfigValores.desdeObjeto({
      tokens: { np: { accion: "descartar_fila" } },
    }),
  };
}

describe("valores · diferencial contra el oráculo Python", () => {
  const corpus = leerJson<CasoValores[]>("herramientas/corpus-valores.json");
  const dorado = leerJson<ResultadoValores[]>(
    "herramientas/salida-python-valores.json",
  );

  it("el corpus y el archivo dorado tienen el mismo tamaño", () => {
    expect(dorado).toHaveLength(corpus.length);
    expect(corpus.length).toBeGreaterThan(0);
  });

  it("el corpus ejercita los ocho estados", () => {
    // Si un estado deja de aparecer, el corpus dejó de cubrir un camino.
    expect(new Set(dorado.map((r) => r.estado)).size).toBe(8);
  });

  it("TypeScript y Python coinciden en el 100% de los casos", () => {
    const configs = configuraciones();
    const divergencias: string[] = [];

    corpus.forEach((caso, i) => {
      const esperado = dorado[i]!;
      const config = configs[caso.config];
      if (!config) throw new Error(`configuración desconocida: ${caso.config}`);

      const n = interpretar(caso.valor, config, {
        formulaSinCalcular: caso.formula,
      });

      const obtenido: ResultadoValores = {
        estado: n.estado,
        valor: n.valor === null ? null : n.valor.toFixed(1),
        token: n.token,
        formato_corregido: n.formatoCorregido,
        requiere_decision: requiereDecision(n),
        fue_modificada: fueModificada(n),
        tiene_valor_previo: n.valorPrevio !== null,
      };

      const campos = Object.keys(esperado) as (keyof ResultadoValores)[];
      const distintos = campos.filter((c) => obtenido[c] !== esperado[c]);

      if (distintos.length) {
        divergencias.push(
          `[${caso.config}/${caso.tipo}] ${JSON.stringify(caso.valor)} — ` +
            distintos
              .map(
                (c) =>
                  `${c}: python=${JSON.stringify(esperado[c])} ts=${JSON.stringify(obtenido[c])}`,
              )
              .join(", "),
        );
      }
    });

    exigirCoincidencia(divergencias);
  });
});

// ---------------------------------------------------------------------------
// Módulo mapeo
//
// Es el corpus que más importa de los tres, porque `mapeo.ts` no traduce solo
// código nuestro: `similitud.ts` reimplementa `difflib.SequenceMatcher`. Los
// puntajes se comparan como doubles exactos, sin tolerancia — un algoritmo
// "casi igual" solo se nota en la frontera de 0.90 y 0.78, que es justo donde
// se decide si una columna se elige sola o se pregunta.
//
// `motivo` no se compara: incluye un `${x.toFixed(2)}`, y el formateo de
// flotantes en el punto medio no coincide entre Python y JavaScript.
// ---------------------------------------------------------------------------

interface CasoMapeo {
  encabezados: unknown[];
}

interface CandidataDorada {
  encabezado: string;
  indice: number;
  puntaje: number;
}

interface AsignacionDorada {
  encabezado: string | null;
  indice: number | null;
  confianza: string;
  resuelto: boolean;
  requiere_confirmacion: boolean;
  candidatas: CandidataDorada[];
}

interface ResultadoMapeo {
  campos: Record<string, AsignacionDorada>;
  puntaje_encabezado: number;
}

describe("mapeo · diferencial contra el oráculo Python", () => {
  const corpus = leerJson<CasoMapeo[]>("herramientas/corpus-mapeo.json");
  const dorado = leerJson<ResultadoMapeo[]>("herramientas/salida-python-mapeo.json");
  const catalogo = CatalogoAlias.desdeObjeto(
    leerJson<unknown>("config/alias_columnas.json"),
  );

  it("el corpus y el archivo dorado tienen el mismo tamaño", () => {
    expect(dorado).toHaveLength(corpus.length);
    expect(corpus.length).toBeGreaterThan(0);
  });

  it("el corpus ejercita los tres niveles de confianza", () => {
    const niveles = new Set(
      dorado.flatMap((r) => Object.values(r.campos).map((a) => a.confianza)),
    );
    expect([...niveles].sort()).toEqual(["alta", "media", "nula"]);
  });

  it("TypeScript y Python coinciden en el 100% de los casos", () => {
    const divergencias: string[] = [];

    corpus.forEach((caso, i) => {
      const esperado = dorado[i]!;
      const mapa = mapear(caso.encabezados, catalogo);
      const etiqueta = `[${i}] ${JSON.stringify(caso.encabezados)}`;

      const puntaje = puntajeEncabezado(caso.encabezados, catalogo);
      if (puntaje !== esperado.puntaje_encabezado) {
        divergencias.push(
          `${etiqueta} puntaje_encabezado: python=${esperado.puntaje_encabezado} ts=${puntaje}`,
        );
      }

      const camposEsperados = Object.keys(esperado.campos).sort();
      const camposObtenidos = [...mapa.keys()].sort();
      if (camposEsperados.join() !== camposObtenidos.join()) {
        divergencias.push(
          `${etiqueta} campos: python=${camposEsperados} ts=${camposObtenidos}`,
        );
        return;
      }

      for (const campo of camposEsperados) {
        const e = esperado.campos[campo]!;
        const a = mapa.get(campo)!;

        const escalares: [string, unknown, unknown][] = [
          ["encabezado", e.encabezado, a.encabezado],
          ["indice", e.indice, a.indice],
          ["confianza", e.confianza, a.confianza],
          ["resuelto", e.resuelto, resuelto(a)],
          ["requiere_confirmacion", e.requiere_confirmacion, requiereConfirmacion(a)],
        ];
        for (const [nombre, python, ts] of escalares) {
          if (python !== ts) {
            divergencias.push(
              `${etiqueta} ${campo}.${nombre}: python=${JSON.stringify(python)} ts=${JSON.stringify(ts)}`,
            );
          }
        }

        if (e.candidatas.length !== a.candidatas.length) {
          divergencias.push(
            `${etiqueta} ${campo}.candidatas: python=${e.candidatas.length} ts=${a.candidatas.length}`,
          );
          continue;
        }

        e.candidatas.forEach((ce, k) => {
          const ca = a.candidatas[k]!;
          // Puntaje con igualdad exacta: es lo que valida el port de difflib.
          if (
            ce.encabezado !== ca.encabezado ||
            ce.indice !== ca.indice ||
            ce.puntaje !== ca.puntaje
          ) {
            divergencias.push(
              `${etiqueta} ${campo}.candidatas[${k}]: ` +
                `python=${JSON.stringify(ce)} ts=${JSON.stringify({
                  encabezado: ca.encabezado,
                  indice: ca.indice,
                  puntaje: ca.puntaje,
                })}`,
            );
          }
        });
      }
    });

    exigirCoincidencia(divergencias);
  });
});

// ---------------------------------------------------------------------------
// Módulo plantilla — el cruce por identificador
//
// Aquí SÍ se comparan los motivos de bloqueo, a diferencia de los otros
// módulos: son plantillas de texto con conteos enteros, sin ningún flotante
// formateado, así que la igualdad literal es alcanzable y vale la pena.
//
// La lectura y la escritura del .xlsx no entran en este corpus: las cubre la
// suite del adaptador contra el ejemplar anonimizado.
// ---------------------------------------------------------------------------

interface CasoPlantilla {
  notas: [string, unknown][];
  ids: string[];
  rolled: string[];
  nota_existente: Record<string, string>;
  origen_analisis: string;
  origen_plantilla: string;
}

interface ResultadoPlantilla {
  emparejados: { identificador: string; nota: string; normalizado: boolean }[];
  sin_nota: string[];
  ya_consolidados: string[];
  sobrantes: string[];
  pendientes: string[];
  sobrescriben_nota: string[];
  mismo_archivo: boolean;
  puede_generar: boolean;
  motivos: string[];
}

describe("plantilla · diferencial contra el oráculo Python", () => {
  const corpus = leerJson<CasoPlantilla[]>("herramientas/corpus-plantilla.json");
  const dorado = leerJson<ResultadoPlantilla[]>(
    "herramientas/salida-python-plantilla.json",
  );
  const esquema = esquemaDesdeObjeto(leerJson<unknown>("config/schema_banner.json"));

  function construir(caso: CasoPlantilla): { analisis: Analisis; plantilla: Plantilla } {
    const filas: FilaAnalizada[] = caso.notas.map(([codigo, valor], k) => ({
      numero: k + 1,
      codigo: String(codigo),
      nombre: `Estudiante ${String(k + 1).padStart(3, "0")}`,
      nota: interpretar(valor),
      problemas: [],
      avisos: [],
    }));

    const analisis: Analisis = {
      tabla: {
        encabezados: [],
        filas: [],
        hoja: "",
        filaEncabezado: 0,
        incidencias: [],
        origen: caso.origen_analisis || null,
      },
      mapa: new Map(),
      indiceNota: 0,
      filas,
    };

    const filasPlantilla: FilaPlantilla[] = caso.ids.map((ident, i) => ({
      fila: i + 2,
      identificador: ident,
      nombre: `Anonimo ${i + 1}`,
      rolled: caso.rolled.includes(ident),
      confidencial: false,
      notaExistente: caso.nota_existente[ident] ?? "",
    }));

    const plantilla: Plantilla = {
      origen: caso.origen_plantilla,
      esquema,
      columnas: new Map([
        ["Student ID", 4],
        ["Final Grade", 8],
      ]),
      filas: filasPlantilla,
      control: new Map([
        ["Course", "ANON-101"],
        ["Term Code", "202610"],
        ["CRN", "12345"],
      ]),
    };

    return { analisis, plantilla };
  }

  it("el corpus y el archivo dorado tienen el mismo tamaño", () => {
    expect(dorado).toHaveLength(corpus.length);
    expect(corpus.length).toBeGreaterThan(0);
  });

  it("el corpus ejercita los dos desenlaces del cruce", () => {
    expect(dorado.some((r) => r.puede_generar)).toBe(true);
    expect(dorado.some((r) => !r.puede_generar)).toBe(true);
    expect(dorado.some((r) => r.mismo_archivo)).toBe(true);
    expect(dorado.some((r) => r.ya_consolidados.length)).toBe(true);
  });

  it("TypeScript y Python coinciden en el 100% de los casos", () => {
    const divergencias: string[] = [];

    corpus.forEach((caso, i) => {
      const esperado = dorado[i]!;
      const { analisis, plantilla } = construir(caso);
      const cruce = cruzar(analisis, plantilla);

      const obtenido: ResultadoPlantilla = {
        emparejados: cruce.emparejados.map((e) => ({
          identificador: e.plantilla.identificador,
          nota: notaTexto(e),
          normalizado: e.identificadorNormalizado,
        })),
        sin_nota: cruce.sinNota.map((f) => f.identificador),
        ya_consolidados: cruce.yaConsolidados.map((e) => e.plantilla.identificador),
        sobrantes: cruce.sobrantes.map((f) => f.codigo),
        pendientes: cruce.pendientes.map((f) => f.codigo),
        sobrescriben_nota: sobrescribenNota(cruce).map((e) => e.plantilla.identificador),
        mismo_archivo: cruce.mismoArchivo,
        puede_generar: puedeGenerarCruce(cruce),
        motivos: motivosDeBloqueo(cruce),
      };

      const a = JSON.stringify(obtenido);
      const b = JSON.stringify(esperado);
      if (a !== b) divergencias.push(`[${i}] python=${b}\n     ts=${a}`);
    });

    exigirCoincidencia(divergencias);
  });
});
