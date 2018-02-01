module.exports = {
    'sync': {
        'api_result_data': {'success': true}
    },
    'syncError': {
        'api_error_info': {'success': false}
    },
    'async': {
        'api_result_data': 'ABC123'
    },
    'asyncSuccess': {
        'api_result_data': {
            'api_result_data': {'success': true}
        }
    },
    'asyncNotReady': {
        'api_result_data': {
            'api_result_data': {}
        }
    }

}
