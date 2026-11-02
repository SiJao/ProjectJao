// HISADA — aplikasi web (Vue 3 tanpa build tool). Berbicara dengan /api/* di worker.
const { createApp, reactive, ref, computed, onMounted, watch, nextTick } = Vue;

// ---------------------------------------------------------------- API & state global
const negara = reactive({ me: null, status: null, master: null, rute: "", galat: "", fotoBesar: null });

async function api(path, data) {
  const opsi = data === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) };
  const r = await fetch("/api" + path, { credentials: "same-origin", ...opsi });
  const isi = await r.json().catch(() => ({}));
  if (r.status === 401) { negara.me = null; pergi("/masuk"); }
  if (r.status === 428) pergi("/ganti-password");
  if (!r.ok) throw new Error(isi.galat || "Gagal (" + r.status + ")");
  return isi;
}
const pergi = (h) => { if (location.hash !== "#" + h) location.hash = h; };
async function muatMaster() { negara.master = await api("/master"); return negara.master; }
const hariIni = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
// Tanpa role: label akun = Moderator · nama preset terakhir · akses manual · belum ada akses.
const labelAkun = (me) => !me ? "" : me.role === "moderator" ? "Moderator" : me.preset || (me.akses && me.akses.length ? "Akses manual" : "Belum ada akses");
const namaKelas = (k) => k ? `${k.tingkat} ${k.rombel} ${k.jenjang || ""}${k.label ? " " + k.label : ""}`.trim() : "";

// ---------------------------------------------------------------- animasi (anime.js) — mati bila "kurangi gerakan" aktif di perangkat
const A = window.anime;
const GERAK = !!A && !matchMedia("(prefers-reduced-motion: reduce)").matches;
const gerak = {
  // isi halaman muncul berurutan dari bawah
  masuk(el) {
    if (!GERAK || !el) return;
    A.animate([...el.children].slice(0, 14), { opacity: [0, 1], y: [16, 0], duration: 650, delay: A.stagger(55), ease: "outExpo" });
  },
  // baris tabel baru muncul berurutan (dibatasi 20 baris agar ringan)
  baris(el) {
    const n = el.children.length;
    if (el._n === n) return;
    el._n = n;
    if (GERAK && n) A.animate([...el.children].slice(0, 20), { opacity: [0, 1], x: [-10, 0], duration: 420, delay: A.stagger(22), ease: "outQuad" });
  },
  hitung(el, nilai) {
    const n = +nilai || 0;
    if (!GERAK) { el.textContent = n; return; }
    const o = { v: +el.textContent || 0 };
    A.animate(o, { v: n, duration: 1100, ease: "outExpo", onUpdate: () => { el.textContent = Math.round(o.v); } });
  },
};
const vHitung = { mounted: (el, b) => gerak.hitung(el, b.value), updated: (el, b) => { if (b.value !== b.oldValue) gerak.hitung(el, b.value); } };
const vBaris = { mounted: (el) => gerak.baris(el), updated: (el) => gerak.baris(el) };

// ---------------------------------------------------------------- foto santri
// Link tersimpan = ukuran besar (h_2048). Di daftar dipakai versi kecil dari CDN yang sama; gagal → ukuran besar → inisial.
const UKURAN_BESAR = /\/h_2048(?=[,/])/;
const fotoKecil = (url, h) => url && UKURAN_BESAR.test(url) ? url.replace(UKURAN_BESAR, "/h_" + h) : url;
const inisial = (nama) => String(nama || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const FotoSantri = {
  props: { s: Object, ukuran: { type: String, default: "" } },
  setup(props) {
    const tahap = ref(0);
    watch(() => props.s && props.s.foto_url, () => { tahap.value = 0; });
    const src = computed(() => {
      const u = props.s && props.s.foto_url;
      if (!u || tahap.value > 1) return "";
      if (props.ukuran === "besar" || tahap.value === 1) return u;
      return fotoKecil(u, props.ukuran === "kecil" ? 96 : 128);
    });
    const perbesar = () => { if (props.s && props.s.foto_url) negara.fotoBesar = { url: props.s.foto_url, nama: props.s.nama }; };
    return { tahap, src, perbesar, inisial };
  },
  template: `<img v-if="src" :src="src" :alt="'Foto ' + s.nama" class="foto" :class="ukuran" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="tahap++" @click="perbesar" style="cursor:zoom-in">
    <span v-else class="foto inisial" :class="ukuran" aria-hidden="true">{{ inisial(s && s.nama) }}</span>`,
};

// ikon menu (garis sederhana)
const IKON = {
  "/": '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  "/data-master": '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  "/absensi": '<path d="M9 11l2 2 4-4"/><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 17h8"/>',
  "/perizinan": '<path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>',
  "/pengguna": '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.8c1.8.8 3 2.6 3.5 5.2"/>',
  "/riwayat": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};

// ---------------------------------------------------------------- berkas: CSV & Excel (dibuat di browser)
function parseCsv(t) {
  const R = []; let r = [], v = "", q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { v += '"'; i++; } else q = false; } else v += c; }
    else if (c === '"') q = true; else if (c === ",") { r.push(v); v = ""; } else if (c === "\n") { r.push(v.replace(/\r$/, "")); R.push(r); r = []; v = ""; } else v += c; }
  if (v || r.length) { r.push(v); R.push(r); } return R;
}
// Baca CSV → { kolom: [...HURUF BESAR], baris: [{KOLOM: nilai, _baris: n}] } dengan baris judul = baris pertama yang memuat semua `wajib`.
async function bacaCsv(file, wajib = []) {
  const rows = parseCsv((await file.text()).replace(/^﻿/, ""));
  const h = rows.findIndex((r) => wajib.every((w) => r.map((x) => x.trim().toUpperCase()).includes(w.toUpperCase())));
  if (h < 0) throw new Error("Kolom " + wajib.join(", ") + " tidak ditemukan di file.");
  const kolom = rows[h].map((x) => x.trim().toUpperCase());
  const baris = rows.slice(h + 1).filter((r) => r.some((x) => x.trim())).map((r, i) => {
    const o = { _baris: h + i + 2 };
    kolom.forEach((k, j) => { if (k) o[k] = (r[j] || "").trim(); });
    return o;
  });
  return { kolom, baris };
}
function unduhBerkas(nama, isi, tipe) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(isi instanceof Blob ? isi : new Blob([isi], { type: tipe }));
  a.download = nama; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
// Sel diawali = + - @ (bukan angka biasa) dinetralkan dengan petik agar tidak dijalankan sebagai rumus saat dibuka di Excel.
const selCsv = (v) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+([.,]\d+)?$/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const unduhCsv = (nama, baris) => unduhBerkas(nama, "﻿" + baris.map((r) => r.map(selCsv).join(",")).join("\r\n"), "text/csv;charset=utf-8");

// .xlsx asli tanpa pustaka (README Export Excel): zip "stored" + CRC32, sel teks inline, angka sebagai angka.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(berkas) {
  const te = new TextEncoder(), bagian = [], pusat = []; let ofs = 0;
  for (const [nama, teks] of berkas) {
    const n = te.encode(nama), d = te.encode(teks), c = crc32(d);
    const h = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, c, 4], [18, d.length, 4], [22, d.length, 4], [26, n.length, 2], [28, 0, 2]]
      .forEach(([o, v, l]) => l === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true));
    const p = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, c, 4], [20, d.length, 4], [24, d.length, 4], [28, n.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, ofs, 4]]
      .forEach(([o, v, l]) => l === 4 ? p.setUint32(o, v, true) : p.setUint16(o, v, true));
    bagian.push(h, n, d); pusat.push(p, n); ofs += 30 + n.length + d.length;
  }
  const ukPusat = pusat.reduce((s, x) => s + x.byteLength, 0);
  const e = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [8, berkas.length, 2], [10, berkas.length, 2], [12, ukPusat, 4], [16, ofs, 4]].forEach(([o, v, l]) => l === 4 ? e.setUint32(o, v, true) : e.setUint16(o, v, true));
  return new Blob([...bagian, ...pusat, e], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
// lembar: [{ nama: "Prestasi", baris: [[judul...], [nilai...], ...] }]
function unduhXlsx(namaFile, lembar) {
  const x = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  const kol = (i) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const sheet = (baris) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${
    baris.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => v == null || v === "" ? "" : typeof v === "number" && isFinite(v)
      ? `<c r="${kol(j)}${i + 1}"${i === 0 ? ' s="1"' : ""}><v>${v}</v></c>`
      : `<c r="${kol(j)}${i + 1}" t="inlineStr"${i === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${x(v)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const ns = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
  unduhBerkas(namaFile, zip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${lembar.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ${ns}><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${lembar.map((l, i) => `<sheet name="${x(String(l.nama).replace(/[\\/?*[\]:]/g, " ").slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ${ns}>${lembar.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${lembar.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`],
    ...lembar.map((l, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheet(l.baris)]),
  ]));
}

// ---------------------------------------------------------------- komponen kecil
// Konfirmasi proses besar: peringatan + password pengguna yang sedang login (Update Kelas Tahunan, Serah Terima, PAW, …).
// Pakai: <KonfirmasiSandi v-if="tanya" :pesan="'…'" @ok="(pw) => jalankan(pw)" @batal="tanya=false"/>
const KonfirmasiSandi = {
  props: { pesan: String, judul: { type: String, default: "Konfirmasi" }, tombol: { type: String, default: "Yakin, jalankan" } },
  emits: ["ok", "batal"],
  setup(_, { emit }) {
    const pw = ref(""), el = ref(null);
    onMounted(() => el.value && el.value.focus());
    return { pw, el, kirim: () => { if (pw.value) emit("ok", pw.value); } };
  },
  template: `<div class="foto-lihat" style="cursor:default" role="dialog" aria-modal="true" :aria-label="judul" @click.self="$emit('batal')">
    <form class="kartu" style="max-width:460px;width:100%;display:flex;flex-direction:column;gap:12px" @submit.prevent="kirim">
      <h2>{{ judul }}</h2>
      <div class="pesan galat" style="white-space:pre-line">{{ pesan }}</div>
      <label class="isian">Password Anda (yang sedang login)<input ref="el" type="password" v-model="pw" autocomplete="current-password"></label>
      <div class="baris"><button :disabled="!pw" class="bahaya" style="background:var(--merah);color:#fff">{{ tombol }}</button><button type="button" class="kedua" @click="$emit('batal')">Batal</button></div>
    </form></div>`,
};

// Password sementara (acak) — tampil SEKALI setelah akun dibuat / diaktifkan lagi / direset; diserahkan langsung ke pemilik akun.
// Pakai: <SandiSementara v-if="daftar" :daftar="daftar" @tutup="daftar=null"/>   daftar: [{ nama, nis?, email?, password }]
const SandiSementara = {
  props: { daftar: Array },
  emits: ["tutup"],
  setup(p) {
    const tersalin = ref(false);
    const salin = async () => {
      try { await navigator.clipboard.writeText(p.daftar.map((x) => [x.nis, x.nama, x.password].filter(Boolean).join("\t")).join("\n")); tersalin.value = true; } catch {}
    };
    return { tersalin, salin };
  },
  template: `<div class="foto-lihat" style="cursor:default" role="dialog" aria-modal="true" aria-label="Password sementara">
    <div class="kartu" style="max-width:560px;width:100%;display:flex;flex-direction:column;gap:12px;max-height:90vh;overflow:auto">
      <h2>Password sementara</h2>
      <div class="pesan info">Password ini hanya ditampilkan <strong>sekali</strong>. Catat atau salin, lalu serahkan langsung ke pemilik akun.
        Pemilik masuk dengan email akunnya (akun santri: NIS@daarululuumlido.com). Akun pengurus wajib mengganti password saat pertama masuk; wali dapat menggantinya lewat "Lupa password".</div>
      <div class="tabel"><table><thead><tr><th>Akun</th><th>Password</th></tr></thead><tbody>
        <tr v-for="x in daftar" :key="(x.nis || x.email || '') + x.nama"><td><strong>{{ x.nama }}</strong><div class="redup">{{ x.nis ? x.nis + '@daarululuumlido.com' : x.email }}</div></td>
          <td><code style="font-size:16px;user-select:all;white-space:nowrap">{{ x.password }}</code></td></tr></tbody></table></div>
      <div class="baris"><button class="kedua" @click="salin">{{ tersalin ? 'Tersalin ✓' : 'Salin semua' }}</button><button @click="$emit('tutup')">Sudah dicatat, tutup</button></div>
    </div></div>`,
};

// Paginasi tabel: 20 baris per halaman, navigasi di bawah tabel (hanya tampil bila lebih dari 20 baris).
// Pakai: v-for="x in potong(daftar, hal.k)" lalu <Paginasi v-model="hal.k" :jumlah="daftar.length"/>
const PER_HALAMAN = 20;
const potong = (arr, h) => (arr || []).slice((h - 1) * PER_HALAMAN, h * PER_HALAMAN);
const Paginasi = {
  props: { modelValue: Number, jumlah: Number },
  emits: ["update:modelValue"],
  setup(p, { emit }) {
    const total = computed(() => Math.max(1, Math.ceil((p.jumlah || 0) / PER_HALAMAN)));
    watch(total, (t) => { if (p.modelValue > t) emit("update:modelValue", t); }); // daftar menyusut → halaman terakhir yang ada
    // nomor ringkas: 1 … 4 5 6 … 12
    const nomor = computed(() => {
      const t = total.value, h = p.modelValue, r = [];
      for (let i = 1; i <= t; i++) if (i === 1 || i === t || Math.abs(i - h) <= 1) r.push(i); else if (r[r.length - 1] !== "…") r.push("…");
      return r;
    });
    const ke = (i) => emit("update:modelValue", Math.min(Math.max(1, i), total.value));
    return { total, nomor, ke, PER_HALAMAN };
  },
  template: `<nav v-if="jumlah > PER_HALAMAN" class="paginasi" aria-label="Halaman tabel">
    <span class="redup">{{ (modelValue - 1) * PER_HALAMAN + 1 }}–{{ Math.min(modelValue * PER_HALAMAN, jumlah) }} dari {{ jumlah }}</span>
    <div class="paginasi-nomor">
      <button class="kedua kecil" :disabled="modelValue <= 1" aria-label="Halaman sebelumnya" @click="ke(modelValue - 1)">‹</button>
      <template v-for="(n, i) in nomor" :key="i"><span v-if="n === '…'" class="redup" aria-hidden="true">…</span>
        <button v-else class="kecil" :class="{ kedua: n !== modelValue }" :aria-current="n === modelValue ? 'page' : null" :aria-label="'Halaman ' + n" @click="ke(n)">{{ n }}</button></template>
      <button class="kedua kecil" :disabled="modelValue >= total" aria-label="Halaman berikutnya" @click="ke(modelValue + 1)">›</button>
    </div></nav>`,
};

const Pesan ={ props: ["galat", "ok"], template: `<div v-if="galat" class="pesan galat">{{ galat }}</div><div v-if="ok" class="pesan ok">{{ ok }}</div>` };

// ---------------------------------------------------------------- Masuk / setup
const Masuk = {
  components: { Pesan },
  setup() {
    const f = reactive({ email: "", password: "", kunci: "", nama: "", galat: "", ok: "", sibuk: false });
    const q = new URLSearchParams(location.hash.split("?")[1] || "");
    if (q.get("galat")) f.galat = q.get("galat");
    async function masuk() {
      f.sibuk = true; f.galat = "";
      try { const r = await api("/login", { email: f.email, password: f.password }); await mulai(); pergi(r.wajib_ganti_password ? "/ganti-password" : "/"); }
      catch (e) { f.galat = e.message; } finally { f.sibuk = false; }
    }
    async function setup() {
      f.sibuk = true; f.galat = "";
      try { await api("/setup", { kunci: f.kunci, nama: f.nama, email: f.email, password: f.password }); negara.status = await api("/status"); f.ok = "Moderator pertama dibuat. Silakan masuk."; }
      catch (e) { f.galat = e.message; } finally { f.sibuk = false; }
    }
    const merek = ref(null), form = ref(null);
    onMounted(() => {
      if (!GERAK) return;
      const [logo, ...teks] = merek.value.children;
      A.animate(logo, { scale: [0.6, 1], rotate: [-8, 0], opacity: [0, 1], duration: 1100, ease: A.spring({ bounce: 0.35, duration: 1000 }) });
      A.animate(teks, { opacity: [0, 1], y: [14, 0], duration: 800, delay: A.stagger(90, { start: 250 }), ease: "outExpo" });
      A.animate(form.value, { opacity: [0, 1], x: [24, 0], duration: 800, delay: 200, ease: "outExpo" });
    });
    return { f, negara, masuk, setup, merek, form };
  },
  template: `
  <div class="masuk">
  <section class="masuk-merek" ref="merek">
    <img src="/img/logo-hisada-256.png" alt="Logo HISADA" width="230" height="230">
    <h1>HISADA</h1>
    <span class="garis-emas"></span>
    <p>Sistem Administrasi Himpunan Santri<br>Pesantren Modern Daarul 'Uluum Lido</p>
  </section>
  <div class="masuk-form"><div class="kartu" ref="form">
    <template v-if="negara.status && negara.status.perlu_setup">
      <h2>Setup pertama</h2>
      <p class="redup" v-if="!negara.status.setup_tersedia">Belum ada akun. Isi variabel rahasia <code>SETUP_KEY</code> di dashboard Cloudflare untuk membuat Moderator pertama.</p>
      <template v-else>
        <label class="isian">Kunci setup<input type="password" v-model="f.kunci"></label>
        <label class="isian">Nama<input v-model="f.nama"></label>
        <label class="isian">Email<input type="email" v-model="f.email"></label>
        <label class="isian">Password (min. 10 karakter)<input type="password" v-model="f.password"></label>
        <button :disabled="f.sibuk" @click="setup">Buat Moderator</button>
      </template>
      <Pesan :galat="f.galat" :ok="f.ok"/>
    </template>
    <template v-else>
      <h2>Masuk</h2>
      <a v-if="negara.status && negara.status.google" class="tombol google" href="/api/auth/google">Masuk dengan Google</a>
      <template v-if="!negara.status || negara.status.login_password">
        <p v-if="negara.status && negara.status.google" class="redup" style="margin:0;text-align:center">atau dengan password</p>
        <form @submit.prevent="masuk" style="display:flex;flex-direction:column;gap:12px">
          <label class="isian">Email<input type="email" v-model="f.email" autocomplete="username" placeholder="NIS@daarululuumlido.com"></label>
          <label class="isian">Password<input type="password" v-model="f.password" autocomplete="current-password"></label>
          <button :disabled="f.sibuk">Masuk</button>
        </form>
        <p class="redup" style="margin:0">Akun pengurus baru: password sementara diberikan oleh Sekretaris/Moderator, wajib diganti saat login pertama.</p>
        <p class="redup" style="margin:0;text-align:center">Wali santri? Masuk lewat <a href="/wali.html">Portal Wali</a>.</p>
      </template>
      <Pesan :galat="f.galat" :ok="f.ok"/>
    </template>
  </div></div></div>`,
};

const GantiPassword = {
  components: { Pesan },
  setup() {
    const f = reactive({ lama: "", baru: "", ulang: "", galat: "", ok: "" });
    async function simpan() {
      f.galat = ""; f.ok = "";
      if (f.baru !== f.ulang) { f.galat = "Password baru dan ulangannya tidak sama."; return; }
      try { await api("/ganti-password", { lama: f.lama, baru: f.baru }); f.ok = "Password diganti."; negara.me = await api("/me"); setTimeout(() => pergi("/"), 800); }
      catch (e) { f.galat = e.message; }
    }
    return { f, simpan };
  },
  template: `<h1>Ganti password</h1>
  <div class="kartu" style="max-width:420px;display:flex;flex-direction:column;gap:12px">
    <label class="isian">Password lama<input type="password" v-model="f.lama"></label>
    <label class="isian">Password baru (min. 8)<input type="password" v-model="f.baru"></label>
    <label class="isian">Ulangi password baru<input type="password" v-model="f.ulang"></label>
    <button @click="simpan">Simpan</button><Pesan :galat="f.galat" :ok="f.ok"/>
  </div>`,
};

// ---------------------------------------------------------------- Grafik (Chart.js, disimpan lokal: /chart.umd.min.js)
// Pakai: <Grafik :cfg="{ type, data, options }" label="…"/> — cfg baru → digambar ulang. cfg tanpa fungsi (disalin JSON).
const WARNA_GRAFIK = { hijau: "#1F6B45", merah: "#8E2A22", kuning: "#C08A2E", biru: "#23497E", abu: "#9AA59E" };
if (window.Chart) Object.assign(window.Chart.defaults, { color: "#55605A", font: { ...window.Chart.defaults.font, family: "'Plus Jakarta Sans', system-ui, sans-serif" } });
const Grafik = {
  props: { cfg: Object, label: String, tinggi: { type: Number, default: 240 } },
  setup(p) {
    const el = ref(null); let ch = null;
    const gambar = () => {
      if (ch) { ch.destroy(); ch = null; }
      if (window.Chart && el.value && p.cfg) ch = new window.Chart(el.value, JSON.parse(JSON.stringify(p.cfg)));
    };
    onMounted(gambar); watch(() => p.cfg, gambar);
    Vue.onBeforeUnmount(() => { if (ch) ch.destroy(); });
    return { el };
  },
  template: `<div :style="{ position: 'relative', height: tinggi + 'px' }"><canvas ref="el" role="img" :aria-label="label"></canvas></div>`,
};
// tanggal YYYY-MM-DD dari..sampai (WIB, dari server) → daftar hari & label "dd/mm"
const daftarTanggal = (dari, sampai) => { const r = []; for (let t = Date.parse(dari + "T00:00:00Z"); t <= Date.parse(sampai + "T00:00:00Z"); t += 864e5) r.push(new Date(t).toISOString().slice(0, 10)); return r; };
const labelTgl = (t) => t.slice(8, 10) + "/" + t.slice(5, 7);
const NAMA_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
function opsiBatang(tumpuk, horizontal = false) {
  return { responsive: true, maintainAspectRatio: false, animation: GERAK ? { duration: 500 } : false, indexAxis: horizontal ? "y" : "x",
    plugins: { legend: { display: tumpuk, position: "bottom", labels: { boxWidth: 12, boxHeight: 12 } } },
    scales: { x: { stacked: tumpuk, grid: { display: horizontal }, ticks: horizontal ? { precision: 0 } : { maxRotation: 0, autoSkip: true, autoSkipPadding: 8 }, beginAtZero: true },
      y: { stacked: tumpuk, beginAtZero: true, grid: { display: !horizontal }, ticks: horizontal ? {} : { precision: 0 } } } };
}
// data mentah /ringkasan/grafik → konfigurasi Chart.js per bagian (null bila tidak ada akses / tidak ada data)
function susunGrafik(g) {
  const hari = daftarTanggal(g.dari, g.sampai), labels = hari.map(labelTgl), cfg = {};
  const perHari = (baris, cocok) => hari.map((t) => baris.filter((b) => b.tanggal === t && cocok(b)).reduce((n, b) => n + b.n, 0));
  const batang = (datasets, tumpuk = true) => datasets.some((d) => d.data.some(Boolean)) ? { type: "bar", data: { labels, datasets }, options: opsiBatang(tumpuk) } : null;
  if (g.kehadiran) {
    const st = [...new Map(g.kehadiran.map((b) => [b.kode, b])).values()].sort((a, b) => a.urutan - b.urutan);
    cfg.kehadiran = batang(st.map((s) => ({ label: s.nama, data: perHari(g.kehadiran, (b) => b.kode === s.kode), backgroundColor: s.warna, borderRadius: 2 })));
  }
  if (g.kesehatan) cfg.kesehatan = batang([
    { label: "Berobat", data: perHari(g.kesehatan, (b) => !b.rawat), backgroundColor: WARNA_GRAFIK.kuning, borderRadius: 2 },
    { label: "Dirawat", data: perHari(g.kesehatan, (b) => !!b.rawat), backgroundColor: WARNA_GRAFIK.merah, borderRadius: 2 }]);
  if (g.perizinan) cfg.perizinan = batang([
    { label: "Izin keluar", data: perHari(g.perizinan, (b) => !b.overdue), backgroundColor: WARNA_GRAFIK.biru, borderRadius: 2 },
    { label: "Sempat overdue", data: perHari(g.perizinan, (b) => !!b.overdue), backgroundColor: WARNA_GRAFIK.merah, borderRadius: 2 }]);
  if (g.kedisiplinan && g.kedisiplinan.length) cfg.kedisiplinan = { type: "bar", options: opsiBatang(false, true),
    data: { labels: g.kedisiplinan.map((b) => b.kategori), datasets: [{ label: "Pelanggaran divonis", data: g.kedisiplinan.map((b) => b.n), backgroundColor: WARNA_GRAFIK.merah, borderRadius: 3 }] } };
  if (g.prestasi) {
    const bulan = [...new Set(hari.map((t) => t.slice(0, 7)))];
    const data = bulan.map((b) => (g.prestasi.find((x) => x.bulan === b) || { n: 0 }).n);
    if (data.some(Boolean)) cfg.prestasi = { type: "bar", options: opsiBatang(false),
      data: { labels: bulan.map((b) => NAMA_BULAN[+b.slice(5, 7) - 1] + " " + b.slice(2, 4)), datasets: [{ label: "Prestasi", data, backgroundColor: WARNA_GRAFIK.hijau, borderRadius: 3, maxBarThickness: 48 }] } };
  }
  return cfg;
}

// ---------------------------------------------------------------- Dashboard
const Beranda = {
  directives: { hitung: vHitung },
  components: { Grafik },
  setup() {
    const d = ref(null), galat = ref("");
    const g = reactive({ hari: 30, data: null, cfg: {}, galat: "" });
    let nomor = 0;
    async function muatGrafik() {
      const n = ++nomor;
      try { const r = await api("/ringkasan/grafik?hari=" + g.hari); if (n === nomor) { g.data = r; g.cfg = susunGrafik(r); g.galat = ""; } }
      catch (e) { if (n === nomor) g.galat = e.message; }
    }
    onMounted(async () => { try { d.value = await api("/ringkasan"); } catch (e) { galat.value = e.message; } });
    onMounted(muatGrafik); watch(() => g.hari, muatGrafik);
    // bagian yang boleh dilihat akun ini (dikirim server sesuai akses), walau datanya kosong
    const BAGIAN = [["kehadiran", "Kehadiran harian", "Catatan absensi kamar per status"], ["kesehatan", "Kesehatan", "Kunjungan per hari (tanpa keluhan/diagnosa)"],
      ["perizinan", "Perizinan", "Izin keluar per tanggal berangkat"], ["kedisiplinan", "Kedisiplinan", "Pelanggaran yang sudah divonis, per kategori"],
      ["prestasi", "Prestasi", "Prestasi tercatat per bulan"]];
    const bagian = computed(() => g.data ? BAGIAN.filter(([k]) => k in g.data) : []);
    return { d, galat, negara, labelAkun, g, bagian };
  },
  template: `<section class="sapaan"><span class="jejak">{{ d ? d.waktu + ' WIB' : '' }}</span><h1>Assalamu'alaikum, {{ negara.me.nama }}</h1>
    <span class="jejak">{{ labelAkun(negara.me) }} · HISADA</span><img src="/img/logo-hisada-256.png" alt=""></section>
  <div v-if="galat" class="pesan galat">{{ galat }}</div>
  <div class="kisi" v-if="d">
    <div class="kartu stat"><div class="redup">Santri aktif putra</div><div class="angka" v-hitung="d.santri_putra"></div></div>
    <div class="kartu stat"><div class="redup">Santri aktif putri</div><div class="angka" v-hitung="d.santri_putri"></div></div>
    <a class="kartu stat" href="#/perizinan"><div class="redup">Izin berjalan</div><div class="angka" style="color:var(--biru)" v-hitung="d.izin_berjalan"></div><div class="redup">{{ d.izin_terlambat }} terlambat</div></a>
    <a class="kartu stat" href="#/perizinan"><div class="redup">Overdue</div><div class="angka" style="color:var(--merah)" v-hitung="d.izin_overdue"></div></a>
    <a class="kartu stat" href="#/absensi"><div class="redup">Absensi kamar hari ini</div><div class="angka"><span v-hitung="d.absensi_terisi"></span><span class="redup" style="font-size:16px"> / {{ d.kamar_aktif }}</span></div></a>
    <div class="kartu stat"><div class="redup">Sakit (30 hari)</div><div class="angka" style="color:var(--kuning)" v-hitung="d.sakit_30_hari"></div><div class="redup">{{ d.dirawat }} sedang dirawat</div></div>
    <div class="kartu stat"><div class="redup">Pulang hari ini</div><div class="angka" v-hitung="d.pulang_hari_ini"></div></div>
    <div class="kartu stat"><div class="redup">Alpha hari ini</div><div class="angka" style="color:var(--merah)" v-hitung="d.alpha_hari_ini"></div></div>
  </div>
  <section class="kartu" v-if="bagian.length" style="display:flex;flex-direction:column;gap:12px">
    <div class="baris" style="justify-content:space-between;align-items:center"><h2>Grafik {{ g.hari }} hari terakhir</h2>
      <div class="tab" role="group" aria-label="Periode grafik"><button v-for="h in [7, 30, 90]" :key="h" :class="{aktif: g.hari === h}" :aria-pressed="g.hari === h" @click="g.hari = h">{{ h }} hari</button></div></div>
    <div v-if="g.galat" class="pesan galat">{{ g.galat }}</div>
    <div class="kisi-grafik">
      <div v-for="[k, judul, ket] in bagian" :key="k" class="grafik-kotak">
        <h3>{{ judul }}</h3><p class="redup">{{ ket }}</p>
        <Grafik v-if="g.cfg[k]" :cfg="g.cfg[k]" :label="judul + ', ' + g.hari + ' hari terakhir'"/>
        <p v-else class="redup grafik-kosong">Belum ada data pada periode ini.</p>
      </div>
    </div>
  </section>
  <section class="kartu" v-if="d" style="display:flex;flex-direction:column;gap:10px">
    <div class="baris" style="justify-content:space-between;align-items:center"><h2>Agenda mendatang</h2><a href="#/tata-warkat">Kalender</a></div>
    <p v-if="!d.agenda.length" class="redup" style="margin:0">Belum ada agenda.</p>
    <div v-for="a in d.agenda" :key="a.id" style="display:flex;gap:12px;align-items:baseline;border-top:1px solid var(--garis-tipis);padding-top:8px">
      <span class="lencana hijau">{{ a.mulai === a.selesai ? a.mulai : a.mulai + ' s.d. ' + a.selesai }}</span><strong>{{ a.judul }}</strong><span class="redup">{{ a.lingkungan }}</span></div>
  </section>`,
};

// ---------------------------------------------------------------- Absensi
const Absensi = {
  components: { Pesan, FotoSantri },
  directives: { baris: vBaris },
  setup() {
    const tglTautan = (/[?&]tanggal=(\d{4}-\d{2}-\d{2})/.exec(negara.rute) || [])[1];
    const f = reactive({ asrama_id: "", kamar_id: "", tanggal: tglTautan && tglTautan <= hariIni() ? tglTautan : hariIni(), sesi_id: "", data: null, galat: "", ok: "", rekap: [] });
    let nomorMuat = 0;
    const m = computed(() => negara.master || {});
    const kamarList = computed(() => (m.value.kamar || []).filter((k) => k.aktif && (!f.asrama_id || k.asrama_id == f.asrama_id)));
    const sesiList = computed(() => (m.value.pilihan || []).filter((p) => p.kelompok === "sesi_absensi" && p.aktif));
    const statusList = computed(() => (m.value.status_kehadiran || []).filter((s) => s.aktif));
    const warna = (id) => (statusList.value.find((s) => s.id == id) || {}).warna || "#55605A";
    async function muat() {
      f.ok = ""; f.galat = ""; f.data = null;
      if (!f.kamar_id || !f.sesi_id) return;
      const n = ++nomorMuat;
      try { const d = await api(`/absensi?kamar_id=${f.kamar_id}&tanggal=${f.tanggal}&sesi_id=${f.sesi_id}`); if (n === nomorMuat) f.data = d; } catch (e) { if (n === nomorMuat) f.galat = e.message; }
    }
    async function rekap() { try { f.rekap = await api("/absensi/rekap?tanggal=" + f.tanggal); } catch (e) { f.galat = e.message; } }
    function semuaHadir() { const h = statusList.value.find((s) => s.kode === "H"); if (h) f.data.santri.forEach((s) => { if (!s.otomatis) s.status_kehadiran_id = h.id; }); }
    async function simpan() {
      f.galat = ""; f.ok = "";
      try {
        await api("/absensi", { kamar_id: +f.kamar_id, tanggal: f.tanggal, sesi_id: +f.sesi_id, items: f.data.santri.map((s) => ({ santri_id: s.id, status_kehadiran_id: s.status_kehadiran_id })) });
        f.ok = "Absensi tersimpan."; await muat(); await rekap();
      } catch (e) { f.galat = e.message; }
    }
    onMounted(async () => { await muatMaster(); if (sesiList.value[0]) f.sesi_id = sesiList.value[0].id; rekap(); });
    watch(() => [f.kamar_id, f.tanggal, f.sesi_id], muat);
    watch(() => f.tanggal, rekap);
    const belum = computed(() => f.rekap.filter((k) => k.penghuni > 0 && !k.sesi_terisi).length);
    return { f, m, kamarList, sesiList, statusList, warna, simpan, semuaHadir, belum };
  },
  template: `<div><span class="jejak">Administrasi › Kesantrian</span><h1>Absensi Harian</h1></div>
  <div class="kartu baris">
    <label class="isian">Asrama<select v-model="f.asrama_id"><option value="">Semua asrama</option><option v-for="a in m.asrama" :value="a.id">{{ a.nama }}</option></select></label>
    <label class="isian">Kamar<select v-model="f.kamar_id"><option value="">Pilih kamar…</option><option v-for="k in kamarList" :value="k.id">{{ k.nama }} ({{ k.jumlah }})</option></select></label>
    <label class="isian">Tanggal<input type="date" v-model="f.tanggal"></label>
    <label class="isian" v-if="sesiList.length > 1">Sesi<select v-model="f.sesi_id"><option v-for="s in sesiList" :value="s.id">{{ s.nama }}</option></select></label>
  </div>
  <p class="redup" v-if="f.rekap.length">{{ belum }} kamar berpenghuni belum diabsen pada tanggal ini.</p>
  <Pesan :galat="f.galat" :ok="f.ok"/>
  <template v-if="f.data">
    <div class="baris" style="justify-content:space-between"><span class="redup">{{ f.data.terisi ? 'Sudah diisi ' + f.data.diisi_at + ' — menyimpan ulang akan memperbarui.' : 'Belum diisi.' }}</span><button class="kedua" @click="semuaHadir">Tandai semua hadir</button></div>
    <div class="tabel"><table>
      <thead><tr><th>Santri</th><th>Status</th><th>Keterangan</th></tr></thead>
      <tbody v-baris><tr v-for="s in f.data.santri" :key="s.id">
        <td><div class="santri-sel"><FotoSantri :s="s"/><span><strong>{{ s.nama }}</strong><div class="redup">{{ s.nis }}</div></span></div></td>
        <td><select v-model="s.status_kehadiran_id" :disabled="!!s.otomatis" :style="{borderColor: warna(s.status_kehadiran_id), color: warna(s.status_kehadiran_id), fontWeight: 700}">
          <option :value="null" disabled>— pilih —</option><option v-for="st in statusList" :value="st.id">{{ st.nama }}</option></select></td>
        <td class="redup">{{ s.otomatis ? 'Otomatis: ' + s.keterangan : '' }}</td>
      </tr></tbody>
    </table></div>
    <p v-if="!f.data.santri.length" class="redup">Kamar ini belum berpenghuni.</p>
    <div><button @click="simpan" :disabled="!f.data.santri.length">Simpan absensi</button></div>
  </template>`,
};

// ---------------------------------------------------------------- Perizinan
// ---------------------------------------------------------------- pencarian langsung (semua form)
// Aturan: hasil muncul saat mengetik (jeda 250 ms, min. 2 huruf), maksimal 5 saran per kata kunci, dengan filter.
const MAKS_SARAN = 5;
const STATUS_SANTRI = [["aktif", "Aktif"], ["skorsing", "Skorsing"], ["alumni", "Alumni"], ["mutasi_keluar", "Mutasi keluar"], ["meninggal", "Meninggal"], ["semua", "Semua status"]];
const kueri = (o) => Object.entries(o).filter(([, v]) => v !== "" && v != null).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
// Navigasi saran dengan keyboard: ↑ ↓ pilih, Enter ambil, Esc tutup.
function navSaran(hasil, ambil) {
  const sorot = ref(-1);
  watch(hasil, () => { sorot.value = -1; });
  const tombol = (e) => {
    const n = hasil.value.length; if (!n) return;
    if (e.key === "ArrowDown") { e.preventDefault(); sorot.value = (sorot.value + 1) % n; }
    else if (e.key === "ArrowUp") { e.preventDefault(); sorot.value = (sorot.value - 1 + n) % n; }
    else if (e.key === "Enter" && sorot.value >= 0) { e.preventDefault(); ambil(hasil.value[sorot.value]); }
    else if (e.key === "Escape") hasil.value = [];
  };
  return { sorot, tombol };
}

// Filter pencarian santri yang dipakai bersama: kelas, kamar, status, lingkungan (bila pengguna melihat putra & putri), L/P.
const SaringSantri = {
  props: { modelValue: Object, jk: { type: Boolean, default: false } },
  setup(props) {
    if (!negara.master) muatMaster().catch(() => {});
    const m = computed(() => negara.master || {});
    const f = props.modelValue;
    const duaLing = computed(() => negara.me && negara.me.lingkungan === "semua");
    const kelas = computed(() => (m.value.kelas || []).filter((k) => k.aktif && (!f.ling || k.lingkungan === f.ling)));
    const kamar = computed(() => (m.value.kamar || []).filter((k) => k.aktif && (!f.ling || k.lingkungan === f.ling)));
    return { f, kelas, kamar, duaLing, namaKelas, STATUS_SANTRI };
  },
  template: `<div class="baris" style="gap:8px">
    <label class="isian" v-if="duaLing">Lingkungan<select v-model="f.ling" @change="f.kelas_id=''; f.kamar_id=''"><option value="">Putra & putri</option><option value="putra">Putra</option><option value="putri">Putri</option></select></label>
    <label class="isian">Kelas<select v-model="f.kelas_id"><option value="">Semua kelas</option><option v-for="k in kelas" :value="k.id">{{ namaKelas(k) }}{{ duaLing && !f.ling ? ' (' + k.lingkungan + ')' : '' }}</option></select></label>
    <label class="isian">Kamar<select v-model="f.kamar_id"><option value="">Semua kamar</option><option v-for="k in kamar" :value="k.id">{{ k.nama }}</option></select></label>
    <label class="isian">Status<select v-model="f.status"><option v-for="s in STATUS_SANTRI" :value="s[0]">{{ s[1] }}</option></select></label>
    <label class="isian" v-if="jk">L/P<select v-model="f.jk"><option value="">L & P</option><option value="L">L</option><option value="P">P</option></select></label>
  </div>`,
};

const CariSantri = {
  props: { modelValue: Object, status: { type: String, default: "aktif" } },
  emits: ["update:modelValue"],
  components: { FotoSantri, SaringSantri },
  setup(props, { emit }) {
    const q = ref(""), hasil = ref([]), pilih = ref(props.modelValue || null), dicari = ref(false), buka = ref(false);
    const saring = reactive({ ling: "", kelas_id: "", kamar_id: "", status: props.status, jk: "" });
    const aktifSaring = computed(() => ["ling", "kelas_id", "kamar_id", "jk"].filter((k) => saring[k]).length + (saring.status !== props.status ? 1 : 0));
    let t, nomor = 0;
    const cari = () => {
      clearTimeout(t);
      if (q.value.trim().length < 2) { hasil.value = []; dicari.value = false; return; }
      t = setTimeout(async () => {
        const ini = ++nomor; // abaikan jawaban lama yang datang terlambat
        const r = await api("/santri?" + kueri({ limit: MAKS_SARAN, q: q.value.trim(), ...saring })).catch(() => []);
        if (ini === nomor) { hasil.value = r.slice(0, MAKS_SARAN); dicari.value = true; }
      }, 250);
    };
    watch(q, cari); watch(saring, cari, { deep: true });
    watch(() => props.modelValue, (v) => { pilih.value = v || null; });
    const ambil = (s) => { pilih.value = s; emit("update:modelValue", s); hasil.value = []; q.value = ""; dicari.value = false; };
    return { q, hasil, pilih, ambil, dicari, buka, saring, aktifSaring, ...navSaran(hasil, ambil) };
  },
  template: `<div style="position:relative;display:flex;flex-direction:column;gap:8px">
    <div v-if="pilih" class="baris" style="align-items:center"><div class="santri-sel"><FotoSantri :s="pilih"/><span><strong>{{ pilih.nama }}</strong><div class="redup">{{ pilih.nis }} · {{ pilih.kelas }} · {{ pilih.kamar }}</div></span></div><button type="button" class="kedua kecil" @click="pilih=null; $emit('update:modelValue', null)">Ganti</button></div>
    <template v-else>
      <div class="baris" style="gap:8px;align-items:center;flex-wrap:nowrap">
        <input v-model="q" @keydown="tombol" placeholder="Ketik nama atau NIS (min. 2 huruf)" style="flex:1;min-width:0" role="combobox" :aria-expanded="hasil.length > 0" aria-autocomplete="list" aria-label="Cari santri">
        <button type="button" class="kedua kecil" :aria-expanded="buka" @click="buka = !buka">Filter{{ aktifSaring ? ' (' + aktifSaring + ')' : '' }}</button>
      </div>
      <SaringSantri v-if="buka" v-model="saring"/>
      <div v-if="hasil.length" class="kartu saran" role="listbox">
        <button v-for="(s, i) in hasil" :key="s.id" type="button" role="option" :aria-selected="i === sorot" :style="i === sorot ? 'background:var(--hijau-pucat)' : ''" @click="ambil(s)"><span class="santri-sel"><FotoSantri :s="s" ukuran="kecil"/><span><strong>{{ s.nama }}</strong> <span class="redup">{{ s.nis }} · {{ s.kelas || '—' }} · {{ s.kamar || '—' }}{{ s.status !== 'aktif' ? ' · ' + s.status : '' }}</span></span></span></button>
        <div class="redup" style="padding:4px 8px">Maks. 5 hasil. Perjelas kata kunci atau pakai filter bila belum ketemu.</div>
      </div>
      <div v-else-if="dicari" class="redup">Tidak ada santri yang cocok{{ aktifSaring ? ' dengan filter ini' : '' }}.</div>
    </template></div>`,
};

// Pencarian guru: langsung, maks. 5 saran, filter lingkungan. v-model → {id, nip, nama, lingkungan, …}
const CariGuru = {
  props: { modelValue: Object, lingkungan: { type: String, default: "" } },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    const q = ref(""), hasil = ref([]), pilih = ref(props.modelValue || null), dicari = ref(false), ling = ref(props.lingkungan);
    let t, nomor = 0;
    const cari = () => {
      clearTimeout(t);
      if (q.value.trim().length < 2) { hasil.value = []; dicari.value = false; return; }
      t = setTimeout(async () => {
        const ini = ++nomor;
        const r = await api("/guru?" + kueri({ limit: MAKS_SARAN, q: q.value.trim(), lingkungan: ling.value })).catch(() => []);
        if (ini === nomor) { hasil.value = r.slice(0, MAKS_SARAN); dicari.value = true; }
      }, 250);
    };
    watch(q, cari); watch(ling, cari);
    watch(() => props.modelValue, (v) => { pilih.value = v || null; });
    const ambil = (g) => { pilih.value = g; emit("update:modelValue", g); hasil.value = []; q.value = ""; dicari.value = false; };
    return { q, hasil, pilih, ambil, dicari, ling, ...navSaran(hasil, ambil) };
  },
  template: `<div style="position:relative;display:flex;flex-direction:column;gap:8px">
    <div v-if="pilih" class="baris" style="align-items:center"><span><strong>{{ pilih.nama }}</strong> <span class="redup">NIP {{ pilih.nip }} · {{ pilih.lingkungan }}</span></span><button type="button" class="kedua kecil" @click="pilih=null; $emit('update:modelValue', null)">Ganti</button></div>
    <template v-else>
      <div class="baris" style="gap:8px;align-items:center;flex-wrap:nowrap">
        <input v-model="q" @keydown="tombol" placeholder="Ketik nama atau NIP guru (min. 2 huruf)" style="flex:1;min-width:0" role="combobox" :aria-expanded="hasil.length > 0" aria-label="Cari guru">
        <select v-model="ling" aria-label="Filter lingkungan guru" style="flex:none;width:auto"><option value="">Semua lingkungan</option><option value="putra">Putra</option><option value="putri">Putri</option><option value="semua">Guru 'semua'</option></select>
      </div>
      <div v-if="hasil.length" class="kartu saran" role="listbox">
        <button v-for="(g, i) in hasil" :key="g.id" type="button" role="option" :aria-selected="i === sorot" :style="i === sorot ? 'background:var(--hijau-pucat)' : ''" @click="ambil(g)"><span><strong>{{ g.nama }}</strong> <span class="redup">NIP {{ g.nip }} · {{ g.lingkungan }}</span></span></button>
      </div>
      <div v-else-if="dicari" class="redup">Tidak ada guru yang cocok.</div>
    </template></div>`,
};

const Perizinan = {
  components: { Pesan, CariSantri, FotoSantri },
  directives: { baris: vBaris },
  setup() {
    const f = reactive({ santri: null, jenis_izin_id: "", keterangan: "", berangkat: "", kembali: "", jam: "", pendamping: "", galat: "", ok: "", daftar: [], riwayat: false });
    const jenis = computed(() => ((negara.master || {}).jenis_izin || []).filter((j) => j.aktif));
    const ji = computed(() => jenis.value.find((j) => j.id == f.jenis_izin_id));
    async function muat() { try { f.daftar = await api("/izin" + (f.riwayat ? "?status=riwayat" : "")); } catch (e) { f.galat = e.message; } }
    async function terbit() {
      f.galat = ""; f.ok = "";
      if (!f.santri) { f.galat = "Pilih santri."; return; }
      const j = ji.value;
      const now = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
      let berangkat = now, kembali = "";
      if (j.basis_waktu === "jam") kembali = now.slice(0, 10) + " " + f.jam;
      if (j.basis_waktu === "tanggal_jam") { berangkat = f.berangkat.replace("T", " "); kembali = f.kembali.replace("T", " "); }
      if (j.basis_waktu === "tanggal") { berangkat = f.berangkat + " 00:00"; kembali = f.kembali + " 00:00"; }
      try {
        const r = await api("/izin", { santri_id: f.santri.id, jenis_izin_id: j.id, keterangan: f.keterangan, berangkat, rencana_kembali: kembali, pendamping: f.pendamping });
        f.ok = "Izin diterbitkan."; f.keterangan = ""; f.pendamping = ""; f.santri = null; await muat();
        window.open("#/gatepass/" + r.id, "_blank");
      } catch (e) { f.galat = e.message; }
    }
    async function kembali(z) { try { await api(`/izin/${z.id}/kembali`, {}); await muat(); } catch (e) { f.galat = e.message; } }
    // Overdue yang keliru (santri sebenarnya sudah kembali): pelanggaran & Alpha dibatalkan, wali menerima ralat.
    async function koreksi(z) {
      const alasan = prompt("Koreksi overdue " + z.nama + ": santri sebenarnya kembali tepat waktu. Alasan?");
      if (!alasan) return;
      try { await api(`/izin/${z.id}/koreksi-overdue`, { alasan }); f.ok = "Overdue dikoreksi; wali menerima ralat."; await muat(); } catch (e) { f.galat = e.message; }
    }
    async function batal(z) {
      const alasan = prompt("Alasan membatalkan izin " + z.nama + "?");
      if (!alasan) return;
      try { await api(`/izin/${z.id}/batal`, { alasan }); await muat(); } catch (e) { f.galat = e.message; }
    }
    onMounted(async () => { await muatMaster(); if (jenis.value[0]) f.jenis_izin_id = jenis.value[0].id; muat(); });
    watch(() => f.riwayat, muat);
    const lencana = (k) => ({ berjalan: "biru", terlambat: "kuning", overdue: "merah", kembali: "hijau", dibatalkan: "" }[k]);
    return { f, jenis, ji, terbit, kembali, batal, koreksi, lencana };
  },
  template: `<div class="judul-hal"><div><span class="jejak">Administrasi › Kesantrian</span><h1>Perizinan & Gate Pass</h1></div><a class="tombol kedua" href="#/libur-pondok">Libur Pondok & kembali massal</a></div>
  <div class="kartu" style="display:flex;flex-direction:column;gap:12px;max-width:720px">
    <h2>Terbitkan izin</h2>
    <label class="isian">Santri<CariSantri v-model="f.santri"/></label>
    <div class="baris">
      <label class="isian">Jenis izin<select v-model="f.jenis_izin_id"><option v-for="j in jenis" :value="j.id">{{ j.nama }}</option></select></label>
      <template v-if="ji && ji.basis_waktu === 'jam'"><label class="isian">Kembali pukul<input type="time" v-model="f.jam"></label><span class="redup">Berangkat otomatis = jam sekarang.</span></template>
      <template v-if="ji && ji.basis_waktu === 'tanggal_jam'"><label class="isian">Berangkat<input type="datetime-local" v-model="f.berangkat"></label><label class="isian">Kembali<input type="datetime-local" v-model="f.kembali"></label></template>
      <template v-if="ji && ji.basis_waktu === 'tanggal'"><label class="isian">Tanggal berangkat<input type="date" v-model="f.berangkat"></label><label class="isian">Tanggal kembali<input type="date" v-model="f.kembali"></label><span class="redup">Batas kembali pukul {{ ji.jam_kembali_bawaan || '17:00' }}.</span></template>
    </div>
    <label class="isian">Keterangan (tercetak di Gate Pass)<input v-model="f.keterangan" maxlength="200"></label>
    <label class="isian" v-if="ji && ji.wajib_wali">Nama wali pendamping (wajib)<input v-model="f.pendamping"></label>
    <div><button @click="terbit">Terbitkan & cetak Gate Pass</button></div>
    <Pesan :galat="f.galat" :ok="f.ok"/>
  </div>
  <div class="baris" style="justify-content:space-between"><h2>{{ f.riwayat ? 'Riwayat izin' : 'Izin berjalan' }}</h2><label class="redup" style="display:flex;gap:8px;align-items:center"><input type="checkbox" v-model="f.riwayat"> Tampilkan riwayat</label></div>
  <div class="tabel"><table>
    <thead><tr><th>Santri</th><th>Jenis</th><th>Berangkat</th><th>Kembali</th><th>Status</th><th></th></tr></thead>
    <tbody v-baris><tr v-for="z in f.daftar" :key="z.id">
      <td><div class="santri-sel"><FotoSantri :s="z"/><span><strong>{{ z.nama }}</strong><div class="redup">{{ z.nis }} · {{ z.kamar }}</div></span></div></td><td>{{ z.jenis }}</td><td>{{ z.berangkat }}</td>
      <td>{{ z.kembali_at || z.rencana_kembali }}</td>
      <td><span class="lencana" :class="lencana(z.keadaan)">{{ z.keadaan }}</span></td>
      <td style="white-space:nowrap"><a class="tombol kedua kecil" style="height:34px" :href="'#/gatepass/' + z.id" target="_blank">Gate Pass</a>
        <template v-if="z.keadaan !== 'kembali' && z.keadaan !== 'dibatalkan'"> <button class="kecil" @click="kembali(z)">Kembali</button> <button class="bahaya kecil" @click="batal(z)">Batal</button></template>
        <button v-if="z.overdue_at && !z.overdue_dikoreksi_at" class="kedua kecil" title="Santri sebenarnya sudah kembali tepat waktu" @click="koreksi(z)">Koreksi overdue</button></td>
    </tr></tbody></table>
    <p v-if="!f.daftar.length" class="redup" style="padding:14px">Tidak ada data.</p></div>`,
};

const GatePass = {
  setup() {
    const z = ref(null), galat = ref("");
    const id = location.hash.split("/").pop();
    onMounted(async () => {
      try { z.value = await api("/izin/" + id); } catch (e) { galat.value = e.message; return; }
      await nextTick();
      // tunggu foto & logo termuat (maks. 4 detik) supaya ikut tercetak
      const imgs = [...document.querySelectorAll(".gatepass img")].filter((i) => !i.complete);
      await Promise.race([Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))), new Promise((r) => setTimeout(r, 4000))]);
      setTimeout(() => window.print(), 200);
    });
    const fmt = (s, b) => !s ? "" : b === "jam" ? s.slice(11) : b === "tanggal" ? s.slice(0, 10) : s;
    return { z, galat, fmt };
  },
  template: `<div v-if="galat" class="pesan galat">{{ galat }}</div>
  <div v-if="z" class="gatepass">
    <div class="kepala"><img src="/img/logo-hisada-256.png" alt=""><div><strong style="font-size:16px">Pesantren Modern Daarul 'Uluum Lido</strong><div>SEKRETARIS HISADA</div></div></div>
    <div style="text-align:center;font-weight:700;letter-spacing:.12em;margin-bottom:14px">GATE PASS · {{ z.jenis.toUpperCase() }}</div>
    <div style="display:flex;gap:16px;align-items:flex-start">
    <img v-if="z.foto_url" class="foto-gp" :src="z.foto_url" :alt="'Foto ' + z.nama" referrerpolicy="no-referrer">
    <table style="flex:1"><tbody>
      <tr><td style="width:150px">Name</td><td><strong>{{ z.nama }}</strong> ({{ z.nis }})</td></tr>
      <tr><td>Class / Room</td><td>{{ z.kelas }} · {{ z.kamar }}</td></tr>
      <tr><td>Reason</td><td>{{ z.keterangan }}</td></tr>
      <tr><td>Departure</td><td>{{ fmt(z.berangkat, z.basis_waktu) }}</td></tr>
      <tr><td>Return</td><td>{{ fmt(z.rencana_kembali, z.basis_waktu) }}</td></tr>
      <tr v-if="z.pendamping"><td>Pendamping</td><td>{{ z.pendamping }}</td></tr>
    </tbody></table></div>
    <div style="margin-top:44px;text-align:right"><div style="display:inline-block;border-top:1px solid #000;padding-top:6px;min-width:200px;text-align:center">Security Department</div></div>
    <p class="redup tidak-cetak">No. izin {{ z.id }}</p>
  </div>`,
};

// ---------------------------------------------------------------- Data Master
const KELOMPOK = [
  ["Absensi", "sesi_absensi", "Sesi absensi"], ["Absensi", "kegiatan", "Jenis kegiatan"],
  ["Kesehatan", "tindak_lanjut", "Tindak lanjut"], ["Kesehatan", "diagnosa", "Diagnosa"], ["Kesehatan", "obat", "Obat"],
  ["Kedisiplinan", "kategori_pelanggaran", "Kategori pelanggaran"],
  ["Pengembangan Diri", "ekstrakurikuler", "Ekstrakurikuler"], ["Pengembangan Diri", "tingkat_lomba", "Tingkat lomba"], ["Pengembangan Diri", "hasil_lomba", "Hasil lomba"],
];

const DataMaster = {
  components: { Pesan, FotoSantri, SaringSantri, Paginasi },
  directives: { baris: vBaris },
  setup() {
    const tab = ref("santri");
    const f = reactive({ galat: "", ok: "", q: "", santri: [], memuat: false, edit: null, kelompok: "sesi_absensi", baru: "", ling: negara.me.role === "moderator" || negara.me.lingkungan === "semua" ? "semua" : negara.me.lingkungan, impor: null, imporHasil: null, sibuk: false });
    const m = computed(() => negara.master || {});
    const moderator = computed(() => negara.me && negara.me.role === "moderator");
    const bisaPilihan = (k) => moderator.value || (negara.me.akses || []).includes("pilihan." + k);
    // Pencarian langsung: tabel & 5 saran teratas ikut berubah saat mengetik / mengganti filter.
    const saring = reactive({ ling: "", kelas_id: "", kamar_id: "", status: "semua", jk: "" });
    const saran = ref(false);
    let tCari, nCari = 0;
    async function cari() {
      const ini = ++nCari; f.memuat = true;
      try { const r = await api("/santri?" + kueri({ limit: 200, q: f.q.trim(), ...saring })); if (ini === nCari) f.santri = r; }
      catch (e) { f.galat = e.message; } finally { if (ini === nCari) f.memuat = false; }
    }
    const cariNanti = () => { clearTimeout(tCari); tCari = setTimeout(cari, 250); };
    watch(() => f.q, (v) => { saran.value = v.trim().length >= 2; cariNanti(); });
    watch(saring, cariNanti, { deep: true });
    const saranSantri = computed(() => saran.value && f.q.trim().length >= 2 ? f.santri.slice(0, MAKS_SARAN) : []);
    const pilihSaran = (s) => { saran.value = false; bukaSantri(s); };
    const navS = reactive(navSaran(saranSantri, pilihSaran));
    const tutupSaran = () => setTimeout(() => { saran.value = false; }, 150);

    // Guru: pencarian langsung di daftar (5 saran), filter lingkungan & status, ubah, impor massal CSV.
    const g = reactive({ q: "", ling: "", aktif: "1", saran: false, impor: null, hasil: null, sibuk: false });
    const guruTersaring = computed(() => {
      const q = g.q.trim().toLowerCase();
      return (m.value.guru || []).filter((x) => (!g.ling || x.lingkungan === g.ling) && (g.aktif === "" || String(x.aktif) === g.aktif)
        && (!q || x.nama.toLowerCase().includes(q) || String(x.nip).startsWith(q)));
    });
    const saranGuru = computed(() => g.saran && g.q.trim().length >= 2 ? guruTersaring.value.slice(0, MAKS_SARAN) : []);
    watch(() => g.q, (v) => { g.saran = v.trim().length >= 2; });
    // halaman tabel per tab (20 baris); kembali ke halaman 1 saat pencarian / saringan berubah
    const hal = reactive({ santri: 1, kelas: 1, kamar: 1, guru: 1, ta: 1, pilihan: 1, status: 1, izin: 1, atur: 1 });
    watch(() => f.santri, () => { hal.santri = 1; });
    watch(() => [g.q, g.ling, g.aktif], () => { hal.guru = 1; });
    watch(() => f.kelompok, () => { hal.pilihan = 1; });
    const guruKosong = () => ({ nip: "", nama: "", jenis_kelamin: "L", email: "", no_hp: "", lingkungan: "semua" });
    const isiGuru = (o) => { Object.keys(baru.guru).forEach((k) => delete baru.guru[k]); Object.assign(baru.guru, o); };
    const ubahGuru = (x) => { isiGuru({ id: x.id, nip: x.nip, nama: x.nama, jenis_kelamin: x.jenis_kelamin, email: x.email || "", no_hp: x.no_hp || "", lingkungan: x.lingkungan, aktif: x.aktif }); g.saran = false; };
    const navG = reactive(navSaran(saranGuru, ubahGuru));
    const tutupSaranGuru = () => setTimeout(() => { g.saran = false; }, 150);
    async function simpanGuru() { await simpanMaster("guru", baru.guru); if (!f.galat) isiGuru(guruKosong()); }
    // CSV guru: kolom NIP + nama wajib; nama kolom lain fleksibel (mis. sheet walikelas: wali_kelas, kontak, Email).
    const ALIAS_GURU = { nip: ["NIP"], nama: ["NAMA", "NAMA GURU", "WALI_KELAS", "WALI KELAS", "WALI KAMAR", "WALI ASUH", "GURU"], jk: ["L/P", "JK", "JENIS KELAMIN"],
      email: ["EMAIL", "EMAIL PONDOK"], no_hp: ["NO HP", "NO_HP", "HP", "KONTAK", "WA", "WHATSAPP"], lingkungan: ["LINGKUNGAN"] };
    async function bacaGuru(ev) {
      f.galat = ""; g.hasil = null;
      const file = ev.target.files[0]; if (!file) return;
      const rows = parseCsv((await file.text()).replace(/^﻿/, ""));
      const h = rows.findIndex((r) => r.map((x) => x.trim().toUpperCase()).includes("NIP"));
      if (h < 0) { f.galat = "Kolom NIP tidak ditemukan di file."; return; }
      const H = rows[h].map((x) => x.trim().toUpperCase());
      const col = Object.fromEntries(Object.entries(ALIAS_GURU).map(([k, al]) => [k, H.findIndex((x) => al.includes(x))])); // kolom pertama yang cocok
      if (col.nama < 0) { f.galat = "Kolom nama guru tidak ditemukan (NAMA / WALI_KELAS / WALI ASUH)."; return; }
      const data = [];
      rows.slice(h + 1).forEach((r, i) => {
        const o = { baris: h + i + 2 };
        for (const [k, ix] of Object.entries(col)) o[k] = ix >= 0 ? (r[ix] || "").trim() : "";
        if (/^\d+$/.test(o.nip) && o.nama) data.push(o);
      });
      g.impor = { nama: file.name, rows: data };
    }
    async function imporGuru() {
      g.sibuk = true; f.galat = "";
      const total = { baru: 0, diperbarui: 0, ditolak: [] };
      try {
        for (let i = 0; i < g.impor.rows.length; i += 300) {
          const r = await api("/impor/guru", { rows: g.impor.rows.slice(i, i + 300) });
          total.baru += r.baru; total.diperbarui += r.diperbarui; total.ditolak.push(...r.ditolak);
        }
        g.hasil = total; g.impor = null; await muatMaster();
      } catch (e) { f.galat = e.message; } finally { g.sibuk = false; }
    }
    const templatGuru = () => unduhCsv("templat-guru.csv", [["NIP", "NAMA", "L/P", "EMAIL", "NO HP", "LINGKUNGAN"], ["9901", "Ust. Contoh Guru", "L", "contoh@daarululuumlido.com", "081200000000", "putra"]]);
    // wali kelas / wali asuh tahun ajaran aktif
    const waliDari = (jenis, id) => (m.value[jenis === "kelas" ? "wali_kelas" : "wali_asuh"] || []).filter((w) => w[jenis === "kelas" ? "kelas_id" : "kamar_id"] === id);
    const guruUntuk = (ling, jenis, id) => (m.value.guru || []).filter((g) => g.aktif && (g.lingkungan === "semua" || g.lingkungan === ling) && !waliDari(jenis, id).some((w) => w.guru_id === g.id));
    async function aturWali(jenis, target, guruId) {
      if (!guruId) return;
      const ada = waliDari(jenis, target.id).some((w) => w.peran === (jenis === "kelas" ? "wali" : "wali_asuh"));
      f.galat = ""; f.ok = "";
      try { await api("/wali-binaan", { jenis, target_id: target.id, guru_id: +guruId, peran: ada ? "asisten" : "" }); f.ok = "Tersimpan."; await muatMaster(); } catch (e) { f.galat = e.message; }
    }
    async function hapusWali(jenis, w) {
      if (!confirm(`Hapus ${w.nama} dari penetapan ini?`)) return;
      try { await api("/wali-binaan", { jenis, hapus_id: w.id }); await muatMaster(); } catch (e) { f.galat = e.message; }
    }
    const PERAN_WALI = { wali: "wali", asisten: "asisten", wali_asuh: "wali asuh" };
    async function simpanMaster(tabel, data) { f.galat = ""; f.ok = ""; try { await api("/master/" + tabel, data); f.ok = "Tersimpan."; await muatMaster(); } catch (e) { f.galat = e.message; } }
    async function bukaSantri(s) { f.edit = s ? await api("/santri/" + s.id) : { nis: "", nama: "", jenis_kelamin: "L", status: "aktif" }; }
    async function simpanSantri() { f.galat = ""; try { await api("/santri", f.edit); f.ok = "Data santri tersimpan."; f.edit = null; cari(); muatMaster(); } catch (e) { f.galat = e.message; } }
    const isiPilihan = computed(() => (m.value.pilihan || []).filter((p) => p.kelompok === f.kelompok));
    async function tambahPilihan() { f.galat = ""; try { await api("/pilihan", { kelompok: f.kelompok, nama: f.baru, lingkungan: f.ling }); f.baru = ""; await muatMaster(); } catch (e) { f.galat = e.message; } }
    async function ubahPilihan(p, data) { f.galat = ""; try { await api("/pilihan", { id: p.id, kelompok: p.kelompok, ...data }); await muatMaster(); return true; } catch (e) { f.galat = e.message; return false; } }
    // Sunting baris di tempat: ed = salinan baris yang sedang diedit (pilihan / status kehadiran / jenis izin).
    const ed = reactive({ jenis: "", id: null, data: {} });
    const sunting = (jenis, baris) => { ed.jenis = jenis; ed.id = baris ? baris.id : "baru"; ed.data = baris ? { ...baris } : jenis === "_status" ? { kode: "", nama: "", warna: "#55605A", dihitung_hadir: 0, urutan: 0 } : { nama: "", basis_waktu: "tanggal", wajib_wali: 0, jam_kembali_bawaan: "", status_kehadiran_id: "", urutan: 0 }; };
    const batalSunting = () => { ed.jenis = ""; ed.id = null; };
    const sedangSunting = (jenis, id) => ed.jenis === jenis && ed.id === id;
    async function simpanSunting() {
      const d = ed.data, baru = ed.id === "baru";
      if (ed.jenis === "pilihan") { if (await ubahPilihan(d, { nama: d.nama, urutan: d.urutan, lingkungan: d.lingkungan })) batalSunting(); return; }
      const tabel = ed.jenis === "_status" ? "status_kehadiran" : "jenis_izin";
      const kolom = tabel === "status_kehadiran" ? ["kode", "nama", "warna", "dihitung_hadir", "urutan"] : ["nama", "basis_waktu", "wajib_wali", "jam_kembali_bawaan", "status_kehadiran_id", "urutan"];
      const data = Object.fromEntries(kolom.filter((k) => !(k === "kode" && !baru)).map((k) => [k, d[k]]));
      if (!baru) data.id = ed.id;
      f.galat = ""; f.ok = "";
      try { await api("/master/" + tabel, data); f.ok = "Tersimpan."; batalSunting(); await muatMaster(); } catch (e) { f.galat = e.message; }
    }
    const baru = reactive({ kelas: { tingkat: 1, rombel: "", jenjang_id: 1, label: "", lingkungan: "putra" }, asrama: { nama: "", lingkungan: "putra" }, kamar: { asrama_id: "", nomor: "" }, guru: { nip: "", nama: "", jenis_kelamin: "L", email: "", lingkungan: "semua" }, ta: { nama: "", status: "persiapan" } });
    function tambahKamar() { const a = (m.value.asrama || []).find((x) => x.id == baru.kamar.asrama_id); if (!a) { f.galat = "Pilih asrama."; return; } simpanMaster("kamar", { asrama_id: a.id, nomor: baru.kamar.nomor, nama: a.nama + "-" + baru.kamar.nomor }); }

    // Impor CSV: dibaca di browser, hanya kolom yang diizinkan yang dikirim (NIK/KK/penghasilan/NISN dibuang).
    function parseCsv(t) {
      const R = []; let r = [], v = "", q = false;
      for (let i = 0; i < t.length; i++) { const c = t[i];
        if (q) { if (c === '"') { if (t[i + 1] === '"') { v += '"'; i++; } else q = false; } else v += c; }
        else if (c === '"') q = true; else if (c === ",") { r.push(v); v = ""; } else if (c === "\n") { r.push(v.replace(/\r$/, "")); R.push(r); r = []; v = ""; } else v += c; }
      if (v || r.length) { r.push(v); R.push(r); } return R;
    }
    const tgl = (s) => { const m2 = String(s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m2 ? `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}` : (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null); };
    async function bacaFile(ev) {
      f.galat = ""; f.imporHasil = null;
      const file = ev.target.files[0]; if (!file) return;
      const rows = parseCsv(await file.text());
      // Tab "santriphoto": induk = NIS, "Uk Besar (h_2048)" = link foto. Hanya dua kolom itu yang dikirim.
      const hf = rows.findIndex((r) => r.map((x) => x.trim().toUpperCase()).includes("INDUK"));
      if (hf >= 0) {
        const H = rows[hf].map((x) => x.trim().toUpperCase());
        const cNis = H.indexOf("INDUK"), cFoto = H.findIndex((x) => x.startsWith("UK BESAR"));
        if (cFoto < 0) { f.galat = "Kolom \"Uk Besar (h_2048)\" tidak ditemukan di file foto."; return; }
        const data = [];
        rows.slice(hf + 1).forEach((r, i) => {
          const nis = (r[cNis] || "").trim(), foto = (r[cFoto] || "").trim();
          if (/^\d+$/.test(nis) && foto) data.push({ baris: hf + i + 2, nis, foto });
        });
        f.impor = { jenis: "foto", nama: file.name, rows: data, kolomDibuang: H.filter(Boolean).length - 2 };
        return;
      }
      const h = rows.findIndex((r) => r.map((x) => x.trim().toUpperCase()).includes("NIS") && r.map((x) => x.trim().toUpperCase()).includes("NAMA"));
      if (h < 0) { f.galat = "Kolom NIS dan NAMA tidak ditemukan. Unduh sheet data sebagai CSV."; return; }
      const H = rows[h].map((x) => x.trim().toUpperCase());
      const col = (n) => H.indexOf(n);
      const ambil = { nis: col("NIS"), nama: col("NAMA"), jk: col("L/P"), tempat_lahir: col("TEMPAT LAHIR"), tanggal_lahir: col("TANGGAL LAHIR"), status: col("STATUS"), kelas: col("KELAS"), kamar: col("KAMAR"), kabupaten: col("KABUPATEN"), provinsi: col("PROVINSI"), ayah: col("AYAH"), ibu: col("IBU"), wa_ayah: col("WA_AYAH"), wa_ibu: col("WA_IBU") };
      const data = [];
      rows.slice(h + 1).forEach((r, i) => {
        const nis = (r[ambil.nis] || "").trim(); if (!/^\d+$/.test(nis)) return;
        const o = { baris: h + i + 2 };
        for (const [k, ix] of Object.entries(ambil)) if (ix >= 0) o[k] = (r[ix] || "").trim();
        o.tanggal_lahir = tgl(o.tanggal_lahir);
        data.push(o);
      });
      f.impor = { jenis: "santri", nama: file.name, rows: data, kolomDibuang: H.filter((x) => x && !Object.values(ambil).includes(H.indexOf(x))).length };
    }
    async function jalankanImpor() {
      f.sibuk = true; f.galat = "";
      const foto = f.impor.jenis === "foto", per = foto ? 400 : 50;
      const total = { jenis: f.impor.jenis, baru: 0, diperbarui: 0, tidak_dikenal: 0, ditolak: [] };
      let i = 0;
      try {
        for (; i < f.impor.rows.length; i += per) {
          const r = await api(foto ? "/impor/foto" : "/impor/santri", { rows: f.impor.rows.slice(i, i + per) });
          total.baru += r.baru || 0; total.diperbarui += r.diperbarui; total.tidak_dikenal += r.tidak_dikenal || 0; total.ditolak.push(...r.ditolak);
          f.imporHasil = { ...total, proses: Math.min(i + per, f.impor.rows.length) };
        }
        f.impor = null; await muatMaster(); cari();
      } catch (e) { f.galat = `${e.message} — berhenti pada santri ke-${i + 1}. Klik Impor sekarang lagi; NIS yang sudah masuk hanya diperbarui, tidak dobel.`; } finally { f.sibuk = false; }
    }
    onMounted(async () => { await muatMaster(); cari(); });
    return { hal, potong, waliDari, guruUntuk, aturWali, hapusWali, PERAN_WALI, tab, f, m, moderator, bisaPilihan, cari, simpanMaster, bukaSantri, simpanSantri, KELOMPOK, isiPilihan, tambahPilihan, ubahPilihan, ed, sunting, batalSunting, sedangSunting, simpanSunting, baru, tambahKamar, bacaFile, jalankanImpor, namaKelas,
      saring, saranSantri, pilihSaran, navS, tutupSaran, g, guruTersaring, saranGuru, ubahGuru, navG, tutupSaranGuru, simpanGuru, guruKosong, isiGuru, bacaGuru, imporGuru, templatGuru };
  },
  template: `<div><span class="jejak">Administrasi</span><h1>Data Master</h1></div>
  <div class="tab"><button v-for="t in [['santri','Santri'],['kelas','Kelas'],['asrama','Asrama & Kamar'],['guru','Guru'],['ta','Tahun Ajaran'],['pilihan','Daftar Pilihan'],['impor','Impor Santri'],['atur','Pengaturan']].filter(t => moderator || t[0]==='pilihan' || t[0]==='santri')" :class="{aktif: tab===t[0]}" @click="tab=t[0]; f.ok=''; f.galat=''">{{ t[1] }}</button></div>
  <Pesan :galat="f.galat" :ok="f.ok"/>

  <template v-if="tab==='santri'">
    <div class="kartu" style="display:flex;flex-direction:column;gap:10px">
      <div class="baris" style="align-items:flex-start">
        <div style="position:relative;flex:1 1 260px">
          <input v-model="f.q" @keydown="navS.tombol" @blur="tutupSaran" placeholder="Cari nama atau NIS — hasil muncul saat mengetik" style="width:100%" role="combobox" :aria-expanded="saranSantri.length > 0" aria-label="Cari santri">
          <div v-if="saranSantri.length" class="kartu saran" role="listbox">
            <button v-for="(s, i) in saranSantri" :key="s.id" type="button" role="option" :aria-selected="i === navS.sorot" :style="i === navS.sorot ? 'background:var(--hijau-pucat)' : ''" @mousedown.prevent="pilihSaran(s)">
              <span class="santri-sel"><FotoSantri :s="s" ukuran="kecil"/><span><strong>{{ s.nama }}</strong> <span class="redup">{{ s.nis }} · {{ s.kelas || '—' }} · {{ s.kamar || '—' }}</span></span></span></button>
          </div>
        </div>
        <button v-if="moderator" @click="bukaSantri(null)">Tambah santri</button>
      </div>
      <SaringSantri v-model="saring" :jk="true"/>
      <span class="redup">{{ f.memuat ? 'Mencari…' : f.santri.length + (f.santri.length === 200 ? '+ (tampil 200 pertama; perjelas pencarian)' : '') + ' santri' }}</span>
    </div>
    <div v-if="f.edit" class="kartu" style="display:flex;flex-direction:column;gap:12px">
      <div class="santri-sel" style="gap:16px"><FotoSantri v-if="f.edit.id" :s="f.edit" ukuran="besar"/><div><h2>{{ f.edit.id ? 'Ubah santri' : 'Santri baru' }}</h2><span v-if="f.edit.id" class="redup">{{ f.edit.nis }} · {{ f.edit.nama }}{{ f.edit.foto_url ? '' : ' · belum ada foto' }}</span></div></div>
      <div class="baris">
        <label class="isian">NIS<input v-model="f.edit.nis"></label><label class="isian" style="flex:1 1 240px">Nama<input v-model="f.edit.nama"></label>
        <label class="isian">L/P<select v-model="f.edit.jenis_kelamin"><option value="L">L</option><option value="P">P</option></select></label>
        <label class="isian">Status<select v-model="f.edit.status"><option v-for="s in ['aktif','skorsing','alumni','mutasi_keluar','meninggal']" :value="s">{{ s }}</option></select></label>
      </div><div class="baris">
        <label class="isian">Tempat lahir<input v-model="f.edit.tempat_lahir"></label><label class="isian">Tanggal lahir<input type="date" v-model="f.edit.tanggal_lahir"></label>
        <label class="isian">Kelas<select v-model="f.edit.kelas_id"><option :value="null">—</option><option v-for="k in m.kelas" :value="k.id">{{ namaKelas(k) }} ({{ k.lingkungan }})</option></select></label>
        <label class="isian">Kamar<select v-model="f.edit.kamar_id"><option :value="null">—</option><option v-for="k in m.kamar" :value="k.id">{{ k.nama }}</option></select></label>
        <label class="isian">Kabupaten<input v-model="f.edit.kabupaten"></label><label class="isian">Provinsi<input v-model="f.edit.provinsi"></label>
      </div>
      <div v-if="f.edit.wali && f.edit.wali.length" class="redup">Wali: <span v-for="w in f.edit.wali">{{ w.hubungan }} {{ w.nama }} ({{ w.no_hp || '—' }}) · </span></div>
      <div class="baris"><button @click="simpanSantri">Simpan</button><button class="kedua" @click="f.edit=null">Batal</button></div>
    </div>
    <div class="tabel"><table><thead><tr><th>Santri</th><th>L/P</th><th>Kelas</th><th>Kamar</th><th>Status</th><th></th></tr></thead>
      <tbody v-baris><tr v-for="s in potong(f.santri, hal.santri)" :key="s.id"><td><div class="santri-sel"><FotoSantri :s="s"/><span><strong>{{ s.nama }}</strong><div class="redup">{{ s.nis }}</div></span></div></td><td>{{ s.jenis_kelamin }}</td><td>{{ s.kelas }}</td><td>{{ s.kamar }}</td><td><span class="lencana" :class="{hijau: s.status==='aktif'}">{{ s.status }}</span></td><td><button v-if="moderator" class="kedua kecil" @click="bukaSantri(s)">Ubah</button></td></tr></tbody></table>
      <p v-if="f.memuat && !f.santri.length" class="redup" style="padding:14px">Memuat…</p>
      <p v-else-if="!f.santri.length" class="redup" style="padding:14px">{{ f.q ? 'Tidak ada santri yang cocok.' : 'Belum ada data. Gunakan tab Impor Santri.' }}</p></div>
    <Paginasi v-model="hal.santri" :jumlah="f.santri.length"/>
  </template>

  <template v-if="tab==='kelas'">
    <div class="kartu baris">
      <label class="isian">Tingkat<select v-model.number="baru.kelas.tingkat"><option v-for="t in 6" :value="t">{{ t }}</option></select></label>
      <label class="isian">Rombel<input v-model="baru.kelas.rombel" placeholder="A / Intensif A"></label>
      <label class="isian">Jenjang<select v-model="baru.kelas.jenjang_id"><option v-for="j in m.jenjang" :value="j.id">{{ j.nama }}</option></select></label>
      <label class="isian">Label<input v-model="baru.kelas.label" placeholder="MIA/IIS (opsional)"></label>
      <label class="isian">Lingkungan<select v-model="baru.kelas.lingkungan"><option>putra</option><option>putri</option></select></label>
      <button @click="simpanMaster('kelas', baru.kelas)">Tambah rombel</button>
    </div>
    <div class="tabel"><table><thead><tr><th>Kelas</th><th>Lingkungan</th><th>Santri aktif</th><th>Wali kelas (TA aktif)</th><th>Status</th><th></th></tr></thead>
      <tbody><tr v-for="k in potong(m.kelas, hal.kelas)" :key="k.id"><td><strong>{{ namaKelas(k) }}</strong></td><td>{{ k.lingkungan }}</td><td>{{ k.jumlah }}</td>
        <td><div class="baris" style="gap:4px"><span v-for="w in waliDari('kelas', k.id)" :key="w.id" class="lencana" :class="w.peran === 'wali' ? 'hijau' : ''">{{ w.nama }} · {{ PERAN_WALI[w.peran] }}
          <button v-if="moderator" class="tanpa-gaya" :aria-label="'Hapus ' + w.nama" @click="hapusWali('kelas', w)">✕</button></span>
          <select v-if="moderator && k.aktif" class="kecil" aria-label="Tetapkan wali kelas" @change="aturWali('kelas', k, $event.target.value); $event.target.value = ''">
            <option value="">+ {{ waliDari('kelas', k.id).length ? 'asisten' : 'wali' }}…</option><option v-for="g in guruUntuk(k.lingkungan, 'kelas', k.id)" :value="g.id">{{ g.nama }}</option></select></div></td>
        <td>{{ k.aktif ? 'Aktif' : 'Nonaktif' }}</td><td><button class="kedua kecil" @click="simpanMaster('kelas', {id: k.id, aktif: k.aktif ? 0 : 1})">{{ k.aktif ? 'Nonaktifkan' : 'Aktifkan' }}</button></td></tr></tbody></table></div>
    <Paginasi v-model="hal.kelas" :jumlah="(m.kelas || []).length"/>
    <p class="redup">Rombel statis (K-89): yang berubah tiap tahun hanya santri dan wali kelasnya. Wali kelas ditetapkan per tahun ajaran aktif; guru yang punya akun menerima kabar santri binaannya di notifikasi.</p>
  </template>

  <template v-if="tab==='asrama'">
    <div class="dua-kolom">
      <div class="kartu baris"><label class="isian">Asrama baru<input v-model="baru.asrama.nama"></label><label class="isian">Lingkungan<select v-model="baru.asrama.lingkungan"><option>putra</option><option>putri</option></select></label><button @click="simpanMaster('asrama', baru.asrama)">Tambah</button></div>
      <div class="kartu baris"><label class="isian">Asrama<select v-model="baru.kamar.asrama_id"><option v-for="a in m.asrama" :value="a.id">{{ a.nama }}</option></select></label><label class="isian">Nomor kamar<input v-model="baru.kamar.nomor" placeholder="01"></label><button @click="tambahKamar">Tambah kamar</button></div>
    </div>
    <div class="tabel"><table><thead><tr><th>Kamar</th><th>Lingkungan</th><th>Penghuni</th><th>Wali asuh (TA aktif)</th><th>Status</th><th></th></tr></thead>
      <tbody><tr v-for="k in potong(m.kamar, hal.kamar)" :key="k.id"><td><strong>{{ k.nama }}</strong></td><td>{{ k.lingkungan }}</td><td>{{ k.jumlah }}</td>
        <td><div class="baris" style="gap:4px"><span v-for="w in waliDari('kamar', k.id)" :key="w.id" class="lencana" :class="w.peran === 'wali_asuh' ? 'hijau' : ''">{{ w.nama }} · {{ PERAN_WALI[w.peran] }}
          <button v-if="moderator" class="tanpa-gaya" :aria-label="'Hapus ' + w.nama" @click="hapusWali('kamar', w)">✕</button></span>
          <select v-if="moderator && k.aktif" class="kecil" aria-label="Tetapkan wali asuh" @change="aturWali('kamar', k, $event.target.value); $event.target.value = ''">
            <option value="">+ {{ waliDari('kamar', k.id).length ? 'asisten' : 'wali asuh' }}…</option><option v-for="g in guruUntuk(k.lingkungan, 'kamar', k.id)" :value="g.id">{{ g.nama }}</option></select></div></td>
        <td>{{ k.aktif ? 'Aktif' : 'Nonaktif' }}</td><td><button class="kedua kecil" @click="simpanMaster('kamar', {id: k.id, aktif: k.aktif ? 0 : 1})">{{ k.aktif ? 'Nonaktifkan' : 'Aktifkan' }}</button></td></tr></tbody></table></div>
    <Paginasi v-model="hal.kamar" :jumlah="(m.kamar || []).length"/>
  </template>

  <template v-if="tab==='guru'">
    <div class="dua-kolom">
      <div class="kartu" style="display:flex;flex-direction:column;gap:10px">
        <h2>{{ baru.guru.id ? 'Ubah guru' : 'Tambah guru' }}</h2>
        <div class="baris">
          <label class="isian">NIP<input v-model="baru.guru.nip" inputmode="numeric" style="width:110px"></label><label class="isian" style="flex:1 1 220px">Nama<input v-model="baru.guru.nama"></label>
          <label class="isian">L/P<select v-model="baru.guru.jenis_kelamin"><option>L</option><option>P</option></select></label>
        </div><div class="baris">
          <label class="isian" style="flex:1 1 200px">Email pondok<input v-model="baru.guru.email" type="email"></label>
          <label class="isian">No. HP<input v-model="baru.guru.no_hp" inputmode="tel"></label>
          <label class="isian">Lingkungan<select v-model="baru.guru.lingkungan"><option>semua</option><option>putra</option><option>putri</option></select></label>
          <label v-if="baru.guru.id" class="isian">Status<select v-model.number="baru.guru.aktif"><option :value="1">Aktif</option><option :value="0">Nonaktif</option></select></label>
        </div>
        <div class="baris"><button @click="simpanGuru">{{ baru.guru.id ? 'Simpan perubahan' : 'Tambah guru' }}</button><button v-if="baru.guru.id" class="kedua" @click="isiGuru(guruKosong())">Batal ubah</button></div>
      </div>
      <div class="kartu" style="display:flex;flex-direction:column;gap:10px">
        <h2>Impor guru massal (CSV)</h2>
        <p class="redup" style="margin:0">Kolom wajib <strong>NIP</strong> dan <strong>nama</strong>; boleh juga L/P, EMAIL, NO HP, LINGKUNGAN. Sheet <em>walikelas</em> / <em>walikamar</em> sekretariat bisa langsung dipakai (kolom wali_kelas, kontak, Email). L/P kosong dibaca dari gelar Ust. (L) / Ustzh. (P). NIP yang sudah ada diperbarui.</p>
        <div class="baris"><input type="file" accept=".csv,text/csv" @change="bacaGuru" style="flex:1"><button type="button" class="kedua kecil" @click="templatGuru">Unduh templat</button></div>
        <div v-if="g.impor" class="pesan info">{{ g.impor.nama }}: <strong>{{ g.impor.rows.length }}</strong> guru terbaca.
          <div style="margin-top:8px"><button :disabled="g.sibuk || !g.impor.rows.length" @click="imporGuru">{{ g.sibuk ? 'Mengimpor…' : 'Impor sekarang' }}</button></div></div>
        <div v-if="g.hasil" class="pesan ok">Baru {{ g.hasil.baru }} · diperbarui {{ g.hasil.diperbarui }} · ditolak {{ g.hasil.ditolak.length }}</div>
        <div v-if="g.hasil && g.hasil.ditolak.length" class="tabel"><table><thead><tr><th>Baris</th><th>NIP</th><th>Alasan</th></tr></thead><tbody><tr v-for="d in g.hasil.ditolak"><td>{{ d.baris }}</td><td>{{ d.nip }}</td><td>{{ d.alasan }}</td></tr></tbody></table></div>
      </div>
    </div>
    <div class="kartu baris" style="align-items:flex-end">
      <div style="position:relative;flex:1 1 260px">
        <label class="isian">Cari guru<input v-model="g.q" @keydown="navG.tombol" @blur="tutupSaranGuru" placeholder="Nama atau NIP — hasil muncul saat mengetik" role="combobox" :aria-expanded="saranGuru.length > 0"></label>
        <div v-if="saranGuru.length" class="kartu saran" role="listbox">
          <button v-for="(x, i) in saranGuru" :key="x.id" type="button" role="option" :aria-selected="i === navG.sorot" :style="i === navG.sorot ? 'background:var(--hijau-pucat)' : ''" @mousedown.prevent="ubahGuru(x)"><span><strong>{{ x.nama }}</strong> <span class="redup">NIP {{ x.nip }} · {{ x.lingkungan }}</span></span></button>
        </div>
      </div>
      <label class="isian">Lingkungan<select v-model="g.ling"><option value="">Semua</option><option>putra</option><option>putri</option><option>semua</option></select></label>
      <label class="isian">Status<select v-model="g.aktif"><option value="1">Aktif</option><option value="0">Nonaktif</option><option value="">Semua</option></select></label>
      <span class="redup">{{ guruTersaring.length }} guru</span>
    </div>
    <div class="tabel"><table><thead><tr><th>NIP</th><th>Nama</th><th>L/P</th><th>Email</th><th>No. HP</th><th>Lingkungan</th><th></th></tr></thead>
      <tbody v-baris><tr v-for="x in potong(guruTersaring, hal.guru)" :key="x.id" :style="{color: x.aktif ? '' : '#6B756F'}"><td>{{ x.nip }}</td><td><strong>{{ x.nama }}</strong></td><td>{{ x.jenis_kelamin }}</td><td>{{ x.email }}</td><td>{{ x.no_hp }}</td><td>{{ x.lingkungan }}</td>
        <td><button class="kedua kecil" @click="ubahGuru(x)">Ubah</button></td></tr></tbody></table>
      <p v-if="!guruTersaring.length" class="redup" style="padding:14px">{{ g.q || g.ling ? 'Tidak ada guru yang cocok.' : 'Belum ada data guru. Tambah satu per satu atau impor CSV.' }}</p></div>
    <Paginasi v-model="hal.guru" :jumlah="guruTersaring.length"/>
  </template>

  <template v-if="tab==='ta'">
    <div class="kartu baris"><label class="isian">Tahun ajaran<input v-model="baru.ta.nama" placeholder="2027/2028"></label><button @click="simpanMaster('tahun_ajaran', baru.ta)">Tambah (persiapan)</button></div>
    <div class="tabel"><table><thead><tr><th>Tahun ajaran</th><th>Status</th><th>Mulai</th><th></th></tr></thead>
      <tbody><tr v-for="t in potong(m.tahun_ajaran, hal.ta)" :key="t.id"><td><strong>{{ t.nama }}</strong></td><td>{{ t.status }}</td><td>{{ t.mulai || '—' }}</td><td><button v-if="t.status!=='aktif'" class="kedua kecil" @click="simpanMaster('tahun_ajaran', {id: t.id, status: 'aktif'})">Jadikan aktif</button></td></tr></tbody></table></div>
    <Paginasi v-model="hal.ta" :jumlah="(m.tahun_ajaran || []).length"/>
  </template>

  <template v-if="tab==='pilihan'">
    <div class="dua-kolom">
      <div class="kartu daftar-kelompok" style="flex:0 1 260px;display:flex;flex-direction:column;gap:2px">
        <template v-for="(k, i) in KELOMPOK"><span v-if="i===0 || KELOMPOK[i-1][0]!==k[0]" class="redup" style="padding:8px 10px 2px;font-weight:700;font-size:11px;text-transform:uppercase">{{ k[0] }}</span>
          <button :class="{aktif: f.kelompok===k[1]}" @click="f.kelompok=k[1]">{{ k[2] }}</button></template>
        <span class="redup" style="padding:8px 10px 2px;font-weight:700;font-size:11px;text-transform:uppercase">Berperilaku</span>
        <button :class="{aktif: f.kelompok==='_status'}" @click="f.kelompok='_status'">Status kehadiran</button>
        <button :class="{aktif: f.kelompok==='_izin'}" @click="f.kelompok='_izin'">Jenis izin</button>
      </div>
      <div class="kartu" style="display:flex;flex-direction:column;gap:12px">
        <template v-if="f.kelompok==='_status'">
          <h2>Status kehadiran</h2>
          <div class="baris" v-if="moderator && !sedangSunting('_status','baru')"><button class="kedua" @click="sunting('_status')">+ Tambah status</button></div>
          <div class="tabel"><table><thead><tr><th>Kode</th><th>Nama</th><th>Warna</th><th>Dihitung hadir</th><th>Urutan</th><th>Status</th><th></th></tr></thead>
            <tbody>
              <tr v-for="s in [...(sedangSunting('_status','baru') ? [{id:'baru'}] : []), ...potong(m.status_kehadiran, hal.status)]" :key="s.id">
                <template v-if="sedangSunting('_status', s.id)">
                  <td><input v-if="s.id==='baru'" v-model="ed.data.kode" maxlength="3" style="width:56px"><strong v-else>{{ s.kode }}</strong></td>
                  <td><input v-model="ed.data.nama" style="min-width:140px"></td>
                  <td><input type="color" v-model="ed.data.warna" style="width:48px;padding:2px"></td>
                  <td><select v-model.number="ed.data.dihitung_hadir"><option :value="1">Ya</option><option :value="0">Tidak</option></select></td>
                  <td><input type="number" v-model.number="ed.data.urutan" style="width:70px"></td>
                  <td colspan="2"><div class="baris"><button class="kecil" @click="simpanSunting">Simpan</button><button class="kedua kecil" @click="batalSunting">Batal</button></div></td>
                </template>
                <template v-else>
                  <td>{{ s.kode }}</td><td :style="{color: s.warna, fontWeight: 700}">{{ s.nama }}</td><td><span :style="{display:'inline-block',width:'18px',height:'18px',borderRadius:'4px',background:s.warna}"></span></td>
                  <td>{{ s.dihitung_hadir ? 'Ya' : 'Tidak' }}</td><td>{{ s.urutan }}</td>
                  <td><button v-if="moderator" class="kedua kecil" @click="simpanMaster('status_kehadiran', {id: s.id, aktif: s.aktif ? 0 : 1})">{{ s.aktif ? 'Aktif' : 'Nonaktif' }}</button></td>
                  <td><button v-if="moderator" class="kedua kecil" @click="sunting('_status', s)">Ubah</button></td>
                </template>
              </tr></tbody></table></div>
          <Paginasi v-model="hal.status" :jumlah="(m.status_kehadiran || []).length"/>
          <p class="redup">Kode tidak bisa diubah setelah dibuat karena dipakai aturan otomatis (mis. overdue → A, skorsing → P).</p>
        </template>
        <template v-else-if="f.kelompok==='_izin'">
          <h2>Jenis izin</h2>
          <div class="baris" v-if="moderator && !sedangSunting('_izin','baru')"><button class="kedua" @click="sunting('_izin')">+ Tambah jenis izin</button></div>
          <div class="tabel"><table><thead><tr><th>Nama</th><th>Basis waktu</th><th>Jam kembali bawaan</th><th>Wajib wali</th><th>Status absensi</th><th>Urutan</th><th>Status</th><th></th></tr></thead>
            <tbody>
              <tr v-for="j in [...(sedangSunting('_izin','baru') ? [{id:'baru'}] : []), ...potong(m.jenis_izin, hal.izin)]" :key="j.id">
                <template v-if="sedangSunting('_izin', j.id)">
                  <td><input v-model="ed.data.nama" style="min-width:140px"></td>
                  <td><select v-model="ed.data.basis_waktu"><option value="jam">jam</option><option value="tanggal_jam">tanggal_jam</option><option value="tanggal">tanggal</option></select></td>
                  <td><input type="time" v-model="ed.data.jam_kembali_bawaan"></td>
                  <td><select v-model.number="ed.data.wajib_wali"><option :value="1">Ya</option><option :value="0">Tidak</option></select></td>
                  <td><select v-model="ed.data.status_kehadiran_id"><option value="">—</option><option v-for="s in m.status_kehadiran" :value="s.id">{{ s.nama }}</option></select></td>
                  <td><input type="number" v-model.number="ed.data.urutan" style="width:70px"></td>
                  <td colspan="2"><div class="baris"><button class="kecil" @click="simpanSunting">Simpan</button><button class="kedua kecil" @click="batalSunting">Batal</button></div></td>
                </template>
                <template v-else>
                  <td><strong>{{ j.nama }}</strong></td><td>{{ j.basis_waktu }}</td><td>{{ j.jam_kembali_bawaan || '—' }}</td><td>{{ j.wajib_wali ? 'Ya' : 'Tidak' }}</td>
                  <td>{{ (m.status_kehadiran.find(s => s.id===j.status_kehadiran_id)||{}).nama }}</td><td>{{ j.urutan }}</td>
                  <td><button v-if="moderator" class="kedua kecil" @click="simpanMaster('jenis_izin', {id: j.id, aktif: j.aktif ? 0 : 1})">{{ j.aktif ? 'Aktif' : 'Nonaktif' }}</button></td>
                  <td><button v-if="moderator" class="kedua kecil" @click="sunting('_izin', j)">Ubah</button></td>
                </template>
              </tr></tbody></table></div>
          <Paginasi v-model="hal.izin" :jumlah="(m.jenis_izin || []).length"/>
        </template>
        <template v-else>
          <h2>{{ (KELOMPOK.find(k => k[1]===f.kelompok)||[])[2] }}</h2>
          <div class="baris" v-if="bisaPilihan(f.kelompok)"><label class="isian" style="flex:2 1 200px">Pilihan baru<input v-model="f.baru" @keyup.enter="tambahPilihan"></label>
            <label class="isian">Lingkungan<select v-model="f.ling"><option>semua</option><option>putra</option><option>putri</option></select></label><button @click="tambahPilihan">Tambah</button></div>
          <div class="tabel"><table><thead><tr><th>Urutan</th><th>Pilihan</th><th>Lingkungan</th><th>Status</th><th></th></tr></thead>
            <tbody><tr v-for="p in potong(isiPilihan, hal.pilihan)" :key="p.id" :style="{color: p.aktif ? '' : '#6B756F'}">
              <template v-if="sedangSunting('pilihan', p.id)">
                <td><input type="number" v-model.number="ed.data.urutan" style="width:70px"></td>
                <td><input v-model="ed.data.nama" maxlength="120" style="min-width:160px" @keyup.enter="simpanSunting" @keyup.esc="batalSunting"></td>
                <td><select v-model="ed.data.lingkungan"><option>semua</option><option>putra</option><option>putri</option></select></td>
                <td colspan="2"><div class="baris"><button class="kecil" @click="simpanSunting">Simpan</button><button class="kedua kecil" @click="batalSunting">Batal</button></div></td>
              </template>
              <template v-else>
                <td>{{ p.urutan }}</td><td><strong>{{ p.nama }}</strong></td><td>{{ p.lingkungan }}</td>
                <td><button class="kecil" :class="p.aktif ? '' : 'kedua'" :disabled="!bisaPilihan(p.kelompok)" @click="ubahPilihan(p, {aktif: p.aktif ? 0 : 1})">{{ p.aktif ? 'Aktif' : 'Nonaktif' }}</button></td>
                <td><button v-if="bisaPilihan(p.kelompok)" class="kedua kecil" @click="sunting('pilihan', p)">Ubah</button></td>
              </template></tr></tbody></table>
            <p v-if="!isiPilihan.length" class="redup" style="padding:14px">Belum ada pilihan.</p></div>
          <Paginasi v-model="hal.pilihan" :jumlah="isiPilihan.length"/>
          <p class="redup">Klik <strong>Ubah</strong> untuk mengganti nama, urutan, atau lingkungan. Mengganti nama juga mengubah tampilan di data lama yang memakai pilihan ini. Pilihan yang sudah dipakai tidak dihapus — cukup dinonaktifkan.</p>
        </template>
      </div>
    </div>
  </template>

  <template v-if="tab==='impor'">
    <div class="kartu" style="display:flex;flex-direction:column;gap:12px;max-width:760px">
      <h2>Impor data santri dari spreadsheet sekretariat</h2>
      <ol class="redup" style="margin:0;padding-left:18px;line-height:1.7">
        <li>Buka spreadsheet data santri → pilih sheet <strong>data</strong> → File → Download → <strong>CSV</strong>.</li>
        <li>Pilih file di bawah. File dibaca <strong>di browser ini</strong>; hanya kolom NIS, nama, L/P, tempat & tanggal lahir, status, kelas, kamar, kabupaten, provinsi, nama & WA ayah/ibu yang dikirim.</li>
        <li><strong>NIK, No KK, penghasilan, NISN, pekerjaan, alamat rinci tidak pernah dikirim ke server.</strong></li>
        <li><strong>Foto santri:</strong> unduh tab <strong>santriphoto</strong> sebagai CSV lalu pilih di sini. Hanya NIS (induk) dan link <em>Uk Besar (h_2048)</em> yang dikirim; impor data santri dulu agar NIS-nya dikenali.</li>
      </ol>
      <input type="file" accept=".csv,text/csv" @change="bacaFile">
      <div v-if="f.impor" class="pesan info">{{ f.impor.nama }}: <strong>{{ f.impor.rows.length }}</strong> {{ f.impor.jenis === 'foto' ? 'link foto' : 'baris santri' }} terbaca · {{ f.impor.kolomDibuang }} kolom lain dibuang.
        <div style="margin-top:8px"><button :disabled="f.sibuk" @click="jalankanImpor">{{ f.sibuk ? 'Mengimpor…' : 'Impor sekarang' }}</button></div></div>
      <div v-if="f.imporHasil && f.imporHasil.jenis === 'foto'" class="pesan ok">Diproses {{ f.imporHasil.proses || '' }} · foto diperbarui {{ f.imporHasil.diperbarui }} · NIS belum ada di HISADA {{ f.imporHasil.tidak_dikenal }} · ditolak {{ f.imporHasil.ditolak.length }}</div>
      <div v-else-if="f.imporHasil" class="pesan ok">Diproses {{ f.imporHasil.proses || '' }} · baru {{ f.imporHasil.baru }} · diperbarui {{ f.imporHasil.diperbarui }} · ditolak {{ f.imporHasil.ditolak.length }}</div>
      <div v-if="f.imporHasil && f.imporHasil.ditolak.length" class="tabel"><table><thead><tr><th>Baris</th><th>NIS</th><th>Alasan</th></tr></thead><tbody><tr v-for="d in f.imporHasil.ditolak"><td>{{ d.baris }}</td><td>{{ d.nis }}</td><td>{{ d.alasan }}</td></tr></tbody></table></div>
    </div>
  </template>

  <template v-if="tab==='atur'">
    <div class="tabel"><table><thead><tr><th>Pengaturan</th><th>Nilai</th><th>Keterangan</th></tr></thead>
      <tbody><tr v-for="p in potong(m.pengaturan, hal.atur)" :key="p.kunci"><td><code>{{ p.kunci }}</code></td><td><input v-model="p.nilai" style="width:120px" @change="simpanMaster('pengaturan', {kunci: p.kunci, nilai: p.nilai})"></td><td class="redup">{{ p.keterangan }}</td></tr></tbody></table></div>
    <Paginasi v-model="hal.atur" :jumlah="(m.pengaturan || []).length"/>
    <p class="redup">Tambahkan <code>login.password_aktif</code> = 0 lewat database bila login password ingin dimatikan setelah semua memakai Google.</p>
  </template>`,
};

// ---------------------------------------------------------------- Pengguna & Manajemen Akses
const Pengguna = {
  components: { Pesan, CariSantri, SandiSementara },
  setup() {
    const tab = ref("akun");
    const f = reactive({ users: [], akses: [], preset: [], galat: "", ok: "", sel: null, santri: null, presetSantri: "", guru_id: "", presetGuru: "", modNama: "", modEmail: "", presetTerapkan: "", q: "", sandi: null });
    const m = computed(() => negara.master || {});
    async function muat() {
      const r = await api("/users"); f.users = r.users; f.akses = r.akses; f.preset = r.preset;
      if (f.sel) f.sel = f.users.find((u) => u.id === f.sel.id) || null;
      if (!f.presetGuru) f.presetGuru = (f.preset.find((p) => p.nama === "Asatidz") || {}).id || "";
    }
    const jalan = async (fn, pesan) => { f.galat = ""; f.ok = ""; try { const r = await fn(); f.ok = typeof pesan === "function" ? pesan(r) : pesan; await muat(); return true; } catch (e) { f.galat = e.message; return false; } };
    const buatPengurus = () => { const s = f.santri; return jalan(() => api("/users/dari-santri", { santri_id: s.id, preset_id: f.presetSantri || null }),
      (r) => { f.sandi = [{ nama: s.nama, nis: s.nis, password: r.password_sementara }]; return "Akun pengurus dibuat."; }); };
    const buatGuru = () => jalan(() => api("/users/guru", { guru_id: f.guru_id, preset_id: f.presetGuru || null }), "Akun guru dibuat (masuk dengan Google).");
    const buatMod = () => jalan(() => api("/users/moderator", { nama: f.modNama, email: f.modEmail }), "Moderator ditambahkan (masuk dengan Google).");
    const ubah = (u, data) => jalan(() => api("/users/" + u.id, data), "Akun diperbarui.");
    const akses = (u, kode, beri) => jalan(() => api(`/users/${u.id}/akses`, { kode, beri }), beri ? "Akses diberikan." : "Akses dicabut.");
    const reset = (u) => confirm("Reset password " + u.email + "?") && jalan(() => api(`/users/${u.id}/reset-password`, {}),
      (r) => { f.sandi = [{ nama: u.nama, email: u.email, password: r.password_sementara }]; return "Password direset."; });
    function terapkan(u) {
      const p = f.preset.find((x) => x.id == f.presetTerapkan);
      if (!p || !confirm(`Terapkan preset ${p.nama} ke ${u.nama}?\nAkses akun ini DIGANTI dengan isi preset (${p.akses.length} akses). Sesudahnya akses masih bisa diubah satu per satu.`)) return;
      jalan(() => api(`/users/${u.id}/preset`, { preset_id: p.id }), `Preset ${p.nama} diterapkan.`).then(() => { f.presetTerapkan = ""; });
    }
    function jadikanMod(u, jadi) {
      if (jadi) return confirm(`Jadikan ${u.nama} Moderator? Moderator memegang SEMUA akses, termasuk mengelola pengguna dan backup.`) && ubah(u, { moderator: true });
      // dicabut: lingkungan wajib dipilih ulang (tidak otomatis tetap "semua")
      const l = (prompt(`Cabut status Moderator ${u.nama}?\nLingkungan akun ini sesudahnya (putra / putri / semua):`, u.guru_id ? u.lingkungan : "putra") || "").trim().toLowerCase();
      if (!l) return;
      if (!["putra", "putri", "semua"].includes(l)) { f.galat = "Lingkungan harus putra, putri, atau semua."; return; }
      ubah(u, { moderator: false, lingkungan: l });
    }
    // label akses akun: Moderator · nama preset (+ "diubah" bila aksesnya tidak lagi sama dengan preset) · akses manual · belum ada akses
    const samaPreset = (u) => { const p = f.preset.find((x) => x.id === u.preset_id); return p && p.akses.length === u.akses.length && p.akses.every((k) => u.akses.includes(k)); };
    const labelUser = (u) => u.role === "moderator" ? "Moderator" : u.preset ? u.preset + (samaPreset(u) ? "" : " (diubah)") : u.akses.length ? `Akses manual (${u.akses.length})` : "Belum ada akses";
    const kelasLabel = (u) => u.role === "moderator" ? "hijau" : !u.akses.length ? "kuning" : "";
    const tampil = computed(() => { const q = f.q.trim().toLowerCase(); return q ? f.users.filter((u) => (u.nama + " " + u.email + " " + (u.nis || "") + " " + (u.nip || "")).toLowerCase().includes(q)) : f.users; });
    // daftar akses: akses fungsi & lihat, lalu izin mengedit daftar pilihan
    const aksesUtama = computed(() => f.akses.filter((a) => !a.kode.startsWith("pilihan.")));
    const aksesPilihan = computed(() => f.akses.filter((a) => a.kode.startsWith("pilihan.")));
    const namaAkses = (k) => (f.akses.find((a) => a.kode === k) || {}).nama || k;

    // ---- preset
    const ed = reactive({ id: null, nama: "", keterangan: "", akses: [] });
    const sunting = (p) => { tab.value = "preset"; ed.id = p ? p.id : "baru"; ed.nama = p ? p.nama : ""; ed.keterangan = p ? p.keterangan || "" : ""; ed.akses = p ? [...p.akses] : []; };
    const batal = () => { ed.id = null; };
    async function simpanPreset() {
      if (await jalan(() => api("/preset", { id: ed.id === "baru" ? null : ed.id, nama: ed.nama, keterangan: ed.keterangan, akses: ed.akses }), "Preset tersimpan. Akun yang sudah memakai preset ini tidak berubah.")) batal();
    }
    const hapusPreset = (p) => confirm(`Hapus preset ${p.nama}? Akun yang memakainya tetap memegang aksesnya.`) && jalan(() => api(`/preset/${p.id}/hapus`, {}), "Preset dihapus.");
    const dipakai = (p) => f.users.filter((u) => u.preset_id === p.id && u.status === "aktif").length;

    onMounted(async () => { await muatMaster(); try { await muat(); } catch (e) { f.galat = e.message; } });
    return { tab, f, m, buatPengurus, buatGuru, buatMod, ubah, akses, reset, terapkan, jadikanMod, labelUser, kelasLabel, tampil, aksesUtama, aksesPilihan, namaAkses,
      ed, sunting, batal, simpanPreset, hapusPreset, dipakai, samaPreset, negara };
  },
  template: `<div><span class="jejak">Fungsi › Akses</span><h1>Pengguna & Manajemen Akses</h1></div>
  <Pesan :galat="f.galat" :ok="f.ok"/>
  <SandiSementara v-if="f.sandi" :daftar="f.sandi" @tutup="f.sandi = null"/>
  <div class="tab"><button :class="{aktif: tab==='akun'}" @click="tab='akun'">Akun</button><button :class="{aktif: tab==='preset'}" @click="tab='preset'">Preset akses</button></div>

  <template v-if="tab==='akun'">
  <div class="dua-kolom">
    <div class="kartu" style="display:flex;flex-direction:column;gap:10px"><h2>Akun pengurus (santri)</h2><CariSantri v-model="f.santri"/>
      <label class="isian">Preset akses (opsional)<select v-model="f.presetSantri"><option value="">Tanpa akses dulu</option><option v-for="p in f.preset" :value="p.id">{{ p.nama }}</option></select></label>
      <button :disabled="!f.santri" @click="buatPengurus">Buat akun NIS@daarululuumlido.com</button></div>
    <div class="kartu" style="display:flex;flex-direction:column;gap:10px"><h2>Akun guru</h2>
      <label class="isian">Guru<select v-model="f.guru_id"><option value="">Pilih guru…</option><option v-for="g in m.guru" :value="g.id">{{ g.nama }} ({{ g.nip }})</option></select></label>
      <label class="isian">Preset akses<select v-model="f.presetGuru"><option value="">Tanpa akses dulu</option><option v-for="p in f.preset" :value="p.id">{{ p.nama }}</option></select></label>
      <button :disabled="!f.guru_id" @click="buatGuru">Buat akun guru</button>
      <h2 style="margin-top:8px">Moderator lain</h2><div class="baris"><input v-model="f.modNama" placeholder="Nama"><input v-model="f.modEmail" placeholder="email@daarululuumlido.com"><button class="kedua" @click="buatMod">Tambah</button></div></div>
  </div>
  <div class="dua-kolom">
    <div style="flex:1.3 1 420px;display:flex;flex-direction:column;gap:10px">
      <label class="isian">Cari akun<input v-model="f.q" placeholder="Nama, email, NIS, atau NIP"></label>
      <div class="tabel"><table><thead><tr><th>Nama</th><th>Akses</th><th>Status</th><th></th></tr></thead>
      <tbody><tr v-for="u in tampil" :key="u.id" :style="{background: f.sel && f.sel.id===u.id ? '#EEF5F1' : ''}">
        <td><strong>{{ u.nama }}</strong><div class="redup">{{ u.email }}</div></td>
        <td><span class="lencana" :class="kelasLabel(u)">{{ labelUser(u) }}</span></td>
        <td><span class="lencana" :class="{hijau: u.status==='aktif', merah: u.status!=='aktif'}">{{ u.status }}</span></td>
        <td><button class="kedua kecil" @click="f.sel = u">Kelola</button></td></tr></tbody></table></div></div>
    <div v-if="f.sel" class="kartu" style="display:flex;flex-direction:column;gap:12px">
      <h2>{{ f.sel.nama }}</h2><span class="redup">{{ f.sel.email }} · lingkungan {{ f.sel.lingkungan }}{{ f.sel.santri_id ? ' · akun santri' : f.sel.guru_id ? ' · akun guru' : '' }}</span>
      <div v-if="f.sel.role === 'moderator'" class="pesan info">Moderator memegang semua akses.
        <button v-if="f.sel.id !== negara.me.id" class="kedua kecil" style="margin-left:8px" @click="jadikanMod(f.sel, false)">Cabut Moderator</button></div>
      <template v-else>
        <div class="baris" style="align-items:flex-end">
          <label class="isian" style="flex:1 1 180px">Terapkan preset<select v-model="f.presetTerapkan"><option value="">Pilih preset…</option><option v-for="p in f.preset" :value="p.id">{{ p.nama }} ({{ p.akses.length }} akses)</option></select></label>
          <button class="kedua" :disabled="!f.presetTerapkan" @click="terapkan(f.sel)">Terapkan</button></div>
        <p class="redup" style="margin:0;font-size:12.5px">Preset disalin: akses akun diganti isi preset, lalu bisa diubah satu per satu di bawah.
          <template v-if="f.sel.preset"> Preset terakhir: <strong>{{ f.sel.preset }}</strong>{{ samaPreset(f.sel) ? '' : ' (sudah diubah)' }}.</template></p>
        <div><strong style="font-size:13px">Akses</strong>
          <label v-for="a in aksesUtama" :key="a.kode" style="display:flex;gap:10px;align-items:center;padding:5px 0;font-size:14px"><input type="checkbox" :checked="f.sel.akses.includes(a.kode)" @change="akses(f.sel, a.kode, $event.target.checked)"><span><strong>{{ a.nama }}</strong> <span class="redup">{{ a.keterangan }}</span></span></label>
          <details style="margin-top:6px"><summary style="cursor:pointer;font-size:13px"><strong>Edit daftar pilihan</strong> <span class="redup">({{ aksesPilihan.filter(a => f.sel.akses.includes(a.kode)).length }} dipilih)</span></summary>
            <label v-for="a in aksesPilihan" :key="a.kode" style="display:flex;gap:10px;align-items:center;padding:5px 0;font-size:14px"><input type="checkbox" :checked="f.sel.akses.includes(a.kode)" @change="akses(f.sel, a.kode, $event.target.checked)"><span>{{ a.nama }}</span></label></details></div>
      </template>
      <label class="isian" v-if="!f.sel.santri_id && f.sel.role !== 'moderator'">Lingkungan<select :value="f.sel.lingkungan" @change="ubah(f.sel, {lingkungan: $event.target.value})"><option>semua</option><option>putra</option><option>putri</option></select></label>
      <div class="baris"><button class="kedua" @click="ubah(f.sel, {status: f.sel.status==='aktif' ? 'nonaktif' : 'aktif'})">{{ f.sel.status==='aktif' ? 'Nonaktifkan' : 'Aktifkan' }}</button>
        <button v-if="f.sel.role !== 'moderator' && !f.sel.santri_id" class="kedua" @click="jadikanMod(f.sel, true)">Jadikan Moderator</button>
        <button v-if="f.sel.punya_password || f.sel.santri_id" class="bahaya" @click="reset(f.sel)">Reset password</button></div>
      <p v-if="f.sel.status === 'aktif'" class="redup" style="margin:0;font-size:12.5px">Menonaktifkan akun juga mencabut semua aksesnya.</p>
    </div>
  </div>
  </template>

  <template v-if="tab==='preset'">
    <p class="redup" style="margin:0">Preset adalah templat kumpulan akses. Saat diterapkan, aksesnya <strong>disalin</strong> ke akun; mengubah atau menghapus preset tidak mengubah akun yang sudah memakainya.</p>
    <div><button @click="sunting(null)">+ Preset baru</button></div>
    <div v-if="ed.id" class="kartu" style="display:flex;flex-direction:column;gap:10px">
      <h2>{{ ed.id === 'baru' ? 'Preset baru' : 'Ubah preset' }}</h2>
      <div class="baris"><label class="isian" style="flex:1 1 180px">Nama<input v-model="ed.nama" maxlength="60"></label><label class="isian" style="flex:2 1 260px">Keterangan<input v-model="ed.keterangan" maxlength="200"></label></div>
      <div><strong style="font-size:13px">Akses dalam preset ({{ ed.akses.length }})</strong>
        <label v-for="a in aksesUtama" :key="a.kode" style="display:flex;gap:10px;align-items:center;padding:5px 0;font-size:14px"><input type="checkbox" :value="a.kode" v-model="ed.akses"><span><strong>{{ a.nama }}</strong> <span class="redup">{{ a.keterangan }}</span></span></label>
        <details style="margin-top:6px"><summary style="cursor:pointer;font-size:13px"><strong>Edit daftar pilihan</strong></summary>
          <label v-for="a in aksesPilihan" :key="a.kode" style="display:flex;gap:10px;align-items:center;padding:5px 0;font-size:14px"><input type="checkbox" :value="a.kode" v-model="ed.akses"><span>{{ a.nama }}</span></label></details></div>
      <div class="baris"><button :disabled="!ed.nama.trim()" @click="simpanPreset">Simpan preset</button><button class="kedua" @click="batal">Batal</button></div>
    </div>
    <div class="kisi" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
      <div v-for="p in f.preset" :key="p.id" class="kartu" style="display:flex;flex-direction:column;gap:8px">
        <div class="baris" style="justify-content:space-between"><h2 style="margin:0">{{ p.nama }}</h2><span class="redup" style="font-size:12.5px">{{ dipakai(p) }} akun</span></div>
        <span v-if="p.keterangan" class="redup">{{ p.keterangan }}</span>
        <div><span v-for="k in p.akses" :key="k" class="lencana" style="margin:0 4px 4px 0">{{ namaAkses(k) }}</span><span v-if="!p.akses.length" class="redup">Belum ada akses</span></div>
        <div class="baris" style="margin-top:auto"><button class="kedua kecil" @click="sunting(p)">Ubah</button><button class="bahaya kecil" @click="hapusPreset(p)">Hapus</button></div>
      </div>
    </div>
  </template>`,
};

// ---------------------------------------------------------------- Riwayat
const Riwayat = {
  setup() {
    const d = ref([]), kat = ref(""), galat = ref("");
    const muat = async () => { try { d.value = await api("/riwayat" + (kat.value ? "?kategori=" + kat.value : "")); } catch (e) { galat.value = e.message; } };
    onMounted(muat); watch(kat, muat);
    return { d, kat, galat };
  },
  template: `<div><span class="jejak">Fungsi › Pemantauan</span><h1>Riwayat Perubahan</h1></div>
  <div class="tab"><button v-for="k in ['','data','kesantrian','jabatan','pilihan','akun','akses','pengaturan']" :class="{aktif: kat===k}" @click="kat=k">{{ k || 'Semua' }}</button></div>
  <div v-if="galat" class="pesan galat">{{ galat }}</div>
  <div class="tabel"><table><thead><tr><th>Waktu (UTC)</th><th>Oleh</th><th>Kategori</th><th>Aksi</th><th>Ringkasan</th></tr></thead>
    <tbody><tr v-for="r in d" :key="r.id"><td class="redup" style="white-space:nowrap">{{ r.waktu }}</td><td>{{ r.oleh || 'Sistem' }}</td><td><span class="lencana">{{ r.kategori }}</span></td><td>{{ r.aksi }}</td><td>{{ r.ringkasan }}</td></tr></tbody></table></div>`,
};

// ---------------------------------------------------------------- kerangka & router
// Halaman & menu. Modul Tahap 2/3 (public/modul/*.js) menambah lewat daftarHalaman() sebelum aplikasi dipasang.
// Alamat halaman tanpa parameter path; parameter memakai query, mis. #/rapor?santri=12 (baca dari negara.rute).
const HALAMAN = { "/": Beranda, "/absensi": Absensi, "/perizinan": Perizinan, "/data-master": DataMaster, "/pengguna": Pengguna, "/riwayat": Riwayat, "/ganti-password": GantiPassword };
const GRUP_MENU = ["Beranda", "Administrasi", "Fungsi"];
const MENU = [
  { jalur: "/", label: "Dashboard", grup: "Beranda", urutan: 1, syarat: () => true },
  { jalur: "/data-master", label: "Data Master", grup: "Administrasi", urutan: 10, syarat: (me) => me.moderator || me.akses.length > 0 },
  { jalur: "/absensi", label: "Absensi", grup: "Administrasi", urutan: 20, syarat: (me) => me.bisa.absensi || me.bisa.lihat_absensi },
  { jalur: "/perizinan", label: "Perizinan", grup: "Administrasi", urutan: 30, syarat: (me) => me.bisa.perizinan },
  { jalur: "/pengguna", label: "Pengguna & Akses", grup: "Fungsi", urutan: 70, syarat: (me) => me.role === "moderator" },
  { jalur: "/riwayat", label: "Riwayat Perubahan", grup: "Fungsi", urutan: 90, syarat: (me) => me.bisa.riwayat },
];
// komponen: objek Vue; menu: { label, grup, urutan, syarat(me) → boolean, ikon: isi <svg> 24×24 garis } atau null (tanpa menu)
function daftarHalaman(jalur, komponen, menu) {
  HALAMAN[jalur] = komponen;
  if (menu) { MENU.push({ jalur, ...menu }); if (menu.ikon) IKON[jalur] = menu.ikon; }
}
window.daftarHalaman = daftarHalaman;

// ---------------------------------------------------------------- lonceng notifikasi & detail akun (kerangka)
// Tugas sesuai akses dihitung server tiap muat; notifikasi tersimpan (pengumuman, akun, kabar santri binaan) punya tanda dibaca.
const notif = reactive({ data: { tugas: [], daftar: [], belum_dibaca: 0 }, buka: false, akun: false });
const muatNotif = async () => { if (negara.me && !negara.me.wajib_ganti_password) notif.data = await api("/notifikasi").catch(() => notif.data); };
const waktuLalu = (t) => {
  if (!t) return "";
  const ms = Date.now() - Date.parse(t.replace(" ", "T") + (t.length === 16 ? ":00+07:00" : "Z"));
  const m = Math.round(ms / 60e3);
  if (m < 1) return "baru saja"; if (m < 60) return m + " menit lalu";
  const j = Math.round(m / 60); if (j < 24) return j + " jam lalu";
  const h = Math.round(j / 24); return h < 30 ? h + " hari lalu" : t.slice(0, 10);
};
const LABEL_JENIS_NOTIF = { pengumuman: "Pengumuman", akun: "Akun", santri: "Santri binaan" };
async function bukaNotif(n) {
  if (!n.dibaca_at) { n.dibaca_at = "kini"; notif.data.belum_dibaca = Math.max(0, notif.data.belum_dibaca - 1); api("/notifikasi/baca", { id: n.id }).catch(() => {}); }
  notif.buka = false;
  if (n.tautan === "/akun") notif.akun = true; else if (n.tautan) pergi(n.tautan);
}
async function bacaSemua() { await api("/notifikasi/baca", {}).catch(() => {}); await muatNotif(); }

const Lonceng = {
  props: { terang: Boolean },
  setup() {
    const jumlah = computed(() => notif.data.belum_dibaca + notif.data.tugas.length);
    const panel = ref(null);
    watch(() => notif.buka, (b) => { if (b) { muatNotif(); nextTick(() => panel.value && panel.value.focus()); } });
    return { notif, jumlah, panel, waktuLalu, bukaNotif, bacaSemua, LABEL_JENIS_NOTIF, pergi };
  },
  template: `<button class="lonceng" :class="{terang}" type="button" :aria-label="'Notifikasi' + (jumlah ? ', ' + jumlah + ' baru' : '')" :aria-expanded="notif.buka" @click="notif.buka = !notif.buka">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
      <span v-if="jumlah" class="badge">{{ jumlah > 99 ? '99+' : jumlah }}</span></button>
    <teleport to="body"><template v-if="notif.buka">
      <div class="tirai-notif" @click="notif.buka = false"></div>
      <aside class="laci-notif" ref="panel" tabindex="-1" role="dialog" aria-label="Notifikasi" @keydown.esc="notif.buka = false">
        <header><h2>Notifikasi</h2><button v-if="notif.data.belum_dibaca" class="kedua kecil" @click="bacaSemua">Tandai semua dibaca</button>
          <button class="kedua kecil" aria-label="Tutup" @click="notif.buka = false">✕</button></header>
        <section v-if="notif.data.tugas.length"><h3>Perlu ditindaklanjuti</h3>
          <div v-for="t in notif.data.tugas" :key="t.kunci" class="notif-item tugas">
            <a :href="'#' + t.tautan" @click="notif.buka = false"><strong>{{ t.judul }}</strong><span>{{ t.isi }}</span></a>
            <ul v-if="t.rinci" class="notif-rinci"><li v-for="r in t.rinci.slice(0, 3)" :key="r.tanggal"><a :href="'#' + r.tautan" @click="notif.buka = false">{{ r.label }}</a> — {{ r.kamar }} kamar · {{ r.sesi }} sesi</li>
              <li v-if="t.rinci.length > 3"><a href="#/notifikasi" @click="notif.buka = false">Lihat selengkapnya ({{ t.rinci.length }} hari)</a></li></ul>
          </div></section>
        <section><h3>Terbaru</h3>
          <button v-for="n in notif.data.daftar.slice(0, 8)" :key="n.id" type="button" class="notif-item" :class="{baru: !n.dibaca_at}" @click="bukaNotif(n)">
            <span class="titik" aria-hidden="true"></span><span style="flex:1;min-width:0"><strong>{{ n.judul }}</strong><span v-if="n.isi" class="potong">{{ n.isi }}</span>
            <small>{{ LABEL_JENIS_NOTIF[n.jenis] }} · {{ waktuLalu(n.dibuat_at) }}</small></span></button>
          <p v-if="!notif.data.daftar.length" class="redup" style="padding:6px 2px">Belum ada notifikasi.</p></section>
        <footer><a href="#/notifikasi" @click="notif.buka = false">Lihat semua notifikasi</a></footer>
      </aside></template></teleport>`,
};

// Detail akun: foto dari database foto santri (bila ada), selain itu inisial.
const DetailAkun = {
  components: { FotoSantri, Pesan },
  props: { modal: Boolean },
  emits: ["tutup"],
  setup(props, { emit }) {
    const d = ref(null), galat = ref("");
    onMounted(async () => { try { d.value = await api("/akun-saya"); } catch (e) { galat.value = e.message; } });
    const LING = { putra: "Putra", putri: "Putri", semua: "Putra & Putri" };
    const PERAN = { wali: "Wali kelas", asisten: "Asisten", wali_asuh: "Wali asuh" };
    async function keluar() { await api("/logout", {}).catch(() => {}); negara.me = null; emit("tutup"); pergi("/masuk"); }
    return { d, galat, LING, PERAN, keluar, waktuLalu, inisial };
  },
  template: `<div :class="modal ? 'foto-lihat' : ''" :style="modal ? 'cursor:default' : ''" @click.self="$emit('tutup')" :role="modal ? 'dialog' : null" aria-label="Detail akun">
    <div class="kartu akun-detail" @keydown.esc="$emit('tutup')">
      <Pesan :galat="galat"/>
      <div v-if="!d && !galat" class="muat">Memuat…</div>
      <template v-if="d">
        <div class="akun-kepala">
          <FotoSantri v-if="d.foto_url" :s="{ nama: d.nama, foto_url: d.foto_url }" ukuran="besar" class="foto-akun"/>
          <span v-else class="foto foto-akun inisial" aria-hidden="true">{{ inisial(d.nama) }}</span>
          <div style="min-width:0"><h2 style="margin:0">{{ d.nama }}</h2><div class="redup">{{ d.email }}</div>
            <div class="baris" style="margin-top:6px;gap:6px"><span class="lencana hijau">{{ d.moderator ? 'Moderator' : d.preset || (d.akses.length ? 'Akses manual' : 'Belum ada akses') }}</span><span class="lencana">{{ LING[d.lingkungan] }}</span>
              <span v-if="d.status !== 'aktif'" class="lencana merah">{{ d.status }}</span></div></div>
          <button v-if="modal" class="kedua kecil" style="margin-left:auto;align-self:flex-start" aria-label="Tutup" @click="$emit('tutup')">✕</button>
        </div>
        <dl class="akun-isi">
          <template v-if="d.santri"><dt>NIS</dt><dd>{{ d.santri.nis }}</dd><dt>Kelas</dt><dd>{{ d.santri.kelas || '—' }}</dd><dt>Kamar</dt><dd>{{ d.santri.kamar || '—' }}</dd>
            <dt>Jabatan</dt><dd><template v-if="d.jabatan.length"><div v-for="j in d.jabatan">{{ j.nama }} <span class="redup">· {{ j.masa }}</span></div></template><span v-else class="redup">—</span></dd></template>
          <template v-if="d.guru"><dt>NIP</dt><dd>{{ d.guru.nip }}</dd>
            <dt>Wali kelas</dt><dd><template v-if="d.wali_kelas.length"><div v-for="k in d.wali_kelas">{{ k.nama }} <span class="redup">· {{ PERAN[k.peran] }}</span></div></template><span v-else class="redup">—</span></dd>
            <dt>Wali asuh</dt><dd><template v-if="d.wali_asuh.length"><div v-for="k in d.wali_asuh">{{ k.nama }} <span class="redup">· {{ PERAN[k.peran] }}</span></div></template><span v-else class="redup">—</span></dd></template>
          <dt>Akses</dt><dd><span v-if="d.moderator" class="lencana hijau">Semua akses</span>
            <template v-else><span v-for="a in d.akses" class="lencana" style="margin:0 4px 4px 0" :title="'Diberikan ' + a.diberikan_at">{{ a.nama }}</span>
            <span v-if="!d.akses.length" class="redup">Belum ada akses — hubungi Moderator.</span>
            <div v-if="d.preset" class="redup" style="font-size:12px;margin-top:2px">Dari preset {{ d.preset }}; akses bisa disesuaikan Moderator per akun.</div></template></dd>
          <dt>Login terakhir</dt><dd>{{ d.login_terakhir ? waktuLalu(d.login_terakhir) : '—' }} <span class="redup">· {{ d.sesi_aktif }} sesi aktif</span></dd>
          <dt>Akun dibuat</dt><dd>{{ d.dibuat_at ? d.dibuat_at.slice(0, 10) : '—' }}</dd>
        </dl>
        <div class="baris"><a class="tombol kedua" href="#/ganti-password" @click="$emit('tutup')">{{ d.punya_password ? 'Ganti password' : 'Buat password' }}</a>
          <a class="tombol kedua" href="#/notifikasi" @click="$emit('tutup')">Notifikasi</a>
          <button class="bahaya" style="margin-left:auto" @click="keluar">Keluar</button></div>
      </template>
    </div></div>`,
};

const App = {
  components: { Masuk, GatePass, Lonceng, DetailAkun },
  setup() {
    const jalur = computed(() => negara.rute.split("?")[0]);
    const halaman = computed(() => HALAMAN[jalur.value] || Beranda);
    const menu = computed(() => {
      const me = negara.me; if (!me) return [];
      return GRUP_MENU.map((g) => [g, MENU.filter((m) => m.grup === g && m.syarat(me)).sort((a, b) => a.urutan - b.urutan).map((m) => [m.jalur, m.label])])
        .filter(([, i]) => i.length);
    });
    // badge sidebar + lonceng: tiap menit selama tab terlihat; pindah halaman memuat ulang bila data > 15 detik.
    // Tab tersembunyi tidak memuat (hemat baca D1); saat tab dilihat lagi langsung diperbarui bila sudah lewat 1 menit.
    const lencana = ref({});
    let terakhirLencana = 0;
    const muatLencana = async (umur = 0) => {
      if (document.hidden || !negara.me || negara.me.wajib_ganti_password || Date.now() - terakhirLencana < umur) return;
      terakhirLencana = Date.now();
      lencana.value = await api("/lencana").catch(() => ({})); muatNotif();
    };
    watch(() => negara.rute, () => muatLencana(15e3));
    watch(() => !!negara.me, () => muatLencana(), { immediate: true });
    setInterval(() => muatLencana(55e3), 60e3);
    document.addEventListener("visibilitychange", () => muatLencana(60e3));
    async function keluar() { await api("/logout", {}); negara.me = null; pergi("/masuk"); }
    // menu laci (HP/tablet): tertutup saat pindah halaman atau tekan Esc
    const laci = ref(false);
    watch(jalur, () => { laci.value = false; });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") { laci.value = false; negara.fotoBesar = null; notif.buka = false; notif.akun = false; } });
    watch(jalur, () => { notif.buka = false; notif.akun = false; });
    // animasi isi halaman setiap pindah halaman
    const isi = ref(null);
    watch(() => [jalur.value, !!negara.me], () => nextTick(() => gerak.masuk(isi.value)), { immediate: true });
    const ling = computed(() => negara.me && (negara.me.lingkungan === "semua" ? "Putra & Putri" : negara.me.lingkungan === "putra" ? "Putra" : "Putri"));
    return { negara, jalur, halaman, menu, keluar, labelAkun, laci, isi, ling, IKON, inisial, lencana, notif, fotoKecil };
  },
  template: `
  <Masuk v-if="jalur === '/masuk' || !negara.me"/>
  <div v-else-if="jalur.startsWith('/gatepass/')" class="isi"><GatePass/></div>
  <div v-else class="tata">
    <header class="bar-atas">
      <img src="/img/logo-hisada-64.png" alt="" width="34" height="34"><strong>HISADA</strong>
      <Lonceng terang/>
      <button class="tombol-menu" :aria-expanded="laci" aria-controls="menu-utama" aria-label="Buka menu" @click="laci = !laci"><span></span><span></span><span></span></button>
    </header>
    <div class="tirai" :class="{terbuka: laci}" @click="laci = false"></div>
    <nav id="menu-utama" class="samping" :class="{terbuka: laci}" aria-label="Menu utama">
      <div class="merek"><a href="#/" class="merek-tautan"><img src="/img/logo-hisada-64.png" alt="" width="46" height="46"><span><strong>HISADA</strong><small>{{ ling }}</small></span></a><Lonceng class="hanya-lebar"/></div>
      <div class="grup-menu" v-for="[g, items] in menu" :key="g"><span class="judul">{{ g }}</span>
        <a v-for="i in items" :key="i[0]" :href="'#' + i[0]" :class="{aktif: jalur === i[0]}" :aria-current="jalur === i[0] ? 'page' : null">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="IKON[i[0]] || IKON['/']"></svg><span style="flex:1">{{ i[1] }}</span>
          <span v-if="lencana[i[0]]" class="badge" :aria-label="lencana[i[0]] + ' perlu tindakan'">{{ lencana[i[0]] }}</span></a></div>
      <div class="akun"><button type="button" class="akun-tombol" aria-haspopup="dialog" @click="notif.akun = true; laci = false" title="Lihat detail akun">
          <img v-if="negara.me.foto_url" class="inisial" :src="fotoKecil(negara.me.foto_url, 96)" alt="" referrerpolicy="no-referrer" @error="negara.me.foto_url = null">
          <span v-else class="inisial" aria-hidden="true">{{ inisial(negara.me.nama) }}</span>
          <span style="min-width:0;text-align:left"><strong>{{ negara.me.nama }}</strong><span>{{ labelAkun(negara.me) }}</span></span></button>
        <div class="akun-tautan"><a href="#/ganti-password">Ganti password</a><a href="#" @click.prevent="keluar">Keluar</a></div></div>
    </nav>
    <main class="isi" ref="isi"><component :is="halaman" :key="jalur"/></main>
  </div>
  <DetailAkun v-if="notif.akun && negara.me" modal @tutup="notif.akun = false"/>
  <figure v-if="negara.fotoBesar" class="foto-lihat" @click="negara.fotoBesar = null" role="dialog" aria-label="Foto santri">
    <div><img :src="negara.fotoBesar.url" :alt="'Foto ' + negara.fotoBesar.nama" referrerpolicy="no-referrer"><figcaption>{{ negara.fotoBesar.nama }}</figcaption></div>
  </figure>`,
};

async function mulai() {
  negara.status = await api("/status").catch(() => null);
  try { negara.me = await api("/me"); } catch { negara.me = null; }
}

window.addEventListener("hashchange", () => { negara.rute = location.hash.slice(1) || "/"; });
// Dipasang setelah semua skrip modul (public/modul/*.js) selesai mendaftarkan halamannya.
document.addEventListener("DOMContentLoaded", async () => {
  negara.rute = location.hash.slice(1) || "/";
  await mulai();
  if (negara.me && negara.me.wajib_ganti_password) pergi("/ganti-password");
  createApp(App).mount("#app");
});
