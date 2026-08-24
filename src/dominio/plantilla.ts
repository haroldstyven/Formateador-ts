/**
 * La plantilla oficial de Banner: su contrato, su modelo y el cruce.
 *
 * Con la plantilla real en mano, la arquitectura preferible de `plan.md` §2.1
 * queda confirmada: **esto no es una conversión de formato, es un cruce por
 * identificador**. Banner exporta el listado del curso con 13 columnas; la
 * herramienta escribe **una sola** —`Final Grade`— y no toca ninguna otra.
 *
 * Eso elimina de raíz tres clases enteras de error, porque la estructura la
 * pone Banner y nosotros solo rellenamos una casilla:
 *
 *   - orden de filas         (irrelevante: se cruza por Student ID)
 *   - estudiantes faltantes  (los pone la plantilla, no el docente)
 *   - estudiantes sobrantes  (quien no esté en la plantilla, no está en el curso)
 *
 * Port de la parte pura de `formateador/plantilla.py`. Leer y escribir el
 * `.xlsx` vive en `adaptadores/salida/plantilla-zip.ts`: en la referencia están
 * en el mismo módulo, aquí no, porque el cruce es lógica de dominio y abrir un
 * libro es I/O.
 */

import type { Analisis, FilaAnalizada } from "./modelo.ts";
import { bloquea } from "./analisis.ts";
import { formatear } from "./redondeo.ts";

const NO_ALFANUMERICO = /[^A-Z0-9]/g;

/** El archivo no tiene la forma de una plantilla de Banner. */
export class PlantillaInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "PlantillaInvalida";
  }
}

/** El cruce dejó filas sin resolver: no se emite nada. */
export class NoSePuedeGenerar extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "NoSePuedeGenerar";
  }
}

// ---------------------------------------------------------------------------
// Esquema
// ---------------------------------------------------------------------------

/** El contrato de la plantilla, tal como vive en `config/schema_banner.json`. */
export interface EsquemaBanner {
  readonly hoja: string;
  readonly filaEncabezado: number;
  readonly columnaClave: string;
  readonly columnaNota: string;
  readonly columnaNombre: string;
  readonly columnaRolled: string;
  readonly columnaConfidencial: string;
  readonly escribirNotaComo: string;
  readonly formatoCeldaNota: string;
  readonly valorRolledBloquea: string;
  readonly encabezados: readonly string[];
  readonly version: number;
  readonly estado: string;
}

export const ESQUEMA_POR_DEFECTO: EsquemaBanner = {
  hoja: "Grades",
  filaEncabezado: 1,
  columnaClave: "Student ID",
  columnaNota: "Final Grade",
  columnaNombre: "Full Name",
  columnaRolled: "Rolled",
  columnaConfidencial: "Confidential",
  escribirNotaComo: "texto",
  formatoCeldaNota: "@",
  valorRolledBloquea: "Yes",
  encabezados: [],
  version: 0,
  estado: "",
};

export function esquemaDesdeObjeto(datos: unknown): EsquemaBanner {
  const d = (datos ?? {}) as Record<string, unknown>;
  const columnas = (d["columnas"] ?? []) as { encabezado?: string }[];
  const texto = (clave: string, porDefecto: string): string =>
    typeof d[clave] === "string" ? (d[clave] as string) : porDefecto;

  return {
    hoja: texto("hoja", ESQUEMA_POR_DEFECTO.hoja),
    filaEncabezado:
      typeof d["fila_encabezado"] === "number"
        ? d["fila_encabezado"]
        : ESQUEMA_POR_DEFECTO.filaEncabezado,
    columnaClave: texto("columna_clave", ESQUEMA_POR_DEFECTO.columnaClave),
    columnaNota: texto("columna_nota", ESQUEMA_POR_DEFECTO.columnaNota),
    columnaNombre: texto("columna_nombre", ESQUEMA_POR_DEFECTO.columnaNombre),
    columnaRolled: texto("columna_rolled", ESQUEMA_POR_DEFECTO.columnaRolled),
    columnaConfidencial: texto(
      "columna_confidencial",
      ESQUEMA_POR_DEFECTO.columnaConfidencial,
    ),
    escribirNotaComo: texto("escribir_nota_como", ESQUEMA_POR_DEFECTO.escribirNotaComo),
    formatoCeldaNota: texto("formato_celda_nota", ESQUEMA_POR_DEFECTO.formatoCeldaNota),
    valorRolledBloquea: texto(
      "valor_rolled_bloquea",
      ESQUEMA_POR_DEFECTO.valorRolledBloquea,
    ),
    encabezados: columnas.map((c) => c.encabezado ?? "").filter(Boolean),
    version: typeof d["version"] === "number" ? d["version"] : 0,
    estado: typeof d["_estado"] === "string" ? d["_estado"] : "",
  };
}

/** Si un archivo generado por la herramienta ya fue aceptado por Banner. */
export function verificadoContraBanner(esquema: EsquemaBanner): boolean {
  return !esquema.estado.toUpperCase().includes("PENDIENTE");
}

// ---------------------------------------------------------------------------
// Modelo de la plantilla
// ---------------------------------------------------------------------------

/** Un estudiante del listado que Banner exportó. */
export interface FilaPlantilla {
  readonly fila: number;
  readonly identificador: string;
  readonly nombre: string;
  readonly rolled: boolean;
  readonly confidencial: boolean;
  readonly notaExistente: string;
}

export function tieneNota(fila: FilaPlantilla): boolean {
  return fila.notaExistente.trim() !== "";
}

/** La plantilla exportada por Banner, ya leída. */
export interface Plantilla {
  /** Identidad del archivo, para poder compararlo con `Tabla.origen`. */
  readonly origen: string;
  readonly esquema: EsquemaBanner;
  readonly columnas: ReadonlyMap<string, number>;
  readonly filas: readonly FilaPlantilla[];
  readonly control: ReadonlyMap<string, string>;
}

export function curso(p: Plantilla): string {
  return p.control.get("Course") ?? "";
}

export function periodo(p: Plantilla): string {
  return p.control.get("Term Code") ?? "";
}

export function crn(p: Plantilla): string {
  return p.control.get("CRN") ?? "";
}

export function descripcion(p: Plantilla): string {
  const partes = [curso(p), periodo(p), crn(p) ? `CRN ${crn(p)}` : ""].filter(Boolean);
  return partes.join(" · ");
}

/**
 * Clave de cruce: mayúsculas, sin espacios ni signos.
 *
 * "T00012345", "t00012345" y "T-000 12345" son el mismo estudiante. No se
 * quitan ceros a la izquierda: en Banner son parte del identificador.
 */
export function normalizarIdentificador(valor: unknown): string {
  const texto = valor === null || valor === undefined || valor === false ? "" : String(valor);
  return texto.toUpperCase().replace(NO_ALFANUMERICO, "");
}

// ---------------------------------------------------------------------------
// Cruce
// ---------------------------------------------------------------------------

/** Un estudiante de la plantilla con la nota que le corresponde. */
export interface Emparejamiento {
  readonly plantilla: FilaPlantilla;
  readonly origen: FilaAnalizada;
  readonly identificadorNormalizado: boolean;
}

export function notaTexto(e: Emparejamiento): string {
  return formatear(e.origen.nota.valor);
}

/** Resultado de casar el archivo del docente con el listado de Banner. */
export interface Cruce {
  readonly plantilla: Plantilla;
  readonly emparejados: readonly Emparejamiento[];
  readonly sinNota: readonly FilaPlantilla[];
  readonly yaConsolidados: readonly Emparejamiento[];
  readonly sobrantes: readonly FilaAnalizada[];
  readonly pendientes: readonly FilaAnalizada[];
  readonly mismoArchivo: boolean;
}

/**
 * Estudiantes que ya tenían nota en Banner y se les va a cambiar.
 *
 * Vacío cuando el docente subió la propia plantilla diligenciada: ahí lo que
 * hay en `Final Grade` es lo que él acaba de escribir, no una nota previa de
 * Banner. Avisar de un reemplazo inexistente asusta sin motivo.
 */
export function sobrescribenNota(cruce: Cruce): Emparejamiento[] {
  if (cruce.mismoArchivo) return [];
  return cruce.emparejados.filter((e) => tieneNota(e.plantilla));
}

/** Todo el curso debe quedar calificado: un cargue a medias parece completo. */
export function puedeGenerarCruce(cruce: Cruce): boolean {
  return (
    cruce.emparejados.length > 0 &&
    cruce.sinNota.length === 0 &&
    cruce.pendientes.length === 0 &&
    cruce.yaConsolidados.length === 0
  );
}

export function motivosDeBloqueo(cruce: Cruce): string[] {
  const motivos: string[] = [];
  if (cruce.pendientes.length) {
    motivos.push(`${cruce.pendientes.length} nota(s) del archivo esperan una decisión tuya.`);
  }
  if (cruce.sinNota.length) {
    motivos.push(
      `${cruce.sinNota.length} estudiante(s) del curso no tienen nota en tu archivo.`,
    );
  }
  if (cruce.yaConsolidados.length) {
    motivos.push(
      `${cruce.yaConsolidados.length} estudiante(s) ya tienen la nota consolidada ` +
        "en historia académica y no se pueden modificar desde aquí.",
    );
  }
  if (cruce.emparejados.length === 0) {
    motivos.push("Ningún estudiante del archivo coincide con el listado de Banner.");
  }
  return motivos;
}

/**
 * Casa cada estudiante de la plantilla con su nota en el archivo del docente.
 *
 * El cruce es por identificador, nunca por posición: el orden del archivo del
 * docente es irrelevante y no se le exige que coincida con el de Banner.
 */
export function cruzar(analisis: Analisis, plantilla: Plantilla): Cruce {
  const porClave = new Map<string, FilaAnalizada>();
  for (const fila of analisis.filas) {
    const clave = normalizarIdentificador(fila.codigo);
    // El primero gana: un duplicado en el archivo del docente no reemplaza en
    // silencio al que ya se tomó. `flujo` lo reporta aparte como problema.
    if (clave && !porClave.has(clave)) porClave.set(clave, fila);
  }

  const emparejados: Emparejamiento[] = [];
  const yaConsolidados: Emparejamiento[] = [];
  const sinNota: FilaPlantilla[] = [];
  const pendientes: FilaAnalizada[] = [];
  const usadas = new Set<string>();

  for (const estudiante of plantilla.filas) {
    const clave = normalizarIdentificador(estudiante.identificador);
    const origen = porClave.get(clave);

    if (origen === undefined) {
      sinNota.push(estudiante);
      continue;
    }

    usadas.add(clave);

    if (bloquea(origen) || origen.nota.valor === null) {
      pendientes.push(origen);
      continue;
    }

    const emparejamiento: Emparejamiento = {
      plantilla: estudiante,
      origen,
      identificadorNormalizado: clave !== estudiante.identificador.trim().toUpperCase(),
    };
    (estudiante.rolled ? yaConsolidados : emparejados).push(emparejamiento);
  }

  const sobrantes = analisis.filas.filter(
    (f) => f.codigo && !usadas.has(normalizarIdentificador(f.codigo)),
  );

  return {
    plantilla,
    emparejados,
    sinNota,
    yaConsolidados,
    sobrantes,
    pendientes,
    mismoArchivo:
      analisis.tabla.origen !== null && analisis.tabla.origen === plantilla.origen,
  };
}
