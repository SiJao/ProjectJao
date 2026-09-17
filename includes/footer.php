</div>
<script src="assets/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
<script>
/**
 * Polling notifikasi ringan (fallback pengganti Web Push yang butuh
 * enkripsi kompleks) -- cek tiap 30 detik, aman dipanggil di semua
 * halaman krn modul notif_count login-only & selalu ada.
 */
(function () {
    var badge = document.getElementById('notifBadge');
    if (!badge) return;
    function cekNotifikasi() {
        fetch('dashboard.php?modul=notif_count')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.jumlah > 0) {
                    badge.textContent = data.jumlah;
                    badge.title = data.pesan;
                    badge.classList.remove('d-none');
                } else {
                    badge.classList.add('d-none');
                }
            })
            .catch(function () { /* diam saja kalau gagal, jangan ganggu pengguna */ });
    }
    cekNotifikasi();
    setInterval(cekNotifikasi, 30000);
})();

/**
 * Begitu halaman modul baru dimuat, pastikan tautan menu yang sedang
 * aktif (.sidebar a.active) langsung terlihat di area sidebar yang bisa
 * discroll -- supaya kalau menu itu posisinya jauh di bawah daftar,
 * pengguna tidak perlu scroll manual dulu tiap ganti modul.
 */
(function () {
    var aktif = document.querySelector('.sidebar a.active');
    if (aktif) {
        aktif.scrollIntoView({ block: 'nearest' });
    }
})();
</script>
</body>
</html>
