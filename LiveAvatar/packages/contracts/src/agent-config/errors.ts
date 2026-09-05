import type { AppErrorCode } from '../error-codes';

/**
 * JSON-Pointer path → spec error code table (LLD §6.2). `Value.Errors`
 * produces TypeBox's own generic messages; this table is what keeps the
 * client-facing sentence the spec's exact wording instead of TypeBox's.
 * Paths not listed fall back to a generic per-gate code chosen by the caller.
 */
export const AGENT_CONFIG_PATH_CODES: Record<string, AppErrorCode> = {
  '/version': 'CONFIG_VERSION_UNSUPPORTED',
  '/stt/language': 'CONFIG_LANGUAGE_INVALID',
  '/tts/voice_id': 'CONFIG_VOICE_REQUIRED',
  '/avatar/avatar_id': 'CONFIG_AVATAR_ID_REQUIRED',
  '/agent/system_prompt': 'CONFIG_PROMPT_TOO_LARGE',
  '/privacy/retain_transcripts_days': 'CONFIG_RETENTION_INVALID',
  // Phase 9 (BL-035): `reasoning.graph[i].model`/`.retry.*` paths carry an
  // array index (`/reasoning/graph/0/model`), so a fixed-path table entry
  // can't target every node — these fall back to the caller-supplied
  // default (`CONFIG_YAML_PARSE`) instead of a specific code, same as any
  // other unmapped path.
};

/**
 * Resolves the spec error code for a TypeBox validation error's JSON-Pointer
 * path, falling back to `CONFIG_YAML_UNKNOWN_KEY` for an unrecognized root
 * key and to the caller-supplied default otherwise.
 * @param path - TypeBox error `.path` (JSON Pointer, e.g. `/stt/language`)
 * @param fallback - Code to use when the path has no specific mapping
 */
export function codeForConfigPath(path: string, fallback: AppErrorCode): AppErrorCode {
  return AGENT_CONFIG_PATH_CODES[path] ?? fallback;
}
