import { useEffect, useState } from "react";
import { fetchAgentCards } from "../agentClient";
import type { AgentCard } from "../types";

export function useAgentCards(fallbackAgentCards: AgentCard[]) {
  const [agentCards, setAgentCards] = useState<AgentCard[]>(fallbackAgentCards);

  useEffect(() => {
    let mounted = true;
    fetchAgentCards()
      .then((cards) => {
        if (!mounted || cards.length === 0) return;
        setAgentCards(cards);
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  const updateAgentCard = (agentCard: AgentCard) => {
    setAgentCards((cards) => cards.map((card) => card.id === agentCard.id ? agentCard : card));
  };

  return { agentCards, updateAgentCard };
}
