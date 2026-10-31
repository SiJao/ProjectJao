// Modul Update Data & Import (README "Update Data & Import"): Update Kelas Tahunan, Menunggu Penempatan, Batal Alumni,
// Update Kamar, Masa Khidmat & Serah Terima, Isi Bagian Pengurus, PAW, Akun Tertahan.
// Proses massal: data acuan dibaca sekali (satu db.batch baca), tulisan berbasis himpunan (json_each dengan satu
// parameter JSON) dalam SATU db.batch → atomik ("satu proses") dan jauh di bawah batas ±40 query per permintaan.
export default function (H) {
  const { on, json, gagal, hariIni, wib, bersih, boleh, wajibModerator, cekLing, cekSandi } = H;
  const NAMA_KELAS = "(k.tingkat || ' ' || k.rombel || ' ' || j.nama || COALESCE(' ' || k.label, ''))";
  const EMAIL = (nis) => `${nis}@daarululuumlido.com`;
  const teks = (x) => String(x ?? "").trim();
  const ID_JSON = "SELECT value FROM json_each(?)";
  const BATCH_INI = "(SELECT MAX(id) FROM impor_batch)"; // batch baru, dibaca di transaksi yang sama
  const ROLE_PENGURUS = ["piket", "kesehatan", "kedisiplinan", "sekretaris"];

  // Riwayat Perubahan dengan data_id dari subquery (mis. impor_batch yang baru dibuat di batch yang sama).
  const catatSql = (db, u, kategori, aksi, tabel, ringkasan, ling = "semua", dataIdSql = "NULL") => db.prepare(
    `INSERT INTO riwayat_perubahan (user_id, kategori, aksi, tabel, data_id, ringkasan, lingkungan, masa_khidmat_id)
     VALUES (?,?,?,?,${dataIdSql},?,?,(SELECT id FROM masa_khidmat WHERE status = 'aktif'))`).bind(u.id, kategori, aksi, tabel, ringkasan, ling);
  const perLing = (daftar) => ["putra", "putri"].map((l) => [l, daftar.filter((x) => x.lingkungan === l).length]).filter(([, n]) => n);

  // Galat UNIQUE impor_batch → pesan ramah (Update Kelas Tahunan sekali per tahun ajaran).
  async function jalankanBatch(db, st) {
    try { return await db.batch(st); } catch (e) {
      if (/UNIQUE/.test(String(e.message)) && /impor_batch/.test(String(e.message))) gagal(409, "Update Kelas Tahunan untuk tahun ajaran ini sudah pernah dijalankan.");
      throw e;
    }
  }

  // ------------------------------------------------------------ ringkasan halaman
  on("GET", "/api/updatedata/info", async ({ db, u }) => {
    const mod = u.role === "moderator";
    if (!mod && !boleh(u, "update_kamar") && !boleh(u, "paw") && !boleh(u, "isi_pengurus")) gagal(403, "Anda tidak punya akses untuk halaman ini.");
    const l = H.lingIn(u, "p.lingkungan");
    const [taR, mkR, jmlR, mnR, ttR] = await db.batch([
      db.prepare("SELECT * FROM tahun_ajaran ORDER BY nama DESC"),
      db.prepare("SELECT * FROM masa_khidmat ORDER BY id DESC LIMIT 20"),
      db.prepare(`SELECT COUNT(*) n FROM pengurus p WHERE p.selesai IS NULL AND ${l.sql}`).bind(...l.args),
      db.prepare("SELECT COUNT(*) n FROM santri WHERE menunggu_penempatan = 1 AND status = 'aktif'"),
      db.prepare(`SELECT COUNT(*) n FROM users u JOIN santri p ON p.id = u.santri_id WHERE u.status = 'tertahan' AND ${l.sql}`).bind(...l.args),
    ]);
    const masa = mkR.results.find((m) => m.status === "aktif") || null;
    return json({
      tahun_ajaran: taR.results, masa_khidmat: masa, masa_list: mod ? mkR.results : [],
      serah_terima_terakhir: masa ? masa.mulai : null, jumlah_pengurus: jmlR.results[0].n,
      menunggu: mod ? mnR.results[0].n : 0, tertahan: ttR.results[0].n,
    });
  });

  // ------------------------------------------------------------ 1. Update Kelas Tahunan (Moderator)
  // Aturan file penempatan (README): naik 1 tingkat; tingkat sama = boleh dengan peringatan; lompat/turun, NIS tidak ada,
  // santri tidak aktif, kelas tidak ada, NIS dobel → ditolak. "5B MIA" dibaca 5B (label diabaikan).
  async function periksaKelasTahunan(db, body) {
    const taId = +body.tahun_ajaran_id;
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 3000) : [];
    const nisList = [...new Set(rows.map((r) => teks(r.nis)).filter(Boolean))];
    const [taR, sudahR, klR, fileR, aktifR] = await db.batch([
      db.prepare("SELECT * FROM tahun_ajaran WHERE id = ?").bind(taId),
      db.prepare("SELECT id, waktu FROM impor_batch WHERE jenis = 'update_kelas_tahunan' AND tahun_ajaran_id = ? AND berlaku = 1").bind(taId),
      db.prepare(`SELECT k.id, k.tingkat, k.rombel, k.jenjang_id, k.lingkungan, k.aktif, ${NAMA_KELAS} nama FROM kelas k JOIN jenjang j ON j.id = k.jenjang_id`),
      db.prepare(`SELECT id, nis, nama, status, lingkungan, kelas_id, foto_url FROM santri WHERE nis IN (${ID_JSON})`).bind(JSON.stringify(nisList)),
      db.prepare("SELECT id, nis, nama, lingkungan, kelas_id, foto_url FROM santri WHERE status = 'aktif' ORDER BY nama"),
    ]);
    const ta = taR.results[0];
    if (!ta) gagal(400, "Pilih tahun ajaran tujuan.");
    if (sudahR.results.length) gagal(409, `Update Kelas Tahunan untuk tahun ajaran ${ta.nama} sudah pernah dijalankan (${sudahR.results[0].waktu}). Hanya sekali per tahun ajaran.`);
    if (ta.status !== "persiapan") gagal(400, `Tahun ajaran ${ta.nama} berstatus ${ta.status}. Buat tahun ajaran baru berstatus persiapan di Data Master.`);
    if (!rows.length) gagal(400, "File penempatan kosong.");

    const kelas = Object.fromEntries(klR.results.map((k) => [k.id, k]));
    const kelasAktif = klR.results.filter((k) => k.aktif);
    const jenjangId = Object.fromEntries((await db.prepare("SELECT id, nama FROM jenjang").all()).results.map((r) => [r.nama, r.id]));
    const santri = Object.fromEntries(fileR.results.map((s) => [s.nis, s]));
    const hitung = {};
    rows.forEach((r) => { const n = teks(r.nis); if (n) hitung[n] = (hitung[n] || 0) + 1; });
    const ringkas = (s) => ({ id: s.id, nis: s.nis, nama: s.nama, foto_url: s.foto_url, lingkungan: s.lingkungan, kelas_lama: kelas[s.kelas_id]?.nama || null });

    const naik = [], ditolak = [], diFile = new Set();
    rows.forEach((r, i) => {
      const baris = +r.baris || i + 1, nis = teks(r.nis), kt = teks(r.kelas);
      const tolak = (alasan, s) => ditolak.push({ baris, nis, nama: s?.nama || "", kelas: kt, alasan });
      if (nis) diFile.add(nis);
      if (!nis) return tolak("NIS kosong");
      if (hitung[nis] > 1) return tolak("NIS dobel di file");
      const s = santri[nis];
      if (!s) return tolak("NIS tidak ditemukan");
      if (s.status !== "aktif") return tolak(`Santri tidak aktif (${s.status})`, s);
      const kb = H.bacaKelas(kt);
      if (!kb) return tolak(kt ? "Format kelas tidak dikenal" : "Kelas kosong", s);
      // Kelas tujuan: rombel aktif, lingkungan sama dengan santri. Bila jenjang tidak ditulis, cocokkan tanpa jenjang asal tunggal.
      let cocok = kelasAktif.filter((k) => k.tingkat === kb.tingkat && k.rombel.toUpperCase() === kb.rombel.toUpperCase() && k.lingkungan === s.lingkungan);
      const tegas = cocok.filter((k) => k.jenjang_id === jenjangId[kb.jenjang]);
      if (tegas.length || /\b(MTs|SMP)\b/i.test(kt)) cocok = tegas;
      if (cocok.length !== 1) return tolak(`Kelas ${kt} tidak ada (rombel aktif ${s.lingkungan})`, s);
      const tujuan = cocok[0], lama = kelas[s.kelas_id];
      if (!lama) return tolak("Santri belum punya kelas sekarang", s);
      if (lama.tingkat === 6) return tolak("Santri Kelas 6 tidak dicantumkan di file (yang tidak lulus dicentang di pratinjau)", s);
      if (tujuan.tingkat === lama.tingkat + 1) naik.push({ ...ringkas(s), baris, kelas_baru_id: tujuan.id, kelas_baru: tujuan.nama, tinggal: false });
      else if (tujuan.tingkat === lama.tingkat) naik.push({ ...ringkas(s), baris, kelas_baru_id: tujuan.id, kelas_baru: tujuan.nama, tinggal: true });
      else tolak(tujuan.tingkat > lama.tingkat ? `Lompat tingkat (${lama.tingkat} → ${tujuan.tingkat})` : `Turun tingkat (${lama.tingkat} → ${tujuan.tingkat})`, s);
    });
    const alumni = [], ditahan = [];
    for (const s of aktifR.results) {
      if (diFile.has(s.nis)) continue;
      const k = kelas[s.kelas_id];
      if (k && k.tingkat === 6) alumni.push(ringkas(s));
      else ditahan.push(ringkas(s));
    }
    return { ta, rows, naik, alumni, ditahan, ditolak };
  }

  on("POST", "/api/updatedata/kelas-tahunan/pratinjau", async ({ db, u, body }) => {
    wajibModerator(u);
    const p = await periksaKelasTahunan(db, body);
    return json({ tahun_ajaran: p.ta, naik: p.naik, alumni: p.alumni, ditahan: p.ditahan, ditolak: p.ditolak });
  });

  on("POST", "/api/updatedata/kelas-tahunan/jalankan", async ({ db, u, body }) => {
    wajibModerator(u);
    await cekSandi(u, body.password);
    const p = await periksaKelasTahunan(db, body);
    if (p.ditolak.length) gagal(400, `${p.ditolak.length} baris ditolak. Perbaiki file lalu unggah ulang — tidak ada perubahan.`);
    const calon = Object.fromEntries(p.alumni.map((s) => [s.id, s]));
    const tidakLulus = [...new Set((Array.isArray(body.tidak_lulus) ? body.tidak_lulus : []).map(Number))];
    if (tidakLulus.some((id) => !calon[id])) gagal(400, "Pengecualian tidak lulus hanya untuk santri Kelas 6 aktif.");
    const tl = new Set(tidakLulus);
    const alumni = p.alumni.filter((s) => !tl.has(s.id));
    const tinggal6 = tidakLulus.map((id) => calon[id]);
    const kelasLama = Object.fromEntries((await db.prepare(`SELECT id, kelas_id FROM santri WHERE id IN (${ID_JSON})`).bind(JSON.stringify(tidakLulus)).all()).results.map((r) => [r.id, r.kelas_id]));
    const penempatan = [
      ...p.naik.map((s) => ({ id: s.id, k: s.kelas_baru_id, s: s.tinggal ? "tinggal_kelas" : "update_tahunan" })),
      ...tinggal6.map((s) => ({ id: s.id, k: kelasLama[s.id], s: "tinggal_kelas" })),
    ];
    // Ringkasan hanya NIS + baris + alasan (README impor_batch); baris mentah tidak disimpan.
    const ringkasan = JSON.stringify({
      naik: p.naik.filter((s) => !s.tinggal).length, tinggal_kelas: p.naik.filter((s) => s.tinggal).length + tinggal6.length,
      alumni: alumni.length, ditahan: p.ditahan.length,
      catatan: [...p.naik.filter((s) => s.tinggal).map((s) => ({ nis: s.nis, baris: s.baris, alasan: "Tidak naik kelas" })),
        ...tinggal6.map((s) => ({ nis: s.nis, baris: null, alasan: "Kelas 6 tidak lulus" })),
        ...p.ditahan.map((s) => ({ nis: s.nis, baris: null, alasan: "Tidak tercantum di file (menunggu penempatan)" }))],
    });
    const t = hariIni(), P = JSON.stringify(penempatan), A = JSON.stringify(alumni.map((s) => s.id)), D = JSON.stringify(p.ditahan.map((s) => s.id));
    const st = [
      db.prepare("INSERT INTO impor_batch (jenis, tahun_ajaran_id, nama_file, jumlah_baris, ditolak, ringkasan, status, oleh) VALUES ('update_kelas_tahunan',?,?,?,0,?,'dieksekusi',?)")
        .bind(p.ta.id, bersih(body.nama_file, 120), p.rows.length, ringkasan, u.id),
      // tahun lama diarsipkan dulu (UNIQUE penanda_aktif), lalu tahun baru aktif
      db.prepare("UPDATE tahun_ajaran SET status = 'arsip', selesai = ? WHERE status = 'aktif'").bind(t),
      db.prepare("UPDATE tahun_ajaran SET status = 'aktif', mulai = ?, selesai = NULL WHERE id = ? AND status = 'persiapan'").bind(t, p.ta.id),
      // naik / tinggal kelas (termasuk Kelas 6 tidak lulus)
      db.prepare(`UPDATE riwayat_kelas SET selesai = ? WHERE selesai IS NULL AND santri_id IN (SELECT json_extract(value, '$.id') FROM json_each(?))`).bind(t, P),
      db.prepare(`INSERT INTO riwayat_kelas (santri_id, kelas_id, tahun_ajaran_id, mulai, sebab, impor_batch_id, oleh)
        SELECT json_extract(value, '$.id'), json_extract(value, '$.k'), ?, ?, json_extract(value, '$.s'), ${BATCH_INI}, ? FROM json_each(?)`).bind(p.ta.id, t, u.id, P),
      db.prepare(`UPDATE santri SET kelas_id = j.k, menunggu_penempatan = 0, diubah_at = datetime('now')
        FROM (SELECT json_extract(value, '$.id') id, json_extract(value, '$.k') k FROM json_each(?)) j WHERE santri.id = j.id`).bind(P),
      // Kelas 6 → Alumni dengan efek penutupan yang sama seperti stmtUbahStatus (K-112), berbasis himpunan
      db.prepare(`INSERT INTO riwayat_status_santri (santri_id, lingkungan, status_lama, status_baru, alasan, impor_batch_id, oleh)
        SELECT id, lingkungan, status, 'alumni', 'Update Kelas Tahunan', ${BATCH_INI}, ? FROM santri WHERE status = 'aktif' AND id IN (${ID_JSON})`).bind(u.id, A),
      db.prepare(`UPDATE santri SET status = 'alumni', kamar_id = NULL, menunggu_penempatan = 0, diubah_at = datetime('now') WHERE id IN (${ID_JSON})`).bind(A),
      db.prepare(`UPDATE riwayat_kelas SET selesai = ? WHERE selesai IS NULL AND santri_id IN (${ID_JSON})`).bind(t, A),
      db.prepare(`UPDATE riwayat_kamar SET selesai = ? WHERE selesai IS NULL AND santri_id IN (${ID_JSON})`).bind(t, A),
      db.prepare(`UPDATE anggota_grup SET selesai = ? WHERE selesai IS NULL AND santri_id IN (${ID_JSON})`).bind(t, A),
      db.prepare(`UPDATE pengurus SET selesai = ?, sebab_selesai = 'status_santri' WHERE selesai IS NULL AND santri_id IN (${ID_JSON})`).bind(t, A),
      db.prepare(`DELETE FROM sesi_login WHERE user_id IN (SELECT id FROM users WHERE santri_id IN (${ID_JSON}))`).bind(A),
      db.prepare(`UPDATE users SET status = 'nonaktif' WHERE santri_id IN (${ID_JSON})`).bind(A),
      db.prepare(`UPDATE tautan_wali SET dicabut_at = ? WHERE dicabut_at IS NULL AND santri_id IN (${ID_JSON})`).bind(wib(), A),
      // tidak tercantum di file → ditahan (tetap di kelas lama, riwayat lama tetap terbuka)
      db.prepare(`UPDATE santri SET menunggu_penempatan = 1, diubah_at = datetime('now') WHERE id IN (${ID_JSON})`).bind(D),
    ];
    for (const ling of ["putra", "putri"]) {
      const n = (x) => x.filter((s) => s.lingkungan === ling).length;
      const nNaik = n(p.naik.filter((s) => !s.tinggal)), nTinggal = n(p.naik.filter((s) => s.tinggal)) + n(tinggal6), nAlumni = n(alumni), nTahan = n(p.ditahan);
      if (!(nNaik + nTinggal + nAlumni + nTahan)) continue;
      st.push(catatSql(db, u, "data", "update_kelas_tahunan", "impor_batch", `Update Kelas Tahunan ${p.ta.nama}: ${nNaik} naik, ${nTinggal} tinggal kelas, ${nAlumni} alumni, ${nTahan} menunggu penempatan`, ling, BATCH_INI));
      if (nAlumni) st.push(catatSql(db, u, "akun", "nonaktif_alumni", "users", `Akun login santri alumni dinonaktifkan (${nAlumni} santri)`, ling, BATCH_INI));
    }
    await jalankanBatch(db, st);
    return json({ ok: true, naik: p.naik.filter((s) => !s.tinggal).length, tinggal_kelas: p.naik.filter((s) => s.tinggal).length + tinggal6.length, alumni: alumni.length, ditahan: p.ditahan.length });
  });

  // ------------------------------------------------------------ 2. Menunggu penempatan (Moderator)
  on("GET", "/api/updatedata/menunggu", async ({ db, u }) => {
    wajibModerator(u);
    const r = await db.prepare(`SELECT s.id, s.nis, s.nama, s.foto_url, s.lingkungan, s.kelas_id, k.tingkat, ${NAMA_KELAS} kelas
      FROM santri s LEFT JOIN kelas k ON k.id = s.kelas_id LEFT JOIN jenjang j ON j.id = k.jenjang_id
      WHERE s.menunggu_penempatan = 1 AND s.status = 'aktif' ORDER BY s.lingkungan, k.tingkat, s.nama`).all();
    return json(r.results);
  });

  on("POST", "/api/updatedata/menunggu/:id", async ({ db, u, p, body }) => {
    wajibModerator(u);
    const s = await db.prepare("SELECT * FROM santri WHERE id = ?").bind(p.id).first();
    if (!s || !s.menunggu_penempatan || s.status !== "aktif") gagal(400, "Santri tidak sedang menunggu penempatan.");
    const ta = await H.taAktif(db), t = hariIni();
    const tempatkan = (kelasId, sebab) => [
      db.prepare("UPDATE riwayat_kelas SET selesai = ? WHERE santri_id = ? AND selesai IS NULL").bind(t, s.id),
      db.prepare("INSERT INTO riwayat_kelas (santri_id, kelas_id, tahun_ajaran_id, mulai, sebab, oleh) VALUES (?,?,?,?,?,?)").bind(s.id, kelasId, ta ? ta.id : null, t, sebab, u.id),
      db.prepare("UPDATE santri SET kelas_id = ?, menunggu_penempatan = 0, diubah_at = datetime('now') WHERE id = ?").bind(kelasId, s.id),
    ];
    let st, ringkas;
    if (body.aksi === "tempatkan") {
      const k = await db.prepare(`SELECT k.*, ${NAMA_KELAS} nama FROM kelas k JOIN jenjang j ON j.id = k.jenjang_id WHERE k.id = ?`).bind(+body.kelas_id).first();
      if (!k || !k.aktif) gagal(400, "Pilih kelas (rombel aktif).");
      if (k.lingkungan !== s.lingkungan) gagal(400, "Kelas tidak sesuai lingkungan santri.");
      st = tempatkan(k.id, "penempatan"); ringkas = `${s.nis} ${s.nama} ditempatkan ke ${k.nama}`;
    } else if (body.aksi === "tinggal") {
      if (!s.kelas_id) gagal(400, "Santri tidak punya kelas lama; gunakan Tempatkan.");
      st = tempatkan(s.kelas_id, "tinggal_kelas"); ringkas = `${s.nis} ${s.nama} tinggal kelas`;
    } else if (body.aksi === "status") {
      if (!H.TUTUP_STATUS.includes(body.status)) gagal(400, "Pilih status: alumni, mutasi keluar, atau meninggal.");
      const alasan = bersih(body.alasan, 200);
      if (!alasan) gagal(400, "Alasan perubahan status wajib diisi.");
      st = H.stmtUbahStatus(db, u, s, body.status, alasan); ringkas = `${s.nis} ${s.nama}: status ${s.status} → ${body.status}`;
    } else gagal(400, "Aksi tidak dikenal.");
    st.push(H.stmtCatat(db, u, "data", "penempatan", "santri", s.id, ringkas, s.lingkungan));
    await db.batch(st);
    return json({ ok: true });
  });

  // ------------------------------------------------------------ 3. Batal Alumni per santri (Moderator, alasan wajib)
  on("POST", "/api/updatedata/batal-alumni", async ({ db, u, body }) => {
    wajibModerator(u);
    const s = await db.prepare("SELECT * FROM santri WHERE id = ?").bind(+body.santri_id).first();
    if (!s || s.status !== "alumni") gagal(400, "Santri tidak berstatus alumni.");
    const alasan = bersih(body.alasan, 200);
    if (!alasan) gagal(400, "Alasan pembatalan alumni wajib diisi.");
    const akhir = await db.prepare("SELECT kelas_id FROM riwayat_kelas WHERE santri_id = ? ORDER BY mulai DESC, id DESC LIMIT 1").bind(s.id).first();
    const kelasId = (akhir && akhir.kelas_id) || s.kelas_id;
    const ta = await H.taAktif(db), t = hariIni();
    const st = [
      db.prepare("UPDATE santri SET status = 'aktif', kelas_id = ?, diubah_at = datetime('now') WHERE id = ?").bind(kelasId, s.id),
      db.prepare("INSERT INTO riwayat_status_santri (santri_id, lingkungan, status_lama, status_baru, alasan, oleh) VALUES (?,?,?,?,?,?)").bind(s.id, s.lingkungan, "alumni", "aktif", alasan, u.id),
      db.prepare("UPDATE riwayat_kelas SET selesai = ? WHERE santri_id = ? AND selesai IS NULL").bind(t, s.id),
    ];
    // Akun login tetap nonaktif sampai diaktifkan Moderator lewat Pengguna (README).
    if (kelasId) st.push(db.prepare("INSERT INTO riwayat_kelas (santri_id, kelas_id, tahun_ajaran_id, mulai, sebab, oleh) VALUES (?,?,?,?,'batal_alumni',?)").bind(s.id, kelasId, ta ? ta.id : null, t, u.id));
    st.push(H.stmtCatat(db, u, "data", "batal_alumni", "santri", s.id, `${s.nis} ${s.nama}: alumni dibatalkan — ${alasan}`, s.lingkungan));
    await db.batch(st);
    return json({ ok: true });
  });

  // ------------------------------------------------------------ 4. Update Kamar (Moderator / akses update_kamar, lingkungan sendiri)
  // Baris: { baris, nis, kamar } — kamar ditulis persis seperti nama di Data Master, mis. "Ibnu Rusyd-01".
  async function periksaKamar(db, u, body) {
    if (!boleh(u, "update_kamar")) gagal(403, "Anda tidak punya akses Update Kamar.");
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 3000) : [];
    if (!rows.length) gagal(400, "Tidak ada baris.");
    const nisList = [...new Set(rows.map((r) => teks(r.nis)).filter(Boolean))];
    const [sR, kR] = await db.batch([
      db.prepare(`SELECT s.id, s.nis, s.nama, s.status, s.lingkungan, s.kamar_id, s.foto_url, km.nama kamar FROM santri s LEFT JOIN kamar km ON km.id = s.kamar_id
        WHERE s.nis IN (${ID_JSON})`).bind(JSON.stringify(nisList)),
      db.prepare("SELECT id, nama, lingkungan, aktif FROM kamar"),
    ]);
    const santri = Object.fromEntries(sR.results.map((s) => [s.nis, s]));
    const kamar = Object.fromEntries(kR.results.map((k) => [k.nama.toLowerCase(), k]));
    const hitung = {};
    rows.forEach((r) => { const n = teks(r.nis); if (n) hitung[n] = (hitung[n] || 0) + 1; });
    const pindah = [], tetap = [], ditolak = [];
    rows.forEach((r, i) => {
      const baris = +r.baris || i + 1, nis = teks(r.nis), nk = teks(r.kamar).replace(/\s+/g, " ");
      const tolak = (alasan, s) => ditolak.push({ baris, nis, nama: s?.nama || "", kamar: nk, alasan });
      if (!nis) return tolak("NIS kosong");
      if (hitung[nis] > 1) return tolak("NIS dobel");
      const s = santri[nis];
      if (!s || !u.ling.includes(s.lingkungan)) return tolak("NIS tidak ditemukan di lingkungan Anda");
      if (!["aktif", "skorsing"].includes(s.status)) return tolak(`Santri tidak aktif (${s.status})`, s);
      const k = kamar[nk.toLowerCase()];
      if (!k || !k.aktif) return tolak(nk ? `Kamar "${nk}" tidak ada / nonaktif` : "Kamar kosong", s);
      if (k.lingkungan !== s.lingkungan) return tolak(`Kamar ${k.nama} untuk ${k.lingkungan}; santri ${s.lingkungan}`, s);
      const item = { baris, id: s.id, nis: s.nis, nama: s.nama, foto_url: s.foto_url, lingkungan: s.lingkungan, kamar_lama: s.kamar, kamar_baru: k.nama, kamar_id: k.id };
      (s.kamar_id === k.id ? tetap : pindah).push(item);
    });
    return { rows, pindah, tetap, ditolak };
  }

  on("POST", "/api/updatedata/kamar/pratinjau", async ({ db, u, body }) => {
    const p = await periksaKamar(db, u, body);
    return json({ pindah: p.pindah, tetap: p.tetap, ditolak: p.ditolak });
  });

  on("POST", "/api/updatedata/kamar/jalankan", async ({ db, u, body }) => {
    if (!boleh(u, "update_kamar")) gagal(403, "Anda tidak punya akses Update Kamar.");
    await cekSandi(u, body.password);
    const p = await periksaKamar(db, u, body);
    if (p.ditolak.length) gagal(400, `${p.ditolak.length} baris ditolak. Perbaiki dulu — tidak ada perubahan.`);
    if (!p.pindah.length) gagal(400, "Tidak ada santri yang berpindah kamar.");
    const t = hariIni(), P = JSON.stringify(p.pindah.map((s) => ({ id: s.id, k: s.kamar_id })));
    const st = [
      db.prepare("INSERT INTO impor_batch (jenis, nama_file, jumlah_baris, ditolak, ringkasan, status, oleh) VALUES ('update_kamar',?,?,0,?,'dieksekusi',?)")
        .bind(bersih(body.nama_file, 120), p.rows.length, JSON.stringify({ pindah: p.pindah.length, tetap: p.tetap.length }), u.id),
      db.prepare(`UPDATE riwayat_kamar SET selesai = ? WHERE selesai IS NULL AND santri_id IN (SELECT json_extract(value, '$.id') FROM json_each(?))`).bind(t, P),
      db.prepare(`INSERT INTO riwayat_kamar (santri_id, kamar_id, mulai, sebab, impor_batch_id, oleh)
        SELECT json_extract(value, '$.id'), json_extract(value, '$.k'), ?, 'pindah', ${BATCH_INI}, ? FROM json_each(?)`).bind(t, u.id, P),
      db.prepare(`UPDATE santri SET kamar_id = j.k, diubah_at = datetime('now')
        FROM (SELECT json_extract(value, '$.id') id, json_extract(value, '$.k') k FROM json_each(?)) j WHERE santri.id = j.id`).bind(P),
      ...perLing(p.pindah).map(([l, n]) => catatSql(db, u, "data", "update_kamar", "impor_batch", `Update Kamar: ${n} santri pindah kamar`, l, BATCH_INI)),
    ];
    await db.batch(st);
    return json({ ok: true, pindah: p.pindah.length, tetap: p.tetap.length });
  });

  // ------------------------------------------------------------ akun pengurus (satu santri): buat atau aktifkan lagi
  // Password sementara = NIS + tanggal lahir, wajib ganti. Tanpa tanggal lahir → tertahan (tanpa password).
  async function stmtAkun(db, s, lama, role) {
    const pw = H.passwordSementara(s.nis, s.tanggal_lahir);
    const hash = pw ? await H.hashPassword(pw) : null;
    if (lama) {
      const status = hash || lama.password_hash ? "aktif" : "tertahan";
      return { status, st: db.prepare(`UPDATE users SET role = ?, status = ?, password_hash = COALESCE(?, password_hash), wajib_ganti_password = CASE WHEN ? IS NULL THEN wajib_ganti_password ELSE 1 END,
        lingkungan = ?, gagal_login = 0, terkunci_sampai = NULL WHERE id = ?`).bind(role, status, hash, hash, s.lingkungan, lama.id) };
    }
    return { status: hash ? "aktif" : "tertahan", st: db.prepare("INSERT INTO users (email, password_hash, nama, role, santri_id, lingkungan, status, wajib_ganti_password) VALUES (?,?,?,?,?,?,?,1)")
      .bind(EMAIL(s.nis), hash, s.nama, role, s.id, s.lingkungan, hash ? "aktif" : "tertahan") };
  }
  // Santri + tingkat kelas + akun + jabatan aktif (untuk pemeriksaan calon pengurus).
  const SQL_CALON = `SELECT s.id, s.nis, s.nama, s.status, s.lingkungan, s.tanggal_lahir, s.foto_url, k.tingkat,
      u.id user_id, u.status user_status, u.password_hash, u.role, pg.id pengurus_id, jb.nama jabatan_aktif
    FROM santri s LEFT JOIN kelas k ON k.id = s.kelas_id LEFT JOIN users u ON u.santri_id = s.id
    LEFT JOIN pengurus pg ON pg.santri_id = s.id AND pg.selesai IS NULL LEFT JOIN jabatan jb ON jb.id = pg.jabatan_id`;
  const jabatanUntuk = (daftar, nama, ling) => {
    const c = daftar.filter((j) => j.aktif && j.nama.toLowerCase() === String(nama || "").trim().toLowerCase() && (j.lingkungan === "semua" || j.lingkungan === ling));
    return c.find((j) => j.lingkungan === ling) || c[0] || null;
  };

  // ------------------------------------------------------------ 5. Masa Khidmat & Serah Terima (Moderator)
  on("GET", "/api/updatedata/pengurus", async ({ db, u }) => {
    if (!boleh(u, "isi_pengurus") && !boleh(u, "paw")) gagal(403, "Anda tidak punya akses untuk data pengurus.");
    const l = H.lingIn(u, "p.lingkungan"), lj = H.lingIn(u, "lingkungan");
    const [pR, jR] = await db.batch([
      db.prepare(`SELECT p.id, p.santri_id, p.lingkungan, p.jabatan_id, p.mulai, jb.nama jabatan, s.nis, s.nama, s.foto_url, s.tanggal_lahir, k.tingkat,
          u.id user_id, u.status user_status, u.role
        FROM pengurus p JOIN santri s ON s.id = p.santri_id JOIN jabatan jb ON jb.id = p.jabatan_id
        LEFT JOIN kelas k ON k.id = s.kelas_id LEFT JOIN users u ON u.santri_id = s.id
        WHERE p.selesai IS NULL AND ${l.sql} ORDER BY p.lingkungan, jb.urutan, s.nama`).bind(...l.args),
      db.prepare(`SELECT * FROM jabatan WHERE lingkungan = 'semua' OR ${lj.sql} ORDER BY urutan, nama`).bind(...lj.args),
    ]);
    return json({ pengurus: pR.results, jabatan: jR.results });
  });

  on("POST", "/api/updatedata/masa-khidmat", async ({ db, u, body }) => {
    wajibModerator(u);
    const nama = bersih(body.nama, 80);
    if (!nama) gagal(400, "Nama masa khidmat wajib diisi.");
    if (await H.masaKhidmatAktif(db)) gagal(409, "Sudah ada masa khidmat aktif. Gunakan Serah Terima Jabatan untuk menggantinya.");
    const r = await db.prepare("INSERT INTO masa_khidmat (nama, mulai, status, dibuka_oleh) VALUES (?,?,'aktif',?)").bind(nama, hariIni(), u.id).run();
    await H.catat(db, u, "jabatan", "masa_khidmat_baru", "masa_khidmat", r.meta.last_row_id, `Masa khidmat pertama: ${nama}`);
    return json({ ok: true, id: r.meta.last_row_id });
  });

  on("POST", "/api/updatedata/serah-terima", async ({ db, u, body }) => {
    wajibModerator(u);
    const nama = bersih(body.nama, 80);
    if (!nama) gagal(400, "Nama masa khidmat baru wajib diisi.");
    const ids = [...new Set((Array.isArray(body.sekretaris) ? body.sekretaris : []).map(Number).filter(Boolean))];
    if (ids.length < 1 || ids.length > 2) gagal(400, "Pilih 1–2 Sekretaris baru.");
    await cekSandi(u, body.password);
    const [cR, jR, lamaR] = await db.batch([
      db.prepare(`${SQL_CALON} WHERE s.id IN (${ID_JSON})`).bind(JSON.stringify(ids)),
      db.prepare("SELECT * FROM jabatan"),
      db.prepare("SELECT COUNT(*) n FROM pengurus WHERE selesai IS NULL"),
    ]);
    if (cR.results.length !== ids.length) gagal(400, "Santri tidak ditemukan.");
    for (const s of cR.results) {
      if (s.status !== "aktif" || s.tingkat !== 5) gagal(400, `${s.nama}: Sekretaris harus santri aktif Kelas 5.`);
      if (!jabatanUntuk(jR.results, "Sekretaris", s.lingkungan)) gagal(400, `Jabatan "Sekretaris" (aktif) untuk ${s.lingkungan} belum ada di daftar jabatan.`);
    }
    const t = hariIni(), akun = [];
    const st = [
      // 1. arsipkan masa khidmat lama + semua jabatan; akun pengurus lama nonaktif (santrinya tetap aktif)
      db.prepare("UPDATE masa_khidmat SET status = 'arsip', selesai = ?, ditutup_oleh = ? WHERE status = 'aktif'").bind(t, u.id),
      db.prepare("DELETE FROM sesi_login WHERE user_id IN (SELECT u.id FROM users u JOIN pengurus p ON p.santri_id = u.santri_id WHERE p.selesai IS NULL)"),
      db.prepare("UPDATE users SET status = 'nonaktif' WHERE santri_id IN (SELECT santri_id FROM pengurus WHERE selesai IS NULL)"),
      db.prepare("UPDATE pengurus SET selesai = ?, sebab_selesai = 'serah_terima' WHERE selesai IS NULL").bind(t),
      // 2. masa khidmat baru (satu untuk putra & putri, K-97)
      db.prepare("INSERT INTO masa_khidmat (nama, mulai, status, dibuka_oleh) VALUES (?,?,'aktif',?)").bind(nama, t, u.id),
    ];
    // 3. Sekretaris baru: akun dibuat/diaktifkan lagi + baris pengurus
    for (const s of cR.results) {
      const a = await stmtAkun(db, s, s.user_id ? { id: s.user_id, password_hash: s.password_hash } : null, "sekretaris");
      akun.push({ nis: s.nis, nama: s.nama, status: a.status });
      st.push(a.st, db.prepare(`INSERT INTO pengurus (masa_khidmat_id, santri_id, lingkungan, jabatan_id, user_id, mulai, oleh)
        VALUES ((SELECT id FROM masa_khidmat WHERE status = 'aktif'), ?, ?, ?, (SELECT id FROM users WHERE santri_id = ?), ?, ?)`)
        .bind(s.id, s.lingkungan, jabatanUntuk(jR.results, "Sekretaris", s.lingkungan).id, s.id, t, u.id));
    }
    st.push(catatSql(db, u, "jabatan", "serah_terima", "masa_khidmat", `Serah Terima: masa khidmat ${nama}; ${lamaR.results[0].n} jabatan lama diarsipkan; Sekretaris baru ${akun.map((a) => a.nis).join(", ")}`, "semua", "(SELECT id FROM masa_khidmat WHERE status = 'aktif')"));
    st.push(catatSql(db, u, "akun", "serah_terima", "users", `Akun pengurus lama dinonaktifkan (${lamaR.results[0].n}); akun Sekretaris baru: ${akun.map((a) => a.nis + (a.status === "tertahan" ? " (tertahan)" : "")).join(", ")}`));
    await db.batch(st);
    return json({ ok: true, pengurus_lama: lamaR.results[0].n, sekretaris: akun });
  });

  // ------------------------------------------------------------ 6. Isi Bagian Pengurus (Sekretaris / Moderator)
  // Hanya santri aktif Kelas 5 di lingkungan pengisi. Satu baris tidak valid → SELURUH kiriman ditolak.
  async function periksaPengurus(db, u, body) {
    if (!boleh(u, "isi_pengurus")) gagal(403, "Anda tidak punya akses mengisi bagian pengurus.");
    const masa = await H.masaKhidmatAktif(db);
    if (!masa) gagal(400, "Belum ada masa khidmat aktif.");
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) gagal(400, "Tidak ada baris.");
    if (rows.length > 100) gagal(400, "Maksimal 100 baris per kiriman.");
    const nisList = [...new Set(rows.map((r) => teks(r.nis)).filter(Boolean))];
    const [cR, jR] = await db.batch([
      db.prepare(`${SQL_CALON} WHERE s.nis IN (${ID_JSON})`).bind(JSON.stringify(nisList)),
      db.prepare("SELECT * FROM jabatan"),
    ]);
    const santri = Object.fromEntries(cR.results.map((s) => [s.nis, s]));
    const hitung = {};
    rows.forEach((r) => { const n = teks(r.nis); if (n) hitung[n] = (hitung[n] || 0) + 1; });
    const siap = [], ditolak = [];
    rows.forEach((r, i) => {
      const baris = +r.baris || i + 1, nis = teks(r.nis), jn = teks(r.jabatan);
      const tolak = (alasan, s) => ditolak.push({ baris, nis, nama: s?.nama || "", jabatan: jn, alasan });
      if (!nis) return tolak("NIS kosong");
      if (hitung[nis] > 1) return tolak("NIS dobel");
      const s = santri[nis];
      if (!s || !u.ling.includes(s.lingkungan)) return tolak("NIS tidak ditemukan di lingkungan Anda");
      if (s.status !== "aktif") return tolak(`Santri tidak aktif (${s.status})`, s);
      if (s.tingkat !== 5) return tolak("Bukan santri Kelas 5", s);
      if (s.pengurus_id) return tolak(`Sudah memegang jabatan ${s.jabatan_aktif}`, s);
      const j = jabatanUntuk(jR.results, jn, s.lingkungan);
      if (!j) return tolak(jn ? `Jabatan "${jn}" tidak ada / nonaktif` : "Jabatan kosong", s);
      siap.push({ baris, santri_id: s.id, nis: s.nis, nama: s.nama, foto_url: s.foto_url, lingkungan: s.lingkungan, tanggal_lahir: s.tanggal_lahir,
        jabatan_id: j.id, jabatan: j.nama, akun: s.user_id ? "aktifkan" : "baru", tertahan: !s.tanggal_lahir && !s.password_hash });
    });
    return { masa, siap, ditolak };
  }

  on("POST", "/api/updatedata/pengurus/pratinjau", async ({ db, u, body }) => {
    const p = await periksaPengurus(db, u, body);
    return json({ siap: p.siap.map(({ tanggal_lahir, ...x }) => x), ditolak: p.ditolak });
  });

  on("POST", "/api/updatedata/pengurus", async ({ db, u, body }) => {
    const p = await periksaPengurus(db, u, body);
    if (p.ditolak.length) return json({ galat: `${p.ditolak.length} baris tidak valid — seluruh kiriman ditolak. Perbaiki lalu kirim ulang.`, ditolak: p.ditolak }, 400);
    const t = hariIni();
    // Akun: hash password sementara per santri (di Worker), ditulis berbasis himpunan.
    const data = [];
    for (const s of p.siap) {
      const pw = H.passwordSementara(s.nis, s.tanggal_lahir);
      data.push({ id: s.santri_id, j: s.jabatan_id, l: s.lingkungan, e: EMAIL(s.nis), n: s.nama, h: pw ? await H.hashPassword(pw) : null });
    }
    const J = JSON.stringify(data);
    const DATA = `SELECT json_extract(value, '$.id') id, json_extract(value, '$.j') j, json_extract(value, '$.l') l, json_extract(value, '$.e') e, json_extract(value, '$.n') n, json_extract(value, '$.h') h FROM json_each(?)`;
    const st = [
      // akun lama santri diaktifkan lagi (role kembali "menunggu role" bila sebelumnya tidak aktif)
      db.prepare(`UPDATE users SET role = CASE WHEN users.status = 'aktif' THEN users.role ELSE NULL END,
          status = CASE WHEN COALESCE(j.h, users.password_hash) IS NULL THEN 'tertahan' ELSE 'aktif' END,
          password_hash = COALESCE(j.h, users.password_hash), wajib_ganti_password = CASE WHEN j.h IS NULL THEN users.wajib_ganti_password ELSE 1 END,
          lingkungan = j.l, gagal_login = 0, terkunci_sampai = NULL
        FROM (${DATA}) j WHERE users.santri_id = j.id`).bind(J),
      db.prepare(`INSERT INTO users (email, password_hash, nama, role, santri_id, lingkungan, status, wajib_ganti_password)
        SELECT j.e, j.h, j.n, NULL, j.id, j.l, CASE WHEN j.h IS NULL THEN 'tertahan' ELSE 'aktif' END, 1 FROM (${DATA}) j
        WHERE NOT EXISTS (SELECT 1 FROM users x WHERE x.santri_id = j.id)`).bind(J),
      db.prepare(`INSERT INTO pengurus (masa_khidmat_id, santri_id, lingkungan, jabatan_id, user_id, mulai, oleh)
        SELECT ?, j.id, j.l, j.j, (SELECT x.id FROM users x WHERE x.santri_id = j.id), ?, ? FROM (${DATA}) j`).bind(p.masa.id, t, u.id, J),
    ];
    for (const [l, n] of perLing(p.siap)) {
      const di = p.siap.filter((s) => s.lingkungan === l);
      st.push(catatSql(db, u, "jabatan", "isi_pengurus", "pengurus", `${n} pengurus diisi: ${di.map((s) => s.nis + " " + s.jabatan).join("; ")}`.slice(0, 900), l));
      st.push(catatSql(db, u, "akun", "akun_pengurus", "users", `${n} akun pengurus dibuat/diaktifkan (menunggu role)${di.some((s) => s.tertahan) ? "; tertahan: " + di.filter((s) => s.tertahan).map((s) => s.nis).join(", ") : ""}`.slice(0, 900), l));
    }
    await db.batch(st);
    return json({ ok: true, jumlah: p.siap.length, tertahan: p.siap.filter((s) => s.tertahan).length });
  });

  // Master jabatan (Moderator): tambah, nonaktifkan / aktifkan.
  on("POST", "/api/updatedata/jabatan", async ({ db, u, body }) => {
    wajibModerator(u);
    if (body.id) {
      const j = await db.prepare("SELECT * FROM jabatan WHERE id = ?").bind(+body.id).first();
      if (!j) gagal(404, "Jabatan tidak ditemukan.");
      const aktif = body.aktif ? 1 : 0;
      await db.prepare("UPDATE jabatan SET aktif = ? WHERE id = ?").bind(aktif, j.id).run();
      await H.catat(db, u, "jabatan", aktif ? "aktifkan_jabatan" : "nonaktifkan_jabatan", "jabatan", j.id, j.nama, j.lingkungan);
      return json({ ok: true });
    }
    const nama = bersih(body.nama, 80);
    const ling = ["putra", "putri", "semua"].includes(body.lingkungan) ? body.lingkungan : "semua";
    if (!nama) gagal(400, "Nama jabatan wajib diisi.");
    const urut = await db.prepare("SELECT COALESCE(MAX(urutan),0)+1 n FROM jabatan").first();
    const r = await db.prepare("INSERT INTO jabatan (nama, lingkungan, urutan) VALUES (?,?,?)").bind(nama, ling, urut.n).run();
    await H.catat(db, u, "jabatan", "tambah_jabatan", "jabatan", r.meta.last_row_id, nama, ling);
    return json({ ok: true, id: r.meta.last_row_id });
  });

  // ------------------------------------------------------------ 7. PAW (Moderator / akses paw)
  on("POST", "/api/updatedata/paw", async ({ db, u, body }) => {
    if (!boleh(u, "paw")) gagal(403, "Anda tidak punya akses PAW.");
    const alasan = bersih(body.alasan, 200);
    if (!alasan) gagal(400, "Alasan PAW wajib diisi.");
    const role = body.role ? String(body.role) : null;
    if (role && u.role !== "moderator") gagal(403, "Hanya Moderator yang menetapkan role.");
    if (role && !ROLE_PENGURUS.includes(role)) gagal(400, "Role tidak valid untuk pengurus.");
    await cekSandi(u, body.password);
    const lama = await db.prepare(`SELECT p.*, s.nis, s.nama, jb.nama jabatan FROM pengurus p JOIN santri s ON s.id = p.santri_id JOIN jabatan jb ON jb.id = p.jabatan_id WHERE p.id = ?`).bind(+body.pengurus_id).first();
    if (!lama || lama.selesai) gagal(400, "Jabatan aktif tidak ditemukan.");
    cekLing(u, lama.lingkungan);
    const t = hariIni();
    const st = [
      db.prepare("UPDATE pengurus SET selesai = ?, sebab_selesai = 'paw', alasan_paw = ? WHERE id = ? AND selesai IS NULL").bind(t, alasan, lama.id),
      db.prepare("DELETE FROM sesi_login WHERE user_id IN (SELECT id FROM users WHERE santri_id = ?)").bind(lama.santri_id),
      db.prepare("UPDATE users SET status = 'nonaktif' WHERE santri_id = ?").bind(lama.santri_id),
    ];
    let ganti = null;
    if (body.santri_id) {
      const s = await db.prepare(`${SQL_CALON} WHERE s.id = ?`).bind(+body.santri_id).first();
      if (!s) gagal(400, "Santri pengganti tidak ditemukan.");
      cekLing(u, s.lingkungan);
      if (s.id === lama.santri_id) gagal(400, "Pengganti tidak boleh orang yang sama.");
      if (s.lingkungan !== lama.lingkungan) gagal(400, "Pengganti harus dari lingkungan yang sama.");
      if (s.status !== "aktif" || ![5, 6].includes(s.tingkat)) gagal(400, "Pengganti harus santri aktif Kelas 5 atau 6.");
      if (s.pengurus_id) gagal(400, `${s.nama} sudah memegang jabatan ${s.jabatan_aktif}.`);
      const a = await stmtAkun(db, s, s.user_id ? { id: s.user_id, password_hash: s.password_hash } : null, role);
      ganti = { nis: s.nis, nama: s.nama, status: a.status };
      st.push(a.st, db.prepare(`INSERT INTO pengurus (masa_khidmat_id, santri_id, lingkungan, jabatan_id, user_id, mulai, oleh)
        VALUES (?, ?, ?, ?, (SELECT id FROM users WHERE santri_id = ?), ?, ?)`).bind(lama.masa_khidmat_id, s.id, s.lingkungan, lama.jabatan_id, s.id, t, u.id));
    }
    st.push(H.stmtCatat(db, u, "jabatan", "paw", "pengurus", lama.id, `PAW ${lama.jabatan}: ${lama.nis} ${lama.nama} diganti${ganti ? " " + ganti.nis + " " + ganti.nama : " (belum ada pengganti)"} — ${alasan}`, lama.lingkungan));
    st.push(H.stmtCatat(db, u, "akun", "paw", "users", null, `Akun ${lama.nis} nonaktif${ganti ? `; akun ${ganti.nis} ${ganti.status}${role ? " role " + role : " (menunggu role)"}` : ""}`, lama.lingkungan));
    await db.batch(st);
    return json({ ok: true, pengganti: ganti });
  });

  // ------------------------------------------------------------ 8. Akun tertahan (Sekretaris & Moderator)
  on("GET", "/api/updatedata/akun-tertahan", async ({ db, u }) => {
    if (!boleh(u, "isi_pengurus")) gagal(403, "Anda tidak punya akses.");
    const l = H.lingIn(u, "s.lingkungan");
    const r = await db.prepare(`SELECT u.id, u.email, u.role, s.id santri_id, s.nis, s.nama, s.foto_url, s.lingkungan, s.tanggal_lahir, jb.nama jabatan
      FROM users u JOIN santri s ON s.id = u.santri_id LEFT JOIN pengurus p ON p.santri_id = s.id AND p.selesai IS NULL LEFT JOIN jabatan jb ON jb.id = p.jabatan_id
      WHERE u.status = 'tertahan' AND ${l.sql} ORDER BY s.lingkungan, s.nama`).bind(...l.args).all();
    return json(r.results);
  });

  // Akun tertahan yang tanggal lahirnya sudah dilengkapi (Data Master) → diaktifkan dengan password sementara.
  on("POST", "/api/updatedata/akun-tertahan/aktifkan", async ({ db, u }) => {
    if (!boleh(u, "isi_pengurus")) gagal(403, "Anda tidak punya akses.");
    const l = H.lingIn(u, "s.lingkungan");
    const r = (await db.prepare(`SELECT u.id, s.nis, s.tanggal_lahir, s.lingkungan FROM users u JOIN santri s ON s.id = u.santri_id
      WHERE u.status = 'tertahan' AND s.status = 'aktif' AND s.tanggal_lahir IS NOT NULL AND ${l.sql} LIMIT 30`).bind(...l.args).all()).results;
    if (!r.length) return json({ ok: true, jumlah: 0 });
    const data = [];
    for (const x of r) data.push({ id: x.id, h: await H.hashPassword(H.passwordSementara(x.nis, x.tanggal_lahir)) });
    await db.batch([
      db.prepare(`UPDATE users SET status = 'aktif', password_hash = j.h, wajib_ganti_password = 1
        FROM (SELECT json_extract(value, '$.id') id, json_extract(value, '$.h') h FROM json_each(?)) j WHERE users.id = j.id AND users.status = 'tertahan'`).bind(JSON.stringify(data)),
      ...perLing(r).map(([lg, n]) => catatSql(db, u, "akun", "aktifkan_tertahan", "users", `${n} akun tertahan diaktifkan: ${r.filter((x) => x.lingkungan === lg).map((x) => x.nis).join(", ")}`.slice(0, 900), lg)),
    ]);
    return json({ ok: true, jumlah: r.length });
  });
}
