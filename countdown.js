// Ambil target waktu dari HTML
const targetDateElement = document.querySelector('.target-date');
const targetDate = new Date(targetDateElement.dataset.date).getTime();

// Ambil elemen DOM
const daysElement = document.getElementById('days');
const hoursElement = document.getElementById('hours');
const minutesElement = document.getElementById('minutes');
const secondsElement = document.getElementById('seconds');
const messageElement = document.getElementById('message');

// Fungsi untuk menambahkan leading zero
function padZero(num) {
    return num.toString().padStart(2, '0');
}

// Fungsi untuk update countdown
function updateCountdown() {
    const now = new Date().getTime();
    const distance = targetDate - now;

    // Jika countdown sudah selesai
    if (distance < 0) {
        daysElement.textContent = '00';
        hoursElement.textContent = '00';
        minutesElement.textContent = '00';
        secondsElement.textContent = '00';
        messageElement.textContent = 'Waktu telah tiba!';
        messageElement.classList.add('celebration');
        clearInterval(countdownInterval);
        return;
    }

    // Hitung waktu
    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    // Update tampilan
    daysElement.textContent = padZero(days);
    hoursElement.textContent = padZero(hours);
    minutesElement.textContent = padZero(minutes);
    secondsElement.textContent = padZero(seconds);
}

// Jalankan countdown setiap detik
const countdownInterval = setInterval(updateCountdown, 1000);

// Jalankan pertama kali
updateCountdown();
