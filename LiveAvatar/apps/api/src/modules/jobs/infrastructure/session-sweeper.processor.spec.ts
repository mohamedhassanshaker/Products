import { SessionSweeperProcessor } from './session-sweeper.processor';

describe('SessionSweeperProcessor', () => {
  it('runs the sweep and returns the abandoned count', async () => {
    const sweep = { execute: jest.fn().mockResolvedValue(3) };
    const processor = new SessionSweeperProcessor(sweep as never);
    const result = await processor.process({ id: 'job-1' } as never);
    expect(result).toEqual({ abandoned: 3 });
  });
});
