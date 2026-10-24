import { useEffect, useState } from 'react';

// Short exchanges between Backlot's three agents, shown while something real is
// happening: the app opening, Rein checking trends, Bil writing, Kris drafting.
//
// Rules every line follows:
//   * It is true. A line only says what is actually going on at that moment.
//   * It never jokes about clients, their fans, or anyone outside the team.
//   * It never appears next to an error, a price decision, money trouble, or a crisis.
//   * It never appears on room pages. Visitors never see the agents.
//   * Written ahead of time and reviewed, so it costs nothing and adds no wait.
//
// The voices:
//   Bil   strategist. Dry, exact, allergic to guessing. Respects Rein, will not say so.
//   Rein  trends. Fast, restless, very online. Brings energy, gets told to bring sources.
//   Kris  publicist. Warm, polished, a little sly. Keeps the other two presentable.

export type Agent = 'bil' | 'rein' | 'kris';
export type Turn = [Agent, string];
export type Moment = 'open' | 'wait' | 'rein' | 'bil' | 'ask' | 'kris' | 'clear' | 'out';

export const AGENT_NAMES: Record<Agent, string> = { bil: 'Bil', rein: 'Rein', kris: 'Kris' };

export const LINES: Record<Moment, Turn[][]> = {
  // The app is opening.
  open: [
    [['bil', 'Lights on. Numbers first.'], ['rein', 'Vibes first, then numbers.'], ['kris', 'Inside voices, both of you.']],
    [['kris', 'Unlocking the backlot.'], ['bil', 'Counting the chairs.']],
    [['rein', 'You are back. Love that for us.'], ['bil', 'Rein. Professional.']],
    [['bil', 'Getting your workspace ready.'], ['kris', 'He means welcome back.']],
    [['kris', 'Setting the stage.'], ['rein', 'I brought snacks.'], ['bil', 'Those are props, Rein.']],
    [['kris', 'One second, fixing my hair.'], ['bil', 'You do not have hair.'], ['kris', 'Rude. Noted.']],
    [['rein', 'Is today a good day to post?'], ['bil', 'Ask me once I have seen the data.']],
    [['bil', 'I read the room before I walk in.'], ['kris', 'He also read the manual. Twice.']],
    [['kris', 'Doors open in a moment.'], ['rein', 'I am already inside.']],
    [['bil', 'Opening up.'], ['rein', 'Opening up emotionally?'], ['bil', 'The app, Rein.']],
    [['kris', 'Polishing the lobby.'], ['bil', 'There is no lobby.'], ['kris', 'Not with that attitude.']],
    [['rein', 'Booting up.'], ['kris', 'Say warming up. It sounds nicer.']],
  ],
  // Something the person asked for is taking a while.
  wait: [
    [['bil', 'Still working. I would rather be right than fast.']],
    [['kris', 'Nearly there. Thank you for waiting.']],
    [['rein', 'It is loading.'], ['bil', 'Thank you, Rein.']],
    [['bil', 'This one takes a moment.'], ['rein', 'The internet is like that.']],
    [['kris', 'Good things, short wait.']],
    [['bil', 'Checking twice, so you do not have to.']],
    [['rein', 'Hold on, it is coming.'], ['kris', 'Patience looks good on you.']],
    [['bil', 'Almost done. Do not tell Rein I rushed.']],
  ],
  // Rein is checking trends.
  rein: [
    [['rein', 'Scrolling so you do not have to.'], ['bil', 'Bring me sources, not screenshots.']],
    [['rein', 'Reading the timeline.'], ['kris', 'Skip the comment sections.'], ['rein', 'No promises.']],
    [['rein', 'Checking what is rising in this niche.'], ['bil', 'Rising and relevant, Rein. Both.']],
    [['rein', 'Topics only, never people.'], ['kris', 'That is on the label for a reason.']],
    [['bil', 'Rein is searching. I am judging quietly.']],
    [['rein', 'The timeline moves fast today.'], ['bil', 'It always does. Write down what matters.']],
    [['rein', 'Found a few. Sorting the real ones from the noise.']],
    [['kris', 'Rein is out there so you can stay in here.']],
  ],
  // Bil is writing a campaign.
  bil: [
    [['bil', 'Writing the posts.'], ['rein', 'Make them go viral.'], ['bil', 'I will make them work. Viral is a side effect.']],
    [['bil', 'Every post gets checked against the goal.']],
    [['kris', 'Bil is writing. Do not make eye contact.']],
    [['bil', 'No guesses. Only reasons.'], ['rein', 'Boring.'], ['bil', 'Effective.']],
    [['kris', 'Each draft waits for your yes before it goes anywhere.'], ['bil', 'Every time.']],
    [['rein', 'Can I add a trend?'], ['bil', 'If it fits the voice. Most do not.']],
    [['bil', 'Writing in their voice, not mine.'], ['kris', 'Thank goodness.']],
    [['bil', 'Spreadsheet brain, fully on.']],
  ],
  // Bil is answering a question in the agent bar.
  ask: [
    [['bil', 'Thinking it over.']],
    [['bil', 'One second. I do not do sloppy answers.']],
    [['rein', 'He is thinking. You can tell by the silence.']],
    [['kris', 'He types like it is a legal document.']],
    [['bil', 'Checking what I know before I say it.']],
  ],
  // Kris is drafting a reply in her chat.
  kris: [
    [['kris', 'Choosing my words.']],
    [['kris', 'Polishing. Tone matters.'], ['bil', 'So does length.'], ['kris', 'Hush.']],
    [['rein', 'Kris is drafting. She is dangerous with a thesaurus.']],
    [['kris', 'Making it sound like you, not like me.']],
    [['kris', 'Thinking how this reads to a stranger.'], ['bil', 'Good instinct.']],
  ],
  // Nothing is waiting on the person.
  clear: [
    [['kris', 'Nothing is waiting on you. Enjoy it.'], ['bil', 'Briefly.']],
    [['rein', 'All clear. Suspiciously clear.'], ['bil', 'That is called being organized.']],
    [['bil', 'Inbox zero. I would frame it.']],
    [['kris', 'Quiet days are good days.'], ['rein', 'Speak for yourself.']],
  ],
  // An outside link is opening in a new tab.
  out: [
    [['kris', 'Opening that in a new tab. This one stays right here.']],
    [['rein', 'Off you go. Come back with news.'], ['bil', 'Facts, Rein. Come back with facts.']],
    [['bil', 'New tab. This one stays open.']],
    [['kris', 'See you in a moment.']],
  ],
};

// ---------- the off switch, per device ----------

const OFF_KEY = 'backlot.banter';
const listeners = new Set<(on: boolean) => void>();

export function banterOn(): boolean {
  try {
    return window.localStorage.getItem(OFF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setBanterOn(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(OFF_KEY);
    else window.localStorage.setItem(OFF_KEY, 'off');
  } catch {
    // Private windows can refuse storage. The switch still holds for this visit.
  }
  memoryOn = on;
  listeners.forEach((f) => f(on));
}

let memoryOn: boolean | null = null;

export function useBanterOn(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => memoryOn ?? banterOn());
  useEffect(() => {
    listeners.add(setOn);
    return () => {
      listeners.delete(setOn);
    };
  }, []);
  return [on, setBanterOn];
}

// ---------- picking a line without repeats ----------

const SEEN_KEY = 'backlot.banter.seen';

function seen(): Record<string, number[]> {
  try {
    return JSON.parse(window.sessionStorage.getItem(SEEN_KEY) || '{}') as Record<string, number[]>;
  } catch {
    return memorySeen;
  }
}
let memorySeen: Record<string, number[]> = {};

/** A line for this moment that has not been shown yet this visit, if any are left. */
export function pickLine(moment: Moment): Turn[] {
  const all = LINES[moment];
  const record = seen();
  let used = (record[moment] ?? []).filter((i) => i < all.length);
  if (used.length >= all.length) used = used.slice(-1); // Start over, but never the same one twice in a row.
  const left = all.map((_, i) => i).filter((i) => !used.includes(i));
  const pick = left[Math.floor(Math.random() * left.length)] ?? 0;
  const next = { ...record, [moment]: [...used, pick] };
  memorySeen = next;
  try {
    window.sessionStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    // Fine: repeats are only a little less likely without storage.
  }
  return all[pick];
}

// ---------- one exchange at a time ----------

// Specific banter (Rein checking, Bil writing) outranks the general "still waiting" line,
// so the two never show at once.
let mounted = 0;
const mountListeners = new Set<(n: number) => void>();

export function banterMounted(delta: 1 | -1): void {
  mounted += delta;
  mountListeners.forEach((f) => f(mounted));
}

export function useBanterMounted(): number {
  const [n, setN] = useState(mounted);
  useEffect(() => {
    mountListeners.add(setN);
    return () => {
      mountListeners.delete(setN);
    };
  }, []);
  return n;
}
