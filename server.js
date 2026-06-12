const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 8080;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Get local IP for display
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;

  // Route mapping
  let filePath;
  if (pathname === '/' || pathname === '/index.html') {
    filePath = 'index.html';   // Participant page
  } else if (pathname === '/admin' || pathname === '/admin.html') {
    filePath = 'admin.html';   // Admin page
  } else {
    filePath = pathname.substring(1);
  }

  // Sanitize path to prevent directory traversal
  filePath = path.normalize(filePath).replace(/^(\.\.[\\/])+/, '');
  const fullPath = path.join(__dirname, filePath);

  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(fullPath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║           IPI TEST SERVER - RUNNING              ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  👤 Link Người Dùng (gửi cho người tham gia):    ║`);
  console.log(`║     http://${ip}:${PORT}/                          `);
  console.log(`║                                                   ║`);
  console.log(`║  🔐 Link Quản Trị (chỉ dành cho bạn):           ║`);
  console.log(`║     http://${ip}:${PORT}/admin                     `);
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
});
