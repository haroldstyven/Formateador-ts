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
import type { EsquemaBanner, Plantilla } from "@dominio/plantilla.ts";
import type { CatalogoAlias } from "@dominio/mapeo.ts";
import type { ConfigValores } from "@dominio/valores.ts";

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

/**
 * Una fila de la plantilla oficial de Banner.
 *
 * El tipo lo define el dominio y el puerto solo lo reexporta. Tener dos
 * versiones del mismo concepto —una aquí y otra en `dominio/plantilla.ts`— fue
 * un error del esqueleto inicial, y el typecheck lo cazó en cuanto el adaptador
 * tuvo que satisfacer las dos a la vez.
 */
export type { FilaPlantilla } from "@dominio/plantilla.ts";

/**
 * Puerto de plantilla. Adaptador: `adaptadores/salida/plantilla-zip.ts`.
 *
 * `leer` devuelve la `Plantilla` entera y no solo sus filas: el cruce necesita
 * además el esquema, el mapa de columnas y los datos de control del curso. El
 * esqueleto inicial devolvía solo las filas, y con el caso de uso escrito quedó
 * claro que era una interfaz insuficiente.
 */
export interface RepositorioDePlantilla {
  leer(archivo: ArchivoEntrante): Promise<Plantilla>;
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

/**
 * Puerto de configuración: de dónde salen `config/*.json`.
 *
 * Devuelve objetos ya construidos, no JSON crudo: parsear es trabajo del
 * adaptador, y validar la política es trabajo del dominio (`ConfigValores`
 * rechaza una configuración peligrosa al construirse, §0.3.1).
 */
export interface Configuracion {
  catalogoDeAlias(): Promise<CatalogoAlias>;
  valoresNoNumericos(): Promise<ConfigValores>;
  esquemaBanner(): Promise<EsquemaBanner>;
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
