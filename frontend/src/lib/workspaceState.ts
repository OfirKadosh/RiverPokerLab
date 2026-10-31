import type { Dispatch, SetStateAction } from "react";
export type IcmPlayer = { id: number; name: string; stack: string };
export interface IcmResult {
  totalChips: number;
  totalPrize: number;
  payouts: number[];
  results: {
    playerIndex: number;
    name: string;
    stack: number;
    chipShare: number;
    prizeEquity: number;
    prizeShare: number;
    proportionalPrize: number;
    differenceFromProportional: number;
    finishProbabilities: number[];
  }[];
}
export interface IcmWorkspaceState {
  players: IcmPlayer[];
  payoutText: string;
  confirmed: boolean;
  response: { key: string; data: IcmResult } | null;
}
export function createIcmExample(): IcmPlayer[] {
  return [5000, 3000, 2000].map((stack, id) => ({
    id,
    name: `Player ${id + 1}`,
    stack: String(stack),
  }));
}
export function createIcmWorkspace(): IcmWorkspaceState {
  return {
    players: createIcmExample(),
    payoutText: "50, 30, 20",
    confirmed: false,
    response: null,
  };
}
export interface TournamentDraft {
  payoutText: string;
  others: { name: string; stack: string }[];
  confirmed: boolean;
}
export function createTournamentDraft(): TournamentDraft {
  return { payoutText: "", others: [], confirmed: false };
}
export function fieldSetter<T, K extends keyof T>(
  setState: Dispatch<SetStateAction<T>>,
  key: K,
): Dispatch<SetStateAction<T[K]>> {
  return (next) =>
    setState((current) => ({
      ...current,
      [key]:
        typeof next === "function"
          ? (next as (value: T[K]) => T[K])(current[key])
          : next,
    }));
}
