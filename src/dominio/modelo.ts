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

/**
 * Una celda del archivo del docente, con lo necesario para no equivocarse al
 * interpretarla. Los predicados que se derivan de ella viven en `celda.ts`.
 */
export interface Celda {
  /**
   * Valor tal como quedó almacenado, **siempre como texto** (§3.4). `null` si
   * la celda no tenía valor: no es lo mismo que la cadena vacía, y de esa
   * distinción depende separar una fórmula sin calcular de una celda sin
   * calificar.
   */
  readonly valor: string | null;
  /** Fórmula presente en la celda, si la había (§3.1, doble lectura). */
  readonly formula: string | null;
  /** El formato numérico de Excel, para detectar la precisión oculta (§3.2). */
  readonly formato: string | null;
}

/** Tabla tolerante leída del archivo del docente. */
export interface Tabla {
  readonly encabezados: readonly string[];
  readonly filas: readonly (readonly Celda[])[];
  readonly hoja: string;
  readonly filaEncabezado: number;
  readonly incidencias: readonly string[];
  /**
   * Identidad del archivo del que salió esta tabla.
   *
   * En la referencia es un `Path` y se compara resolviendo rutas. Aquí es un
   * identificador opaco que pone el adaptador —el nombre del archivo subido, o
   * lo que sirva para reconocerlo— porque resolver rutas es I/O y el dominio
   * no la hace. Lo único que el dominio necesita es poder responder "¿este
   * archivo y la plantilla son el mismo?" (§5.0).
   */
  readonly origen: string | null;
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

export type Confianza = "alta" | "media" | "nula";

/** Una columna que podría ser el campo buscado, con por qué lo parece. */
export interface Candidata {
  readonly encabezado: string;
  readonly indice: number;
  readonly puntaje: number;
  readonly motivo: string;
}

/**
 * Resultado del mapeo para un campo. Ver `mapeo.ts`.
 *
 * `requiereConfirmacion` y `resuelto` son funciones en `mapeo.ts`, por la misma
 * razón que en `Nota`: esto viaja hacia el reporte y la interfaz como objeto
 * plano.
 */
export interface Asignacion {
  readonly campo: string;
  readonly encabezado: string | null;
  readonly indice: number | null;
  readonly confianza: Confianza;
  readonly candidatas: readonly Candidata[];
  readonly motivo: string;
}

/** Una fila del archivo del docente, ya diagnosticada. */
export interface FilaAnalizada {
  readonly numero: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly nota: Nota;
  readonly problemas: readonly string[];
  readonly avisos: readonly string[];
}

/** Resultado completo de examinar un archivo. */
export interface Analisis {
  readonly tabla: Tabla;
  readonly mapa: ReadonlyMap<string, Asignacion>;
  readonly indiceNota: number;
  readonly filas: readonly FilaAnalizada[];
}

/** Una modificación concreta, con su antes y su después (regla de oro 4). */
export interface Cambio {
  readonly fila: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly antes: string;
  readonly despues: string;
  readonly motivo: string;
}

/**
 * Una fila que impide generar el archivo, y por qué.
 *
 * El mismo tipo sirve para los descartes: una fila excluida por decisión del
 * docente no bloquea, pero tiene que aparecer igual. La regla de oro 2 exige
 * que ninguna fila desaparezca en silencio.
 */
export interface Bloqueo {
  readonly fila: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly valor: string;
  readonly estado: string;
  readonly motivo: string;
}
