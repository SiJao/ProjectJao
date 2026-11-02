// Modul Notifikasi — halaman /notifikasi (semua notifikasi, tugas, pengumuman internal) dan /akun (detail akun).
// Lonceng & popup detail akun ada di kerangka (app.js: Lonceng, DetailAkun, notif).
const HalamanNotifikasi = {
  components: { Pesan },
  setup() {
    const f = reactive({ galat: "", ok: "", data: null, saring: "", sibuk: false });
    // K-118: saringan jabatan + daftar akun yang bisa dicentang; bila daftar dibuka, yang dikirim hanya akun yang dicentang (user_ids).
    const p = reactive({ sasaran: "pengurus", lingkungan: "", jabatan_ids: [], jabatan: [], calon: null, centang: {}, q: "", judul: "", isi: "", jumlah: null });
    const saringP = () => ({ sasaran: p.sasaran, lingkungan: p.lingkungan, jabatan_ids: p.jabatan_ids.map(Number) });
    const dipilih = computed(() => (p.calon || []).filter((a) => p.centang[a.id]));
    const dataP = () => ({ ...saringP(), ...(p.calon ? { user_ids: dipilih.value.map((a) => a.id) } : {}) });
    const calonTampil = computed(() => { const q = p.q.trim().toLowerCase(); return (p.calon || []).filter((a) => !q || (a.nama + " " + a.email).toLowerCase().includes(q)); });
    async function tampilkanCalon() {
      f.galat = "";
      try { const r = await api("/notifikasi/pengumuman/calon", saringP()); p.calon = r.akun; p.centang = Object.fromEntries(r.akun.map((a) => [a.id, true])); } catch (e) { f.galat = e.message; }
    }
    const centangSemua = (v) => calonTampil.value.forEach((a) => { p.centang[a.id] = v; });
    const bolehUmumkan = computed(() => negara.me.role === "moderator" || (negara.me.bisa || {}).pengumuman);
    const lingPilihan = computed(() => negara.me.role === "moderator" || negara.me.lingkungan === "semua" ? ["putra", "putri"] : []);
    async function muat() {
      try { f.data = await api("/notifikasi?semua=1"); notif.data = { ...notif.data, tugas: f.data.tugas, belum_dibaca: f.data.belum_dibaca }; } catch (e) { f.galat = e.message; }
    }
    onMounted(muat);
    const daftar = computed(() => (f.data ? f.data.daftar : []).filter((n) => !f.saring || (f.saring === "baru" ? !n.dibaca_at : n.jenis === f.saring)));
    async function baca(n) { await bukaNotif(n); await muat(); }
    async function semuaDibaca() { await bacaSemua(); await muat(); }
    let tunda = null;
    watch(() => [p.sasaran, p.lingkungan, p.jabatan_ids.join()], () => { p.calon = null; p.centang = {}; clearTimeout(tunda); tunda = setTimeout(hitung, 200); });
    watch(() => p.centang, () => { clearTimeout(tunda); tunda = setTimeout(hitung, 200); }, { deep: true });
    async function hitung() {
      if (!bolehUmumkan.value) return;
      if (p.calon && !dipilih.value.length) { p.jumlah = 0; return; }
      try { p.jumlah = (await api("/notifikasi/pengumuman", dataP())).jumlah; } catch (e) { p.jumlah = null; f.galat = e.message; }
    }
    onMounted(async () => {
      hitung();
      if (bolehUmumkan.value) try { p.jabatan = (await api("/notifikasi/pengumuman/calon", { sasaran: "pengurus", hanya_jabatan: true })).jabatan; } catch {}
    });
    async function kirim() {
      f.galat = ""; f.ok = "";
      if (!p.judul.trim() || !p.isi.trim()) { f.galat = "Judul dan isi wajib diisi."; return; }
      if (!confirm(`Kirim pengumuman ke ${p.jumlah} akun?`)) return;
      f.sibuk = true;
      try {
        const r = await api("/notifikasi/pengumuman", { ...dataP(), judul: p.judul, isi: p.isi, konfirmasi: true });
        f.ok = `Pengumuman terkirim ke ${r.jumlah} akun.`; p.judul = ""; p.isi = "";
      } catch (e) { f.galat = e.message; } finally { f.sibuk = false; }
    }
    return { f, p, daftar, baca, semuaDibaca, kirim, bolehUmumkan, lingPilihan, waktuLalu, LABEL_JENIS_NOTIF, dipilih, calonTampil, tampilkanCalon, centangSemua };
  },
  template: `
  <div><span class="jejak">Akun › Notifikasi</span><h1>Notifikasi</h1></div>
  <Pesan :galat="f.galat" :ok="f.ok"/>
  <div v-if="!f.data && !f.galat" class="muat">Memuat…</div>
  <template v-if="f.data">
    <div v-if="f.data.tugas.length" class="kartu" style="display:flex;flex-direction:column;gap:10px">
      <h2>Perlu ditindaklanjuti</h2>
      <div v-for="t in f.data.tugas" :key="t.kunci" class="notif-item tugas">
        <a :href="'#' + t.tautan"><strong>{{ t.judul }}</strong><span>{{ t.isi }}</span></a>
        <div v-if="t.rinci" class="tabel" style="margin-top:6px"><table><thead><tr><th>Tanggal</th><th>Kamar belum diisi</th><th>Sesi belum diisi</th><th></th></tr></thead>
          <tbody><tr v-for="r in t.rinci" :key="r.tanggal"><td>{{ r.label }}<span v-if="r.label !== r.tanggal" class="redup"> · {{ r.tanggal }}</span></td><td>{{ r.kamar }}</td><td>{{ r.sesi }}</td>
            <td><a class="tombol kedua kecil" :href="'#' + r.tautan">Isi absensi</a></td></tr></tbody></table></div>
      </div>
    </div>
    <div class="kartu" style="display:flex;flex-direction:column;gap:10px">
      <div class="baris" style="justify-content:space-between"><h2 style="margin:0">Semua notifikasi</h2>
        <div class="baris"><label class="isian">Saring<select v-model="f.saring"><option value="">Semua</option><option value="baru">Belum dibaca</option>
          <option value="pengumuman">Pengumuman</option><option value="akun">Akun</option><option value="santri">Santri binaan</option></select></label>
          <button v-if="f.data.belum_dibaca" class="kedua" @click="semuaDibaca">Tandai semua dibaca</button></div></div>
      <button v-for="n in daftar" :key="n.id" type="button" class="notif-item" :class="{baru: !n.dibaca_at}" @click="baca(n)">
        <span class="titik" aria-hidden="true"></span><span style="flex:1;min-width:0"><strong>{{ n.judul }}</strong><span v-if="n.isi" style="white-space:pre-line">{{ n.isi }}</span>
        <small>{{ LABEL_JENIS_NOTIF[n.jenis] }} · {{ waktuLalu(n.dibuat_at) }}</small></span></button>
      <p v-if="!daftar.length" class="redup">Tidak ada notifikasi.</p>
      <p class="redup" style="font-size:12px;margin:0">Notifikasi yang sudah dibaca dihapus otomatis setelah 90 hari.</p>
    </div>
  </template>
  <div v-if="bolehUmumkan" class="kartu" style="display:flex;flex-direction:column;gap:12px">
    <h2>Pengumuman internal</h2>
    <p class="redup" style="margin:0">Muncul di lonceng notifikasi penerima (bukan email).</p>
    <div class="baris">
      <label class="isian">Sasaran<select v-model="p.sasaran"><option value="pengurus">Pengurus (akun santri)</option><option value="guru">Guru</option><option value="semua">Semua akun</option></select></label>
      <label v-if="lingPilihan.length" class="isian">Lingkungan<select v-model="p.lingkungan"><option value="">Putra & Putri</option><option v-for="l in lingPilihan" :value="l">{{ l }}</option></select></label>
      <span class="redup" style="align-self:flex-end;padding-bottom:10px">{{ p.jumlah == null ? '' : p.jumlah + ' akun penerima' }}</span>
    </div>
    <details v-if="p.jabatan.length" style="font-size:14px"><summary style="cursor:pointer"><strong>Jabatan / bagian</strong> <span class="redup">— {{ p.jabatan_ids.length ? p.jabatan_ids.length + ' dipilih (hanya akun pengurus pemegang jabatan itu)' : 'semua' }}</span></summary>
      <div style="display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:8px;max-height:200px;overflow:auto">
        <label v-for="j in p.jabatan" :key="j.id" style="display:flex;gap:6px;align-items:center;font-size:13.5px;flex:1 1 240px"><input type="checkbox" :value="j.id" v-model="p.jabatan_ids">{{ j.nama }}</label></div>
      <button v-if="p.jabatan_ids.length" class="kedua kecil" style="margin-top:6px" @click="p.jabatan_ids = []">Kosongkan</button></details>
    <div class="baris"><button class="kedua kecil" @click="tampilkanCalon">{{ p.calon ? 'Muat ulang daftar akun' : 'Pilih akun satu per satu' }}</button>
      <button v-if="p.calon" class="kedua kecil" @click="p.calon = null; p.centang = {}">Pakai saringan saja</button></div>
    <template v-if="p.calon">
      <div class="baris"><label class="isian" style="flex:1 1 200px">Saring daftar<input v-model="p.q" placeholder="Nama atau email"></label>
        <button class="kedua kecil" @click="centangSemua(true)">Centang semua</button><button class="kedua kecil" @click="centangSemua(false)">Kosongkan</button>
        <span class="redup">{{ dipilih.length }} dari {{ p.calon.length }} akun dipilih</span></div>
      <div class="tabel" style="max-height:320px;overflow:auto"><table><tbody><tr v-for="a in calonTampil" :key="a.id" :style="{opacity: p.centang[a.id] ? 1 : .55}">
        <td style="width:36px"><input type="checkbox" v-model="p.centang[a.id]" :aria-label="'Pilih ' + a.nama"></td>
        <td><strong>{{ a.nama }}</strong><div class="redup">{{ a.email }}</div></td><td><span class="lencana">{{ a.jenis }}</span></td><td class="redup">{{ a.jabatan || '' }}</td></tr></tbody></table>
        <p v-if="!calonTampil.length" class="redup" style="padding:14px">Tidak ada akun.</p></div>
    </template>
    <label class="isian">Judul<input v-model="p.judul" maxlength="150"></label>
    <label class="isian">Isi<textarea v-model="p.isi" rows="4" maxlength="2000"></textarea></label>
    <div><button :disabled="f.sibuk || !p.jumlah" @click="kirim">{{ f.sibuk ? 'Mengirim…' : 'Kirim pengumuman' }}</button></div>
  </div>`,
};

const HalamanAkun = {
  components: { DetailAkun },
  template: `<div><span class="jejak">Akun › Detail akun</span><h1>Akun saya</h1></div><DetailAkun/>`,
};

daftarHalaman("/notifikasi", HalamanNotifikasi, null);
daftarHalaman("/akun", HalamanAkun, null);
