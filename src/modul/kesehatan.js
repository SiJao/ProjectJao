// Modul Kesehatan — kunjungan, pemeriksaan (diagnosa, resep, tindak lanjut), profil kesehatan, analisis musim sakit.
// Data medis hanya untuk pemegang akses kesehatan / pemeriksaan + Moderator (K-06); profil juga untuk akses profil_kesehatan.
// Riwayat Perubahan & email wali TIDAK memuat keluhan, diagnosa, atau resep.
export default function (H) {
  const { on, json, gagal, wib, hariIni, bersih, boleh, wajib, lingIn, cekLing, catat, stmtCatat, tanda } = H;
  const medis = (u) => boleh(u, "kesehatan") || boleh(u, "pemeriksaan");
  const wajibMedis = (u) => { if (!medis(u)) gagal(403, "Anda tidak punya akses data kesehatan."); };
  const SANTRI = `JOIN santri s ON s.id = kj.santri_id LEFT JOIN kamar km ON km.id = s.kamar_id
    LEFT JOIN kelas kl ON kl.id = s.kelas_id LEFT JOIN jenjang jj ON jj.id = kl.jenjang_id`;
  const KOL_SANTRI = "s.nis, s.nama, s.foto_url, km.nama kamar, (kl.tingkat || ' ' || kl.rombel || ' ' || jj.nama || COALESCE(' ' || kl.label, '')) kelas";
  const formatWaktu = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

  async function ambilKunjungan(db, u, id) {
    const kj = await db.prepare(
      `SELECT kj.*, jk.nama jenis, jk.status_kehadiran_id, jk.kabar_wali, ${KOL_SANTRI}, uc.nama dicatat_nama, ub.nama dibatalkan_nama
       FROM kunjungan_kesehatan kj JOIN jenis_kunjungan jk ON jk.id = kj.jenis_kunjungan_id ${SANTRI}
       LEFT JOIN users uc ON uc.id = kj.dicatat_oleh LEFT JOIN users ub ON ub.id = kj.dibatalkan_oleh WHERE kj.id = ?`).bind(id).first();
    if (!kj) gagal(404, "Kunjungan tidak ditemukan.");
    cekLing(u, kj.lingkungan);
    return kj;
  }
  async function ambilSantri(db, u, id) {
    const s = await db.prepare("SELECT id, nis, nama, status, lingkungan, foto_url FROM santri WHERE id = ?").bind(id).first();
    if (!s) gagal(404, "Santri tidak ditemukan.");
    cekLing(u, s.lingkungan);
    return s;
  }

  // Daftar aktif: perawatan yang masih berjalan, kunjungan hari ini, dan kunjungan yang menunggu pemeriksaan.
  on("GET", "/api/kesehatan", async ({ db, u }) => {
    wajibMedis(u);
    const l = lingIn(u, "kj.lingkungan");
    const [jenis, daftar] = await db.batch([
      db.prepare("SELECT * FROM jenis_kunjungan WHERE aktif = 1 ORDER BY urutan, nama"),
      db.prepare(
        `SELECT kj.id, kj.santri_id, kj.lingkungan, kj.waktu, kj.keluhan, kj.selesai_rawat_at, jk.nama jenis, (jk.status_kehadiran_id IS NOT NULL) perawatan,
                p.id pemeriksaan_id, ${KOL_SANTRI}
         FROM kunjungan_kesehatan kj JOIN jenis_kunjungan jk ON jk.id = kj.jenis_kunjungan_id ${SANTRI} LEFT JOIN pemeriksaan p ON p.kunjungan_id = kj.id
         WHERE kj.status = 'aktif' AND ${l.sql}
           AND ((jk.status_kehadiran_id IS NOT NULL AND kj.selesai_rawat_at IS NULL) OR substr(kj.waktu,1,10) = ? OR p.id IS NULL)
         ORDER BY kj.waktu DESC LIMIT 300`).bind(...l.args, hariIni()),
    ]);
    return json({ jenis: jenis.results, daftar: daftar.results });
  });

  on("GET", "/api/kesehatan/kunjungan/:id", async ({ db, u, p }) => {
    wajibMedis(u);
    const kj = await ambilKunjungan(db, u, p.id);
    const [pm, rs, pr] = await db.batch([
      db.prepare(`SELECT p.*, d.nama diagnosa, t.nama tindak_lanjut, ub.nama dicatat_nama FROM pemeriksaan p LEFT JOIN pilihan d ON d.id = p.diagnosa_id
                  LEFT JOIN pilihan t ON t.id = p.tindak_lanjut_id LEFT JOIN users ub ON ub.id = p.dicatat_oleh WHERE p.kunjungan_id = ?`).bind(kj.id),
      db.prepare("SELECT r.*, o.nama obat FROM resep r JOIN pemeriksaan p ON p.id = r.pemeriksaan_id LEFT JOIN pilihan o ON o.id = r.obat_id WHERE p.kunjungan_id = ? ORDER BY r.id").bind(kj.id),
      db.prepare("SELECT alergi, penyakit_kronis, catatan, diubah_at FROM profil_kesehatan WHERE santri_id = ?").bind(kj.santri_id),
    ]);
    const pemeriksaan = pm.results[0] || null;
    if (pemeriksaan) pemeriksaan.resep = rs.results;
    return json({ ...kj, pemeriksaan, profil: pr.results[0] || null });
  });

  on("POST", "/api/kesehatan/kunjungan", async ({ db, u, body }) => {
    wajib(u, "kesehatan");
    const s = await db.prepare("SELECT id, nis, nama, status, lingkungan FROM santri WHERE id = ?").bind(body.santri_id || 0).first();
    if (!s) gagal(400, "Santri tidak ditemukan.");
    cekLing(u, s.lingkungan);
    if (s.status !== "aktif") gagal(400, "Santri tidak berstatus aktif.");
    const jk = await db.prepare("SELECT * FROM jenis_kunjungan WHERE id = ? AND aktif = 1").bind(body.jenis_kunjungan_id || 0).first();
    if (!jk) gagal(400, "Jenis kunjungan tidak valid.");
    const keluhan = bersih(body.keluhan, 300);
    if (!keluhan) gagal(400, "Keluhan wajib diisi.");
    const waktu = body.waktu ? String(body.waktu).replace("T", " ").slice(0, 16) : wib();
    if (!formatWaktu.test(waktu)) gagal(400, "Format waktu tidak valid.");
    if (waktu > wib(Date.now() + 5 * 60e3)) gagal(400, "Waktu kunjungan tidak boleh di masa depan.");
    if (jk.status_kehadiran_id) {
      const rawat = await db.prepare(
        `SELECT kj.id FROM kunjungan_kesehatan kj JOIN jenis_kunjungan jk ON jk.id = kj.jenis_kunjungan_id
         WHERE kj.santri_id = ? AND kj.status = 'aktif' AND jk.status_kehadiran_id IS NOT NULL AND kj.selesai_rawat_at IS NULL`).bind(s.id).first();
      if (rawat) gagal(409, "Santri ini masih dalam perawatan. Tandai selesai dirawat terlebih dahulu.");
    }
    const r = await db.prepare("INSERT INTO kunjungan_kesehatan (santri_id, lingkungan, jenis_kunjungan_id, keluhan, waktu, dicatat_oleh) VALUES (?,?,?,?,?,?)")
      .bind(s.id, s.lingkungan, jk.id, keluhan, waktu, u.id).run();
    const id = r.meta.last_row_id;
    await catat(db, u, "kesantrian", "kunjungan_kesehatan", "kunjungan_kesehatan", id, `Kunjungan kesehatan: ${s.nis} ${s.nama}`, s.lingkungan);
    // Kabar wali tanpa keluhan/diagnosa (README Kesehatan).
    const kabar = jk.kabar_wali ? await H.kabarWali(db, s.id, {
      subjek: "Kabar kesehatan", tabel: "kunjungan_kesehatan", id,
      isi: "Ananda sedang sakit dan dirawat di pusat kesehatan pondok. Petugas kesehatan pondok mendampingi Ananda hingga pulih.",
    }) : 0;
    return json({ ok: true, id, kabar_wali: kabar });
  });

  on("POST", "/api/kesehatan/kunjungan/:id/selesai", async ({ db, u, p }) => {
    wajib(u, "kesehatan");
    const kj = await ambilKunjungan(db, u, p.id);
    if (kj.status !== "aktif") gagal(400, "Kunjungan ini sudah dibatalkan.");
    if (!kj.status_kehadiran_id) gagal(400, "Hanya kunjungan perawatan yang perlu ditandai selesai dirawat.");
    if (kj.selesai_rawat_at) gagal(400, "Santri ini sudah ditandai selesai dirawat.");
    const t = wib() < kj.waktu ? kj.waktu : wib();
    await db.batch([
      db.prepare("UPDATE kunjungan_kesehatan SET selesai_rawat_at = ? WHERE id = ? AND selesai_rawat_at IS NULL").bind(t, kj.id),
      stmtCatat(db, u, "kesantrian", "selesai_rawat", "kunjungan_kesehatan", kj.id, `Selesai dirawat: ${kj.nis} ${kj.nama}`, kj.lingkungan),
    ]);
    return json({ ok: true, selesai_rawat_at: t });
  });

  // Batal = salah input: absensi otomatis Sakit dari kunjungan ini dihapus, wali menerima ralat bila sempat dikabari.
  on("POST", "/api/kesehatan/kunjungan/:id/batal", async ({ db, u, p, body }) => {
    wajib(u, "kesehatan");
    const kj = await ambilKunjungan(db, u, p.id);
    const alasan = bersih(body.alasan, 200);
    if (!alasan) gagal(400, "Alasan pembatalan wajib diisi.");
    if (kj.status !== "aktif") gagal(400, "Kunjungan ini sudah dibatalkan.");
    await db.batch([
      db.prepare("UPDATE kunjungan_kesehatan SET status = 'dibatalkan', dibatalkan_oleh = ?, alasan_batal = ? WHERE id = ?").bind(u.id, alasan, kj.id),
      db.prepare("DELETE FROM absensi WHERE kunjungan_id = ? AND sumber = 'kesehatan'").bind(kj.id),
      stmtCatat(db, u, "kesantrian", "kunjungan_batal", "kunjungan_kesehatan", kj.id, `Kunjungan kesehatan dibatalkan: ${kj.nis} ${kj.nama}`, kj.lingkungan),
    ]);
    const ralat = await H.kabarKoreksi(db, "kunjungan_kesehatan", kj.id, "kabar bahwa Ananda sedang sakit / dirawat di pusat kesehatan pondok adalah salah input dan telah dibatalkan.");
    return json({ ok: true, ralat_wali: ralat });
  });

  // Pemeriksaan (diagnosa, resep, tindak lanjut): hanya pemegang akses pemeriksaan (mis. dokter). Satu per kunjungan, boleh diubah.
  on("POST", "/api/kesehatan/kunjungan/:id/pemeriksaan", async ({ db, u, p, body }) => {
    wajib(u, "pemeriksaan");
    const kj = await ambilKunjungan(db, u, p.id);
    if (kj.status !== "aktif") gagal(400, "Kunjungan ini sudah dibatalkan.");
    const diagId = body.diagnosa_id ? +body.diagnosa_id : null;
    const diagLain = diagId ? null : bersih(body.diagnosa_lain, 120);
    if (!diagId && !diagLain) gagal(400, "Diagnosa wajib diisi (pilih dari daftar, atau Lainnya lalu tulis).");
    const tlId = body.tindak_lanjut_id ? +body.tindak_lanjut_id : null;
    const resep = (Array.isArray(body.resep) ? body.resep : [])
      .map((r) => ({ obat_id: r && r.obat_id ? +r.obat_id : null, obat_lain: r && !r.obat_id ? bersih(r.obat_lain, 120) : null, aturan_pakai: bersih(r && r.aturan_pakai, 120) }))
      .filter((r) => r.obat_id || r.obat_lain || r.aturan_pakai);
    if (resep.length > 20) gagal(400, "Resep maksimal 20 obat.");
    if (resep.some((r) => !r.obat_id && !r.obat_lain)) gagal(400, "Setiap baris resep wajib berisi nama obat.");
    const ids = [...new Set([diagId, tlId, ...resep.map((r) => r.obat_id)].filter(Boolean))];
    const pil = ids.length ? Object.fromEntries((await db.prepare(`SELECT id, kelompok, lingkungan FROM pilihan WHERE id IN (${tanda(ids.length)})`).bind(...ids).all()).results.map((r) => [r.id, r])) : {};
    const sah = (id, kel) => { const x = pil[id]; return !!x && x.kelompok === kel && (x.lingkungan === "semua" || x.lingkungan === kj.lingkungan); };
    if (diagId && !sah(diagId, "diagnosa")) gagal(400, "Diagnosa tidak valid.");
    if (tlId && !sah(tlId, "tindak_lanjut")) gagal(400, "Tindak lanjut tidak valid.");
    if (resep.some((r) => r.obat_id && !sah(r.obat_id, "obat"))) gagal(400, "Ada obat yang tidak valid.");
    const ada = await db.prepare("SELECT id FROM pemeriksaan WHERE kunjungan_id = ?").bind(kj.id).first();
    const PID = "(SELECT id FROM pemeriksaan WHERE kunjungan_id = ?)";
    await db.batch([
      db.prepare(`INSERT INTO pemeriksaan (kunjungan_id, diagnosa_id, diagnosa_lain, tindak_lanjut_id, catatan, pemeriksa, waktu, dicatat_oleh) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT (kunjungan_id) DO UPDATE SET diagnosa_id = excluded.diagnosa_id, diagnosa_lain = excluded.diagnosa_lain, tindak_lanjut_id = excluded.tindak_lanjut_id,
          catatan = excluded.catatan, pemeriksa = excluded.pemeriksa, dicatat_oleh = excluded.dicatat_oleh`)
        .bind(kj.id, diagId, diagLain, tlId, bersih(body.catatan, 500), bersih(body.pemeriksa, 120) || u.nama, wib(), u.id),
      db.prepare(`DELETE FROM resep WHERE pemeriksaan_id = ${PID}`).bind(kj.id),
      ...resep.map((r) => db.prepare(`INSERT INTO resep (pemeriksaan_id, obat_id, obat_lain, aturan_pakai) VALUES (${PID},?,?,?)`).bind(kj.id, r.obat_id, r.obat_lain, r.aturan_pakai)),
      stmtCatat(db, u, "kesantrian", ada ? "pemeriksaan_ubah" : "pemeriksaan", "kunjungan_kesehatan", kj.id, `Pemeriksaan ${ada ? "diperbarui" : "dicatat"}: ${kj.nis} ${kj.nama}`, kj.lingkungan),
    ]);
    return json({ ok: true, baru: !ada });
  });

  // Profil kesehatan: dilihat pemegang kesehatan/pemeriksaan/profil_kesehatan, diubah pemegang profil_kesehatan (K-87).
  on("GET", "/api/kesehatan/profil/:santri", async ({ db, u, p }) => {
    if (!medis(u) && !boleh(u, "profil_kesehatan")) gagal(403, "Anda tidak punya akses profil kesehatan.");
    const s = await ambilSantri(db, u, p.santri);
    const pr = await db.prepare("SELECT pk.alergi, pk.penyakit_kronis, pk.catatan, pk.diubah_at, ub.nama diubah_nama FROM profil_kesehatan pk LEFT JOIN users ub ON ub.id = pk.diubah_oleh WHERE pk.santri_id = ?").bind(s.id).first();
    return json({ santri: s, profil: pr || null });
  });

  on("POST", "/api/kesehatan/profil/:santri", async ({ db, u, p, body }) => {
    wajib(u, "profil_kesehatan");
    const s = await ambilSantri(db, u, p.santri);
    await db.batch([
      db.prepare(`INSERT INTO profil_kesehatan (santri_id, lingkungan, alergi, penyakit_kronis, catatan, diubah_oleh, diubah_at) VALUES (?,?,?,?,?,?,datetime('now'))
        ON CONFLICT (santri_id) DO UPDATE SET alergi = excluded.alergi, penyakit_kronis = excluded.penyakit_kronis, catatan = excluded.catatan,
          diubah_oleh = excluded.diubah_oleh, diubah_at = excluded.diubah_at`)
        .bind(s.id, s.lingkungan, bersih(body.alergi, 300), bersih(body.penyakit_kronis, 300), bersih(body.catatan, 500), u.id),
      stmtCatat(db, u, "kesantrian", "profil_kesehatan", "profil_kesehatan", s.id, `Profil kesehatan diubah: ${s.nis} ${s.nama}`, s.lingkungan),
    ]);
    return json({ ok: true });
  });

  // Riwayat kesehatan satu santri: semua kunjungan + pemeriksaan + resep.
  on("GET", "/api/kesehatan/santri/:id", async ({ db, u, p }) => {
    wajibMedis(u);
    const s = await ambilSantri(db, u, p.id);
    const [kr, rr, pr] = await db.batch([
      db.prepare(`SELECT kj.id, kj.waktu, kj.keluhan, kj.selesai_rawat_at, kj.status, kj.alasan_batal, jk.nama jenis, (jk.status_kehadiran_id IS NOT NULL) perawatan,
                         pm.id pemeriksaan_id, COALESCE(d.nama, pm.diagnosa_lain) diagnosa, t.nama tindak_lanjut, pm.catatan, pm.pemeriksa
                  FROM kunjungan_kesehatan kj JOIN jenis_kunjungan jk ON jk.id = kj.jenis_kunjungan_id LEFT JOIN pemeriksaan pm ON pm.kunjungan_id = kj.id
                  LEFT JOIN pilihan d ON d.id = pm.diagnosa_id LEFT JOIN pilihan t ON t.id = pm.tindak_lanjut_id
                  WHERE kj.santri_id = ? ORDER BY kj.waktu DESC LIMIT 200`).bind(s.id),
      db.prepare(`SELECT r.pemeriksaan_id, COALESCE(o.nama, r.obat_lain) obat, r.aturan_pakai FROM resep r JOIN pemeriksaan pm ON pm.id = r.pemeriksaan_id
                  JOIN kunjungan_kesehatan kj ON kj.id = pm.kunjungan_id LEFT JOIN pilihan o ON o.id = r.obat_id WHERE kj.santri_id = ? ORDER BY r.id`).bind(s.id),
      db.prepare("SELECT alergi, penyakit_kronis, catatan, diubah_at FROM profil_kesehatan WHERE santri_id = ?").bind(s.id),
    ]);
    const resep = {};
    for (const r of rr.results) (resep[r.pemeriksaan_id] ||= []).push(r);
    return json({ santri: s, profil: pr.results[0] || null, kunjungan: kr.results.map((k) => ({ ...k, resep: resep[k.pemeriksaan_id] || [] })) });
  });

  // Analisis musim sakit: kunjungan per bulan (6 bulan), 5 diagnosa & 5 keluhan terbanyak — sesuai lingkungan pengguna.
  const NAMA_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  on("GET", "/api/kesehatan/analisis", async ({ db, u, url }) => {
    wajibMedis(u);
    const pilih = url.searchParams.get("lingkungan");
    const l = u.ling.includes(pilih) ? { sql: "kj.lingkungan = ?", args: [pilih] } : lingIn(u, "kj.lingkungan");
    const [y, m] = hariIni().split("-").map(Number);
    const bulan = [];
    for (let i = 5; i >= 0; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); bulan.push(d.toISOString().slice(0, 7)); }
    const awal = bulan[0] + "-01";
    const [per, dg, kl] = await db.batch([
      db.prepare(`SELECT substr(kj.waktu,1,7) bulan, COUNT(*) n, SUM(jk.status_kehadiran_id IS NOT NULL) perawatan FROM kunjungan_kesehatan kj JOIN jenis_kunjungan jk ON jk.id = kj.jenis_kunjungan_id
                  WHERE kj.status = 'aktif' AND kj.waktu >= ? AND ${l.sql} GROUP BY bulan`).bind(awal, ...l.args),
      db.prepare(`SELECT COALESCE(d.nama, lower(trim(pm.diagnosa_lain))) nama, COUNT(*) n FROM pemeriksaan pm JOIN kunjungan_kesehatan kj ON kj.id = pm.kunjungan_id
                  LEFT JOIN pilihan d ON d.id = pm.diagnosa_id WHERE kj.status = 'aktif' AND kj.waktu >= ? AND ${l.sql} GROUP BY 1 ORDER BY n DESC, nama LIMIT 5`).bind(awal, ...l.args),
      db.prepare(`SELECT lower(trim(kj.keluhan)) nama, COUNT(*) n FROM kunjungan_kesehatan kj WHERE kj.status = 'aktif' AND kj.waktu >= ? AND ${l.sql}
                  GROUP BY 1 ORDER BY n DESC, nama LIMIT 5`).bind(awal, ...l.args),
    ]);
    const n = Object.fromEntries(per.results.map((r) => [r.bulan, r]));
    return json({
      bulan: bulan.map((b) => ({ bulan: b, label: NAMA_BULAN[+b.slice(5) - 1] + " " + b.slice(2, 4), n: n[b] ? n[b].n : 0, perawatan: n[b] ? n[b].perawatan : 0 })),
      diagnosa: dg.results, keluhan: kl.results,
    });
  });
}
