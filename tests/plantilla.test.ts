/**
 * Suite del cruce contra la plantilla oficial de Banner.
 *
 * Port de la parte pura de `tests/test_plantilla.py`. Allá cada caso arranca
 * leyendo `Template_Anonimo.xlsx` y pasando por `analizar_archivo`; aquí el
 * `Analisis` se arma a mano, porque lo que se prueba es el cruce y no el
 * lector. Los casos que sí necesitan el `.xlsx` real —lectura de la plantilla y
 * escritura de `Final Grade`— viven en la suite del adaptador.
 *
 * Los identificadores son los del ejemplar anonimizado: `ID-001` … `ID-012`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Analisis, FilaAnalizada } from "@dominio/modelo.ts";
import { interpretar } from "@dominio/valores.ts";
import {
  ESQUEMA_POR_DEFECTO,
  type FilaPlantilla,
  type Plantilla,
  cruzar,
  descripcion,
  esquemaDesdeObjeto,
  motivosDeBloqueo,
  normalizarIdentificador,
  notaTexto,
  puedeGenerarCruce,
  sobrescribenNota,
  tieneNota,
  verificadoContraBanner,
} from "@dominio/plantilla.ts";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

/** Los 12 estudiantes del ejemplar anonimizado. */
const IDS = Array.from({ length: 12 }, (_, i) => `ID-${String(i + 1).padStart(3, "0")}`);

function fila(numero: number, codigo: string, valor: unknown): FilaAnalizada {
  return {
    numero,
    codigo,
    nombre: `Estudiante ${String(numero).padStart(3, "0")}`,
    nota: interpretar(valor),
    problemas: [],
    avisos: [],
  };
}

function analisisDe(
  filas: FilaAnalizada[],
  origen: string | null = "notas.xlsx",
): Analisis {
  return {
    tabla: {
      encabezados: [],
      filas: [],
      hoja: "",
      filaEncabezado: 0,
      incidencias: [],
      origen,
    },
    mapa: new Map(),
    indiceNota: 0,
    filas,
  };
}

/** El archivo del docente con el curso completo y la misma nota para todos. */
function cursoCompleto(nota: unknown = "4.25", ids: readonly string[] = IDS): Analisis {
  return analisisDe(ids.map((id, i) => fila(i + 1, id, nota)));
}

interface OpcionesPlantilla {
  readonly rolled?: readonly string[];
  readonly notaExistente?: Readonly<Record<string, string>>;
  readonly origen?: string;
}

function plantillaDe(
  ids: readonly string[] = IDS,
  opciones: OpcionesPlantilla = {},
): Plantilla {
  const filas: FilaPlantilla[] = ids.map((id, i) => ({
    fila: i + 2,
    identificador: id,
    nombre: `Anonimo ${i + 1}`,
    rolled: opciones.rolled?.includes(id) ?? false,
    confidencial: false,
    notaExistente: opciones.notaExistente?.[id] ?? "",
  }));

  return {
    origen: opciones.origen ?? "Template_Anonimo.xlsx",
    esquema: ESQUEMA_POR_DEFECTO,
    columnas: new Map([
      ["Student ID", 4],
      ["Final Grade", 8],
    ]),
    filas,
    control: new Map([
      ["Course", "ANON-101"],
      ["Term Code", "202610"],
      ["CRN", "12345"],
    ]),
  };
}

describe("cruce", () => {
  it("un curso completo queda listo", () => {
    const cruce = cruzar(cursoCompleto(), plantillaDe());
    expect(cruce.emparejados).toHaveLength(12);
    expect(cruce.sinNota).toEqual([]);
    expect(cruce.sobrantes).toEqual([]);
    expect(puedeGenerarCruce(cruce)).toBe(true);
  });

  it("el orden del archivo del docente es irrelevante", () => {
    // Se cruza por identificador, nunca por posición.
    const alReves = [...IDS].reverse();
    const cruce = cruzar(cursoCompleto("3.5", alReves), plantillaDe());
    expect(puedeGenerarCruce(cruce)).toBe(true);
    expect(cruce.emparejados).toHaveLength(12);
  });

  it("un estudiante del curso sin nota bloquea", () => {
    // D-02: un cargue a medias parece completo y no lo está.
    const cruce = cruzar(cursoCompleto("3.5", IDS.slice(0, -2)), plantillaDe());
    expect(cruce.sinNota).toHaveLength(2);
    expect(puedeGenerarCruce(cruce)).toBe(false);
    expect(motivosDeBloqueo(cruce).join(" ")).toContain("no tienen nota");
  });

  it("un estudiante ajeno al curso se reporta y no se carga", () => {
    // D-01: quien no está en la plantilla, no está en el curso.
    const filas = IDS.map((id, i) => fila(i + 1, id, "3.5"));
    filas.push(fila(99, "ID-999", "5.0"));
    const cruce = cruzar(analisisDe(filas), plantillaDe());
    expect(cruce.sobrantes).toHaveLength(1);
    expect(cruce.sobrantes[0]!.codigo).toBe("ID-999");
    // Sobrar no impide; faltar sí.
    expect(puedeGenerarCruce(cruce)).toBe(true);
  });

  it("una nota pendiente bloquea todo el cargue", () => {
    const filas = IDS.map((id, i) => fila(i + 1, id, i === 3 ? "NP" : "3.5"));
    const cruce = cruzar(analisisDe(filas), plantillaDe());
    expect(cruce.pendientes).toHaveLength(1);
    expect(puedeGenerarCruce(cruce)).toBe(false);
  });

  it("una celda vacía en el archivo del docente bloquea, no vale 0.0", () => {
    const filas = IDS.map((id, i) => fila(i + 1, id, i === 7 ? "" : "3.5"));
    const cruce = cruzar(analisisDe(filas), plantillaDe());
    expect(cruce.pendientes).toHaveLength(1);
    expect(puedeGenerarCruce(cruce)).toBe(false);
  });

  it("un identificador con otro formato igual cruza, y queda marcado", () => {
    const raros = IDS.map((id) => id.toLowerCase().replace("-", " "));
    const cruce = cruzar(cursoCompleto("3.5", raros), plantillaDe());
    expect(puedeGenerarCruce(cruce)).toBe(true);
    expect(cruce.emparejados.every((e) => e.identificadorNormalizado)).toBe(true);
  });

  it("normalización de identificadores", () => {
    expect(normalizarIdentificador("t00012345")).toBe("T00012345");
    expect(normalizarIdentificador(" T-000 12345 ")).toBe("T00012345");
    // Los ceros a la izquierda son parte del identificador y se conservan.
    expect(normalizarIdentificador("T00012345")).not.toBe(
      normalizarIdentificador("T12345"),
    );
    expect(normalizarIdentificador(null)).toBe("");
    expect(normalizarIdentificador(undefined)).toBe("");
  });

  it("un duplicado en el archivo del docente no reemplaza en silencio", () => {
    // El primero gana. Reportarlo es trabajo de `flujo`, pero el cruce no
    // puede dejar que el segundo pise al primero sin que nadie se entere.
    const filas = IDS.map((id, i) => fila(i + 1, id, "3.5"));
    filas.push(fila(99, IDS[0]!, "1.0"));
    const cruce = cruzar(analisisDe(filas), plantillaDe());
    const primero = cruce.emparejados.find((e) => e.plantilla.identificador === IDS[0]);
    expect(notaTexto(primero!)).toBe("3.5");
  });

  it("la nota emparejada sale redondeada según la política", () => {
    const cruce = cruzar(cursoCompleto("4.25"), plantillaDe());
    expect(notaTexto(cruce.emparejados[0]!)).toBe("4.3");
  });

  it("la frontera de aprobación llega correcta", () => {
    const cruce = cruzar(cursoCompleto("2.95"), plantillaDe());
    expect(notaTexto(cruce.emparejados[0]!)).toBe("3.0");
  });
});

describe("notas ya consolidadas", () => {
  it("una fila marcada como rolled no se sobrescribe y bloquea", () => {
    const cruce = cruzar(cursoCompleto("3.5"), plantillaDe(IDS, { rolled: [IDS[2]!] }));
    expect(cruce.yaConsolidados).toHaveLength(1);
    expect(cruce.emparejados).toHaveLength(11);
    expect(puedeGenerarCruce(cruce)).toBe(false);
    expect(motivosDeBloqueo(cruce).join(" ")).toContain("historia académica");
  });
});

describe("sobrescritura de notas existentes", () => {
  it("avisa de las notas que se van a reemplazar", () => {
    const cruce = cruzar(
      cursoCompleto("3.5"),
      plantillaDe(IDS, { notaExistente: { [IDS[0]!]: "4.0", [IDS[1]!]: "2.0" } }),
    );
    expect(sobrescribenNota(cruce)).toHaveLength(2);
  });

  it("no avisa de reemplazo cuando el origen es la propia plantilla", () => {
    // §5.0: lo que hay en `Final Grade` es lo que el docente acaba de escribir,
    // no una nota previa de Banner. Avisar asustaría sin motivo.
    const mismo = "Template_Anonimo.xlsx";
    const analisis = analisisDe(
      IDS.map((id, i) => fila(i + 1, id, "3.5")),
      mismo,
    );
    const cruce = cruzar(
      analisis,
      plantillaDe(IDS, { notaExistente: { [IDS[0]!]: "4.0" }, origen: mismo }),
    );
    expect(cruce.mismoArchivo).toBe(true);
    expect(sobrescribenNota(cruce)).toEqual([]);
  });

  it("si son archivos distintos, el aviso sigue apareciendo", () => {
    const cruce = cruzar(
      cursoCompleto("3.5"),
      plantillaDe(IDS, { notaExistente: { [IDS[0]!]: "4.0" } }),
    );
    expect(cruce.mismoArchivo).toBe(false);
    expect(sobrescribenNota(cruce)).toHaveLength(1);
  });

  it("tieneNota ignora los espacios en blanco", () => {
    expect(tieneNota({ ...plantillaDe().filas[0]!, notaExistente: "   " })).toBe(false);
    expect(tieneNota({ ...plantillaDe().filas[0]!, notaExistente: "4.0" })).toBe(true);
  });
});

describe("esquema", () => {
  const esquema = esquemaDesdeObjeto(
    JSON.parse(readFileSync(`${RAIZ}config/schema_banner.json`, "utf-8")),
  );

  it("refleja la plantilla oficial", () => {
    expect(esquema.hoja).toBe("Grades");
    expect(esquema.filaEncabezado).toBe(1);
    expect(esquema.columnaClave).toBe("Student ID");
    expect(esquema.columnaNota).toBe("Final Grade");
    expect(esquema.encabezados).toHaveLength(13);
    // Se escribe texto: la columna viene preformateada como `@` (§2.2).
    expect(esquema.escribirNotaComo).toBe("texto");
    expect(esquema.formatoCeldaNota).toBe("@");
  });

  it("sigue marcado como NO verificado contra Banner", () => {
    // La Fase 1 es el único bloqueo real del proyecto. Este test cae el día que
    // alguien cargue con éxito y actualice el esquema — y ese día hay que
    // cambiarlo a mano, a propósito.
    expect(verificadoContraBanner(esquema)).toBe(false);
  });

  it("la descripción del curso se arma con lo que haya", () => {
    expect(descripcion(plantillaDe())).toBe("ANON-101 · 202610 · CRN 12345");
  });
});
