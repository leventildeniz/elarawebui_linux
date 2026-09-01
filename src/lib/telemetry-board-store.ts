import { useCallback, useEffect, useState, useRef } from "react";
import { fetchApi } from "./api";

/** A telemetry board is a user-composed card that streams any mix of entities. */
export type BoardKind = "agent" | "workflow" | "skill" | "tool";

export type BoardEntry = { kind: BoardKind; id: string };

export type TelemetryBoard = {
  id: string;
  name: string;
  tone: string;
  entries: BoardEntry[];
  createdAt: number;
};

export const boardTones = ["sapphire", "emerald", "amethyst", "topaz", "ruby"] as const;


const ACTIVE_KEY = "sovereign.telemetry.boards.active";
const EVT = "sovereign:telemetry-boards";

function readActive(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(ACTIVE_KEY) ?? "";
}

function writeActive(id: string) {
  try {
    window.localStorage.setItem(ACTIVE_KEY, id);
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {
    /* ignore */
  }
}

export function useTelemetryBoards() {
  const [boards, setBoards] = useState<TelemetryBoard[]>([]);
  const [active, setActiveState] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);
  
  const fetching = useRef(false);

  const loadData = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const data = await fetchApi("/api/telemetry/boards");
      if (Array.isArray(data)) {
        if (data.length === 0) {
          // Seed initial
          const id = "tb.agents";
          const board: TelemetryBoard = {
            id,
            name: "Agents",
            tone: "emerald",
            entries: [],
            createdAt: Date.now(),
          };
          await fetchApi("/api/telemetry/boards", {
            method: "POST",
            body: JSON.stringify(board),
          });
          setBoards([board]);
          writeActive(id);
          setActiveState(id);
        } else {
          setBoards(data);
          const currentActive = readActive();
          if (!currentActive || !data.find(b => b.id === currentActive)) {
             writeActive(data[0].id);
             setActiveState(data[0].id);
          } else {
             setActiveState(currentActive);
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch boards", e);
    } finally {
      fetching.current = false;
      setHydrated(true);
    }
  }, []);

  const setActive = useCallback((id: string) => {
    writeActive(id);
    setActiveState(id);
  }, []);

  useEffect(() => {
    loadData();
    const handleActive = () => setActiveState(readActive());
    window.addEventListener(EVT, handleActive);
    return () => window.removeEventListener(EVT, handleActive);
  }, [loadData]);

  const upsert = useCallback(async (board: TelemetryBoard) => {
     setBoards((prev) => {
       const exists = prev.some((b) => b.id === board.id);
       return exists ? prev.map((b) => (b.id === board.id ? board : b)) : [...prev, board];
     });
     try {
       await fetchApi("/api/telemetry/boards", {
         method: "POST",
         body: JSON.stringify(board),
       });
     } catch (e) {
       loadData();
     }
  }, [loadData]);

  const create = useCallback(async (name: string, tone: string, entries: BoardEntry[] = []) => {
    const id = `tb.${Math.random().toString(36).slice(2, 8)}`;
    const board = {
      id,
      name: name.trim() || "Untitled board",
      tone,
      entries,
      createdAt: Date.now(),
    };
    await upsert(board);
    writeActive(id);
    setActiveState(id);
    return id;
  }, [upsert]);

  const addEntries = useCallback(async (boardId: string, entries: BoardEntry[]) => {
    const board = boards.find(b => b.id === boardId);
    if (!board) return;
    
    const newEntries = entries.filter((e) => !board.entries.some((x) => x.kind === e.kind && x.id === e.id));
    if (newEntries.length === 0) return;

    await upsert({
       ...board,
       entries: [...board.entries, ...newEntries]
    });
  }, [boards, upsert]);

  const update = useCallback(async (id: string, patch: Partial<TelemetryBoard>) => {
    const board = boards.find(b => b.id === id);
    if (!board) return;
    await upsert({ ...board, ...patch });
  }, [boards, upsert]);

  const remove = useCallback(async (id: string) => {
    setBoards((prev) => prev.filter((b) => b.id !== id));
    try {
      await fetchApi(`/api/telemetry/boards/${id}`, { method: "DELETE" });
    } catch (e) {
      loadData();
    }
  }, [loadData]);

  const removeEntry = useCallback(async (boardId: string, entry: BoardEntry) => {
    const board = boards.find(b => b.id === boardId);
    if (!board) return;
    await upsert({
      ...board,
      entries: board.entries.filter((e) => !(e.kind === entry.kind && e.id === entry.id))
    });
  }, [boards, upsert]);

  return { boards, active, setActive, hydrated, create, addEntries, update, remove, removeEntry };
}
