import * as THREE from 'three';
import { state } from './globals.js';
import { CONFIG } from './config.js';

// 随机地图生成器 - 使用程序化生成技术
export class MapGenerator {
    constructor() {
        const mapConfig = CONFIG.mapGeneration;
        this.seed = mapConfig.useRandomSeed ? Math.random() * 10000 : mapConfig.fixedSeed;
        this.random = this.seededRandom(this.seed);
        this.config = mapConfig;
    }
    
    // 种子随机数生成器 - 确保同一种子生成相同地图
    seededRandom(seed) {
        return function() {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };
    }
    
    // 生成地图布局模板
    generateMapTemplate() {
        const templates = Object.keys(this.config.mapTemplateWeights);
        const weights = Object.values(this.config.mapTemplateWeights);
        
        const rand = this.random();
        let cumulative = 0;
        
        for (let i = 0; i < templates.length; i++) {
            cumulative += weights[i];
            if (rand < cumulative) {
                return templates[i];
            }
        }
        return templates[0];
    }
    
    // 根据模板生成建筑物配置
    generateBuildingLayout(template) {
        const layouts = {
            urban: {
                buildingDensity: 0.7,
                avgHeight: 25,
                heightVariation: 15,
                buildingSpacing: 60,
                buildingTypes: ['residential', 'commercial', 'basic'], // 建筑类型权重
                typeWeights: [0.4, 0.3, 0.3]
            },
            industrial: {
                buildingDensity: 0.5,
                avgHeight: 15,
                heightVariation: 8,
                buildingSpacing: 80,
                buildingTypes: ['industrial', 'commercial', 'basic'],
                typeWeights: [0.6, 0.2, 0.2]
            },
            park: {
                buildingDensity: 0.3,
                avgHeight: 8,
                heightVariation: 4,
                buildingSpacing: 100,
                buildingTypes: ['residential', 'basic'],
                typeWeights: [0.3, 0.7]
            },
            downtown: {
                buildingDensity: 0.8,
                avgHeight: 35,
                heightVariation: 20,
                buildingSpacing: 50,
                buildingTypes: ['skyscraper', 'commercial', 'basic'],
                typeWeights: [0.5, 0.3, 0.2]
            },
            suburban: {
                buildingDensity: 0.4,
                avgHeight: 12,
                heightVariation: 6,
                buildingSpacing: 90,
                buildingTypes: ['residential', 'commercial', 'basic'],
                typeWeights: [0.7, 0.2, 0.1]
            }
        };
        
        return layouts[template] || layouts.urban;
    }
    
    // 检查建筑是否与现有建筑碰撞
    checkBuildingOverlap(newBuilding, existingBuildings, buffer = 3) {
        for (let existing of existingBuildings) {
            const dx = Math.abs(newBuilding.x - existing.x);
            const dz = Math.abs(newBuilding.z - existing.z);
            const minDistX = (newBuilding.width + existing.width) / 2 + buffer;
            const minDistZ = (newBuilding.depth + existing.depth) / 2 + buffer;
            
            if (dx < minDistX && dz < minDistZ) {
                return true; // 有重叠
            }
        }
        return false; // 无重叠
    }
    
    // 创建连接建筑群组的桥梁建筑
    createConnectingBuildings(cluster1, cluster2, allBuildings, layout) {
        const dx = cluster2.x - cluster1.x;
        const dz = cluster2.z - cluster1.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        // 如果两个群组距离适中，创建连接建筑
        if (distance > 30 && distance < 80) {
            const connectorCount = Math.floor(distance / 25); // 每25米一个连接建筑
            
            for (let i = 1; i < connectorCount; i++) {
                const t = i / connectorCount;
                const connectX = cluster1.x + dx * t;
                const connectZ = cluster1.z + dz * t;
                
                const connectorBuilding = {
                    x: connectX + (this.random() - 0.5) * 10,
                    z: connectZ + (this.random() - 0.5) * 10,
                    width: THREE.MathUtils.randFloat(6, 12),
                    depth: THREE.MathUtils.randFloat(8, 15),
                    height: layout.avgHeight * 0.7,
                    type: this.selectBuildingType(layout),
                    offsetX: 0,
                    offsetZ: 0
                };
                
                // 检查连接建筑是否合适
                if (!this.checkBuildingOverlap(connectorBuilding, allBuildings, 2)) {
                    allBuildings.push(connectorBuilding);
                    return {
                        offsetX: connectorBuilding.x - cluster1.x,
                        offsetZ: connectorBuilding.z - cluster1.z,
                        width: connectorBuilding.width,
                        depth: connectorBuilding.depth,
                        height: connectorBuilding.height,
                        type: connectorBuilding.type
                    };
                }
            }
        }
        return null;
    }
    
    // 生成建筑群组
    generateBuildingClusters(layout) {
        const clusters = [];
        const bp = this.config.buildingParams;
        const { halfSize } = CONFIG.CITY_LAYOUT;
        const clusterCount = Math.floor(bp.minClusterCount + this.random() * (bp.maxClusterCount - bp.minClusterCount));
        const allBuildings = []; // 存储所有建筑用于碰撞检测
        
        // 创建城市中心点，让建筑群围绕中心分布形成连贯城市
        const cityCenterAngle = this.random() * Math.PI * 2;
        const cityCenterRadius = halfSize * 0.3; // 城市中心区域
        
        for (let i = 0; i < clusterCount; i++) {
            let clusterX, clusterZ;
            
            if (i === 0) {
                // 第一个群组放在城市中心附近
                clusterX = Math.cos(cityCenterAngle) * cityCenterRadius + (this.random() - 0.5) * 50;
                clusterZ = Math.sin(cityCenterAngle) * cityCenterRadius + (this.random() - 0.5) * 50;
            } else {
                // 后续群组围绕中心分布，但保持连接性
                const angle = cityCenterAngle + (i / clusterCount) * Math.PI * 1.5 + (this.random() - 0.5) * 0.8;
                const radius = cityCenterRadius + (this.random() * halfSize * 0.7); // 分布到整个地图
                clusterX = Math.cos(angle) * radius;
                clusterZ = Math.sin(angle) * radius;
            }
            
            const cluster = {
                x: clusterX,
                z: clusterZ,
                buildings: [],
                type: this.selectBuildingType(layout)
            };
            
            // 增加每个群组的建筑数量，让区域更密集
            const buildingCount = Math.floor(bp.minBuildingsPerCluster * 1.5 + this.random() * (bp.maxBuildingsPerCluster * 1.5 - bp.minBuildingsPerCluster * 1.5));
            for (let j = 0; j < buildingCount; j++) {
                let attempts = 0;
                const maxAttempts = 10;
                let validBuilding = null;
                
                while (attempts < maxAttempts && !validBuilding) {
                    // 群组内建筑更密集，但保持合理间距避免过度拥挤
                    const buildingType = this.selectBuildingType(layout);
                    const offsetX = THREE.MathUtils.randFloatSpread(8); // 适度缩小偏移
                    const offsetZ = THREE.MathUtils.randFloatSpread(8); // 适度缩小偏移
                    const width = THREE.MathUtils.randFloat(8, 18); // 保持建筑尺寸
                    const depth = THREE.MathUtils.randFloat(8, 22); // 保持建筑尺寸
                    const height = Math.max(bp.minBuildingHeight, Math.min(bp.maxBuildingHeight, 
                        layout.avgHeight + (this.random() - 0.5) * layout.heightVariation));
                    
                    const worldX = cluster.x + offsetX;
                    const worldZ = cluster.z + offsetZ;
                    
                    const newBuilding = {
                        x: worldX,
                        z: worldZ,
                        width: width,
                        depth: depth,
                        height: height,
                        type: buildingType,
                        offsetX: offsetX,
                        offsetZ: offsetZ
                    };
                    
                    // 检查碰撞
                    if (!this.checkBuildingOverlap(newBuilding, allBuildings, 2)) {
                        validBuilding = newBuilding;
                        allBuildings.push(validBuilding);
                        
                        // 转换为原始格式
                        cluster.buildings.push({
                            offsetX: offsetX,
                            offsetZ: offsetZ,
                            width: width,
                            depth: depth,
                            height: height,
                            type: buildingType
                        });
                    }
                    
                    attempts++;
                }
            }
            
            if (cluster.buildings.length > 0) {
                clusters.push(cluster);
            }
        }
        
        // 创建连接建筑，让城市更连贯
        for (let i = 0; i < clusters.length - 1; i++) {
            for (let j = i + 1; j < clusters.length; j++) {
                if (this.random() < 0.3) { // 30%概率创建连接
                    const connector = this.createConnectingBuildings(clusters[i], clusters[j], allBuildings, layout);
                    if (connector) {
                        // 将连接建筑添加到第一个群组
                        clusters[i].buildings.push(connector);
                    }
                }
            }
        }
        
        // console.log(`🏗️ 生成了 ${clusters.length} 个建筑群组，总共 ${allBuildings.length} 个建筑`);
        return clusters;
    }
    
    // 选择建筑类型
    selectBuildingType(layout) {
        const types = layout.buildingTypes;
        const weights = layout.typeWeights;
        
        const rand = this.random();
        let cumulative = 0;
        
        for (let i = 0; i < types.length; i++) {
            cumulative += weights[i];
            if (rand < cumulative) {
                return types[i];
            }
        }
        return types[0];
    }
    
    // 生成掩体配置
    generateCoverLayout() {
        const coverZones = [];
        const cp = this.config.coverParams;
        
        // 生成掩体区域
        const zoneCount = Math.floor(cp.minZoneCount + this.random() * (cp.maxZoneCount - cp.minZoneCount));
        
        for (let i = 0; i < zoneCount; i++) {
            // 让掩体区域更密集，缩小分布范围
            const zone = {
                x: THREE.MathUtils.randFloatSpread(120), // 从150缩小到120
                z: THREE.MathUtils.randFloatSpread(120), // 从150缩小到120
                radius: cp.minZoneRadius + this.random() * (cp.maxZoneRadius - cp.minZoneRadius),
                density: 0.4 + this.random() * 0.4, // 提高基础密度从0.3到0.4
                primaryType: cp.coverTypes[Math.floor(this.random() * cp.coverTypes.length)]
            };
            coverZones.push(zone);
        }
        
        return coverZones;
    }
    
    // 生成道路系统
    generateRoadSystem() {
        const roads = [];
        const patterns = ['grid', 'radial', 'organic', 'mixed'];
        const pattern = patterns[Math.floor(this.random() * patterns.length)];
        
        switch (pattern) {
            case 'grid':
                roads.push(...this.generateGridRoads());
                break;
            case 'radial':
                roads.push(...this.generateRadialRoads());
                break;
            case 'organic':
                roads.push(...this.generateOrganicRoads());
                break;
            case 'mixed':
                roads.push(...this.generateMixedRoads());
                break;
        }
        
        return roads;
    }
    
    // 生成网格道路
    generateGridRoads() {
        const roads = [];
        const gridSize = 80 + Math.floor(this.random() * 40); // 80-120
        
        // 主要道路
        for (let i = -3; i <= 3; i++) {
            if (i === 0) continue; // 中心区域留空
            roads.push({
                type: 'horizontal',
                position: i * gridSize,
                width: 12 + this.random() * 6
            });
            roads.push({
                type: 'vertical', 
                position: i * gridSize,
                width: 12 + this.random() * 6
            });
        }
        
        return roads;
    }
    
    // 生成放射状道路
    generateRadialRoads() {
        const roads = [];
        const rayCount = 6 + Math.floor(this.random() * 4); // 6-10条放射线
        
        for (let i = 0; i < rayCount; i++) {
            const angle = (i / rayCount) * Math.PI * 2;
            roads.push({
                type: 'radial',
                angle: angle,
                width: 10 + this.random() * 8,
                length: 200 + this.random() * 200
            });
        }
        
        // 添加环形道路
        for (let r = 1; r <= 3; r++) {
            roads.push({
                type: 'circular',
                radius: r * 100,
                width: 8 + this.random() * 4
            });
        }
        
        return roads;
    }
    
    // 生成有机道路
    generateOrganicRoads() {
        const roads = [];
        const pathCount = 3 + Math.floor(this.random() * 3); // 3-6条路径
        
        for (let i = 0; i < pathCount; i++) {
            const points = [];
            const pointCount = 4 + Math.floor(this.random() * 4); // 4-8个控制点
            
            for (let j = 0; j < pointCount; j++) {
                points.push({
                    x: THREE.MathUtils.randFloatSpread(300),
                    z: THREE.MathUtils.randFloatSpread(300)
                });
            }
            
            roads.push({
                type: 'curve',
                points: points,
                width: 8 + this.random() * 6
            });
        }
        
        return roads;
    }
    
    // 生成混合道路
    generateMixedRoads() {
        const roads = [];
        
        // 主要网格道路
        roads.push(...this.generateGridRoads().slice(0, 4));
        
        // 添加几条有机路径
        roads.push(...this.generateOrganicRoads().slice(0, 2));
        
        return roads;
    }
    
    // 生成完整地图配置
    generateMapConfig() {
        const template = this.generateMapTemplate();
        const layout = this.generateBuildingLayout(template);
        const env = this.config.environmentDensity;
        
        // console.log(`🗺️ 地图模板: ${template}`);
        // console.log(`🏗️ 建筑类型配置:`, layout.buildingTypes, layout.typeWeights);
        
        const clusters = this.generateBuildingClusters(layout);
        
        // 统计建筑类型
        const typeCount = {};
        clusters.forEach(cluster => {
            cluster.buildings.forEach(building => {
                typeCount[building.type] = (typeCount[building.type] || 0) + 1;
            });
        });
        // console.log(`📊 建筑类型统计:`, typeCount);
        
        return {
            seed: this.seed,
            template: template,
            layout: layout,
            clusters: clusters,
            coverZones: this.generateCoverLayout(),
            roads: this.generateRoadSystem(),
            environment: {
                treeDensity: env.trees.min + this.random() * (env.trees.max - env.trees.min),
                lampDensity: env.lamps.min + this.random() * (env.lamps.max - env.lamps.min),
                carDensity: env.cars.min + this.random() * (env.cars.max - env.cars.min),
                propDensity: env.props.min + this.random() * (env.props.max - env.props.min)
            }
        };
    }
}

// 导出地图生成器工厂函数
export function createMapGenerator() {
    return new MapGenerator();
}

// 保持向后兼容的默认实例
export const mapGenerator = createMapGenerator();
