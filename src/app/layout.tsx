import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bandelion',
  description: 'Releases and gigs from the artists you follow and like.',
  /*
   * Several sizes rather than one scaled icon: a browser picks the nearest and
   * scales from there, and the mark is dense enough that a 512 squeezed into a
   * 16px tab turns to mush. The 16 and 32 are cut for that size.
   */
  icons: {
    icon: [
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-48.png', sizes: '48x48', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
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
