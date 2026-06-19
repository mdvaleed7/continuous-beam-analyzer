import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: '--font-inter' });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: '--font-jetbrains-mono' });

export const metadata = {
  title: "Continuous Beam Analyzer",
  description: "Advanced symbolic and numeric analysis of continuous beams. Calculate shear forces, bending moments, and reactions precisely.",
  keywords: ["civil engineering", "structural analysis", "continuous beam", "bending moment", "shear force diagram", "calculator", "mechanics of materials"],
  authors: [{ name: "Civil Engineer" }],
  openGraph: {
    title: "Continuous Beam Analyzer",
    description: "Advanced symbolic and numeric continuous beam calculator.",
    // Use the deployment URL via env var; no hardcoded fallback that may 404.
    ...(process.env.NEXT_PUBLIC_APP_URL
      ? { url: process.env.NEXT_PUBLIC_APP_URL, siteName: "Continuous Beam Analyzer", type: "website" }
      : {}),
  },
  twitter: {
    card: "summary_large_image",
    title: "Continuous Beam Analyzer",
    description: "Calculate accurate shear force and bending moment diagrams for continuous beams.",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
