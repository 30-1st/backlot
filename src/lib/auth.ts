import { useEffect, useState } from 'react';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { clearMediaCache } from './media';
import { supabase } from './supabase';

// Backlot logins are a username and a password, nothing else. There is no email.
// Backlot is private: a new login needs a one-time invite code from the team, and a
// forgotten password is reset by a teammate (team function, password_reset).
//
// Supabase Auth needs an address for every user, so each username maps to an
// internal one on a domain that can never receive mail. The sign-up function
// on the server uses the same rule; nobody ever sees these addresses.

const LOGIN_DOMAIN = 'login.backlot.invalid';
export const USERNAME_RULE = /^[a-z0-9._]{3,24}$/;
export const MIN_PASSWORD = 8;

const addressFor = (username: string) => `${username}@${LOGIN_DOMAIN}`;

export function cleanUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, '');
}

export type LoginProblem =
  | 'invite_invalid'
  | 'username_format'
  | 'username_taken'
  | 'password_length'
  | 'password_weak'
  | 'wrong'
  | 'too_many'
  | 'network'
  | 'server';

export const PROBLEM_TEXT: Record<LoginProblem, string> = {
  invite_invalid: 'That invite code is not valid. It may be mistyped, used already or older than 7 days. Ask your team for a new one.',
  username_format: 'Use 3 to 24 lowercase letters, numbers, dots or underscores for the username.',
  username_taken: 'That username is taken. Try another one.',
  password_length: `Use at least ${MIN_PASSWORD} characters for the password.`,
  password_weak: 'That password is too easy to guess. Try a longer one.',
  wrong: 'Wrong username or password.',
  too_many: 'Too many tries from this connection. Wait a while and try again.',
  network: 'Backlot cannot reach the server. Check your connection and try again.',
  server: 'Something went wrong on our side. Try again in a moment.',
};

/** Sign in. Resolves to null on success, or to what went wrong. */
export async function signIn(username: string, password: string): Promise<LoginProblem | null> {
  if (!supabase) return 'server';
  const { error } = await supabase.auth.signInWithPassword({ email: addressFor(username), password });
  if (!error) return null;
  if (error.code === 'invalid_credentials') return 'wrong';
  if (error.status === 429) return 'too_many';
  if (error.name === 'AuthRetryableFetchError' || error.status === 0 || error.status === undefined) return 'network';
  return 'server';
}

/** Create a login with an invite code, then sign straight in with it. */
export async function createLogin(code: string, username: string, password: string): Promise<LoginProblem | null> {
  if (!supabase) return 'server';
  const { error } = await supabase.functions.invoke('signup', { body: { code, username, password } });
  if (error) {
    if (error instanceof FunctionsFetchError) return 'network';
    if (error instanceof FunctionsHttpError) {
      try {
        const body = (await error.context.json()) as { error?: string };
        if (body.error && body.error in PROBLEM_TEXT) return body.error as LoginProblem;
      } catch {
        // Fall through to the general message.
      }
    }
    return 'server';
  }
  return signIn(username, password);
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
  await clearMediaCache();
}

export type Login =
  | { status: 'offline' } // this build has no sign-in
  | { status: 'loading' }
  | { status: 'out' }
  | { status: 'in'; userId: string; username: string };

/** Who is signed in, kept up to date as they sign in and out. */
export function useLogin(): Login {
  const [login, setLogin] = useState<Login>(supabase ? { status: 'loading' } : { status: 'offline' });

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let stamped = '';

    const apply = (user: { id: string; app_metadata?: Record<string, unknown> } | null | undefined) => {
      if (!user) return setLogin({ status: 'out' });
      const name = typeof user.app_metadata?.username === 'string' ? user.app_metadata.username : '';
      setLogin({ status: 'in', userId: user.id, username: name });
      // Opening Backlot counts as activity. Logins idle for 60 days are removed.
      if (stamped !== user.id) {
        stamped = user.id;
        void client
          .from('members')
          .update({ last_active_at: new Date().toISOString() })
          .eq('id', user.id)
          .then(() => undefined);
      }
    };

    void client.auth.getSession().then(({ data }) => apply(data.session?.user));
    const { data } = client.auth.onAuthStateChange((_event, session) => apply(session?.user));
    return () => data.subscription.unsubscribe();
  }, []);

  return login;
}
