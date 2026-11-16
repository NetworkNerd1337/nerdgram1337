import { useAppearance } from "../hooks/useAppearance";
import { writeAppearance, type Appearance } from "../lib/appearance";

const CHOICES: { id: Appearance; label: string; detail: string }[] = [
  { id: "light", label: "Light", detail: "A light page and a light code pane." },
  { id: "dark", label: "Dark", detail: "A dark page and a dark code pane." },
  {
    id: "system",
    label: "Match system",
    detail: "Follow this computer's light or dark setting. This is the default.",
  },
];

export function AppearanceSettings() {
  const { preference } = useAppearance();

  return (
    <section className="sync-card" id="appearance">
      <h2>Appearance</h2>
      <p>
        Light, dark, or match this computer. The choice is saved in this browser. It does not
        change a diagram's theme. That still comes from the file's front matter.
      </p>
      <fieldset className="appearance-choices">
        <legend className="sr-only">Appearance</legend>
        {CHOICES.map((choice) => (
          <label key={choice.id} className="sync-check">
            <input
              type="radio"
              name="appearance"
              value={choice.id}
              checked={preference === choice.id}
              onChange={() => writeAppearance(choice.id)}
            />
            <span>
              <strong>{choice.label}.</strong> {choice.detail}
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
