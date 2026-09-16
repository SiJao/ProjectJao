<?php
/**
 * Halaman cetak surat izin -- HALAMAN MANDIRI (tanpa sidebar/topbar),
 * dipanggil lewat include dari modul Perizinan (lihat dashboard.php).
 * Variabel yang tersedia: $suratData (baris tabel permits + data
 * santri terkait), $labelJenisSurat (teks jenis izin utk ditampilkan).
 *
 * INI TEMPLATE SEMENTARA/PLACEHOLDER. Kalau template resmi pondok
 * sudah ada, tinggal ganti isi <div class="surat-kop"> dan susunan di
 * bawahnya supaya sesuai kop surat & format resmi -- struktur data
 * ($suratData) tidak perlu diubah.
 */
$tglCetak = date('d/m/Y H:i');
?>
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Surat Izin - <?= htmlspecialchars($suratData['nama_santri']) ?></title>
<link href="assets/vendor/bootstrap/css/bootstrap.min.css" rel="stylesheet">
<link href="assets/css/style.css?v=<?= @filemtime(__DIR__ . '/../assets/css/style.css') ?: time() ?>" rel="stylesheet">
<style>
    body { background: #e9e7e0; }
    .surat-wrapper { max-width: 720px; margin: 30px auto; background: #fff; padding: 50px 60px; box-shadow: 0 4px 16px rgba(0,0,0,.08); }
    .surat-kop { text-align: center; border-bottom: 3px double #1f7a4d; padding-bottom: 14px; margin-bottom: 24px; }
    .surat-kop img { height: 60px; margin-bottom: 8px; }
    .surat-kop h4 { margin: 0; color: #1f7a4d; }
    .surat-kop small { color: #7a786f; }
    .surat-judul { text-align: center; margin-bottom: 24px; }
    .surat-judul h5 { text-decoration: underline; margin-bottom: 2px; }
    table.surat-data td { padding: 3px 6px; vertical-align: top; }
    .surat-ttd { margin-top: 60px; display: flex; justify-content: space-between; }
    .surat-ttd .kolom { text-align: center; width: 220px; }
    .surat-ttd .garis { margin-top: 60px; border-top: 1px solid #333; }
    .no-print-bar { max-width: 720px; margin: 16px auto 0; text-align: right; }
    @media print {
        body { background: #fff; }
        .surat-wrapper { box-shadow: none; margin: 0; padding: 0 20px; }
        .no-print-bar { display: none; }
    }
</style>
</head>
<body>

<div class="no-print-bar">
    <button class="btn btn-success btn-sm" onclick="window.print()"><i class="bi bi-printer me-1"></i>Cetak</button>
    <a href="dashboard.php?modul=perizinan" class="btn btn-outline-secondary btn-sm">Kembali</a>
</div>

<div class="surat-wrapper">
    <div class="surat-kop">
        <img src="https://ik.imagekit.io/HiLink/LOGO%20HISADA%20.png?updatedAt=1788676662703" alt="Logo Hisada">
        <h4>PONDOK PESANTREN DAARUL ULUUM LIDO</h4>
        <small>Sistem Informasi Manajemen Kesantrian Hisada</small>
    </div>

    <div class="surat-judul">
        <h5><?= htmlspecialchars(strtoupper($labelJenisSurat)) ?></h5>
        <div class="small text-muted">Nomor: PERIZINAN/<?= $suratData['id'] ?>/<?= date('Y') ?></div>
    </div>

    <p>Yang bertanda tangan di bawah ini menerangkan bahwa santri berikut diberikan izin:</p>

    <table class="surat-data w-100 mb-3">
        <tr><td width="160">Nama</td><td>: <?= htmlspecialchars($suratData['nama_santri']) ?></td></tr>
        <tr><td>NIS</td><td>: <?= htmlspecialchars($suratData['nis']) ?></td></tr>
        <tr><td>Kamar</td><td>: <?= $suratData['nama_kamar'] ? htmlspecialchars($suratData['gedung'] . ' - ' . $suratData['nama_kamar']) : '-' ?></td></tr>
        <tr><td>Jenis Izin</td><td>: <?= htmlspecialchars($labelJenisSurat) ?></td></tr>
        <tr>
            <td>Waktu Mulai</td>
            <td>: <?= date('d/m/Y', strtotime($suratData['tanggal_mulai'])) ?><?= $suratData['jam_mulai'] ? ' pukul ' . substr($suratData['jam_mulai'], 0, 5) : '' ?></td>
        </tr>
        <tr>
            <td>Waktu Selesai</td>
            <td>: <?= date('d/m/Y', strtotime($suratData['tanggal_selesai'])) ?><?= $suratData['jam_selesai'] ? ' pukul ' . substr($suratData['jam_selesai'], 0, 5) : '' ?></td>
        </tr>
        <tr><td>Keterangan</td><td>: <?= htmlspecialchars($suratData['keterangan'] ?: '-') ?></td></tr>
    </table>

    <p>Demikian surat izin ini dibuat untuk dipergunakan sebagaimana mestinya.</p>

    <div class="surat-ttd">
        <div class="kolom">
            <div>Mengetahui,</div>
            <div>Wali Kamar / Piket</div>
            <div class="garis">&nbsp;</div>
        </div>
        <div class="kolom">
            <div>Lido, <?= date('d/m/Y') ?></div>
            <div>Santri Bersangkutan</div>
            <div class="garis">&nbsp;</div>
        </div>
    </div>

    <p class="text-muted small mt-4 mb-0">Dicetak otomatis oleh sistem Hisada pada <?= $tglCetak ?>. Template ini sementara -- akan disesuaikan dengan format surat resmi pondok.</p>
</div>

</body>
</html>
