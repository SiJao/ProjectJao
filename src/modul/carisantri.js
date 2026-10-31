// Modul Cari Santri & Guru — kartu detail santri (tanpa data kesehatan) dan detail guru. Daftar memakai GET /api/santri & GET /api/guru.
export default function (H) {
  const { on, json, gagal, lingIn, cekLing } = H;

  // Identitas, kelas, kamar, wali kelas & wali asuh tahun ajaran aktif.
  on("GET", "/api/cari/santri/:id", async ({ db, u, p }) => {
    const s = await db.prepare(
      `SELECT s.id, s.nis, s.nama, s.jenis_kelamin, s.lingkungan, s.status, s.tempat_lahir, s.tanggal_lahir, s.kabupaten, s.provinsi, s.foto_url, s.tanggal_masuk,
              s.kelas_id, s.kamar_id, km.nama kamar, a.nama asrama, (k.tingkat || ' ' || k.rombel || ' ' || j.nama || COALESCE(' ' || k.label, '')) kelas
       FROM santri s LEFT JOIN kamar km ON km.id = s.kamar_id LEFT JOIN asrama a ON a.id = km.asrama_id
       LEFT JOIN kelas k ON k.id = s.kelas_id LEFT JOIN jenjang j ON j.id = k.jenjang_id WHERE s.id = ?`).bind(p.id).first();
    if (!s) gagal(404, "Santri tidak ditemukan.");
    cekLing(u, s.lingkungan);
    const [wk, wa] = await db.batch([
      db.prepare(`SELECT g.id, g.nip, g.nama, g.no_hp, g.email, wk.peran FROM wali_kelas wk JOIN guru g ON g.id = wk.guru_id
        JOIN tahun_ajaran ta ON ta.id = wk.tahun_ajaran_id AND ta.status = 'aktif' WHERE wk.kelas_id = ? ORDER BY wk.peran = 'wali' DESC, g.nama`).bind(s.kelas_id || 0),
      db.prepare(`SELECT g.id, g.nip, g.nama, g.no_hp, g.email, wa.peran FROM wali_asuh_kamar wa JOIN guru g ON g.id = wa.guru_id
        JOIN tahun_ajaran ta ON ta.id = wa.tahun_ajaran_id AND ta.status = 'aktif' WHERE wa.kamar_id = ? ORDER BY wa.peran = 'wali_asuh' DESC, g.nama`).bind(s.kamar_id || 0),
    ]);
    return json({ ...s, wali_kelas: wk.results, wali_asuh: wa.results });
  });

  // Daftar guru (cadangan bila GET /api/guru belum ada): nama/NIP, lingkungan 'semua' atau di lingkungan pengguna. Maks. 5 saran.
  on("GET", "/api/cari/guru", async ({ db, u, url }) => {
    const l = lingIn(u, "g.lingkungan");
    const w = [`(g.lingkungan = 'semua' OR ${l.sql})`, "g.aktif = 1"], a = [...l.args];
    const q = (url.searchParams.get("q") || "").trim();
    if (q) { w.push("(g.nama LIKE ? OR g.nip LIKE ?)"); a.push(`%${q}%`, `${q}%`); }
    const ling = url.searchParams.get("lingkungan");
    if (["putra", "putri", "semua"].includes(ling)) { w.push("g.lingkungan = ?"); a.push(ling); }
    const lim = Math.min(+url.searchParams.get("limit") || 5, 5);
    const r = await db.prepare(`SELECT g.id, g.nip, g.nama, g.jenis_kelamin, g.lingkungan, g.email, g.no_hp FROM guru g WHERE ${w.join(" AND ")} ORDER BY g.nama LIMIT ?`).bind(...a, lim).all();
    return json(r.results);
  });

  // Detail guru: kontak + tugas wali kelas / wali asuh tahun ajaran aktif (hanya kelas/kamar di lingkungan pengguna).
  on("GET", "/api/cari/guru/:id", async ({ db, u, p }) => {
    const g = await db.prepare("SELECT id, nip, nama, jenis_kelamin, lingkungan, email, no_hp, aktif FROM guru WHERE id = ?").bind(p.id).first();
    if (!g) gagal(404, "Guru tidak ditemukan.");
    if (g.lingkungan !== "semua") cekLing(u, g.lingkungan);
    const lk = lingIn(u, "k.lingkungan"), lm = lingIn(u, "km.lingkungan");
    const [kelas, kamar] = await db.batch([
      db.prepare(`SELECT wk.peran, (k.tingkat || ' ' || k.rombel || ' ' || j.nama || COALESCE(' ' || k.label, '')) nama, k.lingkungan FROM wali_kelas wk
        JOIN kelas k ON k.id = wk.kelas_id JOIN jenjang j ON j.id = k.jenjang_id JOIN tahun_ajaran ta ON ta.id = wk.tahun_ajaran_id AND ta.status = 'aktif'
        WHERE wk.guru_id = ? AND ${lk.sql}`).bind(g.id, ...lk.args),
      db.prepare(`SELECT wa.peran, km.nama, km.lingkungan FROM wali_asuh_kamar wa JOIN kamar km ON km.id = wa.kamar_id
        JOIN tahun_ajaran ta ON ta.id = wa.tahun_ajaran_id AND ta.status = 'aktif' WHERE wa.guru_id = ? AND ${lm.sql}`).bind(g.id, ...lm.args),
    ]);
    return json({ ...g, wali_kelas: kelas.results, wali_asuh: kamar.results });
  });
}
