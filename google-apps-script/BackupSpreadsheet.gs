/**
 * ============================================================
 * BACKUP HISADA -> GOOGLE SPREADSHEET
 * ============================================================
 * Cara pakai:
 * 1. Buka https://script.google.com -> New Project.
 * 2. Hapus isi default, tempel SELURUH isi file ini.
 * 3. Klik ikon Spreadsheet (Resources/Services tidak perlu diubah).
 * 4. Buat Google Spreadsheet baru di Google Drive-mu, salin ID-nya
 *    dari URL-nya (bagian antara /d/ dan /edit), lalu isi di bawah:
 */
const SPREADSHEET_ID = 'GANTI_DENGAN_ID_SPREADSHEET_KAMU';

/**
 * 5. Klik Deploy -> New deployment -> pilih tipe "Web app".
 *    - Execute as: Me
 *    - Who has access: Anyone (supaya server Hisada bisa mengirim data --
 *      keamanannya ada di KUNCI_RAHASIA di bawah, bukan di pengaturan ini)
 * 6. Salin URL Web App yang muncul, tempel ke halaman Backup Database
 *    di aplikasi Hisada (menu Backup Database -> Pengaturan Google Sheets).
 * 7. Ganti KUNCI_RAHASIA di bawah dgn kata sandi bebas milikmu sendiri,
 *    lalu isi KUNCI RAHASIA YANG SAMA PERSIS di halaman Backup Hisada.
 */
const KUNCI_RAHASIA = 'GANTI_DENGAN_KATA_SANDI_RAHASIA_BEBAS';

/**
 * PENTING -- JEBAKAN PALING UMUM: kalau kamu mengedit file ini LAGI
 * setelah sudah pernah Deploy sebelumnya (misal ganti KUNCI_RAHASIA atau
 * SPREADSHEET_ID), URL Web App yang LAMA TIDAK OTOMATIS ikut ter-update.
 * Kamu harus buka Deploy -> Manage deployments -> klik ikon pensil (Edit)
 * di deployment yang aktif -> Version: pilih "New version" -> Deploy.
 * Kalau cuma bikin "New deployment" baru (bukan edit yg lama), kamu akan
 * dapat URL BARU YANG BERBEDA -- dan URL lama di halaman Backup Hisada
 * jadi tidak nyambung ke kode terbaru sama sekali (inilah salah satu
 * penyebab paling sering "kelihatan terkirim tapi data tidak masuk").
 */

/**
 * Menerima POST dari server Hisada berisi:
 *   { kunci: "...", tabel: "nama_tabel", header: [...], baris: [[...], ...] }
 * Setiap tabel ditulis ke sheet (tab) dengan nama yang sama, ISI SHEET
 * DIHAPUS DULU lalu ditulis ulang (jadi selalu cerminan data terbaru,
 * bukan menumpuk/append tanpa batas).
 *
 * tabel="__ping__" khusus utk TES KONEKSI dari halaman Backup Hisada --
 * cuma validasi kunci, TIDAK menyentuh spreadsheet sama sekali. Dipakai
 * supaya bisa tahu apakah URL & kunci sudah benar SEBELUM proses backup
 * sungguhan mulai (biar tidak "kelihatan jalan" tapi ternyata gagal diam2).
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.kunci !== KUNCI_RAHASIA) {
      return jsonResponse({ ok: false, pesan: 'Kunci rahasia tidak cocok.' });
    }

    if (data.tabel === '__ping__') {
      return jsonResponse({ ok: true, pesan: 'Koneksi berhasil, kunci rahasia cocok.' });
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(data.tabel);
    if (!sheet) {
      sheet = ss.insertSheet(data.tabel);
    } else {
      sheet.clear();
    }

    if (data.header && data.header.length) {
      sheet.appendRow(data.header);
    }
    if (data.baris && data.baris.length) {
      // Tulis sekaligus (lebih cepat drpd appendRow satu-satu utk data banyak)
      sheet.getRange(2, 1, data.baris.length, data.header.length)
           .setValues(data.baris);
    }

    return jsonResponse({ ok: true, pesan: 'Tabel "' + data.tabel + '" berhasil ditulis (' + (data.baris ? data.baris.length : 0) + ' baris).' });
  } catch (err) {
    return jsonResponse({ ok: false, pesan: 'Error: ' + err.message });
  }
}

/**
 * doGet dipakai utk cek paling dasar: kalau kamu tempel URL Web App ini
 * langsung di address bar browser dan muncul pesan di bawah (bukan error
 * Google/halaman login/404), berarti DEPLOYMENT-nya sendiri sudah benar
 * dan aktif -- baru lanjut cek lewat "Test Koneksi" di halaman Backup
 * Hisada (yg juga mengetes kunci rahasia & jalur POST-nya).
 */
function doGet(e) {
  return jsonResponse({ ok: true, pesan: 'Script Apps Script ini aktif & bisa diakses. Gunakan tombol "Test Koneksi" di halaman Backup Hisada utk mengetes jalur POST + kunci rahasia.' });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Fungsi ini opsional -- cuma utk tes manual dari editor Apps Script
 * (klik Run -> testManual) supaya kamu bisa pastikan skrip ini jalan
 * SEBELUM dihubungkan ke aplikasi Hisada.
 */
function testManual() {
  const palsu = {
    postData: {
      contents: JSON.stringify({
        kunci: KUNCI_RAHASIA,
        tabel: 'tes',
        header: ['Kolom A', 'Kolom B'],
        baris: [['halo', 'dunia'], ['contoh', 'baris 2']],
      }),
    },
  };
  const hasil = doPost(palsu);
  Logger.log(hasil.getContent());
}
