# Modul Tahap 2 & 3

Setiap modul = **satu berkas backend** `src/modul/<nama>.js` + **satu berkas tampilan** `public/modul/<nama>.js`.
Berkas bersama (`src/worker.js`, `src/schema.js`, `public/app.js`, `public/style.css`, `public/index.html`) tidak diubah oleh modul.

## Backend

```js
// src/modul/contoh.js
export default function (H) {
  H.on("GET", "/api/contoh", async ({ db, u, url, p, body, env, req }) => { H.wajib(u, "kegiatan"); return H.json({ ok: true }); });
  H.migrasi([{ id: 300, nama: "contoh-x", sql: ["CREATE TABLE ..."] }]); // hanya bila tabel/kolom belum ada di schema.js migrasi 2
  H.berkala("contoh", async (db, env) => 0);                              // jalan tiap 5 menit (cron)
}
```

| Bantuan `H` | Keterangan |
|---|---|
| `on(method, pola, fn, {publik})` | Daftar rute. `:id` di pola → `p.id`. Tanpa `publik`, `u` = pengguna login (wajib). |
| `json(data, status)`, `gagal(status, pesan)` | Jawaban / galat (pesan bahasa Indonesia, tampil ke pengguna). |
| `wib()`, `hariIni()`, `keMs(teks)` | Waktu WIB `YYYY-MM-DD HH:MM` / `YYYY-MM-DD`. |
| `bersih(s, max)`, `normalHp(s)`, `tanda(n)` | Rapikan teks; no. HP → `628…`; `?,?,?` untuk `IN (...)`. |
| `boleh(u, kode)`, `wajib(u, kode)`, `wajibModerator(u)` | Hak akses. Kode: lihat `KEMAMPUAN` di worker.js (`kesehatan`, `pemeriksaan`, `profil_kesehatan`, `input_pelanggaran`, `putusan_kedisiplinan`, `lihat_vonis`, `kegiatan`, `prestasi`, `rapor`, `tata_warkat`, `pengumuman`, `isi_pengurus`, `update_kamar`, `paw`, `riwayat`, `absensi`, `perizinan`, `lihat_*`). |
| `lingIn(u, kolom)` → `{sql, args}`; `cekLing(u, ling)` | **Wajib** menyaring setiap daftar dengan lingkungan pengguna; `cekLing` untuk satu baris. Lingkungan baris baru disalin dari santri/kamar/grup, tidak diketik pengguna. |
| `catat(db, u, kategori, aksi, tabel, id, ringkasan, ling)`, `stmtCatat(...)` | Riwayat Perubahan. **Jangan** menulis diagnosa, resep, isi vonis, atau keterangan pelanggaran ke ringkasan. |
| `cekSandi(u, password)` | Konfirmasi password untuk proses besar (gagal → 403). |
| `taAktif(db)`, `masaKhidmatAktif(db)` | Baris aktif atau `null`. |
| `stmtUbahStatus(db, u, santri, statusBaru, alasan, imporBatchId)` | Pernyataan untuk mengubah status santri + efek penutupan (alumni/mutasi/meninggal). Jalankan dengan `db.batch`. |
| `pindahRiwayat(db, tabel, kolom, santriId, targetId, sebab, taId)` | Pernyataan pindah kelas/kamar satu santri (2 query baca). Untuk massal tulis SQL berbasis himpunan sendiri. |
| `bacaKelas("5 B MIA")` | `{tingkat, rombel, jenjang, label}` atau `null`. |
| `statusOtomatis(db, santriIds, tanggal)` | Status absensi otomatis (skorsing > izin/overdue > perawatan). |
| `kabarWali(db, santriId, {subjek, isi, tabel, id})` | Email per kejadian ke wali tertaut. **Tanpa data sensitif.** |
| `kabarKoreksi(db, tabel, id, isi)`, `antreEmail(db, {...})`, `kirimAntrean(env, db)` | Ralat, email lain, kirim sekarang. |

### Batas kerja D1

Satu permintaan sebaiknya **≤ 40 query**. Baca data acuan sekali, tulis massal lewat `db.batch([...])`
(satu batch = satu permintaan) atau `json_each(?)` dengan satu parameter JSON. Proses ratusan santri: per kelompok dari browser.

### Rentang id migrasi

kesehatan/kedisiplinan 100–199 · updatedata 200–299 · kegiatan/rapor 300–399 · tatawarkat/backup 400–499 · perizinan2/komunikasi/portalwali 500–599.

## Tampilan

```js
// public/modul/contoh.js — skrip biasa (bukan module); memakai variabel global dari app.js
const Contoh = {
  components: { Pesan, CariSantri, FotoSantri, KonfirmasiSandi },
  directives: { baris: vBaris },
  setup() { const f = reactive({ galat: "", ok: "" }); return { f }; },
  template: `<div><span class="jejak">Administrasi</span><h1>Contoh</h1></div> <div class="kartu">…</div>`,
};
daftarHalaman("/contoh", Contoh, { label: "Contoh", grup: "Administrasi", urutan: 65, syarat: (me) => me.bisa.kegiatan, ikon: '<circle cx="12" cy="12" r="9"/>' });
```

- Global dari `app.js`: `reactive, ref, computed, onMounted, watch, nextTick`, `api(path, data?)` (POST bila `data` ada; galat → `throw Error(pesan)`), `negara` (`me`, `master`, `rute`), `muatMaster()`, `hariIni()`, `namaKelas(k)`, `LABEL_ROLE`, `pergi(hash)`, `gerak`, `vBaris`, `vHitung`, `bacaCsv(file, kolomWajib)`, `parseCsv`, `unduhCsv(nama, baris)`, `unduhXlsx(nama, [{nama, baris}])`, `unduhBerkas`.
- Komponen: `Pesan` (`:galat :ok`), `CariSantri` (`v-model` → `{id, nis, nama, kelas, kamar, foto_url}`), `FotoSantri` (`:s`, `ukuran` ''|'kecil'|'besar'), `KonfirmasiSandi` (`:pesan`, `@ok="pw => …"`, `@batal`).
- Parameter halaman lewat query: `#/rapor?santri=12` → baca `negara.rute`.
- Kelas CSS yang tersedia: `kartu`, `baris`, `isian`, `tabel`, `tab`, `dua-kolom`, `kisi`, `stat`, `angka`, `lencana` (+`hijau|merah|kuning|biru`), `pesan galat|ok|info`, `redup`, `jejak`, `judul-hal`, `santri-sel`, `tombol`, `button.kedua|bahaya|kecil`, `tidak-cetak` (disembunyikan saat cetak).
- Teks tampilan bahasa Indonesia. Tombol = `<button>`, isian berlabel. Template boleh banyak akar (tiap akar dianimasikan masuk).
- Urutan menu — Administrasi: Data Master 10, Absensi 20, Perizinan 30, Kesehatan 40, Kedisiplinan 50, Pengembangan Diri 60, Rapor 70, Tata Warkat 80 · Fungsi: Update Data 60, Pengguna 70, Komunikasi 75, Backup 85, Riwayat 90 · Beranda: Cari Santri & Guru 5.

## Aturan data

- Data uji **palsu** (NIS/NIP berawalan 99). NIK, No KK, penghasilan, NISN tidak pernah disimpan.
- Hapus = tidak ada untuk data kesantrian: batalkan/putihkan dengan status + alasan.
- Data medis hanya untuk pemegang `kesehatan`/`pemeriksaan` + Moderator; Asatidz tidak melihat data Kesehatan.
