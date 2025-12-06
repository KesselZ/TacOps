import * as THREE from 'three';
import { state } from './globals.js';

// 多人游戏玩家管理
class MultiplayerPlayers {
    constructor() {
        // playerId -> { mesh, name, currentPos, targetPos, currentRotY, targetRotY }
        this.otherPlayers = new Map();
        this.playerColors = [
            0xff0000, // 红色
            0x0000ff, // 蓝色  
            0x00ff00, // 绿色
            0xffff00, // 黄色
            0xff00ff, // 紫色
            0x00ffff, // 青色
            0xff8800, // 橙色
            0xff0088  // 粉色
        ];
    }

    // 添加其他玩家（当前全部视为“敌人”）
    addPlayer(playerId, name) {
        if (this.otherPlayers.has(playerId)) {
            return; // 玩家已存在
        }

        console.log(`[多人] 添加敌对玩家: ${playerId} (${name})`);

        // 敌人风格的简单人形：身体 + 头
        const enemyGroup = new THREE.Group();
        enemyGroup.userData = enemyGroup.userData || {};
        enemyGroup.userData.type = 'remotePlayer';
        enemyGroup.userData.playerId = playerId;
        enemyGroup.userData.isDynamic = true;

        // 身体：略高的长方体
        const bodyGeom = new THREE.BoxGeometry(0.8, 1.4, 0.4);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0xef4444 }); // 敌人统一用红色
        const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
        bodyMesh.userData = bodyMesh.userData || {};
        bodyMesh.userData.type = 'remotePlayerBody';
        bodyMesh.userData.playerId = playerId;
        bodyMesh.userData.isDynamic = true;
        bodyMesh.userData.isActive = true;
        bodyMesh.position.y = 0.7; // 身体中心抬起
        enemyGroup.add(bodyMesh);

        // 头：一个球体
        const headGeom = new THREE.SphereGeometry(0.35, 16, 16);
        const headMat = new THREE.MeshStandardMaterial({ color: 0xf97316 }); // 头部稍微偏橙，便于区分轮廓
        const headMesh = new THREE.Mesh(headGeom, headMat);
        headMesh.userData = headMesh.userData || {};
        headMesh.userData.type = 'remotePlayerHead';
        headMesh.userData.playerId = playerId;
        headMesh.userData.isDynamic = true;
        headMesh.userData.isActive = true;
        headMesh.position.y = 1.5;
        enemyGroup.add(headMesh);
        
        // 设置初始位置（当前位置和目标位置都从原点开始）
        const currentPos = new THREE.Vector3(0, 0, 0);
        const targetPos = new THREE.Vector3(0, 0, 0);
        enemyGroup.position.copy(currentPos);
        
        // 添加到场景
        state.scene.add(enemyGroup);

        // 注册为动态物体，参与玩家武器 hitscan / 子弹碰撞候选集
        if (state.activeDynamicMeshes) {
            if (!state.activeDynamicMeshes.includes(bodyMesh)) {
                state.activeDynamicMeshes.push(bodyMesh);
            }
            if (!state.activeDynamicMeshes.includes(headMesh)) {
                state.activeDynamicMeshes.push(headMesh);
            }
        }
        
        // 保存引用
        this.otherPlayers.set(playerId, {
            mesh: enemyGroup,
            name: name || `Player_${playerId.slice(-4)}`,
            currentPos,
            targetPos,
            currentRotY: 0,
            targetRotY: 0,
            alive: true // 默认存活
        });
    }

    // 更新远端玩家存活状态：隐藏/显示模型，并控制命中检测
    setPlayerAlive(playerId, alive) {
        const info = this.otherPlayers.get(playerId);
        if (!info) return;
        const mesh = info.mesh;
        mesh.visible = alive;
        info.alive = alive; // 更新存活状态
        
        console.log('[多人玩家] 玩家存活状态更新:', {
            playerId,
            alive,
            meshVisible: mesh.visible,
            name: info.name
        });

        const parts = [];
        mesh.traverse(child => {
            if (child.userData && (child.userData.type === 'remotePlayerHead' || child.userData.type === 'remotePlayerBody')) {
                parts.push(child);
            }
        });

        parts.forEach(part => {
            part.userData.isActive = !!alive;
            // 在 activeDynamicMeshes 中增/删
            const idx = state.activeDynamicMeshes.indexOf(part);
            if (alive) {
                if (idx === -1) state.activeDynamicMeshes.push(part);
            } else {
                if (idx !== -1) state.activeDynamicMeshes.splice(idx, 1);
            }
        });
    }

    // 移除其他玩家
    removePlayer(playerId) {
        const playerData = this.otherPlayers.get(playerId);
        if (playerData) {
            console.log(`[多人] 移除玩家: ${playerId}`);
            state.scene.remove(playerData.mesh);
            playerData.mesh.geometry.dispose();
            playerData.mesh.material.dispose();
            this.otherPlayers.delete(playerId);
        }
    }

    // 更新玩家位置和旋转
    updatePlayer(playerId, pos, rotY) {
        const playerData = this.otherPlayers.get(playerId);
        if (playerData) {
            // 只更新目标位置和目标朝向，由 updateAll 每帧插值过去
            if (pos) {
                playerData.targetPos.set(pos.x, pos.y + 1, pos.z);
            }
            if (typeof rotY === 'number') {
                playerData.targetRotY = rotY;
            }
        }
    }

    // 每帧更新：对所有远端玩家做插值平滑
    updateAll(dt) {
        // 简单线性插值参数：根据 dt 和期望时间常数（例如 0.1s）计算
        const positionLerpTime = 0.1; // 希望大约 0.1 秒追上目标
        const alpha = Math.max(0, Math.min(1, dt / positionLerpTime));

        this.otherPlayers.forEach((playerData) => {
            // 跳过死亡玩家的插值，避免飘移
            if (!playerData.alive) return;
            
            const { mesh, currentPos, targetPos } = playerData;

            // 位置插值
            currentPos.lerp(targetPos, alpha);
            mesh.position.copy(currentPos);

            // 朝向插值（简单线性插值，足够应付 FPS 视角）
            const currentRotY = playerData.currentRotY;
            const targetRotY = playerData.targetRotY;
            const rotDelta = targetRotY - currentRotY;
            const rotStep = rotDelta * alpha;
            playerData.currentRotY = currentRotY + rotStep;
            mesh.rotation.y = playerData.currentRotY;
        });
    }

    // 清理所有玩家
    clearAll() {
        for (const [playerId, playerData] of this.otherPlayers) {
            state.scene.remove(playerData.mesh);
            playerData.mesh.geometry.dispose();
            playerData.mesh.material.dispose();
        }
        this.otherPlayers.clear();
    }

    // 获取当前玩家数量
    getPlayerCount() {
        return this.otherPlayers.size;
    }

    // 检查玩家是否存在
    hasPlayer(playerId) {
        return this.otherPlayers.has(playerId);
    }
}

// 导出单例
export const multiplayerPlayers = new MultiplayerPlayers();
