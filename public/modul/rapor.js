// Modul tampilan Rapor Kesantrian — per santri atau per kelas, siap cetak A4. Lihat src/modul/README.md.
// Dibungkus blok supaya nama pembantu tidak bentrok dengan modul lain.
{
  const fmtTgl = (t) => {
    if (!t) return "";
    const b = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    return `${+t.slice(8, 10)} ${b[+t.slice(5, 7) - 1]} ${t.slice(0, 4)}`;
  };

  // Satu lembar rapor (dipakai untuk satu santri maupun cetak per kelas).
  const LembarRapor = {
    props: { r: Object, putus: Boolean },
    components: { FotoSantri },
    setup() { return { fmtTgl }; },
    template: `<article class="gatepass" :style="{maxWidth: '820px', margin: '0 auto 18px', breakAfter: putus ? 'page' : 'auto', pageBreakAfter: putus ? 'always' : 'auto'}">
    <div class="kepala"><img src="/img/logo-hisada-256.png" alt="Logo HISADA">
      <div style="flex:1"><strong style="font-size:16px">Pesantren Modern Daarul 'Uluum Lido</strong><div>HIMPUNAN SANTRI DAARUL 'ULUUM LIDO (HISADA)</div></div>
      <div style="text-align:right"><strong style="letter-spacing:.08em">RAPOR KESANTRIAN</strong><div>{{ r.periode.judul }}</div><div>{{ fmtTgl(r.periode.dari) }} – {{ fmtTgl(r.periode.sampai) }}</div></div></div>
    <p v-if="r.periode.catatan" class="redup" style="margin:0 0 10px;font-size:12px">Catatan: {{ r.periode.catatan }}</p>

    <div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:14px">
      <FotoSantri :s="r.santri" ukuran="besar"/>
      <table style="flex:1"><tbody>
        <tr><td style="width:120px">Nama</td><td><strong>{{ r.santri.nama }}</strong></td></tr>
        <tr><td>NIS</td><td>{{ r.santri.nis }}</td></tr>
        <tr><td>Kelas</td><td>{{ r.santri.kelas || '—' }}</td></tr>
        <tr><td>Kamar</td><td>{{ r.santri.kamar || '—' }}</td></tr>
      </tbody></table></div>

    <h3 style="margin:12px 0 6px">A. Kehadiran</h3>
    <div style="display:flex;gap:16px;flex-wrap:wrap">
      <div v-for="j in [['harian','Absensi harian'],['kegiatan','Absensi kegiatan']]" :key="j[0]" style="flex:1 1 300px">
        <strong>{{ j[1] }}</strong>
        <table style="width:100%;border-collapse:collapse;margin-top:4px"><tbody>
          <tr v-for="s in r.kehadiran[j[0]].status" :key="s.nama" style="border-bottom:1px solid #DDE3DF"><td>{{ s.nama }}</td><td style="text-align:right">{{ s.n }}</td><td style="text-align:right;width:70px">{{ s.persen }}%</td></tr>
          <tr v-if="!r.kehadiran[j[0]].total"><td class="redup">Belum ada catatan.</td></tr>
          <tr v-else><td><strong>Kehadiran</strong></td><td style="text-align:right">{{ r.kehadiran[j[0]].hadir }} / {{ r.kehadiran[j[0]].total }}</td><td style="text-align:right"><strong>{{ r.kehadiran[j[0]].persen }}%</strong></td></tr>
        </tbody></table></div></div>

    <h3 style="margin:16px 0 6px">B. Kedisiplinan</h3>
    <table v-if="r.kedisiplinan.length" style="width:100%;border-collapse:collapse"><thead><tr style="text-align:left;border-bottom:1px solid #000"><th>Tanggal</th><th>Kategori</th><th>Tingkat vonis</th></tr></thead>
      <tbody><tr v-for="(p, i) in r.kedisiplinan" :key="i" style="border-bottom:1px solid #DDE3DF"><td>{{ fmtTgl(p.tanggal) }}</td><td>{{ p.kategori }}</td><td>{{ p.tingkat }}</td></tr></tbody></table>
    <p v-else style="margin:0">Tidak ada catatan pelanggaran pada periode ini.</p>

    <h3 style="margin:16px 0 6px">C. Prestasi</h3>
    <table v-if="r.prestasi.length" style="width:100%;border-collapse:collapse"><thead><tr style="text-align:left;border-bottom:1px solid #000"><th>Tanggal</th><th>Kegiatan / lomba</th><th>Tingkat</th><th>Hasil</th></tr></thead>
      <tbody><tr v-for="(p, i) in r.prestasi" :key="i" style="border-bottom:1px solid #DDE3DF"><td>{{ fmtTgl(p.tanggal) }}</td><td>{{ p.nama_kegiatan }}<span v-if="p.lokasi" class="redup"> · {{ p.lokasi }}</span></td><td>{{ p.tingkat }}</td><td>{{ p.hasil }}</td></tr></tbody></table>
    <p v-else style="margin:0">Belum ada prestasi tercatat pada periode ini.</p>

    <h3 style="margin:16px 0 6px">D. Kegiatan & ekstrakurikuler</h3>
    <table v-if="r.grup.length" style="width:100%;border-collapse:collapse"><thead><tr style="text-align:left;border-bottom:1px solid #000"><th>Kegiatan</th><th>Grup</th><th>Pembimbing</th><th>Peran</th><th style="text-align:right">Kehadiran</th></tr></thead>
      <tbody><tr v-for="g in r.grup" :key="g.grup_id" style="border-bottom:1px solid #DDE3DF"><td>{{ g.kegiatan }}<span v-if="g.ekstrakurikuler"> · {{ g.ekstrakurikuler }}</span></td><td>{{ g.nama }}</td><td>{{ g.pembimbing || '—' }}</td><td>{{ g.peran }}</td>
        <td style="text-align:right">{{ g.persen == null ? 'belum diabsen' : g.persen + '% (' + g.hadir + '/' + g.total + ')' }}</td></tr></tbody></table>
    <p v-else style="margin:0">Tidak mengikuti grup kegiatan pada periode ini.</p>

    <div style="display:flex;justify-content:space-between;margin-top:40px;font-size:13px">
      <span class="redup">Dicetak {{ r.dicetak }} WIB</span>
      <div style="text-align:center;min-width:200px"><div style="margin-bottom:56px">Sekretaris HISADA</div><div style="border-top:1px solid #000;padding-top:4px">&nbsp;</div></div></div>
  </article>`,
  };

  const RaporKesantrian = {
    components: { Pesan, CariSantri, LembarRapor },
    setup() {
      const f = reactive({ santri: null, periode: "90", kelas_id: "", galat: "", memuat: false, proses: "", daftar: [] });
      const m = computed(() => negara.master || {});
      const taList = computed(() => (m.value.tahun_ajaran || []).filter((t) => t.status !== "persiapan"));
      const kelasList = computed(() => (m.value.kelas || []).filter((k) => k.aktif && k.jumlah));
      const qPeriode = () => (f.periode === "90" ? "?periode=90" : "?ta_id=" + f.periode.slice(3));
      const ambil = (id) => api("/rapor/" + id + qPeriode());
      async function muatSatu(id) {
        f.galat = ""; f.proses = ""; f.daftar = [];
        if (!id) return;
        f.memuat = true;
        try { f.daftar = [await ambil(id)]; } catch (e) { f.galat = e.message; } finally { f.memuat = false; }
      }
      // Rapor per kelas: daftar santri lalu rapor satu per satu dari browser (setiap permintaan tetap kecil).
      async function muatKelas() {
        f.galat = ""; f.daftar = []; f.santri = null;
        if (!f.kelas_id) return;
        f.memuat = true;
        try {
          const santri = await api(`/santri?kelas_id=${f.kelas_id}&limit=2000`);
          const hasil = [];
          for (let i = 0; i < santri.length; i++) {
            f.proses = `Memuat rapor ${i + 1} dari ${santri.length}…`;
            hasil.push(await ambil(santri[i].id));
          }
          f.daftar = hasil;
          f.proses = santri.length ? `${santri.length} rapor siap dicetak.` : "Kelas ini belum berisi santri aktif.";
        } catch (e) { f.galat = e.message; } finally { f.memuat = false; }
      }
      const idDariRute = () => +new URLSearchParams(negara.rute.split("?")[1] || "").get("santri") || 0;
      watch(() => f.santri, (s) => { if (s) { f.kelas_id = ""; muatSatu(s.id); } });
      watch(() => f.periode, () => {
        if (f.santri) muatSatu(f.santri.id);
        else if (f.kelas_id && f.daftar.length) muatKelas();
        else if (f.daftar.length === 1) muatSatu(f.daftar[0].santri.id);
      });
      onMounted(async () => {
        try { await muatMaster(); } catch (e) { f.galat = e.message; }
        const id = idDariRute();
        if (id) muatSatu(id);
      });
      const cetak = () => window.print();
      return { f, taList, kelasList, muatKelas, cetak, namaKelas };
    },
    template: `<div class="tidak-cetak"><span class="jejak">Administrasi › Kesantrian</span><h1>Rapor Kesantrian</h1></div>
  <div class="kartu tidak-cetak" style="display:flex;flex-direction:column;gap:12px">
    <div class="baris" style="align-items:flex-end">
      <label class="isian" style="flex:2 1 320px">Santri<CariSantri v-model="f.santri"/></label>
      <label class="isian">Periode<select v-model="f.periode"><option value="90">90 hari terakhir</option><option v-for="t in taList" :value="'ta:' + t.id">Tahun Ajaran {{ t.nama }}{{ t.status === 'aktif' ? ' (aktif)' : '' }}</option></select></label>
      <button :disabled="!f.daftar.length || f.memuat" @click="cetak">Cetak</button>
    </div>
    <div class="baris" style="align-items:flex-end">
      <label class="isian" style="flex:1 1 240px">Cetak per kelas<select v-model="f.kelas_id"><option value="">Pilih kelas…</option><option v-for="k in kelasList" :value="k.id">{{ namaKelas(k) }} ({{ k.jumlah }})</option></select></label>
      <button class="kedua" :disabled="!f.kelas_id || f.memuat" @click="muatKelas">Muat rapor sekelas</button>
      <span class="redup">{{ f.proses }}</span>
    </div>
    <p class="redup" style="margin:0">Kelas yang tercetak diambil dari riwayat kelas pada periode rapor. Data kesehatan tidak dimuat di rapor.</p>
  </div>
  <div v-if="f.galat" class="pesan galat tidak-cetak">{{ f.galat }}</div>
  <p v-if="f.memuat && !f.proses" class="redup tidak-cetak">Memuat…</p>
  <div><LembarRapor v-for="(r, i) in f.daftar" :key="r.santri.id" :r="r" :putus="i < f.daftar.length - 1"/></div>`,
  };

  daftarHalaman("/rapor", RaporKesantrian, {
    label: "Rapor", grup: "Administrasi", urutan: 70,
    syarat: (me) => me.bisa.rapor || me.bisa.lihat_rapor,
    ikon: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h5"/>',
  });
}
