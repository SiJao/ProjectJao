const targetDate = new Date('2025-11-15T00:00:00').getTime();

const daysElement = document.getElementById('days');
const hoursElement = document.getElementById('hours');
const minutesElement = document.getElementById('minutes');
const secondsElement = document.getElementById('seconds');
const messageElement = document.getElementById('message');

function updateCountdown() {
    const now = new Date().getTime();
    const distance = targetDate - now;

    if (distance < 0) {
        daysElement.textContent = '00';
        hoursElement.textContent = '00';
        minutesElement.textContent = '00';
        secondsElement.textContent = '00';
        messageElement.textContent = '🎉 Waktu telah tiba! 🎉';
        clearInterval(countdownInterval);
        return;
    }

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    daysElement.textContent = String(days).padStart(2, '0');
    hoursElement.textContent = String(hours).padStart(2, '0');
    minutesElement.textContent = String(minutes).padStart(2, '0');
    secondsElement.textContent = String(seconds).padStart(2, '0');

    if (days === 0 && hours === 0 && minutes === 0) {
        messageElement.textContent = '⏰ Hampir tiba!';
    } else if (days === 0) {
        messageElement.textContent = '🔥 Kurang dari sehari lagi!';
    } else if (days <= 7) {
        messageElement.textContent = '⚡ Tinggal beberapa hari lagi!';
    } else {
        messageElement.textContent = '';
    }
}

updateCountdown();
const countdownInterval = setInterval(updateCountdown, 1000);
