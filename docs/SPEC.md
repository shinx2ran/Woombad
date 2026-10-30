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
| properties | Kos (bangunan) | user akan punya ≥2 kos; `payment_info` = info rekening/QRIS untuk teks pengingat; `logo_path` = logo kos (bucket `logos`) untuk tagihan digital |
| rooms | Kamar | harga default harian/mingguan/bulanan; `status` hanya `active`/`maintenance`; hunian diturunkan dari leases |
| addon_catalog | Katalog add-on | contoh: kasur tambahan, parkir, laundry; `property_id` null = semua kos |
| tenants | Penyewa | data KTP (NIK, nama, TTL, alamat, …) + **telepon diisi manual (KTP tidak memuat nomor HP)** |
| leases | Sewa / kontrak | `period_type`, `price_per_period`, `deposit_amount`, `start_date`, `end_date`, `status`, `checkout_date`, `planned_checkout_date` (Rencana keluar, 7.8), `vehicle_plate` (No. kendaraan, 7.11) |
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
4. **Batalkan sewa** (`cancelled`): semua tagihan unpaid di-void; jika ada tagihan partial, pengguna harus memilih: **kembalikan** (tagihan *ditutup*, tidak di-void, karena DB menolak void tagihan yang sudah ada pembayarannya (2b.2): sisa yang belum dibayar menjadi `discount_amount`, `total_amount` = yang sudah dibayar, status paid, catatan "DP dikembalikan (<alasan>)"; lalu satu expense `rent_refund` + `lease_id` sebesar yang sudah dibayar, keterangan memuat nomor tagihan, tidak pernah dua kali untuk tagihan yang sama) atau "anggap hangus" (diskon = sisa, status jadi paid). Data dibaca ulang dari server lalu semua perubahan tagihan ditulis lebih dulu, sebelum pengeluaran/pembayaran apa pun, agar penolakan database tidak meninggalkan data setengah jadi. Pembayaran deposit diselesaikan: kembalikan (expense `deposit_refund`) atau potong (payment `other`, method `deposit`).
5. **Checkout** (`ended`): `checkout_date` wajib = hari penyewa keluar (malam itu sudah tidak dihuni, 7.3); tagihan yang `period_start >= checkout_date` (termasuk yang mulai **pada** hari checkout) dianggap sesudah checkout: unpaid di-void, partial diputuskan seperti 2b.4 (kembalikan / anggap hangus), lunas dibiarkan (dicatat sebagai catatan); sisa tagihan yang mulai sebelum checkout tetap piutang (boleh dipotong jaminan: payment rent, method `deposit`). Deposit yang dipegang **wajib** diselesaikan: dikembalikan (expense `deposit_refund`, `lease_id`), dipotong untuk kerusakan (payment `kind='other'`, `method='deposit'`, catatan "Potongan jaminan: …"), atau dipotong untuk sewa (payment rent method deposit). `end_date` = min(end_date, checkout_date − 1) (malam terakhir, 7.3), tidak sebelum `start_date`.
6. **Pembayaran** rent selalu `invoice_id` terisi; deposit/other selalu `invoice_id = null` (DB: `(kind = 'rent') = (invoice_id is not null)`). `property_id` pembayaran = `property_id` tagihan/sewa.
7. **Kelebihan bayar**: `validateRentPayment` menolak jumlah > sisa. Form menawarkan: "Catat kelebihan Rp X sebagai Pemasukan Lain" (payment `other`, `lease_id`) atau "Jadikan diskon tagihan berikutnya" (isi `discount_amount` pada draft tagihan berikutnya lewat catatan sewa). **Kekurangan yang disepakati** ("kurang 50 ribu, anggap lunas"): tambahkan `discount_amount` sebesar selisih lalu status menjadi paid.
8. **Double-booking**: saat membuat/mengubah sewa, tolak kamar yang punya sewa non-cancelled yang tumpang tindih dengan `[start_date, end_date]` (`leaseOverlaps`). Kamar dengan sewa aktif berawal di masa depan ditampilkan **Dipesan**. Sejak 7.7 database juga menjaganya (trigger `leases_overlap_guard`, dua HP sekaligus): sewa aktif baru dan perpanjangan ditolak bila mengambil malam **mulai hari ini (WIB)** yang sudah dipegang sewa lain di kamar itu ('Kamar sudah terisi atau dipesan pada tanggal itu.'); riwayat, pindah kamar, koreksi tanggal mulai, checkout dan pembatalan tidak diperiksa (lihat 7.7).
9. **Pindah kamar** dalam kos yang sama: ubah `room_id` (+ `price_per_period` bila beda) pada sewa aktif dan tambahkan catatan otomatis "Pindah dari A1 ke B2 pada <tanggal>" di `leases.notes`; pindah antar kos = checkout + sewa baru. Cek double-booking berlaku (aturan dialog `roomAvailability`, diulang pada data segar tepat sebelum disimpan sejak 7.7: kamar yang baru dipesan/diisi dari HP lain ditolak dengan alasannya).
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
- Peran **staf** di mode Supabase tidak boleh meng-update `invoices` (RLS) dan hanya boleh **mencatat** `payments`/
  `expenses`; mengubah/menghapusnya khusus pemilik/admin (lihat 6.2). UI menyembunyikan tombol tersebut untuk staf dan
  menampilkan pesan dari `translateDbError` bila server menolak.
- Hapus tagihan/sewa/kos yang masih dirujuk data lain ditolak (DB RESTRICT; `LocalRepo` meniru aturan ini).

Konvensi kode:
- Bahasa UI: **Bahasa Indonesia** (label, pesan error, empty state). Kode/komentar boleh Inggris.
- Mobile-first (lebar 360px harus nyaman), tabel boleh `hideOnMobile` untuk kolom sekunder; aksi utama berupa
  tombol besar; form di `Modal` (bottom-sheet di HP).
- Navigasi HP: tab bawah memuat 5 menu (Dashboard, Sewa, Penyewa, Pengeluaran, Laporan); Pengaturan lewat ikon ⚙️ di atas, dan
  Kos & Kamar lewat kartu pintasan paling atas di Pengaturan (`KosShortcutCard`). Di layar ≥ 768px semua menu ada di sisi kiri.
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
deposit/rent). Detail sewa: info, add-on, daftar tagihan (status badge; baris tagihan lunas menulis "dibayar <tanggal pembayaran
terakhir>", yang belum lunas/dibatalkan "jatuh tempo <tanggal>": `invoiceDueText`), **Buat tagihan berikutnya**,
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

**settings** (`/pengaturan`): nama organisasi (admin), daftar anggota + undang dengan kode (lihat 6.1; ubah peran oleh
pemilik, admin hanya menghapus staf), info mode (Demo vs Online) + tombol **Reset data demo**
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
  di mana `prefill: ScanPrefill` (lihat `src/features/scanner/types.ts`). `/penyewa?new=1&scan=1` membuka form penyewa
  dengan pemindai langsung terbuka (setara `/sewa/baru?scan=1`). Untuk paspor, lencana **nomor paspor terverifikasi**
  (check digit nomor) adalah sinyal paling andal; check digit gabungan sering gagal karena OCR menghilangkan karakter `<`.
- Domain `src/domain/passport.ts`: `parsePassportMrz(ocrText)` untuk MRZ TD3 (2 baris × 44 karakter): nama belakang,
  nama depan, nomor paspor, kewarganegaraan (alpha-3), tanggal lahir, jenis kelamin, kedaluwarsa, validasi check digit
  (toleran terhadap O/0, I/1, S/5 dari OCR). `passportToTenant(parsed)` → `TenantPrefill`-like dengan `id_type='passport'`.
- `tenants.id_type` ('ktp'|'passport'|'other'), `id_number`, `nationality` (baru). Form penyewa menampilkan NIK untuk KTP,
  nomor paspor + kewarganegaraan untuk paspor.
- Wizard **Sewa baru** diurutkan ulang untuk check-in: (1) **Penyewa** dengan tombol besar **Scan KTP / Paspor** (dan
  pilih penyewa lama), (2) Kos & kamar, (3) **Jenis sewa** sebagai tiga tombol besar Harian/Mingguan/Bulanan dengan tarif
  kamar, jumlah periode, **Harga disepakati** (lihat 5.4), (4) Add-on (tertutup default), (5) **Pembayaran**: Lunas / DP /
  Belum bayar + deposit, No. kendaraan opsional (7.11), catatan, lalu simpan. `?scan=1` langsung membuka pemindai (dashboard: tombol cepat **Check-in**).

### 5.4 Harga bisa dinegosiasi
- Tarif kamar = **harga standar**; sewa menyimpan **harga disepakati** (`price_per_period`). Semua form harga dapat diubah
  dan menampilkan "Harga standar Rp X" sebagai petunjuk; bila berbeda tampilkan selisih ("Diskon Rp Y" / "Lebih Rp Y").
- Detail sewa menampilkan "Harga disepakati Rp X · standar Rp Y". Modal perpanjangan selalu mengizinkan harga khusus untuk
  tagihan itu (override `pricePerPeriod`), dengan centang untuk menjadikannya harga tetap sewa (5.2).

## 6. Peluncuran online (v0.3) — keamanan sebelum go-live

Hasil penilaian keamanan: orang luar tidak dapat membaca/mengubah data (245 uji serangan pada PostgreSQL). Celah yang
tersisa ada pada **pendaftaran & undangan** (siapa cepat dia dapat), **pembatasan staf**, **riwayat perubahan**, dan
**cadangan**. Bagian ini adalah kontrak untuk perbaikan sebelum peluncuran.

### 6.1 Keanggotaan berbasis kode (tanpa email)
- **Kode** = 8 karakter dari alfabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (tanpa 0/O/1/I/L), ditampilkan `ABCD-EFGH`.
  Klien menormalkan (`normalizeCode`: huruf besar, buang non-alfanumerik) sebelum dikirim. Server hanya menyimpan
  `encode(sha256(convert_to(kode_normal,'UTF8')),'hex')` (fungsi bawaan Postgres; **jangan** pakai pgcrypto — di Supabase
  pgcrypto ada di skema `extensions`).
- **Kode pemilik (setup code)**: tabel `public.app_settings (id int primary key default 1 check (id = 1),
  setup_code_hash text, setup_code_used_at timestamptz)`. Diisi oleh operator lewat
  `select public.set_setup_code('ABCD-EFGH')` — fungsi ini **tidak** di-grant ke `authenticated`/`anon` (hanya postgres /
  service_role). Tidak ada RLS policy untuk tabel ini (tak terbaca klien).
- **Pendaftaran tidak lagi membuat organisasi atau menerima undangan otomatis.** Trigger `on_auth_user_created` dan
  fungsi `accept_invitations_for`, `handle_new_user`, `add_member_by_email` dihapus.
- `ensure_membership() returns uuid`: hanya mengembalikan keanggotaan yang ada (owner dulu, lalu yang tertua). Bila tidak
  ada: `raise exception using errcode = 'WB001', message = 'Akun ini belum menjadi anggota. Masukkan kode dari pemilik kos.'`
  (klien memetakan `WB001` → `NotMemberError` → layar **Masukkan kode**).
- `join_with_code(p_code text) returns uuid` (security definer, untuk `authenticated`):
  1. Batasi percobaan: tabel `public.join_attempts (user_id uuid, attempted_at timestamptz default now())`; bila ≥ 10
     kegagalan dalam 1 jam terakhir untuk `auth.uid()` → `'Terlalu banyak percobaan. Coba lagi dalam 1 jam.'`.
  2. Cocokkan undangan: `invitation_codes.code_hash` sama (undangan terkait `accepted_at is null`, `expires_at > now()` → insert
     `organization_members (org_id, user_id, email dari auth.users, role)` (on conflict do nothing), set `accepted_at`,
     `accepted_by`, kembalikan org_id.
  3. Bila belum ada organisasi sama sekali dan hash cocok dengan `app_settings.setup_code_hash` yang belum dipakai →
     buat organisasi 'Kos Saya' (`created_by` = user) + member `owner`, set `setup_code_used_at`, kembalikan org_id.
  4. Selain itu catat kegagalan di `join_attempts` dan **kembalikan `null` tanpa exception** (exception akan
  membatalkan transaksi sehingga catatan kegagalan ikut hilang). Klien memetakan `null` →
  'Kode tidak valid atau sudah kedaluwarsa.'. Kode kosong/terlalu pendek juga dihitung sebagai kegagalan.
- `create_invitation(p_org_id uuid, p_role text, p_label text) returns table(code text, expires_at timestamptz)`:
  admin saja; role `admin`/`staff`; kode acak dari `gen_random_uuid()` (bawaan PG13+), kedaluwarsa 7 hari; simpan
  `invitations (org_id, label, role, invited_by, expires_at)` + hash di tabel terpisah
  `public.invitation_codes (invitation_id uuid primary key references invitations on delete cascade, code_hash text unique
  not null)` — RLS aktif tanpa policy dan **tanpa grant**, jadi hash tidak pernah terkirim ke klien (juga tidak ikut cadangan).
  `invitations.email` menjadi nullable, kolom baru `label text`, `expires_at timestamptz not null default now() + interval
  '7 days'`, `accepted_by uuid`. Admin boleh `select`/`delete` undangan organisasinya (sudah ada). Maksimal 20 undangan aktif
  per organisasi.
- `set_member_role(p_org_id uuid, p_user_id uuid, p_role text) returns void`: **owner saja**; role owner/admin/staff;
  tolak menurunkan **owner terakhir** ('Tidak dapat mengubah peran pemilik terakhir.'). Policy `members_update` dihapus —
  tidak ada update langsung ke `organization_members`.
- `remove_member` tetap (admin tidak dapat menghapus pemilik; pemilik terakhir tidak dapat dihapus).
- Kode undangan hanya berlaku selama pembuatnya masih pemilik/admin: `remove_member` dan `set_member_role` (turun ke staf)
  mengakhiri kode yang belum dipakai milik orang itu (`expires_at = now()`).
- Kode dianggap terpakai (`accepted_at`/`accepted_by`) hanya bila keanggotaan baru benar-benar dibuat; anggota yang sudah
  ada dan memasukkan kode itu hanya mendapat org id-nya, kode tetap berlaku untuk orang yang dituju.

### 6.2 Pembatasan staf (ditegakkan database)
- `properties`: insert/update/delete **admin saja** (termasuk `payment_info` = rekening di pengingat WhatsApp).
- `addon_catalog` (daftar harga tambahan): insert/update/delete **admin saja**.
- `rooms`: staf boleh update kecuali kolom harga (`price_daily/weekly/monthly`) → trigger menolak
  'Hanya pemilik/admin yang dapat mengubah harga kamar.'; insert/delete kamar admin saja.
- `leases`: staf boleh update (perpanjang, checkout, pindah kamar) **kecuali** `price_per_period`, `deposit_amount`,
  `period_type` → 'Hanya pemilik/admin yang dapat mengubah harga atau jenis sewa.'; `start_date` → 'Hanya pemilik/admin yang dapat
  mengubah tanggal mulai sewa.' (7.6)
- `payments` & `expenses`: update **admin saja** (hapus kebijakan "pemilik baris"); trigger BEFORE INSERT memaksa
  `created_by = auth.uid()` bila `auth.uid()` tidak null; `created_by` dan `org_id` tidak dapat diubah lewat update.
  Karena itu foto struk pengeluaran baru diunggah **sebelum** insert dan `receipt_path` ikut di insert (staf tidak bisa
  update); bila insert gagal, file dihapus lagi (best-effort).
- `tenants.property_id` dan `expenses.property_id`: `on delete set null (property_id)` (PostgreSQL 15+) agar menghapus kos
  tidak ikut mengosongkan `org_id`.
- `invoices`: insert oleh non-admin dengan `status = 'void'` diperlakukan sebagai tagihan biasa (status diturunkan dari
  pembayaran) — ubah `invoices_recalc_trigger`.
- UI menyembunyikan aksi yang ditolak untuk staf dan tetap menampilkan pesan `translateDbError` bila server menolak.

### 6.3 Riwayat perubahan (audit log)
- Tabel `public.audit_log (id uuid pk default gen_random_uuid(), org_id uuid not null references organizations on delete
  cascade, table_name text not null, row_id uuid, action text check in ('insert','update','delete'), changed_by uuid
  default auth.uid(), changed_at timestamptz not null default now(), old_data jsonb, new_data jsonb)`, indeks
  `(org_id, changed_at desc)`.
- Trigger AFTER INSERT/UPDATE/DELETE (security definer) pada `payments, invoices, expenses, leases, lease_addons,
  properties, rooms, addon_catalog, tenants, organization_members, invitations, organizations`. Lewati bila organisasinya
  sudah tidak ada (penghapusan berantai oleh operator).
- RLS: `select` untuk `is_org_admin(org_id)`; **tidak ada** policy insert/update/delete; `grant select` saja ke
  `authenticated`. Tak seorang pun (termasuk pemilik lewat aplikasi) dapat mengubah/menghapus riwayat.
- Urutan list di klien memakai `orderBy: { column: 'changed_at' }` (tabel ini tidak punya `created_at`).
- UI: Pengaturan → **Riwayat perubahan** (owner/admin): 100 perubahan terakhir — kapan, siapa (email anggota), apa
  (tabel + aksi + ringkasan kolom yang berubah, mis. "Pembayaran Rp 1.500.000 → Rp 1.000.000"). Mode demo: kartu
  menjelaskan riwayat hanya tersedia di mode online.
- **Pulihkan** (undo hapus, `src/features/settings/audit/restore.ts`, `useRestoreDeleted`): baris yang dihapus tersimpan utuh
  di `old_data`; memulihkan = `repo.insert` baris itu lagi dengan id lama (tanpa `org_id/created_at/updated_at/created_by`),
  lewat RLS, trigger dan cek FK yang sama seperti insert biasa; riwayat mencatatnya sebagai *insert*. Tabel yang didukung:
  tenants, rooms, properties, addon_catalog, payments, expenses, lease_addons, waitlist. **Bukan invoices**: hapus tagihan juga
  menarik `end_date` sewa dan nomornya dipakai tagihan berikutnya, jadi tagihan dibuat ulang lewat Tagih. Pembayaran sewa tidak
  dikembalikan ke tagihan yang sudah dibatalkan. Struk pengeluaran split yang masih dipakai baris lain tetap dipertahankan.
  Kos yang dipulihkan tidak membawa kembali add-on katalognya (cascade) maupun tautan penyewa/pengeluaran/daftar tunggu (set
  null); pesan sukses menyebutkannya. Entri delete menampilkan
  tombol **Pulihkan** (dialog konfirmasi), atau lencana **Dipulihkan** bila ada insert baris yang sama sesudahnya. Baris yang
  sudah ada kembali → "sudah dipulihkan"; rujukan yang ikut hilang (FK) → "pulihkan itu dulu". Berkas (foto KTP, struk,
  logo) sudah dihapus dari storage dan tidak kembali: kolom path dikosongkan dan pengguna diberi tahu.
- **Urungkan** segera setelah hapus (kedua mode): toast "… dihapus." membawa tombol **Urungkan** selama 10 detik
  (`ToastOptions.action`) di hapus kamar, penyewa, kos, add-on, dan pengeluaran; jalurnya sama (`offerUndo`).

### 6.3a Satu berkas skema
- Belum ada database online, jadi **tidak ada migrasi 0003**: `supabase/schema.sql` adalah versi lengkap dan harus
  bisa dijalankan pada database kosong, dijalankan dua kali, maupun di atas skema v0.2 (`alter table ... add column if
  not exists`, `drop ... if exists`). Ketiga skenario diuji di `supabase/tests`.

### 6.4 Penyimpanan foto
- Hapus trigger `tenants_delete_ktp` / `expenses_delete_receipt` beserta fungsinya: Supabase versi baru menolak
  `delete from storage.objects` langsung, sehingga hapus penyewa akan gagal. Aplikasi menghapus **baris dulu**, lalu file
  lewat Storage API (`repo.removeFile`, best-effort + peringatan bila gagal). Urutan ini mencegah foto hilang ketika
  penghapusan baris ditolak (mis. penyewa masih punya sewa). Berlaku untuk penyewa (`ktp_image_path`) dan pengeluaran
  (struk); juga hapus foto lama saat foto KTP/struk diganti.

### 6.5 Cadangan & pindah dari Mode Demo
- Pengaturan → Data (mode online, owner/admin): **Unduh cadangan lengkap (JSON)** — semua tabel organisasi (kecuali
  `audit_log` opsional), format `{ version: 1, exportedAt, orgName, tables: { <tabel>: Row[] } }`; foto tidak termasuk
  (dijelaskan). Teks lama tentang "Dashboard → Database → Backups" dihapus: paket gratis Supabase **tidak** punya cadangan.
- Mode demo: **Pulihkan dari JSON** memvalidasi berkas dengan zod (semua tabel array, baris punya `id`), otomatis
  mengunduh data saat ini sebelum menimpa, dan aplikasi punya error boundary dengan tombol "Reset data di perangkat ini"
  bila data rusak. Mode demo meminta `navigator.storage.persist()` dan menampilkan pengingat bila cadangan terakhir > 7 hari.
- **Impor dari Mode Demo** (mode online, owner/admin, organisasi baru): pilih berkas cadangan demo → pratinjau per kos →
  pilih kos yang diimpor (+ opsi pengeluaran Bersama) → sisipkan dengan urutan dependensi (properties, rooms,
  addon_catalog, tenants, leases, lease_addons, invoices, payments, expenses), `org_id` diganti, `id` UUID dipertahankan,
  `created_by` dikosongkan; baris dengan id non-UUID atau dari organisasi lain dilewati. Hasil: ringkasan jumlah baris.

- Tambahan v0.3: impor boleh diulang ke organisasi yang sudah berisi (baris dengan id yang sudah ada dilewati); impor
  juga bisa langsung dari data Mode Demo di browser yang sama (tanpa berkas); data contoh bawaan
  Mode Demo tidak ikut secara default; cadangan online tidak memuat `invitation_codes` (tanpa grant); pulihkan/reset
  mengunduh data saat ini lebih dulu; data perangkat yang rusak berhenti di layar galat (unduh / reset), tidak ditimpa.

### 6.6 Konfigurasi publik untuk build
- URL Supabase & *publishable key* (`sb_publishable_…`) bersifat publik (dilindungi RLS). Kunci anon lama (JWT) tidak
  dipakai: membatalkan kunci lama berarti mematikan semua kunci lama sekaligus.
  `scripts/check-public-config.mjs` menolak build bila `.env.production` memuat kunci rahasia. CI membangun dengan variabel
  kosong (Mode Demo) agar e2e tidak bergantung pada database live. Disimpan di `.env.production` (di-commit,
  pengecualian di `.gitignore`). Workflow deploy hanya mengoper secrets bila tidak kosong (secret kosong tidak boleh
  menimpa `.env.production`). Kunci `service_role` **tidak pernah** di-commit.

## 7. Perubahan v0.4

### 7.1 Daftar sewa ringkas
- Halaman **Sewa** menampilkan satu baris padat per sewa (`LeaseRow`, tinggi ±56px, 8+ baris per layar HP) di dalam satu
  kartu: chip nomor kamar, nama penyewa, baris kecil "sisa Rp X / lunas s/d tanggal / belum ditagih · jenis periode · kos
  (hanya saat Semua kos)" (jumlah di depan agar tidak terpotong di HP), lalu blok **sisa hari** (`remainingDays`: angka
  besar + keterangan pendek, mis. "20 hari / terlambat", "Hari ini / jatuh tempo", "3 hari / check-out") dan menu
  aksi (Bayar, Tagihan berikutnya, Kirim tagihan,
  Pengingat WhatsApp, Profil penyewa). Di layar lg+ (≥1024px; di md sidebar menyisakan terlalu sedikit ruang) ada kolom tambahan Dibayar s/d dan Sisa tagihan. Tab Selesai/Batal
  menampilkan lencana status + "Checkout/Berakhir <tanggal>" sebagai ganti sisa hari.
- Urutan (`?urut=`): `jatuh-tempo` = **Sisa hari paling sedikit** (default; terlambat di atas), `jatuh-tempo-terjauh` =
  **Sisa hari paling banyak** (tanpa tanggal tetap di bawah; di tab Selesai = selesai paling lama dulu), `kamar` = **Nomor
  kamar**, `nama` = **Nama penyewa**. Teks pengingat WhatsApp dibangun oleh `leaseReminderText` (dipakai baris & detail).

### 7.2 Tagihan digital (gambar) & logo kos
- **Kirim tagihan** (menu baris di Sewa: tagihan terbuka tertua, jika tidak ada tagihan non-void terakhir; menu per tagihan di
  detail sewa; otomatis terbuka setelah **Buat tagihan berikutnya**) membuat gambar PNG tagihan di browser: `buildInvoiceDocument`
  (`src/domain/invoiceDocument.ts`, murni: baris sewa/add-on/listrik-denda, diskon, total, dibayar, sisa, status dari pembayaran) →
  `layoutInvoice` (`src/features/invoices/invoiceLayout.ts`, murni & diuji: daftar op gambar pada halaman 1080 px, tinggi mengikuti
  isi) → `renderInvoiceImage` (canvas → PNG). Isi: logo + nama/alamat kos, TAGIHAN + nomor + pil status, penyewa/kamar/periode/jatuh
  tempo/tanggal terbit, rincian, total, sudah dibayar & sisa, daftar pembayaran, kotak **Pembayaran ke** (hanya selama masih ada sisa),
  catatan (hanya bila dicentang **Sertakan catatan tagihan di gambar**: catatan bisa memuat keterangan internal seperti "Sisa
  dianggap hangus"), "Dibuat <tanggal> · Woombad".
- Tautan wa.me hanya membawa teks, jadi gambar diserahkan ke **lembar bagikan** OS (`navigator.share` dengan berkas; Android Chrome /
  PWA terpasang dan iOS Safari) dan pemilik memilih WhatsApp + kontak; teks pengantar = `invoiceShareText`. Cadangan: **Unduh gambar**
  dan **Kirim teks saja via WhatsApp**; browser tanpa dukungan berbagi berkas diberi penjelasan.
- **Logo kos** (`properties.logo_path`, bucket privat `logos`, 1 MB, PNG/JPEG/WebP; pemilik/admin lewat form kos): diperkecil di browser
  (sisi panjang ≤ 600 px, PNG/WebP tetap PNG agar transparan, `logoImage.ts`), baris disimpan dulu lalu berkas diunggah dan
  `logo_path` di-update; berkas lama dihapus best-effort (6.4), begitu pula saat kos dihapus. Policy storage: bucket `logos` hanya
  dapat ditulis/dihapus oleh **pemilik/admin** (`is_org_admin`, mengikuti aturan kos 6.2), dibaca semua anggota. `useKosLogo`
  mengunduh & men-cache logo per path (batas 8 detik, gagal → tanpa logo, dicoba lagi setelah 30 detik; mode demo: tanpa logo).

### 7.3 Tanggal check-out
- Data tidak berubah: `invoices.period_end`, `leases.end_date`, `coveredThrough`/`paidThrough`, `new_lease_end_date` dan akhir segmen
  linimasa tetap **malam terakhir** (inklusif); periode berikutnya mulai keesokan harinya. Hanya tampilan & input yang berubah.
- Semua jenis periode: **akhir sewa ditampilkan sebagai hari check-out** = malam terakhir + 1 (2 malam dari 15 Okt = "15 Okt – 17 Okt 2026",
  1 bulan = "15 Okt – 15 Nov") lewat helper `src/lib/format.ts`: `checkoutISO`/`lastNightISO`, `formatCheckout`, `formatStay`. Label "Check-out
  menjadi" / "Check-out" (sewa aktif); "Dibayar s/d" tetap, nilainya hari check-out; `checkout_date` sewa `ended` ditampilkan apa adanya
  (`leaseEndDisplay`: daftar, detail sewa, dan lembar kamar, juga untuk sewa `ended` yang masih menghuni sampai `checkout_date`).
- **Input**: tanggal akhir yang diketik pengguna ("atau sampai tanggal check-out", "Sampai tanggal (check-out)" pada periode khusus) dibaca
  sebagai hari check-out (minimal mulai + 1) dan dihitung/disimpan sebagai check-out − 1 (`lastNightISO`) untuk `periodsToCover`, `periodEnd`
  dan pro-rata. **Tanggal pembatalan** dan tanggal checkout juga hari check-out: `end_date` = min(end_date, tanggal − 1), tidak sebelum
  `start_date` (`cancelledLeaseEndDate`). Sewa `cancelled` dengan `end_date <= start_date` (`isCancelledWithoutStay`: dibatalkan paling
  lambat sehari setelah mulai; `end_date` hanya dijepit ke `start_date` demi constraint DB) **tidak punya malam menginap**: akhirnya
  ditampilkan sebagai hari mulai ("Berakhir 20 Okt", juga urutan tab selesai), riwayat penyewa "20 Okt 2026 · belum menginap", riwayat
  perubahan tanpa baris Check-out, linimasa tanpa malam belum ditagih, dan modal pembatalan menulis "Belum ada malam menginap" untuk tanggal
  yang sama (penyewa yang sudah menginap di-checkout, bukan dibatalkan). Hitungan hari "sampai sewa berakhir" (`remainingDays`, `dueLabel`) dihitung ke hari check-out ("4 hari / check-out"; tanggalnya sudah tampil di "lunas s/d" baris yang sama).
- Logika: `isPaidUpAndEnding` memakai hari check-out (`checkoutISO(end_date)` di [hari ini, hari ini + 7]), jadi pada hari check-out sewa lunas
  tampil "Hari ini / check-out", bukan "jatuh tempo hari ini"; checkout membatalkan juga tagihan yang mulai **pada** `checkout_date` (2b.5).

### 7.4 Tombol cepat (papan kamar)
- **Dirilis** (Okt 2026): setelah diuji pemilik sebagai fitur percobaan, papan kamar tampil di Dashboard untuk semua peran (bila
  kos yang dipilih punya kamar); saklar "Fitur percobaan" (`woombad.quickButtons`) dan label "Percobaan" dihapus. Papan dimuat
  bersama Dashboard (bukan `lazy`) dan hanya menunggu tabel yang juga dimuat `useDashboardData` (`useBoardData`), jadi papan muncul
  bersamaan dengan angka ringkasan, tidak menyusul lalu mendorong halaman ke bawah; Check-in cepat memakai hook yang sama, jadi
  formnya langsung siap. Nama kamar panjang ("Kamar 12") dibungkus sampai dua baris (bukan dipotong jadi "Kama…"); nama yang
  butuh lebih dari dua baris berakhir "…".
- **Papan kamar** di Dashboard (`RoomBoard`, `boardModel.ts`): satu kotak per kamar kos yang dipilih, warna dari fungsi yang sama dengan
  Kos & Kamar (`roomDisplayState`) dan daftar sewa (`summarizeLeaseBilling`). Hitungan = hari sampai jatuh tempo berikutnya
  (`daysUntilDue`; sewa lunas: hari check-out = awal periode berikutnya, 7.3): **< 0 → merah penuh "Telat"** sejak hari pertama
  lewat jatuh tempo (permintaan pemilik; daftar sewa tetap memakai masa tenggang "tenggang"), **0 → jingga-merah "Hari ini"** (lebih lembut dari merah penuh), **1–7 → oranye "N hari"**,
  > 7 → biru "Terisi"; lalu Kosong, Dipesan, Perbaikan.
- Di bawah nomor kamar: **nama penyewa** (atau tamu yang memesan) versi pendek (`shortTenantName`): kata pertama setelah
  sapaan yang diketik di depan nama ("Pak Budi Santoso" → "Budi"; Pak/Bu/Kak/Bang/Mas/Mbak/Hj./dr. …), dua kata bila kata
  pertama inisial atau dua huruf ("M. Rizki", "Ho Wei"); terlalu panjang → dipotong "…". Nama lengkap ada di label kotak
  (pembaca layar) dan di lembar aksi. Kamar kosong tanpa nama.
- **Aksi** kamar terisi = tautan ke halaman sewa yang membuka dialog yang sudah ada: `/sewa/:id?action=bayar|tagih|checkout`; semua aturan
  (jaminan, tagihan setelah checkout, peran staf) tetap dari dialog itu. Kamar Telat / jatuh tempo ≤ 7 hari juga mendapat tombol hijau
  **Kirim pengingat WhatsApp** (`wa.me` dengan teks `leaseReminderText`, sama dengan "Pengingat WhatsApp" di daftar sewa); tanpa HP
  penyewa, papan meminta HP diisi dulu.
- **Check-in cepat** kamar kosong (`quickCheckIn.ts`, `QuickCheckInModal`): **Harian / Mingguan / Bulanan / Tahunan** (tahunan =
  bulanan × 12, dengan **bonus bulan gratis** opsional: "bayar 12 bulan, bonus 1" → sewa & tagihan 13 bulan, tagihan 13 × harga
  dikurangi diskon 1 × harga, catatan tagihan "bonus 1 bulan", harga kontrak tetap); nama (HP boleh kosong, "HP belum diisi"
  diingatkan di papan), **No. kendaraan** opsional (7.11), jumlah periode, total (bawaan tarif kamar × jumlah). Harga per periode = total ÷ jumlah dibayar, dibulatkan;
  bila tidak pas, `baseAmount` = total + diskon. Bayar: lunas (bawaan), **DP**, atau belum; bulanan/tahunan juga **uang jaminan**
  (`leases.deposit_amount`, pembayaran `kind: 'deposit'` "Uang jaminan" bila sudah diterima, metode sama). Disimpan lewat
  `useRencanaActions.bookStay` (cek kamar segar lalu `saveStayBooking`: penyewa → sewa → `insertFromDraft` → pembayaran → status
  tagihan → pembayaran deposit); kamar ditahan untuk bulan bonus juga. Add-on tetap lewat Form lengkap. Nama yang sama dengan
  penyewa lama ditawarkan supaya data tidak dobel. Ketersediaan kamar dicek dengan `roomAvailability` (`validateStayBooking`).

### 7.5 Ubah pembayaran & tagihan, dengan riwayat
- **Ubah pembayaran** (owner/admin; RLS `payments` update hanya admin): tombol ✏️ di samping 🗑️ pada daftar Pembayaran di detail
  sewa (`EditPaymentModal`, aturan di `paymentEdit.ts`). Yang bisa diubah: **jumlah, tanggal bayar, metode, catatan**. Tagihan yang
  dibayar dan jenisnya (sewa / jaminan / lainnya) tetap; salah tagihan = hapus lalu catat ulang lewat Bayar.
  - Jumlah > 0 dan, untuk pembayaran sewa, paling banyak sisa tagihan **tanpa** pembayaran ini (tidak boleh lebih bayar).
  - Jaminan yang diterima tidak boleh turun di bawah yang sudah dipakai/dikembalikan (`depositBalance`).
  - Pembayaran "Potong jaminan" (metode `deposit`) terkunci jumlah & metodenya; metode lain tidak bisa diubah menjadi `deposit`.
  - Setelah simpan, status tagihan dihitung ulang (trigger `payments_recalc` online; `syncInvoiceStatus` di Mode Demo).
- **Ubah tagihan** sekarang juga mengubah **Harga sewa (tagihan ini)** (`base_amount`) bila salah ketik; total = harga sewa + add-on +
  listrik/denda/lainnya − diskon, tidak boleh di bawah yang sudah dibayar. Harga sewa di kontrak (`price_per_period`) tidak berubah,
  jadi tagihan berikutnya tetap memakai harga lama; ubah kontrak lewat Ubah sewa bila harganya memang berubah.
- **Riwayat perubahan** di bawah kedua dialog (`RecordHistory`): 20 baris `audit_log` terakhir untuk baris itu (6.3) — Dibuat / Diubah /
  Dihapus, kapan, oleh siapa, dan kolom yang berubah (mis. "Jumlah: Rp 360.000 → Rp 300.000", "Sewa dasar: …"). Hanya Mode Online dan hanya terlihat
  owner/admin (RLS `audit_log`); Mode Demo menampilkan keterangan bahwa riwayat tidak dicatat.

### 7.6 Ubah tanggal mulai sewa
- **Masalah**: pemilik salah input tanggal mulai sewa dan baru sadar berbulan-bulan kemudian; semua tagihan sejak itu dibuat dari
  tanggal yang salah. Koreksi ini memindahkan seluruh jadwal tagihan ke tanggal mulai yang benar.
- **Siapa/apa**: hanya pemilik/admin (menu disembunyikan untuk staf; `useLeaseActions.redateLease` menolak sebelum membaca/menulis
  apa pun; database juga menolak). Hanya sewa `active` (termasuk pesanan yang belum mulai). Sewa `ended`/`cancelled`: menu tidak ada
  dan aksi menolak 'Sewa yang sudah selesai atau dibatalkan tidak bisa diubah tanggal mulainya.' (check-out & pengembalian uang adalah
  kejadian nyata).
- **Pintu masuk**: detail sewa → **Lainnya → Ubah tanggal mulai** ("Salah input tanggal mulai? Semua periode tagihan ikut digeser").
- **Dialog** (`RedateLeaseModal`): tanggal mulai sekarang, input tanggal yang benar, lalu **pratinjau langsung** sebelum menyimpan:
  setiap tagihan (yang void abu-abu) dengan periode lama → baru (`formatStay`, konvensi check-out 7.3), jatuh tempo lama → baru,
  jumlah periode & malam, jumlah uang dan status bayar (tidak berubah); check-out sewa lama → baru; **Dibayar s/d** lama → baru;
  tagihan berikutnya; keadaan penyewa hari ini sebelum/sesudah ("Setelah diubah: telat 14 hari · sisa Rp …" / "lunas s/d 1 Nov · …",
  `leaseStateText` dari `summarizeLeaseBilling` + `remainingDays`, sama dengan daftar sewa); peringatan bila ada tagihan di luar grid;
  galat bentrok kamar yang menyebut penyewa lain dan tanggalnya. **Alasan** (opsional) ikut catatan otomatis di `leases.notes`:
  "Tanggal mulai dikoreksi dari <lama> ke <baru> (<hari ini>)" + ": <alasan>". Simpan nonaktif selama tidak valid, belum berubah, atau
  sedang menyimpan.
- **Perencana murni** `src/features/leases/redate.ts` → `planLeaseRedate(lease, invoices, newStart, { leases, tenants })` →
  `{ lease: { start_date, end_date }, invoices (sebelum/sesudah), patches (id, period_start, period_end, due_date), mode, deltaDays,
  warnings, error, conflict }`:
  - `mode 'grid'` bila `billedPeriodCount(lease, invoices) !== null` (semua tagihan non-void di grid dari tanggal mulai lama): tagihan
    non-void ke-k (k += quantity) mendapat `periodBounds(newStart, type, k, quantity)`; tagihan void yang juga tepat di posisi grid k
    tanggal mulai lama (`start == addPeriods(lama, type, k)` dan akhir cocok dengan quantity) diperlakukan sama, selainnya digeser
    `deltaDays`. Hasilnya `billedPeriodCount` sama dengan sebelumnya, jadi **Tagih** berikutnya melanjutkan grid baru (akhir bulan
    29/30/31 dan Februari tetap berjangkar, 5.2 / `periodBounds`).
  - `mode 'shift'` selain itu (periode khusus/pro-rata, ganti jenis periode, celah): semua `period_start`/`period_end` digeser
    `deltaDays = newStart − lama` hari kalender, dengan peringatan "Ada tagihan dengan periode khusus, jadi semua tanggal digeser N
    hari." Susunan relatif tetap, sehingga `nextPeriodBounds` tetap mulai sehari setelah tagihan terakhir (tanpa tumpang tindih atau
    celah; diuji untuk jangkar 29/30/31, Februari & kabisat).
  - `due_date` mempertahankan selisih harinya dari `period_start` tagihan itu.
  - `end_date`: bila sama dengan `period_end` tagihan non-void terakhir → ikut `period_end` barunya; selain itu batas check-out
    (`end_date + 1`) dipetakan seperti batas tagihan (indeks grid bila titik grid tanggal lama, selain itu + `deltaDays`); tidak pernah
    sebelum tanggal mulai baru.
  - Pembayaran, `paid_at`, jumlah, nomor tagihan, status, add-on, deposit: tidak berubah. Harian, mingguan, bulanan.
  - Ditolak: tanggal sama ('Tanggal mulai sama dengan sebelumnya.'), tanggal kosong/tidak valid, sewa tidak aktif, dan rentang baru
    `[newStart, end_date baru]` yang bentrok dengan sewa non-cancelled lain di kamar yang sama (`leaseOverlaps`, konvensi 7.3:
    sewa `ended` menempati sampai malam sebelum `checkout_date`) → 'Bentrok dengan sewa <nama> di kamar ini (<tanggal>). Pilih
    tanggal lain.'; tidak ada yang ditulis. Hanya bentrok yang **dibuat oleh koreksi ini** yang ditolak: sewa lain di kamar itu yang
    sudah tumpang tindih dengan rentang tersimpan `[start_date, end_date]` diabaikan. Itu riwayat kamar: **Pindah kamar** (2b.9)
    mengganti `room_id` pada baris sewa yang sama dan kamar baru hanya diperiksa sejak tanggal pindah, sehingga penyewa sebelumnya
    di kamar baru selalu tampak tumpang tindih dengan seluruh masa sewa. Sama di perencana, `LocalRepo.redateLease`, dan
    `redate_lease`.
- **Penulisan atomik** lewat `repo.redateLease(input)` (antarmuka `Repo`, satu operasi): online satu fungsi SQL
  `public.redate_lease(p_lease_id uuid, p_expected_start date, p_new_start date, p_new_end date, p_invoices jsonb, p_note text default
  null)` — **security invoker** (RLS tetap berlaku; satu-satunya RPC fitur, pengecualian prinsip bagian 1 demi atomisitas). Fungsi:
  mengunci baris sewa (`for update`) dan tagihannya; wajib `is_org_admin` organisasi sewa; menolak status selain `active`,
  `start_date <> p_expected_start` atau `p_invoices` yang bukan tepat semua tagihan sewa (masing-masing sekali) dengan SQLSTATE
  **WB002** (aplikasi: `StaleWriteError` → `LEASE_DATA_CHANGED_MESSAGE`); memeriksa ulang bentrok kamar; memperbarui semua tagihan
  (hanya yang tanggalnya berubah) dan sewa (+ catatan) dalam satu transaksi; jumlah/status tidak disentuh. `grant execute` ke
  `authenticated`. `leases_terms_guard` juga menolak perubahan `start_date` oleh non-admin (tidak ada alur staf yang menulis
  `start_date` saat update). Mode Demo: `LocalRepo.redateLease` dengan pemeriksaan & pesan yang sama, semua divalidasi sebelum baris
  pertama berubah dan dikembalikan bila penyimpanan gagal. Sebelum menulis, aksi membaca ulang sewa, tagihan, dan sewa di kamar itu;
  bila berbeda dari yang dipratinjau (`redateDataChanged`) ditolak dengan `LEASE_DATA_CHANGED_MESSAGE`. Setelahnya `leases` +
  `invoices` di-invalidate. Layar lama di perangkat lain: **Tagih/Perpanjang** (`issueInvoice`), **Checkout**, dan **Batalkan**
  membaca ulang sewa sebelum menulis dan menolak dengan `LEASE_DATA_CHANGED_MESSAGE` bila `start_date` tersimpan bukan lagi yang
  ditampilkan (jadwal lama akan menyisakan malam yang tidak ditagih atau membatalkan tagihan yang salah). Bila aplikasi terbit
  sebelum `schema.sql` dijalankan ulang di proyek (PostgREST `PGRST202`, fungsi belum ada), simpan menampilkan 'Fitur ini belum
  aktif di server. Minta operator memperbarui database.'; tidak ada yang ditulis. Urutan rilis: jalankan ulang `schema.sql` dulu,
  baru push ke `master`.
- **Riwayat**: trigger audit mencatat update sewa dan setiap tagihan; **Riwayat perubahan** tagihan menampilkan "Awal periode",
  "Check-out periode", "Jatuh tempo" lama → baru (urutan itu).
- **Uji**: `redate.test.ts` (grid bulanan/mingguan/harian, lebih awal & lebih lambat, jangkar akhir bulan, kabisat, void, shift +
  kesinambungan periode berikutnya, aturan `end_date`, jatuh tempo, bentrok, tanggal sama, sewa selesai), `redateLease.test.tsx`
  (aksi dengan `LocalRepo`), `RedateLeaseModal.test.tsx`, `supabaseRepo.redate.test.ts`, `supabase/tests/26-redate.sql`,
  `e2e/redate.spec.ts` (360 px, Mode Demo).

### 7.7 Rencana check-in & daftar tunggu
- **Masalah**: kos penuh (31 kamar, kebanyakan bulanan); tamu harian/mingguan menelepon untuk tanggal tertentu. Pemilik ingin
  cepat tahu kamar mana yang kosong, memesannya tanpa dobel check-in, dan mencatat orang yang belum dapat kamar.
- **Cek kamar & pesan** (`/rencana`, modul `src/features/rencana`; pintu masuk: tombol cepat Dashboard **Cek kamar kosong**,
  tombol **Cek kamar** di `/sewa`, dan **Pesan tanggal lain** pada lembar kamar Kosong/Dipesan di papan kamar, terisi kamar itu).
  Isian (disimpan di alamat: `?jenis=harian|mingguan|bulanan&mulai=&jumlah=&maks=&kos=&kamar=&tunggu=`, `rencanaParams.ts`): jenis
  Harian/Mingguan/Bulanan (bawaan Harian), tanggal check-in (bawaan hari ini), jumlah malam/minggu/bulan (`CountInput`), harga
  maks. **per malam/minggu/bulan** (opsional); kos = filter kos global (`propertyFilterIds`). Hari check-out tampil langsung (7.3).
- **Perhitungan murni** `availability.ts` → `findAvailability({ rooms, leases, request, today, propertyIds?, roomId?, tenants? })`:
  - Malam yang dipegang sewa (`leaseHold`): `cancelled` tidak; `ended` sampai `checkout_date − 1` (`end_date` bila kosong);
    pesanan **harian/mingguan** yang belum mulai (aktif, `start_date` > hari ini) `[start_date, end_date]`; tamu harian/mingguan
    yang sedang menginap `[start_date, end_date]` (diharapkan keluar di hari check-out; ditandai "masih menginap"); **penyewa
    bulanan — yang sudah tinggal maupun yang baru dipesan (Dipesan) — tanpa Rencana keluar, dan tamu yang hari check-out-nya
    sudah lewat tanpa checkout, memegang kamar mulai `start_date` sampai checkout dicatat** (sewa aktif tanpa batas atas, 2a;
    pesanan bulanan tertulis "Dipesan Zaki mulai 1 Nov (bulanan)") — kamar penyewa bulanan tidak ditawarkan sebagai kosong
    sesudah bulan pertamanya, sebelum maupun sesudah ia masuk, sampai ia bilang akan keluar: **Rencana keluar** (7.8) membatasi
    pegangannya sampai malam sebelum hari keluar itu (tidak pernah kurang dari `end_date`), dan bila masa yang sudah ditagih
    berakhir sebelum tanggal yang dicari kamarnya tampil di **Bisa kosong** (7.8). Sewa tanpa malam
    (checkout di hari mulai) tidak memegang apa pun. Kamar perbaikan tidak pernah ditawarkan. **Check-in hari ini** mengikuti
    aturan Check-in cepat (7.4): kamar yang tamunya ber-check-out hari ini tetapi checkout-nya belum dicatat tidak ditawarkan
    ("Ditempati Hendra sampai check-out dicatat", `stillCheckedIn`); untuk tanggal sesudahnya kamar itu tetap ditawarkan dengan
    catatan "masih menginap". Aturan ini tidak pernah lebih longgar dari penjaga database (yang memakai `end_date` untuk sewa aktif).
  - (1) **Kosong untuk seluruh tanggal**: harga = tarif kamar × jumlah (harian × malam, mingguan × minggu, bulanan × bulan; tanpa
    tarif: "Harga belum diatur", total diketik di lembar pesan); urutan **paling pas**: sisa malam kosong terkecil sebelum pesanan
    berikutnya setelah check-out (tanpa pesanan berikutnya paling akhir), lalu malam menganggur terkecil sebelum check-in (dihitung
    sejak hari ini), lalu harga, lalu nama kamar; alasan satu baris ("Pas sebelum pesanan 12 Nov", "Sisa 3 malam sebelum pesanan
    15 Nov"; tanpa pesanan sesudahnya: "Kosong mulai 5 Nov (setelah Sari check-out)" selama ada tamu yang menginap atau dipesan
    sebelum itu, "Kosong mulai 21 Nov (Budi akan keluar)" sesudah Rencana keluar, dan "Kosong sampai seterusnya" **hanya** untuk
    kamar yang kosong sejak hari ini, 7.8) + catatan tamu sebelumnya ("Sari masih menginap, jadwal check-out 5 Nov", "Budi masih
    menginap, rencana keluar 21 Nov", "Langsung setelah Sari check-out"). Kamar di atas harga maks. tidak ditampilkan (dihitung `overBudget`); kamar tanpa tarif tetap tampil.
  - (2) **Hampir cocok** (maks. 5, malam kosong terbanyak dulu): alasan persis dari rentang kosong terpanjang ("Kosong 5–9 Nov,
    lalu dipesan Budi", "Ditempati Sari sampai 7 Nov, lalu kosong 7–12 Nov").
  - (3) Tidak ada yang kosong: keadaan kosong yang jelas + tombol **Masukkan ke daftar tunggu** (form terisi tanggal, jenis,
    jumlah, harga maks.). Untuk satu kamar (`?kamar=`) kamar yang tidak kosong tampil dengan penyebabnya ("Dipesan Budi 27–29 Okt").
  - Sejak 7.8 ada kelompok **Bisa kosong** di antara (1) dan (2); urutan tampil: Kosong untuk seluruh tanggal, Bisa kosong, Hampir
    cocok.
  - Setiap kamar punya **strip 14 hari** mulai tanggal check-in (`availabilityStrip`: kosong / terisi / dipesan / hari check-out,
    malam yang dipilih bergaris; hari Rencana keluar juga "hari check-out") dengan teks pengganti untuk pembaca layar (`stripText`).
- **Pesan** → lembar `BookingSheet`: nama penyewa dengan pencocokan penyewa lama seperti Check-in cepat (`tenantsNamed` +
  `resolveTenantChoice`), HP opsional ("HP belum diisi" diingatkan), total (terisi dari tarif, bisa diubah; per malam/minggu/bulan
  tampil), DP opsional (jumlah + Tunai/Transfer/QRIS; sama dengan total = lunas), catatan; untuk check-in hari ini juga No.
  kendaraan opsional (7.11; tamu tanggal nanti mengisinya di halaman sewa saat datang). Simpan lewat **jalur yang sama dengan
  Check-in cepat**: `saveQuickCheckIn` diperumum menjadi `saveStayBooking` (semua jenis periode, tanggal mulai kapan saja, DP
  bertanda 'DP' seperti wizard): penyewa (bila baru) → sewa `active` (`start_date` = check-in) → tagihan pertama lewat
  `insertFromDraft` → pembayaran → status tagihan. Check-in hari ini = Check-in cepat; tanggal nanti = **Dipesan** di papan kamar,
  Kos & Kamar, dan detail sewa (lencana "Dipesan · mulai 27 Okt"). Tepat sebelum menulis, `useRencanaActions.bookStay` membaca
  ulang kamar dan sewa-sewanya (`stayConflict`) dan menolak dengan nama pesanan yang menghalangi ("Kamar A3 sudah tidak kosong pada
  tanggal itu: dipesan Budi 27–29 Okt. Pilih kamar atau tanggal lain."; check-in hari ini ke kamar yang tamunya belum dicatat
  check-out: "Kamar 102 masih ditempati Hendra: check-out-nya belum dicatat. Catat check-out dulu, lalu coba lagi."); penolakan
  penjaga database di detik terakhir diberi nama yang sama. Pesanan untuk entri daftar tunggu juga membaca ulang entrinya lebih
  dulu: entri yang sudah dipesan, dibatalkan atau dihapus di HP lain ditolak sebelum apa pun ditulis ("Entri daftar tunggu ini
  sudah dipesan, dibatalkan atau dihapus di HP lain. Muat ulang lalu periksa."), jadi satu orang tidak terpesan dua kali di dua
  kamar dan tautan `lease_id` tidak tertimpa. Tamu tidak datang: pemilik/admin membuka sewanya → **Batalkan sewa** (tanggal hari itu; 2b.4, 7.3 "belum menginap").
- **Daftar tunggu** (`/daftar-tunggu`; dari tombol di `/sewa`, dari `/rencana`, dan kartu Dashboard "Daftar tunggu: N orang ·
  M ada kamar cocok" yang hanya tampil bila N > 0). Tabel `public.waitlist`: `id, org_id, property_id` (null = kos mana saja),
  `name` (wajib), `phone`, `wanted_from` (null = secepatnya), `period_type`, `quantity ≥ 1`, `max_price` (per unit), `room_note`,
  `notes`, `status` waiting|booked|cancelled (bawaan waiting), `lease_id` (diisi saat dipesan; FK ke leases on delete set null),
  `created_by` (dipaksa `auth.uid()`), `created_at/updated_at`; FK komposit `(org_id, …)`; RLS: select/insert/update anggota
  (staf termasuk), delete pemilik/admin; trigger `set_updated_at`, `keep_org_id`, `set_created_by`, `audit_row_change`; ikut
  `export_backup`, cadangan JSON, impor Mode Demo (mengikuti kosnya; tanpa kos seperti baris lain di luar kos; `lease_id` yang
  sewanya tidak ikut dikosongkan) dan Riwayat perubahan. Bila aplikasi terbit sebelum `schema.sql` dijalankan ulang, halaman
  menjelaskannya dan cadangan/impor melewatkan tabel ini.
  - Daftar: Menunggu dulu (secepatnya paling atas, lalu tanggal terdekat), chip **Menunggu / Sudah dipesan / Batal**. Kartu: nama,
    HP (wa.me) atau gelembung oranye "HP belum diisi" yang membuka form di Nomor HP, yang diinginkan (`wantText`), preferensi,
    kecocokan langsung dari `availability.ts` ("Kamar cocok: A3, B1 (Rp 360.000)" / "Belum ada kamar"; hanya kelompok kosong —
    kamar Bisa kosong hanya petunjuk "+2 bisa kosong", 7.8, dan tidak dihitung di kartu Dashboard). Aksi: **Kabari** (WhatsApp:
    sapaan, kamar, tanggal dengan check-out, harga, nama kos; `kabariText`), **Pesan** (membuka `/rencana` terisi, termasuk kos
    entri (`kos=`): planner hanya mencari di kos itu seperti kecocokannya, dengan chip "Hanya <kos>" untuk melepasnya; setelah
    pesanan tersimpan entri menjadi `booked` dengan `lease_id` dalam alur yang sama), **Ubah**, **Batal** (`cancelled`; bisa
    diaktifkan lagi; Batal/Aktifkan lagi membaca ulang entri dan menolak entri yang sudah dipesan di HP lain); **Hapus** hanya
    pemilik/admin. Form: nama, HP, kos, mulai (tanggal atau Secepatnya), jenis + jumlah, harga maks.,
    preferensi, catatan.
- **Penjaga database** `public.leases_overlap_guard` (BEFORE INSERT OR UPDATE ON leases, security definer; "hari ini" = tanggal
  WIB `(now() at time zone 'Asia/Jakarta')::date`, bukan `current_date` server UTC, sehingga tidak pernah mulai lebih lambat dari
  pemeriksaan aplikasi; pemanggil yang memang tidak boleh menulis baris itu — bukan anggota organisasinya, atau kamar organisasi
  lain — dilewati tanpa pemeriksaan sehingga RLS (42501) / FK (23503) menolak seperti biasa dan tidak membocorkan apakah kamar itu
  terisi): mengambil
  `pg_advisory_xact_lock` per kamar (HP kedua menunggu HP pertama selesai, lalu melihat barisnya), lalu menolak dengan SQLSTATE
  **WB003** 'Kamar sudah terisi atau dipesan pada tanggal itu.' bila tulisan membuat tumpang tindih **baru** dengan sewa
  non-cancelled lain di kamar yang sama (aturan `leaseOverlaps`; `ended` sampai `checkout_date − 1`). Hanya malam mendatang:
  INSERT sewa `active` → `[greatest(start_date, hari ini), end_date]`; UPDATE yang mempertahankan kamar, `start_date` dan status
  `active` sambil memperpanjang `end_date` (Perpanjang/Tagih) → `[greatest(end_date lama + 1, hari ini), end_date baru]`. Tidak
  diperiksa: pindah kamar (aplikasi, 2b.9), koreksi tanggal mulai (`redate_lease` memeriksa sendiri, setelah mengambil kunci
  kamar yang sama sehingga koreksi dan pemesanan kamar itu pada saat yang sama tidak saling lolos), baris riwayat
  ended/cancelled (impor), memperpendek, checkout, batal. Bukan RPC (pengecualian prinsip bagian 1 seperti 7.6 demi dua HP
  sekaligus). `LocalRepo` meniru aturan yang sama dengan hari ini perangkat (`overlappingLease` + `guardedNights` di
  `domain/occupancy.ts`, pesan `LEASE_OVERLAP_MESSAGE`; `translateDbError` memetakan WB003). **Perpanjang/Tagih** memeriksa aturan
  yang sama pada data segar **sebelum** tagihan dibuat, jadi perpanjangan yang ditolak tidak meninggalkan tagihan dan menyebut
  pesanannya ("Kamar ini sudah dipesan Budi mulai 5 Nov 2026, jadi sewa ini tidak bisa diperpanjang sampai 12 Nov 2026 …").
  Urutan rilis: jalankan ulang `schema.sql` dulu, baru push ke `master`.
- **Uji**: `availability.test.ts` (rentang harian/mingguan/bulanan, hari check-out dipakai lagi, sewa ended dengan
  checkout_date, pesanan mendatang, perbaikan, urutan paling pas, teks hampir cocok, harga, akhir bulan & kabisat, strip),
  `waitlist.test.ts`, `occupancyGuard.test.ts`, `localRepo.guard.test.ts`, `useRencanaActions.test.tsx` (pesanan + tagihan + DP,
  Dipesan, penolakan saat kamar diambil HP lain, tautan daftar tunggu, staf boleh memesan & mengelola tetapi tidak menghapus,
  perpanjangan ke pesanan ditolak tanpa tagihan), `supabase/tests/27-rencana.sql` (penjaga insert/perpanjangan termasuk dua sesi
  dblink bersamaan, riwayat boleh, pindah kamar & redate tidak terganggu, RLS daftar tunggu per peran & lintas organisasi, riwayat
  perubahan, `export_backup`; sejak tinjauan: tanggal WIB apa pun zona sesi, orang luar/organisasi lain mendapat 42501/23503
  bukan WB003, balapan `redate_lease` vs pemesanan lewat dblink), `e2e/rencana.spec.ts` (360 px, Mode Demo, jam tetap).

### 7.8 Rencana keluar & "Bisa kosong"
- **Masalah** (data live: 31 kamar terisi semua; 28 sewa bulanan — 26 dibayar s/d akhir Okt–Nov 2026, 2 s/d Juni 2027 — 2
  mingguan, 1 harian): karena penyewa bulanan dianggap terus memperpanjang sampai checkout dicatat (7.7), mencari 1 malam pada
  24 Des 2026 hanya menawarkan 3 kamar harian/mingguan, dan menulis "Kosong sampai seterusnya" di samping "<nama> masih menginap,
  jadwal check-out 30 Okt". Keputusan pemilik: kamar bulanan yang masa bayarnya berakhir sebelum tanggal yang dicari tampil di
  kelompok terpisah **Bisa kosong**; memesannya mensyaratkan Rencana keluar penyewa itu dicatat lebih dulu.
- **Data**: kolom `public.leases.planned_checkout_date date` (nullable) = **hari check-out** yang dikatakan penyewa (7.3: malam itu
  kamar sudah kosong); constraint `leases_planned_checkout_check`: `null` atau `> start_date`. Bukan syarat sewa: semua anggota
  (termasuk staf, pekerjaan meja depan) boleh mengisi/menghapusnya, `leases_terms_guard` tidak memeriksanya, RLS sama dengan kolom
  sewa lain. Tidak ada perubahan pada `leases_overlap_guard`: pesanan sesudah `end_date` penyewa bulanan memang sudah diizinkan
  database; aplikasi yang mensyaratkan Rencana keluar dulu. Skema hanya bertambah (tanpa DROP): `alter table … add column if not
  exists` + do-block yang menambah constraint bernama bila belum ada. Ikut `export_backup`, cadangan JSON, impor Mode Demo (kolom
  `date`; cadangan lama tanpa kolom = `null`; baris dengan rencana ≤ mulai dilewati seperti baris tidak valid lain), Riwayat
  perubahan ("Rencana keluar: – → 21 Nov 2026"), `LocalRepo` (bawaan `null` untuk baris lama, constraint ditiru dengan pesan
  `PLANNED_CHECKOUT_BEFORE_START_MESSAGE`), `translateDbError` (nama constraint → pesan itu; kolom belum ada di server,
  PGRST204/42703 → 'Fitur ini belum aktif di server. …'). Tipe: `Lease.planned_checkout_date?: string | null` (opsional: baris
  lama tidak membawanya; tidak ada = tanpa rencana). Data contoh Mode Demo: Dewi Lestari (B2) bulanan, dibayar s/d malam
  sebelum hari ini + 21, rencana keluar hari ini + 21.
- **Rencana keluar** (detail sewa → **Lainnya → Rencana keluar**, untuk sewa bulanan aktif atau sewa aktif yang sudah punya
  rencana; juga **Tandai akan keluar** di Bisa kosong): lembar `PlannedCheckoutModal` — "Ditagih s/d (check-out)", rencana sekarang,
  input **Tanggal keluar (check-out)** dengan bawaan rencana yang ada, atau `end_date + 1`, atau hari ini bila hari itu sudah lewat
  (`defaultPlannedCheckout`); galat bila ≤ tanggal mulai (`plannedCheckoutError`); keterangan bila sebelum masa yang ditagih
  berakhir ("Cek kamar menawarkan kamar ini mulai <check-out tagihan>, atau sejak checkout dicatat") atau sesudahnya ("Malam … belum
  ditagih", `plannedCheckoutNote`); peringatan bila tanggal sudah lewat; **Simpan** dan **Batalkan rencana keluar**. Aksi
  `useLeaseActions.setPlannedCheckout(lease, day | null)`: membaca ulang sewa, menolak sewa yang sudah tidak aktif
  (`PLANNED_CHECKOUT_INACTIVE_MESSAGE`) dan tanggal ≤ mulai segar, menulis hanya kolom itu, invalidate `leases` (juga bila
  ditolak). Tagihan, `end_date`, kamar, harga tidak berubah; checkout tetap dicatat saat penyewa benar-benar keluar.
  **Pesanan yang bergantung pada rencana**: membatalkan rencana atau memundurkannya mengembalikan malam sesudah masa yang ditagih
  kepada penyewa, `[max(end_date + 1, hari ini), rencana baru − 1]` (tanpa batas bila dibatalkan; `plannedCheckoutHeldNights`).
  Bila sewa lain di kamar itu (pesanan yang dibuat karena rencana itu membebaskan kamar) memegang salah satu malam itu
  (`overlappingLease`, yang paling awal), aksi menolak sebelum menulis dan menyebut pesanan itu (`plannedCheckoutBookedMessage`:
  'Rencana keluar tidak bisa dibatalkan: kamar A1 sudah dipesan Sari mulai 1 Des 2026. Pindahkan atau batalkan pesanan itu
  dulu.' / 'Kamar A1 sudah dipesan Sari mulai 1 Des 2026, jadi tanggal keluar paling lambat 1 Des 2026. Pindahkan atau batalkan
  pesanan itu dulu bila penyewa tetap tinggal.'; lembar tetap terbuka, pesan sebagai toast). Memajukan rencana, atau tepat di
  hari check-in pesanan itu, selalu diterima. Online dan Mode Demo memakai jalur yang sama (penjaga database dan `LocalRepo` tidak
  memeriksa kolom ini).
- **Tampil di mana**: lencana "Akan keluar 21 Nov" (`plannedCheckoutBadge`; sesudah harinya lewat tanpa checkout: "Rencana keluar
  20 Okt lewat", merah) di judul detail sewa (+ baris "Rencana keluar" di Info sewa), baris ketiga di daftar sewa
  (`lease-planned-checkout`), papan kamar (kotak "Keluar 21 Nov" menggantikan "Terisi", atau "N hari" bila ia keluar paling lambat
  pada jatuh tempo itu; Telat/Hari ini tetap; lembar kamar "Akan keluar 21 Nov"), dan baris Dashboard **Akan berakhir**.
  **Checkout**: tanggal bawaan = rencana keluar bila ada ("Sesuai rencana keluar penyewa."). **Tagih/Perpanjang**: bila rencana
  keluar ≤ awal periode yang akan ditagih, peringatan "Penyewa berencana keluar <tgl>. …" (tidak memblokir, tidak mengubah tagihan).
- **Ubah tanggal mulai** (7.6): rencana keluar tidak ikut bergeser; mulai baru ≥ rencana keluar ditolak sebelum menulis apa pun —
  perencana (`redatePlannedCheckoutMessage`: 'Rencana keluar penyewa 15 Sep 2026 tidak sesudah tanggal mulai yang baru. Ubah atau
  batalkan rencana keluar dulu.'), `LocalRepo.redateLease`, dan database (constraint menggagalkan seluruh `redate_lease`, satu
  transaksi; pesan diterjemahkan).
- **Perencana** (`availability.ts`): sewa **bulanan** aktif dengan rencana keluar memegang `[start_date, max(rencana − 1, end_date)]`
  (tidak pernah lebih longgar dari penjaga database, yang memegang sampai `end_date` selama checkout belum dicatat); hari rencana
  keluar itu kosong (dipakai ulang di hari check-out) dan tampil "hari check-out" di strip; bila hari rencana itu sendiri sudah
  lewat tanpa checkout ia kembali memegang tanpa batas — juga bila rencana itu jatuh sebelum akhir masa yang ditagih (sama dengan
  lencana merah "Rencana keluar … lewat"); bila hari itu hari ini, check-in hari ini mengikuti aturan Check-in cepat (belum
  ditawarkan sampai checkout dicatat). Tanpa rencana: bergulir seperti 7.7, **kecuali** masa yang ditagih (`end_date`) berakhir
  sebelum check-in: kamar masuk **`maybeFree`** bila semua pegangan yang mengambil malam menginap adalah penyewa bulanan semacam itu
  dan, seolah ia keluar di hari check-out masanya, tidak ada pegangan lain yang mengambil malam menginap (`maybeFreeHold`); di dalam
  harga maks. Untuk check-in hari ini penyewa yang masih di kamar tidak pernah tampil di Bisa kosong (aturan Check-in cepat:
  hanya mencatat checkout-nya yang membebaskan kamar, sama seperti sesudah rencana keluar hari ini). Catatan kamar kosong sesudah
  rencana keluar memakai tanggal rencana penyewa sendiri; bila rencana itu sebelum akhir masa yang ditagih: "Budi masih menginap,
  rencana keluar 10 Nov (ditagih s/d 1 Des)" (kamar ditawarkan mulai 1 Des). Kamar itu tetap tercantum di `taken` (belum kosong) dan pemeriksaan ulang pesanan (`stayConflict`) tetap menolaknya.
  Urutan: dibayar s/d paling awal, lalu nama kamar. Setiap entri: kamar, penyewa (tautan ke sewa), "dibayar s/d <check-out>" (atau
  "ditagih s/d … · sisa Rp …" bila belum lunas), "belum diperpanjang N hari" bila hari check-out masanya sudah lewat (`lapsedDays`),
  harga menginap; aksi **Tanya perpanjang** (WhatsApp, teks `extensionQuestionText` dari Dashboard; tanpa HP: "HP belum diisi" ke
  profil penyewa) dan **Tandai akan keluar** (lembar Rencana keluar); tidak ada **Pesan**. Setelah disimpan data dibaca ulang dan
  kamar langsung pindah ke kelompok kosong bila rencana keluar ≤ check-in (atau ke Hampir cocok bila sesudahnya). Tampil 8 pertama +
  **Tampilkan semua (N)**. Judul: "Bisa kosong — penyewa bulanan belum konfirmasi (N)"; keadaan kosong menambahkan "N kamar bisa
  kosong bila penyewa bulanannya keluar". Satu kamar (`?kamar=`): kartu Bisa kosong menggantikan kartu "tidak kosong".
- **Daftar tunggu**: kecocokan hanya kelompok kosong; `WaitlistMatch.maybeFree` → petunjuk "+N bisa kosong" (`maybeFreeText`) di
  samping kecocokan; kartu Dashboard tetap menghitung kelompok kosong saja.
- **Rilis**: jalankan SQL kolom + constraint (tanpa DROP) di proyek live lebih dulu, baru push ke `master` (aplikasi lama mengabaikan
  kolom itu; aplikasi baru sebelum SQL: menyimpan rencana keluar menampilkan 'Fitur ini belum aktif di server. …').
- **Uji**: `availability.keluar.test.ts` (kasus pemilik: 31 kamar, 1 malam 24 Des; rencana keluar sebelum/sesudah menginap, hari
  check-out dipakai ulang, rencana sebelum akhir tagihan (+ catatannya), rencana lewat (juga yang sebelum akhir tagihan), check-in
  hari ini (juga tanpa Bisa kosong), strip, syarat Bisa kosong, urutan, kata "Kosong mulai …"), `plannedCheckout.test.tsx` (aksi
  pemilik & staf, penolakan, batal/mundur di atas pesanan ditolak, constraint Mode Demo, redate, Checkout, peringatan Tagih, lembar),
  `plannedCheckoutUtils.test.ts`, `boardModel.keluar.test.ts`, `plannedCheckout.data.test.ts` (data contoh, baris
  lama, impor, riwayat, `translateDbError`), `supabase/tests/28-keluar.sql` (kolom + constraint, staf boleh, organisasi lain/orang
  luar ditolak RLS, penjaga pesanan tidak berubah, redate ditolak & rencana tidak bergeser, riwayat, `export_backup`; di ketiga
  skenario), `e2e/keluar.spec.ts` (360 px, Mode Demo, jam tetap 24 Okt 2026; membatalkan/memundurkan rencana Budi di atas pesanan yang
  dibuat karenanya ditolak, memajukannya diterima). `e2e/rencana.spec.ts` kini mengharapkan "Kosong mulai
  27 Okt (setelah Hendra Wijaya check-out)" alih-alih "Kosong sampai seterusnya" untuk kamar yang tamunya masih menginap.

### 7.9 Transisi halaman & jendela
- **Permintaan pemilik**: perpindahan halaman dan jendela semulus iOS/iPadOS (dan Android). Tanpa pustaka tambahan: View
  Transitions API peramban (Safari 18+, Chrome 111+, Firefox 144+) untuk halaman, Web Animations untuk keluarnya jendela, CSS untuk
  masuknya. Tanpa API atau dengan **Kurangi gerakan** (`prefers-reduced-motion: reduce`): semuanya langsung seperti sebelumnya.
  Satu gaya (iOS) untuk iPhone, iPad dan Android: transisi bawaan Android juga geser horizontal, tab Material = fade through.
- **Gerak halaman** (`src/app/pageMotion.ts`, murni): kedalaman halaman = 1 untuk bagian menu (`dashboard`, `sewa`, `penyewa`,
  `kos`, `pengeluaran`, `laporan`, `pengaturan`), lebih dalam untuk halaman yang dibuka darinya (`sewa/:id`, `sewa/baru`,
  `penyewa/:id`, `kos/:id`; `rencana` dan `daftar-tunggu` dihitung 2). `push` = lebih dalam atau tautan silang (sewa → penyewa,
  rencana → daftar tunggu); `pop` = kembali ke daftar bagiannya sendiri (`sewa/:id` → `sewa`) atau lebih dangkal; `tab` = antar
  bagian menu (juga dari halaman detail ke bagian lain), dan login/daftar ↔ aplikasi; `none` = path sama (hanya search params).
  Langkah riwayat mundur memutar kebalikan langkah yang menuju ke situ (push → pop), maju memutarnya ulang; arah dari
  `history.state.idx`.
- **Router** (`src/app/pageTransitions.ts`, `installPageTransitions(router)` di `routes.tsx`): path dibaca **tanpa basename**
  (`withoutBasename`; GitHub Pages menyajikan aplikasi di `/Woombad/` dan state router menyimpan awalan itu). Membungkus
  `router.navigate` (dipakai `<Link>`, `<NavLink>`, `useNavigate`, `<Navigate>`, `setSearchParams`): path berubah →
  `viewTransition: true` + `flushSync: true` (React Router menggambar halaman baru langsung di dalam
  `document.startViewTransition` miliknya sendiri; tanpa `flushSync` ia mengantrekan perubahan untuk render berikutnya, dan
  ketukan cepat beruntun dapat membuat antrean React Router 8.4 menggambar halaman lama di atas yang terbaru — layar tertinggal
  dari URL; uji stres: 1–2 dari 80 putaran sebelum, 0 dari 250 sesudah; React Router membuang `flushSync` pada kunjungan
  pertama ke halaman lazy, yang tetap lewat antrean — ditutup pengaman di bawah), kecuali dari `/`
  (pengalihan saat aplikasi dibuka: belum ada yang bisa digeser) dan kecuali tautan yang membuka jendela saat halaman tiba
  (`?action=` di sewa, `?new=1` di Penyewa/Pengeluaran, `?isi=hp`, `?impor=demo`) atau kamera (`?scan=1`): halaman langsung
  berganti seperti dulu lalu jendelanya naik (dalam geseran ia terbuka di bawah bilah yang diam, yang menutupi bagian bawahnya);
  path sama → tanpa transisi (render sinkron tetap, `flushSync` perencana tetap berlaku) dan `preventScrollReset: true`, kecuali
  tepat setelah perubahan halaman yang belum digambar (mis. `<Navigate>` penjaga sesudah navigate logout/login sendiri): ia ikut
  transisi itu, supaya perubahan lama tidak tergambar menimpanya (lokasi yang tampil = URL = state router); pilihan eksplisit
  pemanggil menang. Navigasi `replace` yang diberi `flushSync` di sini dijalankan satu microtask kemudian: `<Navigate>` penjaga
  memanggilnya dari effect React, tempat React tidak bisa flush (di mode pengembangan ia mencatat galat). Pelanggan `router.subscribe`
  menulis `html[data-page-motion]` **hanya** untuk perubahan yang menjalankan transisi (halaman yang menghapus parameternya
  sendiri saat dibuka, `?action=` / `?new=1`, tidak mengubah geseran yang sedang berjalan menjadi `none`); bila peramban sudah
  menganimasikan gestur kembali (`popstate.hasUAVisualTransition`, Safari) → `none`, dan animasi keluar dijeda sampai halaman
  yang dibukanya tergambar (peramban sudah menggeser halaman lama beserta jendelanya). `document.startViewTransition` dibungkus:
  janji `ready` / `finished` / `updateCallbackDone` dari transisi yang dilewati ditangkap (bukan galat); transisi `none`
  (mis. React Router memutar ulang transisi untuk langkah mundur yang hanya mengubah search params) langsung `skipTransition()`;
  selain itu, di awal callback (snapshot halaman lama sudah diambil, termasuk jendela yang sedang tertutup) salinan jendela dihapus
  dan animasi keluar dijeda (`pauseExitAnimations`) sampai halaman baru selesai digambar — jendela yang tertutup karena halaman
  berganti, atau ditutup lalu langsung pindah halaman setelah **Simpan**, ikut bergeser bersama halaman lama. Back/forward
  memakai pasangan yang direkam React Router; langkah ini tetap lewat antrean React Router (tidak bisa `flushSync`), jadi
  sebagai pengaman: 150 ms setelah setiap transisi berakhir, bila tidak ada transisi lain berjalan, halaman yang digambar
  AppShell (`reportRenderedLocation`) bukan lokasi router, tidak ada navigasi berjalan, **dan** keadaan itu masih sama pada
  pemeriksaan 150 ms berikutnya (langkah mundur yang sebentar lagi digambar tampak sama sesaat; menggambar ulang saat itu
  menghilangkan pemulihan gulirnya), `router.revalidate()` membuat RouterProvider menggambar keadaan router sekarang (tanpa
  transisi, tanpa mengubah riwayat; aplikasi tidak memakai loader); halaman baru (bukan langkah riwayat) lalu digulir ke atas. Callback React Router yang menunggu render
  dibatasi 1 detik (`UPDATE_LIMIT_MS`): layar tidak membeku sampai batas 4 detik peramban.
- **Riwayat & gulir**: `<ScrollRestoration/>` di AppShell — halaman baru mulai dari atas, kembali memulihkan posisi (kunci
  `location.key`). `seedHistoryKey()` sebelum `createBrowserRouter`: dokumen yang baru dibuka (muat ulang, tautan langsung,
  aplikasi terpasang) mendapat kunci riwayat sendiri, bukan `'default'` bersama, sehingga tidak mewarisi posisi gulir halaman
  lain. `previousPathname()` (path entri riwayat sebelumnya yang dilihat tab ini) dipakai `BackLink` (`src/app/BackLink.tsx`):
  **← Semua sewa / Semua penyewa / Semua kos** kembali di riwayat (`navigate(-1)`: halaman tergeser keluar, daftar kembali ke posisi
  gulirnya, riwayat tidak bertambah) bila entri sebelumnya adalah daftar itu; bila tidak, membuka daftar seperti biasa.
- **CSS** (`src/index.css`, bagian Motion): kurva `--ease-ios` `cubic-bezier(0.32, 0.72, 0, 1)` (Ionic iOS, Vaul); bila
  `linear()` didukung, pegas tanpa pantulan yang diukur dari frame iOS (selisih < 1%). `push` 450 ms (iOS ±500 ms; selama
  transisi halaman tidak bisa diketuk): halaman baru dari `translateX(100%)` dengan bayangan kiri tipis, halaman lama ke `-33%`
  dan redup ±10% (opacity 0,9 di atas hitam); `pop` kebalikannya (halaman lama di atas); mulai md (ada menu kiri, `w-60` = 15rem) kedua snapshot dipotong
  (`clip-path: inset(0 0 0 15rem)`) dan digeser selebar kolom isi (`--page-slide: calc(100% - 15rem)`), seperti split view iPad
  (tanpa itu bagian snapshot di bawah menu kiri ikut bergeser sebagai pita kosong); `tab`: halaman baru memudar masuk 220 ms
  di atas halaman lama yang diam (tanpa kedip putih). Bilah atas (`app-header`), menu bawah (`app-tabbar`), menu kiri
  (`app-sidebar`, kini `sticky` setinggi layar), toast (`app-toasts`) dan banner "Versi baru siap" (`app-update`) punya
  `view-transition-name` sendiri: diam (grup tanpa animasi; pada push/pop langsung keadaan baru, yang hanya ada di halaman lama
  bertahan sampai geseran selesai). Selama jendela terbuka atau salinannya tampil (`:root:has([aria-modal='true'],
  body > [data-exit-copy])`) bilah atas, menu bawah dan menu kiri tanpa nama: mereka ikut snapshot halaman (redup di bawah
  latar jendela), tidak tergambar terang di atasnya. Bilah atas putih penuh selama transisi (`:active-view-transition`; efek blur
  tidak ikut snapshot di Safari/Firefox). Jangan merender Modal/overlay `fixed` di dalam elemen bernama itu (nama transisi =
  stacking context permanen).
- **Jendela** (`Modal.tsx`, `motion.ts`): masuk — lembar naik dari bawah 500 ms (HP), dialog memudar dari `translateY(8px)
  scale(0.96)` 300 ms (≥ sm), latar gelap memudar dengan waktu & kurva yang sama; keluar — `ExitAnimation` (class component:
  `getSnapshotBeforeUpdate` saat `open` → false, `componentWillUnmount` bila komponen pemegangnya hilang) menyalin DOM jendela
  sesaat sebelum React menghapusnya (`copyForExit`: nilai isian, centang, canvas, posisi gulir; tanpa `id`/`for`/`name`/
  `data-testid`), memasang salinan di shadow root **tertutup** (dengan CSS halaman sebagai constructed stylesheet, disiapkan saat
  jendela terbuka dan HP senggang: `prepareExitStyles`) dalam host `aria-hidden` + `inert` + `pointer-events: none`, z-index 49
  (di bawah jendela yang baru dibuka), menganimasikannya (lembar turun 400 ms `EASE_IOS` = `cubic-bezier(0.32, 0.72, 0, 1)` sampai
  melewati bawah layar — juga lembar yang ditutup saat keyboard terbuka, yang dipasang di atas keyboard; dialog memudar ke skala
  0,98 180 ms dipercepat; latar gelap ikut) lalu menghapusnya (paling lambat 1 detik). Selama lembar masih naik, ketukan pada latar
  gelap diabaikan (ketukan kedua dari ketuk-ganda tombol pembukanya tidak langsung menutupnya); Esc dan X tetap langsung. Jendela aslinya hilang seketika: aplikasi tidak
  menunggu animasi; pembaca layar, ketukan, fokus, kueri DOM aplikasi dan locator e2e tidak melihat salinan. Tanpa salinan:
  jendela berisi video/iframe (kamera), Kurangi gerakan, tanpa Web Animations (jsdom), atau selama halaman baru digambar. Uji coba
  StrictMode (unmount percobaan) tidak memutar apa pun. Kolom yang langsung fokus (autoFocus) tetap: lembar tetap naik.
- **Toast**: masuk turun dari atas 350 ms; ditutup/kedaluwarsa → salinan di posisinya memudar ke atas 200 ms (z-index 60).
- **Uji**: `pageMotion.test.ts` (aturan gerak), `pageTransitions.test.ts` (opsi navigasi, path sama, pilihan eksplisit,
  back/forward, gestur peramban, tanpa API / kurangi gerakan, pembungkus `startViewTransition` termasuk transisi `none` yang
  diputar ulang React Router, basename `/Woombad`, pengalihan dari `/`, riwayat untuk BackLink, `seedHistoryKey`, uninstall),
  `pageTransitions.exit.test.tsx` (kembali dengan lembar terbuka: geseran kita dan gestur Safari, tanpa salinan di atas halaman
  baru), `motion.test.tsx` (salinan jendela/toast, shadow root tertutup, tanpa salinan saat kurangi gerakan / tanpa API / dijeda,
  pembatalan, ketukan latar gelap selama lembar naik). Playwright punya tiga proyek: `phone` (seluruh suite dengan Kurangi gerakan: langkah dan tangkapan layar tepat),
  `phone-motion` (gerak menyala: `transitions`, `quick-buttons`, `redate`, `rencana`, `keluar`, `kendaraan`, `undo-delete`) dan `pages-motion`
  (`transitions.spec.ts` pada build ber-basename `/Woombad/` di port 4174, `dist-sub`). Tangkapan layar proyek `phone` di folder
  biasa, proyek gerak di subfolder bernama proyeknya (bingkai di tengah animasi tidak menimpa yang tepat). `e2e/transitions.spec.ts`: tab/push/pop dan
  jumlah transisi, bilah tetap bernama, halaman baru di atas, kembali & **Semua sewa** memulihkan gulir tanpa menambah riwayat,
  dokumen baru tidak mewarisi gulir, tanggal Cek kamar tanpa transisi dan tanpa gulir, lembar naik/turun dan salinannya tak
  terlihat locator selama ia ada (dibaca sekali, tidak diulang) dan ketukan menembusnya, tautan di dalam lembar terbuka tanpa salinan
  sama sekali (penghitung `MutationObserver`), ketukan cepat beruntun (transisi yang dilewati dihitung selesai saat `ready`
  ditolak), Kurangi gerakan.

### 7.10 Layar pembuka "EG Kost"
- **Permintaan pemilik**: ganti "Menyiapkan aplikasi…" dengan animasi pembuka seperti logo G saat Pixel menyala, berupa tulisan
  **EG Kost** yang bergerak dan bercahaya oranye–kuning, meredup-terang seperti detak jantung lampu signature Mazda.
- **Tampilan** (`index.html`, HTML + CSS + SVG di dalam halaman, tanpa skrip aplikasi, jadi tampil sejak bingkai pertama):
  latar gelap hangat (`#0b0a08`, gradasi radial); empat titik (oranye tua, amber, kuning, peach) berputar mengelilingi tengah lalu
  bertemu (0–0,95 s, seperti titik warna boot Pixel); tulisan "EG Kost" (sistem font, EG tebal 800, Kost 600) tergambar
  garis demi garis (`stroke-dashoffset`, 0,25–1,0 s; `text-rendering: geometricPrecision`, karena WebKit tanpa itu memperkecil
  pola garis teks SVG menurut skala layar), lalu terisi (0,65–1,05 s); isi dan garisnya satu cahaya oranye–kuning yang terus
  bergeser (gradien `userSpaceOnUse`, `animateTransform` 3 s); cahaya di belakangnya (salinan tulisan yang di-blur + halo radial)
  berdenyut "lub-dub, istirahat" tiap 1,8 s mulai 0,9 s; garis cahaya di bawah tulisan memanjang dari tengah (0,85 s) dan ikut
  berdenyut;
  "Menyiapkan aplikasi…" kecil muncul di bawah setelah 3,5 s (hanya terlihat bila pemuatan lama). **Kurangi gerakan**: logo
  jadi, cahaya tetap, tanpa titik, garis, denyut, atau kilau yang bergerak. Seluruh layar `aria-hidden` (teks loading aplikasi
  dengan `role="status"` ada di bawahnya).
- **Kapan hilang** (`src/app/bootSplash.ts`, `BootSplash.tsx`): layar loading memegangnya (`BootSplashHold` di
  `FullPageLoading` saat masih spinner — penjaga login/aplikasi, `OrgProvider`, dan kini juga `/reset-sandi` serta `/gabung`
  selama sesi dimuat (sebelumnya halaman kosong) — dan di `hydrateFallbackElement` AppShell: tautan langsung ke halaman lazy
  yang kodenya masih dimuat); `BootSplashReady` di akar menjalankan pemeriksaan setelah render pertama (login, halaman error:
  langsung tidak dipegang). Saat tak ada lagi yang memegang: pada start pertama tunggu sampai `BOOT_MIN_MS` = 2,65 s sejak
  bingkai pertama layar itu sendiri (`currentTime` animasi halo `bs-halo` yang berulang — jam animasi yang sudah selesai berhenti di akhirnya; tanpa Web Animations: sejak awal halaman) — tulisan sudah
  tergambar dan terisi, lalu satu denyut penuh (permintaan pemilik: 1,5 s lebih lama dari 1,15 s semula), mulai memudar saat
  lampu redup sebelum denyut berikutnya — lalu memudar 0,45 s (ketukan langsung sampai ke aplikasi) dan dihapus; dengan Kurangi
  gerakan langsung dihapus tanpa menunggu. Layar error server (3 s / 20 s) melepas pegangan, jadi tidak tertutup. Layar loading
  berikutnya (sesudah login) memunculkannya lagi hanya bila berlangsung > 400 ms (salinan bersih, tanpa waktu minimum); ia
  memudar masuk dengan transisi opacity yang sama dengan saat keluar, jadi bila dilepas di tengah ia berbalik dengan mulus.
- **Warna bilah status**: `meta theme-color` di `index.html` = `#0b0a08` selama layar pembuka; kembali `#0f766e` saat ia
  hilang (dan gelap lagi bila muncul kembali). Manifest PWA `background_color` = `#0b0a08`, jadi layar pembuka bawaan Android
  (ikon di atas warna latar) menyambung gelap ke layar ini.
- **Uji**: `bootSplash.test.ts` (waktu minimum dihitung dari bingkai pertama layar, start lambat tanpa tambahan, Kurangi gerakan, beberapa pegangan, StrictMode,
  pegangan saat memudar, muncul lagi hanya untuk loading yang lama, halaman tanpa layar pembuka), `e2e/splash.spec.ts` (tampil
  "EG Kost" dan bilah status gelap, hilang ≥ 2,65 s animasinya dengan memudar dan bilah status teal kembali; tautan langsung ke halaman lazy
  yang kodenya lambat — tanpa service worker — tetap tertutup sampai halaman itu tergambar; Kurangi gerakan: hilang tanpa memudar).

### 7.11 Nomor kendaraan (plat)
- **Permintaan pemilik**: nomor polisi kendaraan penyewa di keterangan sewa, tampil di papan kamar; isian opsional di Check-in
  cepat. Data awal: 12 plat dari pemilik untuk 12 sewa aktif (C1, B3, B2, A10, D10, D5, D06, D09, A13, A11, A3, A7).
- **Data**: kolom `public.leases.vehicle_plate text` (nullable, tanpa bawaan, tanpa constraint). Di sewa, bukan di penyewa:
  Pindah kamar memperbarui sewa yang sama, jadi platnya ikut; menginap berikutnya mulai kosong. Bukan syarat sewa: semua anggota
  (termasuk staf) boleh mengisi/mengubah/mengosongkannya, `leases_terms_guard` dan `leases_overlap_guard` tidak memeriksanya, RLS
  sama dengan kolom sewa lain. Skema hanya bertambah (`alter table … add column if not exists`, tanpa DROP). Ikut
  `export_backup`, cadangan JSON, impor Mode Demo (kolom `text`; cadangan lama = `null`), Riwayat perubahan ("No. kendaraan: – →
  KB 1442 GZ"), `LocalRepo` (bawaan `null` untuk baris lama), `translateDbError` (kolom belum ada di server, PGRST204/42703 →
  `VEHICLE_PLATE_NOT_DEPLOYED_MESSAGE`, menyebut No. kendaraan). Tipe: `Lease.vehicle_plate?: string | null`. Data contoh Mode
  Demo: Budi (1 plat) dan Rizky (2 plat).
- **Penulisan** (`src/domain/plate.ts`, `normalizePlate`): apa pun yang diketik disimpan seperti plat ditulis — huruf besar, titik
  dan strip jadi spasi, spasi di antara huruf dan angka, spasi ganda dirapatkan ("KB.1442.Gz." → "KB 1442 GZ", "b1251sga" →
  "B 1251 SGA"); beberapa kendaraan dipisah koma (juga `;`, `/`, baris baru) dan disimpan "KB 1442 GZ, B 1251 SGA", plat yang sama
  sekali saja; kosong → `null`. Database tidak menormalkan: SQL langsung harus menulis bentuk yang sama.
- **Isian** (`PlateInput`, sama di mana-mana): label "No. kendaraan (plat)", contoh "mis. KB 1442 GZ", petunjuk "Boleh
  dikosongkan. Lebih dari satu kendaraan: pisahkan dengan koma.", keyboard huruf besar (`autoCapitalize="characters"`), tanpa
  koreksi ejaan, maks. 60 karakter; saat keluar dari isian teksnya langsung ditulis ulang seperti yang akan disimpan. Ada di
  **Check-in cepat** (setelah Nomor HP; ringkasan menulis "Kendaraan KB 1442 GZ"), **BookingSheet** untuk check-in hari ini, dan
  wizard **Sewa baru** (di atas Catatan sewa). Penyimpanan baru mengirim kolom ini **hanya bila ada plat**
  (`...(plate ? { vehicle_plate } : {})`), jadi check-in tanpa plat tetap jalan di server yang kolomnya belum ada.
  `useRencanaActions.bookStay` meneruskan `vehiclePlate` ke `saveStayBooking`.
- **Halaman sewa**, kartu **Info sewa**: baris **No. kendaraan** (plat atau "Belum diisi"; sewa yang sudah selesai hanya bila ada,
  sebagai riwayat) dengan tombol pensil (sewa aktif), juga **Lainnya → No. kendaraan** → lembar `VehiclePlateModal` (isi/ubah;
  kosongkan untuk menghapus; Simpan nonaktif bila hasilnya sama dengan yang tersimpan) → `useLeaseActions.setVehiclePlate(lease,
  plat | null)`, menulis hanya kolom itu, semua peran.
- **Papan kamar**: plat di bawah status kotak, satu baris per kendaraan (paling banyak dua, lalu "+N"), 9 px rapat
  (`tracking-tighter`, warna penuh supaya kontras di kotak merah); kotak tanpa padding samping supaya plat terlebar ("KB 1829 GN",
  ±49 px) muat utuh di kotak 52 px pada HP 360 px. Label kotak untuk pembaca layar ditambah ", kendaraan …". Lembar aksi kamar
  menampilkan semua plat dengan ikon mobil di bawah nama penyewa.
- **Cari di daftar Sewa**: kotak cari juga menemukan plat, diketik dengan atau tanpa spasi ("kb1442", "1442 gz"; `plateMatches`:
  per plat, huruf/angka saja, minimal 4 karakter supaya cari kamar "B1"/"A10" tidak memunculkan plat); baris yang ditemukan lewat
  platnya menampilkan plat itu (`LeaseRow` `plate`, `data-testid="lease-plate"`), supaya jelas kenapa ia muncul.
- **Uji**: `plate.test.ts`, `quickCheckIn.test.ts` (plat dinormalkan; tanpa plat kolom tidak dikirim), `useRencanaActions.test.tsx`
  (bookStay meneruskan plat), `vehiclePlate.test.tsx` (setVehiclePlate termasuk staf, lembar isian), `leaseUtils.test.ts` (cari
  plat), `vehiclePlate.data.test.ts` (seed, Mode Demo, impor, riwayat, pesan galat), DB `supabase/tests/29-kendaraan.sql`
  (struktur, semua anggota boleh, RLS, riwayat, cadangan), `e2e/kendaraan.spec.ts` (juga dengan gerak; papan 360 px: plat utuh,
  label, lembar; Check-in cepat dengan & tanpa plat; isi/ubah/kosongkan di halaman sewa dan lewat Lainnya; Sewa baru menyimpan
  plat; cari plat di daftar Sewa; tanpa error konsol).
