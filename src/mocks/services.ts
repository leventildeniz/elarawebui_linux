/** /services — background service tower placeholder rows. */

export type ServiceManager = "systemd" | "launchd" | "custom";
export type ServiceTransport = "local-agent" | "ssh";

export type MockService = {
  id: string;
  key: string;
  name: string;
  kind: string;
  probe: string;
  username: string;
  /** vault entry id or `raw://<raw>` */
  credential: string;
  manager: ServiceManager;
  unit: string;
  sudo: boolean;
  transport: ServiceTransport;
  host: string;
  startCmd: string;
  stopCmd: string;
  restartCmd: string;
  statusCmd: string;
  online: boolean;
  detail: string;
};

export const serviceLifecycleSeed = {
  manager: "custom" as ServiceManager,
  unit: "",
  sudo: false,
  transport: "local-agent" as ServiceTransport,
  host: "",
  startCmd: "",
  stopCmd: "",
  restartCmd: "",
  statusCmd: "",
};

export const seedServices: MockService[] = [
  {
    id: "svc.legacy",
    key: "legacy-http",
    name: "Legacy HTTP",
    kind: "HTTP probe",
    probe: "http://127.0.0.1:8081/health",
    username: "",
    credential: "",
    ...serviceLifecycleSeed,
    online: false,
    detail: "Unable to connect. Is the host able to reach the url?",
  },
  {
    id: "svc.runtime",
    key: "model-runtime",
    name: "Model Runtime",
    kind: "HTTP probe",
    probe: "http://127.0.0.1:8080/v1/models",
    username: "",
    credential: "",
    ...serviceLifecycleSeed,
    online: true,
    detail: "26 ms · http://127.0.0.1:8080/v1/models",
  },
  {
    id: "svc.node",
    key: "node-api",
    name: "Node API (:3005)",
    kind: "HTTP probe",
    probe: "http://127.0.0.1:3005/api/health",
    username: "",
    credential: "",
    ...serviceLifecycleSeed,
    online: true,
    detail: "1 ms · http://127.0.0.1:3005/api/health",
  },
  {
    id: "svc.pg",
    key: "postgres",
    name: "PostgreSQL",
    kind: "Process",
    probe: "postgres",
    username: "postgres",
    credential: "",
    ...serviceLifecycleSeed,
    manager: "systemd",
    unit: "postgresql",
    sudo: true,
    online: true,
    detail: "postgres",
  },
];

/** Probe/lifecycle kinds offered in the service editor. */
export const serviceKinds = [
  "HTTP probe",
  "TCP probe",
  "Process",
  "Command",
  "PostgreSQL",
  "systemd systemctl",
  "launchctl",
];
