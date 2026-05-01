import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NovaMe Admin',
  description: 'Internal management dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-black">{children}</body>
    </html>
  );
}
