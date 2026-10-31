// Modul tampilan komunikasi — pengumuman ke kelompok, email ke wali tertentu, antrean email, kelola Portal Wali.
const Komunikasi = {
  components: { Pesan, CariSantri, FotoSantri },
  directives: { baris: vBaris },
  setup() {
    const moderator = computed(() => negara.me && negara.me.role === "moderator");
    const m = computed(() => negara.master || {});
    const TAB = [["pengumuman", "Pengumuman"], ["wali", "Email ke wali"], ["antrean", "Antrean email"], ["portal", "Portal Wali"]];
    const tab = ref("pengumuman");
    const tabTampil = computed(() => TAB.filter((t) => moderator.value || t[0] === "pengumuman"));
    const f = reactive({ galat: "", ok: "" });
    const jalan = async (fn) => { f.galat = ""; f.ok = ""; try { await fn(); } catch (e) { f.galat = e.message; } };

    // ---- pengumuman
    const pg = reactive({ target: "semua_wali", kelas_id: "", kamar_id: "", subjek: "", isi: "", pratinjau: null, riwayat: [] });
    const dataPg = () => ({ target: pg.target, kelas_id: +pg.kelas_id || null, kamar_id: +pg.kamar_id || null, subjek: pg.subjek, isi: pg.isi });
    const muatRiwayatPg = async () => { pg.riwayat = await api("/komunikasi/pengumuman"); };
    const pratinjauPg = () => jalan(async () => { pg.pratinjau = await api("/komunikasi/pengumuman", dataPg()); });
    const kirimPg = () => jalan(async () => {
      if (!confirm(`Kirim pengumuman "${pg.subjek}" ke ${pg.pratinjau.jumlah} penerima?`)) return;
      const r = await api("/komunikasi/pengumuman", { ...dataPg(), konfirmasi: true });
      f.ok = `${r.jumlah} email masuk antrean.`; pg.pratinjau = null; pg.subjek = ""; pg.isi = ""; await muatRiwayatPg();
    });
    watch(() => [pg.target, pg.kelas_id, pg.kamar_id], () => { pg.pratinjau = null; });

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
      f.ok = r.belum_diatur ? "Pengirim email belum diatur — email tetap di antrean (lihat panduan di bawah)." : `Terkirim ${r.terkirim}, gagal ${r.gagal}${r.sisa ? ", sisa " + r.sisa : ""}.`;
      await muatAntrean();
    });

    // ---- Portal Wali (Moderator)
    const pw = reactive({ q: "", status: "", akun: [], tq: "", cara: "", tautan: [], santri: null, dataSantri: null, akunPilih: "", hp: {} });
    let tAk, tTt;
    const muatAkun = async () => { pw.akun = await api(`/komunikasi/akun-wali?q=${encodeURIComponent(pw.q)}&status=${pw.status}`); };
    const muatTautan = async () => { pw.tautan = await api(`/komunikasi/tautan?q=${encodeURIComponent(pw.tq)}&cara=${pw.cara}`); };
    watch(() => [pw.q, pw.status], () => { clearTimeout(tAk); tAk = setTimeout(() => jalan(muatAkun), 250); });
    watch(() => [pw.tq, pw.cara], () => { clearTimeout(tTt); tTt = setTimeout(() => jalan(muatTautan), 250); });
    const aksiAkun = (a, aksi) => jalan(async () => { await api(`/komunikasi/akun-wali/${a.id}`, { aksi }); f.ok = "Akun wali diperbarui."; await muatAkun(); });
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
    return { moderator, m, tab, tabTampil, f, pg, pratinjauPg, kirimPg, ew, kirimWali, an, ulang, ulangSemua, kirimSekarang,
      pw, aksiAkun, cabut, tautkan, simpanHp, lencanaSt, namaKelas };
  },
  template: `<div><span class="jejak">Fungsi › Komunikasi</span><h1>Komunikasi</h1></div>
  <div class="tab"><button v-for="t in tabTampil" :key="t[0]" :class="{aktif: tab===t[0]}" @click="tab=t[0]; f.ok=''; f.galat=''">{{ t[1] }}<span v-if="t[0]==='antrean' && an.hitung.gagal" class="lencana merah" style="margin-left:6px">{{ an.hitung.gagal }}</span></button></div>
  <Pesan :galat="f.galat" :ok="f.ok"/>

  <template v-if="tab==='pengumuman'">
    <div class="kartu" style="display:flex;flex-direction:column;gap:12px;max-width:820px">
      <h2>Pengumuman ke kelompok</h2>
      <div class="baris">
        <label class="isian">Sasaran<select v-model="pg.target"><option value="semua_wali">Semua wali</option><option value="wali_kelas">Wali per kelas</option><option value="wali_kamar">Wali per kamar</option><option value="pengurus">Semua pengurus</option></select></label>
        <label class="isian" v-if="pg.target==='wali_kelas'">Kelas<select v-model="pg.kelas_id"><option value="">Pilih kelas…</option><option v-for="k in (m.kelas || []).filter(k => k.aktif)" :value="k.id">{{ namaKelas(k) }} ({{ k.lingkungan }})</option></select></label>
        <label class="isian" v-if="pg.target==='wali_kamar'">Kamar<select v-model="pg.kamar_id"><option value="">Pilih kamar…</option><option v-for="k in (m.kamar || []).filter(k => k.aktif)" :value="k.id">{{ k.nama }}</option></select></label>
      </div>
      <p class="redup" style="margin:0">Wali = akun Portal Wali aktif yang tertaut ke santri aktif di lingkungan Anda. Pengurus = akun pengurus santri yang aktif. Setiap penerima hanya mendapat satu email.</p>
      <label class="isian">Subjek<input v-model="pg.subjek" maxlength="150"></label>
      <label class="isian">Isi<textarea v-model="pg.isi" rows="6" maxlength="4000"></textarea></label>
      <p class="redup" style="margin:0">Jangan menulis data sensitif (diagnosa, isi vonis) di email.</p>
      <div class="baris"><button class="kedua" @click="pratinjauPg">Pratinjau penerima</button>
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
    <details class="kartu" :open="an.konfig && !(an.konfig.gmail_refresh_token && an.konfig.gmail_pengirim)">
      <summary><strong>Panduan: mengirim email lewat Google Workspace pondok</strong></summary>
      <ol style="line-height:1.7;padding-left:18px">
        <li>Pilih akun pengirim di Google Workspace pondok (mis. <code>hisada@daarululuumlido.com</code>).</li>
        <li>Dengan klien OAuth yang sudah dipakai untuk login Google HISADA, buat <em>refresh token</em> untuk akun pengirim itu dengan cakupan <code>https://www.googleapis.com/auth/gmail.send</code> saja (mis. lewat OAuth 2.0 Playground: centang "Use your own OAuth credentials", masuk sebagai akun pengirim).</li>
        <li>Di dashboard Cloudflare → Workers → <strong>hisada</strong> → Settings → Variables and Secrets: tambahkan <strong>Secret</strong> <code>GMAIL_REFRESH_TOKEN</code> (isi refresh token) dan <strong>Variable</strong> <code>GMAIL_PENGIRIM</code> (alamat akun pengirim).</li>
        <li><strong>Jangan pernah menempelkan token atau secret di chat, email, atau dokumen.</strong> Ketik langsung di dashboard Cloudflare.</li>
        <li>Selama <strong>Mode Uji</strong> aktif (<code>email.mode_uji</code> = 1), semua email dialihkan ke <code>email.alamat_uji</code>. Isi alamat itu di Data Master → Pengaturan. Matikan Mode Uji (0) hanya di server produksi.</li>
        <li>Email dikirim otomatis tiap 5 menit (maks. 25 per putaran). Tombol <strong>Kirim sekarang</strong> menjalankan satu putaran segera.</li>
      </ol>
    </details>
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
          <button v-if="a.terkunci_tautan_sampai" class="kedua kecil" @click="aksiAkun(a, 'buka_kunci')">Buka kunci</button></td></tr></tbody></table>
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
