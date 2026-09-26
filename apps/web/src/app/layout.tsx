import type { Metadata } from "next"
import { Archivo, Archivo_Narrow, JetBrains_Mono } from "next/font/google"
import { Footer } from "@/components/Footer"
import { LiveBand } from "@/components/LiveBand"
import { Nav } from "@/components/Nav"
import "./globals.css"
import "./ui.css"
import "./intel.css"

const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
})

const archivoNarrow = Archivo_Narrow({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-archivo-narrow",
  display: "swap",
})

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Slipstream",
  metadataBase: new URL("https://slipstream.k2capitalmanagement.xyz"),
  description:
    "Copy trading and manual trading for Hyperliquid and Polymarket, with keys that cannot withdraw.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${archivoNarrow.variable} ${jetbrains.variable}`}>
      <body>
        <Nav />
        <LiveBand />
        <main className="shell">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
