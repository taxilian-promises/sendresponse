// Adapted from nodejs-apperror (MIT; Jarom Loveridge / GradeCam).

const DEFAULT_LOGGER = console;

export interface AppErrorOptions {
  message?: string | undefined;
  msg?: string | undefined;
  data?: unknown;
  code?: number | undefined;
  status?: number | undefined;
  statusCode?: number | undefined;
  logError?: boolean | undefined;
  captureStack?: boolean | undefined;
}

export interface AppErrorResponse {
  type: string;
  message: string;
  data: unknown;
  code: number;
}

export interface ErrorLogger {
  error?: (value: unknown) => void;
}

export interface CustomErrorConstructor {
  new (msgOrOpts?: string | AppErrorOptions, code?: number, data?: unknown): AppError;
  readonly prototype: AppError;
}

export class AppError extends Error {
  data: unknown;
  code: number;
  statusCode: number;
  isAppError = true;
  logError: boolean;
  captureStack: boolean;
  private _logged = false;

  constructor(options: string | AppErrorOptions = {}) {
    const opts = typeof options === 'string' ? { message: options } : options;
    const message = opts.message || opts.msg || 'An error occurred.';
    super(message);

    this.name = 'AppError';
    this.data = opts.data || '';
    this.code = opts.code || opts.status || opts.statusCode || 500;
    this.statusCode = this.code;
    this.logError = typeof opts.logError !== 'boolean' || opts.logError;
    this.captureStack = typeof opts.captureStack !== 'boolean' || opts.captureStack;

    if (this.captureStack) {
      Error.captureStackTrace(this, AppError);
    } else {
      // super() always captures a stack in V8; the original function-based
      // implementation never invoked the Error constructor, so remove it
      // to honor captureStack: false.
      delete this.stack;
    }
  }

  toJSON(): AppErrorResponse {
    return {
      type: this.name,
      message: this.message,
      data: this.data,
      code: this.code,
    };
  }

  toResponseObject(): AppErrorResponse {
    return this.toJSON();
  }

  log(logger: ErrorLogger = DEFAULT_LOGGER): this {
    // The original condition was a tautology, silently disabling logging.
    if (typeof logger.error !== 'function' || !this.logError || this._logged) {
      return this;
    }

    this._logged = true;
    logger.error(this.toJSON());
    if (this.stack) {
      logger.error(this.stack);
    }
    return this;
  }

  static createCustom(name: string, defaults: AppErrorOptions = {}): CustomErrorConstructor {
    return class CustomError extends AppError {
      constructor(msgOrOpts?: string | AppErrorOptions, code?: number, data?: unknown) {
        const options = createCustomOptions(defaults, msgOrOpts, code, data);
        super(options);
        this.name = name;
        if (this.captureStack) {
          Error.captureStackTrace(this, CustomError);
        }
      }
    };
  }
}

function createCustomOptions(
  defaults: AppErrorOptions,
  msgOrOpts?: string | AppErrorOptions,
  code?: number,
  data?: unknown,
): AppErrorOptions {
  if (msgOrOpts && typeof msgOrOpts === 'object') {
    return {
      ...defaults,
      message: msgOrOpts.message || msgOrOpts.msg || defaults.message || defaults.msg,
      code:
        msgOrOpts.code ||
        msgOrOpts.status ||
        msgOrOpts.statusCode ||
        defaults.code ||
        defaults.status ||
        defaults.statusCode,
      data: msgOrOpts.data || defaults.data,
      captureStack:
        typeof msgOrOpts.captureStack === 'boolean'
          ? msgOrOpts.captureStack
          : defaults.captureStack,
      logError: typeof msgOrOpts.logError === 'boolean' ? msgOrOpts.logError : defaults.logError,
    };
  }

  return {
    ...defaults,
    message: msgOrOpts || defaults.message || defaults.msg,
    code: code || defaults.code || defaults.status || defaults.statusCode,
    data: data || defaults.data,
  };
}

export default AppError;
