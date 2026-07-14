const splash = document.getElementById('splash-screen');

document.getElementById('minimize').addEventListener('click', () => window.electronAPI.minimize());
document.getElementById('maximize').addEventListener('click', () => window.electronAPI.maximize());
document.getElementById('close').addEventListener('click', () => window.electronAPI.close());

window.electronAPI.onPageLoaded(() => {
  setTimeout(() => {
    splash.classList.add('fade-out');
    setTimeout(() => {
      splash.style.display = 'none';
    }, 500);
  }, 1500);
});
