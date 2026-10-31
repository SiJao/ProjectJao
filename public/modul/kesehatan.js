// Modul tampilan Kesehatan — satu halaman: kunjungan, pemeriksaan, profil & riwayat per santri, analisis musim sakit.
// Kontrol mengikuti akses: kesehatan (catat kunjungan), pemeriksaan (diagnosa & resep), profil_kesehatan (profil).
const Kesehatan = {
  components: { Pesan, CariSantri, FotoSantri },
  directives: { baris: vBaris },
  setup() {
    const bisa = negara.me.bisa;
    const medis = bisa.kesehatan || bisa.pemeriksaan;
    const TAB = [["kunjungan", "Kunjungan", medis], ["santri", "Per santri", medis || bisa.profil_kesehatan], ["analisis", "Analisis musim sakit", medis]].filter((t) => t[2]);
    const tab = ref(TAB.length ? TAB[0][0] : "");
    const sekarang = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 16);
    const f = reactive({ galat: "", ok: "", jenis: [], daftar: [], santri: null, jenis_kunjungan_id: "", keluhan: "", waktu: sekarang(), det: null, saring: "", saringJenis: "", saringStatus: "" });
    const pm = reactive({ diagnosa: "", diagnosa_lain: "", tindak_lanjut_id: "", catatan: "", pemeriksa: "", resep: [] });
    const ps = reactive({ santri: null, data: null, profil: null, ubah: { alergi: "", penyakit_kronis: "", catatan: "" }, galat: "", ok: "" });
    const an = reactive({ data: null, lingkungan: "" });
    const pesan = (g, o = "") => { f.galat = g; f.ok = o; };

    const pilihan = (kel, ling) => ((negara.master || {}).pilihan || []).filter((p) => p.kelompok === kel && p.aktif && (!ling || p.lingkungan === "semua" || p.lingkungan === ling));
    const jkSel = computed(() => f.jenis.find((j) => j.id === f.jenis_kunjungan_id));
    const keadaan = (k) => k.perawatan && !k.selesai_rawat_at ? ["Dirawat", "kuning"] : !k.pemeriksaan_id ? ["Menunggu pemeriksaan", "merah"] : ["Sudah diperiksa", "hijau"];
    // Saring daftar langsung saat mengetik (min. 2 huruf, jeda 250 ms) + filter jenis & keadaan.
    const kata = ref("");
    let jeda;
    watch(() => f.saring, (v) => { clearTimeout(jeda); jeda = setTimeout(() => { kata.value = v.trim().length >= 2 ? v.trim().toLowerCase() : ""; }, 250); });
    const daftarTampil = computed(() => f.daftar.filter((k) => (!kata.value || (k.nama + " " + k.nis + " " + (k.kamar || "") + " " + k.keluhan).toLowerCase().includes(kata.value))
      && (!f.saringJenis || k.jenis === f.saringJenis) && (!f.saringStatus || keadaan(k)[0] === f.saringStatus)));

    async function muat() {
      try {
        const r = await api("/kesehatan");
        f.jenis = r.jenis; f.daftar = r.daftar;
        if (!f.jenis_kunjungan_id && f.jenis[0]) f.jenis_kunjungan_id = f.jenis[0].id;
      } catch (e) { pesan(e.message); }
    }
    async function catatKunjungan() {
      pesan("");
      if (!f.santri) { pesan("Pilih santri."); return; }
      try {
        const r = await api("/kesehatan/kunjungan", { santri_id: f.santri.id, jenis_kunjungan_id: f.jenis_kunjungan_id, keluhan: f.keluhan, waktu: f.waktu });
        pesan("", "Kunjungan tercatat." + (r.kabar_wali ? ` Kabar dikirim ke ${r.kabar_wali} wali.` : ""));
        f.santri = null; f.keluhan = ""; f.waktu = sekarang();
        await muat(); await buka({ id: r.id });
      } catch (e) { pesan(e.message); }
    }
    function isiForm(p) {
      pm.diagnosa = p ? (p.diagnosa_id || "lain") : ""; pm.diagnosa_lain = p && !p.diagnosa_id ? p.diagnosa_lain || "" : "";
      pm.tindak_lanjut_id = p && p.tindak_lanjut_id || ""; pm.catatan = p && p.catatan || ""; pm.pemeriksa = p ? p.pemeriksa || "" : negara.me.nama;
      pm.resep = p && p.resep.length ? p.resep.map((r) => ({ obat: r.obat_id || "lain", obat_lain: r.obat_id ? "" : r.obat_lain || "", aturan_pakai: r.aturan_pakai || "" })) : [{ obat: "", obat_lain: "", aturan_pakai: "" }];
    }
    async function buka(k) {
      try { f.det = await api("/kesehatan/kunjungan/" + k.id); isiForm(f.det.pemeriksaan); } catch (e) { pesan(e.message); }
    }
    async function simpanPemeriksaan() {
      pesan("");
      const lain = pm.diagnosa === "lain";
      try {
        await api(`/kesehatan/kunjungan/${f.det.id}/pemeriksaan`, {
          diagnosa_id: lain ? null : pm.diagnosa || null, diagnosa_lain: lain ? pm.diagnosa_lain : null, tindak_lanjut_id: pm.tindak_lanjut_id || null,
          catatan: pm.catatan, pemeriksa: pm.pemeriksa,
          resep: pm.resep.filter((r) => r.obat).map((r) => ({ obat_id: r.obat === "lain" ? null : r.obat, obat_lain: r.obat === "lain" ? r.obat_lain : null, aturan_pakai: r.aturan_pakai })),
        });
        pesan("", "Pemeriksaan tersimpan."); await muat(); await buka(f.det);
      } catch (e) { pesan(e.message); }
    }
    async function selesai() {
      if (!confirm("Tandai " + f.det.nama + " selesai dirawat? Absensi tidak lagi otomatis Sakit mulai besok.")) return;
      try { await api(`/kesehatan/kunjungan/${f.det.id}/selesai`, {}); pesan("", "Ditandai selesai dirawat."); await muat(); await buka(f.det); } catch (e) { pesan(e.message); }
    }
    async function batal() {
      const alasan = prompt("Alasan membatalkan kunjungan " + f.det.nama + "? (mis. salah input)");
      if (!alasan) return;
      try { const r = await api(`/kesehatan/kunjungan/${f.det.id}/batal`, { alasan }); pesan("", "Kunjungan dibatalkan." + (r.ralat_wali ? " Wali menerima ralat." : "")); f.det = null; await muat(); } catch (e) { pesan(e.message); }
    }

    // Per santri: profil (lihat / ubah) + riwayat kunjungan.
    async function muatSantri() {
      ps.galat = ""; ps.ok = ""; ps.data = null; ps.profil = null;
      if (!ps.santri) return;
      try {
        const pr = await api("/kesehatan/profil/" + ps.santri.id);
        ps.profil = pr.profil;
        Object.assign(ps.ubah, { alergi: "", penyakit_kronis: "", catatan: "" }, pr.profil || {});
        if (medis) ps.data = await api("/kesehatan/santri/" + ps.santri.id);
      } catch (e) { ps.galat = e.message; }
    }
    async function simpanProfil() {
      ps.galat = ""; ps.ok = "";
      try { await api("/kesehatan/profil/" + ps.santri.id, { alergi: ps.ubah.alergi, penyakit_kronis: ps.ubah.penyakit_kronis, catatan: ps.ubah.catatan }); ps.ok = "Profil tersimpan."; await muatSantri(); ps.ok = "Profil tersimpan."; }
      catch (e) { ps.galat = e.message; }
    }
    watch(() => ps.santri, muatSantri);
    function bukaRiwayat(k) { ps.santri = { id: k.santri_id, nama: k.nama, nis: k.nis, kelas: k.kelas, kamar: k.kamar, foto_url: k.foto_url }; tab.value = "santri"; }

    async function muatAnalisis() { try { an.data = await api("/kesehatan/analisis" + (an.lingkungan ? "?lingkungan=" + an.lingkungan : "")); } catch (e) { pesan(e.message); } }
    const tinggi = (n) => { const max = Math.max(1, ...(an.data ? an.data.bulan.map((b) => b.n) : [1])); return Math.round((n / max) * 140); };
    watch(() => an.lingkungan, muatAnalisis);
    watch(tab, (t) => { pesan(""); if (t === "analisis" && !an.data) muatAnalisis(); });

    onMounted(async () => { await muatMaster(); if (medis) muat(); });
    return { bisa, medis, TAB, tab, f, pm, ps, an, pilihan, jkSel, keadaan, daftarTampil, catatKunjungan, buka, simpanPemeriksaan, selesai, batal, simpanProfil, bukaRiwayat, tinggi, negara };
  },
  template: `<div class="judul-hal"><div><span class="jejak">Administrasi › Kesantrian</span><h1>Kesehatan</h1></div><span class="lencana kuning">Data medis · akses terbatas</span></div>
  <div class="tab" v-if="TAB.length > 1"><button v-for="t in TAB" :class="{aktif: tab===t[0]}" @click="tab=t[0]">{{ t[1] }}</button></div>
  <Pesan :galat="f.galat" :ok="f.ok"/>

  <template v-if="tab==='kunjungan'">
    <div class="kartu" v-if="bisa.kesehatan" style="display:flex;flex-direction:column;gap:12px;max-width:760px">
      <h2>Catat kunjungan</h2>
      <label class="isian">Santri<CariSantri v-model="f.santri"/></label>
      <div class="baris">
        <div v-if="f.jenis.length <= 2" role="group" aria-label="Jenis kunjungan" style="display:flex;flex-direction:column;gap:6px"><strong style="font-size:13px">Jenis kunjungan</strong>
          <div class="baris"><button v-for="j in f.jenis" type="button" :class="f.jenis_kunjungan_id===j.id ? '' : 'kedua'" :aria-pressed="f.jenis_kunjungan_id===j.id" @click="f.jenis_kunjungan_id=j.id">{{ j.nama }}</button></div></div>
        <label v-else class="isian">Jenis kunjungan<select v-model="f.jenis_kunjungan_id"><option v-for="j in f.jenis" :value="j.id">{{ j.nama }}</option></select></label>
        <label class="isian">Waktu (WIB)<input type="datetime-local" v-model="f.waktu"></label>
      </div>
      <p class="redup" v-if="jkSel">{{ jkSel.status_kehadiran_id ? 'Absensi otomatis Sakit sampai ditandai selesai dirawat.' : 'Tidak mengubah absensi.' }}
        <template v-if="jkSel.kabar_wali"> Wali menerima kabar "sedang sakit / dirawat", tanpa keluhan dan diagnosa.</template></p>
      <label class="isian">Keluhan (wajib)<input v-model="f.keluhan" maxlength="300" placeholder="mis. demam sejak semalam"></label>
      <div><button @click="catatKunjungan" :disabled="!f.santri || !f.keluhan.trim()">Simpan kunjungan</button></div>
    </div>

    <div class="dua-kolom">
      <div style="display:flex;flex-direction:column;gap:10px">
        <h2>Kunjungan aktif</h2>
        <p class="redup">Perawatan yang masih berjalan, kunjungan hari ini, dan kunjungan yang menunggu pemeriksaan.</p>
        <div class="baris">
          <label class="isian" style="flex:1 1 200px">Saring<input type="search" v-model="f.saring" placeholder="Nama, NIS, kamar, keluhan (min. 2 huruf)"></label>
          <label class="isian">Jenis<select v-model="f.saringJenis"><option value="">Semua</option><option v-for="j in f.jenis" :value="j.nama">{{ j.nama }}</option></select></label>
          <label class="isian">Keadaan<select v-model="f.saringStatus"><option value="">Semua</option><option>Dirawat</option><option>Menunggu pemeriksaan</option><option>Sudah diperiksa</option></select></label>
        </div>
        <div class="tabel"><table>
          <thead><tr><th>Santri</th><th>Jenis</th><th>Waktu</th><th>Keadaan</th><th></th></tr></thead>
          <tbody v-baris><tr v-for="k in daftarTampil" :key="k.id">
            <td><div class="santri-sel"><FotoSantri :s="k"/><span><strong>{{ k.nama }}</strong><div class="redup">{{ k.kamar }} · {{ k.keluhan }}</div></span></div></td>
            <td>{{ k.jenis }}</td><td style="white-space:nowrap">{{ k.waktu }}</td>
            <td><span class="lencana" :class="keadaan(k)[1]">{{ keadaan(k)[0] }}</span></td>
            <td><button class="kedua kecil" @click="buka(k)">Buka</button></td>
          </tr></tbody></table>
          <p v-if="!daftarTampil.length" class="redup" style="padding:14px">{{ f.daftar.length ? 'Tidak ada yang cocok dengan saringan.' : 'Tidak ada kunjungan aktif.' }}</p></div>
      </div>

      <div class="kartu" v-if="f.det" style="display:flex;flex-direction:column;gap:12px">
        <div class="baris" style="justify-content:space-between;align-items:center">
          <div class="santri-sel"><FotoSantri :s="f.det"/><span><strong>{{ f.det.nama }}</strong><div class="redup">{{ f.det.nis }} · {{ f.det.kelas }} · {{ f.det.kamar }}</div></span></div>
          <button class="kedua kecil" @click="f.det=null">Tutup</button></div>
        <div><span class="lencana" :class="f.det.status_kehadiran_id ? 'kuning' : 'biru'">{{ f.det.jenis }}</span> <span class="redup">{{ f.det.waktu }} WIB · dicatat {{ f.det.dicatat_nama || '—' }}</span>
          <span v-if="f.det.selesai_rawat_at" class="lencana hijau">Selesai dirawat {{ f.det.selesai_rawat_at }}</span></div>
        <div><strong>Keluhan:</strong> {{ f.det.keluhan }}</div>
        <div class="pesan info" v-if="f.det.profil && (f.det.profil.alergi || f.det.profil.penyakit_kronis)">
          <div v-if="f.det.profil.alergi"><strong>Alergi:</strong> {{ f.det.profil.alergi }}</div>
          <div v-if="f.det.profil.penyakit_kronis"><strong>Penyakit kronis:</strong> {{ f.det.profil.penyakit_kronis }}</div></div>

        <template v-if="bisa.pemeriksaan">
          <h2>{{ f.det.pemeriksaan ? 'Ubah pemeriksaan' : 'Pemeriksaan' }}</h2>
          <label class="isian">Diagnosa<select v-model="pm.diagnosa"><option value="" disabled>— pilih —</option>
            <option v-for="p in pilihan('diagnosa', f.det.lingkungan)" :value="p.id">{{ p.nama }}</option><option value="lain">Lainnya…</option></select></label>
          <label class="isian" v-if="pm.diagnosa==='lain'">Diagnosa lainnya<input v-model="pm.diagnosa_lain" maxlength="120"></label>
          <strong style="font-size:13px">Resep</strong>
          <div class="baris" v-for="(r, i) in pm.resep" :key="i">
            <label class="isian">Obat<select v-model="r.obat"><option value="">— tanpa obat —</option><option v-for="p in pilihan('obat', f.det.lingkungan)" :value="p.id">{{ p.nama }}</option><option value="lain">Lainnya…</option></select></label>
            <label class="isian" v-if="r.obat==='lain'">Nama obat<input v-model="r.obat_lain" maxlength="120"></label>
            <label class="isian" style="flex:1 1 160px">Aturan pakai<input v-model="r.aturan_pakai" maxlength="120" placeholder="3 × 1 sesudah makan"></label>
            <button type="button" class="kedua kecil" v-if="pm.resep.length > 1" @click="pm.resep.splice(i, 1)" :aria-label="'Hapus baris obat ' + (i + 1)">Hapus</button>
          </div>
          <div><button type="button" class="kedua kecil" @click="pm.resep.push({obat:'', obat_lain:'', aturan_pakai:''})">+ Tambah obat</button></div>
          <label class="isian">Tindak lanjut<select v-model="pm.tindak_lanjut_id"><option value="">—</option><option v-for="p in pilihan('tindak_lanjut', f.det.lingkungan)" :value="p.id">{{ p.nama }}</option></select></label>
          <label class="isian">Catatan<textarea v-model="pm.catatan" rows="2" maxlength="500"></textarea></label>
          <label class="isian">Pemeriksa<input v-model="pm.pemeriksa" maxlength="120"></label>
          <div><button @click="simpanPemeriksaan" :disabled="f.det.status!=='aktif'">Simpan pemeriksaan</button></div>
        </template>
        <template v-else>
          <h2>Pemeriksaan</h2>
          <div v-if="f.det.pemeriksaan" style="display:flex;flex-direction:column;gap:6px">
            <div><strong>Diagnosa:</strong> {{ f.det.pemeriksaan.diagnosa || f.det.pemeriksaan.diagnosa_lain }}</div>
            <div v-if="f.det.pemeriksaan.resep.length"><strong>Resep:</strong><ul><li v-for="r in f.det.pemeriksaan.resep">{{ r.obat || r.obat_lain }} — {{ r.aturan_pakai || '-' }}</li></ul></div>
            <div v-if="f.det.pemeriksaan.tindak_lanjut"><strong>Tindak lanjut:</strong> {{ f.det.pemeriksaan.tindak_lanjut }}</div>
            <div v-if="f.det.pemeriksaan.catatan"><strong>Catatan:</strong> {{ f.det.pemeriksaan.catatan }}</div>
            <div class="redup">Pemeriksa: {{ f.det.pemeriksaan.pemeriksa }} · {{ f.det.pemeriksaan.waktu }}</div></div>
          <p v-else class="redup">Belum diperiksa. Diagnosa dan resep diisi pemegang akses Pemeriksaan (mis. dokter).</p>
        </template>

        <div class="baris" v-if="bisa.kesehatan && f.det.status==='aktif'">
          <button v-if="f.det.status_kehadiran_id && !f.det.selesai_rawat_at" @click="selesai">Selesai dirawat</button>
          <button class="bahaya" @click="batal">Batalkan kunjungan</button></div>
        <div><button class="kedua kecil" @click="bukaRiwayat(f.det)">Riwayat kesehatan santri ini</button></div>
      </div>
    </div>
  </template>

  <template v-if="tab==='santri'">
    <div class="kartu" style="max-width:640px"><label class="isian">Santri<CariSantri v-model="ps.santri"/></label></div>
    <Pesan :galat="ps.galat" :ok="ps.ok"/>
    <div class="dua-kolom" v-if="ps.santri">
      <div class="kartu" style="display:flex;flex-direction:column;gap:12px">
        <h2>Profil kesehatan</h2>
        <template v-if="bisa.profil_kesehatan">
          <label class="isian">Alergi<input v-model="ps.ubah.alergi" maxlength="300"></label>
          <label class="isian">Penyakit kronis<input v-model="ps.ubah.penyakit_kronis" maxlength="300"></label>
          <label class="isian">Catatan<textarea v-model="ps.ubah.catatan" rows="2" maxlength="500"></textarea></label>
          <div><button @click="simpanProfil">Simpan profil</button></div>
        </template>
        <template v-else>
          <div><strong>Alergi:</strong> {{ ps.profil && ps.profil.alergi || '—' }}</div>
          <div><strong>Penyakit kronis:</strong> {{ ps.profil && ps.profil.penyakit_kronis || '—' }}</div>
          <div><strong>Catatan:</strong> {{ ps.profil && ps.profil.catatan || '—' }}</div>
          <p class="redup">Profil diubah oleh pemegang akses Profil kesehatan.</p>
        </template>
        <p class="redup" v-if="ps.profil">Terakhir diubah {{ ps.profil.diubah_at }} UTC{{ ps.profil.diubah_nama ? ' oleh ' + ps.profil.diubah_nama : '' }}.</p>
      </div>
      <div v-if="ps.data" style="display:flex;flex-direction:column;gap:10px">
        <h2>Riwayat kunjungan</h2>
        <div class="tabel"><table><thead><tr><th>Waktu</th><th>Jenis</th><th>Keluhan</th><th>Pemeriksaan</th></tr></thead>
          <tbody v-baris><tr v-for="k in ps.data.kunjungan" :key="k.id">
            <td style="white-space:nowrap">{{ k.waktu }}<div v-if="k.status==='dibatalkan'"><span class="lencana">Dibatalkan</span></div></td>
            <td>{{ k.jenis }}<div class="redup" v-if="k.perawatan">{{ k.selesai_rawat_at ? 'Selesai ' + k.selesai_rawat_at : 'Masih dirawat' }}</div></td>
            <td>{{ k.keluhan }}</td>
            <td><template v-if="k.pemeriksaan_id"><strong>{{ k.diagnosa }}</strong><div class="redup" v-for="r in k.resep">{{ r.obat }} — {{ r.aturan_pakai || '-' }}</div>
              <div class="redup" v-if="k.tindak_lanjut">{{ k.tindak_lanjut }}</div></template><span v-else class="redup">Belum diperiksa</span></td>
          </tr></tbody></table>
          <p v-if="!ps.data.kunjungan.length" class="redup" style="padding:14px">Belum ada kunjungan.</p></div>
      </div>
    </div>
  </template>

  <template v-if="tab==='analisis'">
    <div class="baris" v-if="negara.me.lingkungan==='semua'"><label class="isian">Lingkungan<select v-model="an.lingkungan"><option value="">Putra & Putri</option><option value="putra">Putra</option><option value="putri">Putri</option></select></label></div>
    <div class="kartu" v-if="an.data">
      <h2>Kunjungan per bulan (6 bulan terakhir)</h2>
      <div style="display:flex;align-items:flex-end;gap:12px;height:200px;margin-top:12px" role="img" :aria-label="'Kunjungan per bulan: ' + an.data.bulan.map(b => b.label + ' ' + b.n).join(', ')">
        <div v-for="b in an.data.bulan" :key="b.bulan" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px;height:100%">
          <strong>{{ b.n }}</strong>
          <div :style="{width:'100%', maxWidth:'56px', height: Math.max(2, tinggi(b.n)) + 'px', background:'var(--hijau)', borderRadius:'6px 6px 0 0'}" :title="b.perawatan + ' perawatan'"></div>
          <span class="redup">{{ b.label }}</span></div>
      </div>
    </div>
    <div class="dua-kolom" v-if="an.data">
      <div class="kartu"><h2>5 diagnosa terbanyak</h2>
        <ol v-if="an.data.diagnosa.length"><li v-for="d in an.data.diagnosa">{{ d.nama }} <span class="redup">({{ d.n }})</span></li></ol><p v-else class="redup">Belum ada pemeriksaan.</p></div>
      <div class="kartu"><h2>5 keluhan terbanyak</h2>
        <ol v-if="an.data.keluhan.length"><li v-for="d in an.data.keluhan">{{ d.nama }} <span class="redup">({{ d.n }})</span></li></ol><p v-else class="redup">Belum ada kunjungan.</p></div>
    </div>
  </template>
  <p v-if="!TAB.length" class="pesan galat">Anda tidak punya akses Kesehatan.</p>`,
};
daftarHalaman("/kesehatan", Kesehatan, {
  label: "Kesehatan", grup: "Administrasi", urutan: 40,
  syarat: (me) => me.bisa.kesehatan || me.bisa.pemeriksaan || me.bisa.profil_kesehatan,
  ikon: '<path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z"/><path d="M12 9v6M9 12h6"/>',
});
