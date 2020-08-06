module.exports = {
  sync: {
    api_result_data: { success: true },
  },
  syncError: {
    api_error_info: { success: false },
  },
  async: {
    api_result_data: "ABC123",
    api_app_ticket: "XYZ789",
  },
  asyncSuccess: {
    api_result_data: {
      api_request_messageid: "ABC123",
      api_result_data: { success: true },
    },
  },
  asyncNotReady: {
    api_result_data: {},
  },
  asyncEmpty: {
    api_result_data: {
      api_result_data: {},
    },
  },
  asyncError: {
    api_result_data: {
      api_request_messageid: "ABC123",
      api_error_info: { success: false },
    },
  },
};
