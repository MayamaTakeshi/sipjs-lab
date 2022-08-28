const string_matching = require('string-matching')
const data_matching = require('data-matching')
const sip_parsing = require('./sip_parsing.js')
const _ = require('lodash')

module.exports = (expected) => {
    var expected2 = data_matching.matchify_strings(expected)
    var f = (s, dict, throw_matching_error, path) => {
        var received = sip_parsing.parse(s)
        return _.every(expected2, (val, key) => {
            if(val == data_matching.absent && received[key]) {
                if(throw_matching_error) {
                    throw Error(`key ${path}.${key} expected to be absent`)
                }
                return false
            }
            var full_match = false
            return data_matching.match(val, received[key], dict, full_match , throw_matching_error, `${path}.${key}`)
        })
    }
    f.__original_data__ = expected
    f.__name__ = 'sip_msg'
    return f
}
