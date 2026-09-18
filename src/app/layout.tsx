import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// The one place the property name is still written down. Below this sit /login
// and the root redirect, where there is no session and so no property row to
// read — everything inside (app) takes its title from the database instead.
export const metadata: Metadata = {
  title: "The Grand Hotel",
  description: "Property management, bookings and cashier",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
