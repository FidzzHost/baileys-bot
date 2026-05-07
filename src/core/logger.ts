import pino from 'pino'
import { env } from '../config/env'

export const logger = pino({
  level: env.logLevel,
  transport:
    process.stdout.isTTY
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
})

export type Logger = typeof logger
