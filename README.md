# Woombad — Aplikasi Manajemen Kos (gratis, online, Android & iPhone)

Woombad adalah aplikasi web progresif (PWA) untuk mengelola satu atau banyak kos:

- **Penyewa**: data lengkap, **scan KTP** untuk mengisi otomatis (NIK, nama, TTL, alamat, …) — nomor HP diisi manual
  karena KTP tidak memuat nomor telepon.
- **Sewa & tagihan**: harian / mingguan / bulanan, tanggal mulai–selesai, harga per kamar, uang jaminan, add-on
  (kasur tambahan, parkir, laundry…), **DP / lunas** otomatis dari pembayaran, perpanjangan satu klik.
- **Pengeluaran**: gaji, perbaikan, listrik/air/internet, perlengkapan, pajak, dll. Per kos atau bersama.
- **Laporan**: harian / mingguan / bulanan / tahunan, laba-rugi, tingkat hunian, piutang, grafik, dan **ekspor
  XLSX/CSV**.
- **Online & multi-perangkat**: login email + kata sandi, data di Supabase (gratis), bisa dibuka dari Android,
  iPhone, atau laptop. Bisa di-"install" ke layar utama seperti aplikasi biasa.

> Tanpa konfigurasi apa pun aplikasi berjalan dalam **Mode Demo** (data hanya di browser ini) supaya bisa dicoba dulu.

## Biaya

| Komponen | Layanan | Biaya |
|---|---|---|
| Database, login, penyimpanan foto | Supabase Free | Rp 0 (500 MB DB, 1 GB storage, 50.000 pengguna aktif/bulan) |
| Hosting web (PWA) | Cloudflare Pages / Vercel / Netlify Free | Rp 0 |
| Scan KTP | tesseract.js di browser | Rp 0 (tanpa API) |

Catatan jujur: proyek Supabase gratis **dijeda otomatis jika 7 hari tidak ada aktivitas** dan bisa diaktifkan lagi
dengan satu klik di dashboard Supabase. Untuk kos yang dipakai tiap minggu ini jarang terjadi.

## Menjalankan secara lokal

```bash
npm install
npm run dev        # http://localhost:5173  (Mode Demo jika .env kosong)
npm test           # unit test logika bisnis
npm run typecheck
npm run build      # hasil di dist/
```

## Mengaktifkan mode online (Supabase) — sekali saja, ±15 menit

1. Buat akun di <https://supabase.com> → **New project** (region Singapore paling dekat).
2. Buka **SQL Editor** → tempel seluruh isi `supabase/schema.sql` → **Run**.
3. (Disarankan) **Authentication → Providers → Email**: matikan *Confirm email* agar login langsung tanpa cek email,
   atau biarkan aktif dan konfirmasi lewat email.
4. **Project Settings → API**: salin **Project URL** dan **anon public key**.
5. Salin `.env.example` menjadi `.env` dan isi kedua nilai tersebut (atau set sebagai *environment variables*
   di layanan hosting).
6. `npm run build` lalu deploy folder `dist/` — atau hubungkan repo ini ke Cloudflare Pages / Vercel / Netlify
   (framework: Vite, build `npm run build`, output `dist`). Set env `VITE_SUPABASE_URL` dan
   `VITE_SUPABASE_ANON_KEY` di pengaturan proyek hosting.
7. Buka alamat aplikasi → **Buat akun** (Anda otomatis menjadi pemilik organisasi "Kos Saya").
8. Undang istri/pegawai: **Pengaturan → Anggota → Undang** dengan email mereka → mereka **Buat akun** dengan email
   yang sama → otomatis masuk ke organisasi yang sama. Peran *Staf* tidak melihat Laporan dan tidak bisa menghapus
   data keuangan.

Kunci *anon* aman dipublikasikan: semua akses dibatasi Row Level Security per organisasi (lihat `schema.sql`).

## Install ke HP

- **Android (Chrome)**: buka alamat aplikasi → menu ⋮ → *Tambahkan ke layar utama* / *Install app*.
- **iPhone (Safari)**: buka alamat aplikasi → tombol *Bagikan* → *Tambahkan ke Layar Utama*.

## Struktur proyek

Lihat `docs/SPEC.md` untuk model data, aturan bisnis (tagihan, DP/lunas, deposit, hunian) dan kontrak modul.

## Lisensi

Pribadi / internal.
