import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree, Geist, Geist_Mono, Inter_Tight } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { ModalProvider } from "@/context/ModalContext";
import { ToastProvider } from "@/context/ToastContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

/* The BridgeMUN wordmark font (logo everywhere, landing headings). */
const bric = Bricolage_Grotesque({
  variable: "--font-bric",
  subsets: ["latin"],
});

/* Shared with the landing: Inter Tight for headings and labels, Figtree for body text and the record. */
const heading = Inter_Tight({ variable: "--font-heading", subsets: ["latin"] });
const bodyFont = Figtree({ variable: "--font-body", subsets: ["latin"] });

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BridgeMUN",
  description: "Model UN committees with classmates and AI delegations, run by an automatic chair that follows HMUN-style rules.",
  applicationName: "BridgeMUN",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${bric.variable} ${heading.variable} ${bodyFont.variable} antialiased`}
      >
        <AuthProvider>
          <ModalProvider>
            <ToastProvider>{children}</ToastProvider>
          </ModalProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
