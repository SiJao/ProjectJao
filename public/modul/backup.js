// Modul tampilan Backup & Ekspor — README "Backup Database" & "Export Excel" (rekap Absensi Kamar).
// Berkas .sql disusun di browser dari /api/backup/skema + /api/backup/data, lalu (opsional) dienkripsi di browser:
// PBKDF2-SHA256 200.000 iterasi → AES-GCM-256; berkas = "HISADA-BACKUP-v1\n" + base64(salt16 | iv12 | ciphertext).
// Nama global berawalan "bk"/"Bk" agar tidak bertabrakan dengan skrip modul lain.
const BK_KEPALA = "HISADA-BACKUP-v1\n";
const BK_ITERASI = 200000;

const bkKutip = (nama) => '"' + String(nama).replace(/"/g, '""') + '"';
// Nilai → literal SQL: NULL, angka apa adanya, teks dengan kutip tunggal digandakan, BLOB sebagai X'..'.
function bkNilaiSql(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "object" && typeof v.hex === "string") return "X'" + v.hex.replace(/[^0-9a-f]/gi, "") + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

// Susun isi .sql (array potongan teks). ambil(tabel, offset, batas) → { kolom, baris, selesai }.
// opsi.d1 = untuk impor ke Cloudflare D1 (D1 menolak BEGIN/COMMIT di berkas; pakai defer_foreign_keys).
async function bkSusunSql(skema, ambil, opsi = {}) {
  const kemajuan = opsi.kemajuan || (() => {}), out = [];
  const tanpa = skema.tabel.filter((t) => t.tanpa_data).map((t) => t.nama);
  out.push(`-- Backup database HISADA\n-- Dibuat: ${skema.waktu} WIB${opsi.oleh ? " oleh " + String(opsi.oleh).replace(/\n/g, " ") : ""}\n`
    + `-- Data tabel sesi/token tidak ikut (hanya skemanya): ${tanpa.join(", ") || "-"}\n`
    + `-- Pulihkan ke database KOSONG (sebelum aplikasi pertama kali jalan), mis. sqlite3 hisada.db < berkas.sql\n`);
  out.push(opsi.d1 ? "PRAGMA defer_foreign_keys = TRUE;\n" : "PRAGMA foreign_keys = OFF;\nBEGIN TRANSACTION;\n");
  for (const t of skema.tabel) out.push(t.sql + ";\n");
  let i = 0;
  for (const t of skema.tabel) {
    kemajuan(t.nama, ++i, skema.tabel.length);
    if (t.tanpa_data || !t.jumlah) continue;
    let offset = 0;
    for (;;) {
      const r = await ambil(t.nama, offset, 500);
      const awal = `INSERT INTO ${bkKutip(t.nama)} (${r.kolom.map(bkKutip).join(", ")}) VALUES (`;
      for (const b of r.baris) out.push(awal + b.map(bkNilaiSql).join(", ") + ");\n");
      offset += r.baris.length;
      if (r.selesai || !r.baris.length) break;
    }
  }
  for (const o of skema.lain) out.push(o.sql + ";\n");
  if (!opsi.d1) out.push("COMMIT;\n");
  return out;
}

// base64 per potongan (hindari batas argumen String.fromCharCode untuk berkas besar)
function bkKeB64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function bkDariB64(s) {
  const bin = atob(s.replace(/\s+/g, "")), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
async function bkKunci(sandi, salt) {
  const bahan = await crypto.subtle.importKey("raw", new TextEncoder().encode(sandi), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: BK_ITERASI }, bahan, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function bkEnkripsi(teks, sandi) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await bkKunci(sandi, salt), new TextEncoder().encode(teks)));
  const semua = new Uint8Array(28 + ct.length);
  semua.set(salt, 0); semua.set(iv, 16); semua.set(ct, 28);
  return BK_KEPALA + bkKeB64(semua);
}
async function bkDekripsi(isiBerkas, sandi) {
  if (!String(isiBerkas).startsWith(BK_KEPALA)) throw new Error("Bukan berkas backup HISADA terenkripsi (kepala HISADA-BACKUP-v1 tidak ada).");
  let u8;
  try { u8 = bkDariB64(isiBerkas.slice(BK_KEPALA.length)); } catch { throw new Error("Isi berkas rusak (bukan base64)."); }
  if (u8.length < 29) throw new Error("Isi berkas terlalu pendek.");
  try {
    const teks = await crypto.subtle.decrypt({ name: "AES-GCM", iv: u8.subarray(16, 28) }, await bkKunci(sandi, u8.subarray(0, 16)), u8.subarray(28));
    return new TextDecoder().decode(teks);
  } catch { throw new Error("Kata sandi salah atau berkas rusak."); }
}
const bkUkuran = (n) => n == null ? "—" : n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(2) + " MB";
const bkStempel = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 16).replace("T", "-").replace(":", "");

// ---------------------------------------------------------------- Backup .sql & Ekspor CSV (Moderator)
const BkBackup = {
  components: { Pesan },
  setup() {
    const f = reactive({ enkripsi: true, sandi: "", sandi2: "", d1: false, jalan: false, kemajuan: "", log: [], galat: "", ok: "",
      dek: { berkas: null, sandi: "" }, skema: null, tabelCsv: "" });
    const ambil = (tabel, offset, batas) => api(`/backup/data?tabel=${encodeURIComponent(tabel)}&offset=${offset}&batas=${batas}`);
    const muatLog = async () => { try { f.log = await api("/backup/log"); } catch (e) { f.galat = e.message; } };
    const muatSkema = async () => { try { f.skema = await api("/backup/skema"); } catch (e) { f.galat = e.message; } };
    onMounted(() => { muatLog(); muatSkema(); });
    const catatLog = (data) => api("/backup/log", data).catch(() => {}).then(muatLog);

    async function buatBackup() {
      f.galat = ""; f.ok = "";
      if (f.enkripsi) {
        if (f.sandi.length < 10) { f.galat = "Kata sandi enkripsi minimal 10 karakter."; return; }
        if (f.sandi !== f.sandi2) { f.galat = "Kedua kata sandi tidak sama."; return; }
      }
      f.jalan = true;
      try {
        const skema = await api("/backup/skema");
        const potongan = await bkSusunSql(skema, ambil, { d1: f.d1, oleh: negara.me.nama, kemajuan: (t, i, n) => { f.kemajuan = `Membaca tabel ${t} (${i}/${n})…`; } });
        let isi, nama = `hisada-backup-${bkStempel()}${f.d1 ? "-d1" : ""}.sql`;
        if (f.enkripsi) { f.kemajuan = "Mengenkripsi…"; isi = new Blob([await bkEnkripsi(potongan.join(""), f.sandi)], { type: "text/plain" }); nama += ".enc"; }
        else isi = new Blob(potongan, { type: "application/sql" });
        unduhBerkas(nama, isi);
        await catatLog({ jenis: "sql", ukuran: isi.size, status: f.enkripsi ? "berhasil, terenkripsi" : "berhasil, tanpa enkripsi" });
        f.ok = `Backup ${nama} (${bkUkuran(isi.size)}) diunduh. Unggah ke repositori GitHub privat backup.`;
        f.sandi = ""; f.sandi2 = "";
      } catch (e) {
        f.galat = "Backup gagal: " + e.message;
        await catatLog({ jenis: "sql", ukuran: null, status: "gagal" });
      }
      f.jalan = false; f.kemajuan = "";
    }

    async function dekripsi() {
      f.galat = ""; f.ok = "";
      const b = f.dek.berkas;
      if (!b || !f.dek.sandi) { f.galat = "Pilih berkas .enc dan isi kata sandinya."; return; }
      f.jalan = true; f.kemajuan = "Membuka berkas…";
      try {
        const teks = await bkDekripsi(await b.text(), f.dek.sandi);
        unduhBerkas(b.name.replace(/\.enc$/i, "") || "hisada-backup.sql", teks, "application/sql");
        f.ok = "Berkas berhasil dibuka dan diunduh sebagai .sql."; f.dek.sandi = "";
      } catch (e) { f.galat = e.message; }
      f.jalan = false; f.kemajuan = "";
    }

    async function eksporCsv() {
      f.galat = ""; f.ok = "";
      const t = (f.skema?.tabel || []).find((x) => x.nama === f.tabelCsv);
      if (!t) return;
      f.jalan = true;
      try {
        let kolom = t.kolom, baris = [];
        for (let offset = 0; ;) {
          f.kemajuan = `Membaca ${t.nama}: ${offset} baris…`;
          const r = await ambil(t.nama, offset, 1000);
          kolom = r.kolom; baris = baris.concat(r.baris.map((b) => b.map((v) => v && typeof v === "object" ? "X'" + v.hex + "'" : v)));
          offset += r.baris.length;
          if (r.selesai || !r.baris.length) break;
        }
        unduhCsv(`hisada-${t.nama}-${bkStempel()}.csv`, [kolom, ...baris]);
        await catatLog({ jenis: "csv", tabel: t.nama, ukuran: baris.length, status: `berhasil, ${baris.length} baris ${t.nama}` });
        f.ok = `CSV ${t.nama} (${baris.length} baris) diunduh.`;
      } catch (e) { f.galat = e.message; await catatLog({ jenis: "csv", tabel: t.nama, status: "gagal" }); }
      f.jalan = false; f.kemajuan = "";
    }
    return { f, buatBackup, dekripsi, eksporCsv, bkUkuran };
  },
  template: `<div class="pesan info">Simpan berkas backup di <strong>repositori GitHub PRIVAT terpisah</strong> (bukan repo aplikasi); untuk sementara diunggah manual.
    Kata sandi enkripsi dipegang <strong>lebih dari 2 orang</strong> dari pihak pondok / tim IT — tanpa kata sandi, backup terenkripsi tidak bisa dibuka sama sekali.
    Backup berisi seluruh database (termasuk hash password); data sesi login tidak ikut.</div>
  <Pesan :galat="f.galat" :ok="f.ok"/>
  <div class="dua-kolom">
    <form class="kartu" style="display:flex;flex-direction:column;gap:12px" @submit.prevent="buatBackup">
      <h2>Backup .sql</h2>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" v-model="f.enkripsi">Enkripsi dengan kata sandi (disarankan)</label>
      <template v-if="f.enkripsi">
        <label class="isian">Kata sandi enkripsi (min. 10 karakter)<input type="password" v-model="f.sandi" autocomplete="new-password"></label>
        <label class="isian">Ulangi kata sandi<input type="password" v-model="f.sandi2" autocomplete="new-password"></label>
        <div v-if="f.sandi2 && f.sandi !== f.sandi2" class="pesan galat">Kedua kata sandi tidak sama.</div>
      </template>
      <div v-else class="pesan galat">Tanpa enkripsi, berkas berisi data santri dan hash password apa adanya.</div>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" v-model="f.d1">Format untuk impor ke Cloudflare D1 (tanpa BEGIN/COMMIT)</label>
      <div><button :disabled="f.jalan">Buat & unduh backup</button></div>
      <p v-if="f.kemajuan" class="redup" style="margin:0" aria-live="polite">{{ f.kemajuan }}</p>
    </form>
    <form class="kartu" style="display:flex;flex-direction:column;gap:12px" @submit.prevent="dekripsi">
      <h2>Buka backup terenkripsi</h2>
      <label class="isian">Berkas .sql.enc<input type="file" accept=".enc" @change="f.dek.berkas = $event.target.files[0] || null"></label>
      <label class="isian">Kata sandi<input type="password" v-model="f.dek.sandi" autocomplete="off"></label>
      <div><button class="kedua" :disabled="f.jalan">Buka & unduh .sql</button></div>
      <p class="redup" style="margin:0">Dibuka di browser ini saja; berkas dan kata sandi tidak dikirim ke server.</p>
    </form>
  </div>
  <div class="kartu baris">
    <label class="isian" style="flex:1 1 260px">Ekspor CSV per tabel<select v-model="f.tabelCsv"><option value="">Pilih tabel…</option>
      <option v-for="t in (f.skema ? f.skema.tabel.filter((x) => !x.tanpa_data) : [])" :key="t.nama" :value="t.nama">{{ t.nama }} ({{ t.jumlah }} baris)</option></select></label>
    <button class="kedua" :disabled="!f.tabelCsv || f.jalan" @click="eksporCsv">Unduh CSV</button>
  </div>
  <h2>Backup terakhir</h2>
  <div class="tabel"><table><thead><tr><th>Waktu (UTC)</th><th>Jenis</th><th>Ukuran</th><th>Status</th><th>Oleh</th></tr></thead>
    <tbody><tr v-for="l in f.log" :key="l.id"><td class="redup" style="white-space:nowrap">{{ l.waktu }}</td><td><span class="lencana">{{ l.jenis }}</span></td>
      <td>{{ l.jenis === 'csv' ? (l.ukuran ?? '—') + ' baris' : bkUkuran(l.ukuran) }}</td>
      <td><span class="lencana" :class="/^berhasil/.test(l.status) ? 'hijau' : 'merah'">{{ l.status }}</span></td><td>{{ l.oleh_nama }}</td></tr></tbody></table></div>
  <p v-if="!f.log.length" class="redup">Belum ada backup.</p>`,
};

// ---------------------------------------------------------------- Rekap Absensi Kamar (.xlsx) — pemegang akses absensi
const BkRekap = {
  components: { Pesan },
  directives: { baris: vBaris },
  setup() {
    const t = hariIni();
    const r = reactive({ dari: t.slice(0, 8) + "01", sampai: t, kamar_id: "", data: null, q: "", qTunda: "", buka: false, galat: "" });
    const m = computed(() => negara.master || {});
    onMounted(muatMaster);
    async function tampilkan() {
      r.galat = ""; r.data = null;
      try { r.data = await api(`/rekap-absensi?dari=${r.dari}&sampai=${r.sampai}${r.kamar_id ? "&kamar_id=" + r.kamar_id : ""}`); } catch (e) { r.galat = e.message; }
    }
    // cari santri langsung (tunda 250 ms, min. 2 huruf), saran maks. 5
    let tunda;
    watch(() => r.q, (v) => { clearTimeout(tunda); const s = v.trim(); if (s.length === 1) return; tunda = setTimeout(() => { r.qTunda = s.toLowerCase(); r.buka = s.length >= 2; }, 250); });
    const baris = computed(() => !r.data ? [] : r.data.baris.filter((b) => !r.qTunda || b.nama.toLowerCase().includes(r.qTunda) || String(b.nis).startsWith(r.qTunda)));
    const saran = computed(() => r.qTunda ? baris.value.slice(0, 5) : []);
    const pilih = (b) => { r.q = b.nama; r.buka = false; };
    function unduh() {
      const st = r.data.status;
      const kamar = r.kamar_id ? (m.value.kamar || []).find((k) => k.id == r.kamar_id)?.nama : "semua-kamar";
      unduhXlsx(`rekap-absensi-${kamar}-${r.dari}-${r.sampai}.xlsx`, [{ nama: "Rekap Absensi Kamar", baris: [
        ["Kamar", "NIS", "Nama", ...st.map((s) => s.nama), "Total sesi", "% Hadir"],
        ...baris.value.map((b) => [b.kamar, b.nis, b.nama, ...st.map((s) => b.jumlah[s.kode] || 0), b.total, b.persen_hadir]),
      ] }]);
    }
    return { r, m, tampilkan, baris, saran, pilih, unduh };
  },
  template: `<div class="kartu baris">
    <label class="isian">Dari<input type="date" v-model="r.dari"></label>
    <label class="isian">Sampai<input type="date" v-model="r.sampai" :min="r.dari"></label>
    <label class="isian">Kamar<select v-model="r.kamar_id"><option value="">Semua kamar</option><option v-for="k in (m.kamar || [])" :key="k.id" :value="k.id">{{ k.nama }}</option></select></label>
    <button @click="tampilkan">Tampilkan rekap</button>
    <button class="kedua" :disabled="!r.data || !baris.length" @click="unduh">Unduh .xlsx</button>
  </div>
  <p class="redup">Absensi harian saja. Persentase hadir = sesi berstatus "dihitung hadir" ÷ semua sesi santri tersebut pada rentang ini.</p>
  <Pesan :galat="r.galat"/>
  <template v-if="r.data">
    <div class="baris"><div style="position:relative;flex:0 1 320px">
      <label class="isian">Cari santri<input v-model="r.q" type="search" placeholder="Nama atau NIS (min. 2 huruf)" autocomplete="off" @blur="r.buka = false" @focus="r.buka = r.qTunda.length >= 2"></label>
      <div v-if="r.buka && saran.length" class="kartu saran" style="top:100%"><button v-for="b in saran" :key="b.kamar + b.nis" type="button" @mousedown.prevent="pilih(b)"><span><strong>{{ b.nama }}</strong> <span class="redup">{{ b.nis }} · {{ b.kamar }}</span></span></button></div>
    </div><span class="redup" style="align-self:center">{{ baris.length }} baris</span></div>
    <div class="tabel"><table>
      <thead><tr><th>Kamar</th><th>NIS</th><th>Nama</th><th v-for="s in r.data.status" :key="s.id" :title="s.nama">{{ s.kode }}</th><th>Total</th><th>% Hadir</th></tr></thead>
      <tbody v-baris><tr v-for="b in baris" :key="b.kamar + '|' + b.nis"><td>{{ b.kamar }}</td><td>{{ b.nis }}</td><td>{{ b.nama }}</td>
        <td v-for="s in r.data.status" :key="s.id">{{ b.jumlah[s.kode] || 0 }}</td><td>{{ b.total }}</td>
        <td><span class="lencana" :class="b.persen_hadir >= 90 ? 'hijau' : b.persen_hadir >= 75 ? 'kuning' : 'merah'">{{ b.persen_hadir }}%</span></td></tr></tbody></table></div>
    <p v-if="!r.data.baris.length" class="redup">Belum ada absensi harian pada rentang ini.</p>
  </template>`,
};

const BackupEkspor = {
  components: { BkBackup, BkRekap },
  setup() {
    const mod = negara.me.role === "moderator", absensi = !!negara.me.bisa.absensi;
    const tab = ref(mod ? "backup" : "rekap");
    return { tab, mod, absensi };
  },
  template: `<div><span class="jejak">Fungsi › Keberlanjutan</span><h1>Backup & Ekspor</h1></div>
  <div class="tab"><button v-if="mod" :class="{aktif: tab==='backup'}" @click="tab='backup'">Backup & CSV</button><button v-if="absensi" :class="{aktif: tab==='rekap'}" @click="tab='rekap'">Rekap Absensi Kamar</button></div>
  <BkBackup v-if="tab==='backup' && mod"/>
  <BkRekap v-else-if="tab==='rekap' && absensi"/>`,
};
daftarHalaman("/backup", BackupEkspor, { label: "Backup & Ekspor", grup: "Fungsi", urutan: 85, syarat: (me) => me.role === "moderator" || me.bisa.absensi,
  ikon: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>' });
