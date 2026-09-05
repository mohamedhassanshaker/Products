import { SkillsController } from './skills.controller';

describe('SkillsController', () => {
  const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };

  function makeController() {
    const createSkill = { execute: jest.fn().mockResolvedValue({}) };
    const listSkills = { execute: jest.fn().mockResolvedValue({ items: [] }) };
    const getSkill = { execute: jest.fn().mockResolvedValue({}) };
    const updateSkillDraft = { execute: jest.fn().mockResolvedValue({}) };
    const publishSkill = { execute: jest.fn().mockResolvedValue({ skill: {} }) };
    const deleteSkill = { execute: jest.fn().mockResolvedValue(undefined) };
    const getSkillUsage = { execute: jest.fn().mockResolvedValue({ used_by_agent_count: 0 }) };
    const controller = new SkillsController(
      createSkill as never,
      listSkills as never,
      getSkill as never,
      updateSkillDraft as never,
      publishSkill as never,
      deleteSkill as never,
      getSkillUsage as never,
    );
    return { controller, createSkill, listSkills, getSkill, updateSkillDraft, publishSkill, deleteSkill, getSkillUsage };
  }

  it('delegates list', () => {
    const { controller, listSkills } = makeController();
    void controller.list(actor, 'tenant-1');
    expect(listSkills.execute).toHaveBeenCalledWith(actor, 'tenant-1');
  });

  it('delegates create', () => {
    const { controller, createSkill } = makeController();
    const body = { name: 'Refunds' };
    void controller.create(actor, 'tenant-1', body);
    expect(createSkill.execute).toHaveBeenCalledWith(actor, 'tenant-1', body);
  });

  it('delegates get', () => {
    const { controller, getSkill } = makeController();
    void controller.get(actor, 'tenant-1', 'skill-1');
    expect(getSkill.execute).toHaveBeenCalledWith(actor, 'tenant-1', 'skill-1');
  });

  it('delegates usage', () => {
    const { controller, getSkillUsage } = makeController();
    void controller.usage(actor, 'tenant-1', 'skill-1');
    expect(getSkillUsage.execute).toHaveBeenCalledWith(actor, 'tenant-1', 'skill-1');
  });

  it('delegates updateDraft', () => {
    const { controller, updateSkillDraft } = makeController();
    const body = { description: 'Updated' };
    void controller.updateDraft(actor, 'tenant-1', 'skill-1', body);
    expect(updateSkillDraft.execute).toHaveBeenCalledWith(actor, 'tenant-1', 'skill-1', body);
  });

  it('delegates publish', () => {
    const { controller, publishSkill } = makeController();
    void controller.publish(actor, 'tenant-1', 'skill-1');
    expect(publishSkill.execute).toHaveBeenCalledWith(actor, 'tenant-1', 'skill-1');
  });

  it('delegates delete', async () => {
    const { controller, deleteSkill } = makeController();
    await controller.remove(actor, 'tenant-1', 'skill-1');
    expect(deleteSkill.execute).toHaveBeenCalledWith(actor, 'tenant-1', 'skill-1');
  });
});
