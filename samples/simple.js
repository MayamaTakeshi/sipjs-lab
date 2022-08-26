/* this test creates two sip endpoints, makes a call between them, reinvites from both sides, sends INFO from both sides and terminates the call */

const sipjs = require('../index.js')
const {endpoint, dialog} = require('../index.js')

const Zester = require('zester')
const m = require('data-matching')
const util = require('util')
const sip_msg = require('sip-matching')

const z = new Zester()

z.trap_events(sipjs.event_source, 'event', (evt) => {
    var e = evt.args[0]
    return e
})


const sdp_offer = `v=0
o=71924084 8000 8001 IN IP4 192.168.2.110
s=SIP Call
c=IN IP4 192.168.2.110
t=0 0
m=audio 10002 RTP/AVP 0 8 101
a=sendrecv
a=rtcp:59257 IN IP4 192.168.2.110
a=rtpmap:0 PCMU/8000
a=ptime:20
a=rtpmap:8 PCMA/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-15
m=video 10004 RTP/AVP 105
b=AS:704
a=sendrecv
a=rtcp:29307 IN IP4 192.168.2.110
a=rtpmap:105 H264/90000
a=fmtp:105 profile-level-id=428016; packetization-mode=1
a=rtcp-fb:* nack pli
a=rtcp-fb:* ccm fir`.replace(/\n/g, "\r\n")


const sdp_answer = `v=0
o=GANG 0 1 IN IP4 192.168.2.111
s=-
c=IN IP4 192.168.2.111
t=0 0
m=audio 20002 RTP/AVP 0 101
a=rtpmap:0 PCMU/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-15
a=ptime:20
a=sendrecv
m=video 20004 RTP/AVP 105
a=rtcp:37915
a=rtpmap:105 H264/90000
a=fmtp:105 profile-level-id=428016; packetization-mode=1
a=rtcp-fb:* nack pli
a=rtcp-fb:* ccm fir
a=nortpproxy:yes`.replace(/\n/g, "\r\n")


var logger = { 
    send: function(message, address) { debugger; util.debug("send\n" + util.inspect(message, false, null)); },
    recv: function(message, address) { debugger; util.debug("recv\n" + util.inspect(message, false, null)); },
    error: function(e) { util.debug(e.stack); }
}

async function test() {
    const domain = 'test1.com'
    const address = '127.0.0.1'
    const ada_port = 7070
    const bob_port = 7072
    const ada = endpoint.create({address, port: ada_port, publicAddress: address, logger: logger })
    const bob = endpoint.create({address, port: bob_port, publicAddress: address, logger: logger })

    const ada_call_id = dialog.create(ada, {
        method: 'INVITE',
        uri: `sip:bob@${address}:${bob_port}`,
        headers: {
            from: {uri: `sip:ada@${domain}`},
            to: {uri: `sip:bob@${address}:${bob_port}`},
            'content-type': 'application/sdp',
        },
        content: sdp_offer
    })

    await z.wait([
        {
            source: 'sip_endpoint',
            endpoint_id: bob,
            req: m.collect('req'),
            msg: sip_msg({
                $rm: 'INVITE',
                $rU: 'bob',
                $fU: 'ada',
                $fd: domain,
            }),
            event: 'dialog_offer',
            dialog_id: m.collect('bob_call_id'),
        },
    ], 1000)

    bob_call_id = z.store['bob_call_id']

    dialog.send_reply(bob_call_id, z.store.req, 200, 'OK', {
        headers: {
            'content-type': 'application/sdp',
        },
        content: sdp_answer,
    })

    await z.wait([
        {   
            source: 'sip_endpoint',
            endpoint_id: ada,
            event: 'response',
            res: m.collect('res'),
            msg: sip_msg({
                $rm: 'INVITE',
                $rs: '200',
                $rr: 'OK',
                $fU: 'ada',
                $fd: domain,
            }),
            dialog_id: ada_call_id,
        },
    ], 1000)

    dialog.send_request(ada_call_id, {
        method: 'ACK',
    })
    
    await z.wait([
        {
            source: 'sip_endpoint',                                                                          
            endpoint_id: bob,                                                                                  
            event: 'in_dialog_request',
            dialog_id: bob_call_id,
            msg: sip_msg({
                $rm: 'ACK',
            })
        },
    ], 1000)


    // now do a RE-INVITE from ada's side

    // clear stored req and res as we will need to collect them again
    z.store.req = null
    z.store.res = null

    dialog.send_request(ada_call_id, {
        method: 'INVITE',
        headers: {
            'content-type': 'application/sdp',
        },
        content: sdp_offer
    })

    await z.wait([
        {
            source: 'sip_endpoint',
            endpoint_id: bob,
            req: m.collect('req'),
            event: 'in_dialog_request',
            dialog_id: bob_call_id
        },
    ], 1000)
 
    dialog.send_reply(bob_call_id, z.store.req, 200, 'OK', {
        headers: {
            'content-type': 'application/sdp',
        },
        content: sdp_answer,
    })

    await z.wait([
        {   
            source: 'sip_endpoint',
            endpoint_id: ada,
            event: 'response',
            res: m.collect('res'),
            msg: sip_msg({
                $rm: 'INVITE',
                $rs: '200',
                $rr: 'OK',
                $fU: 'ada',
                $fd: domain,
            }),
            dialog_id: ada_call_id,
        },
    ], 1000)

    dialog.send_request(ada_call_id, {
        method: 'ACK',
    })

    await z.wait([
        {
            source: 'sip_endpoint',                                                                          
            endpoint_id: bob,                                                                                  
            event: 'in_dialog_request',
            dialog_id: bob_call_id,
            msg: sip_msg({
                $rm: 'ACK',
            })
        },
    ], 1000)


    // now do a RE-INVITE from bob's side

    // clear stored req and res as we will need to collect them again
    z.store.req = null
    z.store.res = null

    dialog.send_request(bob_call_id, {
        method: 'INVITE',
        headers: {
            'content-type': 'application/sdp',
        },
        content: sdp_offer,
    })

    await z.wait([
        {
            source: 'sip_endpoint',
            endpoint_id: ada,
            req: m.collect('req'),
            event: 'in_dialog_request',
            dialog_id: ada_call_id
        },
    ], 1000)
 
    dialog.send_reply(ada_call_id, z.store.req, 200, 'OK', {
        headers: {
            'content-type': 'application/sdp',
        },
        content: sdp_answer,
    })

    await z.wait([
        {   
            source: 'sip_endpoint',
            endpoint_id: bob,
            event: 'response',
            res: m.collect('res'),
            msg: sip_msg({
                $rm: 'INVITE',
                $rs: '200',
                $rr: 'OK',
                $fU: 'bob',
                $tU: 'ada',
            }),
            dialog_id: bob_call_id,
        },
    ], 1000)

    dialog.send_request(bob_call_id, {
        method: 'ACK',
    })

    await z.wait([
        {
            source: 'sip_endpoint',                                                                          
            endpoint_id: ada,                                                                                  
            event: 'in_dialog_request',
            dialog_id: ada_call_id,
            msg: sip_msg({
                $rm: 'ACK',
            })
        },
    ], 1000)


    // now send INFO from ada's side

    // clear stored req and res as we will need to collect them again
    z.store.req = null
    z.store.res = null

    dialog.send_request(ada_call_id, {
        method: 'INFO',
        headers: {
            Subject: 'Money Transfer By Wire',
            'Content-Type': 'application/mgcp',
        },
        content: "NTFY 123456 a.g.bell@bell-tel.com MGCP  1.0\r\nO: D/8, D/7, D/2, D/6, D/#, D/L",
    })

    await z.wait([
        {
            source: 'sip_endpoint',
            endpoint_id: bob,
            req: m.collect('req'),
            msg: sip_msg({
                $rm: 'INFO',
                $rb: "NTFY 123456 a.g.bell@bell-tel.com MGCP  1.0\r\nO: D/8, D/7, D/2, D/6, D/#, D/L",
            }),
            event: 'in_dialog_request',
            dialog_id: bob_call_id,
        },
    ], 1000)
 
    dialog.send_reply(bob_call_id, z.store.req, 200, 'OK')

    await z.wait([
        {   
            source: 'sip_endpoint',
            endpoint_id: ada,
            event: 'response',
            res: m.collect('res'),
            msg: sip_msg({
                $rm: 'INFO',
                $rs: '200',
                $rr: 'OK',
            }),
            dialog_id: ada_call_id,
        },
    ], 1000)


    // now send INFO from bob's side

    // clear stored req and res as we will need to collect them again
    z.store.req = null
    z.store.res = null


    dialog.send_request(bob_call_id, {
        method: 'INFO',
        headers: {
            Subject: 'Your wheater report is ready',
            'Content-Type': 'text/plain',
        },
        content: "Cloudy, with a chance of rain",
    })

    await z.wait([
        {
            source: 'sip_endpoint',
            endpoint_id: ada,
            req: m.collect('req'),
            msg: sip_msg({
                $rm: 'INFO',
                $rb: "Cloudy, with a chance of rain",
            }),
            event: 'in_dialog_request',
            dialog_id: ada_call_id,
        },
    ], 1000)

    dialog.send_reply(ada_call_id, z.store.req, 200, 'OK')

    await z.wait([
        {   
            source: 'sip_endpoint',
            endpoint_id: bob,
            event: 'response',
            res: m.collect('res'),
            msg: sip_msg({
                $rm: 'INFO',
                $rs: '200',
                $rr: 'OK',
            }),
            dialog_id: bob_call_id,
        },
    ], 1000)



    // Now disconnect from ada's side

    // clear stored req and res as we will need to collect them again
    z.store.req = null
    z.store.res = null


    dialog.send_request(ada_call_id, {
        method: 'BYE',
    })

    await z.wait([
        {
            source: 'sip_endpoint',
            endpoint_id: bob,
            event: 'in_dialog_request',
            dialog_id: bob_call_id,
            req: m.collect('req'),
            msg: sip_msg({
                $rm: 'BYE',
            })
        },
    ], 1000)

    dialog.send_reply(bob_call_id, z.store.req, 200, 'OK', {
        headers: {
        },
    })

    await z.wait([
        {   
            source: 'sip_endpoint',
            endpoint_id: ada,
            event: 'response',
            res: m.collect('res'),
            msg: sip_msg({
                $rm: 'BYE',
                $rs: '200',
                $rr: 'OK',
                $fU: 'ada',
                $fd: domain,
            }),
            dialog_id: ada_call_id,
        },
    ], 1000)

    await z.sleep(100) // wait for any unexpected events

    sipjs.endpoint.destroy(ada)
    sipjs.endpoint.destroy(bob)

    console.log("success")
}


test()
.catch((e) => {
    console.error(e)
    process.exit(1)
})
