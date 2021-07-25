const WebSocket = require('ws');
const domain = require('domain');
const SteamUser = require('steam-user');
const poster = require('./post');
const config = require('./config');
const resultEnum = require('./Eresult');
const purchaseResultEnum = require('./EPurchaseResult');
const { InvalidPassword } = require('./Eresult');

module.exports = server => {
    const wss = new WebSocket.Server({ server });
    wss.on('connection', ws => {
        wsSend(ws, {
            action: 'connect',
            result: 'success',
            server: config ? config.name : 'Unknown',
        });

        let steamClient = new SteamUser();
        steamClient.WebSocket = ws;
        steamClient.on('steamGuard', function (domain, callback) {
            console.log(`Steam Guard code needed from ${domain ? domain : 'App'}`);

            try {
                ws.send(JSON.stringify({ action: 'authCode' }));
            } catch (err) {
                // TODO
            }

            this.removeAllListeners('doauth');
            this.once('doauth', function (code) {
                if (!this.steamID)
                    callback(code);
            });
        });

        ws.on('message', message => dispatchMessage(ws, steamClient, message));
        ws.on('close', () => steamClient.logOff());
    });
};

function dispatchMessage(ws, steam, message) {
    let data = parseJSON(message);
    if (!data.action) return;

    switch (data.action) {
        case 'ping':
            pong(ws, data);
            break;
        case 'logOn':
            doLogOn(ws, steam, data);
            break;
        case 'authCode':
            doAuth(ws, steam, data);
            break;
        case 'redeem':
            doRedeem(ws, steam, data);
            break;
        default:
            return;
    }
}

function pong(ws, data) {
    wsSend(ws, {
        action: 'pong',
        count: data.count || 0,
    });
}

function doLogOn(ws, steam, data) {
    steam.on('error', (err) => {
        if (err.eresult == InvalidPassword) {
            wsSendError(ws, 'logOn', 'InvalidPassword');
        }
    })
    steam.logOn({
        accountName: data.username.trim(),
        password: data.password.trim(),
        twoFactorCode: data.authcode.trim(),
        rememberPassword: false,
        dontRememberMachine: true,
    });
    steam.once('accountInfo', (name, country) => {
        wsSend(ws, {
            action: 'logOn',
            result: 'success',
            detail: {
                name: name,
                country: country,
            },
        });
    });
}

function doAuth(ws, steam, data) {
    if (!data.authCode || data.authCode.trim() === '') {
        wsSendError(ws, 'logOn', 'AuthCodeError');
        return;
    }
    steam.emit('doauth', data.authCode);
}

function doRedeem(ws, steam, data) {
    data.keys.forEach(async key => redeemKey(steam, key).then(res => {
        wsSend(ws, res);
        console.log(res);
        if (config && config.enableLog) {
            for (let subId in res.detail.packages) {
                if (res.detail.packages.hasOwnProperty(subId)) {
                    poster(config.postUrl, subId, res.detail.packages[subId], config.id);
                    break;
                }
            }
        }
    }));
}

function redeemKey(steam, key) {
    return new Promise(resolve => {
        steam.redeemKey(key, (result) => {
            resolve({
                action: 'redeem',
                detail: {
                    key: key,
                    result: resultEnum[result.eresult],
                    detail: purchaseResultEnum[result.purchaseResultDetails],
                    packages: result.packageList,
                },
            });
        });
    })
}

function wsSendError(ws, action, message) {
    wsSend(ws, {
        action: action,
        result: 'failed',
        message: message
    });
}

function wsSend(ws, stuff) {
    try {
        let data = typeof stuff === 'string' ? stuff : JSON.stringify(stuff);
        ws.send(data);
    } catch (error) {
        // do nothing...
    }
}

function parseJSON(json, defaultValue = {}) {
    try {
        return JSON.parse(json);
    } catch (ex) {
        return defaultValue;
    }
}
