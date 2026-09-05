import { nodeTypeIcon, nodeTypeLabel } from './node-type-icon';

describe('nodeTypeIcon', () => {
  it('maps every node type (Phase 9 + Phase 11 Parallel/Loop + Phase 13 Skill + Phase 14 HITL + Phase 15 Sub-agent/Handoff/State) to a distinct icon', () => {
    const types = [
      'llm',
      'tool',
      'retrieve',
      'router',
      'speak',
      'end',
      'parallel',
      'loop',
      'skill',
      'hitl',
      'subagent',
      'handoff',
      'state',
    ];
    const icons = types.map((t) => nodeTypeIcon(t));
    expect(new Set(icons).size).toBe(types.length);
  });

  it('maps Parallel to merge_type and Loop to repeat (BL-042/043)', () => {
    expect(nodeTypeIcon('parallel')).toBe('merge_type');
    expect(nodeTypeIcon('loop')).toBe('repeat');
  });

  it('maps Skill to auto_awesome (BL-049/050/051)', () => {
    expect(nodeTypeIcon('skill')).toBe('auto_awesome');
  });

  it('maps Sub-agent/Handoff/State to distinct icons (Phase 15, BL-058/059/060)', () => {
    expect(nodeTypeIcon('subagent')).toBe('smart_toy');
    expect(nodeTypeIcon('handoff')).toBe('support_agent');
    expect(nodeTypeIcon('state')).toBe('memory');
  });

  it('falls back to a generic icon for an unrecognized type', () => {
    expect(nodeTypeIcon('bogus')).toBe('radio_button_unchecked');
  });

  it('falls back to a generic icon when the type is missing', () => {
    expect(nodeTypeIcon(undefined)).toBe('radio_button_unchecked');
    expect(nodeTypeIcon(null)).toBe('radio_button_unchecked');
  });
});

describe('nodeTypeLabel', () => {
  it('labels every node type (Phase 9 + Phase 11 Parallel/Loop + Phase 13 Skill + Phase 14 HITL + Phase 15 Sub-agent/Handoff/State)', () => {
    expect(nodeTypeLabel('llm')).toBe('LLM');
    expect(nodeTypeLabel('tool')).toBe('Tool');
    expect(nodeTypeLabel('retrieve')).toBe('Retrieve');
    expect(nodeTypeLabel('router')).toBe('Router');
    expect(nodeTypeLabel('speak')).toBe('Speak');
    expect(nodeTypeLabel('end')).toBe('End');
    expect(nodeTypeLabel('parallel')).toBe('Parallel');
    expect(nodeTypeLabel('loop')).toBe('Loop');
    expect(nodeTypeLabel('skill')).toBe('Skill');
    expect(nodeTypeLabel('hitl')).toBe('HITL');
    expect(nodeTypeLabel('subagent')).toBe('Sub-agent');
    expect(nodeTypeLabel('handoff')).toBe('Handoff');
    expect(nodeTypeLabel('state')).toBe('State');
  });

  it('returns the raw type for an unrecognized value and "Unknown" for a missing one', () => {
    expect(nodeTypeLabel('bogus')).toBe('bogus');
    expect(nodeTypeLabel(undefined)).toBe('Unknown');
  });
});
