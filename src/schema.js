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
  }
];
