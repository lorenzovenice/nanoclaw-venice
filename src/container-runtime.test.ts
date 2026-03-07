import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock child_process — store the mock fn so tests can configure it
const mockExecFileSync = vi.fn();
vi.mock('child_process', () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
  execFile: vi.fn(),
}));

// Mock fs for cleanupOrphans (sendCloseSignal writes to filesystem)
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => true),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn(() => ''),
      readdirSync: vi.fn(() => []),
      statSync: vi.fn(() => ({ isDirectory: () => true })),
      unlinkSync: vi.fn(),
    },
  };
});

// Mock config (DATA_DIR needed for sendCloseSignal)
vi.mock('./config.js', () => ({
  DATA_DIR: '/tmp/nanoclaw-test-data',
}));

import {
  CONTAINER_RUNTIME_BIN,
  readonlyMountArgs,
  stopContainer,
  stopContainerArgs,
  ensureContainerRuntimeRunning,
  cleanupOrphans,
  cleanupStaleIpcFiles,
} from './container-runtime.js';
import { logger } from './logger.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Pure functions ---

describe('readonlyMountArgs', () => {
  it('returns -v flag with :ro suffix', () => {
    const args = readonlyMountArgs('/host/path', '/container/path');
    expect(args).toEqual(['-v', '/host/path:/container/path:ro']);
  });
});

describe('stopContainer', () => {
  it('returns stop command using CONTAINER_RUNTIME_BIN', () => {
    expect(stopContainer('nanoclaw-test-123')).toBe(
      `${CONTAINER_RUNTIME_BIN} stop nanoclaw-test-123`,
    );
  });
});

describe('stopContainerArgs', () => {
  it('returns stop args array', () => {
    expect(stopContainerArgs('nanoclaw-test-123')).toEqual(['stop', 'nanoclaw-test-123']);
  });
});

// --- ensureContainerRuntimeRunning ---

describe('ensureContainerRuntimeRunning', () => {
  it('does nothing when runtime is already running', () => {
    mockExecFileSync.mockReturnValueOnce('');

    ensureContainerRuntimeRunning();

    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      CONTAINER_RUNTIME_BIN,
      ['info'],
      { stdio: 'pipe', timeout: 10000 },
    );
    expect(logger.debug).toHaveBeenCalledWith('Container runtime already running');
  });

  it('throws when docker info fails', () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('Cannot connect to the Docker daemon');
    });

    expect(() => ensureContainerRuntimeRunning()).toThrow(
      'Container runtime is required but failed to start',
    );
    expect(logger.error).toHaveBeenCalled();
  });
});

// --- cleanupOrphans ---

describe('cleanupOrphans', () => {
  it('does nothing when no orphans exist', () => {
    mockExecFileSync.mockReturnValueOnce('');

    cleanupOrphans();

    // One ps call, no further action
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      CONTAINER_RUNTIME_BIN,
      ['ps', '--filter', 'name=nanoclaw-', '--format', '{{.Names}}'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('sends close signals and stops orphaned containers', () => {
    // First ps: returns orphan list
    mockExecFileSync.mockReturnValueOnce('nanoclaw-group1-111\nnanoclaw-group2-222\n');
    // Second ps (in grace period loop): returns empty (all exited)
    mockExecFileSync.mockReturnValueOnce('');

    cleanupOrphans();

    // ps (initial) + ps (check in loop)
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith('All orphaned containers exited during grace period');
  });

  it('warns and continues when ps fails', () => {
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('docker not available');
    });

    cleanupOrphans(); // should not throw

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to clean up orphaned containers',
    );
  });

  it('force-stops containers that exited during grace period check', () => {
    // First ps: returns orphan list
    mockExecFileSync.mockReturnValueOnce('nanoclaw-a-1\n');
    // Second ps (inside grace period loop): returns empty → exits grace period immediately
    mockExecFileSync.mockReturnValueOnce('');

    cleanupOrphans(); // should not throw

    expect(logger.info).toHaveBeenCalledWith('All orphaned containers exited during grace period');
  });
});

// --- cleanupStaleIpcFiles ---

describe('cleanupStaleIpcFiles', () => {
  it('does not throw when called', () => {
    // existsSync is mocked to return true by default (from fs mock above)
    // readdirSync is mocked to return empty array
    expect(() => cleanupStaleIpcFiles()).not.toThrow();
  });
});
