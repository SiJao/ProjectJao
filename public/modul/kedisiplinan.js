// Modul tampilan Kedisiplinan — input pelanggaran, sidang & vonis, hasil vonis, riwayat per santri, skorsing, daftar pelanggar hari ini.
// Kontrol mengikuti akses: input_pelanggaran, putusan_kedisiplinan, lihat_vonis (Asatidz: lihat saja).
const Kedisiplinan = {
  components: { Pesan, CariSantri, FotoSantri },
  directives: { baris: vBaris },
  setup() {
    const me = negara.me, bisa = { ...me.bisa, lihat_vonis: me.bisa.lihat_vonis || me.bisa.putusan_kedisiplinan };
    const TAB = [["input", "Input pelanggaran", bisa.input_pelanggaran], ["sidang", "Sidang & vonis", bisa.putusan_kedisiplinan], ["hasil", "Hasil vonis", bisa.lihat_vonis],
      ["santri", "Per santri", bisa.lihat_vonis], ["skorsing", "Skorsing", bisa.putusan_kedisiplinan], ["pelanggar", "Pelanggar hari ini", true]].filter((t) => t[2]);
    const tab = ref(bisa.putusan_kedisiplinan ? "sidang" : TAB[0][0]);
    const f = reactive({ galat: "", ok: "", tingkat: [], batas: 60 });
    const pesan = (g, o = "") => { f.galat = g; f.ok = o; };
    const kategori = (ling) => ((negara.master || {}).pilihan || []).filter((p) => p.kelompok === "kategori_pelanggaran" && p.aktif && (!ling || p.lingkungan === "semua" || p.lingkungan === ling));

    // ---- input pelanggaran
    const inp = reactive({ santri: null, kategori_id: "", keterangan: "", tanggal: hariIni(), saya: [] });
    async function muatSaya() { try { inp.saya = (await api("/kedisiplinan/input-saya")).daftar; } catch (e) { pesan(e.message); } }
    async function kirimPelanggaran() {
      pesan("");
      try {
        await api("/kedisiplinan/pelanggaran", { santri_id: inp.santri && inp.santri.id, kategori_id: inp.kategori_id, keterangan: inp.keterangan, tanggal: inp.tanggal });
        pesan("", "Pelanggaran masuk antrean sidang."); inp.santri = null; inp.keterangan = ""; await muatSaya();
      } catch (e) { pesan(e.message); }
    }
    async function batalInput(x) {
      const alasan = prompt("Alasan membatalkan input pelanggaran " + x.nama + "?");
      if (!alasan) return;
      try { await api(`/kedisiplinan/pelanggaran/${x.id}/batal`, { alasan }); pesan("", "Input dibatalkan."); await muatSaya(); } catch (e) { pesan(e.message); }
    }

    // ---- sidang & detail kasus (dipakai juga dari Hasil vonis)
    const sd = reactive({ antrean: [], det: null, saring: "", kategori: "" });
    const vf = reactive({ tingkat_vonis_id: "", hukuman: "", alasan: "" });
    const kata = ref("");
    let jeda;
    watch(() => sd.saring, (v) => { clearTimeout(jeda); jeda = setTimeout(() => { kata.value = v.trim().length >= 2 ? v.trim().toLowerCase() : ""; }, 250); });
    const antreanTampil = computed(() => sd.antrean.filter((p) => (!kata.value || (p.nama + " " + p.nis + " " + p.keterangan).toLowerCase().includes(kata.value)) && (!sd.kategori || p.kategori === sd.kategori)));
    async function muatAntrean() { try { sd.antrean = await api("/kedisiplinan/antrean"); } catch (e) { pesan(e.message); } }
    const tvSel = computed(() => f.tingkat.find((t) => t.id === +vf.tingkat_vonis_id));
    const pilihanTingkat = computed(() => !sd.det ? [] : f.tingkat.filter((t) => !(sd.det.berlaku && sd.det.berlaku.adalah_pemutihan && t.adalah_pemutihan)));
    async function bukaKasus(p) {
      try { sd.det = await api("/kedisiplinan/pelanggaran/" + p.id); Object.assign(vf, { tingkat_vonis_id: "", hukuman: "", alasan: "" }); } catch (e) { pesan(e.message); }
    }
    async function putus() {
      pesan("");
      try {
        const r = await api(`/kedisiplinan/pelanggaran/${sd.det.id}/vonis`, { tingkat_vonis_id: +vf.tingkat_vonis_id, hukuman: vf.hukuman, alasan: vf.alasan, menggantikan_vonis_id: sd.det.berlaku ? sd.det.berlaku.id : null });
        pesan("", "Putusan tersimpan." + (r.kabar_wali ? ` Kabar dikirim ke ${r.kabar_wali} wali (tanpa isi vonis).` : "") + (r.ralat_wali ? " Wali menerima ralat." : ""));
        await bukaKasus(sd.det); muatAntrean(); if (hs.data) muatHasil();
      } catch (e) { pesan(e.message); }
    }

    // ---- hasil vonis
    const hs = reactive({ dari: "", sampai: hariIni(), kategori_id: "", tingkat_vonis_id: "", q: "", data: null });
    hs.dari = new Date(Date.parse(hs.sampai) - 30 * 864e5).toISOString().slice(0, 10);
    async function muatHasil() {
      const q = hs.q.trim().length >= 2 ? hs.q.trim() : "";
      const prm = new URLSearchParams({ dari: hs.dari, sampai: hs.sampai, kategori_id: hs.kategori_id, tingkat_vonis_id: hs.tingkat_vonis_id, q });
      try { hs.data = (await api("/kedisiplinan/hasil?" + prm)).daftar; } catch (e) { pesan(e.message); }
    }
    let jedaH;
    watch(() => [hs.dari, hs.sampai, hs.kategori_id, hs.tingkat_vonis_id], () => muatHasil());
    watch(() => hs.q, (v, lama) => { const a = v.trim().length >= 2, b = (lama || "").trim().length >= 2; if (!a && !b) return; clearTimeout(jedaH); jedaH = setTimeout(muatHasil, 250); });

    // ---- per santri
    const pr = reactive({ santri: null, data: null });
    watch(() => pr.santri, async (s) => { pr.data = null; if (!s) return; try { pr.data = await api("/kedisiplinan/santri/" + s.id); } catch (e) { pesan(e.message); } });
    const lihatSantri = (x) => { pr.santri = { id: x.santri_id, nama: x.nama, nis: x.nis, kelas: x.kelas, foto_url: x.foto_url }; tab.value = "santri"; };

    // ---- skorsing
    const sk = reactive({ santri: null, mulai: hariIni(), selesai: hariIni(), alasan: "", pelanggaran_id: "", daftar: [], riwayat: false, kasus: [] });
    async function muatSkors() { try { sk.daftar = await api("/kedisiplinan/skorsing" + (sk.riwayat ? "?riwayat=1" : "")); } catch (e) { pesan(e.message); } }
    watch(() => sk.riwayat, muatSkors);
    watch(() => sk.santri, async (s) => {
      sk.kasus = []; sk.pelanggaran_id = "";
      if (s) try { sk.kasus = (await api("/kedisiplinan/santri/" + s.id)).pelanggaran.filter((p) => p.status !== "dibatalkan"); } catch (e) { pesan(e.message); }
    });
    async function buatSkors() {
      pesan("");
      try {
        await api("/kedisiplinan/skorsing", { santri_id: sk.santri && sk.santri.id, mulai: sk.mulai, selesai: sk.selesai, alasan: sk.alasan, pelanggaran_id: sk.pelanggaran_id || null });
        pesan("", "Skorsing tercatat."); sk.santri = null; sk.alasan = ""; await muatSkors();
      } catch (e) { pesan(e.message); }
    }
    async function batalSkors(x) {
      const alasan = prompt("Alasan membatalkan skorsing " + x.nama + "?");
      if (!alasan) return;
      try { await api(`/kedisiplinan/skorsing/${x.id}/batal`, { alasan }); pesan("", "Skorsing dibatalkan."); await muatSkors(); } catch (e) { pesan(e.message); }
    }

    // ---- daftar pelanggar hari ini (cetak)
    const pl = reactive({ tanggal: hariIni(), lingkungan: "", data: null });
    async function muatPelanggar() { try { pl.data = (await api(`/kedisiplinan/pelanggar?tanggal=${pl.tanggal}&lingkungan=${pl.lingkungan}`)).daftar; } catch (e) { pesan(e.message); } }
    watch(() => [pl.tanggal, pl.lingkungan], muatPelanggar);
    const cetak = () => window.print();

    const MUAT = { input: muatSaya, sidang: muatAntrean, hasil: muatHasil, skorsing: muatSkors, pelanggar: muatPelanggar };
    watch(tab, (t) => { pesan(""); if (t !== "sidang" && t !== "hasil") sd.det = null; if (MUAT[t]) MUAT[t](); });
    onMounted(async () => {
      await muatMaster();
      try { const a = await api("/kedisiplinan/acuan"); f.tingkat = a.tingkat; f.batas = a.batas_batal_menit; } catch (e) { pesan(e.message); }
      if (MUAT[tab.value]) MUAT[tab.value]();
    });
    const warnaTingkat = (v) => !v ? "" : v.adalah_pemutihan ? "biru" : /berat/i.test(v.tingkat) ? "merah" : /sedang/i.test(v.tingkat) ? "kuning" : "hijau";
    return { bisa, me, TAB, tab, f, kategori, inp, kirimPelanggaran, batalInput, sd, vf, antreanTampil, tvSel, pilihanTingkat, bukaKasus, putus,
      hs, pr, lihatSantri, sk, buatSkors, batalSkors, pl, cetak, warnaTingkat };
  },
  template: `<div class="judul-hal tidak-cetak"><div><span class="jejak">Administrasi › Kesantrian</span><h1>Kedisiplinan</h1></div></div>
  <div class="tab tidak-cetak"><button v-for="t in TAB" :class="{aktif: tab===t[0]}" @click="tab=t[0]">{{ t[1] }}</button></div>
  <div class="tidak-cetak"><Pesan :galat="f.galat" :ok="f.ok"/></div>

  <template v-if="tab==='input'">
    <div class="kartu" style="display:flex;flex-direction:column;gap:12px;max-width:720px">
      <h2>Input pelanggaran (tuntutan)</h2>
      <label class="isian">Santri<CariSantri v-model="inp.santri"/></label>
      <div class="baris">
        <label class="isian">Kategori<select v-model="inp.kategori_id"><option value="" disabled>— pilih —</option><option v-for="k in kategori(inp.santri && inp.santri.lingkungan)" :value="k.id">{{ k.nama }}</option></select></label>
        <label class="isian">Tanggal<input type="date" v-model="inp.tanggal" :max="new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)"></label>
      </div>
      <label class="isian">Keterangan<textarea v-model="inp.keterangan" rows="3" maxlength="300"></textarea></label>
      <p class="redup">Input bisa dibatalkan pencatat dalam {{ f.batas }} menit (alasan wajib). Setelah itu hanya pemutus yang dapat memutihkan. Pencatat tidak boleh memutus kasus yang ia catat sendiri.</p>
      <div><button @click="kirimPelanggaran" :disabled="!inp.santri || !inp.kategori_id || !inp.keterangan.trim()">Kirim ke antrean sidang</button></div>
    </div>
    <h2>Input saya (7 hari terakhir)</h2>
    <div class="tabel"><table><thead><tr><th>Santri</th><th>Kategori</th><th>Tanggal</th><th>Keterangan</th><th>Status</th><th></th></tr></thead>
      <tbody v-baris><tr v-for="x in inp.saya" :key="x.id">
        <td><div class="santri-sel"><FotoSantri :s="x"/><span><strong>{{ x.nama }}</strong><div class="redup">{{ x.nis }} · {{ x.kelas }}</div></span></div></td>
        <td>{{ x.kategori }}</td><td>{{ x.tanggal }}</td><td>{{ x.keterangan }}</td>
        <td><span class="lencana" :class="{kuning: x.status==='menunggu', hijau: x.status==='divonis'}">{{ x.status }}</span></td>
        <td><button v-if="x.bisa_batal" class="bahaya kecil" @click="batalInput(x)" :title="'Bisa dibatalkan sampai ' + x.batas_batal">Batalkan</button></td>
      </tr></tbody></table>
      <p v-if="!inp.saya.length" class="redup" style="padding:14px">Belum ada input.</p></div>
  </template>

  <template v-if="tab==='sidang'">
    <h2>Antrean sidang</h2>
    <div class="baris">
      <label class="isian" style="flex:1 1 220px">Saring<input type="search" v-model="sd.saring" placeholder="Nama, NIS, keterangan (min. 2 huruf)"></label>
      <label class="isian">Kategori<select v-model="sd.kategori"><option value="">Semua</option><option v-for="k in kategori()" :value="k.nama">{{ k.nama }}</option></select></label>
    </div>
    <div class="tabel"><table><thead><tr><th>Santri</th><th>Kategori</th><th>Tanggal</th><th>Keterangan</th><th>Pencatat</th><th></th></tr></thead>
      <tbody v-baris><tr v-for="x in antreanTampil" :key="x.id">
        <td><div class="santri-sel"><FotoSantri :s="x"/><span><strong>{{ x.nama }}</strong><div class="redup">{{ x.nis }} · {{ x.kelas }}</div></span></div></td>
        <td>{{ x.kategori }}</td><td>{{ x.tanggal }}</td><td>{{ x.keterangan }}</td>
        <td>{{ x.pencatat || 'Sistem (overdue)' }}<div v-if="x.milik_sendiri"><span class="lencana kuning">Catatan Anda</span></div></td>
        <td><button class="kedua kecil" @click="bukaKasus(x)">Buka</button></td>
      </tr></tbody></table>
      <p v-if="!antreanTampil.length" class="redup" style="padding:14px">{{ sd.antrean.length ? 'Tidak ada yang cocok dengan saringan.' : 'Antrean kosong.' }}</p></div>
  </template>

  <template v-if="tab==='hasil'">
    <div class="baris">
      <label class="isian" style="flex:1 1 200px">Cari santri<input type="search" v-model="hs.q" placeholder="Nama atau NIS (min. 2 huruf)"></label>
      <label class="isian">Dari<input type="date" v-model="hs.dari"></label>
      <label class="isian">Sampai<input type="date" v-model="hs.sampai"></label>
      <label class="isian">Kategori<select v-model="hs.kategori_id"><option value="">Semua</option><option v-for="k in kategori()" :value="k.id">{{ k.nama }}</option></select></label>
      <label class="isian">Tingkat vonis<select v-model="hs.tingkat_vonis_id"><option value="">Semua</option><option v-for="t in f.tingkat" :value="t.id">{{ t.nama }}</option></select></label>
    </div>
    <div class="tabel" v-if="hs.data"><table><thead><tr><th>Santri</th><th>Kategori</th><th>Tanggal</th><th>Vonis berlaku</th><th></th></tr></thead>
      <tbody v-baris><tr v-for="x in hs.data" :key="x.id">
        <td><div class="santri-sel"><FotoSantri :s="x"/><span><strong>{{ x.nama }}</strong><div class="redup">{{ x.nis }} · {{ x.kelas }}</div></span></div></td>
        <td>{{ x.kategori }}</td><td>{{ x.tanggal }}</td>
        <td><span class="lencana" :class="warnaTingkat(x)">{{ x.tingkat }}</span></td>
        <td style="white-space:nowrap"><button class="kedua kecil" @click="lihatSantri(x)">Riwayat</button> <button v-if="bisa.putusan_kedisiplinan" class="kedua kecil" @click="bukaKasus(x)">Buka</button></td>
      </tr></tbody></table>
      <p v-if="!hs.data.length" class="redup" style="padding:14px">Tidak ada vonis pada rentang ini.</p></div>
  </template>

  <div class="kartu" v-if="sd.det && (tab==='sidang' || tab==='hasil')" style="display:flex;flex-direction:column;gap:12px;max-width:760px">
    <div class="baris" style="justify-content:space-between;align-items:center">
      <div class="santri-sel"><FotoSantri :s="sd.det"/><span><strong>{{ sd.det.nama }}</strong><div class="redup">{{ sd.det.nis }} · {{ sd.det.kelas }}</div></span></div>
      <button class="kedua kecil" @click="sd.det=null">Tutup</button></div>
    <div><span class="lencana">{{ sd.det.kategori }}</span> <span class="redup">{{ sd.det.tanggal }} · dicatat {{ sd.det.pencatat || 'sistem (overdue)' }} · {{ sd.det.dicatat_wib }} WIB</span></div>
    <div>{{ sd.det.keterangan }}</div>
    <div v-if="sd.det.vonis.length"><strong>Rantai putusan</strong>
      <ol><li v-for="v in sd.det.vonis" :key="v.id"><span class="lencana" :class="warnaTingkat(v)">{{ v.tingkat }}</span>
        {{ v.hukuman || '' }} <span class="redup">· {{ v.diputus_nama }} · {{ v.diputus_wib }} WIB{{ v.alasan ? ' · alasan: ' + v.alasan : '' }}</span>
        <strong v-if="sd.det.berlaku && v.id===sd.det.berlaku.id"> (berlaku)</strong></li></ol></div>
    <p v-if="sd.det.status==='dibatalkan'" class="pesan info">Pelanggaran ini dibatalkan: {{ sd.det.alasan_batal }}</p>
    <p v-else-if="sd.det.milik_sendiri" class="pesan info">Anda pencatat kasus ini, jadi tidak boleh memvonis atau memutihkannya.</p>
    <template v-else>
      <h2>{{ sd.det.berlaku ? 'Koreksi atau pemutihan' : 'Putusan' }}</h2>
      <label class="isian">Tingkat vonis<select v-model="vf.tingkat_vonis_id"><option value="" disabled>— pilih —</option><option v-for="t in pilihanTingkat" :value="t.id">{{ t.nama }}</option></select></label>
      <p class="redup" v-if="tvSel">{{ tvSel.adalah_pemutihan ? 'Kasus dianggap batal; data tetap tersimpan.' + (sd.det.berlaku ? ' Wali yang sempat dikabari menerima ralat.' : '') : tvSel.kabar_wali ? 'Wali diberi tahu ada keputusan kedisiplinan, tanpa isi vonis.' : 'Tidak dikirim ke wali.' }}</p>
      <label class="isian" v-if="tvSel && !tvSel.adalah_pemutihan">Hukuman<textarea v-model="vf.hukuman" rows="2" maxlength="300"></textarea></label>
      <label class="isian">Alasan{{ sd.det.berlaku || (tvSel && tvSel.adalah_pemutihan) ? ' (wajib)' : '' }}<textarea v-model="vf.alasan" rows="2" maxlength="300"></textarea></label>
      <div><button @click="putus" :disabled="!vf.tingkat_vonis_id">Simpan putusan</button></div>
    </template>
  </div>

  <template v-if="tab==='santri'">
    <div class="kartu" style="max-width:640px"><label class="isian">Santri<CariSantri v-model="pr.santri"/></label></div>
    <template v-if="pr.data">
      <div class="tabel"><table><thead><tr><th>Tanggal</th><th>Kategori</th><th v-if="pr.data.lengkap">Keterangan</th><th>Status</th><th>Rantai vonis</th></tr></thead>
        <tbody v-baris><tr v-for="x in pr.data.pelanggaran" :key="x.id">
          <td style="white-space:nowrap">{{ x.tanggal }}</td><td>{{ x.kategori }}</td>
          <td v-if="pr.data.lengkap">{{ x.keterangan }}<div class="redup">dicatat {{ x.pencatat || 'sistem' }}</div></td>
          <td><span class="lencana" :class="{kuning: x.status==='menunggu', hijau: x.status==='divonis'}">{{ x.status }}</span></td>
          <td><div v-for="v in x.vonis" :key="v.id" :style="{opacity: x.berlaku && v.id===x.berlaku.id ? 1 : .6}">
            <span class="lencana" :class="warnaTingkat(v)">{{ v.tingkat }}</span> <span v-if="v.hukuman">{{ v.hukuman }}</span> <span class="redup">{{ v.diputus_wib }}</span></div>
            <span v-if="!x.vonis.length" class="redup">—</span></td>
        </tr></tbody></table>
        <p v-if="!pr.data.pelanggaran.length" class="redup" style="padding:14px">Tidak ada catatan pelanggaran.</p></div>
      <template v-if="pr.data.skorsing.length"><h2>Skorsing</h2>
        <div class="tabel"><table><thead><tr><th>Mulai</th><th>Selesai</th><th>Alasan</th><th>Status</th></tr></thead>
          <tbody><tr v-for="x in pr.data.skorsing" :key="x.id"><td>{{ x.mulai }}</td><td>{{ x.selesai }}</td><td>{{ x.alasan }}</td><td>{{ x.status }}</td></tr></tbody></table></div></template>
    </template>
  </template>

  <template v-if="tab==='skorsing'">
    <div class="kartu" style="display:flex;flex-direction:column;gap:12px;max-width:720px">
      <h2>Skorsing baru</h2>
      <label class="isian">Santri<CariSantri v-model="sk.santri"/></label>
      <div class="baris">
        <label class="isian">Mulai<input type="date" v-model="sk.mulai"></label>
        <label class="isian">Selesai<input type="date" v-model="sk.selesai" :min="sk.mulai"></label>
        <label class="isian" v-if="sk.kasus.length">Pelanggaran terkait (opsional)<select v-model="sk.pelanggaran_id"><option value="">—</option><option v-for="p in sk.kasus" :value="p.id">{{ p.tanggal }} · {{ p.kategori }}</option></select></label>
      </div>
      <label class="isian">Alasan<textarea v-model="sk.alasan" rows="2" maxlength="300"></textarea></label>
      <p class="redup">Selama skorsing, status santri menjadi skorsing dan absensi otomatis Pulang. Status kembali aktif setelah tanggal selesai.</p>
      <div><button @click="buatSkors" :disabled="!sk.santri || !sk.alasan.trim()">Simpan skorsing</button></div>
    </div>
    <div class="baris" style="justify-content:space-between"><h2>{{ sk.riwayat ? 'Riwayat skorsing' : 'Skorsing aktif & terjadwal' }}</h2>
      <label class="redup" style="display:flex;gap:8px;align-items:center"><input type="checkbox" v-model="sk.riwayat"> Tampilkan riwayat</label></div>
    <div class="tabel"><table><thead><tr><th>Santri</th><th>Mulai</th><th>Selesai</th><th>Alasan</th><th>Keadaan</th><th></th></tr></thead>
      <tbody v-baris><tr v-for="x in sk.daftar" :key="x.id">
        <td><div class="santri-sel"><FotoSantri :s="x"/><span><strong>{{ x.nama }}</strong><div class="redup">{{ x.nis }} · {{ x.kelas }}</div></span></div></td>
        <td>{{ x.mulai }}</td><td>{{ x.selesai }}</td><td>{{ x.alasan }}<div class="redup" v-if="x.alasan_batal">Dibatalkan: {{ x.alasan_batal }}</div></td>
        <td><span class="lencana" :class="{merah: x.keadaan==='berjalan', kuning: x.keadaan==='terjadwal', hijau: x.keadaan==='selesai'}">{{ x.keadaan }}</span></td>
        <td><button v-if="x.status==='aktif'" class="bahaya kecil" @click="batalSkors(x)">Batalkan</button></td>
      </tr></tbody></table>
      <p v-if="!sk.daftar.length" class="redup" style="padding:14px">Tidak ada data.</p></div>
  </template>

  <template v-if="tab==='pelanggar'">
    <div class="baris tidak-cetak">
      <label class="isian">Tanggal<input type="date" v-model="pl.tanggal"></label>
      <label class="isian" v-if="me.lingkungan==='semua'">Lingkungan<select v-model="pl.lingkungan"><option value="">Putra & Putri</option><option value="putra">Putra</option><option value="putri">Putri</option></select></label>
      <button @click="cetak" :disabled="!pl.data || !pl.data.length">Cetak</button>
    </div>
    <h2>Daftar pelanggar {{ pl.tanggal }}</h2>
    <p class="redup tidak-cetak">Dibacakan Bagian Bahasa ba'da isya. Hanya nama, kelas, dan kategori; pelanggaran yang dibatalkan atau diputihkan tidak ikut.</p>
    <div class="tabel" v-if="pl.data"><table><thead><tr><th>No</th><th>Nama</th><th>Kelas</th><th>Kategori</th><th v-if="me.lingkungan==='semua' && !pl.lingkungan">Lingkungan</th></tr></thead>
      <tbody><tr v-for="(x, i) in pl.data" :key="x.id"><td>{{ i + 1 }}</td><td><strong>{{ x.nama }}</strong></td><td>{{ x.kelas }}</td><td>{{ x.kategori }}</td><td v-if="me.lingkungan==='semua' && !pl.lingkungan">{{ x.lingkungan }}</td></tr></tbody></table>
      <p v-if="!pl.data.length" class="redup" style="padding:14px">Tidak ada pelanggar pada tanggal ini.</p></div>
  </template>`,
};
daftarHalaman("/kedisiplinan", Kedisiplinan, {
  label: "Kedisiplinan", grup: "Administrasi", urutan: 50,
  syarat: (me) => me.bisa.input_pelanggaran || me.bisa.putusan_kedisiplinan || me.bisa.lihat_vonis,
  ikon: '<path d="M12 3v18"/><path d="M5 21h14"/><path d="M4 8h16"/><path d="M4 8l-2.5 6a3 3 0 0 0 5 0z"/><path d="M20 8l-2.5 6a3 3 0 0 0 5 0z"/>',
});
