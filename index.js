const https = require("https");
const isEmpty = require("lodash.isempty");
const debug = require("debug")("buzzapi");
const delay = require("delay");
const hyperid = require("hyperid")({ fixedLength: true, urlSafe: true });
const os = require("os");
const BuzzAPIError = require("./buzzApiError");
const pRetry = require("p-retry");
const pThrottle = require("p-throttle");
const { default: PQueue } = require("p-queue");

https.globalAgent.maxCachedSessions = 0;

const BuzzAPI = function(config) {
  const that = this;

  const queue = new PQueue({ concurrency: 20 });

  this.options = {
    api_app_id: config.apiUser,
    api_app_password: Buffer.from(config.apiPassword).toString("base64"),
    api_request_mode: config.sync ? "sync" : "async",
    api_receive_timeout: config.api_receive_timeout || 900000
  };

  const server = config.server || "https://api.gatech.edu";

  const fetch = pThrottle(
    require("make-fetch-happen").defaults({
      agent: https.globalAgent
    }),
    333,
    1000
  );

  const unresolved = {};

  this.post = function(resource, operation, data) {
    debug("Options: " + JSON.stringify(that.options));
    return queue.add(
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
          const url = `${server}/apiv3/${resource}/${operation}`;
          return pRetry(() => fetch(url, myOpts), {
            retries: 5,
            randomize: true
          }).then(response => {
            if (!response.ok) {
              return rej(
                new BuzzAPIError(
                  `${response.status}: ${response.statusText}`,
                  null,
                  `${response.status}: ${response.statusText}`,
                  response.api_request_messageid,
                  { url, options: myOpts }
                )
              );
            }
            return response.json().then(json => {
              if (json.api_error_info) {
                const error = new BuzzAPIError(
                  new Error(),
                  json.api_error_info,
                  json,
                  json.api_request_messageid,
                  { url, options: myOpts }
                );
                return rej(error);
              } else if (that.options.api_request_mode === "sync") {
                debug("Sync was set, returning the result");
                return res(json.api_result_data);
              } else {
                debug("Got messageId: %s for %s", json.api_result_data, handle);
                unresolved[json.api_result_data] = {
                  resolve: res,
                  reject: rej,
                  initTime: new Date()
                };
                that.options.ticket = json.api_app_ticket;
                return getResult();
              }
            });
          });
        })
    );
  };

  const resolve = function(messageId, result) {
    debug("size: %s, pending: %s", queue.size, queue.pending);
    const message = unresolved[messageId];
    delete unresolved[messageId];
    return message.resolve(result);
  };

  const reject = function(messageId, err) {
    debug("size: %s, pending: %s", queue.size, queue.pending);
    const message = unresolved[messageId];
    delete unresolved[messageId];
    return message.reject(err);
  };

  const cleanupExpired = function() {
    Object.keys(unresolved).forEach(messageId => {
      if (
        new Date() - unresolved[messageId].initTime >
        that.options.api_receive_timeout
      ) {
        const err = new Error("Request timed out for: " + messageId);
        return reject(messageId, err);
      }
    });
    return;
  };

  const scheduleRetry = function() {
    return delay(Math.floor(Math.random() * 4000 + 1000)).then(() =>
      getResult()
    );
  };

  const getResult = function() {
    cleanupExpired();
    const messageIds = Object.keys(unresolved);
    if (messageIds.length === 0) {
      return new Promise(res => res());
    }
    const handle = `${process.pid}@${os.hostname()}-${hyperid()}`;
    debug("Asking for result of %s using handle %s", messageIds, handle);
    const url = `${server}/apiv3/api.my_messages`;
    const myOpts = {
      method: "POST",
      body: JSON.stringify({
        api_operation: "read",
        api_app_ticket: that.options.ticket,
        api_pull_response_to: messageIds,
        api_receive_timeout: 5000,
        api_client_request_handle: handle
      }),
      headers: { "Content-Type": "application/json" }
    };
    return pRetry(() => fetch(url, myOpts), {
      retries: 5,
      randomize: true
    }).then(response => {
      if (!response.ok) {
        return scheduleRetry();
      }
      return response.json().then(json => {
        if (
          json.api_error_info ||
          (json.api_result_data && json.api_result_data.api_error_info)
        ) {
          if (json.api_error_info) {
            const message =
              unresolved[json.api_error_info.api_request_messageid];
            const err = new BuzzAPIError(
              "BuzzApi returned error_info",
              json.api_error_info,
              json,
              json.api_error_info.api_request_messageid,
              { url, options: myOpts }
            );
            debug(unresolved);
            if (message) {
              return reject(json.api_error_info.api_request_messageid, err);
            } else {
              return Promise.reject(err);
            }
          } else if (json.api_result_data) {
            const messageId = json.api_result_data.api_request_messageid;
            const err = new BuzzAPIError(
              "BuzzApi returned error_info",
              json.api_result_data.api_error_info,
              json,
              messageId,
              { url, options: myOpts }
            );
            return reject(messageId, err);
          } else {
            return Promise.reject(
              new BuzzAPIError(
                new Error(),
                json,
                json,
                json.api_request_messageId,
                { url, options: myOpts }
              )
            );
          }
        } else if (isEmpty(json.api_result_data)) {
          // Empty result_data here means our data isn't ready, wait 1 to 5 seconds and try again
          debug("Result not ready for " + messageIds);
          return scheduleRetry();
        } else {
          const messageId = json.api_result_data.api_request_messageid;
          debug("Got result for ", messageId);
          if (json.api_result_data.hasOwnProperty("api_paging_last_page")) {
            return resolve(messageId, {
              lastPage: json.api_result_data.api_paging_last_page,
              result: json.api_result_data.api_result_data
            });
          }
          return resolve(messageId, json.api_result_data.api_result_data);
        }
      });
    });
  };
};

module.exports = BuzzAPI;
