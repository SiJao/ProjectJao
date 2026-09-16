<?php
/**
 * Autentikasi & RBAC.
 * Role TIDAK disimpan statis di tabel users -- role dicek lewat join ke
 * riwayat_jabatan pada periode_jabatan yang sedang aktif. Begitu masa
 * khidmat berganti (lihat serah_terima.php), hak akses seluruh user
 * otomatis ikut berubah tanpa perlu edit manual satu-satu.
 */
session_start();
require_once __DIR__ . '/../config/database.php';

function current_user()
{
    return $_SESSION['user'] ?? null;
}

function require_login()
{
    if (!current_user()) {
        header('Location: index.php');
        exit;
    }
}

/**
 * $allowed_roles: array role_key yang boleh akses halaman ini.
 * Super Admin selalu lolos apapun isinya.
 */
function require_role(array $allowed_roles)
{
    require_login();
    $user = current_user();
    if ($user['is_super_admin']) {
        return;
    }
    if (!in_array($user['role_key'], $allowed_roles, true)) {
        render_error_page(
            403,
            'Akses Ditolak',
            'Anda tidak memiliki jabatan yang sesuai untuk membuka halaman ini. Kalau menurutmu ini keliru, hubungi admin.'
        );
    }
}

function attempt_login(PDO $pdo, string $email, string $password): bool
{
    $stmt = $pdo->prepare('SELECT * FROM users WHERE email = :email AND status = "aktif" LIMIT 1');
    $stmt->execute(['email' => $email]);
    $row = $stmt->fetch();

    if (!$row || !password_verify($password, $row['password'])) {
        return false;
    }

    // Tentukan role dari periode jabatan yang aktif (kosong utk super admin).
    $role_key = 'super_admin';
    $posisi   = 'Super Admin';

    if (!$row['is_super_admin']) {
        $roleStmt = $pdo->prepare('
            SELECT rj.posisi, rj.role_key
            FROM riwayat_jabatan rj
            JOIN periode_jabatan pj ON rj.periode_id = pj.id
            WHERE rj.student_id = :sid
              AND pj.status = "aktif"
              AND rj.status = "aktif"
              AND rj.punya_akses_sistem = 1
            LIMIT 1
        ');
        $roleStmt->execute(['sid' => $row['student_id']]);
        $roleRow = $roleStmt->fetch();

        if (!$roleRow) {
            // Jabatannya sudah berakhir / tidak lagi punya akses sistem.
            return false;
        }
        $role_key = $roleRow['role_key'];
        $posisi   = $roleRow['posisi'];
    }

    $_SESSION['user'] = [
        'id'             => $row['id'],
        'nama'           => $row['nama'],
        'email'          => $row['email'],
        'student_id'     => $row['student_id'],
        'is_super_admin' => (bool) $row['is_super_admin'],
        'role_key'       => $role_key,
        'posisi'         => $posisi,
    ];

    log_audit($pdo, $row['id'], 'Login ke sistem');

    return true;
}

function log_audit(PDO $pdo, ?int $user_id, string $aksi): void
{
    $stmt = $pdo->prepare('INSERT INTO audit_logs (user_id, aksi) VALUES (:uid, :aksi)');
    $stmt->execute(['uid' => $user_id, 'aksi' => $aksi]);
}
