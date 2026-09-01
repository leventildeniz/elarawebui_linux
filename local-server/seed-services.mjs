import pg from "pg";

const pool = new pg.Pool({
  connectionString: "postgres://sovereign:sovereign@127.0.0.1:5432/elara_db"
});

const services = [
  {
    id: "svc.elara_worker",
    key: "elara-worker",
    name: "Elara Worker",
    kind: "systemd systemctl",
    probe: "systemctl status elara-worker.service",
    username: "root",
    manager: "systemd",
    unit: "elara-worker.service",
    sudo: true,
    transport: "local-agent",
    online: true,
    detail: "RUNNING · healthy"
  },
  {
    id: "svc.elara_middleware",
    key: "elara-middleware",
    name: "Elara Middleware",
    kind: "systemd systemctl",
    probe: "systemctl status elara-middleware.service",
    username: "root",
    manager: "systemd",
    unit: "elara-middleware.service",
    sudo: true,
    transport: "local-agent",
    online: true,
    detail: "RUNNING · healthy"
  },
  {
    id: "svc.elara_vite",
    key: "elara-vite",
    name: "Elara Vite (SSR)",
    kind: "systemd systemctl",
    probe: "systemctl status elara-vite.service",
    username: "root",
    manager: "systemd",
    unit: "elara-vite.service",
    sudo: true,
    transport: "local-agent",
    online: true,
    detail: "RUNNING · healthy"
  },
  {
    id: "svc.elara_tls",
    key: "elara-tls-proxy",
    name: "Elara TLS Proxy",
    kind: "systemd systemctl",
    probe: "systemctl status elara-tls-proxy.service",
    username: "root",
    manager: "systemd",
    unit: "elara-tls-proxy.service",
    sudo: true,
    transport: "local-agent",
    online: true,
    detail: "RUNNING · healthy"
  },
  {
    id: "svc.pg",
    key: "postgres",
    name: "PostgreSQL Database",
    kind: "PostgreSQL",
    probe: "postgres://sovereign:***@127.0.0.1:5432/elara_db",
    username: "levent",
    manager: "systemd",
    unit: "postgresql@18-main.service",
    sudo: true,
    transport: "local-agent",
    online: true,
    detail: "postgres"
  }
];

async function seed() {
  try {
    console.log("Seeding app_services...");
    for (const s of services) {
      await pool.query(
        `INSERT INTO app_services 
         (id, key, name, kind, probe, username, credential, manager, unit, sudo, transport, host, start_cmd, stop_cmd, restart_cmd, status_cmd, online, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name, key=EXCLUDED.key, unit=EXCLUDED.unit, probe=EXCLUDED.probe`,
        [
          s.id, s.key, s.name, s.kind, s.probe, s.username, "",
          s.manager, s.unit, s.sudo, s.transport, "", "", "", "", "", s.online, s.detail
        ]
      );
      console.log(`Inserted: ${s.name}`);
    }
    console.log("Done.");
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

seed();