"use client";

/**
 * El diff que ve el docente: la regla de oro 4 hecha pantalla.
 *
 * Ninguna nota se modifica en silencio. Cada redondeo, cada sustitución
 * autorizada y cada corrección de formato aparece con su valor original al lado
 * del final — incluida una coma cambiada por punto, que no altera el valor pero
 * sí es algo que la herramienta tocó.
 *
 * §4.4: la prosa nunca es la fuente de verdad. Por eso el motivo se muestra
 * **junto** al antes y el después literales, nunca en su lugar.
 */

import type { ResultadoCompleto } from "@aplicacion/formatear-notas.ts";
import { reporteAJson } from "@dominio/reporte.ts";
import { sobrescribenNota } from "@dominio/plantilla.ts";

export interface Props {
  readonly resultado: ResultadoCompleto;
}

export function Diff({ resultado }: Props) {
  const { reporte, cruce } = resultado;
  const r = reporte.resumen;
  const reemplazos = sobrescribenNota(cruce);

  return (
    <section className="tarjeta">
      <h2>Qué encontré</h2>

      <ul className="resumen">
        <li>
          <b>{r.filas_leidas}</b> filas leídas
        </li>
        <li>
          <b>{r.listas_para_cargar}</b> listas para cargar
        </li>
        <li>
          <b>{r.notas_redondeadas}</b> redondeadas
        </li>
        <li>
          <b>{r.requieren_decision}</b> requieren decisión
        </li>
      </ul>

      {reporte.cambios.length > 0 ? (
        <>
          <p style={{ fontSize: "0.9rem" }}>
            Esto es todo lo que cambié. Nada más se tocó.
          </p>
          <div className="tabla-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>Documento</th>
                  <th>Estudiante</th>
                  <th>Antes</th>
                  <th>Después</th>
                  <th>Por qué</th>
                </tr>
              </thead>
              <tbody>
                {reporte.cambios.map((c) => (
                  <tr key={`${c.fila}-${c.codigo}`}>
                    <td className="mono">{c.fila}</td>
                    <td className="mono">{c.codigo}</td>
                    <td>{c.nombre}</td>
                    <td className="antes mono">{c.antes}</td>
                    <td className="despues mono">{c.despues}</td>
                    <td>{c.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="alerta info">
          No hubo que cambiar ninguna nota: todas venían ya con un decimal y
          dentro de la escala.
        </p>
      )}

      {reemplazos.length > 0 && (
        <p className="alerta aviso">
          <strong>
            {reemplazos.length} estudiante(s) ya tenían nota en Banner
          </strong>{" "}
          y este cargue la va a reemplazar. Revísalo antes de subir.
        </p>
      )}

      {cruce.sobrantes.length > 0 && (
        <details>
          <summary>
            {cruce.sobrantes.length} estudiante(s) de tu archivo no están en el
            curso
          </summary>
          <p style={{ fontSize: "0.9rem" }}>
            No se cargan: quien no está en la lista de Banner no está
            matriculado en este curso. Aparecen aquí para que no desaparezcan en
            silencio.
          </p>
          <ul>
            {cruce.sobrantes.map((f) => (
              <li key={f.numero} className="mono">
                fila {f.numero} · {f.codigo} · {f.nombre}
              </li>
            ))}
          </ul>
        </details>
      )}

      {reporte.avisos.length > 0 && (
        <details>
          <summary>Avisos ({reporte.avisos.length})</summary>
          <ul>
            {reporte.avisos.map((a, i) => (
              <li key={i} style={{ fontSize: "0.9rem" }}>
                {a}
              </li>
            ))}
          </ul>
        </details>
      )}

      <details>
        <summary>Las cuatro reglas de oro, sobre este archivo</summary>
        <p style={{ fontSize: "0.9rem" }}>
          Comprobadas sobre tus datos, no en abstracto.
        </p>
        <ul>
          {Object.entries(reporte.reglas_de_oro).map(([regla, cumple]) => (
            <li key={regla} style={{ fontSize: "0.9rem" }}>
              {cumple ? "✓" : "✗"} {regla.replaceAll("_", " ")}
            </li>
          ))}
        </ul>
      </details>

      <details>
        <summary>Reporte completo (JSON)</summary>
        <pre className="mono tabla-scroll" style={{ fontSize: "0.75rem" }}>
          {reporteAJson(reporte)}
        </pre>
      </details>
    </section>
  );
}
