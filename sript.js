const countdownEl = document.getElementById('countdown');
const daysEl = document.getElementById('days');
const hoursEl = document.getElementById('hours');
const minutesEl = document.getElementById('minutes');
const secondsEl = document.getElementById('seconds');
const finishedEl = document.getElementById('finished');
const startBtn = document.getElementById('start-btn');
const targetTimeInput = document.getElementById('target-time');

let countdownInterval = null;

function startCountdown(targetDate) {
  clearInterval(countdownInterval);
  finishedEl.style.display = 'none';
  countdownEl.style.display = 'block';

  function updateCountdown() {
    const now = new Date().getTime();
    const distance = targetDate - now;

    if (distance <= 0) {
      clearInterval(countdownInterval);
      daysEl.textContent = '00';
      hoursEl.textContent = '00';
      minutesEl.textContent = '00';
      secondsEl.textContent = '00';
      countdownEl.style.display = 'none';
      finishedEl.style.display = 'block';
      return;
    }

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((distance / (1000 * 60)) % 60);
    const seconds = Math.floor((distance / 1000) % 60);

    daysEl.textContent = days.toString().padStart(2, '0');
    hoursEl.textContent = hours.toString().padStart(2, '0');
    minutesEl.textContent = minutes.toString().padStart(2, '0');
    secondsEl.textContent = seconds.toString().padStart(2, '0');
  }

  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 1000);
}

startBtn.addEventListener('click', () => {
  const val = targetTimeInput.value;
  if (!val) return;
  const targetDate = new Date(val.replace('T', ' ') + ':00').getTime();
  if (isNaN(targetDate) || targetDate < Date.now()) {
    alert('Please set a future date and time.');
    return;
  }
  startCountdown(targetDate);
});

// Optionally, start automatically if preset value is valid
document.addEventListener('DOMContentLoaded', () => {
  if (targetTimeInput.value) {
    const targetDate = new Date(targetTimeInput.value.replace('T', ' ') + ':00').getTime();
    if (targetDate > Date.now()) {
      startCountdown(targetDate);
    }
  }
});
