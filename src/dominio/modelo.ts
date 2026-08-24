/**
 * Tipos del dominio. Sin dependencias de I/O, de Next.js ni de librerías de
 * Excel: es el interior del hexágono y tiene que poder correr igual en el
 * navegador, en un route handler y en la CLI.
 *
 * Port de los dataclasses de `formateador/{valores,mapeo,lectura,flujo}.py`.
 */

import type { Decimal } from "decimal.js";

/** Estado en que quedó una celda de nota tras interpretarla. Ver `valores.py`. */
export type Estado =
  | "numerica"
  | "vacia"
  | "formula_sin_calcular"
  | "fuera_de_rango"
  | "token_no_numerico";

/** Qué hacer con un valor no numérico. Por defecto: preguntar. */
export type Accion = "preguntar" | "sustituir" | "omitir_fila";

/** Una celda leída del archivo, con su rastro de origen. Ver `lectura.py`. */
export interface Celda {
  readonly fila: number;
  readonly columna: number;
  /** Valor tal como quedó almacenado, siempre como texto (§3.4). */
  readonly valor: string | null;
  /** Fórmula presente en la celda, si la había (§3.1, doble lectura). */
  readonly formula: string | null;
  /** Decimales que el formato de Excel mostraba, para detectar §3.2. */
  readonly decimalesMostrados: number | null;
}

/** Tabla tolerante leída del archivo del docente. */
export interface Tabla {
  readonly encabezados: readonly string[];
  readonly filas: readonly (readonly Celda[])[];
  readonly filaDelEncabezado: number;
}

/** Una nota interpretada. `valor` solo existe si el estado es `numerica`. */
export interface Nota {
  readonly celda: Celda;
  readonly estado: Estado;
  readonly valor: Decimal | null;
  readonly textoOriginal: string;
  readonly requiereDecision: boolean;
  readonly motivo: string | null;
}

export type Confianza = "alta" | "media" | "baja" | "sin_resolver";

export interface Candidata {
  readonly indice: number;
  readonly encabezado: string;
  readonly puntaje: number;
}

/** Resultado del mapeo de una columna a un campo del dominio. Ver `mapeo.py`. */
export interface Asignacion {
  readonly campo: string;
  readonly indice: number | null;
  readonly encabezado: string | null;
  readonly confianza: Confianza;
  readonly alternativas: readonly Candidata[];
  /** §4.0: `nota_definitiva` siempre la confirma una persona. */
  readonly requiereConfirmacion: boolean;
}

export interface FilaAnalizada {
  readonly numero: number;
  readonly codigo: string | null;
  readonly nota: Nota;
  readonly problemas: readonly string[];
}

export interface Analisis {
  readonly filas: readonly FilaAnalizada[];
  readonly mapa: ReadonlyMap<string, Asignacion>;
  readonly descartadas: readonly { fila: number; motivo: string }[];
}

/** Una modificación que el docente tiene que poder ver (regla de oro 4). */
export interface Cambio {
  readonly fila: number;
  readonly codigo: string | null;
  readonly antes: string;
  readonly despues: string;
  readonly motivo: "redondeo" | "separador_decimal" | "sustitucion_autorizada";
}

/** Algo que impide generar el archivo hasta que una persona decida. */
export interface Bloqueo {
  readonly fila: number;
  readonly codigo: string | null;
  readonly estado: Estado;
  readonly mensaje: string;
}
