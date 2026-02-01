/**
 * Claude CLI Process Manager
 * Manages a persistent Claude CLI process with request queueing
 */

import { spawn, ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import type { ClaudeStreamMessage, ClaudeInputMessage, AnthropicUsage } from './types.js';
import { logger } from './logger.js';

export interface RequestHandler {
  onEvent: (message: ClaudeStreamMessage) => void;
  onError: (error: Error) => void;
  onDone: (code: number) => void;
}

interface QueuedRequest extends RequestHandler {
  prompt: string;
}

export class ClaudeProcessManager {
  private process: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private isReady = false;
  private pendingRequest: RequestHandler | null = null;
  private requestQueue: QueuedRequest[] = [];
  private lastActivity = Date.now();
  private requestCount = 0;

  constructor() {
    logger.info('ClaudeProcessManager initialized');
  }

  /**
   * Ensure Claude process is running
   */
  async ensureProcess(): Promise<void> {
    if (this.process && !this.process.killed) {
      logger.debug('Reusing existing Claude process', {
        pid: this.process.pid,
        requestCount: this.requestCount,
      });
      return;
    }

    logger.info('Starting new persistent Claude process');
    const startTime = Date.now();

    const args = [
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
      '--no-session-persistence',
    ];

    this.process = spawn('claude', args, {
      env: {
        ...process.env,
        CI: 'true',
        TERM: 'dumb',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 'true',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    logger.info('Claude process spawned', {
      pid: this.process.pid,
      elapsed: Date.now() - startTime,
    });

    this.rl = readline.createInterface({ input: this.process.stdout! });

    // Handle output lines
    this.rl.on('line', (line: string) => {
      if (!line.trim()) return;

      try {
        const msg = JSON.parse(line) as ClaudeStreamMessage;
        this.handleMessage(msg);
      } catch (err) {
        logger.error('Parse error', { line: line.slice(0, 100) });
      }
    });

    // Handle stderr
    this.process.stderr?.on('data', (data: Buffer) => {
      logger.warn('stderr', { data: data.toString().slice(0, 200) });
    });

    // Handle process close
    this.process.on('close', (code: number | null) => {
      logger.info('Claude process closed', { code, requestCount: this.requestCount });
      this.process = null;
      this.rl = null;
      this.isReady = false;

      if (this.pendingRequest) {
        this.pendingRequest.onError(new Error(`Process exited with code ${code}`));
        this.pendingRequest = null;
      }
    });

    // Handle process error
    this.process.on('error', (err: Error) => {
      logger.error('Process error', { error: err.message });
      if (this.pendingRequest) {
        this.pendingRequest.onError(err);
        this.pendingRequest = null;
      }
    });

    this.isReady = true;
    logger.info('Claude process ready', { elapsed: Date.now() - startTime });
  }

  /**
   * Handle message from Claude process
   */
  private handleMessage(msg: ClaudeStreamMessage): void {
    this.lastActivity = Date.now();

    if (msg.type === 'system') {
      logger.debug('System message received', { subtype: msg.subtype || 'init' });
    }

    if (this.pendingRequest) {
      this.pendingRequest.onEvent(msg);

      // Check if this completes the request
      if (msg.type === 'result') {
        logger.debug('Result received, request complete', { requestCount: this.requestCount });
        const req = this.pendingRequest;
        this.pendingRequest = null;
        req.onDone(0);

        // Process next request in queue
        this.processQueue();
      }
    }
  }

  /**
   * Send a message to Claude
   */
  sendMessage(
    prompt: string,
    onEvent: (message: ClaudeStreamMessage) => void,
    onError: (error: Error) => void,
    onDone: (code: number) => void
  ): void {
    const request: QueuedRequest = { prompt, onEvent, onError, onDone };

    if (this.pendingRequest) {
      logger.debug('Queueing request', { queueLength: this.requestQueue.length });
      this.requestQueue.push(request);
      return;
    }

    this.executeRequest(request);
  }

  /**
   * Execute a request
   */
  private async executeRequest(request: QueuedRequest): Promise<void> {
    const { prompt, onEvent, onError, onDone } = request;
    const requestId = Math.random().toString(36).substring(2, 8);
    const startTime = Date.now();

    try {
      await this.ensureProcess();

      this.pendingRequest = { onEvent, onError, onDone };
      this.requestCount++;

      const inputMessage: ClaudeInputMessage = {
        type: 'user',
        message: { role: 'user', content: prompt },
      };

      logger.debug('Sending message', {
        requestId,
        promptLen: prompt.length,
        requestCount: this.requestCount,
      });

      this.process!.stdin!.write(JSON.stringify(inputMessage) + '\n');
      logger.debug('Message sent', { requestId, elapsed: Date.now() - startTime });
    } catch (err) {
      logger.error('Execute request error', { requestId, error: (err as Error).message });
      onError(err as Error);
    }
  }

  /**
   * Process next request in queue
   */
  private processQueue(): void {
    if (this.requestQueue.length > 0 && !this.pendingRequest) {
      const nextRequest = this.requestQueue.shift()!;
      logger.debug('Processing queued request', { queueLength: this.requestQueue.length });
      this.executeRequest(nextRequest);
    }
  }

  /**
   * Get process status
   */
  getStatus(): {
    alive: boolean;
    requestCount: number;
    queueLength: number;
    lastActivity: number;
    pid: number | undefined;
  } {
    return {
      alive: this.process !== null && !this.process.killed,
      requestCount: this.requestCount,
      queueLength: this.requestQueue.length,
      lastActivity: this.lastActivity,
      pid: this.process?.pid,
    };
  }

  /**
   * Shutdown the process
   */
  shutdown(): void {
    if (this.process) {
      logger.info('Shutting down Claude process', { requestCount: this.requestCount });
      this.process.kill();
      this.process = null;
    }

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}

// Singleton instance
export const claudeManager = new ClaudeProcessManager();

export default claudeManager;
