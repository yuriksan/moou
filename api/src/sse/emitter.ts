import type { Request, Response } from 'express';

const MAX_CONNECTIONS = 100;
const MAX_PER_IP = 5;
const CONNECTION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const clients = new Set<Response>();
const ipCounts = new Map<string, number>();
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

function getClientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

/**
 * SSE endpoint handler with connection limits.
 */
export function sseHandler(req: Request, res: Response) {
  // Check total connection limit
  if (clients.size >= MAX_CONNECTIONS) {
    res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Too many SSE connections' } });
    return;
  }

  // Check per-IP limit
  const ip = getClientIp(req);
  const ipCount = ipCounts.get(ip) || 0;
  if (ipCount >= MAX_PER_IP) {
    res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message: 'Too many connections from this IP' } });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  clients.add(res);
  ipCounts.set(ip, ipCount + 1);

  // Start keep-alive if first client
  if (clients.size === 1 && !keepAliveTimer) {
    keepAliveTimer = setInterval(() => {
      for (const client of clients) {
        client.write(': keep-alive\n\n');
      }
    }, 30_000);
  }

  // Connection timeout — close after 30 minutes, client will reconnect
  const timeout = setTimeout(() => {
    cleanup();
    res.end();
  }, CONNECTION_TIMEOUT_MS);

  function cleanup() {
    clearTimeout(timeout);
    clients.delete(res);
    const count = ipCounts.get(ip) || 1;
    if (count <= 1) ipCounts.delete(ip);
    else ipCounts.set(ip, count - 1);

    if (clients.size === 0 && keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }

  req.on('close', cleanup);
}

export interface SSEEvent {
  type: string;
  id?: string;
  [key: string]: unknown;
}

/**
 * Broadcast an event to all connected SSE clients.
 */
export function broadcast(event: SSEEvent) {
  const data = JSON.stringify({ ...event, timestamp: new Date().toISOString() });
  const message = `data: ${data}\n\n`;
  for (const client of clients) {
    client.write(message);
  }
}
