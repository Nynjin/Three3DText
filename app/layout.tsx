import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '@itowns/labels benchmark',
  description: 'Label renderers for three.js drawing the same scene, side by side.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
