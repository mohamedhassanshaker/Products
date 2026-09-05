import { Type, type Static } from '@sinclair/typebox';

/** LLD §5.1 error envelope returned on every failed HTTP response. */
export const ErrorEnvelopeSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    details: Type.Record(Type.String(), Type.Unknown()),
  }),
});

/** Parsed error envelope. */
export type ErrorEnvelope = Static<typeof ErrorEnvelopeSchema>;

/** Collection wrapper for list endpoints. */
export const CollectionSchema = <T extends ReturnType<typeof Type.Object>>(item: T) =>
  Type.Object({
    items: Type.Array(item),
    total: Type.Integer({ minimum: 0 }),
    page: Type.Integer({ minimum: 1 }),
    page_size: Type.Integer({ minimum: 1, maximum: 100 }),
  });

/** Pagination query accepted by list endpoints. */
export const PaginationQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  page_size: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
});

/** Inferred pagination query. */
export type PaginationQuery = Static<typeof PaginationQuerySchema>;

/** HTTP header names used across admin APIs. */
export const HEADER_IDEMPOTENCY_KEY = 'idempotency-key';
export const HEADER_IF_MATCH = 'if-match';
export const HEADER_BOOTSTRAP_SECRET = 'x-bootstrap-secret';
