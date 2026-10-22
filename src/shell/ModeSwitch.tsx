import { Moon, Sun } from './icons';
import { useTheme } from './theme';

/** One tap between Light and Night. "Match phone" lives in Account. */
export function ModeSwitch() {
  const { theme, setChoice } = useTheme();
  const night = theme === 'night';
  return (
    <button
      type="button"
      className="bl-ghost bl-round bl-mode"
      aria-label={night ? 'Switch to light mode' : 'Switch to night mode'}
      title={night ? 'Light mode' : 'Night mode'}
      onClick={() => setChoice(night ? 'light' : 'night')}
    >
      {night ? <Sun /> : <Moon />}
    </button>
  );
}
