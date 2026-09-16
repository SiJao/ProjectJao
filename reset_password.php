<?php
/**
 * UTILITAS SEKALI PAKAI.
 * Bcrypt punya salt acak, jadi hash contoh di database.sql belum tentu
 * cocok persis dengan "hisada123" di server kamu. Jalankan file ini SEKALI
 * lewat browser setelah import database.sql, lalu HAPUS file ini dari server.
 *
 * Tidak butuh login -- karena itu jangan biarkan menumpuk di server produksi.
 */
require_once __DIR__ . '/config/database.php';

$passwordBaru = 'hisada123';
$hash = password_hash($passwordBaru, PASSWORD_BCRYPT);

$stmt = $pdo->prepare('UPDATE users SET password = :hash');
$stmt->execute(['hash' => $hash]);

echo '<div style="font-family:sans-serif;max-width:520px;margin:60px auto;padding:24px;border:1px solid #ddd;border-radius:8px">';
echo '<h3>Selesai</h3>';
echo '<p>Password seluruh akun contoh (' . $stmt->rowCount() . ' akun) telah direset ke: <b>' . htmlspecialchars($passwordBaru) . '</b></p>';
echo '<p style="color:#b5432f"><b>Penting:</b> hapus file <code>reset_password.php</code> ini dari server sekarang juga.</p>';
echo '</div>';
