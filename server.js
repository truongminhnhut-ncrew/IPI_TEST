const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const DATA_DIR = path.join(__dirname, 'data');
const PROJECT_FILE = path.join(DATA_DIR, 'project.json');
const RESULTS_FILE = path.join(DATA_DIR, 'results.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  // CORS Headers to allow requests from other machines
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: Get/Set Project Configuration
  if (pathname === '/api/project') {
    if (method === 'GET') {
      if (fs.existsSync(PROJECT_FILE)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        fs.createReadStream(PROJECT_FILE).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Project not found' }));
      }
      return;
    }
    
    if (method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          // Validate JSON
          JSON.parse(body);
          fs.writeFileSync(PROJECT_FILE, body, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'success' }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }
  }

  // API: Get/Post Results
  if (pathname === '/api/results') {
    if (method === 'GET') {
      if (fs.existsSync(RESULTS_FILE)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        fs.createReadStream(RESULTS_FILE).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
      }
      return;
    }

    if (method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const newResult = JSON.parse(body);
          let results = [];
          if (fs.existsSync(RESULTS_FILE)) {
            try {
              results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
            } catch (e) {
              results = [];
            }
          }
          if (!Array.isArray(results)) results = [];
          results.unshift(newResult); // Prepend to show latest first
          fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf8');
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'success' }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }
  }

  // API: Clear Results
  if (pathname === '/api/clear-results' && method === 'POST') {
    try {
      fs.writeFileSync(RESULTS_FILE, JSON.stringify([]), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success' }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Could not clear results' }));
    }
    return;
  }

  // Static File Serving
  if (method === 'GET') {
    let filePath = pathname === '/' ? 'index.html' : pathname.substring(1);
    // Sanitize path to prevent directory traversal
    filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
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
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('Method Not Allowed');
});

// Listen on all network interfaces to allow local network connections
server.listen(PORT, '0.0.0.0', () => {
  console.log(`IPI TEST Server is running on http://localhost:${PORT}`);
  console.log(`To access from other machines in the same network, use http://<YOUR_IP_ADDRESS>:${PORT}`);
});
