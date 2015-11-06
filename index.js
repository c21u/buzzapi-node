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

BuzzAPI.prototype.postRequest = function(resource, operation, data, callback) {
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
        if (err || myOpts.sync) {
            return callback(err, body);
        } else {
            request({
                'url': util.format('%s/apiv3/api.my_messages', server),
                'qs': {
                    'api_app_ticket': body.api_app_ticket,
                    'api_pull_response_to': body.api_result_data
                },
                'json': true
            }, function(err, res, body) {
                return callback(err, body);
            });
        }
    });
};

module.exports = BuzzAPI;
