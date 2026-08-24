/**
 * Suite del mapeo de columnas — restricción §4.0 de `plan.md`.
 *
 * Port de `tests/test_mapeo.py`. El archivo real del docente tiene cuatro
 * columnas numéricas en escala 0.0 a 5.0 y solo una es la definitiva. Elegir
 * mal no produce ningún síntoma: el archivo sale bien formado, Banner lo
 * acepta, y el curso queda calificado con las notas del parcial. Esta suite
 * existe para que eso no pueda pasar en silencio.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CAMPO_CODIGO,
  CAMPO_NOMBRE,
  CAMPO_NOTA,
  CatalogoAlias,
  mapear,
  normalizarEncabezado,
  requiereConfirmacion,
  resuelto,
  resumenParaConfirmar,
} from "@dominio/mapeo.ts";
import type { Asignacion } from "@dominio/modelo.ts";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

/** El catálogo del repositorio, el mismo que usa la aplicación. */
function catalogoPorDefecto(): CatalogoAlias {
  return CatalogoAlias.desdeObjeto(
    JSON.parse(readFileSync(`${RAIZ}config/alias_columnas.json`, "utf-8")),
  );
}

/** El archivo real de Humberto (`plan.md` §0.8). */
const ARCHIVO_REAL = [
  "nombre",
  "codigo de estudiante",
  "trabajos",
  "quizes",
  "examen",
  "nota definitiva",
];

let catalogo: CatalogoAlias;
beforeEach(() => {
  catalogo = catalogoPorDefecto();
});

function pedir(mapa: Map<string, Asignacion>, campo: string): Asignacion {
  const a = mapa.get(campo);
  if (!a) throw new Error(`el catálogo no declara el campo ${campo}`);
  return a;
}

describe("el archivo real del docente", () => {
  it("encuentra las dos columnas que importan", () => {
    const mapa = mapear(ARCHIVO_REAL, catalogo);
    expect(pedir(mapa, CAMPO_CODIGO).encabezado).toBe("codigo de estudiante");
    expect(pedir(mapa, CAMPO_NOTA).encabezado).toBe("nota definitiva");
  });

  it("no elige ninguno de los tres señuelos", () => {
    const mapa = mapear(ARCHIVO_REAL, catalogo);
    const elegidas = new Set(
      [...mapa.values()].filter(resuelto).map((a) => a.encabezado),
    );
    for (const senuelo of ["trabajos", "quizes", "examen"]) {
      expect(elegidas, senuelo).not.toContain(senuelo);
    }
  });

  it("encuentra el nombre para la verificación cruzada", () => {
    const mapa = mapear(ARCHIVO_REAL, catalogo);
    expect(pedir(mapa, CAMPO_NOMBRE).encabezado).toBe("nombre");
  });
});

describe("lista de descarte", () => {
  // La lista de descarte es autoritativa: gana sobre cualquier parecido.

  it("'quizes' mal escrito igual se descarta", () => {
    // En el archivo real está escrito "quizes", no "quices".
    expect(catalogo.esDescartada("quizes")).toBe(true);
    expect(catalogo.esDescartada("Quizes")).toBe(true);
  });

  it("descarta por palabra completa, no por substring", () => {
    expect(catalogo.esDescartada("nota examen")).toBe(true);
    expect(catalogo.esDescartada("nota definitiva")).toBe(false);
  });

  it("una columna descartada nunca es candidata", () => {
    const mapa = mapear(["codigo", "nota examen", "nota parcial"], catalogo);
    expect(resuelto(pedir(mapa, CAMPO_NOTA))).toBe(false);
    expect(pedir(mapa, CAMPO_NOTA).confianza).toBe("nula");
  });

  it("el señuelo no gana aunque sea la única columna numérica", () => {
    const mapa = mapear(["codigo de estudiante", "examen"], catalogo);
    expect(resuelto(pedir(mapa, CAMPO_NOTA))).toBe(false);
  });
});

describe("confianza y confirmación", () => {
  it("la nota siempre se confirma aunque el mapeo esté seguro", () => {
    // Restricción §4.0: es el único campo con confirmación obligatoria.
    const a = pedir(mapear(ARCHIVO_REAL, catalogo), CAMPO_NOTA);
    expect(a.confianza).toBe("alta");
    expect(requiereConfirmacion(a)).toBe(true);
  });

  it("el código no necesita confirmación si es exacto", () => {
    const a = pedir(mapear(ARCHIVO_REAL, catalogo), CAMPO_CODIGO);
    expect(a.confianza).toBe("alta");
    expect(requiereConfirmacion(a)).toBe(false);
  });

  it("dos candidatas parecidas bajan la confianza", () => {
    const mapa = mapear(["codigo", "nota definitiva", "definitiva"], catalogo);
    expect(pedir(mapa, CAMPO_NOTA).confianza).toBe("media");
    expect(pedir(mapa, CAMPO_NOTA).motivo).toContain("preguntar");
  });

  it("un alias débil nunca da confianza alta", () => {
    // "promedio" es plausible como definitiva, pero no es seguro.
    const mapa = mapear(["codigo de estudiante", "promedio"], catalogo);
    expect(pedir(mapa, CAMPO_NOTA).encabezado).toBe("promedio");
    expect(pedir(mapa, CAMPO_NOTA).confianza).toBe("media");
    expect(requiereConfirmacion(pedir(mapa, CAMPO_NOTA))).toBe(true);
  });

  it("sin candidatas lo declara en vez de adivinar", () => {
    const mapa = mapear(["columna a", "columna b"], catalogo);
    expect(resuelto(pedir(mapa, CAMPO_NOTA))).toBe(false);
    expect(pedir(mapa, CAMPO_NOTA).confianza).toBe("nula");
  });
});

describe("coincidencia difusa", () => {
  it("tolera variantes de escritura", () => {
    for (const variante of [
      "NOTA DEFINITIVA",
      "Nota  Definitiva",
      "nota_definitiva",
      "Nota Definitva",
    ]) {
      const mapa = mapear(["codigo", variante], catalogo);
      expect(pedir(mapa, CAMPO_NOTA).encabezado, variante).toBe(variante);
    }
  });

  it("normalización de encabezados", () => {
    for (const variante of [
      "Código de Estudiante",
      "CODIGO_DE_ESTUDIANTE",
      " codigo  de estudiante ",
    ]) {
      expect(normalizarEncabezado(variante), variante).toBe("codigo de estudiante");
    }
  });
});

describe("texto de confirmación", () => {
  it("muestra la columna y valores reales", () => {
    const a = pedir(mapear(ARCHIVO_REAL, catalogo), CAMPO_NOTA);
    const texto = resumenParaConfirmar(a, ["4.3", "2.8", "3.9"]);
    expect(texto).toContain("nota definitiva");
    expect(texto).toContain("4.3");
    expect(texto).toContain("¿Es correcto?");
  });

  it("pide ayuda cuando no encontró la columna", () => {
    const a = pedir(mapear(["columna a"], catalogo), CAMPO_NOTA);
    expect(resumenParaConfirmar(a, [])).toContain("Indícame cuál es");
  });
});
