import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "./api";

export type RuntimeStatus = "idle" | "running" | "stopped" | "error";

export type PythonRuntime = {
  id: string;
  name: string;
  version: string;
  pythonPath?: string;
  venvPath?: string;
  memory: number | "auto"; // MB or auto-scale
  packages: string;
  egress: boolean;
  status: RuntimeStatus;
  createdAt: number;
};

const KEY = "sovereign.python.runtimes";

function read(): PythonRuntime[] {
  return [];
}

function write(list: PythonRuntime[]) {
  // No-op: LocalStorage is forbidden.
}

export function newRuntimeId(list: PythonRuntime[]) {
  const n = list.length + 1;
  return `py.sandbox.${String(n).padStart(2, "0")}.${Math.random().toString(36).slice(2, 6)}`;
}

export function useRuntimes() {
  // Start empty to prevent flash of mock data before DB fetch
  const [runtimes, setRuntimes] = useState<PythonRuntime[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const fetchItems = useCallback(async () => {
    try {
      const data = await fetchApi("/api/python/runtimes");
      const rows = (data.items || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        version: row.version,
        pythonPath: row.python_path,
        venvPath: row.venv_path,
        memory: row.memory_auto ? "auto" : row.memory_mb,
        packages: row.packages,
        egress: row.egress,
        status: row.status,
        createdAt: new Date(row.created_at).getTime()
      } as PythonRuntime));

      setRuntimes(rows);
    } catch (err) {
      console.error("Failed to load python runtimes:", err);
      // Fallback to local storage read
      setRuntimes(read());
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const commit = useCallback(async (next: PythonRuntime[]) => {
    // For direct commit override if needed, but normally use create/update/remove
    setRuntimes(next);
    write(next);
  }, []);

  const create = useCallback(
    async (draft: Omit<PythonRuntime, "id" | "createdAt">) => {
      const id = newRuntimeId(runtimes);
      try {
        await fetchApi("/api/python/runtimes", {
          method: "POST",
          body: JSON.stringify({ ...draft, id })
        });
        await fetchItems();
      } catch (err) {
        console.error("Failed to create python runtime:", err);
        throw err;
      }
    },
    [runtimes, fetchItems],
  );

  const update = useCallback(
    async (id: string, patch: Partial<PythonRuntime>) => {
      try {
        await fetchApi(`/api/python/runtimes/${id}`, {
          method: "PUT",
          body: JSON.stringify(patch)
        });
        await fetchItems();
      } catch (err) {
        console.error("Failed to update python runtime:", err);
        throw err;
      }
    },
    [fetchItems],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await fetchApi(`/api/python/runtimes/${id}`, { method: "DELETE" });
        await fetchItems();
      } catch (err) {
        console.error("Failed to delete python runtime:", err);
        throw err;
      }
    },
    [fetchItems],
  );

  return { runtimes, hydrated, create, update, remove, commit };
}
