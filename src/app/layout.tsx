import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";

export const metadata: Metadata = {
  title: "Hermess — умный ИИ-чат",
  description:
    "Современный ИИ-ассистент Hermess с поддержкой стриминга, картинок, веб-поиска и редактора системных промптов.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className="app-bg min-h-screen text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
