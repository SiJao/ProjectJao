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
 * Menerima POST dari server Hisada berisi:
 *   { kunci: "...", tabel: "nama_tabel", header: [...], baris: [[...], ...] }
 * Setiap tabel ditulis ke sheet (tab) dengan nama yang sama, ISI SHEET
 * DIHAPUS DULU lalu ditulis ulang (jadi selalu cerminan data terbaru,
 * bukan menumpuk/append tanpa batas).
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.kunci !== KUNCI_RAHASIA) {
      return jsonResponse({ ok: false, pesan: 'Kunci rahasia tidak cocok.' });
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
