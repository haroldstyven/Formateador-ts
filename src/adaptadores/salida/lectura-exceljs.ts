/**
 * Adaptador de lectura. Implementa `LectorDeArchivos` con `exceljs`.
 *
 * PENDIENTE — port de `formateador/lectura.py`.
 *
 * Las tres trampas que el port tiene que reproducir:
 *
 * §3.1 Doble lectura de fórmulas. En exceljs una celda con fórmula devuelve
 *      `{ formula, result }`. `result == null` con `formula` presente
 *      significa fórmula sin calcular (recuperable: pedir Ctrl+S); celda
 *      vacía sin fórmula significa sin calificar (decisión del docente). Son
 *      dos casos distintos y no se pueden colapsar en uno.
 *
 * §3.2 Excel muestra un valor y guarda otro. El formato numérico está en
 *      `cell.numFmt`; de ahí sale `decimalesMostrados`, que alimenta la alerta
 *      cuando el formato oculta precisión.
 *
 * §3.4 Todo se lee como texto. Nunca dejar que el lector infiera tipos: un
 *      código de estudiante inferido como número ya perdió el cero a la
 *      izquierda en el momento de leer, y no hay normalizador que lo recupere.
 *
 * CSV: exceljs no cubre las codificaciones que sí cubre el lector Python
 * (utf-8-sig, utf-8, cp1252, latin-1). Hay que detectar la codificación
 * aparte, con `TextDecoder` probando la misma cascada que `CODIFICACIONES`.
 */

import type { ArchivoEntrante, LectorDeArchivos } from "@aplicacion/puertos.ts";
import type { Tabla } from "@dominio/modelo.ts";

export class LectorExcelJs implements LectorDeArchivos {
  async leer(_archivo: ArchivoEntrante): Promise<Tabla> {
    throw new Error("PENDIENTE: portar formateador/lectura.py");
  }

  async esPlantillaBanner(_archivo: ArchivoEntrante): Promise<boolean> {
    throw new Error("PENDIENTE: portar formateador/plantilla.py");
  }
}
