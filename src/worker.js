// HISADA — server aplikasi (Cloudflare Workers + D1).
// Semua /api/* ditangani di sini; selain itu disajikan dari folder public/ (aplikasi web).
// Rahasia TIDAK disimpan di kode: SETUP_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET diatur di
// dashboard Cloudflare (Settings → Variables and Secrets).

import { MIGRATIONS } from "./schema.js";

// ---------------------------------------------------------------- util
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

// Waktu lokal pondok (WIB, UTC+7) sebagai teks "YYYY-MM-DD HH:MM".
const wib = (ms = Date.now()) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
const hariIni = () => wib().slice(0, 10);
const keMs = (s) => Date.parse(s.replace(" ", "T") + ":00+07:00");

class Galat extends Error {
  constructor(status, pesan) { super(pesan); this.status = status; }
}
const gagal = (status, pesan) => { throw new Galat(status, pesan); };
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers } });

const normalHp = (s) => {
  if (!s) return null;
  let d = String(s).replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("0")) d = "62" + d.slice(1);
  else if (d.startsWith("8")) d = "62" + d;
  return d;
};
const bersih = (s, max = 200) => (s == null ? null : String(s).trim().slice(0, max) || null);

// ---------------------------------------------------------------- password (PBKDF2-SHA256)
async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  return `pbkdf2$100000$${hex(salt)}$${hex(bits)}`;
}
async function cekPassword(pw, stored) {
  if (!stored) return false;
  const [alg, iter, saltHex, hashHex] = stored.split("$");
  if (alg !== "pbkdf2") return false;
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: +iter }, key, 256));
  if (bits.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}
// Password sementara ACAK (bukan dari NIS/tanggal lahir yang bisa ditebak): ditampilkan sekali ke pembuat akun, wajib diganti saat masuk.
const HURUF_SANDI = "abcdefghijkmnpqrstuvwxyz23456789"; // 32 huruf, tanpa l/o/0/1 yang mirip
const passwordSementara = () => {
  const h = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => HURUF_SANDI[b & 31]).join("");
  return h.slice(0, 5) + "-" + h.slice(5);
};

// ---------------------------------------------------------------- migrasi otomatis
let sudahMigrasi = false;
// Migrasi tambahan milik modul (src/modul/*.js) didaftarkan lewat H.migrasi(); id: lihat src/modul/README.
const MIGRASI_MODUL = [];
async function migrate(db) {
  if (sudahMigrasi) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS _migrasi (id INTEGER PRIMARY KEY, nama TEXT, waktu TEXT DEFAULT (datetime('now')))").run();
  const done = new Set((await db.prepare("SELECT id FROM _migrasi").all()).results.map((r) => r.id));
  for (const m of [...MIGRATIONS, ...MIGRASI_MODUL].sort((a, b) => a.id - b.id)) {
    if (done.has(m.id)) continue;
    const stmts = m.sql.map((s) => db.prepare(s));
    stmts.push(db.prepare("INSERT INTO _migrasi (id, nama) VALUES (?, ?)").bind(m.id, m.nama));
    await db.batch(stmts);
  }
  sudahMigrasi = true;
}

// ---------------------------------------------------------------- sesi & hak akses
const COOKIE = "hisada_sesi";
const ambilCookie = (req, nama) => {
  const c = req.headers.get("cookie") || "";
  const m = c.match(new RegExp("(?:^|;\\s*)" + nama + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
};
const cookieSesi = (token, maxAge) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function pengaturan(db, kunci, bawaan) {
  const r = await db.prepare("SELECT nilai FROM pengaturan WHERE kunci = ?").bind(kunci).first();
  return r ? r.nilai : bawaan;
}

// ---------------------------------------------------------------- batas percobaan per IP
// "jumlah/menit"; bisa diubah lewat pengaturan "batas_ip.<jenis>". Login & tautkan: hanya percobaan GAGAL yang dihitung
// (satu jaringan pondok dipakai banyak orang); permintaan yang mengirim email: setiap permintaan dihitung.
const BATAS_IP = { login: "20/15", wali_masuk: "20/15", wali_email: "10/60", wali_tautkan: "10/60" };
async function kunciIp(db, req, jenis) {
  const [n, menit] = String(await pengaturan(db, "batas_ip." + jenis, BATAS_IP[jenis])).split("/").map(Number);
  const ip = req.headers.get("cf-connecting-ip") || "lokal";
  const jendela = Math.floor(Date.now() / ((menit || 15) * 60e3));
  return { kunci: `${jenis}:${(await sha256(ip)).slice(0, 32)}:${jendela}`, batas: n || 20 };
}
// hitung = true: permintaan ini ikut dihitung lalu diperiksa; false: hanya diperiksa (yang gagal dicatat lewat catatGagalIp).
async function batasIp(db, req, jenis, hitung = false) {
  const k = await kunciIp(db, req, jenis);
  const r = hitung
    ? await db.prepare("INSERT INTO batas_ip (kunci, n) VALUES (?, 1) ON CONFLICT(kunci) DO UPDATE SET n = n + 1 RETURNING n").bind(k.kunci).first()
    : await db.prepare("SELECT n FROM batas_ip WHERE kunci = ?").bind(k.kunci).first();
  if (r && (hitung ? r.n > k.batas : r.n >= k.batas)) gagal(429, "Terlalu banyak percobaan dari jaringan ini. Coba lagi nanti.");
}
async function catatGagalIp(db, req, jenis) {
  const k = await kunciIp(db, req, jenis);
  await db.prepare("INSERT INTO batas_ip (kunci, n) VALUES (?, 1) ON CONFLICT(kunci) DO UPDATE SET n = n + 1").bind(k.kunci).run();
}

// Cloudflare Turnstile (anti-robot) untuk formulir publik Portal Wali. Aktif hanya bila TURNSTILE_SECRET (secret) diatur;
// site key (bukan rahasia) di variabel TURNSTILE_SITEKEY.
async function cekTurnstile(env, req, token) {
  if (!env.TURNSTILE_SECRET) return;
  if (!token) gagal(400, "Selesaikan verifikasi anti-robot terlebih dahulu.");
  const f = new FormData();
  f.append("secret", env.TURNSTILE_SECRET); f.append("response", String(token).slice(0, 2048));
  const ip = req.headers.get("cf-connecting-ip");
  if (ip) f.append("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: f }).then((x) => x.json()).catch(() => null);
  if (!r || !r.success) gagal(400, "Verifikasi anti-robot gagal. Muat ulang halaman lalu coba lagi.");
}

async function buatSesi(db, userId) {
  const token = randomHex(32);
  const jam = +(await pengaturan(db, "sesi.lama_jam", "12")) || 12;
  const exp = new Date(Date.now() + jam * 3600e3).toISOString();
  await db.batch([
    db.prepare("DELETE FROM sesi_login WHERE kedaluwarsa < ?").bind(new Date().toISOString()),
    db.prepare("INSERT INTO sesi_login (token_hash, user_id, kedaluwarsa) VALUES (?, ?, ?)").bind(await sha256(token), userId, exp),
    db.prepare("UPDATE users SET login_terakhir = ?, gagal_login = 0, terkunci_sampai = NULL WHERE id = ?").bind(wib(), userId),
  ]);
  return { token, maxAge: jam * 3600 };
}

async function penggunaDariSesi(db, req) {
  const token = ambilCookie(req, COOKIE);
  if (!token) return null;
  const u = await db.prepare(
    `SELECT u.*, s.token_hash sesi_token, s.backup_sampai sesi_backup_sampai FROM sesi_login s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.kedaluwarsa > ? AND u.status = 'aktif'`
  ).bind(await sha256(token), new Date().toISOString()).first();
  if (!u) return null;
  const ak = await db.prepare("SELECT akses_kode FROM user_akses WHERE user_id = ?").bind(u.id).all();
  u.akses = ak.results.map((r) => r.akses_kode);
  u.ling = u.lingkungan === "semua" ? ["putra", "putri"] : [u.lingkungan];
  return u;
}

// Tanpa role: setiap akun memegang akses manual (user_akses). Preset = templat akses yang disalin ke akun saat diterapkan.
// Moderator adalah status khusus (users.role = 'moderator') = semua akses. "lihat_X" otomatis dimiliki siapa pun yang punya X.
const KEMAMPUAN = ["absensi", "lihat_absensi", "perizinan", "lihat_perizinan", "kesehatan", "pemeriksaan", "profil_kesehatan",
  "input_pelanggaran", "putusan_kedisiplinan", "lihat_vonis", "kegiatan", "prestasi", "lihat_prestasi", "rapor", "lihat_rapor",
  "tata_warkat", "pengumuman", "isi_pengurus", "update_kamar", "paw", "riwayat"];
// lihat_vonis tidak punya kode "vonis": pemegangnya adalah pemutus (hakim).
const LIHAT_DARI = { lihat_vonis: "putusan_kedisiplinan" };
const boleh = (u, kode) => u.role === "moderator" || u.akses.includes(kode)
  || (kode.startsWith("lihat_") && boleh(u, LIHAT_DARI[kode] || kode.slice(6)));
const wajib = (u, kode) => { if (!boleh(u, kode)) gagal(403, "Anda tidak punya akses untuk tindakan ini."); };
const wajibModerator = (u) => { if (u.role !== "moderator") gagal(403, "Hanya Moderator."); };
// Akun tanpa akses apa pun (baru dibuat / menunggu Moderator) tidak melihat data santri maupun kontak (HP/email guru, HP wali).
const adaAkses = (u) => u.role === "moderator" || u.akses.length > 0;
const wajibAdaAkses = (u) => { if (!adaAkses(u)) gagal(403, "Akun Anda belum diberi akses oleh Moderator."); };
// Email berpola akun santri (NIS@domain) tidak boleh dipakai untuk akun Moderator/guru (K-11).
const emailSantri = (email) => /^\d+@/.test(email);
// Preset dari {preset_id} atau {preset: "nama"}; null bila tidak diminta, galat bila tidak ditemukan.
async function cariPreset(db, body) {
  if (!body.preset_id && !body.preset) return null;
  const p = body.preset_id ? await db.prepare("SELECT * FROM preset WHERE id = ?").bind(+body.preset_id).first()
    : await db.prepare("SELECT * FROM preset WHERE lower(nama) = lower(?)").bind(String(body.preset)).first();
  if (!p) gagal(400, "Preset tidak ditemukan.");
  return p;
}
// Terapkan preset ke satu akun: akses akun DIGANTI dengan isi preset (salinan). userSql = "?" atau subkueri, mis. "(SELECT id FROM users WHERE santri_id = ?)".
function stmtTerapkanPreset(db, userSql, userArgs, presetSql, presetArgs, olehId = null) {
  return [
    db.prepare(`DELETE FROM user_akses WHERE user_id = ${userSql}`).bind(...userArgs),
    db.prepare(`INSERT OR IGNORE INTO user_akses (user_id, akses_kode, diberikan_oleh) SELECT ${userSql}, akses_kode, ? FROM preset_akses WHERE preset_id = ${presetSql}`)
      .bind(...userArgs, olehId, ...presetArgs),
    db.prepare(`UPDATE users SET preset_id = ${presetSql} WHERE id = ${userSql}`).bind(...presetArgs, ...userArgs),
  ];
}
const lingIn = (u, kolom = "lingkungan") => ({ sql: `${kolom} IN (${u.ling.map(() => "?").join(",")})`, args: u.ling });
const cekLing = (u, ling) => { if (!u.ling.includes(ling)) gagal(403, "Data di luar lingkungan Anda."); };

// Riwayat Perubahan: hanya tambah. Isi medis/vonis tidak boleh masuk ringkasan (K-06).
const stmtCatat = (db, u, kategori, aksi, tabel, dataId, ringkasan, lingkungan = "semua") =>
  db.prepare("INSERT INTO riwayat_perubahan (user_id, kategori, aksi, tabel, data_id, ringkasan, lingkungan, masa_khidmat_id) VALUES (?,?,?,?,?,?,?,(SELECT id FROM masa_khidmat WHERE status = 'aktif'))")
    .bind(u ? u.id : null, kategori, aksi, tabel, dataId, ringkasan, lingkungan);
async function catat(db, u, kategori, aksi, tabel, dataId, ringkasan, lingkungan = "semua") {
  await stmtCatat(db, u, kategori, aksi, tabel, dataId, ringkasan, lingkungan).run();
}

// Konfirmasi password pengguna yang sedang login untuk proses besar (Update Kelas Tahunan, Serah Terima, dst.).
async function cekSandi(u, pw) {
  if (!u.password_hash) gagal(400, "Akun Anda belum punya password. Buat dulu lewat menu Ganti password.");
  if (!(await cekPassword(String(pw || ""), u.password_hash))) gagal(403, "Password konfirmasi salah. Tidak ada perubahan.");
}
const taAktif = async (db) => (await db.prepare("SELECT * FROM tahun_ajaran WHERE status = 'aktif'").first()) || null;
const masaKhidmatAktif = async (db) => (await db.prepare("SELECT * FROM masa_khidmat WHERE status = 'aktif'").first()) || null;

// Akhir masa santri (alumni / mutasi keluar / meninggal) menutup semuanya (K-112):
// riwayat kelas & kamar, keanggotaan grup, jabatan, akun login, tautan Portal Wali. Riwayat tetap tersimpan.
const TUTUP_STATUS = ["alumni", "mutasi_keluar", "meninggal"];
function stmtUbahStatus(db, u, s, statusBaru, alasan = null, imporBatchId = null) {
  const t = hariIni(), st = [];
  if (s.status === statusBaru) return st;
  st.push(db.prepare("UPDATE santri SET status = ?, diubah_at = datetime('now') WHERE id = ?").bind(statusBaru, s.id));
  st.push(db.prepare("INSERT INTO riwayat_status_santri (santri_id, lingkungan, status_lama, status_baru, alasan, impor_batch_id, oleh) VALUES (?,?,?,?,?,?,?)")
    .bind(s.id, s.lingkungan, s.status, statusBaru, alasan, imporBatchId, u ? u.id : null));
  if (TUTUP_STATUS.includes(statusBaru)) {
    st.push(db.prepare("UPDATE riwayat_kelas SET selesai = ? WHERE santri_id = ? AND selesai IS NULL").bind(t, s.id));
    st.push(db.prepare("UPDATE riwayat_kamar SET selesai = ? WHERE santri_id = ? AND selesai IS NULL").bind(t, s.id));
    st.push(db.prepare("UPDATE santri SET kamar_id = NULL, menunggu_penempatan = 0 WHERE id = ?").bind(s.id));
    st.push(db.prepare("UPDATE anggota_grup SET selesai = ? WHERE santri_id = ? AND selesai IS NULL").bind(t, s.id));
    st.push(db.prepare("UPDATE pengurus SET selesai = ?, sebab_selesai = 'status_santri' WHERE santri_id = ? AND selesai IS NULL").bind(t, s.id));
    st.push(db.prepare("UPDATE users SET status = 'nonaktif' WHERE santri_id = ?").bind(s.id));
    st.push(db.prepare("DELETE FROM sesi_login WHERE user_id IN (SELECT id FROM users WHERE santri_id = ?)").bind(s.id));
    st.push(db.prepare("UPDATE tautan_wali SET dicabut_at = ? WHERE santri_id = ? AND dicabut_at IS NULL").bind(wib(), s.id));
  }
  return st;
}

// ---------------------------------------------------------------- email & kabar wali
// Semua email lewat antrean (email_antrean) lalu dikirim berkala (cron) lewat Gmail API akun pondok.
// Isi email singkat, TANPA data sensitif (diagnosa, isi vonis); rincian dibaca setelah login.
const APP = (env) => (env && env.APP_URL) || "https://hisada.216326.workers.dev";
let ENV = null; // diisi tiap permintaan/cron, dipakai untuk tautan di email
let EMAIL_DIBUAT = 0; // bertambah tiap email diantrekan; fetch memakainya untuk memicu kiriman langsung
const stmtEmail = (db, e) => (EMAIL_DIBUAT++, db.prepare(
  "INSERT INTO email_antrean (penerima, subjek, isi, jenis, tabel_terkait, id_terkait, akun_wali_id, koreksi_dari_id, lingkungan) VALUES (?,?,?,?,?,?,?,?,?)")
  .bind(e.penerima, e.subjek.slice(0, 200), e.isi, e.jenis, e.tabel || null, e.id || null, e.akun_wali_id || null, e.koreksi_dari_id || null, e.lingkungan || "semua"));
async function antreEmail(db, e) { await stmtEmail(db, e).run(); }

// ---------------------------------------------------------------- notifikasi lonceng (pengurus & guru)
// Isi singkat tanpa data sensitif (sama aturannya dengan email wali); rincian dibuka lewat tautan sesuai akses penerima.
const stmtNotif = (db, userId, { jenis, judul, isi = null, tautan = null }) =>
  db.prepare("INSERT INTO notifikasi (user_id, jenis, judul, isi, tautan) VALUES (?,?,?,?,?)").bind(userId, jenis, judul.slice(0, 200), isi, tautan);
// Guru binaan santri pada tahun ajaran aktif: wali kelas/asisten kelasnya dan wali asuh/asisten kamarnya (akun guru aktif).
const GURU_BINAAN = (santriSql) => `SELECT us.id FROM users us WHERE us.status = 'aktif' AND us.guru_id IN (
    SELECT wk.guru_id FROM wali_kelas wk JOIN tahun_ajaran ta ON ta.id = wk.tahun_ajaran_id AND ta.status = 'aktif' WHERE wk.kelas_id = (SELECT kelas_id FROM santri WHERE id = ${santriSql})
    UNION SELECT wa.guru_id FROM wali_asuh_kamar wa JOIN tahun_ajaran ta ON ta.id = wa.tahun_ajaran_id AND ta.status = 'aktif' WHERE wa.kamar_id = (SELECT kamar_id FROM santri WHERE id = ${santriSql}))`;
const stmtNotifGuru = (db, santriId, { judul, isi = null }) => db.prepare(
  `INSERT INTO notifikasi (user_id, jenis, judul, isi, tautan) SELECT id, 'santri', ?, ?, ? FROM (${GURU_BINAAN("?")})`)
  .bind(judul.slice(0, 200), isi, "/cari?santri=" + santriId, santriId, santriId);

// Kabar per kejadian ke semua wali yang tertaut aktif ke santri (K-76). Mengembalikan jumlah email.
// Guru binaan santri (wali kelas / wali asuh) menerima kabar yang sama lewat lonceng.
async function kabarWali(db, santriId, { subjek, isi, tabel, id }) {
  const s = await db.prepare("SELECT id, nama, lingkungan FROM santri WHERE id = ?").bind(santriId).first();
  if (!s) return 0;
  await stmtNotifGuru(db, s.id, { judul: `${subjek} — ${s.nama}`, isi }).run();
  const wali = (await db.prepare(
    `SELECT a.id, a.email, a.nama FROM tautan_wali t JOIN akun_wali a ON a.id = t.akun_wali_id
     WHERE t.santri_id = ? AND t.dicabut_at IS NULL AND a.status = 'aktif'`).bind(santriId).all()).results;
  if (!wali.length) return 0;
  const kaki = `\n\nRincian dapat dilihat setelah masuk ke Portal Wali: ${APP(ENV)}/wali.html\n\n— HISADA, Pesantren Modern Daarul 'Uluum Lido`;
  await db.batch(wali.map((w) => stmtEmail(db, {
    penerima: w.email, subjek: `[HISADA] ${subjek} — ${s.nama}`, isi: `Assalamu'alaikum ${w.nama},\n\n${isi}${kaki}`,
    jenis: "wali", tabel, id, akun_wali_id: w.id, lingkungan: s.lingkungan,
  })));
  return wali.length;
}
// Ralat untuk kabar yang ternyata salah input: dikirim ke penerima yang sama, menunjuk email aslinya.
// opsi.subjek: hanya meralat email yang subjeknya memuat teks ini (mis. kabar overdue, bukan kabar izin terbit).
async function kabarKoreksi(db, tabel, id, isi, opsi = {}) {
  const lama = (await db.prepare("SELECT * FROM email_antrean WHERE tabel_terkait = ? AND id_terkait = ? AND koreksi_dari_id IS NULL AND jenis = 'wali' AND instr(subjek, ?) > 0").bind(tabel, id, opsi.subjek || "").all()).results;
  if (!lama.length) return 0;
  await db.batch(lama.map((e) => stmtEmail(db, {
    penerima: e.penerima, subjek: "[HISADA] Ralat: " + e.subjek.replace(/^\[HISADA\] /, ""), isi: `Assalamu'alaikum,\n\nRalat atas kabar sebelumnya: ${isi}\n\nMohon maaf atas kekeliruan ini.\n\n— HISADA`,
    jenis: "wali", tabel, id, akun_wali_id: e.akun_wali_id, koreksi_dari_id: e.id, lingkungan: e.lingkungan,
  })));
  return lama.length;
}

const b64 = (s) => {
  const b = enc.encode(s); let t = "";
  for (let i = 0; i < b.length; i += 0x8000) t += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(t);
};
const b64url = (s) => b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function tokenGmail(env) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: env.GMAIL_REFRESH_TOKEN, grant_type: "refresh_token" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error("Token Gmail ditolak: " + (j.error || r.status));
  return j.access_token;
}
// Kirim maks. `batas` email antre. Tanpa GMAIL_REFRESH_TOKEN/GMAIL_PENGIRIM email tetap antre (tidak hilang).
// latar = dipanggil di belakang permintaan pengubah (kirim langsung); diam bila belum diatur atau antrean kosong.
const KUNCI_MS = 5 * 60e3; // kunci basi (mis. worker terhenti di tengah kiriman) dilepas setelah 5 menit
async function kirimAntrean(env, db, batas = 25, latar = false) {
  const siap = env.GMAIL_REFRESH_TOKEN && env.GMAIL_PENGIRIM && env.GOOGLE_CLIENT_SECRET;
  if (!siap) {
    if (latar) return { terkirim: 0, gagal: 0 };
    const sisa = await db.prepare("SELECT COUNT(*) n FROM email_antrean WHERE status = 'antre'").first("n");
    if (!sisa) return { terkirim: 0, gagal: 0, sisa: 0 };
    await db.prepare("UPDATE email_antrean SET galat = 'Pengirim email belum diatur (GMAIL_REFRESH_TOKEN / GMAIL_PENGIRIM)' WHERE status = 'antre' AND galat IS NULL").run();
    return { terkirim: 0, gagal: 0, sisa, belum_diatur: true };
  }
  // Klaim baris dalam satu pernyataan: pengirim lain yang berjalan bersamaan tidak akan mengambil baris yang sama.
  const daftar = (await db.prepare(
    `UPDATE email_antrean SET dikunci_at = ? WHERE id IN (SELECT id FROM email_antrean WHERE status = 'antre'
       AND (dikunci_at IS NULL OR dikunci_at < ?) ORDER BY id LIMIT ?) RETURNING *`)
    .bind(wib(), wib(Date.now() - KUNCI_MS), batas).all()).results.sort((a, b) => a.id - b.id);
  if (!daftar.length) return { terkirim: 0, gagal: 0, sisa: 0 };
  const lepas = (galat) => db.prepare(`UPDATE email_antrean SET dikunci_at = NULL, galat = ? WHERE id IN (SELECT value FROM json_each(?))`)
    .bind(galat, JSON.stringify(daftar.map((e) => e.id))).run();
  let token, ujiAktif, alamatUji, namaPengirim;
  try {
    ujiAktif = (await pengaturan(db, "email.mode_uji", "1")) === "1";
    alamatUji = (await pengaturan(db, "email.alamat_uji", "")).trim();
    namaPengirim = await pengaturan(db, "email.nama_pengirim", "HISADA");
    if (ujiAktif && !alamatUji) {
      await lepas("Mode Uji aktif tetapi email.alamat_uji kosong");
      return { terkirim: 0, gagal: 0, sisa: daftar.length };
    }
    token = await tokenGmail(env);
  } catch (err) {
    await lepas(String(err.message).slice(0, 300));
    throw err;
  }
  let terkirim = 0, gagalN = 0;
  for (const e of daftar) {
    try {
      const ke = ujiAktif ? alamatUji : e.penerima;
      const isi = ujiAktif ? `[MODE UJI — seharusnya untuk: ${e.penerima}]\n\n${e.isi}` : e.isi;
      const mime = [`From: =?UTF-8?B?${b64(namaPengirim)}?= <${env.GMAIL_PENGIRIM}>`, `To: ${ke}`, `Subject: =?UTF-8?B?${b64(e.subjek)}?=`,
        "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(isi).replace(/.{76}/g, "$&\r\n")].join("\r\n");
      const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify({ raw: b64url(mime) }),
      });
      if (!r.ok) throw new Error("Gmail " + r.status + " " + (await r.text()).slice(0, 160));
      await db.prepare("UPDATE email_antrean SET status = 'terkirim', dikirim_at = ?, percobaan = percobaan + 1, galat = NULL, dikunci_at = NULL, isi = ? WHERE id = ?")
        .bind(wib(), e.isi.replace(/token=[0-9a-f]+/gi, "token=••••••"), e.id).run();
      terkirim++;
    } catch (err) {
      await db.prepare("UPDATE email_antrean SET percobaan = percobaan + 1, galat = ?, dikunci_at = NULL, status = CASE WHEN percobaan + 1 >= 5 THEN 'gagal' ELSE 'antre' END WHERE id = ?").bind(String(err.message).slice(0, 300), e.id).run();
      gagalN++;
    }
  }
  return { terkirim, gagal: gagalN };
}

// ---------------------------------------------------------------- router
const rute = [];
const on = (method, pola, fn, opsi = {}) => rute.push({ method, re: new RegExp("^" + pola.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), fn, publik: !!opsi.publik });

// Tugas berkala (cron tiap 5 menit, lihat wrangler.jsonc): overdue, tugas modul (mis. akhir skorsing), kirim email.
const TUGAS_BERKALA = [];
async function tugasBerkala(env) {
  ENV = env;
  await migrate(env.DB);
  const hasil = {};
  try { await env.DB.prepare("DELETE FROM batas_ip WHERE dibuat_at < datetime('now', '-1 day')").run(); } catch (e) { console.error("batas_ip", e); }
  try { hasil.overdue = await perbaruiOverdue(env.DB); } catch (e) { console.error("overdue", e); hasil.overdue = "galat: " + e.message; }
  for (const t of TUGAS_BERKALA) {
    try { hasil[t.nama] = await t.fn(env.DB, env); } catch (e) { console.error("tugas " + t.nama, e); hasil[t.nama] = "galat: " + e.message; }
  }
  try { hasil.email = await kirimAntrean(env, env.DB); } catch (e) { console.error("email", e); hasil.email = "galat: " + e.message; }
  return hasil;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tugasBerkala(env));
  },
  async fetch(req, env, ectx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    ENV = env;
    const emailAwal = EMAIL_DIBUAT;
    const res = await layani(req, env, url);
    // Email baru diantrekan dan permintaan berhasil: kirim langsung di belakang layar (cron 5 menit tetap jadi cadangan).
    if (EMAIL_DIBUAT !== emailAwal && res.status < 400 && ectx)
      ectx.waitUntil(kirimAntrean(env, env.DB, 10, true).catch((e) => console.error("kirim langsung", e)));
    return res;
  },
};

async function layani(req, env, url) {
  try {
    await migrate(env.DB);
    if (req.method !== "GET") {
      // Lapisan CSRF: permintaan pengubah wajib JSON dari halaman sendiri.
      const ct = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const origin = req.headers.get("origin");
      if (ct !== "application/json") gagal(415, "Format permintaan tidak dikenal.");
      if (origin && origin !== url.origin) gagal(403, "Asal permintaan tidak diizinkan.");
    }
    for (const r of rute) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const ctx = { req, env, db: env.DB, url, p: m.groups || {} };
      const badan = req.method === "GET" ? {} : await req.json().catch(() => ({}));
      ctx.body = badan && typeof badan === "object" && !Array.isArray(badan) ? badan : {};
      if (!r.publik) {
        ctx.u = await penggunaDariSesi(env.DB, req);
        if (!ctx.u) gagal(401, "Silakan masuk terlebih dahulu.");
        if (ctx.u.wajib_ganti_password && ctx.u.password_hash && !["/api/me", "/api/ganti-password", "/api/logout"].includes(url.pathname))
          gagal(428, "Ganti password terlebih dahulu.");
      }
      return await r.fn(ctx);
    }
    gagal(404, "Alamat API tidak ditemukan.");
  } catch (e) {
    if (e instanceof Galat) return json({ galat: e.message }, e.status);
    const pesan = String(e && e.message || e);
    if (/UNIQUE constraint/.test(pesan)) return json({ galat: "Data yang sama sudah ada." }, 409);
    if (/CHECK constraint|FOREIGN KEY/.test(pesan)) return json({ galat: "Isian tidak sesuai aturan data." }, 400);
    console.error(e);
    return json({ galat: "Terjadi kesalahan di server." }, 500);
  }
}

// ---------------------------------------------------------------- status, setup, login
on("GET", "/api/status", async ({ env, db }) => {
  const n = await db.prepare("SELECT COUNT(*) n FROM users").first();
  return json({
    perlu_setup: n.n === 0,
    setup_tersedia: n.n === 0 && !!env.SETUP_KEY,
    google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    login_password: (await pengaturan(db, "login.password_aktif", "1")) === "1",
  });
}, { publik: true });

on("POST", "/api/setup", async ({ env, db, body }) => {
  const n = await db.prepare("SELECT COUNT(*) n FROM users").first();
  if (n.n > 0) gagal(409, "Setup sudah pernah dilakukan.");
  if (!env.SETUP_KEY || body.kunci !== env.SETUP_KEY) gagal(403, "Kunci setup salah.");
  const email = bersih(body.email, 120)?.toLowerCase();
  if (!email || !body.nama || !body.password || String(body.password).length < 10) gagal(400, "Isi nama, email, dan password (minimal 10 karakter).");
  const r = await db.prepare("INSERT INTO users (email, password_hash, nama, role, lingkungan, wajib_ganti_password) VALUES (?,?,?,?, 'semua', 0)")
    .bind(email, await hashPassword(body.password), bersih(body.nama, 120), "moderator").run();
  const ta = await db.prepare("SELECT COUNT(*) n FROM tahun_ajaran").first();
  if (!ta.n) {
    const y = +hariIni().slice(0, 4), mth = +hariIni().slice(5, 7);
    const awal = mth >= 7 ? y : y - 1;
    await db.prepare("INSERT INTO tahun_ajaran (nama, status, mulai) VALUES (?, 'aktif', ?)").bind(`${awal}/${awal + 1}`, `${awal}-07-01`).run();
  }
  await catat(db, { id: r.meta.last_row_id }, "akun", "setup", "users", r.meta.last_row_id, "Moderator pertama dibuat");
  return json({ ok: true });
}, { publik: true });

on("POST", "/api/login", async ({ db, req, body }) => {
  if ((await pengaturan(db, "login.password_aktif", "1")) !== "1") gagal(403, "Login password dinonaktifkan. Gunakan akun Google.");
  await batasIp(db, req, "login");
  const email = String(body.email || "").trim().toLowerCase();
  const u = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  const salah = () => gagal(401, "Email atau password salah.");
  if (!u) { await catatGagalIp(db, req, "login"); await cekPassword("x", "pbkdf2$100000$00$00"); salah(); }
  if (u.terkunci_sampai && u.terkunci_sampai > wib()) gagal(429, "Terlalu banyak percobaan. Coba lagi nanti.");
  if (!(await cekPassword(String(body.password || ""), u.password_hash))) {
    await catatGagalIp(db, req, "login");
    const batas = +(await pengaturan(db, "login.batas_gagal", "5")) || 5;
    const menit = +(await pengaturan(db, "login.lama_kunci_menit", "15"));
    const gagalBaru = u.gagal_login + 1;
    await db.prepare("UPDATE users SET gagal_login = ?, terkunci_sampai = ? WHERE id = ?")
      .bind(gagalBaru >= batas ? 0 : gagalBaru, gagalBaru >= batas ? wib(Date.now() + menit * 60e3) : null, u.id).run();
    salah();
  }
  if (u.status !== "aktif") gagal(403, "Akun nonaktif.");
  const s = await buatSesi(db, u.id);
  return json({ ok: true, wajib_ganti_password: !!u.wajib_ganti_password }, 200, { "set-cookie": cookieSesi(s.token, s.maxAge) });
}, { publik: true });

on("POST", "/api/logout", async ({ db, req }) => {
  const t = ambilCookie(req, COOKIE);
  if (t) await db.prepare("DELETE FROM sesi_login WHERE token_hash = ?").bind(await sha256(t)).run();
  return json({ ok: true }, 200, { "set-cookie": cookieSesi("", 0) });
}, { publik: true });

// ---------------------------------------------------------------- Google OAuth (OpenID Connect)
on("GET", "/api/auth/google", async ({ env, url }) => {
  if (!env.GOOGLE_CLIENT_ID) gagal(503, "Login Google belum disiapkan.");
  const state = randomHex(16);
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: url.origin + "/api/auth/callback",
    response_type: "code", scope: "openid email profile", state, prompt: "select_account",
  });
  if (env.GOOGLE_HD) q.set("hd", env.GOOGLE_HD);
  return new Response(null, { status: 302, headers: {
    location: "https://accounts.google.com/o/oauth2/v2/auth?" + q,
    "set-cookie": `hisada_state=${state}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  } });
}, { publik: true });

on("GET", "/api/auth/callback", async ({ env, db, url, req }) => {
  const kembali = (pesan) => new Response(null, { status: 302, headers: {
    location: "/#/masuk?galat=" + encodeURIComponent(pesan),
    "set-cookie": "hisada_state=; Path=/api/auth; Max-Age=0",
  } });
  const state = url.searchParams.get("state");
  if (!state || state !== ambilCookie(req, "hisada_state")) return kembali("Sesi login Google kedaluwarsa. Coba lagi.");
  const code = url.searchParams.get("code");
  if (!code) return kembali("Login Google dibatalkan.");
  const tr = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: url.origin + "/api/auth/callback", grant_type: "authorization_code" }),
  });
  const tok = await tr.json();
  if (!tok.id_token) return kembali("Google menolak login.");
  // id_token diterima langsung dari Google lewat TLS, jadi isinya bisa dipercaya (OIDC Core 3.1.3.7).
  const klaim = JSON.parse(atob(tok.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  if (klaim.aud !== env.GOOGLE_CLIENT_ID || !["accounts.google.com", "https://accounts.google.com"].includes(klaim.iss)) return kembali("Token Google tidak sah.");
  if (!klaim.email_verified) return kembali("Email Google belum terverifikasi.");
  if (env.GOOGLE_HD && klaim.hd !== env.GOOGLE_HD) return kembali("Gunakan akun Google pondok.");
  const u = await db.prepare("SELECT * FROM users WHERE email = ?").bind(String(klaim.email).toLowerCase()).first();
  if (!u) return kembali("Akun " + klaim.email + " belum didaftarkan di HISADA. Hubungi Moderator.");
  if (u.status !== "aktif") return kembali("Akun nonaktif atau tertahan.");
  await db.prepare("UPDATE users SET wajib_ganti_password = 0 WHERE id = ? AND password_hash IS NULL").bind(u.id).run();
  const s = await buatSesi(db, u.id);
  const h = new Headers({ location: "/#/" });
  h.append("set-cookie", cookieSesi(s.token, s.maxAge));
  h.append("set-cookie", "hisada_state=; Path=/api/auth; Max-Age=0");
  return new Response(null, { status: 302, headers: h });
}, { publik: true });

// ---------------------------------------------------------------- akun saya
on("GET", "/api/me", async ({ db, u }) => json({
  id: u.id, nama: u.nama, email: u.email, role: u.role, moderator: u.role === "moderator", lingkungan: u.lingkungan, akses: u.akses,
  preset: u.preset_id ? (await db.prepare("SELECT nama FROM preset WHERE id = ?").bind(u.preset_id).first("nama")) || null : null,
  foto_url: u.santri_id ? (await db.prepare("SELECT foto_url FROM santri WHERE id = ?").bind(u.santri_id).first("foto_url")) || null : null,
  bisa: Object.fromEntries(KEMAMPUAN.map((k) => [k, boleh(u, k)])),
  punya_password: !!u.password_hash,
  wajib_ganti_password: !!(u.wajib_ganti_password && u.password_hash),
}));

// Badge sidebar (README Notifikasi): dihitung langsung dari tabel, sesuai akses pengguna.
on("GET", "/api/lencana", async ({ db, u }) => {
  const l = lingIn(u), h = {};
  if (boleh(u, "perizinan")) h["/perizinan"] = (await db.prepare(`SELECT COUNT(*) n FROM izin WHERE status = 'overdue' AND ${l.sql}`).bind(...l.args).first()).n;
  if (boleh(u, "putusan_kedisiplinan")) h["/kedisiplinan"] = (await db.prepare(`SELECT COUNT(*) n FROM pelanggaran WHERE status = 'menunggu' AND ${l.sql}`).bind(...l.args).first()).n;
  if (boleh(u, "pemeriksaan")) h["/kesehatan"] = (await db.prepare(
    `SELECT COUNT(*) n FROM kunjungan_kesehatan k WHERE k.status = 'aktif' AND ${lingIn(u, "k.lingkungan").sql} AND NOT EXISTS (SELECT 1 FROM pemeriksaan p WHERE p.kunjungan_id = k.id)`).bind(...l.args).first()).n;
  if (u.role === "moderator") {
    h["/pengguna"] = (await db.prepare("SELECT COUNT(*) n FROM users us WHERE role IS NULL AND status = 'aktif' AND NOT EXISTS (SELECT 1 FROM user_akses ua WHERE ua.user_id = us.id)").first()).n;
    h["/update-data"] = (await db.prepare("SELECT COUNT(*) n FROM santri WHERE menunggu_penempatan = 1 AND status = 'aktif'").first()).n;
    h["/komunikasi"] = (await db.prepare("SELECT COUNT(*) n FROM email_antrean WHERE status = 'gagal'").first()).n;
  }
  return json(h);
});

on("POST", "/api/ganti-password", async ({ db, u, body, req }) => {
  const baru = String(body.baru || "");
  if (baru.length < 8) gagal(400, "Password baru minimal 8 karakter.");
  if (u.password_hash && !(await cekPassword(String(body.lama || ""), u.password_hash))) gagal(400, "Password lama salah.");
  await db.batch([
    db.prepare("UPDATE users SET password_hash = ?, wajib_ganti_password = 0 WHERE id = ?").bind(await hashPassword(baru), u.id),
    db.prepare("DELETE FROM sesi_login WHERE user_id = ? AND token_hash <> ?").bind(u.id, await sha256(ambilCookie(req, COOKIE) || "")),
  ]);
  await catat(db, u, "akun", "ganti_password", "users", u.id, "Password diganti");
  return json({ ok: true });
});

// ---------------------------------------------------------------- ringkasan (dashboard)
on("GET", "/api/ringkasan", async ({ db, u }) => {
  await perbaruiOverdue(db);
  const l = lingIn(u);
  const santri = await db.prepare(`SELECT lingkungan, COUNT(*) n FROM santri WHERE status = 'aktif' AND ${l.sql} GROUP BY lingkungan`).bind(...l.args).all();
  const izin = await db.prepare(`SELECT status, COUNT(*) n FROM izin WHERE status IN ('berjalan','overdue') AND ${l.sql} GROUP BY status`).bind(...l.args).all();
  const terlambat = await db.prepare(`SELECT COUNT(*) n FROM izin WHERE status = 'berjalan' AND rencana_kembali < ? AND ${l.sql}`).bind(wib(), ...l.args).first();
  const absen = await db.prepare(`SELECT COUNT(*) n FROM absensi_sesi WHERE tanggal = ? AND ${l.sql}`).bind(hariIni(), ...l.args).first();
  const kamar = await db.prepare(`SELECT COUNT(*) n FROM kamar WHERE aktif = 1 AND ${l.sql}`).bind(...l.args).first();
  const s = Object.fromEntries(santri.results.map((r) => [r.lingkungan, r.n]));
  const z = Object.fromEntries(izin.results.map((r) => [r.status, r.n]));
  const t = hariIni(), l2 = (k) => lingIn(u, k);
  const sakit = await db.prepare(`SELECT COUNT(*) n FROM kunjungan_kesehatan WHERE status = 'aktif' AND waktu >= ? AND ${l.sql}`).bind(wib(Date.now() - 30 * 864e5), ...l.args).first();
  const dirawat = await db.prepare(`SELECT COUNT(*) n FROM kunjungan_kesehatan k JOIN jenis_kunjungan jk ON jk.id = k.jenis_kunjungan_id WHERE k.status = 'aktif' AND jk.status_kehadiran_id IS NOT NULL AND k.selesai_rawat_at IS NULL AND ${l2("k.lingkungan").sql}`).bind(...l.args).first();
  const pulang = await db.prepare(`SELECT COUNT(*) n FROM izin z JOIN jenis_izin ji ON ji.id = z.jenis_izin_id WHERE ji.basis_waktu = 'tanggal' AND z.status IN ('berjalan','overdue') AND substr(z.berangkat,1,10) <= ? AND ${l2("z.lingkungan").sql}`).bind(t, ...l.args).first();
  const alpha = await db.prepare(`SELECT COUNT(DISTINCT a.santri_id) n FROM absensi a JOIN absensi_sesi s ON s.id = a.sesi_id JOIN status_kehadiran sk ON sk.id = a.status_kehadiran_id WHERE s.tanggal = ? AND sk.kode = 'A' AND ${l2("a.lingkungan").sql}`).bind(t, ...l.args).first();
  const agenda = await db.prepare(`SELECT id, judul, mulai, selesai, lingkungan FROM agenda WHERE selesai >= ? AND ${l.sql} ORDER BY mulai LIMIT 5`).bind(t, ...l.args).all();
  return json({
    waktu: wib(), santri_putra: s.putra || 0, santri_putri: s.putri || 0,
    izin_berjalan: z.berjalan || 0, izin_terlambat: terlambat.n, izin_overdue: z.overdue || 0,
    absensi_terisi: absen.n, kamar_aktif: kamar.n,
    sakit_30_hari: sakit.n, dirawat: dirawat.n, pulang_hari_ini: pulang.n, alpha_hari_ini: alpha.n, agenda: agenda.results,
  });
});

// ---------------------------------------------------------------- data master
on("GET", "/api/master", async ({ db, u }) => {
  const l = lingIn(u);
  const q = (sql, ...a) => db.prepare(sql).bind(...a).all().then((r) => r.results);
  return json({
    tahun_ajaran: await q("SELECT * FROM tahun_ajaran ORDER BY nama DESC"),
    jenjang: await q("SELECT * FROM jenjang ORDER BY urutan"),
    kelas: await q(`SELECT k.*, j.nama jenjang, (SELECT COUNT(*) FROM santri s WHERE s.kelas_id = k.id AND s.status='aktif') jumlah
                    FROM kelas k JOIN jenjang j ON j.id = k.jenjang_id WHERE ${l.sql.replace("lingkungan", "k.lingkungan")} ORDER BY k.lingkungan, k.tingkat, k.rombel`, ...l.args),
    asrama: await q(`SELECT * FROM asrama WHERE ${l.sql} ORDER BY nama`, ...l.args),
    kamar: await q(`SELECT k.*, (SELECT COUNT(*) FROM santri s WHERE s.kamar_id = k.id AND s.status='aktif') jumlah
                    FROM kamar k WHERE ${l.sql.replace("lingkungan", "k.lingkungan")} ORDER BY k.nama`, ...l.args),
    guru: await q(`SELECT ${u.role === "moderator" ? "*" : "id, nip, nama, jenis_kelamin, lingkungan, aktif"} FROM guru ORDER BY nama`),
    // wali kelas & wali asuh tahun ajaran aktif (penetapan di Data Master)
    wali_kelas: await q(`SELECT wk.id, wk.kelas_id, wk.guru_id, wk.peran, g.nama FROM wali_kelas wk JOIN guru g ON g.id = wk.guru_id
                        JOIN tahun_ajaran ta ON ta.id = wk.tahun_ajaran_id AND ta.status = 'aktif' ORDER BY wk.peran = 'wali' DESC, g.nama`),
    wali_asuh: await q(`SELECT wa.id, wa.kamar_id, wa.guru_id, wa.peran, g.nama FROM wali_asuh_kamar wa JOIN guru g ON g.id = wa.guru_id
                       JOIN tahun_ajaran ta ON ta.id = wa.tahun_ajaran_id AND ta.status = 'aktif' ORDER BY wa.peran = 'wali_asuh' DESC, g.nama`),
    status_kehadiran: await q("SELECT * FROM status_kehadiran ORDER BY urutan"),
    jenis_izin: await q("SELECT * FROM jenis_izin ORDER BY urutan"),
    pilihan: await q(`SELECT * FROM pilihan WHERE lingkungan = 'semua' OR ${l.sql} ORDER BY kelompok, urutan, nama`, ...l.args),
    pengaturan: u.role === "moderator" ? await q("SELECT * FROM pengaturan ORDER BY kunci") : [],
  });
});

// Penetapan wali kelas / wali asuh kamar untuk tahun ajaran aktif: {jenis: 'kelas'|'kamar', target_id, guru_id, peran} atau {jenis, hapus_id}.
on("POST", "/api/wali-binaan", async ({ db, u, body }) => {
  wajibModerator(u);
  const kelas = body.jenis === "kelas";
  if (!kelas && body.jenis !== "kamar") gagal(400, "Jenis tidak dikenal.");
  const tabel = kelas ? "wali_kelas" : "wali_asuh_kamar", kolom = kelas ? "kelas_id" : "kamar_id";
  if (body.hapus_id) {
    const r = await db.prepare(`DELETE FROM ${tabel} WHERE id = ?`).bind(+body.hapus_id).run();
    await catat(db, u, "data", "wali_hapus", tabel, +body.hapus_id, `Penetapan ${kelas ? "wali kelas" : "wali asuh"} dihapus`);
    return json({ ok: true, dihapus: r.meta.changes });
  }
  const ta = await taAktif(db);
  if (!ta) gagal(400, "Belum ada tahun ajaran aktif.");
  const t = await db.prepare(`SELECT * FROM ${kelas ? "kelas" : "kamar"} WHERE id = ?`).bind(+body.target_id || 0).first();
  if (!t) gagal(400, kelas ? "Kelas tidak ditemukan." : "Kamar tidak ditemukan.");
  const g = await db.prepare("SELECT * FROM guru WHERE id = ? AND aktif = 1").bind(+body.guru_id || 0).first();
  if (!g) gagal(400, "Guru tidak ditemukan atau nonaktif.");
  if (g.lingkungan !== "semua" && g.lingkungan !== t.lingkungan) gagal(400, `Guru ini untuk lingkungan ${g.lingkungan}.`);
  const peran = kelas ? (body.peran === "asisten" ? "asisten" : "wali") : (body.peran === "asisten" ? "asisten" : "wali_asuh");
  const namaT = kelas ? `${t.tingkat} ${t.rombel}` : t.nama;
  const LABEL = { wali: "wali kelas", asisten: kelas ? "asisten wali kelas" : "asisten wali asuh", wali_asuh: "wali asuh" };
  const [r] = await db.batch([
    db.prepare(`INSERT INTO ${tabel} (${kolom}, tahun_ajaran_id, guru_id, peran) VALUES (?,?,?,?)`).bind(t.id, ta.id, g.id, peran),
    db.prepare(`INSERT INTO notifikasi (user_id, jenis, judul, isi, tautan) SELECT id, 'akun', ?, ?, '/akun' FROM users WHERE guru_id = ? AND status = 'aktif'`)
      .bind(`Anda ditetapkan sebagai ${LABEL[peran]} ${namaT}`, `Tahun ajaran ${ta.nama}. Kabar santri binaan akan muncul di notifikasi.`, g.id),
    stmtCatat(db, u, "data", "wali_tetapkan", tabel, null, `${g.nama}: ${LABEL[peran]} ${namaT} (${ta.nama})`, t.lingkungan),
  ]);
  return json({ ok: true, id: r.meta.last_row_id });
});

// Tabel master sederhana yang boleh diubah Moderator, dengan kolom yang diizinkan.
const MASTER = {
  tahun_ajaran: ["nama", "status", "mulai", "selesai"],
  kelas: ["tingkat", "rombel", "jenjang_id", "label", "lingkungan", "aktif"],
  asrama: ["nama", "lingkungan", "aktif"],
  kamar: ["asrama_id", "nomor", "nama", "kapasitas", "aktif"],
  guru: ["nip", "nama", "jenis_kelamin", "no_hp", "email", "lingkungan", "aktif"],
  status_kehadiran: ["kode", "nama", "warna", "dihitung_hadir", "urutan", "aktif"],
  jenis_izin: ["nama", "basis_waktu", "wajib_wali", "jam_kembali_bawaan", "status_kehadiran_id", "urutan", "aktif"],
  pengaturan: ["nilai"],
};
on("POST", "/api/master/:tabel", async ({ db, u, p, body }) => {
  wajibModerator(u);
  const kol = MASTER[p.tabel];
  if (!kol) gagal(404, "Tabel tidak dikenal.");
  const data = {};
  for (const k of kol) if (k in body) data[k] = body[k] === "" ? null : body[k];
  if (p.tabel === "kamar" && data.asrama_id) {
    const a = await db.prepare("SELECT lingkungan FROM asrama WHERE id = ?").bind(data.asrama_id).first();
    if (!a) gagal(400, "Asrama tidak ditemukan.");
    data.lingkungan = a.lingkungan;
  }
  if (p.tabel === "pengaturan") {
    await db.prepare("UPDATE pengaturan SET nilai = ? WHERE kunci = ?").bind(String(data.nilai ?? ""), String(body.kunci)).run();
    await catat(db, u, "pengaturan", "ubah", "pengaturan", null, `${body.kunci} = ${data.nilai}`);
    return json({ ok: true });
  }
  // Kode status kehadiran dipakai aturan otomatis (H, A, P, …): tidak diubah setelah dibuat.
  if (p.tabel === "status_kehadiran" && body.id) delete data.kode;
  if (p.tabel === "tahun_ajaran" && data.status === "aktif")
    await db.prepare("UPDATE tahun_ajaran SET status = 'arsip' WHERE status = 'aktif' AND id <> ?").bind(body.id || 0).run();
  const keys = Object.keys(data);
  if (!keys.length) gagal(400, "Tidak ada data.");
  let id = body.id;
  if (id) {
    await db.prepare(`UPDATE ${p.tabel} SET ${keys.map((k) => k + " = ?").join(", ")} WHERE id = ?`).bind(...keys.map((k) => data[k]), id).run();
  } else {
    const r = await db.prepare(`INSERT INTO ${p.tabel} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).bind(...keys.map((k) => data[k])).run();
    id = r.meta.last_row_id;
  }
  await catat(db, u, "data", id === body.id ? "ubah" : "tambah", p.tabel, id, JSON.stringify(data).slice(0, 300));
  return json({ ok: true, id });
});

// Daftar pilihan per kelompok (K-85): Moderator atau pemegang akses pilihan.<kelompok>.
on("POST", "/api/pilihan", async ({ db, u, body }) => {
  const kelompok = bersih(body.kelompok, 40);
  if (!kelompok) gagal(400, "Kelompok wajib diisi.");
  if (u.role !== "moderator" && !u.akses.includes("pilihan." + kelompok)) gagal(403, "Anda tidak punya akses mengedit daftar ini.");
  const nama = bersih(body.nama, 120);
  const lingSah = ["putra", "putri", "semua"].includes(body.lingkungan) ? body.lingkungan : null;
  // Selain Moderator: hanya lingkungan sendiri ('semua' hanya bila memegang kedua lingkungan).
  const bolehLing = (l) => u.role === "moderator" || (l === "semua" ? u.ling.length === 2 : u.ling.includes(l));
  if (lingSah && !bolehLing(lingSah)) gagal(403, "Anda hanya bisa mengatur pilihan untuk lingkungan Anda.");
  if (body.id) {
    const lama = await db.prepare("SELECT * FROM pilihan WHERE id = ? AND kelompok = ?").bind(body.id, kelompok).first();
    if (!lama) gagal(404, "Pilihan tidak ditemukan.");
    if (!bolehLing(lama.lingkungan)) gagal(403, "Pilihan ini milik lingkungan lain.");
    if ("nama" in body && !nama) gagal(400, "Nama pilihan wajib diisi.");
    const urutan = body.urutan === undefined || body.urutan === "" ? null : Math.trunc(+body.urutan);
    if (Number.isNaN(urutan)) gagal(400, "Urutan harus angka.");
    await db.prepare("UPDATE pilihan SET nama = COALESCE(?, nama), urutan = COALESCE(?, urutan), aktif = COALESCE(?, aktif), lingkungan = COALESCE(?, lingkungan) WHERE id = ?")
      .bind(nama, urutan, body.aktif ?? null, lingSah, lama.id).run();
    const beda = [nama && nama !== lama.nama ? `"${lama.nama}" → "${nama}"` : lama.nama, urutan != null && urutan !== lama.urutan ? `urutan ${urutan}` : "",
      lingSah && lingSah !== lama.lingkungan ? lingSah : "", body.aktif != null ? (+body.aktif ? "aktif" : "nonaktif") : ""].filter(Boolean).join(", ");
    await catat(db, u, "pilihan", "ubah", "pilihan", lama.id, `${kelompok}: ${beda}`);
    return json({ ok: true, id: lama.id });
  }
  // bawaan: 'semua' bagi Moderator / pemegang dua lingkungan, selain itu lingkungan pengguna sendiri
  const ling = lingSah || (u.role === "moderator" || u.ling.length === 2 ? "semua" : u.ling[0]);
  if (!bolehLing(ling)) gagal(403, "Anda hanya bisa mengatur pilihan untuk lingkungan Anda.");
  if (!nama) gagal(400, "Nama pilihan wajib diisi.");
  const urut = await db.prepare("SELECT COALESCE(MAX(urutan),0)+1 n FROM pilihan WHERE kelompok = ?").bind(kelompok).first();
  const r = await db.prepare("INSERT INTO pilihan (kelompok, nama, urutan, lingkungan) VALUES (?,?,?,?)").bind(kelompok, nama, urut.n, ling).run();
  await catat(db, u, "pilihan", "tambah", "pilihan", r.meta.last_row_id, `${kelompok}: ${nama}`);
  return json({ ok: true, id: r.meta.last_row_id });
});

// ---------------------------------------------------------------- santri
on("GET", "/api/santri", async ({ db, u, url }) => {
  wajibAdaAkses(u);
  const l = lingIn(u, "s.lingkungan");
  const w = [l.sql], a = [...l.args];
  const q = (url.searchParams.get("q") || "").trim();
  if (q) { w.push("(s.nama LIKE ? OR s.nis LIKE ?)"); a.push(`%${q}%`, `${q}%`); }
  for (const k of ["kamar_id", "kelas_id"]) if (url.searchParams.get(k)) { w.push(`s.${k} = ?`); a.push(+url.searchParams.get(k)); }
  // filter pencarian tambahan: lingkungan (bagi yang melihat keduanya) dan jenis kelamin
  if (["putra", "putri"].includes(url.searchParams.get("ling"))) { w.push("s.lingkungan = ?"); a.push(url.searchParams.get("ling")); }
  if (["L", "P"].includes(url.searchParams.get("jk"))) { w.push("s.jenis_kelamin = ?"); a.push(url.searchParams.get("jk")); }
  const st = url.searchParams.get("status") || "aktif";
  // status=aktif,skorsing → beberapa status sekaligus (mis. rapor per kelas)
  if (st !== "semua") { w.push("s.status IN (SELECT value FROM json_each(?))"); a.push(JSON.stringify(st.split(",").slice(0, 6))); }
  const lim = Math.max(1, Math.min(+url.searchParams.get("limit") || 50, 2000));
  const r = await db.prepare(
    `SELECT s.id, s.nis, s.nama, s.jenis_kelamin, s.lingkungan, s.status, s.tempat_lahir, s.kabupaten, s.provinsi,
            s.kelas_id, s.kamar_id, s.foto_url, km.nama kamar, (k.tingkat || ' ' || k.rombel || ' ' || j.nama || COALESCE(' ' || k.label, '')) kelas
     FROM santri s LEFT JOIN kamar km ON km.id = s.kamar_id LEFT JOIN kelas k ON k.id = s.kelas_id LEFT JOIN jenjang j ON j.id = k.jenjang_id
     WHERE ${w.join(" AND ")} ORDER BY s.nama LIMIT ?`).bind(...a, lim).all();
  return json(r.results);
});

on("GET", "/api/santri/:id", async ({ db, u, p }) => {
  wajibAdaAkses(u);
  const s = await db.prepare("SELECT * FROM santri WHERE id = ?").bind(p.id).first();
  if (!s) gagal(404, "Santri tidak ditemukan.");
  cekLing(u, s.lingkungan);
  const wali = await db.prepare("SELECT w.* FROM wali w JOIN santri_wali sw ON sw.wali_id = w.id WHERE sw.santri_id = ?").bind(p.id).all();
  s.wali = wali.results;
  return json(s);
});

async function pindahRiwayat(db, tabel, kolom, santriId, targetId, sebab, ta) {
  const buka = await db.prepare(`SELECT ${kolom} t FROM ${tabel} WHERE santri_id = ? AND selesai IS NULL`).bind(santriId).first();
  if (buka && buka.t === targetId) return [];
  const st = [db.prepare(`UPDATE ${tabel} SET selesai = ? WHERE santri_id = ? AND selesai IS NULL`).bind(hariIni(), santriId)];
  if (targetId) st.push(tabel === "riwayat_kelas"
    ? db.prepare("INSERT INTO riwayat_kelas (santri_id, kelas_id, tahun_ajaran_id, mulai, sebab) VALUES (?,?,?,?,?)").bind(santriId, targetId, ta, hariIni(), sebab)
    : db.prepare("INSERT INTO riwayat_kamar (santri_id, kamar_id, mulai, sebab) VALUES (?,?,?,?)").bind(santriId, targetId, hariIni(), sebab));
  return st;
}

on("POST", "/api/santri", async ({ db, u, body }) => {
  wajibModerator(u);
  const d = {
    nis: bersih(body.nis, 12), nama: bersih(body.nama, 120), jenis_kelamin: body.jenis_kelamin,
    tempat_lahir: bersih(body.tempat_lahir, 60), tanggal_lahir: bersih(body.tanggal_lahir, 10),
    status: body.status || "aktif", kabupaten: bersih(body.kabupaten, 60), provinsi: bersih(body.provinsi, 60),
  };
  if (!d.nis || !d.nama || !["L", "P"].includes(d.jenis_kelamin)) gagal(400, "NIS, nama, dan jenis kelamin wajib diisi.");
  const ling = d.jenis_kelamin === "L" ? "putra" : "putri";
  const kelasId = body.kelas_id ? +body.kelas_id : null, kamarId = body.kamar_id ? +body.kamar_id : null;
  if (kamarId) { const k = await db.prepare("SELECT lingkungan FROM kamar WHERE id = ?").bind(kamarId).first(); if (!k || k.lingkungan !== ling) gagal(400, "Kamar tidak sesuai jenis kelamin santri."); }
  if (kelasId) { const k = await db.prepare("SELECT lingkungan FROM kelas WHERE id = ?").bind(kelasId).first(); if (!k || k.lingkungan !== ling) gagal(400, "Kelas tidak sesuai lingkungan santri."); }
  const ta = (await db.prepare("SELECT id FROM tahun_ajaran WHERE status = 'aktif'").first())?.id || null;
  let id = body.id;
  let akhir = [];
  if (id) {
    const lama = await db.prepare("SELECT id, status, lingkungan FROM santri WHERE id = ?").bind(id).first();
    if (!lama) gagal(404, "Santri tidak ditemukan.");
    await db.prepare(`UPDATE santri SET nis=?, nama=?, jenis_kelamin=?, tempat_lahir=?, tanggal_lahir=?, kabupaten=?, provinsi=?, kelas_id=?, kamar_id=?, diubah_at=datetime('now') WHERE id=?`)
      .bind(d.nis, d.nama, d.jenis_kelamin, d.tempat_lahir, d.tanggal_lahir, d.kabupaten, d.provinsi, kelasId, kamarId, id).run();
    // status diubah paling akhir: alumni/mutasi/meninggal menutup kelas, kamar, grup, jabatan, akun (K-112)
    akhir = stmtUbahStatus(db, u, { ...lama, lingkungan: ling }, d.status, bersih(body.alasan_status, 200));
  } else {
    const r = await db.prepare("INSERT INTO santri (nis, nama, jenis_kelamin, tempat_lahir, tanggal_lahir, status, kabupaten, provinsi, kelas_id, kamar_id) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(d.nis, d.nama, d.jenis_kelamin, d.tempat_lahir, d.tanggal_lahir, d.status, d.kabupaten, d.provinsi, kelasId, kamarId).run();
    id = r.meta.last_row_id;
  }
  const st = [...await pindahRiwayat(db, "riwayat_kelas", "kelas_id", id, kelasId, "pindah", ta), ...await pindahRiwayat(db, "riwayat_kamar", "kamar_id", id, kamarId, "pindah", ta), ...akhir];
  if (st.length) await db.batch(st);
  await catat(db, u, "data", body.id ? "ubah" : "tambah", "santri", id, `${d.nis} ${d.nama}`, ling);
  return json({ ok: true, id });
});

// ---------------------------------------------------------------- guru: pencarian langsung & impor massal
// Cakupan: guru berlingkungan 'semua' terlihat semua orang; selain itu sesuai lingkungan pengguna.
on("GET", "/api/guru", async ({ db, u, url }) => {
  const w = [`(g.lingkungan = 'semua' OR g.lingkungan IN (${u.ling.map(() => "?").join(",")}))`], a = [...u.ling];
  const q = (url.searchParams.get("q") || "").trim();
  if (q) { w.push("(g.nama LIKE ? OR g.nip LIKE ?)"); a.push(`%${q}%`, `${q}%`); }
  const lf = url.searchParams.get("lingkungan");
  // filter putra/putri ikut menampilkan guru 'semua' (mengajar di kedua lingkungan); 'semua' = hanya guru 'semua'
  if (["putra", "putri"].includes(lf)) { w.push("(g.lingkungan = ? OR g.lingkungan = 'semua')"); a.push(lf); }
  else if (lf === "semua") w.push("g.lingkungan = 'semua'");
  if (url.searchParams.get("aktif") !== "semua") w.push("g.aktif = 1");
  const lim = Math.max(1, Math.min(+url.searchParams.get("limit") || 5, 50));
  const kolom = u.role === "moderator" ? "g.*" : "g.id, g.nip, g.nama, g.jenis_kelamin, g.lingkungan, g.aktif";
  const r = await db.prepare(`SELECT ${kolom} FROM guru g WHERE ${w.join(" AND ")} ORDER BY g.nama LIMIT ?`).bind(...a, lim).all();
  return json(r.results);
});

// Impor guru massal (CSV dibaca di browser): kunci = NIP; baris yang sudah ada diperbarui.
// Jenis kelamin boleh kosong bila nama bergelar "Ust." (L) / "Ustz./Ustzh./Ustadzah" (P).
on("POST", "/api/impor/guru", async ({ db, u, body }) => {
  wajibModerator(u);
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 300) : [];
  if (!rows.length) gagal(400, "Tidak ada baris untuk diimpor.");
  const hasil = { baru: 0, diperbarui: 0, ditolak: [] }, sah = new Map();
  for (const r of rows) {
    const nip = String(r.nip || "").trim(), nama = bersih(r.nama, 120);
    let jk = String(r.jk || "").trim().toUpperCase();
    if (!jk && nama) jk = /^(ustz|ustadzah)/i.test(nama) ? "P" : /^(ust\.|ustadz\b)/i.test(nama) ? "L" : "";
    const ling = String(r.lingkungan || "").trim().toLowerCase() || "semua";
    const email = bersih(r.email, 120);
    try {
      if (!/^\d{1,10}$/.test(nip)) throw new Error("NIP tidak valid");
      if (!nama) throw new Error("Nama kosong");
      if (!["L", "P"].includes(jk)) throw new Error("L/P tidak valid (isi L atau P)");
      if (!["putra", "putri", "semua"].includes(ling)) throw new Error("Lingkungan harus putra / putri / semua");
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Email tidak valid");
      if (sah.has(nip)) hasil.ditolak.push({ baris: sah.get(nip).baris, nip, alasan: "NIP ganda di file; dipakai baris " + r.baris });
      sah.set(nip, { baris: r.baris, nip, nama, jk, ling, email, hp: bersih(r.no_hp, 20) });
    } catch (e) { hasil.ditolak.push({ baris: r.baris, nip, alasan: e.message }); }
  }
  const daftar = [...sah.values()];
  if (daftar.length) {
    const ada = new Set((await db.prepare("SELECT nip FROM guru WHERE nip IN (SELECT value FROM json_each(?))").bind(JSON.stringify(daftar.map((d) => d.nip))).all()).results.map((r) => r.nip));
    const st = daftar.map((d) => db.prepare(`INSERT INTO guru (nip, nama, jenis_kelamin, no_hp, email, lingkungan) VALUES (?,?,?,?,?,?)
      ON CONFLICT (nip) DO UPDATE SET nama = excluded.nama, jenis_kelamin = excluded.jenis_kelamin, no_hp = COALESCE(excluded.no_hp, guru.no_hp),
        email = COALESCE(excluded.email, guru.email), lingkungan = excluded.lingkungan`).bind(d.nip, d.nama, d.jk, d.hp, d.email, d.ling));
    daftar.forEach((d) => hasil[ada.has(d.nip) ? "diperbarui" : "baru"]++);
    st.push(stmtCatat(db, u, "data", "impor", "guru", null, `Impor guru: ${hasil.baru} baru, ${hasil.diperbarui} diperbarui, ${hasil.ditolak.length} ditolak`));
    await db.batch(st);
  }
  return json(hasil);
});

// Impor data santri dari spreadsheet sekretariat (K-77…K-83).
// Browser hanya mengirim kolom yang diizinkan; kolom NIK/KK/penghasilan/NISN tidak pernah dikirim.
function bacaKelas(teks) {
  const t = String(teks || "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  let m = t.match(/^(\d)\s+(Intensif\s+[A-Z])(?:\s+(MTs|SMP))?$/i);
  if (m) return { tingkat: +m[1], rombel: m[2].replace(/^intensif/i, "Intensif"), jenjang: m[3] ? (m[3].toUpperCase() === "SMP" ? "SMP" : "MTs") : (+m[1] <= 3 ? "MTs" : "MA"), label: null };
  m = t.match(/^(\d)\s*([A-Z])(?:\s+(MTs|SMP|MIA|IIS))?$/i);
  if (!m) return null;
  const tingkat = +m[1], akhir = (m[3] || "").toUpperCase();
  const jenjang = tingkat >= 4 ? "MA" : akhir === "SMP" ? "SMP" : "MTs";
  return { tingkat, rombel: m[2].toUpperCase(), jenjang, label: ["MIA", "IIS"].includes(akhir) ? akhir : null };
}
const STATUS_IMPOR = { aktif: "aktif", "mutasi keluar": "mutasi_keluar", skorsing: "skorsing", meninggal: "meninggal", alumni: "alumni" };

// Hemat query: data acuan dibaca sekali, tulisan dikirim dalam db.batch (satu transaksi per kelompok).
// Batas Worker ±1000 query per permintaan; versi per-baris lama melewatinya pada kelompok 100 baris.
const tanda = (n) => Array(n).fill("?").join(",");

on("POST", "/api/impor/santri", async ({ db, u, body }) => {
  wajibModerator(u);
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 60) : [];
  if (!rows.length) gagal(400, "Tidak ada baris untuk diimpor.");
  const [taR, jjR, klR, asR, kmR] = await db.batch([
    db.prepare("SELECT id FROM tahun_ajaran WHERE status = 'aktif'"),
    db.prepare("SELECT id, nama FROM jenjang"),
    db.prepare("SELECT id, tingkat, rombel, jenjang_id, lingkungan FROM kelas"),
    db.prepare("SELECT id, nama, lingkungan FROM asrama"),
    db.prepare("SELECT id, nama, lingkungan FROM kamar"),
  ]);
  const ta = taR.results[0]?.id || null;
  const jenjang = Object.fromEntries(jjR.results.map((r) => [r.nama, r.id]));
  const kelas = Object.fromEntries(klR.results.map((r) => [`${r.tingkat}|${r.rombel}|${r.jenjang_id}|${r.lingkungan}`, r.id]));
  const asrama = Object.fromEntries(asR.results.map((r) => [r.nama, r]));
  const kamar = Object.fromEntries(kmR.results.map((r) => [r.nama, r]));
  const hasil = { baru: 0, diperbarui: 0, ditolak: [] };

  // 1) Periksa tiap baris; kelas/asrama/kamar baru dibuat (jarang, hanya saat pertama muncul).
  const siap = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], baris = r.baris || i + 1;
    try {
      const nis = String(r.nis || "").trim();
      const jk = String(r.jk || "").trim().toUpperCase();
      if (!/^\d{4,10}$/.test(nis)) throw new Error("NIS tidak valid");
      if (!["L", "P"].includes(jk)) throw new Error("L/P tidak valid");
      const ling = jk === "L" ? "putra" : "putri";
      let kelasId = null;
      const kb = bacaKelas(r.kelas);
      if (r.kelas && !kb) throw new Error("Format kelas tidak dikenal: " + r.kelas);
      if (kb) {
        const key = `${kb.tingkat}|${kb.rombel}|${jenjang[kb.jenjang]}|${ling}`;
        if (!kelas[key]) kelas[key] = (await db.prepare("INSERT INTO kelas (tingkat, rombel, jenjang_id, label, lingkungan) VALUES (?,?,?,?,?)").bind(kb.tingkat, kb.rombel, jenjang[kb.jenjang], kb.label, ling).run()).meta.last_row_id;
        kelasId = kelas[key];
      }
      let kamarId = null;
      const kmr = String(r.kamar || "").trim();
      if (kmr) {
        const m = kmr.match(/^(.*?)-(\d+)$/);
        if (!m) throw new Error("Format kamar tidak dikenal: " + kmr);
        const an = m[1].trim();
        if (!asrama[an]) asrama[an] = { id: (await db.prepare("INSERT INTO asrama (nama, lingkungan) VALUES (?, ?)").bind(an, ling).run()).meta.last_row_id, lingkungan: ling };
        if (!kamar[kmr]) kamar[kmr] = { id: (await db.prepare("INSERT INTO kamar (asrama_id, nomor, nama, lingkungan) VALUES (?,?,?,?)").bind(asrama[an].id, m[2], kmr, asrama[an].lingkungan).run()).meta.last_row_id, lingkungan: asrama[an].lingkungan };
        if (kamar[kmr].lingkungan !== ling) throw new Error("Kamar " + kmr + " bukan untuk santri " + ling);
        kamarId = kamar[kmr].id;
      }
      const v = [bersih(r.nama, 120), jk, bersih(r.tempat_lahir, 60), bersih(r.tanggal_lahir, 10), STATUS_IMPOR[String(r.status || "aktif").trim().toLowerCase()] || "aktif", bersih(r.kabupaten, 60), bersih(r.provinsi, 60), kelasId, kamarId];
      if (!v[0]) throw new Error("Nama kosong");
      if (siap.has(nis)) hasil.ditolak.push({ baris: siap.get(nis).baris, nis, alasan: "NIS ganda di file; dipakai baris " + baris });
      siap.set(nis, { baris, nis, v, kelasId, kamarId, wali: [["ayah", bersih(r.ayah, 120), r.wa_ayah], ["ibu", bersih(r.ibu, 120), r.wa_ibu]].filter((w) => w[1]) });
    } catch (e) {
      hasil.ditolak.push({ baris, nis: r.nis || "", alasan: e.message });
    }
  }
  const daftar = [...siap.values()];
  if (!daftar.length) return json(hasil);

  // 2) Santri: perbarui yang sudah ada, tambah yang baru — satu batch.
  const nisList = daftar.map((d) => d.nis);
  const ada = Object.fromEntries((await db.prepare(`SELECT id, nis, status FROM santri WHERE nis IN (${tanda(nisList.length)})`).bind(...nisList).all()).results.map((r) => [r.nis, r]));
  const tulis = daftar.map((d) => ada[d.nis]
    ? db.prepare("UPDATE santri SET nama=?, jenis_kelamin=?, tempat_lahir=?, tanggal_lahir=?, status=?, kabupaten=?, provinsi=?, kelas_id=?, kamar_id=?, diubah_at=datetime('now') WHERE id=?").bind(...d.v, ada[d.nis].id)
    : db.prepare("INSERT INTO santri (nis, nama, jenis_kelamin, tempat_lahir, tanggal_lahir, status, kabupaten, provinsi, kelas_id, kamar_id) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(d.nis, ...d.v));
  const hasilTulis = await db.batch(tulis);
  daftar.forEach((d, i) => {
    d.lama = ada[d.nis] || null;
    d.id = d.lama ? d.lama.id : hasilTulis[i].meta.last_row_id;
    hasil[d.lama ? "diperbarui" : "baru"]++;
  });

  // 3) Riwayat kelas/kamar, wali, dan penutupan akun — dibaca sekali, ditulis satu batch.
  const ids = daftar.map((d) => d.id), q = tanda(ids.length);
  const [rkR, rmR, wR] = await db.batch([
    db.prepare(`SELECT santri_id, kelas_id t FROM riwayat_kelas WHERE selesai IS NULL AND santri_id IN (${q})`).bind(...ids),
    db.prepare(`SELECT santri_id, kamar_id t FROM riwayat_kamar WHERE selesai IS NULL AND santri_id IN (${q})`).bind(...ids),
    db.prepare(`SELECT sw.santri_id, w.id, w.hubungan FROM wali w JOIN santri_wali sw ON sw.wali_id = w.id WHERE sw.santri_id IN (${q})`).bind(...ids),
  ]);
  const bukaKelas = Object.fromEntries(rkR.results.map((r) => [r.santri_id, r.t]));
  const bukaKamar = Object.fromEntries(rmR.results.map((r) => [r.santri_id, r.t]));
  const waliAda = Object.fromEntries(wR.results.map((r) => [`${r.santri_id}|${r.hubungan}`, r.id]));
  const hari = hariIni(), st = [];
  for (const d of daftar) {
    const sebab = d.lama ? "pindah" : "masuk";
    if (bukaKelas[d.id] !== d.kelasId && !(bukaKelas[d.id] === undefined && !d.kelasId)) {
      st.push(db.prepare("UPDATE riwayat_kelas SET selesai = ? WHERE santri_id = ? AND selesai IS NULL").bind(hari, d.id));
      if (d.kelasId) st.push(db.prepare("INSERT INTO riwayat_kelas (santri_id, kelas_id, tahun_ajaran_id, mulai, sebab) VALUES (?,?,?,?,?)").bind(d.id, d.kelasId, ta, hari, sebab));
    }
    if (bukaKamar[d.id] !== d.kamarId && !(bukaKamar[d.id] === undefined && !d.kamarId)) {
      st.push(db.prepare("UPDATE riwayat_kamar SET selesai = ? WHERE santri_id = ? AND selesai IS NULL").bind(hari, d.id));
      if (d.kamarId) st.push(db.prepare("INSERT INTO riwayat_kamar (santri_id, kamar_id, mulai, sebab) VALUES (?,?,?,?)").bind(d.id, d.kamarId, hari, sebab));
    }
    for (const [hub, nm, hp] of d.wali) {
      const wid = waliAda[`${d.id}|${hub}`];
      if (wid) st.push(db.prepare("UPDATE wali SET nama = ?, no_hp = ?, no_hp_normal = ? WHERE id = ?").bind(nm, bersih(hp, 20), normalHp(hp), wid));
      else st.push(
        db.prepare("INSERT INTO wali (nama, hubungan, no_hp, no_hp_normal) VALUES (?,?,?,?)").bind(nm, hub, bersih(hp, 20), normalHp(hp)),
        db.prepare("INSERT INTO santri_wali (santri_id, wali_id) VALUES (?, last_insert_rowid())").bind(d.id));
    }
    if (d.lama && d.lama.status !== d.v[4])
      st.push(...stmtUbahStatus(db, u, { id: d.id, status: d.lama.status, lingkungan: d.v[1] === "L" ? "putra" : "putri" }, d.v[4], "Impor data santri"));
  }
  st.push(stmtCatat(db, u, "data", "impor", "santri", null, `Impor santri: ${hasil.baru} baru, ${hasil.diperbarui} diperbarui, ${hasil.ditolak.length} ditolak`));
  await db.batch(st);
  return json(hasil);
});

// Impor link foto dari tab "santriphoto" (kolom induk = NIS, "Uk Besar (h_2048)" = link). Hanya link CDN sekretariat yang diterima.
const FOTO_SAH = /^https:\/\/ik\.imagekit\.io\/dulidobogor\/[^\s"'<>]{1,400}$/;
on("POST", "/api/impor/foto", async ({ db, u, body }) => {
  wajibModerator(u);
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 500) : [];
  if (!rows.length) gagal(400, "Tidak ada baris untuk diimpor.");
  const hasil = { diperbarui: 0, tidak_dikenal: 0, ditolak: [] };
  const sah = [];
  for (const r of rows) {
    const nis = String(r.nis || "").trim(), foto = String(r.foto || "").trim();
    if (!/^\d{4,10}$/.test(nis)) hasil.ditolak.push({ baris: r.baris, nis, alasan: "NIS tidak valid" });
    else if (!FOTO_SAH.test(foto)) hasil.ditolak.push({ baris: r.baris, nis, alasan: "Link foto bukan dari CDN sekretariat" });
    else sah.push({ nis, foto });
  }
  if (sah.length) {
    // Satu pernyataan untuk semua baris (json_each) supaya tetap jauh di bawah batas query per permintaan.
    const data = JSON.stringify(sah);
    const [up, cocok] = await db.batch([
      db.prepare("UPDATE santri SET foto_url = j.foto, diubah_at = datetime('now') FROM (SELECT json_extract(value, '$.nis') nis, json_extract(value, '$.foto') foto FROM json_each(?)) j WHERE santri.nis = j.nis AND COALESCE(santri.foto_url, '') <> j.foto").bind(data),
      db.prepare("SELECT COUNT(*) n FROM santri WHERE nis IN (SELECT json_extract(value, '$.nis') FROM json_each(?))").bind(data),
    ]);
    hasil.diperbarui = up.meta.changes;
    hasil.tidak_dikenal = sah.length - cocok.results[0].n;
  }
  if (hasil.diperbarui) await catat(db, u, "data", "impor", "santri", null, `Impor foto santri: ${hasil.diperbarui} diperbarui`);
  return json(hasil);
});

// ---------------------------------------------------------------- pengguna & Manajemen Akses (Moderator)
on("GET", "/api/users", async ({ db, u }) => {
  wajibModerator(u);
  const r = await db.prepare(
    `SELECT u.id, u.email, u.nama, u.role, u.lingkungan, u.status, u.login_terakhir, u.santri_id, u.guru_id, u.preset_id, pr.nama preset,
            (u.password_hash IS NOT NULL) punya_password, s.nis, g.nip,
            (SELECT GROUP_CONCAT(akses_kode) FROM user_akses ua WHERE ua.user_id = u.id) akses
     FROM users u LEFT JOIN santri s ON s.id = u.santri_id LEFT JOIN guru g ON g.id = u.guru_id LEFT JOIN preset pr ON pr.id = u.preset_id
     ORDER BY u.status <> 'aktif', u.role IS NOT NULL, akses IS NOT NULL, u.nama`).all();
  const [ak, pr, pa] = await db.batch([
    db.prepare("SELECT * FROM akses ORDER BY kode"),
    db.prepare("SELECT * FROM preset ORDER BY urutan, nama"),
    db.prepare("SELECT preset_id, akses_kode FROM preset_akses"),
  ]);
  const presets = pr.results.map((x) => ({ ...x, akses: pa.results.filter((a) => a.preset_id === x.id).map((a) => a.akses_kode) }));
  return json({ users: r.results.map((x) => ({ ...x, akses: x.akses ? x.akses.split(",") : [] })), akses: ak.results, preset: presets });
});

on("POST", "/api/users/dari-santri", async ({ db, u, body }) => {
  wajibModerator(u);
  const s = await db.prepare("SELECT * FROM santri WHERE id = ?").bind(body.santri_id).first();
  if (!s || s.status !== "aktif") gagal(400, "Santri tidak ditemukan atau tidak aktif.");
  const preset = await cariPreset(db, body);
  const pw = passwordSementara();
  const r = await db.prepare("INSERT INTO users (email, password_hash, nama, santri_id, lingkungan, status, wajib_ganti_password) VALUES (?,?,?,?,?,'aktif',1)")
    .bind(`${s.nis}@daarululuumlido.com`, await hashPassword(pw), s.nama, s.id, s.lingkungan).run();
  if (preset) await db.batch(stmtTerapkanPreset(db, "?", [r.meta.last_row_id], "?", [preset.id], u.id));
  await catat(db, u, "akun", "buat", "users", r.meta.last_row_id, `Akun pengurus ${s.nis}${preset ? " · preset " + preset.nama : ""}`, s.lingkungan);
  return json({ ok: true, id: r.meta.last_row_id, password_sementara: pw });
});

on("POST", "/api/users/guru", async ({ db, u, body }) => {
  wajibModerator(u);
  const g = await db.prepare("SELECT * FROM guru WHERE id = ?").bind(body.guru_id).first();
  if (!g) gagal(400, "Guru tidak ditemukan.");
  const email = bersih(body.email || g.email, 120)?.toLowerCase();
  if (!email) gagal(400, "Email guru wajib diisi.");
  if (emailSantri(email)) gagal(400, "Email berpola akun santri (NIS@…) tidak boleh dipakai untuk akun guru.");
  const preset = await cariPreset(db, body);
  const r = await db.prepare("INSERT INTO users (email, nama, guru_id, lingkungan, wajib_ganti_password) VALUES (?,?,?,?,0)")
    .bind(email, g.nama, g.id, g.lingkungan).run();
  if (preset) await db.batch(stmtTerapkanPreset(db, "?", [r.meta.last_row_id], "?", [preset.id], u.id));
  await catat(db, u, "akun", "buat", "users", r.meta.last_row_id, `Akun guru ${g.nip}${preset ? " · preset " + preset.nama : ""} (login dengan Google)`);
  return json({ ok: true, id: r.meta.last_row_id });
});

on("POST", "/api/users/moderator", async ({ db, u, body }) => {
  wajibModerator(u);
  const email = bersih(body.email, 120)?.toLowerCase();
  if (!email || !body.nama) gagal(400, "Nama dan email wajib diisi.");
  if (emailSantri(email)) gagal(400, "Akun santri tidak boleh menjadi Moderator (K-11).");
  const r = await db.prepare("INSERT INTO users (email, nama, role, lingkungan, wajib_ganti_password) VALUES (?,?, 'moderator', 'semua', 0)").bind(email, bersih(body.nama, 120)).run();
  await catat(db, u, "akun", "buat", "users", r.meta.last_row_id, `Moderator baru ${email} (login dengan Google)`);
  return json({ ok: true, id: r.meta.last_row_id });
});

on("POST", "/api/users/:id", async ({ db, u, p, body }) => {
  wajibModerator(u);
  const t = await db.prepare("SELECT * FROM users WHERE id = ?").bind(p.id).first();
  if (!t) gagal(404, "Akun tidak ditemukan.");
  // Moderator = status khusus (bukan role/preset); akun santri tidak boleh menjadi Moderator (K-11).
  const role = "moderator" in body ? (body.moderator ? "moderator" : null) : t.role;
  if (role === "moderator" && (t.santri_id || emailSantri(t.email))) gagal(400, "Akun santri tidak boleh menjadi Moderator (K-11).");
  const status = body.status && ["aktif", "nonaktif"].includes(body.status) ? body.status : t.status;
  if (t.id === u.id && (status !== "aktif" || role !== "moderator")) gagal(400, "Anda tidak bisa menonaktifkan atau menurunkan akun sendiri.");
  // Lingkungan: diatur untuk akun non-santri. Moderator yang diturunkan WAJIB diberi lingkungan (tidak otomatis tetap 'semua').
  const lingBaru = !t.santri_id && ["putra", "putri", "semua"].includes(body.lingkungan) ? body.lingkungan : null;
  if (t.role === "moderator" && role !== "moderator" && !lingBaru) gagal(400, "Pilih lingkungan akun ini setelah status Moderator dicabut.");
  const ling = role === "moderator" ? "semua" : lingBaru || t.lingkungan;
  const st = [db.prepare("UPDATE users SET role = ?, status = ?, lingkungan = ? WHERE id = ?").bind(role, status, ling, t.id)];
  if (role !== t.role) st.push(stmtNotif(db, t.id, { jenis: "akun", judul: role ? "Anda sekarang Moderator" : "Status Moderator Anda dicabut",
    isi: role ? "Semua menu dan akses tersedia. Muat ulang halaman bila menu belum berubah." : "Akses Anda kini mengikuti akses yang diberikan Moderator.", tautan: "/akun" }));
  if (ling !== t.lingkungan) st.push(stmtNotif(db, t.id, { jenis: "akun", judul: `Lingkungan Anda sekarang: ${ling}`, tautan: "/akun" }));
  await db.batch(st);
  if (status !== "aktif") await db.prepare("DELETE FROM sesi_login WHERE user_id = ?").bind(t.id).run();
  await catat(db, u, "akses", "ubah_akun", "users", t.id, `${t.email}: ${role === "moderator" ? "Moderator" : "akses manual"}, status=${status}, lingkungan=${ling}`);
  return json({ ok: true });
});

on("POST", "/api/users/:id/akses", async ({ db, u, p, body }) => {
  wajibModerator(u);
  const kode = String(body.kode || "");
  if (!(await db.prepare("SELECT kode FROM akses WHERE kode = ?").bind(kode).first())) gagal(400, "Jenis akses tidak dikenal.");
  const ak = await db.prepare("SELECT nama FROM akses WHERE kode = ?").bind(kode).first();
  const r = body.beri
    ? await db.prepare("INSERT OR IGNORE INTO user_akses (user_id, akses_kode, diberikan_oleh) VALUES (?,?,?)").bind(p.id, kode, u.id).run()
    : await db.prepare("DELETE FROM user_akses WHERE user_id = ? AND akses_kode = ?").bind(p.id, kode).run();
  if (r.meta.changes) await stmtNotif(db, +p.id, { jenis: "akun", judul: `Akses ${body.beri ? "diberikan" : "dicabut"}: ${ak.nama}`,
    isi: body.beri ? "Menu terkait kini tersedia untuk Anda." : null, tautan: "/akun" }).run();
  await catat(db, u, "akses", body.beri ? "beri" : "cabut", "user_akses", +p.id, kode);
  return json({ ok: true });
});

// Terapkan preset: akses akun diganti dengan isi preset (salinan). Sesudahnya akses bisa diubah satu per satu.
on("POST", "/api/users/:id/preset", async ({ db, u, p, body }) => {
  wajibModerator(u);
  const t = await db.prepare("SELECT * FROM users WHERE id = ?").bind(p.id).first();
  if (!t) gagal(404, "Akun tidak ditemukan.");
  if (t.role === "moderator") gagal(400, "Moderator sudah memegang semua akses.");
  const pr = await cariPreset(db, body);
  if (!pr) gagal(400, "Pilih preset.");
  await db.batch([
    ...stmtTerapkanPreset(db, "?", [t.id], "?", [pr.id], u.id),
    stmtNotif(db, t.id, { jenis: "akun", judul: `Akses Anda diperbarui: preset ${pr.nama}`, isi: "Muat ulang halaman bila menu belum berubah.", tautan: "/akun" }),
    stmtCatat(db, u, "akses", "terapkan_preset", "users", t.id, `${t.email}: preset ${pr.nama}`),
  ]);
  return json({ ok: true });
});

on("GET", "/api/preset", async ({ db, u }) => {
  wajibModerator(u);
  const [pr, pa, dipakai] = await db.batch([
    db.prepare("SELECT * FROM preset ORDER BY urutan, nama"),
    db.prepare("SELECT preset_id, akses_kode FROM preset_akses"),
    db.prepare("SELECT preset_id, COUNT(*) n FROM users WHERE preset_id IS NOT NULL AND status = 'aktif' GROUP BY preset_id"),
  ]);
  return json(pr.results.map((x) => ({ ...x, akses: pa.results.filter((a) => a.preset_id === x.id).map((a) => a.akses_kode),
    dipakai: (dipakai.results.find((d) => d.preset_id === x.id) || {}).n || 0 })));
});
// {id?, nama, keterangan, urutan, akses: [kode…]}. Mengubah preset TIDAK mengubah akun yang sudah memakainya.
on("POST", "/api/preset", async ({ db, u, body }) => {
  wajibModerator(u);
  const nama = bersih(body.nama, 60), ket = bersih(body.keterangan, 200);
  if (!nama) gagal(400, "Nama preset wajib diisi.");
  const kode = [...new Set((Array.isArray(body.akses) ? body.akses : []).map(String))];
  const sah = new Set((await db.prepare("SELECT kode FROM akses").all()).results.map((r) => r.kode));
  if (kode.some((k) => !sah.has(k))) gagal(400, "Ada jenis akses yang tidak dikenal.");
  let id = +body.id || 0;
  if (id) {
    if (!(await db.prepare("SELECT 1 FROM preset WHERE id = ?").bind(id).first())) gagal(404, "Preset tidak ditemukan.");
    await db.prepare("UPDATE preset SET nama = ?, keterangan = ?, urutan = COALESCE(?, urutan) WHERE id = ?").bind(nama, ket, body.urutan ?? null, id).run();
  } else {
    id = (await db.prepare("INSERT INTO preset (nama, keterangan, urutan) VALUES (?,?, COALESCE(?, (SELECT COALESCE(MAX(urutan),0)+1 FROM preset)))").bind(nama, ket, body.urutan ?? null).run()).meta.last_row_id;
  }
  await db.batch([
    db.prepare("DELETE FROM preset_akses WHERE preset_id = ?").bind(id),
    db.prepare("INSERT INTO preset_akses (preset_id, akses_kode) SELECT ?, value FROM json_each(?)").bind(id, JSON.stringify(kode)),
    stmtCatat(db, u, "akses", body.id ? "ubah_preset" : "buat_preset", "preset", id, `Preset ${nama}: ${kode.join(", ") || "(kosong)"}`),
  ]);
  return json({ ok: true, id });
});
on("POST", "/api/preset/:id/hapus", async ({ db, u, p }) => {
  wajibModerator(u);
  const pr = await db.prepare("SELECT * FROM preset WHERE id = ?").bind(p.id).first();
  if (!pr) gagal(404, "Preset tidak ditemukan.");
  // akun yang pernah memakai preset ini tetap memegang aksesnya; hanya keterangan presetnya yang hilang
  await db.batch([
    db.prepare("UPDATE users SET preset_id = NULL WHERE preset_id = ?").bind(pr.id),
    db.prepare("DELETE FROM preset_akses WHERE preset_id = ?").bind(pr.id),
    db.prepare("DELETE FROM preset WHERE id = ?").bind(pr.id),
    stmtCatat(db, u, "akses", "hapus_preset", "preset", pr.id, `Preset ${pr.nama} dihapus`),
  ]);
  return json({ ok: true });
});

on("POST", "/api/users/:id/reset-password", async ({ db, u, p }) => {
  wajibModerator(u);
  const t = await db.prepare("SELECT * FROM users WHERE id = ?").bind(p.id).first();
  if (!t) gagal(404, "Akun tidak ditemukan.");
  const pw = passwordSementara();
  await db.batch([
    db.prepare("UPDATE users SET password_hash = ?, wajib_ganti_password = 1, gagal_login = 0, terkunci_sampai = NULL, status = CASE WHEN status = 'tertahan' THEN 'aktif' ELSE status END WHERE id = ?").bind(await hashPassword(pw), t.id),
    db.prepare("DELETE FROM sesi_login WHERE user_id = ?").bind(t.id),
    stmtNotif(db, t.id, { jenis: "akun", judul: "Password Anda direset oleh Moderator", isi: "Bila Anda tidak memintanya, segera hubungi Moderator.", tautan: "/akun" }),
  ]);
  await catat(db, u, "akun", "reset_password", "users", t.id, t.email);
  return json({ ok: true, password_sementara: pw });
});

// ---------------------------------------------------------------- perizinan
// Lewat masa tenggang → overdue: pelanggaran otomatis kategori Keamanan + kabar ke wali (README Perizinan).
async function perbaruiOverdue(db) {
  const tenggang = +(await pengaturan(db, "overdue.masa_tenggang_menit", "60")) || 60;
  const kini = wib();
  // Klaim dalam satu pernyataan: hanya izin yang benar-benar berubah oleh pemanggilan ini yang diproses,
  // jadi dua permintaan bersamaan tidak membuat pelanggaran/riwayat/email ganda.
  const baru = (await db.prepare(
    `UPDATE izin SET status = 'overdue', overdue_at = ? WHERE id IN
       (SELECT id FROM izin WHERE status = 'berjalan' AND rencana_kembali < ? LIMIT 200) AND status = 'berjalan'
     RETURNING id, santri_id, lingkungan, rencana_kembali, jenis_izin_id`).bind(kini, wib(Date.now() - tenggang * 60e3)).all()).results;
  if (!baru.length) return 0;
  const katNama = await pengaturan(db, "overdue.kategori_pelanggaran", "Keamanan");
  const kat = await db.prepare("SELECT id FROM pilihan WHERE kelompok = 'kategori_pelanggaran' AND nama = ? ORDER BY lingkungan = 'semua' DESC LIMIT 1").bind(katNama).first();
  const ids = JSON.stringify(baru.map((z) => z.id));
  const daftar = `(SELECT value id FROM json_each(?)) j JOIN izin z ON z.id = j.id JOIN jenis_izin ji ON ji.id = z.jenis_izin_id`;
  const kaki = `\n\nRincian dapat dilihat setelah masuk ke Portal Wali: ${APP(ENV)}/wali.html\n\n— HISADA, Pesantren Modern Daarul 'Uluum Lido`;
  const st = [
    db.prepare(`INSERT INTO riwayat_perubahan (user_id, kategori, aksi, tabel, data_id, ringkasan, lingkungan, masa_khidmat_id)
      SELECT NULL, 'kesantrian', 'izin_overdue', 'izin', z.id, 'Izin overdue otomatis', z.lingkungan, (SELECT id FROM masa_khidmat WHERE status = 'aktif')
      FROM ${daftar}`).bind(ids),
    // Kabar wali (K-76) untuk semua izin sekaligus; isi sama dengan kabarWali().
    db.prepare(`INSERT INTO email_antrean (penerima, subjek, isi, jenis, tabel_terkait, id_terkait, akun_wali_id, lingkungan)
      SELECT a.email, substr('[HISADA] Belum kembali ke pondok — ' || s.nama, 1, 200),
        'Assalamu''alaikum ' || a.nama || ',' || char(10) || char(10) || 'Ananda belum kembali ke pondok setelah batas waktu izin (' || ji.nama
          || ', batas kembali ' || z.rencana_kembali || ' WIB). Mohon segera menghubungi wali kamar / Bagian Keamanan.' || ?,
        'wali', 'izin', z.id, a.id, s.lingkungan
      FROM ${daftar} JOIN santri s ON s.id = z.santri_id
        JOIN tautan_wali t ON t.santri_id = s.id AND t.dicabut_at IS NULL JOIN akun_wali a ON a.id = t.akun_wali_id AND a.status = 'aktif'`).bind(kaki, ids),
  ];
  st.push(db.prepare(`INSERT INTO notifikasi (user_id, jenis, judul, isi, tautan)
    SELECT DISTINCT us.id, 'santri', substr('Belum kembali ke pondok — ' || s.nama, 1, 200),
      'Belum kembali setelah batas waktu izin (' || ji.nama || ', batas kembali ' || z.rencana_kembali || ' WIB).', '/cari?santri=' || s.id
    FROM ${daftar} JOIN santri s ON s.id = z.santri_id JOIN tahun_ajaran ta ON ta.status = 'aktif'
      JOIN users us ON us.status = 'aktif' AND us.guru_id IN (
        SELECT guru_id FROM wali_kelas WHERE tahun_ajaran_id = ta.id AND kelas_id = s.kelas_id
        UNION SELECT guru_id FROM wali_asuh_kamar WHERE tahun_ajaran_id = ta.id AND kamar_id = s.kamar_id)`).bind(ids));
  if (kat) st.push(db.prepare(`INSERT INTO pelanggaran (santri_id, lingkungan, kategori_id, keterangan, tanggal, sumber, izin_id)
    SELECT z.santri_id, z.lingkungan, ?, 'Terlambat kembali (overdue) dari ' || ji.nama || '; batas kembali ' || z.rencana_kembali, substr(z.rencana_kembali, 1, 10), 'overdue', z.id
    FROM ${daftar} WHERE 1 ON CONFLICT (izin_id) DO NOTHING`).bind(kat.id, ids));
  await db.batch(st);
  EMAIL_DIBUAT++;
  return baru.length;
}
const keadaanIzin = (z) => {
  if (z.status !== "berjalan") return z.status;
  return z.rencana_kembali < wib() ? "terlambat" : "berjalan";
};

on("GET", "/api/izin", async ({ db, u, url }) => {
  wajib(u, "perizinan");
  await perbaruiOverdue(db);
  const l = lingIn(u, "z.lingkungan");
  const aktif = url.searchParams.get("status") !== "riwayat";
  const r = await db.prepare(
    `SELECT z.*, s.nis, s.nama, s.foto_url, ji.nama jenis, ji.basis_waktu, km.nama kamar,
            (k.tingkat || ' ' || k.rombel || ' ' || j.nama) kelas, ub.nama penerbit
     FROM izin z JOIN santri s ON s.id = z.santri_id JOIN jenis_izin ji ON ji.id = z.jenis_izin_id
     LEFT JOIN kamar km ON km.id = s.kamar_id LEFT JOIN kelas k ON k.id = s.kelas_id LEFT JOIN jenjang j ON j.id = k.jenjang_id
     LEFT JOIN users ub ON ub.id = z.diterbitkan_oleh
     WHERE ${l.sql} AND ${aktif ? "z.status IN ('berjalan','overdue')" : "z.status IN ('kembali','dibatalkan')"}
     ORDER BY ${aktif ? "z.rencana_kembali" : "z.dibuat_at DESC"} LIMIT 300`).bind(...l.args).all();
  return json(r.results.map((z) => ({ ...z, keadaan: keadaanIzin(z) })));
});

on("GET", "/api/izin/:id", async ({ db, u, p }) => {
  wajib(u, "perizinan");
  const z = await db.prepare(
    `SELECT z.*, s.nis, s.nama, s.foto_url, ji.nama jenis, ji.basis_waktu, km.nama kamar, (k.tingkat || ' ' || k.rombel || ' ' || j.nama) kelas
     FROM izin z JOIN santri s ON s.id = z.santri_id JOIN jenis_izin ji ON ji.id = z.jenis_izin_id
     LEFT JOIN kamar km ON km.id = s.kamar_id LEFT JOIN kelas k ON k.id = s.kelas_id LEFT JOIN jenjang j ON j.id = k.jenjang_id WHERE z.id = ?`).bind(p.id).first();
  if (!z) gagal(404, "Izin tidak ditemukan.");
  cekLing(u, z.lingkungan);
  return json({ ...z, keadaan: keadaanIzin(z) });
});

const formatWaktu = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
on("POST", "/api/izin", async ({ db, u, body }) => {
  wajib(u, "perizinan");
  const s = await db.prepare("SELECT * FROM santri WHERE id = ?").bind(body.santri_id).first();
  if (!s) gagal(400, "Santri tidak ditemukan.");
  cekLing(u, s.lingkungan);
  if (s.status !== "aktif") gagal(400, "Santri tidak berstatus aktif.");
  const ji = await db.prepare("SELECT * FROM jenis_izin WHERE id = ? AND aktif = 1").bind(body.jenis_izin_id).first();
  if (!ji) gagal(400, "Jenis izin tidak valid.");
  const ket = bersih(body.keterangan, 200);
  if (!ket) gagal(400, "Keterangan izin wajib diisi.");
  let berangkat = String(body.berangkat || ""), kembali = String(body.rencana_kembali || "");
  if (ji.basis_waktu === "jam") { berangkat = wib(); kembali = hariIni() + " " + kembali.slice(-5); }
  if (ji.basis_waktu === "tanggal") { berangkat = berangkat.slice(0, 10) + " " + wib().slice(11); kembali = kembali.slice(0, 10) + " " + (ji.jam_kembali_bawaan || "17:00"); }
  if (!formatWaktu.test(berangkat) || !formatWaktu.test(kembali)) gagal(400, "Format waktu tidak valid.");
  if (kembali <= berangkat) gagal(400, "Waktu kembali harus setelah waktu berangkat.");
  const pendamping = bersih(body.pendamping, 120);
  if (ji.wajib_wali && !pendamping) gagal(400, `Izin ${ji.nama} wajib didampingi wali — isi nama pendamping.`);
  const buka = await db.prepare("SELECT id FROM izin WHERE santri_id = ? AND status IN ('berjalan','overdue')").bind(s.id).first();
  if (buka) gagal(409, "Santri ini masih punya izin yang belum selesai.");
  const r = await db.prepare("INSERT INTO izin (santri_id, jenis_izin_id, keterangan, berangkat, rencana_kembali, pendamping, lingkungan, diterbitkan_oleh) VALUES (?,?,?,?,?,?,?,?)")
    .bind(s.id, ji.id, ket, berangkat, kembali, pendamping, s.lingkungan, u.id).run();
  await catat(db, u, "kesantrian", "izin_terbit", "izin", r.meta.last_row_id, `${ji.nama}: ${s.nis} ${s.nama}`, s.lingkungan);
  await kabarWali(db, s.id, {
    subjek: `${ji.nama} diterbitkan`, tabel: "izin", id: r.meta.last_row_id,
    isi: `Ananda mendapat izin ${ji.nama} dari pondok: berangkat ${berangkat} WIB, kembali paling lambat ${kembali} WIB.`,
  });
  return json({ ok: true, id: r.meta.last_row_id });
});

on("POST", "/api/izin/:id/kembali", async ({ db, u, p }) => {
  wajib(u, "perizinan");
  const z = await db.prepare("SELECT * FROM izin WHERE id = ?").bind(p.id).first();
  if (!z) gagal(404, "Izin tidak ditemukan.");
  cekLing(u, z.lingkungan);
  if (!["berjalan", "overdue"].includes(z.status)) gagal(400, "Izin ini sudah selesai.");
  await db.prepare("UPDATE izin SET status = 'kembali', kembali_at = ?, dikonfirmasi_oleh = ? WHERE id = ?").bind(wib(), u.id, z.id).run();
  await catat(db, u, "kesantrian", "izin_kembali", "izin", z.id, z.status === "overdue" ? "Kembali setelah overdue" : "Kembali", z.lingkungan);
  return json({ ok: true });
});

on("POST", "/api/izin/:id/batal", async ({ db, u, p, body }) => {
  wajib(u, "perizinan");
  const z = await db.prepare("SELECT * FROM izin WHERE id = ?").bind(p.id).first();
  if (!z) gagal(404, "Izin tidak ditemukan.");
  cekLing(u, z.lingkungan);
  const alasan = bersih(body.alasan, 200);
  if (!alasan) gagal(400, "Alasan pembatalan wajib diisi.");
  if (!["berjalan", "overdue"].includes(z.status)) gagal(400, "Izin ini sudah selesai.");
  await db.batch([
    db.prepare("UPDATE izin SET status = 'dibatalkan', dibatalkan_at = ?, dibatalkan_oleh = ?, alasan_batal = ? WHERE id = ?").bind(wib(), u.id, alasan, z.id),
    db.prepare("DELETE FROM absensi WHERE izin_id = ? AND sumber IN ('perizinan','overdue')").bind(z.id),
  ]);
  await catat(db, u, "kesantrian", "izin_batal", "izin", z.id, alasan, z.lingkungan);
  return json({ ok: true });
});

// ---------------------------------------------------------------- absensi harian (per kamar + sesi)
async function statusOtomatis(db, santriIds, tanggal) {
  // Izin yang mencakup tanggal ini → status jenis izin; overdue → status overdue (K-95); skorsing → Pulang (K-101).
  if (!santriIds.length) return {};
  // Daftar id sebagai satu parameter JSON: D1 membatasi 100 parameter per kueri (kamar/grup bisa > 100 santri).
  const ids = JSON.stringify(santriIds);
  const ph = "SELECT value FROM json_each(?)";
  const kodeOverdue = await pengaturan(db, "overdue.status_kode", "A");
  const kodeSkors = await pengaturan(db, "skorsing.status_kode", "P");
  const sk = Object.fromEntries((await db.prepare("SELECT id, kode FROM status_kehadiran").all()).results.map((r) => [r.kode, r.id]));
  const hasil = {};
  const izin = await db.prepare(
    `SELECT z.id, z.santri_id, z.status, z.berangkat, z.rencana_kembali, z.kembali_at, z.overdue_at, z.overdue_dikoreksi_at, ji.status_kehadiran_id, ji.nama jenis
     FROM izin z JOIN jenis_izin ji ON ji.id = z.jenis_izin_id
     WHERE z.santri_id IN (${ph}) AND z.status <> 'dibatalkan' AND substr(z.berangkat,1,10) <= ? AND (z.kembali_at IS NULL OR substr(z.kembali_at,1,10) >= ?)`)
    .bind(ids, tanggal, tanggal).all();
  for (const z of izin.results) {
    if (z.kembali_at && z.kembali_at.slice(0, 10) === tanggal) continue;
    // Overdue hanya untuk hari sejak batas kembali (bukan hari-hari izin yang sah), juga setelah santri kembali; kecuali dikoreksi.
    const overdue = z.overdue_at && !z.overdue_dikoreksi_at && tanggal >= z.rencana_kembali.slice(0, 10);
    if (overdue && sk[kodeOverdue]) hasil[z.santri_id] = { status_kehadiran_id: sk[kodeOverdue], sumber: "overdue", izin_id: z.id, keterangan: "Overdue: " + z.jenis };
    else if (z.status_kehadiran_id) hasil[z.santri_id] = { status_kehadiran_id: z.status_kehadiran_id, sumber: "perizinan", izin_id: z.id, keterangan: z.jenis };
  }
  // Perawatan kesehatan → Sakit selama belum ditandai selesai dirawat (prioritas di bawah perizinan).
  const rawat = await db.prepare(
    `SELECT k.id, k.santri_id, jk.status_kehadiran_id, jk.nama FROM kunjungan_kesehatan k JOIN jenis_kunjungan jk ON jk.id = k.jenis_kunjungan_id
     WHERE k.santri_id IN (${ph}) AND k.status = 'aktif' AND jk.status_kehadiran_id IS NOT NULL
       AND substr(k.waktu,1,10) <= ? AND (k.selesai_rawat_at IS NULL OR substr(k.selesai_rawat_at,1,10) >= ?)`).bind(ids, tanggal, tanggal).all();
  for (const k of rawat.results) if (!hasil[k.santri_id]) hasil[k.santri_id] = { status_kehadiran_id: k.status_kehadiran_id, sumber: "kesehatan", izin_id: null, kunjungan_id: k.id, keterangan: k.nama };
  // Skorsing (status santri, atau skorsing bertanggal yang mencakup tanggal ini) mengalahkan semuanya.
  const skors = await db.prepare(
    `SELECT id FROM santri WHERE id IN (${ph}) AND status = 'skorsing'
     UNION SELECT santri_id FROM skorsing WHERE santri_id IN (${ph}) AND status <> 'dibatalkan' AND mulai <= ? AND selesai >= ?`).bind(ids, ids, tanggal, tanggal).all();
  if (sk[kodeSkors]) for (const s of skors.results) hasil[s.id] = { status_kehadiran_id: sk[kodeSkors], sumber: "skorsing", izin_id: null, keterangan: "Skorsing" };
  return hasil;
}

on("GET", "/api/absensi", async ({ db, u, url }) => {
  wajib(u, "absensi");
  await perbaruiOverdue(db);
  const kamarId = +url.searchParams.get("kamar_id"), sesiId = +url.searchParams.get("sesi_id");
  const tanggal = url.searchParams.get("tanggal") || hariIni();
  const km = await db.prepare("SELECT * FROM kamar WHERE id = ?").bind(kamarId).first();
  if (!km) gagal(400, "Pilih kamar.");
  cekLing(u, km.lingkungan);
  const santri = (await db.prepare("SELECT id, nis, nama, status, foto_url FROM santri WHERE kamar_id = ? AND status IN ('aktif','skorsing') ORDER BY nama").bind(kamarId).all()).results;
  const sesi = await db.prepare("SELECT * FROM absensi_sesi WHERE jenis = 'harian' AND tanggal = ? AND sesi_pilihan_id = ? AND target_id = ?").bind(tanggal, sesiId, kamarId).first();
  const tersimpan = sesi ? Object.fromEntries((await db.prepare("SELECT * FROM absensi WHERE sesi_id = ?").bind(sesi.id).all()).results.map((a) => [a.santri_id, a])) : {};
  const oto = await statusOtomatis(db, santri.map((s) => s.id), tanggal);
  return json({
    kamar: km, tanggal, sesi_id: sesiId, terisi: !!sesi, diisi_at: sesi?.diisi_at || null,
    santri: santri.map((s) => {
      const o = oto[s.id];
      const t = tersimpan[s.id];
      return { ...s, status_kehadiran_id: o ? o.status_kehadiran_id : t ? t.status_kehadiran_id : null, otomatis: o ? o.sumber : null, keterangan: o ? o.keterangan : t?.keterangan || null };
    }),
  });
});

on("POST", "/api/absensi", async ({ db, u, body }) => {
  wajib(u, "absensi");
  const kamarId = +body.kamar_id, sesiId = +body.sesi_id, tanggal = String(body.tanggal || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) gagal(400, "Tanggal tidak valid.");
  if (tanggal > hariIni()) gagal(400, "Tidak bisa mengisi absensi untuk tanggal mendatang.");
  const km = await db.prepare("SELECT * FROM kamar WHERE id = ?").bind(kamarId).first();
  if (!km) gagal(400, "Kamar tidak ditemukan.");
  cekLing(u, km.lingkungan);
  const sesiP = await db.prepare("SELECT id FROM pilihan WHERE id = ? AND kelompok = 'sesi_absensi'").bind(sesiId).first();
  if (!sesiP) gagal(400, "Sesi absensi tidak valid.");
  const penghuni = new Set((await db.prepare("SELECT id FROM santri WHERE kamar_id = ? AND status IN ('aktif','skorsing')").bind(kamarId).all()).results.map((r) => r.id));
  const valid = new Set((await db.prepare("SELECT id FROM status_kehadiran WHERE aktif = 1").all()).results.map((r) => r.id));
  const items = (body.items || []).filter((i) => penghuni.has(+i.santri_id));
  if (items.some((i) => !valid.has(+i.status_kehadiran_id))) gagal(400, "Ada status kehadiran yang tidak valid.");
  if (new Set(items.map((i) => +i.santri_id)).size < penghuni.size) gagal(400, "Semua penghuni kamar harus diberi status.");
  await db.prepare("INSERT INTO absensi_sesi (jenis, tanggal, sesi_pilihan_id, target_id, lingkungan, diisi_oleh) VALUES ('harian',?,?,?,?,?) ON CONFLICT (jenis, tanggal, sesi_pilihan_id, target_id) DO UPDATE SET diisi_oleh = excluded.diisi_oleh, diisi_at = datetime('now')")
    .bind(tanggal, sesiId, kamarId, km.lingkungan, u.id).run();
  const sesi = await db.prepare("SELECT id FROM absensi_sesi WHERE jenis = 'harian' AND tanggal = ? AND sesi_pilihan_id = ? AND target_id = ?").bind(tanggal, sesiId, kamarId).first();
  const oto = await statusOtomatis(db, [...penghuni], tanggal);
  const st = items.map((i) => {
    const o = oto[+i.santri_id];
    const v = o || { status_kehadiran_id: +i.status_kehadiran_id, sumber: "manual", izin_id: null, keterangan: bersih(i.keterangan, 120) };
    return db.prepare(`INSERT INTO absensi (sesi_id, santri_id, status_kehadiran_id, sumber, izin_id, kunjungan_id, keterangan, lingkungan) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT (sesi_id, santri_id) DO UPDATE SET status_kehadiran_id = excluded.status_kehadiran_id, sumber = excluded.sumber, izin_id = excluded.izin_id, kunjungan_id = excluded.kunjungan_id, keterangan = excluded.keterangan`)
      .bind(sesi.id, +i.santri_id, v.status_kehadiran_id, v.sumber, v.izin_id, v.kunjungan_id || null, v.keterangan, km.lingkungan);
  });
  await db.batch(st);
  await catat(db, u, "kesantrian", "absensi", "absensi_sesi", sesi.id, `${km.nama} ${tanggal}: ${items.length} santri`, km.lingkungan);
  return json({ ok: true });
});

// Rekap absensi per tanggal (untuk melihat kamar mana yang belum diisi).
on("GET", "/api/absensi/rekap", async ({ db, u, url }) => {
  wajib(u, "absensi");
  const tanggal = url.searchParams.get("tanggal") || hariIni();
  const l = lingIn(u, "k.lingkungan");
  const r = await db.prepare(
    `SELECT k.id, k.nama, k.lingkungan, (SELECT COUNT(*) FROM santri s WHERE s.kamar_id = k.id AND s.status IN ('aktif','skorsing')) penghuni,
            (SELECT COUNT(*) FROM absensi_sesi a WHERE a.target_id = k.id AND a.jenis = 'harian' AND a.tanggal = ?) sesi_terisi
     FROM kamar k WHERE k.aktif = 1 AND ${l.sql} ORDER BY k.nama`).bind(tanggal, ...l.args).all();
  return json(r.results);
});

// ---------------------------------------------------------------- riwayat perubahan
on("GET", "/api/riwayat", async ({ db, u, url }) => {
  wajib(u, "riwayat");
  const kat = url.searchParams.get("kategori");
  const w = [], a = [];
  if (u.role !== "moderator") {
    w.push(`(r.lingkungan = 'semua' OR r.lingkungan IN (${u.ling.map(() => "?").join(",")}))`); a.push(...u.ling); w.push("r.kategori NOT IN ('akun','akses','pengaturan')");
    // Sekretaris hanya melihat riwayat masa jabatannya sendiri (README Riwayat Perubahan)
    w.push("r.masa_khidmat_id = (SELECT id FROM masa_khidmat WHERE status = 'aktif')");
  }
  if (url.searchParams.get("masa_khidmat_id")) { w.push("r.masa_khidmat_id = ?"); a.push(+url.searchParams.get("masa_khidmat_id")); }
  if (kat) { w.push("r.kategori = ?"); a.push(kat); }
  const r = await db.prepare(`SELECT r.*, u.nama oleh FROM riwayat_perubahan r LEFT JOIN users u ON u.id = r.user_id ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY r.id DESC LIMIT 300`).bind(...a).all();
  return json(r.results);
});

// ---------------------------------------------------------------- modul Tahap 2 & 3 (src/modul/*.js)
// Setiap modul: export default function (H) { H.on(...); H.migrasi([...]); H.berkala(nama, fn); }
import modul from "./modul/index.js";
const H = {
  on, json, gagal, Galat, wib, hariIni, keMs, bersih, normalHp, randomHex, sha256, hashPassword, cekPassword, passwordSementara, batasIp, catatGagalIp, cekTurnstile,
  pengaturan, boleh, wajib, wajibModerator, adaAkses, wajibAdaAkses, lingIn, cekLing, catat, stmtCatat, tanda, cekSandi, taAktif, masaKhidmatAktif,
  TUTUP_STATUS, stmtUbahStatus, pindahRiwayat, bacaKelas, statusOtomatis, perbaruiOverdue, keadaanIzin, buatSesi,
  stmtNotif, stmtNotifGuru, GURU_BINAAN, stmtTerapkanPreset, cariPreset,
  antreEmail, stmtEmail, kabarWali, kabarKoreksi, kirimAntrean, tugasBerkala, APP: () => APP(ENV), env: () => ENV,
  migrasi: (list) => MIGRASI_MODUL.push(...list),
  berkala: (nama, fn) => TUGAS_BERKALA.push({ nama, fn }),
  // Modul yang menulis langsung ke email_antrean (INSERT … SELECT massal) memanggil ini agar email dikirim langsung.
  emailBaru: () => { EMAIL_DIBUAT++; },
};
for (const m of modul) m(H);
