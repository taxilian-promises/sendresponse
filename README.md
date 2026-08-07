# sendresponse

Promise-capable response handling for Express. Hand `sendResponse` a promise, and it
maps the outcome to the right HTTP response: success payloads, 404s, typed application
errors, and unexpected failures all serialize consistently.

## Install

```bash
npm install sendresponse
```

Requires Node.js 18+ and Express 4 or 5 (peer dependency).

## Quickstart

Attach the middleware, then hand route handlers a promise:

```js
const express = require('express');
const sendResponse = require('sendresponse');

const app = express();
app.use(sendResponse.middleware);

app.get('/users/:id', (req, res) => {
  res.sendResponse(userService.getUser(req.params.id));
});

app.post('/users', (req, res) => {
  res.sendResponse(userService.createUser(req.body), 201);
});
```

Verify it works: `GET /users/123` returns the user JSON with status 200, and
`GET /users/999` (no such user, promise resolves `null`) returns
`{"type":"NotFound","message":"NotFound","data":"","code":404}` with status 404.

You can also call `sendResponse(res, promise, code?)` directly without the middleware.

## How outcomes map to responses

| Promise outcome | Response |
|---|---|
| Resolves with a value | `code` argument or 200; body is the value |
| Resolves with `null` or `undefined` | 404 with the `NotFound` error |
| Resolves or rejects with an `AppError` | Error's `code`; body is `err.toJSON()` |
| Rejects with any other `Error` | Passed through registered translators; falls back to 500 `UnknownError` |
| Rejects with a non-`Error` value | 500 `InternalServerError` |

Errors serialize as JSON:

```json
{ "type": "ValidationError", "message": "Email is required", "data": "", "code": 400 }
```

An `AppError` rejected (or resolved) directly is logged once to the console when sent
(body plus stack). Pass `logError: false` when creating an error to suppress this. Errors
produced by translators follow the translator rules above instead.

## Built-in errors

| Export | Status | Notes |
|---|---|---|
| `ValidationError` | 400 | Input validation failures |
| `InvalidRequestError` | 400 | Malformed requests |
| `UnauthenticatedError` | 403 | No valid credentials (login required) |
| `ForbiddenError` | 403 | Authenticated but not allowed |
| `NotFound` | 404 | An instance, not a class — sent directly |
| `UnknownError` | 500 | Fallback for untranslated errors |
| `InternalServerError` | 500 | Non-`Error` rejections |

Use them by rejecting (or resolving) with an instance:

```js
const { ValidationError, ForbiddenError } = require('sendresponse');

app.delete('/users/:id', (req, res) => {
  res.sendResponse(deleteUser(req.params.id, req.user));
});

async function deleteUser(id, user) {
  if (!user.isAdmin) throw new ForbiddenError();
  const deleted = await db.deleteUser(id); // returns null if missing -> 404
  return deleted;
}
```

`UnauthenticatedError` and `ForbiddenError` are both 403 so you can distinguish
"not logged in" from "not allowed" by error type. Control-flow errors like these are
created with `captureStack: false`, so they skip stack capture.

## Custom errors

Create your own error classes with `createCustomError`:

```js
const { createCustomError } = require('sendresponse');

const PaymentRequiredError = createCustomError('PaymentRequiredError', {
  msg: 'Payment required',
  code: 402,
});

throw new PaymentRequiredError();
throw new PaymentRequiredError('Card declined');                    // message override
throw new PaymentRequiredError({ message: 'Card declined', data: { reason: 'fraud' } });
```

The constructor accepts a message string, or an options object with `message` (or `msg`),
`code` (or `status`/`statusCode`), `data`, `captureStack`, and `logError`. Defaults passed
to `createCustomError` apply to every instance; constructor arguments override them.
Put any extra payload in `data` — it's included in the serialized response.

## Custom translators

Translators convert third-party errors (ORM errors, HTTP client errors) into `AppError`s
so they serialize consistently. Register them with `registerTranslator`:

```js
const { registerTranslator, ValidationError } = require('sendresponse');

registerTranslator((err) => {
  // Mongoose-style validation error
  if (err.name === 'ValidationError' && err.errors) {
    return new ValidationError('Invalid document', 400, err.errors);
  }
  // Return undefined/null to pass to the next translator
});
```

Translators run in registration order; the first one to return a truthy value wins. Return
anything falsy (`null`, `undefined`, `false`) to pass to the next translator. A translator
result is sent as-is: a numeric `code` property becomes the HTTP status (default 500), and
the value itself becomes the response body — results are not legacy-converted by
`setLegacyErrorFormat()` and are not logged by `setVerboseLogs()`. If no translator matches,
sendresponse sends a 500 `UnknownError`. If a translator throws, sendresponse logs the
failure and skips the remaining translators.

## Configuration

| Function | Effect |
|---|---|
| `setVerboseLogs()` | Log every error (with stacks) to the console |
| `setLegacyErrorFormat()` | Send errors as `{ type, data: [message, data?], code }` instead of the default shape |

Call these once at startup, before mounting routes.

## TypeScript

Types are bundled. The response object is typed structurally (`status`, `send`, `json`),
so `app.use(sendResponse.middleware)` typechecks against Express 4 and 5 without any
Express dependency. Inside typed Express handlers, `res.sendResponse` isn't visible on
the `express.Response` type yet — call `sendResponse(res, promise)` directly, or cast
once through a small helper in your app.

## API summary

| Export | Kind | Purpose |
|---|---|---|
| `sendResponse(res, promise, code?)` | function (default) | Send a promise's outcome as an HTTP response |
| `middleware` | function | Express middleware that adds `res.sendResponse` |
| `registerTranslator(fn)` | function | Add an error translator |
| `setVerboseLogs()` | function | Enable console error logging |
| `setLegacyErrorFormat()` | function | Use the legacy error body shape |
| `createCustomError(name, defaults)` | function | Create a custom `AppError` subclass |
| `AppError` | class (via `sendresponse/dist/apperror.js`) | Base error class |
| Error classes above | class / instance | Built-in HTTP errors |
