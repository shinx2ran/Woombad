import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="py-16 text-center">
      <p className="text-5xl font-bold text-slate-300">404</p>
      <p className="mt-2 text-slate-600">Halaman tidak ditemukan.</p>
      <Link to="/dashboard" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
        Kembali ke Dashboard
      </Link>
    </div>
  )
}
