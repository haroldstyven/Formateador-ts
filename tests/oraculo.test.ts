/**
 * Prueba diferencial contra la implementación Python.
 *
 * El port no se considera correcto porque pase sus propios tests, sino porque
 * produce exactamente lo mismo que la implementación que ya está probada y
 * defendida ante la dirección de cargue académico.
 *
 * Este repositorio es autónomo: no necesita Python ni el repo de la PoC. Lo
 * que se versiona aquí son dos archivos JSON:
 *
 *   herramientas/corpus.json         los casos de entrada
 *   herramientas/salida-python.json  lo que la implementación Python devuelve
 *                                    para cada uno — el archivo dorado
 *
 * Cómo se regenera el archivo dorado (solo al ampliar el corpus, y siempre en
 * un commit aparte para que el diff se pueda revisar):
 *
 *   # en el repo de la PoC, Formateador-Banner
 *   python herramientas/oraculo.py --generar-corpus
 *   python herramientas/oraculo.py > salida-python.json
 *   # y se copian los dos archivos a herramientas/ de este repo
 *
 * Si una línea del archivo dorado cambia sin que nadie haya ampliado el
 * corpus, algo se rompió: no se actualiza el dorado para que pase el test.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ValorNoDecimal, formatear } from "@dominio/redondeo.ts";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

interface Caso {
  tipo: "texto" | "numero";
  valor: string | number;
}

interface Resultado {
  salida: string | null;
  error: string | null;
}

const corpus = JSON.parse(
  readFileSync(`${RAIZ}herramientas/corpus.json`, "utf-8"),
) as Caso[];

const salidaPython = JSON.parse(
  readFileSync(`${RAIZ}herramientas/salida-python.json`, "utf-8"),
) as Resultado[];

describe("prueba diferencial contra el oráculo Python", () => {
  it("el corpus y el archivo dorado tienen el mismo tamaño", () => {
    expect(salidaPython).toHaveLength(corpus.length);
    expect(corpus.length).toBeGreaterThan(0);
  });

  it("TypeScript y Python coinciden en el 100% de los casos", () => {
    const divergencias: string[] = [];

    corpus.forEach((caso, i) => {
      const esperado = salidaPython[i]!;
      let obtenido: Resultado;
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

    expect(divergencias, `\n${divergencias.join("\n")}\n`).toHaveLength(0);
  });
});
