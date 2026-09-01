import os from 'os';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const PLATFORM = os.platform(); // 'darwin' for Mac, 'linux' for Linux/WSL

export const OS = {
  IS_MAC: PLATFORM === 'darwin',
  IS_LINUX: PLATFORM === 'linux',
};

// Base project root - determined automatically by tracing from import.meta.url
// to the root folder, or via environment variable ELARA_ROOT.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// __dirname is <project_root>/local-server/lib/ so root is two levels up
const RESOLVED_AUTO_ROOT = path.resolve(__dirname, "../..");
export const PROJECT_ROOT = process.env.ELARA_ROOT || RESOLVED_AUTO_ROOT;
/**
 * Resolves a relative path against the determined project root.
 * @param {string} relativePath - The path relative to the project root.
 * @returns {string} The absolute resolved path.
 */
export function resolvePath(relativePath) {
  // If the path is already absolute and starts with the determined root, just return it.
  // Otherwise, join it with the determined project root.
  if (path.isAbsolute(relativePath) && relativePath.startsWith(PROJECT_ROOT)) {
    return relativePath;
  }
  return path.resolve(PROJECT_ROOT, relativePath);
}

/**
 * Returns the OS-specific path to the Python binary.
 * @returns {string} Absolute path to the python binary.
 */
export function getPythonBinary() {
  if (process.env.PYTHON_BIN) {
    return process.env.PYTHON_BIN;
  }
  // Try local .venv python binary
  const localVenvPython = path.resolve(PROJECT_ROOT, "local-server/.venv/bin/python");
  if (fs.existsSync(localVenvPython)) {
    return localVenvPython;
  }
  // Fallback to standard system python3
  return "python3";
}
/**
 * Generates the OS-specific command for service management.
 * @param {'start'|'stop'|'restart'} action - The service action to perform.
 * @param {string} serviceName - The name of the service (e.g., 'com.elara.middleware').
 * @returns {string} The shell command to execute.
 */
export function getServiceCommand(action, serviceName) {
  if (OS.IS_MAC) {
    const plistPath = `~/Library/LaunchAgents/${serviceName}.plist`;
    switch (action) {
      case 'start': return `launchctl bootstrap gui/$(id -u) ${plistPath}`;
      case 'stop': return `launchctl bootout gui/$(id -u) ${serviceName}`;
      case 'restart': return `launchctl bootout gui/$(id -u) ${serviceName} && launchctl bootstrap gui/$(id -u) ${plistPath}`;
      default: return '';
    }
  } else {
    // Linux/systemd implementation
    switch (action) {
      case 'start': return `systemctl start ${serviceName}`;
      case 'stop': return `systemctl stop ${serviceName}`;
      case 'restart': return `systemctl restart ${serviceName}`;
      default: return '';
    }
  }
}

export { PLATFORM };

