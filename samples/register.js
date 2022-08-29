/* this test creates two sip endpoints and registers one against the other */

const sipjs = require('../index.js')

const {endpoint, dialog} = require('../index.js')

const Zester = require('zester')
const m = require('data-matching')
const util = require('util')
const sip_msg = require('../lib/sip_matching.js')

const uuid_v4 = require('uuid').v4

const z = new Zester()

z.trap_events(sipjs.event_source, 'event', (evt) => {
    var e = evt.args[0]
    return e
})

const register_template = `REGISTER sip:registrar.biloxi.com SIP/2.0
Via: SIP/2.0/UDP bobspc.biloxi.com:5060;branch=z9hG4bKnashds7
Max-Forwards: 70
To: Bob <sip:bob@biloxi.com>
From: Bob <sip:bob@biloxi.com>;tag=456248
Call-ID: 843817637684230@998sdasdh09
CSeq: 1826 REGISTER
Contact: <sip:bob@192.0.2.4>
Expires: 7200
Content-Length: 0

`.replace(/\n/g, "\r\n")

const answer_template =`SIP/2.0 200 OK
Via: SIP/2.0/UDP bobspc.biloxi.com:5060;branch=z9hG4bKnashds7;received=192.0.2.4
To: Bob <sip:bob@biloxi.com>;tag=2493k59kd
From: Bob <sip:bob@biloxi.com>;tag=456248
Call-ID: 843817637684230@998sdasdh09
CSeq: 1826 REGISTER
Contact: <sip:bob@192.0.2.4>
Expires: 7200
Content-Length: 0

`.replace(/\n/g, "\r\n")


var logger = { 
    send: function(message, address) { debugger; util.debug("send\n" + util.inspect(message, false, null)); },
    recv: function(message, address) { debugger; util.debug("recv\n" + util.inspect(message, false, null)); },
    error: function(e) { util.debug(e.stack); }
}

async function test() {
    const address = '127.0.0.1'
    const user_port = 7070
    const registrar_port = 7072
    const user = endpoint.create({address, port: user_port, publicAddress: address, logger: logger })
    const registrar = endpoint.create({address, port: registrar_port, publicAddress: address, logger: logger })

    const call_id = uuid_v4()

    endpoint.send_non_dialog_request(user, {
        uri: `sip:registrar@${address}:${registrar_port}`,
        headers: {
            'call-id': call_id,
        },
    }, register_template)

    await z.wait([
        {
            source: 'sip_endpoint',
            endpoint_id: registrar,
            req: m.collect('req', sip_msg({
                $rm: 'REGISTER',
                $ru: `sip:registrar@${address}:${registrar_port}`,
                hdr_contact: {uri: `sip:sipjs@${address}:${user_port}`},
                hdr_expires: (x) => { return parseInt(x) > 0 },
                hdr_call_id: call_id,
            })),
            event: 'out_of_dialog_request',
        },
    ], 1000)

    endpoint.send_reply(
        registrar,
        z.store.req,
        407,
        'Proxy Authentication Required',
        {
            headers: {
                expires: '160',
            },
            challenge: {realm: 'fake'},
        },
        answer_template,
    )

    await z.wait([
        {   
            source: 'sip_endpoint',
            endpoint_id: user,
            event: 'response',
            res: m.collect('res', sip_msg({
                $rm: 'REGISTER',
                $rs: 407,
                $rr: 'Proxy Authentication Required',
                hdr_expires: '160',
            })),
        },
    ], 1000)

    // clear stored req and res as we will need to collect them again
    z.store.req = null
    z.store.res = null

    endpoint.send_non_dialog_request(user, {
            uri: `sip:registrar@${address}:${registrar_port}`,
            headers: {
                'call-id': call_id,
            },
        }, 
        register_template,
        {
            res: z.store.res,
            credentials: {
                user: 'fake',
                password: 'fake',
            },
        }
    )

    await z.wait([
        {
            source: 'sip_endpoint',
            endpoint_id: registrar,
            req: m.collect('req', sip_msg({
                $rm: 'REGISTER',
                $ru: `sip:registrar@${address}:${registrar_port}`,
                hdr_contact: {uri: `sip:sipjs@${address}:${user_port}`},
                hdr_expires: (x) => { return parseInt(x) > 0 },
                hdr_call_id: call_id,
            })),
            event: 'out_of_dialog_request',
        },
    ], 1000)

    endpoint.send_reply(
        registrar,
        z.store.req,
        200,
        'OK',
        {
            headers: {
                expires: '160',
            },
        },
        answer_template,
    )
 
    await z.wait([
        {   
            source: 'sip_endpoint',
            endpoint_id: user,
            event: 'response',
            res: m.collect('res', sip_msg({
                $rm: 'REGISTER',
                $rs: 200,
                $rr: 'OK',
                hdr_expires: '160',
                hdr_call_id: call_id,
            })),
        },
    ], 1000)

    await z.sleep(100) // wait for any unexpected events

    sipjs.endpoint.destroy(user)
    sipjs.endpoint.destroy(registrar)

    console.log("success")
}


test()
.catch((e) => {
    console.error(e)
    process.exit(1)
})
