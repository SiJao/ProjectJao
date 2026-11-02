// Modul Pengembangan Diri — cabang kegiatan/ekskul, kelompok, anggota, absensi kegiatan, prestasi. Lihat src/modul/README.md.
// Cabang (tabel grup_kegiatan) = satu kegiatan yang dinilai langsung (Pramuka, Halaqah Qur'an, Muhadhoroh) atau satu ekskul
// dari kegiatan kategori (Olahraga → Futsal), per lingkungan, dengan satu pembimbing. Kelompok (opsional) milik satu cabang.
// Keanggotaan bersejarah: keluar = isi `selesai`, pindah cabang/kelompok = tutup + baris baru. Anggota pada tanggal d:
// mulai <= d AND (selesai IS NULL OR selesai > d) — jadi pada hari pindah santri hanya tercatat di tempat baru.
const TGL = /^\d{4}-\d{2}-\d{2}$/;

export default function (H) {
  const { on, json, gagal, wajib, boleh, lingIn, cekLing, bersih, hariIni } = H;

  // Tanggal opsional dari isian; kosong → hari ini. Tanggal mendatang ditolak.
  const tanggal = (s, nama = "Tanggal") => {
    const t = s ? String(s) : hariIni();
    if (!TGL.test(t)) gagal(400, nama + " tidak valid.");
    if (t > hariIni()) gagal(400, nama + " tidak boleh di masa mendatang.");
    return t;
  };
  const rentang = (url) => {
    const sampai = url.searchParams.get("sampai") || hariIni();
    const dari = url.searchParams.get("dari") || sampai.slice(0, 8) + "01";
    if (!TGL.test(dari) || !TGL.test(sampai) || dari > sampai) gagal(400, "Rentang tanggal tidak valid.");
    return { dari, sampai };
  };
  async function ambilGrup(db, u, id) {
    const g = await db.prepare("SELECT * FROM grup_kegiatan WHERE id = ?").bind(+id || 0).first();
    if (!g) gagal(404, "Cabang kegiatan tidak ditemukan.");
    cekLing(u, g.lingkungan);
    return g;
  }
  // kelompok_id dari isian: kosong → tanpa kelompok; selain itu wajib kelompok aktif milik cabang g.
  async function ambilKelompok(db, g, id) {
    if (!+id) return null;
    const k = await db.prepare("SELECT * FROM kelompok_kegiatan WHERE id = ? AND grup_id = ?").bind(+id, g.id).first();
    if (!k) gagal(400, "Kelompok bukan milik cabang " + g.nama + ".");
    if (!k.aktif) gagal(400, "Kelompok " + k.nama + " nonaktif.");
    return k;
  }
  const bisaLihatGrup = (u) => boleh(u, "kegiatan") || boleh(u, "lihat_absensi");

  // ------------------------------------------------------------ cabang kegiatan / ekskul
  on("GET", "/api/grup", async ({ db, u, url }) => {
    if (!bisaLihatGrup(u)) gagal(403, "Anda tidak punya akses untuk tindakan ini.");
    const l = lingIn(u, "g.lingkungan");
    const aktif = url.searchParams.get("aktif") === "1" ? " AND g.aktif = 1" : "";
    const [gR, kR] = await db.batch([
      db.prepare(
        `SELECT g.*, pk.nama kegiatan, pe.nama ekstrakurikuler, gr.nama pembimbing, gr.nip pembimbing_nip, gr.lingkungan pembimbing_ling,
                (SELECT COUNT(*) FROM anggota_grup a WHERE a.grup_id = g.id AND a.selesai IS NULL) jumlah
         FROM grup_kegiatan g JOIN pilihan pk ON pk.id = g.kegiatan_id LEFT JOIN pilihan pe ON pe.id = g.ekstrakurikuler_id
         LEFT JOIN guru gr ON gr.id = g.pembimbing_guru_id
         WHERE ${l.sql}${aktif} ORDER BY g.aktif DESC, g.lingkungan, pk.urutan, pe.urutan, pe.nama`).bind(...l.args),
      db.prepare(
        `SELECT k.id, k.grup_id, k.nama, k.aktif, (SELECT COUNT(*) FROM anggota_grup a WHERE a.kelompok_id = k.id AND a.selesai IS NULL) jumlah
         FROM kelompok_kegiatan k JOIN grup_kegiatan g ON g.id = k.grup_id WHERE ${l.sql} ORDER BY k.aktif DESC, k.nama`).bind(...l.args),
    ]);
    const per = {};
    for (const k of kR.results) (per[k.grup_id] ||= []).push(k);
    return json(gR.results.map((g) => ({ ...g, kelompok: per[g.id] || [] })));
  });

  // Cabang: kegiatan yang punya ekskul (pilihan ekstrakurikuler ber-induk kegiatan itu) wajib memilih ekskulnya;
  // kegiatan lain tanpa ekskul. Satu cabang per kegiatan/ekskul per lingkungan; nama cabang dibentuk otomatis.
  on("POST", "/api/grup", async ({ db, u, body }) => {
    wajib(u, "kegiatan");
    let lama = null;
    if (body.id) lama = await ambilGrup(db, u, body.id);
    const ling = lama ? lama.lingkungan : body.lingkungan;
    if (!["putra", "putri"].includes(ling)) gagal(400, "Pilih lingkungan.");
    cekLing(u, ling);
    if (lama && body.lingkungan && body.lingkungan !== lama.lingkungan) gagal(400, "Lingkungan cabang tidak bisa diubah. Buat cabang baru.");
    const kegiatanId = +body.kegiatan_id || 0, ekskulId = +body.ekstrakurikuler_id || null, guruId = +body.pembimbing_guru_id || null;
    const [pR, eR, gR] = await db.batch([
      db.prepare("SELECT id, nama, kelompok, lingkungan, induk_id FROM pilihan WHERE id IN (?, ?)").bind(kegiatanId, ekskulId || 0),
      db.prepare("SELECT COUNT(*) n FROM pilihan WHERE kelompok = 'ekstrakurikuler' AND induk_id = ?").bind(kegiatanId),
      db.prepare("SELECT id, lingkungan, aktif FROM guru WHERE id = ?").bind(guruId || 0),
    ]);
    const pil = Object.fromEntries(pR.results.map((x) => [x.id, x]));
    const cocok = (x, kel) => x && x.kelompok === kel && (x.lingkungan === "semua" || x.lingkungan === ling);
    const keg = pil[kegiatanId], eks = ekskulId && pil[ekskulId];
    if (!cocok(keg, "kegiatan")) gagal(400, "Pilih kegiatan.");
    if (eR.results[0].n) {
      if (!ekskulId) gagal(400, `Pilih ekskul ${keg.nama}.`);
      if (!cocok(eks, "ekstrakurikuler") || eks.induk_id !== keg.id) gagal(400, `Ekskul tidak termasuk ${keg.nama} atau bukan untuk lingkungan ini.`);
    } else if (ekskulId) gagal(400, `${keg.nama} dinilai langsung, tanpa ekskul.`);
    const guru = gR.results[0];
    if (guruId && (!guru || !(guru.lingkungan === "semua" || guru.lingkungan === ling))) gagal(400, "Pembimbing harus guru di lingkungan " + ling + ".");
    const nama = eks ? `${keg.nama} — ${eks.nama}` : keg.nama;
    const kembar = await db.prepare("SELECT id FROM grup_kegiatan WHERE kegiatan_id = ? AND COALESCE(ekstrakurikuler_id, 0) = ? AND lingkungan = ? AND id <> ?")
      .bind(kegiatanId, ekskulId || 0, ling, lama ? lama.id : 0).first();
    if (kembar) gagal(409, `Cabang ${nama} (${ling}) sudah ada.`);
    const aktif = body.aktif === undefined ? (lama ? lama.aktif : 1) : (body.aktif ? 1 : 0);
    if (lama) {
      const st = [db.prepare("UPDATE grup_kegiatan SET kegiatan_id = ?, ekstrakurikuler_id = ?, nama = ?, pembimbing_guru_id = ?, aktif = ? WHERE id = ?")
        .bind(kegiatanId, ekskulId, nama, guruId, aktif, lama.id)];
      // Cabang dinonaktifkan → keanggotaan terbuka ditutup hari ini (riwayat tetap tersimpan; rapor tidak menampilkannya lagi).
      if (lama.aktif && !aktif) st.push(db.prepare("UPDATE anggota_grup SET selesai = ? WHERE grup_id = ? AND selesai IS NULL").bind(hariIni(), lama.id));
      st.push(H.stmtCatat(db, u, "kesantrian", lama.aktif && !aktif ? "grup_nonaktif" : "grup_ubah", "grup_kegiatan", lama.id, nama, ling));
      await db.batch(st);
      return json({ ok: true, id: lama.id });
    }
    const r = await db.prepare("INSERT INTO grup_kegiatan (kegiatan_id, ekstrakurikuler_id, nama, lingkungan, pembimbing_guru_id, aktif) VALUES (?,?,?,?,?,?)")
      .bind(kegiatanId, ekskulId, nama, ling, guruId, aktif).run();
    await H.catat(db, u, "kesantrian", "grup_tambah", "grup_kegiatan", r.meta.last_row_id, nama, ling);
    return json({ ok: true, id: r.meta.last_row_id });
  });

  // ------------------------------------------------------------ kelompok dalam cabang
  // {grup_id, nama} → kelompok baru; {id, nama?, aktif?} → ubah. Menonaktifkan hanya bila tidak ada anggota aktif di dalamnya.
  on("POST", "/api/kelompok", async ({ db, u, body }) => {
    wajib(u, "kegiatan");
    const nama = "nama" in body ? bersih(body.nama, 60) : undefined;
    if (nama !== undefined && !nama) gagal(400, "Nama kelompok wajib diisi.");
    if (body.id) {
      const k = await db.prepare("SELECT * FROM kelompok_kegiatan WHERE id = ?").bind(+body.id).first();
      if (!k) gagal(404, "Kelompok tidak ditemukan.");
      const g = await ambilGrup(db, u, k.grup_id);
      const aktif = body.aktif === undefined ? k.aktif : body.aktif ? 1 : 0;
      if (k.aktif && !aktif) {
        const n = (await db.prepare("SELECT COUNT(*) n FROM anggota_grup WHERE kelompok_id = ? AND selesai IS NULL").bind(k.id).first()).n;
        if (n) gagal(400, `Masih ada ${n} anggota di kelompok ${k.nama}. Pindahkan atau keluarkan dulu.`);
      }
      if (nama && nama !== k.nama && await db.prepare("SELECT 1 FROM kelompok_kegiatan WHERE grup_id = ? AND nama = ? AND id <> ?").bind(g.id, nama, k.id).first())
        gagal(409, "Nama kelompok sudah dipakai di cabang ini.");
      await db.batch([
        db.prepare("UPDATE kelompok_kegiatan SET nama = ?, aktif = ? WHERE id = ?").bind(nama || k.nama, aktif, k.id),
        H.stmtCatat(db, u, "kesantrian", "kelompok_ubah", "kelompok_kegiatan", k.id, `${g.nama}: ${k.nama}${nama && nama !== k.nama ? " → " + nama : ""}${aktif !== k.aktif ? (aktif ? " (aktif)" : " (nonaktif)") : ""}`, g.lingkungan),
      ]);
      return json({ ok: true, id: k.id });
    }
    const g = await ambilGrup(db, u, body.grup_id);
    if (!g.aktif) gagal(400, "Cabang nonaktif.");
    if (!nama) gagal(400, "Nama kelompok wajib diisi.");
    if (await db.prepare("SELECT 1 FROM kelompok_kegiatan WHERE grup_id = ? AND nama = ?").bind(g.id, nama).first()) gagal(409, "Nama kelompok sudah dipakai di cabang ini.");
    const r = await db.prepare("INSERT INTO kelompok_kegiatan (grup_id, nama) VALUES (?, ?)").bind(g.id, nama).run();
    await H.catat(db, u, "kesantrian", "kelompok_tambah", "kelompok_kegiatan", r.meta.last_row_id, `${g.nama}: ${nama}`, g.lingkungan);
    return json({ ok: true, id: r.meta.last_row_id });
  });

  // ------------------------------------------------------------ anggota
  on("GET", "/api/grup/:id/anggota", async ({ db, u, p, url }) => {
    if (!bisaLihatGrup(u)) gagal(403, "Anda tidak punya akses untuk tindakan ini.");
    const g = await ambilGrup(db, u, p.id);
    const riwayat = url.searchParams.get("riwayat") === "1";
    const r = await db.prepare(
      `SELECT a.id, a.santri_id, a.peran, a.mulai, a.selesai, a.kelompok_id, kk.nama kelompok, s.nis, s.nama, s.foto_url, s.status,
              km.nama kamar, (k.tingkat || ' ' || k.rombel || ' ' || j.nama) kelas
       FROM anggota_grup a JOIN santri s ON s.id = a.santri_id LEFT JOIN kelompok_kegiatan kk ON kk.id = a.kelompok_id
       LEFT JOIN kamar km ON km.id = s.kamar_id LEFT JOIN kelas k ON k.id = s.kelas_id LEFT JOIN jenjang j ON j.id = k.jenjang_id
       WHERE a.grup_id = ?${riwayat ? "" : " AND a.selesai IS NULL"} ORDER BY a.selesai IS NOT NULL, a.peran DESC, s.nama`).bind(g.id).all();
    return json({ grup: g, anggota: r.results });
  });

  // Tambah anggota: santri_ids (Cari / pilih banyak) atau nis (CSV). Maks. 500 per permintaan.
  on("POST", "/api/grup/:id/anggota", async ({ db, u, p, body }) => {
    wajib(u, "kegiatan");
    const g = await ambilGrup(db, u, p.id);
    if (!g.aktif) gagal(400, "Cabang nonaktif. Aktifkan dulu untuk menambah anggota.");
    const kel = await ambilKelompok(db, g, body.kelompok_id);
    const peran = body.peran === "pengurus" ? "pengurus" : "anggota";
    const mulai = tanggal(body.mulai, "Tanggal mulai");
    const pakaiNis = Array.isArray(body.nis);
    const kunci = [...new Set(pakaiNis ? body.nis.map((x) => String(x).trim()).filter(Boolean) : (body.santri_ids || []).map(Number).filter(Boolean))].slice(0, 500);
    if (!kunci.length) gagal(400, "Tidak ada santri yang dipilih.");
    const [sR, aR] = await db.batch([
      db.prepare(`SELECT id, nis, nama, lingkungan, status FROM santri WHERE ${pakaiNis ? "nis" : "id"} IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(kunci)),
      db.prepare("SELECT santri_id FROM anggota_grup WHERE grup_id = ? AND selesai IS NULL").bind(g.id),
    ]);
    const ada = new Set(aR.results.map((x) => x.santri_id));
    const per = Object.fromEntries(sR.results.map((s) => [pakaiNis ? s.nis : s.id, s]));
    const ditolak = [], st = [];
    for (const k of kunci) {
      const s = per[k];
      const tolak = (alasan) => ditolak.push({ nis: s ? s.nis : String(k), nama: s ? s.nama : "", alasan });
      if (!s) tolak(pakaiNis ? "NIS tidak ditemukan" : "Santri tidak ditemukan");
      else if (s.lingkungan !== g.lingkungan) tolak("Bukan santri " + g.lingkungan);
      else if (!["aktif", "skorsing"].includes(s.status)) tolak("Santri tidak aktif");
      else if (ada.has(s.id)) tolak("Sudah anggota " + g.nama);
      else {
        ada.add(s.id);
        st.push(db.prepare("INSERT INTO anggota_grup (grup_id, santri_id, lingkungan, peran, mulai, kelompok_id) VALUES (?,?,?,?,?,?)").bind(g.id, s.id, g.lingkungan, peran, mulai, kel ? kel.id : null));
      }
    }
    if (st.length) {
      st.push(H.stmtCatat(db, u, "kesantrian", "anggota_tambah", "grup_kegiatan", g.id, `${g.nama}${kel ? " · " + kel.nama : ""}: ${st.length} anggota ditambah`, g.lingkungan));
      await db.batch(st);
    }
    return json({ ok: true, ditambah: st.length ? st.length - 1 : 0, ditolak });
  });

  async function ambilAnggota(db, u, id) {
    const a = await db.prepare(`SELECT a.*, g.nama grup, g.aktif grup_aktif, kk.nama kelompok FROM anggota_grup a JOIN grup_kegiatan g ON g.id = a.grup_id
      LEFT JOIN kelompok_kegiatan kk ON kk.id = a.kelompok_id WHERE a.id = ?`).bind(+id || 0).first();
    if (!a) gagal(404, "Data anggota tidak ditemukan.");
    cekLing(u, a.lingkungan);
    if (a.selesai) gagal(400, "Keanggotaan ini sudah selesai.");
    return a;
  }

  on("POST", "/api/anggota/:id/keluar", async ({ db, u, p, body }) => {
    wajib(u, "kegiatan");
    const a = await ambilAnggota(db, u, p.id);
    const t = tanggal(body.tanggal, "Tanggal keluar");
    if (t < a.mulai) gagal(400, "Tanggal keluar sebelum tanggal mulai (" + a.mulai + ").");
    await db.batch([
      db.prepare("UPDATE anggota_grup SET selesai = ? WHERE id = ? AND selesai IS NULL").bind(t, a.id),
      H.stmtCatat(db, u, "kesantrian", "anggota_keluar", "anggota_grup", a.id, `${a.grup}: santri #${a.santri_id} keluar ${t}`, a.lingkungan),
    ]);
    return json({ ok: true });
  });

  // Pindah cabang dan/atau kelompok: {grup_id?, kelompok_id?}. grup_id kosong = cabang yang sama (ganti kelompok saja;
  // kelompok_id kosong = keluar dari kelompok tetapi tetap anggota cabang). Pindah cabang tanpa kelompok_id = tanpa kelompok.
  on("POST", "/api/anggota/:id/pindah", async ({ db, u, p, body }) => {
    wajib(u, "kegiatan");
    const a = await ambilAnggota(db, u, p.id);
    const g = await ambilGrup(db, u, body.grup_id || a.grup_id);
    const kel = await ambilKelompok(db, g, body.kelompok_id);
    const kelId = kel ? kel.id : null;
    if (g.id === a.grup_id && kelId === a.kelompok_id) gagal(400, "Pilih cabang atau kelompok tujuan yang berbeda.");
    if (!g.aktif) gagal(400, "Cabang tujuan nonaktif.");
    if (g.lingkungan !== a.lingkungan) gagal(400, "Cabang tujuan beda lingkungan.");
    const t = tanggal(body.tanggal, "Tanggal pindah");
    if (t < a.mulai) gagal(400, "Tanggal pindah sebelum tanggal mulai (" + a.mulai + ").");
    if (g.id !== a.grup_id && await db.prepare("SELECT 1 FROM anggota_grup WHERE grup_id = ? AND santri_id = ? AND selesai IS NULL").bind(g.id, a.santri_id).first())
      gagal(409, "Santri sudah anggota " + g.nama + ".");
    const peran = ["anggota", "pengurus"].includes(body.peran) ? body.peran : a.peran;
    const dari = a.grup + (a.kelompok ? " · " + a.kelompok : ""), ke = g.nama + (kel ? " · " + kel.nama : g.id === a.grup_id ? " · tanpa kelompok" : "");
    await db.batch([
      db.prepare("UPDATE anggota_grup SET selesai = ? WHERE id = ? AND selesai IS NULL").bind(t, a.id),
      db.prepare("INSERT INTO anggota_grup (grup_id, santri_id, lingkungan, peran, mulai, kelompok_id) VALUES (?,?,?,?,?,?)").bind(g.id, a.santri_id, a.lingkungan, peran, t, kelId),
      H.stmtCatat(db, u, "kesantrian", "anggota_pindah", "anggota_grup", a.id, `Santri #${a.santri_id}: ${dari} → ${ke} (${t})`, a.lingkungan),
    ]);
    return json({ ok: true });
  });

  on("POST", "/api/anggota/:id/peran", async ({ db, u, p, body }) => {
    wajib(u, "kegiatan");
    const a = await ambilAnggota(db, u, p.id);
    if (!["anggota", "pengurus"].includes(body.peran)) gagal(400, "Peran tidak valid.");
    await db.batch([
      db.prepare("UPDATE anggota_grup SET peran = ? WHERE id = ?").bind(body.peran, a.id),
      H.stmtCatat(db, u, "kesantrian", "anggota_peran", "anggota_grup", a.id, `${a.grup}: santri #${a.santri_id} → ${body.peran}`, a.lingkungan),
    ]);
    return json({ ok: true });
  });

  // ------------------------------------------------------------ absensi kegiatan (model sama dengan absensi harian)
  // Saringan kelompok absensi: "" = semua anggota cabang, "0" = anggota tanpa kelompok, id = satu kelompok.
  // Tiap kelompok bisa diabsen terpisah pada sesi yang sama; yang wajib diberi status hanya anggota yang tersaring.
  const saringKelompok = (v) => (v === "0" || v === 0 ? 0 : +v || null);
  const ANGGOTA_PADA = `SELECT s.id, s.nis, s.nama, s.status, s.foto_url, MAX(a.peran) peran, MAX(kk.nama) kelompok FROM anggota_grup a JOIN santri s ON s.id = a.santri_id
     LEFT JOIN kelompok_kegiatan kk ON kk.id = a.kelompok_id
     WHERE a.grup_id = ? AND a.mulai <= ? AND (a.selesai IS NULL OR a.selesai > ?) AND s.status IN ('aktif','skorsing')
       AND (? IS NULL OR COALESCE(a.kelompok_id, 0) = ?) GROUP BY s.id ORDER BY s.nama`;
  const anggotaPada = (db, g, tgl, kf) => db.prepare(ANGGOTA_PADA).bind(g.id, tgl, tgl, kf, kf);

  on("GET", "/api/absensi-kegiatan", async ({ db, u, url }) => {
    wajib(u, "lihat_absensi");
    const g = await ambilGrup(db, u, url.searchParams.get("grup_id"));
    const sesiId = +url.searchParams.get("sesi_id");
    const tgl = url.searchParams.get("tanggal") || hariIni();
    if (!TGL.test(tgl)) gagal(400, "Tanggal tidak valid.");
    const kf = saringKelompok(url.searchParams.get("kelompok_id"));
    const bisaIsi = boleh(u, "absensi");
    if (bisaIsi) await H.perbaruiOverdue(db);
    const santri = (await anggotaPada(db, g, tgl, kf).all()).results;
    const sesi = await db.prepare("SELECT * FROM absensi_sesi WHERE jenis = 'kegiatan' AND tanggal = ? AND sesi_pilihan_id = ? AND target_id = ?").bind(tgl, sesiId, g.id).first();
    const tersimpan = sesi ? Object.fromEntries((await db.prepare("SELECT * FROM absensi WHERE sesi_id = ?").bind(sesi.id).all()).results.map((a) => [a.santri_id, a])) : {};
    const oto = await H.statusOtomatis(db, santri.map((s) => s.id), tgl);
    return json({
      // terisi dihitung dari anggota yang tersaring: kelompok lain yang sudah diabsen tidak membuat kelompok ini tampak terisi
      grup: g, tanggal: tgl, sesi_id: sesiId, kelompok_id: kf, terisi: santri.some((s) => tersimpan[s.id]), diisi_at: sesi?.diisi_at || null, bisa_isi: bisaIsi,
      santri: santri.map((s) => {
        const o = oto[s.id], t = tersimpan[s.id];
        return { ...s, status_kehadiran_id: o ? o.status_kehadiran_id : t ? t.status_kehadiran_id : null, otomatis: o ? o.sumber : null, keterangan: o ? o.keterangan : t?.keterangan || null };
      }),
    });
  });

  on("POST", "/api/absensi-kegiatan", async ({ db, u, body }) => {
    wajib(u, "absensi");
    const sesiId = +body.sesi_id, tgl = String(body.tanggal || "");
    if (!TGL.test(tgl)) gagal(400, "Tanggal tidak valid.");
    if (tgl > hariIni()) gagal(400, "Tidak bisa mengisi absensi untuk tanggal mendatang.");
    const g = await ambilGrup(db, u, body.grup_id);
    if (!g.aktif) gagal(400, "Cabang nonaktif.");
    const kf = saringKelompok(body.kelompok_id);
    const kel = kf ? await db.prepare("SELECT nama FROM kelompok_kegiatan WHERE id = ? AND grup_id = ?").bind(kf, g.id).first() : null;
    if (kf && !kel) gagal(400, "Kelompok bukan milik cabang " + g.nama + ".");
    const [pR, aR, vR] = await db.batch([
      db.prepare("SELECT id FROM pilihan WHERE id = ? AND kelompok = 'sesi_absensi'").bind(sesiId),
      anggotaPada(db, g, tgl, kf),
      db.prepare("SELECT id FROM status_kehadiran WHERE aktif = 1"),
    ]);
    if (!pR.results.length) gagal(400, "Sesi absensi tidak valid.");
    const anggota = new Set(aR.results.map((r) => r.id));
    const valid = new Set(vR.results.map((r) => r.id));
    const items = (body.items || []).filter((i) => anggota.has(+i.santri_id));
    if (!anggota.size) gagal(400, (kf === null ? "Cabang" : "Kelompok") + " ini belum punya anggota pada tanggal tersebut.");
    if (items.some((i) => !valid.has(+i.status_kehadiran_id))) gagal(400, "Ada status kehadiran yang tidak valid.");
    if (new Set(items.map((i) => +i.santri_id)).size < anggota.size) gagal(400, "Semua anggota " + (kf === null ? "cabang" : "kelompok") + " harus diberi status.");
    await db.prepare(`INSERT INTO absensi_sesi (jenis, tanggal, sesi_pilihan_id, target_id, lingkungan, diisi_oleh) VALUES ('kegiatan',?,?,?,?,?)
      ON CONFLICT (jenis, tanggal, sesi_pilihan_id, target_id) DO UPDATE SET diisi_oleh = excluded.diisi_oleh, diisi_at = datetime('now')`)
      .bind(tgl, sesiId, g.id, g.lingkungan, u.id).run();
    const sesi = await db.prepare("SELECT id FROM absensi_sesi WHERE jenis = 'kegiatan' AND tanggal = ? AND sesi_pilihan_id = ? AND target_id = ?").bind(tgl, sesiId, g.id).first();
    const oto = await H.statusOtomatis(db, [...anggota], tgl);
    const st = items.map((i) => {
      const o = oto[+i.santri_id];
      const v = o || { status_kehadiran_id: +i.status_kehadiran_id, sumber: "manual", izin_id: null, keterangan: bersih(i.keterangan, 120) };
      return db.prepare(`INSERT INTO absensi (sesi_id, santri_id, status_kehadiran_id, sumber, izin_id, kunjungan_id, keterangan, lingkungan) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT (sesi_id, santri_id) DO UPDATE SET status_kehadiran_id = excluded.status_kehadiran_id, sumber = excluded.sumber, izin_id = excluded.izin_id, kunjungan_id = excluded.kunjungan_id, keterangan = excluded.keterangan`)
        .bind(sesi.id, +i.santri_id, v.status_kehadiran_id, v.sumber, v.izin_id, v.kunjungan_id || null, v.keterangan, g.lingkungan);
    });
    const bagian = kf === null ? "" : kf ? " · " + kel.nama : " · tanpa kelompok";
    st.push(H.stmtCatat(db, u, "kesantrian", "absensi_kegiatan", "absensi_sesi", sesi.id, `${g.nama}${bagian} ${tgl}: ${items.length} santri`, g.lingkungan));
    await db.batch(st);
    return json({ ok: true, sesi_id: sesi.id });
  });

  // Rekap per cabang: jumlah per status dan % hadir (status_kehadiran.dihitung_hadir) per santri. Keaktifan ekskul = angka ini.
  // Kolom kelompok = kelompok terakhir santri di cabang ini (untuk saringan di tampilan).
  on("GET", "/api/absensi-kegiatan/rekap", async ({ db, u, url }) => {
    wajib(u, "lihat_absensi");
    const g = await ambilGrup(db, u, url.searchParams.get("grup_id"));
    const { dari, sampai } = rentang(url);
    const [hR, sR, nR] = await db.batch([
      db.prepare(`SELECT a.santri_id, a.status_kehadiran_id, COUNT(*) n FROM absensi a JOIN absensi_sesi se ON se.id = a.sesi_id
        WHERE se.jenis = 'kegiatan' AND se.target_id = ? AND se.tanggal BETWEEN ? AND ? GROUP BY a.santri_id, a.status_kehadiran_id`).bind(g.id, dari, sampai),
      db.prepare(`SELECT s.id, s.nis, s.nama, s.foto_url, (SELECT kk.nama FROM anggota_grup ag LEFT JOIN kelompok_kegiatan kk ON kk.id = ag.kelompok_id
          WHERE ag.grup_id = ${+g.id} AND ag.santri_id = s.id ORDER BY ag.mulai DESC, ag.id DESC LIMIT 1) kelompok FROM santri s WHERE s.id IN (
          SELECT santri_id FROM anggota_grup WHERE grup_id = ? AND mulai <= ? AND (selesai IS NULL OR selesai > ?)
          UNION SELECT a.santri_id FROM absensi a JOIN absensi_sesi se ON se.id = a.sesi_id WHERE se.jenis = 'kegiatan' AND se.target_id = ? AND se.tanggal BETWEEN ? AND ?)
        ORDER BY s.nama`).bind(g.id, sampai, dari, g.id, dari, sampai),
      db.prepare("SELECT COUNT(*) n FROM absensi_sesi WHERE jenis = 'kegiatan' AND target_id = ? AND tanggal BETWEEN ? AND ?").bind(g.id, dari, sampai),
    ]);
    const hadirId = new Set((await db.prepare("SELECT id FROM status_kehadiran WHERE dihitung_hadir = 1").all()).results.map((r) => r.id));
    const per = {};
    for (const r of hR.results) (per[r.santri_id] ||= {})[r.status_kehadiran_id] = r.n;
    const baris = sR.results.map((s) => {
      const st = per[s.id] || {};
      const total = Object.values(st).reduce((a, b) => a + b, 0);
      const hadir = Object.entries(st).filter(([k]) => hadirId.has(+k)).reduce((a, [, n]) => a + n, 0);
      return { ...s, status: st, total, hadir, persen: total ? Math.round((hadir / total) * 1000) / 10 : null };
    });
    return json({ grup: g, dari, sampai, jumlah_sesi: nR.results[0].n, santri: baris });
  });

  // ------------------------------------------------------------ prestasi (tanpa hapus)
  on("GET", "/api/prestasi", async ({ db, u, url }) => {
    wajib(u, "lihat_prestasi");
    const l = lingIn(u, "p.lingkungan");
    const w = [l.sql], a = [...l.args];
    const dari = url.searchParams.get("dari"), sampai = url.searchParams.get("sampai");
    if (dari) { if (!TGL.test(dari)) gagal(400, "Tanggal tidak valid."); w.push("p.tanggal >= ?"); a.push(dari); }
    if (sampai) { if (!TGL.test(sampai)) gagal(400, "Tanggal tidak valid."); w.push("p.tanggal <= ?"); a.push(sampai); }
    if (url.searchParams.get("tingkat_id")) { w.push("p.tingkat_lomba_id = ?"); a.push(+url.searchParams.get("tingkat_id")); }
    const q = (url.searchParams.get("q") || "").trim();
    if (q) { w.push("(s.nama LIKE ? OR s.nis LIKE ? OR p.nama_kegiatan LIKE ? OR p.lokasi LIKE ?)"); a.push(`%${q}%`, `${q}%`, `%${q}%`, `%${q}%`); }
    if (url.searchParams.get("hasil_id")) { w.push("p.hasil_lomba_id = ?"); a.push(+url.searchParams.get("hasil_id")); }
    if (url.searchParams.get("santri_id")) { w.push("p.santri_id = ?"); a.push(+url.searchParams.get("santri_id")); }
    const r = await db.prepare(
      `SELECT p.*, s.nis, s.nama, s.foto_url, pt.nama tingkat, ph.nama hasil, km.nama kamar, (k.tingkat || ' ' || k.rombel || ' ' || j.nama) kelas
       FROM prestasi p JOIN santri s ON s.id = p.santri_id LEFT JOIN pilihan pt ON pt.id = p.tingkat_lomba_id LEFT JOIN pilihan ph ON ph.id = p.hasil_lomba_id
       LEFT JOIN kamar km ON km.id = s.kamar_id LEFT JOIN kelas k ON k.id = s.kelas_id LEFT JOIN jenjang j ON j.id = k.jenjang_id
       WHERE ${w.join(" AND ")} ORDER BY p.tanggal DESC, p.id DESC LIMIT 1000`).bind(...a).all();
    return json(r.results);
  });

  on("POST", "/api/prestasi", async ({ db, u, body }) => {
    wajib(u, "prestasi");
    let lama = null;
    if (body.id) {
      lama = await db.prepare("SELECT * FROM prestasi WHERE id = ?").bind(+body.id).first();
      if (!lama) gagal(404, "Prestasi tidak ditemukan.");
      cekLing(u, lama.lingkungan);
    }
    // Santri tidak bisa diganti saat mengubah: salah santri = catat ulang (riwayat tetap jelas).
    const s = await db.prepare("SELECT id, nis, nama, lingkungan, status FROM santri WHERE id = ?").bind(lama ? lama.santri_id : +body.santri_id || 0).first();
    if (!s) gagal(400, "Pilih santri.");
    cekLing(u, s.lingkungan);
    const d = { nama_kegiatan: bersih(body.nama_kegiatan, 150), lokasi: bersih(body.lokasi, 120), keterangan: bersih(body.keterangan, 300), tanggal: String(body.tanggal || "") };
    if (!d.nama_kegiatan) gagal(400, "Nama kegiatan wajib diisi.");
    if (!TGL.test(d.tanggal)) gagal(400, "Tanggal tidak valid.");
    if (d.tanggal > hariIni()) gagal(400, "Tanggal prestasi tidak boleh di masa mendatang.");
    const tingkat = +body.tingkat_lomba_id || null, hasil = +body.hasil_lomba_id || null;
    const pil = Object.fromEntries((await db.prepare("SELECT id, kelompok, lingkungan FROM pilihan WHERE id IN (?, ?)").bind(tingkat || 0, hasil || 0).all()).results.map((x) => [x.id, x]));
    const cocok = (id, kel) => !id || (pil[id] && pil[id].kelompok === kel && ["semua", s.lingkungan].includes(pil[id].lingkungan));
    if (!tingkat || !cocok(tingkat, "tingkat_lomba")) gagal(400, "Pilih tingkat lomba.");
    if (!hasil || !cocok(hasil, "hasil_lomba")) gagal(400, "Pilih hasil lomba.");
    let id;
    if (lama) {
      await db.prepare("UPDATE prestasi SET nama_kegiatan = ?, lokasi = ?, tingkat_lomba_id = ?, hasil_lomba_id = ?, keterangan = ?, tanggal = ? WHERE id = ?")
        .bind(d.nama_kegiatan, d.lokasi, tingkat, hasil, d.keterangan, d.tanggal, lama.id).run();
      id = lama.id;
    } else {
      id = (await db.prepare("INSERT INTO prestasi (santri_id, lingkungan, nama_kegiatan, lokasi, tingkat_lomba_id, hasil_lomba_id, keterangan, tanggal, dicatat_oleh) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(s.id, s.lingkungan, d.nama_kegiatan, d.lokasi, tingkat, hasil, d.keterangan, d.tanggal, u.id).run()).meta.last_row_id;
      // kabar baik untuk guru binaan (wali kelas / wali asuh) lewat lonceng
      await H.stmtNotifGuru(db, s.id, { judul: `Prestasi — ${s.nama}`, isi: d.nama_kegiatan + (d.lokasi ? ` (${d.lokasi})` : "") }).run();
    }
    await H.catat(db, u, "kesantrian", lama ? "prestasi_ubah" : "prestasi_tambah", "prestasi", id, `${s.nis} ${s.nama}: ${d.nama_kegiatan}`, s.lingkungan);
    return json({ ok: true, id });
  });
}
