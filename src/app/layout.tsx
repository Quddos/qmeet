import type { Metadata, Viewport } from "next";
import "./globals.css";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://qmeet.diaspafra.org";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: { default: "QMeet · University virtual classroom", template: "%s · QMeet" },
  description: "Teacher-led online classes for up to 400 students, with attendance, live quizzes and reports.",
  applicationName: "QMeet",
  alternates: { canonical: "/" },
  manifest: "/manifest.webmanifest",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1d4ed8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1020" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
