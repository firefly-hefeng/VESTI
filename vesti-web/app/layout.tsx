import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { Lora } from 'next/font/google'
import './globals.css'

const lora = Lora({ 
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-lora',
})

export const metadata: Metadata = {
  title: 'Vesti - Local-First AI Memory',
  description: 'Every thought deserves a home. Auto-capture and organize your AI conversations.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon-light.svg',
        type: 'image/svg+xml',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark.svg',
        type: 'image/svg+xml',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${lora.variable} font-sans antialiased`}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
