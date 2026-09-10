import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grand Ferndale — Front Desk",
  description: "Property management, bookings and cashier",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
