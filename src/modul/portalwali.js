// Modul Portal Wali — /api/wali/* untuk halaman public/wali.html.
// Sesi sendiri (cookie "hisada_wali", tabel sesi_wali, hanya dikirim ke /api/wali): sesi pengurus tidak memberi akses wali dan sebaliknya.
// Data anak read-only; tanpa diagnosa/keluhan, tanpa isi/keterangan pelanggaran.
export default function (H) {
  const { on, json, gagal, wib, hariIni, bersih, sha256, randomHex, hashPassword, cekPassword, normalHp, stmtEmail } = H;
  const COOKIE = "hisada_wali";
  const cookie = (token, maxAge) => `${COOKIE}=${token}; Path=/api/wali; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
  const ambil = (req) => { const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)hisada_wali=([^;]+)/); return m ? decodeURIComponent(m[1]) : null; };
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const iso = (ms) => new Date(ms).toISOString();
  const KAKI = "\n\n— HISADA, Pesantren Modern Daarul 'Uluum Lido";
  const PESAN_TERKIRIM = "Bila data sesuai, email telah dikirim. Periksa kotak masuk (dan folder spam).";

  async function akunSesi(db, req) {
    const t = ambil(req);
    if (!t) return null;
    return await db.prepare(`SELECT a.* FROM sesi_wali s JOIN akun_wali a ON a.id = s.akun_wali_id WHERE s.token_hash = ? AND s.kedaluwarsa > ? AND a.status = 'aktif'`)
      .bind(await sha256(t), iso(Date.now())).first();
  }
  async function wajibWali(db, req) {
    const a = await akunSesi(db, req);
    if (!a) gagal(401, "Silakan masuk ke Portal Wali.");
    return a;
  }
  // Token sekali pakai (disimpan hash-nya saja) + email berisi tautan.
  async function stmtToken(db, akun, jenis, jam) {
    const token = randomHex(24);
    const st = [
      db.prepare("UPDATE token_akun SET dipakai_at = ? WHERE akun_wali_id = ? AND jenis = ? AND dipakai_at IS NULL").bind(wib(), akun.id, jenis),
      db.prepare("INSERT INTO token_akun (akun_wali_id, jenis, token_hash, kedaluwarsa) VALUES (?,?,?,?)").bind(akun.id, jenis, await sha256(token), iso(Date.now() + jam * 3600e3)),
    ];
    const verif = jenis === "verifikasi_email";
    const link = `${H.APP()}/wali.html#/${verif ? "verifikasi" : "reset"}?token=${token}`;
    st.push(stmtEmail(db, {
      penerima: akun.email, jenis: "akun", tabel: "akun_wali", id: akun.id, akun_wali_id: akun.id,
      subjek: verif ? "[HISADA] Verifikasi email Portal Wali" : "[HISADA] Atur ulang password Portal Wali",
      isi: `Assalamu'alaikum ${akun.nama},\n\n` + (verif
        ? `Terima kasih telah mendaftar di Portal Wali Santri. Buka tautan berikut untuk memverifikasi email Anda (berlaku 24 jam):\n${link}`
        : `Ada permintaan mengatur ulang password Portal Wali Anda. Buka tautan berikut (berlaku 1 jam):\n${link}\n\nAbaikan email ini bila Anda tidak memintanya.`) + KAKI,
    }));
    return st;
  }
  async function pakaiToken(db, token, jenis) {
    if (!/^[0-9a-f]{48}$/.test(String(token || ""))) gagal(400, "Tautan tidak valid.");
    const t = await db.prepare("SELECT * FROM token_akun WHERE token_hash = ? AND jenis = ? AND akun_wali_id IS NOT NULL").bind(await sha256(token), jenis).first();
    if (!t || t.dipakai_at) gagal(400, "Tautan tidak valid atau sudah dipakai.");
    if (t.kedaluwarsa < iso(Date.now())) gagal(400, "Tautan sudah kedaluwarsa. Minta tautan baru.");
    return t;
  }

  // ---------------------------------------------------------------- daftar & verifikasi
  on("POST", "/api/wali/daftar", async ({ db, body }) => {
    const nama = bersih(body.nama, 120), email = bersih(body.email, 120)?.toLowerCase(), hp = normalHp(bersih(body.no_hp, 20));
    const pw = String(body.password || "");
    if (!nama || !email || !EMAIL.test(email)) gagal(400, "Isi nama dan email yang valid.");
    if (!hp || !/^62\d{8,13}$/.test(hp)) gagal(400, "No. HP tidak valid. Gunakan nomor yang terdaftar di pondok.");
    if (pw.length < 8) gagal(400, "Password minimal 8 karakter.");
    if (body.setuju !== true) gagal(400, "Centang persetujuan penggunaan data untuk melanjutkan.");
    const ada = await db.prepare("SELECT id, nama, email, status FROM akun_wali WHERE email = ?").bind(email).first();
    if (ada) {
      // Tidak membocorkan bahwa email sudah terdaftar; pemiliknya diberi tahu lewat email.
      if (ada.status === "belum_verifikasi") await db.batch(await stmtToken(db, ada, "verifikasi_email", 24));
      else await H.antreEmail(db, { penerima: ada.email, jenis: "akun", tabel: "akun_wali", id: ada.id, akun_wali_id: ada.id, subjek: "[HISADA] Pendaftaran Portal Wali",
        isi: `Assalamu'alaikum ${ada.nama},\n\nAda pendaftaran Portal Wali dengan email Anda, padahal email ini sudah terdaftar. Silakan masuk, atau gunakan "Lupa password" di ${H.APP()}/wali.html#/lupa` + KAKI });
      return json({ ok: true, pesan: "Pendaftaran diterima. " + PESAN_TERKIRIM });
    }
    const r = await db.prepare("INSERT INTO akun_wali (email, password_hash, nama, no_hp_normal, persetujuan_data_at, status) VALUES (?,?,?,?,?, 'belum_verifikasi')")
      .bind(email, await hashPassword(pw), nama, hp, wib()).run();
    await db.batch(await stmtToken(db, { id: r.meta.last_row_id, nama, email }, "verifikasi_email", 24));
    return json({ ok: true, pesan: "Pendaftaran diterima. " + PESAN_TERKIRIM });
  }, { publik: true });

  on("POST", "/api/wali/verifikasi", async ({ db, body }) => {
    const t = await pakaiToken(db, body.token, "verifikasi_email");
    await db.batch([
      db.prepare("UPDATE token_akun SET dipakai_at = ? WHERE id = ?").bind(wib(), t.id),
      db.prepare("UPDATE akun_wali SET status = 'aktif', email_terverifikasi_at = ? WHERE id = ? AND status = 'belum_verifikasi'").bind(wib(), t.akun_wali_id),
    ]);
    return json({ ok: true });
  }, { publik: true });

  // Kirim ulang tautan verifikasi; maks. sekali per 5 menit per akun. Jawaban selalu sama (tidak membocorkan email terdaftar).
  on("POST", "/api/wali/kirim-verifikasi", async ({ db, body }) => {
    const email = bersih(body.email, 120)?.toLowerCase();
    const a = email && await db.prepare("SELECT id, nama, email, status FROM akun_wali WHERE email = ?").bind(email).first();
    if (a && a.status === "belum_verifikasi") {
      const baru = await db.prepare("SELECT 1 FROM token_akun WHERE akun_wali_id = ? AND jenis = 'verifikasi_email' AND dipakai_at IS NULL AND kedaluwarsa > ?")
        .bind(a.id, iso(Date.now() + 24 * 3600e3 - 5 * 60e3)).first();
      if (!baru) await db.batch(await stmtToken(db, a, "verifikasi_email", 24));
    }
    return json({ ok: true, pesan: PESAN_TERKIRIM });
  }, { publik: true });

  // ---------------------------------------------------------------- masuk, keluar, lupa password
  on("POST", "/api/wali/masuk", async ({ db, body }) => {
    const email = String(body.email || "").trim().toLowerCase();
    const a = await db.prepare("SELECT * FROM akun_wali WHERE email = ?").bind(email).first();
    const salah = () => gagal(401, "Email atau password salah.");
    if (!a) { await cekPassword("x", "pbkdf2$100000$00$00"); salah(); }
    if (a.terkunci_sampai && a.terkunci_sampai > wib()) gagal(429, "Terlalu banyak percobaan. Coba lagi nanti.");
    if (!(await cekPassword(String(body.password || ""), a.password_hash))) {
      const batas = +(await H.pengaturan(db, "login.batas_gagal", "5"));
      const menit = +(await H.pengaturan(db, "login.lama_kunci_menit", "15"));
      const n = a.gagal_login + 1;
      await db.prepare("UPDATE akun_wali SET gagal_login = ?, terkunci_sampai = ? WHERE id = ?")
        .bind(n >= batas ? 0 : n, n >= batas ? wib(Date.now() + menit * 60e3) : null, a.id).run();
      salah();
    }
    if (a.status === "belum_verifikasi") gagal(403, "Email belum diverifikasi. Buka tautan verifikasi di email Anda, atau kirim ulang tautannya.");
    if (a.status !== "aktif") gagal(403, "Akun dinonaktifkan. Hubungi pondok.");
    const token = randomHex(32);
    const jam = +(await H.pengaturan(db, "sesi.lama_jam", "12"));
    await db.batch([
      db.prepare("DELETE FROM sesi_wali WHERE kedaluwarsa < ?").bind(iso(Date.now())),
      db.prepare("INSERT INTO sesi_wali (token_hash, akun_wali_id, kedaluwarsa) VALUES (?,?,?)").bind(await sha256(token), a.id, iso(Date.now() + jam * 3600e3)),
      db.prepare("UPDATE akun_wali SET gagal_login = 0, terkunci_sampai = NULL WHERE id = ?").bind(a.id),
    ]);
    return json({ ok: true }, 200, { "set-cookie": cookie(token, jam * 3600) });
  }, { publik: true });

  on("POST", "/api/wali/keluar", async ({ db, req }) => {
    const t = ambil(req);
    if (t) await db.prepare("DELETE FROM sesi_wali WHERE token_hash = ?").bind(await sha256(t)).run();
    return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  }, { publik: true });

  on("POST", "/api/wali/lupa", async ({ db, body }) => {
    const email = bersih(body.email, 120)?.toLowerCase();
    const a = email && await db.prepare("SELECT id, nama, email, status FROM akun_wali WHERE email = ?").bind(email).first();
    if (a && a.status !== "nonaktif") {
      const baru = await db.prepare("SELECT 1 FROM token_akun WHERE akun_wali_id = ? AND jenis = 'reset_password' AND dipakai_at IS NULL AND kedaluwarsa > ?")
        .bind(a.id, iso(Date.now() + 3600e3 - 2 * 60e3)).first();
      if (!baru) await db.batch(await stmtToken(db, a, "reset_password", 1));
    }
    return json({ ok: true, pesan: PESAN_TERKIRIM });
  }, { publik: true });

  // Reset lewat tautan email juga membuktikan kepemilikan email → akun yang belum terverifikasi ikut aktif.
  on("POST", "/api/wali/reset", async ({ db, body }) => {
    const pw = String(body.password || "");
    if (pw.length < 8) gagal(400, "Password minimal 8 karakter.");
    const t = await pakaiToken(db, body.token, "reset_password");
    await db.batch([
      db.prepare("UPDATE token_akun SET dipakai_at = ? WHERE id = ?").bind(wib(), t.id),
      db.prepare(`UPDATE akun_wali SET password_hash = ?, gagal_login = 0, terkunci_sampai = NULL,
        status = CASE WHEN status = 'belum_verifikasi' THEN 'aktif' ELSE status END, email_terverifikasi_at = COALESCE(email_terverifikasi_at, ?) WHERE id = ?`)
        .bind(await hashPassword(pw), wib(), t.akun_wali_id),
      db.prepare("DELETE FROM sesi_wali WHERE akun_wali_id = ?").bind(t.akun_wali_id),
    ]);
    return json({ ok: true });
  }, { publik: true });

  // ---------------------------------------------------------------- akun saya & tautkan anak
  const KOLOM_ANAK = `s.id, s.nis, s.nama, s.foto_url, s.lingkungan, km.nama kamar, (k.tingkat || ' ' || k.rombel || ' ' || j.nama || COALESCE(' ' || k.label, '')) kelas`;
  const JOIN_ANAK = `LEFT JOIN kamar km ON km.id = s.kamar_id LEFT JOIN kelas k ON k.id = s.kelas_id LEFT JOIN jenjang j ON j.id = k.jenjang_id`;

  on("GET", "/api/wali/saya", async ({ db, req }) => {
    const a = await wajibWali(db, req);
    const anak = await db.prepare(`SELECT ${KOLOM_ANAK} FROM tautan_wali t JOIN santri s ON s.id = t.santri_id ${JOIN_ANAK}
      WHERE t.akun_wali_id = ? AND t.dicabut_at IS NULL ORDER BY s.nama`).bind(a.id).all();
    return json({
      nama: a.nama, email: a.email, no_hp: a.no_hp_normal ? a.no_hp_normal.slice(0, 4) + "••••" + a.no_hp_normal.slice(-3) : null,
      terkunci_tautan_sampai: a.terkunci_tautan_sampai && a.terkunci_tautan_sampai > wib() ? a.terkunci_tautan_sampai : null,
      anak: anak.results,
    });
  }, { publik: true });

  on("POST", "/api/wali/tautkan", async ({ db, req, body }) => {
    const a = await wajibWali(db, req);
    const kunci = "Penautan dikunci sementara karena terlalu banyak percobaan gagal. Coba lagi setelah ";
    if (a.terkunci_tautan_sampai && a.terkunci_tautan_sampai > wib()) gagal(429, kunci + a.terkunci_tautan_sampai + " WIB, atau hubungi pondok.");
    const nis = String(body.nis || "").trim(), tgl = String(body.tanggal_lahir || "").trim();
    if (!/^\d{4,12}$/.test(nis) || !/^\d{4}-\d{2}-\d{2}$/.test(tgl)) gagal(400, "Isi NIS dan tanggal lahir anak.");
    const cocok = a.no_hp_normal && await db.prepare(
      `SELECT s.id, s.nama, s.lingkungan, w.id wali_id FROM santri s JOIN santri_wali sw ON sw.santri_id = s.id JOIN wali w ON w.id = sw.wali_id
       WHERE s.nis = ? AND s.tanggal_lahir = ? AND s.status = 'aktif' AND w.no_hp_normal = ? LIMIT 1`).bind(nis, tgl, a.no_hp_normal).first();
    if (!cocok) {
      const batas = +(await H.pengaturan(db, "tautan_wali.batas_gagal_per_hari", "5"));
      const jam = +(await H.pengaturan(db, "tautan_wali.lama_kunci_jam", "24"));
      const [, n] = await db.batch([
        db.prepare("INSERT INTO percobaan_tautan (akun_wali_id, waktu, berhasil) VALUES (?,?,0)").bind(a.id, wib()),
        db.prepare("SELECT COUNT(*) n FROM percobaan_tautan WHERE akun_wali_id = ? AND berhasil = 0 AND waktu >= ?").bind(a.id, hariIni() + " 00:00"),
      ]);
      if (n.results[0].n >= batas) {
        const sampai = wib(Date.now() + jam * 3600e3);
        await db.prepare("UPDATE akun_wali SET terkunci_tautan_sampai = ? WHERE id = ?").bind(sampai, a.id).run();
        gagal(429, kunci + sampai + " WIB, atau hubungi pondok.");
      }
      // Pesan sengaja tidak menyebut bagian mana yang tidak cocok.
      gagal(400, `Data tidak cocok dengan catatan pondok (sisa percobaan hari ini: ${batas - n.results[0].n}). Pastikan NIS, tanggal lahir anak, dan No. HP akun Anda sesuai data pondok. `
        + "Bila tetap gagal, hubungi pondok: Moderator dapat menautkan secara manual atau memperbarui No. HP Anda.");
    }
    const sudah = await db.prepare("SELECT id FROM tautan_wali WHERE akun_wali_id = ? AND santri_id = ? AND dicabut_at IS NULL").bind(a.id, cocok.id).first();
    if (sudah) return json({ ok: true, sudah: true });
    const lain = (await db.prepare(`SELECT ak.id, ak.nama, ak.email FROM tautan_wali t JOIN akun_wali ak ON ak.id = t.akun_wali_id
      WHERE t.santri_id = ? AND t.dicabut_at IS NULL AND ak.status = 'aktif' AND ak.id <> ?`).bind(cocok.id, a.id).all()).results;
    await db.batch([
      db.prepare("INSERT INTO tautan_wali (akun_wali_id, santri_id, lingkungan, wali_id, cara) VALUES (?,?,?,?, 'otomatis')").bind(a.id, cocok.id, cocok.lingkungan, cocok.wali_id),
      db.prepare("INSERT INTO percobaan_tautan (akun_wali_id, waktu, berhasil) VALUES (?,?,1)").bind(a.id, wib()),
      H.stmtCatat(db, null, "akun", "tautan_otomatis", "tautan_wali", null, `Portal Wali: ${a.email} menautkan santri ${nis}`, cocok.lingkungan),
      // Pengaman: wali yang sudah tertaut diberi tahu ada akun baru menautkan anak yang sama.
      ...lain.map((w) => stmtEmail(db, {
        penerima: w.email, jenis: "wali", tabel: "santri", id: cocok.id, akun_wali_id: w.id, lingkungan: cocok.lingkungan,
        subjek: `[HISADA] Akun baru menautkan anak Anda — ${cocok.nama}`,
        isi: `Assalamu'alaikum ${w.nama},\n\nAkun Portal Wali baru atas nama ${a.nama} baru saja menautkan anak Anda (${cocok.nama}). `
          + `Bila Anda tidak mengenal akun ini, segera hubungi pondok agar tautannya dicabut.${KAKI}`,
      })),
    ]);
    return json({ ok: true, santri: cocok.nama });
  }, { publik: true });

  // ---------------------------------------------------------------- data anak (read-only)
  on("GET", "/api/wali/anak/:id", async ({ db, req, p }) => {
    const a = await wajibWali(db, req);
    const s = await db.prepare(`SELECT ${KOLOM_ANAK} FROM tautan_wali t JOIN santri s ON s.id = t.santri_id ${JOIN_ANAK}
      WHERE t.akun_wali_id = ? AND t.santri_id = ? AND t.dicabut_at IS NULL`).bind(a.id, p.id).first();
    if (!s) gagal(404, "Anak tidak ditemukan atau belum tertaut ke akun Anda.");
    const h90 = wib(Date.now() - 90 * 864e5), h30 = wib(Date.now() - 30 * 864e5).slice(0, 10);
    const [izin, absen, rawat, kunjungan, disiplin, prestasi] = await db.batch([
      db.prepare(`SELECT z.id, ji.nama jenis, ji.basis_waktu, z.keterangan, z.berangkat, z.rencana_kembali, z.kembali_at, z.status, z.overdue_dikoreksi_at
        FROM izin z JOIN jenis_izin ji ON ji.id = z.jenis_izin_id
        WHERE z.santri_id = ? AND z.status <> 'dibatalkan' AND (z.status IN ('berjalan','overdue') OR z.berangkat >= ?) ORDER BY z.berangkat DESC LIMIT 100`).bind(s.id, h90),
      db.prepare(`SELECT sk.kode, sk.nama, sk.warna, COUNT(*) n FROM absensi ab JOIN absensi_sesi se ON se.id = ab.sesi_id JOIN status_kehadiran sk ON sk.id = ab.status_kehadiran_id
        WHERE ab.santri_id = ? AND se.tanggal >= ? GROUP BY sk.id ORDER BY sk.urutan`).bind(s.id, h30),
      db.prepare(`SELECT COUNT(*) n FROM kunjungan_kesehatan k JOIN jenis_kunjungan jk ON jk.id = k.jenis_kunjungan_id
        WHERE k.santri_id = ? AND k.status = 'aktif' AND jk.status_kehadiran_id IS NOT NULL AND k.selesai_rawat_at IS NULL`).bind(s.id),
      // hanya tanggal kunjungan — TANPA keluhan/diagnosa
      db.prepare(`SELECT substr(k.waktu, 1, 10) tanggal, substr(k.selesai_rawat_at, 1, 10) selesai, (jk.status_kehadiran_id IS NOT NULL) dirawat
        FROM kunjungan_kesehatan k JOIN jenis_kunjungan jk ON jk.id = k.jenis_kunjungan_id
        WHERE k.santri_id = ? AND k.status = 'aktif' AND k.waktu >= ? ORDER BY k.waktu DESC LIMIT 50`).bind(s.id, h90),
      // vonis berlaku = vonis terbaru yang tidak digantikan; pemutihan & pelanggaran batal tidak ditampilkan; tanpa keterangan/hukuman
      db.prepare(`SELECT p.tanggal, kp.nama kategori, tv.nama tingkat FROM pelanggaran p JOIN pilihan kp ON kp.id = p.kategori_id
        JOIN vonis v ON v.pelanggaran_id = p.id AND NOT EXISTS (SELECT 1 FROM vonis v2 WHERE v2.menggantikan_vonis_id = v.id)
        JOIN tingkat_vonis tv ON tv.id = v.tingkat_vonis_id
        WHERE p.santri_id = ? AND p.status = 'divonis' AND tv.adalah_pemutihan = 0 ORDER BY p.tanggal DESC LIMIT 100`).bind(s.id),
      db.prepare(`SELECT pr.tanggal, pr.nama_kegiatan, pr.lokasi, tl.nama tingkat, hl.nama hasil FROM prestasi pr
        LEFT JOIN pilihan tl ON tl.id = pr.tingkat_lomba_id LEFT JOIN pilihan hl ON hl.id = pr.hasil_lomba_id
        WHERE pr.santri_id = ? ORDER BY pr.tanggal DESC LIMIT 100`).bind(s.id),
    ]);
    const now = wib();
    return json({
      santri: s,
      izin: izin.results.map((z) => ({ ...z, keadaan: z.status === "berjalan" && z.rencana_kembali < now ? "terlambat" : z.status })),
      absensi_30_hari: absen.results,
      kesehatan: { sedang_dirawat: rawat.results[0].n > 0, kunjungan: kunjungan.results },
      kedisiplinan: disiplin.results,
      prestasi: prestasi.results,
    });
  }, { publik: true });

  // Kabar yang pernah dikirim ke akun ini (isi email memang tanpa data sensitif).
  on("GET", "/api/wali/kabar", async ({ db, req }) => {
    const a = await wajibWali(db, req);
    const r = await db.prepare(`SELECT id, subjek, isi, jenis, status, dibuat_at, koreksi_dari_id FROM email_antrean
      WHERE akun_wali_id = ? AND jenis IN ('wali','pengumuman') ORDER BY id DESC LIMIT 50`).bind(a.id).all();
    return json(r.results);
  }, { publik: true });
}
