import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import { SettingsProvider } from "@/lib/contexts/settings-context";
import { AuthErrorHandler } from "@/components/AuthErrorHandler";
import { Toaster } from 'sonner';

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: "JASPEL - Enterprise Incentive & KPI System",
  description: "Sistem Manajemen Insentif dan KPI Berbasis P1, P2, P3",
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className={`${outfit.variable} font-sans antialiased`} suppressHydrationWarning>
        <AuthErrorHandler />
        <SettingsProvider>
          {children}
        </SettingsProvider>
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
