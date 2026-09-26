import type { Metadata } from "next"
import { Archivo, IBM_Plex_Mono } from "next/font/google"
import { AnnunciatorBand } from "@/components/AnnunciatorBand"
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

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
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
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`}>
      <body>
        <AnnunciatorBand />
        <Nav />
        <main className="shell">{children}</main>
      </body>
    </html>
  )
}
