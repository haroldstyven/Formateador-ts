/**
 * Suite de interpretación de celdas — reglas de oro 3 y 4 (`plan.md` §4).
 *
 * Port de `tests/test_valores.py`. Lo que se prueba aquí no es aritmética sino
 * política: que el software nunca decida una nota por su cuenta. Cada test de
 * esta suite corresponde a una forma concreta de reprobar a un estudiante por
 * accidente.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ConfigInvalida,
  ConfigValores,
  agruparPendientes,
  fueModificada,
  interpretar,
  normalizarToken,
  requiereDecision,
} from "@dominio/valores.ts";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

/** Config con una sola decisión sobre `np`, para los tests de autorización. */
function configNp(accion: string, valor?: string): ConfigValores {
  const cfg: Record<string, unknown> = { accion };
  if (valor !== undefined) cfg["valor"] = valor;
  return ConfigValores.desdeObjeto({ tokens: { np: cfg } });
}

describe("nunca inventa una nota", () => {
  // Regla de oro 3: nada se rellena por defecto.

  it("una celda vacía nunca es cero", () => {
    for (const entrada of [null, undefined, "", "   ", "\t"]) {
      const n = interpretar(entrada);
      expect(n.estado, String(entrada)).toBe("vacia");
      expect(n.valor).toBeNull();
      expect(requiereDecision(n)).toBe(true);
    }
  });

  it("un token desconocido no recibe valor por defecto", () => {
    const n = interpretar("NP");
    expect(n.estado).toBe("no_numerica");
    expect(n.valor).toBeNull();
    expect(requiereDecision(n)).toBe(true);
  });

  it("fuera de rango no emite valor", () => {
    // 85 en escala de 5 es un error real y frecuente: no se recorta a 5.0.
    for (const entrada of ["85", "5.1", "-1", "100"]) {
      const n = interpretar(entrada);
      expect(n.estado, entrada).toBe("fuera_de_rango");
      expect(n.valor).toBeNull();
    }
  });

  it("el texto arbitrario no se interpreta", () => {
    const n = interpretar("ver acta");
    expect(n.estado).toBe("no_numerica");
    expect(n.valor).toBeNull();
  });
});

describe("fórmula sin calcular", () => {
  // §3.1: "fórmula sin calcular" y "celda vacía" no son lo mismo.

  it("no se confunde con una celda vacía", () => {
    const formula = interpretar(null, undefined, { formulaSinCalcular: true });
    const vacia = interpretar(null);
    expect(formula.estado).toBe("formula_sin_calcular");
    expect(vacia.estado).toBe("vacia");
    expect(formula.detalle).not.toBe(vacia.detalle);
  });

  it("pide la acción concreta que lo resuelve", () => {
    const n = interpretar(null, undefined, { formulaSinCalcular: true });
    expect(n.detalle).toContain("Ctrl+S");
    expect(n.valor).toBeNull();
  });

  it("nunca se recalcula desde los componentes", () => {
    // Principio 3.7: la definitiva se lee, jamás se calcula.
    const n = interpretar(null, undefined, { formulaSinCalcular: true });
    expect(requiereDecision(n)).toBe(true);
    expect(n.valor).toBeNull();
  });
});

describe("redondeo visible", () => {
  // Regla de oro 4: ningún redondeo ocurre en silencio.

  it("marca la nota como modificada", () => {
    const n = interpretar("4.25");
    expect(n.estado).toBe("redondeada");
    expect(n.valor?.toFixed(1)).toBe("4.3");
    expect(n.valorPrevio?.toString()).toBe("4.25");
    expect(fueModificada(n)).toBe(true);
    expect(n.detalle).toContain("4.25");
  });

  it("no marca lo que no cambió", () => {
    const n = interpretar("4.5");
    expect(n.estado).toBe("ok");
    expect(fueModificada(n)).toBe(false);
    expect(n.valorPrevio).toBeNull();
  });

  it("la coma se corrige pero queda reportada", () => {
    const n = interpretar("4,5");
    expect(n.valor?.toFixed(1)).toBe("4.5");
    expect(n.detalle.toLowerCase()).toContain("coma");
  });

  it("la coma aparece en el diff aunque el valor no cambie", () => {
    // La regla 4 exige mostrar todo lo que la herramienta tocó.
    const n = interpretar("4,5");
    expect(n.formatoCorregido).toBe(true);
    expect(fueModificada(n)).toBe(true);
  });

  it("una nota intacta no ensucia el diff", () => {
    const n = interpretar("4.5");
    expect(n.formatoCorregido).toBe(false);
    expect(fueModificada(n)).toBe(false);
  });

  it("los separadores ambiguos se preguntan en vez de adivinarse", () => {
    const n = interpretar("1,234.5");
    expect(n.estado).toBe("no_numerica");
    expect(n.valor).toBeNull();
  });
});

describe("normalización de tokens", () => {
  it("las variantes del mismo token colapsan", () => {
    for (const variante of ["NP", "np", "N.P.", " Np ", "n.p."]) {
      expect(normalizarToken(variante), variante).toBe("np");
    }
  });

  it("ignora las tildes", () => {
    expect(normalizarToken("Cancelación")).toBe("cancelacion");
    expect(normalizarToken("No Presentó")).toBe("no presento");
  });

  it("se pregunta una vez por token, no una por fila", () => {
    const notas = ["NP", "np", "N.P.", "4.5", "retiro"].map((v) => interpretar(v));
    const grupos = agruparPendientes(notas);
    expect([...grupos.keys()].sort()).toEqual(["np", "retiro"]);
    expect(grupos.get("np")).toHaveLength(3);
  });
});

describe("configuración segura", () => {
  // §0.3.1: la configuración es editable, pero no puede volverse peligrosa.

  it("'reemplazar' sin valor es rechazado al cargar", () => {
    expect(() => ConfigValores.desdeObjeto({ tokens: { np: { accion: "reemplazar" } } }))
      .toThrow(ConfigInvalida);
  });

  it("un reemplazo fuera de escala es rechazado", () => {
    expect(() =>
      ConfigValores.desdeObjeto({
        tokens: { np: { accion: "reemplazar", valor: "7.0" } },
      }),
    ).toThrow(ConfigInvalida);
  });

  it("un reemplazo no numérico es rechazado", () => {
    expect(() =>
      ConfigValores.desdeObjeto({
        tokens: { np: { accion: "reemplazar", valor: "cero" } },
      }),
    ).toThrow(ConfigInvalida);
  });

  it("no se admite 'reemplazar' como política global", () => {
    // Un default global obligaría a inventar valores para tokens no revisados.
    expect(() => ConfigValores.desdeObjeto({ politica_por_defecto: "reemplazar" }))
      .toThrow(ConfigInvalida);
  });

  it("una acción desconocida es rechazada", () => {
    expect(() => ConfigValores.desdeObjeto({ tokens: { np: { accion: "aproximar" } } }))
      .toThrow(ConfigInvalida);
  });

  it("la config del repositorio carga y no reemplaza nada", () => {
    const datos = JSON.parse(
      readFileSync(`${RAIZ}config/valores_no_numericos.json`, "utf-8"),
    );
    const config = ConfigValores.desdeObjeto(datos);
    expect(config.politicaPorDefecto).toBe("preguntar");
    for (const [token, decision] of config.decisiones) {
      expect(decision.accion, token).toBe("preguntar");
    }
    expect(config.decisiones.size).toBeGreaterThan(0);
  });

  it("el token de la config se normaliza al cargar", () => {
    const config = ConfigValores.desdeObjeto({
      tokens: { "N.P.": { accion: "reemplazar", valor: "0.0" } },
    });
    expect(config.decisionPara("np").valor?.toFixed(1)).toBe("0.0");
  });
});

describe("decisiones autorizadas", () => {
  // Regla 3 enmendada: se permite sustituir, siempre que quede registrado.

  it("una sustitución autorizada se aplica y se registra", () => {
    const n = interpretar("NP", configNp("reemplazar", "0.0"));
    expect(n.estado).toBe("sustituida");
    expect(n.valor?.toFixed(1)).toBe("0.0");
    expect(n.token).toBe("np");
    expect(fueModificada(n)).toBe(true);
    expect(n.detalle).toContain("NP");
    expect(requiereDecision(n)).toBe(false);
  });

  it("'dejar vacío' no produce valor", () => {
    const n = interpretar("NP", configNp("dejar_vacio"));
    expect(n.estado).toBe("vacia");
    expect(n.valor).toBeNull();
  });

  it("'descartar fila' no produce valor", () => {
    const n = interpretar("NP", configNp("descartar_fila"));
    expect(n.estado).toBe("descartada");
    expect(n.valor).toBeNull();
  });

  it("la decisión no se extiende a otros tokens", () => {
    // Autorizar NP no autoriza 'retiro'.
    const n = interpretar("retiro", configNp("reemplazar", "0.0"));
    expect(n.estado).toBe("no_numerica");
    expect(n.valor).toBeNull();
  });
});
