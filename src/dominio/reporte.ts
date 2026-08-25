/**
 * Reporte y diff: mostrar el trabajo, no solo el resultado.
 *
 * Implementa la regla de oro 4 (`plan.md` §4): ninguna nota se modifica en
 * silencio. Cada redondeo, cada sustitución autorizada y cada corrección de
 * formato aparece con su valor original al lado del final.
 *
 * La restricción que gobierna este módulo (§4.4): **la prosa nunca es la fuente
 * de verdad**. Todo lo que se lee aquí se genera a partir del registro que
 * produjo el motor determinista, nunca al revés, y el diff literal se muestra
 * siempre junto a la explicación.
 *
 * Port de `formateador/reporte.py`. Es un módulo de funciones, no una clase:
 * la referencia usa `@property` sobre un objeto con estado, y aquí el estado
 * —el análisis— entra por parámetro.
 */

import type { Analisis, Bloqueo, Cambio, Estado, FilaAnalizada } from "./modelo.ts";
import {
  bloqueadas,
  descartadas,
  listas,
  modificadas,
  motivoBloqueo,
  puedeGenerar,
  total,
} from "./analisis.ts";
import { CAMPO_CODIGO, CAMPO_NOMBRE, CAMPO_NOTA } from "./mapeo.ts";
import { formatear } from "./redondeo.ts";

export const ESTADOS_LEGIBLES: Readonly<Record<Estado, string>> = {
  ok: "sin cambios",
  redondeada: "redondeada",
  sustituida: "sustituida por decisión del docente",
  vacia: "sin calificar",
  no_numerica: "valor no numérico",
  fuera_de_rango: "fuera de la escala 0.0 a 5.0",
  formula_sin_calcular: "fórmula sin calcular",
  descartada: "fila descartada por decisión del docente",
};

/**
 * Todo lo que la herramienta tocó. Es el diff que ve el docente.
 *
 * `despues` sale de `formatear`, no de la representación del decimal: es
 * exactamente el texto que se va a escribir en `Final Grade`, así que el diff
 * muestra lo que va a pasar y no una aproximación de lo que va a pasar.
 */
export function cambios(analisis: Analisis): Cambio[] {
  return modificadas(analisis).map((f) => ({
    fila: f.numero,
    codigo: f.codigo,
    nombre: f.nombre,
    antes: f.nota.original,
    despues: f.nota.valor === null ? "" : formatear(f.nota.valor),
    motivo: f.nota.detalle,
  }));
}

export function bloqueos(analisis: Analisis): Bloqueo[] {
  return bloqueadas(analisis).map((f) => ({
    fila: f.numero,
    codigo: f.codigo,
    nombre: f.nombre,
    valor: f.nota.original,
    estado: ESTADOS_LEGIBLES[f.nota.estado] ?? f.nota.estado,
    motivo: motivoBloqueo(f),
  }));
}

/**
 * Filas excluidas por decisión del docente, con su motivo.
 *
 * La regla de oro 2 exige que ninguna fila desaparezca en silencio: si se
 * descarta, aparece aquí.
 */
export function descartes(analisis: Analisis): Bloqueo[] {
  return descartadas(analisis).map((f) => ({
    fila: f.numero,
    codigo: f.codigo,
    nombre: f.nombre,
    valor: f.nota.original,
    estado: ESTADOS_LEGIBLES.descartada,
    motivo: f.nota.detalle,
  }));
}

/** Advertencias que no bloquean pero que conviene mirar. */
export function avisos(analisis: Analisis): string[] {
  const salida = [...analisis.tabla.incidencias];
  for (const fila of analisis.filas) {
    for (const aviso of fila.avisos) salida.push(`Fila ${fila.numero}: ${aviso}`);
  }
  return salida;
}

export interface Resumen {
  readonly filas_leidas: number;
  readonly listas_para_cargar: number;
  readonly requieren_decision: number;
  readonly descartadas_por_el_docente: number;
  readonly notas_redondeadas: number;
  readonly notas_sustituidas: number;
  readonly sin_cambios: number;
  readonly sin_calificar: number;
  readonly no_numericas: number;
  readonly fuera_de_rango: number;
  readonly formulas_sin_calcular: number;
}

export function resumen(analisis: Analisis): Resumen {
  const conteo = (estado: Estado): number =>
    analisis.filas.filter((f) => f.nota.estado === estado).length;

  return {
    filas_leidas: total(analisis),
    listas_para_cargar: listas(analisis).length,
    requieren_decision: bloqueadas(analisis).length,
    descartadas_por_el_docente: descartadas(analisis).length,
    notas_redondeadas: conteo("redondeada"),
    notas_sustituidas: conteo("sustituida"),
    sin_cambios: conteo("ok"),
    sin_calificar: conteo("vacia"),
    no_numericas: conteo("no_numerica"),
    fuera_de_rango: conteo("fuera_de_rango"),
    formulas_sin_calcular: conteo("formula_sin_calcular"),
  };
}

export interface ReglasDeOro {
  readonly conservacion_de_filas: boolean;
  readonly toda_nota_emitida_tiene_origen: boolean;
  readonly toda_modificacion_esta_registrada: boolean;
  readonly ninguna_nota_fuera_de_escala: boolean;
  readonly toda_nota_tiene_un_solo_decimal: boolean;
  readonly ninguna_sin_nota_se_volvio_cero: boolean;
}

/**
 * Comprueba las reglas de oro sobre este archivo concreto.
 *
 * No sustituye a la suite de tests: la complementa mostrando, sobre los datos
 * reales del docente, que las invariantes se cumplen. Es lo que se enseña en la
 * demo (`plan.md` Fase 7, punto 4).
 */
export function verificarReglas(analisis: Analisis): ReglasDeOro {
  const filas = analisis.filas;
  const emitidas = filas.filter((f) => f.nota.valor !== null);
  const origenLegitimo: ReadonlySet<Estado> = new Set<Estado>([
    "ok",
    "redondeada",
    "sustituida",
  ]);
  const sinNota: ReadonlySet<Estado> = new Set<Estado>([
    "vacia",
    "formula_sin_calcular",
    "no_numerica",
  ]);
  const modificables: ReadonlySet<Estado> = new Set<Estado>(["redondeada", "sustituida"]);
  const registradas = new Set(modificadas(analisis).map((f) => f.numero));

  return {
    // Regla 2: entrada == salida + descartadas reportadas.
    conservacion_de_filas:
      total(analisis) ===
      listas(analisis).length + bloqueadas(analisis).length + descartadas(analisis).length,

    // Regla 3: toda nota emitida viene de la entrada o de una decisión.
    toda_nota_emitida_tiene_origen: emitidas.every((f) =>
      origenLegitimo.has(f.nota.estado),
    ),

    // Regla 4: nada se modificó en silencio.
    toda_modificacion_esta_registrada: filas
      .filter((f) => modificables.has(f.nota.estado))
      .every((f) => registradas.has(f.numero)),

    // Regla 1: la salida respeta la escala y el decimal declarados.
    ninguna_nota_fuera_de_escala: emitidas.every(
      (f) => f.nota.valor!.gte(0) && f.nota.valor!.lte(5),
    ),
    toda_nota_tiene_un_solo_decimal: emitidas.every(
      (f) => f.nota.valor!.decimalPlaces() <= 1,
    ),

    // El riesgo central: una celda sin nota jamás vale 0.0.
    ninguna_sin_nota_se_volvio_cero: filas
      .filter((f) => sinNota.has(f.nota.estado))
      .every((f) => f.nota.valor === null),
  };
}

export interface Reporte {
  readonly generado: string;
  readonly archivo: {
    readonly hoja: string;
    readonly fila_encabezado: number;
    readonly encabezados: readonly string[];
  };
  readonly mapeo: Record<string, { columna: string | null; confianza: string; motivo: string }>;
  readonly politica_redondeo: {
    readonly decimales: number;
    readonly modo: string;
    readonly escala: string;
    readonly aprobacion: string;
  };
  readonly resumen: Resumen;
  readonly reglas_de_oro: ReglasDeOro;
  readonly cambios: readonly Cambio[];
  readonly bloqueos: readonly Bloqueo[];
  readonly descartes: readonly Bloqueo[];
  readonly avisos: readonly string[];
  readonly puede_generar: boolean;
}

export interface OpcionesReporte {
  /** Inyectable para que el reporte sea reproducible en los tests. */
  readonly generado?: string;
}

export function construirReporte(
  analisis: Analisis,
  opciones: OpcionesReporte = {},
): Reporte {
  const mapeo: Reporte["mapeo"] = {};
  for (const campo of [CAMPO_CODIGO, CAMPO_NOTA, CAMPO_NOMBRE]) {
    const asignacion = analisis.mapa.get(campo);
    if (!asignacion) continue;
    mapeo[campo] = {
      columna: asignacion.encabezado,
      confianza: asignacion.confianza,
      motivo: asignacion.motivo,
    };
  }

  return {
    generado: opciones.generado ?? new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
    archivo: {
      hoja: analisis.tabla.hoja,
      fila_encabezado: analisis.tabla.filaEncabezado,
      encabezados: analisis.tabla.encabezados,
    },
    mapeo,
    politica_redondeo: {
      decimales: 1,
      modo: "ROUND_HALF_UP",
      escala: "0.0 a 5.0",
      aprobacion: "3.0",
    },
    resumen: resumen(analisis),
    reglas_de_oro: verificarReglas(analisis),
    cambios: cambios(analisis),
    bloqueos: bloqueos(analisis),
    descartes: descartes(analisis),
    avisos: avisos(analisis),
    puede_generar: puedeGenerar(analisis),
  };
}

export function reporteAJson(reporte: Reporte, indent = 2): string {
  return JSON.stringify(reporte, null, indent);
}

/** El reporte en texto plano, para la CLI. */
export function reporteATexto(analisis: Analisis): string {
  const r = resumen(analisis);
  const lineas: string[] = [
    `Filas leídas: ${r.filas_leidas}`,
    `Listas para cargar: ${r.listas_para_cargar}`,
    `Requieren decisión: ${r.requieren_decision}`,
    "",
  ];

  const losCambios = cambios(analisis);
  if (losCambios.length) {
    lineas.push(`Cambios (${losCambios.length}):`);
    for (const c of losCambios) {
      lineas.push(
        `  fila ${c.fila}  ${c.codigo}  ${c.antes} -> ${c.despues}   ${c.motivo}`,
      );
    }
    lineas.push("");
  }

  const losBloqueos = bloqueos(analisis);
  if (losBloqueos.length) {
    lineas.push(`Pendientes de decisión (${losBloqueos.length}):`);
    for (const b of losBloqueos) {
      lineas.push(`  fila ${b.fila}  ${b.codigo}  '${b.valor}'  [${b.estado}]  ${b.motivo}`);
    }
    lineas.push("");
  }

  const losDescartes = descartes(analisis);
  if (losDescartes.length) {
    lineas.push(`Descartadas por decisión del docente (${losDescartes.length}):`);
    for (const d of losDescartes) {
      lineas.push(`  fila ${d.fila}  ${d.codigo}  '${d.valor}'  ${d.motivo}`);
    }
    lineas.push("");
  }

  const losAvisos = avisos(analisis);
  if (losAvisos.length) {
    lineas.push("Avisos:");
    for (const a of losAvisos) lineas.push(`  - ${a}`);
    lineas.push("");
  }

  lineas.push(
    puedeGenerar(analisis)
      ? "El archivo se puede generar."
      : "NO se genera el archivo hasta resolver los pendientes.",
  );
  return lineas.join("\n");
}

/** Reexportado para que quien construya el reporte no importe dos módulos. */
export type { FilaAnalizada };
