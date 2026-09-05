import type { Prisma } from '../../generated/prisma/client';

/**
 * Re-exports Prisma's JSON input type so modules outside `common/prisma`
 * never need to import the generated client directly (LLD §3.4's
 * Prisma-import restriction) just to type a `Json` column write.
 */
export type PrismaJsonInput = Prisma.InputJsonValue;
