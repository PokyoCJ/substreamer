jest.mock('../persistence/kvStorage', () => require('../persistence/__mocks__/kvStorage'));

import { coverArtRecacheStore } from '../coverArtRecacheStore';

beforeEach(() => {
  coverArtRecacheStore.setState({
    status: 'pending',
    total: 0,
    processed: 0,
    failed: 0,
    lastRunAt: null,
    lastTrigger: null,
  });
});

describe('coverArtRecacheStore', () => {
  it('begin transitions to running and stamps the trigger', () => {
    coverArtRecacheStore.getState().begin(42, 'auto');
    const s = coverArtRecacheStore.getState();
    expect(s.status).toBe('running');
    expect(s.total).toBe(42);
    expect(s.processed).toBe(0);
    expect(s.failed).toBe(0);
    expect(s.lastTrigger).toBe('auto');
  });

  it('begin clears prior counts on a fresh start', () => {
    coverArtRecacheStore.setState({ processed: 17, failed: 3 });
    coverArtRecacheStore.getState().begin(10, 'manual');
    expect(coverArtRecacheStore.getState().processed).toBe(0);
    expect(coverArtRecacheStore.getState().failed).toBe(0);
  });

  it('recordProcessed increments processed only', () => {
    coverArtRecacheStore.getState().begin(2, 'auto');
    coverArtRecacheStore.getState().recordProcessed();
    expect(coverArtRecacheStore.getState().processed).toBe(1);
    expect(coverArtRecacheStore.getState().failed).toBe(0);
  });

  it('recordFailed increments both processed and failed', () => {
    coverArtRecacheStore.getState().begin(2, 'auto');
    coverArtRecacheStore.getState().recordFailed();
    expect(coverArtRecacheStore.getState().processed).toBe(1);
    expect(coverArtRecacheStore.getState().failed).toBe(1);
  });

  it('complete transitions to done and stamps lastRunAt', () => {
    const before = Date.now();
    coverArtRecacheStore.getState().begin(1, 'auto');
    coverArtRecacheStore.getState().complete();
    const s = coverArtRecacheStore.getState();
    expect(s.status).toBe('done');
    expect(s.lastRunAt).toBeGreaterThanOrEqual(before);
  });

  it('reset returns to pending with zeroed counts', () => {
    coverArtRecacheStore.getState().begin(50, 'manual');
    coverArtRecacheStore.getState().recordProcessed();
    coverArtRecacheStore.getState().complete();
    coverArtRecacheStore.getState().reset();
    const s = coverArtRecacheStore.getState();
    expect(s.status).toBe('pending');
    expect(s.total).toBe(0);
    expect(s.processed).toBe(0);
    expect(s.failed).toBe(0);
  });
});
