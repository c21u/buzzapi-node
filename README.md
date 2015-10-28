Simple nodejs library for communicating with buzzapi.

    var BuzzApi = require('buzzapi');
    var buzzapi = new BuzzApi({'apiUser': 'id', 'apiPassword': 'secret'});
    buzzapi.postRequest('resource', 'operation', function(err, res, body){console.log(body)});
