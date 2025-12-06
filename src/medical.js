import { state } from './globals.js';
import { updateUI } from './ui.js';

// 医疗系统配置
const MEDKIT_CONFIG = {
    channelTime: 2000, // 2秒读条
    healPerSecond: 15, // 每秒恢复15%
    startDelay: 2000 // 前2秒不回复
};

const ARMOR_KIT_CONFIG = {
    channelTime: 2000, // 2秒读条
    repairPerSecond: 20, // 每秒恢复20%
    startDelay: 2000 // 前2秒不回复
};

// 开始使用绷带
export function startHealing() {
    // 检查条件
    if (state.isHealing || state.isRepairingArmor) {
        console.log('❌ 正在使用其他医疗物品');
        return false;
    }
    
    if (state.medkits <= 0) {
        console.log('❌ 绷带用完了');
        return false;
    }
    
    if (state.health >= 100) {
        console.log('❌ 血量已满');
        return false;
    }
    
    state.isHealing = true;
    state.healingStartTime = performance.now();
    console.log('💊 开始使用绷带（移动速度-70%，无法开枪）');
    updateUI();
    return true;
}

// 开始修复护甲
export function startArmorRepair() {
    // 检查条件
    if (state.isHealing || state.isRepairingArmor) {
        console.log('❌ 正在使用其他医疗物品');
        return false;
    }
    
    if (state.armorKits <= 0) {
        console.log('❌ 护甲修复包用完了');
        return false;
    }
    
    if (state.armor >= state.maxArmor) {
        console.log('❌ 护甲已满');
        return false;
    }
    
    state.isRepairingArmor = true;
    state.armorRepairStartTime = performance.now();
    console.log('🔧 开始修复护甲（移动速度-70%，无法开枪）');
    updateUI();
    return true;
}

// 取消医疗（再次按键时）
export function cancelHealing() {
    if (state.isHealing) {
        state.isHealing = false;
        console.log('❌ 取消使用绷带');
        updateUI();
    }
}

export function cancelArmorRepair() {
    if (state.isRepairingArmor) {
        state.isRepairingArmor = false;
        console.log('❌ 取消修复护甲');
        updateUI();
    }
}

// 更新医疗系统（每帧调用）
export function updateMedical(dt) {
    const now = performance.now();
    
    // 更新绷带使用
    if (state.isHealing) {
        const elapsed = now - state.healingStartTime;
        
        // 读条期间（前4秒）
        if (elapsed < MEDKIT_CONFIG.startDelay) {
            // 不回复，只更新UI显示进度
            updateUI();
        } else {
            // 读条完成，开始回复
            const healAmount = MEDKIT_CONFIG.healPerSecond * dt; // 每秒15点血量
            const cost = healAmount; // 消耗等于回复量（1容量=1血量）
            
            if (state.medkits > 0 && state.health < 100) {
                const actualHeal = Math.min(healAmount, 100 - state.health, state.medkits);
                state.health = Math.min(100, state.health + actualHeal);
                state.medkits = Math.max(0, state.medkits - actualHeal);
                updateUI();
            } else {
                // 完成或用完
                state.isHealing = false;
                if (state.medkits <= 0) {
                    console.log('✅ 绷带用完');
                } else {
                    console.log('✅ 血量已满');
                }
                updateUI();
            }
        }
    }
    
    // 更新护甲修复
    if (state.isRepairingArmor) {
        const elapsed = now - state.armorRepairStartTime;
        
        // 读条期间（前3秒）
        if (elapsed < ARMOR_KIT_CONFIG.startDelay) {
            // 不回复，只更新UI显示进度
            updateUI();
        } else {
            // 读条完成，开始修复
            // 每秒修复20点护甲（固定值，不按百分比）
            const repairAmount = ARMOR_KIT_CONFIG.repairPerSecond * dt;
            const cost = repairAmount; // 消耗等于修复量（1容量=1护甲）
            
            if (state.armorKits > 0 && state.armor < state.maxArmor) {
                const actualRepair = Math.min(repairAmount, state.maxArmor - state.armor, state.armorKits);
                state.armor = Math.min(state.maxArmor, state.armor + actualRepair);
                state.armorKits = Math.max(0, state.armorKits - actualRepair);
                updateUI();
            } else {
                // 完成或用完
                state.isRepairingArmor = false;
                if (state.armorKits <= 0) {
                    console.log('✅ 护甲修复包用完');
                } else {
                    console.log('✅ 护甲已满');
                }
                updateUI();
            }
        }
    }
}

// 获取医疗包进度（0-1）
export function getHealingProgress() {
    if (!state.isHealing) return 0;
    const elapsed = performance.now() - state.healingStartTime;
    return Math.min(1, elapsed / MEDKIT_CONFIG.channelTime);
}

export function getArmorRepairProgress() {
    if (!state.isRepairingArmor) return 0;
    const elapsed = performance.now() - state.armorRepairStartTime;
    return Math.min(1, elapsed / ARMOR_KIT_CONFIG.channelTime);
}
