import * as THREE from 'three';
import { state } from './globals.js';
import { CONFIG } from './config.js';
import { endGame } from './main.js';
import { createAmmoPickup, createHealthPickup, spawnDebris } from './world.js';
import { playEnemyProximitySound } from './audio.js';
import { Bullet, Rocket, SpecialBullet } from './weapon.js';
import { applyPlayerHit } from './playerHit.js';
import { playRocketShotSound, playEnemyPistolSound } from './audio.js';
import { collisionGrid } from './collisionGrid.js';
import { showDamageNumber } from './damageNumbers.js';

// Assuming CANNON is global
const CANNON = window.CANNON;

// 检查敌人是否可以看到玩家（视线检测）
// 性能监控变量
let losCheckCount = 0;
let losTotalTime = 0;
let losLastReportTime = 0;

console.log('👁️ 敌人视线检测监控已加载');

function hasLineOfSight(enemyPos, playerPos) {
    const startTime = performance.now();
    losCheckCount++;
    
    // 创建射线从敌人到玩家
    const direction = new THREE.Vector3().subVectors(playerPos, enemyPos).normalize();
    const raycaster = new THREE.Raycaster(enemyPos, direction);
    
    // 检查射线与建筑物的碰撞
    if (state.scene && state.currentMapConfig) {
        // 获取所有活跃建筑网格对象
        const buildingMeshes = [];
        
        // 使用活跃静态物体数组优化
        if (state.activeStaticMeshes) {
            for (const mesh of state.activeStaticMeshes) {
                if (mesh.isMesh && 
                    mesh.userData.isActive && 
                    mesh.userData.physicsBody && 
                    mesh.userData.debrisColor && 
                    mesh.userData.debrisColor !== 0x222222) { // 排除地面
                    buildingMeshes.push(mesh);
                }
            }
        }
        
        const intersects = raycaster.intersectObjects(buildingMeshes);
        
        // 如果有碰撞，检查碰撞点是否在玩家之前
        if (intersects.length > 0) {
            const firstHit = intersects[0];
            const hitDistance = enemyPos.distanceTo(firstHit.point);
            const playerDistance = enemyPos.distanceTo(playerPos);
            
            // 如果碰撞点在玩家之前，则视线被阻挡
            if (hitDistance < playerDistance - 1) { // 留1米容差
                const endTime = performance.now();
                losTotalTime += (endTime - startTime);
                reportLosStats();
                return false;
            }
        }
    }
    
    const endTime = performance.now();
    losTotalTime += (endTime - startTime);
    reportLosStats();
    return true;
}

// 根据难度选择敌人类型（完全不依赖分数）
function pickEnemyTypeByDifficulty() {
    const difficulty = state.selectedDifficulty || 'normal';
    const r = Math.random();

    if (difficulty === 'challenge') {
        // 挑战模式：兵种比例随时间从 "默认" 过渡到更危险的组合
        // 起始（t=0）：melee 40%, pistol 40%, rocket 15%, special 5%
        // 终点（t=1）：melee 30%, pistol 30%, rocket 25%, special 15%
        const t = Math.max(0, Math.min(1, state.challengeSpawnProgressRatio || 0));

        const meleeP   = 0.40 + (0.30 - 0.40) * t; // 0.40 -> 0.30
        const pistolP  = 0.40 + (0.30 - 0.40) * t; // 0.40 -> 0.30
        const rocketP  = 0.15 + (0.25 - 0.15) * t; // 0.15 -> 0.25
        const specialP = 0.05 + (0.15 - 0.05) * t; // 0.05 -> 0.15

        // 累积分布抽样
        if (r < meleeP) return 'melee';
        if (r < meleeP + pistolP) return 'pistol';
        if (r < meleeP + pistolP + rocketP) return 'rocket';
        return 'special';
    }

    if (difficulty === 'insane') {
        // 疯狂：高级兵种为主
        // melee 5%, pistol 25%, rocket 35%, special 35%
        if (r < 0.05) return 'melee';
        if (r < 0.30) return 'pistol';
        if (r < 0.65) return 'rocket';
        return 'special';
    } else if (difficulty === 'hard') {
        // 机密：中高级兵种占比较高
        // melee 20%, pistol 40%, rocket 25%, special 15%
        if (r < 0.20) return 'melee';
        if (r < 0.60) return 'pistol';
        if (r < 0.85) return 'rocket';
        return 'special';
    } else {
        // normal / 默认：低级兵种更多
        // melee 40%, pistol 40%, rocket 15%, special 5%
        if (r < 0.40) return 'melee';
        if (r < 0.80) return 'pistol';
        if (r < 0.95) return 'rocket';
        return 'special';
    }
}

// 定期报告视线检测统计（每5秒一次）
function reportLosStats() {
    const now = performance.now();
    if (now - losLastReportTime > 5000) { // 5秒报告一次
        const avgTime = losCheckCount > 0 ? losTotalTime / losCheckCount : 0;
        console.log(`👁️ 视线检测监控: 5秒内${losCheckCount}次调用, 平均${avgTime.toFixed(3)}ms/次, 场景遍历=${losCheckCount}次`);
        losCheckCount = 0;
        losTotalTime = 0;
        losLastReportTime = now;
    }
}

export class Enemy {
    constructor(x, z, type = 'melee') {
        this.type = type;
        this.radius = 0.6;
        this.lastLosCheck = 0; // 上次视线检测时间
        this.losCheckInterval = 50; // 每50毫秒检测一次视线
        this.lastCanSeePlayer = false; // 缓存上次检测结果
        // 挑战模式下敌人生成即激活（无需视线检测），普通模式需要先看到玩家
        this.isAlerted = state.selectedDifficulty === 'challenge' ? true : false;
        // 挑战模式下敌人全图感知（200米），普通模式50米
        this.alertRadius = state.selectedDifficulty === 'challenge' ? 200 : 50;
        this.alertIcon = null; // 警戒感叹号图标
        this.alertStartTime = null; // 开始满足警戒条件的时间，用于延迟触发
        // 出生时间：用于在生成后的前几帧内强制保持物理激活，避免还在落地过程中就被移除刚体
        this.spawnTime = performance.now();
        this.body = new CANNON.Body({
            mass: 50, shape: new CANNON.Sphere(this.radius),
            material: state.physicsMaterial, fixedRotation: true, linearDamping: 0.05,
            collisionFilterGroup: state.collisionGroups.ENEMY,
            collisionFilterMask: state.collisionGroups.PLAYER | state.collisionGroups.STATIC  // 不与 ENEMY 组碰撞
        });
        this.body.position.set(x, 5, z);
        state.world.addBody(this.body);
        // 标记当前刚体是否在物理世界中，便于后续按距离动态启用/禁用
        this.inPhysicsWorld = true;

        this.mesh = new THREE.Group();
        // Melee: default gray; Pistol: slightly different color? 
        // Or just add a gun. Let's clone the material.
        const mat = state.mats.enemy.clone();
        // 增加自发光强度，使其在黑暗中也能被看见
        mat.emissive = new THREE.Color(0x222222);
        mat.emissiveIntensity = 0.5; // 轻微自发光，不影响遮挡

        if (this.type === 'pistol') {
            mat.color.setHex(0x556677); // Slightly blueish for pistol
            mat.emissive.setHex(0x111122); // 微蓝自发光
        } else if (this.type === 'rocket') {
            mat.color.setHex(0x664422); // Brownish for rocket enemy
            mat.emissive.setHex(0x221100); // 微暖自发光
        } else if (this.type === 'special') {
            mat.color.setHex(0x2d5016); // Green camouflage for special forces
            mat.emissive.setHex(0x0a1a05); // 微绿自发光
        }
        
        // 为敌人添加动态物体标记
        this.mesh.userData.isEnemy = true;
        this.mesh.userData.isDynamic = true;
        this.mesh.userData.isStatic = false;
        this.mesh.userData.bounds = {x, z, width: 1.2, depth: 1.2, height: 1.8};
        
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.35), mat);
        body.position.y = 0; body.userData.canDebris = true; 
        body.userData.isActive = true; // 默认激活
        body.userData.debrisColor = 0x880000; 
        body.userData.debrisCount = 6;
        // 为子物体也设置标记
        body.userData.physicsBody = this.body;
        body.userData.hasPhysicsBody = true;
        this.mesh.add(body);
        
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), mat);
        head.position.y = 0.7; head.name = 'head';
        head.userData.canDebris = true; head.userData.isActive = true; // 默认激活
        head.userData.debrisColor = 0x880000;
        head.userData.debrisCount = 6;
        head.userData.debrisMultiplier = 10;
        head.userData.physicsBody = this.body;
        head.userData.hasPhysicsBody = true;
        this.mesh.add(head);

        if (this.type === 'pistol') {
            // Add a simple gun model
            const gunGeo = new THREE.BoxGeometry(0.1, 0.1, 0.3);
            const gunMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
            const gun = new THREE.Mesh(gunGeo, gunMat);
            gun.position.set(0.25, 0.2, 0.3); // Hold in "hand"
            this.mesh.add(gun);
            this.lastShotTime = 0;
        } else if (this.type === 'rocket') {
            // 添加红色军官帽
            const hatGeo = new THREE.BoxGeometry(0.4, 0.15, 0.5);
            const hatMat = new THREE.MeshStandardMaterial({ color: 0xcc0000 });
            const hat = new THREE.Mesh(hatGeo, hatMat);
            hat.position.set(0, 0.9, 0);
            this.mesh.add(hat);
            
            // 添加棕色火箭筒（扛在肩上正对前面）
            const launcherGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 8);
            const launcherMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
            const launcher = new THREE.Mesh(launcherGeo, launcherMat);
            launcher.rotation.x = Math.PI / 2; // 向前放置
            launcher.position.set(0, 0.5, 0.3); // 扛在肩膀前方
            this.mesh.add(launcher);
            
            // 火箭筒前端
            const tipGeo = new THREE.ConeGeometry(0.08, 0.2, 8);
            const tipMat = new THREE.MeshStandardMaterial({ color: 0x654321 });
            const tip = new THREE.Mesh(tipGeo, tipMat);
            tip.rotation.x = Math.PI / 2;
            tip.position.set(0, 0.5, 0.9); // 火箭筒前端
            this.mesh.add(tip);
            
            this.lastShotTime = 0;
        } else if (this.type === 'special') {
            // 添加绿色迷彩头盔
            const helmetGeo = new THREE.BoxGeometry(0.35, 0.2, 0.4);
            const helmetMat = new THREE.MeshStandardMaterial({ color: 0x1a3d0a });
            const helmet = new THREE.Mesh(helmetGeo, helmetMat);
            helmet.position.set(0, 0.9, 0);
            this.mesh.add(helmet);
            
            // 添加步枪模型
            const rifleGeo = new THREE.BoxGeometry(0.08, 0.08, 0.8);
            const rifleMat = new THREE.MeshStandardMaterial({ color: 0x2d2d2d });
            const rifle = new THREE.Mesh(rifleGeo, rifleMat);
            rifle.rotation.x = Math.PI / 2; // 向前放置
            rifle.position.set(0.25, 0.2, 0.4); // 手持位置
            this.mesh.add(rifle);
            
            // 添加瞄准镜
            const scopeGeo = new THREE.BoxGeometry(0.06, 0.06, 0.15);
            const scopeMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
            const scope = new THREE.Mesh(scopeGeo, scopeMat);
            scope.rotation.x = Math.PI / 2;
            scope.position.set(0.25, 0.25, 0.4);
            this.mesh.add(scope);
            
            // 添加弹匣
            const magazineGeo = new THREE.BoxGeometry(0.03, 0.12, 0.04);
            const magazineMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
            const magazine = new THREE.Mesh(magazineGeo, magazineMat);
            magazine.position.set(0.25, 0.05, 0.5);
            this.mesh.add(magazine);
            
            // 特种兵连发和弹匣相关属性
            this.lastShotTime = 0;
            this.burstCount = 0;
            this.burstStartTime = 0;
            this.currentAmmo = CONFIG.specialEnemy.magazineSize;  // 当前弹药
            this.isReloading = false;                              // 是否正在换弹
            this.reloadStartTime = 0;                              // 开始换弹时间
        }

        state.scene.add(this.mesh);
        
        // 📴 暂时关闭：将敌人添加到碰撞网格的动态集合，避免不必要的网格更新开销
        // collisionGrid.addDynamicObject(this.mesh);
        
        // 根据难度调整血量
        let difficultyMultiplier = 1.0;
        if (state.selectedDifficulty === 'challenge') {
            // 挑战模式：使用动态难度倍率（1x 到 3x，5分钟达到顶峰）
            difficultyMultiplier = state.challengeDifficultyMultiplier || 1.0;
        } else if (state.selectedDifficulty === 'hard') {
            difficultyMultiplier = 2.0; // 中等难度血量翻倍
        } else if (state.selectedDifficulty === 'insane') {
            difficultyMultiplier = 4.0; // 困难难度血量4倍
        }
        
        let baseHp = 200; // 普通兵
        if (this.type === 'pistol') {
            baseHp = 130;      // 手枪兵
        } else if (this.type === 'rocket') {
            baseHp = 180;      // 火箭兵
        } else if (this.type === 'special') {
            baseHp = 300;      // 特种兵
        }
        this.hp = Math.round(baseHp * difficultyMultiplier);
        
        // 挑战模式：存储伤害倍率供攻击时使用
        this.damageMultiplier = state.selectedDifficulty === 'challenge' 
            ? (state.challengeDifficultyMultiplier || 1.0) 
            : 1.0;
        
        state.enemies.push(this);
        
            }

    update() {
        this.mesh.position.copy(this.body.position);
        
        // 📴 暂时关闭：更新碰撞网格中的动态对象位置，当前没有系统依赖这部分查询
        // this.mesh.userData.bounds.x = this.body.position.x;
        // this.mesh.userData.bounds.z = this.body.position.z;
        // collisionGrid.updateDynamicObject(this.mesh);
        
        // 始终使用 THREE.Vector3 存储玩家位置，避免在 tryShoot 中 clone 出错
        // 🆕 蹲下时稍微降低目标高度，让掩体更容易挡住视线/子弹
        const crouchAmount = typeof state.crouchAmount === 'number' ? state.crouchAmount : 0;
        const crouchYOffset = crouchAmount * 0.25; // 最多降低 0.25 米
        const playerPos = new THREE.Vector3(
            state.playerBody.position.x,
            state.playerBody.position.y - crouchYOffset,
            state.playerBody.position.z
        );
        const enemyPos = this.mesh.position;
        const dx = playerPos.x - this.body.position.x;
        const dz = playerPos.z - this.body.position.z;
        const dist = Math.sqrt(dx*dx + dz*dz);
        
        // 视线检测频率控制：每50毫秒检测一次
        const now = performance.now();
        let canSeePlayer = this.lastCanSeePlayer; // 默认使用上次结果
        
        // 距离过滤：根据兵种类型设置不同的距离阈值
        let maxAttackRange = 50; // 默认值
        if (this.type === 'pistol') {
            maxAttackRange = CONFIG.pistolEnemy.attackRange + 2; // 22米
        } else if (this.type === 'rocket') {
            maxAttackRange = CONFIG.rocketEnemy.attackRange + 2; // 32米
        } else if (this.type === 'special') {
            maxAttackRange = CONFIG.specialEnemy.attackRange + 2; // 37米
        } else if (this.type === 'melee') {
            maxAttackRange = 10; // 近战兵设置较小范围
        }
        
        // 🆕 警戒系统逻辑
        if (!this.isAlerted) {
            // 未警戒状态：检查玩家是否进入警戒范围
            const inAlertRange = dist <= this.alertRadius && hasLineOfSight(enemyPos, playerPos);

            if (inAlertRange) {
                // 第一次看到玩家时记录时间
                if (this.alertStartTime === null) {
                    this.alertStartTime = now;
                }

                // 持续满足条件满1秒才真正进入警戒
                if (now - this.alertStartTime >= 1000) {
                    this.isAlerted = true;
                    this.alertStartTime = null;
                    this.showAlertIcon();
                } else {
                    // 计时中：敌人仍然不移动
                    this.body.velocity.x = 0;
                    this.body.velocity.z = 0;
                    return; // 等待计时完成
                }
            } else {
                // 条件不满足，重置计时并保持待命
                this.alertStartTime = null;
                this.body.velocity.x = 0;
                this.body.velocity.z = 0;
                return; // 提前返回，不执行后续移动和攻击逻辑
            }
        }
        
        // 已警戒状态：正常执行移动和攻击逻辑
        if (dist > maxAttackRange) {
            canSeePlayer = false;
            this.lastCanSeePlayer = false;
        } else if (now - this.lastLosCheck > this.losCheckInterval) {
            canSeePlayer = hasLineOfSight(enemyPos, playerPos);
            this.lastCanSeePlayer = canSeePlayer;
            this.lastLosCheck = now;
        }
        
        this.mesh.lookAt(playerPos.x, this.mesh.position.y, playerPos.z);
        
        // 更新感叹号动画
        this.updateAlertIcon();

        if (this.type === 'melee') {
            if(dist > 1.5) {
                const speed = 5.5;
                this.body.velocity.x = (dx/dist) * speed;
                this.body.velocity.z = (dz/dist) * speed;
            } else {
                attackPlayer(this.body.position);
            }
        } else if (this.type === 'pistol') {
            const pConf = CONFIG.pistolEnemy;
            
            // Shooting Logic - 只有能看到玩家时才射击
            if (dist <= pConf.attackRange && canSeePlayer) {
                this.tryShoot(dist, playerPos);
            }
            
            // Movement Logic - 只有在不射击时才移动
            if (dist > pConf.stopDistance) {
                // Move closer
                const speed = pConf.speed || 3.0;
                this.body.velocity.x = (dx/dist) * speed;
                this.body.velocity.z = (dz/dist) * speed;
            } else if (dist < pConf.stopDistance * 0.5) {
                // Back off if too close (optional, keeps them at range)
                const speed = pConf.speed || 3.0;
                this.body.velocity.x = -(dx/dist) * speed;
                this.body.velocity.z = -(dz/dist) * speed;
            } else {
                // Stand still
                this.body.velocity.x = 0;
                this.body.velocity.z = 0;
            }
        } else if (this.type === 'rocket') {
            const rConf = CONFIG.rocketEnemy;
            
            // Shooting Logic - 只有能看到玩家时才射击
            if (dist <= rConf.attackRange && canSeePlayer) {
                this.tryShoot(dist, playerPos);
            }
            
            // Movement Logic - 火箭兵移动
            if (dist > rConf.stopDistance) {
                // Move closer
                const speed = rConf.speed || 2.5;
                this.body.velocity.x = (dx/dist) * speed;
                this.body.velocity.z = (dz/dist) * speed;
            } else if (dist < rConf.stopDistance * 0.5) {
                // Back off if too close
                const speed = rConf.speed || 2.5;
                this.body.velocity.x = -(dx/dist) * speed;
                this.body.velocity.z = -(dz/dist) * speed;
            } else {
                // Stand still
                this.body.velocity.x = 0;
                this.body.velocity.z = 0;
            }
        } else if (this.type === 'special') {
            const sConf = CONFIG.specialEnemy;
            
            // Shooting Logic - 只有能看到玩家时才射击
            if (dist <= sConf.attackRange && canSeePlayer) {
                this.tryShoot(dist, playerPos);
            }
            
            // Movement Logic - 特种兵移动（换弹时也可以移动）
            if (dist > sConf.stopDistance) {
                // Move closer - 不管是否能看到玩家，都会向玩家方向移动
                const speed = sConf.speed || 3.2;
                this.body.velocity.x = (dx/dist) * speed;
                this.body.velocity.z = (dz/dist) * speed;
            } else if (dist < sConf.stopDistance * 0.4) {
                // Back off if too close (特种兵更倾向于保持距离)
                const speed = sConf.speed || 3.2;
                this.body.velocity.x = -(dx/dist) * speed;
                this.body.velocity.z = -(dz/dist) * speed;
            } else {
                // Stand still
                this.body.velocity.x = 0;
                this.body.velocity.z = 0;
            }
        }
    }

    tryShoot(dist, playerPos) {
        // 带冷却的简单逻辑
        const now = performance.now();
        let config, projectile;
        
        if (this.type === 'pistol') {
            config = CONFIG.pistolEnemy;
        } else if (this.type === 'rocket') {
            config = CONFIG.rocketEnemy;
        } else if (this.type === 'special') {
            config = CONFIG.specialEnemy;
        } else {
            return; // 其他类型不射击
        }
        
        // 特种兵连发和弹匣逻辑
        if (this.type === 'special') {
            // 检查是否正在换弹
            if (this.isReloading) {
                if (now - this.reloadStartTime < config.reloadTime * 1000) {
                    return; // 还在换弹中
                } else {
                    // 换弹完成
                    this.isReloading = false;
                    this.currentAmmo = config.magazineSize;
                    // console.log(`🔫 特种兵换弹完成! 弹药: ${this.currentAmmo}/${config.magazineSize}`);
                }
            }
            
            // 检查弹药
            if (this.currentAmmo <= 0) {
                // 弹药耗尽，开始换弹
                this.isReloading = true;
                this.reloadStartTime = now;
                this.burstCount = 0; // 重置连发计数
                // console.log(`🔫 特种兵开始换弹... (3秒)`);
                return;
            }
            
            // 连发模式：检查是否在连发中
            if (this.burstCount > 0) {
                // 正在连发中，检查连发间隔
                if (now - this.lastShotTime < config.burstDelay * 1000) {
                    return; // 连发间隔未到
                }
            } else {
                // 开始新的连发，检查主冷却
                const mainCooldownMs = (config.fireRate || 0) * 1000;
                if (now - this.burstStartTime < mainCooldownMs) {
                    return; // 主冷却未到
                }
                this.burstStartTime = now;
                this.burstCount = 0;
            }
        } else {
            // 其他兵种的普通冷却逻辑
            const cooldownMs = (config.fireRate || 0) * 1000;
            if (now - this.lastShotTime < cooldownMs) {
                return; // 冷却中，不开枪
            }
        }
        this.lastShotTime = now;

        // 计算发射位置
        let start;
        if (this.type === 'rocket') {
            // 火箭弹从火箭筒前端发射
            start = this.mesh.position.clone().add(
                new THREE.Vector3(0, 0.5, 0.9).applyQuaternion(this.mesh.quaternion)
            );
        } else if (this.type === 'special') {
            // 特种兵从步枪枪口发射
            start = this.mesh.position.clone().add(
                new THREE.Vector3(0.65, 0.2, 0.4).applyQuaternion(this.mesh.quaternion)
            );
        } else {
            // 手枪从手中发射
            start = this.mesh.position.clone().add(
                new THREE.Vector3(0.25, 0.2, 0.3).applyQuaternion(this.mesh.quaternion)
            );
        }

        // 其他士兵瞄准玩家中心，火箭筒兵瞄准脚底附近
        let target = playerPos.clone();
        if (this.type === 'rocket') {
            target = playerPos.clone().add(new THREE.Vector3(0, -0.5, 0));
        }
        const direction = target.sub(start).normalize();
        
        // 散布：不同兵种不同散布
        let spread;
        if (this.type === 'rocket') {
            // 火箭兵：进一步降低散布，趋近直线飞行
            spread = 0.003;
        } else if (this.type === 'special') {
            // 特种兵：保持原有中等散布
            spread = 0.08;
        } else {
            // 手枪：极小散布
            spread = 0.002;
        }
        direction.x += (Math.random() - 0.5) * spread;
        direction.y += (Math.random() - 0.5) * spread;
        direction.z += (Math.random() - 0.5) * spread;
        direction.normalize();

        // 播放发射音效
        if (this.type === 'rocket') {
            playRocketShotSound(this.mesh.position);
        } else if (this.type === 'special') {
            playEnemyPistolSound(this.mesh.position); // 特种兵也用手枪音效（可以后续改为步枪音效）
        } else if (this.type === 'pistol') {
            playEnemyPistolSound(this.mesh.position);
        }

        // 创建相应的弹药
        if (this.type === 'rocket') {
            projectile = new Rocket(start, direction, true, this.mesh.position.clone());
        } else if (this.type === 'special') {
            projectile = new SpecialBullet(start, direction, true, this.mesh.position.clone());
        } else {
            projectile = new Bullet(start, direction, true, this.mesh.position.clone());
        }
        
        state.bullets.push(projectile);
        
        // 特种兵连发计数和弹药消耗
        if (this.type === 'special') {
            this.burstCount++;
            this.currentAmmo--; // 消耗弹药
            
            // 如果达到连发上限，重置连发计数
            if (this.burstCount >= config.burstCount) {
                this.burstCount = 0;
            }
            
            // 如果弹药用完，准备换弹
            if (this.currentAmmo <= 0) {
                // console.log(`🔫 特种兵弹匣空了! 剩余弹药: ${this.currentAmmo}/${config.magazineSize}`);
            }
        }
    }

    hit(isHeadshot, hitPosition = null, damageOverride = null) {
        let damage;
        
        if (damageOverride !== null) {
            damage = damageOverride;
        } else {
            const wp = state.weaponConfig || CONFIG.weaponPresets.m4a1;
            const baseBody = 1;
            damage = baseBody * (wp.damageScale || 1.0);
            
            // 应用弹药等级伤害修正
            if (state.currentAmmoGrade) {
                damage *= state.currentAmmoGrade.damageMultiplier;
            }
            
            if (isHeadshot) {
                damage *= (wp.headshotMultiplier || 1.8);
            }
        }
        
        this.hp -= damage;
        
        // 显示伤害数字 - 使用实际击中位置或敌人位置
        const displayPosition = hitPosition || this.mesh.position;
        if (displayPosition) {
            showDamageNumber(Math.round(damage), displayPosition, isHeadshot);
        }
        
        // 🆕 受伤触发警戒逻辑
        if (!this.isAlerted) {
            this.isAlerted = true;
            this.showAlertIcon();
        }
        
        this.mesh.children.forEach(c => {
            if (c.material && c.material.emissive !== undefined) {
                c.material.emissive = new THREE.Color(0xff0000);
            }
        });
        setTimeout(() => {
            if(this.mesh) this.mesh.children.forEach(c => {
                if (c.material && c.material.emissive !== undefined) {
                    c.material.emissive = new THREE.Color(0x000000);
                }
            });
        }, 100);
        if(this.hp <= 0) { this.die(); return true; }
        return false;
    }

    showAlertIcon() {
        // 创建真实的感叹号形状
        const iconGroup = new THREE.Group();
        
        // 感叹号的竖条部分
        const barGeometry = new THREE.BoxGeometry(0.08, 0.4, 0.05);
        const barMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffff00 
        });
        const bar = new THREE.Mesh(barGeometry, barMaterial);
        bar.position.y = 0.1; // 稍微偏下
        
        // 感叹号的圆点部分
        const dotGeometry = new THREE.SphereGeometry(0.08, 8, 8);
        const dotMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffff00 
        });
        const dot = new THREE.Mesh(dotGeometry, dotMaterial);
        dot.position.y = -0.25; // 底部圆点
        
        iconGroup.add(bar, dot);
        iconGroup.position.set(0, 1.5, 0); // 头顶上方
        
        // 添加动画属性
        iconGroup.userData = {
            baseY: 1.5,
            floatTime: 0,
            floatSpeed: 0.003,
            floatHeight: 0.15,
            jumpTime: 0,
            jumpDuration: 0.5, // 跳跃动画持续时间（秒）
            isJumping: true
        };
        
        this.alertIcon = iconGroup;
        this.mesh.add(this.alertIcon);
        
        // 3秒后自动消失
        setTimeout(() => {
            if (this.alertIcon && this.mesh) {
                this.mesh.remove(this.alertIcon);
                this.alertIcon = null;
            }
        }, 3000);
    }

    updateAlertIcon() {
        if (this.alertIcon && this.alertIcon.userData) {
            const userData = this.alertIcon.userData;
            userData.floatTime += userData.floatSpeed;
            
            let jumpOffset = 0;
            
            // 处理跳跃动画
            if (userData.isJumping) {
                userData.jumpTime += 0.016; // 假设60fps，每帧约0.016秒
                
                if (userData.jumpTime <= userData.jumpDuration) {
                    // 跳跃动画：使用抛物线公式
                    const progress = userData.jumpTime / userData.jumpDuration;
                    const jumpHeight = 0.4; // 跳跃高度
                    jumpOffset = jumpHeight * 4 * progress * (1 - progress); // 抛物线
                    
                    // 跳跃时放大效果
                    const scale = 1 + progress * 0.3;
                    this.alertIcon.scale.set(scale, scale, scale);
                } else {
                    // 跳跃结束，恢复正常缩放
                    userData.isJumping = false;
                    this.alertIcon.scale.set(1, 1, 1);
                }
            }
            
            // 上下浮动效果（跳跃结束后）
            const floatOffset = Math.sin(userData.floatTime) * userData.floatHeight;
            
            // 组合位置：跳跃 + 浮动
            this.alertIcon.position.y = userData.baseY + jumpOffset + floatOffset;
            
            // 闪烁效果
            const pulse = Math.sin(userData.floatTime * 2) * 0.3 + 0.7;
            this.alertIcon.children.forEach(child => {
                if (child.material) {
                    child.material.emissiveIntensity = pulse;
                }
            });
        }
    }

    die() {
        // 25% 概率掉落弹药箱
        if (Math.random() < 0.25) {
            createAmmoPickup(this.body.position);
        }
        // 50% 概率掉落血包（恢复 5-30 HP）
        if (Math.random() < 0.5) {
            createHealthPickup(this.body.position);
        }
        
        // 🆕 从碰撞网格中移除
        collisionGrid.removeObject(this.mesh);
        
        state.scene.remove(this.mesh); state.world.removeBody(this.body);
        const idx = state.enemies.indexOf(this);
        if(idx > -1) state.enemies.splice(idx, 1);
        setTimeout(() => spawnEnemy(), 3000);
    }
}

export function spawnEnemy() {
    console.log(`👾 尝试生成敌人: 当前敌人数量=${state.enemies.length}, 最大数量=${CONFIG.enemyCount}, 游戏状态=${state.isGameActive}`);
    
    if(!state.isGameActive || state.enemies.length >= CONFIG.enemyCount) return;
    
    const settings = CONFIG.enemySpawn || {
        minDistance: 30,
        jitter: 10
    };

    const playerPos = new THREE.Vector3(
        state.playerBody.position.x,
        state.playerBody.position.y,
        state.playerBody.position.z
    );

    // 🆕 简化逻辑：从所有安全生成点中随机选择
    const validSpawnPoints = state.spawnPoints.filter(point => {
        const dist = point.distanceTo(playerPos);
        return dist >= settings.minDistance;  // 只检查最小距离
    });

    let spawnPos = null;
    
    if (validSpawnPoints.length > 0) {
        // 🆕 均匀随机选择一个生成点
        const randomIndex = Math.floor(Math.random() * validSpawnPoints.length);
        spawnPos = validSpawnPoints[randomIndex];
        
            } else {
        // 如果没有满足最小距离的点，回退到随机位置
        console.warn('⚠️ 没有满足最小距离的安全生成点，使用随机位置');
        const angle = Math.random() * Math.PI * 2;
        const distance = settings.minDistance + Math.random() * 100; // 30-130米随机
        spawnPos = new THREE.Vector3(
            playerPos.x + Math.cos(angle) * distance,
            5,
            playerPos.z + Math.sin(angle) * distance
        );
    }

    // 添加随机偏移
    const jitter = settings.jitter ?? 10;
    let x = spawnPos.x + (Math.random() - 0.5) * jitter;
    let z = spawnPos.z + (Math.random() - 0.5) * jitter;
    
    // 最终安全检查
    if (window.isSafeSpawnPosition && !window.isSafeSpawnPosition(x, z)) {
        x = spawnPos.x;
        z = spawnPos.z;
    }

    // 根据难度生成不同类型的敌人
    const type = pickEnemyTypeByDifficulty();

    // console.log(`🎯 生成敌人: ${type} (当前分数: ${state.score})`);
    new Enemy(x, z, type);
}

// 挑战模式：在地图边缘固定位置生成敌人（难度随时间递增）
export function updateEnemySpawnsAtEdges() {
    // 初始化挑战模式开始时间
    if (!state.challengeStartTime) {
        state.challengeStartTime = performance.now();
    }
    
    // 计算游戏进行时间（秒）
    const elapsedSeconds = (performance.now() - state.challengeStartTime) / 1000;
    const maxTime = 300; // 5分钟（300秒）达到顶峰
    const progressRatio = Math.min(elapsedSeconds / maxTime, 1.0); // 0 到 1 的进度

    // 暴露给兵种选择逻辑使用（挑战模式兵种比例插值）
    state.challengeSpawnProgressRatio = progressRatio;
    
    // === 动态生成间隔：从 2 秒逐渐降到 0.3 秒 ===
    const spawnIntervalStart = 2.0;   // 初始间隔
    const spawnIntervalEnd = 0.3;     // 最终间隔
    const currentSpawnInterval = spawnIntervalStart - (spawnIntervalStart - spawnIntervalEnd) * progressRatio;
    
    if (!state.enemyEdgeSpawnTimer) state.enemyEdgeSpawnTimer = 0;
    const dt = state.frameDt || 0;
    state.enemyEdgeSpawnTimer += dt;
    if (state.enemyEdgeSpawnTimer < currentSpawnInterval) return;
    state.enemyEdgeSpawnTimer -= currentSpawnInterval;
    
    if (!state.isGameActive || !state.playerBody || !state.currentMapConfig) return;

    // === 动态敌人上限：从 50 增加到 150 ===
    const maxEnemiesStart = 50;
    const maxEnemiesEnd = 150;
    const maxEnemies = Math.floor(maxEnemiesStart + (maxEnemiesEnd - maxEnemiesStart) * progressRatio);
    if (state.enemies.length >= maxEnemies) return;
    
    // === 每次生成的敌人数量：从 1 增加到 3 ===
    const spawnCountStart = 1;
    const spawnCountEnd = 3;
    const spawnCount = Math.floor(spawnCountStart + (spawnCountEnd - spawnCountStart) * progressRatio);
    
    // 存储难度倍率供 Enemy 构造函数和弹药使用
    // 伤害倍率从 0.5x 线性提升到 1.2x（5分钟）
    state.challengeDifficultyMultiplier = 0.5 + (1.2 - 0.5) * progressRatio; // 0.5x -> 1.2x

    // === 敌人生成逻辑（在墙外门洞对应位置生成）===
    // 获取地图边界信息
    const bounds = state.currentMapConfig.bounds || { width: 600, depth: 600 };
    const halfWidth = bounds.width / 2;
    const halfDepth = bounds.depth / 2;
    
    // 围墙参数（必须与 cityGenerator.js 中的 createBoundaryWalls 保持一致）
    const wallOffset = 5;           // 墙距离边缘的内缩距离
    const spawnDistance = 15;       // 敌人在墙外多远生成
    
    // 墙的位置
    const wallPosX = halfWidth - wallOffset;
    const wallPosZ = halfDepth - wallOffset;
    
    // 敌人生成位置（在墙外）
    const spawnOutsideX = wallPosX + spawnDistance;  // 墙外 X
    const spawnOutsideZ = wallPosZ + spawnDistance;  // 墙外 Z
    
    // 门洞位置（每面墙两个门，在墙的 ±50% 位置）
    const gateOffset = wallPosX * 0.5;  // 门的 X/Z 偏移
    
    // 8个门洞对应的生成点（敌人在门洞正对面的墙外生成）
    const gateSpawnPoints = [
        // 北墙两个门（z 在墙外北侧）
        { x: -gateOffset, z: -spawnOutsideZ, side: 'north1' },
        { x: gateOffset, z: -spawnOutsideZ, side: 'north2' },
        // 南墙两个门（z 在墙外南侧）
        { x: -gateOffset, z: spawnOutsideZ, side: 'south1' },
        { x: gateOffset, z: spawnOutsideZ, side: 'south2' },
        // 西墙两个门（x 在墙外西侧）
        { x: -spawnOutsideX, z: -gateOffset, side: 'west1' },
        { x: -spawnOutsideX, z: gateOffset, side: 'west2' },
        // 东墙两个门（x 在墙外东侧）
        { x: spawnOutsideX, z: -gateOffset, side: 'east1' },
        { x: spawnOutsideX, z: gateOffset, side: 'east2' }
    ];
    
    // 所有生成点就是 8 个门洞
    const allSpawnPoints = gateSpawnPoints;
    
    // 获取玩家位置，确保生成点与玩家保持安全距离
    const playerPos = state.playerBody.position;
    const safeDistance = 50; // 安全距离：50米（敌人在墙外生成，玩家通常看不到）
    
    // 筛选安全的生成点（远离玩家）
    const safeSpawnPoints = allSpawnPoints.filter(point => {
        const dx = point.x - playerPos.x;
        const dz = point.z - playerPos.z;
        const distSq = dx * dx + dz * dz;
        return distSq && Math.sqrt(distSq) >= safeDistance;
    });
    
    if (safeSpawnPoints.length === 0) return; // 没有安全的生成点
    
    // 生成 spawnCount 个敌人
    for (let i = 0; i < spawnCount; i++) {
        // 检查是否达到上限
        if (state.enemies.length >= maxEnemies) break;
        
        // 根据难度选择敌人类型（使用和PVE模式相同的逻辑）
        const type = pickEnemyTypeByDifficulty();
        
        // 随机选择一个安全的生成点
        const spawnPoint = safeSpawnPoints[Math.floor(Math.random() * safeSpawnPoints.length)];
        
        // 添加小幅随机偏移，避免敌人重叠（但保持在门洞宽度范围内）
        const jitter = 5; // 5米随机偏移（门洞宽度12米，确保敌人仍在门洞前）
        const finalX = spawnPoint.x + (Math.random() - 0.5) * jitter * 2;
        const finalZ = spawnPoint.z + (Math.random() - 0.5) * jitter * 2;
        
        // 敌人在墙外生成，不需要 clamp 到地图边界内
        // 敌人的 AI 会引导它们穿过门洞进入地图
        
        // 生成敌人
        new Enemy(finalX, finalZ, type);
    }
    
    // === 物理激活管理（从PVE模式移植）===
    // 确保挑战模式敌人也能正确激活物理刚体进行攻击
    if (!state.enemies || !state.playerBody) return;
    
    const activeRadius = 100; // 敌人物理激活半径（米）
    const activeRadiusSq = activeRadius * activeRadius;
    const raycastRadius = 200; // 敌人被射线命中/可见的半径（米）
    const raycastRadiusSq = raycastRadius * raycastRadius;
    const now = performance.now();
    
    for (const enemy of state.enemies) {
        const ex = enemy.body.position.x - playerPos.x;
        const ez = enemy.body.position.z - playerPos.z;
        const distSq = ex * ex + ez * ez;
        
        // 动态管理敌人物理刚体（100米范围）
        let shouldBeActive = distSq <= activeRadiusSq;

        // 出生缓冲：生成后至少1.5秒内强制保持物理激活，避免还在落地过程中就被移除刚体
        const spawnTime = enemy.spawnTime || 0;
        if (now - spawnTime < 1500) {
            shouldBeActive = true;
        }

        // 初始化 isActive 标记（默认 true）
        if (enemy.mesh.userData.isActive === undefined) {
            enemy.mesh.userData.isActive = true;
        }

        // 确保有标记字段
        if (enemy.inPhysicsWorld === undefined) {
            enemy.inPhysicsWorld = true;
        }

        if (shouldBeActive && !enemy.inPhysicsWorld) {
            // 重新将刚体加入物理世界
            state.world.addBody(enemy.body);
            enemy.inPhysicsWorld = true;
        } else if (!shouldBeActive && enemy.inPhysicsWorld) {
            // 从物理世界中移除刚体，但保留 Mesh 与逻辑
            state.world.removeBody(enemy.body);
            enemy.inPhysicsWorld = false;
            // 避免残留速度导致再次加入时出现突变
            enemy.body.velocity.set(0, 0, 0);
        }

        // 敌人被射线命中的可见范围：独立于物理刚体，使用更大的 200 米
        enemy.mesh.userData.isActive = distSq <= raycastRadiusSq;
    }
}

// 更新所有敌人的行为
export function updateEnemies(dt) {
    // 遍历所有敌人并调用它们的更新方法
    for (const enemy of state.enemies) {
        if (enemy && typeof enemy.update === 'function') {
            enemy.update();
        }
    }
    
    // === 碰撞检测系统更新 ===
    // 确保敌人对射线检测可见（每帧更新，支持所有敌人生成模式）
    if (!state.enemies || !state.playerBody) return;
    
    const playerPos = state.playerBody.position;
    const raycastRadius = 200; // 敌人射线检测可见范围：200米
    const raycastRadiusSq = raycastRadius * raycastRadius;
    const now = performance.now();
    
    // 更新每个敌人的活跃状态
    for (const enemy of state.enemies) {
        const ex = enemy.body.position.x - playerPos.x;
        const ez = enemy.body.position.z - playerPos.z;
        const distSq = ex * ex + ez * ez;
        
        // 敌人被射线命中的可见范围：独立于物理刚体，使用更大的 200 米
        enemy.mesh.userData.isActive = distSq <= raycastRadiusSq;
    }

    // 维护活跃动态物体数组（用于射线检测优化）
    state.activeDynamicMeshes.length = 0; // 清空数组
    
    // 玩家永远活跃
    if (state.playerMesh && state.playerMesh.userData.isActive) {
        state.activeDynamicMeshes.push(state.playerMesh);
    }
    
    // 添加活跃敌人的所有子Mesh
    for (const enemy of state.enemies) {
        if (enemy.mesh.userData.isActive) {
            enemy.mesh.traverse(child => {
                if (child.isMesh) {
                    state.activeDynamicMeshes.push(child);
                }
            });
        }
    }
}

// 根据挑战模式波次选择敌人类型
function pickEnemyTypeByChallengeWave(wave) {
    const baseTypes = ['basic', 'fast'];
    const advancedTypes = ['basic', 'fast', 'heavy'];
    const eliteTypes = ['fast', 'heavy', 'sniper'];
    
    if (wave <= 2) {
        // 前两波：基础敌人
        return baseTypes[Math.floor(Math.random() * baseTypes.length)];
    } else if (wave <= 5) {
        // 3-5波：加入重甲敌人
        return advancedTypes[Math.floor(Math.random() * advancedTypes.length)];
    } else {
        // 6波以后：精英敌人为主
        return eliteTypes[Math.floor(Math.random() * eliteTypes.length)];
    }
}
export function updateEnemySpawnsAroundPlayer() {
    // 优化：基于时间间隔执行，降低性能开销（每2秒一次）
    if (!state.enemyUpdateTimer) state.enemyUpdateTimer = 0;
    const dt = state.frameDt || 0;
    state.enemyUpdateTimer += dt;
    if (state.enemyUpdateTimer < 2) return; // 每2秒执行一次
    state.enemyUpdateTimer -= 2;
    
    if (!state.isGameActive || !state.playerBody || !state.spawnPoints || state.spawnPoints.length === 0) return;

    // 只在预先选定的敌人刷怪点上生成
    if (!state.enemySpawnIndices || state.enemySpawnIndices.length === 0) return;

    const maxEnemies = CONFIG.enemyCount || 500;
    if (state.enemies.length >= maxEnemies) return;

    const playerPos = new THREE.Vector3(
        state.playerBody.position.x,
        state.playerBody.position.y,
        state.playerBody.position.z
    );

    const maxRadius = 200; // 只在玩家200米半径内生成
    const settings = CONFIG.enemySpawn || { minDistance: 30 };
    const minDistance = settings.minDistance || 30;
    const maxPerFrame = 1000; // 每帧最多生成几个，进一步降低瞬时生成量
    const maxActiveAroundPlayer = 100; // 玩家附近同时激活的敌人上限
    let spawnedThisFrame = 0;

    // 确保有记录已使用的采样点索引
    if (!state.usedSpawnPointIndices) {
        state.usedSpawnPointIndices = new Set();
    }

    // 🆕 合并遍历：一次遍历完成统计和物理管理
    let activeAroundPlayer = 0;
    const activeRadius = 100; // 敌人物理激活半径（米）
    const activeRadiusSq = activeRadius * activeRadius;
    const raycastRadius = 200; // 敌人被射线命中/可见的半径（米）
    const raycastRadiusSq = raycastRadius * raycastRadius;
    const now = performance.now();
    
    for (const enemy of state.enemies) {
        const ex = enemy.body.position.x - playerPos.x;
        const ez = enemy.body.position.z - playerPos.z;
        const distSq = ex * ex + ez * ez;
        const dist = Math.sqrt(distSq);
        
        // 任务1：统计200米内敌人数量
        if (dist <= maxRadius) {
            activeAroundPlayer++;
        }
        
        // 任务2：动态管理敌人物理刚体（100米范围）
        let shouldBeActive = distSq <= activeRadiusSq;

        // 出生缓冲：生成后至少1.5秒内强制保持物理激活，避免还在落地过程中就被移除刚体
        const spawnTime = enemy.spawnTime || 0;
        if (now - spawnTime < 1500) {
            shouldBeActive = true;
        }

        // 初始化 isActive 标记（默认 true）
        if (enemy.mesh.userData.isActive === undefined) {
            enemy.mesh.userData.isActive = true;
        }

        // 确保有标记字段
        if (enemy.inPhysicsWorld === undefined) {
            enemy.inPhysicsWorld = true;
        }

        if (shouldBeActive && !enemy.inPhysicsWorld) {
            // 重新将刚体加入物理世界
            state.world.addBody(enemy.body);
            enemy.inPhysicsWorld = true;
        } else if (!shouldBeActive && enemy.inPhysicsWorld) {
            // 从物理世界中移除刚体，但保留 Mesh 与逻辑
            state.world.removeBody(enemy.body);
            enemy.inPhysicsWorld = false;
            // 避免残留速度导致再次加入时出现突变
            enemy.body.velocity.set(0, 0, 0);
        }

        // 敌人被射线命中的可见范围：独立于物理刚体，使用更大的 200 米
        enemy.mesh.userData.isActive = distSq <= raycastRadiusSq;
    }

    // 维护活跃动态物体数组（用于射线检测优化）
    state.activeDynamicMeshes.length = 0; // 清空数组
    
    // 玩家永远活跃
    if (state.playerMesh && state.playerMesh.userData.isActive) {
        state.activeDynamicMeshes.push(state.playerMesh);
    }
    
    // 添加活跃敌人的所有子Mesh
    for (const enemy of state.enemies) {
        if (enemy.mesh.userData.isActive) {
            enemy.mesh.traverse(child => {
                if (child.isMesh) {
                    state.activeDynamicMeshes.push(child);
                }
            });
        }
    }

    if (activeAroundPlayer >= maxActiveAroundPlayer) return;

    // 只遍历预选的刷怪点索引，保证最多 enemyCount 个敌人位置
    for (let idx = 0; idx < state.enemySpawnIndices.length; idx++) {
        const i = state.enemySpawnIndices[idx];
        if (state.usedSpawnPointIndices.has(i)) continue;

        // 🆕 优先使用预先计算好的带少量随机偏移的安全出生点
        const point = (state.enemySpawnPositions && state.enemySpawnPositions[idx])
            ? state.enemySpawnPositions[idx]
            : state.spawnPoints[i];

        const dx = point.x - playerPos.x;
        const dz = point.z - playerPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        // 只生成在[minDistance, maxRadius]之间的敌人
        if (dist < minDistance || dist > maxRadius) continue;

        // 根据难度决定敌人类型
        const type = pickEnemyTypeByDifficulty();

        new Enemy(point.x, point.z, type);
        state.usedSpawnPointIndices.add(i);
        spawnedThisFrame++;

        if (spawnedThisFrame >= maxPerFrame || state.enemies.length >= maxEnemies) {
            break;
        }
    }
}

function attackPlayer(enemyPos) {
    const now = performance.now();
    if(now - state.lastDamageTime < 1000) return; 
    state.lastDamageTime = now;
    // console.log('👊 近战敌人攻击');
    
    // 根据难度调整近战伤害
    let baseDamage = 30;  // 调整为30
    let difficultyMultiplier = 1.0;
    if (state.selectedDifficulty === 'hard') {
        difficultyMultiplier = 1.5; // 中等难度伤害提升50%
    } else if (state.selectedDifficulty === 'insane') {
        difficultyMultiplier = 2.0; // 困难难度伤害翻倍
    }
    
    const finalDamage = Math.round(baseDamage * difficultyMultiplier);
    
    // 近战：伤害根据难度调整，标准击退（倍率 1.0）
    applyPlayerHit({
        damage: finalDamage,
        sourcePosition: enemyPos,
        knockbackScale: 1.0,
        showOverlay: true
    });
    // 碎片已在applyPlayerHit中生成，不需要重复
    playEnemyProximitySound(enemyPos);
    if(state.health <= 0) endGame();
}
