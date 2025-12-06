import { MP_CONFIG } from './mpConfig.js';

// Photon Realtime JS SDK 封装：
// 使用全局 Photon.LoadBalancing.LoadBalancingClient（通过 CDN 引入），
// 尽量保持原有 API：init / getRoomList / getRoomPlayers / setRoomListUpdateHandler / createRoom / joinRoom。

class RealtimePhotonClient {
    constructor() {
        this.initialized = false;
        this.appId = null;
        this.region = null;
        this.userId = null;

        /** @type {Photon.LoadBalancing.LoadBalancingClient | null} */
        this.client = null;

        /** @type {(rooms: any[]) => void} */
        this.onRoomListUpdate = null;

        /** @type {Record<string, { userId: string, name: string }[]>} */
        this.roomMembers = {};

        /** @type {(payload: { playerId: string, pos: any, rotY: number, ts: number }) => void | null} */
        this.onPlayerStateUpdate = null;
    }

    reset() {
        if (this.client && typeof this.client.disconnect === 'function') {
            try {
                this.client.disconnect();
            } catch (e) {
            }
        }
        this.client = null;
        this.initialized = false;
    }

    init({ appId, region, userId }) {
        if (this.initialized) return;

        if (typeof Photon === 'undefined' || !Photon.LoadBalancing || !Photon.LoadBalancing.LoadBalancingClient) {
            console.error('[Photon] Photon JS SDK 未加载，请检查 index.html 中的 CDN 脚本引入');
            return;
        }

        this.appId = appId || MP_CONFIG.photonAppId;
        this.region = region || MP_CONFIG.region;
        this.userId = userId || `web-${Math.floor(Math.random() * 1e6)}`;

        const ClientCtor = Photon.LoadBalancing.LoadBalancingClient;
        // LoadBalancingClient 构造函数签名： (protocol, appId, appVersion)
        // 这里必须先传入协议常量（Ws / Wss），否则 appId 会被当成服务器地址，
        // 导致出现 ws://<appId>/1.0 这样的错误 URL。
        this.client = new ClientCtor(Photon.ConnectionProtocol.Ws, this.appId, '1.0');
        this.client.userId = this.userId;

        // 设置 logger 级别（可调整）
        if (this.client.setLogLevel) {
            this.client.setLogLevel(Photon.LogLevel.INFO);
        }

        // 绑定回调（使用 JS SDK 的“继承并重写方法”的旧风格 API）
        this._patchCallbacks();

        // 连接到 Photon Cloud
        try {
            this.client.connectToRegionMaster(this.region);
            console.log('[Photon] 正在连接到 Photon Cloud...', { appId: this.appId, region: this.region, userId: this.userId });
        } catch (e) {
            console.error('[Photon] 连接调用失败', e);
        }

        this.initialized = true;
    }

    _patchCallbacks() {
        const self = this;
        const client = this.client;
        if (!client) return;

        // 状态变化
        client.onStateChange = function (state) {
            console.log('[Photon] StateChange:', state);
        };

        // 连接成功，加入 lobby 以接收房间列表更新
        client.onConnect = function () {
            console.log('[Photon] 已连接，加入大厅以接收房间列表');
            try {
                client.joinLobby();
            } catch (e) {
                console.error('[Photon] joinLobby 调用失败', e);
            }
        };

        client.onDisconnect = function (code) {
            console.warn('[Photon] 断开连接', code);
        };

        // 大厅房间列表更新
        client.onRoomListUpdate = function (rooms, roomsUpdated, roomsRemoved) {
            // rooms 是当前全部房间列表（JS SDK 实现可能略有不同）
            const list = (rooms || []).map(r => {
                const maxPlayers = r.maxPlayers || MP_CONFIG.defaultMaxPlayers;
                const curPlayers = r.playerCount || 0;
                const ownerName = r.masterClientId || 'Host';
                return {
                    roomId: r.name,
                    ownerName,
                    currentPlayers: curPlayers,
                    maxPlayers
                };
            });

            console.log('[Photon] 房间列表更新', list);

            if (typeof self.onRoomListUpdate === 'function') {
                try {
                    self.onRoomListUpdate(list);
                } catch (e) {
                    console.error('[Photon] onRoomListUpdate 回调异常', e);
                }
            }
        };

        // 进入房间
        client.onJoinRoom = function () {
            const room = client.myRoom();
            console.log('[Photon] 已加入房间', room && room.name, room);
        };

        client.onCreateRoom = function () {
            const room = client.myRoom();
            console.log('[Photon] 已创建并加入房间', room && room.name, room);
        };

        // 其他玩家进出房间
        client.onActorJoin = function (actor) {
            console.log('[Photon] 玩家加入房间', actor);
        };

        client.onActorLeave = function (actor, actorId) {
            console.log('[Photon] 玩家离开房间', actorId, actor);
        };

        // 收到事件（后续用于同步玩家位置）
        client.onEvent = function (code, data, actorId) {
            // 例如约定 code === 1 为玩家状态同步
            // sendLocalPlayerState 中已经将本地 playerId(=userId) 写入 data.playerId，
            // 因此这里优先使用 data.playerId，只有在缺失时才退回 actorId。
            if (code === 1 && typeof self.onPlayerStateUpdate === 'function') {
                let playerId = null;

                if (data && data.playerId) {
                    playerId = String(data.playerId);
                } else if (typeof actorId !== 'undefined') {
                    playerId = String(actorId);
                }

                const payload = {
                    playerId,
                    pos: data && data.pos ? data.pos : { x: 0, y: 0, z: 0 },
                    rotY: data && typeof data.rotY === 'number' ? data.rotY : 0,
                    ts: data && data.ts ? data.ts : Date.now()
                };
                try {
                    self.onPlayerStateUpdate(payload);
                } catch (e) {
                    console.error('[Photon] onPlayerStateUpdate 回调异常', e);
                }
            }
        };
    }

    ensureInitialized() {
        if (!this.initialized) {
            this.init({});
        }
    }

    /**
     * 获取当前房间列表（从最近一次 lobby 更新缓存中构造）。
     * 由于 JS SDK 没有直接暴露缓存数组，这里依赖 onRoomListUpdate 时的回调数据，
     * 简单做一个本地缓存，便于 stashUI 初始化时同步一份列表。
     */
    getRoomList() {
        this.ensureInitialized();
        // 这里返回空数组；真正的房间列表会通过 setRoomListUpdateHandler 推送
        return [];
    }

    /**
     * 获取房间成员列表
     * 仅对当前所在房间有效；对于 lobby 中任意房间，Photon 默认不提供完整成员列表，
     * 只有进入房间后才能知道成员。
     */
    getRoomPlayers(roomId) {
        this.ensureInitialized();
        if (!this.client) return [];

        const room = this.client.myRoom();
        if (!room || room.name !== roomId) {
            return [];
        }

        const players = [];
        const actors = room.actors || {};
        Object.keys(actors).forEach(id => {
            const a = actors[id];
            if (!a) return;
            players.push({
                userId: a.userId || String(a.actorNr || id),
                name: (a.name || a.userId || `Player${id}`)
            });
        });
        return players;
    }

    /**
     * 订阅房间列表变化
     */
    setRoomListUpdateHandler(handler) {
        this.onRoomListUpdate = handler;
        // Photon 会在 joinLobby 后主动触发一次 onRoomListUpdate，无需这里手动调用
    }

    /**
     * 创建房间
     */
    async createRoom({ roomId, maxPlayers, ownerName, playerName }) {
        this.ensureInitialized();
        if (!this.client) {
            throw new Error('Photon client not initialized');
        }

        const name = playerName || ownerName || this.userId;

        // 设置本地玩家的昵称到自定义属性（可选）
        try {
            this.client.myActor().setName(name);
        } catch (e) {
            // 某些版本 SDK 可能没有 setName
            console.warn('[Photon] 设置玩家名称失败（可能不支持）', e);
        }

        const options = {
            maxPlayers: maxPlayers || MP_CONFIG.defaultMaxPlayers
        };

        return new Promise((resolve, reject) => {
            const client = this.client;
            const onError = (code, msg) => {
                console.error('[Photon] createRoom 失败', code, msg);
                reject(new Error(msg || 'createRoom failed'));
            };

            // 部分 JS SDK 通过 opCreateRoom 返回 bool，无法直接 Promise；
            // 这里假设调用成功会很快触发 onCreateRoom/onJoinRoom，从而我们在外层监听。
            try {
                // Photon JS SDK 命名: createRoom(roomName, options)
                // 先传入房间ID，后传入选项对象，如 maxPlayers
                client.createRoom(roomId || undefined, {
                    maxPlayers: options.maxPlayers
                });
                // 简单用超时模拟：几百毫秒后读取当前房间信息
                setTimeout(() => {
                    const room = client.myRoom();
                    if (!room) {
                        reject(new Error('Room not joined after createRoom'));
                        return;
                    }
                    const info = {
                        roomId: room.name,
                        ownerName: ownerName || name,
                        currentPlayers: room.playerCount || 1,
                        maxPlayers: room.maxPlayers || options.maxPlayers
                    };
                    resolve(info);
                }, 500);
            } catch (e) {
                onError(-1, e && e.message);
            }
        });
    }

    /**
     * 加入已有房间
     */
    async joinRoom({ roomId, playerName }) {
        this.ensureInitialized();
        if (!this.client) {
            throw new Error('Photon client not initialized');
        }

        const name = playerName || this.userId;

        try {
            this.client.myActor().setName(name);
        } catch (e) {
            console.warn('[Photon] 设置玩家名称失败（可能不支持）', e);
        }

        return new Promise((resolve, reject) => {
            const client = this.client;

            try {
                client.joinRoom(roomId);
                setTimeout(() => {
                    const room = client.myRoom();
                    if (!room || room.name !== roomId) {
                        reject(new Error('Join room failed or wrong room'));
                        return;
                    }
                    const info = {
                        roomId: room.name,
                        ownerName: room.masterClientId || 'Host',
                        currentPlayers: room.playerCount || 1,
                        maxPlayers: room.maxPlayers || MP_CONFIG.defaultMaxPlayers
                    };
                    resolve(info);
                }, 500);
            } catch (e) {
                console.error('[Photon] joinRoom 调用失败', e);
                reject(e);
            }
        });
    }

    /**
     * 注册远端玩家状态更新回调
     */
    setPlayerStateUpdateHandler(handler) {
        this.onPlayerStateUpdate = handler;
    }

    /**
     * 发送本地玩家状态（位置/朝向），后续在 main.js 的动画循环中调用。
     * 这里使用 Photon 的 raiseEvent，事件码暂定为 1。
     */
    sendLocalPlayerState({ roomId, playerId, pos, rotY }) {
        if (!this.client) return;
        const room = this.client.myRoom();
        if (!room || (roomId && room.name !== roomId)) return;

        const data = {
            playerId: playerId || this.userId,
            pos: pos || { x: 0, y: 0, z: 0 },
            rotY: typeof rotY === 'number' ? rotY : 0,
            ts: Date.now()
        };

        try {
            this.client.raiseEvent(1, data, { receivers: Photon.LoadBalancing.Constants.ReceiverGroup.Others });
        } catch (e) {
            console.error('[Photon] 发送玩家状态失败', e);
        }
    }
}

export const photonClient = new RealtimePhotonClient();
