<?php
$user      = current_user();
$role      = $user['role_key'];
$isAdmin   = $user['is_super_admin'];
$currentModul = $_GET['modul'] ?? 'home';

function nav_link($modulKey, $icon, $label, $currentModul)
{
    $active = ($currentModul === $modulKey) ? 'active' : '';
    echo "<a class=\"$active\" href=\"dashboard.php?modul=$modulKey\"><i class=\"bi $icon me-2\"></i>$label</a>";
}
?>
<div class="sidebar offcanvas-md offcanvas-start d-flex flex-column" tabindex="-1" id="sidebarMobile">
    <div class="d-md-none d-flex justify-content-between align-items-center px-3 pt-3">
        <span class="fw-semibold text-white">Menu</span>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="offcanvas" data-bs-target="#sidebarMobile" aria-label="Tutup"></button>
    </div>
    <div class="logo-box position-relative">
        <img src="https://ik.imagekit.io/HiLink/LOGO%20HISADA%20.png?updatedAt=1788676662703" alt="Logo Hisada">
        <span id="notifBadge" class="badge bg-danger rounded-pill d-none" style="position:absolute;top:10px;right:16px;" title=""></span>
    </div>

    <small class="section-title">Umum</small>
    <?php nav_link('home', 'bi-speedometer2', 'Dashboard', $currentModul); ?>
    <?php nav_link('kalender', 'bi-calendar3', 'Kalender Akademik', $currentModul); ?>
    <?php nav_link('cari_santri', 'bi-search', 'Cari Santri', $currentModul); ?>
    <?php nav_link('cari_guru', 'bi-search', 'Cari Guru', $currentModul); ?>

    <?php if ($isAdmin || in_array($role, ['piket'], true)): ?>
        <small class="section-title">Kesantrian</small>
        <?php nav_link('absensi', 'bi-clipboard-check', 'Absensi', $currentModul); ?>
        <?php nav_link('perizinan', 'bi-door-open', 'Perizinan & Kamtib', $currentModul); ?>
    <?php endif; ?>

    <?php if ($isAdmin || in_array($role, ['asisten_poskestren'], true)): ?>
        <small class="section-title">Poskestren</small>
        <?php nav_link('poskestren_asisten', 'bi-clipboard2-pulse', 'Input Kunjungan', $currentModul); ?>
    <?php endif; ?>
    <?php if ($isAdmin || in_array($role, ['dokter'], true)): ?>
        <?php if (!$isAdmin): ?><small class="section-title">Poskestren</small><?php endif; ?>
        <?php nav_link('poskestren_dokter', 'bi-heart-pulse', 'Rekam Medis', $currentModul); ?>
    <?php endif; ?>

    <?php if ($isAdmin || in_array($role, ['sekretaris_mahkamah'], true)): ?>
        <small class="section-title">Mahkamah</small>
        <?php nav_link('mahkamah_sekretaris', 'bi-journal-text', 'Input Pelanggaran', $currentModul); ?>
    <?php endif; ?>
    <?php if ($isAdmin || in_array($role, ['hakim'], true)): ?>
        <?php if (!$isAdmin): ?><small class="section-title">Mahkamah</small><?php endif; ?>
        <?php nav_link('mahkamah_hakim', 'bi-hammer', 'Sidang & Vonis', $currentModul); ?>
    <?php endif; ?>

    <?php if ($isAdmin || in_array($role, ['sekretaris'], true)): ?>
        <small class="section-title">Administrasi</small>
        <?php nav_link('korespondensi', 'bi-envelope', 'Korespondensi', $currentModul); ?>
        <?php nav_link('prestasi', 'bi-trophy', 'Prestasi Santri', $currentModul); ?>
        <?php nav_link('rapor', 'bi-file-earmark-text', 'Rapor Kesantrian', $currentModul); ?>
        <?php nav_link('inventaris', 'bi-box-seam', 'Inventaris Barang', $currentModul); ?>
    <?php endif; ?>

    <?php if ($isAdmin): ?>
        <small class="section-title">Admin</small>
        <?php nav_link('kelola_user', 'bi-people', 'Kelola User', $currentModul); ?>
        <?php nav_link('serah_terima', 'bi-arrow-left-right', 'Serah Terima Jabatan', $currentModul); ?>
        <?php nav_link('data_master', 'bi-database', 'Data Master', $currentModul); ?>
        <?php nav_link('history', 'bi-clock-history', 'Riwayat Perubahan', $currentModul); ?>
        <?php nav_link('backup', 'bi-cloud-arrow-down', 'Backup Database', $currentModul); ?>
    <?php endif; ?>

    <div class="mt-auto user-box">
        <div class="fw-semibold text-white"><?= htmlspecialchars($user['nama']) ?></div>
        <div><?= htmlspecialchars($user['posisi']) ?></div>
        <a href="logout.php" class="mt-2"><i class="bi bi-box-arrow-right me-1"></i>Keluar</a>
    </div>
</div>
