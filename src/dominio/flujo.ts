/**
 * Orquestación: del archivo del docente al análisis fila por fila.
 *
 * Une lector, mapeo e interpretación en una sola pasada, sin decidir nada por
 * su cuenta. Lo que produce no es un archivo sino un diagnóstico: qué se pudo
 * resolver, qué cambió y qué exige una decisión humana.
 *
 * Aquí viven también las validaciones que no son del campo nota sino de la fila
 * completa —código ausente, código duplicado— porque son igual de capaces de
 * arruinar un cargue (`plan.md` Fase 3, casos `D-03` y `D-07`).
 *
 * Port de `formateador/flujo.py`. Lo que allá es `analizar_archivo` no está
 * aquí: leer el archivo es I/O, así que ese paso vive en el caso de uso.
 */

import type { Analisis, Asignacion, Celda, FilaAnalizada, Tabla } from "./modelo.ts";
import { celdaVacia, formulaSinCalcular, ocultaPrecision, texto } from "./celda.ts";
import {
  CAMPO_CODIGO,
  CAMPO_NOMBRE,
  CAMPO_NOTA,
  type CatalogoAlias,
  mapear,
} from "./mapeo.ts";
import { ConfigValores, interpretar } from "./valores.ts";

/** Falta una columna imprescindible y nadie ha indicado cuál es. */
export class MapeoIncompleto extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "MapeoIncompleto";
  }
}

function celdaDe(fila: readonly Celda[], indice: number | null): Celda {
  if (indice === null || indice >= fila.length) return celdaVacia();
  return fila[indice] ?? celdaVacia();
}

export interface OpcionesAnalisis {
  readonly config?: ConfigValores;
  readonly mapa?: ReadonlyMap<string, Asignacion>;
  /**
   * Sobrescriben el mapeo automático con lo que el docente confirmó en la
   * interfaz. Es el mecanismo que hace cumplir la restricción §4.0: la máquina
   * propone, la persona confirma.
   */
  readonly indiceNota?: number;
  readonly indiceCodigo?: number;
}

/** Diagnostica una tabla ya leída. */
export function analizar(
  tabla: Tabla,
  catalogo: CatalogoAlias,
  opciones: OpcionesAnalisis = {},
): Analisis {
  const mapa = opciones.mapa ?? mapear(tabla.encabezados, catalogo);
  const config = opciones.config ?? new ConfigValores();

  const iNota = opciones.indiceNota ?? mapa.get(CAMPO_NOTA)?.indice ?? null;
  const iCodigo = opciones.indiceCodigo ?? mapa.get(CAMPO_CODIGO)?.indice ?? null;
  const iNombre = mapa.get(CAMPO_NOMBRE)?.indice ?? null;

  if (iNota === null) {
    throw new MapeoIncompleto(
      "No identifiqué la columna de la nota definitiva. Indícame cuál es: " +
        `las columnas del archivo son ${JSON.stringify(tabla.encabezados)}.`,
    );
  }
  if (iCodigo === null) {
    throw new MapeoIncompleto(
      "No identifiqué la columna del código de estudiante. Indícame cuál es: " +
        `las columnas del archivo son ${JSON.stringify(tabla.encabezados)}.`,
    );
  }

  const codigos = tabla.filas.map((f) => texto(celdaDe(f, iCodigo)).trim());

  const cuentas = new Map<string, number>();
  for (const codigo of codigos) {
    if (codigo) cuentas.set(codigo, (cuentas.get(codigo) ?? 0) + 1);
  }

  const filas: FilaAnalizada[] = tabla.filas.map((fila, desplazamiento) => {
    const numero = tabla.filaEncabezado + 1 + desplazamiento;
    const celdaNota = celdaDe(fila, iNota);
    const codigo = codigos[desplazamiento]!;

    const nota = interpretar(celdaNota.valor, config, {
      formulaSinCalcular: formulaSinCalcular(celdaNota),
    });

    const problemas: string[] = [];
    const repetido = cuentas.get(codigo) ?? 0;
    if (!codigo) {
      problemas.push("La fila no tiene código de estudiante.");
    } else if (repetido > 1) {
      problemas.push(`El código ${codigo} aparece ${repetido} veces en el archivo.`);
    }

    const avisos: string[] = [];
    if (ocultaPrecision(celdaNota)) {
      avisos.push(
        "Excel muestra esta nota con menos decimales de los que guarda " +
          `(${texto(celdaNota)}).`,
      );
    }

    return {
      numero,
      codigo,
      nombre: texto(celdaDe(fila, iNombre)).trim(),
      nota,
      problemas,
      avisos,
    };
  });

  return { tabla, mapa, indiceNota: iNota, filas };
}
