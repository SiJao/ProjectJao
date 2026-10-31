// HISADA — Portal Wali Santri (Vue 3 tanpa build tool). Berbicara dengan /api/wali/* (sesi sendiri, terpisah dari akun pengurus).
const { createApp, reactive, ref, computed, onMounted, watch, nextTick } = Vue;

const negara = reactive({ rute: "", saya: null, siap: false });
const pergi = (h) => { if (location.hash !== "#" + h) location.hash = h; };
const jalur = () => negara.rute.split("?")[0];
const param = (k) => new URLSearchParams(negara.rute.split("?")[1] || "").get(k);
async function api(path, data) {
  const opsi = data === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) };
  const r = await fetch("/api/wali" + path, { credentials: "same-origin", ...opsi });
  const isi = await r.json().catch(() => ({}));
  if (r.status === 401 && negara.saya) { negara.saya = null; pergi("/masuk"); }
  if (!r.ok) throw new Error(isi.galat || "Gagal (" + r.status + ")");
  return isi;
}
async function muatSaya() { try { negara.saya = await api("/saya"); } catch { negara.saya = null; } return negara.saya; }

// animasi ringan; mati bila "kurangi gerakan" aktif
const A = window.anime;
const GERAK = !!A && !matchMedia("(prefers-reduced-motion: reduce)").matches;
const masuk = (el) => { if (GERAK && el) A.animate([...el.children].slice(0, 12), { opacity: [0, 1], y: [14, 0], duration: 600, delay: A.stagger(50), ease: "outExpo" }); };
const inisial = (nama) => String(nama || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const UKURAN_BESAR = /\/h_2048(?=[,/])/;
const fotoKecil = (url, h) => (url && UKURAN_BESAR.test(url) ? url.replace(UKURAN_BESAR, "/h_" + h) : url);

const Pesan = { props: ["galat", "ok"], template: `<div v-if="galat" class="pesan galat" role="alert">{{ galat }}</div><div v-if="ok" class="pesan ok" role="status">{{ ok }}</div>` };
const Foto = {
  props: { s: Object, besar: Boolean },
  setup(props) { const gagal = ref(false); watch(() => props.s && props.s.foto_url, () => { gagal.value = false; }); return { gagal, fotoKecil, inisial }; },
  template: `<img v-if="s && s.foto_url && !gagal" class="foto-anak" :class="{besar}" :src="fotoKecil(s.foto_url, besar ? 320 : 160)" :alt="'Foto ' + s.nama" referrerpolicy="no-referrer" loading="lazy" @error="gagal = true">
    <span v-else class="foto-anak" :class="{besar}" aria-hidden="true">{{ inisial(s && s.nama) }}</span>`,
};

// ---------------------------------------------------------------- halaman tamu (masuk, daftar, verifikasi, lupa, reset)
const Bingkai = {
  props: { judul: String },
  setup() { const kartu = ref(null); onMounted(() => { if (GERAK) A.animate(kartu.value, { opacity: [0, 1], y: [18, 0], duration: 700, ease: "outExpo" }); }); return { kartu }; },
  template: `<div class="masuk">
    <section class="masuk-merek"><img src="/img/logo-hisada-256.png" alt="Logo HISADA" width="230" height="230"><h1>HISADA</h1><span class="garis-emas"></span>
      <p>Portal Wali Santri<br>Pesantren Modern Daarul 'Uluum Lido</p></section>
    <div class="masuk-form"><div class="kartu" ref="kartu"><h2>{{ judul }}</h2><slot></slot></div></div></div>`,
};

const Masuk = {
  components: { Bingkai, Pesan },
  setup() {
    const f = reactive({ email: "", password: "", galat: "", ok: "", sibuk: false, belum: false });
    async function kirim() {
      f.sibuk = true; f.galat = ""; f.ok = ""; f.belum = false;
      try { await api("/masuk", { email: f.email, password: f.password }); await muatSaya(); pergi("/anak"); }
      catch (e) { f.galat = e.message; f.belum = /belum diverifikasi/i.test(e.message); } finally { f.sibuk = false; }
    }
    async function kirimUlang() { try { const r = await api("/kirim-verifikasi", { email: f.email }); f.ok = r.pesan; f.galat = ""; } catch (e) { f.galat = e.message; } }
    return { f, kirim, kirimUlang };
  },
  template: `<Bingkai judul="Masuk Portal Wali">
    <form @submit.prevent="kirim" style="display:flex;flex-direction:column;gap:12px">
      <label class="isian">Email<input type="email" v-model="f.email" autocomplete="username" required></label>
      <label class="isian">Password<input type="password" v-model="f.password" autocomplete="current-password" required></label>
      <button :disabled="f.sibuk">{{ f.sibuk ? 'Memeriksa…' : 'Masuk' }}</button>
    </form>
    <Pesan :galat="f.galat" :ok="f.ok"/>
    <button v-if="f.belum" class="kedua" @click="kirimUlang">Kirim ulang tautan verifikasi</button>
    <p class="redup" style="margin:0"><a href="#/lupa">Lupa password?</a> · Belum punya akun? <a href="#/daftar">Daftar</a></p>
  </Bingkai>`,
};

const Daftar = {
  components: { Bingkai, Pesan },
  setup() {
    const f = reactive({ nama: "", email: "", no_hp: "", password: "", ulang: "", setuju: false, galat: "", ok: "", sibuk: false, selesai: false });
    async function kirim() {
      f.galat = "";
      if (f.password !== f.ulang) { f.galat = "Password dan ulangannya tidak sama."; return; }
      f.sibuk = true;
      try { const r = await api("/daftar", { nama: f.nama, email: f.email, no_hp: f.no_hp, password: f.password, setuju: f.setuju }); f.ok = r.pesan; f.selesai = true; }
      catch (e) { f.galat = e.message; } finally { f.sibuk = false; }
    }
    return { f, kirim };
  },
  template: `<Bingkai judul="Daftar akun wali">
    <template v-if="!f.selesai">
      <form @submit.prevent="kirim" style="display:flex;flex-direction:column;gap:12px">
        <label class="isian">Nama lengkap<input v-model="f.nama" autocomplete="name" maxlength="120" required></label>
        <label class="isian">Email<input type="email" v-model="f.email" autocomplete="email" required></label>
        <label class="isian">No. HP / WhatsApp<input v-model="f.no_hp" inputmode="tel" autocomplete="tel" placeholder="08…" required>
          <span class="redup" style="font-weight:400">Gunakan nomor yang terdaftar di sekretariat pondok — nomor ini dipakai untuk menautkan anak Anda.</span></label>
        <label class="isian">Password (min. 8 karakter)<input type="password" v-model="f.password" autocomplete="new-password" minlength="8" required></label>
        <label class="isian">Ulangi password<input type="password" v-model="f.ulang" autocomplete="new-password" required></label>
        <label style="display:flex;gap:10px;align-items:flex-start;font-size:13px"><input type="checkbox" v-model="f.setuju" style="flex:none;margin-top:2px">
          <span>Saya menyetujui Pesantren Modern Daarul 'Uluum Lido menyimpan dan menggunakan nama, email, dan No. HP saya untuk mencocokkan akun ini dengan data santri,
          menampilkan data anak saya di portal ini, dan mengirim kabar tentang anak saya lewat email. Data tidak dibagikan kepada pihak lain;
          saya dapat meminta penghapusan akun kepada pondok.</span></label>
        <button :disabled="f.sibuk || !f.setuju">{{ f.sibuk ? 'Mengirim…' : 'Daftar' }}</button>
      </form>
      <Pesan :galat="f.galat"/>
    </template>
    <template v-else><Pesan :ok="f.ok"/><p class="redup" style="margin:0">Buka tautan verifikasi di email Anda (berlaku 24 jam), lalu masuk.</p></template>
    <p class="redup" style="margin:0">Sudah punya akun? <a href="#/masuk">Masuk</a></p>
  </Bingkai>`,
};

const Verifikasi = {
  components: { Bingkai, Pesan },
  setup() {
    const f = reactive({ galat: "", ok: "", email: "", ulangOk: "" });
    onMounted(async () => {
      const t = param("token");
      if (!t) { f.galat = "Tautan verifikasi tidak lengkap."; return; }
      try { await api("/verifikasi", { token: t }); f.ok = "Email terverifikasi. Silakan masuk."; } catch (e) { f.galat = e.message; }
    });
    async function kirimUlang() { try { f.ulangOk = (await api("/kirim-verifikasi", { email: f.email })).pesan; } catch (e) { f.galat = e.message; } }
    return { f, kirimUlang };
  },
  template: `<Bingkai judul="Verifikasi email">
    <Pesan :galat="f.galat" :ok="f.ok"/>
    <a v-if="f.ok" class="tombol" href="#/masuk">Masuk</a>
    <form v-if="f.galat" @submit.prevent="kirimUlang" style="display:flex;flex-direction:column;gap:10px">
      <label class="isian">Kirim tautan baru ke email<input type="email" v-model="f.email" required></label><button class="kedua">Kirim ulang</button>
      <Pesan :ok="f.ulangOk"/></form>
  </Bingkai>`,
};

const Lupa = {
  components: { Bingkai, Pesan },
  setup() {
    const f = reactive({ email: "", galat: "", ok: "", sibuk: false });
    async function kirim() { f.sibuk = true; f.galat = ""; try { f.ok = (await api("/lupa", { email: f.email })).pesan; } catch (e) { f.galat = e.message; } finally { f.sibuk = false; } }
    return { f, kirim };
  },
  template: `<Bingkai judul="Lupa password">
    <form @submit.prevent="kirim" style="display:flex;flex-direction:column;gap:12px">
      <label class="isian">Email akun wali<input type="email" v-model="f.email" autocomplete="email" required></label>
      <button :disabled="f.sibuk">Kirim tautan atur ulang</button></form>
    <Pesan :galat="f.galat" :ok="f.ok"/>
    <p class="redup" style="margin:0">Tautan berlaku 1 jam. <a href="#/masuk">Kembali ke Masuk</a></p>
  </Bingkai>`,
};

const Reset = {
  components: { Bingkai, Pesan },
  setup() {
    const f = reactive({ password: "", ulang: "", galat: "", ok: "", sibuk: false });
    async function kirim() {
      f.galat = "";
      if (f.password !== f.ulang) { f.galat = "Password dan ulangannya tidak sama."; return; }
      f.sibuk = true;
      try { await api("/reset", { token: param("token"), password: f.password }); f.ok = "Password diganti. Silakan masuk."; } catch (e) { f.galat = e.message; } finally { f.sibuk = false; }
    }
    return { f, kirim };
  },
  template: `<Bingkai judul="Atur ulang password">
    <form v-if="!f.ok" @submit.prevent="kirim" style="display:flex;flex-direction:column;gap:12px">
      <label class="isian">Password baru (min. 8)<input type="password" v-model="f.password" autocomplete="new-password" minlength="8" required></label>
      <label class="isian">Ulangi password baru<input type="password" v-model="f.ulang" autocomplete="new-password" required></label>
      <button :disabled="f.sibuk">Simpan password</button></form>
    <Pesan :galat="f.galat" :ok="f.ok"/>
    <a v-if="f.ok" class="tombol" href="#/masuk">Masuk</a>
  </Bingkai>`,
};

// ---------------------------------------------------------------- setelah masuk: daftar anak + tautkan, detail anak
const Anak = {
  components: { Pesan, Foto },
  setup() {
    const f = reactive({ nis: "", tanggal_lahir: "", galat: "", ok: "", sibuk: false, kabar: [], buka: null });
    const isi = ref(null);
    async function tautkan() {
      f.sibuk = true; f.galat = ""; f.ok = "";
      try { const r = await api("/tautkan", { nis: f.nis, tanggal_lahir: f.tanggal_lahir }); f.ok = r.sudah ? "Anak ini sudah tertaut ke akun Anda." : `${r.santri} berhasil ditautkan.`; f.nis = ""; f.tanggal_lahir = ""; await muatSaya(); }
      catch (e) { f.galat = e.message; await muatSaya(); } finally { f.sibuk = false; }
    }
    onMounted(async () => { nextTick(() => masuk(isi.value)); try { f.kabar = await api("/kabar"); } catch {} });
    return { f, negara, tautkan, isi };
  },
  template: `<div ref="isi" style="display:flex;flex-direction:column;gap:16px">
    <div><span class="jejak">Portal Wali Santri</span><h1>Assalamu'alaikum, {{ negara.saya.nama }}</h1></div>
    <a v-for="s in negara.saya.anak" :key="s.id" class="kartu anak-kartu" :href="'#/anak?id=' + s.id"><Foto :s="s"/>
      <span style="flex:1"><strong>{{ s.nama }}</strong><div class="redup">NIS {{ s.nis }} · {{ s.kelas || '—' }} · {{ s.kamar || '—' }}</div></span><span aria-hidden="true">›</span></a>
    <div class="kartu" style="display:flex;flex-direction:column;gap:12px">
      <h2>{{ negara.saya.anak.length ? 'Tautkan anak lain' : 'Tautkan anak Anda' }}</h2>
      <p class="redup" style="margin:0">Masukkan NIS dan tanggal lahir anak. Data dicocokkan dengan No. HP akun Anda ({{ negara.saya.no_hp || '—' }}) di catatan sekretariat pondok.</p>
      <p v-if="negara.saya.terkunci_tautan_sampai" class="pesan galat" style="margin:0">Penautan dikunci sampai {{ negara.saya.terkunci_tautan_sampai }} WIB karena terlalu banyak percobaan gagal. Hubungi pondok bila perlu bantuan.</p>
      <form v-else @submit.prevent="tautkan" class="baris">
        <label class="isian" style="flex:1 1 140px">NIS<input v-model="f.nis" inputmode="numeric" required></label>
        <label class="isian" style="flex:1 1 160px">Tanggal lahir anak<input type="date" v-model="f.tanggal_lahir" required></label>
        <button :disabled="f.sibuk">Tautkan</button></form>
      <Pesan :galat="f.galat" :ok="f.ok"/>
    </div>
    <div class="kartu" style="display:flex;flex-direction:column;gap:8px">
      <h2>Kabar dari pondok</h2>
      <p v-if="!f.kabar.length" class="redup" style="margin:0">Belum ada kabar.</p>
      <div class="daftar-kecil"><div v-for="k in f.kabar" :key="k.id" style="flex-direction:column">
        <a href="#" @click.prevent="f.buka = f.buka === k.id ? null : k.id"><strong>{{ k.subjek.replace('[HISADA] ', '') }}</strong></a>
        <span class="redup">{{ k.dibuat_at }} UTC{{ k.koreksi_dari_id ? ' · ralat' : '' }}</span>
        <pre v-if="f.buka === k.id" style="white-space:pre-wrap;font:inherit;margin:4px 0 0">{{ k.isi }}</pre></div></div>
    </div>
  </div>`,
};

const DetailAnak = {
  components: { Pesan, Foto },
  setup() {
    const d = ref(null), galat = ref(""), isi = ref(null);
    onMounted(async () => {
      try { d.value = await api("/anak/" + encodeURIComponent(param("id"))); } catch (e) { galat.value = e.message; }
      nextTick(() => masuk(isi.value));
    });
    const fmt = (s, b) => !s ? "" : b === "jam" ? s.slice(11) : b === "tanggal" ? s.slice(0, 10) : s;
    const lencana = (k) => ({ berjalan: "biru", terlambat: "kuning", overdue: "merah", kembali: "hijau" }[k] || "");
    const LABEL = { berjalan: "sedang izin", terlambat: "terlambat", overdue: "belum kembali", kembali: "sudah kembali" };
    const izinKini = computed(() => (d.value ? d.value.izin.filter((z) => ["berjalan", "overdue"].includes(z.status)) : []));
    return { d, galat, isi, fmt, lencana, LABEL, izinKini };
  },
  template: `<div ref="isi" style="display:flex;flex-direction:column;gap:16px">
    <a href="#/anak" class="redup">‹ Kembali</a>
    <Pesan :galat="galat"/>
    <template v-if="d">
      <div class="kartu anak-kartu" style="align-items:flex-start"><Foto :s="d.santri" besar/>
        <div style="display:flex;flex-direction:column;gap:4px"><h1 style="font-size:22px">{{ d.santri.nama }}</h1><span class="redup">NIS {{ d.santri.nis }}</span>
          <span><strong>Kelas</strong> {{ d.santri.kelas || '—' }}</span><span><strong>Kamar</strong> {{ d.santri.kamar || '—' }}</span></div></div>

      <div class="kartu" style="display:flex;flex-direction:column;gap:8px"><h2>Perizinan</h2>
        <div v-if="izinKini.length" class="pesan info"><div v-for="z in izinKini" :key="z.id"><strong>Sedang {{ z.jenis }}</strong> — kembali paling lambat {{ fmt(z.rencana_kembali, 'tanggal_jam') }} WIB
          <span class="lencana" :class="lencana(z.keadaan)">{{ LABEL[z.keadaan] }}</span></div></div>
        <p class="redup" style="margin:0">90 hari terakhir</p>
        <p v-if="!d.izin.length" class="redup" style="margin:0">Tidak ada izin.</p>
        <div class="daftar-kecil"><div v-for="z in d.izin" :key="z.id"><span><strong>{{ z.jenis }}</strong> <span class="redup">{{ z.keterangan }}</span><br>
          <span class="redup">{{ fmt(z.berangkat, z.basis_waktu) }} → {{ z.kembali_at || fmt(z.rencana_kembali, z.basis_waktu) }}</span></span>
          <span class="lencana" :class="lencana(z.keadaan)">{{ LABEL[z.keadaan] || z.keadaan }}{{ z.overdue_dikoreksi_at ? ' (dikoreksi)' : '' }}</span></div></div></div>

      <div class="kartu" style="display:flex;flex-direction:column;gap:8px"><h2>Kehadiran 30 hari</h2>
        <p v-if="!d.absensi_30_hari.length" class="redup" style="margin:0">Belum ada catatan absensi.</p>
        <div class="rekap"><span v-for="a in d.absensi_30_hari" :key="a.kode" class="lencana" :style="{color: a.warna, background: '#fff', border: '1px solid ' + a.warna}">{{ a.nama }}: {{ a.n }}</span></div></div>

      <div class="kartu" style="display:flex;flex-direction:column;gap:8px"><h2>Kesehatan</h2>
        <div><span class="lencana" :class="d.kesehatan.sedang_dirawat ? 'kuning' : 'hijau'">{{ d.kesehatan.sedang_dirawat ? 'Sedang dirawat di pondok' : 'Tidak sedang dirawat' }}</span></div>
        <p class="redup" style="margin:0">Kunjungan ke klinik pondok (90 hari). Rincian kesehatan disampaikan langsung oleh pondok.</p>
        <div class="daftar-kecil"><div v-for="(k, i) in d.kesehatan.kunjungan" :key="i"><span>{{ k.tanggal }}</span><span class="redup">{{ k.dirawat ? 'dirawat' + (k.selesai ? ' s.d. ' + k.selesai : '') : 'rawat jalan' }}</span></div></div>
        <p v-if="!d.kesehatan.kunjungan.length" class="redup" style="margin:0">Tidak ada kunjungan.</p></div>

      <div class="kartu" style="display:flex;flex-direction:column;gap:8px"><h2>Kedisiplinan</h2>
        <p v-if="!d.kedisiplinan.length" class="redup" style="margin:0">Tidak ada catatan.</p>
        <div class="daftar-kecil"><div v-for="(p, i) in d.kedisiplinan" :key="i"><span>{{ p.tanggal }} · {{ p.kategori }}</span><span class="lencana">{{ p.tingkat }}</span></div></div></div>

      <div class="kartu" style="display:flex;flex-direction:column;gap:8px"><h2>Prestasi</h2>
        <p v-if="!d.prestasi.length" class="redup" style="margin:0">Belum ada prestasi tercatat.</p>
        <div class="daftar-kecil"><div v-for="(p, i) in d.prestasi" :key="i"><span><strong>{{ p.nama_kegiatan }}</strong><br><span class="redup">{{ p.tanggal }}{{ p.lokasi ? ' · ' + p.lokasi : '' }}</span></span>
          <span><span v-if="p.hasil" class="lencana hijau">{{ p.hasil }}</span> <span v-if="p.tingkat" class="lencana">{{ p.tingkat }}</span></span></div></div></div>
    </template>
  </div>`,
};

// ---------------------------------------------------------------- kerangka & router
const App = {
  components: { Masuk, Daftar, Verifikasi, Lupa, Reset, Anak, DetailAnak },
  setup() {
    const TAMU = { "/masuk": "Masuk", "/daftar": "Daftar", "/verifikasi": "Verifikasi", "/lupa": "Lupa", "/reset": "Reset" };
    const halaman = computed(() => {
      const j = jalur();
      if (TAMU[j]) return TAMU[j];
      if (!negara.saya) return "Masuk";
      return j === "/anak" && param("id") ? "DetailAnak" : "Anak";
    });
    async function keluar() { await api("/keluar", {}).catch(() => {}); negara.saya = null; pergi("/masuk"); }
    return { negara, halaman, keluar };
  },
  template: `<template v-if="negara.siap">
    <component v-if="['Masuk','Daftar','Verifikasi','Lupa','Reset'].includes(halaman)" :is="halaman" :key="negara.rute"/>
    <div v-else class="portal">
      <header class="bar"><img src="/img/logo-hisada-64.png" alt="" width="34" height="34"><strong>Portal Wali</strong><button class="kecil" @click="keluar">Keluar</button></header>
      <main><component :is="halaman" :key="negara.rute"/></main>
    </div></template>`,
};

window.addEventListener("hashchange", () => { negara.rute = location.hash.slice(1) || "/"; });
document.addEventListener("DOMContentLoaded", async () => {
  negara.rute = location.hash.slice(1) || "/";
  const j = jalur();
  if (!["/verifikasi", "/reset", "/daftar", "/lupa"].includes(j)) {
    await muatSaya();
    if (!negara.saya && j !== "/masuk") pergi("/masuk");
    if (negara.saya && !j.startsWith("/anak")) pergi("/anak");
  }
  negara.siap = true;
  createApp(App).mount("#app");
});
