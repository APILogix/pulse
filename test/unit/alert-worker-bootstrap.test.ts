import { describe, expect, it, vi } from 'vitest';
import { AlertWorkerProcess } from '../../src/shared/workers/alert-workers-main.js';

function pool() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
  } as never;
}

function logDatabase() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    getPrimaryPool: vi.fn(() => ({ query: vi.fn() })),
    close: vi.fn().mockResolvedValue(undefined),
  } as never;
}

describe('alert worker process lifecycle', () => {
  it('starts both alert delivery groups before readiness and shuts down once', async () => {
    const registerConnectors = vi.fn().mockResolvedValue({ stop: vi.fn().mockResolvedValue(undefined) });
    const registerAlerting = vi.fn().mockResolvedValue({ stop: vi.fn().mockResolvedValue(undefined) });
    const exit = vi.fn((code: number) => {
      throw new Error(`exit:${code}`);
    }) as never;
    const ready = vi.spyOn(process, 'send').mockImplementation(() => true);
    const processWorker = new AlertWorkerProcess({
      primaryPool: pool(),
      logDatabase: logDatabase(),
      assertRuntimePool: vi.fn().mockResolvedValue(undefined),
      assertConfigPool: vi.fn().mockResolvedValue(undefined),
      registerConnectors,
      registerAlerting,
      exit,
      installSignalHandlers: false,
    });

    await processWorker.start();

    expect(registerConnectors).toHaveBeenCalledWith(
      expect.anything(),
      {
        group: 'alert-delivery',
        strictQueueCreation: true,
      },
      expect.anything(),
    );
    expect(registerAlerting).toHaveBeenCalledWith(
      expect.anything(),
      { group: 'alert-delivery', strictQueueCreation: true },
      undefined,
      expect.anything(),
      expect.anything(),
    );
    expect(ready).toHaveBeenCalledWith('ready');

    const shutdown = processWorker.shutdown('SIGTERM');
    await expect(processWorker.shutdown('SIGINT')).resolves.toBeUndefined();
    await expect(shutdown).rejects.toThrow('exit:0');
    expect(exit).toHaveBeenCalledOnce();
    ready.mockRestore();
  });

  it('does not signal readiness when registration fails', async () => {
    const exit = vi.fn((code: number) => {
      throw new Error(`exit:${code}`);
    }) as never;
    const ready = vi.spyOn(process, 'send').mockImplementation(() => true);
    const processWorker = new AlertWorkerProcess({
      primaryPool: pool(),
      logDatabase: logDatabase(),
      assertRuntimePool: vi.fn().mockRejectedValue(new Error('runtime pool failure')),
      assertConfigPool: vi.fn().mockResolvedValue(undefined),
      exit,
      installSignalHandlers: false,
    });

    await expect(processWorker.start()).rejects.toThrow('exit:1');
    expect(ready).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    ready.mockRestore();
  });
});
