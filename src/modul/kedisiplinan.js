// Modul Kedisiplinan — input pelanggaran, antrean sidang, vonis & pemutihan (rantai vonis), hasil vonis, skorsing bertanggal.
// Aturan: pencatat tidak boleh memvonis/memutihkan kasus yang ia catat sendiri (Moderator juga).
// Riwayat Perubahan & email wali TIDAK memuat keterangan pelanggaran atau isi vonis.
export default function (H) {
  const { on, json, gagal, hariIni, bersih, boleh, wajib, lingIn, cekLing, catat, stmtCatat, stmtUbahStatus, pengaturan } = H;
  const SANTRI = (a) => `JOIN santri s ON s.id = ${a}.santri_id LEFT JOIN kelas kl ON kl.id = s.kelas_id LEFT JOIN jenjang jj ON jj.id = kl.jenjang_id`;
  const KOL_SANTRI = "s.nis, s.nama, s.foto_url, s.status santri_status, (kl.tingkat || ' ' || kl.rombel || ' ' || jj.nama || COALESCE(' ' || kl.label, '')) kelas";
  // Vonis berlaku = ujung rantai: vonis yang tidak digantikan vonis lain.
  const BERLAKU = `LEFT JOIN vonis v ON v.pelanggaran_id = p.id AND NOT EXISTS (SELECT 1 FROM vonis w WHERE w.menggantikan_vonis_id = v.id)
    LEFT JOIN tingkat_vonis tv ON tv.id = v.tingkat_vonis_id`;
  const WIB = (k) => `strftime('%Y-%m-%d %H:%M', ${k}, '+7 hours')`;
  const tglSah = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t || "");
  const salahSatu = (u, ...kode) => { if (!kode.some((k) => boleh(u, k))) gagal(403, "Anda tidak punya akses untuk tindakan ini."); };
  const batasBatal = async (db) => Math.max(0, +(await pengaturan(db, "pelanggaran.batas_batal_menit", "60")) || 0);

  // Kolom pembatalan skorsing (tabel skorsing di migrasi 2 belum punya).
  H.migrasi([{ id: 100, nama: "skorsing-batal", sql: [
    "ALTER TABLE skorsing ADD COLUMN dibatalkan_at TEXT",
    "ALTER TABLE skorsing ADD COLUMN dibatalkan_oleh INTEGER REFERENCES users(id)",
    "ALTER TABLE skorsing ADD COLUMN alasan_batal TEXT",
  ] }]);

  on("GET", "/api/kedisiplinan/acuan", async ({ db, u }) => {
    salahSatu(u, "input_pelanggaran", "putusan_kedisiplinan", "lihat_vonis");
    const t = await db.prepare("SELECT * FROM tingkat_vonis WHERE aktif = 1 ORDER BY urutan, nama").all();
    return json({ tingkat: t.results, batas_batal_menit: await batasBatal(db) });
  });

  // ------------------------------------------------ input pelanggaran
  on("POST", "/api/kedisiplinan/pelanggaran", async ({ db, u, body }) => {
    wajib(u, "input_pelanggaran");
    const s = await db.prepare("SELECT id, nis, nama, status, lingkungan FROM santri WHERE id = ?").bind(body.santri_id || 0).first();
    if (!s) gagal(400, "Santri tidak ditemukan.");
    cekLing(u, s.lingkungan);
    if (!["aktif", "skorsing"].includes(s.status)) gagal(400, "Santri tidak berstatus aktif.");
    const kat = await db.prepare("SELECT id FROM pilihan WHERE id = ? AND kelompok = 'kategori_pelanggaran' AND aktif = 1 AND (lingkungan = 'semua' OR lingkungan = ?)")
      .bind(body.kategori_id || 0, s.lingkungan).first();
    if (!kat) gagal(400, "Kategori pelanggaran tidak valid.");
    const ket = bersih(body.keterangan, 300);
    if (!ket) gagal(400, "Keterangan pelanggaran wajib diisi.");
    const tanggal = body.tanggal ? String(body.tanggal) : hariIni();
    if (!tglSah(tanggal)) gagal(400, "Tanggal tidak valid.");
    if (tanggal > hariIni()) gagal(400, "Tanggal pelanggaran tidak boleh di masa depan.");
    const r = await db.prepare("INSERT INTO pelanggaran (santri_id, lingkungan, kategori_id, keterangan, tanggal, sumber, dicatat_oleh) VALUES (?,?,?,?,?, 'manual', ?)")
      .bind(s.id, s.lingkungan, kat.id, ket, tanggal, u.id).run();
    await catat(db, u, "kesantrian", "pelanggaran", "pelanggaran", r.meta.last_row_id, `Pelanggaran dicatat: ${s.nis} ${s.nama}`, s.lingkungan);
    return json({ ok: true, id: r.meta.last_row_id });
  });

  // Input saya (7 hari): untuk membatalkan dalam batas waktu.
  on("GET", "/api/kedisiplinan/input-saya", async ({ db, u }) => {
    wajib(u, "input_pelanggaran");
    const l = lingIn(u, "p.lingkungan"), menit = await batasBatal(db);
    const r = await db.prepare(
      `SELECT p.id, p.santri_id, p.tanggal, p.keterangan, p.status, p.alasan_batal, ${WIB("p.dicatat_at")} dicatat_wib, kt.nama kategori, ${KOL_SANTRI},
              (p.status = 'menunggu' AND p.dicatat_at >= datetime('now', ?)) bisa_batal, ${WIB(`datetime(p.dicatat_at, '+${menit} minutes')`)} batas_batal
       FROM pelanggaran p ${SANTRI("p")} JOIN pilihan kt ON kt.id = p.kategori_id
       WHERE p.dicatat_oleh = ? AND p.dicatat_at >= datetime('now', '-7 days') AND ${l.sql} ORDER BY p.id DESC LIMIT 100`).bind(`-${menit} minutes`, u.id, ...l.args).all();
    return json({ batas_batal_menit: menit, daftar: r.results });
  });

  on("POST", "/api/kedisiplinan/pelanggaran/:id/batal", async ({ db, u, p, body }) => {
    wajib(u, "input_pelanggaran");
    const menit = await batasBatal(db);
    const pl = await db.prepare("SELECT p.*, s.nis, s.nama, (p.dicatat_at >= datetime('now', ?)) masih FROM pelanggaran p JOIN santri s ON s.id = p.santri_id WHERE p.id = ?")
      .bind(`-${menit} minutes`, p.id).first();
    if (!pl) gagal(404, "Pelanggaran tidak ditemukan.");
    cekLing(u, pl.lingkungan);
    if (pl.dicatat_oleh !== u.id) gagal(403, "Hanya pencatat yang dapat membatalkan input pelanggarannya.");
    const alasan = bersih(body.alasan, 200);
    if (!alasan) gagal(400, "Alasan pembatalan wajib diisi.");
    if (pl.status !== "menunggu") gagal(400, "Pelanggaran ini sudah diputus atau dibatalkan.");
    if (!pl.masih) gagal(400, `Batas pembatalan ${menit} menit sudah lewat. Pemutihan hanya oleh pemutus.`);
    await db.batch([
      db.prepare("UPDATE pelanggaran SET status = 'dibatalkan', dibatalkan_at = datetime('now'), dibatalkan_oleh = ?, alasan_batal = ? WHERE id = ? AND status = 'menunggu'").bind(u.id, alasan, pl.id),
      stmtCatat(db, u, "kesantrian", "pelanggaran_batal", "pelanggaran", pl.id, `Input pelanggaran dibatalkan: ${pl.nis} ${pl.nama}`, pl.lingkungan),
    ]);
    return json({ ok: true });
  });

  // ------------------------------------------------ sidang & vonis
  on("GET", "/api/kedisiplinan/antrean", async ({ db, u }) => {
    wajib(u, "putusan_kedisiplinan");
    const l = lingIn(u, "p.lingkungan");
    const r = await db.prepare(
      `SELECT p.id, p.santri_id, p.lingkungan, p.tanggal, p.keterangan, p.sumber, ${WIB("p.dicatat_at")} dicatat_wib, kt.id kategori_id, kt.nama kategori, ${KOL_SANTRI},
              uc.nama pencatat, (p.dicatat_oleh IS NOT NULL AND p.dicatat_oleh = ?) milik_sendiri
       FROM pelanggaran p ${SANTRI("p")} JOIN pilihan kt ON kt.id = p.kategori_id LEFT JOIN users uc ON uc.id = p.dicatat_oleh
       WHERE p.status = 'menunggu' AND ${l.sql} ORDER BY p.tanggal, p.id LIMIT 300`).bind(u.id, ...l.args).all();
    return json(r.results);
  });

  async function rantai(db, pelanggaranId) {
    return (await db.prepare(
      `SELECT v.id, v.tingkat_vonis_id, v.hukuman, v.alasan, v.menggantikan_vonis_id, ${WIB("v.diputus_at")} diputus_wib, tv.nama tingkat, tv.adalah_pemutihan, tv.kabar_wali, ud.nama diputus_nama
       FROM vonis v JOIN tingkat_vonis tv ON tv.id = v.tingkat_vonis_id LEFT JOIN users ud ON ud.id = v.diputus_oleh WHERE v.pelanggaran_id = ? ORDER BY v.id`).bind(pelanggaranId).all()).results;
  }

  on("GET", "/api/kedisiplinan/pelanggaran/:id", async ({ db, u, p }) => {
    wajib(u, "putusan_kedisiplinan");
    const pl = await db.prepare(
      `SELECT p.*, ${WIB("p.dicatat_at")} dicatat_wib, kt.nama kategori, ${KOL_SANTRI}, uc.nama pencatat, ub.nama dibatalkan_nama
       FROM pelanggaran p ${SANTRI("p")} JOIN pilihan kt ON kt.id = p.kategori_id LEFT JOIN users uc ON uc.id = p.dicatat_oleh LEFT JOIN users ub ON ub.id = p.dibatalkan_oleh WHERE p.id = ?`).bind(p.id).first();
    if (!pl) gagal(404, "Pelanggaran tidak ditemukan.");
    cekLing(u, pl.lingkungan);
    const vonis = await rantai(db, pl.id);
    return json({ ...pl, milik_sendiri: pl.dicatat_oleh != null && pl.dicatat_oleh === u.id, vonis, berlaku: vonis.length ? vonis[vonis.length - 1] : null });
  });

  // Vonis pertama, koreksi, atau pemutihan = baris vonis BARU yang menggantikan vonis berlaku (rantai dijaga UNIQUE di database).
  on("POST", "/api/kedisiplinan/pelanggaran/:id/vonis", async ({ db, u, p, body }) => {
    wajib(u, "putusan_kedisiplinan");
    const pl = await db.prepare("SELECT p.*, s.nis, s.nama FROM pelanggaran p JOIN santri s ON s.id = p.santri_id WHERE p.id = ?").bind(p.id).first();
    if (!pl) gagal(404, "Pelanggaran tidak ditemukan.");
    cekLing(u, pl.lingkungan);
    if (pl.status === "dibatalkan") gagal(400, "Pelanggaran ini sudah dibatalkan.");
    if (pl.dicatat_oleh != null && pl.dicatat_oleh === u.id) gagal(403, "Pencatat tidak boleh memvonis atau memutihkan kasus yang ia catat sendiri.");
    const tv = await db.prepare("SELECT * FROM tingkat_vonis WHERE id = ? AND aktif = 1").bind(body.tingkat_vonis_id || 0).first();
    if (!tv) gagal(400, "Tingkat vonis tidak valid.");
    const [kiniR, kabarR] = await db.batch([
      db.prepare(`SELECT v.id, tv.adalah_pemutihan FROM vonis v JOIN tingkat_vonis tv ON tv.id = v.tingkat_vonis_id
                  WHERE v.pelanggaran_id = ? AND NOT EXISTS (SELECT 1 FROM vonis w WHERE w.menggantikan_vonis_id = v.id)`).bind(pl.id),
      // kabar vonis dalam rantai ini yang sudah dikirim ke wali dan belum diralat
      db.prepare(`SELECT DISTINCT e.id_terkait id FROM email_antrean e JOIN vonis v ON v.id = e.id_terkait
                  WHERE e.tabel_terkait = 'vonis' AND e.jenis = 'wali' AND e.koreksi_dari_id IS NULL AND v.pelanggaran_id = ?
                    AND NOT EXISTS (SELECT 1 FROM email_antrean c WHERE c.koreksi_dari_id = e.id)`).bind(pl.id),
    ]);
    const lama = kiniR.results[0] || null;
    const ganti = body.menggantikan_vonis_id ? +body.menggantikan_vonis_id : null;
    if ((lama ? lama.id : null) !== ganti) gagal(409, "Putusan kasus ini sudah berubah. Muat ulang lalu coba lagi.");
    if (lama && lama.adalah_pemutihan && tv.adalah_pemutihan) gagal(400, "Kasus ini sudah diputihkan.");
    const hukuman = tv.adalah_pemutihan ? null : bersih(body.hukuman, 300), alasan = bersih(body.alasan, 300);
    if (!tv.adalah_pemutihan && !hukuman) gagal(400, "Hukuman wajib diisi.");
    if ((lama || tv.adalah_pemutihan) && !alasan) gagal(400, "Alasan wajib diisi untuk pemutihan atau koreksi vonis.");
    const r = await db.batch([
      db.prepare("INSERT INTO vonis (pelanggaran_id, lingkungan, tingkat_vonis_id, hukuman, alasan, menggantikan_vonis_id, diputus_oleh) VALUES (?,?,?,?,?,?,?)")
        .bind(pl.id, pl.lingkungan, tv.id, hukuman, alasan, ganti, u.id),
      db.prepare("UPDATE pelanggaran SET status = 'divonis' WHERE id = ?").bind(pl.id),
      stmtCatat(db, u, "kesantrian", "putusan", "pelanggaran", pl.id, `Putusan kedisiplinan: ${pl.nis} ${pl.nama}`, pl.lingkungan),
    ]);
    const vid = r[0].meta.last_row_id;
    let kabar = 0, ralat = 0;
    const sudahDikabari = kabarR.results.map((x) => x.id);
    if (tv.kabar_wali && !tv.adalah_pemutihan && !sudahDikabari.length) kabar = await H.kabarWali(db, pl.santri_id, {
      subjek: "Keputusan kedisiplinan", tabel: "vonis", id: vid,
      isi: "Pondok telah menetapkan keputusan kedisiplinan untuk Ananda.",
    });
    if (tv.adalah_pemutihan) for (const id of sudahDikabari)
      ralat += await H.kabarKoreksi(db, "vonis", id, "keputusan kedisiplinan untuk Ananda yang sebelumnya dikabarkan telah dibatalkan (pemutihan).");
    return json({ ok: true, id: vid, kabar_wali: kabar, ralat_wali: ralat });
  });

  // ------------------------------------------------ hasil vonis (lihat_vonis: tanpa keterangan & isi hukuman)
  on("GET", "/api/kedisiplinan/hasil", async ({ db, u, url }) => {
    salahSatu(u, "lihat_vonis", "putusan_kedisiplinan");
    const q = (k) => url.searchParams.get(k) || "";
    const sampai = tglSah(q("sampai")) ? q("sampai") : hariIni();
    const dari = tglSah(q("dari")) ? q("dari") : new Date(Date.parse(sampai) - 30 * 864e5).toISOString().slice(0, 10);
    const l = lingIn(u, "p.lingkungan"), w = ["p.status = 'divonis'", "p.tanggal BETWEEN ? AND ?", l.sql], a = [dari, sampai, ...l.args];
    if (q("kategori_id")) { w.push("p.kategori_id = ?"); a.push(+q("kategori_id")); }
    if (q("tingkat_vonis_id")) { w.push("v.tingkat_vonis_id = ?"); a.push(+q("tingkat_vonis_id")); }
    const cari = q("q").trim();
    if (cari.length >= 2) { w.push("(s.nama LIKE ? OR s.nis LIKE ?)"); a.push(`%${cari}%`, `${cari}%`); }
    const r = await db.prepare(
      `SELECT p.id, p.santri_id, p.lingkungan, p.tanggal, kt.nama kategori, ${KOL_SANTRI}, tv.nama tingkat, tv.adalah_pemutihan, ${WIB("v.diputus_at")} diputus_wib
       FROM pelanggaran p ${SANTRI("p")} JOIN pilihan kt ON kt.id = p.kategori_id ${BERLAKU}
       WHERE ${w.join(" AND ")} ORDER BY p.tanggal DESC, p.id DESC LIMIT 500`).bind(...a).all();
    return json({ dari, sampai, daftar: r.results });
  });

  // Riwayat satu santri dengan rantai vonis. Pemutus melihat lengkap; pemegang lihat_vonis hanya kategori, tanggal, tingkat.
  on("GET", "/api/kedisiplinan/santri/:id", async ({ db, u, p }) => {
    salahSatu(u, "lihat_vonis", "putusan_kedisiplinan");
    const lengkap = boleh(u, "putusan_kedisiplinan");
    const s = await db.prepare(`SELECT s.id, s.lingkungan, ${KOL_SANTRI} FROM santri s LEFT JOIN kelas kl ON kl.id = s.kelas_id LEFT JOIN jenjang jj ON jj.id = kl.jenjang_id WHERE s.id = ?`).bind(p.id).first();
    if (!s) gagal(404, "Santri tidak ditemukan.");
    cekLing(u, s.lingkungan);
    const [pr, vr, sr] = await db.batch([
      db.prepare(`SELECT p.id, p.tanggal, p.status, p.sumber, p.keterangan, p.alasan_batal, kt.nama kategori, uc.nama pencatat FROM pelanggaran p JOIN pilihan kt ON kt.id = p.kategori_id
                  LEFT JOIN users uc ON uc.id = p.dicatat_oleh WHERE p.santri_id = ? ${lengkap ? "" : "AND p.status = 'divonis'"} ORDER BY p.tanggal DESC, p.id DESC LIMIT 300`).bind(s.id),
      db.prepare(`SELECT v.id, v.pelanggaran_id, v.hukuman, v.alasan, v.menggantikan_vonis_id, ${WIB("v.diputus_at")} diputus_wib, tv.nama tingkat, tv.adalah_pemutihan, ud.nama diputus_nama
                  FROM vonis v JOIN pelanggaran p ON p.id = v.pelanggaran_id JOIN tingkat_vonis tv ON tv.id = v.tingkat_vonis_id LEFT JOIN users ud ON ud.id = v.diputus_oleh
                  WHERE p.santri_id = ? ORDER BY v.id`).bind(s.id),
      db.prepare(`SELECT id, mulai, selesai, alasan, status, alasan_batal FROM skorsing WHERE santri_id = ? ORDER BY mulai DESC`).bind(s.id),
    ]);
    const rt = {};
    for (const v of vr.results) (rt[v.pelanggaran_id] ||= []).push(lengkap ? v : { id: v.id, tingkat: v.tingkat, adalah_pemutihan: v.adalah_pemutihan, diputus_wib: v.diputus_wib });
    const pel = pr.results.map((x) => {
      const o = lengkap ? x : { id: x.id, tanggal: x.tanggal, status: x.status, kategori: x.kategori };
      const ch = rt[x.id] || [];
      return { ...o, vonis: ch, berlaku: ch.length ? ch[ch.length - 1] : null };
    });
    return json({ santri: s, lengkap, pelanggaran: pel, skorsing: lengkap ? sr.results : [] });
  });

  // Daftar pelanggar hari ini (dibacakan Bagian Bahasa ba'da isya): nama, kelas, kategori saja. Tanpa keterangan.
  on("GET", "/api/kedisiplinan/pelanggar", async ({ db, u, url }) => {
    salahSatu(u, "input_pelanggaran", "putusan_kedisiplinan", "lihat_vonis");
    const tanggal = tglSah(url.searchParams.get("tanggal")) ? url.searchParams.get("tanggal") : hariIni();
    const pilih = url.searchParams.get("lingkungan");
    const l = u.ling.includes(pilih) ? { sql: "p.lingkungan = ?", args: [pilih] } : lingIn(u, "p.lingkungan");
    const r = await db.prepare(
      `SELECT p.id, p.lingkungan, s.nama, s.nis, s.foto_url, (kl.tingkat || ' ' || kl.rombel || ' ' || jj.nama || COALESCE(' ' || kl.label, '')) kelas, kt.nama kategori
       FROM pelanggaran p ${SANTRI("p")} JOIN pilihan kt ON kt.id = p.kategori_id ${BERLAKU}
       WHERE p.tanggal = ? AND p.status <> 'dibatalkan' AND COALESCE(tv.adalah_pemutihan, 0) = 0 AND ${l.sql}
       ORDER BY p.lingkungan, kl.tingkat, kl.rombel, s.nama`).bind(tanggal, ...l.args).all();
    return json({ tanggal, daftar: r.results });
  });

  // ------------------------------------------------ skorsing bertanggal (K-112)
  // Status santri mengikuti skorsing aktif yang mencakup hari ini; dikembalikan ke aktif bila tidak ada lagi.
  const SKORS_LAIN = "EXISTS (SELECT 1 FROM skorsing o WHERE o.santri_id = s.id AND o.status = 'aktif' AND o.id <> ? AND o.mulai <= ? AND o.selesai >= ?)";

  on("GET", "/api/kedisiplinan/skorsing", async ({ db, u, url }) => {
    wajib(u, "putusan_kedisiplinan");
    const l = lingIn(u, "sk.lingkungan"), riwayat = url.searchParams.get("riwayat") === "1";
    const r = await db.prepare(
      `SELECT sk.*, ${KOL_SANTRI}, uo.nama oleh_nama, ub.nama dibatalkan_nama FROM skorsing sk ${SANTRI("sk")}
       LEFT JOIN users uo ON uo.id = sk.oleh LEFT JOIN users ub ON ub.id = sk.dibatalkan_oleh
       WHERE ${l.sql} AND ${riwayat ? "sk.status <> 'aktif'" : "sk.status = 'aktif'"} ORDER BY sk.mulai ${riwayat ? "DESC" : ""} LIMIT 300`).bind(...l.args).all();
    const t = hariIni();
    return json(r.results.map((x) => ({ ...x, keadaan: x.status !== "aktif" ? x.status : x.mulai > t ? "terjadwal" : "berjalan" })));
  });

  on("POST", "/api/kedisiplinan/skorsing", async ({ db, u, body }) => {
    wajib(u, "putusan_kedisiplinan");
    const s = await db.prepare("SELECT id, nis, nama, status, lingkungan FROM santri WHERE id = ?").bind(body.santri_id || 0).first();
    if (!s) gagal(400, "Santri tidak ditemukan.");
    cekLing(u, s.lingkungan);
    if (!["aktif", "skorsing"].includes(s.status)) gagal(400, "Santri tidak berstatus aktif.");
    const mulai = String(body.mulai || ""), selesai = String(body.selesai || ""), t = hariIni();
    if (!tglSah(mulai) || !tglSah(selesai)) gagal(400, "Tanggal mulai dan selesai wajib diisi.");
    if (selesai < mulai) gagal(400, "Tanggal selesai harus sama atau setelah tanggal mulai.");
    if (selesai < t) gagal(400, "Tanggal selesai sudah lewat.");
    const alasan = bersih(body.alasan, 300);
    if (!alasan) gagal(400, "Alasan skorsing wajib diisi.");
    let plId = null;
    if (body.pelanggaran_id) {
      const pl = await db.prepare("SELECT id, santri_id, status, dicatat_oleh FROM pelanggaran WHERE id = ?").bind(body.pelanggaran_id).first();
      if (!pl || pl.santri_id !== s.id || pl.status === "dibatalkan") gagal(400, "Pelanggaran terkait tidak valid untuk santri ini.");
      if (pl.dicatat_oleh != null && pl.dicatat_oleh === u.id) gagal(403, "Pencatat tidak boleh memutus kasus yang ia catat sendiri.");
      plId = pl.id;
    }
    const tumpang = await db.prepare("SELECT id FROM skorsing WHERE santri_id = ? AND status = 'aktif' AND mulai <= ? AND selesai >= ?").bind(s.id, selesai, mulai).first();
    if (tumpang) gagal(409, "Santri ini sudah punya skorsing pada rentang tanggal tersebut.");
    const r = await db.prepare("INSERT INTO skorsing (santri_id, lingkungan, mulai, selesai, alasan, pelanggaran_id, oleh) VALUES (?,?,?,?,?,?,?)")
      .bind(s.id, s.lingkungan, mulai, selesai, alasan, plId, u.id).run();
    const st = [stmtCatat(db, u, "kesantrian", "skorsing", "skorsing", r.meta.last_row_id, `Skorsing dicatat: ${s.nis} ${s.nama}`, s.lingkungan)];
    if (mulai <= t) st.push(...stmtUbahStatus(db, u, s, "skorsing", "Skorsing"));
    await db.batch(st);
    return json({ ok: true, id: r.meta.last_row_id });
  });

  on("POST", "/api/kedisiplinan/skorsing/:id/batal", async ({ db, u, p, body }) => {
    wajib(u, "putusan_kedisiplinan");
    const t = hariIni();
    const sk = await db.prepare(`SELECT sk.*, s.nis, s.nama, s.status santri_status, ${SKORS_LAIN} lain FROM skorsing sk JOIN santri s ON s.id = sk.santri_id WHERE sk.id = ?`)
      .bind(p.id, t, t, p.id).first();
    if (!sk) gagal(404, "Skorsing tidak ditemukan.");
    cekLing(u, sk.lingkungan);
    const alasan = bersih(body.alasan, 200);
    if (!alasan) gagal(400, "Alasan pembatalan wajib diisi.");
    if (sk.status !== "aktif") gagal(400, "Skorsing ini sudah selesai atau dibatalkan.");
    const st = [
      db.prepare("UPDATE skorsing SET status = 'dibatalkan', dibatalkan_at = datetime('now'), dibatalkan_oleh = ?, alasan_batal = ? WHERE id = ?").bind(u.id, alasan, sk.id),
      stmtCatat(db, u, "kesantrian", "skorsing_batal", "skorsing", sk.id, `Skorsing dibatalkan: ${sk.nis} ${sk.nama}`, sk.lingkungan),
    ];
    if (sk.mulai <= t && sk.santri_status === "skorsing" && !sk.lain)
      st.push(...stmtUbahStatus(db, u, { id: sk.santri_id, status: "skorsing", lingkungan: sk.lingkungan }, "aktif", "Skorsing dibatalkan"));
    await db.batch(st);
    return json({ ok: true });
  });

  // Cron tiap 5 menit: mulai skorsing yang jatuh tempo, akhiri yang lewat tanggal selesai.
  H.berkala("skorsing", async (db) => {
    const t = hariIni();
    const [mR, aR] = await db.batch([
      db.prepare(`SELECT DISTINCT s.id, s.status, s.lingkungan FROM skorsing sk JOIN santri s ON s.id = sk.santri_id
                  WHERE sk.status = 'aktif' AND sk.mulai <= ? AND sk.selesai >= ? AND s.status = 'aktif' LIMIT 200`).bind(t, t),
      db.prepare(`SELECT sk.id, sk.santri_id, s.status, s.lingkungan, EXISTS (SELECT 1 FROM skorsing o WHERE o.santri_id = sk.santri_id AND o.status = 'aktif'
                    AND o.selesai >= ? AND o.mulai <= ?) lain
                  FROM skorsing sk JOIN santri s ON s.id = sk.santri_id WHERE sk.status = 'aktif' AND sk.selesai < ? LIMIT 200`).bind(t, t, t),
    ]);
    const st = [];
    for (const s of mR.results) st.push(...stmtUbahStatus(db, null, s, "skorsing", "Skorsing dimulai"),
      stmtCatat(db, null, "kesantrian", "skorsing_mulai", "santri", s.id, "Skorsing dimulai otomatis", s.lingkungan));
    const pulih = new Set();
    for (const x of aR.results) {
      st.push(db.prepare("UPDATE skorsing SET status = 'selesai' WHERE id = ? AND status = 'aktif'").bind(x.id));
      if (x.status === "skorsing" && !x.lain && !pulih.has(x.santri_id)) {
        pulih.add(x.santri_id);
        st.push(...stmtUbahStatus(db, null, { id: x.santri_id, status: "skorsing", lingkungan: x.lingkungan }, "aktif", "Skorsing selesai"),
          stmtCatat(db, null, "kesantrian", "skorsing_selesai", "santri", x.santri_id, "Skorsing selesai otomatis", x.lingkungan));
      }
    }
    if (st.length) await db.batch(st);
    return { mulai: mR.results.length, selesai: aR.results.length };
  });
}
