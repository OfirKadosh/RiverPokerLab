import { useEffect, useState } from "react";
import type { PreflopCatalog, PreflopChart, PreflopPreset } from "@river-poker-lab/core";
import { apiClient } from "../lib/api";
import { LoadingIndicator } from "./LoadingIndicator";
import { PushFoldSolutionView } from "./PushFoldSolutionView";

export function PreflopChartsPanel() {
  const [mode, setMode] = useState<PreflopPreset["mode"]>("cash");
  const [catalog, setCatalog] = useState<PreflopCatalog>();
  const [presetId, setPresetId] = useState("");
  const [chart, setChart] = useState<PreflopChart>();
  const [catalogError, setCatalogError] = useState("");
  const [chartError, setChartError] = useState("");
  const [retry, setRetry] = useState(0);
  const presets = catalog?.presets.filter((preset) => preset.mode === mode) ?? [];
  const selected = presets.find(({ id }) => id === presetId) ?? presets[0];
  const selectedId = selected?.id;
  const visibleChart = chart?.id === selectedId ? chart : undefined;

  useEffect(() => {
    const controller = new AbortController();
    setCatalogError("");
    apiClient.listPreflopCharts({ signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setCatalog(data);
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setCatalogError(error.message);
    });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    setChartError("");
    apiClient.getPreflopChart(selectedId, { signal: controller.signal }).then(({ chart: data }) => {
      if (!controller.signal.aborted) setChart(data);
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setChartError(error.message);
    });
    return () => controller.abort();
  }, [selectedId, retry]);

  return (
    <section className="sidebar-section push-fold-panel" aria-label="Preflop chart library">
      <p className="field-help">Hold’em short-stack presets. Open shove or fold, then call or fold. Each chart uses the exact stacks and blinds below.</p>
      <div className="river-settings">
        <label className="field-label">Game mode
          <select value={mode} onChange={(event) => {
            setMode(event.target.value === "tournament" ? "tournament" : "cash");
            setPresetId("");
            setChartError("");
          }}>
            <option value="cash">Cash · Chip EV</option>
            <option value="tournament">Tournament · ICM prize EV</option>
          </select>
        </label>
        {selected && <label className="field-label">Preflop spot
          <select value={selected.id} onChange={(event) => {
            setPresetId(event.target.value);
            setChartError("");
          }}>
            {presets.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>}
      </div>
      {(catalogError || chartError) ? (
        <div>
          <p role="alert" className="validation-note">{catalogError || chartError}</p>
          <button type="button" className="secondary-button" onClick={() => setRetry((count) => count + 1)}>Retry</button>
        </div>
      ) : !visibleChart ? <LoadingIndicator label="Loading precomputed ranges…" /> : (
        <>
          <div className="inline-note">
            <strong>{visibleChart.label} · {visibleChart.mode === "cash" ? "Chip EV" : "ICM prize EV"}</strong>
            <p>Blinds {visibleChart.config.smallBlind}/{visibleChart.config.bigBlind} · Ante per player {visibleChart.config.ante}</p>
            <p>{visibleChart.seats.map(({ seat, name, position }) =>
              `${name} (${position}) ${visibleChart.config.players[seat].stack / visibleChart.config.bigBlind} BB`
            ).join(" · ")}</p>
            {visibleChart.config.payouts && <p>Remaining prizes {visibleChart.config.payouts.join(" / ")} · {visibleChart.config.players.length + (visibleChart.config.outsidePlayers?.length ?? 0)} players left</p>}
            <p className="field-help">Precomputed Monte Carlo strategy · {visibleChart.rounds} training rounds · {visibleChart.version}. Reduced game with no limps, small raises, rake or bounties.</p>
          </div>
          <PushFoldSolutionView key={visibleChart.id} solution={visibleChart} unit={visibleChart.mode === "cash" ? "chips" : "prize units"} />
        </>
      )}
    </section>
  );
}
