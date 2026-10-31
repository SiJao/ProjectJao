// Modul tampilan perizinan2 — Libur Pondok (izin pulang massal), cetak semua Gate Pass, kembali massal.
// Dibuka dari tombol di halaman Perizinan (tanpa menu). Membuat/membatalkan libur: Moderator saja (putra & putri bersamaan, K-106).
const LiburPondok = {
  components: { Pesan, FotoSantri },
  directives: { baris: vBaris },
  setup() {
    const moderator = computed(() => negara.me && negara.me.role === "moderator");
    const m = computed(() => negara.master || {});
    const f = reactive({ galat: "", ok: "", daftar: [], detail: null, pratinjau: null, kecuali: {}, cariPra: "", lingPra: "", hasil: null, cetak: false, sibuk: false,
      baru: { nama: "", berangkat: "", kembali: "", jenis_izin_id: "" } });
    const km = reactive({ libur_id: "", kamar_id: "", q: "", daftar: [], pilih: {} });
    const jenisTanggal = computed(() => (m.value.jenis_izin || []).filter((j) => j.aktif));
    const jalan = async (fn) => { f.galat = ""; f.ok = ""; try { await fn(); } catch (e) { f.galat = e.message; } };

    async function muat() { f.daftar = await api("/libur"); }
    async function buka(lp) { f.pratinjau = null; f.hasil = null; f.detail = await api("/libur/" + lp.id); km.libur_id = lp.id; }
    const buat = () => jalan(async () => {
      const r = await api("/libur", f.baru);
      f.ok = "Libur Pondok dibuat. Centang santri yang TIDAK pulang, lalu eksekusi.";
      f.baru.nama = ""; await muat(); await pratinjau({ id: r.id });
    });
    const pratinjau = (lp) => jalan(async () => { f.detail = null; f.hasil = null; f.kecuali = {}; f.pratinjau = await api(`/libur/${lp.id}/pratinjau`); });
    // santri pratinjau dikelompokkan per kamar, dengan saringan nama/NIS/kamar & lingkungan
    const grupPra = computed(() => {
      if (!f.pratinjau) return [];
      const q = f.cariPra.trim().toLowerCase(), g = new Map();
      for (const s of f.pratinjau.santri) {
        if (f.lingPra && s.lingkungan !== f.lingPra) continue;
        if (q && !(s.nama.toLowerCase().includes(q) || s.nis.startsWith(q) || s.kamar.toLowerCase().includes(q))) continue;
        if (!g.has(s.kamar)) g.set(s.kamar, []);
        g.get(s.kamar).push(s);
      }
      return [...g].map(([kamar, santri]) => ({ kamar, santri }));
    });
    const jumlahPra = computed(() => {
      const s = f.pratinjau ? f.pratinjau.santri : [];
      const kec = s.filter((x) => f.kecuali[x.id]).length, lewat = s.filter((x) => x.izin_terbuka && !f.kecuali[x.id]).length;
      return { total: s.length, kecuali: kec, lewat, pulang: s.length - kec - lewat };
    });
    const semuaKamar = (g) => g.santri.every((s) => f.kecuali[s.id]);
    const tandaiKamar = (g, v) => g.santri.forEach((s) => { f.kecuali[s.id] = v; });
    const eksekusi = () => jalan(async () => {
      const j = jumlahPra.value;
      if (!confirm(`Buat izin ${f.pratinjau.libur.nama} untuk ${j.pulang} santri? ${j.kecuali} dikecualikan, ${j.lewat} dilewati karena masih punya izin terbuka.`)) return;
      f.sibuk = true;
      try {
        const kecuali = Object.keys(f.kecuali).filter((k) => f.kecuali[k]).map(Number);
        f.hasil = await api(`/libur/${f.pratinjau.libur.id}/eksekusi`, { kecuali });
        f.ok = `${f.hasil.dibuat} izin dibuat · ${f.hasil.pengumuman} pengumuman untuk akun wali masuk antrean.`;
        const id = f.pratinjau.libur.id; f.pratinjau = null; await muat(); await buka({ id });
      } finally { f.sibuk = false; }
    });
    const batal = (lp) => jalan(async () => {
      const alasan = prompt(`Batalkan ${lp.nama}? Semua izinnya ikut dibatalkan dan wali menerima ralat. Alasan:`);
      if (!alasan) return;
      const r = await api(`/libur/${lp.id}/batal`, { alasan });
      f.ok = `Libur dibatalkan: ${r.izin_dibatalkan} izin dibatalkan, ${r.ralat} ralat masuk antrean.`;
      f.detail = null; f.pratinjau = null; await muat();
    });

    // cetak semua Gate Pass libur yang dipilih (satu halaman per santri)
    async function cetakSemua() {
      f.cetak = true; await nextTick();
      const imgs = [...document.querySelectorAll(".cetak-libur img")].filter((i) => !i.complete);
      await Promise.race([Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))), new Promise((r) => setTimeout(r, 6000))]);
      setTimeout(() => window.print(), 200);
    }
    const gp = computed(() => (f.detail ? f.detail.izin.filter((z) => z.status !== "dibatalkan") : []));
    const fmt = (s, b) => !s ? "" : b === "jam" ? s.slice(11) : b === "tanggal" ? s.slice(0, 10) : s;

    // kembali massal
    async function muatTerbuka() {
      km.pilih = {};
      try { km.daftar = await api(`/izin-terbuka?libur_id=${km.libur_id}&kamar_id=${km.kamar_id}`); } catch (e) { f.galat = e.message; }
    }
    const tampilTerbuka = computed(() => {
      const q = km.q.trim().toLowerCase();
      return q ? km.daftar.filter((z) => z.nama.toLowerCase().includes(q) || z.nis.startsWith(q)) : km.daftar;
    });
    const dipilih = computed(() => Object.keys(km.pilih).filter((k) => km.pilih[k]).map(Number));
    const pilihSemua = (v) => tampilTerbuka.value.forEach((z) => { km.pilih[z.id] = v; });
    const kembaliMassal = (seluruh) => jalan(async () => {
      const kamar = (m.value.kamar || []).find((k) => k.id == km.kamar_id);
      if (seluruh && !confirm(`Tandai SELURUH santri kamar ${kamar ? kamar.nama : ""} yang masih berizin sudah kembali sekarang?`)) return;
      const r = await api("/izin/kembali-massal", seluruh ? { seluruh_kamar: true, kamar_id: +km.kamar_id, libur_id: km.libur_id ? +km.libur_id : null } : { izin_ids: dipilih.value });
      f.ok = `${r.kembali} santri dikonfirmasi kembali.`;
      await muatTerbuka(); await muat();
      if (f.detail) await buka(f.detail.libur);
    });
    watch(() => [km.libur_id, km.kamar_id], muatTerbuka);

    onMounted(() => jalan(async () => {
      await muatMaster();
      const p = jenisTanggal.value.find((j) => j.basis_waktu === "tanggal");
      if (p) f.baru.jenis_izin_id = p.id;
      await muat(); await muatTerbuka();
    }));
    const lencana = (k) => ({ berjalan: "biru", terlambat: "kuning", overdue: "merah", kembali: "hijau", rencana: "kuning", selesai: "hijau", dibatalkan: "" }[k]);
    return { f, km, m, moderator, jenisTanggal, buka, buat, pratinjau, grupPra, jumlahPra, semuaKamar, tandaiKamar, eksekusi, batal, cetakSemua, gp, fmt,
      tampilTerbuka, dipilih, pilihSemua, kembaliMassal, lencana };
  },
  template: `
  <template v-if="f.cetak">
    <div class="baris tidak-cetak"><button class="kedua" @click="f.cetak=false">Kembali ke Libur Pondok</button><button @click="cetakSemua">Cetak ulang</button><span class="redup">{{ gp.length }} Gate Pass</span></div>
    <div class="cetak-libur">
      <div v-for="z in gp" :key="z.id" class="gatepass" style="break-after:page;page-break-after:always;margin-bottom:18px">
        <div class="kepala"><img src="/img/logo-hisada-256.png" alt=""><div><strong style="font-size:16px">Pesantren Modern Daarul 'Uluum Lido</strong><div>SEKRETARIS HISADA</div></div></div>
        <div style="text-align:center;font-weight:700;letter-spacing:.12em;margin-bottom:14px">GATE PASS · {{ f.detail.libur.jenis.toUpperCase() }}</div>
        <div style="display:flex;gap:16px;align-items:flex-start">
          <img v-if="z.foto_url" class="foto-gp" :src="z.foto_url" :alt="'Foto ' + z.nama" referrerpolicy="no-referrer">
          <table style="flex:1"><tbody>
            <tr><td style="width:150px">Name</td><td><strong>{{ z.nama }}</strong> ({{ z.nis }})</td></tr>
            <tr><td>Class / Room</td><td>{{ z.kelas }} · {{ z.kamar }}</td></tr>
            <tr><td>Reason</td><td>{{ z.keterangan }}</td></tr>
            <tr><td>Departure</td><td>{{ fmt(z.berangkat, f.detail.libur.basis_waktu) }}</td></tr>
            <tr><td>Return</td><td>{{ fmt(z.rencana_kembali, f.detail.libur.basis_waktu) }}</td></tr>
            <tr v-if="z.pendamping"><td>Pendamping</td><td>{{ z.pendamping }}</td></tr>
          </tbody></table></div>
        <div style="margin-top:44px;text-align:right"><div style="display:inline-block;border-top:1px solid #000;padding-top:6px;min-width:200px;text-align:center">Security Department</div></div>
        <p class="redup tidak-cetak">No. izin {{ z.id }}</p>
      </div>
    </div>
  </template>
  <template v-else>
  <div class="judul-hal"><div><span class="jejak">Administrasi › Kesantrian › Perizinan</span><h1>Libur Pondok & kembali massal</h1></div><a class="tombol kedua" href="#/perizinan">Kembali ke Perizinan</a></div>
  <Pesan :galat="f.galat" :ok="f.ok"/>

  <div class="kartu" v-if="moderator" style="display:flex;flex-direction:column;gap:12px">
    <h2>Buat Libur Pondok</h2>
    <p class="redup" style="margin:0">Satu libur berlaku untuk santri putra & putri bersamaan. Izin dibuat untuk semua santri aktif kecuali yang dicentang tidak pulang; wali menerima satu pengumuman.</p>
    <div class="baris">
      <label class="isian" style="flex:2 1 240px">Nama libur<input v-model="f.baru.nama" maxlength="80" placeholder="Libur Semester Ganjil 2026/2027"></label>
      <label class="isian">Tanggal berangkat<input type="date" v-model="f.baru.berangkat"></label>
      <label class="isian">Tanggal kembali<input type="date" v-model="f.baru.kembali"></label>
      <label class="isian">Jenis izin<select v-model="f.baru.jenis_izin_id"><option v-for="j in jenisTanggal" :value="j.id">{{ j.nama }}</option></select></label>
      <button @click="buat" :disabled="!f.baru.nama || !f.baru.berangkat || !f.baru.kembali">Buat & pratinjau</button>
    </div>
    <span class="redup">Batas kembali pukul {{ (jenisTanggal.find(j => j.id == f.baru.jenis_izin_id) || {}).jam_kembali_bawaan || '17:00' }} WIB (jam kembali bawaan jenis izin).</span>
  </div>

  <div class="tabel"><table>
    <thead><tr><th>Libur</th><th>Berangkat</th><th>Kembali</th><th>Status</th><th>Izin</th><th></th></tr></thead>
    <tbody v-baris><tr v-for="lp in f.daftar" :key="lp.id">
      <td><strong>{{ lp.nama }}</strong><div class="redup">{{ lp.jenis }} · oleh {{ lp.pembuat || '—' }}</div></td>
      <td>{{ lp.berangkat.slice(0,10) }}</td><td>{{ lp.rencana_kembali }}</td>
      <td><span class="lencana" :class="lencana(lp.status)">{{ lp.status }}</span></td>
      <td>{{ lp.jumlah }} <span class="redup">· {{ lp.terbuka || 0 }} belum kembali<template v-if="lp.overdue"> · <span style="color:var(--merah)">{{ lp.overdue }} overdue</span></template></span></td>
      <td style="white-space:nowrap"><button class="kedua kecil" @click="buka(lp)">Izin & Gate Pass</button>
        <template v-if="moderator && (lp.status==='rencana' || lp.status==='berjalan')"> <button class="kecil" @click="pratinjau(lp)">{{ lp.status==='rencana' ? 'Pratinjau & eksekusi' : 'Tambah santri' }}</button> <button class="bahaya kecil" @click="batal(lp)">Batalkan</button></template></td>
    </tr></tbody></table>
    <p v-if="!f.daftar.length" class="redup" style="padding:14px">Belum ada Libur Pondok.</p></div>

  <div v-if="f.pratinjau" class="kartu" style="display:flex;flex-direction:column;gap:12px">
    <div class="baris" style="justify-content:space-between;align-items:center"><h2>Pratinjau: {{ f.pratinjau.libur.nama }}</h2><button class="kedua kecil" @click="f.pratinjau=null">Tutup</button></div>
    <div class="pesan info">{{ jumlahPra.total }} santri aktif · <strong>{{ jumlahPra.pulang }} pulang</strong> · {{ jumlahPra.kecuali }} tidak pulang · {{ jumlahPra.lewat }} dilewati (masih punya izin terbuka)</div>
    <div class="baris">
      <label class="isian" style="flex:2 1 220px">Saring (nama, NIS, kamar)<input v-model="f.cariPra" placeholder="Ketik untuk menyaring"></label>
      <label class="isian">Lingkungan<select v-model="f.lingPra"><option value="">Putra & putri</option><option value="putra">Putra</option><option value="putri">Putri</option></select></label>
    </div>
    <p class="redup" style="margin:0">Centang santri yang <strong>TIDAK pulang</strong> (tetap diabsen biasa).</p>
    <div v-for="g in grupPra" :key="g.kamar" style="border-top:1px solid var(--garis-tipis);padding-top:8px">
      <label style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" :checked="semuaKamar(g)" @change="tandaiKamar(g, $event.target.checked)"> {{ g.kamar }} <span class="redup">({{ g.santri.length }})</span></label>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr));gap:4px 14px;padding:6px 0 0 26px">
        <label v-for="s in g.santri" :key="s.id" style="display:flex;gap:8px;align-items:center;font-size:14px">
          <input type="checkbox" v-model="f.kecuali[s.id]"><span>{{ s.nama }} <span class="redup">{{ s.nis }}</span>
          <span v-if="s.izin_terbuka && !f.kecuali[s.id]" class="lencana kuning">izin terbuka · dilewati</span><span v-if="s.sudah" class="lencana hijau">sudah</span></span></label>
      </div>
    </div>
    <div><button :disabled="f.sibuk || !jumlahPra.pulang" @click="eksekusi">{{ f.sibuk ? 'Memproses…' : 'Eksekusi: buat ' + jumlahPra.pulang + ' izin' }}</button></div>
  </div>

  <div v-if="f.hasil && f.hasil.dilewati.length" class="kartu" style="display:flex;flex-direction:column;gap:8px">
    <h2>Dilewati karena masih punya izin terbuka ({{ f.hasil.dilewati.length }})</h2>
    <div v-for="s in f.hasil.dilewati" :key="s.id">{{ s.nama }} <span class="redup">{{ s.nis }} · {{ s.kamar }} · {{ s.jenis }}</span></div>
  </div>

  <div v-if="f.detail" class="kartu" style="display:flex;flex-direction:column;gap:12px">
    <div class="baris" style="justify-content:space-between;align-items:center">
      <h2>{{ f.detail.libur.nama }} <span class="lencana" :class="lencana(f.detail.libur.status)">{{ f.detail.libur.status }}</span></h2>
      <div class="baris"><button :disabled="!gp.length" @click="cetakSemua">Cetak semua Gate Pass ({{ gp.length }})</button><button class="kedua kecil" @click="f.detail=null">Tutup</button></div>
    </div>
    <p v-if="f.detail.libur.alasan_batal" class="pesan galat">Dibatalkan: {{ f.detail.libur.alasan_batal }}</p>
    <div class="tabel"><table><thead><tr><th>Santri</th><th>Kamar</th><th>Status</th><th>Kembali</th><th></th></tr></thead>
      <tbody v-baris><tr v-for="z in f.detail.izin" :key="z.id">
        <td><div class="santri-sel"><FotoSantri :s="z" ukuran="kecil"/><span><strong>{{ z.nama }}</strong><div class="redup">{{ z.nis }}</div></span></div></td>
        <td>{{ z.kamar }}</td><td><span class="lencana" :class="lencana(z.keadaan)">{{ z.keadaan }}</span></td><td>{{ z.kembali_at || '—' }}</td>
        <td><a class="tombol kedua kecil" :href="'#/gatepass/' + z.id" target="_blank">Gate Pass</a></td></tr></tbody></table>
      <p v-if="!f.detail.izin.length" class="redup" style="padding:14px">Belum ada izin di lingkungan Anda.</p></div>
  </div>

  <div class="kartu" style="display:flex;flex-direction:column;gap:12px">
    <h2>Kembali massal</h2>
    <p class="redup" style="margin:0">Hari kembali: pilih santri yang sudah tiba, atau tandai seluruh kamar. Yang belum dikonfirmasi tetap mengikuti aturan terlambat & overdue.</p>
    <div class="baris">
      <label class="isian">Libur<select v-model="km.libur_id"><option value="">Semua izin terbuka</option><option v-for="lp in f.daftar.filter(x => x.status==='berjalan')" :value="lp.id">{{ lp.nama }}</option></select></label>
      <label class="isian">Kamar<select v-model="km.kamar_id"><option value="">Semua kamar</option><option v-for="k in (m.kamar || []).filter(k => k.aktif)" :value="k.id">{{ k.nama }}</option></select></label>
      <label class="isian" style="flex:1 1 200px">Saring nama / NIS<input v-model="km.q" placeholder="Ketik untuk menyaring"></label>
    </div>
    <div class="baris">
      <button class="kedua kecil" @click="pilihSemua(true)" :disabled="!tampilTerbuka.length">Pilih semua yang tampil</button>
      <button class="kedua kecil" @click="pilihSemua(false)">Kosongkan</button>
      <button :disabled="!dipilih.length" @click="kembaliMassal(false)">Konfirmasi kembali ({{ dipilih.length }})</button>
      <button v-if="km.kamar_id" class="kedua" @click="kembaliMassal(true)">Seluruh kamar ini kembali</button>
    </div>
    <div class="tabel"><table><thead><tr><th></th><th>Santri</th><th>Kamar</th><th>Jenis</th><th>Batas kembali</th><th>Status</th></tr></thead>
      <tbody v-baris><tr v-for="z in tampilTerbuka" :key="z.id" @click="km.pilih[z.id] = !km.pilih[z.id]" style="cursor:pointer">
        <td><input type="checkbox" v-model="km.pilih[z.id]" @click.stop :aria-label="'Pilih ' + z.nama"></td>
        <td><strong>{{ z.nama }}</strong><div class="redup">{{ z.nis }}</div></td><td>{{ z.kamar }}</td><td>{{ z.jenis }}</td><td>{{ z.rencana_kembali }}</td>
        <td><span class="lencana" :class="lencana(z.keadaan)">{{ z.keadaan }}</span></td></tr></tbody></table>
      <p v-if="!tampilTerbuka.length" class="redup" style="padding:14px">Tidak ada izin terbuka.</p></div>
  </div>
  </template>`,
};
daftarHalaman("/libur-pondok", LiburPondok, null);
