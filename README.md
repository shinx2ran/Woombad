# Woombad — Aplikasi Manajemen Kos (gratis, online, Android & iPhone)

Woombad adalah aplikasi web progresif (PWA) untuk mengelola satu atau banyak kos:

- **Penyewa**: data lengkap, **scan KTP / paspor** untuk mengisi otomatis (NIK, nama, TTL, alamat, …) — nomor HP diisi
  manual karena KTP tidak memuat nomor telepon.
- **Sewa & tagihan**: harian / mingguan / bulanan, tanggal mulai–selesai, harga per kamar (bisa dinegosiasi), uang
  jaminan, add-on (kasur tambahan, parkir, laundry…), **DP / lunas** otomatis dari pembayaran, perpanjangan satu klik.
- **Pengeluaran**: gaji, perbaikan, listrik/air/internet, perlengkapan, pajak, dll. Per kos atau bersama.
- **Laporan**: harian / mingguan / bulanan / tahunan, laba-rugi, tingkat hunian, piutang, grafik, dan **ekspor
  XLSX/CSV**.
- **Online & multi-perangkat**: login email + kata sandi, data di Supabase (gratis), bisa dibuka dari Android,
  iPhone, atau laptop. Anggota baru bergabung dengan **kode undangan**. Bisa di-"install" ke layar utama seperti
  aplikasi biasa.

> Tanpa konfigurasi Supabase aplikasi berjalan dalam **Mode Demo** (data hanya di browser ini) supaya bisa dicoba dulu.

## Biaya

| Komponen | Layanan | Biaya |
|---|---|---|
| Database, login, penyimpanan foto | Supabase Free | Rp 0 (500 MB DB, 1 GB storage, 50.000 pengguna aktif/bulan) |
| Hosting web (PWA) | GitHub Pages (atau Cloudflare Pages / Vercel / Netlify) | Rp 0 |
| Scan KTP | tesseract.js di browser | Rp 0 (tanpa API) |

Catatan jujur: paket gratis Supabase **tidak membuat cadangan otomatis**, dan proyek **dijeda bila sepekan terlalu
sedikit permintaan ke database**. Untuk itu GitHub Actions memanggil database 3× sehari secara otomatis
(`.github/workflows/keepalive.yml`). Lihat [Perawatan rutin](#perawatan-rutin).

## Menjalankan secara lokal

```bash
npm install
npm run dev        # http://localhost:5173  (Mode Demo bila .env tidak ada / kosong)
npm test           # unit test logika bisnis
npm run typecheck
npm run build      # hasil di dist/ — memakai .env.production (mode online) bila berkas itu ada
node scripts/check-public-config.mjs   # memastikan .env.production tidak memuat kunci rahasia
```

Build Mode Demo walaupun `.env.production` ada: `VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npm run build`
(variabel kosong di terminal mengalahkan isi berkas `.env`). Uji Playwright (`npm run e2e`) memakai Mode Demo, jadi
jalankan build seperti ini dulu.

## Alamat aplikasi (sudah otomatis)

Setiap perubahan di cabang `master` otomatis dibangun dan dipublikasikan oleh GitHub Actions ke
**https://shinx2ran.github.io/Woombad/** (gratis, tanpa akun tambahan). Selama `.env.production` belum ada, alamat ini
berjalan dalam Mode Demo; setelah [peluncuran online](#peluncuran-online) alamat yang sama menjadi mode online.
Untuk hosting lain (Cloudflare Pages, Netlify, Vercel) cukup hubungkan repo ini; konfigurasi fallback SPA sudah
disertakan (`public/_redirects`, `vercel.json`).

## Peluncuran online

Mode online menyimpan data di Supabase, sehingga pemilik dan istri melihat data yang sama dari HP masing-masing.
Kerjakan berurutan, sekali saja:

| # | Siapa | Apa |
|---|---|---|
| 1 | Pemilik | Simpan data Mode Demo (bila ada) |
| 2 | Operator (Claude) | Siapkan Supabase dan nyalakan mode online |
| 3 | Pemilik | Atur login di Supabase |
| 4 | Pemilik | Buat akun pemilik dengan **kode pemilik** |
| 5 | Pemilik | Impor data Mode Demo |
| 6 | Pemilik + istri | Undang istri, istri bergabung |
| 7 | Pemilik | Aktifkan verifikasi dua langkah (2FA) |

### 1. Pemilik: simpan data Mode Demo

Setelah mode online menyala, alamat aplikasi **tidak lagi membuka Mode Demo**. Jadi unduh dulu datanya:

1. Di HP yang berisi data demo, buka aplikasi → **Pengaturan → Data → Unduh cadangan JSON**.
2. Simpan berkasnya di tempat aman (mis. kirim ke WhatsApp sendiri atau ke Google Drive).

Lewati langkah ini bila isinya hanya data contoh.

### 2. Operator (Claude): siapkan Supabase

1. **Proyek**: buat proyek Supabase baru (paket Free) di region **Southeast Asia (Singapore)**. Simpan kata sandi
   database di pengelola sandi; aplikasi tidak memakainya.
2. **Skema**: **SQL Editor** → tempel seluruh isi `supabase/schema.sql` → **Run**. Berkas ini sudah lengkap (tidak
   perlu `supabase/migrations/`) dan aman dijalankan ulang. Bila `schema.sql` berubah (mis. fitur **Ubah tanggal mulai**, atau
   **Daftar tunggu** dan penjaga pesanan dobel),
   jalankan ulang di SQL Editor **sebelum** perubahan aplikasi di-push ke `master`.
3. **Kode pemilik**: jalankan `node scripts/new-setup-code.mjs`, lalu jalankan baris
   `select public.set_setup_code('ABCD-EFGH');` yang dicetaknya di SQL Editor. Berikan kodenya kepada pemilik secara
   pribadi. Kode ini sekali pakai; bila hilang sebelum dipakai, buat kode baru dengan cara yang sama.
4. **Konfigurasi publik**: buat berkas `.env.production` di akar repo dengan **Project URL** (Project Settings →
   Data API) dan **Publishable key** `sb_publishable_…` (Project Settings → API Keys). Jangan pakai *anon key* lama;
   pemeriksaan build menolaknya karena kunci itu berhenti bekerja bila kunci lama dimatikan (lihat
   [Mana yang rahasia?](#mana-yang-rahasia)).

   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_...
   ```

   Jalankan `node scripts/check-public-config.mjs`, lalu commit ke `master` (setelah pemilik selesai langkah 1).
   Dalam ±2 menit GitHub Actions memublikasikan versi online. Secret GitHub `VITE_SUPABASE_URL` /
   `VITE_SUPABASE_ANON_KEY` tidak diperlukan; bila diisi, nilainya menggantikan `.env.production`.

### 3. Pemilik: atur login di Supabase

Buka dashboard Supabase → proyek Woombad → **Authentication**:

| Menu | Isian |
|---|---|
| Sign In / Providers → **Confirm email** | **Matikan** (OFF), lalu **Save** |
| Sign In / Providers → Email → *Minimum password length* | **8** |
| URL Configuration → **Site URL** | `https://shinx2ran.github.io/Woombad/` |
| URL Configuration → **Redirect URLs** → *Add URL* | `https://shinx2ran.github.io/Woombad/reset-sandi` |

*Confirm email* dimatikan karena akun baru tetap tidak bisa melihat apa pun tanpa kode. *Redirect URL* dipakai saat
**Lupa kata sandi?**. Email bawaan Supabase hanya terkirim ke email akun Supabase Anda, jadi tautan reset hanya sampai
ke pemilik (lihat [Lupa kata sandi](#lupa-kata-sandi)).

### 4. Pemilik: buat akun pemilik

1. Buka **https://shinx2ran.github.io/Woombad/** → **Buat akun** → isi **email yang sama dengan akun Supabase**
   (supaya **Lupa kata sandi?** bisa dipakai) dan kata sandi minimal 8 karakter → **Daftar**.
2. Muncul layar **Masukkan kode** → ketik **kode pemilik** dari operator → **Gabung**.
3. Organisasi "Kos Saya" dibuat dan Anda menjadi **Pemilik**.

Masih tampil Mode Demo? Tutup aplikasi sepenuhnya, lalu buka lagi (aplikasi memperbarui diri sendiri). Bila muncul
**Versi baru siap**, selesaikan isian yang sedang diketik, lalu ketuk **Muat ulang**.

### 5. Pemilik: impor data Mode Demo

Lakukan sebelum mengisi data baru:

1. **Pengaturan → Data → Impor dari Mode Demo** → pilih berkas dari langkah 1 (atau, di HP/tablet yang dulu dipakai
   untuk Mode Demo, **Pakai data Mode Demo di perangkat ini**).
2. Pilih kos yang mau diimpor (dan pengeluaran Bersama bila perlu) → **Impor**.
3. Periksa ringkasan jumlah data. Foto KTP/struk tidak ikut; unggah ulang bila perlu.

### 6. Pemilik + istri: undang istri

1. Pemilik: **Pengaturan → Anggota → Undang** → isi *Untuk siapa* (mis. "Istri") → pilih **Admin – akses penuh** →
   **Buat kode** → **Kirim lewat WhatsApp**. Kode berlaku 7 hari, hanya untuk satu orang, dan hanya ditampilkan sekali.
2. Istri: buka tautan itu → **Buat akun** → isi email dan kata sandi sendiri → **Daftar** → otomatis bergabung ke kos
   yang sama (kode sudah terisi; ketuk **Gabung** bila diminta). Bila kodenya kosong, ketik kode dari pesan WhatsApp.
   Sempat muncul Mode Demo atau "halaman tidak ditemukan"? Tunggu beberapa detik; aplikasi memperbarui diri.
3. Istri: pasang aplikasi ke layar utama (lihat [Install ke HP](#install-ke-hp)) dan masuk dengan akun yang sama.

Pegawai/penjaga kos diundang dengan cara yang sama, dengan peran **Staf**.

### 7. Pemilik: aktifkan 2FA

Siapa pun yang menguasai akun GitHub atau Supabase menguasai aplikasi dan seluruh data. Aktifkan verifikasi dua
langkah (aplikasi authenticator) di keduanya:

- **GitHub**: foto profil → **Settings → Password and authentication → Two-factor authentication**.
- **Supabase**: foto profil → pengaturan akun → **Security** → tambahkan *authenticator app*.

### Peran anggota

| Peran | Untuk | Boleh |
|---|---|---|
| **Pemilik** | Bapak (akun pertama) | Semua, termasuk mengubah peran anggota dan menghapus admin. |
| **Admin** | Istri | Semua data: kos & rekening, kamar & harga, sewa, pembayaran, pengeluaran, Laporan, undang anggota, cadangan, Riwayat perubahan. Tidak bisa mengubah peran anggota atau menghapus admin lain. |
| **Staf** | Pegawai / penjaga kos | Tambah/ubah penyewa, sewa baru, pesan kamar & kelola daftar tunggu, perpanjangan, tagihan, catat pembayaran & pengeluaran. **Tidak bisa** mengubah harga kamar/sewa, tanggal mulai sewa, data kos & rekening, daftar add-on, atau pembayaran/pengeluaran yang sudah dicatat. Menu **Laporan** tidak ditampilkan. |

Batasan ubah/hapus dijaga oleh database, bukan hanya oleh tampilan aplikasi. Staf tetap bisa **melihat** angka
pembayaran dan pengeluaran (mis. grafik di Dashboard); menu Laporan hanya disembunyikan.

### Mana yang rahasia?

| Hal | Rahasia? | Keterangan |
|---|---|---|
| Project URL + *Publishable key* (`sb_publishable_…`) | Tidak | Memang publik: ikut di dalam aplikasi dan di `.env.production`. Data tetap aman karena dilindungi Row Level Security — hanya anggota yang bisa membaca data kosnya. |
| *Secret key* (`sb_secret_…`) atau *service_role key* lama | **Ya, sangat** | Membuka semua data tanpa batas. Jangan pernah dikirim (WhatsApp, email), ditempel di aplikasi, atau di-commit ke GitHub. Build otomatis gagal bila kunci ini ada di `.env.production`. Bila bocor: lihat di bawah. |
| Kata sandi database | Ya | Tidak dipakai aplikasi; simpan di pengelola sandi. |
| Kode pemilik | Ya, sampai dipakai | Sekali pakai. |
| Kode undangan | Ya | Hanya untuk orang yang dituju. Sekali pakai, berlaku 7 hari. Salah kirim? Tekan **Batalkan** di **Pengaturan → Anggota → Undangan menunggu**. |

**Bila kunci rahasia bocor**: buka Supabase → Project Settings → **API Keys**. Membuat kunci baru saja **tidak**
mematikan kunci yang bocor.

| Kunci yang bocor | Yang dilakukan |
|---|---|
| *Secret key* (`sb_secret_…`) | Buat *secret key* baru, lalu **hapus** kunci yang bocor. |
| *service_role key* lama | Tab **Legacy API Keys** → **matikan** (*disable*) kunci lama. Kunci lama tidak bisa dihapus satu per satu; *anon key* lama ikut mati, tetapi aplikasi tetap jalan karena memakai *publishable key*. |

Keamanan lain: siapa pun bisa membuat akun, tetapi akun itu **tidak melihat apa pun** sampai memasukkan kode yang
benar (10 kali salah dalam 1 jam → diblokir 1 jam). Penghapusan data keuangan (tagihan yang sudah dibayar, sewa yang
punya tagihan) ditolak oleh database; gunakan *Batalkan* / *Checkout*. Setiap perubahan tercatat di **Pengaturan →
Riwayat perubahan** (pemilik/admin) dan tidak bisa dihapus.

### Perawatan rutin

| Kapan | Apa |
|---|---|
| Otomatis, setiap Minggu malam | GitHub Actions **Weekly encrypted backup** menyimpan salinan terenkripsi seluruh data (90 hari). Lihat [Cadangan otomatis](#cadangan-otomatis). |
| Sebulan sekali | **Pengaturan → Data → Unduh cadangan lengkap (JSON)**, simpan sendiri di Google Drive atau laptop. Aplikasi mengingatkan setelah 30 hari. Foto tidak ikut dalam cadangan. |
| Otomatis, 3× sehari | GitHub Actions **Keep database awake** memanggil `keepalive()`, yang memperbarui satu baris penanda (bukan data kos, tidak masuk Riwayat perubahan) agar proyek gratis tidak dijeda. Tidak perlu apa-apa. |
| Bila GitHub mengirim email *"Keep database awake" failed* | Proyek kemungkinan dijeda. Buka dashboard Supabase → proyek Woombad → **Resume project**, tunggu beberapa menit. |
| Bila GitHub mengirim email bahwa jadwal dimatikan | GitHub mematikan jadwal di repo publik setelah 60 hari tanpa commit. Buka repo → **Actions →** *Keep database awake* dan *Weekly encrypted backup* **→ Enable workflow**. |
| Bila GitHub mengirim email *"Weekly encrypted backup" failed* | Biasanya proyek dijeda (lihat baris di atas) atau rahasia `BACKUP_DB_PASSWORD` belum diisi. |
| Bila aplikasi tidak bisa memuat data | Aplikasi menampilkan penyebabnya. Bila proyek dijeda: dashboard Supabase → proyek Woombad → **Resume project**, tunggu beberapa menit. |
| Lupa kata sandi | Lihat [di bawah](#lupa-kata-sandi). |

### Cadangan otomatis

Setiap Minggu pukul 21:07 WIB, GitHub Actions masuk ke database sebagai `woombad_backup`, sebuah akun yang
**hanya** bisa menjalankan `export_backup()` (tidak bisa membaca tabel lain atau mengubah apa pun). Hasilnya dalam format
yang sama dengan *Unduh cadangan lengkap*, dikompres, lalu **dienkripsi** dengan kunci publik `age` pemilik, dan
disimpan sebagai *artifact* selama 90 hari (kira-kira 13 salinan terakhir). Repo ini publik, tetapi tanpa kunci rahasia
pemilik berkas itu tidak bisa dibuka.

| Siapa | Apa |
|---|---|
| Pemilik (sekali) | Simpan **kunci rahasia** `AGE-SECRET-KEY-1…` di dua tempat aman (mis. aplikasi catatan + kertas). Tanpa kunci ini cadangan otomatis tidak bisa dibuka. |
| Pemilik (sekali) | Repo → **Settings → Secrets and variables → Actions → New repository secret**: nama `BACKUP_DB_PASSWORD`, isi kata sandi dari operator. |
| Operator | Kata sandi akun cadangan bisa diganti kapan saja: `alter role woombad_backup password '…';` lalu perbarui rahasianya. |

Memulihkan (operator): buka **Actions → Weekly encrypted backup →** run yang diinginkan → unduh artifact, lalu

```
age -d -i kunci-rahasia.txt woombad-cadangan-YYYY-MM-DD.json.gz.age | gunzip > cadangan.json
```

`cadangan.json` berisi satu cadangan per organisasi (`{ version, exportedAt, orgName, tables }`).

### Lupa kata sandi

Email bawaan Supabase hanya terkirim ke email akun Supabase (pemilik), paling banyak 2 email per jam. Email ke
alamat lain ditolak, jadi istri dan staf **tidak** menerima tautan reset.

| Siapa | Caranya |
|---|---|
| Pemilik (email sama dengan akun Supabase) | Layar **Masuk** → isi email → **Lupa kata sandi?** → buka tautan di email. |
| Istri / staf | Minta kata sandi sementara lewat pemilik. Masuk dengan kata sandi itu, lalu **Pengaturan → Tentang → Ganti kata sandi**. |

Operator membuat kata sandi sementara:

1. Jalankan `node scripts/temp-password.mjs <email orangnya>`.
2. Tempel SQL yang dicetak di **SQL Editor** → **Run**. Harus muncul 1 baris; 0 baris berarti emailnya salah.
3. Kirim kata sandi sementara ke orangnya secara pribadi.

Agar **Lupa kata sandi?** berfungsi untuk semua orang, pasang layanan pengirim email sendiri di **Authentication →
Emails → SMTP Settings**. Untuk beberapa pengguna saja, cara di atas sudah cukup.

## Alur pemakaian sehari-hari

| Kejadian | Yang dilakukan di aplikasi |
|---|---|
| Tamu harian/mingguan mau datang tanggal X | **Dashboard → Cek kamar kosong**: pilih Harian/Mingguan/Bulanan, tanggal check-in dan jumlahnya; kamar yang kosong tampil paling pas dulu, ketuk **Pesan** ([lihat di bawah](#rencana-check-in--daftar-tunggu)). |
| "Belum ada kamar" | Di halaman yang sama ketuk **Masukkan ke daftar tunggu**; **Sewa → Daftar tunggu** menunjukkan kapan ada kamar cocok, lalu **Kabari** lewat WhatsApp dan **Pesan**. |
| Penyewa baru datang | **Sewa → Sewa Baru**: pilih/buat penyewa (bisa **Scan KTP / Paspor**), kos & kamar kosong, periode & harga, deposit, add-on, lalu catat pembayaran pertama (boleh DP). |
| Penyewa membayar | **Dashboard → Bayar** (atau buka sewa → **Catat pembayaran**). Status otomatis **DP / Sebagian** atau **Lunas**. Bisa kirim kwitansi ke WhatsApp. Salah ketik? **✏️ Ubah pembayaran** ([lihat di bawah](#salah-catat-pembayaran-atau-tagihan)). |
| Mendekati jatuh tempo | Dashboard menampilkan **Perlu perhatian** (terlambat / jatuh tempo ≤3 hari). Tombol **Tagih** membuat tagihan periode berikutnya dan memperpanjang sewa; ikon WhatsApp mengirim pengingat berisi nomor rekening. Ikon oranye bertanda **+** berarti nomor HP penyewa belum diisi: ketuk untuk langsung mengisinya. |
| Perpanjang 2 minggu saja | Buka sewa → **Buat tagihan berikutnya** → **Periode khusus** (pro-rata). |
| Bayar listrik / denda | Saat membuat tagihan isi kolom **Listrik / Denda / Lainnya**. |
| Penyewa pindah / keluar | Buka sewa → **Lainnya → Pindah kamar** atau **Checkout** (uang jaminan dikembalikan atau dipotong). |
| Salah input tanggal mulai sewa | Buka sewa → **Lainnya → Ubah tanggal mulai** (pemilik/admin): semua periode tagihan ikut digeser ([lihat di bawah](#salah-input-tanggal-mulai-sewa)). |
| Pengeluaran | **Pengeluaran → Catat**: gaji, listrik/air, perbaikan, dll., per kos atau **Bersama**; ada tombol **Duplikat ke bulan ini** untuk biaya rutin. |
| Lihat kinerja | **Laporan**: harian / mingguan / bulanan / tahunan, laba-rugi, piutang, hunian, grafik, lalu **Unduh XLSX / CSV** atau **Cetak / PDF**. |
| Istri / pegawai ikut mengelola | **Pengaturan → Anggota → Undang**, kirim kodenya lewat WhatsApp (lihat [langkah 6](#6-pemilik--istri-undang-istri)). |
| Akhir minggu | **Pengaturan → Data → Unduh cadangan lengkap (JSON)**. |

### Tanggal di aplikasi = tanggal check-out

Setiap tanggal akhir sewa atau periode (di daftar sewa, dashboard, kamar, tagihan, pesan WhatsApp, riwayat, dan ekspor)
adalah **tanggal check-out**, yaitu hari penyewa keluar, bukan malam terakhir menginap: sewa 2 malam mulai 15 Okt tampil
**15 Okt – 17 Okt**, 1 minggu **15 Okt – 22 Okt**, 1 bulan **15 Okt – 15 Nov**, dan periode berikutnya mulai di tanggal
check-out itu. "Dibayar s/d 15 Nov" berarti lunas sampai hari check-out 15 Nov. Saat mengetik tanggal akhir sewa, isi juga
tanggal check-out. Pesanan yang dibatalkan sebelum penyewa menginap (tanggal pembatalan paling lambat sehari setelah mulai)
hanya menampilkan tanggal mulainya, "belum menginap"; bila penyewa sudah menginap, gunakan **Checkout**.

### Tombol cepat (fitur percobaan)

**Pengaturan → Fitur percobaan → Tombol cepat** menampilkan **Papan kamar** di Dashboard: setiap kamar berwarna — **merah
"Telat"** bila sudah lewat jatuh tempo, **jingga-merah "Hari ini"** bila jatuh tempo hari ini, **oranye "3 hari"** bila jatuh tempo dalam 7 hari (sisa hari sampai harus
bayar/perpanjang), biru "Terisi" bila masih aman, hijau "Kosong". Ketuk kamar merah atau oranye untuk **Kirim pengingat WhatsApp** (pesan tagihan sudah terisi, tinggal tekan kirim). Ketuk kamar
terisi untuk **Bayar**, **Perpanjang**, atau **Check-out** (membuka dialog
yang sama seperti di halaman sewa). Ketuk kamar kosong untuk **Check-in cepat** tamu harian: isi nama, jumlah malam, dan total
bayar; nomor HP boleh diisi nanti. Saklar ini hanya berlaku di HP/tablet tempat ia dinyalakan dan bisa dimatikan kapan saja. Di
Mode Demo papan selalu tampil, untuk dicoba dengan data contoh.

### Rencana check-in & daftar tunggu

**Cek kamar kosong** (Dashboard, atau **Sewa → Cek kamar**, atau **Pesan tanggal lain** di papan kamar) mencari kamar yang kosong
untuk **seluruh** malam yang diminta, untuk tamu harian, mingguan atau bulanan, di kos yang sedang dipilih. Yang paling pas tampil
paling atas (mis. "Pas sebelum pesanan 12 Nov"), dengan harga untuk seluruh menginap dan strip 14 hari (hijau kosong, biru terisi,
ungu dipesan, kuning hari check-out). Kamar yang hanya kosong sebagian tampil di **Hampir cocok** dengan alasannya ("Kosong 5–9 Nov,
lalu dipesan Budi"). Kamar penyewa bulanan tidak pernah ditawarkan sampai checkout-nya dicatat. **Pesan**: isi nama (penyewa lama
dikenali supaya tidak dobel), HP boleh nanti, total, DP bila ada; kamar langsung tampil **Dipesan**. Dua HP yang memesan kamar yang
sama pada saat bersamaan tidak bisa dobel: yang kedua ditolak dengan nama pesanan yang lebih dulu. Tamu tidak jadi datang? Buka
sewanya → **Lainnya → Batalkan sewa**. Bila tidak ada kamar, masukkan tamu ke **Daftar tunggu** (Sewa → Daftar tunggu, atau kartu
di Dashboard): setiap entri menunjukkan kamar yang cocok saat ini, tombol **Kabari** membuka WhatsApp dengan pesan berisi kamar,
tanggal, dan harga, dan **Pesan** langsung memesankan kamarnya. Staf boleh mengelola daftar tunggu; menghapus hanya pemilik/admin.

### Salah catat pembayaran atau tagihan?

Buka sewa → daftar **Pembayaran** → tombol **✏️ Ubah pembayaran** untuk membetulkan **jumlah, tanggal, metode, atau catatan**;
status tagihan (DP / Sebagian / Lunas) ikut menyesuaikan. Jumlahnya tidak bisa melebihi sisa tagihan. Salah tagihan? Hapus
pembayarannya lalu catat ulang lewat **Bayar** pada tagihan yang benar. Harga sewa yang salah ketik di satu tagihan dibetulkan
lewat menu tagihan → **Ubah** → **Harga sewa (tagihan ini)** (tagihan berikutnya tetap memakai harga sewa di kontrak). Di bawah
kedua dialog ada **Riwayat perubahan**: siapa yang membuat/mengubah, kapan, dan apa yang berubah. Hanya pemilik/admin yang bisa
mengubah dan melihat riwayat; riwayat hanya tercatat di Mode Online.

### Salah input tanggal mulai sewa?

Ketahuan berbulan-bulan kemudian bahwa tanggal mulai sewa salah ketik (mis. 1 Sep, padahal penyewa masuk 18 Agt)? Buka sewa →
**Lainnya → Ubah tanggal mulai**, isi tanggal yang benar, lalu periksa **pratinjaunya** sebelum menyimpan: setiap tagihan
(periode lama → baru, jatuh tempo, jumlah malam), tanggal check-out sewa, **Dibayar s/d**, tagihan berikutnya, dan keadaan penyewa
hari ini setelah diubah (mis. "Setelah diubah: telat 14 hari"). Jumlah tagihan, nomor tagihan, status bayar, pembayaran, add-on,
dan uang jaminan **tidak berubah**; tagihan berikutnya (**Tagih**) langsung mengikuti tanggal yang baru. Bila ada tagihan dengan
periode khusus (pro-rata, ganti jenis sewa), semua tanggal digeser dengan jumlah hari yang sama dan aplikasi memberi tahu. Tanggal
yang bentrok dengan penyewa lain di kamar yang sama ditolak (nama dan tanggalnya disebutkan); penyewa yang sudah pernah
**Pindah kamar** tetap bisa dikoreksi (penghuni lama kamar barunya tidak dihitung bentrok). Satu baris catatan otomatis
ditambahkan ke catatan sewa ("Tanggal mulai dikoreksi dari … ke … (tanggal hari ini)", plus **Alasan** bila diisi), dan di Mode
Online setiap perubahan tercatat di **Riwayat perubahan** tagihan. Hanya pemilik/admin, dan hanya untuk sewa yang masih aktif
(termasuk pesanan yang belum mulai); sewa yang sudah selesai atau dibatalkan tidak bisa diubah tanggal mulainya.

### Kirim tagihan ke WhatsApp & logo kos

- **Kirim tagihan** (menu ⋯ pada baris sewa, menu tagihan di detail sewa, atau langsung setelah **Buat tagihan berikutnya**)
  membuat **gambar tagihan** berlogo kos: rincian sewa, add-on, listrik/denda, total, yang sudah dibayar, sisa, dan info rekening.
  Tekan **Bagikan ke WhatsApp**, pilih WhatsApp lalu nama penyewa di lembar bagikan HP (Android: Chrome / aplikasi terpasang;
  iPhone: Safari). Di komputer gunakan **Unduh gambar** lalu lampirkan sendiri, atau **Kirim teks saja via WhatsApp**.
- Catatan tagihan **tidak** ikut di gambar kecuali Anda mencentang **Sertakan catatan tagihan di gambar** (catatan bisa berisi
  keterangan internal seperti "Sisa dianggap hangus").
- **Logo kos**: **Kos → Ubah kos → Logo kos → Pilih logo** (PNG transparan paling bagus; hanya tersimpan di mode online).
  Logo tampil di gambar tagihan dan di halaman kos.

## Menguji skema database secara lokal (opsional)

`supabase/tests/run.sh` memasang `schema.sql` ke PostgreSQL lokal dengan tiruan objek Supabase dan menjalankan
pengujian fungsional (pendaftaran, kode undangan, RLS, pembatasan staf, trigger tagihan, penjaga pesanan dobel, daftar tunggu).
Lihat komentar di dalam skrip.

## Install ke HP

- **Android (Chrome)**: buka alamat aplikasi → menu ⋮ → *Tambahkan ke layar utama* / *Install app*.
- **iPhone (Safari)**: buka alamat aplikasi di **Safari** → tombol *Bagikan* → *Tambahkan ke Layar Utama*.

## Struktur proyek

Lihat `docs/SPEC.md` untuk model data, aturan bisnis (tagihan, DP/lunas, deposit, hunian) dan kontrak modul.
Bagian 6 berisi kontrak peluncuran online (kode undangan, pembatasan staf, riwayat perubahan, cadangan).

## Lisensi

Pribadi / internal.
