import { useEffect, useId, useRef } from "react";
import "./PracticeAchievements.css";

const badges = [
  { label: "10 answers", position: "0%", requirement: "Answer 10 practice spots." },
  { label: "5 correct in a row", position: "50%", requirement: "Get five decisions right in a row." },
  { label: "3 practice days in a row", position: "100%", requirement: "Practice on three consecutive days." },
];

function BadgeArt({ position }: { position: string }) {
  return <span className="practice-badge-art" aria-hidden="true" style={{ backgroundPositionX: position }} />;
}

export function PracticeAchievements({ earned }: { earned: string[] }) {
  return (
    <ul className="practice-badges">
      {badges.map(({ label, position, requirement }) => {
        const unlocked = earned.includes(label);
        return (
          <li key={label} className={unlocked ? "practice-badge earned" : "practice-badge"}>
            <BadgeArt position={position} />
            <div>
              <strong>{label}</strong>
              <p className="field-help">{unlocked ? "Unlocked" : requirement}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function AchievementCelebration({ milestones, onDismiss }: { milestones: string[]; onDismiss: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const modal = dialog.current;
    if (!modal) return;
    const previousFocus = document.activeElement;
    modal.showModal();
    return () => {
      modal.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);
  return (
    <dialog className="achievement-celebration" aria-labelledby={title} ref={dialog}
      onCancel={(event) => { event.preventDefault(); onDismiss(); }}>
      <div className="achievement-confetti" aria-hidden="true">
        {Array.from({ length: 16 }, (_, index) => (
          <span key={index} style={{ left: `${index * 6 + 4}%`, animationDelay: `${(index % 4) * 60}ms` }} />
        ))}
      </div>
      <h2 id={title}>{milestones.length === 1 ? "Achievement unlocked!" : "Achievements unlocked!"}</h2>
      <ul>
        {milestones.map((label) => {
          const badge = badges.find((item) => item.label === label);
          return (
            <li key={label}>
              {badge && <BadgeArt position={badge.position} />}
              <strong>{label}</strong>
            </li>
          );
        })}
      </ul>
      <button type="button" className="primary-button" onClick={onDismiss}>Continue</button>
    </dialog>
  );
}
