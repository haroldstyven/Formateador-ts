/**
 * Suite de flujo y reporte — `plan.md` Fases 2, 3 y 5.
 *
 * Port de la parte de análisis de `tests/test_flujo.py`. Prueba el recorrido
 * completo sobre el archivo del docente y, sobre todo, **la guardia que impide
 * generar un archivo incompleto**: un archivo a medias es peor que ningún
 * archivo, porque parece correcto.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ArchivoEntrante } from "@aplicacion/puertos.ts";
import { CatalogoAlias } from "@dominio/mapeo.ts";
import { ConfigValores } from "@dominio/valores.ts";
import { MapeoIncompleto, analizar } from "@dominio/flujo.ts";
import { pendientesPorToken, puedeGenerar } from "@dominio/analisis.ts";
import {
  cambios,
  bloqueos,
  construirReporte,
  descartes,
  reporteAJson,
  reporteATexto,
  resumen,
  verificarReglas,
} from "@dominio/reporte.ts";
import { leer } from "@adaptadores/salida/lectura-xlsx.ts";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

const catalogo = CatalogoAlias.desdeObjeto(
  JSON.parse(readFileSync(`${RAIZ}config/alias_columnas.json`, "utf-8")),
);

function fixture(nombre: string): ArchivoEntrante {
  return {
    nombre,
    bytes: new Uint8Array(readFileSync(`${RAIZ}tests/fixtures/flujo/${nombre}`)),
  };
}

function analizarFixture(nombre: string, config?: ConfigValores, indiceNota?: number) {
  const tabla = leer(fixture(nombre), catalogo);
  return analizar(tabla, catalogo, {
    ...(config ? { config } : {}),
    ...(indiceNota !== undefined ? { indiceNota } : {}),
  });
}

/** Config que autoriza reemplazar `NP` por una nota concreta. */
function conNp(accion: string, valor?: string): ConfigValores {
  const cfg: Record<string, unknown> = { accion };
  if (valor !== undefined) cfg["valor"] = valor;
  return ConfigValores.desdeObjeto({ tokens: { np: cfg } });
}

describe("análisis", () => {
  it("un archivo limpio queda listo", () => {
    const analisis = analizarFixture("limpio.xlsx");
    expect(analisis.filas).toHaveLength(3);
    expect(puedeGenerar(analisis)).toBe(true);
  });

  it("conserva el número de fila del archivo original", () => {
    // Si el número no cuadra, el docente no encuentra la fila que le señalan.
    const analisis = analizarFixture("limpio.xlsx");
    expect(analisis.filas.map((f) => f.numero)).toEqual([2, 3, 4]);
  });

  it("detecta un código duplicado", () => {
    const analisis = analizarFixture("duplicado.xlsx");
    const conProblema = analisis.filas.filter((f) => f.problemas.length);
    expect(conProblema).toHaveLength(2);
    expect(conProblema[0]!.problemas[0]).toContain("aparece 2 veces");
    expect(puedeGenerar(analisis)).toBe(false);
  });

  it("detecta una fila sin código", () => {
    const analisis = analizarFixture("sin-codigo.xlsx");
    const sinCodigo = analisis.filas.filter((f) => !f.codigo);
    expect(sinCodigo).toHaveLength(1);
    expect(sinCodigo[0]!.problemas[0]).toContain("no tiene código");
    expect(puedeGenerar(analisis)).toBe(false);
  });

  it("la columna de nota la puede forzar el docente", () => {
    // §4.0: la máquina propone, la persona confirma. Aquí se elige `examen`
    // a propósito, que es justo la columna que no hay que elegir sola.
    const analisis = analizarFixture("limpio.xlsx", undefined, 4);
    expect(analisis.indiceNota).toBe(4);
    expect(analisis.filas[0]!.nota.valor?.toFixed(1)).toBe("4.2");
  });

  it("sin columna de nota no adivina: lo declara", () => {
    const tabla = leer(fixture("limpio.xlsx"), catalogo);
    const sinNota = { ...tabla, encabezados: ["a", "b", "c", "d", "e", "f"] };
    expect(() => analizar(sinNota, catalogo)).toThrow(MapeoIncompleto);
  });

  it("una fórmula sin calcular bloquea y no vale cero", () => {
    const analisis = analizarFixture("formula-sin-calcular.xlsx");
    expect(analisis.filas[0]!.nota.estado).toBe("formula_sin_calcular");
    expect(analisis.filas[0]!.nota.valor).toBeNull();
    expect(puedeGenerar(analisis)).toBe(false);
  });
});

describe("decisiones del docente", () => {
  it("sin decisión el archivo queda bloqueado, y se pregunta una vez por token", () => {
    const analisis = analizarFixture("np.xlsx");
    expect(puedeGenerar(analisis)).toBe(false);
    const grupos = pendientesPorToken(analisis);
    expect([...grupos.keys()]).toEqual(["np"]);
    expect(grupos.get("np")).toHaveLength(2);
  });

  it("con la decisión autorizada se desbloquea y queda registrado", () => {
    const analisis = analizarFixture("np.xlsx", conNp("reemplazar", "0.0"));
    expect(puedeGenerar(analisis)).toBe(true);
    const sustituidas = analisis.filas.filter((f) => f.nota.estado === "sustituida");
    expect(sustituidas).toHaveLength(2);
    // Regla de oro 4: una sustitución nunca es silenciosa.
    expect(cambios(analisis)).toHaveLength(2);
    expect(cambios(analisis)[0]!.motivo).toContain("0.0");
  });

  it("dejar sin nota sigue bloqueando el cargue", () => {
    // Una celda vacía no es una decisión resuelta: Banner podría borrar la nota
    // que el estudiante ya tenía (riesgo `B-11`).
    const analisis = analizarFixture("np.xlsx", conNp("dejar_vacio"));
    expect(puedeGenerar(analisis)).toBe(false);
  });

  it("descartar la fila la saca del cargue pero no del reporte", () => {
    // Regla de oro 2: ninguna fila desaparece en silencio.
    const analisis = analizarFixture("np.xlsx", conNp("descartar_fila"));
    expect(descartes(analisis)).toHaveLength(2);
    expect(resumen(analisis).descartadas_por_el_docente).toBe(2);
  });
});

describe("reporte", () => {
  it("el diff muestra el valor original", () => {
    const analisis = analizarFixture("limpio.xlsx");
    const porCodigo = new Map(cambios(analisis).map((c) => [c.codigo, c]));
    expect(porCodigo.get("0012346")!.antes).toBe("2.95");
    expect(porCodigo.get("0012346")!.despues).toBe("3.0");
    // 3.5 no cambió, así que no ensucia el diff.
    expect(porCodigo.has("0012347")).toBe(false);
  });

  it("el resumen cuadra con las filas", () => {
    const r = resumen(analizarFixture("limpio.xlsx"));
    expect(r.filas_leidas).toBe(3);
    expect(r.listas_para_cargar).toBe(3);
    expect(r.notas_redondeadas).toBe(2);
    expect(r.requieren_decision).toBe(0);
  });

  it("las cuatro reglas de oro se cumplen sobre datos reales", () => {
    for (const nombre of [
      "limpio.xlsx",
      "np.xlsx",
      "duplicado.xlsx",
      "sin-codigo.xlsx",
      "fuera-de-rango.xlsx",
      "todo-junto.xlsx",
    ]) {
      const reglas = verificarReglas(analizarFixture(nombre));
      expect(Object.values(reglas).every(Boolean), nombre).toBe(true);
    }
  });

  it("el json es serializable y trae la política declarada", () => {
    const reporte = construirReporte(analizarFixture("limpio.xlsx"));
    const datos = JSON.parse(reporteAJson(reporte));
    expect(datos.politica_redondeo.modo).toBe("ROUND_HALF_UP");
    expect(datos.politica_redondeo.aprobacion).toBe("3.0");
    expect(datos.mapeo.nota_definitiva.columna).toBe("nota definitiva");
    expect(datos.puede_generar).toBe(true);
  });

  it("reporta los bloqueos con su motivo legible", () => {
    const analisis = analizarFixture("fuera-de-rango.xlsx");
    expect(puedeGenerar(analisis)).toBe(false);
    expect(bloqueos(analisis)[0]!.estado).toContain("fuera de la escala");
  });

  it("el texto para consola dice si se puede generar o no", () => {
    expect(reporteATexto(analizarFixture("limpio.xlsx")))
      .toContain("El archivo se puede generar.");
    expect(reporteATexto(analizarFixture("np.xlsx")))
      .toContain("NO se genera el archivo");
  });

  it("el diff no oculta que Excel muestra menos decimales de los que guarda", () => {
    // §3.2, como aviso de fila y no como bloqueo.
    const tabla = leer(
      {
        nombre: "formato-un-decimal.xlsx",
        bytes: new Uint8Array(
          readFileSync(`${RAIZ}tests/fixtures/lectura/formato-un-decimal.xlsx`),
        ),
      },
      catalogo,
    );
    const analisis = analizar(tabla, catalogo);
    const reporte = construirReporte(analisis);
    expect(reporte.avisos.some((a) => a.includes("menos decimales"))).toBe(true);
  });
});
