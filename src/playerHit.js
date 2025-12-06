import { state } from './globals.js';
import { CONFIG } from './config.js';
import { updateUI, triggerDamageOverlay } from './ui.js';
import { spawnDebris } from './world.js';
import * as THREE from 'three';

// 统一处理主角受到攻击的效果
// damage: 伤害数值
// sourcePosition: 伤害来源位置（用于计算击退），可以是 THREE.Vector3 或包含 x/z 的对象
// knockbackScale: 击退强度相对于 CONFIG.knockbackStrength 的倍率
// showOverlay: 是否显示红色受击边框
export function applyPlayerHit({ damage, sourcePosition, knockbackScale = 1.0, showOverlay = true }) {
    if (!state.playerBody) return;

    const originalDamage = damage;
    const armorBefore = state.armor;
    const healthBefore = state.health;

    // 先扣护甲，护甲扣完再扣血
    if (state.armor > 0) {
        if (damage <= state.armor) {
            // 伤害全部被护甲吸收
            state.armor -= damage;
            damage = 0;
        } else {
            // 护甲被打穿，剩余伤害扣血
            damage -= state.armor;
            state.armor = 0;
        }
    }
    
    // 扣除剩余伤害到生命值
    if (damage > 0) {
        state.health -= damage;
        if (state.health < 0) state.health = 0;
    }
    
    // 生成碎片：有护甲时掉灰色碎片，无护甲时掉血渣
    const debrisPos = new THREE.Vector3(
        state.playerBody.position.x,
        state.playerBody.position.y + 0.8,
        state.playerBody.position.z
    );
    const debrisNormal = new THREE.Vector3(0, 1, 0);
    const debrisColor = armorBefore > 0 ? 0x888888 : 0xaa0000; // 灰色或血红色
    spawnDebris(debrisPos, debrisNormal, debrisColor, 6);
    
    updateUI();

    // 受击红屏
    if (showOverlay) triggerDamageOverlay();

    // 击退：一次性速度惩罚，根据强度计算WASD削弱时间
    if (sourcePosition && state.playerBody) {
        const dx = state.playerBody.position.x - sourcePosition.x;
        const dz = state.playerBody.position.z - sourcePosition.z;
        const dirLength = Math.sqrt(dx * dx + dz * dz);
        
        const strength = CONFIG.knockbackStrength * knockbackScale;
        
        // 根据击退强度计算禁用时间：t = strength / 减速率 * 系数
        // 减速率是45 m/s²，系数0.8让禁用时间稍微短于完全停止时间
        const decelerationRate = 45.0;
        const disableTimeFactor = 0.8;
        state.knockbackDisableTime = (strength / decelerationRate) * disableTimeFactor;
        
        // 只用方向，不用距离 - 击退强度与距离无关
        if (dirLength > 0.001) {  // 避免除零错误
            const dirX = dx / dirLength;  // 单位方向向量
            const dirZ = dz / dirLength;  // 单位方向向量
            
            // 直接加到玩家当前速度上，不存储为持续状态
            state.playerBody.velocity.x += dirX * strength;
            state.playerBody.velocity.z += dirZ * strength;
        } else {
            // 如果距离为0，给一个随机的击退方向
            const randomAngle = Math.random() * Math.PI * 2;
            state.playerBody.velocity.x += Math.cos(randomAngle) * strength;
            state.playerBody.velocity.z += Math.sin(randomAngle) * strength;
        }
    }
}
