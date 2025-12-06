import { RARITY, ITEM_TYPE } from './stash.js';
import { state } from './globals.js';

// 基础物品模板：城市摸金用的代表性物品（每个都有独立的 Emoji 图标）
// 价格区间：
//  - Common：20–150
//  - Uncommon：200–400
//  - Rare：400–2500
//  - Legendary：3500–10000
const BASE_ITEMS = {
    // Common：杂物 / 小钱
    lighter: {
        id: 'loot_lighter',
        type: ITEM_TYPE.MISC,
        name: '一次性打火机',
        icon: '🧨',
        rarity: RARITY.COMMON,
        weight: 0.05,
        value: 30,
        description: '常见的一次性打火机，已经用掉一半气。'
    },
    wallet: {
        id: 'loot_wallet',
        type: ITEM_TYPE.MISC,
        name: '旧钱包',
        icon: '👛',
        rarity: RARITY.COMMON,
        weight: 0.15,
        value: 60,
        description: '磨损严重的钱包，只剩下一点零钱和过期卡片。'
    },
    keychain: {
        id: 'loot_keychain',
        type: ITEM_TYPE.MISC,
        name: '钥匙串',
        icon: '🗝️',
        rarity: RARITY.COMMON,
        weight: 0.1,
        value: 80,
        description: '一串普通的金属钥匙，已经找不到对应的门了。'
    },
    usb_drive: {
        id: 'loot_usb',
        type: ITEM_TYPE.MISC,
        name: '旧U盘',
        icon: '💽',
        rarity: RARITY.COMMON,
        weight: 0.05,
        value: 120,
        description: '容量不大的旧U盘，里面存着一些早年间的资料。'
    },

    // Uncommon：数码小件 / 配件
    mouse: {
        id: 'loot_mouse',
        type: ITEM_TYPE.MISC,
        name: '办公鼠标',
        icon: '🖱️',
        rarity: RARITY.UNCOMMON,
        weight: 0.2,
        value: 200,
        description: '普通办公用鼠标，做工还算扎实。'
    },
    headset: {
        id: 'loot_headset',
        type: ITEM_TYPE.MISC,
        name: '品牌耳机',
        icon: '🎧',
        rarity: RARITY.UNCOMMON,
        weight: 0.3,
        value: 260,
        description: '常见品牌的头戴式耳机，音质尚可。'
    },
    gamepad: {
        id: 'loot_gamepad',
        type: ITEM_TYPE.MISC,
        name: '游戏手柄',
        icon: '🎮',
        rarity: RARITY.UNCOMMON,
        weight: 0.4,
        value: 320,
        description: '用旧了的游戏手柄，按键略微发黏。'
    },
    fitness_band: {
        id: 'loot_fitness_band',
        type: ITEM_TYPE.MISC,
        name: '运动手环',
        icon: '📿',
        rarity: RARITY.UNCOMMON,
        weight: 0.1,
        value: 380,
        description: '入门款运动手环，记录了不少步数和心率。'
    },

    // Rare：主力高价值电子设备 / 珠宝
    phone: {
        id: 'loot_phone',
        type: ITEM_TYPE.MISC,
        name: '智能手机',
        icon: '📱',
        rarity: RARITY.RARE,
        weight: 0.3,
        value: 800,
        description: '带指纹解锁的智能手机，屏幕轻微刮花。'
    },
    tablet: {
        id: 'loot_tablet',
        type: ITEM_TYPE.MISC,
        name: '平板电脑',
        icon: '📟',
        rarity: RARITY.RARE,
        weight: 0.5,
        value: 1500,
        description: '便携式平板设备，适合办公与娱乐。'
    },
    camera: {
        id: 'loot_camera',
        type: ITEM_TYPE.MISC,
        name: '单反相机',
        icon: '📷',
        rarity: RARITY.RARE,
        weight: 1.2,
        value: 2200,
        description: '入门级单反相机，镜头略有磨损。'
    },
    business_laptop: {
        id: 'loot_business_laptop',
        type: ITEM_TYPE.MISC,
        name: '商务笔记本电脑',
        icon: '💻',
        rarity: RARITY.RARE,
        weight: 2.5,
        value: 2500,
        description: '轻薄型商务笔记本，适合日常办公与出差。'
    },

    // Legendary：顶级电子设备 / 名贵珠宝
    gaming_laptop: {
        id: 'loot_gaming_laptop',
        type: ITEM_TYPE.MISC,
        name: '高端游戏本',
        icon: '🖥️',
        rarity: RARITY.LEGENDARY,
        weight: 3.0,
        value: 4200,
        description: '高性能游戏笔记本，配备发光键盘和独立显卡。'
    },
    luxury_watch: {
        id: 'loot_luxury_watch',
        type: ITEM_TYPE.MISC,
        name: '名牌手表',
        icon: '⌚',
        rarity: RARITY.LEGENDARY,
        weight: 0.1,
        value: 6000,
        description: '知名品牌的机械表，保养良好，价值不菲。'
    },
    gold_ring: {
        id: 'loot_gold_ring',
        type: ITEM_TYPE.MISC,
        name: '金戒指',
        icon: '💍',
        rarity: RARITY.LEGENDARY,
        weight: 0.1,
        value: 8000,
        description: '足金戒指，表面有少量划痕，但金重十足。'
    },
    diamond_pendant: {
        id: 'loot_diamond_pendant',
        type: ITEM_TYPE.MISC,
        name: '钻石吊坠',
        icon: '💎',
        rarity: RARITY.LEGENDARY,
        weight: 0.05,
        value: 10000,
        description: '镶嵌钻石的吊坠，切工精细，收藏价值极高。'
    }
};

// 通用加权随机工具
function rollFromWeighted(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return null;
    const total = entries.reduce((sum, e) => sum + (e.weight || 0), 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const e of entries) {
        const w = e.weight || 0;
        if (r < w) return e;
        r -= w;
    }
    return entries[entries.length - 1];
}

// 掉落表配置：不同难度下的箱子出货率
// 结构：
//  - itemCountRange: [min, max] 容器内物品数量范围
//  - rarityWeights: 各稀有度基础概率权重
//  - entriesByRarity: 不同稀有度下的物品条目和各自权重
export const LOOT_TABLES = {
    // 普通难度箱子：出货率最低
    normal: {
        itemCountRange: [1, 4],
        rarityWeights: {
            COMMON: 55,
            UNCOMMON: 30,
            RARE: 13,
            LEGENDARY: 2
        },
        entriesByRarity: {
            COMMON: [
                { itemId: 'lighter', weight: 1 },
                { itemId: 'wallet', weight: 1 },
                { itemId: 'keychain', weight: 1 },
                { itemId: 'usb_drive', weight: 1 }
            ],
            UNCOMMON: [
                { itemId: 'mouse', weight: 1 },
                { itemId: 'headset', weight: 1 },
                { itemId: 'gamepad', weight: 1 },
                { itemId: 'fitness_band', weight: 1 }
            ],
            RARE: [
                { itemId: 'phone', weight: 1 },
                { itemId: 'tablet', weight: 1 },
                { itemId: 'camera', weight: 1 },
                { itemId: 'business_laptop', weight: 1 }
            ],
            LEGENDARY: [
                { itemId: 'gaming_laptop', weight: 1 },
                { itemId: 'luxury_watch', weight: 1 },
                { itemId: 'gold_ring', weight: 1 },
                { itemId: 'diamond_pendant', weight: 1 }
            ]
        },
        maxSlots: 8
    },
    
    // 困难难度箱子：中等出货率
    hard: {
        itemCountRange: [2, 5],
        rarityWeights: {
            COMMON: 50,
            UNCOMMON: 35,
            RARE: 10,
            LEGENDARY: 5
        },
        entriesByRarity: {
            COMMON: [
                { itemId: 'lighter', weight: 1 },
                { itemId: 'wallet', weight: 1 },
                { itemId: 'keychain', weight: 1 },
                { itemId: 'usb_drive', weight: 1 }
            ],
            UNCOMMON: [
                { itemId: 'mouse', weight: 1 },
                { itemId: 'headset', weight: 1 },
                { itemId: 'gamepad', weight: 1 },
                { itemId: 'fitness_band', weight: 1 }
            ],
            RARE: [
                { itemId: 'phone', weight: 1 },
                { itemId: 'tablet', weight: 1 },
                { itemId: 'camera', weight: 1 },
                { itemId: 'business_laptop', weight: 1 }
            ],
            LEGENDARY: [
                { itemId: 'gaming_laptop', weight: 1 },
                { itemId: 'luxury_watch', weight: 1 },
                { itemId: 'gold_ring', weight: 1 },
                { itemId: 'diamond_pendant', weight: 1 }
            ]
        },
        maxSlots: 8
    },
    
    // 疯狂难度箱子：出货率最高
    insane: {
        itemCountRange: [3, 6],
        rarityWeights: {
            COMMON: 30,
            UNCOMMON: 40,
            RARE: 20,
            LEGENDARY: 10
        },
        entriesByRarity: {
            COMMON: [
                { itemId: 'lighter', weight: 1 },
                { itemId: 'wallet', weight: 1 },
                { itemId: 'keychain', weight: 1 },
                { itemId: 'usb_drive', weight: 1 }
            ],
            UNCOMMON: [
                { itemId: 'mouse', weight: 1 },
                { itemId: 'headset', weight: 1 },
                { itemId: 'gamepad', weight: 1 },
                { itemId: 'fitness_band', weight: 1 }
            ],
            RARE: [
                { itemId: 'phone', weight: 1 },
                { itemId: 'tablet', weight: 1 },
                { itemId: 'camera', weight: 1 },
                { itemId: 'business_laptop', weight: 1 }
            ],
            LEGENDARY: [
                { itemId: 'gaming_laptop', weight: 1 },
                { itemId: 'luxury_watch', weight: 1 },
                { itemId: 'gold_ring', weight: 1 },
                { itemId: 'diamond_pendant', weight: 1 }
            ]
        },
        maxSlots: 8
    },
    
    // 默认容器（向后兼容）
    defaultContainer: {
        itemCountRange: [2, 5],
        rarityWeights: {
            COMMON: 50,
            UNCOMMON: 35,
            RARE: 10,
            LEGENDARY: 5
        },
        entriesByRarity: {
            COMMON: [
                { itemId: 'lighter', weight: 1 },
                { itemId: 'wallet', weight: 1 },
                { itemId: 'keychain', weight: 1 },
                { itemId: 'usb_drive', weight: 1 }
            ],
            UNCOMMON: [
                { itemId: 'mouse', weight: 1 },
                { itemId: 'headset', weight: 1 },
                { itemId: 'gamepad', weight: 1 },
                { itemId: 'fitness_band', weight: 1 }
            ],
            RARE: [
                { itemId: 'phone', weight: 1 },
                { itemId: 'tablet', weight: 1 },
                { itemId: 'camera', weight: 1 },
                { itemId: 'business_laptop', weight: 1 }
            ],
            LEGENDARY: [
                { itemId: 'gaming_laptop', weight: 1 },
                { itemId: 'luxury_watch', weight: 1 },
                { itemId: 'gold_ring', weight: 1 },
                { itemId: 'diamond_pendant', weight: 1 }
            ]
        },
        maxSlots: 8
    }
};

function getLootTableForContainer(containerType) {
    // 如果没有指定容器类型，尝试根据当前难度选择
    if (!containerType) {
        const difficulty = state?.selectedDifficulty || 'normal';
        const difficultyTable = LOOT_TABLES[difficulty];
        if (difficultyTable) return difficultyTable;
    }
    
    const table = LOOT_TABLES[containerType];
    return table || LOOT_TABLES.defaultContainer;
}

function rollRarityKey(rarityWeights) {
    const entries = [];
    let total = 0;
    for (const key of ['COMMON', 'UNCOMMON', 'RARE', 'LEGENDARY']) {
        const w = rarityWeights[key] || 0;
        if (w > 0) {
            entries.push({ key, weight: w });
            total += w;
        }
    }
    if (total <= 0 || entries.length === 0) return null;
    const pick = rollFromWeighted(entries);
    return pick ? pick.key : null;
}

function cloneItemFromTemplate(templateKey) {
    const base = BASE_ITEMS[templateKey];
    if (!base) return null;
    const cloned = { ...base };
    // 刚生成的容器物品默认为“未鉴定”状态，由摸金系统逐个揭示
    cloned.identified = false;
    return cloned;
}

// 对外暴露的接口：根据容器类型生成一个 slots 数组
// 返回值：{ maxSlots, slots }
export function generateContainerLoot(containerType) {
    const table = getLootTableForContainer(containerType);
    const maxSlots = table.maxSlots || 8;
    const slots = new Array(maxSlots).fill(null);

    const [minCount, maxCount] = table.itemCountRange || [2, 4];
    const count = Math.max(
        0,
        Math.min(maxSlots, Math.floor(minCount + Math.random() * (Math.max(maxCount, minCount) - minCount + 1)))
    );

    for (let i = 0; i < count; i++) {
        const rarityKey = rollRarityKey(table.rarityWeights || {});
        if (!rarityKey) continue;

        const entries = (table.entriesByRarity && table.entriesByRarity[rarityKey]) || [];
        const picked = rollFromWeighted(entries);
        if (!picked) continue;

        const item = cloneItemFromTemplate(picked.itemId);
        if (!item) continue;

        // 顺序填充到容器格子里
        slots[i] = item;
    }

    return { maxSlots, slots };
}
