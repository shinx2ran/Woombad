# Mockup: LBS Manajemen (aplikasi pemilik kontraktor kebun sawit)

Contoh tampilan (mockup) untuk mengukur minat pemilik perusahaan kontraktor perkebunan sawit sebelum aplikasi sungguhan
dibangun. Nama perusahaan klien sungguhan (dipakai sebagai contoh); orang, SPK, angka, dan foto fiktif. Tidak berhubungan dengan aplikasi Woombad di folder utama; hanya menumpang repositori.

- `index.html` — seluruh mockup dalam satu berkas (HTML + CSS + JS, tanpa library). Buka langsung di browser, atau hosting
  statis apa pun; di HP: "Tambahkan ke layar utama".
- `PANDUAN-DEMO.md` — alur demo 10 menit, jawaban atas keberatan, tanda tertarik/tidak, perbandingan jujur dengan alat lain.
- `manifest.webmanifest`, `sw.js`, `icon-*.png` — agar versi yang di-hosting bisa dipasang dan dibuka tanpa sinyal.

Pak Rahmat tampil sebagai "Manajemen LBS". Mengubah nama: `"owner_name"` di `index.html`; label header: `"company"`. Menyalakan contoh fitur AI: `const AI_ON = true` (dimatikan secara bawaan; perkiraan biaya di `PANDUAN-DEMO.md` bagian 9). Mengubah tanggal demo: `"demo_date"` (semua label "kemarin",
"4 hari", "16 hari lagi" dihitung dari tanggal itu, bukan dari jam HP).

Uji otomatis: `npx playwright test e2e/kontraktor-mockup.spec.ts` dari folder utama repositori.
