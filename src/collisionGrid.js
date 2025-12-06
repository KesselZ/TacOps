import { CONFIG } from './config.js';

// 网格化碰撞检测系统 - 性能优化核心
export class CollisionGrid {
    constructor(cellSize = 40, worldSize = 600) {
        this.cellSize = cellSize;
        this.worldSize = worldSize;
        this.grid = new Map(); // 使用Map存储网格
        this.staticObjects = new Set(); // 静态物体集合
        this.dynamicObjects = new Set(); // 动态物体集合
        
        // 计算网格边界
        this.minX = -worldSize / 2;
        this.maxX = worldSize / 2;
        this.minZ = -worldSize / 2;
        this.maxZ = worldSize / 2;
        this.gridWidth = Math.ceil(worldSize / cellSize);
        this.gridHeight = Math.ceil(worldSize / cellSize);
        
        console.log(`🔧 初始化碰撞网格: ${this.gridWidth}x${this.gridHeight}, 单元格大小: ${cellSize}m`);
    }

    // 根据新的 worldSize 重设网格范围与分辨率（在城市配置变化时调用）
    resizeWorld(worldSize) {
        this.worldSize = worldSize;
        this.minX = -worldSize / 2;
        this.maxX = worldSize / 2;
        this.minZ = -worldSize / 2;
        this.maxZ = worldSize / 2;
        this.gridWidth = Math.ceil(worldSize / this.cellSize);
        this.gridHeight = Math.ceil(worldSize / this.cellSize);

        // 重新配置世界时清空旧数据，避免残留
        this.clear();
        console.log(`🔧 重设碰撞网格: ${this.gridWidth}x${this.gridHeight}, 单元格大小: ${this.cellSize}m, worldSize=${worldSize}`);
    }
    
    // 将世界坐标转换为网格坐标
    worldToGrid(x, z) {
        const gridX = Math.floor((x - this.minX) / this.cellSize);
        const gridZ = Math.floor((z - this.minZ) / this.cellSize);
        return { x: gridX, z: gridZ };
    }
    
    // 获取网格键
    getCellKey(gridX, gridZ) {
        return `${gridX},${gridZ}`;
    }
    
    // 获取物体占据的所有网格
    getObjectCells(x, z, width, depth) {
        const cells = [];
        const startX = Math.floor((x - width/2 - this.minX) / this.cellSize);
        const endX = Math.floor((x + width/2 - this.minX) / this.cellSize);
        const startZ = Math.floor((z - depth/2 - this.minZ) / this.cellSize);
        const endZ = Math.floor((z + depth/2 - this.minZ) / this.cellSize);
        
        for (let gx = startX; gx <= endX; gx++) {
            for (let gz = startZ; gz <= endZ; gz++) {
                if (gx >= 0 && gx < this.gridWidth && gz >= 0 && gz < this.gridHeight) {
                    cells.push(this.getCellKey(gx, gz));
                }
            }
        }
        return cells;
    }
    
    // 添加静态物体（建筑等）
    addStaticObject(object) {
        if (!object.userData || !object.userData.bounds) return;
        
        const { x, z, width, depth } = object.userData.bounds;
        const cells = this.getObjectCells(x, z, width, depth);
        
        object.userData.gridCells = cells;
        this.staticObjects.add(object);
        
        // 将物体添加到相关网格
        cells.forEach(cellKey => {
            if (!this.grid.has(cellKey)) {
                this.grid.set(cellKey, new Set());
            }
            this.grid.get(cellKey).add(object);
        });
    }
    
    // 添加动态物体（敌人、玩家等）
    addDynamicObject(object) {
        if (!object.userData || !object.userData.bounds) return;
        
        this.dynamicObjects.add(object);
        this.updateDynamicObject(object);
    }
    
    // 更新动态物体位置
    updateDynamicObject(object) {
        if (!object.userData || !object.userData.bounds) return;
        
        // 从旧网格移除
        if (object.userData.gridCells) {
            object.userData.gridCells.forEach(cellKey => {
                const cell = this.grid.get(cellKey);
                if (cell) cell.delete(object);
            });
        }
        
        // 添加到新网格
        const { x, z, width, depth } = object.userData.bounds;
        const cells = this.getObjectCells(x, z, width, depth);
        object.userData.gridCells = cells;
        
        cells.forEach(cellKey => {
            if (!this.grid.has(cellKey)) {
                this.grid.set(cellKey, new Set());
            }
            this.grid.get(cellKey).add(object);
        });
    }
    
    // 移除物体
    removeObject(object) {
        if (object.userData.gridCells) {
            object.userData.gridCells.forEach(cellKey => {
                const cell = this.grid.get(cellKey);
                if (cell) cell.delete(object);
            });
        }
        
        this.staticObjects.delete(object);
        this.dynamicObjects.delete(object);
    }
    
    // 检查位置是否与静态物体碰撞
    checkStaticCollision(x, z, width, depth, excludeObject = null) {
        const cells = this.getObjectCells(x, z, width, depth);
        
        for (const cellKey of cells) {
            const cell = this.grid.get(cellKey);
            if (!cell) continue;
            
            for (const object of cell) {
                if (object === excludeObject) continue;
                if (!this.staticObjects.has(object)) continue;
                
                if (this.checkObjectCollision(x, z, width, depth, object)) {
                    return true;
                }
            }
        }
        return false;
    }
    
    // 检查两个物体是否碰撞
    checkObjectCollision(x1, z1, w1, d1, obj2) {
        if (!obj2.userData || !obj2.userData.bounds) return false;
        
        const { x: x2, z: z2, width: w2, depth: d2, height } = obj2.userData.bounds;

        // 低于一定高度的静态物体不参与阻挡（例如矮掩体、路牙等）
        const h = height ?? Infinity;
        const minBlockHeight = (CONFIG.spawn && CONFIG.spawn.buildingMinBlockHeight) || 3;
        if (h <= minBlockHeight) return false; // 低于阈值不算阻挡生成
        
        const dx = Math.abs(x1 - x2);
        const dz = Math.abs(z1 - z2);
        const minDistX = (w1 + w2) / 2;
        const minDistZ = (d1 + d2) / 2;
        
        return dx < minDistX && dz < minDistZ;
    }
    
    // 获取指定位置附近的静态物体
    getNearbyStaticObjects(x, z, radius) {
        const nearby = new Set();
        const cells = this.getObjectCells(x, z, radius * 2, radius * 2);
        
        for (const cellKey of cells) {
            const cell = this.grid.get(cellKey);
            if (!cell) continue;
            
            for (const object of cell) {
                if (this.staticObjects.has(object)) {
                    nearby.add(object);
                }
            }
        }
        
        return Array.from(nearby);
    }
    
    // 清空网格
    clear() {
        this.grid.clear();
        this.staticObjects.clear();
        this.dynamicObjects.clear();
    }
    
    // 获取网格统计信息
    getStats() {
        let totalObjects = 0;
        let occupiedCells = 0;
        
        for (const cell of this.grid.values()) {
            if (cell.size > 0) {
                occupiedCells++;
                totalObjects += cell.size;
            }
        }
        
        return {
            totalCells: this.gridWidth * this.gridHeight,
            occupiedCells: occupiedCells,
            totalObjects: totalObjects,
            staticObjects: this.staticObjects.size,
            dynamicObjects: this.dynamicObjects.size,
            averageObjectsPerCell: occupiedCells > 0 ? totalObjects / occupiedCells : 0
        };
    }
}

// 全局碰撞网格实例（初始worldSize只是占位，实际会在buildLevel中通过 resizeWorld 动态重设）
export const collisionGrid = new CollisionGrid(20, 600);
