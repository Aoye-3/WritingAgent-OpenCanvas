import { useState } from "react";
import type { AppView } from "../../app/App";

export function useAppNavigation(initialView: AppView = "start") {
  const [view, setView] = useState<AppView>(initialView);
  return { view, setView };
}
