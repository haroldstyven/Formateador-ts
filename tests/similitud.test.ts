/**
 * Suite de `similitud.ts` — la reimplementación de `difflib.SequenceMatcher`.
 *
 * Los valores esperados no están calculados a mano: salen de ejecutar
 * `SequenceMatcher(None, a, b).ratio()` en Python y pegar el resultado. Un
 * `ratio` que se desvíe en el tercer decimal no rompe casi ningún test de
 * mapeo —solo los que caen justo en 0.90 o en 0.78— y por eso se comprueba
 * aquí con igualdad exacta de doubles, no con una tolerancia.
 *
 * El corpus diferencial de `mapeo` cubre lo mismo desde el otro lado, con
 * encabezados reales.
 */

import { describe, expect, it } from "vitest";

import { ratio } from "@dominio/similitud.ts";

/** Pares y su `ratio` exacto según Python. */
const REFERENCIA: readonly [string, string, number][] = [
  ["nota definitva", "nota definitiva", 0.9655172413793104],
  ["codigo estudiante", "codigo de estudiante", 0.918918918918919],
  ["promedio final", "nota final", 0.5833333333333334],
  ["", "", 1.0],
  ["abc", "abc", 1.0],
  ["", "abc", 0.0],
  ["nota", "nota definitiva", 0.42105263157894735],
  ["def", "definitiva", 0.46153846153846156],
  ["calificacion", "calificacion final", 0.8],
  ["id", "identificacion", 0.25],
  ["xyz", "abc", 0.0],
];

describe("ratio · equivalencia con difflib", () => {
  it("reproduce los valores de Python bit a bit", () => {
    for (const [a, b, esperado] of REFERENCIA) {
      expect(ratio(a, b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(esperado);
    }
  });

  it("dos cadenas vacías dan 1.0, igual que en Python", () => {
    // El caso que una implementación ingenua devolvería como 0 o NaN.
    expect(ratio("", "")).toBe(1.0);
  });

  it("es simétrico en los casos del catálogo", () => {
    // difflib no garantiza simetría en general, pero divergir aquí sería señal
    // de que el recorrido recursivo quedó mal.
    for (const [a, b] of REFERENCIA) {
      expect(ratio(a, b), `${a} / ${b}`).toBeCloseTo(ratio(b, a), 12);
    }
  });

  it("está acotado entre 0 y 1", () => {
    for (const [a, b] of REFERENCIA) {
      const r = ratio(a, b);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});
