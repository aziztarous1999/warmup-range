import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Warmup Range — FPS aim trainer',
  description: 'Warm up your aim before ranked Valorant or CS2: flicks, tracking, cover peeks, sensitivity finder and online leaderboards.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
