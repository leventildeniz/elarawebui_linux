import fs from 'node:fs';
import { exec } from 'node:child_process';
import path from 'node:path';

const CONFIG_PATH = path.join(process.cwd(), 'proxy-config.json');

async function handleProxyConfig(req, res) {
  if (req.method === 'GET') {
    try {
      const config = fs.readFileSync(CONFIG_PATH, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(config);
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to read config' }));
    }
  } else if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const newConfig = JSON.parse(body);
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2));
        
        exec('sudo systemctl restart elara-tls-proxy', (err) => {
          if (err) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Config updated but restart failed' }));
          } else {
            res.writeHead(200);
            res.end(JSON.stringify({ message: 'Config updated and proxy restarted' }));
          }
        });
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }
}

export function mountSystemProxyRoutes(app, deps) {
  app.use('/api/system', (req, res, next) => {
    if (req.url === '/proxy-config') {
      return handleProxyConfig(req, res);
    }
    next();
  });
}
