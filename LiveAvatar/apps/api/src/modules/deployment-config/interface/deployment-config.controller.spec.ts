import { DeploymentConfigController } from './deployment-config.controller';

describe('DeploymentConfigController', () => {
  const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };

  function makeController() {
    const getConfig = { execute: jest.fn().mockResolvedValue({}) };
    const validateConfig = { execute: jest.fn().mockResolvedValue({ valid: true }) };
    const saveConfig = { execute: jest.fn().mockResolvedValue({}) };
    const listVersions = { execute: jest.fn().mockResolvedValue({ versions: [] }) };
    const getVersionDiff = { execute: jest.fn().mockResolvedValue({ from: 1, to: 2, lines: [] }) };
    const rollbackVersion = { execute: jest.fn().mockResolvedValue({ config: {} }) };
    const testCall = { execute: jest.fn().mockResolvedValue({ ok: true, final_text: null, nodes: [], errors: [] }) };
    const controller = new DeploymentConfigController(
      getConfig as never,
      validateConfig as never,
      saveConfig as never,
      listVersions as never,
      getVersionDiff as never,
      rollbackVersion as never,
      testCall as never,
    );
    return { controller, getConfig, validateConfig, saveConfig, listVersions, getVersionDiff, rollbackVersion, testCall };
  }

  it('delegates get', () => {
    const { controller, getConfig } = makeController();
    void controller.get(actor, 'tenant-1');
    expect(getConfig.execute).toHaveBeenCalledWith(actor, 'tenant-1');
  });

  it('delegates validate', () => {
    const { controller, validateConfig } = makeController();
    const body = { yaml_text: 'version: 1' };
    void controller.validate(actor, 'tenant-1', body);
    expect(validateConfig.execute).toHaveBeenCalledWith(actor, 'tenant-1', body);
  });

  it('delegates save', () => {
    const { controller, saveConfig } = makeController();
    const body = { config: { version: 1 }, save_as: 'draft' as const };
    void controller.save(actor, 'tenant-1', body, '2026-01-01T00:00:00.000Z');
    expect(saveConfig.execute).toHaveBeenCalledWith(actor, 'tenant-1', body, '2026-01-01T00:00:00.000Z');
  });

  describe('GET versions (Phase 9, BL-035)', () => {
    it('delegates listConfigVersions', () => {
      const { controller, listVersions } = makeController();
      void controller.listConfigVersions(actor, 'tenant-1');
      expect(listVersions.execute).toHaveBeenCalledWith(actor, 'tenant-1');
    });
  });

  describe('GET versions/diff', () => {
    it('parses from/to query params to integers and delegates', () => {
      const { controller, getVersionDiff } = makeController();
      void controller.getConfigVersionDiff(actor, 'tenant-1', '1', '3');
      expect(getVersionDiff.execute).toHaveBeenCalledWith(actor, 'tenant-1', 1, 3);
    });

    it('404s CONFIG_VERSION_NOT_FOUND for a non-integer from/to', () => {
      const { controller } = makeController();
      expect(() => controller.getConfigVersionDiff(actor, 'tenant-1', 'abc', '3')).toThrow(
        expect.objectContaining({ code: 'CONFIG_VERSION_NOT_FOUND' }),
      );
    });

    it('404s CONFIG_VERSION_NOT_FOUND for a from/to below 1', () => {
      const { controller } = makeController();
      expect(() => controller.getConfigVersionDiff(actor, 'tenant-1', '0', '1')).toThrow(
        expect.objectContaining({ code: 'CONFIG_VERSION_NOT_FOUND' }),
      );
    });

    it('does not delegate when validation fails', () => {
      const { controller, getVersionDiff } = makeController();
      expect(() => controller.getConfigVersionDiff(actor, 'tenant-1', '0', '1')).toThrow();
      expect(getVersionDiff.execute).not.toHaveBeenCalled();
    });
  });

  describe('POST versions/:versionNumber/rollback', () => {
    it('parses versionNumber to an integer and delegates', () => {
      const { controller, rollbackVersion } = makeController();
      void controller.rollbackConfigVersion(actor, 'tenant-1', '4');
      expect(rollbackVersion.execute).toHaveBeenCalledWith(actor, 'tenant-1', 4);
    });

    it('404s CONFIG_VERSION_NOT_FOUND for a non-integer versionNumber', () => {
      const { controller } = makeController();
      expect(() => controller.rollbackConfigVersion(actor, 'tenant-1', 'abc')).toThrow(
        expect.objectContaining({ code: 'CONFIG_VERSION_NOT_FOUND' }),
      );
    });

    it('404s CONFIG_VERSION_NOT_FOUND for a versionNumber below 1', () => {
      const { controller } = makeController();
      expect(() => controller.rollbackConfigVersion(actor, 'tenant-1', '0')).toThrow(
        expect.objectContaining({ code: 'CONFIG_VERSION_NOT_FOUND' }),
      );
    });
  });

  describe('POST test-call (Phase 9, BL-037)', () => {
    it('delegates runTestCall', () => {
      const { controller, testCall } = makeController();
      const body = { config: { version: 1 }, utterance: 'hi' };
      void controller.runTestCall(actor, 'tenant-1', body);
      expect(testCall.execute).toHaveBeenCalledWith(actor, 'tenant-1', body);
    });
  });
});
