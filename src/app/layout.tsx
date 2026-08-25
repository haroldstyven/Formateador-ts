import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Formateador de notas para Banner",
  description:
    "Toma el archivo de notas del docente y produce el archivo que Banner acepta. " +
    "El procesamiento ocurre en tu navegador: ningún dato sale de tu computador.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
