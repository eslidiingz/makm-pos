import type { Metadata, Viewport } from 'next'
import { Playpen_Sans_Thai } from 'next/font/google'
import './globals.css'

const playpenSansThai = Playpen_Sans_Thai({
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
  subsets: ['latin', 'thai'],
  variable: '--font-playpen-sans-thai',
  weight: 'variable',
})

export const metadata: Metadata = {
  title: 'MAKM POS',
  description: 'ระบบขายหน้าร้านหม่าล่า',
  applicationName: 'MAKM POS',
}

export const viewport: Viewport = {
  themeColor: '#f4511e',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Browser extensions such as Dark Reader add data attributes to <html>
  // before React hydrates. The root element is the narrowest safe place to
  // accept those external attributes without masking component mismatches.
  return <html className={playpenSansThai.variable} lang="th" suppressHydrationWarning><body>{children}</body></html>
}
