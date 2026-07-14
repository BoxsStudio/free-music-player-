const { rcedit } = require('rcedit');
const path = require('path');

const exePath = path.join(__dirname, 'dist', 'win-unpacked', 'Free Music Player.exe');
const icoPath = path.join(__dirname, 'icon.ico');

rcedit(exePath, { icon: icoPath })
  .then(() => console.log('DONE - icon set'))
  .catch(e => console.error('ERR:', e.message));
