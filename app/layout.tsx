import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SiteCraft AI | 企业独立站工作台',
  description: '用自然语言搭建、修改和发布企业独立站。',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
