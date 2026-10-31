// Modul tampilan Pengembangan Diri — grup kegiatan & ekskul, anggota, absensi kegiatan, rekap, prestasi. Lihat src/modul/README.md.
// Dibungkus blok supaya nama pembantu tidak bentrok dengan modul lain (semua skrip modul berbagi lingkup global).
{
  // Pencarian langsung: tunggu 250 ms setelah berhenti mengetik; teks < 2 huruf dianggap kosong.
  const tunda = (fn, ms = 250) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
  const kataCari = (q) => (String(q || "").trim().length >= 2 ? String(q).trim().toLowerCase() : "");
  const awalBulan = () => hariIni().slice(0, 8) + "01";

  const PengembanganDiri = {
    components: { Pesan, CariSantri, CariGuru, FotoSantri },
    directives: { baris: vBaris },
    setup() {
      const me = negara.me;
      const daftarTab = [
        ["grup", "Grup kegiatan", me.bisa.kegiatan],
        ["anggota", "Anggota", me.bisa.kegiatan],
        ["absensi", "Absensi kegiatan", me.bisa.absensi || me.bisa.lihat_absensi],
        ["rekap", "Rekap kehadiran", me.bisa.absensi || me.bisa.lihat_absensi],
        ["prestasi", "Prestasi", me.bisa.prestasi || me.bisa.lihat_prestasi],
      ].filter((t) => t[2]);
      const tab = ref(daftarTab[0] ? daftarTab[0][0] : "");
      const f = reactive({ galat: "", ok: "" });
      const bersihPesan = () => { f.galat = ""; f.ok = ""; };
      const jalan = async (fn, pesan) => { bersihPesan(); try { const r = await fn(); if (pesan) f.ok = typeof pesan === "function" ? pesan(r) : pesan; return r; } catch (e) { f.galat = e.message; } };
      const m = computed(() => negara.master || {});
      const pilihan = (kel, ling) => (m.value.pilihan || []).filter((p) => p.kelompok === kel && p.aktif && (!ling || p.lingkungan === "semua" || p.lingkungan === ling));
      const lingSaya = computed(() => (me.lingkungan === "semua" ? ["putra", "putri"] : [me.lingkungan]));

      // ------------------------------------------------ grup
      const grup = ref([]);
      const g = reactive({ q: "", qLive: "", kegiatan_id: "", lingkungan: "", status: "aktif", edit: null });
      const muatGrup = async () => { try { grup.value = await api("/grup"); } catch (e) { f.galat = e.message; } };
      watch(() => g.q, tunda(() => { g.qLive = kataCari(g.q); }));
      const grupTersaring = computed(() => grup.value.filter((x) =>
        (!g.kegiatan_id || x.kegiatan_id == g.kegiatan_id) && (!g.lingkungan || x.lingkungan === g.lingkungan)
        && (g.status === "semua" || (g.status === "aktif" ? x.aktif : !x.aktif))
        && (!g.qLive || [x.nama, x.kegiatan, x.ekstrakurikuler, x.pembimbing].some((v) => v && v.toLowerCase().includes(g.qLive)))));
      const grupAktif = computed(() => grup.value.filter((x) => x.aktif));
      const labelGrup = (x) => `${x.kegiatan}${x.ekstrakurikuler ? " · " + x.ekstrakurikuler : ""} — ${x.nama}${lingSaya.value.length > 1 ? " (" + x.lingkungan + ")" : ""}`;
      function bukaGrup(x) {
        bersihPesan();
        g.edit = x ? { id: x.id, kegiatan_id: x.kegiatan_id, ekstrakurikuler_id: x.ekstrakurikuler_id || "", nama: x.nama, lingkungan: x.lingkungan, aktif: !!x.aktif, guru: x.pembimbing_guru_id ? { id: x.pembimbing_guru_id, nama: x.pembimbing, nip: x.pembimbing_nip, lingkungan: x.pembimbing_ling } : null }
          : { kegiatan_id: (pilihan("kegiatan")[0] || {}).id || "", ekstrakurikuler_id: "", nama: "", lingkungan: lingSaya.value[0], aktif: true, guru: null };
      }
      async function simpanGrup() {
        const e = g.edit;
        if (e.id && !e.aktif && grup.value.find((x) => x.id === e.id)?.aktif && !confirm("Menonaktifkan grup akan mengakhiri keanggotaan semua anggotanya hari ini (riwayat tetap tersimpan). Lanjutkan?")) return;
        const guruId = e.guru ? e.guru.id : null;
        const r = await jalan(() => api("/grup", { id: e.id, kegiatan_id: e.kegiatan_id, ekstrakurikuler_id: e.ekstrakurikuler_id || null, nama: e.nama, lingkungan: e.lingkungan, pembimbing_guru_id: guruId, aktif: e.aktif ? 1 : 0 }), "Grup tersimpan.");
        if (r) { g.edit = null; muatGrup(); }
      }

      // ------------------------------------------------ anggota
      const a = reactive({ grup_id: "", data: null, riwayat: false, q: "", qLive: "", cara: "cari", peran: "anggota", santri: null,
        kelas_id: "", kamar_id: "", calon: [], terpilih: {}, qCalon: "", qCalonLive: "", csv: null, hasil: null, pindah: {} });
      const grupA = computed(() => grup.value.find((x) => x.id == a.grup_id));
      async function muatAnggota() {
        a.data = null; a.hasil = null;
        if (!a.grup_id) return;
        try { a.data = await api(`/grup/${a.grup_id}/anggota${a.riwayat ? "?riwayat=1" : ""}`); } catch (e) { f.galat = e.message; }
      }
      watch(() => [a.grup_id, a.riwayat], muatAnggota);
      watch(() => a.q, tunda(() => { a.qLive = kataCari(a.q); }));
      watch(() => a.qCalon, tunda(() => { a.qCalonLive = kataCari(a.qCalon); }));
      const anggotaTersaring = computed(() => (a.data ? a.data.anggota : []).filter((x) => !a.qLive || x.nama.toLowerCase().includes(a.qLive) || x.nis.startsWith(a.qLive)));
      const kelasA = computed(() => (m.value.kelas || []).filter((k) => k.aktif && grupA.value && k.lingkungan === grupA.value.lingkungan));
      const kamarA = computed(() => (m.value.kamar || []).filter((k) => k.aktif && grupA.value && k.lingkungan === grupA.value.lingkungan));
      async function muatCalon() {
        a.calon = []; a.terpilih = {};
        if (!a.kelas_id && !a.kamar_id) return;
        const q = new URLSearchParams({ limit: 2000 });
        if (a.kelas_id) q.set("kelas_id", a.kelas_id);
        if (a.kamar_id) q.set("kamar_id", a.kamar_id);
        try {
          const ada = new Set((a.data ? a.data.anggota : []).filter((x) => !x.selesai).map((x) => x.santri_id));
          a.calon = (await api("/santri?" + q)).filter((s) => s.lingkungan === grupA.value.lingkungan && !ada.has(s.id));
        } catch (e) { f.galat = e.message; }
      }
      watch(() => [a.kelas_id, a.kamar_id], muatCalon);
      const calonTersaring = computed(() => a.calon.filter((s) => !a.qCalonLive || s.nama.toLowerCase().includes(a.qCalonLive) || s.nis.startsWith(a.qCalonLive)));
      const jumlahTerpilih = computed(() => Object.values(a.terpilih).filter(Boolean).length);
      const pilihSemua = (v) => calonTersaring.value.forEach((s) => { a.terpilih[s.id] = v; });
      async function bacaCsvNis(ev) {
        bersihPesan(); a.csv = null;
        const file = ev.target.files[0]; if (!file) return;
        try { const r = await bacaCsv(file, ["NIS"]); a.csv = { nama: file.name, nis: r.baris.map((b) => b.NIS).filter(Boolean) }; } catch (e) { f.galat = e.message; }
      }
      async function tambah(data) {
        const r = await jalan(() => api(`/grup/${a.grup_id}/anggota`, { ...data, peran: a.peran }), (r) => `${r.ditambah} santri ditambahkan${r.ditolak.length ? ", " + r.ditolak.length + " ditolak" : ""}.`);
        if (!r) return;
        a.santri = null; a.csv = null; a.terpilih = {};
        await muatAnggota(); a.hasil = r; muatGrup();
        if (a.cara === "banyak") muatCalon();
      }
      const tambahCari = () => a.santri && tambah({ santri_ids: [a.santri.id] });
      const tambahBanyak = () => tambah({ santri_ids: Object.keys(a.terpilih).filter((k) => a.terpilih[k]).map(Number) });
      const tambahCsv = () => a.csv && tambah({ nis: a.csv.nis });
      async function keluarkan(x) {
        if (!confirm(`Keluarkan ${x.nama} dari grup ${grupA.value.nama}? Riwayat tetap tersimpan.`)) return;
        if (await jalan(() => api(`/anggota/${x.id}/keluar`, {}), "Santri dikeluarkan dari grup.")) { muatAnggota(); muatGrup(); }
      }
      async function pindahkan(x) {
        const tujuan = a.pindah[x.id];
        if (!tujuan) { f.galat = "Pilih grup tujuan."; return; }
        if (await jalan(() => api(`/anggota/${x.id}/pindah`, { grup_id: +tujuan }), "Santri dipindahkan.")) { muatAnggota(); muatGrup(); }
      }
      async function ubahPeran(x, peran) { if (await jalan(() => api(`/anggota/${x.id}/peran`, { peran }), "Peran diperbarui.")) muatAnggota(); }
      const grupTujuan = computed(() => grupAktif.value.filter((x) => grupA.value && x.id !== grupA.value.id && x.lingkungan === grupA.value.lingkungan));

      // ------------------------------------------------ absensi kegiatan
      const ab = reactive({ grup_id: "", tanggal: hariIni(), sesi_id: "", data: null });
      const sesiList = computed(() => pilihan("sesi_absensi"));
      const statusList = computed(() => (m.value.status_kehadiran || []).filter((s) => s.aktif));
      const warna = (id) => (statusList.value.find((s) => s.id == id) || {}).warna || "#55605A";
      async function muatAbsensi() {
        ab.data = null;
        if (!ab.grup_id || !ab.sesi_id) return;
        try { ab.data = await api(`/absensi-kegiatan?grup_id=${ab.grup_id}&tanggal=${ab.tanggal}&sesi_id=${ab.sesi_id}`); } catch (e) { f.galat = e.message; }
      }
      watch(() => [ab.grup_id, ab.tanggal, ab.sesi_id], () => { bersihPesan(); muatAbsensi(); });
      function semuaHadir() { const h = statusList.value.find((s) => s.kode === "H"); if (h) ab.data.santri.forEach((s) => { if (!s.otomatis) s.status_kehadiran_id = h.id; }); }
      const belumDiisi = computed(() => ab.data ? ab.data.santri.filter((s) => !s.status_kehadiran_id).length : 0);
      async function simpanAbsensi() {
        if (belumDiisi.value) { f.galat = `${belumDiisi.value} anggota belum diberi status.`; return; }
        const r = await jalan(() => api("/absensi-kegiatan", { grup_id: +ab.grup_id, tanggal: ab.tanggal, sesi_id: +ab.sesi_id, items: ab.data.santri.map((s) => ({ santri_id: s.id, status_kehadiran_id: s.status_kehadiran_id })) }), "Absensi kegiatan tersimpan.");
        if (r) { const ok = f.ok; await muatAbsensi(); f.ok = ok; }
      }

      // ------------------------------------------------ rekap
      const rk = reactive({ grup_id: "", dari: awalBulan(), sampai: hariIni(), data: null });
      async function muatRekap() {
        rk.data = null;
        if (!rk.grup_id) return;
        try { rk.data = await api(`/absensi-kegiatan/rekap?grup_id=${rk.grup_id}&dari=${rk.dari}&sampai=${rk.sampai}`); } catch (e) { f.galat = e.message; }
      }
      watch(() => [rk.grup_id, rk.dari, rk.sampai], muatRekap);
      function eksporRekap() {
        const d = rk.data, st = statusList.value;
        unduhXlsx(`rekap-kegiatan-${d.grup.nama}-${d.dari}_${d.sampai}.xlsx`.replace(/\s+/g, "-"), [{ nama: "Rekap", baris: [
          ["NIS", "Nama", ...st.map((s) => s.nama), "Jumlah", "% hadir"],
          ...d.santri.map((s) => [s.nis, s.nama, ...st.map((x) => s.status[x.id] || 0), s.total, s.persen == null ? "" : s.persen]),
        ] }]);
      }

      // ------------------------------------------------ prestasi
      const pr = reactive({ daftar: [], q: "", dari: "", sampai: "", tingkat_id: "", hasil_id: "", form: null, memuat: false });
      async function muatPrestasi() {
        pr.memuat = true;
        const q = new URLSearchParams();
        if (kataCari(pr.q)) q.set("q", pr.q.trim());
        for (const k of ["dari", "sampai", "tingkat_id", "hasil_id"]) if (pr[k]) q.set(k, pr[k]);
        try { pr.daftar = await api("/prestasi?" + q); } catch (e) { f.galat = e.message; } finally { pr.memuat = false; }
      }
      const muatPrestasiTunda = tunda(muatPrestasi);
      watch(() => [kataCari(pr.q), pr.dari, pr.sampai, pr.tingkat_id, pr.hasil_id], muatPrestasiTunda);
      function bukaPrestasi(x) {
        bersihPesan();
        pr.form = x ? { id: x.id, santri: { id: x.santri_id, nama: x.nama, nis: x.nis, foto_url: x.foto_url }, nama_kegiatan: x.nama_kegiatan, lokasi: x.lokasi || "", tingkat_lomba_id: x.tingkat_lomba_id || "", hasil_lomba_id: x.hasil_lomba_id || "", keterangan: x.keterangan || "", tanggal: x.tanggal }
          : { santri: null, nama_kegiatan: "", lokasi: "", tingkat_lomba_id: "", hasil_lomba_id: "", keterangan: "", tanggal: hariIni() };
      }
      async function simpanPrestasi() {
        const p = pr.form;
        if (!p.santri) { f.galat = "Pilih santri."; return; }
        const r = await jalan(() => api("/prestasi", { id: p.id, santri_id: p.santri.id, nama_kegiatan: p.nama_kegiatan, lokasi: p.lokasi, tingkat_lomba_id: p.tingkat_lomba_id, hasil_lomba_id: p.hasil_lomba_id, keterangan: p.keterangan, tanggal: p.tanggal }), "Prestasi tersimpan.");
        if (r) { pr.form = null; muatPrestasi(); }
      }
      function eksporPrestasi() {
        unduhXlsx(`prestasi-santri-${hariIni()}.xlsx`, [{ nama: "Prestasi", baris: [
          ["Tanggal", "NIS", "Nama", "Kelas", "Kegiatan / lomba", "Lokasi", "Tingkat", "Hasil", "Keterangan"],
          ...pr.daftar.map((x) => [x.tanggal, x.nis, x.nama, x.kelas || "", x.nama_kegiatan, x.lokasi || "", x.tingkat || "", x.hasil || "", x.keterangan || ""]),
        ] }]);
      }

      onMounted(async () => {
        try { await muatMaster(); } catch (e) { f.galat = e.message; }
        if (sesiList.value[0]) ab.sesi_id = sesiList.value[0].id;
        if (me.bisa.kegiatan || me.bisa.lihat_absensi) await muatGrup();
        if (me.bisa.lihat_prestasi) muatPrestasi();
      });
      watch(tab, bersihPesan);

      return { kini: hariIni(), me, daftarTab, tab, f, m, pilihan, lingSaya,
        grup, g, grupTersaring, grupAktif, labelGrup, bukaGrup, simpanGrup,
        a, grupA, anggotaTersaring, kelasA, kamarA, calonTersaring, jumlahTerpilih, pilihSemua, bacaCsvNis, tambahCari, tambahBanyak, tambahCsv, keluarkan, pindahkan, ubahPeran, grupTujuan, namaKelas,
        ab, sesiList, statusList, warna, semuaHadir, belumDiisi, simpanAbsensi,
        rk, eksporRekap, pr, bukaPrestasi, simpanPrestasi, eksporPrestasi };
    },
    template: `<div><span class="jejak">Administrasi › Kesantrian</span><h1>Pengembangan Diri</h1></div>
  <div class="tab"><button v-for="t in daftarTab" :key="t[0]" :class="{aktif: tab===t[0]}" @click="tab=t[0]">{{ t[1] }}</button></div>
  <Pesan :galat="f.galat" :ok="f.ok"/>

  <template v-if="tab==='grup'">
    <div class="kartu baris">
      <label class="isian" style="flex:2 1 220px">Cari grup<input v-model="g.q" placeholder="Nama grup, ekskul, atau pembimbing (min. 2 huruf)"></label>
      <label class="isian">Kegiatan<select v-model="g.kegiatan_id"><option value="">Semua</option><option v-for="p in pilihan('kegiatan')" :value="p.id">{{ p.nama }}</option></select></label>
      <label class="isian" v-if="lingSaya.length > 1">Lingkungan<select v-model="g.lingkungan"><option value="">Semua</option><option>putra</option><option>putri</option></select></label>
      <label class="isian">Status<select v-model="g.status"><option value="aktif">Aktif</option><option value="nonaktif">Nonaktif</option><option value="semua">Semua</option></select></label>
      <button @click="bukaGrup(null)">Tambah grup</button>
    </div>
    <div v-if="g.edit" class="kartu" style="display:flex;flex-direction:column;gap:12px">
      <h2>{{ g.edit.id ? 'Ubah grup' : 'Grup baru' }}</h2>
      <div class="baris">
        <label class="isian">Kegiatan<select v-model="g.edit.kegiatan_id"><option v-for="p in pilihan('kegiatan', g.edit.lingkungan)" :value="p.id">{{ p.nama }}</option></select></label>
        <label class="isian">Ekstrakurikuler (opsional)<select v-model="g.edit.ekstrakurikuler_id"><option value="">—</option><option v-for="p in pilihan('ekstrakurikuler', g.edit.lingkungan)" :value="p.id">{{ p.nama }}</option></select></label>
        <label class="isian" style="flex:1 1 180px">Nama grup<input v-model="g.edit.nama" maxlength="80" placeholder="mis. DLT 1, Grup 1"></label>
        <label class="isian">Lingkungan<select v-model="g.edit.lingkungan" :disabled="!!g.edit.id"><option v-for="l in lingSaya" :value="l">{{ l }}</option></select></label>
      </div>
      <div class="baris" style="align-items:flex-end">
        <label class="isian" style="flex:1 1 300px">Pembimbing / pelatih (guru)
          <CariGuru v-model="g.edit.guru"/>
        </label>
        <label class="redup" style="display:flex;gap:8px;align-items:center;min-height:42px"><input type="checkbox" v-model="g.edit.aktif"> Grup aktif</label>
      </div>
      <p v-if="g.edit.id && !g.edit.aktif" class="pesan info">Grup nonaktif tidak bisa diabsen atau ditambah anggota. Grup tidak dihapus; riwayat tetap tersimpan.</p>
      <div class="baris"><button @click="simpanGrup">Simpan</button><button class="kedua" @click="g.edit = null">Batal</button></div>
    </div>
    <div class="tabel"><table>
      <thead><tr><th>Grup</th><th>Kegiatan</th><th>Pembimbing</th><th v-if="lingSaya.length > 1">Lingkungan</th><th>Anggota</th><th>Status</th><th></th></tr></thead>
      <tbody v-baris><tr v-for="x in grupTersaring" :key="x.id">
        <td><strong>{{ x.nama }}</strong></td><td>{{ x.kegiatan }}<div v-if="x.ekstrakurikuler" class="redup">{{ x.ekstrakurikuler }}</div></td>
        <td>{{ x.pembimbing || '—' }}</td><td v-if="lingSaya.length > 1">{{ x.lingkungan }}</td><td>{{ x.jumlah }}</td>
        <td><span class="lencana" :class="{hijau: x.aktif}">{{ x.aktif ? 'Aktif' : 'Nonaktif' }}</span></td>
        <td style="white-space:nowrap"><button class="kedua kecil" @click="bukaGrup(x)">Ubah</button> <button v-if="x.aktif" class="kecil" @click="a.grup_id = x.id; tab = 'anggota'">Anggota</button></td>
      </tr></tbody></table>
      <p v-if="!grupTersaring.length" class="redup" style="padding:14px">{{ grup.length ? 'Tidak ada grup yang cocok.' : 'Belum ada grup. Klik Tambah grup.' }}</p></div>
  </template>

  <template v-if="tab==='anggota'">
    <div class="kartu baris">
      <label class="isian" style="flex:2 1 280px">Grup<select v-model="a.grup_id"><option value="">Pilih grup…</option><option v-for="x in grupAktif" :value="x.id">{{ labelGrup(x) }} · {{ x.jumlah }}</option></select></label>
      <label class="isian" style="flex:1 1 200px" v-if="a.data">Cari anggota<input v-model="a.q" placeholder="Nama atau NIS (min. 2 huruf)"></label>
      <label class="redup" v-if="a.data" style="display:flex;gap:8px;align-items:center"><input type="checkbox" v-model="a.riwayat"> Tampilkan riwayat</label>
    </div>
    <template v-if="a.data">
      <div class="kartu" style="display:flex;flex-direction:column;gap:12px">
        <h2>Tambah anggota</h2>
        <div class="baris">
          <div class="tab"><button v-for="c in [['cari','Cari santri'],['banyak','Pilih banyak'],['csv','File CSV']]" :class="{aktif: a.cara===c[0]}" @click="a.cara=c[0]">{{ c[1] }}</button></div>
          <label class="isian">Peran<select v-model="a.peran"><option value="anggota">Anggota</option><option value="pengurus">Pengurus</option></select></label>
        </div>
        <div v-if="a.cara==='cari'" class="baris" style="align-items:flex-start">
          <div style="flex:1 1 320px"><CariSantri v-model="a.santri"/></div><button :disabled="!a.santri" @click="tambahCari">Tambahkan</button></div>
        <template v-if="a.cara==='banyak'">
          <div class="baris">
            <label class="isian">Kelas<select v-model="a.kelas_id"><option value="">Semua kelas</option><option v-for="k in kelasA" :value="k.id">{{ namaKelas(k) }}</option></select></label>
            <label class="isian">Kamar<select v-model="a.kamar_id"><option value="">Semua kamar</option><option v-for="k in kamarA" :value="k.id">{{ k.nama }}</option></select></label>
            <label class="isian" style="flex:1 1 200px">Saring<input v-model="a.qCalon" placeholder="Nama atau NIS (min. 2 huruf)"></label>
          </div>
          <p v-if="!a.kelas_id && !a.kamar_id" class="redup" style="margin:0">Pilih kelas dan/atau kamar untuk menampilkan santri (lingkungan {{ grupA && grupA.lingkungan }}).</p>
          <template v-else>
            <div class="baris"><button class="kedua kecil" @click="pilihSemua(true)">Centang semua</button><button class="kedua kecil" @click="pilihSemua(false)">Kosongkan</button>
              <span class="redup">{{ jumlahTerpilih }} dipilih dari {{ calonTersaring.length }} santri (anggota yang sudah ada tidak ditampilkan)</span></div>
            <div class="tabel" style="max-height:360px;overflow:auto"><table><tbody v-baris>
              <tr v-for="s in calonTersaring" :key="s.id"><td style="width:40px"><input type="checkbox" v-model="a.terpilih[s.id]" :aria-label="'Pilih ' + s.nama"></td>
                <td><div class="santri-sel"><FotoSantri :s="s" ukuran="kecil"/><span><strong>{{ s.nama }}</strong><div class="redup">{{ s.nis }} · {{ s.kelas }} · {{ s.kamar }}</div></span></div></td></tr>
            </tbody></table><p v-if="!calonTersaring.length" class="redup" style="padding:14px">Tidak ada santri yang bisa ditambahkan.</p></div>
            <div><button :disabled="!jumlahTerpilih" @click="tambahBanyak">Tambahkan {{ jumlahTerpilih }} santri</button></div>
          </template>
        </template>
        <template v-if="a.cara==='csv'">
          <p class="redup" style="margin:0">File CSV dengan kolom <strong>NIS</strong> (kolom lain diabaikan). Santri harus aktif dan selingkungan dengan grup.</p>
          <input type="file" accept=".csv,text/csv" @change="bacaCsvNis">
          <div v-if="a.csv" class="pesan info">{{ a.csv.nama }}: <strong>{{ a.csv.nis.length }}</strong> NIS terbaca. <button @click="tambahCsv" style="margin-left:8px">Tambahkan</button></div>
        </template>
        <div v-if="a.hasil && a.hasil.ditolak.length" class="tabel"><table><thead><tr><th>NIS</th><th>Nama</th><th>Ditolak karena</th></tr></thead>
          <tbody><tr v-for="d in a.hasil.ditolak"><td>{{ d.nis }}</td><td>{{ d.nama }}</td><td>{{ d.alasan }}</td></tr></tbody></table></div>
      </div>
      <div class="tabel"><table>
        <thead><tr><th>Santri</th><th>Peran</th><th>Mulai</th><th>{{ a.riwayat ? 'Selesai' : '' }}</th><th>Pindah ke grup</th><th></th></tr></thead>
        <tbody v-baris><tr v-for="x in anggotaTersaring" :key="x.id" :style="{opacity: x.selesai ? .6 : 1}">
          <td><div class="santri-sel"><FotoSantri :s="x"/><span><strong>{{ x.nama }}</strong><div class="redup">{{ x.nis }} · {{ x.kelas }} · {{ x.kamar }}</div></span></div></td>
          <td><select v-if="!x.selesai" :value="x.peran" @change="ubahPeran(x, $event.target.value)" :aria-label="'Peran ' + x.nama"><option value="anggota">Anggota</option><option value="pengurus">Pengurus</option></select><span v-else>{{ x.peran }}</span></td>
          <td>{{ x.mulai }}</td><td>{{ x.selesai || '' }}</td>
          <td><select v-if="!x.selesai" v-model="a.pindah[x.id]" :aria-label="'Grup tujuan ' + x.nama"><option :value="undefined">—</option><option v-for="t in grupTujuan" :value="t.id">{{ labelGrup(t) }}</option></select></td>
          <td style="white-space:nowrap"><template v-if="!x.selesai"><button class="kecil" :disabled="!a.pindah[x.id]" @click="pindahkan(x)">Pindah</button> <button class="bahaya kecil" @click="keluarkan(x)">Keluarkan</button></template></td>
        </tr></tbody></table>
        <p v-if="!anggotaTersaring.length" class="redup" style="padding:14px">{{ a.data.anggota.length ? 'Tidak ada anggota yang cocok.' : 'Grup ini belum punya anggota.' }}</p></div>
      <p class="redup">Santri boleh ikut dua ekskul atau lebih. Keluarkan dan pindah tidak menghapus riwayat keanggotaan.</p>
    </template>
  </template>

  <template v-if="tab==='absensi'">
    <div class="kartu baris">
      <label class="isian" style="flex:2 1 280px">Grup<select v-model="ab.grup_id"><option value="">Pilih grup…</option><option v-for="x in grupAktif" :value="x.id">{{ labelGrup(x) }}</option></select></label>
      <label class="isian">Tanggal<input type="date" v-model="ab.tanggal" :max="kini"></label>
      <label class="isian" v-if="sesiList.length > 1">Sesi<select v-model="ab.sesi_id"><option v-for="s in sesiList" :value="s.id">{{ s.nama }}</option></select></label>
    </div>
    <template v-if="ab.data">
      <div class="baris" style="justify-content:space-between"><span class="redup">{{ ab.data.terisi ? 'Sudah diisi ' + ab.data.diisi_at + (ab.data.bisa_isi ? ' — menyimpan ulang akan memperbarui.' : '') : 'Belum diisi.' }}{{ ab.data.bisa_isi ? '' : ' (lihat saja)' }}</span>
        <button v-if="ab.data.bisa_isi && ab.data.santri.length" class="kedua" @click="semuaHadir">Tandai semua hadir</button></div>
      <div class="tabel"><table>
        <thead><tr><th>Santri</th><th>Status</th><th>Keterangan</th></tr></thead>
        <tbody v-baris><tr v-for="s in ab.data.santri" :key="s.id">
          <td><div class="santri-sel"><FotoSantri :s="s"/><span><strong>{{ s.nama }}</strong><div class="redup">{{ s.nis }}{{ s.peran === 'pengurus' ? ' · pengurus' : '' }}</div></span></div></td>
          <td><select v-model="s.status_kehadiran_id" :disabled="!!s.otomatis || !ab.data.bisa_isi" :aria-label="'Status ' + s.nama" :style="{borderColor: warna(s.status_kehadiran_id), color: warna(s.status_kehadiran_id), fontWeight: 700}">
            <option :value="null" disabled>— pilih —</option><option v-for="st in statusList" :value="st.id">{{ st.nama }}</option></select></td>
          <td class="redup">{{ s.otomatis ? 'Otomatis: ' + s.keterangan : '' }}</td>
        </tr></tbody></table>
        <p v-if="!ab.data.santri.length" class="redup" style="padding:14px">Grup ini belum punya anggota pada tanggal tersebut.</p></div>
      <div v-if="ab.data.bisa_isi && ab.data.santri.length" class="baris"><button @click="simpanAbsensi">Simpan absensi</button><span v-if="belumDiisi" class="redup">{{ belumDiisi }} anggota belum diberi status.</span></div>
    </template>
  </template>

  <template v-if="tab==='rekap'">
    <div class="kartu baris">
      <label class="isian" style="flex:2 1 280px">Grup<select v-model="rk.grup_id"><option value="">Pilih grup…</option><option v-for="x in grup" :value="x.id">{{ labelGrup(x) }}{{ x.aktif ? '' : ' · nonaktif' }}</option></select></label>
      <label class="isian">Dari<input type="date" v-model="rk.dari"></label><label class="isian">Sampai<input type="date" v-model="rk.sampai"></label>
      <button v-if="rk.data && rk.data.santri.length" class="kedua" @click="eksporRekap">Unduh Excel</button>
    </div>
    <template v-if="rk.data">
      <p class="redup">{{ rk.data.jumlah_sesi }} sesi absensi tercatat dalam rentang ini. % hadir = status yang dihitung hadir dibagi jumlah status tercatat.</p>
      <div class="tabel"><table>
        <thead><tr><th>Santri</th><th v-for="st in statusList" :key="st.id" :style="{color: st.warna}">{{ st.nama }}</th><th>Jumlah</th><th>% hadir</th></tr></thead>
        <tbody v-baris><tr v-for="s in rk.data.santri" :key="s.id">
          <td><div class="santri-sel"><FotoSantri :s="s" ukuran="kecil"/><span><strong>{{ s.nama }}</strong><div class="redup">{{ s.nis }}</div></span></div></td>
          <td v-for="st in statusList" :key="st.id">{{ s.status[st.id] || 0 }}</td><td>{{ s.total }}</td>
          <td><strong>{{ s.persen == null ? '—' : s.persen + '%' }}</strong></td></tr></tbody></table>
        <p v-if="!rk.data.santri.length" class="redup" style="padding:14px">Belum ada anggota atau absensi dalam rentang ini.</p></div>
    </template>
  </template>

  <template v-if="tab==='prestasi'">
    <div class="kartu baris">
      <label class="isian" style="flex:2 1 220px">Cari<input v-model="pr.q" placeholder="Santri, NIS, kegiatan, lokasi (min. 2 huruf)"></label>
      <label class="isian">Dari<input type="date" v-model="pr.dari"></label><label class="isian">Sampai<input type="date" v-model="pr.sampai"></label>
      <label class="isian">Tingkat<select v-model="pr.tingkat_id"><option value="">Semua</option><option v-for="p in pilihan('tingkat_lomba')" :value="p.id">{{ p.nama }}</option></select></label>
      <label class="isian">Hasil<select v-model="pr.hasil_id"><option value="">Semua</option><option v-for="p in pilihan('hasil_lomba')" :value="p.id">{{ p.nama }}</option></select></label>
      <button class="kedua" :disabled="!pr.daftar.length" @click="eksporPrestasi">Unduh Excel</button>
      <button v-if="me.bisa.prestasi" @click="bukaPrestasi(null)">Catat prestasi</button>
    </div>
    <div v-if="pr.form" class="kartu" style="display:flex;flex-direction:column;gap:12px;max-width:760px">
      <h2>{{ pr.form.id ? 'Ubah prestasi' : 'Catat prestasi' }}</h2>
      <label class="isian">Santri
        <div v-if="pr.form.id" class="santri-sel"><FotoSantri :s="pr.form.santri"/><span><strong>{{ pr.form.santri.nama }}</strong><div class="redup">{{ pr.form.santri.nis }}</div></span></div>
        <CariSantri v-else v-model="pr.form.santri"/></label>
      <div class="baris">
        <label class="isian" style="flex:2 1 240px">Nama kegiatan / lomba<input v-model="pr.form.nama_kegiatan" maxlength="150"></label>
        <label class="isian" style="flex:1 1 160px">Lokasi<input v-model="pr.form.lokasi" maxlength="120"></label>
        <label class="isian">Tanggal<input type="date" v-model="pr.form.tanggal" :max="kini"></label>
      </div>
      <div class="baris">
        <label class="isian">Tingkat<select v-model="pr.form.tingkat_lomba_id"><option value="" disabled>Pilih…</option><option v-for="p in pilihan('tingkat_lomba')" :value="p.id">{{ p.nama }}</option></select></label>
        <label class="isian">Hasil<select v-model="pr.form.hasil_lomba_id"><option value="" disabled>Pilih…</option><option v-for="p in pilihan('hasil_lomba')" :value="p.id">{{ p.nama }}</option></select></label>
        <label class="isian" style="flex:2 1 240px">Keterangan<input v-model="pr.form.keterangan" maxlength="300"></label>
      </div>
      <div class="baris"><button @click="simpanPrestasi">Simpan</button><button class="kedua" @click="pr.form = null">Batal</button></div>
    </div>
    <div class="tabel"><table>
      <thead><tr><th>Tanggal</th><th>Santri</th><th>Kegiatan / lomba</th><th>Tingkat</th><th>Hasil</th><th>Keterangan</th><th v-if="me.bisa.prestasi"></th></tr></thead>
      <tbody v-baris><tr v-for="x in pr.daftar" :key="x.id">
        <td style="white-space:nowrap">{{ x.tanggal }}</td>
        <td><div class="santri-sel"><FotoSantri :s="x" ukuran="kecil"/><span><strong>{{ x.nama }}</strong><div class="redup">{{ x.nis }} · {{ x.kelas }}</div></span></div></td>
        <td><strong>{{ x.nama_kegiatan }}</strong><div v-if="x.lokasi" class="redup">{{ x.lokasi }}</div></td>
        <td>{{ x.tingkat }}</td><td><span class="lencana hijau">{{ x.hasil }}</span></td><td class="redup">{{ x.keterangan }}</td>
        <td v-if="me.bisa.prestasi"><button class="kedua kecil" @click="bukaPrestasi(x)">Ubah</button></td></tr></tbody></table>
      <p v-if="!pr.daftar.length" class="redup" style="padding:14px">{{ pr.memuat ? 'Memuat…' : 'Belum ada prestasi yang cocok.' }}</p></div>
  </template>`,
  };

  daftarHalaman("/pengembangan-diri", PengembanganDiri, {
    label: "Pengembangan Diri", grup: "Administrasi", urutan: 60,
    syarat: (me) => me.bisa.kegiatan || me.bisa.prestasi || me.bisa.lihat_prestasi || me.bisa.absensi || me.bisa.lihat_absensi,
    ikon: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>',
  });
}
