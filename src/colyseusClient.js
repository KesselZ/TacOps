import { MP_CONFIG } from './mpConfig.js';

// 导入多人玩家管理
import { multiplayerPlayers } from './multiplayerPlayers.js';

// Colyseus 客户端封装
// 保持与 photonClient.js 相同的 API 接口，便于无缝替换
class ColyseusGameClient {
    constructor() {
        this.initialized = false;
        this.client = null;
        this.room = null;
        this.userId = null;
        this.playersListenersInitialized = false;
        this.lastHitTarget = null; // { sessionId, ts, isHead }

        /** @type {(rooms: any[]) => void} */
        this.onRoomListUpdate = null;

        /** @type {Record<string, { userId: string, name: string }[]>} */
        this.roomMembers = {};

        /** @type {(payload: { playerId: string, pos: any, rotY: number, ts: number }) => void | null} */
        this.onPlayerStateUpdate = null;
    }

    reset() {
        if (this.room) {
            try {
                this.room.leave();
            } catch (e) {
                console.warn('[Colyseus] 离开房间失败:', e);
            }
        }
        this.room = null;
        this.initialized = false;
        this.playersListenersInitialized = false;
    }

    init({ userId }) {
        if (this.initialized) return;

        if (typeof Colyseus === 'undefined') {
            console.error('[Colyseus] Colyseus SDK 未加载，请检查 index.html 中的脚本引入');
            return;
        }

        this.userId = userId || `web-${Math.floor(Math.random() * 1e6)}`;
        
        // 连接到你的 VPS 服务器
        const serverUrl = MP_CONFIG.colyseusServerUrl || 'ws://localhost:2567';
        console.log(`[Colyseus] 正在连接到服务器: ${serverUrl}`);
        
        this.client = new Colyseus.Client(serverUrl);
        this.initialized = true;
        
        console.log(`[Colyseus] 初始化完成，用户ID: ${this.userId}`);
    }

    async getRoomList() {
        if (!this.initialized) {
            throw new Error('Colyseus client not initialized');
        }

        // 注意：浏览器版 colyseus.js@0.16.0 没有 getAvailableRooms API。
        // 为了先打通最小联机流程，这里先返回空列表，
        // 后续如果需要大厅/房间浏览，再根据官方文档单独实现。
        const rooms = [];
        console.warn('[Colyseus] getRoomList: 当前环境不支持获取房间列表，返回空列表占位');

        if (this.onRoomListUpdate) {
            this.onRoomListUpdate(rooms);
        }

        return rooms;
    }

    setRoomListUpdateHandler(callback) {
        this.onRoomListUpdate = callback;
    }

    async createRoom({ roomName, maxPlayers = 4, difficulty = 'normal', mode = 'mp_arena' }) {
        if (!this.initialized) {
            throw new Error('Colyseus client not initialized');
        }

        try {
            console.log('[Colyseus] 创建房间:', { roomName, maxPlayers, difficulty, mode });
            
            this.room = await this.client.create('my_room', {
                roomName: roomName || `房间_${Date.now()}`,
                maxPlayers,
                difficulty,
                mode,
                createdBy: this.userId
            });

            console.log('[Colyseus] 房间创建成功:', this.room.roomId);
            this.setupRoomHandlers();
            
            return {
                roomId: this.room.roomId,
                name: roomName
            };
        } catch (error) {
            console.error('[Colyseus] 创建房间失败:', error);
            throw error;
        }
    }

    async joinRoom({ roomId, roomName }) {
        if (!this.initialized) {
            throw new Error('Colyseus client not initialized');
        }

        try {
            console.log('[Colyseus] 加入房间:', { roomId, roomName });
            
            if (roomId) {
                this.room = await this.client.joinById(roomId);
            } else if (roomName) {
                this.room = await this.client.join('my_room', { roomName });
            } else {
                throw new Error('需要提供 roomId 或 roomName');
            }

            console.log('[Colyseus] 成功加入房间:', this.room.roomId);
            this.setupRoomHandlers();
            
            return {
                roomId: this.room.roomId,
                name: this.room.state.roomName || `房间 #${this.room.roomId.slice(-3)}`
            };
        } catch (error) {
            console.error('[Colyseus] 加入房间失败:', error);
            throw error;
        }
    }

    // 获取当前玩家装备属性，用于同步到服务器
    getEquipmentData() {
        // 从全局状态读取装备属性，如果不存在则使用默认值
        const state = window.state || {};
        
        return {
            maxHp: state.maxHp || 100,
            maxArmor: state.maxArmor || 50,
            weaponDamageScale: state.weaponDamageScale || 1.0,
            weaponHeadshotMultiplier: state.weaponHeadshotMultiplier || 2.0,
            ammoDamageMultiplier: state.ammoDamageMultiplier || 1.0
        };
    }

    // 监听本地玩家状态变化（hp、armor、alive等）
    setupLocalPlayerStateMonitoring(player) {
        // 监听hp变化
        player.onChange = () => {
            this.updateLocalPlayerUI(player);

            // 本地玩家可见性切换：死亡时隐藏自身模型，复活时显示
            if (typeof player.alive === 'boolean') {
                const visible = !!player.alive;
                if (state.playerBody) state.playerBody.visible = visible;
                if (state.playerHead) state.playerHead.visible = visible;
            }
        };

        // 初始更新一次UI
        this.updateLocalPlayerUI(player);
    }

    // 更新本地玩家UI和控制状态
    updateLocalPlayerUI(player) {
        const state = window.state || {};
        
        // 更新血量和护甲显示（仅限联机模式）
        if (state.gameMode === 'mp_arena') {
            state.mpHp = player.hp || 0;
            state.mpArmor = player.armor || 0;
            state.mpAlive = player.alive !== false;
            
            // 触发UI更新（如果存在UI更新函数）
            if (typeof window.updateMultiplayerHealthUI === 'function') {
                window.updateMultiplayerHealthUI();
            }
        }

        // 控制输入禁用/启用
        const isAlive = player.alive !== false;
        if (typeof window.setPlayerInputEnabled === 'function') {
            window.setPlayerInputEnabled(isAlive);
        }
    }

    setupRoomHandlers() {
        if (!this.room) return;

        // 发送join消息创建玩家，包含装备属性
        const equipmentData = this.getEquipmentData();
        this.room.send('join', { 
            name: this.userId,
            ...equipmentData
        });

        // 房间状态变化（高频更新，这里不再打印详细日志，避免刷屏）
        this.room.onStateChange((state) => {
            // console.log('[Colyseus] 房间状态更新:', state);

            if (!state.players) {
                return;
            }

            // 第一次拿到 players 时，初始化监听和现有玩家
            if (!this.playersListenersInitialized) {
                this.playersListenersInitialized = true;

                // 处理已存在的玩家（加入房间时已经在的玩家）
                state.players.forEach((player, sessionId) => {
                    const isLocal = sessionId === this.room.sessionId;
                    if (!isLocal) {
                        multiplayerPlayers.addPlayer(sessionId, player.name);
                        // 监听远端玩家 alive 变化，隐藏模型 & 关闭命中检测
                        player.onChange = (changes) => {
                            changes.forEach(change => {
                                if (change.field === 'alive') {
                                    multiplayerPlayers.setPlayerAlive(sessionId, player.alive);
                                    if (!player.alive && this.lastHitTarget?.sessionId === sessionId && Date.now() - (this.lastHitTarget?.ts || 0) < 4000) {
                                        console.log('[击杀提示] 显示击杀提示:', {
                                            deadSessionId: sessionId,
                                            lastHitTarget: this.lastHitTarget,
                                            timeDiff: Date.now() - (this.lastHitTarget?.ts || 0)
                                        });
                                        if (window.showKillMarker) window.showKillMarker(this.lastHitTarget.isHead);
                                        this.lastHitTarget = null;
                                    }
                                }
                            });
                        };
                    } else {
                        // 本地玩家已经存在，立即设置状态监控
                        this.setupLocalPlayerStateMonitoring(player);
                    }
                });

                // 玩家加入（MapSchema 使用属性赋值 onAdd）
                state.players.onAdd = (player, sessionId) => {
                    console.log('[Colyseus] 玩家加入房间:', sessionId, player);
                    this.updateRoomMembers();

                    if (sessionId !== this.room.sessionId) {
                        multiplayerPlayers.addPlayer(sessionId, player.name);
                        player.onChange = (changes) => {
                            changes.forEach(change => {
                                if (change.field === 'alive') {
                                    multiplayerPlayers.setPlayerAlive(sessionId, player.alive);
                                    if (!player.alive && this.lastHitTarget?.sessionId === sessionId && Date.now() - (this.lastHitTarget?.ts || 0) < 4000) {
                                        console.log('[击杀提示] 显示击杀提示:', {
                                            deadSessionId: sessionId,
                                            lastHitTarget: this.lastHitTarget,
                                            timeDiff: Date.now() - (this.lastHitTarget?.ts || 0)
                                        });
                                        if (window.showKillMarker) window.showKillMarker(this.lastHitTarget.isHead);
                                        this.lastHitTarget = null;
                                    }
                                }
                            });
                        };
                    } else {
                        // 本地玩家加入，设置状态变化监听
                        this.setupLocalPlayerStateMonitoring(player);
                    }
                };

                // 玩家离开
                state.players.onRemove = (player, sessionId) => {
                    console.log('[Colyseus] 玩家离开房间:', sessionId);
                    this.updateRoomMembers();

                    if (sessionId !== this.room.sessionId) {
                        multiplayerPlayers.removePlayer(sessionId);
                    }
                };
            }

            // 每次状态变更时，同步一次成员列表
            this.updateRoomMembers();

            // 根据当前 state.players 全量同步所有远端玩家的位置
            state.players.forEach((player, sessionId) => {
                if (sessionId === this.room.sessionId) return; // 忽略本地玩家

                const pos = { x: player.x || 0, y: player.y || 0, z: player.z || 0 };
                const rotY = player.ry || 0;

                // 若主循环中还有 setPlayerStateUpdateHandler，也一并通知
                if (this.onPlayerStateUpdate) {
                    this.onPlayerStateUpdate({
                        playerId: sessionId,
                        pos,
                        rotY,
                        ts: Date.now()
                    });
                }
            });
        });

        // 错误处理
        this.room.onError((code, message) => {
            console.error('[Colyseus] 房间错误:', code, message);
        });

        // 断开连接处理
        this.room.onLeave(() => {
            console.log('[Colyseus] 离开房间');
            // 清理所有其他玩家
            multiplayerPlayers.clearAll();
        });

        // 监听自定义消息
        this.room.onMessage('playerState', (data) => {
            if (this.onPlayerStateUpdate) {
                this.onPlayerStateUpdate({
                    playerId: data.sessionId,
                    pos: data.pos,
                    rotY: data.rotY,
                    ts: data.ts
                });
            }
        });
    }

    updateRoomMembers() {
        if (!this.room || !this.room.state?.players) return;

        const members = [];
        this.room.state.players.forEach((player, sessionId) => {
            members.push({
                userId: sessionId,
                name: player.name || `Player_${sessionId.slice(-4)}`
            });
        });

        this.roomMembers[this.room.roomId] = members;
        // console.log('[Colyseus] 更新房间成员:', this.room.roomId, members);
    }

    getRoomPlayers(roomId) {
        return this.roomMembers[roomId] || [];
    }

    sendLocalPlayerState(data) {
        if (!this.room) {
            console.warn('[Colyseus] 未加入房间，无法发送状态');
            return;
        }

        try {
            // 房间状态尚未同步完成时，直接跳过，不报错
            if (!this.room.state || !this.room.state.players) {
                return;
            }

            // 更新自己的状态（写回到 Schema）
            const player = this.room.state.players.get(this.room.sessionId);
            if (player) {
                player.x = data.pos?.x || 0;
                player.y = data.pos?.y || 0;
                player.z = data.pos?.z || 0;
                player.ry = data.rotY || 0;
            }

            // 发送给其他玩家（服务器端根据 move 消息更新对应 Player）
            this.room.send('move', {
                x: data.pos?.x || 0,
                y: data.pos?.y || 0,
                z: data.pos?.z || 0,
                rx: 0, // 暂时不使用，设为0
                ry: data.rotY || 0,
                rz: 0  // 暂时不使用，设为0
            });

            // console.log('[Colyseus] 发送玩家状态:', data);
        } catch (error) {
            console.error('[Colyseus] 发送玩家状态失败:', error);
        }
    }

    setPlayerStateUpdateHandler(callback) {
        this.onPlayerStateUpdate = callback;
    }

    leaveRoom() {
        if (this.room) {
            this.room.leave();
            this.room = null;
        }
    }
}

export const colyseusClient = new ColyseusGameClient();

// 兼容旧逻辑：将客户端实例挂到 window，便于 weapon.js 等代码直接访问
if (typeof window !== 'undefined') {
    window.colyseusClient = colyseusClient;
}
