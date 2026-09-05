import { describe, expect, it, vi } from 'vitest';
import { PermissionsCrudService } from './permissions-crud.service';
import { PermissionInUseError, PermissionNotFoundError } from '../domain/errors';
import type { PermissionRepository } from '../infrastructure/permission.repository';
import type { PermissionEntity } from '@/server/infrastructure/database';

const EXAMS_READ: PermissionEntity = { id: 1, name: 'exams.read', description: null, group: 'Exams', createdAt: new Date() };

describe('PermissionsCrudService', () => {
  it('lists permissions', async () => {
    const repo = { findAll: vi.fn().mockResolvedValue([EXAMS_READ]) } as unknown as PermissionRepository;
    const service = new PermissionsCrudService(repo);
    await expect(service.list()).resolves.toEqual([{ id: 1, name: 'exams.read', description: null, group: 'Exams' }]);
  });

  it('rejects deleting an unknown permission', async () => {
    const repo = { findById: vi.fn().mockResolvedValue(null) } as unknown as PermissionRepository;
    const service = new PermissionsCrudService(repo);
    await expect(service.delete(999)).rejects.toThrow(PermissionNotFoundError);
  });

  it('rejects deleting a permission still granted to a role', async () => {
    const repo = {
      findById: vi.fn().mockResolvedValue(EXAMS_READ),
      isReferencedByAnyRole: vi.fn().mockResolvedValue(true),
    } as unknown as PermissionRepository;
    const service = new PermissionsCrudService(repo);
    await expect(service.delete(1)).rejects.toThrow(PermissionInUseError);
  });

  it('deletes an unreferenced permission', async () => {
    const del = vi.fn();
    const repo = {
      findById: vi.fn().mockResolvedValue(EXAMS_READ),
      isReferencedByAnyRole: vi.fn().mockResolvedValue(false),
      delete: del,
    } as unknown as PermissionRepository;
    const service = new PermissionsCrudService(repo);
    await service.delete(1);
    expect(del).toHaveBeenCalledWith(1);
  });
});
