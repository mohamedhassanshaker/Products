import { PipeTransform } from '@nestjs/common';
import type { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { AppErrorCode } from '@liveavatar/contracts';
import { AppError } from '../errors/app-error';

/**
 * Edge validation (LLD §10): Clean → Default → Convert → Check → Decode.
 * Controllers receive already-typed data; use cases re-assert owned invariants.
 */
export class TypeBoxValidationPipe<T extends TSchema> implements PipeTransform {
  /**
   * @param schema - TypeBox schema from packages/contracts
   * @param defaultCode - Code used when Check fails (field map in details)
   */
  constructor(
    private readonly schema: T,
    private readonly defaultCode: AppErrorCode,
  ) {}

  /**
   * Validates and decodes the inbound value.
   * @param value - Raw body or query
   * @returns Decoded value matching the schema
   * @throws AppError 400 when Check fails
   */
  transform(value: unknown): unknown {
    const cleaned = Value.Clean(this.schema, value ?? {});
    const defaulted = Value.Default(this.schema, cleaned);
    const converted = Value.Convert(this.schema, defaulted);
    if (!Value.Check(this.schema, converted)) {
      const fields: Record<string, string> = {};
      for (const err of Value.Errors(this.schema, converted)) {
        const key = err.path.replace(/^\//, '') || '_root';
        fields[key] = this.defaultCode;
      }
      throw AppError.badRequest(this.defaultCode, { fields });
    }
    return Value.Decode(this.schema, converted);
  }
}
