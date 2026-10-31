// Modul Rapor Kesantrian — dihitung dari absensi, pelanggaran+vonis, prestasi, anggota_grup, riwayat_kelas. Lihat src/modul/README.md.
// Tanpa data medis: status Sakit hanya tampil sebagai angka kehadiran, keterangan/diagnosa tidak pernah dibaca.
const TGL = /^\d{4}-\d{2}-\d{2}$/;
const geser = (t, hari) => new Date(Date.parse(t + "T00:00:00Z") + hari * 864e5).toISOString().slice(0, 10);

export default function (H) {
  const { on, json, gagal, wajib, cekLing, hariIni } = H;

  // GET /api/rapor/:id?periode=90  atau  ?ta_id=<id>  (≈ 12 query termasuk sesi login)
  on("GET", "/api/rapor/:id", async ({ db, u, p, url }) => {
    wajib(u, "lihat_rapor");
    const s = await db.prepare(
      `SELECT s.id, s.nis, s.nama, s.jenis_kelamin, s.lingkungan, s.status, s.foto_url, km.nama kamar_kini
       FROM santri s LEFT JOIN kamar km ON km.id = s.kamar_id WHERE s.id = ?`).bind(+p.id || 0).first();
    if (!s) gagal(404, "Santri tidak ditemukan.");
    cekLing(u, s.lingkungan);

    // ---- periode
    const kini = hariIni();
    let dari, sampai = kini, judul, catatan = null, ta = null;
    const taId = +url.searchParams.get("ta_id");
    if (taId) {
      ta = await db.prepare("SELECT * FROM tahun_ajaran WHERE id = ?").bind(taId).first();
      if (!ta) gagal(404, "Tahun ajaran tidak ditemukan.");
      sampai = ta.selesai && TGL.test(ta.selesai) && ta.selesai < kini ? ta.selesai : kini;
      judul = "Tahun Ajaran " + ta.nama;
      if (ta.mulai && TGL.test(ta.mulai)) dari = ta.mulai;
      else {
        const awal = await db.prepare("SELECT MIN(se.tanggal) t FROM absensi a JOIN absensi_sesi se ON se.id = a.sesi_id WHERE a.santri_id = ? AND se.tanggal <= ?").bind(s.id, sampai).first();
        dari = awal && awal.t ? awal.t : geser(sampai, -365);
        catatan = `Tanggal mulai tahun ajaran ${ta.nama} belum diisi; periode dihitung sejak ${awal && awal.t ? "absensi pertama santri" : "365 hari sebelum akhir periode"}.`;
      }
      if (dari > sampai) gagal(400, "Tahun ajaran ini belum dimulai.");
    } else {
      dari = geser(kini, -89);
      judul = "90 hari terakhir";
    }

    // ---- semua data dibaca dalam satu batch
    const overlap = "x.mulai <= ? AND (x.selesai IS NULL OR x.selesai > ?)";
    const [kelR, kamR, absR, skR, pelR, preR, grR, agR] = await db.batch([
      db.prepare(`SELECT x.mulai, x.selesai, k.tingkat, k.rombel, j.nama jenjang FROM riwayat_kelas x JOIN kelas k ON k.id = x.kelas_id JOIN jenjang j ON j.id = k.jenjang_id
        WHERE x.santri_id = ? AND x.mulai <= ? ORDER BY x.mulai`).bind(s.id, sampai),
      db.prepare(`SELECT x.mulai, x.selesai, km.nama FROM riwayat_kamar x JOIN kamar km ON km.id = x.kamar_id WHERE x.santri_id = ? AND x.mulai <= ? ORDER BY x.mulai`).bind(s.id, sampai),
      db.prepare(`SELECT se.jenis, a.status_kehadiran_id, a.sumber, COUNT(*) n FROM absensi a JOIN absensi_sesi se ON se.id = a.sesi_id
        WHERE a.santri_id = ? AND se.tanggal BETWEEN ? AND ? GROUP BY se.jenis, a.status_kehadiran_id, a.sumber`).bind(s.id, dari, sampai),
      db.prepare("SELECT id, kode, nama, warna, dihitung_hadir, urutan FROM status_kehadiran ORDER BY urutan"),
      // Vonis berlaku = vonis terakhir di rantai (tidak digantikan vonis lain). Dibatalkan & pemutihan tidak dihitung.
      db.prepare(`SELECT p.id, substr(p.tanggal,1,10) tanggal, kat.nama kategori, tv.nama tingkat FROM pelanggaran p
        JOIN pilihan kat ON kat.id = p.kategori_id
        LEFT JOIN vonis v ON v.id = (SELECT MAX(v1.id) FROM vonis v1 WHERE v1.pelanggaran_id = p.id AND NOT EXISTS (SELECT 1 FROM vonis v2 WHERE v2.menggantikan_vonis_id = v1.id))
        LEFT JOIN tingkat_vonis tv ON tv.id = v.tingkat_vonis_id
        WHERE p.santri_id = ? AND p.status <> 'dibatalkan' AND substr(p.tanggal,1,10) BETWEEN ? AND ? AND COALESCE(tv.adalah_pemutihan, 0) = 0
        ORDER BY p.tanggal, p.id`).bind(s.id, dari, sampai),
      db.prepare(`SELECT p.tanggal, p.nama_kegiatan, p.lokasi, pt.nama tingkat, ph.nama hasil FROM prestasi p
        LEFT JOIN pilihan pt ON pt.id = p.tingkat_lomba_id LEFT JOIN pilihan ph ON ph.id = p.hasil_lomba_id
        WHERE p.santri_id = ? AND p.tanggal BETWEEN ? AND ? ORDER BY p.tanggal`).bind(s.id, dari, sampai),
      db.prepare(`SELECT x.grup_id, MIN(x.mulai) mulai, MAX(COALESCE(x.selesai, '9999-12-31')) selesai, MAX(x.peran) peran, g.nama, pk.nama kegiatan, pe.nama ekstrakurikuler, gr.nama pembimbing
        FROM anggota_grup x JOIN grup_kegiatan g ON g.id = x.grup_id JOIN pilihan pk ON pk.id = g.kegiatan_id
        LEFT JOIN pilihan pe ON pe.id = g.ekstrakurikuler_id LEFT JOIN guru gr ON gr.id = g.pembimbing_guru_id
        WHERE x.santri_id = ? AND ${overlap} GROUP BY x.grup_id ORDER BY pk.urutan, g.nama`).bind(s.id, sampai, dari),
      db.prepare(`SELECT se.target_id grup_id, COUNT(*) total, SUM(sk.dihitung_hadir) hadir FROM absensi a JOIN absensi_sesi se ON se.id = a.sesi_id
        JOIN status_kehadiran sk ON sk.id = a.status_kehadiran_id
        WHERE a.santri_id = ? AND se.jenis = 'kegiatan' AND se.tanggal BETWEEN ? AND ? GROUP BY se.target_id`).bind(s.id, dari, sampai),
    ]);

    // ---- identitas: kelas & kamar dari riwayat yang beririsan dengan periode (bukan kelas saat ini); label MIA/IIS tidak dicetak
    const beririsan = (rows) => {
      const r = rows.filter((x) => !x.selesai || x.selesai > dari);
      return r.length ? r : rows.slice(-1); // keluar tepat di awal periode → pakai riwayat terakhir
    };
    const unik = (a) => [...new Set(a)];
    const kelas = unik(beririsan(kelR.results).map((k) => `${k.tingkat} ${k.rombel} ${k.jenjang}`)).join(" → ") || null;
    const kamar = unik(beririsan(kamR.results).map((k) => k.nama)).join(" → ") || s.kamar_kini || null;

    // ---- kehadiran: per status, Pulang dibedakan menurut sumber (skorsing vs izin/libur)
    const sk = Object.fromEntries(skR.results.map((x) => [x.id, x]));
    const kehadiran = {};
    for (const jenis of ["harian", "kegiatan"]) {
      const baris = {};
      let total = 0, hadir = 0;
      for (const r of absR.results.filter((x) => x.jenis === jenis)) {
        const st = sk[r.status_kehadiran_id] || { kode: "?", nama: "Lainnya", warna: "#55605A", dihitung_hadir: 0, urutan: 99 };
        const ket = r.sumber === "skorsing" ? "skorsing" : r.sumber === "perizinan" && st.kode === "P" ? "izin/libur" : "";
        const k = st.kode + "|" + ket;
        const b = (baris[k] ||= { kode: st.kode, nama: st.nama + (ket ? ` (${ket})` : ""), warna: st.warna, urutan: st.urutan, dihitung_hadir: st.dihitung_hadir, n: 0 });
        b.n += r.n; total += r.n; if (st.dihitung_hadir) hadir += r.n;
      }
      const daftar = Object.values(baris).sort((a, b) => a.urutan - b.urutan || a.nama.localeCompare(b.nama))
        .map(({ urutan, ...b }) => ({ ...b, persen: total ? Math.round((b.n / total) * 1000) / 10 : 0 }));
      kehadiran[jenis] = { total, hadir, persen: total ? Math.round((hadir / total) * 1000) / 10 : null, status: daftar };
    }

    const absGrup = Object.fromEntries(agR.results.map((x) => [x.grup_id, x]));
    const grup = grR.results.map((g) => {
      const a = absGrup[g.grup_id] || { total: 0, hadir: 0 };
      return { ...g, selesai: g.selesai === "9999-12-31" ? null : g.selesai, total: a.total, hadir: a.hadir || 0, persen: a.total ? Math.round(((a.hadir || 0) / a.total) * 1000) / 10 : null };
    });

    return json({
      periode: { dari, sampai, judul, catatan, ta_id: ta ? ta.id : null },
      santri: { id: s.id, nis: s.nis, nama: s.nama, jenis_kelamin: s.jenis_kelamin, lingkungan: s.lingkungan, status: s.status, foto_url: s.foto_url, kelas, kamar },
      kehadiran,
      kedisiplinan: pelR.results.map((x) => ({ tanggal: x.tanggal, kategori: x.kategori, tingkat: x.tingkat || "Menunggu sidang" })),
      prestasi: preR.results,
      grup,
      dicetak: H.wib(),
    });
  });
}
