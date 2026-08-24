/**
 * Tipos del dominio. Sin dependencias de I/O, de Next.js ni de librerías de
 * Excel: es el interior del hexágono y tiene que poder correr igual en el
 * navegador, en un route handler y en la CLI.
 *
 * Port de los dataclasses de `formateador/{valores,mapeo,lectura,flujo}.py`.
 */

import type { Decimal } from "decimal.js";

/** Resultado de interpretar una celda de nota. Ver `valores.ts`. */
export type Estado =
  /** Numérica, y ya venía con un decimal. */
  | "ok"
  /** Numérica; se ajustó a un decimal. Va al diff. */
  | "redondeada"
  /** Sin calificar. Nunca se rellena con ningún valor. */
  | "vacia"
  /** Fórmula con el valor cacheado vacío (§3.1). Recuperable con Ctrl+S. */
  | "formula_sin_calcular"
  /** Token pendiente de decisión humana. */
  | "no_numerica"
  | "fuera_de_rango"
  /** Decisión del docente aplicada y registrada. */
  | "sustituida"
  /** La fila se excluye, por decisión registrada. */
  | "descartada";

/** Qué hacer con un token no numérico. Por defecto: preguntar. */
export type Accion = "preguntar" | "reemplazar" | "dejar_vacio" | "descartar_fila";

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

/**
 * Una celda de nota ya interpretada, lista para el reporte o el escritor.
 *
 * `valor` es `null` en todos los estados que no producen nota: `vacia`,
 * `no_numerica`, `fuera_de_rango`, `formula_sin_calcular` y `descartada`. Esa
 * es la regla de oro 3 expresada en el tipo — no hay forma de construir una
 * `Nota` bloqueada que además traiga un número.
 *
 * `requiereDecision` y `fueModificada` son funciones en `valores.ts`, no
 * propiedades: así la `Nota` sigue siendo un objeto plano y serializable, que
 * es lo que cruza la frontera hacia el reporte y hacia la interfaz.
 */
export interface Nota {
  readonly original: string;
  readonly valor: Decimal | null;
  readonly estado: Estado;
  readonly detalle: string;
  readonly token: string | null;
  readonly valorPrevio: Decimal | null;
  /** Una coma cambiada por punto: no altera el valor, pero va al diff (regla 4). */
  readonly formatoCorregido: boolean;
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
