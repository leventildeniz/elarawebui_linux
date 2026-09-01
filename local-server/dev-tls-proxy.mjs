// local-server/dev-tls-proxy.mjs
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'proxy-config.json');

function loadConfig() {
  try {
    const data = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Config load error, using defaults:', err.message);
    return {
      httpsPort: 10443,
      httpPort: 8080,
      apiPort: 3005,
      certFile: path.join(__dirname, 'certs/elara.pem'),
      keyFile: path.join(__dirname, 'certs/elara-key.pem'),
    };
  }
}

const config = loadConfig();

const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
];

const serverOptions = {
  key: fs.readFileSync(config.keyFile),
  cert: fs.readFileSync(config.certFile),
};

const proxy = (targetPort) => (req, res) => {
  const originalHost = req.headers.host;
  
  const filteredHeaders = { ...req.headers };
  HOP_BY_HOP_HEADERS.forEach(h => delete filteredHeaders[h]);

  const options = {
    hostname: '127.0.0.1',
    port: targetPort,
    path: req.url,
    method: req.method,
    headers: { 
      ...filteredHeaders, 
      'x-forwarded-proto': req.connection.encrypted ? 'https' : 'http',
      'x-forwarded-host': originalHost,
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const headers = { ...proxyRes.headers };
    
    // Remove hop-by-hop headers from response
    HOP_BY_HOP_HEADERS.forEach(h => delete headers[h]);

    if (headers.location) {
      headers.location = headers.location
        .replace(/https:\/\/localhost:\d+/g, 'https://' + originalHost)
        .replace(/http:\/\/localhost:\d+/g, 'http://' + originalHost)
        .replace(/https:\/\/127\.0\.0\.1:\d+/g, 'https://' + originalHost)
        .replace(/http:\/\/127\.0\.0\.1:\d+/g, 'http://' + originalHost);
    }

    for (const key in headers) {
      if (typeof headers[key] === 'string') {
        headers[key] = headers[key]
          .replace(/localhost:\d+/g, originalHost)
          .replace(/127\.0\.0\.1:\d+/g, originalHost);
      }
    }

    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });

  req.pipe(proxyReq);
  proxyReq.on('error', (err) => {
    res.writeHead(502);
    res.end('Bad Gateway: ' + err.message);
  });
};

const httpsServer = https.createServer(serverOptions, (req, res) => {
  if (req.url.startsWith('/api')) {
    return proxy(config.apiPort)(req, res);
  }
  return proxy(8080)(req, res);
});

// Handle WebSocket Upgrades (Vite HMR)
httpsServer.on('upgrade', (req, socket, head) => {
  const targetPort = req.url.startsWith('/api') ? config.apiPort : 8080;
  
  const proxySocket = net.createConnection({ port: targetPort, host: '127.0.0.1' });

  // Reconstruct the HTTP upgrade request
  let request = `${req.method} ${req.url} HTTP/1.1\r\n`;
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      value.forEach(v => {
        request += `${key}: ${v}\r\n`;
      });
    } else {
      request += `${key}: ${value}\r\n`;
    }
  }
  request += '\r\n';

  proxySocket.write(request);
  proxySocket.write(head);
  
  proxySocket.on('error', (err) => {
    console.error('WebSocket Proxy Error:', err);
    socket.destroy();
  });
  
  socket.pipe(proxySocket);
  proxySocket.pipe(socket);
});

httpsServer.listen(config.httpsPort, '0.0.0.0', () => {
  console.log('🚀 HTTPS Proxy listening on ' + config.httpsPort);
});
