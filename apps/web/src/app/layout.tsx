import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import 'maplibre-gl/dist/maplibre-gl.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'SvalMap - Maritime Monitoring System',
  description: 'Real-time maritime monitoring for Svalbard EEZ and Barents Sea',
  keywords: 'maritime, monitoring, Svalbard, Barents Sea, vessel tracking',
  authors: [{ name: 'SvalMap Team' }],
  viewport: 'width=device-width, initial-scale=1',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} h-screen overflow-hidden`}>
        <div className="h-screen w-full">{children}</div>
      </body>
    </html>
  );
}
