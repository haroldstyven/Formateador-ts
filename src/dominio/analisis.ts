/**
 * Predicados derivados sobre el análisis de un archivo.
 *
 * En la referencia son `@property` de `FilaAnalizada` y `Analisis`, en
 * `formateador/flujo.py`. Aquí viven aparte porque los modelos son objetos
 * planos y porque `plantilla.ts` los necesita antes de que `flujo.ts` exista:
 * el cruce pregunta si una fila bloquea, no cómo se armó.
 *
 * La regla que sostienen entre todos es la de oro 2: `entrada == salida +
 * descartadas reportadas`. Por eso `descartadas` es una categoría propia y no
 * se confunde con `bloqueadas` — mezclarlas haría que una fila desapareciera en
 * silencio, que es justo lo que la regla prohíbe.
 */

import type { Analisis, FilaAnalizada } from "./modelo.ts";
import { fueModificada, requiereDecision } from "./valores.ts";

/** Si es `true`, no se puede generar el archivo hasta resolverlo. */
export function bloquea(fila: FilaAnalizada): boolean {
  return requiereDecision(fila.nota) || fila.problemas.length > 0;
}

export function motivoBloqueo(fila: FilaAnalizada): string {
  if (fila.problemas.length) return fila.problemas.join("; ");
  return requiereDecision(fila.nota) ? fila.nota.detalle : "";
}

export function total(analisis: Analisis): number {
  return analisis.filas.length;
}

export function bloqueadas(analisis: Analisis): FilaAnalizada[] {
  return analisis.filas.filter(bloquea);
}

/**
 * Filas que el docente decidió excluir. No bloquean, pero tampoco salen.
 *
 * Existen como categoría propia por la regla de oro 2.
 */
export function descartadas(analisis: Analisis): FilaAnalizada[] {
  return analisis.filas.filter((f) => f.nota.estado === "descartada");
}

/** Filas que salen al archivo: resueltas y con una nota concreta. */
export function listas(analisis: Analisis): FilaAnalizada[] {
  return analisis.filas.filter((f) => !bloquea(f) && f.nota.valor !== null);
}

export function modificadas(analisis: Analisis): FilaAnalizada[] {
  return analisis.filas.filter((f) => fueModificada(f.nota));
}

/** Ninguna fila puede quedar pendiente: o está resuelta, o no se genera. */
export function puedeGenerar(analisis: Analisis): boolean {
  return total(analisis) > 0 && bloqueadas(analisis).length === 0;
}

/**
 * Agrupa por token las filas que esperan una decisión del docente.
 *
 * Permite preguntar una vez por token en vez de una vez por fila.
 */
export function pendientesPorToken(analisis: Analisis): Map<string, FilaAnalizada[]> {
  const grupos = new Map<string, FilaAnalizada[]>();
  for (const fila of analisis.filas) {
    if (fila.nota.estado === "no_numerica" && fila.nota.token) {
      const grupo = grupos.get(fila.nota.token);
      if (grupo) grupo.push(fila);
      else grupos.set(fila.nota.token, [fila]);
    }
  }
  return grupos;
}
