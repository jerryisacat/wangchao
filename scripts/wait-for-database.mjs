import net from "node:net";

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_INTERVAL_MS = 2_000;
const CONNECT_TIMEOUT_MS = 5_000;

function parsePositiveInt(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readDatabaseEndpoint() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error("DATABASE_URL is required before waiting for the database");
  }

  const url = new URL(rawUrl);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol");
  }

  return {
    host: url.hostname,
    port: url.port ? Number.parseInt(url.port, 10) : 5432,
  };
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function probeTcp({ host, port }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("connection timed out"));
    });
    socket.once("error", (error) => {
      socket.destroy();
      reject(error);
    });
  });
}

async function main() {
  const endpoint = readDatabaseEndpoint();
  const timeoutMs = parsePositiveInt(process.env.WANGCHAO_DB_WAIT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const intervalMs = parsePositiveInt(process.env.WANGCHAO_DB_WAIT_INTERVAL_MS, DEFAULT_INTERVAL_MS);
  const startedAt = Date.now();
  let attempt = 0;
  let lastError = null;

  while (Date.now() - startedAt <= timeoutMs) {
    attempt += 1;

    try {
      await probeTcp(endpoint);
      console.log(`Database is reachable at ${endpoint.host}:${endpoint.port} after ${attempt} attempt(s).`);
      return;
    } catch (error) {
      lastError = error;
      const elapsedMs = Date.now() - startedAt;
      const remainingMs = timeoutMs - elapsedMs;

      if (remainingMs <= 0) {
        break;
      }

      console.log(
        `Waiting for database at ${endpoint.host}:${endpoint.port} (${attempt} attempt(s), last error: ${
          error.code ?? error.message
        })`,
      );
      await wait(Math.min(intervalMs, remainingMs));
    }
  }

  throw new Error(
    `Database did not become reachable at ${endpoint.host}:${endpoint.port} within ${timeoutMs}ms. Last error: ${
      lastError?.code ?? lastError?.message ?? "unknown"
    }`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
