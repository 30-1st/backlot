// Reads Backlot's function secrets by what they are, not by exact spelling.
//
// The secrets were saved in Supabase under plain names ("xai api key").
// Each entry lists the names Backlot accepts, first match wins, so the code keeps
// working if they are later renamed to the usual CAPITAL_SNAKE form.

const NAMES = {
  xaiApiKey: ['xai api key', 'XAI_API_KEY'],
  xBearerToken: ['bearer token', 'X_BEARER_TOKEN'],
  langfusePublicKey: ['langfuse public key', 'LANGFUSE_PUBLIC_KEY'],
  langfuseSecretKey: ['langfuse secret key', 'LANGFUSE_SECRET_KEY'],
  turnstileSecretKey: ['turnstile secret key', 'TURNSTILE_SECRET_KEY'],
} as const;

export type SecretId = keyof typeof NAMES;

export function secret(id: SecretId): string | undefined {
  for (const name of NAMES[id]) {
    const value = Deno.env.get(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Which secrets are set, by id. Never returns values. */
export function secretsPresent(): Record<SecretId, boolean> {
  return Object.fromEntries((Object.keys(NAMES) as SecretId[]).map((id) => [id, Boolean(secret(id))])) as Record<
    SecretId,
    boolean
  >;
}
