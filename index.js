var Q = require('q');
var AppError = require('apperror');

var Promisify = Q;

module.exports = sendResponse;

var verboseConsoleErrors = false;
var errorTranslators = [];

function sendErrorResponse(err, res) {
    var obj;
    if (err instanceof AppError) {
        err.log();
        return res.send(err.code, err);
    } else if (err.toResponseObject) {
        obj = err.toResponseObject();
    } else {
        try {
            for (var i = 0; i < errorTranslators.length; ++i) {
                obj = errorTranslators[i](err);
                if (obj) { break; }
            }
        } catch(err2) {
            console.warn("Error trying to handle error with error translator: ", err2, err2.stack);
        }
    }

    if (!obj) {
        if (verboseConsoleErrors) {
            console.error("Unknown error!", err, err.stack);
        }
        obj = new sendResponse.UnknownError(err.toString());
    }
    console.log("Error response: ", obj);
    res.json(obj, obj.code || 500);
    res.send(obj.code || 500, obj);
}

function sendResponse(res, promise, code) {
    if (!res.json) {
        throw new Error("First parameter must be the response object!");
    }
    var responseStack = new Error().stack;
    var out = Promisify(promise).then(function(result) {
        if(result instanceof Error) {
            sendErrorResponse(result, res);
        } else if (result || result === '') {
            res.send(code || 200, result);
        } else {
            res.send(404, sendResponse.NotFound);
        }
    }, function(err) {
        var merr = null, json = null;
        // ForbiddenError and UnauthenticatedError are used to distinguish between
        // 403's as a result of being not authorized vs. not authenticated
        if(err instanceof Error) {
            sendErrorResponse(err, res);
            if (verboseConsoleErrors) {
                console.error("sendResponse called with error:", err, err.stack);
                console.trace();
                console.error("sendresponse stack: ", responseStack);
            }
        } else {
            console.error("Internal Server Error -- Promise reject with: ", err);
            console.trace();
            console.error("sendresponse stack: ", responseStack);
            var obj = {"type":"InternalServerError","data":[],"code":500};
            res.json(obj, 500);
            res.send(500, new sendResponse.InternalServerError());
        }
    });
    if (out.done) { out.done(); }
}

sendResponse.middleware = function(req, res, next) {
    res.sendResponse = sendResponse.bind(sendResponse, res);
    next();
};
sendResponse.registerTranslator = function(fn) {
    errorTranslators.push(fn);
};
sendResponse.setVerboseLogs = function() { verboseConsoleErrors = true; };
sendResponse.setPromiseFactory = function(fn) {
    // This should be a function which accepts a value which may or may not be
    // a Promises/A+ object and returns a Promises/A+ object.  If the return object
    // has a done() method that will be invoked with no parameters at the end; Q and Bluebird
    // both support this as a way to ensure that there are no swallowed uncaught exceptions
    Promisify = fn;
};

// ForbiddenError and UnauthenticatedError are used to distinguish between
// 403's as a result of being not authorized vs. not authenticated
sendResponse.UnauthenticatedError = AppError.createCustom(
    'UnauthenticatedError', {msg: 'Authentication Required', code: 403, captureStack: false}
);
sendResponse.ForbiddenError = AppError.createCustom(
    'ForbiddenError', {msg: 'Forbidden', code: 403, captureStack: false}
);
sendResponse.ValidationError = AppError.createCustom(
    'ValidationError', {msg: 'ValidationError', code: 400, captureStack: false}
);
sendResponse.UnknownError = AppError.createCustom(
    'UnknownError', {msg: 'Unknown Error'}
);
sendResponse.InternalServerError = AppError.createCustom(
    'InternalServerError', {msg: 'Internal Server Error'}
);

// Export an instance of an object which represents NotFound
sendResponse.NotFound = new (AppError.createCustom(
    'NotFound', {msg: 'NotFound', code: 404, captureStack: false}
))();
sendResponse.createCustomError = AppError.createCustom;
