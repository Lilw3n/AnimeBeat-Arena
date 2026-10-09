import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { MusicBanner } from "@/components/music-banner";
import { SocialRotatorBanner } from "@/components/social-rotator-banner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AnimeBeat Arena",
  description: "Anime, manga, musique, motivation et communauté.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <body
        className="min-h-full flex flex-col bg-[#070b19] text-[#f4f7ff]"
        suppressHydrationWarning
      >
        <Providers>
          <SocialRotatorBanner />
          <div className="pb-36 sm:pb-44">{children}</div>
          <MusicBanner />
        </Providers>
      </body>
    </html>
  );
}
