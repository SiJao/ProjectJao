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
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

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
const passwordSementara = (nis, tgl) => (tgl ? nis + tgl.slice(8, 10) + tgl.slice(5, 7) + tgl.slice(0, 4) : null);

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

async function buatSesi(db, userId) {
  const token = randomHex(32);
  const jam = +(await pengaturan(db, "sesi.lama_jam", "12"));
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
    `SELECT u.* FROM sesi_login s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.kedaluwarsa > ? AND u.status = 'aktif'`
  ).bind(await sha256(token), new Date().toISOString()).first();
  if (!u) return null;
  const ak = await db.prepare("SELECT akses_kode FROM user_akses WHERE user_id = ?").bind(u.id).all();
  u.akses = ak.results.map((r) => r.akses_kode);
  u.ling = u.lingkungan === "semua" ? ["putra", "putri"] : [u.lingkungan];
  return u;
}

// Akses bawaan role (Peta Akses README, K-55, K-63, K-75, K-86): sisanya lewat Manajemen Akses.
// "lihat_X" otomatis dimiliki siapa pun yang punya X.
const AKSES_ROLE = {
  piket: ["absensi"],
  sekretaris: ["absensi", "kegiatan", "prestasi", "rapor", "tata_warkat", "pengumuman", "isi_pengurus", "riwayat"],
  asatidz: ["lihat_absensi", "lihat_perizinan", "lihat_vonis", "lihat_prestasi", "lihat_rapor"],
};
const KEMAMPUAN = ["absensi", "lihat_absensi", "perizinan", "lihat_perizinan", "kesehatan", "pemeriksaan", "profil_kesehatan",
  "input_pelanggaran", "putusan_kedisiplinan", "lihat_vonis", "kegiatan", "prestasi", "lihat_prestasi", "rapor", "lihat_rapor",
  "tata_warkat", "pengumuman", "isi_pengurus", "update_kamar", "paw", "riwayat"];
const boleh = (u, kode) => u.role === "moderator" || u.akses.includes(kode) || (AKSES_ROLE[u.role] || []).includes(kode)
  || (kode.startsWith("lihat_") && boleh(u, kode.slice(6)));
const wajib = (u, kode) => { if (!boleh(u, kode)) gagal(403, "Anda tidak punya akses untuk tindakan ini."); };
const wajibModerator = (u) => { if (u.role !== "moderator") gagal(403, "Hanya Moderator."); };
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
const stmtEmail = (db, e) => db.prepare(
  "INSERT INTO email_antrean (penerima, subjek, isi, jenis, tabel_terkait, id_terkait, akun_wali_id, koreksi_dari_id, lingkungan) VALUES (?,?,?,?,?,?,?,?,?)")
  .bind(e.penerima, e.subjek.slice(0, 200), e.isi, e.jenis, e.tabel || null, e.id || null, e.akun_wali_id || null, e.koreksi_dari_id || null, e.lingkungan || "semua");
async function antreEmail(db, e) { await stmtEmail(db, e).run(); }

// Kabar per kejadian ke semua wali yang tertaut aktif ke santri (K-76). Mengembalikan jumlah email.
async function kabarWali(db, santriId, { subjek, isi, tabel, id }) {
  const s = await db.prepare("SELECT id, nama, lingkungan FROM santri WHERE id = ?").bind(santriId).first();
  if (!s) return 0;
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
async function kabarKoreksi(db, tabel, id, isi) {
  const lama = (await db.prepare("SELECT * FROM email_antrean WHERE tabel_terkait = ? AND id_terkait = ? AND koreksi_dari_id IS NULL AND jenis = 'wali'").bind(tabel, id).all()).results;
  if (!lama.length) return 0;
  await db.batch(lama.map((e) => stmtEmail(db, {
    penerima: e.penerima, subjek: "[HISADA] Ralat: " + e.subjek.replace(/^\[HISADA\] /, ""), isi: `Assalamu'alaikum,\n\nRalat atas kabar sebelumnya: ${isi}\n\nMohon maaf atas kekeliruan ini.\n\n— HISADA`,
    jenis: "wali", tabel, id, akun_wali_id: e.akun_wali_id, koreksi_dari_id: e.id, lingkungan: e.lingkungan,
  })));
  return lama.length;
}

const b64 = (s) => btoa(String.fromCharCode(...enc.encode(s)));
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
async function kirimAntrean(env, db, batas = 25) {
  const daftar = (await db.prepare("SELECT * FROM email_antrean WHERE status = 'antre' ORDER BY id LIMIT ?").bind(batas).all()).results;
  if (!daftar.length) return { terkirim: 0, gagal: 0, sisa: 0 };
  if (!env.GMAIL_REFRESH_TOKEN || !env.GMAIL_PENGIRIM || !env.GOOGLE_CLIENT_SECRET) {
    await db.prepare("UPDATE email_antrean SET galat = 'Pengirim email belum diatur (GMAIL_REFRESH_TOKEN / GMAIL_PENGIRIM)' WHERE status = 'antre' AND galat IS NULL").run();
    return { terkirim: 0, gagal: 0, sisa: daftar.length, belum_diatur: true };
  }
  const ujiAktif = (await pengaturan(db, "email.mode_uji", "1")) === "1";
  const alamatUji = (await pengaturan(db, "email.alamat_uji", "")).trim();
  const namaPengirim = await pengaturan(db, "email.nama_pengirim", "HISADA");
  if (ujiAktif && !alamatUji) {
    await db.prepare("UPDATE email_antrean SET galat = 'Mode Uji aktif tetapi email.alamat_uji kosong' WHERE status = 'antre'").run();
    return { terkirim: 0, gagal: 0, sisa: daftar.length };
  }
  const token = await tokenGmail(env);
  let terkirim = 0, gagalN = 0;
  for (const e of daftar) {
    const ke = ujiAktif ? alamatUji : e.penerima;
    const isi = ujiAktif ? `[MODE UJI — seharusnya untuk: ${e.penerima}]\n\n${e.isi}` : e.isi;
    const mime = [`From: =?UTF-8?B?${b64(namaPengirim)}?= <${env.GMAIL_PENGIRIM}>`, `To: ${ke}`, `Subject: =?UTF-8?B?${b64(e.subjek)}?=`,
      "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(isi)].join("\r\n");
    try {
      const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify({ raw: b64url(mime) }),
      });
      if (!r.ok) throw new Error("Gmail " + r.status + " " + (await r.text()).slice(0, 160));
      await db.prepare("UPDATE email_antrean SET status = 'terkirim', dikirim_at = ?, percobaan = percobaan + 1, galat = NULL WHERE id = ?").bind(wib(), e.id).run();
      terkirim++;
    } catch (err) {
      await db.prepare("UPDATE email_antrean SET percobaan = percobaan + 1, galat = ?, status = CASE WHEN percobaan + 1 >= 5 THEN 'gagal' ELSE 'antre' END WHERE id = ?").bind(String(err.message).slice(0, 300), e.id).run();
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
  const hasil = { overdue: await perbaruiOverdue(env.DB) };
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
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    ENV = env;
    try {
      await migrate(env.DB);
      if (req.method !== "GET") {
        // Lapisan CSRF: permintaan pengubah wajib JSON dari halaman sendiri.
        const ct = req.headers.get("content-type") || "";
        const origin = req.headers.get("origin");
        if (!ct.includes("application/json")) gagal(415, "Format permintaan tidak dikenal.");
        if (origin && origin !== url.origin) gagal(403, "Asal permintaan tidak diizinkan.");
      }
      for (const r of rute) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        const ctx = { req, env, db: env.DB, url, p: m.groups || {} };
        ctx.body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
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
  },
};

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

on("POST", "/api/login", async ({ db, body }) => {
  if ((await pengaturan(db, "login.password_aktif", "1")) !== "1") gagal(403, "Login password dinonaktifkan. Gunakan akun Google.");
  const email = String(body.email || "").trim().toLowerCase();
  const u = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  const salah = () => gagal(401, "Email atau password salah.");
  if (!u) { await cekPassword("x", "pbkdf2$100000$00$00"); salah(); }
  if (u.terkunci_sampai && u.terkunci_sampai > wib()) gagal(429, "Terlalu banyak percobaan. Coba lagi nanti.");
  if (u.status === "tertahan") gagal(403, "Akun tertahan: tanggal lahir santri belum diisi.");
  if (u.status !== "aktif") gagal(403, "Akun nonaktif.");
  if (!(await cekPassword(String(body.password || ""), u.password_hash))) {
    const batas = +(await pengaturan(db, "login.batas_gagal", "5"));
    const menit = +(await pengaturan(db, "login.lama_kunci_menit", "15"));
    const gagalBaru = u.gagal_login + 1;
    await db.prepare("UPDATE users SET gagal_login = ?, terkunci_sampai = ? WHERE id = ?")
      .bind(gagalBaru >= batas ? 0 : gagalBaru, gagalBaru >= batas ? wib(Date.now() + menit * 60e3) : null, u.id).run();
    salah();
  }
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
on("GET", "/api/me", async ({ u }) => json({
  id: u.id, nama: u.nama, email: u.email, role: u.role, lingkungan: u.lingkungan, akses: u.akses,
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
    h["/pengguna"] = (await db.prepare("SELECT COUNT(*) n FROM users WHERE role IS NULL AND status = 'aktif'").first()).n;
    h["/komunikasi"] = (await db.prepare("SELECT COUNT(*) n FROM email_antrean WHERE status = 'gagal'").first()).n;
  }
  return json(h);
});

on("POST", "/api/ganti-password", async ({ db, u, body }) => {
  const baru = String(body.baru || "");
  if (baru.length < 8) gagal(400, "Password baru minimal 8 karakter.");
  if (u.password_hash && !(await cekPassword(String(body.lama || ""), u.password_hash))) gagal(400, "Password lama salah.");
  await db.prepare("UPDATE users SET password_hash = ?, wajib_ganti_password = 0 WHERE id = ?").bind(await hashPassword(baru), u.id).run();
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
    guru: await q("SELECT * FROM guru ORDER BY nama"),
    status_kehadiran: await q("SELECT * FROM status_kehadiran ORDER BY urutan"),
    jenis_izin: await q("SELECT * FROM jenis_izin ORDER BY urutan"),
    pilihan: await q(`SELECT * FROM pilihan WHERE lingkungan = 'semua' OR ${l.sql} ORDER BY kelompok, urutan, nama`, ...l.args),
    pengaturan: u.role === "moderator" ? await q("SELECT * FROM pengaturan ORDER BY kunci") : [],
  });
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
  const ling = ["putra", "putri", "semua"].includes(body.lingkungan) ? body.lingkungan : "semua";
  if (body.id) {
    await db.prepare("UPDATE pilihan SET nama = COALESCE(?, nama), urutan = COALESCE(?, urutan), aktif = COALESCE(?, aktif), lingkungan = ? WHERE id = ? AND kelompok = ?")
      .bind(nama, body.urutan ?? null, body.aktif ?? null, ling, body.id, kelompok).run();
    await catat(db, u, "pilihan", "ubah", "pilihan", body.id, `${kelompok}: ${nama || ""} aktif=${body.aktif ?? "-"}`);
    return json({ ok: true, id: body.id });
  }
  if (!nama) gagal(400, "Nama pilihan wajib diisi.");
  const urut = await db.prepare("SELECT COALESCE(MAX(urutan),0)+1 n FROM pilihan WHERE kelompok = ?").bind(kelompok).first();
  const r = await db.prepare("INSERT INTO pilihan (kelompok, nama, urutan, lingkungan) VALUES (?,?,?,?)").bind(kelompok, nama, urut.n, ling).run();
  await catat(db, u, "pilihan", "tambah", "pilihan", r.meta.last_row_id, `${kelompok}: ${nama}`);
  return json({ ok: true, id: r.meta.last_row_id });
});

// ---------------------------------------------------------------- santri
on("GET", "/api/santri", async ({ db, u, url }) => {
  const l = lingIn(u, "s.lingkungan");
  const w = [l.sql], a = [...l.args];
  const q = (url.searchParams.get("q") || "").trim();
  if (q) { w.push("(s.nama LIKE ? OR s.nis LIKE ?)"); a.push(`%${q}%`, `${q}%`); }
  for (const k of ["kamar_id", "kelas_id"]) if (url.searchParams.get(k)) { w.push(`s.${k} = ?`); a.push(+url.searchParams.get(k)); }
  const st = url.searchParams.get("status") || "aktif";
  if (st !== "semua") { w.push("s.status = ?"); a.push(st); }
  const lim = Math.min(+url.searchParams.get("limit") || 50, 2000);
  const r = await db.prepare(
    `SELECT s.id, s.nis, s.nama, s.jenis_kelamin, s.lingkungan, s.status, s.tanggal_lahir, s.tempat_lahir, s.kabupaten, s.provinsi,
            s.kelas_id, s.kamar_id, s.foto_url, km.nama kamar, (k.tingkat || ' ' || k.rombel || ' ' || j.nama || COALESCE(' ' || k.label, '')) kelas
     FROM santri s LEFT JOIN kamar km ON km.id = s.kamar_id LEFT JOIN kelas k ON k.id = s.kelas_id LEFT JOIN jenjang j ON j.id = k.jenjang_id
     WHERE ${w.join(" AND ")} ORDER BY s.nama LIMIT ?`).bind(...a, lim).all();
  return json(r.results);
});

on("GET", "/api/santri/:id", async ({ db, u, p }) => {
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
    `SELECT u.id, u.email, u.nama, u.role, u.lingkungan, u.status, u.login_terakhir, u.santri_id, u.guru_id,
            (u.password_hash IS NOT NULL) punya_password, s.nis, g.nip,
            (SELECT GROUP_CONCAT(akses_kode) FROM user_akses ua WHERE ua.user_id = u.id) akses
     FROM users u LEFT JOIN santri s ON s.id = u.santri_id LEFT JOIN guru g ON g.id = u.guru_id ORDER BY u.role IS NULL DESC, u.nama`).all();
  const ak = await db.prepare("SELECT * FROM akses ORDER BY kode").all();
  return json({ users: r.results.map((x) => ({ ...x, akses: x.akses ? x.akses.split(",") : [] })), akses: ak.results });
});

on("POST", "/api/users/dari-santri", async ({ db, u, body }) => {
  wajibModerator(u);
  const s = await db.prepare("SELECT * FROM santri WHERE id = ?").bind(body.santri_id).first();
  if (!s || s.status !== "aktif") gagal(400, "Santri tidak ditemukan atau tidak aktif.");
  const pw = passwordSementara(s.nis, s.tanggal_lahir);
  const r = await db.prepare("INSERT INTO users (email, password_hash, nama, role, santri_id, lingkungan, status, wajib_ganti_password) VALUES (?,?,?,?,?,?,?,1)")
    .bind(`${s.nis}@daarululuumlido.com`, pw ? await hashPassword(pw) : null, s.nama, body.role || null, s.id, s.lingkungan, pw ? "aktif" : "tertahan").run();
  await catat(db, u, "akun", "buat", "users", r.meta.last_row_id, `Akun pengurus ${s.nis}${pw ? "" : " (tertahan: tanggal lahir kosong)"}`, s.lingkungan);
  return json({ ok: true, id: r.meta.last_row_id, tertahan: !pw });
});

on("POST", "/api/users/guru", async ({ db, u, body }) => {
  wajibModerator(u);
  const g = await db.prepare("SELECT * FROM guru WHERE id = ?").bind(body.guru_id).first();
  if (!g) gagal(400, "Guru tidak ditemukan.");
  const email = bersih(body.email || g.email, 120)?.toLowerCase();
  if (!email) gagal(400, "Email guru wajib diisi.");
  const r = await db.prepare("INSERT INTO users (email, nama, role, guru_id, lingkungan, wajib_ganti_password) VALUES (?,?,?,?,?,0)")
    .bind(email, g.nama, "asatidz", g.id, g.lingkungan).run();
  await catat(db, u, "akun", "buat", "users", r.meta.last_row_id, `Akun guru ${g.nip} (login dengan Google)`);
  return json({ ok: true, id: r.meta.last_row_id });
});

on("POST", "/api/users/moderator", async ({ db, u, body }) => {
  wajibModerator(u);
  const email = bersih(body.email, 120)?.toLowerCase();
  if (!email || !body.nama) gagal(400, "Nama dan email wajib diisi.");
  const r = await db.prepare("INSERT INTO users (email, nama, role, lingkungan, wajib_ganti_password) VALUES (?,?, 'moderator', 'semua', 0)").bind(email, bersih(body.nama, 120)).run();
  await catat(db, u, "akun", "buat", "users", r.meta.last_row_id, `Moderator baru ${email} (login dengan Google)`);
  return json({ ok: true, id: r.meta.last_row_id });
});

on("POST", "/api/users/:id", async ({ db, u, p, body }) => {
  wajibModerator(u);
  const t = await db.prepare("SELECT * FROM users WHERE id = ?").bind(p.id).first();
  if (!t) gagal(404, "Akun tidak ditemukan.");
  const role = "role" in body ? (body.role || null) : t.role;
  if (role === "moderator" && t.santri_id) gagal(400, "Role Moderator tidak boleh untuk akun santri (K-11).");
  if (role === "asatidz" && !t.guru_id) gagal(400, "Role Asatidz hanya untuk akun guru.");
  if (["piket", "kesehatan", "kedisiplinan", "sekretaris"].includes(role) && !t.santri_id) gagal(400, "Role pengurus hanya untuk akun santri.");
  const status = body.status && ["aktif", "nonaktif"].includes(body.status) ? body.status : t.status;
  if (t.id === u.id && (status !== "aktif" || role !== "moderator")) gagal(400, "Anda tidak bisa menonaktifkan atau menurunkan akun sendiri.");
  const ling = t.guru_id && body.lingkungan ? body.lingkungan : t.lingkungan;
  await db.prepare("UPDATE users SET role = ?, status = ?, lingkungan = ? WHERE id = ?").bind(role, status, ling, t.id).run();
  if (status !== "aktif") await db.prepare("DELETE FROM sesi_login WHERE user_id = ?").bind(t.id).run();
  await catat(db, u, "akses", "ubah_akun", "users", t.id, `${t.email}: role=${role} status=${status} lingkungan=${ling}`);
  return json({ ok: true });
});

on("POST", "/api/users/:id/akses", async ({ db, u, p, body }) => {
  wajibModerator(u);
  const kode = String(body.kode || "");
  if (!(await db.prepare("SELECT kode FROM akses WHERE kode = ?").bind(kode).first())) gagal(400, "Jenis akses tidak dikenal.");
  if (body.beri) await db.prepare("INSERT OR IGNORE INTO user_akses (user_id, akses_kode, diberikan_oleh) VALUES (?,?,?)").bind(p.id, kode, u.id).run();
  else await db.prepare("DELETE FROM user_akses WHERE user_id = ? AND akses_kode = ?").bind(p.id, kode).run();
  await catat(db, u, "akses", body.beri ? "beri" : "cabut", "user_akses", +p.id, kode);
  return json({ ok: true });
});

on("POST", "/api/users/:id/reset-password", async ({ db, u, p }) => {
  wajibModerator(u);
  const t = await db.prepare("SELECT u.*, s.nis, s.tanggal_lahir FROM users u LEFT JOIN santri s ON s.id = u.santri_id WHERE u.id = ?").bind(p.id).first();
  if (!t) gagal(404, "Akun tidak ditemukan.");
  const pw = t.nis ? passwordSementara(t.nis, t.tanggal_lahir) : randomHex(5);
  if (!pw) gagal(400, "Tanggal lahir santri belum diisi.");
  await db.batch([
    db.prepare("UPDATE users SET password_hash = ?, wajib_ganti_password = 1, gagal_login = 0, terkunci_sampai = NULL, status = CASE WHEN status = 'tertahan' THEN 'aktif' ELSE status END WHERE id = ?").bind(await hashPassword(pw), t.id),
    db.prepare("DELETE FROM sesi_login WHERE user_id = ?").bind(t.id),
  ]);
  await catat(db, u, "akun", "reset_password", "users", t.id, t.email);
  return json({ ok: true, password_sementara: t.nis ? "NIS + tanggal lahir (ddmmyyyy)" : pw });
});

// ---------------------------------------------------------------- perizinan
// Lewat masa tenggang → overdue: pelanggaran otomatis kategori Keamanan + kabar ke wali (README Perizinan).
async function perbaruiOverdue(db) {
  const tenggang = +(await pengaturan(db, "overdue.masa_tenggang_menit", "60"));
  const batas = wib(Date.now() - tenggang * 60e3);
  const baru = (await db.prepare(
    `SELECT z.id, z.santri_id, z.lingkungan, z.rencana_kembali, ji.nama jenis FROM izin z JOIN jenis_izin ji ON ji.id = z.jenis_izin_id
     WHERE z.status = 'berjalan' AND z.rencana_kembali < ? LIMIT 200`).bind(batas).all()).results;
  if (!baru.length) return 0;
  const katNama = await pengaturan(db, "overdue.kategori_pelanggaran", "Keamanan");
  const kat = await db.prepare("SELECT id FROM pilihan WHERE kelompok = 'kategori_pelanggaran' AND nama = ? ORDER BY lingkungan = 'semua' DESC LIMIT 1").bind(katNama).first();
  const st = [];
  for (const z of baru) {
    st.push(db.prepare("UPDATE izin SET status = 'overdue', overdue_at = ? WHERE id = ? AND status = 'berjalan'").bind(wib(), z.id));
    if (kat) st.push(db.prepare(`INSERT INTO pelanggaran (santri_id, lingkungan, kategori_id, keterangan, tanggal, sumber, izin_id)
      VALUES (?,?,?,?,?, 'overdue', ?) ON CONFLICT (izin_id) DO NOTHING`).bind(z.santri_id, z.lingkungan, kat.id, `Terlambat kembali (overdue) dari ${z.jenis}; batas kembali ${z.rencana_kembali}`, z.rencana_kembali.slice(0, 10), z.id));
    st.push(stmtCatat(db, null, "kesantrian", "izin_overdue", "izin", z.id, "Izin overdue otomatis", z.lingkungan));
  }
  await db.batch(st);
  for (const z of baru) await kabarWali(db, z.santri_id, {
    subjek: "Belum kembali ke pondok", tabel: "izin", id: z.id,
    isi: `Ananda belum kembali ke pondok setelah batas waktu izin (${z.jenis}, batas kembali ${z.rencana_kembali} WIB). Mohon segera menghubungi wali kamar / Bagian Keamanan.`,
  });
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
  const ph = santriIds.map(() => "?").join(",");
  const kodeOverdue = await pengaturan(db, "overdue.status_kode", "A");
  const kodeSkors = await pengaturan(db, "skorsing.status_kode", "P");
  const sk = Object.fromEntries((await db.prepare("SELECT id, kode FROM status_kehadiran").all()).results.map((r) => [r.kode, r.id]));
  const hasil = {};
  const izin = await db.prepare(
    `SELECT z.id, z.santri_id, z.status, z.berangkat, z.rencana_kembali, z.kembali_at, ji.status_kehadiran_id, ji.nama jenis
     FROM izin z JOIN jenis_izin ji ON ji.id = z.jenis_izin_id
     WHERE z.santri_id IN (${ph}) AND z.status <> 'dibatalkan' AND substr(z.berangkat,1,10) <= ? AND (z.kembali_at IS NULL OR substr(z.kembali_at,1,10) >= ?)`)
    .bind(...santriIds, tanggal, tanggal).all();
  for (const z of izin.results) {
    const kembaliHariIni = z.kembali_at && z.kembali_at.slice(0, 10) === tanggal;
    if (z.status === "overdue" && !kembaliHariIni) hasil[z.santri_id] = { status_kehadiran_id: sk[kodeOverdue], sumber: "overdue", izin_id: z.id, keterangan: "Overdue: " + z.jenis };
    else if (!kembaliHariIni) hasil[z.santri_id] = { status_kehadiran_id: z.status_kehadiran_id, sumber: "perizinan", izin_id: z.id, keterangan: z.jenis };
  }
  // Perawatan kesehatan → Sakit selama belum ditandai selesai dirawat (prioritas di bawah perizinan).
  const rawat = await db.prepare(
    `SELECT k.id, k.santri_id, jk.status_kehadiran_id, jk.nama FROM kunjungan_kesehatan k JOIN jenis_kunjungan jk ON jk.id = k.jenis_kunjungan_id
     WHERE k.santri_id IN (${ph}) AND k.status = 'aktif' AND jk.status_kehadiran_id IS NOT NULL
       AND substr(k.waktu,1,10) <= ? AND (k.selesai_rawat_at IS NULL OR substr(k.selesai_rawat_at,1,10) >= ?)`).bind(...santriIds, tanggal, tanggal).all();
  for (const k of rawat.results) if (!hasil[k.santri_id]) hasil[k.santri_id] = { status_kehadiran_id: k.status_kehadiran_id, sumber: "kesehatan", izin_id: null, kunjungan_id: k.id, keterangan: k.nama };
  // Skorsing (status santri, atau skorsing bertanggal yang mencakup tanggal ini) mengalahkan semuanya.
  const skors = await db.prepare(
    `SELECT id FROM santri WHERE id IN (${ph}) AND status = 'skorsing'
     UNION SELECT santri_id FROM skorsing WHERE santri_id IN (${ph}) AND status <> 'dibatalkan' AND mulai <= ? AND selesai >= ?`).bind(...santriIds, ...santriIds, tanggal, tanggal).all();
  for (const s of skors.results) hasil[s.id] = { status_kehadiran_id: sk[kodeSkors], sumber: "skorsing", izin_id: null, keterangan: "Skorsing" };
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
  if (items.length < penghuni.size) gagal(400, "Semua penghuni kamar harus diberi status.");
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
  on, json, gagal, Galat, wib, hariIni, keMs, bersih, normalHp, randomHex, sha256, hashPassword, cekPassword, passwordSementara,
  pengaturan, boleh, wajib, wajibModerator, lingIn, cekLing, catat, stmtCatat, tanda, cekSandi, taAktif, masaKhidmatAktif,
  TUTUP_STATUS, stmtUbahStatus, pindahRiwayat, bacaKelas, statusOtomatis, perbaruiOverdue, keadaanIzin, buatSesi,
  antreEmail, stmtEmail, kabarWali, kabarKoreksi, kirimAntrean, tugasBerkala, APP: () => APP(ENV), env: () => ENV,
  migrasi: (list) => MIGRASI_MODUL.push(...list),
  berkala: (nama, fn) => TUGAS_BERKALA.push({ nama, fn }),
};
for (const m of modul) m(H);
