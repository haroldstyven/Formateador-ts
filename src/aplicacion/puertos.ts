/**
 * Los puertos del hexágono: todo lo que el dominio necesita del mundo exterior,
 * expresado como interfaz. Ningún adaptador se importa desde aquí.
 *
 * Esta es la pieza que hace que el mismo caso de uso corra en el navegador
 * (adaptador con exceljs sobre un File), en un route handler de Next.js
 * (adaptador sobre Buffer) y en la CLI (adaptador sobre el sistema de
 * archivos), sin que el dominio se entere.
 */

import type { Analisis, Bloqueo, Cambio, Tabla } from "@dominio/modelo.ts";

/** Un archivo que entró al sistema, sin suponer de dónde vino. */
export interface ArchivoEntrante {
  readonly nombre: string;
  readonly bytes: Uint8Array;
}

/** Puerto de lectura. Adaptador: `adaptadores/salida/lectura-exceljs.ts`. */
export interface LectorDeArchivos {
  /** Lee .xlsx o .csv con encabezado móvil, celdas combinadas y fórmulas. */
  leer(archivo: ArchivoEntrante): Promise<Tabla>;
  /** Detecta si el archivo ES la plantilla de Banner (§5.0). */
  esPlantillaBanner(archivo: ArchivoEntrante): Promise<boolean>;
}

/** Una fila de la plantilla oficial de Banner. */
export interface FilaPlantilla {
  readonly fila: number;
  readonly studentId: string;
  readonly finalGrade: string | null;
  readonly rolled: boolean;
}

/** Puerto de plantilla. Adaptador: `adaptadores/salida/plantilla-zip.ts`. */
export interface RepositorioDePlantilla {
  leer(archivo: ArchivoEntrante): Promise<readonly FilaPlantilla[]>;
  /**
   * Escribe ÚNICAMENTE la columna `Final Grade` sobre la plantilla original y
   * devuelve los bytes del archivo de cargue. Las otras doce columnas y el
   * contenedor no se tocan (§2.2).
   */
  escribirFinalGrade(
    original: ArchivoEntrante,
    notasPorStudentId: ReadonlyMap<string, string>,
  ): Promise<Uint8Array>;
}

/** Puerto de configuración: `config/alias_columnas.json`, etc. */
export interface Configuracion {
  aliasDeColumnas(): Promise<unknown>;
  valoresNoNumericos(): Promise<unknown>;
  esquemaBanner(): Promise<unknown>;
}

/**
 * Puerto del fallback de mapeo (§4.3). Recibe ÚNICAMENTE nombres de
 * encabezado — nunca notas ni códigos de estudiante (§3.2). El adaptador que
 * lo implemente tiene prohibido recibir cualquier otra cosa; ese es el motivo
 * de que el puerto acepte `string[]` y no una `Tabla`.
 */
export interface SugeridorDeColumnas {
  sugerir(
    encabezados: readonly string[],
    camposPendientes: readonly string[],
  ): Promise<readonly { encabezado: string; campo: string; confianza: number }[]>;
}

/** Lo que el caso de uso devuelve. Nunca un archivo sin su reporte. */
export interface ResultadoFormateo {
  readonly analisis: Analisis;
  readonly cambios: readonly Cambio[];
  readonly bloqueos: readonly Bloqueo[];
  /** `null` mientras haya bloqueos: no se emite archivo a medias. */
  readonly archivo: { bytes: Uint8Array; nombre: string } | null;
}
