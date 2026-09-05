import { ProviderProbeProcessor } from './provider-probe.processor';

describe('ProviderProbeProcessor', () => {
  it('runs the sweep and returns its result', async () => {
    const sweep = { execute: jest.fn().mockResolvedValue({ probed: 5, failed: 1 }) };
    const processor = new ProviderProbeProcessor(sweep as never);
    const result = await processor.process({ id: 'job-1' } as never);
    expect(result).toEqual({ probed: 5, failed: 1 });
    expect(sweep.execute).toHaveBeenCalledTimes(1);
  });
});
