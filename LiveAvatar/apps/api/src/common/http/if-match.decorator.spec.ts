import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { AppError } from '../errors/app-error';
import { IfMatch } from './if-match.decorator';

/**
 * Standard NestJS pattern for unit-testing a `createParamDecorator` factory:
 * apply the decorator to a dummy method, then pull the stored factory back
 * off the route-args metadata and invoke it directly with a fake context.
 */
function extractFactory(): (data: unknown, ctx: unknown) => string {
  class Dummy {
    method(@IfMatch() _ifMatch: string) {
      return _ifMatch;
    }
  }
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Dummy, 'method');
  const key = Object.keys(args)[0];
  return args[key].factory;
}

function fakeContext(headerValue: string | undefined) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) => (name.toLowerCase() === 'if-match' ? headerValue : undefined),
      }),
    }),
  };
}

describe('IfMatch decorator', () => {
  const factory = extractFactory();

  it('returns the header value when present', () => {
    expect(factory(undefined, fakeContext('2026-01-01T00:00:00.000Z'))).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('throws 409 TENANT_CONFLICT when the header is missing', () => {
    expect(() => factory(undefined, fakeContext(undefined))).toThrow(AppError);
    try {
      factory(undefined, fakeContext(undefined));
    } catch (err) {
      expect((err as AppError).code).toBe('TENANT_CONFLICT');
      expect((err as AppError).httpStatus).toBe(409);
    }
  });
});
