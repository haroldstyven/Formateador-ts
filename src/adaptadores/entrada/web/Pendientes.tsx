"use client";

/**
 * Lo que espera una decisión del docente.
 *
 * Se pregunta **una vez por token, no una por fila**: "hay 4 estudiantes con
 * NP", no cuatro preguntas idénticas (§0.3.1).
 *
 * Lo que este componente NO hace, y es lo importante: ofrecer un valor por
 * defecto. No hay un botón que diga "poner 0.0 a todos los pendientes" ni una
 * casilla premarcada. Un reemplazo aplicado a un token que nadie revisó es
 * exactamente el mecanismo que reprueba estudiantes en silencio, y el dominio
 * lo bloquea al cargar la configuración (§0.3.1) — la interfaz no debería ser
 * la que intente saltárselo.
 */

import { useMemo, useState } from "react";

import type { ResultadoCompleto } from "@aplicacion/formatear-notas.ts";
import { pendientesPorToken } from "@dominio/analisis.ts";
import { ConfigValores } from "@dominio/valores.ts";

export interface Props {
  readonly resultado: ResultadoCompleto;
  readonly onDecidir: (config: ConfigValores) => void;
}

type Accion = "" | "reemplazar" | "dejar_vacio" | "descartar_fila";

export function Pendientes({ resultado, onDecidir }: Props) {
  const grupos = useMemo(
    () => [...pendientesPorToken(resultado.analisis).entries()],
    [resultado],
  );
  const [acciones, setAcciones] = useState<Record<string, Accion>>({});
  const [valores, setValores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const otrosBloqueos = resultado.bloqueos.filter(
    (b) => b.estado !== "valor no numérico",
  );

  if (grupos.length === 0 && otrosBloqueos.length === 0) return null;

  const aplicar = () => {
    const tokens: Record<string, Record<string, string>> = {};
    for (const [token] of grupos) {
      const accion = acciones[token];
      if (!accion) continue;
      tokens[token] =
        accion === "reemplazar"
          ? { accion, valor: (valores[token] ?? "").trim() }
          : { accion };
    }
    try {
      // La validación la hace el dominio, no esta pantalla: un reemplazo sin
      // valor, fuera de escala o no numérico se rechaza aquí mismo y con su
      // motivo, en vez de colarse hasta el archivo.
      onDecidir(ConfigValores.desdeObjeto({ tokens }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="tarjeta">
      <h2>Esto necesita que decidas tú</h2>

      {grupos.length > 0 && (
        <>
          <p style={{ fontSize: "0.92rem" }}>
            Encontré valores que no son notas. No voy a inventar ninguno: dime
            qué hacer con cada uno.
          </p>

          {grupos.map(([token, filas]) => (
            <div key={token} style={{ marginBottom: "1.25rem" }}>
              <h3>
                <span className="mono">{filas[0]!.nota.original}</span> —{" "}
                {filas.length} estudiante(s)
              </h3>
              <p style={{ fontSize: "0.85rem", margin: "0 0 0.5rem" }}>
                Filas {filas.map((f) => f.numero).join(", ")}
              </p>

              <label>
                <select
                  value={acciones[token] ?? ""}
                  onChange={(e) =>
                    setAcciones({ ...acciones, [token]: e.target.value as Accion })
                  }
                  aria-label={`Qué hacer con ${token}`}
                >
                  <option value="">Elige qué hacer…</option>
                  <option value="reemplazar">Poner una nota concreta</option>
                  <option value="dejar_vacio">Dejar sin nota (no se podrá cargar)</option>
                  <option value="descartar_fila">Excluir del cargue</option>
                </select>
              </label>

              {acciones[token] === "reemplazar" && (
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={valores[token] ?? ""}
                  onChange={(e) => setValores({ ...valores, [token]: e.target.value })}
                  aria-label={`Nota para ${token}`}
                  style={{
                    marginLeft: "0.5rem",
                    font: "inherit",
                    padding: "0.45rem 0.6rem",
                    borderRadius: "var(--radio)",
                    border: "1px solid var(--primary-light)",
                    width: "6rem",
                  }}
                />
              )}
            </div>
          ))}

          {error !== null && <p className="alerta error">{error}</p>}

          <div className="acciones">
            <button type="button" className="boton" onClick={aplicar}>
              Aplicar estas decisiones
            </button>
          </div>
        </>
      )}

      {otrosBloqueos.length > 0 && (
        <>
          <h3 style={{ marginTop: grupos.length ? "1.5rem" : 0 }}>
            Lo que hay que arreglar en el archivo
          </h3>
          <div className="tabla-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>Documento</th>
                  <th>Valor</th>
                  <th>Qué pasa</th>
                </tr>
              </thead>
              <tbody>
                {otrosBloqueos.map((b, i) => (
                  <tr key={`${b.fila}-${i}`}>
                    <td className="mono">{b.fila || "—"}</td>
                    <td className="mono">{b.codigo || "—"}</td>
                    <td className="mono">{b.valor || "(vacío)"}</td>
                    <td>{b.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
