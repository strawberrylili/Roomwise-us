import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

// One webfont, for headings only; body uses the system stack from tokens.css.
const display = Fraunces({ variable: "--font-display", subsets: ["latin"], display: "swap", axes: ["opsz"] });

export const metadata: Metadata = {
  title: "Roomwise — your room, redesigned",
  description: "An AI interior designer that plans your room makeover with real products you can buy.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} h-full`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
