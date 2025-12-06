// 弹药等级配置
export const AMMO_GRADES = {
    standard: {
        id: 'standard',
        name: 'Standard Ammo',
        displayName: 'STD Ammo', // 购买列表显示的简写
        rarity: 'common',
        color: '#3b82f6', // 蓝色
        damageMultiplier: 1.0,
        recoilMultiplier: 1.0,
        rangeMultiplier: 1.0,
        cost: 0,
        description: 'Balanced performance.',
    },
    armor_piercing: {
        id: 'armor_piercing',
        name: 'Armor-Piercing Ammo',
        displayName: 'AP Ammo', // 购买列表显示的简写
        rarity: 'rare',
        color: '#a855f7', // 紫色
        damageMultiplier: 1.3,
        recoilMultiplier: 1.1,
        rangeMultiplier: 1.0,
        cost: 1200,
        description: 'Armor-piercing rounds. +30% damage, +10% recoil.',
    },
    high_explosive: {
        id: 'high_explosive',
        name: 'High-Explosive Ammo',
        displayName: 'HE Ammo', // 购买列表显示的简写
        rarity: 'legendary',
        color: '#f97316', // 橙色
        damageMultiplier: 1.8,
        recoilMultiplier: 1.3,
        rangeMultiplier: 0.9,
        cost: 2500,
        description: 'Explosive-tipped rounds. +80% damage, +30% recoil, -10% range.',
    },
    fmj: {
        id: 'fmj',
        name: 'Full Metal Jacket Ammo',
        displayName: 'FMJ Ammo', // 购买列表显示的简写
        rarity: 'uncommon',
        color: '#3b82f6', // 蓝色
        damageMultiplier: 0.85,
        recoilMultiplier: 0.8,
        rangeMultiplier: 1.2,
        cost: 500,
        description: 'Full metal jacket. -15% damage, -20% recoil.',
    },
    hp: {
        id: 'hp',
        name: 'Hollow Point Ammo',
        displayName: 'HP Ammo',
        rarity: 'rare',
        color: '#a855f7', // 紫色
        damageMultiplier: 1.6,
        recoilMultiplier: 0.8,
        rangeMultiplier: 0.7,
        cost: 1000,
        description: 'Hollow point rounds. +60% damage, -20% recoil, -30% range.',
    },
    rip: {
        id: 'rip',
        name: 'R.I.P. Ammo',
        displayName: 'RIP Ammo',
        rarity: 'uncommon',
        color: '#3b82f6', // 蓝色
        damageMultiplier: 1.7,
        recoilMultiplier: 0.75,
        rangeMultiplier: 0.5,
        cost: 800,
        description: 'RIP rounds. +70% damage, -25% recoil, -50% range.'
    }
};

export const CONFIG = Object.freeze({
    walkSpeed: 5.5,
    sprintSpeed: 9.1,
    adsSpeed: 4.0,
    jumpForce: 7.5,
    baseSensitivity: 0.002,
    adsSensitivity: 0.0008,
    fireRate: 0.09, 
    maxAmmo: 30,
    totalAmmo: 120,
    
    weaponPresets: {
        m4a1: {
            id: 'm4a1',
            displayName: 'M4A1 Carbine',
            rpm: 800,
            maxAmmo: 30,
            totalAmmo: 120,
            damageScale: 27,
            headshotMultiplier: 2.0,
            recoilMultiplier: 1.3,
            spreadMultiplier: 1.0,
            // 射程配置: 40m开始衰减，80m衰减至40%
            damageStartDrop: 40,
            damageEndDrop: 80,
            damageMinPercent: 0.4
        },
        mk14: {
            id: 'mk14',
            displayName: 'MK14',
            rpm: 400,
            maxAmmo: 20,
            totalAmmo: 90,
            damageScale: 55,
            headshotMultiplier: 2.0,
            recoilMultiplier: 1.3,
            spreadMultiplier: 1.0,
            semiAuto: true,
            // 射程配置: 精确射手，射程较远
            damageStartDrop: 50,
            damageEndDrop: 100,
            damageMinPercent: 0.6
        },
        hk416: {
            id: 'hk416',
            displayName: 'M4 Tech',
            rpm: 880,
            maxAmmo: 45,
            totalAmmo: 180,
            damageScale: 31,
            headshotMultiplier: 2.0,
            recoilMultiplier: 1.5,
            spreadMultiplier: 1.0,
            // 射程配置: 40m开始衰减，80m衰减至40%
            damageStartDrop: 40,
            damageEndDrop: 80,
            damageMinPercent: 0.4
        },
        ak: {
            id: 'ak',
            displayName: 'AK-47',
            rpm: 600,
            maxAmmo: 30,
            totalAmmo: 120,
            damageScale: 40,
            headshotMultiplier: 2.0,
            recoilMultiplier: 2.3,
            spreadMultiplier: 1.4,
            // 射程配置: 30m开始衰减，70m衰减至50%
            damageStartDrop: 30,
            damageEndDrop: 70,
            damageMinPercent: 0.5
        },
        ash: {
            id: 'ash',
            displayName: 'ASH-12',
            rpm: 500,
            maxAmmo: 25,
            totalAmmo: 100,
            damageScale: 56,
            headshotMultiplier: 2.0,
            recoilMultiplier: 2.9,
            spreadMultiplier: 1.6,
            // 射程配置: 重型弹药，55m开始衰减
            damageStartDrop: 55,
            damageEndDrop: 76,
            damageMinPercent: 0.6
        }
    },
    enemyCount: 7000,
    enemySpawn: {
        minDistance: 65,                // 最小距离65米，避免在出生点附近刷怪
        // 移除最大距离限制，允许全图分布
        jitter: 10                      // 减小随机偏移
    },

    // 生成点/出生点相关配置
    spawn: {
        // 建筑阻挡的最小高度阈值（米）
        // 小于该高度的静态物体视为非建筑障碍，允许在其上/下方生成
        // 原来写死为 3 米，现在下调为 1.5 米，避免贴着建筑底座出生
        buildingMinBlockHeight: 1.5
    },
    
    // 真实散布角度参数 (单位: 度 Degree)
    spreadParams: {
        base: 0.8,         // 基础散布: 0.8度
        move: 2.5,         // 移动惩罚
        jump: 4.0,         // 跳跃惩罚
        shoot: 0.6,        // 连射惩罚
        max: 6.0,          // 最大散布
        ads: 0.02,         // 机瞄散布 (极小)
        decaySpeed: 10.0   // 恢复速度
    },
    
    knockbackStrength: 25.0,
    leanDistance: 0.6,
    
    pistolEnemy: {
        scoreThreshold: 100,
        attackRange: 20,
        stopDistance: 15,
        fireRate: 2.0,
        damage: 20,        // 双倍伤害 (10 * 2 = 20)
        speed: 3.0
    },
    
    rocketEnemy: {
        scoreThreshold: 200,
        attackRange: 30,
        stopDistance: 25,
        fireRate: 3.0,
        damage: 40,
        speed: 2.5
    },
    
    specialEnemy: {
        scoreThreshold: 300,
        attackRange: 35,
        stopDistance: 20,
        fireRate: 0.13,     // 单发射击间隔 (降低30%: 0.1 * 1.3 = 0.13)
        damage: 8,
        speed: 3.2,
        magazineSize: 30,  // 弹匣容量
        reloadTime: 3.0,   // 换弹时间
        burstCount: 3,     // 连发子弹数
        burstDelay: 0.1    // 连发间隔
    },
    
    bullet: {
        speed: 80,
        maxDistance: 200
    },
    
    rocket: {
        speed: 40,
        maxDistance: 150
    },
    
    // 随机地图生成配置
    mapGeneration: {
        useRandomSeed: true,        // 是否使用随机种子
        fixedSeed: 12345,           // 固定种子（当useRandomSeed为false时使用）
        mapTemplateWeights: {       // 地图模板权重
            urban: 0.3,             // 城市区
            industrial: 0.2,        // 工业区
            park: 0.2,              // 公园区
            downtown: 0.15,         // 商业区
            suburban: 0.15          // 郊区
        },
        
        // 建筑生成参数
        buildingParams: {
            minClusterCount: 15,    // 最小建筑群数量 (增加)
            maxClusterCount: 35,    // 最大建筑群数量 (大幅增加)
            minBuildingsPerCluster: 3,  // 每群最少建筑 (增加)
            maxBuildingsPerCluster: 10, // 每群最多建筑 (大幅增加)
            minBuildingHeight: 8,
            maxBuildingHeight: 60,
            safeZoneRadius: 25      // 缩小安全区域，让建筑更靠近中心
        },
        
        // 掩体生成参数
        coverParams: {
            minZoneCount: 8,        // 最小掩体区域数量 (翻倍)
            maxZoneCount: 15,       // 最大掩体区域数量 (大幅增加)
            minZoneRadius: 20,      // 增加最小半径
            maxZoneRadius: 40,      // 增加最大半径
            coverTypes: ['boxes', 'cars', 'barriers', 'walls']
        },
        
        // 环境物体密度
        environmentDensity: {
            trees: { min: 0.3, max: 0.6 },    // 大幅增加树木密度
            lamps: { min: 0.15, max: 0.35 },   // 大幅增加路灯密度
            cars: { min: 0.08, max: 0.2 },     // 大幅增加汽车密度
            props: { min: 0.25, max: 0.5 }     // 大幅增加道具密度
        }
    },
    
    // 保持原有的城市布局配置用于兼容
    CITY_LAYOUT: {
        halfSize: 450,  // 更新为新的地图尺寸：(15 * (50+10)) / 2 = 450
        openAreaHalfX: 45,  // 稍微增大
        openAreaHalfZ: 100, // 稍微增大
        blockSpacing: 110,  // 增大街区间距
        propScatterRadius: 400,  // 调整道具散布半径
        propCount: 220,  // 增加道具数量
        tallChance: 0.3,
        tallExtraMin: 30,
        tallExtraMax: 90,
        spawnGridStep: 75,
        spawnSafeRadius: 25
    },
    
    // 调试配置
    debug: {
        showGroundInfo: true,       // 显示着地检测信息（临时启用调试）
        showSlopeInfo: false,      // 显示斜坡移动信息
        groundCheckInterval: 50    // 着地检测间隔（毫秒）
    }
});
