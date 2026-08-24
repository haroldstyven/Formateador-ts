/**
 * Interpreta una celda: número, vacía, fórmula sin calcular, fuera de rango o
 * token administrativo.
 *
 * PENDIENTE DE PORT — `formateador/valores.py` (~300 líneas).
 * Tests a portar: `tests/test_valores.py`.
 *
 * La invariante que no se puede perder al portar (§4, regla 3):
 * una celda vacía NUNCA vale 0.0. Ni una fórmula sin calcular, ni un `NP`, ni
 * un valor fuera de rango. Todos devuelven `requiereDecision: true` y bloquean
 * la generación hasta que el docente decida.
 */

import type { Celda, Nota } from "./modelo.ts";

export interface ConfigValores {
  readonly tokens: ReadonlyMap<string, { accion: string; sustituto?: string }>;
}

export function interpretar(_celda: Celda, _config: ConfigValores): Nota {
  throw new Error("PENDIENTE: portar formateador/valores.py");
}
