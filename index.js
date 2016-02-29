var _ = require('underscore');
var os = require('os');
var request = require('request');
var util = require('util');

// Enable cookies
request = request.defaults({jar: true});

var options = {};
var server = 'https://api.gatech.edu';

var BuzzAPI = function(config) {
    options.api_app_id = config.apiUser;
    options.api_app_password = new Buffer(config.apiPassword).toString('base64');
    options.api_request_mode = config.sync ? 'sync' : 'async';
    server = config.server || server;
};

BuzzAPI.prototype.post = function(resource, operation, data, callback) {
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
            return callback(err, body.api_error_info, body);
        } else if (options.api_request_mode === 'sync') {
            return callback(null, body.api_result_data, body);
        } else {
            getResult(body.api_result_data, body.api_app_ticket, callback);
        }
    });
};

var getResult = function(messageId, ticket, initTime, callback) {
    if (_.isFunction(initTime)) {
        callback = initTime;
        initTime = new Date();
    } else if (new Date() - initTime > 900){
       return callback(new Error('Request was open for 15 minutes'));
    }
    request({
        'url': util.format('%s/apiv3/api.my_messages', server),
        'qs': {
            'api_app_ticket': ticket,
            'api_pull_response_to': messageId
        },
        'json': true
    }, function(err, res, body) {
        if (err || body.api_error_info) {
            return callback(err, body.api_error_info, body);
        } else if (_.isEmpty(body.api_result_data)) {
            // Empty result_data here means our data isn't ready, try again
            return getResult(messageId, body.api_app_ticket, initTime, callback);
        } else if (!body.api_result_data.api_result_data) {
            return callback(new Error('BuzzAPI returned an empty result, this usually means it timed out requesting a resource'), {}, body);
        } else {
            return callback(null, body.api_result_data.api_result_data, body);
        }
    });
};

module.exports = BuzzAPI;
