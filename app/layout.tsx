import type { Metadata } from "next";
import "./globals.css"; // Ensure global CSS is imported
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  display: "swap", // Improves perceived performance
});

export const metadata: Metadata = {
  title: "Margin Calculator",
  description: "Arihant Capital Margin Calculator",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.className}>
      <body>       {/*<WSProvider>*/}
        {children}
        {/*</WSProvider>*/}
      </body>
 
    </html>
  );
}
