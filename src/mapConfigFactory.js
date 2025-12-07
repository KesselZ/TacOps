import { createMapGenerator } from './mapGenerator.js';
import { getHandmadeMapConfig } from './handmadeMaps.js';

/**
 * 简单的种子随机函数，用于手写地图保持可复现的随机性
 */
function seededRandom(seed = 1) {
    let s = seed;
    return () => {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
    };
}

/**
 * 根据 mapId 生成统一的地图上下文
 * 返回 { kind, mapConfig, randomFunc, label }
 */
export function createMapContext(mapId = 'random_city') {
    // 手写地图：使用前缀 handmade:xxx 或直接传入名字
    const handmadePrefix = 'handmade:';
    if (mapId.startsWith(handmadePrefix)) {
        const name = mapId.slice(handmadePrefix.length);
        const mapConfig = getHandmadeMapConfig(name);
        const randomFunc = seededRandom(mapConfig.seed || 1);
        return {
            kind: 'handmade',
            mapConfig,
            randomFunc,
            label: name
        };
    }

    // 默认：随机城市
    const generator = createMapGenerator();
    const mapConfig = generator.generateMapConfig();
    return {
        kind: 'procedural-city',
        mapConfig,
        randomFunc: generator.random,
        label: 'random_city'
    };
}
