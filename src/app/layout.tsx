import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Zen CRM",
  description: "Advanced WhatsApp CRM with AI capabilities",
  icons: {
    icon: "/brand/zen-favicon.svg",
    shortcut: "/brand/zen-favicon.svg",
    apple: "/brand/zen-favicon.svg",
  },
};

import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { SessionProvider } from "@/components/providers/session-provider"
import { auth } from "@/lib/auth"

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body className="font-sans antialiased">
        <SessionProvider session={session}>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem={false}
            disableTransitionOnChange
          >
            {children}
            <Toaster />
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
