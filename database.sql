-- =====================================================================
-- DATABASE: Sistem Hisada (Himpunan Santri Daarul Uluum Lido)
-- =====================================================================
-- File SQL TUNGGAL -- aman diimport ke database kosong MAUPUN ke
-- database yang sudah pernah berisi data lama (DROP TABLE di bawah
-- menghapus tabel lama dulu sebelum membuat ulang dari nol).
--
-- CARA PAKAI DI HOSTING SHARED (cPanel/Hostinger):
--   1. Buka cPanel -> "MySQL Databases", buat database baru (nama akan
--      otomatis diberi prefix akunmu, misal: u123456789_hisada_db).
--   2. Di halaman yang sama, buat MySQL user baru, lalu "Add User to
--      Database" dengan centang ALL PRIVILEGES. Ini WAJIB -- membuat
--      database dan user secara terpisah TIDAK otomatis menghubungkan
--      keduanya.
--   3. Buka phpMyAdmin, pilih (klik) database yang baru dibuat tadi di
--      sidebar kiri -- database itu harus sudah AKTIF TERPILIH.
--   4. Baru import file ini lewat tab "Import". JANGAN menambahkan lagi
--      baris CREATE DATABASE / USE di atas file ini -- akun shared
--      hosting umumnya tidak diizinkan membuat/pindah database sendiri
--      lewat query, hanya lewat cPanel.
--
-- KREDENSIAL KONEKSI (config/database.php):
--   Isi DB_HOST, DB_NAME, DB_USER, DB_PASS di config/database.php dengan
--   kredensial ASLI hosting kamu -- JANGAN PERNAH commit password asli
--   ke repository publik seperti ini. Kredensial produksi disimpan
--   terpisah di luar repo (catatan pribadi/pesan terpisah), bukan di
--   file manapun yang ikut ter-push ke GitHub.
--
-- CARA PAKAI DI SERVER SENDIRI (VPS/lokal, akses root penuh):
--   mysql -u root -p -e "CREATE DATABASE hisada_db CHARACTER SET utf8mb4;"
--   mysql -u root -p hisada_db < database.sql
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS
    pengaturan, wali_akses, backup_logs, push_subscriptions, inventaris_unit, inventaris_kode,
    health_profiles, riwayat_kamar,
    audit_logs, agendas, achievements, correspondences, permits, violations,
    poskestren_records, attendances, kegiatan_grup_anggota, kegiatan_grup,
    ekskul_agenda, ekskul_anggota, ekstrakurikuler, riwayat_jabatan,
    periode_jabatan, users, students, kategori_ekskul, teachers, families,
    rooms, classes;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- 1. DATA INDUK (harus diisi lebih dulu, tidak bergantung tabel lain)
-- ---------------------------------------------------------------------

CREATE TABLE classes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama VARCHAR(50) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE rooms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama_kamar VARCHAR(50) NOT NULL,
    gedung VARCHAR(50) NOT NULL,
    gender ENUM('L','P') NOT NULL
) ENGINE=InnoDB;

CREATE TABLE families (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama_ayah VARCHAR(100),
    nama_ibu VARCHAR(100),
    no_hp VARCHAR(20)
) ENGINE=InnoDB;

CREATE TABLE teachers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nip VARCHAR(30) UNIQUE,
    nama VARCHAR(100) NOT NULL,
    jenis_kelamin ENUM('L','P'),
    no_hp VARCHAR(20),
    wali_kamar_room_id INT NULL,   -- kamar yang diampu sbg wali kamar (opsional)
    FOREIGN KEY (wali_kamar_room_id) REFERENCES rooms(id)
) ENGINE=InnoDB;

CREATE TABLE kategori_ekskul (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama VARCHAR(50) NOT NULL   -- Olahraga, Kesenian
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. DATA SANTRI (id auto-increment sbg Primary Key, NIS jadi kolom UNIQUE
--    terpisah -- lihat diskusi kenapa NIS tidak dipakai sbg Primary Key)
-- ---------------------------------------------------------------------

CREATE TABLE students (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nis VARCHAR(20) UNIQUE NOT NULL,
    nama VARCHAR(100) NOT NULL,
    jenis_kelamin ENUM('L','P') NOT NULL,
    tempat_lahir VARCHAR(50),
    tanggal_lahir DATE,
    tanggal_masuk DATE,
    class_id INT,
    room_id INT,
    family_id INT,
    status ENUM('aktif','alumni','keluar') DEFAULT 'aktif',
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (room_id) REFERENCES rooms(id),
    FOREIGN KEY (family_id) REFERENCES families(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. USER & AKSES SISTEM
--    Hanya santri yang menjabat (punya_akses_sistem = 1 di riwayat_jabatan)
--    yang punya baris di tabel ini. Login pakai email (NIS)@daarululuumlido.com
-- ---------------------------------------------------------------------

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,     -- disimpan hash (password_hash Bcrypt)
    student_id INT NULL,                -- NULL khusus utk super admin non-santri
    nama VARCHAR(100) NOT NULL,
    is_super_admin TINYINT(1) DEFAULT 0,
    status ENUM('aktif','nonaktif') DEFAULT 'aktif',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 4. MASA JABATAN / KHIDMAT (bukan tahun ajaran)
-- ---------------------------------------------------------------------

CREATE TABLE periode_jabatan (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama_periode VARCHAR(100) NOT NULL,
    tanggal_mulai DATE NOT NULL,
    tanggal_selesai DATE NULL,
    status ENUM('aktif','arsip') DEFAULT 'aktif'
) ENGINE=InnoDB;

CREATE TABLE riwayat_jabatan (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    periode_id INT NOT NULL,
    posisi VARCHAR(100) NOT NULL,       -- nama jabatan yang tampil ke user
    role_key VARCHAR(50) NOT NULL,      -- kunci teknis utk RBAC di kode PHP
    punya_akses_sistem TINYINT(1) DEFAULT 0,
    tanggal_mulai DATE,
    tanggal_selesai DATE,
    status ENUM('aktif','arsip') DEFAULT 'aktif',
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (periode_id) REFERENCES periode_jabatan(id)
) ENGINE=InnoDB;

-- role_key yang dipakai kode PHP (bebas ditambah sesuai kebutuhan):
--   super_admin, admin, sekretaris, sekretaris_mahkamah, hakim,
--   asisten_poskestren, dokter, piket, pelatih

-- ---------------------------------------------------------------------
-- 5. EKSTRAKURIKULER
-- ---------------------------------------------------------------------

CREATE TABLE ekstrakurikuler (
    id INT AUTO_INCREMENT PRIMARY KEY,
    kategori_id INT NOT NULL,
    nama VARCHAR(100) NOT NULL,
    pelatih_id INT NULL,                -- FK ke teachers, bukan tabel terpisah
    FOREIGN KEY (kategori_id) REFERENCES kategori_ekskul(id),
    FOREIGN KEY (pelatih_id) REFERENCES teachers(id)
) ENGINE=InnoDB;

CREATE TABLE ekskul_anggota (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ekskul_id INT NOT NULL,
    student_id INT NOT NULL,
    tanggal_gabung DATE,
    tanggal_keluar DATE NULL,
    status ENUM('aktif','nonaktif') DEFAULT 'aktif',
    FOREIGN KEY (ekskul_id) REFERENCES ekstrakurikuler(id),
    FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB;

CREATE TABLE ekskul_agenda (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ekskul_id INT NOT NULL,
    tanggal DATE NOT NULL,
    keterangan VARCHAR(255),
    FOREIGN KEY (ekskul_id) REFERENCES ekstrakurikuler(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 6. GRUP KEGIATAN (Halaqah Qur'an & Muhadhoroh)
--    Pola sama dengan ekskul_anggota: absensi non-kamar butuh grup
--    keanggotaan tersendiri per kegiatan.
-- ---------------------------------------------------------------------

CREATE TABLE kegiatan_grup (
    id INT AUTO_INCREMENT PRIMARY KEY,
    jenis_kegiatan ENUM('halaqah','muhadhoroh') NOT NULL,
    nama_grup VARCHAR(100) NOT NULL,
    pembimbing_id INT NULL,
    FOREIGN KEY (pembimbing_id) REFERENCES teachers(id)
) ENGINE=InnoDB;

CREATE TABLE kegiatan_grup_anggota (
    id INT AUTO_INCREMENT PRIMARY KEY,
    grup_id INT NOT NULL,
    student_id INT NOT NULL,
    status ENUM('aktif','nonaktif') DEFAULT 'aktif',
    FOREIGN KEY (grup_id) REFERENCES kegiatan_grup(id),
    FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 7. ABSENSI
--    jenis_kegiatan: harian (basis kamar) / halaqah / muhadhoroh /
--    olahraga / kesenian (basis grup ekskul)
-- ---------------------------------------------------------------------

CREATE TABLE attendances (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    tanggal DATE NOT NULL,
    jenis_kegiatan ENUM('harian','halaqah','muhadhoroh','olahraga','kesenian') NOT NULL,
    status ENUM('hadir','sakit','izin','pulang','alpha') DEFAULT 'hadir',
    keterangan VARCHAR(255),
    UNIQUE KEY uniq_absensi (student_id, tanggal, jenis_kegiatan),
    FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 8. POSKESTREN
--    rawat_jalan = konsultasi saja (tidak ubah status absensi)
--    perawatan   = sakit sungguhan (status absensi hari itu jadi "Sakit")
--    Tidak ada mekanisme "pasien aktif": status sakit cuma berlaku
--    utk tanggal itu saja, direset otomatis besoknya via attendances.
-- ---------------------------------------------------------------------

CREATE TABLE poskestren_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    tanggal DATE NOT NULL,
    keluhan VARCHAR(255) NOT NULL,
    jenis_kunjungan ENUM('rawat_jalan','perawatan') NOT NULL,
    diagnosa TEXT NULL,
    resep TEXT NULL,
    tindak_lanjut TEXT NULL,
    dicatat_oleh INT NULL,              -- user id asisten
    diperiksa_oleh INT NULL,            -- user id dokter
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (dicatat_oleh) REFERENCES users(id),
    FOREIGN KEY (diperiksa_oleh) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 9. MAHKAMAH SANTRI
-- ---------------------------------------------------------------------

CREATE TABLE violations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    kategori VARCHAR(100) NOT NULL,
    keterangan TEXT,
    tanggal DATE NOT NULL,
    status ENUM('menunggu','ringan','sedang','berat','dibatalkan') DEFAULT 'menunggu',
    alasan_pembatalan TEXT NULL,        -- diisi kalau "pemutihan" (soft-delete)
    dicatat_oleh INT NULL,              -- user id sekretaris
    divonis_oleh INT NULL,              -- user id hakim
    tanggal_vonis DATETIME NULL,
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (dicatat_oleh) REFERENCES users(id),
    FOREIGN KEY (divonis_oleh) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 10. PERIZINAN & KAMTIB
-- ---------------------------------------------------------------------

CREATE TABLE permits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    jenis ENUM('keluar_sementara','izin_dinas','pulang') NOT NULL,
    tanggal_mulai DATE NOT NULL,
    jam_mulai TIME NULL,             -- diisi utk keluar_sementara (otomatis) & izin_dinas
    tanggal_selesai DATE NOT NULL,
    jam_selesai TIME NULL,           -- diisi utk keluar_sementara & izin_dinas; NULL utk pulang
    keterangan VARCHAR(255),
    status ENUM('berjalan','selesai','overdue') DEFAULT 'berjalan',
    tanggal_konfirmasi_kembali DATETIME NULL,
    FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 11. KORESPONDENSI
--     Format nomor surat keluar: {urut}/PONTREN-HISADA/{bulan_romawi}/{tahun}
-- ---------------------------------------------------------------------

CREATE TABLE correspondences (
    id INT AUTO_INCREMENT PRIMARY KEY,
    jenis ENUM('masuk','keluar') NOT NULL,
    nomor_surat VARCHAR(60) UNIQUE NOT NULL,
    perihal VARCHAR(255),
    tanggal DATE NOT NULL,
    dari_instansi VARCHAR(150) NULL,        -- diisi utk surat masuk
    tujuan VARCHAR(150) NULL,               -- diisi utk surat keluar
    status_disposisi ENUM('belum_dibaca','diteruskan','disetujui','diarsipkan') NULL,
    link_lampiran VARCHAR(255),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 12. PRESTASI SANTRI
-- ---------------------------------------------------------------------

CREATE TABLE achievements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    nama_kegiatan VARCHAR(150) NOT NULL,
    lokasi VARCHAR(150),
    tingkat ENUM('internal','eksternal') NOT NULL,
    keterangan TEXT,
    tanggal DATE,
    FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 13. KALENDER AKADEMIK
--     Bisa pilih 2 kategori sekaligus (kolom terpisah tinyint, bukan enum
--     tunggal, supaya kombinasi umum+akademik / umum+pengasuhan bisa)
-- ---------------------------------------------------------------------

CREATE TABLE agendas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tanggal DATE NOT NULL,
    judul VARCHAR(150) NOT NULL,
    keterangan TEXT,
    kategori_umum TINYINT(1) DEFAULT 0,
    kategori_akademik TINYINT(1) DEFAULT 0,
    kategori_pengasuhan TINYINT(1) DEFAULT 0,
    dibuat_oleh INT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dibuat_oleh) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 14. AUDIT LOG
-- ---------------------------------------------------------------------

CREATE TABLE audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    aksi VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 15. RIWAYAT MUTASI KAMAR
--     Pola sama dgn riwayat_jabatan: pindah kamar tidak menimpa data
--     lama, tapi diarsipkan (tanggal_selesai diisi, status jadi arsip).
-- ---------------------------------------------------------------------

CREATE TABLE riwayat_kamar (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    room_id INT NOT NULL,
    tanggal_mulai DATE NOT NULL,
    tanggal_selesai DATE NULL,
    status ENUM('aktif','arsip') DEFAULT 'aktif',
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (room_id) REFERENCES rooms(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 16. PROFIL KESEHATAN TETAP
--     Terpisah dari poskestren_records (yg isinya log KEJADIAN sakit) --
--     ini data PERMANEN yg dirujuk otomatis tiap dokter buka rekam medis.
-- ---------------------------------------------------------------------

CREATE TABLE health_profiles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL UNIQUE,
    golongan_darah ENUM('A','B','AB','O','Tidak Tahu') DEFAULT 'Tidak Tahu',
    alergi VARCHAR(255) NULL,
    penyakit_kronis VARCHAR(255) NULL,
    catatan_lain TEXT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 18. INVENTARIS BARANG SANTRI (barang titipan)
-- ---------------------------------------------------------------------

CREATE TABLE inventaris_kode (
    id INT AUTO_INCREMENT PRIMARY KEY,
    kode_barang VARCHAR(50) NOT NULL UNIQUE,   -- diketik manual, mis. HSD-DH-EPS
    nama_barang VARCHAR(150) NOT NULL,
    jumlah INT NOT NULL DEFAULT 1,
    keterangan VARCHAR(255),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Satu baris di sini = SATU UNIT fisik dari suatu kode barang. Kalau
-- jumlah=2, ada 2 baris inventaris_unit yg terhubung ke 1 inventaris_kode
-- yg sama -- masing-masing unit bisa beda kategori (lama/baru) & tingkat
-- kondisinya sendiri (bagus/rusak ringan/rusak berat/hilang).
CREATE TABLE inventaris_unit (
    id INT AUTO_INCREMENT PRIMARY KEY,
    inventaris_kode_id INT NOT NULL,
    kategori ENUM('lama','baru') NOT NULL,
    tingkat ENUM('bagus','rusak_ringan','rusak_berat','hilang') NOT NULL DEFAULT 'bagus',
    FOREIGN KEY (inventaris_kode_id) REFERENCES inventaris_kode(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 19. NOTIFIKASI WEB PUSH (subscription browser per user)
-- ---------------------------------------------------------------------

CREATE TABLE push_subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh VARCHAR(255) NOT NULL,
    auth VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 20. LOG BACKUP
-- ---------------------------------------------------------------------

CREATE TABLE backup_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    waktu DATETIME DEFAULT CURRENT_TIMESTAMP,
    status ENUM('berhasil','gagal') NOT NULL,
    keterangan VARCHAR(255)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 22. PENGATURAN (key-value sederhana, mis. URL Google Apps Script)
-- ---------------------------------------------------------------------

CREATE TABLE pengaturan (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama_setting VARCHAR(100) NOT NULL UNIQUE,
    nilai TEXT
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 21. PORTAL WALI SANTRI (akun terpisah dari users -- bukan pengurus)
--     Login berbasis keluarga (family_id), bukan santri per orang --
--     satu akun wali bisa melihat semua anaknya (kalau lebih dari 1).
-- ---------------------------------------------------------------------

CREATE TABLE wali_akses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    family_id INT NOT NULL UNIQUE,
    username VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    status ENUM('aktif','nonaktif') DEFAULT 'aktif',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (family_id) REFERENCES families(id)
) ENGINE=InnoDB;

-- =====================================================================
-- DATA AWAL (SEED) -- supaya sistem bisa langsung dicoba
-- =====================================================================

INSERT INTO classes (nama) VALUES ('Kelas 1'),('Kelas 2'),('Kelas 3'),('Kelas 4'),('Kelas 5'),('Kelas 6');

INSERT INTO rooms (nama_kamar, gedung, gender) VALUES
('Al-Falah 1','Gedung Al-Falah','L'),
('Al-Falah 2','Gedung Al-Falah','L'),
('Al-Badr 1','Gedung Al-Badr','P'),
('Al-Badr 2','Gedung Al-Badr','P');

INSERT INTO families (nama_ayah, nama_ibu, no_hp) VALUES
('Bapak Ahmad','Ibu Siti','081200000001'),
('Bapak Yusuf','Ibu Aminah','081200000002');

INSERT INTO teachers (nip, nama, jenis_kelamin, no_hp) VALUES
('T001','Ust. Fauzan','L','081300000001'),
('T002','Usth. Halimah','P','081300000002'),
('T003','dr. Rizki','L','081300000003');

INSERT INTO kategori_ekskul (nama) VALUES ('Olahraga'),('Kesenian');

INSERT INTO ekstrakurikuler (kategori_id, nama, pelatih_id) VALUES
(1,'Futsal',1),
(1,'Silat',1),
(2,'Hadroh',2),
(2,'Kaligrafi',2);

INSERT INTO kegiatan_grup (jenis_kegiatan, nama_grup, pembimbing_id) VALUES
('halaqah','Halaqah A',1),
('halaqah','Halaqah B',2),
('muhadhoroh','Muhadhoroh Putra',1),
('muhadhoroh','Muhadhoroh Putri',2);

INSERT INTO students (nis, nama, jenis_kelamin, tempat_lahir, tanggal_lahir, tanggal_masuk, class_id, room_id, family_id, status) VALUES
('2024001','Muhammad Fajar','L','Bogor','2012-01-10','2024-07-01',5,1,1,'aktif'),
('2024002','Nurul Aisyah','P','Bogor','2012-03-15','2024-07-01',5,3,2,'aktif'),
('2024003','Rizky Ramadhan','L','Depok','2011-11-20','2023-07-01',6,2,1,'aktif');

INSERT INTO kegiatan_grup_anggota (grup_id, student_id, status) VALUES
(1, 1, 'aktif'), (1, 3, 'aktif'), (3, 1, 'aktif'), (3, 3, 'aktif'),
(2, 2, 'aktif'), (4, 2, 'aktif');

INSERT INTO ekskul_anggota (ekskul_id, student_id, tanggal_gabung, status) VALUES
(1, 1, '2025-07-01', 'aktif'),
(3, 2, '2025-07-01', 'aktif');

-- Masa khidmat aktif
INSERT INTO periode_jabatan (nama_periode, tanggal_mulai, tanggal_selesai, status) VALUES
('Khidmat 2025/2026','2025-07-01',NULL,'aktif');

-- Jabatan contoh (student_id 1 = Sekretaris Mahkamah, 3 = Hakim) dgn akses sistem
INSERT INTO riwayat_jabatan (student_id, periode_id, posisi, role_key, punya_akses_sistem, tanggal_mulai, status) VALUES
(1, 1, 'Sekretaris Mahkamah', 'sekretaris_mahkamah', 1, '2025-07-01', 'aktif'),
(3, 1, 'Hakim Mahkamah', 'hakim', 1, '2025-07-01', 'aktif'),
(2, 1, 'Asisten Poskestren', 'asisten_poskestren', 1, '2025-07-01', 'aktif');

-- Akun user: password default untuk semua akun contoh = "hisada123"
-- (hash di bawah adalah hasil password_hash('hisada123', PASSWORD_BCRYPT) yang
-- SUDAH DIUJI valid dengan password_verify() -- tidak perlu lagi menjalankan
-- reset_password.php kecuali kamu ingin mengganti passwordnya sendiri)
INSERT INTO users (email, password, student_id, nama, is_super_admin, status) VALUES
('admin@daarululuumlido.com', '$2y$10$mOK/1ovGZHeLo/436DHsw.FKLnWkP2kqnrQVfrK8kWvkYYAOQ6bOa', NULL, 'Super Admin', 1, 'aktif'),
('2024001@daarululuumlido.com', '$2y$10$mOK/1ovGZHeLo/436DHsw.FKLnWkP2kqnrQVfrK8kWvkYYAOQ6bOa', 1, 'Muhammad Fajar', 0, 'aktif'),
('2024003@daarululuumlido.com', '$2y$10$mOK/1ovGZHeLo/436DHsw.FKLnWkP2kqnrQVfrK8kWvkYYAOQ6bOa', 3, 'Rizky Ramadhan', 0, 'aktif'),
('2024002@daarululuumlido.com', '$2y$10$mOK/1ovGZHeLo/436DHsw.FKLnWkP2kqnrQVfrK8kWvkYYAOQ6bOa', 2, 'Nurul Aisyah', 0, 'aktif');

-- CATATAN: hash password contoh di atas SUDAH DIUJI valid (password_verify()
-- mengembalikan true untuk "hisada123") dan bisa langsung dipakai login tanpa
-- langkah tambahan apapun. Hash bcrypt bersifat portable -- tidak bergantung
-- server tempat ia dibuat. Jalankan reset_password.php HANYA jika kamu ingin
-- mengganti password akun contoh ke sesuatu selain "hisada123".
