'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const sendResponse = require('../dist/sendresponse.js');
const sr = sendResponse.default;
const { AppError } = require('../dist/apperror.js');

// Minimal express-like response double. sendresponse only requires
// status()/send()/json() structurally.
function mockRes() {
  const res = {
    json: (b) => b,
    send: (b) => {
      res.body = b;
      return res;
    },
    status: (c) => {
      res.statusCode = c;
      return res;
    },
  };
  return res;
}

// sendResponse settles asynchronously; give the promise chain a tick.
function settled() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

function silenceConsole() {
  const orig = { error: console.error, warn: console.warn, trace: console.trace };
  const calls = { error: [], warn: [], trace: [] };
  console.error = (...a) => calls.error.push(a);
  console.warn = (...a) => calls.warn.push(a);
  console.trace = (...a) => calls.trace.push(a);
  return {
    calls,
    restore() {
      console.error = orig.error;
      console.warn = orig.warn;
      console.trace = orig.trace;
    },
  };
}

test('resolves with a value: 200 default status, value as body', async () => {
  const res = mockRes();
  sr(res, Promise.resolve({ ok: true }));
  await settled();
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { ok: true });
});

test('resolves with a value: custom status code honored', async () => {
  const res = mockRes();
  sr(res, Promise.resolve({ id: 1 }), 201);
  await settled();
  assert.strictEqual(res.statusCode, 201);
  assert.deepStrictEqual(res.body, { id: 1 });
});

test('accepts a plain (non-promise) value', async () => {
  const res = mockRes();
  sr(res, 'direct');
  await settled();
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body, 'direct');
});

test('accepts any thenable directly', async () => {
  const res = mockRes();
  sr(res, { then: (f) => f('thenable-value') });
  await settled();
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body, 'thenable-value');
});

test('resolves null: 404 with the NotFound instance', async () => {
  const res = mockRes();
  sr(res, Promise.resolve(null));
  await settled();
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(res.body, sr.NotFound);
  assert.deepStrictEqual(res.body.toJSON(), {
    type: 'NotFound',
    message: 'NotFound',
    data: '',
    code: 404,
  });
});

test('resolves undefined: 404', async () => {
  const res = mockRes();
  sr(res, Promise.resolve(undefined));
  await settled();
  assert.strictEqual(res.statusCode, 404);
  assert.strictEqual(res.body, sr.NotFound);
});

test('rejects with AppError: status from code, body is the error (serialized via toJSON)', async () => {
  const console_ = silenceConsole();
  try {
    const res = mockRes();
    sr(res, Promise.reject(new sr.ValidationError('Email is required')));
    await settled();
    assert.strictEqual(res.statusCode, 400);
    assert(res.body instanceof AppError);
    assert.strictEqual(res.body.name, 'ValidationError');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(res.body)), {
      type: 'ValidationError',
      message: 'Email is required',
      data: '',
      code: 400,
    });
  } finally {
    console_.restore();
  }
});

test('rejects with AppError: log() called exactly once (logError default)', async () => {
  const console_ = silenceConsole();
  try {
    const res = mockRes();
    // captureStack: false (ValidationError default) => exactly one call (body, no stack)
    sr(res, Promise.reject(new sr.ValidationError('once')));
    await settled();
    assert.strictEqual(console_.calls.error.length, 1);
    assert.deepStrictEqual(console_.calls.error[0][0], {
      type: 'ValidationError',
      message: 'once',
      data: '',
      code: 400,
    });
  } finally {
    console_.restore();
  }
});

test('AppError with logError: false is not logged', async () => {
  const console_ = silenceConsole();
  try {
    const res = mockRes();
    const Quiet = sr.createCustomError('QuietError', { code: 400, logError: false });
    sr(res, Promise.reject(new Quiet('hush')));
    await settled();
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(console_.calls.error.length, 0);
  } finally {
    console_.restore();
  }
});

test('resolves with an Error: handled as an error response, not a 200', async () => {
  const console_ = silenceConsole();
  try {
    const res = mockRes();
    sr(res, Promise.resolve(new sr.ForbiddenError()));
    await settled();
    assert.strictEqual(res.statusCode, 403);
    assert(res.body instanceof AppError);
    assert.strictEqual(res.body.name, 'ForbiddenError');
  } finally {
    console_.restore();
  }
});

test('rejects with non-Error value: 500 InternalServerError', async () => {
  const console_ = silenceConsole();
  try {
    const res = mockRes();
    sr(res, Promise.reject('string failure'));
    await settled();
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.body.name, 'InternalServerError');
  } finally {
    console_.restore();
  }
});

test('rejects with error exposing toResponseObject(): sent with its code', async () => {
  const console_ = silenceConsole();
  try {
    const res = mockRes();
    const duck = new Error('duck');
    duck.toResponseObject = () => ({ code: 422, type: 'Duck', message: 'quack' });
    sr(res, Promise.reject(duck));
    await settled();
    assert.strictEqual(res.statusCode, 422);
    assert.deepStrictEqual(res.body, { code: 422, type: 'Duck', message: 'quack' });
  } finally {
    console_.restore();
  }
});

test('throws synchronously when res is not a response object', () => {
  assert.throws(() => sr({}, Promise.resolve(1)), /First parameter must be the response object/);
});

test('middleware attaches res.sendResponse and calls next', () => {
  const res = mockRes();
  let nextCalled = false;
  sr.middleware({}, res, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(typeof res.sendResponse, 'function');
});

test('middleware-attached sendResponse behaves like the export', async () => {
  const console_ = silenceConsole();
  try {
    const res = mockRes();
    sr.middleware({}, res, () => {});
    res.sendResponse(Promise.resolve({ via: 'middleware' }), 202);
    await settled();
    assert.strictEqual(res.statusCode, 202);
    assert.deepStrictEqual(res.body, { via: 'middleware' });
  } finally {
    console_.restore();
  }
});

test('default export carries the full helper surface', () => {
  assert.strictEqual(typeof sr, 'function');
  for (const key of [
    'createCustomError',
    'ForbiddenError',
    'InternalServerError',
    'InvalidRequestError',
    'middleware',
    'NotFound',
    'registerTranslator',
    'setLegacyErrorFormat',
    'setVerboseLogs',
    'UnauthenticatedError',
    'UnknownError',
    'ValidationError',
  ]) {
    assert(key in sr, `default export missing ${key}`);
  }
});

test('built-in error classes carry documented codes and names', () => {
  assert.strictEqual(new sr.UnauthenticatedError().code, 403);
  assert.strictEqual(new sr.UnauthenticatedError().name, 'UnauthenticatedError');
  assert.strictEqual(new sr.ForbiddenError().code, 403);
  assert.strictEqual(new sr.ValidationError().code, 400);
  assert.strictEqual(new sr.InvalidRequestError().code, 400);
  assert.strictEqual(new sr.UnknownError().code, 500);
  assert.strictEqual(new sr.InternalServerError().code, 500);
  assert(sr.NotFound instanceof AppError);
  assert(sr.NotFound instanceof Error);
  assert.strictEqual(sr.NotFound.code, 404);
  assert.strictEqual(sr.NotFound.statusCode, 404);
});

test('control-flow errors skip stack capture (captureStack: false)', () => {
  assert.strictEqual(sr.NotFound.stack, undefined);
  assert.strictEqual(new sr.ValidationError('x').stack, undefined);
  assert.strictEqual(typeof new sr.UnknownError().stack, 'string');
});

test('createCustomError: defaults apply, constructor args override', () => {
  const PaymentError = sr.createCustomError('PaymentError', { msg: 'Payment required', code: 402 });
  const dflt = new PaymentError();
  assert.strictEqual(dflt.name, 'PaymentError');
  assert.strictEqual(dflt.message, 'Payment required');
  assert.strictEqual(dflt.code, 402);
  assert(dflt instanceof AppError);

  const str = new PaymentError('Card declined');
  assert.strictEqual(str.message, 'Card declined');
  assert.strictEqual(str.code, 402);

  const full = new PaymentError('Card declined', 422, { reason: 'fraud' });
  assert.strictEqual(full.code, 422);
  assert.deepStrictEqual(full.data, { reason: 'fraud' });

  const obj = new PaymentError({ message: 'obj', statusCode: 418 });
  assert.strictEqual(obj.message, 'obj');
  assert.strictEqual(obj.code, 418);
});

test('AppError string constructor and 500 default', () => {
  const e = new AppError('boom');
  assert.strictEqual(e.message, 'boom');
  assert.strictEqual(e.code, 500);
  assert.strictEqual(e.name, 'AppError');
  assert.strictEqual(e.isAppError, true);
});

test('setVerboseLogs logs rejected errors with stacks', async () => {
  const console_ = silenceConsole();
  try {
    sr.setVerboseLogs();
    const res = mockRes();
    sr(res, Promise.reject(new sr.UnknownError('noisy')));
    await settled();
    assert.strictEqual(res.statusCode, 500);
    const flat = console_.calls.error.flat().join(' ');
    assert(/sendResponse called with error/.test(flat));
  } finally {
    console_.restore();
  }
});
