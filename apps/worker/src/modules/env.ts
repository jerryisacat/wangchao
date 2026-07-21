import { readBoundedNumberEnv, readFloatEnv, readPositiveIntegerEnv } from "@wangchao/core";

export { readBoundedNumberEnv, readFloatEnv, readPositiveIntegerEnv };

const MAX_FETCH_ATTEMPTS = 3;

let _fetchConcurrency: number | null = null;
let _candidateObservationConcurrency: number | null = null;
let _backoffBaseMs: number | null = null;
let _softTimeoutMs: number | null = null;
let _totalConcurrency: number | null = null;

export function getMaxFetchAttempts(): number {
  return MAX_FETCH_ATTEMPTS;
}

export function getFetchConcurrency(): number {
  if (_fetchConcurrency !== null) return _fetchConcurrency;
  const raw = process.env.WANGCHAO_FETCH_CONCURRENCY;
  if (!raw) { _fetchConcurrency = 5; return _fetchConcurrency; }
  const parsed = Number.parseInt(raw, 10);
  _fetchConcurrency = Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
  return _fetchConcurrency;
}

export function getCandidateObservationConcurrency(): number {
  if (_candidateObservationConcurrency !== null) return _candidateObservationConcurrency;
  const raw = process.env.WANGCHAO_CANDIDATE_OBSERVATION_CONCURRENCY;
  if (!raw) { _candidateObservationConcurrency = 3; return _candidateObservationConcurrency; }
  const parsed = Number.parseInt(raw, 10);
  _candidateObservationConcurrency = Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
  return _candidateObservationConcurrency;
}

export function getCandidateObservationLimit(): number {
  return Math.min(getFetchConcurrency(), getCandidateObservationConcurrency());
}

export function getBackoffBaseMs(): number {
  if (_backoffBaseMs !== null) return _backoffBaseMs;
  const raw = process.env.WANGCHAO_FETCH_BACKOFF_BASE_MS;
  if (!raw) { _backoffBaseMs = 1000; return _backoffBaseMs; }
  const parsed = Number.parseInt(raw, 10);
  _backoffBaseMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
  return _backoffBaseMs;
}

export function getSoftTimeoutMs(): number {
  if (_softTimeoutMs !== null) return _softTimeoutMs;
  const raw = process.env.WANGCHAO_WORKER_CYCLE_SOFT_TIMEOUT_MS;
  if (!raw) { _softTimeoutMs = 4 * 60 * 1000; return _softTimeoutMs; }
  const parsed = Number.parseInt(raw, 10);
  _softTimeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 4 * 60 * 1000;
  return _softTimeoutMs;
}

export function getTotalConcurrency(): number {
  if (_totalConcurrency !== null) return _totalConcurrency;
  const raw = process.env.WANGCHAO_WORKER_TOTAL_CONCURRENCY;
  if (!raw) { _totalConcurrency = 5; return _totalConcurrency; }
  const parsed = Number.parseInt(raw, 10);
  _totalConcurrency = Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
  return _totalConcurrency;
}

export function getQueueWorkerPollIntervalMs(): number {
  return readBoundedNumberEnv("WANGCHAO_QUEUE_POLL_INTERVAL_MS", 2_000, 250, 60_000);
}

export function getQueueWorkerDrainBudgetMs(): number {
  return readBoundedNumberEnv("WANGCHAO_QUEUE_DRAIN_BUDGET_MS", 30_000, 1_000, 300_000);
}

export function getQueueWorkerMaxTasks(): number {
  return readBoundedNumberEnv("WANGCHAO_QUEUE_MAX_TASKS_PER_DRAIN", 50, 1, 500);
}

export function getQueueWorkerHeartbeatIntervalMs(): number {
  return readBoundedNumberEnv(
    "WANGCHAO_QUEUE_HEARTBEAT_INTERVAL_MS",
    60_000,
    5_000,
    3_600_000,
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const queue: Array<() => void> = [];
  let head = 0;
  let activeCount = 0;

  const next = () => {
    activeCount--;
    if (head < queue.length) {
      const run = queue[head]!;
      head++;
      if (head > 0x4000) {
        queue.splice(0, head);
        head = 0;
      }
      activeCount++;
      run();
    }
  };

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        activeCount++;
        fn().then(
          (result) => {
            resolve(result);
            next();
          },
          (error) => {
            reject(error);
            next();
          },
        );
      };

      if (activeCount < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
}

