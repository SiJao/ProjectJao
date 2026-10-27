# Prototipe Tampilan HISADA

> Dibuat 26–27 Okt 2026 sebagai prototipe tampilan yang bisa diklik (kanvas Design claude.ai). **Belum terhubung ke database**; kode PHP belum mengikuti tampilan ini.
> **Data contoh saja:** nama santri fiktif ("Santri Contoh NN"), NIS/NIP palsu berawalan 99, nama guru "[Nama guru]". Nama asrama memakai nama asli (struktur pondok, bukan data pribadi).

File `*.dc.html` adalah format kanvas Design (butuh runtime kanvas, tidak bisa dibuka langsung di browser). Folder ini adalah **sumber** prototipe; tampilan dilihat lewat kanvas Design.

## Layar (13 + 1 komponen)

| File | Layar | Kelompok |
|---|---|---|
| `Main.dc.html` | Login | — |
| `Dashboard.dc.html` | Dashboard | Beranda |
| `DataMaster.dc.html` | Data Master (Santri, Kelas, Asrama & Kamar, Guru, Tahun Ajaran) | Administrasi |
| `Absensi.dc.html` | Absensi Harian / Kegiatan | Administrasi › Kesantrian |
| `Perizinan.dc.html` | Perizinan & Gate Pass | Administrasi › Kesantrian |
| `Kesehatan.dc.html` | Kesehatan | Administrasi › Kesantrian |
| `Kedisiplinan.dc.html` | Kedisiplinan | Administrasi › Kesantrian |
| `PengembanganDiri.dc.html` | Kegiatan & Ekstrakurikuler, Prestasi | Administrasi › Kesantrian |
| `Rapor.dc.html` | Rapor Kesantrian | Administrasi › Kesantrian |
| `TataWarkat.dc.html` | Kalender, Korespondensi, Inventaris | Administrasi › Tata Warkat |
| `UpdateData.dc.html` | Update Data & Import (pilih banyak, CSV, Update Kelas Tahunan, Serah Terima & PAW) | Fungsi |
| `ManajemenAkses.dc.html` | Manajemen Akses | Fungsi |
| `Riwayat.dc.html` | Riwayat Perubahan | Fungsi |
| `Sidebar.dc.html` | Komponen sidebar (dipakai semua layar) | — |
| `canvas.json` | Susunan artboard di kanvas | — |

## Catatan desain

- Sudut pandang: **Sekretaris**. Versi per role belum dibuat.
- **Kedisiplinan** memakai alur nyata (hakim memutus, batal ≤ 1 jam) — di README masih *Belum Diputuskan*.
- **Perizinan** masih desain lama (Izin Dinas, tanda tangan Dormitory Guardian); **Absensi** masih status "Sakit" — tabrakan dengan kenyataan, belum diputuskan.
- Gaya: hijau tua `#1F6B4F`, font Plus Jakarta Sans, sidebar Beranda / Administrasi / Fungsi.

## Versi web (untuk dicoba di hosting)

Folder [`web/`](web/) berisi versi **HTML biasa** dari prototipe ini, sehingga bisa dibuka tanpa kanvas:

- Buka `web/index.html` langsung di browser, **atau** unggah seluruh isi folder `web/` ke hosting (mis. subfolder `/prototipe/`) lalu buka `index.html`.
- Tidak butuh PHP, database, atau internet selain font Google (tanpa internet, huruf memakai font bawaan). Vue 3 (lisensi MIT) disertakan lokal di `web/vue.global.prod.js`.
- Dibuat ulang dari file `.dc.html` dengan `node build-web.js . web` (lalu salin `dc-shim.js` dan `vue.global.prod.js` ke `web/`).
