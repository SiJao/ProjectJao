// Modul komunikasi — antrean email, pengumuman ke kelompok, email ke wali tertentu, kelola Portal Wali (Moderator).
// Aturan isi email: kabar singkat tanpa data sensitif (diagnosa, isi vonis). Rahasia tidak pernah dikirim ke browser.
export default function (H) {
  const { on, json, gagal, wib, bersih, boleh, wajibModerator, lingIn, cekLing, catat, stmtCatat, stmtEmail } = H;
  const KAKI = () => `\n\n— HISADA, Pesantren Modern Daarul 'Uluum Lido`;
  const KAKI_WALI = () => `\n\nInformasi lain dapat dilihat di Portal Wali: ${H.APP()}/wali.html` + KAKI();
  const bolehUmumkan = (u) => u.role === "moderator" || boleh(u, "pengumuman");
  const lingTeks = (u) => (u.ling.length === 1 ? u.ling[0] : "semua");

  // ---------------------------------------------------------------- antrean email (Moderator)
  on("GET", "/api/komunikasi/antrean", async ({ db, u, url }) => {
    wajibModerator(u);
    const st = url.searchParams.get("status");
    const w = [], a = [];
    if (["antre", "terkirim", "gagal"].includes(st)) { w.push("status = ?"); a.push(st); }
    const q = (url.searchParams.get("q") || "").trim();
    if (q) { w.push("(penerima LIKE ? OR subjek LIKE ?)"); a.push(`%${q}%`, `%${q}%`); }
    const [daftar, hitung] = await db.batch([
      db.prepare(`SELECT id, penerima, subjek, isi, jenis, status, percobaan, galat, dibuat_at, dikirim_at, koreksi_dari_id FROM email_antrean
        ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY id DESC LIMIT 200`).bind(...a),
      db.prepare("SELECT status, COUNT(*) n FROM email_antrean GROUP BY status"),
    ]);
    // tautan verifikasi/reset password tidak ditampilkan utuh (mencegah pengambilalihan akun wali)
    for (const e of daftar.results) e.isi = String(e.isi).replace(/token=[0-9a-f]+/g, "token=••••••");
    return json({ daftar: daftar.results, hitung: Object.fromEntries(hitung.results.map((r) => [r.status, r.n])) });
  });

  on("POST", "/api/komunikasi/antrean/:id/ulang", async ({ db, u, p }) => {
    wajibModerator(u);
    const r = await db.prepare("UPDATE email_antrean SET status = 'antre', percobaan = 0, galat = NULL WHERE id = ? AND status = 'gagal'").bind(p.id).run();
    if (!r.meta.changes) gagal(400, "Hanya email berstatus gagal yang bisa dikirim ulang.");
    await catat(db, u, "komunikasi", "email_ulang", "email_antrean", +p.id, "Kirim ulang email gagal");
    return json({ ok: true });
  });

  on("POST", "/api/komunikasi/antrean/ulang-semua", async ({ db, u }) => {
    wajibModerator(u);
    const r = await db.prepare("UPDATE email_antrean SET status = 'antre', percobaan = 0, galat = NULL WHERE status = 'gagal'").run();
    if (r.meta.changes) await catat(db, u, "komunikasi", "email_ulang", "email_antrean", null, `Kirim ulang ${r.meta.changes} email gagal`);
    return json({ ok: true, jumlah: r.meta.changes });
  });

  on("POST", "/api/komunikasi/kirim", async ({ db, u }) => {
    wajibModerator(u);
    try { return json({ ok: true, ...(await H.kirimAntrean(H.env(), db)) }); }
    catch (e) { gagal(502, "Pengiriman gagal: " + String(e.message).slice(0, 200)); }
  });

  // Status konfigurasi: hanya ya/tidak — nilai rahasia tidak pernah dikirim.
  on("GET", "/api/komunikasi/konfigurasi", async ({ db, u, env }) => {
    wajibModerator(u);
    const modeUji = await H.pengaturan(db, "email.mode_uji", "1");
    const alamatUji = String(await H.pengaturan(db, "email.alamat_uji", "")).trim();
    return json({
      gmail_refresh_token: !!env.GMAIL_REFRESH_TOKEN, gmail_pengirim: !!env.GMAIL_PENGIRIM,
      google_client: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      mode_uji: modeUji === "1", alamat_uji: !!alamatUji,
    });
  });

  // ---------------------------------------------------------------- pengumuman ke kelompok (Sekretaris & Moderator)
  // Penerima selalu di lingkungan pengguna; dobel dibuang (satu email per akun wali / per alamat pengurus).
  async function penerima(db, u, body) {
    const l = lingIn(u, "s.lingkungan");
    const target = String(body.target || "");
    if (target === "pengurus") {
      return (await db.prepare(
        `SELECT MIN(us.id) id, LOWER(us.email) email, MIN(us.nama) nama, MIN(s.lingkungan) lingkungan FROM users us JOIN santri s ON s.id = us.santri_id
         WHERE us.status = 'aktif' AND s.status = 'aktif' AND us.email LIKE '%@%' AND ${l.sql} GROUP BY LOWER(us.email) ORDER BY nama`).bind(...l.args).all()).results;
    }
    const w = [l.sql], a = [...l.args];
    if (target === "wali_kelas") {
      const k = await db.prepare("SELECT lingkungan FROM kelas WHERE id = ?").bind(+body.kelas_id || 0).first();
      if (!k) gagal(400, "Pilih kelas.");
      cekLing(u, k.lingkungan);
      w.push("s.kelas_id = ?"); a.push(+body.kelas_id);
    } else if (target === "wali_kamar") {
      const k = await db.prepare("SELECT lingkungan FROM kamar WHERE id = ?").bind(+body.kamar_id || 0).first();
      if (!k) gagal(400, "Pilih kamar.");
      cekLing(u, k.lingkungan);
      w.push("s.kamar_id = ?"); a.push(+body.kamar_id);
    } else if (target !== "semua_wali") gagal(400, "Sasaran pengumuman tidak dikenal.");
    return (await db.prepare(
      `SELECT a.id, a.email, a.nama, MIN(s.lingkungan) lingkungan FROM akun_wali a JOIN tautan_wali t ON t.akun_wali_id = a.id AND t.dicabut_at IS NULL
       JOIN santri s ON s.id = t.santri_id AND s.status = 'aktif'
       WHERE a.status = 'aktif' AND ${w.join(" AND ")} GROUP BY a.id ORDER BY a.nama`).bind(...a).all()).results;
  }
  const LABEL_TARGET = { semua_wali: "semua wali", wali_kelas: "wali per kelas", wali_kamar: "wali per kamar", pengurus: "semua pengurus" };

  // Tanpa {konfirmasi:true} → pratinjau (jumlah + contoh); dengan konfirmasi → masuk antrean.
  on("POST", "/api/komunikasi/pengumuman", async ({ db, u, body }) => {
    if (!bolehUmumkan(u)) gagal(403, "Anda tidak punya akses untuk tindakan ini.");
    const daftar = await penerima(db, u, body);
    if (!body.konfirmasi) return json({ jumlah: daftar.length, contoh: daftar.slice(0, 5).map((r) => ({ nama: r.nama, email: r.email })) });
    const subjek = bersih(body.subjek, 150), isi = bersih(body.isi, 4000);
    if (!subjek || !isi) gagal(400, "Subjek dan isi pengumuman wajib diisi.");
    if (!daftar.length) gagal(400, "Tidak ada penerima untuk sasaran ini.");
    if (daftar.length > 3000) gagal(400, "Penerima terlalu banyak; persempit sasaran.");
    const wali = body.target !== "pengurus";
    const ling = lingTeks(u);
    const rw = await stmtCatat(db, u, "komunikasi", "pengumuman", "email_antrean", null,
      `Pengumuman "${subjek}" ke ${LABEL_TARGET[body.target]}: ${daftar.length} penerima`, ling).run();
    const rid = rw.meta.last_row_id;
    // satu pernyataan per 100 penerima (json_each), jauh di bawah batas query per permintaan
    const st = [];
    for (let i = 0; i < daftar.length; i += 100) {
      const blok = JSON.stringify(daftar.slice(i, i + 100).map((r) => ({ e: r.email, n: r.nama, a: wali ? r.id : null, l: r.lingkungan })));
      st.push(db.prepare(`INSERT INTO email_antrean (penerima, subjek, isi, jenis, tabel_terkait, id_terkait, akun_wali_id, lingkungan)
        SELECT json_extract(value,'$.e'), ?, 'Assalamu''alaikum ' || json_extract(value,'$.n') || ',' || char(10) || char(10) || ?, 'pengumuman', 'riwayat_perubahan', ?, json_extract(value,'$.a'), ?
        FROM json_each(?)`).bind("[HISADA] " + subjek, isi + (wali ? KAKI_WALI() : KAKI()), rid, ling, blok));
    }
    await db.batch(st);
    return json({ ok: true, jumlah: daftar.length, id: rid });
  });

  on("GET", "/api/komunikasi/pengumuman", async ({ db, u }) => {
    if (!bolehUmumkan(u)) gagal(403, "Anda tidak punya akses untuk tindakan ini.");
    const w = ["r.kategori = 'komunikasi'", "r.aksi = 'pengumuman'"], a = [];
    if (u.role !== "moderator") { w.push(`r.lingkungan IN (${H.tanda(u.ling.length)}, 'semua')`, "r.user_id = ?"); a.push(...u.ling, u.id); }
    const r = await db.prepare(
      `SELECT r.id, r.waktu, r.ringkasan, us.nama oleh,
              (SELECT SUM(e.status = 'terkirim') FROM email_antrean e WHERE e.tabel_terkait = 'riwayat_perubahan' AND e.id_terkait = r.id) terkirim,
              (SELECT SUM(e.status = 'gagal') FROM email_antrean e WHERE e.tabel_terkait = 'riwayat_perubahan' AND e.id_terkait = r.id) gagal,
              (SELECT SUM(e.status = 'antre') FROM email_antrean e WHERE e.tabel_terkait = 'riwayat_perubahan' AND e.id_terkait = r.id) antre
       FROM riwayat_perubahan r LEFT JOIN users us ON us.id = r.user_id WHERE ${w.join(" AND ")} ORDER BY r.id DESC LIMIT 50`).bind(...a).all();
    return json(r.results);
  });

  // ---------------------------------------------------------------- email ke wali tertentu (Moderator)
  const akunTertaut = (db, santriId) => db.prepare(
    `SELECT t.id tautan_id, t.cara, t.dibuat_at, a.id, a.nama, a.email, a.status, w.hubungan FROM tautan_wali t JOIN akun_wali a ON a.id = t.akun_wali_id
     LEFT JOIN wali w ON w.id = t.wali_id WHERE t.santri_id = ? AND t.dicabut_at IS NULL ORDER BY a.nama`).bind(santriId);

  on("GET", "/api/komunikasi/santri/:id/wali", async ({ db, u, p }) => {
    wajibModerator(u);
    const s = await db.prepare("SELECT id, nis, nama, lingkungan FROM santri WHERE id = ?").bind(p.id).first();
    if (!s) gagal(404, "Santri tidak ditemukan.");
    const [akun, wali] = await db.batch([
      akunTertaut(db, s.id),
      db.prepare("SELECT w.id, w.nama, w.hubungan, w.no_hp FROM wali w JOIN santri_wali sw ON sw.wali_id = w.id WHERE sw.santri_id = ? ORDER BY w.hubungan").bind(s.id),
    ]);
    return json({ santri: s, akun: akun.results, wali: wali.results });
  });

  on("POST", "/api/komunikasi/email-wali", async ({ db, u, body }) => {
    wajibModerator(u);
    const s = await db.prepare("SELECT id, nis, nama, lingkungan FROM santri WHERE id = ?").bind(+body.santri_id || 0).first();
    if (!s) gagal(400, "Pilih santri.");
    const subjek = bersih(body.subjek, 150), isi = bersih(body.isi, 4000);
    if (!subjek || !isi) gagal(400, "Subjek dan isi email wajib diisi.");
    let akun = (await akunTertaut(db, s.id).all()).results.filter((a) => a.status === "aktif");
    if (Array.isArray(body.akun_wali_ids) && body.akun_wali_ids.length) { const pilih = new Set(body.akun_wali_ids.map(Number)); akun = akun.filter((a) => pilih.has(a.id)); }
    if (!akun.length) gagal(400, "Santri ini belum punya akun wali aktif yang tertaut.");
    await db.batch([
      ...akun.map((a) => stmtEmail(db, { penerima: a.email, subjek: `[HISADA] ${subjek} — ${s.nama}`, isi: `Assalamu'alaikum ${a.nama},\n\n${isi}${KAKI_WALI()}`,
        jenis: "wali", tabel: "santri", id: s.id, akun_wali_id: a.id, lingkungan: s.lingkungan })),
      stmtCatat(db, u, "komunikasi", "email_wali", "santri", s.id, `Email "${subjek}" ke ${akun.length} wali ${s.nis}`, s.lingkungan),
    ]);
    return json({ ok: true, jumlah: akun.length });
  });

  // ---------------------------------------------------------------- Portal Wali: akun, tautan, no. HP wali (Moderator)
  on("GET", "/api/komunikasi/akun-wali", async ({ db, u, url }) => {
    wajibModerator(u);
    const w = [], a = [];
    const q = (url.searchParams.get("q") || "").trim(), st = url.searchParams.get("status");
    if (q) { w.push("(a.nama LIKE ? OR a.email LIKE ? OR a.no_hp_normal LIKE ?)"); a.push(`%${q}%`, `%${q}%`, `%${H.normalHp(q) || q}%`); }
    if (["belum_verifikasi", "aktif", "nonaktif"].includes(st)) { w.push("a.status = ?"); a.push(st); }
    const lim = Math.min(+url.searchParams.get("limit") || 100, 300);
    const r = await db.prepare(
      `SELECT a.id, a.nama, a.email, a.no_hp_normal, a.status, a.email_terverifikasi_at, a.terkunci_tautan_sampai, a.dibuat_at,
              (SELECT COUNT(*) FROM tautan_wali t WHERE t.akun_wali_id = a.id AND t.dicabut_at IS NULL) anak
       FROM akun_wali a ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY a.status = 'belum_verifikasi' DESC, a.id DESC LIMIT ?`).bind(...a, lim).all();
    return json(r.results);
  });

  // aksi: verifikasi (email belum bisa dikirim) · nonaktifkan · aktifkan · buka_kunci (penautan)
  on("POST", "/api/komunikasi/akun-wali/:id", async ({ db, u, p, body }) => {
    wajibModerator(u);
    const a = await db.prepare("SELECT * FROM akun_wali WHERE id = ?").bind(p.id).first();
    if (!a) gagal(404, "Akun wali tidak ditemukan.");
    const aksi = String(body.aksi || ""), t = wib(), st = [];
    if (aksi === "verifikasi") {
      if (a.status !== "belum_verifikasi") gagal(400, "Akun ini sudah terverifikasi.");
      st.push(db.prepare("UPDATE akun_wali SET status = 'aktif', email_terverifikasi_at = ? WHERE id = ?").bind(t, a.id));
    } else if (aksi === "nonaktifkan") {
      st.push(db.prepare("UPDATE akun_wali SET status = 'nonaktif' WHERE id = ?").bind(a.id), db.prepare("DELETE FROM sesi_wali WHERE akun_wali_id = ?").bind(a.id));
    } else if (aksi === "aktifkan") {
      st.push(db.prepare("UPDATE akun_wali SET status = CASE WHEN email_terverifikasi_at IS NULL THEN 'belum_verifikasi' ELSE 'aktif' END, gagal_login = 0, terkunci_sampai = NULL WHERE id = ?").bind(a.id));
    } else if (aksi === "buka_kunci") {
      st.push(db.prepare("UPDATE akun_wali SET terkunci_tautan_sampai = NULL, gagal_login = 0, terkunci_sampai = NULL WHERE id = ?").bind(a.id));
    } else gagal(400, "Aksi tidak dikenal.");
    st.push(stmtCatat(db, u, "akun", "wali_" + aksi, "akun_wali", a.id, `Akun wali ${a.email}: ${aksi}`));
    await db.batch(st);
    return json({ ok: true });
  });

  on("GET", "/api/komunikasi/tautan", async ({ db, u, url }) => {
    wajibModerator(u);
    const w = ["t.dicabut_at IS NULL"], a = [];
    const q = (url.searchParams.get("q") || "").trim();
    if (q) { w.push("(s.nama LIKE ? OR s.nis LIKE ? OR ak.nama LIKE ? OR ak.email LIKE ?)"); a.push(`%${q}%`, `${q}%`, `%${q}%`, `%${q}%`); }
    if (url.searchParams.get("akun_wali_id")) { w.push("t.akun_wali_id = ?"); a.push(+url.searchParams.get("akun_wali_id")); }
    if (["otomatis", "manual"].includes(url.searchParams.get("cara"))) { w.push("t.cara = ?"); a.push(url.searchParams.get("cara")); }
    const r = await db.prepare(
      `SELECT t.id, t.cara, t.dibuat_at, t.lingkungan, s.id santri_id, s.nis, s.nama santri, s.foto_url, ak.id akun_wali_id, ak.nama wali, ak.email, w.hubungan, uo.nama oleh
       FROM tautan_wali t JOIN santri s ON s.id = t.santri_id JOIN akun_wali ak ON ak.id = t.akun_wali_id
       LEFT JOIN wali w ON w.id = t.wali_id LEFT JOIN users uo ON uo.id = t.oleh
       WHERE ${w.join(" AND ")} ORDER BY t.id DESC LIMIT 200`).bind(...a).all();
    return json(r.results);
  });

  on("POST", "/api/komunikasi/tautan", async ({ db, u, body }) => {
    wajibModerator(u);
    const [a, s] = await Promise.all([
      db.prepare("SELECT * FROM akun_wali WHERE id = ?").bind(+body.akun_wali_id || 0).first(),
      db.prepare("SELECT id, nis, nama, lingkungan, status FROM santri WHERE id = ?").bind(+body.santri_id || 0).first(),
    ]);
    if (!a) gagal(400, "Pilih akun wali.");
    if (!s || s.status !== "aktif") gagal(400, "Santri tidak ditemukan atau tidak aktif.");
    if (a.status === "nonaktif") gagal(400, "Akun wali ini nonaktif.");
    let waliId = body.wali_id ? +body.wali_id : null;
    if (waliId && !(await db.prepare("SELECT 1 FROM santri_wali WHERE santri_id = ? AND wali_id = ?").bind(s.id, waliId).first())) gagal(400, "Data wali bukan milik santri ini.");
    const ada = await db.prepare("SELECT id FROM tautan_wali WHERE akun_wali_id = ? AND santri_id = ? AND dicabut_at IS NULL").bind(a.id, s.id).first();
    if (ada) gagal(409, "Akun ini sudah tertaut ke santri tersebut.");
    const r = await db.prepare("INSERT INTO tautan_wali (akun_wali_id, santri_id, lingkungan, wali_id, cara, oleh) VALUES (?,?,?,?, 'manual', ?)")
      .bind(a.id, s.id, s.lingkungan, waliId, u.id).run();
    await catat(db, u, "akun", "tautan_manual", "tautan_wali", r.meta.last_row_id, `Tautkan manual ${a.email} ↔ ${s.nis}`, s.lingkungan);
    return json({ ok: true, id: r.meta.last_row_id });
  });

  on("POST", "/api/komunikasi/tautan/:id/cabut", async ({ db, u, p }) => {
    wajibModerator(u);
    const t = await db.prepare("SELECT t.*, s.nis, a.email FROM tautan_wali t JOIN santri s ON s.id = t.santri_id JOIN akun_wali a ON a.id = t.akun_wali_id WHERE t.id = ?").bind(p.id).first();
    if (!t) gagal(404, "Tautan tidak ditemukan.");
    if (t.dicabut_at) gagal(409, "Tautan ini sudah dicabut.");
    await db.batch([
      db.prepare("UPDATE tautan_wali SET dicabut_at = ?, dicabut_oleh = ? WHERE id = ?").bind(wib(), u.id, t.id),
      stmtCatat(db, u, "akun", "tautan_cabut", "tautan_wali", t.id, `Cabut tautan ${t.email} ↔ ${t.nis}`, t.lingkungan),
    ]);
    return json({ ok: true });
  });

  // No. HP wali hanya diubah Moderator (kunci penautan Portal Wali).
  on("POST", "/api/komunikasi/wali/:id/hp", async ({ db, u, p, body }) => {
    wajibModerator(u);
    const w = await db.prepare("SELECT w.*, (SELECT s.nis FROM santri_wali sw JOIN santri s ON s.id = sw.santri_id WHERE sw.wali_id = w.id LIMIT 1) nis FROM wali w WHERE w.id = ?").bind(p.id).first();
    if (!w) gagal(404, "Data wali tidak ditemukan.");
    const hp = bersih(body.no_hp, 20), normal = H.normalHp(hp);
    if (hp && !/^62\d{8,13}$/.test(normal || "")) gagal(400, "No. HP tidak valid.");
    await db.batch([
      db.prepare("UPDATE wali SET no_hp = ?, no_hp_normal = ? WHERE id = ?").bind(hp, normal, w.id),
      stmtCatat(db, u, "data", "ubah_hp_wali", "wali", w.id, `No. HP ${w.hubungan} santri ${w.nis || "-"} diubah (…${(normal || "").slice(-4)})`),
    ]);
    return json({ ok: true, no_hp_normal: normal });
  });
}
