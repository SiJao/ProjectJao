// Modul tampilan Tata Warkat — Kalender Akademik (semua lihat), Korespondensi & Inventaris (akses tata_warkat).
// Nama global berawalan "tw"/"Tw" agar tidak bertabrakan dengan skrip modul lain.
const TW_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const TW_HARI = ["Ahd", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const TW_KAT = [["umum", "Umum", "biru"], ["akademik", "Akademik", "hijau"], ["pengasuhan", "Pengasuhan", "kuning"]];
const TW_KONDISI = { bagus: ["Bagus", "hijau"], rusak_ringan: ["Rusak ringan", "kuning"], rusak_berat: ["Rusak berat", "merah"], hilang: ["Hilang", ""] };
const twBulanGeser = (ym, n) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
const twAkhirBulan = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const twNamaBulan = (ym) => TW_BULAN[+ym.slice(5, 7) - 1] + " " + ym.slice(0, 4);
const twTglPanjang = (t) => t ? +t.slice(8, 10) + " " + TW_BULAN[+t.slice(5, 7) - 1].slice(0, 3) + " " + t.slice(0, 4) : "";
const twRentang = (a) => a.mulai === a.selesai ? twTglPanjang(a.mulai) : twTglPanjang(a.mulai) + " – " + twTglPanjang(a.selesai);

// Kotak cari langsung: tunda 250 ms, minimal 2 huruf (kosong = tampilkan semua), saran maks. 5.
const TwCari = {
  props: { saran: { type: Array, default: () => [] }, label: { type: String, default: "Cari" }, placeholder: String },
  emits: ["cari", "pilih"],
  setup(props, { emit }) {
    const q = ref(""), buka = ref(false);
    let t;
    watch(q, (v) => {
      clearTimeout(t);
      const s = v.trim();
      if (s.length === 1) { buka.value = false; return; }
      t = setTimeout(() => { emit("cari", s); buka.value = s.length >= 2; }, 250);
    });
    const pilih = (x) => { buka.value = false; emit("pilih", x); };
    return { q, buka, pilih };
  },
  template: `<div style="position:relative;flex:1 1 220px">
    <label class="isian">{{ label }}<input v-model="q" type="search" :placeholder="placeholder || 'Ketik min. 2 huruf'" autocomplete="off" @focus="buka = q.trim().length >= 2" @blur="buka = false" @keydown.esc="buka = false"></label>
    <div v-if="buka && saran.length" class="kartu saran" style="top:100%">
      <button v-for="x in saran.slice(0, 5)" :key="x.id" type="button" @mousedown.prevent="pilih(x)"><span><strong>{{ x.teks }}</strong> <span class="redup">{{ x.sub }}</span></span></button>
    </div></div>`,
};

// ---------------------------------------------------------------- Kalender Akademik
const TwKalender = {
  components: { Pesan, TwCari },
  setup() {
    const me = negara.me, bisaUbah = !!me.bisa.tata_warkat, pilihLing = me.lingkungan === "semua";
    const k = reactive({ tampilan: "1b", awal: hariIni().slice(0, 7), agenda: [], mk: null, kategori: "", ling: "", q: "", form: null, galat: "", ok: "", muat: false });
    // Rentang 2 Semester = masa khidmat aktif: mulai .. COALESCE(selesai, mulai + 12 bulan); tanpa masa khidmat: 12 bulan dari bulan ini.
    const rentang2s = computed(() => {
      if (!k.mk) return { awal: hariIni().slice(0, 7), akhir: twBulanGeser(hariIni().slice(0, 7), 11) };
      let akhir = k.mk.selesai;
      if (!akhir) { const [y, m, d] = k.mk.mulai.split("-").map(Number); akhir = new Date(Date.UTC(y + 1, m - 1, d - 1)).toISOString().slice(0, 10); }
      return { awal: k.mk.mulai.slice(0, 7), akhir: akhir.slice(0, 7) };
    });
    const bulanList = computed(() => {
      const out = [];
      if (k.tampilan === "2s") { for (let b = rentang2s.value.awal; b <= rentang2s.value.akhir && out.length < 24; b = twBulanGeser(b, 1)) out.push(b); return out; }
      const n = { "1b": 1, "2b": 2, "1s": 6 }[k.tampilan];
      for (let i = 0; i < n; i++) out.push(twBulanGeser(k.awal, i));
      return out;
    });
    const ringkas = computed(() => ["1s", "2s"].includes(k.tampilan));
    async function muat() {
      const b = bulanList.value;
      const q = new URLSearchParams({ dari: b[0] + "-01", sampai: twAkhirBulan(b[b.length - 1]) });
      if (k.q) q.set("q", k.q);
      if (k.kategori) q.set("kategori", k.kategori);
      k.muat = true;
      try { const r = await api("/agenda?" + q); k.agenda = r.agenda; k.mk = r.masa_khidmat; } catch (e) { k.galat = e.message; }
      k.muat = false;
    }
    watch(() => [bulanList.value[0], bulanList.value[bulanList.value.length - 1], k.q, k.kategori].join("|"), muat, { immediate: true });
    const tampil = computed(() => k.agenda.filter((a) => !k.ling || a.lingkungan === k.ling));
    const hariBulan = (ym) => {
      const pertama = new Date(ym + "-01T00:00:00Z").getUTCDay(), akhir = +twAkhirBulan(ym).slice(8, 10), sel = [];
      for (let i = 0; i < pertama; i++) sel.push({ kosong: true, kunci: "k" + i });
      for (let d = 1; d <= akhir; d++) { const tgl = ym + "-" + String(d).padStart(2, "0"); sel.push({ tgl, n: d, kunci: tgl }); }
      return sel;
    };
    const agendaHari = (tgl) => tampil.value.filter((a) => a.mulai <= tgl && a.selesai >= tgl);
    const agendaBulan = (ym) => tampil.value.filter((a) => a.mulai <= twAkhirBulan(ym) && a.selesai >= ym + "-01");
    const kat = (a) => TW_KAT.filter(([x]) => a["kategori_" + x]);
    const warna = (a) => (kat(a)[0] || [])[2] || "";
    const geser = (arah) => { k.awal = twBulanGeser(k.awal, arah * ({ "1b": 1, "2b": 2, "1s": 6 }[k.tampilan] || 1)); };
    const saran = computed(() => tampil.value.map((a) => ({ id: a.id, teks: a.judul, sub: twRentang(a) + (pilihLing ? " · " + a.lingkungan : ""), a })));
    function pilihSaran(x) { if (k.tampilan !== "2s") k.awal = x.a.mulai.slice(0, 7); if (bisaUbah) ubah(x.a); }
    const kosong = () => ({ id: null, judul: "", mulai: hariIni(), selesai: hariIni(), keterangan: "", kategori_umum: true, kategori_akademik: false, kategori_pengasuhan: false, lingkungan: pilihLing ? "" : me.lingkungan });
    const baru = (tgl) => { if (!bisaUbah) return; k.ok = ""; k.galat = ""; k.form = { ...kosong(), ...(tgl ? { mulai: tgl, selesai: tgl } : {}) }; };
    const ubah = (a) => { k.ok = ""; k.galat = ""; k.form = { ...a, kategori_umum: !!a.kategori_umum, kategori_akademik: !!a.kategori_akademik, kategori_pengasuhan: !!a.kategori_pengasuhan, keterangan: a.keterangan || "" }; };
    async function simpan() {
      k.galat = ""; k.ok = "";
      try { await api("/agenda", k.form); k.ok = "Agenda tersimpan."; k.form = null; await muat(); } catch (e) { k.galat = e.message; }
    }
    async function hapus() {
      if (!confirm("Hapus agenda \"" + k.form.judul + "\"?")) return;
      k.galat = ""; k.ok = "";
      try { await api(`/agenda/${k.form.id}/hapus`, {}); k.ok = "Agenda dihapus."; k.form = null; await muat(); } catch (e) { k.galat = e.message; }
    }
    const cetak = () => window.print();
    const judulRentang = computed(() => { const b = bulanList.value; return b.length === 1 ? twNamaBulan(b[0]) : twNamaBulan(b[0]) + " – " + twNamaBulan(b[b.length - 1]); });
    return { k, bisaUbah, pilihLing, bulanList, ringkas, hariBulan, agendaHari, agendaBulan, kat, warna, geser, saran, pilihSaran, baru, ubah, simpan, hapus, cetak,
      judulRentang, twNamaBulan, twRentang, TW_HARI, TW_KAT, hariIni, rentang2s };
  },
  template: `<div class="kartu tidak-cetak" style="display:flex;flex-direction:column;gap:12px">
    <div class="tab"><button v-for="[v, l] in [['1b','1 Bulan'],['2b','2 Bulan'],['1s','1 Semester'],['2s','2 Semester']]" :key="v" :class="{aktif: k.tampilan===v}" @click="k.tampilan=v">{{ l }}</button></div>
    <div class="baris">
      <template v-if="k.tampilan !== '2s'">
        <button class="kedua" @click="geser(-1)" aria-label="Sebelumnya">‹</button>
        <label class="isian">Mulai bulan<input type="month" v-model="k.awal"></label>
        <button class="kedua" @click="geser(1)" aria-label="Berikutnya">›</button>
        <button class="kedua" @click="k.awal = hariIni().slice(0, 7)">Bulan ini</button>
      </template>
      <span v-else class="redup">{{ k.mk ? 'Masa khidmat ' + k.mk.nama + ' (' + k.mk.mulai + ' s.d. ' + (k.mk.selesai || '±12 bulan') + ')' : 'Belum ada masa khidmat aktif — 12 bulan mulai bulan ini.' }}</span>
    </div>
    <div class="baris">
      <TwCari label="Cari agenda" :saran="saran" @cari="(v) => k.q = v" @pilih="pilihSaran"/>
      <label class="isian">Kategori<select v-model="k.kategori"><option value="">Semua kategori</option><option v-for="[v, l] in TW_KAT" :key="v" :value="v">{{ l }}</option></select></label>
      <label class="isian" v-if="pilihLing">Lingkungan<select v-model="k.ling"><option value="">Putra & Putri</option><option value="putra">Putra</option><option value="putri">Putri</option></select></label>
      <button v-if="bisaUbah" @click="baru()">Tambah agenda</button>
      <button class="kedua" @click="cetak">Cetak</button>
    </div>
    <div class="baris" style="gap:8px"><span class="redup">Kategori:</span><span v-for="[v, l, w] in TW_KAT" :key="v" class="lencana" :class="w">{{ l }}</span></div>
  </div>
  <Pesan :galat="k.galat" :ok="k.ok"/>
  <form v-if="k.form" class="kartu tidak-cetak" style="display:flex;flex-direction:column;gap:12px" @submit.prevent="simpan">
    <h2>{{ k.form.id ? 'Ubah agenda' : 'Agenda baru' }}</h2>
    <div class="baris">
      <label class="isian" style="flex:1 1 260px">Judul<input v-model="k.form.judul" maxlength="150" required></label>
      <label class="isian">Mulai<input type="date" v-model="k.form.mulai" required></label>
      <label class="isian">Selesai<input type="date" v-model="k.form.selesai" :min="k.form.mulai"></label>
      <label class="isian" v-if="pilihLing">Lingkungan<select v-model="k.form.lingkungan" required><option value="" disabled>Pilih…</option><option value="putra">Putra</option><option value="putri">Putri</option></select></label>
    </div>
    <div class="baris" style="align-items:center"><span class="redup">Kategori (minimal satu):</span>
      <label v-for="[v, l] in TW_KAT" :key="v" style="display:flex;gap:6px;align-items:center"><input type="checkbox" v-model="k.form['kategori_' + v]">{{ l }}</label></div>
    <label class="isian">Keterangan<textarea v-model="k.form.keterangan" maxlength="1000" rows="2"></textarea></label>
    <div class="baris"><button>Simpan</button><button type="button" class="kedua" @click="k.form = null">Batal</button>
      <button v-if="k.form.id" type="button" class="bahaya" @click="hapus">Hapus</button></div>
  </form>
  <h2>Kalender {{ judulRentang }}</h2>
  <div :style="{display:'grid', gap:'14px', gridTemplateColumns: ringkas ? 'repeat(auto-fill,minmax(min(280px,100%),1fr))' : 'repeat(auto-fill,minmax(min(460px,100%),1fr))'}">
    <section v-for="ym in bulanList" :key="ym" class="kartu" style="display:flex;flex-direction:column;gap:8px;break-inside:avoid">
      <h2 style="font-size:16px">{{ twNamaBulan(ym) }}</h2>
      <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px">
        <div v-for="h in TW_HARI" :key="h" class="redup" style="font-size:11px;font-weight:700;text-align:center">{{ h }}</div>
        <div v-for="c in hariBulan(ym)" :key="c.kunci" :style="{minHeight: ringkas ? '30px' : '64px', border: c.kosong ? '0' : '1px solid var(--garis-tipis)', borderRadius: '6px', padding: '2px', background: c.tgl === hariIni() ? 'var(--hijau-pucat)' : '', cursor: bisaUbah && !c.kosong ? 'pointer' : 'default', overflow: 'hidden'}"
          @dblclick="!c.kosong && baru(c.tgl)">
          <template v-if="!c.kosong"><div style="font-size:11px" :style="{fontWeight: c.tgl === hariIni() ? 700 : 400}">{{ c.n }}</div>
            <span v-for="a in agendaHari(c.tgl).slice(0, ringkas ? 3 : 4)" :key="a.id" class="lencana" :class="warna(a)" :title="a.judul"
              :style="{display:'block', overflow:'hidden', textOverflow:'ellipsis', fontSize:'10px', padding: ringkas ? '0' : '1px 5px', minHeight: ringkas ? '4px' : '', marginTop:'2px'}"
              @click.stop="bisaUbah && ubah(a)">{{ ringkas ? '' : a.judul }}</span></template>
        </div>
      </div>
      <div v-for="a in agendaBulan(ym)" :key="a.id" style="display:flex;gap:8px;flex-wrap:wrap;align-items:baseline;border-top:1px solid var(--garis-tipis);padding-top:6px;font-size:13px">
        <span class="redup" style="white-space:nowrap">{{ twRentang(a) }}</span><strong>{{ a.judul }}</strong>
        <span v-for="[v, l, w] in kat(a)" :key="v" class="lencana" :class="w">{{ l }}</span>
        <span v-if="pilihLing" class="redup">{{ a.lingkungan }}</span>
        <span v-if="a.keterangan" class="redup">{{ a.keterangan }}</span>
        <button v-if="bisaUbah" class="kedua kecil tidak-cetak" @click="ubah(a)">Ubah</button>
      </div>
      <p v-if="!agendaBulan(ym).length" class="redup" style="margin:0;font-size:13px">Tidak ada agenda.</p>
    </section>
  </div>
  <p v-if="bisaUbah" class="redup tidak-cetak">Klik dua kali tanggal untuk menambah agenda; klik agenda untuk mengubah.</p>`,
};

// ---------------------------------------------------------------- Korespondensi
const TwSurat = {
  components: { Pesan, TwCari },
  directives: { baris: vBaris },
  setup() {
    const pilihLing = negara.me.lingkungan === "semua";
    const s = reactive({ arah: "", dari: "", sampai: "", disposisi: "", q: "", list: [], form: null, galat: "", ok: "" });
    async function muat() {
      const q = new URLSearchParams();
      for (const x of ["arah", "dari", "sampai", "disposisi", "q"]) if (s[x]) q.set(x, s[x]);
      try { s.list = await api("/surat?" + q); } catch (e) { s.galat = e.message; }
    }
    watch(() => [s.arah, s.dari, s.sampai, s.disposisi, s.q], muat, { immediate: true });
    const saran = computed(() => s.list.map((x) => ({ id: x.id, teks: x.nomor + " — " + x.perihal, sub: x.tanggal + (x.pihak ? " · " + x.pihak : ""), x })));
    const baru = (arah) => { s.galat = ""; s.ok = ""; s.form = { id: null, arah, nomor: "", tanggal: hariIni(), perihal: "", pihak: "", status_disposisi: arah === "masuk" ? "Belum didisposisi" : "", lampiran_url: "", lingkungan: pilihLing ? "" : negara.me.lingkungan }; };
    const ubah = (x) => { s.galat = ""; s.ok = ""; s.form = { ...x, pihak: x.pihak || "", status_disposisi: x.status_disposisi || "", lampiran_url: x.lampiran_url || "" }; };
    const lampiranSah = (u) => !u || /^https:\/\/(docs|drive)\.google\.com\//.test(u);
    async function simpan() {
      s.galat = ""; s.ok = "";
      if (!lampiranSah(s.form.lampiran_url)) { s.galat = "Lampiran harus tautan Google Docs/Drive."; return; }
      try { await api("/surat", s.form); s.ok = "Surat tersimpan."; s.form = null; await muat(); } catch (e) { s.galat = e.message; }
    }
    async function hapus() {
      if (!confirm("Hapus catatan surat " + s.form.nomor + "?")) return;
      try { await api(`/surat/${s.form.id}/hapus`, {}); s.ok = "Catatan surat dihapus."; s.form = null; await muat(); } catch (e) { s.galat = e.message; }
    }
    function ekspor() {
      const baris = [["Arah", "Nomor", "Tanggal", "Perihal", "Tujuan / Asal", "Status disposisi", "Lampiran", "Lingkungan", "Dicatat oleh"],
        ...s.list.map((x) => [x.arah === "keluar" ? "Keluar" : "Masuk", x.nomor, x.tanggal, x.perihal, x.pihak, x.status_disposisi, x.lampiran_url, x.lingkungan, x.dicatat_oleh_nama])];
      unduhXlsx(`korespondensi-${hariIni()}.xlsx`, [{ nama: "Korespondensi", baris }]);
    }
    return { s, pilihLing, saran, baru, ubah, simpan, hapus, ekspor, lampiranSah };
  },
  template: `<div class="kartu" style="display:flex;flex-direction:column;gap:12px">
    <div class="baris">
      <TwCari label="Cari nomor / perihal / pihak" :saran="saran" @cari="(v) => s.q = v" @pilih="(x) => ubah(x.x)"/>
      <label class="isian">Arah<select v-model="s.arah"><option value="">Keluar & masuk</option><option value="keluar">Surat keluar</option><option value="masuk">Surat masuk</option></select></label>
      <label class="isian">Dari tanggal<input type="date" v-model="s.dari"></label>
      <label class="isian">Sampai<input type="date" v-model="s.sampai" :min="s.dari"></label>
      <label class="isian">Disposisi<select v-model="s.disposisi"><option value="">Semua</option><option value="-">Belum diisi</option><option>Belum didisposisi</option><option>Sudah didisposisi</option><option>Selesai ditindaklanjuti</option></select></label>
    </div>
    <div class="baris"><button @click="baru('keluar')">Catat surat keluar</button><button @click="baru('masuk')">Catat surat masuk</button>
      <button class="kedua" @click="ekspor" :disabled="!s.list.length">Unduh .xlsx</button><span class="redup">{{ s.list.length }} surat</span></div>
  </div>
  <Pesan :galat="s.galat" :ok="s.ok"/>
  <form v-if="s.form" class="kartu" style="display:flex;flex-direction:column;gap:12px" @submit.prevent="simpan">
    <h2>{{ s.form.id ? 'Ubah' : 'Catat' }} surat {{ s.form.arah }}</h2>
    <div class="baris">
      <label class="isian">Nomor {{ s.form.arah === 'masuk' ? '(sesuai fisik)' : '' }}<input v-model="s.form.nomor" maxlength="80" required></label>
      <label class="isian">Tanggal<input type="date" v-model="s.form.tanggal" required></label>
      <label class="isian" v-if="pilihLing">Lingkungan<select v-model="s.form.lingkungan" required><option value="" disabled>Pilih…</option><option value="putra">Putra</option><option value="putri">Putri</option></select></label>
    </div>
    <label class="isian">Perihal<input v-model="s.form.perihal" maxlength="200" required></label>
    <div class="baris">
      <label class="isian" style="flex:1 1 220px">{{ s.form.arah === 'keluar' ? 'Tujuan' : 'Asal' }}<input v-model="s.form.pihak" maxlength="150"></label>
      <label class="isian" v-if="s.form.arah === 'masuk'">Status disposisi<input v-model="s.form.status_disposisi" list="tw-disposisi" maxlength="80"></label>
      <datalist id="tw-disposisi"><option>Belum didisposisi</option><option>Sudah didisposisi</option><option>Selesai ditindaklanjuti</option></datalist>
    </div>
    <label class="isian">Lampiran (tautan Google Docs/Drive)<input v-model.trim="s.form.lampiran_url" type="url" placeholder="https://docs.google.com/…" maxlength="500"></label>
    <div v-if="!lampiranSah(s.form.lampiran_url)" class="pesan galat">Hanya tautan https://docs.google.com/ atau https://drive.google.com/.</div>
    <div class="baris"><button>Simpan</button><button type="button" class="kedua" @click="s.form = null">Batal</button>
      <button v-if="s.form.id" type="button" class="bahaya" @click="hapus">Hapus</button></div>
  </form>
  <div class="tabel"><table>
    <thead><tr><th>Tanggal</th><th>Arah</th><th>Nomor</th><th>Perihal</th><th>Tujuan / Asal</th><th>Disposisi</th><th>Lampiran</th><th></th></tr></thead>
    <tbody v-baris><tr v-for="x in s.list" :key="x.id">
      <td style="white-space:nowrap">{{ x.tanggal }}</td>
      <td><span class="lencana" :class="x.arah === 'keluar' ? 'biru' : 'hijau'">{{ x.arah }}</span><div v-if="pilihLing" class="redup">{{ x.lingkungan }}</div></td>
      <td>{{ x.nomor }}</td><td>{{ x.perihal }}</td><td>{{ x.pihak }}</td>
      <td>{{ x.arah === 'masuk' ? (x.status_disposisi || '—') : '' }}</td>
      <td><a v-if="x.lampiran_url" :href="x.lampiran_url" target="_blank" rel="noopener noreferrer">Buka</a></td>
      <td><button class="kedua kecil" @click="ubah(x)">Ubah</button></td>
    </tr></tbody></table></div>
  <p v-if="!s.list.length" class="redup">Belum ada surat yang cocok.</p>`,
};

// ---------------------------------------------------------------- Inventaris Barang
const TwInventaris = {
  components: { Pesan, TwCari },
  directives: { baris: vBaris, hitung: vHitung },
  setup() {
    const pilihLing = negara.me.lingkungan === "semua";
    const b = reactive({ q: "", kondisi: "", kategori: "", aktif: false, data: { barang: [], ringkasan: {} }, sel: null, form: null, unit: null, galat: "", ok: "" });
    async function muat() {
      const q = new URLSearchParams();
      for (const x of ["q", "kondisi", "kategori"]) if (b[x]) q.set(x, b[x]);
      if (b.aktif) q.set("aktif", "1");
      try { b.data = await api("/barang?" + q); } catch (e) { b.galat = e.message; }
    }
    watch(() => [b.q, b.kondisi, b.kategori, b.aktif], muat, { immediate: true });
    const saran = computed(() => b.data.barang.map((x) => ({ id: x.id, teks: x.kode + " — " + x.nama, sub: x.jumlah + " unit" + (pilihLing ? " · " + x.lingkungan : ""), x })));
    const jalan = async (fn, pesan) => { b.galat = ""; b.ok = ""; try { await fn(); b.ok = pesan; return true; } catch (e) { b.galat = e.message; return false; } };
    async function buka(x) { b.galat = ""; try { b.sel = await api("/barang/" + x.id); b.unit = { kode_unit: "", kategori: "baru", kondisi: "bagus", keterangan: "" }; } catch (e) { b.galat = e.message; } }
    const baru = () => { b.form = { id: null, kode: "", nama: "", aktif: true, lingkungan: pilihLing ? "" : negara.me.lingkungan }; };
    const ubah = (x) => { b.form = { id: x.id, kode: x.kode, nama: x.nama, aktif: !!x.aktif }; };
    async function simpan() { if (await jalan(() => api("/barang", b.form), "Barang tersimpan.")) { const id = b.form.id; b.form = null; await muat(); if (b.sel && b.sel.id === id) await buka(b.sel); } }
    async function tambahUnit() { if (await jalan(() => api(`/barang/${b.sel.id}/unit`, b.unit), "Unit ditambahkan.")) { await buka(b.sel); await muat(); } }
    async function ubahUnit(un, data) { if (await jalan(() => api(`/barang/${b.sel.id}/unit`, { ...un, ...data }), "Unit diperbarui.")) { await buka(b.sel); await muat(); } }
    async function ekspor() {
      b.galat = "";
      try {
        const [semua, unit] = await Promise.all([api("/barang"), api("/barang-unit")]);
        const L = (k) => TW_KONDISI[k][0];
        unduhXlsx(`inventaris-${hariIni()}.xlsx`, [
          { nama: "Barang", baris: [["Lingkungan", "Kode", "Nama", "Aktif", "Jumlah unit", "Bagus", "Rusak ringan", "Rusak berat", "Hilang", "Lama", "Baru"],
            ...semua.barang.map((x) => [x.lingkungan, x.kode, x.nama, x.aktif ? "Ya" : "Tidak", x.jumlah, x.bagus, x.rusak_ringan, x.rusak_berat, x.hilang, x.lama, x.baru])] },
          { nama: "Unit", baris: [["Lingkungan", "Kode barang", "Nama barang", "Kode unit", "Kategori", "Kondisi", "Keterangan"],
            ...unit.map((x) => [x.lingkungan, x.kode, x.nama, x.kode_unit, x.kategori, L(x.kondisi), x.keterangan])] },
        ]);
      } catch (e) { b.galat = e.message; }
    }
    return { b, pilihLing, saran, buka, baru, ubah, simpan, tambahUnit, ubahUnit, ekspor, TW_KONDISI };
  },
  template: `<div class="kisi">
    <div class="kartu stat"><div class="redup">Total unit</div><div class="angka" v-hitung="b.data.ringkasan.total"></div></div>
    <button v-for="(v, kd) in TW_KONDISI" :key="kd" type="button" class="kartu stat" style="text-align:left;color:inherit;font-weight:400;display:block" :aria-pressed="b.kondisi === kd" @click="b.kondisi = b.kondisi === kd ? '' : kd">
      <div class="redup">{{ v[0] }}{{ b.kondisi === kd ? ' (filter)' : '' }}</div><div class="angka" v-hitung="b.data.ringkasan[kd]"></div></button>
  </div>
  <div class="kartu baris">
    <TwCari label="Cari kode / nama barang" :saran="saran" @cari="(v) => b.q = v" @pilih="(x) => buka(x.x)"/>
    <label class="isian">Kondisi unit<select v-model="b.kondisi"><option value="">Semua</option><option v-for="(v, kd) in TW_KONDISI" :key="kd" :value="kd">{{ v[0] }}</option></select></label>
    <label class="isian">Kategori unit<select v-model="b.kategori"><option value="">Semua</option><option value="lama">Lama</option><option value="baru">Baru</option></select></label>
    <label style="display:flex;gap:6px;align-items:center;min-height:42px"><input type="checkbox" v-model="b.aktif">Hanya barang aktif</label>
    <button @click="baru">Tambah barang</button><button class="kedua" @click="ekspor">Unduh .xlsx</button>
  </div>
  <Pesan :galat="b.galat" :ok="b.ok"/>
  <form v-if="b.form" class="kartu baris" @submit.prevent="simpan">
    <label class="isian">Kode barang<input v-model="b.form.kode" maxlength="40" required></label>
    <label class="isian" style="flex:1 1 220px">Nama barang<input v-model="b.form.nama" maxlength="150" required></label>
    <label class="isian" v-if="pilihLing && !b.form.id">Lingkungan<select v-model="b.form.lingkungan" required><option value="" disabled>Pilih…</option><option value="putra">Putra</option><option value="putri">Putri</option></select></label>
    <label style="display:flex;gap:6px;align-items:center;min-height:42px"><input type="checkbox" v-model="b.form.aktif">Aktif</label>
    <button>Simpan</button><button type="button" class="kedua" @click="b.form = null">Batal</button>
  </form>
  <div class="dua-kolom">
    <div class="tabel" style="flex:1.3 1 420px"><table>
      <thead><tr><th>Kode</th><th>Nama</th><th>Unit</th><th>Kondisi</th><th></th></tr></thead>
      <tbody v-baris><tr v-for="x in b.data.barang" :key="x.id" :style="{background: b.sel && b.sel.id === x.id ? 'var(--hijau-pucat)' : '', opacity: x.aktif ? 1 : .6}">
        <td><strong>{{ x.kode }}</strong><div v-if="pilihLing" class="redup">{{ x.lingkungan }}</div></td>
        <td>{{ x.nama }}<span v-if="!x.aktif" class="lencana" style="margin-left:6px">nonaktif</span></td>
        <td>{{ x.jumlah }}</td>
        <td><template v-for="(v, kd) in TW_KONDISI" :key="kd"><span v-if="x[kd]" class="lencana" :class="v[1]" style="margin:1px">{{ v[0] }} {{ x[kd] }}</span></template></td>
        <td style="white-space:nowrap"><button class="kedua kecil" @click="buka(x)">Unit</button> <button class="kedua kecil" @click="ubah(x)">Ubah</button></td>
      </tr></tbody></table>
      <p v-if="!b.data.barang.length" class="redup" style="padding:0 14px">Belum ada barang yang cocok.</p></div>
    <div v-if="b.sel" class="kartu" style="display:flex;flex-direction:column;gap:10px">
      <h2>{{ b.sel.kode }} — {{ b.sel.nama }}</h2>
      <div class="tabel"><table><thead><tr><th>Kode unit</th><th>Kategori</th><th>Kondisi</th><th>Keterangan</th></tr></thead>
        <tbody><tr v-for="un in b.sel.unit" :key="un.id">
          <td>{{ un.kode_unit }}</td>
          <td><select :value="un.kategori" @change="ubahUnit(un, {kategori: $event.target.value})" aria-label="Kategori"><option value="lama">Lama</option><option value="baru">Baru</option></select></td>
          <td><select :value="un.kondisi" @change="ubahUnit(un, {kondisi: $event.target.value})" aria-label="Kondisi"><option v-for="(v, kd) in TW_KONDISI" :key="kd" :value="kd">{{ v[0] }}</option></select></td>
          <td><input :value="un.keterangan" maxlength="300" @change="ubahUnit(un, {keterangan: $event.target.value})" aria-label="Keterangan"></td>
        </tr></tbody></table></div>
      <p v-if="!b.sel.unit.length" class="redup" style="margin:0">Belum ada unit.</p>
      <form class="baris" @submit.prevent="tambahUnit">
        <label class="isian">Kode unit<input v-model="b.unit.kode_unit" maxlength="40" required></label>
        <label class="isian">Kategori<select v-model="b.unit.kategori"><option value="baru">Baru</option><option value="lama">Lama</option></select></label>
        <label class="isian">Kondisi<select v-model="b.unit.kondisi"><option v-for="(v, kd) in TW_KONDISI" :key="kd" :value="kd">{{ v[0] }}</option></select></label>
        <label class="isian">Keterangan<input v-model="b.unit.keterangan" maxlength="300"></label>
        <button>Tambah unit</button>
      </form>
    </div>
  </div>`,
};

const TataWarkat = {
  components: { TwKalender, TwSurat, TwInventaris },
  setup() {
    const bisa = !!negara.me.bisa.tata_warkat;
    const tab = ref("kalender");
    return { tab, bisa };
  },
  template: `<div class="tidak-cetak"><span class="jejak">Administrasi</span><h1>Tata Warkat</h1></div>
  <div class="tab tidak-cetak" v-if="bisa"><button :class="{aktif: tab==='kalender'}" @click="tab='kalender'">Kalender Akademik</button><button :class="{aktif: tab==='surat'}" @click="tab='surat'">Korespondensi</button><button :class="{aktif: tab==='barang'}" @click="tab='barang'">Inventaris Barang</button></div>
  <TwKalender v-if="tab==='kalender'"/>
  <TwSurat v-else-if="tab==='surat'"/>
  <TwInventaris v-else/>`,
};
daftarHalaman("/tata-warkat", TataWarkat, { label: "Tata Warkat", grup: "Administrasi", urutan: 80, syarat: () => true,
  ikon: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>' });
