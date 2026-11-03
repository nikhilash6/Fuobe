import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Instrument_Serif } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: "normal",
  variable: "--font-instrument-serif",
  display: "swap",
});
/**
 * The italic face of the same family (its @font-face rules join the family above, so --font-instrument-serif sets
 * both), loaded on its own so it can wait for its file: Home's second headline line is italic and right-aligned, and
 * drawn first in the fallback its words would slide sideways when the face arrives. The text waits unseen instead (up
 * to 3 s, the browser's block period; the file is preloaded). Its fallback's metrics are in globals.css.
 */
const instrumentSerifItalic = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  variable: "--font-instrument-serif-italic",
  display: "block",
  adjustFontFallback: false,
});
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

const TITLE = "Fuobe — open-source AI image & video studio";
const DESCRIPTION = "An open-source AI studio for pictures, video and sound: camera motions, effects, apps, lipsync and upscaling, on your own GPU.";

export const metadata: Metadata = {
  // A shared link's preview image needs a full address: the project's public site (the image is the same on every install).
  metadataBase: new URL("https://fuobe.com"),
  title: { default: TITLE, template: "%s · Fuobe" },
  description: DESCRIPTION,
  openGraph: { siteName: "Fuobe", type: "website", title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  // The page runs under the notch and home indicator; the bars pad themselves with the safe-area insets.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#121213" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${instrumentSerif.variable} ${instrumentSerifItalic.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
