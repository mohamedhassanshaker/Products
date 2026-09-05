import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ProviderCredentialRecord } from '../domain/provider';
import type { ProbeOutcome, ProbeStrategyPort } from '../domain/ports';

/** Probe timeout (FR-PROVIDER-3). */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * One retry after a transient network failure (DNS blip, connection reset)
 * before a vendor is actually reported unreachable — observed live against
 * a real vendor (Deepgram's multi-region CNAME setup intermittently fails
 * to resolve through some resolvers) that a single failed attempt does not
 * mean the vendor is down.
 */
const RETRY_DELAY_MS = 750;

/**
 * Category-generic HTTP health probe (FR-PROVIDER-3). Every v1 catalog entry
 * carries an `endpoint_url`, so a single HEAD-then-GET-fallback strategy
 * covers transport/stt/llm/tts/avatar uniformly for the control plane; a
 * vendor-specific "cheap call" probe (LLD §8.7) is agent-side work from
 * Phase 4 onward and out of scope here — the control plane never holds a
 * vendor SDK or the actual secret needed to authenticate such a call anyway
 * (ADR-001, credential values live behind `credential_ref`).
 */
@Injectable()
export class HttpProbeStrategy implements ProbeStrategyPort {
  /** @param credential - Credential to probe */
  async probe(credential: ProviderCredentialRecord): Promise<ProbeOutcome> {
    // `file://` endpoints (bitHuman's local model directory) never make a
    // network call at all — probing them means checking the directory is
    // actually there, not firing an HTTP request at a URL scheme `fetch`
    // doesn't even support.
    if (credential.endpointUrl.startsWith('file://')) {
      return this.probeFile(credential);
    }
    try {
      const status = await this.headWithTimeout(credential.endpointUrl);
      return this.classify(status, credential);
    } catch {
      // First attempt failed at the network level (DNS/connect/timeout) —
      // one retry before concluding the vendor is actually unreachable.
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      try {
        const status = await this.headWithTimeout(credential.endpointUrl);
        return this.classify(status, credential);
      } catch {
        return {
          status: 'unreachable',
          errorCode: 'PROVIDER_UNREACHABLE',
          message: `Could not reach ${credential.displayLabel} at ${credential.endpointUrl}.`,
        };
      }
    }
  }

  /** @param endpointUrl - URL to HEAD */
  private async headWithTimeout(endpointUrl: string): Promise<number> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(endpointUrl, { method: 'HEAD', signal: controller.signal });
      return response.status;
    } finally {
      clearTimeout(timer);
    }
  }

  /** @param credential - Credential whose `endpoint_url` is a `file://` model directory */
  private probeFile(credential: ProviderCredentialRecord): ProbeOutcome {
    try {
      const path = fileURLToPath(credential.endpointUrl);
      if (existsSync(path)) {
        return { status: 'healthy' };
      }
      return {
        status: 'unreachable',
        errorCode: 'PROVIDER_UNREACHABLE',
        message: `${credential.displayLabel}'s model directory does not exist: ${path}.`,
      };
    } catch {
      return {
        status: 'unreachable',
        errorCode: 'PROVIDER_UNREACHABLE',
        message: `Could not reach ${credential.displayLabel} at ${credential.endpointUrl}.`,
      };
    }
  }

  /**
   * @param status - HTTP status from the probe request
   * @param credential - Credential probed (for the unreachable message)
   */
  private classify(status: number, credential: ProviderCredentialRecord): ProbeOutcome {
    // Any real HTTP response — including 404 on a bare `HEAD /` that has no
    // route — proves the vendor is up and answering; only a genuine 5xx
    // means the vendor itself is unwell, and only a network-level failure
    // (caught in `probe()`, never reaching this method) means unreachable.
    if (status < 500) {
      return { status: 'healthy' };
    }
    return {
      status: 'degraded',
      message: `${credential.displayLabel} responded with ${status}.`,
    };
  }
}
