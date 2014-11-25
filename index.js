var Q = require('q');
Q.longStackSupport = true;

function UnauthenticatedError(message) {
    this.message = message;
}
UnauthenticatedError.prototype = new Error();
UnauthenticatedError.prototype.constructor = UnauthenticatedError;
UnauthenticatedError.prototype.name = 'UnauthenticatedError';
UnauthenticatedError.prototype.toString = function() { return this.message; };
UnauthenticatedError.prototype.toResponseObject = function() {
    return {"type":"UnauthenticatedError","data":[this.toString()], "code": 403};
};

function ForbiddenError(message) {
    this.message = message;
}
ForbiddenError.prototype = new Error();
ForbiddenError.prototype.constructor = ForbiddenError;
ForbiddenError.prototype.name = 'ForbiddenError';
ForbiddenError.prototype.toString = function() { return this.message; };
ForbiddenError.prototype.toResponseObject = function() {
    return {"type":"ForbiddenError","data":[this.toString()], "code": 403};
};

function ValidationError(message) {
    this.message = message;
}
ValidationError.prototype = new Error();
ValidationError.prototype.constructor = ValidationError;
ValidationError.prototype.name = 'ValidationError';
ValidationError.prototype.toString = function() { return this.message; };
ValidationError.prototype.toResponseObject = function() {
    return {"type":"ValidationError","data":[this.toString()], "code": 400};
};

var verboseConsoleErrors = false;
var errorTranslators = [];

function sendErrorResponse(err, res) {
    var json, obj;
    if (err.toResponseObject) {
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
        obj = {"type":"UnknownError","data":[err.toString()],"code":500};
    }
    console.log("Error response: ", obj);
    res.json(obj, obj.code || 500);
}

function sendResponse(res, promise, code) {
    if (!res.json) {
        throw new Error("First parameter must be the response object!");
    }
    var responseStack = new Error().stack;
    Q.when(promise).then(function(result) {
        if(result instanceof Error) {
            sendErrorResponse(result, res);
        } else if(result) {
            res.json(result, code || 200);
        } else {
            var obj = {"type":"ObjectNotFound","data":[],"code":404};
            res.json(obj, 404);
        }
    }, function(err) {
        var merr = null, json = null;
        // ForbiddenError and UnauthenticatedError are used to distinguish between
        // 403's as a result of being not authorized vs. not authenticated
        if(err instanceof Error) {
            sendErrorResponse(err, res);
        } else {
            console.error("Internal Server Error -- Promise reject with: ");
            Array.prototype.forEach.call(arguments, function(a) {
                console.log(a);
            });
            console.trace();
            console.error("sendresponse stack: ", responseStack);
            var obj = {"type":"InternalServerError","data":[],"code":500};
            res.json(obj, 500);
        }
    });
}

sendResponse.middleware = function(req, res, next) {
    res.sendResponse = sendResponse.bind(sendResponse, res);
    next();
};
sendResponse.registerTranslator = function(fn) {
    errorTranslators.push(fn);
};
sendResponse.setVerboseLogs = function() { verboseConsoleErrors = true; };

sendResponse.UnauthenticatedError = UnauthenticatedError;
sendResponse.ForbiddenError = ForbiddenError;
sendResponse.ValidationError = ValidationError;

module.exports = sendResponse;
