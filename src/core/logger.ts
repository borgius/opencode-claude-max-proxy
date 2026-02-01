/**
 * Structured logging utility
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

let currentLogLevel: LogLevel = 'INFO';

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLogLevel];
}

function formatData(data: unknown): string {
  if (data === null || data === undefined) return '';

  try {
    // Mask sensitive data
    const masked = maskSensitiveData(data);
    const str = JSON.stringify(masked);
    // Truncate very long strings
    return str.length > 500 ? str.slice(0, 500) + '...' : str;
  } catch {
    return String(data);
  }
}

function maskSensitiveData(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;

  const sensitiveKeys = ['accessToken', 'refreshToken', 'token', 'password', 'secret', 'key', 'authorization'];
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
      result[key] = typeof value === 'string' ? `${value.slice(0, 8)}...` : '[MASKED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = maskSensitiveData(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

export function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${formatData(data)}` : '';
  console.log(`[${timestamp}] [${level}] ${message}${dataStr}`);
}

export function debug(message: string, data?: Record<string, unknown>): void {
  log('DEBUG', message, data);
}

export function info(message: string, data?: Record<string, unknown>): void {
  log('INFO', message, data);
}

export function warn(message: string, data?: Record<string, unknown>): void {
  log('WARN', message, data);
}

export function error(message: string, data?: Record<string, unknown>): void {
  log('ERROR', message, data);
}

export const logger = {
  debug,
  info,
  warn,
  error,
  setLogLevel,
  getLogLevel,
};

export default logger;
