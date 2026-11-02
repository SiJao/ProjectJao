// Modul tampilan komunikasi — pengumuman ke kelompok, email ke wali tertentu, antrean email, kelola Portal Wali.
const Komunikasi = {
  components: { Pesan, CariSantri, FotoSantri, SandiSementara },
  directives: { baris: vBaris },
  setup() {
    const moderator = computed(() => negara.me && negara.me.role === "moderator");
    const m = computed(() => negara.master || {});
    const TAB = [["pengumuman", "Pengumuman"], ["wali", "Email ke wali"], ["antrean", "Antrean email"], ["portal", "Portal Wali"]];
    const tab = ref("pengumuman");
    const tabTampil = computed(() => TAB.filter((t) => moderator.value || t[0] === "pengumuman"));
    const f = reactive({ galat: "", ok: "", sandi: null });
    const jalan = async (fn) => { f.galat = ""; f.ok = ""; try { await fn(); } catch (e) { f.galat = e.message; } };

    // ---- pengumuman
    // Saringan bisa digabung (K-118): lingkungan, kelas, kamar, jabatan. "Tampilkan daftar" → santri hasil saringan bisa dicentang/dihapus
    // dan ditambah lewat cari; bila daftar dibuka, yang dikirim adalah santri yang dicentang (santri_ids).
    const pg = reactive({ target: "wali", ling: "", kelas_id: "", kamar_id: "", jabatan_ids: [], jabatan: [], calon: null, centang: {}, qCalon: "", tambah: null,
      subjek: "", isi: "", pratinjau: null, riwayat: [] });
    const lingPg = computed(() => (moderator.value || negara.me.lingkungan === "semua" ? ["putra", "putri"] : []));
    const saringPg = () => ({ target: pg.target, ling: pg.ling || null, kelas_id: +pg.kelas_id || null, kamar_id: +pg.kamar_id || null, jabatan_ids: pg.jabatan_ids.map(Number) });
    const dipilihPg = computed(() => (pg.calon || []).filter((s) => pg.centang[s.id]));
    const dataPg = () => ({ ...saringPg(), ...(pg.calon ? { santri_ids: dipilihPg.value.map((s) => s.id) } : {}), subjek: pg.subjek, isi: pg.isi });
    const kelasPg = computed(() => (m.value.kelas || []).filter((k) => k.aktif && (!pg.ling || k.lingkungan === pg.ling)));
    const kamarPg = computed(() => (m.value.kamar || []).filter((k) => k.aktif && (!pg.ling || k.lingkungan === pg.ling)));
    const calonTampil = computed(() => { const q = pg.qCalon.trim().toLowerCase(); return (pg.calon || []).filter((s) => !q || s.nama.toLowerCase().includes(q) || s.nis.startsWith(q)); });
    const muatJabatanPg = () => jalan(async () => { pg.jabatan = (await api("/komunikasi/pengumuman/calon", { hanya_jabatan: true })).jabatan; });
    const tampilkanCalon = () => jalan(async () => {
      const r = await api("/komunikasi/pengumuman/calon", saringPg());
      pg.calon = r.santri; pg.centang = Object.fromEntries(r.santri.map((s) => [s.id, true])); pg.pratinjau = null;
    });
    const centangSemua = (v) => calonTampil.value.forEach((s) => { pg.centang[s.id] = v; });
    watch(() => pg.tambah, (s) => {
      if (!s || !pg.calon) return;
      if (!pg.calon.some((x) => x.id === s.id)) pg.calon.unshift({ id: s.id, nis: s.nis, nama: s.nama, lingkungan: s.lingkungan, foto_url: s.foto_url, kelas: s.kelas, kamar: s.kamar, penerima: null });
      pg.centang[s.id] = true; pg.tambah = null; pg.pratinjau = null;
    });
    watch(() => pg.centang, () => { pg.pratinjau = null; }, { deep: true });
    const muatRiwayatPg = async () => { pg.riwayat = await api("/komunikasi/pengumuman"); };
    const pratinjauPg = () => jalan(async () => { pg.pratinjau = await api("/komunikasi/pengumuman", dataPg()); });
    const kirimPg = () => jalan(async () => {
      if (!confirm(`Kirim pengumuman "${pg.subjek}" ke ${pg.pratinjau.jumlah} penerima?`)) return;
      const r = await api("/komunikasi/pengumuman", { ...dataPg(), konfirmasi: true });
      f.ok = `${r.jumlah} email masuk antrean.`; pg.pratinjau = null; pg.subjek = ""; pg.isi = ""; await muatRiwayatPg();
    });
    // saringan berubah → daftar centang lama tidak berlaku
    watch(() => [pg.target, pg.ling, pg.kelas_id, pg.kamar_id, pg.jabatan_ids.join()], () => { pg.pratinjau = null; pg.calon = null; pg.centang = {}; });

    // ---- email ke wali tertentu (Moderator)
    const ew = reactive({ santri: null, data: null, pilih: {}, subjek: "", isi: "" });
    watch(() => ew.santri, async (s) => {
      ew.data = null; ew.pilih = {};
      if (s) await jalan(async () => { ew.data = await api(`/komunikasi/santri/${s.id}/wali`); ew.data.akun.forEach((a) => { ew.pilih[a.id] = a.status === "aktif"; }); });
    });
    const kirimWali = () => jalan(async () => {
      const ids = Object.keys(ew.pilih).filter((k) => ew.pilih[k]).map(Number);
      const r = await api("/komunikasi/email-wali", { santri_id: ew.santri.id, akun_wali_ids: ids, subjek: ew.subjek, isi: ew.isi });
      f.ok = `${r.jumlah} email masuk antrean.`; ew.subjek = ""; ew.isi = "";
    });

    // ---- antrean email (Moderator)
    const an = reactive({ status: "", q: "", daftar: [], hitung: {}, konfig: null, buka: null });
    let tAn;
    const muatAntrean = async () => { const r = await api(`/komunikasi/antrean?status=${an.status}&q=${encodeURIComponent(an.q)}`); an.daftar = r.daftar; an.hitung = r.hitung; };
    watch(() => an.status, () => jalan(muatAntrean));
    watch(() => an.q, () => { clearTimeout(tAn); tAn = setTimeout(() => jalan(muatAntrean), 250); });
    const ulang = (e) => jalan(async () => { await api(`/komunikasi/antrean/${e.id}/ulang`, {}); f.ok = "Email masuk antrean lagi."; await muatAntrean(); });
    const ulangSemua = () => jalan(async () => { const r = await api("/komunikasi/antrean/ulang-semua", {}); f.ok = `${r.jumlah} email gagal masuk antrean lagi.`; await muatAntrean(); });
    const kirimSekarang = () => jalan(async () => {
      const r = await api("/komunikasi/kirim", {});
      f.ok = r.belum_diatur ? "Pengirim email belum diatur — email tetap di antrean." : `Terkirim ${r.terkirim}, gagal ${r.gagal}${r.sisa ? ", sisa " + r.sisa : ""}.`;
      await muatAntrean();
    });

    // ---- Portal Wali (Moderator)
    const pw = reactive({ q: "", status: "", akun: [], tq: "", cara: "", tautan: [], santri: null, dataSantri: null, akunPilih: "", hp: {} });
    let tAk, tTt;
    const muatAkun = async () => { pw.akun = await api(`/komunikasi/akun-wali?q=${encodeURIComponent(pw.q)}&status=${pw.status}`); };
    const muatTautan = async () => { pw.tautan = await api(`/komunikasi/tautan?q=${encodeURIComponent(pw.tq)}&cara=${pw.cara}`); };
    watch(() => [pw.q, pw.status], () => { clearTimeout(tAk); tAk = setTimeout(() => jalan(muatAkun), 250); });
    watch(() => [pw.tq, pw.cara], () => { clearTimeout(tTt); tTt = setTimeout(() => jalan(muatTautan), 250); });
    const aksiAkun = (a, aksi) => jalan(async () => {
      const r = await api(`/komunikasi/akun-wali/${a.id}`, { aksi }); f.ok = "Akun wali diperbarui.";
      if (r.password_sementara) f.sandi = [{ nama: a.nama, email: a.email, password: r.password_sementara }];
      await muatAkun();
    });
    // akun wali dihapus permanen: sesi, token, dan tautan ke anak ikut terhapus (K-114)
    const hapusAkunWali = (a) => jalan(async () => {
      if (await hapusData("akun_wali", a.id, "akun wali " + a.email, "Tautan ke anak, sesi login, dan token akun ini ikut terhapus. Wali bisa mendaftar ulang.")) { f.ok = "Akun wali dihapus."; await muatAkun(); await muatTautan(); }
    });
    const cabut = (t) => jalan(async () => {
      if (!confirm(`Cabut tautan ${t.wali} ↔ ${t.santri}?`)) return;
      await api(`/komunikasi/tautan/${t.id}/cabut`, {}); f.ok = "Tautan dicabut."; await muatTautan(); await muatAkun();
    });
    const muatSantriPw = async () => {
      pw.dataSantri = null;
      if (!pw.santri) return;
      pw.dataSantri = await api(`/komunikasi/santri/${pw.santri.id}/wali`);
      pw.hp = Object.fromEntries(pw.dataSantri.wali.map((w) => [w.id, w.no_hp || ""]));
    };
    watch(() => pw.santri, () => jalan(muatSantriPw));
    const tautkan = () => jalan(async () => {
      await api("/komunikasi/tautan", { akun_wali_id: +pw.akunPilih, santri_id: pw.santri.id });
      f.ok = "Akun wali ditautkan manual."; pw.akunPilih = ""; await muatSantriPw(); await muatTautan(); await muatAkun();
    });
    const simpanHp = (w) => jalan(async () => { await api(`/komunikasi/wali/${w.id}/hp`, { no_hp: pw.hp[w.id] }); f.ok = "No. HP wali disimpan."; await muatSantriPw(); });

    watch(tab, (t) => jalan(async () => {
      if (t === "pengumuman") await muatRiwayatPg();
      if (t === "antrean") { await muatAntrean(); an.konfig = await api("/komunikasi/konfigurasi"); }
      if (t === "portal") { await muatAkun(); await muatTautan(); }
    }), { immediate: true });
    onMounted(() => muatMaster());
    const lencanaSt = (s) => ({ antre: "kuning", terkirim: "hijau", gagal: "merah", aktif: "hijau", belum_verifikasi: "kuning", nonaktif: "merah" }[s] || "");
    onMounted(muatJabatanPg);
    return { moderator, m, tab, tabTampil, f, pg, pratinjauPg, kirimPg, lingPg, kelasPg, kamarPg, calonTampil, dipilihPg, tampilkanCalon, centangSemua, ew, kirimWali, an, ulang, ulangSemua, kirimSekarang,
      pw, aksiAkun, hapusAkunWali, cabut, tautkan, simpanHp, lencanaSt, namaKelas };
  },
  template: `<div><span class="jejak">Fungsi › Komunikasi</span><h1>Komunikasi</h1></div>
  <div class="tab"><button v-for="t in tabTampil" :key="t[0]" :class="{aktif: tab===t[0]}" @click="tab=t[0]; f.ok=''; f.galat=''">{{ t[1] }}<span v-if="t[0]==='antrean' && an.hitung.gagal" class="lencana merah" style="margin-left:6px">{{ an.hitung.gagal }}</span></button></div>
  <Pesan :galat="f.galat" :ok="f.ok"/>
  <SandiSementara v-if="f.sandi" :daftar="f.sandi" @tutup="f.sandi = null"/>

  <template v-if="tab==='pengumuman'">
    <div class="kartu" style="display:flex;flex-direction:column;gap:12px;max-width:820px">
      <h2>Pengumuman ke kelompok</h2>
      <div class="baris">
        <label class="isian">Sasaran<select v-model="pg.target"><option value="wali">Wali santri</option><option value="pengurus">Pengurus (akun santri)</option></select></label>
        <label class="isian" v-if="lingPg.length">Lingkungan<select v-model="pg.ling"><option value="">Putra & putri</option><option v-for="l in lingPg" :value="l">{{ l }}</option></select></label>
        <label class="isian">Kelas<select v-model="pg.kelas_id"><option value="">Semua kelas</option><option v-for="k in kelasPg" :value="k.id">{{ namaKelas(k) }}{{ lingPg.length ? ' (' + k.lingkungan + ')' : '' }}</option></select></label>
        <label class="isian">Kamar<select v-model="pg.kamar_id"><option value="">Semua kamar</option><option v-for="k in kamarPg" :value="k.id">{{ k.nama }}</option></select></label>
      </div>
      <details class="kartu" style="padding:10px 14px;box-shadow:none"><summary style="cursor:pointer"><strong>Jabatan / bagian</strong> <span class="redup">— {{ pg.jabatan_ids.length ? pg.jabatan_ids.length + ' dipilih (hanya santri pemegang jabatan itu)' : 'semua (tanpa saringan jabatan)' }}</span></summary>
        <div style="display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:8px;max-height:220px;overflow:auto">
          <label v-for="j in pg.jabatan" :key="j.id" style="display:flex;gap:6px;align-items:center;font-size:13.5px;flex:1 1 260px"><input type="checkbox" :value="j.id" v-model="pg.jabatan_ids">{{ j.nama }}</label></div>
        <button v-if="pg.jabatan_ids.length" class="kedua kecil" style="margin-top:6px" @click="pg.jabatan_ids = []">Kosongkan</button></details>
      <div class="baris"><button class="kedua" @click="tampilkanCalon">{{ pg.calon ? 'Muat ulang daftar santri' : 'Tampilkan daftar santri (pilih satu per satu)' }}</button>
        <button v-if="pg.calon" class="kedua" @click="pg.calon = null; pg.centang = {}; pg.pratinjau = null">Pakai saringan saja</button></div>
      <template v-if="pg.calon">
        <div class="baris"><label class="isian" style="flex:1 1 200px">Saring daftar<input v-model="pg.qCalon" placeholder="Nama atau NIS"></label>
          <div style="flex:1 1 280px"><span class="redup" style="font-size:13px">Tambah santri di luar saringan</span><CariSantri v-model="pg.tambah"/></div></div>
        <div class="baris"><button class="kedua kecil" @click="centangSemua(true)">Centang semua</button><button class="kedua kecil" @click="centangSemua(false)">Kosongkan</button>
          <span class="redup">{{ dipilihPg.length }} dari {{ pg.calon.length }} santri dipilih</span></div>
        <div class="tabel" style="max-height:360px;overflow:auto"><table><thead><tr><th></th><th>Santri</th><th>Jabatan</th><th>{{ pg.target === 'pengurus' ? 'Akun' : 'Akun wali' }}</th></tr></thead>
          <tbody v-baris><tr v-for="s in calonTampil" :key="s.id" :style="{opacity: pg.centang[s.id] ? 1 : .55}"><td style="width:36px"><input type="checkbox" v-model="pg.centang[s.id]" :aria-label="'Pilih ' + s.nama"></td>
            <td><div class="santri-sel"><FotoSantri :s="s" ukuran="kecil"/><span><strong>{{ s.nama }}</strong><div class="redup">{{ s.nis }}{{ s.kelas ? ' · ' + s.kelas : '' }}{{ s.kamar ? ' · ' + s.kamar : '' }}</div></span></div></td>
            <td class="redup">{{ s.jabatan || '—' }}</td><td><span v-if="s.penerima === null" class="redup">?</span><span v-else class="lencana" :class="s.penerima ? 'hijau' : 'kuning'">{{ s.penerima || 'tidak ada' }}</span></td></tr></tbody></table>
          <p v-if="!calonTampil.length" class="redup" style="padding:14px">Tidak ada santri.</p></div>
      </template>
      <p class="redup" style="margin:0">Wali = akun Portal Wali aktif yang tertaut ke santri terpilih. Pengurus = akun santri yang aktif. Santri tanpa akun (wali) tidak menerima email. Setiap penerima hanya mendapat satu email.</p>
      <label class="isian">Subjek<input v-model="pg.subjek" maxlength="150"></label>
      <label class="isian">Isi<textarea v-model="pg.isi" rows="6" maxlength="4000"></textarea></label>
      <p class="redup" style="margin:0">Jangan menulis data sensitif (diagnosa, isi vonis) di email.</p>
      <div class="baris"><button class="kedua" :disabled="pg.calon && !dipilihPg.length" @click="pratinjauPg">Pratinjau penerima</button>
        <button v-if="pg.pratinjau" :disabled="!pg.pratinjau.jumlah || !pg.subjek || !pg.isi" @click="kirimPg">Kirim ke {{ pg.pratinjau.jumlah }} penerima</button></div>
      <div v-if="pg.pratinjau" class="pesan info"><strong>{{ pg.pratinjau.jumlah }}</strong> penerima.
        <span v-if="pg.pratinjau.contoh.length"> Contoh: <span v-for="(c, i) in pg.pratinjau.contoh">{{ i ? ', ' : '' }}{{ c.nama }} &lt;{{ c.email }}&gt;</span></span></div>
    </div>
    <h2>Riwayat pengumuman</h2>
    <div class="tabel"><table><thead><tr><th>Waktu (UTC)</th><th>Oleh</th><th>Pengumuman</th><th>Terkirim</th><th>Antre</th><th>Gagal</th></tr></thead>
      <tbody v-baris><tr v-for="r in pg.riwayat" :key="r.id"><td class="redup" style="white-space:nowrap">{{ r.waktu }}</td><td>{{ r.oleh }}</td><td>{{ r.ringkasan }}</td><td>{{ r.terkirim || 0 }}</td><td>{{ r.antre || 0 }}</td><td>{{ r.gagal || 0 }}</td></tr></tbody></table>
      <p v-if="!pg.riwayat.length" class="redup" style="padding:14px">Belum ada pengumuman.</p></div>
  </template>

  <template v-if="tab==='wali' && moderator">
    <div class="kartu" style="display:flex;flex-direction:column;gap:12px;max-width:820px">
      <h2>Email ke wali tertentu</h2>
      <label class="isian">Santri<CariSantri v-model="ew.santri"/></label>
      <template v-if="ew.data">
        <p v-if="!ew.data.akun.length" class="pesan info">Santri ini belum punya akun wali tertaut. Tautkan manual di tab Portal Wali.</p>
        <label v-for="a in ew.data.akun" :key="a.id" style="display:flex;gap:10px;align-items:center"><input type="checkbox" v-model="ew.pilih[a.id]" :disabled="a.status!=='aktif'">
          <span><strong>{{ a.nama }}</strong> <span class="redup">{{ a.email }} · {{ a.hubungan || 'tautan manual' }}</span> <span class="lencana" :class="lencanaSt(a.status)">{{ a.status }}</span></span></label>
        <label class="isian">Subjek<input v-model="ew.subjek" maxlength="150" placeholder="mis. Surat pemanggilan wali"></label>
        <label class="isian">Isi<textarea v-model="ew.isi" rows="6" maxlength="4000"></textarea></label>
        <p class="redup" style="margin:0">Tanpa data sensitif (diagnosa, isi vonis); rincian disampaikan langsung.</p>
        <div><button :disabled="!ew.subjek || !ew.isi || !Object.values(ew.pilih).some(Boolean)" @click="kirimWali">Masukkan ke antrean</button></div>
      </template>
    </div>
  </template>

  <template v-if="tab==='antrean' && moderator">
    <div class="kisi" v-if="an.konfig">
      <div class="kartu stat"><div class="redup">GMAIL_REFRESH_TOKEN</div><strong :style="{color: an.konfig.gmail_refresh_token ? 'var(--hijau)' : 'var(--merah)'}">{{ an.konfig.gmail_refresh_token ? 'Sudah diatur' : 'Belum diatur' }}</strong></div>
      <div class="kartu stat"><div class="redup">GMAIL_PENGIRIM</div><strong :style="{color: an.konfig.gmail_pengirim ? 'var(--hijau)' : 'var(--merah)'}">{{ an.konfig.gmail_pengirim ? 'Sudah diatur' : 'Belum diatur' }}</strong></div>
      <div class="kartu stat"><div class="redup">Mode Uji</div><strong :style="{color: an.konfig.mode_uji ? 'var(--kuning)' : 'var(--hijau)'}">{{ an.konfig.mode_uji ? 'Aktif' : 'Mati' }}</strong></div>
      <div class="kartu stat"><div class="redup">email.alamat_uji</div><strong :style="{color: an.konfig.alamat_uji || !an.konfig.mode_uji ? 'var(--hijau)' : 'var(--merah)'}">{{ an.konfig.alamat_uji ? 'Sudah diisi' : 'Kosong' }}</strong></div>
    </div>
    <div class="baris">
      <label class="isian">Status<select v-model="an.status"><option value="">Semua</option><option value="antre">Antre ({{ an.hitung.antre || 0 }})</option><option value="terkirim">Terkirim ({{ an.hitung.terkirim || 0 }})</option><option value="gagal">Gagal ({{ an.hitung.gagal || 0 }})</option></select></label>
      <label class="isian" style="flex:1 1 220px">Cari penerima / subjek<input v-model="an.q" placeholder="Ketik untuk menyaring"></label>
      <button @click="kirimSekarang">Kirim sekarang</button>
      <button v-if="an.hitung.gagal" class="kedua" @click="ulangSemua">Kirim ulang semua yang gagal</button>
    </div>
    <div class="tabel"><table><thead><tr><th>Dibuat (UTC)</th><th>Penerima</th><th>Subjek</th><th>Jenis</th><th>Status</th><th></th></tr></thead>
      <tbody v-baris><template v-for="e in an.daftar" :key="e.id"><tr>
        <td class="redup" style="white-space:nowrap">{{ e.dibuat_at }}</td><td>{{ e.penerima }}</td>
        <td><a href="#" @click.prevent="an.buka = an.buka === e.id ? null : e.id">{{ e.subjek }}</a><div v-if="e.galat" class="redup" style="color:var(--merah)">{{ e.galat }}</div></td>
        <td>{{ e.jenis }}</td><td><span class="lencana" :class="lencanaSt(e.status)">{{ e.status }}</span><div class="redup">{{ e.percobaan }}× · {{ e.dikirim_at || '' }}</div></td>
        <td><button v-if="e.status==='gagal'" class="kedua kecil" @click="ulang(e)">Kirim ulang</button></td></tr>
        <tr v-if="an.buka === e.id"><td colspan="6"><pre style="white-space:pre-wrap;font:inherit;margin:0">{{ e.isi }}</pre></td></tr></template></tbody></table>
      <p v-if="!an.daftar.length" class="redup" style="padding:14px">Antrean kosong.</p></div>
  </template>

  <template v-if="tab==='portal' && moderator">
    <div class="kartu" style="display:flex;flex-direction:column;gap:12px">
      <h2>Tautkan manual & No. HP wali</h2>
      <p class="redup" style="margin:0">Untuk wali yang gagal menautkan otomatis: periksa datanya, lalu tautkan manual, atau perbaiki No. HP wali (hanya Moderator) agar wali bisa mencoba lagi.</p>
      <label class="isian">Santri<CariSantri v-model="pw.santri"/></label>
      <template v-if="pw.dataSantri">
        <div class="tabel"><table><thead><tr><th>Data wali (sekretariat)</th><th>No. HP</th><th></th></tr></thead>
          <tbody><tr v-for="w in pw.dataSantri.wali" :key="w.id"><td><strong>{{ w.nama }}</strong> <span class="redup">{{ w.hubungan }}</span></td>
            <td><input v-model="pw.hp[w.id]" inputmode="tel" style="width:180px" :aria-label="'No. HP ' + w.nama"></td><td><button class="kedua kecil" :disabled="(pw.hp[w.id] || '') === (w.no_hp || '')" @click="simpanHp(w)">Simpan No. HP</button></td></tr></tbody></table>
          <p v-if="!pw.dataSantri.wali.length" class="redup" style="padding:14px">Belum ada data wali dari sekretariat.</p></div>
        <div><strong style="font-size:13px">Akun tertaut:</strong> <span v-for="(a, i) in pw.dataSantri.akun">{{ i ? ', ' : '' }}{{ a.nama }} ({{ a.cara }})</span><span v-if="!pw.dataSantri.akun.length" class="redup">belum ada</span></div>
        <div class="baris"><label class="isian" style="flex:1 1 260px">Akun wali<select v-model="pw.akunPilih"><option value="">Pilih akun wali (saring di daftar bawah)…</option><option v-for="a in pw.akun.filter(a => a.status!=='nonaktif')" :value="a.id">{{ a.nama }} · {{ a.email }}</option></select></label>
          <button :disabled="!pw.akunPilih" @click="tautkan">Tautkan manual</button></div>
      </template>
    </div>
    <h2>Akun wali</h2>
    <div class="baris"><label class="isian" style="flex:1 1 240px">Cari nama / email / No. HP<input v-model="pw.q" placeholder="Ketik untuk menyaring"></label>
      <label class="isian">Status<select v-model="pw.status"><option value="">Semua</option><option value="belum_verifikasi">Belum verifikasi</option><option value="aktif">Aktif</option><option value="nonaktif">Nonaktif</option></select></label></div>
    <div class="tabel"><table><thead><tr><th>Wali</th><th>No. HP</th><th>Anak</th><th>Status</th><th></th></tr></thead>
      <tbody v-baris><tr v-for="a in pw.akun" :key="a.id">
        <td><strong>{{ a.nama }}</strong><div class="redup">{{ a.email }}</div></td><td>{{ a.no_hp_normal }}</td><td>{{ a.anak }}</td>
        <td><span class="lencana" :class="lencanaSt(a.status)">{{ a.status }}</span><div v-if="a.terkunci_tautan_sampai" class="redup">penautan terkunci s.d. {{ a.terkunci_tautan_sampai }}</div></td>
        <td style="white-space:nowrap"><button v-if="a.status==='belum_verifikasi'" class="kecil" @click="aksiAkun(a, 'verifikasi')">Verifikasi manual</button>
          <button v-if="a.status!=='nonaktif'" class="bahaya kecil" @click="aksiAkun(a, 'nonaktifkan')">Nonaktifkan</button>
          <button v-else class="kedua kecil" @click="aksiAkun(a, 'aktifkan')">Aktifkan</button>
          <button v-if="a.terkunci_tautan_sampai" class="kedua kecil" @click="aksiAkun(a, 'buka_kunci')">Buka kunci</button>
          <button class="bahaya kecil" @click="hapusAkunWali(a)">Hapus</button></td></tr></tbody></table>
      <p v-if="!pw.akun.length" class="redup" style="padding:14px">Tidak ada akun wali.</p></div>
    <h2>Tautan aktif</h2>
    <div class="baris"><label class="isian" style="flex:1 1 240px">Cari santri / wali<input v-model="pw.tq" placeholder="Ketik untuk menyaring"></label>
      <label class="isian">Cara<select v-model="pw.cara"><option value="">Semua</option><option value="otomatis">Otomatis</option><option value="manual">Manual</option></select></label></div>
    <div class="tabel"><table><thead><tr><th>Santri</th><th>Akun wali</th><th>Cara</th><th>Sejak (UTC)</th><th></th></tr></thead>
      <tbody v-baris><tr v-for="t in pw.tautan" :key="t.id">
        <td><strong>{{ t.santri }}</strong><div class="redup">{{ t.nis }} · {{ t.lingkungan }}</div></td><td>{{ t.wali }}<div class="redup">{{ t.email }}{{ t.hubungan ? ' · ' + t.hubungan : '' }}</div></td>
        <td>{{ t.cara }}<div v-if="t.oleh" class="redup">oleh {{ t.oleh }}</div></td><td class="redup">{{ t.dibuat_at }}</td>
        <td><button class="bahaya kecil" @click="cabut(t)">Cabut</button></td></tr></tbody></table>
      <p v-if="!pw.tautan.length" class="redup" style="padding:14px">Belum ada tautan.</p></div>
  </template>`,
};
daftarHalaman("/komunikasi", Komunikasi, {
  label: "Komunikasi", grup: "Fungsi", urutan: 75, syarat: (me) => me.role === "moderator" || me.bisa.pengumuman,
  ikon: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z"/><path d="M8 10h8"/><path d="M8 13h5"/>',
});
