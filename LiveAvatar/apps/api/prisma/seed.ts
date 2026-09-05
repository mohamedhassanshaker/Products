/**
 * Idempotent `ProviderDefinition` catalog seed (spec FR-PROVIDER-1, LLD §2).
 *
 * Run via `pnpm --filter @liveavatar/api prisma:seed` (dev) or as a deploy-time
 * step after `prisma migrate deploy` (nexus-deploy wires the latter). Safe to
 * run any number of times: every row is an `upsert` keyed on the catalog's
 * natural key (`key`), so a repeat run neither duplicates rows nor clobbers an
 * operator's `enabled` toggle (FR-PROVIDER-1) — only the catalog's descriptive
 * fields are reasserted, `enabled` is only set on first insert.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/** One v1 built-in catalog row (spec FR-PROVIDER-1 table). */
interface CatalogRow {
  key: string;
  category: 'transport' | 'stt' | 'llm' | 'tts' | 'avatar';
  displayName: string;
  hosting: 'self_hosted' | 'remote';
  interfaceName: string;
  requiresCredential: boolean;
  featureGaps?: string;
}

/**
 * The v1 catalog. Includes `alibaba-liveavatar` (Example B) alongside the
 * other spec-named providers — nothing here is invented scope, every row
 * matches the spec table exactly.
 */
export const PROVIDER_CATALOG: CatalogRow[] = [
  {
    key: 'livekit',
    category: 'transport',
    displayName: 'LiveKit',
    hosting: 'self_hosted',
    interfaceName: 'ITransportProvider',
    requiresCredential: true,
  },
  {
    key: 'deepgram',
    category: 'stt',
    displayName: 'Deepgram',
    hosting: 'self_hosted',
    interfaceName: 'ISTTProvider',
    requiresCredential: true,
  },
  {
    key: 'faster-whisper',
    category: 'stt',
    displayName: 'faster-whisper',
    hosting: 'self_hosted',
    interfaceName: 'ISTTProvider',
    requiresCredential: false,
  },
  {
    key: 'openai',
    category: 'llm',
    displayName: 'OpenAI',
    hosting: 'remote',
    interfaceName: 'ILLMProvider',
    requiresCredential: true,
  },
  {
    key: 'anthropic',
    category: 'llm',
    displayName: 'Anthropic',
    hosting: 'remote',
    interfaceName: 'ILLMProvider',
    requiresCredential: true,
  },
  {
    key: 'google',
    category: 'llm',
    displayName: 'Google',
    hosting: 'remote',
    interfaceName: 'ILLMProvider',
    requiresCredential: true,
  },
  {
    key: 'fish-speech',
    category: 'tts',
    displayName: 'Fish Speech',
    hosting: 'self_hosted',
    interfaceName: 'ITTSProvider',
    requiresCredential: true,
  },
  {
    key: 'elevenlabs',
    category: 'tts',
    displayName: 'ElevenLabs',
    hosting: 'remote',
    interfaceName: 'ITTSProvider',
    requiresCredential: true,
  },
  {
    key: 'bithuman',
    category: 'avatar',
    displayName: 'bitHuman',
    hosting: 'self_hosted',
    interfaceName: 'IAvatarProvider',
    requiresCredential: true,
  },
  {
    key: 'alibaba-liveavatar',
    category: 'avatar',
    displayName: 'Alibaba LiveAvatar',
    hosting: 'remote',
    interfaceName: 'IAvatarProvider',
    requiresCredential: true,
    // Verbatim spec copy (FR-AVATAR-2) — Agent Builder must surface this
    // exact sentence, not a paraphrase, so an operator publishing Example B
    // sees the documented capability gap before going live. Lip-sync and
    // LiveKit publish are NOT part of this gap (FR-AVATAR-2 calls those a
    // blocker, not an accepted gap) — both are fully implemented by
    // `AlibabaLiveAvatarAdapter` (BL-019).
    featureGaps:
      'LiveAvatar: idle motion and custom upload may differ from bitHuman. Lip-sync and LiveKit publish are required.',
  },
];

/**
 * Upserts every catalog row. Descriptive fields are always reasserted from
 * the source of truth above; `enabled` is only set to `true` on first
 * insert so a re-run never re-enables a provider an operator disabled.
 * @param prisma - Connected Prisma client
 */
export async function seedProviderCatalog(prisma: PrismaClient): Promise<void> {
  for (const row of PROVIDER_CATALOG) {
    await prisma.providerDefinition.upsert({
      where: { key: row.key },
      update: {
        category: row.category,
        displayName: row.displayName,
        hosting: row.hosting,
        interfaceName: row.interfaceName,
        requiresCredential: row.requiresCredential,
        featureGaps: row.featureGaps ?? null,
      },
      create: {
        key: row.key,
        category: row.category,
        displayName: row.displayName,
        hosting: row.hosting,
        interfaceName: row.interfaceName,
        requiresCredential: row.requiresCredential,
        featureGaps: row.featureGaps ?? null,
        enabled: true,
      },
    });
  }
}

/** CLI entrypoint — only runs the connect/seed/disconnect cycle when executed directly. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await seedProviderCatalog(prisma);
    console.log(`Seeded ${PROVIDER_CATALOG.length} provider definitions.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
