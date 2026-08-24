/**
 * Qué columna es cuál. Cascada de tres niveles: alias, difuso y —solo como
 * último recurso— el LLM a través del puerto `SugeridorDeColumnas`.
 *
 * PENDIENTE DE PORT — `formateador/mapeo.py`.
 * Tests a portar: `tests/test_mapeo.py`.
 *
 * Al portar hay que conservar los umbrales tal cual, porque están calibrados
 * contra el archivo real de Humberto (§0.8):
 *   UMBRAL_ALTO = 0.90 · UMBRAL_MINIMO = 0.78 · MARGEN_MINIMO = 0.08
 *
 * Y la restricción 4.0, que manda sobre toda la cascada: `nota_definitiva`
 * nunca se elige automáticamente entre varias candidatas numéricas sin
 * confianza alta, y SIEMPRE la confirma una persona.
 *
 * Nota de dependencias: `rapidfuzz` no existe en npm. El equivalente razonable
 * es `fastest-levenshtein`, o implementar la razón de Levenshtein a mano (son
 * ~20 líneas). NO se puede asumir que dé el mismo puntaje que rapidfuzz: hay
 * que recalibrar contra los mismos encabezados y verificarlo con el test.
 */

import type { Asignacion, Candidata } from "./modelo.ts";

export const UMBRAL_ALTO = 0.9;
export const UMBRAL_MINIMO = 0.78;
export const MARGEN_MINIMO = 0.08;

export const CAMPO_NOTA = "nota_definitiva";
export const CAMPO_CODIGO = "codigo_estudiante";
export const CAMPO_NOMBRE = "nombre_estudiante";

/** §4.0: la columna de nota siempre la confirma una persona. */
export const CONFIRMACION_OBLIGATORIA: ReadonlySet<string> = new Set([CAMPO_NOTA]);

/** Minúsculas, sin tildes, sin puntuación. Equivale a `normalizar_encabezado`. */
export function normalizarEncabezado(texto: unknown): string {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function mapear(
  _encabezados: readonly string[],
): ReadonlyMap<string, Asignacion> {
  throw new Error("PENDIENTE: portar formateador/mapeo.py");
}

export function resumenParaConfirmar(
  _asignacion: Asignacion,
  _muestra: readonly string[],
): string {
  throw new Error("PENDIENTE: portar formateador/mapeo.py");
}

export type { Candidata };
