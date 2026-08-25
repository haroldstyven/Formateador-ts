/**
 * Lector tolerante: absorbe el desorden del archivo del docente.
 *
 * Port de la parte de I/O de `formateador/lectura.py`. Cubre lo que `plan.md`
 * §3 exige de la entrada —encabezados fuera de la fila 1, columnas sobrantes,
 * hojas múltiples, filas vacías intercaladas y celdas combinadas— y las dos
 * trampas documentadas.
 *
 * §3.1 — **Fórmulas sin calcular.** La referencia abre el archivo **dos veces**
 * con openpyxl, una por valores y otra por fórmulas, porque `data_only=True`
 * colapsa los dos casos en `None`. Aquí no hace falta abrirlo dos veces: en el
 * XML la fórmula (`<f>`) y su valor cacheado (`<v>`) están en la misma celda,
 * así que una sola pasada los distingue. El resultado es idéntico; el
 * mecanismo, más simple.
 *
 * §3.2 — **Excel muestra un valor y guarda otro.** El formato numérico sale de
 * `styles.xml` a través del atributo `s` de la celda. La decisión de si eso
 * oculta precisión la toma el dominio (`celda.ts`), no este adaptador.
 *
 * §3.4 — **Todo se lee como texto.** Se toma el contenido crudo de `<v>` sin
 * convertirlo a número, así que un código con ceros a la izquierda llega
 * intacto por construcción y no por disciplina.
 */

import type { ArchivoEntrante, LectorDeArchivos } from "@aplicacion/puertos.ts";
import type { Celda, Tabla } from "@dominio/modelo.ts";
import { formulaSinCalcular } from "@dominio/celda.ts";
import type { CatalogoAlias } from "@dominio/mapeo.ts";
import { SinEncabezado, armarTabla } from "@dominio/tabla.ts";
import {
  type CeldaCruda,
  type Libro,
  OoxmlInvalido,
  abrir,
  hojas,
  leerMatriz,
} from "./ooxml.ts";
import { esPlantillaBanner } from "./plantilla-zip.ts";

/** El orden en que se intenta decodificar un archivo de texto. */
export const CODIFICACIONES = ["utf-8", "windows-1252", "latin1"] as const;

/** La extensión no se puede leer, con una explicación accionable. */
export class ArchivoNoSoportado extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ArchivoNoSoportado";
  }
}

function extension(nombre: string): string {
  const punto = nombre.lastIndexOf(".");
  return punto === -1 ? "" : nombre.slice(punto).toLowerCase();
}

/** Lee un archivo de notas en cualquiera de los formatos admitidos. */
export function leer(archivo: ArchivoEntrante, catalogo: CatalogoAlias): Tabla {
  const sufijo = extension(archivo.nombre);

  if (sufijo === ".xlsx" || sufijo === ".xlsm") {
    return { ...leerXlsx(archivo, catalogo), origen: archivo.nombre };
  }
  if (sufijo === ".csv" || sufijo === ".txt") {
    return { ...leerTexto(archivo, catalogo), origen: archivo.nombre };
  }
  if (sufijo === ".xls") {
    throw new ArchivoNoSoportado(
      "El formato .xls es de Excel 97-2003 y no se puede leer directamente. " +
        "Abre el archivo en Excel y guárdalo como .xlsx.",
    );
  }
  throw new ArchivoNoSoportado(
    `No sé leer archivos '${sufijo}'. Admito .xlsx, .xlsm, .csv y .txt.`,
  );
}

function aCelda(cruda: CeldaCruda): Celda {
  return { valor: cruda.valor, formula: cruda.formula, formato: cruda.formato };
}

function leerXlsx(archivo: ArchivoEntrante, catalogo: CatalogoAlias): Tabla {
  let libro: Libro;
  try {
    libro = abrir(archivo.bytes);
  } catch (e) {
    throw new ArchivoNoSoportado(
      e instanceof OoxmlInvalido
        ? `${e.message} Si es un archivo de Excel antiguo, guárdalo como .xlsx.`
        : String(e),
    );
  }

  const partes = hojas(libro);
  let mejor: Tabla | null = null;
  const errores: string[] = [];

  for (const { nombre, ruta } of partes) {
    const matriz = leerMatriz(libro, ruta).map((fila) => fila.map(aCelda));
    try {
      const tabla = armarTabla(matriz, catalogo, nombre);
      // Se queda la hoja con más filas: en un libro con varias, la del curso
      // es casi siempre la más larga.
      if (mejor === null || tabla.filas.length > mejor.filas.length) mejor = tabla;
    } catch (e) {
      if (e instanceof SinEncabezado) {
        errores.push(`${nombre}: ${e.message}`);
        continue;
      }
      throw e;
    }
  }

  if (mejor === null) {
    throw new SinEncabezado(
      "Ninguna hoja del archivo tiene una tabla reconocible. " + errores.join(" "),
    );
  }

  const incidencias = [...mejor.incidencias];
  if (partes.length > 1) {
    incidencias.push(
      `El archivo tiene ${partes.length} hojas; usé '${mejor.hoja}'.`,
    );
  }

  const sinCalcular = mejor.filas.reduce(
    (n, fila) => n + fila.filter(formulaSinCalcular).length,
    0,
  );
  if (sinCalcular) {
    incidencias.push(
      `${sinCalcular} celda(s) tienen fórmulas sin calcular. Abre el archivo ` +
        "en Excel, guárdalo con Ctrl+S y vuelve a subirlo.",
    );
  }

  return { ...mejor, incidencias };
}

/**
 * Decodifica probando la misma cascada que la referencia.
 *
 * Un `.csv` exportado por Excel en Windows suele venir en cp1252, no en UTF-8,
 * y si se decodifica mal el nombre del estudiante llega con basura. `fatal:
 * true` es lo que hace que el intento falle en vez de rellenar con `�`.
 */
export function decodificar(bytes: Uint8Array): string {
  for (const codificacion of CODIFICACIONES) {
    try {
      const texto = new TextDecoder(codificacion, { fatal: true }).decode(bytes);
      // El BOM de utf-8 no es contenido: si se deja, contamina el primer
      // encabezado y el mapeo deja de reconocerlo.
      return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
    } catch {
      continue;
    }
  }
  throw new ArchivoNoSoportado(
    "No pude determinar la codificación del archivo. Guárdalo como UTF-8 o como .xlsx.",
  );
}

/**
 * Elige el delimitador contando cuál aparece más en las primeras líneas.
 *
 * La referencia usa `csv.Sniffer` y cae a este mismo conteo cuando falla. Aquí
 * se hace directamente el conteo: es lo que decide en la práctica, y Excel en
 * configuración regional colombiana exporta con punto y coma.
 */
export function detectarDelimitador(texto: string): string {
  const muestra = texto.slice(0, 4096);
  const candidatos = [";", ",", "\t", "|"];
  let mejor = ",";
  let mejorCuenta = 0;
  for (const candidato of candidatos) {
    const cuenta = muestra.split(candidato).length - 1;
    if (cuenta > mejorCuenta) {
      mejor = candidato;
      mejorCuenta = cuenta;
    }
  }
  return mejor;
}

/** Lector de CSV con comillas dobles, escapadas duplicándolas. */
export function partirCsv(texto: string, delimitador: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;

    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }

    if (c === '"') {
      entreComillas = true;
    } else if (c === delimitador) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else {
      campo += c;
    }
  }

  if (campo !== "" || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

function leerTexto(archivo: ArchivoEntrante, catalogo: CatalogoAlias): Tabla {
  const texto = decodificar(archivo.bytes);
  const delimitador = detectarDelimitador(texto);

  const matriz: Celda[][] = partirCsv(texto, delimitador).map((fila) =>
    fila.map((valor) => ({ valor, formula: null, formato: null })),
  );

  if (matriz.length === 0) throw new SinEncabezado("El archivo está vacío.");

  const tabla = armarTabla(matriz, catalogo, archivo.nombre);
  return {
    ...tabla,
    incidencias: [
      ...tabla.incidencias,
      `Archivo de texto leído con delimitador '${delimitador}'.`,
    ],
  };
}

/** Implementación del puerto, para inyectarla en el caso de uso. */
export class LectorXlsx implements LectorDeArchivos {
  constructor(private readonly catalogo: CatalogoAlias) {}

  async leer(archivo: ArchivoEntrante): Promise<Tabla> {
    return leer(archivo, this.catalogo);
  }

  async esPlantillaBanner(archivo: ArchivoEntrante): Promise<boolean> {
    return esPlantillaBanner(archivo);
  }
}
