import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const deployedHost =
  process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
const metadataBase = new URL(
  deployedHost ? `https://${deployedHost}` : "http://localhost:3000",
);

export const metadata: Metadata = {
  metadataBase,
  title: "ProofSwitch — World Cup in-play risk operator",
  description:
    "A local-first World Cup 2026 circuit breaker and paper repricing agent with deterministic demos and a credential-ready TxLINE control room.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "ProofSwitch — World Cup in-play risk operator",
    description:
      "Fail-closed StablePrice monitoring, autonomous paper execution and a guarded optional Solana proof-validation path for World Cup 2026.",
    type: "website",
    images: [
      {
        url: "/og-submission.png",
        width: 1200,
        height: 630,
        alt: "ProofSwitch social card showing monitor, detect shock, cancel, reprice and reopen stages.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ProofSwitch — World Cup in-play risk operator",
    description:
      "Fail-closed StablePrice monitoring, autonomous paper execution and a guarded optional Solana proof-validation path for World Cup 2026.",
    images: ["/og-submission.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
