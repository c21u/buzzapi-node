const isEmpty = require("lodash.isempty");
const debug = require("debug")("buzzapi");
const hyperid = require("hyperid")({ fixedLength: true, urlSafe: true });
const os = require("os");
let request = require("requestretry");
const util = require("util");
const BuzzAPIError = require("./buzzApiError");

// Enable cookies
request = request.defaults({ jar: true });

const BuzzAPI = function(config) {
  const that = this;

  this.options = {
    api_app_id: config.apiUser,
    api_app_password: Buffer.from(config.apiPassword).toString("base64"),
    api_request_mode: config.sync ? "sync" : "async",
    ticket: /.*/,
    api_receive_timeout: config.api_receive_timeout || 900000
  };

  const server = config.server || "https://api.gatech.edu";

  let openReqs = 0;
  const queuedReqs = [];
  const unresolved = {};
  let gettingResult = false;
  let ticket = "";

  this.post = function(resource, operation, data, callback) {
    if (openReqs >= 20) {
      return new Promise((res, rej) => {
        queuedReqs.push({ args: arguments, res: res, rej: rej });
      });
    } else {
      return doPost(resource, operation, data, callback);
    }
  };

  const doPost = function(resource, operation, data, callback) {
    debug("Options: " + JSON.stringify(that.options));
    return new Promise((res, rej) => {
      openReqs++;
      if (typeof data === "function") {
        callback = data;
        data = {};
      }
      const myOpts = {};
      myOpts.url = `${server}/apiv3/${resource}/${operation}`;
      myOpts.api_client_request_handle =
        data.api_client_request_handle ||
        `${process.pid}@${os.hostname()}-${hyperid()}`;
      myOpts.json = Object.assign(data, that.options);
      debug("Requesting %s", JSON.stringify(myOpts));
      request.post(myOpts, function(err, response, body) {
        if (response && response.attempts && response.attempts > 1) {
          debug("Request took multiple attempts %s", response.attempts);
        }
        if (err || response.statusCode > 299 || body.api_error_info) {
          if (body) {
            const error = new BuzzAPIError(err, body.api_error_info, body);
            return callback ? callback(error, null, body) : rej(error);
          } else {
            const error = new BuzzAPIError(err);
            return callback ? callback(error) : rej(error);
          }
        } else if (that.options.api_request_mode === "sync") {
          debug("Sync was set, returning the result");
          resolve();
          return callback
            ? callback(null, body.api_result_data, body)
            : res(body.api_result_data);
        } else {
          debug(
            "Got messageId: %s for %s",
            body.api_result_data,
            myOpts.api_client_request_handle
          );
          unresolved[body.api_result_data] = {
            resolve: res,
            reject: rej,
            callback: callback,
            initTime: new Date()
          };
          ticket = body.api_app_ticket;
          return getResult();
        }
      });
    });
  };

  const resolve = function(messageId) {
    openReqs--;
    debug("queued: %s  open: %s", queuedReqs.length, openReqs);
    if (messageId) {
      delete unresolved[messageId];
    }
    if (queuedReqs[0]) {
      const next = queuedReqs.pop();
      return doPost
        .apply(null, next.args)
        .then(next.res)
        .catch(next.rej);
    }
  };

  const cleanupExpired = function() {
    Object.keys(unresolved).map(messageId => {
      if (
        new Date() - unresolved[messageId].initTime >
        that.options.api_receive_timeout
      ) {
        const err = new Error("Request timed out for: " + messageId);
        if (unresolved[messageId].callback) {
          unresolved[messageId].callback(err);
        } else {
          unresolved[messageId].reject(err);
        }
        resolve(messageId);
      }
    });
    return;
  };

  const scheduleRetry = function() {
    setTimeout(() => {
      return getResult();
    }, Math.floor(Math.random() * (5000 - 1000) + 1000));
  };

  const getResult = function() {
    if (gettingResult) {
      return;
    }
    gettingResult = true;
    cleanupExpired();
    const messageIds = Object.keys(unresolved);
    if (messageIds.length === 0) {
      return;
    }
    const handle = `${process.pid}@${os.hostname()}-${hyperid()}`;
    debug("Asking for result of %s using handle %s", messageIds, handle);
    request.post(
      {
        url: util.format("%s/apiv3/api.my_messages", server),
        json: {
          api_operation: "read",
          api_app_ticket: ticket,
          api_pull_response_to: messageIds,
          api_receive_timeout: 5000,
          api_client_request_handle: handle
        }
      },
      (err, response, body) => {
        gettingResult = false;
        if (response && response.attempts && response.attempts > 1) {
          debug("Request took multiple attempts %s", response.attempts);
        }
        if (
          err ||
          response.statusCode > 299 ||
          body.api_error_info ||
          (body.api_result_data && body.api_result_data.api_error_info)
        ) {
          if (!body) {
            messageIds.map(messageId => {
              const message = unresolved[messageId];
              if (message.callback) {
                message.callback(new BuzzAPIError(err), null);
              } else {
                message.reject(new BuzzAPIError(err));
              }
              resolve(messageId);
            });
            return;
          }
          if (body.api_error_info) {
            const message =
              unresolved[body.api_error_info.api_request_messageid];
            const err = new BuzzAPIError(
              "BuzzApi returned error_info",
              body.api_error_info,
              body
            );
            debug(unresolved);
            debug(body);
            if (message) {
              return message.callback
                ? message.callback(err, null)
                : message.reject(err);
            } else {
              // We don't know which message threw the error, so invalidate all of them
              messageIds.map(messageId => {
                const m = unresolved[messageId];
                if (m.callback) {
                  m.callback(err, null);
                } else {
                  m.reject(err);
                }
                resolve(messageId);
              });
              return;
            }
          } else if (body.api_result_data) {
            const messageId = body.api_result_data.api_request_messageid;
            const message = unresolved[messageId];
            resolve(messageId);
            const err = new BuzzAPIError(
              "BuzzApi returned error_info",
              body.api_result_data.api_error_info,
              body
            );
            return message.callback
              ? message.callback(err, null)
              : message.reject(err);
          } else {
            messageIds.map(messageId => {
              const error = new BuzzAPIError(err, body, body);
              const message = unresolved[messageId];
              if (message.callback) {
                message.callback(error, null);
              } else {
                message.reject(error);
              }
              resolve(messageId);
            });
            return;
          }
        } else if (isEmpty(body.api_result_data)) {
          // Empty result_data here means our data isn't ready, wait 1 to 5 seconds and try again
          debug("Result not ready for " + messageIds);
          return scheduleRetry();
        } else {
          const messageId = body.api_result_data.api_request_messageid;
          const message = unresolved[messageId];
          debug("Got result for ", messageId);
          resolve(messageId);
          if (message.callback) {
            message.callback(null, body.api_result_data.api_result_data, body);
          } else {
            message.resolve(body.api_result_data.api_result_data);
          }
          if (Object.keys(unresolved).length > 0) {
            getResult();
          }
        }
      }
    );
  };
};

module.exports = BuzzAPI;
