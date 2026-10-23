import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { MediaItem } from '../types';
import { isMediaFile, useMediaUrl } from '../lib/media';
import { PLATFORM, type Platform } from '../platforms';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ---------- Brand ---------- */

/** A stage flat held up by its brace: the front of a building with nothing behind it. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M17 8.5 25 23.5H17" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" opacity=".7" />
      <rect x="3.5" y="4.5" width="13.5" height="19" stroke="currentColor" strokeWidth="1.8" />
      <rect x="7.6" y="9" width="5.3" height="6.2" fill="currentColor" />
    </svg>
  );
}

/** The mark of a platform Backlot can stage, drawn in whatever colour the text around it has. */
export function PlatformMark({ platform, size = 24 }: { platform: Platform; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={PLATFORM[platform].glyph} />
    </svg>
  );
}

/* ---------- Icons ---------- */

const paths = {
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  left: 'M15 5l-7 7 7 7',
  send: 'M21 3 10.500 13.500M21 3l-6.500 18-4-7.500L3 9.500 21 3Z',
  bookmark: 'M6 4h12v17l-6-4.500L6 21V4Z',
  panel: 'M4 5h16v14H4zM14.500 5v14',
  chat: 'M4 5h16v11H9l-5 4V5Z',
  share: 'M12 15V4M8 8l4-4 4 4M5 12v7h14v-7',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z',
  down: 'M5 9l7 7 7-7',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1ZM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  people: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.500 10a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7ZM21 19v-1a4 4 0 0 0-3-3.870M15.500 3.130a3.500 3.500 0 0 1 0 6.740',
  right: 'M9 5l7 7-7 7',
  pin: 'M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6ZM12 14v7',
  layers: 'M8 8V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3M5 8h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z',
  play: 'M8 5.5v13l11-6.5-11-6.5Z',
  grid: 'M4 4h16v16H4zM4 9.33h16M4 14.67h16M9.33 4v16M14.67 4v16',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.600-7 10-7 10Z',
  comment: 'M20 11.5a8 8 0 0 1-11.800 7L4 20l1.500-4.200A8 8 0 1 1 20 11.500Z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  eye: 'M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12ZM12 14.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5Z',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  flag: 'M5 21V4M5 4h12l-2.500 4L17 12H5',
  undo: 'M8 5 3 10l5 5M3 10h11a6 6 0 0 1 0 12h-3',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.500 9.500h.01',
  link: 'M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4ZM13.500 6.500l4 4',
  more: 'M5 12a1 1 0 1 0 2 0 1 1 0 0 0-2 0ZM11 12a1 1 0 1 0 2 0 1 1 0 0 0-2 0ZM17 12a1 1 0 1 0 2 0 1 1 0 0 0-2 0Z',
  repost: 'M7 7h10l-3-3M17 17H7l3 3M17 7v5M7 17v-5',
  views: 'M5 20v-6M10 20V9M15 20v-9M20 20V5',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16, fill = false }: { name: IconName; size?: number; fill?: boolean }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

/* ---------- Media ---------- */

export function MediaView({
  item,
  className,
  controls = false,
}: {
  item: MediaItem | undefined;
  className?: string;
  controls?: boolean;
}) {
  const url = useMediaUrl(item);
  if (!item || !url) {
    return (
      <div className={cx('media-empty', className)}>
        <Icon name="image" size={22} />
      </div>
    );
  }
  if (item.kind === 'video') {
    return (
      <video
        className={className}
        src={controls ? url : `${url}#t=0.1`}
        muted={!controls}
        playsInline
        preload="metadata"
        controls={controls}
      />
    );
  }
  return <img className={className} src={url} alt="" draggable={false} />;
}

/* ---------- Form pieces ---------- */

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** A whole number, zero or more. An empty box is allowed while typing and when `emptyValue` is given. */
export function NumberInput({
  id,
  value,
  onChange,
  placeholder,
  allowEmpty = false,
}: {
  id: string;
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  allowEmpty?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const last = useRef(value);

  // Follow outside changes (revert, another post selected) without fighting the keyboard.
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value === null ? '' : String(value));
    }
  }, [value]);

  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        const digits = e.target.value.replace(/[^\d]/g, '').slice(0, 12);
        setText(digits);
        const next = digits === '' ? (allowEmpty ? null : 0) : Number(digits);
        last.current = next;
        onChange(next);
      }}
      onBlur={() => setText(value === null ? '' : String(value))}
    />
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  block = false,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; dot?: string }>;
  onChange: (value: T) => void;
  block?: boolean;
}) {
  return (
    <div className={cx('seg', block && 'seg-block')} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.dot && <i className="dot" style={{ background: o.dot }} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A button that asks once more before doing something that cannot be taken back. */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className,
  icon,
  ariaLabel,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
  icon?: IconName;
  /** Needed when the button shows only an icon. */
  ariaLabel?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      type="button"
      className={cx('btn', className, armed && 'armed')}
      aria-label={armed ? undefined : ariaLabel}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
      onBlur={() => setArmed(false)}
    >
      {icon && <Icon name={icon} />}
      {armed ? confirmLabel : label}
    </button>
  );
}

/** A button that opens the file picker for photos and videos. */
export function FileButton({
  label,
  onFiles,
  multiple = false,
  className = 'btn',
  icon,
  imagesOnly = false,
}: {
  label: string;
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  className?: string;
  icon?: IconName;
  imagesOnly?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => input.current?.click()}>
        {icon && <Icon name={icon} />}
        {label}
      </button>
      <input
        ref={input}
        id={id}
        type="file"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        accept={imagesOnly ? 'image/*' : 'image/*,video/*'}
        multiple={multiple}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []).filter(isMediaFile);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}

/** True while the screen matches a CSS media query, for example a phone-sized width. */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let list: MediaQueryList;
    try {
      list = window.matchMedia(query);
    } catch {
      return;
    }
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

// Open overlays, newest last. On a phone the Back button (or swipe) should
// close the top overlay instead of leaving the screen behind it, so every
// overlay adds one step to the browser history and removes it when it closes.
const overlays: string[] = [];
let ownBackSteps = 0;

function useBackToClose(onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const id = `${Date.now()}-${Math.random()}`;
    overlays.push(id);
    try {
      window.history.pushState({ ...(window.history.state ?? {}), backlotOverlay: id }, '');
    } catch {
      // Some embedded views lock the history. Overlays still close with their own buttons.
    }

    const onPop = () => {
      if (ownBackSteps > 0) {
        ownBackSteps -= 1; // our own tidy-up step, not the person pressing Back
        return;
      }
      if (overlays[overlays.length - 1] !== id) return;
      overlays.pop();
      close.current();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      const at = overlays.indexOf(id);
      if (at < 0) return; // already closed by the Back button
      overlays.splice(at, 1);
      try {
        if (window.history.state?.backlotOverlay === id) {
          ownBackSteps += 1;
          window.history.back();
        }
      } catch {
        // Nothing to tidy.
      }
    };
  }, []);
}

/** A native modal dialog that opens when mounted and reports when it is dismissed. */
export function Modal({
  label,
  className,
  onClose,
  children,
}: {
  label: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useBackToClose(onClose);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
