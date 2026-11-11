import type { BankrollFilters, BalancePoint, bankrollPeriod } from "../lib/bankroll";
import { allEntries, venueLabels } from "../lib/bankroll";

type Period = NonNullable<ReturnType<typeof bankrollPeriod>>;
type FormatMoney = (value: number) => string;

function BalanceChart({ period, money }: { period: Period; money: FormatMoney }) {
  if (!period.points.length) {
    return <p className="field-help">Record an entry to start the balance history.</p>;
  }

  const { points, firstDate, lastDate, opening, closing } = period;
  const min = Math.min(...points.map(({ balance }) => balance));
  const max = Math.max(...points.map(({ balance }) => balance));
  const middle = min + Math.floor((max - min) / 2);
  const firstDay = points[0].day;
  const lastDay = points[points.length - 1].day;
  const width = 640;
  const height = 160;
  const padding = 5;
  const x = (point: BalancePoint) => (point.day - firstDay) / (lastDay - firstDay) * width;
  const y = (balance: number) => max === min ? height / 2
    : padding + (max - balance) / (max - min) * (height - padding * 2);
  const line = points.slice(1).reduce((path, point) => {
    return `${path} H ${x(point).toFixed(2)} V ${y(point.balance).toFixed(2)}`;
  }, `M 0 ${y(opening).toFixed(2)}`);
  const ticks = [...new Set([max, middle, min])];

  return <figure className="bankroll-chart">
    <figcaption>
      <strong>Balance over time</strong>
      <span>Daily closing balance · All games and transfers</span>
    </figcaption>
    <div className="bankroll-chart-grid">
      <div className="bankroll-chart-scale" aria-hidden="true">
        {ticks.map((value) => (
          <span key={value} style={{ top: `${y(value) / height * 100}%` }}>{money(value)}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img"
        aria-label={`Balance from ${firstDate} through ${lastDate}. Opened at ${money(opening)} and closed at ${money(closing)}. Lowest ${money(min)}, highest ${money(max)}.`}>
        {ticks.map((value) => (
          <line key={value} x1={0} x2={width} y1={y(value)} y2={y(value)} className="bankroll-chart-guide" />
        ))}
        <path d={line} className="bankroll-chart-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="bankroll-chart-dates">
        <time dateTime={firstDate}>{firstDate}</time>
        {lastDate !== firstDate && <time dateTime={lastDate}>{lastDate}</time>}
      </div>
    </div>
    <dl className="bankroll-chart-values">
      <div><dt>Period opening</dt><dd>{money(opening)}</dd></div>
      <div><dt>Period closing</dt><dd>{money(closing)}</dd></div>
    </dl>
  </figure>;
}

export function BankrollDashboard({ filters, onFilters, period, money }: {
  filters: BankrollFilters;
  onFilters: (filters: BankrollFilters) => void;
  period: Period | null;
  money: FormatMoney;
}) {
  return <section className="sidebar-section bankroll-dashboard">
    <div className="section-heading"><h2>Performance</h2></div>
    <div className="bankroll-filters">
      <label className="field-label">From date
        <input type="date" min="1900-01-01" max="2099-12-31"
          value={filters.from} onChange={(event) => onFilters({ ...filters, from: event.target.value })} />
      </label>
      <label className="field-label">Through date
        <input type="date" min="1900-01-01" max="2099-12-31"
          value={filters.to} onChange={(event) => onFilters({ ...filters, to: event.target.value })} />
      </label>
      <label className="field-label">Game type
        <select value={filters.game} onChange={(event) => onFilters({
          ...filters, game: event.target.value as BankrollFilters["game"],
        })}>
          <option value="all">All games</option>
          <option value="cash">Cash</option>
          <option value="tournament">Tournament</option>
        </select>
      </label>
      <label className="field-label">Played
        <select value={filters.venue} onChange={(event) => onFilters({
          ...filters, venue: event.target.value as BankrollFilters["venue"],
        })}>
          <option value="all">All venues</option>
          <option value="online">{venueLabels.online}</option>
          <option value="live">{venueLabels.live}</option>
          <option value="unspecified">{venueLabels.unspecified}</option>
        </select>
      </label>
      <button type="button" className="secondary-button" onClick={() => onFilters(allEntries)}>Reset filters</button>
    </div>
    <p className="field-help">
      Blank dates include all available history on that side. Game type and venue filter poker results and sessions. Transfers and the balance chart include all games.
    </p>
    {!period ? <p className="validation-note" role="alert">Choose dates from 1900 to 2099 and put the start date first.</p> : <>
      <dl className="bankroll-summary bankroll-period-summary" aria-label="Period results">
        <div><dt>Period poker profit</dt><dd className={period.pokerProfit > 0 ? "bankroll-gain" : period.pokerProfit < 0 ? "bankroll-loss" : undefined}>{money(period.pokerProfit)}</dd></div>
        <div><dt>Period net transfers</dt><dd>{money(period.netTransfers)}</dd></div>
        <div><dt>Poker sessions</dt><dd>{period.sessions}</dd></div>
      </dl>
      {filters.venue === "all" && (
        <dl className="bankroll-summary bankroll-period-summary" aria-label="Poker profit by venue">
          {(Object.keys(venueLabels) as (keyof typeof venueLabels)[]).map((venue) => {
            const { profit, sessions } = period.byVenue[venue];
            if (venue === "unspecified" && sessions === 0) return null;
            return <div key={venue}>
              <dt>{venueLabels[venue]} profit · {sessions} {sessions === 1 ? "session" : "sessions"}</dt>
              <dd className={profit > 0 ? "bankroll-gain" : profit < 0 ? "bankroll-loss" : undefined}>{money(profit)}</dd>
            </div>;
          })}
        </dl>
      )}
      <BalanceChart period={period} money={money} />
    </>}
  </section>;
}
