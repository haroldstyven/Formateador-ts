/**
 * Motor de redondeo de notas.
 *
 * Único lugar del proyecto autorizado para redondear una nota. Ninguna otra
 * parte del código debe llamar a `toFixed()`, `Math.round()` ni operar notas
 * con el tipo `number`: ver `plan.md` §3.5 y §3.6.
 *
 * Política institucional vigente (confirmada con la dirección de cargue
 * académico):
 *
 *   - Un solo decimal.
 *   - ROUND_HALF_UP  ->  2.95 se redondea a 3.0.
 *   - Escala 0.0 a 5.0, aprobación en 3.0.
 *   - Separador decimal: punto.
 *
 * Por qué importa el detalle de la construcción del Decimal: barriendo los 50
 * valores terminados en 5 entre 0.00 y 5.00, `Number(v).toFixed(1)` redondea
 * mal 20 —entre ellos `2.55 -> 2.5` y `4.35 -> 4.3`, los mismos dos que cita
 * §3.6 para `Decimal(float)`: es el mismo fallo con otro nombre.
 *
 * Detalle que conviene conocer antes de "probarlo rápido": `toFixed` acierta
 * `2.95 -> 3.0`. El caso emblemático de la política es uno de los 30 que sí
 * salen bien, así que verificar a mano el ejemplo del plan NO detecta el
 * problema. Por eso el criterio es el barrido completo, no un puñado de
 * ejemplos. Ver `tests/redondeo.test.ts`.
 *
 * Port de `formateador/redondeo.py`. Las dos implementaciones se contrastan
 * valor por valor en `tests/oraculo.test.ts`.
 */

import { Decimal } from "decimal.js";

export const DECIMALES = 1;
export const MODO = Decimal.ROUND_HALF_UP;

export const NOTA_MINIMA = new Decimal("0.0");
export const NOTA_MAXIMA = new Decimal("5.0");
export const NOTA_APROBATORIA = new Decimal("3.0");

/**
 * Se valida la forma del texto antes de entregarlo a Decimal porque el
 * constructor acepta "NaN", "Infinity" y notación hexadecimal ("0x1f"), que
 * aquí no son notas sino basura que debe reportarse.
 */
const DECIMAL_VALIDO = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** El valor recibido no representa un número decimal. */
export class ValorNoDecimal extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ValorNoDecimal";
  }
}

/**
 * Convierte a `Decimal` sin pasar nunca por la aritmética de coma flotante.
 *
 * Un `number` se convierte vía `String()`, que en JavaScript produce la
 * representación decimal más corta que reconstruye el mismo double ("2.95"),
 * exactamente igual que `str()` en Python. Es el análogo directo de la regla
 * `Decimal(str(v))` de §3.6.
 *
 * Lanza `ValorNoDecimal` para cualquier cosa que no sea un número finito.
 */
export function aDecimal(valor: unknown): Decimal {
  if (valor instanceof Decimal) {
    if (!valor.isFinite()) {
      throw new ValorNoDecimal(`valor no finito: ${valor.toString()}`);
    }
    return valor;
  }

  // Se descarta antes que nada para que `true` no valga 1.0.
  if (typeof valor === "boolean") {
    throw new ValorNoDecimal(`valor booleano no admitido: ${valor}`);
  }

  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) {
      throw new ValorNoDecimal(`valor no finito: ${valor}`);
    }
    return new Decimal(String(valor));
  }

  if (typeof valor === "bigint") {
    return new Decimal(valor.toString());
  }

  if (typeof valor === "string") {
    const texto = valor.trim();
    if (!DECIMAL_VALIDO.test(texto)) {
      throw new ValorNoDecimal(`texto no numérico: ${JSON.stringify(valor)}`);
    }
    return new Decimal(texto);
  }

  throw new ValorNoDecimal(
    `tipo no admitido: ${valor === null ? "null" : typeof valor}`,
  );
}

/**
 * Redondea a un decimal con ROUND_HALF_UP.
 *
 * Única implementación autorizada de redondeo en todo el proyecto.
 *
 * El cero negativo se normaliza a cero, y se hace explícito en vez de confiar
 * en que la librería lo haga: "-0.0" no es una nota de la escala, y Excel lo
 * produce solo. `enRango` lo acepta porque -0.0 == 0.0, así que sin esta línea
 * puede llegar hasta la columna `Final Grade`.
 */
export function redondear(valor: unknown): Decimal {
  const redondeado = aDecimal(valor).toDecimalPlaces(DECIMALES, MODO);
  return redondeado.isZero() ? redondeado.abs() : redondeado;
}

/**
 * Devuelve el texto exacto que espera Banner: punto y un solo decimal.
 * Siempre escribe el decimal, incluso cuando es cero: 3 -> "3.0".
 */
export function formatear(valor: unknown): string {
  return redondear(valor).toFixed(DECIMALES);
}

/** Indica si la nota cae dentro de la escala institucional (0.0 a 5.0). */
export function enRango(valor: Decimal): boolean {
  return valor.gte(NOTA_MINIMA) && valor.lte(NOTA_MAXIMA);
}

/**
 * Indica si la nota alcanza la aprobación (3.0).
 *
 * No lo usa el formateador para decidir nada: existe para que los tests
 * puedan expresar el riesgo real de un redondeo mal hecho.
 */
export function aprueba(valor: Decimal): boolean {
  return valor.gte(NOTA_APROBATORIA);
}
