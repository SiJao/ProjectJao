<?php
require_once __DIR__ . '/../includes/error_page.php';
define('DB_HOST', '127.0.0.1');
define('DB_NAME', 'hisada_db');
define('DB_USER', 'hisada_user');
define('DB_PASS', 'hisada_pass');
try {
    $pdo = new PDO('mysql:host='.DB_HOST.';dbname='.DB_NAME.';charset=utf8mb4', DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
} catch (PDOException $e) {
    error_log('Koneksi database gagal: ' . $e->getMessage());
    render_error_page(500, 'Koneksi Database Gagal', 'Sistem tidak dapat terhubung ke database.', null);
}
