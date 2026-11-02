// Modul Notifikasi (lonceng) untuk pengurus & guru + Detail Akun saya. Lihat src/modul/README.md.
// Dua sumber: (1) tugas sesuai akses — dihitung langsung dari tabel (tidak disimpan, selalu mutakhir);
// (2) tabel notifikasi — pengumuman internal, perubahan akun sendiri, kabar santri binaan untuk guru.
export default function (H) {
  const { on, json, gagal, wib, hariIni, bersih, boleh, lingIn, stmtCatat } = H;

  const hari = (n) => wib(Date.now() + n * 864e5).slice(0, 10);
  const bolehUmumkan = (u) => u.role === "moderator" || boleh(u, "pengumuman");

  // Tugas sesuai akses. Absensi: per tanggal (7 hari terakhir, sejak absensi pertama kali dipakai) kamar-sesi yang belum diisi.
  async function hitungTugas(db, u) {
    const l = lingIn(u), tugas = [];
    const st = [], pakai = [];
    const tambah = (kunci, stmt) => { pakai.push(kunci); st.push(stmt); };
    if (boleh(u, "perizinan")) tambah("overdue", db.prepare(`SELECT COUNT(*) n FROM izin WHERE status = 'overdue' AND ${l.sql}`).bind(...l.args));
    if (boleh(u, "putusan_kedisiplinan")) tambah("sidang", db.prepare(`SELECT COUNT(*) n FROM pelanggaran WHERE status = 'menunggu' AND ${l.sql}`).bind(...l.args));
    if (boleh(u, "pemeriksaan")) tambah("periksa", db.prepare(`SELECT COUNT(*) n FROM kunjungan_kesehatan k WHERE k.status = 'aktif' AND ${lingIn(u, "k.lingkungan").sql}
      AND NOT EXISTS (SELECT 1 FROM pemeriksaan p WHERE p.kunjungan_id = k.id)`).bind(...l.args));
    if (u.role === "moderator") {
      tambah("tanpa_akses", db.prepare("SELECT COUNT(*) n FROM users us WHERE role IS NULL AND status = 'aktif' AND NOT EXISTS (SELECT 1 FROM user_akses ua WHERE ua.user_id = us.id)"));
      tambah("email_gagal", db.prepare("SELECT COUNT(*) n FROM email_antrean WHERE status = 'gagal'"));
    }
    if (boleh(u, "absensi")) {
      const tgl = [0, 1, 2, 3, 4, 5, 6].map((i) => hari(-i));
      const lk = lingIn(u, "k.lingkungan");
      tambah("absensi", db.prepare(
        `WITH t(tgl) AS (VALUES ${tgl.map(() => "(?)").join(",")}),
              awal AS (SELECT COALESCE(MIN(tanggal), ?) a FROM absensi_sesi WHERE jenis = 'harian' AND ${l.sql})
         SELECT t.tgl, COUNT(*) sesi, COUNT(DISTINCT k.id) kamar FROM t JOIN awal ON t.tgl >= awal.a
           JOIN kamar k ON k.aktif = 1 AND ${lk.sql}
           JOIN pilihan p ON p.kelompok = 'sesi_absensi' AND p.aktif = 1 AND p.lingkungan IN ('semua', k.lingkungan)
         WHERE EXISTS (SELECT 1 FROM santri s WHERE s.kamar_id = k.id AND s.status IN ('aktif','skorsing'))
           AND NOT EXISTS (SELECT 1 FROM absensi_sesi a WHERE a.jenis = 'harian' AND a.tanggal = t.tgl AND a.target_id = k.id AND a.sesi_pilihan_id = p.id)
         GROUP BY t.tgl ORDER BY t.tgl DESC`).bind(...tgl, hariIni(), ...l.args, ...lk.args));
    }
    if (!st.length) return tugas;
    const hasil = Object.fromEntries((await db.batch(st)).map((r, i) => [pakai[i], r.results]));
    const n = (k) => (hasil[k] ? hasil[k][0].n : 0);
    if (n("overdue")) tugas.push({ kunci: "overdue", judul: `${n("overdue")} santri overdue`, isi: "Belum kembali ke pondok setelah batas waktu izin.", tautan: "/perizinan", jumlah: n("overdue") });
    if (n("sidang")) tugas.push({ kunci: "sidang", judul: `${n("sidang")} pelanggaran menunggu sidang`, isi: "Perlu diputuskan.", tautan: "/kedisiplinan", jumlah: n("sidang") });
    if (n("periksa")) tugas.push({ kunci: "periksa", judul: `${n("periksa")} kunjungan belum diperiksa`, isi: "Kunjungan kesehatan tanpa pemeriksaan.", tautan: "/kesehatan", jumlah: n("periksa") });
    if (n("tanpa_akses")) tugas.push({ kunci: "tanpa_akses", judul: `${n("tanpa_akses")} akun belum punya akses`, isi: "Terapkan preset atau centang akses di Pengguna & Akses.", tautan: "/pengguna", jumlah: n("tanpa_akses") });
    if (n("email_gagal")) tugas.push({ kunci: "email_gagal", judul: `${n("email_gagal")} email gagal terkirim`, isi: "Lihat Komunikasi → Antrean email.", tautan: "/komunikasi", jumlah: n("email_gagal") });
    if (hasil.absensi && hasil.absensi.length) {
      const hi = hariIni();
      const rinci = hasil.absensi.map((r) => ({ tanggal: r.tgl, kamar: r.kamar, sesi: r.sesi, tautan: "/absensi?tanggal=" + r.tgl,
        label: r.tgl === hi ? "Hari ini" : r.tgl === hari(-1) ? "Kemarin" : r.tgl }));
      const total = rinci.reduce((a, r) => a + r.sesi, 0);
      tugas.push({ kunci: "absensi", judul: `Absensi belum diisi (${rinci.length} hari)`, isi: rinci.slice(0, 3).map((r) => `${r.label}: ${r.kamar} kamar`).join(" · "),
        tautan: rinci[0].tautan, jumlah: total, rinci });
    }
    return tugas;
  }

  on("GET", "/api/notifikasi", async ({ db, u, url }) => {
    const semua = url.searchParams.get("semua") === "1";
    const [daftar, belum] = await db.batch([
      db.prepare(`SELECT id, jenis, judul, isi, tautan, dibuat_at, dibaca_at FROM notifikasi WHERE user_id = ? ORDER BY id DESC LIMIT ?`).bind(u.id, semua ? 200 : 20),
      db.prepare("SELECT COUNT(*) n FROM notifikasi WHERE user_id = ? AND dibaca_at IS NULL").bind(u.id),
    ]);
    return json({ tugas: await hitungTugas(db, u), daftar: daftar.results, belum_dibaca: belum.results[0].n });
  });

  // {id} → satu notifikasi; tanpa id → semua milik pengguna.
  on("POST", "/api/notifikasi/baca", async ({ db, u, body }) => {
    const r = body.id
      ? await db.prepare("UPDATE notifikasi SET dibaca_at = ? WHERE id = ? AND user_id = ? AND dibaca_at IS NULL").bind(wib(), +body.id, u.id).run()
      : await db.prepare("UPDATE notifikasi SET dibaca_at = ? WHERE user_id = ? AND dibaca_at IS NULL").bind(wib(), u.id).run();
    return json({ ok: true, dibaca: r.meta.changes });
  });

  // ---------------------------------------------------------------- pengumuman internal (lonceng)
  // sasaran: pengurus (akun santri) · guru (akun guru) · semua (Moderator + akun yang punya akses). Selain Moderator: hanya lingkungan sendiri.
  const SASARAN = { pengurus: "us.santri_id IS NOT NULL", guru: "us.guru_id IS NOT NULL",
    semua: "(us.role = 'moderator' OR EXISTS (SELECT 1 FROM user_akses ua WHERE ua.user_id = us.id))" };
  function penerima(u, body) {
    const syarat = SASARAN[body.sasaran];
    if (!syarat) gagal(400, "Pilih sasaran pengumuman.");
    const w = ["us.status = 'aktif'", syarat, "us.id <> ?"], a = [u.id];
    let ling = u.role === "moderator" ? ["putra", "putri"] : u.ling;
    if (["putra", "putri"].includes(body.lingkungan)) {
      if (!ling.includes(body.lingkungan)) gagal(403, "Anda hanya bisa mengumumkan ke lingkungan Anda.");
      ling = [body.lingkungan];
    }
    // akun berlingkungan 'semua' (mis. guru umum) ikut menerima pengumuman lingkungan mana pun
    w.push(`us.lingkungan IN (SELECT value FROM json_each(?) UNION SELECT 'semua')`); a.push(JSON.stringify(ling));
    // K-118: saring per jabatan (akun santri pemegang jabatan aktif) dan/atau akun pilihan (user_ids) di dalam sasaran yang sama
    const angka = (x) => [...new Set((Array.isArray(x) ? x : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    const jab = angka(body.jabatan_ids), pilih = angka(body.user_ids), uraian = [];
    if (jab.length) {
      w.push("us.santri_id IN (SELECT pg.santri_id FROM pengurus pg WHERE pg.selesai IS NULL AND pg.jabatan_id IN (SELECT value FROM json_each(?)))"); a.push(JSON.stringify(jab));
      uraian.push(jab.length + " jabatan");
    }
    if (Array.isArray(body.user_ids)) {
      if (!pilih.length) gagal(400, "Belum ada akun yang dipilih.");
      w.push("us.id IN (SELECT value FROM json_each(?))"); a.push(JSON.stringify(pilih)); uraian.push(pilih.length + " akun dipilih");
    }
    return { where: w.join(" AND "), args: a, ling: ling.length === 2 ? "semua" : ling[0], uraian: uraian.join(" · ") };
  }
  on("POST", "/api/notifikasi/pengumuman", async ({ db, u, body }) => {
    if (!bolehUmumkan(u)) gagal(403, "Anda tidak punya akses untuk tindakan ini.");
    const p = penerima(u, body);
    const n = (await db.prepare(`SELECT COUNT(*) n FROM users us WHERE ${p.where}`).bind(...p.args).first()).n;
    if (!body.konfirmasi) return json({ jumlah: n });
    const judul = bersih(body.judul, 150), isi = bersih(body.isi, 2000);
    if (!judul || !isi) gagal(400, "Judul dan isi pengumuman wajib diisi.");
    if (!n) gagal(400, "Tidak ada penerima untuk sasaran ini.");
    const ringkas = `Pengumuman internal "${judul}" ke ${body.sasaran} (${p.ling}${p.uraian ? " · " + p.uraian : ""}): ${n} akun`;
    if (await db.prepare("SELECT 1 FROM riwayat_perubahan WHERE user_id = ? AND aksi = 'pengumuman_internal' AND ringkasan = ? AND waktu > datetime('now', '-2 minutes')").bind(u.id, ringkas).first())
      gagal(409, "Pengumuman yang sama baru saja dikirim.");
    const [ins] = await db.batch([
      db.prepare(`INSERT INTO notifikasi (user_id, jenis, judul, isi, tautan) SELECT us.id, 'pengumuman', ?, ?, '/notifikasi' FROM users us WHERE ${p.where}`)
        .bind(judul, `${isi}\n\n— ${u.nama}`, ...p.args),
      stmtCatat(db, u, "komunikasi", "pengumuman_internal", "notifikasi", null, ringkas, p.ling),
    ]);
    return json({ ok: true, jumlah: ins.meta.changes });
  });

  // Calon penerima untuk dicentang (sasaran + lingkungan + jabatan, tanpa user_ids) dan daftar jabatan untuk saringan.
  on("POST", "/api/notifikasi/pengumuman/calon", async ({ db, u, body }) => {
    if (!bolehUmumkan(u)) gagal(403, "Anda tidak punya akses untuk tindakan ini.");
    const lj = lingIn(u, "lingkungan");
    const SQL_JAB = `SELECT id, nama, lingkungan FROM jabatan WHERE aktif = 1 AND (lingkungan = 'semua' OR ${lj.sql}) ORDER BY urutan, nama`;
    if (body.hanya_jabatan) return json({ jabatan: (await db.prepare(SQL_JAB).bind(...lj.args).all()).results });
    const p = penerima(u, { ...body, user_ids: undefined });
    const [aR, jR] = await db.batch([
      db.prepare(`SELECT us.id, us.nama, us.email, us.lingkungan, CASE WHEN us.role = 'moderator' THEN 'Moderator' WHEN us.guru_id IS NOT NULL THEN 'Guru' ELSE 'Pengurus' END jenis,
          (SELECT GROUP_CONCAT(jb.nama, ', ') FROM pengurus pg JOIN jabatan jb ON jb.id = pg.jabatan_id WHERE pg.santri_id = us.santri_id AND pg.selesai IS NULL) jabatan
        FROM users us WHERE ${p.where} ORDER BY jenis, us.lingkungan, us.nama LIMIT 3000`).bind(...p.args),
      db.prepare(SQL_JAB).bind(...lj.args),
    ]);
    return json({ akun: aR.results, jabatan: jR.results });
  });

  // ---------------------------------------------------------------- detail akun saya
  on("GET", "/api/akun-saya", async ({ db, u }) => {
    const [santri, jabatan, guru, kelas, kamar, akses, sesi] = await db.batch([
      db.prepare(`SELECT s.nis, s.nama, s.foto_url, s.status, s.lingkungan, km.nama kamar, (k.tingkat || ' ' || k.rombel || ' ' || j.nama || COALESCE(' ' || k.label, '')) kelas
        FROM santri s LEFT JOIN kamar km ON km.id = s.kamar_id LEFT JOIN kelas k ON k.id = s.kelas_id LEFT JOIN jenjang j ON j.id = k.jenjang_id WHERE s.id = ?`).bind(u.santri_id || 0),
      db.prepare(`SELECT jb.nama, p.lingkungan, p.mulai, mk.nama masa FROM pengurus p JOIN jabatan jb ON jb.id = p.jabatan_id JOIN masa_khidmat mk ON mk.id = p.masa_khidmat_id
        WHERE p.santri_id = ? AND p.selesai IS NULL ORDER BY jb.urutan`).bind(u.santri_id || 0),
      db.prepare("SELECT nip, nama, jenis_kelamin, lingkungan FROM guru WHERE id = ?").bind(u.guru_id || 0),
      db.prepare(`SELECT wk.peran, (k.tingkat || ' ' || k.rombel || ' ' || j.nama || COALESCE(' ' || k.label, '')) nama FROM wali_kelas wk JOIN kelas k ON k.id = wk.kelas_id
        JOIN jenjang j ON j.id = k.jenjang_id JOIN tahun_ajaran ta ON ta.id = wk.tahun_ajaran_id AND ta.status = 'aktif' WHERE wk.guru_id = ?`).bind(u.guru_id || 0),
      db.prepare(`SELECT wa.peran, km.nama FROM wali_asuh_kamar wa JOIN kamar km ON km.id = wa.kamar_id JOIN tahun_ajaran ta ON ta.id = wa.tahun_ajaran_id AND ta.status = 'aktif'
        WHERE wa.guru_id = ?`).bind(u.guru_id || 0),
      db.prepare(`SELECT a.kode, a.nama, ua.diberikan_at FROM user_akses ua JOIN akses a ON a.kode = ua.akses_kode WHERE ua.user_id = ? ORDER BY a.nama`).bind(u.id),
      db.prepare("SELECT COUNT(*) n FROM sesi_login WHERE user_id = ? AND kedaluwarsa > ?").bind(u.id, new Date().toISOString()),
    ]);
    const s = santri.results[0] || null, g = guru.results[0] || null;
    const preset = u.preset_id ? await db.prepare("SELECT nama FROM preset WHERE id = ?").bind(u.preset_id).first("nama") : null;
    return json({
      id: u.id, nama: u.nama, email: u.email, moderator: u.role === "moderator", preset: preset || null, lingkungan: u.lingkungan, status: u.status,
      dibuat_at: u.dibuat_at || null, login_terakhir: u.login_terakhir || null, punya_password: !!u.password_hash, sesi_aktif: sesi.results[0].n,
      // foto hanya dari database foto santri (bila ada); guru & moderator memakai inisial
      foto_url: s && s.foto_url ? s.foto_url : null,
      santri: s, jabatan: jabatan.results,
      guru: g, wali_kelas: kelas.results, wali_asuh: kamar.results,
      akses: akses.results,
    });
  });

  // Notifikasi yang sudah dibaca dan berumur > 90 hari dibersihkan (cron).
  H.berkala("notifikasi_bersih", async (db) =>
    (await db.prepare("DELETE FROM notifikasi WHERE dibaca_at IS NOT NULL AND dibuat_at < datetime('now', '-90 days')").run()).meta.changes);
}
