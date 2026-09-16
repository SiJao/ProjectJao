<?php
require_once __DIR__ . '/../includes/error_page.php';

/**
 * Koneksi database (PDO).
 *
 * PENTING untuk hosting shared (cPanel/Hostinger): nilai di bawah ini
 * HANYA CONTOH dan tidak akan jalan apa adanya. Di cPanel, nama
 * database dan nama user MySQL selalu diberi prefix otomatis oleh
 * akunmu, misal "u123456789_hisada_db" dan "u123456789_hisada_user"
 * -- BUKAN "hisada_db" dan "root". Salin nama yang PERSIS sama dengan
 * yang kamu buat di cPanel -> MySQL Databases (lihat catatan lengkap
 * di bagian atas database.sql).
 *
 * JANGAN PERNAH commit kredensial produksi asli ke file ini kalau
 * repo ini publik/dibagikan -- isi nilai asli hanya di server hosting,
 * bukan di kode yang ikut ter-push ke Git.
 */
define('DB_HOST', 'localhost');
define('DB_NAME', 'hisada_db');   // ganti: nama database dg prefix akunmu
define('DB_USER', 'root');        // ganti: nama user MySQL dg prefix akunmu
define('DB_PASS', '');            // ganti: password user MySQL tsb

try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER,
        DB_PASS,
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]
    );
} catch (PDOException $e) {
    error_log('Koneksi database gagal: ' . $e->getMessage());
    render_error_page(
        500,
        'Koneksi Database Gagal',
        'Sistem tidak dapat terhubung ke database. Biasanya karena kredensial di config/database.php belum sesuai dengan yang dibuat di cPanel -> MySQL Databases, atau nama database/usernya belum diberi prefix akun. Hubungi admin/pengelola server.',
        null
    );
}
