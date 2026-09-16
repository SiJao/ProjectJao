<?php
require_once __DIR__ . '/includes/auth.php';
if ($user = current_user()) {
    log_audit($pdo, $user['id'], 'Logout dari sistem');
}
session_destroy();
header('Location: index.php');
exit;
