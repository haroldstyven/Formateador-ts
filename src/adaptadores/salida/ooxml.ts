/**
 * Lo mínimo de OOXML para leer una hoja y cambiar una celda **sin tocar el
 * resto del archivo**.
 *
 * Por qué no se usa una librería de Excel para esto: `plan.md` §2.2 exige que
 * el archivo de salida se produzca a partir del que Banner entregó, conservando
 * incluso las partes cuyo propósito no entendemos. Cualquier librería que abra
 * el libro y lo vuelva a serializar reescribe todo el contenedor — es
 * exactamente la divergencia que la referencia dejó anotada como `BL-07b`.
 *
 * Aquí el `.xlsx` se trata como lo que es: un zip con XML dentro. Se
 * descomprime, se empalma el texto de **una** celda en `sheet1.xml`, se
 * añade la cadena a `sharedStrings.xml`, y todo lo demás —estilos, tema,
 * relaciones, propiedades— se vuelve a empaquetar byte a byte como estaba.
 *
 * Sobre el parseo con expresiones regulares. Es deliberado, no pereza: un
 * parser de XML de verdad obligaría a reserializar, que es justo lo que se
 * quiere evitar. El XML de una hoja de cálculo lo genera una máquina y es
 * regular; aun así, `leerHoja` valida lo que asume y falla en voz alta si el
 * archivo no tiene la forma esperada, en vez de devolver celdas silenciosamente
 * vacías.
 */

import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

export const RUTA_HOJA_1 = "xl/worksheets/sheet1.xml";
export const RUTA_CADENAS = "xl/sharedStrings.xml";
export const RUTA_LIBRO = "xl/workbook.xml";

/** El archivo no tiene la forma de un `.xlsx` que podamos manipular. */
export class OoxmlInvalido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "OoxmlInvalido";
  }
}

/** Un `.xlsx` abierto: sus partes tal cual venían. */
export interface Libro {
  readonly partes: Map<string, Uint8Array>;
}

export function abrir(bytes: Uint8Array): Libro {
  let crudo: Record<string, Uint8Array>;
  try {
    crudo = unzipSync(bytes);
  } catch (e) {
    throw new OoxmlInvalido(`el archivo no es un zip válido: ${String(e)}`);
  }
  const partes = new Map(Object.entries(crudo));
  if (!partes.has(RUTA_HOJA_1)) {
    throw new OoxmlInvalido(
      `el archivo no tiene ${RUTA_HOJA_1}. ¿Es un .xlsx exportado por Banner?`,
    );
  }
  return { partes };
}

export function empaquetar(libro: Libro): Uint8Array {
  return zipSync(Object.fromEntries(libro.partes), { level: 6 });
}

export function texto(libro: Libro, ruta: string): string {
  const parte = libro.partes.get(ruta);
  if (!parte) throw new OoxmlInvalido(`falta la parte ${ruta}`);
  return strFromU8(parte);
}

function reemplazarParte(libro: Libro, ruta: string, contenido: string): void {
  libro.partes.set(ruta, strToU8(contenido));
}

// ---------------------------------------------------------------------------
// Entidades XML
// ---------------------------------------------------------------------------

const ENTIDADES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

export function desescapar(xml: string): string {
  return xml.replace(/&(?:amp|lt|gt|quot|apos|#x?[0-9A-Fa-f]+);/g, (e) => {
    const conocida = ENTIDADES[e];
    if (conocida !== undefined) return conocida;
    const hex = e.startsWith("&#x") || e.startsWith("&#X");
    const codigo = Number.parseInt(e.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : e;
  });
}

export function escapar(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** Texto de un `<si>` o `<is>`: la concatenación de sus `<t>`, con o sin runs. */
function textoDeNodo(xml: string): string {
  let salida = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?\/>|<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
    salida += m[1] === undefined ? "" : desescapar(m[1]);
  }
  return salida;
}

export function leerCadenasCompartidas(libro: Libro): string[] {
  if (!libro.partes.has(RUTA_CADENAS)) return [];
  const xml = texto(libro, RUTA_CADENAS);
  const cadenas: string[] = [];
  for (const m of xml.matchAll(/<si(?:\s[^>]*)?\/>|<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) {
    cadenas.push(m[1] === undefined ? "" : textoDeNodo(m[1]));
  }
  return cadenas;
}

/** Separa "H12" en su columna ("H") y su fila (12). */
export function partirReferencia(ref: string): { columna: string; fila: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new OoxmlInvalido(`referencia de celda inesperada: ${ref}`);
  return { columna: m[1]!, fila: Number.parseInt(m[2]!, 10) };
}

/** "A" -> 1, "H" -> 8, "AA" -> 27. */
export function indiceDeColumna(columna: string): number {
  let n = 0;
  for (const c of columna) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

/** 1 -> "A", 8 -> "H", 27 -> "AA". */
export function columnaDeIndice(indice: number): string {
  let n = indice;
  let salida = "";
  while (n > 0) {
    const resto = (n - 1) % 26;
    salida = String.fromCharCode(65 + resto) + salida;
    n = Math.floor((n - 1) / 26);
  }
  return salida;
}

/**
 * La hoja leída como texto: `celdas[fila][columna] = valor`.
 *
 * Todos los valores salen como cadena, incluidos los numéricos (§3.4). Una
 * celda ausente o vacía no aparece en el mapa.
 */
export interface Hoja {
  readonly celdas: ReadonlyMap<number, ReadonlyMap<string, string>>;
  readonly ultimaFila: number;
  readonly columnas: readonly string[];
}

export function leerHoja(libro: Libro, ruta = RUTA_HOJA_1): Hoja {
  const xml = texto(libro, ruta);
  const cadenas = leerCadenasCompartidas(libro);

  if (!/<sheetData\s*\/?>|<sheetData[\s>]/.test(xml)) {
    throw new OoxmlInvalido(`${ruta} no tiene <sheetData>: no parece una hoja`);
  }

  const celdas = new Map<number, Map<string, string>>();
  const columnas = new Set<string>();
  let ultimaFila = 0;

  const celda = /<c\s([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
  for (const m of xml.matchAll(celda)) {
    const atributos = m[1]!;
    const cuerpo = m[3] ?? "";

    const ref = /\br="([A-Z]+\d+)"/.exec(atributos)?.[1];
    if (!ref) continue;
    const { columna, fila } = partirReferencia(ref);

    ultimaFila = Math.max(ultimaFila, fila);
    columnas.add(columna);

    const tipo = /\bt="([^"]+)"/.exec(atributos)?.[1] ?? "n";
    let valor = "";

    if (tipo === "s") {
      const indice = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
      if (indice !== undefined) {
        const i = Number.parseInt(indice, 10);
        valor = cadenas[i] ?? "";
      }
    } else if (tipo === "inlineStr") {
      valor = textoDeNodo(cuerpo);
    } else {
      // "n", "str" (resultado de fórmula) y "b": el valor crudo, sin convertir.
      const v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
      valor = v === undefined ? "" : desescapar(v);
    }

    if (valor === "") continue;
    let filaMapa = celdas.get(fila);
    if (!filaMapa) {
      filaMapa = new Map();
      celdas.set(fila, filaMapa);
    }
    filaMapa.set(columna, valor);
  }

  const ordenadas = [...columnas].sort(
    (a, b) => indiceDeColumna(a) - indiceDeColumna(b),
  );
  return { celdas, ultimaFila, columnas: ordenadas };
}

export function valor(hoja: Hoja, fila: number, columna: string): string {
  return hoja.celdas.get(fila)?.get(columna) ?? "";
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

/**
 * Escribe texto en las celdas indicadas, **sin tocar nada más**.
 *
 * Las cadenas se añaden a `sharedStrings.xml` y la celda queda como `t="s"`,
 * que es lo que hace Excel al escribir en una casilla. Se eligió eso en vez de
 * `inlineStr` porque en la plantilla original **todas** las celdas de datos son
 * cadenas compartidas, y porque §5.0.2 da la única evidencia disponible sobre
 * qué acepta Banner: un archivo que pasó por Excel.
 *
 * El atributo `s` de la celda se conserva. En la plantilla oficial la columna
 * `Final Grade` ya viene con el estilo de texto (`numFmtId="49"`, o sea `@`),
 * así que respetarlo evita tener que tocar `styles.xml`.
 */
export function escribirTextoEnCeldas(
  libro: Libro,
  valores: ReadonlyMap<string, string>,
  ruta = RUTA_HOJA_1,
): void {
  if (valores.size === 0) return;

  let xml = texto(libro, ruta);
  const cadenas = leerCadenasCompartidas(libro);
  const indicePorCadena = new Map<string, number>();
  cadenas.forEach((c, i) => {
    if (!indicePorCadena.has(c)) indicePorCadena.set(c, i);
  });
  const nuevas: string[] = [];

  const indiceDe = (texto: string): number => {
    const existente = indicePorCadena.get(texto);
    if (existente !== undefined) return existente;
    const indice = cadenas.length + nuevas.length;
    indicePorCadena.set(texto, indice);
    nuevas.push(texto);
    return indice;
  };

  for (const [ref, contenido] of valores) {
    const indice = indiceDe(contenido);
    xml = empalmarCelda(xml, ref, indice);
  }

  reemplazarParte(libro, ruta, xml);
  if (nuevas.length) agregarCadenas(libro, cadenas.length, nuevas, xml);
}

/** Sustituye (o inserta) una celda con una referencia a cadena compartida. */
function empalmarCelda(xml: string, ref: string, indiceCadena: number): string {
  const existente = new RegExp(
    `<c\\s([^>]*?\\br="${ref}"[^>]*?)(?:/>|>[\\s\\S]*?</c>)`,
  ).exec(xml);

  if (existente) {
    const atributos = existente[1]!
      .replace(/\s*\bt="[^"]*"/g, "")
      .trimEnd();
    const nueva = `<c ${atributos} t="s"><v>${indiceCadena}</v></c>`;
    return xml.slice(0, existente.index) + nueva + xml.slice(existente.index + existente[0].length);
  }

  return insertarCeldaEnFila(xml, ref, indiceCadena);
}

/**
 * Inserta una celda que no existía, en su posición por columna dentro de la
 * fila. La plantilla oficial trae todas las celdas, pero un archivo que pasó
 * por otra herramienta puede haber omitido las vacías.
 */
function insertarCeldaEnFila(xml: string, ref: string, indiceCadena: number): string {
  const { columna, fila } = partirReferencia(ref);
  const nueva = `<c r="${ref}" t="s"><v>${indiceCadena}</v></c>`;

  const filaRe = new RegExp(`<row\\s([^>]*?\\br="${fila}"[^>]*?)(?:/>|>([\\s\\S]*?)</row>)`);
  const m = filaRe.exec(xml);
  if (!m) {
    throw new OoxmlInvalido(
      `la hoja no tiene la fila ${fila}, y crear filas nuevas no está soportado: ` +
        "el listado lo pone Banner, la herramienta solo rellena una columna.",
    );
  }

  const cuerpo = m[2] ?? "";
  const objetivo = indiceDeColumna(columna);
  let posicion = cuerpo.length;

  for (const c of cuerpo.matchAll(/<c\s([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)) {
    const refActual = /\br="([A-Z]+\d+)"/.exec(c[1]!)?.[1];
    if (!refActual) continue;
    if (indiceDeColumna(partirReferencia(refActual).columna) > objetivo) {
      posicion = c.index;
      break;
    }
  }

  const cuerpoNuevo = cuerpo.slice(0, posicion) + nueva + cuerpo.slice(posicion);
  const filaNueva = `<row ${m[1]!.trimEnd()}>${cuerpoNuevo}</row>`;
  return xml.slice(0, m.index) + filaNueva + xml.slice(m.index + m[0].length);
}

/**
 * Añade cadenas nuevas al final de `sharedStrings.xml` y recalcula sus dos
 * contadores. `uniqueCount` es cuántos `<si>` hay; `count`, cuántas celdas
 * apuntan a uno — y ese se recuenta sobre la hoja ya parcheada, no se estima.
 */
function agregarCadenas(
  libro: Libro,
  cuantasHabia: number,
  nuevas: readonly string[],
  hojaXml: string,
): void {
  const anteriores = libro.partes.has(RUTA_CADENAS) ? texto(libro, RUTA_CADENAS) : "";

  const cierre = anteriores.lastIndexOf("</sst>");
  if (cierre === -1) {
    throw new OoxmlInvalido(
      "el archivo no tiene una tabla de cadenas compartidas utilizable",
    );
  }

  const items = nuevas
    .map((c) => `<si><t${/^\s|\s$/.test(c) ? ' xml:space="preserve"' : ""}>${escapar(c)}</t></si>`)
    .join("");

  const total = [...hojaXml.matchAll(/<c\s[^>]*\bt="s"/g)].length;
  const unicas = cuantasHabia + nuevas.length;

  let xml = anteriores.slice(0, cierre) + items + "</sst>";
  xml = xml.replace(/(<sst\b[^>]*?)\scount="\d+"/, "$1").replace(
    /(<sst\b[^>]*?)\suniqueCount="\d+"/,
    "$1",
  );
  xml = xml.replace(/<sst\b([^>]*?)>/, `<sst$1 count="${total}" uniqueCount="${unicas}">`);

  reemplazarParte(libro, RUTA_CADENAS, xml);
}
