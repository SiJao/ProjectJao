// Ambil waktu target dari HTML
const targetDateElement = document.querySelector('.target-date');
const targetDateString = targetDateElement.getAttribute('data-target');
const targetDate = new Date(targetDateString).getTime();

// Ambil elemen DOM
const daysElement = document.getElementById('days');
const hoursElement = document.getElementById('hours');
const minutesElement = document.getElementById('minutes');
const secondsElement = document.getElementById('seconds');
const messageElement = document.getElementById('message');

// Fungsi untuk menambahkan leading zero
function padZero(num) {
    return num < 10 ? '0' + num : num;
}

// Fungsi untuk update countdown
function updateCountdown() {
    const now = new Date().getTime();
    const distance = targetDate - now;
    
    // Jika countdown selesai
    if (distance < 0) {
        daysElement.textContent = '00';
        hoursElement.textContent = '00';
        minutesElement.textContent = '00';
        secondsElement.textContent = '00';
        messageElement.textContent = '🎉 Waktu telah tiba! 🎉';
        clearInterval(countdownInterval);
        return;
    }
    
    // Hitung waktu
    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);
    
    // Update tampilan dengan animasi
    updateElement(daysElement, padZero(days));
    updateElement(hoursElement, padZero(hours));
    updateElement(minutesElement, padZero(minutes));
    updateElement(secondsElement, padZero(seconds));
}

// Fungsi untuk update elemen dengan smooth transition
function updateElement(element, value) {
    if (element.textContent !== value) {
        element.style.transform = 'scale(1.1)';
        element.textContent = value;
        
        setTimeout(() => {
            element.style.transform = 'scale(1)';
        }, 100);
    }
}

// Tambahkan transition CSS untuk animasi
daysElement.style.transition = 'transform 0.1s ease';
hoursElement.style.transition = 'transform 0.1s ease';
minutesElement.style.transition = 'transform 0.1s ease';
secondsElement.style.transition = 'transform 0.1s ease';

// Jalankan countdown pertama kali
updateCountdown();

// Update setiap detik
const countdownInterval = setInterval(updateCountdown, 1000);
