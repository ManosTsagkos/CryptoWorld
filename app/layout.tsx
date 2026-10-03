import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import "./overrides.css";
import "./fallback.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    requestHeaders.get("host") ??
    new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").host;
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
        ? "http"
        : "https";
  const origin = `${protocol}://${host}`;

  return {
    title: "CryptoWorld — All-in-One Crypto Intelligence",
    description:
      "Live crypto market data, interactive analytics and optional AI-assisted signals. A full-stack portfolio project.",
    icons: {
      icon: { url: "/cryptoworld-logo.png", type: "image/png" },
      apple: "/cryptoworld-logo.png",
    },
    openGraph: {
      siteName: "CryptoWorld",
      title: "CryptoWorld — All-in-One Crypto Intelligence",
      description: "Live market data, interactive charts and optional AI-assisted analysis.",
      images: [
        {
          url: `${origin}/og.png`,
          width: 1731,
          height: 909,
          alt: "CryptoWorld neon global market intelligence network",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "CryptoWorld — All-in-One Crypto Intelligence",
      description: "Live market data, interactive charts and optional AI-assisted analysis.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable}`}>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
