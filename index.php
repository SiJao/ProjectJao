<?php
require_once __DIR__ . '/includes/auth.php';

if (current_user()) {
    header('Location: dashboard.php');
    exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email    = trim($_POST['email'] ?? '');
    $password = $_POST['password'] ?? '';

    if ($email === '' || $password === '') {
        $error = 'Email dan password wajib diisi.';
    } elseif (attempt_login($pdo, $email, $password)) {
        header('Location: dashboard.php');
        exit;
    } else {
        $error = 'Email/password salah, atau akun ini tidak sedang menjabat.';
    }
}
?>
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Login - Hisada</title>
<link href="assets/vendor/bootstrap/css/bootstrap.min.css" rel="stylesheet">
<link href="assets/css/style.css?v=<?= @filemtime(__DIR__ . '/assets/css/style.css') ?: time() ?>" rel="stylesheet">
</head>
<body>
<div class="row g-0 login-wrapper">
    <div class="col-md-6 d-none d-md-block position-relative login-image"
         style="background-image:url('assets/img/login-bg.jpg')">
        <div class="position-absolute bottom-0 start-0 p-4 text-white" style="z-index:1">
            <h4 class="mb-0">Pondok Pesantren Daarul Uluum Lido</h4>
            <small>Sistem Informasi Manajemen Kesantrian Hisada</small>
        </div>
    </div>
    <div class="col-md-6 d-flex align-items-center">
        <div class="login-card w-100 p-4">
            <div class="text-center">
                <img src="https://ik.imagekit.io/HiLink/LOGO%20HISADA%20.png?updatedAt=1788676662703" class="login-logo" alt="Logo Hisada">
                <h5 class="mb-1">Masuk ke Hisada</h5>
                <p class="text-muted small mb-4">Khusus pengurus yang sedang menjabat</p>
            </div>

            <?php if ($error): ?>
                <div class="alert alert-danger py-2 small"><?= htmlspecialchars($error) ?></div>
            <?php endif; ?>

            <form method="post">
                <div class="mb-3">
                    <label class="form-label small">Email</label>
                    <input type="email" name="email" class="form-control" placeholder="nis@daarululuumlido.com" required>
                </div>
                <div class="mb-3">
                    <label class="form-label small">Password</label>
                    <input type="password" name="password" class="form-control" required>
                </div>
                <button type="submit" class="btn btn-success w-100" style="background-color:var(--hisada-green);border-color:var(--hisada-green)">
                    Masuk
                </button>
            </form>
        </div>
    </div>
</div>
</body>
</html>
