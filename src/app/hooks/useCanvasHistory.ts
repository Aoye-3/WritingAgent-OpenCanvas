import { useRef, useState } from "react";
import {
  pushCanvasHistoryEntry,
  type CanvasHistoryEntry
} from "../../../shared/canvasHistory";

export function useCanvasHistory(undoDepth: number) {
  const [history, setHistory] = useState<CanvasHistoryEntry[]>([]);
  const historyRef = useRef<CanvasHistoryEntry[]>([]);

  const syncHistory = (entries: CanvasHistoryEntry[]) => {
    historyRef.current = entries;
    setHistory(entries);
  };

  const clearHistory = () => syncHistory([]);

  const pushHistory = (entry: CanvasHistoryEntry) => {
    syncHistory(pushCanvasHistoryEntry(historyRef.current, entry, undoDepth));
  };

  const popHistory = () => {
    const [entry, ...remaining] = historyRef.current;
    syncHistory(remaining);
    return entry;
  };

  return {
    canUndo: history.length > 0,
    clearHistory,
    popHistory,
    pushHistory
  };
}
