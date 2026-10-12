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

## Alamat aplikasi (sudah otomatis)

Setiap perubahan di cabang `master` otomatis dibangun dan dipublikasikan oleh GitHub Actions ke
**https://shinx2ran.github.io/Woombad/** (gratis, tanpa akun tambahan). Buka alamat itu di HP, lalu
**Masuk ke Mode Demo** untuk mencoba. Untuk hosting lain (Cloudflare Pages, Netlify, Vercel) cukup hubungkan repo ini;
konfigurasi fallback SPA sudah disertakan (`public/_redirects`, `vercel.json`).

## Mengaktifkan mode online (Supabase) — sekali saja, ±15 menit

1. Buat akun di <https://supabase.com> → **New project** (region Singapore paling dekat).
2. Buka **SQL Editor** → tempel seluruh isi `supabase/schema.sql` → **Run**.
3. **Authentication → Providers → Email**: biarkan *Confirm email* **aktif** (sekali konfirmasi per akun), dan di
   **Authentication → Sign In / Providers** naikkan *Minimum password length* ke **8**. Di **Authentication → URL
   Configuration** isi *Site URL* dengan alamat aplikasi Anda dan tambahkan `https://<alamat-aplikasi>/reset-sandi` ke
   *Redirect URLs* (dipakai saat lupa kata sandi).
4. **Project Settings → API**: salin **Project URL** dan **anon public key**.
5. Di GitHub: **Settings → Secrets and variables → Actions → New repository secret**, buat dua secret bernama
   `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` dengan nilai dari langkah 4. (Untuk pengembangan lokal: salin
   `.env.example` menjadi `.env`.)
6. Buka tab **Actions → Deploy to GitHub Pages → Run workflow** (atau tunggu push berikutnya). Setelah ±2 menit
   alamat aplikasi berjalan dalam mode online.
7. Buka alamat aplikasi → **Buat akun**. **Akun pertama** otomatis menjadi pemilik organisasi "Kos Saya".
8. Undang istri/pegawai: **Pengaturan → Anggota → Undang** dengan email mereka → mereka **Buat akun** dengan email
   yang sama → otomatis masuk ke organisasi yang sama (boleh juga mendaftar dulu lalu diundang; saat masuk berikutnya
   mereka otomatis bergabung). Peran *Admin* cocok untuk pasangan; *Staf* tidak melihat Laporan dan tidak bisa
   menghapus/mengubah data keuangan orang lain.

Keamanan: setelah akun pertama dibuat, pendaftaran menjadi **khusus undangan** — akun asing yang mendaftar tidak
mendapat akses apa pun. Penghapusan data keuangan (tagihan yang sudah dibayar, sewa yang punya tagihan) ditolak oleh
database; gunakan *Batalkan* / *Checkout*.

Kunci *anon* aman dipublikasikan: semua akses dibatasi Row Level Security per organisasi (lihat `schema.sql`).

## Alur pemakaian sehari-hari

| Kejadian | Yang dilakukan di aplikasi |
|---|---|
| Penyewa baru datang | **Sewa → Sewa Baru**: pilih kos & kamar kosong, pilih/buat penyewa (bisa **Scan KTP**), periode & harga, deposit, add-on, lalu catat pembayaran pertama (boleh DP). |
| Penyewa membayar | **Dashboard → Bayar** (atau buka sewa → **Catat pembayaran**). Status otomatis **DP / Sebagian** atau **Lunas**. Bisa kirim kwitansi ke WhatsApp. |
| Mendekati jatuh tempo | Dashboard menampilkan **Perlu perhatian** (terlambat / jatuh tempo ≤3 hari). Tombol **Tagih** membuat tagihan periode berikutnya dan memperpanjang sewa; ikon WhatsApp mengirim pengingat berisi nomor rekening. |
| Perpanjang 2 minggu saja | Buka sewa → **Buat tagihan berikutnya** → **Periode khusus** (pro-rata). |
| Bayar listrik / denda | Saat membuat tagihan isi kolom **Listrik / Denda / Lainnya**. |
| Penyewa pindah / keluar | Buka sewa → **Lainnya → Pindah kamar** atau **Checkout** (uang jaminan dikembalikan atau dipotong). |
| Pengeluaran | **Pengeluaran → Catat**: gaji, listrik/air, perbaikan, dll., per kos atau **Bersama**; ada tombol **Duplikat ke bulan ini** untuk biaya rutin. |
| Lihat kinerja | **Laporan**: harian / mingguan / bulanan / tahunan, laba-rugi, piutang, hunian, grafik, lalu **Unduh XLSX / CSV** atau **Cetak / PDF**. |
| Istri ikut mengelola | **Pengaturan → Anggota → Undang** (peran Admin). |

## Menguji skema database secara lokal (opsional)

`supabase/tests/run.sh` memasang `schema.sql` ke PostgreSQL lokal dengan tiruan objek Supabase dan menjalankan
pengujian fungsional (pendaftaran, undangan, RLS, pembatasan staf, trigger tagihan). Lihat komentar di dalam skrip.

## Install ke HP

- **Android (Chrome)**: buka alamat aplikasi → menu ⋮ → *Tambahkan ke layar utama* / *Install app*.
- **iPhone (Safari)**: buka alamat aplikasi → tombol *Bagikan* → *Tambahkan ke Layar Utama*.

## Struktur proyek

Lihat `docs/SPEC.md` untuk model data, aturan bisnis (tagihan, DP/lunas, deposit, hunian) dan kontrak modul.

## Lisensi

Pribadi / internal.
