const { networkInterfaces } = require('os');
const { spawn } = require('child_process');

const nets = networkInterfaces();
let localIp = '';

// Try to find a Wi-Fi or Ethernet adapter first to avoid WSL/VirtualBox adapters
for (const name of Object.keys(nets)) {
  if (localIp) break;
  for (const net of nets[name]) {
    if (net.family === 'IPv4' && !net.internal) {
      if (name.toLowerCase().includes('wi-fi') || name.toLowerCase().includes('ethernet') || name.toLowerCase().includes('wlan')) {
        localIp = net.address;
        break;
      }
    }
  }
}

// Fallback to the first available non-internal IPv4 if no standard name matched
if (!localIp) {
  for (const name of Object.keys(nets)) {
    if (localIp) break;
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIp = net.address;
        break;
      }
    }
  }
}

console.log(`\n=========================================`);
console.log(`🌐 Automatically detected Local IP: ${localIp}`);
console.log(`🚀 Forcing Expo to bind to this IP address...`);
console.log(`=========================================\n`);

const child = spawn('npx', ['expo', 'start', '--lan', '--port', '8085'], {
  env: { 
    ...process.env, 
    REACT_NATIVE_PACKAGER_HOSTNAME: localIp 
  },
  stdio: 'inherit',
  shell: true
});

child.on('error', (err) => {
  console.error('Failed to start Expo:', err);
});
