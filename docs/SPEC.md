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
4. **Batalkan sewa** (`cancelled`): semua tagihan unpaid di-void; jika ada tagihan partial, pengguna harus memilih: **kembalikan** (tagihan *ditutup*, tidak di-void, karena DB menolak void tagihan yang sudah ada pembayarannya (2b.2): sisa yang belum dibayar menjadi `discount_amount`, `total_amount` = yang sudah dibayar, status paid, catatan "DP dikembalikan (<alasan>)"; lalu satu expense `rent_refund` + `lease_id` sebesar yang sudah dibayar, keterangan memuat nomor tagihan, tidak pernah dua kali untuk tagihan yang sama) atau "anggap hangus" (diskon = sisa, status jadi paid). Data dibaca ulang dari server lalu semua perubahan tagihan ditulis lebih dulu, sebelum pengeluaran/pembayaran apa pun, agar penolakan database tidak meninggalkan data setengah jadi. Pembayaran deposit diselesaikan: kembalikan (expense `deposit_refund`) atau potong (payment `other`, method `deposit`).
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
- Peran **staf** di mode Supabase tidak boleh meng-update `invoices` (RLS) dan hanya boleh **mencatat** `payments`/
  `expenses`; mengubah/menghapusnya khusus pemilik/admin (lihat 6.2). UI menyembunyikan tombol tersebut untuk staf dan
  menampilkan pesan dari `translateDbError` bila server menolak.
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
  Belum bayar + deposit, lalu simpan. `?scan=1` langsung membuka pemindai (dashboard: tombol cepat **Check-in**).

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
  `period_type` → 'Hanya pemilik/admin yang dapat mengubah harga atau jenis sewa.'
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
  besar + keterangan pendek, mis. "20 hari / terlambat", "Hari ini / jatuh tempo", "3 hari / berakhir 15 Okt") dan menu
  aksi (Bayar, Tagihan berikutnya, Kirim tagihan,
  Pengingat WhatsApp, Profil penyewa). Di layar md+ ada kolom tambahan Dibayar s/d dan Sisa tagihan. Tab Selesai/Batal
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
  catatan, "Dibuat <tanggal> · Woombad".
- Tautan wa.me hanya membawa teks, jadi gambar diserahkan ke **lembar bagikan** OS (`navigator.share` dengan berkas; Android Chrome /
  PWA terpasang dan iOS Safari) dan pemilik memilih WhatsApp + kontak; teks pengantar = `invoiceShareText`. Cadangan: **Unduh gambar**
  dan **Kirim teks saja via WhatsApp**; browser tanpa dukungan berbagi berkas diberi penjelasan.
- **Logo kos** (`properties.logo_path`, bucket privat `logos`, 1 MB, PNG/JPEG/WebP; pemilik/admin lewat form kos): diperkecil di browser
  (sisi panjang ≤ 600 px, PNG/WebP tetap PNG agar transparan, `logoImage.ts`), baris disimpan dulu lalu berkas diunggah dan
  `logo_path` di-update; berkas lama dihapus best-effort (6.4). `useKosLogo` mengunduh & men-cache logo per path (mode demo: tanpa logo).
