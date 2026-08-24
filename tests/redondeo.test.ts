/**
 * Suite del motor de redondeo — regla de oro 1 (`plan.md` §4).
 *
 * Port de `tests/test_redondeo.py`. El test central es el barrido de frontera:
 * los 50 valores de dos decimales terminados en 5 entre 0.00 y 5.00. Son los
 * únicos casos donde la política de redondeo cambia el resultado, y por lo
 * tanto donde una implementación equivocada aprueba o reprueba a alguien.
 */

import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";

import {
  NOTA_APROBATORIA,
  ValorNoDecimal,
  aDecimal,
  aprueba,
  enRango,
  formatear,
  redondear,
} from "@dominio/redondeo.ts";

/** Los 50 valores de dos decimales terminados en 5, de 0.00 a 5.00. */
function valoresFrontera(): string[] {
  const salida: string[] = [];
  for (let i = 0; i <= 500; i++) {
    const texto = new Decimal(i).div(100).toFixed(2);
    if (texto.endsWith("5")) salida.push(texto);
  }
  return salida;
}

/** El valor correcto según la política institucional, calculado aparte. */
function esperado(texto: string): Decimal {
  return new Decimal(texto).toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
}

describe("barrido de frontera", () => {
  it("hay 50 valores de frontera", () => {
    expect(valoresFrontera()).toHaveLength(50);
  });

  it("redondea bien los 50 desde texto", () => {
    for (const texto of valoresFrontera()) {
      expect(redondear(texto).toString(), texto).toBe(esperado(texto).toString());
    }
  });

  it("redondea bien los 50 desde number", () => {
    // Un lector de Excel entrega números, no texto: debe dar lo mismo.
    for (const texto of valoresFrontera()) {
      expect(redondear(Number(texto)).toString(), texto).toBe(
        esperado(texto).toString(),
      );
    }
  });

  it("toFixed() nativo falla en 20 de 50", () => {
    // Documenta por qué está prohibido `Number(v).toFixed(1)`: el double ya
    // llegó desviado antes de redondear. Es el análogo en JavaScript del
    // `Decimal(float)` de Python, y falla en los mismos 20 casos —incluidos
    // los dos que cita `plan.md` §3.6.
    // Si este número cambia, hay que actualizar `plan.md` §3.6.
    const fallos = valoresFrontera().filter(
      (t) => Number(t).toFixed(1) !== esperado(t).toFixed(1),
    );
    expect(fallos).toHaveLength(20);
    expect(fallos).toContain("2.55"); // toFixed -> "2.5", debería ser 2.6
    expect(fallos).toContain("4.35"); // toFixed -> "4.3", debería ser 4.4
    expect(fallos).toContain("0.95"); // toFixed -> "0.9", debería ser 1.0
  });

  it("toFixed() acierta 2.95 por casualidad, y eso es lo peligroso", () => {
    // El caso que definió la política institucional es justo uno de los 30 que
    // `toFixed` acierta. Probar a mano el caso emblemático NO detecta el fallo:
    // por eso el criterio es el barrido completo y no un puñado de ejemplos.
    expect(Number("2.95").toFixed(1)).toBe("3.0");
    expect(valoresFrontera().filter((t) => Number(t).toFixed(1) !== esperado(t).toFixed(1)))
      .not.toContain("2.95");
  });

  it("Math.round(v*10)/10 pasa el barrido, pero por accidente", () => {
    // Pasa los 50 en el rango 0–5 con un decimal, y por eso es tentador.
    // No es una garantía: es una coincidencia de representación binaria, y se
    // rompe al cambiar la precisión. Ver `plan.md` §3.6.
    const fallos = valoresFrontera().filter(
      (t) => Math.round(Number(t) * 10) / 10 !== Number(esperado(t).toFixed(1)),
    );
    expect(fallos).toHaveLength(0);

    // La misma técnica con dos decimales: 1.005 debería dar 1.01.
    expect(Math.round(1.005 * 100) / 100).toBe(1);
    expect(new Decimal("1.005").toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)).toBe("1.01");
  });
});

describe("política institucional", () => {
  it("el caso que definió la política", () => {
    expect(redondear("2.95").toString()).toBe("3");
    expect(formatear("2.95")).toBe("3.0");
  });

  it("2.95 aprueba, y un redondeo mal hecho reprobaría", () => {
    // El riesgo real, expresado como test: la frontera está en 3.0.
    expect(aprueba(redondear("2.95"))).toBe(true);
    expect(aprueba(new Decimal("2.9"))).toBe(false);
    expect(NOTA_APROBATORIA.toString()).toBe("3");
  });

  it("promedio ponderado típico del archivo docente", () => {
    // La definitiva es una fórmula: casi toda fila pasa por el redondeo.
    expect(formatear("4.283333333333333")).toBe("4.3");
    expect(formatear("3.9666666666666668")).toBe("4.0");
  });
});

describe("propiedades", () => {
  it("idempotencia", () => {
    for (const texto of [...valoresFrontera(), "4.283333", "0.04", "4.96"]) {
      const una = redondear(texto);
      expect(redondear(una).toString(), texto).toBe(una.toString());
    }
  });

  it("no-op si ya tiene un decimal", () => {
    for (let i = 0; i <= 50; i++) {
      const texto = new Decimal(i).div(10).toFixed(1);
      expect(formatear(texto), texto).toBe(texto);
    }
  });

  it("texto y number son equivalentes", () => {
    for (const texto of valoresFrontera()) {
      expect(aDecimal(texto).toString(), texto).toBe(
        aDecimal(Number(texto)).toString(),
      );
    }
  });
});

describe("formato de salida", () => {
  it("siempre escribe el decimal", () => {
    expect(formatear(3)).toBe("3.0");
    expect(formatear("5")).toBe("5.0");
    expect(formatear(new Decimal("0"))).toBe("0.0");
  });

  it("siempre usa punto y un solo decimal", () => {
    for (const entrada of ["4.25", "4.5", 4.5, new Decimal("4.50"), " 4.5 "]) {
      const salida = formatear(entrada);
      expect(salida).not.toContain(",");
      expect(salida).toMatch(/^\d+\.\d$/);
    }
  });
});

describe("entradas inválidas", () => {
  it("rechaza lo que no es número", () => {
    const basura = ["", "  ", "NP", "4,5", "NaN", "Infinity", "0x1f", "ver acta", null, undefined, [], {}];
    for (const entrada of basura) {
      expect(() => aDecimal(entrada), JSON.stringify(entrada)).toThrow(ValorNoDecimal);
    }
  });

  it("rechaza booleanos", () => {
    // true no puede convertirse en 1.0: sería una nota inventada.
    expect(() => aDecimal(true)).toThrow(ValorNoDecimal);
    expect(() => aDecimal(false)).toThrow(ValorNoDecimal);
  });

  it("rechaza no finitos", () => {
    expect(() => aDecimal(Number.NaN)).toThrow(ValorNoDecimal);
    expect(() => aDecimal(Number.POSITIVE_INFINITY)).toThrow(ValorNoDecimal);
  });

  it("rango institucional", () => {
    expect(enRango(new Decimal("0.0"))).toBe(true);
    expect(enRango(new Decimal("5.0"))).toBe(true);
    expect(enRango(new Decimal("5.1"))).toBe(false);
    expect(enRango(new Decimal("-0.1"))).toBe(false);
  });
});
