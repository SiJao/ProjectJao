<?php
session_start();
unset($_SESSION['wali_family_id'], $_SESSION['wali_username']);
header('Location: wali.php');
exit;
