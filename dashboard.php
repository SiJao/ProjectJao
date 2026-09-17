<?php
/**
 * DASHBOARD.PHP -- satu pintu masuk untuk SELURUH modul Hisada.
 * Navigasi antar modul lewat parameter ?modul=xxx (bukan file terpisah).
 * Struktur tiap modul: (1) cek akses role, (2) proses POST/redirect
 * SEBELUM ada output HTML, (3) siapkan data SELECT, (4) render di bagian
 * bawah file lewat switch kedua. Ini supaya header('Location:...') tetap
 * bisa jalan (tidak ada output sebelumnya), sama seperti saat modul-modul
 * ini masih berupa file terpisah.
 */
require_once __DIR__ . '/includes/auth.php';
$user = current_user();
require_login();

// --------------------------------------------------------------------
// 0. ROUTING & HAK AKSES PER MODUL
// --------------------------------------------------------------------
$moduleAccess = [
    'home'                => null,   // login saja
    'kalender'            => null,   // login saja (input agenda dicek manual di dalam)
    'cari_santri'         => null,   // login saja -- cari data santri
    'cari_guru'           => null,   // login saja -- cari data guru
    'absensi'             => ['piket'],
    'absensi_kamar'       => ['piket'],
    'absensi_kegiatan'    => ['piket'],
    'poskestren_asisten'  => ['asisten_poskestren'],
    'poskestren_dokter'   => ['dokter'],
    'mahkamah_sekretaris' => ['sekretaris_mahkamah'],
    'mahkamah_hakim'      => ['hakim'],
    'perizinan'           => ['piket'],
    'korespondensi'       => ['sekretaris'],
    'prestasi'            => ['sekretaris'],
    'kelola_user'         => [],     // [] -> require_role selalu meloloskan Super Admin saja
    'serah_terima'        => [],
    'data_master'         => [],     // super admin -- kelola kelas/kamar/keluarga/guru/santri + import CSV
    'history'             => [],     // super admin -- riwayat perubahan (audit log)
    'inventaris'          => ['sekretaris'],
    'rapor'               => ['sekretaris'],
    'backup'              => [],     // super admin
    'notif_count'         => null,   // login saja -- endpoint JSON polling notifikasi
];

/**
 * DateTime::format('F') SELALU mengembalikan nama bulan Inggris, apa pun
 * locale server -- ini keterbatasan PHP, bukan bisa diperbaiki via
 * setlocale(). Jadi nama bulan Indonesia diterjemahkan manual di sini.
 */
function nama_bulan_indo(string $namaInggris): string
{
    $peta = [
        'January' => 'Januari', 'February' => 'Februari', 'March' => 'Maret',
        'April' => 'April', 'May' => 'Mei', 'June' => 'Juni', 'July' => 'Juli',
        'August' => 'Agustus', 'September' => 'September', 'October' => 'Oktober',
        'November' => 'November', 'December' => 'Desember',
    ];
    return $peta[$namaInggris] ?? $namaInggris;
}

/**
 * Kirim satu tabel (header + baris) sbg JSON ke Google Apps Script Web App
 * yang berfungsi sbg jembatan ke Google Spreadsheet. Pakai file_get_contents
 * + stream context (BUKAN ekstensi curl) supaya tetap jalan di hosting yg
 * curl-nya tidak aktif -- cukup butuh allow_url_fopen (biasanya aktif
 * default). Lihat google-apps-script/BackupSpreadsheet.gs utk skrip
 * penerimanya.
 */
function kirim_ke_google_sheets(string $url, string $kunci, string $tabel, array $header, array $baris): array
{
    $payload = json_encode(['kunci' => $kunci, 'tabel' => $tabel, 'header' => $header, 'baris' => $baris]);
    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\n",
            'content' => $payload,
            'timeout' => 30,
            'ignore_errors' => true, // supaya tetap bisa baca body respons walau HTTP status bukan 200
        ],
    ]);
    $hasil = @file_get_contents($url, false, $context);
    if ($hasil === false) {
        return ['ok' => false, 'pesan' => 'Gagal menghubungi URL Apps Script (cek URL & koneksi server).'];
    }
    $decoded = json_decode($hasil, true);
    if (!is_array($decoded)) {
        return ['ok' => false, 'pesan' => 'Respons tidak valid dari Apps Script: ' . substr($hasil, 0, 200)];
    }
    return $decoded;
}

/**
 * Export data ke file .xlsx ASLI (bukan CSV) tanpa Composer/PhpSpreadsheet
 * -- cukup pakai ekstensi ZipArchive bawaan PHP + XML minimal, karena
 * format .xlsx pada dasarnya cuma file ZIP berisi beberapa XML.
 * $headers: array nama kolom. $rows: array of array (baris data, urutan
 * kolom harus sama dgn $headers). Langsung stream sbg download & exit.
 */
function export_xlsx(string $namaFile, array $headers, array $rows): void
{
    $escXml = fn($v) => htmlspecialchars((string) $v, ENT_XML1 | ENT_QUOTES, 'UTF-8');

    $sheetRows = '';
    $rowNum = 1;
    $sheetRows .= '<row r="' . $rowNum . '">';
    foreach ($headers as $i => $h) {
        $col = chr(65 + $i);
        $sheetRows .= '<c r="' . $col . $rowNum . '" t="inlineStr"><is><t>' . $escXml($h) . '</t></is></c>';
    }
    $sheetRows .= '</row>';
    foreach ($rows as $row) {
        $rowNum++;
        $sheetRows .= '<row r="' . $rowNum . '">';
        foreach (array_values($row) as $i => $val) {
            $col = chr(65 + $i);
            $sheetRows .= '<c r="' . $col . $rowNum . '" t="inlineStr"><is><t>' . $escXml($val ?? '') . '</t></is></c>';
        }
        $sheetRows .= '</row>';
    }

    $sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        . '<sheetData>' . $sheetRows . '</sheetData></worksheet>';

    $contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        . '<Default Extension="xml" ContentType="application/xml"/>'
        . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        . '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        . '</Types>';

    $rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        . '</Relationships>';

    $workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        . '<sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>';

    $workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        . '</Relationships>';

    $tmpFile = tempnam(sys_get_temp_dir(), 'xlsx_');
    $zip = new ZipArchive();
    $zip->open($tmpFile, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    $zip->addFromString('[Content_Types].xml', $contentTypes);
    $zip->addFromString('_rels/.rels', $rootRels);
    $zip->addFromString('xl/workbook.xml', $workbookXml);
    $zip->addFromString('xl/_rels/workbook.xml.rels', $workbookRels);
    $zip->addFromString('xl/worksheets/sheet1.xml', $sheetXml);
    $zip->close();

    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $namaFile . '.xlsx"');
    header('Content-Length: ' . filesize($tmpFile));
    readfile($tmpFile);
    unlink($tmpFile);
    exit;
}

/**
 * Render komponen "pilih santri" (ketik nama/NIS, klik saran) sebagai
 * pengganti <select> dropdown panjang. $name jadi nama field yang dikirim
 * saat submit (persis seperti dulu name="student_id"), jadi kode
 * pemrosesan $_POST di bawah TIDAK perlu berubah sama sekali.
 */
function render_santri_picker(string $name, array $students, string $idPrefix, string $placeholder = 'Ketik nama atau NIS santri...'): void
{
    $dataJson = json_encode(array_map(fn($s) => ['id' => $s['id'], 'nis' => $s['nis'], 'nama' => $s['nama']], $students));
    ?>
    <div class="santri-picker" id="picker_<?= htmlspecialchars($idPrefix) ?>">
        <input type="text" class="form-control form-control-sm sp-input" placeholder="<?= htmlspecialchars($placeholder) ?>" autocomplete="off">
        <input type="hidden" name="<?= htmlspecialchars($name) ?>" class="sp-value" required>
        <div class="sp-suggestions"></div>
    </div>
    <script>
    attachSantriPicker(document.getElementById('picker_<?= htmlspecialchars($idPrefix) ?>'), <?= $dataJson ?>);
    </script>
    <?php
}

$modul = $_GET['modul'] ?? 'home';
if (!array_key_exists($modul, $moduleAccess)) {
    $modul = 'home';
}
if ($moduleAccess[$modul] === null) {
    require_login();
} else {
    require_role($moduleAccess[$modul]);
}

$page_title = 'Dashboard';
$success = null;
$error   = null;

// ======================================================================
// MODUL: HOME (statistik dashboard)
// ======================================================================
if ($modul === 'home') {
    $page_title = 'Dashboard';

    $stat = $pdo->query("
        SELECT SUM(jenis_kelamin='L') AS laki, SUM(jenis_kelamin='P') AS perempuan, COUNT(*) AS total
        FROM students WHERE status = 'aktif'
    ")->fetch();

    $sakitBulanIni = $pdo->query("
        SELECT COUNT(DISTINCT student_id) AS jml FROM attendances
        WHERE status = 'sakit' AND tanggal >= (CURDATE() - INTERVAL 30 DAY)
    ")->fetch()['jml'] ?? 0;

    $statusPulang = $pdo->query("
        SELECT COUNT(*) AS jml FROM attendances WHERE status = 'pulang' AND tanggal = CURDATE()
    ")->fetch()['jml'] ?? 0;

    $statusAlpha = $pdo->query("
        SELECT COUNT(*) AS jml FROM attendances WHERE status = 'alpha' AND tanggal = CURDATE()
    ")->fetch()['jml'] ?? 0;

    $upcoming = $pdo->query("
        SELECT * FROM agendas WHERE tanggal >= CURDATE() ORDER BY tanggal ASC LIMIT 5
    ")->fetchAll();
}

// ======================================================================
// MODUL: NOTIF_COUNT -- endpoint JSON polling notifikasi (fallback ringan
// menggantikan Web Push yang butuh enkripsi rumit; ini yg SUNGGUH bisa
// diuji & jalan tanpa perlu browser sungguhan/HTTPS/dsb.). Dipanggil via
// AJAX oleh sidebar setiap 30 detik.
// ======================================================================
elseif ($modul === 'notif_count') {
    header('Content-Type: application/json');
    $jml = 0;
    $pesan = '';
    if ($user['is_super_admin'] || $user['role_key'] === 'hakim') {
        $n = (int) $pdo->query("SELECT COUNT(*) FROM violations WHERE status='menunggu'")->fetchColumn();
        if ($n > 0) { $jml += $n; $pesan .= "$n pelanggaran menunggu sidang. "; }
    }
    if ($user['is_super_admin'] || $user['role_key'] === 'dokter') {
        $n = (int) $pdo->query("SELECT COUNT(*) FROM poskestren_records WHERE diperiksa_oleh IS NULL")->fetchColumn();
        if ($n > 0) { $jml += $n; $pesan .= "$n santri menunggu diperiksa dokter. "; }
    }
    if ($user['is_super_admin'] || $user['role_key'] === 'piket') {
        $n = (int) $pdo->query("SELECT COUNT(*) FROM permits WHERE status='overdue'")->fetchColumn();
        if ($n > 0) { $jml += $n; $pesan .= "$n santri overdue perizinan. "; }
    }
    echo json_encode(['jumlah' => $jml, 'pesan' => trim($pesan)]);
    exit;
}

// ======================================================================
// MODUL: ABSENSI -- kartu pilihan
// ======================================================================
elseif ($modul === 'absensi') {
    $page_title = 'Absensi';
}

// ======================================================================
// MODUL: ABSENSI HARIAN (KAMAR)
// ======================================================================
elseif ($modul === 'absensi_kamar') {
    $page_title = 'Absensi Harian (Kamar)';

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $tanggal = $_POST['tanggal'];
        $stmt = $pdo->prepare("
            INSERT INTO attendances (student_id, tanggal, jenis_kegiatan, status, keterangan)
            VALUES (:sid, :tgl, 'harian', :status, :ket)
            ON DUPLICATE KEY UPDATE status = VALUES(status), keterangan = VALUES(keterangan)
        ");
        foreach ($_POST['status'] as $studentId => $status) {
            $stmt->execute([
                'sid' => $studentId, 'tgl' => $tanggal, 'status' => $status,
                'ket' => $_POST['keterangan'][$studentId] ?? null,
            ]);
        }
        log_audit($pdo, $user['id'], "Input absensi harian kamar tanggal $tanggal");
        $success = 'Absensi berhasil disimpan.';
    }

    $rooms   = $pdo->query('SELECT id, nama_kamar, gedung FROM rooms ORDER BY gedung, nama_kamar')->fetchAll();
    $roomId  = $_GET['room_id'] ?? null;
    $tanggal = $_GET['tanggal'] ?? date('Y-m-d');
    $students = [];
    if ($roomId) {
        $stmt = $pdo->prepare("
            SELECT s.id, s.nis, s.nama, a.status, a.keterangan
            FROM students s
            LEFT JOIN attendances a ON a.student_id = s.id AND a.tanggal = :tgl AND a.jenis_kegiatan = 'harian'
            WHERE s.room_id = :rid AND s.status = 'aktif'
            ORDER BY s.nama
        ");
        $stmt->execute(['rid' => $roomId, 'tgl' => $tanggal]);
        $students = $stmt->fetchAll();
    }

    if (isset($_GET['export']) && $_GET['export'] === 'xlsx' && $roomId) {
        $baris = array_map(fn($s) => [$s['nis'], $s['nama'], ucfirst($s['status'] ?? 'hadir'), $s['keterangan'] ?? ''], $students);
        export_xlsx('absensi_kamar_' . $tanggal, ['NIS', 'Nama', 'Status', 'Keterangan'], $baris);
    }
}

// ======================================================================
// MODUL: ABSENSI KEGIATAN (Halaqah/Muhadhoroh/Olahraga/Kesenian)
// ======================================================================
elseif ($modul === 'absensi_kegiatan') {
    $jenis = $_GET['jenis'] ?? '';
    $validJenis = ['halaqah', 'muhadhoroh', 'olahraga', 'kesenian'];
    if (!in_array($jenis, $validJenis, true)) {
        header('Location: dashboard.php?modul=absensi');
        exit;
    }
    $labelJenis = [
        'halaqah' => "Halaqah Qur'an", 'muhadhoroh' => 'Muhadhoroh',
        'olahraga' => 'Olahraga', 'kesenian' => 'Kesenian',
    ][$jenis];
    $page_title = 'Absensi ' . $labelJenis;
    $isEkskul = in_array($jenis, ['olahraga', 'kesenian'], true);

    if ($isEkskul) {
        $stmt = $pdo->prepare("
            SELECT e.id, e.nama FROM ekstrakurikuler e
            JOIN kategori_ekskul k ON e.kategori_id = k.id
            WHERE k.nama = :kategori ORDER BY e.nama
        ");
        $stmt->execute(['kategori' => ucfirst($jenis)]);
    } else {
        $stmt = $pdo->prepare("SELECT id, nama_grup AS nama FROM kegiatan_grup WHERE jenis_kegiatan = :j ORDER BY nama_grup");
        $stmt->execute(['j' => $jenis]);
    }
    $grupList = $stmt->fetchAll();

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $tanggal = $_POST['tanggal'];
        $stmt = $pdo->prepare("
            INSERT INTO attendances (student_id, tanggal, jenis_kegiatan, status, keterangan)
            VALUES (:sid, :tgl, :jenis, :status, :ket)
            ON DUPLICATE KEY UPDATE status = VALUES(status), keterangan = VALUES(keterangan)
        ");
        foreach ($_POST['status'] as $studentId => $status) {
            $stmt->execute([
                'sid' => $studentId, 'tgl' => $tanggal, 'jenis' => $jenis,
                'status' => $status, 'ket' => $_POST['keterangan'][$studentId] ?? null,
            ]);
        }
        log_audit($pdo, $user['id'], "Input absensi $jenis tanggal $tanggal");
        $success = 'Absensi berhasil disimpan.';
    }

    $grupId  = $_GET['grup_id'] ?? null;
    $tanggal = $_GET['tanggal'] ?? date('Y-m-d');
    $students = [];
    if ($grupId) {
        if ($isEkskul) {
            $stmt = $pdo->prepare("
                SELECT s.id, s.nis, s.nama, a.status, a.keterangan
                FROM ekskul_anggota ea
                JOIN students s ON s.id = ea.student_id
                LEFT JOIN attendances a ON a.student_id = s.id AND a.tanggal = :tgl AND a.jenis_kegiatan = :jenis
                WHERE ea.ekskul_id = :gid AND ea.status = 'aktif' AND s.status = 'aktif'
                ORDER BY s.nama
            ");
        } else {
            $stmt = $pdo->prepare("
                SELECT s.id, s.nis, s.nama, a.status, a.keterangan
                FROM kegiatan_grup_anggota ga
                JOIN students s ON s.id = ga.student_id
                LEFT JOIN attendances a ON a.student_id = s.id AND a.tanggal = :tgl AND a.jenis_kegiatan = :jenis
                WHERE ga.grup_id = :gid AND ga.status = 'aktif' AND s.status = 'aktif'
                ORDER BY s.nama
            ");
        }
        $stmt->execute(['gid' => $grupId, 'tgl' => $tanggal, 'jenis' => $jenis]);
        $students = $stmt->fetchAll();
    }
}

// ======================================================================
// MODUL: POSKESTREN -- ASISTEN (input kunjungan)
// ======================================================================
elseif ($modul === 'poskestren_asisten') {
    $page_title = 'Poskestren - Input Kunjungan';

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $studentId = $_POST['student_id'];
        $tanggal   = $_POST['tanggal'];
        $jenis     = $_POST['jenis_kunjungan'];
        $keluhan   = $_POST['keluhan'];

        $stmt = $pdo->prepare("
            INSERT INTO poskestren_records (student_id, tanggal, keluhan, jenis_kunjungan, dicatat_oleh)
            VALUES (:sid, :tgl, :keluhan, :jenis, :uid)
        ");
        $stmt->execute(['sid' => $studentId, 'tgl' => $tanggal, 'keluhan' => $keluhan, 'jenis' => $jenis, 'uid' => $user['id']]);

        if ($jenis === 'perawatan') {
            $pdo->prepare("
                INSERT INTO attendances (student_id, tanggal, jenis_kegiatan, status, keterangan)
                VALUES (:sid, :tgl, 'harian', 'sakit', 'Perawatan Poskestren')
                ON DUPLICATE KEY UPDATE status = 'sakit', keterangan = 'Perawatan Poskestren'
            ")->execute(['sid' => $studentId, 'tgl' => $tanggal]);
        }
        log_audit($pdo, $user['id'], "Input kunjungan Poskestren ($jenis) utk santri #$studentId");
        $success = 'Kunjungan berhasil dicatat.';
    }

    $students = $pdo->query("SELECT id, nis, nama FROM students WHERE status = 'aktif' ORDER BY nama")->fetchAll();
    $riwayat = $pdo->query("
        SELECT p.*, s.nama AS nama_santri, s.nis FROM poskestren_records p
        JOIN students s ON s.id = p.student_id ORDER BY p.created_at DESC LIMIT 20
    ")->fetchAll();
}

// ======================================================================
// MODUL: POSKESTREN -- DOKTER (rekam medis)
// ======================================================================
elseif ($modul === 'poskestren_dokter') {
    $page_title = 'Poskestren - Rekam Medis';

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $id = $_POST['record_id'];
        $stmt = $pdo->prepare("
            UPDATE poskestren_records SET diagnosa = :d, resep = :r, tindak_lanjut = :t, diperiksa_oleh = :uid WHERE id = :id
        ");
        $stmt->execute(['d' => $_POST['diagnosa'], 'r' => $_POST['resep'], 't' => $_POST['tindak_lanjut'], 'uid' => $user['id'], 'id' => $id]);
        log_audit($pdo, $user['id'], "Isi rekam medis Poskestren #$id");
        $success = 'Rekam medis berhasil disimpan.';
    }

    $antrean = $pdo->query("
        SELECT p.*, s.nama AS nama_santri, s.nis FROM poskestren_records p
        JOIN students s ON s.id = p.student_id WHERE p.diperiksa_oleh IS NULL ORDER BY p.created_at ASC
    ")->fetchAll();

    $trenBulanan = $pdo->query("
        SELECT DATE_FORMAT(tanggal,'%Y-%m') AS bulan, COUNT(*) AS jumlah FROM poskestren_records
        WHERE tanggal >= (CURDATE() - INTERVAL 6 MONTH) GROUP BY bulan ORDER BY bulan
    ")->fetchAll();

    $keluhanTerbanyak = $pdo->query("
        SELECT keluhan, COUNT(*) AS jumlah FROM poskestren_records
        WHERE tanggal >= (CURDATE() - INTERVAL 6 MONTH) GROUP BY keluhan ORDER BY jumlah DESC LIMIT 5
    ")->fetchAll();
    $maxJumlah = max(array_column($keluhanTerbanyak, 'jumlah') ?: [1]);
}

// ======================================================================
// MODUL: MAHKAMAH -- SEKRETARIS (input pelanggaran)
// ======================================================================
elseif ($modul === 'mahkamah_sekretaris') {
    $page_title = 'Mahkamah - Input Pelanggaran';
    $kategoriList = ['Kedisiplinan', 'Kebersihan', 'Ibadah', 'Akademik', 'Keamanan'];

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $stmt = $pdo->prepare("
            INSERT INTO violations (student_id, kategori, keterangan, tanggal, dicatat_oleh)
            VALUES (:sid, :kategori, :ket, :tgl, :uid)
        ");
        $stmt->execute([
            'sid' => $_POST['student_id'], 'kategori' => $_POST['kategori'],
            'ket' => $_POST['keterangan'], 'tgl' => $_POST['tanggal'], 'uid' => $user['id'],
        ]);
        log_audit($pdo, $user['id'], 'Input pelanggaran Mahkamah');
        $success = 'Pelanggaran berhasil dicatat, masuk antrean sidang.';
    }

    $students = $pdo->query("SELECT id, nis, nama FROM students WHERE status = 'aktif' ORDER BY nama")->fetchAll();
    $antrean = $pdo->query("
        SELECT v.*, s.nama AS nama_santri, s.nis FROM violations v
        JOIN students s ON s.id = v.student_id WHERE v.status = 'menunggu' ORDER BY v.tanggal DESC
    ")->fetchAll();
}

// ======================================================================
// MODUL: MAHKAMAH -- HAKIM (sidang & vonis)
// ======================================================================
elseif ($modul === 'mahkamah_hakim') {
    $page_title = 'Mahkamah - Sidang & Vonis';

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $id     = $_POST['violation_id'];
        $action = $_POST['action'];
        if ($action === 'vonis') {
            $pdo->prepare("
                UPDATE violations SET status = :status, divonis_oleh = :uid, tanggal_vonis = NOW() WHERE id = :id
            ")->execute(['status' => $_POST['vonis'], 'uid' => $user['id'], 'id' => $id]);
            log_audit($pdo, $user['id'], "Vonis pelanggaran #$id: {$_POST['vonis']}");
        } else {
            $pdo->prepare("
                UPDATE violations SET status='dibatalkan', alasan_pembatalan=:alasan, divonis_oleh=:uid, tanggal_vonis=NOW() WHERE id=:id
            ")->execute(['alasan' => $_POST['alasan_pembatalan'], 'uid' => $user['id'], 'id' => $id]);
            log_audit($pdo, $user['id'], "Pemutihan pelanggaran #$id");
        }
        $success = 'Keputusan berhasil disimpan.';
    }

    $kategoriFilter = $_GET['kategori'] ?? '';
    $sql = "SELECT v.*, s.nama AS nama_santri, s.nis FROM violations v JOIN students s ON s.id=v.student_id WHERE v.status='menunggu'";
    $params = [];
    if ($kategoriFilter !== '') {
        $sql .= ' AND v.kategori = :kategori';
        $params['kategori'] = $kategoriFilter;
    }
    $sql .= ' ORDER BY v.tanggal ASC';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $antrean = $stmt->fetchAll();
    $kategoriList = $pdo->query("SELECT DISTINCT kategori FROM violations WHERE status='menunggu'")->fetchAll(PDO::FETCH_COLUMN);
}

// ======================================================================
// MODUL: PERIZINAN & KAMTIB
// ======================================================================
elseif ($modul === 'perizinan') {
    $page_title = 'Perizinan & Kamtib';

    // -------- Cetak Surat Izin (halaman cetak mandiri, tanpa sidebar) --------
    if (isset($_GET['print'])) {
        $stmtPrint = $pdo->prepare("
            SELECT p.*, s.nama AS nama_santri, s.nis, r.nama_kamar, r.gedung
            FROM permits p JOIN students s ON s.id = p.student_id
            LEFT JOIN rooms r ON r.id = s.room_id
            WHERE p.id = :id
        ");
        $stmtPrint->execute(['id' => $_GET['print']]);
        $suratData = $stmtPrint->fetch();
        if (!$suratData) {
            render_error_page(404, 'Surat Tidak Ditemukan', 'Data perizinan yang ingin dicetak tidak ditemukan.', 'dashboard.php?modul=perizinan');
        }
        $labelJenisSurat = [
            'keluar_sementara' => 'Izin Keluar Sementara',
            'izin_dinas'       => 'Izin Dinas',
            'pulang'           => 'Izin Pulang',
        ][$suratData['jenis']];
        include __DIR__ . '/includes/print_surat_izin.php';
        exit;
    }

    // Deteksi overdue otomatis setiap kali modul ini dibuka -- kalau jenisnya
    // punya jam_selesai (keluar_sementara/izin_dinas), overdue dihitung dari
    // TANGGAL+JAM gabungan, bukan cuma tanggal.
    $overdueList = $pdo->query("
        SELECT * FROM permits
        WHERE status='berjalan'
          AND TIMESTAMP(tanggal_selesai, COALESCE(jam_selesai, '23:59:59')) < NOW()
    ")->fetchAll();
    foreach ($overdueList as $p) {
        $pdo->prepare("UPDATE permits SET status='overdue' WHERE id=:id")->execute(['id' => $p['id']]);
        $pdo->prepare("
            INSERT INTO attendances (student_id, tanggal, jenis_kegiatan, status, keterangan)
            VALUES (:sid, CURDATE(), 'harian', 'alpha', 'Overdue perizinan')
            ON DUPLICATE KEY UPDATE status='alpha', keterangan='Overdue perizinan'
        ")->execute(['sid' => $p['student_id']]);
        $pdo->prepare("
            INSERT INTO violations (student_id, kategori, keterangan, tanggal, dicatat_oleh)
            VALUES (:sid, 'Keamanan', 'Overdue perizinan (tidak konfirmasi kembali tepat waktu)', CURDATE(), NULL)
        ")->execute(['sid' => $p['student_id']]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['form'] ?? '') === 'baru') {
        $jenis = $_POST['jenis'];
        $valid = true;

        if ($jenis === 'keluar_sementara') {
            // Basis JAM, bukan rentang tanggal: dari sekarang (otomatis) s.d.
            // jam yg diinput, semuanya di tanggal hari ini.
            $tglMulai = $tglSelesai = date('Y-m-d');
            $jamMulai = date('H:i:s');
            $jamSelesai = $_POST['jam_selesai'] ?: null;
            if (!$jamSelesai) {
                $valid = false;
                $error = 'Jam sampai wajib diisi utk Izin Keluar Sementara.';
            }
        } elseif ($jenis === 'izin_dinas') {
            // Basis TANGGAL + JAM (bisa lintas hari).
            $tglMulai = $_POST['tanggal_mulai_dinas'];
            $tglSelesai = $_POST['tanggal_selesai_dinas'];
            $jamMulai = $_POST['jam_mulai_dinas'] ?: '00:00:00';
            $jamSelesai = $_POST['jam_selesai_dinas'] ?: '23:59:59';
            if (strtotime("$tglSelesai $jamSelesai") < strtotime("$tglMulai $jamMulai")) {
                $valid = false;
                $error = 'Waktu selesai tidak boleh sebelum waktu mulai.';
            }
        } else { // pulang -- basis TANGGAL saja
            $tglMulai = $_POST['tanggal_mulai_pulang'];
            $tglSelesai = $_POST['tanggal_selesai_pulang'];
            $jamMulai = $jamSelesai = null;
            if (strtotime($tglSelesai) < strtotime($tglMulai)) {
                $valid = false;
                $error = 'Tanggal selesai tidak boleh sebelum tanggal mulai.';
            }
        }

        if ($valid) {
            $stmtIns = $pdo->prepare("
                INSERT INTO permits (student_id, jenis, tanggal_mulai, jam_mulai, tanggal_selesai, jam_selesai, keterangan, status)
                VALUES (:sid, :jenis, :tm, :jm, :ts, :js, :ket, 'berjalan')
            ");
            $stmtIns->execute([
                'sid' => $_POST['student_id'], 'jenis' => $jenis, 'tm' => $tglMulai, 'jm' => $jamMulai,
                'ts' => $tglSelesai, 'js' => $jamSelesai, 'ket' => $_POST['keterangan'],
            ]);
            $permitIdBaru = $pdo->lastInsertId();

            $statusAbsen = $jenis === 'pulang' ? 'pulang' : 'izin';
            $mulai = new DateTime($tglMulai);
            $selesai = new DateTime($tglSelesai);
            $up = $pdo->prepare("
                INSERT INTO attendances (student_id, tanggal, jenis_kegiatan, status, keterangan)
                VALUES (:sid, :tgl, 'harian', :status, 'Perizinan')
                ON DUPLICATE KEY UPDATE status=VALUES(status), keterangan='Perizinan'
            ");
            for ($d = clone $mulai; $d <= $selesai; $d->modify('+1 day')) {
                $up->execute(['sid' => $_POST['student_id'], 'tgl' => $d->format('Y-m-d'), 'status' => $statusAbsen]);
            }
            log_audit($pdo, $user['id'], "Input perizinan baru ($jenis)");
            $success = 'Data berhasil disimpan.';
        }
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['form'] ?? '') === 'konfirmasi') {
        $pdo->prepare("UPDATE permits SET status='selesai', tanggal_konfirmasi_kembali=NOW() WHERE id=:id")
            ->execute(['id' => $_POST['permit_id']]);
        log_audit($pdo, $user['id'], 'Konfirmasi kembali perizinan #' . $_POST['permit_id']);
        $success = 'Data berhasil disimpan.';
    }

    $students = $pdo->query("SELECT id, nis, nama FROM students WHERE status='aktif' ORDER BY nama")->fetchAll();
    $berjalan = $pdo->query("
        SELECT p.*, s.nama AS nama_santri, s.nis FROM permits p JOIN students s ON s.id=p.student_id
        WHERE p.status IN ('berjalan','overdue') ORDER BY p.tanggal_selesai ASC
    ")->fetchAll();
}

// ======================================================================
// MODUL: KORESPONDENSI
// ======================================================================
elseif ($modul === 'korespondensi') {
    $page_title = 'Korespondensi';

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $jenis = $_POST['jenis'];
        if ($jenis === 'keluar') {
            $nomor = trim($_POST['nomor_surat']);
            if ($nomor === '') {
                $error = 'Nomor surat wajib diisi.';
            } else {
                try {
                    $pdo->prepare("
                        INSERT INTO correspondences (jenis, nomor_surat, perihal, tanggal, tujuan, link_lampiran)
                        VALUES ('keluar', :nomor, :perihal, :tanggal, :tujuan, :link)
                    ")->execute([
                        'nomor' => $nomor, 'perihal' => $_POST['perihal'], 'tanggal' => $_POST['tanggal'],
                        'tujuan' => $_POST['tujuan'], 'link' => $_POST['link_lampiran'],
                    ]);
                    log_audit($pdo, $user['id'], "Input surat keluar #$nomor");
                    $success = "Surat keluar tersimpan dengan nomor: $nomor";
                } catch (PDOException $e) {
                    // Kode 23000 = pelanggaran constraint (di sini: UNIQUE nomor_surat).
                    if ($e->getCode() === '23000') {
                        $error = "Nomor surat \"$nomor\" sudah dipakai surat lain. Gunakan nomor yang berbeda.";
                    } else {
                        throw $e;
                    }
                }
            }
        } else {
            $link = $_POST['link_lampiran'];
            if ($link && !preg_match('#^https://docs\.google\.com/document/d/[a-zA-Z0-9_-]+#', $link)) {
                $error = 'Link lampiran harus berupa URL Google Docs resmi.';
            } else {
                $pdo->prepare("
                    INSERT INTO correspondences (jenis, nomor_surat, perihal, tanggal, dari_instansi, status_disposisi, link_lampiran)
                    VALUES ('masuk', :nomor, :perihal, :tanggal, :dari, :disposisi, :link)
                ")->execute([
                    'nomor' => $_POST['nomor_surat'], 'perihal' => $_POST['perihal'], 'tanggal' => $_POST['tanggal'],
                    'dari' => $_POST['dari_instansi'], 'disposisi' => $_POST['status_disposisi'], 'link' => $link,
                ]);
                $success = 'Surat masuk berhasil dicatat.';
            }
        }
        if ($success) {
            log_audit($pdo, $user['id'], "Input surat $jenis");
        }
    }

    $daftarSurat = $pdo->query('SELECT * FROM correspondences ORDER BY id DESC LIMIT 30')->fetchAll();

    if (isset($_GET['export']) && $_GET['export'] === 'xlsx') {
        $baris = array_map(fn($d) => [$d['nomor_surat'], $d['jenis'] === 'keluar' ? 'Keluar' : 'Masuk', $d['perihal'], $d['tanggal'], $d['status_disposisi'] ?? '-'], $daftarSurat);
        export_xlsx('korespondensi_' . date('Ymd'), ['Nomor Surat', 'Jenis', 'Perihal', 'Tanggal', 'Status Disposisi'], $baris);
    }
}

// ======================================================================
// MODUL: PRESTASI SANTRI
// ======================================================================
elseif ($modul === 'prestasi') {
    $page_title = 'Prestasi Santri';

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $pdo->prepare("
            INSERT INTO achievements (student_id, nama_kegiatan, lokasi, tingkat, keterangan, tanggal)
            VALUES (:sid, :nama, :lokasi, :tingkat, :ket, :tgl)
        ")->execute([
            'sid' => $_POST['student_id'], 'nama' => $_POST['nama_kegiatan'], 'lokasi' => $_POST['lokasi'],
            'tingkat' => $_POST['tingkat'], 'ket' => $_POST['keterangan'], 'tgl' => $_POST['tanggal'],
        ]);
        log_audit($pdo, $user['id'], 'Input prestasi santri');
        $success = 'Prestasi berhasil dicatat.';
    }

    $students = $pdo->query("SELECT id, nis, nama FROM students WHERE status='aktif' ORDER BY nama")->fetchAll();
    $daftar = $pdo->query("
        SELECT a.*, s.nama AS nama_santri FROM achievements a JOIN students s ON s.id=a.student_id
        ORDER BY a.tanggal DESC LIMIT 30
    ")->fetchAll();

    if (isset($_GET['export']) && $_GET['export'] === 'xlsx') {
        $baris = array_map(fn($d) => [$d['nama_santri'], $d['nama_kegiatan'], $d['lokasi'], ucfirst($d['tingkat']), $d['tanggal'], $d['keterangan']], $daftar);
        export_xlsx('prestasi_santri_' . date('Ymd'), ['Nama Santri', 'Kegiatan', 'Lokasi', 'Tingkat', 'Tanggal', 'Keterangan'], $baris);
    }
}

// ======================================================================
// MODUL: KALENDER AKADEMIK
// ======================================================================
elseif ($modul === 'kalender') {
    $page_title = 'Kalender Akademik';
    $bisaInput = $user['is_super_admin'] || $user['role_key'] === 'sekretaris';

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        if (!$bisaInput) {
            render_error_page(403, 'Akses Ditolak', 'Hanya sekretaris dan admin yang dapat menambah agenda.', 'dashboard.php?modul=kalender', 'Kembali ke Kalender');
        }
        $umum = isset($_POST['kategori_umum']) ? 1 : 0;
        $akademik = isset($_POST['kategori_akademik']) ? 1 : 0;
        $pengasuhan = isset($_POST['kategori_pengasuhan']) ? 1 : 0;
        if (!$umum && !$akademik && !$pengasuhan) {
            render_error_page(422, 'Data Tidak Lengkap', 'Minimal satu kategori (Umum/Akademik/Pengasuhan) wajib dipilih. Silakan kembali dan coba lagi.', 'dashboard.php?modul=kalender', 'Kembali ke Kalender');
        }
        $pdo->prepare("
            INSERT INTO agendas (tanggal, judul, keterangan, kategori_umum, kategori_akademik, kategori_pengasuhan, dibuat_oleh)
            VALUES (:tgl, :judul, :ket, :umum, :akademik, :pengasuhan, :uid)
        ")->execute([
            'tgl' => $_POST['tanggal'], 'judul' => $_POST['judul'], 'ket' => $_POST['keterangan'],
            'umum' => $umum, 'akademik' => $akademik, 'pengasuhan' => $pengasuhan,
            'uid' => $user['id'],
        ]);
        log_audit($pdo, $user['id'], 'Tambah agenda kalender tanggal ' . $_POST['tanggal']);
        header('Location: dashboard.php?modul=kalender&bulan=' . date('Y-m', strtotime($_POST['tanggal'])));
        exit;
    }

    // Helper: kelas warna kategori agenda -- fallback netral kalau (secara
    // data lama/tidak wajar) tidak ada satupun kategori yang tercentang,
    // supaya tidak salah tampil sebagai "Pengasuhan" begitu saja.
    function kalender_kategori_class(array $a): string
    {
        if ($a['kategori_umum']) {
            return 'agenda-umum';
        }
        if ($a['kategori_akademik']) {
            return 'agenda-akademik';
        }
        if ($a['kategori_pengasuhan']) {
            return 'agenda-pengasuhan';
        }
        return 'agenda-none';
    }

    $tampilan = (int) ($_GET['tampilan'] ?? 1);
    if (!in_array($tampilan, [1, 2, 6, 12], true)) {
        $tampilan = 1;
    }

    $bulanParam = $_GET['bulan'] ?? date('Y-m');
    $firstDay = new DateTime($bulanParam . '-01');

    // "1 Semester" (tampilan=6) dan "2 Semester" (tampilan=12) BUKAN sekadar
    // 6/12 bulan dari bulan yg sedang dilihat -- selalu di-anchor ke batas
    // semester (Jan/Jul) supaya konsisten dgn kalender akademik pesantren:
    //   1 Semester = Jan-Jun ATAU Jul-Des (tergantung bulan yg dilihat)
    //   2 Semester = tahun ajaran penuh Jul-Jun
    if ($tampilan === 6) {
        $bulanNum = (int) $firstDay->format('n');
        $tahun = (int) $firstDay->format('Y');
        $firstDay = new DateTime($bulanNum <= 6 ? "$tahun-01-01" : "$tahun-07-01");
    } elseif ($tampilan === 12) {
        $bulanNum = (int) $firstDay->format('n');
        $tahun = (int) $firstDay->format('Y');
        $firstDay = new DateTime($bulanNum >= 7 ? "$tahun-07-01" : ($tahun - 1) . '-07-01');
    }

    // Ambil semua agenda utk seluruh rentang bulan yang ditampilkan sekaligus
    // (satu query, bukan per-bulan) supaya tampilan 12-bulan tetap ringan.
    $rangeEnd = (clone $firstDay)->modify("+{$tampilan} months")->modify('-1 day');
    $stmt = $pdo->prepare('SELECT * FROM agendas WHERE tanggal BETWEEN :awal AND :akhir');
    $stmt->execute(['awal' => $firstDay->format('Y-m-d'), 'akhir' => $rangeEnd->format('Y-m-d')]);
    $agendaByDate = [];
    foreach ($stmt->fetchAll() as $row) {
        $agendaByDate[$row['tanggal']][] = $row;
    }

    // Susun metadata tiap bulan yang perlu digambar dalam rentang ini.
    $bulanList = [];
    for ($i = 0; $i < $tampilan; $i++) {
        $mDate = (clone $firstDay)->modify("+{$i} month");
        $bulanList[] = [
            'label'        => nama_bulan_indo($mDate->format('F')) . ' ' . $mDate->format('Y'),
            'ym'           => $mDate->format('Y-m'),
            'daysInMonth'  => (int) $mDate->format('t'),
            'startWeekday' => (int) $mDate->format('N'),
        ];
    }

    $prevBulan = (clone $firstDay)->modify("-{$tampilan} months")->format('Y-m');
    $nextBulan = (clone $firstDay)->modify("+{$tampilan} months")->format('Y-m');
}

// ======================================================================
// MODUL: CARI SANTRI
// ======================================================================
elseif ($modul === 'cari_santri') {
    $page_title = 'Cari Santri';

    $kamarId = $_GET['kamar_id'] ?? '';
    $rooms   = $pdo->query('SELECT id, nama_kamar, gedung FROM rooms ORDER BY gedung, nama_kamar')->fetchAll();

    $sql = "
        SELECT s.id, s.nis, s.nama, s.jenis_kelamin, r.nama_kamar, r.gedung
        FROM students s LEFT JOIN rooms r ON r.id = s.room_id
        WHERE s.status = 'aktif'
    ";
    $params = [];
    if ($kamarId !== '') {
        $sql .= ' AND s.room_id = :rid';
        $params['rid'] = $kamarId;
    }
    $sql .= ' ORDER BY s.nama';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $hasilSantri = $stmt->fetchAll();
}

// ======================================================================
// MODUL: CARI GURU
// ======================================================================
elseif ($modul === 'cari_guru') {
    $page_title = 'Cari Guru';
    $hasilGuru = $pdo->query('
        SELECT t.id, t.nip, t.nama, t.jenis_kelamin, t.no_hp, r.nama_kamar, r.gedung
        FROM teachers t LEFT JOIN rooms r ON r.id = t.wali_kamar_room_id
        ORDER BY t.nama
    ')->fetchAll();
}

// ======================================================================
// MODUL: KELOLA USER (Super Admin)
// ======================================================================
elseif ($modul === 'kelola_user') {
    $page_title = 'Kelola User';

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'update') {
        $id = $_POST['id'];
        if (!empty($_POST['password'])) {
            $pdo->prepare("UPDATE users SET nama=:nama, email=:email, status=:status, password=:password WHERE id=:id")
                ->execute([
                    'nama' => $_POST['nama'], 'email' => $_POST['email'], 'status' => $_POST['status'],
                    'password' => password_hash($_POST['password'], PASSWORD_BCRYPT), 'id' => $id,
                ]);
        } else {
            $pdo->prepare("UPDATE users SET nama=:nama, email=:email, status=:status WHERE id=:id")
                ->execute(['nama' => $_POST['nama'], 'email' => $_POST['email'], 'status' => $_POST['status'], 'id' => $id]);
        }
        log_audit($pdo, $user['id'], "Admin mengedit data user #$id");
        $success = 'Data user berhasil diperbarui.';
    }

    // -------- Tambah User Baru (angkat santri jadi pengurus + akun login) --------
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'tambah_user') {
        $periodeAktifRow = $pdo->query("SELECT id FROM periode_jabatan WHERE status='aktif' LIMIT 1")->fetch();
        if (!$periodeAktifRow) {
            $error = 'Belum ada Masa Jabatan aktif. Buat periode dulu lewat menu Serah Terima Jabatan.';
        } else {
            $stmtS = $pdo->prepare('SELECT nis, nama FROM students WHERE id = :id');
            $stmtS->execute(['id' => $_POST['student_id']]);
            $santri = $stmtS->fetch();
            if (!$santri) {
                $error = 'Santri tidak ditemukan. Pilih lagi dari daftar saran.';
            } else {
                $punyaAkses = isset($_POST['punya_akses_sistem']) ? 1 : 0;
                $pdo->prepare("
                    INSERT INTO riwayat_jabatan (student_id, periode_id, posisi, role_key, punya_akses_sistem, tanggal_mulai, status)
                    VALUES (:sid, :pid, :posisi, :role, :akses, :mulai, 'aktif')
                ")->execute([
                    'sid' => $_POST['student_id'], 'pid' => $periodeAktifRow['id'], 'posisi' => $_POST['posisi'],
                    'role' => $_POST['role_key'], 'akses' => $punyaAkses, 'mulai' => $_POST['tanggal_mulai'] ?: date('Y-m-d'),
                ]);
                if ($punyaAkses) {
                    if (empty($_POST['password'])) {
                        $error = 'Centang "punya akses sistem" butuh password awal -- jabatan tetap tersimpan, tapi akun login belum dibuat. Buka Edit User setelah ini utk mengatur passwordnya.';
                    } else {
                        $email = strtolower($santri['nis']) . '@daarululuumlido.com';
                        $pdo->prepare("
                            INSERT INTO users (email, password, student_id, nama, is_super_admin, status)
                            VALUES (:email, :pass, :sid, :nama, 0, 'aktif')
                            ON DUPLICATE KEY UPDATE password=VALUES(password), nama=VALUES(nama), status='aktif'
                        ")->execute([
                            'email' => $email, 'pass' => password_hash($_POST['password'], PASSWORD_BCRYPT),
                            'sid' => $_POST['student_id'], 'nama' => $santri['nama'],
                        ]);
                    }
                }
                log_audit($pdo, $user['id'], 'Tambah pengurus baru: ' . $santri['nis'] . ' - ' . $santri['nama'] . ' sbg ' . $_POST['posisi']);
                if (!isset($error)) {
                    $success = 'Pengurus baru berhasil ditambahkan.';
                }
            }
        }
    }

    $semuaSantriAktif = $pdo->query("SELECT id, nis, nama FROM students WHERE status='aktif' ORDER BY nama")->fetchAll();

    $daftarUser = $pdo->query("
        SELECT u.*, s.nis,
            (SELECT rj.posisi FROM riwayat_jabatan rj
             JOIN periode_jabatan pj ON rj.periode_id = pj.id
             WHERE rj.student_id = u.student_id AND pj.status='aktif' AND rj.status='aktif' LIMIT 1) AS posisi_aktif
        FROM users u LEFT JOIN students s ON s.id = u.student_id
        ORDER BY u.is_super_admin DESC, u.nama
    ")->fetchAll();
}

// ======================================================================
// MODUL: SERAH TERIMA JABATAN (Super Admin)
// ======================================================================
elseif ($modul === 'serah_terima') {
    $page_title = 'Serah Terima Jabatan';

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        // Popup tidak menyebutkan email tujuan -- diverifikasi langsung ke admin@daarululuumlido.com.
        $stmtAdmin = $pdo->prepare("SELECT * FROM users WHERE email = 'admin@daarululuumlido.com' LIMIT 1");
        $stmtAdmin->execute();
        $admin = $stmtAdmin->fetch();

        if (!$admin || !password_verify($_POST['password_konfirmasi'], $admin['password'])) {
            $error = 'Password salah. Serah terima jabatan dibatalkan.';
        } else {
            $pdo->beginTransaction();
            try {
                $pdo->prepare("UPDATE periode_jabatan SET status='arsip', tanggal_selesai=NOW() WHERE status='aktif'")->execute();
                $pdo->prepare("
                    INSERT INTO periode_jabatan (nama_periode, tanggal_mulai, tanggal_selesai, status)
                    VALUES (:nama, :mulai, :selesai, 'aktif')
                ")->execute([
                    'nama' => $_POST['nama_periode'], 'mulai' => $_POST['tanggal_mulai'],
                    'selesai' => $_POST['tanggal_selesai'] ?: null,
                ]);
                $pdo->commit();
                log_audit($pdo, $user['id'], 'Serah terima jabatan ke periode baru: ' . $_POST['nama_periode']);
                $success = 'Serah terima jabatan berhasil. Periode baru sekarang aktif.';
            } catch (Exception $e) {
                $pdo->rollBack();
                $error = 'Gagal memproses: ' . $e->getMessage();
            }
        }
    }

    $periodeAktif = $pdo->query("SELECT * FROM periode_jabatan WHERE status='aktif' LIMIT 1")->fetch();
}

// ======================================================================
// MODUL: DATA MASTER (Super Admin) -- kelola kelas/kamar/keluarga/guru/
// santri, satuan (manual) maupun massal (import CSV, upsert berdasar
// NIS/NIP -- baris baru ditambahkan, baris dgn NIS/NIP yg sudah ada
// akan DIPERBARUI, bukan dobel).
// ======================================================================
elseif ($modul === 'data_master') {
    $page_title = 'Data Master';
    $tab = $_GET['tab'] ?? 'santri';
    if (!in_array($tab, ['santri', 'guru', 'kelas', 'kamar', 'keluarga'], true)) {
        $tab = 'santri';
    }
    $csvHasil = null; // ['ditambah'=>n,'diperbarui'=>n,'peringatan'=>[...],'gagal'=>[...]]

    // -------- Tambah manual (satuan) --------
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'tambah_kelas') {
        $pdo->prepare('INSERT INTO classes (nama) VALUES (:nama)')->execute(['nama' => $_POST['nama']]);
        log_audit($pdo, $user['id'], 'Tambah data kelas: ' . $_POST['nama']);
        $success = 'Kelas berhasil ditambahkan.';
    }
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'tambah_kamar') {
        $pdo->prepare('INSERT INTO rooms (nama_kamar, gedung, gender) VALUES (:nama, :gedung, :gender)')
            ->execute(['nama' => $_POST['nama_kamar'], 'gedung' => $_POST['gedung'], 'gender' => $_POST['gender']]);
        log_audit($pdo, $user['id'], 'Tambah data kamar: ' . $_POST['gedung'] . ' - ' . $_POST['nama_kamar']);
        $success = 'Kamar berhasil ditambahkan.';
    }
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'tambah_keluarga') {
        $pdo->prepare('INSERT INTO families (nama_ayah, nama_ibu, no_hp) VALUES (:ayah, :ibu, :hp)')
            ->execute(['ayah' => $_POST['nama_ayah'], 'ibu' => $_POST['nama_ibu'], 'hp' => $_POST['no_hp']]);
        log_audit($pdo, $user['id'], 'Tambah data keluarga: ' . $_POST['nama_ayah']);
        $success = 'Data keluarga berhasil ditambahkan.';
    }
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'buat_akun_wali') {
        $pdo->prepare("
            INSERT INTO wali_akses (family_id, username, password, status)
            VALUES (:fid, :username, :pass, 'aktif')
            ON DUPLICATE KEY UPDATE username=VALUES(username), password=VALUES(password), status='aktif'
        ")->execute([
            'fid' => $_POST['family_id'], 'username' => $_POST['wali_username'],
            'pass' => password_hash($_POST['wali_password'], PASSWORD_BCRYPT),
        ]);
        log_audit($pdo, $user['id'], 'Buat/reset akun wali santri utk keluarga #' . $_POST['family_id']);
        $success = 'Akun Wali Santri berhasil dibuat/direset.';
    }
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'tambah_guru') {
        $pdo->prepare('INSERT INTO teachers (nip, nama, jenis_kelamin, no_hp, wali_kamar_room_id) VALUES (:nip, :nama, :jk, :hp, :wali)
                       ON DUPLICATE KEY UPDATE nama=VALUES(nama), jenis_kelamin=VALUES(jenis_kelamin), no_hp=VALUES(no_hp), wali_kamar_room_id=VALUES(wali_kamar_room_id)')
            ->execute(['nip' => $_POST['nip'] ?: null, 'nama' => $_POST['nama'], 'jk' => $_POST['jenis_kelamin'], 'hp' => $_POST['no_hp'], 'wali' => $_POST['wali_kamar_room_id'] ?: null]);
        log_audit($pdo, $user['id'], 'Tambah data guru: ' . $_POST['nama']);
        $success = 'Guru berhasil ditambahkan.';
    }
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'tambah_santri') {
        $kelasId = $_POST['class_id'] ?: null;
        $kamarId = $_POST['room_id'] ?: null;
        $pdo->prepare("
            INSERT INTO students (nis, nama, jenis_kelamin, tempat_lahir, tanggal_lahir, tanggal_masuk, class_id, room_id, status)
            VALUES (:nis, :nama, :jk, :tempat, :tgl_lahir, :tgl_masuk, :kelas, :kamar, 'aktif')
            ON DUPLICATE KEY UPDATE nama=VALUES(nama), jenis_kelamin=VALUES(jenis_kelamin),
                tempat_lahir=VALUES(tempat_lahir), tanggal_lahir=VALUES(tanggal_lahir),
                tanggal_masuk=VALUES(tanggal_masuk), class_id=VALUES(class_id), room_id=VALUES(room_id)
        ")->execute([
            'nis' => $_POST['nis'], 'nama' => $_POST['nama'], 'jk' => $_POST['jenis_kelamin'],
            'tempat' => $_POST['tempat_lahir'] ?: null, 'tgl_lahir' => $_POST['tanggal_lahir'] ?: null,
            'tgl_masuk' => $_POST['tanggal_masuk'] ?: null, 'kelas' => $kelasId, 'kamar' => $kamarId,
        ]);
        // Kalau langsung diberi kamar saat pertama dibuat, catat sbg riwayat_kamar awal.
        if ($kamarId) {
            $sidBaru = $pdo->prepare('SELECT id FROM students WHERE nis = :nis');
            $sidBaru->execute(['nis' => $_POST['nis']]);
            $sidBaru = $sidBaru->fetchColumn();
            $adaRiwayat = $pdo->prepare("SELECT id FROM riwayat_kamar WHERE student_id = :sid AND status = 'aktif'");
            $adaRiwayat->execute(['sid' => $sidBaru]);
            if (!$adaRiwayat->fetchColumn()) {
                $pdo->prepare("INSERT INTO riwayat_kamar (student_id, room_id, tanggal_mulai, status) VALUES (:sid, :rid, :tgl, 'aktif')")
                    ->execute(['sid' => $sidBaru, 'rid' => $kamarId, 'tgl' => $_POST['tanggal_masuk'] ?: date('Y-m-d')]);
            }
        }
        log_audit($pdo, $user['id'], 'Tambah data santri: ' . $_POST['nis'] . ' - ' . $_POST['nama']);
        $success = 'Santri berhasil ditambahkan.';
    }

    // -------- Edit Santri (kamar/kelas/status/profil kesehatan) --------
    // Perpindahan kamar TIDAK menimpa data lama -- riwayat_kamar yg masih
    // "aktif" diarsipkan dulu (tanggal_selesai diisi hari ini), baru baris
    // baru dibuat. Pola sama persis dgn riwayat_jabatan.
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'edit_santri') {
        $sid = $_POST['student_id'];
        $kamarBaru = $_POST['room_id'] ?: null;
        $kelasBaru = $_POST['class_id'] ?: null;
        $statusBaru = $_POST['status'];

        $lama = $pdo->prepare('SELECT room_id, status FROM students WHERE id = :sid');
        $lama->execute(['sid' => $sid]);
        $lama = $lama->fetch();

        $pdo->prepare('UPDATE students SET nama=:nama, jenis_kelamin=:jk, class_id=:kelas, room_id=:kamar, status=:status WHERE id=:sid')
            ->execute([
                'nama' => $_POST['nama'], 'jk' => $_POST['jenis_kelamin'], 'kelas' => $kelasBaru,
                'kamar' => $kamarBaru, 'status' => $statusBaru, 'sid' => $sid,
            ]);

        // -- Riwayat mutasi kamar: cuma dicatat kalau kamarnya BENAR berubah.
        if ((string) $lama['room_id'] !== (string) $kamarBaru) {
            $pdo->prepare("UPDATE riwayat_kamar SET status='arsip', tanggal_selesai=CURDATE() WHERE student_id=:sid AND status='aktif'")
                ->execute(['sid' => $sid]);
            if ($kamarBaru) {
                $pdo->prepare("INSERT INTO riwayat_kamar (student_id, room_id, tanggal_mulai, status) VALUES (:sid, :rid, CURDATE(), 'aktif')")
                    ->execute(['sid' => $sid, 'rid' => $kamarBaru]);
            }
            log_audit($pdo, $user['id'], "Mutasi kamar santri #$sid");
        }

        // -- Alumni/Kelulusan: kalau status berubah JADI bukan aktif, akun
        //    login (kalau ada) otomatis dinonaktifkan -- bukan dihapus.
        if ($lama['status'] === 'aktif' && $statusBaru !== 'aktif') {
            $pdo->prepare("UPDATE users SET status='nonaktif' WHERE student_id=:sid")->execute(['sid' => $sid]);
            log_audit($pdo, $user['id'], "Santri #$sid berubah status jadi $statusBaru, akun login dinonaktifkan");
        }

        // -- Profil Kesehatan Tetap (upsert) --
        $pdo->prepare("
            INSERT INTO health_profiles (student_id, golongan_darah, alergi, penyakit_kronis, catatan_lain)
            VALUES (:sid, :gol, :alergi, :kronis, :catatan)
            ON DUPLICATE KEY UPDATE golongan_darah=VALUES(golongan_darah), alergi=VALUES(alergi),
                penyakit_kronis=VALUES(penyakit_kronis), catatan_lain=VALUES(catatan_lain)
        ")->execute([
            'sid' => $sid, 'gol' => $_POST['golongan_darah'] ?: 'Tidak Tahu',
            'alergi' => $_POST['alergi'] ?: null, 'kronis' => $_POST['penyakit_kronis'] ?: null,
            'catatan' => $_POST['catatan_lain'] ?: null,
        ]);

        log_audit($pdo, $user['id'], "Edit data santri #$sid");
        $success = 'Data santri berhasil diperbarui.';
    }

    // -------- Import CSV (massal, upsert berdasar NIS/NIP) --------
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'csv_guru' && !empty($_FILES['csv_file']['tmp_name'])) {
        $rows = array_map('str_getcsv', file($_FILES['csv_file']['tmp_name']));
        $header = array_map(fn($h) => strtolower(trim($h)), array_shift($rows));
        $ditambah = 0; $diperbarui = 0; $gagal = [];
        foreach ($rows as $i => $row) {
            if (count(array_filter($row, fn($v) => trim((string)$v) !== '')) === 0) {
                continue; // lewati baris kosong
            }
            $data = array_combine($header, array_pad($row, count($header), null));
            $nomorBaris = $i + 2; // +2: header + index-0-based
            if (empty($data['nip']) || empty($data['nama'])) {
                $gagal[] = "Baris $nomorBaris: kolom nip/nama wajib diisi.";
                continue;
            }
            $ada = $pdo->prepare('SELECT id FROM teachers WHERE nip = :nip');
            $ada->execute(['nip' => $data['nip']]);
            $sudahAda = (bool) $ada->fetchColumn();
            $pdo->prepare('INSERT INTO teachers (nip, nama, jenis_kelamin, no_hp) VALUES (:nip, :nama, :jk, :hp)
                           ON DUPLICATE KEY UPDATE nama=VALUES(nama), jenis_kelamin=VALUES(jenis_kelamin), no_hp=VALUES(no_hp)')
                ->execute([
                    'nip' => $data['nip'], 'nama' => $data['nama'],
                    'jk' => strtoupper($data['jenis_kelamin'] ?? '') === 'P' ? 'P' : 'L',
                    'hp' => $data['no_hp'] ?? null,
                ]);
            $sudahAda ? $diperbarui++ : $ditambah++;
        }
        $csvHasil = ['ditambah' => $ditambah, 'diperbarui' => $diperbarui, 'peringatan' => [], 'gagal' => $gagal];
        log_audit($pdo, $user['id'], "Import CSV Data Guru: $ditambah ditambah, $diperbarui diperbarui, " . count($gagal) . ' gagal');
        $success = 'Import CSV guru selesai diproses.';
    }
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'csv_santri' && !empty($_FILES['csv_file']['tmp_name'])) {
        $rows = array_map('str_getcsv', file($_FILES['csv_file']['tmp_name']));
        $header = array_map(fn($h) => strtolower(trim($h)), array_shift($rows));
        $kelasMap = [];
        foreach ($pdo->query('SELECT id, nama FROM classes')->fetchAll() as $k) {
            $kelasMap[strtolower(trim($k['nama']))] = $k['id'];
        }
        $kamarMap = [];
        foreach ($pdo->query('SELECT id, nama_kamar, gedung FROM rooms')->fetchAll() as $r) {
            $kamarMap[strtolower(trim($r['gedung'])) . '|' . strtolower(trim($r['nama_kamar']))] = $r['id'];
        }
        $ditambah = 0; $diperbarui = 0; $gagal = []; $peringatan = [];
        foreach ($rows as $i => $row) {
            if (count(array_filter($row, fn($v) => trim((string)$v) !== '')) === 0) {
                continue;
            }
            $data = array_combine($header, array_pad($row, count($header), null));
            $nomorBaris = $i + 2;
            if (empty($data['nis']) || empty($data['nama'])) {
                $gagal[] = "Baris $nomorBaris: kolom nis/nama wajib diisi.";
                continue;
            }
            $kelasId = null;
            if (!empty($data['kelas'])) {
                $key = strtolower(trim($data['kelas']));
                if (isset($kelasMap[$key])) {
                    $kelasId = $kelasMap[$key];
                } else {
                    $peringatan[] = "Baris $nomorBaris ({$data['nis']}): kelas '{$data['kelas']}' tidak ditemukan, dikosongkan.";
                }
            }
            $kamarId = null;
            if (!empty($data['kamar'])) {
                $key = strtolower(trim($data['gedung'] ?? '')) . '|' . strtolower(trim($data['kamar']));
                if (isset($kamarMap[$key])) {
                    $kamarId = $kamarMap[$key];
                } else {
                    $peringatan[] = "Baris $nomorBaris ({$data['nis']}): kamar '{$data['gedung']} - {$data['kamar']}' tidak ditemukan, dikosongkan.";
                }
            }
            $ada = $pdo->prepare('SELECT id FROM students WHERE nis = :nis');
            $ada->execute(['nis' => $data['nis']]);
            $sudahAda = (bool) $ada->fetchColumn();
            $pdo->prepare("
                INSERT INTO students (nis, nama, jenis_kelamin, tempat_lahir, tanggal_lahir, tanggal_masuk, class_id, room_id, status)
                VALUES (:nis, :nama, :jk, :tempat, :tgl_lahir, :tgl_masuk, :kelas, :kamar, 'aktif')
                ON DUPLICATE KEY UPDATE nama=VALUES(nama), jenis_kelamin=VALUES(jenis_kelamin),
                    tempat_lahir=VALUES(tempat_lahir), tanggal_lahir=VALUES(tanggal_lahir),
                    tanggal_masuk=VALUES(tanggal_masuk), class_id=VALUES(class_id), room_id=VALUES(room_id)
            ")->execute([
                'nis' => $data['nis'], 'nama' => $data['nama'],
                'jk' => strtoupper($data['jenis_kelamin'] ?? '') === 'P' ? 'P' : 'L',
                'tempat' => $data['tempat_lahir'] ?? null,
                'tgl_lahir' => $data['tanggal_lahir'] ?: null,
                'tgl_masuk' => $data['tanggal_masuk'] ?: null,
                'kelas' => $kelasId, 'kamar' => $kamarId,
            ]);
            $sudahAda ? $diperbarui++ : $ditambah++;
        }
        $csvHasil = ['ditambah' => $ditambah, 'diperbarui' => $diperbarui, 'peringatan' => $peringatan, 'gagal' => $gagal];
        log_audit($pdo, $user['id'], "Import CSV Data Santri: $ditambah ditambah, $diperbarui diperbarui, " . count($gagal) . ' gagal, ' . count($peringatan) . ' peringatan');
        $success = 'Import CSV santri selesai diproses.';
    }

    // -------- Import CSV: Kelas, Kamar, Keluarga (lebih sederhana -- tidak
    //          punya unique key alami, jadi selalu INSERT baris baru, bukan
    //          upsert. Cocok utk isi data awal jumlah banyak sekaligus.) --------
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'csv_kelas' && !empty($_FILES['csv_file']['tmp_name'])) {
        $rows = array_map('str_getcsv', file($_FILES['csv_file']['tmp_name']));
        $header = array_map(fn($h) => strtolower(trim($h)), array_shift($rows));
        $ditambah = 0; $gagal = [];
        foreach ($rows as $i => $row) {
            if (count(array_filter($row, fn($v) => trim((string)$v) !== '')) === 0) {
                continue;
            }
            $data = array_combine($header, array_pad($row, count($header), null));
            if (empty($data['nama'])) {
                $gagal[] = 'Baris ' . ($i + 2) . ': kolom nama wajib diisi.';
                continue;
            }
            $pdo->prepare('INSERT INTO classes (nama) VALUES (:nama)')->execute(['nama' => $data['nama']]);
            $ditambah++;
        }
        $csvHasil = ['ditambah' => $ditambah, 'diperbarui' => 0, 'peringatan' => [], 'gagal' => $gagal];
        log_audit($pdo, $user['id'], "Import CSV Data Kelas: $ditambah ditambah, " . count($gagal) . ' gagal');
        $success = 'Import CSV kelas selesai diproses.';
    }
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'csv_kamar' && !empty($_FILES['csv_file']['tmp_name'])) {
        $rows = array_map('str_getcsv', file($_FILES['csv_file']['tmp_name']));
        $header = array_map(fn($h) => strtolower(trim($h)), array_shift($rows));
        $ditambah = 0; $gagal = [];
        foreach ($rows as $i => $row) {
            if (count(array_filter($row, fn($v) => trim((string)$v) !== '')) === 0) {
                continue;
            }
            $data = array_combine($header, array_pad($row, count($header), null));
            $nomorBaris = $i + 2;
            if (empty($data['nama_kamar']) || empty($data['gedung']) || empty($data['gender'])) {
                $gagal[] = "Baris $nomorBaris: kolom nama_kamar/gedung/gender wajib diisi.";
                continue;
            }
            $pdo->prepare('INSERT INTO rooms (nama_kamar, gedung, gender) VALUES (:nama, :gedung, :gender)')
                ->execute(['nama' => $data['nama_kamar'], 'gedung' => $data['gedung'], 'gender' => strtoupper($data['gender']) === 'P' ? 'P' : 'L']);
            $ditambah++;
        }
        $csvHasil = ['ditambah' => $ditambah, 'diperbarui' => 0, 'peringatan' => [], 'gagal' => $gagal];
        log_audit($pdo, $user['id'], "Import CSV Data Kamar: $ditambah ditambah, " . count($gagal) . ' gagal');
        $success = 'Import CSV kamar selesai diproses.';
    }
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'csv_keluarga' && !empty($_FILES['csv_file']['tmp_name'])) {
        $rows = array_map('str_getcsv', file($_FILES['csv_file']['tmp_name']));
        $header = array_map(fn($h) => strtolower(trim($h)), array_shift($rows));
        $ditambah = 0; $gagal = [];
        foreach ($rows as $i => $row) {
            if (count(array_filter($row, fn($v) => trim((string)$v) !== '')) === 0) {
                continue;
            }
            $data = array_combine($header, array_pad($row, count($header), null));
            if (empty($data['nama_ayah']) && empty($data['nama_ibu'])) {
                $gagal[] = 'Baris ' . ($i + 2) . ': minimal nama_ayah atau nama_ibu wajib diisi.';
                continue;
            }
            $pdo->prepare('INSERT INTO families (nama_ayah, nama_ibu, no_hp) VALUES (:ayah, :ibu, :hp)')
                ->execute(['ayah' => $data['nama_ayah'] ?? null, 'ibu' => $data['nama_ibu'] ?? null, 'hp' => $data['no_hp'] ?? null]);
            $ditambah++;
        }
        $csvHasil = ['ditambah' => $ditambah, 'diperbarui' => 0, 'peringatan' => [], 'gagal' => $gagal];
        log_audit($pdo, $user['id'], "Import CSV Data Keluarga: $ditambah ditambah, " . count($gagal) . ' gagal');
        $success = 'Import CSV keluarga selesai diproses.';
    }

    // -------- Data existing per tab (utk daftar) --------
    $daftarKelas = $pdo->query('SELECT * FROM classes ORDER BY nama')->fetchAll();
    $daftarKamar = $pdo->query('SELECT * FROM rooms ORDER BY gedung, nama_kamar')->fetchAll();
    $daftarKeluarga = $pdo->query('
        SELECT f.*, wa.username AS wali_username, wa.status AS wali_status
        FROM families f LEFT JOIN wali_akses wa ON wa.family_id = f.id
        ORDER BY f.id DESC LIMIT 100
    ')->fetchAll();
    $daftarGuru = $pdo->query('
        SELECT t.*, r.nama_kamar, r.gedung FROM teachers t LEFT JOIN rooms r ON r.id = t.wali_kamar_room_id
        ORDER BY t.nama LIMIT 200
    ')->fetchAll();
    $daftarSantri = $pdo->query("
        SELECT s.*, c.nama AS nama_kelas, r.nama_kamar, r.gedung, hp.golongan_darah, hp.alergi, hp.penyakit_kronis, hp.catatan_lain
        FROM students s LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN rooms r ON r.id = s.room_id
        LEFT JOIN health_profiles hp ON hp.student_id = s.id
        ORDER BY s.id DESC LIMIT 200
    ")->fetchAll();
    $semuaKelas = $daftarKelas;
    $semuaKamar = $daftarKamar;
}

// ======================================================================
// MODUL: HISTORY (Super Admin) -- riwayat perubahan / audit log
// ======================================================================
elseif ($modul === 'history') {
    $page_title = 'Riwayat Perubahan';

    $periodeList = $pdo->query('SELECT id, nama_periode, tanggal_mulai, tanggal_selesai, status FROM periode_jabatan ORDER BY tanggal_mulai DESC')->fetchAll();
    $periodeId = $_GET['periode_id'] ?? '';

    if ($periodeId !== '') {
        $stmtP = $pdo->prepare('SELECT tanggal_mulai, tanggal_selesai FROM periode_jabatan WHERE id = :id');
        $stmtP->execute(['id' => $periodeId]);
        $p = $stmtP->fetch();
        $stmt = $pdo->prepare("
            SELECT al.*, u.nama AS nama_user, u.email
            FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
            WHERE al.created_at >= :mulai AND al.created_at <= :selesai
            ORDER BY al.created_at DESC LIMIT 500
        ");
        $stmt->execute(['mulai' => $p['tanggal_mulai'] . ' 00:00:00', 'selesai' => ($p['tanggal_selesai'] ?: date('Y-m-d')) . ' 23:59:59']);
    } else {
        $stmt = $pdo->query("
            SELECT al.*, u.nama AS nama_user, u.email
            FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
            ORDER BY al.created_at DESC LIMIT 200
        ");
    }
    $logs = $stmt->fetchAll();
}

// ======================================================================
// MODUL: INVENTARIS BARANG SANTRI
// ======================================================================
elseif ($modul === 'inventaris') {
    $page_title = 'Inventaris Barang';

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'tambah') {
        $kategoriArr = $_POST['kategori'] ?? [];
        $tingkatArr = $_POST['tingkat'] ?? [];
        if (empty($_POST['kode_barang']) || empty($_POST['nama_barang']) || !$kategoriArr) {
            $error = 'Kode barang, nama barang, dan detail tiap unit wajib diisi.';
        } else {
            try {
                $pdo->beginTransaction();
                $pdo->prepare("INSERT INTO inventaris_kode (kode_barang, nama_barang, jumlah, keterangan) VALUES (:kode, :nama, :jml, :ket)")
                    ->execute([
                        'kode' => $_POST['kode_barang'], 'nama' => $_POST['nama_barang'],
                        'jml' => count($kategoriArr), 'ket' => $_POST['keterangan'] ?: null,
                    ]);
                $kodeId = $pdo->lastInsertId();
                $stmtUnit = $pdo->prepare('INSERT INTO inventaris_unit (inventaris_kode_id, kategori, tingkat) VALUES (:kid, :kat, :tkt)');
                foreach ($kategoriArr as $i => $kat) {
                    $stmtUnit->execute(['kid' => $kodeId, 'kat' => $kat, 'tkt' => $tingkatArr[$i] ?? 'bagus']);
                }
                $pdo->commit();
                log_audit($pdo, $user['id'], 'Tambah inventaris: ' . $_POST['kode_barang'] . ' - ' . $_POST['nama_barang'] . ' (' . count($kategoriArr) . ' unit)');
                $success = 'Barang berhasil dicatat.';
            } catch (PDOException $e) {
                $pdo->rollBack();
                $error = $e->getCode() === '23000'
                    ? 'Kode barang "' . htmlspecialchars($_POST['kode_barang']) . '" sudah dipakai. Gunakan kode lain.'
                    : 'Gagal menyimpan: ' . $e->getMessage();
            }
        }
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'update_unit') {
        $pdo->prepare('UPDATE inventaris_unit SET kategori = :kat, tingkat = :tkt WHERE id = :id')
            ->execute(['kat' => $_POST['kategori_unit'], 'tkt' => $_POST['tingkat_unit'], 'id' => $_POST['unit_id']]);
        log_audit($pdo, $user['id'], 'Perbarui unit inventaris #' . $_POST['unit_id']);
        $success = 'Unit berhasil diperbarui.';
    }

    $daftarKode = $pdo->query('SELECT * FROM inventaris_kode ORDER BY id DESC LIMIT 100')->fetchAll();
    $unitPerKode = [];
    if ($daftarKode) {
        $ids = implode(',', array_map('intval', array_column($daftarKode, 'id')));
        $unitRows = $pdo->query("SELECT * FROM inventaris_unit WHERE inventaris_kode_id IN ($ids) ORDER BY id")->fetchAll();
        foreach ($unitRows as $u) {
            $unitPerKode[$u['inventaris_kode_id']][] = $u;
        }
    }
}

// ======================================================================
// MODUL: RAPOR KESANTRIAN
// ======================================================================
elseif ($modul === 'rapor') {
    $page_title = 'Rapor Kesantrian';

    $students = $pdo->query("SELECT id, nis, nama FROM students WHERE status='aktif' ORDER BY nama")->fetchAll();
    $rapor = null;
    $studentIdRapor = $_GET['student_id'] ?? '';

    if ($studentIdRapor !== '') {
        $stmtS = $pdo->prepare("
            SELECT s.*, c.nama AS nama_kelas, r.nama_kamar, r.gedung
            FROM students s LEFT JOIN classes c ON c.id=s.class_id LEFT JOIN rooms r ON r.id=s.room_id
            WHERE s.id = :sid
        ");
        $stmtS->execute(['sid' => $studentIdRapor]);
        $santriRapor = $stmtS->fetch();

        if ($santriRapor) {
            $rekapAbsensi = $pdo->prepare("
                SELECT status, COUNT(*) AS jumlah FROM attendances
                WHERE student_id = :sid AND jenis_kegiatan = 'harian'
                  AND tanggal >= (CURDATE() - INTERVAL 90 DAY)
                GROUP BY status
            ");
            $rekapAbsensi->execute(['sid' => $studentIdRapor]);
            $rekapAbsensi = $rekapAbsensi->fetchAll();

            $pelanggaran = $pdo->prepare("
                SELECT kategori, status, tanggal, keterangan FROM violations
                WHERE student_id = :sid AND status != 'dibatalkan' ORDER BY tanggal DESC
            ");
            $pelanggaran->execute(['sid' => $studentIdRapor]);
            $pelanggaran = $pelanggaran->fetchAll();

            $prestasiList = $pdo->prepare("SELECT * FROM achievements WHERE student_id = :sid ORDER BY tanggal DESC");
            $prestasiList->execute(['sid' => $studentIdRapor]);
            $prestasiList = $prestasiList->fetchAll();

            $ekskulList = $pdo->prepare("
                SELECT e.nama, k.nama AS kategori FROM ekskul_anggota ea
                JOIN ekstrakurikuler e ON e.id = ea.ekskul_id JOIN kategori_ekskul k ON k.id = e.kategori_id
                WHERE ea.student_id = :sid AND ea.status = 'aktif'
            ");
            $ekskulList->execute(['sid' => $studentIdRapor]);
            $ekskulList = $ekskulList->fetchAll();

            $rapor = [
                'santri' => $santriRapor, 'absensi' => $rekapAbsensi, 'pelanggaran' => $pelanggaran,
                'prestasi' => $prestasiList, 'ekskul' => $ekskulList,
            ];
        }
    }
}

// ======================================================================
// MODUL: BACKUP DATABASE (Super Admin)
// ======================================================================
elseif ($modul === 'backup') {
    $page_title = 'Backup Database';

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'backup_manual') {
        $tabelSemua = $pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
        $dumpFile = sys_get_temp_dir() . '/hisada_backup_' . date('Ymd_His') . '.sql';
        try {
            $fh = fopen($dumpFile, 'w');
            fwrite($fh, "-- Backup Hisada -- " . date('Y-m-d H:i:s') . "\nSET FOREIGN_KEY_CHECKS=0;\n\n");
            foreach ($tabelSemua as $tabel) {
                $create = $pdo->query("SHOW CREATE TABLE `$tabel`")->fetch();
                fwrite($fh, "DROP TABLE IF EXISTS `$tabel`;\n" . $create['Create Table'] . ";\n\n");

                // Bulk INSERT per batch (200 baris/statement) jauh lebih cepat
                // drpd 1 INSERT per baris -- penting utk tabel yg sudah berisi
                // banyak data di server produksi (salah satu penyebab timeout
                // 524 sebelumnya). Query TANPA fetchAll() supaya tidak perlu
                // menampung seluruh tabel di memori sekaligus.
                $stmt = $pdo->query("SELECT * FROM `$tabel`");
                $batch = [];
                $cols = null;
                while ($row = $stmt->fetch()) {
                    if ($cols === null) {
                        $cols = array_map(fn($c) => "`$c`", array_keys($row));
                    }
                    $vals = array_map(fn($v) => $v === null ? 'NULL' : $pdo->quote($v), array_values($row));
                    $batch[] = '(' . implode(',', $vals) . ')';
                    if (count($batch) >= 200) {
                        fwrite($fh, "INSERT INTO `$tabel` (" . implode(',', $cols) . ") VALUES\n" . implode(",\n", $batch) . ";\n");
                        $batch = [];
                    }
                }
                if ($batch) {
                    fwrite($fh, "INSERT INTO `$tabel` (" . implode(',', $cols) . ") VALUES\n" . implode(",\n", $batch) . ";\n");
                }
                fwrite($fh, "\n");
            }
            fwrite($fh, "SET FOREIGN_KEY_CHECKS=1;\n");
            fclose($fh);
            $pdo->prepare("INSERT INTO backup_logs (status, keterangan) VALUES ('berhasil', :ket)")
                ->execute(['ket' => basename($dumpFile) . ' (' . round(filesize($dumpFile) / 1024, 1) . ' KB)']);
            log_audit($pdo, $user['id'], 'Backup manual database berhasil dibuat');
            $_SESSION['backup_download'] = $dumpFile;
            $success = 'Backup berhasil dibuat. Klik "Unduh Backup Terakhir" untuk mengunduh file-nya.';
        } catch (Exception $e) {
            $pdo->prepare("INSERT INTO backup_logs (status, keterangan) VALUES ('gagal', :ket)")->execute(['ket' => $e->getMessage()]);
            $error = 'Backup gagal: ' . $e->getMessage();
        }
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'simpan_pengaturan_gs') {
        foreach (['gs_url' => $_POST['gs_url'], 'gs_kunci' => $_POST['gs_kunci']] as $nama => $nilai) {
            $pdo->prepare('INSERT INTO pengaturan (nama_setting, nilai) VALUES (:n, :v) ON DUPLICATE KEY UPDATE nilai = VALUES(nilai)')
                ->execute(['n' => $nama, 'v' => $nilai]);
        }
        log_audit($pdo, $user['id'], 'Perbarui pengaturan Google Apps Script (backup spreadsheet)');
        $success = 'Pengaturan Google Sheets berhasil disimpan.';
    }

    // -------- Backup ke Google Sheets: PER TABEL lewat AJAX --------
    // Sengaja TIDAK lagi memproses 8 tabel dlm satu request PHP -- kalau
    // Google Apps Script lambat (cold start dsb), 8 panggilan berurutan
    // gampang melebihi batas waktu PHP/hosting (muncul sbg error 524).
    // Browser yg meloop tiap tabel via fetch() satu-satu, jadi tiap
    // request PHP cuma menangani SATU tabel & selesai cepat.
    define('TABEL_BACKUP_SHEETS', ['students', 'teachers', 'attendances', 'violations', 'permits', 'poskestren_records', 'achievements', 'correspondences']);

    if (isset($_GET['ajax_tabel'])) {
        header('Content-Type: application/json');
        $tabel = $_GET['ajax_tabel'];
        if (!in_array($tabel, TABEL_BACKUP_SHEETS, true)) {
            echo json_encode(['ok' => false, 'pesan' => 'Nama tabel tidak dikenali.']);
            exit;
        }
        $stmtSet = $pdo->query("SELECT nama_setting, nilai FROM pengaturan WHERE nama_setting IN ('gs_url','gs_kunci')");
        $pengaturanGs = [];
        foreach ($stmtSet->fetchAll() as $row) {
            $pengaturanGs[$row['nama_setting']] = $row['nilai'];
        }
        if (empty($pengaturanGs['gs_url'])) {
            echo json_encode(['ok' => false, 'pesan' => 'URL Google Apps Script belum diatur.']);
            exit;
        }
        $limit = max(50, min(1000, (int) ($_GET['limit'] ?? 200)));
        $rows = $pdo->query("SELECT * FROM `$tabel` ORDER BY id DESC LIMIT $limit")->fetchAll();
        $header = $rows ? array_keys($rows[0]) : [];
        $baris = array_map(fn($r) => array_map(fn($v) => (string) ($v ?? ''), array_values($r)), $rows);
        $respons = kirim_ke_google_sheets($pengaturanGs['gs_url'], $pengaturanGs['gs_kunci'] ?? '', $tabel, $header, $baris);
        echo json_encode(['ok' => $respons['ok'], 'pesan' => $respons['pesan'], 'jumlah' => count($rows)]);
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'catat_hasil_backup_sheets') {
        $pdo->prepare("INSERT INTO backup_logs (status, keterangan) VALUES (:status, :ket)")
            ->execute(['status' => $_POST['semua_ok'] === '1' ? 'berhasil' : 'gagal', 'ket' => 'Backup ke Google Sheets: ' . $_POST['ringkasan']]);
        log_audit($pdo, $user['id'], 'Backup ke Google Spreadsheet: ' . ($_POST['semua_ok'] === '1' ? 'berhasil' : 'sebagian gagal'));
        echo json_encode(['ok' => true]);
        exit;
    }

    if (isset($_GET['unduh']) && !empty($_SESSION['backup_download']) && file_exists($_SESSION['backup_download'])) {
        header('Content-Type: application/sql');
        header('Content-Disposition: attachment; filename="' . basename($_SESSION['backup_download']) . '"');
        header('Content-Length: ' . filesize($_SESSION['backup_download']));
        readfile($_SESSION['backup_download']);
        exit;
    }

    $stmtSet = $pdo->query("SELECT nama_setting, nilai FROM pengaturan WHERE nama_setting IN ('gs_url','gs_kunci')");
    $pengaturanGsTampil = [];
    foreach ($stmtSet->fetchAll() as $row) {
        $pengaturanGsTampil[$row['nama_setting']] = $row['nilai'];
    }
    $riwayatBackup = $pdo->query('SELECT * FROM backup_logs ORDER BY waktu DESC LIMIT 30')->fetchAll();
    $adaFileSiapUnduh = !empty($_SESSION['backup_download']) && file_exists($_SESSION['backup_download']);
}

// --------------------------------------------------------------------
// TAMPILAN: header + sidebar (dipakai semua modul)
// --------------------------------------------------------------------
include __DIR__ . '/includes/header.php';
include __DIR__ . '/includes/sidebar.php';
?>
<div class="main-content">

<?php if ($success): ?><div class="alert alert-success py-2 small"><?= htmlspecialchars($success) ?></div><?php endif; ?>
<?php if ($error): ?><div class="alert alert-danger py-2 small"><?= htmlspecialchars($error) ?></div><?php endif; ?>

<?php
// ======================================================================
// RENDER: HOME
// ======================================================================
if ($modul === 'home'): ?>
    <div class="d-flex justify-content-between align-items-center mb-4">
        <h4 class="mb-0">Dashboard</h4>
        <span class="text-muted small"><?= date('l, d F Y') ?></span>
    </div>
    <div class="row g-3 mb-3">
        <div class="col-md-4">
            <div class="stat-box bg-green">
                <div class="small">Santri Laki-laki / Perempuan / Total</div>
                <div class="fs-4 fw-bold"><?= (int)$stat['laki'] ?> / <?= (int)$stat['perempuan'] ?> / <?= (int)$stat['total'] ?></div>
            </div>
        </div>
        <div class="col-md-2">
            <div class="stat-box bg-orange">
                <div class="small">Sakit (30 hari)</div>
                <div class="fs-4 fw-bold"><?= (int)$sakitBulanIni ?></div>
            </div>
        </div>
        <div class="col-md-2">
            <div class="stat-box bg-blue">
                <div class="small">Status Pulang</div>
                <div class="fs-4 fw-bold"><?= (int)$statusPulang ?></div>
            </div>
        </div>
        <div class="col-md-2">
            <div class="stat-box bg-red">
                <div class="small">Alpha Hari Ini</div>
                <div class="fs-4 fw-bold"><?= (int)$statusAlpha ?></div>
            </div>
        </div>
    </div>
    <div class="card card-hisada p-3">
        <h6 class="mb-3"><i class="bi bi-calendar-event me-2"></i>Kegiatan Mendatang</h6>
        <?php if (!$upcoming): ?>
            <p class="text-muted small mb-0">Belum ada agenda mendatang.</p>
        <?php else: ?>
            <ul class="list-group list-group-flush">
                <?php foreach ($upcoming as $a): ?>
                    <li class="list-group-item d-flex justify-content-between align-items-center px-0">
                        <div>
                            <div><?= htmlspecialchars($a['judul']) ?></div>
                            <small class="text-muted"><?= date('d M Y', strtotime($a['tanggal'])) ?></small>
                        </div>
                        <div>
                            <?php if ($a['kategori_umum']): ?><span class="badge agenda-umum">Umum</span><?php endif; ?>
                            <?php if ($a['kategori_akademik']): ?><span class="badge agenda-akademik">Akademik</span><?php endif; ?>
                            <?php if ($a['kategori_pengasuhan']): ?><span class="badge agenda-pengasuhan">Pengasuhan</span><?php endif; ?>
                        </div>
                    </li>
                <?php endforeach; ?>
            </ul>
        <?php endif; ?>
    </div>

<?php
// ======================================================================
// RENDER: ABSENSI (kartu pilihan)
// ======================================================================
elseif ($modul === 'absensi'):
    $menu = [
        ['harian', 'bi-house-door', 'Absensi Harian (Kamar)', 'modul=absensi_kamar'],
        ['halaqah', 'bi-book', "Halaqah Qur'an", 'modul=absensi_kegiatan&jenis=halaqah'],
        ['muhadhoroh', 'bi-mic', 'Muhadhoroh', 'modul=absensi_kegiatan&jenis=muhadhoroh'],
        ['olahraga', 'bi-trophy', 'Olahraga', 'modul=absensi_kegiatan&jenis=olahraga'],
        ['kesenian', 'bi-palette', 'Kesenian', 'modul=absensi_kegiatan&jenis=kesenian'],
    ];
?>
    <h4 class="mb-4">Pilih Jenis Absensi</h4>
    <div class="row g-3">
        <?php foreach ($menu as [$jenis, $icon, $label, $query]): ?>
            <div class="col-6 col-md-3">
                <a href="dashboard.php?<?= $query ?>" class="card-select">
                    <i class="bi <?= $icon ?> icon"></i><?= htmlspecialchars($label) ?>
                </a>
            </div>
        <?php endforeach; ?>
    </div>

<?php
// ======================================================================
// RENDER: ABSENSI HARIAN (KAMAR)
// ======================================================================
elseif ($modul === 'absensi_kamar'): ?>
    <a href="dashboard.php?modul=absensi" class="text-decoration-none small text-muted"><i class="bi bi-chevron-left"></i> Kembali</a>
    <h4 class="my-3">Absensi Harian (Kamar)</h4>

    <div class="card card-hisada p-3 mb-3">
        <form method="get" class="row g-2 align-items-end" id="formAbsensiKamar">
            <input type="hidden" name="modul" value="absensi_kamar">
            <div class="col-md-6">
                <label class="form-label small">Kamar</label>
                <select name="room_id" id="filterKamar" class="form-select form-select-sm" required onchange="document.getElementById('formAbsensiKamar').submit()">
                    <option value="">-- Pilih Kamar --</option>
                    <?php foreach ($rooms as $r): ?>
                        <option value="<?= $r['id'] ?>" <?= (string)$roomId === (string)$r['id'] ? 'selected' : '' ?>><?= htmlspecialchars($r['gedung'] . ' - ' . $r['nama_kamar']) ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
            <div class="col-md-4">
                <label class="form-label small">Tanggal</label>
                <input type="date" name="tanggal" id="filterTanggal" class="form-control form-control-sm" value="<?= htmlspecialchars($tanggal) ?>" onchange="document.getElementById('formAbsensiKamar').submit()">
            </div>
        </form>
    </div>

    <?php if ($roomId && $students): ?>
        <form method="post">
            <input type="hidden" name="tanggal" value="<?= htmlspecialchars($tanggal) ?>">
            <div class="card card-hisada p-3">
                <div class="d-flex justify-content-end mb-2">
                    <a href="dashboard.php?modul=absensi_kamar&room_id=<?= $roomId ?>&tanggal=<?= $tanggal ?>&export=xlsx" class="btn btn-sm btn-outline-success"><i class="bi bi-file-earmark-excel me-1"></i>Export Excel</a>
                </div>
                <div class="table-responsive">
                <table class="table table-sm align-middle">
                    <thead><tr><th>NIS</th><th>Nama</th><th style="width:160px">Status</th><th>Keterangan</th></tr></thead>
                    <tbody>
                    <?php foreach ($students as $s): ?>
                        <tr>
                            <td><?= htmlspecialchars($s['nis']) ?></td>
                            <td><?= htmlspecialchars($s['nama']) ?></td>
                            <td>
                                <select name="status[<?= $s['id'] ?>]" class="form-select form-select-sm">
                                    <?php foreach (['hadir','sakit','izin','pulang','alpha'] as $st): ?>
                                        <option value="<?= $st ?>" <?= ($s['status'] ?? 'hadir') === $st ? 'selected' : '' ?>><?= ucfirst($st) ?></option>
                                    <?php endforeach; ?>
                                </select>
                            </td>
                            <td><input type="text" name="keterangan[<?= $s['id'] ?>]" class="form-control form-control-sm" value="<?= htmlspecialchars($s['keterangan'] ?? '') ?>"></td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
                </div>
                <button class="btn btn-success" style="max-width:200px">Simpan Absensi</button>
            </div>
        </form>
    <?php elseif ($roomId): ?>
        <p class="text-muted small">Tidak ada santri aktif di kamar ini.</p>
    <?php endif; ?>

<?php
// ======================================================================
// RENDER: ABSENSI KEGIATAN
// ======================================================================
elseif ($modul === 'absensi_kegiatan'): ?>
    <a href="dashboard.php?modul=absensi" class="text-decoration-none small text-muted"><i class="bi bi-chevron-left"></i> Kembali</a>
    <h4 class="my-3">Absensi <?= htmlspecialchars($labelJenis) ?></h4>

    <div class="card card-hisada p-3 mb-3">
        <form method="get" class="row g-2 align-items-end" id="formAbsensiKegiatan">
            <input type="hidden" name="modul" value="absensi_kegiatan">
            <input type="hidden" name="jenis" value="<?= htmlspecialchars($jenis) ?>">
            <div class="col-md-6">
                <label class="form-label small"><?= $isEkskul ? 'Cabang' : 'Grup' ?></label>
                <select name="grup_id" class="form-select form-select-sm" required onchange="this.form.submit()">
                    <option value="">-- Pilih --</option>
                    <?php foreach ($grupList as $g): ?>
                        <option value="<?= $g['id'] ?>" <?= (string)$grupId === (string)$g['id'] ? 'selected' : '' ?>><?= htmlspecialchars($g['nama']) ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
            <div class="col-md-6">
                <label class="form-label small">Tanggal</label>
                <input type="date" name="tanggal" class="form-control form-control-sm" value="<?= htmlspecialchars($tanggal) ?>" onchange="this.form.submit()">
            </div>
        </form>
    </div>

    <?php if ($grupId && $students): ?>
        <form method="post">
            <input type="hidden" name="tanggal" value="<?= htmlspecialchars($tanggal) ?>">
            <div class="card card-hisada p-3">
                <div class="table-responsive">
                <table class="table table-sm align-middle">
                    <thead><tr><th>NIS</th><th>Nama</th><th style="width:160px">Status</th><th>Keterangan</th></tr></thead>
                    <tbody>
                    <?php foreach ($students as $s): ?>
                        <tr>
                            <td><?= htmlspecialchars($s['nis']) ?></td>
                            <td><?= htmlspecialchars($s['nama']) ?></td>
                            <td>
                                <select name="status[<?= $s['id'] ?>]" class="form-select form-select-sm">
                                    <?php foreach (['hadir','sakit','izin','pulang','alpha'] as $st): ?>
                                        <option value="<?= $st ?>" <?= ($s['status'] ?? 'hadir') === $st ? 'selected' : '' ?>><?= ucfirst($st) ?></option>
                                    <?php endforeach; ?>
                                </select>
                            </td>
                            <td><input type="text" name="keterangan[<?= $s['id'] ?>]" class="form-control form-control-sm" value="<?= htmlspecialchars($s['keterangan'] ?? '') ?>"></td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
                </div>
                <button class="btn btn-success" style="max-width:200px">Simpan Absensi</button>
            </div>
        </form>
    <?php elseif ($grupId): ?>
        <p class="text-muted small">Belum ada anggota terdaftar di grup ini.</p>
    <?php endif; ?>

<?php
// ======================================================================
// RENDER: POSKESTREN - ASISTEN
// ======================================================================
elseif ($modul === 'poskestren_asisten'): ?>
    <h4 class="mb-4">Poskestren &mdash; Input Kunjungan (Asisten)</h4>
    <div class="row g-3">
        <div class="col-md-5">
            <div class="card card-hisada p-3">
                <h6 class="mb-3">Catat Kunjungan Baru</h6>
                <form method="post">
                    <div class="mb-2">
                        <label class="form-label small">Santri</label>
                        <?php render_santri_picker('student_id', $students, 'poskestren'); ?>
                    </div>
                    <div class="mb-2"><label class="form-label small">Tanggal</label>
                        <input type="date" name="tanggal" class="form-control form-control-sm" value="<?= date('Y-m-d') ?>" required></div>
                    <div class="mb-2"><label class="form-label small">Keluhan</label>
                        <input type="text" name="keluhan" class="form-control form-control-sm" placeholder="Contoh: demam, pusing" required></div>
                    <div class="mb-3">
                        <label class="form-label small d-block">Jenis Kunjungan</label>
                        <div class="form-check form-check-inline">
                            <input class="form-check-input" type="radio" name="jenis_kunjungan" value="rawat_jalan" id="rj" checked>
                            <label class="form-check-label small" for="rj">Rawat Jalan (konsultasi saja)</label>
                        </div>
                        <div class="form-check form-check-inline">
                            <input class="form-check-input" type="radio" name="jenis_kunjungan" value="perawatan" id="pw">
                            <label class="form-check-label small" for="pw">Perawatan (sakit)</label>
                        </div>
                        <div class="form-text">Rawat Jalan tidak mengubah status absensi. Perawatan otomatis mengubah status hari ini jadi "Sakit".</div>
                    </div>
                    <button class="btn btn-success w-100">Simpan &amp; Estafetkan ke Dokter</button>
                </form>
            </div>
        </div>
        <div class="col-md-7">
            <div class="card card-hisada p-3">
                <h6 class="mb-3">Riwayat Kunjungan Terbaru</h6>
                <div class="table-responsive">
                <table class="table table-sm">
                    <thead><tr><th>Tanggal</th><th>Santri</th><th>Keluhan</th><th>Jenis</th><th>Status Periksa Dokter</th></tr></thead>
                    <tbody>
                    <?php foreach ($riwayat as $r): ?>
                        <tr>
                            <td><?= date('d/m/Y', strtotime($r['tanggal'])) ?></td>
                            <td><?= htmlspecialchars($r['nama_santri']) ?></td>
                            <td><?= htmlspecialchars($r['keluhan']) ?></td>
                            <td><?php if ($r['jenis_kunjungan'] === 'perawatan'): ?><span class="badge badge-sakit">Perawatan</span><?php else: ?><span class="badge badge-hadir">Rawat Jalan</span><?php endif; ?></td>
                            <td><?= $r['diperiksa_oleh'] ? '<span class="text-success">Sudah diperiksa</span>' : '<span class="text-muted">Menunggu dokter</span>' ?></td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
                </div>
            </div>
        </div>
    </div>

<?php
// ======================================================================
// RENDER: POSKESTREN - DOKTER
// ======================================================================
elseif ($modul === 'poskestren_dokter'): ?>
    <h4 class="mb-4">Poskestren &mdash; Rekam Medis (Dokter)</h4>
    <div class="row g-3 mb-3">
        <div class="col-md-7">
            <div class="card card-hisada p-3">
                <h6 class="mb-3">Antrean Pemeriksaan (<?= count($antrean) ?>)</h6>
                <?php if (!$antrean): ?><p class="text-muted small mb-0">Tidak ada antrean saat ini.</p><?php endif; ?>
                <?php foreach ($antrean as $a): ?>
                    <div class="border rounded p-2 mb-2">
                        <div class="d-flex justify-content-between">
                            <strong><?= htmlspecialchars($a['nama_santri']) ?> (<?= htmlspecialchars($a['nis']) ?>)</strong>
                            <span class="badge <?= $a['jenis_kunjungan'] === 'perawatan' ? 'badge-sakit' : 'badge-hadir' ?>">
                                <?= $a['jenis_kunjungan'] === 'perawatan' ? 'Perawatan' : 'Rawat Jalan' ?>
                            </span>
                        </div>
                        <div class="small text-muted mb-2"><?= date('d/m/Y', strtotime($a['tanggal'])) ?> - Keluhan: <?= htmlspecialchars($a['keluhan']) ?></div>
                        <form method="post" class="row g-1">
                            <input type="hidden" name="record_id" value="<?= $a['id'] ?>">
                            <div class="col-12"><input type="text" name="diagnosa" class="form-control form-control-sm" placeholder="Diagnosa" required></div>
                            <div class="col-12"><input type="text" name="resep" class="form-control form-control-sm" placeholder="Resep obat"></div>
                            <div class="col-12"><input type="text" name="tindak_lanjut" class="form-control form-control-sm" placeholder="Tindak lanjut"></div>
                            <div class="col-12"><button class="btn btn-sm btn-success mt-1">Simpan Pemeriksaan</button></div>
                        </form>
                    </div>
                <?php endforeach; ?>
            </div>
        </div>
        <div class="col-md-5">
            <div class="card card-hisada p-3">
                <h6 class="mb-1">Analisis Musim Sakit</h6>
                <div class="small text-muted mb-3">Tren kunjungan 6 bulan terakhir</div>
                <div class="table-responsive">
                <table class="table table-sm mb-4">
                    <thead><tr><th>Bulan</th><th>Jumlah Kunjungan</th></tr></thead>
                    <tbody>
                    <?php foreach ($trenBulanan as $t): $tglBulan = new DateTime($t['bulan'].'-01'); ?><tr><td><?= nama_bulan_indo($tglBulan->format('F')) . ' ' . $tglBulan->format('Y') ?></td><td><?= $t['jumlah'] ?></td></tr><?php endforeach; ?>
                    <?php if (!$trenBulanan): ?><tr><td colspan="2" class="text-muted">Belum ada data.</td></tr><?php endif; ?>
                    </tbody>
                </table>
                </div>
                <div class="small text-muted mb-2">Keluhan Terbanyak (indikasi pola musiman)</div>
                <?php foreach ($keluhanTerbanyak as $k): ?>
                    <div class="mb-2">
                        <div class="d-flex justify-content-between small"><span><?= htmlspecialchars($k['keluhan']) ?></span><span><?= $k['jumlah'] ?></span></div>
                        <div class="progress" style="height:6px"><div class="progress-bar bg-success" style="width:<?= round($k['jumlah']/$maxJumlah*100) ?>%"></div></div>
                    </div>
                <?php endforeach; ?>
                <?php if (!$keluhanTerbanyak): ?><p class="text-muted small mb-0">Belum ada data.</p><?php endif; ?>
            </div>
        </div>
    </div>

<?php
// ======================================================================
// RENDER: MAHKAMAH - SEKRETARIS
// ======================================================================
elseif ($modul === 'mahkamah_sekretaris'): ?>
    <h4 class="mb-4">Mahkamah Santri &mdash; Input Pelanggaran (Sekretaris)</h4>
    <div class="row g-3">
        <div class="col-md-5">
            <div class="card card-hisada p-3">
                <h6 class="mb-3">Catat Pelanggaran</h6>
                <form method="post">
                    <div class="mb-2">
                        <label class="form-label small">Santri (cari NIS/nama)</label>
                        <?php render_santri_picker('student_id', $students, 'mahkamah'); ?>
                    </div>
                    <div class="mb-2"><label class="form-label small">Kategori</label>
                        <select name="kategori" class="form-select form-select-sm" required>
                            <?php foreach ($kategoriList as $k): ?><option><?= $k ?></option><?php endforeach; ?>
                        </select>
                    </div>
                    <div class="mb-2"><label class="form-label small">Tanggal</label>
                        <input type="date" name="tanggal" class="form-control form-control-sm" value="<?= date('Y-m-d') ?>" required></div>
                    <div class="mb-3"><label class="form-label small">Keterangan</label>
                        <textarea name="keterangan" class="form-control form-control-sm" rows="3" required></textarea></div>
                    <button class="btn btn-success w-100">Simpan &amp; Masukkan Antrean Sidang</button>
                </form>
            </div>
        </div>
        <div class="col-md-7">
            <div class="card card-hisada p-3">
                <h6 class="mb-3">Antrean Menunggu Sidang (<?= count($antrean) ?>)</h6>
                <div class="table-responsive">
                <table class="table table-sm">
                    <thead><tr><th>Tanggal</th><th>Santri</th><th>Kategori</th><th>Keterangan</th></tr></thead>
                    <tbody>
                    <?php foreach ($antrean as $a): ?>
                        <tr>
                            <td><?= date('d/m/Y', strtotime($a['tanggal'])) ?></td>
                            <td><?= htmlspecialchars($a['nama_santri']) ?></td>
                            <td><?= htmlspecialchars($a['kategori']) ?></td>
                            <td class="small"><?= htmlspecialchars($a['keterangan']) ?></td>
                        </tr>
                    <?php endforeach; ?>
                    <?php if (!$antrean): ?><tr><td colspan="4" class="text-muted small">Antrean kosong.</td></tr><?php endif; ?>
                    </tbody>
                </table>
                </div>
            </div>
        </div>
    </div>

<?php
// ======================================================================
// RENDER: MAHKAMAH - HAKIM
// ======================================================================
elseif ($modul === 'mahkamah_hakim'): ?>
    <h4 class="mb-4">Mahkamah Santri &mdash; Sidang &amp; Vonis (Hakim)</h4>
    <div class="card card-hisada p-3 mb-3">
        <form method="get" class="row g-2 align-items-end">
            <input type="hidden" name="modul" value="mahkamah_hakim">
            <div class="col-md-4">
                <label class="form-label small">Filter Kategori</label>
                <select name="kategori" class="form-select form-select-sm" onchange="this.form.submit()">
                    <option value="">Semua Kategori</option>
                    <?php foreach ($kategoriList as $k): ?><option value="<?= htmlspecialchars($k) ?>" <?= $kategoriFilter === $k ? 'selected' : '' ?>><?= htmlspecialchars($k) ?></option><?php endforeach; ?>
                </select>
            </div>
        </form>
    </div>
    <?php if (!$antrean): ?><p class="text-muted small">Tidak ada antrean sidang untuk kategori ini.</p><?php endif; ?>
    <?php foreach ($antrean as $a): ?>
        <div class="card card-hisada p-3 mb-3">
            <div class="d-flex justify-content-between">
                <div>
                    <strong><?= htmlspecialchars($a['nama_santri']) ?></strong> (<?= htmlspecialchars($a['nis']) ?>)
                    <div class="small text-muted"><?= date('d/m/Y', strtotime($a['tanggal'])) ?> &middot; <?= htmlspecialchars($a['kategori']) ?></div>
                </div>
            </div>
            <p class="small mt-2 mb-3"><?= htmlspecialchars($a['keterangan']) ?></p>
            <div class="row g-2">
                <div class="col-md-7">
                    <form method="post" class="d-flex gap-2">
                        <input type="hidden" name="violation_id" value="<?= $a['id'] ?>">
                        <input type="hidden" name="action" value="vonis">
                        <select name="vonis" class="form-select form-select-sm" required>
                            <option value="">-- Pilih Vonis --</option>
                            <option value="ringan">Ringan</option><option value="sedang">Sedang</option><option value="berat">Berat</option>
                        </select>
                        <button class="btn btn-sm btn-success">Jatuhkan Vonis</button>
                    </form>
                </div>
                <div class="col-md-5">
                    <button type="button" class="btn btn-sm btn-outline-secondary w-100" data-bs-toggle="modal" data-bs-target="#modalPutih<?= $a['id'] ?>">Pemutihan (Batalkan)</button>
                </div>
            </div>
        </div>
        <div class="modal fade" id="modalPutih<?= $a['id'] ?>" tabindex="-1">
            <div class="modal-dialog">
                <form method="post" class="modal-content">
                    <input type="hidden" name="violation_id" value="<?= $a['id'] ?>">
                    <input type="hidden" name="action" value="pemutihan">
                    <div class="modal-header"><h6 class="modal-title">Pemutihan Pelanggaran</h6></div>
                    <div class="modal-body">
                        <label class="form-label small">Alasan Pembatalan</label>
                        <textarea name="alasan_pembatalan" class="form-control form-control-sm" rows="3" required></textarea>
                        <div class="form-text">Data pelanggaran tidak dihapus, hanya ditandai batal (audit trail tetap tersimpan).</div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Batal</button>
                        <button class="btn btn-sm btn-danger">Konfirmasi Pemutihan</button>
                    </div>
                </form>
            </div>
        </div>
    <?php endforeach; ?>

<?php
// ======================================================================
// RENDER: PERIZINAN & KAMTIB
// ======================================================================
elseif ($modul === 'perizinan'): ?>
    <h4 class="mb-4">Perizinan &amp; Kamtib</h4>
    <?php if ($overdueList): ?>
        <div class="alert alert-warning py-2 small"><?= count($overdueList) ?> santri baru saja terdeteksi overdue &mdash; otomatis masuk antrean Mahkamah.</div>
    <?php endif; ?>
    <div class="row g-3">
        <div class="col-md-5">
            <div class="card card-hisada p-3">
                <h6 class="mb-3">Ajukan Izin Baru</h6>
                <form method="post" id="formIzinBaru">
                    <input type="hidden" name="form" value="baru">
                    <div class="mb-2">
                        <label class="form-label small">Santri</label>
                        <?php render_santri_picker('student_id', $students, 'perizinan'); ?>
                    </div>
                    <div class="mb-2">
                        <label class="form-label small d-block">Jenis</label>
                        <div class="form-check form-check-inline">
                            <input class="form-check-input jenis-izin" type="radio" name="jenis" value="keluar_sementara" checked>
                            <label class="form-check-label small">Keluar Sementara</label>
                        </div>
                        <div class="form-check form-check-inline">
                            <input class="form-check-input jenis-izin" type="radio" name="jenis" value="izin_dinas">
                            <label class="form-check-label small">Izin Dinas</label>
                        </div>
                        <div class="form-check form-check-inline">
                            <input class="form-check-input jenis-izin" type="radio" name="jenis" value="pulang">
                            <label class="form-check-label small">Pulang</label>
                        </div>
                    </div>

                    <div id="fieldKeluarSementara" class="mb-2">
                        <div class="form-text mb-1">Mulai dihitung otomatis dari jam saat ini (<?= date('H:i') ?>).</div>
                        <label class="form-label small">Sampai Jam</label>
                        <input type="time" name="jam_selesai" class="form-control form-control-sm" value="16:00">
                    </div>

                    <div id="fieldIzinDinas" class="mb-2 d-none">
                        <div class="row g-2">
                            <div class="col-6"><label class="form-label small">Tanggal Mulai</label><input type="date" name="tanggal_mulai_dinas" class="form-control form-control-sm" value="<?= date('Y-m-d') ?>"></div>
                            <div class="col-6"><label class="form-label small">Jam Mulai</label><input type="time" name="jam_mulai_dinas" class="form-control form-control-sm" value="<?= date('H:i') ?>"></div>
                            <div class="col-6"><label class="form-label small">Tanggal Selesai</label><input type="date" name="tanggal_selesai_dinas" class="form-control form-control-sm" value="<?= date('Y-m-d') ?>"></div>
                            <div class="col-6"><label class="form-label small">Jam Selesai</label><input type="time" name="jam_selesai_dinas" class="form-control form-control-sm" value="16:00"></div>
                        </div>
                    </div>

                    <div id="fieldPulang" class="mb-2 d-none">
                        <div class="row g-2">
                            <div class="col-6"><label class="form-label small">Dari Tanggal</label><input type="date" name="tanggal_mulai_pulang" id="izinTglMulai" class="form-control form-control-sm" value="<?= date('Y-m-d') ?>"></div>
                            <div class="col-6"><label class="form-label small">Sampai Tanggal</label><input type="date" name="tanggal_selesai_pulang" id="izinTglSelesai" class="form-control form-control-sm"></div>
                        </div>
                    </div>

                    <div class="mb-3"><label class="form-label small">Keterangan</label>
                        <input type="text" name="keterangan" class="form-control form-control-sm" placeholder="Alasan izin"></div>
                    <button class="btn btn-success w-100">Simpan Izin</button>
                </form>
                <script>
                (function () {
                    var radios = document.querySelectorAll('.jenis-izin');
                    var blocks = {
                        keluar_sementara: document.getElementById('fieldKeluarSementara'),
                        izin_dinas: document.getElementById('fieldIzinDinas'),
                        pulang: document.getElementById('fieldPulang'),
                    };
                    function updateBlocks() {
                        var dipilih = document.querySelector('.jenis-izin:checked').value;
                        Object.keys(blocks).forEach(function (key) {
                            blocks[key].classList.toggle('d-none', key !== dipilih);
                        });
                    }
                    radios.forEach(function (r) { r.addEventListener('change', updateBlocks); });
                    updateBlocks();

                    var mulaiPulang = document.getElementById('izinTglMulai');
                    var selesaiPulang = document.getElementById('izinTglSelesai');
                    if (mulaiPulang && selesaiPulang) {
                        function syncMin() { selesaiPulang.min = mulaiPulang.value; }
                        mulaiPulang.addEventListener('change', syncMin);
                        syncMin();
                    }
                })();
                </script>
            </div>
        </div>
        <div class="col-md-7">
            <div class="card card-hisada p-3">
                <h6 class="mb-3">Izin Sedang Berjalan / Overdue</h6>
                <div class="table-responsive">
                <table class="table table-sm">
                    <thead><tr><th>Santri</th><th>Jenis</th><th>Sampai</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                    <?php foreach ($berjalan as $b): ?>
                        <tr>
                            <td><?= htmlspecialchars($b['nama_santri']) ?></td>
                            <td><?= ['keluar_sementara' => 'Keluar Sementara', 'izin_dinas' => 'Izin Dinas', 'pulang' => 'Pulang'][$b['jenis']] ?></td>
                            <td><?= date('d/m/Y', strtotime($b['tanggal_selesai'])) ?><?= $b['jam_selesai'] ? ' ' . substr($b['jam_selesai'], 0, 5) : '' ?></td>
                            <td><?php if ($b['status'] === 'overdue'): ?><span class="badge badge-alpha">Overdue</span><?php else: ?><span class="badge badge-izin">Berjalan</span><?php endif; ?></td>
                            <td class="text-nowrap">
                                <a href="dashboard.php?modul=perizinan&print=<?= $b['id'] ?>" target="_blank" class="btn btn-sm btn-outline-secondary" title="Cetak surat"><i class="bi bi-printer"></i></a>
                                <form method="post" class="d-inline">
                                    <input type="hidden" name="form" value="konfirmasi">
                                    <input type="hidden" name="permit_id" value="<?= $b['id'] ?>">
                                    <button class="btn btn-sm btn-outline-success">Konfirmasi Kembali</button>
                                </form>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                    <?php if (!$berjalan): ?><tr><td colspan="5" class="text-muted small">Tidak ada izin berjalan.</td></tr><?php endif; ?>
                    </tbody>
                </table>
                </div>
            </div>
        </div>
    </div>

<?php
// ======================================================================
// RENDER: KORESPONDENSI
// ======================================================================
elseif ($modul === 'korespondensi'): ?>
    <h4 class="mb-4">Korespondensi</h4>
    <ul class="nav nav-tabs mb-3">
        <li class="nav-item"><button class="nav-link active" data-bs-toggle="tab" data-bs-target="#tabKeluar">Surat Keluar</button></li>
        <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabMasuk">Surat Masuk</button></li>
        <li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabDaftar">Daftar Arsip</button></li>
    </ul>
    <div class="tab-content">
        <div class="tab-pane fade show active card card-hisada p-3" id="tabKeluar">
            <form method="post">
                <input type="hidden" name="jenis" value="keluar">
                <div class="row g-2">
                    <div class="col-md-4"><label class="form-label small">Nomor Surat</label><input type="text" name="nomor_surat" class="form-control form-control-sm" placeholder="Contoh: 001/PONTREN-HISADA/IX/2026" required></div>
                    <div class="col-md-5"><label class="form-label small">Perihal</label><input type="text" name="perihal" class="form-control form-control-sm" required></div>
                    <div class="col-md-3"><label class="form-label small">Tanggal</label><input type="date" name="tanggal" class="form-control form-control-sm" value="<?= date('Y-m-d') ?>" required></div>
                    <div class="col-md-6"><label class="form-label small">Tujuan</label><input type="text" name="tujuan" class="form-control form-control-sm" placeholder="Wali santri / instansi" required></div>
                    <div class="col-md-6"><label class="form-label small">Link Lampiran (Google Docs)</label><input type="url" name="link_lampiran" class="form-control form-control-sm" placeholder="https://docs.google.com/document/d/..."></div>
                </div>
                <button class="btn btn-success mt-2">Terbitkan Surat</button>
            </form>
        </div>
        <div class="tab-pane fade card card-hisada p-3" id="tabMasuk">
            <form method="post">
                <input type="hidden" name="jenis" value="masuk">
                <div class="row g-2">
                    <div class="col-md-4"><label class="form-label small">Nomor Surat (sesuai fisik)</label><input type="text" name="nomor_surat" class="form-control form-control-sm" required></div>
                    <div class="col-md-4"><label class="form-label small">Dari Instansi</label><input type="text" name="dari_instansi" class="form-control form-control-sm" required></div>
                    <div class="col-md-4"><label class="form-label small">Tanggal</label><input type="date" name="tanggal" class="form-control form-control-sm" value="<?= date('Y-m-d') ?>" required></div>
                    <div class="col-md-6"><label class="form-label small">Perihal</label><input type="text" name="perihal" class="form-control form-control-sm" required></div>
                    <div class="col-md-3"><label class="form-label small">Status Disposisi</label>
                        <select name="status_disposisi" class="form-select form-select-sm">
                            <option value="belum_dibaca">Belum Dibaca</option><option value="diteruskan">Diteruskan</option>
                            <option value="disetujui">Disetujui</option><option value="diarsipkan">Diarsipkan</option>
                        </select>
                    </div>
                    <div class="col-md-3"><label class="form-label small">Link Scan (opsional)</label><input type="url" name="link_lampiran" class="form-control form-control-sm" placeholder="https://docs.google.com/document/d/..."></div>
                </div>
                <button class="btn btn-success mt-2">Catat Surat Masuk</button>
            </form>
        </div>
        <div class="tab-pane fade card card-hisada p-3" id="tabDaftar">
            <div class="d-flex justify-content-end mb-2">
                <a href="dashboard.php?modul=korespondensi&export=xlsx" class="btn btn-sm btn-outline-success"><i class="bi bi-file-earmark-excel me-1"></i>Export Excel</a>
            </div>
            <div class="table-responsive">
            <table class="table table-sm">
                <thead><tr><th>Nomor</th><th>Jenis</th><th>Perihal</th><th>Tanggal</th><th>Status</th></tr></thead>
                <tbody>
                <?php foreach ($daftarSurat as $d): ?>
                    <tr>
                        <td class="small"><?= htmlspecialchars($d['nomor_surat']) ?></td>
                        <td><?= $d['jenis'] === 'keluar' ? 'Keluar' : 'Masuk' ?></td>
                        <td><?= htmlspecialchars($d['perihal']) ?></td>
                        <td><?= date('d/m/Y', strtotime($d['tanggal'])) ?></td>
                        <td class="small"><?= htmlspecialchars($d['status_disposisi'] ?? '-') ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
            </div>
        </div>
    </div>

<?php
// ======================================================================
// RENDER: PRESTASI SANTRI
// ======================================================================
elseif ($modul === 'prestasi'): ?>
    <h4 class="mb-4">Prestasi Santri</h4>
    <div class="row g-3">
        <div class="col-md-5">
            <div class="card card-hisada p-3">
                <h6 class="mb-3">Tambah Prestasi</h6>
                <form method="post">
                    <div class="mb-2">
                        <label class="form-label small">Santri</label>
                        <?php render_santri_picker('student_id', $students, 'prestasi'); ?>
                    </div>
                    <div class="mb-2"><label class="form-label small">Nama Kegiatan</label><input type="text" name="nama_kegiatan" class="form-control form-control-sm" required></div>
                    <div class="mb-2"><label class="form-label small">Lokasi</label><input type="text" name="lokasi" class="form-control form-control-sm"></div>
                    <div class="mb-2"><label class="form-label small">Tingkat</label>
                        <select name="tingkat" class="form-select form-select-sm"><option value="internal">Internal</option><option value="eksternal">Eksternal</option></select>
                    </div>
                    <div class="mb-2"><label class="form-label small">Tanggal</label><input type="date" name="tanggal" class="form-control form-control-sm" value="<?= date('Y-m-d') ?>"></div>
                    <div class="mb-3"><label class="form-label small">Keterangan</label><textarea name="keterangan" class="form-control form-control-sm" rows="2"></textarea></div>
                    <button class="btn btn-success w-100">Simpan</button>
                </form>
            </div>
        </div>
        <div class="col-md-7">
            <div class="card card-hisada p-3">
                <h6 class="mb-3 d-flex justify-content-between align-items-center">Galeri Prestasi Terbaru
                    <a href="dashboard.php?modul=prestasi&export=xlsx" class="btn btn-sm btn-outline-success"><i class="bi bi-file-earmark-excel me-1"></i>Export Excel</a>
                </h6>
                <div class="table-responsive">
                <table class="table table-sm">
                    <thead><tr><th>Santri</th><th>Kegiatan</th><th>Tingkat</th><th>Tanggal</th></tr></thead>
                    <tbody>
                    <?php foreach ($daftar as $d): ?>
                        <tr>
                            <td><?= htmlspecialchars($d['nama_santri']) ?></td>
                            <td><?= htmlspecialchars($d['nama_kegiatan']) ?></td>
                            <td><span class="badge <?= $d['tingkat'] === 'eksternal' ? 'badge-izin' : 'badge-hadir' ?>"><?= ucfirst($d['tingkat']) ?></span></td>
                            <td><?= $d['tanggal'] ? date('d/m/Y', strtotime($d['tanggal'])) : '-' ?></td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
                </div>
            </div>
        </div>
    </div>

<?php
// ======================================================================
// RENDER: KALENDER AKADEMIK
// ======================================================================
elseif ($modul === 'kalender'):
    $todayStr = date('Y-m-d');
    $compact = ($tampilan >= 6);
    if ($tampilan === 1) {
        $rentangLabel = nama_bulan_indo($firstDay->format('F')) . ' ' . $firstDay->format('Y');
    } elseif ($tampilan === 6) {
        $akhirSemester = (clone $firstDay)->modify('+5 months');
        $rentangLabel = 'Semester ' . nama_bulan_indo($firstDay->format('F')) . ' - ' . nama_bulan_indo($akhirSemester->format('F')) . ' ' . $akhirSemester->format('Y');
    } elseif ($tampilan === 12) {
        $akhirTahunAjaran = (clone $firstDay)->modify('+11 months');
        $rentangLabel = 'Tahun Ajaran ' . $firstDay->format('Y') . '/' . $akhirTahunAjaran->format('Y')
            . ' (' . nama_bulan_indo($firstDay->format('F')) . ' ' . $firstDay->format('Y') . ' - ' . nama_bulan_indo($akhirTahunAjaran->format('F')) . ' ' . $akhirTahunAjaran->format('Y') . ')';
    } else {
        $akhirRentang = (clone $firstDay)->modify('+' . ($tampilan - 1) . ' months');
        $rentangLabel = nama_bulan_indo($firstDay->format('F')) . ' ' . $firstDay->format('Y') . ' s.d. ' . nama_bulan_indo($akhirRentang->format('F')) . ' ' . $akhirRentang->format('Y');
    }
    $gridClass = $tampilan === 1 ? 'kalender-multi-1' : ($tampilan === 2 ? 'kalender-multi-2' : ($tampilan === 6 ? 'kalender-multi-6' : 'kalender-multi-12'));
?>
    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 kalender-toolbar">
        <h4 class="mb-0"><?= $rentangLabel ?></h4>
        <div class="d-flex align-items-center flex-wrap gap-2 no-print">
            <div class="d-flex flex-wrap gap-1">
                <?php foreach ([1 => '1 Bulan', 2 => '2 Bulan', 6 => '1 Semester', 12 => '2 Semester'] as $val => $lbl): ?>
                    <a href="dashboard.php?modul=kalender&tampilan=<?= $val ?>&bulan=<?= $firstDay->format('Y-m') ?>"
                       class="btn btn-sm rounded-2 <?= $tampilan === $val ? 'btn-success' : 'btn-outline-secondary' ?>"><?= $lbl ?></a>
                <?php endforeach; ?>
            </div>
            <div class="d-flex gap-2">
                <a href="dashboard.php?modul=kalender&tampilan=<?= $tampilan ?>&bulan=<?= $prevBulan ?>" class="kalender-nav-btn" aria-label="Sebelumnya"><i class="bi bi-chevron-left"></i></a>
                <a href="dashboard.php?modul=kalender&tampilan=<?= $tampilan ?>&bulan=<?= $nextBulan ?>" class="kalender-nav-btn" aria-label="Berikutnya"><i class="bi bi-chevron-right"></i></a>
                <button type="button" class="kalender-nav-btn" onclick="window.print()" aria-label="Cetak"><i class="bi bi-printer"></i></button>
            </div>
        </div>
    </div>
    <div class="kalender-legend">
        <span><span class="dot agenda-umum"></span>Umum</span>
        <span><span class="dot agenda-akademik"></span>Akademik</span>
        <span><span class="dot agenda-pengasuhan"></span>Pengasuhan</span>
        <?php if ($bisaInput && !$compact): ?><span class="ms-auto no-print"><i class="bi bi-info-circle me-1"></i>Klik tanggal kosong untuk menambah agenda</span><?php endif; ?>
    </div>

    <div class="kalender-multi <?= $gridClass ?>">
        <?php foreach ($bulanList as $bln): ?>
            <div class="kalender-month-block card card-hisada p-3">
                <?php if ($tampilan > 1): ?><h6 class="mb-2"><?= $bln['label'] ?></h6><?php endif; ?>
                <div class="kalender-grid<?= $compact ? '-compact' : '' ?> mb-1">
                    <?php foreach (['Sen','Sel','Rab','Kam','Jum','Sab','Min'] as $h): ?><div class="dow"><?= $compact ? substr($h, 0, 1) : $h ?></div><?php endforeach; ?>
                </div>
                <div class="kalender-grid<?= $compact ? '-compact' : '' ?>">
                    <?php for ($i = 1; $i < $bln['startWeekday']; $i++): ?><div class="kalender-cell<?= $compact ? '-compact' : '' ?> empty"></div><?php endfor; ?>
                    <?php for ($d = 1; $d <= $bln['daysInMonth']; $d++):
                        $tanggal = $bln['ym'] . '-' . str_pad($d, 2, '0', STR_PAD_LEFT);
                        $agendaHariIni = $agendaByDate[$tanggal] ?? [];
                        $isToday = ($tanggal === $todayStr);
                        $clickable = (!$compact && !$agendaHariIni && $bisaInput);
                        $cellClass = 'kalender-cell' . ($compact ? '-compact' : '') . ($isToday ? ' today' : '') . ($clickable ? ' clickable' : '');
                    ?>
                        <?php if ($compact): ?>
                            <div class="<?= $cellClass ?>" <?php if ($agendaHariIni): ?>title="<?= htmlspecialchars(implode(', ', array_column($agendaHariIni, 'judul'))) ?>"<?php endif; ?>>
                                <div class="tanggal"><?= $d ?></div>
                                <?php if ($agendaHariIni): ?>
                                    <div class="mini-dots">
                                        <?php foreach (array_slice($agendaHariIni, 0, 3) as $a): ?>
                                            <span class="dot <?= kalender_kategori_class($a) ?>"></span>
                                        <?php endforeach; ?>
                                    </div>
                                <?php endif; ?>
                            </div>
                        <?php else: ?>
                            <div class="<?= $cellClass ?>"
                                 <?php if ($clickable): ?>data-bs-toggle="modal" data-bs-target="#modalAgenda" onclick="setTanggal('<?= $tanggal ?>')"<?php endif; ?>>
                                <div class="tanggal"><?= $d ?></div>
                                <?php foreach ($agendaHariIni as $a): ?>
                                    <div class="kalender-agenda-chip <?= kalender_kategori_class($a) ?>" title="<?= htmlspecialchars($a['judul'] . ' - ' . $a['keterangan']) ?>"><?= htmlspecialchars($a['judul']) ?></div>
                                <?php endforeach; ?>
                                <?php if ($clickable): ?><div class="tambah-hint"><i class="bi bi-plus-lg"></i> agenda</div><?php endif; ?>
                            </div>
                        <?php endif; ?>
                    <?php endfor; ?>
                </div>
            </div>
        <?php endforeach; ?>
    </div>

    <?php if ($bisaInput): ?>
    <div class="modal fade" id="modalAgenda" tabindex="-1">
        <div class="modal-dialog">
            <form method="post" class="modal-content" id="formTambahAgenda">
                <div class="modal-header"><h6 class="modal-title">Tambah Agenda &mdash; <span id="tanggalLabel"></span></h6></div>
                <div class="modal-body">
                    <input type="hidden" name="tanggal" id="inputTanggal">
                    <div class="mb-2"><label class="form-label small">Judul Agenda</label><input type="text" name="judul" class="form-control form-control-sm" required></div>
                    <div class="mb-2"><label class="form-label small">Keterangan</label><textarea name="keterangan" class="form-control form-control-sm" rows="2"></textarea></div>
                    <div class="mb-1">
                        <label class="form-label small d-block">Kategori (bisa pilih 2 sekaligus)</label>
                        <div class="form-check form-check-inline"><input class="form-check-input kategori-check" type="checkbox" name="kategori_umum" id="catUmum"><label class="form-check-label small" for="catUmum">Umum</label></div>
                        <div class="form-check form-check-inline"><input class="form-check-input kategori-check" type="checkbox" name="kategori_akademik" id="catAkademik"><label class="form-check-label small" for="catAkademik">Akademik</label></div>
                        <div class="form-check form-check-inline"><input class="form-check-input kategori-check" type="checkbox" name="kategori_pengasuhan" id="catPengasuhan"><label class="form-check-label small" for="catPengasuhan">Pengasuhan</label></div>
                        <div class="form-text">Kombinasi umum ditampilkan ke wali santri; kombinasi lain hanya internal. Pilih minimal satu.</div>
                        <div class="text-danger small d-none" id="kategoriError">Pilih minimal satu kategori.</div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Batal</button>
                    <button class="btn btn-sm btn-success">Simpan Agenda</button>
                </div>
            </form>
        </div>
    </div>
    <script>
    function setTanggal(tgl) {
        document.getElementById('inputTanggal').value = tgl;
        document.getElementById('tanggalLabel').innerText = tgl;
    }
    document.getElementById('formTambahAgenda').addEventListener('submit', function (e) {
        var checked = document.querySelectorAll('.kategori-check:checked').length > 0;
        document.getElementById('kategoriError').classList.toggle('d-none', checked);
        if (!checked) {
            e.preventDefault();
        }
    });
    </script>
    <?php endif; ?>

<?php
// ======================================================================
// RENDER: PENCARIAN SANTRI & GURU
// ======================================================================
elseif ($modul === 'cari_santri'): ?>
    <h4 class="mb-4">Cari Santri</h4>
    <div class="card card-hisada p-3 mb-3">
        <form method="get" class="row g-2 align-items-end">
            <input type="hidden" name="modul" value="cari_santri">
            <div class="col-md-8">
                <label class="form-label small">Ketik NIS / Nama (hasil muncul otomatis)</label>
                <input type="text" id="liveSearchSantri" class="form-control form-control-sm" placeholder="Contoh: fa -> Fajar, Fajrul, dst.">
            </div>
            <div class="col-md-4">
                <label class="form-label small">Filter Kamar</label>
                <select name="kamar_id" class="form-select form-select-sm" onchange="this.form.submit()">
                    <option value="">Semua Kamar</option>
                    <?php foreach ($rooms as $r): ?>
                        <option value="<?= $r['id'] ?>" <?= (string)$kamarId === (string)$r['id'] ? 'selected' : '' ?>><?= htmlspecialchars($r['gedung'] . ' - ' . $r['nama_kamar']) ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
        </form>
    </div>

    <div class="card card-hisada p-3">
        <h6 class="mb-3"><i class="bi bi-people me-1"></i>Hasil (<span id="jmlHasilSantri"><?= count($hasilSantri) ?></span>)</h6>
        <div class="table-responsive">
        <table class="table table-sm">
            <thead><tr><th>NIS</th><th>Nama</th><th>Kamar</th></tr></thead>
            <tbody id="tbodySantri">
            <?php foreach ($hasilSantri as $s): ?>
                <tr data-nis="<?= htmlspecialchars(strtolower($s['nis'])) ?>" data-nama="<?= htmlspecialchars(strtolower($s['nama'])) ?>">
                    <td><?= htmlspecialchars($s['nis']) ?></td>
                    <td><?= htmlspecialchars($s['nama']) ?></td>
                    <td class="small"><?= $s['nama_kamar'] ? htmlspecialchars($s['gedung'].' - '.$s['nama_kamar']) : '-' ?></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        <p class="text-muted small d-none" id="santriKosong">Tidak ditemukan.</p>
        </div>
    </div>
    <script>
    (function () {
        var input = document.getElementById('liveSearchSantri');
        var rows = Array.from(document.querySelectorAll('#tbodySantri tr'));
        var jmlEl = document.getElementById('jmlHasilSantri');
        var kosongEl = document.getElementById('santriKosong');
        input.addEventListener('input', function () {
            var q = input.value.trim().toLowerCase();
            var jml = 0;
            rows.forEach(function (row) {
                var cocok = !q || row.dataset.nis.includes(q) || row.dataset.nama.includes(q);
                row.style.display = cocok ? '' : 'none';
                if (cocok) jml++;
            });
            jmlEl.textContent = jml;
            kosongEl.classList.toggle('d-none', jml > 0);
        });
    })();
    </script>

<?php
// ======================================================================
// RENDER: CARI GURU
// ======================================================================
elseif ($modul === 'cari_guru'): ?>
    <h4 class="mb-4">Cari Guru</h4>
    <div class="card card-hisada p-3 mb-3">
        <label class="form-label small">Ketik NIP / Nama (hasil muncul otomatis)</label>
        <input type="text" id="liveSearchGuru" class="form-control form-control-sm" placeholder="Contoh: fa -> Fauzan, dst.">
    </div>

    <div class="card card-hisada p-3">
        <h6 class="mb-3"><i class="bi bi-person-workspace me-1"></i>Hasil (<span id="jmlHasilGuru"><?= count($hasilGuru) ?></span>)</h6>
        <div class="table-responsive">
        <table class="table table-sm">
            <thead><tr><th>NIP</th><th>Nama</th><th>No. HP</th><th>Wali Kamar</th></tr></thead>
            <tbody id="tbodyGuru">
            <?php foreach ($hasilGuru as $g): ?>
                <tr data-nip="<?= htmlspecialchars(strtolower($g['nip'] ?? '')) ?>" data-nama="<?= htmlspecialchars(strtolower($g['nama'])) ?>">
                    <td><?= htmlspecialchars($g['nip'] ?? '-') ?></td>
                    <td><?= htmlspecialchars($g['nama']) ?></td>
                    <td class="small"><?= htmlspecialchars($g['no_hp'] ?? '-') ?></td>
                    <td class="small"><?= $g['nama_kamar'] ? htmlspecialchars($g['gedung'].' - '.$g['nama_kamar']) : '-' ?></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        <p class="text-muted small d-none" id="guruKosong">Tidak ditemukan.</p>
        </div>
    </div>
    <script>
    (function () {
        var input = document.getElementById('liveSearchGuru');
        var rows = Array.from(document.querySelectorAll('#tbodyGuru tr'));
        var jmlEl = document.getElementById('jmlHasilGuru');
        var kosongEl = document.getElementById('guruKosong');
        input.addEventListener('input', function () {
            var q = input.value.trim().toLowerCase();
            var jml = 0;
            rows.forEach(function (row) {
                var cocok = !q || row.dataset.nip.includes(q) || row.dataset.nama.includes(q);
                row.style.display = cocok ? '' : 'none';
                if (cocok) jml++;
            });
            jmlEl.textContent = jml;
            kosongEl.classList.toggle('d-none', jml > 0);
        });
    })();
    </script>

<?php
// ======================================================================
// RENDER: KELOLA USER
// ======================================================================
elseif ($modul === 'kelola_user'): ?>
    <div class="d-flex justify-content-between align-items-center mb-4">
        <h4 class="mb-0">Kelola User</h4>
        <button class="btn btn-success btn-sm" data-bs-toggle="modal" data-bs-target="#modalTambahUser"><i class="bi bi-plus-lg me-1"></i>Tambah User</button>
    </div>
    <div class="card card-hisada p-3">
        <div class="table-responsive">
        <table class="table table-sm align-middle">
            <thead><tr><th>Nama</th><th>Email</th><th>NIS</th><th>Jabatan Aktif</th><th>Status</th><th></th></tr></thead>
            <tbody>
            <?php foreach ($daftarUser as $u): ?>
                <tr>
                    <td><?= htmlspecialchars($u['nama']) ?></td>
                    <td class="small"><?= htmlspecialchars($u['email']) ?></td>
                    <td><?= htmlspecialchars($u['nis'] ?? '-') ?></td>
                    <td><?= htmlspecialchars($u['posisi_aktif'] ?? ($u['is_super_admin'] ? 'Super Admin' : '-')) ?></td>
                    <td><span class="badge <?= $u['status'] === 'aktif' ? 'badge-hadir' : 'badge-alpha' ?>"><?= ucfirst($u['status']) ?></span></td>
                    <td><button class="btn btn-sm btn-outline-secondary" data-bs-toggle="modal" data-bs-target="#modalEdit<?= $u['id'] ?>">Edit</button></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        </div>
    </div>

    <?php /* Modal HARUS di luar <table> -- kalau ditaruh di dalam <tbody>, browser
             akan "membetulkan" HTML tidak valid itu dengan memindahkan elemennya
             ke tempat lain di DOM (foster parenting), dan modal Bootstrap jadi
             tidak terposisi sebagai overlay yang benar (tumpang tindih dgn tabel). */ ?>
    <?php foreach ($daftarUser as $u): ?>
        <div class="modal fade" id="modalEdit<?= $u['id'] ?>" tabindex="-1">
            <div class="modal-dialog">
                <form method="post" class="modal-content">
                    <input type="hidden" name="action" value="update">
                    <input type="hidden" name="id" value="<?= $u['id'] ?>">
                    <div class="modal-header"><h6 class="modal-title">Edit User &mdash; <?= htmlspecialchars($u['nama']) ?></h6></div>
                    <div class="modal-body">
                        <div class="mb-2"><label class="form-label small">Nama</label><input type="text" name="nama" class="form-control form-control-sm" value="<?= htmlspecialchars($u['nama']) ?>" required></div>
                        <div class="mb-2"><label class="form-label small">Email</label><input type="email" name="email" class="form-control form-control-sm" value="<?= htmlspecialchars($u['email']) ?>" required></div>
                        <div class="mb-2"><label class="form-label small">Password Baru (kosongkan jika tidak diubah)</label><input type="password" name="password" class="form-control form-control-sm"></div>
                        <div class="mb-2"><label class="form-label small">Status Akun</label>
                            <select name="status" class="form-select form-select-sm">
                                <option value="aktif" <?= $u['status']==='aktif'?'selected':'' ?>>Aktif</option>
                                <option value="nonaktif" <?= $u['status']==='nonaktif'?'selected':'' ?>>Nonaktif</option>
                            </select>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Batal</button>
                        <button class="btn btn-sm btn-success">Simpan Perubahan</button>
                    </div>
                </form>
            </div>
        </div>
    <?php endforeach; ?>

    <div class="modal fade" id="modalTambahUser" tabindex="-1">
        <div class="modal-dialog">
            <form method="post" class="modal-content">
                <input type="hidden" name="action" value="tambah_user">
                <div class="modal-header"><h6 class="modal-title">Tambah User (Angkat Pengurus Baru)</h6></div>
                <div class="modal-body">
                    <div class="mb-2">
                        <label class="form-label small">Santri</label>
                        <?php render_santri_picker('student_id', $semuaSantriAktif, 'tambahuser'); ?>
                    </div>
                    <div class="mb-2"><label class="form-label small">Posisi / Jabatan</label><input type="text" name="posisi" class="form-control form-control-sm" placeholder="Contoh: Sekretaris Mahkamah" required></div>
                    <div class="mb-2">
                        <label class="form-label small">Role (kunci teknis RBAC)</label>
                        <input type="text" name="role_key" class="form-control form-control-sm" list="roleKeyList" placeholder="Contoh: sekretaris_mahkamah" required>
                        <datalist id="roleKeyList">
                            <option value="admin"><option value="sekretaris"><option value="sekretaris_mahkamah">
                            <option value="hakim"><option value="asisten_poskestren"><option value="dokter">
                            <option value="piket"><option value="pelatih">
                        </datalist>
                    </div>
                    <div class="mb-2"><label class="form-label small">Tanggal Mulai Jabatan</label><input type="date" name="tanggal_mulai" class="form-control form-control-sm" value="<?= date('Y-m-d') ?>"></div>
                    <div class="form-check mb-2">
                        <input class="form-check-input" type="checkbox" name="punya_akses_sistem" id="punyaAksesBaru" onchange="document.getElementById('passwordBaruWrap').classList.toggle('d-none', !this.checked)">
                        <label class="form-check-label small" for="punyaAksesBaru">Beri akses login ke sistem</label>
                    </div>
                    <div id="passwordBaruWrap" class="mb-2 d-none">
                        <label class="form-label small">Password Awal</label>
                        <input type="text" name="password" class="form-control form-control-sm" placeholder="Password login pertama kali">
                        <div class="form-text">Email login dibuat otomatis: (NIS)@daarululuumlido.com</div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Batal</button>
                    <button class="btn btn-sm btn-success">Simpan</button>
                </div>
            </form>
        </div>
    </div>

<?php
// ======================================================================
// RENDER: SERAH TERIMA JABATAN
// ======================================================================
elseif ($modul === 'serah_terima'): ?>
    <h4 class="mb-4">Serah Terima Jabatan</h4>
    <div class="row g-3">
        <div class="col-md-6">
            <div class="card card-hisada p-3">
                <h6 class="mb-3">Masa Khidmat Aktif Saat Ini</h6>
                <?php if ($periodeAktif): ?>
                    <p class="mb-1"><strong><?= htmlspecialchars($periodeAktif['nama_periode']) ?></strong></p>
                    <p class="small text-muted mb-0">
                        <?= date('d/m/Y', strtotime($periodeAktif['tanggal_mulai'])) ?>
                        s.d. <?= $periodeAktif['tanggal_selesai'] ? date('d/m/Y', strtotime($periodeAktif['tanggal_selesai'])) : '(belum ditentukan)' ?>
                    </p>
                <?php else: ?>
                    <p class="text-muted small mb-0">Belum ada periode aktif.</p>
                <?php endif; ?>
            </div>
        </div>
    </div>

    <form method="post" id="formSerahTerima">
        <div class="card card-hisada p-3 mt-3">
            <h6 class="mb-3">Masa Khidmat Baru</h6>
            <div class="row g-2">
                <div class="col-md-6"><label class="form-label small">Nama Periode</label>
                    <input type="text" name="nama_periode" class="form-control form-control-sm" placeholder="Contoh: Khidmat 2026/2027" required></div>
                <div class="col-md-3"><label class="form-label small">Tanggal Mulai</label>
                    <input type="date" name="tanggal_mulai" class="form-control form-control-sm" required></div>
                <div class="col-md-3"><label class="form-label small">Tanggal Selesai (opsional)</label>
                    <input type="date" name="tanggal_selesai" class="form-control form-control-sm"></div>
            </div>
            <button type="button" class="btn btn-success mt-3" style="max-width:260px" data-bs-toggle="modal" data-bs-target="#modalSerahTerima">
                Serah Terima Jabatan
            </button>
        </div>
    </form>

    <div class="modal fade" id="modalSerahTerima" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header"><h6 class="modal-title">Konfirmasi Password Admin</h6></div>
                <div class="modal-body">
                    <label class="form-label small">Password</label>
                    <input type="password" id="passwordKonfirmasiTampil" class="form-control form-control-sm" required>
                    <div class="form-text">Tindakan ini akan mengarsipkan periode aktif dan mengaktifkan periode baru.</div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-sm btn-success" onclick="prosesSerahTerima()">Proses</button>
                </div>
            </div>
        </div>
    </div>
    <script>
    function prosesSerahTerima() {
        const form = document.getElementById('formSerahTerima');
        const pw = document.getElementById('passwordKonfirmasiTampil').value;
        const hidden = document.createElement('input');
        hidden.type = 'hidden'; hidden.name = 'password_konfirmasi'; hidden.value = pw;
        form.appendChild(hidden);
        form.submit();
    }
    </script>

<?php
// ======================================================================
// RENDER: DATA MASTER
// ======================================================================
elseif ($modul === 'data_master'): ?>
    <h4 class="mb-4">Data Master</h4>

    <?php if ($csvHasil): ?>
        <div class="card card-hisada p-3 mb-3">
            <h6 class="mb-2">Hasil Import CSV</h6>
            <p class="mb-1"><span class="badge badge-hadir"><?= $csvHasil['ditambah'] ?> ditambah</span>
               <span class="badge badge-izin ms-1"><?= $csvHasil['diperbarui'] ?> diperbarui</span>
               <?php if ($csvHasil['peringatan']): ?><span class="badge badge-sakit ms-1"><?= count($csvHasil['peringatan']) ?> peringatan</span><?php endif; ?>
               <?php if ($csvHasil['gagal']): ?><span class="badge badge-alpha ms-1"><?= count($csvHasil['gagal']) ?> gagal</span><?php endif; ?>
            </p>
            <?php foreach (array_merge($csvHasil['peringatan'], $csvHasil['gagal']) as $pesan): ?>
                <div class="small text-muted">&bull; <?= htmlspecialchars($pesan) ?></div>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>

    <ul class="nav nav-tabs mb-3 flex-wrap">
        <?php foreach (['santri' => 'Santri', 'guru' => 'Guru', 'kelas' => 'Kelas', 'kamar' => 'Kamar', 'keluarga' => 'Keluarga'] as $key => $lbl): ?>
            <li class="nav-item"><a class="nav-link <?= $tab === $key ? 'active' : '' ?>" href="dashboard.php?modul=data_master&tab=<?= $key ?>"><?= $lbl ?></a></li>
        <?php endforeach; ?>
    </ul>

    <?php if ($tab === 'santri'): ?>
        <div class="row g-3">
            <div class="col-md-5">
                <div class="card card-hisada p-3 mb-3">
                    <h6 class="mb-3">Tambah Santri (Satuan)</h6>
                    <form method="post">
                        <input type="hidden" name="action" value="tambah_santri">
                        <div class="row g-2">
                            <div class="col-6"><label class="form-label small">NIS</label><input type="text" name="nis" class="form-control form-control-sm" required></div>
                            <div class="col-6"><label class="form-label small">Nama</label><input type="text" name="nama" class="form-control form-control-sm" required></div>
                            <div class="col-6"><label class="form-label small">Jenis Kelamin</label>
                                <select name="jenis_kelamin" class="form-select form-select-sm"><option value="L">Laki-laki</option><option value="P">Perempuan</option></select>
                            </div>
                            <div class="col-6"><label class="form-label small">Tempat Lahir</label><input type="text" name="tempat_lahir" class="form-control form-control-sm"></div>
                            <div class="col-6"><label class="form-label small">Tanggal Lahir</label><input type="date" name="tanggal_lahir" class="form-control form-control-sm"></div>
                            <div class="col-6"><label class="form-label small">Tanggal Masuk</label><input type="date" name="tanggal_masuk" class="form-control form-control-sm"></div>
                            <div class="col-6"><label class="form-label small">Kelas</label>
                                <select name="class_id" class="form-select form-select-sm">
                                    <option value="">-- Pilih --</option>
                                    <?php foreach ($semuaKelas as $k): ?><option value="<?= $k['id'] ?>"><?= htmlspecialchars($k['nama']) ?></option><?php endforeach; ?>
                                </select>
                            </div>
                            <div class="col-6"><label class="form-label small">Kamar</label>
                                <select name="room_id" class="form-select form-select-sm">
                                    <option value="">-- Pilih --</option>
                                    <?php foreach ($semuaKamar as $r): ?><option value="<?= $r['id'] ?>"><?= htmlspecialchars($r['gedung'].' - '.$r['nama_kamar']) ?></option><?php endforeach; ?>
                                </select>
                            </div>
                        </div>
                        <button class="btn btn-success w-100 mt-2">Simpan</button>
                    </form>
                </div>
                <div class="card card-hisada p-3">
                    <h6 class="mb-2">Import CSV (Massal)</h6>
                    <p class="small text-muted">Kolom wajib: <code>nis, nama</code>. Opsional: <code>jenis_kelamin (L/P), tempat_lahir, tanggal_lahir (YYYY-MM-DD), tanggal_masuk, kelas, gedung, kamar</code>. NIS yang sudah ada akan <strong>diperbarui</strong>, bukan dobel.</p>
                    <form method="post" enctype="multipart/form-data">
                        <input type="hidden" name="action" value="csv_santri">
                        <input type="file" name="csv_file" accept=".csv" class="form-control form-control-sm mb-2" required>
                        <button class="btn btn-success w-100">Upload &amp; Proses</button>
                    </form>
                </div>
            </div>
            <div class="col-md-7">
                <div class="card card-hisada p-3">
                    <h6 class="mb-3">Daftar Santri (200 terbaru)</h6>
                    <div class="table-responsive">
                    <table class="table table-sm">
                        <thead><tr><th>NIS</th><th>Nama</th><th>Kelas</th><th>Kamar</th><th>Status</th><th></th></tr></thead>
                        <tbody>
                        <?php foreach ($daftarSantri as $s): ?>
                            <tr>
                                <td><?= htmlspecialchars($s['nis']) ?></td>
                                <td><?= htmlspecialchars($s['nama']) ?></td>
                                <td class="small"><?= htmlspecialchars($s['nama_kelas'] ?? '-') ?></td>
                                <td class="small"><?= $s['nama_kamar'] ? htmlspecialchars($s['gedung'].' - '.$s['nama_kamar']) : '-' ?></td>
                                <td><span class="badge <?= $s['status']==='aktif' ? 'badge-hadir' : 'badge-alpha' ?>"><?= ucfirst($s['status']) ?></span></td>
                                <td><button class="btn btn-sm btn-outline-secondary" data-bs-toggle="modal" data-bs-target="#modalEditSantri<?= $s['id'] ?>">Edit</button></td>
                            </tr>
                        <?php endforeach; ?>
                        </tbody>
                    </table>
                    </div>
                </div>
            </div>
        </div>

        <?php /* Modal edit -- di luar <table> spy tidak jadi bug modal-in-table lagi */ ?>
        <?php foreach ($daftarSantri as $s): ?>
            <div class="modal fade" id="modalEditSantri<?= $s['id'] ?>" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <form method="post" class="modal-content">
                        <input type="hidden" name="action" value="edit_santri">
                        <input type="hidden" name="student_id" value="<?= $s['id'] ?>">
                        <div class="modal-header"><h6 class="modal-title">Edit Santri &mdash; <?= htmlspecialchars($s['nama']) ?> (<?= htmlspecialchars($s['nis']) ?>)</h6></div>
                        <div class="modal-body">
                            <div class="row g-2 mb-2">
                                <div class="col-md-6"><label class="form-label small">Nama</label><input type="text" name="nama" class="form-control form-control-sm" value="<?= htmlspecialchars($s['nama']) ?>" required></div>
                                <div class="col-md-6"><label class="form-label small">Jenis Kelamin</label>
                                    <select name="jenis_kelamin" class="form-select form-select-sm">
                                        <option value="L" <?= $s['jenis_kelamin']==='L'?'selected':'' ?>>Laki-laki</option>
                                        <option value="P" <?= $s['jenis_kelamin']==='P'?'selected':'' ?>>Perempuan</option>
                                    </select>
                                </div>
                                <div class="col-md-6"><label class="form-label small">Kelas</label>
                                    <select name="class_id" class="form-select form-select-sm">
                                        <option value="">-- Kosongkan --</option>
                                        <?php foreach ($semuaKelas as $k): ?><option value="<?= $k['id'] ?>" <?= (string)$s['class_id']===(string)$k['id']?'selected':'' ?>><?= htmlspecialchars($k['nama']) ?></option><?php endforeach; ?>
                                    </select>
                                </div>
                                <div class="col-md-6"><label class="form-label small">Kamar</label>
                                    <select name="room_id" class="form-select form-select-sm">
                                        <option value="">-- Kosongkan --</option>
                                        <?php foreach ($semuaKamar as $r): ?><option value="<?= $r['id'] ?>" <?= (string)$s['room_id']===(string)$r['id']?'selected':'' ?>><?= htmlspecialchars($r['gedung'].' - '.$r['nama_kamar']) ?></option><?php endforeach; ?>
                                    </select>
                                    <div class="form-text">Ganti kamar otomatis tercatat di Riwayat Mutasi Kamar.</div>
                                </div>
                                <div class="col-md-12"><label class="form-label small">Status</label>
                                    <select name="status" class="form-select form-select-sm">
                                        <option value="aktif" <?= $s['status']==='aktif'?'selected':'' ?>>Aktif</option>
                                        <option value="alumni" <?= $s['status']==='alumni'?'selected':'' ?>>Alumni (Lulus)</option>
                                        <option value="keluar" <?= $s['status']==='keluar'?'selected':'' ?>>Keluar</option>
                                    </select>
                                    <div class="form-text">Selain "Aktif" akan otomatis menonaktifkan akun login santri ini (kalau ada).</div>
                                </div>
                            </div>
                            <hr>
                            <h6 class="small text-muted">Profil Kesehatan Tetap</h6>
                            <div class="row g-2">
                                <div class="col-md-4"><label class="form-label small">Golongan Darah</label>
                                    <select name="golongan_darah" class="form-select form-select-sm">
                                        <?php foreach (['A','B','AB','O','Tidak Tahu'] as $g): ?><option value="<?= $g ?>" <?= ($s['golongan_darah'] ?? 'Tidak Tahu')===$g?'selected':'' ?>><?= $g ?></option><?php endforeach; ?>
                                    </select>
                                </div>
                                <div class="col-md-4"><label class="form-label small">Alergi</label><input type="text" name="alergi" class="form-control form-control-sm" value="<?= htmlspecialchars($s['alergi'] ?? '') ?>" placeholder="Contoh: kacang, debu"></div>
                                <div class="col-md-4"><label class="form-label small">Penyakit Kronis</label><input type="text" name="penyakit_kronis" class="form-control form-control-sm" value="<?= htmlspecialchars($s['penyakit_kronis'] ?? '') ?>" placeholder="Contoh: asma"></div>
                                <div class="col-md-12"><label class="form-label small">Catatan Lain</label><textarea name="catatan_lain" class="form-control form-control-sm" rows="2"><?= htmlspecialchars($s['catatan_lain'] ?? '') ?></textarea></div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Batal</button>
                            <button class="btn btn-sm btn-success">Simpan Perubahan</button>
                        </div>
                    </form>
                </div>
            </div>
        <?php endforeach; ?>
        <div class="row g-3">
            <div class="col-md-5">
                <div class="card card-hisada p-3 mb-3">
                    <h6 class="mb-3">Tambah Guru (Satuan)</h6>
                    <form method="post">
                        <input type="hidden" name="action" value="tambah_guru">
                        <div class="mb-2"><label class="form-label small">NIP</label><input type="text" name="nip" class="form-control form-control-sm"></div>
                        <div class="mb-2"><label class="form-label small">Nama</label><input type="text" name="nama" class="form-control form-control-sm" required></div>
                        <div class="mb-2"><label class="form-label small">Jenis Kelamin</label>
                            <select name="jenis_kelamin" class="form-select form-select-sm"><option value="L">Laki-laki</option><option value="P">Perempuan</option></select>
                        </div>
                        <div class="mb-2"><label class="form-label small">No. HP</label><input type="text" name="no_hp" class="form-control form-control-sm"></div>
                        <div class="mb-2"><label class="form-label small">Wali Kamar (opsional)</label>
                            <select name="wali_kamar_room_id" class="form-select form-select-sm">
                                <option value="">-- Tidak menjabat wali kamar --</option>
                                <?php foreach ($daftarKamar as $r): ?><option value="<?= $r['id'] ?>"><?= htmlspecialchars($r['gedung'].' - '.$r['nama_kamar']) ?></option><?php endforeach; ?>
                            </select>
                        </div>
                        <button class="btn btn-success w-100">Simpan</button>
                    </form>
                </div>
                <div class="card card-hisada p-3">
                    <h6 class="mb-2">Import CSV (Massal)</h6>
                    <p class="small text-muted">Kolom wajib: <code>nip, nama</code>. Opsional: <code>jenis_kelamin (L/P), no_hp</code>. NIP yang sudah ada akan <strong>diperbarui</strong>.</p>
                    <form method="post" enctype="multipart/form-data">
                        <input type="hidden" name="action" value="csv_guru">
                        <input type="file" name="csv_file" accept=".csv" class="form-control form-control-sm mb-2" required>
                        <button class="btn btn-success w-100">Upload &amp; Proses</button>
                    </form>
                </div>
            </div>
            <div class="col-md-7">
                <div class="card card-hisada p-3">
                    <h6 class="mb-3">Daftar Guru</h6>
                    <div class="table-responsive">
                    <table class="table table-sm">
                        <thead><tr><th>NIP</th><th>Nama</th><th>No. HP</th><th>Wali Kamar</th></tr></thead>
                        <tbody>
                        <?php foreach ($daftarGuru as $g): ?>
                            <tr><td><?= htmlspecialchars($g['nip'] ?? '-') ?></td><td><?= htmlspecialchars($g['nama']) ?></td><td class="small"><?= htmlspecialchars($g['no_hp'] ?? '-') ?></td><td class="small"><?= $g['nama_kamar'] ? htmlspecialchars($g['gedung'].' - '.$g['nama_kamar']) : '-' ?></td></tr>
                        <?php endforeach; ?>
                        </tbody>
                    </table>
                    </div>
                </div>
            </div>
        </div>

    <?php elseif ($tab === 'kelas'): ?>
        <div class="row g-3">
            <div class="col-md-4">
                <div class="card card-hisada p-3 mb-3">
                    <h6 class="mb-3">Tambah Kelas</h6>
                    <form method="post">
                        <input type="hidden" name="action" value="tambah_kelas">
                        <input type="text" name="nama" class="form-control form-control-sm mb-2" placeholder="Contoh: Kelas 7" required>
                        <button class="btn btn-success w-100">Simpan</button>
                    </form>
                </div>
                <div class="card card-hisada p-3">
                    <h6 class="mb-2">Import CSV (Massal)</h6>
                    <p class="small text-muted">Kolom wajib: <code>nama</code>.</p>
                    <form method="post" enctype="multipart/form-data">
                        <input type="hidden" name="action" value="csv_kelas">
                        <input type="file" name="csv_file" accept=".csv" class="form-control form-control-sm mb-2" required>
                        <button class="btn btn-success w-100">Upload &amp; Proses</button>
                    </form>
                </div>
            </div>
            <div class="col-md-8">
                <div class="card card-hisada p-3">
                    <h6 class="mb-3">Daftar Kelas</h6>
                    <div class="table-responsive"><table class="table table-sm"><tbody>
                        <?php foreach ($daftarKelas as $k): ?><tr><td><?= htmlspecialchars($k['nama']) ?></td></tr><?php endforeach; ?>
                    </tbody></table></div>
                </div>
            </div>
        </div>

    <?php elseif ($tab === 'kamar'): ?>
        <div class="row g-3">
            <div class="col-md-4">
                <div class="card card-hisada p-3 mb-3">
                    <h6 class="mb-3">Tambah Kamar</h6>
                    <form method="post">
                        <input type="hidden" name="action" value="tambah_kamar">
                        <div class="mb-2"><label class="form-label small">Nama Kamar</label><input type="text" name="nama_kamar" class="form-control form-control-sm" required></div>
                        <div class="mb-2"><label class="form-label small">Gedung</label><input type="text" name="gedung" class="form-control form-control-sm" required></div>
                        <div class="mb-2"><label class="form-label small">Gender</label>
                            <select name="gender" class="form-select form-select-sm"><option value="L">Laki-laki</option><option value="P">Perempuan</option></select>
                        </div>
                        <button class="btn btn-success w-100">Simpan</button>
                    </form>
                </div>
                <div class="card card-hisada p-3">
                    <h6 class="mb-2">Import CSV (Massal)</h6>
                    <p class="small text-muted">Kolom wajib: <code>nama_kamar, gedung, gender (L/P)</code>.</p>
                    <form method="post" enctype="multipart/form-data">
                        <input type="hidden" name="action" value="csv_kamar">
                        <input type="file" name="csv_file" accept=".csv" class="form-control form-control-sm mb-2" required>
                        <button class="btn btn-success w-100">Upload &amp; Proses</button>
                    </form>
                </div>
            </div>
            <div class="col-md-8">
                <div class="card card-hisada p-3">
                    <h6 class="mb-3">Daftar Kamar</h6>
                    <div class="table-responsive"><table class="table table-sm">
                        <thead><tr><th>Gedung</th><th>Kamar</th><th>Gender</th></tr></thead>
                        <tbody>
                        <?php foreach ($daftarKamar as $r): ?><tr><td><?= htmlspecialchars($r['gedung']) ?></td><td><?= htmlspecialchars($r['nama_kamar']) ?></td><td><?= $r['gender']==='L'?'Laki-laki':'Perempuan' ?></td></tr><?php endforeach; ?>
                        </tbody>
                    </table></div>
                </div>
            </div>
        </div>

    <?php elseif ($tab === 'keluarga'): ?>
        <div class="row g-3">
            <div class="col-md-4">
                <div class="card card-hisada p-3 mb-3">
                    <h6 class="mb-3">Tambah Data Keluarga</h6>
                    <form method="post">
                        <input type="hidden" name="action" value="tambah_keluarga">
                        <div class="mb-2"><label class="form-label small">Nama Ayah</label><input type="text" name="nama_ayah" class="form-control form-control-sm"></div>
                        <div class="mb-2"><label class="form-label small">Nama Ibu</label><input type="text" name="nama_ibu" class="form-control form-control-sm"></div>
                        <div class="mb-2"><label class="form-label small">No. HP</label><input type="text" name="no_hp" class="form-control form-control-sm"></div>
                        <button class="btn btn-success w-100">Simpan</button>
                    </form>
                </div>
                <div class="card card-hisada p-3">
                    <h6 class="mb-2">Import CSV (Massal)</h6>
                    <p class="small text-muted">Kolom: <code>nama_ayah, nama_ibu, no_hp</code> (minimal salah satu nama ortu diisi).</p>
                    <form method="post" enctype="multipart/form-data">
                        <input type="hidden" name="action" value="csv_keluarga">
                        <input type="file" name="csv_file" accept=".csv" class="form-control form-control-sm mb-2" required>
                        <button class="btn btn-success w-100">Upload &amp; Proses</button>
                    </form>
                </div>
            </div>
            <div class="col-md-8">
                <div class="card card-hisada p-3">
                    <h6 class="mb-3">Daftar Keluarga (100 terbaru)</h6>
                    <div class="table-responsive"><table class="table table-sm">
                        <thead><tr><th>Nama Ayah</th><th>Nama Ibu</th><th>No. HP</th><th>Akun Wali</th><th></th></tr></thead>
                        <tbody>
                        <?php foreach ($daftarKeluarga as $f): ?>
                            <tr>
                                <td><?= htmlspecialchars($f['nama_ayah'] ?? '-') ?></td>
                                <td><?= htmlspecialchars($f['nama_ibu'] ?? '-') ?></td>
                                <td class="small"><?= htmlspecialchars($f['no_hp'] ?? '-') ?></td>
                                <td class="small">
                                    <?php if ($f['wali_username']): ?>
                                        <?= htmlspecialchars($f['wali_username']) ?> <span class="badge <?= $f['wali_status']==='aktif'?'badge-hadir':'badge-alpha' ?>"><?= ucfirst($f['wali_status']) ?></span>
                                    <?php else: ?><span class="text-muted">Belum ada</span><?php endif; ?>
                                </td>
                                <td><button class="btn btn-sm btn-outline-secondary" data-bs-toggle="modal" data-bs-target="#modalWali<?= $f['id'] ?>"><?= $f['wali_username'] ? 'Reset' : 'Buat' ?></button></td>
                            </tr>
                        <?php endforeach; ?>
                        </tbody>
                    </table></div>
                </div>
            </div>
        </div>

        <?php foreach ($daftarKeluarga as $f): ?>
            <div class="modal fade" id="modalWali<?= $f['id'] ?>" tabindex="-1">
                <div class="modal-dialog">
                    <form method="post" class="modal-content">
                        <input type="hidden" name="action" value="buat_akun_wali">
                        <input type="hidden" name="family_id" value="<?= $f['id'] ?>">
                        <div class="modal-header"><h6 class="modal-title"><?= $f['wali_username'] ? 'Reset' : 'Buat' ?> Akun Wali &mdash; <?= htmlspecialchars($f['nama_ayah'] ?? $f['nama_ibu'] ?? 'Keluarga #'.$f['id']) ?></h6></div>
                        <div class="modal-body">
                            <div class="mb-2"><label class="form-label small">Username</label><input type="text" name="wali_username" class="form-control form-control-sm" value="<?= htmlspecialchars($f['wali_username'] ?? '') ?>" required></div>
                            <div class="mb-2"><label class="form-label small">Password Baru</label><input type="text" name="wali_password" class="form-control form-control-sm" required></div>
                            <div class="form-text">Wali login lewat halaman terpisah: <code>wali.php</code></div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Batal</button>
                            <button class="btn btn-sm btn-success">Simpan</button>
                        </div>
                    </form>
                </div>
            </div>
        <?php endforeach; ?>
    <?php endif; ?>


<?php
// ======================================================================
// RENDER: HISTORY (RIWAYAT PERUBAHAN)
// ======================================================================
elseif ($modul === 'history'): ?>
    <h4 class="mb-4">Riwayat Perubahan</h4>
    <div class="card card-hisada p-3 mb-3">
        <form method="get" class="row g-2 align-items-end">
            <input type="hidden" name="modul" value="history">
            <div class="col-md-6">
                <label class="form-label small">Filter Masa Jabatan</label>
                <select name="periode_id" class="form-select form-select-sm" onchange="this.form.submit()">
                    <option value="">Semua (200 terbaru)</option>
                    <?php foreach ($periodeList as $p): ?>
                        <option value="<?= $p['id'] ?>" <?= (string)$periodeId === (string)$p['id'] ? 'selected' : '' ?>>
                            <?= htmlspecialchars($p['nama_periode']) ?> (<?= $p['status'] === 'aktif' ? 'aktif' : 'arsip' ?>)
                        </option>
                    <?php endforeach; ?>
                </select>
            </div>
        </form>
    </div>
    <div class="card card-hisada p-3">
        <h6 class="mb-3">Menampilkan <?= count($logs) ?> catatan</h6>
        <div class="table-responsive">
        <table class="table table-sm">
            <thead><tr><th style="width:160px">Waktu</th><th>User</th><th>Aksi</th></tr></thead>
            <tbody>
            <?php foreach ($logs as $l): ?>
                <tr>
                    <td class="small"><?= date('d/m/Y H:i', strtotime($l['created_at'])) ?></td>
                    <td class="small"><?= htmlspecialchars($l['nama_user'] ?? 'Sistem') ?></td>
                    <td class="small"><?= htmlspecialchars($l['aksi']) ?></td>
                </tr>
            <?php endforeach; ?>
            <?php if (!$logs): ?><tr><td colspan="3" class="text-muted small">Belum ada catatan untuk rentang ini.</td></tr><?php endif; ?>
            </tbody>
        </table>
        </div>
    </div>

<?php
// ======================================================================
// RENDER: INVENTARIS BARANG
// ======================================================================
elseif ($modul === 'inventaris'): ?>
    <h4 class="mb-4">Inventaris Barang</h4>
    <div class="row g-3">
        <div class="col-md-5">
            <div class="card card-hisada p-3">
                <h6 class="mb-3">Catat Barang Baru</h6>
                <form method="post" id="formInventaris">
                    <input type="hidden" name="action" value="tambah">
                    <div class="mb-2"><label class="form-label small">Kode Barang</label><input type="text" name="kode_barang" id="kodeBarangInput" class="form-control form-control-sm" placeholder="Contoh: HSD-DH-EPS" required></div>
                    <div class="mb-2"><label class="form-label small">Nama Barang</label><input type="text" name="nama_barang" class="form-control form-control-sm" placeholder="Contoh: Printer" required></div>
                    <div class="mb-2"><label class="form-label small">Jumlah</label><input type="number" id="jumlahBarangInput" class="form-control form-control-sm" value="1" min="1" max="50"></div>
                    <div class="mb-2"><label class="form-label small">Keterangan</label><input type="text" name="keterangan" class="form-control form-control-sm"></div>

                    <label class="form-label small d-block">Detail Tiap Unit</label>
                    <div id="daftarUnit"></div>

                    <button class="btn btn-success w-100 mt-2">Simpan</button>
                </form>
            </div>
            <script>
            (function () {
                var jumlahInput = document.getElementById('jumlahBarangInput');
                var wadah = document.getElementById('daftarUnit');
                function gambarUnit() {
                    var jml = Math.max(1, Math.min(50, parseInt(jumlahInput.value, 10) || 1));
                    wadah.innerHTML = '';
                    for (var i = 0; i < jml; i++) {
                        var baris = document.createElement('div');
                        baris.className = 'row g-1 mb-1 align-items-center';
                        baris.innerHTML =
                            '<div class="col-auto small text-muted">#' + (i + 1) + '</div>' +
                            '<div class="col"><select name="kategori[]" class="form-select form-select-sm"><option value="baru">Baru</option><option value="lama">Lama</option></select></div>' +
                            '<div class="col"><select name="tingkat[]" class="form-select form-select-sm">' +
                            '<option value="bagus">Bagus</option><option value="rusak_ringan">Rusak Ringan</option><option value="rusak_berat">Rusak Berat</option><option value="hilang">Hilang</option>' +
                            '</select></div>';
                        wadah.appendChild(baris);
                    }
                }
                jumlahInput.addEventListener('input', gambarUnit);
                gambarUnit();
            })();
            </script>
        </div>
        <div class="col-md-7">
            <div class="card card-hisada p-3">
                <h6 class="mb-3">Daftar Barang</h6>
                <div class="table-responsive">
                <table class="table table-sm">
                    <thead><tr><th>Kode</th><th>Nama</th><th>Jml</th><th>Rincian Unit</th><th></th></tr></thead>
                    <tbody>
                    <?php foreach ($daftarKode as $k): ?>
                        <tr>
                            <td><?= htmlspecialchars($k['kode_barang']) ?></td>
                            <td><?= htmlspecialchars($k['nama_barang']) ?></td>
                            <td><?= $k['jumlah'] ?></td>
                            <td class="small">
                                <?php foreach ($unitPerKode[$k['id']] ?? [] as $u): ?>
                                    <span class="badge <?= $u['kategori']==='baru' ? 'badge-hadir' : 'badge-izin' ?>"><?= ucfirst($u['kategori']) ?></span>
                                    <span class="badge <?= ['bagus'=>'badge-hadir','rusak_ringan'=>'badge-sakit','rusak_berat'=>'badge-alpha','hilang'=>'badge-alpha'][$u['tingkat']] ?>"><?= ucwords(str_replace('_',' ',$u['tingkat'])) ?></span><br>
                                <?php endforeach; ?>
                            </td>
                            <td><button class="btn btn-sm btn-outline-secondary" data-bs-toggle="modal" data-bs-target="#modalUnit<?= $k['id'] ?>">Edit</button></td>
                        </tr>
                    <?php endforeach; ?>
                    <?php if (!$daftarKode): ?><tr><td colspan="5" class="text-muted small">Belum ada data.</td></tr><?php endif; ?>
                    </tbody>
                </table>
                </div>
            </div>
        </div>
    </div>

    <?php foreach ($daftarKode as $k): ?>
        <div class="modal fade" id="modalUnit<?= $k['id'] ?>" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header"><h6 class="modal-title">Unit &mdash; <?= htmlspecialchars($k['kode_barang']) ?> (<?= htmlspecialchars($k['nama_barang']) ?>)</h6></div>
                    <div class="modal-body">
                        <?php foreach ($unitPerKode[$k['id']] ?? [] as $idx => $u): ?>
                            <form method="post" class="row g-2 align-items-end mb-2 border-bottom pb-2">
                                <input type="hidden" name="action" value="update_unit">
                                <input type="hidden" name="unit_id" value="<?= $u['id'] ?>">
                                <div class="col-auto small text-muted">Unit #<?= $idx + 1 ?></div>
                                <div class="col">
                                    <select name="kategori_unit" class="form-select form-select-sm">
                                        <option value="baru" <?= $u['kategori']==='baru'?'selected':'' ?>>Baru</option>
                                        <option value="lama" <?= $u['kategori']==='lama'?'selected':'' ?>>Lama</option>
                                    </select>
                                </div>
                                <div class="col">
                                    <select name="tingkat_unit" class="form-select form-select-sm">
                                        <?php foreach (['bagus'=>'Bagus','rusak_ringan'=>'Rusak Ringan','rusak_berat'=>'Rusak Berat','hilang'=>'Hilang'] as $val => $lbl): ?>
                                            <option value="<?= $val ?>" <?= $u['tingkat']===$val?'selected':'' ?>><?= $lbl ?></option>
                                        <?php endforeach; ?>
                                    </select>
                                </div>
                                <div class="col-auto"><button class="btn btn-sm btn-outline-success">Simpan</button></div>
                            </form>
                        <?php endforeach; ?>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Tutup</button>
                    </div>
                </div>
            </div>
        </div>
    <?php endforeach; ?>

<?php
// ======================================================================
// RENDER: RAPOR KESANTRIAN
// ======================================================================
elseif ($modul === 'rapor'): ?>
    <h4 class="mb-4">Rapor Kesantrian</h4>
    <div class="card card-hisada p-3 mb-3 no-print">
        <label class="form-label small">Pilih Santri</label>
        <form method="get" id="formRapor">
            <input type="hidden" name="modul" value="rapor">
            <?php render_santri_picker('student_id', $students, 'rapor'); ?>
        </form>
        <script>document.getElementById('picker_rapor').querySelector('.sp-value').addEventListener('change', function(){ document.getElementById('formRapor').submit(); });</script>
    </div>

    <?php if ($rapor): ?>
        <div class="card card-hisada p-3">
            <div class="d-flex justify-content-between align-items-start mb-3">
                <div>
                    <h5 class="mb-0"><?= htmlspecialchars($rapor['santri']['nama']) ?></h5>
                    <div class="text-muted small">NIS <?= htmlspecialchars($rapor['santri']['nis']) ?> &middot; <?= htmlspecialchars($rapor['santri']['nama_kelas'] ?? '-') ?> &middot; <?= $rapor['santri']['nama_kamar'] ? htmlspecialchars($rapor['santri']['gedung'].' - '.$rapor['santri']['nama_kamar']) : '-' ?></div>
                </div>
                <button class="btn btn-sm btn-outline-secondary no-print" onclick="window.print()"><i class="bi bi-printer me-1"></i>Cetak</button>
            </div>

            <h6 class="small text-muted">Rekap Absensi Harian (90 hari terakhir)</h6>
            <div class="d-flex gap-2 mb-3 flex-wrap">
                <?php foreach (['hadir','sakit','izin','pulang','alpha'] as $st):
                    $jml = 0; foreach ($rapor['absensi'] as $a) { if ($a['status'] === $st) $jml = $a['jumlah']; } ?>
                    <span class="badge badge-<?= $st ?>"><?= ucfirst($st) ?>: <?= $jml ?></span>
                <?php endforeach; ?>
            </div>

            <h6 class="small text-muted">Catatan Kedisiplinan (Mahkamah)</h6>
            <?php if ($rapor['pelanggaran']): ?>
                <ul class="small mb-3">
                    <?php foreach ($rapor['pelanggaran'] as $p): ?>
                        <li><?= date('d/m/Y', strtotime($p['tanggal'])) ?> &mdash; <?= htmlspecialchars($p['kategori']) ?> (<?= $p['status'] === 'menunggu' ? 'menunggu sidang' : ucfirst($p['status']) ?>)</li>
                    <?php endforeach; ?>
                </ul>
            <?php else: ?><p class="small text-muted mb-3">Tidak ada catatan.</p><?php endif; ?>

            <h6 class="small text-muted">Prestasi</h6>
            <?php if ($rapor['prestasi']): ?>
                <ul class="small mb-3">
                    <?php foreach ($rapor['prestasi'] as $p): ?>
                        <li><?= date('d/m/Y', strtotime($p['tanggal'])) ?> &mdash; <?= htmlspecialchars($p['nama_kegiatan']) ?> (<?= ucfirst($p['tingkat']) ?>)</li>
                    <?php endforeach; ?>
                </ul>
            <?php else: ?><p class="small text-muted mb-3">Belum ada prestasi tercatat.</p><?php endif; ?>

            <h6 class="small text-muted">Ekstrakurikuler Aktif</h6>
            <?php if ($rapor['ekskul']): ?>
                <p class="small mb-0"><?= implode(', ', array_map(fn($e) => htmlspecialchars($e['nama']) . ' (' . htmlspecialchars($e['kategori']) . ')', $rapor['ekskul'])) ?></p>
            <?php else: ?><p class="small text-muted mb-0">Tidak mengikuti ekskul.</p><?php endif; ?>
        </div>
    <?php elseif ($studentIdRapor !== ''): ?>
        <p class="text-muted small">Santri tidak ditemukan.</p>
    <?php else: ?>
        <p class="text-muted small">Pilih santri untuk melihat rapor kesantrian.</p>
    <?php endif; ?>

<?php
// ======================================================================
// RENDER: BACKUP DATABASE
// ======================================================================
elseif ($modul === 'backup'): ?>
    <h4 class="mb-4">Backup Database</h4>
    <div class="row g-3">
        <div class="col-md-5">
            <div class="card card-hisada p-3 mb-3">
                <h6 class="mb-2">Backup Manual (.sql)</h6>
                <p class="small text-muted">Membuat file <code>.sql</code> berisi seluruh isi database saat ini (struktur + data), siap diunduh.</p>
                <form method="post">
                    <input type="hidden" name="action" value="backup_manual">
                    <button class="btn btn-success w-100">Buat Backup Sekarang</button>
                </form>
                <?php if ($adaFileSiapUnduh): ?>
                    <a href="dashboard.php?modul=backup&unduh=1" class="btn btn-outline-success w-100 mt-2"><i class="bi bi-download me-1"></i>Unduh Backup Terakhir</a>
                <?php endif; ?>
                <div class="form-text mt-2">Tombol ini backup manual (harus diklik sendiri). Belum ada penjadwalan otomatis -- lihat catatan di README soal batasan ini.</div>
            </div>

            <div class="card card-hisada p-3 mb-3">
                <h6 class="mb-2">Backup ke Google Spreadsheet</h6>
                <p class="small text-muted">Mengirim 8 tabel terpenting (santri, guru, absensi, pelanggaran, perizinan, poskestren, prestasi, korespondensi -- 200 baris terbaru per tabel) ke Google Spreadsheet lewat Google Apps Script. Sheet lama ditimpa, bukan ditumpuk. Dikirim <strong>satu tabel per permintaan</strong> (bukan sekaligus) supaya tidak memicu timeout di hosting.</p>
                <button type="button" id="btnBackupSheets" class="btn btn-success w-100" <?= empty($pengaturanGsTampil['gs_url']) ? 'disabled' : '' ?>>Backup ke Spreadsheet Sekarang</button>
                <div id="progressBackupSheets" class="mt-2 d-none">
                    <div class="progress" style="height:8px"><div class="progress-bar bg-success" id="progressBarSheets" style="width:0%"></div></div>
                    <div class="small text-muted mt-1" id="statusBackupSheets"></div>
                </div>
                <?php if (empty($pengaturanGsTampil['gs_url'])): ?>
                    <div class="form-text mt-2 text-danger">Atur URL Apps Script dulu di bawah sebelum bisa dipakai.</div>
                <?php endif; ?>
            </div>
            <script>
            (function () {
                var btn = document.getElementById('btnBackupSheets');
                if (!btn) return;
                var tabelList = <?= json_encode(TABEL_BACKUP_SHEETS) ?>;
                btn.addEventListener('click', async function () {
                    btn.disabled = true;
                    var progressWrap = document.getElementById('progressBackupSheets');
                    var bar = document.getElementById('progressBarSheets');
                    var status = document.getElementById('statusBackupSheets');
                    progressWrap.classList.remove('d-none');
                    var ringkasan = [];
                    var semuaOk = true;
                    for (var i = 0; i < tabelList.length; i++) {
                        var tabel = tabelList[i];
                        status.textContent = 'Mengirim tabel "' + tabel + '" (' + (i + 1) + '/' + tabelList.length + ')...';
                        try {
                            var resp = await fetch('dashboard.php?modul=backup&ajax_tabel=' + encodeURIComponent(tabel) + '&limit=200');
                            var data = await resp.json();
                            if (!data.ok) semuaOk = false;
                            ringkasan.push(tabel + ': ' + (data.ok ? 'OK (' + data.jumlah + ' baris)' : 'GAGAL - ' + data.pesan));
                        } catch (e) {
                            semuaOk = false;
                            ringkasan.push(tabel + ': GAGAL - koneksi terputus');
                        }
                        bar.style.width = Math.round(((i + 1) / tabelList.length) * 100) + '%';
                    }
                    status.textContent = semuaOk ? 'Selesai -- semua tabel berhasil dikirim.' : 'Selesai, tapi ada tabel yang gagal.';
                    var form = new FormData();
                    form.append('action', 'catat_hasil_backup_sheets');
                    form.append('semua_ok', semuaOk ? '1' : '0');
                    form.append('ringkasan', ringkasan.join(' | '));
                    await fetch('dashboard.php?modul=backup', { method: 'POST', body: form });
                    btn.disabled = false;
                    setTimeout(function () { window.location.reload(); }, 1500);
                });
            })();
            </script>

            <div class="card card-hisada p-3">
                <h6 class="mb-2">Pengaturan Google Sheets</h6>
                <p class="small text-muted">Setup sekali: ikuti langkah di file <code>google-apps-script/BackupSpreadsheet.gs</code> (ada di source code sistem ini), lalu tempel URL Web App &amp; kunci rahasianya di sini.</p>
                <form method="post">
                    <input type="hidden" name="action" value="simpan_pengaturan_gs">
                    <div class="mb-2"><label class="form-label small">URL Web App Apps Script</label>
                        <input type="url" name="gs_url" class="form-control form-control-sm" value="<?= htmlspecialchars($pengaturanGsTampil['gs_url'] ?? '') ?>" placeholder="https://script.google.com/macros/s/.../exec"></div>
                    <div class="mb-2"><label class="form-label small">Kunci Rahasia</label>
                        <input type="text" name="gs_kunci" class="form-control form-control-sm" value="<?= htmlspecialchars($pengaturanGsTampil['gs_kunci'] ?? '') ?>" placeholder="Harus SAMA PERSIS dgn KUNCI_RAHASIA di file .gs"></div>
                    <button class="btn btn-outline-success w-100">Simpan Pengaturan</button>
                </form>
            </div>
        </div>
        <div class="col-md-7">
            <div class="card card-hisada p-3">
                <h6 class="mb-3">Riwayat Backup</h6>
                <div class="table-responsive">
                <table class="table table-sm">
                    <thead><tr><th>Waktu</th><th>Status</th><th>Keterangan</th></tr></thead>
                    <tbody>
                    <?php foreach ($riwayatBackup as $b): ?>
                        <tr>
                            <td class="small"><?= date('d/m/Y H:i', strtotime($b['waktu'])) ?></td>
                            <td><span class="badge <?= $b['status']==='berhasil' ? 'badge-hadir' : 'badge-alpha' ?>"><?= ucfirst($b['status']) ?></span></td>
                            <td class="small"><?= htmlspecialchars($b['keterangan']) ?></td>
                        </tr>
                    <?php endforeach; ?>
                    <?php if (!$riwayatBackup): ?><tr><td colspan="3" class="text-muted small">Belum pernah backup.</td></tr><?php endif; ?>
                    </tbody>
                </table>
                </div>
            </div>
        </div>
    </div>

<?php endif; ?>
</div>
<?php include __DIR__ . '/includes/footer.php'; ?>
