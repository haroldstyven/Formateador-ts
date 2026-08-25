/**
 * Qué se puede decir de una celda antes de interpretarla.
 *
 * Port de la parte pura de `formateador/lectura.py`: los tres predicados de
 * `Celda` y el cálculo de decimales de un formato de Excel. Es dominio, no
 * adaptador — abrir el archivo es I/O, pero decidir si una celda esconde
 * precisión es una regla del proyecto (§3.2).
 */

import type { Celda } from "./modelo.ts";
import { ValorNoDecimal, aDecimal } from "./redondeo.ts";

const DECIMALES_FORMATO = /\.(0+)/;

export function texto(celda: Celda): string {
  return celda.valor === null ? "" : celda.valor;
}

export function vacia(celda: Celda): boolean {
  return celda.valor === null || celda.valor.trim() === "";
}

/** Fórmula presente cuyo valor cacheado está vacío (§3.1). */
export function formulaSinCalcular(celda: Celda): boolean {
  return celda.formula !== null && celda.valor === null;
}

/**
 * Cuántos decimales muestra un formato de número de Excel.
 *
 * Devuelve `null` para "General" y para formatos que no fijan decimales: en
 * esos casos Excel muestra el valor completo y no hay nada que ocultar.
 */
export function decimalesDeFormato(formato: string | null): number | null {
  if (!formato) return null;
  const limpio = formato.trim().toLowerCase();
  if (limpio === "general" || limpio === "@") return null;

  const seccion = formato.split(";")[0]!;
  if (!/[0#]/.test(seccion)) return null;

  const encontrado = DECIMALES_FORMATO.exec(seccion);
  return encontrado ? encontrado[1]!.length : 0;
}

/**
 * El formato muestra menos decimales de los que la celda almacena (§3.2).
 *
 * Es la trampa del docente que jura que la nota es 4.3 mientras el archivo
 * guarda 4.25: Excel se lo enseña redondeado y el archivo no.
 */
export function ocultaPrecision(celda: Celda): boolean {
  const delFormato = decimalesDeFormato(celda.formato);
  if (delFormato === null) return false;
  try {
    return aDecimal(celda.valor).decimalPlaces() > delFormato;
  } catch (e) {
    if (e instanceof ValorNoDecimal) return false;
    throw e;
  }
}

/** Una celda vacía, para rellenar huecos sin arrastrar `undefined`. */
export function celdaVacia(): Celda {
  return { valor: null, formula: null, formato: null };
}
