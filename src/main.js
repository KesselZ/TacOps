import * as THREE from 'three';
import { state } from './globals.js';
import { CONFIG } from './config.js';
import { colyseusClient } from './colyseusClient.js';
import { multiplayerPlayers } from './multiplayerPlayers.js';
import { initGraphics, initPhysics, updateDebris, updateAmmoPickups, updateHealthPickups, resetWorldRuntime, buildLevel, updateStaticPhysicsAroundPlayer, updateAmmoPickupEffects, updateEnvironmentSettings, resetStaticPhysicsAccumTime, updateDroppedItems, updateItemPickupEffects, updateInteractionFocus, buildArenaLevel } from './world.js';
import { initStash, RARITY } from './stash.js';
import { renderStashUI, initStashUIEvents } from './stashUI.js';
import { buildWeapon, updateWeapon, updateBullets, clearBullets } from './weapon.js';
import { updateEnemySpawnsAroundPlayer, updateEnemySpawnsAtEdges, updateEnemies } from './enemy.js';
import { initEvents, updatePlayer } from './player.js';
import { updateUI, showMenu, showPauseMenu, initPauseMenuEvents, hideGlobalLoading } from './ui.js';
import { GameOverScreen } from './gameOverScreen.js';
import { updateMedical } from './medical.js';
import { loadCurrency, saveCurrency, watchCurrency } from './persistence.js';
import { initBackend, setupAutoSave, getLifetimeStats, uploadLifetimeStats, updateCurrency } from './backend_client.js';
import { startStatsSession, finalizeStatsSession } from './statsSession.js';
import { mergeSessionIntoLifetime, getDefaultLifetimeStats } from './statsAggregator.js';

export async function init() {
    // 初始化后端连接
    // console.log('🚀 初始化游戏...');
    
    // 先加载本地数据作为备份
    const localData = {
        currency: loadCurrency()
    };
    
    try {
        // 智能同步本地和后端数据
        const syncedData = await initBackend(localData);
        if (syncedData) {
            // 使用同步后的数据
            state.currency = syncedData.credit || 2000;
            state.playerName = syncedData.nickname || 'Player';

            // 应用云端保存的设置（如果存在）
            const setting = syncedData.setting || {};
            if (setting.mouseSensitivity !== undefined) {
                state.mouseSensitivity = setting.mouseSensitivity;
            }
            if (setting.shadowQuality !== undefined) {
                state.shadowQuality = setting.shadowQuality;
            }
            if (setting.anisoQuality !== undefined) {
                state.anisoQuality = setting.anisoQuality;
            }
            if (setting.renderDistance !== undefined) {
                state.renderDistance = setting.renderDistance;
            }
            if (setting.showPerfDetails !== undefined) {
                state.showPerfDetails = setting.showPerfDetails;
            }
            if (setting.crosshairStyle !== undefined) {
                state.crosshairStyle = setting.crosshairStyle;
            }
            // console.log('✅ 智能同步成功，货币/昵称/设置:', state.currency, state.playerName, setting);
        } else {
            // 后端不可用，使用本地数据
            state.currency = localData.currency;
            state.playerName = 'Player';
            // console.log('⚠️ 后端不可用，使用本地数据，昵称使用默认 Player');
        }
    } catch (error) {
        // 后端初始化失败，使用本地数据
        state.currency = localData.currency;
        state.playerName = 'Player';
        // console.log('❌ 后端不可用，使用本地数据，昵称使用默认 Player:', error);
    }
    
    initGraphics();
    state.baseFov = state.camera.fov;
    initPhysics(); 
    // 启用 CANNON 内置性能分析，便于在 UI 中查看宽相/窄相等耗时
    if (state.world) {
        state.world.profile = true;
    }
    buildWeapon();
    initStash();
    initEvents();
    renderStashUI();
    initStashUIEvents();
    initPauseMenuEvents();
    window.startGameFromStash = startGameFromStash;
    
    // 初始化多人玩家系统
    setupMultiplayerCallbacks();
    
    // 调试：通过浏览器控制台切换飞行模式，例如 setFly(true)
    if (typeof window !== 'undefined') {
        window.setFly = function(enabled = true) {
            state.flyMode = !!enabled;
            if (!state.flyInput) {
                state.flyInput = { up: 0, down: 0 };
            }
            if (!state.flyMode) {
                // 关闭飞行时重置垂直输入和竖直速度，避免残留漂浮
                state.flyInput.up = 0;
                state.flyInput.down = 0;
                if (state.playerBody && state.playerBody.velocity) {
                    state.playerBody.velocity.y = 0;
                }
            }
            console.log('✈️ Fly mode =', state.flyMode);
        };
    }
    
    // 启动自动保存（优先后端，备选本地）
    try {
        setupAutoSave(state);
        // console.log('✅ 后端自动保存已启动');
    } catch (error) {
        // 后端不可用时使用本地保存
        watchCurrency(state);
        // console.log('⚠️ 使用本地自动保存:', error);
    }
    
    // 初始化完成后显示主菜单（确保UI元素正确隐藏）
    showMenu(true);
    
    // 隐藏全局加载遮罩，显示仓库UI供用户开始游戏
    hideGlobalLoading();
    
    // 防止误触关闭标签页：任何关闭/刷新/跳转前先弹出确认
    if (typeof window !== 'undefined' && !window.__tacopsBeforeUnloadBound) {
        window.__tacopsBeforeUnloadBound = true;
        window.addEventListener('beforeunload', (e) => {
            // 始终提示，避免 Ctrl+W 等快捷键直接关掉游戏
            e.preventDefault();
            e.returnValue = '';
        });
    }

    animate();
}

export function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min((now - state.prevTime) / 1000, 0.1);
    state.prevTime = now;
    state.frameDt = dt;
    state.frameFps = dt > 0 ? 1 / dt : 0;

    // Global death check: ensure health <= 0 always ends the game
    if (state.isGameActive && state.health <= 0) {
        endGame();
        return;
    }

    if (state.isGameActive && !state.isPaused) {
        // 先基于玩家位置管理静态建筑的物理激活范围（按累计时间每X秒执行一次）
        updateStaticPhysicsAroundPlayer(dt);

        const physicsStart = performance.now();
        state.world.step(1/60, dt, 3);
        const physicsEnd = performance.now();
        const stepMs = physicsEnd - physicsStart;
        state.physicsStepMs = stepMs;
        // 简单的指数平均，平滑抖动
        const alpha = 0.1;
        state.physicsStepAvgMs = state.physicsStepAvgMs > 0 
            ? state.physicsStepAvgMs * (1 - alpha) + stepMs * alpha
            : stepMs;

        // 记录 CANNON 提供的宽相/窄相等 profile 信息
        if (state.world && state.world.profile) {
            const p = state.world.profile;
            state.physicsProfile.broadphase = p.broadphase || 0;
            state.physicsProfile.narrowphase = p.narrowphase || 0;
            state.physicsProfile.solve = p.solve || 0;
            state.physicsProfile.integrate = p.integrate || 0;
        }
        state.playerMesh.position.copy(state.playerBody.position);
        
        // Player Movement & Camera
        const isMoving = updatePlayer(dt);

        // Multiplayer: broadcast local player state to Photon room
        if (state.gameMode === 'mp_arena' && state.mp && state.mp.roomId && state.playerBody) {
            try {
                colyseusClient.sendLocalPlayerState({
                    roomId: state.mp.roomId,
                    playerId: state.mp.playerId,
                    pos: {
                        x: state.playerBody.position.x,
                        y: state.playerBody.position.y,
                        z: state.playerBody.position.z
                    },
                    rotY: state.cameraYaw
                });
            } catch (e) {
                console.error('[MP] sendLocalPlayerState failed', e);
            }
        }

        // Weapon
        updateWeapon(now, dt, isMoving);
        
        // Debris & Pickups
        updateDebris(dt);
        updateAmmoPickups(dt).catch(err => console.error('Ammo pickup update error:', err));
        // 血包拾取更新是同步函数，不返回 Promise，不能使用 .catch
        updateHealthPickups(dt);
        updateAmmoPickupEffects(dt).catch(err => console.error('Ammo pickup effects update error:', err));
        updateItemPickupEffects(dt).catch?.(err => console.error('Item pickup effects update error:', err));
        updateDroppedItems(dt);
        updateInteractionFocus(dt);
        
        // Bullets
        updateBullets(dt);
        
        // Enemies
        // 仅在 PVE 模式下生成和更新敌人（包括挑战模式），联机训练场保持无 AI
        if (state.gameMode === 'pve') {
            // 根据难度选择不同的敌人生成策略
            if (state.selectedDifficulty === 'challenge') {
                // 挑战模式：边缘固定生成
                updateEnemySpawnsAtEdges();
            } else {
                // 普通模式：基于玩家位置的动态生成
                updateEnemySpawnsAroundPlayer();
            }
            // 更新已存在敌人的行为
            updateEnemies(dt);
        }

        // Multiplayer dummy actors (本地假玩家/远端玩家展示，仅在 mp_arena 下启用)
        if (state.gameMode === 'mp_arena') {
            // 发送本地玩家位置到服务器（可视化由 multiplayerPlayers 接管）
            sendLocalPlayerPosition();
        }

        // 更新远端玩家的插值位置（Colyseus 多人系统）
        multiplayerPlayers.updateAll(dt);
        
        // Medical System
        updateMedical(dt);
        
        // Rigid Bodies
        state.rigidBodies.forEach(obj => { 
            obj.mesh.position.copy(obj.body.position); 
            obj.mesh.quaternion.copy(obj.body.quaternion); 
        });
        
        // UI
        updateUI();
    }

    // ADS Zoom Logic: 1.5x magnification when aiming
    if (state.baseFov && state.camera) {
        const targetFov = state.isAiming ? (state.baseFov / 1.5) : state.baseFov;
        const zoomSpeed = 15; // Match weapon ADS animation speed
        state.camera.fov = THREE.MathUtils.lerp(state.camera.fov, targetFov, dt * zoomSpeed);
        state.camera.updateProjectionMatrix();
    }

    // 同步武器相机与主相机的位置和朝向，并略微放大FOV
    if (state.weaponCamera && state.camera) {
        state.weaponCamera.position.copy(state.camera.position);
        state.weaponCamera.quaternion.copy(state.camera.quaternion);
        // 武器相机FOV保持恒定，不随主相机缩放，避免武器变形
        state.weaponCamera.fov = (state.baseFov || 68) + 5;
        state.weaponCamera.aspect = state.camera.aspect;
        state.weaponCamera.updateProjectionMatrix();
    }
    
    // 只在游戏活跃时渲染游戏画面，主菜单时隐藏
    if (state.isGameActive) {
        if (!state.debugSkipRender) {
            const renderer = state.renderer;
            const scene = state.scene;
            const composer = state.composer;

            // 第一通道：只渲染世界（默认 layer 0）
            state.camera.layers.set(0);
            renderer.clear();

            // 在主相机渲染前重置统计，只记录这一通道
            if (renderer.info && renderer.info.reset) {
                renderer.info.reset();
            }

            if (composer) {
                composer.render();
            } else {
                renderer.render(scene, state.camera);
            }

            // 读取主相机的 draw call / 三角形数量并缓存到全局状态
            if (renderer.info && renderer.info.render && state.mainRenderStats) {
                state.mainRenderStats.drawCalls = renderer.info.render.calls || 0;
                state.mainRenderStats.triangles = renderer.info.render.triangles || 0;
            }

            // 第二通道：清除深度缓冲，仅使用武器相机渲染 layer 1 上的武器
            if (state.weaponCamera) {
                state.weaponCamera.layers.set(1);
                renderer.clearDepth();
                renderer.render(scene, state.weaponCamera);
            }
        }
    } else {
        // 主菜单时渲染纯色背景
        if (!state.debugSkipRender) {
            state.renderer.setClearColor(0x0a0a0a);
            state.renderer.clear();
        }
    }
}

export function startGameFromStash() {
    const primary = state.stash.equipped.primary;
    if (primary && primary.weaponConfig) {
        state.weaponConfig = primary.weaponConfig;
        state.currentWeaponId = primary.weaponConfig.id;
    }
    
    const ammoGrade = state.stash.equipped.ammoGrade;
    if (ammoGrade && ammoGrade.ammoGrade) {
        state.currentAmmoGrade = ammoGrade.ammoGrade;
    }
    
    // 设置护甲值
    const armorCapacity = state.stash.getArmorCapacity();
    state.maxArmor = armorCapacity;
    state.armor = armorCapacity;
    // console.log('🎮 游戏开始 - 护甲初始化:', state.armor, '/', state.maxArmor);
    
    // 设置医疗包/护甲包容量（根据背包容量加成而不是名字，避免本地化失配）
    const backpack = state.stash.equipped.backpack;
    let medkitCapacity = 100; // 无背包时的基础容量
    if (backpack) {
        const bonus = backpack.weightBonus || 0;
        // 按 weightBonus 粗略区分小/中/大背包
        if (bonus >= 100) {
            medkitCapacity = 180; // 大型背包
        } else if (bonus >= 60) {
            medkitCapacity = 150; // 中型背包
        } else if (bonus > 0) {
            medkitCapacity = 90;  // 小型背包
        }
    }
    state.medkits = medkitCapacity;
    state.armorKits = medkitCapacity;
    // console.log('💊 医疗包容量:', state.medkits, '背包:', backpack ? backpack.name : 'None');
    
    // 设置弹药容量（根据背包容量加成，而不是固定英文名）
    const wp = state.weaponConfig || CONFIG.weaponPresets.m4a1;
    let ammoBonus = 0;
    if (backpack) {
        const bonus = backpack.weightBonus || 0;
        if (bonus >= 100) {
            ammoBonus = 100; // 大型背包 +100 发备用弹药
        } else if (bonus >= 60) {
            ammoBonus = 60;  // 中型背包 +60 发备用弹药
        } else if (bonus > 0) {
            ammoBonus = 30;  // 小型背包 +30 发备用弹药
        }
    }
    state.ammo = wp.maxAmmo || CONFIG.maxAmmo; // 弹夹容量不变

    // 基础备用弹药 + 背包加成
    let baseReserve = (wp.totalAmmo || CONFIG.totalAmmo) + ammoBonus;

    // 挑战模式下应用终端购买的备弹上限加成
    if (state.selectedDifficulty === 'challenge' && state.challengeReserveAmmoMultiplier) {
        baseReserve = Math.round(baseReserve * state.challengeReserveAmmoMultiplier);
    }

    state.reserveAmmo = baseReserve; // 当前备用弹药
    state.maxReserveAmmo = baseReserve; // 记录本局最大备用弹药上限
    // console.log('🔫 弹药容量:', state.ammo, '/', state.reserveAmmo, '(基础', wp.maxAmmo, '/', wp.totalAmmo, '+ 背包加成:', ammoBonus, ')');

    // 根据外部背包品质动态决定本局背包格子数
    // 无背包：6 格；小背包：10 格；中背包：16 格；大背包：20 格
    let maxSlots = 6;
    if (backpack) {
        const bonus = backpack.weightBonus || 0;
        if (bonus >= 100) {
            maxSlots = 20; // 大型背包
        } else if (bonus >= 60) {
            maxSlots = 16; // 中型背包
        } else if (bonus > 0) {
            maxSlots = 10; // 小型背包
        }
    }

    if (!state.backpack || !Array.isArray(state.backpack.slots)) {
        state.backpack = {
            maxSlots,
            slots: new Array(maxSlots).fill(null)
        };
    } else {
        state.backpack.maxSlots = maxSlots;
        if (!state.backpack.slots || state.backpack.slots.length !== maxSlots) {
            state.backpack.slots = new Array(maxSlots).fill(null);
        }
    }

    // 启动新的会话统计
    startStatsSession({
        loadout: {
            primaryWeapon: {
                id: state.weaponConfig?.id || primary?.id || 'unknown',
                name: primary?.name || state.weaponConfig?.name || 'Unknown Weapon'
            },
            ammoGrade: state.currentAmmoGrade || 'default',
            backpack: backpack?.name || 'None',
            armor: armorCapacity
        },
        currencyBeforeMatch: state.currency
    });

    startGame();
}

export function startGame() {
    showMenu(false);
    document.body.requestPointerLock();
    state.isGameActive = true;
    
    // 确保初始化（如果还没有初始化）
    if(!state.world) init();
    
    // 每次部署都重新生成地图，确保随机性
    console.log('🎮 开始新游戏，重新生成地图...');
    console.log('🔄 调用resetWorldRuntime()清理现有世界...');
    resetWorldRuntime(); // 清理现有世界
    if (state.gameMode === 'mp_arena') {
        console.log('🏟️ 构建联机 Arena 地图...');
        buildArenaLevel();
        console.log('✅ Arena 地图构建完成！');
    } else {
        console.log('🏗️ 调用buildLevel()重新构建关卡...');
        buildLevel(state.selectedDifficulty || 'normal');
        console.log('✅ 地图重新构建完成！');
    }
    
    // 重新构建武器（确保camera存在后构建）
    buildWeapon();
    
    // 清空上一局的子弹
    clearBullets();
    
    // Reset State (在生成敌人之前设置游戏状态)
    state.isGameActive = true;
    state.score = 0;
    state.health = 100;
    
    // 敌人不再一次性全部生成，而是基于采样生成点在玩家周围200米内按需生成
    console.log(`👾 敌人将按需在玩家200米半径内动态生成，上限: ${CONFIG.enemyCount}`);
    
    // 立即执行一次静态物理更新，避免游戏开始时的性能问题
    console.log('🚀 立即执行静态物理更新，优化初始性能...');
    resetStaticPhysicsAccumTime(); // 重置累计时间
    updateStaticPhysicsAroundPlayer(999); // 传入大值确保立即执行
    console.log('✅ 静态物理优化完成！');
    
    // 隐藏部署缓冲界面
    const deployLoadingOverlay = document.getElementById('deploy-loading-overlay');
    if (deployLoadingOverlay) {
        deployLoadingOverlay.style.display = 'none';
    }
    
    // 重新设置随机出生点（PVE 使用随机点，联机 Arena 使用固定点）
    if (state.gameMode === 'mp_arena') {
        state.playerBody.position.set(0, 5, 0);
    } else if (window.setRandomPlayerSpawn) {
        window.setRandomPlayerSpawn();
    } else {
        state.playerBody.position.set(0, 5, 0);
    }

    // 根据模式初始化联机假玩家的可视对象
    // 旧的 mp_arena 假人系统已废弃，多人可视化由 multiplayerPlayers 负责，这里统一清理残留
    clearMpActors();
    
    state.playerBody.velocity.set(0,0,0); 
    state.knockbackDisableTime = 0;
    state.currentSpreadAngle = CONFIG.spreadParams.base;
    
    // 更新UI显示（包括负重）
    updateUI();
}

// ===== Multiplayer dummy actors for mp_arena =====

function clearMpActors() {
    if (!state.mp || !Array.isArray(state.mp.actors)) return;
    if (state.scene) {
        state.mp.actors.forEach(actor => {
            if (actor.mesh && actor.mesh.parent === state.scene) {
                state.scene.remove(actor.mesh);
            }
            if (actor.nameSprite && actor.nameSprite.parent === state.scene) {
                state.scene.remove(actor.nameSprite);
                if (actor.nameSprite.material && actor.nameSprite.material.map) {
                    actor.nameSprite.material.map.dispose();
                }
                if (actor.nameSprite.material) actor.nameSprite.material.dispose();
            }
        });
    }
    state.mp.actors = [];
}

function setupMpActors() {
    clearMpActors();
    if (!state.scene || !state.playerBody || !state.mp || !Array.isArray(state.mp.players)) return;

    const basePos = state.playerBody.position;

    state.mp.players
        .filter(p => !p.isLocal)
        .forEach((p, index) => {
            const offsetRadius = 5 + index * 2;
            const baseAngle = (Math.PI * 2 * index) / Math.max(1, state.mp.players.length - 1);
            const color = p.team === 'enemy' ? 0xef4444 : 0x22c55e;

            // 使用兼容性更好的 BoxGeometry 代替 CapsuleGeometry 作为占位模型
            const geom = new THREE.BoxGeometry(0.8, 1.8, 0.8);
            const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2 });
            const mesh = new THREE.Mesh(geom, mat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            // 每个假玩家有自己的巡逻中心点
            const centerX = basePos.x + Math.cos(baseAngle) * offsetRadius;
            const centerZ = basePos.z + Math.sin(baseAngle) * offsetRadius;
            const centerY = basePos.y;

            mesh.position.set(centerX, centerY, centerZ);

            state.scene.add(mesh);

            // 仅为队友创建姓名牌（敌人不显示名字）
            let nameSprite = null;
            if (p.team !== 'enemy') {
                nameSprite = createNameplateSprite(p.name || '队友', color);
                if (nameSprite) {
                    state.scene.add(nameSprite);
                }
            }

            // 为每个假玩家分配随机巡逻方向和速度
            const angle = Math.random() * Math.PI * 2;
            const dir = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
            const speed = (p.team === 'enemy' ? 3.5 : 2.5); // 敌人稍微快一点
            const patrolRadius = 12 + Math.random() * 6;

            state.mp.actors.push({
                playerId: p.id,
                team: p.team || 'ally',
                name: p.name,
                isBot: !!p.isBot,
                mesh,
                nameSprite,
                patrolCenter: new THREE.Vector3(centerX, centerY, centerZ),
                dir,
                speed,
                patrolRadius,
                targetPos: null,
                targetRotY: 0
            });
        });
}

function updateMpActors(dt) {
    if (!state.mp || !Array.isArray(state.mp.actors) || !state.playerBody) return;

    state.mp.actors.forEach(actor => {
        if (!actor.mesh) return;
        if (!actor.patrolCenter || !actor.dir) return;

        const center = actor.patrolCenter;
        const dir = actor.dir;
        const speed = actor.speed || 3;
        const maxR = actor.patrolRadius || 12;

        let x = actor.mesh.position.x;
        let z = actor.mesh.position.z;

        if (actor.isBot) {
            // Bot：使用原有巡逻逻辑
            const dx = dir.x * speed * dt;
            const dz = dir.y * speed * dt;

            x += dx;
            z += dz;

            const distSq = (x - center.x) * (x - center.x) + (z - center.z) * (z - center.z);
            if (distSq > maxR * maxR) {
                dir.x = -dir.x;
                dir.y = -dir.y;
                x = actor.mesh.position.x + dir.x * speed * dt;
                z = actor.mesh.position.z + dir.y * speed * dt;
            }
        } else if (actor.targetPos) {
            // 真实远端玩家：插值到 Photon 推送的位置
            const lerpSpeed = 10;
            const alpha = Math.min(1, dt * lerpSpeed);
            x = THREE.MathUtils.lerp(actor.mesh.position.x, actor.targetPos.x, alpha);
            z = THREE.MathUtils.lerp(actor.mesh.position.z, actor.targetPos.z, alpha);
        }

        actor.mesh.position.set(x, center.y, z);

        if (actor.team === 'enemy') {
            actor.mesh.lookAt(center.x, center.y, center.z);
        } else if (!actor.isBot && typeof actor.targetRotY === 'number') {
            const lookTarget = new THREE.Vector3(
                actor.mesh.position.x - Math.sin(actor.targetRotY),
                center.y,
                actor.mesh.position.z - Math.cos(actor.targetRotY)
            );
            actor.mesh.lookAt(lookTarget);
        } else if (state.playerBody) {
            const playerPos = state.playerBody.position;
            actor.mesh.lookAt(playerPos.x, playerPos.y, playerPos.z);
        }

        if (actor.nameSprite) {
            const headOffset = 2.2;
            actor.nameSprite.position.set(x, center.y + headOffset, z);
            if (state.camera) {
                actor.nameSprite.quaternion.copy(state.camera.quaternion);
            }
        }
    });
}

// 创建队友姓名牌精灵，仅在本地渲染使用
function createNameplateSprite(text, color) {
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const width = 256;
        const height = 64;
        canvas.width = width;
        canvas.height = height;

        ctx.clearRect(0, 0, width, height);
        ctx.font = '28px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 背景条
        ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
        const bgWidth = width * 0.8;
        const bgHeight = height * 0.6;
        const bgX = (width - bgWidth) / 2;
        const bgY = (height - bgHeight) / 2;
        const radius = 16;
        ctx.beginPath();
        ctx.moveTo(bgX + radius, bgY);
        ctx.lineTo(bgX + bgWidth - radius, bgY);
        ctx.quadraticCurveTo(bgX + bgWidth, bgY, bgX + bgWidth, bgY + radius);
        ctx.lineTo(bgX + bgWidth, bgY + bgHeight - radius);
        ctx.quadraticCurveTo(bgX + bgWidth, bgY + bgHeight, bgX + bgWidth - radius, bgY + bgHeight);
        ctx.lineTo(bgX + radius, bgY + bgHeight);
        ctx.quadraticCurveTo(bgX, bgY + bgHeight, bgX, bgY + bgHeight - radius);
        ctx.lineTo(bgX, bgY + radius);
        ctx.quadraticCurveTo(bgX, bgY, bgX + radius, bgY);
        ctx.closePath();
        ctx.fill();

        // 边框颜色来自队伍颜色
        const rgb = color === 0xef4444 ? '239,68,68' : '34,197,94';
        ctx.strokeStyle = `rgba(${rgb}, 0.9)`;
        ctx.lineWidth = 3;
        ctx.stroke();

        // 文本
        ctx.fillStyle = 'white';
        ctx.fillText(text, width / 2, height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;

        const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(2.2, 0.6, 1); // 世界空间大小
        return sprite;
    } catch (e) {
        console.warn('createNameplateSprite failed:', e);
        return null;
    }
}

export async function endGame() {
    if (!state.isGameActive) return;
    state.isGameActive = false; 
    // 1) 结算背包物资价值：退出时相当于全部卖掉
    let lootValue = 0;
    if (state.backpack && Array.isArray(state.backpack.slots)) {
        const slots = state.backpack.slots;
        for (let i = 0; i < slots.length; i++) {
            const item = slots[i];
            if (!item) continue;
            const unitPrice = item.value || 0;
            lootValue += unitPrice;
            // 清空背包格子：物资已在结算中卖出
            slots[i] = null;
        }
    }

    // 2) mission score + 物资价值 一起结算为金钱
    const missionScore = state.score || 0;
    const totalEarnings = missionScore + lootValue;
    state.currency += totalEarnings;

    // 记录到全局，方便结算界面展示
    state.lastMissionScore = missionScore;
    state.lastLootValue = lootValue;
    state.lastTotalEarnings = totalEarnings;

    const finalCurrency = state.currency;
    const sessionResult = state.health <= 0 ? 'defeat' : 'extracted';

    let sessionStats = null;
    try {
        sessionStats = await finalizeStatsSession({
            result: sessionResult,
            extraSummary: {
                finalScore: missionScore,
                lootValue,
                totalEarnings,
                currencyEarned: totalEarnings,
                totalCurrencyAfterMatch: finalCurrency,
                gamesPlayed: state.gamesPlayed,
                timestamp: Date.now()
            }
        });
    } catch (error) {
        console.error('❌ 结算会话统计失败:', error);
    }

    if (sessionStats) {
        try {
            const lifetimeStats = (await getLifetimeStats()) || getDefaultLifetimeStats();
            const merged = mergeSessionIntoLifetime(lifetimeStats, sessionStats);
            await uploadLifetimeStats(merged);
        } catch (error) {
            console.error('❌ 更新长期统计失败:', error);
        }
    }

    try {
        // 安全同步：先服务器后本地
        await updateCurrency(state.currency);
        console.log('✅ 金钱数据已保存到后端:', state.currency);
        
        // 服务器同步成功后，保存本地备份
        saveCurrency(state.currency);
        // 清除待同步标记
        localStorage.removeItem('currency_pending_sync');
    } catch (error) {
        // 后端不可用时使用本地保存
        saveCurrency(state.currency);
        // 标记需要同步
        localStorage.setItem('currency_pending_sync', 'true');
        console.log('⚠️ 后端保存失败，使用本地存储:', error);
    }
    
    const curEl = document.getElementById('currency-val');
    if (curEl) curEl.innerText = state.currency;
    document.exitPointerLock();
    
    // 使用新的模块化结算界面
    GameOverScreen.show(sessionStats);
}

// 从暂停菜单恢复游戏
window.resumeGameFromPause = function() {
    if (!state.isGameActive || !state.isPaused) return;
    
    const now = performance.now();
    if (now < state.pauseCooldownUntil) {
        // 还在冷却期，不响应
        return;
    }
    
    state.isPaused = false;
    state.pauseCooldownUntil = 0; // 重置冷却期
    showPauseMenu(false);
    // 重新锁定鼠标，pointerlockchange 中会恢复 controlsLocked
    document.body.requestPointerLock();
};

// 从暂停菜单返回主界面
window.exitToMenuFromPause = async function() {
    if (!state.isGameActive) return;
    
    const now = performance.now();
    if (now < state.pauseCooldownUntil) {
        // 还在冷却期，不响应
        return;
    }
    
    state.isPaused = false;
    state.pauseCooldownUntil = 0; // 重置冷却期
    showPauseMenu(false);
    await endGame();
};

// Entry point
init();
// Weapon is now built only when game starts (in startGame function)
// to avoid camera null errors during menu initialization.

// 设置多人游戏回调
function setupMultiplayerCallbacks() {
    // 设置玩家状态更新回调
    colyseusClient.setPlayerStateUpdateHandler((data) => {
        const room = colyseusClient.room;
        if (!room) return;

        // 忽略本地玩家自身
        if (data.playerId === room.sessionId) {
            return;
        }

        // 如果还没有为该玩家创建实体，先创建一个
        if (!multiplayerPlayers.hasPlayer(data.playerId)) {
            // 尝试从房间状态中取名字；如果没有，就用 playerId 做名字
            let displayName = data.playerId;
            try {
                const state = room.state;
                if (state && state.players && state.players.has(data.playerId)) {
                    const p = state.players.get(data.playerId);
                    if (p && p.name) {
                        displayName = p.name;
                    }
                }
            } catch (e) {
                // 安全兜底：保持 displayName = playerId
            }

            multiplayerPlayers.addPlayer(data.playerId, displayName);
        }

        // 更新其他玩家位置
        multiplayerPlayers.updatePlayer(data.playerId, data.pos, data.rotY);
    });
}

// 位置同步节流变量
let lastPositionSendTime = 0;
const POSITION_SEND_INTERVAL = 50; // 50ms = 20Hz

// 发送本地玩家位置到服务器
function sendLocalPlayerPosition() {
    if (!colyseusClient.room || !state.playerBody) return;

    const now = Date.now();
    if (now - lastPositionSendTime < POSITION_SEND_INTERVAL) return;
    lastPositionSendTime = now;

    const pos = state.playerBody.position;
    // 使用相机的水平旋转角度，更准确
    const rotY = state.camera ? state.camera.rotation.y : 0;

    colyseusClient.sendLocalPlayerState({
        pos: { x: pos.x, y: pos.y, z: pos.z },
        rotY: rotY,
        ts: now
    });
}

