import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'CAY G', description: 'Quản lý Data, Key và đối soát' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="vi"><body>{children}</body></html>;
}
