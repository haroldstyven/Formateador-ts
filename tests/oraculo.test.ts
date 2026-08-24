/**
 * Prueba diferencial contra la implementación Python.
 *
 * El port no se considera correcto porque pase sus propios tests, sino porque
 * produce exactamente lo mismo que la implementación que ya está probada y
 * defendida ante la dirección de cargue académico.
 *
 * Este repositorio es autónomo: no necesita Python ni el repo de la PoC. Lo
 * que se versiona aquí son pares de archivos JSON, uno por módulo portado:
 *
 *   herramientas/corpus.json                  entradas del motor de redondeo
 *   herramientas/salida-python.json           lo que Python devuelve — el dorado
 *   herramientas/corpus-valores.json          entradas de la interpretación de celdas
 *   herramientas/salida-python-valores.json   el dorado correspondiente
 *
 * Cómo se regeneran (solo al ampliar un corpus, y siempre en un commit aparte
 * para que el diff se pueda revisar):
 *
 *   # en el repo de la PoC, Formateador-Banner
 *   python herramientas/oraculo.py --modulo valores --generar-corpus
 *   python herramientas/oraculo.py --modulo valores > salida-python-valores.json
 *   # y se copian los dos archivos a herramientas/ de este repo
 *
 * Si una línea de un archivo dorado cambia sin que nadie haya ampliado el
 * corpus, algo se rompió: no se actualiza el dorado para que pase el test.
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
