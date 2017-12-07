var _ = require('lodash/core');
var os = require('os');
var request = require('requestretry');
var util = require('util');
var BuzzAPIError = require('./buzzApiError');

// Enable cookies
request = request.defaults({jar: true});

var options = {};
var server = 'https://api.gatech.edu';

var BuzzAPI = function(config) {
    options.api_app_id = config.apiUser;
    options.api_app_password = new Buffer(config.apiPassword).toString('base64');
    options.api_request_mode = config.sync ? 'sync' : 'async';
    options.api_receive_timeout = config.api_receive_timeout || 900000;
    server = config.server || server;
};

var openReqs = 0;
var queuedReqs = [];

BuzzAPI.prototype.post = function(resource, operation, data, callback) {
    if (openReqs >= 20) {
        queuedReqs.push(arguments);
    } else {
        doPost(resource, operation, data, callback);
    }
    return;
};

var doPost = function(resource, operation, data, callback) {
    openReqs++;
    if (_.isFunction(data)) {
        callback = data;
        data = {};
    }
    var myOpts = {};
    myOpts.url = util.format('%s/apiv3/%s/%s', server, resource, operation);
    data.handle = data.handle || util.format('from-%d@%s-rand%d', process.pid, os.hostname(), Math.floor(Math.random() * 32768));
    myOpts.body = _.extend(data, options);
    myOpts.json = true;
    request.post(myOpts, function(err, res, body) {
        if (err || body.api_error_info) {
            if (body) {
                return callback(new BuzzAPIError(err, body.api_error_info, body), null, body);
            } else {
                return callback(err);
            }
        } else if (options.api_request_mode === 'sync') {
            return callback(null, body.api_result_data, body);
        } else {
            return getResult(body.api_result_data, body.api_app_ticket, callback);
        }
    });
};

var resolve = function(messageId) {
    openReqs--;
    if (queuedReqs[0]) {
        doPost.apply(null, queuedReqs.pop());
    }
};

var getResult = function(messageId, ticket, initTime, callback) {
    if (_.isFunction(initTime)) {
        callback = initTime;
        initTime = new Date();
    } else if (new Date() - initTime > options.api_receive_timeout){
        resolve(messageId);
        return callback(new Error('Request timed out for: ' + messageId));
    }
    request({
        'url': util.format('%s/apiv3/api.my_messages', server),
        'qs': {
            'api_app_ticket': ticket,
            'api_pull_response_to': messageId,
            'api_receive_timeout': 5000
        },
        'json': true
    }, function(err, res, body) {
        if (err || body.api_error_info || (body.api_result_data && body.api_result_data.api_error_info)) {
            if (! body) {
                resolve(messageId);
                return callback(new BuzzAPIError(err));
            }
            if (body.api_error_info) {
                resolve(messageId);
                return callback(new BuzzAPIError('BuzzApi returned error_info', body.api_error_info, body));
            } else if (body.api_result_data) {
                resolve(messageId);
                return callback(new BuzzAPIError('BuzzApi returned error_info', body.api_result_data.api_error_info, body));
            } else {
                resolve(messageId);
                return callback(new BuzzAPIError(err, body, body));
            }
        } else if (_.isEmpty(body.api_result_data)) {
            // Empty result_data here means our data isn't ready, wait 1 to 5 seconds and try again
            return setTimeout(function() {
                return getResult(messageId, body.api_app_ticket, initTime, callback);
            }, Math.floor(Math.random() * (5000 - 1000) + 1000));
        } else if (!body.api_result_data.api_result_data) {
            resolve(messageId);
            return callback(new BuzzAPIError('BuzzAPI returned an empty result, this usually means it timed out requesting a resource', {}, body));
        } else {
            resolve(messageId);
            return callback(null, body.api_result_data.api_result_data, body);
        }
    });
};

module.exports = BuzzAPI;
