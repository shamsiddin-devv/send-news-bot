import pino from 'pino';

export function createLogger(level: string) {
  return pino({
    level,
    redact: ['token', 'apiKey', 'authorization', 'headers.authorization', 'config.BOT_TOKEN', 'config.LLM_API_KEY'],
    base: null,
  });
}

// Tarmoq xatosi ichida tokenli URL yoki so‘rov tanasi bo‘lishi mumkin.
export function safeError(error: unknown): { name: string } {
  return { name: error instanceof Error ? error.name : 'UnknownError' };
}
