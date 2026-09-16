<?php
// $page_title diisi oleh masing-masing halaman sebelum include file ini.
if (!isset($page_title)) {
    $page_title = 'Hisada';
}
?>
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title><?= htmlspecialchars($page_title) ?> - Hisada</title>
<link href="assets/vendor/bootstrap/css/bootstrap.min.css" rel="stylesheet">
<link href="assets/vendor/bootstrap-icons/bootstrap-icons.min.css" rel="stylesheet">
<link href="assets/css/style.css?v=<?= @filemtime(__DIR__ . '/../assets/css/style.css') ?: time() ?>" rel="stylesheet">
<script>
/**
 * Komponen pencarian santri (ketik nama/NIS, klik hasil yang cocok).
 * Dipakai di semua form yang sebelumnya pakai <select> daftar santri.
 * container harus punya .sp-input, .sp-value (hidden), .sp-suggestions.
 * data: array of {id, nis, nama}.
 * PENTING: fungsi ini HARUS didefinisikan di <head> (sebelum konten body
 * dimuat) -- form-form modul memanggilnya lewat inline <script> di tengah
 * halaman, jadi kalau didefinisikan di akhir (footer), pemanggilan akan
 * gagal dgn "attachSantriPicker is not defined" karena browser menjalankan
 * <script> sesuai urutan dokumen.
 */
function attachSantriPicker(container, data) {
    var input = container.querySelector('.sp-input');
    var hidden = container.querySelector('.sp-value');
    var box = container.querySelector('.sp-suggestions');

    function render(list) {
        box.innerHTML = '';
        if (!list.length) { box.style.display = 'none'; return; }
        list.slice(0, 8).forEach(function (s) {
            var item = document.createElement('div');
            item.className = 'sp-item';
            item.textContent = s.nis + ' - ' + s.nama;
            item.addEventListener('mousedown', function (e) {
                e.preventDefault(); // supaya tidak kalah cepat sama event blur
                hidden.value = s.id;
                input.value = s.nis + ' - ' + s.nama;
                box.style.display = 'none';
            });
            box.appendChild(item);
        });
        box.style.display = 'block';
    }

    input.addEventListener('input', function () {
        hidden.value = '';
        var q = input.value.trim().toLowerCase();
        if (!q) { box.style.display = 'none'; return; }
        var matches = data.filter(function (s) {
            return s.nama.toLowerCase().includes(q) || s.nis.toLowerCase().includes(q);
        });
        render(matches);
    });
    input.addEventListener('focus', function () {
        if (input.value.trim() && !hidden.value) input.dispatchEvent(new Event('input'));
    });
    input.addEventListener('blur', function () {
        setTimeout(function () { box.style.display = 'none'; }, 120);
    });
}
</script>
</head>
<body>
<div class="mobile-topbar d-md-none no-print">
    <button class="btn-hamburger" type="button" data-bs-toggle="offcanvas" data-bs-target="#sidebarMobile" aria-label="Buka menu">
        <i class="bi bi-list"></i>
    </button>
    <img src="https://ik.imagekit.io/HiLink/LOGO%20HISADA%20.png?updatedAt=1788676662703" alt="Logo Hisada" class="mobile-topbar-logo">
</div>
<div class="d-flex app-shell">
