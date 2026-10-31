// Modul tampilan Update Data & Import — lihat src/modul/README.md dan README "Update Data & Import".
// Tab tampil sesuai akses: Moderator semua; akses update_kamar / paw / isi_pengurus hanya tabnya sendiri.
(() => {
  const coba = async (f, fn) => { f.galat = ""; f.ok = ""; f.sibuk = true; try { return await fn(); } catch (e) { f.galat = e.message; } finally { f.sibuk = false; } };
  const daftarNama = (xs, maks = 25) => xs.slice(0, maks).map((s) => s.nama).join(", ") + (xs.length > maks ? `, dan ${xs.length - maks} lainnya` : "");
  const cocokTeks = (s, q) => !q || q.length < 2 || (s.nama || "").toLowerCase().includes(q.toLowerCase()) || String(s.nis || "").startsWith(q);
  const tunda = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const bulanLalu = (tgl) => { if (!tgl) return ""; const d = (Date.now() - Date.parse(tgl)) / (30.44 * 864e5); return d < 1 ? "kurang dari sebulan lalu" : Math.floor(d) + " bulan lalu"; };

  // ------------------------------------------------------------ Update Kelas Tahunan
  const UDKelas = {
    components: { Pesan, FotoSantri, KonfirmasiSandi },
    directives: { baris: vBaris },
    props: ["info"], emits: ["ubah"],
    setup(props, { emit }) {
      const f = reactive({ ta: "", file: "", rows: [], p: null, lihat: "naik", q: "", tl: {}, tanya: false, hasil: null, galat: "", ok: "", sibuk: false });
      const taPersiapan = computed(() => (props.info.tahun_ajaran || []).filter((t) => t.status === "persiapan"));
      const taAktif = computed(() => (props.info.tahun_ajaran || []).find((t) => t.status === "aktif"));
      watch(taPersiapan, (v) => { if (!f.ta && v.length) f.ta = v[v.length - 1].id; }, { immediate: true });
      async function pilihFile(ev) {
        const file = ev.target.files[0]; if (!file) return;
        f.p = null; f.hasil = null; f.tl = {};
        await coba(f, async () => {
          const c = await bacaCsv(file, ["NIS", "KELAS"]);
          f.file = file.name; f.rows = c.baris.map((b) => ({ baris: b._baris, nis: b.NIS, kelas: b.KELAS }));
          await pratinjau();
        });
      }
      async function pratinjau() {
        await coba(f, async () => { f.p = await api("/updatedata/kelas-tahunan/pratinjau", { tahun_ajaran_id: +f.ta, rows: f.rows }); f.lihat = f.p.ditolak.length ? "ditolak" : "naik"; });
      }
      const tinggal = computed(() => f.p ? f.p.naik.filter((s) => s.tinggal) : []);
      const tidakLulus = computed(() => f.p ? f.p.alumni.filter((s) => f.tl[s.id]) : []);
      const daftar = computed(() => (f.p ? f.p[f.lihat] : []).filter((s) => cocokTeks(s, f.q)));
      const pesan = computed(() => {
        if (!f.p) return "";
        const naik = f.p.naik.length - tinggal.value.length;
        let t = `Update Kelas Tahunan ke ${f.p.tahun_ajaran.nama} — satu proses, tidak bisa diulang untuk tahun ajaran ini.\n\n`
          + `• ${naik} santri naik kelas\n• ${tinggal.value.length + tidakLulus.value.length} santri TIDAK naik kelas (tinggal kelas)\n`
          + `• ${f.p.alumni.length - tidakLulus.value.length} santri Kelas 6 menjadi Alumni (akun login nonaktif)\n• ${f.p.ditahan.length} santri ditahan (menunggu penempatan)\n`;
        if (taAktif.value) t += `• Tahun ajaran ${taAktif.value.nama} diarsipkan\n`;
        const tidakNaik = [...tinggal.value, ...tidakLulus.value, ...f.p.ditahan];
        if (tidakNaik.length) t += `\nSantri yang tidak naik kelas: ${daftarNama(tidakNaik)}.`;
        return t + "\n\nYakin?";
      });
      async function jalankan(pw) {
        f.tanya = false;
        await coba(f, async () => {
          f.hasil = await api("/updatedata/kelas-tahunan/jalankan", { tahun_ajaran_id: +f.ta, rows: f.rows, tidak_lulus: tidakLulus.value.map((s) => s.id), password: pw, nama_file: f.file });
          f.ok = `Selesai: ${f.hasil.naik} naik, ${f.hasil.tinggal_kelas} tinggal kelas, ${f.hasil.alumni} alumni, ${f.hasil.ditahan} menunggu penempatan.`;
          f.p = null; f.rows = []; emit("ubah"); muatMaster();
        });
      }
      const templat = () => unduhCsv("templat-penempatan-kelas.csv", [["NIS", "KELAS"], ["990101", "2 A"], ["990102", "5 B MIA"]]);
      return { f, taPersiapan, taAktif, pilihFile, pratinjau, tinggal, tidakLulus, daftar, pesan, jalankan, templat };
    },
    template: `<div class="kartu" style="display:flex;flex-direction:column;gap:12px">
      <h2>Update Kelas Tahunan</h2>
      <p class="redup" style="margin:0">Satu proses tahunan: Kelas 6 aktif menjadi Alumni, Kelas 1–5 naik sesuai file penempatan (NIS, KELAS), santri yang tidak tercantum ditahan (menunggu penempatan). Hanya sekali per tahun ajaran.</p>
      <div v-if="!taPersiapan.length" class="pesan info">Belum ada tahun ajaran berstatus <strong>persiapan</strong>. Buat dulu di <a href="#/data-master">Data Master › Tahun Ajaran</a> dan siapkan rombel.</div>
      <template v-else>
        <div class="baris">
          <label class="isian">Tahun ajaran tujuan<select v-model="f.ta"><option v-for="t in taPersiapan" :value="t.id">{{ t.nama }} (persiapan)</option></select></label>
          <label class="isian">File penempatan (CSV: NIS, KELAS)<input type="file" accept=".csv,text/csv" @change="pilihFile"></label>
          <button class="kedua" @click="templat">Unduh templat</button>
          <button v-if="f.rows.length" class="kedua" :disabled="f.sibuk" @click="pratinjau">Periksa ulang</button>
        </div>
        <span class="redup">Tahun ajaran aktif sekarang: {{ taAktif ? taAktif.nama : '—' }}. Penulisan "5B MIA" dibaca 5B.</span>
      </template>
    </div>
    <Pesan :galat="f.galat" :ok="f.ok"/>
    <template v-if="f.p">
      <div class="kisi">
        <div class="kartu stat"><div class="redup">Naik / tinggal</div><div class="angka">{{ f.p.naik.length }}</div><div class="redup">{{ tinggal.length }} tinggal kelas</div></div>
        <div class="kartu stat"><div class="redup">Menjadi alumni</div><div class="angka">{{ f.p.alumni.length - tidakLulus.length }}</div><div class="redup">{{ tidakLulus.length }} dikecualikan</div></div>
        <div class="kartu stat"><div class="redup">Ditahan</div><div class="angka" style="color:var(--kuning)">{{ f.p.ditahan.length }}</div></div>
        <div class="kartu stat"><div class="redup">Ditolak</div><div class="angka" style="color:var(--merah)">{{ f.p.ditolak.length }}</div></div>
      </div>
      <div v-if="f.p.ditolak.length" class="pesan galat">Ada {{ f.p.ditolak.length }} baris ditolak. Perbaiki file lalu unggah ulang — proses tidak bisa dijalankan.</div>
      <div class="tab"><button v-for="t in [['naik','Naik / Tinggal'],['alumni','Menjadi Alumni'],['ditahan','Ditahan'],['ditolak','Ditolak']]" :class="{aktif: f.lihat===t[0]}" @click="f.lihat=t[0]">{{ t[1] }} ({{ f.p[t[0]].length }})</button></div>
      <div class="baris"><input v-model="f.q" placeholder="Saring nama atau NIS (min. 2 huruf)" style="flex:1 1 260px"></div>
      <p v-if="f.lihat==='alumni'" class="redup" style="margin:0">Centang santri Kelas 6 yang <strong>tidak lulus</strong>: tetap Kelas 6 aktif di tahun ajaran baru.</p>
      <div class="tabel"><table>
        <thead><tr><th v-if="f.lihat==='ditolak'">Baris</th><th>Santri</th><th>Kelas sekarang</th><th v-if="f.lihat==='naik'">Kelas baru</th><th v-if="f.lihat==='ditolak'">Kelas di file</th><th>Keterangan</th></tr></thead>
        <tbody v-baris><tr v-for="s in daftar" :key="(s.id || '') + '-' + (s.baris || '')">
          <td v-if="f.lihat==='ditolak'">{{ s.baris }}</td>
          <td><div class="santri-sel"><FotoSantri v-if="s.id" :s="s"/><span><strong>{{ s.nama || '—' }}</strong><div class="redup">{{ s.nis }}</div></span></div></td>
          <td>{{ s.kelas_lama || '' }}</td>
          <td v-if="f.lihat==='naik'">{{ s.kelas_baru }}</td><td v-if="f.lihat==='ditolak'">{{ s.kelas }}</td>
          <td>
            <span v-if="f.lihat==='naik' && !s.tinggal" class="lencana hijau">Naik</span>
            <span v-if="f.lihat==='naik' && s.tinggal" class="lencana kuning">Santri atas nama {{ s.nama }} tidak dinyatakan naik kelas</span>
            <label v-if="f.lihat==='alumni'" style="display:flex;gap:8px;align-items:center"><input type="checkbox" v-model="f.tl[s.id]"><span class="lencana" :class="f.tl[s.id] ? 'kuning' : 'biru'">{{ f.tl[s.id] ? 'Tidak lulus — tetap Kelas 6' : 'Alumni' }}</span></label>
            <span v-if="f.lihat==='ditahan'" class="lencana kuning">Menunggu penempatan</span>
            <span v-if="f.lihat==='ditolak'" class="lencana merah">{{ s.alasan }}</span>
          </td></tr></tbody></table>
        <p v-if="!daftar.length" class="redup" style="padding:14px">Tidak ada santri di daftar ini.</p></div>
      <div><button class="bahaya" :disabled="f.sibuk || f.p.ditolak.length > 0" @click="f.tanya = true">Jalankan Update Kelas Tahunan…</button></div>
    </template>
    <KonfirmasiSandi v-if="f.tanya" judul="Update Kelas Tahunan" :pesan="pesan" @ok="jalankan" @batal="f.tanya=false"/>`,
  };

  // ------------------------------------------------------------ Menunggu penempatan
  const UDMenunggu = {
    components: { Pesan, FotoSantri },
    directives: { baris: vBaris },
    emits: ["ubah"],
    setup(_, { emit }) {
      const f = reactive({ daftar: [], q: "", pilih: {}, status: {}, galat: "", ok: "", sibuk: false });
      const kelasUntuk = (s) => ((negara.master || {}).kelas || []).filter((k) => k.aktif && k.lingkungan === s.lingkungan);
      const muat = () => coba(f, async () => { f.daftar = await api("/updatedata/menunggu"); });
      async function aksi(s, data, pesan) {
        await coba(f, async () => { await api("/updatedata/menunggu/" + s.id, data); await muat(); f.ok = pesan; emit("ubah"); });
      }
      const tempatkan = (s) => f.pilih[s.id] ? aksi(s, { aksi: "tempatkan", kelas_id: +f.pilih[s.id] }, s.nama + " ditempatkan.") : (f.galat = "Pilih kelas untuk " + s.nama + ".");
      const tinggal = (s) => confirm(`${s.nama} tinggal di kelas ${s.kelas}?`) && aksi(s, { aksi: "tinggal" }, s.nama + " tinggal kelas.");
      function ubahStatus(s) {
        const st = f.status[s.id]; if (!st) { f.galat = "Pilih status untuk " + s.nama + "."; return; }
        const alasan = prompt(`Ubah status ${s.nama} menjadi ${st}. Alasan?`); if (!alasan) return;
        aksi(s, { aksi: "status", status: st, alasan }, "Status " + s.nama + " diubah.");
      }
      const daftar = computed(() => f.daftar.filter((s) => cocokTeks(s, f.q)));
      onMounted(async () => { await muatMaster(); muat(); });
      return { f, daftar, kelasUntuk, tempatkan, tinggal, ubahStatus, namaKelas };
    },
    template: `<div class="kartu" style="display:flex;flex-direction:column;gap:10px">
      <h2>Menunggu penempatan</h2>
      <p class="redup" style="margin:0">Santri aktif yang tidak tercantum di file Update Kelas Tahunan. Masih tercatat di kelas lama; selesaikan satu per satu.</p>
      <input v-model="f.q" placeholder="Saring nama atau NIS (min. 2 huruf)">
    </div>
    <Pesan :galat="f.galat" :ok="f.ok"/>
    <div class="tabel"><table><thead><tr><th>Santri</th><th>Kelas lama</th><th>Tempatkan ke</th><th>Ubah status</th></tr></thead>
      <tbody v-baris><tr v-for="s in daftar" :key="s.id">
        <td><div class="santri-sel"><FotoSantri :s="s"/><span><strong>{{ s.nama }}</strong><div class="redup">{{ s.nis }} · {{ s.lingkungan }}</div></span></div></td>
        <td>{{ s.kelas || '—' }}</td>
        <td><div class="baris"><select v-model="f.pilih[s.id]"><option :value="undefined">Pilih kelas…</option><option v-for="k in kelasUntuk(s)" :value="k.id">{{ namaKelas(k) }}</option></select>
          <button class="kecil" :disabled="f.sibuk" @click="tempatkan(s)">Tempatkan</button><button v-if="s.kelas_id" class="kedua kecil" :disabled="f.sibuk" @click="tinggal(s)">Tinggal kelas</button></div></td>
        <td><div class="baris"><select v-model="f.status[s.id]"><option :value="undefined">Status…</option><option value="alumni">alumni</option><option value="mutasi_keluar">mutasi keluar</option><option value="meninggal">meninggal</option></select>
          <button class="bahaya kecil" :disabled="f.sibuk" @click="ubahStatus(s)">Ubah</button></div></td>
      </tr></tbody></table>
      <p v-if="!daftar.length" class="redup" style="padding:14px">Tidak ada santri yang menunggu penempatan.</p></div>`,
  };

  // ------------------------------------------------------------ Batal Alumni
  const UDAlumni = {
    components: { Pesan, FotoSantri },
    setup() {
      const f = reactive({ q: "", hasil: [], s: null, alasan: "", galat: "", ok: "", sibuk: false });
      const cari = tunda(async (v) => { try { f.hasil = await api("/santri?status=alumni&limit=5&q=" + encodeURIComponent(v)); } catch (e) { f.galat = e.message; } });
      watch(() => f.q, (v) => { if (v.length < 2) { f.hasil = []; return; } cari(v); });
      const ambil = (s) => { f.s = s; f.q = ""; f.hasil = []; f.ok = ""; };
      async function batalkan() {
        if (!confirm(`Batalkan status Alumni ${f.s.nama}? Santri kembali aktif di kelas terakhirnya; akun login tetap nonaktif.`)) return;
        await coba(f, async () => { await api("/updatedata/batal-alumni", { santri_id: f.s.id, alasan: f.alasan }); f.ok = `Status Alumni ${f.s.nama} dibatalkan. Akun login tetap nonaktif sampai diaktifkan di Pengguna.`; f.s = null; f.alasan = ""; });
      }
      return { f, ambil, batalkan };
    },
    template: `<div class="kartu" style="display:flex;flex-direction:column;gap:12px;max-width:720px">
      <h2>Batalkan status Alumni</h2>
      <p class="redup" style="margin:0">Per santri, alasan wajib. Santri kembali aktif di kelas terakhirnya (riwayat kelas dibuka lagi); akun login tetap nonaktif sampai diaktifkan Moderator.</p>
      <div v-if="f.s" class="baris" style="align-items:center"><div class="santri-sel"><FotoSantri :s="f.s"/><span><strong>{{ f.s.nama }}</strong><div class="redup">{{ f.s.nis }} · {{ f.s.kelas }} · alumni</div></span></div><button class="kedua kecil" @click="f.s=null">Ganti</button></div>
      <div v-else style="position:relative">
        <input v-model="f.q" placeholder="Cari alumni: nama atau NIS (min. 2 huruf)" style="width:100%">
        <div v-if="f.hasil.length" class="kartu saran"><button v-for="s in f.hasil" type="button" @click="ambil(s)"><span class="santri-sel"><FotoSantri :s="s" ukuran="kecil"/><span><strong>{{ s.nama }}</strong> <span class="redup">{{ s.nis }} · {{ s.kelas }}</span></span></span></button></div>
      </div>
      <label class="isian">Alasan (wajib)<input v-model="f.alasan" maxlength="200"></label>
      <div><button class="bahaya" :disabled="!f.s || !f.alasan || f.sibuk" @click="batalkan">Batalkan Alumni</button></div>
      <Pesan :galat="f.galat" :ok="f.ok"/>
    </div>`,
  };

  // ------------------------------------------------------------ Update Kamar
  const UDKamar = {
    components: { Pesan, FotoSantri, KonfirmasiSandi },
    directives: { baris: vBaris },
    setup() {
      const f = reactive({ cara: "pilih", file: "", rows: [], p: null, tanya: false, kamar_id: "", kelas_id: "", q: "", santri: [], centang: {}, tujuan: "", galat: "", ok: "", sibuk: false });
      const m = computed(() => negara.master || {});
      const kamarAktif = computed(() => (m.value.kamar || []).filter((k) => k.aktif));
      async function muatSantri() {
        const q = new URLSearchParams({ limit: "2000" });
        if (f.kamar_id) q.set("kamar_id", f.kamar_id); if (f.kelas_id) q.set("kelas_id", f.kelas_id);
        await coba(f, async () => { f.santri = await api("/santri?" + q); f.centang = {}; });
      }
      watch(() => [f.kamar_id, f.kelas_id], muatSantri);
      const tampil = computed(() => f.santri.filter((s) => cocokTeks(s, f.q)));
      const terpilih = computed(() => f.santri.filter((s) => f.centang[s.id]));
      const semua = (v) => tampil.value.forEach((s) => { f.centang[s.id] = v; });
      const tujuanNama = computed(() => (kamarAktif.value.find((k) => k.id == f.tujuan) || {}).nama || "");
      async function pratinjau() {
        await coba(f, async () => { f.p = await api("/updatedata/kamar/pratinjau", { rows: f.rows }); });
      }
      function dariPilihan() {
        if (!f.tujuan) { f.galat = "Pilih kamar tujuan."; return; }
        f.file = ""; f.rows = terpilih.value.map((s, i) => ({ baris: i + 1, nis: s.nis, kamar: tujuanNama.value })); pratinjau();
      }
      async function pilihFile(ev) {
        const file = ev.target.files[0]; if (!file) return; f.p = null;
        await coba(f, async () => { const c = await bacaCsv(file, ["NIS", "KAMAR"]); f.file = file.name; f.rows = c.baris.map((b) => ({ baris: b._baris, nis: b.NIS, kamar: b.KAMAR })); });
        if (f.rows.length) pratinjau();
      }
      const pesan = computed(() => f.p ? `Update Kamar: ${f.p.pindah.length} santri pindah kamar (${f.p.tetap.length} sudah di kamar tujuan, dilewati).\n\n${daftarNama(f.p.pindah)}\n\nSetiap perpindahan tercatat di riwayat kamar. Yakin?` : "");
      async function jalankan(pw) {
        f.tanya = false;
        await coba(f, async () => { const r = await api("/updatedata/kamar/jalankan", { rows: f.rows, password: pw, nama_file: f.file || null }); f.ok = `${r.pindah} santri dipindah kamar.`; f.p = null; f.rows = []; await muatMaster(); muatSantri(); });
      }
      const templat = () => unduhCsv("templat-update-kamar.csv", [["NIS", "KAMAR"], ["990101", "Ibnu Rusyd-01"]]);
      onMounted(async () => { await muatMaster(); muatSantri(); });
      return { f, m, kamarAktif, tampil, terpilih, semua, tujuanNama, dariPilihan, pilihFile, pratinjau, pesan, jalankan, templat, namaKelas };
    },
    template: `<div class="kartu" style="display:flex;flex-direction:column;gap:12px">
      <h2>Update Kamar</h2>
      <p class="redup" style="margin:0">Rotasi kamar (1–2 kali setahun). Santri hanya bisa ditempatkan di kamar yang sesuai gender. Pratinjau → peringatan + password → satu proses.</p>
      <div class="tab"><button :class="{aktif: f.cara==='pilih'}" @click="f.cara='pilih'; f.p=null">Pilih banyak santri</button><button :class="{aktif: f.cara==='file'}" @click="f.cara='file'; f.p=null">Upload file</button></div>
      <template v-if="f.cara==='file'">
        <div class="baris"><label class="isian">File CSV (NIS, KAMAR — nama kamar persis, mis. Ibnu Rusyd-01)<input type="file" accept=".csv,text/csv" @change="pilihFile"></label><button class="kedua" @click="templat">Unduh templat</button></div>
      </template>
      <template v-else>
        <div class="baris">
          <label class="isian">Kamar sekarang<select v-model="f.kamar_id"><option value="">Semua kamar</option><option v-for="k in m.kamar" :value="k.id">{{ k.nama }} ({{ k.jumlah }})</option></select></label>
          <label class="isian">Kelas<select v-model="f.kelas_id"><option value="">Semua kelas</option><option v-for="k in m.kelas" :value="k.id">{{ namaKelas(k) }} · {{ k.lingkungan }}</option></select></label>
          <label class="isian" style="flex:1 1 220px">Saring<input v-model="f.q" placeholder="Nama atau NIS (min. 2 huruf)"></label>
        </div>
        <div class="baris" style="align-items:flex-end">
          <label class="isian">Pindahkan ke kamar<select v-model="f.tujuan"><option value="">Pilih kamar…</option><option v-for="k in kamarAktif" :value="k.id">{{ k.nama }} ({{ k.lingkungan }}, {{ k.jumlah }})</option></select></label>
          <button :disabled="!terpilih.length || !f.tujuan || f.sibuk" @click="dariPilihan">Pindahkan {{ terpilih.length }} santri ke {{ tujuanNama || 'Kamar …' }}</button>
          <button class="kedua kecil" @click="semua(true)">Centang semua yang tampil</button><button class="kedua kecil" @click="semua(false)">Kosongkan</button>
        </div>
      </template>
    </div>
    <Pesan :galat="f.galat" :ok="f.ok"/>
    <div v-if="f.cara==='pilih' && !f.p" class="tabel"><table><thead><tr><th></th><th>Santri</th><th>Kelas</th><th>Kamar</th></tr></thead>
      <tbody v-baris><tr v-for="s in tampil" :key="s.id"><td><input type="checkbox" v-model="f.centang[s.id]" :aria-label="'Pilih ' + s.nama"></td>
        <td><div class="santri-sel"><FotoSantri :s="s"/><span><strong>{{ s.nama }}</strong><div class="redup">{{ s.nis }} · {{ s.lingkungan }}</div></span></div></td><td>{{ s.kelas }}</td><td>{{ s.kamar || '—' }}</td></tr></tbody></table>
      <p v-if="!tampil.length" class="redup" style="padding:14px">Tidak ada santri.</p></div>
    <template v-if="f.p">
      <div class="kisi">
        <div class="kartu stat"><div class="redup">Pindah</div><div class="angka">{{ f.p.pindah.length }}</div></div>
        <div class="kartu stat"><div class="redup">Sudah di kamar tujuan</div><div class="angka">{{ f.p.tetap.length }}</div></div>
        <div class="kartu stat"><div class="redup">Ditolak</div><div class="angka" style="color:var(--merah)">{{ f.p.ditolak.length }}</div></div>
      </div>
      <div v-if="f.p.ditolak.length" class="pesan galat">Ada baris ditolak — perbaiki dulu, proses tidak bisa dijalankan.</div>
      <div class="tabel"><table><thead><tr><th>Baris</th><th>Santri</th><th>Kamar lama</th><th>Kamar baru</th><th>Keterangan</th></tr></thead>
        <tbody v-baris>
          <tr v-for="s in f.p.ditolak" :key="'t' + s.baris"><td>{{ s.baris }}</td><td><strong>{{ s.nama || '—' }}</strong><div class="redup">{{ s.nis }}</div></td><td></td><td>{{ s.kamar }}</td><td><span class="lencana merah">{{ s.alasan }}</span></td></tr>
          <tr v-for="s in f.p.pindah" :key="'p' + s.baris"><td>{{ s.baris }}</td><td><div class="santri-sel"><FotoSantri :s="s"/><span><strong>{{ s.nama }}</strong><div class="redup">{{ s.nis }}</div></span></div></td><td>{{ s.kamar_lama || '—' }}</td><td>{{ s.kamar_baru }}</td><td><span class="lencana hijau">Pindah</span></td></tr>
          <tr v-for="s in f.p.tetap" :key="'s' + s.baris"><td>{{ s.baris }}</td><td><strong>{{ s.nama }}</strong><div class="redup">{{ s.nis }}</div></td><td>{{ s.kamar_lama }}</td><td>{{ s.kamar_baru }}</td><td><span class="lencana">Sudah di kamar ini</span></td></tr>
        </tbody></table></div>
      <div class="baris"><button class="bahaya" :disabled="f.sibuk || f.p.ditolak.length > 0 || !f.p.pindah.length" @click="f.tanya=true">Jalankan Update Kamar…</button><button class="kedua" @click="f.p=null">Batal</button></div>
    </template>
    <KonfirmasiSandi v-if="f.tanya" judul="Update Kamar" :pesan="pesan" @ok="jalankan" @batal="f.tanya=false"/>`,
  };

  // ------------------------------------------------------------ Masa Khidmat & Serah Terima
  const UDSerah = {
    components: { Pesan, CariSantri, KonfirmasiSandi },
    props: ["info"], emits: ["ubah"],
    setup(props, { emit }) {
      const f = reactive({ nama: "", s1: null, s2: null, tanya: false, galat: "", ok: "", sibuk: false });
      const sek = computed(() => [f.s1, f.s2].filter(Boolean));
      const pesan = computed(() => `Serah Terima Jabatan (putra & putri sekaligus).\n\n• Masa khidmat "${props.info.masa_khidmat ? props.info.masa_khidmat.nama : '—'}" dan ${props.info.jumlah_pengurus} jabatan diarsipkan; akun pengurus lama dinonaktifkan (santrinya tetap aktif).\n`
        + `• Serah Terima terakhir: ${props.info.serah_terima_terakhir || '—'} (${bulanLalu(props.info.serah_terima_terakhir)}).\n• Masa khidmat baru: ${f.nama}\n• Sekretaris baru: ${sek.value.map((s) => s.nama).join(", ")}\n\nYakin?`);
      async function buatPertama() {
        await coba(f, async () => { await api("/updatedata/masa-khidmat", { nama: f.nama }); f.ok = "Masa khidmat dibuat."; f.nama = ""; emit("ubah"); });
      }
      async function jalankan(pw) {
        f.tanya = false;
        await coba(f, async () => {
          const r = await api("/updatedata/serah-terima", { nama: f.nama, sekretaris: sek.value.map((s) => s.id), password: pw });
          f.ok = `Serah Terima selesai: ${r.pengurus_lama} jabatan lama diarsipkan. Sekretaris baru: ${r.sekretaris.map((s) => s.nama + (s.status === 'tertahan' ? ' (akun TERTAHAN: tanggal lahir kosong)' : '')).join(", ")}. Password sementara: NIS + tanggal lahir.`;
          f.nama = ""; f.s1 = null; f.s2 = null; emit("ubah");
        });
      }
      return { f, sek, pesan, buatPertama, jalankan, bulanLalu };
    },
    template: `<div class="dua-kolom">
      <div class="kartu" style="display:flex;flex-direction:column;gap:10px">
        <h2>Masa khidmat</h2>
        <template v-if="info.masa_khidmat"><div><strong>{{ info.masa_khidmat.nama }}</strong> <span class="lencana hijau">aktif</span></div>
          <span class="redup">Mulai {{ info.masa_khidmat.mulai }} ({{ bulanLalu(info.masa_khidmat.mulai) }}) · {{ info.jumlah_pengurus }} pengurus aktif</span></template>
        <p v-else class="redup" style="margin:0">Belum ada masa khidmat aktif.</p>
        <div class="tabel" v-if="info.masa_list.length"><table><thead><tr><th>Masa khidmat</th><th>Mulai</th><th>Selesai</th><th>Status</th></tr></thead>
          <tbody><tr v-for="m in info.masa_list" :key="m.id"><td>{{ m.nama }}</td><td>{{ m.mulai }}</td><td>{{ m.selesai || '—' }}</td><td><span class="lencana" :class="{hijau: m.status==='aktif'}">{{ m.status }}</span></td></tr></tbody></table></div>
      </div>
      <div class="kartu" style="display:flex;flex-direction:column;gap:10px">
        <template v-if="!info.masa_khidmat && !info.masa_list.length">
          <h2>Buat masa khidmat pertama</h2>
          <label class="isian">Nama masa khidmat<input v-model="f.nama" placeholder="mis. 2026/2027"></label>
          <div><button :disabled="!f.nama || f.sibuk" @click="buatPertama">Buat</button></div>
          <p class="redup" style="margin:0">Setelah itu isi pengurus di tab Isi Bagian Pengurus.</p>
        </template>
        <template v-else>
          <h2>Serah Terima Jabatan</h2>
          <p class="redup" style="margin:0">Satu tombol untuk putra dan putri. Tunjuk 1–2 Sekretaris baru (santri aktif Kelas 5); Sekretaris baru lalu mengisi bagian pengurus lain.</p>
          <label class="isian">Nama masa khidmat baru<input v-model="f.nama" placeholder="mis. 2027/2028"></label>
          <label class="isian">Sekretaris baru 1<CariSantri v-model="f.s1"/></label>
          <label class="isian">Sekretaris baru 2 (opsional)<CariSantri v-model="f.s2"/></label>
          <div><button class="bahaya" :disabled="!f.nama || !sek.length || f.sibuk" @click="f.tanya=true">Serah Terima Jabatan…</button></div>
        </template>
        <Pesan :galat="f.galat" :ok="f.ok"/>
      </div>
    </div>
    <KonfirmasiSandi v-if="f.tanya" judul="Serah Terima Jabatan" :pesan="pesan" @ok="jalankan" @batal="f.tanya=false"/>`,
  };

  // ------------------------------------------------------------ Isi Bagian Pengurus (+ master jabatan untuk Moderator)
  const UDPengurus = {
    components: { Pesan, FotoSantri },
    directives: { baris: vBaris },
    props: ["info"], emits: ["ubah"],
    setup(props, { emit }) {
      const f = reactive({ cara: "pilih", pengurus: [], jabatan: [], santri: [], kelas_id: "", q: "", qp: "", centang: {}, jab: "", rows: [], p: null, baru: "", ling: "semua", galat: "", ok: "", sibuk: false });
      const moderator = computed(() => negara.me.role === "moderator");
      const kelas5 = computed(() => ((negara.master || {}).kelas || []).filter((k) => k.tingkat === 5));
      const muat = () => coba(f, async () => { const r = await api("/updatedata/pengurus"); f.pengurus = r.pengurus; f.jabatan = r.jabatan; });
      const muatSantri = () => coba(f, async () => {
        const id5 = new Set(kelas5.value.map((k) => k.id));
        f.santri = (await api("/santri?limit=2000" + (f.kelas_id ? "&kelas_id=" + f.kelas_id : ""))).filter((s) => id5.has(s.kelas_id)); f.centang = {};
      });
      watch(() => f.kelas_id, muatSantri);
      const pemegang = computed(() => new Set(f.pengurus.map((p) => p.santri_id)));
      const tampil = computed(() => f.santri.filter((s) => !pemegang.value.has(s.id) && cocokTeks(s, f.q)));
      const terpilih = computed(() => f.santri.filter((s) => f.centang[s.id]));
      const jabatanAktif = computed(() => f.jabatan.filter((j) => j.aktif));
      const pengurusTampil = computed(() => f.pengurus.filter((p) => cocokTeks(p, f.qp) || (f.qp.length > 1 && p.jabatan.toLowerCase().includes(f.qp.toLowerCase()))));
      const pratinjau = () => coba(f, async () => { f.p = await api("/updatedata/pengurus/pratinjau", { rows: f.rows }); });
      function dariPilihan() {
        const j = f.jabatan.find((x) => x.id == f.jab); if (!j) { f.galat = "Pilih jabatan."; return; }
        f.rows = terpilih.value.map((s, i) => ({ baris: i + 1, nis: s.nis, jabatan: j.nama })); pratinjau();
      }
      async function pilihFile(ev) {
        const file = ev.target.files[0]; if (!file) return; f.p = null;
        await coba(f, async () => { const c = await bacaCsv(file, ["NIS", "JABATAN"]); f.rows = c.baris.map((b) => ({ baris: b._baris, nis: b.NIS, jabatan: b.JABATAN })); });
        if (f.rows.length) pratinjau();
      }
      async function simpan() {
        await coba(f, async () => { const r = await api("/updatedata/pengurus", { rows: f.rows }); f.ok = `${r.jumlah} pengurus diisi; akun dibuat/diaktifkan (menunggu role dari Moderator)${r.tertahan ? `, ${r.tertahan} akun tertahan (tanggal lahir kosong)` : ""}.`; f.p = null; f.rows = []; await muat(); muatSantri(); emit("ubah"); });
      }
      const tambahJabatan = () => coba(f, async () => { await api("/updatedata/jabatan", { nama: f.baru, lingkungan: f.ling }); f.baru = ""; await muat(); });
      const ubahJabatan = (j) => coba(f, async () => { await api("/updatedata/jabatan", { id: j.id, aktif: j.aktif ? 0 : 1 }); await muat(); });
      const templat = () => unduhCsv("templat-pengurus.csv", [["NIS", "JABATAN"], ["990101", "Bagian Keamanan"]]);
      const lencanaAkun = (p) => p.user_status === "aktif" ? "hijau" : p.user_status === "tertahan" ? "kuning" : "merah";
      onMounted(async () => { await muatMaster(); await muat(); muatSantri(); });
      return { f, moderator, kelas5, tampil, terpilih, jabatanAktif, pengurusTampil, dariPilihan, pilihFile, simpan, tambahJabatan, ubahJabatan, templat, lencanaAkun, namaKelas, LABEL_ROLE };
    },
    template: `<div v-if="!info.masa_khidmat" class="pesan info">Belum ada masa khidmat aktif. Moderator membuatnya di tab Masa Khidmat & Serah Terima.</div>
    <div class="kartu" style="display:flex;flex-direction:column;gap:12px">
      <h2>Isi bagian pengurus</h2>
      <p class="redup" style="margin:0">Hanya santri aktif Kelas 5 di lingkungan Anda. Satu baris tidak valid → seluruh kiriman ditolak. Akun NIS@daarululuumlido.com dibuat otomatis (password sementara NIS + tanggal lahir), role ditetapkan Moderator.</p>
      <div class="tab"><button :class="{aktif: f.cara==='pilih'}" @click="f.cara='pilih'; f.p=null">Pilih banyak</button><button :class="{aktif: f.cara==='file'}" @click="f.cara='file'; f.p=null">Upload file</button></div>
      <div v-if="f.cara==='file'" class="baris"><label class="isian">File CSV (NIS, JABATAN)<input type="file" accept=".csv,text/csv" @change="pilihFile"></label><button class="kedua" @click="templat">Unduh templat</button></div>
      <template v-else>
        <div class="baris">
          <label class="isian">Kelas 5<select v-model="f.kelas_id"><option value="">Semua rombel Kelas 5</option><option v-for="k in kelas5" :value="k.id">{{ namaKelas(k) }} · {{ k.lingkungan }}</option></select></label>
          <label class="isian" style="flex:1 1 220px">Saring<input v-model="f.q" placeholder="Nama atau NIS (min. 2 huruf)"></label>
          <label class="isian">Jabatan<select v-model="f.jab"><option value="">Pilih jabatan…</option><option v-for="j in jabatanAktif" :value="j.id">{{ j.nama }}{{ j.lingkungan !== 'semua' ? ' (' + j.lingkungan + ')' : '' }}</option></select></label>
          <button :disabled="!terpilih.length || !f.jab || f.sibuk" @click="dariPilihan">Periksa {{ terpilih.length }} santri</button>
        </div>
        <div v-if="!f.p" class="tabel" style="max-height:360px;overflow:auto"><table><thead><tr><th></th><th>Santri (Kelas 5, belum menjabat)</th><th>Kelas</th></tr></thead>
          <tbody><tr v-for="s in tampil" :key="s.id"><td><input type="checkbox" v-model="f.centang[s.id]" :aria-label="'Pilih ' + s.nama"></td>
            <td><div class="santri-sel"><FotoSantri :s="s"/><span><strong>{{ s.nama }}</strong><div class="redup">{{ s.nis }} · {{ s.lingkungan }}</div></span></div></td><td>{{ s.kelas }}</td></tr></tbody></table>
          <p v-if="!tampil.length" class="redup" style="padding:14px">Tidak ada santri Kelas 5 yang belum menjabat.</p></div>
      </template>
    </div>
    <Pesan :galat="f.galat" :ok="f.ok"/>
    <template v-if="f.p">
      <div v-if="f.p.ditolak.length" class="pesan galat">{{ f.p.ditolak.length }} baris tidak valid — seluruh kiriman ditolak. Perbaiki lalu periksa ulang.</div>
      <div class="tabel"><table><thead><tr><th>Baris</th><th>Santri</th><th>Jabatan</th><th>Keterangan</th></tr></thead>
        <tbody v-baris>
          <tr v-for="s in f.p.ditolak" :key="'t' + s.baris"><td>{{ s.baris }}</td><td><strong>{{ s.nama || '—' }}</strong><div class="redup">{{ s.nis }}</div></td><td>{{ s.jabatan }}</td><td><span class="lencana merah">{{ s.alasan }}</span></td></tr>
          <tr v-for="s in f.p.siap" :key="'s' + s.baris"><td>{{ s.baris }}</td><td><div class="santri-sel"><FotoSantri :s="s"/><span><strong>{{ s.nama }}</strong><div class="redup">{{ s.nis }}</div></span></div></td><td>{{ s.jabatan }}</td>
            <td><span class="lencana" :class="s.tertahan ? 'kuning' : 'hijau'">{{ s.tertahan ? 'Akun tertahan (tanggal lahir kosong)' : s.akun === 'baru' ? 'Akun baru' : 'Akun diaktifkan lagi' }}</span></td></tr>
        </tbody></table></div>
      <div class="baris"><button :disabled="f.sibuk || f.p.ditolak.length > 0" @click="simpan">Simpan {{ f.p.siap.length }} pengurus</button><button class="kedua" @click="f.p=null">Batal</button></div>
    </template>
    <div class="kartu" style="display:flex;flex-direction:column;gap:10px">
      <div class="baris" style="justify-content:space-between;align-items:center"><h2>Pengurus {{ info.masa_khidmat ? info.masa_khidmat.nama : '' }} ({{ f.pengurus.length }})</h2><input v-model="f.qp" placeholder="Saring nama, NIS, jabatan" style="flex:0 1 260px"></div>
      <div class="tabel"><table><thead><tr><th>Santri</th><th>Jabatan</th><th>Lingkungan</th><th>Akun</th><th>Role</th></tr></thead>
        <tbody v-baris><tr v-for="p in pengurusTampil" :key="p.id">
          <td><div class="santri-sel"><FotoSantri :s="p"/><span><strong>{{ p.nama }}</strong><div class="redup">{{ p.nis }} · Kelas {{ p.tingkat }}</div></span></div></td>
          <td>{{ p.jabatan }}</td><td>{{ p.lingkungan }}</td>
          <td><span class="lencana" :class="lencanaAkun(p)">{{ p.user_status || 'belum ada' }}</span></td>
          <td><span class="lencana" :class="{kuning: !p.role}">{{ p.role ? LABEL_ROLE[p.role] : 'Menunggu role' }}</span></td></tr></tbody></table>
        <p v-if="!pengurusTampil.length" class="redup" style="padding:14px">Belum ada pengurus.</p></div>
    </div>
    <div v-if="moderator" class="kartu" style="display:flex;flex-direction:column;gap:10px">
      <h2>Daftar jabatan</h2>
      <div class="baris"><label class="isian" style="flex:2 1 200px">Jabatan baru<input v-model="f.baru" @keyup.enter="tambahJabatan"></label>
        <label class="isian">Lingkungan<select v-model="f.ling"><option>semua</option><option>putra</option><option>putri</option></select></label><button :disabled="!f.baru" @click="tambahJabatan">Tambah</button></div>
      <div class="tabel"><table><thead><tr><th>Jabatan</th><th>Lingkungan</th><th>Status</th></tr></thead>
        <tbody><tr v-for="j in f.jabatan" :key="j.id"><td><strong>{{ j.nama }}</strong></td><td>{{ j.lingkungan }}</td>
          <td><button class="kecil" :class="j.aktif ? '' : 'kedua'" @click="ubahJabatan(j)">{{ j.aktif ? 'Aktif' : 'Nonaktif' }}</button></td></tr></tbody></table></div>
      <p class="redup">Jabatan yang sudah dipakai tidak dihapus — cukup dinonaktifkan.</p>
    </div>`,
  };

  // ------------------------------------------------------------ PAW
  const UDPaw = {
    components: { Pesan, FotoSantri, CariSantri, KonfirmasiSandi },
    directives: { baris: vBaris },
    emits: ["ubah"],
    setup(_, { emit }) {
      const f = reactive({ pengurus: [], q: "", sel: null, alasan: "", ganti: null, role: "", tanya: false, galat: "", ok: "", sibuk: false });
      const moderator = computed(() => negara.me.role === "moderator");
      const muat = () => coba(f, async () => { f.pengurus = (await api("/updatedata/pengurus")).pengurus; });
      const tampil = computed(() => f.pengurus.filter((p) => cocokTeks(p, f.q) || (f.q.length > 1 && p.jabatan.toLowerCase().includes(f.q.toLowerCase()))));
      const pesan = computed(() => f.sel ? `PAW ${f.sel.jabatan} (${f.sel.lingkungan}):\n\n• ${f.sel.nama} (${f.sel.nis}) dinonaktifkan dari jabatan; akun loginnya nonaktif.\n• Alasan: ${f.alasan}\n`
        + (f.ganti ? `• Pengganti: ${f.ganti.nama} (${f.ganti.nis})${f.role ? ", role " + LABEL_ROLE[f.role] : ", menunggu role"}.\n` : "• Belum ada pengganti (jabatan kosong).\n") + "\nYakin?" : "");
      async function jalankan(pw) {
        f.tanya = false;
        await coba(f, async () => {
          const r = await api("/updatedata/paw", { pengurus_id: f.sel.id, alasan: f.alasan, santri_id: f.ganti ? f.ganti.id : null, role: f.role || null, password: pw });
          f.ok = "PAW selesai." + (r.pengganti ? ` Pengganti ${r.pengganti.nama}: akun ${r.pengganti.status}${r.pengganti.status === 'tertahan' ? ' (tanggal lahir kosong)' : ' — password sementara NIS + tanggal lahir'}.` : "");
          f.sel = null; f.alasan = ""; f.ganti = null; f.role = ""; await muat(); emit("ubah");
        });
      }
      onMounted(muat);
      return { f, moderator, tampil, pesan, jalankan, LABEL_ROLE };
    },
    template: `<div class="dua-kolom">
      <div class="kartu" style="display:flex;flex-direction:column;gap:10px">
        <h2>Pilih jabatan yang diganti</h2>
        <input v-model="f.q" placeholder="Saring nama, NIS, jabatan (min. 2 huruf)">
        <div class="tabel" style="max-height:420px;overflow:auto"><table><thead><tr><th>Pengurus</th><th>Jabatan</th><th></th></tr></thead>
          <tbody v-baris><tr v-for="p in tampil" :key="p.id" :style="{background: f.sel && f.sel.id===p.id ? '#EEF5F1' : ''}">
            <td><div class="santri-sel"><FotoSantri :s="p"/><span><strong>{{ p.nama }}</strong><div class="redup">{{ p.nis }} · {{ p.lingkungan }}</div></span></div></td>
            <td>{{ p.jabatan }}</td><td><button class="kedua kecil" @click="f.sel = p">Pilih</button></td></tr></tbody></table>
          <p v-if="!tampil.length" class="redup" style="padding:14px">Tidak ada pengurus aktif.</p></div>
      </div>
      <div class="kartu" style="display:flex;flex-direction:column;gap:10px">
        <h2>Pergantian Antar-Waktu</h2>
        <p class="redup" style="margin:0">Mengganti satu pengurus di tengah masa khidmat (mis. mundur, skorsing). Pengganti: santri aktif Kelas 5/6 dari lingkungan yang sama.</p>
        <p v-if="!f.sel" class="redup">Pilih jabatan di daftar.</p>
        <template v-else>
          <div><strong>{{ f.sel.jabatan }}</strong> — {{ f.sel.nama }} ({{ f.sel.nis }})</div>
          <label class="isian">Alasan (wajib)<input v-model="f.alasan" maxlength="200"></label>
          <label class="isian">Pengganti (kosongkan bila belum ada)<CariSantri v-model="f.ganti"/></label>
          <label v-if="moderator" class="isian">Role pengganti<select v-model="f.role"><option value="">Menunggu role</option><option v-for="r in ['piket','kesehatan','kedisiplinan','sekretaris']" :value="r">{{ LABEL_ROLE[r] }}</option></select></label>
          <div><button class="bahaya" :disabled="!f.alasan || f.sibuk" @click="f.tanya=true">Jalankan PAW…</button></div>
        </template>
        <Pesan :galat="f.galat" :ok="f.ok"/>
      </div>
    </div>
    <KonfirmasiSandi v-if="f.tanya" judul="Pergantian Antar-Waktu" :pesan="pesan" @ok="jalankan" @batal="f.tanya=false"/>`,
  };

  // ------------------------------------------------------------ Akun tertahan
  const UDTertahan = {
    components: { Pesan, FotoSantri },
    directives: { baris: vBaris },
    emits: ["ubah"],
    setup(_, { emit }) {
      const f = reactive({ daftar: [], q: "", galat: "", ok: "", sibuk: false });
      const muat = () => coba(f, async () => { f.daftar = await api("/updatedata/akun-tertahan"); });
      const tampil = computed(() => f.daftar.filter((s) => cocokTeks(s, f.q)));
      const siap = computed(() => f.daftar.filter((s) => s.tanggal_lahir).length);
      const aktifkan = () => coba(f, async () => { const r = await api("/updatedata/akun-tertahan/aktifkan", {}); f.ok = `${r.jumlah} akun diaktifkan (password sementara NIS + tanggal lahir).`; await muat(); emit("ubah"); });
      onMounted(muat);
      return { f, tampil, siap, aktifkan };
    },
    template: `<div class="kartu" style="display:flex;flex-direction:column;gap:10px">
      <h2>Akun tertahan</h2>
      <p class="redup" style="margin:0">Akun pengurus yang belum bisa dibuatkan password sementara karena tanggal lahir santri kosong. Lengkapi tanggal lahir di Data Master (Moderator), lalu aktifkan.</p>
      <div class="baris"><input v-model="f.q" placeholder="Saring nama atau NIS (min. 2 huruf)" style="flex:1 1 240px"><button :disabled="!siap || f.sibuk" @click="aktifkan">Aktifkan {{ siap }} akun yang tanggal lahirnya sudah lengkap</button></div>
    </div>
    <Pesan :galat="f.galat" :ok="f.ok"/>
    <div class="tabel"><table><thead><tr><th>Santri</th><th>Email</th><th>Jabatan</th><th>Tanggal lahir</th></tr></thead>
      <tbody v-baris><tr v-for="s in tampil" :key="s.id">
        <td><div class="santri-sel"><FotoSantri :s="s"/><span><strong>{{ s.nama }}</strong><div class="redup">{{ s.nis }} · {{ s.lingkungan }}</div></span></div></td>
        <td>{{ s.email }}</td><td>{{ s.jabatan || '—' }}</td>
        <td><span class="lencana" :class="s.tanggal_lahir ? 'hijau' : 'merah'">{{ s.tanggal_lahir || 'Kosong' }}</span></td></tr></tbody></table>
      <p v-if="!tampil.length" class="redup" style="padding:14px">Tidak ada akun tertahan.</p></div>`,
  };

  // ------------------------------------------------------------ halaman
  const UpdateData = {
    components: { Pesan, UDKelas, UDMenunggu, UDAlumni, UDKamar, UDSerah, UDPengurus, UDPaw, UDTertahan },
    setup() {
      const info = ref(null), galat = ref("");
      const me = negara.me, mod = me.role === "moderator";
      const tabs = [
        ["kelas", "Update Kelas Tahunan", mod], ["menunggu", "Menunggu Penempatan", mod], ["alumni", "Batal Alumni", mod],
        ["kamar", "Update Kamar", mod || me.bisa.update_kamar], ["serah", "Masa Khidmat & Serah Terima", mod],
        ["pengurus", "Isi Bagian Pengurus", mod || me.bisa.isi_pengurus], ["paw", "PAW", mod || me.bisa.paw],
        ["tertahan", "Akun Tertahan", mod || me.bisa.isi_pengurus],
      ].filter((t) => t[2]);
      const q = new URLSearchParams(negara.rute.split("?")[1] || "");
      const tab = ref(tabs.some((t) => t[0] === q.get("tab")) ? q.get("tab") : (tabs[0] || [""])[0]);
      const muatInfo = async () => { try { info.value = await api("/updatedata/info"); } catch (e) { galat.value = e.message; } };
      const angka = (k) => !info.value ? 0 : k === "menunggu" ? info.value.menunggu : k === "tertahan" ? info.value.tertahan : 0;
      onMounted(muatInfo);
      return { info, galat, tabs, tab, muatInfo, angka };
    },
    template: `<div><span class="jejak">Fungsi › Pengolahan Data</span><h1>Update Data & Import</h1></div>
    <div class="tab"><button v-for="t in tabs" :key="t[0]" :class="{aktif: tab===t[0]}" @click="tab=t[0]">{{ t[1] }}<span v-if="angka(t[0])"> ({{ angka(t[0]) }})</span></button></div>
    <div v-if="galat" class="pesan galat">{{ galat }}</div>
    <template v-if="info">
      <UDKelas v-if="tab==='kelas'" :info="info" @ubah="muatInfo"/>
      <UDMenunggu v-if="tab==='menunggu'" @ubah="muatInfo"/>
      <UDAlumni v-if="tab==='alumni'"/>
      <UDKamar v-if="tab==='kamar'"/>
      <UDSerah v-if="tab==='serah'" :info="info" @ubah="muatInfo"/>
      <UDPengurus v-if="tab==='pengurus'" :info="info" @ubah="muatInfo"/>
      <UDPaw v-if="tab==='paw'" @ubah="muatInfo"/>
      <UDTertahan v-if="tab==='tertahan'" @ubah="muatInfo"/>
    </template>`,
  };

  daftarHalaman("/update-data", UpdateData, {
    label: "Update Data", grup: "Fungsi", urutan: 60,
    syarat: (me) => me.role === "moderator" || me.bisa.update_kamar || me.bisa.paw || me.bisa.isi_pengurus,
    ikon: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15"/><path d="M4 20v-5h5"/>',
  });
})();
