import { lowTrafficWorkerOptions } from './bull-worker-options.util.js';

describe('lowTrafficWorkerOptions', () => {
  it('raises drainDelay above the BullMQ default to reduce idle polling', () => {
    expect(lowTrafficWorkerOptions.drainDelay).toBeGreaterThan(5);
  });

  it('raises stalledInterval above the BullMQ default to reduce idle scans', () => {
    expect(lowTrafficWorkerOptions.stalledInterval).toBeGreaterThan(30_000);
  });
});
