import { EventEmitter } from 'node:events';

const refreshBus = new EventEmitter();

interface UserRequest {
  query: Record<string, string>;
  headers: Record<string, string>;
}

interface UserResponse {
  json(body: unknown): void;
}

/**
 * GET /api/users
 *
 * Memory leak: every request registers a `refresh` listener whose closure
 * captures the entire `req` object and is never removed. The heap retains one
 * request per call and the EventEmitter listener count grows without bound.
 */
export function getUsers(req: UserRequest, res: UserResponse): void {
  refreshBus.on('refresh', () => {
    // Captures `req` for the lifetime of the process — the leak.
    void req.headers;
  });
  res.json({ users: [] });
}
