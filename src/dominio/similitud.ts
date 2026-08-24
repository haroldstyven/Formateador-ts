/**
 * Port de `difflib.SequenceMatcher(None, a, b).ratio()` de la librería estándar
 * de Python.
 *
 * Existe como módulo propio porque es la única pieza del port que no traduce
 * código nuestro sino código ajeno, y porque de su exactitud depende que los
 * umbrales de `mapeo.ts` —0.90, 0.78, 0.08— sigan significando lo mismo que en
 * la implementación de referencia. Un "casi igual" aquí no se nota en ningún
 * test de mapeo salvo justo en la frontera, que es donde importa.
 *
 * `plan.md` §4.2 menciona `rapidfuzz`, pero la implementación de referencia
 * nunca lo usó: usa `difflib`. Es una suerte, porque `difflib` es un algoritmo
 * fijo y reproducible —Ratcliff-Obershelp— y no una heurística con parámetros.
 * Por eso el port puede ser exacto en vez de recalibrado.
 *
 * El algoritmo: se busca el bloque coincidente contiguo más largo, y luego se
 * repite recursivamente a izquierda y a derecha de ese bloque. `ratio` es
 * `2 * M / T`, con M el total de caracteres coincidentes y T la suma de las dos
 * longitudes.
 */

/** Índices de cada carácter dentro de `b`, con la heurística `autojunk`. */
function indicesDeB(b: string): Map<string, number[]> {
  const b2j = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) {
    const c = b[j]!;
    const lista = b2j.get(c);
    if (lista) lista.push(j);
    else b2j.set(c, [j]);
  }

  // `autojunk`: en secuencias de 200 o más elementos, Python descarta del
  // índice los caracteres que aparecen en más del 1%. Con encabezados nunca se
  // activa, pero omitirlo dejaría una divergencia latente para una entrada
  // larga que nadie probó.
  const n = b.length;
  if (n >= 200) {
    const limite = Math.floor(n / 100) + 1;
    for (const [c, idxs] of [...b2j]) {
      if (idxs.length > limite) b2j.delete(c);
    }
  }

  return b2j;
}

/** Devuelve `[i, j, tamaño]` del bloque coincidente más largo en los rangos dados. */
function bloqueMasLargo(
  a: string,
  b: string,
  b2j: ReadonlyMap<string, number[]>,
  alo: number,
  ahi: number,
  blo: number,
  bhi: number,
): [number, number, number] {
  let besti = alo;
  let bestj = blo;
  let bestsize = 0;

  // j2len[j] = longitud del bloque que termina en a[i-1] y b[j-1].
  let j2len = new Map<number, number>();

  for (let i = alo; i < ahi; i++) {
    const nuevo = new Map<number, number>();
    const idxs = b2j.get(a[i]!);
    if (idxs) {
      for (const j of idxs) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        nuevo.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
    }
    j2len = nuevo;
  }

  // Extensión a ambos lados. Sin `isjunk` estas dos vueltas solo tienen efecto
  // sobre caracteres que `autojunk` sacó del índice; Python las corre igual.
  while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
    besti--;
    bestj--;
    bestsize++;
  }
  while (
    besti + bestsize < ahi &&
    bestj + bestsize < bhi &&
    a[besti + bestsize] === b[bestj + bestsize]
  ) {
    bestsize++;
  }

  return [besti, bestj, bestsize];
}

/** Total de caracteres coincidentes, sumando todos los bloques. */
function totalCoincidencias(a: string, b: string): number {
  const b2j = indicesDeB(b);
  let total = 0;

  const cola: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (cola.length) {
    const [alo, ahi, blo, bhi] = cola.pop()!;
    const [i, j, k] = bloqueMasLargo(a, b, b2j, alo, ahi, blo, bhi);
    if (k) {
      total += k;
      if (alo < i && blo < j) cola.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) cola.push([i + k, ahi, j + k, bhi]);
    }
  }

  return total;
}

/**
 * Parecido entre dos cadenas, en `[0, 1]`.
 *
 * Equivale exactamente a `SequenceMatcher(None, a, b).ratio()`. Dos cadenas
 * vacías dan 1.0, igual que en Python.
 */
export function ratio(a: string, b: string): number {
  const total = a.length + b.length;
  if (total === 0) return 1.0;
  return (2.0 * totalCoincidencias(a, b)) / total;
}
