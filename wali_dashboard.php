<?php
require_once __DIR__ . '/config/database.php';
session_start();

if (empty($_SESSION['wali_family_id'])) {
    header('Location: wali.php');
    exit;
}
$familyId = $_SESSION['wali_family_id'];

$anak = $pdo->prepare("
    SELECT s.*, c.nama AS nama_kelas, r.nama_kamar, r.gedung
    FROM students s LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN rooms r ON r.id = s.room_id
    WHERE s.family_id = :fid
    ORDER BY s.nama
");
$anak->execute(['fid' => $familyId]);
$anak = $anak->fetchAll();

foreach ($anak as &$a) {
    $rekapAbsensi = $pdo->prepare("
        SELECT status, COUNT(*) AS jumlah FROM attendances
        WHERE student_id = :sid AND jenis_kegiatan = 'harian' AND tanggal >= (CURDATE() - INTERVAL 30 DAY)
        GROUP BY status
    ");
    $rekapAbsensi->execute(['sid' => $a['id']]);
    $a['rekap_absensi'] = $rekapAbsensi->fetchAll();

    $stmtKesehatan = $pdo->prepare('SELECT * FROM health_profiles WHERE student_id = :sid');
    $stmtKesehatan->execute(['sid' => $a['id']]);
    $a['kesehatan'] = $stmtKesehatan->fetch();

    $stmtIzin = $pdo->prepare("
        SELECT * FROM permits WHERE student_id = :sid AND status IN ('berjalan','overdue')
        ORDER BY tanggal_selesai DESC LIMIT 1
    ");
    $stmtIzin->execute(['sid' => $a['id']]);
    $a['izin_aktif'] = $stmtIzin->fetch();

    $stmtPrestasi = $pdo->prepare('SELECT * FROM achievements WHERE student_id = :sid ORDER BY tanggal DESC LIMIT 5');
    $stmtPrestasi->execute(['sid' => $a['id']]);
    $a['prestasi'] = $stmtPrestasi->fetchAll();
}
unset($a);
?>
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Portal Wali Santri - Hisada</title>
<link href="assets/vendor/bootstrap/css/bootstrap.min.css" rel="stylesheet">
<link href="assets/vendor/bootstrap-icons/bootstrap-icons.min.css" rel="stylesheet">
<link href="assets/css/style.css?v=<?= @filemtime(__DIR__ . '/assets/css/style.css') ?: time() ?>" rel="stylesheet">
</head>
<body>
<div class="mobile-topbar">
    <img src="https://ik.imagekit.io/HiLink/LOGO%20HISADA%20.png?updatedAt=1788676662703" alt="Logo Hisada" class="mobile-topbar-logo">
    <span class="text-white ms-2">Portal Wali Santri</span>
    <a href="wali_logout.php" class="btn btn-sm btn-outline-light ms-auto">Keluar</a>
</div>
<div class="main-content">
    <h4 class="mb-1">Selamat Datang, <?= htmlspecialchars($_SESSION['wali_username']) ?></h4>
    <p class="text-muted small mb-4">Data hanya menampilkan putra/putri yang terdaftar di keluarga Anda.</p>

    <?php if (!$anak): ?>
        <div class="card card-hisada p-3"><p class="text-muted small mb-0">Belum ada data santri yang terhubung ke akun ini. Hubungi pihak pondok kalau ini keliru.</p></div>
    <?php endif; ?>

    <?php foreach ($anak as $a): ?>
        <div class="card card-hisada p-3 mb-3">
            <div class="d-flex justify-content-between align-items-start mb-3">
                <div>
                    <h5 class="mb-0"><?= htmlspecialchars($a['nama']) ?></h5>
                    <div class="text-muted small">NIS <?= htmlspecialchars($a['nis']) ?> &middot; <?= htmlspecialchars($a['nama_kelas'] ?? '-') ?> &middot; <?= $a['nama_kamar'] ? htmlspecialchars($a['gedung'].' - '.$a['nama_kamar']) : '-' ?></div>
                </div>
                <span class="badge <?= $a['status']==='aktif' ? 'badge-hadir' : 'badge-alpha' ?>"><?= ucfirst($a['status']) ?></span>
            </div>

            <?php if ($a['izin_aktif']): ?>
                <div class="alert alert-warning py-2 small mb-3">
                    Sedang <?= ['keluar_sementara'=>'Keluar Sementara','izin_dinas'=>'Izin Dinas','pulang'=>'Pulang'][$a['izin_aktif']['jenis']] ?>
                    sampai <?= date('d/m/Y', strtotime($a['izin_aktif']['tanggal_selesai'])) ?><?= $a['izin_aktif']['jam_selesai'] ? ' pukul '.substr($a['izin_aktif']['jam_selesai'],0,5) : '' ?>.
                    <?php if ($a['izin_aktif']['status']==='overdue'): ?><strong>(Overdue -- belum konfirmasi kembali)</strong><?php endif; ?>
                </div>
            <?php endif; ?>

            <div class="row g-3">
                <div class="col-md-6">
                    <h6 class="small text-muted">Kehadiran 30 Hari Terakhir</h6>
                    <div class="d-flex gap-2 flex-wrap mb-3">
                        <?php foreach (['hadir','sakit','izin','pulang','alpha'] as $st):
                            $jml = 0; foreach ($a['rekap_absensi'] as $r) { if ($r['status'] === $st) $jml = $r['jumlah']; } ?>
                            <span class="badge badge-<?= $st ?>"><?= ucfirst($st) ?>: <?= $jml ?></span>
                        <?php endforeach; ?>
                    </div>

                    <h6 class="small text-muted">Profil Kesehatan</h6>
                    <?php if ($a['kesehatan']): ?>
                        <p class="small mb-3">
                            Gol. Darah: <?= htmlspecialchars($a['kesehatan']['golongan_darah']) ?><br>
                            Alergi: <?= htmlspecialchars($a['kesehatan']['alergi'] ?: '-') ?><br>
                            Penyakit Kronis: <?= htmlspecialchars($a['kesehatan']['penyakit_kronis'] ?: '-') ?>
                        </p>
                    <?php else: ?><p class="small text-muted mb-3">Belum ada data.</p><?php endif; ?>
                </div>
                <div class="col-md-6">
                    <h6 class="small text-muted">Prestasi Terbaru</h6>
                    <?php if ($a['prestasi']): ?>
                        <ul class="small mb-0">
                            <?php foreach ($a['prestasi'] as $p): ?>
                                <li><?= date('d/m/Y', strtotime($p['tanggal'])) ?> &mdash; <?= htmlspecialchars($p['nama_kegiatan']) ?> (<?= ucfirst($p['tingkat']) ?>)</li>
                            <?php endforeach; ?>
                        </ul>
                    <?php else: ?><p class="small text-muted mb-0">Belum ada prestasi tercatat.</p><?php endif; ?>
                </div>
            </div>
        </div>
    <?php endforeach; ?>
</div>
<script src="assets/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
</body>
</html>
