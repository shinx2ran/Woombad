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
| properties | Kos (bangunan) | user akan punya ≥2 kos; `payment_info` = info rekening/QRIS untuk teks pengingat |
| rooms | Kamar | harga default harian/mingguan/bulanan; `status` hanya `active`/`maintenance`; hunian diturunkan dari leases |
| addon_catalog | Katalog add-on | contoh: kasur tambahan, parkir, laundry; `property_id` null = semua kos |
| tenants | Penyewa | data KTP (NIK, nama, TTL, alamat, …) + **telepon diisi manual (KTP tidak memuat nomor HP)** |
| leases | Sewa / kontrak | `period_type`, `price_per_period`, `deposit_amount`, `start_date`, `end_date`, `status`, `checkout_date` |
| lease_addons | Add-on per sewa | `per_period` (dikali jumlah periode) atau `one_time` (hanya di tagihan pertama) |
| invoices | Tagihan | mencakup `quantity` periode dari `period_start` s/d `period_end` (inklusif); `total = base + addons + extra - discount` |
| payments | Pembayaran | `kind`: `rent` (lawan tagihan, = pendapatan), `deposit` (uang jaminan, bukan pendapatan), `other`; `method` termasuk `deposit` = **potong jaminan** |
| expenses | Pengeluaran | kategori: gaji, perbaikan, listrik/air/internet, perlengkapan, pajak, promosi, lainnya, serta **pengembalian jaminan** & **pengembalian sewa** (bukan biaya operasional; wajib `lease_id`) |

Status tagihan **diturunkan dari pembayaran** (`deriveInvoiceStatus`): `paid` (Lunas) jika dibayar ≥ total,
`partial` (DP/Sebagian) jika 0 < dibayar < total, `unpaid` jika 0. `void` manual. Trigger DB menjaga konsistensi;
aplikasi juga harus meng-update `invoices.status` setelah mencatat/menghapus pembayaran (supaya Mode Demo konsisten).

Alur kos yang dimodelkan:
1. Penyewa masuk → buat **sewa** (pilih kamar, periode, harga, deposit, add-on) → otomatis buat **tagihan pertama**
   (quantity bebas: 3 hari, 2 minggu, 1 bulan) + opsional catat **deposit**.
2. Penyewa bayar → catat **pembayaran** (bisa DP; sisa dibayar nanti) → status tagihan otomatis.
3. Mendekati `coveredThrough` → dashboard menampilkan "jatuh tempo" → klik **"Buat tagihan berikutnya"** →
   `end_date` sewa otomatis diperpanjang ke `period_end` tagihan baru.
4. Penyewa keluar → **checkout**: status `ended`, `checkout_date`, penyelesaian uang jaminan (dikembalikan = expense
   `deposit_refund`; dipotong = payment `method='deposit'`). Lihat invarian 2b.

## 2a. Definisi keuangan (basis kas)

| Istilah | Definisi | Fungsi |
|---|---|---|
| **Pendapatan** | Pembayaran `kind ∈ {rent, other}` menurut `paid_at`, **dikurangi** pengeluaran kategori `rent_refund` menurut `expense_date`. Termasuk pembayaran `method = 'deposit'` (potong jaminan): itu konversi kewajiban menjadi pendapatan. | `summarizeFinance.revenue`, `rentRevenue`, `otherRevenue` |
| **Pengeluaran operasional** | Semua `expenses` kecuali kategori `deposit_refund` dan `rent_refund` (keduanya pengembalian uang, bukan biaya). | `summarizeFinance.expenses` |
| **Laba bersih** | Pendapatan − Pengeluaran operasional | `netProfit`, `margin` |
| **Ditagihkan** | `total_amount` tagihan non-void dengan `due_date` dalam rentang (**basis jatuh tempo**, bukan periode sewa). | `billed` |
| **Terkumpul / Tingkat penagihan** | Dari himpunan tagihan yang sama: `Σ min(dibayar, total)`; rasio = terkumpul / ditagihkan (0..1). | `collected`, `collectionRate` |
| **Piutang** | Tagihan non-void dengan `due_date ≤ akhir rentang` dan `total − dibayar(kind rent) > 0` — **diturunkan dari pembayaran**, bukan dari kolom `status`. `overdue` = yang `due_date < hari ini`. | `outstanding`, `overdue`, `outstandingInvoices` |
| **Uang jaminan** | Diterima = payment `kind='deposit'`; Dipotong = payment rent/other dengan `method='deposit'`; Dikembalikan = expense `deposit_refund` (+`lease_id`); Dipegang = diterima − dipotong − dikembalikan. Tidak pernah masuk pendapatan/pengeluaran operasional. | `depositBalance`, `depositsHeld` |
| **Arus kas vs laba** | Grafik arus kas memakai pendapatan & pengeluaran operasional. Lembar **Ringkasan** ekspor memuat rekonsiliasi kas: kas masuk = pendapatan tunai + jaminan diterima − potong jaminan; kas keluar = pengeluaran operasional + pengembalian. | `buildSummarySheet` |
| **Filter kos** | `financePropertyIds` dari `useOrg()`: `undefined` = semua kos (termasuk pengeluaran **Bersama** `property_id = null`); `[id]` = satu kos, pengeluaran bersama **dikecualikan** dan jumlahnya dilaporkan di `sharedExpensesExcluded` agar UI bisa menampilkan catatan. **Jangan** mengirim `propertyFilterIds` ke fungsi domain. | semua fungsi `src/domain/finance.ts`, `export.ts` |
| **Perbandingan periode** | Periode berjalan dibandingkan dengan periode sebelumnya **sampai hari yang sama** (`comparableRanges` → `isPartial`), label "vs periode lalu (s/d tanggal yang sama)". | `period.comparableRanges`, `comparePeriods` |

Keterangan lain: **hunian historis** menghitung sewa `ended` sampai **hari sebelum** `checkout_date` (hari checkout kamar sudah kosong, jadi bisa disewakan lagi di hari yang sama; tanpa `checkout_date` dipakai `end_date` inklusif) dan sewa `active` sejak `start_date` tanpa batas atas (penyewa masih di kamar sampai checkout); sewa `cancelled` tidak pernah menghuni. Sewa yang **sudah lunas dan berakhir ≤7 hari** (`isPaidUpAndEnding`) ditampilkan sebagai *akan berakhir / berakhir segera*, bukan *jatuh tempo*. Kamar dengan sewa aktif yang `start_date` di masa depan = **Dipesan** (reserved), bukan kosong. Status `maintenance` kamar tidak bersejarah (berlaku ke semua tanggal).

## 2b. Invarian aplikasi (harus ditegakkan modul `leases`)

Postgres tidak bisa menjaga aturan berikut; UI wajib:

1. **Status tagihan** selalu di-update dengan `deriveInvoiceStatus` setelah setiap insert/hapus pembayaran rent dan setiap perubahan `total_amount`. `total_amount` tidak boleh lebih kecil dari yang sudah dibayar (tolak dengan pesan Indonesia).
2. **Void** tagihan hanya jika `paidAmountFor == 0`. Jika sudah ada pembayaran: hapus/pindahkan pembayaran dulu (admin), atau kecilkan `total_amount` lewat `discount_amount` (DP hangus tetap pendapatan).
3. **Hapus tagihan** hanya jika tidak ada pembayaran (DB akan menolak: `payments.invoice_id` RESTRICT). Lebih disukai void, bukan hapus (nomor tagihan tidak boleh dipakai ulang).
4. **Batalkan sewa** (`cancelled`): semua tagihan unpaid di-void; jika ada tagihan partial, pengguna harus memilih: void + kembalikan (expense `rent_refund` + `lease_id`) atau "anggap hangus" (diskon = sisa, status jadi paid). Pembayaran deposit diselesaikan: kembalikan (expense `deposit_refund`) atau potong (payment `other`, method `deposit`).
5. **Checkout** (`ended`): `checkout_date` wajib; tagihan unpaid yang `period_start > checkout_date` di-void; sisa tagihan sebelum checkout tetap piutang (boleh dipotong jaminan: payment rent, method `deposit`). Deposit yang dipegang **wajib** diselesaikan: dikembalikan (expense `deposit_refund`, `lease_id`), dipotong untuk kerusakan (payment `kind='other'`, `method='deposit'`, catatan "Potongan jaminan: …"), atau dipotong untuk sewa (payment rent method deposit). `end_date` = min(end_date, checkout_date).
6. **Pembayaran** rent selalu `invoice_id` terisi; deposit/other selalu `invoice_id = null` (DB: `(kind = 'rent') = (invoice_id is not null)`). `property_id` pembayaran = `property_id` tagihan/sewa.
7. **Kelebihan bayar**: `validateRentPayment` menolak jumlah > sisa. Form menawarkan: "Catat kelebihan Rp X sebagai Pemasukan Lain" (payment `other`, `lease_id`) atau "Jadikan diskon tagihan berikutnya" (isi `discount_amount` pada draft tagihan berikutnya lewat catatan sewa). **Kekurangan yang disepakati** ("kurang 50 ribu, anggap lunas"): tambahkan `discount_amount` sebesar selisih lalu status menjadi paid.
8. **Double-booking**: saat membuat/mengubah sewa, tolak kamar yang punya sewa non-cancelled yang tumpang tindih dengan `[start_date, end_date]` (`leaseOverlaps`). Kamar dengan sewa aktif berawal di masa depan ditampilkan **Dipesan**.
9. **Pindah kamar** dalam kos yang sama: ubah `room_id` (+ `price_per_period` bila beda) pada sewa aktif dan tambahkan catatan otomatis "Pindah dari A1 ke B2 pada <tanggal>" di `leases.notes`; pindah antar kos = checkout + sewa baru. Cek double-booking berlaku.
10. **Perpanjangan**: jumlah periode (`quantity`) yang menentukan `end_date` (`end_date = period_end` tagihan terakhir). Jika pengguna memasukkan tanggal akhir, tampilkan jumlah periode hasil `periodsToCover` dan tanggal akhir hasil perhitungan, minta konfirmasi bila berbeda. Pro-rata ("tambah 2 minggu saja" pada sewa bulanan) memakai `periodEnd` + `baseAmount` pada `InvoiceDraftInput`.
11. **Nomor tagihan**: `nextInvoiceSequence` dari seluruh tagihan org (termasuk void). Pada error unik (dua perangkat bersamaan), ulangi dengan nomor berikutnya.
12. **Jatuh tempo**: `due_date = period_start`; status `overdue` baru setelah `graceDays` (default 3) lewat; dashboard tidak menampilkan sewa yang sama dua kali (due/overdue vs akan berakhir).

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

Catatan mode Supabase vs Demo:
- Di mode **Supabase**, `invoices.status` dijaga oleh trigger DB setiap ada pembayaran; UI cukup meng-*invalidate*
  `invoices`. Di mode **Demo** (lokal) tidak ada trigger, jadi UI harus menulis `status` hasil `deriveInvoiceStatus`.
  Cara aman untuk keduanya: panggil `repo.update('invoices', id, { status })` hanya jika `repo.mode === 'local'`.
- Peran **staf** di mode Supabase tidak boleh meng-update `invoices` (RLS) dan hanya boleh mengubah `payments`/`expenses`
  yang ia catat sendiri (`created_by`). UI menyembunyikan tombol tersebut untuk staf dan menampilkan pesan dari
  `translateDbError` bila server menolak.
- Hapus tagihan/sewa/kos yang masih dirujuk data lain ditolak (DB RESTRICT; `LocalRepo` meniru aturan ini).

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

## 5. Perubahan v0.2 (umpan balik pemilik setelah mencoba)

### 5.1 Urutan penyewa menurut jatuh tempo / nomor kamar
- Halaman **Sewa** punya kontrol urutan: **Jatuh tempo terdekat** (default: `nextDueDate` naik; terlambat otomatis di
  atas), **Nomor kamar** (nama kos lalu nama kamar, urutan alami A1 < A2 < A10 via `compareRoomNames`), **Nama penyewa**.
  Pilihan disimpan di `useSearchParams` (`?urut=`). Tanggal jatuh tempo berikutnya tampil jelas di setiap kartu.
- Dashboard **Perlu perhatian**: toggle kecil **Tanggal | Kamar** untuk urutan di dalam tiap grup.

### 5.2 Perpanjangan dengan jenis periode berbeda (harian → mingguan/bulanan)
- `invoices.period_type` (baru, nullable) menyimpan jenis periode tagihan itu; `null` = jenis sewa saat itu.
  Label satuan tagihan memakai `invoice.period_type ?? lease.period_type`.
- `InvoiceDraftInput` mendapat override `periodType?: PeriodType` dan `pricePerPeriod?: number`; `InvoiceDraft`
  mendapat `period_type`. Saat jenis berbeda dari `lease.period_type`, rantai tagihan tidak lagi selaras grid →
  `billedPeriodCount` = null → periode berikutnya mulai **sehari setelah** `period_end` terakhir (aturan fallback yang
  sudah ada). Bila `periodStart` dioverride, berlaku seperti biasa.
- Modal **Buat tagihan berikutnya**: pilihan jenis periode (segmented Harian/Mingguan/Bulanan, default jenis sewa);
  mengganti jenis mengisi ulang harga dari tarif kamar untuk jenis itu (bisa diubah). Saat simpan: tagihan dibuat dengan
  `period_type`; jika jenis atau harga berubah dan centang **"Jadikan jenis/harga tetap sewa ini"** aktif (default aktif
  bila jenis berubah), `leases.period_type` dan `price_per_period` ikut diperbarui dan `leases.notes` mendapat catatan
  otomatis "Ganti ke Bulanan Rp X mulai <tanggal>".

### 5.3 Check-in cepat dengan KTP / Paspor
- Modul bersama `src/features/scanner/` (dipindah dari `tenants`): `DocumentScanner` (kamera/galeri → OCR → deteksi
  otomatis **KTP** (NIK ditemukan) atau **Paspor** (MRZ ditemukan) → pratinjau hasil) dengan `onApply(prefill, image)`
  di mana `prefill: TenantPrefill & { id_type, id_number?, nationality? }`.
- Domain `src/domain/passport.ts`: `parsePassportMrz(ocrText)` untuk MRZ TD3 (2 baris × 44 karakter): nama belakang,
  nama depan, nomor paspor, kewarganegaraan (alpha-3), tanggal lahir, jenis kelamin, kedaluwarsa, validasi check digit
  (toleran terhadap O/0, I/1, S/5 dari OCR). `passportToTenant(parsed)` → `TenantPrefill`-like dengan `id_type='passport'`.
- `tenants.id_type` ('ktp'|'passport'|'other'), `id_number`, `nationality` (baru). Form penyewa menampilkan NIK untuk KTP,
  nomor paspor + kewarganegaraan untuk paspor.
- Wizard **Sewa baru** diurutkan ulang untuk check-in: (1) **Penyewa** dengan tombol besar **Scan KTP / Paspor** (dan
  pilih penyewa lama), (2) Kos & kamar, (3) **Jenis sewa** sebagai tiga tombol besar Harian/Mingguan/Bulanan dengan tarif
  kamar, jumlah periode, **Harga disepakati** (lihat 5.4), (4) Add-on (tertutup default), (5) **Pembayaran**: Lunas / DP /
  Belum bayar + deposit, lalu simpan. `?scan=1` langsung membuka pemindai (dashboard: tombol cepat **Check-in**).

### 5.4 Harga bisa dinegosiasi
- Tarif kamar = **harga standar**; sewa menyimpan **harga disepakati** (`price_per_period`). Semua form harga dapat diubah
  dan menampilkan "Harga standar Rp X" sebagai petunjuk; bila berbeda tampilkan selisih ("Diskon Rp Y" / "Lebih Rp Y").
- Detail sewa menampilkan "Harga disepakati Rp X · standar Rp Y". Modal perpanjangan selalu mengizinkan harga khusus untuk
  tagihan itu (override `pricePerPeriod`), dengan centang untuk menjadikannya harga tetap sewa (5.2).
