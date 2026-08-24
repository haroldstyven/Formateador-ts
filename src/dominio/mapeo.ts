/**
 * Mapeo de columnas: qué columna del archivo del docente es cuál.
 *
 * Primeros dos niveles de la cascada de `plan.md` §4 —diccionario de alias y
 * coincidencia difusa— sin LLM y sin dependencias externas. El tercer nivel
 * (modelo como último recurso) se conecta después, a través del puerto
 * `SugeridorDeColumnas`; este módulo ya expone lo que necesita para hacerlo:
 * qué quedó sin resolver y con qué confianza.
 *
 * La restricción que manda sobre todo lo demás (§4.0): el archivo del docente
 * tiene cuatro columnas numéricas en escala 0.0 a 5.0 —trabajos, quizes, examen
 * y definitiva— y **elegir mal no produce ningún síntoma**. El archivo sale con
 * formato impecable, Banner lo acepta, y el curso queda calificado con las
 * notas del parcial. Por eso:
 *
 *   - La lista `descartar` es autoritativa: una columna descartada nunca es
 *     candidata, por alto que sea su parecido.
 *   - Los alias `debiles` nunca producen confianza alta.
 *   - `nota_definitiva` lleva confirmación obligatoria del docente, aunque el
 *     mapeo esté seguro. Es el único punto del flujo donde preguntar es
 *     preferible a acertar.
 *
 * Port de `formateador/mapeo.py`. La coincidencia difusa usa `similitud.ts`,
 * que reproduce `difflib.SequenceMatcher` exactamente: los umbrales de aquí no
 * están recalibrados, son los mismos números con el mismo significado.
 *
 * Igual que en `valores.ts`, no hay `desdeJson`: el catálogo entra ya parseado.
 */

import type { Asignacion, Candidata, Confianza } from "./modelo.ts";
import { ratio } from "./similitud.ts";

export const UMBRAL_ALTO = 0.9;
export const UMBRAL_MINIMO = 0.78;
/** Distancia a la segunda candidata para poder confiar en la primera. */
export const MARGEN_MINIMO = 0.08;

export const CAMPO_NOTA = "nota_definitiva";
export const CAMPO_CODIGO = "codigo_estudiante";
export const CAMPO_NOMBRE = "nombre_estudiante";

/** Campos cuya elección siempre confirma una persona, por segura que sea. */
export const CONFIRMACION_OBLIGATORIA: ReadonlySet<string> = new Set([CAMPO_NOTA]);

const NO_ALFANUMERICO = /[^a-z0-9]+/g;

/**
 * Reduce un encabezado a una forma comparable.
 *
 * "Código de Estudiante", "CODIGO_ESTUDIANTE" y "codigo  de  estudiante" son el
 * mismo encabezado.
 */
export function normalizarEncabezado(texto: unknown): string {
  if (texto === null || texto === undefined) return "";
  const sinTildes = String(texto).normalize("NFKD").replace(/\p{M}/gu, "");
  return sinTildes.toLowerCase().replace(NO_ALFANUMERICO, " ").trim();
}

/** Si es `true`, no se genera nada sin que una persona lo apruebe. */
export function requiereConfirmacion(asignacion: Asignacion): boolean {
  return (
    CONFIRMACION_OBLIGATORIA.has(asignacion.campo) || asignacion.confianza !== "alta"
  );
}

export function resuelto(asignacion: Asignacion): boolean {
  return asignacion.indice !== null;
}

interface AliasDeCampo {
  readonly exactos: readonly string[];
  readonly debiles: readonly string[];
}

/** Alias por campo y lista de descarte, tal como vienen de `config/`. */
export class CatalogoAlias {
  readonly campos: ReadonlyMap<string, AliasDeCampo>;
  readonly descartar: readonly string[];

  constructor(
    campos: Record<string, { exactos?: string[]; debiles?: string[] }>,
    descartar: readonly string[] = [],
  ) {
    const mapa = new Map<string, AliasDeCampo>();
    for (const [campo, cfg] of Object.entries(campos)) {
      mapa.set(campo, {
        exactos: (cfg.exactos ?? []).map(normalizarEncabezado),
        debiles: (cfg.debiles ?? []).map(normalizarEncabezado),
      });
    }
    this.campos = mapa;
    this.descartar = descartar.filter(Boolean).map(normalizarEncabezado);
  }

  static desdeObjeto(datos: unknown): CatalogoAlias {
    const raiz = (datos ?? {}) as {
      campos?: Record<string, { exactos?: string[]; debiles?: string[] }>;
      descartar?: string[];
    };
    return new CatalogoAlias(raiz.campos ?? {}, raiz.descartar ?? []);
  }

  /**
   * Indica si el encabezado nombra una columna que nunca es candidata.
   *
   * Se compara por palabras completas: "nota examen" queda descartada por
   * contener `examen`, pero "nota definitiva" no.
   */
  esDescartada(encabezado: unknown): boolean {
    const normalizado = ` ${normalizarEncabezado(encabezado)} `;
    return this.descartar.some((token) => normalizado.includes(` ${token} `));
  }

  /**
   * Si el encabezado suena a algo del catálogo. Lo usa el lector para detectar
   * la fila de encabezados cuando no está en la fila 1.
   */
  aliasConocido(encabezado: unknown): boolean {
    const normalizado = normalizarEncabezado(encabezado);
    if (!normalizado) return false;
    if (this.esDescartada(encabezado)) return true;
    for (const cfg of this.campos.values()) {
      if (cfg.exactos.includes(normalizado) || cfg.debiles.includes(normalizado)) {
        return true;
      }
    }
    return false;
  }
}

function candidatasPara(
  campo: string,
  encabezados: readonly unknown[],
  catalogo: CatalogoAlias,
): Candidata[] {
  const cfg = catalogo.campos.get(campo) ?? { exactos: [], debiles: [] };
  const encontradas: Candidata[] = [];

  encabezados.forEach((bruto, indice) => {
    const normalizado = normalizarEncabezado(bruto);
    if (!normalizado || catalogo.esDescartada(bruto)) return;

    const texto = String(bruto);

    if (cfg.exactos.includes(normalizado)) {
      encontradas.push({ encabezado: texto, indice, puntaje: 1.0, motivo: "alias exacto" });
      return;
    }

    if (cfg.debiles.includes(normalizado)) {
      // Nunca llega al umbral alto: es plausible, no seguro.
      encontradas.push({ encabezado: texto, indice, puntaje: 0.85, motivo: "alias débil" });
      return;
    }

    let mejor = 0.0;
    for (const alias of cfg.exactos) {
      const r = ratio(normalizado, alias);
      if (r > mejor) mejor = r;
    }
    if (mejor >= UMBRAL_MINIMO) {
      encontradas.push({
        encabezado: texto,
        indice,
        puntaje: mejor * 0.95,
        motivo: `coincidencia difusa (${mejor.toFixed(2)})`,
      });
    }
  });

  return encontradas.sort((x, y) => y.puntaje - x.puntaje || x.indice - y.indice);
}

/** Asigna cada campo a una columna, o declara que no pudo. */
export function mapear(
  encabezados: readonly unknown[],
  catalogo: CatalogoAlias,
): Map<string, Asignacion> {
  const resultado = new Map<string, Asignacion>();

  for (const campo of catalogo.campos.keys()) {
    const candidatas = candidatasPara(campo, encabezados, catalogo);

    if (candidatas.length === 0) {
      resultado.set(campo, {
        campo,
        encabezado: null,
        indice: null,
        confianza: "nula",
        candidatas: [],
        motivo: "ninguna columna se parece",
      });
      continue;
    }

    const mejor = candidatas[0]!;
    const segunda = candidatas[1];
    const margen = mejor.puntaje - (segunda ? segunda.puntaje : 0.0);

    let confianza: Confianza;
    let motivo: string;

    if (mejor.puntaje >= UMBRAL_ALTO && (candidatas.length === 1 || margen >= MARGEN_MINIMO)) {
      confianza = "alta";
      motivo = mejor.motivo;
    } else if (segunda && margen < MARGEN_MINIMO) {
      confianza = "media";
      motivo =
        `'${mejor.encabezado}' y '${segunda.encabezado}' se parecen ` +
        "demasiado entre sí para elegir sin preguntar";
    } else {
      confianza = "media";
      motivo = mejor.motivo;
    }

    resultado.set(campo, {
      campo,
      encabezado: mejor.encabezado,
      indice: mejor.indice,
      confianza,
      candidatas,
      motivo,
    });
  }

  return resultado;
}

/**
 * Qué tanto una fila parece ser la fila de encabezados.
 *
 * La usa el lector para encontrar el encabezado cuando no está en la fila 1.
 */
export function puntajeEncabezado(
  textos: readonly unknown[],
  catalogo: CatalogoAlias,
): number {
  let conocidos = 0;
  let textuales = 0;
  for (const t of textos) {
    if (catalogo.aliasConocido(t === null || t === undefined ? "" : String(t))) {
      conocidos++;
    }
    if (typeof t === "string" && t.trim()) textuales++;
  }
  return conocidos + textuales * 0.1;
}

/**
 * Texto del paso de confirmación de `plan.md` §5.
 *
 * El docente no confirma un nombre de columna: confirma unos valores. Ver el
 * encabezado y los primeros datos juntos es lo que hace evidente que se eligió
 * `examen` en vez de `definitiva`.
 */
export function resumenParaConfirmar(
  asignacion: Asignacion,
  muestra: readonly string[],
): string {
  const campoLegible = asignacion.campo.replaceAll("_", " ");
  if (!resuelto(asignacion)) {
    return `No encontré la columna de ${campoLegible}. Indícame cuál es.`;
  }
  const valores = muestra.length ? muestra.join(" · ") : "(sin datos)";
  return (
    `Voy a usar la columna '${asignacion.encabezado}' como ${campoLegible}. ` +
    `Primeros valores: ${valores}. ¿Es correcto?`
  );
}
