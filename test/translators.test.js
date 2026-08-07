'use strict';

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

test('structural translator result {result, code}: status from code, body sent raw', async () => {
  const console_ = silenceConsole();
  try {
    sr.registerTranslator((err) =>
      err.name === 'MongoError'
        ? { result: { type: 'DuplicateKey', data: [{ op: 'INSERT' }], code: 409 }, code: 409 }
        : null,
    );
    const err = new Error('dup');
    err.name = 'MongoError';
    const res = mockRes();
    sr(res, Promise.reject(err));
    await settled();
    assert.strictEqual(res.statusCode, 409);
    // Byte-compared: the exact object is the body, no wrapping or conversion
    assert.strictEqual(
      JSON.stringify(res.body),
      JSON.stringify({ result: { type: 'DuplicateKey', data: [{ op: 'INSERT' }], code: 409 }, code: 409 }),
    );
  } finally {
    console_.restore();
  }
});

test('falsy translator results (null, undefined, false, 0, "") pass to the next translator', async () => {
  const console_ = silenceConsole();
  try {
    for (const falsy of [null, undefined, false, 0, '']) {
      sr.registerTranslator(() => falsy);
    }
    sr.registerTranslator((err) =>
      err.name === 'Target' ? { code: 418, type: 'Teapot' } : null,
    );
    const err = new Error('hit');
    err.name = 'Target';
    const res = mockRes();
    sr(res, Promise.reject(err));
    await settled();
    assert.strictEqual(res.statusCode, 418);
    assert.deepStrictEqual(res.body, { code: 418, type: 'Teapot' });
  } finally {
    console_.restore();
  }
});

test('first truthy translator wins; later translators are not consulted', async () => {
  const console_ = silenceConsole();
  try {
    let secondRan = false;
    sr.registerTranslator((err) =>
      err.name === 'FirstWins' ? { code: 400, which: 'first' } : null,
    );
    sr.registerTranslator((err) => {
      if (err.name === 'FirstWins') {
        secondRan = true;
        return { code: 500, which: 'second' };
      }
      return null;
    });
    const err = new Error('x');
    err.name = 'FirstWins';
    const res = mockRes();
    sr(res, Promise.reject(err));
    await settled();
    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(res.body, { code: 400, which: 'first' });
    assert.strictEqual(secondRan, false);
  } finally {
    console_.restore();
  }
});

test('&& short-circuit idiom: false on no-match, object on match', async () => {
  const console_ = silenceConsole();
  try {
    sr.registerTranslator((err) => err.name === 'AxiosError' && { code: 502, message: err.message });
    const miss = new Error('miss');
    miss.name = 'NoMatchHere';
    const res1 = mockRes();
    sr(res1, Promise.reject(miss));
    await settled();
    assert.strictEqual(res1.statusCode, 500);
    assert.strictEqual(res1.body.name, 'UnknownError');

    const hit = new Error('gateway');
    hit.name = 'AxiosError';
    const res2 = mockRes();
    sr(res2, Promise.reject(hit));
    await settled();
    assert.strictEqual(res2.statusCode, 502);
    assert.deepStrictEqual(res2.body, { code: 502, message: 'gateway' });
  } finally {
    console_.restore();
  }
});

test('no translator match: 500 UnknownError fallback', async () => {
  const console_ = silenceConsole();
  try {
    const res = mockRes();
    sr(res, Promise.reject(new Error('mystery')));
    await settled();
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.body.name, 'UnknownError');
  } finally {
    console_.restore();
  }
});

test('a throwing translator is logged and the chain falls back to UnknownError', async () => {
  const console_ = silenceConsole();
  try {
    sr.registerTranslator((err) => {
      if (err.name === 'Boom') {
        throw new Error('translator exploded');
      }
      return null;
    });
    const err = new Error('x');
    err.name = 'Boom';
    const res = mockRes();
    sr(res, Promise.reject(err));
    await settled();
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.body.name, 'UnknownError');
    const warnFlat = console_.calls.warn.flat().join(' ');
    assert(/error translator/.test(warnFlat));
  } finally {
    console_.restore();
  }
});

test('translator returning an AppError: sent raw, no log(), no legacy conversion', async () => {
  const console_ = silenceConsole();
  try {
    sr.registerTranslator((err) =>
      err.name === 'NeedsValidation' ? new sr.ValidationError('from translator') : null,
    );
    const err = new Error('x');
    err.name = 'NeedsValidation';
    const res = mockRes();
    sr(res, Promise.reject(err));
    await settled();
    assert.strictEqual(res.statusCode, 400);
    assert(res.body instanceof sr.ValidationError);
    // Documented 2.0 contract: translator results bypass AppError.log()
    assert.strictEqual(console_.calls.error.length, 0);
  } finally {
    console_.restore();
  }
});

test('truthy primitive translator result: 500 with the primitive as body', async () => {
  const console_ = silenceConsole();
  try {
    sr.registerTranslator((err) => (err.name === 'Prim' ? 'plain body' : null));
    const err = new Error('x');
    err.name = 'Prim';
    const res = mockRes();
    sr(res, Promise.reject(err));
    await settled();
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.body, 'plain body');
  } finally {
    console_.restore();
  }
});
