import { useEffect } from 'react'
import { NavLink, Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router'
import { clsx } from 'clsx'
import { LayoutDashboard, DoorOpen, Users, ReceiptText, Wallet, BarChart3, Settings, LogOut, FlaskConical } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../hooks/useOrg'
import { PropertySwitcher } from './PropertySwitcher'
import { BackupReminderBanner } from './BackupReminderBanner'
import { appUpdater } from './appUpdate'
import { forgetOtherPages } from './dirtyState'

export interface NavItem {
  to: string
  label: string
  shortLabel?: string
  icon: typeof LayoutDashboard
  /** hide from staff role */
  adminOnly?: boolean
}

/** Single source of truth for navigation. Feature modules own the routes; this only lists entry points. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/sewa', label: 'Sewa & Tagihan', shortLabel: 'Sewa', icon: ReceiptText },
  { to: '/penyewa', label: 'Penyewa', icon: Users },
  { to: '/kos', label: 'Kos & Kamar', shortLabel: 'Kamar', icon: DoorOpen },
  { to: '/pengeluaran', label: 'Pengeluaran', shortLabel: 'Keluar', icon: Wallet },
  { to: '/laporan', label: 'Laporan', icon: BarChart3, adminOnly: true },
  { to: '/pengaturan', label: 'Pengaturan', shortLabel: 'Atur', icon: Settings },
]

/** Mobile bottom bar shows the five most used entries. */
const MOBILE_NAV = ['/dashboard', '/sewa', '/penyewa', '/pengeluaran', '/laporan']

export function AppShell() {
  const { auth, session } = useAuth()
  const { org, role, isLocalMode } = useOrg()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // a new version that waited for unsaved work is applied on the next page change
  useEffect(() => {
    forgetOtherPages()
    appUpdater.applyIfIdle()
  }, [pathname])
  const items = NAV_ITEMS.filter((i) => !i.adminOnly || role !== 'staff')
  const mobileItems = items.filter((i) => MOBILE_NAV.includes(i.to))

  const signOut = async () => {
    await auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* a new page starts at the top, going back returns to where the list was scrolled (search-only changes keep it) */}
      <ScrollRestoration />
      {/* Sidebar (desktop); the sidebar, top bar and bottom tabs stay still while a page slides (app-chrome, index.css) */}
      {/* sticky: the menu stays in view while a long page scrolls (as on iPad), and stays put while a page slides */}
      <aside className="app-sidebar sticky top-0 hidden h-dvh w-60 shrink-0 flex-col self-start overflow-y-auto border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 text-white font-bold">W</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">Woombad</p>
            <p className="truncate text-xs text-slate-500">{org.name}</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-100',
                )
              }
            >
              <item.icon className="h-4.5 w-4.5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="truncate text-xs text-slate-500">{session?.user.email}</p>
          <button type="button" onClick={signOut} className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700 hover:text-red-700">
            <LogOut className="h-4 w-4" /> Keluar
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="app-header sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-6">
            <div className="flex items-center gap-2 md:hidden">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-white text-sm font-bold">W</div>
              <span className="text-sm font-semibold text-slate-900">Woombad</span>
            </div>
            {/* min-w-0: a long kos name is cut short instead of pushing the logout button off the screen */}
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <PropertySwitcher />
              {/* the bottom tabs hold five entries only: Pengaturan (anggota, undangan, data) lives up here on phones */}
              <NavLink
                to="/pengaturan"
                aria-label="Pengaturan"
                className={({ isActive }) => clsx('rounded-lg p-2 hover:bg-slate-100 md:hidden', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600')}
              >
                <Settings className="h-5 w-5" />
              </NavLink>
              <button type="button" onClick={signOut} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 md:hidden" aria-label="Keluar">
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
          {isLocalMode && (
            <div className="flex items-center gap-2 bg-amber-50 px-4 py-1.5 text-xs text-amber-800 md:px-6">
              <FlaskConical className="h-3.5 w-3.5" />
              <span>
                <strong>Mode Demo</strong>: data hanya tersimpan di perangkat ini. Hubungkan Supabase untuk akses online bersama.
              </span>
            </div>
          )}
        </header>

        <main className="flex-1 px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
          <div className="mx-auto w-full max-w-6xl">
            <BackupReminderBanner />
            <Outlet />
          </div>
        </main>

        {/* Bottom tabs (mobile) */}
        <nav className="app-tabbar fixed inset-x-0 bottom-0 z-30 grid border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden" style={{ gridTemplateColumns: `repeat(${mobileItems.length}, minmax(0, 1fr))` }}>
          {mobileItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-brand-700' : 'text-slate-500')
              }
            >
              <item.icon className="h-5 w-5" />
              {item.shortLabel ?? item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
