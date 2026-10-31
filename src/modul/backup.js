// Modul Backup & Ekspor — README "Backup Database" dan "Export Excel" (rekap Absensi Kamar).
// Server hanya menyerahkan skema + data per halaman; browser menyusun berkas .sql (dan mengenkripsinya).
export default function (H) {
  const { on, json, gagal, bersih, wajib, wajibModerator, lingIn, cekLing, catat } = H;

  // Tabel sesi/token tidak ikut data backup (skemanya tetap ikut): setelah pemulihan semua orang cukup login ulang.
  const TANPA_DATA = ["sesi_login", "sesi_wali", "token_akun"];
  // Objek internal SQLite / Cloudflare tidak ikut. `_` di LIKE = wildcard, jadi dibandingkan dengan substr.
  const BUKAN_INTERNAL = "sql IS NOT NULL AND substr(name,1,7) <> 'sqlite_' AND substr(name,1,4) <> '_cf_' AND substr(name,1,3) <> 'd1_'";
  const kutip = (nama) => '"' + String(nama).replace(/"/g, '""') + '"';

  async function daftarTabel(db) {
    return (await db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND ${BUKAN_INTERNAL} ORDER BY rowid`).all()).results;
  }
  // Kolom yang disimpan (kolom generated/hidden tidak ikut INSERT: hidden 1 = tersembunyi, 2/3 = generated).
  async function kolomTabel(db, nama) {
    return (await db.prepare("SELECT name, hidden FROM pragma_table_xinfo(?) ORDER BY cid").bind(nama).all()).results.filter((k) => !k.hidden).map((k) => k.name);
  }

  on("GET", "/api/backup/skema", async ({ db, u }) => {
    wajibModerator(u);
    const [obj, kol] = await db.batch([
      db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE ${BUKAN_INTERNAL} ORDER BY rowid`),
      db.prepare(`SELECT m.name tabel, p.name, p.hidden FROM sqlite_master m JOIN pragma_table_xinfo(m.name) p
                  WHERE m.type = 'table' AND ${BUKAN_INTERNAL.replace(/\b(sql|name)\b/g, "m.$1")} ORDER BY m.rowid, p.cid`),
    ]);
    const tabel = obj.results.filter((o) => o.type === "table");
    // Jumlah baris: D1 membatasi UNION ALL, jadi tiap tabel = satu kolom subquery, 30 tabel per pernyataan, satu batch.
    const kelompok = [];
    for (let i = 0; i < tabel.length; i += 30) kelompok.push(tabel.slice(i, i + 30));
    const jumlah = {};
    if (kelompok.length) (await db.batch(kelompok.map((k) => db.prepare(`SELECT ${k.map((t, j) => `(SELECT COUNT(*) FROM ${kutip(t.name)}) c${j}`).join(", ")}`))))
      .forEach((r, i) => kelompok[i].forEach((t, j) => { jumlah[t.name] = r.results[0]["c" + j]; }));
    return json({
      waktu: H.wib(),
      tabel: tabel.map((t) => ({
        nama: t.name, sql: t.sql, jumlah: jumlah[t.name] || 0, tanpa_data: TANPA_DATA.includes(t.name),
        kolom: kol.results.filter((k) => k.tabel === t.name && !k.hidden).map((k) => k.name),
      })),
      // indeks, trigger, view dibuat setelah data dimasukkan
      lain: obj.results.filter((o) => o.type !== "table").map((o) => ({ jenis: o.type, nama: o.name, tabel: o.tbl_name, sql: o.sql })),
    });
  });

  on("GET", "/api/backup/data", async ({ db, u, url }) => {
    wajibModerator(u);
    const nama = url.searchParams.get("tabel") || "";
    const t = (await daftarTabel(db)).find((x) => x.name === nama); // nama tabel hanya dari sqlite_master (anti-injeksi)
    if (!t) gagal(404, "Tabel tidak dikenal.");
    if (TANPA_DATA.includes(nama)) gagal(400, "Tabel sesi/token tidak ikut backup.");
    const offset = Math.max(0, Math.floor(+url.searchParams.get("offset") || 0));
    const batas = Math.min(1000, Math.max(1, Math.floor(+url.searchParams.get("batas") || 500)));
    const kolom = await kolomTabel(db, nama);
    const urut = /WITHOUT\s+ROWID/i.test(t.sql) ? "ORDER BY 1" : "ORDER BY rowid";
    const r = await db.prepare(`SELECT ${kolom.map(kutip).join(", ")} FROM ${kutip(nama)} ${urut} LIMIT ? OFFSET ?`).bind(batas, offset).raw();
    // BLOB → {hex} agar selamat lewat JSON; browser menuliskannya sebagai X'..'
    const hexOf = (b) => [...new Uint8Array(b.buffer || b, b.byteOffset || 0, b.byteLength)].map((x) => x.toString(16).padStart(2, "0")).join("");
    const baris = r.map((row) => row.map((v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? { hex: hexOf(v) } : v)));
    return json({ tabel: nama, kolom, offset, baris, selesai: baris.length < batas });
  });

  on("POST", "/api/backup/log", async ({ db, u, body }) => {
    wajibModerator(u);
    if (!["sql", "csv"].includes(body.jenis)) gagal(400, "Jenis backup tidak dikenal.");
    const status = bersih(body.status, 80) || "berhasil";
    const ukuran = Number.isFinite(+body.ukuran) ? Math.max(0, Math.floor(+body.ukuran)) : null;
    const r = await db.prepare("INSERT INTO backup_log (jenis, ukuran, status, oleh) VALUES (?,?,?,?)").bind(body.jenis, ukuran, status, u.id).run();
    await catat(db, u, "pengaturan", "backup", "backup_log", r.meta.last_row_id, `Backup ${body.jenis}${body.tabel ? " " + bersih(body.tabel, 60) : ""}: ${status}, ${ukuran ?? "?"} byte`);
    return json({ ok: true, id: r.meta.last_row_id });
  });

  on("GET", "/api/backup/log", async ({ db, u }) => {
    wajibModerator(u);
    const r = await db.prepare("SELECT b.*, us.nama oleh_nama FROM backup_log b LEFT JOIN users us ON us.id = b.oleh ORDER BY b.id DESC LIMIT 30").all();
    return json(r.results);
  });

  // ---------------------------------------------------------------- rekap Absensi Kamar (.xlsx dibuat di browser)
  // Asumsi: pemegang akses absensi boleh mengekspor rekap lingkungannya (README "Belum Diputuskan": Export Excel).
  const TGL = /^\d{4}-\d{2}-\d{2}$/;
  on("GET", "/api/rekap-absensi", async ({ db, u, url }) => {
    wajib(u, "absensi");
    const dari = url.searchParams.get("dari") || "", sampai = url.searchParams.get("sampai") || "";
    if (!TGL.test(dari) || !TGL.test(sampai) || sampai < dari) gagal(400, "Rentang tanggal tidak valid.");
    if (Date.parse(sampai) - Date.parse(dari) > 400 * 864e5) gagal(400, "Rentang maksimal ±1 tahun.");
    const l = lingIn(u, "s.lingkungan"), w = ["s.jenis = 'harian'", "s.tanggal BETWEEN ? AND ?", l.sql], a = [dari, sampai, ...l.args];
    const kamarId = +url.searchParams.get("kamar_id") || 0;
    if (kamarId) {
      const km = await db.prepare("SELECT id, lingkungan FROM kamar WHERE id = ?").bind(kamarId).first();
      if (!km) gagal(404, "Kamar tidak ditemukan.");
      cekLing(u, km.lingkungan);
      w.push("s.target_id = ?"); a.push(kamarId);
    }
    // Satu agregasi: per kamar (target sesi) × santri × status. Santri yang pindah kamar muncul per kamar.
    const [st, r] = await db.batch([
      db.prepare("SELECT id, kode, nama, dihitung_hadir FROM status_kehadiran ORDER BY urutan, id"),
      db.prepare(`SELECT s.target_id kamar_id, km.nama kamar, a.santri_id, sa.nis, sa.nama, a.status_kehadiran_id sid, COUNT(*) n
        FROM absensi a JOIN absensi_sesi s ON s.id = a.sesi_id JOIN santri sa ON sa.id = a.santri_id LEFT JOIN kamar km ON km.id = s.target_id
        WHERE ${w.join(" AND ")} GROUP BY s.target_id, a.santri_id, a.status_kehadiran_id ORDER BY km.nama, sa.nama`).bind(...a),
    ]);
    const hadir = new Set(st.results.filter((s) => s.dihitung_hadir).map((s) => s.id)), kode = Object.fromEntries(st.results.map((s) => [s.id, s.kode]));
    const peta = new Map();
    for (const x of r.results) {
      const k = x.kamar_id + "|" + x.santri_id;
      if (!peta.has(k)) peta.set(k, { kamar: x.kamar, nis: x.nis, nama: x.nama, jumlah: {}, total: 0, hadir: 0 });
      const b = peta.get(k);
      b.jumlah[kode[x.sid]] = (b.jumlah[kode[x.sid]] || 0) + x.n; b.total += x.n; if (hadir.has(x.sid)) b.hadir += x.n;
    }
    const baris = [...peta.values()].map((b) => ({ ...b, persen_hadir: b.total ? Math.round((b.hadir / b.total) * 1000) / 10 : 0 }));
    return json({ dari, sampai, status: st.results, baris });
  });
}
