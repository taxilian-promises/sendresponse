// Type-level regression fixture for the 2.0.1 bug: the runtime has accepted
// structural translator results since 1.x; these patterns must compile.
// Checked via `tsc -p test/fixtures/tsconfig.json` (noEmit) as part of npm test.

import sendResponse, {
  registerTranslator,
  ValidationError,
  createCustomError,
} from 'sendresponse';

// The exact 2.0.1 regression shape: { result: {...}, code } wrapper (mongo_error_translate)
registerTranslator((err) =>
  err.name === 'MongoError'
    ? { result: { type: 'DuplicateKey', data: [{ op: 'INSERT' }], code: 409 }, code: 409 }
    : null,
);

// Plain object with extra properties beyond code
registerTranslator((err) =>
  err.name === 'ZodError' ? { code: 422, message: 'Validation failed', issues: [] } : undefined,
);

// AppError instance return
registerTranslator((err) => (err.message === 'bad' ? new ValidationError('bad') : null));

// createCustomError instance return
const PaymentError = createCustomError('PaymentError', { code: 402 });
registerTranslator((err) => (err.name === 'StripeError' ? new PaymentError() : undefined));

// Foreign error class that does not extend AppError
class DomainError extends Error {
  code = 409;
}
registerTranslator((err) => (err.name === 'Conflict' ? new DomainError() : undefined));

// && short-circuit idiom: false is a valid "no match" signal
registerTranslator((err) => err.name === 'AxiosError' && { code: 502, message: err.message });

// Core call sites still typecheck with strict flags
declare const res: Parameters<typeof sendResponse>[0];
sendResponse(res, Promise.resolve({ ok: true }), 200);
sendResponse(res, 'plain value');
