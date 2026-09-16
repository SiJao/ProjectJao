<?php
/**
 * Login Portal Wali Santri -- SENGAJA TERPISAH dari includes/auth.php
 * (sistem staff/pengurus). Wali bukan "pengurus" -- tidak lewat
 * riwayat_jabatan, tapi lewat tabel wali_akses yang terikat ke
 * family_id (satu akun bisa melihat semua anaknya dalam satu keluarga).
 */
require_once __DIR__ . '/config/database.php';
session_start();

if (!empty($_SESSION['wali_family_id'])) {
    header('Location: wali_dashboard.php');
    exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim($_POST['username'] ?? '');
    $password = $_POST['password'] ?? '';
    if ($username === '' || $password === '') {
        $error = 'Username dan password wajib diisi.';
    } else {
        $stmt = $pdo->prepare("SELECT * FROM wali_akses WHERE username = :u AND status = 'aktif'");
        $stmt->execute(['u' => $username]);
        $wali = $stmt->fetch();
        if ($wali && password_verify($password, $wali['password'])) {
            $_SESSION['wali_family_id'] = $wali['family_id'];
            $_SESSION['wali_username'] = $wali['username'];
            header('Location: wali_dashboard.php');
            exit;
        }
        $error = 'Username/password salah, atau akun belum aktif.';
    }
}
?>
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Portal Wali Santri - Hisada</title>
<link href="assets/vendor/bootstrap/css/bootstrap.min.css" rel="stylesheet">
<link href="assets/css/style.css?v=<?= @filemtime(__DIR__ . '/assets/css/style.css') ?: time() ?>" rel="stylesheet">
</head>
<body>
<div class="row g-0 login-wrapper">
    <div class="col-md-6 d-none d-md-block position-relative login-image"
         style="background-image:url('assets/img/login-bg.jpg')">
        <div class="position-absolute bottom-0 start-0 p-4 text-white" style="z-index:1">
            <h4 class="mb-0">Pondok Pesantren Daarul Uluum Lido</h4>
            <small>Portal Wali Santri</small>
        </div>
    </div>
    <div class="col-md-6 d-flex align-items-center">
        <div class="login-card w-100 p-4">
            <div class="text-center">
                <img src="https://ik.imagekit.io/HiLink/LOGO%20HISADA%20.png?updatedAt=1788676662703" class="login-logo" alt="Logo Hisada">
                <h5 class="mb-1">Portal Wali Santri</h5>
                <p class="text-muted small mb-4">Lihat perkembangan putra/putri Anda di pondok</p>
            </div>
            <?php if ($error): ?>
                <div class="alert alert-danger py-2 small"><?= htmlspecialchars($error) ?></div>
            <?php endif; ?>
            <form method="post">
                <div class="mb-3">
                    <label class="form-label small">Username</label>
                    <input type="text" name="username" class="form-control" required autofocus>
                </div>
                <div class="mb-3">
                    <label class="form-label small">Password</label>
                    <input type="password" name="password" class="form-control" required>
                </div>
                <button class="btn btn-success w-100">Masuk</button>
            </form>
            <p class="text-muted small text-center mt-3 mb-0">Belum punya akun? Hubungi pihak pondok/wali kamar.</p>
        </div>
    </div>
</div>
</body>
</html>
