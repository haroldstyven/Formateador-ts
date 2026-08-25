/**
 * Tests de arquitectura: las dos promesas que no puede sostener la disciplina.
 *
 * 1. **La regla de dependencia del hexágono.** Las flechas apuntan hacia
 *    adentro. Si el dominio empieza a importar adaptadores, deja de poder
 *    correr en el navegador y el port pierde lo que lo hacía valioso.
 *
 * 2. **Que el procesamiento ocurra en el navegador.** Es lo que hace literal la
 *    promesa de que el archivo del docente no sale de su computador. Un solo
 *    `import` de `node:fs` en la cadena que llega al componente cliente la
 *    rompe, y el fallo aparecería en tiempo de ejecución, en el navegador de un
 *    docente, no aquí.
 *
 * Los dos son revisables a ojo, y por eso mismo se escapan en una revisión
 * apurada. Un test no se cansa.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

function archivosDe(directorio: string): string[] {
  const base = `${RAIZ}${directorio}`;
  const salida: string[] = [];
  const recorrer = (ruta: string) => {
    for (const entrada of readdirSync(ruta)) {
      const completa = `${ruta}/${entrada}`;
      if (statSync(completa).isDirectory()) recorrer(completa);
      else if (/\.tsx?$/.test(entrada)) salida.push(completa);
    }
  };
  recorrer(base);
  return salida;
}

function importaciones(archivo: string): string[] {
  const codigo = readFileSync(archivo, "utf-8");
  const especificadores: string[] = [];
  for (const m of codigo.matchAll(/from\s+["']([^"']+)["']/g)) {
    especificadores.push(m[1]!);
  }
  return especificadores;
}

function relativo(archivo: string): string {
  return archivo.slice(RAIZ.length);
}

describe("la regla de dependencia del hexágono", () => {
  it("el dominio no importa la aplicación ni los adaptadores", () => {
    const infracciones: string[] = [];
    for (const archivo of archivosDe("src/dominio")) {
      for (const especificador of importaciones(archivo)) {
        if (/@aplicacion|@adaptadores|\.\.\/(aplicacion|adaptadores)/.test(especificador)) {
          infracciones.push(`${relativo(archivo)} importa ${especificador}`);
        }
      }
    }
    expect(infracciones, infracciones.join("\n")).toEqual([]);
  });

  it("la aplicación no importa adaptadores concretos, solo sus puertos", () => {
    const infracciones: string[] = [];
    for (const archivo of archivosDe("src/aplicacion")) {
      for (const especificador of importaciones(archivo)) {
        if (/@adaptadores|\.\.\/adaptadores/.test(especificador)) {
          infracciones.push(`${relativo(archivo)} importa ${especificador}`);
        }
      }
    }
    expect(infracciones, infracciones.join("\n")).toEqual([]);
  });

  it("el dominio no depende de ninguna librería de archivos", () => {
    // decimal.js es la única dependencia externa que el dominio puede tener.
    const permitidas = /^(decimal\.js|\.\/|\.\.\/)/;
    const infracciones: string[] = [];
    for (const archivo of archivosDe("src/dominio")) {
      for (const especificador of importaciones(archivo)) {
        if (!permitidas.test(especificador)) {
          infracciones.push(`${relativo(archivo)} importa ${especificador}`);
        }
      }
    }
    expect(infracciones, infracciones.join("\n")).toEqual([]);
  });
});

describe("el procesamiento corre en el navegador", () => {
  it("nada de lo que llega al componente cliente importa APIs de Node", () => {
    // `fflate` y `decimal.js` funcionan en el navegador; `node:fs` no. Si esto
    // falla, la promesa de la pantalla dejó de ser cierta.
    const infracciones: string[] = [];
    const rutas = ["src/dominio", "src/aplicacion", "src/adaptadores"];

    for (const ruta of rutas) {
      for (const archivo of archivosDe(ruta)) {
        for (const especificador of importaciones(archivo)) {
          if (/^node:|^fs$|^path$|^crypto$|^os$/.test(especificador)) {
            infracciones.push(`${relativo(archivo)} importa ${especificador}`);
          }
        }
      }
    }
    expect(infracciones, infracciones.join("\n")).toEqual([]);
  });

  it("la aplicación se exporta estática, así que no hay servidor que reciba notas", () => {
    const config = readFileSync(`${RAIZ}next.config.ts`, "utf-8");
    expect(config).toContain('output: "export"');
  });

  it("solo el componente de más arriba es cliente; la página es servidor", () => {
    // Si `page.tsx` fuera cliente daría igual, pero mantenerla en servidor deja
    // explícito que lo que se hidrata es únicamente el formateador.
    const pagina = readFileSync(`${RAIZ}src/app/page.tsx`, "utf-8");
    expect(pagina).not.toContain('"use client"');

    for (const archivo of archivosDe("src/adaptadores/entrada/web")) {
      expect(readFileSync(archivo, "utf-8"), relativo(archivo)).toContain(
        '"use client"',
      );
    }
  });
});

describe("el único sitio que redondea", () => {
  it("nadie más llama a toFixed, Math.round ni construye un Decimal a mano", () => {
    // La regla de `redondeo.ts` en forma de test. `toFixed` sobre un `Decimal`
    // de decimal.js sí es correcto —es su formateo exacto—, lo prohibido es
    // sobre un `number`.
    const infracciones: string[] = [];
    for (const archivo of [...archivosDe("src/dominio"), ...archivosDe("src/aplicacion")]) {
      if (/redondeo\.ts$/.test(archivo)) continue;
      const codigo = readFileSync(archivo, "utf-8");
      for (const patron of [/Math\.round\(/, /Number\([^)]*\)\.toFixed\(/]) {
        if (patron.test(codigo)) {
          infracciones.push(`${relativo(archivo)} usa ${patron.source}`);
        }
      }
    }
    expect(infracciones, infracciones.join("\n")).toEqual([]);
  });
});
