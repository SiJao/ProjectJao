// Skema database D1 (SQLite) HISADA — Tahap 1.
// Dijalankan otomatis oleh worker (lihat migrate() di worker.js). Setiap migrasi hanya sekali.
// Aturan: NIK, No KK, penghasilan, NISN TIDAK disimpan (K-79, K-82).

export const MIGRATIONS = [
  {
    id: 1,
    nama: "tahap1-inti",
    sql: [
      // ---------- A. Daftar pilihan (K-85) ----------
      `CREATE TABLE pilihan (
        id INTEGER PRIMARY KEY,
        kelompok TEXT NOT NULL,
        nama TEXT NOT NULL,
        urutan INTEGER NOT NULL DEFAULT 0,
        aktif INTEGER NOT NULL DEFAULT 1,
        lingkungan TEXT NOT NULL DEFAULT 'semua' CHECK (lingkungan IN ('putra','putri','semua')),
        UNIQUE (kelompok, nama, lingkungan)
      )`,
      `CREATE TABLE status_kehadiran (
        id INTEGER PRIMARY KEY,
        kode TEXT NOT NULL UNIQUE,
        nama TEXT NOT NULL,
        warna TEXT NOT NULL DEFAULT '#55605A',
        dihitung_hadir INTEGER NOT NULL DEFAULT 0,
        urutan INTEGER NOT NULL DEFAULT 0,
        aktif INTEGER NOT NULL DEFAULT 1
      )`,
      `CREATE TABLE jenis_izin (
        id INTEGER PRIMARY KEY,
        nama TEXT NOT NULL UNIQUE,
        basis_waktu TEXT NOT NULL CHECK (basis_waktu IN ('jam','tanggal_jam','tanggal')),
        wajib_wali INTEGER NOT NULL DEFAULT 0,
        jam_kembali_bawaan TEXT,
        status_kehadiran_id INTEGER REFERENCES status_kehadiran(id),
        urutan INTEGER NOT NULL DEFAULT 0,
        aktif INTEGER NOT NULL DEFAULT 1
      )`,
      `CREATE TABLE pengaturan (kunci TEXT PRIMARY KEY, nilai TEXT, keterangan TEXT)`,

      // ---------- B. Data Master ----------
      `CREATE TABLE tahun_ajaran (
        id INTEGER PRIMARY KEY,
        nama TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('persiapan','aktif','arsip')),
        mulai TEXT, selesai TEXT,
        penanda_aktif INTEGER GENERATED ALWAYS AS (CASE WHEN status = 'aktif' THEN 1 END) STORED,
        UNIQUE (penanda_aktif)
      )`,
      `CREATE TABLE jenjang (id INTEGER PRIMARY KEY, nama TEXT NOT NULL UNIQUE, urutan INTEGER NOT NULL DEFAULT 0)`,
      `CREATE TABLE kelas (
        id INTEGER PRIMARY KEY,
        tingkat INTEGER NOT NULL CHECK (tingkat BETWEEN 1 AND 6),
        rombel TEXT NOT NULL,
        jenjang_id INTEGER NOT NULL REFERENCES jenjang(id),
        label TEXT,
        lingkungan TEXT NOT NULL CHECK (lingkungan IN ('putra','putri')),
        aktif INTEGER NOT NULL DEFAULT 1,
        UNIQUE (tingkat, rombel, jenjang_id, lingkungan)
      )`,
      `CREATE TABLE guru (
        id INTEGER PRIMARY KEY,
        nip TEXT NOT NULL UNIQUE,
        nama TEXT NOT NULL,
        jenis_kelamin TEXT NOT NULL CHECK (jenis_kelamin IN ('L','P')),
        no_hp TEXT, email TEXT,
        lingkungan TEXT NOT NULL DEFAULT 'semua' CHECK (lingkungan IN ('putra','putri','semua')),
        aktif INTEGER NOT NULL DEFAULT 1
      )`,
      `CREATE TABLE wali_kelas (
        id INTEGER PRIMARY KEY,
        kelas_id INTEGER NOT NULL REFERENCES kelas(id),
        tahun_ajaran_id INTEGER NOT NULL REFERENCES tahun_ajaran(id),
        guru_id INTEGER NOT NULL REFERENCES guru(id),
        peran TEXT NOT NULL CHECK (peran IN ('wali','asisten')),
        UNIQUE (kelas_id, tahun_ajaran_id, peran, guru_id)
      )`,
      `CREATE TABLE asrama (
        id INTEGER PRIMARY KEY,
        nama TEXT NOT NULL UNIQUE,
        lingkungan TEXT NOT NULL CHECK (lingkungan IN ('putra','putri')),
        aktif INTEGER NOT NULL DEFAULT 1
      )`,
      `CREATE TABLE kamar (
        id INTEGER PRIMARY KEY,
        asrama_id INTEGER NOT NULL REFERENCES asrama(id),
        nomor TEXT NOT NULL,
        nama TEXT NOT NULL UNIQUE,
        lingkungan TEXT NOT NULL CHECK (lingkungan IN ('putra','putri')),
        kapasitas INTEGER,
        aktif INTEGER NOT NULL DEFAULT 1
      )`,
      `CREATE TABLE wali_asuh_kamar (
        id INTEGER PRIMARY KEY,
        kamar_id INTEGER NOT NULL REFERENCES kamar(id),
        tahun_ajaran_id INTEGER NOT NULL REFERENCES tahun_ajaran(id),
        guru_id INTEGER NOT NULL REFERENCES guru(id),
        peran TEXT NOT NULL CHECK (peran IN ('wali_asuh','asisten')),
        UNIQUE (kamar_id, tahun_ajaran_id, guru_id)
      )`,
      `CREATE TABLE santri (
        id INTEGER PRIMARY KEY,
        nis TEXT NOT NULL UNIQUE,
        nama TEXT NOT NULL,
        jenis_kelamin TEXT NOT NULL CHECK (jenis_kelamin IN ('L','P')),
        lingkungan TEXT GENERATED ALWAYS AS (CASE jenis_kelamin WHEN 'L' THEN 'putra' ELSE 'putri' END) STORED,
        tempat_lahir TEXT, tanggal_lahir TEXT,
        status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','alumni','mutasi_keluar','skorsing','meninggal')),
        kelas_id INTEGER REFERENCES kelas(id),
        kamar_id INTEGER REFERENCES kamar(id),
        kabupaten TEXT, provinsi TEXT, foto_url TEXT,
        dibuat_at TEXT NOT NULL DEFAULT (datetime('now')),
        diubah_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX santri_ling ON santri (lingkungan, status)`,
      `CREATE INDEX santri_kamar ON santri (kamar_id)`,
      `CREATE TABLE riwayat_kelas (
        id INTEGER PRIMARY KEY,
        santri_id INTEGER NOT NULL REFERENCES santri(id),
        kelas_id INTEGER NOT NULL REFERENCES kelas(id),
        tahun_ajaran_id INTEGER REFERENCES tahun_ajaran(id),
        mulai TEXT NOT NULL, selesai TEXT,
        sebab TEXT NOT NULL DEFAULT 'masuk',
        terbuka INTEGER GENERATED ALWAYS AS (CASE WHEN selesai IS NULL THEN 1 END) STORED,
        UNIQUE (santri_id, terbuka)
      )`,
      `CREATE TABLE riwayat_kamar (
        id INTEGER PRIMARY KEY,
        santri_id INTEGER NOT NULL REFERENCES santri(id),
        kamar_id INTEGER NOT NULL REFERENCES kamar(id),
        mulai TEXT NOT NULL, selesai TEXT,
        sebab TEXT NOT NULL DEFAULT 'masuk',
        terbuka INTEGER GENERATED ALWAYS AS (CASE WHEN selesai IS NULL THEN 1 END) STORED,
        UNIQUE (santri_id, terbuka)
      )`,
      `CREATE TABLE wali (
        id INTEGER PRIMARY KEY,
        nama TEXT NOT NULL,
        hubungan TEXT NOT NULL CHECK (hubungan IN ('ayah','ibu','wali')),
        no_hp TEXT, no_hp_normal TEXT
      )`,
      `CREATE INDEX wali_hp ON wali (no_hp_normal)`,
      `CREATE TABLE santri_wali (santri_id INTEGER NOT NULL REFERENCES santri(id), wali_id INTEGER NOT NULL REFERENCES wali(id), PRIMARY KEY (santri_id, wali_id))`,

      // ---------- C. Akun & akses ----------
      `CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        nama TEXT NOT NULL,
        role TEXT CHECK (role IN ('piket','kesehatan','kedisiplinan','sekretaris','asatidz','moderator')),
        santri_id INTEGER UNIQUE REFERENCES santri(id),
        guru_id INTEGER UNIQUE REFERENCES guru(id),
        lingkungan TEXT NOT NULL DEFAULT 'semua' CHECK (lingkungan IN ('putra','putri','semua')),
        status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','nonaktif','tertahan')),
        wajib_ganti_password INTEGER NOT NULL DEFAULT 1,
        gagal_login INTEGER NOT NULL DEFAULT 0,
        terkunci_sampai TEXT,
        login_terakhir TEXT,
        dibuat_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (role IS NULL OR role <> 'moderator' OR santri_id IS NULL),
        CHECK (NOT (santri_id IS NOT NULL AND guru_id IS NOT NULL))
      )`,
      `CREATE TABLE akses (kode TEXT PRIMARY KEY, nama TEXT NOT NULL, keterangan TEXT)`,
      `CREATE TABLE user_akses (
        user_id INTEGER NOT NULL REFERENCES users(id),
        akses_kode TEXT NOT NULL REFERENCES akses(kode),
        diberikan_oleh INTEGER REFERENCES users(id),
        diberikan_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, akses_kode)
      )`,
      `CREATE TABLE sesi_login (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        dibuat_at TEXT NOT NULL DEFAULT (datetime('now')),
        kedaluwarsa TEXT NOT NULL
      )`,

      // ---------- E. Kesantrian (Tahap 1: Absensi, Perizinan) ----------
      `CREATE TABLE absensi_sesi (
        id INTEGER PRIMARY KEY,
        jenis TEXT NOT NULL CHECK (jenis IN ('harian','kegiatan')),
        tanggal TEXT NOT NULL,
        sesi_pilihan_id INTEGER NOT NULL REFERENCES pilihan(id),
        target_id INTEGER NOT NULL,
        lingkungan TEXT NOT NULL CHECK (lingkungan IN ('putra','putri')),
        diisi_oleh INTEGER REFERENCES users(id),
        diisi_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (jenis, tanggal, sesi_pilihan_id, target_id)
      )`,
      `CREATE TABLE absensi (
        id INTEGER PRIMARY KEY,
        sesi_id INTEGER NOT NULL REFERENCES absensi_sesi(id),
        santri_id INTEGER NOT NULL REFERENCES santri(id),
        status_kehadiran_id INTEGER NOT NULL REFERENCES status_kehadiran(id),
        sumber TEXT NOT NULL DEFAULT 'manual' CHECK (sumber IN ('manual','perizinan','overdue','kesehatan','skorsing')),
        izin_id INTEGER,
        keterangan TEXT,
        lingkungan TEXT NOT NULL,
        UNIQUE (sesi_id, santri_id)
      )`,
      `CREATE TABLE izin (
        id INTEGER PRIMARY KEY,
        santri_id INTEGER NOT NULL REFERENCES santri(id),
        jenis_izin_id INTEGER NOT NULL REFERENCES jenis_izin(id),
        keterangan TEXT NOT NULL,
        berangkat TEXT NOT NULL,
        rencana_kembali TEXT NOT NULL,
        kembali_at TEXT,
        status TEXT NOT NULL DEFAULT 'berjalan' CHECK (status IN ('berjalan','kembali','overdue','dibatalkan')),
        overdue_at TEXT,
        pendamping TEXT,
        lingkungan TEXT NOT NULL,
        diterbitkan_oleh INTEGER REFERENCES users(id),
        dikonfirmasi_oleh INTEGER REFERENCES users(id),
        dibatalkan_at TEXT, dibatalkan_oleh INTEGER REFERENCES users(id), alasan_batal TEXT,
        dibuat_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (rencana_kembali > berangkat)
      )`,
      `CREATE INDEX izin_status ON izin (lingkungan, status)`,

      // ---------- H. Fungsi sistem ----------
      `CREATE TABLE riwayat_perubahan (
        id INTEGER PRIMARY KEY,
        waktu TEXT NOT NULL DEFAULT (datetime('now')),
        user_id INTEGER REFERENCES users(id),
        kategori TEXT NOT NULL,
        aksi TEXT NOT NULL,
        tabel TEXT, data_id INTEGER,
        ringkasan TEXT,
        lingkungan TEXT NOT NULL DEFAULT 'semua'
      )`,

      // ---------- Data awal (bisa diubah lewat Data Master) ----------
      `INSERT INTO status_kehadiran (kode, nama, warna, dihitung_hadir, urutan) VALUES
        ('H','Hadir','#1E5E3F',1,1),('I','Izin','#23497E',0,2),('S','Sakit','#7A4E0C',0,3),
        ('A','Alpha','#8E2A22',0,4),('P','Pulang','#4A3D7A',0,5)`,
      `INSERT INTO jenis_izin (nama, basis_waktu, wajib_wali, jam_kembali_bawaan, status_kehadiran_id, urutan) VALUES
        ('Keluar Sementara','jam',0,NULL,(SELECT id FROM status_kehadiran WHERE kode='I'),1),
        ('Izin Dinas','tanggal_jam',0,NULL,(SELECT id FROM status_kehadiran WHERE kode='I'),2),
        ('Pulang','tanggal',1,'17:00',(SELECT id FROM status_kehadiran WHERE kode='P'),3)`,
      `INSERT INTO jenjang (nama, urutan) VALUES ('MTs',1),('SMP',2),('MA',3)`,
      `INSERT INTO pilihan (kelompok, nama, urutan) VALUES
        ('sesi_absensi','Harian',1),
        ('kegiatan','Pramuka',1),('kegiatan','Muhadhoroh',2),('kegiatan','Halaqah Qur''an',3),('kegiatan','Olahraga',4),('kegiatan','Kesenian',5),
        ('kategori_pelanggaran','Keamanan',1),('kategori_pelanggaran','Bahasa',2),('kategori_pelanggaran','Ibadah',3),('kategori_pelanggaran','Kebersihan',4),
        ('tindak_lanjut','Kembali ke kegiatan',1),('tindak_lanjut','Istirahat di kamar',2),('tindak_lanjut','Rujuk ke klinik / RS',3),
        ('tingkat_lomba','Pondok',1),('tingkat_lomba','Kabupaten',2),('tingkat_lomba','Provinsi',3),('tingkat_lomba','Nasional',4),
        ('hasil_lomba','Juara 1',1),('hasil_lomba','Juara 2',2),('hasil_lomba','Juara 3',3),('hasil_lomba','Harapan',4),('hasil_lomba','Peserta',5)`,
      `INSERT INTO pengaturan (kunci, nilai, keterangan) VALUES
        ('overdue.masa_tenggang_menit','60','Batas terlambat sebelum izin dinyatakan overdue (K-95)'),
        ('overdue.status_kode','A','Status absensi untuk izin overdue'),
        ('skorsing.status_kode','P','Status absensi selama skorsing (K-101)'),
        ('login.batas_gagal','5','Gagal login berturut-turut sebelum dikunci'),
        ('login.lama_kunci_menit','15','Lama akun terkunci setelah gagal login berulang'),
        ('sesi.lama_jam','12','Lama sesi login')`,
      `INSERT INTO akses (kode, nama, keterangan) VALUES
        ('absensi','Absensi','Mengisi absensi harian / kegiatan'),
        ('perizinan','Perizinan','Menerbitkan izin, Gate Pass, konfirmasi kembali'),
        ('kesehatan','Kesehatan','Kunjungan dan pemeriksaan (Tahap 2)'),
        ('profil_kesehatan','Profil kesehatan','Alergi dan penyakit kronis (Tahap 2)'),
        ('input_pelanggaran','Input pelanggaran','Mencatat pelanggaran (Tahap 2)'),
        ('putusan_kedisiplinan','Putusan kedisiplinan','Memvonis dan memutihkan (Tahap 2)'),
        ('pilihan.obat','Daftar obat','Mengedit daftar obat'),
        ('pilihan.diagnosa','Daftar diagnosa','Mengedit daftar diagnosa'),
        ('pilihan.kategori_pelanggaran','Daftar kategori pelanggaran','Mengedit kategori pelanggaran'),
        ('pilihan.sesi_absensi','Daftar sesi absensi','Mengedit sesi absensi')`
    ]
  },
  {
    id: 2,
    nama: "tahap2-3",
    sql: [
      // ---------- A. Daftar pilihan berperilaku ----------
      `CREATE TABLE jenis_kunjungan (
        id INTEGER PRIMARY KEY,
        nama TEXT NOT NULL UNIQUE,
        status_kehadiran_id INTEGER REFERENCES status_kehadiran(id),
        kabar_wali INTEGER NOT NULL DEFAULT 0,
        urutan INTEGER NOT NULL DEFAULT 0,
        aktif INTEGER NOT NULL DEFAULT 1
      )`,
      `CREATE TABLE tingkat_vonis (
        id INTEGER PRIMARY KEY,
        nama TEXT NOT NULL UNIQUE,
        kabar_wali INTEGER NOT NULL DEFAULT 0,
        adalah_pemutihan INTEGER NOT NULL DEFAULT 0,
        urutan INTEGER NOT NULL DEFAULT 0,
        aktif INTEGER NOT NULL DEFAULT 1
      )`,

      // ---------- B. Data Master (tambahan) ----------
      `ALTER TABLE santri ADD COLUMN menunggu_penempatan INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE santri ADD COLUMN tanggal_masuk TEXT`,
      `ALTER TABLE riwayat_kelas ADD COLUMN impor_batch_id INTEGER`,
      `ALTER TABLE riwayat_kelas ADD COLUMN oleh INTEGER`,
      `ALTER TABLE riwayat_kamar ADD COLUMN impor_batch_id INTEGER`,
      `ALTER TABLE riwayat_kamar ADD COLUMN oleh INTEGER`,
      `CREATE TABLE riwayat_status_santri (
        id INTEGER PRIMARY KEY,
        santri_id INTEGER NOT NULL REFERENCES santri(id),
        lingkungan TEXT NOT NULL,
        status_lama TEXT, status_baru TEXT NOT NULL,
        alasan TEXT,
        impor_batch_id INTEGER,
        oleh INTEGER REFERENCES users(id),
        waktu TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX rss_santri ON riwayat_status_santri (santri_id)`,

      // ---------- D. Organisasi ----------
      `CREATE TABLE masa_khidmat (
        id INTEGER PRIMARY KEY,
        nama TEXT NOT NULL,
        mulai TEXT NOT NULL, selesai TEXT,
        status TEXT NOT NULL CHECK (status IN ('aktif','arsip')),
        dibuka_oleh INTEGER REFERENCES users(id), ditutup_oleh INTEGER REFERENCES users(id),
        penanda_aktif INTEGER GENERATED ALWAYS AS (CASE WHEN status = 'aktif' THEN 1 END) STORED,
        UNIQUE (penanda_aktif)
      )`,
      `CREATE TABLE jabatan (
        id INTEGER PRIMARY KEY,
        nama TEXT NOT NULL,
        lingkungan TEXT NOT NULL DEFAULT 'semua' CHECK (lingkungan IN ('putra','putri','semua')),
        urutan INTEGER NOT NULL DEFAULT 0,
        aktif INTEGER NOT NULL DEFAULT 1,
        UNIQUE (nama, lingkungan)
      )`,
      `CREATE TABLE pengurus (
        id INTEGER PRIMARY KEY,
        masa_khidmat_id INTEGER NOT NULL REFERENCES masa_khidmat(id),
        santri_id INTEGER NOT NULL REFERENCES santri(id),
        lingkungan TEXT NOT NULL,
        jabatan_id INTEGER NOT NULL REFERENCES jabatan(id),
        user_id INTEGER REFERENCES users(id),
        mulai TEXT NOT NULL, selesai TEXT,
        sebab_selesai TEXT CHECK (sebab_selesai IN ('serah_terima','paw','status_santri')),
        alasan_paw TEXT,
        oleh INTEGER REFERENCES users(id),
        aktif INTEGER GENERATED ALWAYS AS (CASE WHEN selesai IS NULL THEN 1 END) STORED,
        UNIQUE (santri_id, aktif)
      )`,
      `CREATE INDEX pengurus_mk ON pengurus (lingkungan, masa_khidmat_id)`,
      `ALTER TABLE riwayat_perubahan ADD COLUMN masa_khidmat_id INTEGER`,

      // ---------- E. Kesantrian (tambahan) ----------
      `ALTER TABLE absensi ADD COLUMN kunjungan_id INTEGER`,
      `ALTER TABLE absensi_sesi ADD COLUMN catatan TEXT`,
      `CREATE TABLE libur_pondok (
        id INTEGER PRIMARY KEY,
        nama TEXT NOT NULL,
        berangkat TEXT NOT NULL, rencana_kembali TEXT NOT NULL,
        jenis_izin_id INTEGER NOT NULL REFERENCES jenis_izin(id),
        status TEXT NOT NULL DEFAULT 'berjalan' CHECK (status IN ('rencana','berjalan','selesai','dibatalkan')),
        alasan_batal TEXT,
        dibuat_oleh INTEGER REFERENCES users(id),
        dibuat_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (rencana_kembali > berangkat)
      )`,
      `ALTER TABLE izin ADD COLUMN libur_id INTEGER REFERENCES libur_pondok(id)`,
      `ALTER TABLE izin ADD COLUMN overdue_dikoreksi_at TEXT`,
      `ALTER TABLE izin ADD COLUMN overdue_dikoreksi_oleh INTEGER REFERENCES users(id)`,
      `ALTER TABLE izin ADD COLUMN alasan_koreksi TEXT`,
      `CREATE UNIQUE INDEX izin_libur ON izin (libur_id, santri_id)`,
      `CREATE INDEX izin_santri ON izin (santri_id, status)`,

      `CREATE TABLE kunjungan_kesehatan (
        id INTEGER PRIMARY KEY,
        santri_id INTEGER NOT NULL REFERENCES santri(id),
        lingkungan TEXT NOT NULL,
        jenis_kunjungan_id INTEGER NOT NULL REFERENCES jenis_kunjungan(id),
        keluhan TEXT NOT NULL,
        waktu TEXT NOT NULL,
        selesai_rawat_at TEXT,
        status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','dibatalkan')),
        dibatalkan_oleh INTEGER REFERENCES users(id), alasan_batal TEXT,
        dicatat_oleh INTEGER REFERENCES users(id),
        dibuat_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (selesai_rawat_at IS NULL OR selesai_rawat_at >= waktu)
      )`,
      `CREATE INDEX kunjungan_ling ON kunjungan_kesehatan (lingkungan, waktu)`,
      `CREATE INDEX kunjungan_santri ON kunjungan_kesehatan (santri_id)`,
      `CREATE TABLE pemeriksaan (
        id INTEGER PRIMARY KEY,
        kunjungan_id INTEGER NOT NULL UNIQUE REFERENCES kunjungan_kesehatan(id),
        diagnosa_id INTEGER REFERENCES pilihan(id), diagnosa_lain TEXT,
        tindak_lanjut_id INTEGER REFERENCES pilihan(id),
        catatan TEXT, pemeriksa TEXT,
        waktu TEXT NOT NULL,
        dicatat_oleh INTEGER REFERENCES users(id)
      )`,
      `CREATE TABLE resep (
        id INTEGER PRIMARY KEY,
        pemeriksaan_id INTEGER NOT NULL REFERENCES pemeriksaan(id),
        obat_id INTEGER REFERENCES pilihan(id), obat_lain TEXT,
        aturan_pakai TEXT
      )`,
      `CREATE TABLE profil_kesehatan (
        santri_id INTEGER PRIMARY KEY REFERENCES santri(id),
        lingkungan TEXT NOT NULL,
        alergi TEXT, penyakit_kronis TEXT, catatan TEXT,
        diubah_oleh INTEGER REFERENCES users(id),
        diubah_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,

      `CREATE TABLE pelanggaran (
        id INTEGER PRIMARY KEY,
        santri_id INTEGER NOT NULL REFERENCES santri(id),
        lingkungan TEXT NOT NULL,
        kategori_id INTEGER NOT NULL REFERENCES pilihan(id),
        keterangan TEXT NOT NULL,
        tanggal TEXT NOT NULL,
        sumber TEXT NOT NULL DEFAULT 'manual' CHECK (sumber IN ('manual','overdue')),
        izin_id INTEGER UNIQUE REFERENCES izin(id),
        dicatat_oleh INTEGER REFERENCES users(id),
        dicatat_at TEXT NOT NULL DEFAULT (datetime('now')),
        status TEXT NOT NULL DEFAULT 'menunggu' CHECK (status IN ('menunggu','divonis','dibatalkan')),
        dibatalkan_at TEXT, dibatalkan_oleh INTEGER REFERENCES users(id), alasan_batal TEXT
      )`,
      `CREATE INDEX pelanggaran_ling ON pelanggaran (lingkungan, status, tanggal)`,
      `CREATE INDEX pelanggaran_santri ON pelanggaran (santri_id)`,
      `CREATE TABLE vonis (
        id INTEGER PRIMARY KEY,
        pelanggaran_id INTEGER NOT NULL REFERENCES pelanggaran(id),
        lingkungan TEXT NOT NULL,
        tingkat_vonis_id INTEGER NOT NULL REFERENCES tingkat_vonis(id),
        hukuman TEXT, alasan TEXT,
        menggantikan_vonis_id INTEGER UNIQUE REFERENCES vonis(id),
        diputus_oleh INTEGER REFERENCES users(id),
        diputus_at TEXT NOT NULL DEFAULT (datetime('now')),
        vonis_pertama INTEGER GENERATED ALWAYS AS (CASE WHEN menggantikan_vonis_id IS NULL THEN 1 END) STORED,
        UNIQUE (pelanggaran_id, vonis_pertama)
      )`,
      // Skorsing bertanggal (K-112): selama mulai..selesai santri berstatus skorsing, absensi otomatis Pulang.
      `CREATE TABLE skorsing (
        id INTEGER PRIMARY KEY,
        santri_id INTEGER NOT NULL REFERENCES santri(id),
        lingkungan TEXT NOT NULL,
        mulai TEXT NOT NULL, selesai TEXT NOT NULL,
        alasan TEXT NOT NULL,
        pelanggaran_id INTEGER REFERENCES pelanggaran(id),
        status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','selesai','dibatalkan')),
        oleh INTEGER REFERENCES users(id),
        dibuat_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (selesai >= mulai)
      )`,
      `CREATE INDEX skorsing_santri ON skorsing (santri_id, status)`,

      `CREATE TABLE grup_kegiatan (
        id INTEGER PRIMARY KEY,
        kegiatan_id INTEGER NOT NULL REFERENCES pilihan(id),
        ekstrakurikuler_id INTEGER REFERENCES pilihan(id),
        nama TEXT NOT NULL,
        lingkungan TEXT NOT NULL CHECK (lingkungan IN ('putra','putri')),
        pembimbing_guru_id INTEGER REFERENCES guru(id),
        aktif INTEGER NOT NULL DEFAULT 1,
        dibuat_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE anggota_grup (
        id INTEGER PRIMARY KEY,
        grup_id INTEGER NOT NULL REFERENCES grup_kegiatan(id),
        santri_id INTEGER NOT NULL REFERENCES santri(id),
        lingkungan TEXT NOT NULL,
        peran TEXT NOT NULL DEFAULT 'anggota' CHECK (peran IN ('anggota','pengurus')),
        mulai TEXT NOT NULL, selesai TEXT,
        terbuka INTEGER GENERATED ALWAYS AS (CASE WHEN selesai IS NULL THEN 1 END) STORED,
        UNIQUE (grup_id, santri_id, terbuka)
      )`,
      `CREATE INDEX anggota_grup_santri ON anggota_grup (santri_id)`,
      `CREATE TABLE prestasi (
        id INTEGER PRIMARY KEY,
        santri_id INTEGER NOT NULL REFERENCES santri(id),
        lingkungan TEXT NOT NULL,
        nama_kegiatan TEXT NOT NULL, lokasi TEXT,
        tingkat_lomba_id INTEGER REFERENCES pilihan(id),
        hasil_lomba_id INTEGER REFERENCES pilihan(id),
        keterangan TEXT,
        tanggal TEXT NOT NULL,
        dicatat_oleh INTEGER REFERENCES users(id),
        dibuat_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX prestasi_ling ON prestasi (lingkungan, tanggal)`,

      // ---------- F. Tata Warkat ----------
      `CREATE TABLE agenda (
        id INTEGER PRIMARY KEY,
        lingkungan TEXT NOT NULL CHECK (lingkungan IN ('putra','putri')),
        judul TEXT NOT NULL,
        mulai TEXT NOT NULL, selesai TEXT NOT NULL,
        kategori_umum INTEGER NOT NULL DEFAULT 0, kategori_akademik INTEGER NOT NULL DEFAULT 0, kategori_pengasuhan INTEGER NOT NULL DEFAULT 0,
        keterangan TEXT,
        dibuat_oleh INTEGER REFERENCES users(id),
        dibuat_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (kategori_umum + kategori_akademik + kategori_pengasuhan >= 1),
        CHECK (selesai >= mulai)
      )`,
      `CREATE INDEX agenda_ling ON agenda (lingkungan, mulai)`,
      `CREATE TABLE surat (
        id INTEGER PRIMARY KEY,
        lingkungan TEXT NOT NULL CHECK (lingkungan IN ('putra','putri')),
        arah TEXT NOT NULL CHECK (arah IN ('keluar','masuk')),
        nomor TEXT NOT NULL, tanggal TEXT NOT NULL,
        perihal TEXT NOT NULL, pihak TEXT,
        status_disposisi TEXT, lampiran_url TEXT,
        dicatat_oleh INTEGER REFERENCES users(id),
        dibuat_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX surat_ling ON surat (lingkungan, tanggal)`,
      `CREATE TABLE barang (
        id INTEGER PRIMARY KEY,
        lingkungan TEXT NOT NULL CHECK (lingkungan IN ('putra','putri')),
        kode TEXT NOT NULL, nama TEXT NOT NULL,
        aktif INTEGER NOT NULL DEFAULT 1,
        UNIQUE (lingkungan, kode)
      )`,
      `CREATE TABLE barang_unit (
        id INTEGER PRIMARY KEY,
        barang_id INTEGER NOT NULL REFERENCES barang(id),
        lingkungan TEXT NOT NULL,
        kode_unit TEXT NOT NULL,
        kategori TEXT NOT NULL DEFAULT 'baru' CHECK (kategori IN ('lama','baru')),
        kondisi TEXT NOT NULL DEFAULT 'bagus' CHECK (kondisi IN ('bagus','rusak_ringan','rusak_berat','hilang')),
        keterangan TEXT,
        UNIQUE (barang_id, kode_unit)
      )`,

      // ---------- G. Portal Wali ----------
      `CREATE TABLE akun_wali (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        nama TEXT NOT NULL,
        no_hp_normal TEXT,
        email_terverifikasi_at TEXT,
        persetujuan_data_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'belum_verifikasi' CHECK (status IN ('belum_verifikasi','aktif','nonaktif')),
        terkunci_tautan_sampai TEXT,
        gagal_login INTEGER NOT NULL DEFAULT 0, terkunci_sampai TEXT,
        dibuat_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE tautan_wali (
        id INTEGER PRIMARY KEY,
        akun_wali_id INTEGER NOT NULL REFERENCES akun_wali(id),
        santri_id INTEGER NOT NULL REFERENCES santri(id),
        lingkungan TEXT NOT NULL,
        wali_id INTEGER REFERENCES wali(id),
        cara TEXT NOT NULL CHECK (cara IN ('otomatis','manual')),
        oleh INTEGER REFERENCES users(id),
        dibuat_at TEXT NOT NULL DEFAULT (datetime('now')),
        dicabut_at TEXT, dicabut_oleh INTEGER REFERENCES users(id),
        aktif INTEGER GENERATED ALWAYS AS (CASE WHEN dicabut_at IS NULL THEN 1 END) STORED,
        UNIQUE (akun_wali_id, santri_id, aktif)
      )`,
      `CREATE INDEX tautan_santri ON tautan_wali (santri_id)`,
      `CREATE TABLE percobaan_tautan (id INTEGER PRIMARY KEY, akun_wali_id INTEGER NOT NULL, waktu TEXT NOT NULL DEFAULT (datetime('now')), berhasil INTEGER NOT NULL)`,
      `CREATE INDEX percobaan_akun ON percobaan_tautan (akun_wali_id, waktu)`,
      `CREATE TABLE sesi_wali (
        token_hash TEXT PRIMARY KEY,
        akun_wali_id INTEGER NOT NULL REFERENCES akun_wali(id),
        dibuat_at TEXT NOT NULL DEFAULT (datetime('now')),
        kedaluwarsa TEXT NOT NULL
      )`,
      `CREATE TABLE token_akun (
        id INTEGER PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        akun_wali_id INTEGER REFERENCES akun_wali(id),
        jenis TEXT NOT NULL CHECK (jenis IN ('reset_password','aktivasi','verifikasi_email')),
        token_hash TEXT NOT NULL UNIQUE,
        kedaluwarsa TEXT NOT NULL,
        dipakai_at TEXT,
        CHECK ((user_id IS NULL) <> (akun_wali_id IS NULL))
      )`,

      // ---------- H. Fungsi sistem ----------
      `CREATE TABLE email_antrean (
        id INTEGER PRIMARY KEY,
        penerima TEXT NOT NULL,
        subjek TEXT NOT NULL,
        isi TEXT NOT NULL,
        jenis TEXT NOT NULL CHECK (jenis IN ('sistem','akun','kesantrian','wali','pengumuman')),
        status TEXT NOT NULL DEFAULT 'antre' CHECK (status IN ('antre','terkirim','gagal')),
        percobaan INTEGER NOT NULL DEFAULT 0,
        galat TEXT,
        dibuat_at TEXT NOT NULL DEFAULT (datetime('now')),
        dikirim_at TEXT,
        tabel_terkait TEXT, id_terkait INTEGER,
        akun_wali_id INTEGER REFERENCES akun_wali(id),
        koreksi_dari_id INTEGER REFERENCES email_antrean(id),
        lingkungan TEXT NOT NULL DEFAULT 'semua'
      )`,
      `CREATE INDEX email_status ON email_antrean (status, id)`,
      `CREATE INDEX email_terkait ON email_antrean (tabel_terkait, id_terkait)`,
      `CREATE TABLE impor_batch (
        id INTEGER PRIMARY KEY,
        jenis TEXT NOT NULL CHECK (jenis IN ('santri_baru','update_kelas_tahunan','update_kamar','pengurus','lainnya')),
        tahun_ajaran_id INTEGER REFERENCES tahun_ajaran(id),
        nama_file TEXT,
        jumlah_baris INTEGER NOT NULL DEFAULT 0,
        ditolak INTEGER NOT NULL DEFAULT 0,
        ringkasan TEXT,
        status TEXT NOT NULL DEFAULT 'dieksekusi' CHECK (status IN ('pratinjau','dieksekusi','dibatalkan')),
        berlaku INTEGER GENERATED ALWAYS AS (CASE WHEN status <> 'dibatalkan' THEN 1 END) STORED,
        dibatalkan_at TEXT, dibatalkan_oleh INTEGER REFERENCES users(id),
        oleh INTEGER REFERENCES users(id),
        waktu TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (jenis, tahun_ajaran_id, berlaku)
      )`,
      `CREATE TABLE backup_log (id INTEGER PRIMARY KEY, waktu TEXT NOT NULL DEFAULT (datetime('now')), jenis TEXT NOT NULL CHECK (jenis IN ('sql','csv')), ukuran INTEGER, status TEXT NOT NULL, oleh INTEGER REFERENCES users(id))`,

      // ---------- Data awal ----------
      `INSERT OR IGNORE INTO jenis_kunjungan (nama, status_kehadiran_id, kabar_wali, urutan) VALUES
        ('Rawat Jalan', NULL, 0, 1),
        ('Perawatan', (SELECT id FROM status_kehadiran WHERE kode='S'), 1, 2)`,
      `INSERT OR IGNORE INTO tingkat_vonis (nama, kabar_wali, adalah_pemutihan, urutan) VALUES
        ('Ringan',0,0,1),('Sedang',0,0,2),('Berat',1,0,3),('Pemutihan',0,1,4)`,
      `INSERT OR IGNORE INTO jabatan (nama, urutan) VALUES
        ('Ketua',1),('Wakil Ketua',2),('Sekretaris',3),('Bendahara',4),('Bagian Keamanan',5),('Bagian Bahasa',6),
        ('Bagian Peribadatan',7),('Bagian Kesehatan',8),('Bagian Kebersihan',9),('Bagian Pendidikan',10),('Bagian Olahraga',11),('Bagian Kesenian',12)`,
      `INSERT OR IGNORE INTO pilihan (kelompok, nama, urutan) VALUES
        ('diagnosa','Demam',1),('diagnosa','Flu / batuk',2),('diagnosa','Sakit kepala',3),('diagnosa','Diare',4),('diagnosa','Maag',5),('diagnosa','Luka',6),('diagnosa','Gatal-gatal',7),
        ('obat','Paracetamol',1),('obat','Antasida',2),('obat','Oralit',3),('obat','Obat batuk',4),('obat','Antiseptik luka',5),
        ('ekstrakurikuler','Futsal',1),('ekstrakurikuler','Basket',2),('ekstrakurikuler','Hadroh',3),('ekstrakurikuler','Kaligrafi',4),('ekstrakurikuler','Pencak silat',5)`,
      `INSERT OR IGNORE INTO pengaturan (kunci, nilai, keterangan) VALUES
        ('overdue.kategori_pelanggaran','Keamanan','Nama kategori pelanggaran otomatis untuk izin overdue'),
        ('pelanggaran.batas_batal_menit','60','Batas pencatat membatalkan input pelanggarannya'),
        ('tautan_wali.batas_gagal_per_hari','5','Gagal menautkan anak per hari sebelum dikunci'),
        ('tautan_wali.lama_kunci_jam','24','Lama penautan dikunci setelah gagal berulang'),
        ('email.mode_uji','1','1 = semua email dialihkan ke email.alamat_uji (server testing)'),
        ('email.alamat_uji','','Kotak surat tim IT untuk Mode Uji'),
        ('email.nama_pengirim','HISADA','Nama pengirim email')`,
      `INSERT OR IGNORE INTO akses (kode, nama, keterangan) VALUES
        ('pemeriksaan','Pemeriksaan kesehatan','Mengisi diagnosa, resep, tindak lanjut (mis. dokter)'),
        ('update_kamar','Update Kamar','Memindah kamar santri (massal)'),
        ('paw','Pergantian Antar-Waktu','Mengganti satu pengurus di tengah masa khidmat'),
        ('pilihan.tindak_lanjut','Daftar tindak lanjut','Mengedit tindak lanjut kesehatan'),
        ('pilihan.ekstrakurikuler','Daftar ekstrakurikuler','Mengedit daftar ekstrakurikuler'),
        ('pilihan.tingkat_lomba','Daftar tingkat lomba','Mengedit tingkat lomba'),
        ('pilihan.hasil_lomba','Daftar hasil lomba','Mengedit hasil lomba')`,
      `UPDATE akses SET keterangan = REPLACE(keterangan, ' (Tahap 2)', '')`
    ]
  }
];
