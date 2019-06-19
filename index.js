const https = require("https");
const isEmpty = require("lodash.isempty");
const debug = require("debug")("buzzapi");
const hyperid = require("hyperid")({ fixedLength: true, urlSafe: true });
const os = require("os");
const BuzzAPIError = require("./buzzApiError");
const pRetry = require("p-retry");
const { default: PQueue } = require("p-queue");

const BuzzAPI = function(config) {
  const that = this;

  this.queue = new PQueue({ concurrency: 20 });

  this.options = {
    api_app_id: config.apiUser,
    api_app_password: Buffer.from(config.apiPassword).toString("base64"),
    api_request_mode: config.sync ? "sync" : "async",
    api_receive_timeout: config.api_receive_timeout || 900000
  };

  const server = config.server || "https://api.gatech.edu";

  const fetch = require("make-fetch-happen").defaults({
    agent: https.globalAgent
  });

  this.unresolved = {};
  this.gettingResult = false;

  this.post = function(resource, operation, data) {
    debug("Options: " + JSON.stringify(that.options));
    return that.queue.add(
      () =>
        new Promise((res, rej) => {
          const handle =
            data.api_client_request_handle ||
            `${process.pid}@${os.hostname()}-${hyperid()}`;

          const myOpts = {
            method: "POST",
            body: JSON.stringify({
              ...that.options,
              ...data,
              api_client_request_handle: handle
            }),
            headers: { "Content-Type": "application/json" }
          };
          debug("Requesting %s", JSON.stringify(myOpts));
          return fetch(`${server}/apiv3/${resource}/${operation}`, myOpts).then(
            response => {
              if (!response.ok) {
                return rej(
                  new BuzzAPIError(
                    response.statusText,
                    null,
                    response.statusText
                  )
                );
              }
              return response.json().then(json => {
                if (json.api_error_info) {
                  const error = new BuzzAPIError(
                    new Error(),
                    json.api_error_info,
                    json
                  );
                  return rej(error);
                } else if (that.options.api_request_mode === "sync") {
                  debug("Sync was set, returning the result");
                  return res(json.api_result_data);
                } else {
                  debug(
                    "Got messageId: %s for %s",
                    json.api_result_data,
                    handle
                  );
                  that.unresolved[json.api_result_data] = {
                    resolve: res,
                    reject: rej,
                    initTime: new Date()
                  };
                  that.options.ticket = json.api_app_ticket;
                  return pRetry(getResult, { retries: 5 });
                }
              });
            }
          );
        })
    );
  };

  const resolve = function(messageId, result) {
    debug("size: %s, pending: %s", that.queue.size, that.queue.pending);
    const message = that.unresolved[messageId];
    delete that.unresolved[messageId];
    return message.resolve(result);
  };

  const reject = function(messageId, err) {
    debug("size: %s, pending: %s", that.queue.size, that.queue.pending);
    const message = that.unresolved[messageId];
    delete that.unresolved[messageId];
    return message.reject(err);
  };

  const cleanupExpired = function() {
    Object.keys(that.unresolved).forEach(messageId => {
      if (
        new Date() - that.unresolved[messageId].initTime >
        that.options.api_receive_timeout
      ) {
        const err = new Error("Request timed out for: " + messageId);
        return reject(messageId, err);
      }
    });
    return;
  };

  const scheduleRetry = function() {
    setTimeout(() => {
      return pRetry(getResult, { retries: 5 });
    }, Math.floor(Math.random() * 4000 + 1000));
  };

  const getResult = function() {
    if (that.gettingResult) {
      return;
    }
    that.gettingResult = true;
    cleanupExpired();
    const messageIds = Object.keys(that.unresolved);
    if (messageIds.length === 0) {
      return;
    }
    const handle = `${process.pid}@${os.hostname()}-${hyperid()}`;
    debug("Asking for result of %s using handle %s", messageIds, handle);
    return fetch(`${server}/apiv3/api.my_messages`, {
      method: "POST",
      body: JSON.stringify({
        api_operation: "read",
        api_app_ticket: that.options.ticket,
        api_pull_response_to: messageIds,
        api_receive_timeout: 5000,
        api_client_request_handle: handle
      }),
      headers: { "Content-Type": "application/json" }
    })
      .then(response => {
        that.gettingResult = false;

        if (!response.ok) {
          return Promise.reject(
            new Error("Failed to get results from BuzzAPI")
          );
        }
        return response.json().then(json => {
          if (
            json.api_error_info ||
            (json.api_result_data && json.api_result_data.api_error_info)
          ) {
            if (json.api_error_info) {
              const message =
                that.unresolved[json.api_error_info.api_request_messageid];
              const err = new BuzzAPIError(
                "BuzzApi returned error_info",
                json.api_error_info,
                json
              );
              debug(that.unresolved);
              debug(json);
              if (message) {
                return reject(json.api_error_info.api_request_messageid, err);
              } else {
                throw err;
              }
            } else if (json.api_result_data) {
              const messageId = json.api_result_data.api_request_messageid;
              const err = new BuzzAPIError(
                "BuzzApi returned error_info",
                json.api_result_data.api_error_info,
                json
              );
              return reject(messageId, err);
            } else {
              const err = new BuzzAPIError(new Error(), json, json);
              throw err;
            }
          } else if (isEmpty(json.api_result_data)) {
            // Empty result_data here means our data isn't ready, wait 1 to 5 seconds and try again
            debug("Result not ready for " + messageIds);
            return scheduleRetry();
          } else {
            const messageId = json.api_result_data.api_request_messageid;
            debug("Got result for ", messageId);
            const resolution = resolve(
              messageId,
              json.api_result_data.api_result_data
            );
            if (Object.keys(that.unresolved).length > 0) {
              return scheduleRetry();
            }
            return resolution;
          }
        });
      })
      .catch(err => {
        Object.keys(that.unresolved).forEach(messageId =>
          reject(messageId, err)
        );
      });
  };
};

module.exports = BuzzAPI;
