<?php
/**
 * Halaman error kustom -- dipakai di seluruh sistem supaya pesan error
 * (403 akses ditolak, 422 data tidak lengkap, 500 kesalahan tak terduga,
 * koneksi database gagal, dsb.) tampilannya konsisten dengan desain
 * aplikasi (logo, warna, kartu), bukan teks polos tanpa gaya.
 *
 * Dibuat sebagai file mandiri (bukan lewat header.php/sidebar.php) karena
 * error bisa terjadi SEBELUM koneksi database berhasil atau SEBELUM user
 * login -- jadi tidak boleh bergantung pada apapun selain aset statis.
 */
function render_error_page(int $httpCode, string $title, string $message, ?string $backUrl = 'dashboard.php', string $backLabel = 'Kembali ke Dashboard'): void
{
    if (!headers_sent()) {
        http_response_code($httpCode);
    }
    ?>
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title><?= htmlspecialchars($title) ?> - Hisada</title>
<link href="assets/vendor/bootstrap/css/bootstrap.min.css" rel="stylesheet">
<link href="assets/vendor/bootstrap-icons/bootstrap-icons.min.css" rel="stylesheet">
<link href="assets/css/style.css?v=<?= @filemtime(__DIR__ . '/../assets/css/style.css') ?: time() ?>" rel="stylesheet">
</head>
<body>
<div class="error-page">
    <div class="error-card">
        <img src="https://ik.imagekit.io/HiLink/LOGO%20HISADA%20.png?updatedAt=1788676662703" alt="Logo Hisada" class="error-logo">
        <div class="error-code"><?= (int) $httpCode ?></div>
        <h5 class="mb-2"><?= htmlspecialchars($title) ?></h5>
        <p class="text-muted mb-4"><?= htmlspecialchars($message) ?></p>
        <?php if ($backUrl): ?>
            <a href="<?= htmlspecialchars($backUrl) ?>" class="btn btn-success">
                <i class="bi bi-chevron-left me-1"></i><?= htmlspecialchars($backLabel) ?>
            </a>
        <?php endif; ?>
    </div>
</div>
</body>
</html>
    <?php
    exit;
}

/**
 * Penangkap error/exception tak terduga (500) supaya production tidak
 * pernah menampilkan stack trace PHP mentah ke pengguna (risiko keamanan
 * & tidak enak dilihat) -- diganti dengan halaman kustom yang sama.
 * Detail teknisnya tetap dicatat lewat error_log() bawaan PHP, bukan
 * ditampilkan ke layar.
 */
set_exception_handler(function (Throwable $e): void {
    error_log('Uncaught exception: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) {
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
    }

    // Kalau errornya soal kolom/tabel database yang tidak ditemukan, ini
    // hampir pasti berarti skema database belum dimigrasi ke versi
    // terbaru -- pesan yang ditampilkan dibuat lebih spesifik & actionable
    // drpd "Terjadi Kesalahan" generik, supaya langsung ketahuan solusinya.
    $pesanAsli = $e->getMessage();
    if (stripos($pesanAsli, 'Unknown column') !== false || stripos($pesanAsli, "doesn't exist") !== false || stripos($pesanAsli, 'Base table or view not found') !== false) {
        render_error_page(
            500,
            'Skema Database Belum Sesuai',
            'Sistem mendeteksi ada kolom/tabel yang belum tersedia di database ini -- tandanya database perlu diimport ulang ke versi terbaru. Import ulang database.sql lewat phpMyAdmin (ini otomatis menghapus tabel lama dulu sebelum membuat ulang), lalu coba lagi.',
            null
        );
    }

    render_error_page(
        500,
        'Terjadi Kesalahan',
        'Sistem mengalami kendala teknis. Silakan coba lagi beberapa saat lagi, atau hubungi admin jika masalah berlanjut.'
    );
});
