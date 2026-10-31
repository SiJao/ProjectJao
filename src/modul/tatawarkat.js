// Modul Tata Warkat — Kalender Akademik, Korespondensi, Inventaris Barang (README "Tata Warkat").
// Semua tabel dipisah per lingkungan (K-88). Lihat kalender: semua yang login; ubah & modul lain: akses tata_warkat.
export default function (H) {
  const { on, json, gagal, bersih, wajib, lingIn, cekLing, catat } = H;
  const TGL = /^\d{4}-\d{2}-\d{2}$/;
  const tglSah = (s) => TGL.test(s) && !isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
  const LAMPIRAN = /^https:\/\/(docs|drive)\.google\.com\/[^\s"'<>]{0,480}$/;
  const KONDISI = ["bagus", "rusak_ringan", "rusak_berat", "hilang"];

  // Lingkungan baris baru: pengguna satu lingkungan → miliknya; lingkungan 'semua' → wajib memilih putra/putri.
  const lingBaru = (u, ling) => {
    if (u.ling.length === 1) return u.ling[0];
    if (!["putra", "putri"].includes(ling)) gagal(400, "Pilih lingkungan putra atau putri.");
    return ling;
  };
  const cari = (q) => `%${String(q).trim().replace(/[\\%_]/g, (c) => "\\" + c)}%`;

  // ---------------------------------------------------------------- Kalender Akademik
  on("GET", "/api/agenda", async ({ db, u, url }) => {
    const dari = url.searchParams.get("dari") || "", sampai = url.searchParams.get("sampai") || "";
    if (!tglSah(dari) || !tglSah(sampai) || sampai < dari) gagal(400, "Rentang tanggal tidak valid.");
    if (Date.parse(sampai) - Date.parse(dari) > 1100 * 864e5) gagal(400, "Rentang tanggal terlalu panjang.");
    const l = lingIn(u, "a.lingkungan"), w = [l.sql, "a.mulai <= ?", "a.selesai >= ?"], a = [...l.args, sampai, dari];
    const q = (url.searchParams.get("q") || "").trim();
    if (q.length >= 2) { w.push("a.judul LIKE ? ESCAPE '\\'"); a.push(cari(q)); }
    const kat = url.searchParams.get("kategori");
    if (["umum", "akademik", "pengasuhan"].includes(kat)) w.push(`a.kategori_${kat} = 1`);
    const r = await db.prepare(
      `SELECT a.id, a.lingkungan, a.judul, a.mulai, a.selesai, a.kategori_umum, a.kategori_akademik, a.kategori_pengasuhan, a.keterangan, us.nama dibuat_oleh_nama
       FROM agenda a LEFT JOIN users us ON us.id = a.dibuat_oleh WHERE ${w.join(" AND ")} ORDER BY a.mulai, a.id LIMIT 2000`).bind(...a).all();
    const mk = await H.masaKhidmatAktif(db);
    return json({ agenda: r.results, masa_khidmat: mk ? { id: mk.id, nama: mk.nama, mulai: mk.mulai, selesai: mk.selesai } : null });
  });

  on("POST", "/api/agenda", async ({ db, u, body }) => {
    wajib(u, "tata_warkat");
    const judul = bersih(body.judul, 150), ket = bersih(body.keterangan, 1000);
    const mulai = String(body.mulai || ""), selesai = String(body.selesai || "") || mulai;
    if (!judul) gagal(400, "Judul agenda wajib diisi.");
    if (!tglSah(mulai) || !tglSah(selesai)) gagal(400, "Tanggal mulai/selesai tidak valid.");
    if (selesai < mulai) gagal(400, "Tanggal selesai tidak boleh sebelum tanggal mulai.");
    const k = ["umum", "akademik", "pengasuhan"].map((x) => (body["kategori_" + x] ? 1 : 0));
    if (k[0] + k[1] + k[2] < 1) gagal(400, "Pilih minimal satu kategori (Umum / Akademik / Pengasuhan).");
    let id = body.id ? +body.id : null, ling;
    if (id) {
      const lama = await db.prepare("SELECT id, lingkungan FROM agenda WHERE id = ?").bind(id).first();
      if (!lama) gagal(404, "Agenda tidak ditemukan.");
      cekLing(u, lama.lingkungan);
      ling = body.lingkungan ? lingBaru(u, body.lingkungan) : lama.lingkungan;
      await db.prepare("UPDATE agenda SET lingkungan = ?, judul = ?, mulai = ?, selesai = ?, kategori_umum = ?, kategori_akademik = ?, kategori_pengasuhan = ?, keterangan = ? WHERE id = ?")
        .bind(ling, judul, mulai, selesai, ...k, ket, id).run();
    } else {
      ling = lingBaru(u, body.lingkungan);
      id = (await db.prepare("INSERT INTO agenda (lingkungan, judul, mulai, selesai, kategori_umum, kategori_akademik, kategori_pengasuhan, keterangan, dibuat_oleh) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(ling, judul, mulai, selesai, ...k, ket, u.id).run()).meta.last_row_id;
    }
    await catat(db, u, "data", body.id ? "ubah" : "tambah", "agenda", id, `Agenda: ${judul} (${mulai}${selesai !== mulai ? " s.d. " + selesai : ""})`, ling);
    return json({ ok: true, id });
  });

  on("POST", "/api/agenda/:id/hapus", async ({ db, u, p }) => {
    wajib(u, "tata_warkat");
    const a = await db.prepare("SELECT id, lingkungan, judul, mulai FROM agenda WHERE id = ?").bind(+p.id).first();
    if (!a) gagal(404, "Agenda tidak ditemukan.");
    cekLing(u, a.lingkungan);
    await db.batch([
      db.prepare("DELETE FROM agenda WHERE id = ?").bind(a.id),
      H.stmtCatat(db, u, "data", "hapus", "agenda", a.id, `Agenda dihapus: ${a.judul} (${a.mulai})`, a.lingkungan),
    ]);
    return json({ ok: true });
  });

  // ---------------------------------------------------------------- Korespondensi
  on("GET", "/api/surat", async ({ db, u, url }) => {
    wajib(u, "tata_warkat");
    const sp = url.searchParams, l = lingIn(u, "s.lingkungan"), w = [l.sql], a = [...l.args];
    if (["keluar", "masuk"].includes(sp.get("arah"))) { w.push("s.arah = ?"); a.push(sp.get("arah")); }
    if (tglSah(sp.get("dari") || "")) { w.push("s.tanggal >= ?"); a.push(sp.get("dari")); }
    if (tglSah(sp.get("sampai") || "")) { w.push("s.tanggal <= ?"); a.push(sp.get("sampai")); }
    const disp = (sp.get("disposisi") || "").trim();
    if (disp === "-") w.push("s.arah = 'masuk' AND COALESCE(s.status_disposisi, '') = ''");
    else if (disp) { w.push("s.status_disposisi = ?"); a.push(disp); }
    const q = (sp.get("q") || "").trim();
    if (q.length >= 2) { w.push("(s.nomor LIKE ? ESCAPE '\\' OR s.perihal LIKE ? ESCAPE '\\' OR s.pihak LIKE ? ESCAPE '\\')"); a.push(cari(q), cari(q), cari(q)); }
    const batas = Math.min(Math.max(+sp.get("batas") || 500, 1), 2000);
    const r = await db.prepare(
      `SELECT s.*, us.nama dicatat_oleh_nama FROM surat s LEFT JOIN users us ON us.id = s.dicatat_oleh
       WHERE ${w.join(" AND ")} ORDER BY s.tanggal DESC, s.id DESC LIMIT ?`).bind(...a, batas).all();
    return json(r.results);
  });

  on("POST", "/api/surat", async ({ db, u, body }) => {
    wajib(u, "tata_warkat");
    const arah = body.arah;
    if (!["keluar", "masuk"].includes(arah)) gagal(400, "Pilih surat keluar atau surat masuk.");
    const d = { nomor: bersih(body.nomor, 80), tanggal: String(body.tanggal || ""), perihal: bersih(body.perihal, 200), pihak: bersih(body.pihak, 150) };
    if (!d.nomor) gagal(400, "Nomor surat wajib diisi.");
    if (!tglSah(d.tanggal)) gagal(400, "Tanggal surat tidak valid.");
    if (!d.perihal) gagal(400, "Perihal wajib diisi.");
    const disposisi = arah === "masuk" ? bersih(body.status_disposisi, 80) : null;
    const lampiran = bersih(body.lampiran_url, 500);
    if (lampiran && !LAMPIRAN.test(lampiran)) gagal(400, "Lampiran harus tautan Google Docs/Drive (https://docs.google.com/… atau https://drive.google.com/…).");
    let id = body.id ? +body.id : null, ling;
    if (id) {
      const lama = await db.prepare("SELECT id, lingkungan FROM surat WHERE id = ?").bind(id).first();
      if (!lama) gagal(404, "Surat tidak ditemukan.");
      cekLing(u, lama.lingkungan);
      ling = body.lingkungan ? lingBaru(u, body.lingkungan) : lama.lingkungan;
      await db.prepare("UPDATE surat SET lingkungan = ?, arah = ?, nomor = ?, tanggal = ?, perihal = ?, pihak = ?, status_disposisi = ?, lampiran_url = ? WHERE id = ?")
        .bind(ling, arah, d.nomor, d.tanggal, d.perihal, d.pihak, disposisi, lampiran, id).run();
    } else {
      ling = lingBaru(u, body.lingkungan);
      id = (await db.prepare("INSERT INTO surat (lingkungan, arah, nomor, tanggal, perihal, pihak, status_disposisi, lampiran_url, dicatat_oleh) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(ling, arah, d.nomor, d.tanggal, d.perihal, d.pihak, disposisi, lampiran, u.id).run()).meta.last_row_id;
    }
    await catat(db, u, "data", body.id ? "ubah" : "tambah", "surat", id, `Surat ${arah} ${d.nomor}`, ling);
    return json({ ok: true, id });
  });

  on("POST", "/api/surat/:id/hapus", async ({ db, u, p }) => {
    wajib(u, "tata_warkat");
    const s = await db.prepare("SELECT id, lingkungan, arah, nomor FROM surat WHERE id = ?").bind(+p.id).first();
    if (!s) gagal(404, "Surat tidak ditemukan.");
    cekLing(u, s.lingkungan);
    await db.batch([
      db.prepare("DELETE FROM surat WHERE id = ?").bind(s.id),
      H.stmtCatat(db, u, "data", "hapus", "surat", s.id, `Surat ${s.arah} ${s.nomor} dihapus`, s.lingkungan),
    ]);
    return json({ ok: true });
  });

  // ---------------------------------------------------------------- Inventaris Barang
  // Daftar barang + jumlah unit per kondisi, dan ringkasan seluruh lingkungan (2 query).
  on("GET", "/api/barang", async ({ db, u, url }) => {
    wajib(u, "tata_warkat");
    const sp = url.searchParams, l = lingIn(u, "b.lingkungan"), w = [l.sql], a = [...l.args];
    const q = (sp.get("q") || "").trim();
    if (q.length >= 2) { w.push("(b.kode LIKE ? ESCAPE '\\' OR b.nama LIKE ? ESCAPE '\\')"); a.push(cari(q), cari(q)); }
    // filter unit: hanya barang yang punya unit dengan kondisi/kategori ini
    const kondisi = KONDISI.includes(sp.get("kondisi")) ? sp.get("kondisi") : null, kategori = ["lama", "baru"].includes(sp.get("kategori")) ? sp.get("kategori") : null;
    if (kondisi || kategori) {
      w.push(`EXISTS (SELECT 1 FROM barang_unit x WHERE x.barang_id = b.id${kondisi ? " AND x.kondisi = ?" : ""}${kategori ? " AND x.kategori = ?" : ""})`);
      if (kondisi) a.push(kondisi); if (kategori) a.push(kategori);
    }
    if (sp.get("aktif") === "1") w.push("b.aktif = 1");
    const lr = lingIn(u, "lingkungan");
    const [br, rk] = await db.batch([
      db.prepare(`SELECT b.id, b.lingkungan, b.kode, b.nama, b.aktif, COUNT(un.id) jumlah,
          SUM(un.kondisi = 'bagus') bagus, SUM(un.kondisi = 'rusak_ringan') rusak_ringan, SUM(un.kondisi = 'rusak_berat') rusak_berat, SUM(un.kondisi = 'hilang') hilang,
          SUM(un.kategori = 'lama') lama, SUM(un.kategori = 'baru') baru
        FROM barang b LEFT JOIN barang_unit un ON un.barang_id = b.id WHERE ${w.join(" AND ")} GROUP BY b.id ORDER BY b.lingkungan, b.kode LIMIT 1000`).bind(...a),
      db.prepare(`SELECT kondisi, COUNT(*) n FROM barang_unit WHERE ${lr.sql} GROUP BY kondisi`).bind(...lr.args),
    ]);
    const ringkasan = Object.fromEntries(KONDISI.map((k) => [k, 0]));
    for (const r of rk.results) ringkasan[r.kondisi] = r.n;
    ringkasan.total = KONDISI.reduce((s, k) => s + ringkasan[k], 0);
    return json({ barang: br.results.map((b) => ({ ...b, ...Object.fromEntries(["bagus", "rusak_ringan", "rusak_berat", "hilang", "lama", "baru"].map((k) => [k, b[k] || 0])) })), ringkasan });
  });

  // Semua unit (untuk ekspor .xlsx).
  on("GET", "/api/barang-unit", async ({ db, u }) => {
    wajib(u, "tata_warkat");
    const l = lingIn(u, "b.lingkungan");
    const r = await db.prepare(
      `SELECT b.lingkungan, b.kode, b.nama, b.aktif, un.id, un.kode_unit, un.kategori, un.kondisi, un.keterangan
       FROM barang_unit un JOIN barang b ON b.id = un.barang_id WHERE ${l.sql} ORDER BY b.lingkungan, b.kode, un.kode_unit LIMIT 20000`).bind(...l.args).all();
    return json(r.results);
  });

  on("GET", "/api/barang/:id", async ({ db, u, p }) => {
    wajib(u, "tata_warkat");
    const b = await db.prepare("SELECT * FROM barang WHERE id = ?").bind(+p.id).first();
    if (!b) gagal(404, "Barang tidak ditemukan.");
    cekLing(u, b.lingkungan);
    b.unit = (await db.prepare("SELECT * FROM barang_unit WHERE barang_id = ? ORDER BY kode_unit").bind(b.id).all()).results;
    return json(b);
  });

  on("POST", "/api/barang", async ({ db, u, body }) => {
    wajib(u, "tata_warkat");
    const kode = bersih(body.kode, 40), nama = bersih(body.nama, 150), aktif = body.aktif === undefined || body.aktif ? 1 : 0;
    if (!kode || !nama) gagal(400, "Kode dan nama barang wajib diisi.");
    let id = body.id ? +body.id : null, ling;
    if (id) {
      const lama = await db.prepare("SELECT id, lingkungan FROM barang WHERE id = ?").bind(id).first();
      if (!lama) gagal(404, "Barang tidak ditemukan.");
      cekLing(u, lama.lingkungan);
      ling = lama.lingkungan; // lingkungan barang tetap: unitnya ikut lingkungan barang
      if (await db.prepare("SELECT 1 FROM barang WHERE lingkungan = ? AND kode = ? AND id <> ?").bind(ling, kode, id).first()) gagal(409, `Kode barang ${kode} sudah dipakai di lingkungan ${ling}.`);
      await db.prepare("UPDATE barang SET kode = ?, nama = ?, aktif = ? WHERE id = ?").bind(kode, nama, aktif, id).run();
    } else {
      ling = lingBaru(u, body.lingkungan);
      if (await db.prepare("SELECT 1 FROM barang WHERE lingkungan = ? AND kode = ?").bind(ling, kode).first()) gagal(409, `Kode barang ${kode} sudah dipakai di lingkungan ${ling}.`);
      id = (await db.prepare("INSERT INTO barang (lingkungan, kode, nama, aktif) VALUES (?,?,?,?)").bind(ling, kode, nama, aktif).run()).meta.last_row_id;
    }
    await catat(db, u, "data", body.id ? "ubah" : "tambah", "barang", id, `Barang ${kode} ${nama}${aktif ? "" : " (nonaktif)"}`, ling);
    return json({ ok: true, id });
  });

  // Tambah unit (tanpa id) atau ubah unit termasuk kondisinya (dengan id).
  on("POST", "/api/barang/:id/unit", async ({ db, u, p, body }) => {
    wajib(u, "tata_warkat");
    const b = await db.prepare("SELECT id, lingkungan, kode FROM barang WHERE id = ?").bind(+p.id).first();
    if (!b) gagal(404, "Barang tidak ditemukan.");
    cekLing(u, b.lingkungan);
    const kodeUnit = bersih(body.kode_unit, 40), ket = bersih(body.keterangan, 300);
    const kategori = body.kategori || "baru", kondisi = body.kondisi || "bagus";
    if (!["lama", "baru"].includes(kategori)) gagal(400, "Kategori unit harus lama atau baru.");
    if (!KONDISI.includes(kondisi)) gagal(400, "Kondisi unit tidak dikenal.");
    let id = body.id ? +body.id : null;
    if (id) {
      const lama = await db.prepare("SELECT * FROM barang_unit WHERE id = ? AND barang_id = ?").bind(id, b.id).first();
      if (!lama) gagal(404, "Unit tidak ditemukan.");
      const kode = kodeUnit || lama.kode_unit;
      if (await db.prepare("SELECT 1 FROM barang_unit WHERE barang_id = ? AND kode_unit = ? AND id <> ?").bind(b.id, kode, id).first()) gagal(409, `Kode unit ${kode} sudah ada.`);
      await db.prepare("UPDATE barang_unit SET kode_unit = ?, kategori = ?, kondisi = ?, keterangan = ? WHERE id = ?").bind(kode, kategori, kondisi, ket, id).run();
      await catat(db, u, "data", "ubah", "barang_unit", id, `Unit ${b.kode}/${kode}: ${lama.kondisi !== kondisi ? lama.kondisi + " → " : ""}${kondisi}`, b.lingkungan);
    } else {
      if (!kodeUnit) gagal(400, "Kode unit wajib diisi.");
      if (await db.prepare("SELECT 1 FROM barang_unit WHERE barang_id = ? AND kode_unit = ?").bind(b.id, kodeUnit).first()) gagal(409, `Kode unit ${kodeUnit} sudah ada.`);
      id = (await db.prepare("INSERT INTO barang_unit (barang_id, lingkungan, kode_unit, kategori, kondisi, keterangan) VALUES (?,?,?,?,?,?)")
        .bind(b.id, b.lingkungan, kodeUnit, kategori, kondisi, ket).run()).meta.last_row_id;
      await catat(db, u, "data", "tambah", "barang_unit", id, `Unit ${b.kode}/${kodeUnit} (${kategori}, ${kondisi})`, b.lingkungan);
    }
    return json({ ok: true, id });
  });
}
