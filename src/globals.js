import * as THREE from 'three';
import { CONFIG } from './config.js';

export const state = {
    camera: null,
    scene: null,
    renderer: null,
    composer: null,
    smaaPass: null,
    world: null,
    skyMesh: null,
    // 渲染相关开关
    dirLight: null,
    shadowsEnabled: true,
    shadowQuality: 'high',   // 'off' | 'medium' | 'high'
    anisoQuality: 'max',     // 'low' | 'medium' | 'max'
    renderDistance: 'far',   // 'near' | 'medium' | 'far' | 'ultra'
    controlsLocked: false,
    
    moveInput: { f: 0, b: 0, l: 0, r: 0 },
    mouseDelta: new THREE.Vector2(0, 0),
    lastLookDelta: new THREE.Vector2(0, 0),
    isSprinting: false,
    isAiming: false,
    adsLocked: false,
    leanState: 0, 
    currentLeanFactor: 0,
    cameraYaw: 0,
    cameraPitch: 0,
    prevTime: performance.now(),
    frameDt: 0,
    frameFps: 0,
    // 平滑后的 FPS 显示
    displayFps: 0,
    lastFpsUpdateTime: 0,
    // 是否显示完整性能调试信息（否则仅显示 FPS），默认关闭
    showPerfDetails: false,
    // 物理/碰撞性能监控
    physicsStepMs: 0,
    physicsStepAvgMs: 0,
    physicsProfile: {
        broadphase: 0,
        narrowphase: 0,
        solve: 0,
        integrate: 0
    },
    // 主相机渲染统计（draw call / tris），不包含武器相机
    mainRenderStats: {
        drawCalls: 0,
        triangles: 0
    },
    weaponSwayOffset: new THREE.Vector3(0, 0, 0),
    weaponSwayTarget: new THREE.Vector3(0, 0, 0),
    
    // 着地检测监控
    groundDistance: 0, // 射线检测到的距离（米）
    groundObject: '', // 检测到的物体类型
    groundNormalY: 0, // 地面法线Y分量（用于监控）
    // Cannon接触点监控
    cannonContactPoint: null, // Cannon检测到的接触点坐标
    cannonContactNormal: null, // Cannon检测到的接触法线
    rayStartPoint: null, // 射线起点坐标
    viewBobPhase: 0,
    viewBobIntensity: 0,
    
    playerBody: null,
    playerMesh: null,
    physicsMaterial: null,
    rigidBodies: [], 
    enemies: [],
    // 具有物理刚体的静态建筑/掩体 Mesh 列表（mass=0 的 createBox）
    staticPhysicsMeshes: [],
    // 活跃物体数组（用于射线检测优化）
    activeStaticMeshes: [],
    activeDynamicMeshes: [],
    isGrounded: false,
    knockbackDisableTime: 0,  // 击退导致的WASD禁用剩余时间（秒）
    groundNormal: null,        // 当前着地法线
    groundDistance: null,      // 距离地面距离
    lastGroundedTime: performance.now(),
    lastJumpTime: 0,
    
    weaponGroup: null,
    muzzleFlash: null,
    muzzleFlashIntensity: 0,
    adsDot: null,
    adsDotGun: null,
    adsDotView: null,
    adsVisualBlend: 0,
    weaponKick: new THREE.Vector3(0, 0, 0),
    isFiring: false,
    lastFireTime: 0,
    isReloading: false,
    recoilOffset: 0,
    recoilRot: 0,
    
    // 鼠标灵敏度设置
    mouseSensitivity: 1.0,
    crosshairStyle: 'pixel', // 'classic' | 'pixel'
    
    // 核心：实时散布角度 (Degree)
    currentSpreadAngle: CONFIG.spreadParams.base,
    shootSpreadAccumulator: 0,
    
    // 游戏模式：'pve' | 'mp_arena' 等
    gameMode: 'pve',
    // 联机相关占位状态（后续会逐步填充真实逻辑）
    mp: {
        roomId: null,
        playerId: null,
        players: [],
        // 当前场景中用于展示的联机角色（假玩家/远端玩家）的可视对象
        actors: []
    },

    isGameActive: false,
    isPaused: false,
    pauseCooldownUntil: 0, // 暂停菜单冷却时间戳
    score: 0,
    health: 100,
    maxHealth: 100,
    armor: 0,
    maxArmor: 0,
    ammo: 30,
    reserveAmmo: 120,
    maxReserveAmmo: 120,
    lastDamageTime: 0, 
    currency: 2000,
    playerName: 'Player',
    hasSeenRenamePrompt: false,
    currentWeaponId: 'rifle',
    weaponConfig: null,
    currentAmmoGrade: null,
    
    // 医疗系统
    medkits: 100, // 绷带容量（基础100，背包可提升）
    armorKits: 100, // 护甲修复容量（基础100，背包可提升）
    isHealing: false, // 是否正在使用绷带
    isRepairingArmor: false, // 是否正在修复护甲
    healingStartTime: 0,
    armorRepairStartTime: 0,

    backpack: {
        maxSlots: 6,
        slots: new Array(6).fill(null)
    },

    // 所有已生成过战利品的容器缓存：按 containerId 映射到 { id, name, type, maxSlots, slots }
    containersById: {},

    // 当前正在交互的容器（例如箱子），为空表示未打开任何容器
    // 结构示例：{ id, name, type, maxSlots, slots: [...] }
    activeContainer: null,

    audioCtx: null,
    mats: {},
    raycaster: new THREE.Raycaster(),
    // F键交互专用射线检测器，避免与武器射线检测冲突
    interactionRaycaster: new THREE.Raycaster(),
    spawnPoints: [],
    // 预选好的固定敌人刷怪点索引（最多 enemyCount 个）
    enemySpawnIndices: [],
    // 记录哪些采样点已经用于生成敌人，避免重复生成
    usedSpawnPointIndices: new Set(),
    // 碎片池
    debrisPool: [],
    ammoPickups: [],
    itemPickupEffects: [],
    // 掉落物（从背包丢在地上的物品）
    droppedItems: [],
    // 当前视线下可交互目标（用于F键提示 & 高亮）
    focusedInteractable: null,
    // 子弹池
    bullets: [],
    // 静态老 mesh 渲染管理池（非 proxy）
    staticRenderPool: [],

    // 简单调试开关：跳过渲染，用于消融实验（只跑物理/逻辑）
    debugSkipRender: false,

    // 调试用飞行模式（通过控制台指令开启）
    flyMode: false,
    flyInput: { up: 0, down: 0 }
};

// 将全局状态挂到 window 上，方便在浏览器控制台调试（例如 gameState.debugSkipRender = true）
if (typeof window !== 'undefined') {
    window.gameState = state;
    window.state = state; // 同时绑定到window.state，方便控制台调试
}
