// npm run service: (as root) runs the API as a Linux service that starts on boot and restarts if it stops.
// Afterwards: systemctl restart smartfinora-api | systemctl status smartfinora-api | journalctl -u smartfinora-api -n 50
const { execSync } = require('child_process');
const { statSync, writeFileSync } = require('fs');
const { join } = require('path');

const name = 'smartfinora-api';
const dir = __dirname;
const owner = statSync(dir).uid === 0 ? 'root' : execSync(`id -nu ${statSync(dir).uid}`).toString().trim();
const unit = `[Unit]
Description=SmartFinora API
After=network.target postgresql.service

[Service]
WorkingDirectory=${dir}
ExecStart=${process.execPath} ${join(dir, 'dist/main.js')}
Restart=always
RestartSec=5
User=${owner}
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
`;
writeFileSync(`/etc/systemd/system/${name}.service`, unit);
execSync(`systemctl daemon-reload && systemctl enable ${name} && systemctl restart ${name}`, { stdio: 'inherit' });
console.log(`\n${name} is running as ${owner} and starts on boot. Check it with: npm run check`);
