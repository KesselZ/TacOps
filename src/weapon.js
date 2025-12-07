import * as THREE from 'three';
import { state } from './globals.js';
import { CONFIG } from './config.js';
import { spawnDebris } from './world.js';
import { showKill, showHitmarker, toggleReloadIndicator, updateUI, addScore } from './ui.js';
import { recordWeaponKill, recordWeaponShot } from './statsSession.js';
import { playWeaponShotSound, playHitmarkerSound, playRocketShotSound, playEnemyPistolSound, playMaterialHitSound } from './audio.js';
import { applyPlayerHit } from './playerHit.js';
import { endGame } from './main.js';

// 性能监控变量
let weaponFireCount = 0;
let weaponTotalTime = 0;
let weaponLastReportTime = 0;
let projectileCollisionCount = 0;
let projectileCollisionTime = 0;
let projectileLastReportTime = 0;
let candidateBuildCount = 0;
let candidateBuildTime = 0;
let candidateLastReportTime = 0;

console.log('🔫 武器开枪监控已加载');
console.log('🚀 子弹碰撞检测监控已加载');
console.log('🎯 候选集构建监控已加载');

const CANNON = window.CANNON;

// 弹药基类
export class Projectile {
    constructor(start, direction, isEnemy = false, enemyPosition = null, visualOnly = false) {
        this.start = start.clone();
        this.position = start.clone();
        this.direction = direction.clone().normalize();
        this.isEnemy = isEnemy;
        this.enemyPosition = enemyPosition;
        this.visualOnly = visualOnly;
        this.distanceTraveled = 0;
        this.tracerLine = null;
        this.headMesh = null;
        this.lastTracerPos = start.clone();
        this.hasHit = false;
        
        // 子弹优化：候选集系统
        this.collisionCandidates = [];
        this.initializeCollisionCandidates();
        
        // 检测频率优化：基于距离的动态检测
        this.collisionCheckDistance = 0; // 累计移动距离
        this.collisionCheckThreshold = 0.3; // 默认值，稍后根据实际速度调整
        this.lastCollisionCheckPos = this.position.clone();
        
        // 子类需要设置这些属性
        this.speed = 80;
        this.maxDistance = 200;
        this.damage = 5;
        this.explosionRadius = 0.5;
        this.headRadius = 0.08;
        this.tracerColor = this.isEnemy ? 0xff5500 : 0xffffaa;
        this.headColor = 0xffaa00;
        this.lineWidth = this.isEnemy ? 4.0 : 1.0;
        this.debrisMultiplier = 1; // 掉渣倍数：1=正常, 10=火箭弹级别
        this.debrisSizeMultiplier = 1; // 渣子大小倍数：1=正常, 3=大型碎片
        
        this.createTracer();
    }

    // 子弹优化：开枪瞬间计算碰撞候选集
    initializeCollisionCandidates() {
        const startTime = performance.now();
        candidateBuildCount++;
        
        // 1. 添加所有动态物体（使用活跃物体优化）
        if (state.activeDynamicMeshes) {
            for (const mesh of state.activeDynamicMeshes) {
                if (mesh.isMesh && mesh.userData.isDynamic) {
                    // 排除发射者自己的敌人部件
                    if (this.isEnemy && this.enemyPosition) {
                        const distance = mesh.position.distanceTo(this.enemyPosition);
                        if (distance < 2) continue; // 🛠️ 修复：改用continue，不要return
                    }
                    this.collisionCandidates.push(mesh);
                }
            }
        }
        
        // 🛠️ 修复：确保玩家始终在敌人子弹候选集中
        if (this.isEnemy && state.playerMesh && state.playerMesh.userData.isActive) {
            // 检查玩家是否已经在候选集中（避免重复）
            if (!this.collisionCandidates.includes(state.playerMesh)) {
                this.collisionCandidates.push(state.playerMesh);
                console.log(`🎯 敌人子弹候选集: 添加玩家，总候选数=${this.collisionCandidates.length}`);
            }
        }

        // 2. 射线检测找到第一个静态物体（使用活跃物体优化）
        state.raycaster.set(this.position, this.direction);
        const staticTargets = [];
        
        // 使用活跃静态物体数组，避免全场景遍历
        if (state.activeStaticMeshes) {
            for (const mesh of state.activeStaticMeshes) {
                if (mesh.isMesh && 
                    mesh.userData.isActive && 
                    mesh.userData.isStatic && 
                    mesh !== state.skyMesh && 
                    mesh !== state.muzzleFlash) {
                    staticTargets.push(mesh);
                }
            }
        }
        
        const hits = state.raycaster.intersectObjects(staticTargets);
        if (hits.length > 0) {
            // 只添加射线上的第一个静态物体
            this.collisionCandidates.push(hits[0].object);
        }
        
        const endTime = performance.now();
        candidateBuildTime += (endTime - startTime);
        
        // 🛠️ 调试：检查候选集是否为空
        if (this.collisionCandidates.length === 0) {
            console.warn(`⚠️ 子弹候选集为空！isEnemy=${this.isEnemy}, 活跃静态=${state.activeStaticMeshes?.length||0}, 活跃动态=${state.activeDynamicMeshes?.length||0}`);
        }
        
        reportCandidateStats();
    }

    createTracer() {
        const geo = new THREE.BufferGeometry();
        geo.setFromPoints([this.position, this.position]);
        const mat = new THREE.LineBasicMaterial({ 
            color: this.tracerColor,
            transparent: true,
            opacity: 0.9,
            linewidth: this.lineWidth
        });
        this.tracerLine = new THREE.Line(geo, mat);
        state.scene.add(this.tracerLine);

        // 为敌人弹药添加弹头
        if (this.isEnemy) {
            const headGeo = new THREE.SphereGeometry(this.headRadius, 12, 12);
            const headMat = new THREE.MeshStandardMaterial({ 
                color: this.headColor, 
                emissive: this.headColor, 
                emissiveIntensity: 0.3 
            });
            this.headMesh = new THREE.Mesh(headGeo, headMat);
            this.headMesh.renderOrder = 20;
            state.scene.add(this.headMesh);
        }
        
        // 根据实际子弹速度调整检测阈值
        this.collisionCheckThreshold = Math.min(0.5, Math.max(0.2, this.speed / 200)); // 0.2-0.5米范围
    }

    update(dt) {
        const step = this.speed * dt;
        this.position.add(this.direction.clone().multiplyScalar(step));
        this.distanceTraveled += step;

        // Update tracer line
        const positions = this.tracerLine.geometry.attributes.position.array;
        positions[0] = this.lastTracerPos.x;
        positions[1] = this.lastTracerPos.y;
        positions[2] = this.lastTracerPos.z;
        positions[3] = this.position.x;
        positions[4] = this.position.y;
        positions[5] = this.position.z;
        this.tracerLine.geometry.attributes.position.needsUpdate = true;
        this.lastTracerPos.copy(this.position);

        // 更新敌人子弹的弹头位置
        if (this.headMesh) {
            this.headMesh.position.copy(this.position);
        }

        // 玩家子弹只做视觉效果，不进行碰撞检测
        if (!this.visualOnly) {
            // 检测频率优化：基于距离的动态检测
            this.collisionCheckDistance += step;
            
            // 只有当累计移动距离超过阈值时才进行碰撞检测
            if (this.collisionCheckDistance >= this.collisionCheckThreshold) {
                const collisionStartTime = performance.now();
                projectileCollisionCount++;
                
                // 子弹优化：只检测候选集，不再遍历整个场景
                state.raycaster.set(this.lastCollisionCheckPos, this.direction);
                const hits = state.raycaster.intersectObjects(this.collisionCandidates);

                const collisionEndTime = performance.now();
                projectileCollisionTime += (collisionEndTime - collisionStartTime);
                reportProjectileCollisionStats();

                // 检查碰撞是否发生在当前移动距离内
                if (hits.length > 0 && hits[0].distance < this.collisionCheckDistance) {
                    // 将子弹位置调整到碰撞点
                    this.position.copy(this.lastCollisionCheckPos);
                    this.position.add(this.direction.clone().multiplyScalar(hits[0].distance));
                    this.onHit(hits[0]);
                    return true; // Remove bullet
                }
                
                // 重置检测计数
                this.lastCollisionCheckPos.copy(this.position);
                this.collisionCheckDistance = 0;
            }
        }

        if (this.distanceTraveled >= this.maxDistance) {
            this.destroy();
            return true;
        }

        return false;
    }

    onHit(hit) {
        if (this.hasHit) return;
        this.hasHit = true;

        // 碎片与材质音效
        const color = hit.object.userData?.debrisColor || 0x888888;
        if (hit.object.userData?.canDebris && hit.face) {
            const baseCount = hit.object.userData.debrisCount || 5;
            const wallMultiplier = hit.object.userData.debrisMultiplier || 1;
            const bulletMultiplier = this.debrisMultiplier || 1;
            const totalMultiplier = wallMultiplier * bulletMultiplier;
            const debrisCount = Math.max(1, Math.round(baseCount * totalMultiplier));
            const sizeMultiplier = this.debrisSizeMultiplier || 1;
            spawnDebris(hit.point, hit.face.normal, color, debrisCount, sizeMultiplier);
        }

        if (!this.isEnemy) {
            // 玩家子弹：先检查远端玩家
            let obj = hit.object;
            while (obj && obj !== state.scene) {
                const ud = obj.userData || {};
                if (ud.type === 'remotePlayerHead' || ud.type === 'remotePlayerBody') {
                    const isHead = ud.type === 'remotePlayerHead';
                    const targetSessionId = ud.playerId;
                    const damage = isHead ? this.damage * CONFIG.headshotMultiplier : this.damage;

                    recordWeaponShot({
                        weaponId: state.currentWeaponId || state.weaponConfig?.id || 'unknown',
                        weaponName: state.weaponConfig?.displayName || state.weaponConfig?.name || state.currentWeaponId,
                        damage,
                        isHit: true,
                        hitLocation: isHead ? 'head' : 'body'
                    });
                    showHitmarker(isHead);
                    playHitmarkerSound(isHead);
                    if (window.colyseusClient) {
                        window.colyseusClient.lastHitTarget = {
                            sessionId: targetSessionId,
                            ts: Date.now(),
                            isHead
                        };
                        console.log('[武器] 记录命中目标:', {
                            targetSessionId,
                            isHead,
                            timestamp: Date.now()
                        });
                    }
                    if (state.gameMode === 'mp_arena' && window.colyseusClient?.room && !state.isInputDisabled) {
                        try {
                            window.colyseusClient.room.send('hit', {
                                targetSessionId,
                                part: isHead ? 'head' : 'body',
                                damage
                            });
                        } catch (e) {
                            console.warn('⚠️ 发送远端玩家受击消息失败', e);
                        }
                    }
                    this.destroy();
                    return;
                }
                obj = obj.parent;
            }

            // 再检查 PVE 敌人
            obj = hit.object;
            while (obj && obj !== state.scene) {
                if (state.enemies.some(e => e.mesh === obj.parent)) {
                    const enemy = state.enemies.find(e => e.mesh === obj.parent);
                    const isHead = obj.name === 'head';
                    const damage = isHead ? this.damage * CONFIG.headshotMultiplier : this.damage;

                    enemy.hit(isHead, hit.point);
                    recordWeaponShot({
                        weaponId: state.currentWeaponId || state.weaponConfig?.id || 'unknown',
                        weaponName: state.weaponConfig?.displayName || state.weaponConfig?.name || state.currentWeaponId,
                        damage,
                        isHit: true,
                        hitLocation: isHead ? 'head' : 'body'
                    });
                    showHitmarker(isHead);
                    playHitmarkerSound(isHead);

                    let reward = 20;
                    if (enemy.type === 'pistol') reward = 30;
                    else if (enemy.type === 'rocket') reward = 50;
                    else if (enemy.type === 'special') reward = 95;
                    addScore(reward);
                    showKill(isHead);
                    recordWeaponKill({
                        weaponId: state.currentWeaponId || state.weaponConfig?.id || 'unknown',
                        weaponName: state.weaponConfig?.displayName || state.weaponConfig?.name || state.currentWeaponId,
                        damage,
                        score: reward
                    });
                    this.destroy();
                    return;
                }
                obj = obj.parent;
            }
        } else {
            // 敌人弹药击中玩家
            const hitPlayer = (hit.object === state.playerMesh || hit.object.userData?.isPlayer);
            if (hitPlayer) {
                if (this instanceof Rocket && this.isEnemy) {
                    this.applyDamage(this.directDamage || this.damage);
                } else {
                    this.applyDamage();
                }
                if (state.health <= 0) endGame();
            }

            // 敌人火箭溅射
            if (this instanceof Rocket && this.isEnemy && state.playerBody) {
                const px = state.playerBody.position.x;
                const pz = state.playerBody.position.z;
                const dx = px - this.position.x;
                const dz = pz - this.position.z;
                const distSq = dx * dx + dz * dz;
                const radiusSq = 36; // 6 米半径
                if (distSq <= radiusSq && !hitPlayer) {
                    this.applyDamage(this.splashDamage || this.damage);
                    if (state.health <= 0) endGame();
                }
            }
        }

        this.destroy();
    }

    applyDamage() {
        if (this.isEnemy) {
            // 
            const enemyPos = this.enemyPosition || this.start;
            applyPlayerHit({
                damage: this.damage,
                sourcePosition: enemyPos,
                knockbackScale: 0.2,
                showOverlay: true
            });
        }
    }

    destroy() {
        if (this.tracerLine) {
            state.scene.remove(this.tracerLine);
            this.tracerLine.geometry.dispose();
            this.tracerLine.material.dispose();
        }
        if (this.headMesh) {
            state.scene.remove(this.headMesh);
            if (this.headMesh.geometry) this.headMesh.geometry.dispose();
            if (this.headMesh.material) this.headMesh.material.dispose();
            this.headMesh = null;
        }
    }
}

export class Bullet extends Projectile {
    constructor(start, direction, isEnemy = false, enemyPosition = null, visualOnly = false) {
        super(start, direction, isEnemy, enemyPosition, visualOnly);
        
        // 
        this.speed = CONFIG.bullet.speed;
        this.maxDistance = CONFIG.bullet.maxDistance;
        // 
        let difficultyMultiplier = 1.0;
        if (this.isEnemy && state.selectedDifficulty === 'challenge') {
            // 挑战模式：使用动态难度倍率（1x 到 3x）
            difficultyMultiplier = state.challengeDifficultyMultiplier || 1.0;
        } else if (this.isEnemy && state.selectedDifficulty === 'hard') {
            difficultyMultiplier = 1.5; // 
        } else if (this.isEnemy && state.selectedDifficulty === 'insane') {
            difficultyMultiplier = 2.0; // 
        }
        
        this.damage = Math.round(CONFIG.pistolEnemy.damage * difficultyMultiplier);
        this.explosionRadius = 0.5;
        this.headRadius = 0.05; // 更小的弹头
        this.tracerColor = this.isEnemy ? 0xff6600 : 0xffff00; // 亮黄色
        this.headColor = 0xffffff; // 纯白色弹头
        this.lineWidth = this.isEnemy ? 2.0 : 0.8; // 更细的线条
        this.debrisMultiplier = 1; // 普通子弹：正常掉渣
        this.debrisSizeMultiplier = 1; // 普通子弹：正常大小
    }
    
    createTracer() {
        super.createTracer();
        
        // 子弹特殊效果 - 无发光，更简洁
        if (this.headMesh && this.isEnemy) {
            this.headMesh.material = new THREE.MeshBasicMaterial({ 
                color: this.headColor
            });
        }
    }
}

// 特种兵专用子弹类 - 继承自Bullet
export class SpecialBullet extends Bullet {
    constructor(start, direction, isEnemy = false, enemyPosition = null, visualOnly = false) {
        super(start, direction, isEnemy, enemyPosition, visualOnly);
        
        // 特种兵子弹特有属性 - 中等速度，中等伤害
        this.speed = 90; // 稍快于普通子弹
        this.maxDistance = 180;
        // 根据难度调整伤害
        let difficultyMultiplier = 1.0;
        if (this.isEnemy && state.selectedDifficulty === 'challenge') {
            // 挑战模式：使用动态难度倍率（1x 到 3x）
            difficultyMultiplier = state.challengeDifficultyMultiplier || 1.0;
        } else if (this.isEnemy && state.selectedDifficulty === 'hard') {
            difficultyMultiplier = 1.5; // 中等难度伤害提升50%
        } else if (this.isEnemy && state.selectedDifficulty === 'insane') {
            difficultyMultiplier = 2.0; // 困难难度伤害翻倍
        }
        
        this.damage = Math.round(CONFIG.specialEnemy.damage * difficultyMultiplier);
        this.explosionRadius = 0.3; // 更小的爆炸半径
        this.headRadius = 0.06; // 中等弹头
        this.tracerColor = this.isEnemy ? 0x00ff00 : 0x00ff00; // 绿色 tracer
        this.headColor = 0x00cc00; // 绿色弹头
        this.lineWidth = this.isEnemy ? 2.5 : 1.0; // 中等线条粗细
        this.debrisMultiplier = 2; // 特种兵子弹：2倍掉渣
        this.debrisSizeMultiplier = 1.2; // 特种兵子弹：1.2倍大小
    }
    
    createTracer() {
        super.createTracer();
        
        // 特种兵子弹特殊效果 - 绿色
        if (this.headMesh && this.isEnemy) {
            this.headMesh.material = new THREE.MeshBasicMaterial({
                color: this.headColor
            });
        }
    }
}

export function clearBullets() {
    // Destroys all active bullets and clears the bullet pool
    for (let i = 0; i < state.bullets.length; i++) {
        const b = state.bullets[i];
        if (b && typeof b.destroy === 'function') {
            b.destroy();
        }
    }
    state.bullets.length = 0;
}

export function updateBullets(dt) {
    for (let i = state.bullets.length - 1; i >= 0; i--) {
        if (state.bullets[i].update(dt)) {
            state.bullets.splice(i, 1);
        }
    }
}

export class Rocket extends Projectile {
    constructor(start, direction, isEnemy = false, enemyPosition = null) {
        super(start, direction, isEnemy, enemyPosition, false);
        
        // 火箭弹特有属性 - 超慢速
        this.speed = CONFIG.rocket.speed * 0.5; // 再慢一倍 (20m/s)
        this.maxDistance = CONFIG.rocket.maxDistance;
        // 根据难度调整伤害
        let difficultyMultiplier = 1.0;
        if (this.isEnemy && state.selectedDifficulty === 'challenge') {
            // 挑战模式：使用动态难度倍率（1x 到 3x）
            difficultyMultiplier = state.challengeDifficultyMultiplier || 1.0;
        } else if (this.isEnemy && state.selectedDifficulty === 'hard') {
            difficultyMultiplier = 1.5; // 中等难度伤害提升50%
        } else if (this.isEnemy && state.selectedDifficulty === 'insane') {
            difficultyMultiplier = 2.0; // 困难难度伤害翻倍
        }
        
        // 敌人火箭对玩家的数值：直击 60，溅射 40
        this.directDamage = Math.round(60 * difficultyMultiplier);
        this.splashDamage = Math.round(40 * difficultyMultiplier);
        this.damage = this.directDamage; // 兼容旧逻辑，默认等于直击伤害
        this.explosionRadius = 1.0;
        this.headRadius = 0.25; // 更大的弹头
        this.tracerColor = 0xff0000; // 纯红色
        this.headColor = 0xff0000; // 鲜红色
        this.lineWidth = 10.0; // 更粗的线条
        this.debrisMultiplier = 5;   // 火箭弹：比普通子弹(1)约5倍数量
        this.debrisSizeMultiplier = 5; // 火箭弹：约5倍大小碎片
        this.smokeParticles = []; // 烟雾粒子数组
        this.lastSmokeTime = 0;
    }

    createTracer() {
        super.createTracer();
        
        // 火箭弹不透明震撼效果
        if (this.headMesh) {
            this.headMesh.material = new THREE.MeshBasicMaterial({ 
                color: this.headColor,
                transparent: false // 完全不透明
            });
            
            // 添加额外的光环效果
            const glowGeo = new THREE.SphereGeometry(this.headRadius * 1.5, 12, 12);
            const glowMat = new THREE.MeshBasicMaterial({
                color: 0xff2222,
                transparent: true,
                opacity: 0.6
            });
            this.glowMesh = new THREE.Mesh(glowGeo, glowMat);
            this.glowMesh.position.copy(this.position);
            this.glowMesh.renderOrder = 15;
            state.scene.add(this.glowMesh);
        }
        
        // 火箭弹轨迹 - 不透明红色
        if (this.tracerLine) {
            this.tracerLine.material = new THREE.LineBasicMaterial({
                color: this.tracerColor,
                transparent: false, // 完全不透明
                linewidth: this.lineWidth
            });
        }
    }
    
    update(dt) {
        const result = super.update(dt);
        
        // 更新光环位置
        if (this.glowMesh) {
            this.glowMesh.position.copy(this.position);
        }
        
        // 生成烟雾粒子
        this.createSmokeParticles(dt);
        
        // 更新烟雾粒子
        this.updateSmokeParticles(dt);
        
        return result;
    }
    
    createSmokeParticles(dt) {
        const now = performance.now();
        if (now - this.lastSmokeTime < 50) return; // 每50ms生成一个粒子
        this.lastSmokeTime = now;
        
        // 创建烟雾粒子
        const smokeGeo = new THREE.SphereGeometry(0.1, 6, 6);
        const smokeMat = new THREE.MeshBasicMaterial({
            color: 0x666666,
            transparent: true,
            opacity: 0.3
        });
        const smoke = new THREE.Mesh(smokeGeo, smokeMat);
        
        // 烟雾位置：火箭弹后方偏移
        const offset = this.direction.clone().multiplyScalar(-0.3);
        smoke.position.copy(this.position).add(offset);
        smoke.position.y += 0.1; // 稍微向上偏移
        
        // 烟雾运动：随机扩散
        smoke.velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            Math.random() * 1 + 0.5,
            (Math.random() - 0.5) * 2
        );
        
        smoke.lifeTime = 0;
        smoke.maxLifeTime = 2000; // 2秒生命周期
        
        state.scene.add(smoke);
        this.smokeParticles.push(smoke);
    }
    
    updateSmokeParticles(dt) {
        for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
            const smoke = this.smokeParticles[i];
            smoke.lifeTime += dt * 1000;
            
            // 更新位置
            smoke.position.add(smoke.velocity.clone().multiplyScalar(dt));
            
            // 逐渐变大和变透明
            const lifeRatio = smoke.lifeTime / smoke.maxLifeTime;
            const scale = 1 + lifeRatio * 2;
            smoke.scale.set(scale, scale, scale);
            smoke.material.opacity = 0.3 * (1 - lifeRatio);
            
            // 移除死亡的粒子
            if (smoke.lifeTime >= smoke.maxLifeTime) {
                state.scene.remove(smoke);
                smoke.geometry.dispose();
                smoke.material.dispose();
                this.smokeParticles.splice(i, 1);
            }
        }
    }
    
    destroy() {
        super.destroy();
        
        // 销毁光环
        if (this.glowMesh && this.glowMesh.parent) {
            this.glowMesh.parent.remove(this.glowMesh);
            if (this.glowMesh.geometry) this.glowMesh.geometry.dispose();
            if (this.glowMesh.material) this.glowMesh.material.dispose();
            this.glowMesh = null;
        }
        
        // 销毁所有烟雾粒子
        for (let smoke of this.smokeParticles) {
            if (smoke && smoke.parent) {
                smoke.parent.remove(smoke);
                if (smoke.geometry) smoke.geometry.dispose();
                if (smoke.material) smoke.material.dispose();
            }
        }
        this.smokeParticles = [];
    }

    applyDamage(damageOverride) {
        if (this.isEnemy) {
            // 击退/伤害来源改为爆心点（当前火箭位置），而不是敌人位置
            const explosionPos = this.position.clone();
            const dmg = (typeof damageOverride === 'number') ? damageOverride : this.damage;
            applyPlayerHit({
                damage: dmg,
                sourcePosition: explosionPos,
                knockbackScale: 0.5, // 火箭弹击退更强
                showOverlay: true
            });
            
            if (state.health <= 0) endGame();
        }
    }
}

export function buildWeapon() {
    // 如果camera或scene还不存在（主菜单状态或未初始化），不构建武器
    if (!state.camera || !state.scene) {
        return;
    }
    
    if (state.weaponGroup && state.weaponGroup.parent) {
        state.weaponGroup.parent.remove(state.weaponGroup);
    }
    if (state.adsDotView && state.adsDotView.parent) {
        state.adsDotView.parent.remove(state.adsDotView);
    }

    state.weaponGroup = new THREE.Group();
    state.weaponGroup.layers.set(1);

    const weaponId = state.currentWeaponId || (state.weaponConfig && state.weaponConfig.id) || 'rifle';
    // 添加微弱自发光，防止在阴影中过黑
    const metalDark = new THREE.MeshStandardMaterial({ 
        color: 0x2a2a2a, 
        roughness: 0.35, 
        metalness: 0.8,
        emissive: 0x2a2a2a,
        emissiveIntensity: 0.2
    });
    const metalBlack = new THREE.MeshStandardMaterial({ 
        color: 0x1a1a1a, 
        roughness: 0.4, 
        metalness: 0.7,
        emissive: 0x1a1a1a,
        emissiveIntensity: 0.15
    });
    const woodBrown = new THREE.MeshStandardMaterial({ 
        color: 0x8a5a2f, 
        roughness: 1.0, 
        metalness: 0.1,
        emissive: 0x8a5a2f,
        emissiveIntensity: 0.1
    });

    const weaponBody = new THREE.Group();

    if (weaponId === 'ak') {
        const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.55), metalBlack);
        receiver.position.set(0, -0.02, 0.1);
        receiver.userData.isGun = true;
        weaponBody.add(receiver);

        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.35), woodBrown);
        stock.position.set(-0.03, -0.02, -0.18);
        stock.userData.isGun = true;
        weaponBody.add(stock);

        const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.35), woodBrown);
        handguard.position.set(0.01, -0.02, 0.45);
        handguard.userData.isGun = true;
        weaponBody.add(handguard);

        const barrelGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.5, 8);
        const barrel = new THREE.Mesh(barrelGeo, metalDark);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, -0.02, 0.7);
        barrel.userData.isGun = true;
        weaponBody.add(barrel);

        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.25), metalDark);
        mag.position.set(0.02, -0.18, 0.15);
        mag.rotation.x = 0.3;
        mag.userData.isGun = true;
        weaponBody.add(mag);
    } else if (weaponId === 'ash') {
        // ASH：参考现实世界的 bullpup 步枪造型
        // 使用与其他武器相同的金属材质配色

        // 主体机匣：长矩形（在上下方向略加高，前后方向略短一些，留出明显枪口区域）
        const mainBody = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.18, 1), metalDark);
        // Z 轴居中在 -0.30 左右，使前端大约到 -0.75 ~ -0.8 方向作为“枪口”（与其他武器保持一致朝向）
        mainBody.position.set(0, -0.01, -0.2);
        mainBody.userData.isGun = true;
        weaponBody.add(mainBody);

        // 枪托 / 脸托（跟随机匣一起变高一点）
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.13, 0.22), metalBlack);
        stock.position.set(0, 0.03, 0.28);
        stock.userData.isGun = true;
        weaponBody.add(stock);

        // 弹匣（后置、前倾）
        const magAsh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.38), metalDark);
        magAsh.position.set(0.02, -0.22, -0.15);
        // 倾斜方向朝向枪口（负 Z 方向）
        magAsh.rotation.x = -1.5;
        magAsh.userData.isGun = true;
        weaponBody.add(magAsh);

        // 手枪握把（微调高度，贴合变高后的机匣）
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.08), metalBlack);
        grip.position.set(0.03, -0.20, -0.28);
        grip.rotation.x = 0.3;
        grip.userData.isGun = true;
        weaponBody.add(grip);

        // 前握把（真正垂直向下的握把，圆柱轴沿 Y 方向，从机匣下方向下伸出）
        const vGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.26, 8), metalBlack);
        // Cylinder 默认沿 Y 轴，无需旋转，只需放到机匣下方更靠前的位置
        vGrip.position.set(0.03, -0.26, -0.70);
        vGrip.userData.isGun = true;
        weaponBody.add(vGrip);

        // 枪口小凸起方块，位于机匣前端稍下方，模拟消焰器/枪口装置
        const muzzleBlock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.2), metalDark);
        muzzleBlock.position.set(0, -0.04, -0.9);
        muzzleBlock.userData.isGun = true;
        weaponBody.add(muzzleBlock);

 
    } else {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.5), metalDark);
        body.position.set(0, -0.02, 0.15);
        body.userData.isGun = true;
        weaponBody.add(body);

        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.3), metalBlack);
        stock.position.set(-0.02, -0.02, -0.18);
        stock.userData.isGun = true;
        weaponBody.add(stock);

        const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.3), metalBlack);
        handguard.position.set(0.02, -0.02, 0.42);
        handguard.userData.isGun = true;
        weaponBody.add(handguard);

        const barrelGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.55, 8);
        const barrel = new THREE.Mesh(barrelGeo, metalDark);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, -0.02, 0.68);
        barrel.userData.isGun = true;
        weaponBody.add(barrel);

        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.22), metalDark);
        mag.position.set(0.02, -0.16, 0.08);
        mag.userData.isGun = true;
        weaponBody.add(mag);
    }

    weaponBody.position.z = 0.2;
    state.weaponGroup.add(weaponBody);

    const sight = new THREE.Group();
    const sBase = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.08), metalBlack);
    sBase.position.y = 0.08; sBase.userData.isGun = true;
    const sLensMat = new THREE.MeshBasicMaterial({color: 0x00ffff, opacity: 0.22, transparent: true, side: THREE.DoubleSide, depthWrite: false});
    const sLens = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.05), sLensMat);
    sLens.position.set(0, 0.12, 0); sLens.userData.isGun = true;
    const sDotMatGun = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: false,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending
    });
    const sDotGun = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001), sDotMatGun);
    sDotGun.position.set(0, 0.12, 0.001);
    sDotGun.renderOrder = 1001;
    sDotGun.userData.isGun = true;
    sDotGun.visible = true;
    sight.add(sBase, sLens, sDotGun);
    // 统一不同武器的瞄具位置：
    // - AK 稍微靠近一点以贴合其较短机匣
    // - 其余武器（包括 ASH 和 M4）使用同一 Z 值，保证开镜视角一致
    sight.position.z = weaponId === 'ak' ? 0.16 : 0.2;

    const sDotMatView = sDotMatGun.clone();
    const sDotView = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001), sDotMatView);
    sDotView.position.set(0, 0, -0.1);
    sDotView.renderOrder = 1002;
    sDotView.userData.isGun = true;
    sDotView.visible = false;

    state.adsDotGun = sDotGun;
    state.adsDotView = sDotView;
    state.adsDot = sDotView;
    if (state.camera) {
        state.camera.add(sDotView);
    }
    
    // 应用当前的准星样式
    updateCrosshairStyle(state.crosshairStyle || 'pixel');

    state.weaponGroup.add(sight);
    const fGeo = new THREE.PlaneGeometry(0.35, 0.35);
    const fMat = new THREE.MeshBasicMaterial({
        color: 0xffe08a,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    state.muzzleFlash = new THREE.Mesh(fGeo, fMat);
    const flashZ = weaponId === 'ak' ? -0.6 : (weaponId === 'ash' ? -0.7 : -0.45);
    state.muzzleFlash.position.set(0, 0, flashZ); 
    state.muzzleFlash.userData.isGun = true;
    state.muzzleFlash.renderOrder = 10;
    state.weaponGroup.add(state.muzzleFlash);

    // 确保整套武器（含子节点）都在 layer 1 上，只接受武器相机渲染
    state.weaponGroup.traverse(obj => {
        obj.layers.set(1);
    });

    // 将武器组附加到专用武器相机（如果存在），否则退回主相机
    if (state.weaponCamera) {
        state.weaponCamera.add(state.weaponGroup);
    } else {
        state.camera.add(state.weaponGroup);
    }

    if (!state.camera.parent) {
        state.scene.add(state.camera);
    }
    if (state.weaponCamera && !state.weaponCamera.parent) {
        state.scene.add(state.weaponCamera);
    }
}

export function updateWeapon(time, dt, isMoving) {
    const wp = state.weaponConfig || CONFIG.weaponPresets.m4a1;
    // 从 RPM 计算射击间隔，保留足够精度的小数
    const fireRate = wp.rpm ? (60.0 / wp.rpm) : (wp.fireRate || CONFIG.fireRate);
    const fireInterval = fireRate * 1000;
    const isSemiAuto = !!wp.semiAuto;

    // 使用医疗时不能开枪，并放下武器
    if (state.isHealing || state.isRepairingArmor) {
        state.isFiring = false;
        // 武器动画：向下移出屏幕
        if (state.weaponGroup) {
            const targetY = -2.0; // 放下到屏幕外
            const targetZ = 0.5;
            state.weaponGroup.position.y = THREE.MathUtils.lerp(state.weaponGroup.position.y, targetY, dt * 8);
            state.weaponGroup.position.z = THREE.MathUtils.lerp(state.weaponGroup.position.z, targetZ, dt * 8);
        }
        return; // 跳过其他武器更新
    }
    
    // 半自动与全自动开火逻辑
    const triggerHeld = !!state.isFiring;
    const wasHeldLastFrame = !!state.lastFireButtonDown;
    const justPressed = triggerHeld && !wasHeldLastFrame;

    if (!state.isReloading && state.ammo > 0) {
        // 冲刺时禁止开火，但滑铲视为特殊姿态：即使 sprint 标志还在，也允许开火
        const blockedBySprint = state.isSprinting && isMoving && !state.isAiming && !state.isSliding;
        if (!blockedBySprint) {
            const canShootByInterval = (time - state.lastFireTime > fireInterval);
            if (isSemiAuto) {
                // 半自动：只能在刚按下扳机的那一帧触发，且满足射速间隔
                if (justPressed && canShootByInterval) {
                    fire(time);
                }
            } else {
                // 全自动：按住即可在射速间隔内连发
                if (triggerHeld && canShootByInterval) {
                    fire(time);
                }
            }
        }
    }

    // 记录本帧扳机状态，用于下帧判断 "justPressed"
    state.lastFireButtonDown = triggerHeld;
    if(state.ammo <= 0 && !state.isReloading && state.reserveAmmo > 0) reload();

    // 离开开镜时，重置 ADS 锁定状态
    if (!state.isAiming) {
        state.adsLocked = false;
    }

    // 腰射位置向远处适度推开，确保能看到更多枪体
    let hipPos = new THREE.Vector3(0.18, -0.16, -0.7);
    // ADS 位置保持不变，确保开镜对齐和手感一致
    let adsPos = new THREE.Vector3(0, -0.12, -0.3);
    let tPos = state.isAiming ? adsPos : hipPos;
    let tRot = new THREE.Vector3(0, 0, 0);

    if(!state.isAiming) { tPos.x += state.currentLeanFactor * 0.1; tRot.z -= state.currentLeanFactor * 0.2; }
    if(state.isReloading) { tRot.x = 0.5; tRot.z = 0.5; tPos.y = -0.4; }
    else if(state.isSliding && !state.isAiming) {
        // 滑铲：改为“侧枪”姿态，像撩枪一样侧过来，位置往前推，不缩在胸口
        tPos = new THREE.Vector3(0.15, -0.25, -0.55); // 往外推远 (Z从-0.25 -> -0.55)，稍微低一点
        tRot.x = -0.15; // 枪身大致水平略低
        tRot.y = 0.25;  // 枪口微向内
        tRot.z = 1.4;   // 大幅侧翻 (Roll)，沿着枪体轴旋转
        // 允许腰射，所以不隐藏准星，除非你想要盲射感觉
        const ch = document.getElementById('crosshair-wrapper');
        if(ch) ch.style.opacity = 1; // 改为显示准星，方便滑铲射击
    }
    else if(state.isSprinting && isMoving && !state.isAiming) { 
        tPos = new THREE.Vector3(0, -0.25, -0.4); tRot.x = -0.5; tRot.y = 0.5; 
        const ch = document.getElementById('crosshair-wrapper');
        if(ch) ch.style.opacity = 0; 
    }
    else { 
        const ch = document.getElementById('crosshair-wrapper');
        if(ch) ch.style.opacity = state.isAiming ? 0 : 1; 
        const bobAmp = state.isAiming ? 0.0002 : 0.002; 
        tPos.y += Math.sin(time / 500) * bobAmp; 
    }

    const base = state.isAiming ? CONFIG.spreadParams.ads : CONFIG.spreadParams.base;
    let add = 0; if(isMoving) add += CONFIG.spreadParams.move; if(!state.isGrounded) add += CONFIG.spreadParams.jump; add += state.shootSpreadAccumulator;
    const target = Math.min(base + add, CONFIG.spreadParams.max);
    state.shootSpreadAccumulator = Math.max(0, state.shootSpreadAccumulator - dt * CONFIG.spreadParams.decaySpeed);
    
    state.currentSpreadAngle = THREE.MathUtils.lerp(state.currentSpreadAngle, target, dt * 15);

    state.recoilOffset = Math.max(0, state.recoilOffset - dt * 5);
    state.recoilRot = Math.max(0, state.recoilRot - dt * 10);
    tPos.z += state.recoilOffset; tRot.x += state.recoilRot;

    // 开镜时先严格对准，切换成功后再允许sway
    const allowSway = !state.isAiming || state.adsLocked;
    const swayScale = allowSway ? (state.isAiming ? 0.0018 : 0.005) : 0;
    const swayLimit = allowSway ? (state.isAiming ? 0.012 : 0.05) : 0;
    state.weaponSwayTarget.x = THREE.MathUtils.clamp(-state.lastLookDelta.x * swayScale, -swayLimit, swayLimit);
    state.weaponSwayTarget.y = THREE.MathUtils.clamp(-state.lastLookDelta.y * swayScale, -swayLimit, swayLimit);
    state.weaponSwayTarget.z = THREE.MathUtils.clamp(Math.abs(state.lastLookDelta.x) * -0.0005, -0.02, 0.0);
    state.weaponSwayOffset.lerp(state.weaponSwayTarget, dt * 10);

    const bobInfluence = state.isAiming ? state.viewBobIntensity * 0.12 : state.viewBobIntensity;
    const bobOffset = Math.sin(state.viewBobPhase) * bobInfluence * (state.isAiming ? 0.08 : 0.6);
    const bobSide = Math.cos(state.viewBobPhase * 0.5) * bobInfluence * (state.isAiming ? 0.08 : 0.5);

    const kickDamp = Math.max(0, 1 - dt * 12);
    state.weaponKick.z *= kickDamp;

    const finalPos = tPos.clone();
    finalPos.x += state.weaponSwayOffset.x + bobSide * (state.isAiming ? 0.04 : 0.2);
    finalPos.y += state.weaponSwayOffset.y + bobOffset;
    finalPos.z += state.weaponSwayOffset.z + state.weaponKick.z;

    const swayRotMulZ = state.isAiming ? 3.0 : 2.5;
    const swayRotMulY = state.isAiming ? 2.2 : 1.8;
    tRot.z += state.weaponSwayOffset.x * swayRotMulZ;
    tRot.y += state.weaponSwayOffset.x * swayRotMulY;

    state.weaponGroup.position.lerp(finalPos, 15 * dt);
    state.weaponGroup.rotation.x += (tRot.x - state.weaponGroup.rotation.x) * 15 * dt;
    state.weaponGroup.rotation.y += (tRot.y - state.weaponGroup.rotation.y) * 15 * dt;
    state.weaponGroup.rotation.z += (tRot.z - state.weaponGroup.rotation.z) * 15 * dt;

    // ADS 红点交替：
    // - 未完全开镜或未锁定：只显示枪镜上的红点（会跟随 sway）
    // - 一旦完全开镜并锁定：只显示屏幕中心红点（稳定命中点），枪镜红点隐藏
    // - 换弹过程中：允许尝试开镜动画，但不显示任何红点，避免错误红点
    if (state.adsDotGun || state.adsDotView) {
        const currentPos = state.weaponGroup.position;
        const adsTarget = adsPos;
        const dist = currentPos.distanceTo(adsTarget);
        const isAlignedNow = state.isAiming && dist < 0.005; // 严格：1毫米精度

        // 只要有一帧满足完全对齐，就锁定 ADS 状态，直到松开右键
        if (isAlignedNow && state.isAiming) {
            state.adsLocked = true;
        }

        const useViewDot = state.isAiming && state.adsLocked && !state.isReloading;

        if (state.adsDotGun) {
            const showGunDot = !useViewDot && !state.isReloading;
            state.adsDotGun.visible = showGunDot;
            if (state.adsDotGun.material && state.adsDotGun.material.opacity !== undefined) {
                state.adsDotGun.material.opacity = showGunDot ? 1.0 : 0.0;
            }
        }

        if (state.adsDotView) {
            // 硬锁定在相机本地坐标 (0,0,-0.1)，避免任何 bob/sway 逻辑影响其屏幕位置
            state.adsDotView.position.set(0, 0, -0.1);

            const showViewDot = useViewDot && !state.isReloading;
            state.adsDotView.visible = showViewDot;
            const mat = state.adsDotView.material;
            if (mat && mat.opacity !== undefined) {
                mat.opacity = showViewDot ? 1.0 : 0.0;
            }
        }
    }

    // Decay muzzle flash intensity for a quick, bright fade
    if (state.muzzleFlash) {
        state.muzzleFlashIntensity = Math.max(0, state.muzzleFlashIntensity - dt * 12);
        state.muzzleFlash.material.opacity = state.muzzleFlashIntensity;
        const baseScale = 0.18 + state.muzzleFlashIntensity * 0.25;
        const stretch = 1 + state.muzzleFlashIntensity * 0.8;
        state.muzzleFlash.scale.set(baseScale * stretch, baseScale, baseScale);
    }
}

function fire(time) {
    const startTime = performance.now();
    weaponFireCount++;
    
    // 检查输入是否被禁用（死亡状态）
    if (state.isInputDisabled) {
        return;
    }
    
    // 使用医疗时不能开枪（双重保险）
    if (state.isHealing || state.isRepairingArmor) {
        return;
    }

    // 调试：检查游戏模式和碰撞检测数组
    console.log(`🔫 射击调试: 游戏模式=${state.gameMode}, 动态碰撞体数量=${state.activeDynamicMeshes.length}`);
    if (state.gameMode !== 'mp_arena') {
        console.log(`❌ 游戏模式不是mp_arena，跳过多人伤害逻辑`);
    }
    
    state.lastFireTime = time; state.ammo--;
    const weaponId = state.currentWeaponId || state.weaponConfig?.id || 'unknown';
    const weaponName = state.weaponConfig?.displayName || state.weaponConfig?.name || weaponId;
    let shotRecorded = false;
    
    // 先计算子弹方向，不受当前发后坐力影响
    let dir = new THREE.Vector3(0, 0, -1);
    if (state.isAiming) {
        // 开镜：真实射击方向锁在相机中心，只受相机本身的 bob / 抖动 / 后坐力影响
        dir.applyQuaternion(state.camera.quaternion);
    } else {
        // 腰射：继续使用散布角做锥形随机
        const spreadRad = THREE.MathUtils.degToRad(state.currentSpreadAngle);
        // console.log(`🎯 射击散布调试: 角度=${state.currentSpreadAngle.toFixed(3)}°, 弧度=${spreadRad.toFixed(6)}`);
        // console.log(`🎯 View Bob: intensity=${state.viewBobIntensity.toFixed(4)}, phase=${state.viewBobPhase.toFixed(3)}`);
        // console.log(`🎯 相机旋转: yaw=${state.cameraYaw.toFixed(4)}, pitch=${state.cameraPitch.toFixed(4)}`);
        
        const r = Math.sqrt(Math.random()) * Math.tan(spreadRad); 
        const theta = Math.random() * Math.PI * 2;
        const offset = new THREE.Vector3(r * Math.cos(theta), r * Math.sin(theta), 0);
        // console.log(`🎯 散布偏移: r=${r.toFixed(6)}, theta=${theta.toFixed(3)}, offset=(${offset.x.toFixed(4)}, ${offset.y.toFixed(4)})`);
        
        dir.add(offset).normalize();
        dir.applyQuaternion(state.camera.quaternion);
    }

    // 应用武器的散布系数（独立于后坐力）
    const spreadMult = state.weaponConfig ? state.weaponConfig.spreadMultiplier : 1.0;
    state.shootSpreadAccumulator += CONFIG.spreadParams.shoot * spreadMult;
    updateUI();

    // 发射子弹后再施加后坐力到相机状态
    if (state.isAiming) { 
        const baseKickZ = 0.01;
        const randScale = 0.01;
        state.recoilOffset = baseKickZ + Math.random() * randScale;
        state.recoilRot = 0.01 + Math.random() * randScale;

        // ADS 下的视角后坐：更明显的上抬和少量左右随机抖动，便于“压枪”
        const weaponRecoilMult = state.weaponConfig ? state.weaponConfig.recoilMultiplier : 1.0;
        const ammoRecoilMult = state.currentAmmoGrade ? state.currentAmmoGrade.recoilMultiplier : 1.0;
        const totalRecoilMult = weaponRecoilMult * ammoRecoilMult;
        
        state.cameraPitch += (0.005 + Math.random() * 0.004) * totalRecoilMult;
        state.cameraYaw   += (Math.random() - 0.5) * 0.006 * totalRecoilMult;

        const shoulderImpulse = 0.02;                                 // 增强一点肩部后坐
        const maxShoulder = 0.06;
        state.weaponKick.z = THREE.MathUtils.clamp(state.weaponKick.z + shoulderImpulse, 0, maxShoulder);
    }
    else { 
        state.recoilOffset = 0.1; 
        state.recoilRot = 0.05; 

        // 腰射：比 ADS 更暴躁一些，上抬和左右随机更大
        // 计算总后坐力倍率：武器后坐力 × 弹药后坐力
        const weaponRecoilMult = state.weaponConfig ? state.weaponConfig.recoilMultiplier : 1.0;
        const ammoRecoilMult = state.currentAmmoGrade ? state.currentAmmoGrade.recoilMultiplier : 1.0;
        const totalRecoilMult = weaponRecoilMult * ammoRecoilMult;
        
        state.cameraPitch += 0.014 * totalRecoilMult;
        state.cameraYaw   += (Math.random()-0.5) * 0.014 * totalRecoilMult;

        const shoulderImpulse = 0.03;
        const maxShoulder = 0.09;
        state.weaponKick.z = THREE.MathUtils.clamp(state.weaponKick.z + shoulderImpulse, 0, maxShoulder);
    }

    // Hot, additive muzzle flash with random rotation/scale
    if (state.muzzleFlash) {
        state.muzzleFlashIntensity = 1;
        state.muzzleFlash.material.opacity = 1;
        state.muzzleFlash.rotation.z = Math.random() * Math.PI * 2;
        const length = 0.30 + Math.random() * 0.20;
        const thickness = 0.12 + Math.random() * 0.08;
        state.muzzleFlash.scale.set(length, thickness, 1);
    }
    playWeaponShotSound();
    state.raycaster.set(state.camera.position, dir);
    
    // 使用活跃物体数组优化武器瞄准检测
    const targets = [];
    
    // 添加活跃静态物体
    if (state.activeStaticMeshes) {
        for (const mesh of state.activeStaticMeshes) {
            if (mesh.isMesh && 
                mesh.userData.isActive && 
                !mesh.userData.isGun && 
                mesh !== state.playerMesh && 
                mesh !== state.skyMesh && 
                mesh !== state.muzzleFlash) {
                targets.push(mesh);
            }
        }
    }
    
    // 添加活跃动态物体
    if (state.activeDynamicMeshes) {
        for (const mesh of state.activeDynamicMeshes) {
            if (mesh.isMesh && 
                mesh.userData.isActive && 
                !mesh.userData.isGun && 
                mesh !== state.playerMesh && 
                mesh !== state.skyMesh && 
                mesh !== state.muzzleFlash) {
                targets.push(mesh);
            }
        }
    }
    
    // 调试：记录本次射线检测的目标数量
    console.log(`🎯 Raycast targets: total=${targets.length}, dynamic=${state.activeDynamicMeshes.length}, static=${state.activeStaticMeshes.length}`);
    const hits = state.raycaster.intersectObjects(targets);
    console.log(`🎯 Raycast result: hits=${hits.length}`, hits.map(h => h.object.userData?.type));
    let endPoint = state.camera.position.clone().add(dir.multiplyScalar(200));

    if(hits.length > 0) {
        const hit = hits[0];
        endPoint = hit.point;
        
        // 真实反馈：根据材质生成碎片
        let color = 0x888888; // 默认灰
        if(hit.object.userData.debrisColor) color = hit.object.userData.debrisColor;
        
        // 根据玩家当前武器类型设置掉渣倍数
        let weaponDebrisMultiplier = 1; // 默认步枪
        let weaponDebrisSizeMultiplier = 1; // 默认步枪
        const weaponId = state.currentWeaponId || (state.weaponConfig && state.weaponConfig.id) || 'rifle';
        
        if (weaponId === 'ak') {
            weaponDebrisMultiplier = 2; // AK：2倍破坏
            weaponDebrisSizeMultiplier = 1.2; // AK：1.2倍大小
        } else if (weaponId === 'ash') {
            weaponDebrisMultiplier = 3; // ASH：3倍破坏
            weaponDebrisSizeMultiplier = 1.5; // ASH：1.5倍大小
        } else if (weaponId === 'rifle') {
            weaponDebrisMultiplier = 1.5; // 步枪：1.5倍破坏
            weaponDebrisSizeMultiplier = 1; // 步枪：1倍大小
        }
        
        if(hit.object.userData.canDebris && hit.face) {
            const baseCount = hit.object.userData.debrisCount || 5;
            const wallMultiplier = hit.object.userData.debrisMultiplier || 1;
            const totalMultiplier = wallMultiplier * weaponDebrisMultiplier;
            const debrisCount = Math.max(1, Math.round(baseCount * totalMultiplier));
            const sizeMultiplier = weaponDebrisSizeMultiplier;
            spawnDebris(hit.point, hit.face.normal, color, debrisCount, sizeMultiplier);
        }

        // 先检查是否命中联机敌人（远端玩家）
        let obj = hit.object;
        let handled = false;
        while (obj && obj !== state.scene) {
            const ud = obj.userData || {};
            if (ud.type === 'remotePlayerHead' || ud.type === 'remotePlayerBody') {
                const isHead = ud.type === 'remotePlayerHead';
                const targetSessionId = ud.playerId;

                // 使用与 PVE 敌人相同的基础伤害逻辑（不做距离衰减，先简单一点）
                let damage = state.weaponConfig?.damageScale || CONFIG.weaponPresets.m4a1.damageScale;
                if (state.currentAmmoGrade) {
                    damage *= state.currentAmmoGrade.damageMultiplier;
                }
                const headshotMult = state.weaponConfig?.headshotMultiplier || CONFIG.weaponPresets.m4a1.headshotMultiplier || 2.0;
                if (isHead) damage *= headshotMult;

                recordWeaponShot({
                    weaponId,
                    weaponName,
                    damage,
                    isHit: true,
                    hitLocation: isHead ? 'head' : 'body'
                });
                shotRecorded = true;

                // 本地命中反馈
                showHitmarker(isHead);
                playHitmarkerSound(isHead);
                // 记录最近命中目标，用于服务器回传死亡时展示击杀提示
                if (window.colyseusClient) {
                    window.colyseusClient.lastHitTarget = {
                        sessionId: targetSessionId,
                        ts: Date.now(),
                        isHead
                    };
                }

                // 发送伤害消息到服务器
                if (state.gameMode !== 'mp_arena') {
                    console.log('❌ 未发送伤害消息: gameMode 不是 mp_arena');
                } else if (!window.colyseusClient) {
                    console.log('❌ 未发送伤害消息: window.colyseusClient 不存在');
                } else if (!window.colyseusClient.room) {
                    console.log('❌ 未发送伤害消息: 已初始化但未加入房间');
                } else if (state.isInputDisabled) {
                    console.log('❌ 本地玩家已死亡，跳过伤害消息发送');
                } else {
                    console.log(`🛰️ 准备发送伤害消息: hasClient=${!!window.colyseusClient}, hasRoom=${!!window.colyseusClient.room}, target=${targetSessionId}`);
                    console.log(`🎯 发送伤害消息: 目标=${targetSessionId}, 部位=${isHead ? 'head' : 'body'}, 基础伤害=${damage}`);
                    try {
                        window.colyseusClient.room.send('hit', {
                            targetSessionId,
                            part: isHead ? 'head' : 'body',
                            damage
                        });
                    } catch (e) {
                        console.warn('⚠️ 发送远端玩家受击消息失败', e);
                    }
                }

                handled = true;
                break;
            }
            obj = obj.parent;
        }

        // 如果不是联机敌人，再按原逻辑检查 PVE 敌人
        if (!handled) {
            obj = hit.object;
            while(obj.parent && obj.parent !== state.scene) {
                if(state.enemies.some(e => e.mesh === obj.parent)) {
                    const enemy = state.enemies.find(e => e.mesh === obj.parent);
                    const isHead = obj.name === 'head';
                    
                    // 1. 先计算基础伤害（含武器伤害系数）
                    let baseDamage = state.weaponConfig?.damageScale || CONFIG.weaponPresets.m4a1.damageScale;
                    
                    // 2. 获取射程衰减参数
                    const wp = state.weaponConfig || CONFIG.weaponPresets.m4a1;
                    // 应用子弹射程加成
                    const ammoRangeMult = state.currentAmmoGrade ? (state.currentAmmoGrade.rangeMultiplier || 1.0) : 1.0;
                    const startDrop = (wp.damageStartDrop || 40) * ammoRangeMult;
                    const endDrop = (wp.damageEndDrop || 80) * ammoRangeMult;
                    const minPercent = wp.damageMinPercent || 0.4;
                    const dist = hit.distance;
                    
                    // 3. 计算距离衰减倍率
                    let distMultiplier = 1.0;
                    if (dist <= startDrop) {
                        distMultiplier = 1.0;
                    } else if (dist >= endDrop) {
                        distMultiplier = minPercent;
                    } else {
                        const range = endDrop - startDrop;
                        const progress = (dist - startDrop) / range;
                        distMultiplier = 1.0 - (1.0 - minPercent) * progress;
                    }
                    
                    // 4. 应用距离衰减
                    const originalBase = baseDamage;
                    baseDamage = Math.round(baseDamage * distMultiplier);
                    
                    // 5. 应用弹药等级修正 (这是之前漏掉的逻辑，enemy.hit里有，这里也得加上)
                    if (state.currentAmmoGrade) {
                        baseDamage *= state.currentAmmoGrade.damageMultiplier;
                    }

                    // 6. 计算最终伤害（含爆头）
                    const headshotMult = state.weaponConfig?.headshotMultiplier || CONFIG.weaponPresets.m4a1.headshotMultiplier || 2.0;
                    let damage = isHead ? baseDamage * headshotMult : baseDamage;

                    // 挑战模式下应用终端购买的子弹伤害加成（仅玩家武器命中逻辑会走到这里）
                    if (state.selectedDifficulty === 'challenge' && state.challengeDamageMultiplier) {
                        damage *= state.challengeDamageMultiplier;
                    }

                    // 🔍 调试日志
                    console.log(`🎯 命中: 距离=${dist.toFixed(1)}m, 衰减=${startDrop}-${endDrop}m, 倍率=${distMultiplier.toFixed(2)}, 基础=${originalBase}->${baseDamage}, 最终=${damage.toFixed(0)} (爆头倍率:${isHead ? headshotMult : 1.0})`);

                    // 7. 应用伤害到敌人 (传入最终伤害)
                    const enemyKilled = enemy.hit(isHead, hit.point, damage);
                    
                    recordWeaponShot({
                        weaponId,
                        weaponName,
                        damage: damage,
                        isHit: true,
                        hitLocation: isHead ? 'head' : 'body'
                    });
                    shotRecorded = true;
                    
                    // 击中反馈
                    showHitmarker(isHead);
                    playHitmarkerSound(isHead);

                    // 若敌人被击杀，则结算得分和击杀统计（与旧逻辑保持一致）
                    if (enemyKilled) {
                        let reward = 20;
                        if (enemy.type === 'pistol') reward = 30;
                        else if (enemy.type === 'rocket') reward = 50;
                        else if (enemy.type === 'special') reward = 95;
                        addScore(reward);
                        showKill(isHead);
                        recordWeaponKill({
                            weaponId,
                            weaponName,
                            damage,
                            score: reward
                        });
                    }
                }
                break;
            }
            obj = obj.parent;
        }
    }
}

// 定期报告武器开枪统计（每5秒一次）
function reportWeaponStats() {
    const now = performance.now();
    if (now - weaponLastReportTime > 5000) { // 5秒报告一次
        const avgTime = weaponFireCount > 0 ? weaponTotalTime / weaponFireCount : 0;
        console.log(`🔫 武器开枪监控: 5秒内${weaponFireCount}次开枪, 平均${avgTime.toFixed(3)}ms/次, 场景遍历=${weaponFireCount}次`);
        weaponFireCount = 0;
        weaponTotalTime = 0;
        weaponLastReportTime = now;
    }
}

// 定期报告子弹碰撞检测统计（每5秒一次）
function reportProjectileCollisionStats() {
    const now = performance.now();
    if (now - projectileLastReportTime > 5000) { // 5秒报告一次
        const avgTime = projectileCollisionCount > 0 ? projectileCollisionTime / projectileCollisionCount : 0;
        const currentBulletCount = state.bullets ? state.bullets.length : 0;
        
        // 计算实际工作量对比
        const totalObjects = 164; // 之前场景中的总物体数
        const avgCandidates = 18; // 平均候选集大小
        const oldWorkload = projectileCollisionCount * totalObjects;
        const newWorkload = projectileCollisionCount * avgCandidates;
        const workloadReduction = ((oldWorkload - newWorkload) / oldWorkload * 100).toFixed(1);
        
        // 计算检测频率优化效果（使用实际子弹速度）
        const detectionThreshold = 0.3; // 检测阈值
        const avgBulletSpeed = 80; // 平均子弹速度m/s
        const fps = 60; // 假设60fps
        const distancePerFrame = avgBulletSpeed / fps; // 每帧移动距离
        const framesPerDetection = detectionThreshold / distancePerFrame; // 每次检测需要的帧数
        const frequencyReduction = ((1 - 1/framesPerDetection) * 100).toFixed(1);
        
        console.log(`🚀 子弹碰撞监控: 5秒内${projectileCollisionCount}次检测, 平均${avgTime.toFixed(3)}ms/次, 当前子弹数=${currentBulletCount}`);
        console.log(`🎯 双重优化: 检测次数减少${frequencyReduction}%, 每次检测物体减少89.0%`);
        console.log(`⚡ 总工作量: 旧=${oldWorkload.toLocaleString()} → 新=${newWorkload.toLocaleString()} (总体减少${((1 - newWorkload/oldWorkload) * 100).toFixed(1)}%)`);
        
        projectileCollisionCount = 0;
        projectileCollisionTime = 0;
        projectileLastReportTime = now;
    }
}


export function reload() {
    state.isReloading = true;
    toggleReloadIndicator(true);
    setTimeout(() => {
        const wp = state.weaponConfig || CONFIG.weaponPresets.m4a1;
        const clipSize = wp.maxAmmo || CONFIG.maxAmmo;
        const need = clipSize - state.ammo; const load = Math.min(need, state.reserveAmmo);
        state.ammo += load; state.reserveAmmo -= load; state.isReloading = false;
        toggleReloadIndicator(false);
        updateUI();
    }, 1500);
}

// 候选集构建性能报告函数
function reportCandidateStats() {
    const now = performance.now();
    if (now - candidateLastReportTime > 5000) { // 每5秒报告一次
        const avgTime = candidateBuildCount > 0 ? candidateBuildTime / candidateBuildCount : 0;
        
        console.log(`🎯 候选集构建性能分析 (5秒内${candidateBuildCount}次):`);
        console.log(`   - 平均构建时间: ${avgTime.toFixed(3)}ms/次`);
        console.log(`   - 活跃静态物体: ${state.activeStaticMeshes?.length || 0}`);
        console.log(`   - 活跃动态物体: ${state.activeDynamicMeshes?.length || 0}`);
        console.log(`   - 候选集优化: 使用活跃数组替代全场景遍历`);
        
        // 重置统计
        candidateBuildCount = 0;
        candidateBuildTime = 0;
        candidateLastReportTime = now;
    }
}

// 准星样式纹理缓存
let classicCrosshairTexture = null;

function getClassicCrosshairTexture() {
    if (classicCrosshairTexture) return classicCrosshairTexture;
    
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    // 清除背景
    ctx.clearRect(0, 0, 64, 64);

    // 绘制核心 (亮红色)
    ctx.beginPath();
    ctx.arc(32, 32, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ff0000';
    ctx.fill();
    
    // 绘制中心高光 (微白)
    ctx.beginPath();
    ctx.arc(32, 32, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    classicCrosshairTexture = new THREE.CanvasTexture(canvas);
    classicCrosshairTexture.minFilter = THREE.LinearFilter;
    classicCrosshairTexture.magFilter = THREE.LinearFilter;
    return classicCrosshairTexture;
}

export function updateCrosshairStyle(style) {
    state.crosshairStyle = style;
    
    const targets = [state.adsDotGun, state.adsDotView];
    
    targets.forEach(dot => {
        if (!dot) return;
        
        // 释放旧材质和几何体
        // 注意：不要释放共享的 texture，也不要释放材质如果它被其他东西共享（这里材质是独占的）
        if (dot.geometry) dot.geometry.dispose();
        if (dot.material) dot.material.dispose();

        if (style === 'classic') {
            // 经典风格：红点（ 使用纹理)
            // 模型上的准星更大，屏幕中央的准星更小
            const isGunDot = dot === state.adsDotGun;
            const size = isGunDot ? 0.012 : 0.006; // 模型上的更大，屏幕中央的更小
            dot.geometry = new THREE.PlaneGeometry(size, size); 
            dot.material = new THREE.MeshBasicMaterial({
                map: getClassicCrosshairTexture(),
                transparent: true,
                depthTest: false,
                depthWrite: false,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending
            });
        } else {
            // 像素风格 (默认)：简单的红色方块
            // 模型上的准星更小，屏幕中央的准星更小
            const isGunDot = dot === state.adsDotGun;
            const size = isGunDot ? 0.0012 : 0.0006; // 模型上的更小，屏幕中央的更小
            dot.geometry = new THREE.PlaneGeometry(size, size); 
            dot.material = new THREE.MeshBasicMaterial({
                color: 0xff0000,
                transparent: false,
                depthTest: false,
                depthWrite: false,
                side: THREE.DoubleSide
            });
        }
    });
    
    console.log(`🎯 准星样式已更新: ${style}`);
}

