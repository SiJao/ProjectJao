// HISADA — aplikasi web (Vue 3 tanpa build tool). Berbicara dengan /api/* di worker.
const { createApp, reactive, ref, computed, onMounted, watch } = Vue;

// ---------------------------------------------------------------- API & state global
const negara = reactive({ me: null, status: null, master: null, rute: "", galat: "" });

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
const LABEL_ROLE = { moderator: "Moderator", sekretaris: "Sekretaris", piket: "Piket", kesehatan: "Kesehatan", kedisiplinan: "Kedisiplinan", asatidz: "Asatidz" };
const namaKelas = (k) => k ? `${k.tingkat} ${k.rombel} ${k.jenjang || ""}${k.label ? " " + k.label : ""}`.trim() : "";

// ---------------------------------------------------------------- komponen kecil
const Pesan = { props: ["galat", "ok"], template: `<div v-if="galat" class="pesan galat">{{ galat }}</div><div v-if="ok" class="pesan ok">{{ ok }}</div>` };

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
    return { f, negara, masuk, setup };
  },
  template: `
  <div class="masuk"><div class="kartu">
    <div style="display:flex;align-items:center;gap:10px"><span class="logo">H</span><div><strong style="font-size:18px">HISADA</strong><div class="redup">Sistem Administrasi Himpunan Santri</div></div></div>
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
        <p class="redup" style="margin:0">Akun pengurus baru: password sementara = NIS + tanggal lahir (ddmmyyyy), wajib diganti saat login pertama.</p>
      </template>
      <Pesan :galat="f.galat" :ok="f.ok"/>
    </template>
  </div></div>`,
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

// ---------------------------------------------------------------- Dashboard
const Beranda = {
  setup() {
    const d = ref(null), galat = ref("");
    onMounted(async () => { try { d.value = await api("/ringkasan"); } catch (e) { galat.value = e.message; } });
    return { d, galat, negara, LABEL_ROLE };
  },
  template: `<div><span class="jejak">{{ d ? d.waktu + ' WIB' : '' }}</span><h1>Assalamu'alaikum, {{ negara.me.nama }}</h1></div>
  <div v-if="galat" class="pesan galat">{{ galat }}</div>
  <div class="kisi" v-if="d">
    <div class="kartu"><div class="redup">Santri aktif putra</div><div class="angka">{{ d.santri_putra }}</div></div>
    <div class="kartu"><div class="redup">Santri aktif putri</div><div class="angka">{{ d.santri_putri }}</div></div>
    <a class="kartu" href="#/perizinan" style="text-decoration:none;color:inherit"><div class="redup">Izin berjalan</div><div class="angka" style="color:var(--biru)">{{ d.izin_berjalan }}</div><div class="redup">{{ d.izin_terlambat }} terlambat</div></a>
    <a class="kartu" href="#/perizinan" style="text-decoration:none;color:inherit"><div class="redup">Overdue</div><div class="angka" style="color:var(--merah)">{{ d.izin_overdue }}</div></a>
    <a class="kartu" href="#/absensi" style="text-decoration:none;color:inherit"><div class="redup">Absensi kamar hari ini</div><div class="angka">{{ d.absensi_terisi }}<span class="redup" style="font-size:16px"> / {{ d.kamar_aktif }}</span></div></a>
  </div>
  <div class="pesan info">Tahap 1 aktif: Data Master, Daftar Pilihan, Akun & Manajemen Akses, Absensi harian, Perizinan + Gate Pass, Riwayat. Modul lain menyusul (Kesehatan, Kedisiplinan, Update Data, dst.).</div>`,
};

// ---------------------------------------------------------------- Absensi
const Absensi = {
  components: { Pesan },
  setup() {
    const f = reactive({ asrama_id: "", kamar_id: "", tanggal: hariIni(), sesi_id: "", data: null, galat: "", ok: "", rekap: [] });
    const m = computed(() => negara.master || {});
    const kamarList = computed(() => (m.value.kamar || []).filter((k) => k.aktif && (!f.asrama_id || k.asrama_id == f.asrama_id)));
    const sesiList = computed(() => (m.value.pilihan || []).filter((p) => p.kelompok === "sesi_absensi" && p.aktif));
    const statusList = computed(() => (m.value.status_kehadiran || []).filter((s) => s.aktif));
    const warna = (id) => (statusList.value.find((s) => s.id == id) || {}).warna || "#55605A";
    async function muat() {
      f.ok = ""; f.galat = ""; f.data = null;
      if (!f.kamar_id || !f.sesi_id) return;
      try { f.data = await api(`/absensi?kamar_id=${f.kamar_id}&tanggal=${f.tanggal}&sesi_id=${f.sesi_id}`); } catch (e) { f.galat = e.message; }
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
      <thead><tr><th>NIS</th><th>Nama</th><th>Status</th><th>Keterangan</th></tr></thead>
      <tbody><tr v-for="s in f.data.santri" :key="s.id">
        <td class="redup">{{ s.nis }}</td><td><strong>{{ s.nama }}</strong></td>
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
const CariSantri = {
  props: ["modelValue"], emits: ["update:modelValue"],
  setup(props, { emit }) {
    const q = ref(""), hasil = ref([]), pilih = ref(null);
    let t;
    watch(q, (v) => { clearTimeout(t); if (v.length < 2) { hasil.value = []; return; } t = setTimeout(async () => { hasil.value = await api("/santri?limit=15&q=" + encodeURIComponent(v)); }, 250); });
    const ambil = (s) => { pilih.value = s; emit("update:modelValue", s); hasil.value = []; q.value = ""; };
    return { q, hasil, pilih, ambil, namaKelas };
  },
  template: `<div style="position:relative">
    <div v-if="pilih" class="baris" style="align-items:center"><strong>{{ pilih.nama }}</strong><span class="redup">{{ pilih.nis }} · {{ pilih.kelas }} · {{ pilih.kamar }}</span><button class="kedua kecil" @click="pilih=null; $emit('update:modelValue', null)">Ganti</button></div>
    <input v-else v-model="q" placeholder="Ketik nama atau NIS (min. 2 huruf)" style="width:100%">
    <div v-if="hasil.length" class="kartu" style="position:absolute;z-index:5;left:0;right:0;padding:6px;max-height:260px;overflow:auto">
      <div v-for="s in hasil" @click="ambil(s)" style="padding:8px;cursor:pointer;border-radius:8px" @mouseover="$event.currentTarget.style.background='#EEF5F1'" @mouseout="$event.currentTarget.style.background=''"><strong>{{ s.nama }}</strong> <span class="redup">{{ s.nis }} · {{ s.kelas }} · {{ s.kamar }}</span></div>
    </div></div>`,
};

const Perizinan = {
  components: { Pesan, CariSantri },
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
    async function batal(z) {
      const alasan = prompt("Alasan membatalkan izin " + z.nama + "?");
      if (!alasan) return;
      try { await api(`/izin/${z.id}/batal`, { alasan }); await muat(); } catch (e) { f.galat = e.message; }
    }
    onMounted(async () => { await muatMaster(); if (jenis.value[0]) f.jenis_izin_id = jenis.value[0].id; muat(); });
    watch(() => f.riwayat, muat);
    const lencana = (k) => ({ berjalan: "biru", terlambat: "kuning", overdue: "merah", kembali: "hijau", dibatalkan: "" }[k]);
    return { f, jenis, ji, terbit, kembali, batal, lencana };
  },
  template: `<div><span class="jejak">Administrasi › Kesantrian</span><h1>Perizinan & Gate Pass</h1></div>
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
    <tbody><tr v-for="z in f.daftar" :key="z.id">
      <td><strong>{{ z.nama }}</strong><div class="redup">{{ z.nis }} · {{ z.kamar }}</div></td><td>{{ z.jenis }}</td><td>{{ z.berangkat }}</td>
      <td>{{ z.kembali_at || z.rencana_kembali }}</td>
      <td><span class="lencana" :class="lencana(z.keadaan)">{{ z.keadaan }}</span></td>
      <td style="white-space:nowrap"><a class="tombol kedua kecil" style="height:34px" :href="'#/gatepass/' + z.id" target="_blank">Gate Pass</a>
        <template v-if="z.keadaan !== 'kembali' && z.keadaan !== 'dibatalkan'"> <button class="kecil" @click="kembali(z)">Kembali</button> <button class="bahaya kecil" @click="batal(z)">Batal</button></template></td>
    </tr></tbody></table>
    <p v-if="!f.daftar.length" class="redup" style="padding:14px">Tidak ada data.</p></div>`,
};

const GatePass = {
  setup() {
    const z = ref(null), galat = ref("");
    const id = location.hash.split("/").pop();
    onMounted(async () => { try { z.value = await api("/izin/" + id); setTimeout(() => window.print(), 400); } catch (e) { galat.value = e.message; } });
    const fmt = (s, b) => !s ? "" : b === "jam" ? s.slice(11) : b === "tanggal" ? s.slice(0, 10) : s;
    return { z, galat, fmt };
  },
  template: `<div v-if="galat" class="pesan galat">{{ galat }}</div>
  <div v-if="z" class="gatepass">
    <div style="border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:14px"><strong style="font-size:16px">Pesantren Modern Daarul 'Uluum Lido</strong><div>SEKRETARIS HISADA</div></div>
    <div style="text-align:center;font-weight:700;letter-spacing:.12em;margin-bottom:14px">GATE PASS · {{ z.jenis.toUpperCase() }}</div>
    <table><tbody>
      <tr><td style="width:150px">Name</td><td><strong>{{ z.nama }}</strong> ({{ z.nis }})</td></tr>
      <tr><td>Class / Room</td><td>{{ z.kelas }} · {{ z.kamar }}</td></tr>
      <tr><td>Reason</td><td>{{ z.keterangan }}</td></tr>
      <tr><td>Departure</td><td>{{ fmt(z.berangkat, z.basis_waktu) }}</td></tr>
      <tr><td>Return</td><td>{{ fmt(z.rencana_kembali, z.basis_waktu) }}</td></tr>
      <tr v-if="z.pendamping"><td>Pendamping</td><td>{{ z.pendamping }}</td></tr>
    </tbody></table>
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
  components: { Pesan },
  setup() {
    const tab = ref("santri");
    const f = reactive({ galat: "", ok: "", q: "", santri: [], edit: null, kelompok: "sesi_absensi", baru: "", ling: "semua", impor: null, imporHasil: null, sibuk: false });
    const m = computed(() => negara.master || {});
    const moderator = computed(() => negara.me && negara.me.role === "moderator");
    const bisaPilihan = (k) => moderator.value || (negara.me.akses || []).includes("pilihan." + k);
    async function cari() { try { f.santri = await api("/santri?limit=200&status=semua&q=" + encodeURIComponent(f.q)); } catch (e) { f.galat = e.message; } }
    async function simpanMaster(tabel, data) { f.galat = ""; f.ok = ""; try { await api("/master/" + tabel, data); f.ok = "Tersimpan."; await muatMaster(); } catch (e) { f.galat = e.message; } }
    async function bukaSantri(s) { f.edit = s ? await api("/santri/" + s.id) : { nis: "", nama: "", jenis_kelamin: "L", status: "aktif" }; }
    async function simpanSantri() { f.galat = ""; try { await api("/santri", f.edit); f.ok = "Data santri tersimpan."; f.edit = null; cari(); muatMaster(); } catch (e) { f.galat = e.message; } }
    const isiPilihan = computed(() => (m.value.pilihan || []).filter((p) => p.kelompok === f.kelompok));
    async function tambahPilihan() { f.galat = ""; try { await api("/pilihan", { kelompok: f.kelompok, nama: f.baru, lingkungan: f.ling }); f.baru = ""; await muatMaster(); } catch (e) { f.galat = e.message; } }
    async function ubahPilihan(p, data) { f.galat = ""; try { await api("/pilihan", { id: p.id, kelompok: p.kelompok, lingkungan: p.lingkungan, ...data }); await muatMaster(); } catch (e) { f.galat = e.message; } }
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
      f.impor = { nama: file.name, rows: data, kolomDibuang: H.filter((x) => x && !Object.values(ambil).includes(H.indexOf(x))).length };
    }
    async function jalankanImpor() {
      f.sibuk = true; f.galat = "";
      const total = { baru: 0, diperbarui: 0, ditolak: [] };
      let i = 0;
      try {
        for (; i < f.impor.rows.length; i += 50) {
          const r = await api("/impor/santri", { rows: f.impor.rows.slice(i, i + 50) });
          total.baru += r.baru; total.diperbarui += r.diperbarui; total.ditolak.push(...r.ditolak);
          f.imporHasil = { ...total, proses: Math.min(i + 50, f.impor.rows.length) };
        }
        f.impor = null; await muatMaster();
      } catch (e) { f.galat = `${e.message} — berhenti pada santri ke-${i + 1}. Klik Impor sekarang lagi; NIS yang sudah masuk hanya diperbarui, tidak dobel.`; } finally { f.sibuk = false; }
    }
    onMounted(async () => { await muatMaster(); cari(); });
    return { tab, f, m, moderator, bisaPilihan, cari, simpanMaster, bukaSantri, simpanSantri, KELOMPOK, isiPilihan, tambahPilihan, ubahPilihan, baru, tambahKamar, bacaFile, jalankanImpor, namaKelas };
  },
  template: `<div><span class="jejak">Administrasi</span><h1>Data Master</h1></div>
  <div class="tab"><button v-for="t in [['santri','Santri'],['kelas','Kelas'],['asrama','Asrama & Kamar'],['guru','Guru'],['ta','Tahun Ajaran'],['pilihan','Daftar Pilihan'],['impor','Impor Santri'],['atur','Pengaturan']].filter(t => moderator || t[0]==='pilihan' || t[0]==='santri')" :class="{aktif: tab===t[0]}" @click="tab=t[0]; f.ok=''; f.galat=''">{{ t[1] }}</button></div>
  <Pesan :galat="f.galat" :ok="f.ok"/>

  <template v-if="tab==='santri'">
    <div class="baris"><input v-model="f.q" placeholder="Cari nama atau NIS" @keyup.enter="cari" style="flex:1 1 260px"><button class="kedua" @click="cari">Cari</button><button v-if="moderator" @click="bukaSantri(null)">Tambah santri</button></div>
    <div v-if="f.edit" class="kartu" style="display:flex;flex-direction:column;gap:12px">
      <h2>{{ f.edit.id ? 'Ubah santri' : 'Santri baru' }}</h2>
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
    <div class="tabel"><table><thead><tr><th>NIS</th><th>Nama</th><th>L/P</th><th>Kelas</th><th>Kamar</th><th>Status</th><th></th></tr></thead>
      <tbody><tr v-for="s in f.santri" :key="s.id"><td class="redup">{{ s.nis }}</td><td><strong>{{ s.nama }}</strong></td><td>{{ s.jenis_kelamin }}</td><td>{{ s.kelas }}</td><td>{{ s.kamar }}</td><td><span class="lencana" :class="{hijau: s.status==='aktif'}">{{ s.status }}</span></td><td><button v-if="moderator" class="kedua kecil" @click="bukaSantri(s)">Ubah</button></td></tr></tbody></table>
      <p v-if="!f.santri.length" class="redup" style="padding:14px">Belum ada data. Gunakan tab Impor Santri.</p></div>
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
    <div class="tabel"><table><thead><tr><th>Kelas</th><th>Lingkungan</th><th>Santri aktif</th><th>Status</th><th></th></tr></thead>
      <tbody><tr v-for="k in m.kelas" :key="k.id"><td><strong>{{ namaKelas(k) }}</strong></td><td>{{ k.lingkungan }}</td><td>{{ k.jumlah }}</td><td>{{ k.aktif ? 'Aktif' : 'Nonaktif' }}</td><td><button class="kedua kecil" @click="simpanMaster('kelas', {id: k.id, aktif: k.aktif ? 0 : 1})">{{ k.aktif ? 'Nonaktifkan' : 'Aktifkan' }}</button></td></tr></tbody></table></div>
    <p class="redup">Rombel statis (K-89): yang berubah tiap tahun hanya santri dan wali kelasnya.</p>
  </template>

  <template v-if="tab==='asrama'">
    <div class="dua-kolom">
      <div class="kartu baris"><label class="isian">Asrama baru<input v-model="baru.asrama.nama"></label><label class="isian">Lingkungan<select v-model="baru.asrama.lingkungan"><option>putra</option><option>putri</option></select></label><button @click="simpanMaster('asrama', baru.asrama)">Tambah</button></div>
      <div class="kartu baris"><label class="isian">Asrama<select v-model="baru.kamar.asrama_id"><option v-for="a in m.asrama" :value="a.id">{{ a.nama }}</option></select></label><label class="isian">Nomor kamar<input v-model="baru.kamar.nomor" placeholder="01"></label><button @click="tambahKamar">Tambah kamar</button></div>
    </div>
    <div class="tabel"><table><thead><tr><th>Kamar</th><th>Lingkungan</th><th>Penghuni</th><th>Status</th><th></th></tr></thead>
      <tbody><tr v-for="k in m.kamar" :key="k.id"><td><strong>{{ k.nama }}</strong></td><td>{{ k.lingkungan }}</td><td>{{ k.jumlah }}</td><td>{{ k.aktif ? 'Aktif' : 'Nonaktif' }}</td><td><button class="kedua kecil" @click="simpanMaster('kamar', {id: k.id, aktif: k.aktif ? 0 : 1})">{{ k.aktif ? 'Nonaktifkan' : 'Aktifkan' }}</button></td></tr></tbody></table></div>
  </template>

  <template v-if="tab==='guru'">
    <div class="kartu baris">
      <label class="isian">NIP<input v-model="baru.guru.nip"></label><label class="isian">Nama<input v-model="baru.guru.nama"></label>
      <label class="isian">L/P<select v-model="baru.guru.jenis_kelamin"><option>L</option><option>P</option></select></label>
      <label class="isian">Email pondok<input v-model="baru.guru.email"></label>
      <label class="isian">Lingkungan<select v-model="baru.guru.lingkungan"><option>semua</option><option>putra</option><option>putri</option></select></label>
      <button @click="simpanMaster('guru', baru.guru)">Tambah guru</button>
    </div>
    <div class="tabel"><table><thead><tr><th>NIP</th><th>Nama</th><th>Email</th><th>Lingkungan</th></tr></thead>
      <tbody><tr v-for="g in m.guru" :key="g.id"><td>{{ g.nip }}</td><td><strong>{{ g.nama }}</strong></td><td>{{ g.email }}</td><td>{{ g.lingkungan }}</td></tr></tbody></table></div>
  </template>

  <template v-if="tab==='ta'">
    <div class="kartu baris"><label class="isian">Tahun ajaran<input v-model="baru.ta.nama" placeholder="2027/2028"></label><button @click="simpanMaster('tahun_ajaran', baru.ta)">Tambah (persiapan)</button></div>
    <div class="tabel"><table><thead><tr><th>Tahun ajaran</th><th>Status</th><th>Mulai</th><th></th></tr></thead>
      <tbody><tr v-for="t in m.tahun_ajaran" :key="t.id"><td><strong>{{ t.nama }}</strong></td><td>{{ t.status }}</td><td>{{ t.mulai || '—' }}</td><td><button v-if="t.status!=='aktif'" class="kedua kecil" @click="simpanMaster('tahun_ajaran', {id: t.id, status: 'aktif'})">Jadikan aktif</button></td></tr></tbody></table></div>
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
          <div class="tabel"><table><thead><tr><th>Kode</th><th>Nama</th><th>Dihitung hadir</th><th>Status</th></tr></thead>
            <tbody><tr v-for="s in m.status_kehadiran"><td>{{ s.kode }}</td><td :style="{color: s.warna, fontWeight: 700}">{{ s.nama }}</td><td>{{ s.dihitung_hadir ? 'Ya' : 'Tidak' }}</td><td><button v-if="moderator" class="kedua kecil" @click="simpanMaster('status_kehadiran', {id: s.id, aktif: s.aktif ? 0 : 1})">{{ s.aktif ? 'Aktif' : 'Nonaktif' }}</button></td></tr></tbody></table></div>
        </template>
        <template v-else-if="f.kelompok==='_izin'">
          <h2>Jenis izin</h2>
          <div class="tabel"><table><thead><tr><th>Nama</th><th>Basis waktu</th><th>Wajib wali</th><th>Status absensi</th><th></th></tr></thead>
            <tbody><tr v-for="j in m.jenis_izin"><td><strong>{{ j.nama }}</strong></td><td>{{ j.basis_waktu }}</td><td>{{ j.wajib_wali ? 'Ya' : 'Tidak' }}</td><td>{{ (m.status_kehadiran.find(s => s.id===j.status_kehadiran_id)||{}).nama }}</td><td><button v-if="moderator" class="kedua kecil" @click="simpanMaster('jenis_izin', {id: j.id, aktif: j.aktif ? 0 : 1})">{{ j.aktif ? 'Aktif' : 'Nonaktif' }}</button></td></tr></tbody></table></div>
        </template>
        <template v-else>
          <h2>{{ (KELOMPOK.find(k => k[1]===f.kelompok)||[])[2] }}</h2>
          <div class="baris" v-if="bisaPilihan(f.kelompok)"><label class="isian" style="flex:2 1 200px">Pilihan baru<input v-model="f.baru" @keyup.enter="tambahPilihan"></label>
            <label class="isian">Lingkungan<select v-model="f.ling"><option>semua</option><option>putra</option><option>putri</option></select></label><button @click="tambahPilihan">Tambah</button></div>
          <div class="tabel"><table><thead><tr><th>Urutan</th><th>Pilihan</th><th>Lingkungan</th><th>Status</th></tr></thead>
            <tbody><tr v-for="p in isiPilihan" :key="p.id" :style="{color: p.aktif ? '' : '#6B756F'}"><td>{{ p.urutan }}</td><td><strong>{{ p.nama }}</strong></td><td>{{ p.lingkungan }}</td>
              <td><button class="kecil" :class="p.aktif ? '' : 'kedua'" :disabled="!bisaPilihan(p.kelompok)" @click="ubahPilihan(p, {aktif: p.aktif ? 0 : 1})">{{ p.aktif ? 'Aktif' : 'Nonaktif' }}</button></td></tr></tbody></table>
            <p v-if="!isiPilihan.length" class="redup" style="padding:14px">Belum ada pilihan.</p></div>
          <p class="redup">Pilihan yang sudah dipakai tidak dihapus — cukup dinonaktifkan.</p>
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
      </ol>
      <input type="file" accept=".csv,text/csv" @change="bacaFile">
      <div v-if="f.impor" class="pesan info">{{ f.impor.nama }}: <strong>{{ f.impor.rows.length }}</strong> baris santri terbaca · {{ f.impor.kolomDibuang }} kolom lain dibuang.
        <div style="margin-top:8px"><button :disabled="f.sibuk" @click="jalankanImpor">{{ f.sibuk ? 'Mengimpor…' : 'Impor sekarang' }}</button></div></div>
      <div v-if="f.imporHasil" class="pesan ok">Diproses {{ f.imporHasil.proses || '' }} · baru {{ f.imporHasil.baru }} · diperbarui {{ f.imporHasil.diperbarui }} · ditolak {{ f.imporHasil.ditolak.length }}</div>
      <div v-if="f.imporHasil && f.imporHasil.ditolak.length" class="tabel"><table><thead><tr><th>Baris</th><th>NIS</th><th>Alasan</th></tr></thead><tbody><tr v-for="d in f.imporHasil.ditolak"><td>{{ d.baris }}</td><td>{{ d.nis }}</td><td>{{ d.alasan }}</td></tr></tbody></table></div>
    </div>
  </template>

  <template v-if="tab==='atur'">
    <div class="tabel"><table><thead><tr><th>Pengaturan</th><th>Nilai</th><th>Keterangan</th></tr></thead>
      <tbody><tr v-for="p in m.pengaturan" :key="p.kunci"><td><code>{{ p.kunci }}</code></td><td><input v-model="p.nilai" style="width:120px" @change="simpanMaster('pengaturan', {kunci: p.kunci, nilai: p.nilai})"></td><td class="redup">{{ p.keterangan }}</td></tr></tbody></table></div>
    <p class="redup">Tambahkan <code>login.password_aktif</code> = 0 lewat database bila login password ingin dimatikan setelah semua memakai Google.</p>
  </template>`,
};

// ---------------------------------------------------------------- Pengguna & Manajemen Akses
const Pengguna = {
  components: { Pesan, CariSantri },
  setup() {
    const f = reactive({ users: [], akses: [], galat: "", ok: "", sel: null, santri: null, role: "", guru_id: "", modNama: "", modEmail: "" });
    const m = computed(() => negara.master || {});
    async function muat() { const r = await api("/users"); f.users = r.users; f.akses = r.akses; if (f.sel) f.sel = f.users.find((u) => u.id === f.sel.id) || null; }
    const jalan = async (fn, pesan) => { f.galat = ""; f.ok = ""; try { const r = await fn(); f.ok = typeof pesan === "function" ? pesan(r) : pesan; await muat(); } catch (e) { f.galat = e.message; } };
    const buatPengurus = () => jalan(() => api("/users/dari-santri", { santri_id: f.santri.id, role: f.role || null }), (r) => r.tertahan ? "Akun dibuat tetapi TERTAHAN: tanggal lahir santri kosong." : "Akun pengurus dibuat. Password sementara: NIS + tanggal lahir.");
    const buatGuru = () => jalan(() => api("/users/guru", { guru_id: f.guru_id }), "Akun guru dibuat (masuk dengan Google).");
    const buatMod = () => jalan(() => api("/users/moderator", { nama: f.modNama, email: f.modEmail }), "Moderator ditambahkan (masuk dengan Google).");
    const ubah = (u, data) => jalan(() => api("/users/" + u.id, data), "Akun diperbarui.");
    const akses = (u, kode, beri) => jalan(() => api(`/users/${u.id}/akses`, { kode, beri }), beri ? "Akses diberikan." : "Akses dicabut.");
    const reset = (u) => confirm("Reset password " + u.email + "?") && jalan(() => api(`/users/${u.id}/reset-password`, {}), (r) => "Password sementara: " + r.password_sementara);
    const roleUntuk = (u) => u.santri_id ? ["", "piket", "kesehatan", "kedisiplinan", "sekretaris"] : u.guru_id ? ["asatidz"] : ["moderator"];
    onMounted(async () => { await muatMaster(); try { await muat(); } catch (e) { f.galat = e.message; } });
    return { f, m, buatPengurus, buatGuru, buatMod, ubah, akses, reset, roleUntuk, LABEL_ROLE };
  },
  template: `<div><span class="jejak">Fungsi › Akses</span><h1>Pengguna & Manajemen Akses</h1></div>
  <Pesan :galat="f.galat" :ok="f.ok"/>
  <div class="dua-kolom">
    <div class="kartu" style="display:flex;flex-direction:column;gap:10px"><h2>Akun pengurus (santri)</h2><CariSantri v-model="f.santri"/>
      <label class="isian">Role<select v-model="f.role"><option value="">Menunggu role</option><option v-for="r in ['piket','kesehatan','kedisiplinan','sekretaris']" :value="r">{{ LABEL_ROLE[r] }}</option></select></label>
      <button :disabled="!f.santri" @click="buatPengurus">Buat akun NIS@daarululuumlido.com</button></div>
    <div class="kartu" style="display:flex;flex-direction:column;gap:10px"><h2>Akun guru</h2>
      <label class="isian">Guru<select v-model="f.guru_id"><option value="">Pilih guru…</option><option v-for="g in m.guru" :value="g.id">{{ g.nama }} ({{ g.nip }})</option></select></label>
      <button :disabled="!f.guru_id" @click="buatGuru">Buat akun guru</button>
      <h2 style="margin-top:8px">Moderator lain</h2><div class="baris"><input v-model="f.modNama" placeholder="Nama"><input v-model="f.modEmail" placeholder="email@daarululuumlido.com"><button class="kedua" @click="buatMod">Tambah</button></div></div>
  </div>
  <div class="dua-kolom">
    <div class="tabel" style="flex:1.3 1 420px"><table><thead><tr><th>Nama</th><th>Role</th><th>Status</th><th></th></tr></thead>
      <tbody><tr v-for="u in f.users" :key="u.id" :style="{background: f.sel && f.sel.id===u.id ? '#EEF5F1' : ''}">
        <td><strong>{{ u.nama }}</strong><div class="redup">{{ u.email }}</div></td>
        <td><span class="lencana" :class="{kuning: !u.role}">{{ u.role ? LABEL_ROLE[u.role] : 'Menunggu role' }}</span></td>
        <td><span class="lencana" :class="{hijau: u.status==='aktif', merah: u.status!=='aktif'}">{{ u.status }}</span></td>
        <td><button class="kedua kecil" @click="f.sel = u">Kelola</button></td></tr></tbody></table></div>
    <div v-if="f.sel" class="kartu" style="display:flex;flex-direction:column;gap:12px">
      <h2>{{ f.sel.nama }}</h2><span class="redup">{{ f.sel.email }} · lingkungan {{ f.sel.lingkungan }}</span>
      <label class="isian">Role (satu per akun)<select :value="f.sel.role || ''" @change="ubah(f.sel, {role: $event.target.value})"><option v-for="r in roleUntuk(f.sel)" :value="r">{{ r ? LABEL_ROLE[r] : 'Menunggu role' }}</option></select></label>
      <label class="isian" v-if="f.sel.guru_id">Lingkungan guru<select :value="f.sel.lingkungan" @change="ubah(f.sel, {lingkungan: $event.target.value})"><option>semua</option><option>putra</option><option>putri</option></select></label>
      <div><strong style="font-size:13px">Akses di luar role</strong>
        <label v-for="a in f.akses" :key="a.kode" style="display:flex;gap:10px;align-items:center;padding:6px 0;font-size:14px"><input type="checkbox" :checked="f.sel.akses.includes(a.kode)" @change="akses(f.sel, a.kode, $event.target.checked)"><span><strong>{{ a.nama }}</strong> <span class="redup">{{ a.keterangan }}</span></span></label></div>
      <div class="baris"><button class="kedua" @click="ubah(f.sel, {status: f.sel.status==='aktif' ? 'nonaktif' : 'aktif'})">{{ f.sel.status==='aktif' ? 'Nonaktifkan' : 'Aktifkan' }}</button><button v-if="f.sel.punya_password || f.sel.santri_id" class="bahaya" @click="reset(f.sel)">Reset password</button></div>
    </div>
  </div>`,
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
  <div class="tab"><button v-for="k in ['','data','kesantrian','pilihan','akun','akses','pengaturan']" :class="{aktif: kat===k}" @click="kat=k">{{ k || 'Semua' }}</button></div>
  <div v-if="galat" class="pesan galat">{{ galat }}</div>
  <div class="tabel"><table><thead><tr><th>Waktu (UTC)</th><th>Oleh</th><th>Kategori</th><th>Aksi</th><th>Ringkasan</th></tr></thead>
    <tbody><tr v-for="r in d" :key="r.id"><td class="redup" style="white-space:nowrap">{{ r.waktu }}</td><td>{{ r.oleh || 'Sistem' }}</td><td><span class="lencana">{{ r.kategori }}</span></td><td>{{ r.aksi }}</td><td>{{ r.ringkasan }}</td></tr></tbody></table></div>`,
};

// ---------------------------------------------------------------- kerangka & router
const HALAMAN = { "/": Beranda, "/absensi": Absensi, "/perizinan": Perizinan, "/data-master": DataMaster, "/pengguna": Pengguna, "/riwayat": Riwayat, "/ganti-password": GantiPassword };

const App = {
  components: { Masuk, GatePass },
  setup() {
    const jalur = computed(() => negara.rute.split("?")[0]);
    const halaman = computed(() => HALAMAN[jalur.value] || Beranda);
    const menu = computed(() => {
      const me = negara.me; if (!me) return [];
      const mod = me.role === "moderator";
      return [
        ["Beranda", [["/", "Dashboard", true]]],
        ["Administrasi", [["/data-master", "Data Master", true], ["/absensi", "Absensi", me.bisa.absensi], ["/perizinan", "Perizinan", me.bisa.perizinan]]],
        ["Fungsi", [["/pengguna", "Pengguna & Akses", mod], ["/riwayat", "Riwayat Perubahan", mod || me.role === "sekretaris"]]],
      ].map(([g, items]) => [g, items.filter((i) => i[2])]).filter(([, i]) => i.length);
    });
    async function keluar() { await api("/logout", {}); negara.me = null; pergi("/masuk"); }
    return { negara, jalur, halaman, menu, keluar, LABEL_ROLE };
  },
  template: `
  <Masuk v-if="jalur === '/masuk' || !negara.me"/>
  <div v-else-if="jalur.startsWith('/gatepass/')" class="isi"><GatePass/></div>
  <div v-else class="tata">
    <nav class="samping" aria-label="Menu utama">
      <a class="merek" href="#/"><span class="logo">H</span><span><strong>HISADA</strong><div class="redup">{{ negara.me.lingkungan === 'semua' ? 'Putra & Putri' : (negara.me.lingkungan === 'putra' ? 'Putra' : 'Putri') }}</div></span></a>
      <div class="grup-menu" v-for="[g, items] in menu" :key="g"><span class="judul">{{ g }}</span><a v-for="i in items" :key="i[0]" :href="'#' + i[0]" :class="{aktif: jalur === i[0]}">{{ i[1] }}</a></div>
      <div class="akun"><strong>{{ negara.me.nama }}</strong><span class="redup">{{ negara.me.role ? LABEL_ROLE[negara.me.role] : 'Menunggu role' }}</span>
        <a href="#/ganti-password">Ganti password</a><a href="#" @click.prevent="keluar">Keluar</a></div>
    </nav>
    <main class="isi"><component :is="halaman" :key="jalur"/></main>
  </div>`,
};

async function mulai() {
  negara.status = await api("/status").catch(() => null);
  try { negara.me = await api("/me"); } catch { negara.me = null; }
}

window.addEventListener("hashchange", () => { negara.rute = location.hash.slice(1) || "/"; });
(async () => {
  negara.rute = location.hash.slice(1) || "/";
  await mulai();
  if (negara.me && negara.me.wajib_ganti_password) pergi("/ganti-password");
  createApp(App).mount("#app");
})();
