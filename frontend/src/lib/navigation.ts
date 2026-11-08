import { useEffect, useState } from "react";
export const PAGES = [
  {
    id: "spot",
    label: "Spot setup",
    description: "Set the game, players, cards and starting stacks.",
  },
  {
    id: "hand",
    label: "Hand actions",
    description: "Record actions, advance streets and track the pot.",
  },
  {
    id: "ranges",
    label: "Ranges",
    description: "Edit weighted priors and observed-action frequencies.",
  },
  {
    id: "analysis",
    label: "Analysis",
    description: "Explore equity, pot payouts and Fold versus Call.",
  },
  { id: "turn", label: "Turn tree", description: "Solve a bounded heads-up turn-and-river game with every legal runout." },
  { id: "river", label: "River tree", description: "Explore a restricted heads-up river betting tree and conditional payoffs." },
  {
    id: "tournament",
    label: "Tournament",
    description:
      "Configure prizes and the full remaining field for ICM decisions.",
  },
  {
    id: "icm",
    label: "ICM calculator",
    description: "Value tournament stacks independently of a hand.",
  },
  {
    id: "history",
    label: "History",
    description: "Open a saved spot and continue working.",
  },
  { id: "admin", label: "Admin", description: "Review verification requests and manage access." },
  {
    id: "account",
    label: "Account",
    description: "Your identity, verification and current device session.",
  },
] as const;
export type Page = (typeof PAGES)[number]["id"];
function currentPage(): Page {
  const value = window.location.hash.replace(/^#\/?/, "");
  return PAGES.some((page) => page.id === value) ? (value as Page) : "spot";
}
export function usePage() {
  const [page, setPage] = useState<Page>(currentPage);
  useEffect(() => {
    const sync = () => {
      const next = currentPage();
      if (window.location.hash !== `#/${next}`)
        window.history.replaceState(null, "", `#/${next}`);
      setPage(next);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  function navigate(next: Page) {
    window.location.hash = `/${next}`;
  }
  return { page, navigate };
}
