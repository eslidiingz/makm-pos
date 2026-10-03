'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { usePlatformOwner } from '@/components/auth-boundary'
import { TopSellingProducts } from '@/components/top-selling-products'
import { AccountMenu } from '@/components/ui/account-menu'

export function OwnerDashboard() {
  const owner = usePlatformOwner()
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)

  async function logout() {
    setLoggingOut(true)
    try {
      await fetch('/api/auth/logout', {
        credentials: 'same-origin',
        method: 'POST',
      })
    } finally {
      router.replace('/login')
      router.refresh()
    }
  }

  const localPhone = /^\+?66/.test(owner.phone)
    ? owner.phone.replace(/^\+?66/, '0')
    : owner.phone

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <div className="auth-brand">
          <span className="brand-mark">M</span>
          <div><p className="eyebrow">MAKM POS</p><strong>Owner Console</strong></div>
        </div>
        <AccountMenu
          avatarLabel="MK"
          loggingOut={loggingOut}
          name={localPhone}
          onLogout={logout}
          role="Platform Owner"
        />
      </header>

      <section className="dashboard-hero">
        <div><p className="auth-kicker">PLATFORM OVERVIEW</p><h1>สวัสดี Platform Owner</h1><p>ศูนย์ควบคุมระบบและการดำเนินงานของ MAKM POS</p></div>
      </section>

      <section className="dashboard-grid">
        <Link className="dashboard-card featured" href="/pos">
          <span className="card-icon">01</span>
          <div><p>POINT OF SALE</p><h2>เปิดหน้ารับออเดอร์</h2><span>เข้าสู่ระบบ POS <b>→</b></span></div>
        </Link>
        <Link className="dashboard-card" href="/products">
          <span className="card-icon">02</span>
          <div><p>PRODUCTS</p><h2>จัดการสินค้า</h2><span>ประเภท เมนู และรูปภาพ <b>→</b></span></div>
        </Link>
        <Link className="dashboard-card" href="/reports">
          <span className="card-icon">03</span>
          <div><p>REPORTS</p><h2>รายงานยอดขาย</h2><span>ยอดขายและประวัติรายวัน <b>→</b></span></div>
        </Link>
        <Link className="dashboard-card" href="/costs">
          <span className="card-icon">04</span>
          <div><p>COST &amp; PROFIT</p><h2>ต้นทุนและกำไร</h2><span>วัตถุดิบ สูตร และกำไรต่อไม้ <b>→</b></span></div>
        </Link>
      </section>

      <TopSellingProducts />
    </main>
  )
}
