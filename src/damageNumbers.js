import * as THREE from 'three';
import { state } from './globals.js';

// 存储所有活跃的伤害数字元素
const activeDamageNumbers = new Set();

// 伤害数字显示系统 - 3D世界固定位置，动态大小
export function showDamageNumber(damage, worldPosition, isHeadshot = false) {
    const container = document.getElementById('damage-numbers-container');
    if (!container) return;

    // 计算距离并确定字体大小
    const distance = calculateDistance(worldPosition);
    const fontSize = calculateDynamicFontSize(distance, isHeadshot);

    // 创建伤害数字元素
    const damageElement = document.createElement('div');
    damageElement.className = 'damage-number';
    
    // 战术风格的伤害类型判断
    if (isHeadshot) {
        damageElement.classList.add('headshot');
    } else if (damage >= 80) {
        damageElement.classList.add('critical');
    } else {
        damageElement.classList.add('bodyshot');
    }

    // 设置动态字体大小
    damageElement.style.fontSize = fontSize + 'rem';

    // 设置伤害文本 - 整数显示，更简洁
    damageElement.textContent = Math.round(damage).toString();

    // 创建3D固定的伤害数字对象
    const damageNumber = {
        element: damageElement,
        worldPosition: worldPosition.clone(),
        startTime: performance.now(),
        duration: isHeadshot ? 1400 : (damage >= 80 ? 1300 : 1200),
        isHeadshot: isHeadshot,
        damage: damage,
        distance: distance,
        baseFontSize: fontSize
    };

    // 添加到容器和活跃列表
    container.appendChild(damageElement);
    activeDamageNumbers.add(damageNumber);

    // 启动更新循环（如果还没有启动）
    if (!updateLoopRunning) {
        startUpdateLoop();
    }
}

// 计算玩家到目标的距离
function calculateDistance(worldPosition) {
    if (!state.playerBody) return 50; // 默认距离
    
    const playerPos = new THREE.Vector3(
        state.playerBody.position.x,
        state.playerBody.position.y + 1.6, // 玩家眼睛高度
        state.playerBody.position.z
    );
    
    return playerPos.distanceTo(worldPosition);
}

// 根据距离计算动态字体大小
function calculateDynamicFontSize(distance, isHeadshot) {
    // 基础大小参数
    const baseSize = isHeadshot ? 1.5 : 1.2; // 远距离基础大小
    const maxMultiplier = 4.0; // 贴脸时最大4倍
    const criticalDistance = 5; // 5米内开始剧烈变化
    const maxDistance = 100; // 100米后几乎不变
    
    // 使用指数衰减公式，近距离变化剧烈，远距离平缓
    let multiplier;
    if (distance <= criticalDistance) {
        // 5米内：线性从4倍衰减到1倍
        multiplier = maxMultiplier - (maxMultiplier - 1) * (distance / criticalDistance);
    } else {
        // 5米外：指数衰减，快速接近1
        const excessDistance = distance - criticalDistance;
        const decayRange = maxDistance - criticalDistance;
        const decayFactor = Math.exp(-3 * (excessDistance / decayRange)); // 指数衰减
        multiplier = 1 + decayFactor * 0.1; // 1.1倍快速衰减到1倍
    }
    
    // 计算最终字体大小
    const fontSize = baseSize * multiplier;
    
    // 限制最大最小值
    const maxSize = baseSize * maxMultiplier;
    const minSize = baseSize * 0.9;
    return Math.max(minSize, Math.min(maxSize, fontSize));
}

// 更新循环标志
let updateLoopRunning = false;

// 启动伤害数字更新循环
function startUpdateLoop() {
    updateLoopRunning = true;
    updateDamageNumbers();
}

// 更新所有伤害数字的位置和状态
function updateDamageNumbers() {
    if (!state.camera) {
        requestAnimationFrame(updateDamageNumbers);
        return;
    }

    const now = performance.now();
    const toRemove = [];

    activeDamageNumbers.forEach(damageNumber => {
        const elapsed = now - damageNumber.startTime;
        const progress = elapsed / damageNumber.duration;

        // 如果动画结束，标记删除
        if (progress >= 1) {
            toRemove.push(damageNumber);
            return;
        }

        // 计算当前3D位置（从击中点开始向上浮动）
        const currentWorldPos = damageNumber.worldPosition.clone();
        const floatHeight = progress * 1.0; // 向上浮动1米（3D世界距离）
        currentWorldPos.y += floatHeight;

        // 转换为屏幕坐标
        const screenPos = worldToScreen(currentWorldPos);

        // 使用屏幕绝对距离（像素）进行微调
        const pixelOffset = -50; // 向上偏移50像素（绝对屏幕距离）
        screenPos.y += pixelOffset;

        // 如果在屏幕外，隐藏元素
        if (screenPos.x < -50 || screenPos.x > window.innerWidth + 50 || 
            screenPos.y < -50 || screenPos.y > window.innerHeight + 50) {
            damageNumber.element.style.display = 'none';
        } else {
            damageNumber.element.style.display = 'block';
            damageNumber.element.style.left = screenPos.x + 'px';
            damageNumber.element.style.top = screenPos.y + 'px';
        }

        // 计算动画透明度和缩放
        let opacity = 1;
        let scale = 1;

        if (damageNumber.isHeadshot) {
            // 爆头特殊动画：先跳出来再收缩
            if (progress < 0.1) {
                // 前10%：快速跳出来
                scale = 0.3 + (progress / 0.1) * 2.0; // 从0.3跳到2.3
                opacity = progress / 0.1;
            } else if (progress < 0.2) {
                // 10%-20%：用力收缩
                scale = 2.3 - ((progress - 0.1) / 0.1) * 1.3; // 从2.3收缩到1.0
                opacity = 1;
            } else if (progress > 0.7) {
                // 70%后：淡出
                opacity = (1 - progress) / 0.3;
                scale = 1 - (progress - 0.7) * 0.5;
            } else {
                // 中间阶段：保持稳定
                opacity = 1;
                scale = 1;
            }
        } else {
            // 普通伤害动画
            if (progress < 0.2) {
                opacity = progress / 0.2; // 淡入
                scale = 0.8 + (progress / 0.2) * 0.2; // 从0.8到1
            } else if (progress > 0.7) {
                opacity = (1 - progress) / 0.3; // 淡出
                scale = 1 - (progress - 0.7) * 0.3; // 缓慢缩小
            } else {
                opacity = 1;
                scale = 1;
            }
        }

        damageNumber.element.style.opacity = opacity;
        damageNumber.element.style.transform = `scale(${scale})`;
    });

    // 移除已结束的数字
    toRemove.forEach(damageNumber => {
        if (damageNumber.element.parentNode) {
            damageNumber.element.parentNode.removeChild(damageNumber.element);
        }
        activeDamageNumbers.delete(damageNumber);
    });

    // 如果还有活跃数字，继续循环
    if (activeDamageNumbers.size > 0) {
        requestAnimationFrame(updateDamageNumbers);
    } else {
        updateLoopRunning = false;
    }
}

// 将3D世界坐标转换为屏幕坐标
function worldToScreen(worldPosition) {
    // 克隆位置避免修改原始向量
    const pos = worldPosition.clone();

    // 转换为屏幕坐标
    pos.project(state.camera);

    // 将标准化坐标转换为像素坐标
    const x = (pos.x + 1) * window.innerWidth / 2;
    const y = (-pos.y + 1) * window.innerHeight / 2;

    return { x, y };
}

// 批量显示伤害数字（用于连续伤害）
export function showMultipleDamageNumbers(damageList, worldPosition) {
    damageList.forEach((damage, index) => {
        setTimeout(() => {
            const offset = new THREE.Vector3(
                (Math.random() - 0.5) * 0.3,
                index * 0.2,
                (Math.random() - 0.5) * 0.3
            );
            const pos = worldPosition.clone().add(offset);
            showDamageNumber(damage, pos, false);
        }, index * 80);
    });
}
