/**
 * El caso de uso. Orquesta el hexágono y no sabe nada de Excel, de HTTP ni de
 * React: recibe puertos, devuelve un resultado.
 *
 * Reúne lo que en la referencia está repartido entre `analizar_archivo`, la
 * detección de plantilla de `app.py` y el cruce de `plantilla.py`.
 *
 * Contrato que no se negocia:
 *   - Si algo queda sin resolver, `archivo` sale en `null`. No se emite un
 *     archivo a medias (riesgo `B-11`: una celda vacía puede borrar una nota
 *     que ya estaba cargada en Banner).
 *   - Mientras el docente no confirme la columna de nota, tampoco hay archivo.
 *     Es la restricción §4.0, y es el único punto del flujo donde preguntar es
 *     preferible a acertar.
 *   - Todo redondeo aparece en `cambios` (regla de oro 4).
 */

import type { Analisis } from "@dominio/modelo.ts";
import { CAMPO_NOTA, resumenParaConfirmar } from "@dominio/mapeo.ts";
import { analizar } from "@dominio/flujo.ts";
import { muestra } from "@dominio/tabla.ts";
import { type Reporte, construirReporte } from "@dominio/reporte.ts";
import {
  type Cruce,
  type Plantilla,
  cruzar,
  crn,
  motivosDeBloqueo,
  puedeGenerarCruce,
} from "@dominio/plantilla.ts";
import type { ConfigValores } from "@dominio/valores.ts";
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
  readonly columnaCodigoConfirmada?: number;
  /** Decisiones tomadas sobre los valores no numéricos pendientes. */
  readonly config?: ConfigValores;
  /** Inyectable para que el reporte sea reproducible en los tests. */
  readonly generado?: string;
}

/** Falta un archivo, o sobra, o no se sabe cuál es cuál. */
export class EntradaIncompleta extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "EntradaIncompleta";
  }
}

/**
 * Los dos caminos de §5.0, resueltos sin preguntarle al docente cuál es.
 *
 * A · sube la plantilla de Banner ya diligenciada — un solo archivo, y el cruce
 *     es trivial porque cada estudiante casa consigo mismo.
 * B · sube su propio Excel — entonces hace falta además la plantilla del curso.
 */
export interface Clasificacion {
  readonly plantilla: ArchivoEntrante;
  readonly notas: ArchivoEntrante;
  readonly mismoArchivo: boolean;
}

export async function clasificar(
  deps: Dependencias,
  archivos: readonly ArchivoEntrante[],
): Promise<Clasificacion> {
  if (archivos.length === 0) {
    throw new EntradaIncompleta("No subiste ningún archivo.");
  }
  if (archivos.length > 2) {
    throw new EntradaIncompleta(
      `Subiste ${archivos.length} archivos. Necesito uno o dos: tu archivo de ` +
        "notas y, si ese no es la plantilla de Banner, la plantilla del curso.",
    );
  }

  const marcas = await Promise.all(
    archivos.map(async (archivo) => ({
      archivo,
      esPlantilla: await deps.lector.esPlantillaBanner(archivo),
    })),
  );
  const plantillas = marcas.filter((m) => m.esPlantilla).map((m) => m.archivo);
  const propios = marcas.filter((m) => !m.esPlantilla).map((m) => m.archivo);

  if (plantillas.length === 0) {
    throw new EntradaIncompleta(
      "Ninguno de los archivos es la plantilla que exporta Banner. Descárgala " +
        "desde Banner y súbela junto con tu archivo de notas.",
    );
  }

  // Camino A: un solo archivo, y es la plantilla ya diligenciada.
  if (archivos.length === 1) {
    return { plantilla: plantillas[0]!, notas: plantillas[0]!, mismoArchivo: true };
  }

  if (propios.length === 0) {
    throw new EntradaIncompleta(
      "Los dos archivos son plantillas de Banner. Sube tu archivo de notas y " +
        "la plantilla del curso, no dos plantillas.",
    );
  }

  return { plantilla: plantillas[0]!, notas: propios[0]!, mismoArchivo: false };
}

export interface ResultadoCompleto extends ResultadoFormateo {
  readonly reporte: Reporte;
  readonly cruce: Cruce;
  readonly plantilla: Plantilla;
  readonly clasificacion: Clasificacion;
  /**
   * El texto del paso de confirmación de §4.0, o `null` si el docente ya
   * confirmó la columna. Mientras no sea `null`, `archivo` es `null`.
   */
  readonly confirmacionPendiente: string | null;
}

export async function formatearNotas(
  deps: Dependencias,
  peticion: PeticionDeFormateo,
): Promise<ResultadoCompleto> {
  const catalogo = await deps.config.catalogoDeAlias();
  const clasificacion = await clasificar(deps, peticion.archivos);

  const tablaLeida = await deps.lector.leer(clasificacion.notas);
  // El origen lo pone el caso de uso, no el lector: es lo que permite al cruce
  // saber si el archivo del docente y la plantilla son el mismo (§5.0).
  const tabla = {
    ...tablaLeida,
    origen: clasificacion.mismoArchivo
      ? clasificacion.plantilla.nombre
      : clasificacion.notas.nombre,
  };

  const analisis: Analisis = analizar(tabla, catalogo, {
    ...(peticion.config ? { config: peticion.config } : {}),
    ...(peticion.columnaNotaConfirmada !== undefined
      ? { indiceNota: peticion.columnaNotaConfirmada }
      : {}),
    ...(peticion.columnaCodigoConfirmada !== undefined
      ? { indiceCodigo: peticion.columnaCodigoConfirmada }
      : {}),
  });

  const plantilla = await deps.plantillas.leer(clasificacion.plantilla);
  const cruce = cruzar(analisis, plantilla);
  const reporte = construirReporte(analisis, {
    ...(peticion.generado ? { generado: peticion.generado } : {}),
  });

  // §4.0: la columna de nota siempre la confirma una persona, por segura que
  // esté la cascada. Cinco segundos contra un curso mal calificado.
  const asignacionNota = analisis.mapa.get(CAMPO_NOTA);
  const confirmacionPendiente =
    peticion.columnaNotaConfirmada === undefined && asignacionNota
      ? resumenParaConfirmar(asignacionNota, muestra(tabla, analisis.indiceNota))
      : null;

  const bloqueosDelCruce = motivosDeBloqueo(cruce).map((motivo) => ({
    fila: 0,
    codigo: "",
    nombre: "",
    valor: "",
    estado: "cruce con el listado de Banner",
    motivo,
  }));

  const listo =
    confirmacionPendiente === null && reporte.puede_generar && puedeGenerarCruce(cruce);

  const archivo = listo
    ? {
        bytes: await deps.plantillas.escribirFinalGrade(
          clasificacion.plantilla,
          notasPorIdentificador(cruce),
        ),
        nombre: `notas_banner_${crn(plantilla) || "curso"}.xlsx`,
      }
    : null;

  return {
    analisis,
    reporte,
    cruce,
    plantilla,
    clasificacion,
    confirmacionPendiente,
    cambios: reporte.cambios,
    bloqueos: [...reporte.bloqueos, ...bloqueosDelCruce],
    archivo,
  };
}

function notasPorIdentificador(cruce: Cruce): Map<string, string> {
  const salida = new Map<string, string>();
  for (const emparejamiento of cruce.emparejados) {
    const valor = emparejamiento.origen.nota.valor;
    if (valor !== null) {
      salida.set(emparejamiento.plantilla.identificador, valor.toFixed(1));
    }
  }
  return salida;
}
