import { describe, expect, it } from 'vitest';
import { runWithRequestContext } from './request-context';
import { requireTenantDataSource, requireTenantId } from './tenant-context';
import { InternalDomainError } from '@/server/common/errors/domain-error';

describe('requireTenantDataSource', () => {
  it('throws InternalDomainError when called outside any resolved tenant scope', () => {
    expect(() => requireTenantDataSource()).toThrow(InternalDomainError);
  });

  it('throws InternalDomainError when the ALS context exists but has no tenantDataSource', async () => {
    await runWithRequestContext({ requestId: 'r1' }, async () => {
      expect(() => requireTenantDataSource()).toThrow(InternalDomainError);
    });
  });

  it('returns the bound DataSource when present', async () => {
    const fakeDataSource = {} as never;
    await runWithRequestContext({ requestId: 'r1', tenantDataSource: fakeDataSource }, async () => {
      expect(requireTenantDataSource()).toBe(fakeDataSource);
    });
  });
});

describe('requireTenantId', () => {
  it('throws InternalDomainError when called outside any resolved tenant scope', () => {
    expect(() => requireTenantId()).toThrow(InternalDomainError);
  });

  it('returns the bound tenantId when present', async () => {
    await runWithRequestContext({ requestId: 'r1', tenantId: 'tenant-1' }, async () => {
      expect(requireTenantId()).toBe('tenant-1');
    });
  });
});
