import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// The platform's own name, for /login and the root redirect, where there is no
// session and so no property to name -- everything inside (app) takes its
// title from the property row instead.
export const metadata: Metadata = {
  title: "Reservation Centric",
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
