# Woombad – Spesifikasi & Kontrak Modul

Woombad adalah PWA (web app yang bisa di-"install" di Android & iPhone) untuk mengelola kos:
penyewa, sewa, tagihan, pembayaran (DP / lunas), add-on, pengeluaran, laporan keuangan, dan ekspor.
Backend: Supabase (Postgres + Auth + Storage, free tier). Tanpa Supabase, aplikasi berjalan dalam
**Mode Demo** (data di localStorage).

## 1. Arsitektur

```
Browser (React 19 + Vite 8 + Tailwind 4, PWA)
 ├─ src/app        shell, router, auth gate, property switcher
 ├─ src/features/* satu folder per modul (UI + hooks + logika khusus UI)
 ├─ src/domain/*   fungsi murni (tanpa React, tanpa I/O): billing, finance, occupancy, period, ktp, export
 ├─ src/hooks      useAuth, useOrg (org + repo + filter kos), useTable/useInsert/useUpdate/useRemove
 ├─ src/lib/repo   Repo generik: SupabaseRepo | LocalRepo (localStorage). Semua agregasi di client.
 ├─ src/lib/auth   SupabaseAuth | LocalAuth
 └─ src/types/db.ts  tipe baris semua tabel + label Bahasa Indonesia
supabase/schema.sql  tabel, trigger, RLS, storage bucket
```

Prinsip:
- **Semua logika bisnis di `src/domain`** sebagai fungsi murni dengan unit test (Vitest). UI hanya memanggilnya.
- **Repo generik** (`list/get/insert/insertMany/update/remove` per tabel). Volume data kos kecil (ribuan baris),
  jadi filter & agregasi dilakukan di browser. Jangan menulis SQL/RPC baru untuk fitur.
- **Setiap baris punya `org_id`** (diisi otomatis oleh `OrgRepo`). RLS Supabase = `is_org_member(org_id)`.
- **Uang = integer Rupiah**, tanggal = `'YYYY-MM-DD'` (lokal). Jangan pakai `new Date('YYYY-MM-DD')` (UTC!).
  Gunakan helper di `src/domain/period.ts` dan `src/lib/format.ts`.

## 2. Model data (ringkas)

| Tabel | Arti | Catatan |
|---|---|---|
| properties | Kos (bangunan) | user akan punya ≥2 kos |
| rooms | Kamar | harga default harian/mingguan/bulanan; `status` hanya `active`/`maintenance`; hunian diturunkan dari leases |
| addon_catalog | Katalog add-on | contoh: kasur tambahan, parkir, laundry; `property_id` null = semua kos |
| tenants | Penyewa | data KTP (NIK, nama, TTL, alamat, …) + **telepon diisi manual (KTP tidak memuat nomor HP)** |
| leases | Sewa / kontrak | `period_type`, `price_per_period`, `deposit_amount`, `start_date`, `end_date`, `status` |
| lease_addons | Add-on per sewa | `per_period` (dikali jumlah periode) atau `one_time` (hanya di tagihan pertama) |
| invoices | Tagihan | mencakup `quantity` periode dari `period_start` s/d `period_end` (inklusif); `total = base + addons + extra - discount` |
| payments | Pembayaran | `kind`: `rent` (lawan tagihan, = pendapatan), `deposit` (uang jaminan, bukan pendapatan), `other` |
| expenses | Pengeluaran | kategori: gaji, perbaikan, listrik/air/internet, perlengkapan, pajak, promosi, pengembalian jaminan, lainnya |

Status tagihan **diturunkan dari pembayaran** (`deriveInvoiceStatus`): `paid` (Lunas) jika dibayar ≥ total,
`partial` (DP/Sebagian) jika 0 < dibayar < total, `unpaid` jika 0. `void` manual. Trigger DB menjaga konsistensi;
aplikasi juga harus meng-update `invoices.status` setelah mencatat/menghapus pembayaran (supaya Mode Demo konsisten).

Alur kos yang dimodelkan:
1. Penyewa masuk → buat **sewa** (pilih kamar, periode, harga, deposit, add-on) → otomatis buat **tagihan pertama**
   (quantity bebas: 3 hari, 2 minggu, 1 bulan) + opsional catat **deposit**.
2. Penyewa bayar → catat **pembayaran** (bisa DP; sisa dibayar nanti) → status tagihan otomatis.
3. Mendekati `coveredThrough` → dashboard menampilkan "jatuh tempo" → klik **"Buat tagihan berikutnya"** →
   `end_date` sewa otomatis diperpanjang ke `period_end` tagihan baru.
4. Penyewa keluar → **checkout**: status `ended`, `checkout_date`, `deposit_returned_amount` (+ pengeluaran kategori
   `deposit_refund` bila uang benar-benar keluar).

## 3. Kontrak untuk modul fitur (`src/features/<nama>`)

Setiap modul **hanya** mengubah file di foldernya sendiri. Modul meng-export `RouteObject[]` dari `routes.tsx`
(path relatif terhadap `/`, mis. `'penyewa'`, `'penyewa/:id'`). Navigasi utama ada di `src/app/AppShell.tsx`
(`NAV_ITEMS`) dan tidak perlu diubah.

Gunakan:
- `useOrg()` → `{ org, role, repo, properties, selectedPropertyId, propertyFilterIds, isLocalMode }`.
  **Hormati filter kos global**: tampilkan data yang `property_id ∈ propertyFilterIds` (untuk expenses, saat
  "Semua kos" tampilkan juga `property_id = null`).
- `useTable(table, opts)`, `useRow(table, id)`, `useInsert/useUpdate/useRemove(table, alsoInvalidate[])`
  dari `src/hooks/useTable.ts`. Setelah mutasi yang memengaruhi tabel lain (mis. payment → invoices, leases),
  masukkan tabel tersebut ke `alsoInvalidate` atau panggil `useInvalidate()`.
- Komponen UI dari `src/components/ui` (Button, Input, Select, Textarea, MoneyInput, Card, StatCard, Badge,
  InvoiceStatusBadge, LeaseStatusBadge, Modal, ConfirmDialog, PageHeader, EmptyState, LoadingState, ErrorState,
  DataTable, useToast). Ikon dari `lucide-react`.
- Format: `formatRupiah`, `formatDate`, `todayISO`, `whatsappLink` dari `src/lib/format.ts`.
- Logika: fungsi di `src/domain/*` (lihat JSDoc di tiap file). **Jangan** menduplikasi perhitungan di UI.
- Peran: `role === 'staff'` tidak boleh melihat tombol hapus untuk data keuangan dan tidak melihat Laporan.

Konvensi kode:
- Bahasa UI: **Bahasa Indonesia** (label, pesan error, empty state). Kode/komentar boleh Inggris.
- Mobile-first (lebar 360px harus nyaman), tabel boleh `hideOnMobile` untuk kolom sekunder; aksi utama berupa
  tombol besar; form di `Modal` (bottom-sheet di HP).
- TypeScript strict, `erasableSyntaxOnly` (tanpa `enum`, tanpa parameter properties), `verbatimModuleSyntax`
  (`import type`). Import router dari `'react-router'` (v8; API sama dengan v6/v7: `Link`, `useNavigate`, …).
- Dependensi sudah terpasang: react-router, @tanstack/react-query, recharts, tesseract.js, write-excel-file,
  date-fns (+ `date-fns/locale` → `id`), zod, lucide-react, clsx. **Jangan menambah dependensi.**
- Tidak ada `any` kecuali sangat perlu; tidak ada `console.log` di kode final.

### Ruang lingkup tiap modul

**dashboard** (`/dashboard`): StatCard hunian (terisi/total, %), pendapatan bulan ini, pengeluaran bulan ini,
laba bersih, piutang (outstanding). Daftar "Perlu perhatian": sewa `overdue` & `due_soon`
(`summarizeLeaseBilling`) dengan tombol cepat **Catat pembayaran** / **Buat tagihan berikutnya** (link ke modul sewa),
sewa yang akan berakhir ≤7 hari (`expiringLeases`), kamar kosong (`vacantRooms`). Grafik kecil arus kas 6 bulan.

**properties** (`/kos`, `/kos/:propertyId`): CRUD kos; di dalam kos: CRUD kamar (nama, lantai, 3 harga, status,
catatan) dengan indikator terisi/kosong (dari leases aktif) dan penyewa saat ini; katalog add-on (CRUD).
Hapus kos hanya jika tidak ada kamar; hapus kamar hanya jika tidak ada sewa.

**tenants** (`/penyewa`, `/penyewa/:id`): daftar + pencarian (nama/NIK/HP) + filter kos; form penyewa lengkap;
**Scan KTP** (opsional): ambil foto/pilih gambar → kompres & grayscale di canvas → tesseract.js (`ind`+`eng`)
→ `parseKtpText` → `ktpFieldsToTenant` → prefill form (user mengoreksi) → opsional unggah foto ke bucket `ktp`
(hanya mode Supabase). Tampilkan progres OCR dan catatan bahwa **nomor HP tetap diisi manual**. Detail penyewa:
data diri, tombol WhatsApp, riwayat sewa & pembayaran (read-only, link ke modul sewa).

**leases** (`/sewa`, `/sewa/baru`, `/sewa/:id`): daftar sewa aktif/selesai dengan ringkasan billing
(`summarizeLeaseBilling`: dibayar s/d, sisa tagihan, status). Wizard **sewa baru**: pilih kos → kamar kosong →
penyewa (atau buat cepat) → periode & harga (prefill dari kamar) → deposit → add-on (dari katalog) → jumlah periode
pertama → ringkasan → simpan (lease + lease_addons + invoice pertama via `buildInvoiceDraft` + opsional payment
deposit/rent). Detail sewa: info, add-on, daftar tagihan (status badge), **Buat tagihan berikutnya**,
**Catat pembayaran** (validasi `validateRentPayment`, metode, tanggal, DP/lunas otomatis), ubah/void tagihan,
hapus pembayaran (admin), **Checkout** (deposit dikembalikan), **Batalkan** sewa. Setiap mutasi meng-update
`invoices.status` via `deriveInvoiceStatus` dan `leases.end_date` sesuai aturan.

**expenses** (`/pengeluaran`): daftar dengan filter bulan/rentang, kos, kategori; total per filter; CRUD
(tanggal, kos atau "Bersama", kategori, jumlah, deskripsi, vendor, opsional foto struk ke bucket `receipts`).
Mode cepat untuk pengeluaran rutin (gaji bulanan): tombol "Duplikat ke bulan ini".

**reports** (`/laporan`): pemilih preset **Harian / Mingguan / Bulanan / Tahunan** + rentang kustom, navigasi
◀ ▶, filter kos. KPI (`summarizeFinance`) + perbandingan periode sebelumnya (`comparePeriods`). Grafik recharts:
arus kas per bucket (`cashflowSeries`), pengeluaran per kategori (donut, `expensesByCategory`), laba per kos
(`profitByProperty`), tren hunian (`occupancySeries`), metode bayar. Tabel piutang (`outstandingInvoices`).
**Ekspor**: pilih lembar (Ringkasan, Pembayaran, Tagihan, Pengeluaran, Penyewa) → **XLSX** (write-excel-file,
import dari `'write-excel-file'` default/browser) atau **CSV** (`toCsv`, pemisah `;` default, opsi `,`).
Grafik harus terbaca di HP (tinggi ~220px, legend ringkas, tooltip Rupiah).

**settings** (`/pengaturan`): nama organisasi (admin), daftar anggota + undang via email (`repo.addMemberByEmail`),
hapus anggota (owner/admin, bukan diri sendiri), info mode (Demo vs Online) + tombol **Reset data demo**
(mode lokal), petunjuk install PWA (Android: "Tambahkan ke layar utama"; iPhone: Safari → Bagikan → Tambahkan ke
Layar Utama), tombol keluar, versi aplikasi.

## 4. Pengujian

- `npm test` (Vitest) untuk `src/domain/**`. Target: setiap fungsi publik diuji termasuk kasus tepi
  (akhir bulan, tahun kabisat, qty > 1, tagihan void, bayar lebih, deposit, rentang kosong).
- `npm run typecheck` dan `npm run build` harus bersih.
- `npm run e2e` (Playwright) smoke test di Mode Demo.
