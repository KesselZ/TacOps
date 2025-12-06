import * as THREE from 'three';
import { state } from './globals.js';
import { CONFIG } from './config.js';
import { createMapGenerator } from './mapGenerator.js';
import { collisionGrid } from './collisionGrid.js';

// Assuming CANNON is globally available via script tag in index.html
const CANNON = window.CANNON;

// 全局mapGenerator实例，每次生成城市时更新
let currentMapGenerator = null;

// 使用种子随机数生成器而不是Math.random()
function getRandom() {
    if (!currentMapGenerator) {
        console.warn('MapGenerator未初始化，使用Math.random()作为后备');
        return Math.random();
    }
    return currentMapGenerator.random();
}

// 辅助函数：创建箱子
// withPhysics: 是否创建物理刚体并加入碰撞网格
function createLocalBox(x, y, z, width, height, depth, material, mass = 0, withPhysics = true) {
    // 安全检查：确保材质存在
    if (!material) {
        console.warn('材质未定义，使用默认材质');
        material = state.mats.concrete || state.mats.building;
    }
    
    const geo = new THREE.BoxGeometry(width, height, depth);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    
    // 添加静态/动态标记和边界信息
    mesh.userData.isStatic = (mass === 0);
    mesh.userData.isDynamic = (mass > 0);
    mesh.userData.bounds = {x, z, width, depth, height};
    mesh.userData.canDebris = true;
    mesh.userData.debrisColor = material?.userData?.debrisColor || 0x888888;
    mesh.userData.debrisCount = 5;
    mesh.userData.debrisMultiplier = 1;

    // 道路（使用 road 材质且为静态刚体）的物理始终保持激活，不参与范围启停
    // 支持克隆的道路材质，确保纵向道路也有碰撞
    if (mass === 0 && (material === state.mats.road || material?.userData?.isRoadMaterial)) {
        mesh.userData.alwaysActivePhysics = true;
    }
    
    mesh.userData.hasPhysicsBody = !!withPhysics;
    state.scene.add(mesh);

    if (withPhysics) {
        const shape = new CANNON.Box(new CANNON.Vec3(width/2, height/2, depth/2));
        const isStatic = mass === 0;
        const body = new CANNON.Body({ 
            mass: mass, 
            material: state.physicsMaterial,
            collisionFilterGroup: isStatic ? state.collisionGroups.STATIC : state.collisionGroups.ENEMY,
            // 静态刚体仅与玩家/敌人碰撞，不再与其他静态刚体发生碰撞检测
            collisionFilterMask: isStatic ? 
                (state.collisionGroups.PLAYER | state.collisionGroups.ENEMY) :
                (state.collisionGroups.PLAYER | state.collisionGroups.STATIC)
        });
        body.addShape(shape);
        body.position.set(x, y, z);

        // 改为惰性激活：静态刚体默认不加入物理世界，仅记录 physicsBody，
        // 由 updateStaticPhysicsAroundPlayer 在靠近玩家时按需 addBody
        mesh.userData.physicsBody = body;
        
        // 道路等 alwaysActivePhysics 的物体需要立即加入物理世界
        if (isStatic && mesh.userData.alwaysActivePhysics) {
            state.world.addBody(body);
            mesh.userData.inPhysicsWorld = true;
        } else if (isStatic && state.staticPhysicsMeshes) {
            state.staticPhysicsMeshes.push(mesh);
        }

        // 仍然将静态物体加入碰撞网格，供生成点/射线等使用
        if (isStatic) {
            collisionGrid.addStaticObject(mesh);
        }
    }

    return mesh;
}

// 街区网格配置
export const CITY_GRID_CONFIG = {
    blockSize: 40,           // 每个街区40x40米
    roadWidth: 10,           // 道路宽度10米
    gridSize: 70, // 城市网格大小（gridSize x gridSize 个街区）
    centerSafeZone: 2,       // 中心2x2街区为安全区
    noiseScale: 0.2,         // 噪声偏移强度
};

// 预制建筑块类型
const BUILDING_PRESETS = {
    // 空 block 概率改为 0，避免生成完全空白街区
    EMPTY: { type: 'empty', weight: 0 },
    LOW_RISE: { type: 'lowrise', weight: 25, minHeight: 8, maxHeight: 15 },
    MID_RISE: { type: 'midrise', weight: 20, minHeight: 20, maxHeight: 30 }, // 调整为20-30米
    HIGH_RISE: { type: 'highrise', weight: 15, minHeight: 50, maxHeight: 120 }, // 调整为50-120米
    INDUSTRIAL: { type: 'industrial', weight: 10, minHeight: 6, maxHeight: 10 },
    PLAZA: { type: 'plaza', weight: 8 },   // 恢复广场生成权重
    // 原来 EMPTY 的 15 权重全部给公园，提高生成公园的概率
    PARK: { type: 'park', weight: 22 }
};

// Poisson Disk 采样配置
const POISSON_CONFIG = {
    minDistance: 3,          // 最小间距3米
    maxAttempts: 30,         // 最大尝试次数
    sampleRadius: 2,         // 采样半径
};

// 简化的Poisson Disk采样实现
class PoissonDiskSampler {
    constructor(bounds, minDistance) {
        this.bounds = bounds;
        this.minDistance = minDistance;
        this.cellSize = minDistance / Math.sqrt(2);
        this.grid = {};
        this.samples = [];
        this.active = [];
    }

    sample() {
        if (this.active.length === 0 && this.samples.length === 0) {
            // 初始化：在中心区域添加第一个点
            const initialPoint = {
                x: (getRandom() - 0.5) * this.bounds.width * 0.3,
                z: (getRandom() - 0.5) * this.bounds.height * 0.3
            };
            this.addPoint(initialPoint);
        }

        while (this.active.length > 0) {
            const randomIndex = Math.floor(getRandom() * this.active.length);
            const point = this.active[randomIndex];

            for (let i = 0; i < POISSON_CONFIG.maxAttempts; i++) {
                const newPoint = this.generateRandomPointAround(point);
                
                if (this.isValidPoint(newPoint)) {
                    this.addPoint(newPoint);
                    return newPoint;
                }
            }

            // 如果尝试多次都失败，移除这个点
            this.active.splice(randomIndex, 1);
        }

        return null;
    }

    generateRandomPointAround(point) {
        const angle = getRandom() * Math.PI * 2;
        const radius = POISSON_CONFIG.sampleRadius + getRandom() * this.minDistance;
        
        return {
            x: point.x + Math.cos(angle) * radius,
            z: point.z + Math.sin(angle) * radius
        };
    }

    isValidPoint(point) {
        // 检查边界
        if (Math.abs(point.x) > this.bounds.width / 2 || 
            Math.abs(point.z) > this.bounds.height / 2) {
            return false;
        }

        // 检查与其他点的距离
        const gridX = Math.floor(point.x / this.cellSize);
        const gridZ = Math.floor(point.z / this.cellSize);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const neighborKey = `${gridX + dx},${gridZ + dz}`;
                const neighbor = this.grid[neighborKey];
                
                if (neighbor) {
                    const dist = Math.sqrt(
                        Math.pow(point.x - neighbor.x, 2) + 
                        Math.pow(point.z - neighbor.z, 2)
                    );
                    if (dist < this.minDistance) {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    addPoint(point) {
        this.samples.push(point);
        this.active.push(point);
        
        const gridX = Math.floor(point.x / this.cellSize);
        const gridZ = Math.floor(point.z / this.cellSize);
        this.grid[`${gridX},${gridZ}`] = point;
    }
}

// 生成街区网格
function generateCityGrid() {
    const grid = [];
    const { blockSize, roadWidth, gridSize, centerSafeZone } = CITY_GRID_CONFIG;
    const totalSize = gridSize * (blockSize + roadWidth) - roadWidth;
    const offset = -totalSize / 2;

    for (let x = 0; x < gridSize; x++) {
        for (let z = 0; z < gridSize; z++) {
            // 中心安全区域设为空地
            const isSafeZone = (x < centerSafeZone && z < centerSafeZone) ||
                              (x >= gridSize - centerSafeZone && z < centerSafeZone) ||
                              (x < centerSafeZone && z >= gridSize - centerSafeZone) ||
                              (x >= gridSize - centerSafeZone && z >= gridSize - centerSafeZone);

            // 不带噪声的街区中心（规则网格中心）
            const centerX = offset + x * (blockSize + roadWidth) + blockSize / 2;
            const centerZ = offset + z * (blockSize + roadWidth) + blockSize / 2;

            // 对大多数建筑添加噪声偏移；plaza/park 稍后会使用不带噪声的 centerX/centerZ
            const noiseOffset = {
                x: (getRandom() - 0.5) * blockSize * CITY_GRID_CONFIG.noiseScale,
                z: (getRandom() - 0.5) * blockSize * CITY_GRID_CONFIG.noiseScale
            };

            grid.push({
                gridX: x,
                gridZ: z,
                // worldX/Z 作为默认带噪声的位置
                worldX: centerX + noiseOffset.x,
                worldZ: centerZ + noiseOffset.z,
                // 额外保留一个规则网格中心，供 plaza/park 使用
                centerX,
                centerZ,
                size: blockSize,
                isSafeZone,
                buildingType: isSafeZone ? 'empty' : selectBuildingType()
            });
        }
    }

    return grid;
}

// 根据权重选择建筑类型
function selectBuildingType() {
    const totalWeight = Object.values(BUILDING_PRESETS).reduce((sum, preset) => sum + preset.weight, 0);
    let random = getRandom() * totalWeight;
    
    for (const preset of Object.values(BUILDING_PRESETS)) {
        random -= preset.weight;
        if (random <= 0) {
            return preset.type;
        }
    }
    
    return 'empty';
}

// 创建预制建筑块
function createBuildingPreset(block) {
    const { worldX, worldZ, centerX, centerZ, size, buildingType } = block;

    switch (buildingType) {
        case 'empty':
            return; // 不创建任何建筑
            
        case 'lowrise':
            createLowRiseBuilding(worldX, worldZ, size);
            break;
            
        case 'midrise':
            createMidRiseBuilding(worldX, worldZ, size);
            break;
            
        case 'highrise':
            createHighRiseBuilding(worldX, worldZ, size);
            break;
            
        case 'industrial':
            createIndustrialBuilding(worldX, worldZ, size);
            break;
            
        case 'plaza':
            // 广场：底座不受噪声影响，固定在规则网格中心
            createPlaza(centerX, centerZ, size);
            break;
            
        case 'park':
            // 公园：同样使用规则网格中心
            createPark(centerX, centerZ, size);
            break;
    }
}

// 创建低层建筑 (8-15米) - 店面玻璃+实心二层
function createLowRiseBuilding(x, z, size) {
    const totalHeight = 8 + getRandom() * 7;
    const maxBuildingSize = size * 0.8;
    const buildingSize = maxBuildingSize * (0.6 + getRandom() * 0.4);
    
    // 低层建筑材质池 - 现实风格 (移除红砖)
    const materials = [
        state.mats.grayBrick,      // 灰砖
        state.mats.warmConcrete,   // 暖灰混凝土
        state.mats.concrete        // 灰白混凝土
    ];
    const selectedMaterial = materials[Math.floor(getRandom() * materials.length)];
    
    // 一层店面玻璃 (3米高) —— 作为整栋建筑的唯一物理碰撞体
    const storefrontHeight = 3;
    createLocalBox(x, storefrontHeight / 2, z, buildingSize, storefrontHeight, buildingSize, state.mats.storefront, 0, true);
    
    // 二层及以上实心墙体 —— 仅视觉，不参与物理碰撞
    const upperHeight = totalHeight - storefrontHeight;
    if (upperHeight > 0) {
        createLocalBox(x, storefrontHeight + upperHeight / 2, z, buildingSize * 0.9, upperHeight, buildingSize * 0.9, selectedMaterial, 0, false);
    }
    
    // 小屋顶 —— 仅视觉
    createLocalBox(x, totalHeight + 0.5, z, buildingSize * 0.85, 1, buildingSize * 0.85, state.mats.metalRoof, 0, false);
}

// 创建中层建筑 (20-30米) - 现代办公楼风格
function createMidRiseBuilding(x, z, size) {
    const totalHeight = 20 + getRandom() * 10; // 20-30米
    const maxBuildingSize = size * 0.8;
    const buildingSize = maxBuildingSize * (0.7 + getRandom() * 0.3);
    
    // 添加微小偏移防止z-fighting
    const offsetX = (getRandom() - 0.5) * 0.01;
    const offsetZ = (getRandom() - 0.5) * 0.01;
    const finalX = x + offsetX;
    const finalZ = z + offsetZ;
    
    // 中层建筑材质池
    const materials = [
        state.mats.modernGlass,    // 蓝绿色玻璃幕墙
        state.mats.warmConcrete,   // 暖灰混凝土
        state.mats.concrete,       // 灰白混凝土
        state.mats.grayBrick       // 灰砖
    ];
    const selectedMaterial = materials[Math.floor(getRandom() * materials.length)];
    
    // 基座 (3米高，稍大) —— 作为整栋中层建筑的唯一物理碰撞体
    const baseHeight = 3;
    createLocalBox(finalX, baseHeight / 2, finalZ, buildingSize * 1.1, baseHeight, buildingSize * 1.1, state.mats.concrete, 0, true);
    
    // 主体塔身 —— 仅视觉
    const mainHeight = totalHeight - baseHeight - 2; // 留2米给顶部
    createLocalBox(finalX, baseHeight + mainHeight / 2, finalZ, buildingSize, mainHeight, buildingSize, selectedMaterial, 0, false);
    
    // 顶部装饰 —— 仅视觉
    const topHeight = 2;
    createLocalBox(finalX, totalHeight - topHeight / 2, finalZ, buildingSize * 0.9, topHeight, buildingSize * 0.9, state.mats.metalRoof, 0, false);
    
    // 侧面装饰条带 —— 仅视觉（略微向外凸出，避免与主体墙面共面）
    if (getRandom() > 0.5) {
        const stripWidth = buildingSize * 0.08;   // 略窄一点
        const stripHeight = mainHeight;
        const stripDepth = buildingSize * 0.1;    // 减少深度避免重合
        // 中心略偏出主体外墙，使装饰条清晰地凸在楼体外侧
        createLocalBox(finalX + buildingSize * 0.48, baseHeight + stripHeight / 2, finalZ,
                       stripWidth, stripHeight, stripDepth, state.mats.metalRoof, 0, false);
    }
}

// 创建高层建筑 (50-120米) - 真实摩天楼结构
function createHighRiseBuilding(x, z, size) {
    const totalHeight = 50 + getRandom() * 70; // 50-120米
    const maxBuildingSize = size * 0.8;
    const buildingSize = maxBuildingSize * (0.5 + getRandom() * 0.3);
    
    // 添加微小偏移防止z-fighting
    const offsetX = (getRandom() - 0.5) * 0.01;
    const offsetZ = (getRandom() - 0.5) * 0.01;
    const finalX = x + offsetX;
    const finalZ = z + offsetZ;
    
    // 高层建筑材质池
    const materials = [
        state.mats.modernGlass,    // 蓝绿色玻璃幕墙
        state.mats.warmConcrete,   // 暖灰混凝土
        state.mats.concrete        // 灰白混凝土
    ];
    const selectedMaterial = materials[Math.floor(getRandom() * materials.length)];
    
    // 基座 (5-8米高，更大更稳固) —— 作为整栋高层建筑的唯一物理碰撞体
    const baseHeight = 5 + getRandom() * 3;
    createLocalBox(finalX, baseHeight / 2, finalZ, buildingSize * 1.2, baseHeight, buildingSize * 1.2, state.mats.concrete, 0, true);
    
    // 主塔身分段 - 根据高度决定分段数量
    const towerHeight = totalHeight - baseHeight - 6; // 留6米给机房和顶部
    let currentY = baseHeight;
    
    if (totalHeight > 80) {
        // 超高层建筑：三段式收窄
        const segment1Height = towerHeight * 0.4;
        const segment2Height = towerHeight * 0.35;
        const segment3Height = towerHeight * 0.25;
        
        // 下部塔身 (最宽) —— 仅视觉
        createLocalBox(finalX, currentY + segment1Height / 2, finalZ, buildingSize, segment1Height, buildingSize, selectedMaterial, 0, false);
        currentY += segment1Height;
        
        // 中部塔身 (收窄) —— 仅视觉
        const midSize = buildingSize * 0.85;
        createLocalBox(finalX, currentY + segment2Height / 2, finalZ, midSize, segment2Height, midSize, selectedMaterial, 0, false);
        currentY += segment2Height;
        
        // 上部塔身 (更窄) —— 仅视觉
        const topSize = buildingSize * 0.7;
        createLocalBox(finalX, currentY + segment3Height / 2, finalZ, topSize, segment3Height, topSize, selectedMaterial, 0, false);
        currentY += segment3Height;
        
        // 装饰条带
        if (getRandom() > 0.5) {
            const stripWidth = buildingSize * 0.1;
            const stripDepth = buildingSize * 0.1; // 减少深度避免重合
            createLocalBox(finalX + buildingSize * 0.4, baseHeight + towerHeight * 0.5, finalZ, stripWidth, towerHeight * 0.3, stripDepth, state.mats.metalRoof, 0);
        }
    } else {
        // 普通高层建筑：两段式收窄
        const lowerHeight = towerHeight * 0.6;
        const upperHeight = towerHeight * 0.4;
        
        // 下部塔身 —— 仅视觉
        createLocalBox(finalX, currentY + lowerHeight / 2, finalZ, buildingSize, lowerHeight, buildingSize, selectedMaterial, 0, false);
        currentY += lowerHeight;
        
        // 上部塔身 (收窄) —— 仅视觉
        const topSize = buildingSize * 0.8;
        createLocalBox(finalX, currentY + upperHeight / 2, finalZ, topSize, upperHeight, topSize, selectedMaterial, 0, false);
        currentY += upperHeight;
    }
    
    // 机房帽子 (4-6米高，更小) —— 仅视觉
    const machineRoomHeight = 4 + getRandom() * 2;
    const machineRoomSize = buildingSize * 0.5;
    createLocalBox(finalX, currentY + machineRoomHeight / 2, finalZ, machineRoomSize, machineRoomHeight, machineRoomSize, state.mats.metalRoof, 0, false);
    currentY += machineRoomHeight;
    
    // 天线/尖顶 (超高层建筑) —— 仅视觉
    if (totalHeight > 90) {
        const antennaHeight = 8 + getRandom() * 12; // 8-20米天线
        createLocalBox(finalX, currentY + antennaHeight / 2, finalZ, 1, antennaHeight, 1, state.mats.metal, 0, false);
    } else if (getRandom() > 0.5) {
        // 普通高层的小天线
        createLocalBox(finalX, currentY + 2, finalZ, 1, 4, 1, state.mats.metal, 0, false);
    }
    
    // 玻璃条带装饰 —— 仅视觉
    if (selectedMaterial === state.mats.modernGlass && getRandom() > 0.4) {
        const stripWidth = buildingSize * 0.15;
        const stripHeight = towerHeight * 0.7;
        const stripDepth = buildingSize * 0.1; // 减少深度避免重合
        createLocalBox(finalX + buildingSize * 0.35, baseHeight + stripHeight / 2, finalZ, stripWidth, stripHeight, stripDepth, state.mats.storefront, 0, false);
    }
}

// 创建工业建筑 - 长条矮仓+金属屋顶
function createIndustrialBuilding(x, z, size) {
    const maxBuildingSize = size * 0.8;
    const buildingLength = maxBuildingSize * (0.8 + getRandom() * 0.2);
    const buildingWidth = maxBuildingSize * (0.4 + getRandom() * 0.2);
    const wallHeight = 6 + getRandom() * 4; // 6-10米高的矮仓
    
    // 旋转角度，让长条仓有不同朝向
    const rotation = getRandom() > 0.5 ? 0 : Math.PI / 2;
    
    // 主体长条仓
    if (rotation === 0) {
        // 长度沿 X 轴，宽度沿 Z 轴
        createLocalBox(x, wallHeight / 2, z, buildingLength, wallHeight, buildingWidth, state.mats.concrete, 0);
        // 金属屋顶 (单坡屋顶)
        createLocalBox(x, wallHeight + 1, z, buildingLength, 2, buildingWidth * 1.1, state.mats.metalRoof, 0);
    } else {
        // 长度沿 Z 轴，宽度沿 X 轴（调转尺寸）
        createLocalBox(x, wallHeight / 2, z, buildingWidth, wallHeight, buildingLength, state.mats.concrete, 0);
        // 金属屋顶 (单坡屋顶)
        createLocalBox(x, wallHeight + 1, z, buildingWidth * 1.1, 2, buildingLength, state.mats.metalRoof, 0);
    }
    
    // 工业门：根据朝向将门贴到外墙正面，而不是埋在仓库中心
    const doorWidth = 3;
    const doorHeight = wallHeight * 0.7;
    const doorDepth = 0.5;
    let doorX = x;
    let doorZ = z;

    if (rotation === 0) {
        // 仓库长边沿 X，短边沿 Z，正面朝 +Z：把门推到 +Z 外墙（略微前凸 0.25m）
        doorZ = z + buildingWidth / 2 + doorDepth / 2;
    } else {
        // 仓库长边沿 Z，短边沿 X，正面朝 +X：把门推到 +X 外墙（略微侧凸 0.25m）
        doorX = x + buildingWidth / 2 + doorDepth / 2;
    }

    createLocalBox(doorX, doorHeight / 2, doorZ, doorWidth, doorHeight, doorDepth, state.mats.metal, 0);
}

function createPlaza(x, z, size) {
    // 广场底座：固定为街区大小的 90%，且始终居中在 (x, z)
    const plazaSize = size * 0.9;
    
    // 广场材质池 - 深灰铺装，避免任何偏白效果
    const plazaMaterials = [
        state.mats.grayBrick,      // 深一点的灰砖
        state.mats.industrial      // 工业深灰混凝土
    ];
    const selectedMaterial = plazaMaterials[Math.floor(getRandom() * plazaMaterials.length)];
    
    createLocalBox(x, 0.1, z, plazaSize, 0.2, plazaSize, selectedMaterial, 0);
    
    // 中心装饰：必定二选一（纪念碑 / 喷泉），各约 50%
    {
        const decorType = getRandom();
        if (decorType < 0.5) {
            // 雕像 / 纪念碑：底座 + 第一段立柱 + 第二段更细的尖顶柱
            const baseSize = plazaSize * 0.25;
            const baseHeight = 0.6;
            const pillarWidth = baseSize * 0.35;
            const pillarHeight = 7.0; // 提高一倍高度
            const topWidth = pillarWidth * 0.65;
            const topHeight = 3.0;

            // 石质底座（略暗灰）
            const baseMat = state.mats.concrete;
            createLocalBox(x, baseHeight / 2, z, baseSize, baseHeight, baseSize, baseMat, 0);

            // 第一段立柱本体（稍窄、较高）
            const pillarMatPool = [state.mats.grayBrick, state.mats.warmConcrete, state.mats.metal];
            const pillarMat = pillarMatPool[Math.floor(getRandom() * pillarMatPool.length)];
            createLocalBox(x, baseHeight + pillarHeight / 2, z, pillarWidth, pillarHeight, pillarWidth, pillarMat, 0);

            // 第二段更细的“天线”/尖顶柱
            const topY = baseHeight + pillarHeight + topHeight / 2;
            createLocalBox(x, topY, z, topWidth, topHeight, topWidth, state.mats.metalRoof, 0);
        } else {
            // 小喷泉：石质池壁 + 中间水面
            const basinSize = plazaSize * 0.35;
            const basinHeight = 0.6;

            // 池壁（略暗石材）
            const basinMat = state.mats.concrete;
            createLocalBox(x, basinHeight / 2, z, basinSize, basinHeight, basinSize, basinMat, 0);

            // 水面（略低一点的蓝色“水”）
            const waterSize = basinSize * 0.8;
            const waterThickness = 0.12;
            const waterY = basinHeight - waterThickness / 2 + 0.02; // 略低于池壁顶部
            const waterMat = state.mats.glass;
            createLocalBox(x, waterY, z, waterSize, waterThickness, waterSize, waterMat, 0);
        }
    }

    // 为每个广场随机生成 2-4 把长椅：放置在外圈区域，确保在铺装范围内（且始终朝外）
    const benchCount = 2 + Math.floor(getRandom() * 3); // 2-4 把
    for (let i = 0; i < benchCount; i++) {
        // 长椅放置在外圈：30%-40% 半径范围内，确保完全在广场底座上
        // 广场半径 = plazaSize / 2，长椅最大半径不能超过广场半径减去长椅长度的一半
        const plazaRadius = plazaSize / 2;
        const benchHalfLength = 1.2; // 长椅长度的一半，留一些余量
        const maxSafeRadius = plazaRadius - benchHalfLength;

        const minRadius = plazaSize * 0.3;  // 最小半径 30%
        const maxRadius = Math.min(plazaSize * 0.4, maxSafeRadius); // 最大半径 40%，但不超过安全范围
        const edgeRadius = minRadius + getRandom() * (maxRadius - minRadius);
        const angle = getRandom() * Math.PI * 2;

        const bx = x + Math.cos(angle) * edgeRadius;
        const bz = z + Math.sin(angle) * edgeRadius;

        // 根据长椅位置计算“背离”广场中心的方向（与公园相反：永远朝外）
        let benchRotation;
        const dx = bx - x; // 长椅相对于中心的 X 偏移
        const dz = bz - z; // 长椅相对于中心的 Z 偏移

        // 根据长椅所在象限确定朝向（dx,dz 指向“外侧”，rotation 也要指向外）
        if (Math.abs(dx) > Math.abs(dz)) {
            // 长椅主要在东西方向
            if (dx > 0) {
                benchRotation = 1; // 在东侧，朝东（背对中心）
            } else {
                benchRotation = 3; // 在西侧，朝西（背对中心）
            }
        } else {
            // 长椅主要在南北方向
            // 本地坐标下长椅默认朝 +Z（前），靠背在 -Z（后）：
            // - 北侧 (dz > 0) 想要朝更北 (+Z) 使用默认朝向 (0)
            // - 南侧 (dz < 0) 想要朝更南 (-Z) 需要旋转 180 度 (2)
            if (dz > 0) {
                benchRotation = 0; // 在北侧，朝北（背对中心）
            } else {
                benchRotation = 2; // 在南侧，朝南（背对中心）
            }
        }

        // plaza 使用金属材质的长椅
        const metalMat = state.mats.metal || state.mats.metalRoof || null;
        createParkBench(bx, bz, benchRotation, metalMat);
    }
}

// 创建公园
function createPark(x, z, size) {
    // 公园草地底座：固定为街区大小的 90%，且始终居中在 (x, z)
    const parkSize = size * 0.9;
    createLocalBox(x, 0.1, z, parkSize, 0.2, parkSize, state.mats.grass, 0);
    
    // 树木数量和位置随机 - 种植在公园内圈区域
    const treeCount = 1 + Math.floor(getRandom() * 4); // 1-4棵树
    for (let i = 0; i < treeCount; i++) {
        // 树木种植区域限制在公园的50%范围内（内圈）
        const treeRadius = parkSize * 0.25;
        const treeX = x + (getRandom() - 0.5) * treeRadius;
        const treeZ = z + (getRandom() - 0.5) * treeRadius;
        createTree(treeX, treeZ);
    }
    
    // 随机添加灌木丛 - 同样在内圈区域
    if (getRandom() > 0.6) {
        const bushCount = 1 + Math.floor(getRandom() * 3); // 1-3个灌木丛
        for (let i = 0; i < bushCount; i++) {
            const bushX = x + (getRandom() - 0.5) * parkSize * 0.4;
            const bushZ = z + (getRandom() - 0.5) * parkSize * 0.4;
            createBush(bushX, bushZ);
        }
    }

    // 为每个公园随机生成 2-4 把长椅：放置在外圈区域，确保在草地范围内
    const benchCount = 2 + Math.floor(getRandom() * 3); // 2-4 把
    for (let i = 0; i < benchCount; i++) {
        // 长椅放置在外圈：65%-85%半径范围内，确保完全在草地内（草地是parkSize*0.9）
        // 草地半径 = parkSize/2，长椅最大半径不能超过草地半径减去长椅长度的一半
        const grassRadius = parkSize / 2;
        const benchHalfLength = 1.2; // 长椅长度的一半，留一些余量
        const maxSafeRadius = grassRadius - benchHalfLength;
        
        const minRadius = parkSize * 0.3;  // 最小半径30%
        const maxRadius = Math.min(parkSize * 0.4, maxSafeRadius); // 最大半径40%，但不能超过安全范围
        const edgeRadius = minRadius + getRandom() * (maxRadius - minRadius);
        const angle = getRandom() * Math.PI * 2;

        const bx = x + Math.cos(angle) * edgeRadius;
        const bz = z + Math.sin(angle) * edgeRadius;

        // 根据长椅位置计算朝向公园中心的方向
        let benchRotation;
        const dx = bx - x; // 长椅相对于中心的X偏移
        const dz = bz - z; // 长椅相对于中心的Z偏移
        
        // 根据长椅所在象限确定朝向
        if (Math.abs(dx) > Math.abs(dz)) {
            // 长椅主要在东西方向
            if (dx > 0) {
                benchRotation = 3; // 在东侧，朝西（面向中心）
            } else {
                benchRotation = 1; // 在西侧，朝东（面向中心）
            }
        } else {
            // 长椅主要在南北方向
            // 注意：本地坐标下长椅默认朝 +Z，靠背在 -Z，所以：
            // - 北侧 (dz > 0) 想要面向南 (-Z) 需要旋转180度 (2)
            // - 南侧 (dz < 0) 想要面向北 (+Z) 使用默认朝向 (0)
            if (dz > 0) {
                benchRotation = 2; // 在北侧，朝南（面向中心）
            } else {
                benchRotation = 0; // 在南侧，朝北（面向中心）
            }
        }

        createParkBench(bx, bz, benchRotation);
    }

    // 在每个公园中心附近生成一个小箱子，作为简单测试用容器
    // 为了不挡路，稍微偏离精确中心一点点
    const crateOffset = parkSize * 0.15;
    const crateX = x + crateOffset;
    const crateZ = z;
    const crateSize = 1.0;
    const crateHeight = 0.8;
    const crateMat = state.mats.box || state.mats.metal || state.mats.concrete || state.mats.building;
    const crateMesh = createLocalBox(
        crateX,
        crateHeight / 2, // 放在地面上
        crateZ,
        crateSize,
        crateHeight,
        crateSize,
        crateMat,
        0,
        true
    );
    if (crateMesh && crateMesh.userData) {
        // 标记为简单容器，供 F 键交互测试使用
        crateMesh.userData.isContainer = true;
        crateMesh.userData.containerId = `park_crate_${Math.round(x)}_${Math.round(z)}`;
        crateMesh.userData.containerType = 'park_crate';
    }
}

// 创建道路网格
function createRoadGrid() {
    const { blockSize, roadWidth, gridSize } = CITY_GRID_CONFIG;
    const totalSize = gridSize * (blockSize + roadWidth) - roadWidth;
    const offset = -totalSize / 2;

    // 创建横向道路（整体稍微下沉）
    const roadYBase = 0.02;       // 比原来 0.1 更贴近主地面
    const roadYOffset = 0.02;     // 纵向道路比横向高0.02米，彻底解决 z-fighting

    // 针对两种方向分别设置纹理 repeat：
    // - 横向道路：主要表现为斑马线（希望在过街方向变窄）
    // - 纵向道路：主要表现为行车线（希望沿路方向更合理）
    const zebraRepeat = 3;        // 斑马线方向的 repeat（让条纹变窄）
    const laneRepeat = 1;         // 行车线方向保持原始密度

    // 注意：state.mats.road 是一个共享材质，修改它的 map.repeat 会影响所有道路。
    // 为纵向道路克隆一份专用材质和贴图，避免扰动横向道路的外观。
    const horizontalRoadMat = state.mats.road;
    let verticalRoadMat = state.mats.road;
    if (state.mats.road) {
        verticalRoadMat = state.mats.road.clone();
        verticalRoadMat.userData.isRoadMaterial = true; // 标记为道路材质
        if (state.mats.road.map) {
            verticalRoadMat.map = state.mats.road.map.clone();
            verticalRoadMat.map.wrapS = state.mats.road.map.wrapS;
            verticalRoadMat.map.wrapT = state.mats.road.map.wrapT;
        }
    }

    // 横向道路：沿 X 方向延伸，Z 方向为道路宽度
    // 斑马线：我们希望斑马线的长宽比例不变，但在整条街上出现多次
    const zebraTileMultiplier = 3; // 让整条街上斑马线重复 zebraTileMultiplier 次
    for (let i = 0; i <= gridSize; i++) {
        const roadZ = offset + i * (blockSize + roadWidth) - roadWidth / 2;
        const mesh = createLocalBox(0, roadYBase, roadZ, totalSize, 0.2, roadWidth, horizontalRoadMat, 0);
        if (mesh && mesh.material && mesh.material.map) {
            const map = mesh.material.map;
            // 最终比例：沿街(X)=3*3=9，过街(Z)=1，得到 9:1 的斑马线外观
            map.repeat.set(zebraRepeat * zebraTileMultiplier, laneRepeat); // (9, 1)
            map.needsUpdate = true;
        }
    }

    // 纵向道路：沿 Z 方向延伸，X 方向为道路宽度
    for (let i = 0; i <= gridSize; i++) {
        const roadX = offset + i * (blockSize + roadWidth) - roadWidth / 2;
        const mesh = createLocalBox(roadX, roadYBase + roadYOffset, 0, roadWidth, 0.2, totalSize, verticalRoadMat, 0);
        if (mesh && mesh.material && mesh.material.map) {
            const map = mesh.material.map;
            // 纵向道路：过街方向（X）repeat=1，沿街方向（Z）repeat=10
            map.repeat.set(1, 10);
            map.needsUpdate = true;
        }
    }
}

// 检查位置是否适合放置道具
function isValidPropLocation(x, z) {
    // 检查是否在中心安全区
    const safeZoneSize = CITY_GRID_CONFIG.centerSafeZone * 
        (CITY_GRID_CONFIG.blockSize + CITY_GRID_CONFIG.roadWidth);
    if (Math.abs(x) < safeZoneSize && Math.abs(z) < safeZoneSize) {
        return false;
    }

    // 检查是否在道路上
    const blockSize = CITY_GRID_CONFIG.blockSize;
    const roadWidth = CITY_GRID_CONFIG.roadWidth;
    const cellX = Math.floor((x + 200) / (blockSize + roadWidth));
    const cellZ = Math.floor((z + 200) / (blockSize + roadWidth));
    
    const localX = ((x + 200) % (blockSize + roadWidth)) - blockSize / 2;
    const localZ = ((z + 200) % (blockSize + roadWidth)) - blockSize / 2;
    
    // 如果在道路范围内，不适合放置道具
    if (Math.abs(localX) > blockSize / 2 || Math.abs(localZ) > blockSize / 2) {
        return false;
    }

    return true;
}


// 创建树木
function createTree(x, z) {
    // 树干
    createLocalBox(x, 2, z, 0.5, 4, 0.5, state.mats.treeTrunk, 0);
    // 树叶
    createLocalBox(x, 4.5, z, 2, 2, 2, state.mats.treeLeaf, 0);
}

// 创建公园长椅（使用多个 createLocalBox 拼接，不再使用 Group）
// 所有部件都是静态 box，自动接入静态物理与渲染优化系统
function createParkBench(x, z, rotation = 0, materialOverride = null) {
    // 基础尺寸（世界单位：米）
    const benchLength = 2.2;   // 座位长度
    const benchWidth  = 0.6;   // 座位前后宽度
    const benchHeight = 0.5;   // 座面高度
    const backHeight  = 0.8;   // 靠背高度

    // 使用共享木箱材质作为默认木质长椅，支持外部传入材质覆写
    const mat = materialOverride || state.mats.box || state.mats.wood || state.mats.treeTrunk;

    function placeBox(localX, localY, localZ, w, h, d) {
        // 根据rotation参数计算旋转后的位置
        let rotatedX = localX;
        let rotatedZ = localZ;
        let rotatedW = w;
        let rotatedD = d;
        
        if (rotation === 1) {
            // 旋转90度（朝东）：X和Z互换，宽度和深度互换
            rotatedX = localZ;
            rotatedZ = -localX;
            rotatedW = d;
            rotatedD = w;
        } else if (rotation === 2) {
            // 旋转180度（朝南）：X和Z取反
            rotatedX = -localX;
            rotatedZ = -localZ;
        } else if (rotation === 3) {
            // 旋转270度（朝西）：X和Z互换并取反，宽度和深度互换
            rotatedX = -localZ;
            rotatedZ = localX;
            rotatedW = d;
            rotatedD = w;
        }
        
        const worldX = x + rotatedX;
        const worldZ = z + rotatedZ;
        createLocalBox(worldX, localY, worldZ, rotatedW, h, rotatedD, mat, 0);
    }

    // 1. 座面（略厚一点的木板）
    const seatThickness = benchHeight * 0.3;
    placeBox(0, benchHeight, 0, benchLength, seatThickness, benchWidth);

    // 2. 靠背（竖直板，稍微向后偏一点）
    const backOffsetZ = -benchWidth * 0.3;
    placeBox(0, benchHeight + backHeight / 2, backOffsetZ, benchLength, backHeight, benchWidth * 0.2);

    // 3. 四条椅腿
    const legWidth = 0.12;
    const legDepth = 0.12;
    const halfL = benchLength / 2 - 0.2;
    const halfW = benchWidth / 2 - 0.2;

    const legY = benchHeight / 2;
    placeBox(-halfL, legY,  halfW, legWidth, benchHeight, legDepth);
    placeBox( halfL, legY,  halfW, legWidth, benchHeight, legDepth);
    placeBox(-halfL, legY, -halfW, legWidth, benchHeight, legDepth);
    placeBox( halfL, legY, -halfW, legWidth, benchHeight, legDepth);
}


// 创建灌木丛
function createBush(x, z) {
    // 灌木丛大小变化
    const bushWidth = 1.5 + getRandom() * 1; // 1.5-2.5米宽
    const bushHeight = 0.8 + getRandom() * 0.4; // 0.8-1.2米高
    const bushDepth = 1.5 + getRandom() * 1; // 1.5-2.5米深
    
    // 使用共享的树叶材质，避免为每丛灌木创建独立材质实例
    const bushMaterial = state.mats.treeLeaf;
    
    // 灌木主体（不规则椭圆形状，用多个盒子组合）
    createLocalBox(x, bushHeight / 2, z, bushWidth, bushHeight, bushDepth, bushMaterial, 0);
    
    // 添加一些不规则的小块让灌木更自然
    const offsetX1 = (getRandom() - 0.5) * bushWidth * 0.3;
    const offsetZ1 = (getRandom() - 0.5) * bushDepth * 0.3;
    createLocalBox(x + offsetX1, bushHeight * 0.7, z + offsetZ1, bushWidth * 0.6, bushHeight * 0.5, bushDepth * 0.6, bushMaterial, 0);
}


// 主要的城市场景生成函数
export function generateCityScene() {
    console.log('🏙️ 生成街区网格城市场景...');
    
    // 清空静态物理网格引用，避免已销毁的 mesh 残留导致空气墙
    state.staticPhysicsMeshes.length = 0;
    
    // 每次生成城市时创建新的mapGenerator实例，确保新的随机种子
    currentMapGenerator = createMapGenerator();
    console.log(`🎲 新的地图生成器已创建，种子: ${currentMapGenerator.seed.toFixed(2)}`);
    
    // 1. 创建道路网格
    createRoadGrid();
    console.log('🛣️ 道路网格创建完成');
    
    // 2. 生成街区网格
    const cityGrid = generateCityGrid();
    console.log(`📋 生成了 ${cityGrid.length} 个街区网格`);
    
    // 3. 创建预制建筑块
    let buildingCount = 0;
    cityGrid.forEach(block => {
        if (block.buildingType !== 'empty') {
            createBuildingPreset(block);
            buildingCount++;
        }
    });
    console.log(`🏢 创建了 ${buildingCount} 个建筑`);
    
    console.log('✅ 城市场景生成完成！');
}

// 导出函数：获取当前地图生成器信息
export function getCurrentMapGeneratorInfo() {
    if (!currentMapGenerator) {
        return { error: '地图生成器未初始化' };
    }
    return {
        seed: currentMapGenerator.seed,
        seedFormatted: currentMapGenerator.seed.toFixed(2),
        isInitialized: true
    };
}

// 导出函数：强制创建新的地图生成器
export function forceNewMapGenerator() {
    currentMapGenerator = createMapGenerator();
    console.log(`🎲 强制创建新的地图生成器，种子: ${currentMapGenerator.seed.toFixed(2)}`);
    return getCurrentMapGeneratorInfo();
}
