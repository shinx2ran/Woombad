# Panduan demo: "KSM Pemilik" (contoh tampilan aplikasi kontraktor kebun sawit)

Tujuan demo ini satu: **tahu apakah Bapak tertarik atau tidak.** Kalau ya, lanjut ke uji coba kecil. Kalau tidak, berhenti,
dan tidak ada yang rugi selain satu sore.

Yang didemokan adalah **contoh tampilan (mockup)**, bukan aplikasi jadi. Semua nama perusahaan, kebun, orang, nomor part,
dan angka adalah fiktif. Tidak ada data yang dikirim ke mana pun. Setiap layar menampilkan strip "Contoh tampilan · data
fiktif", dan setiap fitur AI ditandai "Contoh fitur AI".

## 1. Tiga hal yang ingin dibuktikan

| Klaim | Di mana terlihat di mockup |
|---|---|
| Pemilik bisa lihat progres kerja dan uang dari HP, sudah diolah, bukan tabel mentah | Beranda (3 ubin: belum ditagih, lewat jatuh tempo, unit berhenti; kartu "Semua proyek sekilas": realisasi vs rencana semua SPK dalam satu pandangan), Proyek ("Jadwal & progres"), Uang |
| Setiap angka ada jejaknya: siapa yang mengisi, kapan, dari HP mana, dengan foto apa | Ketuk angka bergaris putus (72%, 420 m3, Rp 1,86 M, 28,6 L/jam, Rp 205 jt) → "Jejak angka"; tab Jejak |
| Barang bisa ditelusuri: PO → terima gudang → keluar ke mekanik → terpasang di unit mana, dengan nomor seri | Alat → unit EX-08 → "Sparepart terpasang" → rantai barang; Gudang → "Keluar gudang 7 hari" |

## 2. Persiapan (15 menit, sehari sebelumnya)

1. **Ganti nama pemilik.** Di `index.html`, cari `"owner_name": "Pak Rahmat"` dan `"owner_initial": "R"` (blok `DATA.meta`).
   Nama ini dipakai di layar sambutan, toast persetujuan, rantai barang, dan jejak aktivitas.
2. **Buka dari HP, bukan laptop.** Pakai alamat web (GitHub Pages atau hosting statis lain), lalu "Tambahkan ke layar utama"
   supaya ikon "KSM Pemilik" muncul seperti aplikasi. Tautan Artifact claude.ai juga bisa, tetapi tidak bisa dipasang di layar
   utama dan tidak bisa dibuka tanpa sinyal.
3. **Latihan 3 kali**, termasuk menekan "Reset data demo" (avatar kanan atas → paling bawah) supaya PO kembali "menunggu",
   mandor kembali 3/4, dan Batu Tilam kembali 91%.
4. **Baca semua tulisan bersama istri atau admin senior** sebelum demo: istilah di kantor Bapak mungkin berbeda (BAPP vs BA
   Opname, termin vs progress billing, HM vs jam alat). Yang salah istilah akan dianggap "bukan dunia saya".
5. Matikan notifikasi HP presenter. Layar terang, huruf HP ukuran normal atau besar.

## 3. Alur 10 menit (urutan ketukan dan kalimat)

Prinsip: **serahkan HP-nya ke Bapak**, biarkan beliau yang mengetuk. Diam lebih sering daripada bicara.

| Menit | Ketukan | Kalimat yang diucapkan |
|---|---|---|
| 0:00 | Buka ikon. Layar sambutan "Selamat pagi, Pak …". | "Pak, ini bukan aplikasi jadi. Ini contoh tampilan kalau rekap admin dibaca dari HP. Semua angkanya fiktif. Coba Bapak pegang." Diam 10 detik. |
| 0:30 | Beranda. Tunjuk 3 ubin: Rp 1,46 M · Rp 205 jt · 1 unit berhenti. Lalu kartu "Semua proyek sekilas": 63% dari Rp 5,47 M, rencana 62%, satu bar per proyek, Batu Tilam merah. | "Ini semua pekerjaan Bapak dalam satu pandangan: isi hijau yang sudah terpasang, tanda tegak rencananya hari ini. Yang merah itu yang di belakang." |
| 0:50 | Minta beliau membaca kartu kuning "Ringkasan pagi ini". | "Tidak ada yang mengetik ini, Pak. Dirangkum dari laporan mandor dan admin kemarin." Tunjuk chip "Contoh fitur AI". |
| 1:00 | Ketuk "Rp 1,86 M" → Rp 1.862.450.000 → "Dari mana angka ini?" → rekonsiliasi Sari 06:30. Tutup. | "Angkanya dari input admin yang sama seperti sekarang, hanya tidak di spreadsheet." |
| 1:30 | Kartu "Perlu keputusan Bapak (3)". Ketuk "Setujui" pada PO final drive. Tunjuk harga terakhir +6,7%, produksi hilang Rp 3,2 jt/hari, rantai Budi → Dedi → Bapak. **Minta beliau sendiri yang mengetuk Setujui.** | "Mulai detik ini semua orang di kantor tahu Bapak sudah setuju, jam berapa, dari mana." (Lonceng 3 → 2.) |
| 2:30 | Tab Proyek: kartu "Jadwal & progres" (batang masa kontrak, garis putus hari ini). Ketuk Bukit Tiga di kartu sekilas. | "Mana yang bakal selesai duluan, mana yang lewat tanggal, kelihatan tanpa buka satu-satu." |
| 3:00 | Detail Bukit Tiga: tiga bar 72 / 50 / 25 dan kalimat "Rp 539 juta sudah dikerjakan, belum ditagih". | "Sekarang, berapa lama Bapak tahu angka ini dari spreadsheet?" |
| 3:30 | Ketuk "72%" → Jejak angka: Pak Ujang 16:42, GPS, 3 foto, diperiksa Wati, riwayat 240 → 420 "salah ketik". Geser ke "Spreadsheet", lalu kembali. Tutup. | "Angka boleh dikoreksi, tapi tidak bisa diubah diam-diam. Ini soal alatnya, bukan orangnya." |
| 4:15 | Gulir ke "Termin & BAPP". Ketuk T1 → PPN, potongan PPh, diterima bersih Rp 669.156.250. Tutup. Tunjuk "Termin 3 diperkirakan 5 Nov". | "Yang biasanya Bapak hitung di kepala, sekarang ada di sini." |
| 4:45 | Ketuk kartu "Laporan harian terakhir" → baris "tersimpan 16:42 tanpa sinyal, terkirim 18:05". Ketuk "Lihat sisi mandor". | — |
| 5:00 | Sisi mandor Pak Toni: form tombol besar, foto berstempel GPS, "menunggu sinyal (1)". Ketuk chip "Sinyal: Tidak ada" → "Ada" → "Terkirim 08:16". Kembali ke Beranda: 3/4 → 4/4, Batu Tilam 91% → 93,5%. Diam 3 detik. | "Di kebun sering tidak ada sinyal. Mandor tetap isi; laporannya sampai ke HP Bapak begitu dapat sinyal, bukan besok setelah admin ketik ulang." |
| 6:00 | Tab Proyek → "Tagihan". Baca dari atas: Rp 205 jt lewat 9 hari (Bu Lina), Bukit Tiga T2 jatuh tempo 16 Nov, Batu Tilam T2 "5 hari di meja Pak Yusuf". Ketuk "Ingatkan Wati (WA)" → pesan terisi → Tutup. Tunjuk footer "rata-rata 41 hari, tahap paling lama TTD Kebun". | "Ini uang Bapak dan di meja siapa dia berhenti. Bapak tidak perlu tanya Wati sudah sampai mana." |
| 7:00 | Tab Uang: masuk 1,14 M, keluar 1,09 M, grafik 6 bulan, "Kewajiban 30 hari" dan "kas cukup ±3,5 bulan", piutang merah, solar 46%. Ketuk tombol ungu "Tanya" → "Berapa solar EX-07 bulan ini?" → jawaban → "Lihat unit EX-07". | "Ini contoh; AI-nya belum ada. Yang nyata dulu adalah datanya tercatat rapi; AI tinggal membaca." |
| 7:45 | EX-07: grafik 14 hari, bar merah. Kembali ke daftar Alat: EX-08 paling atas sudah "PO disetujui Bapak 08:14". Ketuk EX-08 → "Sparepart terpasang" → Final drive S/N FD-2026-04417. | — |
| 8:15 | Rantai barang: Budi → Dedi (3 penawaran) → **nama Bapak dan jam tadi** → Rina → Budi → terpasang → part lama kembali. Buka "Aki N150": simpul merah "belum tercatat terpasang, posisi terakhir Budi". Ketuk "Tanya Budi (WA)". | "Barang Rp 68 juta ini tidak bisa hilang di tengah jalan; tiap langkah orangnya beda. Dan yang Rp 6,4 juta ini: di spreadsheet tidak pernah kelihatan." |
| 9:00 | Tab Jejak: baris pertama "Pak … menyetujui PO 08:14", baris Wati MENGUBAH 240 → 420, Pak Samsul terlambat. Tunjuk footer "Dihapus: 0 · Koreksi: 12". Ketuk ikon bulan (tema gelap), ketuk lagi. | "Bapak tidak perlu curiga ke semua orang; yang perlu dilihat kelihatan sendiri, dan admin juga terlindungi karena jejaknya jelas." |
| 9:30 | Ketuk avatar → "Tentang contoh ini": kartu "Data Bapak di mana?" dan "Kalau Bapak tertarik: 1 SPK · 1 mandor · 1 admin · 2 minggu · spreadsheet tetap jalan". Serahkan HP, berhenti bicara 20 detik. | "Ini contoh, data palsu, belum ada yang jalan. Membuatnya butuh berbulan-bulan, dan admin tetap yang mengisi, hanya pindah dari spreadsheet ke HP. Kalau Bapak mau, kita mulai dari laporan harian satu SPK selama dua minggu. Kalau tidak, kita berhenti di sini. Bapak mau?" |

Kalau waktunya cuma 3 menit: Beranda → Setujui PO → Bukit Tiga 72% → Jejak angka → Rantai barang (nama Bapak muncul) → pertanyaan penutup.

## 4. Jawaban siap pakai

| Pertanyaan / keberatan | Jawaban |
|---|---|
| "Bisa ke Excel?" | "Bisa. Tombol 'Ekspor ke Excel' ada di Proyek dan Uang. Data tetap milik perusahaan, bukan terkunci di aplikasi." |
| "Berapa biayanya?" | "Server dan hosting hampir gratis (paket gratis Supabase/GitHub, naik ke ±Rp 450 ribu/bulan kalau sudah besar). Yang mahal adalah waktu membuatnya: berbulan-bulan. Karena itu saya tanya dulu Bapak mau atau tidak." |
| "Mandor saya tidak bisa pakai HP." | Tunjuk form sisi mandor: tombol besar, foto, tanpa mengetik banyak. "Kalau tetap tidak bisa, admin yang input dari foto WA mandor, dan tercatat atas nama admin. Tidak ada yang dipaksa hari pertama." |
| "Data saya di mana? Aman?" | "Di database milik perusahaan (bukan di HP siapa pun), dicadangkan tiap malam, hanya akun Bapak dan admin yang ditunjuk yang bisa buka. Bisa diekspor kapan saja." |
| "Di kebun tidak ada sinyal." | "Laporan tersimpan di HP dan terkirim sendiri saat dapat sinyal. Tadi kita lihat contohnya." |
| "Admin saya nanti merasa diawasi." | "Jejak ini melindungi mereka juga: kalau ada angka salah, yang kelihatan adalah siapa yang mengoreksi dan alasannya, bukan tuduhan. Tidak ada yang bisa dihapus, termasuk oleh Bapak." |
| "Rekap mingguan yang biasa di-print masih ada?" | "Ada, tombol 'Rekap mingguan PDF' di Proyek. Kebiasaan Bapak tidak perlu berubah hari pertama." |
| "Ini sudah bisa dipakai?" | "Belum. Ini contoh tampilan. Yang sudah ada: gambaran dan alur. Yang belum: login, sinkronisasi sungguhan, cetak BAPP, penggajian, pajak." |

## 5. Tanda tertarik atau tidak

Tertarik (lanjut):
- Beliau bertanya tentang **datanya sendiri**: "kalau SPK saya yang di Afd. II bagaimana?", "mandor saya si X bisa?", "harga satuan saya beda".
- Beliau mencoba mengetuk sendiri tanpa diminta, atau membuka tab yang tidak ada di alur.
- Beliau menyebut satu masalah nyata yang ingin dibereskan dulu (biasanya: tagihan lama cair, solar boros, atau sparepart hilang).
- Beliau mau menunjuk satu admin dan satu mandor untuk uji coba 2 minggu, dan bersedia berkata "mulai bulan depan saya hanya lihat laporan dari aplikasi".

Tidak tertarik (berhenti, tanpa memaksa):
- "Bagus, nanti ya." tanpa pertanyaan lanjutan.
- Semua pertanyaan tentang biaya, bukan tentang pekerjaan.
- Beliau menyerahkan HP kembali dalam 1 menit.
- Beliau ingin admin yang memutuskan.

Satu pertanyaan penutup yang paling jujur: **"Kalau ini jalan, laporan mana yang Bapak mau berhenti terima lewat WhatsApp/print?"**
Kalau jawabannya "tidak ada", belum waktunya.

## 6. Jujur: apakah harus bikin aplikasi sendiri?

Belum tentu. Mockup ini menunjukkan tampilan yang ideal, tetapi sebagian besar nilainya bisa didapat dengan alat yang sudah
ada. Perkiraan biaya di bawah adalah **gambaran kasar dari halaman harga publik (Okt 2026)**, bukan penawaran.

| Pilihan | Cocok untuk | Tidak cocok untuk | Perkiraan biaya/bulan |
|---|---|---|---|
| **Looker Studio** di atas Google Sheets yang sudah ada | "Saya mau lihat laporan di HP" tanpa mengubah kebiasaan admin | jejak input, nomor seri, offline, persetujuan | Rp 0 (spreadsheet harus dirapikan dulu: itu pekerjaan sebenarnya) |
| **AppSheet** (Google) di atas spreadsheet | form lapangan dengan foto/GPS/barcode, offline, siapa-kapan per baris; jadi dalam hitungan hari | tampilan pemilik yang diolah, integritas data (nomor seri ganda), banyak pengguna lapangan (bayar per orang) | ±Rp 180 rb/pengguna; 9 orang ≈ Rp 1,6 jt; gratis ≤10 pengguna untuk uji coba |
| **Accurate Online / Mekari Jurnal** | termin, invoice, piutang per klien, PPN/e-Faktur, laba per proyek | progres fisik, HM alat, solar, sparepart ke unit, offline | ≈ Rp 0,5–1,5 jt |
| **GPS/telematika alat** (TransTRACK, McEasy, Komtrax, dll.) | HM, lokasi, solar per unit tanpa ada yang mengetik | progres, BAPP, pembelian | ≈ Rp 90–270 rb/unit + alat ±Rp 1 jt/unit |
| **Odoo / ERP lokal (HashMicro dll.)** | semua modul dalam satu sistem | 2–3 bulan implementasi, admin harus belajar konsep ERP, tidak offline | Rp 1–9 jt + implementasi puluhan juta |
| **Aplikasi sendiri (Supabase + PWA)**, seperti mockup ini | gabungan yang tidak ada di produk mana pun: progres fisik → status BAPP, nomor seri PO → gudang → mekanik → unit, jejak tak terhapus, bahasa dan istilah sendiri, offline, pengguna lapangan tak terbatas | tidak ada yang bisa pakai sebelum berbulan-bulan; semua perubahan tergantung satu orang (Anda); keamanan dan cadangan jadi tanggung jawab Anda | server ≈ Rp 0–450 rb; biaya sebenarnya = ratusan jam kerja Anda |

Jalan yang masuk akal (bukan "bangun semuanya"):

1. **Pilot 2 minggu dengan alat yang sudah ada** (AppSheet gratis atau form sederhana): 1 SPK, 1 mandor, 1 admin. Laporan harian
   lapangan dengan foto dan GPS masuk ke satu tabel; Bapak melihat ringkasannya di HP. Spreadsheet lama tetap jalan.
   Ini menguji dua hal yang mockup tidak bisa uji: **mandor benar-benar mengisi**, dan **Bapak benar-benar membuka**.
2. Kalau pilot hidup, baru bangun bagian yang tidak ada di produk mana pun: **progres → BAPP/termin** dan **rantai sparepart
   bernomor seri**. Keuangan/pajak tetap di Accurate/Jurnal; HM dan lokasi alat dari GPS tracker; aplikasi sendiri membaca
   keduanya, bukan menggantikan.
3. Jejak audit dan "tidak bisa dihapus" dipasang di database sejak hari pertama (bukan fitur yang ditambah belakangan).

## 7. Risiko yang perlu disebut jujur

| Risiko | Kenapa sering terjadi | Pencegahan |
|---|---|---|
| Admin tetap pakai spreadsheet "yang benar" di samping aplikasi (double entry) | Aplikasi dianggap tambahan, bukan pengganti; manajemen masih menerima rekap lama | Satu laporan lama dihentikan per tahap; Bapak hanya menerima dari aplikasi |
| Mandor tidak mengisi | Form rumit, sinyal, tidak ada manfaat untuk dirinya | Form 6 kolom, foto, offline; premi/upah dihitung dari laporan yang sama |
| Ketergantungan pada satu orang (Anda) | Semua perubahan dan perbaikan lewat Anda | Kode di GitHub, dokumentasi, ekspor Excel kapan saja, data di database standar (PostgreSQL) |
| Istilah tidak cocok | Setiap kebun/grup punya nama dokumen sendiri | Kamus istilah diisi bersama admin sebelum dibangun |
| Migrasi data lama | Spreadsheet per bulan, sel gabungan, kolom beda-beda | Mulai dari SPK yang sedang berjalan; data lama diimpor belakangan, seperlunya |

## 8. Catatan teknis singkat

- Satu berkas `index.html` (±210 KB), tanpa server, tanpa library luar, tanpa koneksi internet. Tema terang/gelap mengikuti HP.
- Data fiktif ada di satu objek `DATA` di dalam berkas; semua angka turunan (persen, belum ditagih, piutang, L/jam, margin)
  dihitung ulang saat halaman dibuka, dan ada pemeriksaan otomatis di konsol browser ("KSM self-check OK").
- `manifest.webmanifest`, `sw.js`, dan ikon membuat versi yang di-hosting bisa dipasang di layar utama dan dibuka tanpa sinyal.
- Uji otomatis (Playwright) berjalan di `e2e/kontraktor-mockup.spec.ts` dan menjalankan seluruh alur demo di atas.
- Yang sengaja tidak ada: login, sinkronisasi sungguhan, AI sungguhan (jawaban "Tanya data" disiapkan untuk 4 pertanyaan),
  cetak PDF, peta, penggajian, pajak.
