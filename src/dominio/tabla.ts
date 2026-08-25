/**
 * De una matriz de celdas a una tabla con encabezados y filas.
 *
 * Port de la parte pura de `formateador/lectura.py`: encontrar la fila de
 * encabezados —que no siempre es la primera—, recortar las columnas fantasma,
 * saltar las filas vacías y avisar de lo que huele mal.
 *
 * Es dominio: no abre archivos. El adaptador entrega la matriz, ya sea de un
 * `.xlsx` o de un `.csv`, y aquí se decide qué es encabezado y qué es dato.
 */

import type { Celda, Tabla } from "./modelo.ts";
import { celdaVacia, ocultaPrecision, texto, vacia } from "./celda.ts";
import type { CatalogoAlias } from "./mapeo.ts";
import { puntajeEncabezado } from "./mapeo.ts";

export const MAX_FILAS_ESCANEO = 25;

const PALABRAS_RESUMEN = /\b(total|totales|promedio|media|suma)\b/i;

/** No se encontró una fila que parezca encabezado. */
export class SinEncabezado extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "SinEncabezado";
  }
}

export function columna(tabla: Tabla, indice: number): Celda[] {
  return tabla.filas.map((fila) => fila[indice] ?? celdaVacia());
}

/** Primeros valores no vacíos de una columna, para el paso de confirmación. */
export function muestra(tabla: Tabla, indice: number, n = 5): string[] {
  const vistos: string[] = [];
  for (const celda of columna(tabla, indice)) {
    if (vacia(celda)) continue;
    vistos.push(texto(celda).trim());
    if (vistos.length === n) break;
  }
  return vistos;
}

/** Encuentra la fila de encabezados, que no siempre es la primera. */
export function detectarEncabezado(
  matriz: readonly (readonly Celda[])[],
  catalogo: CatalogoAlias,
): number {
  let mejorIndice = -1;
  let mejorPuntaje = 0.0;

  matriz.slice(0, MAX_FILAS_ESCANEO).forEach((fila, indice) => {
    const puntaje = puntajeEncabezado(
      fila.map((c) => c.valor),
      catalogo,
    );
    if (puntaje > mejorPuntaje) {
      mejorIndice = indice;
      mejorPuntaje = puntaje;
    }
  });

  if (mejorIndice < 0 || mejorPuntaje < 1.0) {
    throw new SinEncabezado(
      `No encontré una fila de encabezados en las primeras ${MAX_FILAS_ESCANEO} ` +
        "filas. Revisa que el archivo tenga una fila con los nombres de las columnas.",
    );
  }
  return mejorIndice;
}

export function armarTabla(
  matriz: readonly (readonly Celda[])[],
  catalogo: CatalogoAlias,
  hoja: string,
): Tabla {
  const indice = detectarEncabezado(matriz, catalogo);
  const encabezados = matriz[indice]!.map((c) => texto(c).trim());

  // Se recorta la cola de columnas sin nombre para no arrastrar celdas fantasma.
  while (encabezados.length && !encabezados[encabezados.length - 1]) {
    encabezados.pop();
  }
  const ancho = encabezados.length;

  const incidencias: string[] = [];
  if (indice > 0) {
    incidencias.push(
      `Los encabezados no estaban en la primera fila, sino en la fila ${indice + 1}.`,
    );
  }

  const filas: Celda[][] = [];
  matriz.slice(indice + 1).forEach((fila, desplazamiento) => {
    const numero = indice + 2 + desplazamiento;
    const recortada: Celda[] = [];
    for (let i = 0; i < ancho; i++) recortada.push(fila[i] ?? celdaVacia());

    if (recortada.every(vacia)) return;

    const textoFila = recortada.map(texto).join(" ");
    const llenas = recortada.filter((c) => !vacia(c)).length;
    if (PALABRAS_RESUMEN.test(textoFila) && llenas < ancho) {
      incidencias.push(
        `La fila ${numero} parece un total o promedio, no un estudiante. ` +
          "Revísala: no debería cargarse a Banner.",
      );
    }
    filas.push(recortada);
  });

  const ocultan = filas.reduce(
    (n, fila) => n + fila.filter(ocultaPrecision).length,
    0,
  );
  if (ocultan) {
    incidencias.push(
      `${ocultan} celda(s) muestran menos decimales de los que guardan. ` +
        "Lo que ves en Excel puede no ser lo que contiene el archivo.",
    );
  }

  return {
    encabezados,
    filas,
    hoja,
    filaEncabezado: indice + 1,
    incidencias,
    origen: null,
  };
}
