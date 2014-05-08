var Q = require('Q');
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
        for (var i = 0; i < errorTranslators; ++i) {
            obj = errorTranslators(err);
            if (obj) { break; }
        }
    }

    if (!obj) {
        if (verboseConsoleErrors) {
            console.error("Unknown error!", err);
        }
        obj = {"type":"UnknownError","data":[err.toString()],"code":500};
    }
    json = JSON.stringify(obj);
    res.send(json, obj.code || 500);

    /*
     *else if(err.hasOwnProperty('name') && (err.name === 'MongoError' ||
     *                                         err.name === 'ValidationError' || err.name === 'CastError')) {
     *    var merr = mongoError(err);
     *    res.send(JSON.stringify(merr.result), merr.code);
     *} else {
     *    console.log("Unknown error!", err);
     *    json = JSON.stringify();
     *    res.send(json, 500);
     *}
     */
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
            var json = JSON.stringify({"type":"ObjectNotFound","data":[],"code":404});
            res.send(json, 404);
        }
    }, function(err) {
        var merr = null, json = null;
        // ForbiddenError and UnauthenticatedError are used to distinguish between
        // 403's as a result of being not authorized vs. not authenticated
        if(err instanceof Error) {
            sendErrorResponse(err, res);
        } else {
            console.error("Internal Server Error -- Promise reject with: ");
            arguments.forEach(function(a) {
                console.log(a);
            });
            console.trace();
            console.error("sendresponse stack: ", responseStack);
            json = JSON.stringify({"type":"InternalServerError","data":[],"code":500});
            res.send(json, 500);
        }
    });
}

sendResponse.middleware = function(req, res, next) {
    res.sendResponse = sendResponse.bind(sendResponse, res);
};
sendResponse.registerTranslator = function(fn) {
    errorTranslators.push(fn);
};
sendResponse.setVerboseLogs = function() { verboseConsoleErrors = true; };

sendResponse.UnauthenticatedError = UnauthenticatedError;
sendResponse.ForbiddenError = ForbiddenError;
sendResponse.ValidationError = ValidationError;

module.exports = sendResponse;
