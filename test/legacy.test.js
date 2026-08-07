'use strict';

// Legacy-format behavior. setLegacyErrorFormat() flips global, non-resettable
// module state, so these tests live in their own file (node:test isolates
// files into separate processes).

const { test } = require('node:test');
const assert = require('node:assert');
const sendResponse = require('../dist/sendresponse.js');
const sr = sendResponse.default;

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

sr.setLegacyErrorFormat();

test('legacy: 404 NotFound is sent in legacy shape', async () => {
  const res = mockRes();
  sr(res, Promise.resolve(null));
  await settled();
  assert.strictEqual(res.statusCode, 404);
  assert.deepStrictEqual(res.body, { type: 'NotFound', data: ['NotFound'], code: 404 });
});

test('legacy: rejected AppError is legacy-converted (data includes payload when present)', async () => {
  const console_ = silenceConsole();
  try {
    const res = mockRes();
    sr(res, Promise.reject(new sr.ValidationError('bad field', 400, { field: 'email' })));
    await settled();
    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(res.body, {
      type: 'ValidationError',
      data: ['bad field', { field: 'email' }],
      code: 400,
    });
  } finally {
    console_.restore();
  }
});

test('legacy: non-Error rejection produces legacy-shaped InternalServerError', async () => {
  const console_ = silenceConsole();
  try {
    const res = mockRes();
    sr(res, Promise.reject(42));
    await settled();
    assert.strictEqual(res.statusCode, 500);
    assert.deepStrictEqual(res.body, {
      type: 'InternalServerError',
      data: ['Internal Server Error'],
      code: 500,
    });
  } finally {
    console_.restore();
  }
});

test('legacy: translator results are NOT legacy-converted (sent raw)', async () => {
  const console_ = silenceConsole();
  try {
    sr.registerTranslator((err) =>
      err.name === 'MongoError'
        ? { result: { type: 'DuplicateKey', data: [], code: 409 }, code: 409 }
        : null,
    );
    const err = new Error('dup');
    err.name = 'MongoError';
    const res = mockRes();
    sr(res, Promise.reject(err));
    await settled();
    assert.strictEqual(res.statusCode, 409);
    assert.deepStrictEqual(res.body, {
      result: { type: 'DuplicateKey', data: [], code: 409 },
      code: 409,
    });
  } finally {
    console_.restore();
  }
});
