const canvas = document.getElementById('wave-canvas');
const ctx = canvas.getContext('2d');

let width, height;
let time = 0;
let animationId;

function resize() {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
}

window.addEventListener('resize', resize);
resize();

const waves = [
  { amplitude: 35, frequency: 0.015, speed: 0.025, color: 'rgba(124, 92, 255, 0.35)', yOffset: 0.55 },
  { amplitude: 28, frequency: 0.02, speed: 0.02, color: 'rgba(155, 126, 255, 0.28)', yOffset: 0.58 },
  { amplitude: 22, frequency: 0.025, speed: 0.03, color: 'rgba(255, 107, 53, 0.22)', yOffset: 0.61 },
  { amplitude: 18, frequency: 0.03, speed: 0.018, color: 'rgba(255, 140, 80, 0.18)', yOffset: 0.64 },
  { amplitude: 30, frequency: 0.018, speed: 0.022, color: 'rgba(100, 70, 220, 0.25)', yOffset: 0.52 },
];

function drawWave(wave, t) {
  ctx.beginPath();
  ctx.moveTo(0, height);

  for (let x = 0; x <= width; x += 2) {
    const y = height * wave.yOffset +
      Math.sin(x * wave.frequency + t * wave.speed) * wave.amplitude +
      Math.sin(x * wave.frequency * 0.5 + t * wave.speed * 1.5) * wave.amplitude * 0.5;
    ctx.lineTo(x, y);
  }

  ctx.lineTo(width, height);
  ctx.closePath();

  const gradient = ctx.createLinearGradient(0, height * wave.yOffset - wave.amplitude, 0, height);
  gradient.addColorStop(0, wave.color);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fill();
}

function drawBars(t) {
  const barCount = 64;
  const barWidth = width / barCount;
  const centerY = height * 0.48;

  for (let i = 0; i < barCount; i++) {
    const barHeight = 20 + Math.abs(Math.sin(i * 0.3 + t * 0.04)) * 40 +
                      Math.abs(Math.cos(i * 0.2 + t * 0.03)) * 30;
    const x = i * barWidth + barWidth * 0.25;
    const w = barWidth * 0.5;

    const gradient = ctx.createLinearGradient(x, centerY - barHeight / 2, x, centerY + barHeight / 2);
    gradient.addColorStop(0, 'rgba(124, 92, 255, 0.7)');
    gradient.addColorStop(0.5, 'rgba(155, 126, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(255, 107, 53, 0.2)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(x, centerY - barHeight / 2, w, barHeight, 3);
    ctx.fill();
  }
}

function animate() {
  ctx.clearRect(0, 0, width, height);

  drawBars(time);

  waves.forEach(wave => drawWave(wave, time));

  time++;
  animationId = requestAnimationFrame(animate);
}

animate();
