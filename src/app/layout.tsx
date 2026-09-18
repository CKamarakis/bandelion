import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bandelion',
  description: 'Releases and gigs from the artists you follow and like.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* The striped ground. Nothing sets text on it: every surface that
          carries type is an opaque block sitting over it. See globals.css. */}
      <body className="striped-ground">{children}</body>
    </html>
  );
}
