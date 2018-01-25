var _ = require('lodash/core');
var debug = require('debug')('buzzapi');
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
        return new Promise((res, rej) => {
            queuedReqs.push({'args': arguments, 'res': res, 'rej': rej});
        });
    } else {
        return doPost(resource, operation, data, callback);
    }
    return;
};

var doPost = function(resource, operation, data, callback) {
    return new Promise((res, rej) => {
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
        debug('Requesting %s', JSON.stringify(myOpts));
        request.post(myOpts, function(err, response, body) {
            if (err || body.api_error_info) {
                if (body) {
                    let error = new BuzzAPIError(err, body.api_error_info, body);
                    return callback ? callback(error, null, body) : rej(error);
                } else {
                    return callback ? callback(err) : rej(err);
                }
            } else if (options.api_request_mode === 'sync') {
                return callback ? callback(null, body.api_result_data, body) : res(body.api_result_data);
            } else {
                debug('Got messageId: %s', body.api_result_data);
                return res(getResult(body.api_result_data, body.api_app_ticket, callback));
            }
        });
    });
};

var resolve = function(messageId) {
    openReqs--;
    debug('queued: %s  open: %s', queuedReqs.length, openReqs);
    if (queuedReqs[0]) {
        let next = queuedReqs.pop();
        return doPost.apply(null, next.args).then((result) => { next.res(result); }).catch((err) => { next.rej(err); });
    }
};

var getResult = function(messageId, ticket, initTime, callback) {
    return new Promise((res, rej) => {
        if (_.isFunction(initTime) || initTime === undefined) {
            callback = initTime;
            initTime = new Date();
        } else if (new Date() - initTime > options.api_receive_timeout){
            resolve(messageId);
            let err = new Error('Request timed out for: ' + messageId);
            return callback ? callback(err) : rej(err);
        }
        debug('Asking for result of %s', messageId);
        request({
            'url': util.format('%s/apiv3/api.my_messages', server),
            'qs': {
                'api_app_ticket': ticket,
                'api_pull_response_to': messageId,
                'api_receive_timeout': 5000
            },
            'json': true
        }, function(err, response, body) {
            if (response && response.attempts && response.attempts > 1) { debug('Request took multiple attempts %s', response.attempts); }
            if (err || body.api_error_info || (body.api_result_data && body.api_result_data.api_error_info)) {
                if (! body) {
                    resolve(messageId);
                    return callback ? callback(new BuzzAPIError(err)) : rej(new BuzzAPIError(err));
                }
                if (body.api_error_info) {
                    resolve(messageId);
                    let err = new BuzzAPIError('BuzzApi returned error_info', body.api_error_info, body);
                    return callback ? callback(err) : rej(err);
                } else if (body.api_result_data) {
                    resolve(messageId);
                    let err = new BuzzAPIError('BuzzApi returned error_info', body.api_result_data.api_error_info, body);
                    return callback ? callback(err) : rej(err);
                } else {
                    resolve(messageId);
                    let error = new BuzzAPIError(err, body, body);
                    return callback ? callback(error) : rej(error);
                }
            } else if (_.isEmpty(body.api_result_data)) {
                // Empty result_data here means our data isn't ready, wait 1 to 5 seconds and try again
                return setTimeout(function() {
                    return getResult(messageId, body.api_app_ticket, initTime, callback);
                }, Math.floor(Math.random() * (5000 - 1000) + 1000));
            } else if (!body.api_result_data.api_result_data) {
                resolve(messageId);
                let err = new BuzzAPIError('BuzzAPI returned an empty result, this usually means it timed out requesting a resource', {}, body);
                return callback ? callback(err) : rej(err);
            } else {
                resolve(messageId);
                debug('Completed %s in %sms', messageId, new Date() - initTime);
                return callback ? callback(null, body.api_result_data.api_result_data, body) : res(body.api_result_data.api_result_data);
            }
        });
    });
};

module.exports = BuzzAPI;
