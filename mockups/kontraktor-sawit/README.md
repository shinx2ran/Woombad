# Mockup: LBS Manajemen (aplikasi manajemen kontraktor kebun sawit)

Contoh tampilan (mockup) untuk mengukur minat manajemen perusahaan kontraktor perkebunan sawit sebelum aplikasi sungguhan
dibangun. Nama perusahaan klien sungguhan (dipakai sebagai contoh); orang, SPK, angka, dan foto fiktif. Tidak berhubungan dengan aplikasi Woombad di folder utama; hanya menumpang repositori.

**Alamat publik (tanpa login):** https://shinx2ran.github.io/lbs-mockup/ (repositori `shinx2ran/lbs-mockup`, GitHub Pages dari
branch `main`). Isinya salinan folder ini. Setelah mengubah mockup di sini, salin `index.html`, `manifest.webmanifest`,
`sw.js`, dan ikon ke repositori itu lalu push ke `main`; halaman diperbarui dalam ±1 menit. Naikkan nama `CACHE` di
`sw.js` bila ikon atau manifest berubah, supaya HP yang sudah memasang ikutan memperbarui.

- `index.html` — seluruh mockup dalam satu berkas (HTML + CSS + JS, tanpa library). Buka langsung di browser, atau hosting
  statis apa pun; di HP: "Tambahkan ke layar utama".
- `PANDUAN-DEMO.md` — alur demo 10 menit, jawaban atas keberatan, tanda tertarik/tidak, perbandingan jujur dengan alat lain.
- `manifest.webmanifest`, `sw.js`, `icon-*.png` — agar versi yang di-hosting bisa dipasang dan dibuka tanpa sinyal.

Aplikasi menyapa "Selamat pagi, Manajemen LBS"; yang masuk di demo Lenny, dan Eric juga anggota manajemen. Mengubah nama: `"owner_name"`, `"owner_initial"`, entri `"eric"` di `people`, dan `"greeting"` di `index.html`. Menyalakan contoh fitur AI: `const AI_ON = true` (dimatikan secara bawaan; perkiraan biaya di `PANDUAN-DEMO.md` bagian 9). Mengubah tanggal demo: `"demo_date"` (semua label "kemarin",
"4 hari", "16 hari lagi" dihitung dari tanggal itu, bukan dari jam HP).

Uji otomatis: `npx playwright test e2e/kontraktor-mockup.spec.ts` dari folder utama repositori.
