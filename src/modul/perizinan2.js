// Modul perizinan2 — Koreksi overdue, Libur Pondok (izin pulang massal), kembali massal. Lihat src/modul/README.md.
// Keputusan: Libur Pondok dibuat & dibatalkan hanya oleh Moderator (satu libur untuk putra & putri, K-106);
// pemegang akses perizinan melihat izin libur di lingkungannya, mencetak Gate Pass, dan mengonfirmasi kembali massal.
export default function (H) {
  const { on, json, gagal, wib, bersih, wajib, wajibModerator, lingIn, cekLing, catat, stmtCatat } = H;
  const TGL = /^\d{4}-\d{2}-\d{2}$/;

  // ---------------------------------------------------------------- koreksi overdue
  // Overdue keliru (santri sebenarnya kembali tepat waktu): pelanggaran otomatis dibatalkan sistem, Alpha → Hadir, wali menerima ralat.
  on("POST", "/api/izin/:id/koreksi-overdue", async ({ db, u, p, body }) => {
    wajib(u, "perizinan");
    const z = await db.prepare("SELECT * FROM izin WHERE id = ?").bind(p.id).first();
    if (!z) gagal(404, "Izin tidak ditemukan.");
    cekLing(u, z.lingkungan);
    const alasan = bersih(body.alasan, 200);
    if (!alasan) gagal(400, "Alasan koreksi wajib diisi.");
    if (!z.overdue_at) gagal(400, "Izin ini tidak pernah overdue.");
    if (z.overdue_dikoreksi_at) gagal(409, "Overdue izin ini sudah dikoreksi.");
    const pl = await db.prepare("SELECT id, status FROM pelanggaran WHERE izin_id = ? AND sumber = 'overdue'").bind(z.id).first();
    const t = wib();
    const st = [
      db.prepare("UPDATE izin SET overdue_dikoreksi_at = ?, overdue_dikoreksi_oleh = ?, alasan_koreksi = ? WHERE id = ?").bind(t, u.id, alasan, z.id),
      db.prepare(`UPDATE absensi SET status_kehadiran_id = (SELECT id FROM status_kehadiran WHERE kode = 'H'), sumber = 'manual', keterangan = 'Koreksi overdue'
        WHERE izin_id = ? AND sumber = 'overdue'`).bind(z.id),
    ];
    if (z.status === "overdue")
      st.push(db.prepare("UPDATE izin SET status = 'kembali', kembali_at = rencana_kembali, dikonfirmasi_oleh = ? WHERE id = ?").bind(u.id, z.id));
    if (pl && pl.status === "menunggu")
      st.push(db.prepare("UPDATE pelanggaran SET status = 'dibatalkan', dibatalkan_at = ?, dibatalkan_oleh = NULL, alasan_batal = ? WHERE id = ? AND status = 'menunggu'")
        .bind(t, "Koreksi overdue: " + alasan, pl.id));
    st.push(stmtCatat(db, u, "kesantrian", "koreksi_overdue", "izin", z.id, "Koreksi overdue: " + alasan, z.lingkungan));
    const hasil = await db.batch(st);
    const ralat = await H.kabarKoreksi(db, "izin", z.id, "Ananda ternyata sudah kembali ke pondok tepat waktu; kabar keterlambatan sebelumnya tidak berlaku.", { subjek: "Belum kembali" });
    return json({
      ok: true, absensi_dikoreksi: hasil[1].meta.changes, ralat,
      pelanggaran: !pl ? "tidak_ada" : pl.status === "menunggu" ? "dibatalkan" : pl.status,
      // vonis sudah dijatuhkan → tidak dibatalkan otomatis; hakim melakukan pemutihan
      perlu_pemutihan: !!(pl && pl.status === "divonis"),
    });
  });

  // ---------------------------------------------------------------- Libur Pondok
  const statusSelesai = (db) => db.prepare(
    "UPDATE libur_pondok SET status = 'selesai' WHERE status = 'berjalan' AND NOT EXISTS (SELECT 1 FROM izin z WHERE z.libur_id = libur_pondok.id AND z.status IN ('berjalan','overdue'))");

  on("GET", "/api/libur", async ({ db, u }) => {
    wajib(u, "perizinan");
    await H.perbaruiOverdue(db);
    const l = lingIn(u, "z.lingkungan");
    const [, r] = await db.batch([statusSelesai(db), db.prepare(
      `SELECT lp.*, ji.nama jenis, ub.nama pembuat,
              COUNT(z.id) jumlah, SUM(z.status IN ('berjalan','overdue')) terbuka, SUM(z.status = 'overdue') overdue, SUM(z.status = 'kembali') kembali
       FROM libur_pondok lp JOIN jenis_izin ji ON ji.id = lp.jenis_izin_id LEFT JOIN users ub ON ub.id = lp.dibuat_oleh
       LEFT JOIN izin z ON z.libur_id = lp.id AND ${l.sql}
       GROUP BY lp.id ORDER BY lp.berangkat DESC LIMIT 50`).bind(...l.args)]);
    return json(r.results);
  });

  on("POST", "/api/libur", async ({ db, u, body }) => {
    wajibModerator(u);
    const nama = bersih(body.nama, 80);
    const b = String(body.berangkat || ""), k = String(body.kembali || "");
    if (!nama || !TGL.test(b) || !TGL.test(k)) gagal(400, "Isi nama, tanggal berangkat, dan tanggal kembali.");
    const ji = body.jenis_izin_id
      ? await db.prepare("SELECT * FROM jenis_izin WHERE id = ? AND aktif = 1").bind(body.jenis_izin_id).first()
      : await db.prepare("SELECT * FROM jenis_izin WHERE basis_waktu = 'tanggal' AND aktif = 1 ORDER BY urutan LIMIT 1").first();
    if (!ji) gagal(400, "Jenis izin tidak valid.");
    const berangkat = b + " 00:00", kembali = k + " " + (ji.jam_kembali_bawaan || "17:00");
    if (kembali <= berangkat) gagal(400, "Tanggal kembali harus setelah tanggal berangkat.");
    const r = await db.prepare("INSERT INTO libur_pondok (nama, berangkat, rencana_kembali, jenis_izin_id, status, dibuat_oleh) VALUES (?,?,?,?, 'rencana', ?)")
      .bind(nama, berangkat, kembali, ji.id, u.id).run();
    await catat(db, u, "kesantrian", "libur_buat", "libur_pondok", r.meta.last_row_id, `${nama}: ${berangkat} s.d. ${kembali}`);
    return json({ ok: true, id: r.meta.last_row_id });
  });

  // Pratinjau: semua santri aktif (putra & putri) per kamar; santri yang masih punya izin terbuka ditandai (akan dilewati).
  on("GET", "/api/libur/:id/pratinjau", async ({ db, u, p }) => {
    wajibModerator(u);
    const lp = await db.prepare("SELECT * FROM libur_pondok WHERE id = ?").bind(p.id).first();
    if (!lp) gagal(404, "Libur tidak ditemukan.");
    const r = await db.prepare(
      `SELECT s.id, s.nis, s.nama, s.lingkungan, s.foto_url, s.kamar_id, COALESCE(km.nama, '(tanpa kamar)') kamar,
              (SELECT z.id FROM izin z WHERE z.santri_id = s.id AND z.status IN ('berjalan','overdue') AND (z.libur_id IS NULL OR z.libur_id <> ?)) izin_terbuka,
              EXISTS (SELECT 1 FROM izin z WHERE z.santri_id = s.id AND z.libur_id = ?) sudah
       FROM santri s LEFT JOIN kamar km ON km.id = s.kamar_id WHERE s.status = 'aktif' ORDER BY s.lingkungan, kamar, s.nama`).bind(lp.id, lp.id).all();
    return json({ libur: lp, santri: r.results });
  });

  // Eksekusi berbasis himpunan (satu INSERT…SELECT): aman diulang (UNIQUE libur_id+santri_id), santri berizin terbuka dilewati.
  // Kabar: SATU pengumuman per akun wali yang punya anak tertaut di antara yang pulang (bukan per santri).
  on("POST", "/api/libur/:id/eksekusi", async ({ db, u, p, body }) => {
    wajibModerator(u);
    const lp = await db.prepare("SELECT lp.*, ji.nama jenis FROM libur_pondok lp JOIN jenis_izin ji ON ji.id = lp.jenis_izin_id WHERE lp.id = ?").bind(p.id).first();
    if (!lp) gagal(404, "Libur tidak ditemukan.");
    if (!["rencana", "berjalan"].includes(lp.status)) gagal(400, "Libur ini sudah " + lp.status + ".");
    const kecuali = JSON.stringify((Array.isArray(body.kecuali) ? body.kecuali : []).map((x) => +x).filter(Boolean));
    const app = H.APP();
    const [lewat, ins] = await db.batch([
      db.prepare(`SELECT s.id, s.nis, s.nama, km.nama kamar, ji.nama jenis FROM santri s LEFT JOIN kamar km ON km.id = s.kamar_id
        JOIN izin z ON z.santri_id = s.id AND z.status IN ('berjalan','overdue') AND (z.libur_id IS NULL OR z.libur_id <> ?) JOIN jenis_izin ji ON ji.id = z.jenis_izin_id
        WHERE s.status = 'aktif' AND s.id NOT IN (SELECT value FROM json_each(?)) ORDER BY s.nama`).bind(lp.id, kecuali),
      db.prepare(`INSERT INTO izin (santri_id, jenis_izin_id, keterangan, berangkat, rencana_kembali, pendamping, lingkungan, diterbitkan_oleh, libur_id)
        SELECT s.id, ?, ?, ?, ?, 'Wali (Libur Pondok)', s.lingkungan, ?, ? FROM santri s
        WHERE s.status = 'aktif' AND s.id NOT IN (SELECT value FROM json_each(?))
          AND NOT EXISTS (SELECT 1 FROM izin z WHERE z.santri_id = s.id AND (z.status IN ('berjalan','overdue') OR z.libur_id = ?))`)
        .bind(lp.jenis_izin_id, lp.nama, lp.berangkat, lp.rencana_kembali, u.id, lp.id, kecuali, lp.id),
      db.prepare("UPDATE libur_pondok SET status = 'berjalan' WHERE id = ?").bind(lp.id),
    ]);
    const isi = `Pondok mengumumkan ${lp.nama}: santri pulang mulai ${lp.berangkat.slice(0, 10)} dan wajib kembali ke pondok paling lambat ${lp.rencana_kembali} WIB.`
      + ` Santri dijemput wali; mohon pastikan ananda kembali tepat waktu.\n\nRincian dapat dilihat setelah masuk ke Portal Wali: ${app}/wali.html\n\n— HISADA, Pesantren Modern Daarul 'Uluum Lido`;
    const em = await db.prepare(
      `INSERT INTO email_antrean (penerima, subjek, isi, jenis, tabel_terkait, id_terkait, akun_wali_id, lingkungan)
       SELECT a.email, ?, 'Assalamu''alaikum ' || a.nama || ',' || char(10) || char(10) || ?, 'pengumuman', 'libur_pondok', ?, a.id, 'semua'
       FROM akun_wali a WHERE a.status = 'aktif'
         AND EXISTS (SELECT 1 FROM tautan_wali t JOIN izin z ON z.santri_id = t.santri_id AND z.libur_id = ? AND z.status <> 'dibatalkan' WHERE t.akun_wali_id = a.id AND t.dicabut_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM email_antrean e WHERE e.tabel_terkait = 'libur_pondok' AND e.id_terkait = ? AND e.akun_wali_id = a.id AND e.koreksi_dari_id IS NULL)`)
      .bind(("[HISADA] Pengumuman " + lp.nama).slice(0, 200), isi, lp.id, lp.id, lp.id).run();
    await catat(db, u, "kesantrian", "libur_eksekusi", "libur_pondok", lp.id,
      `${lp.nama}: ${ins.meta.changes} izin dibuat, ${lewat.results.length} dilewati, ${JSON.parse(kecuali).length} dikecualikan, ${em.meta.changes} pengumuman`);
    return json({ ok: true, dibuat: ins.meta.changes, dilewati: lewat.results, pengumuman: em.meta.changes });
  });

  // Detail libur + izinnya (dalam lingkungan pengguna) — juga data untuk cetak semua Gate Pass.
  on("GET", "/api/libur/:id", async ({ db, u, p, url }) => {
    wajib(u, "perizinan");
    const lp = await db.prepare("SELECT lp.*, ji.nama jenis, ji.basis_waktu FROM libur_pondok lp JOIN jenis_izin ji ON ji.id = lp.jenis_izin_id WHERE lp.id = ?").bind(p.id).first();
    if (!lp) gagal(404, "Libur tidak ditemukan.");
    const l = lingIn(u, "z.lingkungan");
    const w = [l.sql], a = [...l.args];
    if (url.searchParams.get("kamar_id")) { w.push("s.kamar_id = ?"); a.push(+url.searchParams.get("kamar_id")); }
    const r = await db.prepare(
      `SELECT z.id, z.santri_id, z.status, z.berangkat, z.rencana_kembali, z.kembali_at, z.keterangan, z.pendamping, z.lingkungan, z.overdue_at, z.overdue_dikoreksi_at,
              s.nis, s.nama, s.foto_url, s.kamar_id, km.nama kamar, (k.tingkat || ' ' || k.rombel || ' ' || j.nama) kelas
       FROM izin z JOIN santri s ON s.id = z.santri_id LEFT JOIN kamar km ON km.id = s.kamar_id
       LEFT JOIN kelas k ON k.id = s.kelas_id LEFT JOIN jenjang j ON j.id = k.jenjang_id
       WHERE z.libur_id = ? AND ${w.join(" AND ")} ORDER BY km.nama, s.nama LIMIT 3000`).bind(lp.id, ...a).all();
    return json({ libur: lp, izin: r.results.map((z) => ({ ...z, keadaan: H.keadaanIzin(z) })) });
  });

  on("POST", "/api/libur/:id/batal", async ({ db, u, p, body }) => {
    wajibModerator(u);
    const lp = await db.prepare("SELECT * FROM libur_pondok WHERE id = ?").bind(p.id).first();
    if (!lp) gagal(404, "Libur tidak ditemukan.");
    if (lp.status === "dibatalkan") gagal(409, "Libur ini sudah dibatalkan.");
    const alasan = bersih(body.alasan, 200);
    if (!alasan) gagal(400, "Alasan pembatalan wajib diisi.");
    const t = wib();
    const subjek = ("[HISADA] Ralat: Pengumuman " + lp.nama).slice(0, 200);
    const isiRalat = `Assalamu'alaikum,\n\nRalat atas pengumuman sebelumnya: ${lp.nama} DIBATALKAN. Alasan: ${alasan}\nSantri tetap mengikuti kegiatan pondok seperti biasa.\n\nMohon maaf atas perubahan ini.\n\n— HISADA`;
    const hasil = await db.batch([
      db.prepare("UPDATE libur_pondok SET status = 'dibatalkan', alasan_batal = ? WHERE id = ?").bind(alasan, lp.id),
      // pelanggaran overdue dari izin libur ini ikut gugur (hanya yang belum divonis)
      db.prepare(`UPDATE pelanggaran SET status = 'dibatalkan', dibatalkan_at = ?, dibatalkan_oleh = NULL, alasan_batal = ?
        WHERE sumber = 'overdue' AND status = 'menunggu' AND izin_id IN (SELECT id FROM izin WHERE libur_id = ?)`).bind(t, "Libur Pondok dibatalkan: " + alasan, lp.id),
      db.prepare("DELETE FROM absensi WHERE sumber IN ('perizinan','overdue') AND izin_id IN (SELECT id FROM izin WHERE libur_id = ?)").bind(lp.id),
      db.prepare("UPDATE izin SET status = 'dibatalkan', dibatalkan_at = ?, dibatalkan_oleh = NULL, alasan_batal = ? WHERE libur_id = ? AND status <> 'dibatalkan'").bind(t, alasan, lp.id),
      db.prepare(`INSERT INTO email_antrean (penerima, subjek, isi, jenis, tabel_terkait, id_terkait, akun_wali_id, koreksi_dari_id, lingkungan)
        SELECT e.penerima, ?, ?, 'pengumuman', 'libur_pondok', e.id_terkait, e.akun_wali_id, e.id, e.lingkungan
        FROM email_antrean e WHERE e.tabel_terkait = 'libur_pondok' AND e.id_terkait = ? AND e.koreksi_dari_id IS NULL`).bind(subjek, isiRalat, lp.id),
      stmtCatat(db, u, "kesantrian", "libur_batal", "libur_pondok", lp.id, `${lp.nama} dibatalkan: ${alasan}`),
    ]);
    return json({ ok: true, izin_dibatalkan: hasil[3].meta.changes, ralat: hasil[4].meta.changes, pelanggaran_dibatalkan: hasil[1].meta.changes });
  });

  // ---------------------------------------------------------------- kembali massal
  // Izin terbuka (opsional: satu libur, satu kamar) dalam lingkungan pengguna.
  on("GET", "/api/izin-terbuka", async ({ db, u, url }) => {
    wajib(u, "perizinan");
    await H.perbaruiOverdue(db);
    const l = lingIn(u, "z.lingkungan");
    const w = [l.sql, "z.status IN ('berjalan','overdue')"], a = [...l.args];
    const lib = url.searchParams.get("libur_id"), km = url.searchParams.get("kamar_id");
    if (lib) { w.push("z.libur_id = ?"); a.push(+lib); }
    if (km) { w.push("s.kamar_id = ?"); a.push(+km); }
    const r = await db.prepare(
      `SELECT z.id, z.status, z.berangkat, z.rencana_kembali, z.libur_id, s.nis, s.nama, s.foto_url, s.kamar_id, km.nama kamar, ji.nama jenis
       FROM izin z JOIN santri s ON s.id = z.santri_id JOIN jenis_izin ji ON ji.id = z.jenis_izin_id LEFT JOIN kamar km ON km.id = s.kamar_id
       WHERE ${w.join(" AND ")} ORDER BY km.nama, s.nama LIMIT 3000`).bind(...a).all();
    return json(r.results.map((z) => ({ ...z, keadaan: H.keadaanIzin(z) })));
  });

  // {izin_ids:[…]} atau {seluruh_kamar:true, kamar_id, libur_id?}. Juga untuk izin yang sudah overdue.
  on("POST", "/api/izin/kembali-massal", async ({ db, u, body }) => {
    wajib(u, "perizinan");
    const l = lingIn(u);
    const w = [l.sql, "status IN ('berjalan','overdue')"], a = [...l.args];
    if (body.seluruh_kamar) {
      if (!body.kamar_id) gagal(400, "Pilih kamar.");
      w.push("santri_id IN (SELECT id FROM santri WHERE kamar_id = ?)"); a.push(+body.kamar_id);
      if (body.libur_id) { w.push("libur_id = ?"); a.push(+body.libur_id); }
    } else {
      const ids = (Array.isArray(body.izin_ids) ? body.izin_ids : []).map((x) => +x).filter(Boolean).slice(0, 3000);
      if (!ids.length) gagal(400, "Pilih santri yang kembali.");
      w.push("id IN (SELECT value FROM json_each(?))"); a.push(JSON.stringify(ids));
    }
    const r = await db.prepare(`UPDATE izin SET status = 'kembali', kembali_at = ?, dikonfirmasi_oleh = ? WHERE ${w.join(" AND ")}`).bind(wib(), u.id, ...a).run();
    const n = r.meta.changes;
    if (n) await catat(db, u, "kesantrian", "izin_kembali_massal", "izin", null, `Kembali massal: ${n} izin${body.libur_id ? " (libur #" + body.libur_id + ")" : ""}`, u.ling.length === 1 ? u.ling[0] : "semua");
    return json({ ok: true, kembali: n });
  });
}
