"use client";

/**
 * El paso de confirmación de la restricción §4.0.
 *
 * Es el único punto del flujo donde preguntar es preferible a acertar. El
 * archivo del docente tiene cuatro columnas numéricas en escala 0.0–5.0
 * —trabajos, quizes, examen y definitiva— y **elegir mal no produce ningún
 * síntoma**: el archivo sale con formato impecable, Banner lo acepta, y el
 * curso queda calificado con las notas del parcial.
 *
 * Por eso no se muestra solo el nombre de la columna: se muestran los primeros
 * valores reales. Ver el encabezado y los datos juntos es lo que hace evidente
 * que se eligió `examen` en vez de `definitiva`.
 */

import { useState } from "react";

import type { Tabla } from "@dominio/modelo.ts";
import { muestra } from "@dominio/tabla.ts";

export interface Props {
  readonly texto: string;
  readonly encabezados: readonly string[];
  readonly tabla: Tabla;
  readonly sugerida: number;
  readonly onConfirmar: (indice: number) => void;
}

export function ConfirmarColumna({
  texto,
  encabezados,
  tabla,
  sugerida,
  onConfirmar,
}: Props) {
  const [elegida, setElegida] = useState(sugerida);
  const valores = muestra(tabla, elegida);

  return (
    <section className="tarjeta">
      <h2>Confirma cuál es la nota definitiva</h2>
      <p>{texto}</p>

      <label>
        <select
          value={elegida}
          onChange={(e) => setElegida(Number(e.target.value))}
          aria-label="Columna de la nota definitiva"
        >
          {encabezados.map((encabezado, i) => (
            <option key={`${encabezado}-${i}`} value={i}>
              {encabezado || `(columna ${i + 1} sin nombre)`}
            </option>
          ))}
        </select>
      </label>

      <p style={{ marginBottom: 0, marginTop: "1rem", fontSize: "0.9rem" }}>
        Primeros valores de esa columna:
      </p>
      <div className="muestra">
        {valores.length > 0 ? (
          valores.map((v, i) => <span key={`${v}-${i}`}>{v}</span>)
        ) : (
          <span>(sin datos)</span>
        )}
      </div>

      <p className="alerta aviso">
        Si esta no es la columna correcta, el archivo saldrá perfectamente bien
        formado y con las notas equivocadas. Por eso te lo pregunto aunque esté
        seguro.
      </p>

      <div className="acciones">
        <button type="button" className="boton" onClick={() => onConfirmar(elegida)}>
          Sí, es esta columna
        </button>
      </div>
    </section>
  );
}
