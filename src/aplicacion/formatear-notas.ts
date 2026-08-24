/**
 * El caso de uso. Orquesta el hexágono y no sabe nada de Excel, de HTTP ni de
 * React: recibe puertos, devuelve un `ResultadoFormateo`.
 *
 * PENDIENTE DE PORT — `formateador/flujo.py` + `formateador/reporte.py`.
 * Tests a portar: `tests/test_flujo.py`.
 *
 * Contrato que no se negocia:
 *   - Si hay un solo bloqueo, `archivo` sale en `null`. No se emite un archivo
 *     a medias (riesgo `B-11`: una celda vacía puede borrar una nota que ya
 *     estaba cargada).
 *   - Todo redondeo aparece en `cambios` (regla de oro 4).
 *   - filas de entrada === filas de salida + descartadas reportadas (regla 2).
 */

import type {
  ArchivoEntrante,
  Configuracion,
  LectorDeArchivos,
  RepositorioDePlantilla,
  ResultadoFormateo,
  SugeridorDeColumnas,
} from "./puertos.ts";

export interface Dependencias {
  readonly lector: LectorDeArchivos;
  readonly plantillas: RepositorioDePlantilla;
  readonly config: Configuracion;
  /** Opcional: sin él, la cascada se queda en alias + difuso (§4.3). */
  readonly sugeridor?: SugeridorDeColumnas;
}

export interface PeticionDeFormateo {
  readonly archivos: readonly ArchivoEntrante[];
  /** Índice de columna confirmado por el docente (§4.0). */
  readonly columnaNotaConfirmada?: number;
  /** Decisiones tomadas sobre los valores no numéricos pendientes. */
  readonly decisiones?: ReadonlyMap<string, string>;
}

export async function formatearNotas(
  _deps: Dependencias,
  _peticion: PeticionDeFormateo,
): Promise<ResultadoFormateo> {
  throw new Error("PENDIENTE: portar formateador/flujo.py");
}
