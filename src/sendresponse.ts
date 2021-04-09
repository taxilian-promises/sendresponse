import AppError from 'apperror';

interface Send {
  (status: number, body?: any): any;
  (body: any): any;
}
interface HTTPResponseLike {
  json: Send;
  send: Send;
  sendResponse: (promise: any, code?: number) => void;
  status(code: number): HTTPResponseLike;
}
interface TranslatorFunction {
  (err: Error): any;
}
type Promisify<T = any> = (val: PromiseLike<T> | T) => Promise<T>;

let Promisify: Promisify = async (value: any) => value;
let verboseConsoleErrors = false;
let legacyErrorFormat = false;
let errorTranslators: TranslatorFunction[] = [];
export function sendResponse(res: HTTPResponseLike, promise: any, code?: number) {
  if (!res.json) {
    throw new Error('First parameter must be the response object!');
  }
  const responseStack = new Error();
  const out = Promisify(promise).then(function(result) {
    if(result instanceof Error) {
      sendErrorResponse(result, res);
    } else if (result === void(0) || result === null) {
      res.status(404).send(legacyErrorFormat && toLegacyFormat(NotFound) || NotFound);
    } else {
      res.status(code || 200).send(result);
    }
  }, function(err: AppError) {
    let ise;
    if(err instanceof Error) {
      sendErrorResponse(err, res);
      if (verboseConsoleErrors && !(err instanceof AppError && !err.captureStack)) {
        console.error('sendResponse called with error:', err, err.stack);
        console.trace();
        console.error('sendresponse stack:', responseStack.stack);
      }
    } else {
      console.error('Internal Server Error -- Promise reject with:', err);
      console.trace();
      console.error('sendresponse stack:', responseStack.stack);
      ise = new InternalServerError();
      res.status(500).send(legacyErrorFormat && toLegacyFormat(ise) || ise);
    }
  });
  if ((out as any).done) { (out as any).done(); }
}
export function middleware(req: any, res: HTTPResponseLike, next: Function) {
  res.sendResponse = (promise: any, code?: number) => sendResponse(res, promise, code);
  next();
};
export function registerTranslator(fn: TranslatorFunction) {
  errorTranslators.push(fn);
};
export function setVerboseLogs() { verboseConsoleErrors = true; };
export function setLegacyErrorFormat() { legacyErrorFormat = true; };
export function setPromiseFactory(fn: Promisify) {
  // This should be a function which accepts a value which may or may not be
  // a Promises/A+ object and returns a Promises/A+ object.  If the return object
  // has a done() method that will be invoked with no parameters at the end; Q and Bluebird
  // both support this as a way to ensure that there are no swallowed uncaught exceptions
  Promisify = fn;
};

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
  const data = [obj.message];
  if (obj.data) { data.push(obj.data); }
  return {
    type: obj.type,
    data: data,
    code: obj.code,
  };
}
let foo: Error;
function sendErrorResponse(err: AppError | Error | {toResponseObject: () => any; stack?: string}, res: HTTPResponseLike) {
  let obj;
  if (err instanceof AppError) {
    err.log();
    return res.status(err.code || 500).send(legacyErrorFormat && toLegacyFormat(err) || err);
  } else if ('toResponseObject' in err) {
    obj = err.toResponseObject();
  } else {
    try {
      for (let i = 0; i < errorTranslators.length; ++i) {
        obj = errorTranslators[i](err);
        if (obj) { break; }
      }
    } catch(err2) {
      console.warn('Error trying to handle error with error translator:', err2, err2.stack);
    }
  }
  if (!obj) {
    if (verboseConsoleErrors) {
      console.error('Unknown error!', err, err.stack);
    }
    obj = new UnknownError(err.toString());
  }
  console.warn('Error response:', obj);
  res.status(obj.code || 500).send(obj);
}

export default Object.assign(
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
    setPromiseFactory,
    setVerboseLogs,
    UnauthenticatedError,
    UnknownError,
    ValidationError,
  }
)
