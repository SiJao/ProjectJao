// Modul tampilan Cari Santri & Guru — live search (jeda 250 ms, min. 2 huruf, maks. 5 saran) + saringan; kartu detail tanpa data kesehatan.
const CariSantriGuru = {
  components: { Pesan, FotoSantri },
  setup() {
    const moderator = computed(() => negara.me && negara.me.role === "moderator");
    const m = computed(() => negara.master || {});
    const tab = ref("santri");
    const galat = ref("");
    // ---- santri
    const s = reactive({ q: "", kelas_id: "", kamar_id: "", status: "aktif", ling: "", hasil: [], detail: null, memuat: false });
    let tS;
    const adaFilter = () => s.kelas_id || s.kamar_id || s.ling || s.status !== "aktif";
    async function cariSantri() {
      galat.value = "";
      if (s.q.trim().length < 2 && !adaFilter()) { s.hasil = []; return; }
      s.memuat = true;
      const p = new URLSearchParams({ q: s.q.trim(), limit: 5, status: s.status });
      if (s.kelas_id) p.set("kelas_id", s.kelas_id);
      if (s.kamar_id) p.set("kamar_id", s.kamar_id);
      if (s.ling) p.set("ling", s.ling);
      try { s.hasil = (await api("/santri?" + p)).slice(0, 5); } catch (e) { galat.value = e.message; } finally { s.memuat = false; }
    }
    watch(() => [s.q, s.kelas_id, s.kamar_id, s.status, s.ling], () => { clearTimeout(tS); tS = setTimeout(cariSantri, 250); });
    const bukaSantri = async (x) => { try { s.detail = await api("/cari/santri/" + x.id); s.hasil = []; } catch (e) { galat.value = e.message; } };
    const kelasList = computed(() => (m.value.kelas || []).filter((k) => k.aktif && (!s.ling || k.lingkungan === s.ling)));
    const kamarList = computed(() => (m.value.kamar || []).filter((k) => k.aktif && (!s.ling || k.lingkungan === s.ling)));
    // ---- guru
    const g = reactive({ q: "", ling: "", hasil: [], detail: null, memuat: false });
    let tG;
    async function cariGuru() {
      galat.value = "";
      if (g.q.trim().length < 2 && !g.ling) { g.hasil = []; return; }
      g.memuat = true;
      try { g.hasil = (await api(`/cari/guru?limit=5&q=${encodeURIComponent(g.q.trim())}&lingkungan=${g.ling}`)).slice(0, 5); } catch (e) { galat.value = e.message; } finally { g.memuat = false; }
    }
    watch(() => [g.q, g.ling], () => { clearTimeout(tG); tG = setTimeout(cariGuru, 250); });
    const bukaGuru = async (x) => { try { g.detail = await api("/cari/guru/" + x.id); g.hasil = []; } catch (e) { galat.value = e.message; } };
    const waHp = (hp) => { const d = String(hp || "").replace(/\D/g, "").replace(/^0/, "62"); return d ? "https://wa.me/" + d : null; };
    const PERAN = { wali: "Wali kelas", asisten: "Asisten", wali_asuh: "Wali asuh" };
    onMounted(() => muatMaster());
    return { moderator, tab, galat, s, kelasList, kamarList, bukaSantri, g, bukaGuru, waHp, PERAN, namaKelas };
  },
  template: `<div><span class="jejak">Beranda</span><h1>Cari Santri & Guru</h1></div>
  <div class="tab"><button :class="{aktif: tab==='santri'}" @click="tab='santri'">Santri</button><button :class="{aktif: tab==='guru'}" @click="tab='guru'">Guru</button></div>
  <Pesan :galat="galat"/>

  <template v-if="tab==='santri'">
    <div class="kartu" style="display:flex;flex-direction:column;gap:12px">
      <label class="isian">Nama atau NIS<input v-model="s.q" type="search" placeholder="Ketik min. 2 huruf" autocomplete="off"></label>
      <div class="baris">
        <label class="isian" v-if="moderator">Lingkungan<select v-model="s.ling"><option value="">Putra & putri</option><option value="putra">Putra</option><option value="putri">Putri</option></select></label>
        <label class="isian">Kelas<select v-model="s.kelas_id"><option value="">Semua kelas</option><option v-for="k in kelasList" :value="k.id">{{ namaKelas(k) }}{{ moderator ? ' (' + k.lingkungan + ')' : '' }}</option></select></label>
        <label class="isian">Kamar<select v-model="s.kamar_id"><option value="">Semua kamar</option><option v-for="k in kamarList" :value="k.id">{{ k.nama }}</option></select></label>
        <label class="isian">Status<select v-model="s.status"><option value="aktif">Aktif</option><option value="skorsing">Skorsing</option><option value="alumni">Alumni</option><option value="mutasi_keluar">Mutasi keluar</option><option value="semua">Semua</option></select></label>
      </div>
      <div v-if="s.hasil.length" style="display:flex;flex-direction:column;gap:4px">
        <span class="redup">{{ s.hasil.length }} teratas — perjelas kata kunci atau saringan bila belum ketemu.</span>
        <button v-for="x in s.hasil" :key="x.id" class="kedua" style="justify-content:flex-start;text-align:left;padding:6px 10px" @click="bukaSantri(x)">
          <span class="santri-sel"><FotoSantri :s="x" ukuran="kecil"/><span><strong>{{ x.nama }}</strong> <span class="redup">{{ x.nis }} · {{ x.kelas || '—' }} · {{ x.kamar || '—' }}</span></span></span></button>
      </div>
      <p v-else-if="!s.memuat && (s.q.trim().length >= 2)" class="redup" style="margin:0">Tidak ada santri yang cocok.</p>
    </div>
    <div v-if="s.detail" class="kartu" style="display:flex;flex-direction:column;gap:14px">
      <div class="santri-sel" style="gap:16px;align-items:flex-start"><FotoSantri :s="s.detail" ukuran="besar"/>
        <div style="display:flex;flex-direction:column;gap:4px"><h2>{{ s.detail.nama }}</h2><span class="redup">NIS {{ s.detail.nis }} · {{ s.detail.jenis_kelamin === 'L' ? 'Putra' : 'Putri' }}</span>
          <span><span class="lencana" :class="{hijau: s.detail.status==='aktif'}">{{ s.detail.status }}</span></span></div></div>
      <div class="kisi">
        <div><div class="redup">Kelas</div><strong>{{ s.detail.kelas || '—' }}</strong></div>
        <div><div class="redup">Kamar</div><strong>{{ s.detail.kamar || '—' }}</strong><div class="redup" v-if="s.detail.asrama">{{ s.detail.asrama }}</div></div>
        <div><div class="redup">Tempat, tanggal lahir</div><strong>{{ [s.detail.tempat_lahir, s.detail.tanggal_lahir].filter(Boolean).join(', ') || '—' }}</strong></div>
        <div><div class="redup">Asal</div><strong>{{ [s.detail.kabupaten, s.detail.provinsi].filter(Boolean).join(', ') || '—' }}</strong></div>
      </div>
      <div class="dua-kolom">
        <div><h2 style="font-size:15px">Wali kelas</h2>
          <p v-if="!s.detail.wali_kelas.length" class="redup">Belum ditetapkan untuk tahun ajaran aktif.</p>
          <div v-for="w in s.detail.wali_kelas" :key="w.id + w.peran" style="padding:4px 0"><strong>{{ w.nama }}</strong> <span class="redup">{{ PERAN[w.peran] }}</span>
            <a v-if="waHp(w.no_hp)" :href="waHp(w.no_hp)" target="_blank" rel="noopener" style="margin-left:8px">{{ w.no_hp }}</a></div></div>
        <div><h2 style="font-size:15px">Wali asuh kamar</h2>
          <p v-if="!s.detail.wali_asuh.length" class="redup">Belum ditetapkan untuk tahun ajaran aktif.</p>
          <div v-for="w in s.detail.wali_asuh" :key="w.id + w.peran" style="padding:4px 0"><strong>{{ w.nama }}</strong> <span class="redup">{{ PERAN[w.peran] }}</span>
            <a v-if="waHp(w.no_hp)" :href="waHp(w.no_hp)" target="_blank" rel="noopener" style="margin-left:8px">{{ w.no_hp }}</a></div></div>
      </div>
    </div>
  </template>

  <template v-if="tab==='guru'">
    <div class="kartu" style="display:flex;flex-direction:column;gap:12px">
      <div class="baris">
        <label class="isian" style="flex:1 1 260px">Nama atau NIP<input v-model="g.q" type="search" placeholder="Ketik min. 2 huruf" autocomplete="off"></label>
        <label class="isian">Lingkungan<select v-model="g.ling"><option value="">Semua</option><option value="semua">Putra & putri</option><option value="putra">Putra</option><option value="putri">Putri</option></select></label>
      </div>
      <div v-if="g.hasil.length" style="display:flex;flex-direction:column;gap:4px">
        <button v-for="x in g.hasil" :key="x.id" class="kedua" style="justify-content:flex-start;text-align:left;padding:6px 10px" @click="bukaGuru(x)">
          <span><strong>{{ x.nama }}</strong> <span class="redup">NIP {{ x.nip }} · {{ x.lingkungan }}</span></span></button>
      </div>
      <p v-else-if="!g.memuat && g.q.trim().length >= 2" class="redup" style="margin:0">Tidak ada guru yang cocok.</p>
    </div>
    <div v-if="g.detail" class="kartu" style="display:flex;flex-direction:column;gap:10px">
      <h2>{{ g.detail.nama }}</h2><span class="redup">NIP {{ g.detail.nip }} · {{ g.detail.jenis_kelamin === 'L' ? 'Laki-laki' : 'Perempuan' }} · lingkungan {{ g.detail.lingkungan }}</span>
      <div class="kisi">
        <div><div class="redup">Email</div><strong>{{ g.detail.email || '—' }}</strong></div>
        <div><div class="redup">No. HP</div><a v-if="waHp(g.detail.no_hp)" :href="waHp(g.detail.no_hp)" target="_blank" rel="noopener"><strong>{{ g.detail.no_hp }}</strong></a><strong v-else>—</strong></div>
      </div>
      <div><div class="redup">Tugas tahun ajaran aktif</div>
        <span v-for="k in g.detail.wali_kelas" class="lencana hijau" style="margin:4px 6px 0 0">{{ PERAN[k.peran] }} {{ k.nama }}</span>
        <span v-for="k in g.detail.wali_asuh" class="lencana biru" style="margin:4px 6px 0 0">{{ PERAN[k.peran] }} {{ k.nama }}</span>
        <span v-if="!g.detail.wali_kelas.length && !g.detail.wali_asuh.length" class="redup">—</span></div>
    </div>
  </template>`,
};
daftarHalaman("/cari", CariSantriGuru, {
  label: "Cari Santri & Guru", grup: "Beranda", urutan: 5, syarat: () => true,
  ikon: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
});
