// 手写地图配置集中地
// 返回的结构需与 mapConfigFactory 约定的通用 mapConfig 兼容
// 必要字段：
// - seed: number
// - bounds: { width, depth }  用于确定地板/碰撞范围
// - handmadeBuildings: 数组，每个元素 { x, z, width, depth, height, type }
//   type 用于选择材质，可选: residential/commercial/industrial/highrise/basic
// - roads: 可选数组，每个元素 { x, z, width, depth, height?, material? }

export function getHandmadeMapConfig(name = 'default_plaza') {
    switch (name) {
        case 'default_plaza':
        default:
            return {
                seed: 1234,
                template: 'handmade',
                bounds: { width: 200, depth: 200 },
                
                // ========================================
                // 小镇布局：十字街道 + 四个功能街区
                // ========================================
                // 街道宽度约 12 米，建筑沿街整齐排列
                // 地图范围 -100 到 +100（共 200 米）
                
                handmadeBuildings: [
                    // ========== 西北街区：住宅区 ==========
                    // 沿北边排列的住宅（真实尺寸：2-3层楼房）
                    { x: -65, z: -65, width: 18, depth: 15, height: 12, type: 'residential' },
                    { x: -40, z: -65, width: 16, depth: 14, height: 10, type: 'residential' },
                    // 沿西边排列的住宅
                    { x: -65, z: -40, width: 15, depth: 18, height: 11, type: 'residential' },
                    { x: -65, z: -20, width: 14, depth: 16, height: 12, type: 'residential' },
                    // 街区内部
                    { x: -42, z: -42, width: 12, depth: 12, height: 8, type: 'basic' },
                    
                    // ========== 东北街区：商业区 ==========
                    // 沿北边排列的商店（3-4层）
                    { x: 35, z: -65, width: 22, depth: 18, height: 16, type: 'commercial' },
                    { x: 65, z: -65, width: 18, depth: 16, height: 14, type: 'commercial' },
                    // 沿东边排列的商店
                    { x: 65, z: -40, width: 16, depth: 20, height: 18, type: 'commercial' },
                    { x: 65, z: -18, width: 16, depth: 16, height: 15, type: 'commercial' },
                    // 街区内部
                    { x: 40, z: -40, width: 14, depth: 14, height: 10, type: 'basic' },
                    
                    // ========== 西南街区：工业区 ==========
                    // 沿西边排列的仓库（大型低矮建筑）
                    { x: -65, z: 35, width: 25, depth: 20, height: 10, type: 'industrial' },
                    { x: -65, z: 65, width: 22, depth: 18, height: 9, type: 'industrial' },
                    // 沿南边排列的工厂
                    { x: -38, z: 65, width: 20, depth: 22, height: 11, type: 'industrial' },
                    { x: -18, z: 65, width: 18, depth: 20, height: 10, type: 'industrial' },
                    
                    // ========== 东南街区：市政区 ==========
                    // 市政厅（地标建筑，5-6层）
                    { x: 50, z: 50, width: 28, depth: 24, height: 25, type: 'highrise' },
                    // 办公楼
                    { x: 70, z: 25, width: 16, depth: 18, height: 18, type: 'commercial' },
                    { x: 70, z: 70, width: 14, depth: 16, height: 14, type: 'commercial' },
                    // 沿南边的小型办公
                    { x: 28, z: 70, width: 16, depth: 14, height: 12, type: 'basic' },
                    
                    // ========== 中心广场周边 ==========
                    // 广场四角的凉亭/报刊亭（小型结构）
                    { x: -22, z: -22, width: 5, depth: 5, height: 4, type: 'basic' },
                    { x: 22, z: -22, width: 5, depth: 5, height: 4, type: 'basic' },
                    { x: -22, z: 22, width: 5, depth: 5, height: 4, type: 'basic' },
                    { x: 22, z: 22, width: 5, depth: 5, height: 4, type: 'basic' }
                ],
                
                // 十字街道系统
                roads: [
                    // 东西主街（贯穿整个地图）
                    { x: 0, z: 0, width: 180, depth: 12 },
                    // 南北主街（贯穿整个地图）
                    { x: 0, z: 0, width: 12, depth: 180 }
                ],
                
                coverZones: [
                    // 中心广场四角的掩体
                    { x: -25, z: -25, radius: 8, density: 0.5, primaryType: 'low_cover' },
                    { x: 25, z: -25, radius: 8, density: 0.5, primaryType: 'low_cover' },
                    { x: -25, z: 25, radius: 8, density: 0.5, primaryType: 'low_cover' },
                    { x: 25, z: 25, radius: 8, density: 0.5, primaryType: 'low_cover' },
                    // 各街区入口处的掩体
                    { x: -50, z: -15, radius: 6, density: 0.4, primaryType: 'medium_cover' },
                    { x: 50, z: -15, radius: 6, density: 0.4, primaryType: 'medium_cover' },
                    { x: -50, z: 15, radius: 6, density: 0.4, primaryType: 'medium_cover' },
                    { x: 50, z: 15, radius: 6, density: 0.4, primaryType: 'medium_cover' }
                ],
                
                environment: {
                    treeDensity: 0.6,      // 街区绿化
                    lampDensity: 1.0,      // 路灯沿街分布（现在是有序放置）
                    carDensity: 0.5,       // 街边停放的车辆
                    propDensity: 0.5       // 战术掩体箱子
                }
            };
    }
}
