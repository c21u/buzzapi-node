[![Build Status](https://travis-ci.org/stuartf/buzzapi-node.svg?branch=master)](https://travis-ci.org/stuartf/buzzapi-node)

Simple nodejs library for communicating with buzzapi.

    var BuzzApi = require('buzzapi');
    var buzzapi = new BuzzApi({'apiUser': 'id', 'apiPassword': 'secret'});
    buzzapi.post('resource', 'operation', function(err, body){console.log(body)});
