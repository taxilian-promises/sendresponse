import AppError from './apperror.js';
import type { CustomErrorConstructor } from './apperror.js';

export interface Send {
  (status: number, body?: unknown): unknown;
  (body: unknown): unknown;
}

export interface HTTPResponseLike {
  json?: Send;
  send: Send;
  sendResponse?: <T>(promise: PromiseLike<T> | T, code?: number) => void;
  status(code: number): HTTPResponseLike;
}

export interface ErrorResponseBody {
  code?: number | undefined;
}

export interface TranslatorFunction {
  /**
   * Return any truthy value to use it as the response body (a numeric `code`
   * property becomes the HTTP status; anything else falls back to 500).
   * Return a falsy value (`null`, `undefined`, `false`, `0`, `''`) to pass
   * the error to the next translator.
   */
  (err: Error): unknown;
}

interface ResponseObjectError {
  toResponseObject(): ErrorResponseBody;
}

let verboseConsoleErrors = false;
let legacyErrorFormat = false;
const errorTranslators: TranslatorFunction[] = [];

export function sendResponse<T>(res: HTTPResponseLike, promise: PromiseLike<T> | T, code?: number) {
  if (!res.json) {
    throw new Error('First parameter must be the response object!');
  }
  const responseStack = new Error();
  void Promise.resolve(promise).then(
    (result) => {
      if (result instanceof Error) {
        sendErrorResponse(result, res);
      } else if (result === undefined || result === null) {
        res.status(404).send(legacyErrorFormat ? toLegacyFormat(NotFound) : NotFound);
      } else {
        res.status(code || 200).send(result);
      }
    },
    (err: unknown) => {
      if (err instanceof Error) {
        sendErrorResponse(err, res);
        if (verboseConsoleErrors && !(err instanceof AppError && !err.captureStack)) {
          console.error('sendResponse called with error:', err, err.stack);
          console.trace();
          console.error('sendresponse stack:', responseStack.stack);
        }
        return;
      }

      console.error('Internal Server Error -- Promise reject with:', err);
      console.trace();
      console.error('sendresponse stack:', responseStack.stack);
      const internalServerError = new InternalServerError();
      res.status(500).send(legacyErrorFormat ? toLegacyFormat(internalServerError) : internalServerError);
    },
  );
}

export function middleware(_req: unknown, res: HTTPResponseLike, next: () => void) {
  res.sendResponse = (promise, code) => sendResponse(res, promise, code);
  next();
}

export function registerTranslator(fn: TranslatorFunction) {
  errorTranslators.push(fn);
}

export function setVerboseLogs() {
  verboseConsoleErrors = true;
}

export function setLegacyErrorFormat() {
  legacyErrorFormat = true;
}

// ForbiddenError and UnauthenticatedError are used to distinguish between
// 403's as a result of being not authorized vs. not authenticated
export const UnauthenticatedError = AppError.createCustom(
  'UnauthenticatedError', {msg: 'Authentication Required', code: 403, captureStack: false}
);
export const ForbiddenError = AppError.createCustom(
  'ForbiddenError', {msg: 'Forbidden', code: 403, captureStack: false}
);
export const ValidationError = AppError.createCustom(
  'ValidationError', {msg: 'ValidationError', code: 400, captureStack: false}
);
export const UnknownError = AppError.createCustom(
  'UnknownError', {msg: 'Unknown Error'}
);
export const InternalServerError = AppError.createCustom(
  'InternalServerError', {msg: 'Internal Server Error'}
);
export const InvalidRequestError = AppError.createCustom(
  'InvalidRequestError', {msg: 'Invalid request', code: 400}
);
// Export an instance of an object which represents NotFound
export const NotFound = new (AppError.createCustom(
  'NotFound', {msg: 'NotFound', code: 404, captureStack: false}
))();
export const createCustomError = AppError.createCustom;

function toLegacyFormat(err: AppError) {
  const obj = err.toJSON();
  const data: unknown[] = [obj.message];
  if (obj.data) {
    data.push(obj.data);
  }
  return {
    type: obj.type,
    data: data,
    code: obj.code,
  };
}

function isResponseObjectError(error: unknown): error is ResponseObjectError {
  if (typeof error !== 'object' || error === null || !('toResponseObject' in error)) {
    return false;
  }
  return typeof error.toResponseObject === 'function';
}

function responseCodeOf(value: unknown) {
  return typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'number'
    ? value.code
    : undefined;
}

function sendErrorResponse(err: Error | ResponseObjectError, res: HTTPResponseLike) {
  let responseObject: unknown = undefined;
  if (err instanceof AppError) {
    err.log();
    res.status(err.code || 500).send(legacyErrorFormat ? toLegacyFormat(err) : err);
    return;
  }
  if (isResponseObjectError(err)) {
    responseObject = err.toResponseObject();
  } else {
    try {
      for (const translator of errorTranslators) {
        const translatedError = translator(err);
        if (translatedError) {
          responseObject = translatedError;
          break;
        }
      }
    } catch (translationError: unknown) {
      console.warn(
        'Error trying to handle error with error translator:',
        translationError,
        getErrorStack(translationError),
      );
    }
  }
  if (!responseObject) {
    if (verboseConsoleErrors) {
      console.error('Unknown error!', err, getErrorStack(err));
    }
    responseObject = new UnknownError(err.toString());
  }
  console.warn('Error response:', responseObject);
  res.status(responseCodeOf(responseObject) || 500).send(responseObject);
}

function getErrorStack(error: unknown) {
  return error instanceof Error ? error.stack : undefined;
}

export interface SendResponseExport {
  <T>(res: HTTPResponseLike, promise: PromiseLike<T> | T, code?: number): void;
  createCustomError: typeof createCustomError;
  ForbiddenError: CustomErrorConstructor;
  InternalServerError: CustomErrorConstructor;
  InvalidRequestError: CustomErrorConstructor;
  middleware: typeof middleware;
  NotFound: AppError;
  registerTranslator: typeof registerTranslator;
  setLegacyErrorFormat: typeof setLegacyErrorFormat;
  setVerboseLogs: typeof setVerboseLogs;
  UnauthenticatedError: CustomErrorConstructor;
  UnknownError: CustomErrorConstructor;
  ValidationError: CustomErrorConstructor;
}

const sendResponseWithHelpers: SendResponseExport = Object.assign(
  sendResponse,
  {
    createCustomError,
    ForbiddenError,
    InternalServerError,
    InvalidRequestError,
    middleware,
    NotFound,
    registerTranslator,
    setLegacyErrorFormat,
    setVerboseLogs,
    UnauthenticatedError,
    UnknownError,
    ValidationError,
  },
);

export default sendResponseWithHelpers;
